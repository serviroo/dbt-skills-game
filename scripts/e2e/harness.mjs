// Shared setup for the E2E scenario files: a Playwright Chromium, a Vite dev server on a free port, the artifacts
// folder and the helpers every scenario uses. scripts/e2e.mjs calls startHarness(flags) once, plus h.more() for each
// extra browser it runs scenarios in side by side, and passes one of these, h, to each scenario. h.stop() closes every
// browser and stops only the dev server this process started.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glArgs, checkRenderer } from '../gl.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (p, host) => new Promise((res) => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, host); });

/** Counts real browser frames, including when a scenario has installed the page clock. */
export async function frames(page, n) {
  let timer;
  try {
    await Promise.race([
      page.evaluate((n) => new Promise((done) => {
        const raf = window.__e2eRaf;
        const tick = () => --n <= 0 ? done() : raf(tick);
        raf(tick);
      }), n),
      new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`the browser did not draw ${n} frames within 15000 ms`)), 15000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Waits for entry motion to finish on boxes that come to rest, then compares consecutive frame rects. */
export async function settled(page, selector, { timeout = 15000 } = {}) {
  const end = Date.now() + timeout;
  let before = [];
  let moving = 'no frame received';
  for (;;) {
    let timer;
    try {
      const now = await Promise.race([
        (async () => {
          await frames(page, 1);
          return page.evaluate(({ selector, before }) => {
            const label = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].map((c) => '.' + c).join('');
            const paint = /^(opacity|color|fill|fillOpacity|stroke|strokeOpacity|strokeWidth|strokeDasharray|strokeDashoffset|background.*|filter|boxShadow|textShadow|.*Color)$/;
            const els = [...document.querySelectorAll(selector)];
            const blocking = [];
            for (const a of document.getAnimations()) {
              if (a.playState !== 'running') continue;
              const props = a.transitionProperty ? [a.transitionProperty.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k));
              if (props.every((k) => paint.test(k))) continue;
              const owner = a.effect.target;
              const direct = els.some((el) => owner === el || owner.contains(el));
              const reflows = !owner.ownerSVGElement && props.some((k) => !paint.test(k) && !['transform', 'translate', 'rotate', 'scale'].includes(k));
              if (!direct && !(reflows && els.some((el) => el.contains(owner)))) continue;
              const timing = a.effect.getComputedTiming();
              // until it is past its first instant (pending on the compositor, in its delay, or right at its start) an
              // animation holds its box still, so two equal frames can't tell an endless one from rest yet
              const started = !a.pending && timing.localTime > Math.max(0, timing.delay);
              blocking.push({ owner: label(owner), animation: a.animationName ?? a.transitionProperty ?? 'animation', properties: props, progress: timing.progress, endless: timing.endTime === Infinity, started });
            }
            const rects = els.map((el) => ({ owner: label(el), rect: ['x', 'y', 'width', 'height'].map((k) => el.getBoundingClientRect()[k]) }));
            const changed = rects.flatMap((r, i) => JSON.stringify(r) === JSON.stringify(before[i]) ? [] : [{ owner: r.owner, before: before[i]?.rect ?? null, after: r.rect }]);
            return { rects, blocking, changed, stable: els.length > 0 && before.length === rects.length && !changed.length && !blocking.some((a) => !a.endless || !a.started) };
          }, { selector, before });
        })(),
        new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`${selector} did not settle within ${timeout} ms: ${moving}`)), Math.max(0, end - Date.now())); }),
      ]);
      if (now.stable) return;
      before = now.rects;
      moving = JSON.stringify({ animations: now.blocking, rects: now.changed, ...(!now.rects.length && { missing: selector }) });
    } finally {
      clearTimeout(timer);
    }
  }
}

const SAVE = 'dbt.lantern.v1';
const YOU = 'dbt.you.v1';
const SEEN = JSON.stringify({ seenCutscene: true });

// The app's day turns at 6 a.m. local time (src/daily/store.ts). Scenarios seed a save for today and later check what
// the app made of it, so no run may cross that hour, and in UTC, CI's zone, runs near 06:00 did. These scripts and every
// page they open use a fixed-offset zone where the run starts between 6 and 7 p.m., at least 11 hours from the turn.
// Set before any scenario file is imported and works out its days. east: hours ahead of UTC (Etc/GMT-5 is UTC+5).
const ZONE = (() => {
  let east = 18 - new Date().getUTCHours();
  if (east > 14) east -= 24;
  return east ? `Etc/GMT${east > 0 ? '-' : '+'}${Math.abs(east)}` : 'Etc/GMT';
})();
process.env.TZ = ZONE;

/**
 * Starts Vite on the first free port from 5290, or only on `pinned` (--port, the port a tunnel forwards). If another run
 * takes the port first, Vite exits and the next port is tried.
 */
async function serve(host, pinned) {
  const [from, to] = pinned ? [pinned, pinned + 1] : [5290, 5390];
  for (let port = from; port < to; port++) {
    if (!(await portFree(port, host))) continue;
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    let spawnError;
    child.once('error', (e) => { spawnError = e; });
    const gone = () => spawnError || child.exitCode !== null || child.signalCode !== null;
    let stopping = false;
    // a server that goes away mid-run fails every scenario after it with "connection refused"; say why it went
    child.once('exit', (code, signal) => stopping || console.error(`dev server exited (code ${code}, signal ${signal}):\n${log.slice(-3000)}`));
    const stop = () => new Promise((res) => {
      stopping = true;
      if (gone()) return res();
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timer); res(); });
      child.kill('SIGTERM');
    });
    const url = `http://${host}:${port}`;
    for (let i = 0; i < 200 && !gone(); i++) {
      // "ready in" is printed only after this Vite bound the port, so the answer below can't come from another server
      if (/ready in/.test(log.replace(/\x1b\[[0-9;]*m/g, ''))) {
        try {
          if ((await fetch(url + '/', { signal: AbortSignal.timeout(2000) })).ok) return { url, stop };
        } catch {}
      }
      await sleep(150);
    }
    if (gone() && /already in use/i.test(log)) continue;
    await stop();
    throw new Error('dev server did not start:\n' + (spawnError?.message ?? log));
  }
  throw new Error(pinned ? `dev server port ${pinned} is taken` : 'no free port for the dev server');
}

// What happened inside each page, for evidence(): the intro's title, name prompt and windows coming and going, taps as
// they arrived, long tasks, gaps in a 100 ms timer (the main thread was busy) and the 3D stage's loop and frames, all on
// the page's own clock. evidence() reads it back, so a page that froze for a while still tells what happened in it.
function pageTrail() {
  window.__e2eRaf = window.requestAnimationFrame.bind(window);
  if (window.__e2eTrail) return;
  const trail = (window.__e2eTrail = { ev: [], seen: {}, frames: 0, lastFrame: null });
  const add = (ev, extra, t = performance.now()) => {
    trail.ev.push({ t: Math.round(t), ev, ...extra });
    if (trail.ev.length > 4000) trail.ev.splice(0, 1000);
  };
  const watch = { title: '.title-screen', prompt: '#np-name', windows: '.sw, .dq-sw' };
  new MutationObserver(() => {
    for (const [k, sel] of Object.entries(watch)) {
      const n = document.querySelectorAll(sel).length;
      if (n !== (trail.seen[k] ?? 0)) add(k, { from: trail.seen[k] ?? 0, to: (trail.seen[k] = n) });
    }
  }).observe(document, { childList: true, subtree: true });
  const what = (n) => (n instanceof Element ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList.length ? '.' + [...n.classList].join('.') : '') + ' "' + (n.textContent ?? '').trim().slice(0, 24) + '"' : String(n));
  for (const type of ['pointerdown', 'click']) addEventListener(type, (e) => add(type, { on: what(e.target) }), true);
  document.addEventListener('visibilitychange', () => add('visibility', { state: document.visibilityState }));
  const long = (list) => list.forEach((e) => add('longtask', { ms: Math.round(e.duration) }, e.startTime));
  let longs;
  try {
    longs = new PerformanceObserver((list) => long(list.getEntries()));
    longs.observe({ type: 'longtask', buffered: true });
  } catch {}
  let last = performance.now();
  const gap = () => {
    const now = performance.now();
    if (now - last > 250) add('timer-gap', { ms: Math.round(now - last) }, last);
    last = now;
  };
  setInterval(gap, 100);
  // a read right after a freeze comes before the observer and the timer have run: take what they have yet to note
  trail.flush = () => {
    long(longs?.takeRecords() ?? []);
    gap();
  };
  // src/main.ts sets window.__stage: note when its loop starts and stops, its first frames and every slow one
  let stage;
  Object.defineProperty(window, '__stage', {
    configurable: true,
    get: () => stage,
    set(s) {
      stage = s;
      if (!s || s.__e2eTrail) return;
      s.__e2eTrail = true;
      for (const k of ['start', 'stop']) {
        const f = s[k];
        s[k] = function (...a) {
          add('stage-' + k);
          return f.apply(this, a);
        };
      }
      const step = s.step;
      s.step = function (...a) {
        const t = performance.now();
        try {
          return step.apply(this, a);
        } finally {
          const ms = performance.now() - t;
          trail.lastFrame = t;
          if (++trail.frames <= 3 || ms > 50) add('frame', { n: trail.frames, ms: Math.round(ms) }, t);
        }
      };
    },
  });
}

/** The page's state for evidence(), read inside the page. */
function pageState() {
  const trail = window.__e2eTrail;
  trail?.flush();
  return {
    path: location.pathname + location.search,
    readyState: document.readyState,
    visibility: document.visibilityState,
    ready: document.documentElement.dataset.ready ?? null,
    mounted: !!window.__daily,
    route: window.__daily?.route.name ?? null,
    title: !!document.querySelector('.title-screen'),
    prompt: !!document.querySelector('#np-name'),
    windows: [...document.querySelectorAll('.sw, .dq-sw')].map((w) => {
      const r = w.getBoundingClientRect();
      return { label: w.getAttribute('aria-label'), visible: w.checkVisibility(), box: [r.left, r.top, r.width, r.height].map(Math.round) };
    }),
    stage: window.__stage ? { frames: trail?.frames ?? null, lastFrameAgo: trail?.lastFrame == null ? null : Math.round(performance.now() - trail.lastFrame) } : null,
    origin: performance.timeOrigin,
    trail: trail?.ev ?? null,
  };
}

/** How every e2e browser starts. A running browser takes no new flags, so scripts/e2e-browser.mjs starts a --ws one with these. */
export function launchOptions(flags) {
  return { headless: flags.headed !== 'true', args: [...glArgs(), '--autoplay-policy=no-user-gesture-required'] };
}

function launch(flags) {
  if (flags.ws) return chromium.connect(flags.ws);
  return chromium.launch({ ...launchOptions(flags), handleSIGINT: false, handleSIGTERM: false });
}

export async function startHarness(flags = {}) {
  const host = flags.host ?? '127.0.0.1';
  const out = path.join(root, 'artifacts/e2e', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out, { recursive: true });
  let server;
  let renderer;
  const trail = new WeakMap();
  const urlOf = (u) => {
    const url = new URL(u);
    const p = url.pathname.replace(/^\/@fs\/.*\/([^/]+)$/, '/@fs/$1');
    return url.origin === server.url ? p : url.origin + p;
  };
  const clean = (s) => s.replaceAll(server.url, '').replace(/\/@fs\/\S*\/([^/\s?]+)/g, '/@fs/$1');
  function track(page, t0) {
    const life = [];
    const logs = [];
    const log = (ev, extra) => life.push({ t: Date.now() - t0, ev, ...extra });
    const say = (type, text) => {
      logs.push({ t: Date.now() - t0, type, text: clean(text).slice(0, 500) });
      if (logs.length > 600) logs.splice(0, 100);
    };
    page.on('console', (m) => say(m.type(), m.text()));
    page.on('pageerror', (e) => say('pageerror', e.message));
    page.on('request', (r) => log('request', { type: r.resourceType(), url: urlOf(r.url()) }));
    page.on('response', (r) => log('response', { url: urlOf(r.url()), status: r.status() }));
    page.on('requestfailed', (r) => log('failed', { url: urlOf(r.url()), why: r.failure()?.errorText ?? null }));
    for (const ev of ['domcontentloaded', 'load', 'crash', 'close']) page.on(ev, () => log(ev));
    trail.set(page, { t0, life, logs, errors: [] });
  }
  /** Notes a step the scenario takes (a tap, a fill) in the page's evidence timeline. */
  const note = (page, ev, extra) => {
    const t = trail.get(page);
    t?.life.push({ t: Date.now() - t.t0, ev, ...extra });
  };

  // every browser this run starts, so stop() closes them all, also one still starting
  const browsers = [];
  const launches = [];
  const setups = [];
  const throttleErrors = [];
  const start = () => {
    const p = launch(flags).then(async (browser) => {
      browsers.push(browser);
      const probe = await browser.newPage();
      try {
        renderer = await checkRenderer(probe, { remote: !!flags.ws });
      } finally {
        await probe.context().close();
      }
      // every context keeps the scripts' zone, also when the browser runs on another machine (--ws), and every page in it is
      // followed for evidence()
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (o = {}) => {
        const t0 = Date.now();
        const ctx = await newContext({ timezoneId: ZONE, ...o });
        await ctx.addInitScript(pageTrail);
        const throttle = flags['cpu-throttle'] ? Number(flags['cpu-throttle']) : 1;
        const prepared = new WeakMap();
        // Popups that keep their opener share its slowed renderer process.
        ctx.on('page', (page) => {
          track(page, t0);
          const ready = throttle === 1 ? Promise.resolve() : ctx.newCDPSession(page).then((cdp) => cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }));
          prepared.set(page, ready);
          setups.push(ready.catch((e) => throttleErrors.push(`CPU throttle ${throttle}: ${clean(e.message)}`)));
        });
        const newPage = ctx.newPage.bind(ctx);
        ctx.newPage = async () => {
          const page = await newPage();
          await prepared.get(page);
          return page;
        };
        return ctx;
      };
      return browser;
    });
    launches.push(p);
    return p;
  };
  /**
   * Over --ws the browser's 127.0.0.1 is another machine's, where the port could be someone else's dev server if the
   * tunnel forwards a different one, so the browser must read back a file only this run wrote.
   */
  async function reachesServer(browser) {
    const token = crypto.randomUUID();
    fs.writeFileSync(path.join(out, 'run-token.txt'), token);
    const page = await browser.newPage();
    try {
      const res = await page.goto(`${server.url}/${path.relative(root, out)}/run-token.txt`).catch((e) => e);
      const got = res instanceof Error ? res.message.split('\n')[0] : res?.ok() ? await res.text() : `HTTP ${res?.status()}`;
      if (got !== token) throw new Error(`the browser does not reach this run's dev server at ${server.url} (${got.slice(0, 120)}); with --ws, the tunnel's -R must forward --port`);
    } finally {
      await page.context().close();
    }
  }
  let browser;
  try {
    browser = await start();
    server = await serve(host, flags.port && Number(flags.port));
    await reachesServer(browser);
  } catch (e) {
    await Promise.allSettled(browsers.map((b) => b.close()));
    await server?.stop();
    throw e;
  }
  console.log('renderer:', renderer);
  console.log('zone:', ZONE, new Date().toTimeString().slice(0, 5));

  /**
   * Watches, inside the page, for the selector to be in the page and then leave it. Arm it before the tap that removes
   * it and call the result with a timeout after the tap: `const left = leaves(page, '#np-name'); await tap; await left(10000)`.
   * The page reports the moment itself, so a page that freezes right after can't hide that it happened: the intro's first
   * 3D frames compile their shaders, which on a software GPU (CI's SwiftShader) blocks the page for seconds, and a wait
   * that asks the page from outside gets no answer until that ends.
   */
  function leaves(page, selector) {
    const at = page.evaluate(
      (sel) =>
        new Promise((done) => {
          let seen = false;
          const check = () => {
            if (document.querySelector(sel)) seen = true;
            else if (seen) {
              done(performance.timeOrigin + performance.now());
              return true;
            }
          };
          if (check()) return;
          const o = new MutationObserver(() => check() && o.disconnect());
          o.observe(document, { childList: true, subtree: true });
        }),
      selector,
    );
    at.catch(() => {});
    return async (timeout) => {
      note(page, `wait for ${selector} to leave`);
      let timer;
      try {
        const left = await Promise.race([at, new Promise((_, fail) => (timer = setTimeout(() => fail(new Error(`${selector} was still in the page ${timeout / 1000} s later`)), timeout)))]);
        note(page, `${selector} left`, { inPage: Math.round(left - (trail.get(page)?.t0 ?? 0)) });
      } finally {
        clearTimeout(timer);
      }
    };
  }

  /**
   * A fresh, isolated browser profile at phone size, optionally seeded with localStorage before the app runs. `device`
   * adds context options for the kind of device, such as hasTouch for a touch-first phone.
   */
  const opener = (browser) => async function open(seed = {}, query = '?mute', viewport = { width: 390, height: 844 }, prepare, device = {}) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true, serviceWorkers: 'block', ...device, ...(flags.media === 'true' ? { recordVideo: { dir: out, size: viewport } } : {}) });
    await ctx.addInitScript((s) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, seed);
    await prepare?.(ctx);
    const page = await ctx.newPage();
    const errors = trail.get(page).errors;
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
    await page.goto(server.url + '/' + query);
    return { ctx, page, errors };
  };
  /**
   * What a page showed, saved as <name>.json and <name>.png: its state (route, windows, name prompt, title, visibility,
   * the 3D stage's frames), its console, and one timeline of the scenario's notes, the page's load events and what
   * happened inside the page. Each read waits at most 3 s, so a frozen page can't hang it; if the page didn't answer,
   * one more read waits up to 20 s and says when it came back, with the timeline from inside the page.
   */
  async function evidence(page, name) {
    const { t0, life, logs, errors } = trail.get(page) ?? { t0: Date.now(), life: [], logs: [], errors: [] };
    const read = async (ms) => {
      const t = Date.now();
      const state = await Promise.race([
        page.evaluate(pageState).catch((e) => ({ unreadable: clean(String(e?.message ?? e).split('\n')[0]) })),
        sleep(ms).then(() => ({ unreadable: `no answer in ${ms / 1000} s` })),
      ]);
      return { t: t - t0, answeredIn: state.unreadable ? null : Date.now() - t, ...state };
    };
    const snap = () =>
      page
        .screenshot({ path: path.join(out, name + '.png'), timeout: 3000 })
        .then(() => 'saved', (e) => 'not saved: ' + clean(String(e?.message ?? e).split('\n')[0]));
    const now = await read(3000);
    let shot = await snap();
    const later = (now.unreadable || shot !== 'saved') && !page.isClosed() ? await read(20000) : null;
    if (shot !== 'saved' && later && !later.unreadable && (await snap()) === 'saved') shot = `saved at ${Date.now() - t0} ms, once the page answered (first try ${shot})`;
    const answered = [later, now].find((r) => r && !r.unreadable);
    const timeline = [
      ...life.filter((e) => e.ev !== 'request' && e.ev !== 'response'),
      ...(answered?.trail ?? []).map(({ t, ...e }) => ({ t: Math.round(answered.origin + t - t0), in: 'page', ...e })),
    ].sort((x, y) => x.t - y.t);
    for (const s of [now, later]) if (s) delete s.trail;
    fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ t: now.t, state: now, later, shot, errors: errors.map(clean), console: logs, timeline, life }, null, 2));
  }
  /** evidence() for every page still open in this browser, as <prefix>-1, -2, ... in the order the pages opened */
  const allEvidence = (browser) => async function evidenceAll(prefix) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    await Promise.all(pages.map((p, i) => evidence(p, `${prefix}-${i + 1}`).catch((e) => console.log(`evidence ${prefix}-${i + 1}: ${e?.message ?? e}`))));
  };
  // A capture waits behind every canvas frame the GPU still has queued, and a slow machine can be seconds behind after
  // Home (its bubbles redraw the whole screen 30 times a second). A one-pixel read of a fresh canvas returns only once
  // that queue is done, so the shot starts from what is drawn now.
  const shot = async (page, name) => {
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const g = c.getContext('2d');
      g.fillRect(0, 0, 1, 1);
      g.getImageData(0, 0, 1, 1);
    });
    return page.screenshot({ path: path.join(out, name + '.png') });
  };
  const ls = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);
  const youOf = async (page) => JSON.parse((await ls(page, YOU)) ?? 'null');
  /** every value stored under `key` anywhere in the save, whatever its shape */
  const deepFind = (o, key, acc = []) => {
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) (k === key ? acc.push(v) : deepFind(v, key, acc));
    return acc;
  };
  const deepDrop = (o, keys) => {
    if (o && typeof o === 'object') for (const k of Object.keys(o)) (keys.includes(k) ? delete o[k] : deepDrop(o[k], keys));
    return o;
  };
  function expect(cond, msg) {
    if (!cond) throw new Error(msg);
  }
  /** Taps through any Lantern window the companion opens on arrival (the first-visit welcome), then waits for Home. */
  async function reachHub(page) {
    for (const end = Date.now() + 60000; Date.now() < end; ) {
      const win = await page.evaluate(() => [...document.querySelectorAll('.dq-sw')].filter((w) => !w.closest('.pwa-hint-layer')).length);
      const home = await page.locator('.dq-tile').first().isVisible().catch(() => false);
      if (!win && home) return;
      if (await page.locator('.dq-scrim.is-on').count()) await page.mouse.click(195, 700);
      // the next look comes 400 ms on, or as soon as Home shows with no window over it
      await page
        .waitForFunction(() => {
          const tile = document.querySelector('.dq-tile');
          const home = !!tile && tile.getClientRects().length > 0 && getComputedStyle(tile).visibility !== 'hidden';
          return home && ![...document.querySelectorAll('.dq-sw')].some((w) => !w.closest('.pwa-hint-layer'));
        }, null, { timeout: 400 })
        .catch(() => {});
    }
    await shot(page, 'fail-no-home');
    throw new Error('Home never appeared');
  }
  /** The first-visit welcome opens a moment after Home appears, so a tap that lands on its scrim taps through and retries. */
  async function openSettings(page) {
    for (let i = 0; ; i++) {
      await reachHub(page);
      try {
        await page.getByRole('button', { name: /Settings/ }).first().click({ timeout: 8000 });
        break;
      } catch (e) {
        if (i === 2) throw e;
      }
    }
    await page.locator('#set-playerName').waitFor({ timeout: 10000 });
  }

  let stopping;
  const stop = () => (stopping ??= (async () => {
    try {
      await Promise.allSettled(launches);
      const failed = (await Promise.allSettled(browsers.map((b) => b.close()))).find((r) => r.status === 'rejected');
      if (failed) throw failed.reason;
    } finally {
      await server.stop();
    }
    await Promise.all(setups);
    if (throttleErrors.length) throw new Error(throttleErrors.join('\n'));
  })());

  const shared = {};
  const lane = (browser) => ({ browser, server, out, flags, shared, renderer, throttleErrors, zone: ZONE, open: opener(browser), evidence, evidenceAll: allEvidence(browser), note, leaves, shot, ls, youOf, deepFind, deepDrop, expect, sleep, frames, settled, reachHub, openSettings, SAVE, YOU, SEEN, stop, more });
  /** Another browser on the same dev server, so scenarios can run side by side: its own profiles, the same `shared`. */
  async function more() {
    if (stopping) throw new Error('the harness is stopping');
    return lane(await start());
  }
  return lane(browser);
}
