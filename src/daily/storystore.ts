/**
 * Their stories live in IndexedDB on this device: each story, its chapters (pages plus one Notes chapter) and the
 * co-writer cards. Nothing here goes into the localStorage State; the only other place story text touches is the live
 * mirror of a chapter with unsaved words (one localStorage slot per page load and chapter, for crash safety).
 *
 * Every stored version carries a revision id. A save names the revisions it started from (bases); if the version this
 * device holds is one it never saw, theirs is kept beside it as "(kept copy)" instead of replacing it. `updated` is only
 * an order stamp, monotonic per copy of the app, so a clock that steps back can't hide their newest save.
 * If IndexedDB is unavailable or a write fails, this copy keeps what it couldn't store in memory and says so
 * (persistent = false); exports read both.
 */
import type { App } from './app';
import { connectionLost, uid, validDay } from './store';
import { BESIDE, STORY_DB } from '../core/stored-names';

export type CardMode = 'continue' | 'whatif' | 'polish' | 'questions';
export interface Story {
  id: string;
  title: string;
  created: number;
  updated: number;
  rev: string;
  chapters: string[];
  notes: string;
  removed?: number;
}
export interface Chapter {
  id: string;
  story: string;
  kind: (typeof CHAPTER_KINDS)[number];
  title: string;
  text: string;
  updated: number;
  rev: string;
}
export interface Card {
  id: string;
  mode: CardMode;
  text: string;
  t: number;
  sel?: { start: number; end: number; text: string };
}
export interface SaveResult {
  stored: 'wrote' | 'copied' | 'failed';
  id: string;
  rev: string;
  updated: number;
}
export interface Live {
  chapter: string;
  text: string;
  bases: string[];
  t: number;
}

export const STORY_CAP = { title: 120, chapterTitle: 80, text: 400000, stories: 500, chapters: 300, cards: 12, card: 1200 } as const;
export const CARD_MODES: CardMode[] = ['continue', 'whatif', 'polish', 'questions'];
export const CHAPTER_KINDS = ['page', 'notes'] as const;
const ID = /^[A-Za-z0-9~._-]{1,40}$/;
const KEPT = ' (kept copy)';
const MAX_STAMP = 8.64e15;
/** A list read from a file may run past the chapter cap (kept copies and merges can); hiding chapters would lose them. */
const LISTED = 2000;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const validId = (x: unknown): x is string => typeof x === 'string' && ID.test(x);
const stampOf = (x: unknown, fallback = 0) => (fin(x) ? Math.max(0, Math.min(MAX_STAMP, x)) : fallback);
const revOf = (x: unknown, updated: number) => (validId(x) ? x : `t${Math.round(updated).toString(36)}`);
const storyTitle = (x: unknown, fallback = '') => (typeof x === 'string' ? x.slice(0, STORY_CAP.title) : fallback);
const chapterTitle = (x: unknown, kind: Chapter['kind']) => (typeof x === 'string' ? x.slice(0, STORY_CAP.chapterTitle) : kind === 'notes' ? 'Notes' : 'Chapter');
const keptTitle = (t: string) => `${t.slice(0, STORY_CAP.chapterTitle - KEPT.length)}${KEPT}`;
const uniqIds = (xs: unknown[]) => [...new Set(xs.filter(validId))];
const newer = <T extends { updated: number }>(a: T | undefined, b: T | undefined) => (!a ? b : !b ? a : b.updated > a.updated ? b : a);
/** Every version a restore writes gets a rev of its own, so an editor still holding the file's rev can't write over it. */
const importRev = () => `imp~${uid()}`;

/** At most this many live mirrors per store key; past it a new one is refused, never one already there dropped. */
const LIVE_CAP = 50;
/**
 * This page load's id, fresh every load and never shared (a tab opened with window.open copies sessionStorage, so a
 * tab id there could be two tabs'): each load writes and clears only its own mirrors.
 */
const LOAD = (() => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* not a secure context */
  }
  return `${uid()}${Math.random().toString(36).slice(2, 10)}`;
})();

export function cleanStory(x: unknown): Story | null {
  if (!isObj(x) || !validId(x.id)) return null;
  const updated = stampOf(x.updated, stampOf(x.created));
  const notes = validId(x.notes) ? x.notes : '';
  const s: Story = {
    id: x.id,
    title: storyTitle(x.title, 'Untitled story'),
    created: stampOf(x.created, updated),
    updated,
    rev: revOf(x.rev, updated),
    chapters: (Array.isArray(x.chapters) ? uniqIds(x.chapters) : []).slice(0, LISTED),
    notes,
  };
  if (fin(x.removed) && x.removed > 0) s.removed = stampOf(x.removed);
  return s;
}

export function cleanChapter(x: unknown): Chapter | null {
  if (!isObj(x) || !validId(x.id) || !validId(x.story) || !CHAPTER_KINDS.includes(x.kind as Chapter['kind']) || typeof x.text !== 'string') return null;
  const kind = x.kind as Chapter['kind'];
  const updated = stampOf(x.updated);
  return { id: x.id, story: x.story, kind, title: chapterTitle(x.title, kind), text: x.text.slice(0, STORY_CAP.text), updated, rev: revOf(x.rev, updated) };
}

export function cleanCard(x: unknown): Card | null {
  if (!isObj(x) || !CARD_MODES.includes(x.mode as CardMode) || typeof x.text !== 'string') return null;
  const c: Card = { id: validId(x.id) ? x.id : uid(), mode: x.mode as CardMode, text: x.text.slice(0, STORY_CAP.card), t: stampOf(x.t) };
  const s = x.sel;
  if (isObj(s) && fin(s.start) && fin(s.end) && typeof s.text === 'string') c.sel = { start: Math.max(0, s.start), end: Math.max(0, s.end), text: s.text.slice(0, STORY_CAP.card) };
  return c;
}

function mergeCards(local: Card[], incoming: unknown[]) {
  const merged = new Map<string, Card>();
  for (const card of local) {
    const had = merged.get(card.id);
    if (!had || card.t > had.t) merged.set(card.id, card);
  }
  let skipped = Math.max(0, incoming.length - LISTED);
  for (const value of incoming.slice(0, LISTED)) {
    const card = cleanCard(value);
    if (!card) { skipped++; continue; }
    const had = merged.get(card.id);
    if (!had && merged.size >= STORY_CAP.cards) { skipped++; continue; }
    if (!had || card.t > had.t) merged.set(card.id, card);
  }
  return { cards: [...merged.values()], skipped };
}

function req<T>(r: IDBRequest) {
  return new Promise<T>((ok, bad) => {
    r.onsuccess = () => ok(r.result as T);
    r.onerror = () => bad(r.error);
  });
}

/** Where a decision reads and writes: one IndexedDB transaction, or this copy's memory when that isn't possible. */
interface View {
  story(id: string): Promise<Story | undefined>;
  chapter(id: string): Promise<Chapter | undefined>;
  /** The stored version and this copy's memory version apart (no stored one when the database can't be used). */
  versions(id: string): Promise<{ disk?: Chapter; mem?: Chapter }>;
  taken(id: string): Promise<boolean>;
  putStory(s: Story): void;
  putChapter(c: Chapter): void;
}

export class StoryStore {
  persistent = true;
  private db: Promise<IDBDatabase | null>;
  /** IndexedDB is here but couldn't be opened, so stories stored earlier can't be read this visit. */
  private unreadable = false;
  /** Reads of the stored stories that got no answer; exportAll compares it before and after. */
  private readFails = 0;
  private lost = new WeakSet<IDBDatabase>();
  private mem = { stories: new Map<string, Story>(), chapters: new Map<string, Chapter>(), cards: new Map<string, Card[]>(), days: new Set<string>() };
  private cardImports = new Set<string>();
  /** For a chapter kept only in memory: the revisions it was saved over (a stored one in this set is its own past). */
  private memBases = new Map<string, Set<string>>();
  /** The last stored version of each story this copy read, so a failed write still has the story to add to. */
  private lastStory = new Map<string, Story>();
  /** Chapters this copy took out of a list, so an older list held in memory doesn't bring them back. */
  private removedHere = new Set<string>();
  /** Where this copy took each of those chapters out, so a later save with new words puts it back in its place. */
  private removedAt = new Map<string, number>();
  private seen = new Map<string, number>();
  private cache: Story[] | null = null;
  private swept: Promise<void> | null = null;
  private gen = 0;
  private lastStamp = -Infinity;
  private lastCopy = 0;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<() => void>();

  constructor(
    readonly name: string,
    readonly liveKey: string,
  ) {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(name);
        this.channel.onmessage = () => {
          this.drop();
          this.listeners.forEach((f) => f());
        };
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
        const open = indexedDB.open(this.name, STORY_DB.version);
        open.onupgradeneeded = () => {
          const db = open.result;
          const [stories, chapters, ...plain] = STORY_DB.stores;
          if (!db.objectStoreNames.contains(stories)) db.createObjectStore(stories, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(chapters)) db.createObjectStore(chapters, { keyPath: 'id' }).createIndex(STORY_DB.chapterIndex, 'story');
          for (const s of plain) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
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
   * Runs fn in one transaction; null when there is no database or the transaction failed (then persistent turns false).
   * A lost connection is opened again once: a read runs again on the fresh one, and so does a write that never started.
   * A read that still gets no answer counts in readFails.
   */
  private async tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>): Promise<{ v: T } | null> {
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

  private idbView(t: IDBTransaction): View {
    const ss = t.objectStore('stories'), cs = t.objectStore('chapters');
    return {
      story: async (id) => {
        const d = await req<Story | undefined>(ss.get(id));
        if (d) this.lastStory.set(id, d);
        return this.join(d, this.mem.stories.get(id));
      },
      chapter: async (id) => newer(await req<Chapter | undefined>(cs.get(id)), this.mem.chapters.get(id)),
      versions: async (id) => ({ disk: await req<Chapter | undefined>(cs.get(id)), mem: this.mem.chapters.get(id) }),
      taken: async (id) => this.mem.chapters.has(id) || (await req<IDBValidKey | undefined>(cs.getKey(id))) !== undefined,
      putStory: (s) => void ss.put(s),
      putChapter: (c) => void cs.put(c),
    };
  }

  private memView(): View {
    return {
      story: async (id) => this.mem.stories.get(id) ?? this.lastStory.get(id),
      chapter: async (id) => this.mem.chapters.get(id),
      versions: async (id) => ({ mem: this.mem.chapters.get(id) }),
      taken: async (id) => this.mem.chapters.has(id),
      putStory: (s) => void this.mem.stories.set(s.id, s),
      putChapter: (c) => void this.mem.chapters.set(c.id, c),
    };
  }

  /** The stored story and the one this copy holds in memory as one: the newer one, plus chapters only the other lists. */
  private join(d: Story | undefined, m: Story | undefined): Story | undefined {
    if (!d || !m) return d ?? m;
    const top = m.updated > d.updated ? m : d, low = top === m ? d : m;
    const extra = low.chapters.filter((c) => !top.chapters.includes(c) && c !== top.notes && !this.removedHere.has(c));
    return extra.length ? { ...top, chapters: [...top.chapters, ...extra] } : top;
  }

  private stamp(...known: (number | undefined)[]) {
    let s = Math.max(Date.now(), this.lastStamp + 1);
    for (const k of known) if (fin(k)) s = Math.max(s, k + 1);
    return (this.lastStamp = s);
  }
  private above(s: number, k: number | undefined) {
    if (fin(k) && k >= s) this.lastStamp = Math.max(this.lastStamp, (s = k + 1));
    return s;
  }
  private note(x: { id: string; updated: number } | undefined | null) {
    if (x && fin(x.updated)) this.seen.set(x.id, Math.max(this.seen.get(x.id) ?? -Infinity, x.updated));
  }

  private async freeId(id: string, v: View) {
    const ms = (this.lastCopy = Math.max(Date.now(), this.lastCopy + 1));
    let out = `${id.split('~')[0].slice(0, 26)}~${ms.toString(36)}`;
    while (await v.taken(out)) out = `${out.slice(0, 35)}${Math.random().toString(36).slice(2, 6)}`;
    return out;
  }

  /** A story for a chapter whose story is gone (deleted elsewhere while it was open), so the chapter stays reachable. */
  private kept(id: string, stamp: number, v: View): Story {
    const notes: Chapter = { id: uid(), story: id, kind: 'notes', title: 'Notes', text: '', updated: stamp, rev: uid() };
    v.putChapter(notes);
    return { id, title: 'Kept story', created: stamp, updated: stamp, rev: uid(), chapters: [], notes: notes.id };
  }

  private drop() {
    this.cache = null;
    this.gen++;
  }
  private changed(announce: boolean) {
    this.drop();
    if (announce)
      try {
        this.channel?.postMessage('changed');
      } catch {
        this.channel = null;
      }
    this.listeners.forEach((f) => f());
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private async allStories(): Promise<Story[]> {
    const r = await this.tx(['stories'], 'readonly', (t) => req<Story[]>(t.objectStore('stories').getAll()));
    const byId = new Map<string, Story>();
    for (const s of r?.v ?? []) {
      byId.set(s.id, s);
      this.lastStory.set(s.id, s);
    }
    for (const m of this.mem.stories.values()) byId.set(m.id, this.join(byId.get(m.id), m)!);
    for (const s of byId.values()) this.note(s);
    return [...byId.values()];
  }

  async list(): Promise<Story[]> {
    if (this.cache) return this.cache;
    const gen = this.gen;
    const fails = this.readFails;
    const out = (await this.allStories()).filter((s) => !s.removed).sort((a, b) => b.updated - a.updated);
    if (gen === this.gen && this.readFails === fails) this.cache = out;
    return out;
  }

  async removed(): Promise<Story[]> {
    return (await this.allStories()).filter((s) => !!s.removed).sort((a, b) => (b.removed ?? 0) - (a.removed ?? 0));
  }

  async story(id: string): Promise<Story | null> {
    const r = await this.tx(['stories'], 'readonly', (t) => req<Story | undefined>(t.objectStore('stories').get(id)));
    if (r?.v) this.lastStory.set(id, r.v);
    const s = this.join(r?.v, this.mem.stories.get(id));
    this.note(s);
    return s ?? null;
  }

  async chapter(id: string): Promise<Chapter | null> {
    const r = await this.tx(['chapters'], 'readonly', (t) => req<Chapter | undefined>(t.objectStore('chapters').get(id)));
    const m = this.mem.chapters.get(id);
    this.note(r?.v);
    this.note(m);
    return newer(r?.v, m) ?? null;
  }

  /** The version written on this device only (never one held in memory), or null when there is none or it can't be read. */
  async onDisk(id: string): Promise<Chapter | null> {
    const r = await this.tx(['chapters'], 'readonly', (t) => req<Chapter | undefined>(t.objectStore('chapters').get(id)));
    return r?.v ?? null;
  }

  async create(title?: string): Promise<{ story: Story; first: Chapter }> {
    if ((await this.allStories()).length >= STORY_CAP.stories) throw new RangeError('This device already holds as many stories as it can.');
    const now = this.stamp();
    const sid = uid();
    const first: Chapter = { id: uid(), story: sid, kind: 'page', title: 'Chapter 1', text: '', updated: now, rev: uid() };
    const notes: Chapter = { id: uid(), story: sid, kind: 'notes', title: 'Notes', text: '', updated: now, rev: uid() };
    const story: Story = { id: sid, title: storyTitle(title).trim() ? storyTitle(title) : 'Untitled story', created: Date.now(), updated: now, rev: uid(), chapters: [first.id], notes: notes.id };
    const r = await this.tx(['stories', 'chapters'], 'readwrite', async (t) => {
      t.objectStore('stories').put(story);
      t.objectStore('chapters').put(first);
      t.objectStore('chapters').put(notes);
    });
    if (r) this.lastStory.set(sid, story);
    else {
      this.mem.stories.set(sid, story);
      this.mem.chapters.set(first.id, first);
      this.mem.chapters.set(notes.id, notes);
    }
    this.changed(!!r);
    return { story: { ...story, chapters: [...story.chapters] }, first: { ...first } };
  }

  /** Title and chapter order. If the story changed elsewhere since their bases, their order wins and chapters only it lists are added at the end. */
  async saveStory(s: Pick<Story, 'id' | 'title' | 'chapters'>, bases: string[]): Promise<SaveResult> {
    if (!isObj(s) || !validId(s.id)) throw new RangeError('That story id is not valid.');
    const title = storyTitle(s.title);
    const order = Array.isArray(s.chapters) ? uniqIds(s.chapters) : [];
    const baseSet = new Set(Array.isArray(bases) ? bases : []);
    const rev = uid();
    const memS = this.mem.stories.get(s.id);
    let stamp = this.stamp(this.seen.get(s.id), memS?.updated);
    const decide = async (v: View, versions: (Story | undefined)[], onDisk: boolean, hasDb: boolean) => {
      const conflict = versions.some((x) => !!x && !baseSet.has(x.rev));
      for (const x of versions) stamp = this.above(stamp, x?.updated);
      const known = await v.story(s.id);
      if (!known && !onDisk && hasDb) return null;
      const stored = known ?? this.kept(s.id, stamp, v);
      let chapters = order.filter((c) => c !== stored.notes);
      if (conflict) chapters = [...chapters, ...stored.chapters.filter((c) => !chapters.includes(c))];
      const next: Story = { ...stored, title, chapters, updated: stamp, rev };
      v.putStory(next);
      return next;
    };
    const r = await this.tx(['stories', 'chapters'], 'readwrite', async (t) => decide(this.idbView(t), [await req<Story | undefined>(t.objectStore('stories').get(s.id)), memS], true, true));
    if (r?.v) {
      this.mem.stories.delete(s.id);
      this.lastStory.set(s.id, r.v);
    } else await decide(this.memView(), [memS], false, (await this.db) !== null);
    for (const c of order) this.removedHere.delete(c);
    this.note({ id: s.id, updated: stamp });
    this.changed(!!r);
    return { stored: r ? 'wrote' : 'failed', id: s.id, rev, updated: stamp };
  }

  /**
   * Their chapter. Lands under its own id unless the version stored (or held in memory) is one their editor never had
   * (not in bases), or opts.copy asks for it: then the stored one stays as it is and theirs becomes a new chapter
   * "(kept copy)" right after it. A page taken out of the list comes back when the save brings new words.
   */
  async saveChapter(c: Pick<Chapter, 'id' | 'story' | 'kind' | 'title' | 'text'>, bases: string[], opts?: { copy?: boolean }): Promise<SaveResult> {
    if (!isObj(c) || !validId(c.id) || !validId(c.story)) throw new RangeError('That chapter id is not valid.');
    if (typeof c.text !== 'string' || c.text.length > STORY_CAP.text) throw new RangeError('That chapter is longer than this device can keep in one piece.');
    const kind: Chapter['kind'] = c.kind === 'notes' ? 'notes' : 'page';
    const title = chapterTitle(c.title, kind);
    const baseSet = new Set(Array.isArray(bases) ? bases : []);
    const rev = uid();
    const memC = this.mem.chapters.get(c.id);
    let stamp = this.stamp(this.seen.get(c.id), memC?.updated);
    let back = false;
    const decide = async (v: View, versions: (Chapter | undefined)[], stored: boolean, hasDb: boolean) => {
      const conflict = !!opts?.copy || versions.some((x) => !!x && !baseSet.has(x.rev));
      const prev = versions.reduce<Chapter | undefined>((a, x) => newer(a, x), undefined);
      for (const x of versions) stamp = this.above(stamp, x?.updated);
      let story = await v.story(c.story);
      if (!story && (stored || !hasDb)) {
        story = this.kept(c.story, stamp, v);
        if (kind === 'page' && !conflict) story.chapters.push(c.id);
      }
      if (!conflict) {
        v.putChapter({ id: c.id, story: c.story, kind, title, text: c.text, updated: stamp, rev });
        // (prev is unknown only when the stored version couldn't be read: then nothing is assumed to have changed)
        if (story && kind === 'page' && c.id !== story.notes && !story.chapters.includes(c.id) && (prev ? c.text !== prev.text : stored && c.text !== '')) {
          // taken out of the list while an editor still had it open: new words bring it back
          const list = [...story.chapters];
          const at = this.removedAt.get(c.id);
          list.splice(at === undefined ? list.length : Math.min(at, list.length), 0, c.id);
          v.putStory({ ...story, chapters: list, updated: Math.max(story.updated, stamp), rev: uid() });
          back = true;
        } else if (story) v.putStory({ ...story, updated: Math.max(story.updated, stamp) });
        return { stored: 'wrote' as const, id: c.id };
      }
      const id = await this.freeId(c.id, v);
      v.putChapter({ id, story: c.story, kind: 'page', title: keptTitle(title), text: c.text, updated: stamp, rev });
      if (!story) return { stored: 'copied' as const, id };
      const list = [...story.chapters];
      const at = list.indexOf(c.id);
      list.splice(at >= 0 ? at + 1 : list.length, 0, id);
      v.putStory({ ...story, chapters: list, updated: Math.max(story.updated, stamp), rev: uid() });
      return { stored: 'copied' as const, id };
    };
    const r = await this.tx(['stories', 'chapters'], 'readwrite', async (t) => decide(this.idbView(t), [await req<Chapter | undefined>(t.objectStore('chapters').get(c.id)), memC], true, true));
    let out: { stored: SaveResult['stored']; id: string };
    if (r) {
      out = r.v;
      if (memC && baseSet.has(memC.rev)) {
        this.mem.chapters.delete(c.id);
        this.memBases.delete(c.id);
      }
      this.mem.stories.delete(c.story);
    } else {
      const { id } = await decide(this.memView(), [memC], false, (await this.db) !== null);
      const had = this.memBases.get(id);
      this.memBases.set(id, new Set([...(had ?? []), ...baseSet]));
      out = { stored: 'failed', id };
    }
    if (back) {
      this.removedHere.delete(c.id);
      this.removedAt.delete(c.id);
    }
    this.note({ id: out.id, updated: stamp });
    this.changed(!!r);
    return { stored: out.stored, id: out.id, rev, updated: stamp };
  }

  /** Runs a change to one story's record (removal, put back, chapter list) in one transaction, or in memory. */
  private async mutate(id: string, fn: (s: Story) => Story | null) {
    const rev = uid();
    let stamp = this.stamp(this.seen.get(id), this.mem.stories.get(id)?.updated);
    const apply = (cur: Story | undefined) => {
      if (!cur) return null;
      stamp = this.above(stamp, cur.updated);
      const next = fn({ ...cur, chapters: [...cur.chapters] });
      return next ? { ...next, updated: stamp, rev } : null;
    };
    const r = await this.tx(['stories', 'chapters'], 'readwrite', async (t) => {
      const next = apply(await this.idbView(t).story(id));
      if (next) t.objectStore('stories').put(next);
      return next;
    });
    if (r) {
      if (!r.v) return;
      this.mem.stories.delete(id);
      this.lastStory.set(id, r.v);
    } else {
      const next = apply(this.mem.stories.get(id) ?? this.lastStory.get(id));
      if (!next) return;
      this.mem.stories.set(id, next);
    }
    this.note({ id, updated: stamp });
    this.changed(!!r);
  }

  remove(id: string) {
    return this.mutate(id, (s) => ({ ...s, removed: Date.now() }));
  }

  putBack(id: string) {
    return this.mutate(id, (s) => {
      if (!s.removed) return null;
      const next = { ...s };
      delete next.removed;
      return next;
    });
  }

  /** Deletes a removed story and its chapters for good. Does nothing to a story that isn't in the Removed list. */
  async deleteForever(id: string) {
    const cur = await this.story(id);
    if (!cur?.removed) return;
    const gone = new Set<string>();
    const r = await this.tx(['stories', 'chapters', 'cards'], 'readwrite', async (t) => {
      const keys = await req<IDBValidKey[]>(t.objectStore('chapters').index('story').getAllKeys(id));
      for (const k of keys) {
        if (typeof k === 'string') gone.add(k);
        t.objectStore('chapters').delete(k);
        t.objectStore('cards').delete(k);
      }
      for (const c of [...cur.chapters, cur.notes])
        if (c && !gone.has(c) && (await req<IDBValidKey | undefined>(t.objectStore('chapters').getKey(c))) === undefined) {
          gone.add(c);
          t.objectStore('cards').delete(c);
        }
      t.objectStore('stories').delete(id);
    });
    for (const ch of [...this.mem.chapters.values()])
      if (ch.story === id) {
        gone.add(ch.id);
        this.mem.chapters.delete(ch.id);
        this.mem.cards.delete(ch.id);
        this.memBases.delete(ch.id);
      }
    this.mem.stories.delete(id);
    this.lastStory.delete(id);
    // the player chose to delete the story, so its chapters' mirrors go too; a failed delete leaves it stored, mirrors and all
    if (r || !(await this.db)) {
      const index = this.liveIndex();
      for (const c of gone) for (const l of index.get(c) ?? []) this.dropLive(l.key, c);
    }
    this.changed(!!r);
  }

  async addChapter(storyId: string, title?: string): Promise<Chapter> {
    const cur = await this.story(storyId);
    if (!cur) throw new RangeError('That story is not on this device.');
    if (cur.chapters.length >= STORY_CAP.chapters) throw new RangeError('This story already holds as many chapters as it can.');
    const rev = uid();
    let stamp = this.stamp(cur.updated);
    const ch: Chapter = { id: uid(), story: storyId, kind: 'page', title: '', text: '', updated: stamp, rev: uid() };
    const decide = async (v: View) => {
      const s = (await v.story(storyId)) ?? cur;
      stamp = this.above(stamp, s.updated);
      ch.title = typeof title === 'string' && title.trim() ? chapterTitle(title, 'page') : `Chapter ${s.chapters.length + 1}`;
      ch.updated = stamp;
      v.putChapter(ch);
      const next = { ...s, chapters: [...s.chapters, ch.id], updated: stamp, rev };
      v.putStory(next);
      return next;
    };
    const r = await this.tx(['stories', 'chapters'], 'readwrite', async (t) => decide(this.idbView(t)));
    if (r) {
      this.mem.stories.delete(storyId);
      this.lastStory.set(storyId, r.v);
    } else await decide(this.memView());
    this.note(ch);
    this.changed(!!r);
    return { ...ch };
  }

  /** Takes a page out of the story's list; the chapter itself stays and putBackChapter returns it. Notes can't be removed. */
  removeChapter(storyId: string, chapterId: string) {
    this.removedHere.add(chapterId);
    return this.mutate(storyId, (s) => {
      if (chapterId === s.notes || !s.chapters.includes(chapterId)) return null;
      this.removedAt.set(chapterId, s.chapters.indexOf(chapterId));
      return { ...s, chapters: s.chapters.filter((c) => c !== chapterId) };
    });
  }

  async putBackChapter(storyId: string, chapterId: string, index: number) {
    const ch = await this.chapter(chapterId);
    if (!ch || ch.story !== storyId) return;
    this.removedHere.delete(chapterId);
    this.removedAt.delete(chapterId);
    await this.mutate(storyId, (s) => {
      if (chapterId === s.notes || s.chapters.includes(chapterId)) return null;
      const at = Math.max(0, Math.min(s.chapters.length, fin(index) ? Math.round(index) : s.chapters.length));
      s.chapters.splice(at, 0, chapterId);
      return s;
    });
  }

  async cards(chapterId: string): Promise<Card[]> {
    const m = this.mem.cards.get(chapterId);
    if (m && !this.cardImports.has(chapterId)) return m.map((c) => ({ ...c, ...(c.sel ? { sel: { ...c.sel } } : {}) }));
    const r = await this.tx(['cards'], 'readonly', (t) => req<unknown>(t.objectStore('cards').get(chapterId)));
    const disk = Array.isArray(r?.v) ? r.v.map(cleanCard).filter((c): c is Card => !!c) : [];
    const list = m ? mergeCards(disk, m).cards : disk;
    return list.map((c) => ({ ...c, ...(c.sel ? { sel: { ...c.sel } } : {}) }));
  }

  /** Keeps at most 12 (the newest by time when there are more), in the order given. */
  async putCards(chapterId: string, cards: Card[]) {
    if (!validId(chapterId)) return;
    this.cardImports.delete(chapterId);
    let list = (Array.isArray(cards) ? cards : []).map(cleanCard).filter((c): c is Card => !!c);
    if (list.length > STORY_CAP.cards) {
      const keep = new Set([...list].sort((a, b) => b.t - a.t).slice(0, STORY_CAP.cards));
      list = list.filter((c) => keep.has(c));
    }
    const r = await this.tx(['cards'], 'readwrite', async (t) => void t.objectStore('cards').put(list, chapterId));
    if (r) this.mem.cards.delete(chapterId);
    else this.mem.cards.set(chapterId, list);
  }

  /**
   * A chapter's unsaved words as the player types, written at once (localStorage is synchronous) so a crash or a killed app
   * loses nothing. One slot per page load and chapter (`<liveKey>.<load id>.<chapter id>`), so moving to another chapter
   * or another tab never writes over or clears one. False when it couldn't be written (storage full, more than a
   * chapter holds, or LIVE_CAP mirrors already waiting): nothing is cut short or pushed out, the caller says so.
   */
  setLive(l: Live): boolean {
    try {
      if (!isObj(l) || !validId(l.chapter) || typeof l.text !== 'string' || l.text.length > STORY_CAP.text) return false;
      const bases = (Array.isArray(l.bases) ? l.bases : []).filter(validId).slice(-64);
      const key = this.myLive(l.chapter);
      if (localStorage.getItem(key) === null && this.liveKeys().length >= LIVE_CAP) return false;
      localStorage.setItem(key, JSON.stringify({ chapter: l.chapter, text: l.text, bases, t: fin(l.t) ? l.t : Date.now() }));
      return true;
    } catch {
      return false;
    }
  }

  private myLive(chapterId: string) {
    return `${this.liveKey}.${LOAD}.${chapterId}`;
  }
  private isLiveKey(k: string) {
    return k.startsWith(`${this.liveKey}.`);
  }
  /** Every mirror slot of this store, from any page load. */
  private liveKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && this.isLiveKey(k)) keys.push(k);
    }
    return keys;
  }
  /** One mirror slot, if it holds a mirror of this chapter (of any chapter when none is named). */
  private readLive(key: string, chapterId?: string): Live | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const x: unknown = JSON.parse(raw);
      if (!isObj(x) || !validId(x.chapter) || (chapterId !== undefined && x.chapter !== chapterId) || typeof x.text !== 'string') return null;
      return { chapter: x.chapter, text: x.text.slice(0, STORY_CAP.text), bases: (Array.isArray(x.bases) ? x.bases : []).filter(validId), t: fin(x.t) ? x.t : 0 };
    } catch {
      this.readFails++;
      return null;
    }
  }
  /** Every mirror of this store by chapter, each slot read once. */
  private liveIndex() {
    const out = new Map<string, (Live & { key: string })[]>();
    try {
      for (const key of this.liveKeys()) {
        const l = this.readLive(key);
        if (l) out.set(l.chapter, [...(out.get(l.chapter) ?? []), { ...l, key }]);
      }
    } catch {
      this.readFails++;
    }
    return out;
  }

  /** This page load's mirror of the chapter, or null. */
  live(chapterId: string): Live | null {
    return this.readLive(this.myLive(chapterId), chapterId);
  }

  /** Every mirror of the chapter, from any page load (this load's first), each with its key. */
  lives(chapterId: string): (Live & { key: string })[] {
    let keys: string[];
    try {
      keys = this.liveKeys();
    } catch {
      return [];
    }
    const mine = this.myLive(chapterId);
    keys.sort((a, b) => (a === mine ? -1 : b === mine ? 1 : 0));
    const out: (Live & { key: string })[] = [];
    for (const k of keys) {
      const l = this.readLive(k, chapterId);
      if (l) out.push({ ...l, key: k });
    }
    return out;
  }

  /** Clears this page load's mirror of the chapter (never another load's), when given only if it holds exactly `text`. */
  clearLive(chapterId: string, text?: string) {
    this.dropLive(this.myLive(chapterId), chapterId, text);
  }

  /**
   * Once a chapter is open: drops every mirror of it whose words are stored now, and any other load's mirror that this
   * load's own mirror already holds word for word (built on all of its bases).
   */
  settleLives(chapterId: string, stored: string | null) {
    const mine = this.live(chapterId);
    const myKey = this.myLive(chapterId);
    for (const l of this.lives(chapterId)) {
      const held = !!mine && l.key !== myKey && l.text === mine.text && l.bases.every((b) => mine.bases.includes(b));
      if ((stored !== null && l.text === stored) || held) this.dropLive(l.key, chapterId, l.text);
    }
  }

  /**
   * Once per page load, when the Story Room opens: drops every mirror another load left whose words are stored now,
   * so mirrors nobody reopens never fill the LIVE_CAP slots. A mirror whose chapter isn't stored here, or can't be read
   * right now, stays: it may be the only copy of their words.
   */
  sweepLives(): Promise<void> {
    this.swept ??= (async () => {
      const own = `${this.liveKey}.${LOAD}.`;
      for (const [chapterId, ls] of this.liveIndex()) {
        const theirs = ls.filter((l) => !l.key.startsWith(own));
        if (!theirs.length) continue;
        const stored = await this.onDisk(chapterId).catch(() => null);
        if (!stored) continue;
        for (const l of theirs) if (l.text === stored.text) this.dropLive(l.key, chapterId, l.text);
      }
    })().catch(() => undefined);
    return this.swept;
  }

  /** The version of a chapter this copy holds only in memory (a write that failed), or null. */
  unsaved(id: string): Chapter | null {
    const m = this.mem.chapters.get(id);
    return m ? { ...m } : null;
  }

  /** Clears one mirror slot if it still holds this chapter (and, when given, exactly this text). */
  dropLive(key: string, chapterId: string, text?: string) {
    try {
      if (!this.isLiveKey(key)) return;
      const l = this.readLive(key, chapterId);
      if (l && (text === undefined || l.text === text)) localStorage.removeItem(key);
    } catch {
      /* nothing to clear */
    }
  }

  async markOpened(day: string) {
    if (!validDay(day)) return;
    this.mem.days.add(day);
    await this.tx(['days'], 'readwrite', async (t) => void t.objectStore('days').put(Date.now(), day));
  }

  async openedDays(): Promise<string[]> {
    const r = await this.tx(['days'], 'readonly', (t) => req<IDBValidKey[]>(t.objectStore('days').getAllKeys()));
    const days = new Set(this.mem.days);
    for (const k of r?.v ?? []) if (validDay(k)) days.add(k);
    return [...days].sort();
  }

  /**
   * Every story and chapter, removed ones included, read fresh. Where this copy holds a version in memory that differs
   * from the stored one and isn't built on it, both go out: the newer under its id, the other as a "(kept copy)".
   */
  async exportAll(): Promise<{ stories: Story[]; chapters: Chapter[]; cards: Record<string, Card[]>; incomplete: boolean }> {
    this.drop();
    const fails = this.readFails;
    const r = await this.tx(['stories', 'chapters', 'cards'], 'readonly', (t) => Promise.all([
      req<Story[]>(t.objectStore('stories').getAll()),
      req<Chapter[]>(t.objectStore('chapters').getAll()),
      req<IDBValidKey[]>(t.objectStore('cards').getAllKeys()),
      req<unknown[]>(t.objectStore('cards').getAll()),
    ]));
    const [ds, dc, cardKeys, cardValues] = r?.v ?? [[], [], [], []];
    const cards = new Map<string, Card[]>();
    let cardIncomplete = false;
    cardKeys.forEach((k, i) => {
      const value = cardValues[i];
      if (!validId(k) || !Array.isArray(value)) { cardIncomplete = true; return; }
      const merged = mergeCards([], value);
      cards.set(k, merged.cards);
      cardIncomplete ||= merged.skipped > 0;
    });
    for (const [k, v] of this.mem.cards) {
      if (this.cardImports.has(k)) {
        const merged = mergeCards(cards.get(k) ?? [], v);
        cards.set(k, merged.cards);
        cardIncomplete ||= merged.skipped > 0;
      } else cards.set(k, v);
    }
    const chapters = new Map(dc.map((c) => [c.id, c]));
    const after = new Map<string, string[]>();
    for (const m of this.mem.chapters.values()) {
      const d = chapters.get(m.id);
      if (!d || d.rev === m.rev) {
        chapters.set(m.id, newer(d, m)!);
        continue;
      }
      const top = m.updated > d.updated ? m : d, low = top === m ? d : m;
      chapters.set(m.id, top);
      if (low.text === top.text || (low === d && this.memBases.get(m.id)?.has(d.rev))) continue;
      const kid = `${m.id.split('~')[0].slice(0, 26)}~x${low.rev.replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}`;
      if (chapters.has(kid)) continue;
      chapters.set(kid, { ...low, id: kid, kind: 'page', title: keptTitle(low.title) });
      after.set(m.id, [kid]);
    }
    const stories = new Map(ds.map((s) => [s.id, s]));
    for (const m of this.mem.stories.values()) stories.set(m.id, this.join(stories.get(m.id), m)!);
    for (const [id, lives] of this.liveIndex()) {
      let original = chapters.get(id);
      const orphan = !original;
      if (!original) {
        const existing = [...stories.values()];
        const parent = existing.find((s) => s.notes === id || s.chapters.includes(id)) ?? (stories.size >= STORY_CAP.stories ? existing.find((s) => !s.removed) ?? existing[0] : undefined);
        const base = `${id.slice(0, 30)}~live`;
        let sid = base, n = 0;
        while (stories.has(sid)) sid = `${base}~${++n}`;
        let notes = `${id.slice(0, 28)}~notes`;
        n = 0;
        while (chapters.has(notes)) notes = `${id.slice(0, 28)}~notes~${++n}`;
        const updated = stampOf(Math.max(...lives.map((l) => l.t)));
        if (parent) {
          sid = parent.id;
          stories.set(sid, { ...parent, chapters: parent.notes === id || parent.chapters.includes(id) ? [...parent.chapters] : [...parent.chapters, id], removed: undefined, updated: Math.max(parent.updated, updated), rev: uid() });
        } else {
          stories.set(sid, { id: sid, title: 'Kept story', created: updated, updated, rev: uid(), chapters: [id], notes });
          chapters.set(notes, { id: notes, story: sid, kind: 'notes', title: 'Notes', text: '', updated, rev: uid() });
        }
        const kind = parent?.notes === id ? 'notes' : 'page';
        original = { id, story: sid, kind, title: kind === 'notes' ? 'Notes' : 'Chapter', text: '', updated, rev: uid() };
        chapters.set(id, original);
      }
      const texts = new Set([original.text, ...(after.get(id) ?? []).map((kid) => chapters.get(kid)!.text)]);
      let recovered = false;
      for (const l of [...lives].sort((a, b) => b.t - a.t || a.key.localeCompare(b.key))) {
        if (texts.has(l.text)) continue;
        texts.add(l.text);
        const updated = stampOf(Math.max(l.t, original.updated + 1));
        const rev = `live~${updated.toString(36)}`;
        if (!recovered && (l.bases.includes(original.rev) || orphan)) {
          chapters.set(id, { ...original, text: l.text, updated, rev });
          recovered = true;
        } else {
          const base = `${id.slice(0, 20)}~live${updated.toString(36)}`;
          let kid = base, n = 0;
          while (chapters.has(kid)) kid = `${base.slice(0, 34)}~${++n}`;
          chapters.set(kid, { ...original, id: kid, kind: 'page', title: keptTitle(original.title), text: l.text, updated, rev });
          after.set(id, [...(after.get(id) ?? []), kid]);
        }
      }
    }
    for (const [orig, kids] of after) {
      const sid = chapters.get(orig)?.story;
      const s = sid ? stories.get(sid) : undefined;
      if (!s) continue;
      const list = [...s.chapters];
      const at = list.indexOf(orig);
      list.splice(at >= 0 ? at + 1 : list.length, 0, ...kids);
      stories.set(s.id, { ...s, chapters: list });
    }
    return {
      stories: [...stories.values()].map((s) => ({ ...s, chapters: [...s.chapters] })).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1)),
      chapters: [...chapters.values()].map((c) => ({ ...c })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      cards: Object.fromEntries(cards),
      incomplete: this.readFails > fails || cardIncomplete,
    };
  }

  /**
   * Adds stories from a Save Crystal. Never removes and never overwrites silently: a chapter from the file that is newer
   * and reads differently takes its place and the version here stays as a "(kept copy)" right after it; an older or
   * identical one changes nothing, whatever kind of chapter it is. Every version written gets a fresh rev, so an editor
   * still holding the file's rev keeps a copy instead of writing over it. The file's Notes pointer is used only when it
   * names a notes chapter of that story in the same file. Story lists are united, the newer title wins. Counts are per story; skipped counts the
   * unreadable entries (and chapters whose story is in neither place); unsaved counts stories from the file that live
   * only in memory on this device for now.
   */
  async importAll(raw: unknown): Promise<{ added: number; updated: number; unchanged: number; skipped: number; unsaved: number }> {
    const out = { added: 0, updated: 0, unchanged: 0, skipped: 0, unsaved: 0 };
    if (!isObj(raw)) return out;
    this.drop();
    const rs = Array.isArray(raw.stories) ? raw.stories : [];
    const rc = Array.isArray(raw.chapters) ? raw.chapters : [];
    const maxCh = STORY_CAP.stories * (STORY_CAP.chapters + 2);
    out.skipped += Math.max(0, rs.length - STORY_CAP.stories) + Math.max(0, rc.length - maxCh);
    const fileStories = new Map<string, Story>();
    for (const x of rs.slice(0, STORY_CAP.stories)) {
      const s = cleanStory(x);
      if (!s) out.skipped++;
      else if (!fileStories.has(s.id) || s.updated > fileStories.get(s.id)!.updated) fileStories.set(s.id, s);
    }
    const byStory = new Map<string, Map<string, Chapter>>();
    for (const x of rc.slice(0, maxCh)) {
      const c = cleanChapter(x);
      if (!c) {
        out.skipped++;
        continue;
      }
      const m = byStory.get(c.story) ?? new Map<string, Chapter>();
      byStory.set(c.story, m);
      const had = m.get(c.id);
      if (!had || c.updated > had.updated) m.set(c.id, c);
    }
    const ids = [...new Set([...fileStories.keys(), ...byStory.keys()])];
    let wrote = false;
    let mirrors: Map<string, (Live & { key: string })[]> | null = null;
    for (const sid of ids) {
      const fs = fileStories.get(sid);
      const fcs = [...(byStory.get(sid)?.values() ?? [])];
      // the file's Notes pointer counts only when it names a notes chapter of this story in the same file
      const fileNotes = fs?.notes && fcs.some((c) => c.id === fs.notes && c.kind === 'notes') ? fs.notes : '';
      const fileList = fs ? fs.chapters.filter((c) => c !== fileNotes) : fcs.filter((c) => c.kind === 'page').map((c) => c.id);
      const merge = async (v: View) => {
        const local = await v.story(sid);
        if (!local && !fs) return { result: 'orphan' as const, n: fcs.length, written: new Map<string, Set<string>>() };
        let skipped = 0;
        let changed = false;
        const after: [string, string[]][] = [];
        const known = new Set<string>();
        /** The texts this restore wrote for each chapter id from the file (under that id or as its kept copy). */
        const written = new Map<string, Set<string>>();
        const mark = (id: string, text: string) => written.set(id, (written.get(id) ?? new Set()).add(text));
        const notesId = local ? local.notes : fileNotes;
        const extraNotes = local && fileNotes && fileNotes !== local.notes ? fileNotes : '';
        let extraAdded = false;
        for (const fc of fcs) {
          const { disk, mem } = await v.versions(fc.id);
          const lc = newer(disk, mem);
          if ((disk && disk.story !== sid) || (mem && mem.story !== sid)) {
            skipped++;
            continue;
          }
          if (!lc) {
            // the file's own Notes, when this story already has Notes here, comes in as a page (only if it says anything)
            if (fc.id === extraNotes && !fc.text) continue;
            known.add(fc.id);
            const kind = fc.id === notesId ? 'notes' : 'page';
            v.putChapter({ ...fc, kind, title: fc.id === extraNotes ? keptTitle(fc.title) : fc.title, rev: importRev() });
            mark(fc.id, fc.text);
            if (fc.id === extraNotes) extraAdded = true;
            changed = true;
            continue;
          }
          known.add(fc.id);
          if (fc.text !== lc.text && fc.updated > lc.updated) {
            // the stored version and the one in memory are two versions: each text that differs from the file's is kept
            // as its own copy, written in this same transaction before the file's text takes the id
            const keep: Chapter[] = [];
            for (const x of [disk, mem]) if (x && x.text !== fc.text && !keep.some((k) => k.text === x.text)) keep.push(x);
            const kids: string[] = [];
            for (const x of keep) {
              const kid = await this.freeId(fc.id, v);
              v.putChapter({ ...x, id: kid, kind: 'page', title: keptTitle(x.title), rev: uid() });
              kids.push(kid);
              mark(fc.id, x.text);
            }
            v.putChapter({ ...fc, kind: lc.kind, rev: importRev() });
            mark(fc.id, fc.text);
            after.push([fc.id, kids]);
            changed = true;
          }
        }
        let next: Story;
        if (!local) {
          const notes = fileNotes && known.has(fileNotes) ? fileNotes : '';
          next = { ...fs!, chapters: fileList.filter((c) => known.has(c) && c !== notes), notes };
          if (!next.notes) {
            const n: Chapter = { id: uid(), story: sid, kind: 'notes', title: 'Notes', text: '', updated: next.updated, rev: uid() };
            v.putChapter(n);
            next.notes = n.id;
          }
          changed = true;
        } else {
          next = { ...local, chapters: [...local.chapters] };
          const add = fileList.filter((c) => known.has(c) && c !== local.notes && c !== extraNotes && !next.chapters.includes(c));
          if (extraAdded && !next.chapters.includes(extraNotes)) add.push(extraNotes);
          if (add.length) {
            next.chapters.push(...add);
            changed = true;
          }
          if (fs && fs.updated > local.updated) {
            if (fs.title !== local.title) changed = true;
            next.title = fs.title;
            if (local.removed && !fs.removed) {
              changed = true;
              delete next.removed;
            }
            next.updated = fs.updated;
          }
        }
        for (const [orig, kids] of after) {
          const at = next.chapters.indexOf(orig);
          next.chapters.splice(at >= 0 ? at + 1 : next.chapters.length, 0, ...kids);
        }
        if (changed && local) next = { ...next, rev: uid(), updated: this.stamp(next.updated, local.updated) };
        if (changed) v.putStory(next);
        return { result: !local ? ('added' as const) : changed ? ('updated' as const) : ('unchanged' as const), n: skipped, written };
      };
      const r = await this.tx(['stories', 'chapters'], 'readwrite', async (t) => merge(this.idbView(t)));
      const res = r ? r.v : await merge(this.memView());
      if (res.result === 'orphan') {
        out.skipped += res.n;
        continue;
      }
      out.skipped += res.n;
      out[res.result]++;
      if (r && res.result !== 'unchanged') {
        wrote = true;
        this.mem.stories.delete(sid);
        // a version held only in memory (and a mirror of it) goes only once this restore put that exact text on disk
        for (const fc of fcs) {
          const w = res.written.get(fc.id);
          if (!w) continue;
          const m = this.mem.chapters.get(fc.id);
          if (m && m.story === sid && w.has(m.text)) {
            this.mem.chapters.delete(fc.id);
            this.memBases.delete(fc.id);
          }
          for (const l of (mirrors ??= this.liveIndex()).get(fc.id) ?? []) if (w.has(l.text)) this.dropLive(l.key, fc.id, l.text);
        }
      }
      if (!r || this.mem.stories.has(sid) || [...this.mem.chapters.values()].some((m) => m.story === sid)) out.unsaved++;
    }
    if (isObj(raw.cards)) {
      const entries = Object.entries(raw.cards);
      out.skipped += Math.max(0, entries.length - maxCh);
      for (const [id, list] of entries.slice(0, maxCh)) {
        if (!validId(id) || !Array.isArray(list)) {
          out.skipped++;
          continue;
        }
        const r = await this.tx(['cards'], 'readwrite', async (t) => {
          const store = t.objectStore('cards');
          const disk = await req<unknown>(store.get(id));
          const local = Array.isArray(disk) ? disk.map(cleanCard).filter((c): c is Card => !!c) : [];
          const memory = this.mem.cards.get(id);
          const pending = memory && !this.cardImports.has(id) ? { cards: memory, skipped: 0 } : mergeCards(local, memory ?? []);
          const merged = mergeCards(pending.cards, list);
          store.put(merged.cards, id);
          return { ...merged, pendingSkipped: pending.skipped };
        });
        if (r) {
          if (r.v.pendingSkipped) out.unsaved++;
          else {
            this.mem.cards.delete(id);
            this.cardImports.delete(id);
          }
          out.skipped += r.v.skipped + r.v.pendingSkipped;
          wrote = true;
        } else {
          const explicitPending = this.mem.cards.has(id) && !this.cardImports.has(id);
          const merged = mergeCards(await this.cards(id), list);
          this.mem.cards.set(id, merged.cards);
          if (!explicitPending) this.cardImports.add(id);
          out.skipped += merged.skipped;
          out.unsaved++;
        }
      }
    }
    this.changed(wrote);
    return out;
  }
}

const stores = new Map<string, StoryStore>();
/** One store per storage key, so the lab never touches their real stories. */
export function storyStore(key: string) {
  let s = stores.get(key);
  if (!s) stores.set(key, (s = new StoryStore(`${key}${BESIDE.story}`, `${key}${BESIDE.storyLive}`)));
  return s;
}

/**
 * The first time the player opens their stories on a day: +10 XP, once (the event id is the day, so two open copies can't both
 * add it). The day is also kept with their stories, so a day whose event went missing (a build that didn't know story
 * events dropped them) is added back on the next open. Returns the XP added for today (10 or 0).
 */
export function creditStory(app: App): number {
  const st = app.store;
  st.sync();
  const today = st.today();
  const has = (day: string) => st.state.events.some((e) => e.id === `story-${day}` || (e.k === 'story' && e.day === day));
  let got = 0;
  if (!has(today)) {
    st.add('story', 10, { id: `story-${today}`, day: today });
    got = 10;
  }
  const s = storyStore(st.key);
  void (async () => {
    await s.markOpened(today);
    const missing = (await s.openedDays()).filter((d) => !has(d));
    if (!missing.length) return;
    st.sync();
    const now = st.now();
    for (const day of missing) if (!has(day)) st.state.events.push({ id: `story-${day}`, t: now, day, k: 'story', xp: 10 });
    st.state.events.sort((a, b) => a.t - b.t);
    st.save();
  })().catch(() => undefined);
  return got;
}
