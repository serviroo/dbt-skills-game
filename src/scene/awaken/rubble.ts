import * as THREE from 'three';
import { clamp, smoothstep, ease, mulberry32 } from '../../core/math';
import { params } from '../../core/params';
import { light } from '../toon';
import { ATMOS } from './materials';

/**
 * The lift: loose rubble around the risen soldiers lifts as his hand rises, hangs turning in the air, then
 * comes down together in one controlled slam on the stand (the stand swell carries it; no crack). One instanced draw.
 * Times are seconds after the AWAKEN hit.
 */
export const RUBBLE = { lift: 5.25, slam: 7.2, fall: 0.17, off: 8.26 };

const vert = /* glsl */ `
uniform float uAura;
varying vec3 vN;
varying vec3 vSN;
varying vec3 vPos;
varying float vH;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vN = normalize(mat3(m) * normal);
  vSN = mat3(m) * position;
  vPos = wp.xyz;
  vH = instanceMatrix[3].y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
uniform vec3 uKeyDir;
uniform vec3 uGatePos;
uniform vec3 uGroundGlow;
uniform float uGroundGlowStrength;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uAura;
uniform float uPulse;
varying vec3 vN;
varying vec3 vSN;
varying vec3 vPos;
varying float vH;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vPos);
  // a smooth (rounded) normal for the lift's edge light, so it hugs the outline instead of lighting whole facets
  float ndv = max(dot(normalize(vSN), V), 0.0);
  // dark stone, flat-shaded facets in two tones
  float lit = smoothstep(0.05, 0.2, dot(N, uKeyDir));
  vec3 col = mix(vec3(0.004, 0.005, 0.009), vec3(0.012, 0.015, 0.024), lit);
  col += uGroundGlow * uGroundGlowStrength * 0.25 * (1.0 - smoothstep(-0.6, 0.4, N.y));
  // the lift's hold: only the facets turned edge-on carry a thin violet-blue light while the stone is held in
  // the air (flat facets would light whole faces otherwise), one soft pulse as it lands
  // only on the side turned to the gate, so each stone reads as a dark chunk with one thin cold edge, not a lit gem
  float edge = smoothstep(0.6, 0.9, 1.0 - ndv) * smoothstep(0.0, 0.6, dot(normalize(vSN), normalize(uGatePos - vPos)));
  float held = uAura * smoothstep(0.03, 0.25, vH);
  col += mix(vec3(0.2, 0.36, 1.0), vec3(0.46, 0.24, 1.05), 0.5 + 0.5 * N.y) * edge * (held * 0.3 + uPulse * 0.3);
  col += vec3(0.03, 0.02, 0.08) * held * 0.2;
  float dist = length(cameraPosition - vPos);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Rock {
  x: number;
  z: number;
  s: number;
  h: number;
  delay: number;
  rx: number;
  ry: number;
  rz: number;
  spin: THREE.Vector3;
  sq: THREE.Vector3;
}

export function buildRubble(avoid: { x: number; z: number; r: number }[]) {
  const rnd = mulberry32(77);
  const want = params.reduced ? 18 : 30;
  const rocks: Rock[] = [];
  let guard = 0;
  while (rocks.length < want && guard++ < 2000) {
    const x = (rnd() * 2 - 1) * 3.9;
    const z = -2.5 + rnd() * 5.1;
    if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r)) continue;
    if (rocks.some((r) => Math.hypot(r.x - x, r.z - z) < 0.42)) continue;
    const big = rnd() < 0.25;
    rocks.push({
      x,
      z,
      s: big ? 0.1 + rnd() * 0.05 : 0.045 + rnd() * 0.05,
      h: 0.35 + rnd() * 1.25,
      delay: rnd() * 0.55,
      rx: rnd() * 6.28,
      ry: rnd() * 6.28,
      rz: rnd() * 6.28,
      spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.9),
      sq: new THREE.Vector3(1 + rnd() * 0.5, 0.55 + rnd() * 0.35, 0.8 + rnd() * 0.5),
    });
  }
  // a chunky low-poly stone: an icosahedron pushed about, flat shaded
  const base = new THREE.IcosahedronGeometry(1, 0);
  const p = base.attributes.position as THREE.BufferAttribute;
  const r2 = mulberry32(5);
  const moved = new Map<string, THREE.Vector3>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!moved.has(key)) moved.set(key, new THREE.Vector3(p.getX(i) * (0.7 + r2() * 0.6), p.getY(i) * (0.6 + r2() * 0.5), p.getZ(i) * (0.7 + r2() * 0.6)));
    const v = moved.get(key)!;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  base.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uAura: { value: 0 },
      uPulse: { value: 0 },
      uKeyDir: light.uKeyDir,
      uGatePos: ATMOS.uGatePos,
      uGroundGlow: light.uGroundGlow,
      uGroundGlowStrength: light.uGroundGlowStrength,
      uFogColor: light.uFogColor,
      uFogDensity: light.uFogDensity,
    },
  });
  const mesh = new THREE.InstancedMesh(base, mat, rocks.length);
  mesh.name = 'rubble';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();

  /**
   * tHit: seconds after the AWAKEN hit. Shown from the lift to the cut to the kneel wide (RUBBLE.off), where the settled
   * stones are lost in the floor fog anyway; outside that window the draw is skipped.
   */
  const set = (tHit: number) => {
    const on = tHit >= RUBBLE.lift && tHit < RUBBLE.off;
    mesh.visible = on;
    if (!on) return;
    const slam = RUBBLE.slam;
    let aura = 0;
    rocks.forEach((r, i) => {
      const lt = tHit - RUBBLE.lift - r.delay;
      const rise = ease.outCubic(clamp(lt / 1.1));
      const hover = r.h * rise + (rise > 0 ? 0.05 * Math.sin((tHit + r.delay * 9) * 1.7) * smoothstep(0.6, 1, rise) : 0);
      let y: number, spinK: number;
      if (tHit < slam) {
        y = hover;
        spinK = lt > 0 ? lt : 0;
      } else {
        // all together: accelerate down (ease-in), land, one small settle bounce
        const hs = r.h + 0.05 * Math.sin((slam + r.delay * 9) * 1.7);
        const f = clamp((tHit - slam) / RUBBLE.fall);
        const b = clamp((tHit - slam - RUBBLE.fall) / 0.22);
        y = hs * (1 - f * f) + (b > 0 && b < 1 ? Math.sin(Math.PI * b) * 0.035 * Math.min(1, r.h) : 0);
        spinK = slam - RUBBLE.lift - r.delay + Math.min(tHit - slam, RUBBLE.fall) * 0.5;
      }
      aura = Math.max(aura, rise);
      const s = r.s;
      e.set(r.rx + r.spin.x * spinK, r.ry + r.spin.y * spinK, r.rz + r.spin.z * spinK);
      q.setFromEuler(e);
      pos.set(r.x, Math.max(y, 0) + s * r.sq.y * 0.55, r.z);
      sc.copy(r.sq).multiplyScalar(s);
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    const land = tHit - slam - RUBBLE.fall;
    mat.uniforms.uAura.value = tHit < slam + RUBBLE.fall ? aura : 0;
    mat.uniforms.uPulse.value = land > 0 ? Math.exp(-land / 0.18) * (1 - Math.exp(-land / 0.03)) : 0;
  };

  return { mesh, set, rocks, dispose: () => (base.dispose(), mat.dispose()) };
}
export type Rubble = ReturnType<typeof buildRubble>;
