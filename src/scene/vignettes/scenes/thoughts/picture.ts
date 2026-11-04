import * as THREE from 'three';

export const FOV = 36;
export const DEG = Math.PI / 180;

export interface Passing {
  n: number;
  u: number;
}

export const dirOf = (az: number, el: number, out = new THREE.Vector3()) =>
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

export interface Picture {
  pose(t: number, on: Passing[]): void;
  where(n: number, u: number, out: THREE.Vector3): THREE.Vector3;
  resize(width: number, height: number): void;
  readonly probe?: Record<string, number>;
}
export type Paint = (scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: { value: number }) => Picture;
