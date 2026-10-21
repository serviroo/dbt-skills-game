import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Stage } from '../../core/stage';
import { light } from '../toon';
import { radialGlowTexture } from '../glow';
import type { Pose } from './rig';

/**
 * The Wanderer: a hooded night-walker in ink-navy cloth, the one figure of the cutscene. A CC0 model (see CREDITS.md,
 * built by scripts/build-hero.mjs) driven by its own idle, reach and hold clips, with the scene's poses layered on top.
 *
 * Poses keep the scene's bone keys (hips, spine, chest, neck, head, shX, uaX, faX, haX, fiX, thX, tgX, snX, ftX; X = L/R,
 * the figure's own left and right). Each value is an XYZ euler in the frame its parent has been turned into, on top of
 * the playing clip. fiX / thX z curls the fingers / thumb (positive = toward the palm). Keys starting with '@' are clip
 * weights: '@reach' and '@hold' blend over '@idle', which takes whatever weight is left.
 */
export interface Character {
  group: THREE.Group;
  rig: { apply: (a: Pose, b: Pose | null, t: number, add?: Pose) => void };
  eyes: { group: THREE.Group; setGlow: (v: number) => void };
  setDissolve: (v: number) => void;
  setClipY: (y: number) => void;
}

export const POSES: Record<string, Pose> = {
  rest: {},
  idle: {},
  // the reach: right arm forward and down, palm up, head bowed toward the hand
  awaken: {
    spine: [0.02, -0.06, 0],
    chest: [0.02, -0.1, 0.02],
    neck: [0.06, 0.06, 0],
    head: [0.16, 0.05, 0],
    shR: [0, 0.1, 0.06],
    uaR: [-1.0, 0.1, 0.18],
    faR: [-0.18, 0, 0],
    haR: [0, -1.5, -0.1],
    fiR: [0, 0, 0.35],
    thR: [0, 0, 0.1],
  },
  // the same gesture lifted to shoulder height as the risen stand
  awakenHigh: {
    spine: [0, -0.06, 0],
    chest: [-0.04, -0.12, 0.02],
    neck: [0, 0.06, 0],
    head: [0.02, 0.05, 0],
    shR: [0, 0.12, 0.12],
    uaR: [-1.45, 0.1, 0.2],
    faR: [-0.3, 0, 0],
    haR: [0.1, -1.5, -0.08],
    fiR: [0, 0, 0.28],
    thR: [0, 0, 0.05],
  },
};

const BONES: [string, string][] = [
  ['hips', 'pelvis'],
  ['spine', 'spine_01'],
  ['chest', 'spine_03'],
  ['neck', 'neck_01'],
  ['head', 'Head'],
  ['shL', 'clavicle_l'],
  ['uaL', 'upperarm_l'],
  ['faL', 'lowerarm_l'],
  ['haL', 'hand_l'],
  ['shR', 'clavicle_r'],
  ['uaR', 'upperarm_r'],
  ['faR', 'lowerarm_r'],
  ['haR', 'hand_r'],
  ['tgL', 'thigh_l'],
  ['snL', 'calf_l'],
  ['ftL', 'foot_l'],
  ['tgR', 'thigh_r'],
  ['snR', 'calf_r'],
  ['ftR', 'foot_r'],
];
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const CLIPS = ['reach', 'hold'] as const;
// knuckle, middle and end joint share of a curl, as a hand closes
const CURL_SPLIT = [0.42, 0.85, 0.5];
// the joint axis the model's fingers and thumbs bend about (bone space), and the sign that closes the hand per side
const CURL_AXIS = new THREE.Vector3(0, 0, 1);
const CURL_SIGN = { l: -1, r: 1 };
const EYE_COLOR = new THREE.Color(0x9fe6ff);

let cached: Promise<{ scene: THREE.Group; clips: THREE.AnimationClip[] }> | null = null;
const loadGLB = () =>
  (cached ??= new GLTFLoader().loadAsync(new URL('models/hero.glb', document.baseURI).href).then((g) => ({ scene: g.scene, clips: g.animations })));

const SHADER_HEAD = /* glsl */ `
uniform float uDissolve;
uniform float uClipY;
uniform vec3 uRimDirW;
uniform vec3 uRimColor;
uniform vec3 uRimColor2;
uniform float uRimStrength;
varying vec3 vWorldPosH;
float hHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hHash(i), hHash(i + vec3(1, 0, 0)), f.x), mix(hHash(i + vec3(0, 1, 0)), hHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hHash(i + vec3(0, 0, 1)), hHash(i + vec3(1, 0, 1)), f.x), mix(hHash(i + vec3(0, 1, 1)), hHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/** Rim light from the gate, the condense-from-smoke dissolve and a height clip, added to the model's own PBR materials. */
function dress(mat: THREE.MeshStandardMaterial, u: Record<string, THREE.IUniform>) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosH;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPosH = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SHADER_HEAD)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (vWorldPosH.y > uClipY) discard;
        float dn = hNoise(vWorldPosH * 9.0) * 0.6 + hNoise(vWorldPosH * 23.0) * 0.4;
        if (dn < uDissolve) discard;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 rimV = normalize((viewMatrix * vec4(uRimDirW, 0.0)).xyz);
          float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
          vec2 side = normalize(rimV.xy + vec2(0.0001));
          float facing = 0.35 + 0.65 * clamp(dot(normalize(normal.xy + vec2(0.0001)), side) * 0.5 + 0.5, 0.0, 1.0);
          vec3 rc = mix(uRimColor, uRimColor2, smoothstep(0.6, 1.9, vWorldPosH.y));
          totalEmissiveRadiance += rc * fres * facing * uRimStrength * 0.16;
          float edge = smoothstep(uDissolve + 0.06, uDissolve, dn) * step(0.001, uDissolve);
          totalEmissiveRadiance += uRimColor * edge * 3.0;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'hero-dress';
}

export async function loadHero(stage: Stage): Promise<Character> {
  const { scene: src, clips } = await loadGLB();
  const model = src.clone(true);
  const group = new THREE.Group();
  group.name = 'hero';
  group.add(model);

  // skinned clones share the source skeleton unless rebound to the cloned bones
  const bonesByName = new Map<string, THREE.Bone>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bonesByName.set(o.name, o as THREE.Bone);
  });
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const sk = m.skeleton;
    m.bind(new THREE.Skeleton(sk.bones.map((b) => bonesByName.get(b.name)!), sk.boneInverses), m.bindMatrix);
    m.frustumCulled = false;
    m.castShadow = m.receiveShadow = true;
    meshes.push(m);
  });

  const u = {
    uDissolve: { value: 0 },
    uClipY: { value: 1e6 },
    uRimDirW: light.uRimDir,
    uRimColor: light.uRimColor,
    uRimColor2: light.uRimColor2,
    uRimStrength: light.uRimStrength,
  };
  let eyeMat: THREE.MeshStandardMaterial | null = null;
  const seen = new Set<THREE.Material>();
  for (const m of meshes) {
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    m.material = mat;
    if (seen.has(mat)) continue;
    seen.add(mat);
    if (/eye/i.test(mat.name)) eyeMat = mat;
    mat.envMapIntensity = 0;
    dress(mat, u);
  }

  // the scene's toon materials light themselves from shared uniforms; these lights follow the same values
  const key = new THREE.DirectionalLight(0xffffff, 1);
  const fill = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  group.add(key, key.target, fill);
  key.target.position.set(0, 1.0, 0);
  // the hood shades the face: one small shadow map that only this figure's PBR materials read
  stage.renderer.shadowMap.enabled = true;
  stage.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.1, right: 1.1, top: 1.2, bottom: -1.2, near: 0.5, far: 9 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 3;

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const c of clips) {
    const a = mixer.clipAction(c);
    a.play();
    a.setEffectiveWeight(c.name === 'idle' ? 1 : 0);
    if (c.name === 'reach') {
      // the reach is a one-shot into the hold: freeze it on its last frame
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.time = c.duration;
    }
    actions.set(c.name, a);
  }
  mixer.update(0);

  /* ---------- eyes: the model's own irises glow, plus a soft halo sprite in front of each */
  const head = bonesByName.get('Head')!;
  const eyesGroup = new THREE.Group();
  head.add(eyesGroup);
  const halo = new THREE.SpriteMaterial({ map: radialGlowTexture(), color: EYE_COLOR, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
  {
    model.updateMatrixWorld(true);
    const eyeMesh = meshes.find((m) => /eye/i.test((m.material as THREE.Material).name));
    const centres: THREE.Vector3[] = [];
    if (eyeMesh) {
      const pos = eyeMesh.geometry.getAttribute('position');
      const left = new THREE.Vector3(), right = new THREE.Vector3();
      let nl = 0, nr = 0;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        eyeMesh.getVertexPosition(i, v);
        v.applyMatrix4(eyeMesh.matrixWorld);
        if (v.x >= 0) (left.add(v), nl++);
        else (right.add(v), nr++);
      }
      if (nl) centres.push(left.multiplyScalar(1 / nl));
      if (nr) centres.push(right.multiplyScalar(1 / nr));
    }
    const inv = new THREE.Matrix4().copy(head.matrixWorld).invert();
    for (const c of centres) {
      const s = new THREE.Sprite(halo);
      // just in front of the eye, so the halo isn't swallowed by the lid
      s.position.copy(c.clone().add(new THREE.Vector3(0, 0, 0.02)).applyMatrix4(inv));
      s.scale.setScalar(0.04);
      eyesGroup.add(s);
    }
  }
  const setGlow = (g: number) => {
    halo.opacity = Math.min(1, g) * 0.85;
    eyesGroup.children.forEach((s) => s.scale.setScalar(0.018 + 0.022 * g));
    if (eyeMat) {
      eyeMat.emissive.copy(EYE_COLOR);
      eyeMat.emissiveIntensity = 0.15 + 2.6 * g;
    }
  };

  /* ---------- pose layer */
  const mapped = BONES.map(([k, n]) => ({ k, bone: bonesByName.get(n)! })).filter((x) => x.bone);
  const mappedKey = new Map(mapped.map((x) => [x.bone, x.k]));
  const fingerBones = (['l', 'r'] as const).map((s) => ({
    s,
    fingers: FINGERS.map((f) => [1, 2, 3].map((i) => bonesByName.get(`${f}_0${i}_${s}`)).filter(Boolean) as THREE.Bone[]),
    thumb: [1, 2, 3].map((i) => bonesByName.get(`thumb_0${i}_${s}`)).filter(Boolean) as THREE.Bone[],
  }));
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const e = new THREE.Euler();
  const acc = new Map<THREE.Bone, THREE.Quaternion>();
  const animW = new Map<THREE.Bone, THREE.Quaternion>();
  const rootInv = new THREE.Quaternion();
  let last: { a: Pose; b: Pose | null; t: number; add?: Pose } = { a: POSES.idle, b: null, t: 0 };

  const val = (k: string, a: Pose, b: Pose | null, t: number, add?: Pose) => {
    const x = a[k] ?? [0, 0, 0];
    const y = b ? b[k] ?? [0, 0, 0] : x;
    const d = add?.[k] ?? [0, 0, 0];
    return [x[0] + (y[0] - x[0]) * t + d[0], x[1] + (y[1] - x[1]) * t + d[1], x[2] + (y[2] - x[2]) * t + d[2]] as const;
  };
  const nearestMapped = (b: THREE.Object3D | null): THREE.Bone | null => {
    for (let p = b?.parent ?? null; p; p = p.parent) if (mappedKey.has(p as THREE.Bone)) return p as THREE.Bone;
    return null;
  };

  const pose = () => {
    const { a, b, t, add } = last;
    // clip weights
    let rest = 1;
    for (const c of CLIPS) {
      const w = Math.max(0, Math.min(1, val('@' + c, a, b, t, add)[0]));
      actions.get(c)?.setEffectiveWeight(w);
      rest -= w;
    }
    actions.get('idle')?.setEffectiveWeight(Math.max(0, rest));
    mixer.update(0);
    model.updateMatrixWorld(true);
    model.getWorldQuaternion(rootInv).invert();
    for (const { bone } of mapped) animW.set(bone, bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv));
    // accumulated turn per mapped bone, in the frame its parent was turned into; then solved back to local rotations
    for (const { k, bone } of mapped) {
      const [x, y, z] = val(k, a, b, t, add);
      const parentAcc = acc.get(nearestMapped(bone) as THREE.Bone) ?? qc.identity();
      const q = (acc.get(bone) ?? new THREE.Quaternion()).copy(parentAcc);
      if (x || y || z) q.multiply(qa.setFromEuler(e.set(x, y, z)));
      acc.set(bone, q);
      bone.parent!.updateWorldMatrix(false, false);
      bone.parent!.getWorldQuaternion(qb).premultiply(rootInv);
      bone.quaternion.copy(qb.invert().multiply(qa.copy(q).multiply(animW.get(bone)!)));
      bone.updateMatrixWorld(true);
    }
    for (const { s, fingers, thumb } of fingerBones) {
      const side = s === 'l' ? 'L' : 'R';
      const curl = val('fi' + side, a, b, t, add)[2] * (s === 'l' ? -1 : 1);
      const th = val('th' + side, a, b, t, add)[2] * (s === 'l' ? -1 : 1);
      for (const chain of fingers) chain.forEach((bn, i) => bn.quaternion.multiply(qa.setFromAxisAngle(CURL_AXIS, CURL_SIGN[s] * curl * CURL_SPLIT[i])));
      thumb.forEach((bn, i) => bn.quaternion.multiply(qa.setFromAxisAngle(CURL_AXIS, CURL_SIGN[s] * th * CURL_SPLIT[i])));
    }
  };

  const rig = {
    apply(a: Pose, b: Pose | null, t: number, add?: Pose) {
      last = { a, b, t, add };
      pose();
    },
  };

  stage.onUpdate((_t, dt) => {
    if (!group.visible || !group.parent) return;
    mixer.update(dt);
    pose();
    key.color.copy(light.uKeyColor.value);
    key.intensity = light.uKeyStrength.value * 4.2;
    key.position.copy(light.uKeyDir.value).multiplyScalar(4).add(key.target.position);
    fill.color.copy(light.uAmbTop.value);
    fill.groundColor.copy(light.uAmbBottom.value);
    fill.intensity = 0.7;
  });

  setGlow(0);
  return {
    group,
    rig,
    eyes: { group: eyesGroup, setGlow },
    setDissolve: (v) => (u.uDissolve.value = v),
    setClipY: (y) => (u.uClipY.value = y),
  };
}
