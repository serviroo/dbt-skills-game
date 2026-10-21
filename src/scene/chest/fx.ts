import * as THREE from 'three';
import { NOISE_GLSL } from '../toon';
import { mulberry32 } from '../../core/math';
import { DIM, LID_D, LID_W } from './geometry';

// Linear gold calibrated through the stage AgX: G_WARM x1 = #D0A36C, x2.5 = #EBCDA2, x5+ = white-gold.
const GOLD_GLSL = /* glsl */ `
const vec3 G_CORE = vec3(1.0, 0.5, 0.08);
const vec3 G_WARM = vec3(1.0, 0.38, 0.025);
const vec3 G_GOLD = vec3(0.7, 0.29, 0.012);
const vec3 G_BRONZE = vec3(0.16, 0.085, 0.012);
`;

const additive = (m: THREE.ShaderMaterial) => {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  return m;
};

// ---------------------------------------------------------------------------------------------------------------
/** Volumetric light column: two open cones, brightness from view-facing (fake thickness), height falloff, moving streaks. */
export function lightColumn() {
  const uniforms = {
    uTime: { value: 0 },
    uAmt: { value: 0 },
    uGrow: { value: 0 },
  };
  const mk = (rTop: number, rBot: number, h: number, pow: number, gain: number, fall: number, streakScale: number) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, 48, 12, true);
    g.translate(0, h / 2, 0);
    const m = additive(
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { ...uniforms, uPow: { value: pow }, uGain: { value: gain }, uFall: { value: fall }, uStreak: { value: streakScale }, uH: { value: h } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vP; varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uAmt, uGrow, uPow, uGain, uFall, uStreak, uH;
          varying vec3 vN; varying vec3 vP; varying vec2 vUv;
          ${NOISE_GLSL}
          ${GOLD_GLSL}
          void main() {
            vec3 V = normalize(cameraPosition - vP);
            float facing = abs(dot(normalize(vN), V));
            float body = pow(clamp(facing, 0.0, 1.0), uPow);
            float h = vUv.y;
            float hm = h * uH;
            float grow = 1.0 - smoothstep(uGrow - 0.18, uGrow, h);
            float fall = exp(-hm * uFall) * mix(0.35, 1.0, smoothstep(0.0, 0.55, hm));
            float a = vUv.x * 6.2831853;
            vec2 ring = vec2(cos(a), sin(a)) * uStreak;
            float n = vnoise(vec3(ring, hm * 0.7 - uTime * 0.55));
            float n2 = vnoise(vec3(ring * 2.3 + 11.0, hm * 1.6 - uTime * 1.1));
            float streak = 0.45 + 0.75 * n * n + 0.3 * n2;
            float k = body * fall * grow * streak * uAmt * uGain;
            vec3 c = mix(G_WARM, G_CORE, smoothstep(0.55, 1.0, body) * 0.7) * k;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    return mesh;
  };
  const group = new THREE.Group();
  const outer = mk(0.74, 0.34, 7.5, 3.0, 0.26, 0.34, 7.0);
  const inner = mk(0.3, 0.17, 7.5, 3.6, 1.9, 0.4, 4.0);
  group.add(outer, inner);
  return { group, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
/** Camera-facing soft glow (the light source "bulb" at the opening and at the keyhole). */
export function glowSprite(size: number, color: THREE.ColorRepresentation, falloff = 2.2) {
  const uniforms = { uLevel: { value: 0 }, uColor: { value: new THREE.Color(color) }, uFall: { value: falloff } };
  const m = additive(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 s = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
          mv.xy += position.xy * s;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLevel, uFall; uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          float k = exp(-r * r * 4.0 * uFall) + 0.25 * exp(-r * 3.5) * (1.0 - smoothstep(0.7, 1.0, r));
          k *= 1.0 - smoothstep(0.85, 1.0, r);
          gl_FragColor = vec4(uColor * k * uLevel, 1.0);
        }`,
    }),
  );
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  mesh.scale.setScalar(size);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
/** Interior light plane inside the rim (only seen when the lid lifts). */
export function interiorLight() {
  const w = DIM.W - 0.02, d = DIM.D - 0.02;
  const uniforms = { uLevel: { value: 0 }, uTime: { value: 0 } };
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(0, DIM.rimY[1] - 0.006, 0);
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uLevel, uTime; varying vec2 vUv;
      ${NOISE_GLSL}
      ${GOLD_GLSL}
      void main() {
        // a bed of liquid light: hot centre, slow churning caustics, darker toward the walls
        float core = exp(-dot(vUv * vec2(1.0, 1.3), vUv * vec2(1.0, 1.3)) * 2.4);
        float n = fbm3(vec3(vUv * 2.6, uTime * 0.35));
        float caus = smoothstep(0.45, 0.75, n);
        float edge = smoothstep(1.0, 0.7, max(abs(vUv.x), abs(vUv.y)));
        vec3 c = mix(G_WARM * 0.8, vec3(2.8, 1.4, 0.12), core) + G_WARM * caus * 0.7;
        c *= mix(0.35, 1.0, edge);
        gl_FragColor = vec4(c * uLevel, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
/** Shadow pool on the floor + gold light pool from the chest. */
export function floorFx() {
  const uniforms = {
    uTime: { value: 0 },
    uPool: { value: 0 },
    uPoolR: { value: 1 },
    uRipple: { value: 0 },
    uGlow: { value: 0 },
    uContact: { value: 0 },
  };
  const g = new THREE.PlaneGeometry(4.4, 4.4);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `varying vec3 vP; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vP = position; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uPool, uPoolR, uRipple, uGlow, uContact;
      varying vec3 vP;
      ${NOISE_GLSL}
      ${GOLD_GLSL}
      void main() {
        vec2 p = vP.xz;
        float r = length(p);
        float a = atan(p.y, p.x);
        // shadow pool: near-black, ragged swirling edge (noise only while a pool exists: uniform branch)
        float pool = 0.0, lip = 0.0, wet = 0.0;
        if (uPool > 0.001) {
          float n = fbm3(vec3(cos(a) * 1.6 + r * 1.2, sin(a) * 1.6 - r * 0.8, uTime * 0.18));
          float edge = uPoolR * (0.86 + 0.28 * n);
          pool = (1.0 - smoothstep(edge - 0.28, edge, r)) * uPool;
          float lq = (r - edge * 0.93) / 0.05; lip = exp(-lq * lq) * uPool;
          float swirl = fbm3(vec3(cos(a + r * 2.5 - uTime * 0.25) * r * 3.0, sin(a + r * 2.5 - uTime * 0.25) * r * 3.0, uTime * 0.1));
          wet = smoothstep(0.55, 0.75, swirl) * pool * smoothstep(0.15, 0.6, r);
        }
        float rip = 0.0;
        if (uRipple > 0.0 && uRipple < 1.6) {
          float rr = 0.45 + uRipple * 1.1;
          float rq = (r - rr) / 0.035; rip = exp(-rq * rq) * (1.0 - uRipple / 1.6) * 0.6;
        }
        // contact shadow: soft ellipse under the chest
        vec2 q = p / vec2(${(DIM.W * 0.62).toFixed(3)}, ${(DIM.D * 0.66).toFixed(3)});
        float contact = exp(-dot(q, q) * 1.6) * uContact;
        // gold light pool around the base
        vec2 gq = p / vec2(${(DIM.W * 0.9).toFixed(3)}, ${(DIM.D * 1.1).toFixed(3)});
        float gl = exp(-dot(gq, gq) * 1.1);
        float glow = (gl * 0.85 + exp(-dot(gq, gq) * 5.0) * 0.6) * uGlow;
        if (glow > 0.002) glow *= 0.88 + 0.24 * vnoise(vec3(p * 4.0, uTime * 0.3));
        float dark = clamp(max(pool * 0.96, contact * 0.85), 0.0, 1.0);
        // wet ink: a faint cold sheen just inside the edge, dim ripples; violet only as a whisper
        vec3 c = vec3(0.02, 0.018, 0.05) * lip * 0.25 + vec3(0.03, 0.022, 0.065) * rip * 0.5 + vec3(0.012, 0.012, 0.03) * wet;
        c += mix(G_GOLD, G_WARM, gl) * glow;
        // blend is dst * (1 - a) + src: darken under, add light on top
        gl_FragColor = vec4(c, dark);
      }`,
  });
  // custom blending: dst * (1 - a) + src
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = 0.003;
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
/**
 * Streak particles: instanced quads stretched in screen space between a particle's position now and a moment ago.
 * `body` is GLSL that defines `void particle(vec4 s, vec4 s2, float t, out vec3 p, out float alpha, out float size)`.
 */
export function streaks<U extends Record<string, THREE.IUniform>>(count: number, body: string, uniforms: U, seed: number, colorGLSL = 'mix(G_WARM, G_CORE, 0.55) * 2.2') {
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  const r = mulberry32(seed);
  const s = new Float32Array(count * 4), s2 = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) {
    s[i] = r();
    s2[i] = r();
  }
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 4));
  g.setAttribute('aS2', new THREE.InstancedBufferAttribute(s2, 4));
  g.instanceCount = count;
  const all = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1280, 720) }, uDt: { value: 1 / 30 }, ...uniforms };
  const m = additive(
    new THREE.ShaderMaterial({
      uniforms: all,
      vertexShader: /* glsl */ `
        uniform float uTime, uDt; uniform vec2 uRes;
        attribute vec4 aS; attribute vec4 aS2;
        varying vec2 vQ; varying float vA; varying float vL; varying float vW;
        ${NOISE_GLSL}
        ${body}
        void main() {
          vec3 p0, p1; float a0, a1, sz0, sz1;
          particle(aS, aS2, uTime, p0, a0, sz0);
          particle(aS, aS2, uTime - uDt, p1, a1, sz1);
          vec4 c0 = projectionMatrix * viewMatrix * modelMatrix * vec4(p0, 1.0);
          vec4 c1 = projectionMatrix * viewMatrix * modelMatrix * vec4(p1, 1.0);
          vA = a0;
          if (c0.w <= 0.01 || c1.w <= 0.01 || a0 <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); vL = 0.0; vW = 1.0; return; }
          vec2 h = uRes * 0.5;
          vec2 s0 = c0.xy / c0.w * h, s1 = c1.xy / c1.w * h;
          float px = max(sz0 * projectionMatrix[1][1] * h.y / c0.w, 1.2);
          vec2 d = s0 - s1;
          float len = length(d);
          vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float along = position.y; // 0 = head, 1 = tail
          vec2 sp = mix(s0, s1, along) + dir * px * 0.5 * (1.0 - 2.0 * along) + nrm * position.x * px;
          float total = len + px;
          vQ = vec2(position.x * px, along * total);
          vL = len; vW = px;
          gl_Position = vec4(sp / h * c0.w, c0.z, c0.w);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying float vA; varying float vL; varying float vW;
        ${GOLD_GLSL}
        void main() {
          // capsule: round head, soft round tail, brightness fading toward the tail
          float r = vW * 0.5;
          float y = clamp(vQ.y, r, r + vL);
          float d = length(vec2(vQ.x, vQ.y - y)) / r;
          float body = 1.0 - smoothstep(0.0, 1.0, d);
          float tail = 1.0 - 0.8 * clamp((vQ.y - r) / max(vL, 1e-3), 0.0, 1.0);
          float k = body * body * tail * vA;
          gl_FragColor = vec4(${colorGLSL} * k, 1.0);
        }`,
    }),
  );
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return { mesh, uniforms: all };
}

const CHEST_CENTER = /* glsl */ `const vec3 CC = vec3(0.0, 0.5, 0.0);`;

/** Idle motes: drift and rise around the chest; pulled into the seams by charge; sucked up the column once open. */
export const MOTES_GLSL = /* glsl */ `
uniform float uCharge, uOpen, uShow;
${CHEST_CENTER}
void particle(vec4 s, vec4 s2, float t, out vec3 p, out float alpha, out float size) {
  float period = 5.5 + s.x * 5.0;
  float ph = fract(t / period + s.y);
  float ang = s.z * 6.2831853 + t * (0.12 + s.w * 0.12) * (s2.x < 0.5 ? 1.0 : -1.0) + ph * 0.9;
  float rad = 0.62 + s2.y * 0.75;
  float y = 0.04 + ph * (0.9 + s2.z * 0.8);
  vec3 idle = vec3(cos(ang) * rad, y, sin(ang) * rad * 0.8);
  idle += 0.05 * vec3(vnoise(vec3(s.xy * 9.0, t * 0.4)) - 0.5, 0.0, vnoise(vec3(s.zw * 9.0, t * 0.4)) - 0.5);
  // charge: converge on the seam line (nearest point on the lid seam rectangle)
  vec3 seamP = vec3(clamp(idle.x, -${(DIM.W / 2).toFixed(3)}, ${(DIM.W / 2).toFixed(3)}), 0.545, clamp(idle.z, -${(DIM.D / 2).toFixed(3)}, ${(DIM.D / 2).toFixed(3)}));
  float pull = smoothstep(0.0, 1.0, uCharge * 1.5 - s2.w * 0.5);
  pull = pull * pull;
  vec3 cp = mix(idle, seamP, pull * 0.92);
  // open: rise up the column
  float rise = uOpen;
  float cy = 0.6 + fract(ph + t * (0.12 + s.x * 0.1)) * 3.2;
  float cr = (0.12 + s2.y * 0.35) * (1.0 + cy * 0.12);
  vec3 col = vec3(cos(ang * 1.3) * cr, cy, sin(ang * 1.3) * cr);
  p = mix(cp, col, rise);
  float life = sin(3.14159 * ph);
  alpha = uShow * life * mix(0.35 + 0.4 * s2.x, 1.0, max(pull, rise * 0.8)) * (1.0 - 0.0);
  size = 0.006 + s.w * 0.006 + pull * 0.003 + rise * 0.004;
}
`;

/** Converging streaks while charging: pulled in from a wide shell to the seam and the keyhole. */
export const CONVERGE_GLSL = /* glsl */ `
uniform float uCharge;
${CHEST_CENTER}
void particle(vec4 s, vec4 s2, float t, out vec3 p, out float alpha, out float size) {
  float rate = 0.55 + s.x * 0.45 + uCharge * 0.6;
  float ph = fract(t * rate + s.y);
  float th = s.z * 6.2831853;
  float el = mix(-0.15, 0.95, s.w);
  vec3 dir = normalize(vec3(cos(th) * cos(el), sin(el), sin(th) * cos(el)));
  vec3 from = CC + dir * (0.85 + s2.x * 0.55);
  vec3 to = s2.y < 0.3 ? vec3(0.0, 0.33, 0.33) : vec3(dir.x * 0.5, 0.545, dir.z * 0.32);
  float e = ph * ph * ph;
  vec3 mid = mix(from, to, e);
  // swirl around the vertical axis as it falls in
  float sw = (1.0 - e) * 0.9 * (s2.z - 0.5);
  float cs = cos(sw), sn = sin(sw);
  vec3 q = mid - CC;
  q = vec3(q.x * cs - q.z * sn, q.y, q.x * sn + q.z * cs);
  p = CC + q;
  float on = smoothstep(0.08 + s2.w * 0.3, 0.35 + s2.w * 0.3, uCharge);
  alpha = on * smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.85, 1.0, ph)) * (0.5 + 0.5 * e);
  size = 0.007 + 0.004 * s2.x;
}
`;

/** Burst sparks: out from the opening in a flattened ring plus an upward fountain. uBurst = seconds since burst. */
export const SPARKS_GLSL = /* glsl */ `
uniform float uBurst;
void particle(vec4 s, vec4 s2, float t, out vec3 p, out float alpha, out float size) {
  float tb = uBurst - (uTime - t);
  if (tb <= 0.0 || tb > 0.62) { p = vec3(0.0); alpha = 0.0; size = 0.0; return; }
  float th = s.x * 6.2831853;
  bool up = s.y < 0.35;
  float el = up ? mix(0.9, 1.45, s.z) : mix(-0.05, 0.35, s.z);
  vec3 dir = vec3(cos(th) * cos(el), sin(el), sin(th) * cos(el));
  float v0 = up ? mix(2.4, 5.0, s.w) : mix(2.6, 5.8, s.w);
  float k = 5.5;
  float d = v0 * (1.0 - exp(-k * tb)) / k;
  vec3 o = vec3(cos(th) * 0.32, 0.6, sin(th) * 0.22);
  p = o + dir * d + vec3(0.0, -0.7 * tb * tb, 0.0);
  float life = 0.26 + s2.x * 0.16;
  alpha = (1.0 - smoothstep(life * 0.45, life, tb)) * (0.7 + 0.6 * s2.y);
  size = 0.009 + s2.z * 0.007;
}
`;

// ---------------------------------------------------------------------------------------------------------------
/** Gold shards: a faceted ring of fragments flung out for 333 ms. CPU-posed instances (cheap: ~30). */
export function shards(count: number, seed: number) {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(0.03, 0.095, 0.016);
  const uniforms = { uLevel: { value: 1 }, uKeyDir: { value: new THREE.Vector3(-0.4, 0.8, 0.5).normalize() } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLevel; uniform vec3 uKeyDir;
      varying vec3 vP;
      ${GOLD_GLSL}
      void main() {
        vec3 N = normalize(cross(dFdx(vP), dFdy(vP)));
        vec3 V = normalize(cameraPosition - vP);
        if (dot(N, V) < 0.0) N = -N;
        float ndl = dot(N, uKeyDir);
        float f = abs(dot(N, V));
        vec3 c = mix(G_BRONZE * 0.6, G_WARM * 1.6, smoothstep(-0.1, 0.5, ndl));
        c = mix(c, G_CORE * 3.0, smoothstep(0.92, 0.97, dot(N, normalize(uKeyDir + V))));
        c += G_WARM * 1.2 * (1.0 - f);
        gl_FragColor = vec4(c * uLevel, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(g, m, count);
  mesh.frustumCulled = false;
  const r = mulberry32(seed);
  const P = Array.from({ length: count }, (_, i) => ({
    th: ((i + r() * 0.6) / count) * Math.PI * 2,
    el: -0.05 + r() * 0.45,
    v: 2.4 + r() * 2.6,
    spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
    w: 8 + r() * 14,
    s: 0.7 + r() * 0.7,
    life: 0.26 + r() * 0.12,
  }));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3();
  const look = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  function pose(tb: number) {
    const on = tb > 0 && tb < 0.42;
    mesh.visible = on;
    if (!on) return;
    for (let i = 0; i < count; i++) {
      const p = P[i];
      const dir = new THREE.Vector3(Math.cos(p.th) * Math.cos(p.el), Math.sin(p.el), Math.sin(p.th) * Math.cos(p.el));
      const k = 6;
      const d = (p.v * (1 - Math.exp(-k * tb))) / k;
      T.set(Math.cos(p.th) * 0.36, 0.6, Math.sin(p.th) * 0.24).addScaledVector(dir, d);
      look.setFromUnitVectors(up, dir);
      Q.setFromAxisAngle(p.spin, tb * p.w).premultiply(look);
      const life = Math.max(0, 1 - tb / p.life);
      const sc = p.s * Math.pow(life, 0.6) * Math.min(1, tb / 0.03);
      S.setScalar(sc);
      M.compose(T, Q, S);
      mesh.setMatrixAt(i, M);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, uniforms, pose };
}

// ---------------------------------------------------------------------------------------------------------------
/** Horizontal shock ring at the opening (one quad). */
export function shockRing() {
  const uniforms = { uR: { value: 0 }, uW: { value: 0.03 }, uLevel: { value: 0 } };
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  const m = additive(
    new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms,
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xz * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uR, uW, uLevel; varying vec2 vP;
        ${GOLD_GLSL}
        void main() {
          vec2 q = vP * vec2(1.0, 1.35);
          float r = length(q);
          float q1 = (r - uR) / uW, q2 = (r - uR * 0.92) / (uW * 3.0); float k = exp(-q1 * q1) + 0.25 * exp(-q2 * q2);
          k *= 1.0 - smoothstep(0.92, 1.0, r);
          gl_FragColor = vec4(mix(G_WARM, G_CORE, 0.5) * k * uLevel, 1.0);
        }`,
    }),
  );
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.setScalar(3.6);
  mesh.position.y = 0.6;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
/** 4-point star glints pinned to anchors on the gold. Each twinkles briefly on its own deterministic schedule. */
export function glints(anchors: THREE.Vector3[], seed: number) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  const r = mulberry32(seed);
  const a = new Float32Array(anchors.length * 3), ph = new Float32Array(anchors.length * 2);
  anchors.forEach((v, i) => {
    a.set([v.x, v.y, v.z], i * 3);
    ph.set([r(), 0.75 + r() * 0.6], i * 2);
  });
  g.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(a, 3));
  g.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 2));
  g.instanceCount = anchors.length;
  const uniforms = { uTime: { value: 0 }, uRate: { value: 1 }, uLevel: { value: 0 }, uRes: { value: new THREE.Vector2(1280, 720) } };
  const m = additive(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime, uRate, uLevel; uniform vec2 uRes;
        attribute vec3 aAnchor; attribute vec2 aPh;
        varying vec2 vUv; varying float vK;
        void main() {
          float period = 4.2 / max(uRate, 0.1);
          float ph = fract(uTime / period * aPh.y + aPh.x);
          float win = 0.11;
          float k = ph < win ? sin(3.14159 * ph / win) : 0.0;
          vK = k * k * uLevel;
          vec4 c = projectionMatrix * viewMatrix * modelMatrix * vec4(aAnchor, 1.0);
          float px = 22.0 * (uRes.y / 900.0) * (0.6 + 0.4 * k);
          vUv = position.xy * 2.0;
          c.xy += position.xy * px * 2.0 / uRes * c.w;
          c.z -= 0.02 * c.w;
          gl_Position = vK > 0.001 ? c : vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vK;
        ${GOLD_GLSL}
        void main() {
          vec2 q = abs(vUv);
          float star = exp(-q.x * 30.0) * exp(-q.y * 3.2) + exp(-q.y * 30.0) * exp(-q.x * 3.2);
          float core = exp(-dot(vUv, vUv) * 40.0);
          float k = (star * 0.9 + core * 1.2) * (1.0 - smoothstep(0.8, 1.0, max(q.x, q.y)));
          gl_FragColor = vec4(mix(G_WARM, G_CORE, 0.7) * k * vK * 2.4, 1.0);
        }`,
    }),
  );
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
/** Light leaking through the lid seam while charging: a fan of thin rays around the seam perimeter. */
export function leakRays() {
  const hw = LID_W / 2 + 0.004, hd = LID_D / 2 + 0.004;
  const N = 220;
  const pos: number[] = [];
  const att: number[] = [];
  const idx: number[] = [];
  const per = 2 * (2 * hw + 2 * hd);
  const pointAt = (u: number) => {
    let d = u * per;
    const seg = [2 * hw, 2 * hd, 2 * hw, 2 * hd];
    const corners = [
      [-hw, hd, 1, 0, 0, 1],
      [hw, hd, 0, -1, 1, 0],
      [hw, -hd, -1, 0, 0, -1],
      [-hw, -hd, 0, 1, -1, 0],
    ];
    for (let k = 0; k < 4; k++) {
      if (d <= seg[k] || k === 3) {
        const [x, z, dx, dz, nx, nz] = corners[k];
        return [x + dx * d, z + dz * d, nx, nz];
      }
      d -= seg[k];
    }
    return [0, 0, 0, 1];
  };
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const [x, z, nx, nz] = pointAt(u);
    const y = DIM.seamY[0] + 0.004;
    pos.push(x, y, z, x + nx * 0.36, y + 0.27, z + nz * 0.36);
    att.push(u, 0, u, 1);
    if (i < N) {
      const a = i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(att, 2));
  g.setIndex(idx);
  const uniforms = { uTime: { value: 0 }, uLevel: { value: 0 } };
  const m = additive(
    new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms,
      vertexShader: /* glsl */ `attribute vec2 aUV; varying vec2 vUv; void main(){ vUv = aUV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uLevel; varying vec2 vUv;
        ${NOISE_GLSL}
        ${GOLD_GLSL}
        void main() {
          float u = vUv.x * ${per.toFixed(3)} * 18.0;
          float n = vnoise(vec3(u, uTime * 0.6, 0.0));
          float n2 = vnoise(vec3(u * 2.7 + 9.0, uTime * 1.1, 3.0));
          float rays = pow(max(n, 0.0), 3.5) * 1.6 + pow(max(n2, 0.0), 6.0) * 1.2;
          float fall = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.2);
          float k = rays * fall * uLevel;
          gl_FragColor = vec4(mix(G_WARM, G_CORE, 0.4) * k, 1.0);
        }`,
    }),
  );
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
/** Star sparkles spiralling up the light column once the chest is open. */
export function risingStars(count: number, seed: number) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  const r = mulberry32(seed);
  const s = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) s[i] = r();
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 4));
  g.instanceCount = count;
  const uniforms = { uTime: { value: 0 }, uOpen: { value: 0 }, uTw: { value: 1 }, uRes: { value: new THREE.Vector2(1280, 720) } };
  const m = additive(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime, uOpen, uTw; uniform vec2 uRes;
        attribute vec4 aS;
        varying vec2 vUv; varying float vK;
        void main() {
          float t = uTime;
          float ph = fract(aS.x + t * (0.16 + 0.12 * aS.y));
          float y = 0.62 + ph * 3.4;
          float rad = (0.08 + aS.z * 0.3) * (1.0 + y * 0.12);
          float a = aS.w * 6.2831853 + t * (0.5 + aS.y * 0.6) + ph * 2.0;
          vec3 p = vec3(cos(a) * rad, y, sin(a) * rad * 0.8);
          float tw = mix(0.6, pow(0.5 + 0.5 * sin(t * (2.0 + aS.y * 3.0) + aS.x * 40.0), 4.0), uTw);
          vK = uOpen * smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.6, 1.0, ph)) * tw;
          vec4 c = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
          float px = (7.0 + 11.0 * aS.z) * (uRes.y / 900.0);
          vUv = position.xy * 2.0;
          c.xy += position.xy * px * 2.0 / uRes * c.w;
          gl_Position = vK > 0.002 ? c : vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vK;
        ${GOLD_GLSL}
        void main() {
          vec2 q = abs(vUv);
          float star = exp(-q.x * 26.0) * exp(-q.y * 3.0) + exp(-q.y * 26.0) * exp(-q.x * 3.0);
          float core = exp(-dot(vUv, vUv) * 30.0);
          float k = (star + core * 1.3) * (1.0 - smoothstep(0.8, 1.0, max(q.x, q.y)));
          gl_FragColor = vec4(mix(G_WARM, G_CORE, 0.6) * k * vK * 3.0, 1.0);
        }`,
    }),
  );
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
/**
 * Falling stars thrown up by the burst: each arcs out of the opening, slows at the top and falls away to the side
 * with a curved comet trail. One instanced draw: every instance is a trail ribbon (sampled back along its own path)
 * plus a four-point star quad at the head. uTb = seconds since the burst (not clamped to the lid animation).
 */
export function fallingStars(count: number, seed: number) {
  const SEG = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    pos.push(i / SEG, -1, 0, i / SEG, 1, 0);
    if (i < SEG) {
      const a = i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const h0 = (SEG + 1) * 2;
  pos.push(-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1);
  idx.push(h0, h0 + 1, h0 + 2, h0, h0 + 2, h0 + 3);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const r = mulberry32(seed);
  const s = new Float32Array(count * 4), s2 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // alternate sides so both flanks of the column get a star; spread the launch over the first 0.2 s
    s.set([i % 2 ? 0.75 : 0.25, (i + r() * 0.8) / count, r(), r()], i * 4);
    s2.set([0.02 + (i / count) * 0.2 + r() * 0.04, r(), r(), r()], i * 4);
  }
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 4));
  g.setAttribute('aS2', new THREE.InstancedBufferAttribute(s2, 4));
  g.instanceCount = count;
  const uniforms = { uTb: { value: -1 }, uLevel: { value: 1 }, uRes: { value: new THREE.Vector2(1280, 720) } };
  const m = additive(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        uniform float uTb, uLevel; uniform vec2 uRes;
        attribute vec4 aS; attribute vec4 aS2;
        varying vec2 vQ; varying float vKind; varying float vA; varying float vTw;
        vec3 path(float t) {
          float side = aS.x < 0.5 ? -1.0 : 1.0;
          vec3 v0 = vec3(side * mix(0.5, 1.45, aS.y), mix(2.5, 3.3, aS.z), mix(-0.15, 0.5, aS.w));
          float k = 1.4, gk = 3.2 / 1.4;
          float e = (1.0 - exp(-k * t)) / k;
          vec3 p = vec3(side * 0.08, 0.62, 0.0) + v0 * e;
          p.y -= gk * (t - e);
          return p;
        }
        vec2 toScreen(vec3 p, out float w) {
          vec4 c = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
          w = c.w;
          return c.xy / c.w * uRes * 0.5;
        }
        void main() {
          float t = uTb - aS2.x;
          float life = 1.45 + aS2.y * 0.5;
          float fade = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(life * 0.62, life, t));
          vA = fade * uLevel;
          vKind = position.z;
          vTw = 0.82 + 0.18 * sin(t * (9.0 + aS2.z * 5.0) + aS2.w * 20.0);
          if (t <= 0.0 || t >= life || vA <= 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); return; }
          float sc = uRes.y / 900.0;
          float headPx = (12.0 + 7.0 * aS2.z) * sc;
          vec4 c0 = projectionMatrix * viewMatrix * modelMatrix * vec4(path(t), 1.0);
          if (position.z > 0.5) {
            // head: a screen-aligned quad around the star
            vQ = position.xy;
            c0.xy += position.xy * headPx * 2.0 / uRes * c0.w;
            gl_Position = c0;
            return;
          }
          // trail: sampled back along the path, tapering to nothing
          float along = position.x;
          float back = 0.16 + 0.06 * aS2.w;
          float tt = max(t - along * back, 0.0);
          float w1, w2;
          vec2 sp = toScreen(path(tt), w1);
          vec2 sq = toScreen(path(max(tt - 0.012, 0.0)), w2);
          vec2 d = sp - sq;
          float len = length(d);
          vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float halfW = headPx * 0.24 * pow(max(1.0 - along, 0.0), 0.8) + 0.6;
          sp += nrm * position.y * halfW;
          vQ = vec2(along, position.y);
          vec4 c = projectionMatrix * viewMatrix * modelMatrix * vec4(path(tt), 1.0);
          gl_Position = vec4(sp / (uRes * 0.5) * c.w, c.z, c.w);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying float vKind; varying float vA; varying float vTw;
        ${GOLD_GLSL}
        void main() {
          vec3 c;
          if (vKind > 0.5) {
            vec2 q = abs(vQ);
            // four-point star: long vertical points, shorter side points, a hot round core
            float star = exp(-q.x * 16.0) * exp(-q.y * 2.6) + exp(-q.y * 18.0) * exp(-q.x * 3.6);
            float core = exp(-dot(vQ, vQ) * 26.0);
            c =(mix(G_WARM, G_CORE, 0.65) * 2.6 * star * vTw + vec3(2.2, 1.7, 1.1) * core) * (1.0 - smoothstep(0.8, 1.0, max(q.x, q.y)));
          } else {
            float a = vQ.x;
            float across = exp(-vQ.y * vQ.y * 2.6);
            float k = across * pow(clamp(1.0 - a, 0.0, 1.0), 1.7);
            c = mix(G_CORE * 1.6, G_WARM, smoothstep(0.0, 0.5, a)) * 1.5 * k;
          }
          gl_FragColor = vec4(c * vA, 1.0);
        }`,
    }),
  );
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.visible = false;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
/**
 * A single crimson feather of light. Camera-facing quad; the caller poses it per frame (position in the parent,
 * roll and turn). Drawn in the fragment shader: a bowed shaft, asymmetric vanes with barbs swept toward the tip,
 * one split in each vane, a soft glow.
 */
export function lightFeather(length = 0.3) {
  const uniforms = { uLevel: { value: 0 }, uRoll: { value: 0 }, uTurn: { value: 1 }, uLen: { value: length } };
  const m = additive(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        uniform float uRoll, uTurn, uLen;
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 2.0;
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 q = position.xy * vec2(0.62 * uTurn, 1.0) * uLen * 1.15;
          float cs = cos(uRoll), sn = sin(uRoll);
          mv.xy += vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLevel;
        varying vec2 vUv;
        void main() {
          // s: 0 at the quill end, 1 at the tip; x across, in units of the quad half-width
          float s = vUv.y * 0.5 / 0.92 + 0.5;
          float x = vUv.x;
          float shaft = 0.16 * sin(3.14159 * clamp(s, 0.0, 1.0)) - 0.05;
          float d = x - shaft;
          float vs = clamp((s - 0.15) / 0.85, 0.0, 1.0);
          float prof = pow(max(sin(3.14159 * pow(vs, 0.85)), 0.0), 0.62) * (1.0 - 0.18 * vs);
          float wR = 0.74 * prof, wL = 0.5 * prof;
          float w = d > 0.0 ? wR : wL;
          float ad = abs(d);
          float inV = (1.0 - smoothstep(w - 0.07, w, ad)) * step(0.15, s) * step(s, 1.0);
          // barbs sweep toward the tip as they leave the shaft
          float ph = s * 34.0 - ad * 10.0;
          float bc = 0.5 + 0.5 * cos(ph * 6.2831853);
          float barb = 0.62 + 0.38 * bc * bc;
          // one split in each vane
          float sp = d > 0.0 ? 0.58 : 0.44;
          float gap = smoothstep(0.012, 0.0, abs(s - sp - ad * 0.42)) * smoothstep(0.08, 0.22, ad / max(w, 1e-3));
          float vane = inV * barb * (1.0 - gap) * mix(1.0, 0.5, smoothstep(0.0, 1.0, ad / max(w, 1e-3)));
          float rd = d / 0.03;
          float rach = exp(-rd * rd) * step(0.02, s) * (1.0 - smoothstep(0.93, 1.0, s));
          float edge = max(ad - w, 0.0);
          float halo = (exp(-edge * 7.0) * 0.22 + exp(-edge * 2.6) * 0.1) * smoothstep(0.1, 0.25, s) * (1.0 - smoothstep(0.95, 1.08, s));
          // crimson light: deep red vanes that brighten toward a hot shaft and glow at the fringe. Premultiplied, so it
          // partly covers what is behind it and stays crimson over the warm column haze instead of washing to pink.
          float lum = smoothstep(1.0, 0.0, ad / max(w, 1e-3));
          vec3 c = vec3(0.5, 0.004, 0.022) * vane * (0.9 + 1.4 * lum * lum) + vec3(0.32, 0.0, 0.012) * halo + vec3(1.15, 0.16, 0.13) * rach;
          float fade = 1.0 - smoothstep(0.8, 1.0, max(abs(vUv.x), abs(vUv.y)));
          float cover = clamp(inV * 0.62 + rach * 0.4 + halo * 0.6, 0.0, 0.8) * fade;
          gl_FragColor = vec4(c * fade * uLevel, cover * uLevel);
        }`,
    }),
  );
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;
  return { mesh, uniforms };
}
