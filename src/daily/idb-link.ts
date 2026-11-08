import { canWrite, cleared, goneElsewhere, mayWrite } from '../core/cleared';
import { connectionLost } from './store';

export class IdbLink {
  persistent = true;
  unreadable = false;
  readFails = 0;
  db: Promise<IDBDatabase | null>;
  readonly writes = new Set<Promise<unknown>>();
  private lost = new WeakSet<IDBDatabase>();

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

  async tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>) {
    if (mode === 'readonly') return this.run(stores, mode, fn);
    if (!canWrite() && !(await mayWrite())) return null;
    const job = this.run(stores, mode, fn);
    this.writes.add(job);
    void job.finally(() => this.writes.delete(job));
    return job;
  }

  private lose() {
    this.persistent = false;
    this.unreadable = true;
  }

  private connect(again: boolean): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('no idb');
        if (cleared()) return resolve(null);
        const open = indexedDB.open(this.name, this.version);
        open.onupgradeneeded = () => this.upgrade(open.result);
        open.onsuccess = () => {
          const db = open.result;
          db.onversionchange = (e) => {
            db.close();
            if (e.newVersion === null) goneElsewhere();
          };
          resolve(db);
        };
        const fail = (retry: boolean) => {
          if (again && retry) return resolve(this.connect(false));
          this.lose();
          resolve(null);
        };
        open.onerror = () => fail(connectionLost(open.error));
        open.onblocked = () => fail(false);
      } catch {
        this.lose();
        resolve(null);
      }
    });
  }

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

  private async run<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>) {
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
