import * as THREE from 'three';
import type { Stage } from '../core/stage';
import { clamp, cubicBezier, ease, lerp, smoothstep } from '../core/math';
import { POSES, type Character } from '../scene/character/jinwoo';
import { addPose, type Pose } from '../scene/character/rig';
import { light } from '../scene/toon';
import { shake, ARISE_AT, IGNITE, RUBBLE, type Arise } from '../scene/arise';
import { params } from '../core/params';

/** The ARISE beat's camera, poses and effect drive (ported from the ARISE builder's lab). t is seconds from the beat start. */
export const HIT = 4.83;
export const ARISE_BEAT_DUR = 16;

type Shot = { t0: number; L: [THREE.Vector3, THREE.Vector3, number]; P: [THREE.Vector3, THREE.Vector3, number]; move?: (u: number, cam: CamState) => void };
type CamState = { pos: THREE.Vector3; tgt: THREE.Vector3; fov: number; roll: number };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const fingerRelax = cubicBezier(0.15, 0.6, 0.3, 1);
const WHITE = new THREE.Color(1, 1, 1);

/*
 * Framing notes (portrait 390x844 = P, landscape 1440x900 = L; anything between blends):
 * - the open gate stands 6.5 m behind him; every shot that looks at a face keeps it beside the head, never behind it
 * - from the soldiers' rise on, the camera sits left of him so the gate glows behind his raised right hand
 */
export function ariseSequence(stage: Stage, arise: Arise, jw: Character, cam: THREE.PerspectiveCamera) {
  const shots: Shot[] = [
    // hand hanging close-up; camera trucks 27 % W in 700 ms, ease-out, stepped on 2s
    {
      t0: 0,
      L: [V(-0.95, 0.98, 0.62), V(-0.24, 0.9, 0.0), 30],
      P: [V(-0.9, 1.0, 0.75), V(-0.24, 0.92, 0.0), 42],
      move: (u, c) => {
        const k = ease.outCubic(clamp(Math.floor((u / 0.7) * 12) / 12));
        c.pos.x += lerp(-0.22, 0, k);
        c.tgt.x += lerp(-0.12, 0, k);
        c.pos.z += 0.01 * u;
      },
    },
    // hard cut to the reach (side-front): the palm opens in the foreground, his face above it
    {
      t0: 1.85,
      L: [V(-1.8, 1.4, 1.6), V(-0.15, 1.28, 0.15), 40],
      P: [V(-1.7, 1.25, 1.9), V(-0.25, 1.1, 0.25), 48],
      move: (u, c) => c.pos.addScaledVector(V(0.3, 0, -0.3), u * 0.03),
    },
    // 3-frame wide insert of the full pose
    { t0: 3.38, L: [V(-4.8, 1.05, 1.0), V(0, 1.0, 0.3), 30], P: [V(-5.6, 1.1, 1.2), V(0, 1.0, 0.3), 46] },
    // front mid shot, the command: slightly to his left so the gate glows over his shoulder, not behind his face
    {
      t0: 3.48,
      L: [V(-0.62, 1.42, 2.65), V(0.08, 1.36, 0), 34],
      P: [V(-0.55, 1.4, 3.3), V(0.06, 1.3, 0), 48],
      move: (u, c) => c.pos.addScaledVector(V(0, 0, -1), u * 0.035),
    },
    // HIT: hard cut, high wide from behind, the pool opens
    {
      t0: HIT,
      L: [V(0, 14, -6.5), V(0, 0, 2.2), 50],
      P: [V(0, 14.5, -4.8), V(0, 0, 1.9), 68],
      move: (u, c) => c.pos.addScaledVector(V(0, -1, 0.3), u * 0.12),
    },
    // vortex (f0893 -> f0905): high angle looking down into the ring of flames, so the swirl fills the frame and the
    // gate stays out of shot; the camera pushes in and rolls with the spin on 4s (a fixed Dutch angle under ?reduced)
    {
      t0: 5.6,
      L: [V(1.5, 3.1, 2.6), V(0, 0.85, 0), 46],
      P: [V(1.05, 3.7, 2.8), V(0, 0.75, 0), 62],
      move: (u, c) => {
        const k = Math.floor(u * 7.5) / 7.5;
        c.pos.lerp(c.tgt, k * 0.12);
        c.roll = params.reduced ? -0.1 : -0.16 + 0.14 * k;
      },
    },
    // violet smoke: closer, slow push into the billows
    {
      t0: 7.44,
      L: [V(0.55, 1.25, 3.4), V(0, 1.35, 0), 40],
      P: [V(0.5, 1.25, 4.6), V(0, 1.3, 0), 54],
      move: (u, c) => c.pos.addScaledVector(V(0, 0, -1), u * 0.25),
    },
    // pre-ignition hold + ignition on the commander rising head-first: low, front-right; the gate glows beside the helm
    // (landscape) or just off frame (portrait), and his aura stays out of shot
    {
      t0: 8.31,
      L: [V(1.75, 0.62, 0.45), V(0.95, 0.56, -1.25), 36],
      P: [V(1.85, 0.6, 0.55), V(0.97, 0.6, -1.25), 50],
      move: (u, c) => {
        const k = Math.floor(u * 9) / 9;
        c.tgt.y += k * 0.12;
        c.pos.y += k * 0.05;
      },
    },
    // ignition insert (f1053 -> f1059): hard cut on the ignite cue to the commander's chest, low and close, so the
    // ice-blue burst through the plate seams fills the frame; it holds through the peak (9.45) into the settle
    {
      t0: 9.0,
      L: [V(1.08, 0.12, -0.3), V(0.94, 0.3, -1.1), 31],
      P: [V(1.1, 0.2, -0.06), V(0.94, 0.46, -1.1), 50],
      move: (u, c) => c.pos.lerp(c.tgt, Math.floor(u * 15) / 15 * 0.06),
    },
    // back to the mid shot as the eyes ignite last (their hard stop at 9.71 lands just after the cut)
    {
      t0: 9.58,
      L: [V(1.75, 0.62, 0.45), V(0.95, 0.56, -1.25), 36],
      P: [V(1.85, 0.6, 0.55), V(0.97, 0.6, -1.25), 50],
      move: (u, c) => {
        const k = Math.floor((u + 1.27) * 9) / 9;
        c.tgt.y += k * 0.12;
        c.pos.y += k * 0.05;
      },
    },
    // soldiers rise around him; camera left of him, tilting up in held steps (2.5-3.7 % H every 3-4 frames).
    // Cut at 10.05 (not the reference's 9.75) so the commander's lit eyes hold after the insert and his head stays in frame.
    {
      t0: 10.05,
      L: [V(-1.9, 0.4, 6.4), V(0.25, 1.3, -1.2), 42],
      P: [V(-1.2, 0.36, 4.3), V(0.25, 1.62, -1.2), 60],
      move: (u, c) => {
        const k = Math.floor(u * 7.5) / 7.5;
        c.tgt.y += Math.min(k, 2.45) * 0.3;
      },
    },
    // the army stands; the camera lines his raised hand up with the gate, so the hand is a silhouette against the
    // brightest light and his head catches its rim a few degrees to the side
    {
      t0: 11.9,
      L: [V(-0.82, 0.5, 6.0), V(0.05, 1.55, -2.0), 46],
      P: [V(-0.69, 0.45, 3.95), V(0.05, 1.78, -1.5), 60],
      move: (u, c) => c.pos.addScaledVector(V(0.25, 0, -1), u * 0.1),
    },
    // they kneel toward the camera (13.18-14.48, done before the result window opens at 14.67). The camera pitches up
    // so he and the kneeling front rank sit in the bottom third, under the centred window, with the gate towering above
    {
      t0: 13.1,
      L: [V(0.0, 1.5, 8.2), V(0, 3.22, -2.1), 36],
      P: [V(0.0, 1.45, 6.6), V(0, 4.2, -2.6), 64],
      move: (u, c) => c.pos.addScaledVector(V(0, 0.05, 1), u * 0.1),
    },
  ];

  const cs: CamState = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 35, roll: 0 };
  const back = new THREE.Vector3();
  const placeCamera = (t: number) => {
    let i = 0;
    while (i < shots.length - 1 && t >= shots[i + 1].t0) i++;
    const s = shots[i];
    const k = smoothstep(0.62, 1.25, stage.width / Math.max(1, stage.height));
    cs.pos.copy(s.P[0]).lerp(s.L[0], k);
    cs.tgt.copy(s.P[1]).lerp(s.L[1], k);
    cs.fov = lerp(s.P[2], s.L[2], k);
    cs.roll = 0;
    s.move?.(t - s.t0, cs);
    cam.position.copy(cs.pos);
    cam.fov = cs.fov;
    cam.lookAt(cs.tgt);
    if (cs.roll) cam.rotateZ(cs.roll);
    back.subVectors(cs.tgt, cs.pos).setY(0).normalize();
    light.uRimDir.value.set(back.x, 0.35, back.z).normalize();
  };

  // Jin-woo: idle -> reach (palm up) -> the hand lifts to shoulder height as the army rises
  const pinch: Pose = { fiR: [0, 0, 0.95], thR: [0, 0, -0.45] };
  const lift: Pose = { uaR: [-0.5, 0.08, 0.0], faR: [0.06, 0, 0], head: [-0.12, 0, 0], neck: [-0.05, 0, 0] };
  // Ruler's Authority: the raised hand closes as the held stones come down together, then eases open again
  const grip: Pose = { fiR: [0, 0, 1.2], thR: [0, 0, -0.55], uaR: [0.07, 0, 0], faR: [0.05, 0, 0] };
  // the stoic beat: a faint nod to the kneeling army (and the camera)
  const nod: Pose = { head: [0.17, 0, 0], neck: [0.05, 0, 0] };
  const slamAt = HIT + RUBBLE.slam;
  const NOD_AT = 14.08;
  const step2 = (x: number) => (params.reduced ? x : Math.floor(x * 12) / 12);
  const posing = (t: number) => {
    if (t < 1.85) {
      jw.rig.apply(POSES.idle, null, 0);
      return;
    }
    const fr = fingerRelax(clamp(Math.floor(((t - 1.85) / 0.833) * 13) / 13));
    const lk = ease.inOutSine(clamp(Math.floor(((t - 8.31) / 3.59) * 8 * 3.59) / (8 * 3.59)));
    let p = addPose(POSES.arise, pinch, 1 - fr);
    p = addPose(p, lift, lk);
    const gIn = ease.outCubic(step2(clamp((t - (slamAt - 0.12)) / 0.14)));
    const gOut = ease.inOutSine(step2(clamp((t - (slamAt + 0.6)) / 0.6)));
    p = addPose(p, grip, gIn * (1 - gOut));
    p = addPose(p, nod, nodK(t));
    jw.rig.apply(p, null, 0);
  };
  const nodK = (t: number) => {
    const u = t - NOD_AT;
    if (u <= 0 || u >= 0.85) return 0;
    return u < 0.24 ? ease.inOutSine(step2(u / 0.24)) : u < 0.42 ? 1 : 1 - ease.inOutSine(step2((u - 0.42) / 0.43));
  };
  // his eyes soften for a moment as he nods: the glow eases down and comes back before the window settles
  const eyeAt = (t: number) => 1 - 0.42 * smoothstep(NOD_AT - 0.1, NOD_AT + 0.3, t) * (1 - smoothstep(NOD_AT + 0.9, NOD_AT + 1.6, t));

  const grade = stage.grade;
  const baseBloom = stage.bloom.intensity;
  const ignitePeak = HIT + ARISE_AT.ignite + IGNITE.dur;
  const frameAt = (t: number) => {
    if (params.capture) (window as unknown as { __ariseLT?: number }).__ariseLT = t;
    placeCamera(t);
    shake(cam, t, HIT);
    posing(t);
    if (t > NOD_AT - 0.2) jw.eyes.setGlow(eyeAt(t));
    arise.at(t - HIT, t);
    // the one soft lilac swell (<= 4.5 % mix, single bump), then back to the neutral flash colour
    grade.u('flashAmount').value = arise.flash;
    (grade.u('flashColor').value as THREE.Color).copy(arise.flash > 0 ? arise.FLASH_COLOR : WHITE);
    grade.u('saturation').value = arise.saturation;
    // pure black only for the last 300 ms before the hit (hush)
    const hush = t > HIT - 0.3 && t < HIT ? 0.65 : 0;
    grade.u('fade').value = hush;
    // darker grade once the army stands in the fog; eases back to neutral under the result window
    const dark = smoothstep(9.9, 11.2, t) * (1 - smoothstep(15.1, 15.95, t));
    grade.u('gammaV').value = lerp(1, 0.86, dark);
    const over = t < ignitePeak ? smoothstep(ignitePeak - 0.2, ignitePeak, t) : 1 - clamp((t - ignitePeak) / IGNITE.settle);
    stage.bloom.intensity = baseBloom * (1 + IGNITE.overshoot * over);
  };

  return { frameAt };
}
