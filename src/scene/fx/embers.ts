import * as THREE from 'three';
import { params } from '../../core/params';
import { createParticles, type ParticleSystem } from './particles';

export interface EmberOpts {
  /** Emitter centre: a fixed point, or an object followed every update. */
  origin?: THREE.Vector3 | THREE.Object3D;
  /** Half extents of the spawn box around the origin. */
  box?: THREE.Vector3;
  velocity?: THREE.Vector3;
  spread?: THREE.Vector3;
  gravity?: THREE.Vector3;
  turbulence?: number;
  life?: [number, number];
  size?: [number, number];
  color?: THREE.ColorRepresentation;
  hot?: THREE.ColorRepresentation;
  gain?: number;
  count?: number;
  /** Motion smear in seconds of velocity. */
  stretch?: number;
  /** Fast per-spark twinkle (forced off under reduced motion). */
  flicker?: boolean;
  /** Dark flecks (normal blending) instead of glowing sparks. */
  dark?: boolean;
  /** Only particles born after this stage time are drawn (use -1e4 for an always-on, pre-warmed emitter). */
  start?: number;
  seed?: number;
  renderOrder?: number;
}

export interface Emitter extends ParticleSystem {
  group: THREE.Object3D;
  setStart(t: number): void;
}

/** Sparks and embers (or dark flecks), pure function of time. */
export function createEmbers(o: EmberOpts = {}): Emitter {
  const origin = o.origin ?? new THREE.Vector3();
  const sys = createParticles({
    count: o.count ?? 120,
    seed: o.seed ?? 11,
    blend: o.dark ? 'premult' : 'add',
    renderOrder: o.renderOrder ?? 12,
    minPx: 0.9,
    uniforms: {
      uOrigin: { value: new THREE.Vector3() },
      uBox: { value: (o.box ?? new THREE.Vector3(0.3, 0.1, 0.3)).clone() },
      uVel: { value: (o.velocity ?? new THREE.Vector3(0, 0.8, 0)).clone() },
      uSpread: { value: (o.spread ?? new THREE.Vector3(0.25, 0.3, 0.25)).clone() },
      uGravity: { value: (o.gravity ?? new THREE.Vector3()).clone() },
      uTurb: { value: o.turbulence ?? 0.35 },
      uLife: { value: new THREE.Vector2(...(o.life ?? [1.2, 2.6])) },
      uSize: { value: new THREE.Vector2(...(o.size ?? [0.006, 0.014])) },
      uColor: { value: new THREE.Color(o.color ?? 0x7b3fe4) },
      uHot: { value: new THREE.Color(o.hot ?? 0xe5a5f9) },
      uGain: { value: o.gain ?? 3.0 },
      uStretch: { value: o.stretch ?? 0.05 },
      uFlicker: { value: o.flicker === false || params.reduced ? 0 : 1 },
      uStart: { value: o.start ?? -1e4 },
      uClear: { value: 0 },
      uClearY: { value: new THREE.Vector2(0, 0) },
    },
    vertexHead: /* glsl */ `
      uniform vec3 uOrigin, uBox, uVel, uSpread, uGravity, uColor, uHot;
      uniform float uTurb, uStretch, uFlicker, uStart, uClear;
      uniform vec2 uClearY;
      uniform vec2 uLife, uSize;`,
    vertexBody: /* glsl */ `
      float life = mix(uLife.x, uLife.y, s.x);
      float tt = (uTime - uStart) / life + s.y;
      float age = fract(tt);
      float cyc = floor(tt);
      float birth = (cyc - s.y) * life + uStart;
      vec4 r = hash44(vec4(s.zw * 41.3, cyc, s2.x * 9.1));
      vec4 r2 = hash44(vec4(r.wzy * 13.0, cyc + 3.0));
      vec3 v = uVel + (r2.xyz * 2.0 - 1.0) * uSpread;
      float T = age * life;
      vec3 p = uOrigin + (r.xyz * 2.0 - 1.0) * uBox + v * T + 0.5 * uGravity * T * T;
      vec3 tn = texture2D(uNoise, vec2(s.z * 5.0 + T * 0.15, s.w * 5.0 + uTime * 0.02)).rgb - 0.5;
      p += tn * uTurb * T;
      P = p;
      VEL = v + uGravity * T + tn * uTurb;
      STRETCH = uStretch;
      A = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.55, 1.0, age));
      A *= mix(1.0, 0.55 + 0.45 * sin(uTime * mix(11.0, 23.0, s2.y) + s2.z * 40.0), uFlicker);
      A *= clamp((uIntensity - s2.w * 0.85) / 0.15, 0.0, 1.0);
      if (birth < uStart) A = 0.0;
      if (uClear > 0.0) {
        vec3 tc = cameraPosition - uOrigin; tc.y = 0.0; tc = normalize(tc + vec3(1e-4));
        vec3 rp = p - uOrigin; rp.y = 0.0;
        float fr = dot(normalize(rp + vec3(1e-4)), tc);
        A *= 1.0 - uClear * smoothstep(-0.05, 0.4, fr) * smoothstep(uClearY.x, uClearY.x + 0.25, p.y) * (1.0 - smoothstep(uClearY.y, uClearY.y + 0.2, p.y));
      }
      S = mix(uSize.x, uSize.y, s2.z);
      C = mix(uColor, uHot, pow(1.0 - age, 2.0) * r.w);
    `,
    fragmentHead: 'uniform float uGain;',
    fragmentBody: o.dark
      ? /* glsl */ `
      float d = length(vUv);
      float a = (1.0 - smoothstep(0.45, 1.0, d)) * vAlpha;
      gl_FragColor = vec4(vColor * a, a);`
      : /* glsl */ `
      float d2 = dot(vUv, vUv);
      // falls to zero inside the quad, so a stretched spark never shows its card's edges
      float v = (exp(-d2 * 5.0) + 0.25 * exp(-d2 * 1.5)) * (1.0 - smoothstep(0.5, 1.0, d2));
      gl_FragColor = vec4(vColor * v * vAlpha * uGain, 0.0);`,
  });
  const wp = new THREE.Vector3();
  const base = sys.update;
  return {
    ...sys,
    group: sys.mesh,
    setStart(t: number) { sys.uniforms.uStart.value = t; },
    update(t: number) {
      if (origin instanceof THREE.Object3D) origin.getWorldPosition(wp);
      else wp.copy(origin);
      sys.uniforms.uOrigin.value.copy(wp);
      sys.uniforms.uFlicker.value = o.flicker === false || params.reduced ? 0 : 1;
      base(t);
    },
  };
}
