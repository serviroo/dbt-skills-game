/**
 * Builds public/models/hero.glb, the cutscene's hooded wanderer, from three CC0 packs by Quaternius:
 *   Modular Character Outfits - Fantasy [Standard]  (Male_Ranger outfit: hood, coat, arms, legs, boots)
 *   Universal Base Characters [Standard]            (Superhero_Male_FullBody: only the head, eyes and brows are kept)
 *   Universal Animation Library [Standard]          (UAL1_Standard.glb: idle, walk and spell clips)
 * All three share one 65-bone humanoid skeleton. Download them from quaternius.com (free, CC0), unzip them side by
 * side into one folder, then:  node scripts/build-hero.mjs --packs <that folder>
 */
import path from 'node:path';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, unpartition, textureCompress, compactPrimitive, resample, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const packs = arg('--packs');
if (!packs) {
  console.error('usage: node scripts/build-hero.mjs --packs <folder with the three unzipped Quaternius packs>');
  process.exit(1);
}
const find = (re) => {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (re.test(p)) hits.push(p);
    }
  };
  walk(packs);
  if (!hits.length) throw new Error('not found in --packs: ' + re);
  return hits.sort((a, b) => a.length - b.length)[0];
};
const OUTFIT = find(/Outfits[\\/]Male_Ranger\.gltf$/);
const BASE = find(/Godot - UE[\\/]Superhero_Male_FullBody\.gltf$/);
const ANIMS = find(/Unreal-Godot[\\/]UAL1_Standard\.glb$/);
const OUT = path.resolve(arg('--out', 'public/models/hero.glb'));
const CLIPS = { Idle_Loop: 'idle', Walk_Formal_Loop: 'walk', Spell_Simple_Enter: 'reach', Spell_Simple_Idle_Loop: 'hold' };
const HEAD_BONES = new Set(['Head', 'neck_01', 'neck_02']);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
// the base pack's .gltf names a few textures with a stray "_png" suffix; fall back to the file that exists
const readGltf = async (file) => {
  const dir = path.dirname(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const resources = {};
  for (const r of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!r.uri) continue;
    let p = path.join(dir, decodeURIComponent(r.uri));
    if (!fs.existsSync(p)) p = p.replace(/_png\.png$/, '.png');
    resources[r.uri] = new Uint8Array(fs.readFileSync(p));
  }
  return io.readJSON({ json, resources });
};
const doc = await readGltf(OUTFIT);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const jointIndex = new Map(joints.map((j, i) => [j.getName(), i]));
const ibm = skin.getInverseBindMatrices();

/* ---------- head, eyes and brows from the base body, moved from its bind pose onto the outfit's skeleton */
const baseDoc = await readGltf(BASE);
const baseSkin = baseDoc.getRoot().listSkins()[0];
const baseJointNames = baseSkin.listJoints().map((j) => j.getName());
const baseIbm = baseSkin.getInverseBindMatrices();
const m4 = (acc, i) => acc.getElement(i, new Array(16));
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const inv = (m) => {
  // rigid (rotation + translation + uniform scale) inverse is enough for bind matrices
  const sx = Math.hypot(m[0], m[1], m[2]);
  const s2 = sx * sx;
  const r = [m[0] / s2, m[4] / s2, m[8] / s2, 0, m[1] / s2, m[5] / s2, m[9] / s2, 0, m[2] / s2, m[6] / s2, m[10] / s2, 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
};
// per base joint: base bind space -> outfit bind space (outfit bind world x base inverse bind)
const retarget = baseJointNames.map((n, bi) => {
  const oi = jointIndex.get(n);
  if (oi === undefined) throw new Error('outfit skeleton has no bone ' + n);
  return mul(inv(m4(ibm, oi)), m4(baseIbm, bi));
});
const xf = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w, m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w, m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w];

await mergeDocuments(doc, baseDoc);
const baseMeshNodes = root.listNodes().filter((n) => n.getMesh() && n.getSkin() && n.getSkin() !== skin);
for (const node of baseMeshNodes) {
  const isBody = node.getName() === 'SuperHero_Male';
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const nrm = prim.getAttribute('NORMAL');
    const jA = prim.getAttribute('JOINTS_0');
    const wA = prim.getAttribute('WEIGHTS_0');
    const idx = prim.getIndices();
    const n = pos.getCount();
    const headW = new Float32Array(n);
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      jA.getElement(i, j);
      wA.getElement(i, w);
      let h = 0;
      for (let k = 0; k < 4; k++) if (HEAD_BONES.has(baseJointNames[j[k]])) h += w[k];
      headW[i] = h;
      // blend the per-bone retarget exactly like skinning would, so neck seams follow their own bones
      const p = pos.getElement(i, [0, 0, 0]);
      const q = nrm ? nrm.getElement(i, [0, 0, 0]) : null;
      let po = [0, 0, 0], no = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        if (!w[k]) continue;
        const m = retarget[j[k]];
        const a = xf(m, p, 1);
        po = po.map((v, c) => v + a[c] * w[k]);
        if (q) {
          const b = xf(m, q, 0);
          no = no.map((v, c) => v + b[c] * w[k]);
        }
      }
      pos.setElement(i, po);
      if (q) {
        const l = Math.hypot(...no) || 1;
        nrm.setElement(i, no.map((v) => v / l));
      }
      jA.setElement(i, j.map((x) => jointIndex.get(baseJointNames[x])));
    }
    if (isBody) {
      // keep only the head: triangles whose three corners are (almost) fully driven by the head and neck bones
      const keep = [];
      for (let t = 0; t < idx.getCount(); t += 3) {
        const a = idx.getScalar(t), b = idx.getScalar(t + 1), c = idx.getScalar(t + 2);
        if (headW[a] > 0.98 && headW[b] > 0.98 && headW[c] > 0.98) keep.push(a, b, c);
      }
      idx.setArray(new Uint32Array(keep));
      compactPrimitive(prim);
    }
  }
  node.setSkin(skin);
  doc.getRoot().listScenes()[0].addChild(node);
}

/* ---------- clips from the animation library, retargeted by bone name; only the pelvis keeps its translation */
const animDoc = await io.read(ANIMS);
for (const a of animDoc.getRoot().listAnimations()) {
  if (CLIPS[a.getName()]) continue;
  for (const s of a.listSamplers()) s.dispose();
  for (const c of a.listChannels()) c.dispose();
  a.dispose();
}
for (const m of animDoc.getRoot().listMeshes()) m.dispose();
await animDoc.transform(prune());
await mergeDocuments(doc, animDoc);
const outfitByName = new Map(joints.map((j) => [j.getName(), j]));
for (const a of root.listAnimations()) {
  if (!CLIPS[a.getName()]) continue;
  a.setName(CLIPS[a.getName()]);
  for (const ch of a.listChannels()) {
    const target = outfitByName.get(ch.getTargetNode()?.getName());
    const p = ch.getTargetPath();
    if (!target || p === 'scale' || (p === 'translation' && target.getName() !== 'pelvis')) {
      ch.getSampler()?.dispose();
      ch.dispose();
      continue;
    }
    ch.setTargetNode(target);
  }
}

/* ---------- one scene: the outfit armature plus the moved head parts */
const scenes = root.listScenes();
for (const s of scenes.slice(1)) s.dispose();
for (const n of root.listNodes()) if (!n.getParentNode() && !scenes[0].listChildren().includes(n)) n.dispose();

/* ---------- the outfit recoloured from field browns to night: ink-navy cloth, cold slate leather, steel kept steel */
for (const tex of root.listTextures()) {
  const name = tex.getName() || tex.getURI();
  if (!/Ranger_BaseColor/.test(name)) continue;
  const img = await sharp(Buffer.from(tex.getImage()))
    .modulate({ saturation: 0.3, brightness: 0.52, hue: 185 })
    .linear(1.1, -6)
    .png()
    .toBuffer();
  tex.setImage(new Uint8Array(img));
}

await doc.transform(
  prune({ keepAttributes: false }),
  dedup(),
  resample({ tolerance: 0.0005 }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  unpartition(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }),
);
doc.createExtension(EXTTextureWebP).setRequired(true);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`hero.glb: ${kb} KB, ${root.listMeshes().length} meshes, ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
