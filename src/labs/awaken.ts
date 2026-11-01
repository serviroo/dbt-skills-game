import * as THREE from 'three';
import type { Stage } from '../core/stage';
import { params } from '../core/params';
import { smoothstep } from '../core/math';
import { loadHero, POSES, type Character } from '../scene/character/hero';
import { light, outlineShared } from '../scene/toon';
import { buildVoid } from '../scene/environment';
import { buildAwaken, AWAKEN_AT } from '../scene/awaken';
import { awakenSequence, HIT, AWAKEN_BEAT_DUR } from '../cutscene/awaken-shots';

/**
 * ?lab=awaken : beat 5 on its local 0-16 s timeline (hit at 4.83 s), looping, with the cutscene's own shots and poses.
 *   &t=9.2      freeze at a time         &view=soldiers  look-dev line-up (&pose=stand|kneel|emerge, &orbit)
 *   window.__seek(t) for qa/capture.mjs
 */
const DUR = AWAKEN_BEAT_DUR;

export async function lab(stage: Stage) {
  const q = new URLSearchParams(location.search);
  const env = buildVoid();
  stage.scene.add(env.group);
  env.skyMat.uniforms.uGlow.value = 0.35;
  env.skyMat.uniforms.uGlowColor.value.set(0x1c1850);
  env.groundMat.uniforms.uRadius.value = 26;
  env.groundMat.uniforms.uColor.value.set(0x0c0e1a);

  light.uKeyStrength.value = 0.32;
  light.uRimStrength.value = 2.2;
  light.uFogDensity.value = 0.045;
  light.uFogColor.value.set(0x07080f);

  const jw = await loadHero(stage);
  stage.scene.add(jw.group);
  jw.eyes.setGlow(1);

  const awaken = buildAwaken(stage, jw, { word: true });
  const cam = new THREE.PerspectiveCamera(35, 1, 0.05, 300);
  stage.setCamera(cam);
  stage.grade.u('flashColor').value = awaken.FLASH_COLOR;

  const lineup = params.view === 'soldiers';
  if (lineup) return soldierLab(stage, awaken, jw, cam, q);

  const seq = awakenSequence(stage, awaken, jw, cam);
  const frameAt = (t: number) => {
    light.uTime.value = t;
    outlineShared.uResolution.value.set(stage.width * stage.dpr, stage.height * stage.dpr);
    seq.frameAt(t);
    env.skyMat.uniforms.uGlow.value = 0.35 + 0.7 * smoothstep(8.3, 11.0, t);
  };

  const loop = !q.has('noloop');
  stage.onUpdate((t) => {
    const lt = loop ? t % DUR : Math.min(t, DUR);
    frameAt(lt);
  });
  if (params.t !== undefined) {
    stage.time = params.t;
    stage.paused = true;
  }
  (window as any).__seek = (t: number) => {
    stage.time = t;
  };
  (window as any).__lab = { stage, awaken, jw, cam, light, HIT, AWAKEN_AT };
}

function soldierLab(stage: Stage, awaken: ReturnType<typeof buildAwaken>, jw: Character, cam: THREE.PerspectiveCamera, q: URLSearchParams) {
  const pose = q.get('pose') ?? 'stand';
  jw.rig.apply(POSES.awaken, null, 0);
  const orbit = q.has('orbit');
  const az = Number(q.get('az') ?? 0);
  const dist = Number(q.get('dist') ?? 9);
  const ty = Number(q.get('ty') ?? 1.1);
  const tz = Number(q.get('tz') ?? -0.5);
  const tx = Number(q.get('tx') ?? 0);
  const fov = Number(q.get('fov') ?? 32);
  stage.onUpdate((t) => {
    light.uTime.value = t;
    outlineShared.uResolution.value.set(stage.width * stage.dpr, stage.height * stage.dpr);
    const a = (az * Math.PI) / 180 + (orbit ? t * 0.4 : 0);
    cam.position.set(tx + Math.sin(a) * dist, Number(q.get('cy') ?? 1.2), tz + Math.cos(a) * dist);
    cam.fov = fov;
    cam.lookAt(tx, ty, tz);
    cam.updateProjectionMatrix();
    const back = new THREE.Vector3(tx - cam.position.x, 0, tz - cam.position.z).normalize();
    light.uRimDir.value.set(back.x, 0.35, back.z).normalize();
    awaken.setPool(Number(q.get('pool') ?? 1));
    awaken.setRise(pose === 'emerge' ? Number(q.get('r') ?? 0.3) : 1);
    awaken.setIgnite(Number(q.get('ign') ?? 1));
    awaken.setKneel(pose === 'kneel' ? 1 : Number(q.get('kn') ?? 0));
    awaken.setVortex(0);
    awaken.setSmoke(0);
    awaken.update(t + 20);
  });
  if (params.t !== undefined) {
    stage.time = params.t;
  }
  (window as any).__seek = (t: number) => {
    stage.time = t;
  };
  (window as any).__lab = { stage, awaken, jw, cam, light };
}
