// End-to-end check of the player's names: the first-run prompt, the intro copy, Settings, a Save Crystal round trip and
// an old save that has no names yet. Starts its own Vite dev server on a free port and stops only that process.
// node scripts/e2e.mjs [--scenario=<name>] [--headed] [--ws=<playwright run-server endpoint> --host=<this machine's address>]
// With --ws the browser runs on another machine (one with a real GPU) and loads the dev server bound to --host.
// Writes screenshots and report.json to artifacts/e2e/<time>/.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const out = path.join(root, 'artifacts/e2e', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (p) => new Promise((res) => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, HOST); });

const SAVE = 'dbt.lantern.v1';
const YOU = 'dbt.you.v1';
const SEEN = JSON.stringify({ seenCutscene: true });
const HOST = flags.host ?? '127.0.0.1';

async function serve() {
  let port = 5290;
  while (!(await portFree(port))) port++;
  const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', HOST, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://${HOST}:${port}/`)).ok) return { url: `http://${HOST}:${port}`, stop: () => new Promise((res) => { child.once('exit', res); child.kill('SIGTERM'); }) };
    } catch {}
    await sleep(150);
  }
  child.kill('SIGTERM');
  throw new Error('dev server did not start:\n' + log);
}

const browser = flags.ws
  ? await chromium.connect(flags.ws, { headers: { 'x-playwright-launch-options': JSON.stringify({ headless: flags.headless === 'true', args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] }) } })
  : await chromium.launch({ headless: flags.headed !== 'true', args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const server = await serve();
const report = { url: server.url, browser: flags.ws ? 'remote ' + flags.ws : 'local', scenarios: [] };
{
  const p = await (await browser.newContext()).newPage();
  report.renderer = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const x = g?.getExtension('WEBGL_debug_renderer_info'); return g ? String(g.getParameter(x ? x.UNMASKED_RENDERER_WEBGL : g.RENDERER)) : 'no webgl'; });
  await p.context().close();
  console.log('renderer:', report.renderer);
}
const shared = {};

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
  for (let i = 0; i < 40; i++) {
    const win = await page.locator('.dq-sw').count();
    if (!win && (await page.locator('.dq-tile').first().isVisible().catch(() => false))) return;
    await page.mouse.click(195, 700);
    await sleep(400);
  }
  await shot(page, 'fail-no-home');
  throw new Error('Home never appeared');
}
async function openSettings(page) {
  await reachHub(page);
  await page.getByRole('button', { name: /Settings/ }).first().click();
  await page.locator('#set-playerName').waitFor({ timeout: 10000 });
}

const scenarios = {
  /** first run: the prompt appears after the title, the chosen names are stored and used in the intro */
  async 'first-run'() {
    const { ctx, page, errors } = await open();
    await sleep(2500);
    await page.mouse.click(195, 500);
    const name = page.locator('#np-name');
    await name.waitFor({ timeout: 15000 });
    expect((await name.getAttribute('placeholder')) === 'Player', 'name field placeholder is not Player');
    await shot(page, '01-name-prompt');
    await name.fill('  Robin <b>  ');
    await page.keyboard.press('Enter');
    expect(await page.locator('#np-comp').evaluate((el) => el === document.activeElement), 'Enter did not move to the companion field');
    await page.locator('#np-comp').fill('Pip');
    await shot(page, '02-name-prompt-filled');
    await page.keyboard.press('Enter');
    await page.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    const you = await youOf(page);
    expect(you?.name === 'Robin b' && you?.companion === 'Pip' && you.nameAt > 0 && you.companionAt > 0, 'names not stored cleanly: ' + JSON.stringify(you));
    await page.getByText('Wanderer: Robin b').first().waitFor({ timeout: 60000 }).catch(async (e) => { await shot(page, 'fail-first-run'); fs.writeFileSync(path.join(out, 'fail-first-run.txt'), await page.locator('#ui').innerText().catch(() => '')); throw e; });
    await sleep(2500);
    await shot(page, '03-intro-uses-name');
    shared.you = you;
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** skipping keeps the defaults and is never asked again */
  async 'skip-keeps-default'() {
    const { ctx, page, errors } = await open();
    await sleep(2500);
    await page.mouse.click(195, 500);
    await page.locator('#np-name').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    const you = await youOf(page);
    expect(you && you.name === '' && you.companion === '' && you.nameAt === 0 && you.companionAt === 0, 'skip did not record an empty choice: ' + JSON.stringify(you));
    await page.getByText('Wanderer: Player').first().waitFor({ timeout: 60000 });
    await page.reload();
    await sleep(2500);
    await page.mouse.click(195, 500);
    await sleep(2500);
    expect(!(await page.locator('#np-name').count()), 'the prompt came back after a skip');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** the companion adopts the names chosen in the intro, and Settings edits them everywhere */
  async settings() {
    const you = shared.you ?? { name: 'Robin b', companion: 'Pip', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 };
    const { ctx, page, errors } = await open({ [YOU]: JSON.stringify(you), 'dbt.app.v1': SEEN });
    await page.getByText('Welcome, Robin b').first().waitFor({ timeout: 20000 });
    await sleep(2500);
    await shot(page, '04-welcome-uses-name');
    await reachHub(page);
    expect((await page.locator('.dq-firstshadow').getAttribute('title')) === 'Pip, asleep', 'hub companion is not named Pip');
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Robin b', 'Settings does not show the intro name');
    expect((await page.locator('#set-companion').inputValue()) === 'Pip', 'Settings does not show the companion name');
    await page.locator('#set-playerName').fill('Sam');
    await page.keyboard.press('Enter');
    await page.locator('#set-companion').fill('');
    await page.locator('#set-companion').blur();
    await sleep(300);
    await shot(page, '05-settings-you');
    const save = JSON.parse(await ls(page, SAVE));
    expect(deepFind(save, 'playerName').includes('Sam'), 'store did not save the new name');
    const mirror = await youOf(page);
    expect(mirror.name === 'Sam' && mirror.companion === '', 'mirror not updated: ' + JSON.stringify(mirror));
    await page.reload();
    await reachHub(page);
    expect((await page.locator('.dq-firstshadow').getAttribute('title')) === 'Moth, asleep', 'an empty companion name did not fall back to Moth');
    await page.reload();
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Sam', 'name lost on reload');
    shared.save = save;
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a Save Crystal carries the names to a device that never chose any */
  async 'save-crystal'() {
    const { ctx, page, errors } = await open({ [YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': SEEN });
    await openSettings(page);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save Crystal' }).click()]);
    const file = path.join(out, 'save-crystal.json');
    await dl.saveAs(file);
    shared.crystal = file;
    expect(deepFind(JSON.parse(fs.readFileSync(file, 'utf8')), 'playerName').includes('Kit'), 'the Save Crystal has no player name');
    await ctx.close();

    const fresh = await open({ 'dbt.app.v1': SEEN });
    await openSettings(fresh.page);
    expect((await fresh.page.locator('#set-playerName').inputValue()) === '', 'fresh device should start with no name');
    await fresh.page.locator('input[type=file]').setInputFiles(file);
    await fresh.page.waitForFunction(() => document.querySelector('#set-playerName')?.value === 'Kit', null, { timeout: 15000 });
    expect((await fresh.page.locator('#set-companion').inputValue()) === 'Lumen', 'restore lost the companion name');
    const mirror = await youOf(fresh.page);
    expect(mirror?.name === 'Kit' && mirror?.companion === 'Lumen', 'restore did not update the mirror: ' + JSON.stringify(mirror));
    await shot(fresh.page, '06-restored-names');
    expect(!errors.length && !fresh.errors.length, [...errors, ...fresh.errors].join('\n'));
    await fresh.ctx.close();
  },

  /** skipping the prompt (both names never chosen) must not beat names restored from an older Save Crystal */
  async 'skip-then-restore'() {
    const file = shared.crystal ?? path.join(out, 'save-crystal.json');
    if (!fs.existsSync(file)) throw new Error('run save-crystal first');
    const { ctx, page, errors } = await open({ [YOU]: JSON.stringify({ name: '', companion: '', nameAt: 0, companionAt: 0 }), 'dbt.app.v1': SEEN });
    await openSettings(page);
    await page.locator('input[type=file]').setInputFiles(file);
    await page.waitForFunction(() => document.querySelector('#set-playerName')?.value === 'Kit', null, { timeout: 15000 });
    expect((await page.locator('#set-companion').inputValue()) === 'Lumen', 'restore after skip lost the companion name');
    await page.reload();
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Kit', 'restored name reverted after reload');
    const mirror = await youOf(page);
    expect(mirror?.name === 'Kit' && mirror?.companion === 'Lumen', 'mirror kept the skip: ' + JSON.stringify(mirror));
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a stale copy of the names from another tab never reverts a newer name, and every tab settles on the same names */
  async 'two-tabs'() {
    const t0 = Date.now() - 60000;
    const { ctx, page: a, errors } = await open({ [YOU]: JSON.stringify({ name: 'Alice', companion: 'Pip', nameAt: t0, companionAt: t0 }), 'dbt.app.v1': SEEN });
    await openSettings(a);
    const b = await ctx.newPage();
    b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
    await b.goto(server.url + '/?mute');
    await openSettings(b);
    await a.locator('#set-playerName').fill('Robin');
    await a.keyboard.press('Enter');
    await sleep(300);
    // what another tab that had not yet seen Robin would have written: its old name next to its own newer companion
    await b.evaluate(([k, v]) => localStorage.setItem(k, v), [YOU, JSON.stringify({ name: 'Alice', companion: 'Lumen', nameAt: t0, companionAt: Date.now() })]);
    await sleep(800);
    for (const [p, tab] of [[a, 'A'], [b, 'B']]) {
      await p.reload();
      await openSettings(p);
      expect((await p.locator('#set-playerName').inputValue()) === 'Robin', `tab ${tab} lost the newer name`);
      expect((await p.locator('#set-companion').inputValue()) === 'Lumen', `tab ${tab} lost the newer companion`);
    }
    const mirror = await youOf(a);
    expect(mirror.name === 'Robin' && mirror.companion === 'Lumen', 'mirror did not settle: ' + JSON.stringify(mirror));
    expect(deepFind(JSON.parse(await ls(a, SAVE)), 'playerName').includes('Robin'), 'saved progress lost the newer name');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** the daily lab keeps its own save; editing names there never touches the player's real names */
  async 'lab-isolated'() {
    const t0 = Date.now() - 60000;
    const { ctx, page, errors } = await open({ [YOU]: JSON.stringify({ name: 'Alice', companion: 'Pip', nameAt: t0, companionAt: t0 }), 'dbt.app.v1': SEEN }, '?lab=daily&screen=settings&mute');
    await page.locator('#set-playerName').waitFor({ timeout: 20000 });
    await page.locator('#set-playerName').fill('Lab Name');
    await page.keyboard.press('Enter');
    await sleep(300);
    expect((await youOf(page))?.name === 'Alice', 'the lab wrote the real name');
    await page.goto(server.url + '/?mute');
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Alice', 'the real app shows the lab name');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** two first-run prompts open at once: a Skip in one never erases the names chosen in the other */
  async 'two-prompts'() {
    const { ctx, page: a, errors } = await open();
    const b = await ctx.newPage();
    b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
    await b.goto(server.url + '/?mute');
    for (const p of [a, b]) {
      await sleep(2500);
      await p.mouse.click(195, 500);
      await p.locator('#np-name').waitFor({ timeout: 15000 });
    }
    await a.locator('#np-name').fill('Robin');
    await a.locator('#np-comp').fill('Pip');
    await a.getByRole('button', { name: 'Continue' }).click();
    await a.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    await sleep(300);
    await b.getByRole('button', { name: 'Skip' }).click();
    await b.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    for (const p of [a, b]) {
      const you = await youOf(p);
      expect(you?.name === 'Robin' && you?.companion === 'Pip', 'a Skip erased the chosen names: ' + JSON.stringify(you));
    }
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a damaged or hand-edited copy of the names can't lock a name in place or wipe a real one */
  async 'bad-mirror'() {
    const { ctx, page, errors } = await open({ [YOU]: JSON.stringify({ name: 'Zulu', companion: 'Pip', nameAt: 1e100, companionAt: 1e100 }), 'dbt.app.v1': SEEN });
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === '', 'a far-future timestamp was trusted');
    await page.locator('#set-playerName').fill('Alice');
    await page.keyboard.press('Enter');
    await sleep(300);
    await page.evaluate(([k]) => localStorage.setItem(k, JSON.stringify({ name: {}, companion: 7, nameAt: Date.now(), companionAt: Date.now() })), [YOU]);
    await page.reload();
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Alice', 'a malformed copy cleared or locked the name');
    expect((await youOf(page))?.name === 'Alice', 'the malformed copy was not repaired');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a phone on its side: the prompt's buttons are on screen and work */
  async 'landscape-prompt'() {
    const { ctx, page, errors } = await open({}, '?mute', { width: 568, height: 320 });
    await sleep(2500);
    await page.mouse.click(284, 160);
    await page.locator('#np-name').waitFor({ timeout: 15000 });
    await sleep(1200);
    await shot(page, '08-landscape-prompt');
    for (const label of ['Skip', 'Continue']) {
      const box = await page.getByRole('button', { name: label }).boundingBox();
      expect(box && box.y >= 0 && box.y + box.height <= 320 && box.x >= 0 && box.x + box.width <= 568, `${label} is off screen: ${JSON.stringify(box)}`);
    }
    await page.locator('#np-name').fill('Robin');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    expect((await youOf(page))?.name === 'Robin', 'landscape Continue did not store the name');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** names changed in another tab reach Home without a reload, and are shown literally (no $ patterns) */
  async 'live-names'() {
    const t0 = Date.now() - 60000;
    const { ctx, page: home, errors } = await open({ [YOU]: JSON.stringify({ name: 'Alice', companion: 'Pip', nameAt: t0, companionAt: t0 }), 'dbt.app.v1': SEEN });
    await reachHub(home);
    expect((await home.locator('.dq-firstshadow').getAttribute('title')) === 'Pip, asleep', 'Home did not start with Pip');
    const a = await ctx.newPage();
    a.on('pageerror', (e) => errors.push('pageerror A: ' + e.message));
    await a.goto(server.url + '/?mute');
    await openSettings(a);
    await a.locator('#set-playerName').fill('Jo$$ $` $1');
    await a.keyboard.press('Enter');
    await a.locator('#set-companion').fill('Lumen');
    await a.keyboard.press('Enter');
    await home.waitForFunction(() => document.querySelector('.dq-firstshadow')?.getAttribute('title') === 'Lumen, asleep', null, { timeout: 10000 });
    const plate = await home.locator('[data-you-name]').first().textContent();
    expect(plate === 'Jo$$ $` $1', 'Home name plate is stale or altered: ' + plate);
    await home.bringToFront();
    await shot(home, '09-live-names');
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx2.addInitScript(([k, v]) => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', '1'); localStorage.setItem(k, v); localStorage.setItem('dbt.app.v1', '{"seenCutscene":true}'); } }, [YOU, JSON.stringify({ name: '{companion} $1', companion: 'Luna', nameAt: t0, companionAt: t0 })]);
    const w = await ctx2.newPage();
    await w.goto(server.url + '/?mute');
    await w.getByText('Welcome, {companion} $1').first().waitFor({ timeout: 20000 });
    expect(!(await w.getByText('Welcome, Luna').count()), 'a {companion} token inside a name was expanded');
    await ctx2.close();
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a save from before names existed loads with the defaults, keeps its progress and accepts a new name */
  async 'old-save'() {
    let base = shared.save;
    if (!base) {
      const seedRun = await open({ 'dbt.app.v1': SEEN });
      await reachHub(seedRun.page);
      base = JSON.parse(await ls(seedRun.page, SAVE));
      await seedRun.ctx.close();
    }
    const old = deepDrop(structuredClone(base), ['playerName', 'companion']);
    const { ctx, page, errors } = await open({ [SAVE]: JSON.stringify(old), 'dbt.app.v1': SEEN });
    await reachHub(page);
    expect((await page.locator('.dq-firstshadow').getAttribute('title')) === 'Moth, asleep', 'old save does not show the default companion');
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === '', 'old save should have no name');
    expect((await page.locator('#set-playerName').getAttribute('placeholder')) === 'Player', 'default name is not Player');
    await page.locator('#set-playerName').fill('Ash');
    await page.keyboard.press('Enter');
    await sleep(300);
    const save = JSON.parse(await ls(page, SAVE));
    expect(deepFind(save, 'playerName').includes('Ash'), 'old save did not take a new name');
    expect(JSON.stringify(deepDrop(structuredClone(save), ['playerName', 'companion', 'setAt', 'at', 'savedAt', 'updatedAt'])).length >= JSON.stringify(deepDrop(structuredClone(old), ['setAt', 'at', 'savedAt', 'updatedAt'])).length * 0.9, 'old save lost data');
    await shot(page, '07-old-save-named');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};

const pick = flags.scenario ? [flags.scenario] : Object.keys(scenarios);
let failed = 0;
try {
  for (const name of pick) {
    if (!scenarios[name]) throw new Error('no scenario ' + name);
    const t = Date.now();
    try {
      await scenarios[name]();
      report.scenarios.push({ name, ok: true, ms: Date.now() - t });
      console.log(`ok   ${name} (${Date.now() - t} ms)`);
    } catch (e) {
      failed++;
      report.scenarios.push({ name, ok: false, ms: Date.now() - t, error: String(e?.message ?? e) });
      console.log(`FAIL ${name}: ${e?.message ?? e}`);
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await server.stop();
}
console.log(`${pick.length - failed}/${pick.length} passed, artifacts in ${path.relative(root, out)}`);
process.exit(failed ? 1 : 0);
