// Every companion screen without internet. One complete install of the production build, then the server stops and
// the browser goes offline; a cold launch opens every screen the player can reach, through its own controls, and does
// something real on each one. Nothing may leave the page or its offline worker: cache-served files, blob: and data: URLs
// are fine, anything that needs the server is a failure. Runs on the built site under its own path, worker allowed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = '/game/';
const SAVE = 'dbt.lantern.v1';
const NOISE = /WebGL|GPU stall|AudioContext/i;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
const SEED_PAGE = '<!doctype html><meta charset="utf-8"><title>Seed</title><p>Not the game.</p>';

let scratch;
function scratchDir() {
  if (!scratch) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-e2e-offline-'));
    process.once('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
  }
  return scratch;
}

function build(shared) {
  return (shared.offlineBuild ??= new Promise((resolve, reject) => {
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

/** The build under BASE and a plain page under /seed/, outside the worker's scope, to write saves without opening the game. */
async function host(dir) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/seed/') return res.writeHead(200, { 'content-type': MIME['.html'] }).end(SEED_PAGE);
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
  let open = true;
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => (open ? ((open = false), new Promise((ok) => (server.closeAllConnections(), server.close(ok)))) : Promise.resolve()),
  };
}

const today = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const stroke = (x) => [{ i: 1, w: 3, p: [x, 20, x + 60, 80, x + 90, 40] }];

/** A player some days in: progress, names, lists, a diary day, one saved drawing and one story, none of it opened online. */
function seedData() {
  const t = Date.now() - 86400000;
  return {
    ls: {
      [SAVE]: JSON.stringify({
        v: 1,
        created: t - 9 * 86400000,
        events: [
          { id: 'seed-visit', k: 'visit', xp: 10, t: t - 3000, day: '2026-10-01' },
          { id: 'seed-wise', k: 'skill', skill: 'wise-mind', stat: 'sense', xp: 20, t: t - 2000, day: '2026-10-01', data: { answer: 'Yes' } },
        ],
        diary: { '2026-10-01': { day: '2026-10-01', emotions: { Calm: 3 }, urges: { Rest: 2 }, note: 'A seed diary day.', updatedAt: t } },
        lists: {
          comfort: [{ id: 'seed-comfort', text: 'Warm tea', at: t }],
          activities: [{ id: 'seed-walk', text: 'A short walk', at: t }],
          reasons: [{ id: 'seed-reason', text: 'My cat', at: t }],
          people: [{ id: 'seed-person', name: 'Sam', phone: '555 0100', at: t }],
        },
        flags: { greetDay: today(), therapistLineShown: true },
        profile: { playerName: 'Kit', companion: 'Lumen', setAt: { playerName: t, companion: t } },
      }),
      'dbt.you.v1': JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: t, companionAt: t }),
      'dbt.app.v1': JSON.stringify({ seenCutscene: true }),
      'dbt.install-hint.v1': 'dismissed',
    },
    art: {
      meta: [['seed-art', { id: 'seed-art', kind: 'today', day: '2026-10-01', t, updated: t, prompt: 'A small light', n: 1, rev: 'r1' }]],
      strokes: [['seed-art', stroke(20)]],
    },
    story: {
      stories: [{ id: 'seed-story', title: 'Seed story', created: t, updated: t, rev: 'r1', chapters: ['seed-page'], notes: 'seed-notes' }],
      chapters: [
        { id: 'seed-page', story: 'seed-story', kind: 'page', title: 'Shore', text: 'Seed page words.', updated: t, rev: 'r1' },
        { id: 'seed-notes', story: 'seed-story', kind: 'notes', title: 'Notes', text: 'Seed notes.', updated: t, rev: 'r1' },
      ],
    },
  };
}

/** Writes the seed from a page outside the game, so no screen of the game is ever opened online. */
async function seed(page, origin, data) {
  await page.goto(origin + '/seed/');
  await page.evaluate(async ({ data, SAVE }) => {
    for (const [k, v] of Object.entries(data.ls)) localStorage.setItem(k, v);
    const req = (r) => new Promise((ok, bad) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => bad(r.error))));
    const make = (name, upgrade) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => upgrade(r.result);
      return req(r);
    };
    const art = await make(`${SAVE}.art`, (db) => ['meta', 'strokes', 'thumbs', 'drafts'].forEach((s) => db.createObjectStore(s)));
    const at = art.transaction(['meta', 'strokes'], 'readwrite');
    for (const [s, rows] of Object.entries(data.art)) for (const [k, v] of rows) at.objectStore(s).put(v, k);
    await new Promise((ok) => (at.oncomplete = ok));
    art.close();
    const story = await make(`${SAVE}.story`, (db) => {
      db.createObjectStore('stories', { keyPath: 'id' });
      db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('story', 'story');
      db.createObjectStore('cards');
      db.createObjectStore('days');
    });
    const st = story.transaction(['stories', 'chapters'], 'readwrite');
    for (const s of data.story.stories) st.objectStore('stories').put(s);
    for (const c of data.story.chapters) st.objectStore('chapters').put(c);
    await new Promise((ok) => (st.oncomplete = ok));
    story.close();
  }, { data, SAVE });
}

/**
 * A fresh profile with the offline worker allowed. Page errors, console errors, CSP violations and dialogs are always
 * problems; once offline, so is any request the page or the worker sends past the worker's cache.
 */
async function context(h, viewport) {
  const ctx = await h.browser.newContext({ viewport, deviceScaleFactor: viewport.width > 900 ? 1 : 2, serviceWorkers: 'allow', acceptDownloads: true });
  await ctx.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`)));
  const problems = [];
  const local = (u) => /^(blob|data):/.test(u);
  let offline = false;
  ctx.on('request', (r) => offline && r.serviceWorker() && problems.push(`the offline worker asked the network for ${r.url()}`));
  ctx.on('page', (page) => {
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => ((m.type() === 'error' && !NOISE.test(m.text())) || (m.type() === 'warning' && /^\[(intro|app)\]/.test(m.text()))) && problems.push(`console ${m.type()}: ${m.text().slice(0, 300)}`));
    page.on('dialog', (d) => (problems.push('dialog: ' + d.message()), void d.dismiss()));
    page.on('requestfailed', (r) => offline && !local(r.url()) && problems.push(`failed offline: ${r.url()} (${r.failure()?.errorText})`));
    page.on('response', (r) => offline && !local(r.url()) && !r.fromServiceWorker() && problems.push(`answered by the network, not the offline cache: ${r.url()}`));
  });
  return {
    ctx,
    problems,
    async goOffline(srv) {
      await srv.close();
      offline = true;
      await ctx.setOffline(true);
    },
  };
}

const swConst = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').match(new RegExp(`const ${name} = (.+);\\n`))[1]);
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)).map((f) => e.name + '/' + f) : [e.name]));

/** Opens the game online once, waits for the worker to take over and checks its cache holds every file the game loads. */
async function install(h, page, origin, dir) {
  await page.goto(origin + BASE + '?mute');
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && !!window.__daily, null, { timeout: 60000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 60000 });
  const cache = 'dbt.precache.' + swConst(dir, 'VERSION');
  const state = await page.evaluate(async () => {
    const meta = await caches.open('dbt.precache-meta');
    const current = await (await meta.match('current'))?.text();
    const files = current && (await caches.has(current)) ? (await (await caches.open(current)).keys()).map((r) => new URL(r.url).pathname) : [];
    return { worker: navigator.serviceWorker.controller.scriptURL, current, files };
  });
  h.expect(state.worker === origin + BASE + 'sw.js', `the page is controlled by ${state.worker}, not the game's offline worker`);
  h.expect(state.current === cache, `the offline worker's current cache is ${state.current}, not this build's ${cache}`);
  // every file the game can load (scripts, styles, fonts, the model, icons, the manifest), counted from the build itself
  const loadable = walk(dir).filter((f) => !/^(sw\.js|index\.html|_headers|robots\.txt)$|^splash\//.test(f));
  const missing = [BASE, ...loadable.map((f) => BASE + f)].filter((p) => !state.files.includes(p));
  h.expect(!missing.length, `not in the offline cache after install: ${missing.join(', ')}`);
  h.expect(loadable.some((f) => /^assets\/.+\.js$/.test(f)) && loadable.includes('models/hero.glb'), 'the build has no scripts or model to check');
  return cache;
}

const screenOf = (page) => page.evaluate(() => document.querySelector('.dq')?.dataset.screen ?? null);
const atScreen = (page, name, timeout = 15000) => page.waitForFunction((n) => document.querySelector('.dq')?.dataset.screen === n, name, { timeout });

/** Taps away any window the companion opens (a rank, a welcome) until Home is clear. */
async function settle(h, page) {
  for (const end = Date.now() + 30000; Date.now() < end; await h.sleep(300)) {
    const open = await page.evaluate(() => [...document.querySelectorAll('.dq-sw')].filter((w) => !w.closest('.pwa-hint-layer')).length);
    if (!open && (await page.locator('nav.dq-menu .dq-tile').first().isVisible())) return;
    const scrim = page.locator('.dq-scrim.is-on');
    if (await scrim.count()) await scrim.click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
  }
  throw new Error('Home never cleared');
}

/** Back to Home through each screen's own Lantern, Leave or close control. */
async function home(h, page) {
  for (let i = 0; i < 4 && (await screenOf(page)) !== 'hub'; i++) {
    const at = await screenOf(page);
    await page.locator(at === 'skill' ? '.dq-top [aria-label="Leave this skill"]' : '.dq-top .dq-back').click();
    await page.waitForFunction((was) => document.querySelector('.dq')?.dataset.screen !== was, at, { timeout: 10000 }).catch(() => {});
  }
  await atScreen(page, 'hub');
  await settle(h, page);
}

/** taps the middle of `loc` where it is now, as a player does: a Playwright click first waits for two still frames, which a
 *  scene drawing about one frame a second in software can take longer to give than the click waits */
async function tapWhereItIs(page, loc) {
  const box = await loc.boundingBox({ timeout: 2000 });
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
const tile = (page, title) => page.locator('nav.dq-menu .dq-tile').filter({ has: page.locator('.dq-tile-t', { hasText: new RegExp(`^${title}$`) }) });
const heading = (page) => page.locator('.dq-view h1').first().textContent({ timeout: 10000 });

/** What kind of step is on screen, told apart by the parts only that kind draws. */
const stepKind = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.dq-step-body');
    const has = (sel) => !!b.querySelector(sel);
    const typing = [...b.querySelectorAll('textarea, input[type=text]')].some((e) => !e.closest('.dq-addrow, .dq-other, .is-hidden'));
    const copy = [...b.querySelectorAll('button')].some((e) => e.textContent.trim() === 'Copy');
    if (has('.dq-intro')) return 'intro';
    if (has('.dq-timer')) return 'timer';
    if (has('.dq-hold')) return 'hold';
    if (has('.dq-counter')) return 'count';
    if (has('.dq-arc')) return 'breath';
    if (has('.dq-ring-count')) return 'pmr';
    if (has('.dq-range')) return 'slider';
    if (has('.dq-swipe')) return 'cards';
    if (has('.dq-addrow')) return 'list';
    if (has('.ca-tiers')) return 'tier';
    if (has('.dq-checks')) return 'checks';
    if (has('.dq-map')) return 'map';
    if (has('.dq-hl')) return 'highlight';
    if (typing && copy) return 'draft';
    if (typing) return 'input';
    if (has('.dq-opts:not(.dq-opts--fills) > .dq-opt')) return 'choice';
    return 'say';
  });

/** Does what the step asks before moving on: types, slides, counts, holds, ranks, checks, starts the timer. */
async function answer(page, kind) {
  const body = page.locator('.dq-step-body');
  if (kind === 'input' || kind === 'draft') await body.locator('textarea:visible, input[type=text]:visible').first().fill('Typed with no internet.');
  if (kind === 'slider') await body.locator('.dq-range').press('ArrowRight');
  if (kind === 'count') while (await body.locator('.dq-counter button:enabled').count()) await body.locator('.dq-counter button').click();
  if (kind === 'tier' || kind === 'checks') for (const row of await body.locator('.dq-check').all()) await row.getByRole('radio').first().click();
  if (kind === 'timer' && (await body.locator('.dq-timer .dq-actions .dq-btn--primary').count())) await body.locator('.dq-timer .dq-actions .dq-btn--primary').first().click();
  if (kind === 'hold') {
    const box = await body.locator('.dq-hold').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await body.locator('.dq-hold.is-done').waitFor({ timeout: 20000 }).finally(() => page.mouse.up());
  }
}

/** Marks the answer to tap: a preferred label if one is offered, else the first chip, else the step's first action. */
const markFirst = (page, prefer) =>
  page.evaluate((prefer) => {
    document.querySelectorAll('[data-offline]').forEach((e) => e.removeAttribute('data-offline'));
    const body = document.querySelector('.dq-step-body');
    const shown = (e) => !!e.getClientRects().length && !e.disabled && !e.closest('.is-hidden');
    const label = (e) => e.textContent.trim().replace(/[‘’]/g, "'");
    const chips = [...body.querySelectorAll('.dq-opts:not(.dq-opts--fills) > .dq-opt')].filter(shown);
    const acts = [...body.querySelectorAll('.dq-actions > button')].filter((b) => shown(b) && !b.closest('.dq-timer') && !b.classList.contains('ca-hl-ask') && label(b) !== 'Copy');
    const pick = [...chips, ...acts].find((e) => prefer.includes(label(e))) ?? chips[0] ?? acts[0];
    if (!pick) return null;
    pick.setAttribute('data-offline', 'tap');
    const next = pick.hasAttribute('aria-pressed') ? acts.find((b) => label(b) === 'Next') : null;
    next?.setAttribute('data-offline', 'then');
    return { label: label(pick), then: !!next };
  }, prefer);

/** Walks an open skill to its own end screen, answering each step; returns the kinds of step it met. */
async function walkSkill(page, where, prefer = []) {
  const title = await page.locator('.dq-skill h1').textContent();
  const path = [];
  const kinds = new Set();
  for (let step = 1; step <= 40; step++) {
    const at = await page.evaluate((t) => {
      if (document.querySelector('.dq')?.dataset.screen !== 'skill') return 'left';
      if (document.querySelector('.dq-skill h1')?.textContent !== t) return 'another skill';
      return document.querySelector('.dq-step-body .dq-intro--end') ? 'end' : null;
    }, title);
    if (at === 'end') return kinds;
    if (at) throw new Error(`${where}: the walk ended on ${at}, not the skill's end (${path.join(' > ')})`);
    const kind = await stepKind(page);
    kinds.add(kind);
    await answer(page, kind);
    const pick = await markFirst(page, prefer);
    if (!pick) throw new Error(`${where}: nothing to tap on step ${step}, a ${kind} step (${path.join(' > ')})`);
    await page.evaluate((k) => document.querySelector('.dq-step-body')?.firstElementChild?.setAttribute('data-offline-step', String(k)), step);
    await page.locator('[data-offline="tap"]').click();
    if (pick.then) await page.locator('[data-offline="then"]').click();
    path.push(`${kind}: ${pick.label}`);
    await page.waitForFunction((k) => !document.querySelector(`[data-offline-step="${k}"]`) || document.querySelector('.dq')?.dataset.screen !== 'skill', step, { timeout: 10000 });
  }
  throw new Error(`${where}: no end after 40 steps (${path.join(' > ')})`);
}

/** Skills that between them show every kind of step, with the answers that lead there (sl and real names come from SKILLS). */
const COVER = [
  ['tipp', ['Squeeze and release, 1 min']],
  ['stop', []],
  ['sense-up', []],
  ['pros-cons', []],
  ['dear-man', []],
  ['fast', []],
  ['validation', []],
  ['accepts', ['Activities']],
  ['abc-please', ['PLEASE. Body check']],
  ['flavour-tier', ['Skip the timer']],
  ['urge-surf', ['Done']],
];
const KINDS = ['intro', 'say', 'choice', 'input', 'slider', 'breath', 'timer', 'hold', 'count', 'pmr', 'cards', 'list', 'tier', 'checks', 'draft', 'map', 'highlight'];

const saved = async (page) => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), SAVE)) ?? 'null');
const skillCredits = async (page, id) => ((await saved(page))?.events ?? []).filter((e) => e.k === 'skill' && (!id || e.skill === id)).length;

/** Records every cue the companion plays and the screen it played on, so the Safe Zone can be checked for silence. */
const listen = (page) =>
  page.evaluate(() => {
    const a = window.__daily;
    window.__cues = [];
    const sound = a.opts.sound;
    if (!sound) return;
    const play = sound.play.bind(sound);
    sound.play = (c, ...rest) => (window.__cues.push([a.route.name, c]), play(c, ...rest));
  });

/** Waits for the screen's own fades and openings to finish (looping light keeps going), so its picture is what the player sees. */
const calm = (page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {});

/** One screen reached: its heading is the one expected, nothing went wrong, and it gets a picture. */
async function arrived(h, page, problems, name, title) {
  const got = (await heading(page))?.trim();
  h.expect(title instanceof RegExp ? title.test(got) : got === title, `${name}: the heading is "${got}", not "${title}"`);
  h.expect(!problems.length, `${name}:\n${problems.join('\n')}`);
  await calm(page);
  await h.shot(page, name);
}

/** The cold launch: the document, its scripts and styles all come from the offline cache. */
async function launch(h, ctx, origin, query, { viewport, reducedMotion } = {}) {
  const page = await ctx.newPage();
  if (viewport) await page.setViewportSize(viewport);
  if (reducedMotion) await page.emulateMedia({ reducedMotion });
  await page.goto(`${origin}${BASE}${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && !!window.__daily, null, { timeout: 60000 });
  h.expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the cold launch is not controlled by the offline worker');
  await settle(h, page);
  await listen(page);
  return page;
}

/** Home, a heavy check-in into A quiet minute and on to Stealth, today's skill left on its first screen, and today's line. */
async function homeAndToday(h, page, problems) {
  await arrived(h, page, problems, 'offline-home', /Lantern/);
  await page.locator('.dq-checkin').getByRole('button', { name: 'Sad', exact: true }).click();
  await atScreen(page, 'ease');
  await page.getByText('That sounds like a lot.').waitFor();
  await arrived(h, page, problems, 'offline-ease', 'A quiet minute');
  await page.getByRole('button', { name: 'Stay here a minute' }).click();
  await atScreen(page, 'rest');
  await page.getByRole('button', { name: 'Aquarium' }).click();
  await page.locator('.dq-stealth.is-aquarium').waitFor();
  await arrived(h, page, problems, 'offline-rest', 'Stealth');
  await home(h, page);

  const before = await skillCredits(page);
  await page.getByRole('button', { name: "Reveal today's skill card" }).click({ force: true });
  await page.locator('.dq-quest-acts').getByRole('button', { name: 'Begin' }).click();
  await atScreen(page, 'skill');
  await page.locator('.dq-intro-name').waitFor();
  await arrived(h, page, problems, 'offline-today-skill', /\S: \S/);
  await page.getByRole('button', { name: 'Leave this skill' }).click();
  await atScreen(page, 'hub', 5000);
  await settle(h, page);
  h.expect((await skillCredits(page)) === before + 1, 'leaving today\'s skill on its first screen did not credit it');
  await page.locator('.dq-quest.is-done').waitFor();

  const line = page.locator('.dq-lines .dq-lineopt').first();
  const text = (await line.locator('.dq-line-t').textContent()).trim();
  await line.click();
  await page.locator('.dq-line--pinned').waitFor();
  await page.getByRole('link', { name: 'Your lines' }).or(page.getByRole('button', { name: 'Your lines' })).first().click();
  await atScreen(page, 'lines');
  h.expect((await page.locator('.dq-logrow .dq-line-t').allTextContents()).some((t) => t.trim() === text), `Your lines does not show "${text}"`);
  await arrived(h, page, problems, 'offline-lines', 'Your lines');
  await home(h, page);
}

/** The library, then every kind of step in a skill opened from it and walked to its end, each credited once. */
async function skills(h, page, problems, names) {
  const met = new Set();
  for (const [id, prefer] of COVER) {
    await tile(page, 'Skills').click();
    await atScreen(page, 'library');
    if (id === COVER[0][0]) await arrived(h, page, problems, 'offline-library', 'Skills');
    const { sl, real } = names[id];
    const found = await page.evaluate(({ sl, real }) => {
      const plain = (t) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
      const rows = [...document.querySelectorAll('.dq-librow')].filter((r) => plain(r.querySelector('.dq-librow-n').textContent) === plain(sl) && plain(r.querySelector('.dq-librow-r').textContent) === plain(real));
      rows.forEach((r) => r.setAttribute('data-offline', 'row'));
      return rows.length;
    }, { sl, real });
    h.expect(found === 1, `the library lists ${sl} (${real}) ${found} times`);
    const row = page.locator('[data-offline="row"]');
    const before = await skillCredits(page, id);
    await row.click();
    await atScreen(page, 'skill');
    await page.locator('.dq-skill .dq-step-body > *').first().waitFor();
    const maps = (await saved(page))?.maps?.length ?? 0;
    for (const k of await walkSkill(page, `skill ${id}`, prefer)) met.add(k);
    if (id === 'pros-cons') h.expect(((await saved(page))?.maps?.length ?? 0) === maps + 1, 'the save step of Strategy Map kept nothing');
    h.expect(!problems.length, `skill ${id}:\n${problems.join('\n')}`);
    await calm(page);
    await h.shot(page, `offline-skill-${id}-end`);
    await home(h, page);
    h.expect((await skillCredits(page, id)) === before + 1, `${id} was credited ${(await skillCredits(page, id)) - before} times, not once`);
  }
  const missing = KINDS.filter((k) => !met.has(k));
  h.expect(!missing.length, `no skill walk showed these kinds of step: ${missing.join(', ')}`);
}

/** Give me a moment, the Night Watch, the diary card and its export, and the Comfort lists. */
async function quietPlaces(h, page, problems) {
  await page.locator('.dq-momentbtn').click();
  await atScreen(page, 'moment');
  await page.waitForFunction(() => document.querySelector('.dq-mo-line')?.textContent.trim().length > 0, null, { timeout: 10000 });
  const hum = page.getByRole('switch', { name: 'Low hum', exact: true });
  await hum.check();
  h.expect(await hum.isChecked(), 'the Low hum switch did not turn on');
  await arrived(h, page, problems, 'offline-moment', 'Give me a moment');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await atScreen(page, 'hub');
  await settle(h, page);

  await tile(page, 'Shadows').click();
  await atScreen(page, 'shadows');
  await page.locator('.w2-roster').getByRole('heading', { name: 'The Night Watch' }).waitFor();
  const nick = page.locator('#w2n-sable');
  await nick.fill('Moss');
  await nick.press('Enter');
  await page.waitForFunction(() => /Moss/.test(document.querySelector('.w2-sh-nick')?.textContent ?? ''), null, { timeout: 5000 });
  await arrived(h, page, problems, 'offline-night-watch', 'Shadows');
  await home(h, page);

  await tile(page, 'Diary card').click();
  await atScreen(page, 'diary');
  const sad = page.getByRole('radio', { name: 'Sadness: 3' });
  await sad.click();
  for (let i = 0; i < 20 && (await sad.getAttribute('aria-checked')) !== 'true'; i++) await h.sleep(100);
  h.expect((await sad.getAttribute('aria-checked')) === 'true', 'the diary row did not take Sadness 3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.dq-hint')].some((e) => /on this device/.test(e.textContent)), null, { timeout: 5000 });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Share or save' }).click()]);
  const card = path.join(h.out, 'offline-diary-card.txt');
  await dl.saveAs(card);
  h.expect(/Sadness/.test(fs.readFileSync(card, 'utf8')), 'the diary export has no Sadness row');
  await arrived(h, page, problems, 'offline-diary', 'Diary card');
  await home(h, page);

  await tile(page, 'Comfort').click();
  await atScreen(page, 'comfort');
  await page.getByRole('textbox', { name: 'Add to Comfort kit' }).fill('Rain on the window');
  await page.locator('.dq-listp--comfort').getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.dq-listp--comfort .dq-item', { hasText: 'Rain on the window' }).waitFor({ timeout: 5000 });
  await arrived(h, page, problems, 'offline-comfort', 'Comfort');
  await home(h, page);
}

/** The Art room: the seeded page opens, a new page is drawn, saved, found in the gallery and reopened. */
async function artRoom(h, page, problems) {
  await page.locator('.dq-tile--art').click();
  await atScreen(page, 'art');
  await page.locator('.dq-galitem').first().waitFor();
  const before = await page.locator('.dq-galitem').count();
  await arrived(h, page, problems, 'offline-art', 'Art room');
  await page.locator('.dq-galitem').first().click();
  await atScreen(page, 'piece');
  await page.locator('.dq-piece-art').waitFor();
  await arrived(h, page, problems, 'offline-piece-seeded', 'Your page');
  await page.locator('.dq-top .dq-back').click();
  await atScreen(page, 'art');

  await page.getByRole('button', { name: /^Draw today/ }).click();
  await atScreen(page, 'draw');
  await page.locator('.dq-ink-live').waitFor();
  await page.waitForFunction(() => window.__daily?.ink && !document.querySelector('.dq-ink-stage')?.inert);
  const box = await page.locator('.dq-ink-live').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.dq-tools-msg', { hasText: 'Saved in your Art room.' }).waitFor({ timeout: 10000 });
  await arrived(h, page, problems, 'offline-draw', /^Draw today/);
  await page.getByRole('button', { name: 'Art room', exact: true }).or(page.getByRole('link', { name: 'Art room', exact: true })).first().click();
  await atScreen(page, 'art');
  await page.waitForFunction((n) => document.querySelectorAll('.dq-galitem').length === n + 1, before, { timeout: 10000 });
  await page.locator('.dq-galitem').first().click();
  await atScreen(page, 'piece');
  await page.locator('.dq-piece-art').waitFor();
  await page.getByRole('button', { name: 'Keep drawing' }).waitFor();
  await arrived(h, page, problems, 'offline-piece-new', 'Your page');
  const [png] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save image' }).click()]);
  const image = path.join(h.out, 'offline-piece.png');
  await png.saveAs(image);
  h.expect(fs.readFileSync(image).subarray(1, 4).toString() === 'PNG', 'Save image made no PNG with no internet');
  await home(h, page);
}

/** The Story Room: the seeded story takes new words and keeps them after reopening, and a new story starts. */
async function storyRoom(h, page, problems) {
  await page.locator('.dq-tile--story').click();
  await atScreen(page, 'stories');
  await arrived(h, page, problems, 'offline-stories', 'Story Room');
  await page.locator('.st-row', { hasText: 'Seed story' }).click();
  await atScreen(page, 'write');
  const ta = page.locator('.st-write .st-ta').first();
  await ta.waitFor();
  const opened = await page.waitForFunction(() => document.querySelector('.st-write .st-ta')?.value.startsWith('Seed page words.'), null, { timeout: 10000 }).then(() => true, () => false);
  h.expect(opened, `the seeded story did not open with its words: ${JSON.stringify(await page.locator('.st-write textarea').evaluateAll((t) => t.map((e) => [e.className, e.value])))}`);
  await ta.press('End');
  await ta.pressSequentially(' Written with no internet.');
  await page.locator('.st-state', { hasText: 'Saved on this device' }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'More' }).click();
  const [txt] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('menuitem', { name: 'Download story' }).click()]);
  const story = path.join(h.out, 'offline-story.txt');
  await txt.saveAs(story);
  h.expect(fs.readFileSync(story, 'utf8').includes('Written with no internet.'), 'the downloaded story is missing the words written offline');
  await arrived(h, page, problems, 'offline-write', 'Your story');
  await page.locator('.dq-top .dq-back').click();
  await atScreen(page, 'stories');
  await page.locator('.st-row', { hasText: 'Seed story' }).click();
  await atScreen(page, 'write');
  await page.waitForFunction(() => /Written with no internet\.$/.test(document.querySelector('.st-write .st-ta')?.value ?? ''), null, { timeout: 10000 });
  await page.locator('.dq-top .dq-back').click();
  await atScreen(page, 'stories');
  await page.locator('.st-shelfpage button:visible', { hasText: 'New story' }).first().click();
  await atScreen(page, 'write');
  await page.locator('.st-title').fill('Offline story');
  await page.locator('.st-write .st-ta').first().fill('A first page.');
  await page.locator('.st-state', { hasText: 'Saved on this device' }).waitFor({ timeout: 10000 });
  await page.locator('.dq-top .dq-back').click();
  await atScreen(page, 'stories');
  await page.locator('.st-row', { hasText: 'Offline story' }).waitFor({ timeout: 10000 });
  await home(h, page);
}

/** Settings: the Wardrobe, then a Save Crystal made, previewed and restored, all on this device. */
async function settingsAndCrystal(h, page, problems) {
  await tile(page, 'Settings').click();
  await atScreen(page, 'settings');
  await page.locator('#set-playerName').waitFor();
  const green = page.locator('.w2-wardrobe-p').getByRole('radio', { name: 'Green' });
  await green.click();
  await page.waitForFunction(() => document.documentElement.dataset.dqAccent === 'green', null, { timeout: 5000 });
  await arrived(h, page, problems, 'offline-settings', 'Settings');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save Crystal', exact: true }).click()]);
  const crystal = path.join(h.out, 'offline-save-crystal.json');
  await dl.saveAs(crystal);
  const raw = fs.readFileSync(crystal, 'utf8');
  h.expect(raw.includes('Written with no internet.') && raw.includes('Rain on the window') && raw.includes('Offline story'), 'the Save Crystal made offline is missing work done offline');
  await page.locator('input[type=file]').setInputFiles(crystal);
  await page.locator('.dq-peek:not(.is-hidden) #dq-peek-h', { hasText: 'Inside this Save Crystal' }).waitFor({ timeout: 15000 });
  await h.shot(page, 'offline-crystal-preview');
  await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
  await page.waitForFunction(() => /Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''), null, { timeout: 15000 });
  h.expect(!problems.length, `restore:\n${problems.join('\n')}`);
  await h.shot(page, 'offline-crystal-restored');
  await replayIntro(h, page, problems).catch(async (e) => {
    await h.evidence(page, 'offline-replay-fail');
    throw e;
  });
}

/** The intro again from Settings: its 3D scenes, the hero model and the score all load from the offline cache. */
async function replayIntro(h, page, problems) {
  const awakenShots = page.waitForResponse((r) => /\/awaken-shots-[^/]+\.js$/.test(r.url()), { timeout: 240000 }).catch(() => null);
  await page.getByRole('button', { name: 'Replay cutscene' }).click();
  const title = page.locator('.title-screen');
  await title.or(page.getByRole('button', { name: 'Skip' })).first().waitFor({ timeout: 30000 });
  if (await title.isVisible()) {
    await h.sleep(1500);
    await title.click();
  }
  // played on, not skipped, to the awaken beat, which loads its own script, with each Lantern window tapped on as a
  // player does rather than left to its idle timeout; then the rest is skipped
  let shots;
  awakenShots.then((r) => (shots = r));
  while (shots === undefined) {
    if (await page.locator('.sw-layer .sw').count()) await page.mouse.click(195, 600);
    await h.sleep(800);
  }
  h.expect(!!shots, 'the replayed intro never reached the awaken scene');
  h.expect(shots.ok() && shots.fromServiceWorker(), `the awaken scene's script did not come from the offline cache (HTTP ${shots.status()})`);
  h.expect(!problems.length, `the intro's awaken scene offline:\n${problems.join('\n')}`);
  const skip = page.getByRole('button', { name: 'Skip' });
  if (await skip.isVisible()) await skip.click();
  const note = page.getByRole('button', { name: 'Read the note' });
  await note.waitFor({ timeout: 60000 });
  for (let i = 0; i < 40 && (await page.locator('.rw').count()); i++) {
    await tapWhereItIs(page, note).catch(() => {});
    await h.sleep(500);
  }
  const cont = page.getByRole('button', { name: 'Continue' });
  await cont.waitFor({ timeout: 20000 });
  await tapWhereItIs(page, cont);
  // the end card breathes, so on slow frames its buttons never hold still for a click: tap Enter the Lantern where it is
  const enter = page.getByRole('button', { name: 'Enter the Lantern' });
  await enter.waitFor({ timeout: 20000 });
  const box = await enter.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => !!window.__daily && document.querySelector('.dq')?.dataset.screen === 'hub', null, { timeout: 30000 });
  await settle(h, page);
  await listen(page);
  h.expect(!problems.length, `the intro replayed offline:\n${problems.join('\n')}`);
  await h.shot(page, 'offline-after-replay');
}

const SAFE_WALK = [
  ['start', null],
  ['breathe', 'Next'],
  ['squeeze', 'Next'],
  ['cold', 'Next'],
  ['check', 'A little lower'],
  ['stop', 'Next'],
  ['reasons', 'Next'],
  ['comfort', 'Next'],
  ['people', 'Next'],
  ['talk', 'Next'],
  ['close', null],
];

/** What the Safe Zone screen shows: its heading, whether Talk to someone now is pinned, any toast, window or effect. */
const safeState = (page) =>
  page.evaluate(() => {
    const talk = document.querySelector('.dq-sz-talk');
    return {
      at: document.querySelector('.dq')?.dataset.screen,
      title: document.querySelector('.dq-sz-t')?.textContent.trim() ?? '',
      pinned: !!talk && talk.checkVisibility(),
      toast: [...document.querySelectorAll('.dq-toast.is-on')].filter((t) => t.checkVisibility()).map((t) => t.textContent.trim()).join(' '),
      windows: document.querySelectorAll('.dq-sw').length,
      cues: window.__cues.filter(([r]) => r === 'safe').map(([, c]) => c),
    };
  });

/** Every Safe Zone screen in order through its own buttons: quiet, Talk to someone now pinned, real phone links. */
async function safeZone(h, page, problems, tag, act = true) {
  await page.getByRole('button', { name: 'Safe Zone, help right now' }).click();
  await atScreen(page, 'safe');
  const titles = [];
  for (const [at, next] of SAFE_WALK) {
    await page.waitForFunction((seen) => { const t = document.querySelector('.dq-sz-t')?.textContent.trim(); return !!t && !seen.includes(t); }, titles, { timeout: 10000 });
    const s = await safeState(page);
    titles.push(s.title);
    h.expect(at === 'talk' ? s.title === 'Talk to someone now' : s.pinned, `${tag} safe ${at}: Talk to someone now is not pinned on "${s.title}"`);
    h.expect(!s.toast && !s.windows && !s.cues.length, `${tag} safe ${at}: not quiet: ${JSON.stringify(s)}`);
    h.expect(!problems.length, `${tag} safe ${at}:\n${problems.join('\n')}`);
    await calm(page);
    await h.shot(page, `${tag}-safe-${at}`);
    const main = page.locator('.dq-sz-main');
    if (at === 'start') await main.getByRole('button', { name: 'Calm my body first' }).click();
    if (at === 'cold' && act) await main.getByRole('button', { name: /^Start 30 seconds/ }).click();
    if (at === 'stop') while (await main.getByRole('button', { name: 'Next line' }).count()) await main.getByRole('button', { name: 'Next line' }).click();
    if (at === 'reasons' && act) {
      await main.getByRole('button', { name: 'Add one' }).click();
      await main.getByRole('textbox', { name: 'Add one' }).fill('The sea at night');
      await main.getByRole('button', { name: 'Save', exact: true }).click();
      await main.getByText('The sea at night').waitFor({ timeout: 5000 });
    }
    if (at === 'people') {
      const tel = await main.locator('a[href^="tel:"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      h.expect(tel.some((t) => /^tel:\+?[\d]{3,}$/.test(t)), `${tag} safe people: no phone link for the seeded person: ${tel.join(', ')}`);
    }
    if (at === 'talk') {
      const links = await main.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      const bad = links.filter((l) => !/^(tel:\+?\d{2,}|sms:\+?\d{2,}(\?.*)?|https:\/\/[^\s]+)$/.test(l));
      h.expect(links.some((l) => l.startsWith('tel:')) && !bad.length, `${tag} safe talk: phone and help links are not all tel:, sms: or https: (${bad.join(', ') || 'no tel: link'})`);
    }
    if (next) await main.getByRole('button', { name: next, exact: true }).last().click();
  }
  const t0 = Date.now();
  await page.locator('header .dq-back', { hasText: 'Leave' }).click();
  await atScreen(page, 'hub', 3000);
  h.expect(Date.now() - t0 < 3000 && !problems.length, `${tag}: leaving the Safe Zone was not immediate:\n${problems.join('\n')}`);
  await settle(h, page);
}

/** The Safe Zone's other ways out of its first screen: a person now, not safe, and a moment. */
async function safeExits(h, page, problems) {
  for (const [button, to] of [['I need a person now', 'Talk to someone now'], ['I might not be safe', 'Talk to someone now']]) {
    await page.getByRole('button', { name: 'Safe Zone, help right now' }).click();
    await atScreen(page, 'safe');
    await page.locator('.dq-sz-main').getByRole('button', { name: button }).click();
    await page.locator('.dq-sz-t', { hasText: to }).waitFor({ timeout: 5000 });
    h.expect(!(await safeState(page)).cues.length && !problems.length, `safe ${button}: not quiet:\n${problems.join('\n')}`);
    await page.locator('header .dq-back', { hasText: 'Leave' }).click();
    await atScreen(page, 'hub', 3000);
    await settle(h, page);
  }
  await page.getByRole('button', { name: 'Safe Zone, help right now' }).click();
  await atScreen(page, 'safe');
  await page.locator('.dq-sz-main').getByRole('button', { name: 'Give me a moment' }).click();
  await atScreen(page, 'moment');
  await page.waitForFunction(() => document.querySelector('.dq-mo-line')?.textContent.trim().length > 0, null, { timeout: 10000 });
  h.expect(!problems.length, `safe moment:\n${problems.join('\n')}`);
  await home(h, page);
}

/** Every place again by its own control, at another size, after another cold launch: heading, Safe Zone button, picture. */
async function everyPlace(h, page, problems, tag) {
  // each place: its name, how the player opens it, the screen it must land on, and that screen's heading
  const via = async (first, then) => (await first(), await then());
  const places = [
    ['rest', () => tile(page, 'Stealth').click(), 'rest', 'Stealth'],
    ['night-watch', () => tile(page, 'Shadows').click(), 'shadows', 'Shadows'],
    ['library', () => tile(page, 'Skills').click(), 'library', 'Skills'],
    ['skill', () => via(() => tile(page, 'Skills').click(), () => page.locator('.dq-librow').first().click()), 'skill', /\S: \S/],
    ['diary', () => tile(page, 'Diary card').click(), 'diary', 'Diary card'],
    ['comfort', () => tile(page, 'Comfort').click(), 'comfort', 'Comfort'],
    ['settings', () => tile(page, 'Settings').click(), 'settings', 'Settings'],
    ['art', () => page.locator('.dq-tile--art').click(), 'art', 'Art room'],
    ['piece', () => via(() => page.locator('.dq-tile--art').click(), () => page.locator('.dq-galitem').first().click()), 'piece', 'Your page'],
    ['draw', () => via(() => page.locator('.dq-tile--art').click(), () => page.getByRole('button', { name: /^Draw today/ }).click()), 'draw', /^Draw today/],
    ['stories', () => page.locator('.dq-tile--story').click(), 'stories', 'Story Room'],
    ['write', () => via(() => page.locator('.dq-tile--story').click(), () => page.locator('.st-row', { hasText: 'Seed story' }).click()), 'write', 'Your story'],
    ['moment', () => page.locator('.dq-momentbtn').click(), 'moment', 'Give me a moment'],
    ['lines', () => page.locator('.dq-lines').getByText('Your lines').click(), 'lines', 'Your lines'],
  ];
  for (const [name, open, screen, title] of places) {
    await open();
    await atScreen(page, screen, 10000);
    await arrived(h, page, problems, `${tag}-${name}`, title);
    h.expect(await page.locator('.dq-top .dq-safe').isVisible(), `${tag}-${name}: the Safe Zone button is not one tap away`);
    await home(h, page);
  }
}

/** The names the library shows for the skills in COVER, read from the content on the dev server. */
async function skillNames(h) {
  const { ctx, page } = await h.open({ 'dbt.app.v1': h.SEEN });
  try {
    const ids = COVER.map(([id]) => id);
    const list = await page.evaluate(async (ids) => (await import('/src/content/dbt.ts')).SKILLS.filter((s) => ids.includes(s.id)).map(({ id, sl, real }) => ({ id, sl, real })), ids);
    h.expect(list.length === ids.length, `SKILLS has ${list.length} of the ${ids.length} skills this check walks`);
    return Object.fromEntries(list.map((s) => [s.id, s]));
  } finally {
    await ctx.close();
  }
}

/** After another cold launch, everything done offline is still on this device. */
async function kept(h, page) {
  const got = await page.evaluate(async (SAVE) => {
    const req = (r) => new Promise((ok, bad) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => bad(r.error))));
    const all = async (name, store) => {
      const db = await req(indexedDB.open(name));
      try {
        return await req(db.transaction(store, 'readonly').objectStore(store).getAll());
      } finally {
        db.close();
      }
    };
    return {
      save: localStorage.getItem(SAVE),
      art: (await all(`${SAVE}.art`, 'meta')).length,
      stories: (await all(`${SAVE}.story`, 'stories')).map((s) => s.title),
      pages: (await all(`${SAVE}.story`, 'chapters')).map((c) => c.text),
    };
  }, SAVE);
  const s = JSON.parse(got.save);
  const want = {
    'the comfort item': s.lists.comfort.some((c) => c.text === 'Rain on the window'),
    'the Safe Zone reason': s.lists.reasons.some((c) => c.text === 'The sea at night'),
    "the diary's Sadness row": JSON.stringify(s.diary).includes('Sadness'),
    'the Night Watch name': JSON.stringify(s.profile).includes('"sable":"Moss"'),
    'the new drawing': got.art === 2,
    'the new story': got.stories.includes('Offline story'),
    'the words added to the seeded story': got.pages.some((t) => t.endsWith('Written with no internet.')),
  };
  const lost = Object.entries(want).filter(([, ok]) => !ok).map(([k]) => k);
  h.expect(!lost.length, `lost after a cold launch with no internet: ${lost.join(', ')}`);
}

/** Ends the worker, as closing the app does, so the next page starts it again from what is installed. */
async function stopWorker(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
}

const SIZES = [
  ['small', { width: 320, height: 568 }, '', 'reduce'],
  ['landscape', { width: 844, height: 390 }, '?mute', 'no-preference'],
  ['desktop', { width: 1280, height: 800 }, '', 'reduce'],
];

export const scenarios = {
  /**
   * After one complete install, with the server gone and no internet: a cold launch opens every companion screen and
   * the Safe Zone through the player's own controls, and the work done there (a skill, a diary row, a list item, a
   * drawing, a story, a Save Crystal made and restored) stays. Then three more cold launches at other sizes, with sound,
   * muted and reduced motion, open every place again.
   */
  async 'offline-every-screen'(h) {
    const dir = await build(h.shared);
    const srv = await host(dir);
    const { ctx, problems, goOffline } = await context(h, { width: 390, height: 844 });
    try {
      const names = await skillNames(h);
      const first = await ctx.newPage();
      await seed(first, srv.origin, seedData());
      await install(h, first, srv.origin, dir);
      await first.close();
      await goOffline(srv);

      let page = await launch(h, ctx, srv.origin, '?mute');
      await homeAndToday(h, page, problems);
      await skills(h, page, problems, names);
      await quietPlaces(h, page, problems);
      await artRoom(h, page, problems);
      await storyRoom(h, page, problems);
      await settingsAndCrystal(h, page, problems);
      await safeZone(h, page, problems, 'offline');
      await safeExits(h, page, problems);

      for (const [tag, viewport, query, reducedMotion] of SIZES) {
        await stopWorker(ctx, page);
        await page.close();
        page = await launch(h, ctx, srv.origin, query, { viewport, reducedMotion });
        if (tag === SIZES[0][0]) await kept(h, page);
        await everyPlace(h, page, problems, tag);
        await safeZone(h, page, problems, tag, false);
      }
      await page.close();
      h.expect(!problems.length, problems.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },
};
