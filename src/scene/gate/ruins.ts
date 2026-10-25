import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/math';
import { light } from '../toon';

/**
 * The ruined abbey the gate opens in. The gate stands in the old nave: two rows of clustered piers run back from it
 * (some still carrying a pointed arch, most broken off), broken aisle walls with lancet windows stand beyond them, and
 * the west front closes the nave far behind the gate with one great traceried window, so every shot that looks at the
 * gate sees it framed by the abbey. Low hills ring the horizon. Everything is one merged mesh and one stone material:
 * coursed masonry, weather streaks and broken edges, lit only by the gate (diffuse plus a backlit rim) and a little
 * night sky from above, fading into the shared night fog with its feet in ground mist. Seeded, so it never changes.
 */

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);

/** Points of a pointed (equilateral) arch from the left springing over the apex to the right springing. */
function lancet(span: number, springY: number, n = 10, cx = 0) {
  const pts: THREE.Vector2[] = [];
  const r = span;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * (Math.PI / 3);
    pts.push(V2(cx + span / 2 + r * Math.cos(a), springY + r * Math.sin(a)));
  }
  for (let i = 1; i <= n; i++) {
    const a = Math.PI / 3 - (i / n) * (Math.PI / 3);
    pts.push(V2(cx - span / 2 + r * Math.cos(a), springY + r * Math.sin(a)));
  }
  return pts;
}

/** A lancet opening as a closed outline (bottom, up the jamb, over the arch, down the other jamb), counter-clockwise. */
function opening(span: number, bottom: number, springY: number, cx = 0) {
  const arch = lancet(span, springY, 10, cx).reverse();
  return [V2(cx + span / 2, bottom), ...arch, V2(cx - span / 2, bottom)];
}

const ccw = (pts: THREE.Vector2[]) => (THREE.ShapeUtils.isClockWise(pts) ? pts.slice().reverse() : pts);
const cw = (pts: THREE.Vector2[]) => (THREE.ShapeUtils.isClockWise(pts) ? pts : pts.slice().reverse());

/** Extrudes an outline (with holes) in XY by `depth` along Z, centred on z = 0. */
function slab(outline: THREE.Vector2[], holes: THREE.Vector2[][], depth: number, bevel = 0) {
  const shape = new THREE.Shape(ccw(outline));
  for (const h of holes) shape.holes.push(new THREE.Path(cw(h)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** A jagged broken top edge from x0 to x1 around height y (descending gaps where stones fell). */
function brokenEdge(x0: number, x1: number, y: number, depth: number, rnd: () => number, minY = -Infinity, step = 0.55) {
  const pts: THREE.Vector2[] = [];
  const n = Math.max(2, Math.round(Math.abs(x1 - x0) / step));
  let drop = 0;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    if (rnd() < 0.3) drop = rnd() * depth;
    else drop *= 0.6;
    // stepped like coursed stone: whole courses missing, not a saw blade
    const yy = Math.max(minY, y - Math.round((drop + rnd() * depth * 0.25) / 0.46) * 0.46);
    pts.push(V2(x, yy));
    if (i < n && rnd() < 0.5) pts.push(V2(x + ((x1 - x0) / n) * 0.5, yy));
  }
  return pts;
}

/** Cross-section of a clustered pier: a round core with four large shafts on the axes and four small ones between. */
function pierRadius(theta: number, r: number) {
  const circles: [number, number, number][] = [[0, 0, r * 0.62]];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    circles.push([Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.34]);
    const b = a + Math.PI / 4;
    circles.push([Math.cos(b) * r * 0.66, Math.sin(b) * r * 0.66, r * 0.17]);
  }
  const dx = Math.cos(theta), dy = Math.sin(theta);
  let best = 0;
  for (const [cx, cy, rho] of circles) {
    const b = dx * cx + dy * cy;
    const disc = rho * rho - (cx * cx + cy * cy) + b * b;
    if (disc >= 0) best = Math.max(best, b + Math.sqrt(disc));
  }
  return best;
}

/**
 * A clustered pier on a moulded plinth. `broken` 0 is an intact pier with a capital; above 0 the top is snapped off,
 * jagged by up to `broken` metres.
 */
function pier(h: number, r: number, broken: number, seed: number) {
  const rnd = mulberry32(seed);
  const N = 48;
  const parts: THREE.BufferGeometry[] = [];
  // plinth: a chamfered octagon, then a moulded step
  const plinth = new THREE.CylinderGeometry(r * 1.32, r * 1.38, 0.7, 8, 1);
  plinth.rotateY(Math.PI / 8);
  plinth.translate(0, 0.35, 0);
  parts.push(faceted(plinth));
  const ring = (y: number, scale: number, jag?: (i: number) => number) =>
    Array.from({ length: N }, (_, i) => {
      const th = (i / N) * Math.PI * 2;
      const rr = pierRadius(th, r) * scale;
      return new THREE.Vector3(Math.cos(th) * rr, y - (jag ? jag(i) : 0), Math.sin(th) * rr);
    });
  // rings joined into a surface, shaded smooth round the pier (the shafts read round, not as 48 flat strips) and flat up
  // each band, so the mouldings keep crisp steps
  const around = new THREE.Vector3(), up = new THREE.Vector3(), nrm = new THREE.Vector3();
  const band = (rings: THREE.Vector3[][]) => {
    const pos: number[] = [], nor: number[] = [];
    const vert = (k: number, r: number, j: number) => {
      const p = rings[r][j];
      around.subVectors(rings[r][(j + 1) % N], rings[r][(j + N - 1) % N]);
      up.subVectors(rings[k + 1][j], rings[k][j]);
      nrm.crossVectors(up, around).normalize();
      pos.push(p.x, p.y, p.z);
      nor.push(nrm.x, nrm.y, nrm.z);
    };
    for (let k = 0; k < rings.length - 1; k++)
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        for (const [r, c] of [[k, i], [k + 1, i], [k + 1, j], [k, i], [k + 1, j], [k, j]]) vert(k, r, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  };
  const base = band([ring(0.7, 1.16), ring(0.86, 1.16), ring(0.98, 1.04), ring(1.12, 1.0)]);
  parts.push(base);
  // the shaft, with chipped arrises: a few stones bitten back along the height
  const segs = Math.max(3, Math.round(h / 1.6));
  const top = broken > 0 ? h : h - 0.9;
  const phase = rnd() * 10, phase2 = rnd() * 10;
  const jag = (i: number) => {
    if (broken <= 0) return 0;
    const th = (i / N) * Math.PI * 2;
    const v = 0.5 + 0.3 * Math.sin(th * 2 + phase) + 0.2 * Math.sin(th * 5 + phase2);
    return Math.round((v * broken) / 0.23) * 0.23;
  };
  const rings: THREE.Vector3[][] = [];
  for (let k = 0; k <= segs; k++) {
    const y = 1.12 + ((top - 1.12) * k) / segs;
    const rr = ring(y, 1, k === segs ? jag : undefined);
    if (k > 0 && k < segs)
      for (let i = 0; i < N; i++) {
        const bite = rnd() < 0.08 ? 0.88 : 1;
        rr[i].x *= bite;
        rr[i].z *= bite;
      }
    rings.push(rr);
  }
  parts.push(band(rings));
  const last = rings[segs];
  if (broken > 0) {
    // the snapped top: a rough fan, sagging to the middle
    const c = new THREE.Vector3(0, top - broken * 0.55 - 0.1, 0);
    const pos: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = last[i], b = last[(i + 1) % N];
      pos.push(c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    parts.push(g);
  } else {
    // capital: a flared bell, a moulded band and a square abacus the arch springs from
    parts.push(band([last, ring(top + 0.35, 1.12), ring(top + 0.5, 1.2), ring(top + 0.58, 1.2)]));
    const abacus = new THREE.BoxGeometry(r * 2.6, 0.32, r * 2.6);
    abacus.translate(0, top + 0.74, 0);
    parts.push(abacus);
  }
  return mergeAll(parts);
}

/** A pointed arch ring springing at y = 0 between two piers `span` apart (in XY, `depth` thick). */
function archRing(span: number, ringW: number, depth: number, broken: number, rnd: () => number) {
  const outer = lancet(span + ringW * 2, 0, 14);
  const inner = lancet(span, 0, 14).reverse();
  let pts = [...outer, ...inner];
  if (broken > 0) {
    // one side has fallen away past the apex: keep the springer and a stub of the ring
    const keep = Math.floor(outer.length * (0.55 + 0.25 * rnd()));
    const o = outer.slice(0, keep);
    const ii = lancet(span, 0, 14).slice(0, keep).reverse();
    pts = [...o, ...ii];
  }
  return slab(pts, [], depth);
}

/** A wall section with lancet windows and a broken top, `t` thick, standing on y = 0 in XY. */
function wall(w: number, h: number, t: number, windows: { x: number; span: number; bottom: number; spring: number }[], breakDepth: number, rnd: () => number) {
  // the top breaks away, but never down into a window
  const apex = Math.max(0.2, ...windows.map((o) => o.spring + o.span * 0.87));
  const outline = [V2(-w / 2, 0), V2(w / 2, 0), ...brokenEdge(w / 2, -w / 2, h, breakDepth, rnd, windows.length ? apex + 0.6 : 0.8)];
  const holes = windows.map((o) => opening(o.span, o.bottom, o.spring, o.x));
  return slab(outline, holes, t);
}

/** The wall over an arch, `w` wide: it sits on the arch's outer curve (span `span`, springing at y = 0), broken off above. */
function spandrel(w: number, span: number, h: number, t: number, breakDepth: number, rnd: () => number) {
  const apex = span * 0.87;
  const outline = [V2(-w / 2, 0), V2(-span / 2, 0), ...lancet(span, 0, 14).slice(1, -1), V2(span / 2, 0), V2(w / 2, 0), ...brokenEdge(w / 2, -w / 2, h, breakDepth, rnd, apex + 0.6)];
  return slab(outline, [], t);
}

/** Tracery for a great lancet window: two sub-lancets under an oculus, recessed in the opening. */
function tracery(span: number, bottom: number, spring: number, depth: number) {
  const outer = opening(span, bottom, spring);
  const sub = span * 0.4;
  const subSpring = spring - span * 0.1;
  const holes = [
    opening(sub, bottom + 0.2, subSpring, -span * 0.235),
    opening(sub, bottom + 0.2, subSpring, span * 0.235),
    Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * Math.PI * 2;
      return V2(Math.cos(a) * span * 0.2, spring + span * 0.52 + Math.sin(a) * span * 0.2);
    }),
  ];
  return slab(outer, holes, depth);
}

/** A squared stone block with softened edges. */
function block(sx: number, sy: number, sz: number) {
  const b = Math.min(sx, sy, sz) * 0.12;
  const g = slab([V2(-sx / 2 + b, -sy / 2 + b), V2(sx / 2 - b, -sy / 2 + b), V2(sx / 2 - b, sy / 2 - b), V2(-sx / 2 + b, sy / 2 - b)], [], sz - 2 * b, b);
  return g;
}

/** Low hills ringing the horizon, facing the centre. */
function hills(radius: number, rnd: () => number) {
  const N = 180;
  const pos: number[] = [];
  const ph = [rnd() * 9, rnd() * 9, rnd() * 9];
  const hAt = (a: number) => 3 + 5 * (0.5 + 0.5 * Math.sin(a * 3 + ph[0])) + 3.5 * (0.5 + 0.5 * Math.sin(a * 7 + ph[1])) + 1.4 * Math.sin(a * 23 + ph[2]);
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const r0 = radius * (1 + 0.08 * Math.sin(a0 * 5 + ph[1])), r1 = radius * (1 + 0.08 * Math.sin(a1 * 5 + ph[1]));
    const p = [Math.cos(a0) * r0, -3, Math.sin(a0) * r0, Math.cos(a1) * r1, -3, Math.sin(a1) * r1, Math.cos(a1) * r1, hAt(a1), Math.sin(a1) * r1, Math.cos(a0) * r0, hAt(a0), Math.sin(a0) * r0];
    pos.push(p[0], p[1], p[2], p[6], p[7], p[8], p[3], p[4], p[5], p[0], p[1], p[2], p[9], p[10], p[11], p[6], p[7], p[8]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Flat shading for a part whose own normals are smoothed across hard edges (an octagon, a block). */
function faceted(g: THREE.BufferGeometry) {
  const f = g.index ? g.toNonIndexed() : g;
  f.deleteAttribute('normal');
  f.computeVertexNormals();
  if (f !== g) g.dispose();
  return f;
}

/** One geometry from many: positions and each part's own normals (flat face normals where a part has none). */
function mergeAll(parts: THREE.BufferGeometry[]) {
  const flat = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  });
  const m = mergeGeometries(flat)!;
  for (const p of parts) p.dispose();
  return m;
}

const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return g;
};

/** Nave pier rows: [z, left height, left broken, right height, right broken]. 0 broken = intact with a capital. */
const NAVE_X = 9.6;
const NAVE: [number, number, number, number, number][] = [
  [-2.5, 2.4, 0.9, 4.2, 1.3],
  [-8.2, 10.4, 0, 6.8, 1.6],
  [-13.9, 10.4, 0, 10.4, 0],
  [-19.6, 3.1, 1.1, 10.4, 0],
  [-25.3, 8.6, 2.2, 1.8, 0.6],
  [-31.0, 10.4, 0, 5.6, 1.8],
  [-36.7, 4.4, 1.5, 10.4, 0],
  [-42.4, 10.4, 0, 10.4, 0],
];
/** Arches that still stand: [side (-1 left, 1 right), from row, broken]. */
const ARCHES: [number, number, number][] = [
  [-1, 1, 0],
  [1, 2, 0],
  [1, 6, 0],
  [-1, 5, 1],
];
const WEST_Z = -47.5;

export interface Ruins {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/** `shared` carries the gate uniforms the dungeon env updates every frame (uGatePos, uGateCol, uGateI, uGateH, uFade, uNoise). */
export function buildRuins(shared: Record<string, THREE.IUniform>, seed = 11): Ruins {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const pierR = 0.62;

  // the nave: two rows of clustered piers running back from the gate to the west front
  for (const [i, row] of NAVE.entries()) {
    const [z, hl, bl, hr, br] = row;
    parts.push(place(pier(hl, pierR, bl, seed * 31 + i * 2), -NAVE_X, 0, z, rnd() * 0.3));
    parts.push(place(pier(hr, pierR, br, seed * 31 + i * 2 + 1), NAVE_X, 0, z, rnd() * 0.3));
  }
  // surviving arcade arches between neighbouring intact piers (spanning along z), springing from the abacus top (10.4)
  const SPRING = 10.4;
  for (const [side, from, broken] of ARCHES) {
    const z0 = NAVE[from][0], z1 = NAVE[from + 1][0];
    const span = Math.abs(z1 - z0) - pierR * 2.4;
    const ringW = 0.62;
    const g = archRing(span, ringW, 1.1, broken, rnd);
    // the ring lies in XY; turn it to run along z
    place(g, side * NAVE_X, SPRING, (z0 + z1) / 2, side < 0 ? Math.PI / 2 : -Math.PI / 2);
    parts.push(g);
    // the spandrel wall over the arch, sitting on its outer curve and broken off above it
    if (!broken) {
      const sp = spandrel(Math.abs(z1 - z0) + pierR * 2, span + ringW * 2, 5.6, 0.9, 2.2, rnd);
      place(sp, side * NAVE_X, SPRING, (z0 + z1) / 2, side < 0 ? Math.PI / 2 : -Math.PI / 2);
      parts.push(sp);
    }
  }

  // aisle walls: broken runs of wall with lancet windows, beyond the piers
  const AISLE_X = NAVE_X + 7.2, AISLE_T = 1.0;
  for (const side of [-1, 1]) {
    for (const [z0, z1, h] of [[-4, -16, 7.5], [-21, -33, 5.2], [-35, -46, 8.6]] as const) {
      const w = Math.abs(z1 - z0);
      const grid: number[] = [];
      for (let x = -w / 2 + 2.4; x < w / 2 - 1.5; x += 4.2) grid.push(x);
      const wins = grid.map((x) => ({ x, span: 1.6, bottom: 1.6, spring: 4.4 })).filter((o) => o.spring + 1.4 < h);
      const ry = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      parts.push(place(wall(w, h + rnd() * 1.5, AISLE_T, wins, 3.8, rnd), side * AISLE_X, 0, (z0 + z1) / 2, ry));
      // buttresses against the outside of the wall: at both ends and between the windows, in two set-back stages
      const at = [-w / 2 + 0.8, ...grid.slice(0, -1).map((x) => x + 2.1), w / 2 - 0.8];
      for (const x of at) {
        // the wall's local x runs along -z on the left side and +z on the right (the turn above)
        const z = (z0 + z1) / 2 + (side < 0 ? -x : x);
        const bh = h * (0.55 + 0.35 * rnd());
        const face = side * (AISLE_X + AISLE_T / 2);
        parts.push(place(block(1.2, bh, 1.4), face + side * 0.58, bh / 2, z));
        if (bh > 3) parts.push(place(block(0.8, bh * 0.35, 1.1), face + side * 0.38, bh + bh * 0.175, z));
      }
    }
  }

  // the west front closing the nave behind the gate: a great traceried window, two lesser lancets, broken gable
  {
    const W = 27, H = 21;
    const great = { x: 0, span: 7.2, bottom: 3.6, spring: 12.4 };
    const lesser = [-8.4, 8.4].map((x) => ({ x, span: 2.4, bottom: 4.2, spring: 9.6 }));
    // the gable breaks away, but never down into the great window or the moulded ring round it
    const gableMin = great.spring + (great.span + 0.1 + 0.55 * 2) * 0.87 + 0.6;
    const outline = [V2(-W / 2, 0), V2(W / 2, 0), V2(W / 2, H - 6), ...brokenEdge(W / 2 - 3, 2, H + 2.5, 2.6, rnd, gableMin), V2(0, H + 4.2), ...brokenEdge(-1.5, -W / 2 + 2, H + 1.5, 4.5, rnd, gableMin), V2(-W / 2, H - 5)];
    const front = slab(outline, [opening(great.span, great.bottom, great.spring), ...lesser.map((o) => opening(o.span, o.bottom, o.spring, o.x))], 2.2);
    place(front, 0, 0, WEST_Z);
    parts.push(front);
    const tr = tracery(great.span, great.bottom, great.spring, 0.5);
    place(tr, 0, 0, WEST_Z + 0.3);
    parts.push(tr);
    // the window's moulded surround: a stepped ring standing proud of the wall
    const surround = archRing(great.span + 0.1, 0.55, 0.6, 0, rnd);
    place(surround, 0, great.spring, WEST_Z + 1.2);
    parts.push(surround);
    for (const x of [-great.span / 2 - 0.33, great.span / 2 + 0.33]) {
      const j = block(0.55, great.spring - great.bottom, 0.6);
      place(j, x, (great.spring + great.bottom) / 2, WEST_Z + 1.2);
      parts.push(j);
    }
    // corner buttresses, stepping back as they rise
    for (const s of [-1, 1]) {
      for (const [h, w, d, y0] of [[9, 2.2, 3.2, 0], [6, 1.7, 2.4, 9], [4, 1.2, 1.6, 15]] as const) {
        const b = block(w, h, d);
        place(b, s * (W / 2 - 0.4), y0 + h / 2, WEST_Z + 1.1 + d / 2);
        parts.push(b);
      }
    }
  }

  // fallen stones: squared blocks and a drum from a pier, half sunk, near the pier feet and out in the aisles
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -2 - rnd() * 42;
    const x = side * (NAVE_X - 1.2 + rnd() * 6.5);
    const s = 0.35 + rnd() * 0.6;
    const g = rnd() < 0.2 ? new THREE.CylinderGeometry(pierR * 0.9, pierR * 0.9, 0.9, 16).rotateZ(Math.PI / 2) : block(s * (1.2 + rnd()), s, s * (1 + rnd() * 0.6));
    place(g, x, s * 0.3, z, rnd() * Math.PI, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.3);
    parts.push(g);
  }

  // behind the camera of the first shots: the east end, a few broken piers and a low run of wall
  for (const [x, z, h, b] of [[-NAVE_X, 7, 3.6, 1.2], [NAVE_X, 9.5, 6.4, 2.0], [-NAVE_X, 15, 8.2, 2.5], [NAVE_X, 17, 2.2, 0.8]] as const) parts.push(place(pier(h, pierR, b, seed * 7 + Math.round(z)), x, 0, z, rnd()));
  {
    const g = wall(16, 4.2, 1.0, [{ x: -3.5, span: 1.6, bottom: 1.4, spring: 2.6 }, { x: 3.5, span: 1.6, bottom: 1.4, spring: 2.6 }], 2.4, rnd);
    place(g, 0, 0, 24);
    parts.push(g);
  }

  parts.push(hills(150, rnd));

  const geo = mergeAll(parts);
  const material = ruinMaterial(shared);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'ruins';
  mesh.frustumCulled = false;
  return { mesh, material };
}

/**
 * Coursed stone, weathered, lit by the gate and the night sky; fog to the night horizon with mist at its feet. `courses`
 * false drops the coursed joints for loose stones (rubble), keeping the same stone, light and fog.
 */
export function ruinMaterial(shared: Record<string, THREE.IUniform>, opts: { courses?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    defines: opts.courses === false ? {} : { COURSES: 1 },
    uniforms: {
      ...shared,
      uFogColor: light.uFogColor,
      uStone: { value: new THREE.Color(0.032, 0.037, 0.058) },
      uSkyAmb: { value: new THREE.Color(0.006, 0.009, 0.022) },
      uFogD: { value: 0.016 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      uniform float uFade, uGateI, uGateH, uFogD;
      uniform vec3 uGatePos, uGateCol, uFogColor, uStone, uSkyAmb;
      varying vec3 vW;
      varying vec3 vN;
      float hh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main() {
        vec3 n = normalize(vN);
        #ifdef COURSES
        // coursed masonry, projected on the face's own plane
        vec2 q = abs(n.y) > 0.75 ? vW.xz : (abs(n.x) > abs(n.z) ? vW.zy : vW.xy);
        float course = 0.46;
        float row = floor(q.y / course);
        float bw = mix(0.62, 1.25, hh(vec2(row, 3.1)));
        float u = q.x / bw + hh(vec2(row, 7.7));
        float col = floor(u);
        vec2 f = vec2(fract(u) * bw, fract(q.y / course) * course);
        float edge = min(min(f.x, bw - f.x), min(f.y, course - f.y));
        float fw = max(fwidth(q.y), 1e-4);
        // the joints fade out where a course gets thinner than a few pixels (no shimmer on the far front)
        float detail = 1.0 - smoothstep(0.04, 0.14, fw);
        float joint = (1.0 - smoothstep(0.012, 0.04 + fw, edge)) * detail;
        float tone = hh(vec2(row, col) + 0.37);
        #else
        // loose stones: no joints, one tone per stone-sized patch
        vec2 q = vW.xz + vW.y;
        float detail = 1.0, joint = 0.0;
        float tone = hh(floor(vW.xz * 3.0) + 0.37);
        #endif
        float n1 = texture2D(uNoise, q * 0.19 + 0.21).r;
        float n2 = texture2D(uNoise, q * 0.83 + 0.6).g;
        // rain streaks down the faces and darker damp near the ground
        float streak = smoothstep(0.55, 0.85, texture2D(uNoise, vec2(q.x * 0.31, q.y * 0.025 + 0.4)).g);
        vec3 alb = uStone * (0.72 + 0.4 * tone * detail + 0.25 * detail * (n2 - 0.5)) * (0.75 + 0.5 * n1);
        alb *= (1.0 - 0.55 * joint) * (1.0 - 0.3 * streak) * mix(0.7, 1.0, smoothstep(0.0, 1.6, vW.y));

        vec3 Lp = uGatePos + vec3(0.0, uGateH * 0.42, 0.0);
        vec3 L = Lp - vW;
        float dl = length(L);
        L /= dl;
        float fall = 1.0 / (1.0 + dl * dl * 0.012);
        float ndl = max(dot(n, L), 0.0);
        vec3 V = normalize(cameraPosition - vW);
        // backlit rim: an edge turned away from the camera towards the gate catches its light
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * smoothstep(-0.25, 0.45, dot(n, L));
        vec3 gate = uGateCol * uGateI * fall;
        vec3 c = alb * (uSkyAmb * (0.35 + 0.65 * max(n.y, 0.0)) + gate * (2.6 * ndl + 0.15));
        c += gate * rim * 0.16 * (0.7 + 0.3 * n1);

        float d = length(cameraPosition - vW);
        float fog = 1.0 - exp(-pow(uFogD * d, 2.0));
        // ground mist round the feet of everything distant: the bases melt into the floor fog
        float mist = (1.0 - smoothstep(0.0, 2.6, vW.y)) * smoothstep(8.0, 34.0, d);
        // far stone stays a little darker than the horizon so the abbey reads as a silhouette against the gate's haze
        vec3 fc = mix(uFogColor * 0.72, uFogColor, mist);
        c = mix(c, fc, clamp(max(fog * 0.93, mist * 0.85), 0.0, 1.0));
        c = mix(uFogColor * 0.72, c, uFade);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}
