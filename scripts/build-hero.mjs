/**
 * Puts the Wanderer that scripts/build-hero.py exports from Blender onto the rig and packs it for the web as
 * public/models/hero.glb. The rig is the skeleton and the idle, walk, reach and hold clips, read from --rig (by default
 * public/models/hero.glb itself); its old meshes, materials and textures are dropped. The Wanderer is modelled standing in
 * the first frame of the idle clip, so the meshes are bound in that pose, while the skeleton keeps its own rest pose so
 * a later build reads the same rig. They are skinned to the rig's joints by name, so the clips and the intro's poses
 * drive them unchanged.
 *   blender -b --factory-startup --python-exit-code 1 -P scripts/build-hero.py -- <out dir>
 *   node scripts/build-hero.mjs <out dir>/hero-raw.glb [--rig <glb>]
 */
import path from 'node:path';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, unpartition, textureCompress, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const IN = process.argv[2];
if (!IN || IN.startsWith('--')) {
  console.error('usage: node scripts/build-hero.mjs <hero-raw.glb from scripts/build-hero.py> [--rig <glb with the skeleton and clips>]');
  process.exit(1);
}
const RIG = path.resolve(arg('--rig', 'public/models/hero.glb'));
const OUT = path.resolve(arg('--out', 'public/models/hero.glb'));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(RIG);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const rigSkin = root.listSkins().find((s) => s.listJoints().some((j) => j.getName() === 'hand_r'));
if (!rigSkin) throw new Error(`${RIG} has no skeleton with a hand_r joint`);
const joints = rigSkin.listJoints();
const jointIndex = new Map(joints.map((j, i) => [j.getName(), i]));
if (!['idle', 'reach', 'hold'].every((c) => root.listAnimations().filter((a) => a.getName() === c).length === 1)) throw new Error(`${RIG} needs exactly one each of the idle, reach and hold clips`);

/* ---------- the rig without its old figure: no meshes, no other skins, no nodes outside the scene */
for (const n of root.listNodes()) if (n.getMesh()) n.dispose();
for (const s of root.listSkins()) if (s !== rigSkin) s.dispose();
for (const s of root.listScenes().slice(1)) s.dispose();
const inScene = new Set();
scene.traverse((n) => inScene.add(n));
for (const n of root.listNodes()) if (!inScene.has(n)) n.dispose();

/* ---------- column-major 4x4 helpers */
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const inv = (m) => {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
};
const xf = (m, v, w) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);
const far = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

/* ---------- the Wanderer, moved from Blender's bind space into the rig's rest pose and skinned to the rig's joints */
const raw = await io.read(path.resolve(IN));
await mergeDocuments(doc, raw);
const meshNodes = root.listNodes().filter((n) => n.getMesh() && n.getSkin() && n.getSkin() !== rigSkin);
if (!meshNodes.length) throw new Error(`${IN} has no skinned meshes`);
for (const node of meshNodes) {
  const skin = node.getSkin();
  const rawJoints = skin.listJoints();
  const rawIbm = skin.getInverseBindMatrices();
  // bind space to world: the same matrix through every joint, or the export is not one rest pose
  const toWorld = mul(rawJoints[0].getWorldMatrix(), rawIbm.getElement(0, new Array(16)));
  const remap = rawJoints.map((j, i) => {
    const m = mul(j.getWorldMatrix(), rawIbm.getElement(i, new Array(16)));
    if (far(m, toWorld) > 1e-3) throw new Error(`joint ${j.getName()} is not in the same rest pose as the rest`);
    const k = jointIndex.get(j.getName());
    if (k === undefined) return -1;
    // the export's rest pose must be the rig's: each joint stands where the rig's does
    if (far(j.getWorldTranslation(), joints[k].getWorldTranslation()) > 1e-3) throw new Error(`joint ${j.getName()} is not where the rig has it`);
    return k;
  });
  const normalM = inv(toWorld);
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const nrm = prim.getAttribute('NORMAL');
    const jA = prim.getAttribute('JOINTS_0');
    const wA = prim.getAttribute('WEIGHTS_0');
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.setElement(i, xf(toWorld, pos.getElement(i, [0, 0, 0]), 1));
      if (nrm) {
        // normals by the inverse transpose
        const v = nrm.getElement(i, [0, 0, 0]);
        const t = [0, 1, 2].map((r) => normalM[r * 4] * v[0] + normalM[r * 4 + 1] * v[1] + normalM[r * 4 + 2] * v[2]);
        const l = Math.hypot(...t) || 1;
        nrm.setElement(i, t.map((x) => x / l));
      }
      jA.getElement(i, j);
      wA.getElement(i, w);
      for (let k = 0; k < 4; k++) {
        if (w[k] > 0 && remap[j[k]] < 0) throw new Error(`a vertex is weighted to ${rawJoints[j[k]].getName()}, which the rig lacks`);
        j[k] = w[k] > 0 ? remap[j[k]] : 0;
      }
      jA.setElement(i, j);
    }
  }
  node.setSkin(rigSkin);
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (const p of node.listParents()) if (p.propertyType === 'Node') p.removeChild(node);
  scene.addChild(node);
}
// each bind matrix is its joint in the idle's first frame, which the meshes are modelled in, inverted; the skeleton then
// goes back to its rest pose
const idle = root.listAnimations().find((a) => a.getName() === 'idle');
const rest = joints.map((j) => [j.getTranslation(), j.getRotation(), j.getScale()]);
for (const ch of idle.listChannels()) {
  const v = ch.getSampler().getOutput().getElement(0, []);
  const n = ch.getTargetNode();
  if (ch.getTargetPath() === 'rotation') n.setRotation(v);
  else if (ch.getTargetPath() === 'translation') n.setTranslation(v);
  else if (ch.getTargetPath() === 'scale') n.setScale(v);
}
const ibm = rigSkin.getInverseBindMatrices();
joints.forEach((jt, i) => ibm.setElement(i, inv(jt.getWorldMatrix())));
joints.forEach((jt, i) => jt.setTranslation(rest[i][0]).setRotation(rest[i][1]).setScale(rest[i][2]));
for (const s of root.listScenes()) if (s !== scene) s.dispose();
for (const s of root.listSkins()) if (s !== rigSkin) s.dispose();
const kept = new Set();
scene.traverse((n) => kept.add(n));
for (const n of root.listNodes()) if (!kept.has(n)) n.dispose();

await doc.transform(
  prune({ keepAttributes: false }),
  dedup(),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  unpartition(),
  // the colour carries the cloth and leather you see when the camera is close on the hands and face; normals less so,
  // roughness and metalness hardly at all
  textureCompress({ encoder: sharp, targetFormat: 'webp', pattern: /basecolor/, resize: [2048, 2048], quality: 86 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normalTexture$/, resize: [1024, 1024], quality: 90 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^metallicRoughnessTexture$/, resize: [512, 512], quality: 88 }),
);
doc.createExtension(EXTTextureWebP).setRequired(true);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log(`hero.glb: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${root.listMeshes().length} meshes, ${tris} triangles, ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
