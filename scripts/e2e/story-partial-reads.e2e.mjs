import fs from 'node:fs';
import { holdStorage, seed } from './story-reading.e2e.mjs';

const routeIs = (page, name) => page.waitForFunction((n) => window.__daily?.route.name === n, name, { timeout: 10000 });

export const scenarios = {
  async 'story-that-cant-be-read-says-so'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Two Doors');
        await ss.saveChapter({ ...first, text: 'The first door.' }, [first.rev]);
        const notesCh = await ss.chapter(story.notes);
        await ss.saveChapter({ ...notesCh, text: 'Notes kept.' }, [notesCh.rev]);
        const second = await ss.addChapter(story.id, 'Second Door');
        await ss.saveChapter({ ...second, text: 'The second door.' }, [second.rev]);
        window.__realGet = IDBObjectStore.prototype.get;
        window.__failRead = (store, key) => {
          IDBObjectStore.prototype.get = function (id) {
            if (this.name === store && this.transaction.mode === 'readonly' && (!key || id === key)) {
              throw new DOMException('Read failed', 'NotReadableError');
            }
            return window.__realGet.call(this, id);
          };
        };
        return { story: story.id, first: first.id, second: second.id, notes: story.notes };
      });
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.story);
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      const restore = () => page.evaluate(() => { IDBObjectStore.prototype.get = window.__realGet; });
      const listError = page.getByText(/Can.t read the chapters right now/);
      const tryAgain = page.getByRole('button', { name: 'Try again' });
      await page.evaluate((id) => window.__failRead('chapters', id), ids.second);
      await page.locator('.st-chbtn').click();
      await listError.waitFor({ timeout: 3000 }).catch(() => {});
      h.expect(await listError.isVisible() && (await page.locator('.st-chrow').count()) === 0,
        'the chapter list showed a partial list');
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        ss.__chapterBeforeThrow = ss.chapter;
        ss.chapter = () => { throw new DOMException('Read failed', 'NotReadableError'); };
      });
      await tryAgain.click();
      await page.getByText(/Still can.t open it/).waitFor();
      h.expect((await tryAgain.getAttribute('aria-disabled')) === 'false', 'a throwing retry stayed busy');
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        ss.chapter = ss.__chapterBeforeThrow;
      });
      await restore();
      await tryAgain.click();
      await page.waitForFunction(() => document.querySelectorAll('.st-chrow').length === 2);
      await page.getByRole('button', { name: 'Close the chapter list' }).click();
      await page.evaluate(async ({ story, second }) => {
        IDBObjectStore.prototype.get = function (id) {
          if (this.name === 'stories') throw new DOMException('Read failed', 'NotReadableError');
          return window.__realGet.call(this, id);
        };
        const { storyStore } = await import('/src/daily/storystore.ts');
        await storyStore(window.__daily.store.key).setDrawing(story, second, 'test-drawing');
      }, ids);
      await page.locator('.st-chbtn').click();
      await listError.waitFor({ timeout: 3000 }).catch(() => {});
      h.expect(await listError.isVisible() && (await page.locator('.st-chrow').count()) === 0,
        'a failed story read showed the chapter list held in memory');
      await restore();
      await tryAgain.click();
      await page.waitForFunction(() => document.querySelectorAll('.st-chrow').length === 2);
      await page.getByRole('button', { name: 'Close the chapter list' }).click();
      await page.evaluate((id) => window.__failRead('chapters', id), ids.second);
      await page.locator('.st-chbtn').click();
      await listError.waitFor();
      await restore();
      const sheetHeld = await holdStorage(page, ['chapter']);
      await tryAgain.click();
      await sheetHeld.waitHeld('chapter ' + ids.second);
      await page.getByRole('button', { name: 'Close the chapter list' }).click();
      await sheetHeld.drain();
      h.expect((await page.locator('.st-chsheet').count()) === 0, 'a late retry reopened the chapter list');
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        ss.chapter = ss.__real.chapter;
      });
      const third = await page.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        return (await storyStore(window.__daily.store.key).addChapter(id, 'Third Door')).id;
      }, ids.story);
      await page.locator('.st-chbtn').click();
      await page.waitForFunction(() => document.querySelectorAll('.st-chrow').length === 3);
      await page.evaluate(async ({ story, first, second, third }) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const s = await ss.story(story);
        await ss.saveStory({ ...s, chapters: [third, first, second] }, [s.rev]);
      }, { ...ids, third });
      await page.getByRole('button', { name: 'Move Chapter 1 down' }).click();
      await h.poll(page, async () => page.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        return (await storyStore(window.__daily.store.key).story(id)).chapters;
      }, ids.story), (order) => order.join() === [third, ids.second, ids.first].join(),
      (order) => `Move moved another chapter: ${JSON.stringify(order)}`, { timeout: 4000, polling: 200 });
      await page.locator('.st-chrow').last().getByRole('button', { name: 'Move Chapter 1 up' }).waitFor();
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const real = ss.story;
        ss.story = async (id, whole) => {
          const s = await real.call(ss, id, whole);
          if (whole && !window.__added) {
            ss.story = real;
            window.__added = (await ss.addChapter(id, 'Fourth Door')).id;
          }
          return s;
        };
      });
      await page.getByRole('button', { name: 'Move Chapter 1 up' }).click();
      await h.poll(page, async () => page.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const order = (await storyStore(window.__daily.store.key).story(id)).chapters;
        return { order, added: window.__added };
      }, ids.story), ({ order, added }) => order.join() === [third, ids.first, ids.second, added].join(),
      ({ order }) => `Move dropped a chapter added meanwhile: ${JSON.stringify(order)}`,
      { timeout: 4000, polling: 200 });
      await page.getByRole('button', { name: 'Close the chapter list' }).click();
      await page.evaluate(async ({ story, third }) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        await ss.removeChapter(story, third);
        await ss.removeChapter(story, window.__added);
      }, { story: ids.story, third });
      await page.evaluate((id) => window.__failRead('chapters', id), ids.second);
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Download story' }).click();
      const shareError = page.getByText(/Can.t share this story as text right now/);
      await shareError.waitFor({ timeout: 3000 }).catch(() => {});
      h.expect(await shareError.isVisible(), 'Share as text did not report the unreadable chapter');
      await restore();
      const pending = page.waitForEvent('download');
      await tryAgain.click();
      const text = fs.readFileSync(await (await pending).path(), 'utf8');
      h.expect(text.includes('The first door.') && text.includes('The second door.'),
        'the download missed a chapter');
      await page.evaluate((id) => window.__failRead('chapters', id), ids.notes);
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Download story' }).click();
      await shareError.waitFor();
      await restore();
      const notesPending = page.waitForEvent('download');
      await tryAgain.click();
      const notesText = fs.readFileSync(await (await notesPending).path(), 'utf8');
      h.expect(notesText.includes('Notes kept.'), 'the download after a Notes retry missed the Notes');
      const missing = await page.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const ch = await ss.addChapter(id, 'Lost Door');
        await ss.saveChapter({ ...ch, text: 'Lost door.' }, [ch.rev]);
        const db = await ss.db;
        await new Promise((resolve, reject) => {
          const tx = db.transaction('chapters', 'readwrite');
          tx.objectStore('chapters').delete(ch.id);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        return ch.id;
      }, ids.story);
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), ids.story);
      await page.getByText('The first door.').waitFor();
      h.expect(!(await page.getByText('Lost door.').isVisible()) &&
        !(await page.getByText(/Can.t open this story right now/).isVisible()),
      'the reader treated a missing chapter as a failed read');
      await page.evaluate(async ({ story, missing }) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        await storyStore(window.__daily.store.key).removeChapter(story, missing);
      }, { story: ids.story, missing });
      await page.getByRole('button', { name: 'Back to writing' }).click();
      await routeIs(page, 'write');
      await page.evaluate((id) => window.__failRead('chapters', id), ids.second);
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), ids.story);
      const storyError = page.getByText(/Can.t open this story right now/);
      await storyError.waitFor({ timeout: 3000 }).catch(() => {});
      h.expect(await storyError.isVisible() && (await page.locator('.st-read-text').count()) === 0,
        'the reader showed a partial story');
      h.expect(await page.locator('.dq-cant-t').evaluate((el) => document.activeElement === el),
        'unreadable reader chapter heading was not focused');
      h.expect(!(await page.locator('.st-read-tools').isVisible()),
        'the reader showed size controls without a story');
      h.expect(!(await page.getByText(/This story isn.t on this device any more/).isVisible()),
        'an unreadable story was called gone');
      await restore();
      await tryAgain.click();
      await page.getByText('The first door.').waitFor();
      await page.getByText('The second door.').waitFor();
      await page.getByRole('button', { name: 'Back to writing' }).click();
      await routeIs(page, 'write');
      await page.evaluate(() => window.__failRead('stories'));
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), ids.story);
      await storyError.waitFor({ timeout: 3000 }).catch(() => {});
      h.expect(await storyError.isVisible(), 'the reader called an unreadable story gone');
      h.expect(await page.locator('.dq-cant-t').evaluate((el) => document.activeElement === el),
        'unreadable reader story heading was not focused');
      h.expect(!(await page.getByText(/This story isn.t on this device any more/).isVisible()),
        'an unreadable story was called gone');
      await restore();
      const held = await holdStorage(page, ['chapter']);
      await tryAgain.click();
      await held.waitHeld('chapter ' + ids.second);
      await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await routeIs(page, 'hub');
      await held.drain();
      h.expect(await page.evaluate(() => window.__daily.route.name === 'hub'), 'a late retry reopened the story');
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        ss.chapter = ss.__real.chapter;
      });
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), ids.story);
      await page.getByText('The second door.').waitFor();
      const memory = await page.evaluate(async () => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'stories' && this.transaction.mode === 'readwrite') {
            throw new DOMException('Write failed', 'NotReadableError');
          }
          return put.apply(this, args);
        };
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Held Here');
        await ss.saveChapter({ ...first, text: 'Kept here.' }, [first.rev]);
        IDBObjectStore.prototype.put = put;
        const db = await ss.db;
        const disk = await new Promise((resolve, reject) => {
          const request = db.transaction('stories').objectStore('stories').get(story.id);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error);
        });
        return { id: story.id, disk };
      });
      h.expect(memory.disk === null, 'the memory-only story was unexpectedly saved on disk');
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), memory.id);
      await page.getByText('Held Here', { exact: true }).waitFor();
      await page.getByText('Kept here.').waitFor();
      await page.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        await storyStore(window.__daily.store.key).remove(id);
      }, ids.story);
      await page.evaluate((id) => window.__daily.go({ name: 'read', id }), ids.story);
      await page.getByText(/This story isn.t on this device any more/).waitFor();
      h.expect((await tryAgain.count()) === 0, 'a gone story offered Try again');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

};
