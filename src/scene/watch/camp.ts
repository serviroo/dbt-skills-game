import * as THREE from 'three';
import type { ShadowId } from '../../content/roster-lines';
import type { BuildScene } from '../vignettes/runtime';
import { FIGURES, type Figure } from './figures';
import { makeMats, sway } from './kit';
import { buildSky, HORIZON } from './sky';
import { buildWorld, HEARTH, LANTERN, SPOTS } from './world';

/**
 * The Night Watch's camp, a scene of the companion's shared scene host (src/scene/vignettes/host.ts): the world, the
 * sky and one figure for every watcher who has arrived. It reports where each figure is in the frame, so the roster
 * can lay a labelled button over it; the scene itself takes no input.
 */

/** Where a figure is in the frame, as shares of the frame's width and height from its top left. */
export interface CampHit {
  id: ShadowId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** how far from the camera: nearer figures sit on top */
  depth: number;
}
export interface CampInput {
  ids: ShadowId[];
  onHits(hits: CampHit[]): void;
}

/** What the camp is doing, for the E2E checks: who stands in it, where, and how often it was built and taken down. */
interface CampHook {
  builds: number;
  disposed: number;
  ids: ShadowId[];
  hits: CampHit[];
}
const hook: CampHook = ((window as unknown as { __camp?: CampHook }).__camp ??= { builds: 0, disposed: 0, ids: [], hits: [] });

const FOV = 36;
/** a still frame (reduced motion) is posed at this moment: the Lantern at the middle of its breath */
const STILL_T = 0;
const TAU = Math.PI * 2;

/** Every place the frame must hold, whoever has arrived, so the camp doesn't reframe as the Watch grows. */
function framePoints() {
  const pts: THREE.Vector3[] = [];
  for (const { at, y = 0, r = 0.45 } of Object.values(SPOTS)) {
    pts.push(new THREE.Vector3(at[0] - r, y, at[1]), new THREE.Vector3(at[0] + r, y, at[1]), new THREE.Vector3(at[0], y, at[1] + r), new THREE.Vector3(at[0], y + 1.9, at[1]));
  }
  pts.push(new THREE.Vector3(LANTERN[0], 2.7, LANTERN[2]), new THREE.Vector3(SPOTS.crest.at[0], 2.85, SPOTS.crest.at[1]), new THREE.Vector3(HEARTH[0], 0, HEARTH[2] + 0.7));
  return pts;
}

/**
 * Where two figures overlap in the frame (Vesper on his rock just behind Sable, seen from the side), each keeps its own
 * side of the line halfway between them, across whichever way they stand further apart, so a tap in the middle of
 * either lands on that one. `aspect` is the frame's width over its height.
 */
function apart(hits: CampHit[], aspect: number) {
  const mid = hits.map((a) => [a.x + a.w / 2, a.y + a.h / 2]);
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const a = hits[i], b = hits[j];
      if (a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h) continue;
      const [ax, ay] = mid[i], [bx, by] = mid[j];
      const across = Math.abs(bx - ax) * aspect >= Math.abs(by - ay);
      const [lo, hi] = (across ? ax < bx : ay < by) ? [a, b] : [b, a];
      const m = across ? (ax + bx) / 2 : (ay + by) / 2;
      if (across) {
        lo.w = Math.min(lo.w, m - lo.x);
        if (hi.x < m) (hi.w -= m - hi.x), (hi.x = m);
      } else {
        lo.h = Math.min(lo.h, m - lo.y);
        if (hi.y < m) (hi.h -= m - hi.y), (hi.y = m);
      }
    }
  }
}

export const build: BuildScene = (_accent, opts) => {
  const input = opts.input as CampInput;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 10, 30);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  const mats = makeMats();
  const world = buildWorld(mats);
  const sky = buildSky();
  scene.add(world.group, sky.group);

  const figures: { f: Figure; spot: THREE.Group }[] = [];
  for (const id of input.ids) {
    const f = FIGURES[id](mats);
    const spot = new THREE.Group();
    const s = SPOTS[id];
    spot.position.set(s.at[0], s.y ?? 0, s.at[1]);
    spot.rotation.y = s.face;
    spot.add(f.root);
    scene.add(spot);
    figures.push({ f, spot });
  }
  hook.builds++;
  hook.ids = [...input.ids];

  const target = new THREE.Vector3(0, 0.95, -0.35);
  const frame = framePoints();
  let dist = 12;
  let height = 2.1;
  const v = new THREE.Vector3();
  /** puts the camera at azimuth `az` (radians) around the camp, at the fitted distance */
  function place(az: number, lift: number) {
    camera.position.set(target.x + Math.sin(az) * dist, height + lift, target.z + Math.cos(az) * dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  /** the nearest distance at which the whole camp fits in the frame, with a margin */
  function fit() {
    let lo = 4, hi = 40;
    for (let i = 0; i < 22; i++) {
      dist = (lo + hi) / 2;
      // the camera rises with distance so it always looks down on the camp at the same gentle angle
      height = target.y + dist * Math.tan(THREE.MathUtils.degToRad(11));
      place(0, 0);
      let ok = true;
      for (const p of frame) {
        v.copy(p).project(camera);
        if (Math.abs(v.x) > 0.93 || v.y > 0.74 || v.y < -0.66 || v.z > 1) {
          ok = false;
          break;
        }
      }
      if (ok) hi = dist;
      else lo = dist;
    }
    dist = hi;
    height = target.y + dist * Math.tan(THREE.MathUtils.degToRad(11));
    // the fog starts behind the camp and swallows the far hills, whatever the distance
    (scene.fog as THREE.Fog).near = dist + 2;
    (scene.fog as THREE.Fog).far = dist + 22;
  }

  const corner = new THREE.Vector3();
  const box = new THREE.Box3();
  let sent = '';
  function hits() {
    const out: CampHit[] = [];
    for (const { f, spot } of figures) {
      box.copy(f.box).applyMatrix4(spot.matrixWorld);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
        x0 = Math.min(x0, corner.x), x1 = Math.max(x1, corner.x);
        y0 = Math.min(y0, corner.y), y1 = Math.max(y1, corner.y);
      }
      out.push({ id: f.id, x: (x0 + 1) / 2, y: (1 - y1) / 2, w: (x1 - x0) / 2, h: (y1 - y0) / 2, depth: box.getCenter(corner).distanceTo(camera.position) });
    }
    apart(out, camera.aspect);
    const r = (n: number) => Math.round(n * 10000) / 10000;
    for (const o of out) (o.x = r(o.x)), (o.y = r(o.y)), (o.w = r(o.w)), (o.h = r(o.h)), (o.depth = r(o.depth));
    const key = JSON.stringify(out);
    if (key === sent) return;
    sent = key;
    hook.hits = out;
    input.onHits(out);
  }

  return {
    scene,
    camera,
    pose(b, still) {
      const t = still ? STILL_T : b.e;
      sway.uTime.value = t;
      // the camera drifts a few degrees around the camp and back over a minute; still, it rests in the middle
      place(still ? 0 : Math.sin((t / 64) * TAU) * 0.045, still ? 0 : Math.sin((t / 41) * TAU) * 0.06);
      world.tick(t, still);
      sky.tick(t);
      for (const { f } of figures) f.idle(t);
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      fit();
      place(0, 0);
      camera.userData.px = Math.min(3, Math.max(1, height / 480));
      sky.frame(camera);
      // where the figures are, with the camera at rest: its slow drift moves them a few pixels at most, so the buttons
      // over them are placed once per frame size and an idle camp does no style work
      scene.updateMatrixWorld();
      hits();
    },
    dispose() {
      world.dispose();
      for (const m of Object.values(mats)) m.dispose();
      hook.disposed++;
      hook.ids = [];
      hook.hits = [];
    },
  };
};
