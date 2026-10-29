import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShadowId } from '../../content/roster-lines';
import { mulberry32 } from '../../core/math';
import { ball, grained, jitter, limb, Parts, slab, sweep, xf, type Mats, type V3 } from './kit';

/**
 * The camp around the Lantern: the ground, the hearth (a blue fire, the Lantern's own colour), the Lantern on its crook
 * pole, a tent, rocks, grass and a ring of pines. Static parts merge by material and the grass and pines are instanced,
 * so the whole world is a handful of draws. The hearth and the Lantern are the only light sources, each glowing in two
 * layers (a core and a halo), and their light only breathes slowly: the Lantern once every five seconds, the fire on
 * two slow swells.
 */

/** Where each watcher stands (x, z), which way they face (radians about y), how high (on a rock) and how far they reach. */
export const SPOTS: Record<ShadowId, { at: [number, number]; face: number; y?: number; r?: number }> = {
  sable: { at: [1.75, 1.05], face: -0.55 },
  anvil: { at: [-1.85, 1.0], face: 0.6 },
  block: { at: [0.75, 2.05], face: -0.25 },
  bramble: { at: [-1.35, 2.0], face: -0.4, r: 1.2 },
  harrow: { at: [-0.95, -2.3], face: 0.2, r: 0.55 },
  crest: { at: [1.35, -2.75], face: -0.12, r: 0.5 },
  vesper: { at: [2.95, -1.3], face: -0.85, y: 0.66, r: 0.75 },
};
export const HEARTH: V3 = [0, 0, 0.25];
export const LANTERN: V3 = [0.2, 1.95, -1.75];
const TENT = { at: [-3.85, -3.15] as [number, number], face: 0.62 };

export interface World {
  group: THREE.Group;
  /** the light at time t; `still` holds it at its middle */
  tick(t: number, still: boolean): void;
  /** frees what lives outside the scene graph's geometries and materials (instance buffers) */
  dispose(): void;
}

const TAU = Math.PI * 2;

/** One billboard glow per light layer, all in one draw: a soft round falloff, added on top, breathing per channel. */
function glows(list: { at: V3; size: number; color: number; k: number; chan: 0 | 1 }[]) {
  const n = list.length;
  const pos = new Float32Array(n * 4 * 3);
  const corner = new Float32Array(n * 4 * 2);
  const size = new Float32Array(n * 4);
  const color = new Float32Array(n * 4 * 3);
  const chan = new Float32Array(n * 4);
  const idx: number[] = [];
  list.forEach((g, i) => {
    const c = new THREE.Color(g.color).multiplyScalar(g.k);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y], j) => {
      const v = i * 4 + j;
      pos.set(g.at, v * 3);
      corner.set([x, y], v * 2);
      size[v] = g.size;
      color.set([c.r, c.g, c.b], v * 3);
      chan[v] = g.chan;
    });
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('aChan', new THREE.BufferAttribute(chan, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uChan: { value: new THREE.Vector2(1, 1) } },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner; attribute float aSize; attribute vec3 aColor; attribute float aChan;
      uniform vec2 uChan;
      varying vec2 vUv; varying vec3 vColor;
      void main() {
        vUv = aCorner;
        vColor = aColor * (aChan < 0.5 ? uChan.x : uChan.y);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xy += aCorner * aSize * 0.5;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vColor;
      void main() {
        float d = length(vUv);
        float a = exp(-d * d * 4.5) * (1.0 - smoothstep(0.75, 1.0, d));
        gl_FragColor = vec4(vColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return { mesh, chan: mat.uniforms.uChan.value as THREE.Vector2 };
}

/** The hearth's flames: three blue tongues in one draw, leaning and stretching slowly, brightest at the root. */
function flames() {
  const r = mulberry32(41);
  const parts: THREE.BufferGeometry[] = [];
  const tongues: [number, number, number, number][] = [
    [0, 0, 0.62, 0.17],
    [0.1, 0.06, 0.44, 0.12],
    [-0.09, -0.05, 0.5, 0.13],
    [0.02, -0.1, 0.36, 0.1],
  ];
  for (const [x, z, h, w] of tongues) {
    const prof = [[0.001, 0], [w * 0.8, h * 0.08], [w, h * 0.25], [w * 0.75, h * 0.55], [w * 0.3, h * 0.85], [0.001, h]].map(([a, b]) => new THREE.Vector2(a, b));
    const g = new THREE.LatheGeometry(prof, 10);
    g.translate(x, 0, z);
    const ph = new Float32Array(g.attributes.position.count).fill(r() * TAU);
    const ht = new Float32Array(g.attributes.position.count).fill(h);
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aH', new THREE.BufferAttribute(ht, 1));
    parts.push(g);
  }
  const geo = mergeAll(parts);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aPhase; attribute float aH;
      uniform float uTime;
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 p = position;
        vY = p.y / aH;
        float lean = vY * vY;
        p.x += lean * 0.05 * sin(uTime * 1.6 + aPhase);
        p.z += lean * 0.035 * sin(uTime * 1.25 + aPhase * 1.7);
        p.y *= 1.0 + 0.07 * sin(uTime * 1.1 + aPhase * 2.3);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        // brightest where the flame faces the eye and fading at its edges, so it reads as light and not as a solid
        float face = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        vec3 core = vec3(1.25, 1.75, 2.4);
        vec3 edge = vec3(0.12, 0.55, 1.7);
        vec3 c = mix(core, edge, smoothstep(0.0, 0.6, vY)) * (1.0 - smoothstep(0.45, 1.0, vY) * 0.9);
        gl_FragColor = vec4(c * face * 0.5, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return { mesh, time: mat.uniforms.uTime };
}

/** Joins geometries that share their attributes into one, freeing the parts. */
function mergeAll(gs: THREE.BufferGeometry[]) {
  const out = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  return out;
}

/** Soft dark pools under everything that stands on the ground, in one draw. */
function pools(list: { at: [number, number]; r: [number, number]; rot?: number; k?: number }[]) {
  const gs = list.map(({ at, r, rot = 0, k = 1 }) => {
    const g = new THREE.PlaneGeometry(r[0] * 2, r[1] * 2);
    g.rotateX(-Math.PI / 2);
    g.rotateY(rot);
    g.translate(at[0], 0.012, at[1]);
    g.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(4).fill(k), 1));
    g.deleteAttribute('normal');
    return g;
  });
  const geo = mergeAll(gs);
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aK; varying vec2 vUv; varying float vK;
      void main() { vUv = uv * 2.0 - 1.0; vK = aK; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vK;
      void main() {
        float d = length(vUv);
        gl_FragColor = vec4(0.012, 0.014, 0.03, (1.0 - smoothstep(0.15, 1.0, d)) * 0.62 * vK);
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

/** The ground: flat where the camp stands, rolling gently further out; lighter, packed earth near the fire. */
function ground() {
  const g = new THREE.PlaneGeometry(56, 56, 72, 72);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const r = mulberry32(7);
  const bumps = Array.from({ length: 9 }, () => [(r() - 0.5) * 50, (r() - 0.5) * 50, 2 + r() * 5, 0.3 + r() * 0.9]);
  const near = new THREE.Color(0x2a3040);
  const far = new THREE.Color(0x10151f);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const d = Math.hypot(x - HEARTH[0], z - HEARTH[2]);
    let y = 0;
    for (const [bx, bz, br, bh] of bumps) y += bh * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (br * br));
    y *= THREE.MathUtils.smoothstep(d, 5.5, 11);
    y += Math.sin(x * 0.9 + z * 0.4) * 0.03 + Math.sin(z * 1.3 - x * 0.7) * 0.025;
    p.setY(i, y);
    c.copy(near).lerp(far, THREE.MathUtils.smoothstep(d, 1.2, 7.5));
    c.multiplyScalar(0.9 + r() * 0.2);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = grained({ color: 0xffffff, vertexColors: true, roughness: 0.97, metalness: 0 }, { scale: [3, 3, 3], color: 0.3, rough: 0.02 });
  return new THREE.Mesh(g, mat);
}

/** A pine: a trunk and four stacked, ragged tiers of needles. Two geometries, instanced around the camp. */
function pine(): { bark: THREE.BufferGeometry; needles: THREE.BufferGeometry } {
  const bark = limb([0, 0, 0], [0, 1.3, 0], 0.13, 0.08, 6);
  const tiers: THREE.BufferGeometry[] = [];
  const t: [number, number, number][] = [
    [1.0, 1.25, 0.95],
    [1.65, 1.1, 0.78],
    [2.25, 0.95, 0.6],
    [2.8, 0.8, 0.4],
  ];
  t.forEach(([y, h, r], i) => {
    const g = new THREE.ConeGeometry(r, h, 7, 2);
    g.translate(0, y + h / 2 - 0.1, 0);
    tiers.push(jitter(g, [0.06, 0.05, 0.06], 50 + i));
  });
  return { bark, needles: mergeAll(tiers) };
}

/** Pines in a loose ring around the camp, kept out of the way of the camera and the camp itself. */
function pineSpots() {
  const r = mulberry32(19);
  const out: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  for (let i = 0; i < 38; i++) {
    const a = (i / 38) * TAU + (r() - 0.5) * 0.14;
    const d = 11 + r() * 9;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d * 0.8 - 2.2;
    // the camera looks in from +z: nothing between it and the camp
    if (z > -1 && Math.abs(x) < 6.5 + (z + 1) * 0.6) continue;
    const s = 0.8 + r() * 0.6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * TAU);
    out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, -0.05, z), q, new THREE.Vector3(s * (0.9 + r() * 0.2), s, s * (0.9 + r() * 0.2))));
  }
  return out;
}

/** Grass blades in tufts around the camp, swaying a little; none in the fire, the tent or where the watchers stand. */
function grass() {
  const blade = new THREE.BufferGeometry();
  const w = 0.028, hgt = 0.34;
  // a tapered blade in three segments, bent forward as it rises
  const pts: number[] = [];
  const rows = [[0, w, 0], [0.33, w * 0.8, 0.02], [0.66, w * 0.5, 0.06], [1, 0, 0.12]];
  for (const [y, half, bend] of rows) pts.push(-half, y * hgt, bend, half, y * hgt, bend);
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6]);
  blade.computeVertexNormals();
  const avoid: [number, number, number][] = [[HEARTH[0], HEARTH[2], 1.3], [TENT.at[0], TENT.at[1], 1.7], ...Object.values(SPOTS).map(({ at, r = 0.45 }) => [at[0], at[1], r + 0.1] as [number, number, number])];
  const r = mulberry32(23);
  const mats: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  for (let tuft = 0; mats.length < 520 && tuft < 400; tuft++) {
    const a = r() * TAU;
    const d = 1.4 + Math.pow(r(), 0.8) * 8.5;
    const cx = Math.sin(a) * d, cz = Math.cos(a) * d * 0.85 - 0.8;
    if (avoid.some(([x, z, rr]) => Math.hypot(cx - x, cz - z) < rr)) continue;
    const n = 4 + Math.floor(r() * 6);
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * 0.35, z = cz + (r() - 0.5) * 0.35;
      const s = 0.6 + r() * 0.9;
      q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.3, r() * TAU, (r() - 0.5) * 0.3));
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.5), s)));
    }
  }
  const mat = grained({ color: 0x223040, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }, { scale: [20, 20, 20], color: 0.25, rough: 0.03, rim: 0x4fb8ff, rimStrength: 0.12, rimPow: 2 }, { top: 0, len: hgt, amp: 0.045, speed: 0.85, mode: 'blade' });
  const mesh = new THREE.InstancedMesh(blade, mat, mats.length);
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** The tent: a ridge tent of heavy canvas with one flap tied back, its poles, guy ropes and pegs. */
function tent(p: Parts) {
  const L = 2.3, W = 0.95, H = 1.35;
  const at = new THREE.Matrix4().compose(new THREE.Vector3(TENT.at[0], 0, TENT.at[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), TENT.face), new THREE.Vector3(1, 1, 1));
  const put = (g: THREE.BufferGeometry) => g.applyMatrix4(at);
  // the two roof panels, closed on both faces so the canvas needs only one side drawn
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(Math.hypot(W, H), 0.024, L);
    g.rotateZ(s * (Math.PI / 2 - Math.atan2(H, W)));
    g.translate((s * W) / 2, H / 2, 0);
    p.add('canvas', put(g));
  }
  // the back wall, and the dark inside seen through the open front
  p.add('canvas', put(xf(slab([[-W, 0], [W, 0], [0, H]], 0.01), { p: [0, 0, -L / 2] })));
  p.add('visor', put(xf(slab([[-W * 0.92, 0], [W * 0.92, 0], [0, H * 0.94]], 0.01), { p: [0, 0, L / 2 - 0.25] })));
  // the front flaps: one closed, one tied back
  p.add('canvas', put(xf(slab([[0, 0], [W, 0], [0, H]], 0.01), { p: [0, 0, L / 2], r: [0, -0.12, 0] })));
  p.add('canvas', put(xf(slab([[0, 0], [-W, 0], [0, H]], 0.01), { p: [-0.02, 0, L / 2 + 0.02], r: [0, 1.15, 0] })));
  p.add('rope', put(limb([-0.36, 0.55, L / 2 + 0.4], [-0.32, 0.62, L / 2 + 0.31], 0.018, 0.018, 4)));
  p.add('wood', put(limb([0, 0, L / 2 + 0.03], [0, H + 0.1, L / 2 + 0.03], 0.03, 0.026, 6)), put(limb([0, 0, -L / 2 - 0.03], [0, H + 0.1, -L / 2 - 0.03], 0.03, 0.026, 6)));
  p.add('wood', put(limb([0, H + 0.02, -L / 2 - 0.05], [0, H + 0.02, L / 2 + 0.05], 0.022, 0.022, 5)));
  for (const [x, z, tx, tz] of [[0, L / 2 + 0.03, 0, L / 2 + 1.0], [0, -L / 2 - 0.03, 0, -L / 2 - 1.0], [W, L / 3, W + 0.6, L / 3], [-W, L / 3, -W - 0.6, L / 3], [W, -L / 3, W + 0.6, -L / 3], [-W, -L / 3, -W - 0.6, -L / 3]]) {
    const top: V3 = [x * 0.9, x ? 0.3 : H + 0.08, z];
    p.add('rope', put(limb(top, [tx, 0.02, tz], 0.008, 0.008, 3)));
    p.add('wood', put(limb([tx, -0.02, tz], [tx, 0.13, tz], 0.018, 0.012, 4)));
  }
}

/** The Lantern on its crook pole: an iron lantern with glass sides and a living light, hung over the camp. */
function lantern(p: Parts) {
  const [lx, ly, lz] = LANTERN;
  const px = lx + 0.62;
  p.add('wood', limb([px, -0.05, lz], [px, 2.42, lz], 0.045, 0.034, 7));
  p.add('wood', sweep([[px, 2.4, lz], [px - 0.05, 2.62, lz], [px - 0.3, 2.68, lz], [lx, 2.56, lz]], 0.033, 0.024, 6, 10));
  p.add('iron', limb([lx, 2.54, lz], [lx, ly + 0.36, lz], 0.007, 0.007, 4));
  p.add('iron', xf(new THREE.TorusGeometry(0.06, 0.011, 4, 10), { p: [lx, ly + 0.36, lz] }));
  // cap, base and frame
  p.add('iron', xf(new THREE.ConeGeometry(0.2, 0.17, 6), { p: [lx, ly + 0.23, lz] }));
  p.add('iron', xf(new THREE.CylinderGeometry(0.17, 0.19, 0.04, 6), { p: [lx, ly + 0.145, lz] }));
  p.add('iron', xf(new THREE.CylinderGeometry(0.17, 0.15, 0.07, 6), { p: [lx, ly - 0.2, lz] }));
  p.add('iron', xf(new THREE.ConeGeometry(0.05, 0.1, 6), { p: [lx, ly - 0.28, lz], r: [Math.PI, 0, 0] }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    p.add('iron', limb([lx + Math.sin(a) * 0.165, ly - 0.17, lz + Math.cos(a) * 0.165], [lx + Math.sin(a) * 0.165, ly + 0.13, lz + Math.cos(a) * 0.165], 0.011, 0.011, 4));
  }
  p.add('glass', xf(new THREE.CylinderGeometry(0.158, 0.158, 0.3, 6, 1, true), { p: [lx, ly - 0.02, lz] }));
  // the light inside: a slim flame on a small cup
  p.add('iron', xf(new THREE.CylinderGeometry(0.045, 0.035, 0.05, 8), { p: [lx, ly - 0.13, lz] }));
  p.add('flame', xf(new THREE.LatheGeometry([[0.001, 0], [0.04, 0.03], [0.045, 0.07], [0.025, 0.13], [0.001, 0.18]].map(([a, b]) => new THREE.Vector2(a, b)), 8), { p: [lx, ly - 0.11, lz] }));
}

/** The hearth: a ring of stones, a bed of ash glowing faintly blue and a small stack of split logs. */
function hearth(p: Parts) {
  const [hx, , hz] = HEARTH;
  const r = mulberry32(5);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + r() * 0.2;
    const s = 0.13 + r() * 0.06;
    p.add('stone', jitter(ball(s, [hx + Math.sin(a) * 0.62, s * 0.55, hz + Math.cos(a) * 0.62], [1.2, 0.8, 1], 0), s * 0.18, 60 + i));
  }
  p.add('ash', xf(new THREE.CircleGeometry(0.56, 14), { p: [hx, 0.02, hz], r: [-Math.PI / 2, 0, 0] }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    const foot: V3 = [hx + Math.sin(a) * 0.42, 0.04, hz + Math.cos(a) * 0.42];
    const top: V3 = [hx + Math.sin(a) * 0.06, 0.42, hz + Math.cos(a) * 0.06];
    p.add('wood', limb(foot, top, 0.055, 0.04, 6));
    p.add('woodEnd', ball(0.056, foot, [1, 0.5, 1], 0));
  }
}

/** Boulders and the standing stone Vesper perches on. */
function rocks(p: Parts) {
  const v = SPOTS.vesper;
  p.add('stone', jitter(xf(new THREE.CylinderGeometry(0.3, 0.42, 0.68, 7, 2), { p: [v.at[0], 0.32, v.at[1]] }), 0.05, 71));
  p.add('stone', jitter(ball(0.3, [v.at[0] + 0.42, 0.14, v.at[1] + 0.28], [1.2, 0.6, 1], 1), 0.04, 72));
  const list: [number, number, number, V3][] = [
    [-0.9, 2.85, 0.24, [1.4, 0.6, 1]],
    [3.6, 0.6, 0.34, [1.3, 0.7, 1.1]],
    [-4.4, 0.4, 0.42, [1.2, 0.75, 1]],
    [4.8, -3.4, 0.55, [1.2, 0.8, 1.1]],
    [-2.0, -3.9, 0.3, [1.3, 0.6, 1]],
    [2.5, 2.9, 0.18, [1.2, 0.6, 1]],
  ];
  list.forEach(([x, z, s, sc], i) => p.add('stone', jitter(ball(s, [x, s * sc[1] * 0.5, z], sc, 1), s * 0.12, 80 + i)));
}

export function buildWorld(m: Mats): World {
  const group = new THREE.Group();
  group.name = 'world';
  const p = new Parts();
  hearth(p);
  lantern(p);
  tent(p);
  rocks(p);
  group.add(p.build(m, 'camp'));
  group.add(ground());

  const g = grass();
  group.add(g);
  const { bark, needles } = pine();
  const spots = pineSpots();
  const trunks = new THREE.InstancedMesh(bark, m.bark, spots.length);
  const crowns = new THREE.InstancedMesh(needles, m.needles, spots.length);
  spots.forEach((s, i) => (trunks.setMatrixAt(i, s), crowns.setMatrixAt(i, s)));
  group.add(trunks, crowns);

  const fire = flames();
  fire.mesh.position.set(HEARTH[0], 0.05, HEARTH[2]);
  group.add(fire.mesh);
  const glow = glows([
    { at: [HEARTH[0], 0.38, HEARTH[2]], size: 1.1, color: 0x9fdcff, k: 0.55, chan: 0 },
    { at: [HEARTH[0], 0.5, HEARTH[2]], size: 3.6, color: 0x4fb8ff, k: 0.16, chan: 0 },
    { at: [LANTERN[0], LANTERN[1] - 0.03, LANTERN[2]], size: 0.62, color: 0xbfe8ff, k: 0.7, chan: 1 },
    { at: [LANTERN[0], LANTERN[1] - 0.03, LANTERN[2]], size: 2.6, color: 0x4fb8ff, k: 0.15, chan: 1 },
  ]);
  group.add(glow.mesh);
  group.add(
    pools([
      ...Object.values(SPOTS)
        .filter((s) => !s.y && s !== SPOTS.bramble)
        .map(({ at }) => ({ at, r: [0.55, 0.45] as [number, number] })),
      { at: [SPOTS.vesper.at[0], SPOTS.vesper.at[1]], r: [0.75, 0.6] },
      { at: [SPOTS.bramble.at[0], SPOTS.bramble.at[1]], r: [1.35, 0.7], rot: SPOTS.bramble.face },
      { at: TENT.at, r: [1.6, 1.9], rot: TENT.face, k: 0.8 },
      { at: [LANTERN[0] + 0.62, LANTERN[2]], r: [0.3, 0.3] },
    ]),
  );

  // the light: a cool sky, the moon from above, and the two flames that light the camp
  const sky = new THREE.HemisphereLight(0x3a5285, 0x0a0d16, 1.1);
  const moon = new THREE.DirectionalLight(0xb4ccff, 0.5);
  moon.position.set(6, 9, -8);
  const fireLight = new THREE.PointLight(0x58bfff, 7.5, 0, 2);
  fireLight.position.set(HEARTH[0], 0.6, HEARTH[2]);
  const lampLight = new THREE.PointLight(0xa8dcff, 3.2, 0, 2);
  lampLight.position.set(LANTERN[0], LANTERN[1], LANTERN[2]);
  group.add(sky, moon, moon.target, fireLight, lampLight);

  const flameMat = m.flame as THREE.MeshBasicMaterial;
  const flameBase = flameMat.color.clone();
  return {
    group,
    tick(t, still) {
      // the Lantern breathes once every five seconds (0.2 Hz); the fire swells on two slower, gentler waves
      const lamp = still ? 0 : Math.sin((t / 5) * TAU);
      const fire1 = still ? 0 : Math.sin((t / 4.1) * TAU) * 0.6 + Math.sin((t / 7.3) * TAU + 1.3) * 0.4;
      lampLight.intensity = 3.2 * (1 + lamp * 0.16);
      fireLight.intensity = 7.5 * (1 + fire1 * 0.08);
      glow.chan.set(1 + fire1 * 0.07, 1 + lamp * 0.14);
      flameMat.color.copy(flameBase).multiplyScalar(1 + lamp * 0.1);
      fire.time.value = still ? 0 : t;
    },
    dispose() {
      g.dispose();
      trunks.dispose();
      crowns.dispose();
    },
  };
}
