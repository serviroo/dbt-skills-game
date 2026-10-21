import * as THREE from 'three';
import { mulberry32 } from '../../core/math';
import { params } from '../../core/params';

/**
 * Crackling energy filaments along the torn edges, redrawn "on 2s" (12 fps). Each slot holds a bolt for an epoch of
 * 2-4 steps (same path, fresh jitter every step, decaying), so the look is a crackle, never a strobe. CPU ribbons in
 * the gate plane; the whole state is a pure function of the step index derived from stage time.
 */
export interface FilamentShape {
  /** Smooth half width of the slit at normalised height u (-1 bottom tip .. 1 top tip), world units. */
  halfWidth(u: number): number;
  /** Whether row u is already torn open. */
  present(u: number): boolean;
  /** x of the tear's (meandering) centre line at row u; 0 when absent. */
  centerX?(u: number): number;
  /** y of row u when the two halves differ in length; centerY + u * height / 2 when absent. */
  yAt?(u: number): number;
  /** Brightness factor at row u (the glow dissolves above its original top); 1 when absent. */
  fadeAt?(u: number): number;
  height: number;
  /** Size reference for bolt length and width (world units). */
  scale: number;
  centerY: number;
}

const SLOTS = params.reduced ? 3 : 5;
const PTS = 16;
const BR = 6;
const MAX_POLY = SLOTS * 2;
const MAX_V = MAX_POLY * PTS * 2;

const vert = /* glsl */ `
attribute float aSide;
attribute float aI;
varying float vSide;
varying float vI;
void main() {
  vSide = aSide;
  vI = aI;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const frag = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform vec3 uViolet;
uniform float uGain;
varying float vSide;
varying float vI;
void main() {
  float a = abs(vSide);
  float core = exp(-a * a * 38.0);
  float glow = exp(-a * 3.2) * 0.32;
  vec3 c = uCore * core + mix(uGlow, uViolet, smoothstep(0.15, 0.9, a)) * glow;
  gl_FragColor = vec4(c * vI * uGain, 1.0);
}`;

export function createFilaments(shape: FilamentShape) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_V * 3);
  const side = new Float32Array(MAX_V);
  const inten = new Float32Array(MAX_V);
  const idx: number[] = [];
  for (let p = 0; p < MAX_POLY; p++)
    for (let i = 0; i < PTS - 1; i++) {
      const a = (p * PTS + i) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aI', new THREE.BufferAttribute(inten, 1).setUsage(THREE.DynamicDrawUsage));
  const uniforms = {
    uCore: { value: new THREE.Color(1.3, 3.4, 6.5) },
    uGlow: { value: new THREE.Color(0.02, 0.3, 1.4) },
    uViolet: { value: new THREE.Color(0.35, 0.08, 1.2) },
    uGain: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;

  let lastKey = '';
  const line: THREE.Vector2[] = Array.from({ length: PTS }, () => new THREE.Vector2());
  const tmp = new THREE.Vector2();

  const writePoly = (p: number, pts: THREE.Vector2[], n: number, w: number, I: number) => {
    for (let i = 0; i < PTS; i++) {
      const k = Math.min(i, n - 1);
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      tmp.set(b.x - a.x, b.y - a.y).normalize();
      const nx = -tmp.y, ny = tmp.x;
      const f = k / (n - 1);
      const taper = Math.sin(Math.PI * Math.min(1, f * 1.15 + 0.04)) ** 0.6;
      const ww = w * (0.35 + 0.65 * taper);
      for (let s = 0; s < 2; s++) {
        const v = (p * PTS + i) * 2 + s;
        const sg = s === 0 ? -1 : 1;
        pos[v * 3] = pts[k].x + nx * ww * sg;
        pos[v * 3 + 1] = pts[k].y + ny * ww * sg;
        pos[v * 3 + 2] = 0.012;
        side[v] = sg;
        inten[v] = i < n ? I * (0.3 + 0.7 * taper) : 0;
      }
    }
  };
  const clearPoly = (p: number) => {
    for (let i = 0; i < PTS * 2; i++) inten[p * PTS * 2 + i] = 0;
  };

  /** open: 0..1 slit progress (filaments only exist once the slit is open), level: overall brightness. */
  function update(t: number, open: number, level: number) {
    const rate = params.reduced ? 3 : 12;
    const k = Math.floor(t * rate);
    const key = `${k}|${open.toFixed(3)}|${level.toFixed(3)}`;
    if (key === lastKey) return;
    lastKey = key;
    const H = shape.height;
    const Z = shape.scale;
    for (let j = 0; j < SLOTS; j++) {
      const L = 2 + (j % 3);
      const kk = k + j * 5;
      const epoch = Math.floor(kk / L);
      const ls = kk - epoch * L;
      const er = mulberry32(epoch * 977 + j * 131 + 7);
      const active = er() < 0.42 && open > 0.35;
      if (!active || level <= 0) { clearPoly(j * 2); clearPoly(j * 2 + 1); continue; }
      const sgn = er() < 0.5 ? -1 : 1;
      let u0 = er() * 1.7 - 0.85;
      if (!shape.present(u0)) u0 = Math.sign(u0 || 1) * (0.7 + 0.25 * er());
      const crawl = er() < 0.85;
      const len = crawl ? (0.06 + 0.16 * er()) * Z : (0.03 + 0.07 * er()) * Z;
      const dir = er() < 0.5 ? -1 : 1;
      const bulge = (crawl ? 0.02 + 0.05 * er() : 0.06 + 0.1 * er()) * Z * 0.35;
      const I = 0.6 * [1, 0.62, 0.38, 0.22][ls] * (0.7 + 0.5 * er()) * level * Math.min(1, (open - 0.35) / 0.3) * (shape.fadeAt?.(u0) ?? 1);
      const ang = (er() - 0.5) * 0.5;
      const jr = mulberry32(epoch * 977 + j * 131 + k * 31 + 3);
      const n = PTS;
      // a bolt only crawls along rows that are already torn (round a racing half's leading spear it would draw a wire arc)
      let torn = shape.present(u0);
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        let x: number, y: number;
        if (crawl) {
          const u = Math.max(-0.99, Math.min(0.99, u0 + (dir * len * f) / (H * 0.5)));
          torn = torn && shape.present(u);
          const hw = shape.halfWidth(u);
          y = shape.yAt?.(u) ?? shape.centerY + (u * H) / 2;
          x = (shape.centerX?.(u) ?? 0) + sgn * (hw * 0.98 + Math.sin(Math.PI * f) * bulge * 0.5);
        } else {
          const hw = shape.halfWidth(u0);
          x = (shape.centerX?.(u0) ?? 0) + sgn * (hw * 0.95 + f * len * 0.5 * Math.cos(ang));
          y = (shape.yAt?.(u0) ?? shape.centerY + (u0 * H) / 2) + dir * Math.sin(Math.PI * f) * bulge + f * len * Math.sin(ang);
        }
        const amp = (0.008 + 0.012 * Math.sin(Math.PI * f)) * Z * 0.35;
        x += (jr() - 0.5) * amp * 1.4;
        y += (jr() - 0.5) * amp;
        line[i].set(x, y);
      }
      if (!torn) { clearPoly(j * 2); clearPoly(j * 2 + 1); continue; }
      const w = Z * 0.0032 * (0.8 + 0.4 * er());
      writePoly(j * 2, line, n, w, I);
      const bi = 3 + Math.floor(jr() * (n - 8));
      const bl = len * (0.25 + 0.3 * jr());
      const bang = Math.atan2(line[bi + 1].y - line[bi].y, line[bi + 1].x - line[bi].x) + sgn * (0.5 + 0.6 * jr()) * (jr() < 0.5 ? 1 : -1);
      const br: THREE.Vector2[] = [];
      for (let i = 0; i < BR; i++) {
        const f = i / (BR - 1);
        br.push(new THREE.Vector2(
          line[bi].x + Math.cos(bang) * bl * f + (jr() - 0.5) * bl * 0.18,
          line[bi].y + Math.sin(bang) * bl * f + (jr() - 0.5) * bl * 0.18,
        ));
      }
      if (jr() < 0.12) writePoly(j * 2 + 1, br, BR, w * 0.7, I * 0.5);
      else clearPoly(j * 2 + 1);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSide.needsUpdate = true;
    geo.attributes.aI.needsUpdate = true;
  }

  return { mesh, uniforms, update };
}
