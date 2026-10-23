import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import { writeServiceWorker } from '../sw-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KIT = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 });
const MIME = { '.html': 'text/html; charset=utf-8; note="javascript"', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };
const NOISE = /WebGL|GPU stall|AudioContext|Failed to load resource/i;

let scratch;
function scratchDir() {
  if (!scratch) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-e2e-pwa-'));
    process.once('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
  }
  return scratch;
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const swConst = (dir, name) => fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').match(new RegExp(`const ${name} = ['"]([^'"]+)['"]`))[1];
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const portFree = (p) => new Promise((res) => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1'); });

function build(shared) {
  return (shared.pwaBuild ??= new Promise((resolve, reject) => {
    const dir = path.join(scratchDir(), 'dist');
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('exit', (code) => (code === 0 ? resolve(dir) : reject(new Error('production build failed:\n' + log.slice(-2000)))));
  }));
}

function deploy(base, tag, { rename = false } = {}) {
  const dir = path.join(scratchDir(), tag);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(base, dir, { recursive: true });
  if (rename) {
    const assets = path.join(dir, 'assets');
    const map = fs.readdirSync(assets).map((n) => [n, n.replace(/\.(js|css)$/, `-${tag}.$1`)]);
    for (const [a, b] of map) fs.renameSync(path.join(assets, a), path.join(assets, b));
    for (const f of walk(dir).filter((f) => /\.(html|js|css)$/.test(f))) {
      let s = fs.readFileSync(f, 'utf8');
      for (const [a, b] of map) s = s.split(a).join(b);
      fs.writeFileSync(f, s);
    }
  }
  const html = path.join(dir, 'index.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<title>', `<meta name="x-build" content="${tag}" />\n    <title>`));
  writeServiceWorker(dir);
  return { dir, tag, cache: swConst(dir, 'PREFIX') + swConst(dir, 'VERSION'), file: (re, sub = 'assets') => path.posix.join(sub, fs.readdirSync(path.join(dir, sub)).find((n) => re.test(n))) };
}

async function host(dir) {
  let current = dir;
  const mount = (fs.readFileSync(path.join(dir, 'index.html'), 'utf8').match(/src="(\/[^"]*?)assets\//) ?? [, '/'])[1];
  const server = http.createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return res.writeHead(400).end();
    }
    if (p.includes('\0')) return res.writeHead(400).end();
    if (!p.startsWith(mount)) return res.writeHead(404).end();
    const base = path.resolve(current);
    let f = path.resolve(base, p.slice(mount.length));
    if (f !== base && !f.startsWith(base + path.sep)) return res.writeHead(403).end();
    if (p.endsWith('/')) f = path.join(f, 'index.html');
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) f = path.join(current, 'index.html');
    const realBase = fs.realpathSync(base);
    const realFile = fs.realpathSync(f);
    if (realFile !== realBase && !realFile.startsWith(realBase + path.sep)) return res.writeHead(403).end();
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}${mount}`;
  return {
    url,
    use: (d) => (current = d),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }),
  };
}

async function context(h, { seed = {}, sw = true, webgl = true, viewport = { width: 390, height: 844 }, reducedMotion } = {}) {
  const ctx = await h.browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: sw ? 'allow' : 'block', reducedMotion, ...(h.flags?.media ? { recordVideo: { dir: h.out, size: viewport } } : {}) });
  await ctx.addInitScript(([s, gl]) => {
    if (!sessionStorage.getItem('e2e-seeded')) {
      sessionStorage.setItem('e2e-seeded', '1');
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }
    if (!gl) {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(type) ? null : get.call(this, type, ...rest);
      };
    }
  }, [seed, webgl]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !NOISE.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
  return { ctx, page, errors };
}

const ready = (page, timeout = 30000) => page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout });
const tagOf = (page) => page.evaluate(() => document.querySelector('meta[name=x-build]')?.content ?? null);
const versionCaches = (page, prefix) => page.evaluate((p) => caches.keys().then((k) => k.filter((n) => n.startsWith(p))), prefix);

async function active(page, d, sleep) {
  const meta = swConst(d.dir, 'META');
  for (let i = 0; i < 300; i++) {
    const cur = await page.evaluate(async (m) => (navigator.serviceWorker.controller ? (await (await caches.open(m)).match('current'))?.text() : null), meta);
    if (cur === d.cache) return;
    await sleep(200);
  }
  throw new Error(`the ${d.tag} worker never took over`);
}

const update = (page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const found = new Promise((res) => reg.addEventListener('updatefound', () => res(reg.installing), { once: true }));
    await reg.update().catch(() => {});
    const w = await Promise.race([found, new Promise((res) => setTimeout(() => res(null), 8000))]);
    if (!w) return 'none';
    return new Promise((res) => {
      const done = () => (w.state === 'redundant' || w.state === 'activated') && res(w.state);
      w.addEventListener('statechange', done);
      done();
      setTimeout(() => res('stuck: ' + w.state), 60000);
    });
  });

function run(args, { env = {}, timeoutMs = 240000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, timeoutMs);
    const alive = () => { try { process.kill(-child.pid, 0); return true; } catch { return false; } };
    child.on('exit', async (code) => {
      clearTimeout(t);

      for (let i = 0; i < 30 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
      const leaked = alive();
      if (leaked) process.kill(-child.pid, 'SIGKILL');
      resolve({ code, timedOut, leaked, out });
    });
  });
}

async function closingCards(page, sleep) {

  const note = page.getByRole('button', { name: 'Read the note' });
  await note.waitFor({ timeout: 60000 });
  for (let i = 0; i < 40 && (await page.locator('.rw').count()); i++) {
    await note.click({ timeout: 2000 }).catch(() => {});
    await sleep(500);
  }
  await page.getByRole('button', { name: 'Continue' }).click({ timeout: 20000 });
  await page.getByRole('button', { name: 'Enter the Lantern' }).click({ timeout: 20000 });
}

async function startIntro(page, sleep) {
  await page.locator('.title-screen').waitFor({ timeout: 20000 });
  await sleep(1500);
  await page.mouse.click(195, 500);
  await page.getByRole('button', { name: 'Skip' }).click({ timeout: 20000 });
}

export const scenarios = {

  async 'pwa-broken-deploy-kept-out'(h) {
    const { shared, sleep, shot, expect } = h;
    const base = await build(shared);
    const v1 = deploy(base, 'v1');
    const srv = await host(v1.dir);
    const { ctx, page, errors } = await context(h, { webgl: false });
    const jsType = MIME['.js'];
    try {
      await page.goto(srv.url + '?mute');
      await ready(page);
      await active(page, v1, sleep);
      const prefix = swConst(v1.dir, 'PREFIX');

      const victims = [v1.file(/^director-.*\.js$/), v1.file(/\.css$/), 'fonts/jost.woff2', 'models/hero.glb', v1.file(/\.png$/, 'icons'), 'manifest.webmanifest'];
      const listed = JSON.parse(fs.readFileSync(path.join(v1.dir, 'sw.js'), 'utf8').match(/const ASSETS = (\[.*?\]);/s)[1]);
      for (const ext of new Set(listed.map((f) => path.extname(f)))) expect(victims.some((v) => v.endsWith(ext)), `no broken-deploy case for precached ${ext} files`);
      for (const file of victims) {
        const bad = deploy(base, 'broken-' + path.extname(file).slice(1));
        fs.rmSync(path.join(bad.dir, file));
        srv.use(bad.dir);
        const answer = await fetch(srv.url + file);
        expect(answer.status === 200 && /text\/html/.test(answer.headers.get('content-type')), `the host should answer the missing ${file} with its page`);
        const state = await update(page);
        expect(state === 'redundant', `a deploy whose ${file} came back as HTML ended "${state}", not rejected`);
        expect(!(await versionCaches(page, prefix)).includes(bad.cache), `the broken deploy without ${file} left a cache behind`);
      }
      srv.use(v1.dir);
      await ctx.setOffline(true);
      await page.reload();
      await ready(page);
      expect((await tagOf(page)) === 'v1', 'the reload did not come from the working version');
      const magic = await page.evaluate(() => fetch('models/hero.glb').then((r) => r.arrayBuffer()).then((b) => String.fromCharCode(...new Uint8Array(b, 0, 4))));
      expect(magic === 'glTF', `the cached character model starts with "${magic}", not glTF`);
      await shot(page, 'pwa-01-working-version-after-broken-deploys');
      await ctx.setOffline(false);
      const v2 = deploy(base, 'v2', { rename: true });
      MIME['.js'] = 'text/javascript1.5; charset=utf-8';
      srv.use(v2.dir);
      const good = await update(page);
      expect(good === 'activated', `a complete deploy ended "${good}" instead of installing`);
      await active(page, v2, sleep);
      await page.reload();
      await ready(page);
      await page.locator('.title-screen').waitFor({ timeout: 20000 });
      expect(await tagOf(page) === 'v2', 'the valid legacy JavaScript MIME type did not boot');
      expect(!errors.length, errors.join('\n'));
    } finally {
      MIME['.js'] = jsType;
      await ctx.close();
      await srv.close();
    }
  },

  async 'pwa-broken-model-intro-finishes'(h) {
    const { shared, sleep, shot, expect, reachHub } = h;
    const base = await build(shared);
    const d = deploy(base, 'no-model');
    fs.rmSync(path.join(d.dir, 'models/hero.glb'));
    const srv = await host(d.dir);
    const { ctx, page, errors } = await context(h, { sw: false });
    try {
      await page.goto(srv.url + '?mute');
      await ready(page);
      expect(await page.evaluate(() => !!window.__stage), 'this check needs the WebGL stage');
      await startIntro(page, sleep);
      await page.locator('.rw-card').first().waitFor({ timeout: 25000 }).catch(async (e) => { await shot(page, 'fail-broken-model'); throw e; });
      await sleep(3500);
      await shot(page, 'pwa-02-broken-model-reward-cards');
      await closingCards(page, sleep);
      await reachHub(page);
      expect(JSON.parse(await page.evaluate(() => localStorage.getItem('dbt.app.v1'))).seenCutscene === true, 'the intro was not marked as seen');
      await shot(page, 'pwa-03-broken-model-companion');
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },

  async 'pwa-old-title-two-updates'(h) {
    const { shared, sleep, shot, expect } = h;
    const base = await build(shared);
    const [v1, v2, v3] = [deploy(base, 'v1'), deploy(base, 'v2', { rename: true }), deploy(base, 'v3', { rename: true })];
    const srv = await host(v1.dir);
    const { ctx, page, errors } = await context(h);
    try {
      await page.goto(srv.url + '?mute');
      await ready(page);
      await active(page, v1, sleep);

      await page.evaluate((m) => caches.open(m).then((c) => c.delete('versions')), swConst(v1.dir, 'META'));
      for (const v of [v2, v3]) {
        srv.use(v.dir);
        const state = await update(page);
        expect(state === 'activated', `${v.tag} ended "${state}"`);
        await active(page, v, sleep);
      }
      const kept = await versionCaches(page, swConst(v1.dir, 'PREFIX'));
      await ctx.setOffline(true);
      expect((await tagOf(page)) === 'v1', 'the open page should still be the first version');
      await startIntro(page, sleep);
      await page.getByText(/Wanderer:/).first().waitFor({ timeout: 25000 }).catch(async (e) => { await shot(page, 'fail-old-title'); throw e; });
      await shot(page, 'pwa-04-old-title-intro-offline');
      expect([v1, v2, v3].every((v) => kept.includes(v.cache)), 'a version still in use was deleted: ' + kept.join(' '));
      const daily = v1.file(/^daily-.*\.js$/);
      const r = await page.evaluate((f) => fetch(f).then((x) => `${x.status} ${x.headers.get('content-type')}`, (e) => 'failed ' + e.message), daily);
      expect(/^200 .*javascript/.test(r), `the open page's own companion file is gone offline: ${r}`);
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },

  async 'pwa-old-page-offers-reload'(h) {
    const { shared, sleep, shot, expect, reachHub } = h;
    const base = await build(shared);
    const vs = [deploy(base, 'v1'), ...['v2', 'v3', 'v4'].map((t) => deploy(base, t, { rename: true }))];
    const prefix = swConst(vs[0].dir, 'PREFIX');
    const srv = await host(vs[0].dir);
    const ageThrough = async (page) => {
      srv.use(vs[0].dir);
      await page.goto(srv.url + '?mute');
      await ready(page);
      await active(page, vs[0], sleep);
      for (const v of vs.slice(1)) {
        srv.use(v.dir);
        const state = await update(page);
        expect(state === 'activated', `${v.tag} ended "${state}"`);
        await active(page, v, sleep);
      }
      const kept = await versionCaches(page, prefix);
      return kept;
    };
    const offer = async (page, name) => {
      let navs = 0;
      page.on('framenavigated', (f) => f === page.mainFrame() && navs++);
      await page.getByText('A new version of the Lantern is ready').waitFor({ timeout: 25000 }).catch(async (e) => { await shot(page, 'fail-' + name); throw e; });
      await sleep(2500);
      expect(navs === 0, 'the page reloaded without being asked');
      await shot(page, name);
      return page.getByRole('button', { name: 'Reload' });
    };

    const a = await context(h);
    try {
      const kept = await ageThrough(a.page);
      await a.ctx.setOffline(true);
      await startIntro(a.page, sleep);
      const btn = await offer(a.page, 'pwa-05-reload-offer-390x844');
      expect(kept.length === 3 && !kept.includes(vs[0].cache), 'the worker should keep exactly the newest three versions: ' + kept.join(' '));
      for (const [w, ht] of [[320, 568], [844, 390]]) {
        await a.page.setViewportSize({ width: w, height: ht });
        await sleep(600);
        await shot(a.page, `pwa-05-reload-offer-${w}x${ht}`);
      }
      await a.page.setViewportSize({ width: 390, height: 844 });
      await Promise.all([a.page.waitForEvent('load'), btn.click()]);
      await ready(a.page);
      expect((await tagOf(a.page)) === 'v4', 'the reload did not open the newest version');
      await a.page.locator('.title-screen').waitFor({ timeout: 20000 });
      await shot(a.page, 'pwa-06-after-reload-title');
      expect(!a.errors.length, a.errors.join('\n'));
    } finally {
      await a.ctx.close();
    }

    const b = await context(h, { webgl: false, reducedMotion: 'reduce' });
    try {
      await ageThrough(b.page);
      await b.ctx.setOffline(true);
      await startIntro(b.page, sleep);
      await closingCards(b.page, sleep);
      const btn = await offer(b.page, 'pwa-07-reload-offer-no-webgl');
      await Promise.all([b.page.waitForEvent('load'), btn.click()]);
      await ready(b.page);
      expect((await tagOf(b.page)) === 'v4', 'the reload did not open the newest version');
      await reachHub(b.page);
      await shot(b.page, 'pwa-08-after-reload-companion');
      expect(!b.errors.length, b.errors.join('\n'));
    } finally {
      await b.ctx.close();
      await srv.close();
    }
  },

  async 'pwa-updates-leave-open-work-alone'(h) {
    const { shared, sleep, expect, reachHub, shot, YOU, SEEN } = h;
    const base = await build(shared);
    const vs = ['v1', 'v2', 'v3', 'v4'].map((tag, i) => deploy(base, tag, { rename: i > 0 }));
    const srv = await host(vs[0].dir);
    const { ctx, page, errors } = await context(h, { seed: { [YOU]: KIT, 'dbt.app.v1': SEEN } });
    try {
      await page.goto(srv.url + '?mute');
      await ready(page);
      await reachHub(page);
      await active(page, vs[0], sleep);
      await sleep(1500);
      await reachHub(page);
      let navigations = 0;
      page.on('framenavigated', (f) => f === page.mainFrame() && navigations++);
      const advance = async (i, screen) => {
        srv.use(vs[i].dir);
        expect(await update(page) === 'activated', `update ${i} did not activate`);
        await active(page, vs[i], sleep);
        await sleep(600);
        expect(navigations === 0, `an update navigated away from ${screen}`);
        expect(await page.locator(`[data-screen="${screen}"]`).count() === 1, `an update left ${screen}`);
        expect(await page.getByRole('button', { name: 'Reload', exact: true }).count() === 0, `an update interrupted ${screen} with a reload offer`);
      };
      await page.getByRole('button', { name: /Diary card/ }).click();
      const note = page.getByLabel('One line, optional');
      await note.fill('A quiet afternoon.');
      await advance(1, 'diary');
      expect(await note.inputValue() === 'A quiet afternoon.', 'the update changed the diary note');
      await page.locator('.dq-back').click();
      await page.getByRole('button', { name: /Art room/ }).click();
      await page.locator('.dq-artentry--today').click();
      const canvas = page.locator('.dq-ink-live');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + 30, box.y + 30);
      await page.mouse.down();
      await page.mouse.move(box.x + 90, box.y + 90, { steps: 8 });
      await page.mouse.up();
      await sleep(400);
      const ink = await page.locator('.dq-ink-ink').evaluate((c) => c.toDataURL());
      await advance(2, 'draw');
      expect(await page.locator('.dq-ink-ink').evaluate((c) => c.toDataURL()) === ink, 'an update changed the drawing');
      await page.getByRole('button', { name: 'Safe Zone, help right now' }).click();
      await advance(3, 'safe');
      expect(await page.getByText('Talk to someone now', { exact: true }).isVisible(), 'the help link is missing after an update');
      await shot(page, 'pwa-12-safe-zone-through-three-updates');
      await page.getByRole('button', { name: 'Leave', exact: true }).click();
      await reachHub(page);
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
      await srv.close();
    }
  },

  async 'pwa-fonts-slow-or-failing'(h) {
    const { shared, sleep, shot, expect, openSettings, YOU, SEEN, out } = h;
    const fontShot = async (page, name) => {
      const session = await page.context().newCDPSession(page);
      try {
        const { data } = await session.send('Page.captureScreenshot');
        fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(data, 'base64'));
      } finally {
        await session.detach();
      }
    };
    const base = await build(shared);
    const srv = await host(base);
    const returning = { [YOU]: KIT, 'dbt.app.v1': SEEN };
    try {

      const held = [];
      const a = await context(h, { sw: false, seed: returning });
      try {
        await a.ctx.route('**/fonts/*.woff2', (r) => held.push(r));
        const t0 = Date.now();
        await a.page.goto(srv.url + '?mute', { waitUntil: 'commit' });
        await ready(a.page, 10000).catch(async (e) => { await fontShot(a.page, 'fail-fonts-held'); throw e; });
        expect(Date.now() - t0 < 10000, 'the boot waited too long for fonts');
        expect(held.length > 0, 'no font request was held');
        const display = await a.page.evaluate(() => [...document.fonts].map((f) => f.display));
        expect(display.length && display.every((d) => d === 'swap'), 'font faces should swap in late: ' + display.join(' '));
        await openSettings(a.page);
        await sleep(500);
        await fontShot(a.page, 'pwa-09-fonts-held-fallback');
        for (const r of held) await r.continue().catch(() => {});
        await a.page.waitForFunction(() => document.fonts.check('16px Jost') && document.fonts.check('700 16px "Bodoni Moda"'), null, { timeout: 20000 });
        await sleep(500);
        const fit = await a.page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, field: document.querySelector('#set-playerName')?.getBoundingClientRect().right ?? 0 }));
        expect(fit.over <= 0 && fit.field <= 390, 'late fonts pushed the layout past the screen: ' + JSON.stringify(fit));
        await shot(a.page, 'pwa-10-fonts-arrived-late');
        expect(!a.errors.length, a.errors.join('\n'));
      } finally {
        await a.ctx.close();
      }

      const b = await context(h, { sw: false });
      try {
        await b.ctx.route('**/fonts/*.woff2', () => {});
        await b.page.goto(srv.url + '?mute', { waitUntil: 'commit' });
        await ready(b.page, 10000);
        await startIntro(b.page, sleep);
        await b.page.locator('#np-name').waitFor({ state: 'detached', timeout: 5000 });
        expect(!b.errors.length, b.errors.join('\n'));
      } finally {
        await b.ctx.close();
      }

    } finally {
      await srv.close();
    }
  },

  async 'pwa-fonts-aborted-still-opens'(h) {
    const { shared, shot, expect, openSettings, YOU, SEEN } = h;
    const srv = await host(await build(shared));
    try {
      const c = await context(h, { sw: false, seed: { [YOU]: KIT, 'dbt.app.v1': SEEN } });
      try {
        await c.ctx.route('**/fonts/*.woff2', (r) => r.abort('failed'));
        await c.page.goto(srv.url + '?mute', { waitUntil: 'commit' });
        await ready(c.page, 10000).catch(async (e) => { await shot(c.page, 'fail-fonts-failed'); throw e; });
        await openSettings(c.page);
        await shot(c.page, 'pwa-11-fonts-failed');
        expect(!c.errors.length, c.errors.join('\n'));
      } finally {
        await c.ctx.close();
      }
    } finally {
      await srv.close();
    }
  },

};

export const checks = {
  async 'pwa-fixture-keeps-files-contained'({ shared, expect, out }) {
    const base = await build(shared);
    const outside = path.join(scratchDir(), 'outside.txt');
    fs.writeFileSync(outside, 'outside-fixture-root');
    const link = path.join(base, 'outside-link.txt');
    fs.symlinkSync(outside, link);
    const srv = await host(base);
    const request = (suffix) => new Promise((resolve, reject) => {
      const req = http.get(srv.url + suffix, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (s) => (body += s));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('fixture request timed out')));
    });
    try {
      const probes = [];
      for (const suffix of ['..%2foutside.txt', 'assets/..%2f..%2foutside.txt', 'outside-link.txt']) {
        const answer = await request(suffix);
        probes.push({ path: suffix, ...answer });
      }
      fs.writeFileSync(path.join(out, 'pwa-fixture-boundary.json'), JSON.stringify(probes, null, 2));
      expect(probes.every((r) => r.status === 403 && !r.body.includes('outside-fixture-root')), 'a request escaped the fixture root: ' + JSON.stringify(probes));
      expect((await request('%zz')).status === 400, 'malformed encoding should be refused');
      expect((await request('%00')).status === 400, 'a null byte should be refused');
      expect((await request('')).status === 200, 'the fixture did not keep serving the game');
    } finally {
      await srv.close();
      fs.rmSync(link);
    }
  },


  async 'pwa-csp-check-fails-loudly'({ shared, expect, out }) {
    const base = await build(shared);
    const inline = path.join(scratchDir(), 'csp-inline');
    fs.rmSync(inline, { recursive: true, force: true });
    fs.cpSync(base, inline, { recursive: true });
    const html = path.join(inline, 'index.html');
    fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('</head>', '<script>window.__inline = 1;</script>\n  </head>'));

    const p1 = await freePort();
    const csp = await run(['scripts/pwa-csp-sweep.mjs', `--dist=${inline}`, '--seconds=0', `--port=${p1}`]);
    fs.writeFileSync(path.join(out, 'pwa-csp-sweep-inline.log'), csp.out);
    expect(!csp.timedOut && !csp.leaked, `the CSP sweep hung or left a process (timed out ${csp.timedOut}, leaked ${csp.leaked})`);
    expect(csp.code === 1 && /script-src/.test(csp.out), `the CSP sweep exited ${csp.code} on an inline script`);
    expect(await portFree(p1), 'the CSP sweep left its preview running');

  },

  async 'pwa-browser-failure-cleans-up'({ shared, expect, out }) {
    const base = await build(shared);
    const none = path.join(scratchDir(), 'no-browsers');
    fs.mkdirSync(none, { recursive: true });
    for (const mode of [[], ['--update']]) {
      const tmp = fs.mkdtempSync(path.join(scratchDir(), 'tmp-'));
      const p2 = await freePort();
      const v = await run(['scripts/pwa-verify.mjs', '--browser=chromium', `--dist=${base}`, `--out=${path.join(scratchDir(), 'pv')}`, `--port=${p2}`, ...mode], { env: { PLAYWRIGHT_BROWSERS_PATH: none, TMPDIR: tmp, FORCE_COLOR: '1', NO_COLOR: undefined }, timeoutMs: 30000 });
      fs.writeFileSync(path.join(out, `pwa-verify-no-browser${mode.join('')}.log`), v.out);
      expect(!v.timedOut && !v.leaked, `pwa-verify ${mode.join(' ')} hung or left a process (timed out ${v.timedOut}, leaked ${v.leaked})`);
      expect(v.code === 1, `pwa-verify ${mode.join(' ')} exited ${v.code} when the browser could not start`);
      const ports = [...v.out.matchAll(/preview: http:\/\/127\.0\.0\.1:(\d+)\//g)].map((m) => Number(m[1]));
      expect(ports.length > 0 && /browserType\.launch/.test(v.out), 'the check did not reach the forced browser launch failure');
      for (const port of ports) expect(await portFree(port), `pwa-verify ${mode.join(' ')} left its preview running on ${port}`);
      if (mode.length) {
        const used = v.out.match(/scratch: (.+)/)?.[1]?.trim();
        expect(used && used.startsWith(tmp + path.sep), `pwa-verify --update should build its versions under TMPDIR, used ${used}`);
        expect(!fs.existsSync(used), 'pwa-verify --update left its scratch folder behind');
      }
    }
  },

  async 'pwa-firefox-no-storage-prompt'({ shared, sleep, expect, SEEN }) {
    const base = await build(shared);
    const srv = await host(base);
    const browser = await firefox.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(([you, seen]) => {
        localStorage.setItem('dbt.you.v1', you);
        localStorage.setItem('dbt.app.v1', seen);
        window.__persistCalls = 0;
        const orig = navigator.storage.persist.bind(navigator.storage);
        navigator.storage.persist = () => (window.__persistCalls++, orig());
      }, [KIT, SEEN]);
      const page = await ctx.newPage();
      await page.goto(srv.url + '?mute');
      await ready(page);
      await page.locator('.dq-tile').first().waitFor({ timeout: 30000 });
      await sleep(3000);
      const r = await page.evaluate(async () => ({ calls: window.__persistCalls, permission: (await navigator.permissions.query({ name: 'persistent-storage' })).state }));

      expect(r.permission === 'prompt', 'this Firefox would not prompt, so the check proves nothing: ' + r.permission);
      expect(r.calls === 0, `the app called storage.persist() ${r.calls} times in Firefox, which shows a permission prompt`);
      await ctx.close();
    } finally {
      await browser.close();
      await srv.close();
    }
  },
};

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const out = path.join(root, 'artifacts/e2e', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out, { recursive: true });
  const h = { shared: {}, out, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), expect: (ok, message) => { if (!ok) throw new Error(message); }, YOU: 'dbt.you.v1', SEEN: JSON.stringify({ seenCutscene: true }) };
  const results = [];
  const pick = process.argv.find((a) => a.startsWith('--check='))?.slice('--check='.length);
  if (pick && !Object.hasOwn(checks, pick)) throw new Error('no check ' + pick);
  for (const [name, run] of Object.entries(checks).filter(([name]) => !pick || name === pick)) {
    try { await run(h); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: String(e?.message ?? e) }); }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ scenarios: results }, null, 2));
  console.log(JSON.stringify({ out, scenarios: results }, null, 2));
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
}
