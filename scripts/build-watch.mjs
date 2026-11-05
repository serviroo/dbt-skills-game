/**
 * Packs the Night Watch's camp figures for the web: public/models/watch.glb from the GLB that scripts/build-watch.py
 * exports from Blender. Textures become WebP (colour 1024 or 512 px, normals 512, roughness and metalness 256);
 * positions, normals and UVs are quantized.
 *   blender -b --factory-startup -P scripts/build-watch.py -- <out dir>
 *   node scripts/build-watch.mjs <out dir>/watch-raw.glb
 */
import { packModel } from './pack-model.mjs';

await packModel(process.argv[2], 'watch', [
  // the colour carries the detail you see at camp distance, more for the knights who stand tall; the normals less so,
  // roughness and metalness hardly at all
  { pattern: /^(sable|anvil|harrow)-basecolor/, resize: [1024, 1024], quality: 86 },
  { pattern: /^(bramble|vesper|block)-basecolor/, resize: [512, 512], quality: 88 },
]);
