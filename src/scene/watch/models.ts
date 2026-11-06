import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { siteUrl } from '../../core/base';

/**
 * The watchers as modelled in Blender (scripts/build-watch.py, packed by scripts/build-watch.mjs): one node each in
 * public/models/watch.glb, holding the body with its texture set, the cape that sways, the lit eyes, and Vesper's
 * wings as their own nodes. Loaded once a visit, before the first camp is built; a failed load is tried again the next
 * time the camp opens.
 */
let nodes: Map<string, THREE.Object3D> | null = null;

/** Where each part of each watcher sits once loaded, in its figure's space, as min and max x, y, z: for the E2E checks. */
interface WatchHook {
  parts: Record<string, number[]>;
}
const hook: WatchHook = ((window as unknown as { __watch?: WatchHook }).__watch ??= { parts: {} });

export function loadOnce(load: () => Promise<void>): () => Promise<void> {
  let loading: Promise<void> | null = null;
  return () =>
    (loading ??= load()
      // a throw while settling the parts counts as a failed load too, so the next camp tries again
      .catch((err: unknown) => {
        loading = null;
        throw err;
      }));
}

export async function loadFigures(
  file: string,
  boxes: Record<string, number[]>,
  figures = (scene: THREE.Object3D) => scene.children,
): Promise<THREE.Object3D[]> {
  const g = await new GLTFLoader().loadAsync(siteUrl(file));
  g.scene.updateMatrixWorld(true);
  const made = new Map<string, THREE.BufferGeometry>();
  const box = new THREE.Box3();
  const figs = figures(g.scene);
  for (const fig of figs) {
    for (const part of fig.children) {
      settle(part, made);
      part.updateMatrixWorld(true);
      box.setFromObject(part);
      boxes[part.name] = [...box.min.toArray(), ...box.max.toArray()];
    }
  }
  return figs;
}

export const loadWatch = loadOnce(async () => {
  const figs = await loadFigures('models/watch.glb', hook.parts);
  nodes = new Map(figs.map((c) => [c.name, c]));
});

/**
 * The file's positions are quantized, each part scaled back into place by its node. That goes into a copy of the
 * geometry here, once, so every part sits at its figure's origin: a cape sways by its height in the figure (./kit) and
 * a wing turns about the root the camp gives it (./figures). The packer merges identical quantized geometry, so two
 * figures can share one in different places (the knights' eyes): each place gets its own copy, made once.
 */
function settle(part: THREE.Object3D, made: Map<string, THREE.BufferGeometry>) {
  part.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const key = `${mesh.geometry.uuid} ${mesh.matrixWorld.elements.join(' ')}`;
    let geo = made.get(key);
    if (!geo) {
      geo = mesh.geometry.clone();
      const p = geo.getAttribute('position');
      const f = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) f.set([p.getX(i), p.getY(i), p.getZ(i)], i * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
      geo.applyMatrix4(mesh.matrixWorld);
      made.set(key, geo);
    }
    mesh.geometry = geo;
  });
  part.traverse((o) => {
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
  });
}

/** One watcher's node as loaded: shared by every camp, so it is copied, never changed. */
export function watchModel(id: string): THREE.Object3D {
  const n = nodes?.get(id);
  if (!n) throw new Error(`the camp's models have no ${id}`);
  return n;
}
