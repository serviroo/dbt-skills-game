import * as THREE from 'three';
import { smoothstep } from '../../../../core/math';
import { THOUGHTS } from '../../../../motion/tokens';
import { hash, NIGHT_GLSL, nightBackdrop, OUT_GLSL, rng } from '../../common';
import { DEG, dirOf, type Paint } from './picture';

const noise1 = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  return hash(i) + (hash(i + 1) - hash(i)) * f * f * (3 - 2 * f);
};

const CARS = THOUGHTS.cars;
const CAR_SLOTS = Math.ceil(CARS.crossSec / CARS.spaceSec);
const LAMPS = CAR_SLOTS * 2;
const EYE = 14;
const ROAD_PITCH = -9 * DEG;
const ROAD_MOON = { az: -32 * DEG, el: 21 * DEG };
const ROAD_HALF = 2.5;
const ROAD = new THREE.CatmullRomCurve3(
  [
    [-62, -80], [-40, -78], [-22, -76], [-8, -72], [3, -63], [8, -52],
    [6.5, -42], [8, -33], [13, -25], [20, -18], [30, -12],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  'centripetal',
);
const CAR_LEN = 4.1;
const LAMP_SIDE = 0.62;
const LAMP_UP = 0.68;

function land(x: number, z: number) {
  const d = -z;
  const hill = 13 * (1 - smoothstep(0, 19, d + 0.004 * x * x));
  const hills = smoothstep(100, 240, d) * (8 + 9 * noise1(x * 0.012 + 3.1) + 4 * noise1(x * 0.04));
  const peaks = smoothstep(280, 500, d) * (14 + 13 * noise1(x * 0.006 + 7.3) + 5 * noise1(x * 0.02 + 1.1));
  const roll = 1.2 * Math.sin(x * 0.045 + 1.3) * Math.sin(z * 0.035 + 0.4) + 0.4 * Math.sin(x * 0.11 - z * 0.07);
  return hill + hills + peaks + roll;
}

const NIGHT_LAND = /* glsl */ `
${NIGHT_GLSL}
uniform vec3 uMoon;
uniform float uTime;
uniform vec4 uCarAt[${CAR_SLOTS}];
uniform vec2 uCarDir[${CAR_SLOTS}];
const vec3 HEAD = vec3(0.92, 0.96, 1.0);
vec3 headlights(vec3 p) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${CAR_SLOTS}; i++) {
    if (uCarAt[i].w <= 0.0) continue;
    vec2 v = p.xz - uCarAt[i].xz;
    vec2 d = uCarDir[i];
    float along = dot(v, d), side = dot(v, vec2(-d.y, d.x));
    float spread = 0.9 + max(along, 0.0) * 0.22;
    float pool = smoothstep(-0.6, 2.5, along) * exp(-max(along, 0.0) / 12.0) * exp(-side * side / (spread * spread));
    sum += HEAD * (pool + exp(-dot(v, v) / 5.0) * 0.1) * uCarAt[i].w;
  }
  return sum;
}
vec3 valleyAir(vec3 col, vec3 p) {
  vec3 v = p - cameraPosition;
  float dist = length(v);
  vec3 d = v / dist;
  vec3 h = normalize(vec3(d.x, max(d.y, 0.0) * 0.3, d.z));
  vec3 air = skyPlain(h, uMoon) * 0.72 + moonHalo(h, uMoon) * 0.5;
  vec3 mist = NIGHT_LOW * 1.1 + MOONLIGHT * 0.006;
  float far = 1.0 - exp(-dist * 0.0036);
  float low = exp(-max(p.y - 0.5, 0.0) / 5.0) * smoothstep(60.0, 200.0, dist) * 0.7
    * (0.65 + 0.35 * fbm2(p.xz * 0.015 + vec2(uTime * 0.004, 0.0)));
  return mix(mix(col, air, clamp(far, 0.0, 0.9)), mist, clamp(low, 0.0, 0.8));
}
`;

const LAND_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const VALLEY_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
${NIGHT_LAND}
vec2 fields(vec2 p) {
  vec2 g = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = o + 0.5 + 0.38 * (hash22(g + o) - 0.5);
    vec2 e = abs(c - f);
    float d = max(e.x * 0.9 + e.y * 0.4, e.y * 0.9 + e.x * 0.4);
    if (d < d1) { d2 = d1; d1 = d; id = hash2(g + o); } else if (d < d2) d2 = d;
  }
  return vec2(d2 - d1, id);
}
void main() {
  vec3 p = vWorld;
  vec3 n = normalize(vN);
  float dist = length(cameraPosition - p);
  vec2 fl = fields(p.xz / 30.0);
  vec3 alb = mix(vec3(0.050, 0.062, 0.044), vec3(0.064, 0.058, 0.048), step(0.6, fl.y)) * (0.82 + 0.36 * fl.y);
  alb *= 0.85 + 0.3 * noise2(p.xz * 0.6) * (1.0 - smoothstep(30.0, 120.0, dist));
  float px = max(fwidth(fl.x), 1e-4);
  float hedge = (1.0 - smoothstep(0.01, 0.01 + px * 1.5, fl.x)) * (1.0 - smoothstep(6.0, 16.0, p.y))
    * (1.0 - smoothstep(150.0, 420.0, dist));
  alb = mix(alb, vec3(0.022, 0.028, 0.022), hedge * 0.6);
  float near = 1.0 - smoothstep(8.0, 30.0, dist);
  alb *= 1.0 + near * (noise2(p.xz * vec2(9.0, 3.0)) - 0.5) * 0.7;
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * (0.04 + 1.1 * ndl * ndl) + vec3(0.006, 0.009, 0.016) * (0.6 + 0.4 * n.y));
  col += alb * headlights(p) * 1.1;
  gl_FragColor = vec4(valleyAir(col, p), 1.0);
  ${OUT_GLSL}
}`;

const ROAD_VERT = /* glsl */ `
attribute vec2 road;
varying vec3 vWorld;
varying vec2 vRoad;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vRoad = road;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const ROAD_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec2 vRoad;
${NIGHT_LAND}
void main() {
  vec3 p = vWorld;
  float across = abs(vRoad.y);
  float px = max(fwidth(vRoad.y), 1e-4);
  vec3 alb = vec3(0.060, 0.062, 0.066) * (0.85 + 0.25 * noise2(p.xz * 1.3));
  float edgeLine = smoothstep(0.84 - px, 0.84 + px, across) * (1.0 - smoothstep(0.9 - px, 0.9 + px, across));
  float dash = (1.0 - smoothstep(0.035 - px, 0.035 + px, across)) * step(0.55, fract(vRoad.x / 7.0));
  alb = mix(alb, vec3(0.30, 0.31, 0.32), max(edgeLine * 0.5, dash * 0.7));
  alb = mix(alb, vec3(0.07, 0.08, 0.06), smoothstep(0.9, 1.0, across));
  vec3 col = alb * (MOONLIGHT * 0.55 * uMoon.y + vec3(0.006, 0.009, 0.016));
  col += alb * headlights(p) * 2.4;
  gl_FragColor = vec4(valleyAir(col, p), 1.0);
  ${OUT_GLSL}
}`;

const CAR_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const CAR_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
${NIGHT_LAND}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float glass = step(0.92, vLocal.y) * step(n.y, 0.75) * step(-1.55, vLocal.x) * step(vLocal.x, 1.05);
  vec3 alb = mix(vec3(0.030, 0.036, 0.046), vec3(0.006, 0.008, 0.012), glass);
  vec3 R = reflect(-V, n);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 col = alb * (MOONLIGHT * (0.08 + 0.6 * max(dot(n, uMoon), 0.0)) + vec3(0.004, 0.006, 0.011));
  col += (skyPlain(R, uMoon) * 1.5
    + MOON * pow(max(dot(R, uMoon), 0.0), mix(60.0, 400.0, glass)) * mix(0.25, 0.8, glass)) * fres;
  gl_FragColor = vec4(valleyAir(col, vWorld), 1.0);
  ${OUT_GLSL}
}`;

function carGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-1.98, 0.3);
  s.lineTo(-2.03, 0.78);
  s.quadraticCurveTo(-2.0, 1.02, -1.62, 1.12);
  s.lineTo(-1.38, 1.42);
  s.quadraticCurveTo(-1.28, 1.5, -1.05, 1.5);
  s.lineTo(0.3, 1.48);
  s.quadraticCurveTo(0.5, 1.46, 0.62, 1.36);
  s.lineTo(1.12, 0.98);
  s.quadraticCurveTo(1.8, 0.92, 2.0, 0.78);
  s.quadraticCurveTo(2.07, 0.6, 2.0, 0.3);
  s.lineTo(-1.98, 0.3);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 1.52, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.07, bevelSegments: 2, curveSegments: 5,
  });
  g.translate(0, 0, -0.76);
  return g;
}

function treeGeometry() {
  const pos: number[] = [], nor: number[] = [];
  const v = new THREE.Vector3();
  [[0, 0.82, 0, 0.5], [-0.3, 1.02, 0.1, 0.3], [0.28, 0.96, -0.12, 0.32]].forEach(([x, y, z, r], k) => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      nor.push(v.x, v.y, v.z);
      const lump = 1 + 0.12 * Math.sin(v.x * 7 + k) * Math.sin(v.y * 6 + 0.4) * Math.sin(v.z * 8 + 2.1);
      pos.push(x + v.x * r * lump, y + v.y * r * 0.9 * lump, z + v.z * r * lump);
    }
    g.dispose();
  });
  const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6, 1, true).toNonIndexed();
  const tp = trunk.attributes.position as THREE.BufferAttribute, tn = trunk.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++)
    pos.push(tp.getX(i), tp.getY(i) + 0.25, tp.getZ(i)), nor.push(tn.getX(i), tn.getY(i), tn.getZ(i));
  trunk.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

const TREE_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const TREE_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
${NIGHT_LAND}
void main() {
  vec3 n = normalize(vN);
  float leafy = 0.75 + 0.5 * noise3(vWorld * 1.6);
  vec3 alb = vec3(0.075, 0.098, 0.068) * leafy;
  float wrap = max((dot(n, uMoon) + 0.2) / 1.2, 0.0);
  vec3 col = alb * (MOONLIGHT * (0.02 + 1.1 * wrap * wrap) + vec3(0.004, 0.006, 0.011) * (0.5 + 0.5 * n.y));
  col += alb * headlights(vWorld - vec3(0.0, vWorld.y * 0.6, 0.0)) * 1.4;
  gl_FragColor = vec4(valleyAir(col, vWorld), 1.0);
  ${OUT_GLSL}
}`;

function lampGeometry() {
  const pos = new Float32Array(LAMPS * 4 * 3);
  const idx: number[] = [];
  for (let i = 0; i < LAMPS; i++) {
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y], k) => pos.set([x, y, i], (i * 4 + k) * 3));
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const LAMP_VERT = /* glsl */ `
uniform vec4 uLamp[${LAMPS}];
uniform vec3 uSize;
uniform vec2 uView;
varying vec2 vUv;
varying float vI;
const float GLOW_DEPTH = 0.95;
void main() {
  vec4 l = uLamp[int(position.z + 0.5)];
  vUv = position.xy;
  vI = l.w;
  vec4 view = viewMatrix * vec4(l.xyz, 1.0);
  vec4 clip = projectionMatrix * view;
  vec4 front = projectionMatrix * vec4(view.xyz * GLOW_DEPTH, 1.0);
  float px = clamp(uSize.x * projectionMatrix[1][1] * uView.y * 0.5 / clip.w, uSize.y, uSize.z) * (0.6 + 0.4 * l.w);
  clip.xy += position.xy * px * 2.0 / uView * clip.w;
  clip.z = front.z / front.w * clip.w;
  gl_Position = clip;
}`;
const LAMP_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vI;
void main() {
  float r = length(vUv);
  float core = exp(-r * r / 0.03);
  float halo = exp(-r * 4.5) * (1.0 - smoothstep(0.5, 1.0, r));
  gl_FragColor = vec4(vec3(0.92, 0.96, 1.0) * vI * (core * 5.0 + halo * 0.45), 1.0);
  ${OUT_GLSL}
}`;

export const paintCars: Paint = (scene, camera, time) => {
  const moon = { value: dirOf(ROAD_MOON.az, ROAD_MOON.el) };
  const carAt = { value: Array.from({ length: CAR_SLOTS }, () => new THREE.Vector4()) };
  const carDir = { value: Array.from({ length: CAR_SLOTS }, () => new THREE.Vector2()) };
  const lamps = { value: Array.from({ length: LAMPS }, () => new THREE.Vector4()) };
  const view = { value: new THREE.Vector2(1, 1) };
  const shared = { uMoon: moon, uTime: time, uCarAt: carAt, uCarDir: carDir };

  const SAMPLES = 240;
  const mid = ROAD.getSpacedPoints(SAMPLES);
  for (const m of mid) m.y = land(m.x, m.z);
  const roadLen = ROAD.getLength();
  const NEAR = 12;
  const nearRoad = (x: number, z: number) => {
    let lo = 0, hi = SAMPLES;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (mid[m].z < z - NEAR) lo = m + 1;
      else hi = m;
    }
    let best = Infinity, y = mid[Math.min(lo, SAMPLES)].y;
    for (let i = lo; i <= SAMPLES && mid[i].z <= z + NEAR; i++) {
      const d = (mid[i].x - x) ** 2 + (mid[i].z - z) ** 2;
      if (d < best) (best = d), (y = mid[i].y);
    }
    return { d: Math.sqrt(best), y };
  };

  const ROWS = 130, COLS = 96;
  const pos = new Float32Array((ROWS + 1) * (COLS + 1) * 3);
  for (let i = 0; i <= ROWS; i++) {
    const r = 1.5 + 900 * Math.pow(i / ROWS, 2.4);
    for (let j = 0; j <= COLS; j++) {
      const a = (j / COLS - 0.5) * 100 * DEG;
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      let y = land(x, z);
      if (z < -8 && z > -90 && x > -80 && x < 45) {
        const near = nearRoad(x, z);
        y = near.y + (y - near.y) * smoothstep(ROAD_HALF + 0.6, ROAD_HALF + 6, near.d);
      }
      pos.set([x, y, z], (i * (COLS + 1) + j) * 3);
    }
  }
  const ground = new THREE.BufferGeometry();
  const gi: number[] = [];
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    gi.push(a, a + 1, b, a + 1, b + 1, b);
  }
  ground.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ground.setIndex(gi);
  ground.computeVertexNormals();
  const valley = new THREE.Mesh(
    ground,
    new THREE.ShaderMaterial({ vertexShader: LAND_VERT, fragmentShader: VALLEY_FRAG, uniforms: shared }),
  );
  valley.frustumCulled = false;

  const rp = new Float32Array((SAMPLES + 1) * 2 * 3);
  const rr = new Float32Array((SAMPLES + 1) * 2 * 2);
  const ri: number[] = [];
  const tan = new THREE.Vector3();
  for (let i = 0; i <= SAMPLES; i++) {
    const m = mid[i];
    ROAD.getTangentAt(i / SAMPLES, tan);
    const nx = -tan.z, nz = tan.x;
    const l = Math.hypot(nx, nz);
    for (const [k, s] of [[0, -1], [1, 1]]) {
      rp.set([m.x + (nx / l) * ROAD_HALF * s, m.y + 0.05, m.z + (nz / l) * ROAD_HALF * s], (i * 2 + k) * 3);
      rr.set([(i / SAMPLES) * roadLen, s], (i * 2 + k) * 2);
    }
    if (i < SAMPLES) ri.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const ribbon = new THREE.BufferGeometry();
  ribbon.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  ribbon.setAttribute('road', new THREE.BufferAttribute(rr, 2));
  ribbon.setIndex(ri);
  const road = new THREE.Mesh(
    ribbon,
    new THREE.ShaderMaterial({
      vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG, uniforms: shared,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    }),
  );
  road.frustumCulled = false;

  const body = carGeometry();
  const paint = new THREE.ShaderMaterial({ vertexShader: CAR_VERT, fragmentShader: CAR_FRAG, uniforms: shared });
  const cars = Array.from({ length: CAR_SLOTS }, () => new THREE.Mesh(body, paint));
  const glows = new THREE.Mesh(
    lampGeometry(),
    new THREE.ShaderMaterial({
      vertexShader: LAMP_VERT, fragmentShader: LAMP_FRAG,
      uniforms: { uLamp: lamps, uSize: { value: new THREE.Vector3(1.1, 5, 26) }, uView: view },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  glows.frustumCulled = false;
  glows.renderOrder = 4;
  const rand = rng(41);
  const sites: number[][] = [];
  const plant = (x: number, z: number, big = 1) => {
    const r = nearRoad(x, z);
    if (r.d > ROAD_HALF + 2.2 && -z > 48) sites.push([x, land(x, z), z, (2.8 + 2.2 * rand()) * big]);
  };
  for (const [x0, z0, x1, z1] of [
    [-90, -104, 60, -98], [-70, -62, -20, -138], [25, -60, 70, -140], [-100, -150, 80, -160],
  ]) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 0; s < len; s += 6 + rand() * 7)
      if (rand() > 0.25)
        plant(x0 + ((x1 - x0) * s) / len + (rand() - 0.5) * 2, z0 + ((z1 - z0) * s) / len + (rand() - 0.5) * 2);
  }
  for (let i = 0; i < 40; i++) {
    const m = mid[Math.floor(rand() * SAMPLES)];
    if (rand() > 0.5) plant(m.x + (rand() - 0.5) * 22, m.z + (rand() - 0.5) * 22, 0.9);
  }
  for (const [cx, cz, n] of [[-48, -122, 14], [40, -88, 10], [-22, -170, 16]])
    for (let i = 0; i < n; i++) plant(cx + (rand() - 0.5) * 26, cz + (rand() - 0.5) * 20, 1.15);
  const trees = new THREE.InstancedMesh(
    treeGeometry(),
    new THREE.ShaderMaterial({ vertexShader: TREE_VERT, fragmentShader: TREE_FRAG, uniforms: shared }),
    sites.length,
  );
  const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), ts = new THREE.Vector3(), tp = new THREE.Vector3();
  sites.forEach(([x, y, z, size], i) =>
    trees.setMatrixAt(i, tm.compose(
      tp.set(x, y - 0.1, z),
      tq.setFromAxisAngle(ts.set(0, 1, 0), rand() * 6.3),
      ts.set(size, size * (0.9 + 0.3 * rand()), size),
    )),
  );
  trees.frustumCulled = false;
  scene.add(nightBackdrop(camera, moon, time), valley, road, trees, ...cars, glows);

  let from = 0, to = 1;
  const look = new THREE.Vector3();
  const at = new THREE.Vector3(), ahead = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
  const along = (u: number) => from + (to - from) * u;
  const aim = (t: number) => {
    camera.position.set(0.15 * Math.sin(t * 0.035), EYE, 0);
    camera.lookAt(look.set(0.15 * Math.sin(t * 0.035) + 2 * Math.sin(t * 0.02), EYE + Math.tan(ROAD_PITCH) * 50, -50));
    camera.updateMatrixWorld();
  };
  const placeCar = (u: number) => {
    const k = along(u);
    ROAD.getPointAt(k, at);
    ROAD.getTangentAt(k, ahead);
    at.y = nearRoad(at.x, at.z).y;
    ahead.y = 0;
    ahead.normalize();
  };
  return {
    pose(t, on) {
      aim(t);
      for (let i = 0; i < CAR_SLOTS; i++) {
        const it = on[i];
        const car = cars[i];
        car.visible = !!it;
        carAt.value[i].w = 0;
        lamps.value[i * 2].w = lamps.value[i * 2 + 1].w = 0;
        if (!it) continue;
        placeCar(it.u);
        const yFront = nearRoad(at.x + ahead.x * 2, at.z + ahead.z * 2).y;
        const yBack = nearRoad(at.x - ahead.x * 2, at.z - ahead.z * 2).y;
        car.position.set(at.x, (yFront + yBack) / 2 + 0.05, at.z);
        car.rotation.set(0, Math.atan2(-ahead.z, ahead.x), Math.atan2(yFront - yBack, 4), 'YZX');
        side.set(-ahead.z, 0, ahead.x);
        const fx = at.x + ahead.x * (CAR_LEN / 2), fz = at.z + ahead.z * (CAR_LEN / 2), fy = yFront + 0.05;
        carAt.value[i].set(fx, fy, fz, 1);
        carDir.value[i].set(ahead.x, ahead.z);
        toCam.set(camera.position.x - fx, camera.position.y - fy, camera.position.z - fz).normalize();
        const facing = 0.14 + 0.86 * smoothstep(-0.15, 0.9, ahead.dot(toCam));
        for (const [k, sg] of [[0, -1], [1, 1]])
          lamps.value[i * 2 + k].set(fx + side.x * LAMP_SIDE * sg, fy + LAMP_UP, fz + side.z * LAMP_SIDE * sg, facing);
      }
    },
    where(_n, u, out) {
      placeCar(u);
      return out.copy(at).setY(at.y + 0.7);
    },
    resize(width, height) {
      view.value.set(width, height);
      aim(0);
      const p = new THREE.Vector3();
      let a = 0, b = 1;
      for (let i = 0; i <= 400; i++) {
        const k = i / 400;
        ROAD.getPointAt(k, p);
        p.y = land(p.x, p.z) + 0.7;
        const x = p.project(camera).x;
        if (x < -1.25) a = k;
        if (x > 1.25 && b === 1 && k > a) b = k;
      }
      from = a;
      to = b;
    },
  };
};
