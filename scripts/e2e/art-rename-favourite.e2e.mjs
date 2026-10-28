// Art room: rename a drawing, mark favourites (shown first with a mint star) and bring a removed one back with Undo.
// Labels are not a new version of a drawing, so two tabs, a Save Crystal and an old save all keep them.
// art-home-waits-for-welcome holds the browser clock at Home, before the welcome's delay, then checks reaching Home
// closes the due welcome before Art can be tapped, with the page CPU running four times slower.
import fs from 'node:fs';
import path from 'node:path';

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
      let failed;
      const reaching = h.reachHub(page).then(async () => { reached = await state(); }, (e) => { failed = e; });
      for (const end = Date.now() + 30000; !reached && !failed && Date.now() < end; ) await page.clock.runFor(50);
      await reaching;
      if (failed) throw failed;
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

  /** Storage that reads but can't write (full): a rename and a favourite still hold for the visit and go into a Save Crystal. */
  async 'art-labels-write-fails'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    page.setDefaultTimeout(15000);
    await h.reachHub(page);
    await seed(page);
    const full = () =>
      page.evaluate(() => {
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (mode === 'readwrite' && this.name.endsWith('.art')) throw new DOMException('The disk is full.', 'QuotaExceededError');
          return transaction.call(this, stores, mode, ...rest);
        };
      });
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
    await full();
    await relabel('pg-b', 'Kept here');
    await crystalHas('pg-b', 'Kept here');
    await page.goto(h.server.url + '/?mute');
    await toArt(h, page);
    await full();
    await relabel('pg-a', 'Night');
    await until(h, () => order(page, '.dq-galitem'), (o) => JSON.stringify(o) === '["pg-a","al-c","pg-b"]', 'the gallery does not put the favourite first');
    h.expect(/^Night, .+, a favourite$/.test((await page.locator('[data-piece="pg-a"]').getAttribute('aria-label')) ?? ''), 'the gallery does not show the name and the star');
    await crystalHas('pg-a', 'Night');
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
