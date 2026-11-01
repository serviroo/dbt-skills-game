import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { backdrop, NOISE_GLSL, OUT_GLSL, pointScale, rng } from '../common';
import type { BuildScene } from '../runtime';

/**
 * Rest with a soft glow: the Lantern set down on a flat stone in soft mist at night. Its light comes through frosted
 * glass, a warm-white heart that cools to the Lantern's blue, inside a wide soft halo, and it brightens and softens once
 * every SWELL seconds, in step with the flat glow. That light is the only light: it falls on the stone and the ground
 * round it, in the mist and on a few motes hovering near it. The six corner posts keep it off in soft spokes, the base
 * and the cap keep it from straight below and above, and the stone keeps it off the ground just beyond its edge. The
 * mist lies low and drifts past slowly. The Lantern sits low in its window, so the countdown above it stays on the dark.
 */

const FOV = 30;
const TAU = Math.PI * 2;
/** one swell of the light: dimmest at the start and brightest halfway, as the flat glow */
const SWELL = 10;
const swellAt = (e: number) => 0.5 - 0.5 * Math.cos((TAU * e) / SWELL);
/** where the light sits in the glass; the glass's corners are R from the middle, from GLASS_LO up to GLASS_HI */
const FLAME = new THREE.Vector3(0, 0.215, 0);
const R = 0.15;
const GLASS_LO = 0.095;
const GLASS_HI = 0.38;
/** the stone's half-widths across and along and its middle, a little in front of the Lantern; its top is at y = 0 */
const STONE = { r: [0.37, 0.31], at: [0.03, 0.05] } as const;
const GROUND = -0.1;
/** the camera: how far out, how high, the side it looks from and the point it looks at */
const DIST = 2.55;
const CAM_Y = 0.86;
const SIDE = 0.55;
const AIM = new THREE.Vector3(0, 0.4, 0);
/** a still frame (reduced motion) is posed this far in, its light near the top of its swell */
const STILL_AT = 6;

const LAMP_GLSL = /* glsl */ `
uniform vec3 uFlame;
uniform float uLight;
/** the Lantern's light where it falls on things, its halo (lantern blue), the ice round its heart and the heart itself */
const vec3 LAMP = vec3(0.32, 0.66, 1.0);
const vec3 HALO = vec3(0.078, 0.48, 1.0);
const vec3 ICE = vec3(0.79, 0.88, 1.0);
const vec3 WARM = vec3(1.0, 0.86, 0.70);
const vec3 AMB = vec3(0.0040, 0.0058, 0.0120);
const float GROUND = ${GROUND.toFixed(3)};
const float GLASS_LO = ${GLASS_LO.toFixed(3)};
const float GLASS_HI = ${GLASS_HI.toFixed(3)};
const float GLASS_R = ${R.toFixed(3)};
const float SIXTH = 1.0471976;
${NOISE_GLSL}
/** the night beyond the mist along d: the void above, the mist's faint blue low down, thickest just under the horizon */
vec3 night(vec3 d) {
  vec3 col = mix(vec3(0.0080, 0.0112, 0.0215), vec3(0.0021, 0.0024, 0.0052), smoothstep(-0.1, 0.45, d.y));
  return col + vec3(0.0022, 0.0032, 0.0060) * exp(-abs(d.y + 0.04) * 8.0);
}
/**
 * How much of the Lantern's light gets out towards p: none steeply down past the base or steeply up into the cap, with a
 * soft edge where the frosted glass ends, and a soft spoke of shade behind each corner post.
 */
float shade(vec3 p) {
  vec3 d = p - uFlame;
  float rise = d.y / max(length(d.xz), 1e-4) * GLASS_R;
  float through = smoothstep(GLASS_LO - uFlame.y - 0.04, GLASS_LO - uFlame.y + 0.01, rise) * (1.0 - smoothstep(GLASS_HI - uFlame.y - 0.02, GLASS_HI - uFlame.y + 0.03, rise));
  // the angle round the Lantern (straight above or below it has none, and is shut off anyway)
  float post = abs(mod(atan(d.x, d.z + 1e-6) + SIXTH * 0.5, SIXTH) - SIXTH * 0.5);
  return through * mix(0.5, 1.0, smoothstep(0.03, 0.13, post));
}
/** the Lantern's light reaching p */
vec3 lampAt(vec3 p) {
  vec3 d = p - uFlame;
  return LAMP * (uLight * shade(p) * 0.6 / (dot(d, d) + 0.03));
}
/**
 * The Lantern's light scattered towards the eye by the misty air along v, up to something far away: a warm-white glow
 * close round the light and a wide faint halo of its blue. It is added in every shader before the tone curve, so it sums
 * as light does instead of piling up on screen.
 */
vec3 airlight(vec3 v, float far) {
  vec3 c = uFlame - cameraPosition;
  float d = length(c - v * clamp(dot(c, v), 0.0, far));
  return (mix(ICE, WARM, 0.5 * exp(-d / 0.06)) * 0.6 * exp(-d / 0.1) + HALO * 0.05 / (1.0 + d * d / 0.1)) * uLight;
}
/** p as seen through the night air: further things sink into the night, the ground fades out well before its edge */
vec3 fogged(vec3 col, vec3 p) {
  vec3 v = p - cameraPosition;
  float far = length(v);
  float k = max(1.0 - exp(-far * 0.14), smoothstep(1.8, 4.6, length(p.xz)));
  return mix(col, night(v / far), k) + airlight(v / far, far);
}`;

const BODY_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** the Lantern's dark iron: lit from inside, so its edges and ledges by the glass catch the glow and its outsides stay dark */
const IRON_FRAG = /* glsl */ `
uniform vec3 uRim;
varying vec3 vWorld;
varying vec3 vN;
${LAMP_GLSL}
void main() {
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 p = vWorld;
  vec3 V = normalize(cameraPosition - p);
  vec3 alb = vec3(0.034, 0.036, 0.041) * (0.75 + 0.5 * noise3(p * 90.0));
  vec3 d = uFlame - p;
  vec3 L = normalize(d);
  vec3 col = alb * LAMP * uLight * 0.6 / (dot(d, d) + 0.03) * max(dot(n, L), 0.0) * 2.0;
  // the glass beside it lights the posts' sides and the ledges above and below the panes, never their outsides
  vec3 outward = normalize(vec3(p.x, 0.0, p.z) + 1e-5);
  float near = exp(-max(length(p.xz) - GLASS_R, 0.0) / 0.016) * smoothstep(GLASS_LO - 0.035, GLASS_LO, p.y) * (1.0 - smoothstep(GLASS_HI, GLASS_HI + 0.035, p.y));
  col += LAMP * uLight * near * (1.0 - max(dot(n, outward), 0.0)) * 0.11;
  col += alb * AMB * 6.0 * (0.6 + 0.4 * n.y);
  col += uRim * pow(1.0 - max(dot(n, V), 0.0), 4.0) * 0.012;
  gl_FragColor = vec4(fogged(col, p), 1.0);
  ${OUT_GLSL}
}`;

/**
 * The frosted glass, lit through from the flame inside: brightest level with it, and the flame itself a soft upright
 * glow on whichever pane is in front of it, warm-white at its heart. Bright values roll off to white instead of
 * clipping, the way a lit lamp looks, so the glass takes no tone curve, which would grey its blue.
 */
const GLASS_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
${LAMP_GLSL}
void main() {
  vec3 p = vWorld;
  vec3 V = normalize(cameraPosition - p);
  vec2 toward = normalize(cameraPosition.xz - uFlame.xz);
  float across = dot(p.xz - uFlame.xz, vec2(toward.y, -toward.x));
  float up = p.y - uFlame.y;
  float heart = exp(-across * across / 0.0028 - (up + 0.01) * (up + 0.01) / 0.012);
  float level = exp(-up * up / 0.011);
  float frost = 0.88 + 0.12 * noise2(vec2(atan(p.x, p.z) * 14.0, p.y * 110.0));
  vec3 col = (mix(HALO, LAMP, level) * (0.3 + 1.1 * level) + WARM * heart * 1.6) * uLight * frost;
  col *= 0.55 + 0.45 * abs(dot(normalize(vN), V));
  gl_FragColor = vec4(1.0 - exp(-fogged(col, p)), 1.0);
  ${OUT_GLSL}
}`;

/**
 * The stone and the pebbles: dark slate, pitted and worn, in broad patches of tone with a fine grain and a few pale
 * flecks, lit by the Lantern so its relief shows, with a damp sheen where the light glances off.
 */
const STONE_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
${LAMP_GLSL}
float relief(vec3 p) { return noise3(p * 16.0) * 0.75 + noise3(p * 43.0) * 0.25; }
void main() {
  vec3 p = vWorld;
  float h0 = relief(p);
  vec3 g = (vec3(relief(p + vec3(0.004, 0.0, 0.0)), relief(p + vec3(0.0, 0.004, 0.0)), relief(p + vec3(0.0, 0.0, 0.004))) - h0) / 0.004;
  vec3 n0 = normalize(vN);
  vec3 n = normalize(n0 - (g - n0 * dot(g, n0)) * 0.01);
  vec3 V = normalize(cameraPosition - p);
  vec3 L = normalize(uFlame - p);
  float grain = noise3(p * 70.0);
  float tone = smoothstep(0.25, 0.75, noise3(p * 4.5 + 2.0));
  float fleck = smoothstep(0.8, 0.92, noise3(p * 160.0));
  vec3 alb = mix(vec3(0.030, 0.033, 0.040), vec3(0.058, 0.062, 0.072), tone) * (0.8 + 0.3 * grain) * (0.55 + 0.45 * smoothstep(0.2, 0.6, h0)) + fleck * 0.015;
  vec3 E = lampAt(p);
  vec3 col = alb * (E * max(dot(n, L) * 0.85 + 0.15, 0.0) + AMB * (0.7 + 0.3 * n.y));
  col += E * pow(max(dot(n, normalize(L + V)), 0.0), 36.0) * 0.05 * (0.3 + grain) * (1.0 - tone * 0.5);
  gl_FragColor = vec4(fogged(col, p), 1.0);
  ${OUT_GLSL}
}`;

/** the ground: dark earth and a little grit, a pool of the Lantern's light round the stone, and the stone's own shadow */
const GROUND_FRAG = /* glsl */ `
uniform vec2 uStone;
uniform vec2 uStoneAt;
varying vec3 vWorld;
${LAMP_GLSL}
void main() {
  vec3 p = vWorld;
  vec2 g = p.xz;
  float soil = noise2(g * 3.0) * 0.6 + noise2(g * 9.0) * 0.4;
  float n2 = noise2(g * 18.0);
  float grit = smoothstep(0.7, 0.8, n2);
  vec3 alb = vec3(0.040, 0.044, 0.052) * (0.55 + 0.7 * soil) + grit * vec3(0.030, 0.033, 0.040);
  vec3 n = normalize(vec3((n2 - noise2(g * 18.0 + vec2(0.18, 0.0))) * 0.9, 1.0, (n2 - noise2(g * 18.0 + vec2(0.0, 0.18))) * 0.9));
  vec3 d = p - uFlame;
  // where the light from the flame passes the stone's top: inside the stone, it never reaches here
  vec2 over = uFlame.xz + d.xz * (uFlame.y / -d.y);
  float past = smoothstep(0.86, 1.12, length((over - uStoneAt) / uStone));
  vec3 E = lampAt(p) * past;
  vec3 col = alb * (E * max(dot(n, normalize(-d)), 0.0) + AMB * 0.8);
  vec3 v = normalize(p - cameraPosition);
  gl_FragColor = vec4(mix(fogged(col, p), night(v) + airlight(v, 1e3), smoothstep(0.9, 3.0, length(p.xz))), 1.0);
  ${OUT_GLSL}
}`;

/** the night behind everything: the void overhead, the mist's faint blue low down and the Lantern's light in the air */
const NIGHT_FRAG = /* glsl */ `
varying vec3 vDir;
${LAMP_GLSL}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = night(d) + airlight(d, 1e3);
  // a whisper of violet high up, where the mist thins
  col += vec3(0.0034, 0.0010, 0.0090) * 0.5 * smoothstep(0.15, 0.6, d.y) * noise2(d.xz * 2.0 + 3.0);
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0008;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const MIST_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** one layer of mist: soft wisps that drift sideways, thickest just above the ground, lit where the Lantern's light reaches */
const MIST_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uDensity;
uniform vec2 uHalf;
varying vec3 vWorld;
varying vec2 vLocal;
${LAMP_GLSL}
float fbm(vec2 p) { return noise2(p) * 0.5 + noise2(p * 2.03 + 1.7) * 0.3 + noise2(p * 4.07 + 5.3) * 0.2; }
void main() {
  vec2 q = vLocal * vec2(1.25, 2.6) + vec2(uTime * 0.04 + uSeed * 7.1, uSeed * 3.3);
  float wisp = smoothstep(0.38, 0.78, fbm(q + 0.7 * fbm(q * 0.5 - vec2(uTime * 0.012, 0.0))));
  float h = vWorld.y - GROUND;
  float low = smoothstep(0.0, 0.08, h) * exp(-h / 0.42);
  float edge = (1.0 - smoothstep(0.55, 1.0, abs(vLocal.x) / uHalf.x)) * (1.0 - smoothstep(0.2, 1.0, vLocal.y / uHalf.y));
  float a = (0.18 + 0.82 * wisp) * low * edge * uDensity;
  vec3 col = AMB * 2.4 + lampAt(vWorld) * 0.15;
  gl_FragColor = vec4(fogged(col, vWorld), a);
  ${OUT_GLSL}
}`;

const MOTE_VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform float uScale;
varying vec3 vLit;
${LAMP_GLSL}
void main() {
  vec3 p = position + vec3(sin(uTime * (0.10 + 0.08 * seed.x) + seed.y * 6.2831), 0.7 * sin(uTime * (0.07 + 0.05 * seed.z) + seed.x * 6.2831), cos(uTime * (0.09 + 0.06 * seed.y) + seed.z * 6.2831)) * 0.05;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale * (0.006 + 0.007 * seed.w) / -mv.z);
  vLit = lampAt(p) * (0.3 + 0.7 * seed.w) * 0.16;
}`;
const MOTE_FRAG = /* glsl */ `
varying vec3 vLit;
void main() {
  float a = 1.0 - smoothstep(0.05, 0.5, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vLit * a, 1.0);
  ${OUT_GLSL}
}`;

/** A smooth bumpy field over the unit sphere: a few seeded waves, for shaping stones. */
function bumps(seed: number, waves: number, freq: number) {
  const rand = rng(seed);
  const list = Array.from({ length: waves }, () => {
    const k = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(freq * (0.6 + 0.8 * rand()));
    return { k, ph: rand() * TAU, amp: 0.5 + rand() };
  });
  const sum = list.reduce((s, w) => s + w.amp, 0);
  return (v: THREE.Vector3) => list.reduce((s, w) => s + w.amp * Math.sin(w.k.dot(v) + w.ph), 0) / sum;
}

/**
 * A flat river stone: a rounded slab `rx` by `rz` across and `ry` above and below its middle, its top flatter than its
 * sides and its outline worn uneven, `flat` keeping the middle of its top level (for the Lantern to rest on).
 */
function stone(rx: number, ry: number, rz: number, at: THREE.Vector3, seed: number, detail: number, flat = 0) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const geo = mergeVertices(ico);
  ico.dispose();
  const big = bumps(seed, 7, 1.6);
  const fine = bumps(seed + 1, 9, 7);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const keep = 1 - flat * THREE.MathUtils.smoothstep(v.y, 0.55, 0.95);
    const k = 1 + (0.32 * big(v) + 0.06 * fine(v)) * keep;
    const y = Math.sign(v.y) * Math.pow(Math.abs(v.y), 0.65);
    pos.setXYZ(i, at.x + v.x * rx * k, at.y + y * ry * (1 + (k - 1) * 0.4), at.z + v.z * rz * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** `g` without shared corners, each face lit flat: the Lantern's six sides are flat sheets of iron and glass */
function facets(g: THREE.BufferGeometry) {
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}
const lathe = (pts: [number, number][]) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 6);

/** The Lantern as it stands: a footed base, six corner posts, a band, a six-sided cap with a chimney and the ring it hangs by. */
function lanternIron() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(facets(lathe([[0.001, 0], [0.19, 0], [0.193, 0.012], [0.182, 0.028], [0.171, 0.04], [0.168, 0.074], [0.177, 0.082], [0.177, 0.093], [0.15, GLASS_LO], [0.001, GLASS_LO]])));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const post = new THREE.BoxGeometry(0.017, GLASS_HI - GLASS_LO + 0.02, 0.017);
    post.rotateY(a);
    post.translate(Math.sin(a) * (R + 0.004), (GLASS_LO + GLASS_HI) / 2, Math.cos(a) * (R + 0.004));
    parts.push(facets(post));
  }
  parts.push(facets(lathe([[0.15, GLASS_HI], [0.168, GLASS_HI], [0.168, GLASS_HI + 0.028], [0.188, GLASS_HI + 0.03], [0.19, GLASS_HI + 0.042], [0.172, GLASS_HI + 0.052], [0.142, GLASS_HI + 0.077], [0.108, GLASS_HI + 0.106], [0.078, GLASS_HI + 0.135], [0.054, GLASS_HI + 0.16], [0.042, GLASS_HI + 0.175], [0.04, GLASS_HI + 0.2], [0.056, GLASS_HI + 0.205], [0.056, GLASS_HI + 0.215], [0.024, GLASS_HI + 0.226], [0.001, GLASS_HI + 0.228]])));
  const ring = new THREE.TorusGeometry(0.034, 0.0065, 8, 28);
  ring.rotateY(0.45);
  ring.translate(0, GLASS_HI + 0.262, 0);
  parts.push(ring.toNonIndexed());
  ring.dispose();
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return geo;
}

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30);
  const time = { value: 0 };
  const light = { value: 1 };
  const scale = { value: 600 };
  const lit = { uFlame: { value: FLAME.clone() }, uLight: light };
  const body = (fragmentShader: string, extra: Record<string, THREE.IUniform> = {}, side: THREE.Side = THREE.FrontSide) =>
    new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader, uniforms: { ...lit, ...extra }, side });

  const sky = backdrop(camera, NIGHT_FRAG, lit);

  const groundGeo = new THREE.CircleGeometry(7, 72);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(0, GROUND, 0);
  const ground = new THREE.Mesh(groundGeo, body(GROUND_FRAG, { uStone: { value: new THREE.Vector2(...STONE.r) }, uStoneAt: { value: new THREE.Vector2(...STONE.at) } }));

  // the stone the Lantern rests on, sunk a little into the ground, and a few pebbles round it
  const stones = [stone(STONE.r[0], 0.1, STONE.r[1], new THREE.Vector3(STONE.at[0], -0.1, STONE.at[1]), 11, 4, 0.85)];
  const rand = rng(17);
  for (const [x, z, s] of [[-0.68, 0.32, 0.07], [0.62, 0.42, 0.05], [0.78, -0.2, 0.085], [-0.45, -0.62, 0.06], [0.2, 0.78, 0.04]]) {
    stones.push(stone(s * (1 + rand() * 0.4), s * 0.55, s, new THREE.Vector3(x, GROUND + s * 0.25, z), 30 + Math.round(rand() * 100), 2));
  }
  const stoneGeo = mergeGeometries(stones);
  for (const s of stones) s.dispose();
  const rock = new THREE.Mesh(stoneGeo, body(STONE_FRAG));

  const iron = new THREE.Mesh(lanternIron(), body(IRON_FRAG, { uRim: { value: accent.clone() } }, THREE.DoubleSide));
  const glassGeo = facets(new THREE.CylinderGeometry(R, R, GLASS_HI - GLASS_LO, 6, 1, true));
  glassGeo.translate(0, (GLASS_LO + GLASS_HI) / 2, 0);
  const glass = new THREE.Mesh(glassGeo, body(GLASS_FRAG));
  glass.material.toneMapped = false;

  // mist: layers behind the Lantern and a thin one or two in front, each drifting at its own pace
  const look = new THREE.Vector3(Math.sin(SIDE), 0, Math.cos(SIDE));
  const mists: THREE.Mesh[] = [];
  for (const [z, w, ht, density, seed] of [[-2.2, 4.4, 2.2, 0.75, 1], [-1.2, 3.2, 1.7, 0.6, 2], [-0.55, 2.6, 1.4, 0.45, 3], [0.62, 2.0, 1.1, 0.28, 4], [1.15, 1.6, 0.9, 0.18, 5]]) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, ht * 2),
      new THREE.ShaderMaterial({ vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, uniforms: { ...lit, uTime: time, uSeed: { value: seed }, uDensity: { value: density }, uHalf: { value: new THREE.Vector2(w / 2, ht) } }, transparent: true, depthWrite: false }),
    );
    m.position.copy(look).multiplyScalar(z).setY(GROUND);
    mists.push(m);
  }

  const n = 34;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = 0.26 + 0.7 * Math.sqrt(rand()), a = rand() * TAU;
    pos.set([Math.sin(a) * r, 0.05 + rand() * 0.6, Math.cos(a) * r], i * 3);
    seed.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  moteGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const motes = new THREE.Points(moteGeo, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { ...lit, uTime: time, uScale: scale }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false;
  motes.renderOrder = 3;

  scene.add(sky, ground, rock, iron, glass, ...mists, motes);
  const probe = { swell: 0, x: 0.5, y: 0.5 };
  const at = new THREE.Vector3();

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const e = still ? STILL_AT : Math.max(0, b.e);
      const s = swellAt(e);
      light.value = 0.62 + 0.38 * s;
      time.value = e;
      // the camera sways a little round the Lantern, once a minute and more
      const a = SIDE + 0.16 * Math.sin((TAU * e) / 75);
      camera.position.set(Math.sin(a) * DIST, CAM_Y + 0.025 * Math.sin((TAU * e) / 47), Math.cos(a) * DIST);
      camera.lookAt(AIM);
      camera.updateMatrixWorld();
      for (const m of mists) m.quaternion.copy(camera.quaternion);
      at.copy(FLAME).project(camera);
      Object.assign(probe, { swell: s, x: 0.5 + at.x / 2, y: 0.5 - at.y / 2 });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      scale.value = pointScale(FOV, height);
    },
  };
};
