import type { Lib } from './voice';
import type { Moment } from './moment';

export type Section = 'intro' | 'windows' | 'silhouette' | 'awaken' | 'reward' | 'end' | 'calm';
export const SECTIONS: Section[] = ['intro', 'windows', 'silhouette', 'awaken', 'reward', 'end', 'calm'];

export interface SectionOpts {
  at?: number;
  /** Fade of the outgoing section; defaults to the crossfade. Use ~0.04 for a hard audio cut. */
  fadeOut?: number;
  /** awaken only, with `at`: context time of the hit (default start + 4.86 s, as in the keyframe table). */
  hitAt?: number;
  /** awaken only: context time of the stand-up, the loudest moment (default hitAt + 7.04 s). */
  standAt?: number;
}

export interface MusicHost {
  lib: Lib;
  hush(from: number, to: number): void;
  seed(): number;
  prepareSection?(name: Section, moment: Moment): (at: number) => void;
}
