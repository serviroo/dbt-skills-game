import * as THREE from 'three';
import { THOUGHTS } from '../../../motion/tokens';
import type { BuildScene } from '../runtime';
import { paintCars } from './thoughts/cars';
import { paintClouds } from './thoughts/clouds';
import { FOV, type Passing } from './thoughts/picture';

const STILL_T = 6;

type Pace = { readonly crossSec: number; readonly spaceSec: number };

function passing(pace: Pace, at: number, t: number) {
  const shift = t - STILL_T + at * pace.crossSec;
  const last = Math.floor(shift / pace.spaceSec);
  const on: Passing[] = [];
  for (let n = last; n > last - Math.ceil(pace.crossSec / pace.spaceSec); n--) {
    const u = (shift - n * pace.spaceSec) / pace.crossSec;
    if (u < 1) on.push({ n, u });
  }
  return on;
}

const PICTURES = {
  clouds: { paint: paintClouds, at: 0.42 },
  cars: { paint: paintCars, at: 0.55 },
};

export const build: BuildScene = (_accent, opts) => {
  const pic = opts.input as keyof typeof PICTURES;
  const { paint, at } = PICTURES[pic];
  const pace = THOUGHTS[pic];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1200);
  const time = { value: 0 };
  const picture = paint(scene, camera, time);
  const probe: Record<string, number | string> = { pic, things: '', ...picture.probe };
  const p = new THREE.Vector3();
  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const t = still ? STILL_T : Math.max(0, b.e);
      time.value = t;
      const on = passing(pace, at, t);
      picture.pose(t, on);
      camera.updateMatrixWorld();
      probe.things = on
        .map(({ n, u }) => (picture.where(n, u, p).project(camera), `${n}:${p.x.toFixed(3)}:${p.y.toFixed(3)}`))
        .join(' ');
      Object.assign(probe, picture.probe);
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      picture.resize(width, height);
    },
  };
};
