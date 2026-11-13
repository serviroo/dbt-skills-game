import { holdStorage, letIn, opening, seed, shownIn, storedIs, ta } from './story-reading.e2e.mjs';

export const scenarios = {
  async 'story-stays-hidden-after-opening-code-fault'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('The Real Title');
        await ss.saveChapter({ ...first, text: 'The real page.' }, [first.rev]);
        window.__realStory = ss.story;
        ss.story = () => { throw new Error('story opening code fault'); };
        return story.id;
      });
      const fault = page.waitForEvent('pageerror', { timeout: 5000 });
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
      h.expect((await fault).message === 'story opening code fault', 'the opening fault did not reach the page');
      await page.evaluate(() => {
        const seen = (window.__failedOpening = { shown: false });
        const tick = () => {
          const writer = document.querySelector('.st-write');
          if (!writer || !writer.inert || getComputedStyle(writer).visibility !== 'hidden') seen.shown = true;
          seen.raf = requestAnimationFrame(tick);
        };
        seen.raf = requestAnimationFrame(tick);
      });
      await h.frames(page, 10);
      h.expect(await opening(page), 'the writer came in after the opening fault');
      h.expect(await page.evaluate(() => {
        cancelAnimationFrame(window.__failedOpening.raf);
        return !window.__failedOpening.shown;
      }), 'the writer was shown during the ten frames after the opening fault');
      const title = page.locator('.st-write .st-title');
      try {
        await title.click({ force: true, timeout: 3000 });
      } catch (error) {
        if (!/not visible/i.test(error.message)) throw error;
      }
      await page.keyboard.type('A different title');
      h.expect((await title.inputValue()) === '', 'the hidden title accepted typing');
      const saved = await page.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        ss.story = window.__realStory;
        return (await ss.story(id)).title;
      }, id);
      h.expect(saved === 'The Real Title', `the stored title changed to ${JSON.stringify(saved)}`);
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
      await h.poll(page, () => title.inputValue(), (value) => value === 'The Real Title', 'the title did not reopen');
      await h.poll(page, () => ta(page).inputValue(), (value) => value === 'The real page.', 'the page did not reopen');
      h.expect(errors.length === 1 && errors[0] === 'pageerror: story opening code fault', errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'story-notes-out-of-reach-until-the-story-opens'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const { id, chapters, bare } = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story } = await ss.create('Two Doors');
        await ss.addChapter(story.id, 'Second Door');
        const empty = await ss.create('No Pages Yet');
        await ss.removeChapter(empty.story.id, empty.first.id);
        return { id: story.id, chapters: (await ss.story(story.id)).chapters, bare: empty.story.id };
      });
      const held = await holdStorage(page, ['story']);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
      await held.waitHeld(`story ${id}`);
      h.expect(await opening(page), 'the writer came in before the story was read');
      await page.getByRole('radio', { name: 'Show: Notes', includeHidden: true })
        .click({ force: true, timeout: 3000 }).catch(() => {});
      await letIn(page);
      const actual = await page.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        return (await ss.__real.story.call(ss, id)).chapters;
      }, id);
      h.expect(JSON.stringify(actual) === JSON.stringify(chapters),
        `story chapters changed: ${JSON.stringify(actual)}`);
      let shown = await shownIn(page);
      h.expect(shown.seg === 'Page' && shown.box === 'Page, Chapter 1',
        `a Notes tap while opening showed ${JSON.stringify(shown)}`);
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await h.poll(page, () => shownIn(page), (s) => s.box === 'Notes for this story', 'Notes did not open');
      const slow = await holdStorage(page, ['story', 'addChapter']);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), bare);
      await slow.waitHeld(`story ${bare}`);
      await slow.release(`story ${bare}`);
      await slow.waitHeld(`addChapter ${bare}`);
      h.expect(await opening(page), 'the writer came in before the first page was made');
      await page.getByRole('radio', { name: 'Show: Notes', includeHidden: true })
        .click({ force: true, timeout: 3000 }).catch(() => {});
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        ss.story = ss.__real.story;
      });
      await letIn(page);
      shown = await shownIn(page);
      h.expect(shown.seg === 'Page' && shown.box === 'Page, Chapter 1',
        `a Notes tap while making the first page showed ${JSON.stringify(shown)}`);
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await h.poll(page, () => shownIn(page), (s) => s.box === 'Notes for this story', 'Notes did not open');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'story-page-after-first-page-make-fails'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('No Pages Yet');
        await ss.removeChapter(story.id, first.id);
        const add = ss.addChapter;
        ss.addChapter = function (...args) {
          if (window.__failFirstPage) throw new Error('Cannot make page');
          return add.apply(this, args);
        };
        window.__failFirstPage = true;
        return story.id;
      });
      const held = await holdStorage(page, ['addChapter']);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
      await held.waitHeld(`addChapter ${id}`);
      h.expect(await opening(page), 'the writer came in before the first page was made');
      await held.drain();
      await page.waitForFunction(() => {
        const panel = document.querySelector('.dq-cant');
        return panel && !panel.closest('[inert]');
      });
      const panel = page.locator('.dq-cant');
      h.expect(await panel.getByText('Can’t open this story right now').isVisible(), 'wrong error shown');
      h.expect(await panel.locator('.dq-cant-t').evaluate((el) => document.activeElement === el),
        'failed page heading was not focused');
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        ss.addChapter = ss.__real.addChapter;
      });
      const firstHeading = await panel.locator('.dq-cant-t').elementHandle();
      await panel.getByRole('button', { name: 'Try again' }).click();
      await page.waitForFunction((old) => !old.isConnected, firstHeading);
      await page.waitForFunction(() => {
        const panel = document.querySelector('.dq-cant');
        return panel && !panel.closest('[inert]');
      });
      h.expect(await panel.getByText('Can’t open this story right now').isVisible(), 'retry showed the wrong error');
      h.expect(await panel.locator('.dq-cant-t').evaluate((el) => document.activeElement === el),
        'failed page retry heading was not focused');
      await page.evaluate(() => { window.__failFirstPage = false; });
      await panel.getByRole('button', { name: 'Try again' }).click();
      await h.poll(page, () => shownIn(page), (s) => /^Page,/.test(s.box ?? ''), 'retry did not open a page');
      await ta(page).fill('The first line after retry.');
      await storedIs(h, page, 'The first line after retry.', 'after retry');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'story-typing-before-the-first-page-opens-lands-nowhere'(h) {
    for (const way of ['page', 'title', 'search']) {
      const { ctx, page, errors } = await h.open(seed(h));
      try {
        await h.reachHub(page);
        const ids = await page.evaluate(async () => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const ss = storyStore(window.__daily.store.key);
          const { story, first } = await ss.create('Two Doors');
          const second = await ss.addChapter(story.id, 'Second Door');
          for (const chapter of [first, second, await ss.chapter(story.notes)]) {
            await ss.saveChapter({ ...chapter, text: 'Words already on this page' }, [chapter.rev]);
          }
          return { id: story.id, first: first.id, second: second.id, notes: story.notes };
        });
        const held = await holdStorage(page, [way === 'title' ? 'story' : 'chapter']);
        await page.evaluate((r) => window.__daily.go(r), {
          name: 'write', id: ids.id, ...(way === 'search' ? { ch: ids.notes } : {}),
        });
        await held.waitHeld(`${way === 'title' ? 'story' : 'chapter'} ${way === 'title' ? ids.id :
          way === 'search' ? ids.notes : ids.first}`);
        h.expect(await opening(page), `${way}: the writer came in before the read finished`);
        const box = ta(page);
        const title = page.locator('.st-title');
        await box.click({ force: true, timeout: 3000 }).catch(() => {});
        await page.keyboard.type(' page words');
        if (way === 'title') {
          await title.click({ force: true, timeout: 3000 }).catch(() => {});
          await page.keyboard.type(' title words');
        }
        await letIn(page);
        const after = await box.inputValue();
        h.expect(after === 'Words already on this page', `${way}: opening changed the page: ${after}`);
        h.expect(await title.inputValue() === 'Two Doors', `${way}: opening changed the title`);
        const disk = await page.evaluate(async ({ id, first, second, notes }) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const ss = storyStore(window.__daily.store.key);
          const db = await ss.db;
          const title = await new Promise((resolve, reject) => {
            const request = db.transaction('stories').objectStore('stories').get(id);
            request.onsuccess = () => resolve(request.result?.title);
            request.onerror = () => reject(request.error);
          });
          return {
            title,
            texts: await Promise.all([first, second, notes].map(async (ch) => (await ss.onDisk(ch))?.text)),
          };
        }, ids);
        h.expect(disk.title === 'Two Doors' && disk.texts.every((text) => text === 'Words already on this page'),
          `${way}: opening stored extra words: ${JSON.stringify(disk)}`);
        await box.fill('Words after opening');
        const opened = way === 'search' ? ids.notes : ids.first;
        await h.poll(page, () => page.evaluate(async (id) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          return (await storyStore(window.__daily.store.key).onDisk(id))?.text;
        }, opened), (text) => text === 'Words after opening', `${way}: opened words were not stored`);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        h.expect(await box.inputValue() === after, `${way}: Undo did not restore the open page`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },
  async 'story-missing-first-page-opens-the-next'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      for (const way of ['second', 'none', 'notes']) {
        const hasSecond = way !== 'none';
        const { id, notes } = await page.evaluate(async (more) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const ss = storyStore(window.__daily.store.key);
          const { story, first } = await ss.create('Missing Door');
          if (more) {
            const second = await ss.addChapter(story.id, 'Second Door');
            await ss.saveChapter({ ...second, text: 'The second door opens.' }, [second.rev]);
          }
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(`${window.__daily.store.key}.story`);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          await new Promise((resolve, reject) => {
            const tx = db.transaction('chapters', 'readwrite');
            tx.objectStore('chapters').delete(first.id);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          db.close();
          return { id: story.id, notes: story.notes };
        }, hasSecond);
        const route = { name: 'write', id, ...(way === 'notes' ? { ch: notes } : {}) };
        await page.evaluate((r) => window.__daily.go(r), route);
        if (way === 'notes') {
          await h.poll(page, () => shownIn(page), (s) => s.box === 'Notes for this story',
            (s) => `a search result on Notes opened ${JSON.stringify(s)}`, { timeout: 4000 });
          await page.getByRole('radio', { name: 'Show: Page' }).click();
        }
        await h.poll(page, () => shownIn(page), (s) => hasSecond ? s.box === 'Page, Second Door' :
          /^Page,/.test(s.box ?? ''), (s) => `missing page left ${JSON.stringify(s)}`, { timeout: 4000 });
        if (hasSecond) h.expect((await ta(page).inputValue()) === 'The second door opens.', 'second text is missing');
        await ta(page).fill('The open page keeps this.');
        await h.poll(page, () => page.evaluate(async () => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const ss = storyStore(window.__daily.store.key);
          const s = await ss.story(window.__daily.route.id);
          return Promise.all(s.chapters.map(async (id) => (await ss.onDisk(id))?.text));
        }), (texts) => texts.includes('The open page keeps this.'), 'the open page did not save');
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'story-unreadable-first-page-says-so'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('A Door');
        await ss.saveChapter({ ...first, text: 'A light.' }, [first.rev]);
        window.__realGet = IDBObjectStore.prototype.get;
        return story.id;
      });
      let text = 'A light.';
      for (const store of ['chapters', 'stories']) {
        await page.evaluate((name) => {
          IDBObjectStore.prototype.get = function (...args) {
            if (this.name === name && this.transaction.mode === 'readonly') {
              throw new DOMException('Cannot read', 'NotReadableError');
            }
            return window.__realGet.apply(this, args);
          };
        }, store);
        await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
        const panel = page.locator('.dq-cant');
        await h.poll(page, () => panel.isVisible(), Boolean, `unreadable ${store} showed no error`, { timeout: 4000 });
        h.expect(await panel.getByText('Can’t open this story right now').isVisible(), `wrong error for ${store}`);
        h.expect(!(await ta(page).count()) && !(await page.locator('.st-cw').count()), 'the dead editor remains');
        h.expect(await panel.locator('.dq-cant-t').evaluate((el) => document.activeElement === el),
          `unreadable ${store} heading was not focused`);
        const firstHeading = await panel.locator('.dq-cant-t').elementHandle();
        await panel.getByRole('button', { name: 'Try again' }).click();
        await page.waitForFunction((old) => !old.isConnected, firstHeading);
        await h.poll(page, () => panel.isVisible(), Boolean, `unreadable ${store} retry showed no error`);
        h.expect(await panel.locator('.dq-cant-t').evaluate((el) => document.activeElement === el),
          `unreadable ${store} retry heading was not focused`);
        await page.evaluate(() => { IDBObjectStore.prototype.get = window.__realGet; });
        await panel.getByRole('button', { name: 'Try again' }).click();
        await h.poll(page, () => ta(page).inputValue(), (t) => t === text, `retry did not open the page (${store})`);
        text = `A light from ${store}.`;
        await ta(page).fill(text);
        await storedIs(h, page, text, `after retry (${store})`);
        await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
