import * as THREE from 'three';

export function makeStage(canvas: HTMLCanvasElement) {
  return new THREE.WebGLRenderer({ canvas, antialias: true });
}
