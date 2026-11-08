import path from 'node:path';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, quantize, textureCompress, unpartition } from '@gltf-transform/functions';
import sharp from 'sharp';

export async function packModel(input, name, colour) {
  if (!input) {
    const blender = `blender -b --factory-startup --python-exit-code 1 -P scripts/build-${name}.py -- <out dir>`;
    console.error(`usage: node scripts/build-${name}.mjs <${name}-raw.glb from scripts/build-${name}.py>`);
    console.error(`  first: ${blender}`);
    process.exit(1);
  }
  const out = path.resolve(`public/models/${name}.glb`);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  const webp = (opts) => textureCompress({ encoder: sharp, targetFormat: 'webp', ...opts });
  await doc.transform(
    prune({ keepAttributes: false }),
    dedup(),
    // the camp puts quantized positions back into figure space as it loads them (src/scene/watch/models.ts)
    quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }),
    unpartition(),
    ...colour.map(webp),
    webp({ slots: /^normalTexture$/, resize: [512, 512], quality: 90 }),
    webp({ slots: /^metallicRoughnessTexture$/, resize: [256, 256], quality: 88 }),
  );
  doc.createExtension(EXTTextureWebP).setRequired(true);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const root = doc.getRoot();
  const count = (prim) => (prim.getIndices()?.getCount() ?? 0) / 3;
  const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + count(p), 0), 0);
  const names = root.listScenes()[0].listChildren().map((n) => n.getName()).join(', ');
  console.log(`${name}.glb: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${names}, ${tris} triangles`);
}
