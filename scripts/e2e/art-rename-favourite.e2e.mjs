// Art room: rename a drawing, mark favourites (shown first with a mint star) and bring a removed one back with Undo.
// Labels are not a new version of a drawing, so two tabs, a Save Crystal and an old save all keep them, and storage that
// can't write keeps the newest ones for the visit (a restore says so).
// art-home-waits-for-welcome holds the browser clock at Home, before the welcome's delay, then checks reaching Home
// closes the due welcome before Art can be tapped, with the page CPU running four times slower.
import fs from 'node:fs';
import path from 'node:path';
import { line as stroke } from './art-eraser-glow.e2e.mjs';

const PHONES = [{ width: 390, height: 844 }, { width: 320, height: 568 }];
const line = (x, y, i = 1) => ({ i, w: 25, p: [x, y, x + 300, y + 80, x + 520, y + 20] });
const records = (page) => page.evaluate(async () => (await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).exportAll()).records);
const xp = (page, key) => page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '{}').events ?? []).reduce((n, e) => n + (e.xp ?? 0), 0), key);
const order = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.dataset.piece));

async function seed(page) {
  await page.evaluate(async (strokes) => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    const day = window.__daily.store.today();
    await as.put({ id: 'pg-a', kind: 'today', day, t: 1, updated: 1, n: 1, prompt: 'Draw the weather inside.', strokes: [strokes[0]] });
    await as.put({ id: 'pg-b', kind: 'today', day, t: 2, updated: 2, n: 1, strokes: [strokes[1]] });
    await as.put({ id: 'al-c', kind: 'ally', day, t: 3, updated: 3, n: 1, name: 'Ember', strokes: [strokes[2]] });
  }, [line(200, 500), line(300, 900, 3), line(250, 600, 2)]);
}

async function toArt(h, page) {
  // from Settings (after a restore) straight in, so Home's greeting can't open over the way
  if (await page.locator('.dq-settings').count()) await page.evaluate(() => window.__daily.go({ name: 'art' }));
  else {
    await h.reachHub(page);
    await page.locator('.dq-tile--art').click();
  }
  await page.locator('.dq-artroom .dq-galitem').first().waitFor();
}

async function openPiece(page, id) {
  await page.locator(`[data-piece="${id}"]`).click();
  await page.locator('.dq-piece-labels').waitFor();
}

/** Keep drawing on a saved drawing, from its page, once the drawing page has slid in. */
async function keepDrawing(page, id) {
  await openPiece(page, id);
  await page.getByRole('button', { name: 'Keep drawing', exact: true }).click();
  await page.waitForFunction(() => window.__daily?.ink?.strokes.length === 1 && !document.querySelector('.dq-ink-stage')?.inert);
  await page.waitForFunction(() => !document.querySelector('.dq-draw')?.getAnimations().some((a) => a.playState === 'running'));
}

/** A second tab, on the Art room. */
async function other(h, ctx, errors) {
  const b = await ctx.newPage();
  b.setDefaultTimeout(15000);
  b.on('pageerror', (e) => errors.push(e.message));
  await b.goto(h.server.url + '/?mute');
  await toArt(h, b);
  return b;
}

/** Names a drawing on its page (and with `fav` makes it a favourite), then goes back to the gallery. */
async function nameIt(page, id, name, fav = false) {
  await openPiece(page, id);
  if (fav) await page.getByRole('button', { name: 'Favourite', exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.locator('.dq-piece-rename input').fill(name);
  await page.keyboard.press('Enter');
  await page.locator('.dq-piece-h', { hasText: name }).waitFor();
  await page.locator('.dq-back').click();
  await page.locator('.dq-artroom .dq-galitem').first().waitFor();
}

/** Storage that reads but can't write drawings (full), until `writable` or the page loads again. */
const full = (page) =>
  page.evaluate(() => {
    const transaction = (window.__transaction ??= IDBDatabase.prototype.transaction);
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      if (mode === 'readwrite' && this.name.endsWith('.art')) throw new DOMException('The disk is full.', 'QuotaExceededError');
      return transaction.call(this, stores, mode, ...rest);
    };
  });
const writable = (page) => page.evaluate(() => (IDBDatabase.prototype.transaction = window.__transaction));
/** A drawing's meta as it is stored on disk, not as this copy holds it in memory. */
const stored = (page, id) =>
  page.evaluate(
    (id) =>
      new Promise((ok, bad) => {
        const open = indexedDB.open(`${window.__daily.store.key}.art`);
        open.onerror = () => bad(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const g = db.transaction('meta').objectStore('meta').get(id);
          g.onsuccess = () => (db.close(), ok(g.result ?? null));
          g.onerror = () => (db.close(), bad(g.error));
        };
      }),
    id,
  );
/** Restores a version of `id` drawn after the one stored here, from a file with no labels on it. */
const restoreNewer = (page, id) =>
  page.evaluate(
    async ({ id, more }) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      const { name, nameAt, fav, favAt, ...was } = (await as.exportAll()).records.find((r) => r.id === id);
      return as.importAll([{ ...was, rev: `later-${was.strokes.length}`, updated: was.updated + 1000, n: was.strokes.length + 1, strokes: [...was.strokes, more] }]);
    },
    { id, more: line(400, 300, 2) },
  );
/** Another tab saves a new version of `id` (one more stroke), as its Save does. */
const saveNewer = (page, id) =>
  page.evaluate(
    async ({ id, more }) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      const rec = await as.get(id);
      await as.put({ ...rec, strokes: [...rec.strokes, more], n: rec.strokes.length + 1 });
    },
    { id, more: line(100, 1200, 3) },
  );

/** Scrolls the gallery's heading to just under the top bar, so a shot shows the gallery with its heading. */
const toGallery = (page) =>
  page.locator('.dq-art-pages').evaluate((sec) => {
    const bar = document.querySelector('.dq-top')?.getBoundingClientRect().bottom ?? 0;
    let s = sec.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    (s ?? document.scrollingElement).scrollBy(0, sec.getBoundingClientRect().top - bar - 8);
  });
/** Nothing on screen is mid-animation (a fade, a window), so a shot shows the screen as it rests. */
const steady = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));

async function until(h, read, check, message, tries = 120) {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (check(v)) return v;
    await h.sleep(100);
  }
  throw new Error(message);
}

/** Nothing sticks out sideways, and the piece page's controls sit inside the screen with readable text. */
async function fits(h, page, where) {
  const r = await page.evaluate(() => {
    const w = innerWidth;
    const out = [...document.querySelectorAll('.dq-piece-labels button, .dq-piece-rename input, .dq-piece-rename button, .dq-piece-h, .dq-galitem-d')]
      .filter((e) => e.getClientRects().length)
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.left < -0.5 || b.right > w + 0.5;
      })
      .map((e) => e.className);
    const input = document.querySelector('.dq-piece-rename input');
    return { scroll: document.documentElement.scrollWidth, w, out, input: input && input.getClientRects().length ? parseFloat(getComputedStyle(input).fontSize) : null };
  });
  h.expect(r.scroll <= r.w + 1 && !r.out.length, `${where}: something runs off the screen: ${JSON.stringify(r)}`);
  h.expect(r.input === null || r.input >= 16, `${where}: the name field's text is under 16 px: ${r.input}`);
}

async function crystalOf(h, page, name) {
  await page.evaluate(() => window.__daily.go({ name: 'settings' }));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save Crystal', exact: true }).click()]);
  const file = path.join(h.out, `${name}.json`);
  await dl.saveAs(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function restore(page, raw) {
  // a fresh Settings each time, so the last restore's message is not read as this one's
  await page.evaluate(() => window.__daily.go({ name: 'art' }));
  await page.locator('.dq-artroom').waitFor();
  await page.evaluate(() => window.__daily.go({ name: 'settings' }));
  await page.locator('.dq-settings').waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: 'crystal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
  await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
  await page.waitForFunction(() => /Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
}

export const scenarios = {
  async 'art-home-waits-for-welcome'(h) {
    let paused = false;
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', PHONES[0], async (ctx) => {
      await ctx.clock.install();
      await ctx.route('**/src/daily/index.ts*', async (route) => {
        await ctx.clock.pauseAt((await route.request().frame().evaluate(() => Date.now())) + 1000);
        paused = true;
        await route.continue();
      });
    });
    try {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const state = () => page.evaluate(() => ({ home: !!document.querySelector('.dq-tile'), greeting: window.__daily?.greeting, window: !!document.querySelector('.dq-sw'), inert: document.querySelector('#dq-main')?.inert }));
      for (const end = Date.now() + 30000; !(await state()).home && Date.now() < end; ) await page.clock.runFor(20);
      const before = await state();
      h.expect(paused, 'the navigation did not pass through the clock gate');
      h.expect(before.home && before.greeting && !before.window, 'the welcome was not pending when Home became ready: ' + JSON.stringify(before));
      let reached;
      let closed;
      let failed;
      const reaching = h.reachHub(page).then(async (names) => { closed = names; reached = await state(); }, (e) => { failed = e; });
      for (const end = Date.now() + 30000; !reached && !failed && Date.now() < end; ) await page.clock.runFor(50);
      await reaching;
      if (failed) throw failed;
      h.expect(JSON.stringify(closed) === '["Notification"]', 'the helper did not close the due welcome: ' + JSON.stringify(closed));
      h.expect(reached && !reached.greeting && !reached.window && !reached.inert, 'reaching Home returned before the pending welcome closed: ' + JSON.stringify(reached));
      await page.clock.resume();
      await seed(page);
      await page.locator('.dq-tile--art').click();
      await page.locator('.dq-artroom .dq-galitem').first().waitFor();
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** A hidden page retires its rename sheet, including when another tab brings the page back with Undo. */
  async 'art-rename-closes-when-hidden'(h) {
    for (const undo of [false, true]) {
      const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', PHONES[0]);
      try {
        await h.reachHub(page);
        await seed(page);
        await toArt(h, page);
        await openPiece(page, 'pg-b');
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        await page.getByLabel('Name this page').fill('An unfinished name');
        const other = await ctx.newPage();
        other.on('pageerror', (e) => errors.push(e.message));
        other.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
        await other.goto(h.server.url + '/?mute');
        await toArt(h, other);
        await openPiece(other, 'pg-b');
        await other.getByRole('button', { name: 'Remove', exact: true }).click();
        await page.getByText('That page is no longer here.', { exact: true }).waitFor();
        if (undo) {
          await other.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
          await page.locator('.dq-piece-labels').waitFor();
        }
        await page.waitForFunction(() => history.state?.dq === 1 && !history.state.sheet, null, { timeout: 3000 });
        await page.goBack({ waitUntil: 'commit' });
        await page.waitForFunction(() => window.__daily.route.name === 'art', null, { timeout: 3000 });
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** A name being typed stays in its field while newer saved artwork and labels show behind it. */
  async 'art-rename-keeps-other-tab-updates'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', PHONES[0]);
    try {
      await h.reachHub(page);
      await seed(page);
      await toArt(h, page);
      await openPiece(page, 'pg-a');
      const before = await page.locator('.dq-piece-art canvas').evaluate((c) => c.toDataURL());
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await page.getByLabel('Name this page').fill('My draft name');
      const other = await ctx.newPage();
      other.on('pageerror', (e) => errors.push(e.message));
      other.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
      await other.goto(h.server.url + '/?mute');
      await toArt(h, other);
      await openPiece(other, 'pg-a');
      await other.evaluate(async (stroke) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const rec = await as.get('pg-a');
        await as.put({ ...rec, strokes: [...rec.strokes, stroke], n: rec.strokes.length + 1 });
      }, line(100, 1200, 3));
      await page.waitForFunction((was) => document.querySelector('.dq-piece-art canvas').toDataURL() !== was, before, { timeout: 5000 });
      await other.getByRole('button', { name: 'Rename', exact: true }).click();
      await other.getByLabel('Name this page').fill('Named elsewhere');
      await other.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.dq-piece-h')?.textContent === 'Named elsewhere');
      h.expect(await page.getByLabel('Name this page').inputValue() === 'My draft name', 'a remote update replaced the name being typed');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await other.getByRole('button', { name: 'Rename', exact: true }).click();
      await other.getByLabel('Name this page').fill('Named twice');
      await other.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.dq-piece-h')?.textContent === 'Named twice');
      await page.keyboard.press('Enter');
      await page.locator('.dq-piece-rename').waitFor({ state: 'hidden' });
      h.expect((await records(page)).find((r) => r.id === 'pg-a')?.name === 'Named twice', 'an untouched name field overwrote the newer name from the other tab');
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
      await other.getByText('That page is no longer here.', { exact: true }).waitFor();
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** On a phone: favourite, rename (Enter, Escape, empty, the length cap), Remove and Release with Undo, the Safe Zone. */
  async 'art-rename-favourite-undo'(h) {
    for (const vp of PHONES) {
      const at = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', vp);
      page.setDefaultTimeout(15000);
      await h.reachHub(page);
      await seed(page);
      const xp0 = await xp(page, h.SAVE);
      await toArt(h, page);
      h.expect(JSON.stringify(await order(page, '.dq-galitem')) === '["al-c","pg-b","pg-a"]', `${at}: the gallery is not newest first before any favourite`);
      const v0 = (await records(page)).find((r) => r.id === 'pg-a');

      // favourite: a pressed toggle with a mint star, stored on the drawing
      await openPiece(page, 'pg-a');
      const fav = page.getByRole('button', { name: 'Favourite', exact: true });
      h.expect((await fav.getAttribute('aria-pressed')) === 'false', `${at}: a new page starts as a favourite`);
      await fav.click();
      h.expect((await fav.getAttribute('aria-pressed')) === 'true', `${at}: Favourite did not press`);
      const mint = await fav.locator('.dq-btn-ic').evaluate((e) => getComputedStyle(e).color);
      h.expect(mint === 'rgb(137, 207, 157)', `${at}: the favourite star is not mint: ${mint}`);
      await until(h, () => records(page), (rs) => rs.find((r) => r.id === 'pg-a')?.fav === true, `${at}: the favourite was not stored`);

      // rename: Escape leaves it, Enter saves it, the cap holds, empty goes back to the day
      const head = page.locator('.dq-piece-h');
      const dayTitle = (await head.textContent()).trim();
      const rename = page.getByRole('button', { name: 'Rename', exact: true });
      await rename.click();
      const input = page.getByLabel('Name this page');
      h.expect(await input.evaluate((e) => e === document.activeElement), `${at}: Rename did not put the cursor in the name field`);
      await fits(h, page, `${at} rename open`);
      await h.shot(page, `${at}-rename-open`);
      await input.fill('Not this one');
      await page.keyboard.press('Escape');
      h.expect(await page.locator('.dq-piece-rename').isHidden(), `${at}: Escape did not close the name field`);
      h.expect((await head.textContent()).trim() === dayTitle, `${at}: Escape still renamed the page`);
      h.expect(await rename.evaluate((e) => e === document.activeElement), `${at}: focus did not return to Rename after Escape`);
      h.expect((await page.locator('.dq').getAttribute('data-screen')) === 'piece', `${at}: Escape in the name field left the page`);
      // Back closes it like any sheet, and stays on the page
      await rename.click();
      await input.fill('Not this either');
      await page.evaluate(() => history.back());
      await until(h, () => page.locator('.dq-piece-rename').isHidden(), (v) => v, `${at}: Back did not close the name field`);
      await h.sleep(300);
      h.expect((await page.locator('.dq').getAttribute('data-screen')) === 'piece' && (await head.textContent()).trim() === dayTitle, `${at}: Back in the name field left the page or renamed it`);
      h.expect(await rename.evaluate((e) => e === document.activeElement), `${at}: focus did not return to Rename after Back`);
      await rename.click();
      await input.fill('A very long name that keeps going on');
      h.expect((await input.inputValue()).length === 24, `${at}: the name field takes more than 24 characters`);
      await input.fill('Rain window');
      await page.keyboard.press('Enter');
      await until(h, async () => (await head.textContent()).trim(), (t) => t === 'Rain window', `${at}: the new name does not show`);
      h.expect((await page.locator('.dq-piece-day').textContent()).trim() === dayTitle && await page.locator('.dq-piece-day').isVisible(), `${at}: a named page does not show its day under the name`);
      const named = await until(h, () => records(page), (rs) => rs.find((r) => r.id === 'pg-a')?.name === 'Rain window', `${at}: the name was not stored`);
      const v1 = named.find((r) => r.id === 'pg-a');
      h.expect(v1.rev === v0.rev && v1.updated === v0.updated && v1.nameAt > 0 && v1.favAt > 0, `${at}: a label made a new version: ${JSON.stringify({ v0: [v0.rev, v0.updated], v1: [v1.rev, v1.updated, v1.nameAt, v1.favAt] })}`);
      h.expect(named.length === 3, `${at}: a label made another page`);
      await fits(h, page, `${at} piece named`);
      await h.shot(page, `${at}-piece-named-favourite`);

      // the gallery: favourites first, a mint star and the name in the caption
      await page.locator('.dq-back').click();
      await page.locator('.dq-artroom .dq-galitem').first().waitFor();
      await until(h, () => order(page, '.dq-galitem'), (o) => JSON.stringify(o) === '["pg-a","al-c","pg-b"]', `${at}: the favourite is not first in the gallery`);
      const first = page.locator('.dq-galitem').first();
      h.expect((await first.locator('.dq-galitem-d').textContent()).includes('Rain window') && await first.locator('.dq-galitem-fav').isVisible(), `${at}: the favourite's caption has no name or star`);
      h.expect(/^Rain window, a page from .+, a favourite$/.test(await first.getAttribute('aria-label')), `${at}: the favourite's label does not say so: ${await first.getAttribute('aria-label')}`);
      await fits(h, page, `${at} gallery`);
      await toGallery(page);
      await steady(page);
      await h.shot(page, `${at}-gallery-favourite-first`);

      // an empty name goes back to the day
      await openPiece(page, 'pg-b');
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await page.getByLabel('Name this page').fill('Soon gone');
      await page.getByRole('button', { name: 'Save name', exact: true }).click();
      await until(h, async () => (await head.textContent()).trim(), (t) => t === 'Soon gone', `${at}: Save name did not rename`);
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await page.getByLabel('Name this page').fill('   ');
      await page.keyboard.press('Enter');
      await until(h, async () => (await head.textContent()).trim(), (t) => t === dayTitle, `${at}: an empty name did not go back to the day`);
      h.expect(await page.locator('.dq-piece-day').isHidden(), `${at}: an unnamed page shows its day twice`);
      await until(h, () => records(page), (rs) => !rs.find((r) => r.id === 'pg-b')?.name, `${at}: the empty name was stored`);

      // Remove: no question, the page goes at once, Undo brings it back to its place with focus on it
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
      await page.locator('.dq-artroom').waitFor();
      h.expect(!(await page.locator('.dq-piece-confirm, [role=alertdialog]').count()) && !(await page.getByRole('button', { name: 'Keep it' }).count()), `${at}: Remove still asks`);
      const toast = page.locator('.dq-toast');
      await toast.getByText('Page removed.', { exact: true }).waitFor();
      await until(h, () => order(page, '.dq-galitem'), (o) => !o.includes('pg-b'), `${at}: the removed page still shows`);
      h.expect((await records(page)).some((r) => r.id === 'pg-b'), `${at}: the page was gone before its Undo ran out`);
      await fits(h, page, `${at} toast`);
      // the gallery behind the toast, both at rest
      await toGallery(page);
      await h.sleep(500);
      await steady(page);
      await h.shot(page, `${at}-removed-toast`);
      await toast.getByRole('button', { name: 'Undo', exact: true }).click();
      await until(h, () => order(page, '.dq-galitem'), (o) => JSON.stringify(o) === '["pg-a","al-c","pg-b"]', `${at}: Undo did not bring the page back to its place`);
      await until(h, () => page.evaluate(() => document.activeElement?.dataset?.piece), (f) => f === 'pg-b', `${at}: focus did not go to the page Undo brought back`);
      await h.sleep(7000);
      h.expect((await records(page)).some((r) => r.id === 'pg-b'), `${at}: the page Undo brought back was removed later`);

      // and without Undo the removal lands once the toast goes
      await openPiece(page, 'pg-b');
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
      await toast.getByText('Page removed.', { exact: true }).waitFor();
      await toast.waitFor({ state: 'hidden', timeout: 12000 });
      await until(h, () => records(page), (rs) => !rs.some((r) => r.id === 'pg-b'), `${at}: the removal did not land when the toast went`);
      h.expect(!(await order(page, '.dq-galitem')).includes('pg-b'), `${at}: the removed page came back`);

      // Release an ally: Shadows, Undo, focus on the card; Shadows shows favourites first with a star
      await openPiece(page, 'al-c');
      await page.getByRole('button', { name: 'Favourite', exact: true }).click();
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await page.getByLabel('Name your ally').fill('Ember Light');
      await page.keyboard.press('Enter');
      await until(h, () => page.locator('.dq-piece .dq-allycard-name').textContent(), (t) => t.trim() === 'Ember Light', `${at}: the ally card does not show the new name`);
      await page.getByRole('button', { name: 'Release', exact: true }).click();
      await page.locator('.dq-shadows').waitFor();
      await toast.getByText('Ally released.', { exact: true }).waitFor();
      h.expect(!(await order(page, '.dq-allybtn')).includes('al-c'), `${at}: the released ally still shows`);
      await toast.getByRole('button', { name: 'Undo', exact: true }).click();
      await until(h, () => page.evaluate(() => document.activeElement?.dataset?.piece), (f) => f === 'al-c', `${at}: focus did not go to the ally Undo brought back`);
      const card = page.locator('.dq-allybtn[data-piece="al-c"]');
      h.expect(await card.locator('.dq-allycard-fav').isVisible() && (await card.getAttribute('aria-label')).startsWith('Ember Light, a shadow ally you designed, a favourite'), `${at}: the favourite ally has no star or name on Shadows`);
      await card.scrollIntoViewIfNeeded();
      await h.shot(page, `${at}-shadows-undo`);

      // a toast open when the Safe Zone opens goes, and the removal lands
      await openPiece(page, 'al-c');
      await page.getByRole('button', { name: 'Release', exact: true }).click();
      await toast.getByText('Ally released.', { exact: true }).waitFor();
      await page.locator('.dq-safe').click();
      await page.locator('.dq[data-screen="safe"]').waitFor();
      h.expect(await toast.isHidden(), `${at}: the toast followed into the Safe Zone`);
      await until(h, () => records(page), (rs) => !rs.some((r) => r.id === 'al-c'), `${at}: the release did not land when the Safe Zone opened`);
      await h.shot(page, `${at}-safe-zone-no-toast`);

      h.expect((await xp(page, h.SAVE)) === xp0, `${at}: labels or Undo changed XP`);
      h.expect(!errors.length, `${at}: ${errors.join('\n')}`);
      await ctx.close();
    }
  },

  /** Two tabs: a name set in one and a favourite in the other both stay through an edit saved in the first. */
  async 'art-labels-two-tabs'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    await openPiece(a, 'pg-a');
    await a.getByRole('button', { name: 'Rename', exact: true }).click();
    await a.getByLabel('Name this page').fill('Harbour');
    await a.keyboard.press('Enter');
    await a.locator('.dq-piece-h', { hasText: 'Harbour' }).waitFor();
    await a.getByRole('button', { name: 'Keep drawing', exact: true }).click();
    await a.waitForFunction(() => window.__daily?.ink?.strokes.length === 1 && !document.querySelector('.dq-ink-stage')?.inert);

    const b = await ctx.newPage();
    b.setDefaultTimeout(15000);
    await b.setViewportSize({ width: 320, height: 568 });
    await b.goto(h.server.url + '/?mute');
    await toArt(h, b);
    await openPiece(b, 'pg-a');
    h.expect((await b.locator('.dq-piece-h').textContent()).trim() === 'Harbour', 'the other tab does not show the new name');
    await b.getByRole('button', { name: 'Favourite', exact: true }).click();
    await until(h, () => records(b), (rs) => rs.find((r) => r.id === 'pg-a')?.fav === true, 'the favourite was not stored');

    // A saves an edit it began before the favourite
    const box = await a.locator('.dq-ink-live').boundingBox();
    await a.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 10 });
    await a.mouse.up();
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = await until(h, () => records(a), (rs) => rs.find((r) => r.id === 'pg-a')?.strokes.length === 2, 'the edit was not saved');
    const rec = saved.find((r) => r.id === 'pg-a');
    h.expect(rec.name === 'Harbour' && rec.fav === true && saved.length === 3, `the edit lost a label or split the page: ${JSON.stringify({ name: rec.name, fav: rec.fav, ids: saved.map((r) => r.id) })}`);
    // B's open page shows what A saved, and B renames while A keeps drawing
    await until(h, () => b.locator('.dq-piece-fav').getAttribute('aria-pressed'), (v) => v === 'true', 'the other tab lost the favourite');
    await b.getByRole('button', { name: 'Rename', exact: true }).click();
    await b.getByLabel('Name this page').fill('Harbour light');
    await b.keyboard.press('Enter');
    await until(h, () => records(b), (rs) => rs.find((r) => r.id === 'pg-a')?.name === 'Harbour light', 'the second name was not stored');
    await a.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 10 });
    await a.mouse.up();
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    const again = await until(h, () => records(a), (rs) => rs.find((r) => r.id === 'pg-a')?.strokes.length === 3, 'the second edit was not saved');
    const last = again.find((r) => r.id === 'pg-a');
    h.expect(last.name === 'Harbour light' && last.fav === true && again.length === 3, `the second edit lost the other tab's name: ${JSON.stringify({ name: last.name, fav: last.fav, ids: again.map((r) => r.id) })}`);
    // B's gallery shows it first, named, with its star, without a reload
    await b.locator('.dq-back').click();
    await until(h, () => b.locator('.dq-galitem').first().getAttribute('aria-label'), (l) => /^Harbour light, a page from .+, a favourite$/.test(l ?? ''), 'the other tab\'s gallery does not show the labels');
    await h.shot(b, 'two-tabs-gallery-320');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** A Save Crystal carries the labels both ways, a newer label wins either way, and an old save with none still opens. */
  async 'art-labels-crystal-old-save'(h) {
    const p = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    p.page.setDefaultTimeout(15000);
    await h.reachHub(p.page);
    await seed(p.page);
    await toArt(h, p.page);
    await openPiece(p.page, 'pg-a');
    await p.page.getByRole('button', { name: 'Favourite', exact: true }).click();
    await p.page.getByRole('button', { name: 'Rename', exact: true }).click();
    await p.page.getByLabel('Name this page').fill('Night sky');
    await p.page.keyboard.press('Enter');
    await p.page.locator('.dq-piece-h', { hasText: 'Night sky' }).waitFor();
    const raw = await crystalOf(h, p.page, 'crystal-labels');
    const out = raw.art.find((r) => r.id === 'pg-a');
    h.expect(out?.name === 'Night sky' && out.fav === true && out.nameAt > 0 && out.favAt > 0, 'the Save Crystal lost the labels: ' + JSON.stringify(out && { name: out.name, nameAt: out.nameAt, fav: out.fav, favAt: out.favAt }));
    h.expect(!p.errors.length, p.errors.join('\n'));
    await p.ctx.close();

    // an old save: drawings with no labels, one with a field from a newer build
    const q = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 320, height: 568 });
    q.page.setDefaultTimeout(15000);
    await h.reachHub(q.page);
    const strip = ({ nameAt, fav, favAt, ...r }) => r;
    const old = { ...raw, art: raw.art.map((r) => (r.id === 'pg-a' ? r : { ...strip(r), ...(r.id === 'pg-b' ? { glaze: { k: 1 } } : {}) })) };
    await restore(q.page, old);
    await toArt(h, q.page);
    h.expect(JSON.stringify(await order(q.page, '.dq-galitem')) === '["pg-a","al-c","pg-b"]', 'a restored favourite is not first');
    await openPiece(q.page, 'pg-b');
    h.expect((await q.page.locator('.dq-piece-fav').getAttribute('aria-pressed')) === 'false', 'an old drawing came back as a favourite');
    await q.page.getByRole('button', { name: 'Rename', exact: true }).click();
    await q.page.getByLabel('Name this page').fill('Old one');
    await q.page.keyboard.press('Enter');
    const renamed = await until(h, () => records(q.page), (rs) => rs.find((r) => r.id === 'pg-b')?.name === 'Old one', 'an old drawing could not be renamed');
    h.expect(JSON.stringify(renamed.find((r) => r.id === 'pg-b').glaze) === '{"k":1}', 'renaming dropped a field a newer build stored');
    await h.shot(q.page, 'old-save-renamed-320');

    // a newer name here stays when the older file comes in again; a newer one in the file comes in; no page doubles
    await q.page.evaluate(() => window.__daily.go({ name: 'piece', id: 'pg-a' }));
    await q.page.locator('.dq-piece-labels').waitFor();
    await q.page.getByRole('button', { name: 'Rename', exact: true }).click();
    await q.page.getByLabel('Name this page').fill('Stars');
    await q.page.keyboard.press('Enter');
    await until(h, () => records(q.page), (rs) => rs.find((r) => r.id === 'pg-a')?.name === 'Stars', 'the rename was not stored');
    await restore(q.page, raw);
    let rs = await records(q.page);
    h.expect(rs.length === 3 && rs.find((r) => r.id === 'pg-a').name === 'Stars' && rs.find((r) => r.id === 'pg-a').fav === true, 'an older name in a file replaced a newer one, or the page doubled: ' + JSON.stringify(rs.map((r) => [r.id, r.name, r.fav])));
    const newer = { ...raw, art: raw.art.map((r) => (r.id === 'pg-a' ? { ...r, name: 'From the file', nameAt: Date.now() + 60000, fav: false, favAt: Date.now() + 60000 } : r)) };
    await restore(q.page, newer);
    rs = await records(q.page);
    h.expect(rs.length === 3 && rs.find((r) => r.id === 'pg-a').name === 'From the file' && rs.find((r) => r.id === 'pg-a').fav === false, 'a newer name in a file did not come in, or the page doubled: ' + JSON.stringify(rs.map((r) => [r.id, r.name, r.fav])));
    await toArt(h, q.page);
    await until(h, () => order(q.page, '.dq-galitem'), (o) => JSON.stringify(o) === '["al-c","pg-b","pg-a"]', 'the gallery does not show the restored labels');
    h.expect(!q.errors.length, q.errors.join('\n'));
    await q.ctx.close();
  },

  /** The Enter that confirms an IME composition (isComposing, or keyCode 229 as Safari sends it) doesn't save the name. */
  async 'art-rename-ime-enter'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    page.setDefaultTimeout(15000);
    await h.reachHub(page);
    await seed(page);
    await toArt(h, page);
    await openPiece(page, 'pg-a');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    const input = page.getByLabel('Name this page');
    await input.fill('きょう');
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      const kept = await input.evaluate((el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })), init);
      await h.sleep(300);
      h.expect(kept, `the composing Enter was cancelled: ${JSON.stringify(init)}`);
      h.expect(await page.locator('.dq-piece-rename').isVisible(), `a composing Enter closed the name field: ${JSON.stringify(init)}`);
      h.expect(!(await records(page)).find((r) => r.id === 'pg-a').name, `a composing Enter saved the name: ${JSON.stringify(init)}`);
    }
    await page.keyboard.press('Enter');
    await until(h, () => records(page), (rs) => rs.find((r) => r.id === 'pg-a')?.name === 'きょう', 'Enter after the composition did not save the name');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * Storage that reads but can't write (full): a rename and a favourite still hold for the visit and go into a Save
   * Crystal, and once storage writes again, the next change stored takes them with it.
   */
  async 'art-labels-write-fails'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    page.setDefaultTimeout(15000);
    await h.reachHub(page);
    await seed(page);
    const relabel = async (id, name) => {
      await openPiece(page, id);
      await page.getByRole('button', { name: 'Favourite', exact: true }).click();
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await page.getByLabel('Name this page').fill(name);
      await page.keyboard.press('Enter');
      await until(h, () => page.locator('.dq-piece-h').textContent(), (t) => t.trim() === name, `${id}: the new name did not show while storage could not write`, 30);
      h.expect((await page.locator('.dq-piece-fav').getAttribute('aria-pressed')) === 'true', `${id}: the favourite did not hold while storage could not write`);
      await page.locator('.dq-back').click();
      await page.locator('.dq-artroom .dq-galitem').first().waitFor();
    };
    const crystalHas = async (id, name) => {
      const rs = await records(page);
      const r = rs.find((r) => r.id === id);
      h.expect(rs.length === 3 && r?.name === name && r.fav === true, `${id}: a Save Crystal now would lose the labels: ` + JSON.stringify(rs.map((r) => [r.id, r.name, r.fav])));
    };
    // one this visit saved (so a copy is held in memory too), then, on a later visit, one only the disk holds
    await toArt(h, page);
    await full(page);
    await relabel('pg-b', 'Kept here');
    await crystalHas('pg-b', 'Kept here');
    await page.goto(h.server.url + '/?mute');
    await toArt(h, page);
    await full(page);
    await relabel('pg-a', 'Night');
    await until(h, () => order(page, '.dq-galitem'), (o) => JSON.stringify(o) === '["pg-a","al-c","pg-b"]', 'the gallery does not put the favourite first');
    h.expect(/^Night, .+, a favourite$/.test((await page.locator('[data-piece="pg-a"]').getAttribute('aria-label')) ?? ''), 'the gallery does not show the name and the star');
    await crystalHas('pg-a', 'Night');
    await writable(page);
    await openPiece(page, 'pg-a');
    await page.getByRole('button', { name: 'Favourite', exact: true }).click();
    await until(h, () => stored(page, 'pg-a'), (m) => m?.fav === false, 'the favourite was not stored once storage wrote again');
    await page.goto(h.server.url + '/?mute');
    await h.reachHub(page);
    const after = (await records(page)).find((r) => r.id === 'pg-a');
    h.expect(after?.name === 'Night' && after.fav === false, `the change stored once storage wrote again left the name held for the visit behind: ${JSON.stringify(after && { name: after.name, fav: after.fav })}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * Storage that can't write, once another tab has named two pages: an edit saved here, and a newer version of the other
   * page from a Save Crystal, each keep that tab's name and favourite for the visit.
   */
  async 'art-labels-save-fails'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    await keepDrawing(a, 'pg-a');
    const b = await other(h, ctx, errors);
    await nameIt(b, 'pg-a', 'Harbour', true);
    await nameIt(b, 'pg-b', 'Low tide');
    await until(h, () => records(b), (rs) => rs.find((r) => r.id === 'pg-a')?.fav === true && rs.find((r) => r.id === 'pg-b')?.name === 'Low tide', 'the other tab did not store its labels');

    await full(a);
    await stroke(a, [0.3, 0.6], [0.7, 0.7]);
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    await a.locator('.dq-tools').getByText(/keeping drawings right now/).first().waitFor();
    const edit = (await records(a)).find((r) => r.id === 'pg-a');
    h.expect(edit?.strokes.length === 2 && edit.name === 'Harbour' && edit.fav === true, `the edit storage couldn't keep lost the other tab's labels: ${JSON.stringify(edit && { n: edit.strokes.length, name: edit.name, fav: edit.fav })}`);
    await a.evaluate(() => window.__daily.go({ name: 'art' }));
    await until(h, () => a.locator('[data-piece="pg-a"]').getAttribute('aria-label'), (l) => /^Harbour, a page from .+, a favourite$/.test(l ?? ''), 'the gallery does not show the other tab\'s labels on the edit');

    const res = await restoreNewer(a, 'pg-b');
    const newer = (await records(a)).find((r) => r.id === 'pg-b');
    h.expect(res.unsaved === 1 && newer?.strokes.length === 2 && newer.name === 'Low tide', `the restored version storage couldn't keep lost the name: ${JSON.stringify({ unsaved: res.unsaved, n: newer?.strokes.length, name: newer?.name })}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * Labels set here while storage couldn't write: a newer version a Save Crystal brings keeps them, in memory while
   * storage is still full and on disk once it writes again.
   */
  async 'art-labels-held-restore'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    page.setDefaultTimeout(15000);
    await h.reachHub(page);
    await seed(page);
    await toArt(h, page);
    await full(page);
    await nameIt(page, 'pg-a', 'Held', true);
    await nameIt(page, 'pg-b', 'Also held', true);

    const res = await restoreNewer(page, 'pg-a');
    const held = (await records(page)).find((r) => r.id === 'pg-a');
    h.expect(res.unsaved === 1 && held?.strokes.length === 2 && held.name === 'Held' && held.fav === true, `a newer version restored while storage was full lost the labels held here: ${JSON.stringify({ unsaved: res.unsaved, n: held?.strokes.length, name: held?.name, fav: held?.fav })}`);

    await writable(page);
    await restoreNewer(page, 'pg-b');
    await page.goto(h.server.url + '/?mute');
    await h.reachHub(page);
    const stored = (await records(page)).find((r) => r.id === 'pg-b');
    h.expect(stored?.strokes.length === 2 && stored.name === 'Also held' && stored.fav === true, `a newer version restored once storage wrote again did not store the labels held here: ${JSON.stringify({ n: stored?.strokes.length, name: stored?.name, fav: stored?.fav })}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * Labels set here while storage couldn't write stay on a newer version another tab saves, and when this tab's own edit
   * is kept apart from that version, the page keeps them too, stored once storage writes again.
   */
  async 'art-labels-held-other-tab'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    await full(a);
    await nameIt(a, 'al-c', 'Spark');
    await nameIt(a, 'pg-a', 'Held', true);
    const b = await other(h, ctx, errors);

    await saveNewer(b, 'al-c');
    const ally = await until(h, () => records(a), (rs) => rs.find((r) => r.id === 'al-c')?.strokes.length === 2, 'this tab did not see the other tab\'s save');
    h.expect(ally.find((r) => r.id === 'al-c').name === 'Spark', `the other tab's newer version dropped the name held here: ${ally.find((r) => r.id === 'al-c').name}`);
    await until(h, () => a.locator('[data-piece="al-c"]').getAttribute('aria-label'), (l) => /^Spark, a shadow ally/.test(l ?? ''), 'the gallery lost the name held here');

    await keepDrawing(a, 'pg-a');
    await saveNewer(b, 'pg-a');
    await writable(a);
    await stroke(a, [0.3, 0.6], [0.7, 0.7]);
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    await a.locator('.dq-tools').getByText(/kept as its own page/).first().waitFor();
    await a.goto(h.server.url + '/?mute');
    await h.reachHub(a);
    const rs = await records(a);
    const page = rs.find((r) => r.id === 'pg-a'), apart = rs.find((r) => r.id !== 'pg-a' && r.id.startsWith('pg-a'));
    h.expect(page?.strokes.length === 2 && page.name === 'Held' && page.fav === true && apart?.name === 'Held', `an edit kept apart left the page without the labels held here: ${JSON.stringify(rs.map((r) => [r.id, r.strokes.length, r.name, r.fav]))}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** A restore that brings newer labels says when only this visit keeps them, and what it says holds after a reload. */
  async 'art-labels-restore-unsaved'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    page.setDefaultTimeout(15000);
    await h.reachHub(page);
    await seed(page);
    const raw = await crystalOf(h, page, 'crystal-unlabelled');
    const named = { ...raw, art: raw.art.map((r) => (r.id === 'pg-a' ? { ...r, name: 'From the file', nameAt: Date.now(), fav: true, favAt: Date.now() } : r)) };
    const said = () => page.locator('.dq-settings .dq-hint[aria-live]').textContent();
    const pgA = async () => (await records(page)).find((r) => r.id === 'pg-a');
    const reload = async () => {
      await page.goto(h.server.url + '/?mute');
      await h.reachHub(page);
    };

    await full(page);
    await restore(page, named);
    h.expect(/for this visit only/.test(await said()), `a restore of labels storage couldn't keep did not say so: ${await said()}`);
    h.expect((await pgA()).name === 'From the file', 'the restored name does not show for this visit');
    await reload();
    h.expect(!(await pgA()).name, 'the labels the restore kept for this visit only were stored after all');

    await restore(page, named);
    h.expect(!/for this visit only/.test(await said()), `a stored restore said it kept drawings for this visit only: ${await said()}`);
    await reload();
    const kept = await pgA();
    h.expect(kept.name === 'From the file' && kept.fav === true, `the restored labels did not last a reload: ${JSON.stringify({ name: kept.name, fav: kept.fav })}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** An ally renamed in another tab while this one draws it rises, and saves as an image, under the newer name. */
  async 'art-ally-saved-after-rename'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    await keepDrawing(a, 'al-c');
    const b = await other(h, ctx, errors);
    await nameIt(b, 'al-c', 'Blaze');
    await until(h, () => records(b), (rs) => rs.find((r) => r.id === 'al-c')?.name === 'Blaze', 'the other tab did not store the name');

    await stroke(a, [0.3, 0.6], [0.7, 0.7]);
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    // the name sheet still holds the name this tab opened with: rising with it untouched keeps the newer one
    h.expect((await a.getByRole('textbox', { name: 'Name your ally' }).inputValue()) === 'Ember', 'the name sheet does not start from the name this tab had');
    await a.getByRole('button', { name: 'Rise', exact: true }).click();
    const risen = a.locator('.dq-rise .dq-allycard-name');
    await risen.waitFor();
    h.expect((await risen.textContent()).trim() === 'Blaze', `the ally rose under the old name: ${await risen.textContent()}`);
    const [file] = await Promise.all([a.waitForEvent('download'), a.locator('.dq-rise').getByRole('button', { name: 'Save card image', exact: true }).click()]);
    h.expect(file.suggestedFilename() === 'shadow-ally-blaze.png', `the card image is named for the old name: ${file.suggestedFilename()}`);
    const rec = (await records(a)).find((r) => r.id === 'al-c');
    h.expect(rec?.strokes.length === 2 && rec.name === 'Blaze', `the saved ally lost the newer name: ${JSON.stringify(rec && { n: rec.strokes.length, name: rec.name })}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** Landscape phone and desktop: the gallery, a named favourite, the name field and the toast fit. */
  async 'art-labels-wide'(h) {
    for (const vp of [{ width: 844, height: 390 }, { width: 1280, height: 800 }]) {
      const at = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', vp);
      page.setDefaultTimeout(15000);
      await h.reachHub(page);
      await seed(page);
      await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        await as.setLabels('pg-a', { name: 'Rain window', fav: true });
        await as.setLabels('al-c', { fav: true });
      });
      await toArt(h, page);
      await fits(h, page, `${at} gallery`);
      await h.shot(page, `${at}-gallery`);
      await openPiece(page, 'pg-a');
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await fits(h, page, `${at} rename open`);
      await h.shot(page, `${at}-rename-open`);
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__daily.go({ name: 'piece', id: 'al-c' }));
      await page.locator('.dq-piece-labels').waitFor();
      await fits(h, page, `${at} ally`);
      await h.shot(page, `${at}-ally`);
      await page.getByRole('button', { name: 'Release', exact: true }).click();
      await page.locator('.dq-toast').getByText('Ally released.', { exact: true }).waitFor();
      await h.sleep(900);
      await h.shot(page, `${at}-release-toast`);
      await page.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
      h.expect(!errors.length, `${at}: ${errors.join('\n')}`);
      await ctx.close();
    }
  },
};
