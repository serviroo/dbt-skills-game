import { uiNow } from '../ui/anim';
import type { AudioLike } from './director';

export interface AudioEvent {
  t: number;
  kind: 'play' | 'stop' | 'bed' | 'charge' | 'music' | 'duck' | 'hush' | 'unhush';
  name: string;
  args: number[];
  opts?: Record<string, number>;
}

/**
 * Records every audio call with its stage time, for deterministic captures.
 * The capture script renders these events offline with the audio engine and muxes the result.
 */
export function loggingAudio(inner?: AudioLike): AudioLike & { log: AudioEvent[] } {
  const log: AudioEvent[] = [];
  const rec = (kind: AudioEvent['kind'], name: string, args: number[] = [], opts?: Record<string, number>) => log.push({ t: uiNow(), kind, name, args, opts });
  (window as unknown as { __audioLog: AudioEvent[] }).__audioLog = log;
  return {
    log,
    play(cue, opts) {
      rec('play', cue, [], opts);
      const h = inner?.play(cue, opts) as { stop?(at?: number, ramp?: number): void } | undefined;
      return {
        stop: (at?: number, ramp = 0.03) => {
          rec('stop', cue, [ramp]);
          h?.stop?.(at, ramp);
        },
      };
    },
    bed(name) {
      const b = inner?.bed?.(name);
      return {
        level: (v: number, ramp = 0) => {
          rec('bed', name, [v, ramp]);
          b?.level(v, ramp);
        },
        stop: (ramp = 0) => {
          rec('bed', name, [0, ramp]);
          b?.stop(ramp);
        },
      };
    },
    chargeLoop() {
      const c = inner?.chargeLoop?.();
      rec('charge', 'start');
      return {
        set: (v: number) => {
          rec('charge', 'set', [v]);
          c?.set(v);
        },
        release: () => {
          rec('charge', 'release');
          c?.release();
        },
        stop: () => {
          rec('charge', 'stop');
          c?.stop();
        },
      };
    },
    music: {
      to(section: string, fade = 1, opts?: Record<string, number>) {
        rec('music', section, [fade], opts);
        inner?.music?.to(section, fade, opts);
      },
      stop(fade = 1) {
        rec('music', 'stop', [fade]);
        inner?.music?.stop?.(fade);
      },
    },
    hush(from?: number, to?: number) {
      rec('hush', 'master', to !== undefined ? [to] : []);
      inner?.hush?.(from, to);
    },
    unhush() {
      rec('unhush', 'master');
      inner?.unhush?.();
    },
    duck(db: number, ramp: number) {
      rec('duck', 'master', [db, ramp]);
      inner?.duck?.(db, ramp);
    },
  };
}
