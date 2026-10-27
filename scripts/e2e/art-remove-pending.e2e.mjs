// Art room: a removal waiting for its Undo is stored beside the save with the version it hides. Every tab hides it, a
// newer save in any tab wins, a reload finishes it, a Save Crystal restore neither brings it back nor loses it, Undo
// works until the toast is gone, Forward can't reopen it, and a change in another tab keeps the focused card.
import fs from 'node:fs';
import path from 'node:path';

const line = (x, y, i = 1) => ({ i, w: 25, p: [x, y, x + 300, y + 80, x + 520, y + 20] });
const records = (page) => page.evaluate(async () => (await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).exportAll()).records);
const order = (page, sel = '.dq-galitem') => page.locator(sel).evaluateAll((els) => els.map((e) => e.dataset.piece));
const goneMarks = (page) => page.evaluate(() => JSON.parse(localStorage.getItem(`${window.__daily.store.key}.art.gone`) ?? 'null'));
const focused = (page) => page.evaluate(() => document.activeElement?.dataset?.piece ?? document.activeElement?.className ?? null);

async function seed(page) {
  await page.evaluate(async (strokes) => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    const day = window.__daily.store.today();
    await as.put({ id: 'pg-a', kind: 'today', day, t: 1, updated: 1, n: 1, strokes: [strokes[0]] });
    await as.put({ id: 'pg-b', kind: 'today', day, t: 2, updated: 2, n: 1, name: 'Tide', strokes: [strokes[1]] });
    await as.put({ id: 'al-c', kind: 'ally', day, t: 3, updated: 3, n: 1, name: 'Ember', strokes: [strokes[2]] });
  }, [line(200, 500), line(300, 900, 3), line(250, 600, 2)]);
}

async function toArt(h, page) {
  if (await page.locator('.dq-settings').count()) await page.evaluate(() => window.__daily.go({ name: 'art' }));
  else {
    await h.reachHub(page);
    await page.locator('.dq-tile--art').click();
  }
  await page.locator('.dq-artroom').locator('.dq-galitem, .dq-empty').first().waitFor();
}

async function openPiece(page, id) {
  await page.locator(`[data-piece="${id}"]`).click();
  await page.locator('.dq-piece-labels').waitFor();
}

async function removePiece(page, id) {
  await openPiece(page, id);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.locator('.dq-toast').getByText('Page removed.', { exact: true }).waitFor();
}

async function until(h, read, check, message, tries = 120) {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (check(v)) return v;
    await h.sleep(100);
  }
  throw new Error(message);
}

async function second(h, ctx, viewport) {
  const b = await ctx.newPage();
  b.setDefaultTimeout(15000);
  if (viewport) await b.setViewportSize(viewport);
  await b.goto(h.server.url + '/?mute');
  await toArt(h, b);
  return b;
}

/** Scrolls the gallery's heading to just under the top bar, so a shot shows the gallery with its heading. */
const toGallery = (page) =>
  page.locator('.dq-art-pages').evaluate((sec) => {
    const bar = document.querySelector('.dq-top')?.getBoundingClientRect().bottom ?? 0;
    let s = sec.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    (s ?? document.scrollingElement).scrollBy(0, sec.getBoundingClientRect().top - bar - 8);
  });
/** Nothing on screen is mid-animation, so a shot shows the screen as it rests. */
const steady = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));

async function stroke(page) {
  const box = await page.locator('.dq-ink-live').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 10 });
  await page.mouse.up();
}

export const scenarios = {
  /** An edit saved in another tab during the Undo wins; the other tab hides the page too and gets it back with Undo. */
  async 'art-remove-other-tab'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    const b = await second(h, ctx, { width: 320, height: 568 });

    // B edits pg-a; A removes it; B saves during A's Undo: B's edit stays everywhere
    await b.locator('[data-piece="pg-a"]').click();
    await b.getByRole('button', { name: 'Keep drawing', exact: true }).click();
    await b.waitForFunction(() => window.__daily?.ink?.strokes.length === 1 && !document.querySelector('.dq-ink-stage')?.inert);
    await removePiece(a, 'pg-a');
    const t0 = Date.now();
    await stroke(b);
    await b.getByRole('button', { name: 'Save', exact: true }).click();
    await until(h, () => records(b), (rs) => rs.find((r) => r.id === 'pg-a')?.strokes.length === 2, 'the other tab\'s edit was not saved');
    h.expect(Date.now() - t0 < 5000, `the edit took ${Date.now() - t0} ms, past the Undo`);
    await a.locator('.dq-toast').waitFor({ state: 'hidden', timeout: 12000 });
    await h.sleep(800);
    const after = await records(a);
    h.expect(after.find((r) => r.id === 'pg-a')?.strokes.length === 2, `the edit saved in the other tab was wiped when the Undo ran out: ${JSON.stringify(after.map((r) => [r.id, r.strokes.length]))}`);
    h.expect((await order(a)).includes('pg-a'), 'the kept page is not in the gallery of the tab that removed it');
    h.expect(!(await goneMarks(a)), 'the finished removal stayed stored');

    // A removes pg-b: B's gallery hides it too, and A's Undo brings it back there
    await b.evaluate(() => window.__daily.go({ name: 'art' }));
    await until(h, () => order(b), (o) => o.includes('pg-a') && o.includes('pg-b'), 'the other tab\'s gallery is not showing the pages');
    await removePiece(a, 'pg-b');
    await until(h, () => order(b), (o) => o.includes('pg-a') && !o.includes('pg-b'), 'the other tab still shows the removed page', 20);
    await toGallery(b);
    await steady(b);
    await h.shot(b, 'other-tab-hides-320');
    await a.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
    await until(h, () => order(b), (o) => o.includes('pg-b'), 'Undo did not bring the page back in the other tab');
    h.expect(!(await goneMarks(a)), 'Undo left the removal stored');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** An open page redraws when another tab saves a newer version, so Remove takes what is on screen; Home follows too. */
  async 'art-remove-shown-version'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    await openPiece(a, 'pg-a');
    const b = await second(h, ctx, { width: 320, height: 568 });

    // B saves an edit of the page A has open: A's page shows it, so A's Remove would take the version A sees
    await b.locator('[data-piece="pg-a"]').click();
    await b.getByRole('button', { name: 'Keep drawing', exact: true }).click();
    await b.waitForFunction(() => window.__daily?.ink?.strokes.length === 1 && !document.querySelector('.dq-ink-stage')?.inert);
    await stroke(b);
    await b.getByRole('button', { name: 'Save', exact: true }).click();
    await until(h, () => records(b), (rs) => rs.find((r) => r.id === 'pg-a')?.strokes.length === 2, 'the other tab\'s edit was not saved');
    const showsStored = () =>
      a.evaluate(async () => {
        const rec = await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).get('pg-a');
        const { renderDrawing } = await import('/src/daily/ink.ts');
        const c = document.querySelector('.dq-piece-art canvas');
        return !!rec && !!c && renderDrawing(rec.strokes, rec.kind, c.width).toDataURL() === c.toDataURL();
      });
    await until(h, showsStored, (v) => v, 'the open page still shows the drawing from before the other tab saved its edit', 40);

    // Home in A follows B releasing the ally and B's Undo
    await a.evaluate(() => window.__daily.go({ name: 'hub' }));
    const sub = a.locator('.dq-tile', { hasText: 'Shadows' }).locator('.dq-tile-s');
    await sub.waitFor();
    const before = (await sub.textContent()).trim();
    await b.evaluate(() => window.__daily.go({ name: 'art' }));
    await openPiece(b, 'al-c');
    await b.getByRole('button', { name: 'Release', exact: true }).click();
    await b.locator('.dq-toast').getByText('Ally released.', { exact: true }).waitFor();
    await until(h, async () => (await sub.textContent()).trim(), (t) => t !== before, `Home still counts the released ally: ${before}`, 30);
    await b.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
    await until(h, async () => (await sub.textContent()).trim(), (t) => t === before, 'Home did not count the ally again after Undo', 30);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** A reload during the Undo finishes the removal (like the toast ending); a closed tab's removal is finished later. */
  async 'art-remove-reload'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    const b = await second(h, ctx);

    await removePiece(a, 'pg-b');
    const t0 = Date.now();
    await until(h, () => order(b), (o) => o.includes('pg-a') && !o.includes('pg-b'), 'the other tab still shows the removed page', 20);
    h.expect(Date.now() - t0 < 4000, `the reload came ${Date.now() - t0} ms after Remove, not during its Undo`);
    await a.reload();
    await toArt(h, a);
    await until(h, () => records(a), (rs) => !rs.some((r) => r.id === 'pg-b'), 'a reload during the Undo did not finish the removal');
    h.expect(!(await order(a)).includes('pg-b'), 'the removed page came back after a reload');
    await h.sleep(500);
    h.expect(!(await order(b)).includes('pg-b'), 'the removed page came back in the other tab');
    h.expect(!(await goneMarks(a)), 'the finished removal stayed stored');

    // a tab that closed during its Undo: another tab keeps it hidden, and finishes it a minute on
    const rev = await a.evaluate(async () => {
      const { artStore, revOf } = await import('/src/daily/artstore.ts');
      return revOf((await artStore(window.__daily.store.key).list()).find((m) => m.id === 'pg-a'));
    });
    const revC = await a.evaluate(async () => {
      const { artStore, revOf } = await import('/src/daily/artstore.ts');
      return revOf((await artStore(window.__daily.store.key).list()).find((m) => m.id === 'al-c'));
    });
    await a.evaluate(([rev, revC]) => {
      const now = Date.now();
      localStorage.setItem(`${window.__daily.store.key}.art.gone`, JSON.stringify({ 'pg-a': { rev, at: now - 61e3, tab: 'closed-tab' }, 'al-c': { rev: revC, at: now, tab: 'closed-tab' } }));
    }, [rev, revC]);
    await a.reload();
    await toArt(h, a);
    await until(h, () => records(a), (rs) => !rs.some((r) => r.id === 'pg-a'), 'a closed tab\'s removal was not finished once its time passed');
    const rs = await records(a);
    h.expect(rs.some((r) => r.id === 'al-c'), 'a removal still inside its Undo was finished by another tab');
    h.expect(!(await order(a)).includes('al-c'), 'a removal still inside its Undo shows');
    h.expect(JSON.stringify(Object.keys((await goneMarks(a)) ?? {})) === '["al-c"]', `the waiting removals stored are wrong: ${JSON.stringify(await goneMarks(a))}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * A Save Crystal restored during the Undo neither brings the page back nor stops Undo from returning it, and once the
   * Undo runs out the page stays gone. The restore's art import runs inside the 6 s window (the Settings path is slower).
   */
  async 'art-remove-crystal'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    page.setDefaultTimeout(15000);
    await h.reachHub(page);
    await seed(page);
    await page.evaluate(() => window.__daily.go({ name: 'settings' }));
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save Crystal', exact: true }).click()]);
    const file = path.join(h.out, 'remove-crystal.json');
    await dl.saveAs(file);
    const { art } = JSON.parse(fs.readFileSync(file, 'utf8'));
    h.expect(art.some((r) => r.id === 'pg-b'), 'the Save Crystal does not hold the page');
    const restore = () => page.evaluate(async (art) => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).importAll(art), art);
    await toArt(h, page);

    await removePiece(page, 'pg-b');
    const said = await restore();
    await h.sleep(300);
    h.expect(!(await order(page)).includes('pg-b'), `the restore brought back the page waiting for its Undo: ${JSON.stringify(said)}`);
    h.expect((await records(page)).some((r) => r.id === 'pg-b'), 'the restore lost the page waiting for its Undo');
    await page.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
    await until(h, () => order(page), (o) => o.includes('pg-b'), 'Undo after the restore did not bring the page back');

    await removePiece(page, 'pg-b');
    await restore();
    await page.locator('.dq-toast').waitFor({ state: 'hidden', timeout: 12000 });
    await until(h, () => records(page), (rs) => !rs.some((r) => r.id === 'pg-b'), 'the removal did not land after the restore');
    await h.sleep(500);
    h.expect(!(await order(page)).includes('pg-b'), 'the restore brought the page back once its Undo ran out');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** Undo works while the toast fades and does nothing once it has gone; Forward can't reopen the removed page. */
  async 'art-remove-fade-forward'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 320, height: 568 });
    page.setDefaultTimeout(15000);
    await h.reachHub(page);
    await seed(page);
    await toArt(h, page);

    await removePiece(page, 'pg-b');
    await toGallery(page);
    await h.sleep(600);
    await steady(page);
    await h.shot(page, 'removed-toast-320');
    // Forward from the gallery stays there
    await page.goForward({ waitUntil: 'commit' }).catch(() => null);
    await h.sleep(600);
    h.expect(await page.locator('.dq-artroom').isVisible() && !(await page.locator('.dq-piece').count()), 'Forward reopened the removed page');
    // a tap while the toast fades still undoes
    const tapped = await page.evaluate(() => new Promise((ok) => {
      const t = document.querySelector('.dq-toast');
      const look = () => {
        const fading = t.getAnimations().some((a) => a.playState === 'running' && a.effect.getKeyframes().at(-1)?.opacity === '0');
        if (!fading) return requestAnimationFrame(look);
        t.querySelector('.dq-toast-btn').click();
        ok(t.classList.contains('is-on'));
      };
      look();
    }));
    h.expect(tapped === false, 'Undo during the fade left the toast up');
    await until(h, () => order(page), (o) => o.includes('pg-b'), 'Undo during the fade did not bring the page back');
    await h.sleep(800);
    h.expect((await records(page)).some((r) => r.id === 'pg-b'), 'the page Undo brought back during the fade was removed');

    // once the toast has gone, its Undo button does nothing
    await removePiece(page, 'pg-b');
    await page.locator('.dq-toast').waitFor({ state: 'hidden', timeout: 12000 });
    await until(h, () => records(page), (rs) => !rs.some((r) => r.id === 'pg-b'), 'the removal did not land when the toast went');
    await page.evaluate(() => document.querySelector('.dq-toast-btn')?.click());
    await h.sleep(500);
    h.expect(!(await order(page)).includes('pg-b') && !(await page.locator('.dq-toast').isVisible()), 'a tap on the gone toast brought something back');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** A name set in another tab updates the gallery and Shadows in place: the focused card keeps focus. Captions are 16 px. */
  async 'art-remove-focus-kept'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 320, height: 568 });
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    const b = await second(h, ctx);
    const relabel = (id, name) => b.evaluate(async ([id, name]) => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).setLabels(id, { name }), [id, name]);

    const size = await a.locator('.dq-galitem-d').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    h.expect(size >= 16, `gallery captions are ${size} px on a phone`);
    await a.locator('[data-piece="pg-a"]').focus();
    await relabel('pg-b', 'Shore');
    await until(h, () => a.locator('[data-piece="pg-b"] .dq-galitem-d').textContent(), (t) => t.includes('Shore'), 'the gallery did not show the name set in the other tab');
    h.expect((await focused(a)) === 'pg-a', `the focused card lost focus when another tab renamed a page: ${await focused(a)}`);
    await relabel('pg-a', 'Harbour');
    await until(h, () => a.locator('[data-piece="pg-a"] .dq-galitem-d').textContent(), (t) => t.includes('Harbour'), 'the gallery did not show the focused page\'s new name');
    h.expect((await focused(a)) === 'pg-a', `the renamed card lost focus: ${await focused(a)}`);
    await a.locator('[data-piece="pg-a"]').scrollIntoViewIfNeeded();
    await steady(a);
    await h.shot(a, 'gallery-names-320');

    await a.evaluate(() => window.__daily.go({ name: 'shadows' }));
    await a.locator('.dq-allybtn[data-piece="al-c"]').focus();
    await relabel('al-c', 'Ember Light');
    await until(h, () => a.locator('.dq-allybtn[data-piece="al-c"] .dq-allycard-name').textContent(), (t) => t.includes('Ember Light'), 'Shadows did not show the name set in the other tab');
    h.expect((await focused(a)) === 'al-c', `the focused ally lost focus: ${await focused(a)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
