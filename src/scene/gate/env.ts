import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noiseTexture } from '../fx/noise';
import { createDust, type Dust } from '../fx/dust';
import type { Gate } from './gate';

/**
 * The dungeon the gate stands in: a dark polished stone floor that picks up the gate (soft pool, broken wet-floor
 * reflection streak), layered depth haze lit by the gate, low ground mist, far broken pillars catching a faint rim,
 * and parallax dust motes. Everything reads the bound gate each frame; nothing here is lit by anything else.
 */
export interface DungeonEnv {
  group: THREE.Group;
  /** Read the gate's position, width and light every update. */
  bindGate(g: Gate | null): void;
  update(t: number): void;
  /** Plate visibility 0..1 (beat 1 fades the plate in over 200 ms at 1.70 s). */
  setFade(v: number): void;
  dust: Dust;
  floorMat: THREE.ShaderMaterial;
}

const NOISE_FN = /* glsl */ `
uniform sampler2D uNoise;
float nz(vec2 p) { return texture2D(uNoise, p).r; }
`;

const gateUniforms = () => ({
  uGatePos: { value: new THREE.Vector3(0, 0, -6) },
  uGateFwd: { value: new THREE.Vector2(0, 1) },
  uGateCol: { value: new THREE.Color(0x4fb8ff) },
  uGateI: { value: 0 },
  uGateW: { value: 1 },
  uGateH: { value: 4.8 },
});

export function buildDungeonEnv(opts: { gate?: Gate; pillars?: boolean; seed?: number } = {}): DungeonEnv {
  const group = new THREE.Group();
  group.name = 'dungeon';
  const noise = noiseTexture();
  const G = gateUniforms();
  const shared = {
    uNoise: { value: noise },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uVoid: { value: new THREE.Color(0x07080f) },
    ...G,
  };

  // ---------------------------------------------------------------- floor
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uBase: { value: new THREE.Color(0.0055, 0.0062, 0.011) },
      uFogD: { value: 0.075 },
      uReflect: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_FN}
      uniform float uTime, uFade, uGateI, uGateW, uGateH, uFogD, uReflect;
      uniform vec3 uGatePos, uGateCol, uBase, uVoid;
      uniform vec2 uGateFwd;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz;
        float n1 = texture2D(uNoise, p * 0.045).r;
        float n2 = texture2D(uNoise, p * 0.23 + 0.3).g;
        float cr = texture2D(uNoise, p * 0.055 + 0.7).b;
        float cr2 = texture2D(uNoise, p * 0.13 + 0.2).b;
        float crack = smoothstep(0.86, 0.94, cr) + 0.5 * smoothstep(0.9, 0.96, cr2);
        // big flagstone seams (cellular)
        float cell = texture2D(uNoise, p * 0.035 + 0.11).a;
        float seam = smoothstep(0.5, 0.62, cell) * 0.0;
        vec3 alb = uBase * (0.7 + 0.55 * n1 + 0.3 * (n2 - 0.5));
        alb *= 1.0 - 0.55 * clamp(crack + seam, 0.0, 1.0);

        vec2 d = p - uGatePos.xz;
        float fwd = dot(d, uGateFwd);
        float lat = dot(d, vec2(uGateFwd.y, -uGateFwd.x));
        float W = max(uGateW, 0.08);
        float hs = 1.0;
        float poolR = length(vec2(lat / (0.9 + W * 0.9), fwd / (fwd > 0.0 ? 2.6 : 0.9)) / hs);
        float pool = exp(-poolR * 1.5);
        float rw = W * 0.5 + max(fwd, 0.0) * 0.07;
        float refl = exp(-pow(lat / rw, 2.0)) * exp(-max(fwd, 0.0) / (3.6 * hs)) * smoothstep(-0.05, 0.25, fwd);
        float rough = texture2D(uNoise, vec2(lat * 1.4 + 0.17, fwd * 0.09 - 0.3)).g;
        float rough2 = texture2D(uNoise, vec2(lat * 3.1 + 0.5, fwd * 0.2)).r;
        refl *= 0.25 + 1.3 * pow(rough, 2.2) * (0.6 + 0.6 * rough2);
        refl *= 1.0 - 0.7 * crack;
        float sheen = (0.6 + 0.8 * n2) * pool;
        vec3 col = alb + uGateCol * uGateI * (sheen * 0.05 + refl * 0.22 * uReflect);

        float dist = length(cameraPosition - vW);
        float fog = 1.0 - exp(-dist * uFogD);
        col = mix(col, uVoid, fog);
        col = mix(uVoid, col, uFade);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90, 1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = -4;
  group.add(floor);

  // ---------------------------------------------------------------- lit haze layers (vertical planes)
  const hazeMat = (depth: number, strength: number, scale: number, seed: number) =>
    new THREE.ShaderMaterial({
      uniforms: { ...shared, uStrength: { value: strength }, uScale: { value: scale }, uSeed: { value: seed }, uDepth: { value: depth } },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE_FN}
        uniform float uTime, uFade, uGateI, uGateW, uGateH, uStrength, uScale, uSeed;
        uniform vec3 uGatePos, uGateCol;
        varying vec3 vW; varying vec2 vUv;
        void main() {
          vec2 q = vW.xy * uScale + vec2(uTime * 0.01 + uSeed, uSeed * 0.7);
          float n = texture2D(uNoise, q).r;
          float n2 = texture2D(uNoise, q * 2.4 + vec2(-uTime * 0.013, 0.31)).g;
          float shafts = texture2D(uNoise, vec2(vW.x * 0.09 + uSeed, vW.y * 0.008)).g;
          float haze = smoothstep(0.25, 0.9, n * 0.7 + n2 * 0.45) * (0.6 + 0.8 * shafts);
          // lit only near the beam: the room stays void away from the gate (portrait frames are narrow)
          vec2 rel = vW.xy - (uGatePos.xy + vec2(0.0, 2.0));
          // (capped: the wide hero slit of beat 1 would otherwise light a broad veil across the whole frame)
          vec2 dl = vec2(rel.x / (min(uGateW, 1.0) * 1.1 + 0.55), rel.y / 3.4);
          float lit = exp(-dot(dl, dl)) + 0.12 * exp(-dot(dl, dl) * 0.05);
          float low = smoothstep(0.0, 1.4, vW.y) * (1.0 - 0.5 * smoothstep(0.0, uGateH * 1.1, vW.y));
          float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
          vec3 col = uGateCol * haze * lit * uGateI * uStrength * low * edge * uFade;
          gl_FragColor = vec4(col, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  const hazes: THREE.Mesh[] = [];
  const addHaze = (dz: number, w: number, h: number, strength: number, scale: number, seed: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 1), hazeMat(dz, strength, scale, seed));
    m.userData.dz = dz;
    m.userData.h = h;
    m.renderOrder = 2;
    m.frustumCulled = false;
    hazes.push(m);
    group.add(m);
  };
  addHaze(-3.5, 34, 14, 0.045, 0.11, 0.0);
  addHaze(1.6, 22, 9, 0.022, 0.16, 0.37);

  // ---------------------------------------------------------------- ground mist (horizontal sheet, lit near the gate)
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uStrength: { value: 0.05 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_FN}
      uniform float uTime, uFade, uGateI, uGateW, uGateH, uStrength;
      uniform vec3 uGatePos, uGateCol;
      uniform vec2 uGateFwd;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz;
        float n = texture2D(uNoise, p * 0.09 + vec2(uTime * 0.012, -uTime * 0.006)).r;
        float n2 = texture2D(uNoise, p * 0.22 + vec2(-uTime * 0.02, 0.4)).g;
        float m = smoothstep(0.35, 0.95, n * 0.75 + n2 * 0.4);
        vec2 d = p - uGatePos.xz;
        float lit = exp(-length(d / vec2(1.6 + uGateW, 3.4)) * 1.2);
        float far = 1.0 - smoothstep(10.0, 20.0, length(cameraPosition.xz - p));
        vec3 col = uGateCol * m * lit * uGateI * uStrength * far * uFade;
        col += vec3(0.0012, 0.0014, 0.003) * m * far * uFade;
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mists: THREE.Mesh[] = [];
  for (const [y, s] of [[0.12, 1.0], [0.42, 0.55]] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 1, 1), mistMat.clone());
    (m.material as THREE.ShaderMaterial).uniforms = { ...shared, uStrength: { value: 0.05 * s } };
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.renderOrder = 1;
    m.frustumCulled = false;
    mists.push(m);
    group.add(m);
  }

  // ---------------------------------------------------------------- far broken pillars (silhouettes with gate rim)
  const pillarMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uFogD: { value: 0.06 } },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_FN}
      uniform float uFade, uGateI, uGateH, uFogD;
      uniform vec3 uGatePos, uGateCol, uVoid;
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec3 L = normalize(uGatePos + vec3(0.0, uGateH * 0.45, 0.0) - vW);
        vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(vN, L);
        float dist = length(uGatePos.xz - vW.xz);
        float fall = 1.0 / (1.0 + dist * dist * 0.012);
        float lit = smoothstep(0.1, 0.35, ndl) * fall;
        float rim = smoothstep(0.3, 0.95, 1.0 - max(dot(vN, V), 0.0)) * smoothstep(-0.2, 0.4, ndl) * fall;
        float n = texture2D(uNoise, vW.xy * 0.4 + vW.z * 0.2).r;
        vec3 col = vec3(0.004, 0.0045, 0.008) * (0.7 + 0.6 * n);
        col += uGateCol * uGateI * (lit * 0.03 + rim * 0.34) * (0.6 + 0.6 * n);
        float d = length(cameraPosition - vW);
        col = mix(col, uVoid, 1.0 - exp(-d * uFogD));
        col = mix(uVoid, col, uFade);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const pillars = new THREE.Group();
  if (opts.pillars !== false) {
    const rnd = (() => { let a = (opts.seed ?? 3) * 9301 + 49297; return () => ((a = (a * 9301 + 49297) % 233280) / 233280); })();
    const spots: [number, number, number, number][] = [
      [-7.5, -9.0, 7.5, 0.55], [7.8, -8.5, 6.2, 0.6], [-11.5, -4.0, 9.5, 0.7], [11.0, -3.0, 4.2, 0.65],
      [-5.2, -14.0, 11.0, 0.6], [5.8, -15.0, 8.0, 0.55], [-14.5, 1.5, 5.0, 0.8], [14.0, 3.0, 8.5, 0.75],
      // behind him in the portrait mid shot: a broken column whose gate-side edge catches the light
      [5.0, -10.5, 9.5, 0.6],
    ];
    for (const [x, z, h, r] of spots) {
      const geo = new THREE.CylinderGeometry(r * 0.92, r, h, 9, 6, false);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const top = y > h / 2 - 0.01;
        let yy = y;
        if (top) yy -= rnd() * h * 0.22;
        const k = 1 + (rnd() - 0.5) * 0.12;
        pos.setXYZ(i, pos.getX(i) * k, yy, pos.getZ(i) * k);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, pillarMat);
      m.position.set(x, h / 2 - 0.05, z);
      m.rotation.y = rnd() * Math.PI;
      m.rotation.z = (rnd() - 0.5) * 0.06;
      pillars.add(m);
      if (rnd() < 0.7) {
        const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(r * (0.5 + rnd() * 0.5), 0), pillarMat);
        chunk.position.set(x + (rnd() - 0.5) * 2.2, r * 0.3, z + 1 + rnd() * 1.4);
        chunk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        chunk.scale.y = 0.6;
        pillars.add(chunk);
      }
    }
  }
  bake(pillars, pillarMat);
  group.add(pillars);

  // rubble around the gate's foot (gate-local, a clear lane in front of the opening for anyone walking out)
  const rubble = new THREE.Group();
  {
    let a = (opts.seed ?? 3) * 7919 + 17;
    const rr = () => ((a = (a * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 16; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (0.95 + rr() * 2.2);
      const z = -0.6 + rr() * 2.6;
      const s = 0.05 + Math.pow(rr(), 2.2) * 0.32;
      const geo = rr() < 0.5 ? new THREE.DodecahedronGeometry(s, 0) : new THREE.IcosahedronGeometry(s, 0);
      const m = new THREE.Mesh(geo, pillarMat);
      m.position.set(x, s * 0.35, z);
      m.rotation.set(rr() * 3, rr() * 3, rr() * 3);
      m.scale.set(1 + rr() * 0.6, 0.45 + rr() * 0.4, 1 + rr() * 0.5);
      rubble.add(m);
    }
  }
  bake(rubble, pillarMat, true);
  group.add(rubble);

  // ---------------------------------------------------------------- parallax dust
  const dust = createDust({ center: new THREE.Vector3(0, 1.7, -2), box: new THREE.Vector3(5, 1.9, 5), count: 240, size: [0.004, 0.012], base: 0.12, seed: 31 });
  group.add(dust.mesh);

  let gate: Gate | null = opts.gate ?? null;
  const gp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const q = new THREE.Quaternion();

  return {
    group,
    dust,
    floorMat,
    bindGate(g) { gate = g; },
    setFade(v) { shared.uFade.value = v; dust.setIntensity(v); },
    update(t) {
      shared.uTime.value = t;
      if (gate) {
        gate.group.updateMatrixWorld();
        gate.group.getWorldPosition(gp);
        gate.group.getWorldQuaternion(q);
        fwd.set(0, 0, 1).applyQuaternion(q);
        G.uGatePos.value.copy(gp);
        G.uGateFwd.value.set(fwd.x, fwd.z).normalize();
        G.uGateCol.value.copy(gate.light.color);
        G.uGateI.value = gate.light.intensity;
        G.uGateW.value = gate.state.width * Math.max(gate.state.open, 0.05);
        G.uGateH.value = gate.state.height;
        for (const h of hazes) {
          h.position.set(gp.x, gp.y + h.userData.h * 0.32, gp.z + h.userData.dz);
          h.quaternion.copy(q);
        }
        rubble.position.copy(gp);
        rubble.quaternion.copy(q);
        for (const m of mists) {
          m.position.x = gp.x;
          m.position.z = gp.z + 4;
        }
        dust.setLight(gate.light.position, gate.light.color, gate.light.intensity * 0.9, 0.35);
      } else {
        G.uGateI.value = 0;
        dust.setLight(gp, G.uGateCol.value, 0);
      }
      dust.update(t);
    },
  };
}


/** Merge a group of static meshes sharing one material into a single draw call. */
function bake(g: THREE.Group, mat: THREE.Material, smooth = false) {
  const parts: THREE.BufferGeometry[] = [];
  for (const c of g.children as THREE.Mesh[]) {
    c.updateMatrix();
    const geo = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(c.matrix);
    geo.deleteAttribute('uv');
    if (smooth) {
      geo.deleteAttribute('normal');
      const sm = mergeVertices(geo, 1e-4);
      sm.computeVertexNormals();
      parts.push(sm.toNonIndexed());
      geo.dispose();
    } else parts.push(geo);
    c.geometry.dispose();
  }
  g.clear();
  if (parts.length) g.add(new THREE.Mesh(mergeGeometries(parts), mat));
}
