// The Art room's eraser and soft-glow brush, through the real page: pick a tool, erase part of a line (and only that
// part, its light too), undo and redo the erase, keep tools out of XP, and carry every stroke's tool through a save,
// a Save Crystal and a restore.
import fs from 'node:fs';
import path from 'node:path';

/** Taps into the Art room from Home and opens a blank Draw today page. */
export async function drawPage(h, page) {
  page.setDefaultTimeout(15000);
  for (let i = 0; ; i++) {
    await h.reachHub(page);
    try {
      await page.locator('.dq-tile--art').click({ timeout: 8000 });
      await page.locator('.dq-artroom').waitFor({ timeout: 8000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.getByRole('button', { name: /^Draw today/ }).click();
  await page.locator('.dq-ink-live').waitFor();
  await page.waitForFunction(() => window.__daily?.ink && !document.querySelector('.dq-ink-stage')?.inert);
  // the page takes input while its screen is still sliding in: strokes aimed by the page's box wait until it rests
  await page.waitForFunction(() => !document.querySelector('.dq-draw')?.getAnimations().some((a) => a.playState === 'running'));
}
/** A mouse stroke between two points given as fractions of the page. */
export async function line(page, a, b) {
  const box = await page.locator('.dq-ink-live').boundingBox();
  await page.mouse.move(box.x + box.width * a[0], box.y + box.height * a[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * b[0], box.y + box.height * b[1], { steps: 14 });
  await page.mouse.up();
}
export const pick = (page, name) => page.getByRole('radio', { name, exact: true }).click();
const checked = async (page, name) => (await page.getByRole('radio', { name, exact: true }).getAttribute('aria-checked')) === 'true';
export const strokes = (page) => page.evaluate(() => window.__daily.ink.strokes.map((s) => s.m ?? 'brush'));
/** How much ink the page shows at a point (alpha of the committed ink layer, 0 to 255). */
export const inkAt = (page, x, y) => page.evaluate(([x, y]) => document.querySelector('.dq-ink-ink').getContext('2d').getImageData(x, y, 1, 1).data[3], [x, y]);
/** Brightness (r + g + b) at points of the drawing as it is saved and exported. */
const renderAt = (page, pts) => page.evaluate((pts) => {
  const g = window.__daily.ink.render(1200).getContext('2d');
  return pts.map(([x, y]) => g.getImageData(x, y, 1, 1).data.slice(0, 3).reduce((a, b) => a + b, 0));
}, pts);
/** Each stroke of drawing id as this device stores it. */
const storedStrokes = (page, id) =>
  page.evaluate(async (id) => {
    const { artStore } = await import('/src/daily/artstore.ts');
    const as = artStore(window.__daily.store.key);
    id ??= (await as.list())[0].id;
    const db = await new Promise((ok, bad) => Object.assign(indexedDB.open(as.name), { onsuccess: (e) => ok(e.target.result), onerror: bad }));
    const s = await new Promise((ok, bad) => Object.assign(db.transaction('strokes').objectStore('strokes').get(id), { onsuccess: (e) => ok(e.target.result), onerror: bad }));
    db.close();
    return s;
  }, id);
/** A tool's stroke is stored with an empty p (a build from before tools skips it) and its points in q. */
const toolShape = (strokes) => strokes.every((s) => (s.m ? s.p.length === 0 && s.q?.length >= 2 : s.p.length >= 2 && !('q' in s)));
const xp = (page) => page.evaluate(() => window.__daily.store.state.events.reduce((a, e) => a + (e.xp || 0), 0));

/** A brush line at 40% down, a soft-glow line at 70%, and an eraser cutting the brush line in the middle. */
async function drawAndErase(h, page) {
  await line(page, [0.2, 0.4], [0.8, 0.4]);
  await pick(page, 'Soft glow');
  await line(page, [0.2, 0.7], [0.8, 0.7]);
  await pick(page, 'Eraser');
  await line(page, [0.5, 0.25], [0.5, 0.55]);
  h.expect(JSON.stringify(await strokes(page)) === '["brush","glow","erase"]', 'brush, soft glow and eraser strokes were not kept in order: ' + JSON.stringify(await strokes(page)));
}

async function phone(h, vp, tag) {
  const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', vp);
  await drawPage(h, page);
  await h.settled(page, '.dq-tools button, .dq-draw-frame, .dq-pens, .dq-sizes');
  const { expect } = h;
  expect(await page.getByRole('radiogroup', { name: 'Tool' }).isVisible(), `${tag}: no Tool group on the drawing page`);
  for (const name of ['Brush', 'Soft glow', 'Eraser']) {
    const r = await page.getByRole('radio', { name, exact: true }).boundingBox();
    expect(r && r.width >= 44 && r.height >= 44 && r.x >= 0 && r.x + r.width <= vp.width && r.y >= 0 && r.y + r.height <= vp.height, `${tag}: ${name} is not a whole tap target on screen: ${JSON.stringify(r)}`);
  }
  expect(await checked(page, 'Brush') && !(await checked(page, 'Soft glow')) && !(await checked(page, 'Eraser')), `${tag}: the brush is not the tool a page starts with`);
  const fit = await page.evaluate(() => {
    const box = (s) => document.querySelector(s).getBoundingClientRect();
    return { scroll: document.scrollingElement.scrollWidth, frame: box('.dq-draw-frame').height, pens: box('.dq-pens'), sizes: box('.dq-sizes'), tools: box('.dq-tools') };
  });
  expect(fit.scroll <= vp.width, `${tag}: the page scrolls sideways (${fit.scroll} px)`);
  expect(fit.frame >= 180, `${tag}: the drawing page is only ${fit.frame} px tall`);
  expect(fit.tools.bottom <= vp.height, `${tag}: the tools run off the bottom of the screen`);
  expect(Math.abs(fit.pens.top + fit.pens.height / 2 - (fit.sizes.top + fit.sizes.height / 2)) < 2, `${tag}: the tools and the sizes are not one row`);
  return { ctx, page, errors };
}

export const scenarios = {
  /** 390 px: the three tools, a glow line, an eraser that cuts only what it passes over, undo and redo, no XP */
  async 'art-eraser-and-soft-glow'(h) {
    const { expect, shot } = h;
    const { ctx, page, errors } = await phone(h, { width: 390, height: 844 }, '390');
    const xp0 = await xp(page);
    await line(page, [0.2, 0.4], [0.8, 0.4]);
    await pick(page, 'Soft glow');
    expect(await checked(page, 'Soft glow') && !(await checked(page, 'Brush')), 'Soft glow did not become the tool');
    expect((await page.locator('.dq-tools').getAttribute('data-tool')) === 'glow', 'the size dots do not show the soft glow');
    const [paper0, glowNear0] = await renderAt(page, [[600, 1500], [600, 1180]]);
    await line(page, [0.2, 0.7], [0.8, 0.7]);
    // a light: a bright core on the line, and its glow well past the line's own width
    const [core, glowNear, paper] = await renderAt(page, [[600, 1120], [600, 1180], [600, 1500]]);
    expect(core > 600, `the soft glow has no bright core (${core})`);
    expect(glowNear > glowNear0 + 40 && glowNear > paper + 40, `the soft glow does not glow past its line (${glowNear0} -> ${glowNear}, paper ${paper})`);
    expect(Math.abs(paper - paper0) < 6, 'the soft glow lit the far side of the page');
    await pick(page, 'Eraser');
    expect(await checked(page, 'Eraser') && (await page.locator('.dq-tools').getAttribute('data-tool')) === 'erase', 'the Eraser did not become the tool');
    // the inks stay at full strength while erasing: tapping one goes back to painting, so none looks switched off
    const strength = await page.evaluate(() => [...document.querySelectorAll('.dq-swatch-dot')].map((d) => {
      let o = 1;
      for (let e = d; e && !e.classList.contains('dq-tools'); e = e.parentElement) o *= +getComputedStyle(e).opacity;
      return o;
    }));
    expect(strength.length === 5 && strength.every((o) => o === 1), 'while erasing the inks fade as if they could not be tapped: ' + strength);
    const inkBefore = [await inkAt(page, 600, 640), await inkAt(page, 300, 640), await inkAt(page, 900, 640)];
    expect(inkBefore.every((a) => a > 200), 'the brush line is not where the eraser will pass: ' + inkBefore);
    const lit = await renderAt(page, [[600, 640], [300, 600], [600, 950], [600, 1120]]);
    await line(page, [0.5, 0.25], [0.5, 0.55]);
    await shot(page, 'erased-390');
    expect(JSON.stringify(await strokes(page)) === '["brush","glow","erase"]', 'the eraser stroke was not kept after the others: ' + JSON.stringify(await strokes(page)));
    expect((await inkAt(page, 600, 640)) === 0, 'the eraser left ink where it passed');
    expect((await inkAt(page, 300, 640)) === inkBefore[1] && (await inkAt(page, 900, 640)) === inkBefore[2], 'the eraser took ink it never passed over');
    const after = await renderAt(page, [[600, 640], [300, 640], [600, 640], [300, 600], [600, 950], [600, 1120]]);
    expect(after[0] < 150 && after[1] > 400, `the saved image does not show the cut (cut ${after[0]}, line ${after[1]})`);
    expect(after[2] < lit[0] / 3, `the erased part's light stayed on (${lit[0]} -> ${after[2]})`);
    expect(Math.abs(after[3] - lit[1]) < 4, `the light of the part left alone changed (${lit[1]} -> ${after[3]})`);
    expect(Math.abs(after[4] - lit[2]) < 4 && Math.abs(after[5] - lit[3]) < 4, `the eraser dimmed light from a line it never touched (${lit.slice(2)} -> ${after.slice(4)})`);
    // undo and redo treat it like any stroke
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await inkAt(page, 600, 640)) === inkBefore[0] && (await strokes(page)).length === 2, 'Undo did not bring the erased ink back');
    expect(Math.abs((await renderAt(page, [[600, 640]]))[0] - lit[0]) < 4, 'Undo did not bring the erased light back');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    expect((await inkAt(page, 600, 640)) === 0 && (await strokes(page)).length === 3, 'Redo did not erase again');
    // an eraser stroke over empty paper isn't kept: nothing to undo, nothing stored
    await line(page, [0.88, 0.04], [0.96, 0.1]);
    expect((await strokes(page)).length === 3, 'an eraser stroke over empty paper was kept');
    expect(await page.getByRole('button', { name: 'Redo', exact: true }).isDisabled(), 'an eraser stroke over nothing changed the history');
    expect((await xp(page)) === xp0, 'a tool changed XP');
    // picking an ink while erasing goes back to the last way of painting
    await pick(page, 'Mint ink');
    expect(await checked(page, 'Soft glow') && (await checked(page, 'Mint ink')), 'picking an ink while erasing did not go back to the soft glow');
    // the keyboard reaches the tools, with a visible focus ring: Tab lands on the picked tool, arrows move to the Eraser
    await page.getByRole('radio', { name: 'Mint ink', exact: true }).focus();
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(stop === 'Soft glow', 'Tab from the inks does not reach the picked tool: ' + stop);
    await page.keyboard.press('ArrowRight');
    const focus = await page.evaluate(() => ({ name: document.activeElement?.getAttribute('aria-label'), ring: getComputedStyle(document.activeElement).outlineStyle, w: parseFloat(getComputedStyle(document.activeElement).outlineWidth) }));
    expect(focus.name === 'Eraser' && focus.ring !== 'none' && focus.w > 0, 'the arrow keys do not reach the Eraser with a visible focus ring: ' + JSON.stringify(focus));
    await page.keyboard.press('Space');
    expect(await checked(page, 'Eraser'), 'the keyboard did not pick the Eraser');
    await shot(page, 'tools-390');
    // saved with each stroke's tool; the brush stroke keeps exactly the shape it always had
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved in your Art room.').waitFor();
    const rec = await storedStrokes(page);
    expect(JSON.stringify(rec.map((s) => Object.keys(s))) === '[["i","w","p"],["i","w","p","m","q"],["i","w","p","m","q"]]' && rec[1].m === 'glow' && rec[2].m === 'erase' && toolShape(rec), 'the saved strokes lost their tools or their stored shape: ' + JSON.stringify(rec.map((s) => ({ ...s, p: s.p.length, q: s.q?.length }))));
    // the Safe Zone stays one tap away
    const safe = page.getByRole('button', { name: /Safe Zone/ }).first();
    const sb = await safe.boundingBox();
    expect(sb && sb.y >= 0 && sb.y + sb.height <= 844 && sb.x + sb.width <= 390, 'the Safe Zone button is not on screen');
    await safe.click();
    await page.waitForFunction(() => /safe/i.test(window.__daily.route.name));
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** 320 px: everything fits, the eraser cuts, and the glow draws */
  async 'art-eraser-and-soft-glow-at-320'(h) {
    const { ctx, page, errors } = await phone(h, { width: 320, height: 568 }, '320');
    await drawAndErase(h, page);
    h.expect((await inkAt(page, 600, 640)) === 0 && (await inkAt(page, 300, 640)) > 200, '320: the eraser did not cut only where it passed');
    h.expect((await inkAt(page, 600, 1120)) > 200, '320: the soft glow drew no core');
    await h.shot(page, 'erased-320');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** sideways phone and desktop: the tools carry their names, and fit beside the page */
  async 'art-tools-named-sideways-and-desktop'(h) {
    for (const vp of [{ width: 844, height: 390 }, { width: 1280, height: 800 }]) {
      const tag = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', vp);
      await drawPage(h, page);
      await drawAndErase(h, page);
      const named = await page.evaluate(() => [...document.querySelectorAll('.dq-pen-n, .dq-swatch-n')].map((n) => {
        const r = n.getBoundingClientRect();
        return { t: n.textContent, w: r.width, h: r.height, right: r.right, bottom: r.bottom, size: parseFloat(getComputedStyle(n).fontSize) };
      }));
      // a phone's text is 16 px at least
      const least = vp.height < 500 ? 16 : 14;
      h.expect(named.length === 8 && named.every((n) => n.w > 10 && n.h > 10 && n.right <= vp.width && n.bottom <= vp.height && n.size >= least), `${tag}: the tool and ink names are not shown at ${least} px or more: ${JSON.stringify(named)}`);
      const over = await page.evaluate(() => document.scrollingElement.scrollWidth);
      h.expect(over <= vp.width, `${tag}: the page scrolls sideways`);
      await h.shot(page, `erased-${tag}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** a Save Crystal carries each stroke's tool, a restore draws the cut again, and old or unknown strokes stay safe */
  async 'art-tool-strokes-in-a-save-crystal'(h) {
    const { expect } = h;
    const a = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    await drawPage(h, a.page);
    await drawAndErase(h, a.page);
    await a.page.getByRole('button', { name: 'Save', exact: true }).click();
    await a.page.getByText('Saved in your Art room.').waitFor();
    await a.page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
    const pending = a.page.waitForEvent('download');
    await a.page.getByRole('button', { name: 'Save Crystal', exact: true }).click();
    const file = path.join(h.out, 'art-tools-crystal.json');
    await (await pending).saveAs(file);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const art = raw.art?.[0];
    expect(art && JSON.stringify(art.strokes.map((s) => s.m ?? 'brush')) === '["brush","glow","erase"]', 'the Save Crystal lost the strokes\' tools: ' + JSON.stringify(art?.strokes.map((s) => s.m)));
    expect(toolShape(art.strokes), 'the Save Crystal stores a tool\'s stroke in a shape a build from before tools would paint: ' + JSON.stringify(art.strokes.map((s) => ({ ...s, p: s.p.length, q: s.q?.length }))));
    expect(!a.errors.length, a.errors.join('\n'));
    await a.ctx.close();

    const b = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    await h.reachHub(b.page);
    // an old stroke has no tool and stays a brush stroke. What a newer build stored (a tool, a field or an ink this
    // build doesn't know) is kept exactly as stored, and a stroke this build can't draw draws nothing. What an older
    // build leaves of a tool's stroke (no points) is dropped.
    const newer = [{ i: 1, w: 3, p: [1, 2, 3, 4] }, { i: 1, w: 3, p: [], m: 'smudge', q: [1, 2] }, { i: 2, w: 9, p: [], m: 'glow', q: [5, 6] }, { i: 1, w: 3, p: [7, 8], o: 0.5 }, { i: 9, w: 3, p: [1, 2] }];
    const clean = await b.page.evaluate(async (newer) => {
      const { cleanStrokes, storedStroke } = await import('/src/daily/artstore.ts');
      const read = cleanStrokes([...newer, { i: 1, w: 3, p: [] }], 'today');
      return { read, back: read.map(storedStroke) };
    }, newer);
    expect(JSON.stringify(clean.read) === JSON.stringify([{ i: 1, w: 3, p: [1, 2, 3, 4] }, { i: 1, w: 3, p: [] }, { i: 2, w: 9, p: [5, 6], m: 'glow' }, { i: 1, w: 3, p: [7, 8] }, { i: 4, w: 3, p: [1, 2] }]), 'old or newer strokes did not read safely: ' + JSON.stringify(clean.read));
    expect(JSON.stringify(clean.back) === JSON.stringify(newer), 'strokes a newer build stored are not written back as they were: ' + JSON.stringify(clean.back));
    // the file also carries a field and a tool from a newer build; both come through a restore, a Save Crystal and an edit
    const smudge = { i: 1, w: 12, p: [], m: 'smudge', q: [100, 100, 200, 200] };
    raw.art[0] = { ...art, glaze: { k: 1 }, strokes: [...art.strokes, smudge], n: art.strokes.length + 1 };
    await b.page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
    await b.page.locator('input[type=file]').setInputFiles({ name: 'crystal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
    await b.page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
    await b.page.waitForFunction(() => /Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
    await b.page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), art.id);
    await b.page.locator('.dq-ink-live').waitFor();
    await b.page.waitForFunction(() => window.__daily?.ink?.strokes.length === 4 && !document.querySelector('.dq-ink-stage')?.inert);
    expect(JSON.stringify(await strokes(b.page)) === '["brush","glow","erase","brush"]', 'the restored drawing lost its tools');
    expect((await inkAt(b.page, 600, 640)) === 0 && (await inkAt(b.page, 300, 640)) > 200, 'the restored drawing does not show the cut');
    expect((await inkAt(b.page, 150, 150)) === 0, 'a stroke from a tool this build does not know was painted');
    await h.shot(b.page, 'restored');
    // an edit here keeps the newer build's field and stroke
    await line(b.page, [0.7, 0.85], [0.9, 0.9]);
    await b.page.getByRole('button', { name: 'Save', exact: true }).click();
    let edited = [];
    for (let i = 0; i < 75 && edited?.length !== 5; i++) {
      await h.sleep(200);
      edited = await storedStrokes(b.page, art.id);
    }
    const meta = await b.page.evaluate(async (id) => (await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).list()).find((m) => m.id === id), art.id);
    expect(edited.length === 5 && JSON.stringify(edited[3]) === JSON.stringify(smudge) && toolShape(edited.filter((s) => s !== edited[3])), 'an edit here changed the stroke from the newer build: ' + JSON.stringify(edited.map((s) => ({ ...s, p: s.p.length, q: s.q?.length }))));
    expect(JSON.stringify(meta?.glaze) === '{"k":1}', 'an edit here dropped the drawing\'s field from the newer build: ' + JSON.stringify(meta));
    await b.page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
    const out = b.page.waitForEvent('download');
    await b.page.getByRole('button', { name: 'Save Crystal', exact: true }).click();
    const file2 = path.join(h.out, 'art-tools-crystal-again.json');
    await (await out).saveAs(file2);
    const again = JSON.parse(fs.readFileSync(file2, 'utf8')).art?.find((r) => r.id === art.id);
    expect(JSON.stringify(again?.glaze) === '{"k":1}' && JSON.stringify(again?.strokes[3]) === JSON.stringify(smudge), 'the next Save Crystal lost what the newer build stored: ' + JSON.stringify({ glaze: again?.glaze, s3: again?.strokes[3] }));
    expect(!b.errors.length, b.errors.join('\n'));
    await b.ctx.close();
  },
};
