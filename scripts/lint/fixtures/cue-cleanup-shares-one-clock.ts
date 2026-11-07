import { Voice as Sound, type Lib } from '../../../src/audio/voice';

declare const lib: Lib;
declare const output: AudioNode;
declare const ctx: AudioContext;
declare const cleanup: { add(sound: Sound): void };

class Playback {
  play() {
    const sound = new Sound(lib, 0, output);
    const clock = ctx.createConstantSource();
    clock.onended = () => sound.out.disconnect();
    clock.start();
    clock.stop(sound.end + 4);
  }

  shared() {
    const sound = new Sound(lib, 0, output);
    cleanup.add(sound);
  }
}

const play = () => {
  const sound = new Sound(lib, 0, output);
  const clock = ctx.createConstantSource();
  clock.onended = () => sound.out.disconnect();
};

const arm = () => ctx.createConstantSource();

export { Playback, play, arm };
