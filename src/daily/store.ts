/**
 * Local-only storage for the companion. Versioned JSON in localStorage, nothing is ever sent anywhere.
 * Progress comes from an append-only event log: XP, stats, rank and the card collection are derived from it,
 * and no code path writes a negative amount or removes an event.
 */
import { MODULES, ROTATION, SKILL, type Quest, type StatId } from '../content/dbt';
import { DAILY_GIFTS, WARDEN_XP, RANK_XP, RANKS, STAT_BASE, TODAY_LINES, type DayLine } from '../content/daily-lines';
import { ACCENT_IDS, CARD_BACK_IDS, PLATE_IDS, SHADOW_IDS, THEME_IDS, TITLE_IDS, type AccentId, type CardBackId, type PlateId, type ShadowId, type ThemeId, type TitleId } from '../content/roster-lines';
import { cleanName, readYou, writeYou } from '../core/you';
import { APP_ID, BESIDE, SAVE_KEY, YOU_KEY } from '../core/stored-names';

export const SCHEMA = 1;
const CRYSTAL_SCHEMA = 2;
export const ROW_CAP = { emotions: 24, urges: 16 } as const;
const DAY_TURN_HOURS = 6;
/** Cards in the rotation before card events recorded their slot: older card events were dealt from these. */
const OLD_ROTATION = 30;

export type EvKind = 'visit' | 'skill' | 'checkin' | 'diary' | 'safe' | 'rest' | 'card' | 'feedback' | 'art' | 'line' | 'story';
export const EV_KINDS: EvKind[] = ['visit', 'skill', 'checkin', 'diary', 'safe', 'rest', 'card', 'feedback', 'art', 'line', 'story'];
export const EV_DATA = { checkin: ['feel', 'level'], feedback: ['answer'], art: ['kind'], rest: ['title', 'quiet'], line: ['id'], card: ['slot', 'special'] } as const satisfies Partial<Record<EvKind, readonly string[]>>;
type EvData<K extends EvKind> = Partial<Record<K extends keyof typeof EV_DATA ? (typeof EV_DATA)[K][number] : never, string | number | boolean | null>>;
export const MOTIONS = ['system', 'reduce', 'full'] as const;
export interface Ev {
  id: string;
  t: number;
  day: string;
  k: EvKind;
  xp: number;
  stat?: StatId;
  skill?: string;
  data?: Record<string, string | number | boolean | null>;
}
export interface Item {
  id: string;
  text: string;
  /** When it was added or brought back; a removal newer than this hides it in every copy. */
  at?: number;
}
export interface Person {
  id: string;
  name: string;
  phone: string;
  at?: number;
}
export interface SavedMap {
  id: string;
  t: number;
  urge: string;
  p1: string;
  c1: string;
  p2: string;
  c2: string;
  choice: string;
  at?: number;
}
export interface DiaryEntry {
  day: string;
  emotions: Record<string, number | null>;
  urges: Record<string, number | null>;
  note: string;
  updatedAt: number;
  /** When each field was last set: 'e:<row>', 'u:<row>', 'note'. A field without a time takes updatedAt. */
  ft?: Record<string, number>;
}
/** One per day the player picked a line. Changing today's pick replaces today's entry; older days stay as they were. */
export interface LineEntry {
  day: string;
  id: string;
  tag: string;
  text: string;
  t: number;
}
export interface Settings {
  sound: boolean;
  motion: (typeof MOTIONS)[number];
  emotionRows: string[];
  urgeRows: string[];
  theme: ThemeId;
  accent: AccentId;
  cardBack: CardBackId;
  plate: PlateId;
  /** '' = the newest title the player has earned */
  title: TitleId | '';
  /** The player's own name and their companion's ('' = the default shows). Mirrored for the intro by core/you. */
  playerName: string;
  companion: string;
  /** Their names for the roster shadows (each its own choice, 'name:<id>' in setAt). No entry = no name. */
  names: Partial<Record<ShadowId, string>>;
  /**
   * The country whose crisis lines the Safe Zone shows ('' = follow the device language). An id this build doesn't
   * know is kept and shows "Somewhere else".
   */
  region: string;
}
export interface Flags {
  rankSeen: number;
  wardenSeen: boolean;
  giftDay: string;
  cardDay: string;
  greetDay: string;
  safeCredit: boolean;
  therapistLineShown: boolean;
  checkinDay: string;
  /** Titles whose unlock line was already shown. Only grows. */
  titlesSeen: TitleId[];
}
/** Choices one copy can change and another must take whole: the later change wins. */
export type NameKey = `name:${ShadowId}`;
export type SetKey = 'sound' | 'motion' | 'emotionRows' | 'urgeRows' | 'safeCredit' | 'region' | 'theme' | 'accent' | 'cardBack' | 'plate' | 'title' | 'playerName' | 'companion' | NameKey;
/** The choices round 9 stores in settings and setAt. */
const BASE_SET_KEYS: SetKey[] = ['sound', 'motion', 'emotionRows', 'urgeRows', 'safeCredit'];
/** Wave 2 choices. Stored in the top-level profile (with titlesSeen), which a round 9 copy keeps whole instead of dropping. */
const PROFILE_SET_KEYS: SetKey[] = ['region', 'theme', 'accent', 'cardBack', 'plate', 'title', 'playerName', 'companion', ...SHADOW_IDS.map((id): NameKey => `name:${id}`)];
const SET_KEYS: SetKey[] = [...BASE_SET_KEYS, ...PROFILE_SET_KEYS];
export { cleanName };
const LIST_KEYS = ['comfort', 'activities', 'reasons', 'people'] as const;
const DAY_FLAGS = ['giftDay', 'cardDay', 'greetDay', 'checkinDay'] as const;
const GONE_CAP = 1000;
/** Top-level fields this build reads (and the ones only a Save Crystal carries); any other is kept as it was stored. */
const KNOWN = new Set(['v', 'created', 'events', 'diary', 'lists', 'maps', 'lines', 'settings', 'flags', 'gone', 'setAt', 'profile', 'app', 'exported', 'art', 'stories', 'preferences', 'incomplete']);
export interface State {
  v: number;
  created: number;
  events: Ev[];
  diary: Record<string, DiaryEntry>;
  lists: { comfort: Item[]; activities: Item[]; reasons: Item[]; people: Person[] };
  maps: SavedMap[];
  lines: LineEntry[];
  settings: Settings;
  flags: Flags;
  /** Removed list items and maps by id, with when they were removed. */
  gone: Record<string, number>;
  /** When each choice was last changed here (missing = never, as in data saved before this existed). */
  setAt: Partial<Record<SetKey, number>>;
}

export function freshState(now = Date.now()): State {
  return {
    v: SCHEMA,
    created: now,
    events: [],
    diary: {},
    lists: { comfort: [], activities: [], reasons: [], people: [] },
    maps: [],
    lines: [],
    settings: {
      sound: true,
      motion: 'system',
      emotionRows: ['Sadness', 'Fear or anxiety', 'Anger', 'Shame', 'Joy'],
      urgeRows: ['Urge to give up on today'],
      theme: 'classic',
      accent: 'blue',
      cardBack: 'ring',
      plate: 'plain',
      title: '',
      playerName: '',
      companion: '',
      names: {},
      region: '',
    },
    flags: { rankSeen: 0, wardenSeen: false, giftDay: '', cardDay: '', greetDay: '', safeCredit: false, therapistLineShown: false, checkinDay: '', titlesSeen: [] },
    gone: {},
    setAt: {},
  };
}

/** The day turns over at 4 AM local, so 2-3 AM still belongs to "today". */
export function dayKey(ms: number) {
  const d = new Date(ms - DAY_TURN_HOURS * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dayDiff(a: string, b: string) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400e3);
}
export function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

let uidN = 0;
export const uid = () => `${Date.now().toString(36)}${(uidN++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** How a dropped IndexedDB connection shows (WebKit: "Connection to Indexed Database server lost"; closed: InvalidStateError). */
export const connectionLost = (e: unknown) => {
  const n = (e as { name?: unknown } | null)?.name;
  return n === 'InvalidStateError' || n === 'UnknownError';
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const goneAt = (g: Record<string, number>, id: string) => (Object.prototype.hasOwnProperty.call(g, id) ? g[id] : -Infinity);
const putOwn = (o: object, k: string, v: unknown) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const setOwn = (g: Record<string, number>, id: string, t: number) => putOwn(g, id, t);
/** Fields a newer build stored that this one doesn't read, by name. */
const extrasOf = (s: object) => Object.entries(s).filter(([k]) => !KNOWN.has(k)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
/** What is written to this device and into a Save Crystal: the wave 2 fields move out of settings, flags and setAt into profile. */
function stored(s: State) {
  const { theme, accent, cardBack, plate, title, playerName, companion, names, region, ...settings } = s.settings;
  const { titlesSeen, ...flags } = s.flags;
  const setAt: Record<string, number> = {};
  const profileAt: Record<string, number> = {};
  for (const [k, t] of Object.entries(s.setAt)) if (typeof t === 'number') ((PROFILE_SET_KEYS as string[]).includes(k) ? profileAt : setAt)[k] = t;
  return { ...s, settings, flags, setAt, profile: { theme, accent, cardBack, plate, title, playerName, companion, names, region, titlesSeen, setAt: profileAt } };
}
/** Each id once, the first kept. */
function firstById<T extends { id: string }>(list: T[]) {
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(x.id) && !!seen.add(x.id));
}
/** The newest GONE_CAP removals. */
function capGone(entries: [string, number][]) {
  const g: Record<string, number> = {};
  for (const [id, t] of entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, GONE_CAP)) setOwn(g, id, t);
  return g;
}
const flat = (x: object) => JSON.stringify(x, Object.keys(x).sort());
const atOf = (x: { at?: number }) => x.at ?? 0;
/** Each id once: mine keep their order, theirs not seen here are appended; on both sides the later-added copy wins. */
function unionInto<T extends { id: string; at?: number }>(mine: T[], theirs: T[]) {
  const idx = new Map(mine.map((x, i) => [x.id, i]));
  for (const x of theirs) {
    const i = idx.get(x.id);
    if (i === undefined) {
      idx.set(x.id, mine.length);
      mine.push(x);
      continue;
    }
    const m = mine[i];
    if (atOf(x) > atOf(m) || (atOf(x) === atOf(m) && flat(x) > flat(m))) mine[i] = x;
  }
}
/** Drops (in place) what a removal at least as new as its add hides. */
function prune<T extends { id: string; at?: number }>(list: T[], gone: Record<string, number>) {
  for (let i = list.length - 1; i >= 0; i--) if (goneAt(gone, list[i].id) >= atOf(list[i])) list.splice(i, 1);
}
type SetVal = boolean | string | string[];
const nameId = (k: SetKey) => (k.startsWith('name:') ? (k.slice(5) as ShadowId) : null);
function getSet(s: State, k: SetKey): SetVal {
  const id = nameId(k);
  if (id) return own(s.settings.names, id) ? (s.settings.names[id] ?? '') : '';
  return k === 'safeCredit' ? s.flags.safeCredit : s.settings[k as Exclude<SetKey, NameKey | 'safeCredit'>];
}
function putSet(s: State, k: SetKey, v: SetVal) {
  const id = nameId(k);
  if (id) {
    if (typeof v === 'string' && v) s.settings.names[id] = v;
    else delete s.settings.names[id];
  } else if (k === 'safeCredit') s.flags.safeCredit = v as boolean;
  else if (k === 'sound') s.settings.sound = v as boolean;
  else if (k === 'motion') s.settings.motion = v as Settings['motion'];
  else if (k === 'emotionRows' || k === 'urgeRows') s.settings[k].splice(0, s.settings[k].length, ...(v as string[]));
  else (s.settings as unknown as Record<string, SetVal>)[k] = v;
}
/** What two copies must agree on beyond events, diary and lines, in a form where order inside a set doesn't count. */
function canon(s: State) {
  const set = (l: object[]) => l.map(flat).sort();
  return JSON.stringify([
    s.created,
    LIST_KEYS.map((k) => set(s.lists[k])),
    set(s.maps),
    Object.entries(s.gone).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    SET_KEYS.map((k) => [getSet(s, k), s.setAt[k] ?? 0]),
    [s.flags.rankSeen, s.flags.wardenSeen, s.flags.therapistLineShown, ...DAY_FLAGS.map((k) => s.flags[k]), [...s.flags.titlesSeen].sort()],
    extrasOf(s),
  ]);
}
export function validDay(d: unknown): d is string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === dd;
}
const str = (x: unknown, max = 2000) => (typeof x === 'string' ? x.slice(0, max) : '');
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const oneOf = <T extends string>(x: unknown, list: readonly T[], fallback: T): T => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : fallback);
export const isSkillId = (id: unknown): id is string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKILL, id);

type DiaryKind = 'emotions' | 'urges';
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export const fieldKey = (kind: DiaryKind, name: string) => `${kind === 'emotions' ? 'e' : 'u'}:${name}`;
/** A note counts as present once it has text or a time of its own (so a never-touched empty note is not a clear). */
const notePresent = (e: DiaryEntry) => e.note !== '' || (!!e.ft && own(e.ft, 'note'));
const fieldTime = (e: DiaryEntry, key: string) => (e.ft && own(e.ft, key) ? e.ft[key] : e.updatedAt);

/** Every present field of the entry with its time, so a later change to updatedAt never moves an older field forward. */
export function fieldTimes(e: DiaryEntry | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!e) return out;
  for (const kind of ['emotions', 'urges'] as const) for (const name of Object.keys(e[kind])) out[fieldKey(kind, name)] = fieldTime(e, fieldKey(kind, name));
  if (notePresent(e)) out.note = fieldTime(e, 'note');
  return out;
}

/**
 * One diary day from two copies, field by field: the value set later wins. On equal times a number beats a blank, then
 * the larger number, then the longer note. Commutative and associative, so copies merged in any order agree.
 */
export function mergeEntry(a: DiaryEntry, b: DiaryEntry): DiaryEntry {
  const ft: Record<string, number> = {};
  const rows = (kind: DiaryKind) => {
    const out: Record<string, number | null> = {};
    for (const name of new Set([...Object.keys(a[kind]), ...Object.keys(b[kind])])) {
      const key = fieldKey(kind, name);
      const inA = own(a[kind], name), inB = own(b[kind], name);
      const va = inA ? a[kind][name] : null, vb = inB ? b[kind][name] : null;
      const ta = fieldTime(a, key), tb = fieldTime(b, key);
      let useB: boolean;
      if (!inA || !inB) useB = !inA;
      else if (ta !== tb) useB = tb > ta;
      else if ((va === null) !== (vb === null)) useB = vb !== null;
      else useB = va !== null && vb !== null && vb > va;
      out[name] = useB ? vb : va;
      ft[key] = useB ? tb : ta;
    }
    return out;
  };
  const emotions = rows('emotions'), urges = rows('urges');
  let note = '';
  const pa = notePresent(a), pb = notePresent(b);
  if (pa || pb) {
    const ta = fieldTime(a, 'note'), tb = fieldTime(b, 'note');
    let useB: boolean;
    if (!pa || !pb) useB = !pa;
    else if (ta !== tb) useB = tb > ta;
    else if (a.note.length !== b.note.length) useB = b.note.length > a.note.length;
    else useB = b.note > a.note;
    note = useB ? b.note : a.note;
    ft.note = useB ? tb : ta;
  }
  return { day: a.day, emotions, urges, note, updatedAt: Math.max(a.updatedAt, b.updatedAt), ft };
}

/** True when a holds a field b lacks, a different value, or a later time for one. */
function entryAhead(a: DiaryEntry, b: DiaryEntry) {
  if (a.note !== b.note || (notePresent(a) && (!notePresent(b) || fieldTime(a, 'note') > fieldTime(b, 'note')))) return true;
  for (const kind of ['emotions', 'urges'] as const)
    for (const [name, v] of Object.entries(a[kind])) {
      const key = fieldKey(kind, name);
      if (!own(b[kind], name) || b[kind][name] !== v || fieldTime(a, key) > fieldTime(b, key)) return true;
    }
  return false;
}

/** Accepts anything JSON-parsed and returns a clean State (unknown or broken fields fall back to defaults). */
export function normalize(raw: unknown): State | null {
  if (!isObj(raw)) return null;
  if (raw.v !== undefined && typeof raw.v !== 'number') return null;
  const v = typeof raw.v === 'number' ? raw.v : 0;
  if (v > SCHEMA && (raw.app !== APP_ID || v > CRYSTAL_SCHEMA)) return null;
  if (!Array.isArray(raw.events)) return null;
  if (raw.app !== undefined && raw.app !== APP_ID) return null;
  const base = freshState(num(raw.created) ?? Date.now());
  const kinds = EV_KINDS;
  const stats = Object.values(MODULES).map((m) => m.stat);
  if (Array.isArray(raw.events)) {
    const seen = new Set<string>();
    for (const e of raw.events) {
      if (!isObj(e) || typeof e.id !== 'string' || seen.has(e.id) || !kinds.includes(e.k as EvKind) || typeof e.day !== 'string' || !validDay(e.day.slice(0, 10))) continue;
      const ev: Ev = { id: e.id, t: num(e.t) ?? 0, day: e.day.slice(0, 10), k: e.k as EvKind, xp: Math.max(0, Math.min(500, num(e.xp) ?? 0)) };
      if (stats.includes(e.stat as StatId)) ev.stat = e.stat as StatId;
      if (typeof e.skill === 'string') ev.skill = e.skill.slice(0, 40);
      if (isObj(e.data)) {
        const d: Ev['data'] = {};
        for (const [k, val] of Object.entries(e.data)) if (['string', 'number', 'boolean'].includes(typeof val) || val === null) d[k.slice(0, 40)] = typeof val === 'string' ? val.slice(0, 400) : (val as number | boolean | null);
        ev.data = d;
      }
      seen.add(ev.id);
      base.events.push(ev);
    }
  }
  if (isObj(raw.diary)) {
    for (const [day, e] of Object.entries(raw.diary)) {
      if (!isObj(e) || !validDay(day)) continue;
      const rows = (r: unknown) => {
        const out: Record<string, number | null> = {};
        if (isObj(r))
          for (const [k, val] of Object.entries(r)) {
            if (val === null) out[k.slice(0, 60)] = null;
            else if (num(val) !== null) out[k.slice(0, 60)] = Math.max(0, Math.min(5, val as number));
          }
        return out;
      };
      const entry: DiaryEntry = { day, emotions: rows(e.emotions), urges: rows(e.urges), note: str(e.note, 600), updatedAt: num(e.updatedAt) ?? 0 };
      if (isObj(e.ft)) {
        const ft: Record<string, number> = {};
        for (const [k, val] of Object.entries(e.ft)) {
          if (k.length > 64 || num(val) === null) continue;
          const kind = k.startsWith('e:') ? 'emotions' : k.startsWith('u:') ? 'urges' : null;
          if (k === 'note' || (kind && own(entry[kind], k.slice(2)))) ft[k] = val as number;
        }
        if (Object.keys(ft).length) entry.ft = ft;
      }
      base.diary[day] = entry;
    }
  }
  const withAt = <T extends object>(o: T, raw: Record<string, unknown>): T => (num(raw.at) !== null ? { ...o, at: raw.at as number } : o);
  const items = (x: unknown): Item[] => (Array.isArray(x) ? firstById(x.filter(isObj).map((i) => withAt({ id: str(i.id, 40) || uid(), text: str(i.text, 200) }, i)).filter((i) => i.text)) : []);
  if (isObj(raw.lists)) {
    base.lists.comfort = items(raw.lists.comfort);
    base.lists.activities = items(raw.lists.activities);
    base.lists.reasons = items(raw.lists.reasons);
    base.lists.people = Array.isArray(raw.lists.people)
      ? firstById(raw.lists.people.filter(isObj).map((p) => withAt({ id: str(p.id, 40) || uid(), name: str(p.name, 80), phone: str(p.phone, 40) }, p)).filter((p) => p.name))
      : [];
  }
  if (Array.isArray(raw.maps)) {
    base.maps = firstById(raw.maps.filter(isObj).map((m) => withAt({ id: str(m.id, 40) || uid(), t: num(m.t) ?? 0, urge: str(m.urge), p1: str(m.p1), c1: str(m.c1), p2: str(m.p2), c2: str(m.c2), choice: str(m.choice, 40) }, m)));
  }
  if (isObj(raw.gone)) base.gone = capGone(Object.entries(raw.gone).filter((e): e is [string, number] => !!e[0] && e[0].length <= 40 && num(e[1]) !== null));
  if (isObj(raw.setAt)) {
    const sa = raw.setAt;
    for (const k of BASE_SET_KEYS) {
      const t = own(sa, k) ? num(sa[k]) : null;
      if (t !== null) base.setAt[k] = Math.max(0, t);
    }
  }
  if (isObj(raw.profile)) {
    const pf = raw.profile;
    base.settings.theme = oneOf(pf.theme, THEME_IDS, 'classic');
    base.settings.accent = oneOf(pf.accent, ACCENT_IDS, 'blue');
    base.settings.cardBack = oneOf(pf.cardBack, CARD_BACK_IDS, 'ring');
    base.settings.plate = oneOf(pf.plate, PLATE_IDS, 'plain');
    base.settings.title = oneOf<TitleId | ''>(pf.title, TITLE_IDS, '');
    base.settings.playerName = cleanName(pf.playerName);
    base.settings.companion = cleanName(pf.companion);
    base.settings.region = typeof pf.region === 'string' && /^[a-z]{2,16}$/.test(pf.region) ? pf.region : '';
    if (isObj(pf.names))
      for (const id of SHADOW_IDS) {
        const n = own(pf.names, id) ? cleanName(pf.names[id]) : '';
        if (n) base.settings.names[id] = n;
      }
    if (Array.isArray(pf.titlesSeen)) base.flags.titlesSeen = TITLE_IDS.filter((t) => (pf.titlesSeen as unknown[]).includes(t));
    if (isObj(pf.setAt))
      for (const k of PROFILE_SET_KEYS) {
        const t = own(pf.setAt, k) ? num(pf.setAt[k]) : null;
        if (t !== null) base.setAt[k] = Math.max(0, t);
      }
  }
  for (const [k, val] of extrasOf(raw)) putOwn(base, k, val);
  if (Array.isArray(raw.lines)) {
    const byDay = new Map<string, LineEntry>();
    for (const l of raw.lines) {
      if (!isObj(l) || !validDay(l.day) || !str(l.text, 200)) continue;
      const e: LineEntry = { day: l.day, id: str(l.id, 12), tag: str(l.tag, 24), text: str(l.text, 200), t: num(l.t) ?? 0 };
      const had = byDay.get(e.day);
      if (!had || e.t >= had.t) byDay.set(e.day, e);
    }
    base.lines = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }
  if (isObj(raw.settings)) {
    const s = raw.settings;
    if (typeof s.sound === 'boolean') base.settings.sound = s.sound;
    base.settings.motion = oneOf(s.motion, MOTIONS, base.settings.motion);
    if (Array.isArray(s.emotionRows)) base.settings.emotionRows = s.emotionRows.map((r) => str(r, 60)).filter(Boolean).slice(0, ROW_CAP.emotions);
    if (Array.isArray(s.urgeRows)) base.settings.urgeRows = s.urgeRows.map((r) => str(r, 60)).filter(Boolean).slice(0, ROW_CAP.urges);
  }
  if (isObj(raw.flags)) {
    const f = raw.flags;
    base.flags.rankSeen = Math.max(0, Math.min(5, num(f.rankSeen) ?? 0));
    base.flags.wardenSeen = f.wardenSeen === true;
    const day = (x: unknown) => (validDay(x) ? x : '');
    base.flags.giftDay = day(f.giftDay);
    base.flags.cardDay = day(f.cardDay);
    base.flags.greetDay = day(f.greetDay);
    base.flags.safeCredit = f.safeCredit === true;
    base.flags.therapistLineShown = f.therapistLineShown === true;
    base.flags.checkinDay = day(f.checkinDay);
  }
  return base;
}

export interface Derived {
  xp: number;
  rank: number;
  warden: boolean;
  nextAt: number | null;
  stats: Record<StatId, number>;
  visitDays: string[];
  collection: Set<string>;
}

export function rankFor(xp: number) {
  let r = 0;
  for (let i = 0; i < RANK_XP.length; i++) if (xp >= RANK_XP[i]) r = i;
  return r;
}

export class Store {
  state: State;
  private listeners = new Set<() => void>();
  /** true while the last write to this device succeeded */
  saving = true;
  private locked = false;
  private lastRaw: string | null = null;

  constructor(
    readonly key = SAVE_KEY,
    readonly clock: () => number = () => Date.now(),
    initial?: State,
  ) {
    let st: State | null = initial ?? null;
    if (!st) {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        // what is stored can't be read, so this session never writes over it
        this.locked = true;
        this.saving = false;
      }
      this.lastRaw = raw;
      if (raw !== null) {
        try {
          st = normalize(JSON.parse(raw));
        } catch {
          st = null;
        }
        // unreadable or from a newer version: keep the original bytes before anything can overwrite them
        if (!st && !this.keepCopy(raw)) {
          this.locked = true;
          this.saving = false;
        }
      }
    }
    this.state = st ?? freshState(clock());
    const adopted = this.mirrorYou();
    if (initial || (adopted && !this.locked)) this.save();
    if (!this.locked && typeof window !== 'undefined') {
      window.addEventListener('storage', this.onStorage);
      window.addEventListener('pageshow', this.onShow);
      document.addEventListener('visibilitychange', this.onShow);
    }
  }

  /** Back in view (or back from the page cache): storage events may have been missed meanwhile, so read what is stored. */
  private onShow = (e: Event) => {
    if (e.type === 'pageshow' ? !(e as PageTransitionEvent).persisted : document.visibilityState !== 'visible') return;
    if (this.sync()) this.listeners.forEach((f) => f());
  };

  private onStorage = (e: StorageEvent) => {
    if (e.key === YOU_KEY && e.newValue !== null) {
      if (this.mirrorYou()) this.save();
      else this.listeners.forEach((f) => f());
      return;
    }
    if (e.key !== this.key || e.newValue === null) return;
    try {
      if (e.storageArea !== localStorage) return;
    } catch {
      return;
    }
    let other: State | null = null;
    try {
      other = normalize(JSON.parse(e.newValue));
    } catch {
      other = null;
    }
    if (!other) return;
    this.absorb(other);
    this.lastRaw = e.newValue;
    if (this.mirrorYou() || this.holdsMoreThan(other)) this.save();
    else this.listeners.forEach((f) => f());
  };

  dispose() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('storage', this.onStorage);
    window.removeEventListener('pageshow', this.onShow);
    document.removeEventListener('visibilitychange', this.onShow);
  }

  /** Folds in what another copy stored since this one last read or wrote. True when there was something. */
  sync() {
    if (this.locked) return false;
    try {
      const cur = localStorage.getItem(this.key);
      if (cur === null || cur === this.lastRaw) return false;
      const other = normalize(JSON.parse(cur));
      if (!other) return false;
      this.absorb(other);
      this.lastRaw = cur;
      if (this.mirrorYou()) this.save();
      return true;
    } catch {
      // save() deals with what can't be read
      return false;
    }
  }

  /**
   * Keeps the intro's copy of the two names (core/you) in step with this store, per name the later choice winning (a
   * tie goes to the larger value, so every open copy settles on the same one). The first-run prompt writes only that
   * copy, so here it is adopted. Only the real save does this; lab stores leave the player's names alone. True when
   * this store took a name from it (and needs a save).
   */
  private mirrorYou() {
    if (this.key !== SAVE_KEY) return false;
    const s = this.state.settings, at = this.state.setAt;
    const m = readYou();
    let took = false, behind = !m;
    const field = (k: 'playerName' | 'companion', v: string, t: number) => {
      const mine = at[k] ?? 0;
      if (t > mine || (t === mine && v > s[k])) {
        if (s[k] !== v || mine !== t) took = true;
        s[k] = v;
        at[k] = t;
      } else if (t < mine || v !== s[k]) behind = true;
    };
    if (m) {
      field('playerName', m.name, m.nameAt);
      field('companion', m.companion, m.companionAt);
    }
    if (behind && (m || s.playerName || s.companion || at.playerName || at.companion))
      writeYou({ name: s.playerName, companion: s.companion, nameAt: at.playerName ?? 0, companionAt: at.companion ?? 0 });
    return took;
  }

  private holdsMoreThan(other: State) {
    const ids = new Set(other.events.map((e) => e.id));
    if (this.state.events.some((e) => !ids.has(e.id))) return true;
    for (const [day, mine] of Object.entries(this.state.diary)) {
      const o = other.diary[day];
      if (!o || entryAhead(mine, o)) return true;
    }
    const lines = new Map(other.lines.map((l) => [l.day, l]));
    if (
      this.state.lines.some((l) => {
        const o = lines.get(l.day);
        return !o || o.t !== l.t || o.id !== l.id;
      })
    )
      return true;
    return canon(this.state) !== canon(other);
  }

  private keepCopy(raw: string) {
    try {
      localStorage.setItem(`${this.key}${BESIDE.unreadable}.${Date.now()}`, raw);
      return true;
    } catch {
      return false;
    }
  }

  now() {
    return this.clock();
  }
  today() {
    return dayKey(this.clock());
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Writes the session to this device. If another open copy of the app wrote in the meantime, its state is folded in
   * first (see absorb: removals travel as tombstones, so they stick). On any failure the session keeps working in memory
   * and `saving` turns false.
   */
  save() {
    if (this.locked) this.mirrorYou();
    else {
      try {
        const cur = localStorage.getItem(this.key);
        if (cur !== null && cur !== this.lastRaw) {
          let other: State | null = null;
          try {
            other = normalize(JSON.parse(cur));
          } catch {
            other = null;
          }
          if (other) this.absorb(other);
          else if (!this.keepCopy(cur)) throw new Error('unreadable copy not kept');
        }
        // after folding in the other copy, so a name this copy hadn't seen yet is never written back as current
        this.mirrorYou();
        const out = JSON.stringify(stored(this.state));
        localStorage.setItem(this.key, out);
        this.lastRaw = out;
        this.saving = true;
      } catch {
        this.saving = false;
      }
    }
    this.listeners.forEach((f) => f());
  }

  private addById<T extends { id: string }>(mine: T[], theirs: T[]) {
    const seen = new Set(mine.map((x) => x.id));
    let added = 0;
    for (const x of theirs)
      if (!seen.has(x.id)) {
        seen.add(x.id);
        mine.push(x);
        added++;
      }
    return added;
  }

  /** Per field, the later-set value wins (see mergeEntry); a day only one copy has is taken whole. */
  private mergeDiary(other: Record<string, DiaryEntry>) {
    for (const [day, e] of Object.entries(other)) {
      const mine = this.state.diary[day];
      this.state.diary[day] = mine ? mergeEntry(mine, e) : { ...e, emotions: { ...e.emotions }, urges: { ...e.urges }, ...(e.ft ? { ft: { ...e.ft } } : {}) };
    }
  }

  /** What only ever grows: events by id, diary per field, the newer line per day, raised flags, the later day flags. */
  private absorbProgress(other: State) {
    this.state.created = Math.min(this.state.created, other.created);
    if (this.addById(this.state.events, other.events)) this.state.events.sort((a, b) => a.t - b.t);
    this.mergeDiary(other.diary);
    const lines = new Map(this.state.lines.map((l) => [l.day, l]));
    for (const l of other.lines) {
      const mine = lines.get(l.day);
      if (!mine || l.t > mine.t || (l.t === mine.t && l.id > mine.id)) lines.set(l.day, l);
    }
    this.state.lines = [...lines.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const f = this.state.flags, o = other.flags;
    f.rankSeen = Math.max(f.rankSeen, o.rankSeen);
    f.wardenSeen ||= o.wardenSeen;
    f.therapistLineShown ||= o.therapistLineShown;
    for (const t of o.titlesSeen) if (!f.titlesSeen.includes(t)) f.titlesSeen.push(t);
    for (const k of DAY_FLAGS) if (validDay(o[k]) && (!validDay(f[k]) || o[k] > f[k])) f[k] = o[k];
  }

  /**
   * Folds another open copy's state into this one. Lists and maps join by id (a removal is a tombstone newer than the
   * item, an Undo re-adds it newer than the tombstone), each choice takes the later change. Every rule is order-free, so
   * two copies that fold each other in end up holding the same thing. Arrays change in place: screens hold them.
   */
  private absorb(other: State) {
    this.absorbProgress(other);
    // fields from a newer build: the stored copy's value, never dropped
    for (const [k, v] of extrasOf(other)) putOwn(this.state, k, v);
    const gone = { ...this.state.gone };
    for (const [id, t] of Object.entries(other.gone)) if (t > goneAt(gone, id)) setOwn(gone, id, t);
    this.state.gone = Object.keys(gone).length > GONE_CAP ? capGone(Object.entries(gone)) : gone;
    for (const k of LIST_KEYS) {
      unionInto<Item | Person>(this.state.lists[k], other.lists[k]);
      prune<Item | Person>(this.state.lists[k], this.state.gone);
    }
    unionInto(this.state.maps, other.maps);
    prune(this.state.maps, this.state.gone);
    for (const k of SET_KEYS) {
      const mt = this.state.setAt[k] ?? 0, ot = other.setAt[k] ?? 0;
      const mv = getSet(this.state, k), ov = getSet(other, k);
      if (ot > mt || (ot === mt && JSON.stringify(ov) > JSON.stringify(mv))) {
        putSet(this.state, k, Array.isArray(ov) ? [...ov] : ov);
        if (own(other.setAt, k)) this.state.setAt[k] = ot;
      }
    }
  }

  /** Marks a choice as changed now (later than any change this copy made before, whatever the clock does). */
  touch(k: SetKey) {
    this.state.setAt[k] = Math.max(this.now(), (this.state.setAt[k] ?? -Infinity) + 1);
  }

  /** Removes a list item or map by id. The tombstone it leaves is newer than the item, so no open copy brings it back. */
  removeItem<T extends { id: string; at?: number }>(list: T[], id: string): { item: T; index: number } | null {
    const index = list.findIndex((x) => x.id === id);
    if (index < 0) return null;
    const [item] = list.splice(index, 1);
    setOwn(this.state.gone, id, Math.max(this.now(), atOf(item) + 1, goneAt(this.state.gone, id)));
    if (Object.keys(this.state.gone).length > GONE_CAP) this.state.gone = capGone(Object.entries(this.state.gone));
    return { item, index };
  }

  /** Undo: puts the item back, newer than its tombstone, so it comes back in every open copy too. */
  reviveItem<T extends { id: string; at?: number }>(list: T[], item: T, index: number) {
    if (list.some((x) => x.id === item.id)) return;
    list.splice(Math.min(index, list.length), 0, { ...item, at: Math.max(this.now(), goneAt(this.state.gone, item.id) + 1) });
  }

  /** The only way progress changes. xp is clamped to >= 0. */
  add<K extends EvKind>(k: K, xp: number, extra: Omit<Partial<Ev>, 'data'> & { data?: EvData<K> } = {}) {
    const ev: Ev = { id: uid(), t: this.now(), day: this.today(), k, xp: Math.max(0, Math.round(xp)), ...(extra as Partial<Ev>) };
    ev.xp = Math.max(0, ev.xp);
    this.state.events.push(ev);
    this.save();
    return ev;
  }

  derived(): Derived {
    const stats = { sense: STAT_BASE, stamina: STAT_BASE, intelligence: STAT_BASE, agility: STAT_BASE } as Record<StatId, number>;
    let xp = 0;
    const days = new Set<string>();
    const collection = new Set<string>();
    for (const e of this.state.events) {
      xp += Math.max(0, e.xp);
      if (e.stat) stats[e.stat] += 1;
      if (e.k === 'visit') days.add(e.day);
      if ((e.k === 'skill' || e.k === 'card') && isSkillId(e.skill)) collection.add(e.skill);
    }
    const rank = rankFor(xp);
    return { xp, rank, warden: xp >= WARDEN_XP, nextAt: rank < RANKS.length - 1 ? RANK_XP[rank + 1] : xp < WARDEN_XP ? WARDEN_XP : null, stats, visitDays: [...days].sort(), collection };
  }

  /** Runs on mount and whenever the app becomes visible. Returns what greeting (if any) today needs. */
  openDay(): { kind: 'first' | 'back' | 'day' | null; visitIndex: number } {
    const today = this.today();
    const d = this.derived();
    const had = d.visitDays.includes(today);
    if (!had) this.add('visit', 10);
    const days = this.derived().visitDays;
    const visitIndex = days.indexOf(today);
    if (this.state.flags.greetDay === today) return { kind: null, visitIndex };
    this.state.flags.greetDay = today;
    this.save();
    const prev = days[visitIndex - 1];
    if (!prev) return { kind: 'first', visitIndex };
    if (dayDiff(prev, today) >= 2) return { kind: 'back', visitIndex };
    return { kind: 'day', visitIndex };
  }

  visitIndex() {
    const days = this.derived().visitDays;
    const i = days.indexOf(this.today());
    return i < 0 ? days.length : i;
  }
  giftLine() {
    return DAILY_GIFTS[this.visitIndex() % DAILY_GIFTS.length];
  }
  /**
   * Today's card. Once revealed it stays the card today's card event recorded (its rotation slot), so an update that
   * grows or reorders ROTATION can't swap it. A card event without a slot matches by skill (no skill meant a special
   * card) around where the old rotation dealt it. The nearest match wins.
   */
  quest(): Quest & { slot: number } {
    const n = ROTATION.length;
    const vi = this.visitIndex();
    const today = this.today();
    const ev = this.state.events.find((e) => e.k === 'card' && e.day === today);
    let slot = vi % n;
    if (ev) {
      const { slot: at, special } = ev.data ?? {};
      const fits = (q: Quest) => (ev.skill === undefined ? !!q.special && (typeof special !== 'string' || q.special === special) : !q.special && q.skill === ev.skill);
      const near = typeof at === 'number' && Number.isInteger(at) && at >= 0 && at < n ? at : vi % Math.min(n, OLD_ROTATION);
      const ring = (i: number) => Math.min(Math.abs(i - near), n - Math.abs(i - near));
      const match = ROTATION.flatMap((q, i) => (fits(q) ? [i] : [])).sort((a, b) => ring(a) - ring(b))[0];
      if (match !== undefined) slot = match;
    }
    return { ...ROTATION[slot], slot };
  }

  /** Today's picked line, if any. */
  lineToday(): LineEntry | undefined {
    const today = this.today();
    return this.state.lines.find((l) => l.day === today);
  }

  /** Three lines for today, one per tone, in an order that changes by day. roll > 0 offers the next three. */
  lineOffer(roll = 0): DayLine[] {
    const vi = this.visitIndex();
    const { low, mid, up } = TODAY_LINES;
    const set = [low[(vi * 7 + roll) % low.length], mid[(vi * 4 + roll * 2) % mid.length], up[(vi * 11 + 1 + roll * 4) % up.length]];
    const k = vi % 3;
    return [...set.slice(k), ...set.slice(0, k)];
  }

  /** Keeps their pick for today (a new pick replaces today's). The first pick of a day adds 5 XP. */
  pickLine(l: DayLine) {
    const today = this.today();
    const first = !this.state.events.some((e) => e.k === 'line' && e.day === today);
    this.state.lines = this.state.lines.filter((x) => x.day !== today);
    this.state.lines.push({ day: today, id: l.id, tag: l.tag, text: l.text, t: this.now() });
    if (first) this.add('line', 5, { data: { id: l.id } });
    else this.save();
    return { first };
  }

  skillEvent(id: string) {
    if (!isSkillId(id)) return null;
    const sk = SKILL[id];
    return this.add('skill', 20, { stat: MODULES[sk.module].stat, skill: id });
  }

  /** Skill use codes for the diary card (UW diary card legend). */
  skillCodes(day: string) {
    const out: Record<string, number | 'p'> = {};
    for (const e of this.state.events) {
      if (e.day !== day || !isSkillId(e.skill)) continue;
      if (e.k === 'skill' && out[e.skill] === undefined) out[e.skill] = 'p';
      if (e.k === 'feedback') {
        const a = e.data?.answer;
        if (a === 'Yes' || a === 'A little') out[e.skill] = 5;
        else if (a === 'Not this time' && out[e.skill] !== 5) out[e.skill] = 4;
      }
    }
    return out;
  }

  /**
   * Union merge for Restore: imported data can only add. Events, list items, people and maps by id (duplicates inside
   * the file count once; one removed here comes back, newer than its removal), diary per field, the newer line per day,
   * and the diary rows the file uses, and the titles the file has seen. The Wardrobe picks, the equipped title, each
   * shadow's name and the crisis-line country come from the file only where this device has no change time for that
   * choice (the player never set it here), so a new device gets them back; one the player made here, a cleared name
   * included, always wins. A choice taken from the file takes the file's change time too, never later than this
   * device's now (now when the file has none), so another open copy doesn't see it as older than its own default.
   * Explicit sound and motion choices stay on this device, and the file's removals are not applied.
   */
  merge(other: State) {
    this.sync();
    this.absorbProgress(other);
    const bring = <T extends { id: string; at?: number }>(mine: T[], theirs: T[]) => {
      const seen = new Set(mine.map((x) => x.id));
      for (const x of theirs) {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        const g = goneAt(this.state.gone, x.id);
        mine.push(g >= atOf(x) ? { ...x, at: Math.max(this.now(), g + 1) } : x);
      }
    };
    for (const k of LIST_KEYS) bring<Item | Person>(this.state.lists[k], other.lists[k]);
    bring(this.state.maps, other.maps);
    const rowsOf = (kind: 'emotions' | 'urges', named: string[]) => {
      const names = new Set(named);
      for (const e of Object.values(other.diary)) for (const k of Object.keys(e[kind])) names.add(k);
      return names;
    };
    const addRows = (k: 'emotionRows' | 'urgeRows', names: Set<string>, cap: number) => {
      const list = this.state.settings[k];
      const had = list.length;
      for (const n of names) {
        if (list.length >= cap) break;
        if (n && !list.includes(n)) list.push(n);
      }
      if (list.length !== had) this.touch(k);
    };
    addRows('emotionRows', rowsOf('emotions', other.settings.emotionRows), ROW_CAP.emotions);
    addRows('urgeRows', rowsOf('urges', other.settings.urgeRows), ROW_CAP.urges);
    const now = this.now();
    const blank = freshState(0);
    for (const k of ['sound', 'motion', ...PROFILE_SET_KEYS] as SetKey[]) {
      if (own(this.state.setAt, k)) continue;
      if ((k === 'sound' || k === 'motion') && getSet(this.state, k) !== getSet(blank, k)) continue;
      const ov = getSet(other, k);
      const ft = own(other.setAt, k) ? other.setAt[k] : undefined;
      const timed = typeof ft === 'number' && ft > 0;
      if (!timed && ov === getSet(blank, k)) continue;
      putSet(this.state, k, ov);
      this.state.setAt[k] = timed ? Math.min(ft, now) : now;
    }
    this.save();
    return { saving: this.saving };
  }

  /** The Save Crystal, from what is stored now. extra carries what lives outside this state (drawings from IndexedDB). */
  exportJSON(extra: Record<string, unknown> = {}) {
    this.sync();
    return JSON.stringify({ app: APP_ID, exported: new Date(this.now()).toISOString(), ...stored(this.state), v: CRYSTAL_SCHEMA, ...extra });
  }
}
