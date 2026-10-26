/**
 * What the companion's 3D scenes are doing, readable as `window.__scenes` (the E2E checks read it): how many scenes
 * are on screen now, how many WebGL contexts the shared renderer holds, and how many frames have been drawn.
 */
export interface SceneStats {
  live: number;
  contexts: number;
  frames: number;
  /** the beat the last frame was drawn for */
  last?: { kind: string; e: number; dur: number; done: boolean; still: boolean };
  /** the pixel ratio the last frame was drawn at: below the device's own when the device couldn't keep up */
  dpr?: number;
  /** the pixel ratio this visit keeps for its scenes after sustained slowness; null until then */
  kept?: number | null;
  /** what the shared renderer still held on the GPU after the last scene left (all zero when it cleaned up) */
  left?: { geometries: number; textures: number; programs: number };
}

/** The name of the error the renderer throws when this device can't make a WebGL 2 context. */
export const NO_WEBGL = 'NoWebGL';

const w = window as unknown as { __scenes?: SceneStats };
export const sceneStats: SceneStats = (w.__scenes ??= { live: 0, contexts: 0, frames: 0 });
