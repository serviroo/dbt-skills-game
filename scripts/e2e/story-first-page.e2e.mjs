import { holdStorage, seed, shownIn, storedIs, ta } from './story-reading.e2e.mjs';

export const scenarios = {
  async 'story-notes-tapped-before-the-story-is-read-opens-notes'(h) {
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
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await h.poll(page, async () => (await held.drain(), await ta(page).isEditable()), Boolean,
        'the editor did not open', { timeout: 8000, polling: 50 });
      const actual = await page.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        return (await ss.__real.story.call(ss, id)).chapters;
      }, id);
      h.expect(JSON.stringify(actual) === JSON.stringify(chapters),
        `story chapters changed: ${JSON.stringify(actual)}`);
      const shown = await shownIn(page);
      h.expect(shown.seg === 'Notes' && shown.box === 'Notes for this story',
        `a Notes tap before the story was read showed ${JSON.stringify(shown)}`);
      const slow = await holdStorage(page, ['story', 'addChapter']);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), bare);
      await slow.waitHeld(`story ${bare}`);
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await slow.release(`story ${bare}`);
      await slow.waitHeld(`addChapter ${bare}`);
      await h.poll(page, () => shownIn(page), (s) => s.box === 'Notes for this story',
        (s) => `Notes waited for the first page to be made: ${JSON.stringify(s)}`, { timeout: 4000 });
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        ss.story = ss.__real.story;
      });
      await slow.drain();
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'story-page-after-first-page-make-fails'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const { id, notes } = await page.evaluate(async () => {
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
        return { id: story.id, notes: story.notes };
      });
      const held = await holdStorage(page, ['addChapter']);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
      await held.waitHeld(`addChapter ${id}`);
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await h.poll(page, () => shownIn(page), (s) => s.box === 'Notes for this story', 'Notes did not open');
      await ta(page).fill('Notes kept through retry.');
      await held.drain();
      await page.getByRole('radio', { name: 'Show: Page' }).click();
      const panel = page.locator('.dq-cant');
      await h.poll(page, () => panel.isVisible(), Boolean, 'failed page showed no error', { timeout: 4000 });
      h.expect(await panel.getByText('Can’t open this story right now').isVisible(), 'wrong error shown');
      await h.poll(page, () => page.evaluate(async (notes) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        return (await storyStore(window.__daily.store.key).onDisk(notes))?.text;
      }, notes), (text) => text === 'Notes kept through retry.', 'Notes were not stored');
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        window.__failFirstPage = false;
        ss.addChapter = ss.__real.addChapter;
      });
      await panel.getByRole('button', { name: 'Try again' }).click();
      await h.poll(page, () => shownIn(page), (s) => /^Page,/.test(s.box ?? ''), 'retry did not open a page');
      await ta(page).fill('The first line after retry.');
      await storedIs(h, page, 'The first line after retry.', 'after retry');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'story-typing-before-the-first-page-opens-is-kept'(h) {
    for (const way of ['page', 'title', 'notes', 'chapter', 'search']) {
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
        const box = ta(page);
        const title = page.locator('.st-title');
        const tryTyping = async (field, word) => {
          const editable = await field.isEditable();
          await field.click();
          await page.keyboard.type(word);
          return { editable, value: await field.inputValue() };
        };
        const before = await tryTyping(box, ' page words');
        const titleBefore = way === 'title' ? await tryTyping(title, ' title words') : null;
        if (way === 'notes') await page.getByRole('radio', { name: 'Show: Notes' }).click();
        if (way === 'chapter') {
          await page.evaluate(async () => {
            const { storyStore } = await import('/src/daily/storystore.ts');
            const ss = storyStore(window.__daily.store.key);
            ss.chapter = ss.__real.chapter;
          });
          await page.locator('.st-chbtn').click();
          await page.locator('.st-chrow-b', { hasText: 'Second Door' }).click();
        }
        await h.poll(page, async () => (await held.drain(), await box.isEditable()), Boolean,
          `${way}: the page did not open`, { timeout: 8000, polling: 50 });
        const after = await box.inputValue();
        h.expect(!before.editable && (!before.value || after.includes(before.value)),
          `${way}: page accepted words while opening and lost them: ${JSON.stringify(before)} -> ${after}`);
        if (titleBefore) h.expect(!titleBefore.editable && (await title.inputValue()).includes(titleBefore.value),
          `${way}: title accepted words while opening and lost them: ${JSON.stringify(titleBefore)}`);
        await box.fill('Words after opening');
        const opened = way === 'notes' || way === 'search' ? ids.notes : way === 'chapter' ? ids.second : ids.first;
        await h.poll(page, () => page.evaluate(async (id) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          return (await storyStore(window.__daily.store.key).onDisk(id))?.text;
        }, opened), (text) => text === 'Words after opening', `${way}: opened words were not stored`);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        h.expect(after !== '' && await box.inputValue() === after, `${way}: Undo did not restore the open page`);
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
