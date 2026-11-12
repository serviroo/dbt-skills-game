import type { Moment } from './moment';
import type { Music } from './music';
import { soon } from './param';
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
  const v = new Voice(host.lib, 0, host.dest, { held: true }, host.seed);
  const g = v.gain(0, v.dry);
  v.at(g.gain).setValueAtTime(0, 0);
  v.at(g.gain).linearRampToValueAtTime(0.065, 0.03);
  const end = 120;
  v.noise('brown', 0, end + 0.05, v.filt('lowpass', 240, 0.7, g));
  v.noise('pink', 0, end + 0.05, v.gain(0.08, v.filt('highpass', 1800, 0.7, g)));
  const { moment } = host;
  v.prepare(moment);
  const stopped = host.takeHush().map((voice) => ({ voice, finish: voice.prepareStop(moment, 0.02) }));
  host.prepareBuses();
  let finishNew: ((at: number) => boolean) | undefined;
  if (to !== undefined) {
    moment.add(to - 0.01, () => g.gain.setValueAtTime(0.065, to - 0.01), g.gain, { absolute: true });
    moment.add(to + 0.02, () => g.gain.linearRampToValueAtTime(0, to + 0.02), g.gain, { absolute: true });
    finishNew = v.prepareStop(moment, 0.02, { time: to + 0.02, absolute: true });
  }
  const hush = host.music.prepareHush(moment);
  moment.prepare();
  const at = from ?? soon(host.lib.ctx);
  moment.place(at);
  v.open(at);
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
