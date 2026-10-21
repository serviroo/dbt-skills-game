import * as THREE from 'three';
import type { Stage } from '../../core/stage';
import { params } from '../../core/params';
import { clamp, cubicBezier, ease, noise1 } from '../../core/math';
import { makeOutline } from '../toon';
import { chestUniforms, emissiveMaterial, goldMaterial, obsidianMaterial } from './materials';
import {
  DIM, HINGE, LID_ARC, LID_D, LID_W, Path2, frame, frontMap, hollowLid, lidBand, lidInnerPoint, lidPoint, merge, outlineGeometry, rbox,
  rhombus, rhombusPlate, sideMap, slitGeometry, taper, wire, cloudHead, tail,
} from './geometry';
import {
  fallingStars, floorFx, glints, glowSprite, interiorLight, leakRays, lightColumn, lightFeather, risingStars, shards, shockRing, streaks, MOTES_GLSL,
  CONVERGE_GLSL, SPARKS_GLSL,
} from './fx';
import { chestSounds } from './sounds';
export { holdToCharge } from './hold';

/** Timing (seconds). setReveal(p) and setOpen(p) take p in 0..1 over `reveal` and `open`. */
export const CHEST_TIMING = {
  reveal: 1.9,
  riseEnd: 1.25,
  igniteAt: 1.2,
  ignite: 0.467,
  open: 1.6,
  /** the director's hush between a full charge and the burst */
  hush: 0.2,
  /** "[LANTERN] Reward unlocked." opens this long after the burst */
  windowDelay: 0.8,
  holdSec: 1.5,
};

export interface ChestOpts {
  /** pass the Stage so the burst can drive bloom overshoot and the one soft flash */
  stage?: Stage;
  /** include the shadow pool / contact shadow / gold floor light (default true) */
  floor?: boolean;
  /** bloom intensity to overshoot from (default: stage.bloom.intensity when the burst starts) */
  bloomBase?: number;
  /** set false if the caller owns bloom overshoot and the flash (default true when a stage is given) */
  fx?: boolean;
}

const isStage = (a: unknown): a is Stage => !!a && typeof a === 'object' && 'renderer' in a && 'composer' in a && 'grade' in a;

export interface Chest {
  group: THREE.Group;
  setReveal(p: number): void;
  setCharge(c: number): void;
  setOpen(p: number): void;
  update(t: number): void;
  /** world position of the opening, for the director (letter rising from the light, camera targets) */
  openingWorld(target?: THREE.Vector3): THREE.Vector3;
  stats(): { drawCalls: number; triangles: number; particles: number };
  dispose(): void;
}

const ignition = cubicBezier(0.7, 0, 0.95, 0.55);
const LID_OPEN = 1.88; // radians, about 108 degrees

/** Lid spring: snaps to +3 % past open in 270 ms, settles with one small dip by 600 ms. */
function lidSpring(t: number) {
  if (t <= 0) return 0;
  if (t < 0.27) return 1.03 * ease.outCubic(t / 0.27);
  if (t < 0.6) {
    const k = (t - 0.27) / 0.33;
    return 1 + 0.03 * Math.cos(k * Math.PI * 1.5) * (1 - k);
  }
  return 1;
}

function buildGeometry() {
  const { W, D } = DIM;
  const gold: THREE.BufferGeometry[] = [];
  const obs: THREE.BufferGeometry[] = [];
  const outl: THREE.BufferGeometry[] = [];
  const seam: THREE.BufferGeometry[] = [];
  const glintsBody: THREE.Vector3[] = [];

  // obsidian plinth and body
  const plinth = rbox(W + 0.07, 0.07, D + 0.07, 0.014, 0, 0.085, 0, 3);
  const body = rbox(W, DIM.bodyY[1] - DIM.bodyY[0] + 0.01, D, 0.02, 0, (DIM.bodyY[0] + DIM.bodyY[1]) / 2, 0, 3);
  obs.push(plinth, body);
  outl.push(plinth, body);

  // gold: plinth band, rim band, corner guards, feet
  gold.push(...frame(W + 0.086, D + 0.086, 0.104, 0.128, 0.022, 0.009));
  const rim = frame(W + 0.03, D + 0.03, DIM.rimY[0], DIM.rimY[1], 0.03, 0.012);
  gold.push(...rim);
  outl.push(...rim);
  const gw = 0.078, gt = 0.012, gy0 = DIM.bodyY[0] + 0.005, gy1 = DIM.rimY[0] + 0.004;
  const gh = gy1 - gy0, gyc = (gy0 + gy1) / 2;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      gold.push(rbox(gw, gh, gt, 0.004, sx * (W / 2 - gw / 2 + gt * 0.6), gyc, sz * (D / 2 + gt * 0.35)));
      gold.push(rbox(gt, gh, gw, 0.004, sx * (W / 2 + gt * 0.35), gyc, sz * (D / 2 - gw / 2 + gt * 0.6)));
      // bun feet
      const foot = new THREE.LatheGeometry(
        [0, 0.3, 0.62, 0.86, 1, 0.94, 0.72, 0.6, 0].map((r, i, a) => new THREE.Vector2(r * 0.055, (i / (a.length - 1)) * 0.056)),
        16,
      );
      foot.translate(sx * (W / 2 - 0.005), 0, sz * (D / 2 - 0.005));
      gold.push(foot);
      glintsBody.push(new THREE.Vector3(sx * (W / 2 + gt), gy1 - 0.006, sz * (D / 2 + gt)));
    }

  // wire beads along the inner edge of the front guards
  const front = frontMap(D / 2 + gt * 0.35 + gt / 2);
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - gw + 0.012);
    const p = new Path2().move(x, gy0 + 0.03).line(x, gy1 - 0.03);
    gold.push(...wire(p, front, taper.even(0.0042), { squash: 0.8 }));
    // small curl at the top and bottom of each guard
    for (const [yy, dir] of [[gy1 - 0.055, 1], [gy0 + 0.055, -1]] as const) {
      const cx = sx * (W / 2 - gw / 2 + 0.004);
      const c = new Path2();
      const a0 = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      c.spiral(cx, yy, 0.022, 0.006, a0, a0 + sx * dir * Math.PI * 2 * 1.15, false);
      gold.push(...wire(c, front, taper.curl(0.0045, 0.9), { squash: 0.8 }));
    }
  }

  // emblem: gold rhombus plate, obsidian field, raised frames, glowing gate slit
  const ez = D / 2 + 0.002, ex = 0, ey = 0.33;
  gold.push(rhombusPlate(ex, ey, 0.1, 0.13, ez, 0.006, 0.004));
  const field = rhombusPlate(ex, ey, 0.064, 0.088, ez + 0.006, 0.002, 0.002);
  obs.push(field);
  const efront = frontMap(ez + 0.012);
  gold.push(...wire(rhombus(ex, ey, 0.071, 0.096), efront, taper.even(0.0045), { squash: 0.9, beads: false }));
  gold.push(...wire(rhombus(ex, ey, 0.1, 0.13), frontMap(ez + 0.008), taper.even(0.004), { squash: 0.9, beads: false }));
  for (const [x, y] of [[0, ey + 0.142], [0, ey - 0.142], [0.112, ey], [-0.112, ey]]) {
    const s = new THREE.SphereGeometry(0.008, 10, 8);
    s.translate(x, y, ez + 0.006);
    gold.push(s);
  }
  seam.push(slitGeometry(ex, ey, 0.011, 0.062, ez + 0.0115));
  glintsBody.push(new THREE.Vector3(0, ey + 0.142, ez + 0.014), new THREE.Vector3(0.112, ey, ez + 0.014));

  // auspicious-cloud filigree on the front panel, mirrored: twin-horn cloud heads riding on tails that end in hooks
  const ff = frontMap(D / 2 + 0.001);
  const scrolls: Path2[] = [
    cloudHead(0.255, 0.375, 0.032, 0.036),
    tail(0.17, 0.315, 0.38, 0.018, 1),
    cloudHead(0.19, 0.236, 0.025, 0.028),
    tail(0.13, 0.19, 0.37, 0.015, 1),
    tail(0.15, 0.452, 0.36, 0.015, -1),
  ];
  for (const p of scrolls) {
    gold.push(...wire(p, ff, taper.curl(0.0056)));
    gold.push(...wire(p.mirrored(), ff, taper.curl(0.0056)));
  }
  {
    const p = new Path2().move(-0.36, 0.152).line(0.36, 0.152);
    gold.push(...wire(p, ff, taper.both(0.0045, 0.6)));
  }

  // side panels: a ring handle on a mount, and a small cloud on a tail
  for (const sx of [-1, 1]) {
    const sm = sideMap(W / 2 + 0.001, sx);
    const mount = rbox(0.02, 0.07, 0.11, 0.008, sx * (W / 2 + 0.01), 0.405, 0);
    gold.push(mount);
    const ring = new THREE.TorusGeometry(0.058, 0.0085, 8, 32);
    ring.rotateY(Math.PI / 2);
    ring.translate(sx * (W / 2 + 0.03), 0.405 - 0.058 + 0.008, 0);
    gold.push(ring);
    glintsBody.push(new THREE.Vector3(sx * (W / 2 + 0.034), 0.405 - 0.116 + 0.008, 0));
    gold.push(...wire(cloudHead(0, 0.232, 0.022, 0.024), sm, taper.curl(0.0052)));
    const tl = tail(0.0, 0.19, 0.19, 0.014, 1);
    gold.push(...wire(tl, sm, taper.curl(0.0052)), ...wire(tl.mirrored(), sm, taper.curl(0.0052)));
  }

  // glowing seam between rim and lid
  seam.push(...frame(W + 0.014, D + 0.014, DIM.seamY[0] - 0.002, DIM.seamY[1] + 0.001, 0.012, 0.002));

  // ---- lid (lid-local: base at y=0, centred on x/z)
  const lidGold: THREE.BufferGeometry[] = [];
  const lidObs: THREE.BufferGeometry[] = [];
  const lidOutl: THREE.BufferGeometry[] = [];
  const glintsLid: THREE.Vector3[] = [];
  const shellG = hollowLid();
  lidObs.push(shellG);
  lidOutl.push(shellG);
  const lip = frame(LID_W, LID_D, 0, DIM.lipH, 0.026, 0.011);
  lidGold.push(...lip);
  lidOutl.push(...lip);
  for (const sx of [-1, 1]) {
    const bx = sx * (LID_W / 2 - 0.05);
    lidGold.push(lidBand(bx, 0.075, 0.012));
    const top = lidPoint(bx, LID_ARC / 2, 0.012);
    glintsLid.push(top.clone().add(new THREE.Vector3(sx * 0.03, 0.002, 0.02)));
    // wire ridge along the band centre
    const p = new Path2(0.004).move(bx, 0.004).line(bx, LID_ARC - 0.004);
    lidGold.push(...wire(p, (x, y, h) => lidPoint(x, y, h + 0.012), taper.even(0.004), { beads: false }));
    glintsLid.push(new THREE.Vector3(sx * LID_W / 2, DIM.lipH, LID_D / 2));
  }
  // front of the lid: a small rhombus medallion, a line out to each side ending in a hook, a cloud head riding it
  const lm = (x: number, y: number, h: number) => lidPoint(x, y, h - 0.002);
  {
    lidGold.push(...wire(rhombus(0, 0.06, 0.05, 0.036), lm, taper.even(0.005), { beads: false }));
    lidGold.push(...wire(rhombus(0, 0.06, 0.024, 0.017), lm, taper.even(0.0042), { beads: false }));
    const s0 = new THREE.SphereGeometry(0.009, 10, 8);
    const c0 = lidPoint(0, 0.06, 0.004);
    s0.translate(c0.x, c0.y, c0.z);
    lidGold.push(s0);
    glintsLid.push(lidPoint(0, 0.06 + 0.036, 0.008));
    for (const path of [tail(0.058, 0.06, 0.37, 0.02, 1), cloudHead(0.21, 0.1, 0.021, 0.023), tail(0.27, 0.142, 0.4, 0.013, -1)]) {
      lidGold.push(...wire(path, lm, taper.curl(0.0055)));
      lidGold.push(...wire(path.mirrored(), lm, taper.curl(0.0055)));
    }
  }
  // lining on the concave inside of the lid: a gold frame, a rhombus and two clouds, seen when it stands open
  // (y runs up the open lid, so s = mid - y)
  {
    const um = (x: number, y: number, h: number) => lidInnerPoint(x, LID_ARC / 2 - y, h);
    const hw = LID_W / 2 - 0.08, hd = LID_ARC / 2 - 0.07;
    const fr = new Path2(0.004).move(-hw, -hd).line(hw, -hd).line(hw, hd).line(-hw, hd).line(-hw, -hd);
    lidGold.push(...wire(fr, um, taper.even(0.0045), { beads: false }));
    lidGold.push(...wire(rhombus(0, 0, 0.085, 0.07), um, taper.even(0.0048), { beads: false }));
    lidGold.push(...wire(rhombus(0, 0, 0.05, 0.04), um, taper.even(0.0038), { beads: false }));
    const h1 = cloudHead(0.26, 0.0, 0.03, 0.033);
    const t1 = tail(0.12, -0.045, 0.38, 0.016, 1);
    for (const p of [h1, t1]) lidGold.push(...wire(p, um, taper.curl(0.0052)), ...wire(p.mirrored(), um, taper.curl(0.0052)));
  }
  // top crest: a standing gold rhombus with a glowing gate slit, the chest's silhouette peak
  const lidSeam: THREE.BufferGeometry[] = [];
  {
    const top = lidPoint(0, LID_ARC / 2, 0);
    const cy = top.y + 0.045, hw = 0.042, hh = 0.062, th = 0.016;
    const crest = rhombusPlate(0, cy, hw, hh, -th / 2, th, 0.005);
    lidGold.push(crest);
    lidOutl.push(crest);
    const base = rbox(0.07, 0.02, 0.05, 0.008, 0, top.y + 0.004, 0);
    lidGold.push(base);
    for (const sgn of [1, -1]) {
      const slit = slitGeometry(0, cy, 0.0075, 0.04, sgn * (th / 2 + 0.0052));
      if (sgn < 0) slit.rotateY(Math.PI);
      lidSeam.push(slit);
      lidGold.push(...wire(rhombus(0, cy, hw * 0.62, hh * 0.62), frontMap(sgn * (th / 2 + 0.005)), taper.even(0.0032), { beads: false }));
    }
    glintsLid.push(new THREE.Vector3(0, cy + hh + 0.006, 0.006));
  }
  // front hasp: a gold tongue hanging from the lid lip over the seam
  {
    const s = new THREE.Shape();
    const hw = 0.038, y0 = DIM.lipH - 0.004, y1 = -0.052, tip = -0.078;
    s.moveTo(-hw, y0).lineTo(hw, y0).lineTo(hw, y1).lineTo(0, tip).lineTo(-hw, y1).lineTo(-hw, y0);
    const hz = LID_D / 2 + 0.002;
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 1 });
    g.translate(0, 0, hz);
    lidGold.push(g);
    lidOutl.push(g);
    const hm = frontMap(hz + 0.012);
    lidGold.push(...wire(new Path2(0.003).move(-hw + 0.012, y0 - 0.012).line(hw - 0.012, y0 - 0.012).line(hw - 0.012, y1 + 0.004).line(0, tip + 0.016).line(-hw + 0.012, y1 + 0.004).line(-hw + 0.012, y0 - 0.012), hm, taper.even(0.003), { beads: false }));
    const b = new THREE.SphereGeometry(0.009, 10, 8);
    b.translate(0, (y0 + y1) / 2 - 0.006, hz + 0.012);
    lidGold.push(b);
    glintsLid.push(new THREE.Vector3(0, tip + 0.004, hz + 0.012));
  }

  return {
    gold: merge(gold),
    obs: merge(obs),
    outl: outlineGeometry(merge(outl)),
    seam: merge(seam),
    lidGold: merge(lidGold),
    lidObs: merge(lidObs),
    lidOutl: outlineGeometry(merge(lidOutl)),
    lidSeam: merge(lidSeam),
    glintsBody,
    glintsLid,
  };
}

let geoCache: ReturnType<typeof buildGeometry> | null = null;

/** buildChest(stage) or buildChest({ stage, floor, bloomBase, fx }) */
export function buildChest(arg: Stage | ChestOpts = {}): Chest {
  const opts: ChestOpts = isStage(arg) ? { stage: arg } : arg;
  const stage = opts.stage;
  const fx = opts.fx !== false;
  const reduced = params.reduced;
  const u = chestUniforms();
  const G = (geoCache ??= buildGeometry());

  const group = new THREE.Group();
  group.name = 'chest';
  const rig = new THREE.Group();
  group.add(rig);

  const goldM = goldMaterial(u);
  const obsM = obsidianMaterial(u);
  const seamM = emissiveMaterial(u, new THREE.Color(1.0, 0.4, 0.03), 1);
  const outlineM = makeOutline(1.5, 0x020206);
  const lidOutlineM = makeOutline(1.5, 0x020206);
  for (const m of [outlineM, lidOutlineM]) m.uniforms.uRefDist.value = 3.2;

  rig.add(new THREE.Mesh(G.obs, obsM), new THREE.Mesh(G.gold, goldM), new THREE.Mesh(G.seam, seamM), new THREE.Mesh(G.outl, outlineM));

  const lidPivot = new THREE.Group();
  lidPivot.position.copy(HINGE);
  rig.add(lidPivot);
  const lid = new THREE.Group();
  lid.position.set(0, 0, LID_D / 2);
  lidPivot.add(lid);
  const lidGoldM = goldM;
  lid.add(new THREE.Mesh(G.lidObs, obsM), new THREE.Mesh(G.lidGold, lidGoldM), new THREE.Mesh(G.lidSeam, seamM), new THREE.Mesh(G.lidOutl, lidOutlineM));

  // light from inside
  const inner = interiorLight();
  rig.add(inner.mesh);
  const bulb = glowSprite(1.6, new THREE.Color(1.0, 0.42, 0.04), 2.4);
  bulb.mesh.position.set(0, 0.62, 0);
  rig.add(bulb.mesh);
  const keyGlow = glowSprite(0.2, new THREE.Color(1.0, 0.42, 0.04), 3.0);
  keyGlow.mesh.position.set(0, 0.33, DIM.D / 2 + 0.03);
  rig.add(keyGlow.mesh);
  const leak = leakRays();
  rig.add(leak.mesh);

  const column = lightColumn();
  column.group.position.set(0, DIM.rimY[1] - 0.01, 0);
  column.group.scale.set(1, 1, 0.8);
  rig.add(column.group);

  // particles
  const nMotes = reduced ? 18 : 46;
  const nStars = reduced ? 10 : 26;
  const motes = streaks(nMotes, MOTES_GLSL, { uCharge: { value: 0 }, uOpen: { value: 0 }, uShow: { value: 0 } }, 11);
  const nConv = reduced ? 10 : 30;
  const conv = streaks(nConv, CONVERGE_GLSL, { uCharge: { value: 0 } }, 23);
  const nSparks = reduced ? 20 : 56;
  const sparks = streaks(nSparks, SPARKS_GLSL, { uBurst: { value: -1 } }, 37, 'mix(G_WARM, G_CORE, 0.7) * 3.0');
  const nShards = reduced ? 14 : 30;
  const shard = shards(nShards, 51);
  const ring = shockRing();
  motes.uniforms.uDt.value = 1 / 80;
  conv.uniforms.uDt.value = 1 / 70;
  sparks.uniforms.uDt.value = 1 / 40;
  rig.add(motes.mesh, conv.mesh, sparks.mesh, shard.mesh, ring.mesh);
  const stars = risingStars(reduced ? 10 : 26, 71);
  stars.uniforms.uTw.value = reduced ? 0 : 1;
  rig.add(stars.mesh);
  const gB = glints(G.glintsBody, 61);
  rig.add(gB.mesh);
  const gL = glints(G.glintsLid, 67);
  lid.add(gL.mesh);
  // the burst throws a few falling stars, and one crimson feather of light drifts down out of the column
  const nFall = reduced ? 3 : 7;
  const fall = fallingStars(nFall, 83);
  rig.add(fall.mesh);
  const feather = lightFeather(0.27);
  group.add(feather.mesh);

  const floor = opts.floor === false ? null : floorFx();
  if (floor) group.add(floor.mesh);

  const state = { reveal: 0, charge: 0, open: 0, t: 0 };
  // bloom and flash are borrowed from the stage only inside the burst window; the values in force when the
  // window opens are restored when it closes (or on a seek out of it)
  let fxOwned = false;
  let bloomBase = 1.15;
  const flashColorPrev = new THREE.Color(1, 1, 1);
  const tmpM = new THREE.Matrix4();
  const resV = new THREE.Vector2();
  // seconds since the burst keep running after the lid animation (setOpen) clamps at 1
  let openT0 = NaN;
  const fw = new THREE.Vector3(), fd = new THREE.Vector3(), fg = new THREE.Vector3();

  /** The feather: born in the column, drifting out to the right and down above the reward window, rocking as it falls. */
  function poseFeather(since: number) {
    const FEATHER = { start: 0.3, dur: 3.8 };
    const tf = since - FEATHER.start;
    const on = since >= 0 && tf > 0 && tf < FEATHER.dur;
    feather.mesh.visible = on;
    if (!on) return;
    const u = tf / FEATHER.dur;
    const out = 1 - Math.pow(1 - Math.min(1, tf / 2.2), 3);
    const nx = 0.05 + 0.45 * out;
    const ny = 0.8 - 0.56 * u;
    const w = (Math.PI * 2) / 1.75;
    const amp = reduced ? 0.3 : 1;
    const cam = stage?.camera;
    group.updateMatrixWorld(true);
    fg.setFromMatrixPosition(group.matrixWorld);
    if (cam) {
      cam.updateMatrixWorld();
      fw.set(nx, ny, 0.5).unproject(cam);
      fd.copy(fw).sub(cam.position).normalize();
      const k = (fg.z + 0.35 - cam.position.z) / (Math.abs(fd.z) > 1e-4 ? fd.z : -1e-4);
      fw.copy(cam.position).addScaledVector(fd, k);
    } else {
      fw.set(fg.x + 0.6 * out, fg.y + 1.8 - 0.9 * u, fg.z + 0.35);
    }
    fw.x += 0.075 * amp * Math.sin(w * tf);
    fw.y += 0.025 * amp * Math.cos(2 * w * tf);
    feather.mesh.position.copy(group.worldToLocal(fw));
    feather.uniforms.uRoll.value = -1.05 + 0.42 * amp * Math.cos(w * tf + 0.4);
    // turn only a little: edge-on, a thin crimson line would read as a slash
    feather.uniforms.uTurn.value = reduced ? 1 : 0.92 + 0.08 * Math.cos(0.5 * w * tf + 1.0);
    feather.uniforms.uLevel.value = clamp(tf / 0.6) * (1 - clamp((tf - (FEATHER.dur - 0.9)) / 0.9)) * (0.92 + 0.08 * Math.sin(tf * 2.1));
  }

  function apply() {
    const T = CHEST_TIMING;
    const t = state.t;
    const rs = state.reveal * T.reveal;
    const os = state.open * T.open;
    const c = state.charge;
    const opened = state.open > 0;

    // ---- reveal: rise head-first out of the pool, then the seams ignite
    const riseP = clamp(rs / T.riseEnd);
    const rise = 1 - Math.pow(1 - riseP, 2.2);
    const H = 0.9;
    rig.position.set(0, -H * (1 - rise), 0);
    rig.rotation.set(0.07 * (1 - rise) * (1 - rise), 0, 0);
    const ign = state.reveal >= 1 ? 1 : ignition(clamp((rs - T.igniteAt) / T.ignite));
    const revealing = state.reveal < 1;
    group.updateMatrixWorld(true);
    u.uClipY.value = revealing ? group.matrixWorld.elements[13] : -100;
    u.uWet.value = revealing ? 1 - clamp((rs - 0.7) / 0.6) : 0;

    // ---- idle breath (0.25 Hz) and charge on the ignition curve
    const breath = 0.5 + 0.5 * Math.sin(Math.PI * 2 * 0.25 * t - Math.PI / 2);
    const ci = ignition(c);
    let seam = ign * (0.5 + 0.14 * breath) + ci * 1.0 + c * 0.2;
    const leakLvl = ci * 0.9 + c * 0.12;
    // charge: the lid lifts a crack and rattles, growing with charge
    let crack = (reduced ? 0.6 : 1) * 0.045 * ease.inCubic(clamp((c - 0.45) / 0.55));
    let rattleLid = 0, rattleBody = 0;
    if (!reduced && c > 0 && c < 0.999 && !opened) {
      const amp = c * c;
      const gate = 0.55 + 0.45 * Math.max(0, noise1(t * 3.1, 4));
      rattleLid = amp * gate * 0.02 * noise1(t * 31, 1);
      rattleBody = amp * gate * 0.008 * noise1(t * 27, 2);
    }

    // ---- open: lid spring, light column, interior
    const tb = os;
    let lidA = crack + rattleLid;
    let innerLvl = crack * 14 + ci * 0.15;
    let col = 0, grow = 0, colAmt = 0;
    if (opened) {
      lidA = crack * (1 - clamp(tb / 0.05)) + LID_OPEN * lidSpring(tb);
      innerLvl = 0.5;
      grow = ease.outExpo(clamp((tb - 0.02) / 0.6));
      const swell = tb < 0.12 ? tb / 0.12 : 1 + 0.35 * Math.exp(-(tb - 0.12) / 0.35);
      colAmt = swell * (0.92 + 0.08 * breath);
      col = clamp(tb / 0.2);
      seam = 0.4 + 1.2 * Math.exp(-tb / 0.22) + 0.06 * breath;
    }
    // glint sweep: once as the seams ignite, then a slow sheen pass every 7 s while idle
    let sweepK = -1, sweepAmt = 0;
    const ks = (rs - T.igniteAt - 0.1) / 0.6;
    if (state.reveal < 1 && ks > 0 && ks < 1) {
      sweepK = ks;
      sweepAmt = 1;
    } else if (state.reveal >= 1 && !opened) {
      const ph = ((t + 3.1) % 7) / 0.9;
      if (ph < 1) {
        sweepK = ph;
        sweepAmt = 0.45;
      }
    }
    u.uSweep.value = sweepK < 0 ? -10 : -0.75 + 1.75 * ease.inOutCubic(sweepK);
    u.uSweepAmt.value = sweepK < 0 ? 0 : sweepAmt * Math.sin(Math.PI * sweepK);
    lidPivot.rotation.x = -lidA;
    rig.rotation.z = rattleBody;

    u.uSeam.value = seam;
    u.uLeak.value = opened ? 0.1 : leakLvl;
    u.uInner.value = innerLvl;
    u.uColumn.value = col;
    u.uTime.value = t;
    seamM.uniforms.uLevel.value = seam * 4.2 * Math.min(1, ign * 1.4 + c);
    inner.uniforms.uLevel.value = Math.min(1, innerLvl * (opened ? 1.6 : 0.8));
    inner.uniforms.uTime.value = t;
    bulb.uniforms.uLevel.value = opened ? 0.55 * (0.55 + 0.45 * Math.exp(-tb / 0.2)) : ci * 0.35 + crack * 5;
    keyGlow.uniforms.uLevel.value = ign * (0.7 + 0.25 * breath) + ci * 1.6;
    leak.uniforms.uLevel.value = opened ? Math.max(0, 1 - tb / 0.12) * leakLvl : leakLvl * (reduced ? 0.6 : 1);
    leak.uniforms.uTime.value = t;
    column.uniforms.uAmt.value = colAmt;
    column.uniforms.uGrow.value = grow * 1.18;
    column.uniforms.uTime.value = t;

    // particles
    const show = ign;
    for (const s of [motes, conv, sparks]) s.uniforms.uTime.value = t;
    motes.uniforms.uShow.value = show;
    motes.uniforms.uCharge.value = opened ? 0 : c;
    motes.uniforms.uOpen.value = opened ? ease.inOutCubic(clamp(tb / 1.2)) : 0;
    conv.uniforms.uCharge.value = opened ? 0 : c;
    conv.mesh.visible = c > 0.05 && !opened;
    sparks.uniforms.uBurst.value = opened ? tb : -1;
    sparks.mesh.visible = opened && tb < 0.65;
    shard.pose(opened ? tb : -1);
    const rp = clamp(tb / 0.333);
    ring.mesh.visible = opened && tb < 0.4;
    ring.uniforms.uR.value = 0.12 + 0.82 * ease.outCubic(rp);
    ring.uniforms.uW.value = 0.008 + 0.018 * rp;
    ring.uniforms.uLevel.value = (1 - rp) * (1 - rp) * 2.0;

    stars.uniforms.uTime.value = t;
    stars.uniforms.uOpen.value = opened ? clamp((tb - 0.15) / 0.5) : 0;
    stars.mesh.visible = opened;
    let since = -1;
    if (opened) {
      if (os < T.open - 1e-6 || !Number.isFinite(openT0)) openT0 = t - os;
      since = Math.max(os, t - openT0);
    } else openT0 = NaN;
    fall.uniforms.uTb.value = since;
    fall.mesh.visible = opened && since < 2.3;
    poseFeather(since);
    gB.uniforms.uTime.value = t;
    gL.uniforms.uTime.value = t + 1.7;
    const glintRate = reduced ? 0.5 : 1 + c * 2.5;
    gB.uniforms.uRate.value = gL.uniforms.uRate.value = glintRate;
    gB.uniforms.uLevel.value = gL.uniforms.uLevel.value = ign * (opened ? 1.2 : 1);

    if (floor) {
      const f = floor.uniforms;
      f.uTime.value = t;
      const poolIn = clamp(rs / 0.25);
      const poolOut = clamp((rs - 1.35) / 0.55);
      f.uPool.value = state.reveal >= 1 ? 0 : ease.outCubic(poolIn) * (1 - ease.inOutCubic(poolOut));
      f.uPoolR.value = 0.6 + 0.55 * ease.outCubic(poolIn);
      f.uRipple.value = rs > 0.1 && revealing ? rs - 0.1 : 0;
      f.uContact.value = clamp(rs / 0.6);
      f.uGlow.value = ign * (0.16 + 0.05 * breath) + ci * 0.45 + (opened ? 0.3 + 0.35 * Math.exp(-tb / 0.4) : 0);
    }

    // stage hooks: bloom overshoot +15.6 % settling in 267 ms, and exactly one soft gold flash <= 60 %
    if (stage && fx) {
      const inWindow = opened && tb < 0.4;
      if (inWindow) {
        if (!fxOwned) {
          bloomBase = opts.bloomBase ?? stage.bloom.intensity;
          flashColorPrev.copy(stage.grade.u('flashColor').value as THREE.Color);
        }
        const k = tb < 0.05 ? tb / 0.05 : 1 - ease.outCubic(clamp((tb - 0.05) / 0.217));
        stage.bloom.intensity = bloomBase * (1 + 0.156 * k);
        const peak = reduced ? 0.05 : 0.075;
        const fl = tb < 0.033 ? tb / 0.033 : Math.exp(-(tb - 0.033) / 0.05);
        stage.grade.u('flashAmount').value = tb < 0.33 ? peak * fl : 0;
        (stage.grade.u('flashColor').value as THREE.Color).set(0xffbf5a);
        fxOwned = true;
      } else if (fxOwned) {
        stage.bloom.intensity = bloomBase;
        stage.grade.u('flashAmount').value = 0;
        (stage.grade.u('flashColor').value as THREE.Color).copy(flashColorPrev);
        fxOwned = false;
      }
    }

    group.updateMatrixWorld(true);
    tmpM.copy(rig.matrixWorld).invert();
    u.uRootInv.value.copy(tmpM);
  }

  const chest: Chest = {
    group,
    setReveal(p) {
      const prev = state.reveal;
      state.reveal = clamp(p);
      if (prev <= 0 && state.reveal > 0 && state.reveal * CHEST_TIMING.reveal < 0.2) chestSounds.rise?.();
      apply();
    },
    setCharge(c) {
      state.charge = clamp(c);
      apply();
    },
    setOpen(p) {
      const prev = state.open * CHEST_TIMING.open;
      state.open = clamp(p);
      const now = state.open * CHEST_TIMING.open;
      // visuals lead audio by 2 frames
      if (prev < 0.033 && now >= 0.033 && now < 0.3) chestSounds.burst?.();
      apply();
    },
    update(t) {
      state.t = t;
      if (stage) {
        const r = stage.renderer.getDrawingBufferSize(resV);
        for (const s of [motes, conv, sparks]) s.uniforms.uRes.value.copy(r);
        gB.uniforms.uRes.value.copy(r);
        stars.uniforms.uRes.value.copy(r);
        fall.uniforms.uRes.value.copy(r);
        gL.uniforms.uRes.value.copy(r);
        for (const m of [outlineM, lidOutlineM]) m.uniforms.uResolution.value.copy(r);
      }
      apply();
    },
    openingWorld(target = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      return target.set(0, 0.62, 0).applyMatrix4(rig.matrixWorld);
    },
    stats() {
      let calls = 0, tris = 0;
      group.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        calls++;
        const g = m.geometry as THREE.BufferGeometry;
        const n = g.index ? g.index.count : g.attributes.position.count;
        const inst = (g as THREE.InstancedBufferGeometry).instanceCount ?? (m as THREE.InstancedMesh).count ?? 1;
        tris += (n / 3) * (Number.isFinite(inst) ? inst : 1);
      });
      return { drawCalls: calls, triangles: Math.round(tris), particles: nMotes + nConv + nSparks + nShards + nStars + nFall + 1 };
    },
    dispose() {
      group.removeFromParent();
      // the chest geometry is cached for a fast replay; dispose only per-instance geometry and materials
      const cached = new Set<THREE.BufferGeometry>(Object.values(G).filter((v): v is THREE.BufferGeometry => v instanceof THREE.BufferGeometry));
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          if (!cached.has(m.geometry)) m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      if (stage && fxOwned) {
        stage.bloom.intensity = bloomBase;
        stage.grade.u('flashAmount').value = 0;
        (stage.grade.u('flashColor').value as THREE.Color).copy(flashColorPrev);
        fxOwned = false;
      }
    },
  };
  apply();
  return chest;
}
