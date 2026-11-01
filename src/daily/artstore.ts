/**
 * Drawings live in IndexedDB on this device (strokes, plus a small JPEG thumbnail), drafts too, so a page survives
 * an app switch. If IndexedDB is unavailable the session keeps drawings in memory and the Art room says so.
 * Backups carry the strokes, not images: a restore re-renders every thumbnail from them.
 */
import { canvasBlob, INKS, PAGE, renderDrawing, STROKE_MODES, type Paper, type Stroke, type StrokeMode } from './ink';
import { connectionLost, READ_WAIT_MS, uid, validDay } from './store';
import { ART_DB, BESIDE, TAB_KEY } from '../core/stored-names';
import { canWrite, cleared, goneElsewhere, mayWrite, onClear, write as writeOut } from '../core/cleared';

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
  /**
   * Labels, which are not part of a version: when the name was last set, whether it is a favourite (shown first) and
   * when that was last set. Wherever two copies of a drawing meet, each label comes from the copy that set it last.
   */
  nameAt?: number;
  fav?: boolean;
  favAt?: number;
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
  /** The name and favourite it was stored with: a label set later elsewhere wins over the one saved. */
  labels: Labels;
}
type Labels = Pick<DrawingMeta, 'name' | 'nameAt' | 'fav' | 'favAt'>;

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

/** A stroke as it is stored on this device, in drafts and in a Save Crystal (see storedStroke). */
export interface StoredStroke {
  i: number;
  w: number;
  p: number[];
  m?: StrokeMode;
  q?: number[];
}
const STROKE_KEYS = ['i', 'w', 'p', 'm', 'q'];
/**
 * Each stroke read whose stored form isn't what this build would store for it (a tool, field, ink or size from a newer
 * build, or values past this build's limits), with that stored form. Strokes never change once drawn, so storedStroke
 * writes it back exactly as it came and this build never turns a newer build's stroke into one of its own (as store.ts
 * keeps a newer save's records, see AS_STORED there).
 */
const AS_STORED = new WeakMap<Stroke, unknown>();
/**
 * A stroke as it is stored. A brush stroke keeps the three fields it always had. A stroke made with another tool
 * keeps its points in q and an empty p, so a build from before tools skips it: it shows less, never a tool's stroke
 * painted as a brush line, and its saves can't turn one into a brush stroke.
 */
export function storedStroke(s: Stroke): StoredStroke {
  if (AS_STORED.has(s)) return AS_STORED.get(s) as StoredStroke;
  return s.m ? { i: s.i, w: s.w, p: [], m: s.m, q: s.p } : { i: s.i, w: s.w, p: s.p };
}

/**
 * Accepts anything JSON-parsed as stored strokes; drops what doesn't fit, clamps what does. A stroke made with a tool
 * this build doesn't know, or with fields it doesn't, is kept as it was stored; one it can't draw draws nothing.
 */
export function cleanStrokes(raw: unknown, kind: Paper): Stroke[] | null {
  if (!Array.isArray(raw)) return null;
  const { w, h } = PAGE[kind];
  const out: Stroke[] = [];
  for (const s of raw.slice(0, 20000)) {
    if (!isObj(s)) continue;
    // undefined: the brush; null: a tool this build doesn't know
    const m = s.m === undefined ? undefined : STROKE_MODES.includes(s.m as StrokeMode) ? (s.m as StrokeMode) : null;
    const unknown = m === null || Object.keys(s).some((k) => !STROKE_KEYS.includes(k));
    const src = m === null || !fin(s.i) || !fin(s.w) ? null : m ? s.q : s.p;
    const p: number[] = [];
    if (Array.isArray(src)) {
      for (let k = 0; k + 1 < Math.min(src.length, 400000); k += 2) {
        const x = src[k], y = src[k + 1];
        if (!fin(x) || !fin(y)) continue;
        p.push(Math.max(-w, Math.min(2 * w, x)), Math.max(-h, Math.min(2 * h, y)));
      }
    }
    if (!p.length && !unknown) continue;
    const st: Stroke = { i: fin(s.i) ? Math.max(0, Math.min(INKS.length - 1, Math.round(s.i))) : 0, w: fin(s.w) ? Math.max(1, Math.min(400, s.w)) : 1, p };
    if (m) st.m = m;
    if (JSON.stringify(storedStroke(st)) !== JSON.stringify(s)) AS_STORED.set(st, s);
    out.push(st);
  }
  return out;
}

/** The fields of a drawing and of a draft this build reads. Any other is kept as it was stored (see restOf). */
const REC_KEYS = ['id', 'kind', 'day', 't', 'updated', 'prompt', 'name', 'n', 'rev', 'from', 'nameAt', 'fav', 'favAt', 'strokes', 'bases', 'after'];
const DRAFT_KEYS = ['key', 'kind', 'editId', 'bases', 'base', 'prompt', 'strokes', 't'];
/** The fields of o this build doesn't read, as they were stored, so a newer build's fields stay on what this one writes. */
const restOf = (o: object, known: readonly string[]): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k)));
/** The fields of a drawing this build doesn't read, for a new version of it to carry on. */
export const extrasOf = (r: DrawingMeta) => restOf(r, REC_KEYS);
/** A drawing or a draft as it is stored and goes into a Save Crystal. */
export const storedRec = (r: DrawingRec) => ({ ...r, strokes: r.strokes.map(storedStroke) });
const storedDraft = (d: Draft) => ({ ...d, strokes: d.strokes.map(storedStroke) });
/**
 * Whether drawing a holds everything b does: each of b's fields but its labels, and b's strokes in their order among a's.
 * A re-stamp of b (see importOne) holds it with a time and lineage of its own.
 */
function holds(a: DrawingRec, b: DrawingRec, restamp = false) {
  const bare = (r: DrawingRec): Record<string, unknown> => ({ ...metaOf(r), id: '', n: 0, name: undefined, nameAt: undefined, fav: undefined, favAt: undefined, ...(restamp ? { updated: 0, from: undefined } : {}) });
  const fa = bare(a), fb = bare(b);
  if (Object.entries(fb).some(([k, v]) => JSON.stringify(fa[k]) !== JSON.stringify(v))) return false;
  return within(a.strokes, b.strokes);
}
/** Whether strokes a hold all of strokes b, in their order among a's. */
function within(a: Stroke[], b: Stroke[]) {
  const sa = a.map((s) => JSON.stringify(storedStroke(s)));
  let k = 0;
  for (const s of b) {
    const j = JSON.stringify(storedStroke(s));
    while (k < sa.length && sa[k] !== j) k++;
    if (k++ >= sa.length) return false;
  }
  return true;
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
    ...restOf(raw, REC_KEYS),
    id: raw.id,
    kind,
    day,
    t,
    updated: fin(raw.updated) ? raw.updated : t,
    prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 120) : undefined,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 24) : undefined,
    rev: revId(raw.rev),
    from: fromOf(raw.from),
    nameAt: fin(raw.nameAt) ? raw.nameAt : undefined,
    fav: typeof raw.fav === 'boolean' ? raw.fav : undefined,
    favAt: fin(raw.favAt) ? raw.favAt : undefined,
    n: strokes.length,
    strokes,
  };
}

const DRAFT_KEY = 120;
const DRAFT_CAP = 1000;
/** An unfinished drawing as a Save Crystal carries it, or null when it can't be read or holds no strokes. */
export function cleanDraft(raw: unknown): Draft | null {
  if (!isObj(raw) || typeof raw.key !== 'string' || !raw.key || raw.key.length > DRAFT_KEY) return null;
  const kind: Paper = raw.kind === 'ally' ? 'ally' : 'today';
  const strokes = cleanStrokes(raw.strokes, kind);
  if (!strokes?.length) return null;
  // fields in the order a draft is stored in, so one read back from a file is the same draft
  const d = { key: raw.key, kind } as Draft;
  if (typeof raw.editId === 'string' && raw.editId && raw.editId.length <= 40) d.editId = raw.editId;
  if (Array.isArray(raw.bases)) d.bases = raw.bases.filter((b): b is string => typeof b === 'string' && IDENT.test(b)).slice(-8);
  if (fin(raw.base)) d.base = raw.base;
  if (typeof raw.prompt === 'string') d.prompt = raw.prompt.slice(0, 120);
  else if (raw.prompt === null) d.prompt = null;
  d.strokes = strokes;
  d.t = fin(raw.t) ? raw.t : 0;
  // spread, not assigned, so each one stays a plain field: a stored "__proto__" can't become what d inherits from
  return { ...d, ...restOf(raw, DRAFT_KEYS) };
}
/** Drafts from a file that can't be read: unreadable ones and any past the cap. */
export function skippedDrafts(raw: unknown) {
  if (!Array.isArray(raw)) return 0;
  return Math.max(0, raw.length - DRAFT_CAP) + raw.slice(0, DRAFT_CAP).filter((x) => !cleanDraft(x)).length;
}

/** A page and the copies kept apart from it share this. */
const family = (id: string) => id.split('~')[0].slice(0, 26);
const landKey = (id: string, rev: string) => `${id}\n${rev}`;
const metaOf = (r: DrawingRec): DrawingMeta => ({ ...restOf(r, REC_KEYS), id: r.id, kind: r.kind, day: r.day, t: r.t, updated: r.updated, prompt: r.prompt, name: r.name, n: r.strokes.length, rev: r.rev, from: fromOf(r.from), nameAt: r.nameAt, fav: r.fav, favAt: r.favAt });
const setAt = (t: unknown) => (fin(t) ? t : -1);
/**
 * Each label from whichever side set it last; a tie keeps the first side's, except that a name beats none: a build from
 * before names saves a page without its name but keeps when it was set, while taking a name away always sets a later time.
 */
const newestLabels = (first: Labels, other: Labels): Labels => ({
  ...(setAt(other.nameAt) > setAt(first.nameAt) || (setAt(other.nameAt) === setAt(first.nameAt) && !first.name && !!other.name) ? { name: other.name, nameAt: other.nameAt } : { name: first.name, nameAt: first.nameAt }),
  ...(setAt(other.favAt) > setAt(first.favAt) ? { fav: other.fav, favAt: other.favAt } : { fav: first.fav, favAt: first.favAt }),
});
const sameLabels = (a: Labels, b: Labels) => a.name === b.name && a.nameAt === b.nameAt && a.fav === b.fav && a.favAt === b.favAt;
/**
 * The copy in use, with each label from whichever copy of the drawing (stored or in memory) set it last. Labels are not part
 * of a version, so one held in memory (storage couldn't write it) stays on a newer version saved elsewhere.
 */
const withLabels = <T extends DrawingMeta>(use: T, other: DrawingMeta | undefined): T => (other ? { ...use, ...newestLabels(use, other) } : use);
const detached = (d: Draft): Draft => {
  const { editId, bases, base, ...draft } = d;
  return draft;
};

/**
 * A removal waiting for its Undo to run out, kept beside the save so every tab hides it and a reload finishes it: the
 * version it hides (revOf), when, and the tab whose toast holds the Undo. Each drawing's has a key of its own
 * (BESIDE.artGone), so tabs removing different drawings at once never write over each other's.
 */
interface Gone {
  rev: string;
  at: number;
  tab: string;
}
/** Another tab's removal is finished here only after this long: that tab's own toast ends it in seconds, unless it closed. */
const GONE_WAIT = 60e3;
const sameGone = (a: Gone | null, b: Gone) => !!a && a.rev === b.rev && a.at === b.at && a.tab === b.tab;
/** A stored removal as it was written, or null when there is none or it can't be read. */
function readGone(raw: string | null): Gone | null {
  try {
    const g: unknown = JSON.parse(raw ?? 'null');
    return isObj(g) && typeof g.rev === 'string' && fin(g.at) && typeof g.tab === 'string' ? { rev: g.rev, at: g.at, tab: g.tab } : null;
  } catch {
    return null;
  }
}

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
  private tab: { id: string; ready: Promise<void> } | null = null;
  private claimMessage: ((data: Record<string, unknown>) => void) | null = null;
  private removals = new Set<(id: string) => void>();
  private changes = new Set<() => void>();
  /** This tab's removals waiting for their toast's Undo (stored beside the save too, when it can be). */
  private mine = new Map<string, Gone>();
  private sweepTimer = 0;
  private deleted = new Set<string>();
  /** Versions this copy saw land on disk (id + identity). A version in memory that is not here never reached disk. */
  private landed = new Set<string>();
  /** The newest draft write per key; an older one finishing later must not put its draft back in memory. */
  private draftTurns = new Map<string, number>();
  private draftTurn = 0;
  /** Writes under way, so a clear's check waits for them. */
  private writes = new Set<Promise<unknown>>();
  private onStorage = (e: StorageEvent) => {
    if (!e.key?.startsWith(`${this.goneKey}.`)) return;
    this.drop();
    this.changed();
    void this.sweep();
    if (e.oldValue !== null && e.newValue === null) void this.ended(e.key.slice(this.goneKey.length + 1));
  };

  constructor(
    readonly name: string,
    private goneKey: string,
  ) {
    onClear({ hold: () => Promise.allSettled([...this.writes]), clear: () => this.dispose() });
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(name);
        this.channel.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (isObj(data) && (data.type === 'tab-claim' || data.type === 'tab-owned')) this.claimMessage?.(data);
          else if (isObj(data) && data.type === 'removed' && typeof data.id === 'string') this.forget(data.id);
          else {
            this.drop();
            this.changed();
            // another tab hid a drawing: if that tab closes before its Undo runs out, this one finishes it
            if (isObj(data) && data.type === 'gone') void this.sweep();
          }
        };
      } catch {
        this.channel = null;
      }
    }
    if (typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
    this.db = this.connect(true);
    void this.sweep();
  }

  claimTab() {
    if (this.tab) return this.tab;
    const owner = uid();
    let id = uid();
    try {
      id = sessionStorage.getItem(TAB_KEY) || id;
    } catch {}
    const tab = (this.tab = { id, ready: Promise.resolve() });
    tab.ready = new Promise<void>((resolve) => {
      let timer = 0;
      const claim = () => {
        const id = tab.id;
        writeOut(() => {
          try {
            sessionStorage.setItem(TAB_KEY, id);
          } catch {}
        });
        this.announce({ type: 'tab-claim', id: tab.id, owner });
        clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = 0;
          resolve();
        }, 100);
      };
      this.claimMessage = (data) => {
        if (data.id !== tab.id || typeof data.owner !== 'string') return;
        if (data.type === 'tab-claim') {
          if (data.owner === owner) return;
          if (!timer || owner < data.owner) {
            this.announce({ type: 'tab-owned', id: tab.id, owner: data.owner });
            return;
          }
        } else if (data.owner !== owner) return;
        tab.id = uid();
        claim();
      };
      claim();
    });
    return tab;
  }

  /** This game's data is being cleared: the database closes so it can go, and nothing stays in memory. */
  private dispose() {
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage);
    const db = this.db;
    this.db = Promise.resolve(null);
    void db.then((d) => d?.close());
    try {
      this.channel?.close();
    } catch {
      /* already closed */
    }
    this.channel = null;
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    for (const m of Object.values(this.mem)) m.clear();
    this.landed.clear();
    this.draftTurns.clear();
    this.mine.clear();
    clearTimeout(this.sweepTimer);
    this.drop();
  }

  onRemove(fn: (id: string) => void) {
    this.removals.add(fn);
    return () => this.removals.delete(fn);
  }
  /** Calls fn when what the screens show may have changed: a save, a label, a removal, here or in another copy. */
  onChange(fn: () => void) {
    this.changes.add(fn);
    return () => this.changes.delete(fn);
  }
  private changed() {
    this.changes.forEach((fn) => fn());
  }
  private async ended(id: string) {
    if (this.deleted.has(id)) return;
    const disk = await this.tx(['meta'], 'readonly', (t) => req(t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>), () => null);
    if (disk === undefined && !this.deleted.has(id)) this.forget(id);
  }

  private forget(id: string) {
    this.deleted.add(id);
    this.mine.delete(id);
    this.mem.meta.delete(id);
    this.mem.strokes.delete(id);
    this.mem.thumbs.delete(id);
    for (const [key, d] of this.mem.drafts) if (d.editId === id) this.mem.drafts.set(key, detached(d));
    this.dropUrl(id);
    this.drop();
    this.removals.forEach((fn) => fn(id));
    this.changed();
  }

  /** Opens the database; a lost connection on open gets one more try (`again`). Null when there is none to use. */
  private connect(again: boolean): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('no idb');
        // this game's data is being cleared: opening would make the database again
        if (cleared()) return resolve(null);
        const open = indexedDB.open(this.name, ART_DB.version);
        open.onupgradeneeded = () => {
          const db = open.result;
          for (const s of ART_DB.stores) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        };
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
    if (cleared() || this.unreadable) return false;
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
    if (mode === 'readonly') return this.read(stores, fn, fallback);
    // a clear checking its Save Crystal holds writes; once it clears they never happen
    if (!canWrite() && !(await mayWrite())) return fallback();
    const job = this.run(stores, mode, fn, fallback);
    this.writes.add(job);
    void job.finally(() => this.writes.delete(job));
    return job;
  }

  /**
   * A read storage leaves unanswered past READ_WAIT_MS gets no answer, and the database is given up for the visit, as
   * one that couldn't be opened: nothing more is read from it, or written over what it couldn't read.
   */
  private read<T>(stores: string[], fn: (t: IDBTransaction) => Promise<T>, fallback: () => T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unanswered = new Promise<null>((done) => (timer = setTimeout(() => done(null), READ_WAIT_MS)));
    return Promise.race([this.run(stores, 'readonly', fn, fallback).then((v) => ({ v })), unanswered]).then((r) => {
      clearTimeout(timer);
      if (r) return r.v;
      this.db = Promise.resolve(null);
      this.persistent = false;
      this.unreadable = true;
      this.readFails++;
      return fallback();
    });
  }

  private async run<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>, fallback: () => T): Promise<T> {
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
    if (gen !== this.gen) return this.list();
    const byId = new Map(rows.map((m) => [m.id, m]));
    for (const m of this.mem.meta.values()) {
      const db = byId.get(m.id);
      byId.set(m.id, !db || m.updated > db.updated ? withLabels(m, db) : withLabels(db, m));
    }
    const out = [...byId.values()].sort((a, b) => b.t - a.t);
    // a list read while the drawings couldn't be read is not kept, so the next look reads again
    if (gen === this.gen && this.readFails === fails) this.cache = out;
    return out;
  }

  /** The drawings the screens show: every saved one but the versions waiting for a removal's Undo to run out. */
  async shown(): Promise<DrawingMeta[]> {
    const list = await this.list();
    const gone = this.gone();
    return list.filter((m) => gone[m.id]?.rev !== revOf(m) && this.mine.get(m.id)?.rev !== revOf(m));
  }
  async isShown(id: string) {
    return (await this.shown()).some((m) => m.id === id);
  }
  /**
   * Takes a drawing off every screen, in every tab, while its Undo lasts. Only the version they saw (rev) hides, so a
   * newer save of it, here or in another tab, shows again and stays. remove(id) finishes it; unhide(id) is the Undo.
   */
  hide(id: string, rev: string) {
    const g: Gone = { rev, at: Date.now(), tab: this.claimTab().id };
    this.mine.set(id, g);
    this.markGone(id, g);
    this.changed();
    this.announce({ type: 'gone' });
  }
  unhide(id: string) {
    const g = this.mine.get(id);
    if (!g) return;
    this.mine.delete(id);
    this.markGone(id, null, g);
    this.changed();
    this.announce();
  }
  /** The removals waiting for their Undo: as stored beside the save, and this tab's own. */
  private gone() {
    const out: Record<string, Gone> = Object.create(null);
    const at = `${this.goneKey}.`;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(at)) continue;
        const g = readGone(localStorage.getItem(k));
        if (g) out[k.slice(at.length)] = g;
      }
    } catch {
      /* unreadable: this tab's own still count */
    }
    for (const [id, g] of this.mine) out[id] ??= g;
    return out;
  }
  /** Stores the removal of id waiting for its Undo, or drops it (null); with `was`, only while it is still that one. */
  private markGone(id: string, g: Gone | null, was?: Gone) {
    const k = `${this.goneKey}.${id}`;
    writeOut(() => {
      try {
        if (g) localStorage.setItem(k, JSON.stringify(g));
        else if (!was || sameGone(readGone(localStorage.getItem(k)), was)) localStorage.removeItem(k);
      } catch {
        /* storage is full or off: this tab still hides its own */
      }
    });
  }
  /**
   * Finishes the removals whose Undo can no longer be taken: this tab's from before a reload (the toast went with the
   * page) and another tab's once GONE_WAIT has passed (that tab closed). The rest wait for their own tab's toast. Only the
   * tab channel makes a copy of this tab take an id of its own (claimTab), so with none, this tab's id may also be a live
   * copy's whose Undo is still up: its removals wait like another tab's.
   */
  private async sweep() {
    clearTimeout(this.sweepTimer);
    this.sweepTimer = 0;
    if (typeof window === 'undefined') return;
    const tab = this.claimTab();
    await tab.ready;
    const now = Date.now();
    let next = Infinity;
    for (const [id, g] of Object.entries(this.gone())) {
      if (this.mine.has(id)) continue;
      // a time far ahead means the clock stepped back since: it is not waiting on anyone
      const due = (g.tab === tab.id && !!this.channel) || g.at > now + GONE_WAIT ? now : g.at + GONE_WAIT;
      if (due <= now) await this.remove(id);
      else next = Math.min(next, due);
    }
    if (next < Infinity && !cleared()) this.sweepTimer = window.setTimeout(() => void this.sweep(), next - now + 50);
  }

  /**
   * Renames a drawing (an empty name goes back to none) or marks it a favourite. A label is not a new version of the
   * drawing, so it never sets one copy apart from another: each keeps when it was set, and the latest wins.
   */
  async setLabels(id: string, change: { name?: string; fav?: boolean }) {
    const now = Date.now();
    const wrote = await this.relabel(id, (m) => ({
      ...m,
      ...('name' in change ? { name: change.name?.trim().slice(0, 24) || undefined, nameAt: Math.max(now, setAt(m.nameAt) + 1) } : {}),
      ...(change.fav !== undefined ? { fav: change.fav, favAt: Math.max(now, setAt(m.favAt) + 1) } : {}),
    }));
    if (wrote) this.announce();
  }
  /**
   * Rewrites a stored drawing's labels with next(meta), in one transaction (null leaves them), on top of the labels this
   * copy holds in memory (one storage refused earlier), so the write stores those too; a copy in memory too.
   */
  private async relabel(id: string, next: (m: DrawingMeta) => DrawingMeta | null) {
    const wrote = await this.tx(
      ['meta'],
      'readwrite',
      (t) =>
        new Promise<boolean>((ok, bad) => {
          const s = t.objectStore('meta');
          const g = s.get(id) as IDBRequest<DrawingMeta | undefined>;
          g.onerror = () => bad(g.error);
          g.onsuccess = () => {
            try {
              const disk = g.result;
              if (!disk) return ok(false);
              const base = withLabels(disk, this.mem.meta.get(id));
              const m = next(base) ?? base;
              if (sameLabels(m, disk)) return ok(false);
              s.put(m, id);
              ok(true);
            } catch (e) {
              bad(e);
            }
          };
        }),
      () => null,
    );
    // a write that failed keeps the labels for this visit, as a failed save keeps a drawing: in the copy held in memory,
    // or in one taken from the disk now
    if (wrote === null && !this.mem.meta.has(id)) {
      const d = await this.onDisk(id);
      if (d && !this.mem.meta.has(id) && !this.deleted.has(id)) {
        this.mem.meta.set(id, metaOf(d));
        this.mem.strokes.set(id, d.strokes);
        this.landed.add(landKey(id, revOf(d)));
      }
    }
    const mm = this.mem.meta.get(id);
    const held = mm ? next(mm) : null;
    if (held) this.mem.meta.set(id, held);
    if (wrote || held) {
      this.drop();
      this.changed();
    }
    return wrote === true;
  }
  /** Brings the labels a copy from elsewhere set later into the stored drawing it matches. */
  private takeLabels(id: string, from: Labels) {
    return this.relabel(id, (m) => {
      const l = newestLabels(m, from);
      return sameLabels(l, m) ? null : { ...m, ...l };
    });
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
  private announce(data: unknown = 'changed') {
    try {
      this.channel?.postMessage(data);
    } catch {
      this.channel = null;
    }
  }

  async get(id: string): Promise<DrawingRec | null> {
    const gen = this.gen;
    const [m, s] = await this.tx(
      ['meta', 'strokes'],
      'readonly',
      (t) => Promise.all([req(t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>), req(t.objectStore('strokes').get(id) as IDBRequest<Stroke[] | undefined>)]),
      (): [DrawingMeta | undefined, Stroke[] | undefined] => [undefined, undefined],
    );
    if (gen !== this.gen) return this.get(id);
    const mm = this.mem.meta.get(id), ms = this.mem.strokes.get(id);
    if (mm && ms && (!m || !s || mm.updated > m.updated)) return { ...withLabels(mm, m), strokes: ms };
    return m && s ? { ...withLabels(m, mm), strokes: cleanStrokes(s, m.kind) ?? [] } : null;
  }

  /** The drawing stored under id, as it is on the disk (not this copy's memory). */
  private async onDisk(id: string): Promise<DrawingRec | null> {
    const [m, s] = await this.tx(
      ['meta', 'strokes'],
      'readonly',
      (t) => Promise.all([req(t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>), req(t.objectStore('strokes').get(id) as IDBRequest<unknown>)]),
      (): [DrawingMeta | undefined, unknown] => [undefined, undefined],
    );
    const strokes = m ? cleanStrokes(s, m.kind) : null;
    return m && strokes ? { ...m, strokes } : null;
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
  private async write(rec: DrawingRec, force = false): Promise<{ stored: 'wrote' | 'held' | 'copied' | 'failed'; prev: number | undefined; id: string; updated: number; rev: string; labels: Labels }> {
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
    const kept = rec.strokes.map(storedStroke);
    let prev: number | undefined;
    let decided = false;
    let same = false;
    // labels set later elsewhere (a rename in another tab while this one drew, or one held here when storage couldn't
    // write) stay
    let labels = newestLabels(rec, this.mem.meta.get(rec.id) ?? rec);
    const decide = (disk: DrawingMeta | undefined, read = true): 'copy' | 'write' => {
      decided = true;
      const seen = [disk, this.mem.meta.get(rec.id)].filter((m): m is DrawingMeta => !!m);
      const missing = !disk && (read ? !seen.length || this.deleted.has(rec.id) || seen.some((m) => this.landed.has(landKey(m.id, revOf(m)))) : this.deleted.has(rec.id));
      if (rec.bases !== undefined && (missing || seen.some((m) => !rec.bases!.includes(revOf(m))))) {
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
              t.objectStore('meta').put(metaOf({ ...rec, ...labels, id, updated: stamp, rev, from }), id);
              t.objectStore('strokes').put(kept, id);
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
              if (had) this.deleted.delete(rec.id);
              prev = had ? (fin(had.updated) ? had.updated : -Infinity) : undefined;
              if (!force) {
                same = !!had && revOf(had) === revOf({ rev, updated: stamp });
                if (same && buf) t.objectStore('thumbs').put({ type: 'image/jpeg', buf }, rec.id);
                return ok('held');
              }
              if (force) from = fromOf([...lineage(had), ...(from ?? [])]);
              if (had) labels = newestLabels(labels, had);
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
    if (force && stored === 'failed' && !decided) decide(undefined, false);
    // a write that failed, even before its transaction read the stored copy, keeps the labels that copy set later
    if (stored === 'failed') {
      const disk = await this.tx(['meta'], 'readonly', (t) => req(t.objectStore('meta').get(rec.id) as IDBRequest<DrawingMeta | undefined>), () => undefined);
      if (disk) labels = newestLabels(labels, disk);
    }
    const meta = metaOf({ ...rec, ...labels, id, updated: stamp, rev, from });
    const own = force && id !== rec.id ? this.mem.meta.get(rec.id) : undefined;
    if (own && rec.bases?.includes(revOf(own))) {
      this.mem.meta.delete(rec.id);
      this.mem.strokes.delete(rec.id);
      this.mem.thumbs.delete(rec.id);
      this.dropUrl(rec.id);
      // a name or favourite it held that storage couldn't write goes onto the stored version in its place
      await this.takeLabels(rec.id, own);
    }
    const mm = this.mem.meta.get(id);
    if (!this.deleted.has(id) && (force || ((stored === 'wrote' || stored === 'failed' || same) && (!mm || stamp >= mm.updated)))) {
      this.mem.meta.set(id, meta);
      this.mem.strokes.set(id, rec.strokes);
      if (thumb) this.mem.thumbs.set(id, thumb);
      else this.mem.thumbs.delete(id);
    }
    if (stored === 'wrote' || stored === 'copied' || same) this.landed.add(landKey(id, revOf(meta)));
    this.dropUrl(id);
    this.drop();
    return { stored, prev, id, updated: stamp, rev: revOf(meta), labels };
  }

  /**
   * Their own save always lands (a clock that stepped back can't drop it). A write that isn't theirs (a thumbnail filled in)
   * never replaces a stored version. `id` is where it landed: a new id when a newer version arrived while the player was
   * editing (`copied`).
   */
  async put(rec: DrawingRec): Promise<PutResult> {
    const { stored, id, updated, rev, labels } = await this.write(rec, true);
    if (stored === 'wrote' || stored === 'copied') this.announce();
    return { stored: stored === 'held' ? 'wrote' : stored, id, updated, rev, labels };
  }

  /**
   * Ends the Undo of a hidden drawing: it goes, and drafts of it become drafts of a new page, unless the version stored
   * now is not the one hidden (a newer save in any tab, or a restore, wins and stays). Nothing hidden, nothing happens.
   * The check and the delete share one transaction, so a save landing between them can't be lost.
   */
  async remove(id: string) {
    const g = this.mine.get(id) ?? this.gone()[id];
    if (!g) return;
    this.mine.delete(id);
    const mm = this.mem.meta.get(id);
    const out = await this.tx(
      ['meta', 'strokes', 'thumbs', 'drafts'],
      'readwrite',
      (t) =>
        new Promise<'removed' | 'kept'>((ok, bad) => {
          const r = t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>;
          r.onerror = () => bad(r.error);
          r.onsuccess = () => {
            try {
              const disk = r.result;
              const top = mm && (!disk || mm.updated > disk.updated) ? mm : disk;
              if (!top || revOf(top) !== g.rev) return ok('kept');
              for (const s of ['meta', 'strokes', 'thumbs']) t.objectStore(s).delete(id);
              const cursor = t.objectStore('drafts').openCursor();
              cursor.onerror = () => bad(cursor.error);
              cursor.onsuccess = () => {
                const c = cursor.result;
                if (!c) return ok('removed');
                if ((c.value as Draft).editId === id) c.update(detached(c.value as Draft));
                c.continue();
              };
            } catch (e) {
              bad(e);
            }
          };
        }),
      () => 'failed' as const,
    );
    // a write that failed with the database there leaves it hidden, for the next load to finish
    const db = out === 'failed' && !!(await this.db);
    if (db) this.mine.set(id, g);
    else this.markGone(id, null, g);
    if (out === 'removed' || (out === 'failed' && !db && (!mm || revOf(mm) === g.rev))) {
      this.forget(id);
      if (out === 'removed') this.announce({ type: 'removed', id });
    } else {
      this.changed();
      this.announce();
    }
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
    const d = cleanDraft(await this.tx(['drafts'], 'readonly', (t) => req(t.objectStore('drafts').get(key) as IDBRequest<unknown>), () => undefined));
    const m = this.mem.drafts.get(key);
    const best = d && m ? (m.t > d.t ? m : d) : (d ?? m);
    return best && Array.isArray(best.strokes) && best.strokes.length ? best : null;
  }

  async drafts(): Promise<Draft[]> {
    const gen = this.gen;
    const all = await this.tx(['drafts'], 'readonly', (t) => req(t.objectStore('drafts').getAll() as IDBRequest<unknown[]>), () => [] as unknown[]);
    if (gen !== this.gen) return this.drafts();
    const byKey = new Map(all.map(cleanDraft).filter((d): d is Draft => !!d).map((d) => [d.key, d]));
    for (const m of this.mem.drafts.values()) {
      const d = byKey.get(m.key);
      if (!d || m.t > d.t) byKey.set(m.key, m);
    }
    return [...byKey.values()].filter((d) => d.strokes?.length).sort((a, b) => b.t - a.t);
  }

  /** Whether an unfinished edit of saved drawing id stays one here (saved: it is stored): else it waits as a page of its own. */
  private keepsEdit(id: string, saved: boolean) {
    const m = this.mem.meta.get(id);
    return saved || (!!m && !this.deleted.has(id) && !this.landed.has(landKey(m.id, revOf(m))));
  }

  async putDraft(d: Draft) {
    const turn = ++this.draftTurn;
    this.draftTurns.set(d.key, turn);
    this.mem.drafts.set(d.key, d);
    await this.tx(['drafts', 'meta'], 'readwrite', async (t) => {
      if (d.editId && !this.keepsEdit(d.editId, !!(await req(t.objectStore('meta').get(d.editId))))) d = detached(d);
      t.objectStore('drafts').put(storedDraft(d), d.key);
    }, () => {
      if (d.editId && this.deleted.has(d.editId)) d = detached(d);
    });
    if (this.draftTurns.get(d.key) === turn) this.mem.drafts.set(d.key, d);
  }

  async dropDraft(key: string) {
    this.draftTurns.set(key, ++this.draftTurn);
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
    const out: ReturnType<typeof storedRec>[] = [];
    for (const id of ids) {
      const [m, s] = await this.tx(
        ['meta', 'strokes'],
        'readonly',
        (t) => Promise.all([req(t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>), req(t.objectStore('strokes').get(id) as IDBRequest<unknown>)]),
        (): [DrawingMeta | undefined, unknown] => [undefined, undefined],
      );
      const strokes = m ? cleanStrokes(s, m.kind) : null;
      const disk = m && strokes ? { ...m, strokes } : null;
      const mm = this.mem.meta.get(id), ms = this.mem.strokes.get(id);
      const mem = mm && ms ? { ...mm, strokes: ms } : null;
      // the version in use keeps the id (as get() picks it); a different one only memory holds goes in under its own id
      const main = mem && (!disk || mem.updated > disk.updated) ? mem : disk;
      if (main) out.push(storedRec(withLabels(main, main === disk ? mm : m)));
      if (!mem || !disk || revOf(mem) === revOf(disk) || (main === disk && this.landed.has(landKey(id, revOf(mem))))) continue;
      const other = main === mem ? disk : mem;
      const base = `${family(id)}~${Math.max(0, Math.floor(other.updated)).toString(36)}`;
      let cid = base;
      // numbered, not random, so the same drawings make the same Save Crystal
      for (let n = 2; used.has(cid); n++) cid = `${base}${n.toString(36)}`;
      used.add(cid);
      out.push(storedRec({ ...other, id: cid }));
    }
    return { records: out.sort((a, b) => a.t - b.t), incomplete: this.readFails > fails };
  }

  /** Every unfinished drawing, for the Save Crystal, read fresh. incomplete: the stored ones couldn't all be read. */
  async exportDrafts(): Promise<{ drafts: Draft[]; incomplete: boolean }> {
    const fails = this.readFails;
    const all = (await this.drafts()).sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : 1));
    return { drafts: all.map(storedDraft), incomplete: this.readFails > fails };
  }

  /**
   * Adds the unfinished drawings from a Save Crystal and never replaces one here: the same draft already here is left
   * as it is, a different one under the same key comes in under a key of its own, so both wait in the Art room. A draft
   * of a page that isn't here comes in as a fresh page (see putDraft). skipped counts the ones that can't be read.
   */
  async importDrafts(raw: unknown): Promise<{ added: number; skipped: number }> {
    const out = { added: 0, skipped: skippedDrafts(raw) };
    if (!Array.isArray(raw)) return out;
    const here = new Map<string, Draft>((await this.drafts()).map((d) => [d.key, d]));
    const drawnAs = (d: Draft) => JSON.stringify(d.strokes.map(storedStroke));
    const saved = new Set((await this.tx(['meta'], 'readonly', (t) => req(t.objectStore('meta').getAllKeys() as IDBRequest<IDBValidKey[]>), () => [] as IDBValidKey[])).map(String));
    // what each draft draws and the saved drawing it edits, as it is (or would be) kept here ('' once that drawing isn't
    // here, see putDraft), so one an earlier Restore put under a key of its own is recognised too
    const drawn = (d: Draft) => `${d.kind}\n${d.editId && this.keepsEdit(d.editId, saved.has(d.editId)) ? d.editId : ''}\n${drawnAs(d)}`;
    const held = new Set([...here.values()].map(drawn));
    for (const x of raw.slice(0, DRAFT_CAP)) {
      const d = cleanDraft(x);
      if (!d) continue;
      const had = here.get(d.key);
      if ((had && drawnAs(had) === drawnAs(d)) || held.has(drawn(d))) continue;
      let key = d.key;
      if (here.has(key)) {
        const base = `${d.key.slice(0, DRAFT_KEY - 12)}~${Math.max(0, Math.floor(d.t)).toString(36)}`;
        key = base;
        for (let n = 2; here.has(key); n++) key = `${base}${n.toString(36)}`;
      }
      await this.putDraft({ ...d, key });
      here.set(key, d);
      held.add(drawn(d));
      out.added++;
    }
    return out;
  }

  /** How many of these drawings exist on this device only in memory (no saved copy as new as the one in use, or with its labels). */
  private async memoryOnly(ids: string[]) {
    const saved = await this.tx(
      ['meta'],
      'readonly',
      (t) => Promise.all(ids.map((id) => req(t.objectStore('meta').get(id) as IDBRequest<DrawingMeta | undefined>))),
      () => ids.map((): DrawingMeta | undefined => undefined),
    );
    return ids.filter((id, i) => {
      const mm = this.mem.meta.get(id), db = saved[i];
      return !!mm && (!db || mm.updated > db.updated || !sameLabels(newestLabels(db, mm), db));
    }).length;
  }

  /**
   * Adds drawings from a backup and never replaces one. A version already here (under its id or a copy of it) is
   * unchanged, and so is one a page here was edited from, unless a build from before the tools made that edit and
   * dropped the tools' strokes: then the file's copy comes in as its own page. A different version of a page that is here keeps both: the newer one under the page's id, the other as
   * its own page, in one transaction. The same version stored here with other content was saved by a build that
   * couldn't read all of it: the file's copy updates it when it holds everything the one here does, and comes in with
   * the other kept as its own page when neither does; either way the page takes the file's copy as a version of its own
   * (see importOne), so no version ever holds two contents. Each drawing counts once as added, updated, kept (both
   * versions kept), unchanged or skipped (unreadable). unsaved counts the drawings from the file whose copy in use lives
   * only in memory for this session.
   */
  async importAll(raw: unknown): Promise<{ added: number; updated: number; kept: number; unchanged: number; skipped: number; unsaved: number }> {
    const out = { added: 0, updated: 0, kept: 0, unchanged: 0, skipped: 0, unsaved: 0 };
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
      const me = revOf(rec);
      const hit = known.get(family(rec.id))?.get(me);
      let at = rec;
      if (hit) {
        // the family's pages as they are now, so one a Restore in another tab moved aside meanwhile is still found
        const here = await this.familyNow(family(rec.id));
        const same = here.filter((d) => revOf(d) === me);
        // a page edited from this version holds it, unless a build from before the tools made the edit: that keeps the
        // strokes it can read and drops the tools' strokes, so the file's copy comes in as its own page. A page a Restore
        // re-stamped from this version (see importOne) holds only what it has.
        const later = here.filter((d) => fromOf(d.from)?.includes(me));
        const restamped = later.filter((d) => revId(d.rev) === revId(rec.rev));
        const edits = later.filter((d) => !restamped.includes(d));
        const lost = !edits.some((d) => within(d.strokes, rec.strokes)) && edits.some((d) => within(d.strokes, rec.strokes.filter((s) => !storedStroke(s).m)));
        const by = same.find((d) => holds(d, rec)) ?? restamped.find((d) => holds(d, rec, true)) ?? (!same.length && !lost ? edits[0] : undefined);
        if (by) {
          out.unchanged++;
          inUse.push(by.id);
          // a name or favourite the file's copy set later comes in all the same
          if (await this.takeLabels(by.id, rec)) wrote = true;
          continue;
        }
        // the same version here with other content: the file's copy meets the page that holds it (see importOne)
        if (same.length) at = { ...rec, id: (same.find((d) => d.id === rec.id) ?? same[0]).id };
      }
      const r = await this.importOne(at, diskMeta.get(at.id));
      out[r.result]++;
      if (r.wrote) wrote = true;
      inUse.push(r.at);
      note(r.at, me);
      for (const a of rec.from ?? []) note(r.at, a);
      if (r.moved) note(r.moved.id, r.moved.rev);
    }
    out.unsaved = await this.memoryOnly(inUse);
    this.drop();
    if (wrote) this.announce();
    return out;
  }

  /** The pages of family f as they are now: each stored one, and each this session holds in memory. */
  private async familyNow(f: string): Promise<DrawingRec[]> {
    const ids = await this.tx(['meta'], 'readonly', (t) => req(t.objectStore('meta').getAllKeys(IDBKeyRange.bound(f, `${f}￿`)) as IDBRequest<IDBValidKey[]>), () => [] as IDBValidKey[]);
    const all = new Set([...ids.map(String), ...this.mem.meta.keys()].filter((id) => family(id) === f));
    return (
      await Promise.all(
        [...all].map(async (id) => {
          const M = this.mem.meta.get(id), S = this.mem.strokes.get(id);
          return [await this.onDisk(id), M && S ? { ...M, strokes: S } : null];
        }),
      )
    )
      .flat()
      .filter((d): d is DrawingRec => !!d);
  }

  /**
   * One drawing from a backup that no page here holds; see importAll. `at` is where it landed. The same version stored
   * under its id with other content is updated when the file's copy holds all of it, and otherwise kept beside it.
   * Either way the page then holds other content than that version, so it is re-stamped: the same revision at a later
   * time, drawn from that version. Every screen showing the version stored here draws the page again, and a removal
   * waiting on that version leaves the page.
   */
  private async importOne(rec: DrawingRec, scanned: DrawingMeta | undefined): Promise<{ result: 'added' | 'updated' | 'kept' | 'unchanged'; at: string; wrote: boolean; moved?: { id: string; rev: string } }> {
    const me = revOf(rec);
    const thumb = await canvasBlob(renderDrawing(rec.strokes, rec.kind, THUMB_W), 'image/jpeg', 0.9);
    const buf = thumb ? await thumb.arrayBuffer() : null;
    const kept = rec.strokes.map(storedStroke);
    const M = this.mem.meta.get(rec.id);
    // the labels the version taking the page's id gets: the newest of the file's, the stored copy's and this copy's in
    // memory (one storage couldn't write), so none set later is lost when memory gives way to it
    const labelsAt = (stored?: Labels) => [stored, M].reduce<Labels>((l, m) => (m ? newestLabels(l, m) : l), rec);
    let cid = this.copyId(rec.id);
    let at = rec.id;
    let D: DrawingMeta | undefined;
    let same = false;
    let moved: { id: string; rev: string } | undefined;
    let relabeled = false;
    let restamp: Pick<DrawingMeta, 'updated' | 'from'> | undefined;
    const stored = await this.tx(
      ['meta', 'strokes', 'thumbs'],
      'readwrite',
      (t) =>
        new Promise<'added' | 'updated' | 'kept' | 'unchanged'>((ok, bad) => {
          const metaS = t.objectStore('meta'), strokeS = t.objectStore('strokes'), thumbS = t.objectStore('thumbs');
          const fail = (e: unknown) => {
            bad(e);
            try {
              t.abort();
            } catch {
              return;
            }
          };
          const put = (id: string, labels: Labels = rec, version?: Pick<DrawingMeta, 'updated' | 'from'>) => {
            metaS.put(metaOf({ ...rec, ...labels, ...version, id }), id);
            strokeS.put(kept, id);
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
              same = !!D && revOf(D) === me;
              const tops = [D, M].filter((m): m is DrawingMeta => !!m).map((m) => (fin(m.updated) ? m.updated : -Infinity));
              if (!same && !tops.length) {
                put(rec.id);
                return ok('added');
              }
              if (!same && !(rec.updated > Math.max(...tops))) {
                at = cid;
                put(cid);
                return ok('kept');
              }
              if (!D) {
                put(rec.id, labelsAt());
                return ok('kept');
              }
              const was = D;
              const st = strokeS.get(rec.id) as IDBRequest<Stroke[] | undefined>;
              const th = thumbS.get(rec.id) as IDBRequest<{ type: string; buf: ArrayBuffer } | undefined>;
              st.onerror = () => bad(st.error);
              th.onerror = () => bad(th.error);
              th.onsuccess = () => {
                try {
                  if (same) {
                    // decided from the version stored now, in this transaction, so a Restore running beside this one
                    // can't overwrite what that one wrote
                    const strokes = cleanStrokes(st.result, was.kind);
                    const page = strokes && { ...was, strokes };
                    if (page && holds(page, rec)) {
                      const l = newestLabels(was, labelsAt());
                      if (!sameLabels(l, was)) {
                        metaS.put({ ...was, ...l }, rec.id);
                        relabeled = true;
                      }
                      return ok('unchanged');
                    }
                    restamp = { updated: Math.max(rec.updated, ...tops) + 1, from: fromOf([...(was.from ?? []), ...(rec.from ?? []), me]) };
                    if (page && holds(rec, page)) {
                      put(rec.id, labelsAt(was), restamp);
                      return ok('updated');
                    }
                  }
                  if (st.result) {
                    metaS.put({ ...was, id: cid }, cid);
                    strokeS.put(st.result, cid);
                    if (th.result) thumbS.put(th.result, cid);
                    moved = { id: cid, rev: revOf(was) };
                  }
                  put(rec.id, labelsAt(was), restamp);
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
      this.mem.meta.set(at, metaOf({ ...rec, ...(at === rec.id ? labelsAt(disk) : {}), id: at }));
      this.mem.strokes.set(at, rec.strokes);
      if (thumb) this.mem.thumbs.set(at, thumb);
      this.dropUrl(at);
      this.drop();
      return { result: there.length ? 'kept' : 'added', at, wrote: false };
    }
    if (stored === 'unchanged') {
      if (relabeled) this.drop();
      return { result: 'unchanged', at: rec.id, wrote: relabeled };
    }
    // what this copy held of that version in memory is the stored one it replaced or moved aside
    if (same && at === rec.id && M && revOf(M) === me) memDrop(rec.id);
    this.landed.add(landKey(at, restamp ? revOf({ rev: rec.rev, updated: restamp.updated }) : me));
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
  if (!s) stores.set(key, (s = new ArtStore(`${key}${BESIDE.art}`, `${key}${BESIDE.artGone}`)));
  return s;
}
