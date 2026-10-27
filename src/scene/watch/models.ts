import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { siteUrl } from '../../core/base';

/**
 * The watchers as modelled in Blender (scripts/build-watch.py, packed by scripts/build-watch.mjs): one node each in
 * public/models/watch.glb, holding the body with its texture set, the cape that sways, the lit eyes, and Vesper's
 * wings as their own nodes. Loaded once a visit, before the first camp is built; a failed load is tried again the next
 * time the camp opens.
 */
let loading: Promise<void> | null = null;
let nodes: Map<string, THREE.Object3D> | null = null;

export function loadWatch(): Promise<void> {
  loading ??= new GLTFLoader().loadAsync(siteUrl('models/watch.glb')).then(
    (g) => {
      g.scene.updateMatrixWorld(true);
      const done = new Set<THREE.BufferGeometry>();
      for (const fig of g.scene.children) for (const part of fig.children) settle(part, done);
      nodes = new Map(g.scene.children.map((c) => [c.name, c]));
    },
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

/**
 * The file's positions are quantized, each part scaled back into place by its node. That goes into the geometry here,
 * once, so every part sits at its figure's origin: a cape sways by its height in the figure (./kit) and a wing turns
 * about the root the camp gives it (./figures).
 */
function settle(part: THREE.Object3D, done: Set<THREE.BufferGeometry>) {
  part.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // a geometry two parts share (the packer merges identical ones) is moved once, by the same dequantizing transform
    if (!mesh.isMesh || done.has(mesh.geometry)) return;
    done.add(mesh.geometry);
    const geo = mesh.geometry;
    const p = geo.getAttribute('position');
    const f = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) f.set([p.getX(i), p.getY(i), p.getZ(i)], i * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
    geo.applyMatrix4(mesh.matrixWorld);
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
