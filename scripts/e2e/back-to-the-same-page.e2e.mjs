// Back and Forward to a page the player was working on open it as they left it, also on the way back from the Safe Zone.
//   back-to-a-saved-drawing   a Draw today page saved, then the Safe Zone and Back: the page still shows the saved
//                             drawing, and a line more and Save change that drawing rather than start a second one. The
//                             same after the Art room and Forward. No step credits anything twice
//   back-to-a-copy-kept-apart Keep drawing on a saved drawing that another open copy saves meanwhile: Save keeps this
//                             one as its own page, and the Safe Zone, then Back, opens that page, not the other copy's,
//                             also when that Save lands only after they left for the Safe Zone
//   back-to-a-resumed-draft   a draft an earlier tab left, opened again, a line more and Save: back from the Safe Zone
//                             the page holds both strokes, and Save again keeps them both
//   back-to-the-same-chapter  a story opened on Chapter 1, Chapter 2 picked from the chapter list: Read, then Back to
//                             writing, and the Safe Zone, then Back, each land on Chapter 2; the notes left open come
//                             back as the notes, also when the Safe Zone is opened again before storage answers the
//                             way back, with the Page tab still going to Chapter 2
//   back-to-a-chapter-kept-apart  words typed over a chapter another open copy changed, the Safe Zone tapped while they
//                             are still saving: they land as a kept copy, and Back opens that copy with those words
import { drawPage, line } from './art-eraser-glow.e2e.mjs';
import { holdStorage } from './story-reading.e2e.mjs';

const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'same-page-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});
const KEPT_APART = 'A newer copy of this drawing arrived, so this one was kept as its own page.';
const stroke = (x, y) => ({ i: 1, w: 25, p: [x, y, x + 300, y + 80, x + 520, y + 20] });
const routeIs = (page, name) => page.waitForFunction((n) => window.__daily?.route.name === n, name, { timeout: 10000 });
const xp = (h, page) => h.ls(page, h.SAVE).then((s) => JSON.parse(s).events.reduce((n, e) => n + (e.xp ?? 0), 0));
const drawings = (page) => page.evaluate(async () => (await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).exportAll()).records.map((r) => r.strokes.length));
/** The Safe Zone from the top bar, then the browser's Back. */
async function safeAndBack(page, screen) {
  await page.locator('.dq-top .dq-safe').click();
  await routeIs(page, 'safe');
  await page.goBack();
  await routeIs(page, screen);
}
/** The drawing page once it has loaded what it opens on and slid in. */
const drawReady = (page) =>
  page.waitForFunction(() => window.__daily?.ink && !document.querySelector('.dq-ink-stage')?.inert && !document.querySelector('.dq-draw')?.getAnimations().some((a) => a.playState === 'running'), null, { timeout: 10000 });
/** Waits for the drawing page to show `n` strokes. */
const shows = (h, page, n, where) => h.poll(page, () => page.evaluate(() => window.__daily.ink.strokes.length), (k) => k === n, (k) => `${where} the page shows ${k} strokes, not the saved drawing's ${n}`, { timeout: 5000 });
/** Waits for the writer to hold `name` (its field's label). */
const holds = (h, page, name, where) => h.poll(page, () => page.locator('.st-ta').getAttribute('aria-label'), (l) => l === name, (l) => `${where} opened ${l}, not ${name}`, { timeout: 5000 });
/** Keep drawing on a saved drawing, one line more, while another open copy saves three strokes over it. */
async function keepDrawingOverAnother(h, page) {
  await h.reachHub(page);
  await page.evaluate(async (s) => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    await as.put({ id: 'pg-a', kind: 'today', day: window.__daily.store.today(), t: 1, updated: 1, n: 1, strokes: [s] });
  }, stroke(200, 500));
  await page.locator('.dq-tile--art').click();
  await page.locator('[data-piece="pg-a"]').click();
  await page.getByRole('button', { name: 'Keep drawing', exact: true }).click();
  await routeIs(page, 'draw');
  await drawReady(page);
  await shows(h, page, 1, 'Keep drawing:');
  await page.evaluate(async (ss) => {
    const m = await import('/src/daily/artstore.ts');
    const as = m.artStore(window.__daily.store.key);
    const rec = await as.get('pg-a');
    await as.put({ ...rec, n: ss.length, strokes: ss, updated: 2, bases: [m.revOf(rec)], after: rec.updated });
  }, [stroke(200, 500), stroke(200, 900), stroke(200, 1300)]);
  await line(page, [0.2, 0.6], [0.7, 0.7]);
}
/** A story of one chapter, open on its page, which another open copy then changes under it. */
async function chapterChangedElsewhere(h, page) {
  await h.reachHub(page);
  const ids = await page.evaluate(async () => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    const ss = storyStore(window.__daily.store.key);
    const { story, first } = await ss.create('The Long Night');
    await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
    return { story: story.id, ch1: first.id };
  });
  await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch1 });
  await holds(h, page, 'Page, Chapter 1', 'the story');
  await page.evaluate(async (id) => {
    const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
    const c = await ss.chapter(id);
    await ss.saveChapter({ ...c, text: 'The other open copy.' }, [c.rev]);
  }, ids.ch1);
  return ids;
}

export const scenarios = {
  async 'back-to-a-saved-drawing'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-tools-saved').waitFor();
      h.expect(JSON.stringify(await drawings(page)) === '[1]', `after Save the Art room holds ${JSON.stringify(await drawings(page))}`);
      const before = await xp(h, page);

      await safeAndBack(page, 'draw');
      await drawReady(page);
      await shows(h, page, 1, 'back from the Safe Zone');
      await h.shot(page, 'back-to-a-saved-drawing-390');
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-tools-saved').waitFor();
      await h.poll(page, () => drawings(page), (d) => JSON.stringify(d) === '[2]', (d) => `a line more and Save left the Art room with ${JSON.stringify(d)}, not one drawing of 2 strokes`, { timeout: 5000 });

      // to the Art room and Forward again
      await page.locator('.dq-tools').getByRole('button', { name: 'Art room', exact: true }).click();
      await routeIs(page, 'art');
      await page.goForward();
      await routeIs(page, 'draw');
      await drawReady(page);
      await shows(h, page, 2, 'Forward to it');
      h.expect((await xp(h, page)) === before, `coming back credited it again: ${before} XP, then ${await xp(h, page)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'back-to-a-copy-kept-apart'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await keepDrawingOverAnother(h, page);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText(KEPT_APART, { exact: true }).first().waitFor();
      h.expect(JSON.stringify((await drawings(page)).sort()) === '[2,3]', `the Art room holds ${JSON.stringify(await drawings(page))}, not the other copy's drawing and this one apart`);
      await safeAndBack(page, 'draw');
      await drawReady(page);
      await shows(h, page, 2, 'back from the Safe Zone');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }

    // Save still writing as they tap the Safe Zone: it lands as the copy once the page has gone
    const late = await h.open(seed(h));
    try {
      await keepDrawingOverAnother(h, late.page);
      await late.page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const put = as.put;
        as.put = function (...a) {
          as.put = put;
          return new Promise((go) => (window.__letPut = go)).then(() => put.apply(this, a));
        };
      });
      await late.page.getByRole('button', { name: 'Save', exact: true }).click();
      await late.page.waitForFunction(() => !!window.__letPut);
      await late.page.locator('.dq-top .dq-safe').click();
      await routeIs(late.page, 'safe');
      await late.page.evaluate(() => window.__letPut());
      await h.poll(late.page, () => drawings(late.page), (d) => JSON.stringify(d.sort()) === '[2,3]', (d) => `the late Save left the Art room with ${JSON.stringify(d)}`, { timeout: 5000 });
      await late.page.goBack();
      await routeIs(late.page, 'draw');
      await drawReady(late.page);
      await shows(h, late.page, 2, 'back from the Safe Zone after a late Save');
      h.expect(!late.errors.length, late.errors.join('\n'));
    } finally {
      await late.ctx.close();
    }
  },

  async 'back-to-a-resumed-draft'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await page.evaluate(async (s) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        await as.putDraft({ key: 'today:an-earlier-tab', kind: 'today', strokes: [s], t: Date.now() - 3600e3 });
      }, stroke(200, 500));
      await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today', draft: 'today:an-earlier-tab' }));
      await routeIs(page, 'draw');
      await drawReady(page);
      await shows(h, page, 1, 'the draft opened:');
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-tools-saved').waitFor();
      h.expect(JSON.stringify(await drawings(page)) === '[2]', `after Save the Art room holds ${JSON.stringify(await drawings(page))}`);

      await safeAndBack(page, 'draw');
      await drawReady(page);
      await shows(h, page, 2, 'back from the Safe Zone');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-tools-saved').waitFor();
      h.expect(JSON.stringify(await drawings(page)) === '[2]', `Save again left the Art room with ${JSON.stringify(await drawings(page))}, not the drawing's 2 strokes`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'back-to-the-same-chapter'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('The Long Night');
        await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
        const next = await ss.addChapter(story.id);
        await ss.saveChapter({ ...next, text: 'The river ran bright.' }, [next.rev]);
        return { story: story.id, ch1: first.id };
      });
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch1 });
      await page.getByRole('textbox', { name: 'Page, Chapter 1' }).waitFor();
      await page.locator('.st-chbtn').click();
      await page.locator('.st-sheet').waitFor();
      await page.locator('.st-sheet .st-chrow-b').filter({ hasText: 'Chapter 2' }).click();
      await page.getByRole('textbox', { name: 'Page, Chapter 2' }).waitFor();

      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Read', exact: true }).click();
      await routeIs(page, 'read');
      await page.getByRole('button', { name: 'Back to writing' }).click();
      await routeIs(page, 'write');
      await holds(h, page, 'Page, Chapter 2', 'Back to writing');
      h.expect((await page.locator('.st-ta').inputValue()) === 'The river ran bright.', `Chapter 2 reads ${JSON.stringify(await page.locator('.st-ta').inputValue())}`);

      await safeAndBack(page, 'write');
      await holds(h, page, 'Page, Chapter 2', 'back from the Safe Zone');

      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await page.getByRole('textbox', { name: 'Notes for this story' }).waitFor();
      await safeAndBack(page, 'write');
      await holds(h, page, 'Notes for this story', 'back from the Safe Zone on the notes');
      await h.shot(page, 'back-to-the-same-chapter-notes-390');

      // storage slow to answer: back from the Safe Zone, and in it again before the writer could open anything
      const held = await holdStorage(page, ['story']);
      await page.locator('.dq-top .dq-safe').click();
      await routeIs(page, 'safe');
      await page.goBack();
      await routeIs(page, 'write');
      await held.waitHeld(`story ${ids.story}`);
      await page.locator('.dq-top .dq-safe').click();
      await routeIs(page, 'safe');
      await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        ss.story = ss.__real.story;
      });
      await held.drain();
      await page.goBack();
      await routeIs(page, 'write');
      await holds(h, page, 'Notes for this story', 'the next Back from the Safe Zone');
      await page.getByRole('radio', { name: 'Show: Page' }).click();
      await holds(h, page, 'Page, Chapter 2', 'the Page tab after coming back');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'back-to-a-chapter-kept-apart'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const ids = await chapterChangedElsewhere(h, page);
      const held = await holdStorage(page, ['saveChapter']);
      await page.locator('.st-ta').fill('My newest words.');
      await page.locator('.dq-top .dq-safe').click();
      await routeIs(page, 'safe');
      await held.drain();
      await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        ss.saveChapter = ss.__real.saveChapter;
      });
      const texts = () =>
        page.evaluate(async (id) => {
          const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
          const s = await ss.story(id);
          return Promise.all(s.chapters.map(async (c) => (await ss.chapter(c))?.text));
        }, ids.story);
      await h.poll(page, texts, (t) => t.includes('My newest words.') && t.includes('The other open copy.'), (t) => `the chapters saved are ${JSON.stringify(t)}`, { timeout: 8000 });
      await page.goBack();
      await routeIs(page, 'write');
      await h.poll(page, () => page.locator('.st-ta').inputValue(), (v) => v === 'My newest words.', (v) => `back from the Safe Zone the page reads ${JSON.stringify(v)}, not the copy kept with the words typed`, { timeout: 5000 });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
