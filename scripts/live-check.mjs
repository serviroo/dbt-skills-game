import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glArgs, checkRenderer } from './gl.mjs';
import { gone, realTimers } from './e2e/harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const target = args.find((a) => !a.startsWith('--'));
if (!target) throw new Error('usage: node scripts/live-check.mjs <site url> [--expect=<build id>]');
const site = new URL(target);
site.search = site.hash = '';
if (!site.pathname.endsWith('/')) site.pathname += '/';
const out = path.join(root, 'artifacts/live', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEEN = JSON.stringify({ seenCutscene: true });
const YOU = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 });
const VIEW = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const metaOf = (html, name) => html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1] ?? html.match(new RegExp(`<meta http-equiv="${name}" content="([^"]*)"`))?.[1] ?? null;
const buildMatches = (id) => !flags.expect || (!!id && (id === flags.expect || (/^[a-f0-9]{7,39}$/i.test(flags.expect) && /^[a-f0-9]{40}$/i.test(id) && id.startsWith(flags.expect))));

const checks = [];
const errors = [];
const cspViolations = [];
const foreign = new Set();
const seen = { requests: 0, fromServiceWorker: 0 };

let current = '';
async function check(name, fn) {
  current = name;
  const shots = [];
  const t = Date.now();
  try {
    const detail = await fn((page, label) => {
      const file = `${String(checks.length + 1).padStart(2, '0')}-${name}${label ? '-' + label : ''}.png`;
      shots.push(file);
      return page.screenshot({ path: path.join(out, file) });
    });
    checks.push({ name, ok: true, ms: Date.now() - t, detail, shots });
    console.log(`ok   ${name}`);
  } catch (e) {
    checks.push({ name, ok: false, ms: Date.now() - t, error: String(e?.message ?? e).slice(0, 600), shots });
    console.log(`FAIL ${name}: ${e?.message ?? e}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const insecure = site.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(site.hostname);
const browser = await chromium.launch({
  channel: 'chromium',
  headless: flags.headed !== 'true',
  args: [
    ...glArgs(),
    '--autoplay-policy=no-user-gesture-required',
    ...(insecure ? [`--unsafely-treat-insecure-origin-as-secure=${site.origin}`] : []),
  ],
});

async function profile({ seed = null, sw = true } = {}) {
  const ctx = await browser.newContext({ ...VIEW, serviceWorkers: sw ? 'allow' : 'block' });
  // gone() counts its deadline in time the page could run, by the page's own timer
  await ctx.addInitScript(realTimers);
  await ctx.exposeBinding('__liveCsp', (_src, v) => cspViolations.push(v));
  await ctx.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => window.__liveCsp(`${e.violatedDirective} ${e.blockedURI || 'inline'} @ ${location.pathname}${location.search}`)));
  if (seed) {
    await ctx.addInitScript(([s, at]) => {
      if (location.origin !== at || sessionStorage.getItem('live-seeded')) return;
      sessionStorage.setItem('live-seeded', '1');
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, [seed, site.origin]);
  }
  ctx.on('console', (m) => m.type() === 'error' && errors.push(`${current} console ${m.page()?.url() ?? 'worker'}: ${m.text().slice(0, 300)}`));
  ctx.on('weberror', (e) => errors.push(`${current} pageerror ${e.page()?.url() ?? ''}: ` + String(e.error()?.message ?? e.error()).slice(0, 300)));
  ctx.on('request', (r) => {
    seen.requests++;
    if (r.serviceWorker()) seen.fromServiceWorker++;
    const u = new URL(r.url());
    if (!['data:', 'blob:'].includes(u.protocol) && u.origin !== site.origin) foreign.add(r.url());
  });
  return ctx;
}
const ready = (page, ms = 45000) => page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: ms });
const shownBuild = (page) => page.evaluate(() => document.querySelector('meta[name=build]')?.getAttribute('content') ?? null);
async function reachHome(page) {
  await page.waitForFunction(() => window.__daily, null, { timeout: 45000 });
  let settled = false;
  let broke = null;
  const settling = page.evaluate(() => window.__daily.settled).then(() => (settled = true), (e) => (broke = e));
  let missed = '';
  for (const end = Date.now() + 30000; !settled; ) {
    if (broke) throw new Error('the companion failed while opening: ' + broke.message.split('\n')[0]);
    if (Date.now() > end) throw new Error('the companion never settled: its opening window stayed up. ' + missed);
    if (await page.locator('.dq-scrim.is-on').count()) await page.locator('.dq-sw').last().click({ timeout: 2000 }).catch((e) => (missed = e.message.split('\n')[0]));
    await Promise.race([settling, sleep(300)]);
  }
  const onHome = () => {
    const view = document.querySelector('.dq-view');
    return document.querySelector('.dq')?.dataset.screen === 'hub' && !!view && !view.inert && !document.querySelector('.dq-sw');
  };
  if (!(await page.waitForFunction(onHome, null, { timeout: 5000 }).then(() => true, () => false))) {
    throw new Error('Home never appeared: ' + (await page.evaluate(() => `screen ${document.querySelector('.dq')?.dataset.screen}, ${document.querySelectorAll('.dq-sw').length} window(s)`)));
  }
  await page.locator('.dq-tile').first().waitFor({ state: 'visible', timeout: 5000 });
}

let assetCount = 0;
let metaCache = '';
let built = null;
try {
  await check('renderer', async () => {
    const probe = await browser.newPage();
    try {
      const renderer = await checkRenderer(probe);
      console.log('renderer:', renderer);
      return { renderer };
    } finally {
      await probe.context().close();
    }
  });
  await check('build-id', async () => {
    const deadline = Date.now() + Number(flags.wait ?? 180) * 1000;
    for (;;) {
      const res = await fetch(new URL(`?live-check=${Date.now()}`, site), { cache: 'no-store', signal: AbortSignal.timeout(10000) }).catch((e) => ({ ok: false, status: e.message }));
      if (res.ok) {
        built = metaOf(await res.text(), 'build');
        if (buildMatches(built)) break;
      }
      if (Date.now() > deadline) throw new Error(`site serves build ${built ?? `none (HTTP ${res.status})`}, expected ${flags.expect ?? 'a build id'}`);
      await sleep(5000);
    }
    expect(built, 'the page has no <meta name="build">');
    return { served: built, expected: flags.expect ?? null };
  });

  await check('csp-meta', async () => {
    const html = await (await fetch(site, { cache: 'no-store' })).text();
    const csp = metaOf(html, 'Content-Security-Policy');
    expect(csp, 'the page has no Content-Security-Policy meta tag');
    expect(/default-src 'self'/.test(csp) && /script-src 'self'(;|$)/.test(csp), "CSP is missing default-src 'self' or script-src 'self': " + csp);
    expect(!/https?:|\*|'unsafe-eval'/.test(csp), 'CSP allows remote sources or eval: ' + csp);
    const sw = await fetch(new URL('sw.js', site), { cache: 'no-store' });
    expect(sw.ok, `sw.js answered HTTP ${sw.status}`);
    const swText = await sw.text();
    assetCount = JSON.parse(swText.match(/const ASSETS = (\[.*?\]);/s)?.[1] ?? '[]').length;
    metaCache = swText.match(/const META = '([^']+)'/)?.[1] ?? '';
    expect(metaCache, 'sw.js names no cache for its version records');
    expect(assetCount > 0, 'sw.js lists no files to keep offline');
    return { csp, precacheList: assetCount, metaCache };
  });

  await check('first-run-name-prompt', async (shot) => {
    const ctx = await profile();
    const page = await ctx.newPage();
    await page.goto(new URL('?mute', site).href);
    await ready(page);
    await page.locator('.title-screen').click();
    await page.locator('#np-name').waitFor({ timeout: 20000 });
    await gone(page.locator('.title-screen'), 30000);
    await shot(page);
    await ctx.close();
  });

  let home = null;
  await check('returning-home', async (shot) => {
    const ctx = await profile({ seed: { 'dbt.you.v1': YOU, 'dbt.app.v1': SEEN } });
    home = await ctx.newPage();
    await home.goto(new URL('?mute', site).href);
    await reachHome(home);
    await shot(home);
  });

  await check('safe-zone-one-tap', async (shot) => {
    expect(home, 'Home never opened');
    await home.locator('.dq-safe').first().click();
    const talk = home.locator('.dq-sz-talk');
    await talk.waitFor({ state: 'visible', timeout: 15000 });
    expect((await talk.innerText()).includes('Talk to someone now'), 'the Safe Zone has no "Talk to someone now"');
    await shot(home);
    await talk.click();
    await home.locator('a[href^="tel:"]').first().waitFor({ timeout: 15000 });
    const links = await home.locator('a[href^="tel:"], a[href^="sms:"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(links.some((h) => h.startsWith('tel:')) && links.some((h) => h.startsWith('sms:')), 'crisis lines are missing tel: or sms: links: ' + links.join(' '));
    await shot(home, 'talk');
    return { taps: 1, links };
  });
  await home?.context().close();

  let installed = null;
  await check('service-worker-and-offline', async (shot) => {
    const ctx = await profile();
    const page = await ctx.newPage();
    await page.goto(new URL('?mute', site).href);
    await ready(page);
    const t0 = Date.now();
    let sw = null;
    while (Date.now() - t0 < 90000) {
      sw = await page.evaluate(async (metaName) => {
        const reg = await navigator.serviceWorker.getRegistration();
        const meta = (await caches.has(metaName)) ? await (await (await caches.open(metaName)).match('current'))?.text() : null;
        return { scope: reg?.scope ?? null, active: !!reg?.active, cache: meta ?? null, cached: meta ? (await (await caches.open(meta)).keys()).length : 0 };
      }, metaCache);
      if (sw.active && sw.cache && sw.cached >= assetCount + 1) break;
      await sleep(500);
    }
    expect(sw?.active && sw.cached >= assetCount + 1, `the service worker did not finish installing: ${JSON.stringify(sw)}`);
    expect(sw.scope === site.href, `service worker scope is ${sw.scope}, want ${site.href}`);
    await page.reload();
    await ready(page);
    const controlled = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
    expect(controlled === new URL('sw.js', site).href, `after a reload the page is controlled by ${controlled}`);
    expect(buildMatches(await shownBuild(page)), `the service worker serves build ${await shownBuild(page)}, expected ${flags.expect}`);

    await ctx.setOffline(true);
    const failed = [];
    ctx.on('requestfailed', (r) => failed.push(r.url()));
    await page.reload();
    await ready(page);
    await page.locator('.title-screen').click();
    await page.locator('#np-name').waitFor({ timeout: 20000 });
    await gone(page.locator('.title-screen'), 30000);
    await shot(page, 'offline-reload');
    await page.close();
    const cold = await ctx.newPage();
    await cold.goto(new URL('?mute', site).href);
    await ready(cold);
    expect(!failed.length, 'offline requests failed: ' + failed.slice(0, 5).join(' '));
    await cold.close();
    installed = ctx;
    return { ...sw, controlledBy: controlled, offlineReload: 'name prompt shown', offlineColdLaunch: 'ready' };
  });

  await check('deep-link-installed', async (shot) => {
    expect(installed, 'the service worker never installed');
    const page = await installed.newPage();
    await page.goto(new URL('old/link/?mute', site).href);
    await ready(page, 20000);
    await shot(page);
  });
  await installed?.close();

  await check('story-ask', async (shot) => {
    const ctx = await profile({ sw: false, seed: { 'dbt.you.v1': YOU, 'dbt.app.v1': SEEN } });
    const page = await ctx.newPage();
    const sent = [];
    page.on('request', (r) => (r.method() !== 'GET' || new URL(r.url()).pathname.includes('/api/')) && sent.push(`${r.method()} ${r.url()}`));
    await page.goto(new URL('?mute', site).href);
    await reachHome(page);
    await page.locator('.dq-tile--story').click();
    await page.locator('.st-shelf > *').first().waitFor({ timeout: 15000 });
    await page.locator('.st-shelfpage button:visible', { hasText: 'New story' }).first().click();
    const ta = page.getByRole('textbox', { name: /^Page,/ });
    await ta.waitFor({ timeout: 15000 });
    await page.locator('.st-write .st-title').fill('The Night Garden');
    const story = 'Mira found the brass key under the garden gate. She showed it to Tobin, who only shrugged.';
    await ta.fill(story);
    // Ask runs on the device: with the network gone, every mode still answers
    await ctx.setOffline(true);
    const got = {};
    for (const [mode, from, to] of [['questions', story.length], ['whatif', story.length], ['continue', story.length], ['polish', 0, story.indexOf('.') + 1]]) {
      await ta.evaluate((el, [s, e]) => {
        el.focus();
        el.setSelectionRange(s, e);
        el.dispatchEvent(new Event('select'));
      }, [from, to ?? from]);
      const wide = await page.evaluate(() => matchMedia('(min-width: 1100px)').matches);
      if (!wide && !(await page.locator('.st-cw.is-open').count())) await page.locator('.st-cwbtn').click();
      await page.locator(`.st-cw .st-mode--${mode}`).click();
      const prev = await page.locator('.st-cards > .st-batch:first-child .st-card').first().getAttribute('data-id', { timeout: 500 }).catch(() => null);
      await page.locator('.st-cw .st-ask').click();
      await page.waitForFunction((p) => {
        const id = document.querySelector('.st-cards > .st-batch:first-child .st-card')?.getAttribute('data-id');
        return id && id !== p;
      }, prev, { timeout: 15000 });
      got[mode] = await page.locator('.st-cards > .st-batch:first-child .st-card .st-card-t').allTextContents();
      expect(got[mode].length > 0 && got[mode].every((t) => t.trim()), `Ask (${mode}) came back without ideas`);
      if (mode === 'continue') await shot(page);
      await page.keyboard.press('Escape');
    }
    expect(!sent.length, 'Ask sent requests: ' + sent.join(' '));
    await ctx.close();
    return got;
  });

  await check('query-routes', async (shot) => {
    const ctx = await profile({ sw: false, seed: { 'dbt.you.v1': YOU, 'dbt.app.v1': SEEN } });
    const routes = {};
    for (const q of ['?fresh&mute', '?shot=gate&mute', '?lab=daily&mute', '?cutscene=1&mute']) {
      const page = await ctx.newPage();
      const res = await page.goto(new URL(q, site).href);
      expect(res?.status() === 200, `${q} answered HTTP ${res?.status()}`);
      await ready(page);
      if (!q.includes('lab=')) {
        // the app makes the 3D stage for the intro just before the title shows
        await page.locator('.title-screen').waitFor({ timeout: 30000 });
        const model = await page.evaluate(() => !!window.__stage)
          ? page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/models/hero.glb'), { timeout: 30000 })
          : null;
        const [response] = await Promise.all([model, page.locator('.title-screen').click()]);
        await gone(page.locator('.title-screen'), 30000);
        if (response) {
          expect(response.ok() && new URL(response.url()).pathname === site.pathname + 'models/hero.glb', 'the intro model did not load inside the site folder');
        }
      }
      await sleep(1500);
      await shot(page, q.slice(1).split('&')[0].replace(/[^a-z0-9]+/gi, '-'));
      routes[q] = res.status();
      await page.close();
    }
    await ctx.close();
    return routes;
  });

  await check('console-errors', async () => expect(!errors.length, `${errors.length} console errors:\n` + errors.slice(0, 10).join('\n')));
  await check('csp-violations', async () => expect(!cspViolations.length, `${cspViolations.length} CSP violations:\n` + cspViolations.slice(0, 10).join('\n')));
  await check('same-origin-only', async () => {
    expect(!foreign.size, `requests left ${site.origin}:\n` + [...foreign].slice(0, 10).join('\n'));
    return seen;
  });
} finally {
  await browser.close();
  const ok = checks.every((c) => c.ok);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ url: site.href, expect: flags.expect ?? null, served: built, ok, checks }, null, 2));
  console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed, artifacts in ${path.relative(root, out)}`);
  process.exitCode = ok ? 0 : 1;
}
