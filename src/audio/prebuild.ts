import { soon } from './param';
import { RETRIES, Voice, tracking, type ControlledBuild, type Copies, type Lib } from './voice';

type Built = ControlledBuild & { prepare?: (at: number) => void };

export interface Build<T> {
  make: (seed: () => number) => T;
  seed: () => number;
  lib: Lib;
  kind?: Copies<T>['kind'];
}

class Prebuilt<T extends Built> implements Copies<T> {
  private ready: T[] = [];
  private seeds: number[] = [];
  private taken = 0;
  private readonly depth: number;
  readonly kind: Copies<T>['kind'];

  constructor(private build: Build<T>, private ahead: boolean) {
    this.kind = build.kind ?? 'once';
    this.depth = RETRIES.length;
    if (ahead) this.fill();
  }

  get left() {
    return this.ahead ? this.ready.length : this.depth - this.taken;
  }

  fill() {
    try {
      while (this.ready.length < this.depth) this.ready.push(this.copy());
    } catch (err) {
      this.discard();
      throw err;
    }
  }

  private copy() {
    let index = 0;
    const made: Voice[] = [];
    try {
      return tracking(made, () => this.build.make(() => (this.seeds[index++] ??= this.build.seed())));
    } catch (err) {
      for (const voice of made) voice.discard();
      throw err;
    }
  }

  take() {
    if (this.ahead) return this.ready.shift();
    if (this.taken >= this.depth) return undefined;
    this.taken++;
    return this.copy();
  }

  discard() {
    for (const copy of this.ready.splice(0)) copy.voice.discard();
  }
}

export type Spares<T extends Built> = Prebuilt<T>;

export function copiesAhead<T extends Built>(build: Build<T>): Spares<T> {
  return new Prebuilt(build, true);
}

export function openCopies<T extends Built>(asked: number | undefined, copies: Spares<T>, sound?: string) {
  try {
    return Voice.openBuilt(asked, copies, sound);
  } finally {
    copies.discard();
  }
}

const timed = (asked: number | undefined, lib: Lib): asked is number =>
  asked !== undefined && lib.live && asked > soon(lib.ctx);

export function open<T extends Built>(asked: number | undefined, build: Build<T>, sound?: string) {
  return openCopies(asked, new Prebuilt(build, timed(asked, build.lib)), sound);
}
