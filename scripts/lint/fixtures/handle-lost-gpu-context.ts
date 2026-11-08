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

export function makeHandedOn(canvas: HTMLCanvasElement, bare: HTMLCanvasElement, onLost: () => void) {
  const handedOn = new THREE.WebGLRenderer({ canvas });
  handOn(canvas, onLost);
  const passedOn = new THREE.WebGLRenderer({ canvas: bare });
  passOn(bare);
  return [handedOn, passedOn];
}

function handOn(target: HTMLCanvasElement, onLost: () => void) {
  listenFor(target, onLost);
}

function listenFor(target: HTMLCanvasElement, onLost: () => void) {
  target.addEventListener(LOST, onLost);
}

function passOn(target: HTMLCanvasElement) {
  sizeDown(target);
}

function sizeDown(target: HTMLCanvasElement) {
  target.width = 1;
}
