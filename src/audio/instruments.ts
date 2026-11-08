import { midi } from './dsp';
import { Voice, kRate } from './voice';

export const LONG = 6 * 3600;

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
/**
 * Band-limited tables: 'warm' a saw with a steep 1/n^1.45 rolloff; 'string' a bowed string (1/n^1.05 with the comb of
 * a bow at 1/7 of the string, so the 7th, 14th... harmonics are weak, the way a real bowed spectrum is); 'brass' bright
 * 1/n^0.9 for filter-envelope brass.
 */
export function waveOf(ctx: BaseAudioContext, name: 'warm' | 'string' | 'brass') {
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
export function h01(i: number, salt: number) {
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
export class Strings {
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
  constructor(private v: Voice, t0: number, private n: number, o: StringOpts) {
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
  chord(
    t: number,
    notes: (number | undefined)[],
    o: { glide?: number; att?: number; levels?: number[]; dip?: boolean; swell?: number; depth?: number } = {},
  ) {
    const glide = o.glide ?? 0.06;
    const att = o.att ?? 0.2;
    for (let i = 0; i < this.n; i++) {
      const m = notes[i];
      const g = this.v.at(this.gains[i].gain);
      // players never move together: each part arrives a few ms apart (low parts first, like a real section)
      const ti = t + (o.swell ? i * 0.009 + h01(Math.round(t * 50) + i, 41) * 0.012 : 0);
      if (m === undefined) {
        g.setTargetAtTime(0, ti, 0.12);
        continue;
      }
      for (const os of this.oscs[i]) this.v.at(os.frequency).setTargetAtTime(midi(m), ti, glide);
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
      const b = this.v.at(this.bow.gain);
      b.setTargetAtTime(this.bowLvl * 2, t, 0.03);
      b.setTargetAtTime(this.bowLvl, t + 0.18, 0.5);
    }
    // the bow bites (brighter for a moment), and players add vibrato only once the note has settled
    if (this.bite > 0) {
      const f = this.v.at(this.lp.frequency);
      f.setTargetAtTime(this.cut * (1 + this.bite), t, 0.04);
      f.setTargetAtTime(this.cut, t + 0.16, 0.45);
    }
    for (const g of this.vib) {
      const depth = this.v.at(g.gain);
      depth.setTargetAtTime(this.vibDepth * 0.3, t, 0.04);
      depth.setTargetAtTime(this.vibDepth, t + 0.28, 0.35);
    }
  }
}

/** Synth brass: n voices of 2 detuned oscillators through a shared resonant lowpass; chord(..., accent) adds a brass
 *  'blat' (pitch scoop up from -35 cents, a sforzando that settles). */
export class Pad {
  readonly lp: BiquadFilterNode;
  readonly out: GainNode;
  private oscs: OscillatorNode[][] = [];
  private gains: GainNode[] = [];
  private base: number[][] = [];
  constructor(
    private v: Voice,
    t0: number,
    n: number,
    o: {
      wave: OscillatorType | 'warm' | 'brass'; detune: number; cutoff: number; q: number; lfo?: [number, number];
      level: number; dest: AudioNode; vib?: number; drive?: number
    },
  ) {
    // each voice's detuned pair is split left / right and crossfed (like the strings), so the section has width;
    // x1.84 keeps the power of the old mono sum (per channel 0.71 A + 0.29 B instead of A + B)
    this.out = v.gain(o.level * 1.84, o.dest);
    const into = narrow(v, 0.4, this.out);
    // drive: the brass rasp (a soft tanh after the filter, so loud chords grow edge, not just level)
    // (input scaled by 0.7 so a full chord peaks near the curve's end; output restores small-signal unity gain)
    const d = o.drive ?? 0;
    this.lp = v.filt('lowpass', o.cutoff, o.q,
      d ? v.gain(0.7, v.shaper(d, v.gain(Math.tanh(d) / (d * 0.7), into), 'none')) : into);
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
      const g = this.v.at(this.gains[i].gain);
      if (m === undefined) {
        g.setTargetAtTime(0, t, 0.08);
        continue;
      }
      this.oscs[i].forEach((os, k) => {
        this.v.at(os.frequency).setTargetAtTime(midi(m), t, glide);
        if (accent) {
          const detune = this.v.at(os.detune);
          detune.setValueAtTime(this.base[i][k] - 35 * accent, t);
          detune.linearRampToValueAtTime(this.base[i][k], t + 0.09);
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
export class Choir {
  readonly out: GainNode;
  private oscs: OscillatorNode[][] = [];
  private gains: GainNode[] = [];
  private f1: BiquadFilterNode;
  constructor(private v: Voice, t0: number, n: number, level: number, dest: AudioNode) {
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
        this.v.at(this.gains[i].gain).setTargetAtTime(0, t, 0.1);
        continue;
      }
      for (const os of this.oscs[i]) this.v.at(os.frequency).setTargetAtTime(midi(m), t, glide);
      this.v.at(this.gains[i].gain).setTargetAtTime(1 / Math.sqrt(this.oscs.length), t, 0.15);
    }
    // the vowel opens on each new chord ('oh' -> 'ah')
    const vowel = this.v.at(this.f1.frequency);
    vowel.setTargetAtTime(560, t, 0.02);
    vowel.setTargetAtTime(720, t + 0.08, 0.25);
  }
}

/** A long noise source behind a gain that is struck per event: hats, ticks, bow chiff. tau*8 must be < the spacing. */
export class Hits {
  readonly g: GainNode;
  constructor(private v: Voice, t0: number, color: 'white' | 'pink', into: AudioNode) {
    this.g = v.gain(0, into);
    v.noise(color, t0, t0 + LONG, this.g);
  }
  hit(t: number, peak: number, tau: number, a = 0.0008) {
    const p = this.v.at(this.g.gain);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(0, t + a, tau);
  }
}

/** A shared saturator in front of dest (drums and heartbeats of one section share it; they rarely overlap). */
export function satBus(v: Voice, drive: number, dest: AudioNode, level = 1) {
  return v.shaper(drive, v.gain(level, dest), 'none');
}
