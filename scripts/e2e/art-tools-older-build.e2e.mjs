// A drawing made with the eraser and the soft glow meets the build from before those tools. That build shows less of
// it, never a tool's stroke painted as a brush line, and what it saves can't damage the drawing for good: restoring the
// Save Crystal again once the device is on this build brings the drawing back whole. A Restore of the same version
// with other content keeps everything: it updates a copy it holds all of, and otherwise comes in beside it. A page named
// on this build and edited on the build from before names (which drops the name but keeps when it was set) gets its name
// back from the Save Crystal.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { drawPage, inkAt, line, pick, strokes } from './art-eraser-glow.e2e.mjs';
import { active, build, buildOf, crystal, host, restore, update } from './newer-save-safety.e2e.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The build that was live before the eraser and the soft glow. */
const BEFORE_TOOLS = 'f320b2cb2eaae6eefab5a319487372aec9fe2d44';
/** The build that was live before names and favourites: it keeps the fields it can't read, but saves a page unnamed. */
const BEFORE_NAMES = '195d584bfac0f8ea476c634106e86b21f29a659f';

/** Builds commit sha of this repo into scratch, tagged tag, with this checkout's node_modules. */
async function buildAt(scratch, sha, tag) {
  const src = path.join(scratch, `src-${tag}`);
  fs.mkdirSync(src);
  // not execFileSync: scenarios run side by side in this process, and the copy would stall them all while it runs
  const tarball = path.join(scratch, `src-${tag}.tar`);
  await promisify(execFile)('git', ['archive', '-o', tarball, sha], { cwd: root });
  await promisify(execFile)('tar', ['-x', '-f', tarball, '-C', src]);
  fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(src, 'node_modules'));
  return build(src, path.join(scratch, tag), tag);
}

/** A brush line, a soft-glow line and an eraser cutting the brush line, saved, and the Save Crystal with it, as <name>.json. */
async function toolCrystal(h, name) {
  const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
  await drawPage(h, page);
  await line(page, [0.2, 0.4], [0.8, 0.4]);
  await pick(page, 'Soft glow');
  await line(page, [0.2, 0.7], [0.8, 0.7]);
  await pick(page, 'Eraser');
  await line(page, [0.5, 0.25], [0.5, 0.55]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved in your Art room.').waitFor();
  await toSettings(page);
  const raw = await crystal(h, page, name);
  h.expect(!errors.length, errors.join('\n'));
  await ctx.close();
  return raw;
}
/** Opens saved drawing id on the drawing page and waits for its strokes. */
async function openDrawing(page, id) {
  await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
  await page.locator('.dq-ink-live').waitFor();
  await page.waitForFunction(() => window.__daily?.ink?.strokes.length && !document.querySelector('.dq-ink-stage')?.inert);
}
/** The brush line cut by the eraser, the soft-glow core, and the eraser's path off the brush line. */
const looks = async (page) => ({ cut: await inkAt(page, 600, 640), line: await inkAt(page, 300, 640), glow: await inkAt(page, 600, 1120), path: await inkAt(page, 600, 460) });
/** The ids of the drawings stored on this device (read from its database, so it works on a production build too). */
/** Settings, from any screen. */
const toSettings = async (page) => {
  await page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
  await page.locator('.dq-settings').waitFor({ timeout: 10000 });
};
const pages = (page) =>
  page.evaluate(async () => {
    const db = await new Promise((ok, bad) => Object.assign(indexedDB.open(`${window.__daily.store.key}.art`), { onsuccess: (e) => ok(e.target.result), onerror: bad }));
    const ids = await new Promise((ok, bad) => Object.assign(db.transaction('meta').objectStore('meta').getAllKeys(), { onsuccess: (e) => ok(e.target.result), onerror: bad }));
    db.close();
    return ids;
  });
/** Drawing id's meta as stored on this device (read from its database, so it works on a production build too). */
const storedMeta = (page, id) =>
  page.evaluate(async (id) => {
    const db = await new Promise((ok, bad) => Object.assign(indexedDB.open(`${window.__daily.store.key}.art`), { onsuccess: (e) => ok(e.target.result), onerror: bad }));
    const m = await new Promise((ok, bad) => Object.assign(db.transaction('meta').objectStore('meta').get(id), { onsuccess: (e) => ok(e.target.result ?? null), onerror: bad }));
    db.close();
    return m;
  }, id);

export const scenarios = {
  async 'art-tools-meet-the-build-before-them'(h) {
    const { expect } = h;
    const raw = await toolCrystal(h, 'tools-before-them');
    const id = raw.art[0].id;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-before-tools-'));
    try {
      const [a, b] = await Promise.all([buildAt(scratch, BEFORE_TOOLS, 'before-tools'), build(root, path.join(scratch, 'b'), 'this-build')]);
      const site = await host(a.dir);
      const ctx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'allow' });
      await ctx.addInitScript((seen) => {
        if (localStorage.getItem('dbt.app.v1') === null) localStorage.setItem('dbt.app.v1', seen);
        if (localStorage.getItem('dbt.you.v1') === null) localStorage.setItem('dbt.you.v1', JSON.stringify({ name: 'Robin', companion: 'Pip', nameAt: 1, companionAt: 1 }));
      }, h.SEEN);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      try {
        // a device still on the build from before the tools restores the Save Crystal and saves one of its own
        await page.goto(site.url + '?mute');
        const closed = await h.reachHub(page);
        expect(JSON.stringify(closed) === '["Notification"]', 'the older build did not close its welcome: ' + JSON.stringify(closed));
        await active(page, a, h.sleep);
        expect((await buildOf(page)) === 'before-tools', 'the first load is not the build from before the tools');
        await restore(h, page, raw);
        await openDrawing(page, id);
        const older = await looks(page);
        await h.shot(page, 'before-tools-shows-390x844');
        expect(older.line > 200, `the build before the tools lost the brush line (${JSON.stringify(older)})`);
        expect(older.path === 0, `the build before the tools painted the eraser's stroke as a line (${JSON.stringify(older)})`);
        expect(older.glow === 0, `the build before the tools painted the soft-glow line as a brush line (${JSON.stringify(older)})`);
        await toSettings(page);
        const fromA = await crystal(h, page, 'before-tools');
        expect(fromA.art?.length === 1 && fromA.art[0].strokes.every((s) => !s.m), 'the build before the tools saved something unexpected: ' + JSON.stringify(fromA.art?.map((r) => r.strokes.length)));
        // the device moves to this build: restoring the first Save Crystal again brings the drawing back whole
        site.use(b.dir);
        expect((await update(page, b)) === 'activated', 'this build never installed');
        await active(page, b, h.sleep);
        await page.reload();
        await h.reachHub(page);
        expect((await buildOf(page)) === 'this-build', 'the device did not move to this build');
        const said = await restore(h, page, raw, 'tools-again.json');
        expect(/1 updated/.test(said), 'restoring the drawing again did not update the copy the older build saved: ' + said);
        await openDrawing(page, id);
        const whole = await looks(page);
        await h.shot(page, 'this-build-whole-390x844');
        expect(JSON.stringify(await strokes(page)) === '["brush","glow","erase"]', 'the drawing did not come back whole: ' + JSON.stringify(await strokes(page)));
        expect(whole.cut === 0 && whole.line > 200 && whole.glow > 200 && whole.path === 0, `the drawing does not show its cut and its glow again (${JSON.stringify(whole)})`);
        // the older build's own Save Crystal holds less of the same version: restoring it changes nothing
        await toSettings(page);
        await restore(h, page, fromA, 'before-tools.json');
        await openDrawing(page, id);
        expect(JSON.stringify(await strokes(page)) === '["brush","glow","erase"]' && JSON.stringify(await looks(page)) === JSON.stringify(whole), 'the older build\'s Save Crystal took the drawing back to less');
        expect(JSON.stringify(await pages(page)) === JSON.stringify([id]), 'restoring made extra pages: ' + JSON.stringify(await pages(page)));
        expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
        await site.close();
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },

  async 'art-name-meets-the-build-before-names'(h) {
    const { expect } = h;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-before-names-'));
    try {
      const [a, b] = await Promise.all([buildAt(scratch, BEFORE_NAMES, 'before-names'), build(root, path.join(scratch, 'b'), 'this-build')]);
      const site = await host(b.dir);
      const ctx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
      await ctx.addInitScript((seen) => {
        if (localStorage.getItem('dbt.app.v1') === null) localStorage.setItem('dbt.app.v1', seen);
        if (localStorage.getItem('dbt.you.v1') === null) localStorage.setItem('dbt.you.v1', JSON.stringify({ name: 'Robin', companion: 'Pip', nameAt: 1, companionAt: 1 }));
      }, h.SEEN);
      const errors = [];
      const open = async (tag) => {
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
        await page.goto(site.url + '?mute');
        await h.reachHub(page);
        expect((await buildOf(page)) === tag, `the page is not on ${tag}: ${await buildOf(page)}`);
        return page;
      };
      try {
        // this build: a page drawn, named, and kept in a Save Crystal
        const now = await open('this-build');
        await drawPage(h, now);
        await line(now, [0.2, 0.4], [0.8, 0.4]);
        await now.getByRole('button', { name: 'Save', exact: true }).click();
        await now.getByText('Saved in your Art room.').waitFor();
        const [id] = await pages(now);
        await now.evaluate((id) => window.__daily.go({ name: 'piece', id }), id);
        await now.getByRole('button', { name: 'Rename', exact: true }).click();
        await now.getByLabel('Name this page').fill('Sunrise');
        await now.keyboard.press('Enter');
        await now.locator('.dq-piece-h', { hasText: 'Sunrise' }).waitFor();
        await toSettings(now);
        const raw = await crystal(h, now, 'named');
        expect(raw.art.length === 1 && raw.art[0].name === 'Sunrise', 'the Save Crystal does not hold the name');

        // the build from before names, open beside it: Keep drawing, one more line, Save
        site.use(a.dir);
        const old = await open('before-names');
        await openDrawing(old, id);
        await old.waitForFunction(() => !document.querySelector('.dq-draw')?.getAnimations().some((a) => a.playState === 'running'));
        await line(old, [0.2, 0.7], [0.8, 0.7]);
        await old.getByRole('button', { name: 'Save', exact: true }).click();
        for (let i = 0; (await storedMeta(old, id))?.n !== 2; i++) {
          expect(i < 100, 'the build from before names did not save the new line');
          await h.sleep(100);
        }
        const edited = await storedMeta(old, id);
        expect(!edited.name && edited.nameAt === raw.art[0].nameAt, 'the build from before names did not save the page as it does: ' + JSON.stringify({ name: edited.name, nameAt: edited.nameAt }));
        await old.close();

        // back on this build: the Save Crystal names the newer drawing again and keeps its new line
        site.use(b.dir);
        await now.reload();
        await h.reachHub(now);
        expect((await buildOf(now)) === 'this-build', 'the first tab did not come back to this build');
        const said = await restore(h, now, raw, 'named-again.json');
        const back = await storedMeta(now, id);
        expect(back?.name === 'Sunrise' && back.n === 2, `restoring the Save Crystal did not bring the name back onto the newer drawing (${said}): ${JSON.stringify(back && { name: back.name, nameAt: back.nameAt, n: back.n })}`);
        expect(JSON.stringify(await pages(now)) === JSON.stringify([id]), 'restoring made extra pages: ' + JSON.stringify(await pages(now)));
        expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
        await site.close();
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },

  async 'art-restore-of-the-same-version-with-other-content'(h) {
    const { expect } = h;
    const raw = await toolCrystal(h, 'tools-same-version');
    const rec = raw.art[0];
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    await h.reachHub(page);
    await restore(h, page, raw);
    // the same version with other content, neither holding all of the other: the file's comes in, the one here stays
    const other = { ...raw, art: [{ ...rec, strokes: [{ i: 3, w: 25.2, p: [200, 1400, 1000, 1400] }], n: 1 }] };
    await toSettings(page);
    const said = await restore(h, page, other, 'other.json');
    expect(/1 kept as its own page/.test(said), 'a Restore of the same version with other content was not kept: ' + said);
    const ids = await pages(page);
    expect(ids.length === 2 && ids.includes(rec.id), 'both versions are not in the Art room: ' + JSON.stringify(ids));
    await openDrawing(page, rec.id);
    expect((await page.evaluate(() => window.__daily.ink.strokes.length)) === 1 && (await inkAt(page, 600, 1400)) > 200, "the page does not show the Restore's version");
    await openDrawing(page, ids.find((x) => x !== rec.id));
    expect(JSON.stringify(await strokes(page)) === '["brush","glow","erase"]', 'the version that was here is not kept as its own page');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
