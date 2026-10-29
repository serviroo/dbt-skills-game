/**
 * The breath Give me a moment's ring and the 3D breathing light share, in seconds: in for 4, out for 6, and 2.4 to
 * settle once a timed moment ends.
 */
const INHALE = 4;
const EXHALE = 6;
export const SETTLE = 2.4;

/** 0..1 with a soft start and a soft end, the way the breath and its settling move */
export const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

/** 0..1 breath size `e` seconds in: rises over 4 s, falls over 6 s */
export const breathAt = (e: number) => {
  const c = ((e % (INHALE + EXHALE)) + INHALE + EXHALE) % (INHALE + EXHALE);
  return c < INHALE ? ease(c / INHALE) : 1 - ease((c - INHALE) / EXHALE);
};
