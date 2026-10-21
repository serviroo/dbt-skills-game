import * as THREE from 'three';
import { createParticles, type ParticleSystem } from './particles';
import { createEmbers, type Emitter } from './embers';
import { createInkRibbons, type InkRibbons } from './ribbons';

export interface AuraOpts {
  target: THREE.Object3D;
  /** Character height in world units (feet at the target origin). */
  height: number;
  /** Body radius the smoke wraps around. */
  radius: number;
  /** Total particle budget (split across layers). Default 520. */
  count?: number;
  seed?: number;
}

export interface Aura {
  group: THREE.Group;
  layers: { smoke: InkRibbons; glow: ParticleSystem; streaks: ParticleSystem; bokeh: ParticleSystem; sparks: Emitter; flecks: Emitter };
  setIntensity(v: number): void;
  update(t: number): void;
}

const VIOLET = new THREE.Color(0x7b3fe4);
const LILAC = new THREE.Color(0xb750ea);
const HOT = new THREE.Color(0xe5a5f9);

/**
 * Shadow aura: black-violet ink smoke breathing off the shoulders and coat (premultiplied: dark body, additive violet
 * edges in one pass), a violet glow behind the upper body, thin rising light streaks and soft bokeh (additive),
 * violet sparks and black flecks. Nothing is drawn between the camera and the face, chest or hands.
 */
export function createAura(o: AuraOpts): Aura {
  const n = o.count ?? 520;
  const group = new THREE.Group();
  group.name = 'aura';
  const shared = {
    uOrigin: { value: new THREE.Vector3() },
    uHeight: { value: o.height },
    uRadius: { value: o.radius },
  };
  const head = /* glsl */ `uniform vec3 uOrigin; uniform float uHeight; uniform float uRadius;
    // keep the face and chest readable: thin out anything between the camera and the upper body
    float clearFront(vec3 p) {
      vec3 tc = cameraPosition - uOrigin; tc.y = 0.0; tc = normalize(tc + vec3(1e-4));
      float fr = dot(normalize(vec3(p.x, 0.0, p.z) + vec3(1e-4)), tc);
      return 1.0 - smoothstep(-0.05, 0.4, fr) * smoothstep(0.15, 0.42, p.y / uHeight);
    }`;
  const seed = o.seed ?? 5;

  // Ink-smoke plumes breathing off the shoulders and the back and sides of the coat (never over the legs, face or
  // hands): dark bodies lit violet from their edges in.
  const smoke = createInkRibbons({ count: Math.max(8, Math.round(n * 0.07)), height: o.height, radius: o.radius, seed: seed + 1, renderOrder: 14 });

  // Soft violet aura glow behind the body: few large additive puffs (the hue of the aura, not its shape).
  const glow = createParticles({
    count: Math.round(n * 0.05),
    seed: seed + 6,
    blend: 'add',
    renderOrder: 12,
    minPx: 2.0,
    uniforms: { ...shared, uCol: { value: new THREE.Color(0.05, 0.01, 0.19) }, uHot: { value: new THREE.Color(0.2, 0.07, 0.4) } },
    vertexHead: head + 'uniform vec3 uCol, uHot;',
    vertexBody: /* glsl */ `
      float life = mix(2.5, 4.0, s.x);
      float tt = uTime / life + s.y;
      float age = fract(tt);
      float cyc = floor(tt);
      vec4 r = hash44(vec4(s.zw * 13.7, cyc, s2.x * 3.0));
      vec3 toCam = cameraPosition - uOrigin; toCam.y = 0.0; toCam = normalize(toCam + vec3(1e-4));
      float ang = atan(toCam.z, toCam.x) + 3.1416 * (0.55 + 0.9 * r.x);
      // behind the coat and shoulders, where the smoke breathes out (the hue of the aura behind the silhouette)
      vec3 p = vec3(cos(ang) * uRadius * 0.6, mix(0.14, 0.8, r.y) * uHeight + age * 0.25, sin(ang) * uRadius * 0.6);
      P = uOrigin + p;
      S = mix(0.15, 0.24, s2.x) * (uRadius / 0.45);
      ASPECT = 1.8;
      A = sin(3.1416 * age) * clamp((uIntensity - s2.w * 0.5) / 0.5, 0.0, 1.0);
      vec4 mvq = modelViewMatrix * vec4(P, 1.0);
      A *= mix(0.35, 1.0, smoothstep(1.2, 3.6, -mvq.z));
      C = mix(uCol, uHot, s2.y * 0.4);
    `,
    fragmentBody: /* glsl */ `
      float d2 = dot(vUv, vUv);
      float v = exp(-d2 * 3.0) * (1.0 - smoothstep(0.7, 1.0, d2));
      gl_FragColor = vec4(vColor * v * vAlpha * 0.6, 0.0);
    `,
  });

  const streaks = createParticles({
    count: Math.round(n * 0.06),
    seed: seed + 2,
    blend: 'add',
    renderOrder: 15,
    minPx: 0.8,
    uniforms: { ...shared, uEdge: { value: VIOLET.clone().lerp(LILAC, 0.5) }, uHot: { value: HOT.clone() }, uGain: { value: 1.3 } },
    vertexHead: head + 'uniform vec3 uEdge, uHot;',
    vertexBody: /* glsl */ `
      float life = mix(0.5, 1.15, s.x);
      float tt = uTime / life + s.y;
      float age = fract(tt);
      float cyc = floor(tt);
      vec4 r = hash44(vec4(s.zw * 57.3, cyc, s2.x * 17.0));
      float ang = r.x * 6.2832;
      float rad = uRadius * mix(0.7, 1.15, sqrt(r.z));
      float h0 = pow(r.y, 1.2) * uHeight * 0.8;
      float sp = mix(0.9, 2.2, r.w);
      vec3 p = vec3(cos(ang) * rad, h0 + sp * age * life, sin(ang) * rad);
      P = uOrigin + p;
      VEL = vec3(0.0, sp, 0.0);
      STRETCH = mix(0.03, 0.065, s2.y);
      S = mix(0.0018, 0.0035, s2.z) * (uRadius / 0.45);
      float f = sin(3.1416 * age);
      A = f * f * clamp((uIntensity - s2.w * 0.8) / 0.2, 0.0, 1.0) * clearFront(p);
      C = mix(uEdge, uHot, pow(s2.x, 4.0));
    `,
    fragmentHead: 'uniform float uGain;',
    fragmentBody: /* glsl */ `
      float x = vUv.x, y = vUv.y;
      float core = exp(-x * x * 5.0);
      float along = smoothstep(-1.0, 0.7, y) * smoothstep(1.0, 0.82, y);
      gl_FragColor = vec4(vColor * core * along * vAlpha * uGain, 0.0);
    `,
  });

  const bokeh = createParticles({
    count: Math.round(n * 0.05),
    seed: seed + 3,
    blend: 'add',
    renderOrder: 16,
    minPx: 1.5,
    uniforms: { ...shared, uEdge: { value: VIOLET.clone() }, uHot: { value: HOT.clone() }, uGain: { value: 1.1 } },
    vertexHead: head + 'uniform vec3 uEdge, uHot;',
    vertexBody: /* glsl */ `
      float life = mix(3.0, 6.0, s.x);
      float tt = uTime / life + s.y;
      float age = fract(tt);
      float cyc = floor(tt);
      vec4 r = hash44(vec4(s.zw * 23.1, cyc, s2.x * 5.0));
      float ang = r.x * 6.2832;
      float rad = uRadius * mix(0.8, 2.6, r.z);
      vec3 p = vec3(cos(ang) * rad, r.y * uHeight * 1.05, sin(ang) * rad);
      p.y += mix(0.08, 0.25, r.w) * age * life;
      p.x += sin(uTime * 0.6 + s.z * 30.0) * 0.05;
      P = uOrigin + p;
      S = mix(0.006, 0.016, s2.x) * (uRadius / 0.45);
      A = sin(3.1416 * age) * mix(0.1, 0.3, s2.y) * clamp((uIntensity - s2.w * 0.8) / 0.2, 0.0, 1.0) * clearFront(p);
      C = mix(uEdge, uHot, s2.z * 0.35);
    `,
    fragmentHead: 'uniform float uGain;',
    fragmentBody: /* glsl */ `
      float d2 = dot(vUv, vUv);
      float disc = exp(-d2 * 3.5) * (1.0 - smoothstep(0.75, 1.0, d2));
      gl_FragColor = vec4(vColor * disc * 0.7 * vAlpha * uGain, 0.0);
    `,
  });

  const sparks = createEmbers({
    origin: o.target,
    box: new THREE.Vector3(o.radius * 0.9, o.height * 0.35, o.radius * 0.9),
    velocity: new THREE.Vector3(0, 0.75, 0),
    spread: new THREE.Vector3(0.18, 0.35, 0.18),
    turbulence: 0.5,
    life: [0.9, 2.0],
    size: [0.0026, 0.0055],
    color: 0x7b3fe4,
    hot: 0xc9a8ff,
    gain: 3.4,
    count: Math.round(n * 0.14),
    stretch: 0.04,
    seed: seed + 4,
    renderOrder: 17,
  });
  sparks.uniforms.uBox.value.y = o.height * 0.35;

  const flecks = createEmbers({
    origin: o.target,
    box: new THREE.Vector3(o.radius * 1.1, o.height * 0.3, o.radius * 1.1),
    velocity: new THREE.Vector3(0, 0.55, 0),
    spread: new THREE.Vector3(0.15, 0.25, 0.15),
    turbulence: 0.6,
    life: [1.2, 2.4],
    size: [0.006, 0.013],
    color: 0x05040a,
    hot: 0x05040a,
    count: Math.round(n * 0.1),
    stretch: 0.0,
    dark: true,
    flicker: false,
    seed: seed + 5,
    renderOrder: 13,
  });

  // never in front of the face or chest
  sparks.uniforms.uClear.value = 1;
  flecks.uniforms.uClear.value = 1;
  for (const l of [glow, smoke, streaks, bokeh]) group.add(l.mesh);
  group.add(sparks.mesh, flecks.mesh);
  const wp = new THREE.Vector3();
  const spOff = new THREE.Vector3(0, o.height * 0.4, 0);
  // keep-clear anchors read from the target's rig when it has one (bones 'head', 'haR'/'fiR', 'haL'/'fiL')
  const bone = (n: string) => o.target.getObjectByName(n) ?? null;
  const rig = { head: bone('head'), haR: bone('haR'), fiR: bone('fiR'), haL: bone('haL'), fiL: bone('fiL') };
  const aHead = new THREE.Vector3(), aR = new THREE.Vector3(), aL = new THREE.Vector3(), tmp = new THREE.Vector3();
  const handAt = (wr: THREE.Object3D | null, kn: THREE.Object3D | null, out: THREE.Vector3) => {
    if (!wr) return undefined;
    wr.getWorldPosition(out);
    if (kn) out.lerp(kn.getWorldPosition(tmp), 0.6);
    return out;
  };

  // the dungeon gate (when one shares the scene): its light column is kept clear of smoke where it stands beside him
  let gate: THREE.Object3D | null | undefined;
  const gA = new THREE.Vector3(), gB = new THREE.Vector3();

  return {
    group,
    layers: { smoke, glow, streaks, bokeh, sparks, flecks },
    setIntensity(v: number) {
      for (const l of [smoke, glow, streaks, bokeh, sparks, flecks]) l.setIntensity(v);
    },
    update(t: number) {
      o.target.getWorldPosition(wp);
      shared.uOrigin.value.copy(wp);
      if (rig.head) {
        rig.head.updateWorldMatrix(true, false);
        smoke.setAnchors(rig.head.localToWorld(aHead.set(0, 0.09, 0.05)), handAt(rig.haR, rig.fiR, aR), handAt(rig.haL, rig.fiL, aL));
      }
      if (gate === undefined && group.parent) gate = group.parent.getObjectByName('gate') ?? null;
      const ghw = gate && gate.visible ? Number(gate.userData.slitHalfWidth) || 0 : 0;
      if (gate && ghw > 0) {
        gate.updateWorldMatrix(true, false);
        gA.set(0, 0, 0).applyMatrix4(gate.matrixWorld);
        gB.set(0, Number(gate.userData.slitTop) || 6, 0).applyMatrix4(gate.matrixWorld);
      }
      smoke.setGate?.(gA, gB, ghw);
      smoke.update(t, wp);
      glow.update(t);
      streaks.update(t);
      bokeh.update(t);
      sparks.update(t);
      flecks.update(t);
      sparks.uniforms.uOrigin.value.add(spOff);
      flecks.uniforms.uOrigin.value.add(spOff);
      sparks.uniforms.uClearY.value.set(wp.y + o.height * 0.3, wp.y + o.height * 1.05);
      flecks.uniforms.uClearY.value.copy(sparks.uniforms.uClearY.value);
    },
  };
}
