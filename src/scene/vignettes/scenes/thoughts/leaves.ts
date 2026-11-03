import * as THREE from 'three';
import { smoothstep } from '../../../../core/math';
import { THOUGHTS } from '../../../../motion/tokens';
import { hash, NIGHT_GLSL, OUT_GLSL, rng, WORLD_VERT } from '../../common';
import { DEG, dirOf, type Paint } from './picture';

const LEAVES = THOUGHTS.leaves;
const LEAF_SLOTS = Math.ceil(LEAVES.crossSec / LEAVES.spaceSec);
const LEAF_MOON = { az: 5 * DEG, el: 33 * DEG };
const NEAR_BANK = -0.2;
const FAR_BANK = -4.2;
const BANK_H = 0.32;
const LANES = [-2.25, -1.25, -3.05, -1.75, -2.7];
const LEAF_COLOURS = [0x5a2a14, 0x6b4a1c, 0x4a2c18, 0x3e4420].map((c) => new THREE.Color(c));

function bankAt(x: number, z: number, stones: number[][]) {
  let y: number;
  if (z > NEAR_BANK) y = 0.04 + (z - NEAR_BANK) * 0.2;
  else if (z < FAR_BANK) y = BANK_H * smoothstep(FAR_BANK, FAR_BANK - 1.1, z) + (FAR_BANK - z) * 0.04 + 0.04;
  else y = -0.45 * smoothstep(0, 0.9, Math.min(z - FAR_BANK, NEAR_BANK - z));
  y += 0.03 * Math.sin(x * 2.1 + z * 1.3) * Math.sin(x * 0.7 - z * 2.9);
  let stone = 0;
  for (const [sx, sz, r, h] of stones) {
    const d = Math.hypot(x - sx, (z - sz) * 1.25) / r;
    const top = d < 1 ? h * Math.pow(1 - d * d, 0.6) - 0.02 : -Infinity;
    if (top > y) (y = top), (stone = 1 - d);
  }
  return { y, stone };
}

const BANK_VERT = /* glsl */ `
attribute float stone;
varying vec3 vWorld;
varying vec3 vN;
varying float vStone;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vStone = stone;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BANK_FRAG = /* glsl */ `
uniform vec3 uMoon;
varying vec3 vWorld;
varying vec3 vN;
varying float vStone;
${NIGHT_GLSL}
const float NEAR_BANK = ${NEAR_BANK.toFixed(3)};
const float FAR_BANK = ${FAR_BANK.toFixed(3)};
vec3 pebble(vec2 p) {
  vec2 g = floor(p), f = fract(p);
  vec3 best = vec3(0.0, 0.0, -1.0);
  float near = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 h = hash22(g + o);
    float id = hash2(g + o + 17.0);
    float a = id * 6.2831, size = 0.3 + 0.32 * h.y;
    vec2 d = mat2(cos(a), -sin(a), sin(a), cos(a)) * (f - o - 0.5 - 0.36 * (h - 0.5)) / (size * vec2(1.0, 0.68));
    float r = length(d);
    if (r < 1.0 && r < near) { near = r; best = vec3(d, id); }
  }
  return best;
}
void main() {
  vec3 p = vWorld;
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - p);
  vec3 alb;
  float wet = 0.0;
  if (vStone > 0.0) {
    alb = vec3(0.11, 0.115, 0.12) * (0.75 + 0.4 * noise2(p.xz * 9.0 + p.y * 7.0));
    alb = mix(alb, vec3(0.05, 0.07, 0.04),
      smoothstep(0.55, 0.8, noise2(p.xz * 5.0)) * (1.0 - smoothstep(0.1, 0.5, vStone)));
    wet = 1.0 - smoothstep(0.0, 0.08, p.y);
  } else if (p.z > NEAR_BANK - 0.6) {
    vec3 pb = pebble(p.xz * 5.0);
    float on = pb.z < 0.0 ? 0.0 : 1.0 - smoothstep(0.86, 1.0, length(pb.xy));
    vec3 gravel = vec3(0.06, 0.056, 0.052) * (0.5 + 0.9 * noise2(p.xz * 70.0));
    vec3 stoneCol = mix(vec3(0.25, 0.235, 0.21), vec3(0.15, 0.165, 0.185), fract(pb.z * 7.3))
      * mix(0.65, 1.15, fract(pb.z * 13.1));
    alb = mix(gravel, stoneCol, on);
    vec2 lean = pb.xy * 0.9;
    n = normalize(mix(n, normalize(vec3(lean.x, 1.0 - dot(lean, lean) * 0.6, lean.y)), on));
    wet = 1.0 - smoothstep(NEAR_BANK, NEAR_BANK + 0.4, p.z);
  } else {
    float grass = noise2(p.xz * vec2(34.0, 10.0)) * 0.6 + noise2(p.xz * 3.0) * 0.4;
    alb = mix(vec3(0.060, 0.078, 0.048), vec3(0.11, 0.12, 0.07), grass);
    float edge = smoothstep(0.55, 0.85, 1.0 - n.y);
    alb = mix(alb, vec3(0.045, 0.036, 0.030) * (0.7 + 0.6 * noise2(p.xy * vec2(12.0, 30.0))), edge);
    wet = 1.0 - smoothstep(-0.02, 0.12, p.y);
  }
  alb *= mix(1.0, 0.55, wet);
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * (0.1 + 0.8 * ndl) + vec3(0.007, 0.010, 0.018) * (0.5 + 0.5 * n.y));
  vec3 R = reflect(-V, n);
  col += MOON * pow(max(dot(R, uMoon), 0.0), mix(12.0, 90.0, wet)) * mix(0.008, 0.1, wet);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMoon;
uniform float uFlow;
uniform vec4 uLeaf[${LEAF_SLOTS}];
varying vec3 vWorld;
${NIGHT_GLSL}
const float NEAR_BANK = ${NEAR_BANK.toFixed(3)};
const float FAR_BANK = ${FAR_BANK.toFixed(3)};
const float BANK_H = ${BANK_H.toFixed(3)};
void main() {
  vec2 p = vWorld.xz;
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  float t = uTime;
  vec2 q = p - vec2(uFlow * t, 0.0);
  float edge = min(p.y - FAR_BANK, NEAR_BANK - p.y);
  vec2 g = ripples(q * vec2(3.2, 4.4), t * 0.9) * 0.16 + ripples(q * vec2(1.1, 1.5) + 7.0, t * 0.4) * 0.08;
  g *= vec2(0.35, 1.0);
  float e = 0.05;
  float s0 = noise2(vec2(q.x * 0.9, p.y * 2.4) + vec2(0.0, t * 0.05));
  g += vec2(
    noise2(vec2((q.x + e) * 0.9, p.y * 2.4) + vec2(0.0, t * 0.05)) - s0,
    noise2(vec2(q.x * 0.9, (p.y + e) * 2.4) + vec2(0.0, t * 0.05)) - s0
  ) / e * 0.012;
  g *= mix(0.4, 1.0, smoothstep(0.0, 0.9, edge)) * mix(1.0, 0.5, smoothstep(4.0, 12.0, dist));
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 refl = (skyDome(R, uMoon, t, 0.0) + moonHalo(R, uMoon)) * 1.5;
  float md = max(dot(R, uMoon), 0.0);
  vec3 glint = MOON * (pow(md, 3000.0) * 1.5 + pow(md, 500.0) * 0.018 + pow(md, 40.0) * 0.002);
  float run = (p.y - FAR_BANK) / max(-R.z, 1e-3);
  float rise = R.y / max(length(R.xz), 1e-3) * run;
  float bank = R.z < 0.0 ? 1.0 - smoothstep(BANK_H * 0.75, BANK_H * 1.15, rise) : 0.0;
  refl = mix(refl, vec3(0.0016, 0.0020, 0.0028), bank);
  glint *= 1.0 - bank;
  vec3 deep = vec3(0.0009, 0.0024, 0.0056);
  float shallow = 1.0 - smoothstep(0.0, 0.6, edge);
  vec3 bed = vec3(0.020, 0.022, 0.024) * (0.4 + 1.0 * noise2(p * 6.0)) * MOONLIGHT;
  vec3 body = mix(deep, bed, shallow * 0.7);
  vec3 col = mix(body, refl, fres) + glint;
  float lines = smoothstep(0.6, 0.9, noise2(vec2(q.x * 0.45, p.y * 7.0)))
    * smoothstep(0.45, 0.8, noise2(vec2(q.x * 1.3 + 3.0, p.y * 2.0))) * (1.0 - bank);
  col += MOONLIGHT * lines * (0.0008 + 0.01 * pow(md, 8.0)) * smoothstep(0.0, 0.5, edge);
  for (int i = 0; i < ${LEAF_SLOTS}; i++) {
    vec4 l = uLeaf[i];
    float r = length((p - l.xy) * vec2(1.0, 1.4)) / l.z;
    col *= 1.0 - 0.4 * (1.0 - smoothstep(0.4, 1.0, r)) * l.w;
  }
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

function leafGeometry() {
  const ROWS = 16, COLS = 6;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= ROWS; i++) {
    const s = i / ROWS;
    const w = 0.3 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 0.75) * (1 + 0.035 * Math.sin(s * 70));
    for (let j = 0; j <= COLS; j++) {
      const a = (j / COLS) * 2 - 1;
      pos.push(
        s - 0.5,
        0.018 * a * a * (w / 0.3) + 0.02 * Math.sin(Math.PI * s) + 0.012 * Math.sin(a * 2.4 + s * 5),
        a * w,
      );
      uv.push(s, a);
    }
  }
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const base = pos.length / 3;
  for (const [x, y] of [[-0.5, 0.0], [-0.56, 0.01], [-0.62, 0.035]])
    for (const z of [-0.008, 0.008]) (pos.push(x, y, z), uv.push(-0.1, z / 0.008));
  for (let k = 0; k < 2; k++)
    idx.push(base + k * 2, base + k * 2 + 2, base + k * 2 + 1, base + k * 2 + 1, base + k * 2 + 2, base + k * 2 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const LEAF_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vUv = uv;
  vCol = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LEAF_FRAG = /* glsl */ `
uniform vec3 uMoon;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vCol;
${NIGHT_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  float s = vUv.x, a = abs(vUv.y);
  vec3 alb = vCol * (0.85 + 0.3 * noise2(vUv * vec2(9.0, 4.0) + vCol.r * 40.0));
  float rib = 1.0 - smoothstep(0.03, 0.1, a);
  float f = fract(s * 7.0 - a * 2.4);
  float vein = (1.0 - smoothstep(0.04, 0.14, min(f, 1.0 - f))) * (1.0 - smoothstep(0.6, 0.95, a)) * step(0.06, s);
  alb = mix(alb, alb * 1.45 + 0.02, max(rib, vein * 0.5));
  alb = mix(alb, alb * vec3(0.6, 0.5, 0.42), smoothstep(0.75, 1.0, a));
  if (s < 0.0) alb = vec3(0.10, 0.07, 0.045);
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * (0.12 + 0.85 * ndl) + vec3(0.008, 0.011, 0.018));
  vec3 R = reflect(-V, n);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  col += MOON * pow(max(dot(R, uMoon), 0.0), 60.0) * 0.08 + skyPlain(R, uMoon) * fres * 0.5;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

export const paintLeaves: Paint = (scene, camera, time) => {
  const moon = { value: dirOf(LEAF_MOON.az, LEAF_MOON.el) };
  const flow = { value: 0.25 };
  const spots = { value: Array.from({ length: LEAF_SLOTS }, () => new THREE.Vector4()) };

  const rand = rng(23);
  const stones: number[][] = [];
  for (let i = 0; i < 9; i++) {
    const far = i % 2 === 0;
    stones.push([
      (rand() - 0.5) * 8,
      far ? FAR_BANK + 0.1 + rand() * 0.25 : NEAR_BANK - 0.05 + rand() * 0.3,
      0.16 + rand() * 0.2,
      0.1 + rand() * 0.12,
    ]);
  }
  const W = 10, D = 10, NX = 100, NZ = 100;
  const banks = new THREE.PlaneGeometry(W, D, NX, NZ);
  banks.rotateX(-Math.PI / 2);
  banks.translate(0, 0, -3.5);
  const bp = banks.attributes.position as THREE.BufferAttribute;
  const onStone = new Float32Array(bp.count);
  for (let i = 0; i < bp.count; i++) {
    const b = bankAt(bp.getX(i), bp.getZ(i), stones);
    bp.setY(i, b.y);
    onStone[i] = b.stone;
  }
  banks.setAttribute('stone', new THREE.BufferAttribute(onStone, 1));
  banks.computeVertexNormals();
  const bank = new THREE.Mesh(
    banks,
    new THREE.ShaderMaterial({ vertexShader: BANK_VERT, fragmentShader: BANK_FRAG, uniforms: { uMoon: moon } }),
  );
  const surface = new THREE.PlaneGeometry(W, NEAR_BANK - FAR_BANK + 1.2, 1, 1);
  surface.rotateX(-Math.PI / 2);
  surface.translate(0, 0, (NEAR_BANK + FAR_BANK) / 2);
  const water = new THREE.Mesh(
    surface,
    new THREE.ShaderMaterial({
      vertexShader: WORLD_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: { uTime: time, uMoon: moon, uFlow: flow, uLeaf: spots },
    }),
  );
  const leaves = new THREE.InstancedMesh(
    leafGeometry(),
    new THREE.ShaderMaterial({
      vertexShader: LEAF_VERT,
      fragmentShader: LEAF_FRAG,
      uniforms: { uMoon: moon },
      side: THREE.DoubleSide,
    }),
    LEAF_SLOTS,
  );
  leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  leaves.frustumCulled = false;
  for (let i = 0; i < LEAF_SLOTS; i++) leaves.setColorAt(i, LEAF_COLOURS[0]);
  scene.add(bank, water, leaves);

  const look = new THREE.Vector3();
  const reach = LANES.map(() => 4);
  const leafOf = (n: number) => ({
    lane: ((n % LANES.length) + LANES.length) % LANES.length,
    z: LANES[((n % LANES.length) + LANES.length) % LANES.length] + (hash(n + 0.7) - 0.5) * 0.3,
    size: 0.5 + 0.12 * hash(n + 1.9),
    turn: hash(n + 3.3) * Math.PI * 2,
    spin: (hash(n + 5.1) - 0.5) * 0.24,
    colour: LEAF_COLOURS[Math.floor(hash(n + 8.7) * LEAF_COLOURS.length)],
  });
  const aim = (t: number) => {
    camera.position.set(0.04 * Math.sin(t * 0.04), 3.1 + 0.02 * Math.sin(t * 0.06), 2.5);
    camera.lookAt(look.set(0.06 * Math.sin(t * 0.04 + 0.5), 0, -1.9));
    camera.updateMatrixWorld();
  };
  const place = (n: number, u: number, out: THREE.Vector3) => {
    const l = leafOf(n);
    const x = reach[l.lane];
    return out.set(-x + 2 * x * u, 0.01, l.z + 0.12 * Math.sin(u * 4.1 + n));
  };
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    sc = new THREE.Vector3(),
    at = new THREE.Vector3();
  return {
    pose(t, on) {
      aim(t);
      let k = 0;
      for (let i = 0; i < LEAF_SLOTS; i++) {
        const it = on[i];
        spots.value[i].w = 0;
        if (!it) continue;
        const l = leafOf(it.n);
        place(it.n, it.u, at);
        at.y = 0.012 + 0.006 * Math.sin(t * 1.3 + it.n);
        e.set(0.05 * Math.sin(t * 0.9 + it.n * 2.0), l.turn + l.spin * t, 0.04 * Math.sin(t * 1.1 + it.n), 'YXZ');
        q.setFromEuler(e);
        m.compose(at, q, sc.setScalar(l.size));
        leaves.setMatrixAt(k, m);
        leaves.setColorAt(k, l.colour);
        spots.value[i].set(at.x, at.z, l.size * 0.55, 1);
        k++;
      }
      leaves.count = k;
      leaves.instanceMatrix.needsUpdate = true;
      if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    },
    where: (n, u, out) => place(n, u, out),
    resize() {
      aim(0);
      const p = new THREE.Vector3();
      LANES.forEach(
        (z, i) => (reach[i] = 1.3 / (p.set(1, 0.01, z).project(camera).x - p.set(0, 0.01, z).project(camera).x)),
      );
      flow.value = reach.reduce((a, x) => a + 2 * x, 0) / LANES.length / LEAVES.crossSec;
    },
  };
};
