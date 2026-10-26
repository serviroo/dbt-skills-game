import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { motes, OUT_GLSL, pointScale, rng, WATER_GLSL, WORLD_VERT, waterBackdrop } from '../common';
import type { Beat } from '../host';
import type { BuildScene } from '../runtime';

/**
 * Wise Mind's stone: a small flat river stone drifting down through clear water, turning a little as it glides from
 * side to side, light caustics moving over it, until it settles on pale rippled sand with a small puff that fades.
 * Everything is posed from the timer's beat, so the stone lands as the countdown ends and waits there after.
 * The only light is the sun through the water (caustics and shafts, each a bright core plus a soft halo) and the
 * lantern-blue rim on the stone. Deep water fades to the void.
 */

const FLOOR = -1;
const TOP = 1.05;
const REST = new THREE.Vector3(0.12, FLOOR + 0.08, 0.22);
const YAW = 0.55;
/** the stone settles slightly tilted, one edge a little lower, the way stones lie on sand */
const RX0 = 0.035;
const RZ0 = -0.05;
const FOV = 34;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const SAND_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uStone;
uniform float uLift;
uniform float uYaw;
varying vec3 vWorld;
${WATER_GLSL}
const vec2 POOL = vec2(0.15, 0.1);
/** wind-combed ripples, a finer cross ripple and a little grain */
float sandH(vec2 p) {
  float warp = 0.7 * sin(p.x * 0.6 + p.y * 0.45) + 0.9 * noise2(p * 0.7);
  float r1 = pow(0.5 + 0.5 * sin(dot(p, vec2(0.56, 0.83)) * 16.0 + warp * 3.2), 1.6);
  float r2 = 0.5 + 0.5 * sin(dot(p, vec2(-0.55, 0.84)) * 41.0 + noise2(p * 5.0) * 3.4);
  return r1 * 0.02 + r2 * 0.0025 + noise2(p * 30.0) * 0.0015;
}
void main() {
  vec2 p = vWorld.xz;
  float dist = length(cameraPosition - vWorld);
  float near = 1.0 - smoothstep(4.5, 11.0, dist);
  float e = 0.01;
  float h = sandH(p);
  vec3 n = normalize(vec3(-(sandH(p + vec2(e, 0.0)) - h) / e * near, 1.0, -(sandH(p + vec2(0.0, e)) - h) / e * near));

  // the stone's shadow: crisp and dark when it rests, wide and faint while it is still high up
  vec2 rel = p - (uStone.xz - LIGHT.xz / LIGHT.y * uLift);
  float cs = cos(uYaw), sn = sin(uYaw);
  vec2 local = vec2(cs * rel.x - sn * rel.y, sn * rel.x + cs * rel.y) / vec2(0.46, 0.33);
  float blur = 0.12 + uLift * 0.8;
  float cover = 1.0 - smoothstep(1.0 - blur * 0.5, 1.0 + blur, length(local));
  float vis = 1.0 - cover * mix(0.75, 0.15, clamp(uLift / 1.8, 0.0, 1.0));
  vec2 under = (p - uStone.xz) / vec2(0.52, 0.38);
  float ao = 1.0 - 0.55 * (1.0 - smoothstep(0.75, 1.3, length(under))) * (1.0 - smoothstep(0.0, 0.12, uLift));

  // a pool of light on the sand around the stone; beyond it the floor sinks into the dark
  float pool = exp(-pow(length(p - POOL) / 2.6, 2.0));
  float grain = mix(1.0, 0.9 + 0.2 * noise2(p * 55.0), near);
  // the fine dark grains collect in the troughs between ripples, so the ripples read even where the light is flat
  vec3 albedo = vec3(0.93, 0.85, 0.69) * grain * (0.9 + 0.2 * noise2(p * 1.7)) * mix(1.0, 0.86 + 0.2 * smoothstep(0.002, 0.02, h), near);
  vec3 sun = sunAt(vWorld.y) * pool;
  vec2 c = caustic(p * 1.6, uTime);
  vec3 amb = vec3(0.010, 0.022, 0.038) * (0.15 + 0.85 * pool);
  float ndl = max(dot(n, LIGHT), 0.0);
  vec3 col = albedo * (amb * ao + SUN * sun * 0.58 * ndl * vis * ao);
  // caustic light: the core is the light itself, the halo its soft spill
  col += albedo * SUN * sun * vis * ao * (c.x * 0.24 + c.y * 0.17) * near;
  gl_FragColor = vec4(haze(col, vWorld, uTime, smoothstep(4.0, 9.5, dist)), 1.0);
  ${OUT_GLSL}
}`;

const STONE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNObj;
varying vec3 vWorld;
void main() {
  vObj = position;
  vNObj = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const STONE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uRim;
uniform mat3 uRot;
uniform float uLift;
varying vec3 vObj;
varying vec3 vNObj;
varying vec3 vWorld;
${WATER_GLSL}
float dents(vec3 p) { return noise3(p * 14.0) * 0.7 + noise3(p * 31.0) * 0.3; }
void main() {
  // a smooth, water-worn surface with a few shallow dents that turn with the stone
  float e = 0.006;
  float h0 = dents(vObj);
  vec3 grad = vec3(dents(vObj + vec3(e, 0.0, 0.0)) - h0, dents(vObj + vec3(0.0, e, 0.0)) - h0, dents(vObj + vec3(0.0, 0.0, e)) - h0) / e;
  vec3 no = normalize(vNObj);
  no = normalize(no - 0.0045 * (grad - dot(grad, no) * no));
  vec3 n = normalize(uRot * no);

  // grey slate with soft cloudy patches, a few pale grains and one thin quartz vein
  float blot = noise3(vObj * 4.5) * 0.65 + noise3(vObj * 11.0) * 0.35;
  vec3 albedo = mix(vec3(0.10, 0.10, 0.102), vec3(0.22, 0.215, 0.208), smoothstep(0.32, 0.78, blot));
  albedo *= 0.93 + 0.14 * noise3(vObj * 26.0);
  albedo = mix(albedo, vec3(0.28, 0.29, 0.30), smoothstep(0.84, 0.9, noise3(vObj * 40.0 + 3.1)) * 0.4);
  float band = abs(dot(vObj, normalize(vec3(1.0, 0.3, 0.42))) - 0.06 + 0.03 * (noise3(vObj * 9.0) - 0.5));
  albedo = mix(albedo, vec3(0.62, 0.64, 0.65), (1.0 - smoothstep(0.006, 0.015, band)) * 0.45);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 sun = sunAt(vWorld.y);
  float wrap = max((dot(n, LIGHT) + 0.25) / 1.25, 0.0);
  vec3 amb = mix(vec3(0.003, 0.004, 0.006), vec3(0.016, 0.026, 0.036), n.y * 0.5 + 0.5);
  // resting on sand, the underside sits in its own shade
  float ao = mix(mix(0.3, 1.0, smoothstep(-0.8, 0.3, n.y)), 1.0, smoothstep(0.0, 0.15, uLift));
  // the same net of light as on the sand, so it runs on over the stone
  vec2 c = caustic(vWorld.xz * 1.6, uTime);
  float up = smoothstep(0.1, 0.85, n.y);
  vec3 col = albedo * (amb * ao + SUN * sun * wrap * 0.42 * ao);
  // the pale sand below throws a little warm light back up onto the underside
  col += albedo * vec3(0.93, 0.85, 0.69) * SUN * sunAt(-1.0) * 0.16 * smoothstep(0.25, -0.9, n.y) * mix(0.35, 1.0, exp(-uLift * 0.8)) * ao;
  col += albedo * SUN * sun * up * (c.x * 1.2 + c.y * 0.4);
  // wet sheen: a soft broad highlight and a tighter one inside it
  vec3 H = normalize(LIGHT + V);
  float nh = max(dot(n, H), 0.0);
  col += SUN * sun * (pow(nh, 24.0) * 0.05 + pow(nh, 110.0) * 0.16);
  // the lantern-blue rim, from behind and to the left
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.2);
  col += uRim * fres * (0.05 + 0.95 * clamp(dot(n, normalize(vec3(-0.65, 0.4, -0.6))) + 0.1, 0.0, 1.0)) * 0.7;
  gl_FragColor = vec4(haze(col, vWorld, uTime, 0.0), 1.0);
  ${OUT_GLSL}
}`;

const PUFF_VERT = /* glsl */ `
attribute vec3 dir;
attribute vec4 seed;
uniform float uS;
uniform vec3 uLand;
uniform float uScale;
varying float vA;
void main() {
  float s = max(uS - seed.z * 0.18, 0.0);
  float spread = seed.x * (1.0 - exp(-2.4 * s));
  float rise = dir.y * (1.0 - exp(-3.0 * s)) * exp(-0.5 * s);
  vec3 p = uLand + vec3(dir.x * (0.40 + spread), rise, dir.z * (0.29 + spread));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale * mix(0.014, 0.17, seed.w) * (1.0 + s * 0.7) / -mv.z);
  vA = step(seed.z * 0.18, uS) * smoothstep(0.0, 0.15, s) * exp(-1.1 * s) * mix(0.4, 0.3, seed.w);
}`;
const PUFF_FRAG = /* glsl */ `
varying float vA;
void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA;
  gl_FragColor = vec4(vec3(0.56, 0.56, 0.52), a);
  ${OUT_GLSL}
}`;

/** A smooth flat river stone: flattened top and bottom, a rounded edge, one end a little fuller, never quite even. */
function stoneGeometry() {
  const sphere = new THREE.SphereGeometry(1, 72, 48);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geo = mergeVertices(sphere);
  sphere.dispose();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const lump = 0.6 * Math.sin(3.1 * v.x + 1.7) * Math.sin(2.3 * v.z + 0.4) + 0.4 * Math.sin(4.7 * v.y + 2.9 * v.x + 0.8);
    const r = 1 + 0.035 * lump;
    const y = Math.sign(v.y) * Math.pow(Math.abs(v.y), 0.75);
    pos.setXYZ(i, v.x * 0.46 * r * (1 + 0.07 * v.z), y * 0.082 * (1 + 0.06 * lump) * (1 - 0.12 * v.x), v.z * 0.33 * r);
  }
  geo.computeVertexNormals();
  return geo;
}

/** The sand kicked up where the stone lands: a low ring of fine grains and a few soft clouds, posed by uS. */
function puffGeometry() {
  const rand = rng(11);
  const n = 72;
  const dir = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const big = i % 3 === 0;
    dir.set([Math.cos(a), big ? 0.05 + rand() * 0.08 : 0.04 + rand() * 0.16, Math.sin(a)], i * 3);
    seed.set([big ? 0.12 + rand() * 0.18 : 0.18 + rand() * 0.34, big ? 0.6 + rand() * 0.4 : rand() * 0.3, rand(), big ? 1 : rand() * 0.25], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('dir', new THREE.BufferAttribute(dir, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  return geo;
}

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);
  const look = new THREE.Vector3();
  const time = { value: 0 };
  const scale = { value: 600 };
  const stoneAt = { value: REST.clone() };
  const lift = { value: 0 };
  const yaw = { value: YAW };

  const sandGeo = new THREE.PlaneGeometry(24, 18);
  sandGeo.rotateX(-Math.PI / 2);
  sandGeo.translate(0, FLOOR, -5);
  const sand = new THREE.Mesh(sandGeo, new THREE.ShaderMaterial({ vertexShader: WORLD_VERT, fragmentShader: SAND_FRAG, uniforms: { uTime: time, uStone: stoneAt, uLift: lift, uYaw: yaw } }));

  const rot = { value: new THREE.Matrix3() };
  const stone = new THREE.Mesh(stoneGeometry(), new THREE.ShaderMaterial({ vertexShader: STONE_VERT, fragmentShader: STONE_FRAG, uniforms: { uTime: time, uRim: { value: accent.clone() }, uRot: rot, uLift: lift } }));

  const land = { value: new THREE.Vector3(REST.x, FLOOR + 0.01, REST.z) };
  const since = { value: -1 };
  const puff = new THREE.Points(puffGeometry(), new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: { uS: since, uLand: land, uScale: scale }, transparent: true, depthWrite: false }));
  puff.frustumCulled = false;
  puff.renderOrder = 2;

  scene.add(waterBackdrop(camera, time), sand, stone, puff, motes({ count: 56, width: 4.2, depth: 3.4, z: -0.2, floor: FLOOR, height: 3.2, seed: 7, time, scale }));

  // the timer can stretch: the stone's path is kept continuous from wherever it is when that happens
  const path = { e: 0, d: 0, land: NaN, landed: NaN };
  let gap = 0;
  let prev: Beat | null = null;
  const landOf = (dur: number) => (Number.isFinite(dur) ? Math.max(1, dur - Math.min(4, dur * 0.2)) : 16);
  const depthAt = (e: number) => {
    if (path.d >= 1) return 1;
    const u = clamp01((e - path.e) / Math.max(1e-3, path.land - path.e));
    if (path.e <= 0 && path.d <= 0) return (1 - Math.cos(Math.PI * Math.pow(u, 0.8))) / 2;
    return path.d + (1 - path.d) * (1 - (1 - u) * (1 - u));
  };

  return {
    scene,
    camera,
    pose(b, still) {
      const e = Math.max(0, b.e);
      const l = landOf(b.dur);
      if (Number.isNaN(path.land)) Object.assign(path, { e: 0, d: 0, land: l, landed: l });
      else if (l !== path.land) {
        const d = depthAt(e);
        Object.assign(path, { e, d, landed: d >= 1 ? path.landed : l, land: l });
      }
      // more time after Done picks the water up where it stopped instead of jumping ahead
      if (prev?.done && !b.done) gap += Math.max(0, e - prev.e);
      prev = { ...b };
      const t = still ? 7.3 : e - gap;
      const d = still ? 1 : depthAt(e);
      const settled = still ? -1 : d >= 1 ? e - path.landed : -1;

      const w = Math.pow(1 - d, 0.7);
      const x = REST.x + 0.42 * w * Math.sin(0.55 * t + 0.3);
      const z = REST.z + 0.22 * w * Math.sin(0.37 * t + 2.0);
      const y = TOP + (REST.y - TOP) * d;
      let rx = RX0 + 0.22 * w * Math.cos(0.37 * t + 2.0);
      let rz = RZ0 - 0.34 * w * Math.cos(0.55 * t + 0.3);
      const ry = YAW + 0.9 * (1 - d) + 0.1 * w * Math.sin(0.21 * t);
      if (settled > 0) {
        const k = Math.exp(-2.4 * settled);
        rz += 0.05 * k * Math.sin(7 * settled);
        rx += 0.035 * k * Math.sin(5.5 * settled + 1.2);
      }
      stone.position.set(x, y, z);
      stone.rotation.set(rx, ry, rz, 'YXZ');
      stone.updateMatrixWorld();
      rot.value.setFromMatrix4(stone.matrixWorld);
      stoneAt.value.copy(stone.position);
      lift.value = Math.max(0, y - REST.y);
      yaw.value = ry;

      since.value = settled;
      puff.visible = settled > 0 && settled < 3.8;

      camera.position.set(0.06 * Math.sin(0.11 * t), 0.5 - 0.12 * d, 5.3 - 0.5 * d);
      look.set(0.25 * x + 0.04 * Math.sin(0.11 * t + 1), 0.12 - 0.7 * d, 0);
      camera.lookAt(look);
      camera.updateMatrixWorld();
      time.value = t;
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      scale.value = pointScale(FOV, height);
    },
  };
};
