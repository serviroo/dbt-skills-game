import fs from 'node:fs';
import path from 'node:path';

async function art(h, page) {
  page.setDefaultTimeout(15000);
  await page.locator('.dq-tile--art').waitFor({ timeout: 30000 });
  for (let i = 0; i < 30 && await page.evaluate(() => window.__daily.greeting); i++) {
    if (await page.locator('.sw').count()) await page.keyboard.press('Enter');
    await h.sleep(200);
  }
  await page.evaluate(() => window.__daily.settled);
  if (await page.locator('.dq-artroom').count()) return;
  await back(page, 'hub');
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

async function savedPair(h, edit) {
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
  await b.getByRole('button', { name: 'Remove', exact: true }).click();
  await b.locator('.dq-piece-confirm').getByRole('button', { name: 'Remove', exact: true }).click();
  await b.locator('.dq-artroom').waitFor();
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
