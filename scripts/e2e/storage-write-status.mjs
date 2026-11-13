import { drawPage, line } from './art-eraser-glow.e2e.mjs';
import { neverOpens, withPage } from './storage-never-answers.e2e.mjs';
import { holdStores } from './saves-never-answer-helpers.mjs';

export async function deleteKeepsWordsAfterReopenFails(h) {
  await withPage(h, async (page) => {
    await h.reachHub(page);
    const ids = await page.evaluate(async () => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const { story, first } = await ss.create('Keep these words');
      const transaction = IDBDatabase.prototype.transaction;
      const failWrite = () => {
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== ss.name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException('The disk could not be written.', 'QuotaExceededError');
        };
      };
      failWrite();
      const saved = await ss.saveChapter({ ...first, text: 'Words in memory.' }, [first.rev]);
      failWrite();
      await ss.changeCards(first.id, () => [{ id: 'held-card', mode: 'continue', text: 'Idea in memory.', t: 1 }]);
      ss.setLive({ chapter: first.id, text: 'Words in the mirror.', bases: [first.rev], t: Date.now() });
      await ss.remove(story.id);
      const removed = await ss.story(story.id);
      failWrite();
      await ss.saveStory({ ...removed, title: 'Story in memory.' }, [removed.rev]);
      return { db: ss.name, story: story.id, chapter: first.id, saved: saved.stored };
    });
    h.expect(ids.saved === 'failed', 'the first chapter save did not fail');
    await neverOpens(page, ids.db);
    await page.evaluate(async ({ db, story }) => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== db || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
        IDBDatabase.prototype.transaction = transaction;
        throw new DOMException('The connection was lost.', 'InvalidStateError');
      };
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      window.__deleting = ss.deleteForever(story);
    }, ids);
    await page.waitForFunction(() => !!window.__failOpen, null, { timeout: 5000 });
    await page.evaluate(() => window.__failOpen());
    const kept = await page.evaluate(async ({ chapter, story }) => {
      await window.__deleting;
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      return {
        memory: ss.unsaved(chapter)?.text, mirrors: ss.lives(chapter).map((l) => l.text),
        story: (await ss.story(story))?.title, cards: (await ss.cards(chapter)).map((c) => c.text),
      };
    }, ids);
    h.expect(kept.memory === 'Words in memory.' && kept.mirrors.includes('Words in the mirror.') &&
      kept.story === 'Story in memory.' && kept.cards.includes('Idea in memory.'),
      `the failed reopen left ${JSON.stringify(kept)}`);
  });
}

export async function drawingDraftTimeoutSaysSo(h) {
  await withPage(h, async (page) => {
    await drawPage(h, page);
    const db = await page.evaluate(async () =>
      (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).name);
    await holdStores(page, db, ['drafts']);
    await page.evaluate(() => {
      window.__savingEvents = 0;
      document.addEventListener('storage-saving-change', () => window.__savingEvents++);
    });
    await line(page, [0.2, 0.3], [0.7, 0.4]);
    const note = page.locator('.dq-tools-msg')
      .getByText('This browser isn’t keeping drawings right now', { exact: false });
    await note.waitFor({ timeout: 15000 }).catch(() => {});
    const state = await page.evaluate(async () => ({
      saving: (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).persistent,
      text: document.querySelector('.dq-tools-msg')?.textContent,
      strokes: window.__daily.ink.strokes.length,
      events: window.__savingEvents,
    }));
    h.expect(await note.isVisible(), `the drawing storage note did not show: ${JSON.stringify(state)}`);
    await line(page, [0.2, 0.5], [0.7, 0.6]);
    h.expect(await note.isVisible(), 'the storage note disappeared while drawing');
    await page.evaluate(() => window.__letGo());
    await page.evaluate(() => { window.__oldDrawingNote = document.querySelector('.dq-tools-msg'); });
    await page.locator('.dq-top .dq-back').click();
    await page.waitForFunction(() => window.__daily?.route.name !== 'draw');
    const changed = await page.evaluate(async () => {
      let count = 0;
      const observer = new MutationObserver(() => count++);
      observer.observe(window.__oldDrawingNote, { childList: true, subtree: true });
      document.dispatchEvent(new Event('storage-saving-change'));
      await new Promise((done) => requestAnimationFrame(done));
      observer.disconnect();
      return count;
    });
    h.expect(changed === 0, 'the drawing page kept listening after leaving');
  });
}

export async function drawingLandingStatusRecovers(h) {
  await withPage(h, async (page) => {
    await drawPage(h, page);
    const db = await page.evaluate(async () =>
      (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).name);
    await holdStores(page, db, ['drafts']);
    await page.evaluate((db) => {
      const abort = IDBTransaction.prototype.abort;
      IDBTransaction.prototype.abort = function () {
        if (this.db.name !== db || this.mode !== 'readwrite') return abort.call(this);
        IDBTransaction.prototype.abort = abort;
        throw new DOMException('The transaction is already committing.', 'InvalidStateError');
      };
    }, db);
    await line(page, [0.2, 0.3], [0.7, 0.4]);
    const note = page.locator('.dq-tools-msg')
      .getByText('This browser isn’t keeping drawings right now', { exact: false });
    await note.waitFor({ timeout: 15000 });
    await page.evaluate(() => window.__letGo());
    await h.poll(page, () => note.count(), (n) => n === 0,
      () => 'the drawing still says it is not saving after the draft landed', { timeout: 8000 });
    const saving = await page.evaluate(async () =>
      (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).persistent);
    h.expect(saving, 'the landed draft did not restore saving');
  });
}

export async function drawingReopenStatusRecovers(h) {
  await withPage(h, async (page) => {
    await drawPage(h, page);
    const db = await page.evaluate(async () =>
      (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key).name);
    await neverOpens(page, db);
    await page.evaluate(async (db) => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== db || mode !== 'readonly') return transaction.call(this, stores, mode, ...rest);
        IDBDatabase.prototype.transaction = transaction;
        throw new DOMException('The connection was lost.', 'InvalidStateError');
      };
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      window.__reading = as.getDraft('today:missing');
    }, db);
    await page.waitForFunction(() => !!window.__failOpen, null, { timeout: 5000 });
    await page.evaluate(() => window.__failOpen());
    await page.evaluate(() => window.__reading);
    const note = page.locator('.dq-tools-msg')
      .getByText('This browser isn’t keeping drawings right now', { exact: false });
    await note.waitFor({ timeout: 5000 });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await h.poll(page, () => note.count(), (n) => n === 0,
      () => 'the drawing still says it is not saving after storage reopened', { timeout: 8000 });
  });
}
