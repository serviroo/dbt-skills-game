/**
 * Packs the companion moth for the web: public/models/moth.glb from the GLB that scripts/build-moth.py exports from
 * Blender. Its one texture set becomes WebP (colour 1024 px, normals 512, roughness and metalness 256); positions,
 * normals and UVs are quantized.
 *   blender -b --factory-startup --python-exit-code 1 -P scripts/build-moth.py -- <out dir>
 *   node scripts/build-moth.mjs <out dir>/moth-raw.glb
 */
import path from 'node:path';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, unpartition } from '@gltf-transform/functions';
import sharp from 'sharp';

const IN = process.argv[2];
if (!IN) {
  console.error('usage: node scripts/build-moth.mjs <moth-raw.glb from scripts/build-moth.py>');
  process.exit(1);
}
const OUT = path.resolve('public/models/moth.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
await doc.transform(
  prune({ keepAttributes: false }),
  dedup(),
  // the scene puts quantized positions back into the moth's space as it loads them (src/scene/watch/models.ts settle)
  quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }),
  unpartition(),
  // the wings' pattern is the detail you see, so the colour keeps the most
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, resize: [1024, 1024], quality: 88 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normalTexture$/, resize: [512, 512], quality: 90 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^metallicRoughnessTexture$/, resize: [256, 256], quality: 88 }),
);
doc.createExtension(EXTTextureWebP).setRequired(true);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const root = doc.getRoot();
const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log(`moth.glb: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${root.listNodes().map((n) => n.getName()).join(', ')}, ${tris} triangles`);
