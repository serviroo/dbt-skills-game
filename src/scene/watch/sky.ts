import * as THREE from 'three';
import { mulberry32 } from '../../core/math';

/**
 * The camp's night sky: a dome from the void overhead to a deep blue haze at the horizon (the fog's colour, so the far
 * hills melt into it), stars that twinkle very slowly, and a moon past first quarter with its halo. The moon is placed
 * in the camera's frame rather than in the sky, so it is in view at every screen shape; it holds still for now.
 */
export const HORIZON = 0x0d1528;
const ZENITH = 0x07080f;
const R = 90;

export interface Sky {
  group: THREE.Group;
  /** puts the moon at the same place in the frame for this camera */
  frame(camera: THREE.PerspectiveCamera): void;
  /** where the moonlight comes from, for the scene's moon light */
  moonDir: THREE.Vector3;
  tick(t: number): void;
}

function dome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uZen: { value: new THREE.Color(ZENITH) }, uHor: { value: new THREE.Color(HORIZON) } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZen; uniform vec3 uHor;
      varying vec3 vDir;
      float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float up = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHor, uZen, smoothstep(0.0, 0.55, up));
        // a faint band of far stars across the sky, barely there
        vec2 q = vec2(atan(vDir.z, vDir.x) * 3.0, vDir.y * 9.0);
        float band = exp(-pow((vDir.y - 0.55 + 0.25 * sin(atan(vDir.z, vDir.x))) * 3.2, 2.0));
        c += vec3(0.05, 0.07, 0.13) * band * (0.55 + 0.45 * n(q * 1.7)) * smoothstep(0.02, 0.2, up);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16), mat);
  mesh.renderOrder = -2;
  return mesh;
}

function stars() {
  const r = mulberry32(97);
  const n = 900;
  const pos = new Float32Array(n * 3);
  const look = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // more stars higher up, none below the hills
    const y = 0.06 + Math.pow(r(), 0.75) * 0.94;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * s * (R - 2), y * (R - 2), Math.sin(a) * s * (R - 2)], i * 3);
    const big = r();
    // size in px, brightness, phase
    look.set([big > 0.96 ? 2.6 : big > 0.8 ? 1.8 : 1.15, 0.35 + r() * 0.65, r() * Math.PI * 2], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aLook', new THREE.BufferAttribute(look, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aLook;
      uniform float uTime; uniform float uPx;
      varying float vB;
      void main() {
        // each star swells and fades on its own slow wave, a few seconds or more each way
        float tw = 0.78 + 0.22 * sin(uTime * (0.35 + fract(aLook.z) * 0.6) + aLook.z * 7.0);
        vB = aLook.y * tw * smoothstep(0.04, 0.18, normalize(position).y);
        gl_PointSize = aLook.x * uPx;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vB;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.35, 1.0, d)) * vB;
        gl_FragColor = vec4(vec3(0.82, 0.9, 1.0) * a * 1.4, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = -1;
  pts.frustumCulled = false;
  return { pts, time: mat.uniforms.uTime, px: mat.uniforms.uPx };
}

/** The moon on one quad: a lit sphere past first quarter with soft seas, and its halo in two layers around it. */
function moon() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLight: { value: new THREE.Vector3(0.62, 0.2, 0.76).normalize() } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight;
      varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        // the disc fills the middle fifth of the quad; the rest is halo
        vec2 p = vUv * 5.0;
        float r = length(p);
        vec3 col = vec3(0.0);
        if (r < 1.0) {
          vec3 nrm = vec3(p, sqrt(1.0 - r * r));
          float lit = smoothstep(-0.06, 0.12, dot(nrm, uLight));
          float seas = n(p * 2.2 + 3.0) * 0.6 + n(p * 5.0) * 0.4;
          vec3 ground = mix(vec3(0.72, 0.8, 0.92), vec3(0.95, 0.97, 1.0), smoothstep(0.35, 0.75, seas));
          col = ground * lit * 1.9 + vec3(0.03, 0.05, 0.09) * (1.0 - lit);
          col *= 1.0 - smoothstep(0.93, 1.0, r) * 0.5;
        }
        float halo = exp(-max(r - 1.0, 0.0) * 1.6) * 0.16 + exp(-max(r - 1.0, 0.0) * 0.45) * 0.05;
        col += vec3(0.42, 0.62, 1.0) * halo * (1.0 - smoothstep(3.6, 5.0, r));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

export function buildSky(): Sky {
  const group = new THREE.Group();
  group.name = 'sky';
  const s = stars();
  const m = moon();
  group.add(dome(), s.pts, m);
  const moonDir = new THREE.Vector3(0.3, 0.6, -0.75).normalize();
  const v = new THREE.Vector3();
  return {
    group,
    moonDir,
    frame(camera) {
      // three quarters across, near the top of the frame, far out on the dome, a constant size on screen
      camera.updateMatrixWorld();
      v.set(camera.aspect < 1 ? 0.5 : 0.42, camera.aspect < 1 ? 0.72 : 0.6, 0.5).unproject(camera).sub(camera.position).normalize();
      moonDir.copy(v);
      const dist = R * 0.8;
      m.position.copy(camera.position).addScaledVector(v, dist);
      m.lookAt(camera.position);
      const tall = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
      m.scale.setScalar(tall * 0.36);
      group.position.copy(camera.position).setY(0);
      m.position.sub(group.position);
      s.px.value = camera.userData.px ?? 1;
    },
    tick(t) {
      s.time.value = t;
    },
  };
}
