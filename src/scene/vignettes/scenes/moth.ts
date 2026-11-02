import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { siteUrl } from '../../../core/base';
import { breathAt, ease } from '../../../motion/breath';
import { settle } from '../../watch/models';
import type { BuildScene } from '../runtime';

/**
 * The companion, a small night moth, as modelled in Blender (scripts/build-moth.py, packed by scripts/build-moth.mjs into
 * public/models/moth.glb). It wakes as it is met: its wings, folded up over its back, open to rest, and from then on
 * lift a little and settle with the slow breath while its antennae drift. Moonlight from above, the player's accent as
 * a rim from behind, a low violet fill; its eyes are its own light, mint, each in a soft halo, and the soft violet glow
 * every epic reward card's emblem has lies behind it.
 */

const FOV = 26;
/**
 * where the camera looks, and how high above the moth it looks from (radians), in front of its head: high enough to see
 * the wings open, low enough that the antennae rising from the head stand out above it, as a moth's should
 */
const AIM = new THREE.Vector3(0, 0.13, -0.03);
const RISE = 1.05;
/** the middle of the head (as built in scripts/build-moth.py) */
const HEAD = new THREE.Vector3(0, 0.165, 0.19);
/** the share of its window, out from the middle, the moth may reach at its widest */
const FILL = 0.9;
/** where each side's wings and antenna turn (as built: ROOT_X, ROOT_Y in scripts/build-moth.py) */
const WING_ROOT = new THREE.Vector3(0.045, 0.13, 0);
const ANT_ROOT = new THREE.Vector3(0.022, 0.215, 0.215);
/** the wings' lift above flat (radians): folded up over its back asleep, at rest, and how much a breath lifts them */
const FOLDED = 1.45;
const REST = 0.14;
const BREATH_LIFT = 0.12;
/** the waking: a beat before the wings start to open, then how long they take */
const WAKE_AT = 0.25;
const WAKE = 2.2;
/** how bright the eyes' own light is */
const EYE_LIGHT = 2;
/** a still frame (reduced motion) is posed awake, at the middle of a breath */
const STILL_AT = WAKE_AT + WAKE + 2;

let loading: Promise<void> | null = null;
let parts: Map<string, THREE.Object3D> | null = null;

/** What the moth's model looks like once loaded, for the E2E checks: each part's box in the moth's space (min, max). */
interface MothHook {
  parts: Record<string, number[]>;
  builds: number;
  disposed: number;
}
const hook: MothHook = ((window as unknown as { __moth?: MothHook }).__moth ??= { parts: {}, builds: 0, disposed: 0 });

/** Loads the moth once a visit, before its first scene is built; a failed load is tried again the next time. */
export function ready(): Promise<void> {
  loading ??= new GLTFLoader()
    .loadAsync(siteUrl('models/moth.glb'))
    .then((g) => {
      g.scene.updateMatrixWorld(true);
      const made = new Map<string, THREE.BufferGeometry>();
      const box = new THREE.Box3();
      const root = g.scene.getObjectByName('moth');
      if (!root) throw new Error('moth.glb has no moth');
      for (const part of root.children) {
        settle(part, made);
        part.updateMatrixWorld(true);
        hook.parts[part.name] = [...box.setFromObject(part).min.toArray(), ...box.max.toArray()];
      }
      parts = new Map(root.children.map((c) => [c.name, c]));
    })
    .catch((err: unknown) => {
      loading = null;
      throw err;
    });
  return loading;
}

function part(name: string) {
  const p = parts?.get(`moth-${name}`);
  if (!p) throw new Error(`the moth's model has no ${name}`);
  return p.clone();
}

/** A part that turns about `at` (in the moth's space): the part sits in a group there, moved back by as much. */
function hinge(name: string, at: THREE.Vector3) {
  const g = new THREE.Group();
  g.position.copy(at);
  const p = part(name);
  p.position.sub(at);
  g.add(p);
  return g;
}

/** A soft round glow, white, its strength out from the middle given as [share of the radius, opacity] stops. */
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

export const build: BuildScene = (accent) => {
  const scene = new THREE.Scene();
  // nothing behind it: the card shows through wherever the moth isn't (src/styles/cutscene.css)
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  // the head's way is up on screen
  camera.up.set(0, 0, 1);

  scene.add(new THREE.HemisphereLight(0xe4dcff, 0x1a1236, 1));
  // every light on the middle line, so both wings are lit alike however they are raised
  const moon = new THREE.DirectionalLight(0xf0ecff, 3.3);
  moon.position.set(0, 1.6, 0.5);
  const rim = new THREE.DirectionalLight(accent, 2.2);
  rim.position.set(0, 0.6, -1.3);
  const fill = new THREE.DirectionalLight(0x7b3fe4, 0.7);
  fill.position.set(0, 0.15, 1.0);
  scene.add(moon, rim, fill);

  const moth = new THREE.Group();
  const eyes = part('eye');
  // the eyes' light as the file has it is for Blender's renders; on the page a softer core keeps it mint, not white
  eyes.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.isMeshStandardMaterial) m.emissiveIntensity = EYE_LIGHT;
  });
  moth.add(part('body'), eyes);
  const wings = [1, -1].map((s) => hinge(`wing${s}`, WING_ROOT.clone().setX(WING_ROOT.x * s)));
  const ants = [1, -1].map((s) => hinge(`ant${s}`, ANT_ROOT.clone().setX(ANT_ROOT.x * s)));
  moth.add(...wings, ...ants);
  // each eye is its light's core; this is its soft halo, mint as the eyes are, wide enough to read on a phone
  const halo = new THREE.SpriteMaterial({ map: haloTexture([[0, 1], [0.35, 0.38], [1, 0]]), color: 0x89cf9d, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const [x0, y0, z0, x1, y1, z1] = hook.parts['moth-eye'];
  for (const s of [-1, 1]) {
    const glow = new THREE.Sprite(halo);
    // the box holds both eyes: each one's middle is its radius in from the box's side
    glow.position.set(s * (Math.max(-x0, x1) - (y1 - y0) / 2), (y0 + y1) / 2, (z0 + z1) / 2);
    glow.scale.setScalar(0.2);
    moth.add(glow);
  }
  // the card's violet glow, soft and wide, under the moth
  const aura = new THREE.SpriteMaterial({ map: haloTexture([[0, 0.8], [0.45, 0.32], [1, 0]]), color: 0x7b3fe4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const behind = new THREE.Sprite(aura);
  behind.position.set(0, 0, -0.03);
  behind.scale.setScalar(1.25);
  behind.renderOrder = -1;
  scene.add(moth, behind);
  hook.builds++;

  let dist = 3;
  // each antenna's tip, in its hinge's space: its box's corner out at its side, up and forwards, where it sweeps to
  const tips = [1, -1].map((s) => {
    const [ax0, , , ax1, ay1, az1] = hook.parts[`moth-ant${s}`];
    return new THREE.Vector3(s > 0 ? ax1 : ax0, ay1, az1).sub(ANT_ROOT.clone().setX(ANT_ROOT.x * s));
  });
  const v = new THREE.Vector3();
  /** how far above the head the lower antenna tip shows, as a share of the window's height */
  const antennaeAbove = () => {
    const head = v.copy(HEAD).project(camera).y;
    return Math.min(...ants.map((a, i) => a.localToWorld(tips[i].clone()).project(camera).y - head)) / 2;
  };
  const probe = { lift: REST, antenna: 0, e: 0, antennaeAbove: 0 };

  /** every corner of every part's box, in its own part's space (the wings' and antennae's about their hinges) */
  const corners = [moth.children[0], moth.children[1], ...wings, ...ants].map((g) => {
    const name = g instanceof THREE.Group ? g.children[0].name : g.name;
    const [x0, y0, z0, x1, y1, z1] = hook.parts[name];
    const at = g instanceof THREE.Group ? g.position : new THREE.Vector3();
    return { g, pts: [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].map((z) => new THREE.Vector3(x, y, z).sub(at)))) };
  });
  /** places the camera `d` from where it looks, as pose does */
  const place = (d: number) => {
    camera.position.set(AIM.x, AIM.y + Math.sin(RISE) * d, AIM.z + Math.cos(RISE) * d);
    camera.lookAt(AIM);
    camera.updateMatrixWorld();
  };
  /**
   * The nearest distance at which the whole moth, its wings at their widest in a breath, stays within FILL of its
   * window's middle, in perspective (near wing tips show bigger than far ones). Found by halving, from the boxes'
   * corners.
   */
  function fit() {
    wings[0].rotation.z = REST - BREATH_LIFT / 2;
    wings[1].rotation.z = -wings[0].rotation.z;
    for (const a of ants) a.rotation.set(0, 0, 0);
    moth.position.y = 0;
    moth.updateMatrixWorld(true);
    const reach = (d: number) => {
      place(d);
      let m = 0;
      for (const { g, pts } of corners) for (const p of pts) {
        const q = v.copy(p);
        if (g instanceof THREE.Group) g.localToWorld(q);
        q.project(camera);
        m = Math.max(m, Math.abs(q.x), Math.abs(q.y));
      }
      return m;
    };
    let lo = 0.5, hi = 20;
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
      // the breath only joins once the wings have opened, so the waking ends without a jump
      const lift = FOLDED + (REST - FOLDED) * woke + BREATH_LIFT * breath * woke;
      wings[0].rotation.z = lift;
      wings[1].rotation.z = -lift;
      const drift = 0.05 * Math.sin(e * 0.9) * woke;
      ants[0].rotation.set(drift * 0.6, 0, -drift);
      ants[1].rotation.set(-drift * 0.6, 0, -drift);
      moth.position.y = 0.006 * breath * woke;
      // from high in front, its face and eyes in sight and its head at the top of the window, as the drawing has it
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
      for (const m of [halo, aura]) {
        m.map?.dispose();
        m.dispose();
      }
      hook.disposed++;
    },
  };
};
