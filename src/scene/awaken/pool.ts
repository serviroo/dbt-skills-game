import * as THREE from 'three';
import { light } from '../toon';
import { clamp } from '../../core/math';
import { noiseTexture } from '../fx/noise';
import { PAVING_GLSL } from '../gate/paving';

export const FX_NOISE = /* glsl */ `
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vn2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y);
}
float fbm2(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vn2(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
float fbm3x(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vn3(p); p = p * 2.02 + 17.1; a *= 0.5; } return s; }
`;

/** Stepped disc widths (% of frame width) measured on f0237..f0254: pop, then 8 frames of expansion. */
export const POOL_STEPS = [26, 29, 43, 54, 60, 60, 60, 74, 91];
export const POOL_TIMING = { hold: 0.3, step: 0.0334, lightAt: 0.6, settle: 0.267 };

const poolFrag = /* glsl */ `
uniform vec2 uCenter;
uniform float uR;
uniform float uDisc;
uniform float uLit;
uniform float uRim;
uniform float uFloor;
uniform float uFloorR;
uniform float uFloorGain;
uniform float uBoost;
uniform vec2 uFeet;
uniform vec3 uBoostColor;
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uNoise;
varying vec3 vPos;
${FX_NOISE}
${PAVING_GLSL}
void main() {
  vec2 p = vPos.xz;
  float d = length(p - uCenter);
  // the abbey's flagstones (gate/paving.ts): the same slabs, in the same places, as the floor round the gate, lit up
  // from the hit so the dark disc reads (f0237). Each slab is faintly domed and lit from the gate side, darker into
  // its joints and cracks, so the floor reads as stone rather than a flat plane
  Paving pv = paving(p);
  float crack = max(pv.crack, pv.joint * 0.6);
  float grain = fbm2(p * 3.1);
  vec3 sn = normalize(vec3(-pv.rel.x * 0.5, 1.0, -pv.rel.y * 0.5));
  float dome = 0.75 + 0.4 * max(dot(sn, vec3(0.0, 0.72, -0.69)), 0.0);
  vec3 stone = mix(srgb(vec3(0.085, 0.093, 0.135)), srgb(vec3(0.125, 0.135, 0.19)), pv.id) * (0.82 + 0.36 * grain);
  stone *= dome * 1.25 * (1.0 - 0.6 * pv.joint) * (1.0 - 0.5 * pv.crack);
  stone *= uFloorGain;
  float fr = length(p);
  float floorA = uFloor * (1.0 - smoothstep(uFloorR * 0.55, uFloorR, fr));
  vec3 col = stone;
  float a = floorA;

  // the shadow disc: soft edge, slight noise wobble on the boundary
  float wob = (vn2((p - uCenter) * 0.55 / max(0.6, uR * 0.25) + uTime * 0.05) - 0.5) * 0.1 * uR;
  float soft = 0.05 * uR + 0.04;
  float disc = (1.0 - smoothstep(uR - soft, uR + soft * 0.25, d + wob)) * step(0.001, uR);
  col = mix(col, srgb(vec3(0.067, 0.082, 0.114)), disc * 0.88 * uDisc);
  a = max(a, disc * 0.88 * uDisc);

  // lit interior (+19% luma, blue), dark ring band, lavender hot rim
  if (uLit > 0.0) {
    float x = d / max(uR, 0.001);
    float inner = 1.0 - smoothstep(0.8, 0.86, x + wob / max(uR, 0.001) * 0.5);
    vec2 dirC = (p - uCenter) / max(d, 1e-3);
    float sa = uTime * 0.12 + 0.18 * d;
    vec2 rp = mat2(cos(sa), -sin(sa), sin(sa), cos(sa)) * (p - uCenter);
    float swirl = inner > 0.0 ? fbm2(rp * 0.45 + vec2(0.0, -uTime * 0.15)) : 0.0;
    vec3 lit = mix(srgb(vec3(0.137, 0.188, 0.369)), srgb(vec3(0.165, 0.204, 0.345)), pv.id) * (0.85 + 0.3 * grain);
    lit *= (1.0 - 0.6 * crack) * (0.9 + 0.25 * smoothstep(0.3, 0.7, pv.id));
    lit += srgb(vec3(0.16, 0.24, 0.5)) * smoothstep(0.45, 0.8, swirl) * 0.8;
    lit += srgb(vec3(0.3, 0.6, 1.0)) * crack * 0.25 * (0.3 + 0.35 * uBoost);
    float fall = mix(1.0, 0.6, smoothstep(0.0, 0.85, x));
    col = mix(col, lit * fall, inner * min(1.0, uLit * 1.6));
    col *= mix(1.0, 0.62, inner * (1.0 - smoothstep(0.55, 0.95, uLit)));
    float bandM = smoothstep(0.8, 0.87, x) * (1.0 - smoothstep(0.95, 1.02, x));
    col = mix(col, srgb(vec3(0.086, 0.11, 0.188)) * 0.8, bandM * uLit * 0.85);
    // the hot rim's noise only near the ring: the floor fills the frame in the high vortex shot
    if (abs(x - 0.845) < 0.2) {
      float rimLine = exp(-pow((x - 0.845) / 0.006, 2.0));
      float rimGlow = exp(-abs(x - 0.845) / 0.03);
      float rimN = smoothstep(0.32, 0.62, fbm2(dirC * 9.0 + vec2(uTime * 0.5, 0.0))) * (0.7 + 0.3 * fbm2(dirC * 30.0 + 1.7));
      rimLine *= 0.55 + 0.9 * fbm2(dirC * 14.0 + 3.1);
      col += (srgb(vec3(0.91, 0.76, 0.984)) * rimLine * 2.4 + srgb(vec3(0.48, 0.25, 0.89)) * rimGlow * 0.6) * uRim * rimN;
    }
    a = max(a, max(inner, bandM) * uLit * 0.95);
  }
  // the vortex lights the floor unevenly: mottled spill near him plus cyan light leaking through the cracks,
  // never a flat bright plane under the flames
  float dv = length(p);
  float ts = floor(uTime * 12.0) / 12.0;
  float arm = sin(atan(p.y, p.x + (dv < 1e-4 ? 1.0 : 0.0)) * 3.0 + log(dv + 0.25) * 5.0 - ts * 6.0 + (grain - 0.5) * 1.6);
  float arms = smoothstep(0.45, 0.95, arm) * exp(-dv * 0.4) * smoothstep(0.45, 1.1, dv);
  col *= 1.0 - uBoost * 0.8 * smoothstep(1.0, 3.6, dv);
  col += srgb(vec3(0.14, 0.38, 1.0)) * arms * uBoost * 0.5;
  col += uBoostColor * uBoost * exp(-d * 0.6) * (0.2 + 0.7 * grain) + srgb(vec3(0.16, 0.45, 1.0)) * crack * uBoost * exp(-d * 0.45) * 0.3;
  // contact shadow under his feet while the flames burn, so the high vortex camera sees him stand on the floor
  vec2 fd = p - uFeet;
  col *= 1.0 - 0.92 * clamp(uBoost / 0.5, 0.0, 1.0) * exp(-dot(fd, fd) / 0.3);

  float dist = length(cameraPosition - vPos);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
}
`;

const decalVert = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export function buildPool(rMax: number, center: THREE.Vector2) {
  const uniforms = {
    uCenter: { value: center.clone() },
    uR: { value: 0 },
    uDisc: { value: 0 },
    uLit: { value: 0 },
    uRim: { value: 0 },
    uFloor: { value: 1 },
    uFloorR: { value: rMax * 1.7 },
    uFloorGain: { value: 1.7 },
    uBoost: { value: 0 },
    uFeet: { value: new THREE.Vector2(center.x, center.y) },
    uBoostColor: { value: new THREE.Color(0x2a6cff) },
    uTime: { value: 0 },
    uFogColor: light.uFogColor,
    uFogDensity: light.uFogDensity,
    uNoise: { value: noiseTexture() },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: decalVert,
    fragmentShader: poolFrag,
    uniforms,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const size = rMax * 3.6;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), mat);
  mesh.name = 'pool';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.002, 0);
  mesh.renderOrder = -4;
  mesh.frustumCulled = false;

  /** p over POOL duration (1.0 s): pop, hold 300 ms, stepped expansion, light, rim settle. */
  const set = (p: number) => {
    const t = p * 1.0;
    if (p <= 0) {
      uniforms.uDisc.value = 0;
      uniforms.uR.value = 0;
      uniforms.uLit.value = 0;
      uniforms.uRim.value = 0;
      return;
    }
    let w: number;
    if (t < POOL_TIMING.hold) w = POOL_STEPS[0];
    else w = POOL_STEPS[Math.min(POOL_STEPS.length - 1, 1 + Math.floor((t - POOL_TIMING.hold) / POOL_TIMING.step))];
    uniforms.uR.value = (rMax * w) / 91;
    uniforms.uDisc.value = 1;
    const lit = t >= POOL_TIMING.lightAt ? 1 : 0;
    uniforms.uLit.value = lit;
    const s = clamp((t - POOL_TIMING.lightAt) / POOL_TIMING.settle);
    uniforms.uRim.value = lit ? 1 + 0.156 * (1 - s) * (1 - s) : 0;
  };
  return { mesh, uniforms, set };
}

/* ------------------------------------------------------------------ small pools under each soldier */

const smallVert = /* glsl */ `
attribute vec3 aOffset;  // x, z, radius
attribute vec4 aSp;      // open 0..1, rim, ripple phase, seed
varying vec2 vUv;
varying vec4 vSp;
varying vec3 vPos;
varying float vR;
void main() {
  vec3 p = vec3(position.x * aOffset.z * 2.0, 0.0, -position.y * aOffset.z * 2.0) + vec3(aOffset.x, 0.004, aOffset.y);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vPos = wp.xyz;
  vUv = position.xy * 2.0;
  vSp = aSp;
  vR = aOffset.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const smallFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vSp;
varying vec3 vPos;
varying float vR;
${FX_NOISE}
void main() {
  float open = vSp.x;
  if (open <= 0.001) discard;
  float d = length(vUv);
  float ang = atan(vUv.y, vUv.x);
  float wob = (vn2(vec2(ang * 2.5 + vSp.w * 10.0, uTime * 0.4)) - 0.5) * 0.12;
  float r = open * 0.62;
  float disc = 1.0 - smoothstep(r - 0.08, r + 0.02, d + wob);
  vec3 col = srgb(vec3(0.03, 0.035, 0.06));
  float a = disc * 0.9;
  float rim = exp(-pow((d + wob - r) / 0.025, 2.0)) * vSp.y;
  col += srgb(vec3(0.5, 0.32, 1.0)) * rim * 0.75;
  // ripples travelling outward while the soldier is emerging
  float rp = 0.0;
  for (int i = 0; i < 2; i++) {
    float ph = fract(vSp.z + float(i) * 0.5);
    float rr = r + ph * 0.38;
    rp += exp(-pow((d + wob * 0.5 - rr) / 0.018, 2.0)) * (1.0 - ph) * step(0.001, vSp.z);
  }
  col += srgb(vec3(0.3, 0.5, 1.0)) * rp * 0.5 * vSp.y;
  a = max(a, clamp(rim + rp * 0.6 * vSp.y, 0.0, 1.0));
  float dist = length(cameraPosition - vPos);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, a * (1.0 - smoothstep(0.85, 1.0, d)));
}
`;

export function buildSmallPools(spots: { x: number; z: number; r: number; seed: number }[]) {
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  const off = new Float32Array(spots.length * 3);
  spots.forEach((s, i) => off.set([s.x, s.z, s.r], i * 3));
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
  const sp = new Float32Array(spots.length * 4);
  spots.forEach((s, i) => (sp[i * 4 + 3] = s.seed));
  const spAttr = new THREE.InstancedBufferAttribute(sp, 4);
  spAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aSp', spAttr);
  g.instanceCount = spots.length;
  const mat = new THREE.ShaderMaterial({
    vertexShader: smallVert,
    fragmentShader: smallFrag,
    uniforms: { uTime: { value: 0 }, uFogColor: light.uFogColor, uFogDensity: light.uFogDensity },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -3;
  return { mesh, attr: spAttr, mat };
}
