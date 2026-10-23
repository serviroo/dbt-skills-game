/* The Lantern: offline service worker. scripts/sw-build.mjs prepends VERSION and ASSETS at build time. */
/* global VERSION, ASSETS */

const PREFIX = 'dbt.precache.';
const CACHE = PREFIX + VERSION;
const META = 'dbt.precache-meta';
const SCOPE = self.registration.scope;
const SHELL = new URL('./', SCOPE).href;
const abs = (path) => new URL(path, SCOPE).href;

const KEEP = 3;

const TYPES = [
  [/\.m?js$/i, /^(?:(?:application|text)\/(?:x-)?(?:ecma|java)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/i],
  [/\.css$/i, /^text\/css$/i],
  [/\.html?$/i, /^text\/html$/i],
];
function typeProblem(url, type) {
  const path = new URL(url).pathname;
  const essence = type.split(';', 1)[0].replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  const want = url === SHELL ? /^text\/html$/i : TYPES.find(([ext]) => ext.test(path))?.[1];
  if (want) return want.test(essence) ? '' : `got ${type || 'no content type'}`;
  return /^text\/html$/i.test(essence) ? 'got HTML' : '';
}

async function fetchClean(url) {
  const res = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
  if (!res.ok) throw new Error(`precache ${url}: HTTP ${res.status}`);
  const problem = typeProblem(url, res.headers.get('content-type') || '');
  if (problem) throw new Error(`precache ${url}: ${problem}`);
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
      const meta = await caches.open(META);
      const read = (key) => meta.match(key).then((r) => (r ? r.text() : ''));
      const names = await caches.keys();
      let order = [];
      try {
        order = JSON.parse((await read('versions')) || '[]');
      } catch {}
      if (!Array.isArray(order) || !order.length) order = [await read('current'), await read('previous')];
      const keep = [CACHE, ...order.filter((n) => n !== CACHE && names.includes(n))].slice(0, KEEP);
      await meta.put('versions', new Response(JSON.stringify(keep)));
      await meta.put('current', new Response(CACHE));
      await meta.put('previous', new Response(keep[1] ?? ''));
      await Promise.all(names.filter((n) => n.startsWith(PREFIX) && !keep.includes(n)).map((n) => caches.delete(n)));
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
