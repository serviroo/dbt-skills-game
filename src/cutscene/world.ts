import * as THREE from 'three';
import type { Stage } from '../core/stage';
import { loadHero, type Character } from '../scene/character/hero';
import { light, outlineShared } from '../scene/toon';
import { buildVoid } from '../scene/environment';
import { radialGlowTexture } from '../scene/glow';

/* Optional modules built in parallel: loaded only if their files exist. */
const gateMods = import.meta.glob('../scene/gate/gate.ts');
const envMods = import.meta.glob('../scene/gate/env.ts');
const auraMods = import.meta.glob('../scene/fx/aura.ts');
const awakenMods = import.meta.glob('../scene/awaken/index.ts');
const chestMods = import.meta.glob('../scene/chest/chest.ts');

async function opt<T>(mods: Record<string, () => Promise<unknown>>): Promise<T | null> {
  const k = Object.keys(mods)[0];
  if (!k) return null;
  try {
    return (await mods[k]()) as T;
  } catch (e) {
    console.warn('optional module failed', k, e);
    return null;
  }
}

export interface GateLike {
  group: THREE.Object3D;
  openAt(t: number): void;
  update(t: number, dt: number): void;
  setDim(v: number): void;
  light: { color: THREE.Color; intensity: number };
}
export interface AuraLike {
  group: THREE.Object3D;
  setIntensity(v: number): void;
  update(t: number, dt?: number): void;
}
export interface AwakenLike {
  group: THREE.Object3D;
  setPool(p: number): void;
  setVortex(p: number): void;
  setSmoke(p: number): void;
  setRise(p: number): void;
  setIgnite(p: number): void;
  setKneel(p: number): void;
  update(t: number, dt?: number): void;
  shake?: (camera: THREE.Camera, t: number, t0: number) => void;
}
export interface ChestLike {
  group: THREE.Object3D;
  setReveal(p: number): void;
  setCharge(c: number): void;
  setOpen(p: number): void;
  update(t: number, dt?: number): void;
  /** the closed chest's box in the group's space */
  bounds?: THREE.Box3;
}

export interface World {
  stage: Stage;
  cam: THREE.PerspectiveCamera;
  jw: Character;
  gate: GateLike;
  gatePos: THREE.Vector3;
  aura: AuraLike | null;
  awaken: AwakenLike | null;
  chest: ChestLike | null;
  modules: { awaken: any; chest: any; fx: any };
  envGroup: THREE.Object3D;
}

/** Stand-in gate: three additive glows, opened with the measured two-stage curve. */
function standInGate(): GateLike {
  const g = new THREE.Group();
  const mk = (c: number, s: number) =>
    new THREE.Sprite(new THREE.SpriteMaterial({ map: radialGlowTexture(), color: new THREE.Color(c).multiplyScalar(s), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const core = mk(0xdff8ff, 5), mid = mk(0x3aa8e8, 1.3), halo = mk(0x5a2fc0, 0.55);
  g.add(halo, mid, core);
  let openT = 1e9, dim = 1;
  const prog = [0, 0.09, 0.17, 0.26, 0.39, 0.54, 0.6, 0.63, 0.68, 0.78, 0.88, 0.93, 0.97, 1];
  const L = { color: new THREE.Color(0x6fc6ff), intensity: 0 };
  return {
    group: g,
    openAt: (t) => (openT = t),
    setDim: (v) => (dim = v),
    light: L,
    update: (t) => {
      const lt = t - openT;
      let p = 0;
      if (lt > 0) {
        const f = Math.min(prog.length - 1, (lt / 0.433) * (prog.length - 1));
        const i = Math.floor(f);
        p = i >= prog.length - 1 ? 1 : prog[i] + (prog[i + 1] - prog[i]) * (f - i);
      }
      const flick = 0.95 + 0.05 * Math.sin(t * 9.0);
      core.scale.set(0.05 + 0.4 * p, 0.6 + 4.6 * Math.min(1, p * 3 + (lt > 0 ? 0.3 : 0)), 1);
      mid.scale.set(0.2 + 1.6 * p, 2 + 4.5 * p, 1);
      halo.scale.set(0.5 + 5.5 * p, 3 + 6 * p, 1);
      for (const s of [core, mid, halo]) s.material.opacity = (lt > 0 ? 1 : 0) * dim * flick;
      L.intensity = p * dim;
    },
  };
}

export async function buildWorld(stage: Stage): Promise<World> {
  const scene = stage.scene;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.03, 400);
  stage.setCamera(cam);

  const envMod = await opt<{ buildDungeonEnv: () => { group: THREE.Object3D; update?: (t: number, dt: number) => void; bindGate?: (g: unknown) => void } }>(envMods);
  let envGroup: THREE.Object3D;
  let envUpdate: ((t: number, dt: number) => void) | undefined;
  let envBind: ((g: unknown) => void) | undefined;
  if (envMod?.buildDungeonEnv) {
    const env = envMod.buildDungeonEnv();
    envGroup = env.group;
    envUpdate = env.update?.bind(env);
    envBind = env.bindGate?.bind(env);
  } else {
    const env = buildVoid();
    env.skyMat.uniforms.uGlow.value = 0.15;
    env.groundMat.uniforms.uSheenStrength.value = 1.0;
    env.groundMat.uniforms.uSheenPos.value.set(0, 0, -4);
    envGroup = env.group;
  }
  scene.add(envGroup);

  const gateMod = await opt<{ buildGate: () => GateLike }>(gateMods);
  const gate = gateMod?.buildGate ? gateMod.buildGate() : standInGate();
  const gatePos = new THREE.Vector3(0, 2.2, -6.5);
  if (!gateMod) gate.group.position.copy(gatePos);
  else gate.group.position.set(gatePos.x, 0, gatePos.z);
  scene.add(gate.group);
  envBind?.(gate);

  const jw = await loadHero(stage);
  scene.add(jw.group);
  jw.group.visible = false;

  const fx = await opt<{ createAura: (o: { target: THREE.Object3D; height: number; radius: number; count?: number }) => AuraLike }>(auraMods);
  const aura = fx?.createAura ? fx.createAura({ target: jw.group, height: 1.9, radius: 0.45 }) : null;
  if (aura) {
    scene.add(aura.group);
    aura.setIntensity(0);
  }
  const awakenMod = await opt<{ buildAwaken: (stage: Stage, jw: Character) => AwakenLike; shake?: AwakenLike['shake'] }>(awakenMods);
  const awaken = awakenMod?.buildAwaken ? awakenMod.buildAwaken(stage, jw) : null;
  if (awaken && !awaken.group.parent) scene.add(awaken.group);
  if (awaken) awaken.group.visible = false;
  const chestMod = await opt<{ buildChest: (...a: unknown[]) => ChestLike }>(chestMods);
  const chest = chestMod?.buildChest ? chestMod.buildChest({ stage, floor: false }) : null;
  if (chest) {
    scene.add(chest.group);
    chest.group.visible = false;
    chest.group.position.set(0, 0, 1.45);
  }

  const tmp = new THREE.Vector3();
  stage.onUpdate((t, dt) => {
    light.uTime.value = t;
    outlineShared.uResolution.value.set(stage.width * stage.dpr, stage.height * stage.dpr);
    gate.update(t, dt);
    envUpdate?.(t, dt);
    // rim light comes from the gate behind him
    tmp.subVectors(gatePos, new THREE.Vector3(0, 1.3, 0)).normalize();
    light.uRimDir.value.set(tmp.x, tmp.y + 0.15, tmp.z).normalize();
    light.uRimStrength.value = 0.6 + 2.2 * Math.min(1, gate.light.intensity);
    if ((gate.light as { color?: THREE.Color }).color) light.uRimColor.value.copy(gate.light.color);
    aura?.update(t, dt);
    awaken?.update(t, dt);
    chest?.update(t, dt);
  });

  return { stage, cam, jw, gate, gatePos, aura, awaken, chest, modules: { awaken: awakenMod, chest: chestMod, fx }, envGroup };
}

/** Cinematic lighting preset for the character beats. */
export function characterLighting() {
  light.uKeyStrength.value = 0.22;
  light.uKeyDir.value.set(-0.5, 0.45, 0.75).normalize();
  light.uKeyColor.value.set(0x8fa8d8);
  light.uAmbTop.value.set(0x121830);
  light.uAmbBottom.value.set(0x120a26);
  light.uGroundGlow.value.set(0x2a1660);
  light.uGroundGlowStrength.value = 0.6;
  light.uFogDensity.value = 0.03;
}
