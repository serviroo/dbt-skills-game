// End-to-end proof that the built app installs its service worker, boots offline, and updates quietly.
// node scripts/pwa-verify.mjs [--dist=dist] [--path=<app subpath>] [--video] [--browser=chromium|webkit|both] [--out=qa/out/pwa/verify] [--update] [--port=4173]
// Starts its own `vite preview` on the first free port from --port and stops only that process, also on failure.
// --update builds its extra versions in a scratch folder under the system temp dir (TMPDIR) and deletes it after.
// Exits 1 if the report shows any problem or a browser can't start. (--check, which older callers pass, changes nothing.)
import { chromium, webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from './preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const dist = path.resolve(root, flags.dist ?? 'dist');
const out = path.resolve(root, flags.out ?? 'qa/out/pwa/verify');
const browsers = flags.browser === 'both' || !flags.browser ? ['chromium', 'webkit'] : [flags.browser];
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const swInfo = (dir) => {
  const src = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
  return { version: JSON.parse(src.match(/const VERSION = (".*?");/)[1]), assets: JSON.parse(src.match(/const ASSETS = (\[.*?\]);/s)[1]) };
};
const firstPort = Number(flags.port ?? 4173);
async function serve(dir, port) {
  const srv = await startPreview(dir, { ...(port ? { from: port, tries: 1 } : { from: firstPort }), probe: flags.path ? `/${flags.path.replace(/^\/|\/$/g, '')}/` : '/' });
  console.log('preview:', srv.url);
  return srv;
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
  const { version, assets } = swInfo(path.join(dist, flags.path ?? ''));
  const tStart = Date.now();
  const marks = (report.marks = []);
  const mark = (label) => marks.push({ t: (Date.now() - tStart) / 1000, label });
  let srv;
  let browser;
  try {
    srv = await serve(dist);
    const base = `${srv.url}${flags.path ? flags.path.replace(/^\/|\/$/g, '') + '/' : ''}`;
    browser = await launcher.launch({ headless: true, args: name === 'chromium' ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] : [] });
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, serviceWorkers: 'allow', ...(flags.video ? { recordVideo: { dir: `${out}/video-${name}`, size: { width: 375, height: 800 } } } : {}) });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    mark('online: first visit');
    let b = bucket();
    watch(page, b);
    await page.goto(base);
    await ready(page);
    const installMs = await waitInstalled(page, version, assets.length + 1);
    mark('service worker installed, ' + (assets.length + 1) + ' files cached');
    await page.waitForTimeout(1500);
    report.steps.online = { swVersion: version, precached: assets.length + 1, installMs, ...(await cacheState(page)), csp: await page.evaluate(() => window.__csp), errors: b.errors, failed: b.failed };
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
    let fontTimeout;
    const fonts = await Promise.race([page.evaluate(async () => {
      await document.fonts.ready;
      // ask for every face while offline, as the cutscene and end card will
      await Promise.all([document.fonts.load('500 16px Jost'), document.fonts.load('italic 600 16px Jost'), document.fonts.load('600 32px "Bodoni Moda"')]);
      return { loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.style}`), jost: document.fonts.check('500 16px Jost'), jostItalic: document.fonts.check('italic 600 16px Jost'), bodoni: document.fonts.check('600 32px "Bodoni Moda"') };
    }), new Promise((_, reject) => { fontTimeout = setTimeout(() => reject(new Error('offline fonts never finished loading')), 30000); })]).finally(() => clearTimeout(fontTimeout));
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
    report.steps.offlineCold = { ready: true, failed: b.failed, errors: b.errors, csp: await cold.evaluate(() => window.__csp), notFromSW: b.responses.filter((r) => !r.sw && !/^(data|blob):/.test(r.url)).map((r) => r.url) };

    // a lazily loaded chunk with its own CSS (lab pages are never loaded online in this run)
    b = bucket();
    watch(cold, b);
    mark('offline: lazy chunk (?lab=window)');
    await cold.goto(base + '?lab=window');
    await ready(cold);
    await cold.waitForTimeout(2500);
    await cold.screenshot({ path: `${out}/${name}-4-offline-lazy-chunk.png` });
    report.steps.offlineLazyChunk = { ready: true, chunks: b.responses.filter((r) => /\/assets\//.test(r.url)).map((r) => `${new URL(r.url).pathname} ${r.status}${r.sw ? ' sw' : ''}`), failed: b.failed, errors: b.errors, csp: await cold.evaluate(() => window.__csp) };
  } finally {
    await browser?.close().catch(() => {});
    await srv?.stop();
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
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace(/<meta name="x-build" content="[^"]*" \/>\n\s*/, '').replace('<title>', `<meta name="x-build" content="${tag}" />\n    <title>`));
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
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-verify-'));
  console.log('scratch:', scratch);
  let srv;
  let browser;
  try {
    const v1 = { dir: dist, ...swInfo(dist) };
    const v2 = makeVersion(dist, path.join(scratch, 'v2'), 'v2', true);
    const v3 = makeVersion(v2.dir, path.join(scratch, 'v3'), 'v3', false);
    const v4 = makeVersion(v3.dir, path.join(scratch, 'v4'), 'v4', false);
    srv = await serve(v1.dir);
    const port = srv.port;
    const base = `${srv.url}${flags.path ? flags.path.replace(/^\/|\/$/g, '') + '/' : ''}`;
    browser = await launcher.launch({ headless: true, args: name === 'chromium' ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] : [] });
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, serviceWorkers: 'allow' });
    await ctx.addInitScript(INIT);
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
    report.steps.v3Installed = { expectKept: [v1, v2, v3].map((v) => `system-v${v.version}`), ...(await cacheState(page)) };

    await srv.stop();
    srv = await serve(v4.dir, port);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await waitInstalled(page, v4.version, v4.assets.length + 1);
    report.steps.v4Installed = { expectKept: [v2, v3, v4].map((v) => `system-v${v.version}`), expectDeleted: `system-v${v1.version}`, ...(await cacheState(page)) };
    report.errors = b.errors;
    report.failed = b.failed;
    report.csp = await page.evaluate(() => window.__csp);
  } finally {
    await browser?.close().catch(() => {});
    await srv?.stop();
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
const file = `${out}/${flags.update ? 'update' : 'offline'}-report.json`;
fs.writeFileSync(file, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log('report:', path.relative(root, file));

function problems(r) {
  if (r.error) return [r.error.split('\n')[0]];
  const s = r.steps;
  const none = (label, list) => (list?.length ? [`${label}: ${list.slice(0, 3).join(' | ')}`] : []);
  if (!flags.update) {
    return [
      ...none('online errors', [...s.online.errors, ...s.online.failed]),
      ...none('online CSP', s.online.csp),
      ...none('manifest', [...s.manifest.problems, ...s.manifest.splashMissing, ...[s.manifest.chromium?.manifestErrors ?? [], s.manifest.chromium?.installabilityErrors ?? []].flat().map((e) => e.message ?? e.errorId ?? e.error)]),
      ...(s.offlineReload.serverGone ? [] : ['server still answered while offline']),
      ...(s.offlineReload.allFromSW ? [] : [`offline reload left the service worker: ${s.offlineReload.notFromSW.slice(0, 3).join(' ')}`]),
      ...(s.offlineReload.fonts.jost && s.offlineReload.fonts.jostItalic && s.offlineReload.fonts.bodoni ? [] : ['fonts missing offline: ' + JSON.stringify(s.offlineReload.fonts)]),
      ...none('offline reload', [...s.offlineReload.failed, ...s.offlineReload.errors, ...s.offlineReload.csp]),
      ...none('offline cold launch', [...s.offlineCold.failed, ...s.offlineCold.errors, ...s.offlineCold.csp, ...s.offlineCold.notFromSW]),
      ...none('offline lazy chunk', [...s.offlineLazyChunk.failed, ...s.offlineLazyChunk.errors, ...s.offlineLazyChunk.csp]),
      ...(s.offlineLazyChunk.chunks.some((c) => /\/window-[^\s]+\.js 200 sw$/.test(c)) ? [] : ['offline window chunk was not served by the service worker']),
    ];
  }
  const v2 = s.v2Installed;
  return [
    ...none('update errors', [...r.errors, ...r.failed, ...r.csp]),
    ...(s.brokenDeploy.brokenCacheCreated || s.brokenDeploy.stillCurrent !== s.v1.current || s.brokenDeploy.reloadShows !== 'v1' ? ['a broken deploy replaced the working version: ' + JSON.stringify(s.brokenDeploy)] : []),
    ...(v2.pageStillOn !== 'v1' || !v2.onUpdateReadyFired || v2.oldPageLazyChunk !== 'loaded' || v2.current === s.v1.current ? ['update did not install quietly: ' + JSON.stringify(v2)] : []),
    ...(s.nextLaunch.build !== 'v2' ? [`next launch shows ${s.nextLaunch.build}, want v2`] : []),
    ...none('next launch errors', s.nextLaunch.errors),
    ...(s.v3Installed.expectKept.every((c) => c in s.v3Installed.caches) ? [] : ['a version that should stay was deleted at v3: ' + Object.keys(s.v3Installed.caches).join(' ')]),
    ...(s.v4Installed.expectKept.every((c) => c in s.v4Installed.caches) && !(s.v4Installed.expectDeleted in s.v4Installed.caches) ? [] : ['old caches not rotated at v4: ' + Object.keys(s.v4Installed.caches).join(' ')]),
  ];
}
const bad = results.flatMap((r) => problems(r).map((p) => `${r.browser}: ${p}`));
for (const p of bad) console.error('PROBLEM ' + p);
process.exitCode = bad.length ? 1 : 0;
