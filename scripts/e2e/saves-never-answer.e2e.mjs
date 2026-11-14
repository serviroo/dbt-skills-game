import { seed, routeIs } from './back-to-the-same-page.e2e.mjs';
import {
  comesIn, holds, writeStory, WAIT, onDisk, savedDrawing, neverOpens, storyOfTwo, withPage, pageText,
} from './storage-never-answers.e2e.mjs';
import { stallWrite, storyWithNoPages, firstPageKept, holdStores } from './saves-never-answer-helpers.mjs';
import {
  deleteKeepsWordsAfterReopenFails, drawingDraftTimeoutSaysSo,
  drawingLandingStatusRecovers, drawingReopenStatusRecovers,
} from './storage-write-status.mjs';

export const scenarios = {
  async 'a-memory-only-story-can-be-deleted'(h) {
    const denyStory = (ctx) => ctx.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...args) {
        if (!String(args[0]).endsWith('.story')) return open.apply(this, args);
        window.__storyOpenDenied = true;
        throw new DOMException('Storage is not available.', 'SecurityError');
      };
    });
    const { ctx, page, errors } = await h.open(seed(h), '?mute', undefined, denyStory);
    try {
      await h.reachHub(page);
      const result = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Memory only');
        const mirrored = ss.setLive({ chapter: first.id, text: 'Only here.', bases: [first.rev], t: Date.now() });
        await ss.remove(story.id);
        const before = (await ss.removed()).some((s) => s.id === story.id);
        const beforeMirrors = ss.lives(first.id).length;
        await ss.deleteForever(story.id);
        return {
          blocked: window.__storyOpenDenied, available: typeof indexedDB !== 'undefined', mirrored,
          before, beforeMirrors, after: (await ss.removed()).some((s) => s.id === story.id),
          afterMirrors: ss.lives(first.id).length, chapter: !!(await ss.chapter(first.id)),
        };
      });
      h.expect(result.blocked && result.available && result.mirrored && result.before && result.beforeMirrors === 1,
        `the memory-only story was not ready to delete: ${JSON.stringify(result)}`);
      h.expect(!result.after && result.afterMirrors === 0 && !result.chapter,
        `the memory-only story remained after deletion: ${JSON.stringify(result)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'a-write-follows-the-replacement-open'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const db = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        await ss.create('Before the lost connection');
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== ss.name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException('The connection was lost.', 'InvalidStateError');
        };
        return ss.name;
      });
      await neverOpens(page, db);
      await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        window.__made = ss.create('The replacement open');
      });
      await page.waitForFunction(() => !!window.__failOpen, null, { timeout: 5000 });
      await page.evaluate(async () => (await import('/src/daily/idb-link.ts')).wakeStorage(true));
      const result = await page.evaluate(() => Promise.race([
        window.__made, new Promise((done) => setTimeout(() => done(null), 12000)),
      ]));
      h.expect(!!result, 'the write never followed the replacement open');
      const stories = await onDisk(page, db, 'stories', 'getAll');
      h.expect(!!result && stories.filter((s) => s.title === 'The replacement open').length === 1,
        'the waiting write did not land once on the replacement connection');
    });
  },
  async 'a-write-waits-for-the-open-deadline'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { first } = await ss.create('Before the lost connection');
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== ss.name || mode !== 'readonly') return transaction.call(this, stores, mode, ...rest);
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException('The connection was lost.', 'InvalidStateError');
        };
        return { db: ss.name, first };
      });
      await neverOpens(page, ids.db);
      await page.evaluate(async ({ first }) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        window.__read = ss.chapter(first.id);
      }, ids);
      await page.waitForFunction(() => !!window.__failOpen, null, { timeout: 5000 });
      await page.evaluate(async ({ first }) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        window.__write = ss.saveChapter({ ...first, text: 'Held until the open ends.' }, [first.rev]);
      }, ids);
      const result = await page.evaluate(() => Promise.race([
        window.__write, new Promise((done) => setTimeout(() => done(null), 15000)),
      ]));
      h.expect(!!result, 'the write never finished after the open went unanswered');
      h.expect(result.stored === 'failed', `the unanswered open returned ${result.stored}`);
      await page.evaluate(() => window.__succeedOldOpen());
      const stored = await onDisk(page, ids.db, 'chapters', 'get', ids.first.id);
      h.expect(stored.text === '', 'a write given up on an unanswered open landed later');
    });
  },
  'delete-keeps-words-after-reopen-fails': deleteKeepsWordsAfterReopenFails,
  'drawing-draft-timeout-says-so': drawingDraftTimeoutSaysSo,
  'drawing-landing-status-recovers': drawingLandingStatusRecovers,
  'drawing-reopen-status-recovers': drawingReopenStatusRecovers,
  async 'a-late-write-does-not-hide-another-failure'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { first } = await ss.create('Existing');
        return { db: ss.name, chapter: first.id };
      });
      await holdStores(page, ids.db, ['chapters']);
      await page.evaluate(async (db) => {
        const abort = IDBTransaction.prototype.abort;
        IDBTransaction.prototype.abort = function () {
          if (this.db.name !== db || this.mode !== 'readwrite') return abort.call(this);
          IDBTransaction.prototype.abort = abort;
          window.__abortTried = true;
          throw new DOMException('The transaction is already committing.', 'InvalidStateError');
        };
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        window.__made = ss.createFrom({ title: 'Late', chapters: [{ title: '', text: 'Lands once.' }], notes: '' });
      }, ids.db);
      await page.waitForFunction(() => window.__abortTried, null, { timeout: WAIT });
      await page.evaluate(async ({ db, chapter }) => {
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== db || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException('The disk could not be written.', 'QuotaExceededError');
        };
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        await ss.changeCards(chapter, (cards) => cards);
      }, ids);
      await page.evaluate(() => window.__letGo());
      h.expect(await page.evaluate(() => window.__made), 'the late write did not land');
      const persistent = await page.evaluate(async () =>
        (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key).persistent);
      h.expect(!persistent, 'the late write hid a different failed write');
    });
  },
  async 'a-writer-leaves-no-listener-behind'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await storyOfTwo(page);
      await writeStory(page, { id: ids.story });
      await holds(h, page, 'Page, Chapter 1', 'the story');
      await page.evaluate(() => {
        window.__oldState = document.querySelector('.st-state');
      });
      await page.locator('.dq-top .dq-back').click();
      await page.waitForFunction(() => window.__daily?.route.name !== 'write');
      await page.evaluate(() => {
        window.__oldChanges = 0;
        const observer = new MutationObserver(() => window.__oldChanges++);
        observer.observe(window.__oldState, { childList: true, subtree: true });
      });
      await holdStores(page, ids.db, ['chapters']);
      await page.evaluate(async (db) => {
        const abort = IDBTransaction.prototype.abort;
        IDBTransaction.prototype.abort = function () {
          if (this.db.name !== db || this.mode !== 'readwrite') return abort.call(this);
          IDBTransaction.prototype.abort = abort;
          window.__abortTried = true;
          throw new DOMException('The transaction is already committing.', 'InvalidStateError');
        };
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        window.__made = ss.createFrom({
          title: 'Another Story', chapters: [{ title: '', text: 'A page.' }], notes: '',
        });
      }, ids.db);
      await page.waitForFunction(() => window.__abortTried, null, { timeout: WAIT });
      const changed = await page.evaluate(() => window.__oldChanges);
      h.expect(changed === 0, `the writer left behind a listener that changed its old status ${changed} times`);
      await page.evaluate(() => window.__letGo());
      await page.evaluate(() => window.__made);
    });
  },
  async 'a-failed-delete-keeps-unsaved-words'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Words Still Here');
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== ss.name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException('The disk could not be written.', 'QuotaExceededError');
        };
        const saved = await ss.saveChapter({ ...first, text: 'Words only in memory.' }, [first.rev]);
        await ss.remove(story.id);
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== ss.name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException('The disk could not be written.', 'QuotaExceededError');
        };
        await ss.deleteForever(story.id);
        await ss.putBack(story.id);
        return { story: story.id, saved: saved.stored };
      });
      h.expect(ids.saved === 'failed', 'the earlier save did not fail');
      await writeStory(page, { id: ids.story });
      await holds(h, page, 'Page, Chapter 1', 'the story after a failed delete');
      const text = await pageText(page);
      h.expect(text === 'Words only in memory.', `the failed delete left ${JSON.stringify(text)}`);
    });
  },
  async 'a-cut-off-write-holds-nothing'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const db = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        await ss.create('Before the lost connection');
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== ss.name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException('The connection was lost.', 'InvalidStateError');
        };
        return ss.name;
      });
      await neverOpens(page, db);
      await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        window.__writeDone = false;
        void ss.create('Waits for the connection').then(() => (window.__writeDone = true));
      });
      await page.waitForFunction(() => window.__writeDone, null, { timeout: WAIT });
      const check = await page.evaluate(async () => {
        const c = await import('/src/core/cleared.ts');
        const through = c.holdAll().then((held) => (held.release(), 'through'));
        return Promise.race([through, new Promise((done) => setTimeout(() => done('held'), 5000))]);
      });
      h.expect(check === 'through', 'a write given up held the check Clear game makes first');
      await page.evaluate(() => window.__succeedOldOpen());
      const stories = await onDisk(page, db, 'stories', 'getAll');
      h.expect(!stories.some((s) => s.title === 'Waits for the connection'),
        'a write given up landed after storage opened');
      const persistent = await page.evaluate(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        await ss.create('Storage answered later');
        return ss.persistent;
      });
      h.expect(!persistent, 'a write given up was forgotten when storage answered later');
    });
  },
  async 'a-stuck-save-says-so'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const ids = await storyOfTwo(page);
      await writeStory(page, { id: ids.story });
      await holds(h, page, 'Page, Chapter 1', 'the story');
      await holdStores(page, ids.db, ['stories']);
      await page.evaluate((db) => {
        const abort = IDBTransaction.prototype.abort;
        IDBTransaction.prototype.abort = function () {
          const save = this.mode === 'readwrite' && [...this.objectStoreNames].includes('chapters');
          if (this.db.name !== db || !save) return abort.call(this);
          IDBTransaction.prototype.abort = abort;
          window.__abortTried = true;
          throw new DOMException('The transaction is already committing.', 'InvalidStateError');
        };
      }, ids.db);
      await page.locator('.st-ta').fill('Words on their way.');
      await page.waitForFunction(() => window.__abortTried, null, { timeout: WAIT });
      const state = page.locator('.st-state');
      const stuck = (t) => `a save stuck past the wait shows ${t}`;
      await h.poll(page, () => state.textContent(), (t) => t.startsWith('Not saving'), stuck, { timeout: 3000 });
      await page.locator('.st-ta').press('End');
      await page.keyboard.type(' And more after.');
      await page.evaluate(() => {
        for (const s of ['hidden', 'visible']) {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
          document.dispatchEvent(new Event('visibilitychange'));
        }
      });
      const saving = await page.evaluate(async () => {
        return (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key).persistent;
      });
      h.expect(!saving, 'back at the front, the story said it was saving again while a save was still stuck');
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await page.locator('.st-ta').press('End');
      await page.keyboard.type(' While switching.');
      const shut = await page
        .waitForFunction(() => !!document.querySelector('.st-write .dq-cant'), null, { timeout: WAIT })
        .then(() => true, () => false);
      h.expect(!shut, 'Notes tapped while a save was stuck gave up on the story');
      await page.evaluate(() => window.__letGo());
      await holds(h, page, 'Notes for this story', 'Notes once the stuck save landed');
      await page.getByRole('radio', { name: 'Show: Page' }).click();
      await holds(h, page, 'Page, Chapter 1', 'back to the page');
      await page.locator('.st-ta').press('End');
      await page.keyboard.type(' Next.');
      const all = 'Words on their way. And more after. While switching. Next.';
      const kept = async () => {
        const story = await onDisk(page, ids.db, 'stories', 'get', ids.story);
        const texts = (await onDisk(page, ids.db, 'chapters', 'getAll')).map((c) => c.text);
        return { pages: story.chapters.length, texts };
      };
      const one = (k) => k.pages === 1 && k.texts.filter((t) => t.includes('Words on their way')).length === 1;
      const twice = (k) => `the stuck save and the words after it were stored as ${JSON.stringify(k)}`;
      const k = await h.poll(page, kept, (k) => one(k) && k.texts.includes(all), twice, { timeout: 8000 });
      h.expect(one(k), twice(k));
    });
  },
  async 'a-given-up-delete-keeps-its-place'(h) {
    await withPage(h, async (page) => {
      const { db, id } = await savedDrawing(h, page);
      await page.evaluate(async (id) => {
        const m = await import('/src/daily/artstore.ts');
        const as = m.artStore(window.__daily.store.key);
        as.hide(id, m.revOf(await as.get(id)));
      }, id);
      await holdStores(page, db, ['meta']);
      const finished = await page.evaluate(async (id) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return Promise.race([
          as.remove(id).then(() => true), new Promise((done) => setTimeout(() => done(false), 13000)),
        ]);
      }, id);
      h.expect(finished, 'the drawing removal never finished');
      await page.evaluate(() => window.__letGo());
      await page.reload();
      await h.reachHub(page);
      const there = () =>
        page.evaluate(async (id) => {
          const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
          return { shown: await as.isShown(id), stored: (await as.list()).some((m) => m.id === id) };
        }, id);
      h.expect(!(await there()).shown, 'a removal storage never answered came back after a reload');
      const gone = (t) => `the removal never finished once storage answered: ${JSON.stringify(t)}`;
      await h.poll(page, there, (t) => !t.shown && !t.stored, gone, { timeout: 8000 });
    });
  },
  async 'a-given-up-story-delete-keeps-mirrors'(h) {
    const story = await h.open(seed(h));
    try {
      await h.reachHub(story.page);
      const ids = await story.page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Gone Soon');
        ss.setLive({ chapter: first.id, text: 'Words not saved yet.', bases: [first.rev], t: Date.now() });
        await ss.remove(story.id);
        return { db: ss.name, story: story.id, ch: first.id };
      });
      await holdStores(story.page, ids.db, ['cards']);
      const mirrors = await story.page.evaluate(async ([sid, ch]) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        return Promise.race([
          ss.deleteForever(sid).then(() => ss.lives(ch).length),
          new Promise((done) => setTimeout(() => done(-1), 13000)),
        ]);
      }, [ids.story, ids.ch]);
      h.expect(mirrors === 1, `a delete storage never answered threw away the words not saved yet (${mirrors} left)`);
      await story.page.evaluate(() => window.__letGo());
      h.expect(!story.errors.length, story.errors.join('\n'));
    } finally {
      await story.ctx.close();
    }
  },
  async 'a-given-up-partway-delete-keeps-mirrors'(h) {
    const partway = await h.open(seed(h));
    try {
      await h.reachHub(partway.page);
      const ids = await partway.page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Gone Soon');
        ss.setLive({ chapter: first.id, text: 'Words not saved yet.', bases: [first.rev], t: Date.now() });
        await ss.remove(story.id);
        return { db: ss.name, story: story.id, ch: first.id };
      });
      await partway.page.evaluate(() => {
        const del = IDBObjectStore.prototype.delete;
        IDBObjectStore.prototype.delete = function (...a) {
          if (this.name !== 'stories') return del.apply(this, a);
          IDBObjectStore.prototype.delete = del;
          window.__partway = true;
          const store = this;
          const spin = () => {
            try {
              store.get('held').onsuccess = spin;
            } catch {
              return;
            }
          };
          spin();
          return {};
        };
      });
      const mirrors = await partway.page.evaluate(async ([sid, ch]) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        return Promise.race([
          ss.deleteForever(sid).then(() => ss.lives(ch).length),
          new Promise((done) => setTimeout(() => done(-1), 13000)),
        ]);
      }, [ids.story, ids.ch]);
      h.expect(await partway.page.evaluate(() => !!window.__partway), 'the delete never got as far as its chapters');
      h.expect(mirrors >= 0, 'the partway delete never finished');
      const kept = await onDisk(partway.page, ids.db, 'chapters', 'get', ids.ch);
      h.expect(!!kept && mirrors === 1, `a delete given up partway left ${mirrors} unsaved copies, chapter ${!!kept}`);
      h.expect(!partway.errors.length, partway.errors.join('\n'));
    } finally {
      await partway.ctx.close();
    }
  },
  async 'a-late-write-is-not-lost'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const db = await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        return ss.name;
      });
      await holdStores(page, db, ['chapters']);
      await page.evaluate((db) => {
        const abort = IDBTransaction.prototype.abort;
        IDBTransaction.prototype.abort = function () {
          if (this.db.name !== db || this.mode !== 'readwrite') return abort.call(this);
          IDBTransaction.prototype.abort = abort;
          window.__abortTried = true;
          throw new DOMException('The transaction is already committing.', 'InvalidStateError');
        };
      }, db);
      await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const story = { title: 'Late Night', chapters: [{ title: '', text: 'It landed.' }], notes: '' };
        window.__made = ss.createFrom(story);
      });
      await page.waitForFunction(() => window.__abortTried, null, { timeout: WAIT });
      await page.evaluate(() => window.__letGo());
      const made = await page.evaluate(async () => !!(await window.__made));
      const stories = await onDisk(page, db, 'stories', 'getAll');
      const late = stories.filter((s) => s.title === 'Late Night').length;
      h.expect(late === 1, `a write that was already landing left ${late} copies of the story`);
      h.expect(made, 'a write that landed after the wait was told it failed, so trying again makes a second copy');
      const persistent = await page.evaluate(async () =>
        (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key).persistent);
      h.expect(persistent, 'a write that landed left saving switched off');
    });
  },
  async 'storage-answers-too-late'(h) {
    await withPage(h, async (page) => {
      await h.reachHub(page);
      const { db, id } = await storyWithNoPages(page);
      await holdStores(page, db, ['chapters']);
      await writeStory(page, { id });
      await routeIs(page, 'write');
      await firstPageKept(h, page, db, id, '__letGo');
    });
  },
  async 'writer-first-page-never-answers'(h) {
    await withPage(h, async (firstPage) => {
      await h.reachHub(firstPage);
      const { db, id } = await storyWithNoPages(firstPage);
      await stallWrite(firstPage, 'stories');
      await writeStory(firstPage, { id });
      await routeIs(firstPage, 'write');
      await firstPageKept(h, firstPage, db, id, '__answer');
    });
  },
};
