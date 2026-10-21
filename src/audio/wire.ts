import { windowSounds, type WindowKind } from '../ui/lantern-window';
import type { AudioEngine } from './engine';

/** Hooks the Lantern window open/close/tap sounds to the engine. The chime lands 1 frame after the line appears. */
export function wireWindowSounds(eng: AudioEngine) {
  windowSounds.open = (kind: WindowKind) => {
    const at = eng.now + 1 / 60;
    if (kind === 'reward') eng.play('reward_chime', { at });
    else eng.play('ui_open', { at, detune: kind === 'level' ? 500 : 0 });
  };
  windowSounds.close = () => eng.play('ui_close');
  windowSounds.tap = () => eng.play('ui_tap');
}
