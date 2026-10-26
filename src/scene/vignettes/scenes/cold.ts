import * as THREE from 'three';
import { NIGHT_GLSL, OUT_GLSL, rng } from '../common';
import type { BuildScene } from '../runtime';

/**
 * Cool water: a shallow pale bowl of clear water on a dark surface, by moonlight. Every few seconds a cool breeze
 * crosses the water and a small ripple spreads slowly from where it touched; moonlight shimmers on the moving surface,
 * and a faint mist lifts off the water and fades. Cool, never icy: no ice, frost or snow anywhere. The moon is the only
 * light. The bowl sits a little high in its window, so the countdown under it stays clear.
 */

const FOV = 30;
/** a new ripple every RIPPLE seconds, give or take a little */
const RIPPLE = 4.2;
/** how fast a ripple's ring spreads, in units a second, and how long it lasts */
const SPREAD = 0.11;
const LIFE = 7.5;
/** a breeze crosses the water every BREEZE seconds */
const BREEZE = 9;
const WATER_Y = 0.118;
const MOON_DIR = new THREE.Vector3(-0.16, 0.66, -0.74).normalize();
/** the bowl's profile from the middle of its floor out over the rim and back down under it: [radius, height] */
const PROFILE: [number, number][] = [
  [0, 0.028], [0.28, 0.03], [0.4, 0.045], [0.5, 0.08], [0.565, 0.13], [0.6, 0.165], [0.618, 0.172], [0.632, 0.166],
  [0.618, 0.13], [0.565, 0.075], [0.47, 0.03], [0.36, 0.008], [0.33, 0], [0, 0],
];

const hash = (n: number) => {
  const x = Math.sin(n * 91.345 + 2.7) * 43758.5453;
  return x - Math.floor(x);
};

const BOWL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** pale glazed ceramic, cool in the moonlight, with a soft sheen and a faint lantern-blue rim */
const BOWL_FRAG = /* glsl */ `
uniform vec3 uMoon;
uniform vec3 uRim;
varying vec3 vN;
varying vec3 vWorld;
${NIGHT_GLSL}
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vWorld);
  float r = length(vWorld.xz);
  // the glaze is a shade paler inside, with a fine darker line at the lip
  vec3 alb = mix(vec3(0.62, 0.67, 0.72), vec3(0.70, 0.74, 0.78), smoothstep(0.0, 0.6, n.y)) * (0.96 + 0.04 * noise2(vWorld.xz * 60.0));
  alb *= 1.0 - 0.25 * exp(-pow((vWorld.y - 0.171) / 0.004, 2.0));
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * ndl * 0.32 + vec3(0.010, 0.016, 0.028) * (0.5 + 0.5 * n.y));
  // the inside of the far wall catches the moonlight bouncing off the water
  col += alb * MOONLIGHT * 0.02 * smoothstep(0.2, 0.6, r) * max(dot(n, -normalize(vec3(vWorld.x, 0.0, vWorld.z))), 0.0);
  vec3 H = normalize(uMoon + V);
  col += MOON * pow(max(dot(n, H), 0.0), 90.0) * 0.25;
  col += uRim * pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.06;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const FLAT_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** the dark surface the bowl stands on: slate with a faint grain, the bowl's soft shadow under it */
const TABLE_FRAG = /* glsl */ `
uniform vec3 uMoon;
varying vec3 vWorld;
${NIGHT_GLSL}
void main() {
  vec2 p = vWorld.xz;
  float grain = 0.8 + 0.2 * noise2(p * vec2(3.0, 40.0)) + 0.1 * noise2(p * 90.0);
  vec3 alb = vec3(0.040, 0.044, 0.052) * grain;
  float r = length(p - uMoon.xz / uMoon.y * -0.06);
  float shade = mix(0.35, 1.0, smoothstep(0.3, 0.75, r));
  vec3 col = alb * (MOONLIGHT * uMoon.y * 1.1 * shade + vec3(0.008, 0.012, 0.022));
  col = mix(col, vec3(0.0021, 0.0024, 0.0052), smoothstep(0.9, 2.2, length(p)));
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/** clear cool water: the pale floor of the bowl seen through it, the night and the moon in it, moving with the ripples */
const WATER_FRAG = /* glsl */ `
uniform vec3 uMoon;
uniform float uTime;
uniform vec4 uRip[4];
uniform vec3 uBreeze;
varying vec3 vWorld;
${NIGHT_GLSL}
float heightAt(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRip[i];
    float d = length(p - r.xy) - r.z * ${SPREAD.toFixed(3)};
    h += r.w * sin(d * 46.0) * exp(-d * d / 0.006);
  }
  // the breeze: a band of fine wavelets crossing the water
  float along = dot(p, uBreeze.xy) - uBreeze.z;
  h += 0.0016 * exp(-along * along / 0.03) * sin(dot(p, vec2(-uBreeze.y, uBreeze.x)) * 70.0 + along * 30.0 - uTime * 2.0) * (0.6 + 0.4 * noise2(p * 9.0 + uTime * 0.3));
  // and the faint stillness left on any water
  h += 0.0004 * sin(p.x * 31.0 + uTime * 0.7) * sin(p.y * 27.0 - uTime * 0.6);
  return h;
}
void main() {
  vec2 p = vWorld.xz;
  float e = 0.004;
  vec2 g = vec2(heightAt(p + vec2(e, 0.0)) - heightAt(p - vec2(e, 0.0)), heightAt(p + vec2(0.0, e)) - heightAt(p - vec2(0.0, e))) / (2.0 * e);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  // the bowl's floor through the water, nudged by the ripples, deeper and bluer towards the middle
  vec2 q = p + g * 0.06;
  float r = length(q);
  vec3 floorCol = vec3(0.66, 0.71, 0.76) * (MOONLIGHT * uMoon.y * 0.13 + vec3(0.006, 0.010, 0.020)) * (0.9 + 0.1 * noise2(q * 40.0));
  floorCol *= mix(vec3(0.62, 0.78, 0.92), vec3(0.9, 0.96, 1.0), smoothstep(0.0, 0.55, r));
  // light focused by the ripples onto the floor
  floorCol *= 1.0 + 6.0 * max(-(g.x + g.y), 0.0);
  vec3 sky = skyDome(R, uMoon, uTime, 0.0) + moonHalo(R, uMoon) * 0.5;
  float md = max(dot(R, uMoon), 0.0);
  vec3 col = mix(floorCol, sky, fres) + MOON * (pow(md, 700.0) * 1.6 + pow(md, 90.0) * 0.07 + pow(md, 16.0) * 0.012);
  // the edge of the water darkens a touch where it meets the glaze
  col *= 0.85 + 0.15 * smoothstep(0.56, 0.5, length(p));
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
varying vec2 vP;
${NIGHT_GLSL}
void main() {
  vec3 col = mix(vec3(0.0034, 0.0045, 0.0098), vec3(0.0021, 0.0024, 0.0052), smoothstep(-0.4, 1.0, vP.y));
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0008;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const MIST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
/** a faint mist lifting off the water and fading as it rises */
const MIST_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
${NIGHT_GLSL}
void main() {
  vec2 q = vec2(vUv.x * 2.4 + uSeed * 5.0, vUv.y * 1.6 - uTime * 0.045);
  float wisp = smoothstep(0.45, 0.85, fbm2(q + 0.5 * fbm2(q * 0.8 + uTime * 0.02)));
  float a = wisp * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.25, 1.0, vUv.y)) * smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
  gl_FragColor = vec4(MOONLIGHT * 0.1, a * 0.34);
  ${OUT_GLSL}
}`;

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30);
  const time = { value: 0 };
  const moon = { value: MOON_DIR.clone() };
  const ripples = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  const breeze = { value: new THREE.Vector3(1, 0, -9) };

  const space = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: SPACE_VERT, fragmentShader: SPACE_FRAG, depthTest: false, depthWrite: false }));
  space.frustumCulled = false;
  space.renderOrder = -1;

  const tableGeo = new THREE.CircleGeometry(3, 64);
  tableGeo.rotateX(-Math.PI / 2);
  const table = new THREE.Mesh(tableGeo, new THREE.ShaderMaterial({ vertexShader: FLAT_VERT, fragmentShader: TABLE_FRAG, uniforms: { uMoon: moon } }));

  const bowl = new THREE.Mesh(
    new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 96),
    new THREE.ShaderMaterial({ vertexShader: BOWL_VERT, fragmentShader: BOWL_FRAG, uniforms: { uMoon: moon, uRim: { value: accent.clone() } }, side: THREE.DoubleSide }),
  );

  const waterGeo = new THREE.CircleGeometry(0.576, 96);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(0, WATER_Y, 0);
  const water = new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({ vertexShader: FLAT_VERT, fragmentShader: WATER_FRAG, uniforms: { uMoon: moon, uTime: time, uRip: { value: ripples }, uBreeze: breeze } }));
  water.renderOrder = 1;

  const mists: THREE.Mesh[] = [];
  for (const [x, z, w, seed] of [[-0.12, -0.1, 0.9, 1], [0.15, 0.08, 0.8, 2]] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.55), new THREE.ShaderMaterial({ vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, uniforms: { uTime: time, uSeed: { value: seed } }, transparent: true, depthWrite: false }));
    m.position.set(x, WATER_Y + 0.27, z);
    m.renderOrder = 2;
    mists.push(m);
  }
  scene.add(space, table, bowl, water, ...mists);

  const rand = rng(5);
  const spots = Array.from({ length: 64 }, () => {
    const a = rand() * Math.PI * 2, r = 0.08 + 0.3 * Math.sqrt(rand());
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const probe = { ripples: 0, newest: 0, breeze: 0 };

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const t = still ? 6.5 : Math.max(0, b.e) + 1.2;
      // the four latest ripples: where each started, how old it is and how strong it still is
      const k = Math.floor(t / RIPPLE);
      let newest = Infinity, spread = 0;
      ripples.forEach((rp, i) => {
        const n = k - i;
        const born = n * RIPPLE + 0.8 * hash(n);
        const age = t - born;
        const [x, z] = spots[((n % 64) + 64) % 64];
        const amp = n < 0 || age < 0 || age > LIFE ? 0 : 0.0042 * Math.exp(-age * 0.4) * Math.min(1, age / 0.6);
        rp.set(x, z, Math.max(0, age), amp);
        if (amp > 0) {
          newest = Math.min(newest, age);
          spread += age * SPREAD;
        }
      });
      // the breeze: its direction turns a little each time, and it crosses in about three seconds
      const bk = Math.floor(t / BREEZE);
      const ba = 0.6 + 1.4 * hash(bk + 40);
      const across = (t - bk * BREEZE) / 3;
      breeze.value.set(Math.cos(ba), Math.sin(ba), -0.9 + 1.8 * across);
      time.value = t;
      camera.position.set(0.06 * Math.sin(t * 0.04), 2.05, 2.15);
      camera.lookAt(0, -0.12, 0.05);
      camera.updateMatrixWorld();
      for (const m of mists) m.quaternion.copy(camera.quaternion);
      Object.assign(probe, { ripples: spread, newest: Number.isFinite(newest) ? newest : -1, breeze: Math.min(1, across) });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  };
};
