import { Moment } from './moment';
import { renderedPoint, soon } from './param';
import { FPS } from '../motion/tokens';
import type { Voice } from './voice';

export function inTime<T extends { voice: Voice }>(build: (own: Moment) => T, when: () => number) {
  let tries = 0;
  let lastPlacing = 0;
  for (;;) {
    const own = new Moment();
    const built = build(own);
    const { voice } = built;
    voice.wet.gain.value = 0;
    voice.dry.gain.value = 0;
    own.prepare();
    tries++;
    const at = tries < 3 ? when()
      : Math.max(when(), renderedPoint(voice.ctx) + 1 / FPS + lastPlacing * 2 ** (tries - 3));
    const missed = () => voice.ctx.state === 'running' && renderedPoint(voice.ctx) > at;
    const start = performance.now();
    own.place(at, missed);
    lastPlacing = (performance.now() - start) / 1000;
    voice.open(at, false);
    if (!missed()) {
      voice.confirm();
      voice.wet.gain.setValueAtTime(voice.inputLevel, at);
      voice.dry.gain.setValueAtTime(voice.inputLevel, at);
      return { built, at };
    }
    voice.discard(soon(voice.ctx));
  }
}
