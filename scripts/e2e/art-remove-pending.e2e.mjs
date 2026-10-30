// Art room: a removal waiting for its Undo is stored beside the save, one key per drawing, with the version it hides.
// Every tab hides it, tabs removing at once keep both, a copy of a tab waits for its Undo, a newer save in any tab wins,
// a Restore in another tab that brings other strokes under the version on screen redraws it, a reload finishes it, a
// Save Crystal restore neither brings it back nor loses it, Undo works until the toast is gone or they leave for another
// screen (Home keeps it), Forward can't reopen it, and a change in another tab keeps the focused card.
import fs from 'node:fs';
import path from 'node:path';
import { pause } from './device-motion.e2e.mjs';

const line = (x, y, i = 1) => ({ i, w: 25, p: [x, y, x + 300, y + 80, x + 520, y + 20] });
const records = (page) => page.evaluate(async () => (await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).exportAll()).records);
const order = (page, sel = '.dq-galitem') => page.locator(sel).evaluateAll((els) => els.map((e) => e.dataset.piece));
/** The removals waiting for their Undo as stored, by drawing id (one key each), or null when none is. */
const goneMarks = (page) =>
  page.evaluate(() => {
    const at = `${window.__daily.store.key}.art.gone.`;
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(at));
    return keys.length ? Object.fromEntries(keys.map((k) => [k.slice(at.length), JSON.parse(localStorage.getItem(k))])) : null;
  });
/** Whether the open page draws the version of drawing id stored now. */
const showsStored = (page, id) =>
  page.evaluate(async (id) => {
    const rec = await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).get(id);
    const { renderDrawing } = await import('/src/daily/ink.ts');
    const c = document.querySelector('.dq-piece-art canvas');
    return !!rec && !!c && renderDrawing(rec.strokes, rec.kind, c.width).toDataURL() === c.toDataURL();
  }, id);
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

async function second(h, ctx, errors, viewport) {
  const b = await ctx.newPage();
  b.on('pageerror', (e) => errors.push(e.message));
  b.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
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
  /** The storage event carries a removal and its Undo even when BroadcastChannel is unavailable. */
  async 'art-remove-storage-signal'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', undefined, (c) => c.addInitScript(() => { window.BroadcastChannel = undefined; }));
    try {
      await h.reachHub(page);
      await seed(page);
      await toArt(h, page);
      const other = await second(h, ctx, errors);
      await removePiece(page, 'pg-a');
      await other.locator('[data-piece="pg-a"]').waitFor({ state: 'detached', timeout: 3000 });
      await page.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
      await other.locator('[data-piece="pg-a"]').waitFor();
      await other.evaluate(async (stroke) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const rec = await as.get('pg-a');
        await as.put({ ...rec, strokes: [...rec.strokes, stroke], n: rec.strokes.length + 1 });
      }, line(50, 1200, 3));
      await removePiece(page, 'pg-a');
      await other.locator('[data-piece="pg-a"]').waitFor({ state: 'detached', timeout: 3000 });
      await h.gone(page.locator('.dq-toast'), 12000, { state: 'hidden' });
      await h.poll(other, () => other.evaluate(async () => (await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).list()).map((r) => r.id)), (ids) => !ids.includes('pg-a'), 'a finished removal returned from the other tab\'s memory', { timeout: 12000 });
      h.expect(!(await other.locator('[data-piece="pg-a"]').count()), 'the finished removal came back in the gallery');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** With no BroadcastChannel, a copy of a tab (it keeps the tab's id) leaves a removal to the Undo still up in the other. */
  async 'art-remove-copied-tab'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', undefined, (c) => c.addInitScript(() => { window.BroadcastChannel = undefined; }));
    try {
      a.setDefaultTimeout(15000);
      await h.reachHub(a);
      await seed(a);
      await toArt(h, a);
      const copy = await ctx.newPage();
      copy.on('pageerror', (e) => errors.push(e.message));
      await copy.addInitScript((id) => sessionStorage.setItem('dbt.tab', id), await a.evaluate(() => sessionStorage.getItem('dbt.tab')));
      await copy.goto(h.server.url + '/?mute');
      await toArt(h, copy);
      h.expect((await copy.evaluate(() => sessionStorage.getItem('dbt.tab'))) === (await a.evaluate(() => sessionStorage.getItem('dbt.tab'))), 'the copy did not keep the tab\'s id');

      await removePiece(a, 'pg-b');
      await copy.locator('[data-piece="pg-b"]').waitFor({ state: 'detached', timeout: 3000 });
      await h.sleep(1500);
      h.expect((await records(a)).some((r) => r.id === 'pg-b'), 'the copy of the tab finished the removal while its Undo was still up');
      await a.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
      await copy.locator('[data-piece="pg-b"]').waitFor();
      h.expect((await records(a)).some((r) => r.id === 'pg-b') && !(await goneMarks(a)), 'Undo did not keep the page');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Every valid drawing id is marked as an own key, heard in other tabs and finished after a reload. */
  async 'art-remove-special-ids'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    try {
      await h.reachHub(page);
      await page.evaluate(async (ids) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        await as.importAll(ids.map((id) => ({ id, kind: 'today', day: '2026-10-20', t: 1, updated: 1, n: 1, strokes: [{ i: 1, w: 4, p: [50, 50, 500, 500] }] })));
      }, ['__proto__', 'constructor', 'toString']);
      await toArt(h, page);
      const other = await second(h, ctx, errors);
      for (const id of ['__proto__', 'constructor', 'toString']) {
        await removePiece(page, id);
        h.expect(await page.evaluate((id) => localStorage.getItem(`${window.__daily.store.key}.art.gone.${id}`) !== null, id), `${id}: the pending removal was not stored under its own key`);
        await other.locator(`[data-piece="${id}"]`).waitFor({ state: 'detached', timeout: 3000 });
        await page.reload();
        await toArt(h, page);
        h.expect(!(await records(page)).some((r) => r.id === id), `${id}: the removal did not finish after reload`);
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** An edit saved in another tab during the Undo wins; the other tab hides the page too and gets it back with Undo. */
  async 'art-remove-other-tab'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    const b = await second(h, ctx, errors, { width: 320, height: 568 });

    // B edits pg-a; A removes it; B saves during A's Undo: B's edit stays everywhere
    await b.locator('[data-piece="pg-a"]').click();
    await b.getByRole('button', { name: 'Keep drawing', exact: true }).click();
    await b.waitForFunction(() => window.__daily?.ink?.strokes.length === 1 && !document.querySelector('.dq-ink-stage')?.inert);
    await removePiece(a, 'pg-a');
    // A stops at once, so its Undo, a timer on its own page, can't run out before B has saved, however long B takes
    const stopped = await pause(ctx, a);
    try {
      await stroke(b);
      h.expect((await goneMarks(b))?.['pg-a'], 'the removal was no longer waiting for its Undo when the other tab saved');
      await b.getByRole('button', { name: 'Save', exact: true }).click();
      await h.poll(b, () => records(b), (rs) => rs.find((r) => r.id === 'pg-a')?.strokes.length === 2, 'the other tab\'s edit was not saved', { timeout: 12000 });
    } finally {
      await stopped.resume();
    }
    await h.gone(a.locator('.dq-toast'), 12000, { state: 'hidden' });
    await h.sleep(800);
    const after = await records(a);
    h.expect(after.find((r) => r.id === 'pg-a')?.strokes.length === 2, `the edit saved in the other tab was wiped when the Undo ran out: ${JSON.stringify(after.map((r) => [r.id, r.strokes.length]))}`);
    h.expect((await order(a)).includes('pg-a'), 'the kept page is not in the gallery of the tab that removed it');
    h.expect(!(await goneMarks(a)), 'the finished removal stayed stored');

    // A removes pg-b: B's gallery hides it too, and A's Undo brings it back there
    await b.evaluate(() => window.__daily.go({ name: 'art' }));
    await h.poll(b, () => order(b), (o) => o.includes('pg-a') && o.includes('pg-b'), 'the other tab\'s gallery is not showing the pages', { timeout: 12000 });
    await removePiece(a, 'pg-b');
    await h.poll(b, () => order(b), (o) => o.includes('pg-a') && !o.includes('pg-b'), 'the other tab still shows the removed page', { timeout: 2000 });
    await toGallery(b);
    await steady(b);
    await h.shot(b, 'other-tab-hides-320');
    await a.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
    await h.poll(b, () => order(b), (o) => o.includes('pg-b'), 'Undo did not bring the page back in the other tab', { timeout: 12000 });
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
    const b = await second(h, ctx, errors, { width: 320, height: 568 });

    // B saves an edit of the page A has open: A's page shows it, so A's Remove would take the version A sees, and a
    // keyboard player in A keeps focus on Remove
    await a.getByRole('button', { name: 'Remove', exact: true }).focus();
    await b.locator('[data-piece="pg-a"]').click();
    await b.getByRole('button', { name: 'Keep drawing', exact: true }).click();
    await b.waitForFunction(() => window.__daily?.ink?.strokes.length === 1 && !document.querySelector('.dq-ink-stage')?.inert);
    await stroke(b);
    await b.getByRole('button', { name: 'Save', exact: true }).click();
    await h.poll(b, () => records(b), (rs) => rs.find((r) => r.id === 'pg-a')?.strokes.length === 2, 'the other tab\'s edit was not saved', { timeout: 12000 });
    await h.poll(a, () => showsStored(a, 'pg-a'), (v) => v, 'the open page still shows the drawing from before the other tab saved its edit', { timeout: 4000 });
    const at = await a.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
    h.expect(at === 'Remove', `the redraw took focus off Remove: ${at}`);

    // Home in A follows B releasing the ally and B's Undo
    await a.evaluate(() => window.__daily.go({ name: 'hub' }));
    const sub = a.locator('.dq-tile', { hasText: 'Shadows' }).locator('.dq-tile-s');
    await sub.waitFor();
    const before = (await sub.textContent()).trim();
    await b.evaluate(() => window.__daily.go({ name: 'art' }));
    await openPiece(b, 'al-c');
    await b.getByRole('button', { name: 'Release', exact: true }).click();
    await b.locator('.dq-toast').getByText('Ally released.', { exact: true }).waitFor();
    await h.poll(a, async () => (await sub.textContent()).trim(), (t) => t !== before, `Home still counts the released ally: ${before}`, { timeout: 3000 });
    await b.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
    await h.poll(a, async () => (await sub.textContent()).trim(), (t) => t === before, 'Home did not count the ally again after Undo', { timeout: 3000 });
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * A Restore in another tab that brings other strokes under the version an open page shows redraws the page, so Remove
   * takes what is on screen, and no copy of that version's strokes is lost or doubled, however often the files come back.
   */
  async 'art-remove-restored-version'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    const s1 = line(200, 500), s2 = line(100, 1200, 3), s3 = line(300, 900, 2);
    // a page's copy as a crafted Save Crystal holds it: the same id, revision and time each time, only the strokes differ
    const copy = (id, strokes) => ({ id, kind: 'today', day: '2026-10-20', t: id === 'pg-r' ? 1 : 2, updated: 5, rev: `crafted-${id}`, n: strokes.length, strokes });
    const bring = (page, art) => page.evaluate(async (art) => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).importAll(art), art);
    await bring(a, [copy('pg-r', [s1]), copy('pg-s', [s1])]);
    await toArt(h, a);
    await openPiece(a, 'pg-r');
    const b = await second(h, ctx, errors);
    // A's page is the one watched and tapped, so A goes in front, where it draws: B only restores
    await a.bringToFront();

    // B's copy holds the stroke A shows and one more: A's page shows both, Remove hides that version and Undo keeps both
    const said = await bring(b, [copy('pg-r', [s1, s2])]);
    h.expect(said.updated === 1, `the Restore did not update the page: ${JSON.stringify(said)}`);
    await h.poll(a, () => showsStored(a, 'pg-r'), (v) => v, 'the open page still shows the strokes from before the other tab\'s Restore', { timeout: 4000 });
    await a.getByRole('button', { name: 'Remove', exact: true }).click();
    await a.locator('.dq-toast').getByText('Page removed.', { exact: true }).waitFor();
    const shown = await a.evaluate(async () => {
      const { artStore, revOf } = await import('/src/daily/artstore.ts');
      return revOf(await artStore(window.__daily.store.key).get('pg-r'));
    });
    const hid = (await goneMarks(a))?.['pg-r']?.rev;
    h.expect(hid === shown, `Remove hid ${hid}, not the version on screen (${shown})`);
    await a.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
    await a.locator('[data-piece="pg-r"]').waitFor();

    // B's copy holds other strokes than A's page and not the one there: A's page shows B's, and A's comes in as its own page
    await openPiece(a, 'pg-s');
    const other = await bring(b, [copy('pg-s', [s3])]);
    h.expect(other.kept === 1, `the Restore did not keep both copies: ${JSON.stringify(other)}`);
    await h.poll(a, () => showsStored(a, 'pg-s'), (v) => v, 'the open page still shows the strokes from before the other tab\'s Restore of other strokes', { timeout: 4000 });

    // each copy restored again changes nothing; a third copy of the version, holding a stroke no page here has, comes in,
    // and so does one holding a field from a newer build, which it keeps
    for (const art of [[copy('pg-r', [s1])], [copy('pg-r', [s1, s2])], [copy('pg-s', [s1])], [copy('pg-s', [s3])]]) {
      const again = await bring(b, art);
      h.expect(again.unchanged === 1, `restoring a copy again changed something: ${JSON.stringify({ again, strokes: art[0].strokes.length })}`);
    }
    const third = await bring(b, [copy('pg-r', [s1, s3])]);
    h.expect(third.kept === 1, `a third copy of the version did not come in as its own page: ${JSON.stringify(third)}`);
    const newer = await bring(b, [{ ...copy('pg-r', [s1, s2]), glaze: { k: 1 } }]);
    h.expect(newer.kept === 1, `a copy with a newer build's field did not come in as its own page: ${JSON.stringify(newer)}`);
    const rs = await records(a);
    h.expect(rs.filter((r) => r.glaze?.k === 1).length === 1, 'the newer build\'s field is not kept on exactly one page');
    const got = rs.map((r) => JSON.stringify(r.strokes)).sort();
    const want = [[s1, s2], [s1, s2], [s1, s3], [s3], [s1]].map((s) => JSON.stringify(s)).sort();
    h.expect(JSON.stringify(got) === JSON.stringify(want), `strokes were lost or doubled: ${JSON.stringify(got)}`);
    h.expect(await showsStored(a, 'pg-s'), 'the open page no longer shows the version stored under it');
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
    const b = await second(h, ctx, errors);

    await removePiece(a, 'pg-b');
    // A stops at once, so its Undo can't run out before it reloads: a stopped tab reloads, its pagehide runs and its timers
    // never do, and the reload ends the stop
    await pause(ctx, a);
    await h.poll(b, () => order(b), (o) => o.includes('pg-a') && !o.includes('pg-b'), 'the other tab still shows the removed page', { timeout: 2000 });
    h.expect((await goneMarks(b))?.['pg-b'], 'the removal was no longer waiting for its Undo when the tab reloaded');
    await a.reload();
    await toArt(h, a);
    await h.poll(a, () => records(a), (rs) => !rs.some((r) => r.id === 'pg-b'), 'a reload during the Undo did not finish the removal', { timeout: 12000 });
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
      localStorage.setItem(`${window.__daily.store.key}.art.gone.pg-a`, JSON.stringify({ rev, at: now - 61e3, tab: 'closed-tab' }));
      localStorage.setItem(`${window.__daily.store.key}.art.gone.al-c`, JSON.stringify({ rev: revC, at: now, tab: 'closed-tab' }));
    }, [rev, revC]);
    await a.reload();
    await toArt(h, a);
    await h.poll(a, () => records(a), (rs) => !rs.some((r) => r.id === 'pg-a'), 'a closed tab\'s removal was not finished once its time passed', { timeout: 12000 });
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
    await h.poll(page, () => order(page), (o) => o.includes('pg-b'), 'Undo after the restore did not bring the page back', { timeout: 12000 });

    await removePiece(page, 'pg-b');
    await restore();
    await h.gone(page.locator('.dq-toast'), 12000, { state: 'hidden' });
    await h.poll(page, () => records(page), (rs) => !rs.some((r) => r.id === 'pg-b'), 'the removal did not land after the restore', { timeout: 12000 });
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
    await h.poll(page, () => order(page), (o) => o.includes('pg-b'), 'Undo during the fade did not bring the page back', { timeout: 12000 });
    await h.sleep(800);
    h.expect((await records(page)).some((r) => r.id === 'pg-b'), 'the page Undo brought back during the fade was removed');

    // once the toast has gone, its Undo button does nothing
    await removePiece(page, 'pg-b');
    await h.gone(page.locator('.dq-toast'), 12000, { state: 'hidden' });
    await h.poll(page, () => records(page), (rs) => !rs.some((r) => r.id === 'pg-b'), 'the removal did not land when the toast went', { timeout: 12000 });
    await page.evaluate(() => document.querySelector('.dq-toast-btn')?.click());
    await h.sleep(500);
    h.expect(!(await order(page)).includes('pg-b') && !(await page.locator('.dq-toast').isVisible()), 'a tap on the gone toast brought something back');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * Two tabs remove different drawings at the same moment, the second reading the waiting removals from before the first
   * landed: both stay waiting, and a reload during its Undo finishes the first tab's.
   */
  async 'art-remove-two-tabs-at-once'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    a.setDefaultTimeout(15000);
    await h.reachHub(a);
    await seed(a);
    await toArt(h, a);
    const b = await second(h, ctx, errors);
    await b.evaluate(() => {
      const at = `${window.__daily.store.key}.art.gone`;
      const then = Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith(at)).map((k) => [k, localStorage.getItem(k)]));
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        return String(k).startsWith(at) ? (then[k] ?? null) : get.call(this, k);
      };
      window.__readsNow = () => (Storage.prototype.getItem = get);
    });

    await removePiece(a, 'pg-a');
    await removePiece(b, 'pg-b');
    await b.evaluate(() => window.__readsNow());
    await a.reload();
    await toArt(h, a);
    await h.poll(a, () => records(a), (rs) => !rs.some((r) => r.id === 'pg-a'), 'a reload during the Undo did not finish this tab\'s removal', { timeout: 12000 });
    h.expect(!(await order(a)).includes('pg-a') && !(await order(a)).includes('pg-b'), `a removal came back after the reload: ${JSON.stringify(await order(a))}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** Leaving for another screen before the toast runs out ends its Undo there and then; Home keeps the toast and its Undo. */
  async 'art-remove-leave-ends-undo'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    page.setDefaultTimeout(15000);
    await h.reachHub(page);
    await seed(page);
    await toArt(h, page);

    await removePiece(page, 'pg-b');
    await openPiece(page, 'pg-a');
    h.expect(!(await page.locator('.dq-toast').isVisible()), 'the toast followed to another screen');
    await h.poll(page, () => records(page), (rs) => !rs.some((r) => r.id === 'pg-b'), 'leaving the toast behind did not finish the removal', { timeout: 2000 });
    h.expect(!(await goneMarks(page))?.['pg-b'], 'leaving the toast behind left the removal waiting in every tab');
    await page.evaluate(() => document.querySelector('.dq-toast-btn')?.click());
    await h.sleep(500);
    h.expect(!(await records(page)).some((r) => r.id === 'pg-b'), 'the Undo of a toast left behind brought the page back');

    await page.locator('.dq-back').click();
    await page.locator('.dq-artroom').waitFor();
    await removePiece(page, 'pg-a');
    await page.locator('.dq-back').click();
    await page.locator('.dq-hub').waitFor();
    await page.locator('.dq-toast').getByRole('button', { name: 'Undo', exact: true }).click();
    await h.poll(page, () => goneMarks(page), (g) => !g?.['pg-a'], 'Undo on Home did not take the removal back', { timeout: 12000 });
    h.expect((await records(page)).some((r) => r.id === 'pg-a'), 'Undo on Home did not keep the page');
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
    const b = await second(h, ctx, errors);
    const relabel = (id, name) => b.evaluate(async ([id, name]) => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).setLabels(id, { name }), [id, name]);

    const size = await a.locator('.dq-galitem-d').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    h.expect(size >= 16, `gallery captions are ${size} px on a phone`);
    await a.locator('[data-piece="pg-a"]').focus();
    await relabel('pg-b', 'Shore');
    await h.poll(a, () => a.locator('[data-piece="pg-b"] .dq-galitem-d').textContent(), (t) => t.includes('Shore'), 'the gallery did not show the name set in the other tab', { timeout: 12000 });
    h.expect((await focused(a)) === 'pg-a', `the focused card lost focus when another tab renamed a page: ${await focused(a)}`);
    await relabel('pg-a', 'Harbour');
    await h.poll(a, () => a.locator('[data-piece="pg-a"] .dq-galitem-d').textContent(), (t) => t.includes('Harbour'), 'the gallery did not show the focused page\'s new name', { timeout: 12000 });
    h.expect((await focused(a)) === 'pg-a', `the renamed card lost focus: ${await focused(a)}`);
    await a.locator('[data-piece="pg-a"]').scrollIntoViewIfNeeded();
    await steady(a);
    await h.shot(a, 'gallery-names-320');

    await a.evaluate(() => window.__daily.go({ name: 'shadows' }));
    await a.locator('.dq-allybtn[data-piece="al-c"]').focus();
    await relabel('al-c', 'Ember Light');
    await h.poll(a, () => a.locator('.dq-allybtn[data-piece="al-c"] .dq-allycard-name').textContent(), (t) => t.includes('Ember Light'), 'Shadows did not show the name set in the other tab', { timeout: 12000 });
    h.expect((await focused(a)) === 'al-c', `the focused ally lost focus: ${await focused(a)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
