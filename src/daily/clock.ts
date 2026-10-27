/**
 * Time for the companion's moving parts (breathing ring, timers, bubbles).
 * Normal use: wall clock and one shared rAF loop that only runs while something is listening, so a still screen
 * costs nothing and the WebGL stage can be stopped while the companion is open.
 * Capture mode (?capture): follows the Stage clock through src/ui/anim.ts, so qa/capture.mjs renders exact frames.
 */
import { params } from '../core/params';
import { uiNow, wait as stageWait } from '../ui/anim';

type FrameFn = (t: number) => void;
const fns = new Set<FrameFn>();
let raf = 0;
let stageHooked = false;
let shown = 0;
// a hidden page gets no frames, so what fell due while it was out of sight is only drawn once it is back
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && (shown = now()));

export function now() {
  return params.capture ? uiNow() : performance.now() / 1000;
}

function loop() {
  raf = fns.size ? requestAnimationFrame(loop) : 0;
  const t = now();
  fns.forEach((f) => f(t));
}

/** When the page last came back into sight, on the now() clock (0 if it never left). */
export function backInSight() {
  return shown;
}

/** Calls fn every frame with the current time in seconds. Returns a stop function. */
export function onFrame(fn: FrameFn) {
  fns.add(fn);
  if (params.capture) {
    const st = (window as unknown as { __stage?: { onUpdate(f: () => void): () => void } }).__stage;
    if (st && !stageHooked) {
      stageHooked = true;
      st.onUpdate(() => {
        const t = now();
        fns.forEach((f) => f(t));
      });
    }
  } else if (!raf) raf = requestAnimationFrame(loop);
  return () => fns.delete(fn);
}

export function wait(sec: number) {
  if (params.capture) return stageWait(sec);
  return new Promise<void>((r) => setTimeout(r, sec * 1000));
}
