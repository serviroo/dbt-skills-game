import * as THREE from 'three';
import type { ShadowId } from '../../content/roster-lines';
import { ball, jitter, limb, Parts, slab, sweep, xf, type Mats, type V3 } from './kit';

/**
 * The Night Watch as they stand in camp: original low-poly figures in the roster's look (deep navy, the Lantern's blue
 * rim, lit eyes), each built facing +z with its feet on y = 0. Parts merge by material, so a figure costs a few draws.
 */
export interface Figure {
  id: ShadowId;
  root: THREE.Group;
  /** the figure's own bounds, before it is placed */
  box: THREE.Box3;
  /** the figure at rest at time t (seconds): breathing, a wing settling, a banner already moves on its own */
  idle(t: number): void;
}

const TAU = Math.PI * 2;
const box = (w: number, h: number, d: number, p: V3, r?: V3) => xf(new THREE.BoxGeometry(w, h, d), { p, r });

/** Two eye slits in a visor, centred at x = 0. */
function slits(p: Parts, y: number, z: number, gap: number, w = 0.05, h = 0.014) {
  p.add('eye', box(w, h, 0.02, [-gap, y, z]), box(w, h, 0.02, [gap, y, z]));
}

/** A cape or cloak: a curved sheet hung around the back from the shoulders, open at the front by `open` radians. */
function drape(profile: [number, number][], open: number, depth: number) {
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    14,
    open / 2,
    TAU - open,
  );
  g.scale(1, 1, depth);
  return g;
}

/** Armoured legs from hips to sabatons. */
function legs(p: Parts, o: { hip: number; hipY: number; thigh: number; shin: number; spread?: number }) {
  const sp = o.spread ?? 0;
  for (const s of [-1, 1]) {
    const hip: V3 = [s * o.hip, o.hipY, 0];
    const knee: V3 = [s * (o.hip + 0.015 + sp * 0.5), o.hipY * 0.55, 0.035];
    const ankle: V3 = [s * (o.hip + sp), 0.1, 0];
    p.add('plate', limb(hip, knee, o.thigh, o.thigh * 0.8, 7), limb(knee, ankle, o.shin, o.shin * 0.75, 7));
    p.add('trim', ball(o.shin * 1.12, [knee[0], knee[1], knee[2] + o.shin * 0.55], [1, 0.8, 0.85]));
    p.add('leather', ball(o.shin * 1.15, [ankle[0], 0.055, 0.045], [0.85, 0.6, 1.6]));
  }
}

/** An arm from shoulder through elbow to a gauntlet. */
function arm(p: Parts, sh: V3, el: V3, hand: V3, r: number, cop = true) {
  p.add('plate', limb(sh, el, r, r * 0.88, 6), limb(el, hand, r * 0.88, r * 0.72, 6));
  if (cop) p.add('trim', ball(r * 1.05, el, [1, 0.85, 1]));
  p.add('leather', ball(r * 0.95, hand, [0.95, 1.05, 1.1]));
}

function done(id: ShadowId, p: Parts, m: Mats, idle: Figure['idle'] = () => {}, extra: THREE.Object3D[] = []): Figure {
  const root = p.build(m, id);
  if (extra.length) root.add(...extra);
  root.updateMatrixWorld(true);
  return { id, root, box: new THREE.Box3().setFromObject(root), idle };
}

/** a slow breath for a standing figure: about one every six seconds */
const breathe = (root: THREE.Group, phase: number, amt = 0.006) => (t: number) => {
  const k = Math.sin((t / 6.2) * TAU + phase);
  root.scale.set(1 - k * amt * 0.4, 1 + k * amt, 1 - k * amt * 0.4);
};

/** Sable, Captain of the Watch: a slender knight with a swept plume and a long cape, both hands on a planted sword. */
function sable(m: Mats): Figure {
  const p = new Parts();
  legs(p, { hip: 0.1, hipY: 0.9, thigh: 0.082, shin: 0.064 });
  p.add('plate', xf(new THREE.LatheGeometry([[0.001, 0.86], [0.17, 0.875], [0.19, 0.99], [0.215, 1.15], [0.232, 1.3], [0.2, 1.4], [0.1, 1.47], [0.001, 1.48]].map(([r, y]) => new THREE.Vector2(r, y)), 10), { s: [1, 1, 0.74] }));
  p.add('plate', xf(new THREE.LatheGeometry([[0.185, 0.93], [0.212, 0.8], [0.238, 0.66]].map(([r, y]) => new THREE.Vector2(r, y)), 10), { s: [1, 1, 0.8] }));
  p.add('cloth', xf(slab([[-0.12, 0], [0.12, 0], [0.105, -0.4], [0, -0.46], [-0.105, -0.4]], 0.02), { p: [0, 0.92, 0.16], r: [-0.06, 0, 0] }));
  p.add('trim', limb([-0.12, 1.3, 0.15], [0, 1.22, 0.172], 0.012, 0.012, 4), limb([0.12, 1.3, 0.15], [0, 1.22, 0.172], 0.012, 0.012, 4));
  p.add('leather', xf(new THREE.TorusGeometry(0.19, 0.024, 4, 14), { p: [0, 0.92, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.76, 1] }));
  p.add('trim', box(0.055, 0.05, 0.02, [0, 0.92, 0.15]));
  p.add('plate', limb([0, 1.44, 0], [0, 1.56, 0.005], 0.07, 0.064, 7));
  for (const s of [-1, 1]) {
    p.add('plate', ball(0.118, [s * 0.25, 1.37, 0], [1.12, 0.74, 1.05]));
    p.add('trim', ball(0.1, [s * 0.275, 1.31, 0.005], [1.05, 0.55, 1]));
    arm(p, [s * 0.26, 1.33, 0], [s * 0.25, 1.08, 0.09], [s * 0.055, 0.945, 0.255], 0.056);
    p.add('trim', ball(0.026, [s * 0.2, 1.4, 0.1]));
  }
  // the planted sword
  p.add('steel', xf(slab([[0, 0], [0.03, 0.09], [0.03, 0.8], [-0.03, 0.8], [-0.03, 0.09]], 0.012), { p: [0, 0.01, 0.27] }));
  p.add('trim', box(0.27, 0.032, 0.04, [0, 0.825, 0.27]), ball(0.032, [0, 0.995, 0.27]));
  p.add('leather', limb([0, 0.84, 0.27], [0, 0.975, 0.27], 0.019, 0.019, 6));
  // helm, visor and plume
  p.add('plate', ball(0.13, [0, 1.625, 0.01], [0.93, 1.08, 1.03]));
  p.add('visor', box(0.2, 0.045, 0.06, [0, 1.622, 0.098]));
  p.add('trim', limb([0, 1.53, 0.127], [0, 1.735, 0.112], 0.011, 0.009, 4));
  slits(p, 1.623, 0.13, 0.046);
  p.add('plume', sweep([[0, 1.73, 0.03], [0, 1.83, -0.02], [0, 1.875, -0.13], [0, 1.82, -0.28], [0, 1.68, -0.36]], 0.05, 0.012, 6, 14));
  p.add('cape', drape([[0.2, 1.43], [0.255, 1.32], [0.3, 1.02], [0.345, 0.6], [0.385, 0.08]], Math.PI * 0.95, 0.8));
  const f = done('sable', p, m);
  f.idle = breathe(f.root, 0.3);
  return f;
}

/** Anvil, the heavy knight: broad plate, a great helm, a tall heater shield resting on the ground and a mace. */
function anvil(m: Mats): Figure {
  const p = new Parts();
  legs(p, { hip: 0.125, hipY: 0.88, thigh: 0.1, shin: 0.08, spread: 0.03 });
  p.add('plate', xf(new THREE.LatheGeometry([[0.001, 0.85], [0.21, 0.87], [0.25, 0.99], [0.285, 1.17], [0.305, 1.32], [0.26, 1.44], [0.13, 1.51], [0.001, 1.52]].map(([r, y]) => new THREE.Vector2(r, y)), 10), { s: [1, 1, 0.78] }));
  p.add('plate', xf(new THREE.LatheGeometry([[0.235, 0.94], [0.27, 0.78], [0.305, 0.62]].map(([r, y]) => new THREE.Vector2(r, y)), 10), { s: [1, 1, 0.84] }));
  p.add('trim', xf(new THREE.TorusGeometry(0.255, 0.018, 4, 14), { p: [0, 1.1, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.8, 1] }));
  p.add('leather', xf(new THREE.TorusGeometry(0.24, 0.03, 4, 14), { p: [0, 0.93, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.8, 1] }));
  for (const s of [-1, 1]) {
    p.add('plate', ball(0.16, [s * 0.33, 1.4, 0], [1.12, 0.78, 1.12]));
    p.add('trim', ball(0.14, [s * 0.35, 1.33, 0], [1.08, 0.5, 1.05]));
    p.add('trim', limb([s * 0.22, 1.5, -0.04], [s * 0.44, 1.42, -0.02], 0.016, 0.012, 4));
  }
  arm(p, [-0.34, 1.36, 0], [-0.39, 1.08, 0.03], [-0.36, 0.85, 0.09], 0.07);
  arm(p, [0.34, 1.36, 0], [0.43, 1.1, 0.1], [0.37, 0.98, 0.25], 0.07);
  // the mace, hanging from the right hand
  p.add('wood', limb([-0.36, 0.97, 0.1], [-0.36, 0.42, 0.13], 0.02, 0.02, 6));
  p.add('iron', ball(0.068, [-0.36, 0.38, 0.13], [1, 1.2, 1], 0));
  for (let i = 0; i < 4; i++) p.add('iron', box(0.012, 0.11, 0.06, [-0.36, 0.38, 0.13], [0, (i * Math.PI) / 4, 0]));
  // the shield, its foot on the ground
  const shield: [number, number][] = [[-0.25, 0.32], [0.25, 0.32], [0.25, -0.04], [0.17, -0.27], [0, -0.42], [-0.17, -0.27], [-0.25, -0.04]];
  const sp: V3 = [0.42, 0.74, 0.3];
  const sr: V3 = [-0.12, -0.42, 0];
  p.add('plate', xf(slab(shield, 0.05, 0.012), { p: sp, r: sr }));
  p.add('trim', xf(slab(shield.map(([x, y]) => [x * 1.06, y * 1.04 + 0.002]), 0.03, 0, [shield.map(([x, y]) => [x * 0.94, y * 0.95])]), { p: sp, r: sr }));
  p.add('trim', xf(box(0.04, 0.5, 0.02, [0, -0.05, 0.04]), { p: sp, r: sr }), xf(box(0.34, 0.04, 0.02, [0, 0.12, 0.04]), { p: sp, r: sr }));
  // great helm
  p.add('plate', limb([0, 1.5, 0], [0, 1.56, 0], 0.08, 0.08, 7));
  p.add('plate', xf(new THREE.LatheGeometry([[0.001, 1.545], [0.135, 1.55], [0.145, 1.64], [0.138, 1.75], [0.1, 1.8], [0.001, 1.81]].map(([r, y]) => new THREE.Vector2(r, y)), 9), { s: [1, 1, 0.95] }));
  p.add('visor', box(0.25, 0.04, 0.05, [0, 1.665, 0.117]));
  p.add('trim', box(0.27, 0.024, 0.03, [0, 1.628, 0.128]), box(0.026, 0.2, 0.03, [0, 1.6, 0.135]));
  slits(p, 1.666, 0.138, 0.055, 0.06, 0.016);
  p.add('cape', drape([[0.25, 1.46], [0.3, 1.3], [0.33, 0.95], [0.36, 0.55]], Math.PI * 1.15, 0.78));
  const f = done('anvil', p, m);
  f.idle = breathe(f.root, 1.7, 0.005);
  return f;
}

/** Bramble, a bear, mostly asleep: lying low with his chin on his front paws. Lies along x, his head to +x. */
function bramble(m: Mats): Figure {
  const p = new Parts();
  const fur = (r: number, at: V3, s: V3, seed: number) => jitter(ball(r, at, s, r > 0.15 ? 2 : 1), r * 0.035, seed);
  p.add('fur', fur(0.5, [-0.02, 0.33, 0.02], [1.3, 0.66, 0.84], 3));
  p.add('fur', fur(0.3, [0.32, 0.5, 0.02], [1.15, 0.78, 1.05], 5));
  p.add('fur', fur(0.37, [-0.5, 0.36, 0.02], [1, 0.95, 1.02], 7));
  p.add('fur', limb([0.44, 0.46, 0.03], [0.76, 0.36, 0.05], 0.21, 0.18, 7));
  p.add('fur', fur(0.25, [0.9, 0.34, 0.05], [1.1, 0.9, 0.98], 9));
  p.add('fur', limb([1.02, 0.3, 0.05], [1.25, 0.25, 0.05], 0.12, 0.075, 7));
  p.add('leather', ball(0.046, [1.27, 0.26, 0.05], [0.9, 0.8, 1.2]));
  p.add('fur', fur(0.09, [0.84, 0.56, -0.1], [0.55, 0.95, 0.95], 13), fur(0.09, [0.84, 0.56, 0.2], [0.55, 0.95, 0.95], 15));
  for (const z of [-0.15, 0.24]) {
    p.add('fur', limb([0.6, 0.15, z], [0.98, 0.08, z + 0.01], 0.115, 0.1, 7));
    p.add('fur', fur(0.11, [1.03, 0.065, z + 0.01], [1.25, 0.6, 1.05], 17 + z * 10));
  }
  p.add('fur', fur(0.2, [-0.6, 0.15, 0.33], [1.35, 0.68, 0.8], 21));
  p.add('fur', fur(0.06, [-0.88, 0.42, 0.02], [1, 1, 1], 23));
  // closed eyes, a faint lit line each
  p.add('eyeSoft', box(0.012, 0.01, 0.06, [1.07, 0.4, -0.05], [0.3, 0, 0]), box(0.012, 0.01, 0.06, [1.07, 0.4, 0.15], [-0.3, 0, 0]));
  const f = done('bramble', p, m);
  f.idle = (t) => {
    const k = Math.sin((t / 7.5) * TAU);
    f.root.scale.set(1 + k * 0.006, 1 + k * 0.022, 1 + k * 0.012);
  };
  return f;
}

/** One of Vesper's wings, from its root out along +x (or -x), folded half open. */
function wing(side: 1 | -1, m: Mats) {
  const w = new Parts();
  const X = (pts: [number, number][]) => pts.map(([x, y]) => [x * side, y] as [number, number]);
  const edge: [number, number][] = [[0, 0], [0.26, 0.2], [0.55, 0.32], [0.72, 0.24]];
  const fingers: [number, number][] = [[0.6, 0.02], [0.47, -0.16], [0.3, -0.24], [0.12, -0.18]];
  w.add('membrane', slab(X([[0, 0], ...edge.slice(1), [0.66, 0.12], fingers[0], [0.52, -0.04], fingers[1], [0.38, -0.08], fingers[2], [0.22, -0.1], fingers[3], [0.04, -0.12]]), 0.01));
  w.add('horn', sweep(edge.map(([x, y]) => [x * side, y, 0.008] as V3), 0.024, 0.007, 5, 10));
  for (const [x, y] of fingers) w.add('horn', limb([0.26 * side, 0.2, 0.006], [x * side, y, 0.006], 0.011, 0.004, 4));
  const g = w.build(m, `vesper-wing${side}`);
  g.position.set(0.09 * side, 0.62, -0.05);
  g.rotation.set(0.28, -0.95 * side, 0.42 * side);
  return g;
}

/** Vesper, the sky escort: a small night drake perched on a rock, wings half folded, tail hanging down its side. */
function vesper(m: Mats): Figure {
  const p = new Parts();
  p.add('fur', ball(0.16, [0, 0.43, 0], [0.9, 1.35, 1]));
  p.add('fur', limb([0, 0.55, 0.03], [0, 0.78, 0.09], 0.1, 0.058, 7));
  p.add('fur', ball(0.09, [0, 0.845, 0.1], [0.92, 0.9, 1.25]));
  p.add('fur', limb([0, 0.835, 0.16], [0, 0.805, 0.27], 0.05, 0.018, 6));
  for (const s of [-1, 1]) {
    p.add('horn', sweep([[s * 0.04, 0.9, 0.07], [s * 0.075, 1.0, 0.02], [s * 0.085, 1.07, -0.07]], 0.022, 0.004, 5, 8));
    p.add('fur', limb([s * 0.08, 0.34, 0.02], [s * 0.085, 0.07, 0.07], 0.045, 0.03, 6));
    p.add('horn', ball(0.035, [s * 0.085, 0.04, 0.1], [1, 0.6, 1.5], 0));
    p.add('eye', ball(0.016, [s * 0.042, 0.865, 0.175], [1, 0.75, 0.7], 0));
  }
  p.add('fur', sweep([[0, 0.3, -0.1], [0, 0.14, -0.25], [0.06, -0.02, -0.3], [0.13, -0.2, -0.24], [0.16, -0.36, -0.1]], 0.05, 0.01, 6, 14));
  p.add('horn', xf(slab([[0, 0.06], [0.05, -0.02], [0, -0.04], [-0.05, -0.02]], 0.01), { p: [0.165, -0.39, -0.08], r: [0, 0.6, 0] }));
  const wl = wing(-1, m);
  const wr = wing(1, m);
  const f = done('vesper', p, m, () => {}, [wl, wr]);
  f.idle = (t) => {
    const k = Math.sin((t / 8) * TAU);
    wl.rotation.z = -0.42 - k * 0.05;
    wr.rotation.z = 0.42 + k * 0.05;
  };
  return f;
}

/** Crest, the Watch emblem, on its banner: a pole and crossbar, the cloth swaying, the emblem stitched in light. */
function crest(m: Mats): Figure {
  const p = new Parts();
  p.add('wood', limb([0, 0, 0], [0, 2.72, 0], 0.036, 0.03, 7));
  p.add('trim', ball(0.055, [0, 2.79, 0], [0.8, 1.5, 0.8], 0), ball(0.045, [0, 0.06, 0], [1.2, 0.6, 1.2], 0));
  p.add('wood', limb([-0.45, 2.53, 0.035], [0.45, 2.53, 0.035], 0.02, 0.02, 6));
  p.add('trim', ball(0.03, [-0.46, 2.53, 0.035], [1, 1, 1], 0), ball(0.03, [0.46, 2.53, 0.035], [1, 1, 1], 0));
  const cloth: [number, number][] = [[-0.4, 0], [0.4, 0], [0.4, -1.12], [0.2, -1.22], [0, -1.36], [-0.2, -1.22], [-0.4, -1.12]];
  p.add('banner', xf(slab(cloth, 0.016), { p: [0, 2.51, 0.06] }));
  // the emblem: a six-sided crest, a small crown inside it, a point of light above
  const hex = (k: number): [number, number][] => [[0, 0.3], [0.25, 0.17], [0.25, -0.17], [0, -0.3], [-0.25, -0.17], [-0.25, 0.17]].map(([x, y]) => [x * k, y * k]);
  p.add('bannerTrim', xf(slab(hex(0.86), 0.012, 0, [hex(0.74)]), { p: [0, 1.82, 0.075] }));
  p.add('bannerTrim', xf(slab(hex(0.66), 0.006, 0, [hex(0.6)]), { p: [0, 1.82, 0.072] }));
  p.add('bannerGlow', xf(slab([[-0.12, -0.09], [-0.12, 0.05], [-0.06, -0.01], [0, 0.11], [0.06, -0.01], [0.12, 0.05], [0.12, -0.09]], 0.008), { p: [0, 1.79, 0.078] }));
  p.add('bannerGlow', xf(slab([[0, 0.045], [0.03, 0], [0, -0.045], [-0.03, 0]], 0.008), { p: [0, 1.98, 0.078] }));
  p.add('bannerTrim', box(0.8, 0.02, 0.02, [0, 1.48, 0.075]));
  return done('crest', p, m);
}

/** The Unlisted: made of cubes, sitting on a log as if it had always been there. */
function block(m: Mats): Figure {
  const p = new Parts();
  p.add('wood', xf(limb([-0.32, 0.13, 0], [0.32, 0.13, 0], 0.13, 0.12, 9), {}));
  p.add('woodEnd', xf(new THREE.CircleGeometry(0.13, 9), { p: [0.321, 0.13, 0], r: [0, Math.PI / 2, 0] }), xf(new THREE.CircleGeometry(0.12, 9), { p: [-0.321, 0.13, 0], r: [0, -Math.PI / 2, 0] }));
  const c = (s: number | V3, at: V3, r: V3 = [0, 0, 0]) => p.add('cube', xf(new THREE.BoxGeometry(...(typeof s === 'number' ? ([s, s, s] as V3) : s)), { p: at, r }));
  c([0.2, 0.22, 0.16], [0, 0.375, 0], [0, 0.05, 0]);
  c(0.19, [0.01, 0.6, 0.01], [0.03, -0.12, 0.06]);
  c([0.07, 0.17, 0.07], [-0.135, 0.38, 0.04], [0.3, 0, 0.18]);
  c([0.07, 0.17, 0.07], [0.135, 0.38, 0.05], [0.4, 0, -0.14]);
  c([0.08, 0.08, 0.2], [-0.055, 0.29, 0.15]);
  c([0.08, 0.08, 0.2], [0.055, 0.29, 0.15]);
  c([0.08, 0.17, 0.08], [-0.055, 0.17, 0.27]);
  c([0.08, 0.17, 0.08], [0.055, 0.17, 0.27]);
  c(0.06, [0.07, 0.72, -0.01], [0.2, 0.4, 0.3]);
  p.add('eye', xf(box(0.04, 0.03, 0.01, [-0.045, 0.61, 0.104]), { r: [0.03, -0.12, 0.06] }), xf(box(0.04, 0.03, 0.01, [0.045, 0.61, 0.104]), { r: [0.03, -0.12, 0.06] }));
  const f = done('block', p, m);
  f.idle = (t) => {
    // every so often it tilts its head, the one thing it does quickly enough to notice
    const k = Math.sin((t / 11) * TAU);
    f.root.rotation.z = k * 0.012;
  };
  return f;
}

/** Harrow, the grand marshal: tall, in a long cloak with a fur mantle, a horned helm and a planted halberd. */
function harrow(m: Mats): Figure {
  const p = new Parts();
  legs(p, { hip: 0.11, hipY: 0.98, thigh: 0.085, shin: 0.066 });
  p.add('plate', xf(new THREE.LatheGeometry([[0.001, 0.94], [0.18, 0.96], [0.205, 1.08], [0.23, 1.26], [0.245, 1.42], [0.21, 1.52], [0.1, 1.59], [0.001, 1.6]].map(([r, y]) => new THREE.Vector2(r, y)), 10), { s: [1, 1, 0.74] }));
  p.add('cloth', xf(new THREE.LatheGeometry([[0.2, 1.02], [0.235, 0.82], [0.27, 0.5], [0.3, 0.22]].map(([r, y]) => new THREE.Vector2(r, y)), 10), { s: [1, 1, 0.82] }));
  p.add('leather', xf(new THREE.TorusGeometry(0.2, 0.026, 4, 14), { p: [0, 1.0, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.76, 1] }));
  p.add('trim', box(0.07, 0.06, 0.02, [0, 1.0, 0.16]));
  p.add('trim', limb([-0.13, 1.44, 0.16], [0, 1.33, 0.185], 0.013, 0.013, 4), limb([0.13, 1.44, 0.16], [0, 1.33, 0.185], 0.013, 0.013, 4));
  p.add('fur', jitter(xf(new THREE.TorusGeometry(0.21, 0.085, 6, 16), { p: [0, 1.56, -0.01], r: [Math.PI / 2, 0, 0], s: [1.15, 0.85, 1] }), 0.012, 31));
  for (const s of [-1, 1]) p.add('plate', ball(0.12, [s * 0.27, 1.5, 0], [1.12, 0.72, 1.05]));
  arm(p, [-0.28, 1.46, 0], [-0.38, 1.22, 0.06], [-0.43, 1.28, 0.16], 0.058);
  arm(p, [0.28, 1.46, 0], [0.31, 1.2, 0.06], [0.2, 1.03, 0.15], 0.058);
  // the halberd
  p.add('wood', limb([-0.43, 0, 0.17], [-0.43, 2.3, 0.17], 0.021, 0.019, 6));
  p.add('steel', xf(slab([[0, 0.12], [0.2, 0.17], [0.24, 0.02], [0.2, -0.13], [0, -0.06]], 0.012), { p: [-0.43, 2.06, 0.17], r: [0, -0.5, 0] }));
  p.add('steel', xf(slab([[0, 0], [0.02, 0.04], [0, 0.22], [-0.02, 0.04]], 0.012), { p: [-0.43, 2.27, 0.17] }));
  p.add('trim', ball(0.03, [-0.43, 1.96, 0.17], [1, 0.6, 1], 0));
  // helm and horns
  p.add('plate', limb([0, 1.58, 0], [0, 1.66, 0.005], 0.07, 0.066, 7));
  p.add('plate', ball(0.13, [0, 1.75, 0.01], [0.95, 1.1, 1.03]));
  p.add('visor', box(0.2, 0.04, 0.06, [0, 1.745, 0.098]));
  slits(p, 1.746, 0.13, 0.046);
  for (const s of [-1, 1]) p.add('horn', sweep([[s * 0.09, 1.82, 0], [s * 0.19, 1.92, -0.02], [s * 0.22, 2.06, -0.07], [s * 0.18, 2.17, -0.12]], 0.036, 0.006, 6, 12));
  p.add('cloak', drape([[0.22, 1.56], [0.29, 1.42], [0.35, 1.02], [0.41, 0.52], [0.46, 0.04]], Math.PI * 0.62, 0.82));
  const f = done('harrow', p, m);
  f.idle = breathe(f.root, 2.4, 0.005);
  return f;
}

export const FIGURES: Record<ShadowId, (m: Mats) => Figure> = { sable, anvil, bramble, vesper, crest, block, harrow };
