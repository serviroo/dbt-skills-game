import { mulberry32, type Rng } from '../core/math';

export type Ctx = BaseAudioContext;

export const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const dB = (d: number) => Math.pow(10, d / 20);

/** Sample a CSS cubic-bezier for setValueCurveAtTime. */
export function bezierCurve(x1: number, y1: number, x2: number, y2: number, n = 48, from = 0, to = 1) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let t = x;
    for (let k = 0; k < 10; k++) {
      const e = ((ax * t + bx) * t + cx) * t - x;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    t = Math.min(1, Math.max(0, t));
    out[i] = from + (to - from) * (((ay * t + by) * t + cy) * t);
  }
  return out;
}

/**
 * Seamlessly looping stereo noise. Every colour is normalised to the same RMS (0.3) so recipes can mix them by dB.
 * The loop seam is an equal-power crossfade into the samples that precede index 0, so even brown noise has no click.
 */
export function makeNoise(ctx: Ctx, seed: number, seconds: number, color: 'white' | 'pink' | 'brown') {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const fade = Math.floor(0.05 * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = mulberry32(seed * 977 + ch * 7919 + 13);
    const raw = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = r() * 2 - 1;
      if (color === 'white') raw[i] = w;
      else if (color === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      } else {
        br = (br + 0.02 * w) / 1.02;
        raw[i] = br;
      }
    }
    if (color === 'brown') {
      let m = 0;
      for (let i = 0; i < raw.length; i++) m += raw[i];
      m /= raw.length;
      for (let i = 0; i < raw.length; i++) raw[i] -= m;
    }
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = raw[fade + i];
    for (let i = 0; i < fade; i++) {
      const x = (i + 0.5) / fade;
      d[len - fade + i] = d[len - fade + i] * Math.cos((x * Math.PI) / 2) + raw[i] * Math.sin((x * Math.PI) / 2);
    }
    let s = 0;
    for (let i = 0; i < len; i++) s += d[i] * d[i];
    const k = 0.3 / Math.sqrt(s / len);
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  return buf;
}

/**
 * Generated stereo impulse response: early reflections, a smooth diffuse onset, exponential decay at the given RT60,
 * and frequency-dependent damping (the tail darkens as it decays, like a real stone hall). Energy normalised to 1 per
 * channel so a send of s returns the signal's energy scaled by s².
 */
export function makeIR(
  ctx: Ctx,
  seed: number,
  o: { rt60: number; length: number; preDelay: number; damp0: number; damp1: number; early: number; onset: number },
) {
  const sr = ctx.sampleRate;
  const pre = Math.floor(o.preDelay * sr);
  const n = pre + Math.floor(o.length * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = mulberry32(seed * 131 + ch * 1009 + 7);
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const fc = o.damp0 * Math.pow(o.damp1 / o.damp0, Math.min(1, t / o.length));
      const a = Math.exp((-2 * Math.PI * fc) / sr);
      const w = r() * 2 - 1;
      y = (1 - a) * w + a * y;
      const onset = t < o.onset ? Math.sin(((t / o.onset) * Math.PI) / 2) : 1;
      const tail = t > o.length - 0.15 ? Math.max(0, (o.length - t) / 0.15) : 1;
      d[i] = y * Math.exp((-6.9 * t) / o.rt60) * onset * tail * (1 + 0.6 * (fc / o.damp0));
    }
    const taps = 9;
    for (let k = 0; k < taps; k++) {
      const tt = 0.004 + r() * o.early;
      const idx = pre + Math.floor(tt * sr);
      if (idx < n) d[idx] += (r() < 0.5 ? -1 : 1) * (0.5 - 0.35 * (tt / o.early)) * 0.6;
    }
    let s = 0;
    for (let i = 0; i < n; i++) s += d[i] * d[i];
    const k = 1 / Math.sqrt(s);
    for (let i = 0; i < n; i++) d[i] *= k;
  }
  return buf;
}

/** A short crackle buffer: clustered 1-3 ms broadband clicks with decaying amplitude (ice or electricity snapping). */
export function makeCrackle(ctx: Ctx, seed: number, seconds: number, clicks: number) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = mulberry32(seed * 53 + ch * 17 + 3);
    const d = buf.getChannelData(ch);
    let t = 0;
    for (let k = 0; k < clicks; k++) {
      t += Math.pow(r(), 1.8) * (seconds / clicks) * 1.6;
      if (t > seconds - 0.01) break;
      const amp = (0.35 + 0.65 * r()) * Math.exp(-2.6 * (t / seconds));
      const len = Math.floor((0.0006 + 0.0024 * r()) * sr);
      const i0 = Math.floor(t * sr);
      for (let i = 0; i < len && i0 + i < n; i++) {
        const e = Math.exp((-5 * i) / len);
        d[i0 + i] += (r() * 2 - 1) * amp * e;
      }
    }
  }
  return buf;
}

const shaperCache = new Map<string, Float32Array>();
/** tanh saturation curve, unity slope near zero, normalised so ±1 in gives ±1 out. */
export function tanhCurve(drive: number) {
  const key = 'tanh' + drive;
  let c = shaperCache.get(key);
  if (!c) {
    c = new Float32Array(2049);
    const norm = Math.tanh(drive);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(drive * x) / norm;
    }
    shaperCache.set(key, c);
  }
  return c;
}

/** Transparent below `knee`, smooth tanh shoulder up to `ceiling`. Last line of defence before the output. */
export function clipCurve(knee: number, ceiling: number) {
  const c = new Float32Array(8193);
  const span = ceiling - knee;
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export type { Rng };
