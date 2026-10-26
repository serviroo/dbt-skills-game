import * as THREE from 'three';
import { glow, NOISE_GLSL, OUT_GLSL, pointScale, rng } from '../common';
import type { BuildScene } from '../runtime';

/**
 * Rest with a soft glow: a small lantern resting on dark ground in soft mist. Its light, a warm-white core in a wide
 * lantern-blue halo, brightens and softens very slowly (one swell every PERIOD seconds), lighting the mist around it and
 * a few motes that hover in it. Thin layers of mist drift past. The lantern is the only light; everything else is the
 * calm dark. The scene sits low in its window, so a countdown or a line of text near it keeps the quiet space above.
 */

const FOV = 32;
/** one slow swell of the light, the same pace as the flat glow */
const PERIOD = 10;
/** where the light sits inside the glass */
const FLAME = new THREE.Vector3(0, 0.3, 0);
const CORE = new THREE.Color(1.0, 0.84, 0.64);

/** 0..1 how bright the light is at e: a slow rise and fall, smooth at both ends */
const swellAt = (e: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * e) / PERIOD);

const LIT_GLSL = /* glsl */ `
uniform vec3 uFlame;
uniform vec3 uCore;
uniform vec3 uHalo;
uniform float uLight;
/** the lantern's light reaching p: warm close to it, cooler and bluer further out */
vec3 lanternAt(vec3 p) {
  float d = length(uFlame - p);
  return (uCore * 0.04 / (0.02 + d * d) * exp(-d * 1.4) + uHalo * 0.014 / (0.06 + d * d)) * uLight;
}`;

const BODY_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
void main() {
  vObj = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** the lantern's dark metal: lit only from inside by its own light, with a soft lantern-blue rim */
const METAL_FRAG = /* glsl */ `
uniform vec3 uRim;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
${NOISE_GLSL}
${LIT_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uFlame - vWorld);
  float wear = 0.8 + 0.4 * noise2(vObj.xz * 40.0 + vObj.y * 30.0);
  vec3 alb = vec3(0.030, 0.032, 0.036) * wear;
  vec3 col = alb * lanternAt(vWorld) * (0.25 + max(dot(n, L), 0.0)) * 6.0;
  col += lanternAt(vWorld) * pow(max(dot(n, normalize(L + V)), 0.0), 40.0) * 0.6;
  col += uRim * pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.05 * (0.6 + 0.4 * uLight);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;
/** the glass: frosted, lit through from inside, brightest level with the light */
const GLASS_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
${NOISE_GLSL}
${LIT_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float frost = 0.85 + 0.15 * noise2(vec2(atan(vObj.z, vObj.x) * 9.0, vObj.y * 30.0));
  float level = exp(-pow((vWorld.y - uFlame.y) / 0.14, 2.0));
  vec3 col = mix(uHalo * 0.12, uCore * 0.26, level) * (0.4 + 0.6 * level) * frost * (0.55 + 0.45 * uLight);
  col += uHalo * pow(1.0 - max(dot(n, V), 0.0), 2.0) * 0.08;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;
/** dark ground: earth and small stones, a pool of the lantern's light around its base, fading into the dark */
const GROUND_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
${NOISE_GLSL}
${LIT_GLSL}
void main() {
  vec2 p = vWorld.xz;
  float stones = smoothstep(0.55, 0.75, noise2(p * 9.0)) * 0.6 + noise2(p * 34.0) * 0.4;
  vec3 alb = vec3(0.045, 0.050, 0.058) * (0.7 + 0.6 * stones);
  vec2 e = vec2(0.01, 0.0);
  float h0 = noise2(p * 9.0) + 0.3 * noise2(p * 34.0);
  vec3 n = normalize(vec3(-(noise2((p + e.xy) * 9.0) - noise2(p * 9.0)) * 0.6, 1.0, -(noise2((p + e.yx) * 9.0) - noise2(p * 9.0)) * 0.6));
  vec3 L = normalize(uFlame - vWorld);
  vec3 col = alb * lanternAt(vWorld) * (0.2 + max(dot(n, L), 0.0)) * 5.0 + alb * vec3(0.004, 0.006, 0.012);
  float far = smoothstep(1.5, 4.5, length(p - vec2(0.0, 0.2)));
  col = mix(col, vec3(0.0024, 0.0030, 0.0068), far);
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
uniform float uLight;
uniform vec3 uHalo;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  vec2 p = vP * vec2(uAspect, 1.0);
  vec3 col = mix(vec3(0.0030, 0.0040, 0.0090), vec3(0.0021, 0.0024, 0.0052), smoothstep(-0.6, 1.0, p.y));
  col += uHalo * 0.006 * exp(-length(p - vec2(0.0, -0.25)) * 1.6) * (0.7 + 0.3 * uLight);
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0008;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const MIST_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** one thin layer of mist: soft drifting wisps, thicker near the ground, lit blue where the lantern reaches it */
const MIST_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uDensity;
varying vec3 vWorld;
varying vec2 vUv;
${NOISE_GLSL}
${LIT_GLSL}
float fbm(vec2 p) { return noise2(p) * 0.5 + noise2(p * 2.03 + 1.7) * 0.3 + noise2(p * 4.1 + 5.3) * 0.2; }
void main() {
  vec2 q = vWorld.xy * vec2(0.9, 1.6) + vec2(uTime * 0.035 + uSeed * 7.1, uSeed * 3.3 + uTime * 0.008);
  float wisp = smoothstep(0.38, 0.85, fbm(q + 0.6 * fbm(q * 0.7 - uTime * 0.01)));
  float low = exp(-max(vWorld.y + 0.05, 0.0) * 1.6);
  float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
  float a = wisp * low * edge * uDensity;
  vec3 col = vec3(0.004, 0.006, 0.012) + lanternAt(vWorld) * 0.9;
  gl_FragColor = vec4(col, a);
  ${OUT_GLSL}
}`;

const MOTE_VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform float uScale;
varying vec3 vLit;
${LIT_GLSL}
void main() {
  vec3 p = position + vec3(sin(uTime * (0.11 + 0.08 * seed.x) + seed.y * 6.2831) * 0.06, sin(uTime * (0.07 + 0.05 * seed.z) + seed.x * 6.2831) * 0.05, cos(uTime * (0.09 + 0.06 * seed.y) + seed.z * 6.2831) * 0.06);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale * (0.008 + 0.01 * seed.w) / -mv.z);
  vLit = lanternAt(p) * (0.4 + 0.6 * seed.w) * 1.4;
}`;
const MOTE_FRAG = /* glsl */ `
varying vec3 vLit;
void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vLit * a, 1.0);
  ${OUT_GLSL}
}`;

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30);
  const look = new THREE.Vector3();
  const time = { value: 0 };
  const light = { value: 1 };
  const scale = { value: 600 };
  const aspect = { value: 1 };
  const lit = { uFlame: { value: FLAME.clone() }, uCore: { value: CORE.clone() }, uHalo: { value: new THREE.Color('#4fb8ff') }, uLight: light };

  const space = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: SPACE_VERT, fragmentShader: SPACE_FRAG, uniforms: { uAspect: aspect, uLight: light, uHalo: lit.uHalo }, depthTest: false, depthWrite: false }));
  space.frustumCulled = false;
  space.renderOrder = -1;

  const groundGeo = new THREE.CircleGeometry(6, 48);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: GROUND_FRAG, uniforms: { ...lit } }));

  // the lantern: a round base, four slim posts round a frosted glass, a cap with a knob and a ring to carry it by
  const metal = new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: METAL_FRAG, uniforms: { ...lit, uRim: { value: accent.clone() } } });
  const lantern = new THREE.Group();
  const part = (geo: THREE.BufferGeometry, y: number, mat: THREE.Material = metal) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    lantern.add(m);
    return m;
  };
  part(new THREE.CylinderGeometry(0.15, 0.17, 0.05, 40), 0.025);
  part(new THREE.CylinderGeometry(0.135, 0.15, 0.03, 40), 0.065);
  part(new THREE.CylinderGeometry(0.105, 0.105, 0.3, 40, 1, true), 0.23, new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: GLASS_FRAG, uniforms: { ...lit }, side: THREE.DoubleSide }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const post = part(new THREE.CylinderGeometry(0.011, 0.011, 0.32, 10), 0.23);
    post.position.set(Math.cos(a) * 0.112, 0.23, Math.sin(a) * 0.112);
  }
  part(new THREE.CylinderGeometry(0.13, 0.13, 0.025, 40), 0.392);
  part(new THREE.ConeGeometry(0.15, 0.1, 40), 0.45);
  part(new THREE.SphereGeometry(0.025, 16, 12), 0.505);
  const ring = part(new THREE.TorusGeometry(0.06, 0.008, 10, 32, Math.PI), 0.52);
  ring.rotation.y = 0.5;

  // its light: a warm core in the glass and the wide blue halo round it
  const coreI = { value: 1 };
  const haloI = { value: 1 };
  const core = glow({ color: CORE.clone(), size: 0.22, core: 0.32, halo: 0.25, intensity: coreI });
  core.position.copy(FLAME);
  const halo = glow({ color: new THREE.Color('#4fb8ff'), size: 1.5, core: 0.06, halo: 0.6, intensity: haloI });
  halo.position.copy(FLAME);
  // the light shines through the frosted glass, so it is drawn over the lantern rather than hidden behind the glass
  core.material.depthTest = false;
  halo.material.depthTest = false;

  // mist: a few thin layers at different depths, each drifting at its own pace
  const mists: THREE.Mesh[] = [];
  for (const [z, w, d, seed] of [[-1.6, 7, 0.55, 1], [-0.7, 5, 0.42, 2], [0.45, 4.2, 0.24, 3], [1.1, 3.4, 0.16, 4]] as const) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 1.6),
      new THREE.ShaderMaterial({ vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, uniforms: { ...lit, uTime: time, uSeed: { value: seed }, uDensity: { value: d } }, transparent: true, depthWrite: false }),
    );
    m.position.set(0, 0.55, z);
    m.renderOrder = 2;
    mists.push(m);
  }

  const rand = rng(31);
  const n = 34;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = 0.22 + 0.75 * Math.sqrt(rand()), a = rand() * Math.PI * 2;
    pos.set([Math.cos(a) * r, 0.12 + rand() * 0.75, Math.sin(a) * r * 0.8], i * 3);
    seed.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const mgeo = new THREE.BufferGeometry();
  mgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  mgeo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const motes = new THREE.Points(mgeo, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { ...lit, uTime: time, uScale: scale }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false;
  motes.renderOrder = 3;

  scene.add(space, ground, lantern, ...mists, motes, halo, core);
  const probe = { light: 1, swell: 0 };

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const e = still ? 0 : Math.max(0, b.e);
      const s = still ? 0.5 : swellAt(e);
      light.value = 0.8 + 0.2 * s;
      coreI.value = 0.28 + 0.12 * s;
      haloI.value = 0.13 + 0.06 * s;
      time.value = still ? 6 : e;
      // the camera drifts a little round the lantern, slower than the light
      const a = 0.35 + 0.025 * time.value;
      camera.position.set(Math.sin(a) * 2.8, 0.82 + 0.03 * Math.sin(time.value * 0.05), Math.cos(a) * 2.8);
      look.set(0, 0.76, 0);
      camera.lookAt(look);
      camera.updateMatrixWorld();
      // mist layers stay facing the camera
      for (const m of mists) m.quaternion.copy(camera.quaternion);
      Object.assign(probe, { light: light.value, swell: s });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      aspect.value = width / height;
      scale.value = pointScale(FOV, height);
    },
  };
};
