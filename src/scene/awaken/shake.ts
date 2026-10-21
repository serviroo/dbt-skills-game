import * as THREE from 'three';
import { params } from '../../core/params';

/**
 * The one camera shake of the whole piece (AWAKEN hit). Measured/derived spec (REFERENCE beat 5):
 * 1.0-1.3 % of frame height, 300 ms, position updated every 2 frames (30 Hz), decay x0.55 per step,
 * roll <= 0.5 deg, off under prefers-reduced-motion. Applied as a screen-space lens shift on the projection
 * matrix, so it is exactly a % of frame height at any distance and never accumulates state.
 */
export const SHAKE = { dur: 0.3, amp: 0.012, hz: 30, decay: 0.55, roll: (0.5 * Math.PI) / 180 };

const hash = (n: number) => {
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return s - Math.floor(s);
};

/** Pure: offset in fractions of frame height (x right, y up) and roll in radians, at time t for a shake at t0. */
export function shakeOffset(t: number, t0: number) {
  const dt = t - t0;
  if (params.reduced || dt < 0 || dt >= SHAKE.dur) return { x: 0, y: 0, roll: 0 };
  const k = Math.floor(dt * SHAKE.hz + 1e-6);
  const a = SHAKE.amp * Math.pow(SHAKE.decay, k);
  const base = k % 2 === 0 ? -Math.PI / 2 : Math.PI / 2;
  const ang = base + (hash(k + 1) - 0.5) * (k === 0 ? 0.6 : 1.8);
  const roll = (k % 2 === 0 ? -1 : 1) * SHAKE.roll * Math.pow(SHAKE.decay, k) * (0.65 + 0.35 * hash(k + 9));
  return { x: Math.cos(ang) * a, y: Math.sin(ang) * a, roll };
}

const _m = new THREE.Matrix4();

/**
 * Call every frame AFTER the camera is placed for the frame (it rebuilds the projection matrix first, so it is
 * stateless): `shake(camera, t, tHit)`. Returns the applied offset.
 */
export function shake(camera: THREE.PerspectiveCamera, t: number, t0: number) {
  camera.updateProjectionMatrix();
  const o = shakeOffset(t, t0);
  if (o.x === 0 && o.y === 0 && o.roll === 0) return o;
  const asp = camera.aspect;
  const c = Math.cos(o.roll), s = Math.sin(o.roll);
  const dx = (2 * o.x) / asp, dy = 2 * o.y;
  _m.set(c, -s / asp, 0, dx, s * asp, c, 0, dy, 0, 0, 1, 0, 0, 0, 0, 1);
  camera.projectionMatrix.premultiply(_m);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return o;
}
