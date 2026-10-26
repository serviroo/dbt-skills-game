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
}
/** What a scene file exports as `build`: makes the scene, lit with `accent` as its rim colour. */
export type BuildScene = (accent: THREE.Color) => Vignette;

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
    dropFence();
    setLive(false);
    sync();
  };
  let lease: Lease | undefined;
  try {
    lease = lendRenderer(holder, evict);
    vig = build(new THREE.Color(opts.accent ?? '#4fb8ff'));
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
   * Fewer pixels on a slow device. A scene draws at the device's own pixel ratio until it is shown to be too slow. Its
   * first frame is timed without the page ever waiting for it (a fence goes in behind it and is looked at on the next
   * animation frames, so this happens while the step opens, before anything is tapped); one slow frame lowers this
   * scene only, and it comes back to full once its frames show the device keeps up. While it moves, the page's frame
   * rate is watched: only that sustained slowness lowers the ratio for the rest of the visit, down to SCENE.minDpr.
   * Comfortably fast for a while, it climbs back a step, never to a ratio sustained slowness already ruled out.
   * Every change of ratio redraws at once, since resizing clears the canvas.
   */
  const maxDpr = lent.maxDpr;
  const minDpr = Math.min(maxDpr, SCENE.minDpr);
  let mine = Number.isNaN(deviceDpr.now) ? maxDpr : Math.min(maxDpr, Math.max(minDpr, deviceDpr.now));
  /** the ratio before a drop made on one timed frame alone, to come back to once frames keep up */
  let before: number | null = null;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let timeIn = 1;
  let fence: WebGLSync | null = null;
  let fenceAt = 0;
  let fenceBusy = 0;
  let fenceRaf = 0;
  let gaps: number[] = [];
  let lastTick = -1;
  let goodFor = 0;
  /**
   * The context has finished drawing a frame. Until then the scene draws nothing more, stays hidden behind its flat
   * picture and doesn't judge the device's speed: a new or restored context first builds the scene's shaders on the GPU,
   * which can take seconds on a slow one, and frames queued behind that only stretch it out.
   */
  let ready = false;
  /** draws at pixel ratio r from now on, the current frame straight away; false when the scene has no size yet */
  function setRatio(r: number) {
    mine = r;
    const w = holder.clientWidth, h = holder.clientHeight;
    if (!w || !h) return false;
    renderer.setPixelRatio(r);
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    v.resize(size.x, size.y);
    gaps = [];
    goodFor = 0;
    if (drawn && !lost && !evicted) draw(clock.now(), beatAt(clock.now()), still());
    return true;
  }
  /** stops looking at the first frame's fence (the scene stops, or the renderer went to another scene) */
  function dropFence() {
    cancelAnimationFrame(fenceRaf);
    fenceRaf = 0;
    if (fence && !gl.isContextLost()) gl.deleteSync(fence);
    fence = null;
  }
  /** the ratio that would fit `ms` into `budget` */
  const fit = (ms: number, budget: number) => Math.max(minDpr, mine * Math.min(0.85, Math.max(0.4, Math.sqrt(budget / ms))));
  /**
   * Looks at the first frame's fence once an animation frame. Once that frame is drawn the scene is ready: it shows the
   * frame for now and moves on. How long it was still drawing is what a frame costs here.
   */
  function checkFence() {
    fenceRaf = 0;
    if (!fence) return;
    const now = performance.now();
    if (gl.isContextLost()) {
      fence = null;
      return;
    }
    if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) {
      fenceBusy = now;
      fenceRaf = requestAnimationFrame(checkFence);
      return;
    }
    gl.deleteSync(fence);
    fence = null;
    ready = true;
    lastTick = -1;
    gaps = [];
    // at least this long: it was still drawing when last looked at. One frame only lowers this scene, for now; a still
    // frame is the only one, so it keeps the full ratio.
    const ms = fenceBusy - fenceAt;
    const calm = still();
    const r = ms > BUDGET && !calm ? fit(ms, BUDGET) : mine;
    if (r < mine - 0.01) {
      before ??= mine;
      setRatio(r);
    } else if (drawn && !lost && !evicted) draw(clock.now(), beatAt(clock.now()), calm);
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
      // sustained slowness: lower, and keep it for the visit
      const r = fit(m * 1000, 1000 / SCENE.fps);
      if (r < mine - 0.01) {
        deviceDpr.tooSlow = Math.min(deviceDpr.tooSlow, mine);
        deviceDpr.now = r;
        before = null;
        setRatio(r);
      }
    } else if (m < 1 / 50) {
      goodFor += dt;
      const top = Math.min(maxDpr, deviceDpr.tooSlow - 0.15);
      if (before !== null && goodFor > 2) {
        // the slow first frame was a one-off: back to where it was
        const r = before;
        before = null;
        setRatio(r);
      } else if (before === null && goodFor > 5 && mine < top) {
        const r = Math.min(top, mine + 0.15);
        deviceDpr.now = r;
        setRatio(r);
      }
    } else goodFor = 0;
    sceneStats.kept = Number.isNaN(deviceDpr.now) ? null : deviceDpr.now;
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
    if (--timeIn === 0) {
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      fenceAt = fenceBusy = performance.now();
      fenceRaf = requestAnimationFrame(checkFence);
    }
    last = t;
    drawn = { ...b };
    sceneStats.frames++;
    sceneStats.last = { kind: opts.kind, e: b.e, dur: b.dur, done: b.done, still: calm };
    sceneStats.dpr = renderer.getPixelRatio();
    if (ready) setLive(true);
  };
  const tick = (t: number) => {
    if (!ready) return;
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
    renderer.setPixelRatio(mine);
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
  // three.js rebuilds its GPU state on its own listener, added before this one; the scene then draws its first frame
  // straight away and shows once that frame is drawn
  const onRestored = () => {
    lost = false;
    ready = false;
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
    dropFence();
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
