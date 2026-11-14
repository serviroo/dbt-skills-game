import { seed } from './back-to-the-same-page.e2e.mjs';
import { crystal, restore } from './newer-save-safety.e2e.mjs';
import { onDisk } from './storage-never-answers.e2e.mjs';

export async function restoredStoryKeepsUnsavedWords(h) {
  const source = await h.open(seed(h));
  let backup, ids;
  try {
    await h.reachHub(source.page);
    ids = await source.page.evaluate(async () => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const { story, first } = await ss.create('Restored story');
      await ss.saveChapter({ ...first, text: 'Words in the backup.' }, [first.rev]);
      return { story: story.id, chapter: first.id };
    });
    backup = await crystal(h, source.page, 'story-before-restore');
    h.expect(!source.errors.length, source.errors.join('\n'));
  } finally {
    await source.ctx.close();
  }
  const target = await h.open(seed(h));
  try {
    await h.reachHub(target.page);
    h.expect(/Restored/.test(await restore(h, target.page, backup)), 'the Save Crystal was not restored');
    const db = await target.page.evaluate(async () =>
      (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key).name);
    const disk = await onDisk(target.page, db, 'stories', 'get', ids.story);
    h.expect(!!disk, 'the restored story was not stored');
    const kept = await target.page.evaluate(async ({ story, chapter, db }) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const first = await ss.chapter(chapter);
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== db) return transaction.call(this, stores, mode, ...rest);
        throw new DOMException('The connection was lost.', 'InvalidStateError');
      };
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...args) {
        if (args[0] !== db) return open.apply(this, args);
        throw new DOMException('Storage cannot open.', 'SecurityError');
      };
      const saved = await ss.saveChapter({ ...first, text: 'Words not saved yet.' }, [first.rev]);
      const mirrored = ss.setLive({ chapter, text: 'Words in the mirror.', bases: [first.rev], t: Date.now() });
      await ss.remove(story);
      await ss.deleteForever(story);
      const result = {
        saved: saved.stored, mirrored, memory: ss.unsaved(chapter)?.text,
        mirrors: ss.lives(chapter).map((l) => l.text),
      };
      IDBDatabase.prototype.transaction = transaction;
      IDBFactory.prototype.open = open;
      return result;
    }, { ...ids, db });
    h.expect(kept.saved === 'failed' && kept.mirrored, `the unsaved edit was not prepared: ${JSON.stringify(kept)}`);
    h.expect(kept.memory === 'Words not saved yet.' && kept.mirrors.includes('Words in the mirror.'),
      `the restored story lost its unsaved words: ${JSON.stringify(kept)}`);
    const stored = await onDisk(target.page, db, 'stories', 'get', ids.story);
    h.expect(!!stored, 'the failed delete changed the stored story');
    h.expect(!target.errors.length, target.errors.join('\n'));
  } finally {
    await target.ctx.close();
  }
}

export async function uncertainImportKeepsUnsavedWords(h) {
  const { ctx, page, errors } = await h.open(seed(h));
  try {
    await h.reachHub(page);
    const original = await page.evaluate(async () => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const { story, first } = await ss.create('Already stored');
      await ss.saveChapter({ ...first, text: 'Stored words.' }, [first.rev]);
      return { db: ss.name, story: story.id, chapter: first.id, backup: await ss.exportAll() };
    });
    await page.addInitScript((db) => {
      const open = IDBFactory.prototype.open;
      window.__allowStoryOpen = () => (IDBFactory.prototype.open = open);
      IDBFactory.prototype.open = function (...args) {
        if (args[0] !== db) return open.apply(this, args);
        throw new DOMException('Storage cannot open.', 'SecurityError');
      };
    }, original.db);
    await page.reload();
    await h.reachHub(page);
    const result = await page.evaluate(async ({ story, chapter, backup }) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const imported = await ss.importAll(backup);
      const first = await ss.chapter(chapter);
      const saved = await ss.saveChapter({ ...first, text: 'Unsaved after import.' }, [first.rev]);
      const mirrored = ss.setLive({ chapter, text: 'Mirror after import.', bases: [first.rev], t: Date.now() });
      await ss.remove(story);
      await ss.deleteForever(story);
      return {
        imported, saved: saved.stored, mirrored, memory: ss.unsaved(chapter)?.text,
        mirrors: ss.lives(chapter).map((l) => l.text),
      };
    }, original);
    await page.evaluate(() => window.__allowStoryOpen());
    const stored = await onDisk(page, original.db, 'stories', 'get', original.story);
    h.expect(result.imported.added === 1 && result.saved === 'failed' && result.mirrored && !!stored,
      `the unknown import was not prepared: ${JSON.stringify(result)}`);
    h.expect(result.memory === 'Unsaved after import.' && result.mirrors.includes('Mirror after import.'),
      `the unknown import lost its unsaved words: ${JSON.stringify(result)}`);
    h.expect(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}

export async function failedNewImportCanBeDeleted(h, timedOut = false) {
  const source = await h.open(seed(h));
  let backup, ids;
  try {
    await h.reachHub(source.page);
    ({ backup, ids } = await source.page.evaluate(async () => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const { story, first } = await ss.create('New imported story');
      return { ids: { story: story.id, chapter: first.id }, backup: await ss.exportAll() };
    }));
  } finally {
    await source.ctx.close();
  }
  const target = await h.open(seed(h));
  try {
    await h.reachHub(target.page);
    const result = await target.page.evaluate(async ({ backup, ids, timedOut }) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name !== 'stories') return put.apply(this, args);
        IDBObjectStore.prototype.put = put;
        if (timedOut) {
          const store = this;
          const spin = () => {
            try { store.get('held').onsuccess = spin; } catch { return; }
          };
          spin();
          return {};
        }
        throw new DOMException('The disk could not be written.', 'QuotaExceededError');
      };
      const imported = await ss.importAll(backup);
      const first = await ss.chapter(ids.chapter);
      const mirrored = ss.setLive({ chapter: first.id, text: 'Memory only.', bases: [first.rev], t: Date.now() });
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== ss.name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
        throw new DOMException('The disk could not be written.', 'QuotaExceededError');
      };
      await ss.remove(ids.story);
      await ss.deleteForever(ids.story);
      const out = {
        imported, mirrored, removed: (await ss.removed()).some((s) => s.id === ids.story),
        chapter: !!ss.unsaved(ids.chapter), mirrors: ss.lives(ids.chapter).length,
      };
      IDBDatabase.prototype.transaction = transaction;
      return out;
    }, { backup, ids, timedOut });
    h.expect(result.imported.added === 1 && result.imported.unsaved === 1 && result.mirrored,
      `the failed import was not prepared: ${JSON.stringify(result)}`);
    h.expect(!result.removed && !result.chapter && result.mirrors === 0,
      `the known memory-only import remained after deletion: ${JSON.stringify(result)}`);
    h.expect(!target.errors.length, target.errors.join('\n'));
  } finally {
    await target.ctx.close();
  }
}

export async function landedMemoryStoryKeepsUnsavedWords(h) {
  const block = (ctx) => ctx.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    window.__blockStory = true;
    IDBFactory.prototype.open = function (...args) {
      if (window.__blockStory && String(args[0]).endsWith('.story'))
        throw new DOMException('Storage cannot open.', 'SecurityError');
      return open.apply(this, args);
    };
  });
  const { ctx, page, errors } = await h.open(seed(h), '?mute', undefined, block);
  try {
    await h.reachHub(page);
    const ids = await page.evaluate(async () => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const { story, first } = await ss.create('Initially in memory');
      window.__blockStory = false;
      (await import('/src/daily/idb-link.ts')).wakeStorage(true);
      const saved = await ss.saveChapter({ ...first, text: 'Stored later.' }, [first.rev]);
      return { db: ss.name, story: story.id, chapter: first.id, rev: saved.rev, saved: saved.stored };
    });
    const stored = await onDisk(page, ids.db, 'stories', 'get', ids.story);
    h.expect(ids.saved === 'wrote' && !!stored, 'the memory-only story did not reach storage');
    const result = await page.evaluate(async (ids) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== ids.db) return transaction.call(this, stores, mode, ...rest);
        throw new DOMException('The connection was lost.', 'InvalidStateError');
      };
      window.__blockStory = true;
      const first = { id: ids.chapter, story: ids.story, kind: 'page', title: 'Chapter 1', text: 'New words.' };
      const saved = await ss.saveChapter(first, [ids.rev]);
      const mirrored = ss.setLive({ chapter: ids.chapter, text: 'New mirror.', bases: [ids.rev], t: Date.now() });
      await ss.remove(ids.story);
      await ss.deleteForever(ids.story);
      const out = {
        saved: saved.stored, mirrored, memory: ss.unsaved(ids.chapter)?.text, lives: ss.lives(ids.chapter),
      };
      IDBDatabase.prototype.transaction = transaction;
      return out;
    }, ids);
    h.expect(result.saved === 'failed' && result.mirrored && result.memory === 'New words.' &&
      result.lives.some((l) => l.text === 'New mirror.'),
    `the landed story lost its unsaved words: ${JSON.stringify(result)}`);
    h.expect(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}

export async function everyStoryWriteClearsMemoryOnly(h) {
  for (const path of ['save-story', 'save-chapter', 'remove', 'add-chapter', 'import', 'cards', 'import-cards']) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await page.evaluate(async (path) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        await ss.list();
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== ss.name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
          IDBDatabase.prototype.transaction = transaction;
          throw new DOMException('The disk could not be written.', 'QuotaExceededError');
        };
        const { story, first } = await ss.create(`Memory before ${path}`);
        if (path === 'save-story') await ss.saveStory(story, [story.rev]);
        if (path === 'save-chapter') await ss.saveChapter({ ...first, text: 'Saved.' }, [first.rev]);
        if (path === 'remove') await ss.remove(story.id);
        if (path === 'add-chapter') await ss.addChapter(story.id);
        if (path === 'cards')
          await ss.changeCards(first.id, () => [{ id: 'saved-card', mode: 'continue', text: 'Idea', t: 1 }]);
        if (path === 'import-cards')
          await ss.importAll({
            cards: { [first.id]: [{ id: 'restored-card', mode: 'continue', text: 'Idea', t: 1 }] },
          });
        if (path === 'import') {
          const backup = await ss.exportAll();
          backup.stories[0].title = 'Updated by restore';
          backup.stories[0].updated += 5000;
          await ss.importAll(backup);
        }
        return { db: ss.name, story: story.id, chapter: first.id };
      }, path);
      const stored = path.includes('cards')
        ? await onDisk(page, ids.db, 'cards', 'get', ids.chapter)
        : await onDisk(page, ids.db, 'stories', 'get', ids.story);
      h.expect(!!stored, `${path} did not store the story or its cards`);
      const kept = await page.evaluate(async (ids) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const first = await ss.chapter(ids.chapter);
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name !== ids.db) return transaction.call(this, stores, mode, ...rest);
          throw new DOMException('The connection was lost.', 'InvalidStateError');
        };
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...args) {
          if (args[0] !== ids.db) return open.apply(this, args);
          throw new DOMException('Storage cannot open.', 'SecurityError');
        };
        const saved = await ss.saveChapter({ ...first, text: 'Unsaved after landing.' }, [first.rev]);
        const mirrored = ss.setLive({
          chapter: first.id, text: 'Mirror after landing.', bases: [first.rev], t: Date.now(),
        });
        await ss.remove(ids.story);
        await ss.deleteForever(ids.story);
        const out = { saved: saved.stored, mirrored, memory: ss.unsaved(first.id)?.text, lives: ss.lives(first.id) };
        IDBDatabase.prototype.transaction = transaction;
        IDBFactory.prototype.open = open;
        return out;
      }, ids);
      h.expect(kept.saved === 'failed' && kept.mirrored && kept.memory === 'Unsaved after landing.' &&
        kept.lives.some((l) => l.text === 'Mirror after landing.'), `${path} lost words: ${JSON.stringify(kept)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  }
}

export async function anotherTabStoresMemoryStory(h, cardsOnly = false) {
  const { ctx, page, errors } = await h.open(seed(h));
  try {
    await h.reachHub(page);
    const ids = await page.evaluate(async () => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      await ss.list();
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== ss.name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
        IDBDatabase.prototype.transaction = transaction;
        throw new DOMException('The disk could not be written.', 'QuotaExceededError');
      };
      const { story, first } = await ss.create('Shared memory story');
      const backup = await ss.exportAll();
      window.__storyChangedElsewhere = false;
      ss.onChange(() => (window.__storyChangedElsewhere = true));
      return { db: ss.name, story: story.id, chapter: first.id, rev: first.rev, backup };
    });
    const other = await ctx.newPage();
    try {
      await other.goto(page.url());
      await h.reachHub(other);
      const result = await other.evaluate(async ({ backup, cardsOnly, chapter }) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        if (cardsOnly) {
          const cards = await ss.changeCards(chapter,
            () => [{ id: 'other-card', mode: 'continue', text: 'Idea', t: 1 }]);
          return !!cards?.some((c) => c.id === 'other-card');
        }
        const imported = await ss.importAll(backup);
        return imported.added === 1 && imported.unsaved === 0;
      }, { backup: ids.backup, chapter: ids.chapter, cardsOnly });
      h.expect(result,
        `the other tab did not store the story: ${JSON.stringify(result)}`);
      await page.waitForFunction(() => window.__storyChangedElsewhere, null, { timeout: 5000 });
    } finally {
      await other.close();
    }
    const kept = await page.evaluate(async (ids) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== ids.db) return transaction.call(this, stores, mode, ...rest);
        throw new DOMException('The connection was lost.', 'InvalidStateError');
      };
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...args) {
        if (args[0] !== ids.db) return open.apply(this, args);
        throw new DOMException('Storage cannot open.', 'SecurityError');
      };
      const chapter = {
        id: ids.chapter, story: ids.story, kind: 'page', title: 'Chapter 1', text: 'Words in this tab.',
      };
      const saved = await ss.saveChapter(chapter, [ids.rev]);
      const mirrored = ss.setLive({
        chapter: ids.chapter, text: 'Mirror in this tab.', bases: [ids.rev], t: Date.now(),
      });
      await ss.remove(ids.story);
      await ss.deleteForever(ids.story);
      const out = {
        saved: saved.stored, mirrored, memory: ss.unsaved(ids.chapter)?.text, lives: ss.lives(ids.chapter),
      };
      IDBDatabase.prototype.transaction = transaction;
      IDBFactory.prototype.open = open;
      return out;
    }, ids);
    h.expect(kept.saved === 'failed' && kept.mirrored && kept.memory === 'Words in this tab.' &&
      kept.lives.some((l) => l.text === 'Mirror in this tab.'), `the shared story lost words: ${JSON.stringify(kept)}`);
    h.expect(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}

export async function failedKeptStoryCanBeDeleted(h) {
  for (const path of ['save-story', 'save-chapter']) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const result = await page.evaluate(async (path) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        await ss.list();
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name !== 'stories') return put.apply(this, args);
          IDBObjectStore.prototype.put = put;
          throw new DOMException('The connection was lost.', 'InvalidStateError');
        };
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...args) {
          if (args[0] !== ss.name) return open.apply(this, args);
          throw new DOMException('Storage cannot open.', 'SecurityError');
        };
        const id = `kept-${path}`;
        const chapter = `chapter-${path}`;
        const saved = path === 'save-story'
          ? await ss.saveStory({ id, title: 'Kept here', chapters: [] }, [])
          : await ss.saveChapter({ id: chapter, story: id, kind: 'page', title: 'Page', text: 'Kept.' }, []);
        const made = await ss.story(id);
        const liveChapter = path === 'save-story' ? made?.notes : chapter;
        const mirrored = !!liveChapter && ss.setLive({
          chapter: liveChapter, text: 'Only here.', bases: [], t: Date.now(),
        });
        await ss.remove(id);
        await ss.deleteForever(id);
        const out = {
          saved: saved.stored, made: !!made, mirrored, removed: (await ss.removed()).some((s) => s.id === id),
          lives: liveChapter ? ss.lives(liveChapter).length : -1,
        };
        IDBFactory.prototype.open = open;
        return out;
      }, path);
      h.expect(result.saved === 'failed' && result.made && result.mirrored && !result.removed && result.lives === 0,
        `${path} left its known memory-only story: ${JSON.stringify(result)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  }
}

export async function concurrentCardWriteProtectsImport(h) {
  const source = await h.open(seed(h));
  let backup, ids;
  try {
    await h.reachHub(source.page);
    ({ backup, ids } = await source.page.evaluate(async () => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const { story, first } = await ss.create('Import in progress');
      return { backup: await ss.exportAll(), ids: { story: story.id, chapter: first.id } };
    }));
  } finally {
    await source.ctx.close();
  }
  const { ctx, page, errors } = await h.open(seed(h));
  try {
    await h.reachHub(page);
    await page.evaluate(async (backup) => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name !== 'stories') return put.apply(this, args);
        IDBObjectStore.prototype.put = put;
        const store = this;
        const spin = () => {
          try { store.get('held').onsuccess = spin; } catch { return; }
        };
        spin();
        window.__importHeld = true;
        return {};
      };
      window.__externalStoryChange = false;
      ss.onChange(() => (window.__externalStoryChange = true));
      window.__importing = ss.importAll(backup);
    }, backup);
    await page.waitForFunction(() => window.__importHeld, null, { timeout: 5000 });
    const other = await ctx.newPage();
    try {
      await other.goto(page.url());
      await h.reachHub(other);
      const saved = await other.evaluate(async (chapter) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        return ss.changeCards(chapter, () => [{ id: 'parallel-card', mode: 'continue', text: 'Saved.', t: 1 }]);
      }, ids.chapter);
      h.expect(saved?.some((c) => c.id === 'parallel-card'), 'the concurrent card did not land');
      await page.waitForFunction(() => window.__externalStoryChange, null, { timeout: 5000 });
    } finally {
      await other.close();
    }
    const result = await page.evaluate(async (ids) => {
      const imported = await window.__importing;
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      const first = await ss.chapter(ids.chapter);
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name !== ss.name || mode !== 'readwrite') return transaction.call(this, stores, mode, ...rest);
        throw new DOMException('The disk could not be written.', 'QuotaExceededError');
      };
      const saved = await ss.saveChapter({ ...first, text: 'Words after the card.' }, [first.rev]);
      const mirrored = ss.setLive({ chapter: first.id, text: 'Parallel mirror.', bases: [first.rev], t: Date.now() });
      await ss.remove(ids.story);
      await ss.deleteForever(ids.story);
      const out = {
        imported, saved: saved.stored, mirrored, memory: ss.unsaved(first.id)?.text, lives: ss.lives(first.id),
      };
      IDBDatabase.prototype.transaction = transaction;
      return out;
    }, ids);
    h.expect(result.imported.added === 1 && result.imported.unsaved === 1 && result.saved === 'failed' &&
      result.mirrored && result.memory === 'Words after the card.' &&
      result.lives.some((l) => l.text === 'Parallel mirror.'),
    `the concurrent card left ${JSON.stringify(result)}`);
    h.expect(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}

export async function failedBringInLeavesNoStory(h) {
  const { ctx, page, errors } = await h.open(seed(h));
  try {
    await h.reachHub(page);
    const result = await page.evaluate(async () => {
      const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
      await ss.list();
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name !== 'stories') return put.apply(this, args);
        IDBObjectStore.prototype.put = put;
        throw new DOMException('The disk could not be written.', 'QuotaExceededError');
      };
      const made = await ss.createFrom({
        title: 'Not brought in', chapters: [{ title: '', text: 'Words.' }], notes: '',
      });
      return { made, listed: (await ss.list()).length, removed: (await ss.removed()).length };
    });
    h.expect(result.made === null && result.listed === 0 && result.removed === 0,
      `the failed Bring in left a story: ${JSON.stringify(result)}`);
    h.expect(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}
