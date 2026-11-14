import type { Moment } from './moment';
import type { Music } from './music';
import { soon } from './param';
import { inTime } from './in-time';
import { Voice, type Lib } from './voice';

export function hushMoment(
  host: {
    lib: Lib; dest: AudioNode; seed: number; moment: Moment; music: Music;
    prepareBuses(): void;
    takeHush(): Voice[]; finishOld(voice: Voice): void; finishNew(voice: Voice): void;
    setHush(voice: Voice | null): void;
  },
  from?: number, to?: number,
) {
  const { moment } = host;
  const stopped = host.takeHush().map((voice) => ({ voice, finish: voice.prepareStop(moment, 0.02) }));
  host.prepareBuses();
  const hush = host.music.prepareHush(moment);
  moment.prepare();
  const { built: { voice: v, finishNew }, at } = inTime((own) => {
    const voice = new Voice(host.lib, 0, host.dest, { held: true }, host.seed);
    const g = voice.gain(0, voice.dry);
    voice.at(g.gain).setValueAtTime(0, 0);
    voice.at(g.gain).linearRampToValueAtTime(0.065, 0.03);
    const end = 120;
    voice.noise('brown', 0, end + 0.05, voice.filt('lowpass', 240, 0.7, g));
    voice.noise('pink', 0, end + 0.05, voice.gain(0.08, voice.filt('highpass', 1800, 0.7, g)));
    voice.prepare(own);
    let finishNew: ((at: number) => boolean) | undefined;
    if (to !== undefined) {
      own.add(to - 0.01, () => g.gain.setValueAtTime(0.065, to - 0.01), g.gain, { absolute: true });
      own.add(to + 0.02, () => g.gain.linearRampToValueAtTime(0, to + 0.02), g.gain, { absolute: true });
      finishNew = voice.prepareStop(own, 0.02, { time: to + 0.02, absolute: true });
    }
    return { voice, finishNew };
  }, () => Math.max(from ?? 0, soon(host.lib.ctx)));
  moment.place(at);
  for (const { voice, finish } of stopped) {
    finish(at);
    host.finishOld(voice);
  }
  if (finishNew) {
    finishNew(at);
    host.finishNew(v);
  }
  host.setHush(to === undefined ? v : null);
  for (const finish of hush) finish(at);
}
