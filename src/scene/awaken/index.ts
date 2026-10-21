import * as THREE from 'three';
import type { Character } from '../character/hero';
import { light } from '../toon';
import { clamp, smoothstep } from '../../core/math';
import { params } from '../../core/params';
import { buildPool, buildSmallPools } from './pool';
import { buildVortex, VORTEX_DUR } from './vortex';
import { buildSmoke } from './smoke';
import { buildSoldiers, HERO_LAYOUT, WIN } from './soldiers';
import { buildAwakenWord, WORD_DUR } from './word';
import { ATMOS } from './materials';
import { buildVesper, VESPER } from './vesper';
import { buildRubble } from './rubble';

import { shake } from './shake';
export { shake, shakeOffset, SHAKE } from './shake';
export { WORD_DUR } from './word';
export { IGNITE } from './soldiers';
export { VESPER } from './vesper';
export { RUBBLE } from './rubble';

/**
 * Nominal length (seconds) of each 0..1 setter, and the default start times relative to the HIT
 * (REFERENCE beat 5: hit at 40.83 s; AWAKEN word at 39.48; vortex 41.60; smoke 43.44; rise 44.31; ignition 44.98;
 * stand 47.90; smoke rolls in 49.00; result window 49.84). Kneel is ours (after the stand).
 */
export const AWAKEN_DUR = {
  word: WORD_DUR,
  pool: 1.0,
  vortex: VORTEX_DUR,
  smoke: 0.87,
  rise: WIN.rise,
  ignite: WIN.ignite,
  roll: 2.5,
  kneel: WIN.kneel,
};
export const AWAKEN_AT = {
  word: -1.35,
  hit: 0,
  pool: 0,
  vortex: 0.77,
  smoke: 2.61,
  rise: 3.48,
  ignite: 4.15,
  stand: 7.07,
  roll: 8.17,
  result: 9.01,
  kneel: 8.35,
};

export interface AwakenOpts {
  /** Where the pool opens (xz). Default: in front of his reaching hand. */
  poolCenter?: THREE.Vector2;
  poolRadius?: number;
  /** Point the soldiers turn toward as they rise and kneel (default: the audience, +z). */
  focus?: THREE.Vector3;
  /** Let AWAKEN drive the shared ground-glow light (light.uGroundGlow*). Default true. */
  driveLight?: boolean;
  /** Build the on-screen AWAKEN word (DOM, driven by setWord). Default false: the director has its own. */
  word?: boolean;
  /** Draw the pool's own stone floor. Default: only when the scene has no dungeon env floor. */
  ownFloor?: boolean;
}

export function buildAwaken(scene: THREE.Scene, hero: Character, opts: AwakenOpts = {}) {
  const group = new THREE.Group();
  group.name = 'awaken';
  const anchor = hero.group.position.clone();
  const poolCenter = opts.poolCenter ?? new THREE.Vector2(anchor.x, anchor.z + 0.6);
  const rMax = opts.poolRadius ?? 10;

  const pool = buildPool(rMax, poolCenter);
  pool.uniforms.uFeet.value.set(anchor.x, anchor.z);
  group.add(pool.mesh);
  // inside the dungeon set the env floor (with its gate reflection) is the ground; the pool's own lighter stone floor only
  // shows from the hit (so the dark disc reads, f0237) until the army rises
  const ownFloor = opts.ownFloor ?? !scene.getObjectByName('dungeon');

  const soldiers = buildSoldiers({ focus: opts.focus, lord: anchor });
  group.add(soldiers.group);

  // The raised hand lifts the loose stones around the risen soldiers; Vesper glides across the gate once they stand
  const rubble = buildRubble([
    { x: anchor.x, z: anchor.z, r: 0.75 },
    { x: 0, z: 1.45, r: 1.1 },
    ...HERO_LAYOUT.map((h) => ({ x: h.x, z: h.z, r: 0.55 })),
  ]);
  group.add(rubble.mesh);
  const vesper = buildVesper();
  group.add(vesper.mesh);

  const small = buildSmallPools(soldiers.smokeList.map((s, i) => ({ x: s.x, z: s.z, r: s.hero ? 0.95 : 0.85, seed: (i * 0.618) % 1 })));
  group.add(small.mesh);

  const vortex = buildVortex();
  vortex.group.position.copy(anchor);
  group.add(vortex.group);

  const smoke = buildSmoke(soldiers.smokeList, anchor);
  group.add(smoke.mesh);

  const word = opts.word ? buildAwakenWord() : null;

  scene.add(group);

  const s = { pool: 0, vortex: 0, smoke: 0, rise: 0, ignite: 0, kneel: 0, roll: 0, word: 0, linger: 0 };
  let flash = 0;
  let saturation = 1;
  const drive = opts.driveLight !== false;
  const groundGlow = new THREE.Color();
  const cBlue = new THREE.Color(0x1d3a9a), cCyan = new THREE.Color(0x2c64ff), cViolet = new THREE.Color(0x5a2fc0);

  const update = (t: number) => {
    if (!group.visible) {
      word?.set(0);
      return;
    }
    pool.set(s.pool);
    pool.uniforms.uTime.value = t;
    // once the army rises the lit ring sinks to a low glow and the floor darkens, so the fog and the eyes carry the frame
    const atm = smoothstep(0.04, 0.45, s.rise);
    ATMOS.uAtmos.value = atm;
    const settle = 1 - 0.78 * smoothstep(0, 0.35, s.rise);
    pool.uniforms.uLit.value = (pool.uniforms.uLit.value as number) * settle;
    pool.uniforms.uRim.value = (pool.uniforms.uRim.value as number) * (0.45 + 0.55 * settle);
    pool.uniforms.uFloorGain.value = 1.7 * (1 - 0.5 * atm);
    pool.uniforms.uFloor.value = ownFloor ? 1 : s.pool > 0 ? 1 - smoothstep(0.0, 0.3, s.rise) : 0;
    vortex.set(s.vortex);
    pool.uniforms.uBoost.value = vortex.level * 0.7;
    // the lit ring floor sinks while the flames burn, so they read against a dark ground (f0893), not a flat blue plane
    pool.uniforms.uLit.value = (pool.uniforms.uLit.value as number) * (1 - 0.45 * clamp(vortex.level));

    soldiers.state.rise = s.rise;
    soldiers.state.ignite = s.ignite;
    soldiers.state.kneel = s.kneel;
    soldiers.update(t);

    // small pools: open just before each soldier breaks the surface, ripple while emerging, shrink to a shadow
    const a = small.attr.array as Float32Array;
    for (let i = 0; i < soldiers.smokeList.length; i++) {
      const r = soldiers.smokeRise[i];
      const pre = s.rise > 0 ? 1 : 0;
      const open = pre * (r > 0 ? 0.65 + 0.35 * smoothstep(0, 0.12, r) - 0.25 * smoothstep(0.85, 1.0, r) : 0);
      a[i * 4] = open;
      a[i * 4 + 1] = r > 0 ? (1 - smoothstep(0.7, 1.0, r)) * 0.9 + 0.1 : 0;
      a[i * 4 + 2] = r > 0 && r < 0.9 ? (t * 0.9 + i * 0.37) % 1 : 0;
    }
    small.attr.needsUpdate = true;
    small.mat.uniforms.uTime.value = t;

    smoke.setSoldiers(soldiers.smokeRise, soldiers.smokeY);
    smoke.uniforms.uTime.value = t;
    smoke.uniforms.uBurst.value = s.smoke;
    smoke.uniforms.uRoll.value = s.roll;
    smoke.uniforms.uMist.value = smoothstep(0, 0.25, s.rise);
    smoke.uniforms.uLinger.value = s.linger;
    smoke.uniforms.uAspect.value = typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 1;
    // one soft lilac swell replaces the reference's 1.7 s strobe: a single sine bump, peak at 45 % of the smoke
    const sw = s.smoke > 0 && s.smoke < 1 ? Math.pow(Math.sin(Math.PI * clamp((s.smoke - 0.12) / 0.8)), 2) : 0;
    smoke.uniforms.uSwell.value = sw;
    flash = sw * 0.009;
    // AgX desaturates the vortex blue; a small beat-local grade lift keeps it electric (f0905). More clips red to 0 and
    // turns every blue teal
    saturation = 1 + 0.2 * clamp(vortex.level);

    word?.set(s.word);

    if (drive && s.pool > 0) {
      const lit = pool.uniforms.uLit.value as number;
      const v = vortex.level;
      groundGlow.copy(cBlue).multiplyScalar(lit * 0.5);
      groundGlow.lerp(cCyan, clamp(v)).multiplyScalar(1);
      if (sw > 0) groundGlow.lerp(cViolet, sw * 0.4);
      light.uGroundGlow.value.copy(groundGlow);
      light.uGroundGlowStrength.value = lit * 0.22 + v * 0.16 + sw * 0.12;
    }
  };

  return {
    group,
    pool,
    soldiers,
    vortex,
    smoke,
    word,
    rubble,
    vesper,
    /** 0..1 over AWAKEN_DUR.pool: disc pops at 26 %, holds 300 ms, stepped expansion, interior lights, rim settles. */
    setPool: (p: number) => void (s.pool = clamp(p)),
    /** 0..1 over AWAKEN_DUR.vortex (1.84 s). */
    setVortex: (p: number) => void (s.vortex = clamp(p)),
    /** 0..1 over AWAKEN_DUR.smoke (870 ms): violet shard burst plus the one soft lilac swell. */
    setSmoke: (p: number) => void (s.smoke = clamp(p)),
    /** 0..1 over AWAKEN_DUR.rise: soldiers rise head-first in a staggered wave. */
    setRise: (p: number) => void (s.rise = clamp(p)),
    /** 0..1 over AWAKEN_DUR.ignite: seams ignite (467 ms bezier per soldier, cores +130 ms, eyes +260 ms), in a wave. */
    setIgnite: (p: number) => void (s.ignite = clamp(p)),
    /** 0..1 over AWAKEN_DUR.kneel: the army kneels toward the focus (the camera). */
    setKneel: (p: number) => void (s.kneel = clamp(p)),
    /** 0..1 over AWAKEN_DUR.roll: grey-blue smoke rolls in from the left. */
    setRoll: (p: number) => void (s.roll = clamp(p)),
    /** 0..1: low violet smoke left on the floor after the burst. */
    setLinger: (p: number) => void (s.linger = clamp(p)),
    /** 0..1 over AWAKEN_DUR.word: the on-screen AWAKEN word. */
    setWord: (p: number) => void (s.word = clamp(p)),
    update,
    /** Convenience: drive everything from seconds since the hit using AWAKEN_AT / AWAKEN_DUR, then update. */
    at(tHit: number, t: number) {
      const P = (k: keyof typeof AWAKEN_DUR) => clamp((tHit - (AWAKEN_AT as Record<string, number>)[k]) / AWAKEN_DUR[k]);
      s.word = tHit > AWAKEN_AT.word && tHit < AWAKEN_AT.word + AWAKEN_DUR.word ? P('word') : 0;
      s.pool = P('pool');
      s.vortex = tHit < AWAKEN_AT.vortex + AWAKEN_DUR.vortex ? P('vortex') : 0;
      s.smoke = tHit < AWAKEN_AT.smoke + AWAKEN_DUR.smoke ? P('smoke') : 0;
      s.rise = P('rise');
      s.ignite = P('ignite');
      s.roll = P('roll');
      s.kneel = P('kneel');
      // the burst leaves low violet smoke on the floor that thins out as the army stands
      const sEnd = AWAKEN_AT.smoke + AWAKEN_DUR.smoke;
      s.linger = smoothstep(AWAKEN_AT.smoke + 0.25, sEnd, tHit) * (1 - smoothstep(sEnd + 0.6, sEnd + 3.2, tHit));
      if (tHit < 0) s.pool = 0;
      rubble.set(tHit);
      vesper.set((tHit - VESPER.at) / VESPER.dur, typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 1, t);
      update(t);
    },
    /** Suggested grade flash for the lilac swell (feed stage.grade flashAmount, colour FLASH_COLOR). Peak 0.009: the grade mixes in linear light, so more lifts the blacks to milk. */
    get flash() {
      return flash;
    },
    /** Suggested stage.grade 'saturation' while AWAKEN plays (1 = neutral, peaks ~1.2 during the vortex). */
    get saturation() {
      return saturation;
    },
    FLASH_COLOR: new THREE.Color(0xb9a4ff),
    /** The one camera shake (same as the module export), for directors that call it on the instance. */
    shake,
    heroLayout: HERO_LAYOUT,
    dispose() {
      scene.remove(group);
      soldiers.dispose();
      rubble.dispose();
      vesper.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mm = m.material as THREE.Material | undefined;
        if (mm && !Array.isArray(mm)) mm.dispose();
      });
      word?.dispose();
    },
    reduced: params.reduced,
  };
}

export type Awaken = ReturnType<typeof buildAwaken>;
