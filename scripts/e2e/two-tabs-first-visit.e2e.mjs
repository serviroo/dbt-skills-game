// Two open copies of the game that each begin or change the save are one game, never a clear:
//   first-visit-two-tabs     two tabs open at once on a device with no save yet, the second one slow (its CPU at a
//                            quarter speed, and the first tab's save not yet reaching it, so it stores a game of its
//                            own). Neither reloads or says the game was cleared, and both end on one game holding both
//                            tabs' visits
//   restore-in-another-tab   a Save Crystal restored in one tab, older than the save it joins, reaches the other open
//                            tab as more progress: no reload, no clear notice
import fs from 'node:fs';
import path from 'node:path';

/** What a tab holds and the save as stored, side by side: the events by id, when the game began, and what it shows. */
const view = (page, key) =>
  page.evaluate((k) => {
    const s = window.__daily.store.state;
    const stored = JSON.parse(localStorage.getItem(k) ?? 'null');
    return {
      marker: window.__marker ?? null,
      cleared: !!document.querySelector('.dq-cleared'),
      created: s.created,
      events: s.events.map((e) => e.id).sort(),
      stored: stored && { created: stored.created, events: stored.events.map((e) => e.id).sort() },
    };
  }, key);

/** Waits until every tab holds what is stored (both tabs settled on one game), or returns what they hold after 15 s. */
async function oneGame(h, pages) {
  let views = [];
  for (const end = Date.now() + 15000; Date.now() < end; await h.sleep(200)) {
    views = await Promise.all(pages.map((p) => view(p, h.SAVE).catch((e) => ({ unreadable: e.message.split('\n')[0] }))));
    const same = (v) => v.stored && JSON.stringify([v.created, v.events]) === JSON.stringify([v.stored.created, v.stored.events]);
    if (views.every(same) && new Set(views.map((v) => JSON.stringify(v.stored))).size === 1) break;
  }
  return views;
}

export const scenarios = {
  async 'first-visit-two-tabs'(h) {
    const { open, expect, SEEN, SAVE } = h;
    const { ctx, page: first, errors } = await open({ 'dbt.app.v1': SEEN }, '?mute');
    try {
      await first.waitForFunction((k) => !!window.__daily?.store && localStorage.getItem(k) !== null, SAVE, { timeout: 30000 });
      const mine = await first.evaluate(() => ((window.__marker = 'no reload'), window.__daily.store.state.events.map((e) => e.id)));
      let reloads = 0;
      first.on('load', () => reloads++);

      const second = await ctx.newPage();
      second.on('pageerror', (e) => errors.push('pageerror in the second tab: ' + e.message));
      // a slow tab's storage can lag a write another tab just made: until this one stores its own game, it reads no save
      await second.addInitScript((key) => {
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        let behind = true;
        Storage.prototype.getItem = function (k) {
          return behind && this === localStorage && k === key ? null : get.call(this, k);
        };
        Storage.prototype.setItem = function (k, v) {
          set.call(this, k, v);
          if (this === localStorage && k === key) behind = false;
        };
      }, SAVE);
      const cdp = await ctx.newCDPSession(second);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await second.goto(first.url());
      await second.waitForFunction(() => !!window.__daily?.store, null, { timeout: 60000 });
      await second.evaluate(() => (window.__marker = 'no reload'));
      const theirs = await second.evaluate(() => window.__daily.store.state.events.map((e) => e.id));

      const [a, b] = await oneGame(h, [first, second]);
      await h.shot(first, 'first-tab');
      await h.shot(second, 'second-tab');
      expect(!reloads && a.marker === 'no reload' && b.marker === 'no reload', `a tab reloaded as if the game was cleared elsewhere: ${JSON.stringify({ reloads, first: a.marker, second: b.marker })}`);
      expect(!a.cleared && !b.cleared, `a tab says the game was cleared: ${JSON.stringify({ first: a.cleared, second: b.cleared })}`);
      expect(theirs.some((id) => !mine.includes(id)), 'the second tab read the first tab\'s save, so it never began a game of its own: ' + JSON.stringify({ mine, theirs }));
      const all = [...new Set([...mine, ...theirs])].sort();
      for (const [name, v] of [['first', a], ['second', b]])
        expect(JSON.stringify(v.events) === JSON.stringify(all) && JSON.stringify(v.stored?.events) === JSON.stringify(all), `the ${name} tab does not hold one game with both tabs' visits: ${JSON.stringify({ want: all, holds: v.events, stored: v.stored?.events })}`);
      expect(a.created === b.created && a.created === a.stored.created, 'the two tabs disagree on when the game began: ' + JSON.stringify([a.created, b.created, a.stored.created]));
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'restore-in-another-tab'(h) {
    const { open, expect, SEEN, SAVE } = h;
    const t = Date.now() - 2 * 86400000;
    const day = new Date(t - 6 * 3600000).toISOString().slice(0, 10);
    const save = { v: 1, created: t, events: [{ id: 'seed-visit', k: 'visit', xp: 10, t, day }] };
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN, [SAVE]: JSON.stringify(save) }, '?mute');
    try {
      await h.openSettings(page);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save Crystal', exact: true }).click()]);
      const file = path.join(h.out, 'save-crystal.json');
      await dl.saveAs(file);
      // a Save Crystal from a game begun earlier, with progress this device hasn't seen
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      raw.created = t - 30 * 86400000;
      raw.events.push({ id: 'crystal-skill', k: 'skill', skill: 'wise-mind', stat: 'sense', xp: 20, t: t - 1000, day });

      const other = await ctx.newPage();
      other.on('pageerror', (e) => errors.push('pageerror in the other tab: ' + e.message));
      await other.goto(page.url());
      await h.reachHub(other);
      await other.evaluate(() => (window.__marker = 'no reload'));
      let reloads = 0;
      other.on('load', () => reloads++);

      await page.bringToFront();
      await page.locator('input[type=file]').setInputFiles({ name: 'crystal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
      await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
      await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
      await other.bringToFront();
      await other.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

      const [, b] = await oneGame(h, [page, other]);
      await h.shot(other, 'other-tab');
      expect(!reloads && b.marker === 'no reload' && !b.cleared, `the other tab took the restore for a clear: ${JSON.stringify({ reloads, marker: b.marker, cleared: b.cleared })}`);
      expect(b.events.includes('crystal-skill') && b.events.includes('seed-visit') && b.created === raw.created, 'the other tab did not take the restored progress: ' + JSON.stringify(b));
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
