import * as THREE from 'three';
import { light, NOISE_GLSL } from './toon';
import { noiseTexture } from './fx/noise';

/**
 * The night every intro beat shares. One horizon colour is both the sky at the horizon and the fog colour of every
 * material (light.uFogColor), so the ground, the ruins and the army all melt into the same sky. Above the horizon the
 * sky darkens to the void; slow cloud banks and sparse stars sit in it; the gate's light gathers low in the haze behind
 * the gate and lights the cloud edges nearest it. Nothing here glows: the sky stays far under the bloom threshold.
 */
export const NIGHT = {
  /** The horizon, which is also the fog: the same uniform as light.uFogColor (buildDungeonEnv sets it to NIGHT_HORIZON). */
  uHorizon: light.uFogColor,
  uZenith: { value: new THREE.Color(0.0016, 0.0019, 0.0042) },
  /** The cloud banks where nothing lights them: darker than the sky behind, so they read as shapes. */
  uCloud: { value: new THREE.Color(0.0012, 0.0016, 0.0042) },
  uGatePos: { value: new THREE.Vector3(0, 0, -6.5) },
  uGateCol: { value: new THREE.Color(0x4fb8ff) },
  /** The gate's light, 0 before the crack. */
  uGateI: { value: 0 },
  uStars: { value: 1 },
  uTime: { value: 0 },
};
/** The night horizon and fog colour: a deep blue, never grey. The intro world sets it when it builds (not on import, so
 * the labs and anything else that loads this file keep their own fog). */
export const NIGHT_HORIZON = new THREE.Color(0.0042, 0.0072, 0.0205);

/** Sky colour along a world direction seen from `cam`. Needs uNoise (the shared noise texture). */
export const NIGHT_GLSL = /* glsl */ `
uniform vec3 uHorizon, uZenith, uCloud, uGatePos, uGateCol;
uniform float uGateI, uStars, uTime;
float nHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
/* the gate's light in the haze: a wide low dome round its bearing, brightest just over the horizon */
float gateHaze(vec3 d, vec3 cam) {
  vec2 g = uGatePos.xz - cam.xz;
  float gl = length(g);
  vec2 gd = gl > 1e-3 ? g / gl : vec2(0.0, -1.0);
  vec2 dh = d.xz;
  float dl = length(dh);
  float ca = dl > 1e-4 ? dot(dh / dl, gd) : 0.0;
  float az = 1.0 - ca;
  return exp(-az * 9.0) * exp(-max(d.y, 0.0) * 3.2) + 0.35 * exp(-az * 2.2) * exp(-max(d.y, 0.0) * 7.0);
}
vec3 nightSky(vec3 d, vec3 cam) {
  float h = d.y;
  float up = smoothstep(-0.02, 0.6, h);
  vec3 c = mix(uHorizon, uZenith, pow(up, 0.6));
  float haze = gateHaze(d, cam) * uGateI;
  vec3 glow = mix(uGateCol * vec3(0.55, 0.75, 1.0), vec3(0.48, 0.25, 0.89), 0.25);
  c += glow * haze * 0.022;

  // cloud banks on a plane overhead: they crowd towards the horizon and drift slowly
  if (h > -0.02) {
    float k = 1.0 / (max(h, 0.0) + 0.09);
    vec2 cp = d.xz * k * 0.045 + vec2(uTime * 0.0022, uTime * 0.0009);
    float n1 = texture2D(uNoise, cp).r;
    float n2 = texture2D(uNoise, cp * 2.7 + 0.31).g;
    float dens = smoothstep(0.46, 0.78, n1 * 0.78 + n2 * 0.34);
    // the edge facing the gate catches its light (the density falls off towards the gate there)
    vec2 g = normalize(uGatePos.xz - cam.xz + 1e-4);
    float n1g = texture2D(uNoise, cp + g * 0.012).r;
    float densG = smoothstep(0.46, 0.78, n1g * 0.78 + n2 * 0.34);
    float rim = clamp((dens - densG) * 3.0, 0.0, 1.0) + 0.25 * dens;
    float fade = smoothstep(-0.02, 0.12, h);
    vec3 cc = mix(uCloud, uHorizon * 0.6, 1.0 - up);
    cc += glow * (rim * 0.05 + dens * 0.012) * haze * 1.6;
    c = mix(c, cc, dens * fade * 0.92);
    // stars in the clear sky, thinning towards the horizon and in the gate's haze
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float hs = nHash(cell);
    if (hs > 0.9935) {
      vec3 o = vec3(nHash(cell + 1.7), nHash(cell + 3.1), nHash(cell + 5.3)) * 0.5 + 0.25;
      float px = length(fwidth(sp));
      float r0 = mix(0.05, 0.11, nHash(cell + 7.7));
      float r = max(r0, px * 0.7);
      float s = exp(-pow(length(fract(sp) - o) / r, 2.0)) * (r0 * r0) / (r * r);
      float tw = 0.78 + 0.22 * sin(uTime * (0.4 + hs * 9.0) + hs * 400.0);
      float clear = (1.0 - dens) * smoothstep(0.06, 0.35, h) * (1.0 - min(1.0, haze * 1.4));
      vec3 sc = mix(vec3(0.55, 0.68, 1.0), vec3(0.9, 0.95, 1.0), nHash(cell + 9.1));
      c += sc * s * tw * clear * 0.11 * uStars * mix(0.5, 1.6, step(0.9985, hs));
    }
  }
  return c;
}
`;

/** The sky: a camera-centred dome at infinity, drawn after the opaque scene so only the open sky pays for it. */
export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...NIGHT, uNoise: { value: noiseTexture() } },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      ${NIGHT_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(nightSky(normalize(vDir), cameraPosition), 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  // after every opaque mesh (depth test at the far plane), before the transparent light layers
  sky.renderOrder = 1;
  return sky;
}

/** Void backdrop: a huge inward-facing sphere with a faint gradient, a backlight bloom disc and drifting dust. */
export function buildVoid() {
  const group = new THREE.Group();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: light.uTime,
      uTop: { value: new THREE.Color(0x0b0d1c) },
      uMid: { value: new THREE.Color(0x07080f) },
      uBottom: { value: new THREE.Color(0x05050a) },
      uGlowDir: { value: new THREE.Vector3(0, 0.15, -1).normalize() },
      uGlowColor: { value: new THREE.Color(0x2a1c66) },
      uGlow: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom;
      uniform vec3 uGlowDir; uniform vec3 uGlowColor; uniform float uGlow; uniform float uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = mix(uMid, uTop, smoothstep(0.0, 0.8, d.y));
        c = mix(c, uBottom, smoothstep(0.0, -0.5, d.y));
        float g = pow(max(dot(d, uGlowDir), 0.0), 6.0);
        float n = fbm3(d * 3.0 + vec3(0.0, 0.0, uTime * 0.03));
        c += uGlowColor * g * uGlow * (0.7 + 0.6 * n);
        // very faint large-scale mottling so the void isn't a flat fill
        c += vec3(0.006, 0.006, 0.014) * (n - 0.5);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // Ground: dark, slightly glossy-looking via a radial sheen, with ink-like noise.
  const groundMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: light.uTime,
      uColor: { value: new THREE.Color(0x0b0c16) },
      uSheen: { value: new THREE.Color(0x1a2450) },
      uSheenPos: { value: new THREE.Vector3(0, 0, -2.5) },
      uSheenStrength: { value: 0.0 },
      uPool: { value: new THREE.Color(0x3a1d8a) },
      uPoolStrength: { value: 0.0 },
      uFogColor: light.uFogColor,
      uFogDensity: light.uFogDensity,
      uRadius: { value: 7.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uSheen; uniform vec3 uSheenPos; uniform float uSheenStrength;
      uniform vec3 uPool; uniform float uPoolStrength; uniform float uTime; uniform float uRadius;
      uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vPos;
      ${NOISE_GLSL}
      void main() {
        float r = length(vPos.xz);
        float edge = 1.0 - smoothstep(uRadius * 0.45, uRadius, r);
        float n = fbm3(vec3(vPos.xz * 1.6, uTime * 0.02));
        vec3 c = uColor * (0.75 + 0.5 * n);
        float sd = length(vPos.xz - uSheenPos.xz);
        c += uSheen * uSheenStrength * exp(-sd * 0.55) * (0.6 + 0.4 * n);
        float pd = length(vPos.xz);
        c += uPool * uPoolStrength * exp(-pd * 1.4);
        float dist = length(cameraPosition - vPos);
        float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
        c = mix(c, uFogColor, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(c, edge);
      }`,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 1, 1), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = -5;
  group.add(ground);

  return { group, sky, skyMat, ground, groundMat };
}
