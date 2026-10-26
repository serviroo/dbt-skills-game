// Peek inside a Save Crystal: choosing a file only shows what it holds; Restore is its own step, and every way out
// leaves this device exactly as it was.
import fs from 'node:fs';
import path from 'node:path';

const CONFIRM = 'Restore this Save Crystal';
const stroke = [{ i: 1, w: 3, p: [20, 20, 80, 80] }];
const drawing = (id, day, updated) => ({ id, kind: 'today', day, t: updated, updated, n: 1, strokes: stroke });
const entry = (day, note) => ({ day, emotions: { Calm: 3 }, urges: {}, note, updatedAt: 10 });
const today = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function here(h) {
  const day = today();
  return {
    [h.SAVE]: JSON.stringify({
      v: 1,
      created: Date.UTC(2025, 10, 5, 12),
      events: [
        { id: 'here-visit', k: 'visit', xp: 10, t: 1, day },
        { id: 'here-wise', k: 'skill', skill: 'wise-mind', xp: 20, t: 2, day: '2026-01-05' },
        { id: 'here-stop', k: 'card', skill: 'stop', xp: 5, t: 3, day: '2026-01-06' },
      ],
      diary: { '2026-01-05': entry('2026-01-05', 'Here day one.'), '2026-01-06': entry('2026-01-06', 'Here day two.') },
      flags: { greetDay: day, therapistLineShown: true },
      profile: { playerName: 'Robin', companion: 'Pip', setAt: { playerName: 1000, companion: 1000 } },
    }),
    [h.YOU]: JSON.stringify({ name: 'Robin', companion: 'Pip', nameAt: 1000, companionAt: 1000 }),
    'dbt.app.v1': h.SEEN,
  };
}

function crystal(over = {}) {
  return {
    app: 'the-quiet-lantern',
    v: 2,
    exported: '2026-10-20T12:00:00.000Z',
    created: Date.UTC(2026, 2, 12, 12),
    events: [
      { id: 'file-visit', k: 'visit', xp: 10, t: 10, day: '2026-03-12' },
      { id: 'file-wise', k: 'skill', skill: 'wise-mind', xp: 20, t: 11, day: '2026-03-12' },
      { id: 'file-tipp-1', k: 'skill', skill: 'tipp', xp: 20, t: 12, day: '2026-03-13' },
      { id: 'file-tipp-2', k: 'skill', skill: 'tipp', xp: 20, t: 13, day: '2026-03-14' },
      { id: 'file-card', k: 'card', skill: 'stop', xp: 5, t: 14, day: '2026-03-14' },
      { id: 'file-wise', k: 'skill', skill: 'clear-sight', xp: 20, t: 15, day: '2026-03-14' },
      { id: 'file-unknown', k: 'skill', skill: 'not-a-skill', xp: 20, t: 16, day: '2026-03-14' },
      { id: 'file-checkin', k: 'checkin', skill: 'sense-up', xp: 5, t: 17, day: '2026-03-14' },
    ],
    diary: {
      '2026-03-12': entry('2026-03-12', 'File day one.'),
      '2026-03-13': entry('2026-03-13', 'File day two.'),
      '2026-03-14': entry('2026-03-14', 'File day three.'),
      '2026-02-30': entry('2026-02-30', 'Not a real day.'),
    },
    lists: { comfort: [{ id: 'file-comfort', text: 'Warm tea', at: 10 }], activities: [], reasons: [], people: [] },
    profile: { playerName: 'Wren', companion: 'Moss', setAt: { playerName: 50, companion: 50 } },
    art: [drawing('file-art-1', '2026-03-12', 100), drawing('file-art-2', '2026-03-13', 101), drawing('file-art-1', '2026-03-12', 90)],
    stories: {
      stories: [
        { id: 'file-story', title: 'The lighthouse', created: 200, updated: 210, rev: 'r2', chapters: ['file-page'], notes: '' },
        { id: 'file-story', title: 'The lighthouse, older', created: 200, updated: 205, rev: 'r1', chapters: ['file-page'], notes: '' },
        { id: 'file-gone', title: 'Put away', created: 220, updated: 230, rev: 'r1', chapters: [], notes: '', removed: 240 },
      ],
      chapters: [{ id: 'file-page', story: 'file-story', kind: 'page', title: 'Shore', text: 'File page words.', updated: 210, rev: 'r2' }],
      cards: {},
    },
    preferences: { room: { aquarium: true, words: false }, safeLight: 'dim' },
    ...over,
  };
}
const asFile = (raw, name = 'save-crystal-2026-10-20.json') => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw)) });
const SOURCE_ROWS = [
  ['Name', 'Wren'],
  ['Game began', '12 March 2026'],
  ['Crystal made', '20 October 2026'],
  ['Different skills practiced', '3'],
  ['Diary days', '3'],
  ['Saved drawings', '2'],
  ['Stories', '1'],
];

const UNION = {
  events: ['file-card', 'file-checkin', 'file-tipp-1', 'file-tipp-2', 'file-unknown', 'file-visit', 'file-wise', 'here-stop', 'here-visit', 'here-wise'],
  diary: ['2026-01-05', '2026-01-06', '2026-03-12', '2026-03-13', '2026-03-14'],
  name: 'Robin',
  comfort: ['Warm tea'],
  art: ['file-art-1', 'file-art-2', 'here-art'],
  stories: ['Here story', 'The lighthouse'],
  removed: ['file-gone'],
  chapters: ['File page words.'],
};
const card = (id, t, mode = 'continue', text = `Words on ${id}.`) => ({ id, mode, text, t });
const withCards = (cards) => crystal({ stories: { ...crystal().stories, cards } });

/**
 * What the app says as it goes: every chosen file's read ends with a crystal-read event (shown, turned down or dropped
 * for a later choice) and a preview that closes says crystal-closed. Checks that nothing happened wait for these, never
 * for a fixed time.
 */
const listen = (ctx) =>
  ctx.addInitScript(() => {
    window.__chosen = 0;
    window.__reads = [];
    window.__closed = 0;
    document.addEventListener('change', (e) => e.target?.type === 'file' && e.target.files?.length && window.__chosen++, true);
    document.addEventListener('crystal-read', (e) => window.__reads.push(e.detail));
    document.addEventListener('crystal-closed', () => window.__closed++);
  });
/** Every file chosen so far has been read to the end. */
const settled = (page) => page.waitForFunction(() => window.__reads.length === window.__chosen);

async function boot(h, viewport) {
  const opened = await h.open(here(h), '?mute', viewport, listen);
  const { page } = opened;
  page.on('dialog', (d) => {
    opened.errors.push('dialog: ' + d.message());
    void d.dismiss();
  });
  await page.waitForFunction(() => !!window.__daily);
  await page.evaluate(async () => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    const { artStore } = await import('/src/daily/artstore.ts');
    const key = window.__daily.store.key;
    await storyStore(key).create('Here story');
    await artStore(key).put({ id: 'here-art', kind: 'today', day: '2026-01-05', t: 1, updated: 1, n: 1, strokes: [{ i: 1, w: 3, p: [20, 20, 80, 80] }] });
  });
  await settings(page);
  return opened;
}
const settings = async (page) => {
  await page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
  await page.locator('#set-playerName').waitFor();
};
const route = (page) => page.evaluate(() => window.__daily.route.name);

const snapshot = (page) =>
  page.evaluate(async () => {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) ls[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    const req = (r) => new Promise((ok, bad) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => bad(r.error))));
    const idb = {};
    for (const { name } of (await indexedDB.databases()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const db = await req(indexedDB.open(name));
      for (const s of [...db.objectStoreNames].sort()) {
        const st = db.transaction(s, 'readonly').objectStore(s);
        const keys = st.getAllKeys(), values = st.getAll();
        idb[`${name}/${s}`] = JSON.stringify(await Promise.all([req(keys), req(values)]), (k, v) => (v instanceof Blob ? `blob:${v.size}:${v.type}` : v));
      }
      db.close();
    }
    return JSON.stringify({ ls: Object.fromEntries(Object.entries(ls).sort()), mem: window.__daily.store.state, idb });
  });
const same = async (h, page, before, how) => {
  const after = await snapshot(page);
  if (after === before) return;
  const a = JSON.parse(before), b = JSON.parse(after);
  const diff = [...new Set([...Object.keys(a.ls), ...Object.keys(b.ls)])].filter((k) => a.ls[k] !== b.ls[k]).concat(Object.keys(b.idb).filter((k) => a.idb[k] !== b.idb[k]), JSON.stringify(a.mem) === JSON.stringify(b.mem) ? [] : ['memory']);
  throw new Error(`${how} changed this device: ${diff.join(', ')}`);
};

const peekOpen = (page) => page.locator('.dq-peek:not(.is-hidden)');
const rows = (page) => page.$$eval('.dq-peek:not(.is-hidden) .dq-peek-row', (rs) => rs.map((r) => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]));
async function choose(page, file) {
  await page.locator('input[type=file]').setInputFiles(file);
  await peekOpen(page).waitFor({ timeout: 15000 });
  await page.evaluate(() => (window.__openedAt = window.__closed));
}
/** The preview chose() opened has closed: its own crystal-closed, not an earlier one. */
const dropped = (page) => page.waitForFunction(() => window.__closed > window.__openedAt);
const statusText = (page) => page.locator('.dq-settings .dq-hint[aria-live]').textContent();
const exact = (h, got, want, what) => h.expect(JSON.stringify(got) === JSON.stringify(want), `${what}: ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);

const holdReads = (page) =>
  page.evaluate(() => {
    const text = File.prototype.text;
    window.__held = [];
    File.prototype.text = function () {
      const f = this;
      return new Promise((ok, bad) => window.__held.push({ name: f.name, go: () => text.call(f).then(ok, bad) }));
    };
    window.__release = (name) => window.__held.splice(window.__held.findIndex((x) => x.name === name), 1)[0].go();
    window.__unhold = () => (File.prototype.text = text);
  });
const waitHeld = (page, name) => page.waitForFunction((n) => window.__held.some((x) => x.name === n), name);
const release = async (h, page, name) => {
  const before = await page.evaluate((n) => window.__reads.filter((r) => r.name === n).length, name);
  await page.evaluate((n) => window.__release(n), name);
  await page.waitForFunction(([n, k]) => window.__reads.filter((r) => r.name === n).length > k, [name, before]);
};

async function stored(page) {
  return page.evaluate(async () => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    const { artStore } = await import('/src/daily/artstore.ts');
    const a = window.__daily;
    const s = a.store.state;
    const art = await artStore(a.store.key).exportAll();
    const tales = await storyStore(a.store.key).exportAll();
    return {
      events: s.events.map((e) => e.id).filter((id) => /^(file|here|only|old)-/.test(id)).sort(),
      diary: Object.keys(s.diary).sort(),
      name: s.settings.playerName,
      comfort: s.lists.comfort.map((x) => x.text),
      art: art.records.map((r) => r.id).sort(),
      stories: tales.stories.filter((x) => !x.removed).map((x) => x.title).sort(),
      removed: tales.stories.filter((x) => x.removed).map((x) => x.id),
      chapters: tales.chapters.map((c) => c.text).filter(Boolean).sort(),
    };
  });
}

export const scenarios = {
  /** choosing a file shows what it holds and changes nothing; every way out leaves the device exactly as it was */
  async 'peek-inert-preview'(h) {
    const { ctx, page, errors } = await boot(h);
    const result = {};
    try {
      const before = await snapshot(page);
      await page.locator('input[type=file]').setInputFiles(asFile(crystal()));
      await settled(page);
      await same(h, page, before, 'choosing a Save Crystal');
      await peekOpen(page).waitFor();
      exact(h, await rows(page), SOURCE_ROWS, 'preview rows');
      const text = await peekOpen(page).innerText();
      h.expect(/save-crystal-2026-10-20\.json/.test(text), 'the preview does not name the chosen file');
      h.expect(/Restore adds what.s in this file to what.s already here\. Nothing here is removed, and choices you.ve made on this device stay as they are\./.test(text), 'the preview does not say Restore adds and keeps choices made here: ' + text);
      h.expect(!/incomplete|can.t be read/.test(text), 'a complete, readable file shows a warning');
      h.expect(await page.evaluate(() => document.activeElement?.id === 'dq-peek-h'), 'the preview heading did not take focus');
      await h.shot(page, 'inert-preview');

      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      h.expect(!(await peekOpen(page).count()), 'Cancel left the preview open');
      h.expect(/Closed without restoring\. Nothing changed\./.test(await statusText(page)), 'Cancel did not say nothing changed');
      h.expect(await page.evaluate(() => document.activeElement?.textContent === 'Restore'), 'Cancel did not return focus to Restore');
      await same(h, page, before, 'Cancel');

      await choose(page, asFile(crystal()));
      await page.keyboard.press('Escape');
      h.expect(!(await peekOpen(page).count()), 'Escape left the preview open');
      await same(h, page, before, 'Escape');

      await choose(page, asFile(crystal()));
      await page.getByRole('button', { name: 'Lantern', exact: true }).click();
      await page.waitForFunction(() => window.__daily.route.name === 'hub');
      await same(h, page, before, 'app Back');
      await settings(page);
      h.expect(!(await peekOpen(page).count()), 'the preview came back after app Back');

      await choose(page, asFile(crystal()));
      const safe = page.getByRole('button', { name: 'Safe Zone, help right now' });
      const box = await safe.boundingBox();
      h.expect(box && box.y >= 0 && box.y + box.height <= 844, 'Safe Zone is not one tap away with the preview open');
      await safe.click();
      h.expect((await route(page)) === 'safe', 'Safe Zone did not open from the preview');
      await same(h, page, before, 'entering the Safe Zone');
      await page.getByRole('button', { name: 'Leave', exact: true }).click();
      await page.waitForFunction(() => window.__daily.route.name === 'hub');
      await settings(page);
      h.expect(!(await peekOpen(page).count()), 'the preview came back after the Safe Zone');

      await choose(page, asFile(crystal()));
      await page.getByRole('button', { name: 'Diary card text' }).click();
      await page.waitForFunction(() => window.__daily.route.name === 'diary');
      await same(h, page, before, 'leaving Settings');
      await settings(page);

      await holdReads(page);
      await page.locator('input[type=file]').setInputFiles(asFile(crystal(), 'slow.json'));
      await waitHeld(page, 'slow.json');
      await page.evaluate(() => {
        window.__daily.go({ name: 'safe' }, { quiet: true });
        window.__daily.go({ name: 'settings' }, { quiet: true });
      });
      await release(h, page, 'slow.json');
      h.expect(!(await peekOpen(page).count()), 'a read that finished after leaving Settings opened a preview');
      await same(h, page, before, 'a read that finished after leaving Settings');
      exact(h, (await stored(page)).name, 'Robin', 'name after every exit');
      result.exits = ['cancel', 'escape', 'back', 'safe', 'leave', 'late-read'];
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally {
      await ctx.close();
    }
  },

  /** Restore is the explicit step: it brings the file's union in once, keeps it across a reload and a new Crystal */
  async 'peek-confirm-union'(h) {
    const { ctx, page, errors } = await boot(h);
    try {
      const source = crystal();
      await choose(page, asFile(source));
      await page.getByRole('button', { name: CONFIRM }).click();
      await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      h.expect(!(await peekOpen(page).count()), 'the preview stayed open after Restore');
      h.expect(await page.evaluate(() => document.activeElement?.textContent === 'Restore'), 'Restore did not return focus to the Restore button');
      const want = UNION;
      exact(h, await stored(page), want, 'after Restore');
      exact(h, await page.evaluate(() => window.__daily.store.state.events.find((e) => e.id === 'file-wise')?.skill), 'wise-mind', 'the first file-wise event');

      await page.reload();
      await page.waitForFunction(() => !!window.__daily);
      exact(h, await stored(page), want, 'after a reload');

      await settings(page);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save Crystal', exact: true }).click();
      const target = path.join(h.out, 'peek-after-restore.json');
      await (await pending).saveAs(target);
      const again = JSON.parse(fs.readFileSync(target, 'utf8'));
      for (const k of Object.keys(source)) h.expect(Object.hasOwn(again, k), 'the new Save Crystal lost the field ' + k);
      for (const id of want.events) h.expect(again.events.some((e) => e.id === id), 'the new Save Crystal lost the event ' + id);
      for (const d of want.diary) h.expect(!!again.diary[d], 'the new Save Crystal lost the diary day ' + d);
      exact(h, again.art.map((r) => r.id).sort(), want.art, 'drawings in the new Save Crystal');
      h.expect(again.stories.stories.some((s) => s.id === 'file-story') && again.stories.chapters.some((c) => c.text === 'File page words.'), 'the new Save Crystal lost the restored story');
      h.expect(again.lists.comfort.some((x) => x.text === 'Warm tea') && again.profile.playerName === 'Robin' && again.created === Date.UTC(2025, 10, 5, 12), 'the new Save Crystal lost lists, the name made here or the earlier start');
      h.expect(again.preferences?.room?.aquarium === true && again.preferences?.safeLight === 'dim', 'the new Save Crystal lost the restored choices');

      await choose(page, asFile(source));
      await page.getByRole('button', { name: CONFIRM }).click();
      await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      exact(h, await stored(page), want, 'after restoring the same Save Crystal again');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** old, partial, broken, duplicated, oddly dated and markup-named files, the same file twice, and reads out of order */
  async 'peek-file-cases'(h) {
    const { ctx, page, errors } = await boot(h);
    const missing = 'Not saved in this file';
    try {
      const before = await snapshot(page);
      const legacy = { v: 1, events: [{ id: 'old-tipp', k: 'skill', skill: 'tipp', xp: 20, t: 1, day: '2025-06-01' }], diary: { '2025-06-01': entry('2025-06-01', 'Old day.') } };
      await choose(page, asFile(legacy, 'old.json'));
      exact(h, await rows(page), [['Name', missing], ['Game began', missing], ['Crystal made', missing], ['Different skills practiced', '1'], ['Diary days', '1'], ['Saved drawings', '0'], ['Stories', '0']], 'legacy v1 rows');

      await choose(page, asFile(crystal({ incomplete: true })));
      h.expect(/This Save Crystal was incomplete when it was made\. Keep your other backups\./.test(await peekOpen(page).innerText()), 'an incomplete file shows no notice before Restore');

      const broken = crystal({ art: [...crystal().art, { id: 'bad-art', kind: 'today', day: '2026-03-12' }], stories: { ...crystal().stories, chapters: [...crystal().stories.chapters, { id: 'bad-page', story: 'file-story', kind: 'page' }] } });
      await choose(page, asFile(broken));
      exact(h, await rows(page), SOURCE_ROWS, 'rows with unreadable records left out');
      h.expect(/Some drawings or story pages in this file can.t be read, so they won.t be added\./.test(await peekOpen(page).innerText()), 'unreadable records were not called out');

      for (const [created, exported] of [['yesterday', '2026-02-30T10:00:00.000Z'], [1e17, 'soon'], [-5, 1792721961711]]) {
        await choose(page, asFile(crystal({ created, exported })));
        exact(h, (await rows(page)).slice(1, 3), [['Game began', missing], ['Crystal made', missing]], `dates ${JSON.stringify([created, exported])}`);
      }

      const fileName = '<img src=x onerror=alert(1)>{name}.json';
      await choose(page, asFile(crystal({ profile: { playerName: '<b>{companion}</b>', companion: 'Moss' } }), fileName));
      exact(h, (await rows(page))[0], ['Name', 'b{companion}/b'], 'a markup-like saved name');
      exact(h, await page.locator('.dq-peek .dq-peek-fname').textContent(), fileName, 'a markup-like file name');
      h.expect(!(await page.locator('.dq-peek img, .dq-peek-row b').count()), 'a name from the file became markup');

      for (const [file, said] of [
        [asFile('{"events": [', 'cut.json'), /doesn.t look like a Save Crystal/],
        [asFile({ app: 'another-app', events: [] }, 'other.json'), /doesn.t look like a Save Crystal/],
        [asFile([1, 2, 3], 'list.json'), /doesn.t look like a Save Crystal/],
      ]) {
        await page.locator('input[type=file]').setInputFiles(file);
        await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''), said.source);
        h.expect(!(await peekOpen(page).count()), 'an invalid file opened a preview: ' + file.name);
      }
      const big = path.join(h.out, 'peek-big.json');
      fs.writeFileSync(big, Buffer.alloc(81 * 1024 * 1024, 32));
      await page.locator('input[type=file]').setInputFiles(big);
      await page.waitForFunction(() => /too big/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      fs.rmSync(big);
      await page.evaluate(() => {
        const text = File.prototype.text;
        File.prototype.text = function () {
          File.prototype.text = text;
          return Promise.reject(new DOMException('gone', 'NotReadableError'));
        };
      });
      await page.locator('input[type=file]').setInputFiles(asFile(crystal()));
      await page.waitForFunction(() => /couldn.t be read/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      h.expect(!(await peekOpen(page).count()), 'an unreadable file opened a preview');

      await choose(page, asFile(crystal()));
      await choose(page, asFile(crystal()));
      h.expect((await page.locator('.dq-peek').count()) === 1, 'choosing the same file twice made two previews');
      exact(h, await rows(page), SOURCE_ROWS, 'the same file chosen again');
      await settled(page);
      await same(h, page, before, 'every preview above');

      const a = asFile(crystal({ profile: { playerName: 'Ash' }, events: [{ id: 'only-a', k: 'skill', skill: 'tipp', xp: 20, t: 1, day: '2026-03-12' }] }), 'a.json');
      const b = asFile(crystal({ profile: { playerName: 'Birch' }, events: [{ id: 'only-b', k: 'skill', skill: 'stop', xp: 20, t: 1, day: '2026-03-12' }] }), 'b.json');
      await holdReads(page);
      await page.locator('input[type=file]').setInputFiles(a);
      await waitHeld(page, 'a.json');
      await page.locator('input[type=file]').setInputFiles(b);
      await waitHeld(page, 'b.json');
      await release(h, page, 'a.json');
      h.expect(!(await peekOpen(page).count()), 'an earlier read showed while a later one was still open');
      await release(h, page, 'b.json');
      exact(h, (await rows(page))[0], ['Name', 'Birch'], 'the later file, reads in order');
      await page.locator('input[type=file]').setInputFiles(a);
      await waitHeld(page, 'a.json');
      h.expect(!(await peekOpen(page).count()), 'the old preview stayed while a new file was opening');
      await page.locator('input[type=file]').setInputFiles(b);
      await waitHeld(page, 'b.json');
      await release(h, page, 'b.json');
      exact(h, (await rows(page))[0], ['Name', 'Birch'], 'the later file, its read first');
      await release(h, page, 'a.json');
      exact(h, (await rows(page))[0], ['Name', 'Birch'], 'a slow earlier read replaced the later file');
      await same(h, page, before, 'reads out of order');
      await page.evaluate(() => window.__unhold());
      await page.getByRole('button', { name: CONFIRM }).click();
      await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      const ids = (await stored(page)).events;
      h.expect(ids.includes('only-b') && !ids.includes('only-a'), 'Restore applied the wrong file: ' + ids.join(','));
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** the preview fits phones, landscape and desktop, and works from the keyboard */
  async 'peek-fit-keys'(h) {
    const sizes = [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 844, height: 390 },
      { width: 1280, height: 800 },
    ];
    const fits = [];
    for (const viewport of sizes) {
      const { ctx, page, errors } = await boot(h, viewport);
      try {
        await choose(page, asFile(crystal({ incomplete: true, profile: { playerName: 'Wren Alder-Moonfield', companion: 'Moss' } }), 'save-crystal-2026-10-20-from-the-old-phone-before-the-move.json'));
        const tag = `${viewport.width}x${viewport.height}`;
        const below = await page.evaluate(() => document.querySelector('#dq-peek-h').getBoundingClientRect().top - document.querySelector('.dq-top').getBoundingClientRect().bottom);
        h.expect(below >= 0 && below < 80, `the preview heading opened ${below}px from the top bar at ${tag}`);
        await h.shot(page, `peek-${tag}`);
        await page.locator('.dq-peek .dq-actions').evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await h.shot(page, `peek-${tag}-end`);
        const fit = await page.evaluate(() => {
          const pk = document.querySelector('.dq-peek');
          const r = pk.getBoundingClientRect();
          const all = [...pk.querySelectorAll('*')].filter((e) => e.getClientRects().length);
          return {
            outside: all.filter((e) => { const b = e.getBoundingClientRect(); return b.left < r.left - 0.5 || b.right > r.right + 0.5; }).map((e) => e.className || e.tagName),
            clipped: [...pk.querySelectorAll('dt, dd, p, .dq-btn-t')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
            small: [...pk.querySelectorAll('dt, dd, p')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.textContent),
            wide: document.documentElement.scrollWidth > innerWidth || window.__daily.root.scrollWidth > window.__daily.root.clientWidth,
          };
        });
        fits.push({ tag, ...fit });
        h.expect(!fit.outside.length && !fit.clipped.length && !fit.small.length && !fit.wide, `the preview does not fit at ${tag}: ${JSON.stringify(fit)}`);
        const safe = await page.getByRole('button', { name: 'Safe Zone, help right now' }).boundingBox();
        h.expect(safe && safe.y >= 0 && safe.y + safe.height <= viewport.height && safe.x + safe.width <= viewport.width, `Safe Zone is off screen at ${tag}`);
        const active = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent);
        exact(h, await active(), 'dq-peek-h', `focus on open at ${tag}`);
        await page.keyboard.press('Tab');
        exact(h, await active(), CONFIRM, `first Tab at ${tag}`);
        await page.keyboard.press('Tab');
        exact(h, await active(), 'Cancel', `second Tab at ${tag}`);
        await page.keyboard.press('Shift+Tab');
        exact(h, await active(), CONFIRM, `Shift+Tab at ${tag}`);
        await page.keyboard.press('Escape');
        exact(h, await active(), 'Restore', `focus after Escape at ${tag}`);
        h.expect(!(await peekOpen(page).count()), `Escape left the preview open at ${tag}`);
        if (viewport.width === 390) {
          await choose(page, asFile(crystal()));
          await page.keyboard.press('Tab');
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
          exact(h, (await stored(page)).art, ['file-art-1', 'file-art-2', 'here-art'], 'drawings after a keyboard Restore');
        }
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
    return fits;
  },

  /** a co-writer card Restore would leave out is called out before Restore, a readable one never is */
  async 'peek-unreadable-cards'(h) {
    const { ctx, page, errors } = await boot(h);
    const warned = async () => /Some drawings or story pages in this file can.t be read, so they won.t be added\./.test(await peekOpen(page).innerText());
    const cardsHere = () =>
      page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        return (await storyStore(window.__daily.store.key).cards('file-page')).map((c) => [c.id, c.mode, c.text, c.t]).sort();
      });
    try {
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        await storyStore(window.__daily.store.key).putCards('file-page', [
          { id: 'file-newer', mode: 'whatif', text: 'Older words.', t: 3 },
          { id: 'here-card', mode: 'polish', text: 'A card made here.', t: 4 },
        ]);
      });
      const before = await snapshot(page);
      const twelve = Array.from({ length: 12 }, (_, i) => card(`file-card-${i}`, 20 + i));
      for (const [what, cards] of [
        ['twelve cards on one page', { 'file-page': twelve }],
        ['a card saved twice', { 'file-page': [...twelve, { ...twelve[0], text: 'Newer words.', t: 90 }] }],
        ['a card with no id, a card with a selection and a page not in the file', { 'file-page': [{ mode: 'polish', text: 'No id yet.', t: 3 }, { ...card('file-sel', 4, 'questions'), sel: { start: 0, end: 4, text: 'File' } }], 'other-page': [card('file-other', 5, 'whatif')] }],
        ['an empty list', { 'file-page': [] }],
      ]) {
        await choose(page, asFile(withCards(cards)));
        exact(h, await rows(page), SOURCE_ROWS, `rows with ${what}`);
        h.expect(!(await warned()), `readable cards were called unreadable: ${what}`);
      }
      for (const [what, cards] of [
        ['a card in a mode this app does not have', { 'file-page': [card('file-ok', 1), card('file-odd', 2, 'damaged-mode')] }],
        ['a card with no words', { 'file-page': [card('file-ok', 1), { id: 'file-blank', mode: 'continue', t: 2 }] }],
        ['a card that is not a card', { 'file-page': [card('file-ok', 1), 'loose words'] }],
        ['cards under an id that is not a page id', { 'not a page id!': [card('file-ok', 1)] }],
        ['a page whose cards are not a list', { 'file-page': card('file-ok', 1) }],
        ['thirteen cards on one page', { 'file-page': [...twelve, card('file-card-12', 40)] }],
        ['more pages of cards than a save holds', Object.fromEntries(Array.from({ length: 500 * 302 + 1 }, (_, i) => [`p${i}`, []]))],
      ]) {
        await choose(page, asFile(withCards(cards)));
        exact(h, await rows(page), SOURCE_ROWS, `rows with ${what}`);
        h.expect(await warned(), `no notice before Restore for ${what}`);
      }
      await settled(page);
      await same(h, page, before, 'previewing files with cards');

      const mixed = withCards({ 'file-page': [card('file-keep', 5, 'continue', 'A card to keep.'), card('file-newer', 9, 'whatif', 'Newer words.'), card('file-odd', 6, 'damaged-mode', 'Words in an unreadable card.')] });
      await choose(page, asFile(mixed, 'crystal-with-unreadable-card.json'));
      h.expect(await warned(), 'no notice before Restore for an unreadable card beside readable ones');
      await page.locator('.dq-peek .dq-peek-note').scrollIntoViewIfNeeded();
      await h.shot(page, 'unreadable-card-preview');
      await same(h, page, before, 'previewing a readable and an unreadable card');
      await page.getByRole('button', { name: CONFIRM }).click();
      await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      h.expect(/Some story pages or cards couldn.t be added\. Keep the Save Crystal file\./.test(await statusText(page)), 'Restore did not say a card was left out: ' + (await statusText(page)));
      exact(h, await stored(page), UNION, 'after Restore');
      exact(h, await cardsHere(), [['file-keep', 'continue', 'A card to keep.', 5], ['file-newer', 'whatif', 'Newer words.', 9], ['here-card', 'polish', 'A card made here.', 4]], 'cards after Restore');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** pages and cards Restore would leave out because of what is already here: the preview says exactly how many */
  async 'peek-warns-what-restore-leaves-out'(h) {
    const { ctx, page, errors } = await boot(h);
    try {
      const notice = () => page.locator('.dq-peek:not(.is-hidden) .dq-peek-here');
      const lostNote = () => page.locator('.dq-peek:not(.is-hidden) .dq-peek-lost');
      await choose(page, asFile(crystal()));
      h.expect(!(await notice().count()) && !(await lostNote().count()), 'a file that fits next to what is here warns that Restore leaves something out');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();

      // a story here whose page holds twelve cards, as many as a page can
      const local = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const s = storyStore(window.__daily.store.key);
        const { story, first } = await s.create('Shore story');
        await s.putCards(first.id, Array.from({ length: 12 }, (_, i) => ({ id: `here-k${i}`, mode: 'continue', text: `Card ${i} made here.`, t: i + 1 })));
        return { story: story.id, page: first.id };
      });
      const told = {
        stories: [{ id: 'file-story', title: 'The lighthouse', created: 200, updated: 210, rev: 'r2', chapters: ['file-page', local.page], notes: '' }],
        chapters: [
          { id: 'file-page', story: 'file-story', kind: 'page', title: 'Shore', text: 'File page words.', updated: 210, rev: 'r2' },
          // the id of the page here, in another story
          { id: local.page, story: 'file-story', kind: 'page', title: 'Borrowed', text: 'Words on a page id taken here.', updated: 220, rev: 'r1' },
          // a page whose story is neither in the file nor here
          { id: 'file-lost', story: 'file-elsewhere', kind: 'page', title: 'Lost', text: 'Words whose story is nowhere.', updated: 230, rev: 'r1' },
        ],
        // two more cards for the page that already holds twelve, and one for a page of the file
        cards: { [local.page]: [card('file-k1', 50, 'whatif', 'One card too many.'), card('file-k2', 51, 'polish', 'Two cards too many.')], 'file-page': [card('file-k3', 52)] },
      };
      const before = await snapshot(page);
      await choose(page, asFile(crystal({ stories: told }), 'crystal-that-collides.json'));
      await settled(page);
      await same(h, page, before, 'previewing a file whose pages collide with the ones here');
      const said = (await notice().textContent()) ?? '';
      const m = /^(\d+) story pages or cards in this file don.t fit with the stories already on this device, so Restore will leave them out\.$/.exec(said);
      h.expect(m, 'no notice of what Restore leaves out: ' + said);
      // the page whose story is nowhere is the file's gap, told apart from the clashes with what is here
      const gap = (await lostNote().count()) ? ((await lostNote().textContent()) ?? '') : '';
      h.expect(/^1 story page in this file belongs to a story that isn.t in the file or on this device, so Restore will leave it out\.$/.test(gap), 'no separate notice for the page whose story is in neither the file nor this device: ' + JSON.stringify(gap));
      h.expect(Number(m[1]) === 3, `the notice about this device counts ${m[1]} pages or cards, want 3 (the page whose id is taken here and two cards past what that page holds)`);
      h.expect(!(await page.locator('.dq-peek:not(.is-hidden) .dq-peek-note', { hasText: /can.t be read/ }).count()), 'a readable file says it can not be read');
      await notice().scrollIntoViewIfNeeded();
      await h.shot(page, 'leaves-out-preview');

      await page.getByRole('button', { name: CONFIRM }).click();
      await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      // what the file brought that is not here now, counted from what is stored
      const left = await page.evaluate(async (file) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const all = await storyStore(window.__daily.store.key).exportAll();
        const pages = file.chapters.filter((c) => !all.chapters.some((x) => x.text === c.text && x.story === c.story)).map((c) => c.id);
        const cards = Object.entries(file.cards).flatMap(([id, list]) => list.filter((c) => !(all.cards[id] ?? []).some((x) => x.id === c.id)).map((c) => c.id));
        return { pages, cards, here: (all.cards[file.chapters[1].id] ?? []).length };
      }, told);
      exact(h, left, { pages: [local.page, 'file-lost'], cards: ['file-k1', 'file-k2'], here: 12 }, 'what Restore left out');
      h.expect(Number(m[1]) + 1 === left.pages.length + left.cards.length, `the preview said ${m[1]} + 1 would be left out, Restore left out ${left.pages.length + left.cards.length}`);
      h.expect(/Some story pages or cards couldn.t be added/.test(await statusText(page)), 'Restore did not say pages or cards were left out');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Escape closes the preview wherever focus moved on Settings, changes nothing, and listens only while it is open */
  async 'peek-escape-outside'(h) {
    const { ctx, page, errors } = await boot(h);
    const cdp = await ctx.newCDPSession(page);
    const keyListeners = async () => {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
      return listeners.filter((l) => l.type === 'keydown').length;
    };
    const focus = () => page.evaluate(() => {
      const a = document.activeElement;
      return { at: a === document.body ? 'BODY' : a?.id || a?.getAttribute('aria-label') || a?.textContent, inside: !!a?.closest('.dq-peek') };
    });
    try {
      const before = await snapshot(page);
      const idle = await keyListeners();
      const closed = async (how, at) => {
        h.expect(!(await peekOpen(page).count()), `Escape left the preview open ${how}`);
        h.expect(!(await page.getByRole('button', { name: CONFIRM }).count()), `Restore this Save Crystal is still there ${how}`);
        h.expect(/Closed without restoring\. Nothing changed\./.test(await statusText(page)), `Escape did not say nothing changed ${how}`);
        exact(h, await focus(), { at, inside: false }, `focus after Escape ${how}`);
        exact(h, await route(page), 'settings', `screen after Escape ${how}`);
        await dropped(page);
        await same(h, page, before, `Escape ${how}`);
      };

      await choose(page, asFile(crystal()));
      await page.keyboard.press('Shift+Tab');
      exact(h, await focus(), { at: 'Diary card text', inside: false }, 'focus after Shift+Tab from the preview heading');
      await h.shot(page, 'escape-outside-focus');
      await page.keyboard.press('Escape');
      await closed('after Shift+Tab out of the preview', 'Diary card text');
      await h.shot(page, 'escape-outside-closed');

      await choose(page, asFile(crystal()));
      await page.locator('#set-playerName').click();
      await page.keyboard.type(' Ash');
      await page.keyboard.press('Escape');
      await closed('while typing a name', 'set-playerName');
      exact(h, await page.locator('#set-playerName').inputValue(), 'Robin Ash', 'the name being typed after Escape');
      await page.locator('#set-playerName').fill('Robin');

      await choose(page, asFile(crystal()));
      await page.getByRole('button', { name: 'Safe Zone, help right now' }).focus();
      await page.keyboard.press('Escape');
      await closed('on the Safe Zone button', 'Safe Zone, help right now');

      await choose(page, asFile(crystal()));
      const sound = page.getByRole('button', { name: 'Sound settings', exact: true });
      await sound.click();
      await page.getByRole('dialog', { name: 'Sound', exact: true }).waitFor({ timeout: 5000 });
      await page.keyboard.press('Escape');
      exact(h, { sound: await sound.getAttribute('aria-expanded'), focus: await focus(), preview: await peekOpen(page).count() }, { sound: 'false', focus: { at: 'Sound settings', inside: false }, preview: 1 }, 'the first Escape with Sound open');
      await page.keyboard.press('Escape');
      await closed('on the closed Sound button', 'Sound settings');

      await choose(page, asFile(crystal()));
      await page.getByText('This is skills practice in plain words', { exact: false }).click();
      exact(h, await focus(), { at: 'BODY', inside: false }, 'focus after a tap on plain text');
      await page.keyboard.press('Escape');
      await closed('after a tap on plain text', 'Restore');

      await choose(page, asFile(crystal()));
      await page.keyboard.press('Escape');
      await closed('on the preview heading', 'Restore');
      exact(h, await keyListeners(), idle, 'keydown listeners after every Escape above');

      await choose(page, asFile(crystal()));
      exact(h, await keyListeners(), idle + 1, 'keydown listeners while the preview is open');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      exact(h, await keyListeners(), idle, 'keydown listeners after Cancel');
      await choose(page, asFile(crystal()));
      await page.getByRole('button', { name: 'Safe Zone, help right now' }).click();
      h.expect((await route(page)) === 'safe', 'Safe Zone did not open from the preview');
      await page.getByRole('button', { name: 'Leave', exact: true }).click();
      await page.waitForFunction(() => window.__daily.route.name === 'hub');
      await settings(page);
      exact(h, await keyListeners(), idle, 'keydown listeners on Settings again after the Safe Zone');
      await same(h, page, before, 'every Escape and exit above');
      await choose(page, asFile(crystal()));
      await page.getByRole('button', { name: CONFIRM }).click();
      await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      exact(h, await keyListeners(), idle, 'keydown listeners after Restore');
      exact(h, await stored(page), UNION, 'after Restore');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
