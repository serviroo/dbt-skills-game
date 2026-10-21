import * as THREE from 'three';
import { mulberry32 } from '../../core/math';
import { params } from '../../core/params';
import { HASH_GLSL, noiseTexture } from './noise';

/**
 * Ink-smoke ribbons for the shadow aura: each instance is a camera-facing strip that traces the smoke one emitter
 * breathed out over the last L seconds (point a along the strip = smoke emitted a seconds ago, advected since).
 * Because the emitter wobbles and the drift is keyed to the emission time, curls travel up the ribbon and puffs
 * detach as separate tendrils. Pure function of (seed, uTime): seekable and frame-exact. One draw call.
 */
export interface InkRibbonOpts {
  count: number;
  height: number;
  radius: number;
  seed?: number;
  segments?: number;
  renderOrder?: number;
}

export interface InkRibbons {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  count: number;
  triangles: number;
  setIntensity(v: number): void;
  /** World positions the smoke keeps clear of: the face and both hands. */
  setAnchors(head?: THREE.Vector3, handR?: THREE.Vector3, handL?: THREE.Vector3): void;
  /** The gate's light column (bottom and top of its centre line, half-width with glow, world space): plumes fade where
   * they would cross it beside him. halfWidth 0 turns this off. */
  setGate?(bottom: THREE.Vector3, top: THREE.Vector3, halfWidth: number): void;
  update(t: number, origin: THREE.Vector3): void;
}

const vert = /* glsl */ `
attribute float aT;
attribute float aSide;
attribute vec4 aSeed;
attribute vec4 aSeed2;
uniform float uTime, uIntensity, uViewH, uHeight, uRadius, uGateHW;
uniform vec3 uOrigin, uHead, uHandR, uHandL, uGateA, uGateB;
uniform sampler2D uNoise;
varying vec2 vUv;
varying float vAlpha;
varying vec4 vData;
varying vec4 vSeed;
${HASH_GLSL}

// the aura breathes: a slow inhale/exhale keyed to emission time, so each breath travels up the smoke as a swell
float breath(float te) { return 0.5 + 0.5 * sin(te * 1.85 + 0.6 * sin(te * 0.7)); }

// Two kinds of source, both on the far side of the silhouette so the body hides each root and only the smoke that
// spills past the outline reads (Night Warden aura: it breathes off the coat and shoulders, it never wraps the legs;
// low tendrils at the heels read as smoke round the legs, so there are none):
//   cls 0  shoulders and upper back, rising and drifting away from the camera, framing the head from behind
//   cls 1  the coat's back and sides from the waist up, hugging the outline as it climbs
vec3 ribbonAt(float a, float te, vec4 s, vec4 s2, float camAz, float cls, vec3 away) {
  float sd = s.x < 0.5 ? -1.0 : 1.0;
  float k = fract(s.x * 2.0);
  float th0, h0, R0, twist, outw, back, rs;
  if (cls < 0.5) {
    // half rise off the shoulder line, half straight up behind the neck (a crown of smoke against the gate light)
    float crown = step(0.5, s.w);
    th0 = camAz + mix(sd * 3.1416 * mix(0.55, 0.88, k), 3.1416 + sd * mix(0.1, 0.7, k), crown);
    h0 = mix(mix(0.66, 0.8, s.y), mix(0.78, 0.9, s.y), crown);
    R0 = mix(mix(0.45, 0.75, s.z), mix(0.15, 0.4, s.z), crown);
    twist = 0.12; outw = mix(0.12, 0.08, crown); back = mix(0.16, 0.08, crown); rs = 1.0;
  } else {
    th0 = camAz + sd * 3.1416 * mix(0.5, 0.85, k);
    h0 = mix(0.34, 0.6, s.y);
    R0 = mix(0.72, 0.95, s.z);
    twist = 0.22; outw = 0.07; back = 0.12; rs = 0.9;
  }
  // the source creeps a little round the body and the smoke twists gently as it rises
  float th = th0 + 0.22 * sin(te * mix(0.4, 0.9, s.z) + s.w * 6.2832) + sd * twist * a;
  float R = uRadius * R0 + outw * a;
  float rise = (mix(0.3, 0.48, s2.w) * a + mix(0.12, 0.22, s2.z) * a * a) * rs * mix(0.85, 1.12, breath(te)) * mix(0.9, 1.2, uIntensity);
  vec3 radial = vec3(cos(th), 0.0, sin(th));
  vec3 tang = vec3(-radial.z, 0.0, radial.x);
  vec3 p = radial * R + vec3(0.0, h0 * uHeight + rise, 0.0) + away * back * a;
  // a wobbling source: every parcel keeps the sideways push it left with, so S-curves travel up the ribbon
  // slow, long curls: plumes that billow, not strings that wiggle
  float w = mix(1.7, 2.7, s.w);
  float push = (sin(te * w + s.y * 6.2832) * 0.6 + sin(te * w * 2.37 + s.w * 6.2832) * 0.4) * mix(0.035, 0.08, s.z)
    + (texture2D(uNoise, vec2(te * 0.08 + s.w * 3.7, s.z * 5.3)).r - 0.5) * 0.26;
  float pushR = (cos(te * w * 0.73 + s.x * 6.2832) + 0.5 * sin(te * w * 1.9 + s.z * 6.2832)) * 0.04;
  return p + (tang * push + radial * pushR) * a;
}

void main() {
  vec4 s = aSeed; vec4 s2 = aSeed2;
  vec3 tc = cameraPosition - uOrigin; tc.y = 0.0; tc = normalize(tc + vec3(1e-4, 0.0, 0.0));
  float camAz = atan(tc.z, tc.x);
  float cls = s2.y < 0.52 ? 0.0 : 1.0;
  float L = mix(1.1, 2.0, s2.x) * (cls > 0.5 ? 0.8 : 1.0);
  float a = aT * L;
  float te = uTime - a;
  // each emitter breathes: every exhale swells the plume, and between breaths it thins without ever stopping (a mass of
  // smoke, not separate strings)
  float Tp = mix(1.6, 2.8, s2.y);
  float ph = fract(te / Tp + s.y * 7.0);
  float puff = 0.35 + 0.65 * smoothstep(0.0, 0.18, ph) * (1.0 - smoothstep(0.42, 0.9, ph));
  vec3 p = ribbonAt(a, te, s, s2, camAz, cls, -tc);
  // tangent from a longer baseline, so small wobbles never flip the strip into bow-ties
  vec3 p2 = ribbonAt(a + 0.15, te - 0.15, s, s2, camAz, cls, -tc);
  float age = aT;
  float br = breath(te);
  // broad billows that swell on the exhale; the width also swells and pinches along the plume, keyed to emission time
  // so the bulges ride up with the smoke
  float W = uRadius * mix(0.24, 0.6, s2.z) * (cls < 0.5 ? 1.1 : 0.9) * (0.5 + 1.35 * age) * pow(puff, 0.6) * mix(0.8, 1.15, br) * mix(0.9, 1.12, uIntensity);
  W *= 0.6 + 0.8 * smoothstep(0.3, 0.7, texture2D(uNoise, vec2(te * 0.05 + s.y * 3.0, s.x * 2.0 + 0.5)).g);
  float A = puff * smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.4, 1.0, age)) * mix(1.0, 0.75, s2.z) * mix(0.75, 1.0, br);
  vec3 P = uOrigin + p;
  // never between the camera and the body (above the heels), the face or the hands
  float fr = dot(normalize(vec3(p.x, 0.0, p.z) + vec3(1e-4, 0.0, 0.0)), tc);
  A *= 1.0 - smoothstep(-0.12, 0.3, fr) * smoothstep(0.04, 0.12, p.y / uHeight);
  A *= mix(1.0, smoothstep(0.13, 0.3, distance(P, uHead)), smoothstep(-0.5, 0.0, fr));
  A *= smoothstep(0.08, 0.26, distance(P, uHandR)) * smoothstep(0.08, 0.26, distance(P, uHandL));
  // intensity brings ribbons in by seed: the silhouette beat (0.38) already shows most of the aura, the AWAKEN swell
  // (0.45 -> 0.9) adds the rest, while width and rise keep growing with the raw intensity
  float pI = 0.78 * smoothstep(0.0, 0.42, uIntensity) + 0.22 * smoothstep(0.42, 0.9, uIntensity);
  float on = clamp((0.25 + 0.75 * pI - s2.w) / 0.15, 0.0, 1.0) * smoothstep(0.0, 0.1, uIntensity);
  A *= on * mix(0.55, 1.0, pI);
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  vec4 mv2 = modelViewMatrix * vec4(uOrigin + p2, 1.0);
  // lighter and slimmer close to the lens: in mid and close shots the smoke thins so the figure keeps reading (and the
  // close-up plumes cost less fill)
  float nearLens = smoothstep(1.2, 3.6, -mv.z);
  A *= mix(0.35, 1.0, nearLens);
  W *= mix(0.7, 1.0, nearLens);
  vec2 T = mv2.xy - mv.xy;
  // where the ribbon runs towards the lens its strip would fold over itself: fade those stretches out
  A *= smoothstep(0.25, 0.55, length(T) / max(length(mv2.xyz - mv.xyz), 1e-5));
  // a strip aimed at the lens falls back to upright instead of spinning into spikes
  T = normalize(T + vec2(0.0, 0.02 * L * 0.1));
  vec2 N = vec2(-T.y, T.x);
  float pxPerUnit = projectionMatrix[1][1] * 0.5 * uViewH / max(-mv.z, 1e-3);
  float wpx = W * pxPerUnit;
  if (wpx < 1.5) { A *= wpx / 1.5; W = 1.5 / pxPerUnit; }
  // a plume never grows past about a sixth of the frame height across (fill rate on phones)
  W = min(W, 0.16 * uViewH / pxPerUnit);
  mv.xy += N * W * aSide;
  gl_Position = projectionMatrix * mv;
  // keep the gate's light column clean where it stands beside him (a plume drifting across it mottles the beam); where
  // the column is behind his body (the backlit silhouette shots) the smoke round him stays
  if (uGateHW > 0.0) {
    mat4 pv = projectionMatrix * viewMatrix;
    vec4 ga = pv * vec4(uGateA, 1.0), gb = pv * vec4(uGateB, 1.0), gw = pv * vec4(uGateA + vec3(uGateHW, 0.0, 0.0), 1.0);
    vec4 oa = pv * vec4(uOrigin, 1.0), ob = pv * vec4(uOrigin + vec3(0.0, uHeight, 0.0), 1.0);
    // (his half-width measured along the camera's right axis, so it projects the same from any side)
    vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec4 ow = pv * vec4(uOrigin + camR * uRadius * 0.8, 1.0);
    vec2 na = ga.xy / max(ga.w, 1e-3), nb = gb.xy / max(gb.w, 1e-3);
    if (min(min(ga.w, gb.w), min(oa.w, ob.w)) > 0.05 && abs(nb.y - na.y) > 0.2) {
      vec2 np = gl_Position.xy / max(gl_Position.w, 1e-3);
      float gx = mix(na.x, nb.x, clamp((np.y - na.y) / (nb.y - na.y), -1.0, 2.0));
      float ghw = abs(gw.x / gw.w - na.x);
      vec2 ma = oa.xy / oa.w, mb = ob.xy / ob.w;
      float bx = mix(ma.x, mb.x, clamp((np.y - ma.y) / (mb.y - ma.y + 1e-5), 0.0, 1.0));
      float bhw = abs(ow.x / ow.w - ma.x);
      float beside = smoothstep(bhw * 0.9, bhw * 1.8, abs(gx - bx));
      A *= 1.0 - 0.92 * beside * (1.0 - smoothstep(ghw * 1.4, ghw * 3.0 + 0.02, abs(np.x - gx)));
    }
  }
  vUv = vec2(aSide, aT);
  vAlpha = A;
  vData = vec4(te, age, 1.0 - smoothstep(0.0, 0.3, age), cls);
  vSeed = s;
  // cull whole ribbons only (collapsing single vertices would smear their triangles across the frame)
  if (on <= 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const frag = /* glsl */ `
uniform sampler2D uNoise;
uniform float uIntensity, uOpacity, uGlow, uSoft;
uniform vec3 uInk, uMid, uEdge, uHot;
varying vec2 vUv;
varying float vAlpha;
varying vec4 vData;
varying vec4 vSeed;
void main() {
  if (vAlpha < 5e-4) discard;
  float v = vUv.x;
  float age = vData.y;
  // the ink is advected with the smoke: its noise is keyed to emission time, so the texture rides the ribbon
  float n1 = texture2D(uNoise, vec2(v * 0.07 + vSeed.x * 5.0, vData.x * 0.19 + vSeed.y)).r;
  float n2 = texture2D(uNoise, vec2(v * 0.21 + vSeed.z * 3.0, vData.x * 0.47 + vSeed.w)).g;
  float n3 = texture2D(uNoise, vec2(v * 0.5 + vSeed.w * 2.0, vData.x * 1.1 + vSeed.x)).b;
  float n4 = texture2D(uNoise, vec2(v * 0.03 + vSeed.y * 4.0 + sign(v) * 0.37, vData.x * 0.75 + vSeed.z)).r;
  // torn edges: a slow sway of the whole cross-section plus a ragged bite on each side
  float edge = 1.0 - abs(v + (n1 - 0.5) * (0.5 + 1.2 * age)) - (n4 - 0.5) * (0.4 + 0.5 * age);
  // erodes from a dense young core into thin wisps as it rises
  float th = mix(0.04, 0.32, age * age) + (n2 - 0.5) * (0.2 + 0.4 * age) + (n3 - 0.5) * 0.12;
  // soft, feathered edges (smoke, never a cut-out): crisper only where the smoke is young and dense
  float soft = uSoft * (0.7 + 1.6 * age);
  // fade to zero before the strip's own sides, so a swayed profile never shows the quad edge
  float body = smoothstep(th, th + soft, edge) * (1.0 - smoothstep(0.72, 0.98, abs(v)));
  float dens = smoothstep(th, th + 0.5, edge);
  float a = min(body * vAlpha * uOpacity * mix(0.6, 1.0, dens) * (1.0 - 0.25 * age), 0.95);
  // the aura glows from its edges in: a soft violet rim on the torn edge (wide, so it reads as lit smoke, never as a
  // drawn outline or a string) and a broad band inside it
  float rimB = body * (1.0 - smoothstep(th + 0.01, th + 0.16, edge));
  float band = body * (1.0 - smoothstep(th + 0.02, th + 0.5, edge));
  float fringe = smoothstep(th - 0.05, th, edge) * (1.0 - body);
  // backlight catches the rim only in patches (n2), so the edge glows in places instead of outlining every wisp
  float patchy = smoothstep(0.4, 0.8, n2);
  vec3 glow = mix(uEdge, uHot, vData.z * 0.4) * ((rimB * 0.38 + fringe * 0.08) * (0.2 + 1.0 * patchy) + band * 0.22 * (0.35 + n2)) * uGlow * vAlpha;
  // black smoke with a violet-black body: #0A0812 dense, lifting to a deep violet only where it thins
  vec3 ink = mix(uMid, uInk, dens) * (0.85 + 0.3 * n3);
  // the AWAKEN swell brings in more and wider plumes, so each glows a little less: the mass grows, the violet never
  // flares into flame tips
  vec3 col = ink * a + glow * mix(0.6, 1.0, uIntensity) * mix(1.0, 0.7, smoothstep(0.45, 0.9, uIntensity));
  if (a < 0.002 && dot(col, vec3(1.0)) < 0.002) discard;
  gl_FragColor = vec4(col, a);
}`;

export function createInkRibbons(o: InkRibbonOpts): InkRibbons {
  const SEG = o.segments ?? 22;
  const rnd = mulberry32(o.seed ?? 11);
  const g = new THREE.InstancedBufferGeometry();
  const nV = (SEG + 1) * 2;
  const aT = new Float32Array(nV), aSide = new Float32Array(nV);
  for (let i = 0; i <= SEG; i++) {
    aT[i * 2] = aT[i * 2 + 1] = i / SEG;
    aSide[i * 2] = -1;
    aSide[i * 2 + 1] = 1;
  }
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nV * 3), 3));
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  const sa = new Float32Array(o.count * 4), sb = new Float32Array(o.count * 4);
  for (let i = 0; i < o.count * 4; i++) { sa[i] = rnd(); sb[i] = rnd(); }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sa, 4));
  g.setAttribute('aSeed2', new THREE.InstancedBufferAttribute(sb, 4));
  const count = params.reduced ? Math.max(1, Math.floor(o.count * 0.5)) : o.count;
  g.instanceCount = count;

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uViewH: { value: 800 },
    uNoise: { value: noiseTexture() },
    uOrigin: { value: new THREE.Vector3() },
    uHeight: { value: o.height },
    uRadius: { value: o.radius },
    // keep-clear anchors (world space): the face and both hands; far away until the aura binds them
    uHead: { value: new THREE.Vector3(0, 1e4, 0) },
    uHandR: { value: new THREE.Vector3(0, 1e4, 0) },
    uHandL: { value: new THREE.Vector3(0, 1e4, 0) },
    uInk: { value: new THREE.Color(0.0035, 0.003, 0.008) },
    uMid: { value: new THREE.Color(0.04, 0.016, 0.15) },
    uEdge: { value: new THREE.Color(0x7b3fe4).multiplyScalar(0.75) },
    uHot: { value: new THREE.Color(0xb750ea) },
    uGlow: { value: 1.6 },
    uOpacity: { value: 1.0 },
    uSoft: { value: 0.22 },
    // the gate column the smoke keeps clear of where it stands beside him (world space; half-width 0 = no gate)
    uGateA: { value: new THREE.Vector3() },
    uGateB: { value: new THREE.Vector3(0, 1, 0) },
    uGateHW: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = o.renderOrder ?? 14;
  const size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(size);
    uniforms.uViewH.value = size.y;
  };
  return {
    mesh,
    uniforms,
    count,
    triangles: count * SEG * 2,
    setIntensity(v: number) { uniforms.uIntensity.value = v; },
    setAnchors(head?: THREE.Vector3, handR?: THREE.Vector3, handL?: THREE.Vector3) {
      if (head) (uniforms.uHead.value as THREE.Vector3).copy(head);
      if (handR) (uniforms.uHandR.value as THREE.Vector3).copy(handR);
      if (handL) (uniforms.uHandL.value as THREE.Vector3).copy(handL);
    },
    setGate(bottom: THREE.Vector3, top: THREE.Vector3, halfWidth: number) {
      (uniforms.uGateA.value as THREE.Vector3).copy(bottom);
      (uniforms.uGateB.value as THREE.Vector3).copy(top);
      uniforms.uGateHW.value = halfWidth;
    },
    update(t: number, origin: THREE.Vector3) {
      // drawn on 2s like the rest of the effects animation
      uniforms.uTime.value = params.reduced ? t : Math.floor(t * 12) / 12;
      (uniforms.uOrigin.value as THREE.Vector3).copy(origin);
    },
  };
}
