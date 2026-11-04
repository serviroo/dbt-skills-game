import { drawPage, line } from './art-eraser-glow.e2e.mjs';
import { holdStorage, seed } from './story-reading.e2e.mjs';

const stroke = (x, y) => ({ i: 1, w: 25, p: [x, y, x + 300, y + 80, x + 520, y + 20] });
export const routeIs = (page, name) =>
  page.waitForFunction((n) => window.__daily?.route.name === n, name, { timeout: 10000 });
const xp = (h, page) => h.ls(page, h.SAVE).then((s) => JSON.parse(s).events.reduce((n, e) => n + (e.xp ?? 0), 0));
const drawings = (page) =>
  page.evaluate(async () => {
    const { artStore } = await import('/src/daily/artstore.ts');
    const { records } = await artStore(window.__daily.store.key).exportAll();
    return records.map((r) => r.strokes.length).sort();
  });

export const onDisk = (page, db, store, op, id) =>
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
const artDb = (page) => page.evaluate(() => `${window.__daily.store.key}.art`);
const diskDrafts = async (page) =>
  (await onDisk(page, await artDb(page), 'drafts', 'getAll')).map((d) => d.strokes.length);

export async function safeZone(page) {
  await page.locator('.dq-top .dq-safe').click();
  await routeIs(page, 'safe');
}
export async function backTo(page, screen) {
  await page.goBack();
  await routeIs(page, screen);
}
async function save(page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.dq-tools-saved').waitFor();
}
export async function strokesAre(h, page, n, where) {
  const settled = () => {
    const sliding = document.querySelector('.dq-draw')?.getAnimations().some((a) => a.playState === 'running');
    return window.__daily?.ink && !document.querySelector('.dq-ink-stage')?.inert && !sliding;
  };
  await page.waitForFunction(settled, null, { timeout: 10000 });
  const count = () => page.evaluate(() => window.__daily.ink.strokes.length);
  const say = (k) => `${where}: the page shows ${k} strokes, not ${n}`;
  await h.poll(page, count, (k) => k === n, say, { timeout: 5000 });
}
async function drawingsAre(h, page, want, where) {
  const same = (d) => JSON.stringify(d) === JSON.stringify(want);
  const say = (d) => `${where}: the Art room holds drawings of ${JSON.stringify(d)} strokes`;
  await h.poll(page, () => drawings(page), same, say, { timeout: 5000 });
}
export async function editorIs(h, page, label, where, text) {
  const shown = () => page.locator('.st-ta').evaluate((t) => ({ label: t.getAttribute('aria-label'), text: t.value }));
  const ok = (s) => s.label === label && (text === undefined || s.text === text);
  await h.poll(page, shown, ok, (s) => `${where} opened ${JSON.stringify(s)}, not ${label}`, { timeout: 5000 });
}
export const newStory = (page, chapters, notes) =>
  page.evaluate(
    async ([chapters, notes]) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const { story, first } = await ss.create('The Long Night');
      const ids = [];
      for (const [i, text] of chapters.entries()) {
        const c = i ? await ss.addChapter(story.id) : first;
        await ss.saveChapter({ ...c, text }, [c.rev]);
        ids.push(c.id);
      }
      const n = await ss.chapter(story.notes);
      await ss.saveChapter({ ...n, text: notes }, [n.rev]);
      return { story: story.id, notes: story.notes, chapters: ids };
    },
    [chapters, notes],
  );

export const scenarios = {
  async 'back-to-a-saved-drawing'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await save(page);
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await routeIs(page, 'stories');
      const before = await xp(h, page);
      await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today' }));
      await strokesAre(h, page, 0, 'a new page');
      await line(page, [0.3, 0.2], [0.6, 0.8]);
      await line(page, [0.4, 0.2], [0.8, 0.6]);
      await backTo(page, 'stories');
      await backTo(page, 'draw');
      await strokesAre(h, page, 1, 'Back past a new page to the saved one');
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await save(page);
      await drawingsAre(h, page, [2], 'a line more and Save');
      await page.locator('.dq-tools').getByRole('button', { name: 'Art room', exact: true }).click();
      await routeIs(page, 'art');
      await page.goForward();
      await routeIs(page, 'draw');
      await strokesAre(h, page, 2, 'Forward');
      await safeZone(page);
      await backTo(page, 'draw');
      await strokesAre(h, page, 2, 'back from the Safe Zone');
      const after = await xp(h, page);
      h.expect(after === before, `coming back credited it again: ${before} XP, then ${after}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'back-past-a-new-page-after-a-failed-save'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      const drafts = () => diskDrafts(page);
      await h.poll(page, drafts, (d) => d.includes(1), (d) => `no draft on disk: ${d}`, { timeout: 5000 });
      await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...a) {
          if (this.name !== 'meta') return put.apply(this, a);
          IDBObjectStore.prototype.put = put;
          throw new DOMException('The disk is full.', 'QuotaExceededError');
        };
      });
      const saveB = page.getByRole('button', { name: 'Save', exact: true });
      await saveB.click();
      await page.waitForFunction(() => !!document.querySelector('.dq-tools-msg')?.textContent);
      await safeZone(page);
      await backTo(page, 'draw');
      await strokesAre(h, page, 1, 'back to a drawing whose save failed');
      await saveB.click();
      const stored = async () => onDisk(page, await artDb(page), 'meta', 'count');
      const say = (n) => `Save after a failed one stored ${n} drawings`;
      await h.poll(page, stored, (n) => n === 1, say, { timeout: 5000 });
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await routeIs(page, 'stories');
      await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today' }));
      await strokesAre(h, page, 0, 'a new page');
      await line(page, [0.3, 0.2], [0.6, 0.8]);
      await line(page, [0.4, 0.2], [0.8, 0.6]);
      await backTo(page, 'stories');
      await backTo(page, 'draw');
      await strokesAre(h, page, 1, 'Back past a new page to a drawing saved after a failed save');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-stroke-drawn-while-saving-is-kept'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      const drafts = () => diskDrafts(page);
      await h.poll(page, drafts, (d) => d.includes(1), (d) => `no draft on disk: ${d}`, { timeout: 5000 });
      await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const put = as.put;
        as.put = function (...a) {
          as.put = put;
          return new Promise((go) => (window.__letPut = go)).then(() => put.apply(this, a));
        };
      });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => !!window.__letPut);
      await line(page, [0.3, 0.6], [0.8, 0.7]);
      await h.poll(page, drafts, (d) => d.includes(2), (d) => `the new stroke never reached disk: ${d}`);
      await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        window.__answer = () => (IDBObjectStore.prototype.put = put);
        IDBObjectStore.prototype.put = function (...a) {
          if (this.name === 'drafts') throw new DOMException('The disk is full.', 'QuotaExceededError');
          return put.apply(this, a);
        };
        window.__letPut();
      });
      await page.waitForFunction(() => !!document.querySelector('.dq-tools-msg')?.textContent);
      await h.frames(page, 10);
      await page.evaluate(() => window.__answer());
      await page.reload();
      await h.reachHub(page);
      const left = await diskDrafts(page);
      h.expect(left.includes(2), `a stroke drawn while saving was lost: drafts of ${left} strokes are left`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-newer-draft-outlives-a-move'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const left = await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const s = (y) => ({ i: 1, w: 25, p: [200, y, 500, y + 80, 720, y + 20] });
        const strokes = (n) => [...Array(n)].map((_, i) => s(300 + i * 200));
        const draft = (key, n) => ({ key, kind: 'today', strokes: strokes(n), t: Date.now() });
        await as.putDraft(draft('today:a-tab', 1));
        const tx = as.tx;
        let go;
        const gate = new Promise((done) => (go = done));
        let calls = 0;
        as.tx = function (...a) {
          calls++;
          if (calls === 1) return gate.then(() => tx.apply(this, a));
          as.tx = tx;
          return Promise.resolve(a[3]());
        };
        const move = as.putDraft(draft('edit:a-drawing:a-tab', 2), 'today:a-tab');
        await as.putDraft(draft('today:a-tab', 3));
        go();
        await move;
        return (await as.getDraft('today:a-tab'))?.strokes.length ?? 0;
      });
      h.expect(left === 3, `a newer draft written during a move came back with ${left} strokes, not 3`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-failed-save-keeps-its-draft'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      const drafts = () => diskDrafts(page);
      const unsaved = (d) => `the draft never reached the disk: ${d}`;
      await h.poll(page, drafts, (d) => d.includes(1), unsaved, { timeout: 5000 });
      await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        window.__answer = () => (IDBObjectStore.prototype.put = put);
        IDBObjectStore.prototype.put = function (...a) {
          if (this.name !== 'meta' && this.name !== 'drafts') return put.apply(this, a);
          throw new DOMException('The disk is full.', 'QuotaExceededError');
        };
      });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => !!document.querySelector('.dq-tools-msg')?.textContent);
      await h.frames(page, 10);
      await page.evaluate(() => window.__answer());
      await page.reload();
      await h.reachHub(page);
      const left = await drafts();
      h.expect(left.includes(1), `a failed save whose draft write failed too left drafts of ${left} strokes`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'back-to-a-copy-kept-apart'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await page.evaluate(async (s) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const day = window.__daily.store.today();
        await as.put({ id: 'pg-a', kind: 'today', day, t: 1, updated: 1, n: 1, strokes: [s] });
      }, stroke(200, 500));
      await page.locator('.dq-tile--art').click();
      await page.locator('[data-piece="pg-a"]').click();
      await page.getByRole('button', { name: 'Keep drawing', exact: true }).click();
      await routeIs(page, 'draw');
      await strokesAre(h, page, 1, 'Keep drawing');
      await page.evaluate(async (ss) => {
        const m = await import('/src/daily/artstore.ts');
        const as = m.artStore(window.__daily.store.key);
        const rec = await as.get('pg-a');
        await as.put({ ...rec, n: ss.length, strokes: ss, updated: 2, bases: [m.revOf(rec)], after: rec.updated });
        const put = as.put;
        as.put = function (...a) {
          as.put = put;
          return new Promise((go) => (window.__letPut = go)).then(() => put.apply(this, a));
        };
      }, [stroke(200, 500), stroke(200, 900), stroke(200, 1300)]);
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => !!window.__letPut);
      await safeZone(page);
      await page.evaluate(() => window.__letPut());
      await drawingsAre(h, page, [2, 3], 'a Save landing after they left');
      await backTo(page, 'draw');
      await strokesAre(h, page, 2, 'back from the Safe Zone to the copy kept apart');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
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
      await strokesAre(h, page, 1, 'the draft');
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await save(page);
      await safeZone(page);
      await backTo(page, 'draw');
      await strokesAre(h, page, 2, 'a resumed draft saved, then Back');
      await save(page);
      await drawingsAre(h, page, [2], 'a resumed draft saved, then Back and Save again');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'back-to-the-same-chapter'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await newStory(page, ['The lantern woke.', 'The river ran bright.'], 'Mira keeps the map.');
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.chapters[0] });
      await editorIs(h, page, 'Page, Chapter 1', 'the story');
      await page.locator('.st-chbtn').click();
      await page.locator('.st-sheet .st-chrow-b').filter({ hasText: 'Chapter 2' }).click();
      await editorIs(h, page, 'Page, Chapter 2', 'the chapter list');

      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Read', exact: true }).click();
      await routeIs(page, 'read');
      await page.getByRole('button', { name: 'Back to writing' }).click();
      await routeIs(page, 'write');
      await editorIs(h, page, 'Page, Chapter 2', 'Back to writing', 'The river ran bright.');
      await safeZone(page);
      await backTo(page, 'write');
      await editorIs(h, page, 'Page, Chapter 2', 'back from the Safe Zone', 'The river ran bright.');

      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await editorIs(h, page, 'Notes for this story', 'the Notes tab');
      await safeZone(page);
      await backTo(page, 'write');
      await editorIs(h, page, 'Notes for this story', 'back from the Safe Zone on the notes', 'Mira keeps the map.');

      const held = await holdStorage(page, ['story']);
      await safeZone(page);
      await backTo(page, 'write');
      await held.waitHeld(`story ${ids.story}`);
      await safeZone(page);
      await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        ss.story = ss.__real.story;
      });
      await held.drain();
      await backTo(page, 'write');
      await editorIs(h, page, 'Notes for this story', 'Back after leaving before the story was read');
      await page.getByRole('radio', { name: 'Show: Page' }).click();
      await editorIs(h, page, 'Page, Chapter 2', 'the Page tab after coming back');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'back-to-words-kept-apart'(h) {
    for (const notes of [false, true]) {
      const at = notes ? 'notes' : 'a chapter';
      const { ctx, page, errors } = await h.open(seed(h));
      try {
        await h.reachHub(page);
        const ids = await newStory(page, ['The lantern woke.'], 'Mira keeps the map.');
        const id = notes ? ids.notes : ids.chapters[0];
        await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: id });
        await editorIs(h, page, notes ? 'Notes for this story' : 'Page, Chapter 1', at);
        await page.evaluate(async (id) => {
          const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
          const c = await ss.chapter(id);
          await ss.saveChapter({ ...c, text: 'The other open copy.' }, [c.rev]);
        }, id);
        const held = await holdStorage(page, ['saveChapter']);
        await page.locator('.st-ta').fill('My newest words.');
        await safeZone(page);
        await held.drain();
        const texts = () =>
          page.evaluate(async (id) => {
            const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
            ss.saveChapter = ss.__real.saveChapter;
            const s = await ss.story(id);
            return Promise.all([s.notes, ...s.chapters].map(async (c) => (await ss.chapter(c))?.text));
          }, ids.story);
        const kept = (t) => t.includes('My newest words.') && t.includes('The other open copy.');
        await h.poll(page, texts, kept, (t) => `${at}: what is stored is ${JSON.stringify(t)}`, { timeout: 8000 });
        await backTo(page, 'write');
        const shown = () => page.locator('.st-ta').inputValue();
        const say = (v) => `${at}: back from the Safe Zone the page reads ${JSON.stringify(v)}, not the kept copy`;
        await h.poll(page, shown, (v) => v === 'My newest words.', say, { timeout: 5000 });
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },
};
