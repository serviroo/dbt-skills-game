// Back up, then clear this game's data: Settings makes a Save Crystal first, then asks once. Clearing takes every key,
// database, offline cache and worker of this game and nothing of anything else on the site; no open copy brings any of
// it back; and the Save Crystal restores it all on a fresh device. Runs on a real production build with the offline
// worker allowed, served under its own path next to an unrelated app.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crystal as newerCrystal, restore as newerRestore } from './newer-save-safety.e2e.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = '/game/';
const SAVE = 'dbt.lantern.v1';
const LAB = 'dbt.lantern.lab';
const NOISE = /WebGL|GPU stall|AudioContext|Failed to load resource/i;
const SIZES = [
  ['phone', { width: 390, height: 844 }],
  ['small', { width: 320, height: 568 }],
  ['landscape', { width: 844, height: 390 }],
  ['desktop', { width: 1280, height: 800 }],
];
const START = 'Back up, then clear';
const CONFIRM = /^Clear this game.s data$/;
const KEEP = 'Keep everything';
const FRESH = 'Make a fresh Save Crystal';
const DONE = 'All clear';
/** What an unrelated app on the same site keeps; all of it must survive. Two names look like the game's on purpose. */
const NEIGHBOURS = {
  ls: ['dbt.lantern.v1-other', 'dbt.lantern.v1.notes', 'other.app.key'],
  ss: ['other.session'],
  idb: ['dbt.lantern.v1.artx', 'other-db'],
  caches: ['dbt.precache-other', 'other-cache'],
  workers: ['/other/'],
};

let scratch;
function scratchDir() {
  if (!scratch) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-e2e-clear-'));
    process.once('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
  }
  return scratch;
}

function build(shared) {
  return (shared.clearBuild ??= new Promise((resolve, reject) => {
    const dir = path.join(scratchDir(), 'dist');
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'warn'], {
      cwd: root,
      env: { ...process.env, BASE_PATH: BASE },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('exit', (code) => (code === 0 ? resolve(dir) : reject(new Error('production build failed:\n' + log.slice(-2000)))));
  }));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const OTHER_PAGE = '<!doctype html><meta charset="utf-8"><title>Another app</title><p>Another app on the same site.</p>';
const OTHER_SW = "self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));";

/** The build under BASE, plus a small unrelated app under /other/ with a worker of its own. */
async function host(dir) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/other/' || p === '/other/index.html') return res.writeHead(200, { 'content-type': MIME['.html'] }).end(OTHER_PAGE);
    if (p === '/other/sw.js') return res.writeHead(200, { 'content-type': MIME['.js'] }).end(OTHER_SW);
    if (!p.startsWith(BASE) || p.includes('\0')) return res.writeHead(404).end();
    const base = path.resolve(dir);
    let f = path.resolve(base, p.slice(BASE.length));
    if (f !== base && !f.startsWith(base + path.sep)) return res.writeHead(403).end();
    if (p.endsWith('/')) f = path.join(f, 'index.html');
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) f = path.join(base, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((ok) => (server.closeAllConnections(), server.close(ok))),
  };
}

const today = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const stroke = (x) => [{ i: 1, w: 3, p: [x, 20, x + 60, 80, x + 90, 40] }];

/** A player well into the game: progress, names, choices, lists, diary, a map, drawings, an unfinished one, stories. */
function seedData() {
  const day = today();
  const t = Date.now() - 86400000;
  return {
    day,
    ls: {
      [SAVE]: JSON.stringify({
        v: 1,
        created: Date.UTC(2026, 2, 12, 12),
        events: [
          { id: 'seed-visit', k: 'visit', xp: 10, t: t - 3000, day: '2026-10-01' },
          { id: 'seed-wise', k: 'skill', skill: 'wise-mind', stat: 'sense', xp: 20, t: t - 2000, day: '2026-10-01', data: { answer: 'Yes' } },
          { id: 'seed-card', k: 'card', skill: 'stop', xp: 5, t: t - 1000, day: '2026-10-02' },
        ],
        diary: { '2026-10-01': { day: '2026-10-01', emotions: { Calm: 3 }, urges: { Rest: 2 }, note: 'A seed diary day.', updatedAt: t } },
        lists: {
          comfort: [{ id: 'seed-comfort', text: 'Warm tea', at: t }],
          activities: [{ id: 'seed-walk', text: 'A short walk', at: t }],
          reasons: [{ id: 'seed-reason', text: 'My cat', at: t }],
          people: [{ id: 'seed-person', name: 'Sam', phone: '555 0100', at: t }],
        },
        maps: [{ id: 'seed-map', t, urge: 'Hide', p1: 'Quiet', c1: 'Lonely', p2: 'Seen', c2: 'Scary', choice: 'Text Sam', at: t }],
        settings: { sound: true, motion: 'reduce', emotionRows: ['Calm', 'Worried'], urgeRows: ['Rest'] },
        flags: { greetDay: day, therapistLineShown: true },
        profile: { playerName: 'Robin', companion: 'Pip', theme: 'night', accent: 'violet', region: 'uk', setAt: { playerName: t, companion: t, theme: t, accent: t, region: t } },
        setAt: { motion: t },
      }),
      'dbt.you.v1': JSON.stringify({ name: 'Robin', companion: 'Pip', nameAt: t, companionAt: t }),
      'dbt.app.v1': JSON.stringify({ seenCutscene: true }),
      'dbt.audio.v1': JSON.stringify({ v: 1, master: 0.6, music: 0.4, sfx: 0.8, muted: false }),
      [`${SAVE}.stealth`]: JSON.stringify({ aquarium: true, words: true }),
      [`${SAVE}.safe-light`]: 'dim',
      'dbt.install-hint.v1': 'dismissed',
      'dbt.cowriter.v1': JSON.stringify({ install: 'seed-install-id', key: 'seed-connection-secret' }),
      [`${SAVE}.skill-draft.seedload.clear-sight.`]: JSON.stringify({ skill: 'clear-sight', part: '', at: 3, answers: { fact: 'Seed skill words' }, typed: {}, leads: {}, done: [1, 2] }),
      [`${SAVE}.story.live.seedload.seed-page`]: JSON.stringify({ chapter: 'seed-page', text: 'Seed page words, and the unsaved ones.', bases: ['r1'], t: t + 5000 }),
      [LAB]: JSON.stringify({ v: 1, created: t, events: [{ id: 'lab-visit', k: 'visit', xp: 10, t, day: '2026-10-01' }] }),
      [`${LAB}.stealth`]: JSON.stringify({ aquarium: false, words: true }),
      [`${LAB}.safe-light`]: 'up',
      'dbt.lantern.v1-other': 'not the game',
      'dbt.lantern.v1.notes': 'not the game either',
      'other.app.key': 'stay',
    },
    art: {
      meta: [['seed-art', { id: 'seed-art', kind: 'today', day: '2026-10-01', t, updated: t, prompt: 'A small light', n: 1, rev: 'r1' }]],
      strokes: [['seed-art', stroke(20)]],
      drafts: [['today:seedtab', { key: 'today:seedtab', kind: 'today', prompt: 'Something blue', strokes: stroke(120), t: t + 100 }]],
    },
    story: {
      stories: [{ id: 'seed-story', title: 'Seed story', created: t, updated: t, rev: 'r1', chapters: ['seed-page'], notes: 'seed-notes' }],
      chapters: [
        { id: 'seed-page', story: 'seed-story', kind: 'page', title: 'Shore', text: 'Seed page words.', updated: t, rev: 'r1' },
        { id: 'seed-notes', story: 'seed-story', kind: 'notes', title: 'Notes', text: 'Seed notes.', updated: t, rev: 'r1' },
      ],
      cards: [['seed-page', [{ id: 'seed-k1', mode: 'continue', text: 'A seed card.', t }]]],
      days: [['2026-10-01', t]],
    },
  };
}

/** Everything on the site this test can see: storage keys and values, databases, caches and workers. */
const device = (page) =>
  page.evaluate(async () => {
    // read as properties, not through getItem, which a scenario may block for the game's save
    const all = (s) => Object.fromEntries(Object.keys(s).sort().map((k) => [k, s[k]]));
    const req = (r) => new Promise((ok, bad) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => bad(r.error))));
    const idb = {};
    for (const { name } of (await indexedDB.databases()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const db = await req(indexedDB.open(name));
      idb[name] = {};
      for (const s of [...db.objectStoreNames].sort()) {
        const st = db.transaction(s, 'readonly').objectStore(s);
        idb[name][s] = JSON.stringify(await Promise.all([req(st.getAllKeys()), req(st.getAll())]), (k, v) => (v instanceof Blob ? `blob:${v.size}:${v.type}` : v));
      }
      db.close();
    }
    const cs = {};
    for (const n of (await caches.keys()).sort()) cs[n] = (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname).sort();
    const workers = (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort();
    return { ls: all(localStorage), ss: all(sessionStorage), idb, caches: cs, workers };
  });
const names = (d) => ({ ls: Object.keys(d.ls), ss: Object.keys(d.ss), idb: Object.keys(d.idb), caches: Object.keys(d.caches), workers: d.workers });

async function seed(page, origin, data) {
  await page.goto(origin + '/other/');
  await page.evaluate(async ({ data, SAVE, LAB }) => {
    for (const [k, v] of Object.entries(data.ls)) localStorage.setItem(k, v);
    sessionStorage.setItem('other.session', 'stay');
    const req = (r) => new Promise((ok, bad) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => bad(r.error))));
    const make = (name, version, upgrade) => {
      const r = indexedDB.open(name, version);
      r.onupgradeneeded = () => upgrade(r.result);
      return req(r);
    };
    const artStores = (db) => ['meta', 'strokes', 'thumbs', 'drafts'].forEach((s) => db.createObjectStore(s));
    const storyStores = (db) => {
      db.createObjectStore('stories', { keyPath: 'id' });
      db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('story', 'story');
      db.createObjectStore('cards');
      db.createObjectStore('days');
    };
    const art = await make(`${SAVE}.art`, 1, artStores);
    const at = art.transaction(['meta', 'strokes', 'drafts'], 'readwrite');
    for (const [s, rows] of Object.entries(data.art)) for (const [k, v] of rows) at.objectStore(s).put(v, k);
    await new Promise((ok) => (at.oncomplete = ok));
    art.close();
    const story = await make(`${SAVE}.story`, 1, storyStores);
    const tt = story.transaction(['stories', 'chapters', 'cards', 'days'], 'readwrite');
    for (const s of data.story.stories) tt.objectStore('stories').put(s);
    for (const c of data.story.chapters) tt.objectStore('chapters').put(c);
    for (const [k, v] of data.story.cards) tt.objectStore('cards').put(v, k);
    for (const [k, v] of data.story.days) tt.objectStore('days').put(v, k);
    await new Promise((ok) => (tt.oncomplete = ok));
    story.close();
    (await make(`${LAB}.art`, 1, artStores)).close();
    (await make(`${LAB}.story`, 1, storyStores)).close();
    const other = await make('other-db', 1, (db) => db.createObjectStore('kv'));
    const ot = other.transaction('kv', 'readwrite');
    ot.objectStore('kv').put('stay', 'k');
    await new Promise((ok) => (ot.oncomplete = ok));
    other.close();
    (await make('dbt.lantern.v1.artx', 1, (db) => db.createObjectStore('kv'))).close();
    await (await caches.open('other-cache')).put('/other/x', new Response('stay'));
    await (await caches.open('dbt.precache-other')).put('/other/y', new Response('stay'));
    const reg = await navigator.serviceWorker.register('/other/sw.js', { scope: '/other/' });
    const w = reg.installing || reg.waiting || reg.active;
    if (w.state !== 'activated') await new Promise((ok) => w.addEventListener('statechange', () => w.state === 'activated' && ok()));
  }, { data, SAVE, LAB });
}

async function context(h, viewport = SIZES[0][1]) {
  const ctx = await h.browser.newContext({ viewport, deviceScaleFactor: viewport.width > 900 ? 1 : 2, serviceWorkers: 'allow', acceptDownloads: true });
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !NOISE.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
    page.on('dialog', (d) => (errors.push('dialog: ' + d.message()), void d.dismiss()));
  };
  ctx.on('page', watch);
  return { ctx, errors };
}

/** The app in this tab, with its offline worker installed and its files cached. */
async function openGame(page, origin) {
  await page.goto(origin + BASE + '?mute');
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && !!window.__daily, null, { timeout: 60000 });
  await page.evaluate(() =>
    Promise.race([
      (async () => {
        const w = (await navigator.serviceWorker.ready).active;
        if (w.state !== 'activated') await new Promise((ok) => w.addEventListener('statechange', () => w.state === 'activated' && ok()));
      })(),
      new Promise((_, bad) => setTimeout(() => bad(new Error('the offline worker never took over')), 60000)),
    ]),
  );
}
const settings = async (page) => {
  await page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
  await page.locator('#set-playerName').waitFor();
  await page.locator('.dq-clear').scrollIntoViewIfNeeded();
};
const statusText = (page) => page.locator('.dq-settings .dq-hint[aria-live]').first().textContent();
const asking = (page) => page.locator('.dq-clear.is-asking');

/** Taps Back up, then clear and returns the Save Crystal it downloads. */
async function backUp(h, page, name) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: START }).click()]);
  const file = path.join(h.out, `${name}.json`);
  await dl.saveAs(file);
  await asking(page).waitFor({ timeout: 10000 });
  return { file, raw: JSON.parse(fs.readFileSync(file, 'utf8')), text: fs.readFileSync(file, 'utf8'), name: dl.suggestedFilename() };
}
const unchanged = (h, before, after, how) => {
  const a = JSON.stringify(before), b = JSON.stringify(after);
  if (a === b) return;
  const diff = [];
  for (const area of ['ls', 'ss', 'idb', 'caches'])
    for (const k of new Set([...Object.keys(before[area]), ...Object.keys(after[area])])) if (JSON.stringify(before[area][k]) !== JSON.stringify(after[area][k])) diff.push(`${area}:${k}`);
  if (JSON.stringify(before.workers) !== JSON.stringify(after.workers)) diff.push('workers');
  throw new Error(`${how} changed this device: ${diff.join(', ')}`);
};
/** Only the unrelated app's things are left: none of the game's, all of the neighbour's, values untouched. */
const onlyNeighbours = (h, d, how, ss = NEIGHBOURS.ss) => {
  const got = names(d);
  h.expect(JSON.stringify(got) === JSON.stringify({ ...NEIGHBOURS, ss }), `${how}: left on the device ${JSON.stringify(got)}, want ${JSON.stringify({ ...NEIGHBOURS, ss })}`);
  h.expect(d.ls['other.app.key'] === 'stay' && d.idb['other-db'].kv === JSON.stringify([['k'], ['stay']]) && d.caches['other-cache'][0] === '/other/x', `${how}: a neighbour's value changed`);
};
/** Scrolls as the app does (under the pinned top bar) and lets the page paint. */
const into = (page, sel) => page.evaluate((s) => new Promise((ok) => (document.querySelector(s).scrollIntoView({ block: 'start' }), requestAnimationFrame(() => requestAnimationFrame(ok)))), sel);
const fits = async (h, page, what) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  h.expect(over <= 0, `${what} overflows sideways by ${over}px`);
};
const safeZoneOneTap = async (h, page, how) => {
  await page.locator('.dq-top .dq-safe').click();
  await page.getByText('Talk to someone now').first().waitFor({ timeout: 10000 });
  h.expect((await page.evaluate(() => window.__daily.route.name)) === 'safe', `${how}: the Safe Zone did not open in one tap`);
  await page.locator('.dq-top .dq-back').click();
  h.expect(!(await page.locator('.lw, .dq-sw, [role=alertdialog]').count()), `${how}: leaving the Safe Zone asked something`);
};
const finished = (page, title = DONE) => page.locator('.dq-cleared-h', { hasText: title }).waitFor({ timeout: 30000 });
/** Live lines inside something marked busy: a screen reader may hold them back until it isn't. */
const busyLive = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[aria-live]')].filter((n) => n.closest('[aria-busy="true"]')).map((n) => n.textContent.trim().slice(0, 60)));
/** Text under sel (button labels aside) set smaller than 16px, the least body text may be on a phone. */
const smallText = (page, sel) =>
  page.evaluate((sel) => {
    const out = [];
    for (const root of document.querySelectorAll(sel))
      for (const n of [root, ...root.querySelectorAll('*')]) {
        if (n.closest('button') || n.closest('.is-hidden') || !n.getClientRects().length) continue;
        const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        const px = parseFloat(getComputedStyle(n).fontSize);
        if (own && px < 16) out.push(`${px}px: ${n.textContent.trim().slice(0, 50)}`);
      }
    return out;
  }, sel);
const onStart = (page) => page.evaluate(() => document.activeElement?.textContent === 'Back up, then clear');

/** Every drawing, unfinished drawing, story page and card in a Save Crystal, as the player would recognise them. */
const content = (raw) => ({
  events: raw.events.map((e) => e.id).filter((id) => /^(seed|lab)-/.test(id)).sort(),
  diary: Object.entries(raw.diary).map(([d, e]) => `${d}:${e.note}:${JSON.stringify(e.emotions)}:${JSON.stringify(e.urges)}`).sort(),
  lists: Object.fromEntries(Object.entries(raw.lists).map(([k, xs]) => [k, xs.map((x) => x.text ?? `${x.name} ${x.phone}`).sort()])),
  maps: raw.maps.map((m) => [m.urge, m.p1, m.c1, m.p2, m.c2, m.choice].join('|')),
  names: [raw.profile.playerName, raw.profile.companion],
  profile: [raw.profile.theme, raw.profile.accent, raw.profile.region],
  motion: raw.settings.motion,
  rows: [...raw.settings.emotionRows, ...raw.settings.urgeRows],
  art: raw.art.map((a) => `${a.id}:${a.kind}:${a.day}:${a.prompt}:${JSON.stringify(a.strokes)}`).sort(),
  drafts: (raw.drafts ?? []).map((d) => `${d.kind}:${d.prompt}:${JSON.stringify(d.strokes)}`).sort(),
  skillDrafts: raw.skillDrafts ?? [],
  stories: raw.stories.stories.filter((s) => !s.removed).map((s) => s.title).sort(),
  chapters: raw.stories.chapters.map((c) => `${c.kind}:${c.title}:${c.text}`).sort(),
  cards: Object.values(raw.stories.cards).flat().map((c) => `${c.mode}:${c.text}`).sort(),
  preferences: raw.preferences,
});

export const scenarios = {
  /** the whole path: backup, every way of saying no, a change in another tab, one confirmation, a clean device, a restore */
  async 'clear-back-up-then-clear'(h) {
    const srv = await host(await build(h.shared));
    const { ctx, errors } = await context(h);
    try {
      const data = seedData();
      const page = await ctx.newPage();
      await seed(page, srv.origin, data);
      await openGame(page, srv.origin);
      await settings(page);
      const before = await device(page);
      h.expect(names(before).idb.includes(`${SAVE}.art`) && names(before).idb.includes(`${LAB}.story`) && names(before).caches.some((n) => n.startsWith('dbt.precache.')), 'the game was not fully on the device before clearing: ' + JSON.stringify(names(before)));

      // the backup holds everything the clear would take, and no raw storage or connection secret
      const first = await backUp(h, page, 'crystal-first');
      h.expect(/^save-crystal-\d{4}-\d{2}-\d{2}\.json$/.test(first.name), 'odd Save Crystal file name ' + first.name);
      const c1 = content(first.raw);
      h.expect(JSON.stringify(c1.events) === JSON.stringify(['seed-card', 'seed-visit', 'seed-wise']), 'backup events ' + JSON.stringify(c1.events));
      h.expect(c1.names.join() === 'Robin,Pip' && c1.lists.people[0] === 'Sam 555 0100' && c1.maps.length === 1 && c1.diary.length === 1, 'backup progress, names or lists missing: ' + JSON.stringify(c1));
      h.expect(c1.art.length === 1 && c1.drafts.length === 1 && /Something blue/.test(c1.drafts[0]), 'backup drawings or the unfinished drawing missing: ' + JSON.stringify([c1.art, c1.drafts]));
      h.expect(c1.chapters.includes('page:Shore:Seed page words, and the unsaved ones.') && c1.cards.includes('continue:A seed card.'), 'backup story words (latest) or cards missing: ' + JSON.stringify([c1.chapters, c1.cards]));
      h.expect(c1.preferences?.audio?.master === 0.6 && c1.preferences?.room?.aquarium === true && c1.preferences?.safeLight === 'dim', 'backup choices missing: ' + JSON.stringify(c1.preferences));
      h.expect(c1.skillDrafts.some((d) => d.skill === 'clear-sight' && d.answers.fact === 'Seed skill words'), 'the backup lost the unfinished skill\'s words');
      h.expect(!/seed-connection-secret|seed-install-id|dbt\.cowriter|dbt\.install-hint|\.unreadable|story\.live|skill-draft/.test(first.text) && first.raw.incomplete === false, 'the backup carries raw storage or a connection secret, or says it is incomplete');
      h.expect(await page.evaluate(() => document.activeElement?.id === 'dq-clear-h'), 'the confirmation heading did not take focus');
      const ask = await asking(page).innerText();
      h.expect(ask.includes(first.name) && /check you can find that file/i.test(ask) && /progress, names, choices, lists, diary, drawings \(unfinished ones too\), stories and offline files/.test(ask), 'the confirmation does not name the file, ask to keep it, or say what goes: ' + ask);

      // every way of saying no changes nothing
      await page.keyboard.press('Escape');
      h.expect(!(await asking(page).count()) && /Nothing was cleared\./.test(await statusText(page)), 'Escape did not close the confirmation saying nothing was cleared');
      unchanged(h, before, await device(page), 'Escape on the confirmation');
      await backUp(h, page, 'crystal-again');
      await page.getByRole('button', { name: KEEP }).click();
      h.expect(!(await asking(page).count()) && /Nothing was cleared\./.test(await statusText(page)), 'Keep everything did not close the confirmation saying nothing was cleared');
      h.expect(await page.evaluate(() => document.activeElement?.textContent === 'Back up, then clear'), 'focus did not return to Back up, then clear');
      unchanged(h, before, await device(page), 'Keep everything');

      await page.evaluate(() => {
        window.__share = [navigator.share, navigator.canShare];
        navigator.canShare = () => true;
        navigator.share = () => Promise.reject(new DOMException('cancelled', 'AbortError'));
      });
      await page.getByRole('button', { name: START }).click();
      await page.waitForFunction(() => /No Save Crystal was saved, so nothing was cleared\./.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      h.expect(!(await asking(page).count()), 'a cancelled share still asked to clear');
      h.expect(await onStart(page), 'focus did not come back to Back up, then clear after a cancelled share: ' + (await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))));
      await page.evaluate(() => ([navigator.share, navigator.canShare] = window.__share));
      unchanged(h, before, await device(page), 'a cancelled share');

      await page.evaluate(() => {
        const getAll = IDBObjectStore.prototype.getAll;
        window.__getAll = getAll;
        IDBObjectStore.prototype.getAll = function (...a) {
          if (this.name === 'meta') throw new DOMException('unreadable', 'UnknownError');
          return getAll.apply(this, a);
        };
      });
      let downloaded = false;
      page.once('download', () => (downloaded = true));
      await page.getByRole('button', { name: START }).click();
      await page.waitForFunction(() => /couldn.t hold everything \(drawings\), so nothing was cleared/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      h.expect(!downloaded && !(await asking(page).count()), 'an incomplete backup was offered or went on to the confirmation');
      h.expect(await onStart(page), 'focus did not come back to Back up, then clear after an incomplete backup: ' + (await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))));
      await page.evaluate(() => (IDBObjectStore.prototype.getAll = window.__getAll));
      unchanged(h, before, await device(page), 'an incomplete backup');

      // the Safe Zone is never a place to clear, and leaving it asks nothing
      await backUp(h, page, 'crystal-safe');
      await safeZoneOneTap(h, page, 'from the confirmation');
      await settings(page);
      h.expect(!(await asking(page).count()), 'the confirmation came back after the Safe Zone');
      unchanged(h, before, await device(page), 'a Safe Zone round trip from the confirmation');

      // another tab changes something after the backup: the clear stops and asks for a fresh one
      await backUp(h, page, 'crystal-stale');
      const tab = await ctx.newPage();
      await openGame(tab, srv.origin);
      await tab.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today' }));
      const pad = tab.locator('[aria-label="Drawing page"]');
      await tab.waitForFunction(() => document.querySelector('[aria-label="Drawing page"]')?.inert === false);
      const box = await pad.boundingBox();
      const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
      await tab.mouse.move(...at(0.3, 0.3));
      await tab.mouse.down();
      await tab.mouse.move(...at(0.5, 0.5), { steps: 6 });
      await tab.mouse.up();
      // its unfinished drawing lands in the database (read there, not through the app)
      await tab.waitForFunction(
        async (name) => {
          const req = (r) => new Promise((ok, bad) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => bad(r.error))));
          const db = await req(indexedDB.open(name));
          const n = await req(db.transaction('drafts').objectStore('drafts').count());
          db.close();
          return n === 2;
        },
        `${SAVE}.art`,
        { timeout: 10000, polling: 100 },
      );
      await page.bringToFront();
      await page.getByRole('button', { name: CONFIRM }).click();
      await page.locator('.dq-clear-h', { hasText: 'Something changed' }).waitFor({ timeout: 15000 });
      h.expect(/Nothing was cleared\./.test(await asking(page).innerText()), 'the changed notice does not say nothing was cleared');
      await into(page, '#dq-clear-h');
      await h.shot(page, 'changed-phone');
      const changed = await device(page);
      h.expect(names(changed).idb.includes(`${SAVE}.art`) && changed.ls[SAVE] && Object.keys(changed.ls).includes('dbt.you.v1'), 'something was cleared although the backup was out of date');

      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: FRESH }).click()]);
      const second = path.join(h.out, 'crystal-fresh.json');
      await dl.saveAs(second);
      const raw2 = JSON.parse(fs.readFileSync(second, 'utf8'));
      h.expect(raw2.drafts.length === 2, 'the fresh Save Crystal does not hold the other tab\'s unfinished drawing: ' + raw2.drafts.length);
      await asking(page).waitFor();

      // the other tab is mid-stroke as the player confirms, so its draft save is still to come when clearing starts
      await tab.evaluate(() => (window.__marker = 'no reload'));
      await page.evaluate(() => (window.__marker = 'no reload'));
      await tab.mouse.move(...at(0.6, 0.3));
      await tab.mouse.down();
      await tab.mouse.move(...at(0.7, 0.5), { steps: 4 });
      await page.getByRole('button', { name: CONFIRM }).click();
      await tab.mouse.move(...at(0.8, 0.6), { steps: 4 });
      await tab.mouse.up();
      await finished(page);
      await tab.locator('.dq-cleared').waitFor({ timeout: 15000 });
      const done = await device(page);
      onlyNeighbours(h, done, 'after clearing');
      h.expect(await page.evaluate(() => window.__marker === 'no reload' && document.activeElement?.id === 'dq-cleared-h'), 'the page reloaded, or focus is not on the finished heading');
      await safeZoneOneTap(h, page, 'after clearing');
      await finished(page);
      onlyNeighbours(h, await device(page), 'after a Safe Zone visit');

      // the other tab: its pending save, a freeze and resume, focus, and closing it bring nothing back
      h.expect(await tab.evaluate(() => window.__marker === 'no reload'), 'the other tab reloaded');
      const cdp = await ctx.newCDPSession(tab);
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      await tab.bringToFront();
      await tab.evaluate(() => {
        window.__daily.store.save();
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await tab.locator('.dq-top .dq-safe').click();
      await tab.locator('.ca-sz-light').click({ timeout: 3000 });
      await tab.locator('.dq-top .dq-back').click();
      await tab.close({ runBeforeUnload: true });
      await page.bringToFront();
      onlyNeighbours(h, await device(page), 'after the other tab resumed, saved and closed', NEIGHBOURS.ss);

      // the Save Crystal brings it all back on a fresh device
      const { ctx: fresh, errors: freshErrors } = await context(h);
      try {
        const p2 = await fresh.newPage();
        await p2.goto(srv.origin + '/other/');
        await p2.evaluate(() => localStorage.setItem('dbt.app.v1', JSON.stringify({ seenCutscene: true })));
        await openGame(p2, srv.origin);
        await h.reachHub(p2);
        await settings(p2);
        await p2.locator('input[type=file]').setInputFiles(second);
        await p2.getByRole('button', { name: 'Restore this Save Crystal' }).click();
        await p2.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
        const [back] = await Promise.all([p2.waitForEvent('download', { timeout: 20000 }), p2.getByRole('button', { name: 'Save Crystal', exact: true }).click()]);
        const third = path.join(h.out, 'crystal-restored.json');
        await back.saveAs(third);
        const want = content(raw2), got = content(JSON.parse(fs.readFileSync(third, 'utf8')));
        // Restore adds the file's diary rows to the ones a new device starts with
        h.expect(want.rows.every((r) => got.rows.includes(r)), `restored diary rows ${JSON.stringify(got.rows)} miss some of ${JSON.stringify(want.rows)}`);
        for (const k of Object.keys(want).filter((k) => k !== 'rows')) h.expect(JSON.stringify(got[k]) === JSON.stringify(want[k]), `restored ${k}: ${JSON.stringify(got[k])} (want ${JSON.stringify(want[k])})`);
        h.expect(!freshErrors.length, freshErrors.join('\n'));
      } finally {
        await fresh.close();
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },

  /**
   * a copy that hears nothing of the clear (away as in the back/forward cache: no channel, no database open under it, no
   * events) comes back after a new game began in another tab: it reloads into the new save and never folds its old
   * progress or names into it
   */
  async 'clear-missed-then-new-game'(h) {
    const srv = await host(await build(h.shared));
    const { ctx, errors } = await context(h);
    try {
      const page = await ctx.newPage();
      await seed(page, srv.origin, seedData());
      const stale = await ctx.newPage();
      await stale.addInitScript(() => {
        if (!location.pathname.startsWith('/game/')) return;
        delete window.BroadcastChannel;
        Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
        // while away nothing reaches the page (a headless browser can't freeze one: CDP's frozen state is a no-op there)
        const away = (e) => window.__away && e.stopImmediatePropagation();
        for (const t of ['storage', 'focus', 'blur', 'pageshow', 'pagehide', 'visibilitychange', 'freeze', 'resume']) window.addEventListener(t, away, true);
      });
      await openGame(stale, srv.origin);
      await h.reachHub(stale);
      const seeded = await stale.evaluate(() => ((window.__marker = 'stale'), { created: window.__daily.store.state.created, events: window.__daily.store.state.events.map((e) => e.id) }));
      h.expect(seeded.events.includes('seed-card'), 'the stale copy did not read the seeded save: ' + JSON.stringify(seeded));
      await stale.evaluate(() => (window.__away = true));

      await page.bringToFront();
      await openGame(page, srv.origin);
      await settings(page);
      await backUp(h, page, 'crystal-missed');
      await page.getByRole('button', { name: CONFIRM }).click();
      await finished(page);
      onlyNeighbours(h, await device(page), 'after clearing with a copy that missed it');

      // a new game in another tab writes a fresh save
      const next = await ctx.newPage();
      await next.goto(srv.origin + '/other/');
      await next.evaluate(() => localStorage.setItem('dbt.app.v1', JSON.stringify({ seenCutscene: true })));
      await openGame(next, srv.origin);
      await h.reachHub(next);
      await next.evaluate(() => window.__daily.store.save());
      const fresh = JSON.parse(await next.evaluate((k) => localStorage.getItem(k), SAVE));
      h.expect(fresh.created > seeded.created && !fresh.events.some((e) => /^seed-/.test(e.id)), 'the new game did not start a fresh save: ' + JSON.stringify({ created: fresh.created, events: fresh.events.map((e) => e.id) }));

      // the stale copy comes back from the page cache and is used: back in view, focus, and a save
      const loaded = stale.waitForEvent('load', { timeout: 15000 }).then(() => true, () => false);
      await stale.bringToFront();
      await stale
        .evaluate(() => {
          window.__away = false;
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
          window.__daily.store.save();
        })
        .catch(() => undefined);
      const reloaded = await loaded;
      const now = await next.evaluate((keys) => keys.map((k) => localStorage.getItem(k)), [SAVE, 'dbt.you.v1']);
      const after = JSON.parse(now[0]);
      const old = after.events.filter((e) => /^seed-/.test(e.id)).map((e) => e.id);
      h.expect(!old.length && after.created === fresh.created, `the copy that missed the clear folded its old save into the new game: ${JSON.stringify({ old, created: after.created, want: fresh.created })}`);
      h.expect(!/Robin|Pip/.test(now[1] ?? ''), 'the copy that missed the clear brought its old names into the new game: ' + now[1]);
      h.expect(reloaded, 'the copy that missed the clear did not reload into the new game');
      await stale.waitForFunction(() => document.documentElement.dataset.ready === '1' && !!window.__daily, null, { timeout: 30000 });
      const mine = await stale.evaluate(() => ({ marker: window.__marker ?? null, created: window.__daily.store.state.created, events: window.__daily.store.state.events.map((e) => e.id) }));
      h.expect(mine.marker === null && mine.created === fresh.created && !mine.events.some((id) => /^seed-/.test(id)), 'after reloading, the copy is not on the new save: ' + JSON.stringify(mine));
      await h.reachHub(stale);
      await h.shot(stale, 'missed-reloaded');
      const last = JSON.parse(await next.evaluate((k) => localStorage.getItem(k), SAVE));
      h.expect(!last.events.some((e) => /^seed-/.test(e.id)) && last.created === fresh.created, 'the reloaded copy brought old progress into the new game');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },

  /** the player confirms, then leaves for the Safe Zone while the backup is checked: nothing is cleared */
  async 'clear-left-during-check'(h) {
    const srv = await host(await build(h.shared));
    const { ctx, errors } = await context(h);
    try {
      const page = await ctx.newPage();
      await seed(page, srv.origin, seedData());
      await openGame(page, srv.origin);
      // a slow copy: it says it is holding and takes the full three seconds, then hears how the clear ended
      const slow = await ctx.newPage();
      await slow.goto(srv.origin + '/other/');
      await slow.evaluate(() => {
        window.__heard = new Promise((ok) => {
          const c = new BroadcastChannel('dbt.clear');
          c.onmessage = ({ data }) => {
            if (data.type === 'stop') c.postMessage({ type: 'holding', id: data.id, tab: 'slow-copy' });
            else if (data.type === 'resume' || data.type === 'clear') ok(data.type);
          };
        });
      });
      await page.bringToFront();
      await settings(page);
      await backUp(h, page, 'crystal-left');
      const before = names(await device(page));
      await page.getByRole('button', { name: CONFIRM }).click();
      await page.waitForFunction(() => /Checking your Save Crystal/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      await page.locator('.dq-top .dq-safe').click();
      await page.getByText('Talk to someone now').first().waitFor({ timeout: 3000 });
      const ended = await slow.evaluate(() => Promise.race([window.__heard, new Promise((ok) => setTimeout(() => ok('nothing'), 15000))]));
      h.expect(ended === 'resume', `the clear went on after the player left Settings for the Safe Zone (the other copy heard ${ended})`);
      const after = await device(page);
      h.expect(JSON.stringify(names(after)) === JSON.stringify(before) && /seed-card/.test(after.ls[SAVE] ?? ''), 'something was cleared after the player left Settings: ' + JSON.stringify(names(after)));
      h.expect((await page.evaluate(() => window.__daily.route.name)) === 'safe' && !(await page.locator('.dq-cleared').count()), 'the player was moved out of the Safe Zone');
      await page.locator('.dq-top .dq-back').click();
      await settings(page);
      h.expect(!(await asking(page).count()), 'the confirmation came back after the Safe Zone');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },

  /** restoring the same Save Crystal twice adds its unfinished drawing once, next to a different one under the same key */
  async 'restore-drafts-twice'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN, [h.YOU]: JSON.stringify({ name: 'Robin', companion: 'Pip', nameAt: 1, companionAt: 1 }) });
    try {
      await h.reachHub(page);
      const line = (x) => [{ i: 1, w: 3, p: [x, 20, x + 40, 80] }];
      const drafts = () =>
        page.evaluate(async () => {
          const { artStore } = await import('/src/daily/artstore.ts');
          return (await artStore(window.__daily.store.key).drafts()).map((d) => `${d.key}|${JSON.stringify(d.strokes)}`).sort();
        });
      await page.evaluate(async (strokes) => {
        const { artStore } = await import('/src/daily/artstore.ts');
        await artStore(window.__daily.store.key).putDraft({ key: 'today', kind: 'today', prompt: null, strokes, t: 5 });
      }, line(10));
      const file = await newerCrystal(h, page, 'drafts-before');
      file.drafts = file.drafts.map((d) => ({ ...d, strokes: line(50), t: 9 }));
      for (const n of [1, 2, 3]) h.expect(/Restored/.test(await newerRestore(h, page, file, `drafts-${n}.json`)), `Restore ${n} did not finish`);
      const got = await drafts();
      h.expect(got.length === 2 && got.filter((d) => d.includes(JSON.stringify(line(50)))).length === 1 && got.some((d) => d.startsWith('today|')), `restoring the same file three times left these unfinished drawings: ${JSON.stringify(got)}`);
      // two unfinished edits of different saved drawings that look the same are two drafts, each kept once
      const drawing = (id) => ({ id, kind: 'today', day: '2026-10-20', t: 7, updated: 7, n: 1, strokes: line(5) });
      file.art = [...(file.art ?? []), drawing('look-x'), drawing('look-y')];
      file.drafts = [...file.drafts, { key: 'edit-x', kind: 'today', editId: 'look-x', strokes: line(70), t: 11 }, { key: 'edit-y', kind: 'today', editId: 'look-y', strokes: line(70), t: 12 }];
      for (const n of [4, 5]) h.expect(/Restored/.test(await newerRestore(h, page, file, `drafts-${n}.json`)), `Restore ${n} did not finish`);
      const edits = await page.evaluate(async () => {
        const { artStore } = await import('/src/daily/artstore.ts');
        return (await artStore(window.__daily.store.key).drafts()).filter((d) => d.editId).map((d) => d.editId).sort();
      });
      h.expect(JSON.stringify(edits) === JSON.stringify(['look-x', 'look-y']), `the unfinished edits of two different saved drawings came out as ${JSON.stringify(edits)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Settings, the confirmation and the finished page at each size, each in a browser opened at that size */
  async 'clear-screens-at-every-size'(h) {
    const srv = await host(await build(h.shared));
    try {
      for (const [label, size] of SIZES) {
        const { ctx, errors } = await context(h, size);
        try {
          const page = await ctx.newPage();
          await seed(page, srv.origin, seedData());
          await openGame(page, srv.origin);
          await settings(page);
          await into(page, '.dq-clear');
          await h.shot(page, `settings-${label}`);
          await fits(h, page, `Settings at ${label}`);
          await backUp(h, page, `crystal-${label}-kept`);
          await page.getByRole('button', { name: KEEP }).click();
          h.expect(/Nothing was cleared\./.test(await statusText(page)) && (await onStart(page)), `Keep everything at ${label} did not say nothing was cleared with focus back on the button`);
          await page.locator('.dq-settings .dq-hint[aria-live]').first().evaluate((n) => n.scrollIntoView({ block: 'center' }));
          await h.shot(page, `outcome-${label}`);
          const small = await smallText(page, '.dq-settings .dq-hint[aria-live], .dq-clear');
          h.expect(!small.length, `text under 16px at ${label}: ${small.join(' | ')}`);
          await backUp(h, page, `crystal-${label}`);
          h.expect(await page.evaluate(() => document.activeElement?.id === 'dq-clear-h'), `the confirmation heading did not take focus at ${label}`);
          await into(page, '#dq-clear-h');
          await h.shot(page, `confirm-${label}`);
          await fits(h, page, `the confirmation at ${label}`);
          const smallAsk = await smallText(page, '.dq-clear');
          h.expect(!smallAsk.length, `confirmation text under 16px at ${label}: ${smallAsk.join(' | ')}`);
          const box = await page.locator('#dq-clear-h').boundingBox();
          const bar = await page.locator('.dq-top').boundingBox();
          h.expect(box.y >= bar.y + bar.height - 1, `the confirmation heading sits under the top bar at ${label}`);
          await page.getByRole('button', { name: CONFIRM }).click();
          await finished(page);
          h.expect(await page.evaluate(() => document.activeElement?.id === 'dq-cleared-h'), `focus is not on the finished heading at ${label}`);
          await into(page, '.dq-cleared');
          await h.shot(page, `cleared-${label}`);
          await fits(h, page, `the finished page at ${label}`);
          const smallDone = await smallText(page, '.dq-cleared');
          h.expect(!smallDone.length, `finished page text under 16px at ${label}: ${smallDone.join(' | ')}`);
          h.expect(!(await busyLive(page)).length, `a live line on the finished page sits inside something busy at ${label}`);
          h.expect(await page.locator('.dq-top .dq-safe').isVisible(), `no Safe Zone button on the finished page at ${label}`);
          await safeZoneOneTap(h, page, `after clearing at ${label}`);
          await finished(page);
          onlyNeighbours(h, await device(page), `after clearing at ${label}`);
          h.expect(!errors.length, errors.join('\n'));
        } finally {
          await ctx.close();
        }
      }
    } finally {
      await srv.close();
    }
  },

  /** a copy holding a database open: clearing waits and says so, never says done early, then finishes; a failure is never done */
  async 'clear-blocked-and-failed'(h) {
    const srv = await host(await build(h.shared));
    const { ctx, errors } = await context(h);
    try {
      const page = await ctx.newPage();
      await seed(page, srv.origin, seedData());
      await openGame(page, srv.origin);
      // an unresponsive copy: holds the stories open and never lets go when asked
      const holder = await ctx.newPage();
      await holder.goto(srv.origin + '/other/');
      await holder.evaluate((name) => new Promise((ok) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => ((window.__held = r.result), ok());
      }), `${SAVE}.story`);
      await page.bringToFront();
      await settings(page);
      await backUp(h, page, 'crystal-blocked');
      await page.getByRole('button', { name: CONFIRM }).click();
      await page.getByText('Almost done. The game is still open in another tab or window.').waitFor({ timeout: 15000 });
      await h.shot(page, 'blocked-waiting');
      const busy = await busyLive(page);
      h.expect(!busy.length, 'the waiting line is inside something marked busy, so a screen reader may never read it: ' + JSON.stringify(busy));
      h.expect(!(await page.locator('.dq-cleared-h', { hasText: DONE }).count()), 'said All clear while a database was still held open');
      await holder.evaluate(() => window.__held.close());
      await finished(page);
      onlyNeighbours(h, await device(page), 'after the held database let go');

      // a deletion that fails is never reported done, and Try again finishes it
      await seed(page, srv.origin, seedData());
      await openGame(page, srv.origin);
      await settings(page);
      await page.evaluate(() => {
        const drop = IDBFactory.prototype.deleteDatabase;
        window.__drop = drop;
        IDBFactory.prototype.deleteDatabase = function (name) {
          if (!name.endsWith('.story')) return drop.call(this, name);
          const fake = new EventTarget();
          setTimeout(() => ((fake.error = new DOMException('failed', 'UnknownError')), fake.onerror?.(new Event('error'))), 50);
          return fake;
        };
      });
      await backUp(h, page, 'crystal-failed');
      await page.getByRole('button', { name: CONFIRM }).click();
      await finished(page, 'Not finished');
      await h.shot(page, 'failed');
      h.expect(/couldn.t be cleared and is still on this device/.test(await page.locator('.dq-cleared').innerText()), 'the failure does not say data is still here');
      const left = names(await device(page)).idb;
      h.expect(left.includes(`${SAVE}.story`), 'the failed database is gone anyway: ' + left);
      await page.evaluate(() => (IDBFactory.prototype.deleteDatabase = window.__drop));
      await page.getByRole('button', { name: 'Try again' }).click();
      await finished(page);
      onlyNeighbours(h, await device(page), 'after Try again');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },

  /**
   * a save no version can read (stored broken, or kept beside a readable one from an earlier visit) goes into every Save
   * Crystal byte for byte, so the Crystal is complete, clearing goes ahead, and Restore puts it back exactly where it was
   */
  async 'clear-carries-unreadable-saves'(h) {
    const BROKEN = '{"v":1,"events":';
    for (const [what, extra] of [
      ['a stored save that is not a save', { [SAVE]: BROKEN }],
      ['a copy kept from an earlier visit', { [`${SAVE}.unreadable.1700000000000`]: '{not a save \u00e9\n  ' }],
    ]) {
      const srv = await host(await build(h.shared));
      const { ctx, errors } = await context(h);
      try {
        const page = await ctx.newPage();
        const data = seedData();
        Object.assign(data.ls, extra);
        await seed(page, srv.origin, data);
        await openGame(page, srv.origin);
        await h.reachHub(page);
        await settings(page);
        const keptHere = (d) => Object.fromEntries(Object.entries(d.ls).filter(([k]) => k.startsWith(`${SAVE}.unreadable.`)));
        const kept = keptHere(await device(page));
        h.expect(Object.keys(kept).length === 1 && (what.includes('earlier') || Object.values(kept)[0] === BROKEN), `${what}: the unreadable save was not kept as it was: ${JSON.stringify(kept)}`);
        const carried = Object.entries(kept).map(([k, raw]) => ({ at: k.slice(`${SAVE}.unreadable.`.length), raw }));
        // the ordinary Save Crystal holds it and is complete
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Save Crystal', exact: true }).click()]);
        const plain = path.join(h.out, `crystal-unread-${what.length}.json`);
        await dl.saveAs(plain);
        const file = JSON.parse(fs.readFileSync(plain, 'utf8'));
        h.expect(file.incomplete === false && JSON.stringify(file.unreadSaves) === JSON.stringify(carried), `${what}: the Save Crystal is incomplete or doesn't carry the unreadable save byte for byte: ${JSON.stringify({ incomplete: file.incomplete, unreadSaves: file.unreadSaves })}`);
        await page.waitForFunction(() => /Save Crystal downloaded\./.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
        // Back up, then clear goes ahead and takes it with everything else
        const backup = await backUp(h, page, `crystal-unread-backup-${what.length}`);
        h.expect(JSON.stringify(backup.raw.unreadSaves) === JSON.stringify(carried), `${what}: the backup doesn't carry the unreadable save`);
        await page.getByRole('button', { name: CONFIRM }).click();
        await finished(page);
        onlyNeighbours(h, await device(page), `${what}: after clearing`);
        // Restore on a clean device puts it back exactly, once, however often it is restored
        const { ctx: fresh, errors: freshErrors } = await context(h);
        try {
          const p2 = await fresh.newPage();
          await p2.goto(srv.origin + '/other/');
          await p2.evaluate(() => localStorage.setItem('dbt.app.v1', JSON.stringify({ seenCutscene: true })));
          await openGame(p2, srv.origin);
          await h.reachHub(p2);
          await settings(p2);
          for (const n of [1, 2]) {
            await p2.locator('input[type=file]').setInputFiles(backup.file);
            await p2.getByRole('button', { name: 'Restore this Save Crystal' }).click();
            await p2.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
            const back = keptHere(await device(p2));
            h.expect(JSON.stringify(back) === JSON.stringify(kept), `${what}: Restore ${n} did not put the unreadable save back exactly: ${JSON.stringify(back)}`);
          }
          h.expect(!freshErrors.length, freshErrors.join('\n'));
        } finally {
          await fresh.close();
        }
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
        await srv.close();
      }
    }
  },

  /** a save this browser won't let the game read can't go into a Save Crystal, so nothing is cleared */
  async 'clear-unreadable-save-stays'(h) {
    const srv = await host(await build(h.shared));
    const { ctx, errors } = await context(h);
    try {
      const page = await ctx.newPage();
      await seed(page, srv.origin, seedData());
      await ctx.addInitScript((key) => {
        if (!location.pathname.startsWith('/game/')) return;
        const get = Storage.prototype.getItem;
        Storage.prototype.getItem = function (k) {
          if (this === localStorage && k === key) throw new DOMException('blocked', 'SecurityError');
          return get.call(this, k);
        };
      }, SAVE);
      await openGame(page, srv.origin);
      // with its save unreadable the game opens as a first visit, welcome window and all
      await h.reachHub(page);
      await settings(page);
      const before = await device(page);
      await page.getByRole('button', { name: START }).click();
      await page.waitForFunction(() => /couldn.t hold everything \(progress\), so nothing was cleared/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      h.expect(!(await asking(page).count()), 'a Save Crystal without the save went on to the confirmation');
      unchanged(h, before, await device(page), 'a save the game could not read');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },

  /** offline, clearing still takes the offline files and worker with it */
  async 'clear-offline'(h) {
    const srv = await host(await build(h.shared));
    const { ctx, errors } = await context(h);
    try {
      const page = await ctx.newPage();
      await seed(page, srv.origin, seedData());
      await openGame(page, srv.origin);
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller && !!window.__daily, null, { timeout: 30000 });
      await ctx.setOffline(true);
      await settings(page);
      await backUp(h, page, 'crystal-offline');
      await page.getByRole('button', { name: CONFIRM }).click();
      await finished(page);
      h.expect(/needs a connection once/.test(await page.locator('.dq-cleared').innerText()), 'the finished page does not say starting again needs a connection');
      onlyNeighbours(h, await device(page), 'after clearing offline');
      await ctx.setOffline(false);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },
};
