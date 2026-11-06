import * as THREE from 'three';
import { breathAt, ease } from '../../../motion/breath';
import { loadFigures, loadOnce } from '../../watch/models';
import type { BuildScene } from '../runtime';

const FOV = 26;
const AIM = new THREE.Vector3(0, 0.13, -0.03);
const RISE = 1.05;
const HEAD = new THREE.Vector3(0, 0.165, 0.19);
const FILL = 0.9;
const WING_ROOT = new THREE.Vector3(0.045, 0.13, 0);
const ANT_ROOT = new THREE.Vector3(0.022, 0.215, 0.215);
const FOLDED = 1.45;
const REST = 0.14;
const BREATH_LIFT = 0.12;
const WAKE_AT = 0.25;
const WAKE = 2.2;
const EYE_LIGHT = 2;
const STILL_AT = WAKE_AT + WAKE + 2;

type Box = [number, number, number, number, number, number];
interface MothHook {
  builds: number;
  disposed: number;
}

const boxes: Record<string, Box> = {};
const hook = ((window as unknown as { __moth?: MothHook }).__moth ??= { builds: 0, disposed: 0 });

let parts: Map<string, THREE.Object3D> | null = null;

function mothOf(scene: THREE.Object3D) {
  const root = scene.getObjectByName('moth');
  if (!root) throw new Error('moth.glb has no moth');
  return [root];
}

export const ready = loadOnce(async () => {
  const [root] = await loadFigures('models/moth.glb', boxes, mothOf);
  root.getObjectByName('moth-eye')?.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.isMeshStandardMaterial) m.emissiveIntensity = EYE_LIGHT;
  });
  parts = new Map(root.children.map((c) => [c.name, c]));
});

function part(name: string) {
  const p = parts?.get(`moth-${name}`);
  if (!p) throw new Error(`the moth's model has no ${name}`);
  return p.clone();
}

function hinge(name: string, at: THREE.Vector3) {
  const g = new THREE.Group();
  g.position.copy(at);
  const p = part(name);
  p.position.sub(at);
  g.add(p);
  return g;
}

const mirrored = (at: THREE.Vector3, side: number) => at.clone().setX(at.x * side);

function haloTexture(stops: [number, number][]) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`);
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function softGlow(stops: [number, number][], color: number, opacity = 1) {
  const map = haloTexture(stops);
  const blending = THREE.AdditiveBlending;
  return new THREE.SpriteMaterial({ map, color, transparent: true, opacity, blending, depthWrite: false });
}

function corners([x0, y0, z0, x1, y1, z1]: Box, at: THREE.Vector3) {
  return [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].map((z) => new THREE.Vector3(x, y, z).sub(at))));
}

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  camera.up.set(0, 0, 1);

  scene.add(new THREE.HemisphereLight(0xe4dcff, 0x1a1236, 1));
  const moon = new THREE.DirectionalLight(0xf0ecff, 3.3);
  moon.position.set(0, 1.6, 0.5);
  const rim = new THREE.DirectionalLight(accent, 2.2);
  rim.position.set(0, 0.6, -1.3);
  const fill = new THREE.DirectionalLight(0x7b3fe4, 0.7);
  fill.position.set(0, 0.15, 1.0);
  scene.add(moon, rim, fill);

  const moth = new THREE.Group();
  const body = part('body');
  const eyes = part('eye');
  moth.add(body, eyes);
  const wings = [1, -1].map((s) => hinge(`wing${s}`, mirrored(WING_ROOT, s)));
  const ants = [1, -1].map((s) => hinge(`ant${s}`, mirrored(ANT_ROOT, s)));
  moth.add(...wings, ...ants);
  const halo = softGlow([[0, 1], [0.35, 0.38], [1, 0]], 0x89cf9d, 0.55);
  const [x0, y0, z0, x1, y1, z1] = boxes['moth-eye'];
  for (const s of [-1, 1]) {
    const glow = new THREE.Sprite(halo);
    glow.position.set(s * (Math.max(-x0, x1) - (y1 - y0) / 2), (y0 + y1) / 2, (z0 + z1) / 2);
    glow.scale.setScalar(0.2);
    moth.add(glow);
  }
  const aura = softGlow([[0, 0.8], [0.45, 0.32], [1, 0]], 0x7b3fe4);
  const behind = new THREE.Sprite(aura);
  behind.position.set(0, 0, -0.03);
  behind.scale.setScalar(1.25);
  behind.renderOrder = -1;
  scene.add(moth, behind);
  hook.builds++;

  let dist = 3;
  const tips = [1, -1].map((s) => {
    const [ax0, , , ax1, ay1, az1] = boxes[`moth-ant${s}`];
    return new THREE.Vector3(s > 0 ? ax1 : ax0, ay1, az1).sub(mirrored(ANT_ROOT, s));
  });
  const v = new THREE.Vector3();
  const tipAbove = (a: THREE.Group, i: number) => a.localToWorld(tips[i].clone()).project(camera).y;
  const antennaeAbove = () => {
    const head = v.copy(HEAD).project(camera).y;
    return Math.min(...ants.map((a, i) => tipAbove(a, i) - head)) / 2;
  };
  const probe = { lift: REST, antenna: 0, e: 0, antennaeAbove: 0 };

  const origin = new THREE.Vector3();
  const reached = [
    { g: null, pts: corners(boxes['moth-body'], origin) },
    { g: null, pts: corners(boxes['moth-eye'], origin) },
    ...[...wings, ...ants].map((g) => ({ g, pts: corners(boxes[g.children[0].name], g.position) })),
  ];
  const place = (d: number) => {
    camera.position.set(AIM.x, AIM.y + Math.sin(RISE) * d, AIM.z + Math.cos(RISE) * d);
    camera.lookAt(AIM);
    camera.updateMatrixWorld();
  };
  const reach = (d: number) => {
    place(d);
    let m = 0;
    for (const { g, pts } of reached) {
      for (const p of pts) {
        const q = v.copy(p);
        if (g) g.localToWorld(q);
        q.project(camera);
        m = Math.max(m, Math.abs(q.x), Math.abs(q.y));
      }
    }
    return m;
  };
  function fit() {
    wings[0].rotation.z = REST - BREATH_LIFT / 2;
    wings[1].rotation.z = -wings[0].rotation.z;
    for (const a of ants) a.rotation.set(0, 0, 0);
    moth.position.y = 0;
    moth.updateMatrixWorld(true);
    let lo = 0.5;
    let hi = 20;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (reach(mid) > FILL) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  return {
    scene,
    camera,
    probe,
    pose(b, still) {
      const e = still ? STILL_AT : b.e;
      const woke = ease((e - WAKE_AT) / WAKE);
      const breath = breathAt(e - WAKE_AT - WAKE) - 0.5;
      const lift = FOLDED + (REST - FOLDED) * woke + BREATH_LIFT * breath * woke;
      wings[0].rotation.z = lift;
      wings[1].rotation.z = -lift;
      const drift = 0.05 * Math.sin(e * 0.9) * woke;
      ants[0].rotation.set(drift * 0.6, 0, -drift);
      ants[1].rotation.set(-drift * 0.6, 0, -drift);
      moth.position.y = 0.006 * breath * woke;
      place(dist);
      moth.updateMatrixWorld();
      probe.lift = lift;
      probe.antennaeAbove = antennaeAbove();
      probe.antenna = drift;
      probe.e = e;
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dist = fit();
    },
    dispose() {
      hook.disposed++;
    },
  };
};
