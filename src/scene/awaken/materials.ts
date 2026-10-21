import * as THREE from 'three';
import { light } from '../toon';

/** Measured seam / eye colours (REFERENCE beat 5): cyan fill, white-hot core, violet-blue eyes. */
export const GLOW = {
  fill: new THREE.Color(0x3fc9ff),
  core: new THREE.Color(0xe1f8ff),
  eye: new THREE.Color(0x7d6cff),
  eyeCore: new THREE.Color(0xe6e2ff),
  dark: new THREE.Color(0x0a0e18),
  plate: new THREE.Color(0x7fdcec),
  clip: new THREE.Color(0x7b3fe4),
};

/** Army atmosphere: the open gate behind the ranks (backlight rim + scattered haze) and the low fog that swallows the back ranks. */
export const ATMOS = {
  uGatePos: { value: new THREE.Vector3(0, 2.2, -6.5) },
  uGateHaze: { value: new THREE.Color(0x0b2244) },
  uGateRim: { value: new THREE.Color(0x9fd6ff) },
  uAtmos: { value: 0 },
  uFogH: { value: 0.9 },
};

export const ATMOS_GLSL = /* glsl */ `
uniform vec3 uGatePos;
uniform vec3 uGateHaze;
uniform vec3 uGateRim;
uniform float uAtmos;
uniform float uFogH;
// fog colour along this view ray: void, lifted to a cold glow toward the gate
vec3 atmosColor(vec3 P, float gi) {
  vec3 vd = normalize(P - cameraPosition);
  vec3 gd = normalize(uGatePos - cameraPosition);
  float sc = max(dot(vd, gd), 0.0);
  float g = pow(sc, 60.0) * 0.8 + pow(sc, 8.0) * 0.12;
  return mix(vec3(0.0018, 0.0022, 0.005), uGateHaze, clamp(g * gi * 1.4, 0.0, 1.0));
}
// how much of the air between the camera and P: distance haze plus a low ground bank
float atmosAmount(vec3 P, float dist) {
  float far = smoothstep(5.0, 16.0, dist) * 0.8;
  float low = (1.0 - smoothstep(0.0, uFogH, P.y)) * smoothstep(3.0, 10.0, dist) * 0.8;
  return clamp(max(far, low) * uAtmos, 0.0, 0.9);
}
`;

export const SEAM_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uPlateColor;
float hs13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hs11(float x) { x = fract(x * 0.1031); x *= x + 33.33; x *= x + x; return fract(x); }
float vs1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hs11(i), hs11(i + 1.0), f); }
uniform float uShimmer;
uniform vec3 uFillColor;
uniform vec3 uCoreColor;
uniform vec3 uEyeColor;
uniform vec3 uEyeCore;
uniform vec3 uDark;
/*
 * Seam light with a hierarchy: primary plate edges carry short white-hot runs, secondary seams a dim cold line,
 * tertiary seams barely read. Every seam breaks along its length (gaps like cracked lacquer), so nothing reads as
 * a continuous neon tube. Eyes are the brightest thing on the body by far.
 */
float ln1(float x) { float i = floor(x); return mix(hs11(i), hs11(i + 1.0), fract(x)); }
float vn2s(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hs13(vec3(i, 2.3)), b = hs13(vec3(i + vec2(1.0, 0.0), 2.3));
  float c = hs13(vec3(i + vec2(0.0, 1.0), 2.3)), d = hs13(vec3(i + vec2(1.0, 1.0), 2.3));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// R: the vertex's rest-pose position (metres, body space), so the fissures stick to the armour while it moves
vec3 seamColor(float kind, float u, vec3 N, vec3 V, float fill, float core, float eye, float seed, vec3 R, float plate) {
  float ndv = abs(dot(N, V));
  if (kind < -1.5) {
    // Sable's plume: pale frost-teal horsehair, the one cold accent on the captain. It wakes with the seams; strands
    // differ a little in value, the gate rims the edges, and the tips glow faintly so it reads in the dark
    float lit = clamp(fill, 0.0, 1.0);
    float strand = 0.55 + 0.45 * vs1(R.x * 300.0 + R.z * 45.0 + seed * 3.0);
    vec3 frost = vec3(0.09, 0.22, 0.26);
    float rimP = pow(1.0 - ndv, 2.5);
    vec3 c = frost * (0.4 + 0.6 * ndv) * strand + vec3(0.45, 0.9, 1.0) * rimP * 0.5 * strand;
    return uDark * 0.6 + c * lit;
  }
  if (kind > 3.25) {
    // the commander's breastplate lit from inside (f1053 -> f1059 -> f1080): ice-blue light pours in through the seams
    // around each pectoral lobe (the chevron below, the gorget above), floods both lobes either side of a dark sternum
    // keel, then sinks back into the seams, so the plate settles to the body black with thin white-hot seams
    vec2 p = R.xy;
    float ax = abs(p.x);
    float dth = abs(0.64 * u - 0.32);
    float vy = 1.413 + 0.095 * pow(dth / 0.33, 1.15);
    float top = 1.594 - 0.022 * exp(-ax * ax / 0.0016);
    // ice mass and frost: domain-warped value noise at two scales, so the shapes are soft and never line up with a grid
    vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p * 22.0 + seed * 3.0;
    q += 0.9 * vec2(vn2s(q * 1.9 + 3.1), vn2s(q * 1.9 + 8.7)) - 0.45;
    float n1 = vn2s(q);
    vec2 q2 = mat2(0.5, 0.866, -0.866, 0.5) * p * 41.0 + 7.0;
    q2 += 0.8 * vec2(vn2s(q2 * 1.7 + 1.3), vn2s(q2 * 1.7 + 5.9)) - 0.4;
    float n2 = vn2s(q2);
    float burst = smoothstep(0.25, 1.55, plate);
    // distance (m) to the seams the light comes through: the chevron below, the gorget above, and plate sides that
    // narrow toward the collar, so the lit shape is a breastplate (f1053 / f1059), not a bib
    float xmax = 0.105 + 0.1 * (1.0 - smoothstep(1.48, 1.594, p.y));
    float dS = min(min(p.y - vy, top - p.y), min(min(u, 1.0 - u) * 0.42, (xmax - ax) * 0.9));
    float eK = ax - (0.007 + 0.008 * (1.0 - smoothstep(1.42, 1.56, p.y)) + 0.005 * (n2 - 0.5));
    // the glow rises inside the plate (f1047 -> f1053 -> f1059): it lights first along the seams and in the brightest
    // ice, then fills the plate; as it settles it sinks back the same way, into the seams
    float g = 0.55 * exp(-max(dS, 0.0) / 0.02) + 0.45 * n1;
    float thr = 1.0 - 1.2 * burst;
    float iceS = smoothstep(thr, thr + 0.1, g);
    // a dim translucent fill through the whole plate under it (f1053), so it reads as light inside the armour
    float ice = max(iceS, 0.7 * smoothstep(0.0, 0.55, burst)) * smoothstep(0.0, 0.0012, dS) * smoothstep(0.0, 0.003, eK);
    // thin broken white-hot seams round each lobe and down the keel: the first light in (f1047) and what is left once
    // the burst sinks back (f1080)
    float sd = min(abs(dS), abs(eK) * 1.4);
    float saa = fwidth(sd) + 1e-5;
    float brk = smoothstep(0.3, 0.36, ln1((p.x + p.y) * 55.0 + seed * 5.0));
    // the plate beyond its outline (dS < 0) is body black, never a seam
    float sLine = (1.0 - smoothstep(0.0006, 0.0006 + saa, sd)) * brk * clamp(0.0018 / saa, 0.0, 1.0) * step(-0.0006 - saa, dS);
    float seamLit = sLine * clamp(plate / 0.32, 0.0, 1.0) * (1.0 - burst);
    if (max(ice, seamLit) < 0.06) discard;
    float hot = exp(-max(dS, 0.0) / 0.006);
    float frost = smoothstep(0.58, 0.85, n2) * smoothstep(0.3, 0.6, n1);
    // azure body measured through AgX (f1059 #75A8EA), cyan-white frost (f1080 #B7F3F4 / #E5FCFE), white-hot at the
    // seams and a frosted glint where the glow is still spreading; the body stays under the bloom threshold
    vec3 ice0 = mix(vec3(0.0, 0.06, 0.95), vec3(0.0, 0.29, 3.5), smoothstep(0.15, 0.7, n1));
    ice0 = mix(ice0, vec3(0.3, 1.9, 5.2), frost * 0.7);
    float rim = exp(-abs(g - thr - 0.05) / 0.025) * (1.0 - hot) * (1.0 - smoothstep(0.85, 1.0, burst));
    ice0 = mix(ice0, vec3(1.0, 3.0, 7.0), hot * mix(0.9, 0.5, burst));
    ice0 = mix(ice0, vec3(0.6, 2.2, 5.5), clamp(rim * 0.5, 0.0, 1.0));
    ice0 *= (0.7 + 0.3 * smoothstep(0.0, 0.03, eK)) * mix(0.4, 1.0, iceS);
    vec3 col = vec3(0.0055, 0.0085, 0.019) * (0.55 + 0.45 * ndv);
    return mix(col, ice0 * (0.1 + 0.9 * burst * burst), smoothstep(0.06, 0.35, ice)) + vec3(0.9, 2.6, 6.0) * seamLit * 0.6;
  }
  if (kind > 2.5) {
    // soldier chest plate: an inset V parallel to the chevron and a short sternum ridge, broken like cracked lacquer.
    // The plate level is capped below the burst, so it only flares with the ignition and then sinks to a dim line
    vec2 p = R.xy;
    float ax = abs(p.x);
    float side = p.x < 0.0 ? 1.0 : 0.0;
    float dV = abs(p.y - 1.452 - 1.04 * ax) * 0.693 + max(p.y - 1.57, 0.0) * 2.0 + max(0.028 - ax, 0.0) * 2.0;
    float dR = ax + max(1.43 - p.y, 0.0) + max(p.y - 1.49, 0.0);
    float gV = smoothstep(0.3, 0.36, ln1(p.y * 62.0 + side * 7.3 + seed * 5.0));
    float gR = smoothstep(0.3, 0.36, ln1(p.y * 48.0 + 2.1 + seed * 3.0));
    float d = min(dV + (1.0 - gV) * 0.02, dR + (1.0 - gR) * 0.02);
    float aa = fwidth(d) + 1e-5;
    // sub-pixel seams (distant soldiers) dim with their coverage instead of turning the plate grey
    float cover = clamp(0.0018 / aa, 0.0, 1.0);
    float ember = clamp(plate / 0.32, 0.0, 1.0);
    float line = (1.0 - smoothstep(0.001, 0.001 + aa, d)) * cover;
    if (line * ember < 0.06) discard;
    float lvl = mix(0.16, 1.0, smoothstep(0.4, 0.6, plate));
    vec3 col = vec3(0.0055, 0.0085, 0.019) * (0.55 + 0.45 * ndv);
    return col + vec3(0.9, 2.6, 6.0) * line * ember * lvl;
  }
  if (kind > 0.5 && kind < 1.5) {
    float c = smoothstep(0.2, 0.95, ndv);
    return uDark + uEyeColor * eye * (3.2 + 3.0 * c) + uEyeCore * eye * c * 3.4;
  }
  float sb = kind > 1.5 ? 0.6 : 1.0 - kind * 1.6;
  float tier = smoothstep(0.5, 0.95, sb);
  // breaks: low-frequency segment noise along the seam's arc length
  float sn = vs1(u * 7.0 + seed * 13.1 + kind * 37.0);
  float gapT = mix(0.42, 0.2, tier);
  float on = smoothstep(gapT, gapT + 0.05, sn);
  // hot runs only on the primary seams, where the segment noise peaks
  float hot = smoothstep(0.62, 0.78, sn) * tier;
  float glint = uShimmer * pow(0.5 + 0.5 * sin(u * 7.0 - uTime * 2.4 + seed * 6.28), 12.0);
  float flare = max(plate - 0.45, 0.0);
  float lvl = mix(0.13, 0.55, tier) * on * (1.0 + 3.0 * flare);
  hot = max(hot, flare * 0.6 * tier * smoothstep(0.35, 0.6, sn));
  vec3 deepFill = uFillColor * vec3(0.7, 0.85, 1.0);
  vec3 f = deepFill * fill * lvl * (0.45 + 0.55 * ndv) * (1.0 + glint * 0.6);
  vec3 cr = uCoreColor * core * (hot * 1.8 + glint * 0.35 * tier) * on * smoothstep(0.35, 0.95, ndv);
  if (kind > 1.5) {
    // blade edge: a thin cold line with one travelling glint, no hot runs
    f = deepFill * fill * 0.22 * (0.3 + 0.7 * smoothstep(0.3, 0.6, sn));
    cr = uCoreColor * core * glint * 0.9;
  }
  return uDark + f + cr;
}
`;

const glowVert = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute float aKind;
attribute float aU;
uniform float uTime;
uniform float uShimmer;
varying vec3 vN;
varying vec3 vPos;
varying vec3 vRest;
varying float vKind;
varying float vU;
void main() {
  vRest = position;
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  if (aKind < -1.5) {
    // the plume sways from its root: more toward the tips, slow, two out-of-phase waves
    float w = pow(clamp(aU / 0.7, 0.0, 1.0), 1.6) * (0.35 + 0.65 * uShimmer);
    transformed += vec3(sin(uTime * 1.7 + aU * 5.0 + position.x * 40.0) * 0.03, 0.0, sin(uTime * 1.25 + aU * 4.0) * 0.02) * w;
  }
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vN = normalize(mat3(modelMatrix) * objectNormal);
  vPos = wp.xyz;
  vKind = aKind;
  vU = aU;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const glowFrag = /* glsl */ `
uniform float uPlate;
uniform float uFill;
uniform float uCore;
uniform float uEye;
uniform float uClipY;
uniform float uSeed;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uRimStrength;
varying vec3 vN;
varying vec3 vPos;
varying vec3 vRest;
varying float vKind;
varying float vU;
${SEAM_GLSL}
${ATMOS_GLSL}
void main() {
  if (vPos.y < uClipY) discard;
  vec3 V = normalize(cameraPosition - vPos);
  vec3 col = seamColor(vKind, vU, normalize(vN), V, uFill, uCore, uEye, uSeed, vRest, uPlate);
  float dist = length(cameraPosition - vPos);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  col = mix(col, atmosColor(vPos, clamp((uRimStrength - 0.6) / 2.2, 0.0, 1.0)), atmosAmount(vPos, dist));
  gl_FragColor = vec4(min(col, vec3(40.0)), 1.0);
}
`;

export type GlowMaterial = THREE.ShaderMaterial;

/** Seam + eye material for one hero soldier (skinned). Drive uFill / uCore / uEye 0..1. */
export function makeGlowMaterial(seed = 0): GlowMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: glowVert,
    fragmentShader: glowFrag,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uShimmer: { value: 1 },
      uFill: { value: 0 },
      uCore: { value: 0 },
      uEye: { value: 0 },
      uPlate: { value: 0 },
      uPlateColor: { value: GLOW.plate },
      uSeed: { value: seed },
      uClipY: { value: 0 },
      uFillColor: { value: GLOW.fill },
      uCoreColor: { value: GLOW.core },
      uEyeColor: { value: GLOW.eye },
      uEyeCore: { value: GLOW.eyeCore },
      uDark: { value: GLOW.dark },
      uFogColor: light.uFogColor,
      uFogDensity: light.uFogDensity,
      uRimStrength: light.uRimStrength,
      ...ATMOS,
    },
  });
}

/* --------------------------------------------------------------------------------------------- army */

const armyVert = /* glsl */ `
attribute vec3 aPos2;
attribute vec3 aNrm2;
attribute float aKind;
attribute float aU;
attribute vec4 aState;   // fill, core, eye, kneel (per instance)
attribute vec4 aState2;  // seed, clip glow, spare, spare
varying vec3 vN;
varying vec3 vPos;
varying vec3 vRest;
varying float vKind;
varying float vU;
varying vec4 vState;
varying float vSeed;
varying float vClipGlow;
varying float vPlate;
void main() {
  float k = aState.w;
  vPlate = aState2.z;
  vRest = position;
  vec3 p = mix(position, aPos2, k);
  vec3 n = normalize(mix(normal, aNrm2, k) + 1e-5);
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(p, 1.0);
  vN = normalize(mat3(m) * n);
  vPos = wp.xyz;
  vKind = aKind;
  vU = aU;
  vState = aState;
  vSeed = aState2.x;
  vClipGlow = aState2.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const armyFrag = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uShade;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform float uKeyStrength;
uniform vec3 uRimDir;
uniform vec3 uRimColor;
uniform vec3 uRimColor2;
uniform float uRimStrength;
uniform vec3 uRimTint;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogMul;
uniform vec3 uHaze;
uniform float uHazeStart;
uniform float uHazeRange;
uniform vec3 uGroundGlow;
uniform float uGroundGlowStrength;
uniform vec3 uClipColor;
${ATMOS_GLSL}
varying vec3 vN;
varying vec3 vPos;
varying vec3 vRest;
varying float vKind;
varying float vU;
varying vec4 vState;
varying float vSeed;
varying float vClipGlow;
varying float vPlate;
${SEAM_GLSL}
void main() {
  if (vPos.y < 0.0) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vPos);
  float gi = clamp((uRimStrength - 0.6) / 2.2, 0.0, 1.0);
  vec3 col;
  if (vKind < -0.5) {
    float ndl = dot(N, uKeyDir);
    float lit = smoothstep(0.07, 0.13, ndl);
    col = mix(uShade, uBase * mix(vec3(1.0), uKeyColor * 1.6, 0.5), lit * uKeyStrength);
    col += mix(uAmbBottom, uAmbTop, N.y * 0.5 + 0.5) * 0.35;
    col += uGroundGlow * uGroundGlowStrength * (1.0 - smoothstep(-0.8, 0.2, N.y)) * (1.0 - smoothstep(0.0, 1.6, vPos.y));
    float fres = 1.0 - max(dot(N, V), 0.0);
    float facing = dot(N, uRimDir);
    float rimMask = smoothstep(0.5, 0.56, fres) * smoothstep(-0.15, 0.35, facing);
    // low on the body, up-facing plates (sabatons, knees) would catch the rim as pale blobs: keep them black
    rimMask *= 1.0 - 0.85 * smoothstep(0.3, 0.8, N.y) * (1.0 - smoothstep(0.5, 1.2, vPos.y));
    vec3 rimCol = mix(uRimColor2, uRimColor, smoothstep(-0.2, 0.6, N.y + facing * 0.3));
    col += rimCol * uRimTint * rimMask * uRimStrength * mix(1.0, 0.35, uAtmos);
    // the open gate behind the ranks: a thin cold rim on helms, pauldrons and spear shafts that face it
    vec3 toG = uGatePos - vPos;
    float gd2 = dot(toG, toG);
    vec3 Lg = toG * inversesqrt(gd2);
    float gRim = smoothstep(0.6, 0.8, fres) * smoothstep(0.1, 0.5, dot(N, Lg));
    float gTop = smoothstep(0.6, 0.9, dot(N, Lg)) * smoothstep(0.4, 0.85, N.y) * 0.18;
    col += uGateRim * (gRim + gTop) * gi * 2.2 / (1.0 + gd2 * 0.06);
    col += uClipColor * vClipGlow * (1.0 - smoothstep(0.0, 0.05, vPos.y)) * 0.7;
  } else {
    col = seamColor(vKind, vU, N, V, vState.x, vState.y, vState.z, vSeed, vRest, vPlate);
  }
  float dist = length(cameraPosition - vPos);
  float fog = 1.0 - exp(-pow(uFogDensity * uFogMul * dist, 2.0));
  float haze = smoothstep(uHazeStart, uHazeStart + uHazeRange, dist) * (1.0 - uAtmos);
  vec3 fc = mix(uFogColor, uHaze, haze);
  col = mix(col, fc, clamp(max(fog, haze * 0.85), 0.0, 1.0));
  col = mix(col, atmosColor(vPos, gi), atmosAmount(vPos, dist));
  col = max(col, vec3(0.0));
  if (any(isnan(col))) col = vec3(0.0);
  gl_FragColor = vec4(min(col, vec3(40.0)), 1.0);
}
`;

/** One-draw-call material for the instanced background army (body + seams + eyes in one mesh). */
export function makeArmyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: armyVert,
    fragmentShader: armyFrag,
    side: THREE.FrontSide,
    uniforms: {
      uKeyDir: light.uKeyDir,
      uKeyColor: light.uKeyColor,
      uKeyStrength: light.uKeyStrength,
      uRimDir: light.uRimDir,
      uRimColor: light.uRimColor,
      uRimColor2: light.uRimColor2,
      uRimStrength: light.uRimStrength,
      uAmbTop: light.uAmbTop,
      uAmbBottom: light.uAmbBottom,
      uFogColor: light.uFogColor,
      uFogDensity: light.uFogDensity,
      uGroundGlow: light.uGroundGlow,
      uGroundGlowStrength: light.uGroundGlowStrength,
      uFogMul: { value: 1.6 },
      uHaze: { value: new THREE.Color(0x111531) },
      uHazeStart: { value: 7 },
      uHazeRange: { value: 9 },
      uBase: { value: new THREE.Color(0x141b2b) },
      uShade: { value: new THREE.Color(0x06080e) },
      uRimTint: { value: new THREE.Color(0xb8b0ff) },
      uClipColor: { value: GLOW.clip.clone() },
      uTime: { value: 0 },
      uShimmer: { value: 1 },
      uFillColor: { value: GLOW.fill },
      uCoreColor: { value: GLOW.core },
      uEyeColor: { value: GLOW.eye },
      uEyeCore: { value: GLOW.eyeCore },
      uDark: { value: GLOW.dark },
      uPlateColor: { value: GLOW.plate },
      ...ATMOS,
    },
  });
}
