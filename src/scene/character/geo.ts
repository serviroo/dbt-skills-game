import * as THREE from 'three';

export type Skin = [number, number][]; // [boneIndex, weight]

/** Accumulates a skinned mesh piece by piece; indices are local to each builder. */
export class MeshBuilder {
  pos: number[] = [];
  skinI: number[] = [];
  skinW: number[] = [];
  flutter: number[] = [];
  sway: number[] = [];
  tangent: number[] = [];
  hem: number[] = [];
  /** per-vertex strand coordinates [along, across, lock id] (written only when a strand asks for them) */
  strand: number[] = [];
  strandUsed = false;
  idx: number[] = [];

  get count() {
    return this.pos.length / 3;
  }

  vert(p: THREE.Vector3, skin: Skin, flutter = 0, sway = 0, tan?: THREE.Vector3, hem = 0, st?: [number, number, number]) {
    if (st) {
      if (!this.strandUsed) {
        this.strandUsed = true;
        this.strand = new Array(this.count * 3).fill(0);
      }
      this.strand.push(st[0], st[1], st[2]);
    } else if (this.strandUsed) this.strand.push(0, 0, 0);
    this.pos.push(p.x, p.y, p.z);
    const s = normSkin(skin);
    if (!s.length) throw new Error("vertex without skin weights");
    for (let i = 0; i < 4; i++) {
      this.skinI.push(s[i]?.[0] ?? 0);
      this.skinW.push(s[i]?.[1] ?? 0);
    }
    this.flutter.push(flutter);
    this.sway.push(sway);
    this.hem.push(hem);
    if (tan) this.tangent.push(tan.x, tan.y, tan.z);
    else this.tangent.push(0, 1, 0);
    return this.count - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinW, 4));
    g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(this.flutter, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('aTangent', new THREE.Float32BufferAttribute(this.tangent, 3));
    g.setAttribute('aHem', new THREE.Float32BufferAttribute(this.hem, 1));
    if (this.strandUsed) g.setAttribute('aStrand', new THREE.Float32BufferAttribute(this.strand, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export function normSkin(skin: Skin): Skin {
  const merged = new Map<number, number>();
  for (const [b, w] of skin) if (w > 1e-4) merged.set(b, (merged.get(b) ?? 0) + w);
  const arr = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = arr.reduce((s, [, w]) => s + w, 0) || 1;
  return arr.map(([b, w]) => [b, w / sum]);
}

export function blendSkin(a: Skin, b: Skin, t: number): Skin {
  return [...a.map(([i, w]) => [i, w * (1 - t)] as [number, number]), ...b.map(([i, w]) => [i, w * t] as [number, number])];
}

export interface Ring {
  c: THREE.Vector3; // centre
  t?: THREE.Vector3; // tangent along the loft (computed if missing)
  ref?: THREE.Vector3; // forward reference for the ellipse's z axis
  rx: number;
  rz: number;
  skin: Skin;
  skinFn?: (theta: number) => Skin;
  dyFn?: (theta: number) => number;
  flutterFn?: (theta: number) => number;
  flutter?: number;
  sway?: number;
  /** angle-dependent radius multiplier. theta: 0 = +x (side), PI/2 = forward. */
  shape?: (theta: number) => number;
  /** optional additive offset in ring space (x side, z forward) */
  bend?: (theta: number) => [number, number];
}

const _tmp = new THREE.Vector3();

/** Closed loft through rings. Seamless (no duplicated seam vertices) so normals stay smooth. */
export function loft(
  mb: MeshBuilder,
  rings: Ring[],
  seg: number,
  opts: { capStart?: boolean; capEnd?: boolean; defaultRef?: THREE.Vector3; phase?: number } = {},
) {
  const defRef = opts.defaultRef ?? new THREE.Vector3(0, 0, 1);
  const base = mb.count;
  const n = rings.length;
  for (let r = 0; r < n; r++) {
    const ring = rings[r];
    const t = ring.t
      ? ring.t.clone().normalize()
      : (r === 0
          ? rings[1].c.clone().sub(ring.c)
          : r === n - 1
            ? ring.c.clone().sub(rings[n - 2].c)
            : rings[r + 1].c.clone().sub(rings[r - 1].c)
        ).normalize();
    const ref = (ring.ref ?? defRef).clone();
    // forward axis z perpendicular to tangent
    const zA = ref.sub(_tmp.copy(t).multiplyScalar(ref.dot(t))).normalize();
    const xA = new THREE.Vector3().crossVectors(t, zA).normalize();
    // xA is +x when t is up and zA is forward
    for (let s = 0; s < seg; s++) {
      const th = (s / seg) * Math.PI * 2 + (opts.phase ?? 0);
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
      mb.vert(p, ring.skinFn ? ring.skinFn(th) : ring.skin, ring.flutterFn ? ring.flutterFn(th) : (ring.flutter ?? 0), ring.sway ?? 0, t);
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let s = 0; s < seg; s++) {
      const a = base + r * seg + s;
      const b = base + r * seg + ((s + 1) % seg);
      const c = base + (r + 1) * seg + ((s + 1) % seg);
      const d = base + (r + 1) * seg + s;
      mb.quad(a, d, c, b);
    }
  }
  if (opts.capStart) {
    const ring = rings[0];
    const tip = ring.c.clone();
    if (rings.length > 1) tip.addScaledVector(rings[0].c.clone().sub(rings[1].c).normalize(), Math.min(ring.rx, ring.rz) * 0.35);
    const ci = mb.vert(tip, ring.skinFn ? ring.skinFn(Math.PI / 2) : ring.skin, ring.flutter ?? 0, ring.sway ?? 0);
    for (let s = 0; s < seg; s++) mb.tri(ci, base + s, base + ((s + 1) % seg));
  }
  if (opts.capEnd) {
    const ring = rings[n - 1];
    const tip = ring.c.clone();
    if (rings.length > 1) tip.addScaledVector(ring.c.clone().sub(rings[n - 2].c).normalize(), Math.min(ring.rx, ring.rz) * 0.35);
    const ci = mb.vert(tip, ring.skinFn ? ring.skinFn(Math.PI / 2) : ring.skin, ring.flutter ?? 0, ring.sway ?? 0);
    const o = base + (n - 1) * seg;
    for (let s = 0; s < seg; s++) mb.tri(ci, o + ((s + 1) % seg), o + s);
  }
}

/** Catmull-Rom resample of control points into a smooth path. */
export function smoothPath(pts: THREE.Vector3[], samples: number) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return curve.getPoints(samples - 1);
}

export function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number) {
  const u = 1 - t;
  return new THREE.Vector3()
    .addScaledVector(p0, u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

export function bezierTangent(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number) {
  const u = 1 - t;
  return new THREE.Vector3()
    .addScaledVector(p1.clone().sub(p0), 3 * u * u)
    .addScaledVector(p2.clone().sub(p1), 6 * u * t)
    .addScaledVector(p3.clone().sub(p2), 3 * t * t)
    .normalize();
}

/**
 * A tapered, flattened strand along a bezier (hair locks, plumes, coat tails).
 * widthDir: preferred direction of the wide axis at the root (parallel-transported).
 */
export function strand(
  mb: MeshBuilder,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  o: {
    width: number;
    thick: number;
    widthDir: THREE.Vector3;
    rings?: number;
    seg?: number;
    skin: Skin;
    sway?: number;
    profile?: (t: number) => number;
    twist?: number;
  },
) {
  const rings = o.rings ?? 9;
  const seg = o.seg ?? 6;
  const base = mb.count;
  let wDir = o.widthDir.clone().normalize();
  let prevT = bezierTangent(p0, p1, p2, p3, 0);
  wDir.sub(prevT.clone().multiplyScalar(wDir.dot(prevT))).normalize();
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const c = bezier(p0, p1, p2, p3, t);
    const tan = bezierTangent(p0, p1, p2, p3, t);
    // parallel transport the width axis
    const q = new THREE.Quaternion().setFromUnitVectors(prevT, tan);
    wDir.applyQuaternion(q);
    wDir.sub(tan.clone().multiplyScalar(wDir.dot(tan))).normalize();
    if (o.twist) wDir.applyAxisAngle(tan, o.twist / rings);
    prevT = tan;
    const tDir = new THREE.Vector3().crossVectors(tan, wDir).normalize();
    const prof = o.profile ? o.profile(t) : Math.pow(1 - t, 0.85) * (0.75 + 0.25 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5));
    const w = o.width * prof;
    const th = o.thick * prof;
    if (r === rings - 1) {
      mb.vert(c, o.skin, 0, (o.sway ?? 0) * t, tan);
      break;
    }
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      // lens-shaped cross-section: pointy on the wide sides
      const ca = Math.cos(a), sa = Math.sin(a);
      const lens = Math.sign(sa) * Math.pow(Math.abs(sa), 0.8);
      const p = c.clone().addScaledVector(wDir, ca * w).addScaledVector(tDir, lens * th);
      mb.vert(p, o.skin, 0, (o.sway ?? 0) * t, tan);
    }
  }
  for (let r = 0; r < rings - 2; r++) {
    for (let s = 0; s < seg; s++) {
      const a = base + r * seg + s;
      const b = base + r * seg + ((s + 1) % seg);
      const c = base + (r + 1) * seg + ((s + 1) % seg);
      const d = base + (r + 1) * seg + s;
      mb.quad(a, b, c, d);
    }
  }
  const tip = base + (rings - 1) * seg;
  const last = base + (rings - 2) * seg;
  for (let s = 0; s < seg; s++) mb.tri(last + s, last + ((s + 1) % seg), tip);
  // root cap
  const rc = mb.vert(p0.clone().addScaledVector(bezierTangent(p0, p1, p2, p3, 0), -o.thick * 0.5), o.skin, 0, 0);
  for (let s = 0; s < seg; s++) mb.tri(rc, base + ((s + 1) % seg), base + s);
}

/**
 * A rectangular sheet given as a grid of points (rows x cols), extruded to a closed shell of the given thickness.
 * Used for coat panels and capes so the inverted-hull outline works and hems have visible thickness.
 */
export function shell(
  mb: MeshBuilder,
  grid: THREE.Vector3[][],
  skin: (r: number, c: number) => Skin,
  flutter: (r: number, c: number) => number,
  thickness: number,
) {
  const rows = grid.length, cols = grid[0].length;
  // normals of the sheet
  const normals: THREE.Vector3[][] = [];
  for (let r = 0; r < rows; r++) {
    normals.push([]);
    for (let c = 0; c < cols; c++) {
      const pu = grid[r][Math.min(cols - 1, c + 1)].clone().sub(grid[r][Math.max(0, c - 1)]);
      const pv = grid[Math.min(rows - 1, r + 1)][c].clone().sub(grid[Math.max(0, r - 1)][c]);
      normals[r].push(new THREE.Vector3().crossVectors(pu, pv).normalize());
    }
  }
  const outer = mb.count;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) mb.vert(grid[r][c], skin(r, c), flutter(r, c));
  const inner = mb.count;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      mb.vert(grid[r][c].clone().addScaledVector(normals[r][c], -thickness), skin(r, c), flutter(r, c));
  const O = (r: number, c: number) => outer + r * cols + c;
  const I = (r: number, c: number) => inner + r * cols + c;
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      mb.quad(O(r, c), O(r, c + 1), O(r + 1, c + 1), O(r + 1, c));
      mb.quad(I(r, c), I(r + 1, c), I(r + 1, c + 1), I(r, c + 1));
    }
  // rims
  for (let c = 0; c < cols - 1; c++) {
    mb.quad(O(0, c), I(0, c), I(0, c + 1), O(0, c + 1));
    mb.quad(O(rows - 1, c), O(rows - 1, c + 1), I(rows - 1, c + 1), I(rows - 1, c));
  }
  for (let r = 0; r < rows - 1; r++) {
    mb.quad(O(r, 0), O(r + 1, 0), I(r + 1, 0), I(r, 0));
    mb.quad(O(r, cols - 1), I(r, cols - 1), I(r + 1, cols - 1), O(r + 1, cols - 1));
  }
}

/** Tapered flat strand along an arbitrary polyline (smoothed). */
export function strandPts(
  mb: MeshBuilder,
  ctrl: THREE.Vector3[],
  o: {
    width: number;
    thick: number;
    widthDir: THREE.Vector3;
    rings?: number;
    seg?: number;
    skin: Skin;
    sway?: number;
    profile?: (t: number) => number;
    flutter?: (t: number) => number;
    /** lock id in (0, 1]: writes strand coordinates (along, across, id) for a per-lock sheen; off unless given */
    sheen?: number;
  },
) {
  const rings = o.rings ?? 12;
  const st = (along: number, across: number): [number, number, number] | undefined => (o.sheen ? [along, across, o.sheen] : undefined);
  const seg = o.seg ?? 6;
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const base = mb.count;
  let prevT = curve.getTangentAt(0).normalize();
  const wDir = o.widthDir.clone();
  wDir.sub(prevT.clone().multiplyScalar(wDir.dot(prevT))).normalize();
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const c = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).normalize();
    wDir.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(prevT, tan));
    wDir.sub(tan.clone().multiplyScalar(wDir.dot(tan))).normalize();
    prevT = tan;
    const tDir = new THREE.Vector3().crossVectors(tan, wDir).normalize();
    const prof = o.profile ? o.profile(t) : Math.pow(1 - t, 0.9) * (0.8 + 0.2 * Math.sin(Math.min(1, t * 4) * Math.PI * 0.5));
    const fl = o.flutter ? o.flutter(t) : 0;
    if (r === rings - 1) {
      mb.vert(c, o.skin, fl, (o.sway ?? 0) * t, tan, 0, st(t, 0));
      break;
    }
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const lens = Math.sign(sa) * Math.pow(Math.abs(sa), 0.8);
      const p = c.clone().addScaledVector(wDir, ca * o.width * prof).addScaledVector(tDir, lens * o.thick * prof);
      mb.vert(p, o.skin, fl, (o.sway ?? 0) * t, tan, 0, st(t, ca));
    }
  }
  for (let r = 0; r < rings - 2; r++)
    for (let s = 0; s < seg; s++) {
      const a = base + r * seg + s;
      const b = base + r * seg + ((s + 1) % seg);
      const c = base + (r + 1) * seg + ((s + 1) % seg);
      const d = base + (r + 1) * seg + s;
      mb.quad(a, b, c, d);
    }
  const tip = base + (rings - 1) * seg;
  const last = base + (rings - 2) * seg;
  for (let s = 0; s < seg; s++) mb.tri(last + s, last + ((s + 1) % seg), tip);
  const rc = mb.vert(ctrl[0].clone().addScaledVector(curve.getTangentAt(0), -o.thick * 0.6), o.skin, 0, 0, undefined, 0, st(0, 0));
  for (let s = 0; s < seg; s++) mb.tri(rc, base + ((s + 1) % seg), base + s);
}

/** Like shell(), but writes the inner surface into a separate builder (for a lining material). */
export function shell2(
  outerMb: MeshBuilder,
  innerMb: MeshBuilder,
  grid: THREE.Vector3[][],
  skin: (r: number, c: number) => Skin,
  flutter: (r: number, c: number) => number,
  thickness: number,
  hem: (r: number, c: number) => number = () => 0,
) {
  const rows = grid.length, cols = grid[0].length;
  const normals: THREE.Vector3[][] = [];
  for (let r = 0; r < rows; r++) {
    normals.push([]);
    for (let c = 0; c < cols; c++) {
      const pu = grid[r][Math.min(cols - 1, c + 1)].clone().sub(grid[r][Math.max(0, c - 1)]);
      const pv = grid[Math.min(rows - 1, r + 1)][c].clone().sub(grid[Math.max(0, r - 1)][c]);
      const n = new THREE.Vector3().crossVectors(pu, pv);
      normals[r].push(n.lengthSq() > 1e-12 ? n.normalize() : new THREE.Vector3(0, 0, 1));
    }
  }
  const inPos = (r: number, c: number) => grid[r][c].clone().addScaledVector(normals[r][c], -thickness);
  const outer = outerMb.count;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) outerMb.vert(grid[r][c], skin(r, c), flutter(r, c), 0, undefined, hem(r, c));
  const innerInOuter = outerMb.count; // inner-edge copies used only by the rims (outer builder)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) outerMb.vert(inPos(r, c), skin(r, c), flutter(r, c), 0, undefined, hem(r, c));
  const O = (r: number, c: number) => outer + r * cols + c;
  const IO = (r: number, c: number) => innerInOuter + r * cols + c;
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) outerMb.quad(O(r, c), O(r, c + 1), O(r + 1, c + 1), O(r + 1, c));
  for (let c = 0; c < cols - 1; c++) {
    outerMb.quad(O(0, c), IO(0, c), IO(0, c + 1), O(0, c + 1));
    outerMb.quad(O(rows - 1, c), O(rows - 1, c + 1), IO(rows - 1, c + 1), IO(rows - 1, c));
  }
  for (let r = 0; r < rows - 1; r++) {
    outerMb.quad(O(r, 0), O(r + 1, 0), IO(r + 1, 0), IO(r, 0));
    outerMb.quad(O(r, cols - 1), IO(r, cols - 1), IO(r + 1, cols - 1), O(r + 1, cols - 1));
  }
  const inner = innerMb.count;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) innerMb.vert(inPos(r, c), skin(r, c), flutter(r, c), 0, undefined, hem(r, c));
  const I = (r: number, c: number) => inner + r * cols + c;
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) innerMb.quad(I(r, c), I(r + 1, c), I(r + 1, c + 1), I(r, c + 1));
}
