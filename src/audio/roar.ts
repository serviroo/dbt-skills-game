import { midi } from './dsp';
import { Choir, Hits, LONG, Pad, satBus, Strings } from './instruments';
import type { Voice } from './voice';

// brass and choir voiced around the Warden theme: none of them sits on a theme pitch in the theme's octave
// (D4 / F4 over Bb, E4 / G4 over C, A4 / D5 over Dm), so the horns read on top of the wall instead of inside it
export const prog: [number[], number[]][] = [
  [[34, 46, 53, 58, 70, 74, 77], [58, 70, 74]],
  [[36, 48, 55, 60, 72, 76, 79], [60, 72, 76]],
  [[38, 50, 57, 62, 65, 77, 81], [62, 65, 77]],
];
export const figs = [
  [58, 62, 65, 62, 70, 65, 62, 65, 58, 62, 65, 70, 74, 70, 65, 62],
  [60, 64, 67, 64, 72, 67, 64, 67, 60, 64, 67, 72, 76, 72, 67, 64],
  [62, 65, 69, 65, 74, 69, 65, 69, 62, 65, 69, 74, 77, 74, 69, 65],
];
// taiko groove over one bar of 16ths: [step, level]
export const groove: [number, number][] = [
  [0, 1], [3, 0.35], [6, 0.55], [8, 0.8], [10, 0.4], [11, 0.35], [12, 0.75], [14, 0.5], [15, 0.6],
];
// the Warden theme in horns and trombones (octaves): D-F over Bb, E-G over C, then A and the leap to D on the stand
export const theme = [[62, 65], [64, 67], [69, 74]];

export function roarParts(v: Voice, roar: AudioNode) {
  // the roar after the hit: built with the rest, held until the hit opens it
  const rp = v.part(v.wet);
  // brass and choir share a bus so the held breath before the stand can take them back without the horns' theme
  const wall = rp.gain(1, roar);
  const brass = new Pad(rp, 0, 7, {
    wave: 'brass', detune: 8, cutoff: 900, q: 0.9, level: 0.1, dest: wall, vib: 4, drive: 1.5,
  });
  const horns = new Strings(rp, 0, 2, {
    wave: 'brass', cutoff: 1800, q: 0.8, level: 0.3, dest: roar, vib: 5, presence: 5, body: 1250, hp: 80, width: 0.6,
    ens: 0.3, bite: 0,
  });
  const choir = new Choir(rp, 0, 3, 0.085, wall);
  const top = new Strings(rp, 0, 3, {
    wave: 'string', cutoff: 6500, level: 0, dest: roar, vib: 10, presence: 4, body: 3000, bow: 0.02,
  });
  const spBus = rp.filt('lowpass', 5500, 0.6, rp.filt('peaking', 2400, 1, rp.gain(1, roar), 3));
  const drums = rp.gain(1, v.wet);
  const dSat = satBus(rp, 1.8, drums);
  const thSat = satBus(rp, 2.2, roar);
  const hats = new Hits(rp, 0, 'white', rp.filt('highpass', 7500, 0.7, rp.pan(0.15, rp.gain(1, v.wet))));
  // suspended cymbal rolled with soft mallets (a ~13 Hz flutter on the wash), swelling into every chord change
  const roll = rp.gain(0.0012, rp.filt('highpass', 4800, 0.6, rp.pan(-0.15, v.wet)));
  const rm = rp.gain(0.75, roll);
  rp.lfo(13, 0.25, rm.gain, 0, LONG);
  const rn = rp.noise('white', 0, LONG, rm);
  rn.connect(rp.filt('bandpass', 8800, 2.5, rp.gain(0.8, rm)));
  const ped = rp.gain(0, v.dry);
  rp.osc('sine', midi(26), 0, LONG, ped);
  return { rp, wall, brass, horns, choir, top, spBus, drums, dSat, thSat, hats, roll, ped };
}
