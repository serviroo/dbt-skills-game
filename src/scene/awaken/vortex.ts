import * as THREE from 'three';
import { clamp, smoothstep, mulberry32 } from '../../core/math';
import { params } from '../../core/params';
import { FX_NOISE } from './pool';

/**
 * Measured vortex ramp (f0905, f0930): #111D53 #1D2E8F #2945C7 #396EED #3AAEF8 #4FE2FB #6EEFFC, core #EAFFFF. The two
 * top bands are azure and a hot near-white, not the measured cyan: through AgX a mid-luminance cyan greys into teal.
 * Scene-linear values, chosen so that after the band gains in the shader AgX lands on #0F2986 #2446B9 #4272E0 #6399EF
 * #7EB1F8 #BEDEF6: saturated blues need red near 0 and a high blue channel, or AgX turns them pastel.
 */
const RAMP = [
  [0.03, 0.015, 0.42],
  [0.02, 0.005, 0.6],
  [0.007, 0.017, 0.96],
  [0.0, 0.092, 1.46],
  [0.0, 0.19, 2.23],
  [0.175, 0.75, 2.25],
].map(([r, g, b]) => new THREE.Color(r, g, b));

const sheetVert = /* glsl */ `
attribute vec4 aL; // seed, spin, twist, layer intensity
varying vec3 vObj;
varying vec2 vUv;
varying vec4 vL;
varying float vFacing;
varying float vEdge;
uniform float uGrow;
void main() {
  vec3 p = position;
  p.xz *= 1.0 + uGrow * (0.5 + p.y * 0.18);
  vObj = position;
  vUv = uv;
  vL = aL;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec3 n = normalize(vec3(position.x, 0.0, position.z));
  vec3 vd = normalize(cameraPosition - wp.xyz);
  // near/far from the horizontal view direction, so the wall over him stays dark from a high camera too
  vFacing = dot(n, normalize(vec3(vd.x, 0.0, vd.z) + vec3(1e-5, 0.0, 0.0)));
  vEdge = abs(dot(n, vd));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const sheetFrag = /* glsl */ `
uniform float uT;
uniform float uAmt;
uniform float uH;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4; uniform vec3 uC5;
varying vec3 vObj;
varying vec2 vUv;
varying vec4 vL;
varying float vFacing;
varying float vEdge;
${FX_NOISE}
void main() {
  float v = vUv.y;
  float ang = uT * vL.y + v * vL.z * 2.6;
  float ca = cos(ang), sa = sin(ang);
  vec2 xz = mat2(ca, -sa, sa, ca) * vObj.xz;
  vec3 q = vec3(xz.x * 1.15, vObj.y * 0.62 - uT * 2.4, xz.y * 1.15) + vL.x * 13.7;
  // two octaves: big cel flame shapes, and half the noise cost now that the swirl fills the frame
  float n = (0.5 * vn3(q) + 0.25 * vn3(q * 2.02 + 17.1)) * 1.1667;
  float tongue = n * 1.25 + 0.1 - (v / max(uH, 0.05)) * 0.85 - 0.08 - 0.25 * (1.0 - smoothstep(0.0, 0.25, v));
  float aa = fwidth(tongue) * 1.3 + 1e-4;
  float b0 = smoothstep(0.0, aa, tongue);
  float b1 = smoothstep(0.1, 0.1 + aa, tongue);
  float b2 = smoothstep(0.2, 0.2 + aa, tongue);
  float b3 = smoothstep(0.27, 0.27 + aa, tongue);
  float b4 = smoothstep(0.4, 0.4 + aa, tongue);
  float b5 = smoothstep(0.58, 0.58 + aa, tongue);
  // mostly saturated blue mass (f0905); cyan and ice-white only on the tongue tips
  vec3 col = uC0 * 0.4; float al = 0.3;
  col = mix(col, uC1 * 0.75, b1); al = mix(al, 0.6, b1);
  col = mix(col, uC2 * 1.15, b2); al = mix(al, 0.9, b2);
  col = mix(col, uC3 * 1.45, b3); al = mix(al, 1.0, b3);
  col = mix(col, uC4 * 1.75, b4);
  col = mix(col, uC5 * 2.2, b5);
  float a = b0 * al * smoothstep(0.0, 0.12, v) * (1.0 - smoothstep(0.92, 1.0, v));
  // the wall between the camera and him (outward normal toward the camera, whatever the winding) turns into dark navy
  // flame shapes over him with only the tips lit, so he reads as a dark figure inside a blue swirl, never tinted by it
  float near = smoothstep(-0.05, 0.45, vFacing);
  col = mix(col * 1.18, uC0 * 0.12 + uC4 * 0.22 * b5, near);
  float face = mix(0.95, 0.3, near);
  // fade where a sheet turns edge-on, so the cylinder never shows a hard vertical silhouette line
  a *= smoothstep(0.0, 0.32, vEdge) * face;
  a *= clamp(uAmt, 0.0, 1.0);
  gl_FragColor = vec4(col * a * mix(1.0, uAmt, 0.5) * vL.w, a);
}
`;

const arcVert = /* glsl */ `
attribute vec4 aA; // radius, speed, phase, tiltX
attribute vec4 aB; // tiltZ, y, width, span
attribute vec2 aS; // s (0 tail .. 1 head), side (-1..1)
uniform float uT;
uniform float uGrow;
varying vec2 vS;
varying float vFade;
void main() {
  float ang = aA.z + uT * aA.y - (1.0 - aS.x) * aB.w * sign(aA.y);
  float R = aA.x * (1.0 + uGrow * 0.6);
  float w = aB.z * 1.05 * mix(0.12, 1.0, pow(aS.x, 1.4)) * (1.0 - 0.9 * smoothstep(0.84, 1.0, aS.x));
  vec3 p = vec3(cos(ang) * R, aS.y * w * 0.5, sin(ang) * R);
  float cx = cos(aA.w), sx = sin(aA.w);
  p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
  float cz = cos(aB.x), sz = sin(aB.x);
  p = vec3(cz * p.x - sz * p.y, sz * p.x + cz * p.y, p.z);
  p.y += aB.y;
  vS = aS;
  // arcs on the near side of the swirl pass between the camera and him: keep them faint so he stays a dark figure
  vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 ax = (modelMatrix * vec4(0.0, p.y, 0.0, 1.0)).xyz;
  vec2 rr = wp.xz - ax.xz, tc = cameraPosition.xz - ax.xz;
  vFade = 1.0 - 0.88 * smoothstep(-0.1, 0.5, dot(rr, tc) * inversesqrt(max(dot(rr, rr) * dot(tc, tc), 1e-8)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const arcFrag = /* glsl */ `
uniform float uAmt;
uniform vec3 uHead;
uniform vec3 uBody;
varying vec2 vS;
varying float vFade;
void main() {
  float s = vS.x;
  float edge = clamp(1.0 - abs(vS.y), 0.0, 1.0);
  float core = smoothstep(0.35, 0.9, edge);
  vec3 col = mix(uBody, uHead, smoothstep(0.65, 1.0, s) * core);
  float a = pow(max(s, 0.0), 1.3) * smoothstep(0.0, 0.35, edge) * 0.75;
  gl_FragColor = vec4(col * (0.6 + core * 0.9 * smoothstep(0.7, 1.0, s)), a * uAmt * vFade);
}
`;


const sparkVert = /* glsl */ `
attribute vec2 corner;  // x: 0 tail .. 1 head, y: side -1..1
attribute vec4 aS;      // radius, speed, phase, rise speed
attribute vec4 aS2;     // y0, seed, width, life
uniform float uT;
uniform float uAmt;
varying vec2 vC;
varying float vA;
vec3 sparkPos(float t) {
  float life = aS2.w;
  float ph = fract(t / life + aS2.y);
  float ang = aS.z + t * aS.y;
  float r = aS.x * (1.0 + 0.35 * ph);
  return vec3(cos(ang) * r, aS2.x + ph * aS.w * life, sin(ang) * r);
}
void main() {
  float life = aS2.w;
  float ph = fract(uT / life + aS2.y);
  vec4 p0 = modelViewMatrix * vec4(sparkPos(uT), 1.0);
  vec4 p1 = modelViewMatrix * vec4(sparkPos(uT - 0.045), 1.0);
  // avoid wrapping across the phase reset
  if (fract((uT - 0.045) / life + aS2.y) > ph) p1 = p0 + vec4(0.0, -0.02, 0.0, 0.0);
  vec2 d = p0.xy - p1.xy;
  float L = length(d);
  vec2 n = L > 1e-5 ? vec2(-d.y, d.x) / L : vec2(1.0, 0.0);
  vec4 p = mix(p1, p0, corner.x);
  p.xy += n * corner.y * aS2.z;
  vC = corner;
  vA = uAmt * sin(3.14159 * ph);
  gl_Position = projectionMatrix * p;
}
`;

const sparkFrag = /* glsl */ `
uniform vec3 uCol;
varying vec2 vC;
varying float vA;
void main() {
  float a = smoothstep(0.0, 0.6, vC.x) * (1.0 - abs(vC.y)) * vA;
  gl_FragColor = vec4(uCol * a, a);
}
`;

export const VORTEX_DUR = 1.84;

export function buildVortex() {
  const group = new THREE.Group();
  group.name = 'awaken-vortex';
  const rnd = mulberry32(41);
  const reduced = params.reduced;

  /* flame sheets */
  const layers = reduced
    ? [
        { r: 0.75, h: 2.6, flare: 0.25, twist: 0.8, spin: 2.2, I: 1.0 },
        { r: 1.5, h: 3.0, flare: 0.4, twist: -0.6, spin: -1.6, I: 0.8 },
      ]
    : [
        { r: 0.85, h: 2.7, flare: 0.3, twist: 1.1, spin: 2.6, I: 1.0 },
        { r: 1.3, h: 3.4, flare: 0.45, twist: -0.8, spin: -2.0, I: 0.9 },
        { r: 1.9, h: 3.0, flare: 0.5, twist: 0.6, spin: 1.5, I: 0.75 },
        { r: 2.6, h: 1.4, flare: 0.3, twist: 0.4, spin: -1.0, I: 0.7 },
      ];
  const pos: number[] = [], uv: number[] = [], al: number[] = [], idx: number[] = [];
  for (const L of layers) {
    const cols = 56, rows = 14;
    const base = pos.length / 3;
    const seed = rnd() * 10;
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const th = u * Math.PI * 2;
        const rad = L.r * (1 + L.flare * v * v);
        pos.push(Math.cos(th) * rad, v * L.h, Math.sin(th) * rad);
        uv.push(u, v);
        al.push(seed, L.spin, L.twist, L.I);
      }
    }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const a = base + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sg.setAttribute('aL', new THREE.Float32BufferAttribute(al, 4));
  sg.setIndex(idx);
  const sheetU = {
    uT: { value: 0 },
    uAmt: { value: 0 },
    uH: { value: 1 },
    uGrow: { value: 0 },
    uC0: { value: RAMP[0] },
    uC1: { value: RAMP[1] },
    uC2: { value: RAMP[2] },
    uC3: { value: RAMP[3] },
    uC4: { value: RAMP[4] },
    uC5: { value: RAMP[5] },
  };
  const sheetMat = new THREE.ShaderMaterial({
    vertexShader: sheetVert,
    fragmentShader: sheetFrag,
    uniforms: sheetU,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
  });
  const sheets = new THREE.Mesh(sg, sheetMat);
  sheets.frustumCulled = false;
  sheets.renderOrder = 5;
  group.add(sheets);

  /* crescent arcs (ice-blue swirl trails) */
  const arcs = reduced ? 3 : 9;
  const ap: number[] = [], aA: number[] = [], aB: number[] = [], aS: number[] = [], ai: number[] = [];
  for (let i = 0; i < arcs; i++) {
    const segN = 40;
    const R = 0.75 + rnd() * 1.4;
    const speed = (rnd() < 0.5 ? -1 : 1) * (3.2 + rnd() * 2.6);
    const phase = rnd() * Math.PI * 2;
    const tiltX = (rnd() - 0.5) * 0.7;
    const tiltZ = (rnd() - 0.5) * 0.6;
    const y = 0.3 + rnd() * 2.2;
    const w = 0.16 + rnd() * 0.2;
    const span = 1.2 + rnd() * 1.1;
    const base = ap.length / 3;
    for (let s = 0; s <= segN; s++) {
      for (const side of [-1, 1]) {
        ap.push(0, 0, 0);
        aA.push(R, speed, phase, tiltX);
        aB.push(tiltZ, y, w, span);
        aS.push(s / segN, side);
      }
    }
    for (let s = 0; s < segN; s++) {
      const a = base + s * 2;
      ai.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.Float32BufferAttribute(ap, 3));
  ag.setAttribute('aA', new THREE.Float32BufferAttribute(aA, 4));
  ag.setAttribute('aB', new THREE.Float32BufferAttribute(aB, 4));
  ag.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 2));
  ag.setIndex(ai);
  const arcU = {
    uT: { value: 0 },
    uAmt: { value: 0 },
    uGrow: { value: 0 },
    uHead: { value: new THREE.Color(0xc4ecff).multiplyScalar(2.4) },
    uBody: { value: new THREE.Color(0x2c6dff).multiplyScalar(2.0) },
  };
  const arcMat = new THREE.ShaderMaterial({
    vertexShader: arcVert,
    fragmentShader: arcFrag,
    uniforms: arcU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const arcMesh = new THREE.Mesh(ag, arcMat);
  arcMesh.frustumCulled = false;
  arcMesh.renderOrder = 6;
  group.add(arcMesh);

  /* sparks: fast cyan streaks spiralling up (60 fps, not stepped) */
  const ns = reduced ? 30 : 72;
  const sg2 = new THREE.InstancedBufferGeometry();
  sg2.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
  sg2.setIndex([0, 1, 2, 0, 2, 3]);
  const s1: number[] = [], s2: number[] = [];
  for (let i = 0; i < ns; i++) {
    s1.push(0.5 + rnd() * 1.9, (rnd() < 0.5 ? -1 : 1) * (3.5 + rnd() * 4), rnd() * Math.PI * 2, 1.2 + rnd() * 1.8);
    s2.push(rnd() * 0.6, rnd(), 0.004 + rnd() * 0.007, 0.5 + rnd() * 0.7);
  }
  sg2.setAttribute('aS', new THREE.InstancedBufferAttribute(new Float32Array(s1), 4));
  sg2.setAttribute('aS2', new THREE.InstancedBufferAttribute(new Float32Array(s2), 4));
  sg2.instanceCount = ns;
  const sparkU = { uT: { value: 0 }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(0xb2dcff).multiplyScalar(1.9) } };
  const sparkMat = new THREE.ShaderMaterial({
    vertexShader: sparkVert,
    fragmentShader: sparkFrag,
    uniforms: sparkU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Mesh(sg2, sparkMat);
  sparks.frustumCulled = false;
  sparks.renderOrder = 7;
  group.add(sparks);

  let level = 0;
  /** p over 1.84 s. Effects are drawn on 2s (12 fps); luminance pulses at 2.5 Hz (<= 3/s). */
  const set = (p: number) => {
    const t = p * VORTEX_DUR;
    if (p <= 0 || p >= 1) {
      group.visible = false;
      level = 0;
      return;
    }
    group.visible = true;
    const tq = Math.floor(t * 12) / 12;
    const erupt = smoothstep(0, 0.27, t);
    const over = 1 + 0.1 * Math.exp(-Math.pow((t - 0.3) / 0.12, 2));
    const pulse = 1 + (params.reduced ? 0.03 : 0.11) * Math.sin(Math.PI * 2 * 2.5 * tq);
    const end = 1 - smoothstep(VORTEX_DUR - 0.42, VORTEX_DUR, t);
    const amt = erupt * over * pulse * end;
    sheetU.uT.value = tq;
    sheetU.uAmt.value = amt;
    sheetU.uH.value = 0.3 + 0.7 * smoothstep(0, 0.38, t) - 0.35 * (1 - end);
    sheetU.uGrow.value = 0.35 * (1 - end);
    arcU.uT.value = tq;
    arcU.uAmt.value = clamp(erupt * end * (t > 0.12 ? 1 : 0));
    arcU.uGrow.value = 0.25 * (1 - end) - 0.15 * (1 - erupt);
    sparkU.uT.value = t;
    sparkU.uAmt.value = clamp(erupt * end * 1.2);
    level = amt;
  };
  return {
    group,
    set,
    get level() {
      return level;
    },
  };
}
