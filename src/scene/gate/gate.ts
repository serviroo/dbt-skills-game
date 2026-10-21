import * as THREE from 'three';
import { clamp, smoothstep } from '../../core/math';
import { params } from '../../core/params';
import { noiseSample, noiseTexture } from '../fx/noise';
import { createParticles, type ParticleSystem } from '../fx/particles';
import { createFilaments } from './filaments';
import { GATE as G } from '../../motion/tokens';

/**
 * Beat 1: a vertical dungeon-gate tear in the void.
 *
 * Local frame: origin on the floor under the tear, tear in the XY plane facing +Z (towards the camera).
 * The tear spans y = base .. base + height (plus TOP_CREEP once open); its bottom tip sits below the floor so the
 * floor cuts the beam. Open timing is the measured two-stage curve (pacing f0058-f0071):
 * hairlines at both tips at the crack, 0 -> 54 % width in 167 ms, a 100 ms hitch, burst to 100 % by 433 ms.
 * Colours are fitted through the Stage post chain (AgX + grade) to the measured falloff at row 150 of f0068.
 */

/** Measured width progress, one value per 33.3 ms frame over 433 ms (CSS linear()). */
const OPEN_CURVE = G.openCurve;
export const GATE_OPEN_DURATION = G.openSec;
/** Final slit width as a fraction of frame width at the hero framing (measured). */
export const GATE_WIDTH_FRACTION = 0.144;

export function openProgress(dt: number) {
  if (dt <= 0) return 0;
  const x = (dt / GATE_OPEN_DURATION) * (OPEN_CURVE.length - 1);
  if (x >= OPEN_CURVE.length - 1) return 1;
  const i = Math.floor(x);
  return OPEN_CURVE[i] + (OPEN_CURVE[i + 1] - OPEN_CURVE[i]) * (x - i);
}
// How far each half reaches from its tip (1 = the middle) by width progress: still apart through the 54 % hitch and at
// 68 % (f0063, f0066: a gap of ~30 % and ~22 % of the frame height), meeting in the burst ~370 ms after the crack
const REACH_P = [0, 0.54, 0.68, 0.93, 1];
const REACH_V = [0.42, 0.665, 0.755, 1.0, 1.35];
const reachOf = (p: number) => {
  let i = 0;
  while (i < REACH_P.length - 2 && p > REACH_P[i + 1]) i++;
  return REACH_V[i] + (REACH_V[i + 1] - REACH_V[i]) * clamp((p - REACH_P[i]) / (REACH_P[i + 1] - REACH_P[i]));
};
/** After the open the top tip creeps this far upward over ~3 s (off frame in beat 1). Above the original top the
 * light dissolves upward (fadeTop in the glow), so even the tall AWAKEN army shots see a column rising out of the dark
 * instead of a bright spike with a pointed end. */
const TOP_CREEP = 6.0;
const creepAt = (since: number) => (since > 0 ? TOP_CREEP * smoothstep(G.creepFromSec, G.creepToSec, since) : 0);
/** Centre-line meander, in half-widths per unit of noise (the same curve in the glow, particles and filaments). It is
 * keyed to the unstretched height m = y / (H / 2), so the curve does not slide while the top creeps. */
const MEANDER = 0.4;
const meanderAt = (m: number, width: number, seed: number) => (noiseSample(0.71 + seed, m * 0.12 + 0.37) - 0.5) * MEANDER * 0.5 * width;
/** How far row u lies from its tip towards the middle, with |u| smoothed at the centre (matches `es` in the glow). */
const edgeDist = (u: number) => 1 - (Math.sqrt(u * u + 0.01) - 0.1);
/** Blade profile (matches prof() in the glow shader and lensF() in the particle shaders). */
const lens = (au: number) => { const t = clamp((1 - au) / 0.22); return t * (2 - t); };

export interface GateOpts {
  /** Tear height in world units (tip to tip). Default 8.65. */
  height?: number;
  /** Full open width in world units (use fitWidth for the measured 14.4 % of frame width). */
  width?: number;
  /** y of the bottom tip (negative = below the floor). */
  base?: number;
  seed?: number;
}

export interface GateState {
  /** 0..1 measured width progress. */
  open: number;
  /** Vertical reach of the tear from each tip (0..1.35, merged above ~1). */
  reach: number;
  /** Seconds since the crack (negative before). */
  since: number;
  width: number;
  height: number;
  base: number;
  /** Final brightness multiplier (open x overshoot x breathing x dim). */
  level: number;
}

export interface Gate {
  group: THREE.Group;
  /** Schedule the crack at stage time tSec (open by tSec + 0.433). Use a large negative value for already open. */
  openAt(tSec: number): void;
  update(t: number, dt?: number): void;
  /** Brightness multiplier 0..1 (1 = full, 0.7 = the measured 30 % dim under the first window). Matches director.ts. */
  setDim(v: number): void;
  setWidth(w: number): void;
  /** Set the width to `fraction` of the frame width at the gate's distance from `camera` (default 14.4 %). */
  fitWidth(camera: THREE.PerspectiveCamera, fraction?: number): number;
  /** Rim light for the toon materials: colour and strength, updated every frame. */
  light: { color: THREE.Color; intensity: number; position: THREE.Vector3 };
  state: GateState;
  layers: { glow: THREE.Mesh; floor: THREE.Mesh; filaments: THREE.Mesh; motes: ParticleSystem; flakes: ParticleSystem };
}

const glowVert = /* glsl */ `
uniform sampler2D uNoise;
uniform float uH, uExt, uWidth, uSeed;
varying vec2 vP;
varying float vMx;
void main() {
  vP = position.xy;
  // centre-line meander, evaluated per vertex row (the quad is split along its height) to save a fragment fetch
  // (keyed to the unstretched height, so the curve never slides while the top creeps)
  float m = position.y / (0.5 * uH);
  vMx = (texture2D(uNoise, vec2(0.71 + uSeed, m * 0.12 + 0.37)).r - 0.5) * ${MEANDER.toFixed(3)} * 0.5 * uWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const glowFrag = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime, uTq, uOpen, uReach, uWidth, uH, uI, uHair, uSeed, uFront, uExt, uCoreW, uCoreS, uLipSoft, uCyanW, uRaceK, uAmp0, uSince;
uniform vec3 cCore, cHot, cIn1, cCyan, cMid, cTrough, cG1, cG2, cG3, cViolet, uHd;
varying vec2 vP;
varying float vMx;

// blade profile: a long straight body, tips tapering to points (a slit, never a rounded doorway)
float prof(float au) { float t = clamp((1.0 - au) / 0.22, 0.0, 1.0); return t * (2.0 - t); }
float hsh(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float jag(float x, float seed) { float i = floor(x); return mix(hsh(i + seed), hsh(i + 1.0 + seed), fract(x)); }

void main() {
  float hh = 0.5 * uH;
  float W2 = 0.5 * uWidth;
  // after the open the top of the tear keeps creeping upward (off frame in beat 1), so in the wide character shots
  // it towers out of the top of the frame instead of ending in a point
  float u = vP.y / (vP.y > 0.0 ? hh + uExt : hh);
  float au = abs(u);
  float auc = min(au, 1.0);
  float e = 1.0 - auc;
  // unstretched height: texture features ride it, so nothing slides while the top creeps
  float m = vP.y / hh;
  // above the original top the column dissolves upward into the dark, spreading as it fades: a tall shot (the AWAKEN
  // army shots) sees light rising out of frame, never a bright spike with a pointed end
  float fadeTop = vP.y > 0.0 ? exp(-2.0 * max(m - 0.85, 0.0)) * (1.0 - smoothstep(1.5, 2.2, m)) : 1.0;
  // a crack is never ruled straight: the centre line meanders a little along the height (the crackle filaments and
  // the particles follow the same curve: meanderAt() on the CPU, meanderF() in the particle shaders)
  float px = vP.x - vMx;
  float sideS = step(0.0, px);
  float ax = abs(px);
  float fw = fwidth(vP.x);

  // each half leads with a tapered spear (f0063-f0066), not a blunt capsule end. Where the spears meet, the distance
  // to the middle is taken through a smoothed |u|, so the waist closes as a rounded hourglass and the halo has no
  // crease along the centre line
  float es = 1.0 - (sqrt(u * u + 0.01) - 0.1);
  float gr = clamp((uReach - es) / 0.25, 0.0, 1.0);
  float grow = gr * (2.0 - gr);
  float present = step(es, uReach) * step(au, 1.0);
  float hwS = W2 * uOpen * prof(auc) * grow;
  // the hairline never drops under ~1.4 px, so the first frame of the crack reads at any size
  float hair = max(uHair, fw * 0.7) * present * (0.6 + 0.4 * prof(auc));
  float hw = max(hwS, hair);
  float cover = 0.0;
  // (only rows and columns the ragged lip can reach pay for it: the halo spill around the slit is most of the quad)
  if (present > 0.0 && ax < hwS * 1.45 + hair + 2.0 * fw) {
    // torn lip: a slow waviness and a fine ragged bite, both small (light, not paper), ragged more towards the tips
    // where the tear frays out (the long body only waves: a fine bite there reads as a torn paper edge)
    float wav = texture2DLodEXT(uNoise, vec2(0.13 + sideS * 0.5 + uSeed, m * 0.16 + uTq * 0.0014), 0.0).g - 0.5;
    float j3 = jag(m * 46.0 + uTq * 1.05, sideS * 71.0 + 29.0 + uSeed);
    float tipR = smoothstep(0.6, 1.0, auc);
    float rag = 1.0 + (0.09 + 0.3 * tipR) * wav + (0.012 + 0.04 * tipR) * (j3 - 0.5);
    hw = max(hwS * rag, hair);
    // the lip is feathered over the outer ~15 % of the half-width: the light runs on into the halo, no cut-out edge
    cover = 1.0 - smoothstep(hw - max(uLipSoft * hw, fw * 1.5), hw + fw * 1.5, ax);
  }

  float Wr = max(uWidth, 0.06);
  // the far halo is sized by the tear's height, not its width: the measured tail runs to ~55 % of frame height in
  // every aspect, so a narrow portrait slit keeps the same light spill as the landscape one
  float Hr = 0.275 * uH;
  float Wn = max(Wr, 0.5 * Hr);
  // the crack front: the leading end of each half-tear burns white-hot while the halves race to meet (f0060-f0066),
  // a hot streak running back from it along the tear
  float behind = max(uReach - e, 0.0) * hh;
  float dF = length(vec2(ax * 3.0, max(e - uReach, 0.0) * hh * 2.0));
  float front = uFront * exp(-dF / (0.05 * Wn + 0.01)) * exp(-behind / (0.35 * Hr));

  // ---- halo: stacked exponentials outside the slit, radial past the tips
  // (the halo measures from a gentler taper than the spear itself, so its falloff never steps along the height where a
  // racing half widens quickly behind its point)
  float grH = clamp((uReach - es) / mix(0.6, 0.3, smoothstep(0.8, 1.0, uOpen)), 0.0, 1.0);
  float dx = max(ax - max(W2 * uOpen * prof(auc) * grH * (2.0 - grH), hair), 0.0);
  float dy = max(au - 1.0, 0.0) * (vP.y > 0.0 ? hh + uExt : hh);
  // in the still-closed middle the glow falls off radially round each half's leading end, so the gap between the
  // racing halves stays dark (f0063-f0068). The distance runs to the nearer end through a smoothed |y|: the two halves'
  // glows meet on the centre line without a crease
  float k0 = 0.25 * Hr;
  float gapY = max((1.0 - uReach) * hh - (sqrt(vP.y * vP.y + k0 * k0) - k0), 0.0);
  // past the tips the light leaks on as a soft glow (no hard spike when the whole tear is in frame)
  float d = length(vec2(dx, (dy + gapY) * 0.9)) / mix(1.0, 1.7, 1.0 - fadeTop);
  // while the halves race (f0060-f0066) they already throw most of the final light (the reference frame is at ~75 % of
  // its final brightness before they meet), so the meeting is a swell and never a flash
  float race = (1.0 - smoothstep(0.6, 1.0, uOpen)) * smoothstep(0.0, 0.3, uOpen);
  // (the glow builds with time, not with the stepped width curve, so it swells smoothly through the hitch)
  float amp = mix(uAmp0, 1.0, smoothstep(0.0, 0.3, uSince)) * (1.0 + uRaceK * race) * fadeTop;
  float tight = mix(0.45, 1.0, smoothstep(0.0, 0.7, uOpen));
  float tips = 1.0 - 0.25 * smoothstep(0.6, 1.0, auc);
  // the near glow never gets thinner than a few pixels, so a distant tear has a soft edge, not a drawn outline
  // (the near glow follows the slit's own width, so a narrow portrait slit keeps a tight edge glow)
  float Wg = max(Wr, 0.3 * Hr);
  vec3 halo = cG1 * exp(-d / max(uHd.x * Wg * tight + 0.004, 4.0 * fw)) + cG2 * exp(-d / (uHd.y * Hr * tight + 0.01)) + cG3 * exp(-d / (uHd.z * Hr + 0.02));
  halo *= tips;
  float dn = d / Hr;
  float vb = smoothstep(0.12, 0.35, dn) * (1.0 - smoothstep(0.6, 1.5, dn));
  vec3 fGlow = cIn1 * front * 0.12;
  // cheap exit in the far field before any texture reads (the quad spans the whole light spill)
  if (cover <= 0.0 && dot((halo + cViolet * vb) * 2.0 * amp + fGlow, vec3(1.0)) * uI < 0.0004) discard;
  vec2 hp = vP / uH;
  // vertical light shafts: long curtain bands and fine streaks drifting slowly (the reference halo is striated, f0071)
  float sh1 = texture2D(uNoise, vec2(hp.x * 2.4 + 0.5, hp.y * 0.1 - uTime * 0.005)).r;
  float sh2 = texture2D(uNoise, vec2(hp.x * 6.5 + 0.13, hp.y * 0.05 + uTime * 0.003)).g;
  float shafts = smoothstep(0.2, 0.8, 0.55 * sh1 + 0.55 * sh2);
  // slow swells of light climbing the shafts; also where the violet gathers
  float vcl = texture2D(uNoise, vec2(hp.x * 0.32 + 0.5, hp.y * 0.22 - uTime * 0.02)).r;
  // (the violet blooms out as the tear opens, not round the racing halves)
  halo += cViolet * vb * mix(0.2, 1.0, smoothstep(0.4, 0.8, vcl)) * (1.0 - 0.6 * au * au) * mix(0.5, 1.4, shafts) * smoothstep(0.5, 1.0, uOpen);
  float near = exp(-dn / 0.06);
  halo *= mix(mix(0.3, 1.5, shafts) * mix(0.75, 1.25, vcl), 0.8 + 0.4 * shafts, near) * amp;
  // near the lip the halo runs on inside the slit, so the edge is one continuous falloff (no dark seam, no outline)
  float sIn = clamp(ax / max(hw, 1e-5), 0.0, 1.0);
  halo *= 1.0 - cover * (1.0 - 0.6 * smoothstep(0.62, 1.0, sIn));
  halo += fGlow * (1.0 - cover);

  // ---- interior: light pouring out of the tear (f0071 row 150): an ice-white plateau over about half the width, the
  // measured cyan step, then a saturated blue at the lip that runs on into the halo. Only the plateau and the centre
  // line cross the bloom threshold; the cyan and the blue carry a little negative red, which keeps them saturated
  // through AgX and under the threshold, so the beam is vivid without veiling the frame in bloom haze. Vertical
  // streaks flow up the slit (drawn on 2s) and striate the cyan and the blue, never the core: light, not stone.
  vec3 inner = vec3(0.0);
  if (cover > 0.0) {
    float s = clamp(ax / max(hw, 1e-5), 0.0, 1.0);
    float hwPx = hw / max(fw, 1e-6);
    float detail = smoothstep(4.0, 30.0, hwPx);
    // seen up close (half-width past ~150 px, the mid shots) a wide white plateau reads as a lit panel: the core
    // narrows back to a searing line and the streaks take over, so a beam cut by the frame edge stays a light column
    float closeK = smoothstep(130.0, 340.0, hwPx);
    float xs = px / max(W2, 0.03);
    float st1 = texture2D(uNoise, vec2(xs * 0.13 + uSeed, hp.y * 0.07 - uTq * 0.03)).r;
    float st2 = texture2D(uNoise, vec2(xs * 0.37 + 0.37 + uSeed, hp.y * 0.16 - uTq * 0.06)).g;
    float strk = mix(0.5, smoothstep(0.25, 0.8, 0.55 * st1 + 0.55 * st2), detail);
    float tipK = 1.0 - 0.75 * smoothstep(0.6, 1.0, auc);
    float cw = uCoreW * mix(1.0, 0.3, closeK) * mix(0.55, 1.0, tipK);
    // while the halves race the core is a crisp white rod; the shoulder softens into a glow as the tear opens
    float zc = max(s - cw, 0.0) / (uCoreS * mix(0.5, 1.0, smoothstep(0.55, 1.0, uOpen)));
    float wCore = exp(-zc * zc) * tipK;
    float sh = s / 0.08;
    float wHot = exp(-sh * sh) * mix(0.5, 1.0, tipK);
    // cyan holds across the slit and rolls off towards the lip (4th-power: a shelf, not a bump)
    float sc2 = s * s / (uCyanW * uCyanW);
    float wCyan = exp(-sc2 * sc2);
    float sk = mix(0.65, 1.3, strk);
    vec3 body = mix(cTrough, cMid, 0.2 + 0.95 * strk) * smoothstep(0.25, 0.95, s);
    // (the streaks run faintly through the core too, so a beam cut by the frame edge still reads as a streaked column)
    inner = cCore * wCore * mix(0.88 + 0.24 * strk, 0.8 + 0.4 * strk, closeK) + cHot * wHot + cCyan * wCyan * sk * (1.0 - 0.7 * wCore) + body;
    inner += cHot * front * 0.7;
    // the tips thin into light rather than ending in a hard point
    inner *= cover * (1.0 - 0.7 * smoothstep(0.8, 1.0, auc)) * fadeTop * (1.0 + 0.5 * uRaceK * race);
  }
  vec3 col = (halo + inner) * uI;
  if (dot(col, vec3(1.0)) < 0.0004) discard;
  gl_FragColor = vec4(col, 1.0);
}`;

const floorVert = /* glsl */ `
varying vec2 vF;
void main() {
  vF = vec2(position.x, -position.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const floorFrag = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTq, uOpen, uWidth, uI, uH;
uniform vec3 cSpike, cPool;
varying vec2 vF;
void main() {
  float x = vF.x, z = vF.y;
  float W = 0.5 * uWidth * uOpen + 0.002;
  float fan = W + max(z, 0.0) * 0.16;
  float nx = x / fan + (texture2D(uNoise, vec2(z * 0.07 + 0.3, 0.71)).r - 0.5) * 0.25;
  float k1 = texture2D(uNoise, vec2(nx * 0.17 + 0.13, z * 0.012 + uTq * 0.0015)).b;
  float k2 = texture2D(uNoise, vec2(nx * 0.31 + 0.61, z * 0.018 - uTq * 0.002)).b;
  float sp = pow(k1, 10.0) + 0.7 * pow(k2, 14.0);
  float len = mix(0.6, 2.6, texture2D(uNoise, vec2(nx * 0.07 + 0.3, 0.37)).r) * uH / 4.8;
  float inFan = 1.0 - smoothstep(0.75, 1.15, abs(nx));
  float fall = exp(-max(z, 0.0) / len) * smoothstep(-0.03, 0.05, z) * inFan;
  float pool = exp(-length(vec2(x / (W * 1.4 + 0.18), max(z, 0.0) / (0.55 * uH / 4.8) + max(-z, 0.0) * 12.0)) * 2.0);
  vec3 col = cSpike * sp * fall * (0.12 + 0.88 * smoothstep(0.1, 0.8, uOpen)) + cPool * pool * (0.35 + 0.65 * uOpen);
  col *= uI;
  if (dot(col, vec3(1.0)) < 0.0004) discard;
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildGate(opts: GateOpts = {}): Gate {
  // tall enough to run past the frame in the hero and character framings (the reference beam spans the frame)
  const H = opts.height ?? 8.65;
  /** Size reference for the floor light and the crackle, independent of the tear height. */
  const S = 4.8;
  const base = opts.base ?? -1.0;
  const yc = base + H / 2;
  const group = new THREE.Group();
  group.name = 'gate';
  const noise = noiseTexture();

  const glowU = {
    uNoise: { value: noise },
    uTime: { value: 0 },
    uTq: { value: 0 },
    uOpen: { value: 0 },
    uReach: { value: 0 },
    uWidth: { value: opts.width ?? 1.0 },
    uH: { value: H },
    uI: { value: 0 },
    uHair: { value: S * 0.0012 },
    uSeed: { value: (opts.seed ?? 0) * 0.137 },
    uFront: { value: 0 },
    uExt: { value: 0 },
    // linear inputs fitted through bloom + AgX + grade to the measured display ramp (f0071 row 150)
    // ice-white plateau (the palette's #E6F1FF), blue-weighted so its bloom stays a saturated blue instead of a grey veil
    cCore: { value: new THREE.Vector3(0.34, 1.3, 2.6) },
    uCoreW: { value: 0.2 }, // plateau half-width, in half-widths of the slit
    uCoreS: { value: 0.2 }, // shoulder past the plateau
    cHot: { value: new THREE.Vector3(0.25, 0.6, 1.0) }, // a slight dome on the centre line
    cIn1: { value: new THREE.Vector3(0.0, 0.8, 1.9) }, // glow round the racing crack fronts
    cCyan: { value: new THREE.Vector3(-0.3, 0.8, 2.2) }, // the cyan step (negative red: saturated through AgX, under the bloom threshold)
    cMid: { value: new THREE.Vector3(-0.03, 0.09, 0.6) }, // saturated blue at the lip, streaked
    cTrough: { value: new THREE.Vector3(0.012, 0.01, 0.28) }, // violet-navy gaps between the light shafts
    uLipSoft: { value: 0.15 },
    uCyanW: { value: 0.66 }, // the cyan shelf rolls off past this (half-widths)
    uRaceK: { value: 1.8 }, // extra light while the halves race
    uSince: { value: 0 }, // seconds since the crack
    uAmp0: { value: 0.45 }, // halo strength on the crack frame (relative to open)
    cG1: { value: new THREE.Vector3(-0.05, 0.11, 0.85) }, // just outside the lip (+120 px #268BD1)
    cG2: { value: new THREE.Vector3(0.0, 0.0028, 0.021) }, // -> +180..+260 px
    cG3: { value: new THREE.Vector3(0.0002, 0.0005, 0.002) }, // tail to +600 px
    uHd: { value: new THREE.Vector3(0.16, 0.24, 0.62) }, // halo decay lengths (near: x the width; mid, far: x the height)
    cViolet: { value: new THREE.Vector3(0.017, 0.0024, 0.05) }, // #7B3FE4 outer band (+180..+400 px)
  };
  const QH = H * 1.45;
  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowU,
    vertexShader: glowVert,
    fragmentShader: glowFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glowGeo = new THREE.PlaneGeometry(1, QH, 1, 48);
  // the top edge leaves room for the tear's upward creep (TOP_CREEP)
  glowGeo.attributes.position.setY(0, QH / 2 + TOP_CREEP);
  glowGeo.attributes.position.setY(1, QH / 2 + TOP_CREEP);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  // the halo scales with the slit width, so the quad does too (2 columns of vertices, rewritten on width changes)
  const quadPos = glow.geometry.attributes.position as THREE.BufferAttribute;
  const sizeQuad = (w: number) => {
    const hx = Math.max(1.8 + 0.31 * H, 0.5 * w + 3.4 * w + 0.3);
    for (let i = 0; i < quadPos.count; i++) quadPos.setX(i, Math.sign(quadPos.getX(i)) * hx);
    quadPos.needsUpdate = true;
  };
  sizeQuad(glowU.uWidth.value);
  glow.position.set(0, yc, 0);
  glow.renderOrder = 4;
  glow.frustumCulled = false;
  group.add(glow);

  const floorU = {
    uNoise: { value: noise },
    uTq: glowU.uTq,
    uOpen: glowU.uOpen,
    uWidth: glowU.uWidth,
    uI: { value: 0 },
    uH: { value: S },
    cSpike: { value: new THREE.Color(0.02, 1.25, 2.6) }, // #A2DCE7 floor light spikes, nudged towards the lantern blue
    cPool: { value: new THREE.Color(0.0, 0.07, 0.34) },
  };
  const floorMat = new THREE.ShaderMaterial({
    uniforms: floorU,
    vertexShader: floorVert,
    fragmentShader: floorFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const floorSpan = S * 1.4;
  const floorGeo = new THREE.PlaneGeometry(S * 1.2, floorSpan, 1, 1);
  floorGeo.translate(0, -floorSpan / 2 + 0.2, 0);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.004;
  floor.renderOrder = 3;
  floor.frustumCulled = false;
  group.add(floor);

  const state: GateState = { open: 0, reach: 0, since: -1, width: glowU.uWidth.value, height: H, base, level: 0 };
  const shape = {
    height: H,
    scale: S,
    centerY: yc,
    halfWidth(u: number) {
      const au = Math.min(Math.abs(u), 1);
      const gr = clamp((state.reach - edgeDist(u)) / 0.25);
      const g = gr * (2 - gr);
      return 0.5 * state.width * state.open * lens(au) * g;
    },
    present(u: number) {
      return edgeDist(u) <= state.reach;
    },
    centerX(u: number) {
      return meanderAt(u > 0 ? (u * (H / 2 + glowU.uExt.value)) / (H / 2) : u, state.width, glowU.uSeed.value);
    },
    yAt(u: number) {
      return yc + u * (u > 0 ? H / 2 + glowU.uExt.value : H / 2);
    },
    // matches fadeTop in the glow: the crackle dissolves with the light above the original top
    fadeAt(u: number) {
      const m = (u * (u > 0 ? H / 2 + glowU.uExt.value : H / 2)) / (H / 2);
      return m > 0 ? Math.exp(-2 * Math.max(m - 0.85, 0)) * (1 - smoothstep(1.5, 2.2, m)) : 1;
    },
  };
  const fil = createFilaments(shape);
  group.add(fil.mesh);

  // Particles share the slit uniforms so they spawn inside the opening.
  const slitU = {
    uOpenT: { value: 1e4 },
    uW: glowU.uWidth,
    uOpenP: glowU.uOpen,
    uSeedM: glowU.uSeed,
    uExtP: glowU.uExt,
    uYc: { value: yc },
    uHH: { value: H / 2 },
  };
  const slitHead = /* glsl */ `
    uniform float uOpenT, uW, uOpenP, uYc, uHH, uSeedM, uExtP;
    float lensF(float au) { float t = clamp((1.0 - au) / 0.22, 0.0, 1.0); return t * (2.0 - t); }
    float meanderF(float m) { return (texture2D(uNoise, vec2(0.71 + uSeedM, m * 0.12 + 0.37)).r - 0.5) * ${MEANDER.toFixed(3)} * 0.5 * uW; }`;

  // dust motes drifting out of the gate towards the camera (additive)
  const motes = createParticles({
    count: 170,
    seed: (opts.seed ?? 0) + 41,
    blend: 'add',
    renderOrder: 9,
    minPx: 1.0,
    uniforms: { ...slitU, uCol: { value: new THREE.Color(0.25, 0.9, 1.6) }, uGain: { value: 1.0 } },
    vertexHead: slitHead + 'uniform vec3 uCol;',
    vertexBody: /* glsl */ `
      float burst = step(s2.z, 0.3);
      float life = mix(3.2, 6.5, s.x);
      float tt = (uTime - uOpenT) / life + s.y;
      float age = fract(tt);
      float cyc = floor(tt);
      float birth = (cyc - s.y) * life + uOpenT;
      float bAge = (uTime - (uOpenT + 0.27)) / (life * 0.6);
      age = mix(age, bAge, burst);
      vec4 r = hash44(vec4(s.zw * 33.3, cyc * (1.0 - burst), s2.x * 3.7));
      float u = (r.y * 2.0 - 1.0) * 0.82;
      float hw = 0.5 * uW * max(uOpenP, 0.3) * lensF(abs(u));
      vec3 p0 = vec3((r.x * 2.0 - 1.0) * hw + meanderF(u), uYc + u * uHH, 0.03);
      vec3 v = vec3((r.x * 2.0 - 1.0) * 0.22, mix(-0.04, 0.1, r.z), mix(0.3, 1.0, r.w));
      v = mix(v, vec3((r.x * 2.0 - 1.0) * 0.9, mix(-0.2, 0.5, r.z), mix(1.2, 3.2, r.w)), burst);
      float T = age * life * mix(1.0, 0.6, burst);
      vec3 tn = texture2D(uNoise, vec2(s.z * 4.0 + T * 0.12, s.w * 4.0 + uTime * 0.015)).rgb - 0.5;
      vec3 p = p0 + v * T + tn * 0.45 * T;
      p.y -= mix(0.0, 0.25, burst) * T * T;
      P = p;
      VEL = v + tn * 0.45;
      STRETCH = mix(0.0, 0.04, burst);
      A = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.5, 1.0, age));
      A *= mix(step(uOpenT, birth), step(0.0, bAge) * step(bAge, 1.0), burst);
      A *= clamp((uIntensity - s2.w * 0.85) / 0.15, 0.0, 1.0);
      A *= 0.55 + 0.45 * sin(uTime * (1.3 + s2.y * 2.0) + s.w * 20.0);
      float glowNear = exp(-max(p.z, 0.0) * 0.45);
      C = uCol * mix(0.35, 1.0, glowNear) * mix(0.6, 1.4, s2.y);
      S = mix(0.0035, 0.009, s2.x * s2.x);
      // motes that drift close to the lens open up into soft bokeh (depth cue for the slow dolly)
      float dcam = distance((modelMatrix * vec4(p, 1.0)).xyz, cameraPosition);
      float bk = 1.0 - smoothstep(0.9, 3.2, dcam);
      S *= 1.0 + 5.0 * bk;
      A *= 1.0 - 0.75 * bk;
    `,
    fragmentHead: 'uniform float uGain;',
    fragmentBody: /* glsl */ `
      float d2 = dot(vUv, vUv);
      float v = exp(-d2 * 4.5);
      gl_FragColor = vec4(vColor * v * vAlpha * uGain, 0.0);`,
  });
  group.add(motes.mesh);

  // dark debris flakes tumbling out, backlit by the tear (premultiplied: dark body + additive cyan rim)
  const flakes = createParticles({
    count: 64,
    seed: (opts.seed ?? 0) + 43,
    blend: 'premult',
    renderOrder: 11,
    minPx: 1.2,
    uniforms: { ...slitU, uRim: { value: new THREE.Color(0.2, 1.1, 2.6) } },
    vertexHead: slitHead,
    vertexBody: /* glsl */ `
      float burst = step(s2.z, 0.45);
      float life = mix(3.5, 7.0, s.x);
      float tt = (uTime - uOpenT) / life + s.y;
      float age = fract(tt);
      float cyc = floor(tt);
      float birth = (cyc - s.y) * life + uOpenT;
      float bAge = (uTime - (uOpenT + 0.27)) / life;
      age = mix(age, bAge, burst);
      vec4 r = hash44(vec4(s.zw * 19.3, cyc * (1.0 - burst), s2.x * 5.1));
      float u = (r.y * 2.0 - 1.0) * 0.8;
      float hw = 0.5 * uW * max(uOpenP, 0.3) * lensF(abs(u));
      vec3 p0 = vec3((r.x * 2.0 - 1.0) * hw * 1.1 + meanderF(u), uYc + u * uHH, 0.05);
      vec3 v = vec3((r.x * 2.0 - 1.0) * 0.3, mix(-0.1, 0.12, r.z), mix(0.4, 1.1, r.w));
      v = mix(v, vec3((r.x * 2.0 - 1.0) * 1.3, mix(-0.3, 0.7, r.z), mix(1.4, 3.6, r.w)), burst);
      float T = age * life;
      vec3 p = p0 + v * T;
      p.y -= mix(0.012, 0.09, burst) * T * T;
      P = p;
      A = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.6, 1.0, age));
      A *= mix(step(uOpenT, birth), step(0.0, bAge) * step(bAge, 1.0), burst);
      A *= clamp((uIntensity - s2.w * 0.85) / 0.15, 0.0, 1.0);
      S = mix(0.007, 0.024, pow(s2.x, 2.0));
      ASPECT = mix(0.5, 1.2, s2.y);
      ROT = s.w * 6.28 + uTime * mix(-3.0, 3.0, s2.y);
      float back = exp(-max(p.z, 0.0) * 0.35);
      DATA = vec4(back, s.z, s.w, 0.0);
    `,
    fragmentHead: 'uniform vec3 uRim;',
    fragmentBody: /* glsl */ `
      vec2 uv = vUv;
      float a0 = vData.y * 6.2832;
      float k = 0.0;
      for (int i = 0; i < 3; i++) {
        float an = a0 + float(i) * 2.0944 + (fract(vData.z * float(i + 3) * 7.13) - 0.5) * 0.9;
        k = max(k, dot(uv, vec2(cos(an), sin(an))));
      }
      float body = 1.0 - smoothstep(0.42, 0.5, k);
      float rim = smoothstep(0.28, 0.46, k) * body;
      float a = body * vAlpha;
      vec3 c = vec3(0.003, 0.004, 0.008) * a + uRim * rim * vAlpha * vData.x * 0.35;
      gl_FragColor = vec4(c, a * 0.95);`,
  });
  group.add(flakes.mesh);

  let crackT = Infinity;
  let dim = 1;
  const light = { color: new THREE.Color(0x4fb8ff), intensity: 0, position: new THREE.Vector3(0, yc, 0) };
  const cBlue = new THREE.Color(0x4fb8ff), cViolet = new THREE.Color(0x7b3fe4);

  function update(t: number) {
    const since = t - crackT;
    const p = openProgress(since);
    const visible = since >= 0;
    const reach = visible ? reachOf(p) : 0;
    const tq = Math.floor(t * G.effectsFps) / G.effectsFps;
    const post = since - GATE_OPEN_DURATION;
    const over = post > 0 ? G.overshoot * Math.min(1, post / G.overshootRiseSec) * Math.exp(-Math.max(0, post - G.overshootRiseSec) / G.overshootTauSec) : 0;
    const breathe = params.reduced ? 1 : 1 + 0.035 * Math.sin(t * 2.2) + 0.02 * Math.sin(t * 5.3 + 1.7);
    const crackPop = visible ? 1 + 0.6 * Math.exp(-Math.max(since, 0) / G.crackPopTauSec) * (1 - p) : 0;
    const level = visible ? (1 + over) * breathe * crackPop * dim : 0;

    state.open = p;
    state.reach = reach;
    state.since = since;
    state.level = level;
    state.width = glowU.uWidth.value;

    glowU.uTime.value = t;
    glowU.uTq.value = tq;
    glowU.uOpen.value = p;
    glowU.uReach.value = reach;
    glowU.uI.value = level;
    glowU.uExt.value = visible ? creepAt(since) : 0;
    glowU.uSince.value = Math.max(since, 0);
    // the crack front burns until the two halves meet, and swells through the 54 % hitch (pressure before the burst)
    glowU.uFront.value = visible ? clamp((1.02 - reach) / 0.14) * (1 + 0.9 * smoothstep(G.hitchFromSec, G.hitchToSec, since)) * (1 + 0.8 * Math.exp(-since / 0.06)) : 0;
    floorU.uI.value = level;
    glow.visible = floor.visible = visible;
    // read by the shadow aura, which keeps its smoke off the light column where it stands beside him
    group.userData.slitHalfWidth = visible ? 0.5 * glowU.uWidth.value * p : 0;
    group.userData.slitTop = yc + 0.85 * (H / 2);

    fil.update(t, p, level);
    fil.mesh.visible = visible;
    slitU.uOpenT.value = Number.isFinite(crackT) ? crackT : 1e5;
    motes.update(t);
    flakes.update(t);
    const pi = clamp((p - 0.2) / 0.8);
    motes.setIntensity(pi);
    flakes.setIntensity(pi);

    light.color.copy(cBlue).lerp(cViolet, 0.18);
    light.intensity = level * (0.15 + 0.85 * p);
    light.position.set(0, yc, 0).applyMatrix4(group.matrixWorld);
  }

  const v = new THREE.Vector3();
  return {
    group,
    light,
    state,
    layers: { glow, floor, filaments: fil.mesh, motes, flakes },
    openAt(tSec: number) { crackT = tSec; },
    update,
    setDim(x: number) { dim = clamp(x); },
    setWidth(w: number) { glowU.uWidth.value = w; state.width = w; sizeQuad(w); },
    fitWidth(camera: THREE.PerspectiveCamera, fraction = GATE_WIDTH_FRACTION) {
      group.updateMatrixWorld();
      v.set(0, yc, 0).applyMatrix4(group.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      const dist = Math.max(0.1, -v.z);
      const frameH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const w = frameH * camera.aspect * fraction;
      glowU.uWidth.value = w;
      state.width = w;
      sizeQuad(w);
      return w;
    },
  };
}
