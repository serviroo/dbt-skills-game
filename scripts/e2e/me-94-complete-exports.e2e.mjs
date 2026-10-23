import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const fixture = fileURLToPath(new URL('./fixtures/crystal-v1.json', import.meta.url));
const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h, extra = {}) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'export-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  'dbt.app.v1': h.SEEN,
  ...extra,
});
const go = (page, name) => page.evaluate((name) => window.__daily.go({ name }, { quiet: true }), name);
async function ready(page) {
  await page.waitForFunction(() => !!window.__daily);
}
async function crystal(h, page, name) {
  await go(page, 'settings');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Crystal', exact: true }).click();
  const download = await pending;
  const target = path.join(h.out, name + '.json');
  await download.saveAs(target);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}
async function restore(page, raw) {
  await go(page, 'settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'crystal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
  await page.waitForFunction(() => /Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
}
const cleanRevs = (x) => {
  if (Array.isArray(x)) return x.map(cleanRevs);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'rev').map(([k, v]) => [k, cleanRevs(v)]));
  return x;
};

export const scenarios = {
  async 'crystal-crash-mirrors'(h) {
    const { ctx, page } = await h.open(seed(h));
    let raw;
    let ids;
    try {
      await ready(page);
      ids = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Mirror story');
        const saved = await ss.saveChapter({ ...first, text: 'Earlier saved words.' }, [first.rev]);
        const prefix = window.__daily.store.key + '.story.live';
        const lives = [
          [prefix + '.crashed-load.' + first.id, { chapter: first.id, text: 'Latest crash words.', bases: [saved.rev], t: saved.updated + 20 }],
          [prefix + '.other', { chapter: first.id, text: 'Other tab words.', bases: [saved.rev], t: saved.updated + 10 }],
          [prefix + '.old-notes', { chapter: story.notes, text: 'Notes left by a crash.', bases: [], t: saved.updated + 30 }],
          [prefix + '.orphan', { chapter: 'missing-page', text: 'Orphan crash words.', bases: [], t: saved.updated + 40 }],
        ];
        for (const [k, v] of lives) localStorage.setItem(k, JSON.stringify(v));
        return { story: story.id, chapter: first.id, lives };
      });
      await page.reload();
      await ready(page);
      raw = await crystal(h, page, 'crash-mirrors');
      const mirrorValues = await page.evaluate((ids) => ids.lives.map(([k]) => localStorage.getItem(k)), ids);
      h.expect(mirrorValues.every(Boolean), 'Export cleared a crash mirror before normal durable saving.');
      for (const [, l] of ids.lives) h.expect(raw.stories.chapters.some((c) => c.text === l.text), 'Crystal lost mirror words: ' + l.text);
      h.expect(raw.stories.chapters.find((c) => c.id === ids.chapter)?.text === 'Latest crash words.', 'Newest mirror did not recover under the original chapter id.');
      for (const c of raw.stories.chapters) h.expect(raw.stories.stories.some((s) => s.id === c.story && (s.notes === c.id || s.chapters.includes(c.id))), 'Exported page is unreachable: ' + c.id);
    } finally { await ctx.close(); }
    const target = await h.open(seed(h));
    try {
      await ready(target.page);
      await restore(target.page, raw);
      const actual = await crystal(h, target.page, 'restored-crash-mirrors');
      for (const [, l] of ids.lives) h.expect(actual.stories.chapters.some((c) => c.text === l.text), 'Restored crystal lost mirror words.');
    } finally { await target.ctx.close(); }
  },

  async 'crystal-recovery-at-story-limit'(h) {
    const { ctx, page } = await h.open(seed(h));
    let raw;
    try {
      await ready(page);
      await page.evaluate(async () => {
        const { storyStore, STORY_CAP } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        await ss.create('First story');
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open(window.__daily.store.key + '.story', 1);
          r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['stories'], 'readwrite');
          for (let n = 1; n < STORY_CAP.stories; n++) tx.objectStore('stories').put({ id: 'shelf-' + n, title: 'Saved story', created: n, updated: n, rev: 'saved', chapters: [], notes: '' });
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
        db.close();
        localStorage.setItem(window.__daily.store.key + '.story.live.orphan', JSON.stringify({ chapter: 'missing-at-limit', text: 'Recovery words at the story limit.', bases: [], t: Date.now() }));
      });
      raw = await crystal(h, page, 'limit-recovery');
      h.expect(raw.stories.stories.length === 500 && raw.stories.chapters.some((c) => c.text === 'Recovery words at the story limit.'), 'Recovery exceeded the story limit or lost mirror words.');
    } finally { await ctx.close(); }
    const target = await h.open(seed(h));
    try {
      await ready(target.page);
      await restore(target.page, raw);
      const actual = await crystal(h, target.page, 'restored-limit-recovery');
      h.expect(actual.stories.chapters.some((c) => c.text === 'Recovery words at the story limit.'), 'Recovery words were skipped when restoring a full shelf.');
    } finally { await target.ctx.close(); }
  },

  async 'crystal-idb-failures'(h) {
    const failures = [];
    for (const mode of ['sync', 'property', 'async', 'transaction']) {
      let opened;
      if (mode === 'sync' && h.flags.media === 'true') {
        const ctx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, serviceWorkers: 'block', reducedMotion: 'reduce', recordVideo: { dir: path.join(h.out, 'video'), size: { width: 390, height: 844 } } });
        await ctx.addInitScript((values) => {
          if (sessionStorage.getItem('seeded')) return;
          sessionStorage.setItem('seeded', '1');
          for (const [k, v] of Object.entries(values)) localStorage.setItem(k, v);
        }, seed(h));
        const page = await ctx.newPage();
        await page.goto(h.server.url + '/?mute');
        opened = { ctx, page };
      } else opened = await h.open(seed(h));
      const { ctx, page } = opened;
      try {
        await ready(page);
        await page.evaluate(async () => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const { artStore } = await import('/src/daily/artstore.ts');
          const a = window.__daily;
          await storyStore(a.store.key).create('Stored story');
          await artStore(a.store.key).put({ id: 'stored-art', kind: 'today', day: a.store.today(), t: 1, updated: 1, n: 1, strokes: [{ i: 1, w: 3, p: [20, 20, 80, 80] }] });
        });
        await ctx.addInitScript((mode) => {
          const matches = (n) => /\.story$|\.art$/.test(String(n));
          if (mode === 'property') {
            Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
          } else if (mode === 'transaction') {
            const transaction = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function (...args) {
              if (matches(this.name) && args[1] === 'readonly') throw new DOMException('Storage denied', 'SecurityError');
              return transaction.apply(this, args);
            };
          } else {
            const open = indexedDB.open.bind(indexedDB);
            indexedDB.open = function (name, ...args) {
              if (!matches(name)) return open(name, ...args);
              if (mode === 'sync') throw new DOMException('Storage denied', 'SecurityError');
              const request = { error: new DOMException('Storage denied', 'SecurityError') };
              setTimeout(() => request.onerror?.(new Event('error')), 0);
              return request;
            };
          }
        }, mode);
        await page.reload();
        await ready(page);
        const raw = await crystal(h, page, 'idb-' + mode);
        const state = await page.evaluate(async () => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const { artStore } = await import('/src/daily/artstore.ts');
          return { story: (await storyStore(window.__daily.store.key).exportAll()).incomplete, art: (await artStore(window.__daily.store.key).exportAll()).incomplete };
        });
        const status = await page.locator('.dq-settings .dq-hint[aria-live]').textContent();
        if (!state.story || !state.art || raw.incomplete !== true || !/incomplete/i.test(status)) failures.push({ mode, state, incomplete: raw.incomplete, status });
        if (mode === 'sync') {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(size);
            await page.locator('.dq-settings .dq-hint[aria-live]').scrollIntoViewIfNeeded();
            await h.shot(page, `incomplete-${size.width}x${size.height}`);
            if (h.flags.media === 'true') await h.sleep(size.width === 390 ? 4200 : 1400);
            h.expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Backup warning causes horizontal overflow.');
          }
        }
      } finally { await ctx.close(); }
    }
    fs.writeFileSync(path.join(h.out, 'idb-failures.json'), JSON.stringify(failures, null, 2));
    h.expect(!failures.length, 'Unreadable backup reported success: ' + JSON.stringify(failures));
  },

  async 'crystal-active-story'(h) {
    const results = [];
    for (const order of ['older', 'equal', 'newer']) {
      const { ctx, page } = await h.open(seed(h));
      try {
        await ready(page);
        const raw = await page.evaluate(async (order) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const local = storyStore(window.__daily.store.key);
          const { story, first } = await local.create('Active story');
          const saved = await local.saveChapter({ ...first, text: 'Local active words.' }, [first.rev]);
          const stories = await local.exportAll();
          stories.stories[0].removed = saved.updated + 1000;
          stories.stories[0].updated = order === 'older' ? 0 : order === 'equal' ? stories.stories[0].updated : saved.updated + 2000;
          return JSON.parse(window.__daily.store.exportJSON({ stories }));
        }, order);
        await restore(page, raw);
        const actual = await crystal(h, page, 'active-story-' + order);
        await go(page, 'stories');
        await page.waitForFunction(() => document.querySelector('.st-shelf')?.children.length > 0);
        const active = await page.getByRole('button', { name: /Active story/ }).first().isVisible();
        results.push({ order, active, text: actual.stories.chapters.find((c) => c.text === 'Local active words.')?.text });
      } finally { await ctx.close(); }
    }
    fs.writeFileSync(path.join(h.out, 'active-stories.json'), JSON.stringify(results, null, 2));
    h.expect(results.every((r) => r.active && r.text === 'Local active words.'), 'Restore hid an active story: ' + JSON.stringify(results));
  },

  async 'crystal-choices-roundtrip'(h) {
    const { ctx, page } = await h.open(seed(h));
    let raw;
    try {
      await ready(page);
      await page.evaluate(async () => {
        const a = window.__daily;
        const s = a.store.state;
        s.settings.playerName = 'Kit'; s.settings.companion = 'Lumen';
        s.settings.sound = false; s.settings.motion = 'reduce';
        for (const key of ['sound', 'motion', 'playerName', 'companion']) a.store.touch(key);
        const { THEME_IDS, ACCENT_IDS, CARD_BACK_IDS, PLATE_IDS, SHADOW_IDS, TITLE_IDS } = await import('/src/content/roster-lines.ts');
        for (const [key, values] of [['theme', THEME_IDS], ['accent', ACCENT_IDS], ['cardBack', CARD_BACK_IDS], ['plate', PLATE_IDS], ['title', TITLE_IDS]]) {
          s.settings[key] = values.at(-1); a.store.touch(key);
        }
        s.settings.names[SHADOW_IDS[0]] = 'Fern'; a.store.touch('name:' + SHADOW_IDS[0]);
        s.flags.titlesSeen = [TITLE_IDS.at(-1)];
        s.diary['2026-01-02'] = { day: '2026-01-02', emotions: { Joy: 3 }, urges: {}, note: 'A quiet afternoon.', updatedAt: 3 };
        s.lists.comfort = [{ id: 'comfort-one', text: 'A soft blanket', at: 3 }];
        s.lists.activities = [{ id: 'activity-one', text: 'A short walk', at: 3 }];
        s.lists.reasons = [{ id: 'reason-one', text: 'Tomorrow', at: 3 }];
        s.lists.people = [{ id: 'person-one', name: 'Kit', phone: '', at: 3 }];
        s.maps = [{ id: 'map-one', t: 3, urge: 'Pause', p1: 'Rest', c1: 'Time', p2: 'Walk', c2: 'Energy', choice: 'Rest' }];
        s.lines = [{ day: '2026-01-02', id: 'quiet-line', tag: 'quiet', text: 'A quiet day.', t: 3 }];
        a.store.save();
        a.opts.volume.set({ master: .27, music: .38, sfx: .49, muted: true });
        localStorage.setItem(a.store.key + '.stealth', JSON.stringify({ aquarium: true, words: true }));
        localStorage.setItem(a.store.key + '.safe-light', 'up');
        localStorage.setItem('dbt.cowriter.v1', JSON.stringify({ key: 'do-not-export-test-value' }));
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(a.store.key);
        const { first } = await ss.create('Saved choices');
        await ss.saveChapter({ ...first, text: 'A chapter to keep.' }, [first.rev]);
        await ss.putCards(first.id, [{ id: 'card-one', mode: 'polish', text: 'A card to keep.', t: 3, sel: { start: 0, end: 9, text: 'A chapter' } }]);
        const { artStore } = await import('/src/daily/artstore.ts');
        await artStore(a.store.key).put({ id: 'roundtrip-art', kind: 'today', day: '2026-01-02', t: 3, updated: 3, n: 1, strokes: [{ i: 1, w: 3, p: [20, 20, 80, 80] }] });
      });
      raw = await crystal(h, page, 'choices');
      h.expect(!JSON.stringify(raw).includes('do-not-export-test-value'), 'Co-writer credentials leaked into the file.');
      h.expect(raw.preferences && raw.stories.cards, 'Crystal omitted saved preferences or story cards.');
      h.expect(raw.v > 1, 'Crystal format version was not bumped.');
      h.expect(JSON.parse(await h.ls(page, h.SAVE)).v === 1, 'Crystal format changed the schema used by open older tabs.');
    } finally { await ctx.close(); }
    const target = await h.open(seed(h), '');
    try {
      await ready(target.page);
      await restore(target.page, raw);
      const actual = await crystal(h, target.page, 'restored-choices');
      for (const key of ['events', 'settings', 'profile', 'diary', 'lists', 'maps', 'lines', 'preferences', 'art']) {
        const expected = structuredClone(raw[key]);
        const got = structuredClone(actual[key]);
        if (key === 'profile') { delete expected.setAt; delete got.setAt; }
        assert.deepEqual(got, expected, 'Restored field differs: ' + key);
      }
      assert.deepEqual(cleanRevs(actual.stories), cleanRevs(raw.stories), 'Stories/cards differ after restore.');
      const live = await target.page.evaluate(() => ({ levels: window.__daily.opts.volume.get(), reduced: window.__daily.reduced(), credentials: localStorage.getItem('dbt.cowriter.v1') }));
      assert.deepEqual(live.levels, { master: .27, music: .38, sfx: .49, muted: true });
      h.expect(live.reduced && live.credentials === null, 'Motion or credential isolation was not applied.');
      h.expect(await target.page.getByRole('radio', { name: 'Motion: Reduced', exact: true }).getAttribute('aria-checked') === 'true', 'Restored motion choice is stale in Settings.');
    } finally { await target.ctx.close(); }
  },

  async 'crystal-destination-choices'(h) {
    const { ctx, page } = await h.open(seed(h));
    try {
      await ready(page);
      const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
      raw.preferences = { audio: { v: 1, master: .9, music: .8, sfx: .7, muted: false }, room: { aquarium: true, words: true }, safeLight: 'up' };
      raw.settings.sound = true; raw.settings.motion = 'full';
      raw.setAt.sound = 5; raw.setAt.motion = 5;
      await page.evaluate(() => {
        const a = window.__daily;
        a.opts.volume.set({ master: .11, music: .22, sfx: .33, muted: true });
        a.store.state.settings.sound = false;
        a.store.state.settings.motion = 'reduce';
        a.store.touch('sound'); a.store.touch('motion'); a.store.save();
        localStorage.setItem(a.store.key + '.stealth', JSON.stringify({ aquarium: false, words: false }));
        localStorage.setItem(a.store.key + '.safe-light', 'dim');
      });
      await restore(page, raw);
      const actual = await page.evaluate(() => {
        const a = window.__daily;
        return { audio: a.opts.volume.get(), sound: a.store.state.settings.sound, motion: a.store.state.settings.motion, room: JSON.parse(localStorage.getItem(a.store.key + '.stealth')), light: localStorage.getItem(a.store.key + '.safe-light') };
      });
      assert.deepEqual(actual, { audio: { master: .11, music: .22, sfx: .33, muted: true }, sound: false, motion: 'reduce', room: { aquarium: false, words: false }, light: 'dim' });
    } finally { await ctx.close(); }
  },

  async 'crystal-sparse-destination'(h) {
    const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    raw.settings.sound = true;
    raw.preferences = { audio: { v: 1, master: .9, music: .8, sfx: .7, muted: false }, room: { aquarium: true, words: true }, safeLight: 'up' };
    const { ctx, page } = await h.open(seed(h, { 'dbt.audio.v1': JSON.stringify({ v: 1, master: .11, muted: true }), [h.SAVE + '.stealth']: JSON.stringify({ aquarium: false }) }), '');
    try {
      await ready(page);
      await restore(page, raw);
      const actual = await crystal(h, page, 'sparse-choices');
      assert.deepEqual(actual.preferences, { audio: { v: 1, master: .11, music: .8, sfx: .7, muted: true }, room: { aquarium: false, words: true }, safeLight: 'up' });
    } finally { await ctx.close(); }
  },

  async 'crystal-card-merge'(h) {
    const { ctx, page } = await h.open(seed(h));
    try {
      await ready(page);
      const raw = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { first } = await ss.create('Card merge');
        await ss.putCards(first.id, Array.from({ length: 12 }, (_, n) => ({ id: 'card-' + n, mode: 'polish', text: 'Local card ' + n, t: 20 })));
        const stories = await ss.exportAll();
        stories.cards = { [first.id]: [...Array.from({ length: 11 }, (_, n) => ({ id: 'extra-card-' + n, mode: 'polish', text: 'Extra card', t: 30 })), { id: 'card-0', mode: 'polish', text: 'Older card', t: 10 }, { id: 'card-1', mode: 'polish', text: 'Newer card', t: 30 }] };
        return JSON.parse(window.__daily.store.exportJSON({ stories }));
      });
      await restore(page, raw);
      h.expect(/story pages or cards couldn't be added/.test(await page.locator('.dq-settings .dq-hint[aria-live]').textContent()), 'Full card storage did not explain the cards left in the file.');
      const actual = await crystal(h, page, 'merged-cards');
      const cards = Object.values(actual.stories.cards)[0];
      h.expect(cards?.length === 12 && cards.find((c) => c.id === 'card-0')?.text === 'Local card 0' && cards.find((c) => c.id === 'card-1')?.text === 'Newer card', 'Card restore dropped a local card or ignored the newest edit.');
    } finally { await ctx.close(); }
  },

  async 'crystal-card-recovery'(h) {
    for (const blockRead of [false, true]) {
      const { ctx, page } = await h.open(seed(h));
      try {
        await ready(page);
        const raw = await page.evaluate(async (blockRead) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const a = window.__daily;
          const ss = storyStore(a.store.key);
          const { first } = await ss.create('Card recovery');
          await ss.putCards(first.id, [{ id: 'local-card', mode: 'polish', text: 'Already saved card.', t: 10 }]);
          const stories = await ss.exportAll();
          stories.cards = { [first.id]: [{ id: 'incoming-card', mode: 'polish', text: 'Incoming card.', t: 20 }] };
          const transaction = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
            const names = typeof stores === 'string' ? [stores] : [...stores];
            if (this.name.endsWith('.story') && names.length === 1 && names[0] === 'cards' && (mode === 'readwrite' || blockRead)) throw new DOMException('Temporary storage failure', mode === 'readwrite' ? 'QuotaExceededError' : 'SecurityError');
            return transaction.call(this, stores, mode, ...rest);
          };
          window.restoreCardStorage = () => { IDBDatabase.prototype.transaction = transaction; };
          return JSON.parse(a.store.exportJSON({ stories }));
        }, blockRead);
        await restore(page, raw);
        await page.evaluate(() => window.restoreCardStorage());
        const actual = await crystal(h, page, 'card-recovery-' + blockRead);
        const cards = Object.values(actual.stories.cards ?? {}).flat();
        h.expect(cards.some((c) => c.id === 'local-card') && cards.some((c) => c.id === 'incoming-card'), 'A failed card import hid saved cards from a later readable backup: ' + JSON.stringify(cards));
        h.expect(actual.incomplete === false, 'Recovered readable card storage still reports an incomplete backup.');
        for (const replacement of [[], [{ id: 'replacement-card', mode: 'polish', text: 'A deliberate replacement.', t: 30 }]]) {
          await page.evaluate(async ({ replacement, blockRead }) => {
            const { storyStore } = await import('/src/daily/storystore.ts');
            const ss = storyStore(window.__daily.store.key);
            const { chapters } = await ss.exportAll();
            const id = chapters.find((c) => c.kind === 'page').id;
            await ss.putCards(id, [{ id: 'discarded-card', mode: 'polish', text: 'A card deliberately removed.', t: 10 }]);
            const transaction = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
              const names = typeof stores === 'string' ? [stores] : [...stores];
              if (this.name.endsWith('.story') && names.length === 1 && names[0] === 'cards' && (mode === 'readwrite' || blockRead)) throw new DOMException('Temporary storage failure', mode === 'readwrite' ? 'QuotaExceededError' : 'SecurityError');
              return transaction.call(this, stores, mode, ...rest);
            };
            window.restoreCardStorage = () => { IDBDatabase.prototype.transaction = transaction; };
            await ss.putCards(id, replacement);
          }, { replacement, blockRead });
          try { await restore(page, raw); }
          finally { await page.evaluate(() => window.restoreCardStorage()); }
          const expectedIds = ['incoming-card', ...replacement.map((c) => c.id)].sort();
          const visible = await page.evaluate(async (id) => {
            const { storyStore } = await import('/src/daily/storystore.ts');
            return (await storyStore(window.__daily.store.key).cards(id)).map((c) => c.id).sort();
          }, Object.keys(raw.stories.cards)[0]);
          h.expect(JSON.stringify(visible) === JSON.stringify(expectedIds), 'Recovered reads resurrected discarded cards after a pending replacement and failed import: ' + JSON.stringify(visible));
          const cleared = await crystal(h, page, 'explicit-card-edit-' + blockRead + '-' + replacement.length);
          h.expect(JSON.stringify(Object.values(cleared.stories.cards).flat().map((c) => c.id).sort()) === JSON.stringify(expectedIds), 'Backup resurrected discarded cards after a pending replacement and failed import.');
          const empty = { ...raw, stories: { stories: [], chapters: [], cards: Object.fromEntries(Object.keys(raw.stories.cards).map((id) => [id, []])) } };
          await restore(page, empty);
          const retried = await crystal(h, page, 'card-edit-after-restore-' + blockRead + '-' + replacement.length);
          h.expect(JSON.stringify(Object.values(retried.stories.cards).flat().map((c) => c.id).sort()) === JSON.stringify(expectedIds), 'A successful retry resurrected discarded cards after a pending replacement and failed import.');
        }
      } finally { await ctx.close(); }
    }
  },

  async 'crystal-card-cap-recovery'(h) {
    const { ctx, page } = await h.open(seed(h));
    try {
      await ready(page);
      const raw = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { first } = await ss.create('Full card recovery');
        await ss.putCards(first.id, Array.from({ length: 12 }, (_, n) => ({ id: 'saved-' + n, mode: 'polish', text: 'Saved card ' + n, t: 10 })));
        const stories = await ss.exportAll();
        stories.cards = { [first.id]: Array.from({ length: 12 }, (_, n) => ({ id: 'pending-' + n, mode: 'polish', text: 'Pending card ' + n, t: 20 })) };
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, ...rest) {
          const names = typeof stores === 'string' ? [stores] : [...stores];
          if (this.name.endsWith('.story') && names.length === 1 && names[0] === 'cards') throw new DOMException('Temporary storage failure', 'SecurityError');
          return transaction.call(this, stores, ...rest);
        };
        window.restoreCardStorage = () => { IDBDatabase.prototype.transaction = transaction; };
        return JSON.parse(window.__daily.store.exportJSON({ stories }));
      });
      await restore(page, raw);
      await page.evaluate(() => window.restoreCardStorage());
      await restore(page, raw);
      const result = await page.evaluate(async (raw) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const id = Object.keys(raw.stories.cards)[0];
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open(window.__daily.store.key + '.story', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        const stored = await new Promise((resolve, reject) => { const r = db.transaction('cards').objectStore('cards').get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        db.close();
        const readable = await ss.exportAll();
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name.endsWith('.story') && mode === 'readonly') throw new DOMException('Temporary storage failure', 'SecurityError');
          return transaction.call(this, stores, mode, ...rest);
        };
        try { return { stored, readable, blocked: await ss.exportAll() }; }
        finally { IDBDatabase.prototype.transaction = transaction; }
      }, raw);
      fs.writeFileSync(path.join(h.out, 'card-cap-recovery.json'), JSON.stringify(result, null, 2));
      h.expect(result.stored.length === 12 && result.stored.every((c) => c.id.startsWith('saved-')), 'Retry exceeded the saved-card cap or removed local cards.');
      h.expect(result.readable.incomplete === true, 'Overflowing pending cards reported a complete backup.');
      const pending = Object.values(result.blocked.cards).flat();
      h.expect(pending.length === 12 && pending.every((c) => c.id.startsWith('pending-')), 'Retry discarded the cards still held for this visit.');
    } finally { await ctx.close(); }
  },

  async 'crystal-malformed-cards'(h) {
    const valid = { id: 'valid-card', mode: 'polish', text: 'Card to keep.', t: 1 };
    const cases = [{ value: null }, { value: { unexpected: true } }, { value: [valid, null, { mode: 'unknown', text: 'Invalid card' }] }, { key: 7, value: [valid] }, { value: Array.from({ length: 13 }, (_, n) => ({ ...valid, id: 'over-' + n })) }];
    for (const [index, example] of cases.entries()) {
      const { ctx, page } = await h.open(seed(h));
      let raw;
      try {
        await ready(page);
        await page.evaluate(async (example) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const ss = storyStore(window.__daily.store.key);
          const { first } = await ss.create('Card recovery');
          const db = await new Promise((resolve, reject) => { const r = indexedDB.open(window.__daily.store.key + '.story', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
          await new Promise((resolve, reject) => { const tx = db.transaction('cards', 'readwrite'); tx.objectStore('cards').put(example.value, example.key ?? first.id); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
          db.close();
        }, example);
        raw = await crystal(h, page, 'malformed-cards-' + index);
        h.expect(raw.incomplete === true && /incomplete/.test(await page.locator('.dq-settings .dq-hint[aria-live]').textContent()), 'Malformed stored cards reported a complete backup.');
        const cards = Object.values(raw.stories.cards).flat();
        const expected = index === 2 ? [valid] : index === 4 ? example.value.slice(0, 12) : [];
        assert.deepEqual(cards, expected);
      } finally { await ctx.close(); }
      const target = await h.open(seed(h));
      try {
        await ready(target.page);
        await restore(target.page, raw);
        const restored = await crystal(h, target.page, 'restored-malformed-cards-' + index);
        assert.deepEqual(restored.stories.cards, raw.stories.cards);
      } finally { await target.ctx.close(); }
    }
  },

  async 'crystal-preference-failures'(h) {
    for (const failure of ['read', 'write']) {
      const { ctx, page } = await h.open(seed(h));
      try {
        await ready(page);
        await page.evaluate((failure) => {
          const method = failure === 'read' ? 'getItem' : 'setItem';
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (key, ...args) {
            if (key === 'dbt.audio.v1') throw new DOMException('Storage denied', 'SecurityError');
            return original.call(this, key, ...args);
          };
        }, failure);
        if (failure === 'read') {
          const raw = await crystal(h, page, 'unreadable-preferences');
          h.expect(raw.incomplete && /incomplete/.test(await page.locator('.dq-settings .dq-hint[aria-live]').textContent()), 'Unreadable preferences reported a complete backup.');
        } else {
          const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
          raw.preferences = { audio: { v: 1, master: .4, music: .4, sfx: .4, muted: true } };
          await restore(page, raw);
          h.expect(/choices couldn't be saved/.test(await page.locator('.dq-settings .dq-hint[aria-live]').textContent()), 'Blocked preference write reported full restoration.');
        }
      } finally { await ctx.close(); }
    }
  },

  async 'crystal-fallback-audio-export'(h) {
    for (const sound of [false, true, null]) {
      const stored = { v: 1, master: .4, music: .3, sfx: .2, muted: sound ?? true };
      const { ctx, page } = await h.open(seed(h, { 'dbt.audio.v1': JSON.stringify(stored) }), '');
      let raw;
      try {
        await ctx.addInitScript(() => {
          window.AudioContext = class { constructor() { throw new DOMException('Audio unavailable', 'NotSupportedError'); } };
          window.webkitAudioContext = window.AudioContext;
        });
        await page.reload();
        await ready(page);
        h.expect(await page.evaluate(() => !window.__daily.opts.volume), 'Test did not reach the fallback Sound switch.');
        await go(page, 'settings');
        if (sound !== null) {
          await page.getByRole('switch', { name: /^Sound/ }).setChecked(!sound);
          await page.getByRole('switch', { name: /^Sound/ }).setChecked(sound);
        }
        raw = await crystal(h, page, 'fallback-audio-' + sound);
        assert.deepEqual(raw.preferences?.audio, { ...stored, muted: !sound }, 'Fallback export ignored the latest Sound switch.');
      } finally { await ctx.close(); }
      const target = await h.open(seed(h), '');
      try {
        await ready(target.page);
        await restore(target.page, raw);
        const actual = await target.page.evaluate(() => window.__daily.opts.volume.snapshot());
        assert.deepEqual(actual, { master: stored.master, music: stored.music, sfx: stored.sfx, muted: !sound });
      } finally { await target.ctx.close(); }
    }
  },

  async 'crystal-corrupt-destination-audio'(h) {
    const audio = { v: 1, master: .4, music: .3, sfx: .2, muted: true };
    for (const value of ['{}', '[]', 'null', 'false', '"foreign"', '{', '{"v":2,"master":0.8}', '{"v":1,"master":null,"music":"quiet","muted":"false"}', '{"v":1,"master":0,"muted":false}']) {
      const { ctx, page } = await h.open(seed(h, { 'dbt.audio.v1': value }), '');
      try {
        await ready(page);
        const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
        raw.preferences = { audio };
        await restore(page, raw);
        const actual = await page.evaluate(() => ({ saved: JSON.parse(localStorage.getItem('dbt.audio.v1')), live: window.__daily.opts.volume.snapshot() }));
        const expected = value === '{"v":1,"master":0,"muted":false}' ? { ...audio, master: 0, muted: false } : audio;
        assert.deepEqual(actual.saved, expected, 'Invalid destination audio blocked valid backup choices: ' + value);
        const { v, ...levels } = expected;
        assert.deepEqual(actual.live, levels);
        h.expect(!/choices couldn't be saved/.test(await page.locator('.dq-settings .dq-hint[aria-live]').textContent()), 'Recovered corrupt preferences still report a save failure.');
      } finally { await ctx.close(); }
    }
    const legacy = await h.open(seed(h, { 'dbt.audio.v1': '{}' }), '');
    try {
      await ready(legacy.page);
      await restore(legacy.page, JSON.parse(fs.readFileSync(fixture, 'utf8')));
      h.expect(await legacy.page.evaluate(() => window.__daily.opts.volume.snapshot().muted && JSON.parse(localStorage.getItem('dbt.audio.v1')).muted), 'An old crystal lost its Sound-off choice with corrupt destination preferences.');
    } finally { await legacy.ctx.close(); }
  },

  async 'crystal-card-import-bounds'(h) {
    const { ctx, page } = await h.open(seed(h));
    try {
      await ready(page);
      const raw = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { first } = await ss.create('Bounded card import');
        await ss.putCards(first.id, Array.from({ length: 12 }, (_, n) => ({ id: 'local-' + n, mode: 'polish', text: 'Local card ' + n, t: 10 })));
        const list = Array(2001).fill(null);
        list[12] = { id: 'local-0', mode: 'polish', text: 'Within scan bound.', t: 20 };
        list[2000] = { id: 'local-0', mode: 'polish', text: 'Beyond scan bound.', t: 30 };
        return JSON.parse(window.__daily.store.exportJSON({ stories: { cards: { [first.id]: list } } }));
      });
      await restore(page, raw);
      const first = await crystal(h, page, 'bounded-card-records');
      const id = Object.keys(raw.stories.cards)[0];
      h.expect(first.stories.cards[id].find((c) => c.id === 'local-0')?.text === 'Within scan bound.', 'Card restore scanned beyond its record bound or missed an existing ID after position 12.');
      const entries = Object.fromEntries(Array.from({ length: 500 * (300 + 2) }, (_, n) => ['?invalid-' + n, []]));
      entries[id] = [{ id: 'local-0', mode: 'polish', text: 'Beyond entry bound.', t: 40 }];
      await restore(page, { ...raw, stories: { cards: entries } });
      h.expect(/pages or cards couldn't be added/.test(await page.locator('.dq-settings .dq-hint[aria-live]').textContent()), 'Discarded card entries were not reported.');
      const final = await crystal(h, page, 'bounded-card-entries');
      h.expect(final.stories.cards[id].find((c) => c.id === 'local-0')?.text === 'Within scan bound.', 'Card restore processed an entry beyond the chapter import bound.');
    } finally { await ctx.close(); }
  },

  async 'crystal-restore-incomplete'(h) {
    const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    raw.incomplete = true;
    const { ctx, page } = await h.open(seed(h));
    try {
      await ready(page);
      await restore(page, raw);
      const status = await page.locator('.dq-settings .dq-hint[aria-live]').textContent();
      h.expect(/incomplete/.test(status) && /other backups/.test(status) && !/Everything in the file/.test(status), 'Restore concealed that its source backup was incomplete: ' + status);
      const actual = await crystal(h, page, 'partial-file-restored');
      h.expect(actual.diary['2026-01-02'].note === 'A quiet afternoon.', 'Partial restore did not retain the readable data.');
    } finally { await ctx.close(); }
  },

  async 'crystal-fallback-sound'(h) {
    const { ctx, page } = await h.open(seed(h));
    try {
      await ctx.addInitScript(() => {
        window.AudioContext = class { constructor() { throw new DOMException('Audio unavailable', 'NotSupportedError'); } };
        window.webkitAudioContext = window.AudioContext;
      });
      await page.reload();
      await ready(page);
      h.expect(await page.evaluate(() => !window.__daily.opts.volume), 'Test did not reach the real audio initialization fallback.');
      const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
      await restore(page, raw);
      h.expect(await page.evaluate(() => window.__daily.store.state.settings.sound === false), 'Restore did not import the old sound choice.');
      h.expect(!await page.getByRole('switch', { name: /^Sound/ }).isChecked(), 'Fallback Sound switch shows the old value after restore.');
      await page.reload();
      await ready(page);
      await go(page, 'settings');
      h.expect(!await page.getByRole('switch', { name: /^Sound/ }).isChecked(), 'Fallback sound choice did not survive reload.');
    } finally { await ctx.close(); }
  },

  async 'crystal-restore-return'(h) {
    const { ctx, page } = await h.open(seed(h));
    try {
      await ctx.addInitScript(() => {
        window.AudioContext = class { constructor() { throw new DOMException('Audio unavailable', 'NotSupportedError'); } };
        window.webkitAudioContext = window.AudioContext;
      });
      await page.reload();
      await ready(page);
      await go(page, 'settings');
      await page.evaluate(() => {
        const text = File.prototype.text;
        File.prototype.text = function () {
          return new Promise((resolve) => { window.releaseRestore = () => { File.prototype.text = text; resolve(text.call(this)); }; });
        };
      });
      const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
      await page.locator('input[type=file]').setInputFiles({ name: 'crystal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
      await page.evaluate(() => {
        window.__daily.go({ name: 'safe' }, { quiet: true });
        window.__daily.go({ name: 'settings' }, { quiet: true });
        window.releaseRestore();
      });
      await page.waitForFunction(() => window.__daily.store.state.settings.playerName === 'Kit');
      h.expect(!await page.getByRole('switch', { name: /^Sound/ }).isChecked(), 'Returning to Settings during a file read left the new Sound switch stale.');
      h.expect(await page.getByRole('radio', { name: 'Motion: Reduced', exact: true }).getAttribute('aria-checked') === 'true', 'Returning during restore left the new Motion choice stale.');
    } finally { await ctx.close(); }
  },

  async 'crystal-query-mute'(h) {
    for (const target of ['same-tab', 'other-tab']) {
      for (const destination of [null, { v: 1, master: .12 }]) {
        const values = destination ? { 'dbt.audio.v1': JSON.stringify(destination) } : {};
        const { ctx, page } = await h.open(seed(h, values));
        try {
          await ready(page);
          let receiver = page;
          if (target === 'other-tab') {
            receiver = await ctx.newPage();
            await receiver.goto(h.server.url + '/');
            await ready(receiver);
          }
          const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
          raw.settings.sound = true;
          raw.preferences = { audio: { v: 1, master: .9, music: .8, sfx: .7, muted: false } };
          await restore(receiver, raw);
          await page.waitForFunction(() => window.__daily.opts.volume.get().music === .8);
          const persisted = JSON.parse(await h.ls(page, 'dbt.audio.v1'));
          h.expect(persisted.muted === false, 'Visit-only mute became a saved preference: ' + JSON.stringify(persisted));
          h.expect(await page.evaluate(() => window.__daily.opts.volume.get().muted), 'Restore removed the current visit mute.');
          await page.goto(h.server.url + '/');
          await ready(page);
          h.expect(!await page.evaluate(() => window.__daily.opts.volume.get().muted), 'Temporary mute survived a fresh visit without the query.');
        } finally { await ctx.close(); }
      }
    }
  },

  async 'crystal-runtime-audio-choice'(h) {
    const stale = { v: 1, master: .8, music: .7, sfx: .6, muted: false };
    const results = [];
    for (const stored of [stale, null]) for (const muted of [true, false]) for (const sourceAudio of [true, false]) for (const blockedRestore of [false, true]) {
      const destination = stored ? { ...stored, muted: !muted } : null;
      const { ctx, page } = await h.open(seed(h, destination ? { 'dbt.audio.v1': JSON.stringify(destination) } : {}), '');
      const expected = { master: .2, music: .3, sfx: .4, muted };
      try {
        await ready(page);
        await page.evaluate(({ expected, blockedRestore }) => {
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, ...args) {
            if (key === 'dbt.audio.v1') throw new DOMException('Storage full', 'QuotaExceededError');
            return set.call(this, key, ...args);
          };
          window.restoreAudioStorage = () => { Storage.prototype.setItem = set; };
          window.__daily.opts.volume.set(expected);
          if (!blockedRestore) window.restoreAudioStorage();
        }, { expected, blockedRestore });
        const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
        raw.settings.sound = true;
        if (sourceAudio) raw.preferences = { audio: { v: 1, master: .9, music: .8, sfx: .7, muted: false } };
        await restore(page, raw);
        assert.deepEqual(await page.evaluate(() => window.__daily.opts.volume.get()), expected);
        const status = await page.locator('.dq-settings .dq-hint[aria-live]').textContent();
        if (blockedRestore) {
          h.expect(/choices couldn't be saved/.test(status), 'Restore hid an unsaved live choice when no backup field changed.');
          assert.deepEqual(JSON.parse(await h.ls(page, 'dbt.audio.v1')), destination);
          await page.evaluate(() => window.restoreAudioStorage());
          await restore(page, raw);
        }
        const persisted = JSON.parse(await h.ls(page, 'dbt.audio.v1'));
        assert.deepEqual(persisted, { v: 1, ...expected }, 'Restore left a retained live choice only in memory.');
        await page.reload();
        await ready(page);
        const reloaded = await page.evaluate(() => window.__daily.opts.volume.get());
        assert.deepEqual(reloaded, expected, 'A reload reverted a choice after Restore reported success.');
        results.push({ destination, muted, sourceAudio, blockedRestore, expected, persisted, reloaded, status });
      } finally { await ctx.close(); }
    }
    fs.writeFileSync(path.join(h.out, 'audio-choice-recovery.json'), JSON.stringify(results, null, 2));
  },

  async 'crystal-live-audio-export'(h) {
    const old = { v: 1, master: .8, music: .7, sfx: .6, muted: true };
    const cases = [[null, false], [null, true], [old, false], [old, true], [null, null]];
    for (const [index, [stored, muted]] of cases.entries()) {
      const expected = muted === null ? { master: 1, music: 1, sfx: 1, muted: false } : { master: .2, music: .3, sfx: .4, muted };
      const { ctx, page } = await h.open(seed(h, stored ? { 'dbt.audio.v1': JSON.stringify(stored) } : {}));
      let exported;
      try {
        await ready(page);
        if (muted !== null) await page.evaluate((expected) => {
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, ...args) {
            if (key === 'dbt.audio.v1') throw new DOMException('Storage full', 'QuotaExceededError');
            return set.call(this, key, ...args);
          };
          try { window.__daily.opts.volume.set(expected); }
          finally { Storage.prototype.setItem = set; }
        }, expected);
        assert.deepEqual(JSON.parse(await h.ls(page, 'dbt.audio.v1')), stored);
        exported = await crystal(h, page, 'live-audio-' + index);
        assert.deepEqual(exported.preferences?.audio, { v: 1, ...expected });
        h.expect(exported.incomplete === false, 'Readable live choices produced an incomplete crystal.');
        if (muted === null) h.expect(await page.evaluate(() => window.__daily.opts.volume.get().muted), 'Export removed the temporary mute.');
      } finally { await ctx.close(); }
      const target = await h.open(seed(h), '');
      try {
        await ready(target.page);
        await restore(target.page, exported);
        assert.deepEqual(await target.page.evaluate(() => window.__daily.opts.volume.get()), expected);
      } finally { await target.ctx.close(); }
    }
  },

  async 'crystal-old-fixture'(h) {
    const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    h.expect(raw.v === 1 && !raw.preferences, 'Fixture must remain an actual v1 crystal exported by main.');
    const { ctx, page } = await h.open(seed(h));
    try {
      await ready(page);
      await restore(page, raw);
      const actual = await crystal(h, page, 'old-fixture-restored');
      h.expect(actual.profile.playerName === 'Kit' && actual.profile.companion === 'Lumen', 'Old crystal lost names.');
      h.expect(actual.diary['2026-01-02'].note === 'A quiet afternoon.', 'Old crystal lost diary.');
      h.expect(actual.stories.chapters.some((c) => c.text === 'A chapter to keep.'), 'Old crystal lost story.');
    } finally { await ctx.close(); }
  },

  async 'diary-immediate-exports'(h) {
    const { ctx, page } = await h.open(seed(h));
    try {
      await ready(page);
      await go(page, 'diary');
      const results = {};
      for (const mode of ['Copy text', 'Share or save', 'download']) {
        const note = 'Latest note for ' + mode;
        const pending = mode === 'download' ? page.waitForEvent('download') : null;
        await page.evaluate(({ mode, note }) => {
          const input = document.querySelector('textarea, input[placeholder="A note for today (optional)"]');
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.exportedDiary = text; } } });
          Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => mode !== 'download' });
          Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => { window.exportedDiary = await files[0].text(); } });
          window.exportedDiary = '';
          input.value = note;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          [...document.querySelectorAll('button')].find((b) => b.textContent === (mode === 'download' ? 'Share or save' : mode)).click();
        }, { mode, note });
        if (pending) {
          const download = await pending;
          const file = path.join(h.out, 'latest-diary.txt');
          await download.saveAs(file);
          results[mode] = fs.readFileSync(file, 'utf8').includes(note);
        } else {
          await page.waitForFunction(() => window.exportedDiary !== '');
          results[mode] = (await page.evaluate(() => window.exportedDiary)).includes(note);
        }
      }
      fs.writeFileSync(path.join(h.out, 'diary-exports.json'), JSON.stringify(results, null, 2));
      await page.getByText('Preview', { exact: true }).click();
      h.expect(await page.locator('.dq-pre').textContent().then((t) => t.includes('Latest note for download')), 'Diary preview is stale.');
      h.expect(Object.values(results).every(Boolean), 'Immediate diary exports lost visible text: ' + JSON.stringify(results));
    } finally { await ctx.close(); }
  },

  async 'crystal-large-story'(h) {
    const text = 'word '.repeat(50000).trim();
    const { ctx, page } = await h.open(seed(h));
    let raw;
    try {
      await ready(page);
      await page.evaluate(async (text) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { first } = await ss.create('Long story');
        await ss.saveChapter({ ...first, text }, [first.rev]);
      }, text);
      raw = await crystal(h, page, 'long-story');
      h.expect(raw.stories.chapters.some((c) => c.text === text), '50k-word story was truncated on export.');
    } finally { await ctx.close(); }
    const target = await h.open(seed(h));
    try {
      await ready(target.page);
      await restore(target.page, raw);
      const actual = await crystal(h, target.page, 'restored-long-story');
      h.expect(actual.stories.chapters.some((c) => c.text === text), '50k-word story was truncated on restore.');
    } finally { await target.ctx.close(); }
  },
};
