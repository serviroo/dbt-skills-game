import { soon } from '../../../src/audio/param';
import { openPrebuilt } from '../../../src/audio/prebuild';
import type { Voice } from '../../../src/audio/voice';

export function playOnce(ctx: AudioContext, voice: Voice) {
  voice.openInTime(soon(ctx));
}

export function playLater(ctx: AudioContext, voice: Voice) {
  void voice.openInTime(soon(ctx) + 1);
}

export function playKept(ctx: AudioContext, build: () => { voice: Voice }) {
  const { at } = openPrebuilt(undefined, { make: build, seed: () => 1 });
  return at;
}

export function playChecked(ctx: AudioContext, voice: Voice) {
  if (!voice.openInTime(soon(ctx))) return null;
  return voice;
}

export function playUnchecked(voice: Voice, used: boolean) {
  window.open('https://example.com');
  used || voice.openInTime();
  used && voice.openInTime();
  return voice.openInTime();
}

export function playComputed(voice: Voice) {
  return voice['openInTime']();
}

export class OtherOpening {
  static openBuilt(voice: Voice) {
    return voice.openInTime();
  }
}
