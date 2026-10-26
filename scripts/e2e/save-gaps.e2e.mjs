// The last ways a newer save could lose data in this build, and a Restore racing a newer file pick.
// gaps-newer-tab-removes: a newer build in another tab removes things this build can't read (a top-level field, events
// of a kind it doesn't know, a diary day, records, a list, a second line, a name, a title, profile, settings, flags and
// change-time fields); this tab writes without them. An older build that drops them (it writes a lower version) never
// removes them: this tab writes them back.
// gaps-tab-rows: a newer build in another tab changes the diary rows (more than this build shows); this tab takes the
// change and writes every row as stored, never the ones it shows.
// gaps-kept-events: an event of a kind this build doesn't know is updated by a newer build in another tab, and by a
// Restore of a newer Save Crystal; the update is kept. A file from the same version keeps the device's copy.
// gaps-newer-tab-lines: a newer build in another tab edits a second line for a day (lines share ids), adds another and
// removes it again; this tab writes each line once, as the other tab left it.
// gaps-old-day-tabs (a guard: it already passes on main, fixed by #58): a diary day with no change times, past this build's limits (scores over 5, an 800-character note),
// gets a new field from a newer build in another tab; this tab writes the day as stored with the field.
// restore-races-new-pick: Restore of one Save Crystal is still adding its drawings when a second file is picked; the
// second preview keeps its own status line and the first Restore still finishes.
import { dayKey } from './skill-check.e2e.mjs';
import { crystal, newerParts, newerSave, restore, settings } from './newer-save-safety.e2e.mjs';

const DAY = 864e5;
const T = Date.now() - 2 * DAY;
const D = dayKey(T);
const D2 = dayKey(T - DAY);
const YOU = JSON.stringify({ name: 'Robin', companion: 'Pip', nameAt: T, companionAt: T });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const saveOf = async (h, page) => JSON.parse((await h.ls(page, h.SAVE)) ?? 'null');
/** Keys in a fixed order, so two records compare by content. */
const tidy = (x) => (Array.isArray(x) ? x.map(tidy) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, tidy(x[k])])) : x);

/** Two tabs on one save: the second only writes what a newer (or older) build would store, never through the app. */
async function twoTabs(h, save, you = YOU) {
  const { ctx, page: a, errors } = await h.open({ [h.SAVE]: JSON.stringify(save), 'dbt.app.v1': h.SEEN, [h.YOU]: you });
  await h.reachHub(a);
  const b = await ctx.newPage();
  b.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await b.goto(a.url());
  await h.reachHub(b);
  /** The other tab stores its own version of the save: change(s) gets the stored save and returns what to store. */
  const store = (change) =>
    b.evaluate(
      ([key, fn]) => {
        const s = JSON.parse(localStorage.getItem(key));
        const out = new Function('s', `return (${fn})(s)`)(s) ?? s;
        localStorage.setItem(key, JSON.stringify(out));
        return out;
      },
      [h.SAVE, change.toString()],
    );
  return { ctx, a, b, errors, store };
}
/** A known change in this tab (the companion's name, saved when the field is left), and its write landing. */
async function change(h, page, to) {
  await settings(h, page);
  const field = page.locator('#set-companion');
  await field.fill(to);
  await field.evaluate((e) => e.blur());
  await page.waitForFunction(([k, to]) => JSON.parse(localStorage.getItem(k) ?? 'null')?.profile?.companion === to, [h.SAVE, to], { timeout: 10000 });
}

export const scenarios = {
  async 'gaps-newer-tab-removes'(h) {
    const removes = (s) => {
      delete s.garden;
      s.events = s.events.filter((e) => e.id !== 'nq1' && e.id !== 'nd1');
      delete s.diary.someday;
      s.lists.comfort = s.lists.comfort.filter((i) => i.id !== 'nc-pic');
      s.lists.places = s.lists.places.filter((p) => p !== 'A place with no id' && p.id !== 'npl-cafe');
      s.lines = s.lines.filter((l) => l.id !== 'l2');
      delete s.settings.haptics;
      delete s.flags.bloomSeen;
      delete s.setAt.haptics;
      delete s.profile.aura;
      delete s.profile.setAt.aura;
      delete s.profile.names.moonling;
      delete s.profile.setAt['name:moonling'];
      s.profile.titlesSeen = s.profile.titlesSeen.filter((t) => t !== 'future-title');
      return s;
    };
    const gone = (s) => ({
      garden: s.garden,
      events: s.events.filter((e) => e.id === 'nq1' || e.id === 'nd1'),
      someday: s.diary.someday,
      record: s.lists.comfort.find((i) => i.id === 'nc-pic'),
      places: s.lists.places?.filter((p) => p === 'A place with no id' || p.id === 'npl-cafe').length || undefined,
      line: s.lines.find((l) => l.id === 'l2'),
      setting: s.settings.haptics,
      flag: s.flags.bloomSeen,
      setAt: s.setAt.haptics,
      profile: s.profile.aura,
      profileAt: [s.profile.setAt.aura, s.profile.setAt['name:moonling']],
      name: s.profile.names.moonling,
      title: s.profile.titlesSeen.includes('future-title') || undefined,
    });
    // a newer build (same version) removes them: they stay removed
    {
      const { ctx, a, errors, store } = await twoTabs(h, newerSave());
      await store(removes);
      await change(h, a, 'Wisp');
      const s = await saveOf(h, a);
      const back = Object.entries(gone(s)).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.filter((x) => x !== undefined).length));
      h.expect(!back.length, `what a newer build removed in another tab came back: ${JSON.stringify(Object.fromEntries(back))}`);
      // everything it left is still there
      const left = (x) => {
        const { garden, eventKind, places, setting, flag, setAt, name, titleSeen, profileAt, profile, ...rest } = newerParts(x);
        return rest;
      };
      const want = left(newerSave()), got = left(s);
      h.expect(same(want, got), `newer values the other tab kept were lost: ${Object.keys(want).filter((k) => !same(want[k], got[k])).join(', ')}`);
      h.expect(same(s.lists.places, newerSave().lists.places.filter((p) => p.id === 'npl-park')), `the list the other tab kept is not as it left it: ${JSON.stringify(s.lists.places)}`);
      // then it drops that whole list
      await store((x) => (delete x.lists.places, x));
      await change(h, a, 'Wisp Two');
      h.expect((await saveOf(h, a)).lists.places === undefined, 'a list the other tab removed came back');
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    // an older build (a lower version) drops them as it writes: this tab still holds them and writes them back
    {
      const { ctx, a, errors, store } = await twoTabs(h, newerSave());
      await store((s) => {
        delete s.garden;
        s.events = s.events.filter((e) => e.id !== 'nq1' && e.id !== 'nd1');
        delete s.diary.someday;
        delete s.lists.places;
        delete s.settings.haptics;
        delete s.flags.bloomSeen;
        delete s.profile.aura;
        s.v = 1;
        return s;
      });
      await change(h, a, 'Wisp');
      const s = await saveOf(h, a);
      const want = newerParts(newerSave());
      const got = newerParts(s);
      h.expect(same(want, got), `an older build's write took newer values away: ${Object.keys(want).filter((k) => !same(want[k], got[k])).join(', ')}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'gaps-tab-rows'(h) {
    const { ctx, a, errors, store } = await twoTabs(h, newerSave());
    const R = T + 20;
    const theirs = await store(`(s) => {
      s.settings.emotionRows[1] = 'Sorrow';
      s.settings.emotionRows.push('Feeling 31');
      s.setAt.emotionRows = ${R};
      return s;
    }`);
    await change(h, a, 'Wisp');
    const s = await saveOf(h, a);
    h.expect(same(s.settings.emotionRows, theirs.settings.emotionRows), `the other tab's diary rows were not written as stored: ${s.settings.emotionRows.length} rows, ${JSON.stringify(s.settings.emotionRows.slice(0, 3))}`);
    h.expect(s.setAt.emotionRows === R, `the rows' change time is ${s.setAt.emotionRows}, want ${R}`);
    // the diary shows the rows this build can: the changed one among them
    await a.evaluate(() => window.__daily.go({ name: 'diary' }));
    await a.getByText('Sorrow').first().waitFor({ timeout: 10000 });
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'gaps-kept-events'(h) {
    // another tab: a newer build moves the quest on and adds a field
    {
      const { ctx, a, errors, store } = await twoTabs(h, newerSave());
      const theirs = await store((s) => {
        const q = s.events.find((e) => e.id === 'nq1');
        q.quest = { step: 3, of: 5 };
        q.glow = { ring: 1 };
        return s;
      });
      await change(h, a, 'Wisp');
      const s = await saveOf(h, a);
      const q = s.events.filter((e) => e.id === 'nq1');
      h.expect(q.length === 1 && same(tidy(q[0]), tidy(theirs.events.find((e) => e.id === 'nq1'))), `another tab's update to an event this build can't read was lost: ${JSON.stringify(q)}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    // Restore: a newer Save Crystal's copy wins; one from the same version leaves the device's copy as it is
    {
      const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(newerSave()), 'dbt.app.v1': h.SEEN, [h.YOU]: YOU });
      await h.reachHub(page);
      const file = await crystal(h, page, 'kept-events-before');
      const same1 = JSON.parse(JSON.stringify(file));
      same1.events.find((e) => e.id === 'nq1').quest = { step: 1, of: 5 };
      h.expect(/Restored/.test(await restore(h, page, same1, 'kept-events-same.json')), 'the same-version Save Crystal was not restored');
      let s = await saveOf(h, page);
      h.expect(same(s.events.find((e) => e.id === 'nq1')?.quest, { step: 2, of: 5 }), `a Save Crystal from the same version replaced the device's copy: ${JSON.stringify(s.events.find((e) => e.id === 'nq1'))}`);
      file.schema += 1;
      file.events.find((e) => e.id === 'nq1').quest = { step: 4, of: 5 };
      file.events.find((e) => e.id === 'nq1').glow = { ring: 2 };
      h.expect(/Restored/.test(await restore(h, page, file, 'kept-events-newer.json')), 'the newer Save Crystal was not restored');
      s = await saveOf(h, page);
      const q = s.events.filter((e) => e.id === 'nq1');
      h.expect(q.length === 1 && same(q[0].quest, { step: 4, of: 5 }) && same(q[0].glow, { ring: 2 }), `a newer Save Crystal's update to an event this build can't read was lost: ${JSON.stringify(q)}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'gaps-newer-tab-lines'(h) {
    const { ctx, a, errors, store } = await twoTabs(h, newerSave());
    const lines = (s) => s.lines.filter((l) => l.day === D && l.id !== 'l1').map((l) => l.text).sort();
    await store((s) => ((s.lines.find((l) => l.id === 'l2').text = 'Another line, edited.'), s));
    await change(h, a, 'Wisp');
    h.expect(same(lines(await saveOf(h, a)), ['Another line, edited.']), `after the other tab edited a line, this tab wrote ${JSON.stringify(lines(await saveOf(h, a)))}`);
    await store((s) => (s.lines.push({ day: s.lines[0].day, id: 'l2', tag: 'calm', text: 'A third line.', t: s.lines[0].t - 7 }), s));
    await change(h, a, 'Wisp Two');
    h.expect(same(lines(await saveOf(h, a)), ['A third line.', 'Another line, edited.']), `after the other tab added a line with the same id, this tab wrote ${JSON.stringify(lines(await saveOf(h, a)))}`);
    await store((s) => ((s.lines = s.lines.filter((l) => l.text !== 'A third line.')), s));
    await change(h, a, 'Wisp Three');
    h.expect(same(lines(await saveOf(h, a)), ['Another line, edited.']), `a line the other tab removed came back: ${JSON.stringify(lines(await saveOf(h, a)))}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a guard: this already passes on main (fixed by #58); it keeps that fix in place */
  async 'gaps-old-day-tabs'(h) {
    const save = newerSave();
    const NOTE = 'An old day, written before field times. '.repeat(20);
    save.diary[D2] = { day: D2, emotions: { Joy: 7, Calm: 2 }, urges: { 'Urge to give up on today': 9 }, note: NOTE, updatedAt: T - DAY };
    const { ctx, a, errors, store } = await twoTabs(h, save);
    const theirs = await store(`(s) => ((s.diary['${D2}'].mood = 'warm'), s)`);
    await change(h, a, 'Wisp');
    const s = await saveOf(h, a);
    h.expect(same(tidy(s.diary[D2]), tidy(theirs.diary[D2])), `an old day past this build's limits was written another way after another tab's change: ${JSON.stringify(s.diary[D2]).slice(0, 300)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'restore-races-new-pick'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN, [h.YOU]: YOU });
    await h.reachHub(page);
    const base = await crystal(h, page, 'race-base');
    const stroke = [{ i: 1, w: 3, p: [20, 20, 80, 80] }];
    const first = { ...base, events: [...base.events, { id: 'race-first', t: T, day: D, k: 'visit', xp: 10 }], art: [{ id: 'race-art', kind: 'today', day: D, t: T, updated: T, n: 1, strokes: stroke }] };
    const second = { ...base, events: [...base.events, { id: 'race-second', t: T, day: D, k: 'visit', xp: 10 }] };
    // the first file's drawings wait to be added until released
    await page.evaluate(async () => {
      const { artStore } = await import('/src/daily/artstore.ts');
      const art = artStore(window.__daily.store.key);
      const add = art.importAll.bind(art);
      art.importAll = (...a) => new Promise((ok, bad) => ((window.__held = true), (window.__release = () => add(...a).then(ok, bad))));
    });
    const pick = (raw, name) => page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
    const status = page.locator('.dq-settings .dq-hint[aria-live]').first();
    await pick(first, 'race-first.json');
    await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
    await page.waitForFunction(() => window.__held === true, null, { timeout: 10000 });
    await pick(second, 'race-second.json');
    await page.locator('.dq-peek:not(.is-hidden) .dq-peek-fname', { hasText: 'race-second.json' }).waitFor({ timeout: 10000 });
    const before = (await status.textContent()) ?? '';
    await page.evaluate(() => window.__release());
    // the first Restore finishes: its drawing lands
    await page.waitForFunction(
      async () => {
        const { artStore } = await import('/src/daily/artstore.ts');
        return (await artStore(window.__daily.store.key).list()).some((d) => d.id === 'race-art');
      },
      null,
      { timeout: 10000, polling: 100 },
    );
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    const after = (await status.textContent()) ?? '';
    h.expect(after === before && !/Restored/.test(after), `the first Restore wrote over the second file's status line: ${JSON.stringify({ before, after })}`);
    h.expect(await page.locator('.dq-peek:not(.is-hidden) .dq-peek-fname', { hasText: 'race-second.json' }).isVisible(), 'the second file\'s preview closed');
    const s = await saveOf(h, page);
    h.expect(s.events.some((e) => e.id === 'race-first') && !s.events.some((e) => e.id === 'race-second'), 'the first Restore did not finish, or the second file was restored without a tap');
    // and the second file restores as usual from its own preview
    await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
    await page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''), null, { timeout: 10000 });
    h.expect((await saveOf(h, page)).events.some((e) => e.id === 'race-second'), 'the second file was not restored');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
