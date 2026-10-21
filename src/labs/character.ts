import * as THREE from 'three';
import { Stage } from '../core/stage';
import { params } from '../core/params';
import { loadHero, POSES, type Character } from '../scene/character/hero';
import { light, outlineShared } from '../scene/toon';
import { buildVoid } from '../scene/environment';
import { radialGlowTexture } from '../scene/glow';

/**
 * Look-dev lab.
 *  ?lab=character&view=front|side|34|back|face|face34|faceside|mid|hand|low|orbit&light=eval|scene
 *  ?lab=character&light=cine&shot=full|mid|eyesfar|eyes|eyesclose|eye|hand|awaken|awakenfront   (cutscene framings with a stand-in gate backlight)
 *  shot=eye: a 3/4 close-up on the open (left) eye, for judging the glow; add &glow=0.12 for the unlit eye
 *  &pose=idle|awaken|awakenHigh|rest
 */
export async function characterLab(stage: Stage) {
  const q = new URLSearchParams(location.search);
  const env = buildVoid();
  stage.scene.add(env.group);
  env.skyMat.uniforms.uGlow.value = 0.6;

  const jw = await loadHero(stage);
  stage.scene.add(jw.group);
  const pose = q.get('pose') ?? 'idle';
  jw.rig.apply(POSES[pose] ?? POSES.idle, null, 0);
  jw.eyes.setGlow(Number(q.get('glow') ?? 1));

  const lightMode = q.get('light') ?? 'scene';
  const cam = new THREE.PerspectiveCamera(24, 1, 0.02, 400);
  stage.setCamera(cam);

  if (lightMode === 'cine') {
    cineSetup(stage, env, jw, cam, q.get('shot') ?? 'full');
    (window as any).__lab = { stage, jw, cam, light };
    return;
  }

  if (lightMode === 'eval') {
    light.uKeyStrength.value = 1.0;
    light.uKeyDir.value.set(-0.4, 0.6, 0.7).normalize();
    light.uRimStrength.value = 1.6;
    light.uAmbTop.value.set(0x2a3450);
    stage.scene.background = new THREE.Color(0x3a3f50);
    env.sky.visible = false;
  } else {
    light.uKeyStrength.value = 0.32;
    light.uRimStrength.value = 2.4;
    env.groundMat.uniforms.uSheenStrength.value = 0.6;
  }

  const views: Record<string, [THREE.Vector3, THREE.Vector3, number]> = {
    front: [new THREE.Vector3(0, 1.0, 5.2), new THREE.Vector3(0, 0.93, 0), 24],
    side: [new THREE.Vector3(5.2, 1.0, 0), new THREE.Vector3(0, 0.93, 0), 24],
    '34': [new THREE.Vector3(3.6, 1.05, 3.7), new THREE.Vector3(0, 0.93, 0), 24],
    back: [new THREE.Vector3(0, 1.0, -5.2), new THREE.Vector3(0, 0.93, 0), 24],
    face: [new THREE.Vector3(0, 1.71, 0.95), new THREE.Vector3(0, 1.7, 0), 22],
    face34: [new THREE.Vector3(0.62, 1.72, 0.72), new THREE.Vector3(0, 1.7, 0), 22],
    faceside: [new THREE.Vector3(0.95, 1.71, 0.0), new THREE.Vector3(0, 1.7, 0), 22],
    mid: [new THREE.Vector3(0.9, 1.45, 2.2), new THREE.Vector3(0, 1.45, 0), 28],
    hand: [new THREE.Vector3(0.9, 1.0, 0.8), new THREE.Vector3(0.24, 0.88, 0), 24],
    low: [new THREE.Vector3(1.2, 0.35, 3.6), new THREE.Vector3(0, 1.1, 0), 30],
    hips: [new THREE.Vector3(0.25, 1.0, 1.7), new THREE.Vector3(0, 0.92, 0), 24],
    hem: [new THREE.Vector3(1.6, 0.5, 2.4), new THREE.Vector3(0, 0.45, 0), 30],
    crown: [new THREE.Vector3(0.35, 2.05, 0.55), new THREE.Vector3(0, 1.78, 0), 26],
    headfront: [new THREE.Vector3(0, 1.78, 1.05), new THREE.Vector3(0, 1.76, 0), 24],
    headback: [new THREE.Vector3(-0.2, 1.78, -0.95), new THREE.Vector3(0, 1.74, 0), 24],
    head34: [new THREE.Vector3(-0.75, 1.75, 0.6), new THREE.Vector3(0, 1.74, 0), 24],
    chest: [new THREE.Vector3(0.0, 1.5, 0.9), new THREE.Vector3(0, 1.42, 0), 26],
  };
  const view = params.view || '34';
  const orbit = view === 'orbit';
  const [p, target, fov] = views[view] ?? views['34'];
  cam.position.copy(p);
  cam.fov = fov;
  cam.lookAt(target);
  cam.updateProjectionMatrix();

  stage.onUpdate((t) => {
    light.uTime.value = t;
    outlineShared.uResolution.value.set(stage.width * stage.dpr, stage.height * stage.dpr);
    const back = new THREE.Vector3().subVectors(target, cam.position).setY(0).normalize();
    light.uRimDir.value.set(back.x, 0.35, back.z).normalize();
    if (orbit) {
      const a = t * 0.5;
      cam.position.set(Math.sin(a) * 5.2, 1.0, Math.cos(a) * 5.2);
      cam.lookAt(0, 0.93, 0);
    }
    if (q.has('breathe')) jw.rig.apply(POSES.idle, POSES[pose] ?? POSES.idle, 0.5 + 0.5 * Math.sin(t));
  });
  (window as any).__lab = { stage, jw, cam, light };
}

/** Cutscene lighting: cold weak key, strong blue-violet backlight from a gate behind the figure, face in shadow. */
function cineSetup(stage: Stage, env: ReturnType<typeof buildVoid>, jw: Character, cam: THREE.PerspectiveCamera, shot: string) {
  // stand-in gate: a tall additive glow behind him (the real gate module replaces this)
  const gate = new THREE.Group();
  const glowMat = (c: number, s: number) =>
    new THREE.SpriteMaterial({ map: radialGlowTexture(), color: new THREE.Color(c).multiplyScalar(s), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const core = new THREE.Sprite(glowMat(0xdff8ff, 5));
  core.scale.set(0.32, 3.8, 1);
  const mid = new THREE.Sprite(glowMat(0x3aa8e8, 1.3));
  mid.scale.set(1.3, 5.6, 1);
  const halo = new THREE.Sprite(glowMat(0x5a2fc0, 0.55));
  halo.scale.set(5, 8, 1);
  gate.add(halo, mid, core);
  gate.position.set(0, 2.1, -4.5);
  stage.scene.add(gate);
  env.skyMat.uniforms.uGlow.value = 0.18;
  env.groundMat.uniforms.uSheenStrength.value = 1.0;
  env.groundMat.uniforms.uSheenPos.value.set(0, 0, -3.2);
  stage.scene.fog = null;

  light.uKeyStrength.value = 0.22;
  light.uKeyDir.value.set(-0.5, 0.45, 0.75).normalize();
  light.uKeyColor.value.set(0x8fa8d8);
  light.uRimStrength.value = 2.6;
  light.uAmbTop.value.set(0x121830);
  light.uAmbBottom.value.set(0x120a26);
  light.uGroundGlow.value.set(0x2a1660);
  light.uGroundGlowStrength.value = 0.6;

  const shots: Record<string, { pos: THREE.Vector3; look: THREE.Vector3; fov: number; pose?: string; glow?: number; dolly?: [THREE.Vector3, THREE.Vector3] }> = {
    full: { pos: new THREE.Vector3(0.55, 0.42, 4.4), look: new THREE.Vector3(0, 1.05, 0), fov: 30 },
    mid: { pos: new THREE.Vector3(-0.85, 1.52, 1.75), look: new THREE.Vector3(0.02, 1.5, 0), fov: 26 },
    eyes: { pos: new THREE.Vector3(0.0, 1.676, 0.6), look: new THREE.Vector3(0.0, 1.69, 0), fov: 20 },
    eyesclose: { pos: new THREE.Vector3(0.0, 1.694, 0.34), look: new THREE.Vector3(0.0, 1.694, 0), fov: 16 },
    eyesfar: { pos: new THREE.Vector3(0.05, 1.68, 1.1), look: new THREE.Vector3(0.0, 1.68, 0), fov: 24 },
    push: { pos: new THREE.Vector3(0.05, 1.68, 1.75), look: new THREE.Vector3(0.0, 1.69, 0), fov: 24 },
    eye: { pos: new THREE.Vector3(0.1, 1.692, 0.3), look: new THREE.Vector3(0.024, 1.689, 0.09), fov: 14 },
    hand: { pos: new THREE.Vector3(-0.9, 1.0, 0.7), look: new THREE.Vector3(-0.24, 0.9, 0.0), fov: 26 },
    awaken: { pos: new THREE.Vector3(-1.1, 0.75, 2.8), look: new THREE.Vector3(-0.1, 1.2, 0.2), fov: 32, pose: 'awaken' },
    awakenfront: { pos: new THREE.Vector3(-0.35, 1.35, 1.6), look: new THREE.Vector3(-0.15, 1.3, 0.3), fov: 30, pose: 'awaken' },
  };
  const s = shots[shot] ?? shots.full;
  if (s.pose) jw.rig.apply(POSES[s.pose], null, 0);
  cam.position.copy(s.pos);
  cam.fov = s.fov;
  cam.lookAt(s.look);
  cam.updateProjectionMatrix();

  stage.onUpdate((t) => {
    light.uTime.value = t;
    outlineShared.uResolution.value.set(stage.width * stage.dpr, stage.height * stage.dpr);
    // rim comes from the gate: direction from the character toward the gate, as seen against the camera
    const toGate = new THREE.Vector3().subVectors(gate.position, new THREE.Vector3(0, 1.3, 0)).normalize();
    light.uRimDir.value.copy(toGate).setY(toGate.y + 0.2).normalize();
    core.material.opacity = 0.92 + 0.08 * Math.sin(t * 7.0);
  });
}
