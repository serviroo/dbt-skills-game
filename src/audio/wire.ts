import { windowSounds, type WindowKind } from '../ui/lantern-window';
import type { AudioEngine } from './engine';

/** Hooks the Lantern window open/close/tap sounds to the engine. Like every cue, the chime lands SCORE.leadSec after the
 *  line appears. */
export function wireWindowSounds(eng: AudioEngine) {
  windowSounds.open = (kind: WindowKind) => {
    if (kind === 'reward') eng.play('reward_chime');
    else eng.play('ui_open', { detune: kind === 'level' ? 500 : 0 });
  };
  windowSounds.close = () => eng.play('ui_close');
  windowSounds.tap = () => eng.play('ui_tap');
}
