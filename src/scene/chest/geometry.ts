import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MeshBuilder, shell } from '../character/geo';

/** Chest dimensions (metres). Base sits on y = 0, front faces +z. */
export const DIM = {
  W: 1.0,
  D: 0.62,
  footH: 0.05,
  plinthY: [0.05, 0.12] as [number, number],
  bodyY: [0.12, 0.5] as [number, number],
  rimY: [0.495, 0.54] as [number, number],
  seamY: [0.54, 0.548] as [number, number],
  lidY: 0.548,
  lipH: 0.04,
  domeH: 0.21,
  band: 0.03,
};
export const LID_W = DIM.W + DIM.band;
export const LID_D = DIM.D + DIM.band;
export const HINGE = new THREE.Vector3(0, DIM.lidY, -LID_D / 2);

/** Keep only position + normal, non-indexed, so everything merges. */
export function prep(g: THREE.BufferGeometry) {
  let out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

export function merge(list: THREE.BufferGeometry[]) {
  const g = mergeGeometries(list.map(prep), false);
  if (!g) throw new Error('merge failed');
  g.computeBoundingSphere();
  return g;
}

/** Smooth-normal copy for the inverted-hull ink outline. */
export function outlineGeometry(g: THREE.BufferGeometry) {
  const c = new THREE.BufferGeometry();
  c.setAttribute('position', g.attributes.position.clone());
  const m = mergeVertices(c, 1e-4);
  m.computeVertexNormals();
  const n = m.attributes.position.count;
  m.setAttribute('aFlutter', new THREE.BufferAttribute(new Float32Array(n), 1));
  m.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n), 1));
  return m;
}

export function rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, seg = 2) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  g.translate(x, y, z);
  return g;
}

/** A rectangular frame (four rounded bars) around the footprint w x d, from y0 to y1, bar thickness t. */
export function frame(w: number, d: number, y0: number, y1: number, t: number, r = 0.006) {
  const h = y1 - y0, yc = (y0 + y1) / 2;
  return [
    rbox(w, h, t, r, 0, yc, d / 2 - t / 2),
    rbox(w, h, t, r, 0, yc, -d / 2 + t / 2),
    rbox(t, h, d - 2 * t + 0.002, r, w / 2 - t / 2, yc, 0),
    rbox(t, h, d - 2 * t + 0.002, r, -w / 2 + t / 2, yc, 0),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// 2D paths for the filigree. Dense polylines, then mapped onto a surface and swept into wire.

export class Path2 {
  pts: THREE.Vector2[] = [];
  constructor(readonly step = 0.0035) {}
  get last() {
    return this.pts[this.pts.length - 1];
  }
  move(x: number, y: number) {
    this.pts.push(new THREE.Vector2(x, y));
    return this;
  }
  line(x: number, y: number) {
    const a = this.last;
    const b = new THREE.Vector2(x, y);
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / this.step));
    for (let i = 1; i <= n; i++) this.pts.push(a.clone().lerp(b, i / n));
    return this;
  }
  /** Arc / spiral around (cx, cy) from angle a0 to a1 (radians, CCW positive), radius r0 to r1. */
  spiral(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, skipFirst = true) {
    const len = Math.abs(a1 - a0) * (r0 + r1) * 0.5;
    const n = Math.max(4, Math.ceil(len / this.step));
    for (let i = skipFirst && this.pts.length ? 1 : 0; i <= n; i++) {
      const t = i / n;
      const a = a0 + (a1 - a0) * t;
      const r = r0 + (r1 - r0) * t;
      this.pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    return this;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number) {
    return this.spiral(cx, cy, r, r, a0, a1);
  }
  mirrored() {
    const p = new Path2(this.step);
    p.pts = this.pts.map((v) => new THREE.Vector2(-v.x, v.y));
    return p;
  }
}

export type SurfaceMap = (x: number, y: number, h: number) => THREE.Vector3;

/**
 * Sweep a wire along a 2D path mapped onto a surface. Cross-section is an ellipse squashed against the surface
 * (raised relief), radius tapers by `r(u)`. Ends get a small bead (granule), like real filigree.
 */
export function wire(path: Path2, map: SurfaceMap, r: (u: number) => number, opts: { seg?: number; squash?: number; beads?: boolean } = {}) {
  const seg = opts.seg ?? 6;
  const squash = opts.squash ?? 0.75;
  const pts2 = path.pts;
  const n = pts2.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const P: THREE.Vector3[] = [];
  const S: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts2[i];
    P.push(map(p.x, p.y, 0));
    S.push(map(p.x, p.y, 0.01).sub(map(p.x, p.y, 0)).normalize());
  }
  // arc-length param
  const L: number[] = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + P[i].distanceTo(P[i - 1]));
  const total = L[n - 1] || 1;
  const T = new THREE.Vector3(), B = new THREE.Vector3(), Nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    T.copy(P[Math.min(n - 1, i + 1)]).sub(P[Math.max(0, i - 1)]).normalize();
    B.crossVectors(T, S[i]).normalize();
    Nn.crossVectors(B, T).normalize();
    const rad = r(L[i] / total);
    const c = P[i].clone().addScaledVector(Nn, rad * squash * 0.3);
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const v = c.clone().addScaledVector(B, ca * rad).addScaledVector(Nn, sa * rad * squash);
      pos.push(v.x, v.y, v.z);
      const nn = B.clone().multiplyScalar(ca / 1).addScaledVector(Nn, sa / squash).normalize();
      nor.push(nn.x, nn.y, nn.z);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let s = 0; s < seg; s++) {
      const a = i * seg + s, b = i * seg + ((s + 1) % seg), c = (i + 1) * seg + ((s + 1) % seg), d = (i + 1) * seg + s;
      idx.push(a, d, c, a, c, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  const parts: THREE.BufferGeometry[] = [g];
  if (opts.beads !== false) {
    for (const [i, u] of [[0, 0], [n - 1, 1]] as const) {
      const rr = Math.max(r(u) * 1.35, 0.0035);
      const s = new THREE.SphereGeometry(rr, 8, 6);
      s.scale(1, 1, 1);
      const c = P[i].clone().addScaledVector(S[i], rr * 0.25);
      s.translate(c.x, c.y, c.z);
      parts.push(s);
    }
  }
  return parts;
}

/** Taper profiles. */
export const taper = {
  even: (r: number) => () => r,
  /** thin at the start (spiral eye), full along the body, slight thin at the end */
  curl: (r: number, r0 = 0.45) => (u: number) => r * (r0 + (1 - r0) * Math.min(1, u * 5)) * (1 - 0.25 * Math.max(0, (u - 0.85) / 0.15)),
  both: (r: number, r0 = 0.45) => (u: number) => r * (r0 + (1 - r0) * Math.min(1, u * 5, (1 - u) * 5)),
};

export const frontMap = (z0: number): SurfaceMap => (x, y, h) => new THREE.Vector3(x, y, z0 + h);
export const sideMap = (x0: number, sign: number): SurfaceMap => (u, y, h) => new THREE.Vector3(sign * (x0 + h), y, -sign * u);

// ---------------------------------------------------------------------------------------------------------------
// Lid: a flattened barrel dome over a vertical lip. Profile in (z, y) relative to the lid base.

export function lidProfile(z: number) {
  const hz = LID_D / 2;
  const t = Math.min(1, Math.abs(z) / hz);
  return DIM.lipH + DIM.domeH * Math.pow(1 - Math.pow(t, 2.3), 1 / 2.3);
}

/** Arc-length table along the dome from the front lip (s = 0) to the back lip. */
const lidTable = (() => {
  const N = 400;
  const hz = LID_D / 2;
  const zs: number[] = [], ss: number[] = [0];
  for (let i = 0; i <= N; i++) zs.push(hz - (2 * hz * i) / N);
  for (let i = 1; i <= N; i++) {
    const dz = zs[i] - zs[i - 1];
    const dy = lidProfile(zs[i]) - lidProfile(zs[i - 1]);
    ss.push(ss[i - 1] + Math.hypot(dz, dy));
  }
  return { zs, ss, total: ss[N] };
})();

export const LID_ARC = lidTable.total;

/** Point on the dome surface at arc length s (from the front lip), lateral x, normal offset h (lid-local, base at y=0). */
export function lidPoint(x: number, s: number, h: number) {
  const { zs, ss } = lidTable;
  let lo = 0, hi = ss.length - 1;
  s = Math.max(0, Math.min(ss[hi], s));
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ss[m] < s) lo = m;
    else hi = m;
  }
  const t = (s - ss[lo]) / Math.max(1e-9, ss[hi] - ss[lo]);
  const z = zs[lo] + (zs[hi] - zs[lo]) * t;
  const y = lidProfile(z);
  const e = 0.0005;
  // tangent runs front to back (-z); the outward normal is that tangent turned clockwise in (z, y)
  const tz = -2 * e, ty = lidProfile(z - e) - lidProfile(z + e);
  const l = Math.hypot(tz, ty);
  const nz = ty / l, ny = -tz / l;
  return new THREE.Vector3(x, y + ny * h, z + nz * h);
}

/** The dome (with lip) as an extruded shape, lid-local (base y = 0, centred). */
export function lidShell(inset = 0, bevel = 0.012) {
  const hz = LID_D / 2 - inset - bevel;
  const shape = new THREE.Shape();
  const N = 48;
  shape.moveTo(-hz, 0);
  for (let i = 0; i <= N; i++) {
    const z = hz - (2 * hz * i) / N;
    const y = lidProfile(z * (LID_D / 2) / hz) - inset - 2 * bevel;
    // shape x = -z so the rotation below maps back to +z front
    shape.lineTo(-z, Math.max(0.001, y));
  }
  shape.lineTo(hz, 0);
  shape.lineTo(-hz, 0);
  const depth = LID_W - 2 * inset - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 1 });
  g.rotateY(Math.PI / 2);
  g.translate(-depth / 2, bevel, 0);
  return g;
}

/** A band hugging the dome (annular arc) of width w centred at x, standing proud by `t`. */
export function lidBand(x: number, w: number, t: number, bevel = 0.004) {
  const hz = LID_D / 2;
  const shape = new THREE.Shape();
  const N = 56;
  const outer: THREE.Vector2[] = [];
  const inner: THREE.Vector2[] = [];
  for (let i = 0; i <= N; i++) {
    const s = (LID_ARC * i) / N;
    const po = lidPoint(0, s, t - bevel);
    const pi = lidPoint(0, s, -0.006);
    outer.push(new THREE.Vector2(-po.z, po.y));
    inner.push(new THREE.Vector2(-pi.z, pi.y));
  }
  // down to the base along the lip
  shape.moveTo(-(hz + t - bevel), 0.0);
  for (const p of outer) shape.lineTo(p.x, p.y);
  shape.lineTo(hz + t - bevel, 0.0);
  shape.lineTo(hz - 0.006, 0.0);
  for (let i = inner.length - 1; i >= 0; i--) shape.lineTo(inner[i].x, inner[i].y);
  shape.lineTo(-(hz + t - bevel), 0.0);
  const depth = w - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 });
  g.rotateY(Math.PI / 2);
  g.translate(x - depth / 2, bevel, 0);
  return g;
}

/** Rhombus outline path (for the emblem frames). */
export function rhombus(cx: number, cy: number, hw: number, hh: number, step = 0.003) {
  const p = new Path2(step);
  p.move(cx, cy + hh).line(cx + hw, cy).line(cx, cy - hh).line(cx - hw, cy).line(cx, cy + hh);
  return p;
}

/** Flat rhombus plate extruded toward +z, with bevel. */
export function rhombusPlate(cx: number, cy: number, hw: number, hh: number, z0: number, depth: number, bevel: number) {
  const s = new THREE.Shape();
  s.moveTo(0, hh).lineTo(hw, 0).lineTo(0, -hh).lineTo(-hw, 0).lineTo(0, hh);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 });
  g.translate(cx, cy, z0);
  return g;
}

/** Vesica (lens) slit, flat, facing +z. */
export function slitGeometry(cx: number, cy: number, hw: number, hh: number, z: number) {
  const s = new THREE.Shape();
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = -hh + 2 * hh * t;
    const x = hw * Math.pow(Math.sin(Math.PI * t), 0.85);
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  for (let i = N - 1; i > 0; i--) {
    const t = i / N;
    const y = -hh + 2 * hh * t;
    s.lineTo(-hw * Math.pow(Math.sin(Math.PI * t), 0.85), y);
  }
  const g = new THREE.ShapeGeometry(s);
  g.translate(cx, cy, z);
  return g;
}

/**
 * Auspicious-cloud head: two horns curling in toward each other, joined across the base.
 * Centre (cx, cy), horn radius R, horn centres at cx -/+ s.
 */
export function cloudHead(cx: number, cy: number, R: number, s: number, turns = 1.15, eye = 0.0055) {
  const p = new Path2();
  p.spiral(cx - s, cy, eye, R, -Math.PI / 2 - Math.PI * 2 * turns, -Math.PI / 2, false);
  p.line(cx + s, cy - R);
  p.spiral(cx + s, cy, R, eye, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * turns);
  return p;
}

/** A wisp tail: a line from x0 to x1 at y, ending in a hook that curls up (dir 1) or down (dir -1). */
export function tail(x0: number, y: number, x1: number, r: number, dir: 1 | -1, turns = 1.05) {
  const p = new Path2().move(x0, y).line(x1, y);
  if (dir > 0) p.spiral(x1, y + r, r, 0.0045, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * turns);
  else p.spiral(x1, y - r, r, 0.0045, Math.PI / 2, Math.PI / 2 - Math.PI * 2 * turns);
  return p;
}

/**
 * Hollow barrel lid (lid-local, base y = 0): outer dome + vertical lip, an inner concave surface `t` thick,
 * closed by rims. Built with the shared shell() sweep so the open lid shows a lit concave inside.
 */
export function hollowLid(t = 0.022, inset = 0.012) {
  const hz = LID_D / 2 - inset;
  const hx = LID_W / 2 - inset;
  const prof: [number, number][] = [];
  const N = 56;
  prof.push([hz, 0]);
  for (let i = 0; i <= N; i++) {
    const z = hz - (2 * hz * i) / N;
    prof.push([z, lidProfile(z * (LID_D / 2) / hz) - inset * 0.5]);
  }
  prof.push([-hz, 0]);
  const cols = [-hx, -hx + 0.02, 0, hx - 0.02, hx];
  const grid = prof.map(([z, y]) => cols.map((x) => new THREE.Vector3(x, y, z)));
  const mb = new MeshBuilder();
  shell(mb, grid, () => [[0, 1]], () => 0, t);
  return mb.build();
}

/** Point on the concave inner surface of the hollow lid at (x, arc s), raised by h toward the cavity. */
export function lidInnerPoint(x: number, s: number, h: number, t = 0.022) {
  return lidPoint(x, s, -0.006 - t - h);
}
