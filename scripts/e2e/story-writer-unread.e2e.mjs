import fs from 'node:fs';
import { holdStorage, ready, routeIs, seed } from './story-reading.e2e.mjs';

export const scenarios = {
  async 'writer-unread-story-retries'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const { story } = await storyStore(window.__daily.store.key).create('A story');
        window.__realGet = IDBObjectStore.prototype.get;
        window.__failRead = () => {
          IDBObjectStore.prototype.get = function (key) {
            if (this.name === 'stories' && this.transaction.mode === 'readonly') {
              throw new DOMException('Read failed', 'NotReadableError');
            }
            return window.__realGet.call(this, key);
          };
        };
        return story.id;
      });
      await page.evaluate(() => window.__failRead());
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
      const error = page.getByText(/Can.t open this story right now/);
      await error.waitFor({ timeout: 3000 }).catch(() => {});
      h.expect(await error.isVisible(), 'the writer called an unreadable story gone');
      h.expect(!(await page.getByText(/This story isn.t on this device any more/).isVisible()),
        'the writer said an unreadable story was gone');
      h.expect(!(await page.locator('.st-cw').isVisible()), 'the co-writer stayed visible');
      const held = await holdStorage(page, ['story']);
      await page.getByRole('button', { name: 'Try again' }).click();
      await held.waitHeld('story ' + id);
      await page.evaluate(() => {
        window.__lateWriter = document.querySelector('.st-write');
        window.__daily.go({ name: 'hub' });
      });
      await routeIs(page, 'hub');
      await page.evaluate(() => {
        window.__lateChanges = 0;
        window.__lateObserver = new MutationObserver((changes) => { window.__lateChanges += changes.length; });
        window.__lateObserver.observe(window.__lateWriter, { childList: true, subtree: true, characterData: true });
      });
      await held.drain();
      await page.evaluate(() => { IDBObjectStore.prototype.get = window.__realGet; });
      h.expect(await page.evaluate(() => window.__lateChanges === 0),
        'a late writer retry changed the abandoned screen');
      h.expect(await page.evaluate(() => window.__daily.route.name === 'hub'),
        'a late writer retry reopened the story');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'writer-unread-first-page-retries'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story } = await ss.create('Empty story');
        await ss.saveStory({ ...story, chapters: [] }, [story.rev]);
        ss.__addChapter = ss.addChapter;
        ss.addChapter = () => { throw new DOMException('Read failed', 'NotReadableError'); };
        return story.id;
      });
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
      const error = page.getByText(/Can.t open this story right now/);
      await error.waitFor({ timeout: 3000 }).catch(() => {});
      h.expect(await error.isVisible(), 'a throwing first page did not show the writer error');
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.getByText(/Still can.t open it/).waitFor();
      h.expect(await page.getByRole('button', { name: 'Try again' }).isEnabled() &&
        (await page.getByRole('button', { name: 'Try again' }).getAttribute('aria-disabled')) !== 'true',
      'a failed writer retry stayed busy');
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        ss.addChapter = ss.__addChapter;
      });
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'writer-deleted-story-can-be-exported'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        navigator.share = async (data) => { window.__shared = data.text; };
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Kept open');
        await ss.saveChapter({ ...first, text: 'Words on the open page.' }, [first.rev]);
        return story.id;
      });
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      const other = await ctx.newPage();
      await other.goto(page.url());
      await ready(other);
      await other.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        await ss.remove(id);
        await ss.deleteForever(id);
      }, id);
      await other.close();
      await page.getByRole('button', { name: 'More', exact: true }).click();
      const pending = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
      await page.getByRole('menuitem', { name: 'Download story' }).click();
      const download = await pending;
      h.expect(!!download, 'a deleted story could not download its open page');
      const text = fs.readFileSync(await download.path(), 'utf8');
      h.expect(text.includes('Words on the open page.'), 'the download lost the open page');
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
      await page.waitForFunction(() => !!window.__shared);
      h.expect(await page.evaluate(() => window.__shared.includes('Words on the open page.')),
        'the shared story lost the open page');
      h.expect(!(await page.getByText(/Can.t share this story as text right now/).isVisible()),
        'a deleted story was called unreadable');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'writer-memory-and-gone-stories'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const gone = (await ss.create('Gone')).story.id;
        await ss.remove(gone);
        await ss.deleteForever(gone);
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'stories') throw new DOMException('Write failed', 'NotReadableError');
          return put.apply(this, args);
        };
        const { story } = await ss.create('Held here');
        IDBObjectStore.prototype.put = put;
        const db = await ss.db;
        const disk = await new Promise((resolve, reject) => {
          const request = db.transaction('stories').objectStore('stories').get(story.id);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error);
        });
        return { gone, memory: story.id, disk };
      });
      h.expect(ids.disk === null, 'the memory-only story was unexpectedly saved on disk');
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.memory);
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      await page.waitForFunction(() => document.querySelector('.st-title')?.value === 'Held here');
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.gone);
      await page.getByText(/This story isn.t on this device any more/).waitFor();
      h.expect((await page.getByRole('button', { name: 'Try again' }).count()) === 0,
        'a gone story offered a retry');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

};
