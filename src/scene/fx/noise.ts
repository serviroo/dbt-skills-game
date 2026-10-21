import * as THREE from 'three';
import { mulberry32 } from '../../core/math';

/**
 * One shared tileable noise texture, generated once in JS (no asset files).
 * R: fbm gradient noise, G: fbm (other seed), B: ridged fbm (filaments, cracks), A: cellular F1 (cells, flakes).
 */
let cached: THREE.DataTexture | null = null;

export function noiseTexture(size = 256): THREE.DataTexture {
  if (cached) return cached;
  const data = new Uint8Array(size * size * 4);
  const rnd = mulberry32(7);

  const makeGrad = (period: number) => {
    const g = new Float32Array(period * period * 2);
    for (let i = 0; i < period * period; i++) {
      const a = rnd() * Math.PI * 2;
      g[i * 2] = Math.cos(a);
      g[i * 2 + 1] = Math.sin(a);
    }
    return g;
  };
  const perlin = (x: number, y: number, period: number, g: Float32Array) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const dot = (ix: number, iy: number, dx: number, dy: number) => {
      const k = (((iy % period) + period) % period) * period + (((ix % period) + period) % period);
      return g[k * 2] * dx + g[k * 2 + 1] * dy;
    };
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = dot(xi, yi, xf, yf), b = dot(xi + 1, yi, xf - 1, yf);
    const c = dot(xi, yi + 1, xf, yf - 1), d = dot(xi + 1, yi + 1, xf - 1, yf - 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };

  const octs = [4, 8, 16, 32, 64];
  const gA = octs.map(makeGrad);
  const gB = octs.map(makeGrad);
  const gC = [3, 6, 12, 24, 48].map(makeGrad);

  const cells = 10;
  const pts: number[] = [];
  for (let i = 0; i < cells * cells; i++) pts.push(rnd(), rnd());

  const fR = new Float32Array(size * size), fG = new Float32Array(size * size), fB = new Float32Array(size * size), fA = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      let a = 0, b = 0, c = 0, amp = 0.5;
      for (let o = 0; o < octs.length; o++) {
        a += amp * perlin(u * octs[o], v * octs[o], octs[o], gA[o]);
        b += amp * perlin(u * octs[o] + 0.37, v * octs[o] + 0.71, octs[o], gB[o]);
        const p = [3, 6, 12, 24, 48][o];
        c += amp * (1 - Math.abs(perlin(u * p, v * p, p, gC[o]) * 1.6));
        amp *= 0.5;
      }
      // cellular F1, tileable
      const cx = u * cells, cy = v * cells;
      const ix = Math.floor(cx), iy = Math.floor(cy);
      let best = 9;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const gx = ix + ox, gy = iy + oy;
          const k = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
          const px = gx + pts[k * 2], py = gy + pts[k * 2 + 1];
          const d = Math.hypot(px - cx, py - cy);
          if (d < best) best = d;
        }
      fR[i] = a; fG[i] = b; fB[i] = c; fA[i] = best;
    }
  }
  const norm = (f: Float32Array) => {
    let lo = Infinity, hi = -Infinity;
    for (const x of f) { if (x < lo) lo = x; if (x > hi) hi = x; }
    return (x: number) => Math.round(((x - lo) / (hi - lo)) * 255);
  };
  const nR = norm(fR), nG = norm(fG), nB = norm(fB), nA = norm(fA);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = nR(fR[i]);
    data[i * 4 + 1] = nG(fG[i]);
    data[i * 4 + 2] = nB(fB[i]);
    data[i * 4 + 3] = nA(fA[i]);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}

/** CPU lookup of the shared noise texture (bilinear, wrapped, GL texel centres), so CPU geometry can follow a curve
 * a shader draws from the same texture. Channel 0..3 = R, G, B, A, returned 0..1. */
export function noiseSample(u: number, v: number, channel = 0): number {
  const tex = noiseTexture();
  const size = tex.image.width;
  const data = tex.image.data as Uint8Array;
  const x = u * size - 0.5, y = v * size - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const at = (ix: number, iy: number) => {
    const cx = ((ix % size) + size) % size, cy = ((iy % size) + size) % size;
    return data[(cy * size + cx) * 4 + channel] / 255;
  };
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return a + (b - a) * fy;
}

/** GLSL hash helpers shared by the particle shaders. */
export const HASH_GLSL = /* glsl */ `
vec4 hash44(vec4 p4) {
  p4 = fract(p4 * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
`;
