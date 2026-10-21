import * as THREE from 'three';
import type { Stage } from '../core/stage';
import { params } from '../core/params';
import { clamp, cubicBezier, ease, fbm1, lerp, smoothstep } from '../core/math';
import { animate, wait, uiNow } from '../ui/anim';
import { SystemWindow, levelBody, systemLayer } from '../ui/system-window';
import { GATE, LEVEL } from '../motion/tokens';
import { Letterbox, ariseWord, rewardCards, letterView, endCard, fader, skipButton } from '../ui/cutscene-ui';
import { INTRO, WINDOWS, REWARDS } from '../content/intro';
import { POSES } from '../scene/character/jinwoo';
import { light } from '../scene/toon';
import { buildWorld, characterLighting, type World } from './world';

/** Minimal audio surface the director needs; the audio module implements it. */
export interface AudioLike {
  play(cue: string, opts?: Record<string, number>): unknown;
  bed?(name: string): { level(v: number, ramp?: number): void; stop(ramp?: number): void } | undefined;
  chargeLoop?(): { set(c: number): void; release(): void; stop(): void };
  music?: { to(section: string, fade?: number, opts?: { at?: number; fadeOut?: number; hitAt?: number; standAt?: number }): void };
  hush?(from?: number, to?: number): void;
  duck?(db: number, ramp: number): void;
}
const NOAUDIO: AudioLike = { play: () => undefined };

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

export class Director {
  w!: World;
  private shot: Shot | null = null;
  private shotT0 = 0;
  private tracks = new Set<{ t0: number; fn: Track; until: number }>();
  private lb!: Letterbox;
  private shakeT0 = -1;
  private handheld = 0.6;
  skipped = false;
  private removeSkip: (() => void) | null = null;
  private baseBloom = 1.15;

  constructor(readonly stage: Stage, readonly audio: AudioLike = NOAUDIO) {}

  async init() {
    this.w = await buildWorld(this.stage);
    this.lb = new Letterbox();
    characterLighting();
    this.baseBloom = this.stage.bloom.intensity;
    const cam = this.w.cam;
    this.stage.onUpdate((t, dt) => {
      const now = uiNow();
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
    });
  }

  private applyShake(cam: THREE.PerspectiveCamera, now: number) {
    if (this.shakeT0 < 0 || params.reduced) return;
    const lt = now - this.shakeT0;
    if (lt < 0 || lt > 0.3) return;
    if (this.w.arise?.shake) {
      this.w.arise.shake(cam, now, this.shakeT0);
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

  private async hold(sec: number) {
    if (this.skipped) return;
    await wait(sec);
  }

  /** System window: opens, waits for her tap (auto-advance in capture mode or after a long idle). */
  private async window(spec: ConstructorParameters<typeof SystemWindow>[1], readSec: number) {
    if (this.skipped) return;
    const win = new SystemWindow(systemLayer(), { tapToContinue: true, ...spec });
    await win.open();
    if (params.capture) await wait(readSec);
    else await win.waitForInput(Math.max(readSec + 8, 14));
    await win.close();
  }

  /* ======================================================================================= */

  async play(opts: { skippable?: boolean } = {}): Promise<'replay' | 'enter'> {
    if (opts.skippable) this.removeSkip = skipButton(() => (this.skipped = true));
    const start = params.shot || '';
    const order = ['gate', 'windows', 'silhouette', 'arise', 'chest', 'rewards'];
    const from = Math.max(0, order.indexOf(start));
    if (from <= 0) await this.beatGate();
    if (from <= 1) await this.beatWindows();
    if (from <= 2) await this.beatSilhouette();
    if (from <= 3) await this.beatArise();
    if (from <= 4) await this.beatChest();
    this.removeSkip?.();
    return this.beatRewards();
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
    (gate as { fitWidth?: (c: THREE.PerspectiveCamera) => void }).fitWidth?.(this.w.cam);
    const t0 = uiNow();
    gate.setDim(1);
    gate.openAt(t0 + GATE.crackSec);
    this.audio.music?.to('intro', GATE.musicFadeSec);
    wait(GATE.airSec).then(() => this.audio.play('gate_air'));
    wait(GATE.crackSfxSec).then(() => this.audio.play('gate_crack'));
    wait(GATE.swellSec).then(() => this.audio.play('gate_swell'));
    wait(GATE.humSec).then(() => this.audio.bed?.('gate_hum')?.level(GATE.humLevel, GATE.humFadeSec));
    await this.hold(GATE.holdSec);
    this.track(GATE.dimSec, (lt) => gate.setDim(lerp(1, GATE.dimTo, ease.outCubic(lt / GATE.dimSec))));
    await this.hold(GATE.dimSec);
  }

  /* ---------------------------------------------------------------- beats 2-3: System windows */
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
    wait(LEVEL.ringSec).then(() => this.audio.play('level_ring'));
    await levelWin;
    if (this.skipped) return;
    await this.hold(0.1);
    await this.dailyQuest();
  }

  /** The manhwa's QUEST INFO window as a joke: boxes tick, then the warning lands on "nothing". */
  private async dailyQuest() {
    const Q = WINDOWS.quest;
    const box = (done: boolean) =>
      `<i class="dq-box" role="img" aria-label="${done ? 'Complete' : 'Incomplete'}"><svg viewBox="0 0 14 14" aria-hidden="true"><path class="b" d="M8 3.5H3A1.5 1.5 0 0 0 1.5 5v6A1.5 1.5 0 0 0 3 12.5h6a1.5 1.5 0 0 0 1.5-1.5V7.5"/>${done ? '<path class="c" pathLength="1" d="M3.9 7.7l2.3 2.4 6.6-8.4"/>' : ''}</svg></i>`;
    const rows = Q.rows.map(([k, v, done]) => `<div class="sw-row dq-row"><span class="k">${k}</span><span class="v">[${v}]${box(done)}</span></div>`).join('');
    const html =
      `<p class="center dq-arrived">${Q.arrived}</p><div class="dq-goal">${Q.goal}</div><div class="sw-rows dq-rows">${rows}</div>` +
      `<p class="center dq-warn"><span class="dq-w">WARNING:</span> ${Q.warning}<span class="dq-dots">...</span> <b class="dq-punch">${Q.punch}</b></p>` +
      `<p class="center sys dq-side"><span>${Q.after}</span></p>`;
    const questWin = this.window({ kind: 'quest', icon: 'alert', title: Q.title, html, width: 'min(92vw, 680px)' }, 3.4);
    const root = systemLayer().querySelector<HTMLElement>('.sw[data-kind="quest"]:last-of-type');
    if (root && !params.reduced) {
      const live = () => root.isConnected;
      root.querySelectorAll<SVGPathElement>('.dq-box path.c').forEach((tick, i) => {
        const at = 0.95 + i * 0.26;
        animate(tick, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 190, delay: at * 1000, easing: 'cubic-bezier(.4,0,.2,1)' });
        wait(at).then(() => live() && this.audio.play('level_tick', { index: i, detune: 200 + i * 200 }));
      });
      const reveal = (sel: string, at: number, dur: number) => {
        const n = root.querySelector<HTMLElement>(sel);
        if (n) animate(n, [{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: dur, delay: at * 1000, easing: 'cubic-bezier(.16,1,.3,1)' });
      };
      reveal('.dq-dots', 1.75, 420);
      reveal('.dq-punch', 2.3, 260);
      reveal('.dq-side span', 2.75, 500);
      wait(2.3).then(() => live() && this.audio.play('soft_chime', { gain: 0.5 }));
    }
    await questWin;
  }

  /* ---------------------------------------------------------------- beat 4: silhouette, eyes */
  private async beatSilhouette() {
    if (this.skipped) return;
    const { jw, gate, aura } = this.w;
    characterLighting();
    gate.setDim(1);
    gate.openAt(-100);
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
    const ox = this.stage.width > this.stage.height ? 0.42 : 0.12;
    this.cut({ pos: lin(V(0, 0.44, 4.7), V(0, 0.47, 4.3), 3.2), look: still(V(ox, 1.08, 0)), fov: () => 30 });
    jw.setDissolve(0.9);
    this.track(1.6, (lt) => jw.setDissolve(lerp(0.9, 0, ease.outCubic(lt / 1.6))));
    this.audio.play('whoosh', { gain: 0.5 });
    await this.hold(3.2);
    // 4b: mid shot, 3/4, slow truck
    this.cut({ pos: lin(V(-0.88, 1.52, 1.78), V(-0.7, 1.53, 1.82), 3.2), look: lin(V(0.02, 1.5, 0), V(0.01, 1.51, 0), 3.2), fov: () => 26 });
    await this.hold(3.2);
    // 4c: frontal push-in to the eyes
    jw.group.updateMatrixWorld(true);
    const eyeC = new THREE.Vector3();
    jw.eyes.group.children.forEach((c) => eyeC.add(c.getWorldPosition(new THREE.Vector3())));
    eyeC.multiplyScalar(1 / Math.max(1, jw.eyes.group.children.length));
    const aspect = this.stage.width / this.stage.height;
    const pushTo = eyeC.clone().add(V(0.0, -0.006, lerp(0.72, 0.6, smoothstep(0.5, 1.0, aspect))));
    this.cut({ pos: lin(eyeC.clone().add(V(0.05, -0.01, 1.7)), pushTo, 5.13, easePush), look: still(eyeC.clone().add(V(0, -0.004, 0))), fov: (lt) => lerp(24, 19, easePush(clamp(lt / 5.13))) });
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
    this.audio.music?.to('arise', 1.2);
    // letterbox retracts x0.9 per frame starting 4 frames before the cut
    this.track(0.5, (lt) => this.lb.set(0.115 * Math.pow(0.9, lt * 60)));
    await this.hold(0.067);
    this.lb.set(0.115 * Math.pow(0.9, 4));
  }

  /* ---------------------------------------------------------------- beat 5: ARISE */
  private async beatArise() {
    if (this.skipped) return;
    const { jw, arise, aura, cam } = this.w;
    this.lb.set(0);
    jw.group.visible = true;
    jw.setDissolve(0);
    jw.eyes.setGlow(1);
    aura?.setIntensity(0.45);
    characterLighting();
    this.openGateForCharacters();
    if (params.shot === 'arise') this.audio.music?.to('arise', 0.3);
    this.audio.bed?.('aura_bed')?.level(0.35, 0.8);
    if (!arise) {
      await this.hold(3);
      return;
    }
    arise.group.visible = true;
    const { ariseSequence, HIT } = await import('./arise-shots');
    const seq = ariseSequence(this.stage, arise as never, jw, cam);
    this.shot = null;
    this.track(16, (lt) => {
      seq.frameAt(lt);
      aura?.setIntensity(lerp(0.45, 0.9, smoothstep(HIT + 0.6, HIT + 3, lt)) * (1 - 0.5 * smoothstep(HIT + 8, HIT + 10, lt)));
    });
    // sound, scheduled against the same beat clock (visuals lead by one frame)
    wait(1.85).then(() => this.audio.play('whoosh', { gain: 0.6 }));
    wait(3.48).then(() => {
      this.audio.play('arise_voice');
      ariseWord('ARISE', 0.42);
    });
    wait(HIT - 0.75).then(() => {
      if (this.audio.hush) this.audio.hush();
      else this.audio.duck?.(-22, 0.06);
      this.audio.bed?.('aura_bed')?.level(0.05, 0.1);
    });
    wait(HIT + 1 / 30).then(() => {
      if (!this.audio.hush) this.audio.duck?.(0, 0.03);
      this.audio.play('arise_hit');
    });
    wait(HIT + 0.09).then(() => this.audio.play('riser'));
    wait(HIT + 0.77).then(() => this.audio.bed?.('vortex_roar')?.level(0.8, 0.2));
    wait(HIT + 4.15).then(() => this.audio.play('soldier_ignite'));
    let stand: { stop(at?: number, ramp?: number): void } | undefined;
    wait(HIT + 6.0).then(() => (stand = this.audio.play('stand_swell') as typeof stand));
    await this.hold(HIT + 9.84);
    // hard audio cut, the army window over the kneeling army
    this.audio.bed?.('vortex_roar')?.level(0.25, 0.04);
    stand?.stop(undefined, 0.04);
    this.audio.music?.to('reward', 3.5, { fadeOut: 0.04 });
    await this.window({ kind: 'notification', title: WINDOWS.army.title, html: WINDOWS.army.html }, 4.2);
    this.stage.grade.u('flashAmount').value = 0;
    this.stage.grade.u('saturation').value = 1;
    this.stage.grade.u('fade').value = 0;
    this.stage.grade.u('gammaV').value = 1;
    (this.stage.grade.u('flashColor').value as THREE.Color).set(1, 1, 1);
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

  /* ---------------------------------------------------------------- beat 6: chest */
  private async beatChest() {
    if (this.skipped) return;
    const { chest, arise, jw } = this.w;
    this.openGateForCharacters();
    jw.group.visible = true;
    jw.rig.apply(POSES.ariseHigh, POSES.idle, 1);
    jw.eyes.setGlow(1);
    if (arise) {
      arise.group.visible = true;
      arise.setPool(1);
      arise.setVortex(1);
      arise.setSmoke(1);
      arise.setRise(1);
      arise.setIgnite(1);
      arise.setKneel(1);
    }
    this.audio.bed?.('vortex_roar')?.stop(1.5);
    this.handheld = 0.5;
    const k = Math.max(1, 0.8 / (this.stage.width / this.stage.height));
    this.cut({ pos: lin(V(0, 1.02, 1.45 + 3.25 * k), V(0, 0.98, 1.45 + 2.85 * k), 12), look: still(V(0, 0.62, 1.2)), fov: () => 32 });
    if (!chest) {
      await this.window({ kind: 'reward', title: WINDOWS.unlocked.title, html: WINDOWS.unlocked.html }, 2);
      return;
    }
    chest.group.visible = true;
    this.audio.play('chest_rise');
    this.track(1.9, (lt) => chest.setReveal(lt / 1.9));
    await this.hold(2.0);
    // hold to charge (her pace)
    const holdMod = this.w.modules.chest;
    const loop = this.audio.chargeLoop?.();
    if (holdMod?.holdToCharge && !params.capture) {
      await holdMod.holdToCharge({
        durationSec: 1.5,
        onProgress: (c: number) => {
          chest.setCharge(c);
          loop?.set(c);
        },
        onRelease: () => loop?.release(),
      });
    } else {
      await wait(0.8);
      await new Promise<void>((resolve) =>
        this.track(1.5, (lt) => {
          chest.setCharge(lt / 1.5);
          loop?.set(lt / 1.5);
          if (lt >= 1.5) resolve();
        }),
      );
    }
    loop?.stop();
    // 200 ms hush, then the burst (visual leads the boom by 1-2 frames)
    this.audio.duck?.(-18, 0.05);
    await wait(0.2);
    this.audio.duck?.(0, 0.02);
    wait(1 / 30).then(() => this.audio.play('chest_burst'));
    this.track(2.4, (lt) => chest.setOpen(clamp(lt / 1.6)));
    await this.hold(0.8);
    await this.window({ kind: 'reward', title: WINDOWS.unlocked.title, html: WINDOWS.unlocked.html }, 1.8);
  }

  /* ---------------------------------------------------------------- beats 7-8: rewards, letter, end card */
  private async beatRewards(): Promise<'replay' | 'enter'> {
    this.skipped = false;
    this.stage.grade.u('flashAmount').value = 0;
    this.audio.music?.to('reward', 1.5);
    await rewardCards(REWARDS);
    await letterView();
    this.audio.music?.to('end', 2);
    const g = this.stage.grade;
    this.track(1.2, (lt) => (g.u('fade').value = 0.82 * ease.inOutSine(clamp(lt / 1.2))));
    const f = fader();
    f.set(0);
    const v = await endCard();
    void INTRO;
    return v;
  }
}

export async function playCutscene(stage: Stage, audio?: AudioLike, opts: { skippable?: boolean } = {}) {
  const d = new Director(stage, audio);
  await d.init();
  return d.play(opts);
}

export { light };
