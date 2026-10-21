import { params } from '../core/params';

const UPDATE_CHECK_MS = 60 * 60 * 1000;
const listeners = new Set<() => void>();
let updateReady = false;

/**
 * Installs the offline service worker (built app only; skipped in dev, ?lab and ?capture).
 * A new version installs quietly in the background and shows on the next launch; nothing asks them to update.
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
    sw.register('./sw.js', { scope: './', updateViaCache: 'none' })
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

/** Asks the browser to keep their saved progress through storage pressure. Never prompts; resolves false when unsupported. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    // desktop Firefox turns this into a permission prompt; the player should never be asked for it
    const ua = navigator.userAgent;
    if (/Firefox\/\d/.test(ua) && !/FxiOS/.test(ua)) return false;
    return await storage.persist();
  } catch {
    return false;
  }
}
