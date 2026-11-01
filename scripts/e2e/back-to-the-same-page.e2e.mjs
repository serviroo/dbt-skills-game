// Back and Forward to a page the player was working on open it as they left it, also on the way back from the Safe Zone.
//   back-to-a-saved-drawing   a Draw today page saved, then the Safe Zone and Back: the page still shows the saved
//                             drawing, and a line more and Save change that drawing rather than start a second one. The
//                             same after the Art room and Forward. No step credits anything twice
//   back-to-a-copy-kept-apart Keep drawing on a saved drawing that another open copy saves meanwhile: Save keeps this
//                             one as its own page, and the Safe Zone, then Back, opens that page, not the other copy's,
//                             also when that Save lands only after they left for the Safe Zone
//   back-to-a-resumed-draft   a draft an earlier tab left, opened again, a line more and Save: back from the Safe Zone
//                             the page holds both strokes, and Save again keeps them both. Back from a Safe Zone tapped
//                             while the draft was still being read opens that draft, and so does Back to a page whose
//                             read of the draft failed
//   back-to-the-same-chapter  a story opened on Chapter 1, Chapter 2 picked from the chapter list: Read, then Back to
//                             writing, and the Safe Zone, then Back, each land on Chapter 2; the notes left open come
//                             back as the notes, also when the Safe Zone is opened again before storage answers the
//                             way back, with the Page tab still going to Chapter 2
//   back-to-a-chapter-kept-apart  words typed over a chapter another open copy changed, the Safe Zone tapped while they
//                             are still saving: they land as a kept copy, and Back opens that copy with those words
//   writer-never-shows-empty  at 320 px with storage slow to answer, every frame of the writer coming in (the Story
//                             Room list, a search result, the chapter list, Back to writing, the notes back from the Safe
//                             Zone, Forward) shows the story's title and the page it opens on, never "Untitled story",
//                             an empty or hidden page or the other tab first, and nothing on it moves as the page comes
//                             in, a long chapter name included
//   drawing-never-shows-empty the same for a saved drawing: back from the Safe Zone, Forward, and Keep drawing show its
//                             strokes from the first frame, never an empty page first
//   a-missing-chapter-opens   a chapter in a story's list that isn't stored: the writer opens on the first chapter in
//                             its place, and a story whose only chapter is missing opens on an empty page
//   drawing-storage-never-answers  storage that never answers a saved drawing's read: the Safe Zone stays one tap away
//                             while it waits, the page comes in saying drawings aren't being kept, Back works, and a
//                             line more and Save leave the stored drawing as it was
//   writer-storage-never-answers   the same for a chapter's read: the writer comes in on an empty page, and words typed
//                             there never reach the stored chapter
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
/** Every read of the IndexedDB store `name` from now on never answers, as a stalled disk; window.__answer() undoes it. */
const stall = (page, name) =>
  page.evaluate((name) => {
    const get = IDBObjectStore.prototype.get;
    window.__answer = () => (IDBObjectStore.prototype.get = get);
    IDBObjectStore.prototype.get = function (...a) {
      return this.name === name ? {} : get.apply(this, a);
    };
  }, name);
/** `op` ('get' or 'delete') on `id` in the IndexedDB store `store` of the database `db` as it is on the disk, past the
 * app's own copy in memory and its own connection. */
const onDisk = (page, db, store, op, id) =>
  page.evaluate(
    ([db, store, op, id]) =>
      new Promise((done, bad) => {
        const open = indexedDB.open(db);
        open.onerror = () => bad(open.error);
        open.onsuccess = () => {
          const t = open.result.transaction(store, op === 'get' ? 'readonly' : 'readwrite');
          const r = t.objectStore(store)[op](id);
          t.oncomplete = () => (open.result.close(), done(r.result));
          t.onerror = () => bad(t.error);
        };
      }),
    [db, store, op, id],
  );
/** Whether the screen `sel` is in: in reach and not see-through. */
const isIn = (sel) => {
  const el = document.querySelector(sel);
  return !!el && !el.inert && getComputedStyle(el).opacity !== '0';
};
/** Waits for the screen `sel` to come in. */
const comesIn = (h, page, sel, where, timeout = 5000) =>
  page.waitForFunction(isIn, sel, { timeout }).then(
    () => {},
    () => h.expect(false, `${where}: the page never came in`),
  );
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
/** Waits for the writer to hold `name` (its field's label) and show it. */
async function holds(h, page, name, where) {
  await h.poll(page, () => page.locator('.st-ta').getAttribute('aria-label'), (l) => l === name, (l) => `${where} opened ${l}, not ${name}`, { timeout: 5000 });
  await page.locator('.st-ta').waitFor({ timeout: 5000 });
  await comesIn(h, page, '.st-write', where);
}
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
/** Every read of `kinds` from the story or art store answers `ms` later, as on a slow phone. */
const slowStorage = (page, store, kinds, ms) =>
  page.evaluate(
    async ([store, kinds, ms]) => {
      const s = store === 'story' ? (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key) : (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      for (const k of kinds) {
        const real = s[k];
        s[k] = function (...a) {
          return new Promise((go) => setTimeout(go, ms)).then(() => real.apply(this, a));
        };
      }
    },
    [store, kinds, ms],
  );
/** Checks every frame the browser paints from now on: the writer or the drawing page, once any of it shows, shows what `framesShow` asks for. */
async function watchFrames(page) {
  await page.evaluate(() => {
    const f = (window.__frames = { want: null, seen: 0, bad: [] });
    const shows = (el) => {
      if (!el?.isConnected || getComputedStyle(el).visibility === 'hidden') return false;
      for (let n = el; n; n = n.parentElement) if (Number(getComputedStyle(n).opacity) === 0) return false;
      return true;
    };
    const tick = () => {
      const w = f.want;
      const at = window.__daily?.route.name;
      if (w?.screen === 'write' && at === 'write' && shows(document.querySelector('.st-write'))) {
        f.seen++;
        const title = document.querySelector('.st-write .st-title');
        const ta = document.querySelector('.st-write .st-ta');
        const label = document.querySelector('.st-write .st-chbtn-t');
        const side = document.querySelector('.st-write .st-seg [aria-checked="true"]')?.textContent;
        const text = ta.value;
        // where what `still` names (the title, the chapter row, Page and Notes, the page) sits on it, from the first frame it
        // shows
        const write = document.querySelector('.st-write').getBoundingClientRect();
        const box = (sel, ...edges) => {
          const r = document.querySelector(`.st-write ${sel}`).getBoundingClientRect();
          return edges.map((k) => Math.round(r[k] - (k === 'top' ? write.top : k === 'left' ? write.left : 0))).join(',');
        };
        const keys = { '.st-title': ['top', 'height'], '.st-bar': ['top', 'height'], '.st-seg': ['top', 'left'], '.st-frame': ['top'] };
        const layout = w.still.map((s) => box(s, ...keys[s])).join(' ');
        const moved = f.page === document.querySelector('.st-write') && layout !== f.layout;
        f.page = document.querySelector('.st-write');
        f.layout = layout;
        const wrong = [
          title.value !== w.title && `the title "${title.value || title.placeholder}"`,
          shows(title) && !shows(ta) && 'the title over no page',
          shows(ta) && !w.texts.includes(text) && `the page "${text || ta.placeholder}"`,
          !w.sides.includes(side) && `the ${side} tab`,
          shows(label) && !label.textContent && 'no chapter name',
          moved && `${w.still.join(', ')} moving as it came in`,
        ].filter(Boolean);
        if (wrong.length) f.bad.push(wrong.join(', '));
      }
      if (w?.screen === 'draw' && at === 'draw' && shows(document.querySelector('.dq-draw'))) {
        f.seen++;
        const n = window.__daily.ink?.strokes.length;
        if (n !== w.strokes) f.bad.push(`${n} strokes`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
/** Runs `step` with every frame checked against `want`, then fails on any frame that showed something else. */
async function framesShow(h, page, want, where, step) {
  await page.evaluate((w) => Object.assign(window.__frames, { want: w, seen: 0, bad: [], page: null }), want);
  await step();
  await h.frames(page, 3);
  const f = await page.evaluate(() => ({ seen: window.__frames.seen, bad: [...new Set(window.__frames.bad)] }));
  h.expect(f.seen > 0, `${where}: no frame of the page was seen`);
  h.expect(!f.bad.length, `${where}: a frame showed ${f.bad.join('; ')}`);
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

    // the Safe Zone tapped while the draft is still being read: Back opens that draft
    const early = await h.open(seed(h));
    try {
      await h.reachHub(early.page);
      await early.page.evaluate(async (s) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        await as.putDraft({ key: 'today:an-earlier-tab', kind: 'today', strokes: [s], t: Date.now() - 3600e3 });
        const getDraft = as.getDraft;
        as.getDraft = function (...a) {
          as.getDraft = getDraft;
          return new Promise((go) => (window.__letDraft = go)).then(() => getDraft.apply(this, a));
        };
      }, stroke(200, 500));
      await early.page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today', draft: 'today:an-earlier-tab' }));
      await early.page.waitForFunction(() => !!window.__letDraft);
      await early.page.locator('.dq-top .dq-safe').click();
      await routeIs(early.page, 'safe');
      await early.page.evaluate(() => window.__letDraft());
      await early.page.goBack();
      await routeIs(early.page, 'draw');
      await drawReady(early.page);
      await shows(h, early.page, 1, 'back from the Safe Zone tapped while the draft opened');
      h.expect(!early.errors.length, early.errors.join('\n'));
    } finally {
      await early.ctx.close();
    }

    // the read of the draft fails as the page opens, so it opens empty: Back opens that draft
    const failed = await h.open(seed(h));
    try {
      await h.reachHub(failed.page);
      await failed.page.evaluate(async (s) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        await as.putDraft({ key: 'today:an-earlier-tab', kind: 'today', strokes: [s], t: Date.now() - 3600e3 });
      }, stroke(200, 500));
      // only on the disk now, as an earlier tab left it
      await failed.page.reload();
      await h.reachHub(failed.page);
      await failed.page.evaluate(() => {
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...a) {
          if (this.name !== 'drafts') return get.apply(this, a);
          IDBObjectStore.prototype.get = get;
          throw new DOMException('The disk could not be read.', 'NotReadableError');
        };
      });
      await failed.page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today', draft: 'today:an-earlier-tab' }));
      await routeIs(failed.page, 'draw');
      await drawReady(failed.page);
      await shows(h, failed.page, 0, 'the draft whose read failed:');
      await safeAndBack(failed.page, 'draw');
      await drawReady(failed.page);
      await shows(h, failed.page, 1, 'back to the draft whose read failed');
      h.expect(!failed.errors.length, failed.errors.join('\n'));
    } finally {
      await failed.ctx.close();
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

  async 'writer-never-shows-empty'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', { width: 320, height: 568 });
    try {
      await h.reachHub(page);
      const [one, two, notes] = ['The lantern woke.', 'The river ran bright.', 'Mira keeps the map.'];
      // long enough to take three lines of the chapter row at 320 px
      const LONG = 'Where the river ran bright under the old stone bridge';
      await page.evaluate(
        async ([one, two, notes, LONG]) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const ss = storyStore(window.__daily.store.key);
          const { story, first } = await ss.create('The Long Night');
          await ss.saveChapter({ ...first, text: one }, [first.rev]);
          const next = await ss.addChapter(story.id);
          await ss.saveChapter({ ...next, title: LONG, text: two }, [next.rev]);
          const n = await ss.chapter(story.notes);
          await ss.saveChapter({ ...n, text: notes }, [n.rev]);
        },
        [one, two, notes, LONG],
      );
      const ROW = ['.st-title', '.st-bar', '.st-seg'];
      const want = (texts, sides = ['Page'], still = [...ROW, '.st-frame']) => ({ screen: 'write', title: 'The Long Night', texts, sides, still });
      const lantern = async () => {
        await page.locator('.dq-top .dq-back').click();
        await routeIs(page, 'stories');
      };
      await watchFrames(page);
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await routeIs(page, 'stories');
      await slowStorage(page, 'story', ['story', 'chapter', 'cards'], 250);

      await framesShow(h, page, want([one]), 'the Story Room list', async () => {
        await page.locator('.st-row', { hasText: 'The Long Night' }).click();
        await holds(h, page, 'Page, Chapter 1', 'the Story Room list');
      });
      await framesShow(h, page, want([one, two], ['Page'], []), 'the chapter list', async () => {
        await page.locator('.st-chbtn').click();
        await page.locator('.st-sheet .st-chrow-b').filter({ hasText: LONG }).click();
        await holds(h, page, `Page, ${LONG}`, 'the chapter list');
      });
      await framesShow(h, page, want([two]), 'Back to writing', async () => {
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Read', exact: true }).click();
        await routeIs(page, 'read');
        await page.getByRole('button', { name: 'Back to writing' }).click();
        await routeIs(page, 'write');
        await holds(h, page, `Page, ${LONG}`, 'Back to writing');
      });
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await holds(h, page, 'Notes for this story', 'the Notes tab');
      await framesShow(h, page, want([notes], ['Notes']), 'the notes back from the Safe Zone', async () => {
        await safeAndBack(page, 'write');
        await holds(h, page, 'Notes for this story', 'the notes back from the Safe Zone');
      });
      await h.shot(page, 'writer-notes-back-from-the-safe-zone-320');
      await lantern();
      await framesShow(h, page, want([notes], ['Notes']), 'Forward', async () => {
        await page.goForward();
        await routeIs(page, 'write');
        await holds(h, page, 'Notes for this story', 'Forward');
      });
      await lantern();
      // the note that the search is marked comes in above the page once it is open, so only the row above it holds still
      await framesShow(h, page, want([two], ['Page'], ROW), 'a search result', async () => {
        await page.getByRole('searchbox', { name: 'Search your stories and notes' }).fill('river');
        await page.locator('.st-found-row', { hasText: LONG }).click();
        await routeIs(page, 'write');
        await holds(h, page, `Page, ${LONG}`, 'a search result');
      });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'drawing-never-shows-empty'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', { width: 320, height: 568 });
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-tools-saved').waitFor();
      const artRoom = async () => {
        await page.locator('.dq-top .dq-back').click();
        await routeIs(page, 'art');
      };
      const opened = async (where) => {
        await routeIs(page, 'draw');
        await drawReady(page);
        await shows(h, page, 1, where);
      };
      await watchFrames(page);
      await slowStorage(page, 'art', ['get', 'getDraft', 'drafts'], 250);
      const want = { screen: 'draw', strokes: 1 };

      await framesShow(h, page, want, 'back from the Safe Zone', async () => {
        await safeAndBack(page, 'draw');
        await opened('back from the Safe Zone');
      });
      await artRoom();
      await framesShow(h, page, want, 'Forward', async () => {
        await page.goForward();
        await opened('Forward');
      });
      await artRoom();
      await framesShow(h, page, want, 'Keep drawing', async () => {
        await page.locator('[data-piece]').first().click();
        await page.getByRole('button', { name: 'Keep drawing', exact: true }).click();
        await opened('Keep drawing');
      });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-missing-chapter-opens'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('The Long Night');
        await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
        const next = await ss.addChapter(story.id);
        const lone = await ss.create('The Short Night');
        return { db: ss.name, story: story.id, ch2: next.id, lone: lone.story.id, loneCh: lone.first.id };
      });
      await onDisk(page, ids.db, 'chapters', 'delete', ids.ch2);
      await onDisk(page, ids.db, 'chapters', 'delete', ids.loneCh);

      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch2 });
      await routeIs(page, 'write');
      await comesIn(h, page, '.st-write', 'Chapter 2 missing');
      await holds(h, page, 'Page, Chapter 1', 'Chapter 2 missing');
      h.expect((await page.locator('.st-ta').inputValue()) === 'The lantern woke.', `Chapter 2 missing, the page reads ${JSON.stringify(await page.locator('.st-ta').inputValue())}`);

      await page.locator('.dq-top .dq-back').click();
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.lone });
      await page.waitForFunction((id) => window.__daily?.route.name === 'write' && window.__daily.route.id === id, ids.lone);
      await comesIn(h, page, '.st-write', 'its only chapter missing');
      h.expect(await page.locator('.st-ta').isVisible(), 'its only chapter missing, the writer came in with no page');
      h.expect((await page.locator('.st-ta').inputValue()) === '', `its only chapter missing, the page reads ${JSON.stringify(await page.locator('.st-ta').inputValue())}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'drawing-storage-never-answers'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-tools-saved').waitFor();
      const { db, id } = await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return { db: as.name, id: (await as.list())[0].id };
      });
      await page.locator('.dq-top .dq-back').click();
      await routeIs(page, 'art');

      await stall(page, 'strokes');
      await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
      await routeIs(page, 'draw');
      await h.sleep(500);
      h.expect(!(await page.evaluate(isIn, '.dq-draw')), 'the page came in before storage answered');
      // the Safe Zone while it waits, then Back
      await safeAndBack(page, 'draw');
      await comesIn(h, page, '.dq-draw', 'storage that never answers', 15000);
      const note = await page.locator('.dq-tools-msg').textContent();
      h.expect(note.includes('keeping drawings right now'), `storage that never answers, the page says ${JSON.stringify(note)}`);
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await h.sleep(500);
      await page.evaluate(() => window.__answer());
      const stored = await onDisk(page, db, 'strokes', 'get', id);
      h.expect(stored?.length === 1, `a line more and Save left the stored drawing with ${JSON.stringify(stored?.length)} strokes, not its 1`);
      await page.locator('.dq-top .dq-back').click();
      await routeIs(page, 'art');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'writer-storage-never-answers'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('The Long Night');
        await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
        return { db: ss.name, story: story.id, ch1: first.id };
      });

      await stall(page, 'chapters');
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story });
      await routeIs(page, 'write');
      await h.sleep(500);
      h.expect(!(await page.evaluate(isIn, '.st-write')), 'the writer came in before storage answered');
      // the Safe Zone while it waits, then Back
      await safeAndBack(page, 'write');
      await comesIn(h, page, '.st-write', 'storage that never answers', 15000);
      h.expect(await page.locator('.st-ta').isVisible(), 'storage that never answers: the writer came in with no page');
      await page.locator('.st-ta').fill('Words typed over nothing.');
      await h.sleep(1500);
      await page.evaluate(() => window.__answer());
      const stored = await onDisk(page, ids.db, 'chapters', 'get', ids.ch1);
      h.expect(stored?.text === 'The lantern woke.', `words typed while storage never answered reached the stored chapter: ${JSON.stringify(stored?.text)}`);
      await page.locator('.dq-top .dq-back').click();
      await page.waitForFunction(() => window.__daily?.route.name !== 'write');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
