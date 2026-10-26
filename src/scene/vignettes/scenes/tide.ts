import * as THREE from 'three';
import { NIGHT_GLSL, nightBackdrop, OUT_GLSL } from '../common';
import type { Beat } from '../host';
import type { BuildScene } from '../runtime';

/**
 * A gentle tide on a quiet moonlit shore, seen low from the sand. Every PERIOD seconds a small soft wave comes in as a
 * thin foam line, washes up the beach in a thin sheet, slows, and slides back, leaving the sand dark and wet where it
 * reached; the wet sand catches the moon and slowly dries. Further out the sea is calm, with the moon's path on it and a
 * soft mist far out. Nothing crashes and nothing chases: the water simply comes and goes. The moon is the only light.
 */

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
  float wet = mix(0.4, 1.0, exp(-max(uWash.w, 0.0) / 5.0)) * smoothstep(top + 0.02, top - 0.3, p.y);
  wet = max(wet, mix(0.4, 1.0, exp(-uPrev.y / 5.0)) * smoothstep(topPrev + 0.02, topPrev - 0.3, p.y));
  wet = max(wet, smoothstep(LOW + 0.6, LOW - 0.2, p.y));
  vec3 alb = mix(dry, vec3(0.20, 0.19, 0.17) * grain, wet);
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * (0.14 + 0.6 * ndl) * 0.55 + vec3(0.006, 0.009, 0.016));
  // wet sand is a rough mirror: the sky in it and a long soft glint of the moon
  vec3 R = reflect(-V, normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.6)));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  float md = max(dot(R, uMoon), 0.0);
  col += wet * ((skyDome(R, uMoon, t, 0.0) + moonHalo(R, uMoon) * 0.3) * fres * 0.6 + MOON * (pow(md, 260.0) * 0.22 + pow(md, 36.0) * 0.012));

  // water: the thin sheet of the wash on the sand, and the sea beyond
  float under = smoothstep(now + 0.015, now - 0.015, p.y);
  float sea = smoothstep(SEA + 0.15, SEA - 0.4, p.y);
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
    vec3 wcol = mix(body, skyDome(Rw, uMoon, t, 0.0) + moonHalo(Rw, uMoon) * 0.3, fw) + MOON * (pow(mw, 1800.0 * rough) * 2.0 + pow(mw, 140.0 * rough) * 0.014);

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
  col = mix(col, skyDome(hz, uMoon, t, 0.0) + moonHalo(hz, uMoon) + vec3(0.002, 0.004, 0.007), mist);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

export const build: BuildScene = () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 120);
  const look = new THREE.Vector3();
  const time = { value: 0 };
  const moon = { value: MOON_DIR.clone() };
  const wash = { value: new THREE.Vector4() };
  const before = { value: new THREE.Vector2() };

  // the shore: a grid that is fine near the viewer and coarser towards the horizon
  const geo = new THREE.PlaneGeometry(1, 1, 120, 150);
  geo.rotateX(-Math.PI / 2);
  const gp = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < gp.count; i++) {
    const u = gp.getX(i), v = gp.getZ(i) + 0.5;
    const z = 4.2 - 74.2 * Math.pow(1 - v, 2.2);
    gp.setXYZ(i, u * (7 + (4.2 - z) * 1.5), 0, z);
  }
  const shore = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: SHORE_VERT, fragmentShader: SHORE_FRAG, uniforms: { uTime: time, uMoon: moon, uWash: wash, uPrev: before } }));
  shore.frustumCulled = false;
  scene.add(nightBackdrop(camera, moon, time), shore);

  // more time after Done picks the tide up where it stopped instead of jumping ahead
  let gap = 0;
  let prev: Beat | null = null;
  const probe = { t: 0, shore: LOW };

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const e = Math.max(0, b.e);
      if (prev?.done && !b.done) gap += Math.max(0, e - prev.e);
      prev = { ...b };
      const t = still ? STILL_T : e - gap;
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
      Object.assign(probe, { t, shore: edgeAt(0, t) });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  };
};
