import { dB } from './dsp';
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

/** Cues the score makes room for. */
const UI_DUCK = new Set<string>(['ui_open', 'reward_chime', 'level_resolve', 'letter_open']);

export function cueMoment(host: {
  cue: string; opts: PlayOpts; lifted: boolean;
  lift(opening: boolean): void;
  duck(): void;
  toFocus(v: number, back: number): void;
  makeRoom(at: number, db: number, tau: number, back: number, tauBack: number): void;
}): boolean {
  const { cue, opts, lifted } = host;
  if (UI_DUCK.has(cue)) host.duck();
  // paced breathing: the score steps back for the whole exercise (each cue extends the dip; it lifts after the last)
  if (cue === 'breath_in' || cue === 'breath_out') {
    host.toFocus(dB(-6.5), Math.max(opts.dur ?? 0, 10) + 0.4);
  }
  // the important (level) window: the score's low end lifts +5 dB while it is open, not a louder chime
  const opening = cue === 'ui_open' && opts.detune === 500;
  const closing = cue === 'ui_close' && lifted;
  if (opening || closing) {
    host.lift(opening);
  }
  // inside the roar wall the score and the vortex make room: -3 dB under the ignition, and a -2 dB held breath while
  // the stand-up swell rises, released on the stand itself (~1.05 s after the swell starts)
  if (cue === 'soldier_ignite') host.makeRoom(0, -3, 0.03, 0.5, 0.3);
  else if (cue === 'stand_swell') host.makeRoom(0.12, -2, 0.2, 1.04, 0.004);
  return opening ? true : closing ? false : lifted;
}
