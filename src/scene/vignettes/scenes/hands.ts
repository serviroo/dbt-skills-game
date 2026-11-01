import * as THREE from 'three';
import { glow, NOISE_GLSL, OUT_GLSL, pointScale, rng } from '../common';
import type { BuildScene } from '../runtime';

/**
 * Willing hands: two open hands resting side by side, palms up, smooth and softly translucent like frosted glass, with a
 * small warm light floating just above them that pools in the palms and glows through the fingers. Over the step the
 * fingers loosen one after another from a light curl and settle open, and the hands roll a little further open; nothing
 * ever closes again. The warm light is the only light, a bright core inside a soft halo; the lantern-blue rim comes from
 * behind. The hands are modelled here: a smooth distance field round the bones of a stylised hand is meshed once, then
 * posed bone by bone from the timer's beat.
 */

const FOV = 34;
/** the camera looks down on the hands from this far, this steeply */
const DIST = 2.8;
const TILT = 0.36;
type V3 = readonly [number, number, number];

/** One finger or the thumb of the right hand, in hand lengths: palm up (+y), fingers along -z, thumb toward +x. */
interface Digit {
  /** where it leaves the palm: the knuckle, or the thumb's root by the wrist */
  base: V3;
  /** the way it points held straight */
  dir: V3;
  /** the way its pad faces: bending turns it that way */
  pad: V3;
  lens: V3;
  /** its radius at the base, at each joint and at the tip */
  radii: readonly [number, number, number, number];
  /** how far each joint bends at a full curl, in radians */
  bend: V3;
  /** its curl at the start of the step and once loosened (0 straight, 1 fully curled) */
  from: number;
  to: number;
  /** seconds into the step before it starts to loosen */
  delay: number;
  /** how far it fans out toward the thumb's side as it loosens, in radians */
  spread: number;
}
const yawed = (a: number): V3 => [Math.sin(a), 0, -Math.cos(a)];
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const UP: V3 = [0, 1, 0];
const FINGER_BEND: V3 = [1.25, 1.6, 1.0];
/** index, middle, ring, little finger, then the thumb; the little finger stays the most curled, as a resting hand does */
const DIGITS: Digit[] = [
  { base: [0.15, 0, -0.49], dir: yawed(0.1), pad: UP, lens: [0.225, 0.13, 0.1], radii: [0.052, 0.046, 0.041, 0.034], bend: FINGER_BEND, from: 0.5, to: 0.1, delay: 0, spread: 0.06 },
  { base: [0.05, 0.004, -0.505], dir: yawed(0.02), pad: UP, lens: [0.245, 0.15, 0.105], radii: [0.054, 0.049, 0.042, 0.035], bend: FINGER_BEND, from: 0.55, to: 0.13, delay: 0.6, spread: 0.01 },
  { base: [-0.048, 0, -0.485], dir: yawed(-0.08), pad: UP, lens: [0.228, 0.142, 0.1], radii: [0.051, 0.045, 0.04, 0.032], bend: FINGER_BEND, from: 0.6, to: 0.17, delay: 1.2, spread: -0.04 },
  { base: [-0.138, -0.008, -0.435], dir: yawed(-0.2), pad: UP, lens: [0.18, 0.105, 0.09], radii: [0.044, 0.039, 0.035, 0.028], bend: FINGER_BEND, from: 0.68, to: 0.24, delay: 1.8, spread: -0.09 },
  { base: [0.125, -0.01, -0.075], dir: unit([0.52, 0.2, -0.83]), pad: unit([-0.75, 0.6, -0.1]), lens: [0.2, 0.15, 0.115], radii: [0.07, 0.056, 0.05, 0.04], bend: [0.35, 0.7, 0.9], from: 0.55, to: 0.12, delay: 0.3, spread: 0.12 },
];
/** the curl the hand is modelled at, between every digit's start and end, so posing bends it only a little either way */
const REST = 0.35;
/** how long a digit takes to loosen: most of it within three of these */
const LOOSEN = 3.4;
/** the left hand loosens a moment after the right */
const LAG = 0.4;
/** the hands roll open about their length, at the start and once loosened */
const ROLL: readonly [number, number] = [0.34, 0.2];
/** the moment the still frame shows the light, the motes and the camera at */
const STILL_T = 6;
/** a time long after every digit has loosened: the still frame's pose */
const SETTLED = 60;

/** 1 at the start, easing to 0 as the digit loosens: it starts and settles softly and never turns back */
const held = (x: number) => (x <= 0 ? 1 : (1 + x / LOOSEN) * Math.exp(-x / LOOSEN));

const Y = new THREE.Vector3(0, 1, 0);
const AXES = DIGITS.map((d) => new THREE.Vector3(...d.dir).cross(new THREE.Vector3(...d.pad)).normalize());
interface Pose {
  joints: THREE.Vector3[];
  rots: THREE.Quaternion[];
}
const newPose = (): Pose => ({ joints: Array.from({ length: 4 }, () => new THREE.Vector3()), rots: Array.from({ length: 3 }, () => new THREE.Quaternion()) });
const fan = new THREE.Quaternion();
/** Digit i at curl c: each joint's place and each bone's turn from straight. */
function poseDigit(i: number, c: number, out: Pose) {
  const d = DIGITS[i];
  fan.setFromAxisAngle(Y, (-d.spread * (d.from - c)) / (d.from - d.to));
  out.joints[0].set(...d.base);
  let phi = 0;
  for (let k = 0; k < 3; k++) {
    phi += d.bend[k] * c;
    out.rots[k].setFromAxisAngle(AXES[i], phi).premultiply(fan);
    out.joints[k + 1].set(...d.dir).applyQuaternion(out.rots[k]).multiplyScalar(d.lens[k]).add(out.joints[k]);
  }
}
const REST_POSE = DIGITS.map((_, i) => {
  const p = newPose();
  poseDigit(i, REST, p);
  return p;
});

/** A round cone from a (radius r1) to b (radius r2), precomputed for the exact distance to it. */
function cone(a: THREE.Vector3 | V3, b: THREE.Vector3 | V3, r1: number, r2: number) {
  const [ax, ay, az] = a instanceof THREE.Vector3 ? a.toArray() : a;
  const [bx, by, bz] = b instanceof THREE.Vector3 ? b.toArray() : b;
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2;
  const rr = r1 - r2;
  return [ax, ay, az, bx - ax, by - ay, bz - az, l2, rr, l2 - rr * rr, 1 / l2, r1, r2];
}
function coneDist(c: number[], px: number, py: number, pz: number) {
  const qx = px - c[0], qy = py - c[1], qz = pz - c[2];
  const l2 = c[6], rr = c[7], a2 = c[8], il2 = c[9];
  const y = qx * c[3] + qy * c[4] + qz * c[5];
  const z = y - l2;
  const ex = qx * l2 - c[3] * y, ey = qy * l2 - c[4] * y, ez = qz * l2 - c[5] * y;
  const x2 = ex * ex + ey * ey + ez * ez;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z * z * l2 > k) return Math.sqrt(x2 + z * z * l2) * il2 - c[11];
  if (Math.sign(y) * a2 * y * y * l2 < k) return Math.sqrt(x2 + y * y * l2) * il2 - c[10];
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - c[10];
}
/** An ellipsoid turned `yaw` about the vertical, for its approximate distance. */
const ellipsoid = (c: V3, r: V3, yaw: number) => [...c, Math.cos(yaw), Math.sin(yaw), ...r];
function ellipsoidDist(e: number[], px: number, py: number, pz: number) {
  const dx = px - e[0], dy = py - e[1], dz = pz - e[2];
  const x = (e[3] * dx - e[4] * dz) / e[5], y = dy / e[6], z = (e[4] * dx + e[3] * dz) / e[7];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt((x / e[5]) ** 2 + (y / e[6]) ** 2 + (z / e[7]) ** 2);
  return (k0 * (k0 - 1)) / k1;
}
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** The right hand at rest as a distance field (negative inside): a soft palm with the digits grown smoothly out of it. */
function handField() {
  const thumb = DIGITS[4].dir;
  const palm = [
    ...DIGITS.slice(0, 4).map((d, i) => cone([d.base[0] * 0.55, -0.005, -0.07], REST_POSE[i].joints[0], 0.054, d.radii[0] + 0.004)),
    cone(DIGITS[0].base, DIGITS[3].base, 0.046, 0.04),
    cone([0.04, -0.005, -0.04], [0.035, -0.02, 0.18], 0.085, 0.08),
    cone([-0.04, -0.005, -0.04], [-0.035, -0.02, 0.18], 0.085, 0.08),
  ];
  // everything of the palm lies inside this ball
  const [PX, PZ, PR] = [0.005, -0.14, 0.5];
  const mounds = [ellipsoid([0.115, 0.03, -0.17], [0.07, 0.055, 0.13], Math.atan2(-thumb[0], -thumb[2])), ellipsoid([-0.12, 0.018, -0.24], [0.055, 0.05, 0.17], -0.1)];
  const hollow = ellipsoid([0.01, 0.105, -0.3], [0.12, 0.05, 0.15], 0);
  const digits = REST_POSE.map((p, i) => {
    const r = DIGITS[i].radii;
    const bones = [0, 1, 2].map((k) => cone(p.joints[k], p.joints[k + 1], r[k], r[k + 1]));
    const mid = p.joints[0].clone().add(p.joints[3]).multiplyScalar(0.5);
    return { bones, mid: mid.toArray(), reach: Math.max(...p.joints.map((j) => j.distanceTo(mid))) + r[0] };
  });
  const KP = 0.06, KD = 0.035;
  return (x: number, y: number, z: number) => {
    // well clear of the palm's ball, the distance to the ball stands in for the palm's: too far to blend with a digit
    let d = Math.sqrt((x - PX) ** 2 + y * y + (z - PZ) ** 2) - PR;
    if (d < KD + 0.01) {
      d = coneDist(palm[0], x, y, z);
      for (let i = 1; i < palm.length; i++) d = smin(d, coneDist(palm[i], x, y, z), KP);
      for (const m of mounds) d = smin(d, ellipsoidDist(m, x, y, z), KP);
      // the hollow of the palm, where the light pools
      d = -smin(-d, ellipsoidDist(hollow, x, y, z), 0.04);
    }
    for (const g of digits) {
      // a digit too far off to change the surface here is skipped
      const mx = x - g.mid[0], my = y - g.mid[1], mz = z - g.mid[2];
      if (Math.sqrt(mx * mx + my * my + mz * mz) - g.reach >= d + KD) continue;
      let b = coneDist(g.bones[0], x, y, z);
      b = smin(b, coneDist(g.bones[1], x, y, z), 0.01);
      b = smin(b, coneDist(g.bones[2], x, y, z), 0.01);
      d = smin(d, b, KD);
    }
    return d;
  };
}

/** the grid the hand is meshed on, in hand lengths: fine enough that a finger is about five cells across */
const CELL = 0.018;
/** the longest the making of the hand runs before the page gets a turn to draw or answer a tap, in ms */
const SLICE = 6;

/**
 * The right hand's mesh, at rest: the field's surface found on a grid (surface nets), each corner pulled onto the
 * surface, with its smooth normal; for each corner the two bones that move it and how much the second does, and how
 * thin the hand is there (for light coming through) and how open it is to the light (for soft shade in the creases).
 * Made in short slices, so a step opening while it is made still moves smoothly on a slow phone.
 */
async function handGeometry() {
  let since = performance.now();
  const turn = async () => {
    if (performance.now() - since < SLICE) return;
    await new Promise<void>((done) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => (port1.close(), done());
      port2.postMessage(null);
    });
    since = performance.now();
  };
  const f = handField();
  // the palm and wrist, and every joint at rest, with room to spare
  const lo = [-0.24, -0.13, -0.6], hi = [0.3, 0.2, 0.3];
  for (const { joints } of REST_POSE) {
    for (const j of joints) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], j.getComponent(a) - 0.08);
        hi[a] = Math.max(hi[a], j.getComponent(a) + 0.08);
      }
    }
  }
  const [nx, ny, nz] = [0, 1, 2].map((a) => Math.ceil((hi[a] - lo[a]) / CELL) + 1);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const val = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    await turn();
    for (let j = 0; j < ny; j++) {
      const y = lo[1] + j * CELL, z = lo[2] + k * CELL;
      for (let i = 0; i < nx; ) {
        const d = f(lo[0] + i * CELL, y, z);
        val[at(i, j, k)] = d;
        // far outside, the next few points along the row are outside too: they are only ever compared with zero
        const skip = Math.min(nx - 1 - i, Math.floor((0.7 * d - 1.8 * CELL) / CELL));
        for (let s = 1; s <= skip; s++) val[at(i + s, j, k)] = 0.7 * d - s * CELL;
        i += Math.max(0, skip) + 1;
      }
    }
  }

  const cell = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cellAt = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pts: number[] = [];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    await turn();
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let b = 0; b < 8; b++) {
          v[b] = val[at(i + (b & 1), j + ((b >> 1) & 1), k + (b >> 2))];
          if (v[b] < 0) mask |= 1 << b;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let a = 0; a < 8; a++) {
          for (const bit of [1, 2, 4]) {
            if (a & bit) continue;
            const b = a | bit;
            if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
            const t = v[a] / (v[a] - v[b]);
            sx += (a & 1) + (bit === 1 ? t : 0);
            sy += ((a >> 1) & 1) + (bit === 2 ? t : 0);
            sz += (a >> 2) + (bit === 4 ? t : 0);
            n++;
          }
        }
        cell[cellAt(i, j, k)] = pts.length / 3;
        pts.push(lo[0] + (i + sx / n) * CELL, lo[1] + (j + sy / n) * CELL, lo[2] + (k + sz / n) * CELL);
      }
    }
  }

  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (flip) [b, d] = [d, b];
    // split along the shorter diagonal, so thin slivers don't crease the surface
    const dist = (p: number, q: number) => (pts[p * 3] - pts[q * 3]) ** 2 + (pts[p * 3 + 1] - pts[q * 3 + 1]) ** 2 + (pts[p * 3 + 2] - pts[q * 3 + 2]) ** 2;
    if (dist(a, c) <= dist(b, d)) index.push(a, b, c, a, c, d);
    else index.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    await turn();
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = val[at(i, j, k)];
        // each edge out of this grid point that the surface crosses is shared by four cells, which make one face
        const vx = val[at(i + 1, j, k)], vy = val[at(i, j + 1, k)], vz = val[at(i, j, k + 1)];
        if (v0 < 0 !== vx < 0) quad(cell[cellAt(i, j - 1, k - 1)], cell[cellAt(i, j, k - 1)], cell[cellAt(i, j, k)], cell[cellAt(i, j - 1, k)], v0 >= 0);
        if (v0 < 0 !== vy < 0) quad(cell[cellAt(i - 1, j, k - 1)], cell[cellAt(i - 1, j, k)], cell[cellAt(i, j, k)], cell[cellAt(i, j, k - 1)], v0 >= 0);
        if (v0 < 0 !== vz < 0) quad(cell[cellAt(i - 1, j - 1, k)], cell[cellAt(i, j - 1, k)], cell[cellAt(i, j, k)], cell[cellAt(i - 1, j, k)], v0 >= 0);
      }
    }
  }

  const count = pts.length / 3;
  const position = new Float32Array(pts);
  const normal = new Float32Array(count * 3);
  const skin = new Float32Array(count * 3);
  const bake = new Float32Array(count * 2);
  const e = 0.002;
  const p = new THREE.Vector3(), g = new THREE.Vector3(), q = new THREE.Vector3();
  /** the field's direction of steepest rise at p, into g: four samples round it */
  const grad = () => {
    const a = f(p.x + e, p.y - e, p.z - e), b = f(p.x - e, p.y + e, p.z - e), c = f(p.x - e, p.y - e, p.z + e), d = f(p.x + e, p.y + e, p.z + e);
    return g.set(a - b - c + d, -a + b - c + d, -a - b + c + d).normalize();
  };
  for (let n = 0; n < count; n++) {
    if (n % 32 === 0) await turn();
    p.fromArray(position, n * 3);
    // one step along the gradient brings a corner from inside its cell onto the surface
    p.addScaledVector(grad(), -f(p.x, p.y, p.z));
    p.toArray(position, n * 3);
    grad().toArray(normal, n * 3);
    let thin = 0, shut = 0;
    for (const s of [0.03, 0.07]) {
      q.copy(p).addScaledVector(g, -s);
      thin += Math.min(1, Math.max(0, 1 + f(q.x, q.y, q.z) / s)) / 2;
    }
    for (const [s, w] of [[0.04, 1], [0.11, 0.5]]) {
      q.copy(p).addScaledVector(g, s);
      shut += (w * (s - f(q.x, q.y, q.z))) / s;
    }
    bake[n * 2] = thin;
    bake[n * 2 + 1] = Math.min(1, Math.max(0, 1 - 0.5 * shut));
    skinOf(p, skin, n * 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('skin', new THREE.BufferAttribute(skin, 3));
  geo.setAttribute('bake', new THREE.BufferAttribute(bake, 2));
  geo.setIndex(index);
  return geo;
}

const seg = new THREE.Vector3(), rel = new THREE.Vector3(), dirA = new THREE.Vector3(), dirB = new THREE.Vector3();
/**
 * The bones that move the rest-pose point p, written to out[o..o+2] as (bone a, bone b, share of b). Bone 0 is the palm,
 * then three for each digit in order. A point goes with the nearest digit it lies beyond the base of, blended across
 * the joint it is nearest; the thumb's root bone fades into the palm round it, since the ball of the thumb is both.
 */
function skinOf(p: THREE.Vector3, out: Float32Array, o: number) {
  out[o] = out[o + 1] = out[o + 2] = 0;
  let best = Infinity;
  for (let i = 0; i < DIGITS.length; i++) {
    const { joints, rots } = REST_POSE[i];
    const r = DIGITS[i].radii;
    dirA.set(...DIGITS[i].dir).applyQuaternion(rots[0]);
    const width = 0.7 * r[0];
    if (rel.subVectors(p, joints[0]).dot(dirA) < -width) continue;
    for (let k = 0; k < 3; k++) {
      seg.subVectors(joints[k + 1], joints[k]);
      const t = Math.min(1, Math.max(0, rel.subVectors(p, joints[k]).dot(seg) / seg.lengthSq()));
      const dist = rel.sub(seg.multiplyScalar(t)).length() - (r[k] + (r[k + 1] - r[k]) * t);
      if (dist >= best) continue;
      best = dist;
      // the joint this point is nearest, and the bones either side of it
      const j = t <= 0.5 || k === 2 ? k : k + 1;
      if (t > 0.5 && k === 2) {
        out[o] = out[o + 1] = 1 + i * 3 + k;
        out[o + 2] = 0;
        continue;
      }
      dirA.set(...DIGITS[i].dir).applyQuaternion(rots[Math.max(0, j - 1)]);
      dirB.set(...DIGITS[i].dir).applyQuaternion(rots[j]);
      const across = rel.subVectors(p, joints[j]).dot(dirA.add(dirB).normalize());
      const w = 0.6 * r[j];
      let share = THREE.MathUtils.smoothstep(across, -w, w);
      if (i === 4 && j === 0) {
        // how far from the thumb's root bone, across it
        seg.subVectors(joints[1], joints[0]);
        const tt = Math.min(1, Math.max(0, rel.subVectors(p, joints[0]).dot(seg) / seg.lengthSq()));
        share *= 1 - THREE.MathUtils.smoothstep(rel.sub(seg.multiplyScalar(tt)).length(), 0.075, 0.15);
      }
      out[o] = j === 0 ? 0 : 1 + i * 3 + j - 1;
      out[o + 1] = 1 + i * 3 + j;
      out[o + 2] = share;
    }
  }
}

/** the hand, made once when the scene is first needed and kept for the visit */
const HAND = await handGeometry();

const HAND_VERT = /* glsl */ `
uniform mat4 uBones[16];
attribute vec3 skin;
attribute vec2 bake;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vRest;
varying vec2 vBake;
void main() {
  mat4 m = uBones[int(skin.x + 0.5)] * (1.0 - skin.z) + uBones[int(skin.y + 0.5)] * skin.z;
  vec4 w = modelMatrix * (m * vec4(position, 1.0));
  vWorld = w.xyz;
  vN = mat3(modelMatrix) * (mat3(m) * normal);
  vRest = position;
  vBake = bake;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/**
 * Frosted glass lit from within, in linear colour: the warm light falls softly round the forms and pools in the palms,
 * scatters inside so the hands glow warm near it and cool to blue away from it, and shows through where they are thin
 * (the fingers, the edges). A soft sheen of the light, the lantern-blue rim from behind, and the wrists fade into the
 * dark.
 */
const HAND_FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uI;
uniform vec3 uRim;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vRest;
varying vec2 vBake;
${NOISE_GLSL}
const vec3 WARM = vec3(1.0, 0.64, 0.34);
const vec3 RIM_FROM = vec3(0.0, 0.42, -0.91);
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 toL = uLight - vWorld;
  float d2 = dot(toL, toL);
  vec3 L = toL * inversesqrt(d2);
  // the light keeps most of its strength for about a quarter of a hand, then fades
  float att = uI / (1.0 + d2 / 0.08);
  float thin = vBake.x, ao = vBake.y;
  // frosted glass: a cool, faintly clouded ice
  vec3 ice = vec3(0.55, 0.72, 0.95) * (0.92 + 0.16 * noise3(vRest * 11.0));
  float wrap = pow(max((dot(n, L) + 0.6) / 1.6, 0.0), 1.4);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  // the dark beyond, faintly blue through the glass, a little lighter toward the edges
  vec3 col = vec3(0.006, 0.013, 0.03) * (0.5 + 0.5 * ao) * (0.6 + 0.8 * fres);
  col += ice * WARM * att * wrap * 0.42 * mix(0.35, 1.0, ao);
  // scattered inside: the glass glows near the light, most where it is thin
  col += WARM * att * (0.04 + 0.3 * thin) * (0.45 + 0.55 * pow(max(dot(V, -L), 0.0), 2.0));
  col += WARM * att * pow(max(dot(n, normalize(L + V)), 0.0), 18.0) * (0.03 + 0.3 * fres) * ao;
  col += uRim * fres * (0.25 + 0.75 * clamp(dot(n, RIM_FROM) + 0.4, 0.0, 1.0)) * 0.34;
  // the light gathered in the hollow of each palm, as in a bowl of frosted glass
  vec2 q = (vRest.xz - vec2(0.02, -0.3)) / vec2(0.12, 0.15);
  col += WARM * uI * 0.12 * exp(-dot(q, q)) * smoothstep(0.0, 0.05, vRest.y);
  gl_FragColor = vec4(col, smoothstep(0.2, -0.08, vRest.z));
  ${OUT_GLSL}
}`;

const SPACE_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;
/** the void, a little lifted toward deep blue round the hands */
const SPACE_FRAG = /* glsl */ `
varying vec2 vP;
${NOISE_GLSL}
void main() {
  float r = length(vP - vec2(0.0, 0.1));
  vec3 col = mix(vec3(0.0034, 0.0046, 0.0105), vec3(0.0021, 0.0024, 0.0052), smoothstep(0.0, 1.1, r));
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0008;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const MOTE_VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform float uScale;
uniform vec3 uLight;
uniform float uI;
varying float vA;
void main() {
  vec3 p = position;
  float y = mod(p.y + uTime * (0.012 + 0.02 * seed.w), 0.8);
  p.y = 0.04 + y;
  p.x += sin(uTime * (0.08 + 0.06 * seed.x) + seed.y * 6.2831) * 0.05;
  p.z += cos(uTime * (0.07 + 0.05 * seed.y) + seed.x * 6.2831) * 0.04;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale * (0.005 + 0.007 * seed.z) / -mv.z);
  float d2 = dot(p - uLight, p - uLight);
  vA = uI * (0.3 + 0.7 * seed.z) / (1.0 + d2 / 0.05) * smoothstep(0.0, 0.15, y) * smoothstep(0.8, 0.5, y);
}`;
const MOTE_FRAG = /* glsl */ `
varying float vA;
void main() {
  float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5)) * vA;
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.45) * 0.5 * a, 1.0);
  ${OUT_GLSL}
}`;

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
  const look = new THREE.Vector3(0, 0.1, -0.38);
  const time = { value: 0 };
  const scale = { value: 600 };
  const light = { value: new THREE.Vector3(0, 0.15, -0.36) };
  const strength = { value: 1 };

  const space = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: SPACE_VERT, fragmentShader: SPACE_FRAG, depthTest: false, depthWrite: false }));
  space.frustumCulled = false;
  space.renderOrder = -1;

  const hands = [1, -1].map((side) => {
    const bones = Array.from({ length: 16 }, () => new THREE.Matrix4());
    const mesh = new THREE.Mesh(
      HAND,
      new THREE.ShaderMaterial({ vertexShader: HAND_VERT, fragmentShader: HAND_FRAG, uniforms: { uBones: { value: bones }, uLight: light, uI: strength, uRim: { value: accent.clone() } }, transparent: true }),
    );
    // the left hand is the right one mirrored
    mesh.scale.x = side;
    mesh.position.set(0.2 * side, 0, 0);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return { mesh, side, bones, pose: DIGITS.map(newPose), lag: side > 0 ? 0 : LAG };
  });

  const warm = new THREE.Color(1.0, 0.66, 0.38);
  const lamp = glow({ color: warm, size: 0.26, core: 0.07, halo: 0.4, intensity: strength });

  const rand = rng(31);
  const n = 26;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos.set([(rand() - 0.5) * 0.9, rand() * 0.8, -0.33 + (rand() - 0.5) * 0.6], i * 3);
    seed.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const motes = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { uTime: time, uScale: scale, uLight: light, uI: strength }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false;
  motes.renderOrder = 3;

  scene.add(space, ...hands.map((h) => h.mesh), lamp, motes);

  const probe = { curl: 0, reach: 0 };
  const q = new THREE.Quaternion(), qr = new THREE.Quaternion(), t = new THREE.Vector3(), w = new THREE.Vector3();
  /** the points the hands' outline keeps within, with their radii: every joint and the palm's edges */
  const EDGES: [V3, number][] = [[[-0.17, 0.02, -0.25], 0.05], [[0.17, 0.03, -0.17], 0.06], [[0.12, 0, -0.02], 0.06], [[-0.12, 0, -0.02], 0.06]];

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const e = still ? SETTLED : Math.max(0, b.e);
      const tt = still ? STILL_T : e;
      let curls = 0;
      for (const hand of hands) {
        for (let i = 0; i < DIGITS.length; i++) {
          const d = DIGITS[i];
          const c = d.to + (d.from - d.to) * held(e - d.delay - hand.lag);
          curls += c;
          const p = hand.pose[i];
          poseDigit(i, c, p);
          for (let k = 0; k < 3; k++) {
            const rest = REST_POSE[i];
            q.multiplyQuaternions(p.rots[k], qr.copy(rest.rots[k]).invert());
            t.copy(rest.joints[k]).applyQuaternion(q);
            hand.bones[1 + i * 3 + k].makeRotationFromQuaternion(q).setPosition(p.joints[k].x - t.x, p.joints[k].y - t.y, p.joints[k].z - t.z);
          }
        }
        const roll = ROLL[1] + (ROLL[0] - ROLL[1]) * held(e - 0.5 - hand.lag);
        hand.mesh.rotation.set(0, -0.06 * hand.side, roll * hand.side, 'YZX');
        hand.mesh.position.y = 0.006 * Math.sin((tt / 9) * Math.PI * 2 + hand.side);
        hand.mesh.updateMatrixWorld();
      }
      const loose = 1 - held(e - 1);
      strength.value = (0.84 + 0.16 * loose) * (1 + 0.05 * Math.sin((tt / 9) * Math.PI * 2));
      light.value.set(0, 0.15 + 0.012 * Math.sin((tt / 9) * Math.PI * 2 + 0.6), -0.36);
      lamp.position.copy(light.value);
      time.value = tt;

      camera.position.set(look.x + 0.05 * Math.sin(tt * 0.05), look.y + DIST * Math.sin(TILT), look.z + DIST * Math.cos(TILT));
      camera.lookAt(look);
      camera.updateMatrixWorld();

      // how far the hands reach out in the round window (1 is its edge), from every joint's sphere
      let reach = 0;
      const fy = camera.projectionMatrix.elements[5];
      const see = (v: THREE.Vector3, r: number, m: THREE.Matrix4) => {
        w.copy(v).applyMatrix4(m).applyMatrix4(camera.matrixWorldInverse);
        const rr = (r * fy) / -w.z;
        w.applyMatrix4(camera.projectionMatrix);
        reach = Math.max(reach, Math.hypot(w.x, w.y) + rr);
      };
      for (const hand of hands) {
        hand.pose.forEach((p, i) => p.joints.forEach((j, k) => see(j, DIGITS[i].radii[k], hand.mesh.matrixWorld)));
        for (const [c, r] of EDGES) see(t.set(...c), r, hand.mesh.matrixWorld);
      }
      Object.assign(probe, { curl: curls / (DIGITS.length * hands.length), reach });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      scale.value = pointScale(FOV, height);
    },
  };
};
