/**
 * The companion's calm 3D scenes, all through this one host.
 *
 *   const unmount = mountScene(stage, { kind: 'drift', clock, accent?, reduced? });
 *
 * puts the scene into `stage` (any positioned element) and returns the function that takes it down and frees it.
 * Adding a scene is one file, scenes/<kind>.ts, exporting `build: BuildScene` (see ./runtime), plus one line in SCENES.
 *
 * This file loads with the companion and only decides and waits; the shared renderer, the loop and every three.js
 * object live in ./runtime and the scene files, fetched the first time a scene is needed. The flat picture stays
 * underneath: mark it `dq-scene-flat` and it hides while the scene loads (`is-scene-wait` on the stage, at most
 * SCENE.waitMs) and while it is live (`is-scene-live`), and shows with no WebGL, while the context is lost, and if
 * loading fails. Scenes draw only while on screen and the page is visible, at most SCENE.fps frames a second, and only
 * when their clock ticks; with reduced motion they draw one still frame.
 */
import { SCENE } from '../../motion/tokens';
import type { BuildScene } from './runtime';
import './scenes.css';

const SCENES = {
  drift: () => import('./scenes/drift'),
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
  /** the game's motion setting; prefers-reduced-motion when left out */
  reduced?: () => boolean;
}

export function mountScene(stage: HTMLElement, opts: SceneOpts): () => void {
  let gone = false;
  let off: (() => void) | null = null;
  stage.classList.add('is-scene-wait');
  const wait = setTimeout(() => stage.classList.remove('is-scene-wait'), SCENE.waitMs);
  Promise.all([import('./runtime'), SCENES[opts.kind]()])
    .then(([runtime, { build }]) => (gone ? () => {} : runtime.runScene(stage, build, opts)))
    .then((stop) => {
      if (gone) stop();
      else off = stop;
    })
    .catch((err) => console.warn('[scene] the 3D scene did not start; the flat picture stays', err))
    .finally(() => {
      if (!off) {
        clearTimeout(wait);
        stage.classList.remove('is-scene-wait');
      }
    });
  return () => {
    gone = true;
    clearTimeout(wait);
    off?.();
    off = null;
    stage.classList.remove('is-scene-wait', 'is-scene-live');
  };
}
