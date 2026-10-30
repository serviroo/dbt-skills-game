// Story Room: one of their own drawings from the Art room, placed above a chapter. They pick it from their drawings,
// change it and take it off again; it shows above that chapter while writing and while reading, at a calm size on a
// phone either way up and on a desktop, named by the drawing's name, and the words never wait for it. The link is kept
// with the story by the drawing's id: it survives a reload and a Save Crystal, two open tabs both keep what they placed,
// an old Save Crystal without it still loads, and a drawing deleted or not on this device simply shows no picture.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crystal, restore } from './newer-save-safety.e2e.mjs';
import { holdStorage } from './story-reading.e2e.mjs';
import { gone } from './harness.mjs';

const OLD = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/older-saves/crystal-v1-8761293.json', import.meta.url)), 'utf8'));
const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'drawing-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});

const CH1 = 'The lantern hung by the door all winter.\n\nEvery night it glowed a little brighter, and nobody could say why. The fox who lived under the porch had a theory, but nobody had asked the fox.';
const CH2 = 'In spring the door opened by itself.\n\nOutside, the path went on further than anyone remembered, past the old mill and the bridge, all the way to the sea.';
const round = (pts) => pts.map(Math.round);
const ring = (cx, cy, rx, ry, from = 0, to = 2 * Math.PI, n = 40) => round(Array.from({ length: n + 1 }, (_, k) => from + ((to - from) * k) / n).flatMap((a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]));
// a lantern on a step (a page of 1200 by 1600) and a small fox (a shadow ally, 1000 by 1400), in the Art room's inks
const LANTERN = [
  { i: 1, w: 26, p: [440, 640, 760, 640, 790, 1080, 410, 1080, 440, 640] },
  { i: 1, w: 18, p: ring(600, 640, 110, 150, Math.PI, 2 * Math.PI) },
  { i: 2, w: 44, p: ring(600, 880, 60, 110) },
  { i: 0, w: 14, p: [180, 1240, 1020, 1240] },
];
const FOX = [
  { i: 1, w: 24, p: ring(500, 620, 200, 170) },
  { i: 1, w: 24, p: [340, 520, 330, 300, 450, 460] },
  { i: 1, w: 24, p: [660, 520, 670, 300, 550, 460] },
  { i: 2, w: 20, p: [430, 600, 445, 600] },
  { i: 2, w: 20, p: [555, 600, 570, 600] },
  { i: 0, w: 22, p: ring(500, 1040, 230, 230, -0.5 * Math.PI, 1.5 * Math.PI) },
];

const ready = (page) => page.waitForFunction(() => !!window.__daily, null, { timeout: 30000 });
const go = (page, route) => page.evaluate((r) => window.__daily.go(r), route);
async function writing(page, id, ch) {
  await go(page, { name: 'write', id, ...(ch ? { ch } : {}) });
  await page.getByRole('textbox', { name: /^Page,/ }).waitFor({ timeout: 10000 });
}
async function reading(page, id) {
  await go(page, { name: 'read', id });
  await page.locator('.st-read-ch').first().waitFor({ timeout: 10000 });
}
/** A story with two chapters of words, and with `art` two drawings in the Art room, made the way the app makes them. */
const make = (page, art = true) =>
  page.evaluate(
    async ({ CH1, CH2, LANTERN, FOX, art }) => {
      const key = window.__daily.store.key;
      const { storyStore } = await import('/src/daily/storystore.ts');
      const { artStore } = await import('/src/daily/artstore.ts');
      const ss = storyStore(key);
      const { story, first } = await ss.create('The lantern keeper');
      await ss.saveChapter({ ...first, title: 'The door', text: CH1 }, [first.rev]);
      const second = await ss.addChapter(story.id, 'Spring');
      await ss.saveChapter({ ...second, text: CH2 }, [second.rev]);
      if (art) {
        const as = artStore(key);
        await as.put({ id: 'lantern-page', kind: 'today', day: '2026-10-21', t: 1, updated: 1, n: LANTERN.length, name: 'Lantern on the step', strokes: LANTERN });
        await as.put({ id: 'fox-ally', kind: 'ally', day: '2026-10-22', t: 2, updated: 2, n: FOX.length, name: 'Brave', strokes: FOX });
      }
      return { id: story.id, ch1: first.id, ch2: second.id };
    },
    { CH1, CH2, LANTERN, FOX, art },
  );
/** The drawings the story holds as storage keeps it (not as a screen shows it). */
const placed = (page, id) =>
  page.evaluate(async (sid) => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    return (await storyStore(window.__daily.store.key).story(sid))?.drawings ?? null;
  }, id);
const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function placedIs(h, page, id, want, label) {
  for (const end = Date.now() + 5000; Date.now() < end; await h.sleep(150)) if (deep(await placed(page, id), want)) return;
  throw new Error(`${label}: the story holds ${JSON.stringify(await placed(page, id))}, not ${JSON.stringify(want)}`);
}
/** The drawing the open page has, as its button beside the starting point names it once its picture is in, or null. */
const button = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.st-write .st-pic-b');
    const img = b?.querySelector('.st-pic-thumb:not(.is-hidden) img');
    return { name: b?.getAttribute('aria-label') ?? b?.textContent ?? null, shown: !!b?.checkVisibility(), img: !!img, loaded: !!img && img.complete && img.naturalWidth > 0 };
  });
async function editorShows(h, page, want, label) {
  const name = want === null ? 'Add a drawing' : `Change drawing, ${want}`;
  for (const end = Date.now() + 8000; Date.now() < end; await h.sleep(150)) {
    const b = await button(page);
    if (b.shown && b.name === name && b.img === (want !== null) && b.loaded === (want !== null)) return;
  }
  throw new Error(`${label}: the drawing's button is ${JSON.stringify(await button(page))}, not "${name}"`);
}
/** What the reading view shows above each chapter: the drawing's alt text, once its picture is in, or null. */
const readPics = (page) => page.evaluate(() => [...document.querySelectorAll('.st-read-ch')].map((s) => s.querySelector('.st-read-pic img')?.alt ?? null));
async function readerShows(h, page, want, label) {
  const ok = await page
    .waitForFunction(
      (w) => {
        const secs = [...document.querySelectorAll('.st-read-ch')];
        return secs.length === w.length && secs.every((s, i) => {
          const img = s.querySelector('.st-read-pic img');
          return w[i] === null ? !img : !!img && img.alt === w[i] && img.complete && img.naturalWidth > 0;
        });
      },
      want,
      { timeout: 8000 },
    )
    .then(() => true, () => false);
  // a drawing that shouldn't show is given time to turn up anyway
  if (ok && want.includes(null)) await h.frames(page, 36);
  const now = await readPics(page);
  h.expect(ok && deep(now, want), `${label}: the chapters show ${JSON.stringify(now)}${ok ? '' : ' (a picture never loaded)'}, not ${JSON.stringify(want)}`);
}
async function pick(page, opener, name) {
  await page.getByRole('button', { name: opener }).click();
  const dlg = page.getByRole('dialog', { name: 'Pick a drawing' });
  await dlg.waitFor({ timeout: 5000 });
  await dlg.getByRole('button', { name, exact: true }).click();
  await gone(dlg, 5000);
}
const focused = (page) => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
async function safeShows(h, page, label) {
  h.expect(await page.locator('.dq-top .dq-safe').isVisible(), `${label}: the Safe Zone button is not showing`);
}

export const scenarios = {
  /** Pick a drawing for a chapter, see it while writing and reading, change it, reload, then take it off */
  async 'story-drawing-place-change-remove'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await ready(page);
      await h.reachHub(page);
      const t = await make(page);
      await writing(page, t.id);
      await editorShows(h, page, null, 'a new page');
      await safeShows(h, page, 'writing');

      await page.getByRole('button', { name: 'Add a drawing', exact: true }).click();
      const dlg = page.getByRole('dialog', { name: 'Pick a drawing' });
      await dlg.waitFor({ timeout: 5000 });
      const names = await dlg.locator('.st-pick').allTextContents();
      h.expect(deep(names, ['Brave', 'Lantern on the step']), `the drawings to pick from are ${JSON.stringify(names)}`);
      h.expect((await focused(page)) === 'Brave', 'focus did not move into the drawings');
      h.expect(!(await dlg.getByRole('button', { name: 'Remove drawing' }).count()), 'Remove drawing is offered with no drawing above the chapter');
      await page.keyboard.press('Escape');
      await gone(dlg, 5000);
      h.expect((await focused(page)) === 'Add a drawing', 'closing the drawings did not bring focus back');
      await placedIs(h, page, t.id, null, 'closing without a pick');

      await pick(page, 'Add a drawing', 'Lantern on the step');
      await editorShows(h, page, 'Lantern on the step', 'after the pick');
      h.expect((await focused(page)) === 'Change drawing', 'focus did not land on Change drawing');
      await placedIs(h, page, t.id, { [t.ch1]: 'lantern-page' }, 'after the pick');

      await reading(page, t.id);
      await readerShows(h, page, ['Lantern on the step', null], 'reading after the pick');
      await safeShows(h, page, 'reading');

      await writing(page, t.id, t.ch1);
      await pick(page, 'Change drawing', 'Brave');
      await editorShows(h, page, 'Brave', 'after the change');
      await placedIs(h, page, t.id, { [t.ch1]: 'fox-ally' }, 'after the change');
      // chapter 2 has none of its own
      await writing(page, t.id, t.ch2);
      await editorShows(h, page, null, 'chapter 2');
      // Notes never offer one
      await page.getByRole('radio', { name: 'Notes' }).click();
      await page.getByRole('textbox', { name: 'Notes for this story' }).waitFor();
      h.expect(!(await page.locator('.st-pic-b').isVisible()), 'Notes offered a drawing');

      await page.reload();
      await ready(page);
      await h.reachHub(page);
      await reading(page, t.id);
      await readerShows(h, page, ['Brave', null], 'reading after a reload');
      await writing(page, t.id, t.ch1);
      await editorShows(h, page, 'Brave', 'writing after a reload');

      await page.getByRole('button', { name: 'Change drawing' }).click();
      const sheet = page.getByRole('dialog', { name: 'Pick a drawing' });
      await sheet.getByRole('button', { name: 'Remove drawing', exact: true }).click();
      await gone(sheet, 5000);
      await editorShows(h, page, null, 'after Remove drawing');
      h.expect((await focused(page)) === 'Add a drawing', 'focus did not land on Add a drawing after Remove');
      await placedIs(h, page, t.id, null, 'after Remove drawing');
      await reading(page, t.id);
      await readerShows(h, page, [null, null], 'reading after Remove drawing');
      const art = await page.evaluate(async () => (await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).list()).map((m) => m.id).sort());
      h.expect(deep(art, ['fox-ally', 'lantern-page']), `the Art room lost a drawing: ${JSON.stringify(art)}`);
      h.expect(!errors.length, 'errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  /** A drawing deleted in the Art room, one that is on another device only, and an Art room that never answers */
  async 'story-drawing-gone'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await ready(page);
      await h.reachHub(page);
      const t = await make(page);
      await page.evaluate(async ({ id, ch1, ch2 }) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        await ss.setDrawing(id, ch1, 'lantern-page');
        await ss.setDrawing(id, ch2, 'drawn-on-another-device');
      }, t);
      await reading(page, t.id);
      await readerShows(h, page, ['Lantern on the step', null], 'a drawing that is on another device only');

      // the Art room's own delete
      await page.evaluate(async () => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).remove('lantern-page'));
      await page.reload();
      await ready(page);
      await h.reachHub(page);
      await reading(page, t.id);
      await readerShows(h, page, [null, null], 'a deleted drawing');
      h.expect((await page.locator('.st-read-text').allTextContents()).join('\n\n') === `${CH1}\n\n${CH2}`, 'the words changed');
      await writing(page, t.id, t.ch1);
      await editorShows(h, page, null, 'writing above a deleted drawing');
      await placedIs(h, page, t.id, { [t.ch1]: 'lantern-page', [t.ch2]: 'drawn-on-another-device' }, 'a deleted drawing');
      // the link stays, so a drawing that comes back (a Save Crystal's restore) is above its chapter again
      await page.evaluate(async (LANTERN) => (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).importAll([{ id: 'lantern-page', kind: 'today', day: '2026-10-21', t: 1, updated: 1, name: 'Lantern on the step', strokes: LANTERN }]), LANTERN);
      await reading(page, t.id);
      await readerShows(h, page, ['Lantern on the step', null], 'a drawing brought back');

      // the words never wait for the drawings
      await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        as.list = () => new Promise(() => {});
      });
      await go(page, { name: 'read', id: t.id });
      await page.waitForFunction((w) => [...document.querySelectorAll('.st-read-text')].map((e) => e.textContent).join('\n\n') === w, `${CH1}\n\n${CH2}`, { timeout: 5000 });
      h.expect(!errors.length, 'errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  /** Two tabs on one story each place a drawing on a different chapter, and both stay */
  async 'story-drawing-two-tabs'(h) {
    const { ctx, page: a, errors } = await h.open(seed(h));
    try {
      await ready(a);
      await h.reachHub(a);
      const t = await make(a);
      const b = await ctx.newPage();
      await b.goto(h.server.url + '/?mute');
      await ready(b);
      await h.reachHub(b);
      // both open before either places one, so each screen read the story without the other's drawing
      await writing(a, t.id, t.ch1);
      await writing(b, t.id, t.ch2);
      await pick(b, 'Add a drawing', 'Brave');
      await editorShows(h, b, 'Brave', 'tab B');
      await pick(a, 'Add a drawing', 'Lantern on the step');
      await editorShows(h, a, 'Lantern on the step', 'tab A');
      await placedIs(h, a, t.id, { [t.ch2]: 'fox-ally', [t.ch1]: 'lantern-page' }, 'two tabs');
      await reading(b, t.id);
      await readerShows(h, b, ['Lantern on the step', 'Brave'], 'reading in tab B');
      // both at the same moment
      await Promise.all([a, b].map((p, i) => p.evaluate(async ({ id, ch, d }) => (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key).setDrawing(id, ch, d), { id: t.id, ch: i ? t.ch2 : t.ch1, d: i ? null : 'fox-ally' })));
      await placedIs(h, a, t.id, { [t.ch1]: 'fox-ally' }, 'two tabs at the same moment');
      h.expect(!errors.length, 'errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  /** A drawing this device can't store stays on screen for now, and the page says it isn't saving, as it does for words */
  async 'story-drawing-not-stored-says-so'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await ready(page);
      await h.reachHub(page);
      const t = await make(page);
      await writing(page, t.id, t.ch1);
      await page.locator('.st-state').filter({ hasText: 'Saved on this device' }).waitFor({ timeout: 5000 });
      // from here every write to the stories fails, as on a device out of room
      await page.evaluate(() => {
        const real = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (mode === 'readwrite' && /\.story$/.test(this.name)) throw new DOMException('This device is out of room', 'QuotaExceededError');
          return real.call(this, stores, mode, ...rest);
        };
      });
      await pick(page, 'Add a drawing', 'Brave');
      await editorShows(h, page, 'Brave', 'a drawing this device could not store');
      await page.locator('.st-state').filter({ hasText: 'Not saving right now' }).waitFor({ timeout: 5000 });
      h.expect(!errors.length, 'errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  /** The picker opened on one chapter while the next was still coming in places the drawing on the one it opened for */
  async 'story-drawing-pick-stays-with-its-chapter'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await ready(page);
      await h.reachHub(page);
      const t = await make(page);
      await writing(page, t.id, t.ch1);
      await editorShows(h, page, null, 'chapter 1');
      await page.locator('.st-chbtn').click();
      const list = page.getByRole('dialog', { name: 'Chapters' });
      await list.waitFor({ timeout: 5000 });
      // chapter 2 opens as on a slow phone: its page waits for storage while the drawing button can still be tapped
      const held = await holdStorage(page, ['chapter']);
      await list.getByRole('button', { name: /Spring/ }).first().click();
      await held.waitHeld(`chapter ${t.ch2}`);
      await page.getByRole('button', { name: 'Add a drawing', exact: true }).click();
      const dlg = page.getByRole('dialog', { name: 'Pick a drawing' });
      await dlg.waitFor({ timeout: 5000 });
      await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        ss.chapter = ss.__real.chapter;
      });
      await held.drain();
      await page.getByRole('textbox', { name: 'Page, Spring' }).waitFor({ timeout: 5000 });
      await dlg.getByRole('button', { name: 'Brave', exact: true }).click();
      await gone(dlg, 5000);
      await placedIs(h, page, t.id, { [t.ch1]: 'fox-ally' }, 'a pick from the picker chapter 1 opened');
      await editorShows(h, page, null, 'chapter 2, on screen now');
      await writing(page, t.id, t.ch1);
      await editorShows(h, page, 'Brave', 'chapter 1');
      h.expect(!errors.length, 'errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  /**
   * The picker reads the story before it opens. Left in that moment for the Safe Zone, it never opens: sheets sit in a
   * layer that outlives the page, so a late one would cover "Talk to someone now".
   */
  async 'story-drawing-picker-after-leaving'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await ready(page);
      await h.reachHub(page);
      const t = await make(page);
      await writing(page, t.id, t.ch1);
      await editorShows(h, page, null, 'chapter 1');
      const held = await holdStorage(page, ['story']);
      await page.getByRole('button', { name: 'Add a drawing', exact: true }).click();
      await held.waitHeld(`story ${t.id}`);
      await page.locator('.dq-top .dq-safe').click();
      await page.getByRole('button', { name: 'Talk to someone now', exact: true }).waitFor({ timeout: 10000 });
      await held.drain();
      // the read has answered; whatever it was going to open has had its turn
      await h.frames(page, 2);
      const sheets = await page.locator('.st-sheet').count();
      h.expect(!sheets, `after leaving for the Safe Zone the drawing picker opened over it (${sheets} sheets)`);
      h.expect((await page.evaluate(() => window.__daily.route.name)) === 'safe', 'the Safe Zone did not stay open');
      h.expect(!errors.length, 'errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  /** An old Save Crystal's story takes a drawing, a new Save Crystal carries it, and restoring it keeps it */
  async 'story-drawing-old-save-and-crystal'(h) {
    let raw;
    {
      const { ctx, page, errors } = await h.open(seed(h));
      try {
        await ready(page);
        await h.reachHub(page);
        await restore(h, page, OLD, 'old-crystal.json');
        await reading(page, 'h-story');
        await readerShows(h, page, [null], 'an old story');
        await writing(page, 'h-story');
        await editorShows(h, page, null, 'an old story');
        await page.getByRole('button', { name: 'Add a drawing', exact: true }).click();
        const dlg = page.getByRole('dialog', { name: 'Pick a drawing' });
        await dlg.waitFor({ timeout: 5000 });
        const names = await dlg.locator('.st-pick').allTextContents();
        h.expect(deep(names, ['Brave', 'Your page from Wed 21 Oct']), `an old Save Crystal's drawings show as ${JSON.stringify(names)}`);
        await dlg.getByRole('button', { name: 'Brave', exact: true }).click();
        await editorShows(h, page, 'Brave', 'an old story');
        await go(page, { name: 'hub' });
        raw = await crystal(h, page, 'drawing-crystal');
        const s = raw.stories.stories.find((x) => x.id === 'h-story');
        h.expect(deep(s?.drawings, { 'h-chapter-1': 'h-draw-2' }), `the Save Crystal holds ${JSON.stringify(s?.drawings)}`);
        const old = OLD.stories.stories[0];
        h.expect(s.title === old.title && deep(s.chapters, old.chapters) && s.notes === old.notes && s.created === old.created, 'the old story changed beyond its drawing');
        h.expect(!errors.length, 'errors: ' + errors.join(' | '));
      } finally {
        await ctx.close();
      }
    }
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await ready(page);
      await h.reachHub(page);
      // this device already holds the old story without a drawing: the newer file brings its drawing in
      await restore(h, page, OLD, 'old-crystal.json');
      await restore(h, page, raw, 'drawing-crystal.json');
      await reading(page, 'h-story');
      await readerShows(h, page, ['Brave'], 'after a restore');
      // an older file never takes it away
      await go(page, { name: 'hub' });
      await restore(h, page, OLD, 'old-crystal.json');
      await page.reload();
      await ready(page);
      await h.reachHub(page);
      await reading(page, 'h-story');
      await readerShows(h, page, ['Brave'], 'after the old file again and a reload');
      h.expect(!errors.length, 'errors: ' + errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  /** At a phone's two sizes either way up and on a desktop: a calm size, inside the screen, and taps that land */
  async 'story-drawing-fits'(h) {
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }, { width: 1440, height: 900 }]) {
      const at = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      try {
        await ready(page);
        await h.reachHub(page);
        const t = await make(page);
        await page.evaluate(async ({ id, ch1 }) => (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key).setDrawing(id, ch1, 'lantern-page'), t);
        const wide = () => page.evaluate(() => [document.scrollingElement, document.querySelector('.dq'), document.querySelector('#dq-main')].filter(Boolean).some((e) => e.scrollWidth > e.clientWidth + 1));

        // writing: the drawing's button shares the starting point's line, so the page starts where it did
        await writing(page, t.id, t.ch1);
        await editorShows(h, page, 'Lantern on the step', at);
        await h.settled(page, '.st-start-tg, .st-pic-thumb');
        await h.shot(page, `drawing-write-${at}`);
        const w = await page.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const b = r('.st-pic-b'), start = r('.st-start-tg:not(.st-pic-b)');
          return { vw: document.documentElement.clientWidth, b: { w: b.width, h: b.height, l: b.left, r: b.right }, thumb: r('.st-pic-thumb').height, row: Math.abs(b.top - start.top) < 1 };
        });
        h.expect(!(await wide()), `writing at ${at} scrolls sideways`);
        h.expect(w.b.l >= 0 && w.b.r <= w.vw && w.b.w >= 44 && w.b.h >= 44, `writing at ${at}: the drawing's button is ${JSON.stringify(w.b)}`);
        h.expect(w.thumb <= 44 && w.row, `writing at ${at}: the drawing takes a line of its own (${JSON.stringify(w)})`);

        // reading: a calm size, inside the screen, above the chapter's words
        await reading(page, t.id);
        await readerShows(h, page, ['Lantern on the step', null], at);
        await h.settled(page, '.st-read-pic, .st-read-ch-h');
        await h.shot(page, `drawing-read-${at}`);
        const m = await page.evaluate(() => {
          const f = document.querySelector('.st-read-pic').getBoundingClientRect();
          return { vw: document.documentElement.clientWidth, H: innerHeight, f: { h: f.height, l: f.left, r: f.right, b: f.bottom }, head: document.querySelector('.st-read-ch-h').getBoundingClientRect().top };
        });
        h.expect(!(await wide()), `reading at ${at} scrolls sideways`);
        h.expect(m.f.l >= 0 && m.f.r <= m.vw, `reading at ${at}: the drawing reaches past the edge`);
        h.expect(m.f.h <= Math.min(282, 0.42 * m.H) && m.f.h >= 100, `reading at ${at}: the drawing is ${Math.round(m.f.h)} px tall`);
        h.expect(m.f.b <= m.head + 1, `reading at ${at}: the drawing sits over the words`);

        await writing(page, t.id, t.ch1);
        await page.getByRole('button', { name: 'Change drawing' }).click();
        await page.getByRole('dialog', { name: 'Pick a drawing' }).waitFor({ timeout: 5000 });
        await h.settled(page, '.st-picks, .st-pick');
        await h.shot(page, `drawing-pick-${at}`);
        h.expect(!(await wide()), `the drawings at ${at} scroll sideways`);
        h.expect(!errors.length, 'errors: ' + errors.join(' | '));
      } finally {
        await ctx.close();
      }
    }
  },
};
