import * as THREE from 'three';
import { CLOUDS } from '../../../motion/tokens';
import { backdrop, NIGHT_GLSL, OUT_GLSL } from '../common';
import type { BuildScene } from '../runtime';

/**
 * A gentle tide on a quiet moonlit shore, seen low from the sand. Every PERIOD seconds a small soft wave comes in as a
 * thin foam line, washes up the beach in a thin sheet, slows, and slides back, leaving the sand dark and wet where it
 * reached; the wet sand catches the moon and slowly dries. Further out the sea is calm, with the moon's path on it and a
 * soft mist far out. Nothing crashes and nothing chases: the water simply comes and goes. The moon is the only light.
 * When the step's thoughts are clouds, a few soft clouds drift in overhead, cross the sky and drift out, the way the
 * words ask: lit from behind by the moon, silver where they thin near it, and the moon and its light on the water dim
 * while one passes. Other steps keep the clear sky.
 */

/** what the tide's step tells it: whether its thoughts are clouds */
interface TideInput {
  clouds?: boolean;
}

const FOV = 36;
/** one wash up the beach and back every PERIOD seconds */
const PERIOD = 9;
/** the share of each wash spent coming in; the rest is the slower slide back */
const UP = 0.36;
/** where the water's edge rests, where the sand meets the sea, and how far a wash reaches past its rest */
const LOW = -1.5;
const SEA = -1.6;
const REACH = 3.2;
/** the beach rises gently towards the viewer */
const SLOPE = 0.03;
const MOON_DIR = new THREE.Vector3(0.14, 0.123, -1).normalize();
/** reduced motion shows the moment just after a wash has turned, the wet sand still bright */
const STILL_T = PERIOD * 0.52;
const DEG = Math.PI / 180;
const MOON_AZ = Math.atan2(MOON_DIR.x, -MOON_DIR.z);
const MOON_EL = Math.asin(MOON_DIR.y);
/** the slots for the clouds in the sky at once: one comes in every spaceSec and takes crossSec to cross */
const CLOUD_SLOTS = Math.ceil(CLOUDS.crossSec / CLOUDS.spaceSec);
/** where the cloud in the still frame is: a little left of the middle of the sky (in half widths of the frame) */
const STILL_X = -0.15;
/** how far past the frame's edge a cloud starts and ends its crossing, so it drifts in and out rather than appearing */
const CLOUD_MARGIN = 9 * DEG;
/** the most of the moon's light a cloud holds back: the clouds are thin, so the moon only dims */
const CLOUD_COVER = 0.65;

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
};
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const easeInOut = (x: number) => x * x * (3 - 2 * x);

/** How far wash k reaches (its share of REACH): each a little different, never more than the last by much. */
const reachOf = (k: number) => 0.72 + 0.28 * hash(k);
/** 0..1 how far up the beach the water is u of the way through a wash: in quickly, slowing, then sliding back */
const washAt = (u: number) => (u < UP ? easeOut(u / UP) : 1 - easeInOut((u - UP) / (1 - UP)));

/**
 * Cloud n: its height and size (half width and half height) in radians, and the seed of its shape. Each third one
 * crosses at the moon's height and the others just below and above it, so one passes the moon about once a minute.
 */
const cloudOf = (n: number) => ({
  el: ([6.6, 4.3, 8.5][((n % 3) + 3) % 3] + (hash(n + 0.5) - 0.5) * 0.8) * DEG,
  rx: (6 + 2.5 * hash(n + 1.3)) * DEG,
  ry: (2.4 + 0.6 * hash(n + 2.9)) * DEG,
  seed: hash(n + 4.1) * 40,
});
/** how much of the moon's light cloud n holds back when it is at azimuth az: its shape in the sky, without the noise */
function coverOf(n: number, az: number) {
  const c = cloudOf(n);
  const qx = (MOON_AZ - az) / c.rx, qy = (MOON_EL - c.el) / c.ry;
  const r = Math.hypot(qx, qy < 0 ? qy * 1.6 : qy);
  return CLOUD_COVER * (1 - easeInOut(Math.min(1, Math.max(0, (r - 0.3) / 0.75))));
}

/** Where the water's edge is at x and time t (its z; bigger is further up the beach, towards the viewer). */
function edgeAt(x: number, t: number) {
  const k = Math.floor(t / PERIOD);
  const s = washAt(t / PERIOD - k) * reachOf(k);
  return LOW + REACH * s * (1 + 0.1 * Math.sin(x * 1.3 + k * 1.7)) + 0.12 * s * Math.sin(x * 2.9 + k * 3.1);
}

const SHORE_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float r = w.z - ${SEA.toFixed(3)};
  w.y = ${SLOPE.toFixed(4)} * 0.5 * (r + sqrt(r * r + 0.05));
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHORE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMoon;
uniform vec4 uWash;
uniform vec2 uPrev;
/** how much of the moon's light gets past the clouds */
uniform float uLit;
varying vec3 vWorld;
${NIGHT_GLSL}
const float PERIOD = ${PERIOD.toFixed(3)};
const float LOW = ${LOW.toFixed(3)};
const float SEA = ${SEA.toFixed(3)};
const float REACH = ${REACH.toFixed(3)};
const float UP = ${UP.toFixed(3)};
/** the water's edge at x for a wash reaching s of REACH (wash k), as in edgeAt */
float edge(float x, float s, float k) { return LOW + REACH * s * (1.0 + 0.1 * sin(x * 1.3 + k * 1.7)) + 0.12 * s * sin(x * 2.9 + k * 3.1); }
/** soft ripple marks in the sand and a fine grain */
float sandH(vec2 p) {
  float warp = noise2(p * 0.6) * 2.2;
  return 0.006 * pow(0.5 + 0.5 * sin(p.y * 7.0 + p.x * 0.8 + warp), 2.0) + 0.0005 * noise2(p * 30.0);
}
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float dist = length(cameraPosition - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float near = 1.0 - smoothstep(3.0, 9.0, dist);
  // uWash: x = how far up this wash is now (0..1 of REACH), y = its number, z = how far up it has reached, w = seconds
  // since it turned back (below 0 while still coming in); uPrev: how far the wash before reached and seconds since it turned
  float now = edge(p.x, uWash.x, uWash.y);
  float top = edge(p.x, uWash.z, uWash.y);
  float topPrev = edge(p.x, uPrev.x, uWash.y - 1.0);

  // sand: pale, moonlit, darker and glossier where the water has been
  float e = 0.012;
  float h0 = sandH(p);
  vec3 n = normalize(vec3(-(sandH(p + vec2(e, 0.0)) - h0) / e * near, 1.0, -(sandH(p + vec2(0.0, e)) - h0) / e * near + 0.03));
  float grain = 0.93 + 0.1 * noise2(p * 18.0) * near + 0.1 * noise2(p * 2.6);
  vec3 dry = vec3(0.50, 0.46, 0.39) * grain;
  // wet where the last two washes reached, drying slowly after each turned; always wet down by the sea
  float wet = mix(0.4, 1.0, exp(-max(uWash.w, 0.0) / 5.0)) * (1.0 - smoothstep(top - 0.3, top + 0.02, p.y));
  wet = max(wet, mix(0.4, 1.0, exp(-uPrev.y / 5.0)) * (1.0 - smoothstep(topPrev - 0.3, topPrev + 0.02, p.y)));
  wet = max(wet, 1.0 - smoothstep(LOW - 0.2, LOW + 0.6, p.y));
  vec3 alb = mix(dry, vec3(0.20, 0.19, 0.17) * grain, wet);
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * (0.14 + 0.6 * ndl) * 0.55 * mix(0.75, 1.0, uLit) + vec3(0.006, 0.009, 0.016));
  // wet sand is a rough mirror: the sky in it and a long soft glint of the moon
  vec3 R = reflect(-V, normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.6)));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  float md = max(dot(R, uMoon), 0.0);
  col += wet * ((skyDome(R, uMoon, t, 0.0) + moonHalo(R, uMoon) * 0.3 * uLit) * fres * 0.6 + MOON * (pow(md, 260.0) * 0.22 + pow(md, 36.0) * 0.012) * uLit);

  // water: the thin sheet of the wash on the sand, and the sea beyond
  float under = 1.0 - smoothstep(now - 0.015, now + 0.015, p.y);
  float sea = 1.0 - smoothstep(SEA - 0.4, SEA + 0.15, p.y);
  float water = max(under, sea);
  if (water > 0.0) {
    float depth = clamp((now - p.y) * 0.35, 0.0, 1.0);
    vec2 g = ripples(p, t) * mix(0.2, 0.8, sea) * mix(0.35, 1.0, near);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 Rw = reflect(-V, N);
    Rw.y = abs(Rw.y);
    float fw = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    float mw = max(dot(Rw, uMoon), 0.0);
    float rough = mix(1.0, 0.3, smoothstep(4.0, 26.0, dist));
    vec3 deep = vec3(0.0011, 0.0030, 0.0068);
    // the sheet is so thin the wet sand shows through it, darker and bluer as it deepens towards the sea
    vec3 body = mix(alb * (MOONLIGHT * 0.06 + vec3(0.004, 0.007, 0.013)) * vec3(0.7, 0.85, 1.0), deep, max(depth, sea));
    vec3 wcol = mix(body, skyDome(Rw, uMoon, t, 0.0) + moonHalo(Rw, uMoon) * 0.3 * uLit, fw) + MOON * (pow(mw, 1800.0 * rough) * 2.0 + pow(mw, 140.0 * rough) * 0.014) * uLit;

    // foam: a thin line along the edge, lace on the sheet that thins as the water slides back
    float lace = fbm2(vec2(p.x * 2.2, p.y * 3.2) + vec2(0.0, uWash.y * 3.7));
    float rim = exp(-pow((now - p.y) / 0.07, 2.0)) * (0.55 + 0.45 * noise2(vec2(p.x * 7.0, uWash.y)));
    float coming = uWash.w < 0.0 ? 1.0 : exp(-uWash.w / 2.5);
    float sheet = smoothstep(0.58, 0.66, lace) * (1.0 - smoothstep(0.66, 0.78, lace)) * smoothstep(now - 1.4, now - 0.1, p.y) * (0.35 + 0.65 * coming) * under;
    // the next small wave coming in while this one slides back: a soft foam line moving slowly towards the shore
    float v = clamp(((uWash.w / PERIOD + UP) - 0.5) / 0.5, 0.0, 1.0);
    float zf = SEA - 5.0 + (LOW - SEA + 5.0) * v * v;
    float incoming = exp(-pow((p.y - zf - 0.08 * sin(p.x * 1.1 + uWash.y)) / 0.1, 2.0)) * smoothstep(0.0, 0.35, v) * step(0.0, uWash.w) * (0.4 + 0.6 * noise2(vec2(p.x * 3.0, uWash.y * 2.0)));
    float foam = clamp(rim * (0.5 + 0.5 * coming) + sheet * 0.7 + incoming * 0.6 * sea, 0.0, 1.0) * mix(0.4, 1.0, near);
    wcol = mix(wcol, MOONLIGHT * 0.11 + vec3(0.01, 0.014, 0.02), foam * 0.8);
    col = mix(col, wcol, water);
  }

  // far out the sea fades into a soft mist along the horizon
  vec3 hz = normalize(vec3(-V.x, 0.0, -V.z));
  float mist = smoothstep(10.0, 55.0, dist) * (0.75 + 0.25 * fbm2(p * 0.06 + vec2(t * 0.01, 0.0)));
  col = mix(col, skyDome(hz, uMoon, t, 0.0) + moonHalo(hz, uMoon) * uLit + vec3(0.002, 0.004, 0.007), mist);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/**
 * The night sky with the tide's clouds: each a soft heap, rounded on top and flatter underneath, its edge broken up by
 * slow noise. The low moon lights them from behind and the side: a soft blue-grey, lighter towards the moon and on top,
 * silver where they thin near it, and where one covers the moon its light comes through as a soft patch. uLit is how
 * much of the moon's light gets past them, for its halo.
 */
const SKY_FRAG = /* glsl */ `
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
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyDome(d, uMoon, uTime, 1.0) + moonHalo(d, uMoon) * uLit;
  // how much of what is behind the clouds they hide here
  float cover = 0.0;
  if (d.y > -0.02) {
    float az = atan(d.x, -d.z), el = asin(clamp(d.y, -1.0, 1.0));
    float a = acos(clamp(dot(d, uMoon), -1.0, 1.0));
    for (int i = 0; i < ${CLOUD_SLOTS}; i++) {
      vec4 c = uCloud[i];
      vec2 q = vec2((az - c.x) / c.z, (el - c.y) / c.w);
      if (uShape[i].y <= 0.0 || abs(q.x) > 1.6 || abs(q.y) > 1.8) continue;
      float r = length(vec2(q.x, q.y < 0.0 ? q.y * 1.6 : q.y));
      // lobes about 1.6 degrees across, the same each way, so the heaps are round rather than streaked
      float n = heap(vec2(az - c.x, el - c.y) / 0.028 + uShape[i].x + vec2(0.0, uTime * 0.008));
      float dens = smoothstep(0.0, 0.7, 1.0 - r + (n - 0.5) * 1.3);
      float toward = exp(-a / 0.35);
      float lining = (exp(-a / 0.05) + 0.3 * exp(-a / 0.16)) * pow(1.0 - dens, 1.4);
      float through = exp(-a / 0.04) * dens;
      vec3 body = MOONLIGHT * (0.042 + 0.06 * toward) * (0.75 + 0.25 * clamp(q.y * 0.5 + 0.5, 0.0, 1.0)) + MOON * (0.32 * lining + 0.5 * through);
      float alpha = dens * 0.85;
      col = mix(col, body, alpha);
      cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
    }
  }
  // the moon's disc is behind them: a thin edge lets it show, silvered, and a thick middle only its light
  col += moonDisc(d, uMoon) * (1.0 - smoothstep(0.2, 0.85, cover));
  // a whisper of noise, so the deep gradient never shows steps
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0009;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

export const build: BuildScene = (_accent, opts) => {
  const cloudy = (opts.input as TideInput | undefined)?.clouds === true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 120);
  const look = new THREE.Vector3();
  const time = { value: 0 };
  const moon = { value: MOON_DIR.clone() };
  const wash = { value: new THREE.Vector4() };
  const before = { value: new THREE.Vector2() };
  const lit = { value: 1 };
  const clouds = { value: Array.from({ length: CLOUD_SLOTS }, () => new THREE.Vector4()) };
  const shapes = { value: Array.from({ length: CLOUD_SLOTS }, () => new THREE.Vector2()) };
  /** the frame's half width as an angle, and how far a cloud travels either side of the middle to come in and go out */
  let half = (FOV / 2) * DEG;
  let drift = half + CLOUD_MARGIN;

  // the shore: a grid that is fine near the viewer and coarser towards the horizon
  const geo = new THREE.PlaneGeometry(1, 1, 120, 150);
  geo.rotateX(-Math.PI / 2);
  const gp = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < gp.count; i++) {
    const u = gp.getX(i), v = gp.getZ(i) + 0.5;
    const z = 4.2 - 74.2 * Math.pow(1 - v, 2.2);
    gp.setXYZ(i, u * (7 + (4.2 - z) * 1.5), 0, z);
  }
  const shore = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: SHORE_VERT, fragmentShader: SHORE_FRAG, uniforms: { uTime: time, uMoon: moon, uWash: wash, uPrev: before, uLit: lit } }));
  shore.frustumCulled = false;
  scene.add(backdrop(camera, SKY_FRAG, { uTime: time, uMoon: moon, uLit: lit, uCloud: clouds, uShape: shapes }), shore);

  /** the clouds up now, as "n:x" for cloud n at x half widths from the middle of the frame, and the moon's light */
  const probe = { shore: LOW, clouds: '', moon: 1 };
  /** when cloud n comes in from the left, so that cloud 0 is at STILL_X in the still frame */
  const startOf = (n: number) => n * CLOUDS.spaceSec + STILL_T - (CLOUDS.crossSec * (drift + STILL_X * half)) / (2 * drift);

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const t = still ? STILL_T : Math.max(0, b.e);
      const k = Math.floor(t / PERIOD);
      const u = t / PERIOD - k;
      const reach = reachOf(k);
      // how far up the water is now, and how far it got before it turned (only known once it has turned)
      wash.value.set(washAt(u) * reach, k, u >= UP ? reach : washAt(u) * reach, u >= UP ? (u - UP) * PERIOD : -1);
      before.value.set(k > 0 ? reachOf(k - 1) : 0, (u + 1 - UP) * PERIOD);
      camera.position.set(0.1 * Math.sin(t * 0.04), 0.75 + 0.02 * Math.sin(t * 0.07), 3.6);
      look.set(0.08 * Math.sin(t * 0.04 + 0.6), 0, -4);
      camera.lookAt(look);
      camera.updateMatrixWorld();
      time.value = t;

      const last = Math.floor((t - startOf(0)) / CLOUDS.spaceSec);
      const up: string[] = [];
      let light = 1;
      for (let i = 0; i < CLOUD_SLOTS; i++) {
        const n = last - i;
        const age = t - startOf(n);
        const on = cloudy && age >= 0 && age < CLOUDS.crossSec;
        const az = -drift + (2 * drift * age) / CLOUDS.crossSec;
        const c = cloudOf(n);
        clouds.value[i].set(az, c.el, c.rx, c.ry);
        shapes.value[i].set(c.seed, on ? 1 : 0);
        if (!on) continue;
        light = Math.min(light, 1 - coverOf(n, az));
        up.push(`${n}:${(az / half).toFixed(3)}`);
      }
      lit.value = light;
      Object.assign(probe, { shore: edgeAt(0, t), clouds: up.join(' '), moon: light });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      half = Math.atan(Math.tan((FOV / 2) * DEG) * camera.aspect);
      drift = half + CLOUD_MARGIN;
    },
  };
};
