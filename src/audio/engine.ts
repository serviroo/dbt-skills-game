/**
 * Synthesized sound for the gift. Everything is Web Audio: oscillators, FM, filtered noise, envelopes, a generated
 * convolution reverb, a limiter and a soft clipper. The same code runs on a live AudioContext and on an
 * OfflineAudioContext (renderOffline), so captured videos get the exact soundtrack the app plays.
 */
import { CUES } from './cues';
import { BED_NAMES, startBed, startCharge, type BedHandle, type BedName, type ChargeHandle } from './beds';
import { Music, SECTIONS, type Section, type SectionOpts } from './music';
import { clipCurve, makeCrackle, makeIR, makeNoise, dB, type Ctx } from './dsp';
import { Voice, type Lib } from './voice';

export type { BedHandle, BedName, ChargeHandle, Section, SectionOpts };
export { BED_NAMES, SECTIONS };

export const CUE_NAMES = [
  'gate_air', 'gate_crack', 'gate_swell', 'ui_open', 'ui_close', 'ui_tap', 'level_tick', 'level_ring', 'level_resolve',
  'eye_swell', 'whoosh', 'arise_voice', 'arise_hit', 'riser', 'soldier_ignite', 'stand_swell', 'chest_rise',
  'chest_burst', 'reward_chime', 'letter_open', 'endcard', 'card_flip', 'soft_chime', 'bubble', 'breath_in',
  'breath_out', 'check',
] as const;
export type CueName = (typeof CUE_NAMES)[number];

export interface PlayOpts {
  /** Context time (seconds). Defaults to now. */
  at?: number;
  /** Linear gain multiplier on the cue's designed level. */
  gain?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Transposition in cents (every oscillator and filter in the cue). */
  detune?: number;
  /** breath_in / breath_out length in seconds. */
  dur?: number;
  /** Variation step (e.g. the count-up tick number): rises 50 cents per step when detune is not given. */
  index?: number;
}

export interface CueHandle {
  stop(at?: number, ramp?: number): void;
  readonly end: number;
}

export interface EngineOpts {
  seed?: number;
  /** Master volume 0..1 (after the limiter). */
  volume?: number;
  muted?: boolean;
  /** iOS audio session type set on unlock: 'playback' ignores the silent switch (cutscene); 'ambient' mixes with
   *  her own music and respects the switch (better for the daily companion). */
  session?: 'playback' | 'ambient';
  /** Record source lifetimes for stats() (always on offline). */
  stats?: boolean;
  /** Her stored levels from the speaker control (0..1 each), applied from the first sample. */
  user?: UserLevels;
}

export interface UserLevels {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

/** Slider position (0..1) to gain: a squared taper, so the middle of the slider sounds like the middle. */
const taper = (p: number) => {
  const x = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 1;
  return x * x;
};

/** Cues the score makes room for. */
const UI_DUCK = new Set<string>(['ui_open', 'reward_chime', 'level_resolve', 'letter_open']);

/** Compressor auto-makeup (spec: (1/fullRangeGain)^0.6) measured for the settings below; undone after the limiter. */
const LIMIT = { threshold: -5, knee: 2, ratio: 16, attack: 0.002, release: 0.14 };
const LIMIT_MAKEUP_DB = 2.47;

export class AudioEngine {
  readonly ctx: Ctx;
  readonly live: boolean;
  readonly music: Music;
  private lib: Lib;
  /** The score's resources: same as lib, with reverb sends that pass through the Music level. */
  private libMusic: Lib;
  private sfx: GainNode;
  private musicIn: GainNode;
  /** Her levels: Effects (cues, beds, charge, their reverb) and Music (score and its reverb). */
  private sfxUser: GainNode;
  private bedUser: GainNode;
  private sfxRoomIn: GainNode;
  private sfxHallIn: GainNode;
  private musUser: GainNode;
  private musRoomIn: GainNode;
  private musHallIn: GainNode;
  private userMaster = 1;
  private bedBus: GainNode;
  private hushBeds: GainNode;
  private hushMusic: GainNode;
  /** The score dips ~3 dB for a System chime (the window speaks, the music makes room). */
  private uiDuck: GainNode;
  /** The score steps back while she is doing something: paced breathing (-5 dB) or holding the chest (-2 dB idle,
   *  down to -9 dB at full charge, so the charge tone and then the burst own the moment). */
  private focus: GainNode;
  private hushHall: GainNode;
  private hushRoom: GainNode;
  private duckG: GainNode;
  /** Beds and score step back for a cue that must read inside the roar (soldier ignition, the stand-up swell). */
  private yieldG: GainNode;
  private volume: GainNode;
  readonly limiter: DynamicsCompressorNode;
  private beds = new Map<BedName, BedHandle>();
  private active = new Set<Voice>();
  private mlevel: GainNode;
  private mlp: BiquadFilterNode;
  private shelf: BiquadFilterNode;
  private charge: ChargeHandle | null = null;
  private seedN: number;
  private spans: { a: number; b: number }[] = [];
  private timer: ReturnType<typeof setInterval> | 0 = 0;
  private unlocked = false;
  private vol: number;
  private isMuted: boolean;
  private session: 'playback' | 'ambient';
  private cleanup: (() => void)[] = [];
  private hushV: Voice | null = null;
  /** The level window's low-end lift is on until the next window closes or the next section starts. */
  private lifted = false;
  /** Cue handles named by schedule() events (opts.id), kept across calls so a later batch can stop them. */
  private named = new Map<string, CueHandle>();

  constructor(ctx?: BaseAudioContext, opts: EngineOpts = {}) {
    const C = ctx ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = C;
    this.live = typeof OfflineAudioContext === 'undefined' || !(C instanceof OfflineAudioContext);
    this.seedN = opts.seed ?? 20261020;
    this.vol = opts.volume ?? 1;
    this.isMuted = !!opts.muted || !!opts.user?.muted;
    this.userMaster = taper(opts.user?.master ?? 1);
    this.session = opts.session ?? 'playback';
    const track = opts.stats || !this.live;

    // master: duck -> highpass -> limiter -> makeup undo -> soft clip -> volume -> out
    const pre = C.createGain();
    pre.channelCount = 2;
    pre.channelCountMode = 'explicit';
    const hp = C.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 26;
    hp.Q.value = 0.6;
    const lim = C.createDynamicsCompressor();
    lim.threshold.value = LIMIT.threshold;
    lim.knee.value = LIMIT.knee;
    lim.ratio.value = LIMIT.ratio;
    lim.attack.value = LIMIT.attack;
    lim.release.value = LIMIT.release;
    this.limiter = lim;
    const undo = C.createGain();
    undo.gain.value = dB(-LIMIT_MAKEUP_DB);
    const clip = C.createWaveShaper();
    clip.curve = clipCurve(0.6, 0.85) as Float32Array<ArrayBuffer>;
    clip.oversample = '2x';
    this.volume = C.createGain();
    this.volume.gain.value = this.masterTarget();
    pre.connect(hp).connect(lim).connect(undo).connect(clip).connect(this.volume).connect(C.destination);

    this.duckG = C.createGain();
    this.yieldG = C.createGain();
    this.duckG.connect(this.yieldG).connect(pre);
    const sfxLevel = taper(opts.user?.sfx ?? 1);
    const musLevel = taper(opts.user?.music ?? 1);
    const level = (v: number) => {
      const g = C.createGain();
      g.gain.value = v;
      return g;
    };
    this.sfxUser = level(sfxLevel);
    this.bedUser = level(sfxLevel);
    this.sfxRoomIn = level(sfxLevel);
    this.sfxHallIn = level(sfxLevel);
    this.musUser = level(musLevel);
    this.musRoomIn = level(musLevel);
    this.musHallIn = level(musLevel);
    this.sfx = C.createGain();
    this.sfx.connect(this.sfxUser).connect(pre);

    const room = C.createConvolver();
    room.normalize = false;
    room.buffer = makeIR(C, this.seedN + 1, { rt60: 0.9, length: 1.1, preDelay: 0.008, damp0: 11000, damp1: 3500, early: 0.03, onset: 0.004 });
    const hall = C.createConvolver();
    hall.normalize = false;
    hall.buffer = makeIR(C, this.seedN + 2, { rt60: 3.2, length: 3.6, preDelay: 0.024, damp0: 12000, damp1: 2000, early: 0.07, onset: 0.03 });
    this.hushRoom = C.createGain();
    this.hushHall = C.createGain();
    room.connect(this.hushRoom).connect(pre);
    hall.connect(this.hushHall).connect(pre);
    this.sfxRoomIn.connect(room);
    this.sfxHallIn.connect(hall);
    this.musRoomIn.connect(room);
    this.musHallIn.connect(hall);

    this.bedBus = C.createGain();
    this.hushBeds = C.createGain();
    this.bedBus.connect(this.hushBeds).connect(this.bedUser).connect(this.duckG);

    const musicIn = C.createGain();
    this.musicIn = musicIn;
    const mlp = C.createBiquadFilter();
    mlp.type = 'lowpass';
    mlp.frequency.value = 20000;
    mlp.Q.value = 0.5;
    const shelf = C.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = 120;
    shelf.gain.value = 0;
    // air: recorded orchestras keep their 5-16 kHz (bow hair, cymbals, the hall); the synthesized score lacks it
    const air = C.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 5000;
    air.gain.value = 4;
    const mlevel = C.createGain();
    this.hushMusic = C.createGain();
    this.mlevel = mlevel;
    this.mlp = mlp;
    this.shelf = shelf;
    this.uiDuck = C.createGain();
    this.focus = C.createGain();
    musicIn.connect(mlp).connect(shelf).connect(air).connect(mlevel).connect(this.uiDuck).connect(this.focus).connect(this.hushMusic).connect(this.musUser).connect(this.duckG);

    this.lib = {
      ctx: C,
      white: makeNoise(C, this.seedN + 11, 4, 'white'),
      pink: makeNoise(C, this.seedN + 12, 4, 'pink'),
      brown: makeNoise(C, this.seedN + 13, 4, 'brown'),
      crackle: makeCrackle(C, this.seedN + 14, 0.14, 16),
      crackleLong: makeCrackle(C, this.seedN + 15, 3.7, 150),
      room: this.sfxRoomIn,
      hall: this.sfxHallIn,
      live: this.live,
      track: track
        ? (a, b) => {
            const s = { a, b };
            this.spans.push(s);
            return s;
          }
        : () => null,
    };
    this.libMusic = { ...this.lib, room: this.musRoomIn, hall: this.musHallIn };
    this.music = new Music(
      {
        lib: this.libMusic,
        hush: (a, b) => this.hush(a, b),
        seed: () => this.nextSeed(),
        onSection: (name, at) => {
          if (this.lifted) {
            this.music.lift(0, 0.3, at);
            this.lifted = false;
          }
          // the gate hum and the aura belong to the dark world: they leave when the score lifts into D major
          if (name !== 'reward' && name !== 'end' && name !== 'calm') return;
          for (const n of ['gate_hum', 'aura_bed'] as BedName[]) {
            const b = this.beds.get(n);
            if (b && !b.stopped) b.stop(2.5, at);
            this.beds.delete(n);
          }
        },
      },
      musicIn,
      { lp: mlp, shelf, level: mlevel },
    );

    if (this.live) {
      this.timer = setInterval(() => this.music.scheduleUntil(this.ctx.currentTime + 0.7), 120);
      const vis = () => {
        const ac = this.ctx as AudioContext;
        if (document.hidden) {
          if (ac.state === 'running') ac.suspend().catch(() => {});
        } else if (this.unlocked && ac.state !== 'running') ac.resume().catch(() => this.autoUnlock());
      };
      document.addEventListener('visibilitychange', vis);
      const sc = () => {
        const ac = this.ctx as AudioContext;
        if (this.unlocked && !document.hidden && (ac.state as string) === 'interrupted') this.autoUnlock();
      };
      (this.ctx as AudioContext).addEventListener('statechange', sc);
      this.cleanup.push(() => document.removeEventListener('visibilitychange', vis));
      this.cleanup.push(() => (this.ctx as AudioContext).removeEventListener('statechange', sc));
    }
  }

  private nextSeed() {
    this.seedN = (this.seedN * 1103515245 + 12345) >>> 0;
    return this.seedN;
  }

  get now() {
    return this.ctx.currentTime;
  }

  get state() {
    return (this.ctx as AudioContext).state;
  }

  /** Call synchronously inside a user gesture (pointerup / click / keydown). Safe to call repeatedly. */
  unlock(): Promise<void> {
    if (!this.live) return Promise.resolve();
    const ac = this.ctx as AudioContext;
    try {
      const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (s && s.type !== this.session) s.type = this.session;
    } catch {
      /* not available */
    }
    try {
      const b = ac.createBuffer(1, 1, ac.sampleRate);
      const src = ac.createBufferSource();
      src.buffer = b;
      src.connect(ac.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    this.unlocked = true;
    this.music.scheduleUntil(ac.currentTime + 0.7);
    return ac.state === 'running' ? Promise.resolve() : ac.resume().catch(() => {});
  }

  /** Arms a one-shot unlock on the next tap, click or key press. */
  autoUnlock(target: EventTarget = window) {
    if (!this.live) return;
    const evs = ['pointerup', 'touchend', 'click', 'keydown'];
    const h = () => {
      void this.unlock();
      if ((this.ctx as AudioContext).state === 'running' || this.unlocked) for (const e of evs) target.removeEventListener(e, h, true);
    };
    for (const e of evs) target.addEventListener(e, h, true);
  }

  /** iOS audio session type for the next unlock (and now, if already unlocked). */
  setSession(type: 'playback' | 'ambient') {
    this.session = type;
    if (this.unlocked) {
      try {
        const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
        if (s) s.type = type;
      } catch {
        /* ignore */
      }
    }
  }

  private masterTarget() {
    return this.isMuted ? 0 : this.vol * this.userMaster;
  }

  setVolume(v: number, ramp = 0.2) {
    this.vol = Math.max(0, Math.min(1, v));
    this.volume.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, Math.max(0.003, ramp / 4));
  }

  setMuted(m: boolean, ramp = 0.2) {
    this.isMuted = m;
    this.volume.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, Math.max(0.003, ramp / 4));
  }

  /** Her levels from the speaker control, 0..1 each; master multiplies the scene level set by setVolume. */
  setUser(l: UserLevels, ramp = 0.08): void {
    const t = this.ctx.currentTime;
    const tau = Math.max(0.003, ramp / 4);
    this.userMaster = taper(l.master);
    this.isMuted = !!l.muted;
    this.volume.gain.setTargetAtTime(this.masterTarget(), t, tau);
    const m = taper(l.music);
    for (const g of [this.musUser, this.musRoomIn, this.musHallIn]) g.gain.setTargetAtTime(m, t, tau);
    const s = taper(l.sfx);
    for (const g of [this.sfxUser, this.bedUser, this.sfxRoomIn, this.sfxHallIn]) g.gain.setTargetAtTime(s, t, tau);
  }

  /** Current output gains (QA): master after scene level and mute, and the Music / Effects levels. */
  get levels() {
    return { master: this.volume.gain.value, music: this.musUser.gain.value, sfx: this.sfxUser.gain.value };
  }

  /** QA: the Effects bus or the score's input, to feed a test tone through the real graph. */
  testInput(bus: 'sfx' | 'music'): GainNode {
    return bus === 'sfx' ? this.sfx : this.musicIn;
  }

  get muted() {
    return this.isMuted;
  }

  play(cue: CueName | string, opts: PlayOpts = {}): CueHandle {
    const def = CUES[cue];
    const at = Math.max(opts.at ?? this.ctx.currentTime, this.live ? this.ctx.currentTime : 0);
    if (!def) {
      console.warn('[audio] unknown cue', cue);
      return { stop() {}, end: at };
    }
    const detune = opts.detune ?? (opts.index !== undefined ? opts.index * 50 : 0);
    const v = new Voice(this.lib, at, this.sfx, { gain: (opts.gain ?? 1) * dB(def.gainDb ?? 0), pan: opts.pan, detune, room: def.room, hall: def.hall }, this.nextSeed());
    try {
      def.fn(v, { dur: opts.dur });
    } catch (err) {
      console.warn('[audio] cue failed', cue, err);
    }
    if (UI_DUCK.has(cue)) {
      const g = this.uiDuck.gain;
      g.setTargetAtTime(dB(-3), at, 0.012);
      g.setTargetAtTime(1, at + 0.28, 0.16);
    }
    // paced breathing: the score steps back for the whole exercise (each cue extends the dip; it lifts after the last)
    if (cue === 'breath_in' || cue === 'breath_out') this.toFocus(dB(-6.5), at, 0.3, at + Math.max(opts.dur ?? 0, 10) + 0.4);
    // the important (level) window: the score's low end lifts +5 dB while it is open, not a louder chime
    if (cue === 'ui_open' && opts.detune === 500) {
      this.music.lift(5, 0.3, at);
      this.lifted = true;
    } else if (cue === 'ui_close' && this.lifted) {
      this.music.lift(0, 0.4, at);
      this.lifted = false;
    }
    // inside the roar wall the score and the vortex make room: -3 dB under the ignition, and a -2 dB held breath while
    // the stand-up swell rises, released on the stand itself (~1.05 s after the swell starts)
    if (cue === 'soldier_ignite') this.makeRoom(at, -3, 0.03, at + 0.5, 0.3);
    else if (cue === 'stand_swell') this.makeRoom(at + 0.12, -2, 0.2, at + 1.04, 0.004);
    if (cue === "arise_hit") {
      this.music.onHit(at);
      if (this.hushV) this.unhush(at);
    }
    if (this.live) {
      this.active.add(v);
      const ms = (v.end - this.ctx.currentTime + 4) * 1000;
      setTimeout(() => {
        v.out.disconnect();
        this.active.delete(v);
      }, Math.max(1000, ms));
    }
    return {
      stop: (t = this.ctx.currentTime, ramp = 0.03) => v.stop(t, ramp),
      get end() {
        return v.end;
      },
    };
  }

  /** Start (or re-level) a continuous bed. Calling it again for a running bed ramps its level. */
  bed(name: BedName, o: { at?: number; level?: number; fadeIn?: number } = {}): BedHandle {
    const at = o.at ?? this.ctx.currentTime;
    const cur = this.beds.get(name);
    if (cur && !cur.stopped) {
      if (o.level !== undefined) cur.level(o.level, o.fadeIn ?? 0.5, at);
      return cur;
    }
    const h = startBed(this.lib, name, this.bedBus, at, o.level ?? 1, o.fadeIn ?? 0.5, this.nextSeed());
    this.beds.set(name, h);
    return h;
  }

  private makeRoom(at: number, db: number, tau: number, back: number, tauBack: number) {
    const g = this.yieldG.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(dB(db), at, tau);
    g.setTargetAtTime(1, back, tauBack);
  }

  /** Move the focus dip to `v` from `at` (time constant tau); with `back`, return to full level from then. */
  private toFocus(v: number, at: number, tau: number, back?: number) {
    const g = this.focus.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(v, at, tau);
    if (back !== undefined) g.setTargetAtTime(1, back, 0.8);
  }

  /** The hold-to-charge loop (idle hum at c=0). One at a time; calling again returns the running one. While it runs the
   *  score steps back (-2 dB idle, -9 dB at full charge); after stop() it swells back in behind the burst. */
  chargeLoop(o: { at?: number } = {}): ChargeHandle {
    if (this.charge) return this.charge;
    const t0 = Math.max(o.at ?? this.ctx.currentTime, this.live ? this.ctx.currentTime : 0);
    const h = startCharge(this.lib, this.sfx, t0, this.nextSeed());
    const self = this;
    const now = (at?: number) => Math.max(at ?? self.ctx.currentTime, self.live ? self.ctx.currentTime : 0);
    this.toFocus(dB(-2), t0, 0.4);
    this.charge = {
      set(c: number, at?: number) {
        h.set(c, at);
        self.toFocus(dB(-2 - 7 * Math.max(0, Math.min(1, c))), now(at), 0.08);
      },
      release(at?: number) {
        h.release(at);
        self.toFocus(dB(-2), now(at), 0.15);
      },
      stop(at?: number, ramp?: number) {
        h.stop(at, ramp);
        self.charge = null;
        self.toFocus(1, now(at) + 0.3, 0.5);
      },
    };
    return this.charge;
  }

  /**
   * Silence before the hit: beds, score and reverb returns drop ~-40 dB in 25 ms, leaving a faint room tone (about
   * -35 dBFS RMS) so the hit lands +22 dB over it. With `to`, everything returns at `to` in ~5 ms. Without it the hush
   * holds until unhush() or the next arise_hit. An open-ended arise section cuts its build here.
   */
  hush(from = this.ctx.currentTime, to?: number) {
    for (const g of [this.hushBeds.gain, this.hushMusic.gain, this.hushHall.gain, this.hushRoom.gain]) {
      g.cancelScheduledValues(from);
      g.setTargetAtTime(0.008, from, 0.007);
      if (to !== undefined) g.setTargetAtTime(1, to, 0.0015);
    }
    this.hushV?.stop(from, 0.02);
    const end = to ?? from + 120;
    const v = new Voice(this.lib, from, this.sfx, {}, this.nextSeed());
    const g = v.gain(0, v.dry);
    g.gain.setValueAtTime(0, from);
    g.gain.linearRampToValueAtTime(0.065, from + 0.03);
    if (to !== undefined) {
      g.gain.setValueAtTime(0.065, to - 0.01);
      g.gain.linearRampToValueAtTime(0, to + 0.02);
    }
    v.noise("brown", from, end + 0.05, v.filt("lowpass", 240, 0.7, g));
    v.noise("pink", from, end + 0.05, v.gain(0.08, v.filt("highpass", 1800, 0.7, g)));
    this.hushV = to === undefined ? v : null;
    this.music.onHush(from);
  }

  /** End an open-ended hush (arise_hit does this itself). */
  unhush(at = this.ctx.currentTime) {
    for (const g of [this.hushBeds.gain, this.hushMusic.gain, this.hushHall.gain, this.hushRoom.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(1, at, 0.0015);
    }
    this.hushV?.stop(at, 0.02);
    this.hushV = null;
  }

  /** Duck beds + score together (e.g. -3 dB as the gate dims for the first window). */
  duck(db: number, ramp = 0.4, at = this.ctx.currentTime) {
    this.duckG.gain.cancelScheduledValues(at);
    this.duckG.gain.setTargetAtTime(dB(db), at, Math.max(0.003, ramp / 4));
  }

  /** Stop beds, charge and score (e.g. on replay or leaving the cutscene). */
  stopAll(fade = 0.4, at = this.ctx.currentTime) {
    for (const v of this.active) v.stop(at, fade);
    this.active.clear();
    for (const b of this.beds.values()) b.stop(fade, at);
    this.beds.clear();
    this.charge?.stop(at, fade);
    this.music.stop(fade, at);
  }

  /** Stop everything and restore the score controls (level, low-pass, lift, duck, hush) for a clean replay. */
  reset(fade = 0.3, at = this.ctx.currentTime) {
    this.stopAll(fade, at);
    const set = (p: AudioParam, v: number) => {
      p.cancelScheduledValues(at);
      p.setTargetAtTime(v, at, Math.max(0.003, fade / 4));
    };
    set(this.mlevel.gain, 1);
    set(this.mlp.frequency, 20000);
    set(this.shelf.gain, 0);
    set(this.duckG.gain, 1);
    set(this.uiDuck.gain, 1);
    set(this.focus.gain, 1);
    set(this.yieldG.gain, 1);
    this.lifted = false;
    for (const g of [this.hushBeds.gain, this.hushMusic.gain, this.hushHall.gain, this.hushRoom.gain]) set(g, 1);
    this.hushV?.stop(at, fade);
    this.hushV = null;
  }

  /** Full charge reached: cut the charge loop, 200 ms hush, then the gold burst (visual leads by 1-2 frames). */
  chestBurst(at = this.ctx.currentTime) {
    this.charge?.stop(at, 0.03);
    this.hush(at, at + 0.2);
    return this.play("chest_burst", { at: at + 0.2 });
  }

  /**
   * Run an event list (the same format renderOffline takes) starting at context time t0.
   * - { t, cue: '<cue>', opts? }                         play a cue; opts.id names it for a later 'stop'
   * - { t, cue: 'stop', opts: { id, ramp? } }            stop a named cue (e.g. the stand swell on the hard cut)
   * - { t, cue: 'bed', loop: { name, level?, until? }, opts?: { fade?, fadeOut? } }   start or re-level a bed
   * - { t, cue: 'bed_stop', loop: { name }, opts?: { fade? } }
   * - { t, cue: 'charge', loop?: { name: 'charge', level: c }, opts?: { c } }       start / set the charge loop
   * - { t, cue: 'charge_release' } / { t, cue: 'charge_stop' }
   * - { t, cue: 'music', opts: { section, fade?, fadeOut?, hitAt?, standAt? } }   (hitAt / standAt in event time)
   * - { t, cue: 'music_stop' | 'music_level' | 'music_lowpass' | 'music_lift', opts: { fade? | v, ramp? | hz, ramp? | db, ramp? } }
   * - { t, cue: 'hush', opts: { until } } / { t, cue: 'duck', opts: { db, ramp? } }
   */
  schedule(events: SoundEvent[], t0 = this.ctx.currentTime) {
    const named = this.named;
    const sorted = [...events].sort((a, b) => a.t - b.t);
    for (const e of sorted) {
      const at = t0 + e.t;
      const o = (e.opts ?? {}) as Record<string, any>;
      const loopName = e.loop?.name;
      switch (e.cue) {
        case 'stop':
          named.get(o.id)?.stop(at, o.ramp ?? 0.04);
          break;
        case 'bed':
        case 'bed_stop': {
          const name = loopName as BedName;
          if (e.cue === 'bed_stop') {
            this.beds.get(name)?.stop(o.fade ?? 0.5, at);
            this.beds.delete(name);
            break;
          }
          const h = this.bed(name, { at, level: e.loop?.level ?? 1, fadeIn: o.fade ?? 0.5 });
          if (e.loop?.until !== undefined) h.stop(o.fadeOut ?? 0.5, t0 + e.loop.until);
          break;
        }
        case 'charge': {
          const h = this.chargeLoop({ at });
          const c = o.c ?? e.loop?.level;
          if (c !== undefined) h.set(c, at);
          if (e.loop?.until !== undefined) h.stop(t0 + e.loop.until, 0.03);
          break;
        }
        case 'charge_release':
          this.charge?.release(at);
          break;
        case 'charge_stop':
          this.charge?.stop(at, o.ramp ?? 0.03);
          break;
        case 'music':
          this.music.to((o.section ?? loopName) as Section, o.fade ?? 2, {
            at,
            fadeOut: o.fadeOut,
            hitAt: o.hitAt !== undefined ? t0 + o.hitAt : undefined,
            standAt: o.standAt !== undefined ? t0 + o.standAt : undefined,
          });
          break;
        case 'music_stop':
          this.music.stop(o.fade ?? 1, at);
          break;
        case 'music_level':
          this.music.level(o.v ?? 1, o.ramp ?? 1, at);
          break;
        case 'music_lowpass':
          this.music.lowpass(o.hz ?? 20000, o.ramp ?? 1, at);
          break;
        case 'music_lift':
          this.music.lift(o.db ?? 0, o.ramp ?? 0.5, at);
          break;
        case "hush":
          this.hush(at, o.until !== undefined ? t0 + o.until : undefined);
          break;
        case "unhush":
          this.unhush(at);
          break;
        case 'duck':
          this.duck(o.db ?? 0, o.ramp ?? 0.4, at);
          break;
        case 'reset':
          this.reset(o.fade ?? 0.3, at);
          break;
        case 'chest_burst_full':
          this.chestBurst(at);
          break;
        default: {
          if (e.loop && (BED_NAMES as string[]).includes(e.cue)) {
            const h = this.bed(e.cue as BedName, { at, level: e.loop.level ?? 1, fadeIn: o.fade ?? 0.5 });
            if (e.loop.until !== undefined) h.stop(o.fadeOut ?? 0.5, t0 + e.loop.until);
            break;
          }
          const h = this.play(e.cue, { ...o, at });
          if (o.id) named.set(o.id, h);
        }
      }
    }
    this.music.scheduleUntil(Math.min(this.ctx.currentTime + 0.7, t0 + 1e6));
  }

  /** Peak number of simultaneously scheduled source nodes (oscillators + buffer sources), from recorded spans. */
  stats() {
    const ev: [number, number][] = [];
    for (const { a, b } of this.spans) ev.push([a, 1], [b, -1]);
    ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let cur = 0, peak = 0, peakAt = 0;
    for (const [t, d] of ev) {
      cur += d;
      if (cur > peak) {
        peak = cur;
        peakAt = t;
      }
    }
    return { sources: this.spans.length, peakSources: peak, peakAt };
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    for (const f of this.cleanup) f();
    if (this.live) (this.ctx as AudioContext).close().catch(() => {});
  }
}

export interface SoundEvent {
  t: number;
  cue: string;
  opts?: any;
  loop?: { name: string; level?: number; until?: number };
}

/**
 * Render an event list to a stereo buffer with the exact live synthesis. Like the live app, cues are created shortly
 * before they sound and the score is scheduled ahead in windows (the render suspends every `step` seconds to feed the
 * next window), so the graph never carries minutes of pending nodes. Defaults: 4 s steps, events and score 5 s ahead.
 * `{ step: 0.12, ahead: 0.12, musicAhead: 0.7 }` replays the live app's timing (QA: live scheduling == capture).
 */
export async function renderOffline(events: SoundEvent[], durationSec: number, sampleRate = 48000, engOpts: EngineOpts = {}, ro: RenderOpts = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
  const eng = new AudioEngine(ctx, engOpts);
  const sorted = [...events].sort((a, b) => a.t - b.t);
  // each suspend costs a main-thread round trip (~40 ms in Chromium), so the default steps are long
  const STEP = ro.step ?? 4;
  const AHEAD = ro.ahead ?? 5;
  const MAHEAD = ro.musicAhead ?? 5;
  let i = 0;
  const feed = (now: number) => {
    let j = i;
    while (j < sorted.length && sorted[j].t < now + AHEAD) j++;
    if (j > i) eng.schedule(sorted.slice(i, j), 0);
    i = j;
    eng.music.scheduleUntil(Math.min(durationSec, now + MAHEAD));
  };
  feed(0);
  const q = 128 / sampleRate;
  let last = 0;
  for (let k = 1; k * STEP < durationSec; k++) {
    const at = Math.round((k * STEP) / q) * q;
    if (at <= last || at >= durationSec - q) continue;
    last = at;
    ctx.suspend(at).then(() => {
      try {
        ro.onStep?.(at);
        feed(at);
      } finally {
        void ctx.resume();
      }
    });
  }
  const buf = await ctx.startRendering();
  lastStats = eng.stats();
  return buf;
}

export interface RenderOpts {
  step?: number;
  ahead?: number;
  musicAhead?: number;
  onStep?: (t: number) => void;
}

export let lastStats: ReturnType<AudioEngine['stats']> | null = null;

/** 16-bit PCM WAV (or 32-bit float with { float: true }). */
export function bufferToWav(buf: AudioBuffer, o: { float?: boolean } = {}): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bps = o.float ? 4 : 2;
  const data = n * ch * bps;
  const ab = new ArrayBuffer(44 + data);
  const dv = new DataView(ab);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, o.float ? 3 : 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * ch * bps, true);
  dv.setUint16(32, ch * bps, true);
  dv.setUint16(34, bps * 8, true);
  str(36, 'data');
  dv.setUint32(40, data, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = chans[c][i];
      if (o.float) dv.setFloat32(off, x, true);
      else dv.setInt16(off, Math.max(-32768, Math.min(32767, Math.round(x * 32767))), true);
      off += bps;
    }
  }
  return ab;
}

export function toBase64(ab: ArrayBuffer) {
  const u = new Uint8Array(ab);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 0x8000)));
  return btoa(s);
}

/** Nominal render length of a cue (tails included). */
export function cueLength(cue: string) {
  return CUES[cue]?.len ?? 1;
}
