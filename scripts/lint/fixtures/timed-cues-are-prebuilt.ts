import { CUES } from '../../../src/audio/cues';
import { openBuilt, Voice, type Lib } from '../../../src/audio/voice';
import { openPrebuilt, Prebuilt } from '../../../src/audio/prebuild';

export function playCue(lib: Lib, dest: AudioNode, cue: string, at: number) {
  return openBuilt(at, () => 1, (seed: () => number) => {
    const voice = new Voice(lib, 0, dest, { held: true }, seed());
    CUES[cue].fn(voice, {});
    return { voice };
  }, 'once', cue);
}

export function openSection(build: (seed: () => number) => { voice: Voice }) {
  return Voice.openBuilt(undefined, () => 1, build, 'continuous', 'section');
}

export function aliases() {
  const { openBuilt: open } = Voice;
  const named = Voice['openBuilt'];
  const quoted = Voice[`openBuilt`];
  return [open, named, quoted];
}

export class Opener {
  static openBuilt(voice: Voice) {
    return voice;
  }
}

export function buildAtTheCall(make: (seed: () => number) => { voice: Voice }) {
  return openPrebuilt(undefined, new Prebuilt(make, () => 1));
}

export function keptCopies(copies: Prebuilt<{ voice: Voice }>) {
  return copies.left;
}

export function builtByTheWindow(make: (seed: () => number) => { voice: Voice }) {
  return openPrebuilt(undefined, { make, seed: () => 1 });
}
