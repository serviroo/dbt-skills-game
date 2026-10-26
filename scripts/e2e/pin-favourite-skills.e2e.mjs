// Pin favourite skills in the Skills list: a pin button beside each row puts the skill in "Your favourites" at the top.
// pins-move: module and loadout skills move into Your favourites in list order, each skill once; unpinning puts it back
// where it was. Mouse, Enter and Space all toggle without starting a skill or crediting anything, focus stays on the
// same skill's pin as the row moves, and opening the row beside it credits once.
// pins-filters: favourites follow the search and filters like every other row, the empty state hides them, Show all
// skills shows every skill once, and pinning with filters on keeps the filters.
// pins-saves: pins survive a reload and work offline; a Save Crystal brings every decision (unpins too) into an empty
// save; an older Crystal can't undo a newer unpin; equal times always settle on unpinned; an old save with no pins
// loads, and pins for skills this build doesn't know are kept but never shown.
// pins-two-tabs: two open copies pin different skills at once and both stay; an unpin in one survives the other saving
// stale data, and an equal-time tie settles on unpinned in both.
// pins-newer: in a save from a newer version, pinning here keeps the fields that version put on a pin and replaces a
// pin record this build can't read; Restore weighs a newer file's records by time, so an older one changes nothing
// and a later one wins, kept exactly as stored.
// pins-sizes: favourites with a long name and the pin focus ring at 390x844, 320x568, 844x390 and 1280x800.
import fs from 'node:fs';
import path from 'node:path';
import { credits, returning, toHub } from './skill-check.e2e.mjs';
import { offsite, SIZES } from './choose-ask-refusal-strength.e2e.mjs';
import { catalogue, choose, control, fitLibrary, listOrder, openLibrary, shows, view } from './find-skills.e2e.mjs';
import { newerSave, restore } from './newer-save-safety.e2e.mjs';

const PHONE = { width: 390, height: 844 };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byKey = (o) => Object.entries(o ?? {}).sort((x, y) => (x[0] < y[0] ? -1 : 1));
const sameMap = (a, b) => same(byKey(a), byKey(b));
const pinOf = (page, id) => page.locator(`.dq-libitem[data-skill="${id}"] .dq-libpin`);
const saveOf = async (h, page) => JSON.parse((await h.ls(page, h.SAVE)) ?? 'null');
const screenName = (page) => page.evaluate(() => document.querySelector('.dq')?.dataset.screen);
const favs = (v) => v.groups.find((g) => g.fav)?.ids ?? [];
const focusedPin = (page) => page.evaluate(() => (document.activeElement?.classList.contains('dq-libpin') ? document.activeElement.closest('.dq-libitem')?.dataset.skill : null));

/** What the list must show with these pins: Your favourites first (only if any fit), then the rest in their sections. */
function expectPinned(h, got, cat, pinned, want, where) {
  const fav = want.filter((id) => pinned.includes(id));
  const rest = want.filter((id) => !pinned.includes(id));
  h.expect(same(got.ids, [...fav, ...rest]), `${where}: shows ${JSON.stringify(got.ids)}, not ${JSON.stringify([...fav, ...rest])}`);
  h.expect(new Set(got.ids).size === got.ids.length, `${where}: a skill shows twice`);
  h.expect(fav.length ? got.groups[0]?.fav && got.groups[0].title === 'Your favourites' && same(got.groups[0].ids, fav) : !got.groups.some((g) => g.fav), `${where}: Your favourites is ${JSON.stringify(got.groups.find((g) => g.fav) ?? null)}, not first with ${JSON.stringify(fav)}`);
  for (const g of got.groups.filter((x) => !x.fav)) h.expect(g.ids.every((id) => !pinned.includes(id)), `${where}: a pinned skill also shows under ${g.title}`);
  for (const id of cat.skills.map((s) => s.id)) {
    const on = pinned.includes(id);
    if (got.ids.includes(id)) h.expect(got.pressed[id] === on, `${where}: the pin for ${id} says ${got.pressed[id]}, not ${on}`);
  }
}
const look = async (page) => ({ ...(await view(page)), pressed: await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.dq-libitem')].map((li) => [li.dataset.skill, li.querySelector('.dq-libpin')?.getAttribute('aria-pressed') === 'true']))) });

async function exportCrystal(h, page, name) {
  await toHub(h, page);
  await h.openSettings(page);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save Crystal' }).click()]);
  const file = path.join(h.out, name);
  await dl.saveAs(file);
  return file;
}
async function restoreCrystal(h, page, file) {
  await toHub(h, page);
  await h.openSettings(page);
  await page.locator('input[type=file]').setInputFiles(file);
  await page.locator('.dq-peek:not(.is-hidden)').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
  await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''), null, { timeout: 15000 });
}
/** A Save Crystal file written here from one taken from the app, with some pin records swapped in. */
function editedCrystal(h, from, name, pins) {
  const c = JSON.parse(fs.readFileSync(from, 'utf8'));
  c.skillPins = { ...c.skillPins, ...pins };
  const file = path.join(h.out, name);
  fs.writeFileSync(file, JSON.stringify(c));
  return file;
}

export const scenarios = {
  async 'pins-move'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const away = offsite(page);
    try {
      await h.reachHub(page);
      await openLibrary(h, page);
      const cat = await catalogue(page);
      const all = listOrder(cat);
      const by = Object.fromEntries(cat.skills.map((s) => [s.id, s]));
      expectPinned(h, await look(page), cat, [], all, 'a save with no pins');
      for (const id of all) {
        const label = await pinOf(page, id).getAttribute('aria-label');
        h.expect(label === `Pin ${by[id].sl} (${by[id].real})`.replace(/'/g, '’'), `the pin for ${id} is named "${label}"`);
      }
      const before = await saveOf(h, page);
      const xp0 = await page.evaluate(() => window.__daily.store.derived().xp);
      const dtOrder = (await view(page)).groups.find((g) => g.title === 'Distress Tolerance').ids;

      // mouse: a module skill, then a loadout skill
      await pinOf(page, 'urge-surf').click();
      expectPinned(h, await look(page), cat, ['urge-surf'], all, 'urge-surf pinned');
      await pinOf(page, 'lie-low').click();
      const two = await look(page);
      expectPinned(h, two, cat, ['urge-surf', 'lie-low'], all, 'lie-low pinned');
      h.expect(same(favs(two), ['lie-low', 'urge-surf']), `favourites are not in list order: ${JSON.stringify(favs(two))}`);
      h.expect(!two.groups.find((g) => g.title === 'Your loadout').ids.includes('lie-low'), 'lie-low still shows in Your loadout');
      h.expect((await screenName(page)) === 'library', 'a pin opened something');

      // keyboard: Enter pins, Space unpins; focus follows the same skill's pin as its row moves
      await pinOf(page, 'loving-kindness').focus();
      await page.keyboard.press('Enter');
      expectPinned(h, await look(page), cat, ['urge-surf', 'lie-low', 'loving-kindness'], all, 'loving-kindness pinned by Enter');
      h.expect((await focusedPin(page)) === 'loving-kindness', `focus is on ${await focusedPin(page)}'s pin, not loving-kindness's, after it moved`);
      const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
      h.expect(ring, 'the focused pin shows no focus ring');
      await h.shot(page, 'move-focus-ring');
      await pinOf(page, 'urge-surf').focus();
      await page.keyboard.press('Space');
      const back = await look(page);
      expectPinned(h, back, cat, ['lie-low', 'loving-kindness'], all, 'urge-surf unpinned by Space');
      h.expect(same(back.groups.find((g) => g.title === 'Distress Tolerance').ids, dtOrder), 'unpinned, urge-surf is not back in its place in Distress Tolerance');
      h.expect((await focusedPin(page)) === 'urge-surf', `focus is on ${await focusedPin(page)}'s pin, not urge-surf's, after unpinning`);
      h.expect((await screenName(page)) === 'library', 'a key on a pin opened something');

      // nothing credited, every decision kept (the unpin too)
      const after = await saveOf(h, page);
      h.expect(same(after.events, before.events), 'pinning added or changed events');
      h.expect((await page.evaluate(() => window.__daily.store.derived().xp)) === xp0, 'pinning changed XP');
      const pins = after.skillPins ?? {};
      h.expect(pins['lie-low']?.pinned === true && pins['loving-kindness']?.pinned === true && pins['urge-surf']?.pinned === false && Object.keys(pins).length === 3, `stored pins are ${JSON.stringify(pins)}`);
      h.expect(Object.values(pins).every((p) => Number.isFinite(p.at) && p.at > 0), 'a pin decision has no time');

      // the row beside a pin opens the skill and credits it once
      const had = await credits(h, page, 'lie-low');
      await page.locator('.dq-libitem[data-skill="lie-low"] .dq-librow').click();
      await page.locator('.dq-skill .dq-step-body > *').first().waitFor({ timeout: 10000 });
      h.expect((await credits(h, page, 'lie-low')) === had + 1, 'opening a pinned skill did not credit it once');
      await toHub(h, page);
      await openLibrary(h, page);
      expectPinned(h, await look(page), cat, ['lie-low', 'loving-kindness'], all, 'back from a pinned skill');
      h.expect(!away.length, `requests left the page: ${away.join(', ')}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'pins-filters'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    try {
      await h.reachHub(page);
      await openLibrary(h, page);
      const cat = await catalogue(page);
      const all = listOrder(cat);
      const total = cat.skills.length;
      let pinned = ['lie-low', 'urge-surf', 'dear-man', 'cope-ahead'];
      for (const id of pinned) await pinOf(page, id).click();
      const need = (label) => cat.needs.find((n) => n.label === label).skills;
      const order = (ids) => all.filter((id) => ids.includes(id));
      for (const [f, want] of [
        [{ need: 'A pause' }, order(need('A pause'))],
        [{ topic: 'Interpersonal' }, order(cat.skills.filter((s) => s.module === 'ie').map((s) => s.id))],
        [{ q: 'cope' }, ['cope-ahead']],
        [{ need: 'Strong feelings', topic: 'Distress Tolerance', time: 180 }, order(need('Strong feelings').filter((id) => cat.skills.find((s) => s.id === id).module === 'dt' && !['volume-down', 'queue-up'].includes(id)))],
      ]) {
        await choose(page, f);
        const got = await look(page);
        expectPinned(h, got, cat, pinned, want, `pins with ${JSON.stringify(f)}`);
      }
      await choose(page, { q: 'zzq', need: 'A pause' });
      const none = await look(page);
      shows(h, none, [], total, 'pins with nothing matching');
      h.expect(!none.groups.length, 'a heading shows with nothing matching');
      await page.getByRole('button', { name: 'Clear filters' }).click();
      expectPinned(h, await look(page), cat, pinned, all, 'pins after Clear filters');

      // pinning with filters on keeps the filters and the focus
      await choose(page, { need: 'A pause', time: 60 });
      const want = order(need('A pause')).filter((id) => ['stop', 'leave-lobby', 'cool-air', 'lie-low'].includes(id));
      expectPinned(h, await look(page), cat, pinned, want, 'A pause, up to 1 minute');
      await pinOf(page, 'stop').focus();
      await page.keyboard.press('Enter');
      pinned = [...pinned, 'stop'];
      expectPinned(h, await look(page), cat, pinned, want, 'stop pinned with filters on');
      h.expect((await control.need(page).inputValue()) === 'pause' && (await control.time(page).inputValue()) === 'up1', 'pinning reset the filters');
      h.expect((await focusedPin(page)) === 'stop', 'focus left the stop pin as it moved under filters');
      const shown = await view(page);
      h.expect(shown.count === `${want.length} of ${total} skills`, `the count says "${shown.count}"`);
      await page.getByRole('button', { name: 'Show all skills' }).click();
      expectPinned(h, await look(page), cat, pinned, all, 'pins after Show all skills');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'pins-saves'(h) {
    // an old save with no pins, plus pins this build can't use: a future skill's and broken records
    const seed = returning(h);
    const old = JSON.parse(seed[h.SAVE]);
    const future = { 'future-skill': { pinned: true, at: 1000 }, give: { pinned: 'yes', at: 5 }, fast: { at: 3 }, 'Not An Id': { pinned: true, at: 4 } };
    const { ctx, page, errors } = await h.open({ ...seed, [h.SAVE]: JSON.stringify({ ...old, skillPins: future }) }, '?mute', PHONE);
    const away = offsite(page);
    let crystal, ctx2;
    try {
      await h.reachHub(page);
      await openLibrary(h, page);
      const cat = await catalogue(page);
      const all = listOrder(cat);
      expectPinned(h, await look(page), cat, [], all, 'a save whose pins this build cannot use');
      h.expect(!(await page.locator('[data-skill="future-skill"]').count()), 'a pin for an unknown skill shows a row');

      // offline: pins still work, with no request
      await ctx.setOffline(true);
      const asked = away.all.length;
      for (const id of ['tipp', 'give', 'volume-down']) await pinOf(page, id).click();
      await pinOf(page, 'give').click();
      h.expect(away.all.length === asked, `pinning made requests: ${away.all.slice(asked).join(', ')}`);
      await ctx.setOffline(false);
      const stored = (await saveOf(h, page)).skillPins;
      h.expect(stored['future-skill']?.pinned === true && stored['future-skill'].at === 1000, `the unknown skill's pin was dropped: ${JSON.stringify(stored)}`);
      h.expect(stored.give?.pinned === false && stored.tipp?.pinned === true && stored['volume-down']?.pinned === true && !('fast' in stored) && !('Not An Id' in stored), `stored pins are ${JSON.stringify(stored)}`);
      await page.reload();
      await h.reachHub(page);
      await openLibrary(h, page);
      expectPinned(h, await look(page), cat, ['tipp', 'volume-down'], all, 'after a reload');

      // a Crystal into an empty save brings every decision, the unpin included
      crystal = await exportCrystal(h, page, 'pins-crystal.json');
      const inFile = JSON.parse(fs.readFileSync(crystal, 'utf8')).skillPins;
      h.expect(sameMap(inFile, (await saveOf(h, page)).skillPins), `the Save Crystal holds ${JSON.stringify(inFile)}`);
      const fresh = await h.open({ 'dbt.app.v1': h.SEEN, [h.YOU]: seed[h.YOU] }, '?mute', PHONE);
      ctx2 = fresh.ctx;
      await h.reachHub(fresh.page);
      await restoreCrystal(h, fresh.page, crystal);
      h.expect(sameMap((await saveOf(h, fresh.page)).skillPins, inFile), `restored into an empty save, the pins are ${JSON.stringify((await saveOf(h, fresh.page)).skillPins)}`);
      await openLibrary(h, fresh.page);
      expectPinned(h, await look(fresh.page), cat, ['tipp', 'volume-down'], all, 'restored into an empty save');
      h.expect(!fresh.errors.length, fresh.errors.join('\n'));

      // the older Crystal (tipp pinned) can't undo a newer unpin here
      await openLibrary(h, page);
      await pinOf(page, 'tipp').click();
      await restoreCrystal(h, page, crystal);
      await openLibrary(h, page);
      expectPinned(h, await look(page), cat, ['volume-down'], all, 'an older pinned Crystal over a newer unpin');

      // equal times settle on unpinned, whichever side holds the pin
      const now = (await saveOf(h, page)).skillPins;
      const tie = now['volume-down'].at;
      await restoreCrystal(h, page, editedCrystal(h, crystal, 'pins-tie-off.json', { 'volume-down': { pinned: false, at: tie } }));
      await openLibrary(h, page);
      expectPinned(h, await look(page), cat, [], all, 'a Crystal unpin at the same time as a pin here');
      const t2 = (await saveOf(h, page)).skillPins.validation?.at;
      h.expect(t2 === undefined, 'validation has a pin record already');
      await pinOf(page, 'validation').click();
      await pinOf(page, 'validation').click();
      const off = (await saveOf(h, page)).skillPins.validation;
      await restoreCrystal(h, page, editedCrystal(h, crystal, 'pins-tie-on.json', { validation: { pinned: true, at: off.at } }));
      await openLibrary(h, page);
      expectPinned(h, await look(page), cat, [], all, 'a Crystal pin at the same time as an unpin here');
      h.expect(!away.length, `requests left the page: ${away.join(', ')}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx2?.close();
      await ctx.close();
    }
  },

  async 'pins-two-tabs'(h) {
    const { ctx, page: a, errors } = await h.open(returning(h), '?mute', PHONE);
    try {
      await h.reachHub(a);
      // the second copy hears nothing from the first until it reads or writes itself: its view goes stale
      const b = await ctx.newPage();
      const bErrors = [];
      b.on('pageerror', (e) => bErrors.push(e.message));
      await b.addInitScript(() => window.addEventListener('storage', (e) => e.stopImmediatePropagation(), true));
      await b.goto(a.url());
      await h.reachHub(b);
      await openLibrary(h, a);
      await openLibrary(h, b);
      const cat = await catalogue(a);
      const all = listOrder(cat);
      const pinsOf = async (p) => look(p);

      // different skills at once: both stay, in both
      await pinOf(a, 'give').click();
      await pinOf(b, 'fast').click();
      await a.waitForFunction(() => document.querySelector('[data-skill="fast"] .dq-libpin')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 }).catch(() => {});
      expectPinned(h, await pinsOf(a), cat, ['give', 'fast'], all, 'the first copy after both pinned');
      expectPinned(h, await pinsOf(b), cat, ['give', 'fast'], all, 'the second copy after both pinned');
      const snapshot = await h.ls(a, h.SAVE);

      // an unpin in the first, then the stale second copy saves: the unpin stays
      await pinOf(a, 'give').click();
      expectPinned(h, await pinsOf(a), cat, ['fast'], all, 'the first copy after unpinning give');
      h.expect((await b.locator('[data-skill="give"] .dq-libpin').getAttribute('aria-pressed')) === 'true', 'the second copy was not stale (the test needs it to be)');
      await pinOf(b, 'validation').click();
      expectPinned(h, await pinsOf(b), cat, ['fast', 'validation'], all, 'the stale copy after it saved');
      await a.waitForFunction(() => document.querySelector('[data-skill="validation"] .dq-libpin')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 }).catch(() => {});
      expectPinned(h, await pinsOf(a), cat, ['fast', 'validation'], all, 'the first copy after the stale copy saved');

      // a copy that writes old data without reading first (an older build, say) brings back nothing
      await b.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, snapshot]);
      await a.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).skillPins.validation?.pinned === true, h.SAVE, { timeout: 5000 }).catch(() => {});
      expectPinned(h, await pinsOf(a), cat, ['fast', 'validation'], all, 'the first copy after an old write');
      const stored = await a.evaluate((k) => JSON.parse(localStorage.getItem(k)).skillPins, h.SAVE);
      h.expect(stored.give?.pinned === false && stored.fast?.pinned === true && stored.validation?.pinned === true, `after an old write, the stored pins are ${JSON.stringify(stored)}`);

      // an equal-time tie between the copies settles on unpinned, both ways round
      const at = stored.validation.at;
      const tied = (pinned) => { const s = JSON.parse(snapshot); s.skillPins = { ...stored, validation: { pinned, at } }; return JSON.stringify(s); };
      await b.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, tied(false)]);
      await a.waitForFunction(() => document.querySelector('[data-skill="validation"] .dq-libpin')?.getAttribute('aria-pressed') === 'false', null, { timeout: 5000 }).catch(() => {});
      expectPinned(h, await pinsOf(a), cat, ['fast'], all, 'the first copy after a tied unpin');
      await b.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, tied(true)]);
      // the first copy reads the tied pin, keeps its unpin and writes that back: wait for the write, not a fixed time
      await a.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).skillPins.validation?.pinned === false, h.SAVE, { timeout: 5000 }).catch(() => {});
      h.expect(JSON.parse(await h.ls(a, h.SAVE)).skillPins.validation?.pinned === false, 'the first copy did not settle the tied pin as unpinned in the save');
      expectPinned(h, await pinsOf(a), cat, ['fast'], all, 'the first copy after a tied pin');
      await b.reload();
      await h.reachHub(b);
      await openLibrary(h, b);
      expectPinned(h, await pinsOf(b), cat, ['fast'], all, 'the second copy after a reload');
      h.expect(!errors.length && !bErrors.length, [...errors, ...bErrors].join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'pins-newer'(h) {
    const fixture = newerSave().skillPins;
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(newerSave()), 'dbt.app.v1': h.SEEN, [h.YOU]: returning(h)[h.YOU] }, '?mute', PHONE);
    try {
      await h.reachHub(page);
      await openLibrary(h, page);
      const cat = await catalogue(page);
      const all = listOrder(cat);
      // wise-mind is pinned; stop's record can't be read here and tipp's is unpinned
      expectPinned(h, await look(page), cat, ['wise-mind'], all, 'a newer save');
      await pinOf(page, 'stop').click();
      await pinOf(page, 'wise-mind').click();
      expectPinned(h, await look(page), cat, ['stop'], all, 'stop pinned and wise-mind unpinned here');
      let pins = (await saveOf(h, page)).skillPins;
      h.expect(pins.stop?.pinned === true && pins.stop.at > fixture.stop.at, `pinning replaced the unreadable record with ${JSON.stringify(pins.stop)}`);
      h.expect(pins['wise-mind']?.pinned === false && pins['wise-mind'].at > fixture['wise-mind'].at && pins['wise-mind'].folder === 'calm', `unpinning lost the newer field: ${JSON.stringify(pins['wise-mind'])}`);
      h.expect(same(pins.tipp, fixture.tipp) && same(pins['future-skill'], fixture['future-skill']), `untouched pins changed: ${JSON.stringify([pins.tipp, pins['future-skill']])}`);

      // a newer file with the older records changes nothing here
      const file = (skillPins) => ({ app: 'the-quiet-lantern', exported: new Date().toISOString(), ...newerSave(), v: 2, schema: 3, skillPins });
      await toHub(h, page);
      h.expect(/Restored/.test(await restore(h, page, file(fixture), 'pins-older.json')), 'the older newer-version file was not restored');
      await openLibrary(h, page);
      expectPinned(h, await look(page), cat, ['stop'], all, 'after restoring older pin records');
      h.expect(same((await saveOf(h, page)).skillPins, pins), `older records changed the pins: ${JSON.stringify((await saveOf(h, page)).skillPins)}`);

      // later ones win, kept exactly as stored, and pinning here again replaces the unreadable one
      const later = Date.now() + 864e5;
      const newerPins = { ...fixture, stop: { pinned: 'soon', at: later }, 'wise-mind': { pinned: true, at: later, folder: 'calm', tag: 'x' } };
      await toHub(h, page);
      await restore(h, page, file(newerPins), 'pins-later.json');
      await openLibrary(h, page);
      expectPinned(h, await look(page), cat, ['wise-mind'], all, 'after restoring later pin records');
      pins = (await saveOf(h, page)).skillPins;
      h.expect(same(pins.stop, newerPins.stop) && same(pins['wise-mind'], newerPins['wise-mind']), `later records were not kept as stored: ${JSON.stringify([pins.stop, pins['wise-mind']])}`);
      await pinOf(page, 'stop').click();
      pins = (await saveOf(h, page)).skillPins;
      h.expect(pins.stop?.pinned === true && pins.stop.at > later, `pinning after a later unreadable record stored ${JSON.stringify(pins.stop)}`);
      await page.reload();
      await h.reachHub(page);
      await openLibrary(h, page);
      expectPinned(h, await look(page), cat, ['stop', 'wise-mind'], all, 'after a reload');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'pins-sizes'(h) {
    const problems = [];
    for (const size of SIZES) {
      const tag = `${size.width}x${size.height}`;
      const { ctx, page, errors } = await h.open(returning(h), '?mute', size);
      try {
        await h.reachHub(page);
        await openLibrary(h, page);
        for (const id of ['interpersonal-myths', 'lie-low', 'radical-acceptance']) await pinOf(page, id).click();
        await pinOf(page, 'lie-low').focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await page.evaluate(() => document.querySelector('.dq-libbar')?.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))).then(() => {}));
        problems.push(...(await fitLibrary(page, `${tag} favourites`)));
        await h.shot(page, `pins-${tag}-favourites`);
        await choose(page, { topic: 'Interpersonal' });
        problems.push(...(await fitLibrary(page, `${tag} favourites filtered`)));
        await h.shot(page, `pins-${tag}-filtered`);
        h.expect(!errors.length, `${tag}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
