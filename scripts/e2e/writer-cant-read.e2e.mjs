import { seed, shownIn } from './story-reading.e2e.mjs';
import { holdStores } from './saves-never-answer-helpers.mjs';
import { onDisk } from './storage-never-answers.e2e.mjs';

async function make(page, drawing = false) {
  return page.evaluate(async (withDrawing) => {
    const key = window.__daily.store.key;
    const { storyStore } = await import('/src/daily/storystore.ts');
    const ss = storyStore(key);
    const { story, first } = await ss.create('Two doors');
    await ss.saveChapter({ ...first, text: 'The first door.' }, [first.rev]);
    const notes = await ss.chapter(story.notes);
    await ss.saveChapter({ ...notes, text: 'Notes kept.' }, [notes.rev]);
    const second = await ss.addChapter(story.id, 'Second door');
    await ss.saveChapter({ ...second, text: 'The second door.' }, [second.rev]);
    if (withDrawing) {
      const { artStore } = await import('/src/daily/artstore.ts');
      await artStore(key).put({ id: 'door-picture', kind: 'today', day: '2026-10-21', t: 1, updated: 1,
        n: 1, name: 'Door picture', strokes: [{ i: 1, w: 26, p: [100, 100, 200, 200] }] });
      await ss.setDrawing(story.id, first.id, 'door-picture');
    }
    return { id: story.id, first: first.id, second: second.id, notes: story.notes, db: ss.name };
  }, drawing);
}

async function stored(page, ids) {
  return page.evaluate(async ({ id, first, second, notes }) => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    const ss = storyStore(window.__daily.store.key);
    return { story: await ss.story(id), chapters: await Promise.all([first, second, notes].map((c) => ss.onDisk(c))) };
  }, ids);
}

export const scenarios = {
  async 'writer-switch-read-failure-keeps-page-and-says-why'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await make(page);
      const before = await stored(page, ids);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.id);
      const editor = page.getByRole('textbox', { name: 'Page, Chapter 1' });
      await editor.waitFor();
      await editor.fill('The first door. New words for Notes.');
      h.expect((await stored(page, ids)).chapters[0].text === 'The first door.', 'the first edit already saved');
      await page.evaluate((id) => {
        window.__realGet = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (key) {
          if (this.name === 'chapters' && key === id && this.transaction.mode === 'readonly') {
            throw new DOMException('Read failed', 'NotReadableError');
          }
          return window.__realGet.call(this, key);
        };
      }, ids.notes);
      await page.getByRole('radio', { name: 'Notes' }).click();
      await page.getByText("Can't open that right now. Nothing was changed.").waitFor({ timeout: 3000 });
      const shown = await shownIn(page);
      h.expect(shown.seg === 'Page' && shown.box === 'Page, Chapter 1' &&
        shown.text === 'The first door. New words for Notes.',
        `the open page changed: ${JSON.stringify(shown)}`);
      await page.evaluate(() => { IDBObjectStore.prototype.get = window.__realGet; });
      const afterNotes = await stored(page, ids);
      h.expect(afterNotes.chapters[0].text === 'The first door. New words for Notes.' &&
        afterNotes.story.chapters.join() === before.story.chapters.join(), 'the first edit was lost or copied');
      await page.getByRole('radio', { name: 'Notes' }).click();
      const notes = page.getByRole('textbox', { name: 'Notes for this story' });
      await notes.waitFor();
      h.expect(await notes.inputValue() === 'Notes kept.', 'Notes did not open after the read recovered');
      h.expect((await page.locator('.st-note').textContent()) === '', 'the switch warning stayed after Notes opened');
      await page.evaluate((id) => {
        window.__pageReadFails = 0;
        IDBObjectStore.prototype.get = function (key) {
          if (this.name === 'chapters' && key === id && this.transaction.mode === 'readonly') {
            window.__pageReadFails++;
            throw new DOMException('Read failed', 'NotReadableError');
          }
          return window.__realGet.call(this, key);
        };
      }, ids.first);
      h.expect((await page.locator('.st-note').textContent()) === '', 'the Page switch warning was not fresh');
      await page.getByRole('radio', { name: 'Page' }).click();
      await page.waitForFunction(() => window.__pageReadFails > 0);
      await page.getByText("Can't open that right now. Nothing was changed.").waitFor();
      h.expect(await notes.inputValue() === 'Notes kept.', 'a failed read replaced the open Notes');
      await page.evaluate(() => { IDBObjectStore.prototype.get = window.__realGet; });
      await page.getByRole('radio', { name: 'Page' }).click();
      await editor.waitFor();
      h.expect(await editor.inputValue() === 'The first door. New words for Notes.',
        'the page did not open after the read recovered');
      h.expect((await page.locator('.st-note').textContent()) === '', 'the switch warning stayed after Page opened');
      await editor.fill('The first door. New words for the chapter.');
      h.expect((await stored(page, ids)).chapters[0].text === 'The first door. New words for Notes.',
        'the second edit already saved');
      await page.locator('.st-chbtn').click();
      const second = page.locator('.st-chrow-b').filter({ hasText: 'Second door' });
      await second.waitFor();
      await page.evaluate((id) => {
        window.__pageReadFails = 0;
        IDBObjectStore.prototype.get = function (key) {
          if (this.name === 'chapters' && key === id && this.transaction.mode === 'readonly') {
            window.__pageReadFails++;
            throw new DOMException('Read failed', 'NotReadableError');
          }
          return window.__realGet.call(this, key);
        };
      }, ids.second);
      h.expect((await page.locator('.st-note').textContent()) === '', 'the chapter switch warning was not fresh');
      await second.click();
      await page.waitForFunction(() => window.__pageReadFails > 0);
      await page.getByText("Can't open that right now. Nothing was changed.").waitFor({ timeout: 3000 });
      const still = await shownIn(page);
      h.expect(still.seg === 'Page' && still.box === 'Page, Chapter 1' &&
        still.text === 'The first door. New words for the chapter.',
        `the chapter switch replaced the edit: ${JSON.stringify(still)}`);
      await page.evaluate(() => { IDBObjectStore.prototype.get = window.__realGet; });
      const afterChapter = await stored(page, ids);
      h.expect(afterChapter.chapters[0].text === 'The first door. New words for the chapter.' &&
        afterChapter.story.chapters.join() === before.story.chapters.join() &&
        afterChapter.chapters[1].text === 'The second door.' && afterChapter.chapters[2].text === 'Notes kept.',
      'the second edit was lost or copied, or another chapter changed');
      await page.locator('.st-chbtn').click();
      await page.locator('.st-chrow-b').filter({ hasText: 'Second door' }).click();
      const nextPage = page.getByRole('textbox', { name: 'Page, Second door' });
      await nextPage.waitFor();
      h.expect((await page.locator('.st-note').textContent()) === '',
        'the switch warning stayed after the next chapter opened');
      await nextPage.evaluate((box) => {
        const data = new DataTransfer();
        data.setData('text/plain', 'x'.repeat(400001));
        box.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
      });
      const otherNote = await page.locator('.st-note').textContent();
      h.expect(otherNote.includes('the most one chapter can hold'), 'the chapter-full note did not appear');
      await page.getByRole('radio', { name: 'Notes' }).click();
      await notes.waitFor();
      h.expect((await page.locator('.st-note').textContent()) === otherNote, 'switching erased another note');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'writer-stuck-save-and-failed-switch-keep-words'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await make(page);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.id);
      const editor = page.getByRole('textbox', { name: 'Page, Chapter 1' });
      await editor.waitFor();
      await holdStores(page, ids.db, ['stories']);
      await page.evaluate(({ db, notes }) => {
        const abort = IDBTransaction.prototype.abort;
        IDBTransaction.prototype.abort = function () {
          const save = this.mode === 'readwrite' && [...this.objectStoreNames].includes('chapters');
          if (this.db.name !== db || !save) return abort.call(this);
          IDBTransaction.prototype.abort = abort;
          window.__abortTried = true;
          throw new DOMException('The transaction is already committing.', 'InvalidStateError');
        };
        const get = IDBObjectStore.prototype.get;
        window.__failedReads = 0;
        IDBObjectStore.prototype.get = function (key) {
          if (this.name === 'chapters' && this.transaction.mode === 'readonly' && key === notes) {
            window.__failedReads++;
            throw new DOMException('Read failed', 'NotReadableError');
          }
          return get.call(this, key);
        };
      }, ids);
      const words = 'Words held while switching.';
      await editor.fill(words);
      await page.waitForFunction(() => window.__abortTried, null, { timeout: 15000 });
      await page.getByRole('radio', { name: 'Notes' }).click();
      await h.frames(page, 5);
      h.expect(await page.evaluate(() => window.__failedReads) === 0, 'the read ran before the stuck save settled');
      h.expect((await page.locator('.st-note').textContent()) === '', 'the warning appeared before the save settled');
      h.expect(await editor.inputValue() === words, 'the stuck switch changed the open page');
      await page.evaluate(() => window.__letGo());
      await page.getByText("Can't open that right now. Nothing was changed.").waitFor({ timeout: 15000 });
      const shown = await shownIn(page);
      h.expect(shown.seg === 'Page' && shown.box === 'Page, Chapter 1' && shown.text === words,
        `the failed switch lost the open page: ${JSON.stringify(shown)}`);
      const kept = async () => {
        const story = await onDisk(page, ids.db, 'stories', 'get', ids.id);
        const chapters = await onDisk(page, ids.db, 'chapters', 'getAll');
        return { order: story.chapters, matches: chapters.filter((c) => c.text === words).map((c) => c.id) };
      };
      await h.poll(page, kept, (v) => v.order.join() === [ids.first, ids.second].join() &&
        v.matches.length === 1 && v.matches[0] === ids.first,
      (v) => `the held words were stored as ${JSON.stringify(v)}`, { timeout: 8000 });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'writer-picker-recovery-refreshes-drawing-button'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await make(page, true);
      const before = await stored(page, ids);
      await page.reload();
      await page.evaluate(() => {
        window.__realGetAll = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function (...args) {
          if (this.name === 'meta' && this.transaction.mode === 'readonly') {
            throw new DOMException('Read failed', 'NotReadableError');
          }
          return window.__realGetAll.apply(this, args);
        };
      });
      await h.reachHub(page);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.id);
      await page.getByRole('textbox', { name: 'Page, Chapter 1' }).waitFor();
      const button = page.getByRole('button', { name: "Can't show the drawing right now" });
      await button.waitFor({ timeout: 3000 });
      await page.evaluate(() => { IDBObjectStore.prototype.getAll = window.__realGetAll; });
      await button.click();
      const dialog = page.getByRole('dialog', { name: 'Pick a drawing' });
      const pick = dialog.getByRole('button', { name: 'Door picture' });
      await pick.waitFor();
      h.expect(await pick.getAttribute('aria-current') === 'true', 'the existing drawing was not marked current');
      await dialog.getByRole('button', { name: 'Close the drawings' }).click();
      await page.getByRole('button', { name: 'Change drawing, Door picture' }).waitFor({ timeout: 3000 });
      h.expect(JSON.stringify(await stored(page, ids)) === JSON.stringify(before),
        'opening the picker changed the story');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'writer-unlinked-page-while-drawings-cannot-be-read'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await make(page, true);
      const before = await stored(page, ids);
      await page.reload();
      await page.evaluate(() => {
        window.__realGetAll = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function (...args) {
          if (this.name === 'meta' && this.transaction.mode === 'readonly') {
            throw new DOMException('Read failed', 'NotReadableError');
          }
          return window.__realGetAll.apply(this, args);
        };
      });
      await h.reachHub(page);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.id);
      await page.getByRole('button', { name: "Can't show the drawing right now" }).waitFor();
      await page.locator('.st-chbtn').click();
      await page.locator('.st-chrow-b').filter({ hasText: 'Second door' }).click();
      await page.getByRole('textbox', { name: 'Page, Second door' }).waitFor();
      const button = page.getByRole('button', { name: 'Add a drawing' });
      await button.waitFor({ timeout: 3000 });
      await button.click();
      const dialog = page.getByRole('dialog', { name: 'Pick a drawing' });
      await dialog.getByText(/Can.t read your drawings right now/).waitFor();
      h.expect(await dialog.locator('.st-pick').count() === 0, 'an unreadable list offered picks');
      h.expect(await dialog.getByRole('button', { name: 'Remove drawing' }).count() === 0,
        'an unreadable list offered removal');
      h.expect(JSON.stringify(await stored(page, ids)) === JSON.stringify(before),
        'opening the unlinked page changed the story');
      await page.evaluate(() => { IDBObjectStore.prototype.getAll = window.__realGetAll; });
      await dialog.getByRole('button', { name: 'Try again' }).click();
      const pick = dialog.getByRole('button', { name: 'Door picture' });
      await pick.waitFor();
      h.expect(await pick.evaluate((el) => document.activeElement === el), 'retry did not focus the first drawing');
      h.expect(await pick.getAttribute('aria-current') !== 'true', 'an unlinked drawing was marked current');
      h.expect(JSON.stringify(await stored(page, ids)) === JSON.stringify(before), 'retry changed the story');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'writer-drawing-read-failure-offers-retry'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await make(page, true);
      const before = await stored(page, ids);
      await page.reload();
      await page.evaluate(() => {
        window.__realGetAll = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function (...args) {
          if (this.name === 'meta' && this.transaction.mode === 'readonly') {
            throw new DOMException('Read failed', 'NotReadableError');
          }
          return window.__realGetAll.apply(this, args);
        };
      });
      await h.reachHub(page);
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), ids.id);
      await page.getByRole('textbox', { name: 'Page, Chapter 1' }).waitFor();
      const button = page.getByRole('button', { name: "Can't show the drawing right now" });
      await button.waitFor({ timeout: 3000 });
      h.expect(!(await page.getByRole('button', { name: 'Add a drawing' }).count()), 'button claimed no drawing');
      await button.click();
      const dialog = page.getByRole('dialog', { name: 'Pick a drawing' });
      await dialog.getByText(/Can.t read your drawings right now/).waitFor();
      h.expect(await dialog.locator('.st-pick').count() === 0, 'the unreadable list offered picks');
      h.expect(await dialog.getByRole('button', { name: 'Remove drawing' }).count() === 0,
        'the unreadable list offered removal');
      h.expect(JSON.stringify(await stored(page, ids)) === JSON.stringify(before),
        'the drawing link changed on failure');
      await dialog.getByRole('button', { name: 'Try again' }).click();
      await dialog.getByText(/Still can.t open it/).waitFor();
      h.expect(await dialog.locator('.st-pick').count() === 0, 'a failed retry offered picks');
      await page.evaluate(() => { IDBObjectStore.prototype.getAll = window.__realGetAll; });
      await dialog.getByRole('button', { name: 'Try again' }).click();
      const pick = dialog.getByRole('button', { name: 'Door picture' });
      await pick.waitFor();
      h.expect(await pick.getAttribute('aria-current') === 'true', 'the existing drawing was not marked current');
      h.expect(await pick.evaluate((el) => document.activeElement === el), 'retry did not focus the current drawing');
      h.expect(JSON.stringify(await stored(page, ids)) === JSON.stringify(before), 'the drawing link changed on retry');
      await dialog.getByRole('button', { name: 'Close the drawings' }).click();
      await page.getByRole('button', { name: 'Change drawing, Door picture' }).waitFor();
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
