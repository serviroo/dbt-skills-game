import * as THREE from 'three';
import { glow, NOISE_GLSL, OUT_GLSL } from '../common';
import type { BuildScene } from '../runtime';

/**
 * Willing hands: two open hands resting palms up, seen from just above. They are stylised, smooth and softly
 * translucent, like frosted glass lit from within, with a lantern-blue rim. A faint warm light rests in each palm, the
 * only light there is. Over the step the fingers slowly uncurl a little and settle; nothing grabs or closes. The wrists
 * fade into the dark, so the countdown below them stays clear.
 */

const FOV = 30;
/** how curled each finger joint is (radians) when the step starts, and once the hands have settled open */
const CURL_START = 0.62;
const CURL_OPEN = 0.2;
/** the share of the step the fingers take to open */
const OPEN_BY = 0.8;
const WARM = new THREE.Color(1.0, 0.86, 0.7);

/** fingers from the little finger in, for a right hand: where each starts, its splay, its three lengths and its width */
const FINGERS = [
  { x: -0.112, z: -0.15, yaw: 0.2, len: [0.085, 0.055, 0.048], r: 0.026 },
  { x: -0.04, z: -0.172, yaw: 0.07, len: [0.1, 0.068, 0.054], r: 0.029 },
  { x: 0.035, z: -0.178, yaw: -0.03, len: [0.108, 0.074, 0.058], r: 0.031 },
  { x: 0.106, z: -0.165, yaw: -0.13, len: [0.098, 0.064, 0.052], r: 0.03 },
];
const THUMB = { x: 0.135, z: 0.035, yaw: -0.62, len: [0.075, 0.058, 0.048], r: 0.034 };

const ease = (x: number) => x * x * (3 - 2 * x);

const HAND_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
void main() {
  vObj = position;
  // the hands are mirrored and squashed in places, so normals go through the inverse transpose
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** frosted glass lit from within: a cool body, the palms' warm light carried through it, a lantern-blue rim */
const HAND_FRAG = /* glsl */ `
uniform vec3 uRim;
uniform vec3 uWarm;
uniform vec3 uLightA;
uniform vec3 uLightB;
uniform float uGlow;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
${NOISE_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = max(dot(n, V), 0.0);
  float fres = pow(1.0 - facing, 2.4);
  float frost = 0.85 + 0.3 * noise3(vWorld * 38.0);
  float da = length(vWorld - uLightA), db = length(vWorld - uLightB);
  float inner = 0.0011 / (0.016 + da * da) + 0.0011 / (0.016 + db * db);
  vec3 col = vec3(0.004, 0.010, 0.024) * frost * (0.6 + 0.6 * facing);
  col += uWarm * inner * uGlow * (0.35 + 0.65 * facing) * frost;
  col += uRim * fres * 0.22;
  col += vec3(0.4, 0.6, 0.85) * pow(max(dot(reflect(-V, n), normalize(vec3(-0.3, 0.9, 0.2))), 0.0), 30.0) * 0.05;
  // the wrists fade into the dark towards the viewer
  col *= 1.0 - smoothstep(0.18, 0.5, vWorld.z);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const SPACE_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;
const SPACE_FRAG = /* glsl */ `
uniform float uAspect;
uniform float uGlow;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  vec2 p = vP * vec2(uAspect, 1.0);
  vec3 col = mix(vec3(0.0034, 0.0046, 0.010), vec3(0.0021, 0.0024, 0.0052), smoothstep(0.0, 1.2, length(p)));
  col += vec3(0.010, 0.008, 0.006) * exp(-length(p - vec2(0.0, 0.05)) * 2.4) * uGlow;
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0008;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/** A capsule lying along -z from 0 to -length, so a finger joint can turn about its start. */
function segment(r: number, length: number) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, length - r), 8, 16);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -length / 2);
  return g;
}

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  const aspect = { value: 1 };
  const glowAmt = { value: 1 };
  const lightA = { value: new THREE.Vector3() };
  const lightB = { value: new THREE.Vector3() };
  const mat = new THREE.ShaderMaterial({ vertexShader: HAND_VERT, fragmentShader: HAND_FRAG, uniforms: { uRim: { value: accent.clone() }, uWarm: { value: WARM.clone() }, uLightA: lightA, uLightB: lightB, uGlow: glowAmt } });

  const space = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: SPACE_VERT, fragmentShader: SPACE_FRAG, uniforms: { uAspect: aspect, uGlow: glowAmt }, depthTest: false, depthWrite: false }));
  space.frustumCulled = false;
  space.renderOrder = -1;
  scene.add(space);

  /** joints that curl, with how much of the curl each takes */
  const joints: { g: THREE.Group; k: number }[] = [];
  /** points along the hands, to keep them inside the window */
  const tips: THREE.Object3D[] = [];
  const palmLights: THREE.Object3D[] = [];
  const glows: { core: THREE.Mesh; halo: THREE.Mesh }[] = [];
  const coreI = { value: 0.3 };
  const haloI = { value: 0.12 };

  const hand = (side: 1 | -1) => {
    const root = new THREE.Group();
    // a right hand, mirrored for the left; mirroring flips the winding, so the left hand's faces are turned back
    root.scale.set(side, 1, 1);
    const palmGeo = new THREE.SphereGeometry(1, 48, 32);
    const pp = palmGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      // a soft slab, squarer than an oval, a little wider across the knuckles, its heel and the base of the thumb fuller
      const sx = Math.sign(x) * Math.pow(Math.abs(x), 0.6), sz = Math.sign(z) * Math.pow(Math.abs(z), 0.7);
      const wide = 0.158 * (1 + 0.07 * Math.max(0, -sz));
      const thick = 0.042 + 0.018 * Math.max(0, sz) + 0.02 * Math.max(0, sx) * Math.max(0, sz + 0.3);
      const cup = y > 0 ? 0.014 * (1 - sx * sx) * (1 - sz * sz) : 0;
      pp.setXYZ(i, sx * wide, y * thick + 0.025 * sx * sx - cup, sz * 0.18);
    }
    palmGeo.computeVertexNormals();
    const palm = new THREE.Mesh(palmGeo, mat);
    const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.074, 0.4, 8, 20), mat);
    wrist.rotation.x = Math.PI / 2;
    wrist.scale.set(1.18, 1, 0.6);
    wrist.position.set(-0.01, -0.012, 0.33);
    root.add(palm, wrist);
    const add = (f: typeof THUMB, thumb: boolean) => {
      let parent: THREE.Object3D = new THREE.Group();
      parent.position.set(f.x, thumb ? -0.005 : 0.008, f.z);
      parent.rotation.y = f.yaw;
      if (thumb) parent.rotation.z = -0.5;
      root.add(parent);
      f.len.forEach((len, j) => {
        const joint = new THREE.Group();
        if (j) joint.position.z = -f.len[j - 1];
        parent.add(joint);
        joint.add(new THREE.Mesh(segment(f.r * (1 - j * 0.07), len + f.r * 0.5), mat));
        joints.push({ g: joint, k: thumb ? [0.35, 0.5, 0.45][j] : [0.8, 1.15, 0.9][j] });
        parent = joint;
      });
      const tip = new THREE.Object3D();
      tip.position.z = -f.len[f.len.length - 1] - f.r;
      parent.add(tip);
      tips.push(tip);
    };
    FINGERS.forEach((f) => add(f, false));
    add(THUMB, true);
    // the warm light resting in the palm
    const spot = new THREE.Object3D();
    spot.position.set(0, 0.06, -0.02);
    root.add(spot);
    palmLights.push(spot);
    const outer = new THREE.Object3D();
    outer.position.set(0.2, 0, 0.1);
    root.add(outer);
    tips.push(outer);
    return root;
  };

  const right = hand(1);
  right.position.set(0.215, 0, 0);
  right.rotation.set(0, -0.2, -0.08);
  const left = hand(-1);
  left.position.set(-0.215, 0, 0);
  left.rotation.set(0, 0.2, 0.08);
  mat.side = THREE.DoubleSide;
  scene.add(right, left);

  for (const spot of palmLights) {
    const core = glow({ color: WARM.clone(), size: 0.11, core: 0.42, halo: 0.35, intensity: coreI });
    const halo = glow({ color: WARM.clone().lerp(new THREE.Color('#4fb8ff'), 0.4), size: 0.36, core: 0.02, halo: 0.6, intensity: haloI });
    scene.add(core, halo);
    glows.push({ core, halo });
  }

  const v = new THREE.Vector3();
  const probe = { curl: CURL_START, reach: 0 };

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const e = Math.max(0, b.e);
      const u = still ? 1 : Number.isFinite(b.dur) ? Math.min(1, e / Math.max(1, b.dur * OPEN_BY)) : 1;
      // the fingers loosen with the step, with a breath of movement on top that never closes them again
      const breathe = still ? 0 : 0.025 * Math.sin(e * 0.6);
      const curl = CURL_START + (CURL_OPEN - CURL_START) * ease(u) + breathe * (1 - 0.5 * u);
      for (const j of joints) j.g.rotation.x = curl * j.k;
      glowAmt.value = still ? 1 : 0.9 + 0.1 * Math.sin(e * 0.5);
      coreI.value = 0.075 * glowAmt.value;
      haloI.value = 0.065 * glowAmt.value;

      camera.position.set(0.05 * Math.sin(e * 0.05), 1.78, 1.38);
      camera.lookAt(0, -0.02, -0.08);
      camera.updateMatrixWorld();
      scene.updateMatrixWorld(true);
      palmLights.forEach((s, i) => {
        s.getWorldPosition(v);
        (i ? lightB : lightA).value.copy(v);
        glows[i].core.position.copy(v);
        glows[i].halo.position.copy(v);
      });
      // how far out the hands reach in the window: 1 is the window's edge
      let reach = 0;
      for (const t of tips) {
        t.getWorldPosition(v).project(camera);
        reach = Math.max(reach, Math.hypot(v.x, v.y));
      }
      Object.assign(probe, { curl, reach });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      aspect.value = width / height;
    },
  };
};
