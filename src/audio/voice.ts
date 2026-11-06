import { mulberry32, type Rng } from '../core/math';
import { tanhCurve, type Ctx } from './dsp';
import { SCORE } from '../motion/tokens';
import { renderedTo, silentAfter, soon } from './param';

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

interface Source {
  n: AudioScheduledSourceNode;
  started: boolean;
  stop: number;
  asked: number;
  span: { b: number } | null;
  gains: GainNode[];
  voice: Voice;
}

const feeds = new WeakMap<AudioNode, AudioNode>();
const gainOf = new WeakMap<AudioParam, GainNode>();
const clockOf = new WeakMap<GainNode, Voice>();
const silentFrom = new WeakMap<GainNode, { last: number; at: number; peak: number }>();
const SAME = 1e-9;
const through = new WeakMap<GainNode, Source[]>();
const ownerOf = new WeakMap<AudioNode, Voice>();

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
export const stoppedBy = (at: number, ramp: number) => at + silentAfter(Math.max(0.002, ramp / 4));

interface Placing {
  t: number;
  cancelsBefore: number;
  place(at: number): void;
}

function keep(held: Placing[], t: number, place: (at: number) => void, cancels = false) {
  const cancelsBefore = (held[held.length - 1]?.cancelsBefore ?? 0) + (cancels ? 1 : 0);
  held.push({ t, cancelsBefore, place });
}

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
  /** While held, what it and its children were given to start and set, each placed by open(at) `at` later, earliest
   *  first (never across a cancel). */
  private held: Placing[] | null;
  private sources: Source[] = [];
  /** When its stop() has silenced it and its sources have ended (Infinity until then): a stop is final, and nothing it
   *  is given later, such as a held part opened after it, sounds past it. */
  private killAt = Infinity;
  private children: Voice[] = [];
  private parent: Voice | null = null;
  private parts: Voice[] = [];
  private clock: Voice = this;
  private zero = 0;
  private doors: { to: AudioNode; input: number; g: GainNode }[] = [];
  private gate: ConstantSourceNode | null = null;
  private riders: Voice[] = [];
  shortBy = 0;

  constructor(readonly lib: Lib, t: number, dest: AudioNode, o: VoiceOpts = {}, seed = 1, parent: Voice | null = null) {
    const ctx = lib.ctx;
    this.ctx = ctx;
    this.t = t;
    this.end = t;
    this.held = o.held && !parent ? [] : null;
    if (parent) [this.parent, this.killAt, this.clock] = [parent, parent.killAt, parent.clock];
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
    this.wet.connect(this.roomSend);
    this.wet.connect(this.hallSend);
    let outlet: AudioNode = this.out;
    if (o.pan && (ctx as AudioContext).createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      outlet = this.out.connect(p);
    }
    for (const n of [this.out, this.wet, this.dry, this.roomSend, this.hallSend]) ownerOf.set(n, this.clock);
    const ways: [AudioNode, AudioNode][] = [[outlet, dest], [this.roomSend, lib.room], [this.hallSend, lib.hall]];
    for (const [from, to] of ways) {
      from.connect(this.isHeld && ownerOf.get(to) !== this.clock ? this.holder.door(to, 0) : to);
    }
  }

  /** A sub-voice feeding this one, stopped with it (or on its own). */
  child(dest: AudioNode = this.wet, seed = 7) {
    const c = new Voice(this.lib, this.t, dest, {}, seed, this);
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
  openInTime(at: number) {
    return this.settle(at, true);
  }

  openAt(at: number) {
    this.settle(at, false);
  }

  ride(part: Voice) {
    if (part.isHeld) this.riders.push(part);
  }

  private settle(at: number, inTime: boolean) {
    const voices = [this, ...this.riders.splice(0)];
    const held = voices.flatMap((v) => v.held ?? []);
    for (const v of voices) v.release(at);
    const gate = this.control();
    for (const v of voices.slice(1)) v.share(gate);
    held.sort((a, b) => a.cancelsBefore - b.cancelsBefore || a.t + at - (b.t + at));
    const first = held.reduce((t, h) => Math.min(t, at + h.t), at);
    if (!Number.isFinite(first)) throw new RangeError(`a held voice can't open at ${first}`);
    const rendered = renderedTo(this.ctx);
    const slack = first - rendered();
    for (const [i, h] of held.entries()) {
      if (inTime && first <= rendered()) return this.drop(voices, i ? (slack * (held.length - i)) / i : 0);
      h.place(at);
    }
    if (inTime && first <= rendered()) return this.drop(voices, 0);
    gate.offset.setValueAtTime(1, first);
    const handoff = first + 1;
    gate.offset.setValueAtTime(0, handoff);
    for (const v of voices) for (const d of v.doors) d.g.gain.setValueAtTime(1, handoff);
    gate.stop(handoff + 1);
    this.gate = null;
    return true;
  }

  private drop(voices: Voice[], shortBy: number) {
    this.shortBy = shortBy;
    for (const v of voices) {
      for (const w of [v, ...v.parts]) for (const d of w.doors.splice(0)) d.g.disconnect();
      v.stop(soon(this.ctx), 0);
    }
    return false;
  }

  private control() {
    if (!this.gate) {
      this.gate = this.ctx.createConstantSource();
      this.gate.offset.value = 0;
      this.gate.start();
    }
    return this.gate;
  }

  private share(gate: ConstantSourceNode) {
    this.gate?.stop();
    this.gate = null;
    for (const d of this.doors) gate.connect(d.g.gain);
  }

  private get holder(): Voice {
    return this.parent?.holder ?? this;
  }

  private door(to: AudioNode, input: number) {
    let d = this.doors.find((x) => x.to === to && x.input === input);
    if (!d) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      this.control().connect(g.gain);
      g.connect(to, 0, input);
      this.doors.push((d = { to, input, g }));
    }
    return d.g;
  }

  private link(from: AudioNode, to: AudioNode, input = 0) {
    ownerOf.set(from, this.clock);
    const owner = ownerOf.get(to);
    if (this.isHeld && owner && owner !== this.clock) from.connect(this.holder.door(to, input));
    else from.connect(to, 0, input);
  }

  private release(at: number) {
    this.held = null;
    this.t = at;
    this.zero = at;
    this.end = Math.min(at, this.killAt);
    for (const c of this.children) c.release(at);
  }

  /** `p`'s timed automation, in this voice's time: set at once, or kept while the voice is held and set by open(). */
  at(p: AudioParam): Timed {
    const held = this.holding();
    const set: Timed = held
      ? {
          setValueAtTime: (v, t) => keep(held, t, (d) => p.setValueAtTime(v, t + d)),
          linearRampToValueAtTime: (v, t) => keep(held, t, (d) => p.linearRampToValueAtTime(v, t + d)),
          exponentialRampToValueAtTime: (v, t) => keep(held, t, (d) => p.exponentialRampToValueAtTime(v, t + d)),
          setTargetAtTime: (v, t, tau) => keep(held, t, (d) => p.setTargetAtTime(v, t + d, tau)),
          cancelScheduledValues: (t) => keep(held, t, (d) => p.cancelScheduledValues(t + d), true),
        }
      : p;
    const g = gainOf.get(p);
    return g && clockOf.get(g) === this.clock ? this.envelope(set, g) : set;
  }

  private envelope(set: Timed, g: GainNode): Timed {
    const carried = () => {
      for (const s of through.get(g) ?? []) s.voice.extend(s);
    };
    const peak = () => silentFrom.get(g)?.peak ?? 1;
    const note = (t: number, at: number, level = 0) => {
      const zero = this.clock.zero;
      const e = silentFrom.get(g);
      const loudest = Math.max(e?.peak ?? 1, Math.abs(level));
      if (e && t - zero < e.last - SAME) {
        e.peak = loudest;
        return;
      }
      silentFrom.set(g, { last: t - zero, at: at - zero, peak: loudest });
      if (at - zero !== (e?.at ?? Infinity)) carried();
    };
    return {
      setValueAtTime: (v, t) => {
        set.setValueAtTime(v, t);
        note(t, v ? Infinity : t, v);
      },
      linearRampToValueAtTime: (v, t) => {
        set.linearRampToValueAtTime(v, t);
        note(t, v ? Infinity : t, v);
      },
      exponentialRampToValueAtTime: (v, t) => {
        set.exponentialRampToValueAtTime(v, t);
        note(t, Infinity, v);
      },
      setTargetAtTime: (v, t, tau) => {
        set.setTargetAtTime(v, t, tau);
        note(t, v ? Infinity : t + silentAfter(tau, peak()), v);
      },
      cancelScheduledValues: (t) => {
        set.cancelScheduledValues(t);
        const e = silentFrom.get(g);
        if (e && t - this.clock.zero <= e.last + SAME) {
          silentFrom.delete(g);
          if (e.at !== Infinity) carried();
        }
      },
    };
  }

  sends(room: number, hall: number) {
    this.roomSend.gain.value = room;
    this.hallSend.gain.value = hall;
  }

  private reg<T extends AudioScheduledSourceNode>(n: T, t0: number, t1: number, into: AudioNode, offset = 0) {
    const gains: GainNode[] = [];
    for (let x: AudioNode | undefined = into; x; x = feeds.get(x)) {
      if (x instanceof GainNode && clockOf.get(x) === this.clock) gains.push(x);
    }
    const s: Source = { n, started: false, stop: 0, asked: t1 - this.clock.zero, span: null, gains, voice: this };
    s.stop = this.until(s);
    for (const g of gains) this.pass(g, s);
    const held = this.holding();
    if (held) keep(held, t0, (d) => this.place(s, t0 + d, offset));
    else this.place(s, t0, offset);
    return n;
  }

  private place(s: Source, t0: number, offset: number) {
    if (t0 >= this.killAt) return;
    const zero = this.clock.zero;
    const t1 = Math.min(s.stop + zero, this.killAt);
    s.stop = t1 - zero;
    if (s.n instanceof AudioBufferSourceNode) s.n.start(t0, offset);
    else s.n.start(t0);
    s.n.stop(t1);
    s.started = true;
    s.span = this.lib.track(t0, t1);
    this.sources.push(s);
    if (t1 > this.end) this.end = t1;
  }

  private pass(g: GainNode, s: Source) {
    let list = through.get(g);
    if (!list) through.set(g, (list = []));
    else if (list.length >= 8 && !(list.length & (list.length - 1))) {
      const now = this.ctx.currentTime;
      let k = 0;
      for (const o of list) if (o.voice.isHeld || o.stop + o.voice.clock.zero > now) list[k++] = o;
      list.length = k;
    }
    list.push(s);
  }

  private until(s: Source) {
    let silent = Infinity;
    for (const g of s.gains) silent = Math.min(silent, silentFrom.get(g)?.at ?? Infinity);
    const stop = silent === Infinity ? s.asked : Math.max(s.asked, silent);
    return this.isHeld ? stop : Math.min(stop, this.killAt - this.clock.zero);
  }

  private extend(s: Source) {
    const stop = this.until(s);
    if (stop <= s.stop) return;
    if (this.isHeld) {
      s.stop = stop;
      return;
    }
    const zero = this.clock.zero;
    if (!s.started || s.stop + zero <= this.ctx.currentTime) return;
    s.n.stop(stop + zero);
    s.stop = stop;
    if (s.span) s.span.b = stop + zero;
    if (stop + zero > this.end) this.end = stop + zero;
  }

  osc(type: OscillatorType | PeriodicWave, freq: number, t0: number, t1: number, dest: AudioNode, input = 0) {
    const o = this.ctx.createOscillator();
    if (typeof type === "string") o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    o.frequency.value = freq;
    if (this.cents) o.detune.value = this.cents;
    this.link(o, dest, input);
    return this.reg(o, t0, t1, dest);
  }

  noise(color: 'white' | 'pink' | 'brown', t0: number, t1: number, dest: AudioNode, rate = 1) {
    const b = this.lib[color];
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.playbackRate.value = rate;
    this.link(s, dest);
    return this.reg(s, t0, t1, dest, this.rng() * (b.duration - 0.1));
  }

  /** Loop a buffer from t0 to t1 (start offset 0, so renders stay deterministic). */
  loop(b: AudioBuffer, t0: number, t1: number, dest: AudioNode) {
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    this.link(s, dest);
    return this.reg(s, t0, t1, dest);
  }

  buffer(b: AudioBuffer, t0: number, dest: AudioNode, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    this.link(s, dest);
    return this.reg(s, t0, t0 + b.duration / rate + 0.01, dest);
  }

  gain(v: number, dest: AudioNode | AudioParam) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    gainOf.set(g.gain, g);
    clockOf.set(g, this.clock);
    if (dest instanceof AudioParam) g.connect(dest);
    else this.link(g, dest);
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
    this.link(b, dest);
    feeds.set(b, dest);
    return b;
  }

  shaper(drive: number, dest: AudioNode, oversample: OverSampleType = '2x') {
    const w = this.ctx.createWaveShaper();
    w.curve = tanhCurve(drive) as Float32Array<ArrayBuffer>;
    w.oversample = oversample;
    this.link(w, dest);
    feeds.set(w, dest);
    return w;
  }

  pan(p: number, dest: AudioNode): AudioNode {
    if (!(this.ctx as AudioContext).createStereoPanner) return dest;
    const n = this.ctx.createStereoPanner();
    n.pan.value = p;
    kRate(n.pan);
    this.link(n, dest);
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
    return t + a + hold + silentAfter(tau, Math.max(1, peak));
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
    const t = Math.max(at, soon(this.ctx));
    const kill = stoppedBy(t, ramp);
    if (kill >= this.killAt) return false;
    this.killAt = kill;
    const tau = Math.max(0.002, ramp / 4);
    for (const g of [this.out.gain, this.roomSend.gain, this.hallSend.gain]) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, tau);
    }
    for (const c of [...this.children, ...this.parts]) c.stop(at, ramp);
    const zero = this.clock.zero;
    for (const s of this.sources) {
      if (s.stop + zero > kill) {
        const end = Math.max(kill, soon(this.ctx));
        try {
          s.n.stop(end);
          s.stop = end - zero;
          if (s.span) s.span.b = end;
        } catch {
          /* already stopped */
        }
      }
    }
    this.end = Math.min(this.end, kill);
    this.gate?.stop(kill);
    return true;
  }

  get isHeld() {
    return this.holding() !== null;
  }

  private holding(): Placing[] | null {
    return this.parent ? this.parent.holding() : this.held;
  }

  get isStopped() {
    return this.killAt !== Infinity;
  }

  get silentAt() {
    return this.killAt;
  }
}

export function openBuilt<T extends { voice: Voice }>(ctx: Ctx, asked: number | undefined, build: () => T) {
  for (let extra = 0, missed = 0; ; missed++) {
    const built = build();
    const at = Math.max(asked ?? -Infinity, soon(ctx)) + extra;
    if (built.voice.openInTime(at)) return { ...built, at };
    if (missed) extra = Math.max(2 * extra + SCORE.leadSec, built.voice.shortBy);
  }
}
