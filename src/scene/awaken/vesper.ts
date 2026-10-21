import * as THREE from 'three';
import { clamp, smoothstep, lerp, ease } from '../../core/math';
import { params } from '../../core/params';
import { ATMOS } from './materials';
import { light } from '../toon';

/**
 * Vesper, the shadow wyvern: long neck, swept horns, bat wings on four finger bones, a long tail and tucked hind legs.
 * Black like the other shadows, with thin violet-blue seams along the wing bones and spine and glowing eyes.
 * One merged mesh, one draw call. Model space: forward +z, up +y, wings along x.
 * aType: 0 body, 1 wing membrane, 2 seam, 3 eye. aWing: side * span weight (0 on the body) for the flap.
 */
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

class KB {
  pos: number[] = [];
  nrm: number[] = [];
  type: number[] = [];
  wing: number[] = [];
  idx: number[] = [];
  get n() {
    return this.pos.length / 3;
  }
  v(p: THREE.Vector3, nn: THREE.Vector3, type: number, wing: number) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(nn.x, nn.y, nn.z);
    this.type.push(type);
    this.wing.push(wing);
    return this.n - 1;
  }
}

/** Ring loft along a polyline with a radius per point (x, y half-axes). */
function loft(b: KB, pts: THREE.Vector3[], rad: (i: number) => [number, number], seg: number, type: number, wingOf: (p: THREE.Vector3) => number) {
  const base = b.n;
  const up = V(0, 1, 0);
  for (let i = 0; i < pts.length; i++) {
    const t = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
    const xa = new THREE.Vector3().crossVectors(up, t).normalize();
    if (xa.lengthSq() < 1e-6) xa.set(1, 0, 0);
    const ya = new THREE.Vector3().crossVectors(t, xa).normalize();
    const [rx, ry] = rad(i);
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const d = xa.clone().multiplyScalar(Math.cos(a)).addScaledVector(ya, Math.sin(a));
      const p = pts[i].clone().addScaledVector(xa, Math.cos(a) * rx).addScaledVector(ya, Math.sin(a) * ry);
      b.v(p, d, type, wingOf(p));
    }
  }
  for (let i = 0; i < pts.length - 1; i++)
    for (let s = 0; s < seg; s++) {
      const a = base + i * seg + s, c = base + i * seg + ((s + 1) % seg);
      const d = base + (i + 1) * seg + ((s + 1) % seg), e = base + (i + 1) * seg + s;
      b.idx.push(a, e, d, a, d, c);
    }
}

/** Tapered tube (seams, horns, legs). */
function tube(b: KB, ctrl: THREE.Vector3[], r0: number, r1: number, n: number, seg: number, type: number, wingOf: (p: THREE.Vector3) => number) {
  const pts = ctrl.length > 2 ? new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(n) : [ctrl[0], ctrl[1]];
  loft(b, pts, (i) => {
    const r = lerp(r0, r1, i / (pts.length - 1));
    return [r, r];
  }, seg, type, wingOf);
}

/** Membrane grid (rows x cols), double sided by the material. */
function sheet(b: KB, grid: THREE.Vector3[][], type: number, wingOf: (p: THREE.Vector3) => number) {
  const R = grid.length, C = grid[0].length;
  const base = b.n;
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const a = grid[Math.min(R - 1, r + 1)][c].clone().sub(grid[Math.max(0, r - 1)][c]);
      const e = grid[r][Math.min(C - 1, c + 1)].clone().sub(grid[r][Math.max(0, c - 1)]);
      const nn = new THREE.Vector3().crossVectors(e, a).normalize();
      if (nn.y < 0) nn.negate();
      b.v(grid[r][c], nn, type, wingOf(grid[r][c]));
    }
  for (let r = 0; r < R - 1; r++)
    for (let c = 0; c < C - 1; c++) {
      const a = base + r * C + c, bb = a + 1, d = a + C, e = d + 1;
      b.idx.push(a, d, e, a, e, bb);
    }
}

function buildGeometry(q: number) {
  const b = new KB();
  const body = () => 0;
  /* spine: tail tip -> hips -> chest -> neck -> head -> snout */
  const spineCtrl = [V(0, 0.32, -3.7), V(0, 0.16, -2.7), V(0, 0.04, -1.7), V(0, 0, -0.75), V(0, 0.05, 0.2), V(0, 0.16, 0.72), V(0, 0.36, 1.3), V(0, 0.52, 1.82), V(0, 0.58, 2.12), V(0, 0.5, 2.8)];
  const spine = new THREE.CatmullRomCurve3(spineCtrl, false, 'centripetal').getSpacedPoints(q < 1 ? 36 : 52);
  const prof: [number, number][] = [
    [0, 0.014], [0.22, 0.08], [0.42, 0.26], [0.52, 0.38], [0.6, 0.4], [0.67, 0.22], [0.8, 0.15], [0.86, 0.17], [0.9, 0.19], [0.95, 0.12], [1, 0.03],
  ];
  const rAt = (s: number) => {
    for (let i = 0; i < prof.length - 1; i++) if (s <= prof[i + 1][0]) return lerp(prof[i][1], prof[i + 1][1], ease.inOutSine((s - prof[i][0]) / (prof[i + 1][0] - prof[i][0])));
    return 0.02;
  };
  loft(b, spine, (i) => {
    const s = i / (spine.length - 1);
    const r = rAt(s);
    // the head is flatter and wider than the neck; the body a little deeper than wide
    const head = smoothstep(0.84, 0.9, s);
    return [r * lerp(1.0, 1.15, head), r * lerp(1.12, 0.78, head)];
  }, q < 1 ? 7 : 9, 0, body);

  /* horns: two long swept-back horns, two short ones under them */
  for (const sg of [1, -1]) {
    tube(b, [V(0.07 * sg, 0.66, 2.1), V(0.16 * sg, 0.82, 1.78), V(0.24 * sg, 0.9, 1.42), V(0.28 * sg, 0.9, 1.15)], 0.05, 0.004, 8, 5, 0, body);
    tube(b, [V(0.11 * sg, 0.56, 2.02), V(0.2 * sg, 0.6, 1.8), V(0.26 * sg, 0.58, 1.62)], 0.03, 0.003, 5, 4, 0, body);
    // tucked hind legs
    tube(b, [V(0.2 * sg, -0.08, -0.6), V(0.27 * sg, -0.3, -0.92), V(0.22 * sg, -0.36, -1.32), V(0.2 * sg, -0.3, -1.55)], 0.085, 0.02, 6, 5, 0, body);
    // eyes: small bright slits on the sides of the head
    const ec = V(0.105 * sg, 0.6, 2.33);
    tube(b, [ec.clone().add(V(0, -0.006, 0.05)), ec, ec.clone().add(V(0.004 * sg, 0.012, -0.055))], 0.022, 0.012, 4, 5, 3, body);
  }

  /* wings */
  const S = V(0.22, 0.2, 0.35), E = V(1.15, 0.38, 0.05), W = V(1.85, 0.45, 0.6);
  const D = [V(3.25, 0.42, -0.35), V(2.78, 0.33, -1.15), V(1.98, 0.25, -1.52), V(1.12, 0.17, -1.36)];
  const H = V(0.22, 0.04, -0.98);
  for (const sg of [1, -1]) {
    const m = (p: THREE.Vector3) => V(p.x * sg, p.y, p.z);
    const wingOf = (p: THREE.Vector3) => sg * clamp((Math.abs(p.x) - 0.2) / 3.05);
    const billow = (p: THREE.Vector3, a: number) => p.add(V(0, 0.09 * a, 0));
    // finger panels fanning from the wrist, scalloped trailing edges
    const R = q < 1 ? 4 : 6, C = q < 1 ? 3 : 5;
    for (let f = 0; f < 3; f++) {
      const grid: THREE.Vector3[][] = [];
      for (let r = 0; r <= R; r++) {
        const s = r / R;
        const row: THREE.Vector3[] = [];
        for (let c = 0; c <= C; c++) {
          const u = c / C;
          const dir = D[f].clone().sub(W).lerp(D[f + 1].clone().sub(W), u);
          const p = W.clone().addScaledVector(dir, s);
          p.lerp(W, 0.24 * Math.sin(Math.PI * u) * Math.pow(s, 4));
          row.push(m(billow(p, Math.sin(Math.PI * u) * Math.sin(Math.PI * s * 0.9))));
        }
        grid.push(row);
      }
      sheet(b, grid, 1, wingOf);
    }
    // inner panel: arm leading edge (shoulder, elbow, wrist) down to the hip and the last finger
    const arm = new THREE.CatmullRomCurve3([S, E, W], false, 'centripetal');
    const RR = q < 1 ? 6 : 9, CC = q < 1 ? 3 : 4;
    const grid: THREE.Vector3[][] = [];
    for (let r = 0; r <= RR; r++) {
      const u = r / RR;
      const top = arm.getPointAt(u);
      const bot = H.clone().lerp(D[3], u);
      bot.lerp(top, 0.2 * Math.sin(Math.PI * u));
      const row: THREE.Vector3[] = [];
      for (let c = 0; c <= CC; c++) {
        const v = c / CC;
        row.push(m(billow(top.clone().lerp(bot, v), Math.sin(Math.PI * v) * Math.sin(Math.PI * u))));
      }
      grid.push(row);
    }
    sheet(b, grid, 1, wingOf);
    // wing bones: arm and four fingers, with the seam light running along their leading edges
    const segN = q < 1 ? 3 : 4;
    tube(b, [m(S), m(E), m(W)], 0.07, 0.045, 10, segN, 0, wingOf);
    for (let f = 0; f < 4; f++) tube(b, [m(W), m(W.clone().lerp(D[f], 0.5).add(V(0, 0.03, 0))), m(D[f])], 0.04, 0.008, 8, segN, 0, wingOf);
    const seamUp = V(0, 0.028, 0.012);
    tube(b, [m(S.clone().add(seamUp)), m(E.clone().add(seamUp)), m(W.clone().add(seamUp))], 0.011, 0.011, 12, 3, 2, wingOf);
    tube(b, [m(W.clone().add(seamUp)), m(W.clone().lerp(D[0], 0.5).add(V(0, 0.05, 0))), m(D[0].clone().add(V(0, 0.01, 0)))], 0.01, 0.003, 10, 3, 2, wingOf);
    tube(b, [m(W.clone().add(seamUp)), m(W.clone().lerp(D[1], 0.5).add(V(0, 0.05, 0))), m(D[1].clone().add(V(0, 0.01, 0)))], 0.008, 0.002, 8, 3, 2, wingOf);
    // the thumb claw at the wrist
    tube(b, [m(W), m(W.clone().add(V(0.05, 0.02, 0.2)))], 0.035, 0.004, 1, 4, 0, wingOf);
  }
  // spine seam: neck to mid-tail, broken by the shader
  const seamSpine = spine.filter((_, i) => {
    const s = i / (spine.length - 1);
    return s > 0.2 && s < 0.86;
  }).map((p, i, arr) => {
    const s = 0.2 + (0.66 * i) / Math.max(1, arr.length - 1);
    return p.clone().add(V(0, rAt(s) * 1.05 + 0.01, 0));
  });
  tube(b, seamSpine, 0.012, 0.012, seamSpine.length, 3, 2, body);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('aType', new THREE.Float32BufferAttribute(b.type, 1));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(b.wing, 1));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

const vert = /* glsl */ `
attribute float aType;
attribute float aWing;
uniform float uFlap;
uniform float uFlex;
uniform float uTime;
varying vec3 vN;
varying vec3 vPos;
varying float vType;
varying float vSpan;
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
void main() {
  vec3 p = position;
  vec3 n = normal;
  float w = abs(aWing);
  if (w > 0.0) {
    float sg = sign(aWing);
    // the whole wing hinges at the shoulder; the outer wing lags (flex), so a beat reads as a whip, not a hinge
    float a = uFlap + uFlex * w * w;
    vec2 q = rot(vec2(abs(p.x) - 0.22, p.y - 0.2), a);
    p.x = sg * (0.22 + q.x);
    p.y = 0.2 + q.y;
    vec2 nq = rot(vec2(n.x * sg, n.y), a);
    n.x = nq.x * sg;
    n.y = nq.y;
  }
  // tail and neck: a slow living sway
  float tail = smoothstep(-0.6, -3.7, p.z);
  p.x += sin(uTime * 2.1 - p.z * 1.3) * 0.07 * tail;
  p.y += sin(uTime * 1.6 - p.z * 1.1) * 0.035 * tail;
  float neck = smoothstep(0.9, 2.8, p.z);
  p.y += sin(uTime * 1.9) * 0.03 * neck;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * n);
  vPos = wp.xyz;
  vType = aType;
  vSpan = w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
uniform vec3 uGatePos;
uniform vec3 uKeyDir;
uniform float uLevel;
uniform float uTime;
uniform float uSeam;
varying vec3 vN;
varying vec3 vPos;
varying float vType;
varying float vSpan;
float h11(float x) { x = fract(x * 0.1031); x *= x + 33.33; x *= x + x; return fract(x); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h11(i), h11(i + 1.0), f); }
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vPos);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = max(dot(N, V), 0.0);
  vec3 toG = normalize(uGatePos - vPos);
  vec3 col;
  if (vType > 2.5) {
    // eyes: violet-blue with a white core, the brightest thing on him
    col = vec3(0.49, 0.42, 1.0) * 5.0 + vec3(0.9, 0.88, 1.0) * 3.0 * smoothstep(0.3, 0.9, ndv);
  } else if (vType > 1.5) {
    // seams: thin violet-blue light, broken along its length like the soldiers' lacquer cracks
    float k = n1(vPos.x * 3.1 + vPos.z * 2.7 + vPos.y * 1.3);
    float on = smoothstep(0.3, 0.42, k);
    vec3 c = mix(vec3(0.3, 0.55, 1.6), vec3(0.62, 0.36, 1.7), smoothstep(0.2, 0.9, n1(vPos.z * 0.9 + 4.0)));
    col = vec3(0.004, 0.005, 0.012) + c * on * uSeam * (0.55 + 0.45 * ndv);
  } else {
    // shadow body: near black, a cold rim where it faces the gate, the gate light glowing through the membrane
    float fres = 1.0 - ndv;
    float facingG = dot(N, toG);
    float rim = smoothstep(0.55, 0.75, fres) * smoothstep(-0.1, 0.45, facingG);
    col = vec3(0.006, 0.007, 0.014) * (0.6 + 0.4 * max(dot(N, uKeyDir), 0.0));
    col += vec3(0.35, 0.62, 1.0) * rim * 0.4;
    if (vType > 0.5) {
      // backlit membrane: the more the gate sits behind it (along the view ray), the more violet light comes through
      float back = pow(max(dot(-V, toG), 0.0), 6.0);
      col += vec3(0.16, 0.08, 0.42) * (0.07 + 0.93 * back) * (0.45 + 0.55 * vSpan);
    }
  }
  // a little of the dungeon haze, so he sits in the same air as the army
  col = mix(col, vec3(0.006, 0.012, 0.03), 0.22);
  gl_FragColor = vec4(col * uLevel, 1.0);
}
`;

/** Glide length (seconds) and where it starts (seconds after the AWAKEN hit): after the army stands, across the gate. */
export const VESPER = { at: 8.42, dur: 2.65 };

export function buildVesper() {
  const q = params.reduced ? 0.6 : 1;
  const geo = buildGeometry(q);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.DoubleSide,
    uniforms: {
      uFlap: { value: 0 },
      uFlex: { value: 0 },
      uTime: { value: 0 },
      uLevel: { value: 1 },
      uSeam: { value: 1 },
      uGatePos: ATMOS.uGatePos,
      uKeyDir: light.uKeyDir,
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'vesper';
  mesh.frustumCulled = false;
  mesh.visible = false;
  const yAxis = new THREE.Vector3(0, 1, 0);
  const qA = new THREE.Quaternion(), qC = new THREE.Quaternion(), xAxis = new THREE.Vector3(1, 0, 0);

  /**
   * p: 0..1 over VESPER.dur. aspect: viewport width / height (the path is staged for the AWAKEN kneel wide:
   * high in frame, above the centred result window, crossing the gate beam right to left).
   */
  const set = (p: number, aspect: number, t: number) => {
    const on = p > 0 && p < 1;
    mesh.visible = on;
    if (!on) return;
    const k = smoothstep(0.62, 1.25, aspect);
    const u = p;
    const half = lerp(6.6, 11.6, k);
    const x = lerp(half, -half, u);
    // a shallow glide arc: it sinks a little as it crosses the light and lifts away on the last beat
    const y = lerp(9.45, 6.1, k) + 0.55 * (1 - u) - 0.32 * Math.sin(Math.PI * u) + 0.3 * smoothstep(0.7, 1, u);
    const z = lerp(-5.6, -5.2, k) + 1.1 * u;
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(lerp(0.74, 1.0, k));
    // heading: flying left (-x), turned a little toward the camera; banks into the slight turn, nose up in the glide
    qA.setFromAxisAngle(yAxis, -Math.PI / 2 + 0.32 - 0.12 * u);
    qC.setFromAxisAngle(xAxis, -0.06 + 0.05 * Math.sin(Math.PI * u));
    mesh.quaternion.copy(qA).multiply(qC);
    // bank: roll about the body's own forward axis
    mesh.rotateZ(-0.16 + 0.1 * u);
    // wings: one strong downstroke as he enters, a long glide with wings spread across the light, one soft beat out
    let flap: number, flex: number;
    if (params.reduced) {
      flap = 0.08;
      flex = 0.0;
    } else {
      const beat = (x0: number, len: number, amp: number) => {
        const b = clamp((u - x0) / len);
        return b > 0 && b < 1 ? Math.sin(b * Math.PI * 2 + Math.PI / 2) * amp * Math.sin(Math.PI * b) : 0;
      };
      flap = 0.06 + beat(0.0, 0.2, 0.55) + beat(0.8, 0.2, 0.4) + 0.025 * Math.sin(t * 2.3);
      flex = -0.6 * (beat(0.02, 0.2, 0.5) + beat(0.82, 0.2, 0.35)) + 0.05;
    }
    mat.uniforms.uFlap.value = flap;
    mat.uniforms.uFlex.value = flex;
    mat.uniforms.uTime.value = t;
    // fades in/out at the frame edges only (it is off screen there anyway); the seams breathe once as it crosses
    mat.uniforms.uLevel.value = smoothstep(0, 0.04, u) * (1 - smoothstep(0.96, 1, u));
    mat.uniforms.uSeam.value = 0.85 + 0.35 * Math.exp(-Math.pow((u - 0.5) / 0.18, 2));
  };

  return { mesh, set, dispose: () => (geo.dispose(), mat.dispose()) };
}
export type Vesper = ReturnType<typeof buildVesper>;
