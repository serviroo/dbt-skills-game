import { parsePrefs, savePrefs, type AudioLevels, type VolumeCtrl } from '../audio/prefs';
import { AUDIO_KEY, BESIDE, MOMENT_LENGTHS, READ_SIZES, type MomentLength, type ReadSize } from '../core/stored-names';
import { write } from '../core/cleared';
import { artStore, cleanRec, skippedDrafts } from './artstore';
import { cleanChapter, cleanStory, skippedCards, storyStore, STORY_CAP, type Story } from './storystore';
import { isSkillId, normalize, type State, type Store } from './store';

interface Preferences {
  audio?: AudioLevels & { v: 1 };
  room?: { aquarium: boolean; words: boolean };
  safeLight?: 'up' | 'dim';
  readSize?: ReadSize;
  momentLength?: MomentLength;
}
const isLength = (v: unknown): v is MomentLength => (MOMENT_LENGTHS as readonly unknown[]).includes(v);
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const readSize = (x: unknown): x is ReadSize => (READ_SIZES as readonly unknown[]).includes(x);

export function exportPreferences(store: Store, volume?: VolumeCtrl) {
  const key = store.key;
  const preferences: Preferences = volume ? { audio: { v: 1, ...volume.snapshot() } } : {};
  let incomplete = false;
  try {
    const audio = localStorage.getItem(AUDIO_KEY);
    if (!volume) {
      const levels = parsePrefs(audio);
      preferences.audio = { v: 1, ...levels, muted: Object.hasOwn(store.state.setAt, 'sound') ? !store.state.settings.sound : levels.muted || !store.state.settings.sound };
    }
    const room = localStorage.getItem(`${key}${BESIDE.stealth}`);
    if (room !== null) {
      const value: unknown = JSON.parse(room);
      if (object(value)) preferences.room = { aquarium: value.aquarium === true, words: value.words === true };
    }
    const light = localStorage.getItem(`${key}${BESIDE.safeLight}`);
    if (light === 'up' || light === 'dim') preferences.safeLight = light;
    const size = localStorage.getItem(`${key}${BESIDE.readSize}`);
    if (readSize(size)) preferences.readSize = size;
    const length = localStorage.getItem(`${key}${BESIDE.momentLength}`);
    if (isLength(length)) preferences.momentLength = length;
  } catch {
    incomplete = true;
  }
  return { preferences, incomplete };
}

/** A copy of a save no version could read, kept beside the save (see Store.keepCopy): its key's ending, and its bytes. */
interface UnreadSave {
  at: string;
  raw: string;
}
const UNREAD_AT = /^[0-9A-Za-z_-]{1,60}$/;
/** Every copy this device keeps of a save it couldn't read, byte for byte, oldest first. */
function exportUnread(store: Store): { saves: UnreadSave[]; incomplete: boolean } {
  const kept = `${store.key}${BESIDE.unreadable}.`;
  const saves: UnreadSave[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const raw = k?.startsWith(kept) ? localStorage.getItem(k) : null;
      if (k && raw !== null) saves.push({ at: k.slice(kept.length), raw });
    }
  } catch {
    return { saves, incomplete: true };
  }
  return { saves: saves.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)), incomplete: false };
}

/**
 * Puts back the copies of unreadable saves a Save Crystal carries, byte for byte, each under the key it had. One already
 * here is left as it is; another copy under the same key gets a key of its own. False when one couldn't be written.
 */
export function restoreUnread(raw: unknown, store: Store) {
  if (!Array.isArray(raw)) return true;
  const kept = `${store.key}${BESIDE.unreadable}.`;
  let saved = true;
  for (const x of raw) {
    if (!object(x) || typeof x.at !== 'string' || !UNREAD_AT.test(x.at) || typeof x.raw !== 'string') continue;
    const bytes = x.raw;
    try {
      let at = x.at;
      for (let n = 2; ; n++) {
        const here = localStorage.getItem(kept + at);
        if (here === bytes) break;
        if (here === null) {
          const key = kept + at;
          write(() => {
            try {
              localStorage.setItem(key, bytes);
            } catch {
              saved = false;
            }
          });
          break;
        }
        at = `${x.at}-${n}`;
      }
    } catch {
      saved = false;
    }
  }
  return saved;
}

/** The Save Crystal of everything this device holds now, and what (if anything) couldn't be read into it. */
export async function makeCrystal(store: Store, volume?: VolumeCtrl): Promise<{ json: string; missing: string }> {
  volume?.flush();
  const art = artStore(store.key);
  const drawings = await art.exportAll();
  const unfinished = await art.exportDrafts();
  const { stories, chapters, cards, incomplete } = await storyStore(store.key).exportAll();
  const choices = exportPreferences(store, volume);
  // a save no version could read is kept beside this one: it goes in as it is, so clearing never loses it
  const unread = exportUnread(store);
  const missing = [store.readable && !unread.incomplete ? '' : 'progress', drawings.incomplete || unfinished.incomplete ? 'drawings' : '', incomplete ? 'stories' : '', choices.incomplete ? 'choices' : ''].filter(Boolean).join(' and ');
  const json = store.exportJSON({ art: drawings.records, drafts: unfinished.drafts, stories: { stories, chapters, cards }, preferences: choices.preferences, ...(unread.saves.length ? { unreadSaves: unread.saves } : {}), incomplete: !!missing });
  return { json, missing };
}

/**
 * What a Save Crystal holds for the player, to tell whether two hold the same: without the moment it was made, the
 * story revisions and the card ids (a copy recovered from unsaved words gets fresh ones every time it is read).
 */
export function crystalContent(json: string) {
  const raw = JSON.parse(json) as Record<string, unknown>;
  delete raw.exported;
  const told = raw.stories;
  if (object(told)) {
    const bare = (xs: unknown, k: string) => (Array.isArray(xs) ? xs.map((x) => (object(x) ? { ...x, [k]: undefined } : x)) : xs);
    told.stories = bare(told.stories, 'rev');
    told.chapters = bare(told.chapters, 'rev');
    if (object(told.cards)) told.cards = Object.fromEntries(Object.entries(told.cards).map(([k, v]) => [k, bare(v, 'id')]));
  }
  return JSON.stringify(raw);
}

export function restorePreferences(raw: unknown, store: Store, volume?: VolumeCtrl) {
  const prefs = object(raw) ? raw : {};
  try {
    volume?.flush();
    const audioRaw = localStorage.getItem(AUDIO_KEY);
    let destination: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(audioRaw ?? 'null');
      if (object(parsed) && parsed.v === 1) destination = parsed;
    } catch {}
    const audio = object(prefs.audio) && prefs.audio.v === 1 ? parsePrefs(JSON.stringify(prefs.audio)) : null;
    let saved = true;
    const levels = parsePrefs(audioRaw);
    let changed = false;
    if (audio) {
      for (const k of ['master', 'music', 'sfx'] as const) {
        if (typeof destination[k] !== 'number' || !Number.isFinite(destination[k])) { levels[k] = audio[k]; changed = true; }
      }
      if (typeof destination.muted !== 'boolean') { levels.muted ||= audio.muted; changed = true; }
    }
    if (!audio && typeof destination.muted !== 'boolean' && !store.state.settings.sound) { levels.muted = true; changed = true; }
    if (changed || volume) {
      const expected = volume ? volume.restore(levels) : levels;
      if (!volume) savePrefs(levels);
      const stored = parsePrefs(localStorage.getItem(AUDIO_KEY));
      saved = localStorage.getItem(AUDIO_KEY) !== null && (Object.keys(expected) as (keyof AudioLevels)[]).every((k) => stored[k] === expected[k]);
    }
    if (object(prefs.room)) {
      const roomRaw = localStorage.getItem(`${store.key}${BESIDE.stealth}`);
      const room: unknown = roomRaw === null ? {} : JSON.parse(roomRaw);
      if (object(room)) {
        const next = { ...room };
        for (const k of ['aquarium', 'words'] as const) if (!Object.hasOwn(room, k) && typeof prefs.room[k] === 'boolean') next[k] = prefs.room[k];
        if (JSON.stringify(next) !== JSON.stringify(room)) write(() => localStorage.setItem(`${store.key}${BESIDE.stealth}`, JSON.stringify(next)));
      }
    }
    if ((prefs.safeLight === 'up' || prefs.safeLight === 'dim') && localStorage.getItem(`${store.key}${BESIDE.safeLight}`) === null) {
      const light = prefs.safeLight;
      write(() => localStorage.setItem(`${store.key}${BESIDE.safeLight}`, light));
    }
    if (readSize(prefs.readSize) && localStorage.getItem(`${store.key}${BESIDE.readSize}`) === null) {
      const size = prefs.readSize;
      write(() => localStorage.setItem(`${store.key}${BESIDE.readSize}`, size));
    }
    if (isLength(prefs.momentLength) && localStorage.getItem(`${store.key}${BESIDE.momentLength}`) === null) {
      const length = prefs.momentLength;
      write(() => localStorage.setItem(`${store.key}${BESIDE.momentLength}`, length));
    }
    return saved;
  } catch {
    return false;
  }
}

export interface Peek {
  raw: Record<string, unknown>;
  data: State;
  name: string;
  began: number | null;
  made: number | null;
  skills: number;
  diaryDays: number;
  drawings: number;
  stories: number;
  incomplete: boolean;
  unreadable: boolean;
}

const stamp = (x: unknown) => (typeof x === 'number' && x > 0 && Number.isFinite(new Date(x).getTime()) ? x : null);
const isoStamp = (x: unknown) => {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(x)) return null;
  const t = Date.parse(x);
  return t > 0 && new Date(t).toISOString().slice(0, 19) === x.slice(0, 19) ? t : null;
};

function peekAt(raw: Record<string, unknown>, data: State): Peek {
  let unreadable = false;
  const art = Array.isArray(raw.art) ? raw.art : [];
  const drawings = new Set<string>();
  for (const x of art.slice(0, 10000)) {
    const r = cleanRec(x);
    if (r) drawings.add(r.id);
    else unreadable = true;
  }
  const told = object(raw.stories) ? raw.stories : {};
  const rs = Array.isArray(told.stories) ? told.stories : [];
  const rc = Array.isArray(told.chapters) ? told.chapters : [];
  const maxCh = STORY_CAP.stories * (STORY_CAP.chapters + 2);
  if (art.length > 10000 || rs.length > STORY_CAP.stories || rc.length > maxCh) unreadable = true;
  const stories = new Map<string, Story>();
  for (const x of rs.slice(0, STORY_CAP.stories)) {
    const s = cleanStory(x);
    if (!s) unreadable = true;
    else if (!stories.has(s.id) || s.updated > stories.get(s.id)!.updated) stories.set(s.id, s);
  }
  for (const x of rc.slice(0, maxCh)) if (!cleanChapter(x)) unreadable = true;
  if (skippedCards(told.cards) || skippedDrafts(raw.drafts)) unreadable = true;
  const skills = new Set<string>();
  for (const e of data.events) if ((e.k === 'skill' || e.k === 'card') && isSkillId(e.skill)) skills.add(e.skill);
  return {
    raw,
    data,
    name: data.settings.playerName,
    began: stamp(raw.created),
    made: isoStamp(raw.exported),
    skills: skills.size,
    diaryDays: Object.keys(data.diary).length,
    drawings: drawings.size,
    stories: [...stories.values()].filter((s) => !s.removed).length,
    incomplete: raw.incomplete === true,
    unreadable,
  };
}

export async function readCrystal(f: File): Promise<Peek | 'big' | 'unread' | 'wrong'> {
  if (f.size > 80 * 1024 * 1024) return 'big';
  let text: string;
  try {
    text = await f.text();
  } catch {
    return 'unread';
  }
  let raw: unknown = null;
  let data: State | null = null;
  try {
    raw = JSON.parse(text);
    data = normalize(raw);
  } catch {
    data = null;
  }
  return data && object(raw) ? peekAt(raw, data) : 'wrong';
}
