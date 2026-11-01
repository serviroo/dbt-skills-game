import * as THREE from 'three';
import { NIGHT_GLSL, OUT_GLSL, WORLD_VERT } from '../common';
import type { BuildScene } from '../runtime';

/**
 * Cool water: a shallow pale bowl of clear water on a dark slate ledge under the moon, seen from a little above. Every
 * EVERY seconds or so a breath of cool air crosses it: a patch of small slow ripples spreads over the water where it
 * blows, the moon's reflection breaks into a shimmer and the light through the water moves on the bowl's floor, then it
 * settles calm again; a faint mist lifts off the water after each one and fades. Cool, never icy: the water is clear
 * and still between breaths, with nothing frozen anywhere. The moon is the only light, behind the bowl, so its
 * reflection lies on the water just beyond the middle (a bright disc in a soft glow, with a short path of moonlight
 * towards the viewer); everything else is lit by it, with the lantern-blue rim on the bowl's edge.
 */

const FOV = 26;
/** the camera looks down this steeply (degrees), this far from the bowl */
const PITCH = 30;
const DIST = 5.7;
const TARGET = new THREE.Vector3(0, 0.17, 0.05);
/** the moon: behind the bowl and low, so its reflection lies on the water just beyond the middle, clear of the rim */
const MOON_DIR = new THREE.Vector3(-0.0205, 0.45, -0.8928).normalize();

/**
 * The bowl, in tenths of a metre: a 20 cm bowl, 5 cm tall, on a low ring foot (FOOT_R across, up to FOOT_TOP). Its
 * inside is the lower part of an ellipsoid (A across, B deep, centred at CY), which the water's shader traces exactly;
 * the outside is the same shape THICK wider, thicker low down, meeting it in a rounded lip.
 */
const FOOT_R = 0.446;
const FOOT_TOP = 0.1;
const FLOOR_Y = 0.11;
const RIM_Y = 0.46;
const RIM_R = 0.93;
const A = 0.98;
const B = (RIM_Y - FLOOR_Y) / (1 - Math.sqrt(1 - (RIM_R / A) ** 2));
const CY = FLOOR_Y + B;
const THICK = 0.06;
const WATER_Y = 0.38;
const WATER_R = A * Math.sqrt(1 - ((WATER_Y - CY) / B) ** 2);

/** a breath of air starts about every EVERY seconds (JITTER either way), the first FIRST seconds in */
const FIRST = 1.5;
const EVERY = 8;
const JITTER = 1.2;
/** each crosses the water at SPEED, from FRONT upwind of the middle to FRONT past it, and settles over SETTLE seconds */
const SPEED = 0.55;
const FRONT = 1.2;
const SETTLE = 1.4;
/** the way the air mostly blows, across the view from the left and a little towards the viewer (radians, in xz) */
const WIND = 0.35;
/** a mist forms this long after a breath starts and lasts MIST_LIFE seconds */
const MIST_AT = 1.2;
const MIST_LIFE = 7;

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
};
/** breath k: when it starts, how strong it is, how far off the middle it passes and the way it blows */
const gustOf = (k: number) => ({
  at: FIRST + k * EVERY + (hash(k) - 0.5) * JITTER,
  strength: 0.75 + 0.25 * hash(k + 0.3),
  side: (hash(k + 0.7) - 0.5) * 0.5,
  way: WIND + (hash(k + 1.1) - 0.5) * 0.6,
});
/** the last breath to have started by time t, or -1 before the first */
function lastGust(t: number) {
  let k = Math.floor((t - FIRST) / EVERY) + 1;
  while (k >= 0 && gustOf(k).at > t) k--;
  return k;
}
/**
 * reduced motion shows the water settled again after the second breath, its mist just gone, the moon round on it: the
 * mist's wisps come from noise that differs from one GPU to the next, and on some a fading wisp lies over the moon
 */
const STILL_T = gustOf(1).at + MIST_AT + MIST_LIFE + 0.1;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The bowl's profile, from the middle of its base round the foot, up the outside, over the lip and down the inside, and
 * where along it (0..1) the glaze starts, and where the lip starts and ends.
 */
function profile() {
  const pts: THREE.Vector2[] = [];
  const add = (r: number, y: number) => pts.push(new THREE.Vector2(r, y));
  // the recessed base and the ring foot, bevelled where it meets the ledge
  add(0, 0.045);
  add(0.3, 0.045);
  add(0.345, 0.04);
  add(0.36, 0.014);
  add(0.375, 0.0);
  add(0.43, 0.0);
  add(FOOT_R, 0.012);
  const glazeFrom = pts.length;
  const oa = A + THICK, ob = B + THICK;
  const footTop = Math.acos((CY - FOOT_TOP) / ob);
  const rimOut = Math.acos((CY - RIM_Y) / ob);
  for (let i = 0; i <= 22; i++) {
    const a = footTop + (rimOut - footTop) * (i / 22) ** 0.9;
    add(oa * Math.sin(a), CY - ob * Math.cos(a));
  }
  // the lip: a little taller than round, from the outside over the top to the inside
  const lipFrom = pts.length - 1;
  const out = pts[lipFrom].x;
  const mid = (out + RIM_R) / 2, rad = (out - RIM_R) / 2;
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    add(mid + rad * Math.cos(a), RIM_Y + rad * 1.25 * Math.sin(a));
  }
  const lipTo = pts.length;
  const rimIn = Math.acos((CY - RIM_Y) / B);
  for (let i = 0; i <= 30; i++) {
    const a = rimIn * (1 - i / 30) ** 1.1;
    add(A * Math.sin(a), CY - B * Math.cos(a));
  }
  const along = (i: number) => i / (pts.length - 1);
  return { pts, glazeFrom: along(glazeFrom), lip: new THREE.Vector2(along(lipFrom), along(lipTo)) };
}

/** The bowl's shape and how the water inside it moves, shared by every shader in the scene. */
const BOWL_GLSL = /* glsl */ `
uniform vec3 uMoon;
uniform float uTime;
/** each breath: how far its front has come, its strength now, how far off the middle it passes, the way it blows */
uniform vec4 uGust[2];
const float A = ${A.toFixed(4)};
const float B = ${B.toFixed(4)};
const float CY = ${CY.toFixed(4)};
const float RIM_Y = ${RIM_Y.toFixed(4)};
const float RIM_R = ${RIM_R.toFixed(4)};
const float WATER_Y = ${WATER_Y.toFixed(4)};
const float WATER_R = ${WATER_R.toFixed(4)};
const float FLOOR_Y = ${FLOOR_Y.toFixed(4)};
/** the pale glaze, deeper and bluer where it pools in the well, and the grey stoneware where it thins at the lip */
const vec3 GLAZE = vec3(0.56, 0.66, 0.68);
const vec3 POOL = vec3(0.20, 0.34, 0.40);
const vec3 BODY = vec3(0.30, 0.29, 0.28);

/** the light the night sky gives a surface facing n: a little from the sky above, almost none from the dark below */
vec3 skyLight(vec3 n) { return mix(vec3(0.0040, 0.0050, 0.0070), vec3(0.052, 0.072, 0.115), n.y * 0.5 + 0.5); }

/** where a ray from p along d, inside the bowl, meets its inside */
vec3 inside(vec3 p, vec3 d) {
  vec3 s = vec3(A, B, A);
  vec3 o = (p - vec3(0.0, CY, 0.0)) / s, v = d / s;
  float a = dot(v, v), b = dot(o, v), c = dot(o, o) - 1.0;
  return p + d * (-b + sqrt(max(b * b - a * c, 0.0))) / a;
}
/** the inside's normal at h, facing into the bowl */
vec3 insideNormal(vec3 h) { return -normalize((h - vec3(0.0, CY, 0.0)) / vec3(A * A, B * B, A * A)); }
/** how much of the moon reaches p inside the bowl past its far rim, softly at the shadow's edge */
float pastRim(vec3 p, vec3 l) {
  vec3 q = p + l * (RIM_Y - p.y) / l.y;
  return smoothstep(RIM_R + 0.01, RIM_R - 0.06, length(q.xz));
}
/** the glaze inside at h: pooled low in the well, mottled where it ran thicker, thinning to grey at the very lip */
vec3 glazeIn(vec3 h) {
  vec3 c = mix(POOL, GLAZE, smoothstep(FLOOR_Y + 0.005, FLOOR_Y + 0.16, h.y));
  c *= 0.94 + 0.12 * noise3(h * 7.0);
  // faint rings left by throwing it on the wheel, where the glaze lies a little thicker
  float r = length(h.xz);
  c *= 1.0 - 0.035 * smoothstep(0.6, 1.0, sin(r * 55.0 + noise1(r * 7.0) * 4.0 + noise1(atan(h.z, h.x) * 3.0) * 1.5)) * smoothstep(0.1, 0.25, r);
  return mix(c, BODY, smoothstep(RIM_Y - 0.012, RIM_Y + 0.03, h.y) * 0.55);
}
/** the glaze lit by moonlight from l (vis of it gets there) and by amb of the sky's light, seen from V */
vec3 glazeLit(vec3 alb, float rough, vec3 n, vec3 V, vec3 l, float vis, float amb) {
  float ndl = max(dot(n, l), 0.0);
  vec3 col = alb * (MOONLIGHT * ndl * vis + skyLight(n) * amb);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 h = normalize(l + V);
  float a2 = max(rough * rough * rough * rough, 0.0006);
  float d = a2 / (3.14159 * pow(max(dot(n, h), 0.0) * max(dot(n, h), 0.0) * (a2 - 1.0) + 1.0, 2.0));
  col += MOON * min(d, 60.0) * 0.25 * fres * ndl * vis;
  vec3 R = reflect(-V, n);
  col += (skyPlain(R, uMoon) + moonHalo(R, uMoon) * 0.4) * fres * (1.0 - rough) * amb;
  return col;
}
/** the glaze inside the bowl above the water at p, as seen from V */
vec3 innerWall(vec3 p, vec3 V) {
  vec3 n = insideNormal(p);
  // deeper in, less of the sky can be seen past the rim
  float amb = mix(0.35, 0.9, smoothstep(FLOOR_Y, RIM_Y, p.y));
  return glazeLit(glazeIn(p), 0.12, n, V, uMoon, pastRim(p, uMoon), amb);
}

void wave(inout vec3 s, vec2 p, vec2 d, float k, float slope, float w, float ph) {
  float a = dot(p, d) * k - w * uTime + ph;
  s.xy += d * slope * cos(a);
  s.z -= slope * k * sin(a);
}
/**
 * How strongly breath g ruffles the water at p (x: its fine ripples, y: the slower ones spreading on behind it) and
 * the way it blows: an irregular patch behind its front, fading behind it as the ripples die away.
 */
vec2 gustAt(vec4 g, vec2 p, out vec2 dir) {
  dir = vec2(cos(g.w), sin(g.w));
  float s = dot(p, dir), l = dot(p, vec2(-dir.y, dir.x)) - g.z;
  float wide = 0.5 + 0.22 * noise2(vec2(s * 2.2, g.w * 7.0));
  float side = exp(-l * l / (wide * wide)) * (0.65 + 0.35 * noise2(p * 3.5 + g.w * 13.0));
  float behind = max(g.x - s, 0.0);
  float body = smoothstep(g.x + 0.12, g.x - 0.18, s) * side * g.y;
  return body * vec2(exp(-behind / 0.7), exp(-behind / 1.8));
}
/**
 * The water's surface at p: its slope (xy) and how it curves (z), from a calm slow sway that never quite stops and the
 * small ripples of each breath of air, which move slowly with it, bunched in patches and running every way around the
 * way it blows, never in rows. fine gets the slope of the finest ripples too, too small to bend the light much, which
 * only break up the moon's reflection (zero when withFine is false).
 */
vec3 surface(vec2 p, bool withFine, out vec2 fine) {
  vec3 s = vec3(0.0);
  vec3 f = vec3(0.0);
  wave(s, p, vec2(0.80, 0.60), 12.6, 0.0022, 0.55, 0.0);
  wave(s, p, vec2(-0.45, 0.89), 17.0, 0.0018, 0.7, 2.1);
  for (int i = 0; i < 2; i++) {
    if (uGust[i].y <= 0.0) continue;
    vec2 d;
    vec2 e = gustAt(uGust[i], p, d);
    if (e.x + e.y < 0.002) continue;
    float seed = uGust[i].w * 11.0 + float(i) * 5.0;
    vec2 w = p + 0.05 * vec2(noise2(p * 5.0 + seed), noise2(p * 5.0 + seed + 7.3));
    for (int j = 0; j < 6; j++) {
      float fj = float(j);
      float a = (hash1(seed + fj * 1.37) - 0.5) * 1.7;
      vec2 dj = vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
      float k = 38.0 + 42.0 * hash1(seed + fj * 2.71);
      float bunch = 0.25 + 0.75 * noise2(w * 4.5 + fj * 3.1);
      wave(s, w, dj, k, 0.03 * e.x * bunch, k * 0.11, hash1(seed + fj * 0.61) * 6.28);
    }
    wave(s, w, d, 22.0, 0.02 * e.y, 2.4, seed);
    wave(s, w, normalize(d + vec2(-d.y, d.x) * 0.35), 29.0, 0.013 * e.y, 3.0, seed + 2.0);
    if (withFine) {
      // tiny facets tilting every way, drifting with the air
      vec2 g = w * 34.0 - d * uTime * 1.6;
      f.xy += (vec2(noise2(g + seed), noise2(g + seed + 17.0)) - 0.5) * 0.09 * e.x;
    }
  }
  fine = f.xy;
  return s;
}
`;

const BOWL_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vAlong = uv.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/**
 * The bowl: a pale celadon-like glaze over grey stoneware, glossy, catching the moon on its lip and the sky in its
 * curves; the glaze stops in a slightly uneven line above the bare, matte foot. Lit by the moon behind it, so the side
 * facing the viewer is in its own soft shade, with the lantern-blue rim at its edges.
 */
const BOWL_FRAG = /* glsl */ `
uniform vec3 uRim;
uniform vec2 uLip;
uniform float uGlazeFrom;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;
${NIGHT_GLSL}
${BOWL_GLSL}
void main() {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - p);
  float ang = atan(p.z, p.x);
  vec3 col;
  if (vAlong > uLip.y) {
    col = innerWall(p, V);
  } else {
    // outside: glaze down to an uneven line just above the foot, then the bare stoneware
    float edge = 0.13 + 0.012 * noise1(ang * 5.0 + 3.0) + 0.006 * noise1(ang * 19.0);
    float glazed = smoothstep(edge - 0.006, edge + 0.006, p.y) * step(uGlazeFrom, vAlong);
    float lip = smoothstep(uLip.x, mix(uLip.x, uLip.y, 0.5), vAlong) * (1.0 - smoothstep(mix(uLip.x, uLip.y, 0.5), uLip.y, vAlong));
    vec3 glaze = GLAZE * (0.95 + 0.1 * noise3(p * 6.0)) * (1.0 - 0.08 * smoothstep(0.3, 0.13, p.y));
    glaze = mix(glaze, BODY * 1.3, lip * 0.5);
    vec3 clay = BODY * (0.85 + 0.25 * noise3(p * 60.0)) * (0.9 + 0.1 * noise3(p * 9.0));
    vec3 alb = mix(clay, glaze, glazed);
    float rough = mix(0.65, 0.12, glazed);
    // the underside and foot see the dark ledge, not the sky, and sit in the bowl's own shade
    float amb = mix(0.45, 1.0, smoothstep(0.02, 0.3, p.y));
    col = glazeLit(alb, rough, n, V, uMoon, 1.0, amb);
    // the lantern-blue rim, from behind and to the left
    float rim = pow(1.0 - max(dot(n, V), 0.0), 3.5);
    col += uRim * rim * clamp(dot(n, normalize(vec3(-0.7, 0.35, -0.6))) + 0.15, 0.0, 1.0) * 0.12 * smoothstep(0.05, 0.25, p.y);
  }
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/**
 * The water, traced exactly in its bowl: the moon and the sky reflected in its surface (and the glaze above it, near its
 * edge), and through it the bowl's inside, a touch bluer the deeper it is, with the moonlight that comes in past the
 * rim gathered into moving lines by the ripples. The moon's reflection is a bright disc inside a soft sheen that breaks
 * into a shimmer where a breath of air ruffles the water. A thin bright line where the water meets the glaze.
 */
const WATER_FRAG = /* glsl */ `
varying vec3 vWorld;
${NIGHT_GLSL}
${BOWL_GLSL}
const float IOR = 1.333;
void main() {
  vec3 p = vWorld;
  vec3 V = normalize(cameraPosition - p);
  vec2 fine;
  vec3 s = surface(p.xz, true, fine);
  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));

  // through the water: the bowl's inside where the bent ray meets it, lit by moonlight bent the same way
  vec3 T = refract(-V, n, 1.0 / IOR);
  vec3 hit = inside(p, T);
  vec3 hn = insideNormal(hit);
  vec3 lw = -refract(-uMoon, vec3(0.0, 1.0, 0.0), 1.0 / IOR);
  // where that light came in through the surface, and whether it cleared the far rim to get there
  vec3 entry = hit + lw * (WATER_Y - hit.y) / lw.y;
  float lit = pastRim(entry, uMoon) * smoothstep(WATER_R + 0.005, WATER_R - 0.03, length(entry.xz));
  // ripples bend that light into brighter lines and darker gaps on the glaze below, more the deeper it is
  float depth = WATER_Y - hit.y;
  vec2 none;
  float focus = 1.0 / max(0.25, 1.0 + 0.25 * depth * 4.0 * surface(entry.xz, false, none).z);
  vec3 under = glazeLit(glazeIn(hit), 0.3, hn, -T, lw, lit * focus, 0.55 * mix(0.6, 1.0, smoothstep(FLOOR_Y, WATER_Y, hit.y)));
  // clear water takes a little of the red over its length, so deeper reads a touch bluer, never murky
  under *= exp(-length(hit - p) * vec3(0.9, 0.35, 0.22));

  // in the surface: the glaze above the water near the edge, else the night sky with the moon
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  vec3 up = inside(p, R);
  vec3 sky = skyPlain(R, uMoon) + moonHalo(R, uMoon);
  vec3 refl = up.y < RIM_Y ? innerWall(up, -R) : sky;
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 col = mix(under, refl, fres);

  // the moon itself, far brighter than anything it lights: a round disc that wobbles a little with the sway inside a
  // soft glow, and a short path of moonlight from the smallest ripples, which a breath of air shatters into a shimmer
  vec3 nf = normalize(vec3(-s.x * 0.4 - fine.x, 1.0, -s.y * 0.4 - fine.y));
  vec3 Rf = reflect(-V, nf);
  float ffres = 0.02 + 0.98 * pow(1.0 - max(dot(nf, V), 0.0), 5.0);
  float am = acos(clamp(dot(Rf, uMoon), -1.0, 1.0));
  float across = atan(Rf.x, -Rf.z) - atan(uMoon.x, -uMoon.z), down = asin(Rf.y) - asin(uMoon.y);
  float path = exp(-across * across / 0.0002 - down * down / 0.006);
  col += MOON * (smoothstep(0.02, 0.016, am) + 0.35 * exp(-am / 0.014) + 0.1 * exp(-am / 0.035) + 0.04 * exp(-am / 0.09) + 0.05 * path) * ffres * 40.0;

  // the meniscus: where the water climbs the glaze, a thin line catching the sky
  float r = length(p.xz);
  col += MOONLIGHT * 0.05 * exp(-pow((WATER_R - r) / 0.007, 2.0)) * (0.4 + 0.6 * pastRim(p, uMoon));
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/**
 * The ledge: dark slate in thin layers, a cool blue-grey, with a soft sheen where it faces the moon. The bowl's shadow
 * falls towards the viewer, soft further from the bowl, and its foot sits in a little contact shade. Away from the bowl
 * the slate falls into the dark.
 */
const LEDGE_FRAG = /* glsl */ `
varying vec3 vWorld;
${NIGHT_GLSL}
${BOWL_GLSL}
/** the bowl's outside radius at height y */
float outR(float y) {
  float c = clamp((CY - y) / (B + ${THICK.toFixed(3)}), -1.0, 1.0);
  return y < ${FOOT_TOP.toFixed(3)} ? ${FOOT_R.toFixed(3)} : (A + ${THICK.toFixed(3)}) * sqrt(1.0 - c * c);
}
float fbm(vec2 p) { return noise2(p) * 0.5 + noise2(p * 2.1 + 3.7) * 0.3 + noise2(p * 4.3 + 1.9) * 0.2; }
/** the slate's layers at p: long along the ledge, short across it, bent a little */
float slate(vec2 p) {
  vec2 q = p * vec2(0.9, 2.0);
  return fbm(q * 1.4 + vec2(fbm(q * 0.5) * 2.0, 0.0));
}
void main() {
  vec3 p = vWorld;
  vec3 V = normalize(cameraPosition - p);
  // thin layers of slate, run along the ledge and split a little unevenly, with fine grain
  float layer = slate(p.xz);
  float e = 0.01;
  vec2 g = vec2(slate(p.xz + vec2(e, 0.0)) - layer, slate(p.xz + vec2(0.0, e)) - layer) / e * 0.012;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 alb = vec3(0.064, 0.071, 0.084) * (0.85 + 0.3 * layer) * (0.85 + 0.3 * noise2(p.xz * 6.0)) * (0.9 + 0.2 * noise2(p.xz * 37.0));

  // the bowl's shadow: the moon's ray from here checked against the bowl at a few heights, softer further away
  float shade = 0.0;
  for (int i = 0; i < 5; i++) {
    float y = 0.02 + float(i) * 0.095;
    float t = y / uMoon.y;
    float r = length(p.xz + uMoon.xz * t);
    float pen = 0.03 + 0.11 * t;
    shade = max(shade, smoothstep(outR(y) + pen, outR(y) - pen, r));
  }
  float rb = length(p.xz);
  // the sky is hidden a little under the bowl's curve, and more right at its foot
  float ao = (1.0 - 0.45 * exp(-max(rb - 0.44, 0.0) / 0.06)) * mix(0.55, 1.0, smoothstep(0.4, 1.4, rb));
  float ndl = max(dot(n, uMoon), 0.0);
  vec3 col = alb * (MOONLIGHT * 0.8 * ndl * (1.0 - 0.85 * shade) + skyLight(n) * ao);
  // slate is smooth enough for a broad soft sheen of the moon
  vec3 H = normalize(uMoon + V);
  col += MOON * 0.22 * pow(max(dot(n, H), 0.0), 14.0) * (1.0 - shade) * (0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0));
  // away from the bowl the ledge falls into the dark
  col *= 1.0 - smoothstep(1.4, 3.6, length((p.xz - vec2(0.0, -0.1)) * vec2(1.0, 0.75)));
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0008;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const MIST_VERT = /* glsl */ `
varying vec2 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position.xy;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/**
 * A faint mist over the water: soft low wisps that form after a breath of air, lift a little and fade, drifting the way
 * it blew. Moonlight scattered towards the viewer, so it shows only against the dark, never as a glow.
 */
const MIST_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMoon;
/** each wisp: how far through its life (0..1), its strength, where it starts across, its seed */
uniform vec4 uMist[2];
varying vec2 vLocal;
varying vec3 vWorld;
${NIGHT_GLSL}
void main() {
  float d = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 m = uMist[i];
    if (m.y <= 0.0) continue;
    float u = m.x;
    vec2 c = vec2(m.z + 0.3 * u, 0.06 + 0.16 * pow(u, 0.7));
    vec2 r = vec2(0.55 + 0.3 * u, 0.07 + 0.05 * u);
    vec2 o = (vLocal - c) / r;
    float mask = exp(-dot(o, o));
    vec2 q = vLocal * vec2(2.2, 7.0) + vec2(-uTime * 0.12, m.w);
    q += vec2(fbm2(q * 0.7 + 4.0), fbm2(q * 0.7 + 9.0)) * 1.2;
    float wisps = smoothstep(0.25, 0.9, fbm2(q));
    d += mask * wisps * m.y * pow(sin(3.14159 * u), 1.5);
  }
  d *= smoothstep(1.0, 0.7, abs(vLocal.x));
  vec3 V = normalize(vWorld - cameraPosition);
  float toward = 0.5 + 0.5 * pow(max(dot(V, uMoon), 0.0), 2.0);
  gl_FragColor = vec4(MOONLIGHT * 0.55 * d * toward, 1.0);
  ${OUT_GLSL}
}`;

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);
  const time = { value: 0 };
  const moon = { value: MOON_DIR.clone() };
  const gusts = { value: [new THREE.Vector4(), new THREE.Vector4()] };
  const mist = { value: [new THREE.Vector4(), new THREE.Vector4()] };
  const shared = { uTime: time, uMoon: moon, uGust: gusts };

  const { pts, glazeFrom, lip } = profile();
  const bowlGeo = new THREE.LatheGeometry(pts, 128);
  // thrown by hand: the lip rises and falls a touch round the bowl, and the upper wall is not quite round
  const bp = bowlGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    const k = smooth(WATER_Y + 0.02, RIM_Y, y);
    if (k <= 0) continue;
    const a = Math.atan2(z, x);
    const w = 1 + 0.007 * k * (Math.sin(2 * a + 0.4) + 0.6 * Math.sin(3 * a + 2.1));
    bp.setXYZ(i, x * w, y + 0.008 * k * Math.sin(3 * a + 1.3) * smooth(RIM_Y - 0.02, RIM_Y + 0.03, y), z * w);
  }
  const bowl = new THREE.Mesh(
    bowlGeo,
    new THREE.ShaderMaterial({
      vertexShader: BOWL_VERT,
      fragmentShader: BOWL_FRAG,
      uniforms: { ...shared, uRim: { value: accent.clone() }, uLip: { value: lip }, uGlazeFrom: { value: glazeFrom } },
    }),
  );

  const waterGeo = new THREE.CircleGeometry(WATER_R, 128);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(0, WATER_Y, 0);
  const water = new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({ vertexShader: WORLD_VERT, fragmentShader: WATER_FRAG, uniforms: shared }));

  const ledgeGeo = new THREE.PlaneGeometry(14, 12);
  ledgeGeo.rotateX(-Math.PI / 2);
  ledgeGeo.translate(0, 0, -2);
  const ledge = new THREE.Mesh(ledgeGeo, new THREE.ShaderMaterial({ vertexShader: WORLD_VERT, fragmentShader: LEDGE_FRAG, uniforms: shared }));

  // the mist, on an upright sheet through the middle of the bowl, always turned to the viewer
  const mistGeo = new THREE.PlaneGeometry(2.6, 0.7);
  mistGeo.translate(0, 0.35, 0);
  const mistSheet = new THREE.Mesh(
    mistGeo,
    new THREE.ShaderMaterial({ vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, uniforms: { uTime: time, uMoon: moon, uMist: mist }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  mistSheet.position.set(0, WATER_Y - 0.02, 0);
  mistSheet.renderOrder = 2;

  scene.add(ledge, bowl, water, mistSheet);

  /** how much a breath of air ruffles the water now, where it ruffles it most (0 calm), and how much mist is up (0 none) */
  const probe = { breeze: 0, mist: 0 };

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const t = still ? STILL_T : Math.max(0, b.e);
      time.value = t;
      const k = lastGust(t);
      let breeze = 0, wisp = 0;
      for (let i = 0; i < 2; i++) {
        const n = k - i;
        const g = gusts.value[i], m = mist.value[i];
        if (n < 0) {
          g.set(0, 0, 0, 0);
          m.set(0, 0, 0, 0);
          continue;
        }
        const o = gustOf(n);
        const age = t - o.at;
        const front = -FRONT + SPEED * age;
        const strength = o.strength * Math.exp(-Math.max(0, age - (2 * FRONT) / SPEED) / SETTLE);
        g.set(front, strength, o.side, o.way);
        // along its way across the water, as the shader sees it without its ragged edges
        for (let x = -WATER_R; x <= WATER_R; x += 0.05) breeze = Math.max(breeze, strength * smooth(front + 0.12, front - 0.18, x) * Math.exp(-Math.max(front - x, 0) / 0.7));
        const life = (age - MIST_AT) / MIST_LIFE;
        const on = life > 0 && life < 1;
        m.set(on ? life : 0, on ? 0.7 + 0.3 * o.strength : 0, -0.25 - 0.3 * Math.cos(o.way), hash(n + 2.3) * 20);
        if (on) wisp = Math.max(wisp, Math.sin(Math.PI * life) ** 1.5);
      }
      Object.assign(probe, { breeze, mist: wisp });

      // the viewer settles, barely: the camera sways a few millimetres
      const a = THREE.MathUtils.degToRad(PITCH);
      camera.position.set(0.06 * Math.sin(t * 0.045), TARGET.y + DIST * Math.sin(a) + 0.03 * Math.sin(t * 0.06 + 1), TARGET.z + DIST * Math.cos(a));
      camera.lookAt(TARGET);
      camera.updateMatrixWorld();
      mistSheet.rotation.y = Math.atan2(camera.position.x, camera.position.z);
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  };
};
