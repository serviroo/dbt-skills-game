import { bezierCurve, midi } from './dsp';
import type { Voice } from './voice';

export interface CueDef {
  /** Nominal length in seconds including tails (used by offline cue renders). */
  len: number;
  /** Mix trim in dB, set from loudness measurements. */
  gainDb?: number;
  room?: number;
  hall?: number;
  fn: (v: Voice, o: { dur?: number }) => void;
}

/** Piecewise-linear automation from (dt, value) points relative to t. */
function pts(p: AudioParam, t: number, points: [number, number][]) {
  p.setValueAtTime(points[0][1], t + points[0][0]);
  for (let i = 1; i < points.length; i++) p.linearRampToValueAtTime(points[i][1], t + points[i][0]);
}

function expTo(p: AudioParam, t: number, from: number, to: number, dur: number) {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(to, t + dur);
}

/** A value curve as linear ramps: WebKit shifts setValueCurveAtTime to "now", so later events would overlap and throw. */
function curveAt(p: AudioParam, values: Float32Array, t: number, dur: number) {
  p.cancelScheduledValues(t);
  p.setValueAtTime(values[0], t);
  for (let i = 1; i < values.length; i++) p.linearRampToValueAtTime(values[i], t + (dur * i) / (values.length - 1));
}

const IGNITION = bezierCurve(0.7, 0, 0.95, 0.55, 64);

/** Soft-attack envelope: a sine-shaped swell to peak over `a` (no corner at the start, so no click), optional hold,
 *  exponential decay. Built from short linear ramps (never setValueCurveAtTime: WebKit shifts it and throws). */
function swell(p: AudioParam, t: number, peak: number, a: number, tau: number, hold = 0) {
  p.setValueAtTime(0, t);
  const N = 6;
  for (let i = 1; i <= N; i++) p.linearRampToValueAtTime(peak * 0.5 * (1 - Math.cos((Math.PI * i) / N)), t + (a * i) / N);
  if (hold > 0) p.setValueAtTime(peak, t + a + hold);
  p.setTargetAtTime(0, t + a + hold, tau);
}

/**
 * The softened core of the AWAKEN hit, shared with the chest burst. Every layer swells in over 36-56 ms instead of
 * snapping in 0.6-3 ms: the same weight and the same downbeat, with no click at the front that could startle.
 */
function boom(v: Voice, t: number, s: { level: number; f0: number; f1: number; body: number; crack: number; sub: number }) {
  const L = s.level;
  // 1) sine sweep 120 -> 45 Hz over 400 ms: the felt drop (weight only; phones lose it)
  const sw = v.gain(0, v.dry);
  swell(sw.gain, t, 0.26 * L, 0.056, 0.28, 0.03);
  const so = v.osc('sine', s.f0, t, t + 2.4, sw);
  expTo(so.frequency, t, s.f0, s.f1, 0.4);
  // 2) low-mid body 150 Hz-1 kHz (the band that jumps +21.6 dB): a saturated falling triangle whose harmonics fill
  //    200-1200 Hz, plus pink noise band-passed 300-900 Hz with a 600 ms exponential decay
  const bodyOut = v.filt('lowpass', 1600, 0.6, v.wet);
  const shp = v.shaper(3.6, v.gain(0.6 * L * s.body, bodyOut));
  const tg = v.gain(0, shp);
  swell(tg.gain, t, 0.9, 0.05, 0.15, 0.02);
  const tri = v.osc('triangle', s.f0 * 2, t, t + 1.6, tg);
  expTo(tri.frequency, t, s.f0 * 2, s.f1 * 2, 0.35);
  const nb = v.gain(0, v.filt('bandpass', 520, 0.7, v.filt('highpass', 280, 0.7, v.wet)));
  swell(nb.gain, t, 3.2 * L * s.body, 0.056, 0.15, 0.02);
  v.noise('pink', t, t + 1.6, nb);
  const nw = v.gain(0, v.filt('bandpass', 760, 0.9, v.wet));
  swell(nw.gain, t, 1.1 * L * s.body, 0.046, 0.08);
  v.noise('white', t, t + 0.9, nw);
  // 3) presence in 1-4 kHz (+15 dB band), now swelled rather than snapped: the 2.3 kHz edge and the 1.3 kHz thud
  //    arrive with the body, and the sizzle above 4 kHz is a breath, not a crack
  const ck = v.gain(0, v.filt('bandpass', 2300, 0.8, v.wet));
  swell(ck.gain, t, 0.5 * L * s.crack, 0.036, 0.03);
  v.noise('white', t, t + 0.4, ck);
  const th = v.gain(0, v.filt('bandpass', 1300, 1.1, v.wet));
  swell(th.gain, t, 0.75 * L * s.crack, 0.04, 0.05);
  v.noise('white', t, t + 0.5, th);
  const hz = v.gain(0, v.filt('highpass', 4300, 0.7, v.wet));
  swell(hz.gain, t, 0.1 * L * s.crack, 0.042, 0.07);
  v.noise('white', t, t + 0.7, hz);
  // 4) sub tail
  const st = v.gain(0, v.dry);
  v.perc(st.gain, t + 0.04, 0.16 * L * s.sub, 0.03, 0.7);
  v.osc('sine', s.f1, t + 0.04, t + 6, st);
}

function glints(v: Voice, t0: number, t1: number, n: number, notes: number[], peak: number, dest: AudioNode) {
  for (let i = 0; i < n; i++) {
    const t = t0 + (t1 - t0) * (i / n + v.rng() / n);
    const f = midi(notes[Math.floor(v.rng() * notes.length)]);
    v.fm({ t, f, ratio: 2, index: 0.5, idxTau: 0.02, a: 0.003, tau: 0.14, peak: peak * (0.5 + 0.5 * v.rng()), dest: v.pan(v.rng() * 1.2 - 0.6, dest) });
  }
}

export const CUES: Record<string, CueDef> = {
  /** Air and broadband texture entering just before the crack (pacing: >5 kHz, 30-100 ms early). */
  gate_air: {
    gainDb: 3,
    len: 2.6,
    hall: 0.3,
    fn(v) {
      const t = v.t;
      const g1 = v.gain(0, v.wet);
      const bp1 = v.filt('bandpass', 3500, 0.7, g1);
      expTo(bp1.frequency, t, 3200, 7600, 1.5);
      v.noise('white', t, t + 2.6, bp1);
      pts(g1.gain, t, [[0, 0], [0.1, 0.035], [0.7, 0.05]]);
      g1.gain.setTargetAtTime(0, t + 0.7, 0.35);
      const g2 = v.gain(0, v.wet);
      const bp2 = v.filt('bandpass', 1100, 7, g2);
      expTo(bp2.frequency, t, 1050, 2500, 1.7);
      v.noise('pink', t, t + 2.6, bp2);
      pts(g2.gain, t, [[0, 0], [0.22, 0.11], [0.9, 0.13]]);
      g2.gain.setTargetAtTime(0, t + 0.9, 0.4);
    },
  },

  /** The tear: a crackle cluster, a snap, an inharmonic glass ring and a thump (placed 1 frame after the visual). */
  gate_crack: {
    gainDb: 5.5,
    len: 2.4,
    hall: 0.32,
    room: 0.1,
    fn(v) {
      const t = v.t;
      v.buffer(v.lib.crackle, t, v.gain(1.1, v.filt('highpass', 1700, 0.7, v.wet)));
      const sn = v.gain(0, v.filt('bandpass', 2900, 0.9, v.wet));
      v.perc(sn.gain, t, 0.45, 0.0008, 0.011);
      v.noise('white', t, t + 0.12, sn);
      const glass = v.filt('highpass', 900, 0.7, v.wet);
      v.fm({ t: t + 0.003, f: midi(94), ratio: 1.41, index: 2.6, idxEnd: 0.25, idxTau: 0.05, a: 0.002, tau: 0.22, peak: 0.07, dest: v.pan(-0.2, glass) });
      v.fm({ t: t + 0.011, f: midi(101), ratio: 1.41, index: 1.8, idxEnd: 0.2, idxTau: 0.04, a: 0.002, tau: 0.16, peak: 0.04, dest: v.pan(0.25, glass) });
      const th = v.gain(0, v.shaper(2.5, v.gain(0.32, v.dry)));
      const e = v.perc(th.gain, t, 0.6, 0.002, 0.085);
      const o = v.osc('sine', 96, t, e, th);
      expTo(o.frequency, t, 96, 46, 0.22);
    },
  },

  /** Swell under the two-stage open: crack -> 54 % in 167 ms, 100 ms stall, burst to full by 433 ms, then settle. */
  gate_swell: {
    len: 5.6,
    hall: 0.4,
    gainDb: -2,
    fn(v) {
      const t = v.t;
      const stage: [number, number][] = [[0, 0], [0.167, 0.54], [0.267, 0.58], [0.433, 1], [0.6, 0.92]];
      const env = (peak: number) => {
        const g = v.gain(0, v.wet);
        pts(g.gain, t, stage.map(([d, x]) => [d, x * peak] as [number, number]));
        g.gain.setTargetAtTime(0, t + 0.6, 0.7);
        return g;
      };
      const nlp = v.filt('lowpass', 400, 0.9, env(0.42));
      pts(nlp.frequency, t, [[0, 380], [0.167, 1500], [0.267, 1550], [0.433, 3600], [1.6, 1500]]);
      v.noise("pink", t, t + 5.6, nlp);
      const tl = v.filt('lowpass', 300, 1.2, env(0.05));
      pts(tl.frequency, t, [[0, 260], [0.167, 900], [0.267, 950], [0.433, 2600], [2.0, 1100]]);
      for (const [m, d] of [[50, -6], [57, 5], [62, -3], [69, 7]] as const) v.osc("sawtooth", midi(m), t, t + 5.6, v.gain(1, tl)).detune.value = v.cents + d;
      const sh = v.filt('bandpass', 5200, 2.5, env(0.06));
      v.noise("white", t, t + 5.6, sh);
      const sub = v.gain(0, v.dry);
      pts(sub.gain, t, [[0, 0], [0.167, 0.12], [0.267, 0.13], [0.433, 0.24]]);
      sub.gain.setTargetAtTime(0, t + 0.6, 0.7);
      v.osc("sine", midi(38), t, t + 5.6, sub);
    },
  },

  /** The signature Lantern chime: E6 + A6 a perfect fourth apart (28 ms flam), FM 2:1 attack brightness,
   *  a 2.76x bar partial for the glassy edge, a 3 ms digital tick and a little sub thump. */
  ui_open: {
    gainDb: 6,
    len: 1.6,
    room: 0.22,
    hall: 0.1,
    fn(v) {
      const t = v.t;
      const bus = v.filt('lowpass', 8200, 0.5, v.wet);
      for (const [m, dt, p, pk] of [[88, 0, -0.16, 0.075], [93, 0.028, 0.16, 0.068]] as const) {
        v.fm({
          t: t + dt, f: midi(m), ratio: 2, index: 1.0, idxEnd: 0.06, idxTau: 0.03, a: 0.005, tau: 0.085, peak: pk,
          dest: v.pan(p, bus), partials: [[2.76, 0.14, 0.03], [5.4, 0.035, 0.012]],
        });
      }
      const tick = v.gain(0, v.filt('bandpass', 4300, 1.4, bus));
      v.perc(tick.gain, t, 0.12, 0.0006, 0.0022);
      v.noise('white', t, t + 0.03, tick);
      const sub = v.gain(0, v.dry);
      const e = v.perc(sub.gain, t, 0.06, 0.004, 0.06);
      const so = v.osc('sine', 165, t, e, sub);
      expTo(so.frequency, t, 165, 110, 0.12);
    },
  },

  /** Collapse to a bar: a click, a falling 3.2 -> 1.5 kHz chirp, then a small ping when the bar forms. */
  ui_close: {
    gainDb: 5,
    len: 0.9,
    room: 0.2,
    hall: 0.05,
    fn(v) {
      const t = v.t;
      const g = v.gain(0, v.wet);
      v.perc(g.gain, t, 0.04, 0.004, 0.045, 0.06);
      const o = v.osc('sine', 3200, t, t + 0.6, g);
      expTo(o.frequency, t, 3200, 1500, 0.15);
      const c = v.gain(0, v.filt('bandpass', 3800, 0.8, v.wet));
      v.perc(c.gain, t, 0.12, 0.0005, 0.0016);
      v.noise('white', t, t + 0.02, c);
      v.fm({ t: t + 0.16, f: midi(105), ratio: 2, index: 0.35, idxTau: 0.02, a: 0.002, tau: 0.05, peak: 0.022, dest: v.wet });
    },
  },

  ui_tap: {
    gainDb: 4,
    len: 0.4,
    room: 0.15,
    fn(v) {
      const t = v.t;
      v.fm({ t, f: midi(98), ratio: 1, index: 0.45, idxTau: 0.01, a: 0.0015, tau: 0.026, peak: 0.035, dest: v.wet });
      const c = v.gain(0, v.filt('bandpass', 5000, 1, v.wet));
      v.perc(c.gain, t, 0.07, 0.0004, 0.0012);
      v.noise('white', t, t + 0.015, c);
    },
  },

  /** Count-up tick; the director can pass a rising detune per tick. */
  level_tick: {
    gainDb: 4,
    len: 0.3,
    room: 0.12,
    fn(v) {
      const t = v.t;
      v.fm({ t, f: midi(100), ratio: 3, index: 0.5, idxTau: 0.006, a: 0.001, tau: 0.017, peak: 0.05, dest: v.wet });
      const c = v.gain(0, v.filt('highpass', 3000, 0.7, v.wet));
      v.perc(c.gain, t, 0.09, 0.0003, 0.0009);
      v.noise('white', t, t + 0.01, c);
    },
  },

  /** The 24-tick ring filling over 1.0 s: an octave glide D5 -> D6 with 24 Hz amplitude ticks, then a bright ping. */
  level_ring: {
    gainDb: 5,
    len: 2.0,
    room: 0.2,
    hall: 0.15,
    fn(v) {
      const t = v.t;
      const amp = v.gain(0, v.filt('lowpass', 3600, 0.5, v.wet));
      pts(amp.gain, t, [[0, 0], [0.12, 0.026], [1.0, 0.04]]);
      amp.gain.setTargetAtTime(0, t + 1.01, 0.05);
      const am = v.gain(0.55, amp);
      v.lfo(24, 0.45, am.gain, t, t + 1.3);
      const a = v.osc('triangle', midi(74), t, t + 1.4, am);
      expTo(a.frequency, t, midi(74), midi(86), 1.0);
      const b = v.osc('sine', midi(86), t, t + 1.4, v.gain(0.35, am));
      expTo(b.frequency, t, midi(86), midi(98), 1.0);
      v.fm({ t: t + 1.0, f: midi(98), ratio: 2, index: 0.7, idxTau: 0.02, a: 0.003, tau: 0.12, peak: 0.045, dest: v.wet, partials: [[2.76, 0.08, 0.03]] });
    },
  },

  /** Two-note warm resolve on "Level N reached": A5 -> D6, soft 1:1 FM (e-piano body) over a quiet open fifth. */
  level_resolve: {
    gainDb: 5,
    len: 3.2,
    room: 0.18,
    hall: 0.3,
    fn(v) {
      const t = v.t;
      const bus = v.filt('lowpass', 6000, 0.5, v.wet);
      for (const [m, dt, p] of [[81, 0, -0.12], [86, 0.16, 0.12]] as const) {
        v.fm({ t: t + dt, f: midi(m), ratio: 1, index: 1.3, idxEnd: 0.2, idxTau: 0.22, a: 0.006, tau: 0.5, peak: 0.06, dest: v.pan(p, bus), partials: [[2.0, 0.22, 0.28], [2.76, 0.06, 0.05]] });
      }
      v.fm({ t: t + 0.16, f: midi(74), ratio: 1, index: 0.6, idxEnd: 0.1, idxTau: 0.3, a: 0.01, tau: 0.6, peak: 0.03, dest: bus });
      const pad = v.gain(0, v.filt('lowpass', 1100, 0.7, bus));
      pts(pad.gain, t, [[0, 0], [0.4, 0.016], [1.0, 0.014]]);
      pad.gain.setTargetAtTime(0, t + 1.0, 0.5);
      for (const [m, d] of [[62, -5], [69, 6], [74, 3]] as const) v.osc('triangle', midi(m), t, t + 3.2, pad).detune.value = v.cents + d;
    },
  },

  /** Eye ignition: a low-band swell -29 -> -9 dB over 140 ms, harmonics for phones, a breath on top. No ding. */
  eye_swell: {
    gainDb: 6.6,
    len: 4.2,
    hall: 0.3,
    fn(v) {
      const t = v.t;
      const env = v.gain(0, v.wet);
      v.ramp(env.gain, t, 0.0355 * 0.4, 0.355 * 0.4, 0.14);
      env.gain.setValueAtTime(0.355 * 0.4, t + 0.34);
      env.gain.setTargetAtTime(0, t + 0.34, 0.55);
      const sat = v.shaper(3.4, v.gain(0.5, env));
      env.connect(v.filt("bandpass", 420, 0.8, v.gain(1.4, v.wet)));
      v.osc("sine", midi(33), t, t + 4.2, sat);
      v.osc("sine", midi(38), t, t + 4.2, v.gain(0.7, sat));
      v.osc("triangle", midi(45), t, t + 4.2, v.gain(0.35, sat));
      v.noise("brown", t, t + 4.2, v.gain(0.9, v.filt('lowpass', 380, 0.9, env)));
      const br = v.gain(0, v.filt('bandpass', 1500, 1.4, v.wet));
      pts(br.gain, t, [[0, 0], [0.16, 0.17], [0.45, 0.13]]);
      br.gain.setTargetAtTime(0, t + 0.45, 0.4);
      v.noise("pink", t, t + 4.2, br);
      // what a phone speaker keeps of it: the same swell growled through D3 / A3 (harmonics 300 Hz-1.5 kHz) and a
      // breath of energy sweeping up through the mids
      const mid = v.gain(0, v.wet);
      v.ramp(mid.gain, t, 0.016, 0.16, 0.14);
      mid.gain.setValueAtTime(0.16, t + 0.34);
      mid.gain.setTargetAtTime(0, t + 0.34, 0.5);
      const growl = v.filt('bandpass', 650, 0.6, mid);
      const gs = v.shaper(4, v.gain(0.6, growl), 'none');
      v.osc('triangle', midi(50), t, t + 2.4, v.gain(0.6, gs));
      v.osc('triangle', midi(57), t, t + 2.4, v.gain(0.4, gs)).detune.value = v.cents + 4;
      const fw = v.gain(0, v.wet);
      pts(fw.gain, t, [[0, 0], [0.12, 0.3], [0.3, 0.18]]);
      fw.gain.setTargetAtTime(0, t + 0.3, 0.3);
      const fb = v.filt('bandpass', 500, 1.2, fw);
      expTo(fb.frequency, t, 500, 2200, 0.32);
      v.noise('pink', t, t + 2.4, fb);
    },
  },

  /** Noise whoosh 1 -> 6 kHz on the disc expansion (267 ms), panned across. */
  whoosh: {
    gainDb: 2,
    len: 1.2,
    hall: 0.22,
    fn(v) {
      const t = v.t;
      const pn = v.ctx.createStereoPanner ? v.ctx.createStereoPanner() : null;
      const dest = pn ? (pn.connect(v.wet), pn) : v.wet;
      if (pn) pts(pn.pan, t, [[0, -0.45], [0.35, 0.45]]);
      const g = v.gain(0, dest);
      pts(g.gain, t, [[0, 0], [0.09, 0.09], [0.2, 0.12]]);
      g.gain.setTargetAtTime(0, t + 0.2, 0.11);
      const bp = v.filt('bandpass', 1000, 1.3, g);
      expTo(bp.frequency, t, 900, 6200, 0.32);
      v.noise('white', t, t + 1.2, bp);
      const lo = v.gain(0, dest);
      pts(lo.gain, t, [[0, 0], [0.08, 0.16], [0.18, 0.12]]);
      lo.gain.setTargetAtTime(0, t + 0.18, 0.1);
      const lb = v.filt('bandpass', 600, 1.0, lo);
      expTo(lb.frequency, t, 500, 1700, 0.3);
      v.noise('pink', t, t + 1.2, lb);
    },
  },

  /** Omitted by design: no voice. The AWAKEN word carries the command visually; a synthetic voice risks cheese. */
  awaken_voice: {
    len: 0.1,
    fn() {},
  },

  /** The one huge moment: +22 dB over the hush in 50 ms. 120 -> 45 Hz sweep, 300-900 Hz noise body, sub tail. */
  awaken_hit: {
    len: 6.0,
    gainDb: -0.4,
    hall: 0.24,
    fn(v) {
      boom(v, v.t, { level: 1, f0: 120, f1: 45, body: 1, crack: 1, sub: 1 });
    },
  },

  /** Riser 700 Hz -> 1.8 kHz over 1.0 s (starts ~60 ms after the hit), at about -12 dB relative to it. */
  riser: {
    gainDb: 2,
    len: 1.8,
    hall: 0.3,
    fn(v) {
      const t = v.t;
      const g = v.gain(0, v.wet);
      v.ramp(g.gain, t, 0.004, 0.075, 0.95);
      g.gain.setTargetAtTime(0, t + 0.97, 0.09);
      const am = v.gain(0.75, g);
      const lf = v.lfo(6, 0.22, am.gain, t, t + 1.8);
      expTo(lf.frequency, t, 6, 15, 1.0);
      for (const [r, a, d] of [[1, 1, -4], [1.5, 0.5, 5], [2, 0.35, -2], [3, 0.12, 3]] as const) {
        const o = v.osc(r === 1 ? 'triangle' : 'sine', 700 * r, t, t + 1.8, v.gain(a, am));
        expTo(o.frequency, t, 700 * r, 1800 * r, 1.0);
        o.detune.value = v.cents + d;
      }
      const nb = v.filt('bandpass', 700, 5, v.gain(1.6, g));
      expTo(nb.frequency, t, 700, 1800, 1.0);
      v.noise('white', t, t + 1.8, nb);
    },
  },

  /** Seams ignite: ignition curve cubic-bezier(.7,0,.95,.55) over 467 ms with a hard stop, a cold lock bell at the
   *  stop, the low swell peaking at +0.45 s, and a cold air tail. */
  soldier_ignite: {
    gainDb: 8,
    len: 3.0,
    hall: 0.32,
    room: 0.1,
    fn(v) {
      const t = v.t;
      const T = 0.467;
      const curve = (k: number) => IGNITION.map((x) => x * k) as Float32Array<ArrayBuffer>;
      const ng = v.gain(0, v.wet);
      curveAt(ng.gain, curve(0.2), t, T);
      ng.gain.setTargetAtTime(0.012, t + T + 0.001, 0.03);
      ng.gain.setTargetAtTime(0, t + T + 0.2, 0.4);
      const nb = v.filt('bandpass', 1200, 1.1, ng);
      expTo(nb.frequency, t, 1100, 5200, T);
      v.noise('white', t, t + 3, nb);
      const cg = v.gain(0, v.filt('lowpass', 7000, 0.5, v.wet));
      curveAt(cg.gain, curve(0.03), t, T);
      cg.gain.setTargetAtTime(0, t + T + 0.001, 0.02);
      const am = v.gain(0.6, cg);
      v.lfo(12, 0.4, am.gain, t, t + T + 0.2, 'square');
      for (const m of [86, 93, 98, 100]) v.osc('sine', midi(m), t, t + T + 0.2, am);
      v.fm({ t: t + T, f: midi(93), ratio: 2, index: 0.9, idxEnd: 0.05, idxTau: 0.04, a: 0.002, tau: 0.32, peak: 0.07, dest: v.pan(-0.15, v.wet), partials: [[2.76, 0.12, 0.05]] });
      v.fm({ t: t + T + 0.012, f: midi(100), ratio: 2, index: 0.7, idxEnd: 0.05, idxTau: 0.03, a: 0.002, tau: 0.26, peak: 0.045, dest: v.pan(0.2, v.wet) });
      const sw = v.gain(0, v.wet);
      v.ramp(sw.gain, t, 0.006, 0.1, 0.45);
      sw.gain.setTargetAtTime(0, t + 0.45, 0.4);
      const sat = v.shaper(2.4, v.gain(0.6, sw));
      v.osc('sine', midi(38), t, t + 3, sat);
      v.osc('triangle', midi(50), t, t + 3, v.gain(0.3, sat));
      const air = v.gain(0, v.filt('highpass', 3200, 0.7, v.wet));
      pts(air.gain, t + T, [[0, 0], [0.01, 0.03]]);
      air.gain.setTargetAtTime(0, t + T + 0.02, 0.5);
      v.noise('white', t + T, t + 3, air);
    },
  },

  /** The stand-up: the loudest sustained moment. Rises 1.0 s, holds, decays; the director cuts it at 49.84. */
  stand_swell: {
    len: 7.0,
    gainDb: 5,
    hall: 0.25,
    fn(v) {
      const t = v.t;
      const env = (peak: number, tauDecay = 0.7, rise = 1.0) => {
        const g = v.gain(0, v.wet);
        v.ramp(g.gain, t, peak * 0.05, peak, rise);
        g.gain.setValueAtTime(peak, t + 1.9);
        g.gain.setTargetAtTime(0, t + 1.9, tauDecay);
        return g;
      };
      const roar = v.filt("lowpass", 250, 0.8, env(0.62));
      expTo(roar.frequency, t, 200, 1000, 1.0);
      v.noise("brown", t, t + 7, roar);
      // the part a phone keeps: the mid roar arrives a little sooner, so the rise reads before the stand lands
      const mid = v.filt("bandpass", 700, 0.8, env(0.6, 0.7, 0.85));
      expTo(mid.frequency, t, 600, 1800, 1.0);
      v.noise("pink", t, t + 7, mid);
      v.noise("white", t, t + 7, v.filt("highpass", 5200, 0.7, env(0.025, 0.5)));
      const sat = v.shaper(2.0, v.gain(0.36, env(1, 0.75)));
      v.osc("sine", midi(26), t, t + 7, v.gain(0.5, sat));
      v.osc("sine", midi(38), t, t + 7, v.gain(0.55, sat));
    },
  },

  /** The chest rises from the pool and its gold seams ignite: a warm D-major swell with gold glints. */
  chest_rise: {
    gainDb: 4.5,
    len: 5.0,
    hall: 0.38,
    fn(v) {
      const t = v.t;
      const low = v.gain(0, v.wet);
      v.ramp(low.gain, t, 0.01, 0.14, 1.1);
      low.gain.setTargetAtTime(0, t + 1.3, 0.6);
      const sat = v.shaper(2.2, v.gain(0.5, low));
      v.osc("sine", midi(38), t, t + 5, sat);
      v.osc("triangle", midi(50), t, t + 5, v.gain(0.4, sat));
      const pg = v.gain(0, v.wet);
      pts(pg.gain, t, [[0, 0], [0.5, 0.02], [1.2, 0.05], [2.0, 0.045]]);
      pg.gain.setTargetAtTime(0, t + 2.0, 0.5);
      const lp = v.filt('lowpass', 300, 0.9, pg);
      pts(lp.frequency, t, [[0, 300], [0.4, 420], [1.2, 1700], [2.4, 1200]]);
      for (const [m, d] of [[62, -6], [66, 5], [69, -3], [74, 7]] as const) v.osc("sawtooth", midi(m), t, t + 5, lp).detune.value = v.cents + d;
      glints(v, t + 0.7, t + 2.0, 6, [98, 102, 105, 110], 0.028, v.wet);
    },
  },

  /** Gold burst: the hit recipe softened 6 dB and pitched up (soft swell, no click), a 2-6 kHz shimmer that blooms in,
   *  a 3-note rising chime, then the falling stars (high tones that each sigh down as they fall, alternating sides)
   *  and the faint air of the crimson feather drifting down on the right. */
  chest_burst: {
    gainDb: 7,
    len: 4.5,
    hall: 0.34,
    room: 0.1,
    fn(v) {
      const t = v.t;
      boom(v, t, { level: 0.42, f0: 165, f1: 62, body: 1, crack: 0.8, sub: 0.8 });
      const sh = v.gain(0, v.filt('bandpass', 3800, 0.65, v.wet));
      swell(sh.gain, t, 0.12, 0.035, 0.17);
      v.noise('white', t, t + 1.8, sh);
      const bus = v.filt('lowpass', 7500, 0.5, v.wet);
      for (const [m, dt, p] of [[86, 0.02, -0.2], [90, 0.095, 0], [93, 0.17, 0.2]] as const) {
        v.fm({ t: t + dt, f: midi(m), ratio: 2, index: 1.1, idxEnd: 0.08, idxTau: 0.05, a: 0.012, tau: 0.42, peak: 0.07, dest: v.pan(p, bus), partials: [[2.76, 0.12, 0.08], [4.0, 0.04, 0.05]] });
      }
      // falling stars: one per star, from its apex down, each a soft sine that glides down a minor third
      const notes = [110, 105, 107, 102, 103, 98, 100];
      for (let i = 0; i < notes.length; i++) {
        const ts = t + 0.5 + i * 0.075 + v.rng() * 0.05;
        const f = midi(notes[i]);
        const g = v.gain(0, v.pan(i % 2 ? 0.45 : -0.45, bus));
        swell(g.gain, ts, 0.016 * (0.75 + 0.25 * v.rng()), 0.02, 0.2);
        const o = v.osc('sine', f, ts, ts + 1.8, g);
        o.frequency.setValueAtTime(f, ts);
        o.frequency.exponentialRampToValueAtTime(f * 0.84, ts + 0.7);
        const g2 = v.gain(0, v.pan(i % 2 ? 0.45 : -0.45, bus));
        swell(g2.gain, ts, 0.0035, 0.02, 0.08);
        v.osc('sine', f * 2.76, ts, ts + 0.8, g2);
      }
      // the feather: a warm breath of air on the right that rises and settles, under everything
      const fa = v.gain(0, v.pan(0.4, v.wet));
      swell(fa.gain, t + 0.35, 0.02, 0.9, 0.7, 0.5);
      const fb = v.filt('bandpass', 900, 0.8, fa);
      fb.frequency.setValueAtTime(700, t + 0.35);
      fb.frequency.linearRampToValueAtTime(1300, t + 1.3);
      fb.frequency.linearRampToValueAtTime(800, t + 3.4);
      v.noise('pink', t + 0.35, t + 4.4, fb);
    },
  },

  /** "[LANTERN] Reward unlocked.": the Lantern chime turned gold (D major triad + E7 sparkle, longer, warmer). */
  reward_chime: {
    gainDb: 5,
    len: 2.4,
    room: 0.22,
    hall: 0.22,
    fn(v) {
      const t = v.t;
      const bus = v.filt('lowpass', 7600, 0.5, v.wet);
      for (const [m, dt, p, pk] of [[86, 0, -0.2, 0.06], [90, 0.024, 0, 0.05], [93, 0.048, 0.2, 0.052], [100, 0.075, 0.1, 0.022]] as const) {
        v.fm({ t: t + dt, f: midi(m), ratio: 2, index: 0.9, idxEnd: 0.05, idxTau: 0.035, a: 0.005, tau: 0.16, peak: pk, dest: v.pan(p, bus), partials: [[2.76, 0.1, 0.04]] });
      }
      const tick = v.gain(0, v.filt('bandpass', 4300, 1.4, bus));
      v.perc(tick.gain, t, 0.1, 0.0006, 0.0022);
      v.noise('white', t, t + 0.03, tick);
      const sub = v.gain(0, v.dry);
      const e = v.perc(sub.gain, t, 0.06, 0.005, 0.09);
      const so = v.osc('sine', 196, t, e, sub);
      expTo(so.frequency, t, 196, 147, 0.15);
    },
  },

  /** The letter rises out of the chest light: an airy lift and a soft open fifth. */
  letter_open: {
    gainDb: 8,
    len: 3.4,
    hall: 0.42,
    room: 0.1,
    fn(v) {
      const t = v.t;
      const g = v.gain(0, v.wet);
      pts(g.gain, t, [[0, 0], [0.35, 0.05], [0.55, 0.045]]);
      g.gain.setTargetAtTime(0, t + 0.55, 0.22);
      const bp = v.filt('bandpass', 500, 1.2, g);
      expTo(bp.frequency, t, 480, 2300, 0.6);
      v.noise('pink', t, t + 2, bp);
      for (const [m, dt, p] of [[81, 0.32, -0.15], [88, 0.38, 0.15]] as const) {
        v.fm({ t: t + dt, f: midi(m), ratio: 1, index: 0.6, idxEnd: 0.08, idxTau: 0.2, a: 0.012, tau: 0.45, peak: 0.04, dest: v.pan(p, v.wet), partials: [[2.0, 0.18, 0.25]] });
      }
    },
  },

  /** End card: a soft low thump, then a high D-major add9 shimmer at +100 ms with a 3-4 s tail. No crack. */
  endcard: {
    gainDb: 8.5,
    len: 5.5,
    hall: 0.5,
    fn(v) {
      const t = v.t;
      const th = v.gain(0, v.dry);
      v.perc(th.gain, t, 0.24, 0.006, 0.26);
      const o = v.osc('sine', 72, t, t + 2, th);
      expTo(o.frequency, t, 72, 46, 0.3);
      const bd = v.gain(0, v.shaper(2, v.gain(0.2, v.filt('lowpass', 700, 0.7, v.wet))));
      v.perc(bd.gain, t, 0.8, 0.005, 0.16);
      const tb = v.osc('triangle', 150, t, t + 1.2, bd);
      expTo(tb.frequency, t, 150, 92, 0.25);
      const bus = v.filt('lowpass', 7600, 0.5, v.wet);
      for (const [m, dt, p, pk] of [[86, 0.1, -0.25, 0.05], [93, 0.145, 0.25, 0.042], [100, 0.19, -0.1, 0.03], [102, 0.235, 0.15, 0.024]] as const) {
        v.fm({ t: t + dt, f: midi(m), ratio: 2, index: 0.8, idxEnd: 0.04, idxTau: 0.06, a: 0.006, tau: 0.85, peak: pk, dest: v.pan(p, bus), partials: [[2.76, 0.07, 0.15]] });
      }
      const sh = v.gain(0, v.filt('bandpass', 5600, 0.9, v.wet));
      pts(sh.gain, t + 0.1, [[0, 0], [0.04, 0.03]]);
      sh.gain.setTargetAtTime(0, t + 0.14, 0.45);
      v.noise('white', t + 0.1, t + 3.5, sh);
    },
  },

  /** Daily card flip: two quick air flicks, a light landing tick, then a soft chime. */
  card_flip: {
    gainDb: 3,
    len: 2.0,
    room: 0.2,
    hall: 0.22,
    fn(v) {
      const t = v.t;
      const g = v.gain(0, v.wet);
      pts(g.gain, t, [[0, 0], [0.025, 0.05], [0.11, 0.04]]);
      g.gain.setTargetAtTime(0, t + 0.11, 0.03);
      const am = v.gain(0.55, g);
      v.lfo(28, 0.45, am.gain, t, t + 0.3);
      const bp = v.filt('bandpass', 1500, 1.3, am);
      expTo(bp.frequency, t, 1400, 3800, 0.13);
      v.noise('white', t, t + 0.4, bp);
      v.fm({ t: t + 0.13, f: midi(93), ratio: 1, index: 0.3, idxTau: 0.01, a: 0.0015, tau: 0.012, peak: 0.018, dest: v.wet });
      v.fm({ t: t + 0.16, f: midi(86), ratio: 1, index: 0.7, idxEnd: 0.08, idxTau: 0.12, a: 0.008, tau: 0.34, peak: 0.04, dest: v.wet, partials: [[2.0, 0.2, 0.2], [2.76, 0.05, 0.07]] });
    },
  },

  /** Gentle bell for the companion (row reveal, check-in). Pass detune for a pentatonic variation. */
  soft_chime: {
    gainDb: 4,
    len: 2.2,
    room: 0.2,
    hall: 0.3,
    fn(v) {
      v.fm({ t: v.t, f: midi(86), ratio: 1, index: 0.6, idxEnd: 0.08, idxTau: 0.14, a: 0.008, tau: 0.32, peak: 0.034, dest: v.pan(-0.22, v.wet), partials: [[2.0, 0.2, 0.2], [2.76, 0.05, 0.07]] });
      v.fm({ t: v.t + 0.006, f: midi(86) * 1.0035, ratio: 1, index: 0.5, idxEnd: 0.06, idxTau: 0.14, a: 0.01, tau: 0.36, peak: 0.026, dest: v.pan(0.22, v.wet), partials: [[3.0, 0.05, 0.1]] });
    },
  },

  /** Their motif: a bubble. A sine whose pitch rises as the bubble shrinks (Minnaert-style chirp), sometimes a twin. */
  bubble: {
    gainDb: 3,
    len: 0.8,
    room: 0.3,
    hall: 0.15,
    fn(v) {
      const one = (t: number, f0: number, pk: number) => {
        const g = v.gain(0, v.filt('lowpass', 4200, 0.5, v.wet));
        const e = v.perc(g.gain, t, pk, 0.003, 0.03);
        const o = v.osc('sine', f0, t, e, g);
        expTo(o.frequency, t, f0, f0 * 2.3, 0.055);
      };
      const f0 = 520 + v.rng() * 360;
      one(v.t, f0, 0.07);
      if (v.rng() < 0.5) one(v.t + 0.05 + v.rng() * 0.05, f0 * (1.25 + v.rng() * 0.3), 0.04);
    },
  },

  /** Paced breathing, inhale (default 4 s): air rising through a bandpass with a soft open fifth underneath. */
  breath_in: {
    gainDb: 5,
    len: 5.5,
    hall: 0.25,
    fn(v, o) {
      const t = v.t;
      const T = o.dur ?? 4;
      const shape = new Float32Array(32).map((_, i) => Math.pow(Math.sin(((i / 31) * Math.PI) / 2), 2)) as Float32Array<ArrayBuffer>;
      const g = v.gain(0, v.wet);
      curveAt(g.gain, shape.map((x) => x * 0.075) as Float32Array<ArrayBuffer>, t, T);
      g.gain.setTargetAtTime(0, t + T + 0.001, 0.22);
      const bp = v.filt('bandpass', 450, 1.1, g);
      expTo(bp.frequency, t, 450, 1500, T);
      v.noise('pink', t, t + T + 1.5, bp);
      const tg = v.gain(0, v.filt('lowpass', 1200, 0.6, v.wet));
      curveAt(tg.gain, shape.map((x) => x * 0.02) as Float32Array<ArrayBuffer>, t, T);
      tg.gain.setTargetAtTime(0, t + T + 0.001, 0.3);
      v.osc('triangle', midi(62), t, t + T + 1.5, tg);
      v.osc('triangle', midi(69), t, t + T + 1.5, v.gain(0.7, tg));
    },
  },

  /** Paced breathing, exhale (default 6 s): the same air falling, fading smoothly to nothing. */
  breath_out: {
    gainDb: 5,
    len: 7.5,
    hall: 0.25,
    fn(v, o) {
      const t = v.t;
      const T = o.dur ?? 6;
      const shape = new Float32Array(48).map((_, i) => {
        const x = i / 47;
        const a = Math.min(1, x / 0.06);
        return a * Math.pow(Math.cos((x * Math.PI) / 2), 1.6);
      }) as Float32Array<ArrayBuffer>;
      const g = v.gain(0, v.wet);
      curveAt(g.gain, shape.map((x) => x * 0.075) as Float32Array<ArrayBuffer>, t, T);
      const bp = v.filt('bandpass', 1400, 1.1, g);
      expTo(bp.frequency, t, 1400, 420, T);
      v.noise('pink', t, t + T + 0.2, bp);
      const tg = v.gain(0, v.filt('lowpass', 1100, 0.6, v.wet));
      curveAt(tg.gain, shape.map((x) => x * 0.02) as Float32Array<ArrayBuffer>, t, T);
      v.osc('triangle', midi(62), t, t + T + 0.2, tg);
      v.osc('triangle', midi(69), t, t + T + 0.2, v.gain(0.7, tg));
    },
  },

  /** Check-in done: a soft rising fifth, A5 -> E6. */
  check: {
    gainDb: 3,
    len: 1.8,
    room: 0.25,
    hall: 0.22,
    fn(v) {
      const t = v.t;
      v.fm({ t, f: midi(81), ratio: 1, index: 0.9, idxEnd: 0.1, idxTau: 0.08, a: 0.005, tau: 0.24, peak: 0.045, dest: v.pan(-0.1, v.wet), partials: [[2.0, 0.2, 0.15]] });
      v.fm({ t: t + 0.085, f: midi(88), ratio: 1, index: 0.8, idxEnd: 0.1, idxTau: 0.08, a: 0.005, tau: 0.3, peak: 0.042, dest: v.pan(0.1, v.wet), partials: [[2.0, 0.18, 0.15], [2.76, 0.04, 0.05]] });
    },
  },
};

export type CueName = keyof typeof CUES;
