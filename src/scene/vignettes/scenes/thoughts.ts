import * as THREE from 'three';
import type { ThoughtPic } from '../../../content/dbt';
import { THOUGHTS } from '../../../motion/tokens';
import { backdrop, NIGHT_GLSL, nightBackdrop, OUT_GLSL, rng, WORLD_VERT } from '../common';
import type { BuildScene } from '../runtime';

/**
 * Spectator Mode's watch step: the player's thoughts going by, in the picture they chose for them. Clouds drift across a
 * moonlit sky above hills that fade into mist; soft pairs of headlights pass along a quiet road in the valley below a
 * hill; leaves float down a moonlit stream. Each thought comes in from the left, crosses at a slow steady pace and goes
 * out on the right, the next one THOUGHTS[pic].spaceSec behind, so one is always on its way and they never pile up. The
 * moon is the light, and the headlights the only others. Everything is posed from the step's clock.
 */

const FOV = 36;
const DEG = Math.PI / 180;
/** reduced motion shows the moment STILL_T seconds in, a thought partway across */
const STILL_T = 6;

type Pace = { readonly crossSec: number; readonly spaceSec: number };
/** a thought on its way: its number, and how far across it is (0 coming in, 1 gone) */
interface Passing {
  n: number;
  u: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** smooth value noise along a line, 0..1 */
const noise1 = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  return hash(i) + (hash(i + 1) - hash(i)) * f * f * (3 - 2 * f);
};
/** the unit vector at azimuth az (positive to the right of straight ahead, -z) and elevation el */
const dirOf = (az: number, el: number, out = new THREE.Vector3()) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

/**
 * The thoughts on their way at time t, newest first, when a new one sets off every spaceSec and thought 0 is `at` of the
 * way across in the still frame: some are already on their way from the first frame on.
 */
function passing(pace: Pace, at: number, t: number) {
  const shift = t - STILL_T + at * pace.crossSec;
  const last = Math.floor(shift / pace.spaceSec);
  const on: Passing[] = [];
  for (let n = last; n > last - Math.ceil(pace.crossSec / pace.spaceSec); n--) {
    const u = (shift - n * pace.spaceSec) / pace.crossSec;
    if (u < 1) on.push({ n, u });
  }
  return on;
}

/** What one picture puts in the scene, and how it moves. */
interface Picture {
  /** poses the camera and everything else at time t, with these thoughts on their way */
  pose(t: number, on: Passing[]): void;
  /** where thought n is when it is u of the way across, as a point in the world */
  where(n: number, u: number, out: THREE.Vector3): THREE.Vector3;
  /** the drawing size changed, in device pixels (the camera's aspect is already set) */
  resize(width: number, height: number): void;
  /** what the picture adds to the probe */
  readonly probe?: Record<string, number>;
}
type Paint = (scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: { value: number }) => Picture;

// ---------------------------------------------------------------- clouds

const CLOUDS = THOUGHTS.clouds;
const CLOUD_SLOTS = Math.ceil(CLOUDS.crossSec / CLOUDS.spaceSec);
/** looking a little up into the sky from the top of a meadow */
const SKY_PITCH = 12 * DEG;
const SKY_MOON = { az: 7 * DEG, el: 23 * DEG };
/** the most of the moon's light a cloud holds back: they are thin, so the moon only dims */
const CLOUD_COVER = 0.65;

/**
 * Cloud n: its height, its size (half width in azimuth and half height, radians) and the seed of its shape. Every third
 * one crosses at the moon's height and the others below it and between, so one passes the moon about every 40 s.
 */
const cloudOf = (n: number) => ({
  el: ([SKY_MOON.el / DEG + 0.4, 13.5, 18.5][((n % 3) + 3) % 3] + (hash(n + 0.5) - 0.5) * 1.2) * DEG,
  rx: (9.5 + 3 * hash(n + 1.3)) * DEG,
  ry: (3.2 + 0.8 * hash(n + 2.9)) * DEG,
  seed: hash(n + 4.1) * 40,
});

/** how much of the moon's light cloud n holds back when it is at azimuth az: its shape in the sky, without the noise */
function coverOf(n: number, az: number) {
  const c = cloudOf(n);
  const qx = (SKY_MOON.az - az) / c.rx, qy = (SKY_MOON.el - c.el) / c.ry;
  const r = Math.hypot(qx, qy < 0 ? qy * 1.6 : qy);
  return CLOUD_COVER * (1 - smooth(0.3, 1.05, r));
}

/**
 * The night above the meadow: the sky, the moon, and the clouds, each a soft heap, rounded on top and flatter underneath,
 * its edge broken by slow noise and lit from behind by the moon, silver where it thins near it, its light coming
 * through as a soft patch where one covers it. Below them three ridges of hills, each darker and nearer than the last,
 * fade into the mist that lies between them, their crests touched by the moon on its side, as on Home's night sky.
 * uLit is how much of the moon's light gets past the clouds.
 */
const CLOUD_SKY_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMoon;
uniform float uLit;
/** each cloud's azimuth and height, half width and half height (radians); then its shape's seed and 1 while it is up */
uniform vec4 uCloud[${CLOUD_SLOTS}];
uniform vec2 uShape[${CLOUD_SLOTS}];
varying vec3 vDir;
${NIGHT_GLSL}
/** soft heaps: two broad octaves, warped and on two turned lattices, so no straight run of the noise ever shows */
float heap(vec2 p) {
  p += vec2(noise2(p * 0.7 + 1.3), noise2(p * 0.7 + 8.1)) * 0.6;
  vec2 a = mat2(0.8, -0.6, 0.6, 0.8) * p, b = mat2(-0.5, -0.866, 0.866, -0.5) * p + 3.7;
  return (noise2(a) + noise2(b)) * 0.325 + (noise2(a * 2.03 + 5.2) + noise2(b * 1.97 + 1.1)) * 0.175;
}
/** the top of ridge k (0 the furthest, 2 the meadow underfoot) at azimuth az, as an elevation */
float ridgeTop(float az, float k) {
  float x = az * (4.5 + 3.5 * k) + k * 11.7;
  float h = noise1(x) * 0.62 + noise1(x * 2.3 + 1.7) * 0.28 + noise1(x * 5.1 + 4.2) * 0.1;
  return mix(0.088, 0.004, k * 0.5) + (h - 0.5) * mix(0.04, 0.05, k * 0.5);
}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyDome(d, uMoon, uTime, 1.0) + moonHalo(d, uMoon) * uLit;
  float az = atan(d.x, -d.z), el = asin(clamp(d.y, -1.0, 1.0));
  // how much of what is behind the clouds they hide here
  float cover = 0.0;
  if (el > 0.1) {
    float a = acos(clamp(dot(d, uMoon), -1.0, 1.0));
    for (int i = 0; i < ${CLOUD_SLOTS}; i++) {
      vec4 c = uCloud[i];
      vec2 q = vec2((az - c.x) / c.z, (el - c.y) / c.w);
      if (uShape[i].y <= 0.0 || abs(q.x) > 1.7 || abs(q.y) > 1.9) continue;
      float r = length(vec2(q.x, q.y < 0.0 ? q.y * 1.6 : q.y));
      // lobes about 1.6 degrees across, the same each way, so the heaps are round rather than streaked
      float n = heap(vec2(az - c.x, el - c.y) / 0.036 + uShape[i].x + vec2(0.0, uTime * 0.008));
      float dens = smoothstep(0.0, 0.7, 1.0 - r + (n - 0.5) * 1.3);
      float toward = exp(-a / 0.35);
      float lining = (exp(-a / 0.05) + 0.3 * exp(-a / 0.16)) * pow(1.0 - dens, 1.4);
      float through = exp(-a / 0.04) * dens;
      // lighter on top, where the moon above the hills reaches, and darker in the thick of it underneath
      float up = clamp(q.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 body = MOONLIGHT * (0.05 + 0.085 * toward) * (0.62 + 0.38 * up) * (1.0 - 0.25 * smoothstep(0.6, 1.0, dens) * (1.0 - up)) + MOON * (0.32 * lining + 0.5 * through) * uLit;
      float alpha = dens * 0.85;
      col = mix(col, body, alpha);
      cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
    }
  }
  // the moon's disc is behind them: a thin edge lets it show, silvered, and a thick middle only its light
  col += moonDisc(d, uMoon) * (1.0 - smoothstep(0.2, 0.85, cover));

  // the hills, from the furthest in: each fades into the mist in front of it, lighter towards the moon
  float px = max(fwidth(el), 1e-4);
  vec2 side = normalize(d.xz + 1e-5), mside = normalize(uMoon.xz + 1e-5);
  float toMoon = pow(max(dot(side, mside), 0.0), 6.0);
  vec3 mist = NIGHT_LOW * 1.15 + vec3(0.0035, 0.0075, 0.016) * (0.55 + 0.8 * toMoon) * mix(0.6, 1.0, uLit);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float top = ridgeTop(az, fk);
    float on = 1.0 - smoothstep(top - px, top + px, el);
    if (on <= 0.0) continue;
    vec3 dark = fk < 0.5 ? vec3(0.0062, 0.0128, 0.0285) : fk < 1.5 ? vec3(0.0030, 0.0055, 0.0120) : vec3(0.0012, 0.0015, 0.0028);
    // the mist lies in the valley in front of each ridge, so it veils the ridge's foot and leaves its crest clear
    float veil = smoothstep(0.004, 0.03, top - el) * (fk < 1.5 ? 0.9 : 0.0);
    vec3 hill = mix(dark, mist, veil);
    // the crest, silvered on the moon's side
    hill += MOONLIGHT * exp(-(top - el) / (px * 1.6)) * (0.004 + 0.016 * toMoon) * uLit * (1.0 - fk * 0.3);
    col = mix(col, hill, on);
  }
  // a whisper of noise, so the deep gradient never shows steps
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0009;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const paintClouds: Paint = (scene, camera, time) => {
  const moon = { value: dirOf(SKY_MOON.az, SKY_MOON.el) };
  const lit = { value: 1 };
  const clouds = { value: Array.from({ length: CLOUD_SLOTS }, () => new THREE.Vector4()) };
  const shapes = { value: Array.from({ length: CLOUD_SLOTS }, () => new THREE.Vector2()) };
  scene.add(backdrop(camera, CLOUD_SKY_FRAG, { uTime: time, uMoon: moon, uLit: lit, uCloud: clouds, uShape: shapes }));
  const look = new THREE.Vector3();
  /**
   * The azimuth where the frame's edge is at elevation el, looking up SKY_PITCH: a cloud starts its crossing past it by
   * more than its own width, so it drifts in and out rather than appearing.
   */
  const edgeAz = (el: number) => {
    const k = Math.tan((FOV / 2) * DEG) * camera.aspect;
    const a = Math.cos(el), b = k * Math.cos(el) * Math.cos(SKY_PITCH), c = k * Math.sin(el) * Math.sin(SKY_PITCH);
    return Math.atan2(b, a) + Math.asin(Math.min(1, c / Math.hypot(a, b)));
  };
  const azOf = (n: number, u: number) => {
    const c = cloudOf(n);
    const drift = edgeAz(c.el) + 1.7 * c.rx;
    return -drift + 2 * drift * u;
  };
  const probe = { moon: 1 };
  return {
    probe,
    pose(t, on) {
      camera.position.set(0, 0, 0);
      camera.lookAt(dirOf(0.012 * Math.sin(t * 0.03), SKY_PITCH + 0.005 * Math.sin(t * 0.05), look));
      let light = 1;
      for (let i = 0; i < CLOUD_SLOTS; i++) {
        const it = on[i];
        shapes.value[i].y = 0;
        if (!it) continue;
        const c = cloudOf(it.n);
        const az = azOf(it.n, it.u);
        clouds.value[i].set(az, c.el, c.rx, c.ry);
        shapes.value[i].set(c.seed, 1);
        light = Math.min(light, 1 - coverOf(it.n, az));
      }
      lit.value = light;
      probe.moon = light;
    },
    where: (n, u, out) => dirOf(azOf(n, u), cloudOf(n).el, out).multiplyScalar(100),
    resize() {},
  };
};

// ---------------------------------------------------------------- cars

const CARS = THOUGHTS.cars;
const CAR_SLOTS = Math.ceil(CARS.crossSec / CARS.spaceSec);
const LAMPS = CAR_SLOTS * 2;
/** the camera's height above the valley floor, standing on the hill */
const EYE = 14;
const ROAD_PITCH = -9 * DEG;
/** the moon is up to the left, out of the picture, so the land is lit from the side */
const ROAD_MOON = { az: -32 * DEG, el: 21 * DEG };
const ROAD_HALF = 2.5;
/** the road through the valley: in from beyond the left of the picture, across, then round and down towards the hill */
const ROAD = new THREE.CatmullRomCurve3(
  [[-62, -80], [-40, -78], [-22, -76], [-8, -72], [3, -63], [8, -52], [6.5, -42], [8, -33], [13, -25], [20, -18], [30, -12]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  'centripetal',
);
/** a car from nose to tail, and its headlights: how far ahead of its middle, apart, and high */
const CAR_LEN = 4.1;
const LAMP_SIDE = 0.62;
const LAMP_UP = 0.68;

/** The land without its road: the hill underfoot falling away to the valley floor, the fields' rolls and the far hills. */
function land(x: number, z: number) {
  const d = -z;
  const hill = 13 * (1 - smooth(0, 19, d + 0.004 * x * x));
  const hills = smooth(100, 240, d) * (8 + 9 * noise1(x * 0.012 + 3.1) + 4 * noise1(x * 0.04));
  const peaks = smooth(280, 500, d) * (14 + 13 * noise1(x * 0.006 + 7.3) + 5 * noise1(x * 0.02 + 1.1));
  const roll = 1.2 * Math.sin(x * 0.045 + 1.3) * Math.sin(z * 0.035 + 0.4) + 0.4 * Math.sin(x * 0.11 - z * 0.07);
  return hill + hills + peaks + roll;
}

const NIGHT_LAND = /* glsl */ `
${NIGHT_GLSL}
uniform vec3 uMoon;
uniform float uTime;
/** each car's front (between its lamps, on the road) and 1 while it is on its way, and which way it faces along the ground */
uniform vec4 uCarAt[${CAR_SLOTS}];
uniform vec2 uCarDir[${CAR_SLOTS}];
const vec3 HEAD = vec3(0.92, 0.96, 1.0);
/** the headlights' light on the ground at p: a long soft pool ahead of each car, widening as it goes, a little round it */
vec3 headlights(vec3 p) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${CAR_SLOTS}; i++) {
    if (uCarAt[i].w <= 0.0) continue;
    vec2 v = p.xz - uCarAt[i].xz;
    vec2 d = uCarDir[i];
    float along = dot(v, d), side = dot(v, vec2(-d.y, d.x));
    float spread = 0.9 + max(along, 0.0) * 0.22;
    float pool = smoothstep(-0.6, 2.5, along) * exp(-max(along, 0.0) / 12.0) * exp(-side * side / (spread * spread));
    sum += HEAD * (pool + exp(-dot(v, v) / 5.0) * 0.1) * uCarAt[i].w;
  }
  return sum;
}
/** the night air between the camera and p: deeper with distance, and a mist lying low in the valley, lit by the moon */
vec3 valleyAir(vec3 col, vec3 p) {
  vec3 v = p - cameraPosition;
  float dist = length(v);
  vec3 d = v / dist;
  vec3 h = normalize(vec3(d.x, max(d.y, 0.0) * 0.3, d.z));
  // the far hills stay a shade darker than the sky behind them, so their line shows; the mist in the hollows is lighter
  vec3 air = skyPlain(h, uMoon) * 0.72 + moonHalo(h, uMoon) * 0.5;
  vec3 mist = NIGHT_LOW * 1.1 + MOONLIGHT * 0.006;
  float far = 1.0 - exp(-dist * 0.0036);
  float low = exp(-max(p.y - 0.5, 0.0) / 5.0) * smoothstep(60.0, 200.0, dist) * 0.7 * (0.65 + 0.35 * fbm2(p.xz * 0.015 + vec2(uTime * 0.004, 0.0)));
  return mix(mix(col, air, clamp(far, 0.0, 0.9)), mist, clamp(low, 0.0, 0.8));
}
`;

const LAND_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/**
 * The valley in moonlight: a patchwork of fields with darker hedges between them, the grass on the hill underfoot, the
 * far hills fading into the night air, and the headlights' light where it falls.
 */
const VALLEY_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
${NIGHT_LAND}
/** distance to the nearest field edge at p (in field sizes), and a number for the field p is in */
vec2 fields(vec2 p) {
  vec2 g = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = o + 0.5 + 0.38 * (hash22(g + o) - 0.5);
    vec2 e = abs(c - f);
    float d = max(e.x * 0.9 + e.y * 0.4, e.y * 0.9 + e.x * 0.4);
    if (d < d1) { d2 = d1; d1 = d; id = hash2(g + o); } else if (d < d2) d2 = d;
  }
  return vec2(d2 - d1, id);
}
void main() {
  vec3 p = vWorld;
  vec3 n = normalize(vN);
  float dist = length(cameraPosition - p);
  vec2 fl = fields(p.xz / 30.0);
  // fields of grass and of bare earth, each its own shade, with hedges along their edges
  vec3 alb = mix(vec3(0.050, 0.062, 0.044), vec3(0.064, 0.058, 0.048), step(0.6, fl.y)) * (0.82 + 0.36 * fl.y);
  alb *= 0.85 + 0.3 * noise2(p.xz * 0.6) * (1.0 - smoothstep(30.0, 120.0, dist));
  float px = max(fwidth(fl.x), 1e-4);
  float hedge = (1.0 - smoothstep(0.01, 0.01 + px * 1.5, fl.x)) * (1.0 - smoothstep(6.0, 16.0, p.y)) * (1.0 - smoothstep(150.0, 420.0, dist));
  alb = mix(alb, vec3(0.022, 0.028, 0.022), hedge * 0.6);
  // the hill underfoot: tufted grass
  float near = 1.0 - smoothstep(8.0, 30.0, dist);
  alb *= 1.0 + near * (noise2(p.xz * vec2(9.0, 3.0)) - 0.5) * 0.7;
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * (0.04 + 1.1 * ndl * ndl) + vec3(0.006, 0.009, 0.016) * (0.6 + 0.4 * n.y));
  col += alb * headlights(p) * 1.1;
  gl_FragColor = vec4(valleyAir(col, p), 1.0);
  ${OUT_GLSL}
}`;

const ROAD_VERT = /* glsl */ `
attribute vec2 road;
varying vec3 vWorld;
varying vec2 vRoad;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vRoad = road;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** The road: worn tarmac with pale edges and a broken line down its middle, in moonlight and the headlights. */
const ROAD_FRAG = /* glsl */ `
varying vec3 vWorld;
/** metres along the road, and across it from -1 (its left edge) to 1 */
varying vec2 vRoad;
${NIGHT_LAND}
void main() {
  vec3 p = vWorld;
  float across = abs(vRoad.y);
  float px = max(fwidth(vRoad.y), 1e-4);
  vec3 alb = vec3(0.060, 0.062, 0.066) * (0.85 + 0.25 * noise2(p.xz * 1.3));
  float edgeLine = smoothstep(0.84 - px, 0.84 + px, across) * (1.0 - smoothstep(0.9 - px, 0.9 + px, across));
  float dash = (1.0 - smoothstep(0.035 - px, 0.035 + px, across)) * step(0.55, fract(vRoad.x / 7.0));
  alb = mix(alb, vec3(0.30, 0.31, 0.32), max(edgeLine * 0.5, dash * 0.7));
  // the worn verge
  alb = mix(alb, vec3(0.07, 0.08, 0.06), smoothstep(0.9, 1.0, across));
  vec3 col = alb * (MOONLIGHT * 0.55 * uMoon.y + vec3(0.006, 0.009, 0.016));
  col += alb * headlights(p) * 2.4;
  gl_FragColor = vec4(valleyAir(col, p), 1.0);
  ${OUT_GLSL}
}`;

const CAR_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** A small car in the dark: deep paint with the moon along its roof and the sky in its windows. */
const CAR_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
${NIGHT_LAND}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float glass = step(0.92, vLocal.y) * step(n.y, 0.75) * step(-1.55, vLocal.x) * step(vLocal.x, 1.05);
  vec3 alb = mix(vec3(0.030, 0.036, 0.046), vec3(0.006, 0.008, 0.012), glass);
  vec3 R = reflect(-V, n);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 col = alb * (MOONLIGHT * (0.08 + 0.6 * max(dot(n, uMoon), 0.0)) + vec3(0.004, 0.006, 0.011));
  col += (skyPlain(R, uMoon) * 1.5 + MOON * pow(max(dot(R, uMoon), 0.0), mix(60.0, 400.0, glass)) * mix(0.25, 0.8, glass)) * fres;
  gl_FragColor = vec4(valleyAir(col, vWorld), 1.0);
  ${OUT_GLSL}
}`;

/** a small hatchback seen from the side, its nose along +x, its wheels on y = 0, centred */
function carGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-1.98, 0.3);
  s.lineTo(-2.03, 0.78);
  s.quadraticCurveTo(-2.0, 1.02, -1.62, 1.12);
  s.lineTo(-1.38, 1.42);
  s.quadraticCurveTo(-1.28, 1.5, -1.05, 1.5);
  s.lineTo(0.3, 1.48);
  s.quadraticCurveTo(0.5, 1.46, 0.62, 1.36);
  s.lineTo(1.12, 0.98);
  s.quadraticCurveTo(1.8, 0.92, 2.0, 0.78);
  s.quadraticCurveTo(2.07, 0.6, 2.0, 0.3);
  s.lineTo(-1.98, 0.3);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.52, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.07, bevelSegments: 2, curveSegments: 5 });
  g.translate(0, 0, -0.76);
  return g;
}

/**
 * A tree about a unit across and a little more tall, standing on y = 0: a short trunk under a rounded crown of three
 * clumps of leaves, a big one with two smaller on its shoulders, each softly round in the light.
 */
function treeGeometry() {
  const pos: number[] = [], nor: number[] = [];
  const v = new THREE.Vector3();
  [[0, 0.82, 0, 0.5], [-0.3, 1.02, 0.1, 0.3], [0.28, 0.96, -0.12, 0.32]].forEach(([x, y, z, r], k) => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      nor.push(v.x, v.y, v.z);
      const lump = 1 + 0.12 * Math.sin(v.x * 7 + k) * Math.sin(v.y * 6 + 0.4) * Math.sin(v.z * 8 + 2.1);
      pos.push(x + v.x * r * lump, y + v.y * r * 0.9 * lump, z + v.z * r * lump);
    }
    g.dispose();
  });
  const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6, 1, true).toNonIndexed();
  const tp = trunk.attributes.position as THREE.BufferAttribute, tn = trunk.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) pos.push(tp.getX(i), tp.getY(i) + 0.25, tp.getZ(i)), nor.push(tn.getX(i), tn.getY(i), tn.getZ(i));
  trunk.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

const TREE_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** Trees by moonlight: dark leaves, lit on the moon's side with a soft wrap, and the headlights as they pass. */
const TREE_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
${NIGHT_LAND}
void main() {
  vec3 n = normalize(vN);
  float leafy = 0.75 + 0.5 * noise3(vWorld * 1.6);
  vec3 alb = vec3(0.075, 0.098, 0.068) * leafy;
  float wrap = max((dot(n, uMoon) + 0.2) / 1.2, 0.0);
  vec3 col = alb * (MOONLIGHT * (0.02 + 1.1 * wrap * wrap) + vec3(0.004, 0.006, 0.011) * (0.5 + 0.5 * n.y));
  col += alb * headlights(vWorld - vec3(0.0, vWorld.y * 0.6, 0.0)) * 1.4;
  gl_FragColor = vec4(valleyAir(col, vWorld), 1.0);
  ${OUT_GLSL}
}`;

/** a camera-facing square per headlight, its corner in xy and its lamp's number in z */
function lampGeometry() {
  const pos = new Float32Array(LAMPS * 4 * 3);
  const idx: number[] = [];
  for (let i = 0; i < LAMPS; i++) {
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y], k) => pos.set([x, y, i], (i * 4 + k) * 3));
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const LAMP_VERT = /* glsl */ `
/** each lamp's place in the world and how bright it shows */
uniform vec4 uLamp[${LAMPS}];
/** the halo's radius in the world, and the fewest and most pixels it may take; the drawing size in pixels */
uniform vec3 uSize;
uniform vec2 uView;
varying vec2 vUv;
varying float vI;
void main() {
  vec4 l = uLamp[int(position.z + 0.5)];
  vUv = position.xy;
  vI = l.w;
  vec4 clip = projectionMatrix * viewMatrix * vec4(l.xyz, 1.0);
  // sized on screen, so far off the core stays a clear point and close by the halo never swamps the road
  float px = clamp(uSize.x * projectionMatrix[1][1] * uView.y * 0.5 / clip.w, uSize.y, uSize.z) * (0.6 + 0.4 * l.w);
  clip.xy += position.xy * px * 2.0 / uView * clip.w;
  gl_Position = clip;
}`;
/** a headlight seen from afar: a small bright core inside a soft halo */
const LAMP_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vI;
void main() {
  float r = length(vUv);
  float core = exp(-r * r / 0.03);
  float halo = exp(-r * 4.5) * (1.0 - smoothstep(0.5, 1.0, r));
  gl_FragColor = vec4(vec3(0.92, 0.96, 1.0) * vI * (core * 5.0 + halo * 0.45), 1.0);
  ${OUT_GLSL}
}`;

const paintCars: Paint = (scene, camera, time) => {
  const moon = { value: dirOf(ROAD_MOON.az, ROAD_MOON.el) };
  const carAt = { value: Array.from({ length: CAR_SLOTS }, () => new THREE.Vector4()) };
  const carDir = { value: Array.from({ length: CAR_SLOTS }, () => new THREE.Vector2()) };
  const lamps = { value: Array.from({ length: LAMPS }, () => new THREE.Vector4()) };
  const view = { value: new THREE.Vector2(1, 1) };
  const shared = { uMoon: moon, uTime: time, uCarAt: carAt, uCarDir: carDir };

  // the road's middle, finely, with its height on the land, and the length along it to each point
  const SAMPLES = 240;
  const mid = ROAD.getSpacedPoints(SAMPLES);
  for (const m of mid) m.y = land(m.x, m.z);
  const roadLen = ROAD.getLength();
  /**
   * The road's height under the nearest point of its middle to (x, z), and how far that is, looking only along the part
   * of the road within NEAR of z (it runs towards the camera all the way, so its points go in order of z): exact for
   * anything nearer the road than that, and anything further off is simply far.
   */
  const NEAR = 12;
  const nearRoad = (x: number, z: number) => {
    let lo = 0, hi = SAMPLES;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (mid[m].z < z - NEAR) lo = m + 1;
      else hi = m;
    }
    let best = Infinity, y = mid[Math.min(lo, SAMPLES)].y;
    for (let i = lo; i <= SAMPLES && mid[i].z <= z + NEAR; i++) {
      const d = (mid[i].x - x) ** 2 + (mid[i].z - z) ** 2;
      if (d < best) (best = d), (y = mid[i].y);
    }
    return { d: Math.sqrt(best), y };
  };

  // the land: a fan of points from underfoot out to the far hills, fine near and coarse far, the road laid flat into it
  const ROWS = 130, COLS = 96;
  const pos = new Float32Array((ROWS + 1) * (COLS + 1) * 3);
  for (let i = 0; i <= ROWS; i++) {
    const r = 1.5 + 900 * Math.pow(i / ROWS, 2.4);
    for (let j = 0; j <= COLS; j++) {
      const a = (j / COLS - 0.5) * 100 * DEG;
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      let y = land(x, z);
      if (z < -8 && z > -90 && x > -80 && x < 45) {
        const near = nearRoad(x, z);
        y = near.y + (y - near.y) * smooth(ROAD_HALF + 0.6, ROAD_HALF + 6, near.d);
      }
      pos.set([x, y, z], (i * (COLS + 1) + j) * 3);
    }
  }
  const ground = new THREE.BufferGeometry();
  const gi: number[] = [];
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    gi.push(a, a + 1, b, a + 1, b + 1, b);
  }
  ground.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ground.setIndex(gi);
  ground.computeVertexNormals();
  const valley = new THREE.Mesh(ground, new THREE.ShaderMaterial({ vertexShader: LAND_VERT, fragmentShader: VALLEY_FRAG, uniforms: shared }));
  valley.frustumCulled = false;

  // the road: a ribbon along its middle, just above the land
  const rp = new Float32Array((SAMPLES + 1) * 2 * 3);
  const rr = new Float32Array((SAMPLES + 1) * 2 * 2);
  const ri: number[] = [];
  const tan = new THREE.Vector3();
  for (let i = 0; i <= SAMPLES; i++) {
    const m = mid[i];
    ROAD.getTangentAt(i / SAMPLES, tan);
    const nx = -tan.z, nz = tan.x;
    const l = Math.hypot(nx, nz);
    for (const [k, s] of [[0, -1], [1, 1]]) {
      rp.set([m.x + (nx / l) * ROAD_HALF * s, m.y + 0.05, m.z + (nz / l) * ROAD_HALF * s], (i * 2 + k) * 3);
      rr.set([(i / SAMPLES) * roadLen, s], (i * 2 + k) * 2);
    }
    if (i < SAMPLES) ri.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const ribbon = new THREE.BufferGeometry();
  ribbon.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  ribbon.setAttribute('road', new THREE.BufferAttribute(rr, 2));
  ribbon.setIndex(ri);
  const road = new THREE.Mesh(ribbon, new THREE.ShaderMaterial({ vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG, uniforms: shared, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  road.frustumCulled = false;

  const body = carGeometry();
  const paint = new THREE.ShaderMaterial({ vertexShader: CAR_VERT, fragmentShader: CAR_FRAG, uniforms: shared });
  const cars = Array.from({ length: CAR_SLOTS }, () => new THREE.Mesh(body, paint));
  const glows = new THREE.Mesh(
    lampGeometry(),
    new THREE.ShaderMaterial({ vertexShader: LAMP_VERT, fragmentShader: LAMP_FRAG, uniforms: { uLamp: lamps, uSize: { value: new THREE.Vector3(1.1, 5, 26) }, uView: view }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glows.frustumCulled = false;
  glows.renderOrder = 4;
  // trees: lines of them along some of the field edges and the road, and a few small woods, the same every visit; none
  // nearer than the foot of the hill, where one would stand huge in front of everything
  const rand = rng(41);
  const sites: number[][] = [];
  const plant = (x: number, z: number, big = 1) => {
    const r = nearRoad(x, z);
    if (r.d > ROAD_HALF + 2.2 && -z > 48) sites.push([x, land(x, z), z, (2.8 + 2.2 * rand()) * big]);
  };
  for (const [x0, z0, x1, z1] of [[-90, -104, 60, -98], [-70, -62, -20, -138], [25, -60, 70, -140], [-100, -150, 80, -160]]) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 0; s < len; s += 6 + rand() * 7) if (rand() > 0.25) plant(x0 + ((x1 - x0) * s) / len + (rand() - 0.5) * 2, z0 + ((z1 - z0) * s) / len + (rand() - 0.5) * 2);
  }
  for (let i = 0; i < 40; i++) {
    const m = mid[Math.floor(rand() * SAMPLES)];
    if (rand() > 0.5) plant(m.x + (rand() - 0.5) * 22, m.z + (rand() - 0.5) * 22, 0.9);
  }
  for (const [cx, cz, n] of [[-48, -122, 14], [40, -88, 10], [-22, -170, 16]]) for (let i = 0; i < n; i++) plant(cx + (rand() - 0.5) * 26, cz + (rand() - 0.5) * 20, 1.15);
  const trees = new THREE.InstancedMesh(treeGeometry(), new THREE.ShaderMaterial({ vertexShader: TREE_VERT, fragmentShader: TREE_FRAG, uniforms: shared }), sites.length);
  const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), ts = new THREE.Vector3(), tp = new THREE.Vector3();
  sites.forEach(([x, y, z, size], i) => trees.setMatrixAt(i, tm.compose(tp.set(x, y - 0.1, z), tq.setFromAxisAngle(ts.set(0, 1, 0), rand() * 6.3), ts.set(size, size * (0.9 + 0.3 * rand()), size))));
  trees.frustumCulled = false;
  scene.add(nightBackdrop(camera, moon, time), valley, road, trees, ...cars, glows);

  /**
   * The stretch of road a car crosses, as shares of its length: from where the road comes in past the left edge of the
   * frame to where it goes out past the right, so each car drives in from beyond the picture and out of it again.
   */
  let from = 0, to = 1;
  const look = new THREE.Vector3();
  const at = new THREE.Vector3(), ahead = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
  const along = (u: number) => from + (to - from) * u;
  const aim = (t: number) => {
    camera.position.set(0.15 * Math.sin(t * 0.035), EYE, 0);
    camera.lookAt(look.set(0.15 * Math.sin(t * 0.035) + 2 * Math.sin(t * 0.02), EYE + Math.tan(ROAD_PITCH) * 50, -50));
    camera.updateMatrixWorld();
  };
  /** puts the car u of the way across in `at` (its middle, on the road) and which way it faces in `ahead` */
  const placeCar = (u: number) => {
    const k = along(u);
    ROAD.getPointAt(k, at);
    ROAD.getTangentAt(k, ahead);
    at.y = nearRoad(at.x, at.z).y;
    ahead.y = 0;
    ahead.normalize();
  };
  return {
    pose(t, on) {
      aim(t);
      for (let i = 0; i < CAR_SLOTS; i++) {
        const it = on[i];
        const car = cars[i];
        car.visible = !!it;
        carAt.value[i].w = 0;
        lamps.value[i * 2].w = lamps.value[i * 2 + 1].w = 0;
        if (!it) continue;
        placeCar(it.u);
        const yFront = nearRoad(at.x + ahead.x * 2, at.z + ahead.z * 2).y;
        const yBack = nearRoad(at.x - ahead.x * 2, at.z - ahead.z * 2).y;
        car.position.set(at.x, (yFront + yBack) / 2 + 0.05, at.z);
        car.rotation.set(0, Math.atan2(-ahead.z, ahead.x), Math.atan2(yFront - yBack, 4), 'YZX');
        side.set(-ahead.z, 0, ahead.x);
        const fx = at.x + ahead.x * (CAR_LEN / 2), fz = at.z + ahead.z * (CAR_LEN / 2), fy = yFront + 0.05;
        carAt.value[i].set(fx, fy, fz, 1);
        carDir.value[i].set(ahead.x, ahead.z);
        // brighter as they turn towards the camera
        toCam.set(camera.position.x - fx, camera.position.y - fy, camera.position.z - fz).normalize();
        const facing = 0.14 + 0.86 * smooth(-0.15, 0.9, ahead.dot(toCam));
        for (const [k, sg] of [[0, -1], [1, 1]]) lamps.value[i * 2 + k].set(fx + side.x * LAMP_SIDE * sg, fy + LAMP_UP, fz + side.z * LAMP_SIDE * sg, facing);
      }
    },
    where(_n, u, out) {
      placeCar(u);
      return out.copy(at).setY(at.y + 0.7);
    },
    resize(width, height) {
      view.value.set(width, height);
      // where the road crosses the frame's edges, looking from the camera's resting place
      aim(0);
      const p = new THREE.Vector3();
      let a = 0, b = 1;
      for (let i = 0; i <= 400; i++) {
        const k = i / 400;
        ROAD.getPointAt(k, p);
        p.y = land(p.x, p.z) + 0.7;
        const x = p.project(camera).x;
        if (x < -1.25) a = k;
        if (x > 1.25 && b === 1 && k > a) b = k;
      }
      from = a;
      to = b;
    },
  };
};

// ---------------------------------------------------------------- leaves

const LEAVES = THOUGHTS.leaves;
const LEAF_SLOTS = Math.ceil(LEAVES.crossSec / LEAVES.spaceSec);
const LEAF_MOON = { az: 5 * DEG, el: 33 * DEG };
/** where the water meets the near bank (under the camera) and the far one, and how high the far one rises */
const NEAR_BANK = -0.2;
const FAR_BANK = -4.2;
const BANK_H = 0.32;
/** the lines the leaves float along, each a distance out from the camera, in turn */
const LANES = [-2.25, -1.25, -3.05, -1.75, -2.7];
/** each leaf's colour in daylight: dry rust, faded ochre, brown and olive */
const LEAF_COLOURS = [0x5a2a14, 0x6b4a1c, 0x4a2c18, 0x3e4420].map((c) => new THREE.Color(c));

/**
 * The stream's banks and bed at (x, z): the near bank of gravel and pebbles, the far one of grass rising above the water,
 * stones at their edges. Its height, and how far up a stone it is (0 off any stone).
 */
function bankAt(x: number, z: number, stones: number[][]) {
  let y: number;
  if (z > NEAR_BANK) y = 0.04 + (z - NEAR_BANK) * 0.2;
  else if (z < FAR_BANK) y = BANK_H * smooth(FAR_BANK, FAR_BANK - 1.1, z) + (FAR_BANK - z) * 0.04 + 0.04;
  else y = -0.45 * smooth(0, 0.9, Math.min(z - FAR_BANK, NEAR_BANK - z));
  y += 0.03 * Math.sin(x * 2.1 + z * 1.3) * Math.sin(x * 0.7 - z * 2.9);
  let stone = 0;
  for (const [sx, sz, r, h] of stones) {
    const d = Math.hypot(x - sx, (z - sz) * 1.25) / r;
    const top = d < 1 ? h * Math.pow(1 - d * d, 0.6) - 0.02 : -Infinity;
    if (top > y) (y = top), (stone = 1 - d);
  }
  return { y, stone };
}

const BANK_VERT = /* glsl */ `
attribute float stone;
varying vec3 vWorld;
varying vec3 vN;
varying float vStone;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vStone = stone;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/**
 * The banks by night: dark gravel strewn with rounded pebbles on the near side, damp by the water; grass on the far side
 * over a dark earthen edge; a few larger mossy stones half in the water. The moon is beyond the stream, so tops catch it.
 */
const BANK_FRAG = /* glsl */ `
uniform vec3 uMoon;
varying vec3 vWorld;
varying vec3 vN;
varying float vStone;
${NIGHT_GLSL}
const float NEAR_BANK = ${NEAR_BANK.toFixed(3)};
const float FAR_BANK = ${FAR_BANK.toFixed(3)};
/**
 * The pebble at p, if any: each cell holds one, an oval of its own size and turn. x, y = where p is on it (its edge at
 * length 1), z = a number for it; z < 0 off every pebble.
 */
vec3 pebble(vec2 p) {
  vec2 g = floor(p), f = fract(p);
  vec3 best = vec3(0.0, 0.0, -1.0);
  float near = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 h = hash22(g + o);
    float id = hash2(g + o + 17.0);
    float a = id * 6.2831, size = 0.3 + 0.32 * h.y;
    vec2 d = mat2(cos(a), -sin(a), sin(a), cos(a)) * (f - o - 0.5 - 0.36 * (h - 0.5)) / (size * vec2(1.0, 0.68));
    float r = length(d);
    if (r < 1.0 && r < near) { near = r; best = vec3(d, id); }
  }
  return best;
}
void main() {
  vec3 p = vWorld;
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - p);
  vec3 alb;
  float wet = 0.0;
  if (vStone > 0.0) {
    // a stone: smooth and dark, moss in its hollows, dry on top
    alb = vec3(0.11, 0.115, 0.12) * (0.75 + 0.4 * noise2(p.xz * 9.0 + p.y * 7.0));
    alb = mix(alb, vec3(0.05, 0.07, 0.04), smoothstep(0.55, 0.8, noise2(p.xz * 5.0)) * (1.0 - smoothstep(0.1, 0.5, vStone)));
    wet = 1.0 - smoothstep(0.0, 0.08, p.y);
  } else if (p.z > NEAR_BANK - 0.6) {
    // pebbles of every size and turn, each its own grey or brown, bedded in dark gravel
    vec3 pb = pebble(p.xz * 5.0);
    float on = pb.z < 0.0 ? 0.0 : 1.0 - smoothstep(0.86, 1.0, length(pb.xy));
    vec3 gravel = vec3(0.06, 0.056, 0.052) * (0.5 + 0.9 * noise2(p.xz * 70.0));
    vec3 stoneCol = mix(vec3(0.25, 0.235, 0.21), vec3(0.15, 0.165, 0.185), fract(pb.z * 7.3)) * mix(0.65, 1.15, fract(pb.z * 13.1));
    alb = mix(gravel, stoneCol, on);
    // each one rounded: its surface leans out towards its edge
    vec2 lean = pb.xy * 0.9;
    n = normalize(mix(n, normalize(vec3(lean.x, 1.0 - dot(lean, lean) * 0.6, lean.y)), on));
    wet = 1.0 - smoothstep(NEAR_BANK, NEAR_BANK + 0.4, p.z);
  } else {
    float grass = noise2(p.xz * vec2(34.0, 10.0)) * 0.6 + noise2(p.xz * 3.0) * 0.4;
    alb = mix(vec3(0.060, 0.078, 0.048), vec3(0.11, 0.12, 0.07), grass);
    // the steep earthen edge, darker, with roots
    float edge = smoothstep(0.55, 0.85, 1.0 - n.y);
    alb = mix(alb, vec3(0.045, 0.036, 0.030) * (0.7 + 0.6 * noise2(p.xy * vec2(12.0, 30.0))), edge);
    wet = 1.0 - smoothstep(-0.02, 0.12, p.y);
  }
  alb *= mix(1.0, 0.55, wet);
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * (0.1 + 0.8 * ndl) + vec3(0.007, 0.010, 0.018) * (0.5 + 0.5 * n.y));
  vec3 R = reflect(-V, n);
  col += MOON * pow(max(dot(R, uMoon), 0.0), mix(12.0, 90.0, wet)) * mix(0.008, 0.1, wet);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/**
 * The stream: dark and clear, carried along at the leaves' pace in fine ripples and slow swirls, calmer by the banks. It
 * mirrors the sky, the far bank where it rises between, and the moon as a long broken path of light. Each leaf shades
 * the water under it a little.
 */
const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMoon;
/** how fast the stream carries things along x, in metres a second */
uniform float uFlow;
/** each leaf on the water: where it is, its size and 1 while it is there */
uniform vec4 uLeaf[${LEAF_SLOTS}];
varying vec3 vWorld;
${NIGHT_GLSL}
const float NEAR_BANK = ${NEAR_BANK.toFixed(3)};
const float FAR_BANK = ${FAR_BANK.toFixed(3)};
const float BANK_H = ${BANK_H.toFixed(3)};
void main() {
  vec2 p = vWorld.xz;
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  float t = uTime;
  vec2 q = p - vec2(uFlow * t, 0.0);
  float edge = min(p.y - FAR_BANK, NEAR_BANK - p.y);
  // ripples carried with the current, and slow swirls: the water moves with the leaves
  vec2 g = ripples(q * vec2(3.2, 4.4), t * 0.9) * 0.16 + ripples(q * vec2(1.1, 1.5) + 7.0, t * 0.4) * 0.08;
  // the current lays its ripples along the stream, so the moon's light breaks up and down the water in a long column
  g *= vec2(0.35, 1.0);
  float e = 0.05;
  float s0 = noise2(vec2(q.x * 0.9, p.y * 2.4) + vec2(0.0, t * 0.05));
  g += vec2(noise2(vec2((q.x + e) * 0.9, p.y * 2.4) + vec2(0.0, t * 0.05)) - s0, noise2(vec2(q.x * 0.9, (p.y + e) * 2.4) + vec2(0.0, t * 0.05)) - s0) / e * 0.012;
  g *= mix(0.4, 1.0, smoothstep(0.0, 0.9, edge)) * mix(1.0, 0.5, smoothstep(4.0, 12.0, dist));
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 refl = (skyDome(R, uMoon, t, 0.0) + moonHalo(R, uMoon)) * 1.5;
  float md = max(dot(R, uMoon), 0.0);
  vec3 glint = MOON * (pow(md, 3000.0) * 1.5 + pow(md, 500.0) * 0.018 + pow(md, 40.0) * 0.002);
  // the far bank rises between the water and the sky: a reflected ray that meets it sees its dark
  float run = (p.y - FAR_BANK) / max(-R.z, 1e-3);
  float rise = R.y / max(length(R.xz), 1e-3) * run;
  float bank = R.z < 0.0 ? 1.0 - smoothstep(BANK_H * 0.75, BANK_H * 1.15, rise) : 0.0;
  refl = mix(refl, vec3(0.0016, 0.0020, 0.0028), bank);
  glint *= 1.0 - bank;
  // deep water is nearly black and blue; by the banks it is shallow and the stones of its bed show faintly
  vec3 deep = vec3(0.0009, 0.0024, 0.0056);
  float shallow = 1.0 - smoothstep(0.0, 0.6, edge);
  vec3 bed = vec3(0.020, 0.022, 0.024) * (0.4 + 1.0 * noise2(p * 6.0)) * MOONLIGHT;
  vec3 body = mix(deep, bed, shallow * 0.7);
  vec3 col = mix(body, refl, fres) + glint;
  // faint silver lines of the current, drawn out along the stream and carried with it
  float lines = smoothstep(0.6, 0.9, noise2(vec2(q.x * 0.45, p.y * 7.0))) * smoothstep(0.45, 0.8, noise2(vec2(q.x * 1.3 + 3.0, p.y * 2.0))) * (1.0 - bank);
  col += MOONLIGHT * lines * (0.0008 + 0.01 * pow(md, 8.0)) * smoothstep(0.0, 0.5, edge);
  for (int i = 0; i < ${LEAF_SLOTS}; i++) {
    vec4 l = uLeaf[i];
    float r = length((p - l.xy) * vec2(1.0, 1.4)) / l.z;
    col *= 1.0 - 0.4 * (1.0 - smoothstep(0.4, 1.0, r)) * l.w;
  }
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/**
 * A leaf a unit long along x, its stem at -0.62 and its tip at 0.5: widest a little before its middle, cupped across and
 * arched along its length. uv is how far along it (0 at the stem end of the blade, below 0 on the stem) and across it.
 */
function leafGeometry() {
  const ROWS = 16, COLS = 6;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= ROWS; i++) {
    const s = i / ROWS;
    // a little serrated at its edge
    const w = 0.3 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 0.75) * (1 + 0.035 * Math.sin(s * 70));
    for (let j = 0; j <= COLS; j++) {
      const a = (j / COLS) * 2 - 1;
      pos.push(s - 0.5, 0.018 * a * a * (w / 0.3) + 0.02 * Math.sin(Math.PI * s) + 0.012 * Math.sin(a * 2.4 + s * 5), a * w);
      uv.push(s, a);
    }
  }
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // the stem: a thin strip curving up from the blade
  const base = pos.length / 3;
  for (const [x, y] of [[-0.5, 0.0], [-0.56, 0.01], [-0.62, 0.035]]) for (const z of [-0.008, 0.008]) (pos.push(x, y, z), uv.push(-0.1, z / 0.008));
  for (let k = 0; k < 2; k++) idx.push(base + k * 2, base + k * 2 + 2, base + k * 2 + 1, base + k * 2 + 1, base + k * 2 + 2, base + k * 2 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const LEAF_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vUv = uv;
  vCol = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** A wet fallen leaf by moonlight: its colour, a paler midrib and veins, browner at its edge, and a damp sheen. */
const LEAF_FRAG = /* glsl */ `
uniform vec3 uMoon;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vCol;
${NIGHT_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  float s = vUv.x, a = abs(vUv.y);
  vec3 alb = vCol * (0.85 + 0.3 * noise2(vUv * vec2(9.0, 4.0) + vCol.r * 40.0));
  float rib = 1.0 - smoothstep(0.03, 0.1, a);
  float f = fract(s * 7.0 - a * 2.4);
  float vein = (1.0 - smoothstep(0.04, 0.14, min(f, 1.0 - f))) * (1.0 - smoothstep(0.6, 0.95, a)) * step(0.06, s);
  alb = mix(alb, alb * 1.45 + 0.02, max(rib, vein * 0.5));
  alb = mix(alb, alb * vec3(0.6, 0.5, 0.42), smoothstep(0.75, 1.0, a));
  if (s < 0.0) alb = vec3(0.10, 0.07, 0.045);
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * (0.12 + 0.85 * ndl) + vec3(0.008, 0.011, 0.018));
  vec3 R = reflect(-V, n);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  col += MOON * pow(max(dot(R, uMoon), 0.0), 60.0) * 0.08 + skyPlain(R, uMoon) * fres * 0.5;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const paintLeaves: Paint = (scene, camera, time) => {
  const moon = { value: dirOf(LEAF_MOON.az, LEAF_MOON.el) };
  const flow = { value: 0.25 };
  const spots = { value: Array.from({ length: LEAF_SLOTS }, () => new THREE.Vector4()) };

  // stones at the water's edge on both banks, the same every visit
  const rand = rng(23);
  const stones: number[][] = [];
  for (let i = 0; i < 9; i++) {
    const far = i % 2 === 0;
    stones.push([(rand() - 0.5) * 8, far ? FAR_BANK + 0.1 + rand() * 0.25 : NEAR_BANK - 0.05 + rand() * 0.3, 0.16 + rand() * 0.2, 0.1 + rand() * 0.12]);
  }
  // the banks as far as the camera sees them, at 10 cm, fine enough for the stones' round tops
  const W = 10, D = 10, NX = 100, NZ = 100;
  const banks = new THREE.PlaneGeometry(W, D, NX, NZ);
  banks.rotateX(-Math.PI / 2);
  banks.translate(0, 0, -3.5);
  const bp = banks.attributes.position as THREE.BufferAttribute;
  const onStone = new Float32Array(bp.count);
  for (let i = 0; i < bp.count; i++) {
    const b = bankAt(bp.getX(i), bp.getZ(i), stones);
    bp.setY(i, b.y);
    onStone[i] = b.stone;
  }
  banks.setAttribute('stone', new THREE.BufferAttribute(onStone, 1));
  banks.computeVertexNormals();
  const bank = new THREE.Mesh(banks, new THREE.ShaderMaterial({ vertexShader: BANK_VERT, fragmentShader: BANK_FRAG, uniforms: { uMoon: moon } }));
  const surface = new THREE.PlaneGeometry(W, NEAR_BANK - FAR_BANK + 1.2, 1, 1);
  surface.rotateX(-Math.PI / 2);
  surface.translate(0, 0, (NEAR_BANK + FAR_BANK) / 2);
  const water = new THREE.Mesh(surface, new THREE.ShaderMaterial({ vertexShader: WORLD_VERT, fragmentShader: WATER_FRAG, uniforms: { uTime: time, uMoon: moon, uFlow: flow, uLeaf: spots } }));
  const leaves = new THREE.InstancedMesh(leafGeometry(), new THREE.ShaderMaterial({ vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG, uniforms: { uMoon: moon }, side: THREE.DoubleSide }), LEAF_SLOTS);
  leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  leaves.frustumCulled = false;
  for (let i = 0; i < LEAF_SLOTS; i++) leaves.setColorAt(i, LEAF_COLOURS[0]);
  scene.add(bank, water, leaves);

  const look = new THREE.Vector3();
  /** how far out along x a leaf on each lane starts and ends, so it floats in from beyond the frame and out again */
  const reach = LANES.map(() => 4);
  const leafOf = (n: number) => ({
    lane: ((n % LANES.length) + LANES.length) % LANES.length,
    z: LANES[((n % LANES.length) + LANES.length) % LANES.length] + (hash(n + 0.7) - 0.5) * 0.3,
    size: 0.5 + 0.12 * hash(n + 1.9),
    turn: hash(n + 3.3) * Math.PI * 2,
    spin: (hash(n + 5.1) - 0.5) * 0.24,
    colour: LEAF_COLOURS[Math.floor(hash(n + 8.7) * LEAF_COLOURS.length)],
  });
  const aim = (t: number) => {
    camera.position.set(0.04 * Math.sin(t * 0.04), 3.1 + 0.02 * Math.sin(t * 0.06), 2.5);
    camera.lookAt(look.set(0.06 * Math.sin(t * 0.04 + 0.5), 0, -1.9));
    camera.updateMatrixWorld();
  };
  const place = (n: number, u: number, out: THREE.Vector3) => {
    const l = leafOf(n);
    const x = reach[l.lane];
    return out.set(-x + 2 * x * u, 0.01, l.z + 0.12 * Math.sin(u * 4.1 + n));
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), at = new THREE.Vector3();
  return {
    pose(t, on) {
      aim(t);
      let k = 0;
      for (let i = 0; i < LEAF_SLOTS; i++) {
        const it = on[i];
        spots.value[i].w = 0;
        if (!it) continue;
        const l = leafOf(it.n);
        place(it.n, it.u, at);
        at.y = 0.012 + 0.006 * Math.sin(t * 1.3 + it.n);
        e.set(0.05 * Math.sin(t * 0.9 + it.n * 2.0), l.turn + l.spin * t, 0.04 * Math.sin(t * 1.1 + it.n), 'YXZ');
        q.setFromEuler(e);
        m.compose(at, q, sc.setScalar(l.size));
        leaves.setMatrixAt(k, m);
        leaves.setColorAt(k, l.colour);
        spots.value[i].set(at.x, at.z, l.size * 0.55, 1);
        k++;
      }
      leaves.count = k;
      leaves.instanceMatrix.needsUpdate = true;
      if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    },
    where: (n, u, out) => place(n, u, out),
    resize() {
      aim(0);
      const p = new THREE.Vector3();
      // a point's place across the frame grows in step with x along a lane, the camera looking straight across the stream
      LANES.forEach((z, i) => (reach[i] = 1.3 / (p.set(1, 0.01, z).project(camera).x - p.set(0, 0.01, z).project(camera).x)));
      // the water flows at the leaves' mean pace
      flow.value = reach.reduce((a, x) => a + 2 * x, 0) / LANES.length / LEAVES.crossSec;
    },
  };
};

// ----------------------------------------------------------------

/** each picture, and how far across its thought 0 is in the still frame */
const PICTURES: Record<ThoughtPic, { paint: Paint; at: number }> = {
  clouds: { paint: paintClouds, at: 0.42 },
  cars: { paint: paintCars, at: 0.55 },
  leaves: { paint: paintLeaves, at: 0.5 },
};

export const build: BuildScene = (_accent, opts) => {
  const pic = opts.input as ThoughtPic;
  const { paint, at } = PICTURES[pic];
  const pace = THOUGHTS[pic];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1200);
  const time = { value: 0 };
  const picture = paint(scene, camera, time);
  /** the picture, and the thoughts on their way as "n:x:y", thought n at (x, y) in the frame (-1 to 1 each way) */
  const probe: Record<string, number | string> = { pic, things: '', ...picture.probe };
  const p = new THREE.Vector3();
  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const t = still ? STILL_T : Math.max(0, b.e);
      time.value = t;
      const on = passing(pace, at, t);
      picture.pose(t, on);
      camera.updateMatrixWorld();
      probe.things = on.map(({ n, u }) => (picture.where(n, u, p).project(camera), `${n}:${p.x.toFixed(3)}:${p.y.toFixed(3)}`)).join(' ');
      Object.assign(probe, picture.probe);
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      picture.resize(width, height);
    },
  };
};
