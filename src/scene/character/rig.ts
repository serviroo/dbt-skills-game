import * as THREE from 'three';

export interface BoneDef {
  name: string;
  parent: string | null;
  pos: [number, number, number]; // world-space rest position
}

export type Pose = Record<string, [number, number, number]>; // euler XYZ radians, relative to rest

export class Rig {
  bones: THREE.Bone[] = [];
  byName = new Map<string, THREE.Bone>();
  index = new Map<string, number>();
  skeleton: THREE.Skeleton;
  root: THREE.Bone;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private e = new THREE.Euler();

  constructor(defs: BoneDef[]) {
    const world = new Map<string, THREE.Vector3>();
    defs.forEach((d, i) => {
      const b = new THREE.Bone();
      b.name = d.name;
      const wp = new THREE.Vector3(...d.pos);
      world.set(d.name, wp);
      if (d.parent) {
        const pp = world.get(d.parent)!;
        b.position.copy(wp).sub(pp);
        this.byName.get(d.parent)!.add(b);
      } else b.position.copy(wp);
      this.bones.push(b);
      this.byName.set(d.name, b);
      this.index.set(d.name, i);
    });
    this.root = this.bones[0];
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
  }

  i(name: string) {
    const v = this.index.get(name);
    if (v === undefined) throw new Error('no bone ' + name);
    return v;
  }

  b(name: string) {
    return this.byName.get(name)!;
  }

  /** Blend between two poses (missing bones = rest) and apply. Optional additive pose on top. */
  apply(a: Pose, b: Pose | null, t: number, add?: Pose) {
    for (const bone of this.bones) {
      const ea = a[bone.name];
      const eb = b ? b[bone.name] : undefined;
      if (ea) this.qa.setFromEuler(this.e.set(ea[0], ea[1], ea[2]));
      else this.qa.identity();
      if (b) {
        if (eb) this.qb.setFromEuler(this.e.set(eb[0], eb[1], eb[2]));
        else this.qb.identity();
        this.qa.slerp(this.qb, t);
      }
      const ad = add?.[bone.name];
      if (ad) this.qa.multiply(this.qb.setFromEuler(this.e.set(ad[0], ad[1], ad[2])));
      bone.quaternion.copy(this.qa);
    }
  }
}

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k] ?? [0, 0, 0];
    const y = b[k] ?? [0, 0, 0];
    out[k] = [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  }
  return out;
}

export function addPose(a: Pose, b: Pose, s = 1): Pose {
  const out: Pose = { ...a };
  for (const k of Object.keys(b)) {
    const x = a[k] ?? [0, 0, 0];
    const y = b[k];
    out[k] = [x[0] + y[0] * s, x[1] + y[1] * s, x[2] + y[2] * s];
  }
  return out;
}
