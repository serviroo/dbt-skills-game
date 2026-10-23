/**
 * Drawings live in IndexedDB on this device (strokes, plus a small JPEG thumbnail), drafts too, so a page survives
 * an app switch. If IndexedDB is unavailable the session keeps drawings in memory and the Art room says so.
 * Backups carry the strokes, not images: a restore re-renders every thumbnail from them.
 */
import { canvasBlob, INKS, PAGE, renderDrawing, type Paper, type Stroke } from './ink';
import { connectionLost, uid, validDay } from './store';

export interface DrawingMeta {
  id: string;
  kind: Paper;
  day: string;
  t: number;
  updated: number;
  prompt?: string;
  name?: string;
  n: number;
  rev?: string;
  /** Identities (revOf) of the versions this one was drawn from, newest last: a backup holding one of them is not news. */
  from?: string[];
}
export interface DrawingRec extends DrawingMeta {
  strokes: Stroke[];
  bases?: string[];
  after?: number;
}
export interface Draft {
  key: string;
  kind: Paper;
  editId?: string;
  bases?: string[];
  base?: number;
  prompt?: string | null;
  strokes: Stroke[];
  t: number;
}
export interface PutResult {
  stored: 'wrote' | 'copied' | 'failed';
  id: string;
  updated: number;
  /** The identity (revOf) of the version this save produced. */
  rev: string;
}

const THUMB_W = 480;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const REV = /^[A-Za-z0-9~._-]{1,40}$/;
const revId = (r: unknown) => (typeof r === 'string' && REV.test(r) ? r : undefined);
/**
 * A version's identity: its revision and its time, so a file that reuses a revision with another time is another
 * version. Drawings saved before revisions existed are named by their time alone.
 */
export const revOf = (m: Pick<DrawingMeta, 'rev' | 'updated'>) => `${revId(m.rev) ?? ''}@${fin(m.updated) ? m.updated : 0}`;
const IDENT = /^[A-Za-z0-9~._-]{0,40}@-?\d+(\.\d+)?(e[+-]?\d+)?$/;
const FROM_CAP = 16;
const fromOf = (x: unknown): string[] | undefined => {
  if (!Array.isArray(x)) return undefined;
  const out = [...new Set(x.filter((r): r is string => typeof r === 'string' && IDENT.test(r)))].slice(-FROM_CAP);
  return out.length ? out : undefined;
};

/** Accepts anything JSON-parsed as strokes; drops what doesn't fit, clamps what does. */
export function cleanStrokes(raw: unknown, kind: Paper): Stroke[] | null {
  if (!Array.isArray(raw)) return null;
  const { w, h } = PAGE[kind];
  const out: Stroke[] = [];
  for (const s of raw.slice(0, 20000)) {
    if (!isObj(s) || !Array.isArray(s.p) || !fin(s.i) || !fin(s.w)) continue;
    const p: number[] = [];
    const src = s.p.slice(0, 400000);
    for (let k = 0; k + 1 < src.length; k += 2) {
      const x = src[k], y = src[k + 1];
      if (!fin(x) || !fin(y)) continue;
      p.push(Math.max(-w, Math.min(2 * w, x)), Math.max(-h, Math.min(2 * h, y)));
    }
    if (!p.length) continue;
    out.push({ i: Math.max(0, Math.min(INKS.length - 1, Math.round(s.i))), w: Math.max(1, Math.min(400, s.w)), p });
  }
  return out;
}

export function cleanRec(raw: unknown): DrawingRec | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 40) return null;
  const kind: Paper = raw.kind === 'ally' ? 'ally' : 'today';
  const strokes = cleanStrokes(raw.strokes, kind);
  if (!strokes) return null;
  const day = validDay(raw.day) ? raw.day : '';
  if (!day) return null;
  const t = fin(raw.t) ? raw.t : 0;
  return {
    id: raw.id,
    kind,
    day,
    t,
    updated: fin(raw.updated) ? raw.updated : t,
    prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 120) : undefined,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 24) : undefined,
    rev: revId(raw.rev),
    from: fromOf(raw.from),
    n: strokes.length,
    strokes,
  };
}

/** A page and the copies kept apart from it share this. */
const family = (id: string) => id.split('~')[0].slice(0, 26);
const landKey = (id: string, rev: string) => `${id}\n${rev}`;
const metaOf = (r: DrawingRec): DrawingMeta => ({ id: r.id, kind: r.kind, day: r.day, t: r.t, updated: r.updated, prompt: r.prompt, name: r.name, n: r.strokes.length, rev: r.rev, from: fromOf(r.from) });

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((ok, bad) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}

export class ArtStore {
  private db: Promise<IDBDatabase | null>;
  private mem = { meta: new Map<string, DrawingMeta>(), strokes: new Map<string, Stroke[]>(), thumbs: new Map<string, Blob>(), drafts: new Map<string, Draft>() };
  persistent = true;
  /** IndexedDB is here but couldn't be opened, so drawings stored earlier can't be read this visit. */
  private unreadable = false;
  /** Reads of the stored drawings that got no answer; exportAll compares it before and after. */
  private readFails = 0;
  private lost = new WeakSet<IDBDatabase>();
  get readFailed() {
    return this.readFails > 0;
  }
  private urls = new Map<string, { at: number; url: string }>();
  private cache: DrawingMeta[] | null = null;
  private gen = 0;
  private lastStamp = -Infinity;
  private lastCopy = 0;
  private channel: BroadcastChannel | null = null;
  /** Versions this copy saw land on disk (id + identity). A version in memory that is not here never reached disk. */
  private landed = new Set<string>();

  constructor(readonly name: string) {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(name);
        this.channel.onmessage = () => this.drop();
      } catch {
        this.channel = null;
      }
    }
    this.db = this.connect(true);
  }

  /** Opens the database; a lost connection on open gets one more try (`again`). Null when there is none to use. */
  private connect(again: boolean): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('no idb');
        const open = indexedDB.open(this.name, 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          for (const s of ['meta', 'strokes', 'thumbs', 'drafts']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        };
        open.onsuccess = () => {
          const db = open.result;
          db.onversionchange = () => db.close();
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
   * Runs fn in one transaction, or returns the fallback. A lost connection is opened again once: a read runs again on
   * the fresh one, and so does a write that never started. A read that still gets no answer counts in readFails.
   */
  private async tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>, fallback: () => T): Promise<T> {
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
          t.onabort = () => bad(t.error);
        });
        done.catch(() => undefined);
        const v = await fn(t);
        await done;
        return v;
      } catch (e) {
        failed = true;
        if (retry && connectionLost(e) && (await this.reconnect(db)) && (!started || mode === 'readonly')) continue;
        break;
      }
    }
    if (failed) this.persistent = false;
    if (mode === 'readonly' && (failed || this.unreadable)) this.readFails++;
    return fallback();
  }

  /** Saved drawings, plus any this session could only keep in memory (a newer in-memory copy wins). */
  async list(): Promise<DrawingMeta[]> {
    if (this.cache) return this.cache;
    const gen = this.gen;
    const fails = this.readFails;
    const rows = await this.tx(['meta'], 'readonly', (t) => req(t.objectStore('meta').getAll() as IDBRequest<DrawingMeta[]>), () => [] as DrawingMeta[]);
    const byId = new Map(rows.map((m) => [m.id, m]));
    for (const m of this.mem.meta.values()) {
      const db = byId.get(m.id);
      if (!db || m.updated > db.updated) byId.set(m.id, m);
    }
    const out = [...byId.values()].sort((a, b) => b.t - a.t);
    // a list read while the drawings couldn't be read is not kept, so the next look reads again
    if (gen === this.gen && this.readFails === fails) this.cache = out;
    return out;
  }

  private drop() {
    this.cache = null;
    this.gen++;
  }

  private copyId(id: string) {
    const ms = (this.lastCopy = Math.max(Date.now(), this.lastCopy + 1));
    const c = `${family(id)}~${ms.toString(36)}`;
    return this.mem.meta.has(c) ? `${c}${Math.random().toString(36).slice(2, 6)}` : c;
  }

  /** Tells the other open copies of the app that the saved drawings changed, so their next list() reads fresh. */
  private announce() {
    try {
      this.channel?.postMessage('changed');
    } catch {
      this.channel = null;
    }
  }

  async get(id: string): Promise<DrawingRec | null> {
    const [m, s] = await this.tx(
      ['meta', 'strokes'],
      'readonly',
      (t) => Promise.all([req(t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>), req(t.objectStore('strokes').get(id) as IDBRequest<Stroke[] | undefined>)]),
      (): [DrawingMeta | undefined, Stroke[] | undefined] => [undefined, undefined],
    );
    const mm = this.mem.meta.get(id), ms = this.mem.strokes.get(id);
    if (mm && ms && (!m || !s || mm.updated > m.updated)) return { ...mm, strokes: ms };
    return m && s ? { ...m, strokes: s } : null;
  }

  /**
   * Keeps the drawing unless this device already holds the same or a newer edit of it. The thumbnail is rendered first;
   * the check and the write share one readwrite transaction, so two copies of the app writing at once can never step a
   * drawing back. The same edit only fills in its thumbnail. `prev` is the stored version found, `stored` what happened.
   * Their own save (force) gets a new revision and a stamp above the stored one, the one the player last saw (`after`) and every
   * stamp this copy issued, so a clock that stepped back can't hide it. If the stored or in-memory version is not one them
   * edit started from or saved itself (`bases`), their edit is kept as its own drawing (and their own older version in memory
   * gives way to the stored one). Times only order versions.
   */
  private async write(rec: DrawingRec, force = false): Promise<{ stored: 'wrote' | 'held' | 'copied' | 'failed'; prev: number | undefined; id: string; updated: number; rev: string }> {
    let stamp = rec.updated;
    if (force) this.lastStamp = stamp = Math.max(stamp, this.lastStamp + 1, fin(rec.after) ? rec.after + 1 : -Infinity);
    const rev = force ? uid() : revId(rec.rev);
    // their edit descends from the versions it started from, and from what they descended from
    const bases = force ? (rec.bases ?? []) : [];
    const lineage = (m: DrawingMeta | undefined) => (m && bases.includes(revOf(m)) ? (m.from ?? []) : []);
    let from = force ? fromOf([...lineage(this.mem.meta.get(rec.id)), ...(rec.from ?? []), ...bases]) : rec.from;
    let id = rec.id;
    const thumb = await canvasBlob(renderDrawing(rec.strokes, rec.kind, THUMB_W), 'image/jpeg', 0.9);
    const buf = thumb ? await thumb.arrayBuffer() : null;
    let prev: number | undefined;
    let decided = false;
    let same = false;
    const decide = (disk: DrawingMeta | undefined): 'copy' | 'write' => {
      decided = true;
      const seen = [disk, this.mem.meta.get(rec.id)].filter((m): m is DrawingMeta => !!m);
      if (rec.bases !== undefined && seen.some((m) => !rec.bases!.includes(revOf(m)))) {
        id = this.copyId(rec.id);
        return 'copy';
      }
      const top = Math.max(-Infinity, ...seen.map((m) => (fin(m.updated) ? m.updated : -Infinity)));
      if (top >= stamp) this.lastStamp = Math.max(this.lastStamp, (stamp = top + 1));
      return 'write';
    };
    const stored = await this.tx(
      ['meta', 'strokes', 'thumbs'],
      'readwrite',
      (t) =>
        new Promise<'wrote' | 'held' | 'copied'>((ok, bad) => {
          const fail = (e: unknown) => {
            bad(e);
            try {
              t.abort();
            } catch {
              return;
            }
          };
          const keep = (as: 'wrote' | 'copied') => {
            try {
              t.objectStore('meta').put(metaOf({ ...rec, id, updated: stamp, rev, from }), id);
              t.objectStore('strokes').put(rec.strokes, id);
              if (buf) t.objectStore('thumbs').put({ type: 'image/jpeg', buf }, id);
              ok(as);
            } catch (e) {
              fail(e);
            }
          };
          const g = t.objectStore('meta').get(rec.id) as IDBRequest<DrawingMeta | undefined>;
          g.onerror = () => bad(g.error);
          g.onsuccess = () => {
            try {
              const had = g.result;
              prev = had ? (fin(had.updated) ? had.updated : -Infinity) : undefined;
              if (!force && had) {
                same = revOf(had) === revOf({ rev, updated: stamp });
                if (same && buf) t.objectStore('thumbs').put({ type: 'image/jpeg', buf }, rec.id);
                return ok('held');
              }
              if (force) from = fromOf([...lineage(had), ...(from ?? [])]);
              if (force && decide(had) === 'copy') {
                const c = t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>;
                c.onerror = () => bad(c.error);
                c.onsuccess = () => {
                  if (c.result) id = `${id}${Math.random().toString(36).slice(2, 6)}`;
                  keep('copied');
                };
                return;
              }
              keep('wrote');
            } catch (e) {
              fail(e);
            }
          };
        }),
      () => 'failed' as const,
    );
    if (force && stored === 'failed' && !decided) decide(undefined);
    const meta = metaOf({ ...rec, id, updated: stamp, rev, from });
    const own = force && id !== rec.id ? this.mem.meta.get(rec.id) : undefined;
    if (own && rec.bases?.includes(revOf(own))) {
      this.mem.meta.delete(rec.id);
      this.mem.strokes.delete(rec.id);
      this.mem.thumbs.delete(rec.id);
      this.dropUrl(rec.id);
    }
    const mm = this.mem.meta.get(id);
    if (force || ((stored === 'wrote' || stored === 'failed' || same) && (!mm || stamp >= mm.updated))) {
      this.mem.meta.set(id, meta);
      this.mem.strokes.set(id, rec.strokes);
      if (thumb) this.mem.thumbs.set(id, thumb);
      else this.mem.thumbs.delete(id);
    }
    if (stored === 'wrote' || stored === 'copied' || same) this.landed.add(landKey(id, revOf(meta)));
    this.dropUrl(id);
    this.drop();
    return { stored, prev, id, updated: stamp, rev: revOf(meta) };
  }

  /**
   * Their own save always lands (a clock that stepped back can't drop it). A write that isn't theirs (a thumbnail filled in)
   * never replaces a stored version. `id` is where it landed: a new id when a newer version arrived while the player was
   * editing (`copied`).
   */
  async put(rec: DrawingRec): Promise<PutResult> {
    const { stored, id, updated, rev } = await this.write(rec, true);
    if (stored === 'wrote' || stored === 'copied') this.announce();
    return { stored: stored === 'held' ? 'wrote' : stored, id, updated, rev };
  }

  async remove(id: string) {
    this.mem.meta.delete(id);
    this.mem.strokes.delete(id);
    this.mem.thumbs.delete(id);
    const done = await this.tx(
      ['meta', 'strokes', 'thumbs'],
      'readwrite',
      async (t) => {
        for (const s of ['meta', 'strokes', 'thumbs']) t.objectStore(s).delete(id);
        return true;
      },
      () => false,
    );
    this.dropUrl(id);
    this.drop();
    if (done) this.announce();
  }

  private dropUrl(id: string) {
    const u = this.urls.get(id);
    if (u) URL.revokeObjectURL(u.url);
    this.urls.delete(id);
  }

  /** An object URL for the thumbnail, re-rendered from strokes if it was never stored (e.g. after a restore). */
  async thumbUrl(m: DrawingMeta): Promise<string | null> {
    const have = this.urls.get(m.id);
    if (have && have.at >= m.updated) return have.url;
    const mm = this.mem.meta.get(m.id);
    let blob: Blob | null = mm && mm.updated >= m.updated ? (this.mem.thumbs.get(m.id) ?? null) : null;
    if (!blob) {
      const row = await this.tx(['thumbs'], 'readonly', (t) => req(t.objectStore('thumbs').get(m.id) as IDBRequest<{ type: string; buf: ArrayBuffer } | undefined>), () => undefined);
      if (row?.buf) blob = new Blob([row.buf], { type: row.type });
    }
    if (!blob) {
      const rec = await this.get(m.id);
      if (!rec) return null;
      if ((await this.write(rec)).stored === 'wrote') this.announce();
      blob = this.mem.thumbs.get(m.id) ?? null;
      if (!blob) return null;
    }
    this.dropUrl(m.id);
    const url = URL.createObjectURL(blob);
    this.urls.set(m.id, { at: m.updated, url });
    return url;
  }

  /** The newer of the stored draft and the one this copy holds in memory (a draft write can fail when storage is full). */
  async getDraft(key: string): Promise<Draft | null> {
    const d = await this.tx(['drafts'], 'readonly', (t) => req(t.objectStore('drafts').get(key) as IDBRequest<Draft | undefined>), () => undefined);
    const m = this.mem.drafts.get(key);
    const best = d && m ? (m.t > d.t ? m : d) : (d ?? m);
    return best && Array.isArray(best.strokes) && best.strokes.length ? best : null;
  }

  async drafts(): Promise<Draft[]> {
    const all = await this.tx(['drafts'], 'readonly', (t) => req(t.objectStore('drafts').getAll() as IDBRequest<Draft[]>), () => [] as Draft[]);
    const byKey = new Map(all.filter((d) => d && typeof d.key === 'string').map((d) => [d.key, d]));
    for (const m of this.mem.drafts.values()) {
      const d = byKey.get(m.key);
      if (!d || m.t > d.t) byKey.set(m.key, m);
    }
    return [...byKey.values()].filter((d) => d.strokes?.length).sort((a, b) => b.t - a.t);
  }

  async putDraft(d: Draft) {
    this.mem.drafts.set(d.key, d);
    await this.tx(['drafts'], 'readwrite', async (t) => void t.objectStore('drafts').put(d, d.key), () => undefined);
  }

  async dropDraft(key: string) {
    this.mem.drafts.delete(key);
    await this.tx(['drafts'], 'readwrite', async (t) => void t.objectStore('drafts').delete(key), () => undefined);
  }

  /**
   * Every saved drawing with its strokes, for the Save Crystal, read fresh (another copy may have saved one). When a
   * version lives only in memory here (its save failed) next to a different stored one, both go in: the one in use under
   * the page's id, the other under its own id, so a backup never drops a version. Drafts are not included. incomplete:
   * a read of the stored drawings failed, so some may be missing from records.
   */
  async exportAll(): Promise<{ records: DrawingRec[]; incomplete: boolean }> {
    const fails = this.readFails;
    this.drop();
    const ids = (await this.list()).map((m) => m.id);
    const used = new Set(ids);
    const plain = (r: DrawingRec): DrawingRec => ({ ...r, strokes: r.strokes.map((s) => ({ i: s.i, w: s.w, p: s.p })) });
    const out: DrawingRec[] = [];
    for (const id of ids) {
      const [m, s] = await this.tx(
        ['meta', 'strokes'],
        'readonly',
        (t) => Promise.all([req(t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>), req(t.objectStore('strokes').get(id) as IDBRequest<Stroke[] | undefined>)]),
        (): [DrawingMeta | undefined, Stroke[] | undefined] => [undefined, undefined],
      );
      const disk = m && s ? { ...m, strokes: s } : null;
      const mm = this.mem.meta.get(id), ms = this.mem.strokes.get(id);
      const mem = mm && ms ? { ...mm, strokes: ms } : null;
      // the version in use keeps the id (as get() picks it); a different one only memory holds goes in under its own id
      const main = mem && (!disk || mem.updated > disk.updated) ? mem : disk;
      if (main) out.push(plain(main));
      if (!mem || !disk || revOf(mem) === revOf(disk) || (main === disk && this.landed.has(landKey(id, revOf(mem))))) continue;
      const other = main === mem ? disk : mem;
      const base = `${family(id)}~${Math.max(0, Math.floor(other.updated)).toString(36)}`;
      let cid = base;
      while (used.has(cid)) cid = `${base}${Math.random().toString(36).slice(2, 6)}`;
      used.add(cid);
      out.push(plain({ ...other, id: cid }));
    }
    return { records: out.sort((a, b) => a.t - b.t), incomplete: this.readFails > fails };
  }

  /** How many of these drawings exist on this device only in memory (no saved copy as new as the one in use). */
  private async memoryOnly(ids: string[]) {
    const saved = await this.tx(
      ['meta'],
      'readonly',
      (t) => Promise.all(ids.map((id) => req(t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>))),
      () => ids.map((): DrawingMeta | undefined => undefined),
    );
    return ids.filter((id, i) => {
      const mm = this.mem.meta.get(id), db = saved[i];
      return !!mm && (!db || mm.updated > db.updated);
    }).length;
  }

  /**
   * Adds drawings from a backup and never replaces one. A version already here (under its id or a copy of it) is
   * unchanged. A different version of a page that is here keeps both: the newer one under the page's id, the other as
   * its own page, in one transaction. Each drawing counts once as added, kept (both versions kept), unchanged or skipped
   * (unreadable). unsaved counts the drawings from the file whose copy in use lives only in memory for this session.
   */
  async importAll(raw: unknown): Promise<{ added: number; kept: number; unchanged: number; skipped: number; unsaved: number }> {
    const out = { added: 0, kept: 0, unchanged: 0, skipped: 0, unsaved: 0 };
    if (!Array.isArray(raw)) return out;
    this.drop();
    out.skipped += Math.max(0, raw.length - 10000);
    const byId = new Map<string, DrawingRec>();
    for (const item of raw.slice(0, 10000)) {
      const rec = cleanRec(item);
      if (!rec) {
        out.skipped++;
        continue;
      }
      const had = byId.get(rec.id);
      if (!had || rec.updated > had.updated) byId.set(rec.id, rec);
    }
    const known = new Map<string, Map<string, string>>();
    const note = (id: string, rev: string) => {
      let k = known.get(family(id));
      if (!k) known.set(family(id), (k = new Map()));
      if (!k.has(rev)) k.set(rev, id);
    };
    const onDisk = await this.tx(['meta'], 'readonly', (t) => req(t.objectStore('meta').getAll() as IDBRequest<DrawingMeta[]>), () => [] as DrawingMeta[]);
    const diskMeta = new Map(onDisk.map((m) => [m.id, m]));
    for (const m of [...onDisk, ...this.mem.meta.values()]) {
      note(m.id, revOf(m));
      for (const a of fromOf(m.from) ?? []) note(m.id, a);
    }
    let wrote = false;
    const inUse: string[] = [];
    for (const rec of byId.values()) {
      const hit = known.get(family(rec.id))?.get(revOf(rec));
      if (hit) {
        out.unchanged++;
        inUse.push(hit);
        continue;
      }
      const r = await this.importOne(rec, diskMeta.get(rec.id));
      out[r.result]++;
      if (r.wrote) wrote = true;
      inUse.push(r.at);
      note(r.at, revOf(rec));
      for (const a of rec.from ?? []) note(r.at, a);
      if (r.moved) note(r.moved.id, r.moved.rev);
    }
    out.unsaved = await this.memoryOnly(inUse);
    this.drop();
    if (wrote) this.announce();
    return out;
  }

  /** One drawing from a backup whose version isn't here yet; see importAll. `at` is where it landed. */
  private async importOne(rec: DrawingRec, scanned: DrawingMeta | undefined): Promise<{ result: 'added' | 'kept' | 'unchanged'; at: string; wrote: boolean; moved?: { id: string; rev: string } }> {
    const me = revOf(rec);
    const thumb = await canvasBlob(renderDrawing(rec.strokes, rec.kind, THUMB_W), 'image/jpeg', 0.9);
    const buf = thumb ? await thumb.arrayBuffer() : null;
    const M = this.mem.meta.get(rec.id);
    let cid = this.copyId(rec.id);
    let at = rec.id;
    let D: DrawingMeta | undefined;
    let moved: { id: string; rev: string } | undefined;
    const stored = await this.tx(
      ['meta', 'strokes', 'thumbs'],
      'readwrite',
      (t) =>
        new Promise<'added' | 'kept' | 'unchanged'>((ok, bad) => {
          const metaS = t.objectStore('meta'), strokeS = t.objectStore('strokes'), thumbS = t.objectStore('thumbs');
          const fail = (e: unknown) => {
            bad(e);
            try {
              t.abort();
            } catch {
              return;
            }
          };
          const put = (id: string) => {
            metaS.put(metaOf({ ...rec, id }), id);
            strokeS.put(rec.strokes, id);
            if (buf) thumbS.put({ type: 'image/jpeg', buf }, id);
          };
          const g = metaS.get(rec.id) as IDBRequest<DrawingMeta | undefined>;
          const c = metaS.get(cid) as IDBRequest<DrawingMeta | undefined>;
          g.onerror = () => bad(g.error);
          c.onerror = () => bad(c.error);
          c.onsuccess = () => {
            try {
              D = g.result;
              if (c.result) cid = `${cid}${Math.random().toString(36).slice(2, 6)}`;
              if (D && revOf(D) === me) return ok('unchanged');
              const tops = [D, M].filter((m): m is DrawingMeta => !!m).map((m) => (fin(m.updated) ? m.updated : -Infinity));
              if (!tops.length) {
                put(rec.id);
                return ok('added');
              }
              if (!(rec.updated > Math.max(...tops))) {
                at = cid;
                put(cid);
                return ok('kept');
              }
              if (!D) {
                put(rec.id);
                return ok('kept');
              }
              const was = D;
              const st = strokeS.get(rec.id) as IDBRequest<Stroke[] | undefined>;
              const th = thumbS.get(rec.id) as IDBRequest<{ type: string; buf: ArrayBuffer } | undefined>;
              st.onerror = () => bad(st.error);
              th.onerror = () => bad(th.error);
              th.onsuccess = () => {
                try {
                  if (st.result) {
                    metaS.put({ ...was, id: cid }, cid);
                    strokeS.put(st.result, cid);
                    if (th.result) thumbS.put(th.result, cid);
                    moved = { id: cid, rev: revOf(was) };
                  }
                  put(rec.id);
                  ok('kept');
                } catch (e) {
                  fail(e);
                }
              };
            } catch (e) {
              fail(e);
            }
          };
        }),
      () => 'failed' as const,
    );
    const memDrop = (id: string) => {
      this.mem.meta.delete(id);
      this.mem.strokes.delete(id);
      this.mem.thumbs.delete(id);
      this.dropUrl(id);
    };
    if (stored === 'failed') {
      // kept for this visit only: the newer version takes the page's id in memory (the stored one stays on disk and in
      // the Save Crystal), an older one becomes its own page, and a version only memory held moves aside first
      const disk = D ?? scanned;
      const there = [disk, M].filter((m): m is DrawingMeta => !!m);
      const newer = !there.length || rec.updated > Math.max(...there.map((m) => (fin(m.updated) ? m.updated : -Infinity)));
      at = newer ? rec.id : cid;
      if (newer && M && (!disk || revOf(M) !== revOf(disk)) && !this.landed.has(landKey(rec.id, revOf(M)))) {
        const ms = this.mem.strokes.get(rec.id), mt = this.mem.thumbs.get(rec.id);
        if (ms) {
          const to = this.copyId(rec.id);
          this.mem.meta.set(to, { ...M, id: to });
          this.mem.strokes.set(to, ms);
          if (mt) this.mem.thumbs.set(to, mt);
        }
      }
      this.mem.meta.set(at, metaOf({ ...rec, id: at }));
      this.mem.strokes.set(at, rec.strokes);
      if (thumb) this.mem.thumbs.set(at, thumb);
      this.dropUrl(at);
      this.drop();
      return { result: there.length ? 'kept' : 'added', at, wrote: false };
    }
    if (stored === 'unchanged') return { result: 'unchanged', at: rec.id, wrote: false };
    this.landed.add(landKey(at, me));
    if (moved) this.landed.add(landKey(moved.id, moved.rev));
    if (at === rec.id && M && revOf(M) !== me) {
      const ms = this.mem.strokes.get(rec.id), mt = this.mem.thumbs.get(rec.id);
      const onDisk = this.landed.has(landKey(rec.id, revOf(M))) || (moved && moved.rev === revOf(M));
      memDrop(rec.id);
      if (!onDisk && ms) {
        const to = this.copyId(rec.id);
        this.mem.meta.set(to, { ...M, id: to });
        this.mem.strokes.set(to, ms);
        if (mt) this.mem.thumbs.set(to, mt);
      }
    }
    this.dropUrl(rec.id);
    this.drop();
    return { result: stored, at, wrote: true, moved };
  }
}

const stores = new Map<string, ArtStore>();
/** One store per storage key, so the lab never touches the real drawings. */
export function artStore(key: string) {
  let s = stores.get(key);
  if (!s) stores.set(key, (s = new ArtStore(`${key}.art`)));
  return s;
}
