// Each save notes which clear of this game's data it was written after (afterClear, the dbt.cleared id then):
//   old-save-never-cleared    a save from before that note, on a device never cleared, loads whole and is noted as
//                             written after no clear the next time it is saved
//   old-save-after-a-clear    the same save on a device that has cleared since is the game now: it loads whole and is
//                             noted with that clear straight away
//   save-from-before-a-clear  a save noted with an earlier clear (a copy held up mid-save wrote it after the clear) is
//                             cleared data: the game opens as a first visit, none of it shows, and it is written over
//   crystal-leaves-clear-out  a Save Crystal never carries the note, and a restore takes the note of the device it is
//                             restored on
//   late-save-while-away      a save from before a clear lands while an open copy is away and hears nothing: back in
//                             view, that copy writes its game back over it, so a reload straight after keeps everything
//   late-same-names           a copy held up as it stores its names again, unchanged, through a whole clear in another
//                             tab: once it hears of the clear the names go again, and a new game's own write stays
//   late-story-words          the same with a copy held up as it mirrors a chapter's words beside the save
import fs from 'node:fs';
import path from 'node:path';

const CLEARED = 'dbt.cleared';
const t = Date.now() - 2 * 86400000;
const day = new Date(t - 6 * 3600000).toISOString().slice(0, 10);
/** A save with progress, a name and Motion: Reduced, as a build from before the note wrote it. */
const OLD = {
  v: 1,
  created: t,
  events: [
    { id: 'old-visit', k: 'visit', xp: 10, t, day },
    { id: 'old-skill', k: 'skill', skill: 'wise-mind', stat: 'sense', xp: 20, t: t + 1000, day },
  ],
  settings: { sound: true, motion: 'reduce', emotionRows: ['Calm'], urgeRows: [] },
  profile: { playerName: 'Robin', setAt: { playerName: t } },
  setAt: { motion: t },
};

/** In the page opened with ?held: a write to a key matching window.__hold stops in the debugger first, once. */
const holding = (ctx) =>
  ctx.addInitScript(() => {
    if (!location.search.includes('held')) return;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === localStorage && window.__hold && new RegExp(window.__hold).test(k)) {
        window.__hold = '';
        debugger;
      }
      return set.call(this, k, v);
    };
  });

/**
 * A copy that can be held up (see holding) on a device holding `seed`. Seeded here once rather than by open(), which
 * seeds every new tab and so would put the old save back in the tabs that clear and begin a new game.
 */
async function heldCopy(h, seed) {
  const o = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', undefined, holding);
  await o.page.evaluate((s) => Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v)), seed);
  await o.page.goto(h.server.url + '/?mute&held');
  return o;
}

/**
 * Holds the copy `page` (from heldCopy) inside its write of a key matching `pattern`, which `start` (source run in
 * it) begins, through a real clear in a second tab, while a new game in a third tab stores something of its own (`own`,
 * run there, returns its key). Then lets it go and returns whether the late write landed, how the held copy stopped
 * (it shows the clear, or reloads into the new game), and what is stored under the late key and the new game's key then.
 */
async function heldThroughClear(h, ctx, page, pattern, start, own) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Debugger.enable');
  const stopped = new Promise((r) => cdp.once('Debugger.paused', r));
  const begun = cdp.send('Runtime.evaluate', { expression: `window.__hold = ${JSON.stringify(pattern)}; (${start})()`, awaitPromise: true });
  await stopped;
  const clearer = await ctx.newPage();
  await clearer.goto(h.server.url + '/?mute');
  await clearer.waitForFunction(() => !!window.__daily?.store, null, { timeout: 30000 });
  await clearer.evaluate(async () => {
    const hold = await (await import('/src/core/cleared.ts')).holdAll();
    hold.clear();
    void (await import('/src/daily/clear.ts')).clearGame();
  });
  await clearer.waitForFunction((k) => localStorage.getItem(k) !== 'k1.abc', CLEARED);
  const next = await ctx.newPage();
  await next.goto(h.server.url + '/?mute');
  await next.waitForFunction(() => !!window.__daily?.store, null, { timeout: 30000 });
  const ownKey = await next.evaluate(own);
  await clearer.evaluate((p) => {
    window.__landed = [];
    window.addEventListener('storage', (e) => e.newValue !== null && new RegExp(p).test(e.key) && window.__landed.push(e.key));
  }, pattern);
  let reloaded = false;
  page.once('load', () => (reloaded = true));
  await cdp.send('Debugger.resume');
  await begun.catch(() => undefined);
  await cdp.detach().catch(() => undefined);
  let shown = null;
  for (const end = Date.now() + 15000; !shown && Date.now() < end; await h.sleep(200))
    shown = reloaded ? 'reloaded' : ((await page.evaluate(async () => (await import('/src/core/cleared.ts')).cleared()).catch(() => false)) && 'cleared');
  const [late] = await clearer.evaluate(() => window.__landed);
  const [lateNow, ownNow] = await next.evaluate(([a, b]) => [a ? localStorage.getItem(a) : null, localStorage.getItem(b)], [late, ownKey]);
  return { landed: !!late, shown, late: lateNow, own: ownNow };
}

const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
const held = (page) => page.evaluate(() => ({ events: window.__daily.store.state.events.map((e) => e.id), name: window.__daily.store.state.settings.playerName, motion: window.__daily.store.state.settings.motion, reduced: window.__daily.reduced() }));

export const scenarios = {
  async 'old-save-never-cleared'(h) {
    const { open, expect, SEEN, SAVE } = h;
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN, [SAVE]: JSON.stringify(OLD) });
    try {
      await h.reachHub(page);
      const mine = await held(page);
      expect(mine.events.includes('old-visit') && mine.events.includes('old-skill') && mine.name === 'Robin' && mine.motion === 'reduce', 'the old save did not load whole: ' + JSON.stringify(mine));
      await page.evaluate(() => window.__daily.store.save());
      const s = await stored(page, SAVE);
      expect(Object.prototype.hasOwnProperty.call(s, 'afterClear') && s.afterClear === null, 'the save is not noted as written after no clear: ' + JSON.stringify(s.afterClear));
      expect(s.events.some((e) => e.id === 'old-skill') && (await page.evaluate((k) => localStorage.getItem(k), CLEARED)) === null, 'saving lost progress, or noted a clear that never happened');
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'old-save-after-a-clear'(h) {
    const { open, expect, SEEN, SAVE } = h;
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN, [CLEARED]: 'k1.abc', [SAVE]: JSON.stringify(OLD) });
    try {
      await page.waitForFunction(() => !!window.__daily?.store, null, { timeout: 30000 });
      // noted as the game now as it opens, before anything else is saved
      const first = await stored(page, SAVE);
      await h.reachHub(page);
      const mine = await held(page);
      expect(mine.events.includes('old-visit') && mine.events.includes('old-skill') && mine.name === 'Robin' && mine.motion === 'reduce' && mine.reduced, 'the old save did not load whole as the game now: ' + JSON.stringify(mine));
      expect(first.afterClear === 'k1.abc' && first.events.some((e) => e.id === 'old-skill'), 'the old save was not noted with the clear it came after: ' + JSON.stringify({ afterClear: first.afterClear }));
      expect(!(await page.locator('.dq-cleared').count()), 'the game says it was cleared');
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'save-from-before-a-clear'(h) {
    const { open, expect, SEEN, SAVE } = h;
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN, [CLEARED]: 'k2.def', [SAVE]: JSON.stringify({ ...OLD, afterClear: 'k1.abc' }) });
    try {
      await h.reachHub(page);
      const mine = await held(page);
      expect(!mine.events.some((id) => id.startsWith('old-')) && mine.name === '' && mine.motion === 'system' && !mine.reduced, 'progress, a name or a choice from before the clear came back: ' + JSON.stringify(mine));
      const s = await stored(page, SAVE);
      expect(s.afterClear === 'k2.def' && !s.events.some((e) => e.id.startsWith('old-')) && !JSON.stringify(s).includes('Robin'), 'the save from before the clear was not written over: ' + JSON.stringify({ afterClear: s.afterClear, events: s.events.map((e) => e.id) }));
      expect(!(await page.evaluate(() => Object.keys(localStorage).some((k) => k.includes('.unreadable')))), 'the save from before the clear was kept aside as unreadable');
      await h.shot(page, 'save-from-before-a-clear');
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'late-save-while-away'(h) {
    const { open, expect, SEEN, SAVE } = h;
    const away = (ctx) =>
      ctx.addInitScript(() => {
        const stop = (e) => window.__away && e.stopImmediatePropagation();
        for (const t of ['storage', 'focus', 'pageshow', 'visibilitychange']) window.addEventListener(t, stop, true);
      });
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN, [CLEARED]: 'k1.abc', [SAVE]: JSON.stringify({ ...OLD, afterClear: 'k1.abc' }) }, '?mute', undefined, away);
    try {
      await h.reachHub(page);
      const added = await page.evaluate(() => window.__daily.store.skillEvent('stop').id);
      await page.evaluate((k) => {
        window.__away = true;
        localStorage.setItem(k, JSON.stringify({ v: 1, created: 1, events: [{ id: 'late-visit', k: 'visit', xp: 10, t: 1, day: '2026-01-01' }], afterClear: 'k0.old' }));
      }, SAVE);
      await page.evaluate(() => {
        window.__away = false;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.reload();
      await page.waitForFunction(() => !!window.__daily?.store, null, { timeout: 30000 });
      const mine = await held(page);
      expect(['old-visit', 'old-skill', added].every((id) => mine.events.includes(id)) && !mine.events.includes('late-visit') && mine.name === 'Robin', 'the reload lost this copy\'s game, or took in the late save: ' + JSON.stringify(mine));
      expect((await stored(page, SAVE)).afterClear === 'k1.abc', 'the late save is still stored');
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'late-same-names'(h) {
    const { expect, SAVE, YOU } = h;
    const you = { name: 'Robin', companion: 'Pip', nameAt: t, companionAt: t };
    const { ctx, page, errors } = await heldCopy(h, { [CLEARED]: 'k1.abc', [SAVE]: JSON.stringify({ ...OLD, afterClear: 'k1.abc' }), [YOU]: JSON.stringify(you) });
    try {
      await h.reachHub(page);
      const again = `async () => (await import('/src/core/you.ts')).writeYou(${JSON.stringify(you)})`;
      const r = await heldThroughClear(h, ctx, page, '^dbt\\.you\\.v1$', again, async () => {
        const { setStored, write } = await import('/src/core/cleared.ts');
        write(() => setStored('dbt.lantern.v1.moment-length', '3'));
        return 'dbt.lantern.v1.moment-length';
      });
      expect(r.landed, 'the held-up names never landed after the clear, so this checks nothing');
      expect(r.shown && r.late === null, 'names stored again, unchanged, by a copy held up through the clear are still there: ' + JSON.stringify(r));
      expect(r.own === '3', 'the new game lost what it stored: ' + JSON.stringify(r));
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'late-story-words'(h) {
    const { expect, SAVE } = h;
    const { ctx, page, errors } = await heldCopy(h, { [CLEARED]: 'k1.abc', [SAVE]: JSON.stringify({ ...OLD, afterClear: 'k1.abc' }) });
    try {
      await h.reachHub(page);
      const mirror = `async () => {
        const { StoryStore } = await import('/src/daily/storystore.ts');
        return new StoryStore('dbt.lantern.v1.story', 'dbt.lantern.v1.story.live').setLive({ chapter: 'old-page', text: 'Words written before the clear', bases: [] });
      }`;
      const r = await heldThroughClear(h, ctx, page, '\\.story\\.live\\.', mirror, async () => {
        const { StoryStore } = await import('/src/daily/storystore.ts');
        new StoryStore('dbt.lantern.v1.story', 'dbt.lantern.v1.story.live').setLive({ chapter: 'new-page', text: "A new game's words", bases: [] });
        return Object.keys(localStorage).find((k) => k.endsWith('.new-page'));
      });
      expect(r.landed, 'the held-up words never landed after the clear, so this checks nothing');
      expect(r.shown && r.late === null, 'chapter words mirrored by a copy held up through the clear are still there: ' + JSON.stringify(r));
      expect(/A new game/.test(r.own ?? ''), 'the new game lost its words: ' + JSON.stringify(r));
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'crystal-leaves-clear-out'(h) {
    const { open, expect, SEEN, SAVE } = h;
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN, [CLEARED]: 'k1.abc', [SAVE]: JSON.stringify({ ...OLD, afterClear: 'k1.abc' }) });
    let other;
    try {
      await h.openSettings(page);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save Crystal', exact: true }).click()]);
      const file = path.join(h.out, 'crystal-leaves-clear-out.json');
      await dl.saveAs(file);
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(!Object.prototype.hasOwnProperty.call(raw, 'afterClear') && !fs.readFileSync(file, 'utf8').includes('k1.abc'), 'the Save Crystal carries this device\'s clear note');
      expect(raw.events.some((e) => e.id === 'old-skill') && raw.profile.playerName === 'Robin', 'the Save Crystal lost progress or names');

      // restored on a device with a clear of its own, even from a file that names another device's clear
      other = await open({ 'dbt.app.v1': SEEN, [CLEARED]: 'k9.xyz' });
      await h.openSettings(other.page);
      await other.page.locator('input[type=file]').setInputFiles({ name: 'crystal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...raw, afterClear: 'k1.abc' })) });
      await other.page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
      await other.page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      const s = await stored(other.page, SAVE);
      expect(s.afterClear === 'k9.xyz', 'the restored save is not noted with this device\'s clear: ' + JSON.stringify(s.afterClear));
      expect(s.events.some((e) => e.id === 'old-skill') && s.profile.playerName === 'Robin', 'the restore lost progress or names');
      expect(!errors.length && !other.errors.length, [...errors, ...other.errors].join('\n'));
    } finally {
      await ctx.close();
      await other?.ctx.close();
    }
  },
};
