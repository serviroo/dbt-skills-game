import { dB, midi } from './dsp';
import { Voice, kRate, type Lib } from './voice';

export type Section = 'intro' | 'windows' | 'silhouette' | 'awaken' | 'reward' | 'end' | 'calm';
export const SECTIONS: Section[] = ['intro', 'windows', 'silhouette', 'awaken', 'reward', 'end', 'calm'];

export interface SectionOpts {
  at?: number;
  /** Fade of the outgoing section; defaults to the crossfade. Use ~0.04 for a hard audio cut. */
  fadeOut?: number;
  /** awaken only: context time of the hit (default start + 4.86 s, as in the keyframe table). */
  hitAt?: number;
  /** awaken only: context time of the stand-up, the loudest moment (default hitAt + 7.04 s). */
  standAt?: number;
}

export interface MusicHost {
  lib: Lib;
  hush(from: number, to: number): void;
  seed(): number;
  /** Called when a section starts (the engine fades the dark-world beds when the score lifts into D major). */
  onSection?(name: Section, at: number): void;
}

const LONG = 6 * 3600;

/** Mix trims per section, set from loudness measurements (cutscene about -18 LUFS integrated, every section audible
 *  through a phone-speaker band of 350 Hz-9 kHz, the roar the loudest music). */
const SECTION_GAIN: Record<Section, number> = { intro: dB(-3.5), windows: dB(-2.8), silhouette: dB(-4), awaken: dB(-3), reward: dB(-2.8), end: dB(-2.6), calm: dB(-14.2) };

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
/**
 * Band-limited tables: 'warm' a saw with a steep 1/n^1.45 rolloff; 'string' a bowed string (1/n^1.05 with the comb of
 * a bow at 1/7 of the string, so the 7th, 14th... harmonics are weak, the way a real bowed spectrum is); 'brass' bright
 * 1/n^0.9 for filter-envelope brass.
 */
function waveOf(ctx: BaseAudioContext, name: 'warm' | 'string' | 'brass') {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  let w = m.get(name);
  if (!w) {
    const n = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      if (name === 'warm') im[k] = 1 / Math.pow(k, 1.45);
      else if (name === 'string') im[k] = (0.25 + 0.75 * Math.abs(Math.sin((Math.PI * k) / 7))) / Math.pow(k, 1.05);
      else im[k] = 1 / Math.pow(k, 0.9);
    }
    w = ctx.createPeriodicWave(re, im, { disableNormalization: false });
    m.set(name, w);
  }
  return w;
}

interface StringOpts {
  wave?: 'warm' | 'string' | 'brass';
  detune?: number;
  cutoff: number;
  q?: number;
  lfo?: [number, number];
  level: number;
  dest: AudioNode;
  /** Vibrato depth in cents (two shared LFOs at 5.3 / 5.9 Hz). */
  vib?: number;
  /** Body / bow-bite presence peak (dB at `body` Hz). */
  presence?: number;
  body?: number;
  /** Bow noise level (0 = none). */
  bow?: number;
  /** Stereo crossfeed 0..1 between the hard-split pair (0.33 = side -6 dB, mid unchanged). */
  width?: number;
  /** Highpass corner (Hz). */
  hp?: number;
  /** Default per-voice levels, low to high (tames the low voices of a wide voicing). */
  weights?: number[];
  /** Ensemble tap level (two modulated delay taps beside the dry section); default 0.45 for n >= 2, 0 for a solo. */
  ens?: number;
  /** Bow bite: the lowpass opens by this fraction on each new chord and settles (default 0.45). */
  bite?: number;
}

const lfoCache = new WeakMap<Voice, Map<number, GainNode>>();
/** A unit sine LFO per (section voice, rate), shared by every layer of the section that modulates at that rate
 *  (each layer scales it with its own gain), so vibrato and ensemble cost no extra oscillators per layer. */
function sharedLfo(v: Voice, rate: number, t0: number): GainNode {
  let m = lfoCache.get(v);
  if (!m) lfoCache.set(v, (m = new Map()));
  let hub = m.get(rate);
  if (!hub) {
    hub = v.ctx.createGain();
    v.osc('sine', rate, t0, t0 + LONG, hub);
    m.set(rate, hub);
  }
  return hub;
}

/** An LFO of `depth` added onto p, from the section's shared oscillator at that rate. Returns the depth gain. */
function modulate(v: Voice, rate: number, depth: number, p: AudioParam, t0: number) {
  const g = v.gain(depth, p);
  sharedLfo(v, rate, t0).connect(g);
  return g;
}

/** Deterministic per-step randomness in [0, 1): the same live and offline, whatever the scheduling windows. */
function h01(i: number, salt: number) {
  let x = (Math.imul(i + 1, 374761393) + Math.imul(salt, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Ensemble: two slowly modulated delay taps (12 and 19 ms, +-2 ms, unequal rates) panned apart beside the dry signal,
 * so a section of two oscillators per note reads as many players drifting against each other. Returns the input.
 */
function ensemble(v: Voice, t0: number, dest: AudioNode, mix: number): AudioNode {
  if (mix <= 0) return dest;
  const input = v.gain(1, dest);
  for (const [d, r, p] of [[0.012, 0.43, -0.5], [0.019, 0.61, 0.5]] as const) {
    const dl = v.ctx.createDelay(0.05);
    dl.delayTime.value = d;
    modulate(v, r, 0.002, dl.delayTime, t0);
    input.connect(dl);
    dl.connect(v.gain(mix, v.pan(p, dest)));
  }
  return input;
}

/** Crossfeed L<->R by k (mid kept, side scaled by (1 - k) / (1 + k)): returns the stereo input node feeding dest. */
function narrow(v: Voice, k: number, dest: AudioNode): AudioNode {
  if (k <= 0) return dest;
  const sp = v.ctx.createChannelSplitter(2);
  const mg = v.ctx.createChannelMerger(2);
  mg.connect(dest);
  const s = 1 / (1 + k);
  for (const [from, to, g] of [[0, 0, s], [1, 1, s], [0, 1, k * s], [1, 0, k * s]] as const) {
    const n = v.ctx.createGain();
    n.gain.value = g;
    sp.connect(n, from);
    n.connect(mg, 0, to);
  }
  return sp;
}

/**
 * A bowed section: each voice is a detuned pair split left / right (crossfed, so wide in stereo and a plain chorus in
 * mono), two shared vibrato LFOs, a lowpass, a body / presence peak, optional bow noise, and a bow swell per chord.
 */
class Strings {
  readonly out: GainNode;
  readonly dyn: GainNode;
  readonly lp: BiquadFilterNode;
  private oscs: OscillatorNode[][] = [];
  private gains: GainNode[] = [];
  private bow: GainNode | null = null;
  private bowLvl = 0;
  private weights?: number[];
  private cut: number;
  private bite: number;
  private vib: GainNode[];
  private vibDepth: number;
  constructor(v: Voice, t0: number, private n: number, o: StringOpts) {
    this.out = v.gain(o.level, ensemble(v, t0, o.dest, o.ens ?? (n >= 2 ? 0.45 : 0)));
    this.weights = o.weights;
    this.cut = o.cutoff;
    this.bite = o.bite ?? 0.45;
    const body = v.filt('peaking', o.body ?? 2600, 0.8, narrow(v, o.width ?? 0.33, this.out), o.presence ?? 3);
    const hp = v.filt('highpass', o.hp ?? 55, 0.6, body);
    this.dyn = v.gain(1, hp);
    this.lp = v.filt('lowpass', o.cutoff, o.q ?? 0.7, this.dyn);
    if (o.lfo) v.lfo(o.lfo[0], o.lfo[1], this.lp.frequency, t0, t0 + LONG);
    const w = waveOf(v.ctx, o.wave ?? 'string');
    this.vibDepth = o.vib ?? 8;
    const vib = (this.vib = [5.3, 5.9].map((r) => {
      const g = v.ctx.createGain();
      g.gain.value = this.vibDepth;
      sharedLfo(v, r, t0).connect(g);
      return g;
    }));
    for (let i = 0; i < n; i++) {
      const g = v.gain(0, this.lp);
      const mg = v.ctx.createChannelMerger(2);
      mg.connect(g);
      const pair = [-1, 1].map((s, k) => {
        const os = v.osc(w, 110, t0, t0 + LONG, mg, k);
        os.detune.value = v.cents + s * (o.detune ?? 7) + ((i % 3) - 1) * 1.6;
        kRate(os.detune, os.frequency);
        vib[(i + k) % 2].connect(os.detune);
        return os;
      });
      this.oscs.push(pair);
      this.gains.push(g);
    }
    if (o.bow) {
      this.bowLvl = o.bow;
      this.bow = v.gain(0, this.dyn);
      // bow hair: the 3 kHz scrape plus the rosin air above 6 kHz that recorded strings carry
      const bn = v.noise('pink', t0, t0 + LONG, v.filt('bandpass', 2900, 0.7, this.bow));
      bn.connect(v.filt('highpass', 6200, 0.7, v.gain(1.0, this.bow)));
    }
  }
  /** Bow to a chord. att = swell time constant; dip = a short bow change on the move (legato articulation). */
  chord(t: number, notes: (number | undefined)[], o: { glide?: number; att?: number; levels?: number[]; dip?: boolean; swell?: number; depth?: number } = {}) {
    const glide = o.glide ?? 0.06;
    const att = o.att ?? 0.2;
    for (let i = 0; i < this.n; i++) {
      const m = notes[i];
      const g = this.gains[i].gain;
      // players never move together: each part arrives a few ms apart (low parts first, like a real section)
      const ti = t + (o.swell ? i * 0.009 + h01(Math.round(t * 50) + i, 41) * 0.012 : 0);
      if (m === undefined) {
        g.setTargetAtTime(0, ti, 0.12);
        continue;
      }
      for (const os of this.oscs[i]) os.frequency.setTargetAtTime(midi(m), ti, glide);
      const L = (o.levels?.[i] ?? this.weights?.[i] ?? 1) / Math.sqrt(this.n);
      if (o.dip) {
        g.setTargetAtTime(L * 0.55, ti, 0.02);
        g.setTargetAtTime(L, ti + 0.07, att);
      } else g.setTargetAtTime(L, ti, att);
      // a long bow breathes: it swells through the middle of the stroke and eases off before the next change
      if (o.swell) {
        const s = o.swell;
        const d = o.depth ?? 0.35;
        g.setTargetAtTime(L * (1 + d * (0.8 + 0.4 * h01(i, 43))), ti + s * 0.3, s * 0.2);
        g.setTargetAtTime(L * (1 - d * 0.5), ti + s * 0.7, s * 0.18);
      }
    }
    if (this.bow) {
      const b = this.bow.gain;
      b.setTargetAtTime(this.bowLvl * 2, t, 0.03);
      b.setTargetAtTime(this.bowLvl, t + 0.18, 0.5);
    }
    // the bow bites (brighter for a moment), and players add vibrato only once the note has settled
    if (this.bite > 0) {
      const f = this.lp.frequency;
      f.setTargetAtTime(this.cut * (1 + this.bite), t, 0.04);
      f.setTargetAtTime(this.cut, t + 0.16, 0.45);
    }
    for (const g of this.vib) {
      g.gain.setTargetAtTime(this.vibDepth * 0.3, t, 0.04);
      g.gain.setTargetAtTime(this.vibDepth, t + 0.28, 0.35);
    }
  }
}

/** Synth brass: n voices of 2 detuned oscillators through a shared resonant lowpass; chord(..., accent) adds a brass
 *  'blat' (pitch scoop up from -35 cents, a sforzando that settles). */
class Pad {
  readonly lp: BiquadFilterNode;
  readonly out: GainNode;
  private oscs: OscillatorNode[][] = [];
  private gains: GainNode[] = [];
  private base: number[][] = [];
  constructor(
    v: Voice,
    t0: number,
    n: number,
    o: { wave: OscillatorType | 'warm' | 'brass'; detune: number; cutoff: number; q: number; lfo?: [number, number]; level: number; dest: AudioNode; vib?: number; drive?: number },
  ) {
    // each voice's detuned pair is split left / right and crossfed (like the strings), so the section has width;
    // x1.84 keeps the power of the old mono sum (per channel 0.71 A + 0.29 B instead of A + B)
    this.out = v.gain(o.level * 1.84, o.dest);
    const into = narrow(v, 0.4, this.out);
    // drive: the brass rasp (a soft tanh after the filter, so loud chords grow edge, not just level)
    // (input scaled by 0.7 so a full chord peaks near the curve's end; output restores small-signal unity gain)
    const d = o.drive ?? 0;
    this.lp = v.filt('lowpass', o.cutoff, o.q, d ? v.gain(0.7, v.shaper(d, v.gain(Math.tanh(d) / (d * 0.7), into), 'none')) : into);
    if (o.lfo) v.lfo(o.lfo[0], o.lfo[1], this.lp.frequency, t0, t0 + LONG);
    const wave = o.wave === 'warm' || o.wave === 'brass' ? waveOf(v.ctx, o.wave) : o.wave;
    const vib: GainNode[] = [];
    if (o.vib) {
      for (const r of [4.7, 5.3]) {
        const g = v.ctx.createGain();
        g.gain.value = o.vib;
        sharedLfo(v, r, t0).connect(g);
        vib.push(g);
      }
    }
    for (let i = 0; i < n; i++) {
      const g = v.gain(0, this.lp);
      const mg = v.ctx.createChannelMerger(2);
      mg.connect(g);
      const b: number[] = [];
      const pair = [-1, 1].map((s, k) => {
        const os = v.osc(wave, 110, t0, t0 + LONG, mg, k);
        os.detune.value = v.cents + s * o.detune + (i % 3) * 1.5;
        b.push(os.detune.value);
        kRate(os.detune, os.frequency);
        if (o.vib) vib[(i + k) % 2].connect(os.detune);
        return os;
      });
      this.oscs.push(pair);
      this.gains.push(g);
      this.base.push(b);
    }
  }
  chord(t: number, notes: number[], glide = 0.05, levels?: number[], accent = 0) {
    for (let i = 0; i < this.oscs.length; i++) {
      const m = notes[i];
      const g = this.gains[i].gain;
      if (m === undefined) {
        g.setTargetAtTime(0, t, 0.08);
        continue;
      }
      this.oscs[i].forEach((os, k) => {
        os.frequency.setTargetAtTime(midi(m), t, glide);
        if (accent) {
          os.detune.setValueAtTime(this.base[i][k] - 35 * accent, t);
          os.detune.linearRampToValueAtTime(this.base[i][k], t + 0.09);
        }
      });
      const L = (levels?.[i] ?? 1) / Math.sqrt(this.oscs.length);
      if (accent) {
        g.setTargetAtTime(L * (1 + 0.45 * accent), t, 0.018);
        g.setTargetAtTime(L, t + 0.16, 0.3);
      } else g.setTargetAtTime(L, t, 0.12);
    }
  }
}

/** "Ah" choir: detuned saws through three vowel formants (700 / 1220 / 2600 Hz) plus a breath layer. */
class Choir {
  readonly out: GainNode;
  private oscs: OscillatorNode[][] = [];
  private gains: GainNode[] = [];
  private f1: BiquadFilterNode;
  constructor(v: Voice, t0: number, n: number, level: number, dest: AudioNode) {
    this.out = v.gain(level, ensemble(v, t0, dest, 0.55));
    this.f1 = v.filt('bandpass', 700, 5, v.gain(1.0, this.out));
    const f2 = v.filt('bandpass', 1220, 7, v.gain(0.6, this.out));
    const f3 = v.filt('bandpass', 2600, 9, v.gain(0.38, this.out));
    const hp = v.filt('highpass', 220, 0.7, this.f1);
    hp.connect(f2);
    hp.connect(f3);
    const br = v.gain(0.03, hp);
    v.noise('pink', t0, t0 + LONG, br);
    const vib: GainNode[] = [];
    for (const r of [5.1, 5.6]) {
      const g = v.ctx.createGain();
      g.gain.value = 7;
      sharedLfo(v, r, t0).connect(g);
      vib.push(g);
    }
    for (let i = 0; i < n; i++) {
      const g = v.gain(0, hp);
      const trio = [-11, 0, 12].map((d, k) => {
        const os = v.osc('sawtooth', 220, t0, t0 + LONG, g);
        os.detune.value = v.cents + d;
        kRate(os.detune, os.frequency);
        vib[(i + k) % 2].connect(os.detune);
        return os;
      });
      this.oscs.push(trio);
      this.gains.push(g);
    }
  }
  chord(t: number, notes: number[], glide = 0.08) {
    for (let i = 0; i < this.oscs.length; i++) {
      const m = notes[i];
      if (m === undefined) {
        this.gains[i].gain.setTargetAtTime(0, t, 0.1);
        continue;
      }
      for (const os of this.oscs[i]) os.frequency.setTargetAtTime(midi(m), t, glide);
      this.gains[i].gain.setTargetAtTime(1 / Math.sqrt(this.oscs.length), t, 0.15);
    }
    // the vowel opens on each new chord ('oh' -> 'ah')
    this.f1.frequency.setTargetAtTime(560, t, 0.02);
    this.f1.frequency.setTargetAtTime(720, t + 0.08, 0.25);
  }
}

/** A long noise source behind a gain that is struck per event: hats, ticks, bow chiff. tau*8 must be < the spacing. */
class Hits {
  readonly g: GainNode;
  constructor(v: Voice, t0: number, color: 'white' | 'pink', into: AudioNode) {
    this.g = v.gain(0, into);
    v.noise(color, t0, t0 + LONG, this.g);
  }
  hit(t: number, peak: number, tau: number, a = 0.0008) {
    const p = this.g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(0, t + a, tau);
  }
}

function pluck(v: Voice, t: number, m: number, o: { peak: number; tau: number; cutoff: number; dest: AudioNode; wave?: OscillatorType | PeriodicWave; env?: number }) {
  const g = v.gain(0, o.dest);
  const end = v.perc(g.gain, t, o.peak, 0.004, o.tau);
  const lp = v.filt('lowpass', o.cutoff, 1.2, g);
  lp.frequency.setValueAtTime(o.cutoff * (o.env ?? 3), t);
  lp.frequency.setTargetAtTime(o.cutoff, t, o.tau * 0.6);
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

/** A shared saturator in front of dest (drums and heartbeats of one section share it; they rarely overlap). */
function satBus(v: Voice, drive: number, dest: AudioNode, level = 1) {
  return v.shaper(drive, v.gain(level, dest), 'none');
}

function thump(v: Voice, t: number, peak: number, f0 = 70, f1 = 44, dest: AudioNode = v.dry, sat?: AudioNode) {
  const g = v.gain(0, sat ?? satBus(v, 2.2, dest));
  const end = v.perc(g.gain, t, peak, 0.004, 0.11);
  const o = v.osc('sine', f0, t, end + 0.05, g);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + 0.16);
}

/** Heartbeat: the felt low thump plus a muffled knock (saturated 170 Hz) that a phone speaker can carry. */
function heart(v: Voice, t: number, peak: number, buses: { low: AudioNode; knock: AudioNode }) {
  thump(v, t, peak, 64, 42, undefined, buses.low);
  const g = v.gain(0, buses.knock);
  const e = v.perc(g.gain, t, peak * 2.4, 0.003, 0.035);
  const o = v.osc('triangle', 170, t, e, g);
  o.frequency.setValueAtTime(170, t);
  o.frequency.exponentialRampToValueAtTime(105, t + 0.08);
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
  b.frequency.setValueAtTime(f0 * 1.4, t);
  b.frequency.exponentialRampToValueAtTime(f0, t + 0.012);
  b.frequency.exponentialRampToValueAtTime(f1, t + 0.18);
  const g2 = v.gain(0, dest);
  const e2 = v.perc(g2.gain, t, peak * 0.3, 0.001, dec * 0.3);
  const m2 = v.osc('triangle', f0 * 2.3, t, e2, g2);
  m2.frequency.setValueAtTime(f0 * 2.5, t);
  m2.frequency.exponentialRampToValueAtTime(f1 * 2.3, t + 0.12);
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
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * a, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, tau);
    // past -26 dB the partial is buried under the reverb: fade it in 0.2 s and free the oscillator
    const fe = t + 0.003 + tau * 3;
    g.gain.setTargetAtTime(0, fe, 0.05);
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
  g.gain.setTargetAtTime(0, t1, 0.01);
  v.noise('white', t0, t1 + 0.12, g);
}

/** Timpani roll on D: a low drum body fluttering at ~15 strokes/s, swelling exponentially and cut on t1 (the hit). */
function timpRoll(v: Voice, t0: number, t1: number, peak: number, dest: AudioNode) {
  const g = v.gain(0, dest);
  v.ramp(g.gain, t0, peak * 0.03, peak, t1 - t0);
  g.gain.setTargetAtTime(0, t1, 0.012);
  const am = v.gain(0.55, g);
  v.lfo(15, 0.45, am.gain, t0, t1 + 0.1);
  v.osc('sine', midi(38), t0, t1 + 0.1, am);
  v.noise('brown', t0, t1 + 0.1, v.gain(1.3, v.filt('lowpass', 240, 0.7, am)));
}

/** Cymbal crash: broadband air with a long decay. */
function crash(v: Voice, t: number, peak: number, dest: AudioNode) {
  const g = v.gain(0, v.filt('highpass', 3600, 0.6, dest));
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, 0.75);
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
  hit?(at: number): void;
}
type Factory = (v: Voice, start: number, o: SectionOpts, host: MusicHost) => SectionImpl;

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
  intro(v, start) {
    const str = new Strings(v, start, 6, { wave: 'warm', cutoff: 950, q: 0.8, lfo: [0.06, 200], level: 0.12, dest: v.wet, vib: 11, presence: 2, bow: 0.012, hp: 50, weights: [1.1, 0.8, 0.9, 0.9, 0.9, 0.8] });
    const sub = v.gain(0, v.dry);
    sub.gain.setValueAtTime(0, start);
    sub.gain.setTargetAtTime(0.09, start, 0.6);
    v.osc('sine', midi(26), start, start + LONG, sub);
    // the distant lead (reference: a quiet ~1.4 kHz tone with an ~11 Hz shimmer, far under the pad, never a beep)
    const lead = v.gain(0, v.filt('lowpass', 3600, 0.5, v.wet));
    lead.gain.setValueAtTime(0, start);
    lead.gain.setTargetAtTime(0.008, start + 0.2, 0.8);
    const pulse = v.gain(0.55, lead);
    v.lfo(72 / 60, 0.45, pulse.gain, start, start + LONG);
    v.osc('sine', midi(89), start, start + LONG, pulse);
    v.osc('sine', midi(89), start, start + LONG, v.gain(0.5, v.pan(0.25, pulse))).detune.value = v.cents + 14;
    v.osc('triangle', midi(81), start, start + LONG, v.gain(0.45, lead)).detune.value = v.cents + 3;
    v.osc('sine', midi(77), start, start + LONG, v.gain(0.3, v.pan(-0.3, lead)));
    const hi = new Strings(v, start, 2, { wave: 'string', cutoff: 6000, level: 0, dest: v.wet, vib: 5, presence: 4, body: 3400 });
    hi.out.gain.setValueAtTime(0, start + 1.8);
    hi.out.gain.linearRampToValueAtTime(0.03, start + 5.5);
    hi.chord(start, [86, 93], { att: 0.05 });
    const chords = [Dm9, Bbmaj7];
    const vel = [1, 0.4, 0.7, 0.4];
    return {
      tick(from, to) {
        grid(start, BAR * 2, from, to, (i, t) => str.chord(t, chords[i % 2], { glide: 0.25, att: i ? 0.4 : 0.6, swell: BAR * 2 }));
        grid(start + BEAT * 2, BEAT, from, to, (i, t) => bell(v, t, 89, 0.028 * vel[i % 4], 0.13, v.wet, i % 2 ? 0.2 : -0.2));
      },
    };
  },

  /** Lantern windows: strings move i-VI-iv-V over the Lantern pulse bed (115-230 Hz with an 8th-harmonic glint, gated in
   *  an irregular 'syllabic' loop), a spiccato figure joins after the first window settles, and a soft digital clock
   *  ticks in 16ths. */
  windows(v, start) {
    const str = new Strings(v, start, 6, { wave: 'string', cutoff: 2700, q: 0.5, lfo: [0.07, 450], level: 0.085, dest: v.wet, vib: 15, presence: 1.5, bow: 0.014, hp: 100, weights: [0.5, 0.7, 1, 1, 1, 0.9] });
    const sub = v.gain(0.045, v.dry);
    const so = v.osc('sine', midi(26), start, start + LONG, sub);
    const chords = [Dm9, Bbmaj7, Gm9, Asus];
    const roots = [50, 46, 55, 45];
    const pings = [89, 89, 86, 88];
    const pat: [number, number, number][] = [[0, 0.28, 1], [0.5, 0.1, 0.55], [0.75, 0.1, 0.5], [1.5, 0.22, 0.85], [2, 0.12, 0.6], [2.25, 0.08, 0.45], [2.75, 0.2, 0.8], [3.25, 0.1, 0.55], [3.5, 0.06, 0.4], [3.75, 0.06, 0.4]];
    const offs = pat.map(([b]) => b * BEAT);
    const pulseBus = v.gain(1, v.filt('lowpass', 1800, 0.7, v.wet));
    const spBus = v.gain(0, v.filt('lowpass', 6500, 0.6, v.filt('peaking', 2500, 1, v.wet, 3)));
    spBus.gain.setValueAtTime(0, start + BAR * 0.75);
    spBus.gain.linearRampToValueAtTime(0.7, start + BAR * 1.25);
    spBus.gain.linearRampToValueAtTime(1, start + BAR * 3);
    const clock = new Hits(v, start, 'white', v.filt('highpass', 6500, 0.7, v.pan(0.22, v.gain(1, v.wet))));
    const acc = [1, 0.3, 0.55, 0.3];
    const ci = (t: number) => Math.floor((t - start + 1e-6) / (BAR * 2)) % 4;
    return {
      tick(from, to) {
        grid(start, BAR * 2, from, to, (i, t) => {
          str.chord(t, chords[i % 4], { glide: 0.25, att: 0.3, dip: i > 0, swell: BAR * 2 });
          so.frequency.setTargetAtTime(midi(26 + ((chords[i % 4][0] - 38 + 24) % 12)), t, 0.2);
        });
        steps(start, BAR, from, to, offs, (bi, k, t) => {
          const c = Math.floor(bi / 2) % 4;
          const [, d, a] = pat[k];
          const g = v.gain(0, pulseBus);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.036 * a, t + 0.012);
          g.gain.setValueAtTime(0.036 * a, t + d);
          g.gain.linearRampToValueAtTime(0, t + d + 0.05);
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
  },

  /** Tension under the silhouette and the push-in: an open D/A drone, a low piano tolling every two bars, a heartbeat
   *  that tightens, a clock that starts ticking, a sul-ponticello cluster growing high above, a cello line creeping a
   *  semitone (A - Bb - A) under a cold bowed-metal shimmer, muted low strings pulsing in 8ths from the push-in, and a
   *  reversed swell cut dead on the eye ignition (~12.0 s in). The last bar before it holds its breath (the clock
   *  thins out); at the ignition everything falls still and the cello arrives on D. */
  silhouette(v, start) {
    const drone = new Strings(v, start, 3, { wave: 'string', cutoff: 1500, q: 0.9, lfo: [0.05, 260], level: 0.11, dest: v.wet, vib: 4, presence: 3, bow: 0.016, hp: 90 });
    drone.chord(start, [38, 45, 50], { att: 0.3, glide: 0.01 });
    const sub = v.gain(0.02, v.dry);
    v.osc('sine', midi(26), start, start + LONG, sub);
    const IGN = start + 12.0;
    const cello = new Strings(v, start, 2, { wave: 'string', cutoff: 2400, q: 0.7, level: 0, dest: v.wet, vib: 7, presence: 4, body: 1200, bow: 0.03, hp: 110, weights: [0.45, 1] });
    // the held breath: everything grows until 1.5 s before the ignition, then draws back ~6 dB under the reverse swell
    const HOLD = IGN - 1.5;
    cello.out.gain.setValueAtTime(0, start);
    cello.out.gain.linearRampToValueAtTime(0.075, start + 0.4);
    cello.out.gain.exponentialRampToValueAtTime(0.12, HOLD);
    cello.out.gain.setTargetAtTime(0.055, HOLD, 0.35);
    cello.out.gain.setTargetAtTime(0.035, IGN - 0.02, 0.04);
    cello.out.gain.setTargetAtTime(0.08, IGN + 0.9, 0.7);
    const line: [number, number, number][] = [[0.4, 57, 1.2], [BAR * 1.5, 58, 0.6], [BAR * 2.5, 57, 0.5], [12.9, 62, 0.8]];
    const shim = v.gain(0, v.wet);
    shim.gain.setValueAtTime(0, start);
    shim.gain.linearRampToValueAtTime(0.06, start + 0.8);
    shim.gain.exponentialRampToValueAtTime(0.28, HOLD);
    shim.gain.setTargetAtTime(0.14, HOLD, 0.35);
    shim.gain.setTargetAtTime(0.04, IGN - 0.02, 0.05);
    shim.gain.setTargetAtTime(0.12, IGN + 0.9, 0.8);
    const sa = v.gain(0.7, shim);
    v.lfo(0.21, 0.3, sa.gain, start, start + LONG);
    const sn = v.noise('white', start, start + LONG, v.filt('bandpass', 4700, 18, sa));
    sn.connect(v.filt('bandpass', 6900, 22, v.gain(0.8, sa)));
    sn.connect(v.filt('lowpass', 10500, 0.7, v.filt('highpass', 6500, 0.7, v.gain(0.26, sa))));
    const tremBus = v.gain(0, v.wet);
    tremBus.gain.setValueAtTime(0, start);
    tremBus.gain.linearRampToValueAtTime(0.025, start + 0.5);
    tremBus.gain.exponentialRampToValueAtTime(0.11, HOLD);
    tremBus.gain.setTargetAtTime(0.05, HOLD, 0.35);
    const trem = v.gain(0.55, tremBus);
    v.lfo(9, 0.45, trem.gain, start, start + LONG);
    const hi = new Strings(v, start, 2, { wave: 'string', cutoff: 6500, level: 1, dest: trem, vib: 3, presence: 5, body: 3300 });
    const clusters = [[74, 75], [73, 74]];
    const clock = new Hits(v, start, 'white', v.filt('bandpass', 4200, 1.2, v.pan(-0.2, v.gain(1, v.wet))));
    const hb = heartBuses(v, v.dry, 0.7);
    const lowBus = v.gain(0, v.filt('lowpass', 1100, 0.7, v.wet));
    lowBus.gain.setValueAtTime(0, start + BAR * 1.9);
    lowBus.gain.linearRampToValueAtTime(1, start + BAR * 3.0);
    // the eyes ignite ~12.0 s in: pulse, clock and heartbeat stop dead and the cluster drops back, so the ignition swell
    // speaks into stillness; the drone holds and the cluster breathes back in
    lowBus.gain.setTargetAtTime(0.5, HOLD, 0.35);
    lowBus.gain.setTargetAtTime(0, IGN - 0.02, 0.03);
    tremBus.gain.setTargetAtTime(0.02, IGN, 0.05);
    tremBus.gain.setTargetAtTime(0.05, IGN + 0.7, 0.5);
    drone.out.gain.setTargetAtTime(0.08, HOLD, 0.4);
    drone.out.gain.setTargetAtTime(0.05, IGN - 0.02, 0.03);
    drone.out.gain.setTargetAtTime(0.12, IGN + 1.0, 0.6);
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
          if (t > IGN - 0.35) return;
          const k = Math.min(1, (t - start) / (BAR * 3.4));
          const held = t > HOLD ? 0.6 : 1;
          heart(v, t, (0.07 + 0.04 * k) * held, hb);
          heart(v, t + 0.27, (0.05 + 0.025 * k) * held, hb);
        });
        grid(start + BAR, BEAT / 2, from, to, (i, t) => {
          if (t > IGN - 0.02) return;
          const k = Math.min(1, (t - start - BAR) / (BAR * 2.4));
          const held = 0.45 + 0.55 * Math.min(1, Math.max(0, (IGN - 0.1 - t) / 1.3));
          clock.hit(t, (i % 2 ? 0.1 : 0.16) * (0.45 + 0.55 * k) * held, 0.016);
        });
        grid(start + BAR * 2, BEAT / 2, from, to, (i, t) => {
          if (t < IGN - 0.02) spic(v, t, i % 4 === 3 ? 50 : 38, i % 2 ? 0.07 : 0.1, lowBus, 0.07, 0.05);
        });
        once(start + 10.3, from, to, (t) => revSwell(v, t, start + 12.0, 0.05, v.wet, 2400));
      },
    };
  },

  /** AWAKEN. Build (low drone rising, trembling strings, accelerating taiko heartbeat, a ticking clock, a reverse swell)
   *  that cuts dead into the 780 ms hush; then the roar on the hit: Bb - C - Dm over a D pedal (VI-VII-i), brass with
   *  a blat on every change, an 'ah' choir, spiccato strings and synth bass driving 16ths, a taiko groove, a reversed
   *  cymbal into the stand-up and a crash on it, where high strings take the top. */
  awaken(v, start, o, host) {
    // Timing: with hitAt known (offline renders) everything is scheduled now. Live, the build runs until the
    // director calls hush() (build cuts dead) and plays awaken_hit (the roar starts on that exact moment).
    let hitAt = o.hitAt ?? Infinity;
    let cutAt = o.hitAt !== undefined ? o.hitAt - 0.78 : Infinity;
    if (o.hitAt !== undefined) host.hush(cutAt, o.hitAt);
    const nominal = o.hitAt !== undefined ? Math.max(0.5, cutAt - start) : 4.08;
    const bv = v.child(v.wet, host.seed());
    const build = bv.gain(1, bv.wet);
    const cut = (at: number) => {
      if (cutAt !== Infinity && at >= cutAt) return;
      cutAt = at;
      build.gain.setTargetAtTime(0, at, 0.006);
      bv.stop(at, 0.024);
    };
    const L = start + LONG;
    const dr = bv.gain(0, build);
    v.ramp(dr.gain, start, 0.03, 0.1, nominal);
    const dlp = bv.filt('lowpass', 260, 1.4, dr);
    v.ramp(dlp.frequency, start, 260, 2600, nominal);
    for (const [m, d] of [[26, 0], [38, -6], [38, 7], [45, 4], [50, -3]] as const) {
      bv.osc(m === 26 ? 'sine' : 'sawtooth', midi(m), start, L, bv.gain(m === 26 ? 0.8 : 0.5, dlp)).detune.value = v.cents + d;
    }
    const st = bv.gain(0, bv.filt('peaking', 3000, 0.9, bv.filt('lowpass', 8500, 0.6, build), 4));
    const sAt = start + Math.min(nominal - 0.6, 1.85);
    st.gain.setValueAtTime(0, start);
    st.gain.linearRampToValueAtTime(0.08, start + 0.4);
    v.ramp(st.gain, sAt, 0.08, 0.24, Math.max(0.3, start + nominal - sAt));
    const tr = bv.gain(0.55, st);
    const trl = bv.lfo(6, 0.45, tr.gain, start, L);
    trl.frequency.setValueAtTime(6, start);
    trl.frequency.linearRampToValueAtTime(12, start + nominal);
    // the players drift against each other (slow, unequal pitch wander), so the cluster shimmers instead of buzzing
    const drift = [0.23, 0.31].map((r) => {
      const g = bv.ctx.createGain();
      g.gain.value = 7;
      bv.osc('sine', r, start, L, g);
      return g;
    });
    [[69, -4], [70, 5], [81, 3], [82, -6]].forEach(([m, d], k) => {
      const os = bv.osc('sawtooth', midi(m), start, L, bv.gain(0.5, tr));
      os.detune.value = v.cents + d;
      kRate(os.detune);
      drift[k % 2].connect(os.detune);
    });
    const rv = bv.gain(0, build);
    const rs = start + Math.max(0, nominal - 1.7);
    v.ramp(rv.gain, rs, 0.002, 0.2, start + nominal - rs);
    const rb = bv.filt('bandpass', 400, 0.9, rv);
    v.ramp(rb.frequency, rs, 380, 3400, start + nominal - rs);
    bv.noise('pink', rs, L, rb);
    const cym = bv.gain(0, bv.filt('lowpass', 11000, 0.6, bv.filt('highpass', 4000, 0.6, build)));
    v.ramp(cym.gain, rs, 0.0008, 0.07, start + nominal - rs);
    bv.noise('white', rs, L, cym);
    const clock = new Hits(bv, start, 'white', bv.filt('bandpass', 4600, 1.1, bv.pan(0.2, build)));
    const bSat = satBus(bv, 1.8, build);
    // low brass crescendo on D3 / A3 / D4 (the 150-500 Hz body of the build), opening and roughening as it grows
    const lb = new Pad(bv, start, 3, { wave: 'brass', detune: 6, cutoff: 320, q: 1.0, level: 0, dest: build, vib: 3, drive: 1.6 });
    lb.chord(start, [50, 57, 62], 0.01);
    lb.out.gain.setValueAtTime(0, start);
    lb.out.gain.linearRampToValueAtTime(0.018, start + 0.2);
    lb.out.gain.exponentialRampToValueAtTime(0.3, start + Math.max(0.5, nominal));
    v.ramp(lb.lp.frequency, start + 0.2, 320, 2400, Math.max(0.3, nominal - 0.2));
    if (cutAt !== Infinity) {
      build.gain.setTargetAtTime(0, cutAt, 0.006);
      bv.stop(cutAt, 0.024);
    }
    let nextBeat = start + 0.6;
    let gap = 1.0;
    let lastTo = start;
    let roarTo = -Infinity;

    const roar = v.gain(1, v.filt('lowshelf', 160, 0.7, v.filt('peaking', 1300, 0.9, v.wet, -2.5), 3));
    // brass and choir voiced around the Warden theme: none of them sits on a theme pitch in the theme's octave
    // (D4 / F4 over Bb, E4 / G4 over C, A4 / D5 over Dm), so the horns read on top of the wall instead of inside it
    const prog: [number[], number[]][] = [
      [[34, 46, 53, 58, 70, 74, 77], [58, 70, 74]],
      [[36, 48, 55, 60, 72, 76, 79], [60, 72, 76]],
      [[38, 50, 57, 62, 65, 77, 81], [62, 65, 77]],
    ];
    const figs = [
      [58, 62, 65, 62, 70, 65, 62, 65, 58, 62, 65, 70, 74, 70, 65, 62],
      [60, 64, 67, 64, 72, 67, 64, 67, 60, 64, 67, 72, 76, 72, 67, 64],
      [62, 65, 69, 65, 74, 69, 65, 69, 62, 65, 69, 74, 77, 74, 69, 65],
    ];
    // taiko groove over one bar of 16ths: [step, level]
    const groove: [number, number][] = [[0, 1], [3, 0.35], [6, 0.55], [8, 0.8], [10, 0.4], [11, 0.35], [12, 0.75], [14, 0.5], [15, 0.6]];
    const grooveOffs = groove.map(([s]) => (s * BEAT) / 4);
    let brass: Pad | null = null;
    let choir: Choir | null = null;
    let top: Strings | null = null;
    let spBus: AudioNode | null = null;
    let drums: GainNode | null = null;
    let dSat: AudioNode | null = null;
    let thSat: AudioNode | null = null;
    let hats: Hits | null = null;
    let horns: Strings | null = null;
    let roll: GainNode | null = null;
    let wall: GainNode | null = null;
    // the Warden theme in horns and trombones (octaves): D-F over Bb, E-G over C, then A and the leap to D on the stand
    const theme = [[62, 65], [64, 67], [69, 74]];
    const ensure = () => {
      if (brass) return;
      // brass and choir share a bus so the held breath before the stand can take them back without the horns' theme
      wall = v.gain(1, roar);
      brass = new Pad(v, hitAt, 7, { wave: 'brass', detune: 8, cutoff: 900, q: 0.9, level: 0.1, dest: wall, vib: 4, drive: 1.5 });
      horns = new Strings(v, hitAt, 2, { wave: 'brass', cutoff: 1800, q: 0.8, level: 0.3, dest: roar, vib: 5, presence: 5, body: 1250, hp: 80, width: 0.6, ens: 0.3, bite: 0 });
      choir = new Choir(v, hitAt, 3, 0.085, wall);
      top = new Strings(v, hitAt, 3, { wave: 'string', cutoff: 6500, level: 0, dest: roar, vib: 10, presence: 4, body: 3000, bow: 0.02 });
      spBus = v.filt('lowpass', 5500, 0.6, v.filt('peaking', 2400, 1, v.gain(1, roar), 3));
      drums = v.gain(1, v.wet);
      dSat = satBus(v, 1.8, drums);
      thSat = satBus(v, 2.2, roar);
      hats = new Hits(v, hitAt, 'white', v.filt('highpass', 7500, 0.7, v.pan(0.15, v.gain(1, v.wet))));
      // suspended cymbal rolled with soft mallets (a ~13 Hz flutter on the wash), swelling into every chord change
      roll = v.gain(0.0012, v.filt('highpass', 4800, 0.6, v.pan(-0.15, v.wet)));
      const rm = v.gain(0.75, roll);
      v.lfo(13, 0.25, rm.gain, hitAt, hitAt + LONG);
      const rn = v.noise('white', hitAt, hitAt + LONG, rm);
      rn.connect(v.filt('bandpass', 8800, 2.5, v.gain(0.8, rm)));
      const ped = v.gain(0, v.dry);
      ped.gain.setValueAtTime(0, hitAt);
      ped.gain.setTargetAtTime(0.11, hitAt, 0.2);
      v.osc('sine', midi(26), hitAt, hitAt + LONG, ped);
    };
    return {
      hush(at: number) {
        if (hitAt === Infinity) cut(at);
      },
      hit(at: number) {
        if (hitAt !== Infinity) return;
        cut(at);
        hitAt = at;
        // live, the score is already scheduled ~0.7 s past the hit: the roar fills that span now, chord one included
        roarTick(lastTo);
      },
      tick(from, to) {
        lastTo = Math.max(lastTo, to);
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
        roarTick(to);
      },
    };
    function roarTick(to: number) {
      const from = Math.max(hitAt, roarTo);
      if (!(to > from)) return;
      roarTo = to;
      ensure();
      const standAt = o.standAt ?? hitAt + 7.04;
      const B = Math.max(1.5, (standAt - hitAt) / 2);
      grid(hitAt, B, from, to, (i, t) => {
        const k = i < 3 ? i : (i - 3) % 3;
        const [notes, tp] = prog[k];
        brass!.chord(t, notes, 0.03, i === 2 ? [1.4, 1.3, 1, 1, 1, 1, 1] : undefined, i === 2 ? 1.5 : i > 0 ? 1 : 0.6);
        choir!.chord(t, tp);
        const lp = brass!.lp.frequency;
        lp.setTargetAtTime(i === 2 ? 3200 : 3000, t, 0.03);
        lp.setTargetAtTime(i === 2 ? 2300 : 2200, t + 0.35, 0.5);
        if (i < 3) {
          const [a, b] = theme[i];
          const t2 = t + B * (i === 2 ? 0.35 : 0.62);
          const hl = horns!.lp.frequency;
          for (const [tt, m] of [[t, a], [t2, b]]) {
            horns!.chord(tt, [m - 12, m], { dip: true, att: 0.07, glide: 0.04 });
            hl.setTargetAtTime(3600, tt, 0.025);
            hl.setTargetAtTime(1800, tt + 0.22, 0.35);
          }
        }
        if (i > 0) {
          thump(v, t, i === 2 ? 0.36 : 0.22, 82, 40, roar, thSat!);
          taiko(v, t, i === 2 ? 0.34 : 0.24, drums!, { f0: 80, f1: 48, dec: 0.32, sat: dSat! });
        }
        const rg = roll!.gain;
        rg.setValueAtTime(0.0015, t + B * 0.45);
        rg.exponentialRampToValueAtTime(0.08, t + B - 0.015);
        rg.setTargetAtTime(0.0012, t + B, 0.25);
        if (i === 2) {
          crash(v, t, 0.18, v.wet);
          // the stand lands low: a deep drop under the crash (reference stand: 63-125 Hz within 5-6 dB of the full mix)
          thump(v, t, 0.5, 66, 34, roar, thSat!);
          thump(v, t + 0.012, 0.32, 125, 62, roar, thSat!);
          top!.out.gain.setTargetAtTime(0.12, t, 0.08);
          // the theme's last climb (A, then the leap to D) sits on top of the stand
          horns!.out.gain.setTargetAtTime(0.38, t, 0.05);
          top!.chord(t, [74, 77, 81], { att: 0.06 });
        } else if (i > 2) top!.chord(t, k === 0 ? [74, 77, 82] : k === 1 ? [76, 79, 84] : [74, 77, 81], { dip: true, att: 0.1 });
      });
      once(standAt - 1.6, from, to, (t) => {
        revSwell(v, t, standAt - 0.005, 0.06, v.wet, 3800);
        timpRoll(v, t, standAt - 0.004, 0.16, drums!);
      });
      // the held breath before the stand: the wall (not the horns' theme) draws back ~4 dB under the rising swell, then
      // lands on the stand
      once(standAt - 0.95, from, to, (t) => {
        for (const g of [wall!.gain, drums!.gain]) {
          g.setTargetAtTime(dB(-4), t, 0.12);
          g.setTargetAtTime(1, standAt - 0.004, 0.003);
        }
      });
      grid(hitAt + BEAT / 4, BEAT / 4, from, to, (i, t) => {
        const a = (i % 4 === 3 ? 1 : i % 2 ? 0.55 : 0.75) * (0.88 + 0.24 * h01(i, 31));
        const k = Math.floor((t - hitAt) / B);
        const kk = k < 3 ? k : (k - 3) % 3;
        spic(v, t + (h01(i, 32) - 0.5) * 0.007, figs[kk][(i + 1) % 16], 0.06 * a, spBus!);
        if (k >= 1) hats!.hit(t, (i % 2 ? 0.055 : 0.1) * (k >= 2 ? 1.3 : 1), k >= 2 && i % 4 === 1 ? 0.03 : 0.012);
        if (i % 2 === 1) pluck(v, t, i % 8 === 7 ? 50 : 38, { peak: 0.055 * a, tau: 0.09, cutoff: 650, dest: roar });
      });
      steps(hitAt + BAR * 0.25, BAR, from, to, grooveOffs, (_b, k, t) => {
        const [s, lv] = groove[k];
        taiko(v, t, 0.2 * lv, drums!, { f0: s % 4 === 0 ? 84 : 120, f1: s % 4 === 0 ? 52 : 80, dec: s % 4 === 0 ? 0.22 : 0.12, slap: 1.8, sat: dSat! });
      });
    }
  },

  /** Reward: the lift into D major. Warm strings I-IV-vi-V, a harp figure in 8ths, a few slow gold bells. */
  reward(v, start) {
    const str = new Strings(v, start, 6, { wave: 'string', cutoff: 3400, q: 0.5, lfo: [0.05, 600], level: 0.085, dest: v.wet, vib: 15, presence: 2.5, bow: 0.012, hp: 100, weights: [0.55, 0.75, 1, 1, 1, 0.95] });
    const sub = v.gain(0.045, v.dry);
    const so = v.osc('sine', midi(26), start, start + LONG, sub);
    const harpBus = v.gain(0, v.filt('peaking', 2600, 1, v.wet, 2));
    harpBus.gain.setValueAtTime(0, start + BAR * 0.25);
    harpBus.gain.linearRampToValueAtTime(1, start + BAR * 0.8);
    const chords = [Dadd9, Gmaj9, Bm7, Aadd9];
    const tones = [[74, 78, 81, 86], [74, 78, 83, 86], [74, 78, 81, 83], [76, 81, 83, 88]];
    const ci = (t: number) => Math.floor((t - start + 1e-6) / (BAR * 2)) % 4;
    return {
      tick(from, to) {
        grid(start, BAR * 2, from, to, (i, t) => {
          str.chord(t, chords[i % 4], { glide: 0.3, att: 0.35, dip: i > 0, swell: BAR * 2 });
          so.frequency.setTargetAtTime(midi(26 + ((chords[i % 4][0] - 38 + 24) % 12)), t, 0.2);
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
  },

  /** End card: resolved and gentle. Dadd9 and Gmaj9 trade slowly; a high violin line; a high bell now and then. */
  end(v, start) {
    const str = new Strings(v, start, 6, { wave: 'string', cutoff: 2400, q: 0.6, lfo: [0.04, 400], level: 0.11, dest: v.wet, vib: 15, presence: 2, bow: 0.01, hp: 100, weights: [0.55, 0.75, 1, 1, 1, 0.95] });
    const hi = new Strings(v, start, 2, { wave: 'string', cutoff: 5000, level: 0, dest: v.wet, vib: 9, presence: 3, body: 3000 });
    hi.out.gain.setValueAtTime(0, start);
    hi.out.gain.linearRampToValueAtTime(0.028, start + 4);
    // the Warden theme again, now in D major on a solo violin: the same climb, resolved and warm
    const solo = new Strings(v, start, 1, { wave: 'string', cutoff: 5200, level: 0.06, dest: v.wet, vib: 14, presence: 3.5, body: 3000, bow: 0.012, hp: 200, width: 0.5 });
    const motif: [number, number][] = [[0.5, 74], [1.54, 78], [2.58, 76], [3.63, 79], [4.67, 81], [5.71, 86]];
    solo.out.gain.setTargetAtTime(0, start + 10, 1.5);
    const chords = [Dadd9, Gmaj9, Dadd9, Aadd9];
    const tops = [[78, 81], [79, 83], [78, 81], [76, 81]];
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
  },

  /** The daily companion: slow (60 bpm), consonant, quiet but present. Two chords, a soft high layer, rare bells. */
  calm(v, start) {
    const bar = 4;
    // a soft bowed pad, not an organ: slow bow swells, gentle vibrato, warm and a little bright for phone speakers
    const pad = new Strings(v, start, 5, { wave: 'string', cutoff: 1700, q: 0.5, lfo: [0.03, 300], level: 0.075, dest: v.wet, vib: 13, presence: 2.5, body: 2200, hp: 80, bite: 0.25 });
    const hi = new Strings(v, start, 2, { wave: 'warm', cutoff: 3200, level: 0, dest: v.wet, vib: 6, presence: 3, body: 2400 });
    hi.out.gain.setValueAtTime(0.07, start);
    hi.out.gain.linearRampToValueAtTime(0.11, start + 2.5);
    const chords = [[50, 57, 62, 64, 66], [43, 55, 59, 62, 66]];
    const tops = [[74, 78], [74, 79]];
    const penta = [74, 76, 78, 81, 83, 86];
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
  },
};

interface Live {
  name: Section;
  voice: Voice;
  impl: SectionImpl;
  start: number;
  end: number;
  fadeOut: number;
  until: number;
}

/** The score. Sections crossfade; notes are scheduled ahead in windows (live) or all at once (offline). */
export class Music {
  private live: Live[] = [];
  current: Section | null = null;
  constructor(
    private host: MusicHost,
    private dest: AudioNode,
    private ctl: { lp: BiquadFilterNode; shelf: BiquadFilterNode; level: GainNode },
  ) {}

  to(name: Section, crossfade = 2, o: SectionOpts = {}) {
    const lib = this.host.lib;
    const at = o.at ?? lib.ctx.currentTime;
    this.stop(o.fadeOut ?? crossfade, at);
    const voice = new Voice(lib, at, this.dest, { hall: name === "awaken" ? 0.22 : 0.32, room: 0, gain: SECTION_GAIN[name] }, this.host.seed());
    voice.out.gain.setValueAtTime(0, at);
    voice.out.gain.setTargetAtTime(1, at, Math.max(0.004, crossfade / 4));
    const impl = FACTORIES[name](voice, at, o, this.host);
    this.live.push({ name, voice, impl, start: at, end: Infinity, fadeOut: 0, until: at });
    this.current = name;
    this.host.onSection?.(name, at);
  }

  stop(fade = 1, at = this.host.lib.ctx.currentTime) {
    for (const s of this.live) {
      if (s.end === Infinity) {
        s.end = at;
        s.fadeOut = fade;
      }
      // one already fading out ends no later than this
      s.voice.stop(at, fade);
    }
    this.current = null;
  }

  level(v: number, ramp = 1, at = this.host.lib.ctx.currentTime) {
    const g = this.ctl.level.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(v, at, Math.max(0.003, ramp / 4));
  }

  /** Low-pass the whole score (the filter-down before the hush). 20000 = open. */
  lowpass(hz: number, ramp = 1, at = this.host.lib.ctx.currentTime) {
    const f = this.ctl.lp.frequency;
    f.cancelScheduledValues(at);
    f.setTargetAtTime(hz, at, Math.max(0.003, ramp / 4));
  }

  /** Low-shelf lift below 120 Hz (the important-window bass lift, +5 dB). */
  lift(db: number, ramp = 0.5, at = this.host.lib.ctx.currentTime) {
    const g = this.ctl.shelf.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(db, at, Math.max(0.003, ramp / 4));
  }

  /** The director started the hush / played the hit: an open-ended awaken section follows it. */
  onHush(at: number) {
    for (const s of this.live) if (s.name === "awaken" && s.end === Infinity) s.impl.hush?.(at);
  }

  onHit(at: number) {
    for (const s of this.live) if (s.name === "awaken" && s.end === Infinity) s.impl.hit?.(at);
    this.scheduleUntil(Math.max(at, this.host.lib.ctx.currentTime) + 0.05);
  }

  scheduleUntil(t: number) {
    for (const s of this.live) {
      const lim = Math.min(t, s.end);
      if (lim > s.until) {
        s.impl.tick(s.until, lim);
        s.until = lim;
      }
    }
    this.live = this.live.filter((s) => s.end === Infinity || s.end + s.fadeOut * 2 > t - 5);
  }
}
