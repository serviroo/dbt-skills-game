import { canWrite, cleared, goneElsewhere, mayWrite } from '../core/cleared';
import { connectionLost } from './store';

export class IdbLink {
  persistent = true;
  private unreadable = false;
  readFails = 0;
  db: Promise<IDBDatabase | null>;
  private lost = new WeakSet<IDBDatabase>();
  /** Writes under way, so a clear's check waits for them. */
  readonly writes = new Set<Promise<unknown>>();

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly upgrade: (db: IDBDatabase) => void,
  ) {
    this.db = this.connect(true);
  }

  close() {
    const db = this.db;
    this.db = Promise.resolve(null);
    void db.then((d) => d?.close());
  }

  /** Opens the database; a lost connection on open gets one more try (`again`). Null when there is none to use. */
  private connect(again: boolean): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') { this.persistent = false; return resolve(null); }
        // this game's data is being cleared: opening would make the database again
        if (cleared()) return resolve(null);
        const open = indexedDB.open(this.name, this.version);
        open.onupgradeneeded = () => this.upgrade(open.result);
        open.onsuccess = () => {
          const db = open.result;
          db.onversionchange = (e) => {
            db.close();
            // deleted: another copy cleared this game's data
            if (e.newVersion === null) goneElsewhere();
          };
          resolve(db);
        };
        const fail = (retry: boolean) => {
          if (again && retry) return resolve(this.connect(false));
          this.persistent = false;
          this.unreadable = true;
          resolve(null);
        };
        open.onerror = () => fail(connectionLost(open.error));
        open.onblocked = () => fail(false);
      } catch {
        this.persistent = false;
        this.unreadable = true;
        resolve(null);
      }
    });
  }

  /** One fresh connection in place of a lost one (callers that saw the same loss share it). True when there is one. */
  private async reconnect(old: IDBDatabase) {
    if (cleared()) return false;
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
  async tx<T>(
    stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>,
  ): Promise<{ v: T } | null> {
    if (mode === 'readonly') return this.run(stores, mode, fn);
    // a clear checking its Save Crystal holds writes; once it clears they never happen
    if (!canWrite() && !(await mayWrite())) return null;
    const job = this.run(stores, mode, fn);
    this.writes.add(job);
    void job.finally(() => this.writes.delete(job));
    return job;
  }

  private async run<T>(
    stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>,
  ): Promise<{ v: T } | null> {
    let failed = false;
    for (let retry = true; ; retry = false) {
      const db = await this.db;
      if (!db) break;
      let started = false;
      try {
        const t = db.transaction(stores, mode);
        started = true;
        const done = new Promise<void>((ok, bad) => {
          t.oncomplete = () => ok();
          t.onerror = () => bad(t.error);
          t.onabort = () => bad(t.error ?? new Error('aborted'));
        });
        done.catch(() => undefined);
        let v: T;
        try {
          v = await fn(t);
        } catch (e) {
          try {
            t.abort();
          } catch {
            /* already finished */
          }
          throw e;
        }
        await done;
        return { v };
      } catch (e) {
        failed = true;
        if (retry && connectionLost(e) && (await this.reconnect(db)) && (!started || mode === 'readonly')) continue;
        break;
      }
    }
    if (failed) this.persistent = false;
    if (mode === 'readonly' && (failed || this.unreadable)) this.readFails++;
    return null;
  }
}
