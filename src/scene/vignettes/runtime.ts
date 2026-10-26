import * as THREE from 'three';
import { SCENE } from '../../motion/tokens';
import { lendRenderer } from '../lease';
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
  let lease;
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
  const { renderer, canvas } = lease;

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
    last = t;
    drawn = { ...b };
    sceneStats.frames++;
    sceneStats.last = { kind: opts.kind, e: b.e, dur: b.dur, done: b.done, still: calm };
    setLive(true);
  };
  const tick = (t: number) => {
    const b = beatAt(t);
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
    renderer.setPixelRatio(lease.maxDpr);
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
    resync();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  document.addEventListener('visibilitychange', sync);
  media.addEventListener('change', resync);

  return () => {
    sub?.();
    sub = null;
    io.disconnect();
    ro.disconnect();
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    document.removeEventListener('visibilitychange', sync);
    media.removeEventListener('change', resync);
    setLive(false);
    v.dispose?.();
    disposeTree(v.scene);
    lease.release();
    holder.remove();
    const mem = renderer.info.memory;
    sceneStats.left = { geometries: mem.geometries, textures: mem.textures, programs: renderer.info.programs?.length ?? 0 };
  };
}
