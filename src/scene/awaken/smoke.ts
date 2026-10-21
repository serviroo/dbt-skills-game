import * as THREE from 'three';
import { mulberry32 } from '../../core/math';
import { params } from '../../core/params';
import { light } from '../toon';
import { FX_NOISE } from './pool';
import { ATMOS } from './materials';

/**
 * All AWAKEN smoke in one instanced draw:
 *   kind 0 = the violet smoke burst off the wanderer (870 ms): dense, soft, rolling violet-to-black billows with hot lilac
 *            cores, lit from the inside (two-tap self shadow toward the burst centre), plus the one soft lilac swell
 *   kind 1 = cold mist trailing off each soldier (ink-dark while it emerges, pale cold mist once it stands)
 *   kind 2 = grey-blue puffs rolling in from the left (#3A4260, lit tops)
 *   kind 3 = low fog banks between and behind the ranks, backlit by the gate, so the back ranks drown in fog
 *   kind 4 = motes of cold light rising off the pool
 * Every sprite is a pure function of (uTime, uBurst, uRoll, uMist, its soldier's rise), so it seeks frame-exact.
 */

const vert = /* glsl */ `
attribute vec2 corner;
attribute vec4 aP;   // x, y, z, size
attribute vec4 aD;   // kind, seed, a, b
attribute vec4 aDyn; // rise r, body y offset, -, -
uniform float uTime;
uniform float uBurst;
uniform float uRoll;
uniform float uMist;
uniform float uAspect;
uniform float uLinger;
uniform float uAtmos;
uniform float uRimStrength;
uniform vec3 uCenter;
uniform vec3 uGatePos;
varying vec2 vUv;
varying float vA;
varying float vKind;
varying float vSeed;
varying float vHeat;
varying float vY;
varying vec2 vL;
varying float vRot;
varying float vLit;
varying float vP;

// sin-free hash (Hoskins hash11): the same smoke on every GPU
float hh(float n) { n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }

void main() {
  float kind = aD.x, seed = aD.y;
  vec3 c = aP.xyz;
  float size = aP.w;
  float alpha = 0.0;
  float heat = 0.0;
  vec2 sc = vec2(1.0);
  float rot = 0.0;
  bool cyl = true;
  vL = vec2(0.0, 1.0);
  vRot = 0.0;
  vLit = 0.0;
  vP = 0.0;
  float gi = clamp((uRimStrength - 0.6) / 2.2, 0.0, 1.0);
  if (kind < 0.5) {
    // burst billow: starts packed around his body, rolls outward and up on an ease-out, swirling slightly
    float p = clamp(uBurst, 0.0, 1.0);
    float ep = 1.0 - pow(1.0 - p, 2.4);
    float swirl = (hh(seed + 9.0) - 0.5) * 0.9;
    float ang = aD.z + ep * swirl;
    float r = mix(0.15 + 0.35 * hh(seed + 3.0), aD.w, ep);
    c = uCenter + vec3(cos(ang) * r, aP.y + ep * (0.2 + 1.1 * hh(seed + 1.0)), sin(ang) * r);
    alpha = smoothstep(0.0, 0.07, p) * (1.0 - smoothstep(0.5, 1.0, p)) * step(0.0001, uBurst) * step(uBurst, 0.9999);
    size *= mix(0.45, 1.35, ep);
    heat = step(0.5, hh(seed + 2.0)) * (0.6 + 0.4 * hh(seed + 4.0));
    cyl = false;
    vRot = seed * 6.0 + p * 2.2 * sign(swirl + 0.001);
    vP = p;
    // light direction (towards the burst core, in view space) for the inner glow and self-shadow
    vec4 vc = viewMatrix * vec4(c, 1.0);
    vec4 vk = viewMatrix * vec4(uCenter + vec3(0.0, 1.1, 0.0), 1.0);
    vec2 dl = vk.xy / max(0.2, -vk.z) - vc.xy / max(0.2, -vc.z);
    vL = length(dl) > 1e-4 ? normalize(dl) : vec2(0.0, -1.0);
    // billows behind him show the camera their lit side (a glow he silhouettes against); those in front, their dark side
    vLit = smoothstep(-0.7, 0.9, vk.z - vc.z);
    // never let a billow fill the lens: fade puffs that reach the camera
    alpha *= smoothstep(0.45, 1.4, -vc.z);
  } else if (kind < 1.5) {
    float r = aDyn.x;
    // ink-dark while emerging, then pale cold mist keeps trailing off the standing soldier
    float act = smoothstep(0.0, 0.05, r) * mix(1.0, 0.62, smoothstep(0.55, 0.92, r));
    float rate = 0.32 + 0.22 * hh(seed);
    float ph = fract(uTime * rate + hh(seed + 3.0));
    float top = 2.05 + aDyn.y;
    float h0 = clamp(top - 0.12 - hh(seed + 4.0) * 1.75, 0.03, 2.1);
    float a = aD.z;
    float rad = 0.12 + 0.14 * hh(seed + 5.0) + ph * 0.25;
    vec3 drift = vec3(0.55, 0.0, -0.25) * ph * ph * smoothstep(0.5, 0.95, r);
    c = aP.xyz + vec3(cos(a) * rad, h0 + ph * (0.55 + 0.6 * hh(seed + 6.0)), sin(a) * rad) + drift;
    alpha = act * pow(sin(3.14159 * ph), 0.8) * step(0.0, top - 0.05);
    // close to the lens the wisps thin out, so a close-up keeps the visor and eyes clear
    alpha *= smoothstep(1.3, 2.9, distance(c, cameraPosition));
    size *= 0.8 + 1.4 * ph;
    sc = vec2(0.55, 1.0);
    rot = (hh(seed + 8.0) - 0.5) * 0.6 - ph * 0.35 * smoothstep(0.5, 0.95, r);
    vP = smoothstep(0.55, 0.92, r);
    vLit = gi;
  } else if (kind < 2.5) {
    float p = uRoll;
    float t = p * 2.5;
    float x0 = aP.x - 5.6 + t * (1.5 + 0.7 * hh(seed));
    c = vec3(x0, aP.y + 0.08 * sin(uTime * 0.7 + seed), aP.z);
    alpha = smoothstep(0.0, 0.3, p) * step(0.0001, p) * 0.7;
    size *= 0.85 + 0.25 * smoothstep(0.0, 1.0, p);
    rot = uTime * 0.12 * (hh(seed + 7.0) - 0.5);
    sc = vec2(1.0, 0.72);
  } else if (kind < 3.5) {
    // fog bank: wide, low, slowly drifting; lit from behind by the gate when it lies on the line of sight to it
    c = aP.xyz + vec3(sin(uTime * 0.07 + seed * 6.0) * 0.5 + uTime * 0.06, 0.0, 0.0);
    float pres = max(uMist * mix(0.55, 1.0, uAtmos), uLinger * 0.8);
    alpha = pres * (0.6 + 0.4 * hh(seed + 9.0));
    sc = vec2(1.0, 0.3);
    vec3 vd = normalize(c + vec3(0.0, 0.4, 0.0) - cameraPosition);
    vec3 gd = normalize(uGatePos - cameraPosition);
    float s = max(dot(vd, gd), 0.0);
    vLit = (pow(s, 14.0) * 0.9 + pow(s, 4.0) * 0.2) * gi * (c.z < -6.0 ? 1.4 : 0.8);
    vP = uLinger;
  } else {
    float rate = 0.12 + 0.1 * hh(seed);
    float ph = fract(uTime * rate + hh(seed + 1.0));
    c = aP.xyz + vec3(sin(uTime * 0.6 + seed * 9.0) * 0.15, ph * 3.2, cos(uTime * 0.5 + seed * 7.0) * 0.15);
    alpha = uMist * sin(3.14159 * ph) * (0.5 + 0.5 * sin(uTime * 3.0 + seed * 20.0));
    heat = step(0.7, hh(seed + 2.0));
    sc = vec2(1.0);
  }
  vUv = corner;
  vA = alpha;
  vKind = kind;
  vSeed = seed;
  vHeat = heat;
  vec3 wp;
  if (cyl) {
    vec3 vd = normalize(cameraPosition - c);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), vd));
    vec3 up = vec3(0.0, 1.0, 0.0);
    float cr = cos(rot), sr = sin(rot);
    vec2 q = corner * sc * size;
    q = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
    wp = c + right * q.x + up * q.y;
    vY = wp.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  } else {
    vec4 mv = viewMatrix * vec4(c, 1.0);
    float cr = cos(rot), sr = sin(rot);
    vec2 q = corner * sc * size;
    q = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
    mv.xy += q;
    vY = c.y + q.y;
    gl_Position = projectionMatrix * mv;
  }
  if (alpha <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const frag = /* glsl */ `
uniform float uTime;
uniform float uSwell;
uniform vec3 uGateHaze;
varying vec2 vUv;
varying float vA;
varying float vKind;
varying float vSeed;
varying float vHeat;
varying float vY;
varying vec2 vL;
varying float vRot;
varying float vLit;
varying float vP;
${FX_NOISE}
void main() {
  vec2 uv = vUv;
  float d = length(uv);
  vec3 col; float a; vec3 glow = vec3(0.0);
  if (vKind < 0.5) {
    // billow: domain-warped cauliflower lumps that roll; the body is near black, the edges facing the hot core catch
    // a violet light band (two taps toward the core), and a few billows carry a small hot lilac core early on
    if (d > 0.985) discard;
    float cr = cos(vRot), sr = sin(vRot);
    vec2 q = mat2(cr, -sr, sr, cr) * uv * 1.1 + vSeed * 3.1;
    vec2 w = vec2(vn2(q * 1.3 + vec2(0.0, uTime * 0.35)), vn2(q * 1.3 + vec2(5.2, 1.3) - uTime * 0.3));
    vec2 qq = q * 1.5 + w * 1.9;
    float lump = 1.0 - abs(2.0 * vn2(qq * 1.9 + 3.3) - 1.0);
    float n = fbm2(qq) * 0.75 + lump * 0.3;
    vec2 lq = mat2(cr, -sr, sr, cr) * vL;
    float n2 = fbm2(qq + lq * 0.28) * 0.75 + lump * 0.3;
    float dens = clamp((1.0 - d) * 1.6 + (n - 0.55) * 1.8 - 0.12, 0.0, 1.0) * (1.0 - smoothstep(0.7, 0.98, d));
    float aa = fwidth(dens) * 1.5 + 0.06;
    a = smoothstep(0.0, aa + 0.12, dens);
    float lit = clamp(0.45 - (n2 - n) * 4.0, 0.0, 1.0);
    float side = clamp(dot(uv, vL) * 0.7 + 0.45, 0.0, 1.0);
    float band = smoothstep(0.0, 0.14, dens) * (1.0 - smoothstep(0.22, 0.55, dens));
    vec3 black = srgb(vec3(0.03, 0.022, 0.065));
    vec3 body = mix(srgb(vec3(0.07, 0.045, 0.15)), srgb(vec3(0.16, 0.1, 0.35)), vLit);
    vec3 litV = srgb(vec3(0.34, 0.22, 0.72));
    col = mix(body, black, smoothstep(0.15, 0.75, dens) * mix(1.0, 0.6, vLit));
    float edgeLit = smoothstep(0.3, 0.8, lit * side * mix(0.55, 1.3, vLit)) * (0.3 + 0.7 * band) * a;
    col = mix(col, litV, edgeLit * 0.8);
    float core = smoothstep(0.7, 0.9, n) * smoothstep(0.55, 0.95, dens) * smoothstep(0.3, 0.85, side) * (0.25 + 0.75 * vLit);
    float early = 1.0 - smoothstep(0.06, 0.55, vP);
    glow = srgb(vec3(0.79, 0.62, 1.0)) * core * vHeat * early * 0.9;
    glow += srgb(vec3(0.72, 0.6, 1.0)) * uSwell * (edgeLit * 0.16 + core * 0.9 + smoothstep(0.3, 0.9, dens) * side * 0.05);
    a *= 0.96;
  } else if (vKind < 1.5) {
    // mist trail: tapered upward; ink while the soldier emerges, pale cold mist once it stands
    float taper = mix(1.0, 0.4, smoothstep(-1.0, 1.0, uv.y));
    float n = fbm2(uv * vec2(2.2, 1.2) + vec2(vSeed * 5.0, -uTime * 0.6));
    float shape = 1.0 - length(vec2(uv.x / taper, uv.y * 0.9)) + (n - 0.5) * 0.9;
    a = smoothstep(0.0, 0.55, shape) * (1.0 - smoothstep(0.75, 1.0, d));
    vec3 ink = srgb(vec3(0.03, 0.025, 0.06));
    vec3 cold = srgb(vec3(0.26, 0.34, 0.42)) * (0.45 + 0.75 * vLit);
    col = mix(ink, cold, vP);
    glow = srgb(vec3(0.55, 0.32, 0.95)) * a * (1.0 - smoothstep(0.08, 0.4, shape)) * 0.22 * (1.0 - vP);
    a *= mix(0.7, 0.16, vP);
  } else if (vKind < 2.5) {
    // soft grey-blue puff, lit on top
    float n = fbm2(uv * 1.6 + vec2(vSeed * 4.0, uTime * 0.05));
    float shape = 1.0 - d + (n - 0.5) * 0.7;
    a = smoothstep(0.0, 0.45, shape) * (1.0 - smoothstep(0.75, 1.0, d));
    float lit = smoothstep(0.0, 0.5, shape + uv.y * 0.35 - 0.1);
    col = mix(srgb(vec3(0.05, 0.055, 0.09)), srgb(vec3(0.14, 0.16, 0.24)), lit);
    col += srgb(vec3(0.5, 0.56, 0.58)) * smoothstep(0.45, 0.75, shape + uv.y * 0.3) * 0.06;
    a *= 0.75;
  } else if (vKind > 3.5) {
    // mote: a 1-2 px point of cold light, a few violet
    float m = exp(-d * d * 9.0);
    a = 0.0;
    col = vec3(0.0);
    glow = mix(srgb(vec3(0.55, 0.85, 1.0)), srgb(vec3(0.62, 0.45, 1.0)), vHeat) * m * 0.9;
  } else {
    // fog bank: near-black, lifted to a cold glow where the gate shines through it; violet just after the burst
    float n = fbm2(uv * vec2(1.3, 2.6) + vec2(vSeed * 3.0 + uTime * 0.035, 0.0));
    float n2 = vn2(uv * vec2(4.1, 6.0) + vec2(-uTime * 0.05, vSeed));
    float shape = 1.0 - length(uv * vec2(1.0, 1.15)) + (n - 0.5) * 0.9 + (n2 - 0.5) * 0.2;
    a = smoothstep(0.0, 0.55, shape) * 0.8 * (1.0 - smoothstep(0.72, 1.0, length(uv * vec2(1.0, 1.1))));
    float top = smoothstep(-0.2, 0.7, uv.y);
    col = mix(srgb(vec3(0.012, 0.014, 0.028)), srgb(vec3(0.03, 0.035, 0.07)), top);
    col = mix(col, srgb(vec3(0.07, 0.04, 0.16)), vP * 0.8);
    glow = uGateHaze * vLit * (0.4 + 0.9 * n) * a * 2.2;
  }
  a *= vA * smoothstep(0.0, vKind > 2.5 ? 0.05 : vKind < 0.5 ? 0.55 : 0.2, vY);
  gl_FragColor = vec4(col * a + glow * vA, a);
}
`;

export interface SmokeSoldier {
  x: number;
  z: number;
  hero: boolean;
}

export function buildSmoke(soldiers: SmokeSoldier[], center: THREE.Vector3) {
  const reduced = params.reduced;
  const rnd = mulberry32(77);
  const P: number[] = [], D: number[] = [], owner: number[] = [];
  // fog banks first (drawn first: furthest back in practice), back rows to front rows
  const bankZ = [-10.5, -8.8, -7.2, -5.9, -4.7, -3.4, -2.2];
  for (let bi = 0; bi < bankZ.length; bi++) {
    const z = bankZ[bi];
    const n = reduced ? 2 : bi < 2 ? 4 : 5;
    for (let i = 0; i < n; i++) {
      const x = -9 + (18 * (i + 0.5)) / n + (rnd() - 0.5) * 2.2;
      P.push(x, 0.18 + rnd() * 0.3 + (bi < 3 ? 0.25 : 0), z + (rnd() - 0.5) * 0.5, 2.8 + rnd() * 1.8 + (bi < 3 ? 1.0 : 0));
      D.push(3, rnd() * 100, 0, 0);
      owner.push(-3);
    }
  }
  // mist trails
  soldiers.forEach((s, si) => {
    const n = reduced ? 2 : s.hero ? 12 : 3;
    for (let i = 0; i < n; i++) {
      P.push(s.x, 0, s.z, s.hero ? 0.16 + rnd() * 0.1 : 0.24 + rnd() * 0.1);
      D.push(1, rnd() * 100, rnd() * Math.PI * 2, 0);
      owner.push(si);
    }
  });
  // burst billows
  const nb = reduced ? 10 : 26;
  for (let i = 0; i < nb; i++) {
    const ang = (i / nb) * Math.PI * 2 + rnd() * 0.5;
    P.push(0, 0.1 + rnd() * 2.0, 0, 0.75 + rnd() * 0.75);
    D.push(0, rnd() * 100, ang, 1.4 + rnd() * 2.2);
    owner.push(-1);
  }
  // motes rising off the pool
  const nmo = reduced ? 30 : 110;
  for (let i = 0; i < nmo; i++) {
    const r = Math.sqrt(rnd()) * 8.5;
    const a = rnd() * Math.PI * 2;
    P.push(Math.cos(a) * r, 0.05, Math.sin(a) * r - 2.0, 0.022 + rnd() * 0.02);
    D.push(4, rnd() * 100, 0, 0);
    owner.push(-4);
  }
  // rolling puffs
  const np = reduced ? 6 : 12;
  for (let i = 0; i < np; i++) {
    P.push(-2.5 - rnd() * 3.0, 0.3 + rnd() * 0.7, -1.5 + rnd() * 6.0, 0.9 + rnd() * 1.0);
    D.push(2, rnd() * 100, 0, 0);
    owner.push(-2);
  }
  const count = owner.length;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(P), 4));
  g.setAttribute('aD', new THREE.InstancedBufferAttribute(new Float32Array(D), 4));
  const dyn = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  dyn.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aDyn', dyn);
  g.instanceCount = count;
  const uniforms = {
    uTime: { value: 0 },
    uBurst: { value: 0 },
    uRoll: { value: 0 },
    uMist: { value: 0 },
    uSwell: { value: 0 },
    uAspect: { value: 1 },
    uLinger: { value: 0 },
    uCenter: { value: center.clone() },
    uRimStrength: light.uRimStrength,
    uGatePos: ATMOS.uGatePos,
    uGateHaze: ATMOS.uGateHaze,
    uAtmos: ATMOS.uAtmos,
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;

  /** rise[i] = soldier i's local rise 0..1, yOff[i] = its body y offset (negative while underground). */
  const setSoldiers = (rise: ArrayLike<number>, yOff: ArrayLike<number>) => {
    const a = dyn.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const o = owner[i];
      if (o < 0) continue;
      a[i * 4] = rise[o];
      a[i * 4 + 1] = yOff[o];
    }
    dyn.needsUpdate = true;
  };
  return { mesh, uniforms, setSoldiers, count };
}
