/**
 * Clearing this game's data from this device, once a Save Crystal holds it (Settings > Your data). Only the names in
 * core/stored-names go, the real save's and the lab's: the game's localStorage keys and the copies kept beside them,
 * its two databases each, the offline worker's caches and the worker registered for this app's own scope. Nothing
 * else the site or browser holds is touched. Every open copy stops writing first (core/cleared), so nothing comes back.
 */
import { APP_KEY, AUDIO_KEY, BESIDE, CARE_KEY, COWRITER_KEY, INSTALL_HINT_KEY, LAB_SAVE_KEY, SAVE_KEY, SW_CACHE, TAB_KEY, YOU_KEY } from '../core/stored-names';
import { setClearStatus } from '../core/cleared';
import { siteUrl } from '../core/base';

const SAVES = [SAVE_KEY, LAB_SAVE_KEY];
const KEYS = [APP_KEY, YOU_KEY, AUDIO_KEY, COWRITER_KEY, INSTALL_HINT_KEY];
const DATABASES = SAVES.flatMap((s) => [`${s}${BESIDE.art}`, `${s}${BESIDE.story}`]);
const SESSION = [TAB_KEY, CARE_KEY];

/** A localStorage key this game wrote: its own keys, each save, and what is kept beside a save under its name. */
function gameKey(k: string) {
  if (KEYS.includes(k) || SAVES.includes(k)) return true;
  return SAVES.some((s) => k === `${s}${BESIDE.stealth}` || k === `${s}${BESIDE.safeLight}` || k === `${s}${BESIDE.readSize}` || k === `${s}${BESIDE.momentLength}` || k.startsWith(`${s}${BESIDE.unreadable}.`) || k.startsWith(`${s}${BESIDE.storyLive}.`));
}
const gameCache = (n: string) => n.startsWith(SW_CACHE.prefix) || n === SW_CACHE.meta;

function storedKeys(area: Storage) {
  const out: string[] = [];
  for (let i = 0; i < area.length; i++) {
    const k = area.key(i);
    if (k !== null) out.push(k);
  }
  return out;
}

function dropKeys() {
  // the save first: a copy of the app that missed every message sees it go and stops (core/cleared)
  for (const k of storedKeys(localStorage).filter(gameKey).sort((a, b) => Number(b === SAVE_KEY) - Number(a === SAVE_KEY))) localStorage.removeItem(k);
  for (const k of SESSION) sessionStorage.removeItem(k);
}

/** Resolves once the database is gone (true) or deleting it failed (false); waiting() runs while an open copy holds it. */
function dropDatabase(name: string, waiting: () => void) {
  return new Promise<boolean>((done) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => done(true);
    r.onerror = () => done(false);
    r.onblocked = waiting;
  });
}

/** Resolves when the worker has stopped for good (an install under way can still write its cache until then). */
function stopped(w: ServiceWorker | null) {
  return new Promise<void>((done) => {
    if (!w || w.state === 'redundant') return done();
    const timer = setTimeout(done, 10000);
    w.addEventListener('statechange', () => {
      if (w.state !== 'redundant') return;
      clearTimeout(timer);
      done();
    });
  });
}

/** The offline workers registered for this app's own scope and script; workers of other apps on the site stay. */
async function ourWorkers() {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!sw) return [];
  const scope = siteUrl(''), script = siteUrl('sw.js');
  return (await sw.getRegistrations()).filter((r) => r.scope === scope && [r.installing, r.waiting, r.active].some((w) => w?.scriptURL === script));
}

async function dropWorker() {
  // a registration under way finishes first, so it can't land after this. The module that registers loads lazily (see
  // app.ts), as here: none is under way if it never loaded
  await import('../pwa/register').then((m) => m.registration(), () => undefined);
  for (const r of await ourWorkers()) {
    const busy = [r.installing, r.waiting];
    if (!(await r.unregister())) return false;
    await Promise.all(busy.map(stopped));
  }
  return true;
}

async function dropCaches() {
  if (typeof caches === 'undefined') return true;
  await Promise.all((await caches.keys()).filter(gameCache).map((n) => caches.delete(n)));
  return true;
}

/** What of this game is still on this device; empty when clearing finished. */
export async function leftOnDevice(): Promise<string[]> {
  const left = [...storedKeys(localStorage).filter(gameKey), ...storedKeys(sessionStorage).filter((k) => SESSION.includes(k))];
  if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function')
    for (const { name } of await indexedDB.databases()) if (name && DATABASES.includes(name)) left.push(name);
  if (typeof caches !== 'undefined') left.push(...(await caches.keys()).filter(gameCache));
  for (const r of await ourWorkers()) left.push(`worker ${r.scope}`);
  return left;
}

/**
 * Clears this game's data from this device and reports how it went through the clear status: done only when every
 * part is gone. Runs once every open copy has stopped writing; safe to run again after a failure.
 */
export async function clearGame(): Promise<boolean> {
  setClearStatus('clearing');
  let ok = true;
  try {
    dropKeys();
  } catch {
    ok = false;
  }
  if (typeof indexedDB !== 'undefined') {
    let blocked = false;
    const results = await Promise.all(
      DATABASES.map((name) =>
        dropDatabase(name, () => {
          if (blocked) return;
          blocked = true;
          setClearStatus('waiting');
        }).catch(() => false),
      ),
    );
    ok &&= results.every(Boolean);
    if (blocked) setClearStatus('clearing');
  }
  ok = (await dropWorker().catch(() => false)) && ok;
  ok = (await dropCaches().catch(() => false)) && ok;
  ok &&= !(await leftOnDevice().catch(() => ['unreadable'])).length;
  setClearStatus(ok ? 'done' : 'failed');
  return ok;
}
