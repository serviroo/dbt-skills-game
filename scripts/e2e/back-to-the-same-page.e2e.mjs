// Back and Forward to a page the player was working on open it as they left it, also on the way back from the Safe Zone.
//   back-to-a-saved-drawing   a Draw today page saved, then the Safe Zone and Back: the page still shows the saved
//                             drawing, and a line more and Save change that drawing rather than start a second one. The
//                             same after the Art room and Forward. No step credits anything twice
//   back-to-a-copy-kept-apart Keep drawing on a saved drawing that another open copy saves meanwhile: Save keeps this
//                             one as its own page, and the Safe Zone, then Back, opens that page, not the other copy's,
//                             also when that Save lands only after they left for the Safe Zone
//   back-to-a-resumed-draft   a draft an earlier tab left, opened again, a line more and Save: back from the Safe Zone
//                             the page holds both strokes, and Save again keeps them both. Back from a Safe Zone tapped
//                             while the draft was still being read opens that draft, and so does Back to a page that
//                             couldn't open because the read of the draft failed
//   back-to-the-same-chapter  a story opened on Chapter 1, Chapter 2 picked from the chapter list: Read, then Back to
//                             writing, and the Safe Zone, then Back, each land on Chapter 2; the notes left open come
//                             back as the notes, also when the Safe Zone is opened again before storage answers the
//                             way back, with the Page tab still going to Chapter 2
//   back-to-a-chapter-kept-apart  words typed over a chapter another open copy changed, the Safe Zone tapped while they
//                             are still saving: they land as a kept copy, and Back opens that copy with those words
//   back-to-notes-kept-apart  the same for the notes: words typed over notes another open copy changed land as a page of
//                             their own, and Back from the Safe Zone opens that page with them
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
//                             while it waits, the page comes in saying it can't open the drawing, with nothing to draw
//                             on and nothing written, and Try again opens the drawing once storage answers
//   writer-storage-never-answers   the same for a chapter's read: the writer comes in saying it can't open the story,
//                             with no page, no new chapter and nothing written, and Try again opens the chapter once
//                             storage answers. The same when the first page of a story with none is never answered as
//                             it is made
//   reader-storage-never-answers   the same for a story opened to read, and piece-storage-never-answers for a saved
//                             drawing opened in the Art room: they say they can't open it, never that it is gone (also
//                             when another open copy saves meanwhile), and Try again opens it once storage answers
//   a-late-open-changes-nothing  Try again while the drawings' database won't even open: it can't open again, and once
//                             a later Try again opens it, the open given up on failing late leaves storage working
//   a-dropped-connection-gives-up  the drawings' connection drops as a saved drawing opens and the one opened in its
//                             place never answers, or never even opens: that one is given up (later reads answer at
//                             once), and one Try again opens the drawing once storage answers
//   a-cut-off-write-holds-nothing  a draft's write loses its connection after it started, and the open in its place never
//                             answers: once that open is given up the write is over, so Clear game's check isn't held
//   storage-answers-too-late  a story's first page made while another connection holds its chapters: given up after a
//                             while, the writer can't open it, and the write never lands later, when the hold lets go
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
/** Every read of the IndexedDB store `name` from now on (in a `mode` transaction only, when given) never answers, as a
 * stalled disk; window.__answer() undoes it. */
const stall = (page, name, mode) =>
  page.evaluate(
    ([name, mode]) => {
      const get = IDBObjectStore.prototype.get;
      window.__answer = () => (IDBObjectStore.prototype.get = get);
      IDBObjectStore.prototype.get = function (...a) {
        return this.name === name && (!mode || this.transaction.mode === mode) ? {} : get.apply(this, a);
      };
    },
    [name, mode],
  );
/** `op` ('get', 'count' or 'delete') on `id` in the IndexedDB store `store` of the database `db` as it is on the disk, past the
 * app's own copy in memory and its own connection. */
const onDisk = (page, db, store, op, id) =>
  page.evaluate(
    ([db, store, op, id]) =>
      new Promise((done, bad) => {
        const open = indexedDB.open(db);
        open.onerror = () => bad(open.error);
        open.onsuccess = () => {
          const t = open.result.transaction(store, op === 'delete' ? 'readwrite' : 'readonly');
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
/** The screen `sel` came in shut, saying it can't open `what` right now, with nothing on it to write or draw on. */
async function cantOpenShows(h, page, sel, what, where) {
  const title = await page.locator(`${sel} .dq-cant-t`).textContent({ timeout: 3000 }).catch(() => null);
  h.expect(title === `Can’t open this ${what} right now`, `${where}: the page says ${JSON.stringify(title)}, not that it can't open the ${what}`);
  h.expect(!(await page.locator(`${sel} textarea, ${sel} canvas`).count()), `${where}: it came in with something to write or draw on`);
}
/** The screen as it is at 390 px wide, then at 320. */
async function shots(h, page, name) {
  await h.shot(page, `${name}-390`);
  const was = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  await h.frames(page, 3);
  await h.shot(page, `${name}-320`);
  await page.setViewportSize(was);
  await h.frames(page, 3);
}
/** Try again on a screen that couldn't open. */
const tryAgain = (page) => page.locator('.dq-cant').getByRole('button', { name: 'Try again', exact: true }).click();
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
      await comesIn(h, failed.page, '.dq-draw', 'the draft whose read failed');
      await cantOpenShows(h, failed.page, '.dq-draw', 'drawing', 'the draft whose read failed');
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

  async 'back-to-notes-kept-apart'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story } = await ss.create('The Long Night');
        const n = await ss.chapter(story.notes);
        await ss.saveChapter({ ...n, text: 'Mira keeps the map.' }, [n.rev]);
        return { story: story.id, notes: story.notes };
      });
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.notes });
      await holds(h, page, 'Notes for this story', 'the notes');
      await page.evaluate(async (id) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const c = await ss.chapter(id);
        await ss.saveChapter({ ...c, text: 'The other open copy.' }, [c.rev]);
      }, ids.notes);
      const held = await holdStorage(page, ['saveChapter']);
      await page.locator('.st-ta').fill('My newest notes.');
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
          return Promise.all([s.notes, ...s.chapters].map(async (c) => (await ss.chapter(c))?.text));
        }, ids.story);
      await h.poll(page, texts, (t) => t.includes('My newest notes.') && t[0] === 'The other open copy.', (t) => `the notes and chapters saved are ${JSON.stringify(t)}`, { timeout: 8000 });
      await page.goBack();
      await routeIs(page, 'write');
      await comesIn(h, page, '.st-write', 'back to notes kept apart');
      await h.poll(page, () => page.locator('.st-ta').inputValue(), (v) => v === 'My newest notes.', (v) => `back from the Safe Zone the page reads ${JSON.stringify(v)}, not the copy kept with the notes typed`, { timeout: 5000 });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'reader-storage-never-answers'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('The Long Night');
        await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
        return story.id;
      });
      await stall(page, 'stories', 'readonly');
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), id);
      await routeIs(page, 'read');
      await page.locator('.st-reader .dq-cant-t').waitFor({ timeout: 15000 }).catch(() => {});
      await cantOpenShows(h, page, '.st-reader', 'story', 'reading while storage never answers');
      h.expect(!(await page.getByText('isn’t on this device any more').count()), 'reading while storage never answers: it says the story is gone');
      await shots(h, page, 'cant-open-reading');
      await page.evaluate(() => window.__answer());
      await tryAgain(page);
      await page.locator('.st-read-text', { hasText: 'The lantern woke.' }).waitFor({ timeout: 5000 }).catch(() => {});
      h.expect(await page.locator('.st-read-text', { hasText: 'The lantern woke.' }).isVisible(), 'Try again once storage answered did not open the story to read');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'piece-storage-never-answers'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-tools-saved').waitFor();
      const id = await page.evaluate(async () => (await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).list())[0].id);
      // a later visit: the drawing is only on the disk
      await page.reload();
      await h.reachHub(page);
      await stall(page, 'strokes');
      await page.evaluate((id) => window.__daily.go({ name: 'piece', id }), id);
      await routeIs(page, 'piece');
      await page.locator('.dq-piece .dq-cant-t').waitFor({ timeout: 15000 }).catch(() => {});
      await cantOpenShows(h, page, '.dq-piece', 'drawing', 'a saved drawing while storage never answers');
      h.expect(!(await page.getByText('That page is no longer here.').count()), 'a saved drawing while storage never answers: it says the page is gone');
      await shots(h, page, 'cant-open-piece');
      // another open copy saves a drawing meanwhile: the page still says it can't open this one, never that it's gone,
      // and Try again keeps the focus it had
      await page.locator('.dq-cant').getByRole('button', { name: 'Try again', exact: true }).focus();
      const other = await ctx.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => !!window.__daily?.store);
      await other.evaluate(async (s) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        await as.put({ id: 'from-another-copy', kind: 'today', day: window.__daily.store.today(), t: 2, updated: 2, n: 1, strokes: [s] });
      }, stroke(200, 900));
      await other.close();
      await h.sleep(1000);
      await cantOpenShows(h, page, '.dq-piece', 'drawing', 'a saved drawing while storage never answers, after another copy saved');
      h.expect(!(await page.getByText('That page is no longer here.').count()), 'a saved drawing while storage never answers: after another copy saved, it says the page is gone');
      h.expect(await page.evaluate(() => document.activeElement?.textContent === 'Try again'), 'a saved drawing while storage never answers: after another copy saved, Try again lost its focus');
      await page.evaluate(() => window.__answer());
      await tryAgain(page);
      await page.getByRole('button', { name: 'Keep drawing', exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
      h.expect(await page.getByRole('button', { name: 'Keep drawing', exact: true }).isVisible(), 'Try again once storage answered did not open the saved drawing');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-late-open-changes-nothing'(h) {
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
      await comesIn(h, page, '.dq-draw', 'storage that never answers', 15000);
      await page.evaluate(() => window.__answer());
      // the next open of the drawings never answers, until the test fails it
      await page.evaluate((db) => {
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...a) {
          if (a[0] !== db) return open.apply(this, a);
          IDBFactory.prototype.open = open;
          const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: undefined, error: new DOMException('The disk could not be read.', 'NotReadableError') };
          window.__failOpen = () => req.onerror?.(new Event('error'));
          return req;
        };
      }, db);
      await tryAgain(page);
      await page.waitForFunction(() => !!window.__failOpen);
      await comesIn(h, page, '.dq-draw', 'Try again while the database never opens', 15000);
      await cantOpenShows(h, page, '.dq-draw', 'drawing', 'Try again while the database never opens');
      await tryAgain(page);
      await drawReady(page);
      await shows(h, page, 1, 'Try again once the database opens:');
      // the open given up on fails now: storage still works
      await page.evaluate(() => window.__failOpen());
      const after = await page.evaluate(async (id) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const misses = as.misses;
        const rec = await as.get(id);
        return { persistent: as.persistent, read: rec?.strokes.length, missed: as.misses !== misses };
      }, id);
      h.expect(after.persistent && after.read === 1 && !after.missed, `the open given up on, failing late, left storage as ${JSON.stringify(after)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-dropped-connection-gives-up'(h) {
    for (const opens of [true, false]) {
      const at = opens ? 'a dropped connection' : 'a dropped connection whose new open never answers';
      const { ctx, page, errors } = await h.open(seed(h));
      try {
        await drawPage(h, page);
        await line(page, [0.2, 0.3], [0.7, 0.4]);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.locator('.dq-tools-saved').waitFor();
        const id = await page.evaluate(async () => (await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).list())[0].id);
        // a later visit: the drawing is only on the disk
        await page.reload();
        await h.reachHub(page);
        // the next read of the strokes finds the connection dropped; then the one opened in its place never answers its
        // reads, or never even opens
        await page.evaluate(() => {
          const transaction = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (stores, ...rest) {
            if (![].concat(stores).includes('strokes')) return transaction.call(this, stores, ...rest);
            IDBDatabase.prototype.transaction = transaction;
            throw new DOMException('The connection was lost.', 'InvalidStateError');
          };
        });
        if (opens) await stall(page, 'strokes');
        else
          await page.evaluate(async () => {
            const db = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).name;
            const open = IDBFactory.prototype.open;
            window.__answer = () => {};
            IDBFactory.prototype.open = function (...a) {
              if (a[0] !== db) return open.apply(this, a);
              IDBFactory.prototype.open = open;
              return { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: undefined, error: null };
            };
          });
        await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
        await routeIs(page, 'draw');
        await comesIn(h, page, '.dq-draw', at, 15000);
        await cantOpenShows(h, page, '.dq-draw', 'drawing', at);
        const took = await page.evaluate(async (id) => {
          const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
          const t = performance.now();
          await as.get(id);
          return performance.now() - t;
        }, id);
        h.expect(took < 2000, `${at}: what it waited on was never given up: a read waited ${Math.round(took)} ms`);
        await page.evaluate(() => window.__answer());
        await tryAgain(page);
        await drawReady(page);
        await shows(h, page, 1, `Try again after ${at}:`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  async 'a-cut-off-write-holds-nothing'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await drawPage(h, page);
      // the next draft written loses its connection once its transaction has started, and the open in its place never
      // answers
      await page.evaluate(async () => {
        const db = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).name;
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...a) {
          if (this.name !== 'drafts') return put.apply(this, a);
          IDBObjectStore.prototype.put = put;
          throw new DOMException('The connection was lost.', 'UnknownError');
        };
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...a) {
          if (a[0] !== db) return open.apply(this, a);
          IDBFactory.prototype.open = open;
          return { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: undefined, error: null };
        };
      });
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      // past the wait for storage, the check Clear game makes first gets through
      await h.sleep(12000);
      const check = await page.evaluate(async () => {
        const c = await import('/src/core/cleared.ts');
        return Promise.race([c.holdAll().then((held) => (held.release(), 'through')), new Promise((done) => setTimeout(() => done('held'), 5000))]);
      });
      h.expect(check === 'through', 'a write cut off from storage held the check Clear game makes first');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'storage-answers-too-late'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('No Pages Yet');
        await ss.removeChapter(story.id, first.id);
        return { db: ss.name, story: story.id };
      });
      // another connection keeps a write on the chapters going until window.__letGo()
      await page.evaluate(
        (db) =>
          new Promise((held) => {
            const open = indexedDB.open(db);
            open.onsuccess = () => {
              const store = open.result.transaction('chapters', 'readwrite').objectStore('chapters');
              let on = true;
              window.__letGo = () => (on = false);
              const spin = () => {
                if (on) store.get('held').onsuccess = spin;
                else open.result.close();
              };
              spin();
              held();
            };
          }),
        ids.db,
      );
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story });
      await routeIs(page, 'write');
      await comesIn(h, page, '.st-write', 'a first page held by another connection', 15000);
      await cantOpenShows(h, page, '.st-write', 'story', 'a first page held by another connection');
      await page.evaluate(() => window.__letGo());
      await h.sleep(1000);
      const stored = await onDisk(page, ids.db, 'stories', 'get', ids.story);
      h.expect(stored?.chapters.length === 0, `the first page given up on landed later: the stored story lists ${JSON.stringify(stored?.chapters)}`);
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
      // a new page, so the words typed there are kept
      await page.locator('.st-ta').fill('A new beginning.');
      await safeAndBack(page, 'write');
      await comesIn(h, page, '.st-write', 'back to the page made for a missing chapter');
      h.expect((await page.locator('.st-ta').inputValue()) === 'A new beginning.', `back from the Safe Zone the page made for a missing chapter reads ${JSON.stringify(await page.locator('.st-ta').inputValue())}`);
      const kept = await page.evaluate(async (id) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const s = await ss.story(id);
        return Promise.all(s.chapters.map(async (c) => (await ss.onDisk(c))?.text));
      }, ids.lone);
      h.expect(kept.includes('A new beginning.'), `the words typed on the page made for a missing chapter were stored as ${JSON.stringify(kept)}`);
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
      await cantOpenShows(h, page, '.dq-draw', 'drawing', 'storage that never answers');
      await shots(h, page, 'cant-open-drawing');
      await page.evaluate(() => window.__answer());
      const stored = await onDisk(page, db, 'strokes', 'get', id);
      const drafts = await onDisk(page, db, 'drafts', 'count');
      h.expect(stored?.length === 1 && drafts === 0, `while it couldn't open, the stored drawing came to ${JSON.stringify(stored?.length)} strokes and ${drafts} drafts were kept`);
      // storage answers again: Try again opens the drawing
      await tryAgain(page);
      await drawReady(page);
      await comesIn(h, page, '.dq-draw', 'Try again');
      await shows(h, page, 1, 'Try again once storage answered:');
      const note = await page.locator('.dq-tools-msg').textContent();
      h.expect(!note.includes('keeping drawings'), `Try again once storage answered, the page says ${JSON.stringify(note)}`);
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
      await cantOpenShows(h, page, '.st-write', 'story', 'storage that never answers');
      await shots(h, page, 'cant-open-story');
      await page.evaluate(() => window.__answer());
      const story = await onDisk(page, ids.db, 'stories', 'get', ids.story);
      const stored = await onDisk(page, ids.db, 'chapters', 'get', ids.ch1);
      h.expect(story?.chapters.length === 1 && stored?.text === 'The lantern woke.', `while it couldn't open, the story came to ${JSON.stringify(story?.chapters)} and its chapter to ${JSON.stringify(stored?.text)}`);
      // storage answers again: Try again opens the chapter
      await tryAgain(page);
      await holds(h, page, 'Page, Chapter 1', 'Try again once storage answered');
      h.expect((await page.locator('.st-ta').inputValue()) === 'The lantern woke.', `Try again once storage answered, the page reads ${JSON.stringify(await page.locator('.st-ta').inputValue())}`);
      await page.locator('.dq-top .dq-back').click();
      await page.waitForFunction(() => window.__daily?.route.name !== 'write');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }

    // a story with no pages makes its first one on opening, and storage never answers that write
    const first = await h.open(seed(h));
    try {
      await h.reachHub(first.page);
      const { db, id } = await first.page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('No Pages Yet');
        await ss.removeChapter(story.id, first.id);
        return { db: ss.name, id: story.id };
      });
      await stall(first.page, 'stories', 'readwrite');
      await first.page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
      await routeIs(first.page, 'write');
      await comesIn(h, first.page, '.st-write', 'a first page never answered', 15000);
      await cantOpenShows(h, first.page, '.st-write', 'story', 'a first page never answered');
      await first.page.evaluate(() => window.__answer());
      const before = await onDisk(first.page, db, 'stories', 'get', id);
      h.expect(before?.chapters.length === 0, `while it couldn't open, the story came to ${JSON.stringify(before?.chapters)}`);
      // storage answers again: Try again opens its first page, and what is typed there is stored
      await tryAgain(first.page);
      await holds(h, first.page, 'Page, Chapter 1', 'Try again on a first page');
      await first.page.locator('.st-ta').fill('The first line.');
      const kept = () =>
        first.page.evaluate(async (id) => {
          const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
          const s = await ss.story(id);
          return Promise.all(s.chapters.map(async (c) => (await ss.onDisk(c))?.text));
        }, id);
      await h.poll(first.page, kept, (t) => t.length === 1 && t[0] === 'The first line.', (t) => `after Try again the story's pages are stored as ${JSON.stringify(t)}`, { timeout: 5000 });
      h.expect(!first.errors.length, first.errors.join('\n'));
    } finally {
      await first.ctx.close();
    }
  },
};
