import * as THREE from 'three';
import type { Ring, Skin } from '../character/geo';
import { normSkin } from '../character/geo';
import { clamp } from '../../core/math';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Emissive geometry (seams, eyes) for the shadow soldiers. Same skinning layout as MeshBuilder, plus a kind
 * (0 seam, 1 eye, 2 blade edge) and an arc-length coordinate u (metres along the seam) for the travelling glint.
 */
export class GlowBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  skinI: number[] = [];
  skinW: number[] = [];
  kind: number[] = [];
  u: number[] = [];
  idx: number[] = [];

  get count() {
    return this.pos.length / 3;
  }

  vert(p: THREE.Vector3, n: THREE.Vector3, skin: Skin, kind: number, u: number) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    const s = normSkin(skin);
    for (let i = 0; i < 4; i++) {
      this.skinI.push(s[i]?.[0] ?? 0);
      this.skinW.push(s[i]?.[1] ?? 0);
    }
    this.kind.push(kind);
    this.u.push(u);
    return this.count - 1;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinW, 4));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(this.u, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Thin glowing tube along a polyline. Tapers to points at both ends so seams read as drawn strokes. */
export function tube(
  gb: GlowBuilder,
  pts: THREE.Vector3[],
  o: { r: number; skin: (i: number, p: THREE.Vector3) => Skin; kind?: number; seg?: number; taper?: number; u0?: number; closed?: boolean },
) {
  const n = pts.length;
  if (n < 2) return;
  const seg = o.seg ?? 4;
  const kind = o.kind ?? 0;
  const taper = o.taper ?? 0.03;
  const lens: number[] = [0];
  for (let i = 1; i < n; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const L = lens[n - 1];
  const tans = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = b.clone().sub(a);
    return t.lengthSq() > 1e-12 ? t.normalize() : V(0, 1, 0);
  });
  let nrm = Math.abs(tans[0].y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  nrm.sub(tans[0].clone().multiplyScalar(nrm.dot(tans[0]))).normalize();
  const base = gb.count;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const q = new THREE.Quaternion().setFromUnitVectors(tans[i - 1], tans[i]);
      nrm.applyQuaternion(q);
      nrm.sub(tans[i].clone().multiplyScalar(nrm.dot(tans[i]))).normalize();
    }
    const bin = new THREE.Vector3().crossVectors(tans[i], nrm).normalize();
    const e = o.closed ? 1 : Math.min(lens[i], L - lens[i]);
    const tp = o.closed ? 1 : Math.pow(clamp(e / taper), 0.6) * 0.85 + 0.15;
    const r = o.r * tp;
    const sk = o.skin(i, pts[i]);
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const d = nrm.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      gb.vert(pts[i].clone().addScaledVector(d, r), d, sk, kind, (o.u0 ?? 0) + lens[i]);
    }
  }
  const rings = o.closed ? n : n - 1;
  for (let i = 0; i < rings; i++) {
    const i2 = (i + 1) % n;
    for (let s = 0; s < seg; s++) {
      const a = base + i * seg + s, b = base + i * seg + ((s + 1) % seg);
      const c = base + i2 * seg + ((s + 1) % seg), d = base + i2 * seg + s;
      gb.idx.push(a, b, c, a, c, d);
    }
  }
}

/** Small ellipsoid (eyes). Axes are given as vectors so it can be tilted. */
export function blob(gb: GlowBuilder, c: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, az: THREE.Vector3, skin: Skin, kind: number, q = 1) {
  const la = q < 1 ? 4 : 6, lo = q < 1 ? 6 : 10;
  const base = gb.count;
  for (let i = 0; i <= la; i++) {
    const th = (i / la) * Math.PI;
    for (let j = 0; j < lo; j++) {
      const ph = (j / lo) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      const p = c.clone().addScaledVector(ax, x).addScaledVector(ay, y).addScaledVector(az, z);
      const nn = V(0, 0, 0).addScaledVector(ax, x / ax.lengthSq()).addScaledVector(ay, y / ay.lengthSq()).addScaledVector(az, z / az.lengthSq()).normalize();
      gb.vert(p, nn, skin, kind, 0);
    }
  }
  for (let i = 0; i < la; i++)
    for (let j = 0; j < lo; j++) {
      const a = base + i * lo + j, b = base + i * lo + ((j + 1) % lo);
      const c2 = base + (i + 1) * lo + ((j + 1) % lo), d = base + (i + 1) * lo + j;
      gb.idx.push(a, d, c2, a, c2, b);
    }
}

/* ----------------------------------------------------------------------------------- loft surfaces */

/** Re-evaluates a loft's surface (same maths as geo.loft) so seams can be laid exactly on the plates. */
export class Surf {
  ts: THREE.Vector3[];
  constructor(public rings: Ring[], public defRef = V(0, 0, 1)) {
    const n = rings.length;
    this.ts = rings.map((ring, r) =>
      ring.t
        ? ring.t.clone().normalize()
        : (r === 0 ? rings[1].c.clone().sub(ring.c) : r === n - 1 ? ring.c.clone().sub(rings[n - 2].c) : rings[r + 1].c.clone().sub(rings[r - 1].c)).normalize(),
    );
  }

  ringPoint(r: number, th: number) {
    const ring = this.rings[r];
    const t = this.ts[r];
    const ref = (ring.ref ?? this.defRef).clone();
    const zA = ref.sub(t.clone().multiplyScalar(ref.dot(t))).normalize();
    const xA = new THREE.Vector3().crossVectors(t, zA).normalize();
    const k = ring.shape ? ring.shape(th) : 1;
    let lx = Math.cos(th) * ring.rx * k;
    let lz = Math.sin(th) * ring.rz * k;
    if (ring.bend) {
      const [bx, bz] = ring.bend(th);
      lx += bx;
      lz += bz;
    }
    const p = ring.c.clone().addScaledVector(xA, lx).addScaledVector(zA, lz);
    if (ring.dyFn) p.y += ring.dyFn(th);
    return p;
  }

  /** Point at fractional ring index s and angle th, pushed `off` metres outward from the ring axis. */
  at(s: number, th: number, off = 0) {
    const n = this.rings.length;
    const i = Math.max(0, Math.min(n - 2, Math.floor(s)));
    const f = clamp(s - i, 0, 1);
    const a = this.ringPoint(i, th), b = this.ringPoint(i + 1, th);
    const p = a.lerp(b, f);
    if (off) {
      const c = this.rings[i].c.clone().lerp(this.rings[i + 1].c, f);
      const ax = this.ts[i].clone().lerp(this.ts[i + 1], f).normalize();
      const d = p.clone().sub(c);
      d.addScaledVector(ax, -d.dot(ax));
      if (d.lengthSq() > 1e-10) p.addScaledVector(d.normalize(), off);
    }
    return p;
  }

  /** Fractional ring index for a world height (rings must be monotonic in y). */
  sAtY(y: number) {
    const r = this.rings;
    const up = r[r.length - 1].c.y > r[0].c.y;
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i].c.y, b = r[i + 1].c.y;
      if ((up && y >= a && y <= b) || (!up && y <= a && y >= b)) return i + (y - a) / (b - a || 1);
    }
    return up ? (y < r[0].c.y ? 0 : r.length - 1) : y > r[0].c.y ? 0 : r.length - 1;
  }

  /** Seam around the surface at height y from angle th0 to th1. */
  ringSeam(y: number, th0: number, th1: number, off: number, n = 16) {
    const s = this.sAtY(y);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) pts.push(this.at(s, th0 + (th1 - th0) * (i / n), off));
    return pts;
  }

  /** Seam through (y, th) control points, resampled smoothly. */
  path(ctrl: [number, number][], off: number, n = 16) {
    const pts2 = ctrl.map(([y, th]) => V(this.sAtY(y), th, 0));
    const curve = new THREE.CatmullRomCurve3(pts2, false, 'centripetal');
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const q = curve.getPointAt(i / n);
      out.push(this.at(q.x, q.y, off));
    }
    return out;
  }
}

export function smoothPts(ctrl: THREE.Vector3[], n: number) {
  const c = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  return c.getSpacedPoints(n);
}

/** Emissive surface patch (icy plate fill) from a rows x cols grid of points, wound CCW toward +normal. */
export function patch(
  gb: GlowBuilder,
  grid: THREE.Vector3[][],
  nrm: (p: THREE.Vector3) => THREE.Vector3,
  skin: (p: THREE.Vector3) => Skin,
  kind: number,
) {
  const rows = grid.length, cols = grid[0].length;
  const base = gb.count;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) gb.vert(grid[r][c], nrm(grid[r][c]), skin(grid[r][c]), kind, c / (cols - 1));
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = base + r * cols + c, b = a + 1, d = a + cols, c2 = d + 1;
      gb.idx.push(a, d, c2, a, c2, b);
    }
}
