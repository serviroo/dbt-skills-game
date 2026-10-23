/* The Lantern: offline service worker. scripts/sw-build.mjs prepends VERSION and ASSETS at build time. */
/* global VERSION, ASSETS */

const PREFIX = 'dbt.precache.';
const CACHE = PREFIX + VERSION;
const META = 'dbt.precache-meta';
const SCOPE = self.registration.scope;
const SHELL = new URL('./', SCOPE).href;
const abs = (path) => new URL(path, SCOPE).href;

// Files that must never come back as the HTML fallback a static host serves for a missing path.
const NOT_HTML = /\.(m?js|css|woff2?|png|webmanifest|json|svg|wasm)$/i;

async function fetchClean(url) {
  const res = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
  if (!res.ok) throw new Error(`precache ${url}: HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (NOT_HTML.test(new URL(url).pathname) && type.includes('text/html')) throw new Error(`precache ${url}: got HTML`);
  // A redirected response (pretty-URL hosts send /index.html -> /) can't answer a navigation; rebuild it.
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const urls = [SHELL, ...ASSETS.map(abs)];
      // Fetch everything first and only then write, so a half-uploaded deploy never replaces a working cache.
      const responses = await Promise.all(urls.map(fetchClean));
      try {
        const cache = await caches.open(CACHE);
        await Promise.all(responses.map((res, i) => cache.put(urls[i], res)));
      } catch (err) {
        await caches.delete(CACHE);
        throw err;
      }
      // Take over in the background; the page the player has open keeps running and the new version shows on the next launch.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep this version and the one before it: a page that is still open may lazy-load its own older chunks.
      const meta = await caches.open(META);
      const prev = await meta.match('current').then((r) => (r ? r.text() : ''));
      const keep = new Set([CACHE]);
      if (prev && prev !== CACHE) keep.add(prev);
      await meta.put('current', new Response(CACHE));
      await meta.put('previous', new Response(prev && prev !== CACHE ? prev : ''));
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(PREFIX) && !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function fromCache(request) {
  const own = await caches.open(CACHE);
  return (await own.match(request, { ignoreVary: true })) || (await caches.match(request, { ignoreVary: true }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !req.url.startsWith(SCOPE)) return;
  if (url.pathname.slice(new URL(SCOPE).pathname.length - 1).includes('/api/')) return;

  if (req.mode === 'navigate') {
    const path = url.pathname.slice(new URL(SCOPE).pathname.length);
    const isShell = path === '' || path === 'index.html';
    event.respondWith(
      (async () => {
        if (!isShell) {
          const hit = await fromCache(url.href);
          if (hit) return hit;
        }
        const shell = await fromCache(SHELL);
        if (shell) return shell;
        return fetch(req);
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const hit = await fromCache(req);
      if (hit) return hit;
      return fetch(req);
    })(),
  );
});
