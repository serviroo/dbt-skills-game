export interface CueHandle {
  stop(at?: number, ramp?: number): void;
  readonly end: number;
}

export interface UserLevels {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

export interface SoundEvent {
  t: number;
  cue: string;
  opts?: any;
  loop?: { name: string; level?: number; until?: number };
}

export interface RenderOpts {
  step?: number;
  ahead?: number;
  musicAhead?: number;
  onStep?: (t: number) => void;
}
