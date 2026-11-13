import * as pageClock from './clock.mjs';

const NO_ANSWER = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: undefined };

export const neverOpens = (page, db) =>
  page.evaluate(
    ([db, req]) => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...a) {
        if (a[0] !== db) return open.apply(this, a);
        IDBFactory.prototype.open = open;
        const r = { ...req, error: new DOMException('The disk could not be read.', 'NotReadableError') };
        window.__failOpen = () => r.onerror?.(new Event('error'));
        window.__succeedOldOpen = () => new Promise((resolve, reject) => {
          const real = open.call(indexedDB, db);
          real.onerror = () => reject(real.error);
          real.onsuccess = () => {
            r.result = real.result;
            r.onsuccess?.(new Event('success'));
            try { real.result.transaction('drafts'); resolve(false); }
            catch { resolve(true); }
          };
        });
        return r;
      };
    },
    [db, NO_ANSWER],
  );

export async function prepareDraftClock(page) {
  await page.evaluate(async () => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    await as.claimTab().ready;
    await as.list();
  });
  await pageClock.install(page);
  await pageClock.pauseClock(page);
  return page.evaluate(() => Date.now());
}

export async function failDraftNearLimit(h, page, started) {
  await pageClock.fastForward(page, 8500);
  const pending = await page.evaluate(() => !!window.__draftTransaction && window.__draftErrorReady?.() &&
    !window.__draftExpired && !document.querySelector('.dq-draw .dq-cant-t'));
  h.expect(pending, 'the draft read did not remain pending until the failure');
  await page.evaluate(() => window.__failDraft());
  await pageClock.fastForward(page, 3999);
  const result = await page.evaluate((start) => ({
    elapsed: Date.now() - start,
    shown: !!document.querySelector('.dq-draw .dq-cant-t'),
  }), started);
  h.expect(result.shown && result.elapsed < 12500, `the drawing page had no panel at ${result.elapsed} ms`);
  await pageClock.resume(page);
}

async function advanceOpenTo(h, page, field, elapsed) {
  const current = await page.evaluate((field) => ({ start: window[field], now: Date.now() }), field);
  const passed = current.now - current.start;
  h.expect(Number.isFinite(current.start) && passed >= 0 && passed <= elapsed, `${field} was not pending in time`);
  await pageClock.fastForward(page, elapsed - passed);
}

export async function pendingWriteSurvivesUnrelatedReadFailure(h, { withPage, storyOfTwo, onDisk }) {
  await withPage(h, async (page) => {
    await h.reachHub(page);
    const ids = await storyOfTwo(page);
    const chapter = await page.evaluate(async (id) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const story = await ss.story(id);
      return ss.chapter(story.chapters[0]);
    }, ids.story);
    await page.evaluate(async () => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        if (this.name !== 'chapters' || args[0] !== 'held-unrelated-read') return get.apply(this, args);
        IDBObjectStore.prototype.get = get;
        const req = { error: new DOMException('The disk could not be read.', 'NotReadableError') };
        window.__failUnrelatedRead = () => req.onerror?.(new Event('error'));
        return req;
      };
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      window.__unrelatedRead = ss.chapter('held-unrelated-read');
    });
    await page.waitForFunction(() => !!window.__failUnrelatedRead, null, { timeout: 5000 });
    await page.evaluate((name) => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== name || mode !== 'readonly' || ![].concat(stores).includes('stories')) {
          return transaction.call(this, stores, mode, ...rest);
        }
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
          window.__releaseHealthyOpen = () => held.onsuccess?.(new Event('success'));
        };
        return held;
      };
    }, ids.db);
    await page.evaluate(async (id) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      window.__healthyRead = ss.story(id);
    }, ids.story);
    await page.waitForFunction(() => !!window.__releaseHealthyOpen, null, { timeout: 5000 });
    await page.evaluate(async (chapter) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      window.__writeDone = false;
      window.__waitingWrite = ss.saveChapter({ ...chapter, text: 'Saved after visibility.' }, [chapter.rev])
        .then((result) => { window.__writeDone = true; return result; });
    }, chapter);
    h.expect(!(await page.evaluate(() => window.__writeDone)), 'the write did not wait on the reconnect');
    await page.evaluate(async () => {
      window.__failUnrelatedRead();
      await window.__unrelatedRead;
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      window.__releaseHealthyOpen();
    });
    const result = await page.evaluate(async () => {
      const [, write] = await Promise.all([window.__healthyRead, window.__waitingWrite]);
      return write.stored;
    });
    const stored = await onDisk(page, ids.db, 'chapters', 'get', chapter.id);
    h.expect(result === 'wrote' && stored?.text === 'Saved after visibility.',
      `a pending write returned ${result} and stored ${JSON.stringify(stored?.text)}`);
  });
}

export async function openRetriesGetOwnDeadline(h, { withPage, onDisk, stroke }) {
  await withPage(h, async (page) => {
    await h.reachHub(page);
    const db = await page.evaluate(async () => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      await as.list();
      return as.name;
    });
    await page.addInitScript((name) => {
      const open = IDBFactory.prototype.open;
      let count = 0;
      IDBFactory.prototype.open = function (...args) {
        if (args[0] !== name) return open.apply(this, args);
        const req = { error: new DOMException('The connection was lost.', 'UnknownError') };
        if (++count === 1) {
          window.__firstOpenAt = Date.now();
          window.__firstOpen = req;
        }
        else {
          window.__secondOpenAt = Date.now();
          window.__secondOpen = req;
          IDBFactory.prototype.open = open;
        }
        return req;
      };
    }, db);
    await pageClock.install(page);
    await page.reload();
    await h.reachHub(page);
    await pageClock.pauseClock(page);
    await page.evaluate(async (s) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      window.__writeDone = false;
      const draft = { key: 'today:retry-deadline', kind: 'today', strokes: [s], t: Date.now() };
      window.__deadlineWrite = as.putDraft(draft).then(() => (window.__writeDone = true));
    }, stroke(100, 200));
    const first = await page.evaluate(() => typeof window.__firstOpen?.onerror === 'function');
    h.expect(first, 'the first open was not held');
    await advanceOpenTo(h, page, '__firstOpenAt', 8500);
    await page.evaluate(() => window.__firstOpen.onerror(new Event('error')));
    const second = await page.evaluate(() => typeof window.__secondOpen?.onerror === 'function');
    h.expect(second, 'the second open did not start');
    await advanceOpenTo(h, page, '__secondOpenAt', 2000);
    h.expect(!(await page.evaluate(() => window.__writeDone)), 'the second open inherited the first open’s deadline');
    await advanceOpenTo(h, page, '__secondOpenAt', 9900);
    h.expect(!(await page.evaluate(() => window.__writeDone)), 'the second open ended before its own deadline');
    await advanceOpenTo(h, page, '__secondOpenAt', 10100);
    h.expect(await page.evaluate(() => window.__writeDone), 'the second open did not end at its own deadline');
    const persistent = await page.evaluate(async () => {
      await window.__deadlineWrite;
      return (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).persistent;
    });
    h.expect(!persistent, 'a write waiting on the second timed-out open said it was saved');
    const saved = await onDisk(page, db, 'drafts', 'get', 'today:retry-deadline');
    h.expect(!saved, 'a write waiting on timed-out opens changed storage');
  });
}

export async function readTimeoutKeepsPendingOpen(h, { withPage, storyOfTwo, onDisk }) {
  await withPage(h, async (page) => {
    await h.reachHub(page);
    const ids = await storyOfTwo(page);
    const chapter = await page.evaluate(async (id) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const story = await ss.story(id);
      return ss.chapter(story.chapters[0]);
    }, ids.story);
    await pageClock.install(page);
    await pageClock.pauseClock(page);
    await page.evaluate(async (id) => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        if (this.name !== 'stories' || args[0] !== id) return get.apply(this, args);
        IDBObjectStore.prototype.get = get;
        const req = { error: new DOMException('The connection was lost.', 'InvalidStateError') };
        window.__failHeldRead = () => req.onerror?.(new Event('error'));
        return req;
      };
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      window.__oldReadDone = false;
      window.__oldRead = ss.story(id).then((result) => { window.__oldReadDone = true; return result; });
    }, ids.story);
    const readStarted = await page.evaluate(() => !!window.__failHeldRead);
    h.expect(readStarted, 'the original story read did not start');
    await page.evaluate((name) => {
      const open = IDBFactory.prototype.open;
      window.__openReady = new Promise((resolve) => (window.__openReadyResolve = resolve));
      IDBFactory.prototype.open = function (...args) {
        if (args[0] !== name) return open.apply(this, args);
        IDBFactory.prototype.open = open;
        const real = open.apply(this, args);
        const held = {};
        real.onerror = () => { held.error = real.error; held.onerror?.(new Event('error')); };
        real.onsuccess = () => {
          held.result = real.result;
          window.__releasePendingOpen = () => held.onsuccess?.(new Event('success'));
          window.__openReadyResolve();
        };
        return held;
      };
    }, ids.db);
    await pageClock.fastForward(page, 8500);
    await page.evaluate(async () => { window.__failHeldRead(); await window.__openReady; });
    await page.evaluate(async (chapter) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      window.__writeDone = false;
      window.__pendingWrite = ss.saveChapter({ ...chapter, text: 'Saved after the read timed out.' }, [chapter.rev])
        .then((result) => { window.__writeDone = true; return result; });
    }, chapter);
    await pageClock.fastForward(page, 2000);
    const waiting = await page.evaluate(async () => {
      await window.__oldRead;
      return { readDone: window.__oldReadDone, writeDone: window.__writeDone };
    });
    h.expect(waiting.readDone && !waiting.writeDone, 'a read timeout ended a write waiting on a newer open');
    await page.evaluate(() => window.__releasePendingOpen());
    const result = await page.evaluate(async () => (await window.__pendingWrite).stored);
    const stored = await onDisk(page, ids.db, 'chapters', 'get', chapter.id);
    h.expect(result === 'wrote' && stored?.text === 'Saved after the read timed out.',
      `the pending write returned ${result} and stored ${JSON.stringify(stored?.text)}`);
  });
}
