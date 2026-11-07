import { dB, midi } from './dsp';
import { glide, soon } from './param';
import { Voice, kRate, openBuilt } from './voice';
import { figs, groove, prog, theme, roarParts } from './roar';
import { h01, Hits, LONG, Pad, satBus, Strings, waveOf } from './instruments';
import type { Section, SectionOpts, MusicHost } from './score-types';
export { SECTIONS, type Section, type SectionOpts, type MusicHost } from './score-types';

/** Mix trims per section, set from loudness measurements (cutscene about -18 LUFS integrated, every section audible
 *  through a phone-speaker band of 350 Hz-9 kHz, the roar the loudest music). */
const SECTION_GAIN: Record<Section, number> = { intro: dB(-3.5), windows: dB(-2.8), silhouette: dB(-4), awaken: dB(-3), reward: dB(-2.8), end: dB(-2.6), calm: dB(-14.2) };

function pluck(v: Voice, t: number, m: number, o: { peak: number; tau: number; cutoff: number; dest: AudioNode; wave?: OscillatorType | PeriodicWave; env?: number }) {
  const g = v.gain(0, o.dest);
  const end = v.perc(g.gain, t, o.peak, 0.004, o.tau);
  const lp = v.filt('lowpass', o.cutoff, 1.2, g);
  const cutoff = v.at(lp.frequency);
  cutoff.setValueAtTime(o.cutoff * (o.env ?? 3), t);
  cutoff.setTargetAtTime(o.cutoff, t, o.tau * 0.6);
  v.osc(o.wave ?? 'sawtooth', midi(m), t, end, lp);
}

/** Spiccato string note: bowed wave, 5 ms attack, short hold, fast release. Goes to a shared, filtered bus. */
function spic(v: Voice, t: number, m: number, peak: number, dest: AudioNode, tau = 0.05, hold = 0.04) {
  const g = v.gain(0, dest);
  const end = v.perc(g.gain, t, peak, 0.005, tau, hold);
  v.osc(waveOf(v.ctx, 'string'), midi(m), t, end, g);
}

function bell(v: Voice, t: number, m: number, peak: number, tau: number, dest: AudioNode, pan = 0) {
  v.fm({ t, f: midi(m), ratio: 2, index: 0.7, idxEnd: 0.05, idxTau: 0.05, a: 0.006, tau, peak, dest: pan ? v.pan(pan, dest) : dest, partials: [[2.76, 0.07, tau * 0.2]] });
}

function thump(v: Voice, t: number, peak: number, f0 = 70, f1 = 44, dest: AudioNode = v.dry, sat?: AudioNode) {
  const g = v.gain(0, sat ?? satBus(v, 2.2, dest));
  const end = v.perc(g.gain, t, peak, 0.004, 0.11);
  const o = v.osc('sine', f0, t, end + 0.05, g);
  const pitch = v.at(o.frequency);
  pitch.setValueAtTime(f0, t);
  pitch.exponentialRampToValueAtTime(f1, t + 0.16);
}

/** Heartbeat: the felt low thump plus a muffled knock (saturated 170 Hz) that a phone speaker can carry. */
function heart(v: Voice, t: number, peak: number, buses: { low: AudioNode; knock: AudioNode }) {
  thump(v, t, peak, 64, 42, undefined, buses.low);
  const g = v.gain(0, buses.knock);
  const e = v.perc(g.gain, t, peak * 2.4, 0.003, 0.035);
  const o = v.osc('triangle', 170, t, e, g);
  const pitch = v.at(o.frequency);
  pitch.setValueAtTime(170, t);
  pitch.exponentialRampToValueAtTime(105, t + 0.08);
}

function heartBuses(v: Voice, dest: AudioNode = v.dry, low = 1) {
  return { low: satBus(v, 2.2, dest, low), knock: satBus(v, 3, v.filt('lowpass', 1400, 0.6, dest), 0.8) };
}

/** Taiko: a pitched membrane (fast drop), an inharmonic second mode for the 'tok', an air thump and a stick slap. */
function taiko(v: Voice, t: number, peak: number, dest: AudioNode, o: { f0?: number; f1?: number; slap?: number; dec?: number; sat?: AudioNode } = {}) {
  const f0 = o.f0 ?? 88;
  const f1 = o.f1 ?? 54;
  const dec = o.dec ?? 0.2;
  const g = v.gain(0, o.sat ?? satBus(v, 1.8, dest));
  const end = v.perc(g.gain, t, peak, 0.0015, dec);
  const b = v.osc('sine', f0 * 1.4, t, end, g);
  const pitch = v.at(b.frequency);
  pitch.setValueAtTime(f0 * 1.4, t);
  pitch.exponentialRampToValueAtTime(f0, t + 0.012);
  pitch.exponentialRampToValueAtTime(f1, t + 0.18);
  const g2 = v.gain(0, dest);
  const e2 = v.perc(g2.gain, t, peak * 0.3, 0.001, dec * 0.3);
  const m2 = v.osc('triangle', f0 * 2.3, t, e2, g2);
  const tok = v.at(m2.frequency);
  tok.setValueAtTime(f0 * 2.5, t);
  tok.exponentialRampToValueAtTime(f1 * 2.3, t + 0.12);
  const ng = v.gain(0, v.filt('lowpass', 300, 0.7, dest));
  v.perc(ng.gain, t, peak * 1.2, 0.002, dec * 0.45);
  v.noise('brown', t, t + dec * 4, ng);
  const sg = v.gain(0, v.filt('bandpass', 1500, 0.8, dest));
  v.perc(sg.gain, t, peak * 1.3 * (o.slap ?? 1), 0.0008, 0.02);
  v.noise('white', t, t + 0.2, sg);
}

/** Low cinematic piano: two slightly detuned unison strings, stretched partials that die faster as they rise, a hammer. */
function lowPiano(v: Voice, t: number, m: number, peak: number, dest: AudioNode) {
  const f = midi(m);
  const parts: [number, number, number, number][] = [[1, 0.7, 2.4, -0.7], [1, 0.6, 2.2, 0.8], [2.003, 0.42, 1.3, 0], [3.009, 0.26, 0.8, 0], [4.02, 0.16, 0.45, 0], [5.04, 0.09, 0.28, 0], [6.07, 0.05, 0.18, 0]];
  for (const [r, a, tau, det] of parts) {
    const g = v.gain(0, dest);
    const level = v.at(g.gain);
    level.setValueAtTime(0, t);
    level.linearRampToValueAtTime(peak * a, t + 0.003);
    level.setTargetAtTime(0, t + 0.003, tau);
    // past -26 dB the partial is buried under the reverb: fade it in 0.2 s and free the oscillator
    const fe = t + 0.003 + tau * 3;
    level.setTargetAtTime(0, fe, 0.05);
    const o = v.osc('sine', f * r, t, fe + 0.4, g);
    if (det) o.detune.value = v.cents + det;
  }
  const h = v.gain(0, v.filt('lowpass', 1100, 0.7, dest));
  v.perc(h.gain, t, peak * 0.5, 0.001, 0.012);
  v.noise('pink', t, t + 0.12, h);
}

/** Reversed-cymbal swell: high noise rising exponentially, cut dead at t1. */
function revSwell(v: Voice, t0: number, t1: number, peak: number, dest: AudioNode, hp = 3000) {
  const g = v.gain(0, v.filt('highpass', hp, 0.6, dest));
  v.ramp(g.gain, t0, peak * 0.01, peak, t1 - t0);
  v.at(g.gain).setTargetAtTime(0, t1, 0.01);
  v.noise('white', t0, t1 + 0.12, g);
}

/** Timpani roll on D: a low drum body fluttering at ~15 strokes/s, swelling exponentially and cut on t1 (the hit). */
function timpRoll(v: Voice, t0: number, t1: number, peak: number, dest: AudioNode) {
  const g = v.gain(0, dest);
  v.ramp(g.gain, t0, peak * 0.03, peak, t1 - t0);
  v.at(g.gain).setTargetAtTime(0, t1, 0.012);
  const am = v.gain(0.55, g);
  v.lfo(15, 0.45, am.gain, t0, t1 + 0.1);
  v.osc('sine', midi(38), t0, t1 + 0.1, am);
  v.noise('brown', t0, t1 + 0.1, v.gain(1.3, v.filt('lowpass', 240, 0.7, am)));
}

/** Cymbal crash: broadband air with a long decay. */
function crash(v: Voice, t: number, peak: number, dest: AudioNode) {
  const g = v.gain(0, v.filt('highpass', 3600, 0.6, dest));
  const level = v.at(g.gain);
  level.setValueAtTime(0, t);
  level.linearRampToValueAtTime(peak, t + 0.002);
  level.setTargetAtTime(0, t + 0.002, 0.75);
  v.noise('white', t, t + 4.6, g);
  const s = v.gain(0, v.filt('bandpass', 7000, 0.6, dest));
  v.perc(s.gain, t, peak * 0.6, 0.002, 0.25);
  v.noise('white', t, t + 2, s);
}

/** Calls fn for each grid point start + i*period inside [from, to). */
function grid(start: number, period: number, from: number, to: number, fn: (i: number, t: number) => void) {
  let i = Math.max(0, Math.ceil((from - start) / period - 1e-9));
  for (let t = start + i * period; t < to; i++, t = start + i * period) fn(i, t);
}

/**
 * Pattern steps: for every period starting at start + i*period, calls fn for each offset whose time falls in
 * [from, to). Periods that began before `from` still deliver their later steps (live windows are ~0.12 s wide).
 */
function steps(start: number, period: number, from: number, to: number, offs: number[], fn: (i: number, k: number, t: number) => void) {
  grid(start, period, from - period, to, (i, tb) => {
    for (let k = 0; k < offs.length; k++) {
      const t = tb + offs[k];
      if (t >= from && t < to) fn(i, k, t);
    }
  });
}

/** Calls fn once if t falls inside [from, to). */
function once(t: number, from: number, to: number, fn: (t: number) => void) {
  if (t >= from && t < to) fn(t);
}

interface SectionImpl {
  tick(from: number, to: number): void;
  hush?(at: number): void;
  arm?(cue?: Voice): Voice | undefined;
  hit?(at: number, dropped: boolean): void;
  opened?(until: number): void;
}
type Factory = (v: Voice, o: SectionOpts, host: MusicHost) => (start: number) => SectionImpl;

const BEAT = 60 / 72;
const BAR = BEAT * 4;

// D minor world (cutscene) and D major world (reward, end, calm). Voicings low to high.
const Dm9 = [38, 50, 57, 62, 65, 76];
const Bbmaj7 = [34, 46, 53, 62, 65, 69];
const Gm9 = [43, 50, 58, 62, 65, 69];
const Asus = [45, 52, 57, 62, 64, 69];
const Dadd9 = [38, 50, 57, 62, 64, 66];
const Gmaj9 = [43, 50, 59, 62, 66, 69];
const Bm7 = [47, 54, 57, 62, 66, 69];
const Aadd9 = [45, 52, 57, 61, 64, 71];

/** Spiccato figures per chord (D minor cycle), one bar of 8ths. */
const FIG_MINOR = [
  [62, 65, 69, 65, 74, 69, 65, 69],
  [58, 62, 65, 62, 70, 65, 62, 65],
  [55, 58, 62, 58, 67, 62, 58, 62],
  [57, 61, 64, 61, 69, 64, 61, 64],
];
/** Harp figures per chord (D major cycle), rising then turning. */
const FIG_MAJOR = [
  [62, 66, 69, 74, 76, 74, 69, 66],
  [55, 62, 66, 71, 74, 71, 66, 62],
  [59, 62, 66, 71, 73, 71, 66, 62],
  [57, 61, 64, 69, 71, 69, 64, 61],
];

const FACTORIES: Record<Section, Factory> = {
  /** Void and gate: a dark Dm9 / Bbmaj7 string pad breathing slowly over a deep D, the distant F6 (~1.4 kHz) pulse on
   *  the beat; once the gate tears (~1.9 s in) high harmonics open up above it like cold air. */
  intro(v) {
    const str = new Strings(v, 0, 6, { wave: 'warm', cutoff: 950, q: 0.8, lfo: [0.06, 200], level: 0.12, dest: v.wet, vib: 11, presence: 2, bow: 0.012, hp: 50, weights: [1.1, 0.8, 0.9, 0.9, 0.9, 0.8] });
    const sub = v.gain(0, v.dry);
    v.osc('sine', midi(26), 0, LONG, sub);
    // the distant lead (reference: a quiet ~1.4 kHz tone with an ~11 Hz shimmer, far under the pad, never a beep)
    const lead = v.gain(0, v.filt('lowpass', 3600, 0.5, v.wet));
    const pulse = v.gain(0.55, lead);
    v.lfo(72 / 60, 0.45, pulse.gain, 0, LONG);
    v.osc('sine', midi(89), 0, LONG, pulse);
    v.osc('sine', midi(89), 0, LONG, v.gain(0.5, v.pan(0.25, pulse))).detune.value = v.cents + 14;
    v.osc('triangle', midi(81), 0, LONG, v.gain(0.45, lead)).detune.value = v.cents + 3;
    v.osc('sine', midi(77), 0, LONG, v.gain(0.3, v.pan(-0.3, lead)));
    const hi = new Strings(v, 0, 2, { wave: 'string', cutoff: 6000, level: 0, dest: v.wet, vib: 5, presence: 4, body: 3400 });
    const chords = [Dm9, Bbmaj7];
    const vel = [1, 0.4, 0.7, 0.4];
    v.at(sub.gain).setValueAtTime(0, 0);
    v.at(sub.gain).setTargetAtTime(0.09, 0, 0.6);
    v.at(lead.gain).setValueAtTime(0, 0);
    v.at(lead.gain).setTargetAtTime(0.008, 0.2, 0.8);
    v.at(hi.out.gain).setValueAtTime(0, 1.8);
    v.at(hi.out.gain).linearRampToValueAtTime(0.03, 5.5);
    hi.chord(0, [86, 93], { att: 0.05 });
    return (start) => {
      return {
        tick(from, to) {
          grid(start, BAR * 2, from, to, (i, t) => str.chord(t, chords[i % 2], { glide: 0.25, att: i ? 0.4 : 0.6, swell: BAR * 2 }));
          grid(start + BEAT * 2, BEAT, from, to, (i, t) => bell(v, t, 89, 0.028 * vel[i % 4], 0.13, v.wet, i % 2 ? 0.2 : -0.2));
        },
      };
    };
  },

  /** Lantern windows: strings move i-VI-iv-V over the Lantern pulse bed (115-230 Hz with an 8th-harmonic glint, gated in
   *  an irregular 'syllabic' loop), a spiccato figure joins after the first window settles, and a soft digital clock
   *  ticks in 16ths. */
  windows(v) {
    const str = new Strings(v, 0, 6, { wave: 'string', cutoff: 2700, q: 0.5, lfo: [0.07, 450], level: 0.085, dest: v.wet, vib: 15, presence: 1.5, bow: 0.014, hp: 100, weights: [0.5, 0.7, 1, 1, 1, 0.9] });
    const sub = v.gain(0.045, v.dry);
    const so = v.osc('sine', midi(26), 0, LONG, sub);
    const chords = [Dm9, Bbmaj7, Gm9, Asus];
    const roots = [50, 46, 55, 45];
    const pings = [89, 89, 86, 88];
    const pat: [number, number, number][] = [[0, 0.28, 1], [0.5, 0.1, 0.55], [0.75, 0.1, 0.5], [1.5, 0.22, 0.85], [2, 0.12, 0.6], [2.25, 0.08, 0.45], [2.75, 0.2, 0.8], [3.25, 0.1, 0.55], [3.5, 0.06, 0.4], [3.75, 0.06, 0.4]];
    const offs = pat.map(([b]) => b * BEAT);
    const pulseBus = v.gain(1, v.filt('lowpass', 1800, 0.7, v.wet));
    const spBus = v.gain(0, v.filt('lowpass', 6500, 0.6, v.filt('peaking', 2500, 1, v.wet, 3)));
    const clock = new Hits(v, 0, 'white', v.filt('highpass', 6500, 0.7, v.pan(0.22, v.gain(1, v.wet))));
    const acc = [1, 0.3, 0.55, 0.3];
    v.at(spBus.gain).setValueAtTime(0, BAR * 0.75);
    v.at(spBus.gain).linearRampToValueAtTime(0.7, BAR * 1.25);
    v.at(spBus.gain).linearRampToValueAtTime(1, BAR * 3);
    return (start) => {
      const ci = (t: number) => Math.floor((t - start + 1e-6) / (BAR * 2)) % 4;
      return {
        tick(from, to) {
          grid(start, BAR * 2, from, to, (i, t) => {
            str.chord(t, chords[i % 4], { glide: 0.25, att: 0.3, dip: i > 0, swell: BAR * 2 });
            v.at(so.frequency).setTargetAtTime(midi(26 + ((chords[i % 4][0] - 38 + 24) % 12)), t, 0.2);
          });
          steps(start, BAR, from, to, offs, (bi, k, t) => {
            const c = Math.floor(bi / 2) % 4;
            const [, d, a] = pat[k];
            const g = v.gain(0, pulseBus);
            v.at(g.gain).setValueAtTime(0, t);
            v.at(g.gain).linearRampToValueAtTime(0.036 * a, t + 0.012);
            v.at(g.gain).setValueAtTime(0.036 * a, t + d);
            v.at(g.gain).linearRampToValueAtTime(0, t + d + 0.05);
            v.osc('sine', midi(roots[c]), t, t + d + 0.06, g);
            v.osc('sine', midi(roots[c] + 36), t, t + d + 0.06, v.gain(0.12, g));
            v.osc('triangle', midi(roots[c] + 12), t, t + d + 0.06, v.gain(0.3, g));
          });
          grid(start + BAR, BEAT / 2, from, to, (i, t) => {
            // players, not a sequencer: a few ms of push and pull and uneven bow weight on every note
            const a = (i % 8 === 0 ? 1 : i % 2 ? 0.55 : 0.75) * (0.88 + 0.24 * h01(i, 21));
            spic(v, t + (h01(i, 22) - 0.5) * 0.009, FIG_MINOR[ci(t)][i % 8], 0.085 * a, spBus);
          });
          grid(start + BAR * 0.5, BEAT / 4, from, to, (i, t) => clock.hit(t, 0.075 * acc[i % 4], 0.011));
          grid(start + BEAT, BEAT * 2, from, to, (i, t) => bell(v, t, pings[ci(t)], i % 2 ? 0.011 : 0.016, 0.13, v.wet, i % 2 ? 0.25 : -0.25));
        },
      };
    };
  },

  /** Tension under the silhouette and the push-in: an open D/A drone, a low piano tolling every two bars, a heartbeat
   *  that tightens, a clock that starts ticking, a sul-ponticello cluster growing high above, a cello line creeping a
   *  semitone (A - Bb - A) under a cold bowed-metal shimmer, muted low strings pulsing in 8ths from the push-in, and a
   *  reversed swell cut dead on the eye ignition (~12.0 s in). The last bar before it holds its breath (the clock
   *  thins out); at the ignition everything falls still and the cello arrives on D. */
  silhouette(v) {
    const drone = new Strings(v, 0, 3, { wave: 'string', cutoff: 1500, q: 0.9, lfo: [0.05, 260], level: 0.11, dest: v.wet, vib: 4, presence: 3, bow: 0.016, hp: 90 });
    const sub = v.gain(0.02, v.dry);
    v.osc('sine', midi(26), 0, LONG, sub);
    const cello = new Strings(v, 0, 2, { wave: 'string', cutoff: 2400, q: 0.7, level: 0, dest: v.wet, vib: 7, presence: 4, body: 1200, bow: 0.03, hp: 110, weights: [0.45, 1] });
    const line: [number, number, number][] = [[0.4, 57, 1.2], [BAR * 1.5, 58, 0.6], [BAR * 2.5, 57, 0.5], [12.9, 62, 0.8]];
    const shim = v.gain(0, v.wet);
    const sa = v.gain(0.7, shim);
    v.lfo(0.21, 0.3, sa.gain, 0, LONG);
    const sn = v.noise('white', 0, LONG, v.filt('bandpass', 4700, 18, sa));
    sn.connect(v.filt('bandpass', 6900, 22, v.gain(0.8, sa)));
    sn.connect(v.filt('lowpass', 10500, 0.7, v.filt('highpass', 6500, 0.7, v.gain(0.26, sa))));
    const tremBus = v.gain(0, v.wet);
    const trem = v.gain(0.55, tremBus);
    v.lfo(9, 0.45, trem.gain, 0, LONG);
    const hi = new Strings(v, 0, 2, { wave: 'string', cutoff: 6500, level: 1, dest: trem, vib: 3, presence: 5, body: 3300 });
    const clusters = [[74, 75], [73, 74]];
    const clock = new Hits(v, 0, 'white', v.filt('bandpass', 4200, 1.2, v.pan(-0.2, v.gain(1, v.wet))));
    const hb = heartBuses(v, v.dry, 0.7);
    const lowBus = v.gain(0, v.filt('lowpass', 1100, 0.7, v.wet));
    drone.chord(0, [38, 45, 50], { att: 0.3, glide: 0.01 });
    const IGN = 12.0;
    // the held breath: everything grows until 1.5 s before the ignition, then draws back ~6 dB under the reverse swell
    const HOLD = IGN - 1.5;
    v.at(cello.out.gain).setValueAtTime(0, 0);
    v.at(cello.out.gain).linearRampToValueAtTime(0.075, 0.4);
    v.at(cello.out.gain).exponentialRampToValueAtTime(0.12, HOLD);
    v.at(cello.out.gain).setTargetAtTime(0.055, HOLD, 0.35);
    v.at(cello.out.gain).setTargetAtTime(0.035, IGN - 0.02, 0.04);
    v.at(cello.out.gain).setTargetAtTime(0.08, IGN + 0.9, 0.7);
    v.at(shim.gain).setValueAtTime(0, 0);
    v.at(shim.gain).linearRampToValueAtTime(0.06, 0.8);
    v.at(shim.gain).exponentialRampToValueAtTime(0.28, HOLD);
    v.at(shim.gain).setTargetAtTime(0.14, HOLD, 0.35);
    v.at(shim.gain).setTargetAtTime(0.04, IGN - 0.02, 0.05);
    v.at(shim.gain).setTargetAtTime(0.12, IGN + 0.9, 0.8);
    v.at(tremBus.gain).setValueAtTime(0, 0);
    v.at(tremBus.gain).linearRampToValueAtTime(0.025, 0.5);
    v.at(tremBus.gain).exponentialRampToValueAtTime(0.11, HOLD);
    v.at(tremBus.gain).setTargetAtTime(0.05, HOLD, 0.35);
    v.at(lowBus.gain).setValueAtTime(0, BAR * 1.9);
    v.at(lowBus.gain).linearRampToValueAtTime(1, BAR * 3.0);
    // the eyes ignite ~12.0 s in: pulse, clock and heartbeat stop dead and the cluster drops back, so the ignition
    // swell speaks into stillness; the drone holds and the cluster breathes back in
    v.at(lowBus.gain).setTargetAtTime(0.5, HOLD, 0.35);
    v.at(lowBus.gain).setTargetAtTime(0, IGN - 0.02, 0.03);
    v.at(tremBus.gain).setTargetAtTime(0.02, IGN, 0.05);
    v.at(tremBus.gain).setTargetAtTime(0.05, IGN + 0.7, 0.5);
    v.at(drone.out.gain).setTargetAtTime(0.08, HOLD, 0.4);
    v.at(drone.out.gain).setTargetAtTime(0.05, IGN - 0.02, 0.03);
    v.at(drone.out.gain).setTargetAtTime(0.12, IGN + 1.0, 0.6);
    return (start) => {
      const [ignAt, breathAt] = [start + IGN, start + HOLD];
      return {
        tick(from, to) {
          grid(start, BAR * 2, from, to, (i, t) => {
            hi.chord(t, clusters[i % 2], { glide: 0.4, att: 0.5 });
            lowPiano(v, t + 0.02, 26, 0.065, v.wet);
            lowPiano(v, t + 0.026, 38, 0.065, v.wet);
            lowPiano(v, t + 0.031, 50, 0.05, v.wet);
          });
          for (const [dt, m, att] of line) once(start + dt, from, to, (t) => cello.chord(t, [m - 12, m], { att, glide: 0.08 }));
          grid(start, BEAT, from, to, (i, t) => {
            if (t - start < BAR * 1.6 && i % 2) return;
            if (t > ignAt - 0.35) return;
            const k = Math.min(1, (t - start) / (BAR * 3.4));
            const held = t > breathAt ? 0.6 : 1;
            heart(v, t, (0.07 + 0.04 * k) * held, hb);
            heart(v, t + 0.27, (0.05 + 0.025 * k) * held, hb);
          });
          grid(start + BAR, BEAT / 2, from, to, (i, t) => {
            if (t > ignAt - 0.02) return;
            const k = Math.min(1, (t - start - BAR) / (BAR * 2.4));
            const held = 0.45 + 0.55 * Math.min(1, Math.max(0, (ignAt - 0.1 - t) / 1.3));
            clock.hit(t, (i % 2 ? 0.1 : 0.16) * (0.45 + 0.55 * k) * held, 0.016);
          });
          grid(start + BAR * 2, BEAT / 2, from, to, (i, t) => {
            if (t < ignAt - 0.02) spic(v, t, i % 4 === 3 ? 50 : 38, i % 2 ? 0.07 : 0.1, lowBus, 0.07, 0.05);
          });
          once(start + 10.3, from, to, (t) => revSwell(v, t, ignAt, 0.05, v.wet, 2400));
        },
      };
    };
  },

  /** AWAKEN. Build (low drone rising, trembling strings, accelerating taiko heartbeat, a ticking clock, a reverse swell)
   *  that cuts dead into the 780 ms hush; then the roar on the hit: Bb - C - Dm over a D pedal (VI-VII-i), brass with
   *  a blat on every change, an 'ah' choir, spiccato strings and synth bass driving 16ths, a taiko groove, a reversed
   *  cymbal into the stand-up and a crash on it, where high strings take the top. */
  awaken(v, o, host) {
    const bv = v.child(v.wet, host.seed());
    const build = bv.gain(1, bv.wet);
    const dr = bv.gain(0, build);
    const dlp = bv.filt('lowpass', 260, 1.4, dr);
    for (const [m, d] of [[26, 0], [38, -6], [38, 7], [45, 4], [50, -3]] as const) {
      bv.osc(m === 26 ? 'sine' : 'sawtooth', midi(m), 0, LONG, bv.gain(m === 26 ? 0.8 : 0.5, dlp)).detune.value = v.cents + d;
    }
    const st = bv.gain(0, bv.filt('peaking', 3000, 0.9, bv.filt('lowpass', 8500, 0.6, build), 4));
    const tr = bv.gain(0.55, st);
    const trl = bv.lfo(6, 0.45, tr.gain, 0, LONG);
    // the players drift against each other (slow, unequal pitch wander), so the cluster shimmers instead of buzzing
    const drift = [0.23, 0.31].map((r) => {
      const g = bv.ctx.createGain();
      g.gain.value = 7;
      bv.osc('sine', r, 0, LONG, g);
      return g;
    });
    [[69, -4], [70, 5], [81, 3], [82, -6]].forEach(([m, d], k) => {
      const os = bv.osc('sawtooth', midi(m), 0, LONG, bv.gain(0.5, tr));
      os.detune.value = v.cents + d;
      kRate(os.detune);
      drift[k % 2].connect(os.detune);
    });
    const bSat = satBus(bv, 1.8, build);
    // low brass crescendo on D3 / A3 / D4 (the 150-500 Hz body of the build), opening and roughening as it grows
    const lb = new Pad(bv, 0, 3, { wave: 'brass', detune: 6, cutoff: 320, q: 1.0, level: 0, dest: build, vib: 3, drive: 1.6 });
    const roar = v.gain(1, v.filt('lowshelf', 160, 0.7, v.filt('peaking', 1300, 0.9, v.wet, -2.5), 3));
    let R = roarParts(v, roar);
    const grooveOffs = groove.map(([s]) => (s * BEAT) / 4);
    // Timing: with hitAt known (offline renders) everything is scheduled now. Live, the build runs until the
    // director calls hush() (build cuts dead) and plays awaken_hit (the roar starts on that exact moment).
    const hitIn = o.at !== undefined && o.hitAt !== undefined ? o.hitAt - o.at : Infinity;
    const nominal = hitIn !== Infinity ? Math.max(0.5, hitIn - 0.78) : 4.08;
    v.ramp(dr.gain, 0, 0.03, 0.1, nominal);
    v.ramp(dlp.frequency, 0, 260, 2600, nominal);
    const sAt = Math.min(nominal - 0.6, 1.85);
    v.at(st.gain).setValueAtTime(0, 0);
    v.at(st.gain).linearRampToValueAtTime(0.08, 0.4);
    v.ramp(st.gain, sAt, 0.08, 0.24, Math.max(0.3, nominal - sAt));
    v.at(trl.frequency).setValueAtTime(6, 0);
    v.at(trl.frequency).linearRampToValueAtTime(12, nominal);
    const rv = bv.gain(0, build);
    const rs = Math.max(0, nominal - 1.7);
    v.ramp(rv.gain, rs, 0.002, 0.2, nominal - rs);
    const rb = bv.filt('bandpass', 400, 0.9, rv);
    v.ramp(rb.frequency, rs, 380, 3400, nominal - rs);
    bv.noise('pink', rs, LONG, rb);
    const cym = bv.gain(0, bv.filt('lowpass', 11000, 0.6, bv.filt('highpass', 4000, 0.6, build)));
    v.ramp(cym.gain, rs, 0.0008, 0.07, nominal - rs);
    bv.noise('white', rs, LONG, cym);
    const clock = new Hits(bv, 0, 'white', bv.filt('bandpass', 4600, 1.1, bv.pan(0.2, build)));
    lb.chord(0, [50, 57, 62], 0.01);
    v.at(lb.out.gain).setValueAtTime(0, 0);
    v.at(lb.out.gain).linearRampToValueAtTime(0.018, 0.2);
    v.at(lb.out.gain).exponentialRampToValueAtTime(0.3, Math.max(0.5, nominal));
    v.ramp(lb.lp.frequency, 0.2, 320, 2400, Math.max(0.3, nominal - 0.2));
    if (o.at !== undefined && o.hitAt !== undefined) {
      bv.at(build.gain, true).setTargetAtTime(0, o.hitAt - 0.78, 0.006);
      bv.stop(o.hitAt - 0.78, 0.024);
    }
    return (start) => {
      let hitAt = o.hitAt ?? start + hitIn;
      let cutAt = hitAt - 0.78;
      const cut = (at: number) => {
        if (cutAt !== Infinity && at >= cutAt) return;
        cutAt = at;
        build.gain.setTargetAtTime(0, at, 0.006);
        bv.stop(at, 0.024);
      };
      let nextBeat = start + 0.6;
      let gap = 1.0;
      let roarTo = -Infinity;
      let stand = o.standAt !== undefined && o.hitAt !== undefined ? o.standAt - o.hitAt : 7.04;
      let armed = false;
      let hitPlayed = false;
      const placeFirstChord = (at: number) => {
        if (o.standAt !== undefined) stand = o.standAt - at;
        if (armed) return;
        armed = true;
        swellPedal(0);
        roarNotes(0, 0, BEAT / 4);
      };
      return {
        hush(at: number) {
          if (hitAt === Infinity) cut(at);
        },
        opened: (until: number) => {
          if (o.at !== undefined && o.hitAt !== undefined) host.hush(o.hitAt - 0.78, o.hitAt);
          roarTick(soon(host.lib.ctx), until);
        },
        arm(cue?: Voice) {
          if (hitPlayed) return;
          roarTo = -Infinity;
          if (!R.rp.isHeld && !R.rp.isStopped) R.rp.stop(soon(host.lib.ctx), 0);
          if (R.rp.isStopped) [R, armed] = [roarParts(v, roar), false];
          if (cue) cue.ride(R.rp, placeFirstChord);
          return R.rp;
        },
        hit(at: number, dropped: boolean) {
          if (hitPlayed) return;
          hitPlayed = !dropped;
          cut(dropped ? at : Math.max(at, soon(host.lib.ctx)));
          if (dropped) R.rp.stop(at, 0);
          [hitAt, roarTo] = [dropped ? Infinity : at, dropped ? Infinity : at + BEAT / 4];
        },
        tick(from, to) {
          const bEnd = Math.min(to, cutAt - 0.12, hitAt - 0.12);
          while (nextBeat < bEnd) {
            if (nextBeat >= from) {
              const k = Math.min(1, (nextBeat - start) / nominal);
              taiko(bv, nextBeat, 0.08 + 0.1 * k, build, { f0: 70, f1: 46, slap: 0.5 + 0.5 * k, dec: 0.22, sat: bSat });
            }
            nextBeat += gap;
            gap = Math.max(0.36, gap * 0.86);
          }
          grid(start + BEAT, BEAT / 4, from, bEnd, (i, t) => {
            const k = Math.min(1, (t - start) / nominal);
            clock.hit(t, (i % 2 ? 0.045 : 0.075) * (0.5 + 0.5 * k), 0.014);
          });
          // the roar keeps its own place in the score: it goes on from where it got to, dropping only what is behind soon()
          roarTick(soon(host.lib.ctx), to);
        },
      };
      function roarTick(after: number, to: number) {
        if (!hitPlayed || v.isHeld || !(to > Math.max(hitAt, after))) return;
        const from = Math.max(hitAt, roarTo, after);
        if (!(to > from)) return;
        roarTo = to;
        roarNotes(hitAt, from, to);
      }
      function swellPedal(t: number) {
        const { rp, ped } = R;
        const pedal = rp.at(ped.gain);
        pedal.setValueAtTime(0, t);
        pedal.setTargetAtTime(0.11, t, 0.2);
      }
      function roarNotes(base: number, from: number, to: number) {
        const { rp, wall, brass, horns, choir, top, spBus, drums, dSat, thSat, hats, roll } = R;
        const standAt = rp.isHeld ? base + stand : o.standAt ?? base + stand;
        const B = Math.max(1.5, stand / 2);
        grid(base, B, from, to, (i, t) => {
          const k = i < 3 ? i : (i - 3) % 3;
          const [notes, tp] = prog[k];
          brass.chord(t, notes, 0.03, i === 2 ? [1.4, 1.3, 1, 1, 1, 1, 1] : undefined, i === 2 ? 1.5 : i > 0 ? 1 : 0.6);
          choir.chord(t, tp);
          const lp = rp.at(brass.lp.frequency);
          lp.setTargetAtTime(i === 2 ? 3200 : 3000, t, 0.03);
          lp.setTargetAtTime(i === 2 ? 2300 : 2200, t + 0.35, 0.5);
          if (i < 3) {
            const [a, b] = theme[i];
            const t2 = t + B * (i === 2 ? 0.35 : 0.62);
            const hl = rp.at(horns.lp.frequency);
            for (const [tt, m] of [[t, a], [t2, b]]) {
              horns.chord(tt, [m - 12, m], { dip: true, att: 0.07, glide: 0.04 });
              hl.setTargetAtTime(3600, tt, 0.025);
              hl.setTargetAtTime(1800, tt + 0.22, 0.35);
            }
          }
          if (i > 0) {
            thump(rp, t, i === 2 ? 0.36 : 0.22, 82, 40, roar, thSat);
            taiko(rp, t, i === 2 ? 0.34 : 0.24, drums, { f0: 80, f1: 48, dec: 0.32, sat: dSat });
          }
          const rg = rp.at(roll.gain);
          rg.setValueAtTime(0.0015, t + B * 0.45);
          rg.exponentialRampToValueAtTime(0.08, t + B - 0.015);
          rg.setTargetAtTime(0.0012, t + B, 0.25);
          if (i === 2) {
            crash(rp, t, 0.18, v.wet);
            // the stand lands low: a deep drop under the crash (reference stand: 63-125 Hz within 5-6 dB of the full mix)
            thump(rp, t, 0.5, 66, 34, roar, thSat);
            thump(rp, t + 0.012, 0.32, 125, 62, roar, thSat);
            rp.at(top.out.gain).setTargetAtTime(0.12, t, 0.08);
            // the theme's last climb (A, then the leap to D) sits on top of the stand
            rp.at(horns.out.gain).setTargetAtTime(0.38, t, 0.05);
            top.chord(t, [74, 77, 81], { att: 0.06 });
          } else if (i > 2) top.chord(t, k === 0 ? [74, 77, 82] : k === 1 ? [76, 79, 84] : [74, 77, 81], { dip: true, att: 0.1 });
        });
        once(standAt - 1.6, from, to, (t) => {
          revSwell(rp, t, standAt - 0.005, 0.06, v.wet, 3800);
          timpRoll(rp, t, standAt - 0.004, 0.16, drums);
        });
        // the held breath before the stand: the wall (not the horns' theme) draws back ~4 dB under the rising swell, then
        // lands on the stand
        once(standAt - 0.95, from, to, (t) => {
          for (const g of [wall.gain, drums.gain].map((p) => rp.at(p))) {
            g.setTargetAtTime(dB(-4), t, 0.12);
            g.setTargetAtTime(1, standAt - 0.004, 0.003);
          }
        });
        grid(base + BEAT / 4, BEAT / 4, from, to, (i, t) => {
          const a = (i % 4 === 3 ? 1 : i % 2 ? 0.55 : 0.75) * (0.88 + 0.24 * h01(i, 31));
          const k = Math.floor((t - base) / B);
          const kk = k < 3 ? k : (k - 3) % 3;
          spic(rp, t + (h01(i, 32) - 0.5) * 0.007, figs[kk][(i + 1) % 16], 0.06 * a, spBus);
          if (k >= 1) hats.hit(t, (i % 2 ? 0.055 : 0.1) * (k >= 2 ? 1.3 : 1), k >= 2 && i % 4 === 1 ? 0.03 : 0.012);
          if (i % 2 === 1) pluck(rp, t, i % 8 === 7 ? 50 : 38, { peak: 0.055 * a, tau: 0.09, cutoff: 650, dest: roar });
        });
        steps(base + BAR * 0.25, BAR, from, to, grooveOffs, (_b, k, t) => {
          const [s, lv] = groove[k];
          const down = s % 4 === 0;
          const dec = down ? 0.22 : 0.12;
          taiko(rp, t, 0.2 * lv, drums, { f0: down ? 84 : 120, f1: down ? 52 : 80, dec, slap: 1.8, sat: dSat });
        });
      }
    };
  },

  /** Reward: the lift into D major. Warm strings I-IV-vi-V, a harp figure in 8ths, a few slow gold bells. */
  reward(v) {
    const str = new Strings(v, 0, 6, { wave: 'string', cutoff: 3400, q: 0.5, lfo: [0.05, 600], level: 0.085, dest: v.wet, vib: 15, presence: 2.5, bow: 0.012, hp: 100, weights: [0.55, 0.75, 1, 1, 1, 0.95] });
    const sub = v.gain(0.045, v.dry);
    const so = v.osc('sine', midi(26), 0, LONG, sub);
    const harpBus = v.gain(0, v.filt('peaking', 2600, 1, v.wet, 2));
    const chords = [Dadd9, Gmaj9, Bm7, Aadd9];
    const tones = [[74, 78, 81, 86], [74, 78, 83, 86], [74, 78, 81, 83], [76, 81, 83, 88]];
    v.at(harpBus.gain).setValueAtTime(0, BAR * 0.25);
    v.at(harpBus.gain).linearRampToValueAtTime(1, BAR * 0.8);
    return (start) => {
      const ci = (t: number) => Math.floor((t - start + 1e-6) / (BAR * 2)) % 4;
      return {
        tick(from, to) {
          grid(start, BAR * 2, from, to, (i, t) => {
            str.chord(t, chords[i % 4], { glide: 0.3, att: 0.35, dip: i > 0, swell: BAR * 2 });
            v.at(so.frequency).setTargetAtTime(midi(26 + ((chords[i % 4][0] - 38 + 24) % 12)), t, 0.2);
          });
          grid(start + BAR * 0.25, BEAT / 2, from, to, (i, t) => {
            // after the first cycle the harp breathes: one bar on, one bar off (the player may sit with the chest or the letter)
            if (t - start > BAR * 4.25 && Math.floor(i / 8) % 2 === 1) return;
            const m = FIG_MAJOR[ci(t)][i % 8];
            // harp: a 1:1 FM pluck, bright at the fingertip and mellowing within a few tens of ms
            const pk = (i % 4 === 0 ? 0.06 : 0.043) * (0.85 + 0.3 * h01(i, 1));
            v.fm({ t: t + h01(i, 2) * 0.012, f: midi(m), ratio: 1, index: 2.0, idxEnd: 0.12, idxTau: 0.06, a: 0.003, tau: 0.42, peak: pk, dest: v.pan(((m % 7) - 3) * 0.08, harpBus) });
          });
          grid(start + BEAT, BEAT * 2, from, to, (i, t) => {
            if (h01(i, 3) < 0.4) return;
            const m = tones[ci(t)][Math.floor(h01(i, 4) * 4)];
            bell(v, t + h01(i, 5) * 0.08, m, 0.02 * (0.6 + 0.4 * h01(i, 6)), 0.55, v.wet, h01(i, 7) * 0.8 - 0.4);
          });
        },
      };
    };
  },

  /** End card: resolved and gentle. Dadd9 and Gmaj9 trade slowly; a high violin line; a high bell now and then. */
  end(v) {
    const str = new Strings(v, 0, 6, { wave: 'string', cutoff: 2400, q: 0.6, lfo: [0.04, 400], level: 0.11, dest: v.wet, vib: 15, presence: 2, bow: 0.01, hp: 100, weights: [0.55, 0.75, 1, 1, 1, 0.95] });
    const hi = new Strings(v, 0, 2, { wave: 'string', cutoff: 5000, level: 0, dest: v.wet, vib: 9, presence: 3, body: 3000 });
    // the Warden theme again, now in D major on a solo violin: the same climb, resolved and warm
    const solo = new Strings(v, 0, 1, { wave: 'string', cutoff: 5200, level: 0.06, dest: v.wet, vib: 14, presence: 3.5, body: 3000, bow: 0.012, hp: 200, width: 0.5 });
    const motif: [number, number][] = [[0.5, 74], [1.54, 78], [2.58, 76], [3.63, 79], [4.67, 81], [5.71, 86]];
    const chords = [Dadd9, Gmaj9, Dadd9, Aadd9];
    const tops = [[78, 81], [79, 83], [78, 81], [76, 81]];
    v.at(hi.out.gain).setValueAtTime(0, 0);
    v.at(hi.out.gain).linearRampToValueAtTime(0.028, 4);
    v.at(solo.out.gain).setTargetAtTime(0, 10, 1.5);
    return (start) => {
      return {
        tick(from, to) {
          for (const [dt, m] of motif) once(start + dt, from, to, (t) => solo.chord(t, [m], { dip: true, att: dt > 5 ? 0.25 : 0.1, glide: 0.05 }));
          grid(start, BAR * 3, from, to, (i, t) => {
            str.chord(t, chords[i % 4], { glide: 0.5, att: 0.6, dip: i > 0, swell: BAR * 3 });
            hi.chord(t, tops[i % 4], { glide: 0.35, att: 0.8 });
          });
          grid(start + BAR * 0.5, BAR, from, to, (i, t) => {
            if (i % 2 === 1 && h01(i, 8) < 0.5) return;
            bell(v, t, [86, 90, 93, 88][i % 4], 0.018, 0.8, v.wet, i % 2 ? 0.3 : -0.3);
          });
        },
      };
    };
  },

  /** The daily companion: slow (60 bpm), consonant, quiet but present. Two chords, a soft high layer, rare bells. */
  calm(v) {
    const bar = 4;
    // a soft bowed pad, not an organ: slow bow swells, gentle vibrato, warm and a little bright for phone speakers
    const pad = new Strings(v, 0, 5, { wave: 'string', cutoff: 1700, q: 0.5, lfo: [0.03, 300], level: 0.075, dest: v.wet, vib: 13, presence: 2.5, body: 2200, hp: 80, bite: 0.25 });
    const hi = new Strings(v, 0, 2, { wave: 'warm', cutoff: 3200, level: 0, dest: v.wet, vib: 6, presence: 3, body: 2400 });
    const chords = [[50, 57, 62, 64, 66], [43, 55, 59, 62, 66]];
    const tops = [[74, 78], [74, 79]];
    const penta = [74, 76, 78, 81, 83, 86];
    v.at(hi.out.gain).setValueAtTime(0.07, 0);
    v.at(hi.out.gain).linearRampToValueAtTime(0.11, 2.5);
    return (start) => {
      return {
        tick(from, to) {
          grid(start, bar * 2, from, to, (i, t) => {
            // a shallow swell only: during paced breathing the music must not seem to pump against their breath
            pad.chord(t, chords[i % 2], { glide: 0.6, att: i ? 1.0 : 0.4, swell: bar * 2, depth: 0.15 });
            hi.chord(t, tops[i % 2], { glide: 0.6, att: i ? 1.2 : 0.5 });
          });
          // a first bell soon after the player arrives, then rare ones
          once(start + 1.6, from, to, (t) => bell(v, t, 81, 0.016, 0.7, v.wet, -0.15));
          grid(start + 2.5 + bar * 1.5, bar * 1.5, from, to, (i, t) => {
            if (h01(i, 9) < 0.3) return;
            bell(v, t + h01(i, 10) * 0.6, penta[Math.floor(h01(i, 11) * penta.length)], 0.016, 0.7, v.wet, h01(i, 12) * 0.6 - 0.3);
          });
        },
      };
    };
  },
};

interface Live {
  name: Section;
  voice: Voice;
  impl: SectionImpl;
  start: number;
  end: number;
  until: number;
}

/** How far past the clock the live score is placed; the engine tops it up every 120 ms. */
export const AHEAD = 0.7;

/** The score. Sections crossfade; notes are scheduled ahead in windows (live) or all at once (offline). */
export class Music {
  live: Live[] = [];
  current: Section | null = null;
  constructor(
    private host: MusicHost,
    private dest: AudioNode,
    private ctl: { lp: BiquadFilterNode; shelf: BiquadFilterNode; level: GainNode },
  ) {}

  to(name: Section, crossfade = 2, o: SectionOpts = {}) {
    const { voice, score, at } = openBuilt(o.at, () => this.host.seed(), (seed) => {
      const opts = { hall: name === "awaken" ? 0.22 : 0.32, room: 0, gain: SECTION_GAIN[name], held: true };
      const voice = new Voice(this.host.lib, 0, this.dest, opts, seed());
      const score = FACTORIES[name](voice, o, { ...this.host, seed });
      score(0).tick(0, AHEAD);
      voice.at(voice.out.gain).setValueAtTime(0, 0);
      voice.at(voice.out.gain).setTargetAtTime(1, 0, Math.max(0.004, crossfade / 4));
      return { voice, score };
    }, 'continuous', name);
    this.stop(o.fadeOut ?? crossfade, at);
    if (voice.isDropped) return;
    const impl = score(voice.t);
    impl.opened?.(at + AHEAD);
    this.live.push({ name, voice, impl, start: voice.t, end: Infinity, until: at + AHEAD });
    this.current = name;
    this.host.onSection?.(name, at);
  }

  stop(fade = 1, at = soon(this.host.lib.ctx)) {
    for (const s of this.live) if (s.voice.stop(at, fade)) s.end = Math.min(s.end, at);
    this.current = null;
  }

  level(v: number, ramp = 1, at = soon(this.host.lib.ctx)) {
    glide(this.ctl.level.gain, v, ramp, at);
  }

  /** Low-pass the whole score (the filter-down before the hush). 20000 = open. */
  lowpass(hz: number, ramp = 1, at = soon(this.host.lib.ctx)) {
    glide(this.ctl.lp.frequency, hz, ramp, at);
  }

  /** Low-shelf lift below 120 Hz (the important-window bass lift, +5 dB). */
  lift(db: number, ramp = 0.5, at = soon(this.host.lib.ctx)) {
    glide(this.ctl.shelf.gain, db, ramp, at);
  }

  /** The director started the hush / played the hit: an open-ended awaken section follows it. */
  onHush(at: number) {
    for (const s of this.live) if (s.name === "awaken" && s.end === Infinity) s.impl.hush?.(at);
  }

  armHit(cue?: Voice) {
    let group: Voice | undefined;
    for (const s of this.live) {
      if (s.name === "awaken" && s.end === Infinity) group = s.impl.arm?.(cue) ?? group;
    }
    return group;
  }

  onHit(at: number, dropped = false) {
    for (const s of this.live) if (s.name === "awaken" && s.end === Infinity) s.impl.hit?.(at, dropped);
    this.scheduleUntil(Math.max(at, this.host.lib.ctx.currentTime) + 0.05);
  }

  /** Places the score up to `t`. What would fall before `from` (after a stall, the part of the window behind soon()) is
   *  dropped, not played late with its attack cut. */
  scheduleUntil(t: number, from = soon(this.host.lib.ctx)) {
    for (const s of this.live) {
      const lim = Math.min(t, s.end);
      if (lim > s.until) {
        s.impl.tick(Math.max(s.until, from), lim);
        s.until = lim;
      }
    }
    this.live = this.live.filter((s) => s.voice.silentAt > t - 5);
  }
}
