import * as THREE from 'three';

/**
 * What the calm scenes share so they look like one world: the same water, the same sun from above, the same light
 * through the surface and the same drifting motes. GLSL goes in front of a scene's own shader code; the builders
 * below make the pieces most water scenes need.
 */

/** Seeded random numbers, so a scene looks the same every time it opens. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

export const WATER_GLSL = /* glsl */ `
const vec3 VOID = vec3(0.0021, 0.0024, 0.0052);
const vec3 SUN = vec3(0.78, 0.92, 1.0);
const vec3 LIGHT = vec3(0.5300, 0.7950, 0.2951);
const float SURFACE = 2.4;

float hash1(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float noise1(float x) { float i = floor(x), f = fract(x); return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 157.0 + i.z * 113.0;
  return mix(mix(mix(hash1(n), hash1(n + 1.0), u.x), mix(hash1(n + 157.0), hash1(n + 158.0), u.x), u.y),
             mix(mix(hash1(n + 113.0), hash1(n + 114.0), u.x), mix(hash1(n + 270.0), hash1(n + 271.0), u.x), u.y), u.z);
}

/** distance from p to the nearest edge between slowly moving cells */
float cellEdge(vec2 p, float t) {
  vec2 g = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 h = hash22(g + o);
    vec2 c = o + 0.5 + 0.4 * sin(t * (0.5 + 0.5 * h.y) + 6.2831 * h);
    float d = dot(c - f, c - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
/**
 * Sunlight focused by the moving surface: two drifting nets of curved filaments that brighten where they cross and
 * fade in and out along their length. x = the bright core of each filament, y = its soft halo.
 */
vec2 caustic(vec2 p, float t) {
  vec2 w = vec2(noise2(p * 0.8 + vec2(0.0, t * 0.08)), noise2(p * 0.8 + vec2(5.2, 1.3 - t * 0.07)));
  p += (w - 0.5) * 1.1;
  float a = cellEdge(p, t * 0.45);
  float b = cellEdge(p * 1.37 + vec2(3.1, 1.7), -t * 0.38);
  float la = 1.0 - smoothstep(0.0, 0.14, a);
  float lb = 1.0 - smoothstep(0.0, 0.12, b);
  float vary = 0.35 + 0.65 * noise2(p * 1.9 + vec2(t * 0.06, 0.0));
  float core = (la * la * la * 0.55 + lb * lb * lb * 0.4) * vary + la * lb * 0.9;
  float halo = ((1.0 - smoothstep(0.0, 0.34, a)) * 0.6 + (1.0 - smoothstep(0.0, 0.3, b)) * 0.4) * (0.5 + 0.5 * vary);
  return vec2(core, halo);
}
/** the water seen along d: lit from above, fading to the void below and far away */
vec3 water(vec3 d) {
  vec3 mid = vec3(0.0036, 0.0120, 0.0250);
  vec3 top = vec3(0.0150, 0.0560, 0.1050);
  vec3 c = mix(VOID, mid, smoothstep(-0.3, 0.06, d.y));
  return mix(c, top, smoothstep(0.04, 0.6, d.y));
}
/** shafts of sunlight from the surface, converging above: a bright core inside a wide soft halo */
vec3 shafts(vec3 d, float t) {
  float q = (d.x + d.z * 0.3) / (1.6 - d.y);
  float r = 0.62 * noise1(q * 9.0 + t * 0.04) + 0.38 * noise1(q * 21.0 - t * 0.028 + 7.0);
  float core = pow(smoothstep(0.55, 0.95, r), 3.0);
  float halo = smoothstep(0.3, 0.95, r);
  return vec3(0.08, 0.19, 0.29) * (core * 0.8 + halo * 0.32) * smoothstep(-0.2, 0.45, d.y);
}
/** distance haze: far things sink into the water colour behind them */
vec3 haze(vec3 col, vec3 pos, float t, float extra) {
  vec3 d = normalize(pos - cameraPosition);
  float dist = length(pos - cameraPosition);
  float k = max(1.0 - exp(-dist * 0.045), extra);
  return mix(col, water(d) + shafts(d, t) * 0.6, clamp(k, 0.0, 1.0));
}
/** the sunlight left at height y after the water above has taken some of it, the reds first, so deep light turns blue */
vec3 sunAt(float y) { return exp(-(SURFACE - y) * vec3(0.36, 0.29, 0.25)); }
`;

/** Ends every scene shader the way three.js expects, so tone mapping and colour space match the rest of the game. */
export const OUT_GLSL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

/** The vertex shader for meshes whose fragment shader works in world space (`vWorld`). */
export const WORLD_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BACK_VERT = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec3 vDir;
void main() {
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;
const BACK_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vDir;
${WATER_GLSL}
void main() {
  vec3 d = normalize(vDir);
  gl_FragColor = vec4(water(d) + shafts(d, uTime), 1.0);
  ${OUT_GLSL}
}`;

/** The open water behind everything, seen from `camera`, with slow shafts of light from the surface. */
export function waterBackdrop(camera: THREE.PerspectiveCamera, time: { value: number }) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: BACK_VERT,
      fragmentShader: BACK_FRAG,
      uniforms: { uTime: time, uInvProj: { value: camera.projectionMatrixInverse }, uCamWorld: { value: camera.matrixWorld } },
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

const MOTE_VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform float uScale;
uniform float uFloor;
uniform float uHeight;
varying float vA;
${WATER_GLSL}
void main() {
  vec3 p = position;
  p.x += sin(uTime * (0.06 + seed.x * 0.05) + seed.y * 6.2831) * 0.16;
  p.z += cos(uTime * (0.05 + seed.y * 0.04) + seed.x * 6.2831) * 0.12;
  float y = mod(p.y - uFloor - uTime * (0.012 + seed.w * 0.018), uHeight);
  p.y = uFloor + y;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale * (0.012 + 0.014 * seed.x) / -mv.z);
  vA = sunAt(p.y).g * smoothstep(0.0, 0.35, y) * smoothstep(uHeight, uHeight - 0.5, y) * (0.3 + 0.7 * seed.w) * exp(-max(0.0, -mv.z - 4.0) * 0.25);
}`;
const MOTE_FRAG = /* glsl */ `
varying float vA;
void main() {
  float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5)) * vA;
  gl_FragColor = vec4(vec3(0.20, 0.32, 0.40) * a, 1.0);
  ${OUT_GLSL}
}`;

/**
 * Fine motes catching the light as they drift slowly up through a box of water: `count` of them, `width` by `depth`
 * across, from `floor` up `height`. `scale` is the camera's pixels per unit at distance 1 (see `pointScale`).
 */
export function motes(o: { count: number; width: number; depth: number; floor: number; height: number; z?: number; seed: number; time: { value: number }; scale: { value: number } }) {
  const rand = rng(o.seed);
  const pos = new Float32Array(o.count * 3), seed = new Float32Array(o.count * 4);
  for (let i = 0; i < o.count; i++) {
    pos.set([(rand() - 0.5) * o.width, o.floor + rand() * o.height, (rand() - 0.5) * o.depth + (o.z ?? 0)], i * 3);
    seed.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: { uTime: o.time, uScale: o.scale, uFloor: { value: o.floor }, uHeight: { value: o.height } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = 3;
  return points;
}

/** Pixels per world unit at distance 1 for a camera with this vertical field of view, drawn `height` pixels tall. */
export const pointScale = (fov: number, height: number) => height / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
