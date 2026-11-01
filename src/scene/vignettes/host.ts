/**
 * The companion's calm 3D scenes, all through this one host.
 *
 *   const unmount = mountScene(stage, { kind: 'drift', clock, reduced, onMotion, accent? });
 *
 * puts the scene into `stage` (any positioned element) and returns the function that takes it down and frees it.
 * Adding a scene is one file, scenes/<kind>.ts, exporting `build: BuildScene` (see ./runtime), plus one line in SCENES.
 *
 * This file loads with the companion and only decides and waits; the shared renderer, the loop and every three.js
 * object live in ./runtime and the scene files, fetched the first time a scene is needed. The flat picture stays
 * underneath: mark it `dq-scene-flat` and it hides while the scene loads (`is-scene-wait` on the stage, at most
 * SCENE.waitMs) and while it is live (`is-scene-live`), and shows with no WebGL (from the first frame, once this device
 * is known to have none), while the context is lost, and if loading fails. Scenes draw only while on screen, at most
 * SCENE.fps frames a second, and only when their clock ticks; with reduced motion they draw one still frame. A hidden
 * page holds no scene: it is taken down and lets the renderer go (its context is released after SCENE.idleMs), and is
 * built again at its beat once the page is back.
 */
import { SCENE } from '../../motion/tokens';
import { NO_WEBGL } from '../stats';
import type { BuildScene } from './runtime';
import './scenes.css';

const SCENES = {
  drift: () => import('./scenes/drift'),
  // the camp's figures are models, loaded before it is built
  camp: () => import('../watch/camp').then((m) => m.ready().then(() => m)),
  wave: () => import('./scenes/wave'),
  ring: () => import('./scenes/ring'),
  tide: () => import('./scenes/tide'),
  hands: () => import('./scenes/hands'),
  cold: () => import('./scenes/cold'),
} satisfies Record<string, () => Promise<{ build: BuildScene }>>;

export type SceneKind = keyof typeof SCENES;
export const hasScene = (kind: string): kind is SceneKind => kind in SCENES;

/** Where a scene's story is: seconds in, its length now, whether it started and whether it finished. */
export interface Beat {
  e: number;
  dur: number;
  started: boolean;
  done: boolean;
}

/**
 * The time a scene follows. A timer passes its own: onFrame ticks only while the countdown runs, so the scene pauses,
 * resumes and stretches with it. A screen without a story can pass the companion clock (src/daily/clock) as it is.
 */
export interface SceneClock {
  /** the time now in seconds, on the same clock as onFrame */
  now(): number;
  /** calls fn on every frame the clock runs; returns the function that stops it */
  onFrame(fn: (t: number) => void): () => void;
  /** the story's beat right now; without it the scene runs on the clock time alone */
  beat?(): Beat;
}

export interface SceneOpts {
  kind: SceneKind;
  clock: SceneClock;
  /** the rim light's colour, lantern blue (#4FB8FF) when left out */
  accent?: string;
  /** the game's motion setting */
  reduced: () => boolean;
  /** calls fn whenever that setting changes, here or in another open copy; returns the function that stops it */
  onMotion: (fn: () => void) => () => void;
  /** what the scene needs from its screen (the camp: who has arrived), handed to its build as it is */
  input?: unknown;
  /**
   * the longest the flat picture stays hidden while this scene loads, SCENE.waitMs when left out; Infinity keeps it
   * hidden until the scene draws or fails (the camp, whose flat picture is the roster under it, not in its place)
   */
  waitMs?: number;
}

/** The player's accent colour as the companion shows it (set on <html> by the Wardrobe), or undefined for lantern blue. */
export const playerAccent = () => getComputedStyle(document.documentElement).getPropertyValue('--acc-b').trim() || undefined;

/**
 * No WebGL 2 here: the browser has none, or this device couldn't make a context once already. The flat picture then
 * shows from the first frame on every visit, as it would without the scenes, instead of hiding while a scene tries.
 */
let flatOnly = typeof WebGL2RenderingContext === 'undefined';

export function mountScene(stage: HTMLElement, opts: SceneOpts): () => void {
  if (flatOnly) return () => {};
  let off: (() => void) | null = null;
  let wait = 0;
  /** a scene is wanted now; each start and stop moves `run` on, so a start still loading then stands down */
  let up = false;
  let run = 0;
  const start = () => {
    if (flatOnly) return;
    up = true;
    const me = ++run;
    stage.classList.add('is-scene-wait');
    const waitMs = opts.waitMs ?? SCENE.waitMs;
    wait = Number.isFinite(waitMs) ? window.setTimeout(() => stage.classList.remove('is-scene-wait'), waitMs) : 0;
    Promise.all([import('./runtime'), SCENES[opts.kind]()])
      .then(([runtime, { build }]) => (me === run ? runtime.runScene(stage, build, opts) : () => {}))
      .then((stop) => {
        if (me === run) off = stop;
        else stop();
      })
      .catch((err) => {
        if (err instanceof Error && err.name === NO_WEBGL) flatOnly = true;
        console.warn('[scene] the 3D scene did not start; the flat picture stays', err);
      })
      .finally(() => {
        if (me === run && !off) {
          clearTimeout(wait);
          stage.classList.remove('is-scene-wait');
        }
      });
  };
  const halt = () => {
    up = false;
    run++;
    clearTimeout(wait);
    off?.();
    off = null;
    stage.classList.remove('is-scene-wait', 'is-scene-live');
  };
  const onVisibility = () => {
    if (document.hidden) halt();
    else if (!up) start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  if (!document.hidden) start();
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    halt();
  };
}
