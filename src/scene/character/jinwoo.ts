import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBuilder, loft, type Ring, type Skin, shell, shell2, smoothPath, blendSkin, strandPts } from './geo';
import { Rig, type BoneDef, type Pose } from './rig';
import { makeToon, makeOutline, light, type ToonMaterial } from '../toon';
import { mulberry32, rrange, smoothstep, clamp, lerp } from '../../core/math';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/* Head is modelled in "head units" (chin = 0, crown = 1) then scaled to metres. */
const HH = 0.232;
const CHIN_Y = -0.028; // head-local y of the chin (head bone sits at the jaw hinge height)
const hy = (u: number) => CHIN_Y + u * HH;
export const HEAD_POS = V(0, 1.604, 0);

/* Hand skeleton (rest pose: arm hanging, palm toward the thigh, thumb forward). Per finger: knuckle offset from the
   fi bone [back-of-hand x, y, z], phalanx lengths, radius at the knuckle, rest fan (z per metre down). */
const FINGERS: { o: [number, number, number]; len: [number, number, number]; r: number; fan: number }[] = [
  { o: [0.0004, 0.004, 0.0226], len: [0.037, 0.022, 0.018], r: 0.0091, fan: 0.06 },
  { o: [0.0014, -0.001, 0.0076], len: [0.04, 0.025, 0.019], r: 0.0094, fan: 0.015 },
  { o: [0.0009, 0.002, -0.0074], len: [0.038, 0.023, 0.018], r: 0.0089, fan: -0.03 },
  { o: [-0.0006, 0.011, -0.0206], len: [0.03, 0.018, 0.015], r: 0.0078, fan: -0.08 },
];
const THUMB = { len: [0.031, 0.026, 0.021] as [number, number, number], r: [0.0138, 0.0104, 0.0092, 0.0076] };
const HAND_WR = (k: number) => V(0.226 * k, 0.936, -0.012);
const HAND_KN = (k: number) => V(0.234 * k, 0.852, -0.006);
const HAND_TH = (k: number) => V(0.217 * k, 0.906, 0.017);
const handAxis = (k: number) => HAND_KN(k).sub(HAND_WR(k)).normalize();
const fingerDir = (k: number, f: number) => handAxis(k).add(V(0, 0, FINGERS[f].fan)).normalize();
const thumbDir = (k: number) => V(-0.12 * k, -0.86, 0.48).normalize();
/** Rest-pose joint chain of finger f: knuckle, middle joint, end joint, tip. */
function fingerJoints(k: number, f: number) {
  const F = FINGERS[f];
  const d = fingerDir(k, f);
  const mcp = HAND_KN(k).add(V(F.o[0] * k, F.o[1], F.o[2]));
  const pip = mcp.clone().addScaledVector(d, F.len[0]);
  const dip = pip.clone().addScaledVector(d, F.len[1]);
  const tip = dip.clone().addScaledVector(d, F.len[2]);
  return [mcp, pip, dip, tip];
}
function thumbJoints(k: number) {
  const d = thumbDir(k);
  const cmc = HAND_TH(k);
  const mcp = cmc.clone().addScaledVector(d, THUMB.len[0]);
  const d2 = d.clone().add(V(-0.05 * k, -0.08, -0.06)).normalize();
  const ip = mcp.clone().addScaledVector(d2, THUMB.len[1]);
  const tip = ip.clone().addScaledVector(d2, THUMB.len[2]);
  return [cmc, mcp, ip, tip];
}
const P3 = (v: THREE.Vector3) => [v.x, v.y, v.z] as [number, number, number];

export const JW_BONES: BoneDef[] = [
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'hips', parent: 'root', pos: [0, 1.03, 0] },
  { name: 'spine', parent: 'hips', pos: [0, 1.14, 0] },
  { name: 'chest', parent: 'spine', pos: [0, 1.3, -0.005] },
  { name: 'neck', parent: 'chest', pos: [0, 1.51, -0.014] },
  { name: 'head', parent: 'neck', pos: [HEAD_POS.x, HEAD_POS.y, HEAD_POS.z] },
  ...(['L', 'R'] as const).flatMap((s) => {
    const k = s === 'L' ? 1 : -1;
    const th = thumbJoints(k);
    return [
      { name: 'sh' + s, parent: 'chest', pos: [0.035 * k, 1.475, -0.012] as [number, number, number] },
      { name: 'ua' + s, parent: 'sh' + s, pos: [0.182 * k, 1.458, -0.02] as [number, number, number] },
      { name: 'fa' + s, parent: 'ua' + s, pos: [0.208 * k, 1.175, -0.034] as [number, number, number] },
      { name: 'ha' + s, parent: 'fa' + s, pos: P3(HAND_WR(k)) },
      { name: 'fi' + s, parent: 'ha' + s, pos: P3(HAND_KN(k)) },
      { name: 'th' + s, parent: 'ha' + s, pos: P3(th[0]) },
      { name: 't2' + s, parent: 'th' + s, pos: P3(th[1]) },
      { name: 't3' + s, parent: 't2' + s, pos: P3(th[2]) },
      ...FINGERS.flatMap((_, f) => {
        const j = fingerJoints(k, f);
        return [
          { name: `f${f}a${s}`, parent: 'fi' + s, pos: P3(j[0]) },
          { name: `f${f}b${s}`, parent: `f${f}a${s}`, pos: P3(j[1]) },
          { name: `f${f}c${s}`, parent: `f${f}b${s}`, pos: P3(j[2]) },
        ];
      }),
    ];
  }),
  ...(['L', 'R'] as const).flatMap((s) => {
    const k = s === 'L' ? 1 : -1;
    return [
      { name: 'tg' + s, parent: 'hips', pos: [0.09 * k, 0.975, 0] as [number, number, number] },
      { name: 'sn' + s, parent: 'tg' + s, pos: [0.094 * k, 0.53, 0.012] as [number, number, number] },
      { name: 'ft' + s, parent: 'sn' + s, pos: [0.097 * k, 0.082, -0.02] as [number, number, number] },
      { name: 'to' + s, parent: 'ft' + s, pos: [0.099 * k, 0.02, 0.112] as [number, number, number] },
    ];
  }),
];

/* coat motion: noisy wind flutter plus a slow outward swing of the panels and tails (skin space) */
const COAT_FLUTTER = 0.11;
const COAT_FLARE = 0.075;
const COAT_FLARE_BACK = 0.45;

/* coat front edge angle (cloth cylinder coordinates): front right edge at PI/2 + gap/2, the left mirrored about 1.5 PI */
const COAT_GAP: [number, number][] = [[1.56, 2.3], [1.5, 2.0], [1.42, 1.5], [1.3, 1.2], [1.12, 1.1], [0.98, 1.42], [0.7, 1.85], [0.25, 2.3]];
function coatGap(y: number) {
  const P = COAT_GAP;
  for (let i = 0; i < P.length - 1; i++) if (y >= P[i + 1][0]) return lerp(P[i + 1][1], P[i][1], (y - P[i + 1][0]) / (P[i][0] - P[i + 1][0]));
  return P[P.length - 1][1];
}
/* his left front panel swings back over the hip, pushed aside by the arm whose hand is in that trouser pocket */
const coatPush = (y: number) => 0.66 * Math.exp(-Math.pow((y - 0.97) / 0.17, 2));
/** angle of the coat's front edge on side k (1 = his left, -1 = his right), in the coat grid's angle range */
function coatEdge(y: number, k: number) {
  const g = coatGap(y);
  return k > 0 ? Math.PI * 2.5 - g / 2 - coatPush(y) : Math.PI / 2 + g / 2;
}
/* hanging fold valleys of the skirt: angle, depth, half width (rad), top y. The drawn fold lines sit in these valleys. */
const COAT_FOLDS: [number, number, number, number][] = [
  [2.72, 0.05, 0.1, 0.98],
  [3.25, 0.065, 0.12, 1.0],
  [3.85, 0.055, 0.1, 0.92],
  [4.35, 0.07, 0.11, 0.96],
  [5.05, 0.07, 0.11, 0.96],
  [5.5, 0.05, 0.1, 0.9],
  [6.12, 0.065, 0.12, 1.0],
  [6.68, 0.05, 0.1, 0.97],
];
/* drawn coat lines: [yTop, yBot, angleTop, angleBot, bow, half width, alpha (sign = sheen side), taper] */
const COAT_LINES: number[][] = (() => {
  const L: number[][] = [];
  const edgeR = (y: number) => Math.PI / 2 + coatGap(y) / 2;
  const mirror = (l: number[]) => [l[0], l[1], 3 * Math.PI - l[2], 3 * Math.PI - l[3], -l[4], l[5], -l[6], l[7]];
  // front panel seams, a hand's width in from the opening, chest to hem
  for (const [y0, y1] of [[1.38, 1.0], [1.0, 0.42]]) {
    const s = [y0, y1, edgeR(y0) + 0.24, edgeR(y1) + 0.24, 0.02, 0.0016, 0.9, 0.1];
    L.push(s, mirror(s));
  }
  // the front panels' angular tooling just under the lapel points (Arise coat): a bracket that steps out and back in
  for (const [y0, y1, a0, a1] of [[1.27, 1.19, 0.08, 0.17], [1.19, 1.11, 0.17, 0.08]]) {
    const s = [y0, y1, edgeR(y0) + a0, edgeR(y1) + a1, 0.0, 0.0014, 0.85, 0.15];
    L.push(s, mirror(s));
  }
  // skirt folds: from the hip down, lengths staggered, a slight lean toward the back
  COAT_FOLDS.forEach(([th, , , yt], i) => {
    const len = [0.5, 0.42, 0.36, 0.52, 0.48, 0.34, 0.44, 0.4][i];
    L.push([yt - 0.04, yt - 0.04 - len, th, th + (th < 4.71 ? 0.05 : -0.05), 0.0, 0.0032, i % 2 ? 0.95 : -0.95, 0.65]);
  });
  // drag folds from under the arms toward the waist, and two between the shoulder blades
  const drag = [1.36, 1.08, 3.05, 2.8, -0.04, 0.0026, 0.85, 0.7];
  L.push(drag, mirror(drag));
  L.push([1.32, 1.06, 4.42, 4.5, 0.0, 0.0022, 0.8, 0.7], [1.3, 1.08, 4.98, 4.92, 0.0, 0.0022, -0.8, 0.7]);
  return L;
})();
/* sleeve lines around each arm's own axis (his right sleeve; the left is mirrored): front = PI/2, outside = PI.
   Creases fanning across the inside of the elbow, a long fold down the forearm, one from the armpit down the upper arm. */
const SLEEVE_LINES_R: number[][] = [
  [1.225, 1.168, 1.15, 1.8, 0.0, 0.0017, 0.85, 0.5],
  [1.198, 1.14, 1.3, 2.05, -0.05, 0.0016, -0.8, 0.5],
  [1.17, 1.122, 1.5, 2.15, 0.0, 0.0013, 0.7, 0.5],
  [1.13, 0.99, 2.25, 2.0, 0.06, 0.0019, 0.85, 0.6],
  [1.43, 1.26, 1.95, 1.75, 0.04, 0.0018, -0.75, 0.6],
  [1.21, 1.12, 4.05, 4.4, 0.0, 0.0016, 0.75, 0.5],
];
/* shirt creases around the torso's own axis (front = PI/2): soft folds gathering down into the belt, one drag line
   from under his left arm */
const SHIRT_LINES: number[][] = [
  [1.25, 1.02, 1.36, 1.5, 0.03, 0.0021, 0.8, 0.6],
  [1.21, 1.0, 1.86, 1.69, -0.03, 0.002, 0.75, 0.6],
  [1.09, 0.995, 1.62, 1.56, 0.0, 0.0017, 0.7, 0.6],
  [1.37, 1.17, 2.16, 1.92, 0.02, 0.002, 0.7, 0.6],
];
/* broad fold shadows on the shirt (same stroke model, wide and half-strength): the cloth hangs off the chest and
   gathers into the belt, so the backlit front reads as draped cloth rather than a flat panel */
const SHIRT_FOLDS: number[][] = [
  [1.37, 0.99, 1.2, 1.47, 0.06, 0.02, 0.3, 0.6],
  [1.28, 0.985, 1.98, 1.7, -0.05, 0.016, 0.28, 0.7],
  [1.315, 1.23, 2.2, 1.7, 0.03, 0.013, 0.25, 1.0],
  [1.1, 0.98, 1.52, 1.63, 0.0, 0.013, 0.28, 0.7],
  [1.34, 1.19, 1.02, 1.32, -0.02, 0.017, 0.28, 0.7],
];
/* neck and collarbones (neck cylinder, front = PI/2): the two tendons running from behind the ears into the notch
   above the sternum, and the collarbones fanning out from it, as the manhwa draws them */
const NECK_LINES: number[][] = [
  [1.575, 1.468, 0.62, 1.42, 0.06, 0.0013, 0.45, 0.5],
  [1.575, 1.468, 2.52, 1.72, -0.06, 0.0013, -0.45, 0.5],
  [1.462, 1.442, 0.55, 1.42, -0.03, 0.0042, 0.7, 0.8],
  [1.462, 1.442, 2.59, 1.72, 0.03, 0.0042, -0.7, 0.8],
];
const mirrorSleeve = (L: number[][]) => L.map((l) => [l[0], l[1], Math.PI - l[2], Math.PI - l[3], -l[4], l[5], -l[6], l[7]]);
/* cloth and hair secondary motion on 2s (REFERENCE beat 4: hem, tatters and aura on 2s at 12 fps) */
const ANIM_FPS = 12;
const COAT_LOOK = {
  base: 0x28222e,
  shade: 0x100b12,
  rim: 1.0,
  rimWidth: 0.6,
  rimUpCut: 0.6,
  flutterAmp: COAT_FLUTTER,
  flare: COAT_FLARE,
  flareBack: COAT_FLARE_BACK,
  rimTint: 0xd8c8ff,
  // the planes turned to the cold key read a step lighter (Arise art: coat #1E1923, highlight #3D3D4A); the wide
  // shots keep the backlit silhouette
  keyMul: 2.4,
  term: 0.22,
  keyFar: [2.4, 4.2, 0.4] as [number, number, number],
  rimFar: [2.6, 4.2, 0.7] as [number, number, number],
  rimLow: [0.95, 0.3, 0.3] as [number, number, number],
  animFps: ANIM_FPS,
};

export const PALETTE = {
  coat: { base: COAT_LOOK.base, shade: COAT_LOOK.shade },
  lining: { base: 0x4a3274, shade: 0x150f26 },
  shirt: { base: 0xf2ecf4, shade: 0x8f8ca3 },
  pants: { base: 0x17121c, shade: 0x050307 },
  shoes: { base: 0x1a1214, shade: 0x050304 },
  // skin (FEATURES 4, gate-scene set): lit #EAD5BF, a cool mauve-tan shadow, never navy
  skin: { base: 0xf6dcc4, shade: 0x9c8282 },
  hair: { base: 0x1c1a30, shade: 0x050409, spec: 0x6b678b },
  steel: { base: 0x4a6274, shade: 0x14181f },
  leather: { base: 0x5a332d, shade: 0x1a0d0b },
  eyeCore: 0xeaf6fe,
  eyeIris: 0x9cb5e9,
  eyeRing: 0x4f60ad,
  eyeHalo: 0x6098db,
  eyeOuter: 0x7b3fe4,
  trim: 0x4fb8ff,
  inlay: 0x8cc4d8,
};

export interface Character {
  group: THREE.Group;
  rig: Rig;
  materials: Record<string, ToonMaterial>;
  outlines: THREE.ShaderMaterial[];
  emissive: THREE.MeshBasicMaterial[];
  eyes: { group: THREE.Group; setGlow: (v: number) => void; streaks: THREE.Mesh[] };
  setDissolve: (v: number) => void;
  setClipY: (y: number) => void;
  setOutlinePx: (px: number) => void;
  /** pin the one-sided smirk (0..1); null hands it back to the automatic smirk that follows the eye ignition */
  setSmirk?: (v: number | null) => void;
}

/* ------------------------------------------------------------------------------------------ head */

// u (0 chin .. 1 crown), rx, rz, cz, taper, nose, back  (all in head units)
const HEAD_TABLE: [number, number, number, number, number, number, number][] = [
  [0.0, 0.035, 0.035, 0.305, 0, 0, 0],
  [0.025, 0.085, 0.07, 0.29, 0.45, 0, 0],
  [0.07, 0.145, 0.135, 0.235, 0.55, 0, 0],
  [0.14, 0.214, 0.225, 0.15, 0.5, 0, -0.03],
  [0.21, 0.268, 0.31, 0.08, 0.4, 0.062, -0.05],
  [0.29, 0.304, 0.375, 0.04, 0.24, 0.05, -0.065],
  [0.36, 0.326, 0.41, 0.022, 0.13, 0.034, -0.07],
  [0.43, 0.34, 0.43, 0.012, 0.06, 0.02, -0.05],
  [0.5, 0.347, 0.44, 0.006, 0.02, 0.008, -0.02],
  [0.57, 0.35, 0.445, 0.0, 0.0, 0.0, 0.01],
  [0.66, 0.348, 0.445, -0.01, 0, 0, 0.055],
  [0.75, 0.334, 0.43, -0.02, 0, 0, 0.045],
  [0.84, 0.298, 0.39, -0.03, 0, 0, 0.03],
  [0.91, 0.24, 0.32, -0.035, 0, 0, 0.015],
  [0.96, 0.16, 0.22, -0.04, 0, 0, 0],
  [1.0, 0.055, 0.075, -0.04, 0, 0, 0],
];

/** Cheekbones: a ridge under the outer eye that the jaw falls away from, then a shallow hollow toward the mouth.
 *  Radial push (metres) at height u, ring angle th (front = PI/2). */
function cheekPush(u: number, th: number) {
  const s = Math.sin(th);
  if (s <= 0) return 0;
  const a = Math.abs(th - Math.PI / 2);
  const bone = Math.exp(-Math.pow((u - 0.385) / 0.05, 2)) * Math.exp(-Math.pow((a - 1.0) / 0.3, 2)) * 0.018;
  const hollow = Math.exp(-Math.pow((u - 0.25) / 0.06, 2)) * Math.exp(-Math.pow((a - 0.95) / 0.32, 2)) * 0.005;
  return (bone - hollow) * HH;
}
/* the loft gets extra rows through the cheek and eye band so the cheekbone shading has the resolution to read */
const HEAD_ROWS: (typeof HEAD_TABLE)[number][] = HEAD_TABLE.flatMap((r, i) => {
  const n = HEAD_TABLE[i + 1];
  if (!n || r[0] < 0.14 || r[0] >= 0.5) return [r];
  return [r, r.map((v, j) => lerp(v, n[j], 0.5)) as (typeof HEAD_TABLE)[number]];
});

function headRing(row: (typeof HEAD_TABLE)[number]): Ring {
  const [u, rx, rz, cz, taper, nose, back] = row;
  return {
    c: V(0, hy(u), cz * HH),
    rx: rx * HH,
    rz: rz * HH,
    t: V(0, 1, 0),
    skin: [[0, 1]],
    bend: (th: number) => {
      const s = Math.sin(th), c = Math.cos(th);
      const ck = cheekPush(u, th);
      let bx = -c * rx * HH * taper * Math.max(0, s) * Math.max(0, s) + c * ck;
      let bz = s * ck;
      if (nose) bz += nose * HH * Math.exp(-Math.pow((th - Math.PI / 2) / 0.15, 2));
      if (back) bz -= back * HH * Math.max(0, -s);
      return [bx, bz];
    },
  };
}

/** Front surface z of the face at (x, y) in head-local space (matches the loft). */
export function faceZ(x: number, y: number) {
  const u = (y - CHIN_Y) / HH;
  let i = 0;
  while (i < HEAD_TABLE.length - 2 && HEAD_TABLE[i + 1][0] < u) i++;
  const a = HEAD_TABLE[i], b = HEAD_TABLE[i + 1];
  const t = clamp((u - a[0]) / (b[0] - a[0]));
  const rx = lerp(a[1], b[1], t) * HH, rz = lerp(a[2], b[2], t) * HH, cz = lerp(a[3], b[3], t) * HH;
  const taper = lerp(a[4], b[4], t), nose = lerp(a[5], b[5], t);
  // solve for theta where x(theta) = x on the front half
  let best = Math.PI / 2, bestErr = 1e9;
  for (let k = 0; k <= 200; k++) {
    const th = (k / 200) * Math.PI;
    const s = Math.sin(th), c = Math.cos(th);
    const px = c * rx - c * rx * taper * s * s + c * cheekPush(u, th);
    const err = Math.abs(px - x);
    if (err < bestErr) {
      bestErr = err;
      best = th;
    }
  }
  const s = Math.sin(best);
  return cz + s * rz + s * cheekPush(u, best) + nose * HH * Math.exp(-Math.pow((best - Math.PI / 2) / 0.15, 2));
}

/* ------------------------------------------------------------------------------------------ hair */

const SC = V(0, hy(0.64), -0.004); // scalp centre
const SR = V(0.352 * HH, 0.37 * HH, 0.448 * HH);

function sp(az: number, el: number, inflate = 1, extra = 0) {
  const ce = Math.cos(el);
  const p = V(SR.x * ce * Math.sin(az), SR.y * Math.sin(el), SR.z * ce * Math.cos(az)).multiplyScalar(inflate);
  const n = V(p.x / (SR.x * SR.x), p.y / (SR.y * SR.y), p.z / (SR.z * SR.z)).normalize();
  return p.add(SC).addScaledVector(n, extra);
}
const dirOf = (az: number, el: number) => V(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
function spN(az: number, el: number) {
  const ce = Math.cos(el);
  const p = V(SR.x * ce * Math.sin(az), SR.y * Math.sin(el), SR.z * ce * Math.cos(az));
  return V(p.x / (SR.x * SR.x), p.y / (SR.y * SR.y), p.z / (SR.z * SR.z)).normalize();
}

/**
 * Volume of the base mass (az 0 = front, +PI/2 = his left): a low rounded top that is highest at the back-top (the
 * wedge), the swept volume carried on his right, close over his left ear, tucked in at the temples and the nape.
 */
function hairInflate(az: number, el: number) {
  const back = smoothstep(0.2, -1.0, Math.cos(az));
  const top = smoothstep(0.2, 1.3, el);
  const temple = smoothstep(0.6, 1.0, Math.abs(Math.sin(az))) * smoothstep(0.8, -0.2, el);
  const nape = back * smoothstep(-0.4, -0.95, el);
  const crown = Math.pow(back, 1.5) * Math.exp(-Math.pow((el - 0.95) / 0.38, 2));
  const right = smoothstep(0.0, -0.9, Math.sin(az)) * Math.exp(-Math.pow((el - 0.75) / 0.45, 2));
  const left = smoothstep(0.2, 0.9, Math.sin(az)) * smoothstep(0.9, 0.1, el);
  return 1.06 + 0.045 * top + 0.06 * back * smoothstep(-0.3, 0.7, el) + 0.05 * crown + 0.1 * right - 0.045 * left - 0.035 * temple - 0.03 * nape;
}

/*
 * Fringe (mass D): seven pointed locks falling from the hairline with gaps between them (root az, root el, tip x,
 * tip u, half width, tip z lift, lateral sweep). Over his right eye (-x) they reach the cheekbone, one lock between
 * the eyes reaches the nose bridge, over his left eye they stop at the lash line (ARISE, anime S2).
 */
const FRINGE: [number, number, number, number, number, number, number][] = [
  [-0.7, 0.84, -0.068, 0.41, 0.028, 0.012, -0.008],
  [-0.46, 0.99, -0.041, 0.39, 0.029, 0.016, -0.004],
  [-0.22, 1.1, -0.015, 0.43, 0.026, 0.018, -0.002],
  [0.0, 1.16, 0.003, 0.35, 0.026, 0.02, 0.0],
  [0.23, 1.1, 0.026, 0.5, 0.026, 0.017, 0.004],
  [0.45, 0.98, 0.049, 0.53, 0.026, 0.014, 0.004],
  [0.67, 0.84, 0.071, 0.55, 0.024, 0.012, 0.002],
];
/* the fringe's cast shadow on the face: a tongue under each lock, longer under the longer locks */
const FACE_MASK = {
  tongues: FRINGE.map(([, , tx, tu, w, , sweep]) => [tx + sweep * 0.6, 0.004 + Math.max(0, 0.55 - tu) * HH * 0.22, w * 0.6] as [number, number, number]),
  rise: 2.0,
};

const HAIR_SETTLE = 0.84;
const EAR_FLARE = 0.42;
function buildHair(seed = 11) {
  const mb = new MeshBuilder();
  const rng = mulberry32(seed);
  const skin: Skin = [[0, 1]];

  // Base mass with the hairline high at the front, above the ears at the sides and low at the nape.
  {
    const rows = 14, seg = 48;
    const base = mb.count;
    const hairline = (az: number) => {
      const f = Math.cos(az);
      const side = Math.abs(Math.sin(az));
      return lerp(-0.86, 0.42, smoothstep(-0.7, 0.95, f)) - 0.12 * side * smoothstep(0.0, 0.6, f) + 0.03 * Math.sin(az * 6);
    };
    const pole = mb.vert(sp(0, Math.PI / 2, hairInflate(0, Math.PI / 2)), skin, 0, 0, V(0, 0, 1));
    for (let r = 1; r <= rows; r++) {
      const s = r / rows;
      for (let i = 0; i < seg; i++) {
        const az = (i / seg) * Math.PI * 2;
        const el = lerp(Math.PI / 2, hairline(az), Math.pow(s, 0.9));
        const p = sp(az, el, hairInflate(az, el) - 0.03 * s * s);
        mb.vert(p, skin, 0, 0, sp(az, el - 0.05).sub(sp(az, el)).normalize());
      }
    }
    for (let i = 0; i < seg; i++) mb.tri(pole, base + 1 + ((i + 1) % seg), base + 1 + i);
    for (let r = 0; r < rows - 1; r++)
      for (let i = 0; i < seg; i++) {
        const a = base + 1 + r * seg + i;
        const b = base + 1 + r * seg + ((i + 1) % seg);
        const c = base + 1 + (r + 1) * seg + ((i + 1) % seg);
        const d = base + 1 + (r + 1) * seg + i;
        mb.quad(a, b, c, d);
      }
    const last = base + 1 + (rows - 1) * seg;
    const inner = mb.vert(SC.clone().add(V(0, -0.01, -0.01)), skin, 0, 0);
    for (let i = 0; i < seg; i++) mb.tri(inner, last + i, last + ((i + 1) % seg));
  }

  // a lock id for the per-lock sheen, from a golden-ratio walk (never draws from rng)
  let lockN = 0;
  const lockId = () => 0.05 + 0.95 * ((++lockN * 0.6180339 + 0.137) % 1);

  /** A clump that hugs the hair mass from (az0, el0) to (az1, el1), then lifts off at the tip. With `arc` the path
   *  follows the great circle between the two directions (over the top of the head) instead of a straight az/el line. */
  const clump = (
    az0: number, el0: number, az1: number, el1: number,
    o: { w?: number; th?: number; lift?: number; tipDrop?: number; layer?: number; sway?: number; tipOverride?: THREE.Vector3; curl?: number; full?: number; sheen?: boolean; arc?: boolean },
  ) => {
    const pts: THREE.Vector3[] = [];
    const N = 6;
    const d0 = dirOf(az0, el0), d1 = dirOf(az1, el1);
    const span = Math.acos(clamp(d0.dot(d1), -1, 1));
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      let az = lerp(az0, az1, t);
      let el = lerp(el0, el1, t);
      if (o.arc && span > 1e-4) {
        const d = d0.clone().multiplyScalar(Math.sin((1 - t) * span)).addScaledVector(d1, Math.sin(t * span)).divideScalar(Math.sin(span));
        el = Math.asin(clamp(d.y, -1, 1));
        az = Math.atan2(d.x, d.z);
      }
      const lift = (o.lift ?? 0.012) * Math.pow(t, 2.2) + (o.layer ?? 0.004);
      const p = sp(az, el, hairInflate(az, el), lift);
      if (o.tipDrop) p.y -= o.tipDrop * Math.pow(t, 2);
      if (o.curl) p.addScaledVector(spN(az, el), o.curl * Math.sin(t * Math.PI) * 0.5);
      pts.push(p);
    }
    if (o.tipOverride) {
      pts[N] = o.tipOverride;
      pts[N - 1] = pts[N - 1].clone().lerp(o.tipOverride, 0.35);
    }
    const n = spN(az0, el0);
    const dir = pts[1].clone().sub(pts[0]);
    const widthDir = new THREE.Vector3().crossVectors(n, dir).normalize();
    const full = o.full ?? 0.75;
    strandPts(mb, pts, {
      width: o.w ?? 0.026,
      thick: o.th ?? 0.009,
      widthDir,
      rings: 12,
      seg: 6,
      skin,
      sway: o.sway ?? 0.6,
      profile: (t) => Math.pow(1 - t, full) * (0.72 + 0.28 * Math.sin(Math.min(1, t * 3.5) * Math.PI * 0.5)),
      sheen: o.sheen ? lockId() : undefined,
    });
  };
  /** Point above the hair mass at (az, el): out along the scalp normal by `out`, plus a lift in y. */
  const above = (az: number, el: number, out: number, up = 0) => sp(az, el, hairInflate(az, el), out).add(V(0, up, 0));
  /** A free lock through explicit points (flicks, the temple flare, side locks). */
  const lock = (pts: THREE.Vector3[], w: number, th: number, widthDir: THREE.Vector3, o: { sway?: number; full?: number; sheen?: boolean } = {}) =>
    strandPts(mb, pts, {
      width: w,
      thick: th,
      widthDir,
      rings: 12,
      seg: 6,
      skin,
      sway: o.sway ?? 0.7,
      sheen: o.sheen ? lockId() : undefined,
      profile: (t) => Math.pow(1 - t, o.full ?? 0.62) * (0.74 + 0.26 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5)),
    });

  // F. Back: short locks tapering into the nape, kept behind the ears (same rng draws as before).
  for (let i = 0; i < 16; i++) {
    const az = Math.PI + rrange(rng, -1.7, 1.7) * 0.74;
    const el0 = rrange(rng, 0.55, 1.05);
    const el1 = rrange(rng, -0.85, -0.6);
    clump(az, el0, az + rrange(rng, -0.2, 0.2), el1, { w: rrange(rng, 0.03, 0.038), th: 0.01, lift: rrange(rng, 0.008, 0.02), layer: 0.006, full: 0.6 });
  }
  // F. three or four short points at the nape, pointing down to chin level
  for (const [x, u, w] of [[-0.033, 0.17, 0.026], [-0.011, 0.11, 0.03], [0.013, 0.125, 0.028], [0.035, 0.18, 0.024]] as [number, number, number][]) {
    const az = Math.PI - Math.asin(clamp(x / 0.08, -1, 1)) * 1.2;
    clump(az, 0.15, az, -0.9, { w, th: 0.01, lift: 0.004, layer: 0.009, tipOverride: V(x, hy(u), -0.068 + 0.12 * x * x), full: 0.6 });
  }
  // F. back-top: broad clumps from the whorl down over the back of the head, overlapping like feathers
  for (let i = 0; i < 7; i++) {
    const f = i / 6 - 0.5;
    clump(2.95 + f * 0.5, 1.3, Math.PI + f * 2.3, 0.3 + 0.12 * Math.abs(f), { arc: true, w: 0.044, th: 0.012, lift: 0.014, layer: 0.006, curl: 0.01, full: 0.6, sheen: i % 2 === 0 });
  }
  // his left side: short layers combed back over the ear, which stays exposed below them
  for (let i = 0; i < 4; i++) {
    const az1 = 1.2 + i * 0.28;
    clump(1.9 + i * 0.25, 1.15, az1, 0.42 - 0.05 * i, { arc: true, w: 0.036, th: 0.011, lift: 0.01, layer: 0.006, full: 0.58 });
  }

  // B. Top sweep: broad clumps radiating from the whorl (back-top, on his left), sweeping forward and to his right,
  // the outer ones kicking their points up and out over his right temple.
  const sweep: [number, number, number, number, number, number, boolean][] = [
    // root az, root el, tip az, tip el, half width, lift, kick
    [2.25, 1.2, 0.62, 0.95, 0.042, 0.03, false],
    [2.5, 1.28, 0.28, 1.02, 0.047, 0.036, false],
    [2.78, 1.34, -0.12, 1.0, 0.05, 0.04, true],
    [3.05, 1.32, -0.52, 0.94, 0.05, 0.04, true],
    [3.3, 1.26, -0.92, 0.84, 0.048, 0.034, true],
    [3.55, 1.18, -1.28, 0.7, 0.045, 0.028, true],
  ];
  sweep.forEach(([a0, e0, a1, e1, w, lift, kick], i) => {
    clump(a0, e0, a1, e1, { arc: true, w, th: 0.015, lift, layer: 0.009 + i * 0.0008, curl: 0.022, full: kick ? 0.4 : 0.55, sheen: true, tipOverride: kick ? above(a1, e1, 0.03 + 0.007 * (i - 2), 0.02 - 0.003 * (i - 2)) : undefined });
  });
  // a narrower second layer between them, so the top reads as overlapping clumps, not a cap
  for (let i = 0; i < 5; i++) {
    const [a0, e0, a1, e1] = sweep[i];
    const [b0, f0, b1, f1] = sweep[i + 1];
    clump((a0 + b0) / 2 + 0.05, (e0 + f0) / 2 + 0.04, (a1 + b1) / 2, (e1 + f1) / 2 + 0.06, { arc: true, w: 0.032, th: 0.012, lift: 0.024, layer: 0.015, curl: 0.012, full: 0.5 });
  }

  // A. Crown flicks: one pointed tuft rising from the whorl, sweeping up and back and leaning to his right (the
  // anime's single flick), and a smaller one beside it
  for (const [az, el, up, back, side, w] of [[2.9, 1.1, 0.062, 0.036, -0.014, 0.016], [3.3, 1.02, 0.036, 0.04, -0.024, 0.012]] as number[][]) {
    const root = sp(az, el, hairInflate(az, el), 0.004);
    const n = spN(az, el);
    const p1 = root.clone().addScaledVector(n, 0.01).add(V(side * 0.35, up * 0.5, -back * 0.2));
    const tip = root.clone().add(V(side, up, -back));
    lock([root, p1, tip], w, 0.007, V(1, 0, 0.3), { sway: 0.9, full: 0.95, sheen: true });
  }
  // back-top spikes: pointed locks lifting up and out of the upper back of the skull, so the profile is the wedge
  // that is highest at the back-top and the outline breaks into points instead of a smooth bowl
  for (const [az, el, out, up, w] of [[2.45, 0.86, 0.04, 0.012, 0.024], [2.95, 0.82, 0.046, 0.016, 0.026], [3.45, 0.8, 0.044, 0.01, 0.025], [3.9, 0.7, 0.04, 0.0, 0.022], [2.05, 0.66, 0.034, -0.004, 0.02]] as number[][]) {
    const root = sp(az, el + 0.32, hairInflate(az, el + 0.32), 0.006);
    const tip = above(az, el - 0.08, out, up);
    const mid = above(az, el + 0.12, 0.016, 0.004);
    lock([root, mid, tip], w, 0.011, V(Math.cos(az), 0, -Math.sin(az)), { sway: 0.8, full: 0.48, sheen: true });
  }
  // his left side: two short points flaring out above the ear (S1 design, ARISE), the ear itself stays exposed
  for (const [az, el, tx, tu, tz, w] of [[1.2, 0.98, 0.118, 0.66, -0.004, 0.024], [1.62, 0.92, 0.112, 0.6, -0.032, 0.022]] as number[][]) {
    const root = sp(az, el, hairInflate(az, el), 0.008);
    const n = spN(az, el);
    const tip = V(tx, hy(tu), tz);
    const mid = root.clone().lerp(tip, 0.45).addScaledVector(n, 0.014).add(V(0, 0.006, 0));
    lock([root, mid, tip], w, 0.01, V(0, 0, 1), { sway: 0.8, full: 0.5, sheen: true });
  }

  // C. Right-temple flare (his right, -x): three locks out and down past the face, one kicking almost level.
  for (const [az, el, tx, tu, tz, w] of [[-0.92, 0.98, -0.136, 0.79, 0.022, 0.036], [-1.18, 0.86, -0.126, 0.64, 0.008, 0.036], [-1.44, 0.7, -0.112, 0.53, -0.012, 0.032]] as number[][]) {
    const root = sp(az, el, hairInflate(az, el), 0.012);
    const n = spN(az, el);
    const tip = V(tx, hy(tu), tz);
    const mid = root.clone().lerp(tip, 0.45).addScaledVector(n, 0.016).add(V(0, 0.008, 0));
    lock([root, mid, tip], w, 0.012, V(0, 0, 1), { sway: 0.8, full: 0.55, sheen: true });
  }

  // D. Fringe: seven pointed locks plus a few thin wisps in the gaps.
  const wisps: [number, number, number, number, number, number, number][] = [
    [-0.32, 1.05, -0.026, 0.45, 0.011, 0.018, -0.002],
    [0.11, 1.13, 0.016, 0.47, 0.011, 0.016, 0.003],
    [0.35, 1.04, 0.04, 0.52, 0.01, 0.016, 0.002],
  ];
  const fringeLock = ([az, el, tx, tu, w, tz, sweep]: (typeof FRINGE)[number], thin: boolean) => {
    const ty = hy(tu);
    const root = sp(az, el, hairInflate(az, el), 0.006);
    const n = spN(az, el);
    const mid1 = root.clone().addScaledVector(n, 0.026).add(V(0, 0.005, 0.012));
    const fh = hy(0.7);
    const mx = lerp(root.x, tx, 0.7) + sweep;
    const mid2 = V(mx, fh + 0.006, faceZ(mx, Math.min(fh, hy(0.62))) + 0.019);
    const tip = V(tx + sweep * 0.6, ty, faceZ(tx, Math.max(ty, hy(0.32))) + tz);
    strandPts(mb, [root, mid1, mid2, tip], {
      width: w,
      thick: thin ? 0.006 : 0.012,
      widthDir: V(1, 0, 0.15 * Math.sign(tx)),
      rings: 14,
      seg: 6,
      skin,
      sway: 0.5,
      sheen: thin ? undefined : lockId(),
      profile: (t) => (thin ? Math.pow(1 - t, 0.8) : Math.pow(1 - t, 0.62)) * (0.78 + 0.22 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5)),
    });
  };
  for (const f of FRINGE) fringeLock(f, false);
  for (const f of wisps) fringeLock(f, true);

  // E. Side locks in front of the ears, tips curling forward; his left side is shorter (sideburn) so the ear shows.
  for (const k of [1, -1]) {
    const sides: [number, number, number, number, number, number][] =
      k < 0
        ? [
            // root az, root el, tip x, tip u, tip z, half width
            [0.95, 0.72, 0.088, 0.36, 0.038, 0.03],
            [1.22, 0.58, 0.092, 0.31, 0.016, 0.028],
            [1.5, 0.5, 0.09, 0.34, -0.004, 0.026],
          ]
        : [
            [0.95, 0.72, 0.085, 0.43, 0.036, 0.028],
            [1.22, 0.58, 0.088, 0.41, 0.014, 0.025],
          ];
    for (const [az, el, tx, tu, tz, w] of sides) {
      const root = sp(az * k, el, hairInflate(az * k, el), 0.005);
      const n = spN(az * k, el);
      const tip = V(tx * k, hy(tu), tz);
      const mid = root.clone().lerp(tip, 0.5).addScaledVector(n, 0.012);
      lock([root, mid, tip.clone().add(V(0, 0.006, -0.004)), tip], w, 0.009, V(0, 0, 1), { sway: 0.7, full: 0.62 });
    }
  }
  // the clumps converge on the whorl and stack into a bun there: settle the volume toward the skull at the top and
  // back (radially, so every layer keeps its order and nothing pokes through)
  for (let i = 0; i < mb.pos.length; i += 3) {
    const qx = mb.pos[i] - SC.x, qy = mb.pos[i + 1] - SC.y, qz = mb.pos[i + 2] - SC.z;
    const rho = Math.hypot(qx / SR.x, qy / SR.y, qz / SR.z);
    if (rho <= 1) continue;
    const f = lerp(1, HAIR_SETTLE, smoothstep(0.55, 1.15, Math.asin(clamp(qy / SR.y / rho, -1, 1))));
    const s = (1 + (rho - 1) * f) / rho;
    mb.pos[i] = SC.x + qx * s;
    mb.pos[i + 1] = SC.y + qy * s;
    mb.pos[i + 2] = SC.z + qz * s;
  }
  // the whole top leans a little toward his right and forward, so the mass reads as swept rather than a bowl
  for (let i = 0; i < mb.pos.length; i += 3) {
    const s = smoothstep(hy(0.62), hy(1.0) + 0.04, mb.pos[i + 1]);
    mb.pos[i] -= 0.014 * s;
    mb.pos[i + 2] += 0.004 * s;
  }
  return mb.build();
}

/* ------------------------------------------------------------------------------------------ eyes */

function flipWinding(g: THREE.BufferGeometry) {
  const idx = g.index!.array as Uint16Array | Uint32Array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
}
const bz = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};
// the eye opening (eye-local metres, x outward from the inner corner): a narrow, cold almond with the outer corner lifted
const EYE_TOP = [[0, 0], [0.0042, 0.0062], [0.0172, 0.0079], [0.0285, 0.0046]];
const EYE_BOT = [[0.0285, 0.0046], [0.0222, -0.0004], [0.0092, -0.003], [0, 0]];
const eyeTop = (t: number) => [bz(EYE_TOP[0][0], EYE_TOP[1][0], EYE_TOP[2][0], EYE_TOP[3][0], t), bz(EYE_TOP[0][1], EYE_TOP[1][1], EYE_TOP[2][1], EYE_TOP[3][1], t)];
const eyeBot = (t: number) => [bz(EYE_BOT[0][0], EYE_BOT[1][0], EYE_BOT[2][0], EYE_BOT[3][0], t), bz(EYE_BOT[0][1], EYE_BOT[1][1], EYE_BOT[2][1], EYE_BOT[3][1], t)];
/* the eye shapes are drawn in their own units and scaled up to the anime eye (about 0.16 H wide); UVs keep the
   drawing units, so the iris shader reads the same coordinates */
const EYE_SCALE = 1.32;
const EYE_W = 0.0285 * EYE_SCALE;
function mirrored(s: THREE.Shape, k: number, curveSegs: number) {
  const g = new THREE.ShapeGeometry(s, curveSegs);
  g.scale(EYE_SCALE, EYE_SCALE, 1);
  if (k < 0) {
    g.scale(-1, 1, 1);
    flipWinding(g);
  }
  return g;
}
function eyeShape(k: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(EYE_TOP[1][0], EYE_TOP[1][1], EYE_TOP[2][0], EYE_TOP[2][1], EYE_TOP[3][0], EYE_TOP[3][1]);
  s.bezierCurveTo(EYE_BOT[1][0], EYE_BOT[1][1], EYE_BOT[2][0], EYE_BOT[2][1], EYE_BOT[3][0], EYE_BOT[3][1]);
  return mirrored(s, k, 20);
}
/** Heavy upper lash: overlaps the top of the opening, thickens outward and ends in a lifted, pointed wing. */
function lashShape(k: number) {
  const s = new THREE.Shape();
  const N = 26;
  s.moveTo(-0.0011, -0.0007);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [x, y] = eyeTop(t);
    s.lineTo(x - 0.0004 * (1 - t), y + 0.0003 + 0.0021 * smoothstep(0.04, 0.78, t));
  }
  s.lineTo(0.0316, 0.0073);
  s.lineTo(0.0362, 0.008);
  s.lineTo(0.0326, 0.0058);
  s.lineTo(0.0293, 0.0036);
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    const [x, y] = eyeTop(t);
    s.lineTo(x, y - 0.00095 * smoothstep(0.0, 0.3, t) - 0.0002);
  }
  return mirrored(s, k, 1);
}
/** Faint lower line on the outer half of the bottom lid. */
function lowerLashShape(k: number) {
  const s = new THREE.Shape();
  const N = 14, span = 0.58;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * span;
    const [x, y] = eyeBot(t);
    if (i === 0) s.moveTo(x, y - 0.0002);
    else s.lineTo(x, y - 0.0002);
  }
  for (let i = N; i >= 0; i--) {
    const t = (i / N) * span;
    const [x, y] = eyeBot(t);
    s.lineTo(x, y - 0.0003 - 0.00055 * Math.sin((t / span) * Math.PI) * (1 - 0.3 * (t / span)));
  }
  return mirrored(s, k, 1);
}
function browShape(k: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.0006);
  s.bezierCurveTo(0.01, 0.0032, 0.021, 0.0052, 0.0335, 0.0046);
  s.bezierCurveTo(0.022, 0.0034, 0.011, 0.0004, 0.0008, -0.0018);
  s.lineTo(0, 0.0006);
  return mirrored(s, k, 10);
}

/** Flat ink for the painted-on eye features, nudged toward the camera so the face's own relief never swallows it. */
function inkMaterial(color: THREE.ColorRepresentation, pull: number) {
  // drawn in the transparent pass (after the eye halo) so the glow never washes the ink out
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uColor: { value: new THREE.Color(color) }, uPull: { value: pull } },
    vertexShader: /* glsl */ `uniform float uPull; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xyz += normalize(-mv.xyz) * uPull; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }`,
  });
}

/** Soft anamorphic streak (long on x) for the eye glow; additive, HDR colour. */
export function makeStreakMaterial(color: THREE.ColorRepresentation, intensity: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uAmount: { value: 1 }, uBias: { value: 0.35 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAmount; uniform float uBias; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float x = p.x - uBias;            // longer on the outer side
        float fall = x > 0.0 ? 2.2 : 5.5;
        float core = exp(-p.y * p.y * 140.0) * exp(-abs(x) * fall);
        float halo = exp(-p.y * p.y * 12.0) * exp(-abs(x) * fall * 0.8) * 0.28;
        gl_FragColor = vec4(uColor * (core + halo) * uAmount, 1.0);
      }`,
  });
}

/**
 * The eye, drawn in the eye-opening shape (anime S2). Unlit (glow ~0.1): shaded white, slate blue-violet iris with a
 * dark ring and pupil, the upper lid cutting the top third of the iris (half-lidded calm). Lit (glow 1): the whole eye
 * lights, the white goes ice blue, the iris pale blue with a darker ring and a white-hot centre.
 */
function makeEyeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uGlow: { value: 1 },
      uIrisC: { value: new THREE.Vector2(0.0146, 0.0036) },
      uIrisR: { value: 0.0066 },
      uCore: { value: new THREE.Color(PALETTE.eyeCore) },
      uMid: { value: new THREE.Color(PALETTE.eyeIris) },
      uRim: { value: new THREE.Color(PALETTE.eyeRing) },
      uSclera: { value: new THREE.Color(0xc9c4d6) },
      uSlate: { value: new THREE.Color(0x727096) },
      uPull: { value: 0.0011 },
    },
    vertexShader: /* glsl */ `uniform float uPull; varying vec2 vP; void main(){ vP = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xyz += normalize(-mv.xyz) * uPull; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow; uniform vec2 uIrisC; uniform float uIrisR;
      uniform vec3 uCore; uniform vec3 uMid; uniform vec3 uRim; uniform vec3 uSclera; uniform vec3 uSlate;
      varying vec2 vP;
      void main(){
        vec2 d2 = (vP - uIrisC) / uIrisR;
        float d = length(d2);
        float aa = max(fwidth(d), 1e-3);
        float g = max(uGlow, 0.0);
        float on = smoothstep(0.12, 0.85, g);
        float iris = 1.0 - smoothstep(0.97 - aa, 0.97 + aa, d);
        float ang = atan(d2.y, d2.x);
        float fib = 0.5 + 0.5 * sin(ang * 19.0 + d * 5.0) * sin(ang * 7.0 - 1.3 + d * 3.0);
        // unlit: slate blue-violet, lighter toward the bottom, a dark ring and a dark pupil
        vec3 dim = mix(uSlate * 0.55, uSlate * 1.15, smoothstep(0.5, -0.8, d2.y)) * (0.86 + 0.28 * fib);
        dim = mix(dim, uSlate * 0.22, smoothstep(0.72, 0.95, d));
        dim = mix(dim, vec3(0.012, 0.01, 0.02), 1.0 - smoothstep(0.3, 0.4, d));
        // lit: white-hot centre, pale blue body, a thin darker ring, a hairline pupil slit
        vec3 lit = mix(uCore * 2.2, uMid * 1.05, smoothstep(0.04, 0.32, d));
        lit = mix(lit, uRim * 1.1, smoothstep(0.74, 0.96, d));
        lit *= 0.88 + 0.18 * fib;
        float slit = 1.0 - smoothstep(0.8, 1.0, length(d2 / vec2(0.07, 0.42)));
        lit = mix(lit, uRim * 0.6, slit * 0.75);
        vec3 ic = mix(dim, lit * g, on);
        // the white: shaded white unlit, ice blue lit (the whole eye glows in the anime)
        vec3 white = mix(uSclera * 0.62, mix(uMid, uCore, 0.45) * 1.35 * g, on);
        vec3 col = mix(white, ic, iris);
        // the upper lid shades the top of the opening (less once the eye burns)
        float lid = smoothstep(0.0034, 0.0072, vP.y);
        col *= 1.0 - mix(0.5, 0.25, on) * lid;
        // catch-lights
        float c1 = 1.0 - smoothstep(0.1, 0.16, length(d2 - vec2(-0.34, 0.22)));
        float c2 = 1.0 - smoothstep(0.04, 0.08, length(d2 - vec2(0.32, -0.4)));
        col += vec3(1.0) * (c1 + 0.6 * c2) * (0.8 + 1.2 * g) * iris;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** A short wispy flare trailing up and out of one glowing eye (manhwa / ARISE): u 0 at the eye, 1 at the tip. */
function makeFlareMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uCore: { value: new THREE.Color(PALETTE.eyeCore) }, uBody: { value: new THREE.Color(PALETTE.eyeHalo) }, uAmount: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xyz += normalize(-mv.xyz) * 0.03; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore; uniform vec3 uBody; uniform float uAmount; varying vec2 vUv;
      void main(){
        float u = clamp(vUv.x, 0.0, 1.0);
        float c = (vUv.y - 0.5) * 2.0 - 0.35 * u * u + 0.08 * sin(u * 9.0);
        float w = mix(0.4, 0.05, pow(u, 0.7));
        float core = exp(-c * c / (w * w * 0.08));
        float soft = exp(-c * c / (w * w * 1.2)) * 0.35;
        float along = smoothstep(0.0, 0.06, u) * pow(1.0 - u, 1.6);
        vec3 col = mix(uBody, uCore, core) * (core * 2.4 + soft) * along;
        gl_FragColor = vec4(col * clamp(uAmount, 0.0, 1.5), 1.0);
      }`,
  });
}

/** Push a decal's vertices out of the face surface (head space) so the painted feature sits on the skin, not in it. */
function conformToFace(g: THREE.BufferGeometry, eye: THREE.Object3D, lift: number) {
  eye.updateMatrix();
  const m = eye.matrix, inv = m.clone().invert();
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    const fz = faceZ(v.x, v.y) + lift;
    if (v.z < fz) v.z = fz;
    v.applyMatrix4(inv);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

function buildEyes() {
  const group = new THREE.Group();
  const streaks: THREE.Mesh[] = [];
  const eyeMats: THREE.ShaderMaterial[] = [];
  const ink = inkMaterial(0x020106, 0.0019);
  const brow = inkMaterial(0x05040b, 0.0016);
  const lowInk = inkMaterial(0x1a1530, 0.0016);
  // the glow lights the skin and hair around each eye on its own: a soft blue bloom, a clear gap over the nose. Pulled
  // toward the camera so it reads through the fringe locks that hang over the eye (the anime's glow through the hair)
  const haloMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(PALETTE.eyeHalo).multiplyScalar(0.85) }, uColor2: { value: new THREE.Color(0x2f52a3).multiplyScalar(0.5) }, uAmount: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xyz += normalize(-mv.xyz) * 0.026; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uColor2; uniform float uAmount; varying vec2 vUv;
      void main(){
        vec2 p = (vUv * 2.0 - 1.0) * vec2(1.0, 1.7);
        float r2 = dot(p, p);
        vec3 c = uColor * exp(-r2 * 14.0) + uColor2 * exp(-r2 * 4.0);
        gl_FragColor = vec4(c * clamp(uAmount, 0.0, 1.5), 1.0);
      }`,
  });
  const eyeY = hy(0.462);
  for (const k of [1, -1]) {
    const x0 = 0.0158 * k;
    const z0 = Math.max(faceZ(x0, eyeY), faceZ(x0, eyeY + 0.01)) + 0.0012;
    const x1 = (0.0158 + EYE_W) * k;
    const z1 = Math.max(faceZ(x1, eyeY), faceZ(x1, eyeY + 0.008)) + 0.0012;
    const eye = new THREE.Group();
    eye.position.set(x0, eyeY, z0);
    eye.rotation.y = Math.atan2(z0 - z1, Math.abs(x1 - x0)) * k;
    eye.rotation.z = 0.08 * k;
    const em = makeEyeMaterial();
    eyeMats.push(em);
    const opening = new THREE.Mesh(conformToFace(eyeShape(k), eye, 0.0008), em);
    const lash = new THREE.Mesh(conformToFace(lashShape(k), eye, 0.0012), ink);
    const low = new THREE.Mesh(conformToFace(lowerLashShape(k), eye, 0.001), lowInk);
    // thin, low and straight, angled down toward the nose; it sits just above the lash line
    const bg = browShape(k);
    bg.rotateZ(-0.16 * k);
    bg.translate(-0.0012 * k, 0.0108, 0);
    const br = new THREE.Mesh(conformToFace(bg, eye, 0.0012), brow);
    opening.renderOrder = 2;
    for (const m of [lash, low, br]) m.renderOrder = 4;
    eye.add(opening, lash, low, br);
    // the flare trails from his right eye only (the one under the fringe), short and wispy, up and out
    if (k < 0) {
      const streak = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.013), makeFlareMaterial());
      streak.scale.x = -1;
      streak.position.set((EYE_W + 0.0149) * k, 0.0162, 0.004);
      streak.rotation.z = 0.6 * k;
      streak.renderOrder = 20;
      eye.add(streak);
      streaks.push(streak);
    }
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.04), haloMat);
    halo.position.set(EYE_W * 0.5 * k, 0.0045, 0.004);
    halo.renderOrder = 3;
    eye.add(halo);
    group.add(eye);
  }
  const setGlow = (v: number) => {
    haloMat.uniforms.uAmount.value = v * smoothstep(0.1, 0.5, v);
    eyeMats.forEach((m) => (m.uniforms.uGlow.value = v));
    // the flare belongs to the lit eye: none while the eyes are dark, it grows in with the ignition
    const sv = v * smoothstep(0.25, 0.9, v);
    streaks.forEach((s) => {
      (s.material as THREE.ShaderMaterial).uniforms.uAmount.value = sv;
      s.visible = sv > 0.005;
    });
  };
  return { group, setGlow, streaks };
}

/* ------------------------------------------------------------------------------------------ body */

// y, rx, rz, cz  (shirt torso)
const TORSO: [number, number, number, number][] = [
  [0.96, 0.138, 0.097, 0.0],
  [1.04, 0.127, 0.089, 0.004],
  [1.12, 0.13, 0.09, 0.008],
  [1.2, 0.142, 0.097, 0.012],
  [1.28, 0.155, 0.104, 0.014],
  [1.35, 0.163, 0.103, 0.011],
  [1.41, 0.168, 0.095, 0.003],
  [1.45, 0.172, 0.085, -0.006],
  [1.48, 0.148, 0.072, -0.011],
  [1.5, 0.105, 0.061, -0.013],
];
function torsoAt(y: number): [number, number, number] {
  if (y <= TORSO[0][0]) return [TORSO[0][1], TORSO[0][2], TORSO[0][3]];
  for (let i = 0; i < TORSO.length - 1; i++) {
    const a = TORSO[i], b = TORSO[i + 1];
    if (y <= b[0]) {
      const t = (y - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    }
  }
  const l = TORSO[TORSO.length - 1];
  return [l[1], l[2], l[3]];
}
const boxy = (th: number, n = 2.4) => {
  const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
  return 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n);
};

export function buildJinwoo(opts: { seed?: number } = {}): Character {
  const rig = new Rig(JW_BONES);
  const I = (n: string) => rig.i(n);
  let ignitedAt = -1;
  let smirkOverride: number | null = null;
  const smirkAt = (dt: number) => (dt < 0.35 ? 0 : dt < 2.7 ? smoothstep(0.35, 0.95, dt) : lerp(1, 0.4, smoothstep(2.7, 3.7, dt)));
  const group = new THREE.Group();
  group.name = 'jinwoo';
  group.add(rig.root);

  const mats = {
    // the hem only takes a dark violet cast and a hairline of glow at the tongue tips: the smoke aura leads, not the coat
    coat: makeToon({ ...COAT_LOOK, hemEdge: true, hemColor: 0x24163f, hemGlow: 0.32, strokes: { lines: COAT_LINES, space: [0.72, 0.0, 1.3], sheen: 0x1c1830 } }),
    trimCoat: makeToon({ ...COAT_LOOK, hemEdge: true, rimFar: [1.6, 3.6, 0.15] }),
    // ARISE trims are cyan steel (#689CB1 .. #B9D9E5) with a faint glow, not a neon line
    trim: makeToon({ base: 0x000000, shade: 0x000000, rim: 0, keyMul: 0, emissive: PALETTE.inlay, emissiveIntensity: 0.62 }),
    inlay: makeToon({ base: 0x000000, shade: 0x000000, rim: 0, keyMul: 0, emissive: PALETTE.inlay, emissiveIntensity: 0.55, doubleSide: true, emissiveFar: [2.6, 4.4, 0.4] }),
    hood: makeToon({ ...COAT_LOOK, base: 0x302b38, shade: 0x0b0a10, hemEdge: true }),
    sleeveL: makeToon({ ...COAT_LOOK, hemEdge: true, strokes: { lines: mirrorSleeve(SLEEVE_LINES_R), space: [1.0, -0.025, -2.5, 0.2], sheen: 0x1c1830 } }),
    sleeveR: makeToon({ ...COAT_LOOK, hemEdge: true, strokes: { lines: SLEEVE_LINES_R, space: [1.0, -0.025, -1.2, -0.2], sheen: 0x1c1830 } }),
    lining: makeToon({ ...PALETTE.lining, groundMul: 0.35, rim: 0.5, rimWidth: 0.6, rimFar: [2.4, 4.2, 0.35], rimLow: [0.95, 0.3, 0.3], animFps: ANIM_FPS, flutterAmp: COAT_FLUTTER, flare: COAT_FLARE, flareBack: COAT_FLARE_BACK, hemEdge: true, hemColor: 0x22174a, hemGlow: 0.28, backShade: 0.8 }),
    // the white scoop T-shirt: the brightest large shape on him, with the coat's edges throwing a hard shadow onto it
    shirt: makeToon({ ...PALETTE.shirt, rim: 0.25, rimWidth: 0.74, term: 0.3, soft: 0.015, keyMul: 4.5, keyClamp: true, keyFar: [2.4, 4.2, 0.65], farDim: [2.4, 4.4, 0.82], rimUpCut: 1, castV: [1.385, 0.0, 0.0, 0.3], castCurve: [2.6, 0.005, 62], occlude: { half: [0.64, 0.1, 3.77, 1.12], band: [0.3, -0.05], dark: 0.45, cz: 0.008 }, strokes: { lines: [...SHIRT_FOLDS, ...SHIRT_LINES], space: [0.7, 0.008, -1.0], ink: 0x55526c } }),
    pants: makeToon({ ...PALETTE.pants, rim: 0.45, rimWidth: 0.72, keyMul: 0.5, groundMul: 0.3 }),
    shoes: makeToon({ ...PALETTE.shoes, rim: 0.45, rimWidth: 0.6, rimTint: 0xb8a8c8 }),
    skin: makeToon({ ...PALETTE.skin, rim: 0.85, rimWidth: 0.62, term: 0.2, soft: 0.012, keyMul: 4.5, keyClamp: true }),
    // hands: the insert shots need a clean cel split (lit back of the hand, shaded palm) to read as form
    hand: makeToon({ ...PALETTE.skin, rim: 0.8, rimWidth: 0.62, term: 0.3, soft: 0.03, keyMul: 4.0, keyClamp: true, keyFar: [1.4, 3.2, 0.3], farDim: [2.2, 4.4, 0.6] }),
    // neck: little key, and the jaw's sharp V shadow over its upper half (the anime's signature cel shape)
    neck: makeToon({ ...PALETTE.skin, rim: 0.7, rimWidth: 0.64, rimWrap: 0.35, term: 0.25, soft: 0.012, keyMul: 1.2, keyClamp: true, farDim: [2.2, 4.4, 0.6], castV: [1.5, 0.95, -100, 0.62], strokes: { lines: NECK_LINES, space: [0.95, 0.0, -1.2], ink: 0x3a2a30, sheen: 0x000000 } }),
    // face: a pale anime face; the fringe throws a diagonal band over the eyes, the nose, mouth and jaw stay lit
    face: makeToon({ ...PALETTE.skin, rim: 0.9, rimWidth: 0.74, rimWrap: 0.3, term: 0.1, soft: 0.012, faceShadowY: hy(0.405), faceShadowDark: 0.42, keyMul: 5.0, keyClamp: true, keyFar: [1.8, 4.2, 0.45], farDim: [2.2, 4.4, 0.6], faceMask: FACE_MASK, faceMaskSlope: 0.22, keyBias: [0.2, 0.04, 0.2], shadeNormal: { centre: V(0, hy(0.5), -0.014), radii: V(0.084, 0.13, 0.1), blend: 0.72 } }),
    hair: makeToon({
      base: PALETTE.hair.base, shade: PALETTE.hair.shade, rim: 1.0, rimWidth: 0.7, rimFar: [2.2, 4.0, 0.3], animFps: ANIM_FPS, hair: true, spec: 1.0, specColor: PALETTE.hair.spec, swayAmp: 0.01, keyMul: 1.1, term: 0.22, soft: 0.012, rimUpCut: 0.92,
      hairCentre: SC, hairRadii: SR.clone().multiplyScalar(1.0), ringEl: 0.68, ringW: 0.026, hairDepth: 0.93, hairLines: 0.7,
      hairSheen: { at: 0.56, jitter: 0.16, len: 0.26, w: 0.24, dark: 0.5, color: new THREE.Color(PALETTE.hair.spec).multiplyScalar(0.78) },
    }),
    steel: makeToon({ ...PALETTE.steel, rim: 1.1, rimWidth: 0.5, rimTint: 0xb9d9e5, term: 0.05, soft: 0.01, keyMul: 3.2, keyClamp: true }),
    leather: makeToon({ ...PALETTE.leather, rim: 0.6, rimWidth: 0.6 }),
  } as Record<string, ToonMaterial>;
  const outlines: THREE.ShaderMaterial[] = [];
  const emissive: THREE.MeshBasicMaterial[] = [];

  const addSkinned = (geo: THREE.BufferGeometry, mat: ToonMaterial, outlinePx = 1.5, flutter = 0, outlineGeo?: THREE.BufferGeometry) => {
    const m = new THREE.SkinnedMesh(geo, mat);
    m.bind(rig.skeleton);
    m.frustumCulled = false;
    group.add(m);
    if (outlinePx > 0) {
      const u = mat.uniforms;
      const om = makeOutline(outlinePx, 0x020106, flutter || u.uFlutterAmp.value, u.uSwayAmp.value, u.uFlare.value, u.uFlareBack.value, ANIM_FPS);
      outlines.push(om);
      const o = new THREE.SkinnedMesh(outlineGeo ?? geo, om);
      o.bind(rig.skeleton);
      o.frustumCulled = false;
      group.add(o);
    }
    return m;
  };
  const addRigid = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, outlinePx = 1.5, sway = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    parent.add(m);
    if (outlinePx > 0) {
      const om = makeOutline(outlinePx, 0x020106, 0, sway, 0, 0.5, ANIM_FPS);
      outlines.push(om);
      const o = new THREE.Mesh(geo, om);
      o.frustumCulled = false;
      parent.add(o);
    }
    return m;
  };

  /* head */
  const headBone = rig.b('head');
  // the mouth: an ink line whose left corner can lift into a faint one-sided smirk (uSmirk 0..1), with a corner tick
  const MY = hy(0.13);
  const mouthMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uColor: { value: new THREE.Color(0x2a171b) }, uPull: { value: 0.0012 }, uSmirk: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uPull; uniform float uSmirk;
      void main(){
        vec3 p = position;
        float s = clamp(uSmirk, 0.0, 1.0);
        if (p.x > 0.01235) {
          p.xy = mix(vec2(0.01355, ${(MY + 0.0019).toFixed(5)}), p.xy, s);
          p.y += s * 0.0021;
        } else {
          float side = smoothstep(0.0, 0.0122, p.x);
          p.y += s * 0.0021 * side * side;
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xyz += normalize(-mv.xyz) * uPull;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }`,
  });
  {
    const mb = new MeshBuilder();
    loft(mb, HEAD_ROWS.map(headRing), 48, { capStart: true, capEnd: true });
    addRigid(mb.build(), mats.face, headBone, 1.25);
  }
  // ears (one mesh for both): large, set low (top at the eye line, lobe just above the nose tip), the top standing a
  // little off the head; the inner fold is an ink curve drawn with the nose
  const earInk: THREE.BufferGeometry[] = [];
  {
    const ears: THREE.BufferGeometry[] = [];
    for (const k of [1, -1]) {
      const mb = new MeshBuilder();
      const c = V(0.343 * HH * k, hy(0.385), -0.03 * HH);
      // a rounded rim: the four profile rings plus tapered end rings, resampled along a smooth spine
      const key: [THREE.Vector3, number, number][] = [
        [V(-0.0042 * k, -0.0262, 0.0042), 0.0012, 0.0028],
        [V(-0.004 * k, -0.022, 0.003), 0.0032, 0.0075],
        [V(0.002 * k, -0.008, 0), 0.0058, 0.0135],
        [V(0.0045 * k, 0.012, -0.004), 0.0052, 0.0135],
        [V(0.002 * k, 0.026, -0.007), 0.003, 0.0065],
        [V(0.0012 * k, 0.0302, -0.0088), 0.0011, 0.0024],
      ];
      const spine = new THREE.CatmullRomCurve3(key.map(([o]) => c.clone().add(o)), false, 'centripetal');
      const rings: Ring[] = [];
      for (let i = 0; i <= 15; i++) {
        const t = i / 15, s = t * (key.length - 1), j = Math.min(key.length - 2, Math.floor(s)), f = smoothstep(0, 1, s - j);
        rings.push({ c: spine.getPoint(t), rx: lerp(key[j][1], key[j + 1][1], f), rz: lerp(key[j][2], key[j + 1][2], f), skin: [[0, 1]], t: spine.getTangent(t) });
      }
      loft(mb, rings, 16, { capStart: true, capEnd: true });
      // the fold: a C from the top front, round the back and down to the lobe (drawn in the ear's z/y plane)
      const s = new THREE.Shape();
      const P = new THREE.SplineCurve([[0.003, 0.017], [-0.006, 0.019], [-0.011, 0.008], [-0.009, -0.006], [-0.002, -0.013]].map(([x, y]) => new THREE.Vector2(x, y))).getPoints(18).map((v) => [v.x, v.y] as [number, number]);
      const w = 0.0008;
      s.moveTo(P[0][0], P[0][1]);
      for (const p of P.slice(1)) s.lineTo(p[0], p[1]);
      P.slice().reverse().forEach((p, i) => { const t = Math.sin((i / (P.length - 1)) * Math.PI); s.lineTo(p[0] * 0.8 + 0.0008 * t, p[1] * 0.85 - w * t * Math.sign(p[1])); });
      const g = new THREE.ShapeGeometry(s, 1);
      if (k > 0) g.scale(-1, 1, 1);
      g.rotateY((k * Math.PI) / 2);
      if (k > 0) flipWinding(g);
      g.translate(0.0902 * k, c.y - 0.001, c.z - 0.002);
      // the anime ear stands off the skull: hinged at its front edge, the back swings out so it shows past the side
      // hair from the front (his left ear fully, his right one under the longer side locks)
      const pivot = V(c.x, c.y, c.z + 0.011);
      const flare = new THREE.Matrix4()
        .makeTranslation(pivot.x, pivot.y, pivot.z)
        .multiply(new THREE.Matrix4().makeRotationY(-k * EAR_FLARE))
        .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      const eg = mb.build();
      eg.applyMatrix4(flare);
      g.applyMatrix4(flare);
      ears.push(eg);
      earInk.push(g);
    }
    addRigid(mergeGeometries(ears), mats.face, headBone, 1.0);
  }
  // nose (anime S2): one long line down the shaded side of the bridge from the inner eye, and a small hook at the tip
  {
    const sh = new THREE.Shape();
    sh.moveTo(0.0046, hy(0.375));
    sh.quadraticCurveTo(0.0056, hy(0.3), 0.0058, hy(0.236));
    sh.quadraticCurveTo(0.0046, hy(0.212), 0.0006, hy(0.205));
    sh.lineTo(0.0004, hy(0.2085));
    sh.quadraticCurveTo(0.0038, hy(0.216), 0.0049, hy(0.238));
    sh.quadraticCurveTo(0.0049, hy(0.3), 0.0045, hy(0.375));
    const g = conformToFace(new THREE.ShapeGeometry(sh, 8), new THREE.Group(), 0.0012);
    const m = new THREE.Mesh(mergeGeometries([g, ...earInk]), inkMaterial(0x5a4346, 0.0012));
    m.renderOrder = 4;
    headBone.add(m);
  }
  // mouth: a tapered ink stroke, thickest at the centre with the corners turned faintly down, and a short lower-lip mark
  {
    const my = hy(0.13);
    const stroke = (x0: number, x1: number, y: number, thick: number, droop: number) => {
      const s = new THREE.Shape();
      const N = 12;
      const top: [number, number][] = [], bot: [number, number][] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = lerp(x0, x1, t);
        const yc = y - droop * Math.pow(2 * t - 1, 2);
        const h = thick * Math.pow(Math.sin(Math.PI * t), 0.6) + 0.00012;
        top.push([x, yc + h * 0.5]);
        bot.push([x, yc - h * 0.5]);
      }
      s.moveTo(top[0][0], top[0][1]);
      for (const p of top.slice(1)) s.lineTo(p[0], p[1]);
      for (const p of bot.reverse()) s.lineTo(p[0], p[1]);
      return s;
    };
    // the smirk's corner tick at his left mouth corner (x > 0), drawn only while he smirks
    const tick = new THREE.Shape();
    tick.moveTo(0.0126, my + 0.0004);
    tick.quadraticCurveTo(0.0141, my + 0.0012, 0.0146, my + 0.0034);
    tick.lineTo(0.0141, my + 0.0033);
    tick.quadraticCurveTo(0.0136, my + 0.0016, 0.0125, my + 0.0009);
    const g = conformToFace(new THREE.ShapeGeometry([stroke(-0.0122, 0.0122, my, 0.0011, 0.0004), stroke(-0.0032, 0.0036, my - 0.0064, 0.0007, -0.0002), tick], 6), new THREE.Group(), 0.0012);
    const m = new THREE.Mesh(g, mouthMat);
    m.renderOrder = 4;
    m.onBeforeRender = () => {
      mouthMat.uniforms.uSmirk.value = smirkOverride ?? (ignitedAt < 0 ? 0 : smirkAt(light.uTime.value - ignitedAt));
    };
    headBone.add(m);
  }
  addRigid(buildHair(opts.seed ?? 11), mats.hair, headBone, 1.6, 0.01);
  const eyes = buildEyes();
  // the faint smirk follows the ignition: a beat after the eyes light it lifts, holds a second or two, then settles
  // to a trace that stays while he is powered (stage time, so captures are deterministic)
  const baseSetGlow = eyes.setGlow;
  eyes.setGlow = (v: number) => {
    baseSetGlow(v);
    if (v >= 0.9 && ignitedAt < 0) ignitedAt = light.uTime.value;
    if (v < 0.5) ignitedAt = -1;
  };
  headBone.add(eyes.group);

  /* neck + upper chest skin (seen in the shirt's scoop) */
  {
    const mb = new MeshBuilder();
    const R: [number, number, number, number][] = [
      [1.36, 0.095, 0.06, 0.03],
      [1.42, 0.085, 0.058, 0.014],
      [1.47, 0.06, 0.05, -0.006],
      [1.505, 0.046, 0.045, -0.013],
      [1.545, 0.0415, 0.0425, -0.017],
      [1.59, 0.041, 0.042, -0.02],
      [1.625, 0.042, 0.042, -0.019],
    ];
    const rings: Ring[] = R.map(([y, rx, rz, cz]) => ({
      c: V(0, y, cz),
      rx,
      rz,
      t: V(0, 1, 0),
      skin: y < 1.46 ? [[I('chest'), 1]] : y < 1.55 ? blendSkin([[I('chest'), 1]], [[I('neck'), 1]], smoothstep(1.46, 1.53, y)) : blendSkin([[I('neck'), 1]], [[I('head'), 1]], smoothstep(1.56, 1.62, y)),
    }));
    loft(mb, rings, 24, { capStart: true });
    addSkinned(mb.build(), mats.neck, 1.0);
  }

  /* shirt */
  {
    const mb = new MeshBuilder();
    // the scoop: a round U from the shoulders down to just under the collarbones; the rings above SCOOP0 are
    // gathered under it at the front so the neckline itself is the top edge (not a level band above a fold)
    const SCOOP0 = 1.38, NECK_Y = 1.49;
    const scoopY = (th: number) => NECK_Y - 0.072 * Math.pow(Math.max(0, Math.sin(th)), 2.4);
    const scoopDy = (y: number) => (th: number) => SCOOP0 + ((y - SCOOP0) / (NECK_Y - SCOOP0)) * (scoopY(th) - SCOOP0) - y;
    const rings: Ring[] = TORSO.slice(0, -1).map(([y, rx, rz, cz]) => ({
      c: V(0, y, cz),
      rx,
      rz,
      t: V(0, 1, 0),
      dyFn: y > SCOOP0 ? scoopDy(y) : undefined,
      skin: [],
      skinFn: (th: number) => {
        const side = Math.cos(th);
        let s: Skin;
        if (y < 1.13) s = blendSkin([[I('hips'), 1]], [[I('spine'), 1]], smoothstep(0.98, 1.13, y));
        else if (y < 1.28) s = blendSkin([[I('spine'), 1]], [[I('chest'), 1]], smoothstep(1.13, 1.28, y));
        else s = [[I('chest'), 1]];
        if (y > 1.36) s = blendSkin(s, [[side > 0 ? I('shL') : I('shR'), 1]], smoothstep(0.35, 0.95, Math.abs(side)) * smoothstep(1.36, 1.46, y) * 0.6);
        return s;
      },
      shape: (th) => boxy(th),
    }));
    // scoop neckline ring: lower at the front
    rings.push({
      c: V(0, NECK_Y, -0.008),
      rx: 0.12,
      rz: 0.068,
      t: V(0, 1, 0),
      skin: [[I('chest'), 1]],
      dyFn: (th) => scoopY(th) - NECK_Y,
    });
    loft(mb, rings, 40, { capStart: true });
    addSkinned(mb.build(), mats.shirt, 1.3);
  }

  /* coat: one shell around the body, open at the front, split at the back below the waist, tattered hem */
  const coatOuter = new MeshBuilder();
  const coatInner = new MeshBuilder();
  let coatPoint = (y: number, th: number) => V(0, y, th);
  {
    const rng = mulberry32(5);
    const COLS = 56;
    // Hem: tongues of different widths and lengths with V notches between them, the tips leaning sideways like licks
    // of smoke; the longest tails hang either side of the back vent and at the front corners. ARISE: the hem sits
    // just under the knee, so the slim legs carry the height.
    const HEM = 0.43;
    const tongues: { u: number; w: number; L: number; lean: number }[] = [];
    for (let u = 0.03; u < 0.975; ) {
      // wide enough to span several columns, so each reads as a flame tongue rather than a one-column spike
      const w = rrange(rng, 0.022, 0.042);
      const vent = Math.exp(-Math.pow((u - 0.5) / 0.06, 2));
      const L = rrange(rng, 0.035, 0.1) + 0.05 * vent + (rng() < 0.3 ? rrange(rng, 0.04, 0.075) : 0);
      tongues.push({ u, w, L, lean: rrange(rng, -1, 1) * w * 3 });
      u += w * rrange(rng, 0.95, 1.4);
    }
    const hemAt = (u: number) => {
      let d = 0, lean = 0, ws = 0;
      for (const t of tongues) {
        const k = 1 - Math.abs(u - t.u) / t.w;
        if (k <= 0) continue;
        d = Math.max(d, t.L * Math.pow(k, 1.35));
        lean += t.lean * k;
        ws += k;
      }
      const corner = smoothstep(0.78, 1.0, Math.abs(u - 0.5) * 2) * 0.075;
      return { y: HEM - d - corner, d: d + corner, lean: ws > 0 ? lean / ws : 0 };
    };
    const WAIST = 1.02;
    const coatRadius = (y: number, th: number): [number, number, number] => {
      if (y >= WAIST) {
        let [rx, rz, cz] = torsoAt(y);
        const shoulder = smoothstep(1.38, 1.46, y) * (1 - smoothstep(1.47, 1.53, y));
        rx += 0.016 + 0.018 * shoulder * smoothstep(0.5, 1, Math.abs(Math.cos(th)));
        rz += 0.016;
        if (y > 1.48) {
          // collar: hugs the neck, stands up behind it
          const t = smoothstep(1.48, 1.58, y);
          rx = lerp(rx, 0.075, t);
          rz = lerp(rz, 0.066, t);
          cz = lerp(cz, -0.016, t);
        }
        return [rx, rz, cz];
      }
      const v = (WAIST - y) / (WAIST - 0.3);
      const [rx0, rz0, cz0] = torsoAt(WAIST);
      // an A-line that opens a little more toward the hem
      const s = Math.pow(clamp(v), 0.85);
      return [lerp(rx0 + 0.016, 0.27, s) + 0.03 * s * s, lerp(rz0 + 0.016, 0.21, s) + 0.02 * s * s, cz0 - 0.03 * clamp(v)];
    };
    const foldAt = (y: number, th: number, v: number) => {
      if (y >= WAIST) return 1;
      let k = 1 + 0.03 * Math.pow(v, 1.1) * Math.sin(th * 5 + 0.7 + v * 1.4);
      for (const [ft, d, w, yt] of COAT_FOLDS) {
        const s = smoothstep(yt, yt - 0.3, y) * (0.55 + 0.45 * smoothstep(0.85, 0.35, y));
        k -= d * s * Math.exp(-Math.pow((th - ft) / w, 2));
      }
      return k;
    };
    const ROWS_TOP = 16, ROWS_BOT = 15, NC = 46;
    const SPLIT = 0.86;
    const topY = (th: number) => 1.505 + 0.055 * Math.pow(Math.max(0, -Math.sin(th)), 1.5);
    const point = (y: number, th: number, v: number) => {
      const [rx, rz, cz] = coatRadius(y, th);
      const folds = foldAt(y, th, v);
      const k = y >= WAIST && y < 1.48 ? boxy(th) : 1;
      return V(Math.cos(th) * rx * folds * k, y, Math.sin(th) * rz * folds * k + cz);
    };
    const thAt = (u: number, y: number) => lerp(coatEdge(y, -1), coatEdge(y, 1), u);
    coatPoint = (y: number, th: number) => point(y, th, Math.max(0, (WAIST - y) / (WAIST - 0.3)));
    // upper grid: collar to the split line, all the way round
    const upper: THREE.Vector3[][] = [];
    for (let r = 0; r < ROWS_TOP; r++) {
      const v = r / (ROWS_TOP - 1);
      const row: THREE.Vector3[] = [];
      for (let c = 0; c < COLS; c++) {
        const u = c / (COLS - 1);
        const th0 = thAt(u, 1.5);
        const y = lerp(topY(th0), SPLIT, Math.pow(v, 0.85));
        const th = thAt(u, y);
        row.push(point(y, th, Math.max(0, (WAIST - y) / (WAIST - 0.3))));
      }
      upper.push(row);
    }
    const skinCoat = (y: number, th: number): Skin => {
      const side = Math.cos(th);
      let s: Skin;
      if (y > 1.48) s = blendSkin([[I('chest'), 1]], [[I('neck'), 1]], smoothstep(1.5, 1.58, y) * 0.5);
      else if (y > 1.28) s = [[I('chest'), 1]];
      else if (y > 1.13) s = blendSkin([[I('spine'), 1]], [[I('chest'), 1]], smoothstep(1.13, 1.28, y));
      else if (y > 0.98) s = blendSkin([[I('hips'), 1]], [[I('spine'), 1]], smoothstep(0.98, 1.13, y));
      else {
        const v = (0.98 - y) / 0.68;
        const front = Math.max(0, Math.sin(th));
        s = blendSkin([[I('hips'), 1]], [[side > 0 ? I('tgL') : I('tgR'), 1]], clamp(v) * (0.12 + 0.3 * front) * smoothstep(0.1, 0.6, Math.abs(side)));
      }
      if (y > 1.36 && y < 1.52) s = blendSkin(s, [[side > 0 ? I('shL') : I('shR'), 1]], smoothstep(0.4, 0.95, Math.abs(side)) * 0.55);
      return s;
    };
    const flut = (y: number, u: number) => {
      const v = clamp((WAIST - y) / (WAIST - 0.33));
      const edge = smoothstep(0.75, 1.0, Math.abs(u - 0.5) * 2);
      return Math.pow(v, 1.3) * (0.85 + 0.5 * edge);
    };
    // the violet of the lining bleeds into the lower coat as a dark tint, strongest on the tongues
    const hemTint = (y: number) => Math.pow(clamp((HEM + 0.07 - y) / 0.22), 1.4);
    shell2(
      coatOuter,
      coatInner,
      upper,
      (r, c) => skinCoat(upper[r][c].y, thAt(c / (COLS - 1), upper[r][c].y)),
      (r, c) => flut(upper[r][c].y, c / (COLS - 1)),
      0.011,
    );
    // lower panels: from slightly above the split (overlap) to the tattered hem
    for (const [u0, u1] of [[0, 0.509], [0.491, 1]] as [number, number][]) {
      const left = u0 === 0;
      const grid: THREE.Vector3[][] = [];
      const us: number[] = [];
      for (let cc = 0; cc < NC; cc++) us.push(lerp(u0, u1, cc / (NC - 1)));
      const hems = us.map(hemAt);
      for (let r = 0; r < ROWS_BOT; r++) {
        const v = r / (ROWS_BOT - 1);
        const row: THREE.Vector3[] = [];
        for (let cc = 0; cc < NC; cc++) {
          const u = us[cc];
          const h = hems[cc];
          const y = lerp(SPLIT + 0.03, h.y, v);
          let th = thAt(u, y);
          // vent: pull the two back edges apart
          const ventOpen = smoothstep(SPLIT, 0.3, y) * 0.16;
          const d = left ? cc / (NC - 1) : 1 - cc / (NC - 1);
          th += (left ? -1 : 1) * ventOpen * (cc === (left ? NC - 1 : 0) ? 1 : Math.pow(d, 6));
          // tongue tips lean sideways
          const s = clamp((HEM - y) / Math.max(h.d, 0.01));
          th += h.lean * s * s;
          row.push(point(y, th, clamp((WAIST - y) / (WAIST - 0.3))));
        }
        grid.push(row);
      }
      shell2(
        coatOuter,
        coatInner,
        grid,
        (r, cc) => skinCoat(grid[r][cc].y, thAt(us[cc], grid[r][cc].y)),
        (r, cc) => flut(grid[r][cc].y, us[cc]),
        0.011,
        (r, cc) => hemTint(grid[r][cc].y),
      );
    }
  }
  const coatOuterGeo = coatOuter.build();
  const coatInnerGeo = coatInner.build();
  const coatOutlineGeo = mergeGeometries([coatOuterGeo, coatInnerGeo]);
  addSkinned(coatOuterGeo, mats.coat, 1.6, 0, coatOutlineGeo);
  addSkinned(coatInnerGeo, mats.lining, 0);

  /* the shared metal (pauldron, buckles, chain) and cyan inlay (lapels, pauldron edges, cuffs) builders: one draw call each */
  const steelMb = new MeshBuilder();
  const inlayMb = new MeshBuilder();
  /** a flat inlay ribbon through points (object space), standing `lift` off the surface along n */
  const ribbon = (pts: THREE.Vector3[], n: (i: number) => THREE.Vector3, half: number, skin: Skin, lift = 0.0012) => {
    const e0 = inlayMb.count;
    for (let i = 0; i < pts.length; i++) {
      const tan = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
      const nn = n(i);
      const side = new THREE.Vector3().crossVectors(tan, nn).normalize().multiplyScalar(half);
      const p = pts[i].clone().addScaledVector(nn, lift);
      inlayMb.vert(p.clone().add(side), skin);
      inlayMb.vert(p.clone().sub(side), skin);
    }
    for (let i = 0; i < pts.length - 1; i++) inlayMb.quad(e0 + 2 * i, e0 + 2 * i + 2, e0 + 2 * i + 3, e0 + 2 * i + 1);
  };

  /* lapel facings (ARISE): long narrow bands turned back along the coat's front edges from the neck to the waist,
     each with a cyan-steel inlay: a line down the band and two knot diamonds on the chest */
  {
    const mb = new MeshBuilder();
    const facingSkin = (y: number): Skin => (y > 1.28 ? [[I('chest'), 1]] : blendSkin([[I('spine'), 1]], [[I('chest'), 1]], smoothstep(1.1, 1.28, y)));
    for (const k of [1, -1]) {
      const rows = 14, cols = 4;
      const Y0 = 1.505, Y1 = 1.04;
      const widthAt = (v: number) => lerp(0.036, 0.024, v) * (v > 0.9 ? lerp(1, 0.25, (v - 0.9) / 0.1) : 1);
      const at = (y: number, s: number, lift: number) => {
        // s: metres in from the coat's front edge, measured round the body
        const [rx] = torsoAt(Math.min(y, 1.47));
        const th = coatEdge(y, k) - k * (s / Math.max(rx + 0.016, 0.05));
        const p = coatPoint(y, th);
        const c = V(0, y, torsoAt(Math.min(y, 1.47))[2]);
        return p.add(p.clone().sub(c).setY(0).normalize().multiplyScalar(lift));
      };
      const grid: THREE.Vector3[][] = [];
      for (let r = 0; r < rows; r++) {
        const v = r / (rows - 1);
        const y = lerp(Y0, Y1, v);
        const row: THREE.Vector3[] = [];
        for (let c = 0; c < cols; c++) row.push(at(y, -0.002 + (c / (cols - 1)) * widthAt(v), 0.005 + 0.002 * (1 - v)));
        if (k > 0) row.reverse();
        grid.push(row);
      }
      shell(mb, grid, (r) => facingSkin(lerp(Y0, Y1, r / (rows - 1))), () => 0, 0.005);
      // the inlay: a line down the middle of the band, two knot diamonds over the chest
      const line: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const v = lerp(0.04, 0.86, i / 16);
        line.push(at(lerp(Y0, Y1, v), widthAt(v) * 0.5, 0.0084));
      }
      const outN = (y: number) => at(y, 0.012, 0.02).sub(at(y, 0.012, 0.0)).normalize();
      ribbon(line, (i) => outN(line[i].y), 0.0013, facingSkin(1.3), 0.0018);
      for (const yk of [1.43, 1.3]) {
        const v = (Y0 - yk) / (Y0 - Y1);
        const w = widthAt(v) * 0.5;
        const d = 0.011;
        const dia = [at(yk + d, w, 0.0084), at(yk, w + 0.012, 0.0084), at(yk - d, w, 0.0084), at(yk, w - 0.012, 0.0084)];
        ribbon([dia[0], dia[1], dia[2], dia[3], dia[0], dia[1]], () => outN(yk), 0.0013, facingSkin(yk), 0.0018);
      }
    }
    addSkinned(mb.build(), mats.trimCoat, 1.3);
  }

  /* hood (ARISE): a soft dark grey hood lying behind the neck, rising at the back to ear-lobe height, so from the front
     it frames the neck like a high collar */
  {
    const mb = new MeshBuilder();
    const rows = 9, cols = 16;
    const grid: THREE.Vector3[][] = [];
    for (let r = 0; r < rows; r++) {
      const v = r / (rows - 1);
      const y = lerp(1.6, 1.33, v);
      const row: THREE.Vector3[] = [];
      const span = lerp(2.5, 0.6, Math.pow(v, 1.2));
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1);
        const th = Math.PI * 1.5 + (u - 0.5) * span;
        const [rx, rz, cz] = torsoAt(Math.min(y, 1.47));
        const bulge = Math.sin(u * Math.PI) * (0.03 + 0.035 * Math.sin(v * Math.PI));
        const rxx = y > 1.48 ? lerp(rx, 0.088, smoothstep(1.48, 1.58, y)) : rx;
        const rzz = y > 1.48 ? lerp(rz, 0.074, smoothstep(1.48, 1.58, y)) : rz;
        // the hood's rim rolls forward at the sides of the neck
        const roll = smoothstep(0.55, 0.0, v) * Math.pow(Math.abs(u - 0.5) * 2, 3) * 0.018;
        row.push(V(Math.cos(th) * (rxx + 0.028 + bulge * 0.4), y - roll, Math.sin(th) * (rzz + 0.028 + bulge) + cz - 0.008 + roll * 0.6));
      }
      grid.push(row);
    }
    shell(mb, grid, (r) => blendSkin([[I('chest'), 1]], [[I('neck'), 1]], 0.35 * (1 - r / (rows - 1))), () => 0, 0.01);
    addSkinned(mb.build(), mats.hood, 1.5);
  }

  /* sleeves + cuff trim (ARISE: a band of cyan geometric trim, a pattern rather than one plain line). Both cuffs are
     one mesh; a toon material, so the trims dissolve and clip with the body instead of floating */
  const trimMat = mats.trim;
  const trimMb = new MeshBuilder();
  for (const s of ['L', 'R'] as const) {
    const k = s === 'L' ? 1 : -1;
    const sh = rig.b('ua' + s).getWorldPosition(new THREE.Vector3());
    const el = rig.b('fa' + s).getWorldPosition(new THREE.Vector3());
    const wr = rig.b('ha' + s).getWorldPosition(new THREE.Vector3());
    const pts = smoothPath([sh.clone().add(V(-0.035 * k, 0.03, 0)), sh.clone().add(V(0.006 * k, -0.04, 0)), el, wr.clone().add(V(0, -0.025, 0))], 18);
    const rings: Ring[] = pts.map((c, i) => {
      const t = i / (pts.length - 1);
      const r = t < 0.12 ? lerp(0.052, 0.062, t / 0.12) : t < 0.5 ? lerp(0.062, 0.05, (t - 0.12) / 0.38) : t < 0.88 ? lerp(0.05, 0.044, (t - 0.5) / 0.38) : lerp(0.044, 0.049, (t - 0.88) / 0.12);
      let skin: Skin;
      if (t < 0.15) skin = blendSkin([[I('sh' + s), 0.5], [I('chest'), 0.5]], [[I('ua' + s), 1]], t / 0.15);
      else if (t < 0.42) skin = [[I('ua' + s), 1]];
      else if (t < 0.58) skin = blendSkin([[I('ua' + s), 1]], [[I('fa' + s), 1]], smoothstep(0.42, 0.58, t));
      else skin = [[I('fa' + s), 1]];
      return { c, rx: r, rz: r * 1.05, skin };
    });
    const mb = new MeshBuilder();
    loft(mb, rings, 18, { capStart: true, capEnd: true });
    addSkinned(mb.build(), s === 'L' ? mats.sleeveL : mats.sleeveR, 1.5);
    // trim: two thin bands with a zigzag between them, a little above the cuff
    const a = pts[pts.length - 3], b = pts[pts.length - 2];
    const fs: Skin = [[I('fa' + s), 1]];
    const ax = b.clone().sub(a).normalize();
    const ring = (o: number, w: number) => {
      const c0 = a.clone().addScaledVector(ax, o);
      loft(trimMb, [
        { c: c0, rx: 0.0458, rz: 0.0481, skin: fs, t: ax },
        { c: c0.clone().addScaledVector(ax, w), rx: 0.0458, rz: 0.0481, skin: fs, t: ax },
      ], 18, {});
    };
    ring(-0.021, 0.0026);
    ring(0.0005, 0.0026);
    // the zigzag between the bands, wrapped round the sleeve
    {
      const ref = V(0, 0, 1);
      const zA = ref.clone().sub(ax.clone().multiplyScalar(ref.dot(ax))).normalize();
      const xA = new THREE.Vector3().crossVectors(ax, zA).normalize();
      const N = 36;
      const zig: THREE.Vector3[] = [];
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const o = i % 2 ? -0.0025 : -0.016;
        zig.push(a.clone().addScaledVector(ax, o).addScaledVector(xA, Math.cos(th) * 0.0461).addScaledVector(zA, Math.sin(th) * 0.0484));
      }
      const e0 = trimMb.count;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const n = xA.clone().multiplyScalar(Math.cos(th)).addScaledVector(zA, Math.sin(th));
        const tan = zig[Math.min(N, i + 1)].clone().sub(zig[Math.max(0, i - 1)]).normalize();
        const side = new THREE.Vector3().crossVectors(tan, n).normalize().multiplyScalar(0.0011);
        trimMb.vert(zig[i].clone().add(side), fs);
        trimMb.vert(zig[i].clone().sub(side), fs);
      }
      for (let i = 0; i < N; i++) {
        trimMb.quad(e0 + 2 * i, e0 + 2 * i + 2, e0 + 2 * i + 3, e0 + 2 * i + 1);
        trimMb.quad(e0 + 2 * i, e0 + 2 * i + 1, e0 + 2 * i + 3, e0 + 2 * i + 2);
      }
    }
  }
  {
    const tm = new THREE.SkinnedMesh(trimMb.build(), trimMat);
    tm.bind(rig.skeleton);
    tm.frustumCulled = false;
    group.add(tm);
  }

  /* pauldron on his left shoulder (ARISE): three curved plates on a shell round the shoulder joint, laid like roof tiles
     (each upper plate over the next), capping the shoulder and running down the outer upper arm; each lower edge
     breaks into hooked barbs that kick outward. Teal steel with pale edges. */
  {
    const S = V(0.165, 1.442, -0.016);
    const D = V(0.42, 1, 0).normalize(); // the cap's pole: up and a little out
    const X = V(1, -0.42, 0).normalize(); // outward and down the arm
    const Z = V(0, 0, 1);
    const plates: [number, number, number, number][] = [
      // phi start, phi end, radius, shoulder share of the skin
      [0.0, 0.88, 0.116, 0.45],
      [0.6, 1.36, 0.106, 0.25],
      [1.08, 1.84, 0.097, 0.12],
    ];
    plates.forEach(([p0, p1, R, sh], p) => {
      const rows = 7, cols = 19;
      const skin = blendSkin([[I('shL'), 1]], [[I('uaL'), 1]], 1 - sh);
      const A = 1.45 - 0.12 * p;
      const grid: THREE.Vector3[][] = [];
      const dirAt = (phi: number, a: number) => X.clone().multiplyScalar(Math.sin(phi) * Math.cos(a)).addScaledVector(D, Math.cos(phi)).addScaledVector(Z, Math.sin(phi) * Math.sin(a));
      for (let r = 0; r < rows; r++) {
        const v = r / (rows - 1);
        const row: THREE.Vector3[] = [];
        for (let c = 0; c < cols; c++) {
          const u = c / (cols - 1);
          const a = lerp(-A, A, u);
          // three hooked barbs on the lower edge, the one at the back longest; the tips kick outward
          const barb = Math.pow(Math.abs(Math.sin(u * Math.PI * 3 + 0.3)), 3) * (0.2 + 0.28 * u) * Math.pow(v, 2);
          const phi = lerp(p0, p1, v) + barb;
          const rr = R * (1 + 0.06 * Math.sin(v * Math.PI)) + barb * 0.11 + 0.004 * Math.cos(a * 2);
          row.push(S.clone().addScaledVector(dirAt(phi, a), rr));
        }
        grid.push(row);
      }
      shell(steelMb, grid, () => skin, () => 0, 0.0065);
      // the pale edge: a ribbon along the barbed lower edge and a thin line just inside it
      for (const [f, half] of [[0.0, 0.0024], [0.24, 0.0011]] as [number, number][]) {
        const pts: THREE.Vector3[] = [];
        for (let c = 0; c < cols; c++) pts.push(grid[rows - 1][c].clone().lerp(grid[rows - 2][c], f));
        ribbon(pts, (c) => pts[c].clone().sub(S).normalize(), half, skin, 0.0014);
      }
    });
  }
  /* belts, chain and straps (ARISE): the main black belt at the waist with a square cross buckle; a second belt slung
     low on a diagonal with its buckle cluster on his left hip, where a steel chain hangs in two loose loops to
     mid-thigh; the brown chest strap, and two brown straps round his left bicep under the pauldron */
  {
    const hipSkin: Skin = [[I('hips'), 1]];
    const box = (b: MeshBuilder, c: THREE.Vector3, sx: number, sy: number, sz: number, skin: Skin, rotY = 0) => {
      const e0 = b.count;
      for (const [x, y, z] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]])
        b.vert(V((x * sx) / 2, (y * sy) / 2, (z * sz) / 2).applyAxisAngle(V(0, 1, 0), rotY).add(c), skin);
      for (const [a, bb, cc, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) b.quad(e0 + a, e0 + bb, e0 + cc, e0 + d);
    };
    const mb = new MeshBuilder();
    loft(mb, [
      { c: V(0, 0.975, 0.001), rx: 0.146, rz: 0.104, skin: hipSkin },
      { c: V(0, 1.01, 0.002), rx: 0.141, rz: 0.1, skin: hipSkin },
    ], 40, {});
    // the slung belt: lower on his left, sagging a little at the front
    const slungY = (th: number) => 0.93 - 0.034 * Math.cos(th) - 0.012 * Math.pow(Math.max(0, Math.sin(th)), 2);
    loft(mb, [
      { c: V(0, 0.0, 0.004), rx: 0.172, rz: 0.11, skin: hipSkin, t: V(0, 1, 0), dyFn: slungY },
      { c: V(0, 0.022, 0.004), rx: 0.17, rz: 0.108, skin: hipSkin, t: V(0, 1, 0), dyFn: slungY },
    ], 40, {});
    addSkinned(mb.build(), mats.pants, 1.2);
    // main buckle: a square plate with a cyan cross
    const bc = V(0, 0.992, 0.107);
    box(steelMb, bc, 0.034, 0.03, 0.006, hipSkin);
    const zf = bc.z + 0.0035;
    ribbon([V(-0.012, bc.y + 0.01, zf), V(0.012, bc.y - 0.01, zf)], () => V(0, 0, 1), 0.0016, hipSkin, 0.0004);
    ribbon([V(-0.012, bc.y - 0.01, zf), V(0.012, bc.y + 0.01, zf)], () => V(0, 0, 1), 0.0016, hipSkin, 0.0006);
    // the slung belt's buckle cluster on his left hip, and the chain's ring under it
    const thB = 1.12;
    const bp = V(Math.cos(thB) * 0.176, slungY(thB) + 0.011, Math.sin(thB) * 0.113 + 0.004);
    box(steelMb, bp, 0.03, 0.026, 0.007, hipSkin, -0.45);
    box(steelMb, bp.clone().add(V(0.022, -0.004, -0.008)), 0.014, 0.018, 0.006, hipSkin, -0.65);
    ribbon([bp.clone().add(V(-0.01, 0.009, 0.0045)), bp.clone().add(V(0.01, -0.009, 0.0045))], () => V(0.43, 0, 0.9).normalize(), 0.0014, hipSkin, 0.0004);
    // the chain: two loose loops from the ring to mid-thigh and back up to the hip, a beaded tube (reads as links)
    const anchor = bp.clone().add(V(0.004, -0.02, 0.002));
    const chain = (ctrl: THREE.Vector3[]) => {
      const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
      const L = curve.getLength();
      const n = Math.max(8, Math.round(L / 0.0045));
      const pts = curve.getSpacedPoints(n);
      const rings: Ring[] = pts.map((c, i) => {
        const s = (i / n) * L;
        const bead = Math.abs(Math.sin((s / 0.0095) * Math.PI));
        const r = 0.0019 + 0.0016 * bead;
        const sk = blendSkin(hipSkin, [[I('tgL'), 1]], smoothstep(0.88, 0.7, c.y) * 0.7);
        return { c, rx: r, rz: r * (i % 2 ? 0.55 : 1), skin: sk };
      });
      loft(steelMb, rings, 5, { capStart: true, capEnd: true });
    };
    chain([anchor, V(0.088, 0.82, 0.112), V(0.102, 0.765, 0.114), V(0.122, 0.79, 0.108), V(0.142, 0.862, 0.088)]);
    chain([anchor, V(0.09, 0.78, 0.112), V(0.112, 0.7, 0.108), V(0.142, 0.735, 0.096), V(0.162, 0.858, 0.06)]);
    box(steelMb, anchor, 0.008, 0.008, 0.008, hipSkin, 0.3);

    const sb = new MeshBuilder();
    // diagonal strap from the left shoulder across the upper arm/chest
    const pts = smoothPath([V(0.12, 1.47, 0.06), V(0.155, 1.4, 0.09), V(0.19, 1.33, 0.07), V(0.215, 1.29, 0.0)], 10);
    loft(sb, pts.map((c) => ({ c, rx: 0.013, rz: 0.004, skin: [[I('chest'), 0.5], [I('shL'), 0.5]] as Skin, ref: V(0, 0, 1) })), 6, { capStart: true, capEnd: true });
    // two straps round the left bicep, just under the pauldron's lowest plate
    const ua = rig.b('uaL').getWorldPosition(new THREE.Vector3());
    const fa = rig.b('faL').getWorldPosition(new THREE.Vector3());
    const ax = fa.clone().sub(ua).normalize();
    for (const f of [0.5, 0.64]) {
      const c = ua.clone().lerp(fa, f);
      const r = lerp(0.059, 0.054, (f - 0.4) / 0.3) + 0.003;
      loft(sb, [
        { c, rx: r, rz: r * 1.05, skin: [[I('uaL'), 1]], t: ax },
        { c: c.clone().addScaledVector(ax, -0.016), rx: r, rz: r * 1.05, skin: [[I('uaL'), 1]], t: ax },
      ], 16, {});
      box(steelMb, c.clone().addScaledVector(ax, -0.008).add(V(0.0, 0, r * 1.05)), 0.012, 0.016, 0.004, [[I('uaL'), 1]]);
    }
    addSkinned(sb.build(), mats.leather, 1.0);
  }
  addSkinned(steelMb.build(), mats.steel, 1.2);
  {
    const im = new THREE.SkinnedMesh(inlayMb.build(), mats.inlay);
    im.bind(rig.skeleton);
    im.frustumCulled = false;
    group.add(im);
  }

  /* hands: palm with thenar pad, four tapered three-joint fingers with knuckles, an opposable thumb */
  for (const s of ['L', 'R'] as const) {
    const k = s === 'L' ? 1 : -1;
    const mb = new MeshBuilder();
    const wr = HAND_WR(k), kn = HAND_KN(k), axis = handAxis(k);
    const hand = I('ha' + s), knuck = I('fi' + s);
    // ring-local x runs along world -x when the ring tangent points down, so the palm side is where k * cos(th) > 0
    const palmSide = (th: number) => Math.max(0, k * Math.cos(th));
    const backSide = (th: number) => Math.max(0, -k * Math.cos(th));
    const palmRings: Ring[] = [];
    const PR = 9;
    for (let i = 0; i <= PR; i++) {
      const t = i / PR;
      const c = wr.clone().addScaledVector(axis, lerp(-0.012, 0.09, t)).add(V(0, 0, 0.0015 * t));
      const rz = lerp(0.0215, 0.0315, smoothstep(0.0, 0.62, t)) * (t > 0.86 ? lerp(1, 0.9, (t - 0.86) / 0.14) : 1);
      const rx = lerp(0.0156, 0.0118, smoothstep(0.1, 0.9, t)) * (t > 0.86 ? lerp(1, 0.8, (t - 0.86) / 0.14) : 1);
      const thenar = Math.exp(-Math.pow((t - 0.32) / 0.22, 2));
      const hypo = Math.exp(-Math.pow((t - 0.45) / 0.3, 2));
      palmRings.push({
        c,
        rx,
        rz,
        ref: V(0, 0, 1),
        skin: blendSkin([[hand, 1]], [[knuck, 1]], smoothstep(0.7, 0.98, t)),
        shape: (th) => 1 - 0.18 * backSide(th) * Math.abs(Math.sin(th)),
        bend: (th) => {
          const sn = Math.sin(th);
          const pad = palmSide(th) * (0.0062 * thenar * Math.max(0, sn) + 0.0028 * hypo * Math.max(0, -sn));
          return [Math.sign(Math.cos(th)) * pad, 0.0022 * thenar * Math.max(0, sn) * palmSide(th)];
        },
      });
    }
    loft(mb, palmRings, 18, { capStart: true, capEnd: true });

    // a finger: rings from inside the palm through the three joints to a rounded tip
    const chain = (pts: THREE.Vector3[], bones: number[], radii: number[], half: number[], start: number, ringsPer = 4, knuckleBump = 0.1) => {
      const lens = [pts[1].distanceTo(pts[0]), pts[2].distanceTo(pts[1]), pts[3].distanceTo(pts[2])];
      const J = [0, lens[0], lens[0] + lens[1]];
      const total = J[2] + lens[2];
      const dir0 = pts[1].clone().sub(pts[0]).normalize();
      const at = (d: number) => {
        if (d <= 0) return pts[0].clone().addScaledVector(dir0, d);
        let seg = 0;
        while (seg < 2 && d > J[seg] + lens[seg]) seg++;
        return pts[seg].clone().lerp(pts[seg + 1], (d - J[seg]) / lens[seg]);
      };
      const radAt = (d: number) => {
        const u = clamp(d / total);
        return lerp(radii[0], radii[1], smoothstep(0, 1, u));
      };
      const skinAt = (d: number): Skin => {
        let sk: Skin = blendSkin([[hand, 1]], [[bones[0], 1]], smoothstep(start * 0.9, start * 0.2, d));
        for (let j = 0; j < 3; j++) sk = blendSkin(sk, [[bones[j + 1], 1]], smoothstep(J[j] - half[j], J[j] + half[j], d));
        return sk;
      };
      const ds: number[] = [start, start * 0.5];
      for (let j = 0; j < 3; j++) for (let q = 0; q < ringsPer; q++) ds.push(J[j] + (lens[j] * q) / ringsPer);
      const tipBase = total - 0.0045;
      while (ds[ds.length - 1] > tipBase - 0.002) ds.pop();
      ds.push(tipBase, total - 0.0022, total - 0.0008);
      const tipK = [1, 0.8, 0.5];
      const rings: Ring[] = ds.map((d, i) => {
        const r = radAt(Math.min(d, tipBase));
        const tk = d > tipBase - 1e-4 ? tipK[i - (ds.length - 3)] : 1;
        const bump = Math.max(...J.slice(1).map((j) => Math.exp(-Math.pow((d - j) / 0.0042, 2)))) * knuckleBump;
        const mcpBump = Math.exp(-Math.pow((d - 0.001) / 0.006, 2)) * 0.14;
        const pad = d > J[2] ? 0.08 * Math.sin(clamp((d - J[2]) / lens[2]) * Math.PI) : 0;
        return {
          c: at(d),
          rx: r * 0.86 * tk,
          rz: r * tk,
          ref: V(0, 0, 1),
          skin: skinAt(d),
          shape: (th: number) => 1 + (bump + mcpBump) * backSide(th) + pad * palmSide(th) - 0.06 * palmSide(th) * (1 - pad),
        };
      });
      loft(mb, rings, 10, { capStart: true, capEnd: true });
    };
    FINGERS.forEach((F, f) => {
      const j = fingerJoints(k, f);
      chain(j, [knuck, I(`f${f}a${s}`), I(`f${f}b${s}`), I(`f${f}c${s}`)], [F.r, F.r * 0.74], [0.0045, 0.0032, 0.0028], -0.008, 4, 0.09);
    });
    chain(thumbJoints(k), [hand, I('th' + s), I('t2' + s), I('t3' + s)], [THUMB.r[0], THUMB.r[3]], [0.008, 0.0045, 0.0035], -0.026, 4, 0.06);
    addSkinned(mb.build(), mats.hand, 1.05);
  }

  /* trousers */
  {
    const mb = new MeshBuilder();
    // seat: ends just under the hip, inside the thighs, so its lower edge never reads as a separate garment
    loft(mb, [
      { c: V(0, 1.0, 0.0), rx: 0.138, rz: 0.097, skin: [[I('hips'), 1]] },
      { c: V(0, 0.96, 0.001), rx: 0.135, rz: 0.093, skin: [[I('hips'), 1]] },
      { c: V(0, 0.925, 0.002), rx: 0.11, rz: 0.076, skin: [[I('hips'), 1]] },
      { c: V(0, 0.885, 0.002), rx: 0.058, rz: 0.056, skin: [[I('hips'), 1]] },
    ], 28, { capEnd: true });
    for (const s of ['L', 'R'] as const) {
      const k = s === 'L' ? 1 : -1;
      const hip = rig.b('tg' + s).getWorldPosition(new THREE.Vector3());
      const knee = rig.b('sn' + s).getWorldPosition(new THREE.Vector3());
      const ank = rig.b('ft' + s).getWorldPosition(new THREE.Vector3());
      const pts = smoothPath([hip.clone().add(V(-0.012 * k, 0.06, 0)), hip, knee, ank.clone().add(V(0, 0.035, 0))], 20);
      const rings: Ring[] = pts.map((c, i) => {
        const t = i / (pts.length - 1);
        // slim, tapered black trousers (ARISE): long thin legs, the hems bunching a little at the ankle
        const r = t < 0.45 ? lerp(0.074, 0.05, Math.pow(t / 0.45, 0.8)) : t < 0.6 ? lerp(0.05, 0.047, (t - 0.45) / 0.15) : lerp(0.047, 0.039, (t - 0.6) / 0.4) + (t > 0.93 ? 0.004 : 0);
        let skin: Skin;
        if (t < 0.1) skin = blendSkin([[I('hips'), 1]], [[I('tg' + s), 1]], t / 0.1);
        else if (t < 0.42) skin = [[I('tg' + s), 1]];
        else if (t < 0.56) skin = blendSkin([[I('tg' + s), 1]], [[I('sn' + s), 1]], smoothstep(0.42, 0.56, t));
        else skin = [[I('sn' + s), 1]];
        return { c, rx: r, rz: r * 1.05, skin, ref: V(0, 0, 1) };
      });
      loft(mb, rings, 18, { capStart: true, capEnd: true });
    }
    addSkinned(mb.build(), mats.pants, 1.4);
  }

  /* shoes: slim black derbies */
  {
    const mb = new MeshBuilder();
    for (const s of ['L', 'R'] as const) {
      const ank = rig.b('ft' + s).getWorldPosition(new THREE.Vector3());
      const ft = I('ft' + s), to = I('to' + s);
      const F: [number, number, number, number][] = [
        [-0.07, 0.03, 0.03, 0.045],
        [-0.05, 0.039, 0.05, 0.055],
        [-0.015, 0.042, 0.055, 0.058],
        [0.03, 0.043, 0.04, 0.045],
        [0.08, 0.044, 0.03, 0.033],
        [0.13, 0.04, 0.024, 0.026],
        [0.168, 0.03, 0.018, 0.02],
        [0.188, 0.014, 0.01, 0.015],
      ];
      const rings: Ring[] = F.map(([z, hw, hh, cy]) => ({
        c: V(ank.x, cy, ank.z + z),
        t: V(0, 0, 1),
        ref: V(0, 1, 0),
        rx: hw,
        rz: hh,
        skin: z < 0.05 ? [[ft, 1]] : blendSkin([[ft, 1]], [[to, 1]], smoothstep(0.05, 0.12, z)),
        shape: (th: number) => (Math.sin(th) < 0 ? 0.9 : 1),
      }));
      loft(mb, rings, 16, { capStart: true, capEnd: true });
    }
    addSkinned(mb.build(), mats.shoes, 1.3);
  }

  const allToon = Object.values(mats);
  const setDissolve = (v: number) => {
    for (const m of allToon) m.uniforms.uDissolve.value = v;
    for (const o of outlines) o.uniforms.uDissolve.value = v;
  };
  const setClipY = (y: number) => {
    for (const m of allToon) m.uniforms.uClipY.value = y;
    for (const o of outlines) o.uniforms.uClipY.value = y;
  };
  const setOutlinePx = (px: number) => {
    for (const o of outlines) o.uniforms.uOutlinePx.value = px;
  };

  rig.apply(POSES.idle, null, 0);
  const setSmirk = (v: number | null) => {
    smirkOverride = v;
  };
  return { group, rig, materials: mats, outlines, emissive, eyes, setDissolve, setClipY, setOutlinePx, setSmirk };
}

/* ------------------------------------------------------------------------------------------ poses */

export const POSES: Record<string, Pose> = {
  rest: {},
  pocket: {
    hips: [0, 0.07, 0.04],
    spine: [0.02, -0.03, -0.03],
    chest: [0.03, -0.05, -0.02],
    neck: [0.06, 0.02, 0.02],
    head: [0.13, 0.09, 0.02],
    shL: [0, 0, -0.05],
    shR: [0, 0.05, 0.05],
    uaL: [0.06, 0.12, 0.09],
    uaR: [0.32, -0.25, -0.22],
    faL: [-0.24, 0, 0.0],
    faR: [-0.95, 0.15, 0.08],
    haL: [0.05, -0.28, 0.06],
    haR: [-0.1, 0.55, -0.35],
    fiL: [0, 0, -0.5],
    fiR: [0, 0, 1.1],
    thL: [0, 0, -0.15],
    thR: [0, 0, 0.4],
    tgL: [-0.07, 0.06, 0.04],
    tgR: [0.02, 0, -0.04],
    snL: [0.13, 0, -0.02],
    snR: [0.02, 0, 0.0],
    ftL: [-0.06, 0.32, -0.03],
    ftR: [-0.02, -0.14, 0.02],
  },
  // calm stand: weight on his right leg, arms loose, head lowered
  idle: {
    hips: [0, 0.05, 0.03],
    spine: [0.025, -0.03, -0.02],
    chest: [0.03, -0.04, -0.012],
    neck: [0.07, 0.03, 0.02],
    head: [0.12, 0.08, 0.02],
    shL: [0, 0, -0.06],
    shR: [0, 0, 0.02],
    uaL: [0.08, 0.12, 0.1],
    uaR: [-0.04, -0.12, -0.05],
    faL: [-0.2, 0, 0.0],
    faR: [-0.42, 0, 0.0],
    haL: [0.05, -0.45, 0.06],
    haR: [0.05, 0.32, -0.1],
    fiL: [0, 0, -0.22],
    fiR: [0, 0, 0.28],
    thL: [0, 0, -0.15],
    thR: [0, 0, 0.15],
    tgL: [-0.06, 0.05, 0.06],
    tgR: [0.02, 0, -0.03],
    snL: [0.12, 0, -0.03],
    snR: [0.02, 0, 0.0],
    ftL: [-0.06, 0.3, -0.02],
    ftR: [-0.02, -0.14, 0.02],
  },
  // ARISE: right arm forward and down ~30 deg below horizontal, palm up, fingers relaxed open; head down toward it
  arise: {
    hips: [0, -0.1, 0],
    spine: [0.03, -0.08, 0],
    chest: [0.02, -0.14, 0.02],
    neck: [0.08, 0.08, 0],
    head: [0.22, 0.06, 0],
    shL: [0, 0, -0.05],
    shR: [0, 0.12, 0.08],
    uaL: [0.08, 0.12, 0.08],
    uaR: [-1.12, 0.1, -0.1],
    faL: [-0.26, 0, 0.0],
    faR: [-0.14, 0, 0.0],
    haL: [0.05, -0.28, 0.06],
    haR: [0.0, -1.5, -0.12],
    fiL: [0, 0, -0.5],
    fiR: [0, 0, 0.42],
    thL: [0, 0, -0.15],
    thR: [0, 0, -0.25],
    tgL: [0.08, 0, 0.07],
    tgR: [-0.1, 0, -0.05],
    snL: [0.12, 0, -0.04],
    snR: [0.04, 0, 0.03],
    ftL: [-0.06, 0.24, 0],
    ftR: [-0.02, -0.2, 0],
  },
  // the same gesture escalated: palm-up hand lifted to shoulder height as the army rises
  ariseHigh: {
    hips: [0, -0.1, 0],
    spine: [0.0, -0.08, 0],
    chest: [-0.04, -0.14, 0.02],
    neck: [0.0, 0.08, 0],
    head: [0.04, 0.06, 0],
    shL: [0, 0, -0.05],
    shR: [0, 0.12, 0.14],
    uaL: [0.08, 0.12, 0.08],
    uaR: [-1.55, 0.1, -0.18],
    faL: [-0.26, 0, 0.0],
    faR: [-0.3, 0, 0.0],
    haL: [0.05, -0.28, 0.06],
    haR: [0.15, -1.5, -0.1],
    fiL: [0, 0, -0.5],
    fiR: [0, 0, 0.55],
    thL: [0, 0, -0.15],
    thR: [0, 0, -0.25],
    tgL: [0.08, 0, 0.07],
    tgR: [-0.1, 0, -0.05],
    snL: [0.12, 0, -0.04],
    snR: [0.04, 0, 0.03],
    ftL: [-0.06, 0.24, 0],
    ftR: [-0.02, -0.2, 0],
  },
};

/**
 * Finger shapes for one hand. curl: per finger (index..pinky) total bend in radians, spread over the three joints
 * (knuckle 42 %, middle 85 %, end 50 %). fan: spreads the fingers apart. thumb: [knuckle, tip] bend toward the palm.
 */
export function handPose(s: 'L' | 'R', o: { curl: [number, number, number, number]; fan?: number; thumb?: [number, number] }): Pose {
  const k = s === 'L' ? 1 : -1;
  const p: Pose = {};
  const fanW = [-1, -0.25, 0.4, 1.1];
  o.curl.forEach((c, f) => {
    p[`f${f}a${s}`] = [(o.fan ?? 0) * fanW[f] * 0.13, 0, -k * c * 0.42];
    p[`f${f}b${s}`] = [0, 0, -k * c * 0.85];
    p[`f${f}c${s}`] = [0, 0, -k * c * 0.5];
  });
  const [t2, t3] = o.thumb ?? [0.15, 0.2];
  p['t2' + s] = [t2 * 0.5, 0, -k * t2 * 0.7];
  p['t3' + s] = [t3 * 0.4, 0, -k * t3 * 0.8];
  return p;
}

// relaxed hanging hands: loosely curled, index least and pinky most, thumb resting by the index (not claws)
const HANG = { curl: [0.34, 0.47, 0.58, 0.7] as [number, number, number, number], fan: 0.12, thumb: [0.3, 0.42] as [number, number] };
// the hand pushed into the trouser pocket: a loose fist that fits inside the pocket
const IN_POCKET = { curl: [1.05, 1.15, 1.2, 1.25] as [number, number, number, number], fan: 0, thumb: [0.5, 0.6] as [number, number] };
/*
 * The fun of the anime's Jin-woo is the calm: his left hand stays in his trouser pocket under the open coat through the
 * whole sequence, the ARISE included (one hand commands the army, the other never leaves the pocket). Arm angles solved
 * so the wrist sits at the pocket opening on his left hip in each pose's own torso twist.
 */
const POCKET_ARM: Record<'idle' | 'arise' | 'ariseHigh', Pose> = {
  idle: { shL: [0.025, 0.1, -0.075], uaL: [0.106, -0.259, 0.159], faL: [-0.725, -0.48, -0.348], haL: [0.393, -0.043, -0.313] },
  arise: { shL: [0.025, 0.1, -0.075], uaL: [0.117, -0.096, 0.092], faL: [-0.545, -0.052, -0.361], haL: [0.414, -0.016, -0.1] },
  ariseHigh: { shL: [0.025, 0.1, -0.075], uaL: [0.189, -0.263, 0.094], faL: [-0.674, -0.589, -0.254], haL: [0.292, 0.011, -0.371] },
};
Object.assign(POSES.idle, POCKET_ARM.idle, handPose('L', IN_POCKET), handPose('R', HANG), { fiL: [0, 0, -0.2], fiR: [0, 0, 0.12] });
Object.assign(POSES.pocket, handPose('L', HANG), handPose('R', { curl: [0.9, 1.0, 1.05, 1.1], thumb: [0.3, 0.4] }));
// ARISE: palm up, open and relaxed, fingers fanned with a gentle cascade of curl (offering, not clawing)
Object.assign(POSES.arise, POCKET_ARM.arise, handPose('L', IN_POCKET), handPose('R', { curl: [0.3, 0.45, 0.6, 0.76], fan: 0.8, thumb: [0.05, 0.2] }), { fiL: [0, 0, -0.2], fiR: [0, 0, 0.16] });
Object.assign(POSES.ariseHigh, POCKET_ARM.ariseHigh, handPose('L', IN_POCKET), handPose('R', { curl: [0.24, 0.38, 0.52, 0.68], fan: 0.95, thumb: [0.0, 0.15] }), { fiL: [0, 0, -0.2], fiR: [0, 0, 0.2] });
