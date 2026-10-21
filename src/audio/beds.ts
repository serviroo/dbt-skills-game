import { midi } from './dsp';
import { Voice, kRate, type Lib } from './voice';

export type BedName = 'gate_hum' | 'aura_bed' | 'vortex_roar' | 'ambient';
export const BED_NAMES: BedName[] = ['gate_hum', 'aura_bed', 'vortex_roar', 'ambient'];

export const LONG = 6 * 3600;

type BedFn = (v: Voice, t: number, lvl: GainNode) => void;

const BEDS: Record<BedName, { room: number; hall: number; gain: number; fn: BedFn }> = {
  /** The open gate: a resonant D drone (body), boiling plasma fizz in 2-3 kHz and a faint singing D6 (phone band). */
  gate_hum: {
    gain: 0.45,
    room: 0,
    hall: 0.22,
    fn(v, t, lvl) {
      const T = t + LONG;
      const body = v.gain(1, lvl);
      v.lfo(0.23, 0.22, body.gain, t, T);
      const lp = v.filt('lowpass', 430, 2.4, body);
      v.lfo(0.11, 110, lp.frequency, t, T);
      v.osc('sawtooth', midi(38), t, T, v.gain(0.07, lp)).detune.value = -5;
      v.osc('sawtooth', midi(38), t, T, v.gain(0.07, lp)).detune.value = 6;
      v.osc('sawtooth', midi(45), t, T, v.gain(0.035, lp)).detune.value = 3;
      v.osc('sine', midi(26), t, T, v.gain(0.07, body));
      const fz = v.gain(0.1, lvl);
      v.lfo(7.3, 0.055, fz.gain, t, T, "sawtooth");
      v.lfo(0.37, 0.036, fz.gain, t, T);
      v.noise('white', t, T, v.filt('bandpass', 2600, 1.5, fz));
      const sg = v.gain(0.9, lvl);
      const sb = v.filt('bandpass', midi(86), 24, sg);
      v.lfo(0.07, 12, sb.frequency, t, T);
      v.lfo(0.19, 0.38, sg.gain, t, T);
      v.noise('pink', t, T, sb);
    },
  },

  /** the wanderer's aura: brown-noise rumble under 300 Hz, a slow 1-2 kHz breath, a faint low undertone. */
  aura_bed: {
    gain: 0.2,
    room: 0,
    hall: 0.25,
    fn(v, t, lvl) {
      const T = t + LONG;
      const rum = v.gain(0.55, lvl);
      v.lfo(0.13, 0.12, rum.gain, t, T);
      v.noise('brown', t, T, v.filt('lowpass', 300, 0.8, rum));
      const br = v.gain(0.35, lvl);
      v.lfo(0.18, 0.17, br.gain, t, T);
      const bb = v.filt('bandpass', 1400, 1.6, br);
      v.lfo(0.05, 260, bb.frequency, t, T);
      v.noise('pink', t, T, bb);
      const sh = v.gain(0.07, lvl);
      v.lfo(0.09, 0.05, sh.gain, t, T);
      v.noise('pink', t, T, v.filt('bandpass', 3300, 3, sh));
      const un = v.gain(0.05, lvl);
      v.osc('sine', midi(26), t, T, un);
      v.osc('sine', midi(33), t, T, v.gain(0.6, un));
    },
  },

  /** The vortex: low roar under 200 Hz, a mid roar for phones, a swirling flame band and a flickering hiss above 4 kHz. */
  vortex_roar: {
    gain: 0.5,
    room: 0,
    hall: 0.2,
    fn(v, t, lvl) {
      const T = t + LONG;
      v.noise('brown', t, T, v.filt('lowpass', 200, 0.7, v.gain(0.7, lvl)));
      v.noise('pink', t, T, v.filt('bandpass', 620, 0.7, v.gain(0.3, lvl)));
      const pn = v.ctx.createStereoPanner ? v.ctx.createStereoPanner() : null;
      const fl = v.gain(0.11, lvl);
      if (pn) {
        kRate(pn.pan);
        pn.connect(fl);
        v.lfo(0.29, 0.6, pn.pan, t, T);
      }
      const fb = v.filt('bandpass', 1500, 1.2, pn ?? fl);
      v.lfo(0.45, 700, fb.frequency, t, T);
      v.noise('white', t, T, fb);
      const hs = v.gain(0.05, lvl);
      v.lfo(11, 0.016, hs.gain, t, T, 'sawtooth');
      v.lfo(3.1, 0.01, hs.gain, t, T);
      v.noise("white", t, T, v.filt("highpass", 4500, 0.7, hs));
      v.loop(v.lib.crackleLong, t, T, v.filt("highpass", 2200, 0.7, v.gain(2.5, pn ?? fl)));
    },
  },

  /** Quiet night air for the end card and the companion: soft low air plus distant, slowly breathing high tones. */
  ambient: {
    gain: 0.48,
    room: 0.1,
    hall: 0.4,
    fn(v, t, lvl) {
      const T = t + LONG;
      const air = v.gain(0.06, lvl);
      v.lfo(0.07, 0.025, air.gain, t, T);
      v.noise('pink', t, T, v.filt('lowpass', 850, 0.6, air));
      const notes: [number, number, number][] = [[86, 0.043, 0.0], [93, 0.061, 1.7], [100, 0.037, 3.1], [102, 0.053, 4.4]];
      for (const [m, rate, delay] of notes) {
        const g = v.gain(0.0045, lvl);
        v.lfo(rate, 0.0045, g.gain, t + delay, T);
        v.osc('sine', midi(m), t, T, v.pan(((m % 5) - 2) * 0.2, g));
      }
    },
  },
};

export interface BedHandle {
  readonly name: BedName;
  level(v: number, rampSec?: number, at?: number): void;
  stop(rampSec?: number, at?: number): void;
  readonly stopped: boolean;
}

export function startBed(lib: Lib, name: BedName, dest: AudioNode, t: number, level: number, fadeIn: number, seed: number): BedHandle {
  const def = BEDS[name];
  const v = new Voice(lib, t, dest, { room: def.room, hall: def.hall, gain: def.gain }, seed);
  const lvl = v.gain(0, v.wet);
  lvl.gain.setValueAtTime(0, t);
  lvl.gain.setTargetAtTime(level, t, Math.max(0.003, fadeIn / 4));
  def.fn(v, t, lvl);
  return {
    name,
    level(x, ramp = 0.5, at = lib.ctx.currentTime) {
      if (v.isStopped) return;
      lvl.gain.cancelScheduledValues(at);
      lvl.gain.setTargetAtTime(Math.max(0, x), at, Math.max(0.003, ramp / 4));
    },
    stop(ramp = 0.5, at = lib.ctx.currentTime) {
      v.stop(at, ramp);
    },
    get stopped() {
      return v.isStopped;
    },
  };
}

export interface ChargeHandle {
  set(c: number, at?: number): void;
  release(at?: number): void;
  stop(at?: number, ramp?: number): void;
}

/**
 * Hold-to-charge: an idle gold hum breathing at 0.25 Hz, and a rising tone D4 -> A5 (293 -> 880 Hz) whose fifth,
 * brightness and 2-4 kHz shimmer thicken with charge. release() drains it back to idle in ~350 ms with no penalty
 * sound; stop() cuts it for the burst.
 */
export function startCharge(lib: Lib, dest: AudioNode, t: number, seed: number): ChargeHandle {
  const v = new Voice(lib, t, dest, { room: 0.12, hall: 0.28 }, seed);
  const T = t + LONG;
  const hum = v.gain(0, v.wet);
  hum.gain.setValueAtTime(0, t);
  hum.gain.setTargetAtTime(1, t, 0.3);
  const breath = v.gain(0.7, hum);
  v.lfo(0.25, 0.3, breath.gain, t, T);
  const hl = v.filt('lowpass', 520, 0.8, breath);
  v.osc("sine", midi(38), t, T, v.gain(0.035, hl));
  v.osc("sine", midi(69), t, T, v.gain(0.006, breath));
  v.osc("sine", midi(74), t, T, v.gain(0.0045, v.pan(0.3, breath)));
  v.osc('triangle', midi(50), t, T, v.gain(0.035, hl)).detune.value = 4;
  v.osc('triangle', midi(57), t, T, v.gain(0.018, hl)).detune.value = -3;
  // the gold 'singing bowl' a phone speaker can carry: D5 / A5 / D6 pairs beating slowly, plus a faint 2-4 kHz air
  const bowl = v.gain(4.2, v.filt('lowpass', 4200, 0.5, breath));
  for (const [m, a, d] of [[74, 0.016, 2.5], [81, 0.011, -3], [86, 0.007, 3.5]] as const) {
    v.osc('sine', midi(m), t, T, v.gain(a, bowl)).detune.value = v.cents - d;
    v.osc('sine', midi(m), t, T, v.gain(a * 0.8, v.pan(0.35, bowl))).detune.value = v.cents + d;
  }
  v.noise('pink', t, T, v.gain(0.022, v.filt('bandpass', 2800, 0.9, breath)));

  const tone = v.gain(0, v.wet);
  const lp = v.filt('lowpass', 900, 1.1, tone);
  const f0 = midi(62);
  const o1 = v.osc('sawtooth', f0, t, T, v.gain(0.5, lp));
  o1.detune.value = -6;
  const o2 = v.osc('sawtooth', f0, t, T, v.gain(0.5, lp));
  o2.detune.value = 7;
  const o3 = v.osc('sine', f0 / 2, t, T, v.gain(0.6, tone));
  const fifthG = v.gain(0, lp);
  const o5 = v.osc('triangle', f0 * 1.5, t, T, fifthG);

  const shim = v.gain(0, v.wet);
  const am = v.gain(0.6, shim);
  const trem = v.lfo(6, 0.4, am.gain, t, T);
  v.noise('white', t, T, v.filt('bandpass', 3000, 0.9, am));
  const sp = v.gain(0, v.filt('lowpass', 6000, 0.5, v.wet));
  const amS = v.gain(0.5, sp);
  const trem2 = v.lfo(7, 0.5, amS.gain, t, T, 'triangle');
  const s1 = v.osc('sine', f0 * 4, t, T, amS);
  const s2 = v.osc('sine', f0 * 6, t, T, v.gain(0.6, amS));

  const apply = (c: number, at: number, tau: number) => {
    c = Math.max(0, Math.min(1, c));
    const f = f0 * Math.pow(3, c);
    for (const o of [o1, o2]) o.frequency.setTargetAtTime(f, at, tau);
    o3.frequency.setTargetAtTime(f / 2, at, tau);
    o5.frequency.setTargetAtTime(f * 1.5, at, tau);
    s1.frequency.setTargetAtTime(f * 4, at, tau);
    s2.frequency.setTargetAtTime(f * 6, at, tau);
    lp.frequency.setTargetAtTime(f * (2 + 3.5 * c), at, tau);
    tone.gain.setTargetAtTime(0.055 * Math.pow(c, 1.1), at, tau);
    const s5 = c < 0.35 ? 0 : Math.min(1, (c - 0.35) / 0.65);
    fifthG.gain.setTargetAtTime(0.45 * s5 * s5, at, tau);
    shim.gain.setTargetAtTime(0.06 * c * c, at, tau);
    sp.gain.setTargetAtTime(0.02 * c * c * c, at, tau);
    trem.frequency.setTargetAtTime(6 + 14 * c, at, tau);
    trem2.frequency.setTargetAtTime(7 + 11 * c, at, tau);
    hum.gain.setTargetAtTime(1 - 0.8 * c, at, tau);
  };
  let stopped = false;
  return {
    set(c, at = lib.ctx.currentTime) {
      if (!stopped) apply(c, at, 0.03);
    },
    release(at = lib.ctx.currentTime) {
      if (!stopped) apply(0, at, 0.09);
    },
    stop(at = lib.ctx.currentTime, ramp = 0.03) {
      stopped = true;
      v.stop(at, ramp);
    },
  };
}
