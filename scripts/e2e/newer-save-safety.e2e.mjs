// Keep newer saves safe in older versions. A save written by a newer build of The Lantern (a higher version, fields,
// ids and records this build doesn't know) must come through this build whole: on boot, on every write, through two
// open tabs, through a Save Crystal and Restore, and when this build is the older one, loaded offline from its cached
// service worker while a newer build shares the device.
// newer-keeps: a synthetic newer save boots, Settings opens, one known choice changes; the stored save and its Save
// Crystal still hold every unknown value exactly, and its version, and every record past this build's limits or that it
// can't read is stored as it was. Restored into a clean profile and exported again, nothing is lost. A clash on restore
// keeps the newer version's value.
// newer-tabs: two open tabs change different known things at the same moment; both changes and every newer field stay.
// newer-tabs-same-item: the stored copy of an item both tabs hold, added at the same time, differs one level down; the
// stored copy's value is the one written back.
// old-crystal-unknown-choice: a version 1 Save Crystal holding a choice this build can't use, with no change time, is
// restored on a clean device and keeps that choice.
// newer-bad-files: a file from another app, a broken file and a cancelled preview change nothing at all.
// newer-cached-build: two real production builds on one origin with the service worker on. Newer build B stores new
// fields; this build A, the older one, is then served by its cached worker while offline and changes a known choice;
// B comes back and finds its fields and A's change.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeServiceWorker } from '../sw-build.mjs';
import { dayKey } from './skill-check.e2e.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DAY = 864e5;
const T = Date.now() - 2 * DAY;
const D = dayKey(T);
const TODAY = dayKey(Date.now());
const YOU = JSON.stringify({ name: 'Robin', companion: 'Pip', nameAt: T, companionAt: T });

/** A save from a newer build, version 3: everything a later build might add, at every depth, next to known data. */
export function newerSave() {
  // parsed, so "__proto__" is a plain field here as it is in a real file
  return JSON.parse(
    JSON.stringify({
      v: 3,
      created: T - 10 * DAY,
      garden: { seeds: 3, planted: ['moss', { kind: 'fern', at: 5 }], PROTO: { polluted: 1 } },
      events: [
        { id: 'nv1', t: T, day: D, k: 'visit', xp: 10, glow: { ring: 2 } },
        { id: 'ns1', t: T + 1, day: D, k: 'skill', xp: 20, stat: 'stamina', skill: 'stop', data: { mood: { lift: 2 } } },
        { id: 'ns2', t: T + 2, day: D, k: 'skill', xp: 20, stat: 'wonder', skill: 'wise-mind' },
        { id: 'nq1', t: T + 3, day: D, k: 'quest', xp: 40, quest: { step: 2, of: 5 } },
        { id: 'nc1', t: T + 4, day: D, k: 'checkin', xp: 5, data: { feel: 'Calm', level: 2, sky: 'clear' } },
        // past this build's limits, and unreadable here: kept as stored
        { id: 'nx1', t: T + 5, day: D, k: 'skill', xp: 800, skill: 'stop' },
        { id: 'nd1', t: T + 6, day: null, k: 'visit', xp: 10 },
      ],
      diary: {
        [D]: { day: D, emotions: { Joy: 3 }, urges: {}, note: 'A calm day', updatedAt: T, ft: { 'e:Joy': T, 'x:weather': T }, weather: { sky: 'clear' } },
        [TODAY]: { day: TODAY, emotions: { Joy: 2 }, urges: {}, note: '', updatedAt: T, ft: { 'e:Joy': T, 'x:tide': T }, tide: 'high' },
        someday: { day: 'someday', emotions: { Joy: 1 }, urges: {}, note: 'Kept for later', updatedAt: T },
      },
      lists: {
        comfort: [{ id: 'nc-tea', text: 'Tea', at: T, colour: 'teal' }, { id: 'nc-long', text: 'Slow tea by the window. '.repeat(13).slice(0, 300), at: T }],
        activities: [],
        reasons: [],
        people: [{ id: 'np-sam', name: 'Sam', phone: '0123', at: T, pronouns: 'they' }],
      },
      maps: [{ id: 'nm1', t: T, urge: 'Scroll', p1: 'Rest', c1: 'Late', p2: 'Sleep', c2: 'Bored', choice: 'wait', at: T, sketch: [1, 2] }],
      lines: [
        { day: D, id: 'l1', tag: 'calm', text: 'One small step.', t: T, voice: 'soft' },
        { day: D, id: 'l2', tag: 'calm', text: 'Another line.', t: T - 5 },
      ],
      settings: { sound: true, motion: 'gentle', emotionRows: ['Joy', 'Sadness', ...Array.from({ length: 28 }, (_, i) => `Feeling ${i + 3}`)], urgeRows: ['Urge to give up on today'], haptics: { level: 2 } },
      flags: { rankSeen: 0, wardenSeen: false, giftDay: D, cardDay: '', greetDay: D, safeCredit: false, therapistLineShown: false, checkinDay: D, questAsideDay: '', questAsideAt: 0, bloomSeen: true },
      gone: {},
      setAt: { motion: T, haptics: T },
      profile: {
        theme: 'aurora', accent: 'blue', cardBack: 'ring', plate: 'plain', title: 'star-sage', playerName: 'Robin', companion: 'Pip',
        names: { sable: 'Ash', moonling: 'Fern' }, region: 'gb', titlesSeen: ['self-healer', 'future-title'],
        setAt: { theme: T, title: T, playerName: T, companion: T, 'name:sable': T, 'name:moonling': T, aura: T }, aura: { hue: 200 },
      },
    }).replace('"PROTO"', '"__proto__"'),
  );
}

/** Every value of a save the reading build doesn't know, by where it lives, plus the version it was written with. */
export function newerParts(save, crystal = false) {
  const ev = (id) => save.events.find((e) => e.id === id);
  return {
    version: crystal ? save.schema : save.v,
    garden: save.garden,
    eventField: ev('nv1')?.glow,
    eventData: ev('ns1')?.data?.mood,
    eventStat: ev('ns2')?.stat,
    eventKind: ev('nq1'),
    checkinData: ev('nc1')?.data?.sky,
    diaryField: save.diary?.[D]?.weather,
    diaryTime: save.diary?.[D]?.ft?.['x:weather'],
    todayField: save.diary?.[TODAY]?.tide,
    todayTime: save.diary?.[TODAY]?.ft?.['x:tide'],
    item: save.lists?.comfort?.find((i) => i.id === 'nc-tea')?.colour,
    person: save.lists?.people?.find((p) => p.id === 'np-sam')?.pronouns,
    map: save.maps?.find((m) => m.id === 'nm1')?.sketch,
    line: save.lines?.find((l) => l.day === D)?.voice,
    motion: save.settings?.motion,
    setting: save.settings?.haptics,
    flag: save.flags?.bloomSeen,
    setAt: save.setAt?.haptics,
    theme: save.profile?.theme,
    title: save.profile?.title,
    name: save.profile?.names?.moonling,
    titleSeen: save.profile?.titlesSeen?.includes('future-title'),
    profileAt: [save.profile?.setAt?.['name:moonling'], save.profile?.setAt?.aura],
    profile: save.profile?.aura,
  };
}

/** The records of a newer save past this build's limits or unreadable here, which must be stored exactly as they came. */
export function newerRecords(save, rows = true) {
  const ev = (id) => save.events?.find((e) => e.id === id);
  return {
    bigXp: ev('nx1'),
    noDay: ev('nd1'),
    longText: save.lists?.comfort?.find((i) => i.id === 'nc-long'),
    lines: save.lines?.filter((l) => l.day === D).sort((a, b) => (a.id < b.id ? -1 : 1)),
    oddDay: save.diary?.someday,
    ...(rows ? { rows: save.settings?.emotionRows } : {}),
  };
}

const saveOf = async (h, page) => JSON.parse((await h.ls(page, h.SAVE)) ?? 'null');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diff = (want, got) => Object.keys(want).filter((k) => !same(want[k], got[k])).map((k) => `${k}: want ${JSON.stringify(want[k])}, got ${JSON.stringify(got[k])}`).join('; ');

export async function settings(h, page) {
  if (await page.locator('.dq-settings').count()) return;
  await h.openSettings(page);
  await page.locator('.dq-settings').waitFor({ timeout: 10000 });
}
export async function crystal(h, page, name) {
  await settings(h, page);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save Crystal' }).click()]);
  const file = path.join(h.out, `${name}.json`);
  await dl.saveAs(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
/** Restores a file through Settings, confirming the preview when this build shows one. */
export async function restore(h, page, raw, name = 'crystal.json') {
  await settings(h, page);
  await page.evaluate(() => document.querySelectorAll('.dq-settings [aria-live]').forEach((e) => (e.textContent = '')));
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw)) });
  const confirm = page.getByRole('button', { name: 'Restore this Save Crystal' });
  const said = page.locator('.dq-settings [aria-live]').filter({ hasText: /Restored|Nothing changed/ });
  await Promise.race([confirm.waitFor({ timeout: 15000 }).then(() => confirm.click()), said.first().waitFor({ timeout: 15000 })]);
  await said.first().waitFor({ timeout: 15000 });
  return (await said.first().textContent()).trim();
}
/** Changes the player's name in Settings (a known choice), saved when the field is left. */
async function rename(page, to, key = 'playerName') {
  const field = page.locator(`#set-${key}`);
  await field.fill(to);
  await field.evaluate((e) => e.blur());
}

export const scenarios = {
  async 'newer-keeps'(h) {
    const want = newerParts(newerSave());
    const records = newerRecords(newerSave());
    const restoredRecords = newerRecords(newerSave(), false);
    const seed = { [h.SAVE]: JSON.stringify(newerSave()), 'dbt.app.v1': h.SEEN, [h.YOU]: YOU };
    const { ctx, page, errors } = await h.open(seed);
    await h.reachHub(page);
    const booted = await saveOf(h, page);
    let got = newerParts(booted);
    h.expect(same(want, got), `booting a newer save lost what this build doesn't read: ${diff(want, got)}`);
    h.expect(same(records, newerRecords(booted)), `booting a newer save changed records it can't hold as stored: ${diff(records, newerRecords(booted))}`);
    // every event's XP counts, those this build can't read too, each at most 500 as this build counts it
    const xpWant = newerSave().events.reduce((n, e) => n + Math.min(500, Math.max(0, e.xp)), 0);
    const xp = await page.evaluate(() => window.__daily.store.derived().xp);
    h.expect(xp >= xpWant, `a newer save shows ${xp} XP, less than the ${xpWant} its events hold`);
    h.expect((await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('.unreadable')))).length === 0, 'a newer save was set aside as unreadable');
    await settings(h, page);
    got = newerParts(await saveOf(h, page));
    h.expect(same(want, got), `opening Settings changed newer values: ${diff(want, got)}`);
    await h.shot(page, 'newer-settings-390x844');
    // one known choice changes; only it changes
    await rename(page, 'Robin Vale');
    await page.reload();
    await h.reachHub(page);
    const after = await saveOf(h, page);
    got = newerParts(after);
    h.expect(same(want, got), `changing the name lost newer values: ${diff(want, got)}`);
    h.expect(same(records, newerRecords(after)), `changing the name rewrote records this build can't hold as stored: ${diff(records, newerRecords(after))}`);
    h.expect(after.profile.playerName === 'Robin Vale' && after.profile.setAt.playerName > T, 'the name change was not stored');
    // a rating changed in today's diary keeps what a newer build stored on the day
    await page.evaluate(() => window.__daily.go({ name: 'diary' }));
    await page.locator('[aria-label="Joy"] [role="radio"]').filter({ hasText: /^\s*4\s*$/ }).click();
    await page.waitForFunction(([k, d]) => JSON.parse(localStorage.getItem(k) ?? 'null')?.diary?.[d]?.emotions?.Joy === 4, [h.SAVE, TODAY], { timeout: 10000 });
    const edited = await saveOf(h, page);
    got = newerParts(edited);
    h.expect(same(want, got), `editing today's diary lost newer values: ${diff(want, got)}`);
    h.expect(same(records, newerRecords(edited)), `editing today's diary rewrote records this build can't hold as stored: ${diff(records, newerRecords(edited))}`);
    await page.reload();
    await h.reachHub(page);
    h.expect(['nv1', 'ns1', 'ns2', 'nc1'].every((id) => after.events.some((e) => e.id === id)), 'known progress was lost');
    h.expect(({}).polluted === undefined && !(await page.evaluate(() => ({}).polluted)), 'a stored "__proto__" field reached the object prototype');
    h.expect(JSON.stringify(after.garden).includes('"__proto__":{"polluted":1}'), 'a stored "__proto__" field was not kept as plain data');
    // the Save Crystal carries all of it, with its own version and the save's
    const file = await crystal(h, page, 'newer-crystal');
    got = newerParts(file, true);
    h.expect(file.v === 2 && file.schema === 3, `the Save Crystal is v${file.v} holding a v${file.schema} save, not v2 holding v3`);
    h.expect(same(want, got), `the Save Crystal lost newer values: ${diff(want, got)}`);
    h.expect(same(records, newerRecords(file)), `the Save Crystal changed records this build can't hold as stored: ${diff(records, newerRecords(file))}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();

    // restored on a clean device, then backed up again
    const clean = await h.open({ 'dbt.app.v1': h.SEEN, [h.YOU]: YOU });
    await h.reachHub(clean.page);
    h.expect(/Restored/.test(await restore(h, clean.page, file)), 'the newer Save Crystal was not restored');
    await clean.page.reload();
    await h.reachHub(clean.page);
    const restored = await saveOf(h, clean.page);
    got = newerParts(restored);
    h.expect(same(want, got), `restoring lost newer values: ${diff(want, got)}`);
    h.expect(['nv1', 'ns1', 'ns2', 'nc1'].every((id) => restored.events.some((e) => e.id === id)), 'restoring lost known progress');
    // a restore adds the file's rows to this device's own list, up to this build's limit, so rows aren't compared
    h.expect(same(restoredRecords, newerRecords(restored, false)), `restoring changed records this build can't hold as stored: ${diff(restoredRecords, newerRecords(restored, false))}`);
    const again = await crystal(h, clean.page, 'newer-crystal-again');
    got = newerParts(again, true);
    h.expect(same(want, got), `backing up the restored save lost newer values: ${diff(want, got)}`);
    h.expect(same(restoredRecords, newerRecords(again, false)), `backing up the restored save changed records this build can't hold as stored: ${diff(restoredRecords, newerRecords(again, false))}`);
    h.expect(!clean.errors.length, clean.errors.join('\n'));
    await clean.ctx.close();

    // a clash on restore: the copy written by the newer version keeps its value; on the same version, this device's
    const clash = async (localV, label) => {
      const local = newerSave();
      local.v = localV;
      local.garden = { seeds: 'mine' };
      // the same records without what the newer build put on them, and one with this device's own value for it
      local.events = local.events.filter((e) => e.id === 'nv1').map(({ glow, ...e }) => e);
      local.lists.comfort[0].colour = 'blue';
      const t = await h.open({ [h.SAVE]: JSON.stringify(local), 'dbt.app.v1': h.SEEN, [h.YOU]: YOU });
      await h.reachHub(t.page);
      await restore(h, t.page, file);
      const s = await saveOf(h, t.page);
      h.expect(s.v === 3, `${label}: the restored save is v${s.v}, not v3`);
      h.expect(s.events.some((e) => e.id === 'ns1') && s.events.some((e) => e.id === 'nq1'), `${label}: restore did not add the file's progress`);
      h.expect(same(s.events.find((e) => e.id === 'nv1')?.glow, { ring: 2 }), `${label}: an event both copies hold did not take the file's newer field`);
      await t.ctx.close();
      return [s.garden, s.lists.comfort.find((i) => i.id === 'nc-tea')?.colour];
    };
    h.expect(same(await clash(1, 'older device'), [file.garden, 'teal']), 'a value from the newer Save Crystal lost to an older save on this device');
    h.expect(same(await clash(3, 'same version'), [{ seeds: 'mine' }, 'blue']), "restoring replaced this device's value from the same version");
  },

  async 'newer-tabs'(h) {
    const seed = { [h.SAVE]: JSON.stringify(newerSave()), 'dbt.app.v1': h.SEEN, [h.YOU]: YOU };
    const { ctx, page: a, errors } = await h.open(seed);
    await h.reachHub(a);
    const b = await ctx.newPage();
    b.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await b.goto(a.url());
    await h.reachHub(b);
    await settings(h, a);
    await settings(h, b);
    // the two changes land at the same moment: the companion's name in one tab, the player's in the other
    await a.locator('#set-companion').fill('Wisp');
    await b.locator('#set-playerName').fill('Robin Vale');
    await Promise.all([a.locator('#set-companion').evaluate((e) => e.blur()), b.locator('#set-playerName').evaluate((e) => e.blur())]);
    await a.reload();
    await h.reachHub(a);
    const s = await saveOf(h, a);
    h.expect(s.profile.companion === 'Wisp', `the companion change from one tab was lost (${s.profile.companion})`);
    h.expect(s.profile.playerName === 'Robin Vale', `the name change from the other tab was lost (${s.profile.playerName})`);
    const want = newerParts(newerSave());
    const got = newerParts(s);
    h.expect(same(want, got), `two tabs writing lost newer values: ${diff(want, got)}`);
    const records = newerRecords(newerSave());
    h.expect(same(records, newerRecords(s)), `two tabs writing changed records this build can't hold as stored: ${diff(records, newerRecords(s))}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'newer-tabs-same-item'(h) {
    const save = newerSave();
    save.lists.comfort.find((i) => i.id === 'nc-tea').swatch = { hue: 1 };
    const { ctx, page: a, errors } = await h.open({ [h.SAVE]: JSON.stringify(save), 'dbt.app.v1': h.SEEN, [h.YOU]: YOU });
    await h.reachHub(a);
    const b = await ctx.newPage();
    b.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await b.goto(a.url());
    await h.reachHub(b);
    // the other tab's stored copy of the item, added at the same time, holds another value one level down
    await b.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      s.lists.comfort.find((i) => i.id === 'nc-tea').swatch = { hue: 2 };
      localStorage.setItem(key, JSON.stringify(s));
    }, h.SAVE);
    await settings(h, a);
    await rename(a, 'Robin Vale');
    await a.waitForFunction((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.profile?.playerName === 'Robin Vale', h.SAVE, { timeout: 10000 });
    const s = await saveOf(h, a);
    const item = s.lists.comfort.find((i) => i.id === 'nc-tea');
    h.expect(same(item?.swatch, { hue: 2 }) && item?.at === T, `the stored copy's value one level down was not kept: ${JSON.stringify(item)}`);
    const want = newerParts(newerSave());
    const got = newerParts(s);
    h.expect(same(want, got), `two tabs holding the same item lost newer values: ${diff(want, got)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'old-crystal-unknown-choice'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN, [h.YOU]: YOU });
    await h.reachHub(page);
    // a theme this build doesn't have, in a version 1 file, with no time for when it was chosen
    const file = { app: 'the-quiet-lantern', exported: new Date().toISOString(), v: 2, schema: 1, created: T, events: [{ id: 'o1', t: T, day: D, k: 'visit', xp: 10 }], profile: { theme: 'aurora' } };
    h.expect(/Restored/.test(await restore(h, page, file, 'old.json')), 'the version 1 Save Crystal was not restored');
    await page.reload();
    await h.reachHub(page);
    const s = await saveOf(h, page);
    h.expect(s.profile?.theme === 'aurora', `the restored save's theme is ${JSON.stringify(s.profile?.theme)}, not the file's "aurora"`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'newer-bad-files'(h) {
    const seed = { [h.SAVE]: JSON.stringify(newerSave()), 'dbt.app.v1': h.SEEN, [h.YOU]: YOU };
    const { ctx, page, errors } = await h.open(seed);
    await h.reachHub(page);
    // opening Settings stores that its one-time line was shown, so the save is read once it is open
    await settings(h, page);
    const before = await h.ls(page, h.SAVE);
    const other = { ...newerSave(), app: 'another-app', v: 2 };
    h.expect(/Nothing changed/.test(await restore(h, page, other, 'other.json')), 'a file from another app was taken');
    h.expect(/Nothing changed/.test(await restore(h, page, '{"app":"the-quiet-lantern","v":2,"events":[', 'broken.json')), 'a broken file was taken');
    h.expect((await h.ls(page, h.SAVE)) === before, 'a refused file changed the save');
    // a Save Crystal preview that is cancelled changes nothing
    const file = { app: 'the-quiet-lantern', exported: new Date().toISOString(), ...newerSave(), v: 2, schema: 3, garden: { seeds: 9 } };
    await page.locator('input[type=file]').setInputFiles({ name: 'newer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.waitFor({ timeout: 10000 });
    await cancel.click();
    h.expect((await h.ls(page, h.SAVE)) === before, 'a cancelled preview changed the save');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'newer-cached-build'(h) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-newer-'));
    try {
      const a = await build(root, path.join(scratch, 'a'), 'older-a');
      // B: this build with a higher save version, the newer writer
      const src = path.join(scratch, 'src-b');
      fs.cpSync(root, src, { recursive: true, filter: (p) => !/(^|\/)(node_modules|\.git|artifacts|dist)$/.test(p) });
      fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(src, 'node_modules'));
      const store = path.join(src, 'src/daily/store.ts');
      const code = fs.readFileSync(store, 'utf8');
      h.expect(/export const SCHEMA = 1;/.test(code), 'store.ts no longer has "export const SCHEMA = 1;"');
      fs.writeFileSync(store, code.replace('export const SCHEMA = 1;', 'export const SCHEMA = 2;'));
      const b = await build(src, path.join(scratch, 'b'), 'newer-b');
      const site = await host(b.dir);
      const ctx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'allow' });
      await ctx.addInitScript(([seen, you]) => {
        if (localStorage.getItem('dbt.app.v1') === null) localStorage.setItem('dbt.app.v1', seen);
        if (localStorage.getItem('dbt.you.v1') === null) localStorage.setItem('dbt.you.v1', you);
      }, [h.SEEN, YOU]);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      try {
        // B stores fields this build has never heard of, through its own writer
        await page.goto(site.url + '?mute');
        await h.reachHub(page);
        await active(page, b, h.sleep);
        h.expect((await buildOf(page)) === 'newer-b', 'the first load is not build B');
        await page.evaluate(() => {
          const st = window.__daily.store;
          st.state.garden = { seeds: 3, planted: ['moss'] };
          st.state.settings.haptics = { level: 2 };
          st.state.events.push({ id: 'b-bloom', t: Date.now(), day: st.today(), k: 'skill', xp: 20, skill: 'stop', glow: { ring: 2 } });
          st.save();
        });
        const fromB = await saveOf(h, page);
        h.expect(fromB.v === 2 && fromB.garden?.seeds === 3, `build B did not store a v2 save with its new fields (v${fromB.v})`);
        // this build, the older one, takes over the device, then runs offline from its cached worker
        site.use(a.dir);
        h.expect((await update(page)) === 'activated', 'build A never installed');
        await active(page, a, h.sleep);
        await ctx.setOffline(true);
        await page.reload();
        await h.reachHub(page);
        const id = await page.evaluate(async (meta) => ({ controller: navigator.serviceWorker.controller?.scriptURL ?? null, cache: await (await caches.open(meta)).match('current').then((r) => r?.text()) }), swConst(a.dir, 'META'));
        h.expect((await buildOf(page)) === 'older-a' && id.cache === a.cache && /sw\.js$/.test(id.controller ?? ''), `offline, the page is not build A from its cached worker: ${JSON.stringify(id)}`);
        await settings(h, page);
        await rename(page, 'Robin Vale');
        const fromA = await saveOf(h, page);
        h.expect(fromA.v === 2, `build A relabelled the v2 save as v${fromA.v}`);
        h.expect(same(fromA.garden, fromB.garden) && same(fromA.settings.haptics, { level: 2 }) && same(fromA.events.find((e) => e.id === 'b-bloom')?.glow, { ring: 2 }), 'build A dropped what build B stored');
        await h.shot(page, 'newer-cached-a-offline-390x844');
        // B is back: it finds its own fields and A's change
        await ctx.setOffline(false);
        site.use(b.dir);
        h.expect((await update(page)) === 'activated', 'build B never came back');
        await active(page, b, h.sleep);
        await page.reload();
        await h.reachHub(page);
        h.expect((await buildOf(page)) === 'newer-b', 'build B did not come back');
        const back = await saveOf(h, page);
        h.expect(back.v === 2 && same(back.garden, fromB.garden) && same(back.settings.haptics, { level: 2 }) && same(back.events.find((e) => e.id === 'b-bloom')?.glow, { ring: 2 }), 'build B lost its own fields after build A wrote');
        h.expect(back.profile.playerName === 'Robin Vale', "build B does not see build A's name change");
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
        await site.close();
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },
};

/** A production build of the tree at dir, tagged so a page can tell which build it is. */
function build(dir, out, tag) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(dir, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], { cwd: dir, env: { ...process.env, BUILD_ID: tag }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`build ${tag} failed:\n${log.slice(-2000)}`));
      const html = path.join(out, 'index.html');
      fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<title>', `<meta name="x-e2e-build" content="${tag}" />\n    <title>`));
      writeServiceWorker(out);
      resolve({ dir: out, tag, cache: swConst(out, 'PREFIX') + swConst(out, 'VERSION') });
    });
  });
}
const swConst = (dir, name) => fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').match(new RegExp(`const ${name} = ['"]([^'"]+)['"]`))[1];
const buildOf = (page) => page.evaluate(() => document.querySelector('meta[name=x-e2e-build]')?.content ?? null);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };

/** Serves one build at a time on one origin; use() switches what it serves, as a deploy would. */
async function host(dir) {
  let current = dir;
  const server = http.createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return res.writeHead(400).end();
    }
    const base = path.resolve(current);
    let f = path.resolve(base, '.' + p);
    if (f !== base && !f.startsWith(base + path.sep)) return res.writeHead(403).end();
    if (p.endsWith('/')) f = path.join(f, 'index.html');
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) f = path.join(base, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    use: (d) => (current = d),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }),
  };
}

/** Waits until this build's worker controls the page and its cache is the current one. */
async function active(page, d, sleep) {
  const meta = swConst(d.dir, 'META');
  for (let i = 0; i < 300; i++) {
    const cur = await page.evaluate(async (m) => (navigator.serviceWorker.controller ? (await (await caches.open(m)).match('current'))?.text() : null), meta).catch(() => null);
    if (cur === d.cache) return;
    await sleep(200);
  }
  throw new Error(`the ${d.tag} worker never took over`);
}
const update = (page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const found = new Promise((res) => reg.addEventListener('updatefound', () => res(reg.installing), { once: true }));
    await reg.update().catch(() => {});
    const w = await Promise.race([found, new Promise((res) => setTimeout(() => res(null), 8000))]);
    if (!w) return 'none';
    return new Promise((res) => {
      const done = () => (w.state === 'redundant' || w.state === 'activated') && res(w.state);
      w.addEventListener('statechange', done);
      done();
      setTimeout(() => res('stuck: ' + w.state), 60000);
    });
  });
