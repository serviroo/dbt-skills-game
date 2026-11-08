import * as THREE from 'three';
import { mulberry32 } from '../../core/math';
import { moodAt, type Mood } from '../../daily/sky';

/**
 * The camp's night sky: a dome from the void overhead to a deep blue haze at the horizon (the fog's colour, so the far
 * hills melt into it), stars that twinkle very slowly, and the moon with its halo. It follows the player's own night
 * on the device's clock: the moon has tonight's phase and climbs across the sky from evening to dawn, the stars turn
 * about the pole with the hour, and at dusk and dawn a soft glow comes up low on the horizon (amber and rose, as on
 * Home) while the faint stars fade. The moon is placed in the camera's frame rather than in the sky, so it is in view
 * at every screen shape and every hour, riding over the pines. Nothing is stored and nothing is asked of the network.
 */
export const HORIZON = 0x0d1528;
const ZENITH = 0x07080f;
const R = 90;
const TAU = Math.PI * 2;

/** The night as the camp shows it at one moment. */
export interface Night {
  mood: Mood;
  /** the moon's age through its month, 0 at new moon, 0.5 at full */
  age: number;
  /** how much of the moon's face is lit, 0 to 1 */
  lit: number;
  /** a southern-hemisphere zone sees the moon lit on its other side */
  south: boolean;
  /** where the moon is along its path, 0 low on the left as dusk begins (17:00), 1 low on the right as dawn ends
   *  (08:00), on standard time; through the day it drifts back to the start, so it never jumps */
  p: number;
  /** how far into dusk or dawn (by `mood`) the sky is, 0 to 1: each comes in over its first half hour and goes over
   *  its last, so an open camp never changes all at once */
  glow: number;
  /** how far the stars have turned about the pole, in radians */
  turn: number;
}

/** a new moon (6 January 2000, 18:14 UTC) and the mean month from one to the next, in days */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const MONTH = 29.530588853;
/** a sidereal day: the stars come round again in this many milliseconds */
const STAR_DAY = 86164091;
/**
 * Time zones south of the equator without daylight saving, by their whole name, the old names browsers still report
 * included (America/Buenos_Aires for America/Argentina/Buenos_Aires). Whole names only, so a northern zone that starts
 * the same way (America/Bahia_Banderas) is never taken for one. A zone with daylight saving tells by itself: the
 * south's summer time falls in January.
 */
const SOUTH = new RegExp(
  `^(${[
    '(Australia|Antarctica|Brazil|Chile)/[A-Za-z_/-]+',
    'NZ|NZ-CHAT',
    'Pacific/(Auckland|Chatham|Fiji|Tongatapu|Apia|Pago_Pago|Niue|Noumea|Norfolk|Efate|Port_Moresby|Bougainville|Guadalcanal|Nauru|Funafuti|Kanton|Enderbury|Wallis|Fakaofo|Tahiti|Marquesas|Gambier|Pitcairn|Rarotonga|Easter|Galapagos)',
    'America/(Argentina/[A-Za-z_]+|Buenos_Aires|Cordoba|Catamarca|Jujuy|Mendoza|Rosario|Sao_Paulo|Santiago|Montevideo|Asuncion|La_Paz|Lima|Guayaquil|Punta_Arenas|Campo_Grande|Cuiaba|Recife|Bahia|Fortaleza|Belem|Santarem|Maceio|Araguaina|Porto_Velho|Rio_Branco|Porto_Acre|Eirunepe|Manaus|Noronha)',
    'Africa/(Johannesburg|Maputo|Harare|Lusaka|Windhoek|Gaborone|Maseru|Mbabane|Blantyre|Lubumbashi|Kinshasa|Brazzaville|Luanda|Dar_es_Salaam|Nairobi|Kigali|Bujumbura)',
    'Asia/(Jakarta|Makassar|Jayapura|Dili)',
    'Indian/(Mauritius|Reunion|Antananarivo|Mayotte|Comoro|Mahe|Chagos|Cocos|Christmas|Kerguelen)',
    'Atlantic/(St_Helena|Stanley|South_Georgia)',
  ].join('|')})$`,
);

const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
};

/** the device zone's offset from UTC in January and July for `year`, in getTimezoneOffset's minutes (west is +) */
let offsets = { year: NaN, jan: 0, jul: 0 };
function offsetsIn(year: number) {
  if (offsets.year !== year) offsets = { year, jan: new Date(year, 0, 1).getTimezoneOffset(), jul: new Date(year, 6, 1).getTimezoneOffset() };
  return offsets;
}

/**
 * How far the stars have turned at `ms`, in radians: a sidereal day on the zone's standard time, so a night that
 * changes the clocks doesn't swing the sky. Cheap enough for every frame.
 */
export function starTurn(ms: number) {
  const o = offsetsIn(new Date(ms).getFullYear());
  const local = ms - Math.max(o.jan, o.jul) * 6e4;
  return ((((local % STAR_DAY) + STAR_DAY) % STAR_DAY) / STAR_DAY) * TAU;
}

/** 0 to 1 through the hours `from` to `to`: up over the first half hour, down over the last, eased at both ends */
function twilight(h: number, from: number, to: number) {
  const x = Math.max(0, Math.min(1, (h - from) / 0.5, (to - h) / 0.5));
  return x * x * (3 - 2 * x);
}

/**
 * The night at `d` on the device's clock. The glow follows the wall clock, as Home's sky does; the moon's place goes
 * by the zone's standard time, as the stars do, so a night that changes the clocks doesn't move it. `tz` (the device's
 * zone name by default) only settles the hemisphere for a zone without daylight saving.
 */
export function nightAt(d: Date, tz = zone()): Night {
  const t = d.getTime();
  const age = ((((t - NEW_MOON) / 864e5 / MONTH) % 1) + 1) % 1;
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const o = offsetsIn(d.getFullYear());
  const local = t - Math.max(o.jan, o.jul) * 6e4;
  const hs = (((local % 864e5) + 864e5) % 864e5) / 36e5;
  const mood = moodAt(d);
  return {
    mood,
    age,
    lit: (1 - Math.cos(age * TAU)) / 2,
    south: o.jan !== o.jul ? o.jan < o.jul : SOUTH.test(tz),
    p: hs >= 17 ? (hs - 17) / 15 : hs < 8 ? (hs + 7) / 15 : 1 - (hs - 8) / 9,
    glow: mood === 'dusk' ? twilight(h, 17, 20) : mood === 'dawn' ? twilight(h, 5, 8) : 0,
    turn: starTurn(t),
  };
}

export interface Sky {
  group: THREE.Group;
  /** puts the moon at its place in the frame for this camera and the night's hour */
  frame(camera: THREE.PerspectiveCamera): void;
  /** the night to show: the moon's phase and place, the stars' turn and the horizon's glow */
  set(night: Night): void;
  /** turns the stars (and the faint band among them) to `rad` about the pole */
  turn(rad: number): void;
  /** where the moon's middle is in the last frame, in the camera's -1 to 1 coordinates */
  moonAt: { x: number; y: number };
  tick(t: number): void;
}

/** the pole the stars turn about: up and away from the camera, as a mid-latitude sky would have it */
const POLE = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(42)), -Math.cos(THREE.MathUtils.degToRad(42)));
/** the dusk and dawn glows (DESIGN.md: amber and rose, low and soft), and the sides of the sky they lie on: the moon
 *  rises on the left of the frame and sets on the right, so dusk glows to the right and dawn to the left */
const GLOW: Partial<Record<Mood, { color: number; dir: [number, number]; k: number }>> = {
  dusk: { color: 0xd67048, dir: [0.8, -0.6], k: 0.15 },
  dawn: { color: 0xe2968c, dir: [-0.8, -0.6], k: 0.12 },
};
/** the share of their light the stars keep in the middle of dusk and dawn, so only the brighter ones show */
const TWILIGHT_STARS = 0.5;

function dome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZen: { value: new THREE.Color(ZENITH) },
      uHor: { value: new THREE.Color(HORIZON) },
      uTurn: { value: new THREE.Matrix3() },
      uGlow: { value: new THREE.Color(0) },
      uGlowDir: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZen; uniform vec3 uHor; uniform mat3 uTurn; uniform vec3 uGlow; uniform vec2 uGlowDir;
      varying vec3 vDir;
      float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float up = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHor, uZen, smoothstep(0.0, 0.55, up));
        // a faint band of far stars across the sky, barely there, turning with the stars
        vec3 s = uTurn * vDir;
        vec2 q = vec2(atan(s.z, s.x) * 3.0, s.y * 9.0);
        float band = exp(-pow((s.y - 0.55 + 0.25 * sin(atan(s.z, s.x))) * 3.2, 2.0));
        c += vec3(0.05, 0.07, 0.13) * band * (0.55 + 0.45 * n(q * 1.7)) * smoothstep(0.02, 0.2, up);
        // dusk or dawn: a soft glow low over the hills on its own side of the sky, gone a little way up, before the top
        // of the frame (the camera looks 11 degrees down with an 18 degree half view, so the frame ends 7 degrees up)
        float side = max(dot(normalize(vDir.xz + vec2(1e-5)), uGlowDir), 0.0);
        float low = exp(-max(vDir.y, 0.0) * 11.0) * smoothstep(-0.03, 0.02, vDir.y) * (1.0 - smoothstep(0.03, 0.105, vDir.y));
        c += uGlow * (0.08 + 0.92 * side * side * side) * low;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16), mat);
  mesh.renderOrder = -2;
  return { mesh, u: mat.uniforms };
}

function stars() {
  const r = mulberry32(97);
  // the whole sphere, as the stars turn about the pole and some set while others rise; about half are up at a time
  const n = 1800;
  const pos = new Float32Array(n * 3);
  const look = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * s * (R - 2), y * (R - 2), Math.sin(a) * s * (R - 2)], i * 3);
    const big = r();
    // size in px, brightness, phase
    look.set([big > 0.96 ? 2.6 : big > 0.8 ? 1.8 : 1.15, 0.35 + r() * 0.65, r() * Math.PI * 2], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aLook', new THREE.BufferAttribute(look, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uDim: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aLook;
      uniform float uTime; uniform float uPx; uniform float uDim;
      varying float vB;
      void main() {
        // each star swells and fades on its own slow wave, a few seconds or more each way
        float tw = 0.78 + 0.22 * sin(uTime * (0.35 + fract(aLook.z) * 0.6) + aLook.z * 7.0);
        // how high the star is in the sky now, wherever the turn has taken it: none below the hills, fewer near them
        float up = normalize((modelMatrix * vec4(position, 0.0)).xyz).y;
        vB = aLook.y * tw * uDim * smoothstep(0.04, 0.18, up) * (0.7 + 0.3 * sqrt(max(up, 0.0)));
        gl_PointSize = aLook.x * uPx;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vB;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.35, 1.0, d)) * vB;
        gl_FragColor = vec4(vec3(0.82, 0.9, 1.0) * a * 1.4, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = -1;
  pts.frustumCulled = false;
  return { pts, time: mat.uniforms.uTime, px: mat.uniforms.uPx, dim: mat.uniforms.uDim };
}

/** The moon on one quad: a lit sphere with soft seas, lit from `uLight` for its phase, and its halo in two layers. */
function moon() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLight: { value: new THREE.Vector3(0.62, 0.2, 0.76).normalize() }, uLit: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight; uniform float uLit;
      varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        // the disc fills the middle fifth of the quad; the rest is halo
        vec2 p = vUv * 5.0;
        float r = length(p);
        // how much of the moon there is to see: toward new moon the whole of it, disc, earthshine and halo, fades into
        // the sky, as the real one is lost in the sun's glare, rather than standing dark against it
        float seen = smoothstep(0.0, 0.1, uLit);
        vec3 col = vec3(0.0);
        if (r < 1.0) {
          vec3 nrm = vec3(p, sqrt(1.0 - r * r));
          float lit = smoothstep(-0.06, 0.12, dot(nrm, uLight));
          float seas = n(p * 2.2 + 3.0) * 0.6 + n(p * 5.0) * 0.4;
          vec3 ground = mix(vec3(0.72, 0.8, 0.92), vec3(0.95, 0.97, 1.0), smoothstep(0.35, 0.75, seas));
          // the dark side keeps a faint earthshine, all but gone at new moon
          col = ground * lit * 1.9 + vec3(0.03, 0.05, 0.09) * (1.0 - lit) * (0.3 + 0.7 * smoothstep(0.0, 0.25, uLit));
          col *= (1.0 - smoothstep(0.93, 1.0, r) * 0.5) * seen;
        }
        // the disc covers what is behind it (a star never shows through the dark side); the halo only adds light
        float cover = (1.0 - smoothstep(0.985, 1.015, r)) * seen;
        // the halo is as bright as the moon is full; it lies around the disc and never over it, so the dark side of a
        // half moon stays dark
        float halo = (exp(-max(r - 1.0, 0.0) * 1.6) * 0.16 + exp(-max(r - 1.0, 0.0) * 0.45) * 0.05) * (0.15 + 0.85 * uLit) * seen * smoothstep(0.97, 1.03, r);
        col += vec3(0.42, 0.62, 1.0) * halo * (1.0 - smoothstep(3.6, 5.0, r));
        gl_FragColor = vec4(col, cover);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    // premultiplied: the colour is added in full and what is behind is kept by 1 - cover
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  // after the stars, so the disc covers them
  mesh.renderOrder = -0.5;
  mesh.frustumCulled = false;
  return { mesh, light: mat.uniforms.uLight, lit: mat.uniforms.uLit };
}

/** how far the moon's middle keeps from a pine's outline, in disc radii: the disc and the bright edge of its halo */
const CLEAR = 1.6;
/** the moon's disc radius as a share of the frame's half height (its quad is 0.36 of the frame, the disc a fifth) */
const DISC = 0.072;
/** the most a pine lifts the moon off its path, in the same shares: over a treetop, but behind a tall near pine, as a
 *  real moon would pass it, rather than up against the top of the frame */
const LIFT = 0.08;

/** The camp's sky. `skyline` is the pines' outline (World.skyline), which the moon always rides above. */
export function buildSky(skyline: THREE.Vector3[] = []): Sky {
  const group = new THREE.Group();
  group.name = 'sky';
  const d = dome();
  const s = stars();
  const mo = moon();
  const m = mo.mesh;
  group.add(d.mesh, s.pts, m);
  const moonAt = { x: 0, y: 0 };
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const back = new THREE.Matrix4();
  let p = 0;
  return {
    group,
    moonAt,
    set(night) {
      p = night.p;
      // tonight's phase: the sunlight comes from behind the moon at new, from its right as it waxes (its left in the
      // south), from the front at full
      const a = night.age * TAU;
      mo.light.value.set(Math.sin(a) * (night.south ? -1 : 1), 0.12, -Math.cos(a)).normalize();
      mo.lit.value = night.lit;
      this.turn(night.turn);
      const g = GLOW[night.mood];
      const w = g ? night.glow : 0;
      (d.u.uGlow.value as THREE.Color).set(g ? g.color : 0).multiplyScalar(g ? g.k * w : 0);
      if (g) d.u.uGlowDir.value.set(g.dir[0], g.dir[1]).normalize();
      s.dim.value = 1 - (1 - TWILIGHT_STARS) * w;
    },
    turn(rad) {
      q.setFromAxisAngle(POLE, -rad);
      s.pts.quaternion.copy(q);
      // the band is drawn in the dome's own directions, so it looks them up turned back the other way
      d.u.uTurn.value.setFromMatrix4(back.makeRotationFromQuaternion(q.invert()));
    },
    frame(camera) {
      // the moon climbs from low on the left at dusk to the top of the sky around midnight and down to the right by
      // dawn, far out on the dome and a constant size on screen; the sky is a narrower band in a sideways frame
      camera.updateMatrixWorld();
      const tall = camera.aspect < 1;
      moonAt.x = (p * 2 - 1) * (tall ? 0.5 : 0.46);
      let y = (tall ? 0.7 : 0.71) + Math.sin(p * Math.PI) * (tall ? 0.07 : 0.05);
      // and it rides over the pines in its way: its middle keeps CLEAR radii from every point of their outline, which
      // lifts it smoothly as it passes a tree, so it never jumps, by LIFT at most
      const path = y;
      const rx = (DISC * CLEAR) / camera.aspect, ry = DISC * CLEAR;
      for (const pt of skyline) {
        v.copy(pt).project(camera);
        const dx = (moonAt.x - v.x) / rx;
        if (v.z < 1 && dx > -1 && dx < 1) y = Math.max(y, v.y + ry * Math.sqrt(1 - dx * dx));
      }
      moonAt.y = Math.min(y, path + LIFT);
      v.set(moonAt.x, moonAt.y, 0.5).unproject(camera).sub(camera.position).normalize();
      const dist = R * 0.8;
      m.position.copy(camera.position).addScaledVector(v, dist);
      m.lookAt(camera.position);
      const high = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
      m.scale.setScalar(high * 0.36);
      group.position.copy(camera.position).setY(0);
      m.position.sub(group.position);
      s.px.value = camera.userData.px ?? 1;
    },
    tick(t) {
      s.time.value = t;
    },
  };
}
