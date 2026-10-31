import { FPS, SCORE } from '../motion/tokens';

/** Slider position (0..1) to gain: a squared taper, so the middle of the slider sounds like the middle. */
export const taper = (p: number) => {
  const x = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 1;
  return x * x;
};

/** Cancels what is scheduled from `t` on and holds the value automation gives at `t`, so a new ramp starts there. */
export function holdAt(p: AudioParam, t: number) {
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else {
    // without cancelAndHoldAtTime (Firefox): the getter's value, as of the last rendered block
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
  }
}

/**
 * The audio time for a sound or change asked for now: SCORE.leadSec past the clock, or an audio callback (baseLatency)
 * and a frame where one callback is longer than a frame. The audio thread renders up to a whole callback ahead of the
 * clock, so a time closer than that can pass while a busy page is still placing the sound: it would start late with its
 * attack cut, or not at all once its stop had passed too. A context that isn't running renders nothing until it resumes
 * from its clock (an offline render is suspended whenever it is fed), so it gets the clock itself.
 */
export function soon(ctx: BaseAudioContext) {
  if (ctx.state !== 'running') return ctx.currentTime;
  return ctx.currentTime + Math.max(SCORE.leadSec, ((ctx as AudioContext).baseLatency || 0) + 1 / FPS);
}
