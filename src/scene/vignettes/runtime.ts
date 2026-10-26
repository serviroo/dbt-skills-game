import * as THREE from 'three';
import { SCENE } from '../../motion/tokens';
import { deviceDpr, lendRenderer, type Lease } from '../lease';
import { sceneStats } from '../stats';
import type { Beat, SceneOpts } from './host';

/** One scene: everything it draws, posed as a pure function of the beat. */
export interface Vignette {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** poses the scene for this beat; `still` asks for the one calm frame shown with reduced motion */
  pose(b: Beat, still: boolean): void;
  /** the drawing size in device pixels changed */
  resize(width: number, height: number): void;
  /** frees anything the scene made outside its scene graph (the graph itself is freed by the runtime) */
  dispose?(): void;
  /** what the last pose looked like, in plain numbers (where the board is, how big the light is), for the E2E checks */
  readonly probe?: Readonly<Record<string, number | string>>;
}
/** What a scene file exports as `build`: makes the scene, lit with `accent` as its rim colour, in its `variant` if it has several. */
export type BuildScene = (accent: THREE.Color, variant?: string) => Vignette;

const STEP = 1 / SCENE.fps;
/** the longest a scene's frame may take to draw, in ms */
const BUDGET = (1000 / SCENE.fps) * SCENE.budget;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/** Frees every geometry, material and texture under `root`. */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of m.material ? ([] as THREE.Material[]).concat(m.material) : []) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
      for (const u of Object.values((mat as THREE.ShaderMaterial).uniforms ?? {})) if (u.value instanceof THREE.Texture) u.value.dispose();
      mat.dispose();
    }
  });
}

/**
 * Starts the scene in `stage` and returns the function that stops it and frees everything it made. Throws when the
 * scene can't start (no WebGL), so the host keeps the flat picture.
 */
export function runScene(stage: HTMLElement, build: BuildScene, opts: SceneOpts): () => void {
  const holder = document.createElement('div');
  holder.className = 'dq-scene';
  holder.setAttribute('aria-hidden', 'true');
  stage.style.setProperty('--dq-scene-fade', `${SCENE.fadeMs}ms`);
  stage.prepend(holder);
  let vig: Vignette | null = null;
  // the renderer goes to one scene at a time: if another takes it, this one stops and its flat picture comes back
  let evicted = false;
  const evict = () => {
    evicted = true;
    setLive(false);
    sync();
  };
  let lease: Lease | undefined;
  try {
    lease = lendRenderer(holder, evict);
    vig = build(new THREE.Color(opts.accent ?? '#4fb8ff'), opts.variant);
  } catch (err) {
    if (vig) disposeTree(vig.scene);
    lease?.release();
    holder.remove();
    throw err;
  }
  const v = vig;
  const lent = lease;
  const { renderer, canvas } = lent;

  const { clock } = opts;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => (opts.reduced ? opts.reduced() : media.matches);
  let onScreen = false;
  let sized = false;
  let lost = renderer.getContext().isContextLost();
  let live = false;
  let sub: (() => void) | null = null;
  let last = -Infinity;
  let drawn: Beat | null = null;

  /**
   * Fewer pixels on a slow device. A scene draws at the device's own pixel ratio until it is shown to be too slow: its
   * first frame is timed without the page ever waiting for it (a fence goes in behind it and is looked at on the next
   * animation frames, so this happens while the step opens, before anything is tapped), and after that the page's frame
   * rate is watched while it moves. Too slow, and it drops straight to the ratio that fits its budget, down
   * to SCENE.minDpr; comfortably fast for a while, and it climbs back a step, never to a ratio already found too slow.
   */
  const minDpr = Math.min(lent.maxDpr, SCENE.minDpr);
  const ratio = () => (Number.isNaN(deviceDpr.now) ? lent.maxDpr : Math.min(lent.maxDpr, Math.max(minDpr, deviceDpr.now)));
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let timeIn = 1;
  let fence: WebGLSync | null = null;
  let fenceAt = 0;
  let fenceBusy = 0;
  let fenceRaf = 0;
  /** looks at the first frame's fence once an animation frame: how long it was still drawing is what a frame costs here */
  function checkFence() {
    fenceRaf = 0;
    if (!fence) return;
    const now = performance.now();
    if (gl.isContextLost()) {
      fence = null;
      return;
    }
    if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED && now - fenceAt < 2000) {
      fenceBusy = now;
      fenceRaf = requestAnimationFrame(checkFence);
      return;
    }
    gl.deleteSync(fence);
    fence = null;
    // at least this long: it was still drawing when last looked at; resizing clears the canvas, so it is drawn again
    const ms = fenceBusy - fenceAt;
    if (ms > BUDGET && slower(ms, BUDGET) && drawn) draw(clock.now(), beatAt(clock.now()), still());
  }
  let gaps: number[] = [];
  let lastTick = -1;
  let goodFor = 0;
  /** draws at pixel ratio r from now on; false when the scene has no size yet */
  function setRatio(r: number) {
    deviceDpr.now = r;
    const w = holder.clientWidth, h = holder.clientHeight;
    if (!w || !h) return false;
    renderer.setPixelRatio(ratio());
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    v.resize(size.x, size.y);
    gaps = [];
    goodFor = 0;
    return true;
  }
  /** steps down to the ratio that would fit `ms` into the budget; true when it changed */
  function slower(ms: number, budget: number) {
    const now = ratio();
    const r = Math.max(minDpr, now * Math.min(0.85, Math.max(0.4, Math.sqrt(budget / ms))));
    if (r > now - 0.01) return false;
    deviceDpr.tooSlow = Math.min(deviceDpr.tooSlow, now);
    return setRatio(r);
  }
  /** called on every frame of the clock while the scene moves: how far apart the page's frames are */
  function watch(t: number) {
    const dt = t - lastTick;
    lastTick = t;
    // the first frame back, or a page that was frozen or in the background, says nothing about speed
    if (dt <= 0 || dt > 1.5) return;
    gaps.push(dt);
    if (gaps.length > 5) gaps.shift();
    if (gaps.length < 3) return;
    const m = median(gaps);
    if (m * 1000 > SCENE.slowMs) {
      if (slower(m * 1000, 1000 / SCENE.fps)) draw(t, beatAt(t), false);
    } else if (m < 1 / 50 && ratio() < Math.min(lent.maxDpr, deviceDpr.tooSlow - 0.15)) {
      goodFor += dt;
      if (goodFor > 5) setRatio(Math.min(lent.maxDpr, deviceDpr.tooSlow - 0.15, ratio() + 0.15));
    } else goodFor = 0;
  }

  const beatAt = (t: number): Beat => clock.beat?.() ?? { e: t, dur: Infinity, started: true, done: false };
  function setLive(on: boolean) {
    if (on === live) return;
    live = on;
    sceneStats.live += on ? 1 : -1;
    stage.classList.toggle('is-scene-live', on);
    if (on) stage.classList.remove('is-scene-wait');
  }
  const draw = (t: number, b: Beat, calm: boolean) => {
    v.pose(b, calm);
    renderer.render(v.scene, v.camera);
    if (!calm && --timeIn === 0) {
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      fenceAt = fenceBusy = performance.now();
      fenceRaf = requestAnimationFrame(checkFence);
    }
    last = t;
    drawn = { ...b };
    sceneStats.frames++;
    sceneStats.last = { kind: opts.kind, e: b.e, dur: b.dur, done: b.done, still: calm, probe: v.probe && { ...v.probe } };
    sceneStats.dpr = renderer.getPixelRatio();
    setLive(true);
  };
  const tick = (t: number) => {
    const b = beatAt(t);
    if (!still()) watch(t);
    if (still()) {
      draw(t, b, true);
      sub?.();
      sub = null;
      return;
    }
    const changed = !drawn || b.done !== drawn.done || b.started !== drawn.started || b.dur !== drawn.dur;
    if (changed || t - last >= STEP - 0.002 || t < last) draw(t, b, false);
  };
  /** Follows the clock only while the scene can be seen; coming back on screen draws at once. */
  function sync() {
    const can = onScreen && sized && !lost && !evicted && !document.hidden;
    if (can && !sub) {
      lastTick = -1;
      gaps = [];
      const t = clock.now();
      const calm = still();
      draw(t, beatAt(t), calm);
      if (!calm) sub = clock.onFrame(tick);
    } else if (!can && sub) {
      sub();
      sub = null;
    }
  }
  const resync = () => {
    sub?.();
    sub = null;
    sync();
  };

  const io = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    sync();
  });
  io.observe(holder);
  const ro = new ResizeObserver(() => {
    const w = holder.clientWidth, h = holder.clientHeight;
    if (!w || !h || evicted) return;
    renderer.setPixelRatio(ratio());
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    v.resize(size.x, size.y);
    sized = true;
    // resizing clears the canvas, so the frame is drawn again straight away
    if (sub) draw(clock.now(), beatAt(clock.now()), false);
    else resync();
  });
  ro.observe(holder);
  const onLost = () => {
    lost = true;
    setLive(false);
    sync();
  };
  // three.js rebuilds its GPU state on its own listener, added before this one; the scene then draws straight away
  const onRestored = () => {
    lost = false;
    // a restored context may be slower or faster, so its first frame is timed again
    timeIn = 1;
    resync();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  document.addEventListener('visibilitychange', sync);
  media.addEventListener('change', resync);

  return () => {
    sub?.();
    sub = null;
    cancelAnimationFrame(fenceRaf);
    if (fence && !gl.isContextLost()) gl.deleteSync(fence);
    fence = null;
    io.disconnect();
    ro.disconnect();
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    document.removeEventListener('visibilitychange', sync);
    media.removeEventListener('change', resync);
    setLive(false);
    v.dispose?.();
    disposeTree(v.scene);
    lent.release();
    holder.remove();
    const mem = renderer.info.memory;
    sceneStats.left = { geometries: mem.geometries, textures: mem.textures, programs: renderer.info.programs?.length ?? 0 };
  };
}
