/**
 * Packs the Night Watch's camp figures for the web: public/models/watch.glb from the GLB that scripts/build-watch.py
 * exports from Blender. Textures become WebP (colour 1024 or 512 px, normals 512, roughness and metalness 256);
 * positions, normals and UVs are quantized.
 *   blender -b --factory-startup -P scripts/build-watch.py -- <out dir>
 *   node scripts/build-watch.mjs <out dir>/watch-raw.glb
 */
import path from 'node:path';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, unpartition } from '@gltf-transform/functions';
import sharp from 'sharp';

const IN = process.argv[2];
if (!IN) {
  console.error('usage: node scripts/build-watch.mjs <watch-raw.glb from scripts/build-watch.py>');
  process.exit(1);
}
const OUT = path.resolve('public/models/watch.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
await doc.transform(
  prune({ keepAttributes: false }),
  dedup(),
  // the camp puts quantized positions back into figure space as it loads them (src/scene/watch/models.ts)
  quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }),
  unpartition(),
  // the colour carries the detail you see at camp distance, more for the knights who stand tall; the normals less so,
  // roughness and metalness hardly at all
  textureCompress({ encoder: sharp, targetFormat: 'webp', pattern: /^(sable|anvil|harrow)-basecolor/, resize: [1024, 1024], quality: 86 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', pattern: /^(bramble|vesper|block)-basecolor/, resize: [512, 512], quality: 88 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normalTexture$/, resize: [512, 512], quality: 90 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^metallicRoughnessTexture$/, resize: [256, 256], quality: 88 }),
);
doc.createExtension(EXTTextureWebP).setRequired(true);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const root = doc.getRoot();
const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log(`watch.glb: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${root.listScenes()[0].listChildren().map((n) => n.getName()).join(', ')}, ${tris} triangles`);
