import * as THREE from 'three';
import type { Stage } from '../core/stage';
import { params } from '../core/params';
import { clamp, ease, noise1 } from '../core/math';
import { buildGate } from '../scene/gate/gate';
import { buildDungeonEnv } from '../scene/gate/env';
import { createAura } from '../scene/fx/aura';
import { createEmbers } from '../scene/fx/embers';
import { buildJinwoo, POSES } from '../scene/character/jinwoo';
import { light, outlineShared } from '../scene/toon';

/**
 * ?lab=gate            beat 1 from t=0: 1.7 s black, plate fade, crack at 1.9 s, open by 2.33 s, dolly-in hold to 7.2 s
 * ?lab=gate&aura=1     Jin-woo in front of the open gate with the shadow aura (shot=wide|mid|low|back)
 * window.__seek(t) jumps the stage clock (deterministic: everything is a pure function of stage time).
 */
export function lab(stage: Stage) {
  const q = new URLSearchParams(location.search);
  const auraMode = q.get('aura') === '1';
  const shot = q.get('shot') ?? 'wide';
  const crack = Number(q.get('crack') ?? 1.9);
  if (q.get('bloom') === '0') stage.bloom.intensity = 0;
  if (q.get('grade') === 'pinned') {
    // proposed shared grade (see report): the void renders near #07080F instead of #17192E
    stage.grade.u('lift').value.setRGB(0.0012, 0.0015, 0.0036);
    stage.grade.u('shadowTint').value.setRGB(0.0018, 0.0018, 0.006);
  }

  const cam = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
  stage.setCamera(cam);

  const gate = buildGate();
  stage.scene.add(gate.group);
  const env = buildDungeonEnv({ gate });
  stage.scene.add(env.group);

  const look = new THREE.Vector3();
  let jw: ReturnType<typeof buildJinwoo> | null = null;
  let aura: ReturnType<typeof createAura> | null = null;
  let embers: ReturnType<typeof createEmbers> | null = null;

  if (auraMode) {
    gate.group.position.set(0, 0, -3.2);
    gate.openAt(-10);
    gate.setWidth(0.8);
    jw = buildJinwoo();
    stage.scene.add(jw.group);
    jw.rig.apply(POSES[q.get('pose') ?? 'idle'] ?? POSES.idle, null, 0);
    jw.eyes.setGlow(1);
    aura = createAura({ target: jw.group, height: 1.9, radius: 0.45 });
    stage.scene.add(aura.group);
    embers = createEmbers({
      origin: new THREE.Vector3(0, 0.25, -1.6),
      box: new THREE.Vector3(2.5, 0.05, 1.5),
      velocity: new THREE.Vector3(0, 0.35, 0.5),
      spread: new THREE.Vector3(0.2, 0.2, 0.3),
      color: 0x4fb8ff,
      hot: 0xe6f1ff,
      gain: 2.5,
      count: 60,
      life: [2.5, 4.5],
      seed: 77,
    });
    stage.scene.add(embers.mesh);
  }

  const shots: Record<string, [THREE.Vector3, THREE.Vector3, number]> = {
    wide: [new THREE.Vector3(0.45, 0.6, 5.8), new THREE.Vector3(0, 1.25, 0), 32],
    mid: [new THREE.Vector3(0.35, 1.5, 2.7), new THREE.Vector3(0, 1.38, 0), 30],
    low: [new THREE.Vector3(0.2, 0.3, 4.2), new THREE.Vector3(0, 1.3, 0), 34],
    back: [new THREE.Vector3(-0.6, 1.2, 4.8), new THREE.Vector3(0, 1.6, -3), 35],
  };

  const fit = () => {
    if (!auraMode) {
      // hero framing: tear tip-to-tip just past the frame edges; width = 14.4 % of frame width (measured)
      // the cutscene's beat-1 framing (director.ts beatGate): 18 units out, fov 30, tips just past the frame
      cam.fov = 30;
      cam.updateProjectionMatrix();
      cam.position.set(0, 1.55, 18);
      cam.lookAt(0, 2.3, 0);
      cam.updateMatrixWorld();
      gate.fitWidth(cam);
    }
  };
  fit();
  window.addEventListener('resize', fit);

  stage.onUpdate((t) => {
    light.uTime.value = t;
    outlineShared.uResolution.value.set(stage.width * stage.dpr, stage.height * stage.dpr);
    if (!auraMode) {
      gate.openAt(crack);
      const d = 18 - (1.5 / 13) * t;
      const hx = params.reduced ? 0 : noise1(t * 0.35, 3) * 0.018;
      const hy = params.reduced ? 0 : noise1(t * 0.3, 9) * 0.012;
      cam.position.set(hx, 1.55 + hy, d);
      look.set(hx * 0.4, 2.3 + hy * 0.5, 0);
      cam.lookAt(look);
      env.setFade(clamp((t - 1.7) / 0.2));
      gate.setDim(1 - 0.3 * ease.outQuad(clamp((t - 6.6) / 0.4)));
    } else {
      const [p, target, fov] = shots[shot] ?? shots.wide;
      const drift = 1 - 0.012 * t;
      cam.position.copy(p).sub(target).multiplyScalar(drift).add(target);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      cam.lookAt(target);
      env.setFade(1);
      const ai = clamp(t / 1.5);
      aura!.setIntensity(ai);
      embers!.setIntensity(1);
      // the toon rim reads the gate light: colour, strength and direction (character -> gate)
      light.uRimColor.value.copy(gate.light.color);
      light.uRimStrength.value = 2.6 * gate.light.intensity;
      light.uKeyStrength.value = 0.3;
      const toGate = new THREE.Vector3().subVectors(gate.light.position, new THREE.Vector3(0, 1.2, 0)).setY(0).normalize();
      light.uRimDir.value.set(toGate.x, 0.3, toGate.z).normalize();
    }
    cam.updateMatrixWorld();
    gate.update(t);
    env.update(t);
    if (aura) aura.update(t);
    if (embers) embers.update(t);
  });

  const w = window as unknown as Record<string, unknown>;
  w.__seek = (t: number) => {
    stage.time = t;
    stage.step(0);
  };
  w.__lab = { stage, gate, env, aura, jw, cam };
}
