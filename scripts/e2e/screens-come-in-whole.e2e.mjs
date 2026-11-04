import { drawPage, line } from './art-eraser-glow.e2e.mjs';
import { backTo, editorIs, newStory, onDisk, routeIs, safeZone, strokesAre } from './back-to-the-same-page.e2e.mjs';
import { panelShows } from './storage-never-answers.e2e.mjs';
import { seed } from './story-reading.e2e.mjs';

const LONG = 'Where the river ran bright under the old stone bridge';
const slowStorage = (page, store, kinds, ms) =>
  page.evaluate(
    async ([store, kinds, ms]) => {
      const file = store === 'story' ? '/src/daily/storystore.ts' : '/src/daily/artstore.ts';
      const m = await import(file);
      const s = (m.storyStore ?? m.artStore)(window.__daily.store.key);
      for (const k of kinds) {
        const real = s[k];
        s[k] = (...a) => new Promise((go) => setTimeout(go, ms)).then(() => real.apply(s, a));
      }
    },
    [store, kinds, ms],
  );
const comesIn = (h, page, sel, where) =>
  page
    .waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return !!el && !el.inert && getComputedStyle(el).visibility !== 'hidden';
      },
      sel,
      { timeout: 5000 },
    )
    .catch(() => h.expect(false, `${where}: the page never came in`));

async function watchFrames(page) {
  await page.evaluate(() => {
    const f = (window.__frames = { want: null, seen: 0, bad: [] });
    const shows = (el) => {
      if (!el?.isConnected || getComputedStyle(el).visibility === 'hidden') return false;
      for (let n = el; n; n = n.parentElement) if (Number(getComputedStyle(n).opacity) === 0) return false;
      return true;
    };
    const writer = (w) => {
      const write = document.querySelector('.st-write');
      if (!shows(write)) return null;
      const [title, ta, label] = ['.st-title', '.st-ta', '.st-chbtn-t'].map((s) => write.querySelector(s));
      const side = write.querySelector('.st-seg [aria-checked="true"]')?.textContent;
      const top = write.getBoundingClientRect().top;
      const edges = { '.st-title': ['top', 'height'], '.st-bar': ['top', 'height'], '.st-seg': ['top', 'left'] };
      const layout = w.still.map((s) => {
        const r = write.querySelector(s).getBoundingClientRect();
        return (edges[s] ?? ['top']).map((k) => Math.round(k === 'top' ? r.top - top : r[k])).join(',');
      });
      const moved = f.page === write && `${layout}` !== f.layout;
      f.page = write;
      f.layout = `${layout}`;
      return [
        title.value !== w.title && `the title "${title.value || title.placeholder}"`,
        shows(title) && !shows(ta) && 'the title over no page',
        shows(ta) && !w.texts.includes(ta.value) && `the page "${ta.value || ta.placeholder}"`,
        side !== w.side && `the ${side} tab`,
        shows(label) && !label.textContent && 'no chapter name',
        moved && `${w.still.join(', ')} moving as it came in`,
      ];
    };
    const tick = () => {
      const w = f.want;
      const at = window.__daily?.route.name;
      const wrong =
        w?.screen === 'write' && at === 'write'
          ? writer(w)
          : w?.screen === 'draw' && at === 'draw' && shows(document.querySelector('.dq-draw'))
            ? [window.__daily.ink?.strokes.length !== w.strokes && `${window.__daily.ink?.strokes.length} strokes`]
            : w?.screen === 'piece' && at === 'piece' && shows(document.querySelector('.dq-piece'))
              ? [!document.querySelector('.dq-piece-body')?.children.length && 'an empty page']
              : null;
      if (wrong) f.seen++;
      if (wrong?.some(Boolean)) f.bad.push(wrong.filter(Boolean).join(', '));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function framesShow(h, page, want, where, step) {
  await page.evaluate((w) => Object.assign(window.__frames, { want: w, seen: 0, bad: [], page: null }), want);
  await step();
  await h.frames(page, 3);
  const f = await page.evaluate(() => ({ seen: window.__frames.seen, bad: [...new Set(window.__frames.bad)] }));
  h.expect(f.seen > 0, `${where}: no frame of the page was seen`);
  h.expect(!f.bad.length, `${where}: a frame showed ${f.bad.join('; ')}`);
}

export const scenarios = {
  async 'writer-never-shows-empty'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', { width: 320, height: 568 });
    try {
      await h.reachHub(page);
      const [one, two, notes] = ['The lantern woke.', 'The river ran bright.', 'Mira keeps the map.'];
      const ids = await newStory(page, [one, two], notes);
      await page.evaluate(
        async ([id, title]) => {
          const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
          const c = await ss.chapter(id);
          await ss.saveChapter({ ...c, title }, [c.rev]);
        },
        [ids.chapters[1], LONG],
      );
      const want = (texts, side = 'Page', still = ['.st-title', '.st-bar', '.st-seg', '.st-frame']) => {
        return { screen: 'write', title: 'The Long Night', texts, side, still };
      };
      await watchFrames(page);
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await routeIs(page, 'stories');
      await slowStorage(page, 'story', ['story', 'chapter', 'cards'], 250);
      const opened = async (label, where) => {
        await editorIs(h, page, label, where);
        await comesIn(h, page, '.st-write', where);
      };

      await framesShow(h, page, want([one]), 'the Story Room list', async () => {
        await page.locator('.st-row', { hasText: 'The Long Night' }).click();
        await opened('Page, Chapter 1', 'the Story Room list');
      });
      await page.locator('.st-chbtn').click();
      await page.locator('.st-sheet .st-chrow-b').filter({ hasText: LONG }).click();
      await opened(`Page, ${LONG}`, 'the chapter list');
      await framesShow(h, page, want([two]), 'Back to writing', async () => {
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Read', exact: true }).click();
        await routeIs(page, 'read');
        await page.getByRole('button', { name: 'Back to writing' }).click();
        await routeIs(page, 'write');
        await opened(`Page, ${LONG}`, 'Back to writing');
      });
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await opened('Notes for this story', 'the Notes tab');
      await framesShow(h, page, want([notes], 'Notes'), 'the notes back from the Safe Zone', async () => {
        await safeZone(page);
        await backTo(page, 'write');
        await opened('Notes for this story', 'the notes back from the Safe Zone');
      });
      await h.shot(page, 'writer-notes-back-from-the-safe-zone-320');
      await page.locator('.dq-top .dq-back').click();
      await routeIs(page, 'stories');
      const row = ['.st-title', '.st-bar', '.st-seg'];
      await framesShow(h, page, want([two], 'Page', row), 'a search result', async () => {
        await page.getByRole('searchbox', { name: 'Search your stories and notes' }).fill('river');
        await page.locator('.st-found-row', { hasText: LONG }).click();
        await routeIs(page, 'write');
        await opened(`Page, ${LONG}`, 'a search result');
      });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'drawing-never-shows-empty'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', { width: 320, height: 568 });
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-tools-saved').waitFor();
      await watchFrames(page);
      await slowStorage(page, 'art', ['get', 'getDraft', 'drafts'], 250);
      const want = { screen: 'draw', strokes: 1 };
      await framesShow(h, page, want, 'back from the Safe Zone', async () => {
        await safeZone(page);
        await backTo(page, 'draw');
        await strokesAre(h, page, 1, 'back from the Safe Zone');
      });
      await page.locator('.dq-top .dq-back').click();
      await routeIs(page, 'art');
      await framesShow(h, page, { screen: 'piece' }, 'a saved drawing', async () => {
        await page.locator('[data-piece]').first().click();
        await page.getByRole('button', { name: 'Keep drawing', exact: true }).waitFor();
      });
      await framesShow(h, page, want, 'Keep drawing', async () => {
        await page.getByRole('button', { name: 'Keep drawing', exact: true }).click();
        await routeIs(page, 'draw');
        await strokesAre(h, page, 1, 'Keep drawing');
      });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'a-missing-chapter-opens'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await newStory(page, ['The lantern woke.', 'The river ran bright.'], '');
      const lone = await newStory(page, [''], '');
      const db = await page.evaluate(async () => {
        return (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key).name;
      });
      await onDisk(page, db, 'chapters', 'delete', ids.chapters[1]);
      await onDisk(page, db, 'chapters', 'delete', lone.chapters[0]);

      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.chapters[1] });
      await routeIs(page, 'write');
      await editorIs(h, page, 'Page, Chapter 1', 'Chapter 2 missing', 'The lantern woke.');
      await comesIn(h, page, '.st-write', 'Chapter 2 missing');

      await page.locator('.dq-top .dq-back').click();
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), lone.story);
      await page.waitForFunction((id) => window.__daily?.route.id === id, lone.story);
      await comesIn(h, page, '.st-write', 'its only chapter missing');
      await editorIs(h, page, 'Page, Chapter 2', 'its only chapter missing', '');
      await page.locator('.st-ta').fill('A new beginning.');
      await safeZone(page);
      await backTo(page, 'write');
      await editorIs(h, page, 'Page, Chapter 2', 'back to the page made for it', 'A new beginning.');
      const kept = await page.evaluate(async (id) => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        const s = await ss.story(id);
        return Promise.all(s.chapters.map(async (c) => (await ss.onDisk(c))?.text));
      }, lone.story);
      h.expect(kept.includes('A new beginning.'), `the new page stored ${JSON.stringify(kept)}`);
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await routeIs(page, 'stories');
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), lone.story);
      await editorIs(h, page, 'Page, Chapter 2', 'the story opened again', 'A new beginning.');
      const pages = (await onDisk(page, db, 'stories', 'get', lone.story))?.chapters.length;
      h.expect(pages === 2, `opening it again left the story with ${pages} pages, not the missing one and the new one`);

      const dark = await newStory(page, ['The lantern woke.', 'The river ran bright.'], '');
      await onDisk(page, db, 'chapters', 'delete', dark.chapters[1]);
      await page.evaluate((id) => {
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...a) {
          if (this.name !== 'chapters' || a[0] !== id) return get.apply(this, a);
          throw new DOMException('The disk could not be read.', 'NotReadableError');
        };
      }, dark.chapters[0]);
      await page.locator('.dq-top .dq-back').click();
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: dark.story, ch: dark.chapters[1] });
      await page.waitForFunction((id) => window.__daily?.route.id === id, dark.story);
      await panelShows(h, page, '.st-write', 'story', 'Chapter 2 missing and Chapter 1 unreadable');
      const listed = (await onDisk(page, db, 'stories', 'get', dark.story))?.chapters.length;
      h.expect(listed === 2, `Chapter 2 missing and Chapter 1 unreadable, the story now lists ${listed} pages`);

      const bare = await newStory(page, [''], '');
      await onDisk(page, db, 'chapters', 'delete', bare.chapters[0]);
      await page.evaluate(async () => {
        const ss = (await import('/src/daily/storystore.ts')).storyStore(window.__daily.store.key);
        ss.addChapter = () => Promise.reject(new RangeError('This story already holds as many chapters as it can.'));
      });
      await page.locator('.dq-top .dq-back').click();
      await page.evaluate((id) => window.__daily.go({ name: 'write', id }), bare.story);
      await page.waitForFunction((id) => window.__daily?.route.id === id, bare.story);
      await panelShows(h, page, '.st-write', 'story', 'its only chapter missing and no page could be made');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
