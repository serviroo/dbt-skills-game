import { RETRIES, Voice, type ControlledBuild, type Copies } from './voice';

type Built = ControlledBuild & { prepare?: (at: number) => void };
type Make<T> = (seed: () => number) => T;

export interface Build<T> {
  make: Make<T>;
  seed: () => number;
  kind?: Copies<T>['kind'];
}

export interface Spares<T> extends Copies<T> {
  fill(): void;
  discard(): void;
}

let windowed = false;

export class Prebuilt<T extends Built> implements Spares<T> {
  private ready: T[] = [];
  private seeds: number[] = [];
  private taken = 0;
  private readonly depth: number;

  constructor(
    private make: Make<T>,
    private nextSeed: () => number,
    readonly kind: Copies<T>['kind'] = 'once',
    private ahead = windowed,
  ) {
    this.depth = kind === 'once' ? RETRIES.length : 2;
    if (ahead) this.fill();
  }

  get left() {
    return this.ahead ? this.ready.length : this.depth - this.taken;
  }

  fill() {
    try {
      while (this.ready.length < this.depth) this.ready.push(this.build());
    } catch (err) {
      this.discard();
      throw err;
    }
  }

  private build() {
    let index = 0;
    return this.make(() => (this.seeds[index++] ??= this.nextSeed()));
  }

  take() {
    if (this.ahead) return this.ready.shift();
    if (this.taken >= this.depth) return undefined;
    this.taken++;
    return this.build();
  }

  discard() {
    for (const copy of this.ready.splice(0)) copy.voice.discard();
  }
}

export function ahead<R>(run: () => R) {
  const was = windowed;
  windowed = true;
  try {
    return run();
  } finally {
    windowed = was;
  }
}

export function copiesAhead<T extends Built>(make: Make<T>, nextSeed: () => number): Spares<T> {
  return new Prebuilt(make, nextSeed, 'once', true);
}

export function openPrebuilt<T extends Built>(asked: number | undefined, from: Spares<T> | Build<T>, sound?: string) {
  const copies = 'take' in from ? from : new Prebuilt(from.make, from.seed, from.kind);
  try {
    return Voice.openBuilt(asked, copies, sound);
  } finally {
    copies.discard();
  }
}

type Queued = { at: number; batch: number; run: () => void };

export class BuildWindow {
  private queued: Queued[] = [];
  private batches = 0;
  private running: number | undefined;

  add(items: { at: number; run: () => void }[], until: number) {
    const batch = ++this.batches;
    this.queued.push(...items.map((item) => ({ ...item, batch })));
    this.queued.sort((a, b) => a.at - b.at || a.batch - b.batch);
    this.until(until);
  }

  until(t: number) {
    while (this.queued.length && this.queued[0].at <= t) {
      const { batch, run } = this.queued.shift()!;
      const was = this.running;
      this.running = batch;
      try {
        ahead(run);
      } finally {
        this.running = was;
      }
    }
  }

  clear() {
    const running = this.running ?? Infinity;
    this.queued = this.queued.filter((item) => item.batch >= running);
  }
}
