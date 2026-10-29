import * as THREE from 'three';
import type { ShadowId } from '../../content/roster-lines';
import { ball, grained, limb, Parts, RIM, slab, xf, type Mats } from './kit';
import { watchModel } from './models';

/**
 * The Night Watch as they stand in camp, in the roster's look (deep navy, the Lantern's blue rim, lit eyes), each built
 * facing +z with its feet on y = 0. The watchers are modelled and textured in Blender (./models); the Watch's banner is
 * built here. A figure costs a few draws.
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
const box = (w: number, h: number, d: number, p: [number, number, number]) => xf(new THREE.BoxGeometry(w, h, d), { p });

function done(id: ShadowId, root: THREE.Group, idle: Figure['idle'] = () => {}): Figure {
  root.updateMatrixWorld(true);
  return { id, root, box: new THREE.Box3().setFromObject(root), idle };
}

/** a slow breath for a standing figure: about one every six seconds */
const breathe = (root: THREE.Group, phase: number, amt = 0.006) => (t: number) => {
  const k = Math.sin((t / 6.2) * TAU + phase);
  root.scale.set(1 - k * amt * 0.4, 1 + k * amt, 1 - k * amt * 0.4);
};

/** How a cape hangs and sways: from its top (y) down `len`, `amp` at the hem. */
type Wave = { top: number; len: number; amp: number; speed: number; mode: 'hang' };
const CAPES: Partial<Record<ShadowId, Wave>> = {
  sable: { top: 1.45, len: 1.4, amp: 0.035, speed: 0.9, mode: 'hang' },
  anvil: { top: 1.48, len: 1.0, amp: 0.03, speed: 0.9, mode: 'hang' },
  harrow: { top: 1.58, len: 1.55, amp: 0.025, speed: 0.75, mode: 'hang' },
};

/**
 * A copy of a watcher's model in the camp's light: its own textures under the Lantern's blue rim, the cape swaying, the
 * eyes lit. The copy shares the loaded geometry and textures; its materials are its own.
 */
function model(id: ShadowId, m: Mats, rim = 0.22): THREE.Group {
  const root = new THREE.Group();
  root.name = id;
  const made = new Map<THREE.Material, THREE.Material>();
  for (const child of watchModel(id).children) root.add(child.clone(true));
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const was = mesh.material as THREE.MeshStandardMaterial;
    let now = made.get(was);
    if (!now) {
      const cape = was.name.endsWith('-cape') ? CAPES[id] : undefined;
      now =
        was.name === 'eye'
          ? m.eye
          : was.name === 'eyeSoft'
            ? m.eyeSoft
            : grained(
                {
                  color: 0xffffff,
                  map: was.map,
                  normalMap: was.normalMap,
                  normalScale: was.normalScale,
                  roughnessMap: was.roughnessMap,
                  metalnessMap: was.metalnessMap,
                  roughness: 1,
                  // without an environment to reflect, full metal reads black: the fire's light shows the plate's grain
                  metalness: 0.7,
                  flatShading: false,
                  side: cape ? THREE.DoubleSide : THREE.FrontSide,
                },
                { scale: [1, 1, 1], color: 0, rough: 0, rim: RIM, rimStrength: rim, rimPow: 2.8 },
                cape,
              );
      made.set(was, now);
    }
    mesh.material = now;
  });
  return root;
}

/** Sable, Captain of the Watch: a slender knight with a swept plume and a long cape, both hands on a planted sword. */
function sable(m: Mats): Figure {
  const root = model('sable', m);
  return done('sable', root, breathe(root, 0.3));
}

/** Anvil, the heavy knight: broad plate, a great helm, a tall heater shield resting on the ground and a mace. */
function anvil(m: Mats): Figure {
  const root = model('anvil', m);
  return done('anvil', root, breathe(root, 1.7, 0.005));
}

/** Bramble, a bear, mostly asleep: lying low with his chin on his front paws. Lies along x, his head to +x. */
function bramble(m: Mats): Figure {
  const root = model('bramble', m, 0.26);
  return done('bramble', root, (t) => {
    const k = Math.sin((t / 7.5) * TAU);
    root.scale.set(1 + k * 0.006, 1 + k * 0.022, 1 + k * 0.012);
  });
}

/** Vesper, the sky escort: a small night drake perched on a rock, wings half folded, tail hanging down its side. */
function vesper(m: Mats): Figure {
  const root = model('vesper', m, 0.26);
  // each wing turns about its root at the shoulder, folded half open
  const wings = ([-1, 1] as const).map((side) => {
    const w = root.getObjectByName(`vesper-wing${side}`)!;
    w.position.set(0.09 * side, 0.62, -0.05);
    w.rotation.set(0.28, -0.95 * side, 0.42 * side);
    return w;
  });
  return done('vesper', root, (t) => {
    const k = Math.sin((t / 8) * TAU);
    wings[0].rotation.z = -0.42 - k * 0.05;
    wings[1].rotation.z = 0.42 + k * 0.05;
  });
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
  return done('crest', p.build(m, 'crest'));
}

/** The Unlisted: made of cubes, sitting on a log as if it had always been there. */
function block(m: Mats): Figure {
  const root = model('block', m, 0.26);
  return done('block', root, (t) => {
    // every so often it tilts its head, the one thing it does quickly enough to notice
    const k = Math.sin((t / 11) * TAU);
    root.rotation.z = k * 0.012;
  });
}

/** Harrow, the grand marshal: tall, in a long cloak with a fur mantle, a horned helm and a planted halberd. */
function harrow(m: Mats): Figure {
  const root = model('harrow', m);
  return done('harrow', root, breathe(root, 2.4, 0.005));
}

export const FIGURES: Record<ShadowId, (m: Mats) => Figure> = { sable, anvil, bramble, vesper, crest, block, harrow };
