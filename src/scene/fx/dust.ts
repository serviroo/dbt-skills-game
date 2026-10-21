import * as THREE from 'three';
import { createParticles, type ParticleSystem } from './particles';

export interface DustOpts {
  center?: THREE.Vector3;
  /** Half extents of the region the motes wrap around in. */
  box?: THREE.Vector3;
  count?: number;
  size?: [number, number];
  /** Ambient mote colour (dim) and its gain. */
  color?: THREE.ColorRepresentation;
  base?: number;
  /** Constant drift in units/s (wraps inside the box). */
  drift?: THREE.Vector3;
  seed?: number;
  renderOrder?: number;
}

export interface Dust extends ParticleSystem {
  group: THREE.Object3D;
  /** A point light the motes catch (the gate). Intensity 0 turns it off. */
  setLight(pos: THREE.Vector3, color: THREE.Color, intensity: number, falloff?: number): void;
}

/** Slow floating dust motes in a box, lit by one point light. Pure function of time, wraps seamlessly. */
export function createDust(o: DustOpts = {}): Dust {
  const sys = createParticles({
    count: o.count ?? 220,
    seed: o.seed ?? 23,
    blend: 'add',
    renderOrder: o.renderOrder ?? 8,
    minPx: 1.1,
    uniforms: {
      uCenter: { value: (o.center ?? new THREE.Vector3()).clone() },
      uBox: { value: (o.box ?? new THREE.Vector3(3, 1.5, 3)).clone() },
      uDrift: { value: (o.drift ?? new THREE.Vector3(0.02, 0.035, 0.05)).clone() },
      uSize: { value: new THREE.Vector2(...(o.size ?? [0.004, 0.011])) },
      uColor: { value: new THREE.Color(o.color ?? 0x6f86b8) },
      uBase: { value: o.base ?? 0.25 },
      uLightPos: { value: new THREE.Vector3() },
      uLightColor: { value: new THREE.Color(0x4fb8ff) },
      uLightI: { value: 0 },
      uLightFall: { value: 0.6 },
    },
    vertexHead: /* glsl */ `
      uniform vec3 uCenter, uBox, uDrift, uColor, uLightPos, uLightColor;
      uniform vec2 uSize;
      uniform float uBase, uLightI, uLightFall;`,
    vertexBody: /* glsl */ `
      vec3 p = (s.xyz - 0.5) * 2.0 * uBox;
      p += (uDrift + (s2.xyz - 0.5) * vec3(0.05, 0.03, 0.05)) * uTime;
      p += vec3(sin(uTime * 0.31 + s.w * 40.0), sin(uTime * 0.23 + s2.w * 30.0), cos(uTime * 0.27 + s.x * 50.0)) * 0.06;
      p = mod(p + uBox, uBox * 2.0) - uBox;
      vec3 e = 1.0 - smoothstep(0.75, 1.0, abs(p) / uBox);
      P = uCenter + p;
      vec4 wp = modelMatrix * vec4(P, 1.0);
      float dl = distance(wp.xyz, uLightPos);
      float lit = uLightI / (1.0 + dl * dl * uLightFall);
      C = uColor * uBase + uLightColor * lit;
      A = e.x * e.y * e.z * (0.55 + 0.45 * sin(uTime * (0.4 + s2.y) + s.w * 30.0));
      A *= clamp((uIntensity - s2.w * 0.85) / 0.15, 0.0, 1.0);
      S = mix(uSize.x, uSize.y, s2.x * s2.x);
    `,
    fragmentBody: /* glsl */ `
      float d2 = dot(vUv, vUv);
      float v = exp(-d2 * 4.0);
      gl_FragColor = vec4(vColor * v * vAlpha, 0.0);`,
  });
  return {
    ...sys,
    group: sys.mesh,
    setLight(pos, color, intensity, falloff = 0.6) {
      sys.uniforms.uLightPos.value.copy(pos);
      sys.uniforms.uLightColor.value.copy(color);
      sys.uniforms.uLightI.value = intensity;
      sys.uniforms.uLightFall.value = falloff;
    },
  };
}
