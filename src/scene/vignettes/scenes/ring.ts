import * as THREE from 'three';
import { glow, NOISE_GLSL, OUT_GLSL, pointScale, rng } from '../common';
import type { BuildScene } from '../runtime';

/**
 * The breathing light: a soft orb of light floating in deep blue space, in the player's own accent colour. It swells
 * for 4 seconds and eases for 6, the same breath as Give me a moment's ring, from the timer's own clock. A few motes
 * are drawn in towards it on the in-breath and drift back out on the out-breath. The orb is the only light: a glowing
 * body, a little brighter at its edge and moving softly inside, within a wide halo. Its middle stays a calm mid-tone so
 * a countdown on top of it reads.
 */

const FOV = 30;
const INHALE = 4;
const EXHALE = 6;
/** the orb's radius breathed out and breathed in */
const SMALL = 0.5;
const BIG = 0.7;
const DIST = 4;

const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
/** 0..1 breath size at time e: rises over 4 s, falls over 6 s (the same curve as Give me a moment) */
const breathAt = (e: number) => {
  const c = ((e % (INHALE + EXHALE)) + INHALE + EXHALE) % (INHALE + EXHALE);
  return c < INHALE ? ease(c / INHALE) : 1 - ease((c - INHALE) / EXHALE);
};

const ORB_VERT = /* glsl */ `
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
const ORB_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uBreath;
uniform float uTime;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vObj;
${NOISE_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  // a ball of soft light: as bright as the depth of light you look through, so it fades to nothing at its edge
  float depth = max(dot(n, V), 0.0);
  float vol = pow(depth, 2.6);
  // slow light moving inside, like light through frosted glass
  vec3 q = normalize(vObj);
  float wisp = noise3(q * 2.3 + vec3(0.0, uTime * 0.05, uTime * 0.03)) * 0.6 + noise3(q * 4.7 - vec3(uTime * 0.04)) * 0.4;
  vec3 col = uColor * (0.07 + 0.04 * uBreath) * vol * (0.72 + 0.56 * wisp);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const SPACE_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;
/** deep blue space: a little lighter and tinted by the light around the orb, a faint violet glow further out, far specks */
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
  col += uColor * 0.010 * (0.7 + 0.3 * uBreath) * exp(-r * 1.6);
  col += vec3(0.022, 0.006, 0.060) * 0.05 * smoothstep(0.35, 0.95, noise2(p * 1.4 + 4.0)) * smoothstep(0.4, 1.0, r);
  vec2 g = floor(p * 26.0);
  float s = step(0.985, hash2(g)) * smoothstep(0.32, 0.0, length(fract(p * 26.0) - 0.5 - 0.3 * (hash22(g) - 0.5)));
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
  // each mote keeps its own direction from the orb and its own distance, nearer on the in-breath
  float spin = uTime * (0.025 + 0.03 * seed.x);
  float c = cos(spin), s = sin(spin);
  vec3 d = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
  float r = mix(0.95, 1.6, seed.y) * (1.0 - 0.3 * uBreath) + 0.04 * sin(uTime * 0.3 + seed.z * 6.2831);
  vec4 mv = modelViewMatrix * vec4(d * r, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale * (0.012 + 0.016 * seed.w) / -mv.z);
  vA = (0.35 + 0.65 * seed.w) * (0.55 + 0.45 * uBreath) * smoothstep(1.75, 1.0, r);
}`;
const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA;
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

  const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), new THREE.ShaderMaterial({ vertexShader: ORB_VERT, fragmentShader: ORB_FRAG, uniforms: { uColor: color, uBreath: breath, uTime: time }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  orb.renderOrder = 2;
  // the light's two layers around the ball: a soft core inside it and a wide halo far out round it
  const coreI = { value: 0.2 };
  const core = glow({ color: accent.clone().lerp(new THREE.Color(1, 1, 1), 0.25), size: 1, core: 0.42, halo: 0, intensity: coreI });
  const haloI = { value: 0.3 };
  const halo = glow({ color: accent.clone(), size: 2, core: 0.01, halo: 0.9, intensity: haloI });

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

  // the light shows the player's colour as it is: its values stay low, so it needs no tone curve, which would bend the hue
  for (const m of [orb.material, core.material, halo.material, motes.material]) m.toneMapped = false;
  scene.add(space, halo, orb, core, motes);
  const probe = { scale: SMALL, breath: 0 };

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const t = still ? 0 : Math.max(0, b.e);
      const s = still ? 0.55 : breathAt(t);
      const r = SMALL + (BIG - SMALL) * s;
      orb.scale.setScalar(r);
      core.material.uniforms.uSize.value = r * 1.1;
      coreI.value = 0.07 + 0.05 * s;
      halo.material.uniforms.uSize.value = r * 3.4;
      haloI.value = 0.16 + 0.1 * s;
      breath.value = s;
      time.value = still ? 12 : t;
      // the camera drifts round the orb very slowly, so the motes pass in front and behind
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
