// Shared setup for the E2E scenario files: a Playwright Chromium, a Vite dev server on a free port, the artifacts
// folder and the helpers every scenario uses. scripts/e2e.mjs calls startHarness(flags) once and passes the result,
// h, to each scenario. h.stop() closes the browser and stops only the dev server this process started.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (p, host) => new Promise((res) => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, host); });

const SAVE = 'dbt.lantern.v1';
const YOU = 'dbt.you.v1';
const SEEN = JSON.stringify({ seenCutscene: true });

/** Starts Vite on the first free port from 5290. If another run takes the port first, Vite exits and the next port is tried. */
async function serve(host) {
  for (let port = 5290; port < 5390; port++) {
    if (!(await portFree(port, host))) continue;
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    let spawnError;
    child.once('error', (e) => { spawnError = e; });
    const gone = () => spawnError || child.exitCode !== null || child.signalCode !== null;
    const stop = () => new Promise((res) => {
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
  throw new Error('no free port for the dev server');
}

function launch(flags) {
  if (flags.ws) return chromium.connect(flags.ws, { headers: { 'x-playwright-launch-options': JSON.stringify({ headless: flags.headless === 'true', args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] }) } });
  const gl = flags.gpu ? ['--use-angle=vulkan', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader'];
  return chromium.launch({ headless: flags.headed !== 'true', handleSIGINT: false, handleSIGTERM: false, args: [...gl, '--autoplay-policy=no-user-gesture-required'] });
}

export async function startHarness(flags = {}) {
  const host = flags.host ?? '127.0.0.1';
  const out = path.join(root, 'artifacts/e2e', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch(flags);
  let server;
  let renderer;
  try {
    server = await serve(host);
    const p = await (await browser.newContext()).newPage();
    renderer = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const x = g?.getExtension('WEBGL_debug_renderer_info'); return g ? String(g.getParameter(x ? x.UNMASKED_RENDERER_WEBGL : g.RENDERER)) : 'no webgl'; });
    await p.context().close();
  } catch (e) {
    await browser.close().catch(() => {});
    await server?.stop();
    throw e;
  }
  console.log('renderer:', renderer);

  /** A fresh, isolated browser profile at phone size, optionally seeded with localStorage before the app runs. */
  async function open(seed = {}, query = '?mute', viewport = { width: 390, height: 844 }) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true, serviceWorkers: 'block' });
    await ctx.addInitScript((s) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, seed);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
    await page.goto(server.url + '/' + query);
    return { ctx, page, errors };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png') });
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
      await sleep(400);
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
      await browser.close();
    } finally {
      await server.stop();
    }
  })());

  return { browser, server, out, flags, shared: {}, renderer, open, shot, ls, youOf, deepFind, deepDrop, expect, sleep, reachHub, openSettings, SAVE, YOU, SEEN, stop };
}
