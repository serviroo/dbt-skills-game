import * as THREE from 'three';
import { MeshBuilder, loft, shell, strandPts, blendSkin, type Ring, type Skin } from '../character/geo';
import { Rig, type BoneDef, type Pose } from '../character/rig';
import { clamp, lerp, smoothstep, mulberry32 } from '../../core/math';
import { GlowBuilder, Surf, tube, blob, smoothPts, patch, V } from './build';

/**
 * Shadow soldier ("hollow knight") built procedurally. About 1.13x Jin-woo's height (helm crown ~2.05 m).
 * Faces +z in rest pose, arms hanging, like the Jin-woo rig.
 */

export type KnightKind = 'sword' | 'spear' | 'great' | 'commander';

export const KN_BONES: BoneDef[] = [
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'hips', parent: 'root', pos: [0, 1.1, 0] },
  { name: 'spine', parent: 'hips', pos: [0, 1.24, 0] },
  { name: 'chest', parent: 'spine', pos: [0, 1.42, 0] },
  { name: 'neck', parent: 'chest', pos: [0, 1.66, -0.01] },
  { name: 'head', parent: 'neck', pos: [0, 1.77, 0] },
  ...(['L', 'R'] as const).flatMap((s) => {
    const k = s === 'L' ? 1 : -1;
    return [
      { name: 'sh' + s, parent: 'chest', pos: [0.07 * k, 1.6, -0.01] as [number, number, number] },
      { name: 'ua' + s, parent: 'sh' + s, pos: [0.25 * k, 1.575, -0.02] as [number, number, number] },
      { name: 'fa' + s, parent: 'ua' + s, pos: [0.28 * k, 1.27, -0.035] as [number, number, number] },
      { name: 'ha' + s, parent: 'fa' + s, pos: [0.3 * k, 1.015, -0.01] as [number, number, number] },
    ];
  }),
  ...(['L', 'R'] as const).flatMap((s) => {
    const k = s === 'L' ? 1 : -1;
    return [
      { name: 'tg' + s, parent: 'hips', pos: [0.11 * k, 1.05, 0] as [number, number, number] },
      { name: 'sn' + s, parent: 'tg' + s, pos: [0.115 * k, 0.575, 0.012] as [number, number, number] },
      { name: 'ft' + s, parent: 'sn' + s, pos: [0.12 * k, 0.095, -0.02] as [number, number, number] },
      { name: 'to' + s, parent: 'ft' + s, pos: [0.12 * k, 0.03, 0.13] as [number, number, number] },
    ];
  }),
];

const BP = new Map(KN_BONES.map((b) => [b.name, V(...b.pos)]));
const P = (n: string) => BP.get(n)!.clone();
const front = (th: number, w: number) => Math.exp(-Math.pow((th - Math.PI / 2) / w, 2));
const PI = Math.PI;

export interface KnightGeo {
  rig: Rig;
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  /** cape + plume (commander only), toon with flutter */
  cloth?: THREE.BufferGeometry;
}

/** A thin closed plate band (fauld lame, pauldron lame) between two rings, with a visible lip thickness. */
function band(
  mb: MeshBuilder,
  c0: THREE.Vector3,
  c1: THREE.Vector3,
  r0: [number, number],
  r1: [number, number],
  th: number,
  skin: Skin,
  seg: number,
  t: THREE.Vector3,
  ref?: THREE.Vector3,
) {
  const rings: Ring[] = [
    { c: c0, rx: r0[0], rz: r0[1], skin, t, ref },
    { c: c1, rx: r1[0], rz: r1[1], skin, t, ref },
    { c: c1.clone().addScaledVector(t, -th * 0.5), rx: r1[0] - th, rz: r1[1] - th, skin, t, ref },
    { c: c0.clone(), rx: r0[0] - th, rz: r0[1] - th, skin, t, ref },
    { c: c0.clone(), rx: r0[0], rz: r0[1], skin, t, ref },
  ];
  loft(mb, rings, seg);
  return new Surf(rings.slice(0, 2), ref ?? V(0, 0, 1));
}

export function buildKnight(kind: KnightKind, q = 1, seed = 1): KnightGeo {
  const rig = new Rig(KN_BONES);
  const I = (n: string) => rig.i(n);
  const S = (n: string): Skin => [[I(n), 1]];
  const mb = new MeshBuilder();
  const gb = new GlowBuilder();
  const cl = new MeshBuilder();
  const rnd = mulberry32(seed * 7919 + 13);
  const seg = (n: number) => Math.max(6, Math.round(n * q));
  const hero = q >= 0.99;
  const SR = hero ? 0.0031 : 0.0055;
  const SSEG = hero ? 4 : 3;
  const OFF = SR * 0.6;
  // seam hierarchy: primary plate edges at full, secondary/tertiary dimmer (encoded in kind 0..0.45)
  let SB = 1;
  const seam = (pts: THREE.Vector3[], skin: Skin | ((p: THREE.Vector3) => Skin), kindG = 0, r = SR, taper = 0.07) =>
    tube(gb, hero ? pts : pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1), { r, seg: SSEG, kind: kindG === 0 ? (1 - SB) / 1.6 : kindG, taper, skin: typeof skin === 'function' ? (_i, p) => skin(p) : () => skin });
  const cmd = kind === 'commander';

  /* ------------------------------------------------------------------ helm */
  {
    const SH: Skin = S('head');
    const k = cmd ? 0.9 : 1;
    const HU: [number, number, number, number][] = cmd
      ? [
          [1.858, 0.108, 0.128, 0.014],
          [1.866, 0.104, 0.123, 0.012],
          [1.905, 0.109, 0.128, 0.008],
          [1.955, 0.108, 0.126, 0.0],
          [2.005, 0.098, 0.116, -0.012],
          [2.05, 0.078, 0.096, -0.024],
          [2.085, 0.05, 0.066, -0.034],
          [2.105, 0.02, 0.03, -0.04],
        ]
      : [
          [1.858, 0.12, 0.134, 0.012],
          [1.866, 0.116, 0.129, 0.01],
          [1.905, 0.12, 0.133, 0.006],
          [1.955, 0.117, 0.13, 0.0],
          [2.0, 0.103, 0.116, -0.006],
          [2.036, 0.078, 0.09, -0.012],
          [2.062, 0.046, 0.054, -0.016],
          [2.074, 0.016, 0.02, -0.018],
        ];
    const backDrop = (th: number) => -0.036 * smoothstep(0.25, -0.35, Math.sin(th));
    const upper: Ring[] = HU.map(([y, rx, rz, cz], i) => ({
      c: V(0, y, cz),
      rx,
      rz,
      t: V(0, 1, 0),
      skin: SH,
      bend: (th: number) => [0, (i >= 1 ? 0.011 : 0.004) * front(th, cmd ? 0.18 : 0.22) + (cmd && i >= 2 ? -0.006 * Math.cos(2 * th) * Math.max(0, Math.sin(th)) : 0)] as [number, number],
      dyFn: i <= 1 ? backDrop : undefined,
    }));
    loft(mb, upper, seg(30), { capEnd: true });
    if (!cmd) {
      // raised comb along the crown: catches the rim light and breaks the bucket silhouette
      const su0 = new Surf(upper);
      const comb = Array.from({ length: 9 }, (_, i) => su0.at(1.2 + 5.6 * (i / 8), PI / 2 + (i / 8) * 0.0, 0));
      const back = Array.from({ length: 6 }, (_, i) => su0.at(6.8 - 4.6 * (i / 5), PI * 1.5, 0));
      strandPts(mb, [...comb, ...back], { width: 0.007, thick: 0.016, widthDir: V(1, 0, 0), rings: hero ? 18 : 8, seg: hero ? 6 : 4, skin: SH, profile: (t) => 0.35 + 0.65 * Math.sin(PI * clamp(t)) });
    }
    const HL: [number, number, number, number][] = [
      [1.69, 0.088 * k, 0.098, 0.016],
      [1.73, 0.107 * k, 0.121, 0.02],
      [1.782, 0.118 * k, 0.134, 0.021],
      [1.826, 0.121 * k, 0.138, 0.018],
      [1.838, 0.114 * k, 0.13, 0.014],
    ];
    const lower: Ring[] = HL.map(([y, rx, rz, cz], i) => ({
      c: V(0, y, cz),
      rx,
      rz,
      t: V(0, 1, 0),
      skin: SH,
      bend: (th: number) => [0, (cmd ? 0.024 : 0.017) * front(th, cmd ? 0.24 : 0.32) * (i >= 1 && i <= 3 ? 1 : 0.5)] as [number, number],
    }));
    loft(mb, lower, seg(30), { capStart: true, capEnd: true });
    // dark core so the visor slit never shows the backdrop
    loft(
      mb,
      [
        { c: V(0, 1.8, 0.0), rx: 0.05, rz: 0.05, skin: SH },
        { c: V(0, 1.85, 0.0), rx: 0.104 * k, rz: 0.118, skin: SH },
        { c: V(0, 1.9, -0.005), rx: 0.05, rz: 0.06, skin: SH },
      ],
      seg(12),
      { capStart: true, capEnd: true },
    );
    const su = new Surf(upper), sl = new Surf(lower);
    SB = cmd ? 0.45 : 1; seam(
      Array.from({ length: 21 }, (_, i) => su.at(0, PI * (0.15 + 0.7 * (i / 20)), OFF)),
      SH,
    );
    SB = cmd ? 0.45 : 1; seam(
      Array.from({ length: 21 }, (_, i) => sl.at(3.6, PI * (0.18 + 0.64 * (i / 20)), OFF)),
      SH,
    );
    SB = 0.5; if (cmd) seam(Array.from({ length: 12 }, (_, i) => su.at(1.2 + (upper.length - 2.6) * (i / 11), PI / 2, OFF)), SH, 0, SR * 0.9);
    if (hero) {
      // breaths: two short slots each side of the bevor
      for (const kk of [1, -1])
        for (let b = 0; b < 2; b++) {
          const th = PI / 2 + kk * (0.42 + b * 0.16);
          SB = 0.55; seam(Array.from({ length: 5 }, (_, i) => sl.at(2.55 - 0.9 * (i / 4), th, OFF)), SH, 0, SR * 0.8, 0.01);
        }
    }
    if (cmd) {
      for (const kk of [1, -1]) {
        const a = (x: number) => PI / 2 + kk * x;
        // faceplate V (f1080): a secondary seam that stops short of the chin, so the eyes lead the helm
        const pts = sl.path([[1.83, a(0.78)], [1.795, a(0.52)], [1.758, a(0.3)], [1.728, a(0.16)]], OFF, 14);
        tube(gb, pts, { r: SR * 0.8, seg: SSEG, kind: (1 - 0.55) / 1.6, taper: 0.05, skin: () => SH, u0: 0.15 });
      }
    }
    // eyes
    const eyeY = 1.847;
    for (const kk of [1, -1]) {
      const ez = sl.at(3.8, PI / 2, 0).z - 0.014;
      const tilt = cmd ? 0.38 : 0.12;
      const ax = V(0.0135 * kk, 0.0135 * Math.sin(tilt) * 0.9, 0).setLength(cmd ? 0.019 : 0.015);
      const ay = V(-Math.sin(tilt) * kk, Math.cos(tilt), 0).multiplyScalar(cmd ? 0.0052 : 0.0064);
      blob(gb, V(0.041 * kk, eyeY - (cmd ? 0.002 : 0), ez), ax, ay, V(0, 0, 0.004), SH, 1, hero ? 1 : 0.5);
    }
    if (cmd) {
      // crest fin
      strandPts(mb, [V(0, 2.075, 0.06), V(0, 2.12, -0.02), V(0, 2.12, -0.12), V(0, 2.07, -0.17)], {
        width: 0.012,
        thick: 0.03,
        widthDir: V(1, 0, 0),
        rings: 8,
        seg: 6,
        skin: SH,
        profile: (t) => 0.4 + 0.6 * Math.sin(PI * clamp(t * 0.9 + 0.05)),
      });
      // short swept-back horn prongs that hug the helm (a compact crown, not antlers)
      for (const kk of [1, -1]) {
        const pts = [V(0.09 * kk, 1.94, 0.02), V(0.108 * kk, 1.972, -0.042), V(0.112 * kk, 2.006, -0.1), V(0.104 * kk, 2.03, -0.14)];
        strandPts(mb, pts, { width: 0.018, thick: 0.01, widthDir: V(0, 1, 0.3), rings: 8, seg: 6, skin: SH, profile: (t) => Math.pow(1 - t, 0.75) });
        SB = 0.55; seam(smoothPts(pts.map((p) => p.clone().add(V(0.004 * kk, 0.009, 0))), 10).slice(0, 7), SH, 0, SR * 0.8);
      }
    }
  }

  /* ------------------------------------------------------------------ gorget */
  {
    const gs = (y: number): Skin => blendSkin(S('chest'), S('neck'), smoothstep(1.62, 1.69, y));
    const rings: Ring[] = [
      [1.578, 0.155, 0.13, -0.006],
      [1.6, 0.15, 0.126, -0.006],
      [1.618, 0.124, 0.108, -0.006],
      [1.66, 0.098, 0.092, -0.004],
      [1.705, 0.086, 0.084, 0.0],
    ].map(([y, rx, rz, cz]) => ({ c: V(0, y, cz), rx, rz, skin: gs(y), t: V(0, 1, 0) }));
    loft(mb, rings, seg(24));
    const sf = new Surf(rings);
    SB = 0.55; seam(sf.ringSeam(1.598, PI * 0.12, PI * 0.88, OFF, 18), (p) => gs(p.y));
  }

  /* ------------------------------------------------------------------ torso */
  const torsoSkin = (y: number): Skin =>
    y < 1.2 ? blendSkin(S('hips'), S('spine'), smoothstep(1.08, 1.2, y)) : blendSkin(S('spine'), S('chest'), smoothstep(1.24, 1.38, y));
  {
    const T: [number, number, number, number][] = [
      [1.07, 0.14, 0.104, 0.0],
      [1.13, 0.143, 0.108, 0.004],
      [1.21, 0.157, 0.118, 0.01],
      [1.3, 0.188, 0.133, 0.016],
      [1.39, 0.214, 0.145, 0.021],
      [1.47, 0.225, 0.148, 0.021],
      [1.545, 0.221, 0.138, 0.013],
      [1.6, 0.196, 0.118, 0.002],
      [1.645, 0.15, 0.095, -0.008],
      [1.665, 0.09, 0.07, -0.01],
    ];
    const keel = (y: number) => smoothstep(1.1, 1.25, y) * (1 - smoothstep(1.48, 1.58, y));
    const rings: Ring[] = T.map(([y, rx, rz, cz]) => ({
      c: V(0, y, cz),
      rx: cmd ? rx * 1.04 : rx,
      rz,
      skin: torsoSkin(y),
      t: V(0, 1, 0),
      shape: (th: number) => (Math.sin(th) < 0 ? 0.94 + 0.06 * (1 + Math.sin(th)) : 1),
      bend: (th: number) => [0, 0.018 * front(th, 0.38) * keel(y)] as [number, number],
    }));
    loft(mb, rings, seg(34), { capStart: true, capEnd: true });
    const sf = new Surf(rings);
    const ts = (p: THREE.Vector3) => torsoSkin(p.y);
    // pectoral chevron (one stroke shoulder to sternum to shoulder). The commander's is shallow and wide, a broad
    // breastplate (f1059); the soldiers' is a steep V, kept a secondary seam so the bowed front rank never reads as a grin
    const chev = (dth: number) => 1.405 + 0.095 * Math.pow(dth / 0.33, 1.15);
    SB = cmd ? 1 : 0.72; seam(
      sf.path(
        cmd
          ? [
              [chev(0.33), PI * 0.17],
              [chev(0.17), PI * 0.33],
              [1.405, PI * 0.5],
              [chev(0.17), PI * 0.67],
              [chev(0.33), PI * 0.83],
            ]
          : [
              [1.585, PI * 0.2],
              [1.5, PI * 0.33],
              [1.405, PI * 0.5],
              [1.5, PI * 0.67],
              [1.585, PI * 0.8],
            ],
        OFF,
        34,
      ),
      ts,
    );
    // plate fill above the chevron that the ignition lights from inside (f1059 / f1080)
    {
      const cols = hero ? 16 : 8, rows = hero ? 6 : 3;
      const th0 = cmd ? 0.18 : 0.215;
      const grid: THREE.Vector3[][] = [];
      for (let r = 0; r <= rows; r++) {
        const row: THREE.Vector3[] = [];
        for (let c = 0; c <= cols; c++) {
          const th = PI * (th0 + (1 - 2 * th0) * (c / cols));
          const dth = Math.abs(th - PI / 2) / PI;
          const vy = (cmd ? chev(dth) : 1.405 + (dth / 0.3) * 0.18) + 0.008;
          const y = lerp(vy, Math.max(vy, 1.594), r / rows);
          row.push(sf.at(sf.sAtY(y), th, hero ? 0.0065 : 0.009));
        }
        grid.push(row);
      }
      patch(gb, grid, (p) => V(p.x, 0, p.z - 0.02).normalize(), ts, cmd ? 3.5 : 3);
    }
    // keel
    SB = 0.8; seam(sf.path([[1.4, PI / 2], [1.27, PI / 2], [1.13, PI / 2]], OFF, 14), ts);
    // abdomen lames
    for (const y of [] as number[]) seam(sf.ringSeam(y, PI * 0.18, PI * 0.82, OFF, 20), ts);
    SB = 0.7; seam(sf.ringSeam(1.085, PI * 0.08, PI * 0.92, OFF, 22), ts);
    if (hero) {
      // ribs under the pectoral plate
      for (const kk of [1, -1]) {
        const a = (x: number) => (kk > 0 ? x : PI - x);
        SB = 0.45; seam(sf.path([[1.46, a(PI * 0.12)], [1.38, a(PI * 0.2)], [1.33, a(PI * 0.3)]], OFF, 10), ts, 0, SR * 0.85);
      }
      // spine line on the back plate
      SB = 0.45; seam(sf.path([[1.58, PI * 1.5], [1.35, PI * 1.5], [1.12, PI * 1.5]], OFF, 14), ts, 0, SR * 0.85);
      if (cmd) {
        for (const kk of [1, -1]) {
          const a = (x: number) => (kk > 0 ? x : PI - x);
          SB = 0.45; seam(sf.path([[1.36, a(PI * 0.44)], [1.3, a(PI * 0.34)], [1.22, a(PI * 0.3)]], OFF, 10), ts, 0, SR * 0.85);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ faulds and tassets */
  {
    const SHp = S('hips');
    const n = 3;
    for (let k = 0; k < n; k++) {
      const y0 = 1.105 - k * 0.058, y1 = y0 - 0.075;
      const sf = band(
        mb,
        V(0, y0, 0.004),
        V(0, y1, 0.006),
        [0.15 + k * 0.012, 0.114 + k * 0.009],
        [0.168 + k * 0.013, 0.128 + k * 0.01],
        0.011,
        SHp,
        seg(30),
        V(0, -1, 0),
      );
      SB = 0.6; if (k === n - 1) seam(Array.from({ length: 23 }, (_, i) => sf.at(0.94, PI * (0.06 + 0.88 * (i / 22)), OFF)), SHp);
    }
    // tassets: curved plates over each thigh, two lames each
    for (const s of ['L', 'R'] as const) {
      const kk = s === 'L' ? 1 : -1;
      const cx = 0.11 * kk;
      for (let l = 0; l < 2; l++) {
        const R = hero ? 6 : 2, C = hero ? 7 : 4;
        const grid: THREE.Vector3[][] = [];
        const y0 = 0.94 - l * 0.085, y1 = y0 - 0.1;
        for (let r = 0; r <= R; r++) {
          const v = r / R;
          const y = lerp(y0, y1, v);
          const rad = 0.118 + 0.016 * v + l * 0.008;
          const row: THREE.Vector3[] = [];
          for (let c = 0; c <= C; c++) {
            const u = c / C;
            const a = PI * (0.12 + 0.76 * u) + (kk > 0 ? -0.15 : 0.15);
            row.push(V(cx + Math.cos(a) * rad * 1.0, y, 0.006 + Math.sin(a) * rad * 1.02));
          }
          grid.push(row);
        }
        shell(
          mb,
          grid,
          (r) => blendSkin([[I('hips'), 1]], S('tg' + s), clamp(0.35 + (r / R) * 0.55 + l * 0.1)),
          () => 0,
          0.01,
        );
        const bottom = grid[R].map((p) => p.clone().add(V(0, 0.004, 0)).add(V(p.x - cx, 0, p.z).normalize().multiplyScalar(0.006)));
        SB = 0.5; if (l === 1) seam(smoothPts(bottom, 14), blendSkin([[I('hips'), 1]], S('tg' + s), 0.9 + l * 0.1));
      }
    }
  }

  /* ------------------------------------------------------------------ pauldrons */
  for (const s of ['L', 'R'] as const) {
    const kk = s === 'L' ? 1 : -1;
    const A = V(0.62 * kk, 1, 0.04).normalize();
    const t = A.clone().negate();
    const C = V(0.245 * kk, 1.572, -0.02);
    const R = cmd ? 0.142 : 0.152;
    const skin: Skin = [[I('ua' + s), 0.8], [I('sh' + s), 0.2]];
    const phis = [0.1, 0.32, 0.58, 0.84, 1.08, 1.28, 1.36];
    const domeRings: Ring[] = phis.map((ph, i) => ({
      c: C.clone().addScaledVector(A, R * Math.cos(ph) - (i === phis.length - 1 ? 0.012 : 0)),
      rx: R * Math.sin(ph) * (i === phis.length - 1 ? 1.06 : 1),
      rz: R * Math.sin(ph) * 1.14 * (i === phis.length - 1 ? 1.06 : 1),
      skin,
      t,
    }));
    loft(mb, domeRings, seg(28), { capStart: true });
    const outA = kk > 0 ? PI : 0;
    const dome = new Surf(domeRings);
    SB = 1; seam(Array.from({ length: 27 }, (_, i) => dome.at(phis.length - 1.15, outA - 1.95 + 3.9 * (i / 26), OFF)), skin);
    SB = 0.55; if (hero) seam(Array.from({ length: 12 }, (_, i) => dome.at(0.6 + 4.2 * (i / 11), outA, OFF)), skin, 0, SR * 0.85);
    // lames hanging down the upper arm
    const ua = P('ua' + s);
    const lames = hero ? 3 : 2;
    const ax = V(0.06 * kk, 1, 0).normalize();
    for (let j = 0; j < lames; j++) {
      const top = ua.clone().add(V(0.022 * kk, -0.045 - j * 0.05, -0.004));
      const bot = top.clone().addScaledVector(ax, -0.062);
      const r0 = 0.118 - j * 0.008, r1 = 0.126 - j * 0.008;
      const lsk: Skin = [[I('ua' + s), 1]];
      const sf = band(mb, top, bot, [r0, r0 * 1.04], [r1, r1 * 1.04], 0.009, lsk, seg(24), ax.clone().negate());
      SB = 0.72; if (j === lames - 1) seam(Array.from({ length: 21 }, (_, i) => sf.at(0.95, (kk > 0 ? PI : 0) - 1.7 + 3.4 * (i / 20), OFF)), lsk);
    }
    if (cmd) {
      // one flared blade plate on each pauldron
      for (let b = 0; b < 1; b++) {
        const base = C.clone().addScaledVector(A, R * 0.62).add(V(0.03 * kk, -0.03 * b, -0.02 + b * 0.04));
        const dir = V(0.9 * kk, 0.3 - b * 0.16, -0.22 + b * 0.12).normalize();
        const len = 0.145 - b * 0.05;
        const pts = [base, base.clone().addScaledVector(dir, len * 0.45).add(V(0, 0.018, 0)), base.clone().addScaledVector(dir, len)];
        strandPts(mb, pts, { width: 0.062 - b * 0.012, thick: 0.014, widthDir: V(0, 0.3, 1), rings: 7, seg: 6, skin, profile: (tt) => Math.pow(1 - tt, 0.75) });
        SB = 0.9; seam(smoothPts(pts.map((p) => p.clone().add(V(0, 0.012, 0))), 10).slice(0, 9), skin, 0, SR * 0.9);
      }
    }
  }

  /* ------------------------------------------------------------------ arms */
  for (const s of ['L', 'R'] as const) {
    const kk = s === 'L' ? 1 : -1;
    const ua = P('ua' + s), fa = P('fa' + s), ha = P('ha' + s);
    const U = I('ua' + s), F = I('fa' + s), H = I('ha' + s);
    // rerebrace
    {
      const N = 7;
      const rings: Ring[] = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const c = ua.clone().add(V(0, 0.06, 0)).lerp(fa.clone().add(V(0, 0.02, 0)), t);
        const r = lerp(0.062, 0.052, t);
        rings.push({ c, rx: r, rz: r * 1.05, skin: t > 0.8 ? blendSkin([[U, 1]], [[F, 1]], (t - 0.8) / 0.2 * 0.5) : [[U, 1]] });
      }
      loft(mb, rings, seg(18), { capStart: true });
    }
    // couter (elbow cop)
    {
      const d = fa.clone().sub(ua).normalize();
      const offs = [0.065, 0.032, 0, -0.03, -0.062];
      const rads = [0.052, 0.07, 0.076, 0.068, 0.05];
      const rings: Ring[] = offs.map((o, i) => ({
        c: fa.clone().addScaledVector(d, -o),
        rx: rads[i],
        rz: rads[i],
        skin: [[U, 0.5], [F, 0.5]],
        shape: (th: number) => 1 + 0.5 * Math.pow(Math.max(0, -Math.sin(th)), 3),
      }));
      loft(mb, rings, seg(18), { capStart: true, capEnd: true });
      const sf = new Surf(rings);
      SB = 0.6; seam(Array.from({ length: 17 }, (_, i) => sf.at(2, PI * (1.08 + 0.84 * (i / 16)), OFF)), [[U, 0.5], [F, 0.5]]);
    }
    // vambrace + gauntlet cuff
    {
      const d = ha.clone().sub(fa);
      const rings: Ring[] = [];
      const N = 6;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const c = fa.clone().addScaledVector(d, lerp(0.1, 0.62, t));
        const r = lerp(0.054, 0.046, t);
        rings.push({ c, rx: r, rz: r * 1.04, skin: [[F, 1]] });
      }
      loft(mb, rings, seg(16), { capStart: true, capEnd: true });
      const c0 = fa.clone().addScaledVector(d, 0.58), c1 = fa.clone().addScaledVector(d, 0.97);
      const sf = band(mb, c0, c1, [0.052, 0.054], [0.07, 0.074], 0.009, [[F, 1]], seg(18), d.clone().normalize());
      SB = 0.7; seam(Array.from({ length: 19 }, (_, i) => sf.at(0.96, PI * 2 * (i / 18), OFF)), [[F, 1]]);
    }
    // fist
    {
      const rows: [number, number, number][] = [
        [0.0, 0.04, 0.046],
        [-0.03, 0.044, 0.056],
        [-0.07, 0.046, 0.059],
        [-0.1, 0.04, 0.053],
        [-0.118, 0.026, 0.036],
      ];
      const rings: Ring[] = rows.map(([dy, rx, rz]) => ({ c: ha.clone().add(V(0.004 * kk, dy, 0.004)), rx, rz, skin: [[H, 1]] }));
      loft(mb, rings, seg(16), { capStart: true, capEnd: true });
      const sf = new Surf(rings);
      SB = 0.45; if (hero) seam(Array.from({ length: 11 }, (_, i) => sf.at(1.9, PI * (0.15 + 0.7 * (i / 10)) + (kk > 0 ? PI * 0 : 0), OFF)), [[H, 1]], 0, SR * 0.85);
    }
  }

  /* ------------------------------------------------------------------ legs */
  for (const s of ['L', 'R'] as const) {
    const tg = P('tg' + s), sn = P('sn' + s), ft = P('ft' + s);
    const TG = I('tg' + s), SN = I('sn' + s), FT = I('ft' + s), TO = I('to' + s);
    // cuisse
    {
      const N = 8;
      const rings: Ring[] = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const c = tg.clone().add(V(0, 0.05, 0)).lerp(sn.clone().add(V(0, 0.05, 0)), t);
        const r = lerp(0.088, 0.064, Math.pow(t, 0.9));
        const skin: Skin = t < 0.15 ? blendSkin([[I('hips'), 1]], [[TG, 1]], 0.5 + t / 0.3) : t > 0.85 ? blendSkin([[TG, 1]], [[SN, 1]], (t - 0.85) / 0.15 * 0.45) : [[TG, 1]];
        rings.push({ c, rx: r, rz: r * 1.06, skin });
      }
      loft(mb, rings, seg(18), { capStart: true });
    }
    // poleyn
    {
      const offs = [0.07, 0.035, 0, -0.035, -0.07];
      const rads = [0.056, 0.076, 0.08, 0.072, 0.054];
      const rings: Ring[] = offs.map((o, i) => ({
        c: sn.clone().add(V(0, o, 0.018)),
        rx: rads[i],
        rz: rads[i] * 1.04,
        skin: [[TG, 0.5], [SN, 0.5]],
        shape: (th: number) => 1 + 0.26 * Math.max(0, Math.sin(th)),
        t: V(0, -1, 0),
      }));
      loft(mb, rings, seg(18), { capStart: true, capEnd: true });
      const sf = new Surf(rings);
      SB = 0.7; seam(Array.from({ length: 17 }, (_, i) => sf.at(2, PI * (0.05 + 0.9 * (i / 16)), OFF)), [[TG, 0.5], [SN, 0.5]]);
    }
    // greave
    {
      const rows: [number, number, number][] = [
        [-0.06, 0.062, 0.066],
        [-0.17, 0.069, 0.075],
        [-0.27, 0.063, 0.067],
        [-0.38, 0.052, 0.055],
        [-0.44, 0.056, 0.06],
      ];
      const rings: Ring[] = rows.map(([dy, rx, rz]) => ({
        c: sn.clone().add(V(0, dy, -0.004)),
        rx,
        rz,
        skin: dy > -0.08 ? blendSkin([[TG, 1]], [[SN, 1]], 0.8) : [[SN, 1]],
        bend: (th: number) => [0, 0.01 * front(th, 0.3)] as [number, number],
      }));
      loft(mb, rings, seg(18), { capStart: true, capEnd: true });
      const sf = new Surf(rings);
      SB = 0.55; seam(Array.from({ length: 14 }, (_, i) => sf.at(0.6 + 2.9 * (i / 13), PI / 2, OFF)), [[SN, 1]]);
      SB = 0.45; if (hero) seam(Array.from({ length: 17 }, (_, i) => sf.at(3.75, PI * (0.08 + 0.84 * (i / 16)), OFF)), [[SN, 1]], 0, SR * 0.85);
    }
    // sabaton
    {
      const F: [number, number, number, number][] = [
        [-0.09, 0.046, 0.042, 0.06],
        [-0.05, 0.056, 0.058, 0.068],
        [0.0, 0.06, 0.062, 0.068],
        [0.06, 0.057, 0.05, 0.055],
        [0.12, 0.052, 0.04, 0.045],
        [0.18, 0.042, 0.028, 0.034],
        [0.218, 0.018, 0.012, 0.022],
      ];
      const rings: Ring[] = F.map(([z, hw, hh, cy]) => ({
        c: V(ft.x, cy, ft.z + z),
        t: V(0, 0, 1),
        ref: V(0, 1, 0),
        rx: hw,
        rz: hh,
        skin: z < 0.05 ? [[FT, 1]] : blendSkin([[FT, 1]], [[TO, 1]], smoothstep(0.05, 0.12, z)),
        shape: (th: number) => (Math.sin(th) < 0 ? 0.92 : 1),
      }));
      loft(mb, rings, seg(16), { capStart: true, capEnd: true });
      const sf = new Surf(rings, V(0, 1, 0));
      for (const ss of hero ? [3.1, 4.1] : [3.3]) {
        const sk: Skin = ss < 3.2 ? [[FT, 1]] : [[TO, 1]];
        SB = 0.45; seam(Array.from({ length: 11 }, (_, i) => sf.at(ss, PI * (0.12 + 0.76 * (i / 10)), OFF)), sk);
      }
    }
  }

  /* ------------------------------------------------------------------ weapons */
  const haR = P('haR'), haL = P('haL');
  const gripR = haR.clone().add(V(-0.002, -0.065, 0.002));
  const HR = I('haR');
  const AX = V(0, 0, 1); // grip axis in rest pose (thumb side)
  const blade = (G: THREE.Vector3, from: number, to: number, width: number, thick: number, skin: Skin) => {
    const N = 9;
    const rings: Ring[] = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const w = width * (t < 0.82 ? lerp(1, 0.86, t / 0.82) : lerp(0.86, 0.06, (t - 0.82) / 0.18));
      rings.push({ c: G.clone().addScaledVector(AX, lerp(from, to, t)), t: AX, ref: V(0, 1, 0), rx: thick, rz: w, skin, shape: (th) => 0.55 + 0.45 * Math.abs(Math.cos(th)) + 0.0 });
    }
    loft(mb, rings, hero ? 10 : 4, { capStart: true, capEnd: true });
    // fullers (both faces) as blade-kind seams, and a faint edge line
    for (const f of [1, -1]) {
      const pts = Array.from({ length: 14 }, (_, i) => G.clone().addScaledVector(AX, lerp(from + 0.04, from + (to - from) * 0.78, i / 13)).add(V(f * (thick * 0.62 + SR * 0.4), 0, 0)));
      seam(pts, skin, 2, SR * 0.95);
      if (hero) {
        const e = Array.from({ length: 16 }, (_, i) => {
          const t = i / 15;
          const w = width * (t < 0.82 ? lerp(1, 0.86, t / 0.82) : lerp(0.86, 0.06, (t - 0.82) / 0.18));
          return G.clone().addScaledVector(AX, lerp(from, to, t)).add(V(0, f * (w + SR * 0.2), 0));
        });
        seam(e, skin, 2, SR * 0.7, 0.05);
      }
    }
  };
  const hilt = (G: THREE.Vector3, gripLen: number, guardW: number, skin: Skin) => {
    loft(mb, [
      { c: G.clone().addScaledVector(AX, -gripLen * 0.62 - 0.03), rx: 0.012, rz: 0.012, skin, t: AX, ref: V(0, 1, 0) },
      { c: G.clone().addScaledVector(AX, -gripLen * 0.62 - 0.015), rx: 0.026, rz: 0.026, skin, t: AX, ref: V(0, 1, 0) },
      { c: G.clone().addScaledVector(AX, -gripLen * 0.62), rx: 0.02, rz: 0.02, skin, t: AX, ref: V(0, 1, 0) },
      { c: G.clone().addScaledVector(AX, gripLen * 0.38), rx: 0.016, rz: 0.016, skin, t: AX, ref: V(0, 1, 0) },
    ], 8, { capStart: true, capEnd: true });
    const gc = G.clone().addScaledVector(AX, gripLen * 0.38 + 0.012);
    loft(mb, [
      { c: gc.clone().add(V(0, -guardW, 0)), rx: 0.008, rz: 0.012, skin, ref: V(0, 0, 1) },
      { c: gc.clone().add(V(0, -guardW * 0.8, 0)), rx: 0.014, rz: 0.016, skin, ref: V(0, 0, 1) },
      { c: gc.clone().add(V(0, 0, 0)), rx: 0.016, rz: 0.02, skin, ref: V(0, 0, 1) },
      { c: gc.clone().add(V(0, guardW * 0.8, 0)), rx: 0.014, rz: 0.016, skin, ref: V(0, 0, 1) },
      { c: gc.clone().add(V(0, guardW, 0)), rx: 0.008, rz: 0.012, skin, ref: V(0, 0, 1) },
    ], 8, { capStart: true, capEnd: true });
    return gripLen * 0.38 + 0.024;
  };

  if (kind === 'sword' || kind === 'commander') {
    const sk: Skin = [[HR, 1]];
    const L = kind === 'commander' ? 1.08 : 0.86;
    const b0 = hilt(gripR, kind === 'commander' ? 0.2 : 0.15, kind === 'commander' ? 0.13 : 0.11, sk);
    blade(gripR, b0, b0 + L, kind === 'commander' ? 0.03 : 0.028, 0.0065, sk);
  }
  if (kind === 'great') {
    const sk: Skin = [[HR, 1]];
    const b0 = hilt(gripR, 0.3, 0.17, sk);
    blade(gripR, b0, b0 + 1.22, 0.04, 0.008, sk);
  }
  if (kind === 'spear') {
    const sk: Skin = [[HR, 1]];
    loft(mb, [
      { c: gripR.clone().addScaledVector(AX, -1.02), rx: 0.013, rz: 0.013, skin: sk, t: AX, ref: V(0, 1, 0) },
      { c: gripR.clone().addScaledVector(AX, 1.18), rx: 0.016, rz: 0.016, skin: sk, t: AX, ref: V(0, 1, 0) },
      { c: gripR.clone().addScaledVector(AX, 1.24), rx: 0.022, rz: 0.022, skin: sk, t: AX, ref: V(0, 1, 0) },
    ], 8, { capStart: true, capEnd: true });
    // wings
    loft(mb, [
      { c: gripR.clone().addScaledVector(AX, 1.2).add(V(0, -0.075, 0)), rx: 0.008, rz: 0.008, skin: sk },
      { c: gripR.clone().addScaledVector(AX, 1.2), rx: 0.014, rz: 0.016, skin: sk },
      { c: gripR.clone().addScaledVector(AX, 1.2).add(V(0, 0.075, 0)), rx: 0.008, rz: 0.008, skin: sk },
    ], 8, { capStart: true, capEnd: true });
    blade(gripR, 1.24, 1.56, 0.036, 0.008, sk);
  }
  if (kind === 'sword') {
    // kite shield strapped to the left forearm, face pointing outward (+x) in rest pose
    const fa = P('faL');
    const sk: Skin = [[I('faL'), 1]];
    const cen = fa.clone().add(V(0.085, -0.12, 0.02));
    const R = hero ? 12 : 6, C = hero ? 10 : 5;
    const Hs = 0.86, top = 0.3;
    const wv = (v: number) => (v < 0.24 ? 0.235 * Math.sqrt(1 - Math.pow((0.24 - v) / 0.24, 2) * 0.55) : 0.235 * Math.pow(1 - (v - 0.24) / 0.76, 0.9) + 0.004);
    const pt = (v: number, u: number) => {
      const w = wv(v);
      const z = (u * 2 - 1) * w;
      const y = cen.y + top - v * Hs;
      return V(cen.x - 0.07 * Math.pow(z / 0.235, 2) - 0.02 * Math.pow(v - 0.3, 2), y, cen.z + z);
    };
    const grid: THREE.Vector3[][] = [];
    for (let r = 0; r <= R; r++) {
      const row: THREE.Vector3[] = [];
      for (let c = 0; c <= C; c++) row.push(pt(r / R, c / C));
      grid.push(row);
    }
    shell(mb, grid, () => sk, () => 0, 0.022);
    const o = V(0.006, 0, 0);
    const edge: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) edge.push(pt(i / 24, 0.03).add(o));
    SB = 0.75; seam(edge, sk);
    const edge2: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) edge2.push(pt(i / 24, 0.97).add(o));
    SB = 0.75; seam(edge2, sk);
    SB = 0.75; seam(Array.from({ length: 13 }, (_, i) => pt(0.008, 0.08 + 0.84 * (i / 12)).add(o)), sk);
    SB = 0.55; seam(Array.from({ length: 16 }, (_, i) => pt(0.08 + 0.78 * (i / 15), 0.5).add(o).add(V(0.004, 0, 0))), sk);
    SB = 0.55; seam(Array.from({ length: 12 }, (_, i) => pt(0.3, 0.12 + 0.76 * (i / 11)).add(o).add(V(0.004, 0, 0))), sk);
  }
  void haL;

  /* ------------------------------------------------------------------ commander cloth: cape + plume */
  let cloth: THREE.BufferGeometry | undefined;
  if (cmd) {
    {
      const R = 14, C = 10;
      const grid: THREE.Vector3[][] = [];
      for (let r = 0; r <= R; r++) {
        const v = r / R;
        const row: THREE.Vector3[] = [];
        for (let c = 0; c <= C; c++) {
          const u = c / C;
          const hw = 0.22 + 0.22 * Math.pow(v, 0.8);
          const x = (u * 2 - 1) * hw;
          const jag = r === R ? 0.06 * Math.abs(Math.sin(u * 23.1 + 1.3)) + 0.05 * (c % 2) : 0;
          const y = lerp(1.6, 0.42, v) + jag;
          const z = -0.15 - 0.16 * Math.pow(v, 1.2) - 0.03 * Math.cos(u * PI * 2) * v;
          row.push(V(x, y, z - 0.04 * Math.pow(1 - Math.abs(u * 2 - 1), 2) * (1 - v)));
        }
        grid.push(row);
      }
      shell(
        cl,
        grid,
        (r) => {
          const v = r / R;
          return v < 0.35 ? S('chest') : blendSkin(S('chest'), S('hips'), smoothstep(0.35, 0.7, v));
        },
        (r) => Math.pow(r / R, 1.3) * 0.9,
        0.008,
      );
    }
    {
      // Igris's crimson plume: a horsehair crest rooted along the helm's fin, arcing up and back and falling past the
      // nape onto the cape. Glow geometry (kind -2), so it lights crimson with the seams and sways in the shader
      const N = 17;
      const skinP = (_i: number, p: THREE.Vector3): Skin => blendSkin(S('head'), S('chest'), smoothstep(2.06, 1.9, p.y));
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1);
        const a = ((i * 7) % N) / (N - 1) * 2 - 1;
        const len = 0.8 + 0.2 * Math.sin(PI * f) + (rnd() - 0.5) * 0.1;
        const rz = lerp(0.03, -0.16, f);
        // anime silhouette: a long ribbon that arcs up off the crest and streams far back behind him
        const ctrl = [
          V(a * 0.004, 2.112, rz),
          V(a * 0.02, 2.19 - 0.02 * f, rz - 0.09),
          V(a * 0.05, 2.15 - 0.03 * f, -0.36 - 0.02 * f),
          V(a * 0.08, 1.98, -0.55),
          V(a * 0.11, lerp(1.78, 1.36, len), -0.64 - 0.05 * len),
        ];
        tube(gb, smoothPts(ctrl, 14), { r: 0.0085 - 0.002 * Math.abs(a), seg: 4, kind: -2, taper: 0.07, skin: skinP });
      }
    }
    cloth = cl.build();
  }

  return { rig, body: mb.build(), glow: gb.build(), cloth };
}

/* ------------------------------------------------------------------ poses */

const BASE_STAND: Pose = {
  spine: [0.02, 0, 0],
  chest: [-0.02, 0, 0],
  neck: [0.04, 0, 0],
  head: [0.06, 0, 0],
  shL: [0, 0, -0.04],
  shR: [0, 0, 0.04],
  tgL: [0, 0, 0.05],
  tgR: [0, 0, -0.05],
  ftL: [0, 0.12, -0.05],
  ftR: [0, -0.12, 0.05],
};

export const KN_POSES: Record<KnightKind, Record<'emerge' | 'stand' | 'kneel', Pose>> = {} as never;

function withBase(p: Pose): Pose {
  return { ...BASE_STAND, ...p };
}

const EMERGE: Pose = {
  spine: [0.2, 0, 0],
  chest: [0.12, 0, 0],
  neck: [0.1, 0, 0],
  head: [0.24, 0, 0],
  uaL: [-0.35, 0, 0.12],
  uaR: [-0.35, 0, -0.12],
  faL: [-0.5, 0, 0],
  faR: [-0.5, 0, 0],
  tgL: [-0.6, 0, 0.05],
  tgR: [-0.3, 0, -0.05],
  snL: [0.9, 0, 0],
  snR: [0.6, 0, 0],
};

const KNEEL: Pose = {
  hips: [0.08, 0, 0],
  spine: [0.14, 0, 0],
  chest: [0.08, 0, 0],
  neck: [0.24, 0, 0],
  head: [0.34, 0, 0],
  tgL: [-1.5, 0.05, 0.06],
  snL: [1.48, 0, 0],
  ftL: [0.02, 0, 0],
  tgR: [0.12, 0, -0.04],
  snR: [1.52, 0, 0],
  ftR: [-0.75, 0, 0],
  toR: [0.5, 0, 0],
};

for (const k of ['sword', 'spear', 'great', 'commander'] as KnightKind[]) {
  let stand: Pose, kneel: Pose;
  if (k === 'sword') {
    stand = withBase({ uaR: [-0.12, 0, -0.1], faR: [-0.35, 0, 0], haR: [1.25, 0, 0.0], uaL: [-0.18, 0.0, 0.14], faL: [-0.3, -1.45, 0.0], haL: [0, 0, 0] });
    kneel = { ...KNEEL, uaR: [-0.3, 0, -0.12], faR: [-0.9, 0, 0], haR: [1.55, 0, 0], uaL: [-0.35, 0, 0.16], faL: [-0.55, -1.45, 0.0] };
  } else if (k === 'spear') {
    stand = withBase({ uaR: [-0.06, 0, -0.14], faR: [-1.4, 0.0, 0.0], haR: [0.0, 0.0, 0.0], uaL: [0.0, 0, 0.08], faL: [-0.15, 0, 0] });
    kneel = { ...KNEEL, uaR: [-0.5, 0, -0.2], faR: [-1.1, 0, 0], haR: [0.0, 0, 0], uaL: [-0.55, 0, 0.12], faL: [-0.95, 0, 0] };
  } else if (k === 'great') {
    stand = withBase({ uaR: [-0.55, 0.15, -0.02], faR: [-0.55, 0, 0.0], haR: [1.35, 0, 0], uaL: [-0.55, -0.1, 0.02], faL: [-0.6, 0, 0], haL: [0.2, 0, 0] });
    kneel = { ...KNEEL, uaR: [-0.75, 0.2, -0.02], faR: [-0.55, 0, 0], haR: [1.45, 0, 0], uaL: [-0.75, -0.15, 0.02], faL: [-0.6, 0, 0], haL: [0.2, 0, 0] };
  } else {
    stand = withBase({ uaR: [-0.08, 0, -0.08], faR: [-0.3, 0, 0], haR: [1.3, 0, 0], uaL: [0.02, 0, 0.08], faL: [-0.2, 0, 0], head: [0.04, 0, 0] });
    kneel = { ...KNEEL, uaR: [-0.6, 0.15, -0.05], faR: [-0.6, 0, 0], haR: [1.5, 0, 0], uaL: [-0.5, 0, 0.12], faL: [-1.2, 0, 0] };
  }
  KN_POSES[k] = { emerge: { ...EMERGE, haR: stand.haR ?? [0, 0, 0] }, stand, kneel };
}

/** Hip drop (metres) for the kneel pose. */
export const KNEEL_DROP = 0.43;
