import * as THREE from 'three';
import { SCENE } from '../motion/tokens';
import { NO_WEBGL, sceneStats } from './stats';

/**
 * One WebGL renderer for the companion's small 3D scenes, lent to one scene at a time. Its canvas moves into whichever
 * element borrows it, so going in and out of a 3D screen reuses one WebGL context instead of making a new one each
 * time. When nothing has borrowed it for SCENE.idleMs it is disposed and its context released.
 */
/** Phones draw at most 1.5 device pixels per CSS pixel; bigger screens at most 2. */
const DPR_TOUCH = 1.5;
const DPR_FINE = 2;

/**
 * The pixel ratio this device's scenes draw at, once one of them found the full ratio too slow, and the lowest ratio
 * found too slow so far (never climbed back to). Kept for the whole visit, across scenes and renderers: the device
 * doesn't get faster. See runtime.
 */
export const deviceDpr = { now: NaN, tooSlow: Infinity };

interface Shared {
  renderer: THREE.WebGLRenderer;
  holder: { evict: () => void } | null;
  idle: number;
}
let shared: Shared | null = null;

export interface Lease {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  /** the device pixel ratio cap for this device */
  readonly maxDpr: number;
  release(): void;
}

function create(): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  // asked for here first, so a device without WebGL 2 is a quiet "no" instead of an error from three.js
  const context = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' });
  if (!context) throw Object.assign(new Error('WebGL 2 is not available'), { name: NO_WEBGL });
  const renderer = new THREE.WebGLRenderer({ canvas, context });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.setClearColor(0x07080f, 1);
  sceneStats.contexts++;
  return renderer;
}

function drop(s: Shared) {
  if (shared === s) shared = null;
  const lost = s.renderer.getContext().isContextLost();
  s.renderer.dispose();
  if (!lost) s.renderer.forceContextLoss();
  s.renderer.domElement.remove();
  sceneStats.contexts--;
}

function free() {
  if (shared && !shared.holder) drop(shared);
}

/**
 * Lends the renderer to `host`. A scene still holding it is told to stop through its `onEvict`. Throws when this device
 * can't make a WebGL context.
 */
export function lendRenderer(host: HTMLElement, onEvict: () => void): Lease {
  // a lost context is never lent: a scene still holding it stops, and a new renderer takes its place
  if (shared?.renderer.getContext().isContextLost()) {
    const s = shared;
    const before = s.holder;
    s.holder = null;
    window.clearTimeout(s.idle);
    before?.evict();
    drop(s);
  }
  shared ??= { renderer: create(), holder: null, idle: 0 };
  const s = shared;
  window.clearTimeout(s.idle);
  const before = s.holder;
  const me = { evict: onEvict };
  s.holder = me;
  before?.evict();
  const { renderer } = s;
  const canvas = renderer.domElement;
  host.append(canvas);
  const touch = matchMedia('(pointer: coarse)').matches;
  return {
    renderer,
    canvas,
    maxDpr: Math.min(window.devicePixelRatio || 1, touch ? DPR_TOUCH : DPR_FINE),
    release() {
      if (s.holder !== me) return;
      s.holder = null;
      canvas.remove();
      renderer.renderLists.dispose();
      renderer.info.reset();
      if (shared === s) s.idle = window.setTimeout(free, SCENE.idleMs);
    },
  };
}
