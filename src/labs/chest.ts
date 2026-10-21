import * as THREE from 'three';
import type { Stage } from '../core/stage';
import { params } from '../core/params';
import { clamp } from '../core/math';
import { buildVoid } from '../scene/environment';
import { light, outlineShared } from '../scene/toon';
import { buildChest, CHEST_TIMING } from '../scene/chest/chest';
import { holdToCharge, showRewardUnlocked } from '../scene/chest/hold';

/**
 * ?lab=chest            reveal -> idle -> hold (real input) -> burst -> "[SYSTEM] Reward unlocked."
 * &autohold=1           scripted hold for capture (press at 3.3 s, full at 4.8 s)
 * &autohold=2           early release + drain, then a full hold
 * &state=idle|c25|c50|c90|open&op=0.2   static look-dev state, no UI
 * &view=front|34|top|low|close          camera preset (default: framed for the beat)
 */
export function lab(stage: Stage) {
  const q = new URLSearchParams(location.search);
  const env = buildVoid();
  env.skyMat.uniforms.uGlow.value = 0.25;
  env.skyMat.uniforms.uGlowColor.value.set(0x1a1430);
  env.groundMat.uniforms.uSheenStrength.value = 0.0;
  stage.scene.add(env.group);

  const chest = buildChest({ stage });
  stage.scene.add(chest.group);

  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  stage.setCamera(cam);
  const view = params.view;

  const T = { reveal: 0.4, holdUi: 2.6 };
  const auto = q.get('autohold');
  const script: [number, number][] =
    auto === '2' ? [[3.3, 4.0], [4.5, Infinity]] : auto ? [[3.3, Infinity]] : [];
  const fullAt = auto === '2' ? 4.5 + CHEST_TIMING.holdSec : auto ? 3.3 + CHEST_TIMING.holdSec : Infinity;
  const state = q.get('state');

  let charge = 0;
  let holdStarted = false;
  let burstAt = Infinity;
  let windowShown = false;
  let windowResult: string | null = null;

  const startHold = () => {
    holdStarted = true;
    holdToCharge({
      durationSec: CHEST_TIMING.holdSec,
      onProgress: (c) => {
        charge = c;
        chest.setCharge(c);
        // set synchronously (not in the promise microtask) so batched stage stepping stays frame-exact
        if (c >= 1 && burstAt === Infinity) burstAt = (auto ? fullAt : stage.time) + CHEST_TIMING.hush;
      },
      onFrame: (fn) => stage.onUpdate(() => fn()),
      script: auto ? script : undefined,
    }).then(() => {
      if (burstAt === Infinity) burstAt = (auto ? fullAt : stage.time) + CHEST_TIMING.hush;
    });
  };

  const frameCam = (t: number) => {
    const aspect = stage.width / stage.height;
    const portrait = aspect < 1;
    const vf = THREE.MathUtils.degToRad(cam.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const dW = (1.2 / (portrait ? 0.72 : 0.5)) / 2 / Math.tan(hf / 2);
    const dH = (0.95 / (portrait ? 0.3 : 0.33)) / 2 / Math.tan(vf / 2);
    let d = Math.max(dW, dH);
    let elev = THREE.MathUtils.degToRad(13);
    let az = THREE.MathUtils.degToRad(-8);
    let ty = 0.45;
    if (view === 'front') az = 0;
    if (view === '34') az = THREE.MathUtils.degToRad(-35);
    if (view === 'top') elev = THREE.MathUtils.degToRad(40);
    if (view === 'low') elev = THREE.MathUtils.degToRad(2);
    if (view === 'close') d *= 0.55;
    // holds drift: slow dolly-in and a slight orbit
    const drift = view ? 0 : t;
    d *= 1 - 0.006 * Math.min(drift, 14);
    az += 0.0035 * Math.min(drift, 14);
    const Hv = 2 * d * Math.tan(vf / 2);
    if (!view) {
      ty += (portrait ? 0.0 : -0.06) * Hv;
      // after the burst the camera tilts up with the light column, so the window sits over the beam
      const k = burstAt === Infinity ? 0 : clamp((t - burstAt - 0.15) / 1.3);
      ty += (portrait ? 0.2 : 0.21) * Hv * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    }
    const target = new THREE.Vector3(0, ty, 0);
    cam.position.set(Math.sin(az) * Math.cos(elev) * d, ty + Math.sin(elev) * d, Math.cos(az) * Math.cos(elev) * d);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  };

  stage.onUpdate((t) => {
    light.uTime.value = t;
    outlineShared.uResolution.value.set(stage.width * stage.dpr, stage.height * stage.dpr);
    if (state) {
      chest.setReveal(1);
      const cs: Record<string, number> = { idle: 0, c25: 0.25, c50: 0.5, c90: 0.9, open: 1 };
      chest.setCharge(cs[state] ?? 0);
      chest.setOpen(state === 'open' ? Number(q.get('op') ?? 0.5) : 0);
    } else {
      chest.setReveal((t - T.reveal) / CHEST_TIMING.reveal);
      if (!holdStarted && t >= T.holdUi && t < fullAt) startHold();
      chest.setCharge(t >= burstAt ? 0 : charge);
      chest.setOpen(t >= burstAt ? clamp((t - burstAt) / CHEST_TIMING.open) : 0);
      if (!windowShown && t >= burstAt + CHEST_TIMING.windowDelay) {
        windowShown = true;
        // like the director: wait for her tap, then close (autohold captures leave it open)
        showRewardUnlocked().then((w) => {
          if (auto) return;
          w.waitForInput().then((v) => {
            windowResult = v;
            w.close();
          });
        });
      }
    }
    frameCam(t);
    chest.update(t);
  });

  (window as any).__seek = (t: number) => {
    stage.time = t;
    if (auto && t >= fullAt) {
      holdStarted = true;
      charge = 1;
      if (burstAt === Infinity) burstAt = fullAt + CHEST_TIMING.hush;
    }
    stage.step(0);
  };
  if (params.t !== undefined) (window as any).__seek(params.t);
  (window as any).__lab = { stage, chest, cam, get charge() { return charge; }, get burstAt() { return burstAt; }, get windowShown() { return windowShown; }, get windowResult() { return windowResult; } };
  if (params.debug) setInterval(() => console.log(JSON.stringify({ chest: chest.stats(), info: stage.renderer.info.render })), 2000);
}
