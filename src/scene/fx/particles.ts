import * as THREE from 'three';
import { mulberry32 } from '../../core/math';
import { params } from '../../core/params';
import { HASH_GLSL, noiseTexture } from './noise';

/**
 * GPU particle core: every particle is a camera-facing instanced quad whose state is a pure function of
 * (seed, uTime), so any system built on it can be seeked and captured frame-exact. One draw call per system.
 *
 * The vertex body sets, in the system's local space:
 *   P (vec3 position), S (half size, world units), A (alpha 0..1), C (vec3 colour),
 *   VEL (vec3 velocity, for motion streaks), STRETCH (seconds of velocity to smear; 0 = billboard),
 *   ROT (radians, billboards only), ASPECT (height/width), DATA (vec4 passed to the fragment).
 * The fragment body reads vUv (-1..1), vAlpha, vColor, vSeed, vData and writes gl_FragColor PREMULTIPLIED.
 */
export type Blend = 'add' | 'premult';

export interface ParticleOpts {
  count: number;
  seed?: number;
  uniforms?: Record<string, THREE.IUniform>;
  vertexHead?: string;
  vertexBody: string;
  fragmentHead?: string;
  fragmentBody: string;
  blend: Blend;
  renderOrder?: number;
  depthTest?: boolean;
  /** Keep sprites at least this many pixels wide; alpha is scaled down to conserve energy. */
  minPx?: number;
  /** Fraction of particles kept under prefers-reduced-motion. */
  reducedFraction?: number;
}

export interface ParticleSystem {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  uniforms: Record<string, THREE.IUniform>;
  count: number;
  setIntensity(v: number): void;
  update(t: number): void;
}

const vertTemplate = (head: string, body: string) => /* glsl */ `
attribute vec2 corner;
attribute vec4 aSeed;
attribute vec4 aSeed2;
uniform float uTime;
uniform float uIntensity;
uniform float uViewH;
uniform float uMinPx;
uniform sampler2D uNoise;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying vec4 vSeed;
varying vec4 vData;
${HASH_GLSL}
${head}
void main() {
  vec3 P = vec3(0.0); float S = 0.05; float A = 1.0; vec3 C = vec3(1.0);
  vec3 VEL = vec3(0.0); float STRETCH = 0.0; float ROT = 0.0; float ASPECT = 1.0; vec4 DATA = vec4(0.0);
  vec4 s = aSeed; vec4 s2 = aSeed2;
  ${body}
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  // particles that drift within ~0.9 m of the lens fade out instead of filling the frame as flat cards
  A *= smoothstep(0.35, 0.9, -mv.z);
  float pxPerUnit = projectionMatrix[1][1] * 0.5 * uViewH / max(-mv.z, 1e-3);
  float px = S * pxPerUnit;
  if (px < uMinPx) { A *= px / uMinPx; S = uMinPx / pxPerUnit; }
  vec2 c = corner;
  vec2 off = vec2(0.0);
  if (STRETCH > 0.0) {
    vec3 vv = mat3(modelViewMatrix) * VEL;
    vec2 ax = vv.xy;
    float l = length(ax);
    ax = l > 1e-5 ? ax / max(l, 1e-5) : vec2(0.0, 1.0);
    vec2 pp = vec2(ax.y, -ax.x);
    off = pp * c.x * S + ax * c.y * (S * ASPECT + STRETCH * l * 0.5);
  } else {
    float cr = cos(ROT), sr = sin(ROT);
    vec2 q = vec2(c.x * S, c.y * S * ASPECT);
    off = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vUv = c; vAlpha = A; vColor = C; vSeed = aSeed; vData = DATA;
  if (A <= 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const fragTemplate = (head: string, body: string) => /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform sampler2D uNoise;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying vec4 vSeed;
varying vec4 vData;
${head}
void main() {
  ${body}
}
`;

const quad = (() => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
})();

const drawSize = new THREE.Vector2();

export function createParticles(o: ParticleOpts): ParticleSystem {
  const rnd = mulberry32(o.seed ?? 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('corner', quad.getAttribute('corner'));
  const a = new Float32Array(o.count * 4), b = new Float32Array(o.count * 4);
  for (let i = 0; i < o.count * 4; i++) { a[i] = rnd(); b[i] = rnd(); }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 4));
  g.setAttribute('aSeed2', new THREE.InstancedBufferAttribute(b, 4));
  const count = params.reduced ? Math.max(1, Math.floor(o.count * (o.reducedFraction ?? 0.5))) : o.count;
  g.instanceCount = count;

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uViewH: { value: 800 },
    uMinPx: { value: o.minPx ?? 0.9 },
    uNoise: { value: noiseTexture() },
    ...(o.uniforms ?? {}),
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertTemplate(o.vertexHead ?? '', o.vertexBody),
    fragmentShader: fragTemplate(o.fragmentHead ?? '', o.fragmentBody),
    transparent: true,
    depthWrite: false,
    depthTest: o.depthTest ?? true,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: o.blend === 'add' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = o.renderOrder ?? 10;
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(drawSize);
    uniforms.uViewH.value = drawSize.y;
  };
  return {
    mesh,
    material,
    uniforms,
    count,
    setIntensity(v: number) { uniforms.uIntensity.value = v; },
    update(t: number) { uniforms.uTime.value = t; },
  };
}
