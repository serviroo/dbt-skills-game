import type { BusLevels } from './bus-levels';
import type { Curve, TrackedGain } from './curve';
import { dB } from './dsp';
import { Moment } from './moment';
import type { Music } from './music';

export const CUE_NAMES = [
  'gate_air', 'gate_crack', 'gate_swell', 'ui_open', 'ui_close', 'ui_tap', 'level_tick', 'level_ring', 'level_resolve',
  'eye_swell', 'whoosh', 'awaken_voice', 'awaken_hit', 'riser', 'soldier_ignite', 'stand_swell', 'chest_rise',
  'chest_burst', 'reward_chime', 'letter_open', 'endcard', 'card_flip', 'soft_chime', 'bubble', 'breath_in',
  'breath_out', 'check',
] as const;
export type CueName = (typeof CUE_NAMES)[number];

export interface PlayOpts {
  /** Context time (seconds). Defaults to now. */
  at?: number;
  /** Linear gain multiplier on the cue's designed level. */
  gain?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Transposition in cents (every oscillator and filter in the cue). */
  detune?: number;
  /** breath_in / breath_out length in seconds. */
  dur?: number;
  /** Variation step (e.g. the count-up tick number): rises 50 cents per step when detune is not given. */
  index?: number;
}

export interface CueHandle {
  stop(at?: number, ramp?: number): void;
  readonly end: number;
}

/** Cues the score makes room for. */
const UI_DUCK = new Set<string>(['ui_open', 'reward_chime', 'level_resolve', 'letter_open']);

export function cueMoment(host: {
  moment: Moment; cue: string; opts: PlayOpts; lifted: boolean; music: Music; shelf: AudioParam;
  duck: Curve; levels: BusLevels;
  toFocus(v: number, back: number): void;
  makeRoom(at: number, db: number, tau: number, back: number, tauBack: number): void;
}): boolean {
  const { moment, cue, opts, lifted, music, shelf, duck, levels } = host;
  if (UI_DUCK.has(cue)) {
    moment.add(0, (start) => levels.set(duck, dB(-3), start, 0.012), duck);
    moment.add(0.28, (start) => levels.set(duck, 1, start + 0.28, 0.16, false), duck);
  }
  // paced breathing: the score steps back for the whole exercise (each cue extends the dip; it lifts after the last)
  if (cue === 'breath_in' || cue === 'breath_out') {
    host.toFocus(dB(-6.5), Math.max(opts.dur ?? 0, 10) + 0.4);
  }
  // the important (level) window: the score's low end lifts +5 dB while it is open, not a louder chime
  const opening = cue === 'ui_open' && opts.detune === 500;
  const closing = cue === 'ui_close' && lifted;
  if (opening || closing) {
    moment.add(0, (start) => music.lift(opening ? 5 : 0, opening ? 0.3 : 0.4, start), shelf);
  }
  // inside the roar wall the score and the vortex make room: -3 dB under the ignition, and a -2 dB held breath while
  // the stand-up swell rises, released on the stand itself (~1.05 s after the swell starts)
  if (cue === 'soldier_ignite') host.makeRoom(0, -3, 0.03, 0.5, 0.3);
  else if (cue === 'stand_swell') host.makeRoom(0.12, -2, 0.2, 1.04, 0.004);
  return opening ? true : closing ? false : lifted;
}

export function roomMoment(
  levels: BusLevels, gain: TrackedGain, at: number, db: number, tau: number, back: number, tauBack: number, supplied?: Moment,
) {
  const p = gain.curve;
  const moment = supplied ?? new Moment();
  moment.add(at, (start) => levels.set(p, dB(db), start + at, tau), p);
  moment.add(back, (start) => levels.set(p, 1, start + back, tauBack, false), p);
  if (!supplied) {
    moment.prepare();
    moment.place(0);
  }
}

export function focusMoment(
  levels: BusLevels, gain: TrackedGain, v: number, at: number, tau: number, back?: number, moment?: Moment,
) {
  const p = gain.curve;
  if (moment) {
    moment.add(at, (start) => levels.set(p, v, start + at, tau), p);
    if (back !== undefined) moment.add(back, (start) => levels.set(p, 1, start + back, 0.8, false), p);
  } else {
    levels.set(p, v, at, tau);
    if (back !== undefined) levels.set(p, 1, back, 0.8, false);
  }
}
