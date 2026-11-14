import { canWrite, cleared, goneElsewhere, mayWrite } from '../core/cleared';
import { connectionLost } from './store';

export function req<T>(r: IDBRequest<T>): Promise<T> {
  const answer = new Promise<T>((ok, bad) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
  answer.catch(() => undefined);
  return answer;
}

const STORAGE_WAIT_MS = 10e3;
const STORAGE_REST_MS = 5e3;
const links = new Set<IdbLink>();

export function wakeStorage(explicit = false) {
  for (const link of links) link.wake(explicit);
}

const wakeWhenShown = () => {
  if (document.visibilityState === 'visible') wakeStorage();
};

type Read = { timedOut: boolean; transaction?: IDBTransaction };

function abortRead(transaction: IDBTransaction) {
  try { transaction.abort(); } catch { return; }
}

export class IdbLink {
  private saving = true;
  get persistent() { return this.saving && !this.unreadable; }
  set persistent(value: boolean) { this.saving = value; }
  private unreadable = false;
  readFails = 0;
  db: Promise<IDBDatabase | null>;
  private lost = new WeakSet<IDBDatabase>();
  private opening: {
    db: Promise<IDBDatabase | null>;
    cancel: () => void;
    replace: (next: Promise<IDBDatabase | null>) => void;
  } | null = null;
  private abandoned = false;
  private downUntil = 0;
  /** Writes under way, so a clear's check waits for them. */
  readonly writes = new Set<Promise<unknown>>();

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly upgrade: (db: IDBDatabase) => void,
  ) {
    if (!links.size && typeof document !== 'undefined') document.addEventListener('visibilitychange', wakeWhenShown);
    links.add(this);
    this.db = this.connect(true);
  }

  close() {
    links.delete(this);
    if (!links.size && typeof document !== 'undefined') document.removeEventListener('visibilitychange', wakeWhenShown);
    this.opening?.cancel();
    const db = this.db;
    this.db = Promise.resolve(null);
    void db.then((d) => d?.close());
  }

  wake(explicit = false) {
    const opening = this.opening;
    this.downUntil = 0;
    if (explicit && opening && !cleared()) {
      this.abandoned = false;
      this.db = this.connect(true);
      opening.replace(this.db);
    } else this.ready();
  }

  private giveUp(pending: Promise<IDBDatabase | null>) {
    if (this.opening?.db !== pending) return;
    this.abandoned = true;
    this.opening.cancel();
  }

  there() {
    return typeof indexedDB !== 'undefined' && !cleared() && !this.unreadable;
  }

  private ready() {
    if (this.downUntil && Date.now() >= this.downUntil) this.downUntil = 0;
    if (!this.downUntil && (this.abandoned || this.unreadable) && !this.opening) {
      this.abandoned = false;
      this.db = this.connect(true);
    }
  }

  /** Opens the database; a lost connection on open gets one more try (`again`). Null when there is none to use. */
  private connect(again: boolean): Promise<IDBDatabase | null> {
    let cancel = () => {};
    let replace = (_next: Promise<IDBDatabase | null>) => {};
    let late: ReturnType<typeof setTimeout>;
    const db = new Promise<IDBDatabase | null>((resolve) => {
      let finished = false;
      cancel = () => { clearTimeout(late); finished = true; resolve(null); };
      replace = (next) => { clearTimeout(late); finished = true; resolve(next); };
      const attempt = (retryAllowed: boolean) => {
        try {
          if (typeof indexedDB === 'undefined') { this.persistent = false; return resolve(null); }
          // this game's data is being cleared: opening would make the database again
          if (cleared()) return resolve(null);
          const open = indexedDB.open(this.name, this.version);
          late = setTimeout(() => {
            if (finished || this.opening?.db !== db) return;
            this.downUntil = Date.now() + STORAGE_REST_MS;
            this.giveUp(db);
          }, STORAGE_WAIT_MS);
          open.onupgradeneeded = () => {
            if (finished) open.transaction?.abort();
            else this.upgrade(open.result);
          };
          open.onsuccess = () => {
            const db = open.result;
            if (finished) { db.close(); return; }
            clearTimeout(late);
            finished = true;
            this.unreadable = false;
            db.onversionchange = (e) => {
              db.close();
              // deleted: another copy cleared this game's data
              if (e.newVersion === null) goneElsewhere();
            };
            resolve(db);
          };
          const fail = (retry: boolean) => {
            if (finished) return;
            clearTimeout(late);
            if (retryAllowed && retry) return attempt(false);
            finished = true;
            this.unreadable = true;
            this.downUntil = Date.now() + STORAGE_REST_MS;
            resolve(null);
          };
          open.onerror = () => fail(connectionLost(open.error));
          open.onblocked = () => fail(false);
        } catch {
          if (finished) return;
          clearTimeout(late);
          finished = true;
          this.unreadable = true;
          this.downUntil = Date.now() + STORAGE_REST_MS;
          resolve(null);
        }
      };
      attempt(again);
    });
    const opening = { db, cancel, replace };
    this.opening = opening;
    void db.then(() => {
      clearTimeout(late);
      if (this.opening === opening) this.opening = null;
    });
    return db;
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
   * Runs fn in one transaction; null when there is no database or the transaction failed.
   * A lost connection is opened again once: a read runs again on the fresh one, and so does a write that never started.
   * A read that still gets no answer counts in readFails.
   */
  async tx<T>(
    stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>,
  ): Promise<{ v: T } | null> {
    this.ready();
    if (mode === 'readonly') {
      if (this.downUntil) { this.readFails++; return null; }
      const read: Read = { timedOut: false };
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          read.timedOut = true;
          this.downUntil = Date.now() + STORAGE_REST_MS;
          this.readFails++;
          if (read.transaction) abortRead(read.transaction);
          resolve(null);
        }, STORAGE_WAIT_MS);
      });
      const result = await Promise.race([this.run(stores, mode, fn, read), timeout]);
      clearTimeout(timer!);
      return result;
    }
    // a clear checking its Save Crystal holds writes; once it clears they never happen
    if (!canWrite() && !(await mayWrite())) return null;
    const job = this.run(stores, mode, fn);
    this.writes.add(job);
    void job.finally(() => this.writes.delete(job));
    return job;
  }

  private async run<T>(
    stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>, read?: Read,
  ): Promise<{ v: T } | null> {
    let failed = false;
    for (let retry = true; ; retry = false) {
      const db = await this.db;
      if (read?.timedOut) return null;
      if (!db) {
        if (!cleared() && (mode !== 'readonly' || typeof indexedDB !== 'undefined')) failed = true;
        break;
      }
      let started = false;
      try {
        const t = db.transaction(stores, mode);
        if (read) read.transaction = t;
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
        if (read?.timedOut) return null;
        return { v };
      } catch (e) {
        if (read?.timedOut) return null;
        failed = true;
        if (retry && connectionLost(e)) {
          const connected = this.reconnect(db);
          const reconnected = await connected;
          if (read?.timedOut) return null;
          if (reconnected && (!started || mode === 'readonly')) continue;
        }
        break;
      }
    }
    if (failed && mode !== 'readonly') this.persistent = false;
    if (mode === 'readonly' && (failed || this.unreadable || this.abandoned)) this.readFails++;
    return null;
  }
}
