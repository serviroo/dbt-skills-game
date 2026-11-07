import { Voice as Sound, type Lib } from '../../../src/audio/voice';

declare const lib: Lib;
declare const output: AudioNode;

export class Playback {
  realtime: boolean;
  sounding = new Set<Sound>();

  constructor(ctx: BaseAudioContext) {
    this.realtime = typeof OfflineAudioContext === 'undefined' || !(ctx instanceof OfflineAudioContext);
  }

  play() {
    const cue = new Sound(lib, 0, output);
    if (this.realtime) this.sounding.add(cue);
  }

  renamed() {
    const sound = new Sound(lib, 0, output);
    const online = this.realtime;
    online && this.sounding.add(sound);
  }

  everyContext() {
    const cue = new Sound(lib, 0, output);
    this.sounding.add(cue);
    if (this.realtime) setTimeout(() => cue.out.disconnect(), 1000);
  }
}

export class Capture {
  offline = false;
  sources = new Set<Sound>();

  constructor(ctx: BaseAudioContext) {
    this.offline = ctx instanceof OfflineAudioContext;
  }

  play(ctx: BaseAudioContext) {
    const source = new Sound(lib, 0, output);
    if (ctx instanceof AudioContext) this.sources.add(source);
    return this.offline ? this.sources.add(source) : undefined;
  }
}
