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
  /** what the shared renderer still held on the GPU after the last scene left (all zero when it cleaned up) */
  left?: { geometries: number; textures: number; programs: number };
}

const w = window as unknown as { __scenes?: SceneStats };
export const sceneStats: SceneStats = (w.__scenes ??= { live: 0, contexts: 0, frames: 0 });
