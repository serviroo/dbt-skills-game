import * as THREE from 'three';
import { makeToon, makeOutline, type ToonMaterial } from '../toon';
import { cubicBezier, clamp, smoothstep, mulberry32, lerp, ease } from '../../core/math';
import { params } from '../../core/params';
import type { Pose } from '../character/rig';
import { buildKnight, KN_POSES, KNEEL_DROP, type KnightKind, type KnightGeo } from './knight';
import { makeGlowMaterial, makeArmyMaterial, GLOW, type GlowMaterial } from './materials';

/** Ignition: cubic-bezier(0.7,0,0.95,0.55) over 467 ms; white cores +130 ms; eyes +130 ms after that. */
export const IGNITE = { dur: 0.467, core: 0.13, eye: 0.26, overshoot: 0.156, settle: 0.267 };
const igniteCurve = cubicBezier(0.7, 0, 0.95, 0.55);

/** Per-soldier motion lengths (seconds). */
export const EACH = { rise: 2.4, kneel: 0.7 };
/** Windows the 0..1 setters map onto (seconds). The kneel lands complete before the result window opens. */
export const WIN = { rise: 4.7, ignite: 1.8, kneel: 1.3 };

const HIDE_Y = 2.3;
const PLATE_CAP = 0.62;

export function igniteLevels(ti: number) {
  const f = (x: number, droop = 0.32, over = 1.3) => {
    if (x <= 0) return 0;
    const u = x / IGNITE.dur;
    if (u < 1) return igniteCurve(u);
    const s = (x - IGNITE.dur) / IGNITE.settle;
    return 1 + IGNITE.overshoot * Math.max(0, 1 - s) * Math.max(0, 1 - s) - droop * smoothstep(0.3, over, x - IGNITE.dur);
  };
  const fl = f(ti);
  const rise = ti < IGNITE.dur ? Math.max(fl, smoothstep(0, IGNITE.dur, ti)) : fl;
  const plate = ti <= 0 ? 0 : rise * (0.36 + 1.5 * Math.exp(-Math.max(0, ti - IGNITE.dur) / 0.32));
  return { fill: fl, core: f(ti - IGNITE.core, 0.42), eye: f(ti - IGNITE.eye, 0.12, 2.5), plate };
}

/** Body y offset and posture blend for a soldier's local rise r (0..1): head-first, hunched, then straightening. */
export function riseMotion(r: number) {
  if (r <= 0) return { y: -HIDE_Y, posture: 0, active: false };
  const H = HIDE_Y;
  // head and shoulders break the surface, hold while the seams and eyes ignite, then rise and straighten
  let y: number;
  if (r < 0.28) y = -H + H * 0.46 * ease.outCubic(r / 0.28);
  else if (r < 0.58) y = -H * 0.54 + H * 0.035 * smoothstep(0.28, 0.58, r);
  else if (r < 0.9) y = -H * 0.505 + H * 0.505 * ease.inOutCubic((r - 0.58) / 0.32);
  else y = 0;
  const posture = smoothstep(0.6, 0.98, r);
  return { y, posture, active: true };
}

/** Stepped time: hero poses step on 3s (8 fps), the reference's cadence for character motion. */
const stepped = (x: number, dur: number, fps = 8) => (params.reduced ? x : Math.floor((x * dur) * fps) / (fps * dur));

export interface HeroSpec {
  kind: KnightKind;
  x: number;
  z: number;
  rise: number;
  ignite: number;
  kneel: number;
}

export const HERO_LAYOUT: HeroSpec[] = [
  // the commander (Sable) turns to his liege first, then takes the knee with the second rank
  { kind: 'commander', x: 0.95, z: -1.25, rise: 0.0, ignite: 0.0, kneel: 0.3 },
  { kind: 'sword', x: -1.35, z: 1.2, rise: 0.2, ignite: 0.07, kneel: 0.14 },
  { kind: 'spear', x: 1.55, z: 0.95, rise: 0.34, ignite: 0.13, kneel: 0.22 },
  { kind: 'great', x: -2.45, z: -0.7, rise: 0.48, ignite: 0.19, kneel: 0.3 },
  { kind: 'sword', x: 2.75, z: -0.95, rise: 0.58, ignite: 0.24, kneel: 0.36 },
];

interface Hero {
  spec: HeroSpec;
  group: THREE.Group;
  geo: KnightGeo;
  body: ToonMaterial;
  cloth?: ToonMaterial;
  glow: GlowMaterial;
  outlines: THREE.ShaderMaterial[];
  toons: ToonMaterial[];
  yaw: number;
  r: number;
  y: number;
}

interface ArmyUnit {
  x: number;
  z: number;
  yaw: number;
  s: number;
  rise: number;
  ignite: number;
  kneel: number;
  seed: number;
  row: number;
}

function bakeMerged(kg: KnightGeo, poses: { pose: Pose; drop: number }[]) {
  const body = kg.body, glow = kg.glow;
  const nb = body.attributes.position.count, ng = glow.attributes.position.count;
  const n = nb + ng;
  const pos = new Float32Array(n * 3);
  const skinI = new Uint16Array(n * 4);
  const skinW = new Float32Array(n * 4);
  const kind = new Float32Array(n);
  const u = new Float32Array(n);
  const nrm0 = new Float32Array(n * 3);
  pos.set(body.attributes.position.array as Float32Array, 0);
  pos.set(glow.attributes.position.array as Float32Array, nb * 3);
  skinI.set(body.attributes.skinIndex.array as Uint16Array, 0);
  skinI.set(glow.attributes.skinIndex.array as Uint16Array, nb * 4);
  skinW.set(body.attributes.skinWeight.array as Float32Array, 0);
  skinW.set(glow.attributes.skinWeight.array as Float32Array, nb * 4);
  nrm0.set(body.attributes.normal.array as Float32Array, 0);
  nrm0.set(glow.attributes.normal.array as Float32Array, nb * 3);
  kind.fill(-1, 0, nb);
  kind.set(glow.attributes.aKind.array as Float32Array, nb);
  u.set(glow.attributes.aU.array as Float32Array, nb);
  const bi = body.index!.array, gi = glow.index!.array;
  const idx = new Uint32Array(bi.length + gi.length);
  idx.set(bi, 0);
  for (let i = 0; i < gi.length; i++) idx[bi.length + i] = gi[i] + nb;

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm0, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinW, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));

  const rig = kg.rig;
  const holder = new THREE.Group();
  holder.add(rig.root);
  const sm = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  holder.add(sm);
  rig.apply({}, null, 0);
  rig.root.position.set(0, 0, 0);
  holder.updateMatrixWorld(true);
  sm.bind(rig.skeleton);

  const outs = poses.map(({ pose, drop }) => {
    rig.apply(pose, null, 0);
    rig.root.position.set(0, -drop, 0);
    holder.updateMatrixWorld(true);
    rig.skeleton.update();
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      w.copy(v).addScaledVector(new THREE.Vector3(nrm0[i * 3], nrm0[i * 3 + 1], nrm0[i * 3 + 2]), 0.002);
      sm.applyBoneTransform(i, v);
      sm.applyBoneTransform(i, w);
      P.set([v.x, v.y, v.z], i * 3);
      w.sub(v).normalize();
      N.set([w.x, w.y, w.z], i * 3);
    }
    return { P, N };
  });
  rig.apply({}, null, 0);
  rig.root.position.set(0, 0, 0);

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(outs[0].P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(outs[0].N, 3));
  out.setAttribute('aPos2', new THREE.BufferAttribute(outs[1].P, 3));
  out.setAttribute('aNrm2', new THREE.BufferAttribute(outs[1].N, 3));
  out.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  out.setAttribute('aU', new THREE.BufferAttribute(u, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  g.dispose();
  return out;
}

export function buildSoldiers(opts: { focus?: THREE.Vector3; armyCount?: number; lord?: THREE.Vector3 } = {}) {
  const reduced = params.reduced;
  const group = new THREE.Group();
  group.name = 'awaken-soldiers';
  const focus = opts.focus ?? new THREE.Vector3(0, 0, 9);
  const lord = opts.lord ?? new THREE.Vector3(0, 0, 0);
  const yawTo = (x: number, z: number) => Math.atan2(focus.x - x, focus.z - z) * 0.6;

  /* ---------------- heroes */
  const heroes: Hero[] = HERO_LAYOUT.map((spec, hi) => {
    const geo = buildKnight(spec.kind, 1, hi + 1);
    const g = new THREE.Group();
    g.name = 'hero-' + spec.kind;
    g.add(geo.rig.root);
    const body = makeToon({ base: 0x141b2b, shade: 0x06080e, rim: 0.8, rimWidth: 0.62, rimTint: spec.kind === 'commander' ? 0xc8a8ff : 0xb4c4ff, term: 0.08, soft: 0.02, backShade: 0.6, rimUpCut: 0.7 });
    body.uniforms.uClipY.value = 0;
    body.uniforms.uClipColor.value = GLOW.clip.clone();
    const outlines: THREE.ShaderMaterial[] = [];
    const toons: ToonMaterial[] = [body];
    const add = (geom: THREE.BufferGeometry, mat: THREE.Material, outlinePx: number, flutter = 0) => {
      const m = new THREE.SkinnedMesh(geom, mat);
      m.bind(geo.rig.skeleton);
      m.frustumCulled = false;
      g.add(m);
      if (outlinePx > 0) {
        const om = makeOutline(outlinePx, 0x020106, flutter);
        om.uniforms.uClipY.value = 0;
        outlines.push(om);
        const o = new THREE.SkinnedMesh(geom, om);
        o.bind(geo.rig.skeleton);
        o.frustumCulled = false;
        g.add(o);
      }
      return m;
    };
    add(geo.body, body, 1.5);
    const glow = makeGlowMaterial(hi * 0.37);
    add(geo.glow, glow, 0);
    let cloth: ToonMaterial | undefined;
    if (geo.cloth) {
      cloth = makeToon({
        base: 0x15112a,
        shade: 0x05040b,
        rim: 1.1,
        rimWidth: 0.56,
        rimTint: 0xd6b0ff,
        flutterAmp: 0.22,
        hemColor: 0x7b3fe4,
        hemStart: 0.6,
        hemGlow: 0.9,
        doubleSide: true,
        backShade: 0.7,
      });
      cloth.uniforms.uClipY.value = 0;
      cloth.uniforms.uClipColor.value = GLOW.clip.clone();
      toons.push(cloth);
      add(geo.cloth, cloth, 1.3, 0.22);
    }
    const yaw = yawTo(spec.x, spec.z);
    g.position.set(spec.x, -HIDE_Y, spec.z);
    g.rotation.y = yaw;
    g.visible = false;
    group.add(g);
    return { spec, group: g, geo, body, cloth, glow, outlines, toons, yaw, r: 0, y: -HIDE_Y };
  });

  /* ---------------- army (instanced, baked poses, one draw per variant) */
  const rnd = mulberry32(2024);
  const units: ArmyUnit[] = [];
  const want = opts.armyCount ?? (reduced ? 30 : 48);
  const rows = 6;
  for (let r = 0; r < rows && units.length < want; r++) {
    // tight ranks, all in front of the gate, split by an aisle that runs from him to the gate
    const z = -2.6 - r * 0.8;
    const half = 2.3 + r * 1.0;
    const n = Math.round((half * 2) / 1.12) + 1;
    for (let i = 0; i < n && units.length < want; i++) {
      const x = -half + (i / (n - 1)) * half * 2 + (r % 2 ? 0.56 : 0) + (rnd() - 0.5) * 0.18;
      const zz = z + (rnd() - 0.5) * 0.22;
      if (HERO_LAYOUT.some((h) => Math.hypot(h.x - x, h.z - zz) < 1.0)) continue;
      if (Math.abs(x) < 0.8) continue;
      const centre = Math.abs(x) / half;
      units.push({
        x,
        z: zz,
        yaw: yawTo(x, zz) * 0.6 + (rnd() - 0.5) * 0.06,
        s: 0.97 + rnd() * 0.07,
        rise: 0.4 + r * 0.26 + centre * 0.22 + rnd() * 0.18,
        ignite: 0.22 + r * 0.12 + centre * 0.1 + rnd() * 0.06,
        kneel: (0.18 + r * 0.1 + centre * 0.06 + rnd() * 0.05) * 0.72,
        seed: rnd(),
        row: r,
      });
    }
  }
  const variants: KnightKind[] = ['spear', 'sword'];
  const army = variants.map((vk, vi) => {
    const list = units.filter((_, i) => (units[i].row % 2 === 0 ? i % 3 !== 0 : i % 3 === 0) === (vi === 0));
    list.sort((a, b) => a.rise - b.rise);
    const kg = buildKnight(vk, 0.38, 100 + vi);
    const poses = KN_POSES[vk];
    const geom = bakeMerged(kg, [
      { pose: poses.stand, drop: 0 },
      { pose: poses.kneel, drop: KNEEL_DROP },
    ]);
    kg.body.dispose();
    kg.glow.dispose();
    const st = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
    st.setUsage(THREE.DynamicDrawUsage);
    const st2 = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
    st2.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aState', st);
    geom.setAttribute('aState2', st2);
    const mat = makeArmyMaterial();
    const mesh = new THREE.InstancedMesh(geom, mat, Math.max(1, list.length));
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.name = 'army-' + vk;
    group.add(mesh);
    return { kind: vk, list, mesh, st, st2, mat, r: new Float32Array(list.length), y: new Float32Array(list.length) };
  });

  /* ---------------- state */
  const state = { rise: 0, ignite: 0, kneel: 0 };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(), p4 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);

  /** soldier list in a fixed order for the smoke system: heroes first, then army units */
  const smokeList = [
    ...heroes.map((h) => ({ x: h.spec.x, z: h.spec.z, hero: true })),
    ...army.flatMap((a) => a.list.map((u) => ({ x: u.x, z: u.z, hero: false }))),
  ];
  const smokeRise = new Float32Array(smokeList.length);
  const smokeY = new Float32Array(smokeList.length);

  const update = (t: number) => {
    const riseT = state.rise * WIN.rise;
    const ignT = state.ignite * WIN.ignite;
    const knT = state.kneel * WIN.kneel;
    let si = 0;
    for (const h of heroes) {
      const r = clamp((riseT - h.spec.rise) / EACH.rise);
      const mo = riseMotion(state.rise > 0 ? r : 0);
      const k = clamp((knT - h.spec.kneel) / EACH.kneel);
      const kq = ease.inOutCubic(stepped(k, EACH.kneel));
      const visible = mo.active;
      h.group.visible = visible;
      h.r = r;
      if (visible) {
        const poses = KN_POSES[h.spec.kind];
        const pq = ease.inOutSine(stepped(mo.posture, EACH.rise * 0.6));
        const lv0 = igniteLevels(state.ignite > 0 ? ignT - h.spec.ignite : -1);
        // the head lifts as the eyes ignite: the awakening beat
        const wake = clamp(lv0.eye) * (1 - pq);
        const add: Pose = { neck: [-0.16 * wake, 0, 0], head: [-0.32 * wake, 0, 0], chest: [-0.06 * wake, 0, 0] };
        if (kq > 0) h.geo.rig.apply(poses.stand, poses.kneel, kq);
        else h.geo.rig.apply(poses.emerge, poses.stand, pq, add);
        h.geo.rig.root.position.y = -KNEEL_DROP * kq;
        h.group.position.y = mo.y;
        if (h.spec.kind === 'commander') {
          // Sable turns from the ranks to face the wanderer as the army starts to kneel, then kneels to him
          const turn = ease.inOutSine(stepped(clamp(knT / 0.55), 0.55));
          h.group.rotation.y = lerp(h.yaw, Math.atan2(lord.x - h.spec.x, lord.z - h.spec.z), turn);
        }
        h.y = mo.y;
        const lv = igniteLevels(state.ignite > 0 ? ignT - h.spec.ignite : -1);
        h.glow.uniforms.uFill.value = lv.fill;
        h.glow.uniforms.uCore.value = lv.core;
        h.glow.uniforms.uEye.value = lv.eye;
        h.glow.uniforms.uPlate.value = h.spec.kind === 'commander' ? lv.plate : Math.min(lv.plate, PLATE_CAP);
        h.glow.uniforms.uTime.value = t;
        h.glow.uniforms.uShimmer.value = reduced ? 0 : 1;
        const clipGlow = r > 0 && r < 0.98 ? (1 - smoothstep(0.75, 0.98, r)) * 0.25 : 0;
        for (const m of h.toons) (m.uniforms.uClipColor.value as THREE.Color).copy(GLOW.clip).multiplyScalar(clipGlow);
      }
      smokeRise[si] = state.rise > 0 ? r : 0;
      smokeY[si] = mo.y;
      si++;
    }
    for (const a of army) {
      const st = a.st.array as Float32Array, st2 = a.st2.array as Float32Array;
      let active = 0;
      a.list.forEach((u, i) => {
        const r = state.rise > 0 ? clamp((riseT - u.rise) / EACH.rise) : 0;
        const mo = riseMotion(r);
        if (mo.active) active = i + 1;
        const lv = igniteLevels(state.ignite > 0 ? ignT - u.ignite : -1);
        const k = clamp((knT - u.kneel) / EACH.kneel);
        const kq = ease.inOutCubic(stepped(k, EACH.kneel));
        st[i * 4] = lv.fill;
        st[i * 4 + 1] = lv.core;
        st[i * 4 + 2] = lv.eye;
        st[i * 4 + 3] = kq;
        st2[i * 4] = u.seed;
        st2[i * 4 + 1] = r > 0 && r < 0.98 ? 1 - smoothstep(0.75, 0.98, r) : 0;
        st2[i * 4 + 2] = Math.min(lv.plate, PLATE_CAP);
        // emerging: lean forward (hunched) until the posture straightens
        const lean = (1 - smoothstep(0.6, 0.98, r)) * 0.22;
        q4.setFromAxisAngle(yAxis, u.yaw);
        q4.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean));
        p4.set(u.x, mo.y, u.z);
        s4.setScalar(u.s);
        m4.compose(p4, q4, s4);
        a.mesh.setMatrixAt(i, m4);
        a.r[i] = r;
        a.y[i] = mo.y;
        smokeRise[si] = r;
        smokeY[si] = mo.y;
        si++;
      });
      a.mesh.count = active;
      a.mesh.visible = active > 0;
      a.mesh.instanceMatrix.needsUpdate = true;
      a.st.needsUpdate = true;
      a.st2.needsUpdate = true;
      a.mat.uniforms.uTime.value = t;
      a.mat.uniforms.uShimmer.value = reduced ? 0 : 1;
    }
  };

  const dispose = () => {
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mm = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
      else mm?.dispose();
    });
  };

  return {
    group,
    heroes,
    army,
    units,
    state,
    update,
    smokeList,
    smokeRise,
    smokeY,
    dispose,
    /** hero world-space info for the director (e.g. camera targets) */
    heroPositions: () => heroes.map((h) => new THREE.Vector3(h.spec.x, h.y, h.spec.z)),
    lerp,
  };
}
export type Soldiers = ReturnType<typeof buildSoldiers>;
