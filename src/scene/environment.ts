import * as THREE from 'three';
import { light, NOISE_GLSL } from './toon';

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
        c = mix(c, uBottom, 1.0 - smoothstep(-0.5, 0.0, d.y));
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
