import * as THREE from 'three';
import { NOISE_GLSL } from '../toon';

/** Gold ramp: her offline-art gold (core, warm, champagne, bronze) plus the brief's hextech gold. */
export const GOLD = {
  core: new THREE.Color(0xfffec7),
  warm: new THREE.Color(0xf9c58c),
  champagne: new THREE.Color(0xedc69f),
  gold: new THREE.Color(0xc9a45c),
  bronze: new THREE.Color(0xac9173),
  deep: new THREE.Color(0x46382a),
  ink: new THREE.Color(0x16130e),
};

/** Chest-local lighting and state, shared by every chest material. Mutate values, never replace objects. */
export function chestUniforms() {
  return {
    uTime: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(-0.5, 0.75, 0.6).normalize() },
    uRimDir: { value: new THREE.Vector3(0.25, 0.45, -1).normalize() },
    uRootInv: { value: new THREE.Matrix4() },
    uClipY: { value: -100 },
    uWet: { value: 0 },
    uSeam: { value: 0 },
    uLeak: { value: 0 },
    uInner: { value: 0 },
    uColumn: { value: 0 },
    uExposure: { value: 1 },
    // glint sweep: a bright band travelling across the gold (x + y/2 in chest space), 0 = off
    uSweep: { value: -10 },
    uSweepAmt: { value: 0 },
  };
}
export type ChestUniforms = ReturnType<typeof chestUniforms>;

const COMMON_VERT = /* glsl */ `
uniform mat4 uRootInv;
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vRoot;
varying vec3 vRootN;
varying vec3 vObj;
void chestVert(vec3 p, vec3 n) {
  vec3 tp = p; vec3 tn = n;
  #ifdef USE_INSTANCING
    tp = (instanceMatrix * vec4(tp, 1.0)).xyz;
    tn = mat3(instanceMatrix) * tn;
  #endif
  vec4 wp = modelMatrix * vec4(tp, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * tn);
  vRoot = (uRootInv * wp).xyz;
  vRootN = normalize(mat3(uRootInv) * vNormalW);
  vObj = p;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Shared fragment helpers: clipping by the pool surface, the wet shadow that clings while rising, and the gold light from inside. */
const COMMON_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uKeyDir;
uniform vec3 uRimDir;
uniform float uClipY;
uniform float uWet;
uniform float uSeam;
uniform float uLeak;
uniform float uInner;
uniform float uColumn;
uniform float uExposure;
uniform float uSweep;
uniform float uSweepAmt;
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vRoot;
varying vec3 vRootN;
varying vec3 vObj;
${NOISE_GLSL}

// Linear values calibrated through the stage AgX + grade so they land on the gold ramp on screen
// (G_GOLD -> #C1965A, G_LIGHT -> #E0B77E, G_BRONZE -> #7C5D37, G_DEEP -> #453528; G_WARM x2..x8 runs gold to white-gold).
const vec3 G_CORE = vec3(1.0, 0.5, 0.08);
const vec3 G_WARM = vec3(1.0, 0.38, 0.025);
const vec3 G_LIGHT = vec3(1.6, 0.6, 0.02);
const vec3 G_GOLD = vec3(0.7, 0.29, 0.012);
const vec3 G_BRONZE = vec3(0.16, 0.085, 0.012);
const vec3 G_DEEP = vec3(0.045, 0.028, 0.003);
const vec3 INK = vec3(0.004, 0.004, 0.009);

float clipMask() {
  if (vPosW.y < uClipY) discard;
  return 1.0 - smoothstep(0.0, 0.012, vPosW.y - uClipY);
}

// Light that comes from inside the chest: the lid seam, the keyhole slit, the open interior and the column.
vec3 innerLight(vec3 rp, vec3 rn) {
  float dy = abs(rp.y - 0.545);
  float side = 1.0 - smoothstep(0.55, 0.9, abs(rn.y));
  float seam = exp(-dy * 48.0) * side;
  vec3 kd = rp - vec3(0.0, 0.33, 0.33);
  float key = exp(-length(kd * vec3(1.0, 0.55, 1.0)) * 34.0) * smoothstep(0.2, 0.7, rn.z);
  vec3 L = vec3(0.0, 0.56, 0.0) - rp;
  float dl = length(L);
  L /= max(dl, 1e-4);
  float inner = max(dot(rn, L), 0.0) / (1.0 + dl * dl * 16.0);
  // the column: light from above once open, caught by up-facing edges near the top
  float col = smoothstep(0.3, 0.95, rn.y) * smoothstep(0.42, 0.8, rp.y);
  return G_WARM * (seam * uSeam * 0.35 + key * uSeam * 0.45) + mix(G_WARM, G_CORE, 0.25) * inner * uInner * 1.2 + G_WARM * col * uColumn * 0.12;
}
`;

export const GOLD_VERT = /* glsl */ `
${COMMON_VERT}
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  chestVert(position, normal);
  vNormalV = normalize(mat3(viewMatrix) * vNormalW);
  vPosV = (viewMatrix * vec4(vPosW, 1.0)).xyz;
}
`;

/**
 * Precious-metal toon gold. A matcap-like environment computed from the view-space reflection
 * (bright warm sky, a hard horizon, dark bronze ground), a two-step toon key ramp, hard-edged specular glints
 * and a dark grazing edge so it reads as metal, not yellow plastic.
 */
export const GOLD_FRAG = /* glsl */ `
${COMMON_FRAG}
uniform float uBright;
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  float ce = clipMask();
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 nv = normalize(vNormalV);
  if (!gl_FrontFacing) nv = -nv;
  vec3 rv = reflect(normalize(vPosV), nv);

  // environment reflection with a wavy hard horizon (matcap-like, follows the camera)
  // position term: flat faces get a softbox gradient (dark low, bright high) instead of one flat tone
  float h = rv.y * 0.85 + (vRoot.y - 0.4) * 0.75 - 0.25 + 0.035 * sin(rv.x * 7.0 + vRoot.x * 9.0 + 0.6);
  float sky = smoothstep(-0.012, 0.012, h);
  vec3 skyC = mix(G_GOLD * 0.5, G_GOLD, smoothstep(0.04, 0.3, h));
  skyC = mix(skyC, G_LIGHT, smoothstep(0.45, 0.68, h));
  // thin dark band just above the horizon: the classic chrome line
  skyC *= 1.0 - 0.6 * (smoothstep(0.0, 0.025, h) * (1.0 - smoothstep(0.05, 0.1, h)));
  vec3 gndC = mix(G_BRONZE, G_DEEP, smoothstep(-0.04, -0.4, h));
  gndC = mix(gndC, G_BRONZE * 1.4, smoothstep(-0.7, -0.95, h));
  vec3 env = mix(gndC, skyC, sky);

  // toon key ramp: two hard steps
  float ndl = dot(N, uKeyDir);
  float lit = smoothstep(-0.08, -0.02, ndl);
  float lit2 = smoothstep(0.62, 0.67, ndl);
  vec3 col = env * (0.3 + 0.55 * lit + 0.2 * lit2);

  // hard specular glints from the key and a small cool kicker
  vec3 H = normalize(uKeyDir + V);
  float s = dot(N, H);
  col = mix(col, G_CORE * 5.0, smoothstep(0.978, 0.984, s));
  vec3 H2 = normalize(normalize(vec3(0.7, 0.3, 0.6)) + V);
  col += G_CORE * 2.5 * smoothstep(0.993, 0.996, dot(N, H2));

  // grazing edge darkens to ink: reads as polished metal
  float fr = 1.0 - max(dot(N, V), 0.0);
  col *= mix(1.0, 0.3, smoothstep(0.5, 0.92, fr));
  // warm back rim
  col += G_WARM * 0.45 * smoothstep(0.74, 0.82, fr) * smoothstep(0.0, 0.5, dot(N, uRimDir));

  col *= uExposure * uBright;
  // glint sweep across the metal (ignition, full charge)
  float sw = (vRoot.x + vRoot.y * 0.55 - uSweep) / 0.05;
  col += G_CORE * 2.6 * uSweepAmt * exp(-sw * sw) * (0.4 + 0.6 * smoothstep(0.2, 0.9, dot(N, V)));
  col += innerLight(vRoot, normalize(vRootN)) * 0.6;
  col = mix(col, INK, uWet * (1.0 - smoothstep(0.0, 0.2, vPosW.y - uClipY)) * 0.9);
  col += vec3(0.05, 0.02, 0.14) * smoothstep(0.65, 1.0, ce) * uWet * 0.5;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export const OBSIDIAN_FRAG = /* glsl */ `
${COMMON_FRAG}
uniform vec3 uBase;
uniform vec3 uLit;
uniform float uEngrave;
varying vec3 vNormalV;
varying vec3 vPosV;

// seigaiha (overlapping wave scales), returns the groove mask
float seigaiha(vec2 p) {
  float fw = length(fwidth(p)) * 3.0 + 0.001;
  float j0 = floor(p.y);
  for (int k = 0; k < 2; k++) {
    float j = j0 + float(k);
    float off = mod(j, 2.0);
    float ic = floor((p.x - off) * 0.5 + 0.5);
    for (int m = -1; m <= 1; m++) {
      vec2 c = vec2((ic + float(m)) * 2.0 + off, j);
      float d = length(p - c);
      if (d < 1.0) {
        float r = d * 3.0;
        float e = min(fract(r), 1.0 - fract(r));
        float g = 1.0 - smoothstep(0.07, 0.07 + fw * 1.5, e);
        return max(g, 1.0 - smoothstep(0.07, 0.07 + fw * 1.5, (1.0 - d) * 3.0));
      }
    }
  }
  return 0.0;
}
void main() {
  float ce = clipMask();
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 rn = normalize(vRootN);
  if (!gl_FrontFacing) rn = -rn;
  vec3 nv = normalize(vNormalV);
  vec3 rv = reflect(normalize(vPosV), nv);

  float ndl = dot(N, uKeyDir);
  float lit = smoothstep(0.0, 0.06, ndl);
  vec3 col = mix(uBase, uLit, lit);

  // black lacquer: one thin sharp cold reflection line (moves across the barrel lid) and a faint upper sheen
  float h = rv.y * 0.85 + (vRoot.y - 0.4) * 0.5 - 0.16 + 0.02 * sin(rv.x * 5.0);
  col += vec3(0.07, 0.08, 0.11) * smoothstep(0.0, 0.006, h) * (1.0 - smoothstep(0.012, 0.03, h));
  col += vec3(0.004, 0.0045, 0.006) * smoothstep(0.1, 0.5, h);
  vec3 H = normalize(uKeyDir + V);
  col += vec3(0.25, 0.28, 0.36) * smoothstep(0.985, 0.99, dot(N, H));

  // engraved seigaiha on the panels (triplanar pick by the root-space normal)
  vec3 an = abs(rn);
  vec2 uv = an.z > 0.6 ? vRoot.xy : (an.x > 0.6 ? vRoot.zy : vRoot.xz);
  float g = seigaiha(uv / 0.042 + vec2(0.37, 0.11)) * uEngrave;
  col *= 1.0 - g * 0.55;
  col += vec3(0.004, 0.0045, 0.006) * g * lit;

  // cold rim so the black body separates from the void
  float fr = 1.0 - max(dot(N, V), 0.0);
  col += vec3(0.03, 0.07, 0.15) * 0.55 * smoothstep(0.62, 0.78, fr) * smoothstep(-0.1, 0.5, dot(N, uRimDir));

  vec3 il = innerLight(vRoot, rn);
  col += il * 0.4;
  // wide bounce from the open interior: only faces turned into the chest (the concave lid, the inner walls) catch it
  vec3 L2 = vec3(0.0, 0.5, 0.0) - vRoot;
  float d2 = length(L2);
  float bounce = max(dot(rn, L2 / max(d2, 1e-4)), 0.0) / (1.0 + d2 * d2 * 5.0);
  col += mix(G_GOLD, G_WARM, 0.4) * bounce * uInner * 2.4 * (0.75 + 0.5 * g);
  // grooves carry the light that leaks from inside while charging, only near the seam and the keyhole
  float near = exp(-abs(vRoot.y - 0.545) * 16.0) * (1.0 - smoothstep(0.6, 0.95, abs(rn.y)))
    + exp(-length((vRoot.xy - vec2(0.0, 0.33)) * vec2(1.0, 0.7)) * 11.0) * step(0.6, rn.z);
  col += G_WARM * g * uLeak * near * 1.1;

  col *= uExposure;
  col = mix(col, INK, uWet * (1.0 - smoothstep(0.0, 0.2, vPosW.y - uClipY)) * 0.9);
  col += vec3(0.05, 0.02, 0.14) * smoothstep(0.65, 1.0, ce) * uWet * 0.5;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export const EMISSIVE_FRAG = /* glsl */ `
${COMMON_FRAG}
uniform vec3 uColor;
uniform float uLevel;
uniform float uFlow;
void main() {
  clipMask();
  float n = vnoise(vec3(vRoot.x * 9.0 + vRoot.z * 7.0, vRoot.y * 5.0, uTime * 0.35));
  float flow = mix(1.0, 0.7 + 0.6 * n, uFlow);
  vec3 c = uColor * uLevel * flow;
  gl_FragColor = vec4(c, 1.0);
}
`;

export function goldMaterial(u: ChestUniforms, bright = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, uBright: { value: bright } },
    vertexShader: GOLD_VERT,
    fragmentShader: GOLD_FRAG,
  });
}

export function obsidianMaterial(u: ChestUniforms, engrave = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...u,
      uBase: { value: new THREE.Color(0.001, 0.0012, 0.002) },
      uLit: { value: new THREE.Color(0.0135, 0.013, 0.0155) },
      uEngrave: { value: engrave },
    },
    vertexShader: GOLD_VERT,
    fragmentShader: OBSIDIAN_FRAG,
  });
}

export function emissiveMaterial(u: ChestUniforms, color: THREE.ColorRepresentation, flow = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, uColor: { value: new THREE.Color(color) }, uLevel: { value: 0 }, uFlow: { value: flow } },
    vertexShader: GOLD_VERT,
    fragmentShader: EMISSIVE_FRAG,
  });
}
