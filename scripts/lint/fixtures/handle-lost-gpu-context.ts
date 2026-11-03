import * as THREE from 'three';

const LOST = 'webglcontextlost';

export function makeStage(canvas: HTMLCanvasElement) {
  return new THREE.WebGLRenderer({ canvas, antialias: true });
}

function watchLoss(target: HTMLCanvasElement, onLost: () => void) {
  target.addEventListener(LOST, onLost);
}

export function makeScenes(canvas: HTMLCanvasElement, spare: HTMLCanvasElement, onLost: () => void) {
  const shown = new THREE.WebGLRenderer({ canvas });
  canvas.addEventListener(LOST, onLost);
  const own = new THREE.WebGLRenderer();
  own.domElement.addEventListener('webglcontextlost', onLost);
  const helped = new THREE.WebGLRenderer();
  watchLoss(helped.domElement, onLost);
  const unwatched = new THREE.WebGLRenderer({ canvas: spare });
  return [shown, own, helped, unwatched];
}
