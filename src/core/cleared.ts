/**
 * Clearing this game's data (Settings > Your data) reaches every open copy of the app on this device. While a clear
 * checks its Save Crystal against what is stored, writes wait (held); once clearing starts, nothing on the page writes
 * again (cleared) until the game is opened afresh. Open copies hear it on a channel; one that missed it (frozen, or in
 * the back/forward cache) notices on its way back that the save it had read is gone, or that the clear record moved
 * since the page opened (see clearedSince), and then reloads into a game begun since, if there is one. A different save
 * with the record where it was is another open copy's, and is folded in as usual. Every write to this device goes
 * through write() or mayWrite().
 */
import { AFTER_CLEAR, CARE_KEY, CLEARED_KEY, SAVE_KEY, TAB_KEY } from './stored-names';

/** What a cleared page shows: its own clear's progress, or one from another copy of the app. */
export type ClearStatus = 'clearing' | 'waiting' | 'done' | 'failed' | 'elsewhere' | 'elsewhere-done' | 'elsewhere-failed';

interface Hooks {
  /** writes are held: finish the ones already under way */
  hold?: () => Promise<unknown> | void;
  resume?: () => void;
  /** clearing has begun: stop for good and let go of what this copy holds */
  clear?: () => void;
}

type Msg = { type: string; id: string; tab?: string; status?: ClearStatus };

let phase: 'open' | 'held' | 'cleared' = 'open';
let holder = '';
let holdTimer = 0;
let status: ClearStatus = 'clearing';
let sawSave = false;
const queued: (() => void)[] = [];
const waiting: ((open: boolean) => void)[] = [];
const hooks = new Set<Hooks>();
const watchers = new Set<() => void>();
let acks: ((m: Msg) => void) | null = null;
/** A copy that hears no more from the clear holding it (that tab closed) carries on after this long. */
const HOLD_MS = 10000;
const TAB = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const browser = typeof window !== 'undefined';

const channel = (() => {
  if (!browser || typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel('dbt.clear');
  } catch {
    return null;
  }
})();
const post = (m: Msg) => {
  try {
    channel?.postMessage(m);
  } catch {
    /* the other copies notice on their way back instead */
  }
};

/** Writes may go ahead: no clear holds them, began, or happened since this page opened (see clearedSince). */
const open = () => phase === 'open' && !clearedSince();
export const canWrite = open;
export const cleared = () => phase === 'cleared';
export const clearStatus = () => status;

/** What is stored under k, or undefined where storage can't be read. */
const storedAt = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return undefined;
  }
};
/** The clear record as this page opened (null: never cleared here), before anything on it could read the save. */
const knownClear = browser ? storedAt(CLEARED_KEY) : undefined;
const noting = new Set<{ keys: string[]; wrote: (k: string, v: string | null) => void }>();
/**
 * Calls wrote with each of keys a write changes (see write), now or once a hold ends, and what it holds now, as a page
 * hears no storage event for its own writes. Returns the function that stops it.
 */
export function onWritten(keys: string[], wrote: (k: string, v: string | null) => void) {
  const n = { keys, wrote };
  noting.add(n);
  return () => void noting.delete(n);
}
function run(fn: () => void) {
  const before = [...noting].map((n) => [n, n.keys.map(storedAt)] as const);
  try {
    fn();
  } finally {
    for (const [n, was] of before)
      n.keys.forEach((k, i) => {
        const now = storedAt(k);
        if (now !== undefined && now !== was[i]) n.wrote(k, now);
      });
  }
}

/**
 * What this page stored beside the saves, by key, and when each store finished. One held up past the start of a clear
 * lands after the clear took everything, so it is taken back once this page hears of the clear (see undoLate). The
 * saves carry their own note instead (AFTER_CLEAR).
 */
const wrote = new Map<string, { v: string; at: number }>();

/** Stores this game's data beside its saves (once write() or canWrite() let it): every such write goes through here. */
export function setStored(k: string, v: string) {
  localStorage.setItem(k, v);
  wrote.set(k, { v, at: Date.now() });
}

/** Takes this game's data from beside its saves (once write() or canWrite() let it). */
export function removeStored(k: string) {
  localStorage.removeItem(k);
  wrote.delete(k);
}

/** When a clear began, from its id (`<tab>.<time>`, as holdAll and noteClear make them). */
const clearTime = (id: string | null | undefined) => (id ? parseInt(id.slice(id.lastIndexOf('.') + 1), 36) : NaN);

/** When the clear this page missed began, once the clear record shows one happened since the page opened (else NaN). */
const missedAt = () => {
  const now = storedAt(CLEARED_KEY);
  return knownClear !== undefined && now !== undefined && now !== knownClear ? clearTime(now) : NaN;
};

/**
 * A clear this page missed began at `since`: what it wrote before then the clear took, and what it finished writing
 * after came too late for it, so that goes now, unless something else was stored there since. Until this page knows
 * when the clear began (it can hear of it first from its databases going), it keeps what it wrote for the next try.
 */
function undoLate(since: number) {
  if (!Number.isFinite(since)) return;
  for (const [k, w] of wrote)
    try {
      if (w.at >= since && localStorage.getItem(k) === w.v) localStorage.removeItem(k);
    } catch {
      /* storage can't be changed: the next clear takes it */
    }
  wrote.clear();
}

/** Runs a write now, after a hold ends, or never once clearing has begun. */
export function write(fn: () => void) {
  if (open()) run(fn);
  else if (phase === 'held') queued.push(fn);
}

/** For a write that can wait: true when it may go ahead (now or once a hold ends), false once clearing has begun. */
export function mayWrite(): Promise<boolean> {
  if (phase !== 'held') return Promise.resolve(open());
  return new Promise((r) => waiting.push(r));
}

export function onClear(h: Hooks) {
  hooks.add(h);
  return () => void hooks.delete(h);
}

export function onClearStatus(fn: () => void) {
  watchers.add(fn);
  return () => void watchers.delete(fn);
}

export function setClearStatus(s: ClearStatus) {
  status = s;
  if (!s.startsWith('elsewhere')) post({ type: 'status', id: holder, status: s });
  watchers.forEach((f) => f());
}

/** Which clear a save this page writes comes after (see AFTER_CLEAR). */
export const clearSeen = () => knownClear ?? null;

/**
 * True when a stored save (parsed) was written before this device's latest clear: by a copy that was still writing as
 * the clear ran, or held up mid-save until after it. It is cleared data, so it is never read, folded in or kept.
 */
export function fromBefore(o: unknown) {
  if (!o || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, AFTER_CLEAR)) return false;
  const now = storedAt(CLEARED_KEY);
  return now !== undefined && (o as Record<string, unknown>)[AFTER_CLEAR] !== now;
}

/** Whether a stored save (raw) is the game on this device now: neither gone nor written before the latest clear. */
const current = (raw: string | null | undefined) => {
  if (raw === null) return false;
  try {
    return !fromBefore(JSON.parse(raw ?? 'null'));
  } catch {
    return true;
  }
};

/** This page read or wrote the save, so the save being gone later means this game's data was cleared. */
export function sawStored() {
  sawSave = true;
}

/**
 * True when this game's data was cleared on this device since this page opened, which this page missed: the clear
 * record moved. Only a clear moves it, so a save that changed while it stayed put is another open copy's (two opened
 * at once on a new device each begin a game), never a new game after a clear. This page stops writing (folding what it
 * holds in would undo the clear) and reloads into the game begun since, or shows the clear when there is none (no save,
 * or only one written before the clear: this page's own, held up mid-save until after it).
 */
export function clearedSince() {
  const now = storedAt(CLEARED_KEY);
  if (knownClear === undefined || now === undefined || now === knownClear) return false;
  if (phase !== 'cleared') {
    if (!current(storedAt(SAVE_KEY))) goneElsewhere();
    else {
      stop();
      undoLate(clearTime(now));
      location.reload();
    }
  }
  return true;
}

/** Moves the clear record, in the step that takes the save, so every copy that missed the clear knows it happened. */
export function noteClear() {
  localStorage.setItem(CLEARED_KEY, `${TAB}.${Date.now().toString(36)}`);
}

/** Another copy cleared this game's data and this one missed the message: it stops as if it had heard. */
export function goneElsewhere() {
  end('elsewhere-done');
}

/** Nothing on this page writes again, and what this tab kept for itself goes. */
function stop() {
  phase = 'cleared';
  holder = '';
  clearTimeout(holdTimer);
  queued.length = 0;
  waiting.splice(0).forEach((w) => w(false));
  for (const k of [TAB_KEY, CARE_KEY])
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* nothing kept there */
    }
}

/** since: when the clear began, when this page heard it from the clearing copy (else the clear record says) */
function end(s: ClearStatus, since?: number) {
  if (phase === 'cleared') return;
  stop();
  undoLate(since ?? missedAt());
  status = s;
  for (const h of [...hooks])
    try {
      h.clear?.();
    } catch {
      /* one part failing to let go must not keep the others writing */
    }
  watchers.forEach((f) => f());
}

/** timed: another copy's clear, so this copy carries on by itself if that copy goes quiet */
async function hold(id: string, timed: boolean) {
  if (phase === 'cleared') return;
  clearTimeout(holdTimer);
  if (timed) holdTimer = window.setTimeout(() => resume(id), HOLD_MS);
  phase = 'held';
  holder = id;
  await Promise.all([...hooks].map((h) => Promise.resolve(h.hold?.()).catch(() => undefined)));
}

function resume(id: string) {
  if (phase !== 'held' || holder !== id) return;
  phase = 'open';
  holder = '';
  clearTimeout(holdTimer);
  // the writes waiting go nowhere if the clear went on while this copy wasn't hearing it
  if (clearedSince()) return;
  for (const fn of queued.splice(0))
    try {
      run(fn);
    } catch {
      /* the next write tries again */
    }
  waiting.splice(0).forEach((w) => w(true));
  hooks.forEach((h) => h.resume?.());
}

if (channel)
  channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (!data || typeof data !== 'object' || typeof (data as Msg).id !== 'string') return;
    const m = data as Msg;
    if (m.type === 'holding' || m.type === 'held') acks?.(m);
    else if (m.type === 'stop') {
      if (phase === 'held' && holder === m.id) {
        // still checking: stay held
        clearTimeout(holdTimer);
        holdTimer = window.setTimeout(() => resume(m.id), HOLD_MS);
        return;
      }
      post({ type: 'holding', id: m.id, tab: TAB });
      void hold(m.id, true).then(() => post({ type: 'held', id: m.id, tab: TAB }));
    } else if (m.type === 'resume') resume(m.id);
    else if (m.type === 'clear') {
      end('elsewhere', clearTime(m.id));
      undoLate(clearTime(m.id));
    }
    else if (m.type === 'status' && phase === 'cleared' && status.startsWith('elsewhere')) {
      status = m.status === 'done' ? 'elsewhere-done' : m.status === 'failed' ? 'elsewhere-failed' : 'elsewhere';
      watchers.forEach((f) => f());
    }
  };

if (browser) {
  const check = () => {
    // a page that stopped before it knew when the clear began takes back its late writes once the record shows it
    if (phase === 'cleared') return void undoLate(missedAt());
    if (clearedSince()) return;
    // storage that can't be read reads as undefined: the next write finds out. A save from before the clear this page
    // knows of is a late write the store writes over (see fromBefore), not a clear
    if (sawSave && storedAt(SAVE_KEY) === null) goneElsewhere();
  };
  // capture, so this runs before the app's own listeners for the same moment can write
  window.addEventListener('pageshow', (e) => e.persisted && check(), true);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check(), true);
  document.addEventListener('resume', check, true);
  window.addEventListener('focus', check, true);
  // any key: a new game's first writes (its names, say) can come before its save, and must not reach this page's old one
  window.addEventListener('storage', check, true);
}

/**
 * Holds every open copy's writes, this one's included, while a clear checks its Save Crystal. Resolves once each copy
 * that answered has finished the writes it had under way (a frozen one can't answer, and notices on its way back).
 * Then either release() lets them carry on or clear() begins clearing everywhere.
 */
export async function holdAll(): Promise<{ release(): void; clear(): void }> {
  const id = `${TAB}.${Date.now().toString(36)}`;
  const answered = new Set<string>(), held = new Set<string>();
  post({ type: 'stop', id });
  const beat = window.setInterval(() => post({ type: 'stop', id }), 1000);
  const gathered = new Promise<void>((done) => {
    let early = true;
    const finish = () => {
      clearTimeout(soon);
      clearTimeout(late);
      acks = null;
      done();
    };
    const settle = () => !early && [...answered].every((t) => held.has(t)) && finish();
    // copies answer within a few milliseconds; past three seconds a silent one is treated as frozen
    const soon = window.setTimeout(() => ((early = false), settle()), 250);
    const late = window.setTimeout(finish, 3000);
    acks = (m) => {
      if (m.id !== id || !m.tab) return;
      (m.type === 'holding' ? answered : held).add(m.tab);
      settle();
    };
  });
  await hold(id, false);
  await gathered;
  return {
    release() {
      clearInterval(beat);
      post({ type: 'resume', id });
      resume(id);
    },
    clear() {
      clearInterval(beat);
      post({ type: 'clear', id });
      end('clearing');
    },
  };
}
