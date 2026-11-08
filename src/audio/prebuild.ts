import { SCORE } from '../motion/tokens';
import { Voice, type ControlledBuild, type Copies } from './voice';

type Built = ControlledBuild & { prepare?: (at: number) => void };

function attempts() {
  let count = 1;
  for (let extra = 0, next = SCORE.leadSec; extra + next <= SCORE.lateSec; count++) {
    [extra, next] = [next, 2 * next + SCORE.leadSec];
  }
  return count;
}

export class Prebuilt<T extends Built> implements Copies<T> {
  private ready: T[] = [];
  private seeds: number[] = [];

  constructor(
    private make: (seed: () => number) => T,
    private nextSeed: () => number,
    readonly kind: Copies<T>['kind'] = 'once',
  ) {
    this.fill();
  }

  get left() {
    return this.ready.length;
  }

  fill() {
    const depth = this.kind === 'once' ? attempts() : 2;
    while (this.ready.length < depth) {
      let index = 0;
      this.ready.push(this.make(() => (this.seeds[index++] ??= this.nextSeed())));
    }
  }

  take() {
    return this.ready.shift();
  }

  discard() {
    for (const copy of this.ready.splice(0)) copy.voice.discard();
  }
}

export function openPrebuilt<T extends Built>(asked: number | undefined, copies: Prebuilt<T>, sound?: string) {
  try {
    return Voice.openBuilt(asked, copies, sound);
  } finally {
    copies.discard();
  }
}
