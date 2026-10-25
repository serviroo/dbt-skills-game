import { siteUrl } from '../core/base';
import { params } from '../core/params';

const UPDATE_CHECK_MS = 60 * 60 * 1000;
const listeners = new Set<() => void>();
let updateReady = false;

/**
 * Installs the offline service worker (built app only; skipped in dev, ?lab and ?capture).
 * A new version installs quietly in the background and shows on the next launch.
 */
export function registerSW(): void {
  if (import.meta.env.DEV || params.lab || params.capture) return;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const sw = navigator.serviceWorker;
  let controlled = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    // the first install claiming this page is not an update
    if (controlled) {
      updateReady = true;
      listeners.forEach((cb) => cb());
    }
    controlled = true;
  });
  const start = () => {
    sw.register(siteUrl('sw.js'), { scope: siteUrl(''), updateViaCache: 'none' })
      .then((reg) => {
        // iOS resumes Home Screen apps instead of relaunching them, so also look for updates when the player comes back
        let last = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || Date.now() - last < UPDATE_CHECK_MS) return;
          last = Date.now();
          reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/**
 * Optional: called once a newer version has taken over in the background while this page stays open.
 * The page keeps working as it is; the director may reload at a calm moment (never mid-scene). Returns an unsubscribe.
 */
export function onUpdateReady(cb: () => void): () => void {
  listeners.add(cb);
  if (updateReady) queueMicrotask(cb);
  return () => listeners.delete(cb);
}

/** Asks the browser to keep their saved progress through storage pressure, unless a request is already out. Never prompts. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist) return;
    const before = requests;
    if (await storage.persisted?.()) return;
    // desktop Firefox turns this into a permission prompt; the player should never be asked for it
    const ua = navigator.userAgent;
    if (/Firefox\/\d/.test(ua) && !/FxiOS/.test(ua)) return;
    if (requests === before) askToKeep();
  } catch {}
}

export type KeepStatus = 'granted' | 'not-granted' | 'refused' | 'unsupported' | 'failed';

const KEEP_CHECK_MS = 6000;
let asking: Promise<KeepStatus> | null = null;
let requests = 0;
const watchers = new Set<(job: Promise<KeepStatus>) => void>();

export async function readKeepStatus(): Promise<KeepStatus> {
  let timer = 0;
  try {
    const storage = navigator.storage;
    if (typeof storage?.persisted !== 'function') return 'unsupported';
    const late = new Promise<'late'>((res) => (timer = window.setTimeout(res, KEEP_CHECK_MS, 'late')));
    const r = await Promise.race([storage.persisted(), late]);
    return r === true ? 'granted' : r === false ? 'not-granted' : 'failed';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

async function answer(reply: Promise<boolean | undefined>): Promise<KeepStatus> {
  const said = await reply;
  const now = await readKeepStatus();
  if (now === 'granted') return now;
  if (said === false) return 'refused';
  if (now === 'not-granted') return now;
  return said === true ? 'granted' : 'failed';
}

export const canAskToKeep = (): boolean => typeof navigator.storage?.persist === 'function';

export const keepRequest = (): Promise<KeepStatus> | null => asking;

export function onKeepRequest(cb: (job: Promise<KeepStatus>) => void): () => void {
  watchers.add(cb);
  return () => watchers.delete(cb);
}

export function askToKeep(): void {
  if (asking) return;
  requests++;
  const reply = (async () => {
    try {
      return await navigator.storage.persist();
    } catch {
      return undefined;
    }
  })();
  const job = (asking = answer(reply));
  void job.finally(() => asking === job && (asking = null));
  watchers.forEach((cb) => cb(job));
}
