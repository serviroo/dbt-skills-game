/** The slow breath Give me a moment's ring and the 3D breathing light share, on the BREATH timings. */
import { BREATH } from './tokens';

const CYCLE = BREATH.inSec + BREATH.outSec;
/** seconds the breath takes to settle once a timed moment ends */
export const SETTLE = BREATH.settleSec;

/** 0..1 with a soft start and a soft end, the way the breath and its settling move */
export const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

/** 0..1 breath size `e` seconds in: rises over BREATH.inSec, falls over BREATH.outSec */
export const breathAt = (e: number) => {
  const c = ((e % CYCLE) + CYCLE) % CYCLE;
  return c < BREATH.inSec ? ease(c / BREATH.inSec) : 1 - ease((c - BREATH.inSec) / BREATH.outSec);
};
