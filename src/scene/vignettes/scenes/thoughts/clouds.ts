import * as THREE from 'three';
import { smoothstep } from '../../../../core/math';
import { THOUGHTS } from '../../../../motion/tokens';
import { backdrop, hash, NIGHT_GLSL, OUT_GLSL } from '../../common';
import { DEG, dirOf, FOV, type Paint } from './picture';

const CLOUDS = THOUGHTS.clouds;
const CLOUD_SLOTS = Math.ceil(CLOUDS.crossSec / CLOUDS.spaceSec);
const SKY_PITCH = 12 * DEG;
const SKY_MOON = { az: 7 * DEG, el: 23 * DEG };
const CLOUD_COVER = 0.65;

const cloudOf = (n: number) => ({
  el: ([SKY_MOON.el / DEG + 0.4, 13.5, 18.5][((n % 3) + 3) % 3] + (hash(n + 0.5) - 0.5) * 1.2) * DEG,
  rx: (9.5 + 3 * hash(n + 1.3)) * DEG,
  ry: (3.2 + 0.8 * hash(n + 2.9)) * DEG,
  seed: hash(n + 4.1) * 40,
});

function coverOf(n: number, az: number) {
  const c = cloudOf(n);
  const qx = (SKY_MOON.az - az) / c.rx, qy = (SKY_MOON.el - c.el) / c.ry;
  const r = Math.hypot(qx, qy < 0 ? qy * 1.6 : qy);
  return CLOUD_COVER * (1 - smoothstep(0.3, 1.05, r));
}

const CLOUD_SKY_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMoon;
uniform float uLit;
uniform vec4 uCloud[${CLOUD_SLOTS}];
uniform vec2 uShape[${CLOUD_SLOTS}];
varying vec3 vDir;
${NIGHT_GLSL}
float heap(vec2 p) {
  p += vec2(noise2(p * 0.7 + 1.3), noise2(p * 0.7 + 8.1)) * 0.6;
  vec2 a = mat2(0.8, -0.6, 0.6, 0.8) * p, b = mat2(-0.5, -0.866, 0.866, -0.5) * p + 3.7;
  return (noise2(a) + noise2(b)) * 0.325 + (noise2(a * 2.03 + 5.2) + noise2(b * 1.97 + 1.1)) * 0.175;
}
float ridgeTop(float az, float k) {
  float x = az * (4.5 + 3.5 * k) + k * 11.7;
  float h = noise1(x) * 0.62 + noise1(x * 2.3 + 1.7) * 0.28 + noise1(x * 5.1 + 4.2) * 0.1;
  return mix(0.088, 0.004, k * 0.5) + (h - 0.5) * mix(0.04, 0.05, k * 0.5);
}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyDome(d, uMoon, uTime, 1.0) + moonHalo(d, uMoon) * uLit;
  float az = atan(d.x, -d.z), el = asin(clamp(d.y, -1.0, 1.0));
  float cover = 0.0;
  if (el > 0.1) {
    float a = acos(clamp(dot(d, uMoon), -1.0, 1.0));
    for (int i = 0; i < ${CLOUD_SLOTS}; i++) {
      vec4 c = uCloud[i];
      vec2 q = vec2((az - c.x) / c.z, (el - c.y) / c.w);
      if (uShape[i].y <= 0.0 || abs(q.x) > 1.7 || abs(q.y) > 1.9) continue;
      float r = length(vec2(q.x, q.y < 0.0 ? q.y * 1.6 : q.y));
      float n = heap(vec2(az - c.x, el - c.y) / 0.036 + uShape[i].x + vec2(0.0, uTime * 0.008));
      float dens = smoothstep(0.0, 0.7, 1.0 - r + (n - 0.5) * 1.3);
      float toward = exp(-a / 0.35);
      float lining = (exp(-a / 0.05) + 0.3 * exp(-a / 0.16)) * pow(1.0 - dens, 1.4);
      float through = exp(-a / 0.04) * dens;
      float up = clamp(q.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 body = MOONLIGHT * (0.05 + 0.085 * toward) * (0.62 + 0.38 * up)
        * (1.0 - 0.25 * smoothstep(0.6, 1.0, dens) * (1.0 - up))
        + MOON * (0.32 * lining + 0.5 * through) * uLit;
      float alpha = dens * 0.85;
      col = mix(col, body, alpha);
      cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
    }
  }
  col += moonDisc(d, uMoon) * (1.0 - smoothstep(0.2, 0.85, cover));

  float px = max(fwidth(el), 1e-4);
  vec2 side = normalize(d.xz + 1e-5), mside = normalize(uMoon.xz + 1e-5);
  float toMoon = pow(max(dot(side, mside), 0.0), 6.0);
  vec3 mist = NIGHT_LOW * 1.15 + vec3(0.0035, 0.0075, 0.016) * (0.55 + 0.8 * toMoon) * mix(0.6, 1.0, uLit);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float top = ridgeTop(az, fk);
    float on = 1.0 - smoothstep(top - px, top + px, el);
    if (on <= 0.0) continue;
    vec3 dark = fk < 0.5 ? vec3(0.0062, 0.0128, 0.0285)
      : fk < 1.5 ? vec3(0.0030, 0.0055, 0.0120)
      : vec3(0.0012, 0.0015, 0.0028);
    float veil = smoothstep(0.004, 0.03, top - el) * (fk < 1.5 ? 0.9 : 0.0);
    vec3 hill = mix(dark, mist, veil);
    hill += MOONLIGHT * exp(-(top - el) / (px * 1.6)) * (0.004 + 0.016 * toMoon) * uLit * (1.0 - fk * 0.3);
    col = mix(col, hill, on);
  }
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0009;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

export const paintClouds: Paint = (scene, camera, time) => {
  const moon = { value: dirOf(SKY_MOON.az, SKY_MOON.el) };
  const lit = { value: 1 };
  const clouds = { value: Array.from({ length: CLOUD_SLOTS }, () => new THREE.Vector4()) };
  const shapes = { value: Array.from({ length: CLOUD_SLOTS }, () => new THREE.Vector2()) };
  scene.add(backdrop(camera, CLOUD_SKY_FRAG, { uTime: time, uMoon: moon, uLit: lit, uCloud: clouds, uShape: shapes }));
  const look = new THREE.Vector3();
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
