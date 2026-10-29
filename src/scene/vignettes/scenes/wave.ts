import * as THREE from 'three';
import { glow, NIGHT_GLSL, nightBackdrop, OUT_GLSL } from '../common';
import type { Beat } from '../host';
import type { BuildScene } from '../runtime';

/**
 * Urge Surfing's wave: a moonlit night sea seen from just above the water. Long smooth swells roll in from the left,
 * one every PERIOD seconds (three in the 90 s ride), lift the small board in the middle, crest gently and pass on; in
 * between the sea settles back to calm. Swells never steepen or break. The board rides on the surface the whole time,
 * tilting with its slope, carrying a small lantern whose light pools on the water around it. The only light sources are
 * the moon (with its path on the water) and the lantern, each a bright core inside a soft halo. The camera follows the
 * board only a little, so a swell is seen lifting it towards the horizon; the moon is placed in the frame, not the world,
 * so it shows whole at every size.
 */

const FOV = 30;
/** the first swell reaches the board this many seconds in, then one every PERIOD */
const FIRST = 15;
const PERIOD = 30;
/** how fast a swell travels, in units a second, and how wide it is */
const SPEED = 0.26;
const WIDTH = 1.8;
/** each swell's height; the middle one of the three is the biggest, the way an urge peaks and falls */
const AMP = [0.5, 0.92, 0.6];
const ampOf = (i: number) => (i < 0 ? 0 : (AMP[i] ?? 0.5));
const DIR = new THREE.Vector2(1, 0.35).normalize();
/** where the moon's middle sits in the frame at rest (-1..1 across and up): high on the left, clear of every edge */
const MOON_AT = new THREE.Vector2(-0.46, 0.6);
/** the camera at rest, and how much of the board's rise it follows (eye and gaze) */
const EYE = new THREE.Vector3(0, 0.95, 4.9);
const GAZE = 0.53;
const FOLLOW = { eye: 0.25, gaze: 0.25 };
const YAW = 0.36;
/** how far the board's middle sits above the water around it: it floats, a little sunk */
const FLOAT = 0.012;
/** reduced motion shows the board on the front of the first swell */
const STILL_T = 11;
const LAMP = new THREE.Color('#4fb8ff');

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The swells near time t as (where it is along DIR, height) pairs: the one passing the board and its neighbours. */
function ridgesAt(t: number, out: THREE.Vector2[]) {
  const i0 = Math.floor((t - FIRST) / PERIOD) - 1;
  out.forEach((r, k) => r.set(SPEED * (t - (FIRST + PERIOD * (i0 + k))), ampOf(i0 + k)));
}

/** The sea's height at (x, z): the swells, a little lower towards the viewer and far out, plus two small slow waves. */
function seaAt(x: number, z: number, t: number, ridges: THREE.Vector2[]) {
  const u = x * DIR.x + z * DIR.y;
  const w = -x * DIR.y + z * DIR.x;
  let h = 0;
  for (const r of ridges) {
    const d = (u - r.x) / WIDTH;
    h += r.y * Math.exp(-d * d);
  }
  h *= (1 - 0.6 * smooth(1, 5, z)) * (0.82 + 0.18 * Math.cos(w * 0.23 + 1.3)) * Math.exp(-Math.max(0, -z - 8) / 14);
  const small = 0.034 * Math.sin((x * 0.83 + z * 0.55) * 0.95 - 0.52 * t) + 0.022 * Math.sin((x * -0.42 + z * 0.91) * 1.45 - 0.74 * t + 1.3);
  return h + small * Math.exp(-Math.max(0, -z - 10) / 20);
}

/** The same sea in GLSL; it has to match seaAt exactly, so the board rides the surface that is drawn. */
const SEA_GLSL = /* glsl */ `
const vec2 DIR = vec2(${DIR.x.toFixed(6)}, ${DIR.y.toFixed(6)});
const float WIDTH = ${WIDTH.toFixed(3)};
uniform vec2 uRidge[4];
uniform float uTime;
float swells(vec2 p) {
  float u = dot(p, DIR);
  float w = dot(p, vec2(-DIR.y, DIR.x));
  float h = 0.0;
  for (int i = 0; i < 4; i++) { float d = (u - uRidge[i].x) / WIDTH; h += uRidge[i].y * exp(-d * d); }
  return h * (1.0 - 0.6 * smoothstep(1.0, 5.0, p.y)) * (0.82 + 0.18 * cos(w * 0.23 + 1.3)) * exp(-max(0.0, -p.y - 8.0) / 14.0);
}
float seaH(vec2 p, float t) {
  float small = 0.034 * sin(dot(p, vec2(0.83, 0.55)) * 0.95 - 0.52 * t) + 0.022 * sin(dot(p, vec2(-0.42, 0.91)) * 1.45 - 0.74 * t + 1.3);
  return swells(p) + small * exp(-max(0.0, -p.y - 10.0) / 20.0);
}`;

const SEA_VERT = /* glsl */ `
varying vec3 vWorld;
${SEA_GLSL}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y = seaH(w.xz, uTime);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SEA_FRAG = /* glsl */ `
uniform vec3 uMoon;
uniform vec3 uLamp;
uniform vec3 uLampCol;
uniform vec4 uBoard;
varying vec3 vWorld;
${NIGHT_GLSL}
${SEA_GLSL}
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float dist = length(cameraPosition - vWorld);
  float e = 0.05;
  vec2 g = vec2(seaH(p + vec2(e, 0.0), t) - seaH(p - vec2(e, 0.0), t), seaH(p + vec2(0.0, e), t) - seaH(p - vec2(0.0, e), t)) / (2.0 * e);
  // small wind waves on top, fading with distance where they would only shimmer
  float fine = 1.0 - smoothstep(6.0, 24.0, dist);
  g += ripples(p, t) * mix(0.35, 1.0, fine);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float h0 = swells(p);

  // the sky in the water, without stars, cloud or the moon's disc: the moon shows as its path, a sparkle inside a sheen
  vec3 sky = skyPlain(R, uMoon) + moonHalo(R, uMoon) * 0.6;
  // the glints in the moon's path come from finer ripples still, too small to bend the rest of the reflection
  vec2 fg = vec2(0.0);
  float jitter = noise2(p * 1.3) * 4.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float a = 0.2 + fi * 1.3;
    vec2 d = vec2(cos(a), sin(a));
    float k = 9.0 + fi * 4.0;
    fg += d * 0.05 * cos(dot(p, d) * k - sqrt(9.8 * k) * 0.3 * t + fi * 2.1 + jitter);
  }
  vec3 Rg = reflect(-V, normalize(N + vec3(-fg.x, 0.0, -fg.y) * fine));
  float md = max(dot(R, uMoon), 0.0);
  float rough = mix(1.0, 0.3, smoothstep(4.0, 26.0, dist));
  float path = pow(max(dot(Rg, uMoon), 0.0), 2200.0 * rough) * 3.2 + pow(md, 140.0 * rough) * 0.12 + pow(md, 24.0) * 0.018;
  // deep blue in the troughs, a little lighter and greener where the swell is thin and the moon shines through
  vec3 body = mix(vec3(0.0010, 0.0028, 0.0070), vec3(0.0026, 0.0085, 0.0150), smoothstep(0.05, 0.6, h0));
  body += vec3(0.0010, 0.0050, 0.0060) * smoothstep(0.25, 0.65, h0) * max(dot(normalize(vec3(-V.x, 0.0, -V.z)), normalize(vec3(uMoon.x, 0.0, uMoon.z))), 0.0);
  vec3 col = mix(body, sky, fres) + MOON * path * (0.35 + fres);

  // the lantern: its reflection under the board and a soft pool of its light on the water
  vec3 toL = uLamp - vWorld;
  float dl = length(toL);
  vec3 L = toL / dl;
  float pool = 0.010 / (0.06 + dl * dl);
  col += uLampCol * (pow(max(dot(R, L), 0.0), 90.0) * 0.5 / (1.0 + dl * dl * 2.0) + pool * (0.2 + 0.8 * max(dot(N, L), 0.0)));

  // soft foam: streaks along each crest, a fine drifting lace, and a ring where the board meets the water
  float foam = 0.0;
  float u = dot(p, DIR), w = dot(p, vec2(-DIR.y, DIR.x));
  for (int i = 0; i < 4; i++) {
    float d = (u - uRidge[i].x) / WIDTH;
    float top = exp(-d * d * 5.0) * smoothstep(0.3, 0.6, uRidge[i].y);
    if (top > 0.01) foam += top * smoothstep(0.54, 0.82, fbm2(vec2(w * 0.8, (u - uRidge[i].x) * 2.4) + float(i) * 7.3));
  }
  float lace = fbm2(p * vec2(0.9, 1.3) + vec2(t * 0.03, t * 0.02));
  foam += (smoothstep(0.6, 0.63, lace) - smoothstep(0.64, 0.69, lace)) * 0.4 * fine;
  vec2 rel = p - uBoard.xy;
  vec2 local = vec2(dot(rel, vec2(uBoard.z, -uBoard.w)), dot(rel, vec2(uBoard.w, uBoard.z)));
  float ell = length(local / vec2(0.5, 0.16));
  foam += smoothstep(0.92, 1.1, ell) * smoothstep(1.8, 1.1, ell) * (0.45 + 0.55 * noise2(local * 16.0 + t * 0.4));
  foam = clamp(foam, 0.0, 1.0) * (1.0 - smoothstep(9.0, 28.0, dist));
  col = mix(col, MOONLIGHT * 0.06 * (0.6 + 0.4 * max(N.y, 0.0)) + uLampCol * pool * 0.5, foam * 0.5);

  // far out the sea sinks into the haze along the horizon
  vec3 h = normalize(vec3(-V.x, 0.0, -V.z));
  col = mix(col, skyPlain(h, uMoon) + moonHalo(h, uMoon), smoothstep(12.0, 62.0, dist));
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

const MOON_VERT = /* glsl */ `
uniform float uSize;
varying vec3 vDir;
void main() {
  // a square of sky round the moon, facing the camera; each pixel looks along its own direction
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  vDir = transpose(mat3(viewMatrix)) * mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
/**
 * The sky round the moon drawn again, the same as the night behind it, with the moon as a light: a bright disc with soft
 * grey seas, a core of light hugging it and a wide soft halo, both gone before the square's edge so it meets the sky.
 */
const MOON_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMoon;
varying vec3 vDir;
${NIGHT_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float a = acos(clamp(dot(d, uMoon), -1.0, 1.0));
  vec3 u = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
  vec2 q = vec2(dot(d, u), dot(d, cross(u, uMoon))) / MOON_R;
  float r = length(q);
  float disc = smoothstep(1.0, 1.0 - max(fwidth(r), 1e-3) * 1.2, r);
  float seas = smoothstep(0.42, 0.78, fbm2(q * 1.7 + vec2(4.0, 1.3)));
  float limb = 0.7 + 0.3 * sqrt(max(0.0, 1.0 - r * r));
  vec3 col = skyDome(d, uMoon, uTime, 1.0) + moonHalo(d, uMoon);
  col += MOON * 4.2 * (1.0 - 0.5 * seas) * limb * disc;
  float off = max(a - MOON_R, 0.0);
  col += MOON * (0.45 * exp(-off / (MOON_R * 0.45)) + 0.05 * exp(-off / (MOON_R * 1.4))) * smoothstep(MOON_R * 0.9, MOON_R * 1.05, a) * (1.0 - smoothstep(0.2, 0.28, a));
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.0009;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;
/** how far out the moon's square sits, inside the far plane, and its half-width as an angle (radians) */
const MOON_FAR = 90;
const MOON_SPAN = 0.3;

const BODY_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNObj;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vObj = position;
  vNObj = normal;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** the board and the lantern's metal: moonlit, lit by the lantern, with a lantern-blue rim */
const BODY_FRAG = /* glsl */ `
uniform vec3 uMoon;
uniform vec3 uLamp;
uniform vec3 uLampCol;
uniform vec3 uRim;
uniform vec3 uAlbedo;
uniform float uDeck;
varying vec3 vObj;
varying vec3 vNObj;
varying vec3 vN;
varying vec3 vWorld;
${NIGHT_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 alb = uAlbedo;
  if (uDeck > 0.5) {
    // a thin stringer down the middle of the deck, darker rails, a darker underside, a faint grain along the length
    float top = smoothstep(-0.2, 0.4, normalize(vNObj).y);
    alb *= 1.0 - 0.32 * (1.0 - smoothstep(0.0035, 0.008, abs(vObj.z))) * top;
    alb *= 1.0 - 0.22 * (1.0 - smoothstep(0.2, 0.65, abs(normalize(vNObj).y)));
    alb *= mix(0.5, 1.0, top);
    alb *= 0.94 + 0.06 * noise2(vec2(vObj.x * 6.0, vObj.z * 90.0));
  }
  float wrap = max((dot(n, uMoon) + 0.35) / 1.35, 0.0);
  vec3 col = alb * (MOONLIGHT * wrap * 0.2 + vec3(0.004, 0.007, 0.014) * (0.6 + 0.4 * n.y));
  vec3 toL = uLamp - vWorld;
  float dl = length(toL);
  col += alb * uLampCol * max(dot(n, toL / dl), 0.0) * 0.022 / (0.012 + dl * dl);
  vec3 H = normalize(uMoon + V);
  col += MOON * pow(max(dot(n, H), 0.0), 70.0) * 0.18;
  col += uRim * pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.16;
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/** the lantern's glass: lit from inside, brightest in the middle, crossed by its four thin frame bars */
const GLASS_FRAG = /* glsl */ `
uniform vec3 uLampCol;
uniform float uLit;
varying vec3 vObj;
varying vec3 vNObj;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  float a = atan(vObj.z, vObj.x);
  float bars = smoothstep(0.86, 0.94, abs(cos(a * 2.0)));
  float mid = 1.0 - smoothstep(0.0, 0.04, abs(vObj.y));
  vec3 col = mix(uLampCol * 0.9, vec3(0.85, 0.95, 1.0) * 1.6, mid * 0.6) * uLit * (0.55 + 0.45 * mid);
  col = mix(col, vec3(0.012, 0.014, 0.02), bars * 0.85);
  gl_FragColor = vec4(col, 1.0);
  ${OUT_GLSL}
}`;

/** A short board: a long rounded slab, fuller behind the middle, its nose narrowing to a soft point. */
function boardGeometry() {
  const geo = new THREE.SphereGeometry(1, 64, 24);
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // x runs tail (-1) to nose (+1); the outline narrows towards the nose and a little at the tail
    const width = 0.16 * (1 - 0.55 * Math.pow(Math.max(0, v.x), 1.6)) * (1 - 0.18 * Math.pow(Math.max(0, -v.x), 3));
    const y = Math.sign(v.y) * Math.pow(Math.abs(v.y), 0.6);
    // a little rocker: the nose lifts
    const lift = 0.035 * Math.pow(Math.max(0, v.x), 2.4);
    pos.setXYZ(i, v.x * 0.5, y * 0.032 + lift, v.z * width);
  }
  geo.computeVertexNormals();
  return geo;
}

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 2, 0.1, 120);
  const look = new THREE.Vector3();
  const time = { value: 0 };
  const moon = { value: new THREE.Vector3(-0.3, 0.1, -1).normalize() };
  // the camera at rest, to place the moon in the frame
  const rest = new THREE.PerspectiveCamera(FOV, 2, 0.1, 120);
  const ridges = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
  const lampAt = { value: new THREE.Vector3() };
  const lampCol = { value: LAMP.clone() };
  const boardAt = { value: new THREE.Vector4(0, 0, Math.cos(YAW), Math.sin(YAW)) };
  const lit = { value: 1 };

  // the sea: a grid that is fine near the board and coarser towards the horizon
  const sea = new THREE.PlaneGeometry(1, 1, 150, 130);
  sea.rotateX(-Math.PI / 2);
  const sp = sea.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const u = sp.getX(i), v = sp.getZ(i) + 0.5;
    const z = 6.5 - 76.5 * Math.pow(1 - v, 2.1);
    sp.setXYZ(i, u * (9 + (6.5 - z) * 1.25), 0, z);
  }
  const seaMesh = new THREE.Mesh(
    sea,
    new THREE.ShaderMaterial({
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      uniforms: { uTime: time, uRidge: { value: ridges }, uMoon: moon, uLamp: lampAt, uLampCol: lampCol, uBoard: boardAt },
    }),
  );
  seaMesh.frustumCulled = false;

  const bodyUniforms = (albedo: string, deck: number) => ({ uMoon: moon, uLamp: lampAt, uLampCol: lampCol, uRim: { value: accent.clone() }, uAlbedo: { value: new THREE.Color(albedo) }, uDeck: { value: deck } });
  const body = (geo: THREE.BufferGeometry, albedo: string, deck = 0) => new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, uniforms: bodyUniforms(albedo, deck) }));

  const rider = new THREE.Group();
  const board = body(boardGeometry(), '#c9d6e4', 1);
  // the lantern: a dark base, its glass, a cap and a small ring handle, set just behind the middle of the deck
  const lantern = new THREE.Group();
  lantern.position.set(-0.1, 0.03, 0);
  const base = body(new THREE.CylinderGeometry(0.042, 0.048, 0.022, 20), '#1a1f27');
  base.position.y = 0.011;
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.074, 20, 1, true), new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: GLASS_FRAG, uniforms: { uLampCol: lampCol, uLit: lit } }));
  glass.position.y = 0.059;
  const cap = body(new THREE.ConeGeometry(0.05, 0.034, 20), '#1a1f27');
  cap.position.y = 0.113;
  const ring = body(new THREE.TorusGeometry(0.022, 0.0045, 8, 20, Math.PI), '#1a1f27');
  ring.position.y = 0.128;
  const light = glow({ color: LAMP.clone(), size: 0.36, core: 0.11, halo: 0.22, intensity: lit });
  light.position.y = 0.059;
  lantern.add(base, glass, cap, ring, light);
  rider.add(board, lantern);

  // the moon's own sky, drawn over the night behind and under the sea, which hides it below the horizon
  const moonSky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: MOON_VERT, fragmentShader: MOON_FRAG, uniforms: { uTime: time, uMoon: moon, uSize: { value: MOON_FAR * Math.tan(MOON_SPAN) } }, depthWrite: false }));
  moonSky.frustumCulled = false;
  moonSky.renderOrder = -0.5;

  scene.add(nightBackdrop(camera, moon, time), moonSky, seaMesh, rider);

  // more time after Done picks the sea up where it stopped instead of jumping ahead
  let gap = 0;
  let prev: Beat | null = null;
  const probe = { t: 0, board: 0 };
  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3(), basis = new THREE.Matrix4();

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const e = Math.max(0, b.e);
      if (prev?.done && !b.done) gap += Math.max(0, e - prev.e);
      prev = { ...b };
      const t = still ? STILL_T : e - gap;
      ridgesAt(t, ridges);

      // the board rides the surface: its middle on the water, its deck along the slope
      const y = seaAt(0, 0, t, ridges);
      const d = 0.04;
      const gx = (seaAt(d, 0, t, ridges) - seaAt(-d, 0, t, ridges)) / (2 * d);
      const gz = (seaAt(0, d, t, ridges) - seaAt(0, -d, t, ridges)) / (2 * d);
      up.set(-gx, 1, -gz).normalize();
      fwd.set(Math.cos(YAW), 0, -Math.sin(YAW));
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      side.crossVectors(fwd, up);
      basis.makeBasis(fwd, up, side);
      rider.quaternion.setFromRotationMatrix(basis);
      rider.position.set(0, y + FLOAT, 0);
      rider.updateMatrixWorld(true);
      lampAt.value.setFromMatrixPosition(light.matrixWorld);
      // the lantern breathes very slightly, slower than a breath; it never flickers
      lit.value = still ? 1 : 1 + 0.05 * Math.sin(t * 0.7);

      camera.position.set(EYE.x + 0.12 * Math.sin(t * 0.045), EYE.y + FOLLOW.eye * y, EYE.z);
      look.set(0.05 * Math.sin(t * 0.05 + 1), GAZE + FOLLOW.gaze * y, 0);
      camera.lookAt(look);
      camera.updateMatrixWorld();
      moonSky.position.copy(camera.position).addScaledVector(moon.value, MOON_FAR);
      time.value = t;
      Object.assign(probe, { t, board: rider.position.y });
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // the moon sits at MOON_AT in the frame of the camera at rest, whatever the frame's shape
      rest.aspect = camera.aspect;
      rest.updateProjectionMatrix();
      rest.position.copy(EYE);
      rest.lookAt(0.05 * Math.sin(1), GAZE, 0);
      rest.updateMatrixWorld();
      moon.value.set(MOON_AT.x, MOON_AT.y, 0.5).unproject(rest).sub(rest.position).normalize();
    },
  };
};
