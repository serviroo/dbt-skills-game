/**
 * Clearing this game's data (Settings > Your data) reaches every open copy of the app on this device. While a clear
 * checks its Save Crystal against what is stored, writes wait (held); once clearing starts, nothing on the page writes
 * again (cleared) until the game is opened afresh. Open copies hear it on a channel; one that missed it (frozen, or in
 * the back/forward cache) notices on its way back that the save it had read is gone, or that a save begun since (a new
 * game in another tab) took its place, and then reloads into that one. Every write to this device goes through write()
 * or mayWrite().
 */
import { CARE_KEY, SAVE_KEY, TAB_KEY } from './stored-names';

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
/** the save this page last read or wrote, when that save was begun (null when it doesn't say), and when this page saw it */
let seenRaw: string | null = null;
let seenBegun: number | null = null;
let seenAt = 0;
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

export const canWrite = () => phase === 'open';
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

/** Runs a write now, after a hold ends, or never once clearing has begun. */
export function write(fn: () => void) {
  if (phase === 'open') run(fn);
  else if (phase === 'held') queued.push(fn);
}

/** For a write that can wait: true when it may go ahead (now or once a hold ends), false once clearing has begun. */
export function mayWrite(): Promise<boolean> {
  if (phase !== 'held') return Promise.resolve(phase === 'open');
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

/**
 * This page read or wrote the save (raw, begun at the time its created field gives), so the save being gone later, or
 * one begun after it in its place, means this game's data was cleared.
 */
export function sawStored(raw: string, begun: number | null) {
  sawSave = true;
  seenRaw = raw;
  seenBegun = begun;
  seenAt = Date.now();
}

/** When a stored save (parsed) was begun, as its own created field says (null when it doesn't say). */
export function begunOf(o: unknown): number | null {
  const c = o && typeof o === 'object' ? (o as { created?: unknown }).created : null;
  return typeof c === 'number' && Number.isFinite(c) ? c : null;
}

/**
 * True when a stored save begun at `begun` is not the one this page read: a game begun after this page last read or
 * wrote its save, so after a clear this page missed. Copies of one save only ever lower its start (to the earliest
 * they fold in), so whatever start a copy writes, even one that hasn't yet folded in a start another copy just lowered
 * (by a Restore, say), the save already had before this page saw it. This page stops writing (folding its old
 * progress in would undo the clear) and reloads into the new save.
 */
export function replacedBy(begun: number | null) {
  if (seenBegun === null || begun === null || begun <= seenBegun || begun <= seenAt) return false;
  if (phase !== 'cleared') {
    stop();
    location.reload();
  }
  return true;
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

function end(s: ClearStatus) {
  if (phase === 'cleared') return;
  stop();
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
    else if (m.type === 'clear') end('elsewhere');
    else if (m.type === 'status' && phase === 'cleared' && status.startsWith('elsewhere')) {
      status = m.status === 'done' ? 'elsewhere-done' : m.status === 'failed' ? 'elsewhere-failed' : 'elsewhere';
      watchers.forEach((f) => f());
    }
  };

if (browser) {
  const check = () => {
    if (phase === 'cleared' || !sawSave) return;
    try {
      const cur = localStorage.getItem(SAVE_KEY);
      if (cur === null) goneElsewhere();
      else if (cur !== seenRaw) replacedBy(begunOf(JSON.parse(cur)));
    } catch {
      /* storage (or the save in it) can't be read: the next write finds out */
    }
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
