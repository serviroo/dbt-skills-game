import { mulberry32, type Rng } from '../core/math';
import { tanhCurve, type Ctx } from './dsp';
import { silentAfter } from './param';

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

/** One AudioParam's timed automation, in its voice's time (see Voice.at). */
export interface Timed {
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
  setTargetAtTime(v: number, t: number, tau: number): void;
  cancelScheduledValues(t: number): void;
}

/** A source a voice started, and the gains its sound passes through on its way out of the voice. */
interface Source {
  n: AudioScheduledSourceNode;
  stop: number;
  /** The stop it was given. */
  asked: number;
  span: { b: number } | null;
  gains: GainNode[];
  voice: Voice;
}

/** The node each node a voice makes feeds, and the gain each of its gains' params belongs to: a source's way out. */
const feeds = new WeakMap<AudioNode, AudioNode>();
const gainOf = new WeakMap<AudioParam, GainNode>();
/** When a gain's automation, from its latest point on, leaves it silent for good (Infinity while it doesn't). */
const silentFrom = new WeakMap<GainNode, { last: number; at: number }>();
/** The sources still playing whose sound passes through each gain. */
const through = new WeakMap<GainNode, Source[]>();

export interface VoiceOpts {
  gain?: number;
  pan?: number;
  detune?: number;
  room?: number;
  hall?: number;
  /** Start and set nothing until open(): the times it is given until then count from its opening. */
  held?: boolean;
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
  /** When it starts (context time); open() sets a held voice's. */
  t: number;
  end: number;
  private sources: Source[] = [];
  /** While held, what it was given to start and set, each placed by open(at) `at` later. */
  private held: ((at: number) => void)[] | null;
  /** When its stop() has silenced it and its sources have ended (Infinity until then): a stop is final, and nothing it
   *  is given later, such as a held part opened after it, sounds past it. */
  private killAt = Infinity;
  private children: Voice[] = [];
  private parts: Voice[] = [];

  constructor(readonly lib: Lib, t: number, dest: AudioNode, o: VoiceOpts = {}, seed = 1) {
    const ctx = lib.ctx;
    this.ctx = ctx;
    this.t = t;
    this.end = t;
    this.held = o.held ? [] : null;
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
    const c = new Voice(this.lib, this.t, dest, { held: !!this.held }, seed);
    c.killAt = this.killAt;
    this.children.push(c);
    return c;
  }

  /** A held sub-voice that starts on its own open(), stopped with this one. */
  part(dest: AudioNode = this.wet, seed = 7) {
    const c = new Voice(this.lib, this.t, dest, { held: true }, seed);
    c.killAt = this.killAt;
    this.parts.push(c);
    return c;
  }

  /** Starts and sets what this held voice and its children were given, `at` later; from then on times are the clock's. */
  open(at: number) {
    const held = this.held ?? [];
    this.held = null;
    this.t = at;
    this.end = Math.min(at, this.killAt);
    for (const c of this.children) c.open(at);
    for (const f of held) f(at);
  }

  /** `p`'s timed automation, in this voice's time: set at once, or kept while the voice is held and set by open(). On a
   *  gain the voice made, the sources that gain carries play on until it has fallen silent. */
  at(p: AudioParam): Timed {
    const g = gainOf.get(p);
    const now = g ? this.envelope(p, g) : p;
    const held = this.held;
    if (!held) return now;
    return {
      setValueAtTime: (v, t) => void held.push((d) => now.setValueAtTime(v, t + d)),
      linearRampToValueAtTime: (v, t) => void held.push((d) => now.linearRampToValueAtTime(v, t + d)),
      exponentialRampToValueAtTime: (v, t) => void held.push((d) => now.exponentialRampToValueAtTime(v, t + d)),
      setTargetAtTime: (v, t, tau) => void held.push((d) => now.setTargetAtTime(v, t + d, tau)),
      cancelScheduledValues: (t) => void held.push((d) => now.cancelScheduledValues(t + d)),
    };
  }

  /** Sets `p`, the param of gain `g`, noting when its latest point leaves `g` silent for good, and keeps the sources `g`
   *  carries playing until then. */
  private envelope(p: AudioParam, g: GainNode): Timed {
    const carried = () => {
      for (const s of through.get(g) ?? []) s.voice.extend(s);
    };
    const note = (t: number, at: number) => {
      const e = silentFrom.get(g);
      if (e && t < e.last) return;
      silentFrom.set(g, { last: t, at });
      carried();
    };
    return {
      setValueAtTime: (v, t) => {
        p.setValueAtTime(v, t);
        note(t, v ? Infinity : t);
      },
      linearRampToValueAtTime: (v, t) => {
        p.linearRampToValueAtTime(v, t);
        note(t, v ? Infinity : t);
      },
      exponentialRampToValueAtTime: (v, t) => {
        p.exponentialRampToValueAtTime(v, t);
        note(t, Infinity);
      },
      setTargetAtTime: (v, t, tau) => {
        p.setTargetAtTime(v, t, tau);
        note(t, v ? Infinity : t + silentAfter(tau));
      },
      cancelScheduledValues: (t) => {
        p.cancelScheduledValues(t);
        // its latest point is gone, and with it what was known of how it ends
        if (t <= (silentFrom.get(g)?.last ?? -Infinity)) {
          silentFrom.delete(g);
          carried();
        }
      },
    };
  }

  sends(room: number, hall: number) {
    this.roomSend.gain.value = room;
    this.hallSend.gain.value = hall;
  }

  /** Starts a source that feeds `into`, and stops it at `t1`, or once a gain on its way out has fallen silent. */
  private reg<T extends AudioScheduledSourceNode>(n: T, t0: number, t1: number, into: AudioNode, offset = 0) {
    if (this.held) {
      this.held.push((d) => this.reg(n, t0 + d, t1 + d, into, offset));
      return n;
    }
    if (t0 >= this.killAt) return n;
    if (n instanceof AudioBufferSourceNode) n.start(t0, offset);
    else n.start(t0);
    const gains: GainNode[] = [];
    for (let x: AudioNode | undefined = into; x; x = feeds.get(x)) if (x instanceof GainNode) gains.push(x);
    const s: Source = { n, stop: t1, asked: t1, span: null, gains, voice: this };
    s.stop = this.until(s);
    n.stop(s.stop);
    s.span = this.lib.track(t0, s.stop);
    this.sources.push(s);
    const now = this.ctx.currentTime;
    for (const g of gains) through.set(g, [...(through.get(g) ?? []).filter((o) => o.stop > now), s]);
    if (s.stop > this.end) this.end = s.stop;
    return n;
  }

  /** When a source stops: when it was asked to, or once the first gain on its way out falls silent if that is later
   *  (one silent gain silences the whole way out), and never past this voice's own stop. */
  private until(s: Source) {
    const silent = Math.min(...s.gains.map((g) => silentFrom.get(g)?.at ?? Infinity));
    return Math.min(silent === Infinity ? s.asked : Math.max(s.asked, silent), this.killAt);
  }

  /** Moves a source's stop later, if a gain on its way out now falls silent after it. */
  private extend(s: Source) {
    const stop = this.until(s);
    if (stop <= s.stop) return;
    try {
      s.n.stop(stop);
    } catch {
      /* already stopped */
      return;
    }
    s.stop = stop;
    if (s.span) s.span.b = stop;
    if (stop > this.end) this.end = stop;
  }

  osc(type: OscillatorType | PeriodicWave, freq: number, t0: number, t1: number, dest: AudioNode, input = 0) {
    const o = this.ctx.createOscillator();
    if (typeof type === "string") o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    o.frequency.value = freq;
    if (this.cents) o.detune.value = this.cents;
    o.connect(dest, 0, input);
    return this.reg(o, t0, t1, dest);
  }

  noise(color: 'white' | 'pink' | 'brown', t0: number, t1: number, dest: AudioNode, rate = 1) {
    const b = this.lib[color];
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    return this.reg(s, t0, t1, dest, this.rng() * (b.duration - 0.1));
  }

  /** Loop a buffer from t0 to t1 (start offset 0, so renders stay deterministic). */
  loop(b: AudioBuffer, t0: number, t1: number, dest: AudioNode) {
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.connect(dest);
    return this.reg(s, t0, t1, dest);
  }

  buffer(b: AudioBuffer, t0: number, dest: AudioNode, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    s.connect(dest);
    return this.reg(s, t0, t0 + b.duration / rate + 0.01, dest);
  }

  gain(v: number, dest: AudioNode | AudioParam) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    gainOf.set(g.gain, g);
    if (dest instanceof AudioParam) g.connect(dest);
    else g.connect(dest);
    const next = dest instanceof AudioParam ? gainOf.get(dest) : dest;
    if (next) feeds.set(g, next);
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
    feeds.set(b, dest);
    return b;
  }

  shaper(drive: number, dest: AudioNode, oversample: OverSampleType = '2x') {
    const w = this.ctx.createWaveShaper();
    w.curve = tanhCurve(drive) as Float32Array<ArrayBuffer>;
    w.oversample = oversample;
    w.connect(dest);
    feeds.set(w, dest);
    return w;
  }

  pan(p: number, dest: AudioNode): AudioNode {
    if (!(this.ctx as AudioContext).createStereoPanner) return dest;
    const n = this.ctx.createStereoPanner();
    n.pan.value = p;
    kRate(n.pan);
    n.connect(dest);
    feeds.set(n, dest);
    return n;
  }

  /** Linear attack to peak, optional hold, exponential decay (tau). Returns when it has fallen silent. */
  perc(param: AudioParam, t: number, peak: number, a: number, tau: number, hold = 0) {
    const p = this.at(param);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) p.setValueAtTime(peak, t + a + hold);
    p.setTargetAtTime(0, t + a + hold, tau);
    return t + a + hold + silentAfter(tau);
  }

  /** Exponential (linear-in-dB) move between two levels. */
  ramp(param: AudioParam, t: number, from: number, to: number, dur: number) {
    const p = this.at(param);
    p.setValueAtTime(Math.max(from, 1e-5), t);
    p.exponentialRampToValueAtTime(Math.max(to, 1e-5), t + dur);
  }

  /** Low-frequency modulator added onto a param: param += depth * wave(rate). */
  lfo(rate: number, depth: number, p: AudioParam, t0: number, t1: number, type: OscillatorType = 'sine') {
    const g = this.ctx.createGain();
    g.gain.value = depth;
    g.connect(p);
    const next = gainOf.get(p);
    if (next) feeds.set(g, next);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = rate;
    o.connect(g);
    return this.reg(o, t0, t1, g);
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
      const idx = this.at(dev.gain);
      idx.setValueAtTime(o.index * fmHz * k, o.t);
      idx.setTargetAtTime((o.idxEnd ?? 0) * fmHz * k, o.t + a, o.idxTau ?? o.tau * 0.5);
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
    if (this.killAt !== Infinity) return;
    const kill = stoppedBy(at, ramp);
    this.killAt = kill;
    for (const c of [...this.children, ...this.parts]) c.stop(at, ramp);
    const tau = Math.max(0.002, ramp / 4);
    for (const g of [this.out.gain, this.roomSend.gain, this.hallSend.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(0, at, tau);
    }
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
    return this.killAt !== Infinity;
  }
}
