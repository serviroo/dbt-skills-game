import * as THREE from 'three';
import { glow, NIGHT_GLSL, nightBackdrop, OUT_GLSL } from '../common';
import type { BuildScene, Vignette } from '../runtime';

/**
 * Watching thoughts go by, in the picture the player chose a moment before: clouds drifting past the moon, pairs of
 * soft headlights passing along a quiet road below a hill, or leaves carried down a moonlit stream. Each thing comes
 * in, crosses at a slow steady pace and goes out again; a new one comes along every GAP seconds, so they never pile up,
 * and a few are already on their way when the step starts. Everything is posed from the step's clock.
 */

const FOV = 38;
/** per picture: a new thing every `gap` seconds, each taking `cross` seconds from coming in to going out */
const PACE = { clouds: { gap: 8, cross: 26 }, cars: { gap: 7, cross: 15 }, leaves: { gap: 6.5, cross: 19 } } as const;
type Pic = keyof typeof PACE;

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * The things on their way at time t: their numbers and how far across each is (0 coming in, 1 gone). Thing k starts
 * at k * gap - lead, so a few are already crossing at the start.
 */
function crossing(pic: Pic, t: number) {
  const { gap, cross } = PACE[pic];
  const lead = cross * 0.7;
  const out: { k: number; u: number }[] = [];
  for (let k = Math.floor((t + lead - cross) / gap); k <= Math.floor((t + lead) / gap); k++) {
    const u = (t + lead - k * gap) / cross;
    if (u >= 0 && u < 1) out.push({ k, u });
  }
  // how many have come in and gone out since the step started
  const first = Math.ceil(lead / gap);
  const came = Math.max(0, Math.floor((t + lead) / gap) - first + 1);
  const went = Math.max(0, Math.floor((t + lead - cross) / gap) - first + 1);
  return { out, came, went };
}

// ---------------------------------------------------------------- clouds

const CLOUD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
/** one soft cloud: a few round billows and a frayed base, dark in its middle, silver where the moon catches its edge */
const CLOUD_FRAG = /* glsl */ `
uniform float uSeed;
uniform float uTime;
uniform vec2 uMoon2;
uniform float uNear;
uniform float uFade;
varying vec2 vUv;
${NIGHT_GLSL}
float dens(vec2 p) {
  float d = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = vec2(-0.62 + 1.24 * fi / 5.0 + 0.12 * (hash1(uSeed + fi) - 0.5), -0.08 + 0.18 * sin(fi * 2.1 + uSeed) * (1.0 - abs(fi / 2.5 - 1.0)));
    float r = 0.24 + 0.14 * hash1(uSeed * 3.1 + fi) + 0.08 * (1.0 - abs(fi / 2.5 - 1.0));
    d += exp(-dot(p - c, p - c) / (r * r));
  }
  // a flatter, frayed underside
  d *= smoothstep(-0.42, -0.18, p.y + 0.06 * noise2(p * 7.0 + uSeed));
  return d * (0.7 + 0.5 * fbm2(p * 3.2 + vec2(uSeed * 1.7, uTime * 0.01)));
}
void main() {
  vec2 p = vUv * vec2(1.0, 0.5);
  float d = dens(p);
  float a = smoothstep(0.22, 0.95, d) * uFade;
  if (a < 0.002) discard;
  vec2 e = vec2(0.02, 0.0);
  vec2 g = vec2(dens(p + e.xy) - dens(p - e.xy), dens(p + e.yx) - dens(p - e.yx));
  float lit = clamp(dot(normalize(-g + 1e-4), uMoon2), 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.25, 1.4, d);
  vec3 col = vec3(0.009, 0.012, 0.022) + MOONLIGHT * (0.02 + 0.07 * lit * edge + 0.05 * uNear * (0.4 + 0.6 * edge)) * (0.85 + 0.3 * fbm2(p * 5.0 + uSeed));
  gl_FragColor = vec4(col, a);
  ${OUT_GLSL}
}`;
/** the hills along the bottom of the sky, black against it, their tops just touched by the moon */
const RIDGE_FRAG = /* glsl */ `
uniform vec3 uMoon;
varying vec2 vUv;
${NIGHT_GLSL}
void main() {
  float x = vUv.x * 9.0;
  float top = 0.55 + 0.18 * sin(x * 0.9 + 1.3) + 0.1 * sin(x * 2.3) + 0.05 * noise2(vec2(x * 3.0, 1.0));
  float y = vUv.y * 0.5 + 0.5;
  if (y > top) discard;
  vec3 col = vec3(0.0026, 0.0032, 0.0058) + MOONLIGHT * 0.02 * exp(-(top - y) * 40.0);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

function cloudsScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: { value: number }): (t: number) => void {
  const moon = { value: new THREE.Vector3(0.28, 0.4, -1).normalize() };
  scene.add(nightBackdrop(camera, moon, time));
  const ridge = new THREE.Mesh(new THREE.PlaneGeometry(160, 24), new THREE.ShaderMaterial({ vertexShader: CLOUD_VERT, fragmentShader: RIDGE_FRAG, uniforms: { uMoon: moon } }));
  ridge.position.set(0, -12, -60);
  scene.add(ridge);
  const pool = Array.from({ length: 4 }, () => {
    const moon2 = { value: new THREE.Vector2(0.6, 0.8) };
    const fade = { value: 0 };
    const near = { value: 0 };
    const seed = { value: 0 };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.ShaderMaterial({ vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, uniforms: { uSeed: seed, uTime: time, uMoon2: moon2, uNear: near, uFade: fade }, transparent: true, depthWrite: false }));
    m.renderOrder = 2;
    scene.add(m);
    return { m, fade, near, seed, moon2 };
  });
  const v = new THREE.Vector3();
  const mp = new THREE.Vector3();
  return (t) => {
    camera.position.set(0, 0, 0);
    camera.lookAt(0.6 * Math.sin(t * 0.01), 3.6, -24);
    camera.updateMatrixWorld();
    mp.copy(moon.value).multiplyScalar(50).project(camera);
    const { out } = crossing('clouds', t);
    pool.forEach((c, i) => {
      const it = out[i];
      c.m.visible = !!it;
      if (!it) return;
      const z = -34 - 10 * hash(it.k), w = 13 + 5 * hash(it.k + 7);
      const half = -z * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect + w * 0.6;
      c.m.position.set(-half + 2 * half * it.u, 6.5 + 7 * hash(it.k + 3), z);
      c.m.scale.set(w, w, 1);
      c.m.quaternion.copy(camera.quaternion);
      c.seed.value = it.k * 1.37;
      c.fade.value = 1;
      // its edge brightens as it passes near the moon
      v.copy(c.m.position).project(camera);
      c.near.value = Math.exp(-Math.hypot(v.x - mp.x, v.y - mp.y) * 2.2);
      c.moon2.value.set(mp.x - v.x, mp.y - v.y).normalize();
    });
  };
}

// ---------------------------------------------------------------- cars

/** the road down the valley, from far away to past the viewer on the right */
const ROAD = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-9, 0, -40), new THREE.Vector3(-4, 0, -24), new THREE.Vector3(0.5, 0, -14), new THREE.Vector3(1.8, 0, -7),
  new THREE.Vector3(1.2, 0, -2), new THREE.Vector3(3.6, 0, 3.2), new THREE.Vector3(8, 0, 7),
]);

const LAND_VERT = /* glsl */ `
uniform vec3 uRoadA[48];
varying vec3 vWorld;
float roadDist(vec2 p) {
  float d = 1e3;
  for (int i = 0; i < 47; i++) {
    vec2 a = uRoadA[i].xz, b = uRoadA[i + 1].xz;
    vec2 ab = b - a;
    float h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    d = min(d, length(p - a - ab * h));
  }
  return d;
}
float landH(vec2 p) {
  // the valley floor, the hill the viewer stands on, and far hills rising beyond
  float hill = 3.0 * smoothstep(2.0, 9.0, p.y) * smoothstep(9.0, -2.0, p.x);
  float far = 5.0 * smoothstep(-22.0, -48.0, p.y) * (0.6 + 0.4 * sin(p.x * 0.18 + 1.0));
  float roll = 0.35 * sin(p.x * 0.4 + p.y * 0.3) * smoothstep(1.2, 4.0, roadDist(p));
  return hill + far + roll * smoothstep(-30.0, -10.0, p.y);
}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y = landH(w.xz);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** dark grass and earth under the moon, the road a little smoother, the headlights' light on it, mist far off */
const LAND_FRAG = /* glsl */ `
uniform vec3 uMoon;
uniform float uTime;
uniform vec3 uRoadA[48];
uniform vec4 uCars[3];
varying vec3 vWorld;
${NIGHT_GLSL}
float roadDist(vec2 p, out float along) {
  float d = 1e3;
  along = 0.0;
  for (int i = 0; i < 47; i++) {
    vec2 a = uRoadA[i].xz, b = uRoadA[i + 1].xz;
    vec2 ab = b - a;
    float h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    float dd = length(p - a - ab * h);
    if (dd < d) { d = dd; along = (float(i) + h) / 47.0; }
  }
  return d;
}
void main() {
  vec2 p = vWorld.xz;
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
  float along;
  float rd = roadDist(p, along);
  float road = 1.0 - smoothstep(0.32, 0.4, rd);
  vec3 grass = vec3(0.034, 0.046, 0.046) * (0.75 + 0.5 * noise2(p * 1.3) + 0.2 * noise2(p * 9.0));
  vec3 alb = mix(grass, vec3(0.060, 0.062, 0.070), road);
  // a faint dashed line down the middle of the road
  alb = mix(alb, vec3(0.16, 0.17, 0.19), (1.0 - smoothstep(0.015, 0.03, rd)) * step(0.5, fract(along * 60.0)) * road * 0.5);
  vec3 col = alb * (MOONLIGHT * max(dot(n, uMoon), 0.0) * 1.3 + vec3(0.012, 0.018, 0.03));
  // the headlights light the road a little way ahead of each car
  for (int i = 0; i < 3; i++) {
    vec4 c = uCars[i];
    if (c.w <= 0.0) continue;
    vec2 ahead = c.xy + vec2(cos(c.z), sin(c.z)) * 1.1;
    vec2 rel = p - ahead;
    vec2 local = vec2(dot(rel, vec2(cos(c.z), sin(c.z))), dot(rel, vec2(-sin(c.z), cos(c.z))));
    float pool = exp(-local.x * local.x / 0.9 - local.y * local.y / 0.12);
    col += vec3(0.55, 0.52, 0.46) * pool * 0.12 * c.w * (0.4 + 0.6 * road);
  }
  float dist = length(cameraPosition - vWorld);
  vec3 V = normalize(vWorld - cameraPosition);
  vec3 mist = skyDome(normalize(vec3(V.x, 0.02, V.z)), uMoon, uTime, 0.0) + moonHalo(normalize(vec3(V.x, 0.02, V.z)), uMoon) * 0.6 + vec3(0.002, 0.004, 0.007);
  col = mix(col, mist, smoothstep(12.0, 46.0, dist) * 0.92);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

function carsScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: { value: number }): (t: number) => void {
  const moon = { value: new THREE.Vector3(-0.38, 0.5, -1).normalize() };
  scene.add(nightBackdrop(camera, moon, time));
  const pts = ROAD.getSpacedPoints(47);
  const cars = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  const land = new THREE.PlaneGeometry(90, 70, 150, 120);
  land.rotateX(-Math.PI / 2);
  land.translate(0, 0, -22);
  const ground = new THREE.Mesh(land, new THREE.ShaderMaterial({ vertexShader: LAND_VERT, fragmentShader: LAND_FRAG, uniforms: { uMoon: moon, uTime: time, uRoadA: { value: pts }, uCars: { value: cars } } }));
  ground.frustumCulled = false;
  scene.add(ground);
  // two soft headlights per car, a little apart across the road
  const I = Array.from({ length: 3 }, () => ({ value: 0 }));
  const lights = I.map((intensity) => [0, 1].map(() => {
    const g = glow({ color: new THREE.Color(1.0, 0.95, 0.86), size: 0.75, core: 0.12, halo: 0.4, intensity });
    scene.add(g);
    return g;
  }));
  const at = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
  return (t) => {
    camera.position.set(-1.1, 2.9, 5.9);
    camera.lookAt(0.6 + 0.2 * Math.sin(t * 0.02), -0.2, -7);
    camera.updateMatrixWorld();
    const { out } = crossing('cars', t);
    cars.forEach((c, i) => {
      const it = out[i];
      if (!it) {
        c.set(0, 0, 0, 0);
        I[i].value = 0;
        lights[i].forEach((g) => (g.visible = false));
        return;
      }
      // steady along the road, a little quicker as it nears; far away it is small and dim in the mist
      const u = Math.pow(it.u, 1.25);
      ROAD.getPointAt(u, at);
      ROAD.getTangentAt(u, tan);
      side.set(-tan.z, 0, tan.x).normalize();
      // the cars come towards the viewer, so their lights face back along the road
      const ang = Math.atan2(-tan.z, -tan.x);
      const fade = Math.min(1, it.u * 6) * Math.min(1, (1 - it.u) * 8);
      c.set(at.x, at.z, ang, fade);
      I[i].value = 0.85 * fade;
      lights[i].forEach((g, j) => {
        g.visible = true;
        g.position.copy(at).addScaledVector(side, j ? 0.17 : -0.17);
        g.position.y = 0.16;
      });
    });
  };
}

// ---------------------------------------------------------------- leaves

const STREAM_GLSL = /* glsl */ `
/** the middle of the stream at depth z, and its half width */
float streamX(float z) { return 0.55 * sin(z * 0.42 + 0.6) + 0.12 * sin(z * 1.1); }
const float HALF = 0.82;`;
const STREAM_VERT = /* glsl */ `
varying vec3 vWorld;
${STREAM_GLSL}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float off = abs(w.x - streamX(w.z));
  // the banks rise gently from the water's edge
  w.y = 0.12 * smoothstep(HALF - 0.1, HALF + 0.6, off) + 0.05 * smoothstep(HALF + 0.6, 3.0, off);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** the stream and its banks: dark grass and stones, clear water flowing down with the moon in it */
const STREAM_FRAG = /* glsl */ `
uniform vec3 uMoon;
uniform float uTime;
varying vec3 vWorld;
${NIGHT_GLSL}
${STREAM_GLSL}
void main() {
  vec2 p = vWorld.xz;
  float off = abs(p.x - streamX(p.y));
  float wet = 1.0 - smoothstep(HALF - 0.06, HALF + 0.02, off);
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
  // the banks: grass and a few pale stones near the water
  float stones = smoothstep(0.66, 0.74, noise2(p * 5.0)) * smoothstep(HALF + 0.5, HALF, off);
  vec3 alb = mix(vec3(0.026, 0.036, 0.034) * (0.75 + 0.5 * noise2(p * 3.0) + 0.2 * noise2(p * 20.0)), vec3(0.07, 0.074, 0.08), stones * 0.7);
  vec3 bank = alb * (MOONLIGHT * (0.25 + max(dot(n, uMoon), 0.0)) * 1.2 + vec3(0.01, 0.015, 0.024));
  // the water: flowing towards the viewer, its surface moving with it
  vec2 flow = vec2(0.0, -uTime * 0.32);
  vec2 g = ripples(p * 1.6 + flow, uTime) * 0.22;
  g += vec2(noise2(p * vec2(6.0, 2.0) + flow * 3.0) - 0.5, noise2(p * vec2(2.0, 6.0) + flow * 3.0 + 3.0) - 0.5) * 0.05;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float md = max(dot(R, uMoon), 0.0);
  vec3 bed = vec3(0.05, 0.058, 0.062) * (0.6 + 0.6 * noise2(p * 4.0) + 0.3 * smoothstep(0.6, 0.8, noise2(p * 9.0 + 2.0))) * mix(1.0, 0.55, smoothstep(0.0, HALF, HALF - off));
  // only the moon's small glints show in the moving water, not its whole halo
  vec3 water = mix(bed * vec3(0.72, 0.88, 1.05) * (MOONLIGHT * 0.45 + 0.016), skyPlain(R, uMoon), fres) + MOON * (pow(md, 900.0) * 1.0 + pow(md, 160.0) * 0.015 + pow(md, 10.0) * 0.022);
  // a thin pale line where the water runs past the banks
  water += MOONLIGHT * 0.05 * exp(-pow((off - HALF + 0.05) / 0.03, 2.0)) * (0.5 + 0.5 * noise2(vec2(p.y * 8.0 - uTime * 2.0, p.x)));
  vec3 col = mix(bank, water, wet);
  float dist = length(cameraPosition - vWorld);
  col = mix(col, vec3(0.0024, 0.0030, 0.0062), smoothstep(5.0, 11.0, dist));
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;
const LEAF_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = position.xz;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** a fallen leaf: muted green going brown at its tip, a pale midrib and veins, moonlit, wet at its edge */
const LEAF_FRAG = /* glsl */ `
uniform vec3 uMoon;
uniform float uTint;
varying vec3 vN;
varying vec3 vWorld;
varying vec2 vUv;
${NIGHT_GLSL}
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vWorld);
  float rib = 1.0 - smoothstep(0.004, 0.012, abs(vUv.x));
  float veins = (1.0 - smoothstep(0.0, 0.08, abs(fract(vUv.y * 9.0 - abs(vUv.x) * 6.0) - 0.5) - 0.42)) * 0.4;
  vec3 alb = mix(vec3(0.30, 0.44, 0.33), vec3(0.42, 0.34, 0.22), smoothstep(-0.1, 0.25, vUv.y) * uTint * 0.7);
  alb *= 0.85 + 0.15 * noise2(vUv * 40.0);
  alb = mix(alb, vec3(0.45, 0.5, 0.42), max(rib, veins) * 0.5);
  vec3 col = alb * (MOONLIGHT * max(dot(n, uMoon), 0.0) * 0.6 + vec3(0.012, 0.018, 0.028));
  col += MOON * pow(max(dot(n, normalize(uMoon + V)), 0.0), 50.0) * 0.08;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/** A leaf: a pointed oval with a short stem, gently cupped along its midrib. */
function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.17);
  s.bezierCurveTo(0.07, -0.13, 0.09, 0.04, 0, 0.16);
  s.bezierCurveTo(-0.09, 0.04, -0.07, -0.13, 0, -0.17);
  s.lineTo(0.004, -0.22);
  s.lineTo(-0.004, -0.22);
  s.lineTo(0, -0.17);
  const g = new THREE.ShapeGeometry(s, 16);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, 0.12 * p.getX(i) * p.getX(i) * 8);
  g.computeVertexNormals();
  return g;
}

function leavesScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: { value: number }): (t: number) => void {
  // the moon low over the far end of the stream, so its glints lie up the water, away from the leaves' path
  const moon = { value: new THREE.Vector3(0.12, 0.34, -0.93).normalize() };
  const ground = new THREE.PlaneGeometry(12, 16, 120, 160);
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, -3);
  const stream = new THREE.Mesh(ground, new THREE.ShaderMaterial({ vertexShader: STREAM_VERT, fragmentShader: STREAM_FRAG, uniforms: { uMoon: moon, uTime: time } }));
  stream.frustumCulled = false;
  const back = nightBackdrop(camera, moon, time);
  scene.add(back, stream);
  const geo = leafGeometry();
  const leaves = Array.from({ length: 4 }, () => {
    const tint = { value: 0 };
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG, uniforms: { uMoon: moon, uTint: tint }, side: THREE.DoubleSide }));
    scene.add(m);
    return { m, tint };
  });
  const streamX = (z: number) => 0.55 * Math.sin(z * 0.42 + 0.6) + 0.12 * Math.sin(z * 1.1);
  return (t) => {
    camera.position.set(0.12, 2.35, 2.05);
    camera.lookAt(0.05, 0, -0.8);
    camera.updateMatrixWorld();
    const { out } = crossing('leaves', t);
    leaves.forEach((l, i) => {
      const it = out[i];
      l.m.visible = !!it;
      if (!it) return;
      const z = -6.2 + 9.6 * it.u;
      const lane = 0.42 * (hash(it.k) - 0.5);
      l.m.position.set(streamX(z) + lane + 0.06 * Math.sin(t * 0.5 + it.k), 0.012 + 0.006 * Math.sin(t * 1.3 + it.k * 2), z);
      l.m.rotation.set(0.06 * Math.sin(t * 0.9 + it.k), it.k * 1.9 + t * (0.12 + 0.08 * hash(it.k + 3)) * (it.k % 2 ? 1 : -1), 0.05 * Math.sin(t * 0.7 + it.k));
      const sc = 1.6 + 0.5 * hash(it.k + 5);
      l.m.scale.set(sc, sc, sc);
      l.tint.value = hash(it.k + 9);
    });
  };
}

export const build: BuildScene = (_accent, variant) => {
  const pic: Pic = variant === 'cars' || variant === 'leaves' ? variant : 'clouds';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
  const time = { value: 0 };
  const place = pic === 'cars' ? carsScene(scene, camera, time) : pic === 'leaves' ? leavesScene(scene, camera, time) : cloudsScene(scene, camera, time);
  const probe = { pic: pic as string, came: 0, went: 0, now: 0 };
  const vignette: Vignette = {
    scene,
    camera,
    probe,
    pose(b, still) {
      const t = still ? 0 : Math.max(0, b.e);
      time.value = t;
      place(t);
      const c = crossing(pic, t);
      Object.assign(probe, { came: c.came, went: c.went, now: c.out.length });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  };
  return vignette;
};
