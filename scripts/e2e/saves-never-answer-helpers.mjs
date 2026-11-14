import { comesIn, onDisk } from './storage-never-answers.e2e.mjs';

const stallWrite = (page, name) => page.evaluate((name) => {
  const get = IDBObjectStore.prototype.get;
  window.__answer = () => (IDBObjectStore.prototype.get = get);
  IDBObjectStore.prototype.get = function (...args) {
    if (this.name !== name || this.transaction.mode !== 'readwrite') return get.apply(this, args);
    const store = this;
    const spin = () => {
      try { get.call(store, 'held').onsuccess = spin; } catch { return; }
    };
    spin();
    return {};
  };
}, name);

async function storyWithNoPages(page) {
  return page.evaluate(async () => {
    const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
    const { story, first } = await ss.create('No Pages Yet');
    await ss.removeChapter(story.id, first.id);
    return { db: ss.name, id: story.id };
  });
}
async function firstPageKept(h, page, db, id, release) {
  const box = page.getByRole('textbox', { name: 'Page, Chapter 1' });
  await box.waitFor({ timeout: 30000 });
  await comesIn(h, page, '.st-write', 'the first page after its save timed out', 30000);
  const state = await page.locator('.st-state').textContent();
  h.expect(state.includes('Not saving right now'), `the first page says ${state}`);
  h.expect(!(await page.locator('.st-write .dq-cant').count()), 'the first page showed a cannot-open panel');
  await page.evaluate((name) => window[name](), release);
  const before = await onDisk(page, db, 'stories', 'get', id);
  h.expect(before?.chapters.length === 0, `the given-up first page landed: ${before?.chapters}`);
  await box.fill('The first line.');
  const stored = async () => {
    const story = await onDisk(page, db, 'stories', 'get', id);
    const chapters = await onDisk(page, db, 'chapters', 'getAll');
    return { ids: story?.chapters, texts: chapters.filter((c) => c.text === 'The first line.').map((c) => c.id) };
  };
  await h.poll(page, stored, (v) => v.ids?.length === 1 && v.texts.length === 1 && v.ids[0] === v.texts[0],
    (v) => `the first line was stored as ${JSON.stringify(v)}`, { timeout: 10000 });
}
const holdStores = (page, db, stores) =>
  page.evaluate(
    ([db, stores]) =>
      new Promise((held) => {
        const open = indexedDB.open(db);
        open.onsuccess = () => {
          const store = open.result.transaction(stores, 'readwrite').objectStore(stores[0]);
          let on = true;
          window.__letGo = () => (on = false);
          const spin = () => {
            if (on) store.get('held').onsuccess = spin;
            else open.result.close();
          };
          spin();
          held();
        };
      }),
    [db, stores],
  );

export { stallWrite, storyWithNoPages, firstPageKept, holdStores };
