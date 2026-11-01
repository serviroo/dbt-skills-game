import * as THREE from 'three';
import { NOISE_GLSL, OUT_GLSL, pointScale, rng } from '../common';
import { breathAt, ease, SETTLE } from '../../../motion/breath';
import type { BuildScene } from '../runtime';

/**
 * The breathing light: a small light floating in deep blue space, in the player's own accent colour. It swells for 4
 * seconds and eases for 6, the same breath as Give me a moment's ring, from the timer's own clock. A few motes are drawn
 * in towards it on the in-breath and drift back out on the out-breath, lit by it. The light is the only light: a small
 * white-hot core inside a soft halo of its colour that is gone by about half the ring, so the deep blue around it stays
 * dark (a countdown sits below it, on the dark, never on the light).
 */

const FOV = 30;
/** the light's size breathed out and breathed in (the probe's scale) */
const SMALL = 0.5;
const BIG = 0.7;
/** the light's square, in world units from its middle: the halo is gone well inside it */
const REACH = 0.62;
const DIST = 4;

const LIGHT_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vP;
void main() {
  // a square always facing the camera, round the light's middle
  vP = position.xy * uSize;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += vP;
  gl_Position = projectionMatrix * mv;
}`;
/**
 * The light, in linear colour: a small hot core, white in the middle and tinted at its edge, inside a glow that falls off
 * steeply near the core and softly further out, like a lamp seen through a little haze, gone by `reach`. Slow light moves
 * in the glow, never in the core. Bright values roll off to white instead of clipping, the way a hot light looks.
 */
const LIGHT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uBreath;
uniform float uTime;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  float s = uBreath;
  float r = length(vP);
  float rc = 0.045 + 0.025 * s;
  float core = exp(-r * r / (rc * rc));
  float reach = 0.36 + 0.2 * s;
  float r1 = 0.07 + 0.04 * s;
  float glow = (1.0 - smoothstep(reach * 0.6, reach, r)) / (1.0 + r * r / (r1 * r1));
  float halo = exp(-r / (0.11 + 0.05 * s)) * (1.0 - smoothstep(reach * 0.45, reach, r));
  float c = cos(uTime * 0.03), sn = sin(uTime * 0.03);
  vec2 q = mat2(c, -sn, sn, c) * vP * 7.0;
  float wisp = 0.82 + 0.36 * noise2(q + vec2(0.0, -uTime * 0.1)) * smoothstep(0.0, 0.12, r);
  vec3 x = uColor * (2.2 * core + (0.55 * glow + 0.18 * halo) * wisp) * (0.75 + 0.25 * s) + vec3(1.4 * core * core * (0.8 + 0.2 * s));
  gl_FragColor = vec4(1.0 - exp(-x), 1.0);
  ${OUT_GLSL}
}`;

const SPACE_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;
/** deep blue space: a little lighter and tinted near the light, a faint violet glow further out, far specks */
const SPACE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uBreath;
uniform float uAspect;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  vec2 p = vP * vec2(uAspect, 1.0);
  float r = length(p);
  vec3 col = mix(vec3(0.0030, 0.0042, 0.0105), vec3(0.0021, 0.0024, 0.0052), smoothstep(0.0, 1.3, r));
  col += uColor * 0.008 * (0.7 + 0.3 * uBreath) * exp(-r * 3.0);
  col += vec3(0.022, 0.006, 0.060) * 0.05 * smoothstep(0.35, 0.95, noise2(p * 1.4 + 4.0)) * smoothstep(0.4, 1.0, r);
  vec2 g = floor(p * 26.0);
  float s = step(0.985, hash2(g)) * (1.0 - smoothstep(0.0, 0.32, length(fract(p * 26.0) - 0.5 - 0.3 * (hash22(g) - 0.5))));
  col += vec3(0.4, 0.5, 0.7) * s * 0.05 * (0.3 + 0.7 * hash2(g + 1.7));
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0008;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const MOTE_VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform float uBreath;
uniform float uScale;
varying float vA;
void main() {
  // each mote keeps its own direction from the light and its own distance, nearer on the in-breath
  float spin = uTime * (0.025 + 0.03 * seed.x);
  float c = cos(spin), s = sin(spin);
  vec3 d = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
  float r = mix(0.3, 1.05, seed.y) * (1.0 - 0.22 * uBreath) + 0.03 * sin(uTime * 0.3 + seed.z * 6.2831);
  vec4 mv = modelViewMatrix * vec4(d * r, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale * (0.012 + 0.016 * seed.w) / -mv.z);
  // lit by the light: bright near it, faint further out
  vA = (0.35 + 0.65 * seed.w) * (0.6 + 0.4 * uBreath) * (0.12 + 0.88 / (1.0 + r * r / 0.06)) * (1.0 - smoothstep(0.8, 1.15, r));
}`;
const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float a = (1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5))) * vA;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.45) * 0.55 * a, 1.0);
  ${OUT_GLSL}
}`;

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
  const color = { value: accent.clone() };
  const breath = { value: 0 };
  const time = { value: 0 };
  const scale = { value: 600 };
  const aspect = { value: 1 };

  const space = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: SPACE_VERT, fragmentShader: SPACE_FRAG, uniforms: { uColor: color, uBreath: breath, uAspect: aspect }, depthTest: false, depthWrite: false }));
  space.frustumCulled = false;
  space.renderOrder = -1;

  const light = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG, uniforms: { uColor: color, uBreath: breath, uTime: time, uSize: { value: REACH } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  light.frustumCulled = false;
  light.renderOrder = 2;

  const rand = rng(23);
  const n = 46;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(a), z * 0.8, r * Math.sin(a)], i * 3);
    seed.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const motes = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { uTime: time, uBreath: breath, uScale: scale, uColor: color }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false;
  motes.renderOrder = 3;

  // the light shows the player's colour as it is and rolls off to white on its own, so it takes no tone curve, which
  // would bend the hue
  for (const m of [light.material, motes.material]) m.toneMapped = false;
  scene.add(space, light, motes);
  const probe = { scale: SMALL, breath: 0 };

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      // past its end (a timed Give me a moment) the breath settles to the exhale, as the flat ring does, and holds still
      const t = still ? 0 : Math.max(0, Math.min(b.e, b.dur + SETTLE));
      const s = still ? 0.55 : breathAt(t) * (1 - ease((t - b.dur) / SETTLE));
      const r = SMALL + (BIG - SMALL) * s;
      breath.value = s;
      time.value = still ? 12 : t;
      // the camera drifts round the light very slowly, so the motes pass in front and behind
      const a = 0.03 * time.value + 0.4;
      camera.position.set(Math.sin(a) * DIST, 0.35 * Math.sin(0.02 * time.value), Math.cos(a) * DIST);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      Object.assign(probe, { scale: r, breath: s });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      aspect.value = width / height;
      scale.value = pointScale(FOV, height);
    },
  };
};
