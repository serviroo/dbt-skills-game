import * as THREE from 'three';
import { clamp } from '../core/math';

let glowTex: THREE.Texture | null = null;

/** Soft radial falloff sprite texture, drawn in code. */
export function radialGlowTexture() {
  if (glowTex) return glowTex;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1, dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.pow(clamp(1 - r), 2.2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  glowTex = new THREE.DataTexture(data, size, size);
  glowTex.needsUpdate = true;
  return glowTex;
}
