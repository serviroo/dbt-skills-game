import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noiseTexture } from '../fx/noise';
import { createDust, type Dust } from '../fx/dust';
import { buildSky, NIGHT, NIGHT_HORIZON } from '../environment';
import { light } from '../toon';
import type { Gate } from './gate';
import { PAVING_GLSL } from './paving';
import { buildRuins, ruinMaterial } from './ruins';

export { PAVING_GLSL };

/**
 * The night the gate opens in, the one world every intro beat shares: a ruined abbey nave paved with flagstones under
 * a night sky, its horizon and fog one deep blue. The floor picks up the gate (soft pool, broken wet-floor reflection
 * streak), lit haze hangs in depth round the beam, ground mist lies low, fallen stones sit at the gate's foot and dust
 * motes drift in its light. Everything reads the bound gate each frame; nothing here is lit by anything else.
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

export function buildDungeonEnv(opts: { gate?: Gate; ruins?: boolean; seed?: number } = {}): DungeonEnv {
  const group = new THREE.Group();
  group.name = 'dungeon';
  const noise = noiseTexture();
  const G = gateUniforms();
  // the night's horizon is the fog of every material in the intro (the hero and the army included), so the ground,
  // the ruins and the figures all melt into the same sky
  light.uFogColor.value.copy(NIGHT_HORIZON);
  const shared = {
    uNoise: { value: noise },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uFogColor: light.uFogColor,
    uFogDensity: light.uFogDensity,
    ...G,
  };

  // ---------------------------------------------------------------- floor
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uBase: { value: new THREE.Color(0.0062, 0.007, 0.0125) },
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
      ${PAVING_GLSL}
      uniform float uTime, uFade, uGateI, uGateW, uGateH, uFogDensity, uReflect;
      uniform vec3 uGatePos, uGateCol, uBase, uFogColor;
      uniform vec2 uGateFwd;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz;
        Paving s = paving(p);
        float n1 = texture2D(uNoise, p * 0.045).r;
        float n2 = texture2D(uNoise, p * 0.23 + 0.3).g;
        vec3 alb = uBase * (0.62 + 0.55 * s.id * s.detail + 0.3 * (n2 - 0.5)) * (0.75 + 0.5 * n1);
        alb *= (1.0 - 0.6 * s.joint) * (1.0 - 0.5 * s.crack);

        vec2 d = p - uGatePos.xz;
        float fwd = dot(d, uGateFwd);
        float lat = dot(d, vec2(uGateFwd.y, -uGateFwd.x));
        float W = max(uGateW, 0.08);
        float poolR = length(vec2(lat / (0.9 + W * 0.9), fwd / (fwd > 0.0 ? 2.6 : 0.9)));
        float pool = exp(-poolR * 1.5);
        float rw = W * 0.5 + max(fwd, 0.0) * 0.07;
        float refl = exp(-pow(lat / rw, 2.0)) * exp(-max(fwd, 0.0) / 3.6) * smoothstep(-0.05, 0.25, fwd);
        float rough = texture2D(uNoise, vec2(lat * 1.4 + 0.17, fwd * 0.09 - 0.3)).g;
        float rough2 = texture2D(uNoise, vec2(lat * 3.1 + 0.5, fwd * 0.2)).r;
        refl *= 0.25 + 1.3 * pow(rough, 2.2) * (0.6 + 0.6 * rough2);
        // each slab has its own polish and tilt, so the streak breaks up slab by slab and dies in the joints
        refl *= mix(0.45, 1.3, s.id) * (1.0 - 0.85 * s.joint) * (1.0 - 0.7 * s.crack);
        float sheen = (0.6 + 0.8 * n2) * pool * (1.0 - 0.5 * s.joint);
        vec3 col = alb + uGateCol * uGateI * (sheen * 0.05 + refl * 0.22 * uReflect);

        // the same fog as the figures (toon.ts), into the night horizon
        float dist = length(cameraPosition - vW);
        float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
        col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
        col = mix(uFogColor * 0.72, col, uFade);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  // out to the hills on the horizon (ruins.ts), so the ground meets the sky in fog all the way round
  const floor = new THREE.Mesh(new THREE.CircleGeometry(170, 72), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = -4;
  group.add(floor);

  // ---------------------------------------------------------------- the abbey and the sky
  const ruins = opts.ruins !== false ? buildRuins(shared, opts.seed ?? 11) : null;
  if (ruins) group.add(ruins.mesh);
  const sky = buildSky();
  group.add(sky);

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

  // ---------------------------------------------------------------- fallen stones at the gate's foot
  // (gate-local, a clear lane in front of the opening for anyone walking out), the abbey's own stone
  const stone = ruinMaterial(shared, { courses: false });
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
      const m = new THREE.Mesh(geo);
      m.position.set(x, s * 0.35, z);
      m.rotation.set(rr() * 3, rr() * 3, rr() * 3);
      m.scale.set(1 + rr() * 0.6, 0.45 + rr() * 0.4, 1 + rr() * 0.5);
      rubble.add(m);
    }
  }
  bake(rubble, stone, true);
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
      NIGHT.uTime.value = t;
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
        // the sky gathers the gate's light low in the haze behind it
        NIGHT.uGatePos.value.copy(gp);
        NIGHT.uGateCol.value.copy(gate.light.color);
        NIGHT.uGateI.value = gate.light.intensity;
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
        NIGHT.uGateI.value = 0;
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
