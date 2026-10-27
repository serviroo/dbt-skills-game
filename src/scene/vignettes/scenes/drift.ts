import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { siteUrl } from '../../../core/base';
import { motes, OUT_GLSL, pointScale, rng, WATER_GLSL, WORLD_VERT, waterBackdrop } from '../common';
import type { Beat } from '../host';
import type { BuildScene } from '../runtime';

/**
 * Wise Mind's stone: a small flat river stone drifting down through clear water, turning a little as it glides from
 * side to side, light caustics moving over it, until it settles on cool rippled sand with a small puff that fades.
 * Everything is posed from the timer's beat, so the stone lands as the countdown ends and waits there after.
 * The only light is the sun through the water (caustics and shafts, each a bright core plus a soft halo) and the
 * lantern-blue rim on the stone. Deep water fades to the void.
 */

/**
 * The stone itself, modelled and baked in Blender: its mesh with colour, roughness and normal maps. The scene waits
 * for it, so it never starts without its stone; if it can't load, the flat picture stays.
 */
const STONE = await new GLTFLoader().loadAsync(siteUrl('models/stone.glb')).then((g) => {
  const mesh = g.scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  return { geometry: mesh.geometry, map: mat.map!, normalMap: mat.normalMap!, roughnessMap: mat.roughnessMap! };
});

const FLOOR = -1;
const TOP = 1.05;
const REST = new THREE.Vector3(0.12, FLOOR + 0.08, 0.22);
const YAW = 0.55;
/** the stone settles slightly tilted, one edge a little lower, the way stones lie on sand */
const RX0 = 0.035;
const RZ0 = -0.05;
const FOV = 34;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** cool grey river sand, darker than the stone so the stone stays the brightest thing on the floor */
const SAND = /* glsl */ `vec3(0.31, 0.34, 0.355)`;

const SAND_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uStone;
uniform float uLift;
uniform float uYaw;
varying vec3 vWorld;
${WATER_GLSL}
const vec2 POOL = vec2(0.15, 0.1);
/** ripples half a stone apart, across the current, their long gentle backs turned to the sun */
const vec2 ACROSS = vec2(-0.8, -0.6) / 0.45;
/**
 * One ripple's shape (0 in the trough, 1 on the crest) times its height: a long gentle back, a short steep front,
 * the crests bending, branching and fading in and out.
 */
float ripple(vec2 p) {
  float f = fract(dot(p, ACROSS) + 0.9 * noise2(p * 0.32 + 4.0) + 0.45 * noise2(p * 1.3 + 2.0) + 0.3 * sin(dot(p, vec2(-0.6, 0.8)) * 0.8));
  float h = f < 0.64 ? 0.5 - 0.5 * cos(3.14159 * f / 0.64) : 0.5 + 0.5 * cos(3.14159 * (f - 0.64) / 0.36);
  return h * (0.5 + 0.5 * noise2(p * 0.5 + 9.0));
}
float sandH(vec2 p) { return ripple(p) * 0.017 + noise2(p * 26.0) * 0.0012; }
void main() {
  vec2 p = vWorld.xz;
  float dist = length(cameraPosition - vWorld);
  // fine relief fades out with distance, and before a ripple gets thinner than a few pixels, so it never shimmers
  float near = (1.0 - smoothstep(6.0, 13.0, dist)) * (1.0 - smoothstep(0.15, 0.3, fwidth(dot(p, ACROSS))));
  float e = 0.008;
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

  // a pool of light on the sand around the stone, fading slowly, so the far floor sinks into the dark by degrees
  float pool = 1.0 / (1.0 + pow(length(p - POOL) / 2.2, 2.0));
  float grain = mix(1.0, 0.9 + 0.2 * noise2(p * 55.0), near);
  // the fine dark grains collect in the troughs between ripples, so the ripples read even where the light is flat
  vec3 albedo = ${SAND} * grain * (0.9 + 0.2 * noise2(p * 1.7)) * mix(1.0, 0.92 + 0.1 * ripple(p), near);
  vec3 sun = sunAt(vWorld.y) * pool;
  vec2 c = caustic(p * 1.6, uTime);
  vec3 amb = vec3(0.010, 0.022, 0.038) * (0.15 + 0.85 * pool);
  float ndl = max(dot(n, LIGHT), 0.0);
  vec3 col = albedo * (amb * ao + SUN * sun * 0.58 * ndl * vis * ao);
  // caustic light: the core is the light itself, the halo its soft spill, brightest on the ripple faces turned to the
  // sun; far off the net gets finer than the eye can follow and blends into its average glow instead of going out
  c = mix(vec2(0.06, 0.28), c, 1.0 - smoothstep(5.0, 12.0, dist));
  col += albedo * SUN * sun * vis * ao * (c.x * 0.42 + c.y * 0.22) * clamp(ndl / LIGHT.y, 0.6, 1.25);
  // the floor sinks into the water evenly across the view, from just behind the stone to the far edge, instead of all
  // at once near the horizon (1 / dist follows the angle below the horizon), so there is no line where sand meets water
  gl_FragColor = vec4(haze(col, vWorld, uTime, 1.0 - smoothstep(0.03, 0.24, 1.0 / dist)), 1.0);
  ${OUT_GLSL}
}`;

const STONE_VERT = /* glsl */ `
attribute vec4 tangent;
varying vec2 vUv;
varying vec3 vNObj;
varying vec4 vTObj;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vNObj = normal;
  vTObj = tangent;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const STONE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uRim;
uniform mat3 uRot;
uniform float uLift;
uniform sampler2D uMap;
uniform sampler2D uNormalMap;
uniform sampler2D uRoughMap;
varying vec2 vUv;
varying vec3 vNObj;
varying vec4 vTObj;
varying vec3 vWorld;
${WATER_GLSL}
void main() {
  // the stone's own mottling, grains, pits and quartz veins, baked from the Blender model
  vec3 albedo = texture2D(uMap, vUv).rgb;
  float rough = max(texture2D(uRoughMap, vUv).g, 0.18);
  vec3 nb = normalize(vNObj);
  vec3 tb = normalize(vTObj.xyz - nb * dot(nb, vTObj.xyz));
  vec3 n = normalize(uRot * (mat3(tb, cross(nb, tb) * vTObj.w, nb) * (texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0)));
  vec3 ng = normalize(uRot * nb);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 sun = sunAt(vWorld.y);
  float wrap = max((dot(n, LIGHT) + 0.25) / 1.25, 0.0);
  vec3 amb = mix(vec3(0.003, 0.004, 0.006), vec3(0.016, 0.026, 0.036), n.y * 0.5 + 0.5);
  // resting on sand, the underside sits in its own shade
  float ao = mix(mix(0.3, 1.0, smoothstep(-0.8, 0.3, ng.y)), 1.0, smoothstep(0.0, 0.15, uLift));
  // the same net of light as on the sand, so it runs on over the stone
  vec2 c = caustic(vWorld.xz * 1.6, uTime);
  float up = smoothstep(0.1, 0.85, ng.y);
  vec3 col = albedo * (amb * ao + SUN * sun * wrap * 0.9 * ao);
  // the sand below throws a little light back up onto the underside
  col += albedo * ${SAND} * SUN * sunAt(-1.0) * 0.3 * smoothstep(0.25, -0.9, ng.y) * mix(0.35, 1.0, exp(-uLift * 0.8)) * ao;
  col += albedo * SUN * sun * up * (c.x * 0.45 + c.y * 0.1);
  // wet sheen: a soft highlight as broad as the baked roughness, a little stronger at grazing angles, only where light
  // from above can reach (never on the shaded underside)
  float lit = ao * smoothstep(-0.2, 0.3, ng.y);
  vec3 H = normalize(LIGHT + V);
  float a2 = max(rough * rough * rough * rough, 0.002);
  float spec = pow(max(dot(n, H), 0.0), 2.0 / a2 - 2.0) / (4.0 * a2);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  col += SUN * sun * fres * spec * max(dot(n, LIGHT), 0.0) * lit * 0.5;
  // and the bright surface far behind mirrored in the wet top as a soft sheen, broken up by the grain
  vec3 R = reflect(-V, n);
  float s2 = 4.0 / max(rough * rough, 0.02);
  col += SUN * sun * fres * (s2 + 2.0) / 8.0 * pow(max(dot(R, normalize(vec3(0.1, 0.32, -0.94))), 0.0), s2) * lit * 0.3;
  col += (water(R) + shafts(R, uTime) * 0.5) * fres * (1.0 - rough) * 0.5 * smoothstep(-0.1, 0.4, R.y);
  // the lantern-blue rim, from behind and to the left
  float rim = pow(1.0 - max(dot(ng, V), 0.0), 3.5);
  col += uRim * rim * (0.05 + 0.95 * clamp(dot(ng, normalize(vec3(-0.65, 0.4, -0.6))) + 0.1, 0.0, 1.0)) * 0.4;
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
  gl_FragColor = vec4(vec3(0.17, 0.21, 0.23), a);
  ${OUT_GLSL}
}`;

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

  const sandGeo = new THREE.PlaneGeometry(36, 30);
  sandGeo.rotateX(-Math.PI / 2);
  sandGeo.translate(0, FLOOR, -11);
  const sand = new THREE.Mesh(sandGeo, new THREE.ShaderMaterial({ vertexShader: WORLD_VERT, fragmentShader: SAND_FRAG, uniforms: { uTime: time, uStone: stoneAt, uLift: lift, uYaw: yaw } }));

  const rot = { value: new THREE.Matrix3() };
  const stone = new THREE.Mesh(
    STONE.geometry,
    new THREE.ShaderMaterial({
      vertexShader: STONE_VERT,
      fragmentShader: STONE_FRAG,
      uniforms: { uTime: time, uRim: { value: accent.clone() }, uRot: rot, uLift: lift, uMap: { value: STONE.map }, uNormalMap: { value: STONE.normalMap }, uRoughMap: { value: STONE.roughnessMap } },
    }),
  );

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
