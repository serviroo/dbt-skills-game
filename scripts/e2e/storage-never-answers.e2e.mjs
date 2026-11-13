import { drawPage, line } from './art-eraser-glow.e2e.mjs';
import {
  cantOpenShows,
  drawReady,
  routeIs,
  safeAndBack,
  save,
  seed,
  shows,
  stroke,
} from './back-to-the-same-page.e2e.mjs';
const isIn = (sel) => {
  const el = document.querySelector(sel);
  return !!el && !el.inert && getComputedStyle(el).visibility !== 'hidden';
};
const comesIn = (h, page, sel, where, timeout = 5000) =>
  page.waitForFunction(isIn, sel, { timeout }).then(
    () => {},
    () => h.expect(false, `${where}: the page never came in`),
  );
async function holds(h, page, name, where) {
  await h.poll(
    page,
    () => page.locator('.st-ta').getAttribute('aria-label'),
    (l) => l === name,
    (l) => `${where} opened ${l}, not ${name}`,
    { timeout: 5000 },
  );
  await comesIn(h, page, '.st-write', where);
}
const writeStory = (page, r) => page.evaluate((r) => window.__daily.go(r), { name: 'write', ...r });
const WAIT = 15000;
const panelIn = (page, sel) => page.locator(`${sel} .dq-cant-t`).waitFor({ timeout: WAIT }).catch(() => {});
const NO_ANSWER = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: undefined };
const stall = (page, name, mode) =>
  page.evaluate(
    ([name, mode]) => {
      const get = IDBObjectStore.prototype.get;
      window.__stalled = 0;
      window.__answer = () => (IDBObjectStore.prototype.get = get);
      IDBObjectStore.prototype.get = function (...a) {
        if (this.name !== name || (mode && this.transaction.mode !== mode)) return get.apply(this, a);
        window.__stalled++;
        return {};
      };
    },
    [name, mode],
  );
const stallList = (page, name) =>
  page.evaluate((name) => {
    const getAll = IDBObjectStore.prototype.getAll;
    window.__stalled = 0;
    window.__answer = () => (IDBObjectStore.prototype.getAll = getAll);
    IDBObjectStore.prototype.getAll = function (...a) {
      if (this.name !== name) return getAll.apply(this, a);
      window.__stalled++;
      return {};
    };
  }, name);
const stalledYet = (page) => page.waitForFunction(() => window.__stalled > 0, null, { timeout: 5000 });
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
async function shots(h, page, name) {
  await h.shot(page, `${name}-390`);
  const was = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  await h.frames(page, 3);
  await h.shot(page, `${name}-320`);
  await page.setViewportSize(was);
  await h.frames(page, 3);
}
const tryAgain = (page) => page.locator('.dq-cant').getByRole('button', { name: 'Try again', exact: true }).click();
const pageText = (page) => page.locator('.st-ta').inputValue();
async function savedDrawing(h, page) {
  await drawPage(h, page);
  await line(page, [0.2, 0.3], [0.7, 0.4]);
  await save(page);
  return page.evaluate(async () => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    return { db: as.name, id: (await as.list())[0].id };
  });
}
const openDrawing = (page, id) => page.evaluate((id) => window.__daily.go({ name: 'draw', kind: 'today', id }), id);
const neverOpens = (page, db) =>
  page.evaluate(
    ([db, req]) => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...a) {
        if (a[0] !== db) return open.apply(this, a);
        IDBFactory.prototype.open = open;
        const r = { ...req, error: new DOMException('The disk could not be read.', 'NotReadableError') };
        window.__failOpen = () => r.onerror?.(new Event('error'));
        return r;
      };
    },
    [db, NO_ANSWER],
  );
const failNextRead = (page, store) => page.evaluate((name) => {
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (...args) {
    if (this.name !== name || this.transaction.mode !== 'readonly') return get.apply(this, args);
    IDBObjectStore.prototype.get = get;
    const req = { error: new DOMException('The disk could not be read.', 'NotReadableError') };
    queueMicrotask(() => req.onerror?.(new Event('error')));
    return req;
  };
}, store);
const failNextOpen = (page, db) => page.addInitScript((name) => {
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args) {
    if (args[0] !== name) return open.apply(this, args);
    IDBFactory.prototype.open = open;
    const req = { error: new DOMException('The disk could not be read.', 'NotReadableError') };
    setTimeout(() => {
      window.__openFailed = true;
      req.onerror?.(new Event('error'));
    }, 0);
    return req;
  };
}, db);
const alertTakesFocus = async (h, page, sel, where) => {
  const got = await page.evaluate((sel) => {
    const box = document.querySelector(`${sel} .dq-cant`);
    return { role: box?.getAttribute('role'), focused: document.activeElement === box?.querySelector('.dq-cant-t') };
  }, sel);
  h.expect(got.role === 'alert' && got.focused, `${where}: the panel is ${JSON.stringify(got)}, not an alert in focus`);
};
const storyOfTwo = (page) =>
  page.evaluate(async () => {
    const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
    const { story, first } = await ss.create('The Long Night');
    await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
    return { db: ss.name, story: story.id, notes: story.notes };
  });
async function withPage(h, run) {
  const { ctx, page, errors } = await h.open(seed(h));
  try {
    await run(page, ctx);
    h.expect(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}
async function draftDuringReconnect(h, failRead) {
  await withPage(h, async (page) => {
    await h.reachHub(page);
    const key = 'today:earlier-session';
    const db = await page.evaluate(async ([key, s]) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      await as.putDraft({ key, kind: 'today', strokes: [s], t: Date.now() - 3600e3 });
      return as.name;
    }, [key, stroke(200, 500)]);
    await page.reload();
    await h.reachHub(page);
    await stall(page, 'drafts', 'readonly');
    if (failRead) await page.evaluate(() => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        const req = get.apply(this, args);
        if (this.name === 'drafts' && this.transaction.mode === 'readonly') {
          const failed = { error: new DOMException('The disk could not be read.', 'NotReadableError') };
          window.__failDraft = () => failed.onerror?.(new Event('error'));
          return failed;
        }
        return req;
      };
    });
    await neverOpens(page, db);
    await page.evaluate((name) => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
        IDBDatabase.prototype.transaction = transaction;
        throw new DOMException('The connection was lost.', 'InvalidStateError');
      };
    }, db);
    const opened = Date.now();
    await page.evaluate((draft) => window.__daily.go({ name: 'draw', kind: 'today', draft }), key);
    await routeIs(page, 'draw');
    await stalledYet(page);
    await page.evaluate(async (s) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      void as.putDraft({ key: 'today:other-session', kind: 'today', strokes: [s], t: Date.now() });
    }, stroke(100, 200));
    await page.waitForFunction(() => !!window.__failOpen, null, { timeout: 5000 });
    if (failRead) {
      await new Promise((go) => setTimeout(go, Math.max(0, opened + 8500 - Date.now())));
      await page.evaluate(() => window.__failDraft());
    }
    await panelIn(page, '.dq-draw');
    const took = Date.now() - opened;
    h.expect(took < 12500, `the drawing page waited ${took} ms before saying it can't open`);
    await comesIn(h, page, '.dq-draw', 'a stalled draft during a stalled reconnect');
    await cantOpenShows(h, page, '.dq-draw', 'drawing', 'a stalled draft during a stalled reconnect');
    await alertTakesFocus(h, page, '.dq-draw', 'a stalled draft during a stalled reconnect');
    await page.evaluate(() => window.__answer());
    const draft = await onDisk(page, db, 'drafts', 'get', key);
    h.expect(draft?.strokes?.length === 1, 'the stalled draft changed on disk');
    await tryAgain(page);
    await drawReady(page);
    await page.locator('.dq-ink-stage').waitFor({ timeout: 5000 });
    await shows(h, page, 1, 'the draft after Try again:');
  });
}
async function pendingOpenSurvivesVisibility(h) {
  await withPage(h, async (page) => {
    await h.reachHub(page);
    const key = 'today:held-read';
    const db = await page.evaluate(async ([key, s]) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      await as.putDraft({ key, kind: 'today', strokes: [s], t: Date.now() });
      return as.name;
    }, [key, stroke(200, 500)]);
    await page.evaluate((name) => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== name || mode !== 'readonly') return transaction.call(this, stores, mode, ...rest);
        IDBDatabase.prototype.transaction = transaction;
        throw new DOMException('The connection was lost.', 'InvalidStateError');
      };
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...args) {
        if (args[0] !== name) return open.apply(this, args);
        IDBFactory.prototype.open = open;
        const real = open.apply(this, args);
        const held = {};
        real.onerror = () => { held.error = real.error; held.onerror?.(new Event('error')); };
        real.onsuccess = () => {
          held.result = real.result;
          window.__releaseOpen = () => held.onsuccess?.(new Event('success'));
        };
        return held;
      };
    }, db);
    await page.evaluate(async (key) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      window.__heldRead = as.getDraft(key);
    }, key);
    await page.waitForFunction(() => !!window.__releaseOpen, null, { timeout: 5000 });
    h.expect((await page.evaluate(() => document.visibilityState)) === 'visible', 'the page is not visible');
    await page.evaluate(async (s) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      window.__heldWrite = as.putDraft({ key: 'today:held-write', kind: 'today', strokes: [s], t: Date.now() });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__releaseOpen();
    }, stroke(100, 200));
    const read = await page.evaluate(async () => {
      const [draft] = await Promise.all([window.__heldRead, window.__heldWrite]);
      return draft?.strokes?.length ?? null;
    });
    h.expect(read === 1, `a healthy reconnect returned a draft with ${read} strokes`);
    const saved = await onDisk(page, db, 'drafts', 'get', 'today:held-write');
    h.expect(saved?.strokes?.length === 1, 'a visibility change lost a write waiting on a healthy reconnect');
  });
}

async function unattendedOpenTimesOut(h) {
  await withPage(h, async (page) => {
    await h.reachHub(page);
    const db = await page.evaluate(async () => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      await as.list();
      return as.name;
    });
    await neverOpens(page, db);
    await page.evaluate((name) => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
        IDBDatabase.prototype.transaction = transaction;
        throw new DOMException('The connection was lost.', 'InvalidStateError');
      };
    }, db);
    await page.evaluate(async (s) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      window.__writeDone = false;
      void as.putDraft({ key: 'today:unanswered-open', kind: 'today', strokes: [s], t: Date.now() })
        .then(() => (window.__writeDone = true));
    }, stroke(100, 200));
    await page.waitForFunction(() => !!window.__failOpen, null, { timeout: 5000 });
    await page.waitForFunction(() => window.__writeDone, null, { timeout: WAIT });
    const kept = await page.evaluate(async () => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      return as.persistent;
    });
    h.expect(!kept, 'a write waiting on a timed-out open said it was saved');
    const saved = await onDisk(page, db, 'drafts', 'get', 'today:unanswered-open');
    h.expect(!saved, 'a write waiting on a timed-out open changed storage');
  });
}

async function canceledStoryReadSaysSo(h) {
  await withPage(h, async (page) => {
    await h.reachHub(page);
    const ids = await storyOfTwo(page);
    await page.reload();
    await h.reachHub(page);
    const chapter = await page.evaluate(async (id) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const story = await ss.story(id);
      return ss.chapter(story.chapters[0]);
    }, ids.story);
    await page.evaluate(async (id) => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        if (this.name !== 'stories' || this.transaction.mode !== 'readonly') return get.apply(this, args);
        IDBObjectStore.prototype.get = get;
        const held = { error: new DOMException('The disk could not be read.', 'NotReadableError') };
        window.__failStoryRead = () => held.onerror?.(new Event('error'));
        return held;
      };
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      window.__firstStoryRead = ss.story(id);
    }, ids.story);
    await page.waitForFunction(() => !!window.__failStoryRead, null, { timeout: 5000 });
    await neverOpens(page, ids.db);
    await page.evaluate((name) => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
        IDBDatabase.prototype.transaction = transaction;
        throw new DOMException('The connection was lost.', 'InvalidStateError');
      };
    }, ids.db);
    await page.evaluate(async (chapter) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      void ss.saveChapter(chapter, [chapter.rev]);
    }, chapter);
    await page.waitForFunction(() => !!window.__failOpen, null, { timeout: 5000 });
    await page.evaluate(async () => {
      window.__failStoryRead();
      await window.__firstStoryRead;
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const story = ss.story;
      ss.story = function (...args) {
        window.__readerStarted = true;
        return story.apply(this, args);
      };
    });
    await page.evaluate((id) => window.__daily.go({ name: 'read', id }), ids.story);
    await page.waitForFunction(() => window.__readerStarted, null, { timeout: 5000 });
    h.expect((await page.evaluate(() => document.visibilityState)) === 'visible', 'the page is not visible');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.locator('.st-reader .dq-cant-t').waitFor({ timeout: 5000 });
    await comesIn(h, page, '.st-reader', 'a canceled story read');
    await cantOpenShows(h, page, '.st-reader', 'story', 'a canceled story read');
    const gone = await page.getByText('isn’t on this device any more').count();
    h.expect(!gone, 'a canceled read said the story was gone');
    await tryAgain(page);
    await page.locator('.st-read-text', { hasText: 'The lantern woke.' }).waitFor({ timeout: 5000 });
  });
}
export const scenarios = {
  async 'a-stalled-draft-with-a-stalled-reconnect'(h) {
    await draftDuringReconnect(h, false);
  },
  async 'a-failed-draft-with-a-stalled-reconnect'(h) {
    await draftDuringReconnect(h, true);
  },
  async 'a-canceled-reconnect-keeps-a-removal-hidden'(h) {
    await withPage(h, async (page) => {
      const { db, id } = await savedDrawing(h, page);
      await page.reload();
      await h.reachHub(page);
      await page.evaluate(async (id) => {
        const { artStore, revOf } = await import('/src/daily/artstore.ts');
        const as = artStore(window.__daily.store.key);
        await as.claimTab().ready;
        const meta = (await as.list()).find((m) => m.id === id);
        as.hide(id, revOf(meta));
        const get = IDBObjectStore.prototype.get;
        window.__removalRequests = 0;
        window.__restoreGet = () => (IDBObjectStore.prototype.get = get);
        IDBObjectStore.prototype.get = function (...args) {
          if (this.name !== 'meta' || this.transaction.mode !== 'readwrite') return get.apply(this, args);
          window.__removalRequests++;
          const req = { error: new DOMException('The disk could not be read.', 'NotReadableError') };
          window.__failRemoval = () => req.onerror?.(new Event('error'));
          return req;
        };
        window.__removalDone = false;
        void as.remove(id).then(() => (window.__removalDone = true));
      }, id);
      await page.waitForFunction(() => !!window.__failRemoval, null, { timeout: 5000 });
      await neverOpens(page, db);
      await page.evaluate((name) => {
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException('The connection was lost.', 'InvalidStateError');
        };
      }, db);
      await page.evaluate(async (s) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        void as.putDraft({ key: 'today:other-session', kind: 'today', strokes: [s], t: Date.now() });
      }, stroke(100, 200));
      await page.waitForFunction(() => !!window.__failOpen, null, { timeout: 5000 });
      await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        void as.getDraft('today:another-session');
      });
      await page.evaluate(() => window.__failRemoval());
      await page.waitForFunction(() => window.__removalDone, null, { timeout: WAIT });
      const requests = await page.evaluate(() => window.__removalRequests);
      h.expect(requests === 1, `the failed removal started ${requests} requests`);
      await page.evaluate(() => {
        window.__restoreGet();
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const strokes = await onDisk(page, db, 'strokes', 'get', id);
      h.expect(strokes?.length === 1, 'the failed removal changed the stored drawing');
      await page.evaluate(() => window.__daily.go({ name: 'art' }));
      await page.locator('.dq-gallery .dq-empty, .dq-gallery [data-piece], .dq-gallery .dq-cant')
        .first().waitFor({ timeout: 5000 });
      h.expect(!(await page.locator(`[data-piece="${id}"]`).count()), 'the failed removal showed its drawing again');
      h.expect(await page.locator('.dq-gallery .dq-empty').isVisible(), 'the recovered gallery did not finish loading');
    });
  },
  async 'a-write-with-no-database-stays-unsaved'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const db = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        return ss.name;
      });
      await failNextOpen(page, db);
      await page.reload();
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        return (await ss.create('A Story Kept Here')).story.id;
      });
      h.expect(await page.evaluate(() => window.__openFailed === true), 'the story database open did not fail');
      await page.evaluate(async (id) => {
        document.dispatchEvent(new Event('visibilitychange'));
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        await ss.story(id);
      }, id);
      await writeStory(page, { id });
      await holds(h, page, 'Page, Chapter 1', 'a story made while storage was unavailable');
      const state = await page.locator('.st-state').textContent();
      h.expect(state.includes('Not saving right now'), `a story only kept in memory says ${state}`);
      const stored = await onDisk(page, db, 'stories', 'get', id);
      h.expect(!stored, 'a story that could not be saved appeared on disk');
    });
  },
  async 'writer-storage-never-answers'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('The Long Night');
        await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
        return { db: ss.name, story: story.id, ch1: first.id };
      });
      await stall(page, 'chapters');
      await writeStory(page, { id: ids.story });
      await routeIs(page, 'write');
      await stalledYet(page);
      await safeAndBack(page, 'write');
      await panelIn(page, '.st-write');
      await comesIn(h, page, '.st-write', 'storage that never answers');
      await cantOpenShows(h, page, '.st-write', 'story', 'storage that never answers');
      await alertTakesFocus(h, page, '.st-write', 'storage that never answers');
      await shots(h, page, 'cant-open-story');
      await page.evaluate(() => window.__answer());
      const story = await onDisk(page, ids.db, 'stories', 'get', ids.story);
      const stored = await onDisk(page, ids.db, 'chapters', 'get', ids.ch1);
      const same = story?.chapters.length === 1 && stored?.text === 'The lantern woke.';
      h.expect(same, `while it couldn't open, the story became ${JSON.stringify([story?.chapters, stored?.text])}`);
      await tryAgain(page);
      await holds(h, page, 'Page, Chapter 1', 'Try again once storage answered');
      const text = await pageText(page);
      h.expect(text === 'The lantern woke.', `Try again once storage answered, the page reads ${JSON.stringify(text)}`);
      const state = await page.locator('.st-state').textContent();
      h.expect(state.includes('Saved') && !state.includes('Not saving'), `after Try again, the writer says ${state}`);
    });
  },
  async 'reader-storage-never-answers'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('The Long Night');
        await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
        return { db: ss.name, id: story.id };
      });
      const before = await onDisk(page, ids.db, 'stories', 'get', ids.id);
      await stall(page, 'stories', 'readonly');
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), ids.id);
      await routeIs(page, 'read');
      await panelIn(page, '.st-reader');
      await comesIn(h, page, '.st-reader', 'reading while storage never answers');
      await cantOpenShows(h, page, '.st-reader', 'story', 'reading while storage never answers');
      await alertTakesFocus(h, page, '.st-reader', 'reading while storage never answers');
      const gone = await page.getByText('isn’t on this device any more').count();
      h.expect(!gone, 'reading while storage never answers: it says the story is gone');
      await shots(h, page, 'cant-open-reading');
      await page.evaluate(() => window.__answer());
      const after = await onDisk(page, ids.db, 'stories', 'get', ids.id);
      h.expect(JSON.stringify(after) === JSON.stringify(before), 'the stalled reader changed the stored story');
      await tryAgain(page);
      const words = page.locator('.st-read-text', { hasText: 'The lantern woke.' });
      await words.waitFor({ timeout: 5000 }).catch(() => {});
      h.expect(await words.isVisible(), 'Try again once storage answered did not open the story to read');
    });
  },
  async 'reader-chapter-never-answers'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const { db, story } = await storyOfTwo(page);
      const before = await onDisk(page, db, 'chapters', 'getAll');
      await stall(page, 'chapters', 'readonly');
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), story);
      await routeIs(page, 'read');
      await panelIn(page, '.st-reader');
      await comesIn(h, page, '.st-reader', 'a chapter read that never answers');
      await cantOpenShows(h, page, '.st-reader', 'story', 'a chapter read that never answers');
      await alertTakesFocus(h, page, '.st-reader', 'a chapter read that never answers');
      await page.evaluate(() => window.__answer());
      const after = await onDisk(page, db, 'chapters', 'getAll');
      h.expect(JSON.stringify(after) === JSON.stringify(before), 'the stalled reader changed stored chapters');
      await tryAgain(page);
      const words = page.locator('.st-read-text', { hasText: 'The lantern woke.' });
      await words.waitFor({ timeout: 5000 });
    });
  },
  async 'drawing-storage-never-answers'(h) {
    await withPage(h, async (page) => {
      const { db, id } = await savedDrawing(h, page);
      await page.locator('.dq-top .dq-back').click();
      await routeIs(page, 'art');
      await stall(page, 'strokes');
      await openDrawing(page, id);
      await routeIs(page, 'draw');
      await stalledYet(page);
      await safeAndBack(page, 'draw');
      await panelIn(page, '.dq-draw');
      await comesIn(h, page, '.dq-draw', 'storage that never answers');
      await cantOpenShows(h, page, '.dq-draw', 'drawing', 'storage that never answers');
      await alertTakesFocus(h, page, '.dq-draw', 'storage that never answers');
      await shots(h, page, 'cant-open-drawing');
      await page.evaluate(() => window.__answer());
      const stored = await onDisk(page, db, 'strokes', 'get', id);
      const drafts = await onDisk(page, db, 'drafts', 'count');
      const same = stored?.length === 1 && drafts === 0;
      h.expect(same, `while it couldn't open, the drawing became ${stored?.length} strokes and ${drafts} drafts`);
      await tryAgain(page);
      await drawReady(page);
      await shows(h, page, 1, 'Try again once storage answered:');
      const note = await page.locator('.dq-tools-msg').textContent();
      h.expect(!note.includes('keeping drawings'), `Try again once storage answered, the page says ${note}`);
    });
  },
  async 'piece-storage-never-answers'(h) {
    await withPage(h, async (page, ctx) => {
      const { db, id } = await savedDrawing(h, page);
      const before = await onDisk(page, db, 'strokes', 'get', id);
      await page.reload();
      await h.reachHub(page);
      await stall(page, 'strokes');
      await page.evaluate((id) => window.__daily.go({ name: 'piece', id }), id);
      await routeIs(page, 'piece');
      await page.locator('.dq-piece .dq-cant-t').waitFor({ timeout: WAIT }).catch(() => {});
      await cantOpenShows(h, page, '.dq-piece', 'drawing', 'a saved drawing while storage never answers');
      await alertTakesFocus(h, page, '.dq-piece', 'a saved drawing while storage never answers');
      const goneText = page.getByText('That page is no longer here.');
      h.expect(!(await goneText.count()), 'a saved drawing while storage never answers: it says the page is gone');
      await shots(h, page, 'cant-open-piece');
      await page.locator('.dq-cant').getByRole('button', { name: 'Try again', exact: true }).focus();
      await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        window.__changed = false;
        as.onChange(() => (window.__changed = true));
      });
      const other = await ctx.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => !!window.__daily?.store);
      await other.evaluate(async (s) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const day = window.__daily.store.today();
        await as.put({ id: 'from-another-copy', kind: 'today', day, t: 2, updated: 2, n: 1, strokes: [s] });
      }, stroke(200, 900));
      await other.close();
      await page.waitForFunction(() => window.__changed, null, { timeout: 5000 });
      await page.evaluate(async (id) => {
        await (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).isShown(id);
      }, id);
      const where = 'a saved drawing while storage never answers, after another copy saved';
      await cantOpenShows(h, page, '.dq-piece', 'drawing', where);
      h.expect(!(await goneText.count()), `${where}: it says the page is gone`);
      const focused = await page.evaluate(() => document.activeElement?.textContent === 'Try again');
      h.expect(focused, `${where}: Try again lost its focus`);
      await page.evaluate(() => window.__answer());
      const after = await onDisk(page, db, 'strokes', 'get', id);
      h.expect(JSON.stringify(after) === JSON.stringify(before), 'the stalled drawing view changed its strokes');
      await tryAgain(page);
      const keep = page.getByRole('button', { name: 'Keep drawing', exact: true });
      await keep.waitFor({ timeout: 5000 }).catch(() => {});
      h.expect(await keep.isVisible(), 'Try again once storage answered did not open the saved drawing');
    });
  },
  async 'a-switch-storage-never-answers'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await storyOfTwo(page);
      await writeStory(page, { id: ids.story });
      await holds(h, page, 'Page, Chapter 1', 'the story');
      const before = await onDisk(page, ids.db, 'chapters', 'getAll');
      await stall(page, 'chapters', 'readonly');
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await stalledYet(page);
      const pageTab = page.getByRole('radio', { name: 'Show: Page' });
      await h.poll(page, () => pageTab.getAttribute('aria-checked'), (v) => v === 'true',
        (v) => `the Page switch stayed ${v} after the read stalled`, { timeout: WAIT });
      await holds(h, page, 'Page, Chapter 1', 'the page after the switch');
      h.expect((await pageText(page)) === 'The lantern woke.', 'the stalled switch changed the words');
      h.expect(!(await page.locator('.st-write .dq-cant').count()), 'the stalled switch closed the editor');
      await page.evaluate(() => window.__answer());
      const after = await onDisk(page, ids.db, 'chapters', 'getAll');
      h.expect(JSON.stringify(after) === JSON.stringify(before), 'the stalled switch changed stored chapters');
      const reads = () => page.evaluate(async (id) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        return (await ss.chapter(id))?.kind ?? null;
      }, ids.notes);
      await h.poll(page, reads, (v) => v === 'notes', (v) => `storage still returns ${v}`, { timeout: WAIT });
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await holds(h, page, 'Notes for this story', 'Notes once storage answers');
    });
  },
  async 'search-chapter-read-failure-says-so'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      await storyOfTwo(page);
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await page.locator('.st-row', { hasText: 'The Long Night' }).waitFor();
      await stall(page, 'chapters', 'readonly');
      const search = page.getByRole('searchbox', { name: 'Search your stories and notes' });
      await search.fill('lantern');
      await stalledYet(page);
      await page.locator('.dq-cant-t').waitFor({ timeout: WAIT }).catch(() => {});
      const title = await page.locator('.st-shelfpage .dq-cant-t').textContent().catch(() => null);
      h.expect(title === 'Can’t search your stories right now', `a failed chapter search says ${title}`);
      const focused = await search.evaluate((el) => document.activeElement === el);
      h.expect(focused, 'a failed chapter search took focus from the search box');
      h.expect(!(await page.getByText('No matches').count()), 'a failed chapter read reported no matches');
      await page.evaluate(() => window.__answer());
      await tryAgain(page);
      await page.getByRole('searchbox', { name: 'Search your stories and notes' }).fill('lantern');
      await page.locator('.st-found-row', { hasText: 'lantern' }).first().waitFor({ timeout: 5000 });
    });
  },
  async 'shelf-and-gallery-never-look-empty'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    const elsewhere = async (what) => {
      const other = await ctx.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => !!window.__daily?.store);
      await other.evaluate(async ([what, s]) => {
        const key = window.__daily.store.key;
        if (what === 'story') {
          await (await import('/src/daily/storystore.ts')).storyStore(key).create('Another Night');
          return;
        }
        const as = (await import('/src/daily/artstore.ts')).artStore(key);
        const day = window.__daily.store.today();
        await as.put({ id: 'from-another-tab', kind: 'today', day, t: 2, updated: 2, n: 1, strokes: [s] });
      }, [what, stroke(200, 900)]);
      await other.close();
    };
    try {
      await savedDrawing(h, page);
      await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { first } = await ss.create('The Long Night');
        await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
      });
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await routeIs(page, 'stories');
      await page.locator('.st-row', { hasText: 'The Long Night' }).waitFor();
      await stallList(page, 'stories');
      await elsewhere('story');
      await stalledYet(page);
      await page.locator('.dq-cant-t').waitFor({ timeout: WAIT }).catch(() => {});
      const shelf = await page.locator('.st-shelf .dq-cant-t').textContent().catch(() => null);
      h.expect(shelf === 'Can’t read your stories right now', `a stuck shelf says ${shelf}`);
      const panelShown = await page.locator('.st-shelf .dq-cant').isVisible();
      h.expect(panelShown, 'a stuck shelf hid its panel');
      await shots(h, page, 'cant-read-shelf');
      await page.evaluate(() => window.__answer());
      await page.locator('.st-shelf .dq-cant').getByRole('button', { name: 'Try again', exact: true }).click();
      const row = page.locator('.st-row', { hasText: 'The Long Night' });
      await row.waitFor({ timeout: 5000 }).catch(() => {});
      h.expect(await row.isVisible(), 'back at the front with storage answering, the shelf still hid the story');
      await page.evaluate(() => window.__daily.go({ name: 'art' }));
      await routeIs(page, 'art');
      await page.locator('[data-piece]').first().waitFor();
      await stallList(page, 'meta');
      await elsewhere('drawing');
      await page.locator('.dq-cant-t').waitFor({ timeout: WAIT }).catch(() => {});
      const gallery = await page.locator('.dq-cant-t').textContent().catch(() => null);
      h.expect(gallery === 'Can’t read your drawings right now', `a stuck gallery says ${gallery}`);
      await shots(h, page, 'cant-read-gallery');
      await tryAgain(page);
      const retry = page.locator('.dq-cant').getByRole('button', { name: 'Try again', exact: true });
      await retry.waitFor({ timeout: WAIT }).catch(() => {});
      const ready = (await retry.count()) === 1 && (await retry.getAttribute('aria-disabled')) !== 'true';
      h.expect(ready, 'Try again stayed stuck once storage opened but still couldn’t read');
      await page.evaluate(() => window.__answer());
      await tryAgain(page);
      const cards = page.locator('[data-piece]');
      await cards.nth(1).waitFor({ timeout: 5000 }).catch(() => {});
      h.expect((await cards.count()) === 2, 'Try again with storage answering left the gallery without the drawings');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'a-late-open-changes-nothing'(h) {
    for (const answer of ['success', 'error']) {
      await withPage(h, async (page) => {
        const { db, id } = await savedDrawing(h, page);
        await page.reload();
        await h.reachHub(page);
        await page.evaluate((name) => {
          const transaction = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (stores, ...args) {
            if (this.name !== name || ![].concat(stores).includes('strokes')) {
              return transaction.call(this, stores, ...args);
            }
            IDBDatabase.prototype.transaction = transaction;
            throw new DOMException('The connection was lost.', 'InvalidStateError');
          };
          const open = IDBFactory.prototype.open;
          IDBFactory.prototype.open = function (...args) {
            if (args[0] !== name) return open.apply(this, args);
            IDBFactory.prototype.open = open;
            const req = { error: new DOMException('The disk could not be read.', 'NotReadableError') };
            window.__lateOpen = async (answer) => {
              if (answer === 'error') return req.onerror?.(new Event('error'));
              const actual = open.call(indexedDB, name);
              return new Promise((resolve, reject) => {
                actual.onerror = () => reject(actual.error);
                actual.onsuccess = () => {
                  req.result = actual.result;
                  req.onsuccess?.(new Event('success'));
                  try { actual.result.transaction('strokes'); resolve(false); }
                  catch { resolve(true); }
                };
              });
            };
            return req;
          };
        }, db);
        await openDrawing(page, id);
        await panelIn(page, '.dq-draw');
        await comesIn(h, page, '.dq-draw', 'an open that never answers');
        await cantOpenShows(h, page, '.dq-draw', 'drawing', 'an open that never answers');
        await tryAgain(page);
        await drawReady(page);
        await shows(h, page, 1, 'Try again after the open was given up:');
        const closed = await page.evaluate((answer) => window.__lateOpen(answer), answer);
        h.expect(answer !== 'success' || closed, 'a late open left its database connection open');
        await page.evaluate(() => window.__daily.go({ name: 'art' }));
        await routeIs(page, 'art');
        await openDrawing(page, id);
        await drawReady(page);
        await shows(h, page, 1, `after the late open ${answer}:`);
        const note = await page.locator('.dq-tools-msg').textContent();
        h.expect(!note.includes('keeping drawings'), `after the late open ${answer}, the page says ${note}`);
      });
    }
    await pendingOpenSurvivesVisibility(h);
    await unattendedOpenTimesOut(h);
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
        else {
          await neverOpens(page, db);
          await page.evaluate(() => (window.__answer = () => {}));
        }
        await openDrawing(page, id);
        await routeIs(page, 'draw');
        await panelIn(page, '.dq-draw');
        await comesIn(h, page, '.dq-draw', at);
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
    await canceledStoryReadSaysSo(h);
  },
  async 'storage-comes-back-on-its-own'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await storyOfTwo(page);
      await stall(page, 'chapters', 'readonly');
      await writeStory(page, { id: ids.story });
      await panelIn(page, '.st-write');
      await cantOpenShows(h, page, '.st-write', 'story', 'a read that never answers');
      await page.evaluate(() => window.__answer());
      const reads = () => page.evaluate(async (id) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        return (await ss.chapter(id))?.kind ?? null;
      }, ids.notes);
      await h.poll(page, reads, (k) => k === 'notes',
        (k) => `once storage answered again, a read got ${k}, not the notes`, { timeout: WAIT });
      await tryAgain(page);
      await holds(h, page, 'Page, Chapter 1', 'Try again after storage recovered');
      h.expect((await pageText(page)) === 'The lantern woke.', 'the recovered story lost its words');
    });
  },
  async 'writer-opens-after-an-open-error'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await storyOfTwo(page);
      await failNextOpen(page, ids.db);
      await page.reload();
      await h.reachHub(page);
      await writeStory(page, { id: ids.story });
      await panelIn(page, '.st-write');
      await comesIn(h, page, '.st-write', 'a failed story open');
      await cantOpenShows(h, page, '.st-write', 'story', 'a failed story open');
      await alertTakesFocus(h, page, '.st-write', 'a failed story open');
      await tryAgain(page);
      await holds(h, page, 'Page, Chapter 1', 'story after the open recovers');
      h.expect((await pageText(page)) === 'The lantern woke.', 'the recovered story lost its words');
      const state = await page.locator('.st-state').textContent();
      h.expect(state.includes('Saved') && !state.includes('Not saving'), `the recovered writer says ${state}`);
    });
  },
  async 'drawing-opens-after-an-open-error'(h) {
    await withPage(h, async (page) => {
      const { db, id } = await savedDrawing(h, page);
      await failNextOpen(page, db);
      await page.reload();
      await h.reachHub(page);
      await openDrawing(page, id);
      await panelIn(page, '.dq-draw');
      await comesIn(h, page, '.dq-draw', 'a failed drawing open');
      await cantOpenShows(h, page, '.dq-draw', 'drawing', 'a failed drawing open');
      await alertTakesFocus(h, page, '.dq-draw', 'a failed drawing open');
      await tryAgain(page);
      await drawReady(page);
      await shows(h, page, 1, 'drawing after the open recovers:');
      const note = await page.locator('.dq-tools-msg').textContent();
      h.expect(!note.includes('keeping drawings'), `the recovered drawing says ${note}`);
    });
  },
  async 'writer-keeps-words-when-art-never-answers'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const id = await page.evaluate(async (s) => {
        const key = window.__daily.store.key;
        const ss = (await import('/src/daily/storystore.ts')).storyStore(key);
        const as = (await import('/src/daily/artstore.ts')).artStore(key);
        const { story, first } = await ss.create('The Long Night');
        await ss.saveChapter({ ...first, text: 'The lantern woke.' }, [first.rev]);
        await as.put({ id: 'lantern', kind: 'today', day: '2026-10-21', t: 1, updated: 1, n: 1, strokes: [s] });
        await ss.setDrawing(story.id, first.id, 'lantern');
        return story.id;
      }, stroke(200, 500));
      await page.addInitScript(() => {
        const getAll = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function (...args) {
          if (this.name !== 'meta') return getAll.apply(this, args);
          window.__artStalled = true;
          return {};
        };
      });
      await page.reload();
      await h.reachHub(page);
      await writeStory(page, { id });
      await page.waitForFunction(() => window.__artStalled, null, { timeout: 5000 });
      await comesIn(h, page, '.st-write', 'the writer while Art storage never answers', WAIT);
      await holds(h, page, 'Page, Chapter 1', 'the writer while Art storage never answers');
      const ta = page.locator('.st-ta');
      h.expect((await ta.inputValue()) === 'The lantern woke.', 'the writer lost the story words');
      h.expect(await ta.isEditable(), 'the story could not be edited while Art storage never answered');
    });
  },

  async 'writer-read-error-keeps-saving'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await storyOfTwo(page);
      await failNextRead(page, 'chapters');
      await writeStory(page, { id: ids.story });
      await panelIn(page, '.st-write');
      await cantOpenShows(h, page, '.st-write', 'story', 'a failed chapter read');
      await tryAgain(page);
      await holds(h, page, 'Page, Chapter 1', 'the writer after a failed read');
      h.expect((await pageText(page)) === 'The lantern woke.', 'the failed read changed the words');
      const state = await page.locator('.st-state').textContent();
      h.expect(state.includes('Saved') && !state.includes('Not saving'),
        `after a failed read the writer says ${state}`);
    });
  },
  async 'drawing-read-error-keeps-saving'(h) {
    await withPage(h, async (page) => {
      const { id } = await savedDrawing(h, page);
      await page.locator('.dq-top .dq-back').click();
      await routeIs(page, 'art');
      await failNextRead(page, 'strokes');
      await openDrawing(page, id);
      await panelIn(page, '.dq-draw');
      await cantOpenShows(h, page, '.dq-draw', 'drawing', 'a failed drawing read');
      await tryAgain(page);
      await drawReady(page);
      await shows(h, page, 1, 'after a failed drawing read:');
      const note = await page.locator('.dq-tools-msg').textContent();
      h.expect(!note.includes('keeping drawings'), `after a failed read the drawing says ${note}`);
    });
  },

};
