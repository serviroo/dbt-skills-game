import { canWrite, cleared, goneElsewhere, mayWrite } from '../core/cleared';
import { connectionLost } from './store';

const STORAGE_WAIT_MS = 10e3;

function visibleTimer(ms: number, done: () => void) {
  if (typeof document === 'undefined') {
    const t = setTimeout(done, ms);
    return () => clearTimeout(t);
  }
  let left = ms;
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flip = () => {
    if (document.hidden && timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      left -= performance.now() - since;
    } else if (!document.hidden && timer === undefined) {
      since = performance.now();
      timer = setTimeout(done, Math.max(0, left));
    }
  };
  flip();
  document.addEventListener('visibilitychange', flip);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', flip);
  };
}

const abort = (t: IDBTransaction | undefined) => {
  try {
    t?.abort();
  } catch {
    /* already finished */
  }
};

interface Turn {
  run?: Promise<unknown>;
  ended?: Promise<unknown>;
  db?: Promise<IDBDatabase | null>;
  t?: IDBTransaction;
  givenUp?: boolean;
}

export class IdbLink {
  persistent = true;
  private db: Promise<IDBDatabase | null>;
  /** IndexedDB open, here but out of reach (what was stored earlier can't be read this visit), or not here at all. */
  private reach: 'open' | 'unreached' | 'none' = 'open';
  /** Reads of what is stored that got no answer; exports compare it before and after. */
  private readFails = 0;
  private stallCount = 0;
  private writeLost = false;
  private openTurn = 0;
  private endOpen = () => {};
  private lost = new WeakSet<IDBDatabase>();
  /** Writes under way, so a clear's check waits for them. */
  private writes = new Set<Promise<unknown>>();

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly upgrade: (db: IDBDatabase) => void,
  ) {
    this.db = this.connect(true);
  }

  get misses() {
    return this.readFails;
  }
  get stalls() {
    return this.stallCount;
  }
  get present() {
    return this.reach !== 'none';
  }
  missed() {
    this.readFails++;
  }
  async connected() {
    return (await this.db) !== null;
  }
  async holdsData() {
    return this.reach === 'unreached' || (await this.db) !== null;
  }
  settled() {
    return Promise.allSettled([...this.writes]);
  }
  close() {
    const db = this.db;
    this.db = Promise.resolve(null);
    this.openTurn++;
    this.endOpen();
    void db.then((d) => d?.close());
  }
  reopen() {
    if (cleared()) return;
    if (!this.writeLost) this.persistent = true;
    if (this.reach === 'open') return;
    this.reach = 'open';
    this.db = this.connect(true);
  }

  /** Opens the database; a lost connection on open gets one more try (`again`). Null when there is none to use. */
  private connect(again: boolean): Promise<IDBDatabase | null> {
    const turn = ++this.openTurn;
    return new Promise((resolve) => {
      this.endOpen = () => resolve(null);
      let missing = false;
      try {
        missing = typeof indexedDB === 'undefined';
        if (missing) throw new Error('no idb');
        // this game's data is being cleared: opening would make the database again
        if (cleared()) return resolve(null);
        const open = indexedDB.open(this.name, this.version);
        open.onupgradeneeded = () => this.upgrade(open.result);
        open.onsuccess = () => {
          const db = open.result;
          if (turn !== this.openTurn) {
            db.close();
            return resolve(null);
          }
          db.onversionchange = (e) => {
            db.close();
            // deleted: another copy cleared this game's data
            if (e.newVersion === null) goneElsewhere();
          };
          resolve(db);
        };
        const fail = (retry: boolean) => {
          if (turn !== this.openTurn) return resolve(null);
          if (again && retry) return resolve(this.connect(false));
          this.persistent = false;
          this.reach = 'unreached';
          resolve(null);
        };
        open.onerror = () => fail(connectionLost(open.error));
        open.onblocked = () => fail(false);
      } catch {
        this.persistent = false;
        this.reach = missing ? 'none' : 'unreached';
        resolve(null);
      }
    });
  }

  /** One fresh connection in place of a lost one (callers that saw the same loss share it). True when there is one. */
  private async reconnect(old: IDBDatabase) {
    if (cleared() || this.reach !== 'open') return false;
    if (!this.lost.has(old)) {
      this.lost.add(old);
      try {
        old.close();
      } catch {
        /* already closed */
      }
      this.db = this.connect(false);
    }
    return !!(await this.db);
  }

  /**
   * Runs fn in one transaction; null when there is no database or the transaction failed (then persistent turns false).
   * A lost connection is opened again once: a read runs again on the fresh one, and so does a write that never started.
   * A read that still gets no answer counts in readFails.
   */
  async tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>) {
    if (mode === 'readonly') return this.answered(stores, mode, fn, {});
    // a clear checking its Save Crystal holds writes; once it clears they never happen
    if (!canWrite() && !(await mayWrite())) return null;
    const turn: Turn = {};
    const job = this.answered(stores, mode, fn, turn);
    this.trackWrite(turn, job);
    return job;
  }

  private trackWrite(turn: Turn, job: Promise<unknown>) {
    const over = () => (turn.givenUp ? turn.ended : turn.run);
    const ended = Promise.race([turn.run, job.then(over)]);
    this.writes.add(ended);
    void ended.finally(() => this.writes.delete(ended));
  }

  private answered<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>, turn: Turn) {
    let stop = () => {};
    const late = new Promise<null>((done) => (stop = visibleTimer(STORAGE_WAIT_MS, () => done(null))));
    const run = this.run(stores, mode, fn, turn);
    turn.run = run;
    return Promise.race([run.then((r) => ({ r })), late]).then((answer) => {
      stop();
      if (answer) return answer.r;
      this.giveUp(turn, mode);
      return null;
    });
  }

  private giveUp(turn: Turn, mode: IDBTransactionMode) {
    turn.givenUp = true;
    abort(turn.t);
    if (mode === 'readonly') this.readFails++;
    else this.writeLost = true;
    if (!turn.db || turn.db !== this.db) return;
    this.stallCount++;
    this.persistent = false;
    this.reach = 'unreached';
    this.close();
  }

  private async run<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>, turn: Turn) {
    let failed = false;
    for (let retry = true; ; retry = false) {
      turn.db = this.db;
      const db = await turn.db;
      if (!db || turn.givenUp) break;
      let started = false;
      try {
        const t = (turn.t = db.transaction(stores, mode));
        started = true;
        const done = new Promise<void>((ok, bad) => {
          t.oncomplete = () => ok();
          t.onerror = () => bad(t.error);
          t.onabort = () => bad(t.error ?? new Error('aborted'));
        });
        turn.ended = done.catch(() => undefined);
        let v: T;
        try {
          v = await fn(t);
        } catch (e) {
          abort(t);
          throw e;
        }
        await done;
        return { v };
      } catch (e) {
        failed = true;
        if (!retry || !connectionLost(e)) break;
        const back = this.reconnect(db);
        turn.db = this.db;
        if ((await back) && (!started || mode === 'readonly')) continue;
        break;
      }
    }
    if (failed) this.persistent = false;
    if (mode !== 'readonly') this.writeLost = true;
    if (mode === 'readonly' && (failed || this.reach !== 'open')) this.readFails++;
    return null;
  }
}
