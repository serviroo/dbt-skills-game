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
import { begunOf, canWrite, cleared, goneElsewhere, onClear, onWritten, replacedBy, sawStored, write } from '../core/cleared';

/**
 * The save version this build writes. A save from a newer build is read too and keeps its higher number: this build
 * uses what it knows and keeps the rest as stored (see Kept), so the newer build finds all of it when it comes back.
 */
export const SCHEMA = 1;
/** The Save Crystal's own version. Its `schema` field holds the save version of the state inside (none before: 1). */
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
  /** A soft buzz when a skill timer starts or ends, on its own switch (Mute is about sound). Off until turned on. */
  vibrate: boolean;
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
  /** The first open's welcome, owed from that open until it shows (Home was left, or the page closed, before it came). */
  welcomeOwed: boolean;
  checkinDay: string;
  questAsideDay: string;
  questAsideAt: number | string;
  /** Titles whose unlock line was already shown. Only grows. */
  titlesSeen: TitleId[];
}
/** Choices one copy can change and another must take whole: the later change wins. */
export type NameKey = `name:${ShadowId}`;
export type SetKey = 'sound' | 'motion' | 'vibrate' | 'emotionRows' | 'urgeRows' | 'safeCredit' | 'region' | 'theme' | 'accent' | 'cardBack' | 'plate' | 'title' | 'playerName' | 'companion' | NameKey;
/** The choices round 9 stores in settings and setAt. */
const BASE_SET_KEYS: SetKey[] = ['sound', 'motion', 'vibrate', 'emotionRows', 'urgeRows', 'safeCredit'];
/** Wave 2 choices. Stored in the top-level profile (with titlesSeen), which a round 9 copy keeps whole instead of dropping. */
const PROFILE_SET_KEYS: SetKey[] = ['region', 'theme', 'accent', 'cardBack', 'plate', 'title', 'playerName', 'companion', ...SHADOW_IDS.map((id): NameKey => `name:${id}`)];
const SET_KEYS: SetKey[] = [...BASE_SET_KEYS, ...PROFILE_SET_KEYS];
/** How this device plays: a Save Crystal brings them only where this device still has its defaults. */
const DEVICE_SET_KEYS: SetKey[] = ['sound', 'motion', 'vibrate'];
export { cleanName };
const LIST_KEYS = ['comfort', 'activities', 'reasons', 'people'] as const;
/** Choices kept beside a save that open screens show: one made in another open copy reaches them too (see onChange). */
const SHOWN_BESIDE = [BESIDE.readSize, BESIDE.safeLight, BESIDE.momentLength, BESIDE.stealth] as const;
const DAY_FLAGS = ['giftDay', 'cardDay', 'greetDay', 'checkinDay'] as const;
const GONE_CAP = 1000;
/** Top-level fields this build reads (and the ones only a Save Crystal carries); any other is kept as it was stored. */
const KNOWN = new Set(['v', 'created', 'events', 'diary', 'lists', 'maps', 'lines', 'settings', 'flags', 'gone', 'setAt', 'profile', 'app', 'exported', 'schema', 'art', 'drafts', 'stories', 'preferences', 'incomplete', 'unreadSaves', 'skillPins', 'skillDrafts']);
/**
 * What a newer build stored that this one can't use, kept as it was so every write, tab merge and Save Crystal carries
 * it on. Unknown fields of the records this build rebuilds (events and their data, diary days and field times, list
 * items, people, maps, lines, settings and flags) stay on those records. This holds the rest: unknown fields of the
 * profile and of both change-time maps, names and titles for ids this build doesn't know, events of kinds it doesn't
 * know (left out of progress), lists it doesn't know (joined by id like the lists it knows, never shown), and choices
 * stored as a value it can't use (the default shows; changing it here replaces it).
 */
export interface Kept {
  profile: Record<string, unknown>;
  profileAt: Record<string, unknown>;
  setAt: Record<string, unknown>;
  names: Record<string, unknown>;
  titles: unknown[];
  raw: Partial<Record<SetKey, unknown>>;
  events: Record<string, unknown>[];
  /** Records of a newer save this build can't read (no text, a broken day, a second line for a day), as stored. */
  dropped: Record<'lines' | 'maps' | (typeof LIST_KEYS)[number], unknown[]>;
  days: Record<string, unknown>;
  /** Lists a newer build added next to the four this one knows, by name, as stored. Never shown or changed here. */
  lists: Record<string, unknown>;
  /** Pin records of a newer save this build can't read, by skill id, as stored. Pinning that skill here replaces one. */
  pins: Record<string, unknown>;
}
export const KEPT: unique symbol = Symbol('kept');
/** One pin decision in the Skills list: pinned to Your favourites or not, and when it was made. */
export interface SkillPin {
  pinned: boolean;
  at: number;
}
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
  /** Pin decisions by skill id. An unpin stays as pinned: false, so an older copy can't bring the pin back. */
  skillPins: Record<string, SkillPin>;
  /** Not enumerable, so never spread or written as itself: stored() writes it back where it came from. */
  [KEPT]?: Kept;
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
      vibrate: false,
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
    flags: { rankSeen: 0, wardenSeen: false, giftDay: '', cardDay: '', greetDay: '', safeCredit: false, therapistLineShown: false, welcomeOwed: false, checkinDay: '', questAsideDay: '', questAsideAt: 0, titlesSeen: [] },
    gone: {},
    setAt: {},
    skillPins: {},
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
/** The fields of a record this build doesn't read, by name. */
const restOf = (o: object, known: readonly string[]) => Object.entries(o).filter(([k]) => !known.includes(k)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
/** Puts the fields of raw this build doesn't read back on the record it rebuilt from raw, as stored. */
function keepRest<T extends object>(into: T, raw: Record<string, unknown>, known: readonly string[]): T {
  for (const [k, v] of restOf(raw, known)) if (!own(into, k)) putOwn(into, k, v);
  return into;
}
export function kept(s: State): Kept {
  if (!s[KEPT]) Object.defineProperty(s, KEPT, { value: { profile: {}, profileAt: {}, setAt: {}, names: {}, titles: [], raw: {}, events: [], dropped: { lines: [], maps: [], comfort: [], activities: [], reasons: [], people: [] }, days: {}, lists: {}, pins: {} }, enumerable: false, writable: true, configurable: true });
  return s[KEPT]!;
}
/**
 * For a save newer than this build: each record as it was stored, and what this build read from it. stored() writes the
 * stored form back for as long as this build hasn't changed the record, so its own trimming and limits (XP per event,
 * text length, diary rows) never reach a newer build's data.
 */
const AS_STORED = new WeakMap<object, { raw: unknown; read: string }>();
function twin<T extends object>(rec: T, raw: unknown, on: boolean): T {
  if (on) AS_STORED.set(rec, { raw, read: JSON.stringify(rec) });
  return rec;
}
const asStored = <T>(rec: T): T => {
  const t = rec && typeof rec === 'object' ? AS_STORED.get(rec as object) : undefined;
  return (t && t.read === JSON.stringify(rec) ? t.raw : rec) as T;
};
const EV_KEYS = ['id', 't', 'day', 'k', 'xp', 'stat', 'skill', 'data'];
const ENTRY_KEYS = ['day', 'emotions', 'urges', 'note', 'updatedAt', 'ft'];
const ITEM_KEYS = ['id', 'text', 'at'];
const PERSON_KEYS = ['id', 'name', 'phone', 'at'];
const MAP_KEYS = ['id', 't', 'urge', 'p1', 'c1', 'p2', 'c2', 'choice', 'at'];
const LINE_KEYS = ['day', 'id', 'tag', 'text', 't'];
const PIN_KEYS = ['pinned', 'at'];
const PROFILE_KEYS = ['theme', 'accent', 'cardBack', 'plate', 'title', 'playerName', 'companion', 'names', 'region', 'titlesSeen', 'setAt'];
const REGION = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Choices with a fixed set of values: one stored as anything else is kept (see Kept) and the default shows. */
const USABLE: Partial<Record<SetKey, (v: unknown) => boolean>> = {
  sound: (v) => typeof v === 'boolean',
  vibrate: (v) => typeof v === 'boolean',
  motion: (v) => (MOTIONS as readonly unknown[]).includes(v),
  theme: (v) => (THEME_IDS as readonly unknown[]).includes(v),
  accent: (v) => (ACCENT_IDS as readonly unknown[]).includes(v),
  cardBack: (v) => (CARD_BACK_IDS as readonly unknown[]).includes(v),
  plate: (v) => (PLATE_IDS as readonly unknown[]).includes(v),
  title: (v) => v === '' || (TITLE_IDS as readonly unknown[]).includes(v),
  region: (v) => typeof v === 'string' && (v === '' || (v.length <= 24 && REGION.test(v))),
};
const BLANK = freshState(0);
const SETTINGS_KEYS = Object.keys(BLANK.settings);
const FLAG_KEYS = Object.keys(BLANK.flags);
/** What is written to this device and into a Save Crystal: the wave 2 fields move out of settings, flags and setAt into profile. */
function stored(s: State) {
  const { theme, accent, cardBack, plate, title, playerName, companion, names, region, ...settings } = s.settings;
  const { titlesSeen, ...flags } = s.flags;
  const k = s[KEPT];
  const as = <T>(key: SetKey, v: T) => (k && own(k.raw, key) ? k.raw[key] : v);
  const setAt: Record<string, unknown> = { ...k?.setAt };
  const profileAt: Record<string, unknown> = { ...k?.profileAt };
  for (const [key, t] of Object.entries(s.setAt)) if (typeof t === 'number') putOwn((PROFILE_SET_KEYS as string[]).includes(key) ? profileAt : setAt, key, t);
  const back = <T>(l: T[], extra?: unknown[]) => (extra?.length ? [...l.map(asStored), ...extra] : l.map(asStored));
  return {
    ...s,
    events: back(s.events, k?.events),
    diary: { ...k?.days, ...Object.fromEntries(Object.entries(s.diary).map(([d, e]) => [d, asStored(e)])) },
    lists: { ...Object.fromEntries(LIST_KEYS.map((key) => [key, back<Item | Person>(s.lists[key], k?.dropped[key])])), ...k?.lists },
    maps: back(s.maps, k?.dropped.maps),
    lines: back(s.lines, k?.dropped.lines),
    skillPins: { ...k?.pins, ...Object.fromEntries(Object.entries(s.skillPins).map(([id, p]) => [id, asStored(p)])) },
    settings: { ...settings, emotionRows: asStored(settings.emotionRows), urgeRows: asStored(settings.urgeRows), sound: as('sound', settings.sound), motion: as('motion', settings.motion), vibrate: as('vibrate', settings.vibrate) },
    flags,
    setAt,
    profile: {
      ...k?.profile,
      theme: as('theme', theme),
      accent: as('accent', accent),
      cardBack: as('cardBack', cardBack),
      plate: as('plate', plate),
      title: as('title', title),
      playerName,
      companion,
      names: { ...k?.names, ...names },
      region: as('region', region),
      titlesSeen: k?.titles.length ? [...titlesSeen, ...k.titles] : titlesSeen,
      setAt: profileAt,
    },
  };
}
/**
 * Takes what another copy kept from a newer build (see Kept), and the fields it holds that this build doesn't read.
 * A field (or an event of a kind this build can't read) both hold keeps this copy's value unless theirs wins: the
 * stored copy when folding in another tab (this build never changes them, so the latest write has the latest), the
 * newer save version when restoring a Crystal.
 */
function adoptKept(into: State, from: State, theirsWin: boolean) {
  const put = (dst: object, entries: [string, unknown][]) => {
    for (const [k, v] of entries) if (theirsWin || !own(dst, k)) putOwn(dst, k, v);
  };
  put(into, extrasOf(from));
  put(into.settings, restOf(from.settings, SETTINGS_KEYS));
  put(into.flags, restOf(from.flags, FLAG_KEYS));
  const b = from[KEPT];
  if (!b) return;
  const a = kept(into);
  put(a.profile, Object.entries(b.profile));
  put(a.profileAt, Object.entries(b.profileAt));
  put(a.setAt, Object.entries(b.setAt));
  put(a.names, Object.entries(b.names));
  const titles = new Set(a.titles.map((t) => JSON.stringify(t)));
  for (const t of b.titles) if (!titles.has(JSON.stringify(t))) a.titles.push(t);
  // lines have no ids: each stored form once; records of a list join by id (see joinRaw)
  const have = new Set(a.dropped.lines.map((x) => JSON.stringify(x)));
  for (const x of b.dropped.lines) if (!have.has(JSON.stringify(x))) a.dropped.lines.push(x);
  put(a.days, Object.entries(b.days));
  const known = new Set(into.events.map((e) => e.id));
  const at = new Map(a.events.map((e, i) => [e.id as string, i]));
  for (const e of b.events) {
    const id = e.id as string;
    if (known.has(id)) continue;
    const i = at.get(id);
    if (i === undefined) {
      at.set(id, a.events.length);
      a.events.push(e);
    } else if (theirsWin) a.events[i] = e;
  }
}
/** Where each thing a copy keeps for a newer build lives (see Kept), so a later stored copy shows which it removed. */
const KEPT_MAPS = { p: 'profile', pa: 'profileAt', sa: 'setAt', n: 'names', d: 'days', l: 'lists', pi: 'pins' } as const;
function keptKeys(s: State): Set<string> {
  const out = new Set<string>();
  for (const [k] of extrasOf(s)) out.add(`x:${k}`);
  for (const [k] of restOf(s.settings, SETTINGS_KEYS)) out.add(`s:${k}`);
  for (const [k] of restOf(s.flags, FLAG_KEYS)) out.add(`f:${k}`);
  const kp = s[KEPT];
  if (!kp) return out;
  for (const [p, f] of Object.entries(KEPT_MAPS)) for (const k of Object.keys(kp[f])) out.add(`${p}:${k}`);
  for (const t of kp.titles) out.add(`t:${JSON.stringify(t)}`);
  for (const e of kp.events) out.add(`e:${String(e.id)}`);
  for (const [list, l] of Object.entries(kp.dropped)) for (const x of l) out.add(`r:${list}:${recordKey(list, x)}`);
  for (const [name, l] of Object.entries(kp.lists)) if (Array.isArray(l)) for (const x of l) out.add(`lr:${JSON.stringify([name, recordKey(name, x)])}`);
  return out;
}
/** A kept record's identity: its id, else its whole stored form. A line's id says which line it is, not which record, so lines go by form. */
const recordKey = (list: string, x: unknown) => (list !== 'lines' && rawId(x)) || JSON.stringify(x);
/** Removes what keptKeys named from a copy: a newer build removed them since this copy last read the save. */
function forget(s: State, keys: string[]) {
  const kp = s[KEPT];
  const drop = (o: object, k: string) => void delete (o as Record<string, unknown>)[k];
  for (const key of keys) {
    const at = key.indexOf(':');
    const kind = key.slice(0, at), name = key.slice(at + 1);
    if (kind === 'x') drop(s, name);
    else if (kind === 's') drop(s.settings, name);
    else if (kind === 'f') drop(s.flags, name);
    else if (!kp) continue;
    else if (kind in KEPT_MAPS) drop(kp[KEPT_MAPS[kind as keyof typeof KEPT_MAPS]], name);
    else if (kind === 't') kp.titles = kp.titles.filter((t) => JSON.stringify(t) !== name);
    else if (kind === 'e') kp.events = kp.events.filter((e) => String(e.id) !== name);
    else if (kind === 'r') {
      const cut = name.indexOf(':');
      const list = name.slice(0, cut) as keyof Kept['dropped'];
      const id = name.slice(cut + 1);
      if (own(kp.dropped, list)) kp.dropped[list] = kp.dropped[list].filter((x) => recordKey(list, x) !== id);
    } else if (kind === 'lr') {
      const [list, id] = JSON.parse(name) as [string, string];
      const l = own(kp.lists, list) ? kp.lists[list] : undefined;
      if (Array.isArray(l)) putOwn(kp.lists, list, l.filter((x) => recordKey(list, x) !== id));
    }
  }
}
/** The id of a record in a list this build can't read ('' = none: such a record is matched by its whole stored form). */
const rawId = (x: unknown) => (isObj(x) && typeof x.id === 'string' && x.id ? x.id : '');
const rawAt = (x: unknown) => (isObj(x) ? (num(x.at) ?? 0) : 0);
/**
 * Joins their list of records this build can't read into mine (a new list), by the rules of the lists it knows: by id,
 * mine keep their order and theirs not seen here are appended. On a tab merge (theirsWin) their copy of a record wins
 * unless mine was added later, as this build never changes such records; on a restore the file's copy wins only when
 * it is from a newer save version (not when mine was added later), and one removed here comes back newer than its
 * removal. A record without an id is kept once per stored form.
 */
function joinRaw(mine: unknown[], theirs: unknown[], theirsWin: boolean, restore?: { gone: Record<string, number>; now: number }) {
  const out = [...mine];
  const idx = new Map<string, number>();
  const forms = new Set<string>();
  out.forEach((x, i) => {
    const id = rawId(x);
    if (!id) forms.add(JSON.stringify(x));
    else if (!idx.has(id)) idx.set(id, i);
  });
  for (const x of theirs) {
    const id = rawId(x);
    if (!id) {
      const f = JSON.stringify(x);
      if (!forms.has(f)) (forms.add(f), out.push(x));
      continue;
    }
    const i = idx.get(id);
    if (i !== undefined) {
      if (theirsWin && rawAt(x) >= rawAt(out[i])) out[i] = x;
      continue;
    }
    idx.set(id, out.length);
    const g = restore ? goneAt(restore.gone, id) : -Infinity;
    out.push(isObj(x) && g >= rawAt(x) ? { ...x, at: Math.max(restore!.now, g + 1) } : x);
  }
  return out;
}
/** What a removal at least as new as its add hides, left out (see prune). */
const pruneRaw = (l: unknown[], gone: Record<string, number>) => l.filter((x) => !rawId(x) || goneAt(gone, rawId(x)) < rawAt(x));
/**
 * Lists a newer build added, and the records of the known lists this build can't read, joined from another copy (see
 * joinRaw). On a tab merge every removal applies to them as to the lists this build knows; a restore applies none. A
 * list stored as something other than a list is taken whole, by adoptKept's rule.
 */
function adoptRaw(into: State, from: State, restore?: { newer: boolean; now: number }) {
  const b = from[KEPT];
  if (!into[KEPT] && !b) return;
  const k = kept(into);
  const theirsWin = restore ? restore.newer : true;
  const back = restore && { gone: into.gone, now: restore.now };
  const settle = (l: unknown[]) => (restore ? l : pruneRaw(l, into.gone));
  for (const key of ['comfort', 'activities', 'reasons', 'people', 'maps'] as const) k.dropped[key] = settle(b ? joinRaw(k.dropped[key], b.dropped[key], theirsWin, back) : k.dropped[key]);
  for (const [key, l] of Object.entries(b?.lists ?? {})) {
    const m = own(k.lists, key) ? k.lists[key] : undefined;
    if (Array.isArray(m) && Array.isArray(l)) putOwn(k.lists, key, joinRaw(m, l, theirsWin, back));
    else if (m === undefined || theirsWin) putOwn(k.lists, key, l);
  }
  for (const [key, l] of Object.entries(k.lists)) if (Array.isArray(l)) putOwn(k.lists, key, settle(l));
}
/**
 * On records both copies hold (the same key), the fields this build doesn't read, by adoptKept's rule; inner does the
 * same one level down (an event's data).
 */
function adoptRest<T extends object>(mine: T[], theirs: T[], keyOf: (x: T) => string, known: readonly string[], theirsWin: boolean, inner?: (m: T, t: T, raw?: Record<string, unknown>) => boolean, when?: (m: T, t: T) => boolean) {
  const map = new Map(theirs.map((x) => [keyOf(x), x]));
  for (const m of mine) {
    const t = map.get(keyOf(m));
    if (!t || t === m || (when && !when(m, t))) continue;
    // a record kept as stored takes the same fields in its stored form, so its values past this build's limits are
    // still what gets written (see AS_STORED)
    const was = AS_STORED.get(m);
    const raw = was && isObj(was.raw) && was.read === JSON.stringify(m) ? was.raw : undefined;
    for (const [k, v] of restOf(t, known)) {
      if (!(theirsWin || !own(m, k))) continue;
      putOwn(m, k, v);
      if (raw) putOwn(raw, k, v);
    }
    const whole = inner ? inner(m, t, raw) : true;
    if (raw && whole) was!.read = JSON.stringify(m);
  }
}
/** The fields a newer build stored on events this copy already has, and in their data. */
function adoptEventRest(mine: Ev[], theirs: Ev[], theirsWin: boolean) {
  adoptRest(mine, theirs, (e) => e.id, EV_KEYS, theirsWin, (m, t, raw) => {
    if (!isObj(t.data)) return true;
    const known: readonly string[] = (EV_DATA as Partial<Record<EvKind, readonly string[]>>)[m.k] ?? [];
    // false when the stored form's data isn't an object to hold them: then the record is written as this build reads it
    let whole = true;
    for (const [k, v] of restOf(t.data, known)) {
      if (!m.data) m.data = {};
      if (!(theirsWin || !own(m.data, k))) continue;
      putOwn(m.data, k, v);
      if (!raw) continue;
      if (raw.data === undefined) raw.data = {};
      if (isObj(raw.data)) putOwn(raw.data, k, v);
      else whole = false;
    }
    return whole;
  });
}
/** The kept part of a copy in a form two copies can compare (see canon). */
function keptCanon(s: State) {
  const k = s[KEPT];
  const sorted = (o: object | undefined) => (o ? Object.entries(o).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)) : []);
  return [s.v, restOf(s.settings, SETTINGS_KEYS), restOf(s.flags, FLAG_KEYS), sorted(k?.profile), sorted(k?.profileAt), sorted(k?.setAt), sorted(k?.names), (k?.titles ?? []).map((t) => JSON.stringify(t)).sort(), (k?.events ?? []).map((e) => JSON.stringify(e)).sort(), k ? Object.values(k.dropped).map((l) => l.map((x) => JSON.stringify(x)).sort()) : [], sorted(k?.days), sorted(k?.lists).map(([key, l]) => [key, Array.isArray(l) ? l.map((x) => JSON.stringify(x)).sort() : l]), sorted(k?.pins)];
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
/** A record as text with keys sorted at every depth, so two copies of the same thing always read the same. */
const flat = (x: object) => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
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
/** The choice as stored: a value this build can't use (see Kept) counts as itself, not as the default it shows. */
function getSet(s: State, k: SetKey): SetVal {
  const raw = s[KEPT]?.raw;
  if (raw && own(raw, k)) return raw[k] as SetVal;
  const id = nameId(k);
  if (id) return own(s.settings.names, id) ? (s.settings.names[id] ?? '') : '';
  return k === 'safeCredit' ? s.flags.safeCredit : s.settings[k as Exclude<SetKey, NameKey | 'safeCredit'>];
}
function putSet(s: State, k: SetKey, v: SetVal) {
  const usable = USABLE[k];
  if (usable) {
    const fits = usable(v);
    if (fits) delete s[KEPT]?.raw[k];
    else putOwn(kept(s).raw, k, v);
    if (!fits) v = getSet(BLANK, k);
  }
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
    [s.flags.rankSeen, s.flags.wardenSeen, s.flags.therapistLineShown, s.flags.welcomeOwed, ...DAY_FLAGS.map((k) => s.flags[k]), s.flags.questAsideDay, s.flags.questAsideAt, [...s.flags.titlesSeen].sort()],
    Object.entries(s.skillPins).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, p]) => [id, flat(p)]),
    extrasOf(s),
    keptCanon(s),
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
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const fromBig = (b: bigint) => (b > SAFE ? b.toString() : Number(b));
const stamp = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? fromBig(BigInt(Math.floor(x))) : typeof x === 'string' && /^\d+$/.test(x) ? fromBig(BigInt(x)) : 0);
const oneOf = <T extends string>(x: unknown, list: readonly T[], fallback: T): T => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : fallback);
export const isSkillId = (id: unknown): id is string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKILL, id);
/** The latest time a Date can hold: a later stamp is read as this, so one more change still counts as later. */
const PIN_AT_MAX = 8.64e15;
/** Whether their pin decision replaces mine: the later one wins, and at the same time an unpin does, in every copy. */
const pinWins = (theirs: SkillPin, mine: SkillPin | undefined) => !mine || theirs.at > mine.at || (theirs.at === mine.at && mine.pinned && !theirs.pinned);

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
export function mergeEntry(a: DiaryEntry, b: DiaryEntry, prefer?: 'a' | 'b'): DiaryEntry {
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
  const out: DiaryEntry = { day: a.day, emotions, urges, note, updatedAt: Math.max(a.updatedAt, b.updatedAt), ft };
  // what a newer build stored on the day and its field times: the copy the caller prefers (the stored copy for another
  // tab, the newer save version for a restore), else the later-saved one, whichever way round they come
  const rest = (e: DiaryEntry) => JSON.stringify([restOf(e, ENTRY_KEYS), restOf(e.ft ?? {}, []).filter(([k]) => !isFieldKey(k))]);
  const later = prefer ? prefer === 'b' : b.updatedAt !== a.updatedAt ? b.updatedAt > a.updatedAt : rest(b) > rest(a);
  for (const e of later ? [a, b] : [b, a]) {
    for (const [k, v] of restOf(e, ENTRY_KEYS)) putOwn(out, k, v);
    if (e.ft) for (const [k, v] of Object.entries(e.ft)) if (!isFieldKey(k)) putOwn(ft, k, v);
  }
  return out;
}
const isFieldKey = (k: string) => k === 'note' || k.startsWith('e:') || k.startsWith('u:');
/** What this build reads of a diary day, each field with the time it counts from: nothing a newer build added. */
const entryRead = (e: DiaryEntry) => flat({ day: e.day, emotions: e.emotions, urges: e.urges, note: e.note, updatedAt: e.updatedAt, times: fieldTimes(e) });
/**
 * A merged diary day that differs from one copy only in fields a newer build added takes that copy's stored form with
 * the merged fields laid on it, so a day past this build's limits (a longer note, rows past 5) is still written as
 * stored (see AS_STORED). A day whose known fields came from both copies is this build's own, written as it reads it.
 */
function keepStoredDay(merged: DiaryEntry, ...copies: DiaryEntry[]): DiaryEntry {
  const read = entryRead(merged);
  for (const c of copies) {
    const t = AS_STORED.get(c);
    if (!t || !isObj(t.raw) || t.read !== JSON.stringify(c) || entryRead(c) !== read) continue;
    const raw = JSON.parse(JSON.stringify(t.raw)) as Record<string, unknown>;
    for (const [k, v] of restOf(merged, ENTRY_KEYS)) putOwn(raw, k, v);
    const times = Object.entries(merged.ft ?? {}).filter(([k]) => !isFieldKey(k));
    if (times.length && raw.ft === undefined) raw.ft = {};
    if (times.length && !isObj(raw.ft)) continue;
    for (const [k, v] of times) putOwn(raw.ft as object, k, v);
    return twin(merged, raw, true);
  }
  return merged;
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
  if (!Array.isArray(raw.events)) return null;
  if (raw.app !== undefined && raw.app !== APP_ID) return null;
  const base = freshState(num(raw.created) ?? Date.now());
  // A device save's v is its save version; a Crystal's v is the Crystal's own, with the save version in schema. A newer
  // one than this build writes is read like any other and keeps its number, so it is never written back as older.
  const saved = raw.app === APP_ID ? raw.schema : raw.v;
  if (typeof saved === 'number' && Number.isFinite(saved) && saved > SCHEMA) base.v = saved;
  const newer = base.v > SCHEMA;
  const kinds = EV_KINDS;
  const stats = Object.values(MODULES).map((m) => m.stat);
  if (Array.isArray(raw.events)) {
    const seen = new Set<string>();
    for (const e of raw.events) {
      if (!isObj(e) || typeof e.id !== 'string' || seen.has(e.id)) continue;
      // a kind a newer build added: kept whole, and left out of this build's progress
      if (!kinds.includes(e.k as EvKind)) {
        if (typeof e.k === 'string') {
          seen.add(e.id);
          kept(base).events.push(e);
        }
        continue;
      }
      if (typeof e.day !== 'string' || !validDay(e.day.slice(0, 10))) {
        // in a newer save, an event this build can't read is kept whole too
        if (newer) {
          seen.add(e.id);
          kept(base).events.push(e);
        }
        continue;
      }
      const ev: Ev = { id: e.id, t: num(e.t) ?? 0, day: e.day.slice(0, 10), k: e.k as EvKind, xp: Math.max(0, Math.min(500, num(e.xp) ?? 0)) };
      // a stat a newer build added stays on the event; derived() counts only the stats it knows
      if (stats.includes(e.stat as StatId) || (own(e, 'stat') && e.stat !== undefined)) putOwn(ev, 'stat', e.stat);
      if (typeof e.skill === 'string') ev.skill = e.skill.slice(0, 40);
      if (isObj(e.data)) {
        const d: Ev['data'] = {};
        const known: readonly string[] = (EV_DATA as Partial<Record<EvKind, readonly string[]>>)[ev.k] ?? [];
        for (const [k, val] of Object.entries(e.data)) {
          if (!known.includes(k)) putOwn(d, k, val);
          else if (['string', 'number', 'boolean'].includes(typeof val) || val === null) d[k] = typeof val === 'string' ? val.slice(0, 400) : (val as number | boolean | null);
        }
        ev.data = d;
      }
      keepRest(ev, e, EV_KEYS);
      seen.add(ev.id);
      base.events.push(twin(ev, e, newer));
    }
  }
  if (isObj(raw.diary)) {
    for (const [day, e] of Object.entries(raw.diary)) {
      if (!isObj(e) || !validDay(day)) {
        if (newer) putOwn(kept(base).days, day, e);
        continue;
      }
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
          // a field time a newer build added, as stored
          if (!isFieldKey(k)) putOwn(ft, k, val);
          if (!isFieldKey(k) || k.length > 64 || num(val) === null) continue;
          const kind = k.startsWith('e:') ? 'emotions' : k.startsWith('u:') ? 'urges' : null;
          if (k === 'note' || (kind && own(entry[kind], k.slice(2)))) ft[k] = val as number;
        }
        if (Object.keys(ft).length) entry.ft = ft;
      }
      base.diary[day] = twin(keepRest(entry, e, ENTRY_KEYS), e, newer);
    }
  }
  const withAt = <T extends object>(o: T, raw: Record<string, unknown>, known: readonly string[]): T => keepRest(num(raw.at) !== null ? { ...o, at: raw.at as number } : o, raw, known);
  /** A list of records; in a newer save, one this build can't read is kept as stored. */
  const listOf = <T extends { id: string }>(x: unknown, make: (i: Record<string, unknown>) => T, ok: (r: T) => boolean, key: keyof Kept['dropped']): T[] => {
    if (!Array.isArray(x)) return [];
    const out: T[] = [];
    for (const i of x) {
      const r = isObj(i) ? make(i) : null;
      if (r && ok(r)) out.push(twin(r, i, newer && isObj(i) && i.id === r.id));
      else if (newer) kept(base).dropped[key].push(i);
    }
    return firstById(out);
  };
  const item = (i: Record<string, unknown>): Item => withAt({ id: str(i.id, 40) || uid(), text: str(i.text, 200) }, i, ITEM_KEYS);
  if (isObj(raw.lists)) {
    base.lists.comfort = listOf(raw.lists.comfort, item, (i) => !!i.text, 'comfort');
    base.lists.activities = listOf(raw.lists.activities, item, (i) => !!i.text, 'activities');
    base.lists.reasons = listOf(raw.lists.reasons, item, (i) => !!i.text, 'reasons');
    base.lists.people = listOf(raw.lists.people, (p) => withAt({ id: str(p.id, 40) || uid(), name: str(p.name, 80), phone: str(p.phone, 40) }, p, PERSON_KEYS), (p) => !!p.name, 'people');
    // a list a newer build added: kept as stored, never shown here
    for (const [k, l] of restOf(raw.lists, LIST_KEYS)) putOwn(kept(base).lists, k, l);
  }
  if (Array.isArray(raw.maps)) {
    base.maps = listOf(raw.maps, (m) => withAt({ id: str(m.id, 40) || uid(), t: num(m.t) ?? 0, urge: str(m.urge), p1: str(m.p1), c1: str(m.c1), p2: str(m.p2), c2: str(m.c2), choice: str(m.choice, 40) }, m, MAP_KEYS), () => true, 'maps');
  }
  if (isObj(raw.gone)) base.gone = capGone(Object.entries(raw.gone).filter((e): e is [string, number] => !!e[0] && e[0].length <= 40 && num(e[1]) !== null));
  if (isObj(raw.setAt)) {
    const sa = raw.setAt;
    for (const k of BASE_SET_KEYS) {
      const t = own(sa, k) ? num(sa[k]) : null;
      if (t !== null) base.setAt[k] = Math.max(0, t);
    }
    for (const [k, val] of restOf(sa, BASE_SET_KEYS)) putOwn(kept(base).setAt, k, val);
  }
  if (isObj(raw.profile)) {
    const pf = raw.profile;
    for (const k of ['theme', 'accent', 'cardBack', 'plate', 'title', 'region'] as const) if (own(pf, k) && pf[k] !== undefined) putSet(base, k, pf[k] as SetVal);
    base.settings.playerName = cleanName(pf.playerName);
    base.settings.companion = cleanName(pf.companion);
    if (isObj(pf.names)) {
      for (const id of SHADOW_IDS) {
        const n = own(pf.names, id) ? cleanName(pf.names[id]) : '';
        if (n) base.settings.names[id] = n;
      }
      for (const [id, n] of restOf(pf.names, SHADOW_IDS)) putOwn(kept(base).names, id, n);
    }
    if (Array.isArray(pf.titlesSeen)) {
      base.flags.titlesSeen = TITLE_IDS.filter((t) => (pf.titlesSeen as unknown[]).includes(t));
      const titles = kept(base).titles;
      for (const t of pf.titlesSeen) if (!(TITLE_IDS as readonly unknown[]).includes(t) && !titles.some((x) => JSON.stringify(x) === JSON.stringify(t))) titles.push(t);
    }
    if (isObj(pf.setAt)) {
      for (const k of PROFILE_SET_KEYS) {
        const t = own(pf.setAt, k) ? num(pf.setAt[k]) : null;
        if (t !== null) base.setAt[k] = Math.max(0, t);
      }
      for (const [k, val] of restOf(pf.setAt, PROFILE_SET_KEYS)) putOwn(kept(base).profileAt, k, val);
    }
    for (const [k, val] of restOf(pf, PROFILE_KEYS)) putOwn(kept(base).profile, k, val);
  }
  for (const [k, val] of extrasOf(raw)) putOwn(base, k, val);
  if (isObj(raw.skillPins))
    for (const [id, p] of Object.entries(raw.skillPins)) {
      // pins for skills this build doesn't know are kept too (a newer build's skills), never shown
      if (id.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) && isObj(p) && typeof p.pinned === 'boolean' && num(p.at) !== null)
        putOwn(base.skillPins, id, twin(keepRest({ pinned: p.pinned, at: Math.min(PIN_AT_MAX, Math.max(0, p.at as number)) }, p, PIN_KEYS), p, newer));
      else if (newer) putOwn(kept(base).pins, id, p);
    }
  if (Array.isArray(raw.lines)) {
    const byDay = new Map<string, LineEntry>();
    for (const l of raw.lines) {
      if (!isObj(l) || !validDay(l.day) || !str(l.text, 200)) {
        if (newer) kept(base).dropped.lines.push(l);
        continue;
      }
      const e: LineEntry = twin(keepRest({ day: l.day, id: str(l.id, 12), tag: str(l.tag, 24), text: str(l.text, 200), t: num(l.t) ?? 0 }, l, LINE_KEYS), l, newer);
      const had = byDay.get(e.day);
      if (!had || e.t >= had.t) {
        // a newer save's second line for a day is kept as stored
        if (had && newer) kept(base).dropped.lines.push(AS_STORED.get(had)?.raw ?? had);
        byDay.set(e.day, e);
      } else if (newer) kept(base).dropped.lines.push(l);
    }
    base.lines = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }
  if (isObj(raw.settings)) {
    const s = raw.settings;
    for (const k of ['sound', 'motion', 'vibrate'] as const) if (own(s, k) && s[k] !== undefined) putSet(base, k, s[k] as SetVal);
    if (Array.isArray(s.emotionRows)) base.settings.emotionRows = twin(s.emotionRows.map((r) => str(r, 60)).filter(Boolean).slice(0, ROW_CAP.emotions), s.emotionRows, newer);
    if (Array.isArray(s.urgeRows)) base.settings.urgeRows = twin(s.urgeRows.map((r) => str(r, 60)).filter(Boolean).slice(0, ROW_CAP.urges), s.urgeRows, newer);
    keepRest(base.settings, s, SETTINGS_KEYS);
  }
  if (isObj(raw.flags)) {
    keepRest(base.flags, raw.flags, FLAG_KEYS);
    const f = raw.flags;
    base.flags.rankSeen = Math.max(0, Math.min(5, num(f.rankSeen) ?? 0));
    base.flags.wardenSeen = f.wardenSeen === true;
    const day = (x: unknown) => (validDay(x) ? x : '');
    base.flags.giftDay = day(f.giftDay);
    base.flags.cardDay = day(f.cardDay);
    base.flags.greetDay = day(f.greetDay);
    base.flags.safeCredit = f.safeCredit === true;
    base.flags.therapistLineShown = f.therapistLineShown === true;
    base.flags.welcomeOwed = f.welcomeOwed === true;
    base.flags.checkinDay = day(f.checkinDay);
    base.flags.questAsideDay = day(f.questAsideDay);
    base.flags.questAsideAt = stamp(f.questAsideAt);
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
  private offClear: (() => void) | null = null;
  private offWritten: (() => void) | null = null;
  /** a save waiting out a clear's hold */
  private deferred = false;
  /**
   * What the stored copy this one last read or wrote kept for a newer build (see keptKeys), and its save version. A later
   * stored copy of at least that version without one of them had it removed by the build that wrote it.
   */
  private keptBase: { v: number; keys: Set<string> } = { v: 0, keys: new Set() };
  /**
   * The choices in SHOWN_BESIDE as this copy last heard or stored them, so one made while it was away is heard on its way
   * back. Its own writes get no storage event, so a choice it stores is noted as it is written, and only that one: one
   * changed in another copy and missed meanwhile still differs on the way back.
   */
  private beside: (string | null)[] = [];

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
      let began: number | null = null;
      if (raw !== null) {
        try {
          const o: unknown = JSON.parse(raw);
          began = begunOf(o);
          st = normalize(o);
        } catch {
          st = null;
        }
        // unreadable or from a newer version: keep the original bytes before anything can overwrite them
        if (!st && !this.keepCopy(raw)) {
          this.locked = true;
          this.saving = false;
        }
      }
      this.took(raw, began);
    }
    this.state = st ?? freshState(clock());
    this.keptBase = { v: this.state.v, keys: keptKeys(this.state) };
    const adopted = this.mirrorYou();
    if (initial || (adopted && !this.locked)) this.save();
    if (typeof window !== 'undefined') this.offClear = onClear({ clear: () => this.wipe() });
    if (!this.locked && typeof window !== 'undefined') {
      window.addEventListener('storage', this.onStorage);
      window.addEventListener('pageshow', this.onShow);
      document.addEventListener('visibilitychange', this.onShow);
      const keys = this.besideKeys();
      this.offWritten = onWritten(keys, (k, v) => (this.beside[keys.indexOf(k)] = v));
    }
    this.beside = this.besideNow();
  }

  /** False when what is stored couldn't be read into this copy, so a Save Crystal made now can't hold it. */
  get readable() {
    return !this.locked;
  }

  /** The stored copy this one last read or wrote, and when that save was begun (its created field). */
  private took(raw: string | null, began: number | null) {
    this.lastRaw = raw;
    if (raw !== null && this.key === SAVE_KEY) sawStored(raw, began);
  }

  /**
   * True when a stored copy begun at `began` is a different save from the one this copy read: this game's data was
   * cleared in another copy and a new game began since. It is never folded in; the page reloads into it instead.
   */
  private replaced(began: number | null) {
    return this.key === SAVE_KEY && replacedBy(began);
  }

  /** This game's data is being cleared: nothing it held stays in memory, and it never writes again. */
  private wipe() {
    this.locked = true;
    this.lastRaw = null;
    this.state = freshState(this.clock());
    this.dispose();
    // the Safe Zone stays open through a clear: what it shows of the game's data goes with it
    this.listeners.forEach((f) => f());
  }

  /** Back in view (or back from the page cache): storage events may have been missed meanwhile, so read what is stored. */
  private onShow = (e: Event) => {
    if (e.type === 'pageshow' ? !(e as PageTransitionEvent).persisted : document.visibilityState !== 'visible') return;
    const moved = this.sync();
    const beside = this.besideNow();
    if (!moved && beside.every((v, i) => v === this.beside[i])) return;
    this.beside = beside;
    this.listeners.forEach((f) => f());
  };

  private besideKeys() {
    return SHOWN_BESIDE.map((b) => `${this.key}${b}`);
  }

  private besideNow() {
    try {
      return this.besideKeys().map((k) => localStorage.getItem(k));
    } catch {
      return this.beside;
    }
  }

  private onStorage = (e: StorageEvent) => {
    if (e.key === YOU_KEY && e.newValue !== null) {
      if (this.mirrorYou()) this.save();
      else this.listeners.forEach((f) => f());
      return;
    }
    if (SHOWN_BESIDE.some((b) => e.key === `${this.key}${b}`)) {
      this.beside = this.besideNow();
      this.listeners.forEach((f) => f());
      return;
    }
    if (e.key !== this.key || e.newValue === null) return;
    try {
      if (e.storageArea !== localStorage) return;
    } catch {
      return;
    }
    let other: State | null = null;
    let began: number | null = null;
    try {
      const o: unknown = JSON.parse(e.newValue);
      began = begunOf(o);
      other = normalize(o);
    } catch {
      other = null;
    }
    if (!other || this.replaced(began)) return;
    this.absorb(other);
    this.took(e.newValue, began);
    if (this.mirrorYou() || this.holdsMoreThan(other)) this.save();
    else this.listeners.forEach((f) => f());
  };

  dispose() {
    if (typeof window === 'undefined') return;
    this.offClear?.();
    this.offClear = null;
    this.offWritten?.();
    this.offWritten = null;
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
      const o: unknown = JSON.parse(cur);
      const other = normalize(o);
      const began = begunOf(o);
      if (!other || this.replaced(began)) return false;
      this.absorb(other);
      this.took(cur, began);
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
    if (!canWrite()) return false;
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

  /**
   * Calls fn whenever what this copy holds may have changed: a save here or in another open copy, a name or a choice in
   * SHOWN_BESIDE set in another copy, or this game's data cleared. Returns the function that stops it.
   */
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
    if (!canWrite()) {
      // a clear is checking its Save Crystal: this write goes ahead once the clear lets go (never, once it clears)
      if (!cleared() && !this.deferred) {
        this.deferred = true;
        write(() => {
          this.deferred = false;
          this.save();
        });
      }
      this.listeners.forEach((f) => f());
      return;
    }
    if (this.locked) this.mirrorYou();
    else {
      try {
        const cur = localStorage.getItem(this.key);
        // the save this copy read or wrote is gone: another copy cleared this game's data and this one missed it
        if (cur === null && this.lastRaw !== null && this.key === SAVE_KEY) return goneElsewhere();
        if (cur !== null && cur !== this.lastRaw) {
          let other: State | null = null;
          try {
            const o: unknown = JSON.parse(cur);
            // a new game begun after this game's data was cleared elsewhere: this copy's old progress stays out of it
            if (this.replaced(begunOf(o))) return;
            other = normalize(o);
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
        this.took(out, this.state.created);
        this.keptBase = { v: this.state.v, keys: keptKeys(this.state) };
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
  private mergeDiary(other: Record<string, DiaryEntry>, prefer: 'a' | 'b') {
    for (const [day, e] of Object.entries(other)) {
      const mine = this.state.diary[day];
      if (!mine) {
        this.state.diary[day] = e;
        continue;
      }
      const merged = mergeEntry(mine, e, prefer);
      const f = flat(merged);
      // an unchanged side keeps its object, so a newer save's stored form still reaches stored()
      this.state.diary[day] = f === flat(mine) ? mine : f === flat(e) ? e : keepStoredDay(merged, mine, e);
    }
  }

  /** What only ever grows: events by id, diary per field, the newer line per day, raised flags, the later day flags. */
  private absorbProgress(other: State, prefer: 'a' | 'b') {
    this.state.created = Math.min(this.state.created, other.created);
    if (this.addById(this.state.events, other.events)) this.state.events.sort((a, b) => a.t - b.t);
    this.mergeDiary(other.diary, prefer);
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
    // shown in either copy is shown
    f.welcomeOwed &&= o.welcomeOwed;
    for (const t of o.titlesSeen) if (!f.titlesSeen.includes(t)) f.titlesSeen.push(t);
    for (const k of DAY_FLAGS) if (validDay(o[k]) && (!validDay(f[k]) || o[k] > f[k])) f[k] = o[k];
    const oa = BigInt(o.questAsideAt), fa = BigInt(f.questAsideAt);
    if (oa > fa || (oa === fa && o.questAsideDay > f.questAsideDay)) {
      f.questAsideDay = o.questAsideDay;
      f.questAsideAt = o.questAsideAt;
    }
  }

  /**
   * Folds another open copy's state into this one. Lists and maps join by id (a removal is a tombstone newer than the
   * item, an Undo re-adds it newer than the tombstone), each choice takes the later change. Every rule is order-free, so
   * two copies that fold each other in end up holding the same thing. Arrays change in place: screens hold them.
   */
  private absorb(other: State) {
    // what a newer build (this version or later) removed since this copy last read: never written back. An older build
    // writes a lower version and drops what it can't read without meaning to, so nothing is removed for it.
    if (other.v >= this.keptBase.v) {
      const theirs = keptKeys(other);
      forget(this.state, [...this.keptBase.keys].filter((k) => !theirs.has(k)));
      this.keptBase = { v: other.v, keys: theirs };
    }
    this.absorbProgress(other, 'b');
    this.absorbPins(other, true);
    // what a newer build stored: the stored copy's, never dropped
    adoptKept(this.state, other, true);
    adoptEventRest(this.state.events, other.events, true);
    // the line this copy keeps for a day (absorbProgress), when the other copy holds the same one
    adoptRest(this.state.lines, other.lines, (l) => `${l.day}\n${l.id}\n${l.t}`, LINE_KEYS, true);
    this.state.v = Math.max(this.state.v, other.v);
    const gone = { ...this.state.gone };
    for (const [id, t] of Object.entries(other.gone)) if (t > goneAt(gone, id)) setOwn(gone, id, t);
    this.state.gone = Object.keys(gone).length > GONE_CAP ? capGone(Object.entries(gone)) : gone;
    for (const k of LIST_KEYS) {
      unionInto<Item | Person>(this.state.lists[k], other.lists[k]);
      adoptRest<Item | Person>(this.state.lists[k], other.lists[k], (x) => x.id, k === 'people' ? PERSON_KEYS : ITEM_KEYS, true, undefined, (m, t) => atOf(m) === atOf(t));
      prune<Item | Person>(this.state.lists[k], this.state.gone);
    }
    unionInto(this.state.maps, other.maps);
    adoptRest(this.state.maps, other.maps, (m) => m.id, MAP_KEYS, true, undefined, (m, t) => atOf(m) === atOf(t));
    prune(this.state.maps, this.state.gone);
    adoptRaw(this.state, other);
    for (const k of SET_KEYS) {
      const mt = this.state.setAt[k] ?? 0, ot = other.setAt[k] ?? 0;
      const mv = getSet(this.state, k), ov = getSet(other, k);
      if (ot > mt || (ot === mt && JSON.stringify(ov) > JSON.stringify(mv))) {
        putSet(this.state, k, Array.isArray(ov) ? [...ov] : ov);
        if (own(other.setAt, k)) this.state.setAt[k] = ot;
        // the rows the other copy stored (past what this build shows) go with them, as that copy would write them
        const now = getSet(this.state, k);
        if (Array.isArray(ov) && Array.isArray(now)) {
          const t = AS_STORED.get(ov);
          if (t && t.read === JSON.stringify(ov)) twin(now, t.raw, true);
          else AS_STORED.delete(now);
        }
      }
    }
  }

  /**
   * Each skill's pin on its own (see pinWins), so a pin here and an unpin of another skill elsewhere both stay. A pin
   * record this build can't read (see Kept) counts by its stored time, and on equal times theirsWin decides, as for
   * anything else a newer build stored; so do the fields a newer build put on a record both copies hold (see adoptRest).
   */
  private absorbPins(other: State, theirsWin: boolean) {
    const pins = this.state.skillPins;
    const mineKept = this.state[KEPT]?.pins ?? {}, theirKept = other[KEPT]?.pins ?? {};
    const same: [SkillPin, SkillPin][] = [];
    for (const id of new Set([...Object.keys(other.skillPins), ...Object.keys(theirKept)])) {
      const t = own(other.skillPins, id) ? other.skillPins[id] : undefined;
      const m = own(pins, id) ? pins[id] : undefined;
      const mineAt = m ? m.at : own(mineKept, id) ? rawAt(mineKept[id]) : -Infinity;
      if (t && m && !pinWins(t, m)) {
        if (t.at === m.at && t.pinned === m.pinned) same.push([m, t]);
        continue;
      }
      // with a record this build can't read on either side, the later stored time wins
      const theirAt = t ? t.at : rawAt(theirKept[id]);
      if (!(t && m) && (theirAt < mineAt || (theirAt === mineAt && !theirsWin))) continue;
      if (t) {
        putOwn(pins, id, t);
        if (own(mineKept, id)) delete mineKept[id];
      } else {
        putOwn(kept(this.state).pins, id, theirKept[id]);
        delete pins[id];
      }
    }
    const key = new Map(same.flatMap(([m, t], i) => [[m, String(i)], [t, String(i)]] as [SkillPin, string][]));
    adoptRest(same.map(([m]) => m), same.map(([, t]) => t), (p) => key.get(p) ?? '', PIN_KEYS, theirsWin);
  }

  /** Whether the player pinned this skill to Your favourites. */
  pinned(id: string) {
    return own(this.state.skillPins, id) && this.state.skillPins[id].pinned;
  }

  /**
   * Pins a skill to Your favourites or unpins it, later than any decision another open copy stored for it, and saves.
   * It replaces a record a newer build stored that this one can't read. A choice, not practice: nothing is credited.
   */
  pinSkill(id: string, on: boolean) {
    if (!isSkillId(id)) return;
    this.sync();
    const k = this.state[KEPT];
    const raw = k && own(k.pins, id) ? k.pins[id] : undefined;
    const old = (own(this.state.skillPins, id) ? this.state.skillPins[id] : isObj(raw) ? raw : {}) as Record<string, unknown>;
    const was = own(this.state.skillPins, id) ? this.state.skillPins[id].at : raw !== undefined ? rawAt(raw) : -Infinity;
    if (raw !== undefined) delete k!.pins[id];
    // the fields a newer build put on the record stay on it
    putOwn(this.state.skillPins, id, keepRest({ pinned: on, at: Math.max(this.now(), was + 1) }, old, PIN_KEYS));
    this.save();
  }

  /** Marks a choice as changed now (later than any change this copy made before, whatever the clock does). */
  touch(k: SetKey) {
    // the choice now holds a value this build set, in place of one it couldn't use
    delete this.state[KEPT]?.raw[k];
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
      if (e.stat && own(stats, e.stat)) stats[e.stat] += 1;
      if (e.k === 'visit') days.add(e.day);
      if ((e.k === 'skill' || e.k === 'card') && isSkillId(e.skill)) collection.add(e.skill);
    }
    // events this build can't read still carry their XP, so a newer save never shows less
    for (const e of this.state[KEPT]?.events ?? []) xp += typeof e.xp === 'number' && Number.isFinite(e.xp) ? Math.max(0, Math.min(500, e.xp)) : 0;
    const rank = rankFor(xp);
    return { xp, rank, warden: xp >= WARDEN_XP, nextAt: rank < RANKS.length - 1 ? RANK_XP[rank + 1] : xp < WARDEN_XP ? WARDEN_XP : null, stats, visitDays: [...days].sort(), collection };
  }

  /** Runs on mount and whenever the app becomes visible. Returns what greeting (if any) today needs. */
  openDay(): { kind: 'first' | 'back' | 'day' | null; visitIndex: number } {
    const today = this.today();
    const d = this.derived();
    const had = d.visitDays.includes(today);
    // the first open owes its welcome in the same save that counts its visit, so no copy holds one without the other
    if (this.state.flags.greetDay !== today && !d.visitDays.some((v) => v < today)) this.state.flags.welcomeOwed = true;
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

  questAside() {
    return this.state.flags.questAsideDay === this.today();
  }
  setQuestAside(on: boolean) {
    this.sync();
    const f = this.state.flags;
    f.questAsideDay = on ? this.today() : '';
    const next = BigInt(f.questAsideAt) + 1n, now = BigInt(Math.floor(this.now()));
    f.questAsideAt = fromBig(now > next ? now : next);
    this.save();
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

  /** Skill use codes for the diary card (UW diary card legend). `events` can be narrowed to that day's beforehand. */
  skillCodes(day: string, events = this.state.events) {
    const out: Record<string, number | 'p'> = {};
    for (const e of events) {
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
   * Union merge for Restore: imported data can only add. Events, list items, people and maps by id, in lists a newer
   * build added too (duplicates inside the file count once; one removed here comes back, newer than its removal), diary
   * per field, the newer line per day, and the diary rows the file uses, and the titles the file has seen. The Wardrobe
   * picks, the equipped title, each shadow's name and the crisis-line country come from the file only where this device
   * has no change time for that choice (the player never set it here), so a new device gets them back; one the player
   * made here, a cleared name included, always wins. A choice taken from the file takes the file's change time too,
   * never later than this device's now (now when the file has none), so another open copy doesn't see it as older than
   * its own default. Explicit sound, motion and vibration choices stay on this device, and the file's removals are not
   * applied.
   */
  merge(other: State) {
    this.sync();
    const newer = other.v > this.state.v;
    this.absorbProgress(other, newer ? 'b' : 'a');
    // pins per skill as between open copies, so the file's older pin never undoes a newer unpin here
    this.absorbPins(other, newer);
    // what a newer build stored, from both: on a clash the copy with the newer save version keeps its value, so a
    // value from an older build never replaces a newer one; on the same version this device's value stays
    adoptKept(this.state, other, newer);
    adoptEventRest(this.state.events, other.events, newer);
    for (const k of LIST_KEYS) adoptRest<Item | Person>(this.state.lists[k], other.lists[k], (x) => x.id, k === 'people' ? PERSON_KEYS : ITEM_KEYS, newer);
    adoptRest(this.state.maps, other.maps, (m) => m.id, MAP_KEYS, newer);
    adoptRest(this.state.lines, other.lines, (l) => `${l.day}\n${l.id}\n${l.t}`, LINE_KEYS, newer);
    this.state.v = Math.max(this.state.v, other.v);
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
    adoptRaw(this.state, other, { newer, now: this.now() });
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
    // a choice either copy holds as a value this build can't use came from a newer build: like any field it doesn't
    // read, the newer save version's value wins, with its change time
    const raws = new Set<SetKey>();
    for (const k of Object.keys(USABLE) as SetKey[]) {
      const mine = own(this.state[KEPT]?.raw ?? {}, k);
      if (!mine && !own(other[KEPT]?.raw ?? {}, k)) continue;
      // otherwise the ordinary rule below decides, unless this device holds its own raw value
      if (!newer || !own(other.setAt, k)) {
        if (mine) raws.add(k);
        continue;
      }
      raws.add(k);
      putSet(this.state, k, getSet(other, k));
      // later than this device's own change, so no other open copy undoes it
      this.state.setAt[k] = own(this.state.setAt, k) ? Math.max(now, (this.state.setAt[k] ?? 0) + 1) : Math.min(other.setAt[k] ?? now, now);
    }
    for (const k of [...DEVICE_SET_KEYS, ...PROFILE_SET_KEYS]) {
      if (own(this.state.setAt, k) || raws.has(k)) continue;
      if (DEVICE_SET_KEYS.includes(k) && getSet(this.state, k) !== getSet(blank, k)) continue;
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
    return JSON.stringify({ app: APP_ID, exported: new Date(this.now()).toISOString(), ...stored(this.state), v: CRYSTAL_SCHEMA, schema: this.state.v, ...extra });
  }
}
