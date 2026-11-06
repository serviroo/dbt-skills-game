import { soon } from '../../../src/audio/param';
import { openBuilt, type Voice } from '../../../src/audio/voice';

export function playOnce(ctx: AudioContext, voice: Voice) {
  voice.openInTime(soon(ctx));
}

export function playLater(ctx: AudioContext, voice: Voice) {
  void voice.openInTime(soon(ctx) + 1);
}

export function playKept(ctx: AudioContext, build: () => { voice: Voice }) {
  const { at } = openBuilt(ctx, undefined, build);
  return at;
}

export function playChecked(ctx: AudioContext, voice: Voice) {
  if (!voice.openInTime(soon(ctx))) return null;
  return voice;
}
