import { drawPage, line } from './art-eraser-glow.e2e.mjs';
import { backTo, onDisk, routeIs, safeZone, strokesAre } from './back-to-the-same-page.e2e.mjs';
import { seed } from './story-reading.e2e.mjs';

const stall = (page, name, mode) =>
  page.evaluate(
    ([name, mode]) => {
      const get = IDBObjectStore.prototype.get;
      window.__answer = () => (IDBObjectStore.prototype.get = get);
      IDBObjectStore.prototype.get = function (...a) {
        if (this.name !== name || (mode && this.transaction.mode !== mode)) return get.apply(this, a);
        window.__stalled = true;
        return {};
      };
    },
    [name, mode],
  );
const neverOpens = (page, db, fail) =>
  page.evaluate(
    ([db, fail]) => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...a) {
        if (a[0] !== db) return open.apply(this, a);
        IDBFactory.prototype.open = open;
        const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: undefined };
        req.error = new DOMException('The disk could not be read.', 'NotReadableError');
        if (fail) window.__failOpen = () => req.onerror?.(new Event('error'));
        return req;
      };
    },
    [db, fail],
  );
const holdElsewhere = (page, db, name) =>
  page.evaluate(
    ([db, name]) =>
      new Promise((held) => {
        const open = indexedDB.open(db);
        open.onsuccess = () => {
          const store = open.result.transaction(name, 'readwrite').objectStore(name);
          let on = true;
          window.__letGo = () => (on = false);
          const spin = () => (on ? (store.get('held').onsuccess = spin) : open.result.close());
          spin();
          held();
        };
      }),
    [db, name],
  );
const tryAgain = (page) => page.locator('.dq-cant').getByRole('button', { name: 'Try again', exact: true }).click();

export async function panelShows(h, page, sel, what, where) {
  const title = page.locator(`${sel} .dq-cant .st-empty-t`);
  await title.waitFor({ timeout: 15000 }).catch(() => {});
  const said = await title.textContent({ timeout: 1000 }).catch(() => null);
  h.expect(said === `Can’t open this ${what} right now`, `${where}: the page says ${JSON.stringify(said)}`);
  const editable = await page.locator(`${sel} textarea, ${sel} canvas`).count();
  h.expect(!editable, `${where}: it came in with something to write or draw on`);
}
async function clearGetsThrough(h, page, what) {
  const check = () =>
    page.evaluate(async () => {
      const { holdAll } = await import('/src/core/cleared.ts');
      const through = holdAll().then((held) => (held.release(), 'through'));
      return Promise.race([through, new Promise((done) => setTimeout(() => done('held'), 1000))]);
    });
  const say = () => `${what} held the check Clear game makes first`;
  await h.poll(page, check, (c) => c === 'through', say, { timeout: 20000 });
}
async function shots(h, page, name) {
  await h.shot(page, `${name}-390`);
  await page.setViewportSize({ width: 320, height: 568 });
  await h.frames(page, 3);
  await h.shot(page, `${name}-320`);
  await page.setViewportSize({ width: 390, height: 844 });
}
async function savedDrawing(h, page) {
  await drawPage(h, page);
  await line(page, [0.2, 0.3], [0.7, 0.4]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.dq-tools-saved').waitFor();
  return page.evaluate(async () => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    return { db: as.name, id: (await as.list())[0].id };
  });
}
async function story(h, page, pages = true) {
  await h.reachHub(page);
  return page.evaluate(async (pages) => {
    const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
    const { story, first } = await ss.create('The Long Night');
    if (pages) await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
    else await ss.removeChapter(story.id, first.id);
    return { db: ss.name, story: story.id, ch1: first.id };
  }, pages);
}

export const scenarios = {
  async 'writer-storage-never-answers'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const ids = await story(h, page);
      await stall(page, 'chapters');
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.story);
      await routeIs(page, 'write');
      await safeZone(page);
      await backTo(page, 'write');
      await panelShows(h, page, '.st-write', 'story', 'a chapter never read');
      await shots(h, page, 'cant-open-story');
      await page.evaluate(() => window.__answer());
      const kept = await onDisk(page, ids.db, 'chapters', 'get', ids.ch1);
      h.expect(kept?.text === 'The lantern woke.', `while it couldn't open, the chapter became ${kept?.text}`);
      await tryAgain(page);
      const opened = () => page.locator('.st-ta').evaluate((t) => `${t.getAttribute('aria-label')}: ${t.value}`);
      const want = 'Page, Chapter 1: The lantern woke.';
      await h.poll(page, opened, (s) => s === want, (s) => `Try again opened ${s}`, { timeout: 5000 });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'reader-storage-never-answers'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const ids = await story(h, page);
      await stall(page, 'stories', 'readonly');
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), ids.story);
      await routeIs(page, 'read');
      await panelShows(h, page, '.st-reader', 'story', 'reading a story never read');
      h.expect(!(await page.getByText('isn’t on this device any more').count()), 'reading: it says the story is gone');
      await page.evaluate(() => window.__answer());
      await tryAgain(page);
      const words = page.locator('.st-read-text', { hasText: 'The lantern woke.' });
      await words.waitFor({ timeout: 5000 }).catch(() => {});
      h.expect(await words.isVisible(), 'Try again did not open the story to read');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'drawing-storage-never-answers'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const { db, id } = await savedDrawing(h, page);
      await page.locator('.dq-top .dq-back').click();
      await routeIs(page, 'art');
      await stall(page, 'strokes');
      await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
      await routeIs(page, 'draw');
      await safeZone(page);
      await backTo(page, 'draw');
      await panelShows(h, page, '.dq-draw', 'drawing', 'a drawing never read');
      await shots(h, page, 'cant-open-drawing');
      await page.evaluate(() => window.__answer());
      const stored = await onDisk(page, db, 'strokes', 'get', id);
      const drafts = await onDisk(page, db, 'drafts', 'count');
      const changed = `${stored?.length} strokes and ${drafts} drafts`;
      h.expect(stored?.length === 1 && drafts === 0, `while it couldn't open, storage came to ${changed}`);
      await tryAgain(page);
      await strokesAre(h, page, 1, 'Try again');
      const note = await page.locator('.dq-tools-msg').textContent();
      h.expect(!note.includes('keeping drawings'), `after Try again the page says ${JSON.stringify(note)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'piece-storage-never-answers'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const { id } = await savedDrawing(h, page);
      await page.reload();
      await h.reachHub(page);
      await stall(page, 'strokes');
      await page.evaluate((id) => window.__daily.go({ name: 'piece', id }), id);
      await routeIs(page, 'piece');
      await panelShows(h, page, '.dq-piece', 'drawing', 'a saved drawing never read');
      await page.locator('.dq-cant').getByRole('button', { name: 'Try again', exact: true }).focus();
      const other = await ctx.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => !!window.__daily?.store);
      await other.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const s = { i: 1, w: 25, p: [200, 900, 500, 980, 720, 920] };
        const day = window.__daily.store.today();
        await as.put({ id: 'other', kind: 'today', day, t: 2, updated: 2, n: 1, strokes: [s] });
      });
      await other.close();
      await h.sleep(1000);
      await panelShows(h, page, '.dq-piece', 'drawing', 'a saved drawing, after another copy saved one');
      h.expect(!(await page.getByText('That page is no longer here.').count()), 'a saved drawing: it says it is gone');
      const focused = await page.evaluate(() => document.activeElement?.textContent);
      h.expect(focused === 'Try again', `after another copy saved, focus moved to ${JSON.stringify(focused)}`);
      await page.evaluate(() => window.__answer());
      await tryAgain(page);
      const keep = page.getByRole('button', { name: 'Keep drawing', exact: true });
      await keep.waitFor({ timeout: 5000 }).catch(() => {});
      h.expect(await keep.isVisible(), 'Try again did not open the saved drawing');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-drawing-kept-in-memory-stays-open'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await page.addInitScript(() => {
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...a) {
          if (String(a[0]).endsWith('.art')) throw new DOMException('Storage is off.', 'SecurityError');
          return open.apply(this, a);
        };
      });
      await page.reload();
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await line(page, [0.3, 0.5], [0.8, 0.6]);
      await safeZone(page);
      await backTo(page, 'draw');
      await strokesAre(h, page, 2, 'back to a page kept in memory');
      await page.locator('.dq-tool--clear').click();
      await page.locator('.dq-tools-confirm').getByRole('button', { name: 'Clear', exact: true }).click();
      await safeZone(page);
      const drawn = await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return (await as.exportDrafts()).drafts.filter((d) => d.strokes.length).length;
      });
      h.expect(!drawn, `after clearing the page, ${drawn} drafts with strokes were kept`);
      await backTo(page, 'draw');
      await strokesAre(h, page, 0, 'back to an emptied page kept in memory');
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const first = () =>
        page.evaluate(async () => {
          const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
          return (await as.list())[0]?.id;
        });
      const id = await h.poll(page, first, (x) => !!x, () => 'the drawing was never kept', { timeout: 5000 });
      await page.evaluate((id) => window.__daily.go({ name: 'piece', id }), id);
      await routeIs(page, 'piece');
      const fav = page.getByRole('button', { name: 'Favourite', exact: true });
      await fav.click();
      const pressed = () => document.querySelector('.dq-piece-fav')?.getAttribute('aria-pressed') === 'true';
      await page.waitForFunction(pressed);
      await h.frames(page, 10);
      const shut = await page.locator('.dq-piece .dq-cant').count();
      h.expect(!shut, 'Favourite on a drawing kept in memory said it could not open');
      h.expect(await page.getByRole('button', { name: 'Keep drawing', exact: true }).isVisible(), 'the drawing went');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'an-unread-draft-keeps-its-drawing-shut'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const { db, id } = await savedDrawing(h, page);
      const key = `edit:${id}:an-earlier-tab`;
      await page.evaluate(
        async ([id, key]) => {
          const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
          const s = (y) => ({ i: 1, w: 25, p: [200, y, 500, y + 80, 720, y + 20] });
          await as.putDraft({ key, kind: 'today', editId: id, strokes: [s(500), s(900)], t: Date.now() - 3600e3 });
        },
        [id, key],
      );
      await page.reload();
      await h.reachHub(page);
      await page.evaluate(() => {
        const real = { get: IDBObjectStore.prototype.get, getAll: IDBObjectStore.prototype.getAll };
        window.__answer = () => Object.assign(IDBObjectStore.prototype, real);
        for (const name of ['get', 'getAll']) {
          IDBObjectStore.prototype[name] = function (...a) {
            if (this.name === 'drafts') throw new DOMException('The disk could not be read.', 'NotReadableError');
            return real[name].apply(this, a);
          };
        }
      });
      await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
      await routeIs(page, 'draw');
      await panelShows(h, page, '.dq-draw', 'drawing', 'opening a drawing whose draft could not be read');
      await page.evaluate(() => window.__answer());
      const kept = await onDisk(page, db, 'drafts', 'get', key);
      h.expect(kept?.strokes?.length === 2, `the unread draft became ${JSON.stringify(kept?.strokes?.length)} strokes`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-page-drawn-without-storage-keeps-off-an-unread-draft'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const { db, id } = await savedDrawing(h, page);
      await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today' }));
      await strokesAre(h, page, 0, 'a new page');
      await line(page, [0.3, 0.2], [0.6, 0.8]);
      await line(page, [0.4, 0.2], [0.8, 0.6]);
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await routeIs(page, 'stories');
      await page.reload();
      await h.reachHub(page);
      const key = await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return `today:${as.claimTab().id}`;
      });
      await stall(page, 'strokes');
      await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
      await panelShows(h, page, '.dq-draw', 'drawing', 'a drawing never read');
      await page.evaluate(() => window.__answer());
      await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today' }));
      await strokesAre(h, page, 0, 'a new page without storage');
      await line(page, [0.2, 0.5], [0.7, 0.5]);
      await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
      await panelShows(h, page, '.dq-draw', 'drawing', 'a drawing without storage');
      await tryAgain(page);
      await strokesAre(h, page, 1, 'Try again');
      await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today' }));
      await strokesAre(h, page, 2, 'Draw today once storage is back');
      const kept = await onDisk(page, db, 'drafts', 'get', key);
      h.expect(kept?.strokes?.length === 2, `the draft left before the stall became ${kept?.strokes?.length} strokes`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-hidden-page-waits-for-storage'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const { id } = await savedDrawing(h, page);
      await page.evaluate(() => {
        window.__hidden = false;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
        window.__show = (on) => {
          window.__hidden = !on;
          document.dispatchEvent(new Event('visibilitychange'));
        };
      });
      await stall(page, 'strokes');
      await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
      await page.waitForFunction(() => window.__stalled);
      await page.evaluate(() => window.__show(false));
      await h.sleep(9000);
      await page.evaluate(() => window.__show(true));
      await h.sleep(3000);
      const stalls = () =>
        page.evaluate(async () => {
          const { artStore } = await import('/src/daily/artstore.ts');
          return artStore(window.__daily.store.key).link.stalls;
        });
      h.expect((await stalls()) === 0, 'storage was given up before it had 10 s with the page showing');
      await panelShows(h, page, '.dq-draw', 'drawing', 'storage that never answers once the page shows again');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'no-storage-at-all-says-gone'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }));
      await page.reload();
      await h.reachHub(page);
      await page.evaluate(() => window.__daily.go({ name: 'piece', id: 'never-kept' }));
      await routeIs(page, 'piece');
      const gone = page.getByText('That page is no longer here.');
      await gone.waitFor({ timeout: 5000 }).catch(() => {});
      h.expect(await gone.isVisible(), 'with no storage at all, a drawing never kept did not read as gone');
      h.expect(!(await page.locator('.dq-cant').count()), 'with no storage at all, it offered Try again');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-draft-that-failed-to-read-opens-on-back'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const s = { i: 1, w: 25, p: [200, 500, 500, 580, 720, 520] };
        await as.putDraft({ key: 'today:an-earlier-tab', kind: 'today', strokes: [s], t: Date.now() - 3600e3 });
      });
      await page.reload();
      await h.reachHub(page);
      await page.evaluate(() => {
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...a) {
          if (this.name !== 'drafts') return get.apply(this, a);
          IDBObjectStore.prototype.get = get;
          throw new DOMException('The disk could not be read.', 'NotReadableError');
        };
      });
      await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today', draft: 'today:an-earlier-tab' }));
      await routeIs(page, 'draw');
      await panelShows(h, page, '.dq-draw', 'drawing', 'a draft whose read failed');
      await safeZone(page);
      await backTo(page, 'draw');
      await strokesAre(h, page, 1, 'back to the draft whose read failed');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-late-open-changes-nothing'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const { db, id } = await savedDrawing(h, page);
      await page.locator('.dq-top .dq-back').click();
      await routeIs(page, 'art');
      await stall(page, 'strokes');
      await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
      await panelShows(h, page, '.dq-draw', 'drawing', 'a drawing never read');
      await page.evaluate(() => window.__answer());
      await neverOpens(page, db, true);
      await tryAgain(page);
      await page.waitForFunction(() => !!window.__failOpen);
      await panelShows(h, page, '.dq-draw', 'drawing', 'Try again while the database never opens');
      await tryAgain(page);
      await strokesAre(h, page, 1, 'Try again once the database opens');
      await page.evaluate(() => window.__failOpen());
      const after = await page.evaluate(async (id) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const misses = as.link.misses;
        const read = (await as.get(id))?.strokes.length;
        return { persistent: as.persistent, read, missed: as.link.misses !== misses };
      }, id);
      const ok = after.persistent && after.read === 1 && !after.missed;
      h.expect(ok, `the open given up on, failing late, left storage as ${JSON.stringify(after)}`);
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
        const { db, id } = await savedDrawing(h, page);
        await page.reload();
        await h.reachHub(page);
        await page.evaluate(() => {
          const transaction = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (stores, ...rest) {
            if (![].concat(stores).includes('strokes')) return transaction.call(this, stores, ...rest);
            IDBDatabase.prototype.transaction = transaction;
            throw new DOMException('The connection was lost.', 'InvalidStateError');
          };
        });
        if (opens) await stall(page, 'strokes');
        else await neverOpens(page, db, false);
        await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
        await panelShows(h, page, '.dq-draw', 'drawing', at);
        const took = await page.evaluate(async (id) => {
          const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
          const t = performance.now();
          await as.get(id);
          return performance.now() - t;
        }, id);
        h.expect(took < 2000, `${at}: what it waited on was never given up: a read waited ${Math.round(took)} ms`);
        if (opens) await page.evaluate(() => window.__answer());
        await tryAgain(page);
        await strokesAre(h, page, 1, `Try again after ${at}`);
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
      const db = await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...a) {
          if (this.name !== 'drafts') return put.apply(this, a);
          IDBObjectStore.prototype.put = put;
          window.__cut = true;
          throw new DOMException('The connection was lost.', 'UnknownError');
        };
        return as.name;
      });
      await neverOpens(page, db, false);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await page.waitForFunction(() => window.__cut);
      await clearGetsThrough(h, page, 'a write cut off from storage');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-write-that-never-answers-holds-nothing'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const { id } = await savedDrawing(h, page);
      await stall(page, 'meta', 'readwrite');
      await page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
      await strokesAre(h, page, 1, 'the saved drawing');
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await page.waitForFunction(() => window.__stalled, null, { timeout: 10000 });
      await clearGetsThrough(h, page, 'a write whose request never answers');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-removal-storage-gave-up-on-stays-removed'(h) {
    for (const way of ['held by another connection', 'with storage that throws as it opens']) {
      const { ctx, page, errors } = await h.open(seed(h));
      try {
        const { db, id } = await savedDrawing(h, page);
        const throws = way.includes('throws');
        if (!throws) await holdElsewhere(page, db, 'meta');
        await page.evaluate(
          async ([id, throws]) => {
            const m = await import('/src/daily/artstore.ts');
            const as = m.artStore(window.__daily.store.key);
            as.hide(id, m.revOf(await as.get(id)));
            if (!throws) await as.remove(id);
          },
          [id, throws],
        );
        if (throws) {
          await page.addInitScript(() => {
            const db = localStorage.getItem('e2e.throw-open');
            const open = IDBFactory.prototype.open;
            IDBFactory.prototype.open = function (...a) {
              if (db && a[0] === db) throw new DOMException('Storage is off.', 'SecurityError');
              return open.apply(this, a);
            };
          });
          await page.evaluate((db) => localStorage.setItem('e2e.throw-open', db), db);
          await page.reload();
          await h.reachHub(page);
          await page.evaluate(async (id) => {
            const { artStore } = await import('/src/daily/artstore.ts');
            await artStore(window.__daily.store.key).remove(id);
          }, id);
          await page.evaluate(() => localStorage.removeItem('e2e.throw-open'));
        } else await page.evaluate(() => window.__letGo());
        await page.reload();
        await h.reachHub(page);
        const shown = await page.evaluate(async (id) => {
          const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
          return as.isShown(id);
        }, id);
        h.expect(!shown, `a removal ${way} came back after a reload`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  async 'a-first-page-held-elsewhere'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      const ids = await story(h, page, false);
      await holdElsewhere(page, ids.db, 'chapters');
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.story);
      await routeIs(page, 'write');
      await panelShows(h, page, '.st-write', 'story', 'a first page held by another connection');
      await page.evaluate(() => window.__letGo());
      await h.sleep(1000);
      const stored = await onDisk(page, ids.db, 'stories', 'get', ids.story);
      h.expect(stored?.chapters.length === 0, `the first page landed later: ${JSON.stringify(stored?.chapters)}`);
      await tryAgain(page);
      await page.getByRole('textbox', { name: 'Page, Chapter 1' }).fill('The first line.');
      const kept = () =>
        page.evaluate(async (id) => {
          const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
          const s = await ss.story(id);
          return Promise.all(s.chapters.map(async (c) => (await ss.onDisk(c))?.text));
        }, ids.story);
      const one = (t) => t.length === 1 && t[0] === 'The first line.';
      const say = (t) => `after Try again the pages stored are ${JSON.stringify(t)}`;
      await h.poll(page, kept, one, say, { timeout: 5000 });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
