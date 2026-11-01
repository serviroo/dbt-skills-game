import * as THREE from 'three';
import type { Stage } from '../core/stage';
import { params } from '../core/params';
import { clamp, cubicBezier, ease, fbm1, lerp, smoothstep } from '../core/math';
import { animate, wait, uiNow, pauseAfter, onAnimate } from '../ui/anim';
import { LanternWindow, levelBody, lanternLayer, type RevealCtx } from '../ui/lantern-window';
import { GATE, LEVEL, REFRAME } from '../motion/tokens';
import { Letterbox, awakenWord, rewardCards, letterView, endCard, fader } from '../ui/cutscene-ui';
import { INTRO, WINDOWS, REWARDS } from '../content/intro';
import { POSES } from '../scene/character/hero';
import { light } from '../scene/toon';
import { buildWorld, characterLighting, type World } from './world';

/** Minimal audio surface the director needs; the audio module implements it. */
export interface AudioLike {
  play(cue: string, opts?: Record<string, number>): unknown;
  bed?(name: string): { level(v: number, ramp?: number): void; stop(ramp?: number): void } | undefined;
  chargeLoop?(): { set(c: number): void; release(): void; stop(): void };
  music?: {
    to(section: string, fade?: number, opts?: { at?: number; fadeOut?: number; hitAt?: number; standAt?: number }): void;
    /** fades out whatever section plays */
    stop?(fade?: number): void;
  };
  hush?(from?: number, to?: number): void;
  /** ends an open-ended hush */
  unhush?(): void;
  duck?(db: number, ramp: number): void;
}
const NOAUDIO: AudioLike = { play: () => undefined };
type Sound = { stop(at?: number, ramp?: number): void };
/** thrown by a beat's wait once the scene has ended early, so the rest of that beat never runs */
const SKIP = Symbol('skip');

type Track = (lt: number, dt: number) => void;
interface Shot {
  pos: (lt: number) => THREE.Vector3;
  look: (lt: number) => THREE.Vector3;
  fov: (lt: number) => number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lin = (a: THREE.Vector3, b: THREE.Vector3, dur: number, e: (t: number) => number = (t) => t) => (lt: number) => a.clone().lerp(b, e(clamp(lt / dur)));
const still = (v: THREE.Vector3) => () => v.clone();
const easeIgnite = cubicBezier(0.7, 0, 0.95, 0.55);
const easeLetterbox = cubicBezier(0.33, 0.1, 0.25, 1);
const easeReach = cubicBezier(0.15, 0.6, 0.3, 1);
const easePush = cubicBezier(0.3, 0, 0.6, 1);
const stepped = (t: number, fps: number) => Math.floor(t * fps) / fps;

/** the middle of his eyes, in the world, as he stands now */
function eyeCentre(jw: World['jw']) {
  jw.group.updateMatrixWorld(true);
  const c = new THREE.Vector3();
  jw.eyes.group.children.forEach((e) => c.add(e.getWorldPosition(new THREE.Vector3())));
  return c.multiplyScalar(1 / Math.max(1, jw.eyes.group.children.length));
}

/** The chest shot: a dolly in over `sec`, from `back[0]` to `back[1]` in front of the chest (further on a narrow screen,
 *  see chestFrame), aimed at `look`. The chest stays `edge` of the frame inside its edges and `promptGap` px clear of
 *  the hold prompt, and his eyes no nearer the top than `headroom` of the frame (or than the shot has them, if nearer). */
const CHEST_SHOT = { z: 1.45, y: [1.02, 0.98], back: [3.25, 2.85], look: [0, 0.62, 1.2], fov: 32, sec: 12, edge: 0.04, promptGap: 12, headroom: 0.12 } as const;
/** where the chest shot's camera stands and aims `u` of the way through its dolly */
function chestPose(k: number, u: number, shift: THREE.Vector3, pos: THREE.Vector3, look: THREE.Vector3) {
  const S = CHEST_SHOT;
  pos.set(0, lerp(S.y[0], S.y[1], u), S.z + lerp(S.back[0], S.back[1], u) * k).add(shift);
  look.set(...S.look).add(shift);
}

export class Director {
  w!: World;
  private shot: Shot | null = null;
  private shotT0 = 0;
  private tracks = new Set<{ t0: number; fn: Track; until: number }>();
  private lb!: Letterbox;
  private shakeT0 = -1;
  private handheld = 0.6;
  skipped = false;
  private removeVisibility: (() => void) | null = null;
  private resolveSkip: () => void = () => {};
  /** resolves when the scene ends early (the player leaves the intro, or the context is lost), so whatever the beat in
   *  flight is waiting on ends there */
  private readonly skip = new Promise<void>((r) => (this.resolveSkip = r));
  private baseBloom = 1.15;
  /** the screen's width over its height as the last frame was drawn */
  private aspect = 0;
  /** the picture the last frame drew, where a re-frame eases from when the screen changes shape */
  private readonly drawn = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 30, slit: 0 };
  private reframe: { t0: number; pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; slit: number } | null = null;
  /** the gate's width for each unit of aspect while its slit keeps its share of the frame's width (the gate and the
   *  windows), so it keeps that share whichever way the phone is held; 0 once it stands at a fixed width */
  private slitPerAspect = 0;
  /** the chest shot's framing for the screen size it was worked out for (see chestFrame) */
  private readonly chestFit = { w: 0, h: 0, k: 1, shift: new THREE.Vector3() };

  readonly audio: AudioLike;
  /** every sound, charge hum and bed the cut scene starts, so an early end can stop whatever still plays */
  private sounds = new Set<Sound>();
  private beds = new Set<string>();

  constructor(readonly stage: Stage, audio: AudioLike = NOAUDIO) {
    this.audio = this.keeping(audio);
  }

  /** The cut scene's audio, holding on to everything it starts. */
  private keeping(a: AudioLike): AudioLike {
    const keep = <T>(h: T) => {
      if (typeof (h as Partial<Sound> | undefined)?.stop === 'function') this.sounds.add(h as Sound);
      return h;
    };
    return {
      play: (cue, opts) => keep(a.play(cue, opts)),
      bed: a.bed && ((name) => (this.beds.add(name), a.bed!(name))),
      chargeLoop: a.chargeLoop && (() => keep(a.chargeLoop!())),
      music: a.music,
      hush: a.hush && ((from, to) => a.hush!(from, to)),
      unhush: a.unhush && (() => a.unhush!()),
      duck: a.duck && ((db, ramp) => a.duck!(db, ramp)),
    };
  }

  async init() {
    this.w = await this.stage.loading(buildWorld(this.stage));
    characterLighting();
    this.baseBloom = this.stage.bloom.intensity;
    const cam = this.w.cam;
    this.stage.onUpdate((t, dt) => {
      const now = uiNow();
      const aspect = this.stage.width / this.stage.height;
      if (aspect !== this.aspect) {
        // the screen changed shape mid-shot (a phone turned): every shot below frames for the new shape at once, and the
        // picture eases there from what was on screen, or cuts there with reduced motion. The beat's clock runs on
        if (this.aspect && !params.reduced) {
          const d = this.drawn;
          this.reframe = { t0: now, pos: d.pos.clone(), quat: d.quat.clone(), fov: d.fov, slit: d.slit };
        }
        this.aspect = aspect;
      }
      for (const tr of this.tracks) {
        const lt = now - tr.t0;
        tr.fn(Math.min(lt, tr.until), dt);
        if (lt >= tr.until) this.tracks.delete(tr);
      }
      if (this.shot) {
        const lt = now - this.shotT0;
        cam.position.copy(this.shot.pos(lt));
        const f = this.shot.fov(lt);
        if (Math.abs(cam.fov - f) > 1e-4) {
          cam.fov = f;
          cam.updateProjectionMatrix();
        }
        cam.lookAt(this.shot.look(lt));
        if (!params.reduced && this.handheld > 0) {
          const k = this.handheld * 0.0016;
          cam.rotateX(fbm1(t * 0.35, 3) * k);
          cam.rotateY(fbm1(t * 0.3, 9) * k);
        }
        this.applyShake(cam, now);
      }
      this.settle(cam, now);
    });
  }

  /** Eases a re-frame in progress from the picture on screen when the screen changed shape, keeps the gate's slit at its
   *  share of the frame, and notes the picture this frame draws. */
  private settle(cam: THREE.PerspectiveCamera, now: number) {
    // reduced motion turned on while a re-frame eases: the picture cuts to where it was going
    if (params.reduced) this.reframe = null;
    const r = this.reframe;
    const k = r ? ease.outCubic(clamp((now - r.t0) / REFRAME.sec)) : 1;
    if (r) {
      cam.position.lerpVectors(r.pos, cam.position, k);
      cam.quaternion.slerpQuaternions(r.quat, cam.quaternion, k);
      cam.fov = lerp(r.fov, cam.fov, k);
      cam.updateProjectionMatrix();
      if (k >= 1) this.reframe = null;
    }
    const d = this.drawn;
    if (this.slitPerAspect) {
      const slit = this.slitPerAspect * this.aspect;
      const w = r ? lerp(r.slit, slit, k) : slit;
      if (w !== d.slit) (this.w.gate as { setWidth?: (w: number) => void }).setWidth?.(w);
      d.slit = w;
    }
    d.pos.copy(cam.position);
    d.quat.copy(cam.quaternion);
    d.fov = cam.fov;
  }

  private applyShake(cam: THREE.PerspectiveCamera, now: number) {
    if (this.shakeT0 < 0 || params.reduced) return;
    const lt = now - this.shakeT0;
    if (lt < 0 || lt > 0.3) return;
    if (this.w.awaken?.shake) {
      this.w.awaken.shake(cam, now, this.shakeT0);
      return;
    }
    // 1.0-1.3 % of frame height, updated every 2 frames, decay x0.55 per step, rotation <= 0.5 deg
    const step = Math.floor(lt / (2 / 60));
    const amp = 0.012 * Math.pow(0.55, step);
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const sx = Math.sin(step * 12.9898) * 43758.5453, sy = Math.sin(step * 78.233) * 12543.123;
    const rx = (sx - Math.floor(sx)) * 2 - 1, ry = (sy - Math.floor(sy)) * 2 - 1;
    cam.rotateX(ry * amp * h * 0.5);
    cam.rotateY(rx * amp * h * 0.5);
    cam.rotateZ(rx * THREE.MathUtils.degToRad(0.5) * Math.pow(0.55, step));
  }

  private cut(shot: Shot) {
    this.shot = shot;
    this.shotT0 = uiNow();
  }

  private track(dur: number, fn: Track) {
    const tr = { t0: uiNow(), fn, until: dur };
    this.tracks.add(tr);
    fn(0, 0);
  }

  /** The scene ends early: the beat in flight ends at its wait, its moving parts land on their last frame, its pending
   *  cues stay silent, and the picture and sound are left as the rewards expect. */
  private skipNow() {
    if (this.skipped) return;
    this.removeVisibility?.();
    this.skipped = true;
    for (const tr of this.tracks) tr.fn(tr.until, 0);
    this.tracks.clear();
    // the camera holds where the end found it: no shot, sway or shake moves it behind the rewards
    this.shot = null;
    // every sound the cut scene started stops here; the rewards bring their own
    for (const s of this.sounds) s.stop(undefined, 0.04);
    this.sounds.clear();
    for (const b of this.beds) this.audio.bed?.(b)?.stop(0.04);
    this.audio.music?.stop?.(0.04);
    this.audio.unhush?.();
    this.audio.duck?.(0, 0.03);
    this.lb.set(0);
    this.neutralGrade();
    this.resolveSkip();
  }

  /** Ends the beat in flight once the scene has ended early. */
  private stopIfSkipped() {
    if (this.skipped) throw SKIP;
  }

  /** A cue `sec` from now on the beat clock, dropped if the scene ends first. */
  private cue(sec: number, fn: () => void) {
    wait(sec).then(() => {
      if (!this.skipped) fn();
    });
  }

  private async hold(sec: number) {
    this.stopIfSkipped();
    await Promise.race([wait(sec), this.skip]);
    this.stopIfSkipped();
  }

  /** Lantern window: opens, waits for their tap (auto-advance in capture mode or after a long idle). An early end takes
   *  it down at once, opening, waiting or closing. */
  private async window(spec: ConstructorParameters<typeof LanternWindow>[1], readSec: number) {
    this.stopIfSkipped();
    const win = new LanternWindow(lanternLayer(), { tapToContinue: true, ...spec });
    void this.skip.then(() => win.dismiss());
    await Promise.race([win.open(), this.skip]);
    if (params.capture) await this.hold(readSec);
    else await win.waitForInput(Math.max(readSec + 8, 14));
    await win.close();
    this.stopIfSkipped();
  }

  private neutralGrade() {
    const g = this.stage.grade;
    g.u('flashAmount').value = 0;
    g.u('saturation').value = 1;
    g.u('fade').value = 0;
    g.u('gammaV').value = 1;
    (g.u('flashColor').value as THREE.Color).set(1, 1, 1);
  }

  /* ======================================================================================= */

  /** Plays from the gate (or `?shot`'s beat) to the end card. `left` aborts when the player leaves the intro (the Safe
   *  Zone or Skip): the scene ends there, and nothing after it shows. */
  async play(left?: AbortSignal): Promise<'replay' | 'enter'> {
    // left while the world loaded: none of the scene starts
    if (left?.aborted) return new Promise<never>(() => undefined);
    this.lb = new Letterbox();
    const paused = new Set<Animation>();
    const offAnimate = onAnimate((a) => {
      if (!document.hidden || a.playState !== 'running') return;
      paused.add(a);
      a.pause();
    });
    const show = () => {
      for (const a of paused) if (a.playState === 'paused') a.play();
      paused.clear();
      pauseAfter(false);
    };
    const visibility = () => {
      if (!document.hidden) return show();
      for (const a of document.getAnimations()) {
        if (a.playState !== 'running') continue;
        paused.add(a);
        a.pause();
      }
      pauseAfter(true);
    };
    document.addEventListener('visibilitychange', visibility);
    this.removeVisibility = () => {
      show();
      document.removeEventListener('visibilitychange', visibility);
      offAnimate();
      this.removeVisibility = null;
    };
    visibility();
    // the scene can't go on without its WebGL context: losing it ends the scene, and the rewards, letter and end card
    // need no 3D
    const offLost = this.stage.onLost(() => this.skipNow());
    const leave = () => this.skipNow();
    left?.addEventListener('abort', leave);
    const start = params.shot || '';
    const order = ['gate', 'windows', 'silhouette', 'awaken', 'chest', 'rewards'];
    const from = Math.max(0, order.indexOf(start));
    try {
      this.stopIfSkipped();
      if (from <= 0) await this.beatGate();
      if (from <= 1) await this.beatWindows();
      if (from <= 2) await this.beatSilhouette();
      if (from <= 3) await this.beatAwaken();
      if (from <= 4) await this.beatChest();
    } catch (e) {
      if (e !== SKIP) throw e;
    } finally {
      offLost();
      left?.removeEventListener('abort', leave);
      this.removeVisibility?.();
    }
    if (left?.aborted) return new Promise<never>(() => undefined);
    return this.beatRewards(left);
  }

  /* ---------------------------------------------------------------- beat 1: void and gate */
  private async beatGate() {
    const { gate, jw } = this.w;
    jw.group.visible = false;
    this.w.aura?.setIntensity(0);
    this.handheld = GATE.handheld;
    const from = V(...GATE.dollyFrom), to = V(...GATE.dollyTo), look = V(...GATE.lookAt);
    this.cut({ pos: lin(from, to, GATE.dollySec), look: still(look), fov: () => GATE.fov });
    this.w.cam.position.copy(from);
    this.w.cam.lookAt(look);
    // the slit's share of the frame's width is measured from where the dolly starts, and kept on any screen shape
    const slit = (gate as { fitWidth?: (c: THREE.PerspectiveCamera) => number }).fitWidth?.(this.w.cam);
    if (slit) {
      this.slitPerAspect = slit / this.w.cam.aspect;
      this.drawn.slit = slit;
    }
    const t0 = uiNow();
    gate.setDim(1);
    gate.openAt(t0 + GATE.crackSec);
    this.audio.music?.to('intro', GATE.musicFadeSec);
    this.cue(GATE.airSec, () => this.audio.play('gate_air'));
    this.cue(GATE.crackSec, () => this.audio.play('gate_crack'));
    this.cue(GATE.swellSec, () => this.audio.play('gate_swell'));
    this.cue(GATE.humSec, () => this.audio.bed?.('gate_hum')?.level(GATE.humLevel, GATE.humFadeSec));
    await this.hold(GATE.holdSec);
    this.track(GATE.dimSec, (lt) => gate.setDim(lerp(1, GATE.dimTo, ease.outCubic(lt / GATE.dimSec))));
    await this.hold(GATE.dimSec);
  }

  /* ---------------------------------------------------------------- beats 2-3: Lantern windows */
  private async beatWindows() {
    this.audio.music?.to('windows', 2);
    await this.window({ kind: 'notification', title: WINDOWS.chosen.title, html: WINDOWS.chosen.html }, 4.6);
    if (this.skipped) return;
    await this.hold(0.1);
    const L = WINDOWS.level;
    const levelWin = this.window(
      {
        kind: 'level',
        icon: 'level',
        title: L.title,
        html: levelBody(L.big, L.rows, L.footer),
        onCue: (cue, i) => {
          if (cue === 'row') this.audio.play('level_tick', { index: i ?? 0 });
          if (cue === 'land') this.audio.play('level_resolve');
        },
      },
      5.6,
    );
    this.cue(LEVEL.ringSec, () => this.audio.play('level_ring'));
    await levelWin;
    if (this.skipped) return;
    await this.hold(0.1);
    await this.dailyQuest();
  }

  /** The quest window as a joke: boxes tick, then the warning lands on "nothing". */
  private async dailyQuest() {
    const Q = WINDOWS.quest;
    const box = (done: boolean) =>
      `<i class="dq-box" role="img" aria-label="${done ? 'Complete' : 'Incomplete'}"><svg viewBox="0 0 14 14" aria-hidden="true"><path class="b" d="M8 3.5H3A1.5 1.5 0 0 0 1.5 5v6A1.5 1.5 0 0 0 3 12.5h6a1.5 1.5 0 0 0 1.5-1.5V7.5"/>${done ? '<path class="c" pathLength="1" d="M3.9 7.7l2.3 2.4 6.6-8.4"/>' : ''}</svg></i>`;
    const rows = Q.rows.map(([k, v, done]) => `<div class="sw-row dq-row"><span class="k">${k}</span><span class="v">[${v}]${box(done)}</span></div>`).join('');
    const html =
      `<p class="center dq-arrived">${Q.arrived}</p><div class="dq-goal">${Q.goal}</div><div class="sw-rows dq-rows">${rows}</div>` +
      `<p class="center dq-warn"><span class="dq-w">WARNING:</span> ${Q.warning}<span class="dq-dots">...</span> <b class="dq-punch">${Q.punch}</b></p>` +
      `<p class="center sys dq-side"><span>${Q.after}</span></p>`;
    const reveal = ({ root, reduced, animate, cue }: RevealCtx) => {
      if (reduced) return;
      root.querySelectorAll<SVGPathElement>('.dq-box path.c').forEach((tick, i) => {
        const at = 0.95 + i * 0.26;
        animate(tick, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 190, delay: at * 1000, easing: 'cubic-bezier(.4,0,.2,1)' });
        cue(at * 1000, () => this.audio.play('level_tick', { index: i, detune: 200 + i * 200 }));
      });
      const show = (sel: string, at: number, dur: number) => {
        const n = root.querySelector<HTMLElement>(sel);
        if (n) animate(n, [{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: dur, delay: at * 1000, easing: 'cubic-bezier(.16,1,.3,1)' });
      };
      show('.dq-dots', 1.75, 420);
      show('.dq-punch', 2.3, 260);
      show('.dq-side span', 2.75, 500);
      cue(2300, () => this.audio.play('soft_chime', { gain: 0.5 }));
    };
    // the reveal runs inside the window's typing, so a tap that completes the typing completes it too
    await this.window({ kind: 'quest', icon: 'alert', title: Q.title, html, width: 'min(92vw, 680px)', reveal }, 3.4);
  }

  /* ---------------------------------------------------------------- beat 4: silhouette, eyes */
  private async beatSilhouette() {
    if (this.skipped) return;
    const { jw, gate, aura } = this.w;
    characterLighting();
    gate.setDim(1);
    gate.openAt(-100);
    this.slitPerAspect = 0;
    (gate as { setWidth?: (w: number) => void }).setWidth?.(0.8);
    jw.group.visible = true;
    jw.rig.apply(POSES.idle, null, 0);
    jw.eyes.setGlow(0.12);
    aura?.setIntensity(0.38);
    this.audio.bed?.('gate_hum')?.level(0.25, 1);
    this.audio.music?.to('silhouette', 0.3);
    this.audio.bed?.('aura_bed')?.level(0.6, 1.2);
    this.handheld = 0.6;

    // breathing idle, posed on 3s (8 fps)
    const breathe = (lt: number) => {
      const s = stepped(lt, 8);
      jw.rig.apply(POSES.idle, POSES.idle, 0, { chest: [0.012 * Math.sin(s * 1.6), 0, 0], head: [0.008 * Math.sin(s * 1.6 + 0.6), 0.01 * Math.sin(s * 0.5), 0] });
    };
    this.track(14, (lt) => breathe(lt));

    // 4a: low wide, he condenses out of the smoke
    // low wide, camera and aim offset together so the gate stays directly behind him (backlit silhouette)
    this.cut({ pos: lin(V(0, 0.44, 4.7), V(0, 0.47, 4.3), 3.2), look: () => V(this.stage.width > this.stage.height ? 0.42 : 0.12, 1.08, 0), fov: () => 30 });
    jw.setDissolve(0.9);
    this.track(1.6, (lt) => jw.setDissolve(lerp(0.9, 0, ease.outCubic(lt / 1.6))));
    this.audio.play('whoosh', { gain: 0.5 });
    await this.hold(3.2);
    // 4b: mid shot, 3/4, slow truck
    this.cut({ pos: lin(V(-0.88, 1.52, 1.78), V(-0.7, 1.53, 1.82), 3.2), look: lin(V(0.02, 1.5, 0), V(0.01, 1.51, 0), 3.2), fov: () => 26 });
    await this.hold(3.2);
    // 4c: frontal push-in to the eyes
    const eyeC = eyeCentre(jw);
    const pushFrom = eyeC.clone().add(V(0.05, -0.01, 1.7));
    // the push ends further back on a narrow screen, so both eyes stay in
    const pushTo = () => eyeC.clone().add(V(0.0, -0.006, lerp(0.72, 0.6, smoothstep(0.5, 1.0, this.stage.width / this.stage.height))));
    this.cut({ pos: (lt) => pushFrom.clone().lerp(pushTo(), easePush(clamp(lt / 5.13))), look: still(eyeC.clone().add(V(0, -0.004, 0))), fov: (lt) => lerp(24, 19, easePush(clamp(lt / 5.13))) });
    await this.hold(5.13);
    // stillness, then ignition: halo flicker 100 ms, core 200 ms, bloom overshoot +15.6 % settle 267 ms
    this.handheld = 0.15;
    await this.hold(0.467);
    this.audio.play('eye_swell');
    this.track(0.8, (lt) => this.lb.set(0.115 * easeLetterbox(clamp(lt / 0.8))));
    this.track(1.2, (lt) => {
      let g: number;
      if (lt < 0.1) g = params.reduced ? 0.12 : 0.12 + 0.35 * Math.sin((lt / 0.1) * Math.PI);
      else if (lt < 0.3) g = lerp(0.12, 1.18, easeIgnite((lt - 0.1) / 0.2));
      else g = lerp(1.18, 1.0, ease.outCubic(clamp((lt - 0.3) / 0.33)));
      jw.eyes.setGlow(g);
      const bloomK = lt < 0.37 ? smoothstep(0.1, 0.37, lt) * 0.156 : 0.156 * (1 - clamp((lt - 0.37) / 0.267));
      this.stage.bloom.intensity = this.baseBloom * (1 + bloomK);
    });
    await this.hold(1.8);
    this.audio.music?.to('awaken', 1.2);
    // letterbox retracts x0.9 per frame starting 4 frames before the cut
    this.track(0.5, (lt) => this.lb.set(0.115 * Math.pow(0.9, lt * 60)));
    await this.hold(0.067);
    this.lb.set(0.115 * Math.pow(0.9, 4));
  }

  /* ---------------------------------------------------------------- beat 5: AWAKEN */
  private async beatAwaken() {
    if (this.skipped) return;
    const { jw, awaken, aura, cam } = this.w;
    this.lb.set(0);
    jw.group.visible = true;
    jw.setDissolve(0);
    jw.eyes.setGlow(1);
    aura?.setIntensity(0.45);
    characterLighting();
    this.openGateForCharacters();
    if (params.shot === 'awaken') this.audio.music?.to('awaken', 0.3);
    this.audio.bed?.('aura_bed')?.level(0.35, 0.8);
    if (!awaken) {
      await this.hold(3);
      return;
    }
    awaken.group.visible = true;
    const { awakenSequence, HIT } = await this.stage.loading(import('./awaken-shots'));
    this.stopIfSkipped();
    const seq = awakenSequence(this.stage, awaken as never, jw, cam);
    this.shot = null;
    this.track(16, (lt) => {
      seq.frameAt(lt);
      aura?.setIntensity(lerp(0.45, 0.9, smoothstep(HIT + 0.6, HIT + 3, lt)) * (1 - 0.5 * smoothstep(HIT + 8, HIT + 10, lt)));
    });
    // sound, scheduled against the same beat clock (the engine places each sound two frames on, so visuals lead by two)
    this.cue(1.85, () => this.audio.play('whoosh', { gain: 0.6 }));
    this.cue(3.48, () => {
      this.audio.play('awaken_voice');
      awakenWord('AWAKEN', 0.42, this.skip);
    });
    this.cue(HIT - 0.75, () => {
      if (this.audio.hush) this.audio.hush();
      else this.audio.duck?.(-22, 0.06);
      this.audio.bed?.('aura_bed')?.level(0.05, 0.1);
    });
    this.cue(HIT, () => {
      if (!this.audio.hush) this.audio.duck?.(0, 0.03);
      this.audio.play('awaken_hit');
    });
    this.cue(HIT + 0.09, () => this.audio.play('riser'));
    this.cue(HIT + 0.77, () => this.audio.bed?.('vortex_roar')?.level(0.8, 0.2));
    this.cue(HIT + 4.15, () => this.audio.play('soldier_ignite'));
    let stand: { stop(at?: number, ramp?: number): void } | undefined;
    this.cue(HIT + 6.0, () => (stand = this.audio.play('stand_swell') as typeof stand));
    await this.hold(HIT + 9.84);
    // hard audio cut, the army window over the kneeling army
    this.audio.bed?.('vortex_roar')?.level(0.25, 0.04);
    stand?.stop(undefined, 0.04);
    this.audio.music?.to('reward', 3.5, { fadeOut: 0.04 });
    await this.window({ kind: 'notification', title: WINDOWS.army.title, html: WINDOWS.army.html }, 4.2);
    this.neutralGrade();
  }

  /** Beats after the gate beat assume the gate is open behind him (matters when a beat is entered directly). */
  private openGateForCharacters() {
    const g = this.w.gate as typeof this.w.gate & { setWidth?: (w: number) => void; state?: { open?: number } };
    if (params.shot && params.shot !== 'gate' && params.shot !== 'windows') {
      g.setDim(1);
      g.openAt(-100);
      g.setWidth?.(0.8);
    }
  }

  /**
   * The chest shot's framing for this screen: how much further back the dolly stands (k, a scale on its distance) and
   * how far the camera moves aside and down, so the chest, as large as the dolly brings it, stays inside the frame and
   * clear of the hold prompt where the prompt stands on this screen, with his eyes still in the picture above it. Under
   * the chest on a tall screen, the prompt keeps its room by the camera standing lower and, as far as his eyes need,
   * further back; beside it on a wide one, by the camera trucking right, which moves the chest left. A screen the shot
   * already fits keeps it as it is. Worked out again when the screen changes size.
   */
  private chestFrame() {
    const { width: W, height: H } = this.stage;
    const f = this.chestFit;
    if (f.w === W && f.h === H) return f;
    f.w = W;
    f.h = H;
    f.k = Math.max(1, 0.8 / (W / H));
    f.shift.set(0, 0, 0);
    const { chest, jw, modules } = this.w;
    const prompt: DOMRect | undefined = modules.chest?.promptRect?.();
    if (!chest?.bounds || !prompt) return f;
    const S = CHEST_SHOT;
    const room = { l: W * S.edge, r: W * (1 - S.edge), t: H * S.edge, b: H * (1 - S.edge) };
    if (prompt.left > W / 2) room.r = Math.min(room.r, prompt.left - S.promptGap);
    else room.b = Math.min(room.b, prompt.top - S.promptGap);
    chest.group.updateMatrixWorld(true);
    const { min, max } = chest.bounds;
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      V(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(chest.group.matrixWorld),
    );
    const centre = chest.bounds.getCenter(new THREE.Vector3()).applyMatrix4(chest.group.matrixWorld);
    const eyes = eyeCentre(jw);
    const cam = new THREE.PerspectiveCamera(S.fov, W / H);
    const look = new THREE.Vector3();
    const p = new THREE.Vector3(), dir = new THREE.Vector3();
    // where the chest and his eyes land on screen, in px, as the dolly ends
    const frame = (k: number) => {
      chestPose(k, 1, f.shift, cam.position, look);
      cam.lookAt(look);
      cam.updateMatrixWorld();
      const q = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity, eyes: ((1 - p.copy(eyes).project(cam).y) / 2) * H };
      for (const c of corners) {
        p.copy(c).project(cam);
        const x = ((p.x + 1) / 2) * W, y = ((1 - p.y) / 2) * H;
        q.l = Math.min(q.l, x);
        q.r = Math.max(q.r, x);
        q.t = Math.min(q.t, y);
        q.b = Math.max(q.b, y);
      }
      return q;
    };
    // world units per px at the chest's depth: the camera moving that far moves the chest one px the other way
    const perPx = () => (2 * p.copy(centre).sub(cam.position).dot(cam.getWorldDirection(dir)) * Math.tan(THREE.MathUtils.degToRad(S.fov / 2))) / H;
    // the camera moves down the least that lifts the chest off the room's floor (onto it, on a tall screen, the prompt)
    const lift = (k: number) => {
      f.shift.y = 0;
      let q = frame(k);
      for (let i = 0; i < 3 && q.b > room.b + 0.5; i++) {
        f.shift.y -= (q.b - room.b) * perPx();
        q = frame(k);
      }
      return q;
    };
    // his eyes rise no higher than the shot has them, or than `headroom` of the frame from its top if they sit lower
    const eyesTop = Math.min(frame(f.k).eyes, H * S.headroom);
    // further back, the chest is smaller and nearer the middle: the camera stands as near as it can with the chest, once
    // lifted, inside the room's height and no wider than it, and his eyes still in the picture
    const fits = (k: number) => {
      const q = lift(k);
      return q.t >= room.t && q.b <= room.b + 0.5 && q.r - q.l <= room.r - room.l && q.eyes >= eyesTop;
    };
    if (!fits(f.k)) {
      let near = f.k, far = 2 * f.k;
      for (let i = 0; i < 5 && !fits(far); i++) [near, far] = [far, 2 * far];
      for (let i = 0; i < 20; i++) {
        const mid = (near + far) / 2;
        if (fits(mid)) far = mid;
        else near = mid;
      }
      f.k = far;
    }
    lift(f.k);
    // then sideways, the least that puts it inside the room's width
    for (let i = 0; i < 3; i++) {
      const q = frame(f.k);
      const dx = q.r > room.r ? room.r - q.r : q.l < room.l ? room.l - q.l : 0;
      if (Math.abs(dx) < 0.5) break;
      f.shift.x -= dx * perPx();
    }
    return f;
  }

  /* ---------------------------------------------------------------- beat 6: chest */
  private async beatChest() {
    if (this.skipped) return;
    const { chest, awaken, jw } = this.w;
    this.openGateForCharacters();
    jw.group.visible = true;
    jw.rig.apply(POSES.awakenHigh, POSES.idle, 1);
    jw.eyes.setGlow(1);
    if (awaken) {
      awaken.group.visible = true;
      awaken.setPool(1);
      awaken.setVortex(1);
      awaken.setSmoke(1);
      awaken.setRise(1);
      awaken.setIgnite(1);
      awaken.setKneel(1);
    }
    this.audio.bed?.('vortex_roar')?.stop(1.5);
    this.handheld = 0.5;
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    const at = (lt: number) => {
      const { k, shift } = this.chestFrame();
      chestPose(k, clamp(lt / CHEST_SHOT.sec), shift, pos, look);
    };
    this.cut({ pos: (lt) => (at(lt), pos.clone()), look: (lt) => (at(lt), look.clone()), fov: () => CHEST_SHOT.fov });
    if (!chest) {
      await this.window({ kind: 'reward', title: WINDOWS.unlocked.title, html: WINDOWS.unlocked.html }, 2);
      return;
    }
    chest.group.visible = true;
    this.audio.play('chest_rise');
    this.track(1.9, (lt) => chest.setReveal(lt / 1.9));
    await this.hold(2.0);
    // hold to charge (their pace)
    const holdMod = this.w.modules.chest;
    const loop = this.audio.chargeLoop?.();
    if (holdMod?.holdToCharge && !params.capture) {
      await holdMod.holdToCharge({
        durationSec: 1.5,
        until: this.skip,
        onProgress: (c: number) => {
          chest.setCharge(c);
          loop?.set(c);
        },
        onRelease: () => loop?.release(),
      });
    } else {
      await this.hold(0.8);
      await new Promise<void>((resolve) =>
        this.track(1.5, (lt) => {
          chest.setCharge(lt / 1.5);
          loop?.set(lt / 1.5);
          if (lt >= 1.5) resolve();
        }),
      );
    }
    this.stopIfSkipped();
    loop?.stop();
    // 200 ms hush, then the burst (visual leads the boom by 1-2 frames)
    this.audio.duck?.(-18, 0.05);
    await this.hold(0.2);
    this.audio.duck?.(0, 0.02);
    this.audio.play('chest_burst');
    this.track(2.4, (lt) => chest.setOpen(clamp(lt / 1.6)));
    await this.hold(0.8);
    await this.window({ kind: 'reward', title: WINDOWS.unlocked.title, html: WINDOWS.unlocked.html }, 1.8);
  }

  /* ---------------------------------------------------------------- beats 7-8: rewards, letter, end card */
  private async beatRewards(left?: AbortSignal): Promise<'replay' | 'enter'> {
    this.stage.grade.u('flashAmount').value = 0;
    this.audio.music?.to('reward', 1.5);
    await rewardCards(REWARDS, { left });
    await letterView(left);
    this.audio.music?.to('end', 2);
    const g = this.stage.grade;
    this.track(1.2, (lt) => (g.u('fade').value = 0.82 * ease.inOutSine(clamp(lt / 1.2))));
    const f = fader();
    f.set(0);
    const v = await endCard(left);
    void INTRO;
    return v;
  }
}

export async function playCutscene(stage: Stage, audio?: AudioLike, left?: AbortSignal) {
  const d = new Director(stage, audio);
  await d.init();
  return d.play(left);
}

export { light };
