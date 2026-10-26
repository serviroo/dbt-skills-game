import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/math';

/**
 * The camp's modelling kit: faceted solids placed by joints, swept tubes, and the materials. Every surface carries a
 * small grain (cloth weave, hammered steel, fur, bark) in its own object space, so nothing reads as a flat fill and the
 * grain doesn't swim when a figure breathes.
 */

export type V3 = [number, number, number];
export interface Xf {
  p?: V3;
  r?: V3;
  s?: V3 | number;
}
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

export function xf<G extends THREE.BufferGeometry>(g: G, t: Xf = {}): G {
  const s = t.s === undefined ? [1, 1, 1] : typeof t.s === 'number' ? [t.s, t.s, t.s] : t.s;
  _q.setFromEuler(_e.set(...(t.r ?? [0, 0, 0])));
  _m.compose(new THREE.Vector3(...(t.p ?? [0, 0, 0])), _q, new THREE.Vector3(...s));
  g.applyMatrix4(_m);
  return g;
}

/** A tapered faceted cylinder from joint a to joint b (radius ra at a, rb at b). */
export function limb(a: V3, b: V3, ra: number, rb: number, seg = 6): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(rb, ra, d.length(), seg, 1);
  g.applyQuaternion(_q.setFromUnitVectors(_up, d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

/** A low faceted ball (icosahedron), scaled to an ellipsoid. */
export function ball(r: number, at: V3, s: V3 = [1, 1, 1], detail = 1) {
  return xf(new THREE.IcosahedronGeometry(r, detail), { p: at, s });
}

/** A tube swept through points, its radius going from r0 to r1 along the way. */
export function sweep(pts: V3[], r0: number, r1: number, seg = 5, steps = 10): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(steps, false);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const c = curve.getPointAt(u);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).add(frames.binormals[i].clone().multiplyScalar(Math.sin(a)));
      pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
    }
  }
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      idx.push(a, a + seg, b, b, a + seg, b + seg);
    }
  // close both ends so a tube never shows its inside
  const capA = pos.length / 3;
  const s0 = curve.getPointAt(0);
  pos.push(s0.x, s0.y, s0.z);
  const capB = capA + 1;
  const s1 = curve.getPointAt(1);
  pos.push(s1.x, s1.y, s1.z);
  for (let j = 0; j < seg; j++) {
    idx.push(capA, (j + 1) % seg, j);
    idx.push(capB, steps * seg + j, steps * seg + ((j + 1) % seg));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat shape (2D points, x right and y up) extruded along z, centred on z = 0. */
export function slab(pts: [number, number][], depth: number, bevel = 0, holes: [number, number][][] = []) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Nudges every vertex by a seeded amount, keeping shared corners together, for rocks, fur and bark. */
export function jitter(g: THREE.BufferGeometry, amt: number | V3, seed: number) {
  const a = typeof amt === 'number' ? [amt, amt, amt] : amt;
  const p = g.attributes.position as THREE.BufferAttribute;
  const seen = new Map<string, V3>();
  const rnd = mulberry32(seed);
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let o = seen.get(k);
    if (!o) seen.set(k, (o = [(rnd() - 0.5) * 2 * a[0], (rnd() - 0.5) * 2 * a[1], (rnd() - 0.5) * 2 * a[2]]));
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function plain(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((n.attributes.position.count * 2) as number), 2));
  n.morphAttributes = {};
  return n;
}

/** Collects parts by material and merges each material's parts into one mesh, so a figure costs a few draw calls. */
export class Parts {
  private by = new Map<string, THREE.BufferGeometry[]>();
  add(mat: string, ...gs: THREE.BufferGeometry[]) {
    const list = this.by.get(mat) ?? [];
    list.push(...gs.map(plain));
    this.by.set(mat, list);
    return this;
  }
  build(mats: Mats, name = ''): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const [k, list] of this.by) {
      const merged = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[k as MatKey]);
      mesh.name = `${name}:${k}`;
      g.add(mesh);
    }
    this.by.clear();
    return g;
  }
}

// ---------------- materials ----------------

const GRAIN_HEAD = /* glsl */ `
varying vec3 vGrainPos;
uniform vec3 uGrainScale;
uniform float uGrainColor;
uniform float uGrainRough;
uniform vec3 uRim;
uniform float uRimPow;
float gHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float gNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gHash(i), gHash(i + vec3(1, 0, 0)), f.x), mix(gHash(i + vec3(0, 1, 0)), gHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(gHash(i + vec3(0, 0, 1)), gHash(i + vec3(1, 0, 1)), f.x), mix(gHash(i + vec3(0, 1, 1)), gHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float grain(vec3 p) { return gNoise(p * uGrainScale) * 0.62 + gNoise(p * uGrainScale * 2.9 + 7.1) * 0.38; }
`;

export interface Grain {
  scale: V3;
  /** how far the albedo wanders, as a share */
  color: number;
  /** how far the roughness wanders */
  rough: number;
  rim?: THREE.ColorRepresentation;
  rimStrength?: number;
  rimPow?: number;
}

const waveUniforms = { uTime: { value: 0 } };
/** One clock for every swaying thing (capes, banners, grass), advanced by the runtime. */
export const sway = waveUniforms;

/**
 * A standard (PBR) material with grain, a faceted look and an optional rim of the Lantern's blue, the way the 2D
 * roster draws its silhouettes. `wave` bends vertices with height (cloth hanging from y = top, grass from its base).
 */
export function grained(params: THREE.MeshStandardMaterialParameters, grain: Grain, wave?: { top: number; len: number; amp: number; speed: number; mode: 'hang' | 'blade' }) {
  const m = new THREE.MeshStandardMaterial({ flatShading: true, ...params });
  const rim = new THREE.Color(grain.rim ?? 0x000000).multiplyScalar(grain.rimStrength ?? 0);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrainScale = { value: new THREE.Vector3(...grain.scale) };
    sh.uniforms.uGrainColor = { value: grain.color };
    sh.uniforms.uGrainRough = { value: grain.rough };
    sh.uniforms.uRim = { value: rim };
    sh.uniforms.uRimPow = { value: grain.rimPow ?? 3 };
    sh.uniforms.uTime = waveUniforms.uTime;
    sh.uniforms.uWave = { value: new THREE.Vector4(wave?.top ?? 0, wave?.len ?? 1, wave?.amp ?? 0, wave?.speed ?? 0) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGrainPos;\nuniform float uTime;\nuniform vec4 uWave;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${
          wave?.mode === 'hang'
            ? `{ float d = clamp((uWave.x - position.y) / uWave.y, 0.0, 1.0); float w = d * d;
                 transformed.z += w * uWave.z * sin(uTime * uWave.w + position.x * 2.1);
                 transformed.x += w * uWave.z * 0.4 * sin(uTime * uWave.w * 0.7 + position.y * 3.0); }`
            : wave?.mode === 'blade'
              ? `{ float d = clamp(position.y / uWave.y, 0.0, 1.0); float w = d * d;
                 #ifdef USE_INSTANCING
                 vec3 ip = instanceMatrix[3].xyz;
                 #else
                 vec3 ip = vec3(0.0);
                 #endif
                 transformed.x += w * uWave.z * sin(uTime * uWave.w + ip.x * 0.7 + ip.z * 0.4);
                 transformed.z += w * uWave.z * 0.5 * sin(uTime * uWave.w * 0.8 + ip.z * 0.9); }`
              : ''
        }
        #ifdef USE_INSTANCING
        vGrainPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
        vGrainPos = transformed;
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GRAIN_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nfloat gN = grain(vGrainPos);\ndiffuseColor.rgb *= 1.0 + (gN - 0.5) * 2.0 * uGrainColor;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (grain(vGrainPos.zxy + 3.3) - 0.5) * 2.0 * uGrainRough, 0.04, 1.0);`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n{ float fr = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPow); totalEmissiveRadiance += uRim * fr; }`,
      );
  };
  // grain, rim and sway are all uniforms, so every material of one kind (still, hanging cloth, grass) shares one
  // program: fewer shaders to build, which is what a slow GPU or a software renderer waits on before the first frame
  m.customProgramCacheKey = () => `grain:${wave?.mode ?? ''}`;
  return m;
}

/** A light source's own colour, in scene light units (above 1 reads as glowing after the AgX curve). */
export const lit = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);

export type MatKey =
  | 'steel'
  | 'plate'
  | 'trim'
  | 'cloth'
  | 'cape'
  | 'cloak'
  | 'banner'
  | 'bannerTrim'
  | 'bannerGlow'
  | 'plume'
  | 'leather'
  | 'fur'
  | 'horn'
  | 'membrane'
  | 'eye'
  | 'eyeSoft'
  | 'visor'
  | 'wood'
  | 'woodEnd'
  | 'bark'
  | 'needles'
  | 'canvas'
  | 'rope'
  | 'stone'
  | 'ash'
  | 'cube'
  | 'iron'
  | 'glass'
  | 'flame';
export type Mats = Record<MatKey, THREE.Material>;

const RIM = 0x4fb8ff;
/** the banner's sway, shared by the cloth and the emblem stitched on it so they move as one */
const BANNER_WAVE = { top: 2.53, len: 1.3, amp: 0.03, speed: 0.8, mode: 'hang' } as const;

/** Every material in the camp. The shadows are deep navy with the Lantern's rim; steel and wood are real and cool. */
export function makeMats(): Mats {
  const cloth = (color: number, wave?: Parameters<typeof grained>[2], rimStrength = 0.32) =>
    grained({ color, roughness: 0.9, metalness: 0, side: wave ? THREE.DoubleSide : THREE.FrontSide }, { scale: [34, 34, 34], color: 0.16, rough: 0.06, rim: RIM, rimStrength, rimPow: 2.6 }, wave);
  return {
    steel: grained({ color: 0x8794ad, roughness: 0.32, metalness: 0.9 }, { scale: [5, 5, 5], color: 0.14, rough: 0.12, rim: RIM, rimStrength: 0.12 }),
    plate: grained({ color: 0x2b3650, roughness: 0.42, metalness: 0.78 }, { scale: [6, 6, 6], color: 0.18, rough: 0.14, rim: RIM, rimStrength: 0.38, rimPow: 2.4 }),
    trim: grained({ color: 0x9fb1cf, roughness: 0.28, metalness: 0.95 }, { scale: [9, 9, 9], color: 0.1, rough: 0.08, rim: RIM, rimStrength: 0.15 }),
    cloth: cloth(0x141d33),
    cape: cloth(0x111a31, { top: 1.5, len: 1.4, amp: 0.035, speed: 0.9, mode: 'hang' }, 0.36),
    cloak: cloth(0x101828, { top: 1.62, len: 1.6, amp: 0.025, speed: 0.75, mode: 'hang' }, 0.34),
    banner: cloth(0x15244a, BANNER_WAVE, 0.28),
    bannerTrim: grained({ color: 0x9fb1cf, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }, { scale: [9, 9, 9], color: 0.1, rough: 0.08, rim: RIM, rimStrength: 0.15 }, BANNER_WAVE),
    bannerGlow: grained({ color: 0x000000, emissive: lit(0x7fcfff, 1.7), roughness: 1, metalness: 0, side: THREE.DoubleSide }, { scale: [1, 1, 1], color: 0, rough: 0 }, BANNER_WAVE),
    plume: cloth(0x1c2350, undefined, 0.5),
    leather: grained({ color: 0x2a2a33, roughness: 0.72, metalness: 0 }, { scale: [22, 22, 22], color: 0.14, rough: 0.1, rim: RIM, rimStrength: 0.2 }),
    fur: grained({ color: 0x151b2d, roughness: 0.96, metalness: 0 }, { scale: [26, 26, 26], color: 0.28, rough: 0.03, rim: RIM, rimStrength: 0.36, rimPow: 2.2 }),
    horn: grained({ color: 0x252b3d, roughness: 0.5, metalness: 0.3 }, { scale: [3, 30, 3], color: 0.2, rough: 0.1, rim: RIM, rimStrength: 0.35 }),
    membrane: grained({ color: 0x1b1a3a, roughness: 0.62, metalness: 0 }, { scale: [12, 12, 12], color: 0.2, rough: 0.1, rim: 0x7b3fe4, rimStrength: 0.28, rimPow: 2 }),
    eye: new THREE.MeshBasicMaterial({ color: lit(0xcfefff, 3.2) }),
    eyeSoft: new THREE.MeshBasicMaterial({ color: lit(0xa8dcff, 1.2) }),
    visor: grained({ color: 0x030409, roughness: 1, metalness: 0 }, { scale: [1, 1, 1], color: 0, rough: 0 }),
    wood: grained({ color: 0x3a3631, roughness: 0.82, metalness: 0 }, { scale: [3, 26, 3], color: 0.22, rough: 0.08 }),
    woodEnd: grained({ color: 0x57504a, roughness: 0.9, metalness: 0 }, { scale: [40, 40, 40], color: 0.25, rough: 0.05 }),
    bark: grained({ color: 0x24221f, roughness: 0.96, metalness: 0 }, { scale: [9, 30, 9], color: 0.3, rough: 0.03 }),
    needles: grained({ color: 0x14231f, roughness: 0.9, metalness: 0 }, { scale: [14, 14, 14], color: 0.3, rough: 0.04, rim: RIM, rimStrength: 0.08, rimPow: 3 }),
    canvas: grained({ color: 0x2c3a52, roughness: 0.94, metalness: 0 }, { scale: [20, 20, 20], color: 0.14, rough: 0.04 }),
    rope: grained({ color: 0x4a4f5a, roughness: 0.95, metalness: 0 }, { scale: [40, 40, 40], color: 0.2, rough: 0.03 }),
    stone: grained({ color: 0x323949, roughness: 0.9, metalness: 0.02 }, { scale: [4, 4, 4], color: 0.26, rough: 0.07 }),
    ash: grained({ color: 0x15181f, roughness: 1, metalness: 0, emissive: lit(0x2f8fd8, 0.18) }, { scale: [9, 9, 9], color: 0.45, rough: 0.02 }),
    cube: grained({ color: 0x232c42, roughness: 0.55, metalness: 0.35 }, { scale: [7, 7, 7], color: 0.12, rough: 0.1, rim: RIM, rimStrength: 0.36, rimPow: 2.2 }),
    iron: grained({ color: 0x343a48, roughness: 0.5, metalness: 0.85 }, { scale: [8, 8, 8], color: 0.2, rough: 0.12 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, emissive: 0x4fb8ff, emissiveIntensity: 0.7, side: THREE.DoubleSide }),
    flame: new THREE.MeshBasicMaterial({ color: lit(0x9fdcff, 3.6) }),
  };
}
