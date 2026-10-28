import fs from 'node:fs';
import path from 'node:path';

async function art(h, page) {
  page.setDefaultTimeout(15000);
  if (await page.locator('.dq-artroom').count()) return;
  await back(page, 'hub');
  await h.reachHub(page);
  await page.locator('.dq-tile--art').click();
  await page.locator('.dq-artroom').waitFor();
}

async function draw(page) {
  await page.getByRole('button', { name: /^Draw today/ }).click();
  await page.locator('.dq-ink-live').waitFor();
  await page.waitForFunction(() => window.__daily?.ink && !document.querySelector('.dq-ink-stage')?.inert);
}

async function stroke(page, vertical = false) {
  const box = await page.locator('.dq-ink-live').boundingBox();
  const x = box.x + box.width * 0.3, y = box.y + box.height * 0.3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * (vertical ? 0.1 : 0.4), y + box.height * (vertical ? 0.4 : 0.1), { steps: 12 });
  await page.mouse.up();
}

const strokes = (page) => page.evaluate(() => window.__daily.ink.strokes);
const drafts = (page) => page.evaluate(async () => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).drafts());
const tab = (page) => page.evaluate(() => sessionStorage.getItem('dbt.tab'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function waitFor(h, read, check, message) {
  for (let i = 0; i < 50; i++) {
    const value = await read();
    if (check(value)) return value;
    await h.sleep(100);
  }
  throw new Error(message);
}

async function back(page, screen) {
  for (let i = 0; i < 8 && await page.locator('.dq').getAttribute('data-screen') !== screen; i++) {
    if (!await page.locator('.dq-back').count()) throw new Error(`Cannot return to ${screen} from ${await page.locator('.dq').getAttribute('data-screen')}: ${(await page.locator('body').innerText()).slice(0,1000)}`);
    await page.locator('.dq-back').click();
  }
  await page.locator(`.dq[data-screen="${screen}"]`).waitFor();
}

async function other(h, opener) {
  opener.setDefaultTimeout(15000);
  const opened = opener.waitForEvent('popup');
  await opener.evaluate(() => window.open(location.href, '_blank'));
  const page = await opened;
  await page.waitForLoadState();
  await art(h, page);
  return page;
}

async function evidence(h, page, name, extra = {}) {
  await h.shot(page, name);
  fs.writeFileSync(path.join(h.out, name + '.json'), JSON.stringify({ tab: await tab(page), drafts: await drafts(page), ...extra }, null, 2));
}

async function crystal(h, page, name) {
  await back(page, 'hub');
  await h.openSettings(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save Crystal', exact: true }).click()]);
  const file = path.join(h.out, name + '.json');
  await download.saveAs(file);
  return JSON.parse(fs.readFileSync(file, 'utf8')).art;
}

const KEPT_APART = 'A newer copy of this drawing arrived, so this one was kept as its own page.';
const NO_STORE = /^This browser isn.t keeping drawings right now\. Save to Photos keeps a copy\.$/;
const stored = (page) => page.evaluate(async () => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).exportAll());

/**
 * Holds this tab's next save before it reaches the disk, as a slow thumbnail or disk would. `late` also holds the
 * removal message until the save's write is open on the disk and keeps that write open until told; `fail` makes it fail.
 */
async function holdSave(page, mode) {
  await page.evaluate(async (mode) => {
    const s = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    const hold = (window.__hold = { open: mode === 'late', heard: [] });
    hold.gate = new Promise((r) => (hold.release = r));
    const { write, tx, channel } = s;
    const hear = channel.onmessage;
    s.write = async function (rec, force) {
      if (!force || hold.used) return write.call(this, rec, force);
      hold.used = hold.waiting = true;
      await hold.gate;
      const res = await write.call(this, rec, force);
      hold.done = true;
      return res;
    };
    s.tx = function (stores, txMode, fn, fallback) {
      if (!hold.waiting || hold.txd || txMode !== 'readwrite' || !stores.includes('strokes')) return tx.call(this, stores, txMode, fn, fallback);
      hold.txd = true;
      if (mode === 'fail') return tx.call(this, stores, txMode, () => Promise.reject(new DOMException('The disk is full.', 'QuotaExceededError')), fallback);
      return tx.call(this, stores, txMode, (t) => {
        const spin = () => hold.open && (t.objectStore('thumbs').get('').onsuccess = spin);
        spin();
        return fn(t).then((v) => ((hold.wrote = true), v));
      }, fallback);
    };
    if (mode === 'late') channel.onmessage = (e) => (e.data?.type === 'removed' && !hold.hearing ? hold.heard.push(e) : hear(e));
    hold.deliver = () => {
      hold.hearing = true;
      hold.heard.splice(0).forEach(hear);
    };
  }, mode);
}

/** A saves the open page while B removes it; the removal commits before A's save reaches the disk. */
async function racedSave(h, edit, mode) {
  let kept;
  const pair = await savedPair(h, edit, async (a) => {
    kept = await strokes(a);
    await holdSave(a, mode);
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    await a.waitForFunction(() => window.__hold.waiting);
  });
  const { a, b, id } = pair;
  await a.evaluate(() => window.__hold.release());
  if (mode === 'late') {
    await a.waitForFunction(() => window.__hold.wrote);
    await a.evaluate(() => window.__hold.deliver());
    await h.sleep(300);
    await a.evaluate(() => (window.__hold.open = false));
  }
  await a.waitForFunction(() => window.__hold.done);
  await h.sleep(700);
  const name = `delete-during-save-${mode ?? (edit === true ? 'edit' : edit)}`;
  const [aPages, bPages, aDrafts, bDrafts] = [(await stored(a)).records, (await stored(b)).records, await drafts(a), await drafts(b)];
  const view = { kept: same(await strokes(a), kept), keptApart: await a.getByText(KEPT_APART, { exact: true }).count(), noStore: await a.getByText(NO_STORE).count() };
  await evidence(h, a, name + '-a', { id, view, pages: aPages.map((r) => r.id) });
  await evidence(h, b, name + '-b', { id, pages: bPages.map((r) => r.id) });
  const crystalPages = await crystal(h, a, name + '-crystal');
  const copies = (pages, ds) => pages.filter((r) => same(r.strokes, kept)).length + ds.filter((d) => same(d.strokes, kept)).length;
  for (const [where, pages] of [['this tab', aPages], ['the other tab', bPages], ["this tab's Save Crystal", crystalPages]]) {
    h.expect(!pages.some((r) => r.id === id), `the removed page came back in ${where}`);
  }
  return { ...pair, kept, view, aPages, bPages, aDrafts, bDrafts, crystalPages, copies };
}

/** The save kept the strokes as their own page: one copy everywhere, confirmed, still open in the editor. */
async function keptOnce(h, edit, mode) {
  const { ctx, view, aPages, bPages, aDrafts, bDrafts, crystalPages, copies } = await racedSave(h, edit, mode);
  h.expect(view.keptApart === 1, 'the save kept the strokes as their own page but showed no confirmation');
  h.expect(view.kept, 'the editor dropped the strokes it just saved');
  h.expect(copies(aPages, aDrafts) === 1, `this tab holds ${copies(aPages, aDrafts)} copies of the strokes across saved pages and drafts`);
  h.expect(copies(bPages, bDrafts) === 1, `the other tab holds ${copies(bPages, bDrafts)} copies of the strokes across saved pages and drafts`);
  h.expect(copies(crystalPages, []) === 1, "this tab's Save Crystal does not hold the saved copy exactly once");
  await ctx.close();
}

async function savedPair(h, edit, before) {
  const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute&reduced&nopost&msaa=0&dpr=1');
  await art(h, a);
  await draw(a);
  await stroke(a);
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await a.getByRole('button', { name: 'Art room', exact: true }).click();
  await a.locator('.dq-galitem').waitFor();
  const b = await ctx.newPage();
  await b.goto(h.server.url + '/?mute&reduced&nopost&msaa=0&dpr=1');
  await art(h, b);
  await b.locator('.dq-galitem').click();
  await b.getByRole('button', { name: 'Keep drawing', exact: true }).waitFor();
  const records = await a.evaluate(async () => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).list());
  const id = records[0].id;
  let edited;
  if (edit) {
    await a.locator('.dq-galitem').click();
    if (edit !== 'piece') {
      await a.getByRole('button', { name: 'Keep drawing', exact: true }).click();
      await a.waitForFunction(() => window.__daily.ink?.strokes.length === 1);
    }
    if (edit !== 'clean' && edit !== 'piece') {
      await stroke(a, true);
      if (edit === 'undo') {
        await a.getByRole('button', { name: 'Save', exact: true }).click();
        await a.getByText('Saved again.', { exact: true }).waitFor();
        await a.getByRole('button', { name: 'Undo', exact: true }).click();
      }
      edited = await strokes(a);
      await waitFor(h, () => drafts(a), (ds) => ds.some((d) => d.editId === id && same(d.strokes, edited)), 'the unsaved edit was not drafted');
    }
  }
  await h.shot(a, edit ? 'delete-before-edit' : 'delete-before-gallery');
  if (before) await before(a);
  await b.getByRole('button', { name: 'Remove', exact: true }).click();
  await b.locator('.dq-artroom').waitFor();
  // the removal lands when its Undo runs out
  await b.locator('.dq-toast').waitFor({ state: 'hidden', timeout: 15000 });
  await waitFor(h, () => stored(b), (s) => !s.records.some((r) => r.id === id), 'the removal did not land when its Undo ran out');
  await h.sleep(700);
  return { ctx, a, b, errors, id, edited };
}

export const scenarios = {
  async 'art-opened-tab-keeps-both-drafts'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute&reduced&nopost&msaa=0&dpr=1');
    await art(h, a);
    await draw(a);
    await back(a, 'art');
    const aId = await tab(a);
    const b = await other(h, a);
    await draw(a);
    await draw(b);
    await stroke(a);
    const aStrokes = await strokes(a);
    await stroke(b, true);
    const bStrokes = await strokes(b);
    await h.sleep(800);
    await evidence(h, a, 'opened-tab-before-a');
    await evidence(h, b, 'opened-tab-before-b');
    await Promise.all([a.reload(), b.reload()]);
    await art(h, a);
    await art(h, b);
    await draw(a);
    await draw(b);
    await h.sleep(700);
    await evidence(h, a, 'opened-tab-after-a', { strokes: await strokes(a) });
    await evidence(h, b, 'opened-tab-after-b', { strokes: await strokes(b) });
    h.expect(await tab(a) === aId, 'opening another tab changed the original tab id');
    h.expect(await tab(a) !== await tab(b), 'window.open copied the live tab id; both tabs still share a draft key');
    h.expect(same(await strokes(a), aStrokes), 'the original tab lost or mixed its pointer strokes after reload');
    h.expect(same(await strokes(b), bStrokes), 'the opened tab lost or mixed its pointer strokes after reload');
    h.expect((await drafts(a)).length === 2, 'both drawings are not recoverable as separate drafts');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'art-resume-another-tab-forks-draft'(h) {
    const { ctx, page: a } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute&reduced&nopost&msaa=0&dpr=1');
    await art(h, a);
    await draw(a);
    await stroke(a);
    const original = await strokes(a);
    const [source] = await waitFor(h, () => drafts(a), (ds) => ds.length === 1, 'the original draft was not stored');
    const b = await ctx.newPage();
    await b.goto(h.server.url + '/?mute&reduced&nopost&msaa=0&dpr=1');
    await art(h, b);
    await b.getByRole('button', { name: 'Keep drawing', exact: true }).click();
    await b.waitForFunction(() => window.__daily.ink?.strokes.length === 1);
    await stroke(b, true);
    const fork = await strokes(b);
    await h.sleep(800);
    await evidence(h, b, 'fork-after-edit', { source, fork });
    const ds = await drafts(a);
    const bId = await tab(b);
    h.expect(ds.some((d) => d.key === source.key && same(d.strokes, original)), 'Keep drawing overwrote the other tab\'s original draft');
    h.expect(ds.some((d) => d.key !== source.key && d.key.endsWith(':' + bId) && same(d.strokes, fork)), 'Keep drawing did not fork the draft to this tab');
    await b.getByRole('button', { name: 'Save', exact: true }).click();
    await b.getByRole('button', { name: 'Art room', exact: true }).waitFor();
    h.expect((await drafts(a)).some((d) => d.key === source.key && same(d.strokes, original)), 'saving the fork removed the original draft');
    await ctx.close();
  },

  async 'art-delete-clears-other-gallery-and-crystal'(h) {
    const { ctx, a, id } = await savedPair(h, false);
    await evidence(h, a, 'delete-after-gallery', { id, galleryCount: await a.locator('.dq-galitem').count() });
    const galleryCount = await a.locator('.dq-galitem').count();
    const records = await crystal(h, a, 'delete-after-crystal');
    h.expect(!records.some((r) => r.id === id), 'the deleted drawing returned in the other tab\'s Save Crystal');
    h.expect(galleryCount === 0, 'the deleted drawing stayed in the other tab\'s open gallery');
    await ctx.close();
  },

  async 'art-delete-keeps-unsaved-edit-as-draft'(h) {
    const { ctx, a, id, edited } = await savedPair(h, true);
    h.expect(same(await strokes(a), edited), 'the live editor lost its unsaved pointer strokes on delete');
    await back(a, 'art');
    await h.sleep(700);
    const ds = await drafts(a);
    const count = await a.locator('.dq-galitem').count();
    await evidence(h, a, 'delete-after-unsaved-edit', { id, edited, galleryCount: count });
    const records = await crystal(h, a, 'delete-unsaved-crystal');
    h.expect(!records.some((r) => r.id === id), 'the deleted saved drawing was resurrected in the backup');
    h.expect(count === 0, 'the deleted saved drawing returned to the gallery');
    h.expect(ds.some((d) => !d.editId && !d.bases && same(d.strokes, edited)), 'the unsaved edit was not kept as an independent unsaved draft');
    await back(a, 'hub');
    await art(h, a);
    await a.getByRole('button', { name: 'Keep drawing', exact: true }).click();
    await a.waitForFunction(() => window.__daily.ink?.strokes.length === 2);
    h.expect(same(await strokes(a), edited), 'the recovered draft lost its unsaved pointer strokes');
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    await a.getByRole('button', { name: 'Art room', exact: true }).click();
    const saved = await a.evaluate(async () => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).exportAll());
    h.expect(saved.records.length === 1 && saved.records[0].id !== id && same(saved.records[0].strokes, edited), 'saving the recovered draft reused the deleted record');
    await ctx.close();
  },

  async 'art-delete-keeps-undone-edit-as-draft'(h) {
    const { ctx, a, id, edited } = await savedPair(h, 'undo');
    await evidence(h, a, 'delete-after-undo', { id, edited });
    h.expect((await drafts(a)).some((d) => !d.editId && same(d.strokes, edited)), 'deleting the saved page lost the unsaved Undo');
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    await a.getByRole('button', { name: 'Art room', exact: true }).click();
    const saved = await a.evaluate(async () => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).exportAll());
    h.expect(saved.records.length === 1 && saved.records[0].id !== id && same(saved.records[0].strokes, edited), 'saving directly after delete reused the deleted page or lost Undo');
    await ctx.close();
  },

  async 'art-delete-clears-clean-open-editor'(h) {
    const { ctx, a, id } = await savedPair(h, 'clean');
    await evidence(h, a, 'delete-after-clean-editor', { id });
    h.expect((await strokes(a)).length === 0, 'a clean open editor retained the deleted drawing');
    h.expect((await drafts(a)).length === 0, 'deleting an unedited page left a draft of it');
    h.expect(await a.getByRole('button', { name: 'Save', exact: true }).isDisabled(), 'the deleted unedited drawing can still be saved again');
    await ctx.close();
  },

  async 'art-delete-clears-open-saved-piece'(h) {
    const { ctx, a, id } = await savedPair(h, 'piece');
    await evidence(h, a, 'delete-after-saved-piece', { id });
    h.expect(await a.getByText('That page is no longer here.', { exact: true }).count(), 'the open saved page did not show the deletion');
    h.expect(!await a.locator('.dq-piece-art').count(), 'the deleted saved page is still displayed');
    await ctx.close();
  },

  async 'art-delete-during-save-keeps-one-copy'(h) {
    await keptOnce(h, true);
  },

  async 'art-delete-during-unchanged-save-keeps-one-copy'(h) {
    await keptOnce(h, 'clean');
  },

  async 'art-delete-heard-mid-write-keeps-one-copy'(h) {
    await keptOnce(h, true, 'late');
  },

  async 'art-delete-during-failed-save-keeps-one-draft'(h) {
    const { ctx, kept, view, aPages, bPages, aDrafts, bDrafts, crystalPages } = await racedSave(h, true, 'fail');
    const [page] = aPages;
    const ds = aDrafts.filter((d) => same(d.strokes, kept));
    h.expect(view.noStore === 1, 'a save the disk refused did not say this browser is not keeping drawings');
    h.expect(view.kept, 'the editor dropped the strokes it could not store');
    h.expect(aPages.length === 1 && same(page.strokes, kept), 'the copy this tab keeps in memory is missing');
    h.expect(ds.length === 1 && ds[0].editId === page.id, 'the strokes are not one draft of the page kept in memory');
    h.expect(!bPages.length && bDrafts.filter((d) => same(d.strokes, kept)).length === 1, 'the other tab does not see the strokes as one draft');
    h.expect(crystalPages.filter((r) => same(r.strokes, kept)).length === 1, "this tab's Save Crystal does not hold the kept copy exactly once");
    await ctx.close();
  },

  async 'art-refused-save-of-saved-drawing-stays-one-page'(h) {
    const { ctx, page: a, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute&reduced&nopost&msaa=0&dpr=1');
    await art(h, a);
    await draw(a);
    await stroke(a);
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    await a.getByRole('button', { name: 'Art room', exact: true }).click();
    await a.locator('.dq-galitem').waitFor();
    const id = (await a.evaluate(async () => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).list()))[0].id;
    await a.locator('.dq-galitem').click();
    await a.getByRole('button', { name: 'Keep drawing', exact: true }).click();
    await a.waitForFunction(() => window.__daily.ink?.strokes.length === 1);
    await stroke(a, true);
    const kept = await strokes(a);
    await holdSave(a, 'fail');
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    await a.waitForFunction(() => window.__hold.waiting);
    await a.evaluate(() => window.__hold.release());
    await a.waitForFunction(() => window.__hold.done);
    await h.sleep(700);
    const pages = await a.evaluate(async () => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).list());
    await evidence(h, a, 'refused-save-of-saved-drawing', { id, pages: pages.map((r) => r.id) });
    h.expect(!(await a.getByText(KEPT_APART, { exact: true }).count()), 'a refused save said a newer copy arrived, though nothing was removed');
    h.expect(pages.length === 1 && pages[0].id === id, `a refused save split one drawing into ${pages.length} gallery pages: ${pages.map((r) => r.id).join(', ')}`);
    h.expect(same(await strokes(a), kept), 'the editor lost the strokes it could not store');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'art-single-tab-reload-keeps-own-draft'(h) {
    const { ctx, page } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute&reduced&nopost&msaa=0&dpr=1');
    await art(h, page);
    await draw(page);
    await stroke(page);
    const before = await strokes(page), id = await tab(page);
    await waitFor(h, () => drafts(page), (ds) => ds.some((d) => same(d.strokes, before)), 'the single tab draft was not stored');
    await page.reload();
    await art(h, page);
    await draw(page);
    await page.waitForFunction(() => window.__daily.ink?.strokes.length === 1);
    await evidence(h, page, 'single-tab-after-reload');
    h.expect(await tab(page) === id, 'a single-tab reload changed its tab id');
    h.expect(same(await strokes(page), before), 'a single-tab reload lost its own draft');
    await ctx.close();
  },
};
