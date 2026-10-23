// End-to-end proof that the built app installs its service worker, boots offline, and updates quietly.
// node scripts/pwa-verify.mjs [--dist=dist] [--path=<subpath to serve it under, e.g. /dbt-skills-game/>] [--video] [--browser=chromium|webkit|both] [--out=qa/out/pwa/verify] [--update] [--check]
// Starts its own `vite preview` on a free port (4173 and up) and stops only that process.
// --check exits 1 if the report shows a problem.
import { chromium, webkit } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const dist = path.resolve(root, flags.dist ?? 'dist');
const out = path.resolve(root, flags.out ?? 'qa/out/pwa/verify');
const sub = (flags.path ?? '').replace(/^\/+|\/+$/g, '');
const mount = sub ? `/${sub}/` : '/';
const browsers = flags.browser === 'both' || !flags.browser ? ['chromium', 'webkit'] : [flags.browser];
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const swInfo = (dir) => {
  const src = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
  return { version: JSON.parse(src.match(/const VERSION = (".*?");/)[1]), assets: JSON.parse(src.match(/const ASSETS = (\[.*?\]);/s)[1]) };
};
const portFree = (p) => new Promise((res) => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1'); });

async function serve(dir, port) {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', dir, '--base', mount], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${mount}`);
      if (r.ok) return { child, stop: () => new Promise((res) => { child.once('exit', res); child.kill('SIGTERM'); }) };
    } catch {}
    await sleep(150);
  }
  child.kill('SIGTERM');
  throw new Error('preview did not start:\n' + log);
}

async function pickPort() {
  for (let p = Number(flags.port ?? 4173); p < 4200; p++) if (await portFree(p)) return p;
  throw new Error('no free port');
}

const watch = (page, bucket) => {
  page.on('pageerror', (e) => bucket.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && bucket.errors.push('console: ' + m.text().slice(0, 300)));
  page.on('requestfailed', (r) => bucket.failed.push(r.url() + ' ' + (r.failure()?.errorText ?? '')));
  page.on('response', (r) => bucket.responses.push({ url: r.url(), status: r.status(), sw: r.fromServiceWorker() }));
};
const bucket = () => ({ errors: [], failed: [], responses: [] });
const INIT = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  window.__controllerChanges = 0;
  navigator.serviceWorker?.addEventListener('controllerchange', () => window.__controllerChanges++);
};
const ready = (page, ms = 30000) => page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: ms });
const cacheState = (page) =>
  page.evaluate(async () => {
    const names = await caches.keys();
    const out = {};
    for (const n of names) out[n] = (await (await caches.open(n)).keys()).length;
    const meta = names.includes('system-meta') ? await caches.open('system-meta') : null;
    const cur = meta ? await (await meta.match('current'))?.text() : null;
    const prev = meta ? await (await meta.match('previous'))?.text() : null;
    return { caches: out, current: cur, previous: prev, controlled: !!navigator.serviceWorker.controller };
  });
// page.waitForFunction does not await async predicates, so poll from Node
async function waitInstalled(page, version, count, timeout = 90000) {
  const t0 = Date.now();
  for (;;) {
    const ok = await page.evaluate(async ([v, n]) => {
      const name = 'system-v' + v;
      if (!(await caches.has(name)) || !(await caches.has('system-meta'))) return false;
      const k = await (await caches.open(name)).keys();
      const cur = await (await (await caches.open('system-meta')).match('current'))?.text();
      return k.length >= n && cur === name && !!navigator.serviceWorker.controller;
    }, [version, count]);
    if (ok) return Date.now() - t0;
    if (Date.now() - t0 > timeout) throw new Error(`service worker ${version} not installed after ${timeout} ms`);
    await sleep(250);
  }
}

const pngSize = (buf) => (buf.readUInt32BE(0) === 0x89504e47 ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : 'not a png');

async function checkManifest(page, base, ctx) {
  const url = new URL('manifest.webmanifest', base).href;
  const res = await fetch(url);
  const m = await res.json();
  const problems = [];
  const want = { name: 'The Lantern', short_name: 'Lantern', display: 'standalone', start_url: './', scope: './', orientation: 'any' };
  for (const [k, v] of Object.entries(want)) if (m[k] !== v) problems.push(`${k} is ${JSON.stringify(m[k])}, want ${JSON.stringify(v)}`);
  for (const k of ['background_color', 'theme_color']) if (String(m[k]).toLowerCase() !== '#07080f') problems.push(`${k} is ${m[k]}`);
  const icons = [];
  for (const i of m.icons ?? []) {
    const r = await fetch(new URL(i.src, url));
    const actual = r.ok ? pngSize(Buffer.from(await r.arrayBuffer())) : `HTTP ${r.status}`;
    if (actual !== i.sizes) problems.push(`${i.src} is ${actual}, manifest says ${i.sizes}`);
    icons.push(`${i.src} ${i.sizes} ${i.purpose ?? 'any'} -> ${actual}`);
  }
  for (const need of ['192x192 any', '512x512 any', '512x512 maskable']) if (!(m.icons ?? []).some((i) => `${i.sizes} ${i.purpose ?? 'any'}` === need)) problems.push('missing icon ' + need);
  const head = await page.evaluate(() => ({
    appleIcon: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('sizes'),
    capable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content,
    statusBar: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.content,
    title: document.querySelector('meta[name=apple-mobile-web-app-title]')?.content,
    robots: document.querySelector('meta[name=robots]')?.content,
    csp: !!document.querySelector('meta[http-equiv=Content-Security-Policy]'),
    splash: [...document.querySelectorAll('link[rel=apple-touch-startup-image]')].map((l) => l.getAttribute('href')),
  }));
  const splashMissing = [];
  for (const href of head.splash) {
    const r = await fetch(new URL(href, base));
    const buf = Buffer.from(await r.arrayBuffer());
    const [w, h] = href.match(/(\d+)x(\d+)\.png$/).slice(1);
    if (!r.ok || pngSize(buf) !== `${w}x${h}`) splashMissing.push(href);
  }
  let chromium = null;
  if (ctx) {
    const cdp = await ctx.newCDPSession(page);
    const am = await cdp.send('Page.getAppManifest');
    const inst = await cdp.send('Page.getInstallabilityErrors').catch((e) => ({ error: e.message }));
    chromium = { manifestErrors: am.errors, installabilityErrors: inst.installabilityErrors ?? inst };
  }
  return { problems, icons, head: { ...head, splash: head.splash.length }, splashMissing, chromium };
}

async function offlineRun(name, launcher) {
  const report = { browser: name, steps: {} };
  const { version, assets } = swInfo(dist);
  const port = await pickPort();
  let srv = await serve(dist, port);
  const base = `http://127.0.0.1:${port}${mount}`;
  const browser = await launcher.launch({ headless: true, args: name === 'chromium' ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] : [] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, serviceWorkers: 'allow', ...(flags.video ? { recordVideo: { dir: `${out}/video-${name}`, size: { width: 375, height: 800 } } } : {}) });
  await ctx.addInitScript(INIT);
  const tStart = Date.now();
  const marks = (report.marks = []);
  const mark = (label) => marks.push({ t: (Date.now() - tStart) / 1000, label });
  try {
    const page = await ctx.newPage();
    mark('online: first visit');
    let b = bucket();
    watch(page, b);
    await page.goto(base);
    await ready(page);
    const installMs = await waitInstalled(page, version, assets.length + 1);
    mark('service worker installed, ' + (assets.length + 1) + ' files cached');
    await page.waitForTimeout(1500);
    report.steps.online = { swVersion: version, precached: assets.length + 1, installMs, ...(await cacheState(page)), csp: await page.evaluate(() => window.__csp), errors: b.errors };
    await page.screenshot({ path: `${out}/${name}-1-online.png` });
    report.steps.manifest = await checkManifest(page, base, name === 'chromium' ? ctx : null);

    await srv.stop();
    srv = null;
    await ctx.setOffline(true);
    mark('server stopped + offline: reload');
    let serverGone = false;
    try { await fetch(base); } catch { serverGone = true; }

    b = bucket();
    watch(page, b);
    await page.reload();
    await ready(page);
    await page.waitForTimeout(2500);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      // ask for every face while offline, as the cutscene and end card will
      await Promise.all([document.fonts.load('500 16px Jost'), document.fonts.load('italic 600 16px Jost'), document.fonts.load('600 32px "Bodoni Moda"')]);
      return { loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.style}`), jost: document.fonts.check('500 16px Jost'), jostItalic: document.fonts.check('italic 600 16px Jost'), bodoni: document.fonts.check('600 32px "Bodoni Moda"') };
    });
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\.(js|css|woff2)$/.test(new URL(e.name).pathname)).map((e) => new URL(e.name).pathname));
    await page.screenshot({ path: `${out}/${name}-2-offline-reload.png` });
    report.steps.offlineReload = {
      serverGone,
      ready: true,
      fonts,
      resources: scripts,
      allFromSW: b.responses.every((r) => r.sw || r.url.startsWith('data:') || r.url.startsWith('blob:')),
      notFromSW: b.responses.filter((r) => !r.sw && !/^(data|blob):/.test(r.url)).map((r) => r.url),
      failed: b.failed,
      csp: await page.evaluate(() => window.__csp),
      errors: b.errors,
    };

    // a fresh document in the same profile: what a cold Home Screen launch does
    mark('offline: fresh launch (new page)');
    const cold = await ctx.newPage();
    b = bucket();
    watch(cold, b);
    await cold.goto(base);
    await ready(cold);
    await cold.waitForTimeout(2000);
    await cold.screenshot({ path: `${out}/${name}-3-offline-cold.png` });
    report.steps.offlineCold = { ready: true, failed: b.failed, errors: b.errors, notFromSW: b.responses.filter((r) => !r.sw && !/^(data|blob):/.test(r.url)).map((r) => r.url) };

    // a lazily loaded chunk with its own CSS (lab pages are never loaded online in this run)
    b = bucket();
    watch(cold, b);
    mark('offline: lazy chunk (?lab=window)');
    await cold.goto(base + '?lab=window');
    await ready(cold);
    await cold.waitForTimeout(2500);
    await cold.screenshot({ path: `${out}/${name}-4-offline-lazy-chunk.png` });
    report.steps.offlineLazyChunk = { ready: true, chunks: b.responses.filter((r) => /\/assets\//.test(r.url)).map((r) => `${new URL(r.url).pathname} ${r.status}${r.sw ? ' sw' : ''}`), failed: b.failed, errors: b.errors };
  } finally {
    await browser.close();
    if (srv) await srv.stop();
  }
  return report;
}

function makeBroken(from, to) {
  // a half-finished upload: sw.js lists a file the host no longer has, so the host answers with its HTML fallback
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  const html = path.join(to, 'index.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<title>', '<meta name="x-build" content="broken" />\n    <title>'));
  execFileSync(process.execPath, [path.join(root, 'scripts/sw-build.mjs'), to], { stdio: 'pipe' });
  const victim = fs.readdirSync(path.join(to, 'assets')).find((f) => /^window-.*\.js$/.test(f));
  fs.rmSync(path.join(to, 'assets', victim));
  return { dir: to, victim, ...swInfo(to) };
}

function makeVersion(from, to, tag, renameChunk) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  const html = path.join(to, 'index.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<title>', `<meta name="x-build" content="${tag}" />\n    <title>`));
  let renamed = null;
  if (renameChunk) {
    const assets = path.join(to, 'assets');
    const old = fs.readdirSync(assets).find((f) => /^window-.*\.js$/.test(f));
    const neu = old.replace('window-', `window-${tag}`);
    fs.renameSync(path.join(assets, old), path.join(assets, neu));
    for (const f of fs.readdirSync(assets).filter((f) => f.endsWith('.js'))) {
      const p = path.join(assets, f);
      const s = fs.readFileSync(p, 'utf8');
      if (s.includes(old)) fs.writeFileSync(p, s.split(old).join(neu));
    }
    renamed = { old, neu };
  }
  execFileSync(process.execPath, [path.join(root, 'scripts/sw-build.mjs'), to], { stdio: 'pipe' });
  return { dir: to, renamed, ...swInfo(to) };
}

// asks the app's own register module (same instance the app loaded) whether it saw a background update
const updateReadyFired = (page) =>
  page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/assets\/register-[^/]+\.js$/.test(n));
    if (!url) return 'register module not loaded';
    const m = await import(url);
    return new Promise((res) => {
      m.onUpdateReady(() => res(true));
      setTimeout(() => res(false), 400);
    });
  });

async function updateRun(name, launcher) {
  const report = { browser: name, steps: {} };
  const v1 = { dir: dist, ...swInfo(dist) };
  const scratch = fs.mkdtempSync(path.join(tmpdir(), 'lantern-pwa-'));
  const v2 = makeVersion(dist, path.join(scratch, 'v2'), 'v2', true);
  const v3 = makeVersion(v2.dir, path.join(scratch, 'v3'), 'v3', false);
  const port = await pickPort();
  const base = `http://127.0.0.1:${port}${mount}`;
  let srv = await serve(v1.dir, port);
  const browser = await launcher.launch({ headless: true, args: name === 'chromium' ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] : [] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, serviceWorkers: 'allow' });
  await ctx.addInitScript(INIT);
  try {
    const page = await ctx.newPage();
    const b = bucket();
    watch(page, b);
    await page.goto(base);
    await ready(page);
    await waitInstalled(page, v1.version, v1.assets.length + 1);
    // nothing has loaded the window lab chunk yet; only the precache holds it
    report.steps.v1 = { ...(await cacheState(page)), onUpdateReadyFired: await updateReadyFired(page) };

    const bad = makeBroken(dist, path.join(scratch, 'broken'));
    await srv.stop();
    srv = await serve(bad.dir, port);
    const victimStatus = await fetch(base + 'assets/' + bad.victim).then(async (r) => `${r.status} ${r.headers.get('content-type')}`);
    const updateResult = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => 'resolved', (e) => 'rejected: ' + e.message));
    await page.waitForTimeout(4000);
    const afterBad = await cacheState(page);
    await page.reload();
    await ready(page);
    report.steps.brokenDeploy = {
      victim: bad.victim,
      hostAnswersMissingFileWith: victimStatus,
      updateCall: updateResult,
      brokenCacheCreated: Object.keys(afterBad.caches).includes('system-v' + bad.version),
      stillCurrent: afterBad.current,
      reloadShows: await page.evaluate(() => document.querySelector('meta[name=x-build]')?.content ?? 'v1'),
    };

    await srv.stop();
    srv = await serve(v2.dir, port);
    const gone = await fetch(base + 'assets/' + v2.renamed.old).then((r) => r.status);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await waitInstalled(page, v2.version, v2.assets.length + 1);
    await page.waitForTimeout(500);
    const still = await page.evaluate(() => ({ build: document.querySelector('meta[name=x-build]')?.content ?? 'v1', controllerChanges: window.__controllerChanges }));
    still.onUpdateReadyFired = await updateReadyFired(page);
    // the open v1 page lazy-loads its own (now deleted on the server) chunk through the new worker
    await srv.stop();
    srv = null;
    await ctx.setOffline(true);
    const lazy = await page.evaluate(async (f) => {
      try {
        await import(`./assets/${f}`);
        return 'loaded';
      } catch (e) {
        return 'failed: ' + e.message;
      }
    }, v2.renamed.old);
    report.steps.v2Installed = { oldChunkOnServer: gone, pageStillOn: still.build, controllerChanges: still.controllerChanges, onUpdateReadyFired: still.onUpdateReadyFired, oldPageLazyChunk: lazy, ...(await cacheState(page)) };

    const nextLaunchErrorStart = b.errors.length;
    await page.reload();
    await ready(page);
    report.steps.nextLaunch = { build: await page.evaluate(() => document.querySelector('meta[name=x-build]')?.content ?? 'v1'), errors: b.errors.slice(nextLaunchErrorStart, nextLaunchErrorStart + 5) };
    await page.screenshot({ path: `${out}/${name}-5-after-update.png` });

    await ctx.setOffline(false);
    srv = await serve(v3.dir, port);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await waitInstalled(page, v3.version, v3.assets.length + 1);
    report.steps.v3Installed = { expectKept: [`system-v${v2.version}`, `system-v${v3.version}`], expectDeleted: `system-v${v1.version}`, ...(await cacheState(page)) };

    const idOnly = path.join(scratch, 'build-id-only');
    fs.cpSync(v3.dir, idOnly, { recursive: true });
    const html = path.join(idOnly, 'index.html');
    fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace(/<meta name="build" content="[^"]*" \/>/, '<meta name="build" content="build-id-only" />'));
    execFileSync(process.execPath, [path.join(root, 'scripts/sw-build.mjs'), idOnly]);
    const next = swInfo(idOnly);
    await srv.stop();
    srv = await serve(idOnly, port);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await waitInstalled(page, next.version, next.assets.length + 1);
    await page.reload();
    await ready(page);
    report.steps.buildIdOnly = { previousVersion: v3.version, version: next.version, served: await page.locator('meta[name=build]').getAttribute('content') };
  } finally {
    await browser.close();
    if (srv) await srv.stop();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return report;
}

const results = [];
for (const name of browsers) {
  const launcher = name === 'webkit' ? webkit : chromium;
  try {
    results.push(flags.update ? await updateRun(name, launcher) : await offlineRun(name, launcher));
  } catch (e) {
    results.push({ browser: name, error: String(e.stack || e).slice(0, 1500) });
  }
}
function problems(r) {
  if (r.error) return [r.error.split('\n')[0]];
  const s = r.steps;
  const list = (label, xs) => (xs?.length ? [`${label}: ${xs.slice(0, 3).join(' | ')}`] : []);
  if (!flags.update) {
    return [
      ...(s.online.controlled ? [] : ['the service worker never took control']),
      ...list('online CSP', s.online.csp), ...list('online errors', s.online.errors),
      ...list('manifest', s.manifest.problems), ...list('missing splash', s.manifest.splashMissing),
      ...list('manifest errors', s.manifest.chromium?.manifestErrors?.map((e) => e.message)), ...list('not installable', s.manifest.chromium?.installabilityErrors?.map((e) => e.errorId)),
      ...(s.offlineReload.serverGone ? [] : ['the server was still up during the offline reload']),
      ...list('offline reload missed the service worker', s.offlineReload.notFromSW), ...list('offline reload failed', s.offlineReload.failed),
      ...list('offline CSP', s.offlineReload.csp), ...list('offline errors', s.offlineReload.errors),
      ...(s.offlineReload.fonts.jost && s.offlineReload.fonts.jostItalic && s.offlineReload.fonts.bodoni ? [] : ['a font did not load offline']),
      ...list('offline cold launch failed', s.offlineCold.failed), ...list('offline cold launch errors', s.offlineCold.errors), ...list('cold launch missed the service worker', s.offlineCold.notFromSW),
      ...list('offline lazy chunk failed', s.offlineLazyChunk.failed), ...list('offline lazy chunk errors', s.offlineLazyChunk.errors),
      ...(s.offlineReload.allFromSW ? [] : ['offline reload left the service worker']),
      ...(s.offlineLazyChunk.chunks.some((c) => /\/window-[^\s]+\.js 200 sw$/.test(c)) ? [] : ['offline window chunk was not served by the service worker']),
    ];
  }
  const v1 = s.v1.current;
  return [
    ...(s.brokenDeploy.brokenCacheCreated || s.brokenDeploy.stillCurrent !== v1 || s.brokenDeploy.reloadShows !== 'v1' ? ['a half-uploaded deploy replaced the working version'] : []),
    ...(s.v2Installed.pageStillOn === 'v1' ? [] : ['the open page was swapped mid-session']),
    ...(s.v2Installed.onUpdateReadyFired ? [] : ['the open page was never told an update is ready']),
    ...(s.v2Installed.current !== v1 ? [] : ['the update never became the current version']),
    ...(s.v2Installed.oldPageLazyChunk === 'loaded' ? [] : ['the open page could not load its own older chunk: ' + s.v2Installed.oldPageLazyChunk]),
    ...(s.v2Installed.previous === v1 ? [] : ['the update did not keep the previous version']),
    ...(s.nextLaunch.build === 'v2' ? [] : [`the next launch showed ${s.nextLaunch.build}, not the update`]), ...list('errors', s.nextLaunch.errors),
    ...(s.v3Installed.expectKept.every((n) => n in s.v3Installed.caches) ? [] : ['a version that should stay was deleted']),
    ...(s.v3Installed.expectDeleted in s.v3Installed.caches ? ['the oldest cache was never cleaned up'] : []),
    ...(s.buildIdOnly.previousVersion !== s.buildIdOnly.version && s.buildIdOnly.served === 'build-id-only' ? [] : ['a build-id-only deploy left the cached shell stale']),
  ];
}

const file = `${out}/${flags.update ? 'update' : 'offline'}-report.json`;
fs.writeFileSync(file, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log('report:', path.relative(root, file));
if (flags.check) {
  const bad = results.flatMap((r) => problems(r).map((p) => `${r.browser}: ${p}`));
  for (const p of bad) console.error('PROBLEM ' + p);
  if (bad.length) process.exitCode = 1;
}
