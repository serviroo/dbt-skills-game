import { mulberry32, type Rng } from '../core/math';
import { tanhCurve, type Ctx } from './dsp';

/** Shared, engine-owned resources every voice can draw on. */
export interface Lib {
  ctx: Ctx;
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  crackle: AudioBuffer;
  crackleLong: AudioBuffer;
  room: AudioNode;
  hall: AudioNode;
  live: boolean;
  track(t0: number, t1: number): { b: number } | null;
}

/** Slow modulation does not need per-sample coefficients; k-rate makes filters and vibrato ~10x cheaper. */
export function kRate(...ps: AudioParam[]) {
  for (const p of ps) {
    try {
      p.automationRate = "k-rate";
    } catch {
      /* not supported: stays a-rate */
    }
  }
}

export interface VoiceOpts {
  gain?: number;
  pan?: number;
  detune?: number;
  room?: number;
  hall?: number;
}

/** When a voice stopped at `at` over `ramp` (see Voice.stop) has gone silent and its sources have ended. */
export const stoppedBy = (at: number, ramp: number) => at + ramp * 1.6 + 0.02;

/**
 * One sounding thing (a cue, a bed, a music layer). Owns a stop-able output, optional reverb sends, a pan, and a
 * transposition (detune in cents applied to every oscillator and filter it creates).
 */
export class Voice {
  readonly ctx: Ctx;
  readonly out: GainNode;
  readonly wet: GainNode;
  readonly dry: GainNode;
  readonly roomSend: GainNode;
  readonly hallSend: GainNode;
  readonly cents: number;
  readonly rng: Rng;
  end: number;
  private sources: { n: AudioScheduledSourceNode; stop: number; span: { b: number } | null }[] = [];
  private stopped = false;
  private children: Voice[] = [];

  constructor(readonly lib: Lib, readonly t: number, dest: AudioNode, o: VoiceOpts = {}, seed = 1) {
    const ctx = lib.ctx;
    this.ctx = ctx;
    this.end = t;
    this.cents = o.detune ?? 0;
    this.rng = mulberry32(seed);
    this.out = ctx.createGain();
    this.wet = ctx.createGain();
    this.dry = ctx.createGain();
    const g = o.gain ?? 1;
    this.wet.gain.value = g;
    this.dry.gain.value = g;
    this.wet.connect(this.out);
    this.dry.connect(this.out);
    this.roomSend = ctx.createGain();
    this.hallSend = ctx.createGain();
    this.roomSend.gain.value = o.room ?? 0;
    this.hallSend.gain.value = o.hall ?? 0;
    this.wet.connect(this.roomSend).connect(lib.room);
    this.wet.connect(this.hallSend).connect(lib.hall);
    if (o.pan && (ctx as AudioContext).createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      this.out.connect(p).connect(dest);
    } else this.out.connect(dest);
  }

  /** A sub-voice feeding this one, stopped with it (or on its own). */
  child(dest: AudioNode = this.wet, seed = 7) {
    const c = new Voice(this.lib, this.t, dest, {}, seed);
    this.children.push(c);
    return c;
  }

  sends(room: number, hall: number) {
    this.roomSend.gain.value = room;
    this.hallSend.gain.value = hall;
  }

  private reg<T extends AudioScheduledSourceNode>(n: T, t0: number, t1: number) {
    n.start(t0);
    n.stop(t1);
    this.sources.push({ n, stop: t1, span: this.lib.track(t0, t1) });
    if (t1 > this.end) this.end = t1;
    return n;
  }

  osc(type: OscillatorType | PeriodicWave, freq: number, t0: number, t1: number, dest: AudioNode, input = 0) {
    const o = this.ctx.createOscillator();
    if (typeof type === "string") o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    o.frequency.value = freq;
    if (this.cents) o.detune.value = this.cents;
    o.connect(dest, 0, input);
    return this.reg(o, t0, t1);
  }

  noise(color: 'white' | 'pink' | 'brown', t0: number, t1: number, dest: AudioNode, rate = 1) {
    const b = this.lib[color];
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    const off = this.rng() * (b.duration - 0.1);
    s.start(t0, off);
    s.stop(t1);
    this.sources.push({ n: s, stop: t1, span: this.lib.track(t0, t1) });
    if (t1 > this.end) this.end = t1;
    return s;
  }

  /** Loop a buffer from t0 to t1 (start offset 0, so renders stay deterministic). */
  loop(b: AudioBuffer, t0: number, t1: number, dest: AudioNode) {
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.connect(dest);
    return this.reg(s, t0, t1);
  }

  buffer(b: AudioBuffer, t0: number, dest: AudioNode, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    s.connect(dest);
    return this.reg(s, t0, t0 + b.duration / rate + 0.01);
  }

  gain(v: number, dest: AudioNode | AudioParam) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest instanceof AudioParam) g.connect(dest);
    else g.connect(dest);
    return g;
  }

  filt(type: BiquadFilterType, f: number, q: number, dest: AudioNode, gainDb = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (gainDb) b.gain.value = gainDb;
    if (this.cents) b.detune.value = this.cents;
    kRate(b.frequency, b.Q, b.gain, b.detune);
    b.connect(dest);
    return b;
  }

  shaper(drive: number, dest: AudioNode, oversample: OverSampleType = '2x') {
    const w = this.ctx.createWaveShaper();
    w.curve = tanhCurve(drive) as Float32Array<ArrayBuffer>;
    w.oversample = oversample;
    w.connect(dest);
    return w;
  }

  pan(p: number, dest: AudioNode): AudioNode {
    if (!(this.ctx as AudioContext).createStereoPanner) return dest;
    const n = this.ctx.createStereoPanner();
    n.pan.value = p;
    kRate(n.pan);
    n.connect(dest);
    return n;
  }

  /** Linear attack to peak, optional hold, exponential decay (tau). Returns when it is ~-70 dB. */
  perc(p: AudioParam, t: number, peak: number, a: number, tau: number, hold = 0) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) p.setValueAtTime(peak, t + a + hold);
    p.setTargetAtTime(0, t + a + hold, tau);
    return t + a + hold + tau * 8;
  }

  /** Exponential (linear-in-dB) move between two levels. */
  ramp(p: AudioParam, t: number, from: number, to: number, dur: number) {
    p.setValueAtTime(Math.max(from, 1e-5), t);
    p.exponentialRampToValueAtTime(Math.max(to, 1e-5), t + dur);
  }

  /** Low-frequency modulator added onto a param: param += depth * wave(rate). */
  lfo(rate: number, depth: number, p: AudioParam, t0: number, t1: number, type: OscillatorType = 'sine') {
    const g = this.ctx.createGain();
    g.gain.value = depth;
    g.connect(p);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = rate;
    o.connect(g);
    return this.reg(o, t0, t1);
  }

  /**
   * Two-operator FM tone. ratio = modulator/carrier, index = peak deviation / modulator frequency (decays with idxTau
   * toward idxEnd, so the attack is bright and the body pure). Optional extra sine partials (ratio, rel amp, tau).
   */
  fm(o: {
    t: number;
    f: number;
    ratio: number;
    index: number;
    idxEnd?: number;
    idxTau?: number;
    a?: number;
    tau: number;
    hold?: number;
    peak: number;
    dest: AudioNode;
    partials?: [number, number, number][];
    vib?: [number, number];
  }) {
    const a = o.a ?? 0.005;
    const amp = this.gain(0, o.dest);
    const end = this.perc(amp.gain, o.t, o.peak, a, o.tau, o.hold ?? 0);
    const car = this.osc('sine', o.f, o.t, end, amp);
    if (o.index > 0) {
      const fmHz = o.f * o.ratio;
      const dev = this.gain(0, car.frequency);
      const k = Math.pow(2, this.cents / 1200);
      dev.gain.setValueAtTime(o.index * fmHz * k, o.t);
      dev.gain.setTargetAtTime((o.idxEnd ?? 0) * fmHz * k, o.t + a, o.idxTau ?? o.tau * 0.5);
      this.osc('sine', fmHz, o.t, end, dev);
    }
    if (o.vib) this.lfo(o.vib[0], o.vib[1] * o.f, car.frequency, o.t, end);
    for (const [r, rel, tau] of o.partials ?? []) {
      const g = this.gain(0, o.dest);
      const e = this.perc(g.gain, o.t, o.peak * rel, a, tau);
      this.osc('sine', o.f * r, o.t, e, g);
    }
    return end;
  }

  /** Fade this voice out from `at` over `ramp` seconds and stop its sources. */
  stop(at: number, ramp = 0.03) {
    if (this.stopped) return;
    this.stopped = true;
    for (const c of this.children) c.stop(at, ramp);
    const tau = Math.max(0.002, ramp / 4);
    for (const g of [this.out.gain, this.roomSend.gain, this.hallSend.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(0, at, tau);
    }
    const kill = stoppedBy(at, ramp);
    for (const s of this.sources) {
      if (s.stop > kill) {
        try {
          s.n.stop(kill);
          s.stop = kill;
          if (s.span) s.span.b = kill;
        } catch {
          /* already stopped */
        }
      }
    }
    this.end = Math.min(this.end, kill);
  }

  get isStopped() {
    return this.stopped;
  }
}
