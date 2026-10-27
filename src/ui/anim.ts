/**
 * UI timing that follows the Stage clock, so a deterministic capture (?capture) renders DOM animation frame-exact.
 * In normal playback WAAPI runs on the document timeline; in capture mode every animation is paused and scrubbed.
 */
import { params } from '../core/params';
import type { Stage } from '../core/stage';

type Tracked = { a: Animation; start: number; total: number };
const tracked = new Set<Tracked>();
let clockNow = () => performance.now() / 1000;
const waiters: { at: number; resolve: () => void }[] = [];

export function bindClock(now: () => number) {
  clockNow = now;
}

let realLoop = 0;
/** Switch UI timing to the page clock with its own light rAF loop (used when the WebGL stage is stopped). */
export function useRealClock() {
  if (params.capture || realLoop) return;
  const base = performance.now() / 1000 - clockNow();
  clockNow = () => performance.now() / 1000 - base;
  const loop = () => {
    realLoop = requestAnimationFrame(loop);
    tickUI();
  };
  realLoop = requestAnimationFrame(loop);
}

let stageTicks = false;
/** Switch UI timing to the Stage clock when the cinematic starts its frames; stage time carries on from the UI time. */
export function useStageClock(stage: Stage) {
  if (params.capture) return;
  cancelAnimationFrame(realLoop);
  realLoop = 0;
  stage.time = clockNow();
  clockNow = () => stage.time;
  if (!stageTicks) stage.onUpdate(() => tickUI());
  stageTicks = true;
}

export function uiNow() {
  return clockNow();
}

/** Called once per stage frame. */
export function tickUI() {
  const t = clockNow();
  if (params.capture) {
    for (const tr of tracked) {
      const local = (t - tr.start) * 1000;
      tr.a.currentTime = Math.max(0, Math.min(local, tr.total));
      if (local >= tr.total && tr.total !== Infinity) {
        tr.a.finish();
        tracked.delete(tr);
      }
    }
  }
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (t >= waiters[i].at) {
      const w = waiters[i];
      waiters.splice(i, 1);
      w.resolve();
    }
  }
}

export function animate(el: Element, frames: Keyframe[] | PropertyIndexedKeyframes, opts: KeyframeAnimationOptions) {
  const a = el.animate(frames, { fill: 'both', ...opts });
  if (params.capture) {
    a.pause();
    const delay = Number(opts.delay ?? 0);
    const dur = Number(opts.duration ?? 0);
    const it = opts.iterations ?? 1;
    const total = it === Infinity ? Infinity : delay + dur * Number(it);
    const tr = { a, start: clockNow(), total };
    tracked.add(tr);
    a.currentTime = 0;
  }
  return a;
}

/** Jumps an animation to its end state now and stops the capture clock from scrubbing it back. */
export function complete(a: Animation) {
  for (const tr of tracked) if (tr.a === a) tracked.delete(tr);
  if (a.effect?.getComputedTiming().endTime === Infinity) return;
  a.finish();
}

/** Resolves when the stage clock has advanced by `sec`. */
export function wait(sec: number) {
  return new Promise<void>((resolve) => waiters.push({ at: clockNow() + sec, resolve }));
}

/** Resolves `ms` from now on the page clock (the stage clock in captures): for DOM states that must not wait on 3D frames. */
export function after(ms: number) {
  if (params.capture) return wait(ms / 1000);
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function finished(a: Animation) {
  if (params.capture) {
    return new Promise<void>((resolve) => {
      const check = () => (a.playState === 'finished' || Number(a.currentTime ?? 0) >= Number(a.effect?.getComputedTiming().endTime ?? 0) - 1 ? resolve() : waiters.push({ at: clockNow() + 1 / 120, resolve: check }));
      check();
    });
  }
  return a.finished.then(() => undefined);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}
