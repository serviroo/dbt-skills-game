import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SNAP = path.join(root, 'scripts/stored-ids.json');
const ids = JSON.parse(fs.readFileSync(SNAP, 'utf8')).ids;
const DAY = 864e5;
const last = (l) => l[l.length - 1];
const dayOf = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const MAPS = { diary: '<day>', 'diary.<day>.emotions': '<row>', 'diary.<day>.urges': '<row>', 'diary.<day>.ft': '<field>', gone: '<id>', 'profile.names': '<shadow>', skillPins: '<skill>' };
function paths(o, at = '', out = new Set()) {
  if (Array.isArray(o)) {
    if (!o.length) out.add(`${at}[]`);
    for (const x of o) paths(x, `${at}[]`, out);
  } else if (o && typeof o === 'object') {
    if (!Object.keys(o).length) out.add(at);
    for (const [k, v] of Object.entries(o)) paths(v, at ? `${at}.${MAPS[at] ?? k.replace(/^name:.*/, 'name:<shadow>')}` : k, out);
  } else out.add(at);
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function fullSave(now) {
  const today = dayOf(now);
  const t0 = now - 60 * DAY;
  const ev = [];
  for (let i = 0; i < 45; i++) ev.push({ id: `v-${i}`, t: t0 + i * DAY, day: dayOf(t0 + i * DAY), k: 'visit', xp: 10 });
  const at = (i) => ({ t: t0 + i * DAY + 3600e3, day: dayOf(t0 + i * DAY + 3600e3) });
  ids.skill.forEach((skill, i) => ev.push({ id: `sk-${skill}`, ...at(i), k: 'skill', xp: 500, stat: ids.stat[i % ids.stat.length], skill }));
  ids.feeling.forEach((feel, i) => ev.push({ id: `ci-${i}`, ...at(i), k: 'checkin', xp: 0, data: { feel, level: null } }));
  ids['feedback-answer'].forEach((answer, i) => ev.push({ id: `fb-${i}`, ...at(i), k: 'feedback', xp: 0, skill: ids.skill[i], data: { answer } }));
  ids['art-paper'].forEach((kind, i) => ev.push({ id: `art-${kind}`, ...at(i), k: 'art', xp: 10, data: { kind } }));
  ev.push({ id: 'rest-1', ...at(2), k: 'rest', xp: 10, data: { title: 'professional-lurker', quiet: true } });
  ev.push({ id: 'line-1', ...at(3), k: 'line', xp: 5, data: { id: ids.line[0] } });
  ev.push({ id: `story-${at(4).day}`, ...at(4), k: 'story', xp: 10 });
  ev.push({ id: 'safe-1', ...at(5), k: 'safe', xp: 20, stat: 'stamina' });
  ev.push({ id: 'diary-1', ...at(6), k: 'diary', xp: 10 });
  ev.push({ id: 'card-1', ...at(7), k: 'card', xp: 0, skill: ids.skill[0] });
  for (const k of ids['event-kind']) if (!ev.some((e) => e.k === k)) throw new Error(`fullSave has no ${k} event: add one`);
  ev.sort((a, b) => a.t - b.t);
  const d = at(6).day;
  const names = Object.fromEntries(ids.shadow.map((id, i) => [id, `Ward ${String.fromCharCode(65 + i)}`]));
  return {
    v: Number(ids['save-schema'][0]),
    created: t0,
    events: ev,
    diary: { [d]: { day: d, emotions: { Sadness: 2, Joy: null }, urges: { 'Urge to give up on today': 1 }, note: 'A slow day.', updatedAt: t0, ft: { 'e:Sadness': t0, 'e:Joy': t0, 'u:Urge to give up on today': t0, note: t0 } } },
    lists: {
      comfort: [{ id: 'c-1', text: 'Warm tea', at: t0 }],
      activities: [{ id: 'a-1', text: 'A short walk', at: t0 }],
      reasons: [{ id: 'r-1', text: 'The cat', at: t0 }],
      people: [{ id: 'p-1', name: 'Sam', phone: '555 0100', at: t0 }],
    },
    maps: [{ id: 'map-1', t: t0, urge: 'Quit', p1: 'Rest', c1: 'Guilt', p2: 'Pride', c2: 'Tired', choice: 'Wait', at: t0 }],
    lines: ids.line.map((id, i) => ({ day: dayOf(t0 + i * DAY), id, tag: 'STATUS', text: `Line ${id}`, t: t0 + i * DAY })),
    settings: { sound: false, motion: 'reduce', emotionRows: ['Sadness', 'Joy'], urgeRows: ['Urge to give up on today'] },
    flags: { rankSeen: 5, wardenSeen: true, giftDay: today, cardDay: today, greetDay: today, safeCredit: false, therapistLineShown: true, checkinDay: today },
    gone: { 'c-old': t0 },
    setAt: { sound: t0, motion: t0, emotionRows: t0, urgeRows: t0, safeCredit: t0 },
    skillPins: { [ids.skill[0]]: { pinned: true, at: t0 }, [ids.skill[1]]: { pinned: false, at: t0 } },
    profile: {
      theme: last(ids.theme),
      accent: last(ids.accent),
      cardBack: last(ids['card-back']),
      plate: last(ids.plate),
      title: last(ids.title),
      playerName: 'Kit',
      companion: 'Lumen',
      region: last(ids.region),
      names,
      titlesSeen: [...ids.title],
      setAt: { theme: t0, accent: t0, cardBack: t0, plate: t0, title: t0, playerName: t0, companion: t0, region: t0, ...Object.fromEntries(ids.shadow.map((id) => [`name:${id}`, t0])) },
    },
  };
}

export function seedStores(page, SAVE, now) {
  const day = dayOf(now - 5 * DAY);
  const t = now - 5 * DAY;
  const drawings = ids['art-paper'].map((kind, i) => ({ meta: { id: `draw-${kind}`, kind, day, t: t + i, updated: t + i, prompt: 'Draw a door to somewhere calm.', name: `Wisp ${i}`, n: 2, rev: `r${i}`, from: [`r9@${t}`] }, strokes: [{ i: 1, w: 6, p: [100, 100, 300, 320, 500, 410] }, { i: 2, w: 12, p: [40, 50, 60, 70] }] }));
  // an unfinished drawing over the first page, with every field a draft keeps
  const draft = { key: `edit:${drawings[0].meta.id}:tab-1`, kind: drawings[0].meta.kind, editId: drawings[0].meta.id, bases: [`r0@${t}`], base: t, prompt: 'Draw a door to somewhere calm.', strokes: [{ i: 2, w: 4, p: [120, 120, 200, 260] }], t: t + 50 };
  const story = {
    stories: [
      { id: 'tale-1', title: 'The Long Night', created: t, updated: t, rev: 's1', chapters: ['ch-1'], notes: 'ch-notes' },
      { id: 'tale-gone', title: 'Gone', created: t, updated: t, rev: 's2', chapters: [], notes: 'ch-gone-notes', removed: t + 1 },
    ],
    chapters: [
      { id: 'ch-1', story: 'tale-1', kind: 'page', title: 'Chapter 1', text: 'Once there was a lantern that never went out.', updated: t, rev: 'c1' },
      { id: 'ch-notes', story: 'tale-1', kind: 'notes', title: 'Notes', text: 'Keep it short.', updated: t, rev: 'c2' },
      { id: 'ch-gone-notes', story: 'tale-gone', kind: 'notes', title: 'Notes', text: 'Kept with the removed story.', updated: t, rev: 'c3' },
    ],
    cards: [{ id: 'k-1', mode: 'whatif', text: 'What if the lantern spoke?', t, sel: { start: 0, end: 4, text: 'Once' } }],
  };
  const idb = ids['indexeddb-store'];
  return page.evaluate(
    async ({ SAVE, drawings, draft, story, day, t, artStores, storyStores, index, versions }) => {
      const open = (name, version, upgrade) =>
        new Promise((ok, bad) => {
          const r = indexedDB.open(name, version);
          r.onupgradeneeded = () => upgrade(r.result);
          r.onsuccess = () => ok(r.result);
          r.onerror = () => bad(r.error);
        });
      const done = (tx) => new Promise((ok, bad) => ((tx.oncomplete = ok), (tx.onerror = () => bad(tx.error))));
      const art = await open(`${SAVE}.art`, versions['.art'], (db) => artStores.forEach((s) => db.objectStoreNames.contains(s) || db.createObjectStore(s)));
      let tx = art.transaction(['meta', 'strokes', 'drafts'], 'readwrite');
      for (const d of drawings) {
        tx.objectStore('meta').put(d.meta, d.meta.id);
        tx.objectStore('strokes').put(d.strokes, d.meta.id);
      }
      tx.objectStore('drafts').put(draft, draft.key);
      await done(tx);
      art.close();
      const tales = await open(`${SAVE}.story`, versions['.story'], (db) => {
        db.createObjectStore('stories', { keyPath: 'id' });
        db.createObjectStore('chapters', { keyPath: 'id' }).createIndex(index, 'story');
        storyStores.filter((s) => s !== 'stories' && s !== 'chapters').forEach((s) => db.createObjectStore(s));
      });
      tx = tales.transaction(['stories', 'chapters', 'cards', 'days'], 'readwrite');
      for (const s of story.stories) tx.objectStore('stories').put(s);
      for (const c of story.chapters) tx.objectStore('chapters').put(c);
      tx.objectStore('cards').put(story.cards, 'ch-1');
      tx.objectStore('days').put(t, day);
      await done(tx);
      tales.close();
    },
    {
      SAVE,
      drawings,
      draft,
      story,
      day,
      t,
      artStores: idb.filter((x) => x.startsWith('.art/')).map((x) => x.slice(5)),
      storyStores: idb.filter((x) => /^\.story\/[^/]+$/.test(x)).map((x) => x.slice(7)),
      index: idb.find((x) => x.includes('/index:')).split('index:')[1],
      versions: Object.fromEntries(ids['indexeddb-version'].map((x) => x.split('@')).map(([k, v]) => [k, Number(v)])),
    },
  ).then(() => ({ drawings, draft, story }));
}

async function storedNamesOk(page, SAVE, expect) {
  const inv = await page.evaluate(async () => {
    const dbs = [];
    for (const d of await indexedDB.databases()) {
      const db = await new Promise((ok, bad) => {
        const r = indexedDB.open(d.name);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => bad(r.error);
      });
      const stores = [...db.objectStoreNames];
      const indexes = stores.flatMap((s) => [...db.transaction(s).objectStore(s).indexNames].map((i) => `${s}/index:${i}`));
      dbs.push({ name: d.name, version: db.version, stores: [...stores, ...indexes] });
      db.close();
    }
    return { ls: Object.keys(localStorage), ss: Object.keys(sessionStorage), dbs };
  });
  const beside = ids['beside-save-key'];
  const bases = [SAVE, ...ids['local-storage'].filter((k) => k !== SAVE && k.startsWith('dbt.lantern.'))];
  const known = (k) => ids['local-storage'].includes(k) || bases.some((b) => beside.some((s) => k === b + s || ((s === '.story.live' || s === '.unreadable') && k.startsWith(`${b}${s}.`))));
  const strayLs = inv.ls.filter((k) => !known(k));
  expect(!strayLs.length, `localStorage keys not in stored-ids.json: ${strayLs.join(', ')}`);
  const straySs = inv.ss.filter((k) => k !== 'e2e-seeded' && !ids['session-storage'].includes(k));
  expect(!straySs.length, `sessionStorage keys not in stored-ids.json: ${straySs.join(', ')}`);
  for (const db of inv.dbs) {
    const suffix = beside.find((s) => db.name === SAVE + s);
    expect(suffix, `IndexedDB database not in stored-ids.json: ${db.name}`);
    expect(ids['indexeddb-version'].includes(`${suffix}@${db.version}`), `${db.name} is at version ${db.version}`);
    const want = ids['indexeddb-store'].filter((x) => x.startsWith(`${suffix}/`)).map((x) => x.slice(suffix.length + 1)).sort();
    expect(same([...db.stores].sort(), want), `${db.name} holds ${db.stores.join(', ')}, frozen: ${want.join(', ')}`);
  }
}

async function exportCrystal(page, openSettings, file) {
  await openSettings(page);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Save Crystal' }).click()]);
  await dl.saveAs(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function restoreCrystal(page, openSettings, file) {
  await openSettings(page);
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
  await page.getByText(/^Restored/).first().waitFor({ timeout: 20000 });
  return page.getByText(/^Restored/).first().textContent();
}

async function shadowCounts(page, reachHub, url) {
  await page.goto(url + '/?mute');
  await reachHub(page);
  await page.locator('.dq-tile', { hasText: 'Shadows' }).first().click();
  await page.locator('.dq-collection').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  return {
    skills: await page.locator('.dq-collection:not(.dq-allies) > .dq-cardbtn').count(),
    allies: await page.locator('.dq-allies > .dq-cardbtn:not(.dq-allyslot)').count(),
  };
}

function content(c) {
  const byId = (l) => Object.fromEntries((l ?? []).map((x) => [x.id, x]));
  const { theme, accent, cardBack, plate, title, playerName, companion, region, names, titlesSeen } = c.profile ?? {};
  return {
    events: byId(c.events),
    diary: c.diary,
    lists: Object.fromEntries(Object.entries(c.lists ?? {}).map(([k, l]) => [k, byId(l)])),
    maps: byId(c.maps),
    lines: c.lines,
    profile: { theme, accent, cardBack, plate, title, playerName, companion, region, names, titlesSeen: [...(titlesSeen ?? [])].sort() },
    art: byId((c.art ?? []).map(({ updated, rev, from, ...r }) => r)),
    drafts: Object.fromEntries((c.drafts ?? []).map((d) => [d.key, d])),
    stories: byId((c.stories?.stories ?? []).map(({ updated, rev, ...s }) => s)),
    chapters: byId((c.stories?.chapters ?? []).map((x) => ({ id: x.id, story: x.story, kind: x.kind, title: x.title, text: x.text }))),
  };
}

export const scenarios = {
  async 'final-ids-round-trip'({ open, shot, ls, youOf, expect, reachHub, openSettings, out, server, SAVE, YOU, SEEN }) {
    const now = Date.now();
    const save = fullSave(now);
    const audio = JSON.stringify({ v: 1, master: 0.5, music: 0.25, sfx: 0.75, muted: true });
    // a copy of a save no version could read, kept beside this one: every Save Crystal carries it as it is
    const a = await open({ [SAVE]: JSON.stringify(save), [`${SAVE}.unreadable.${now - 5}`]: '{not a save', [YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: save.created, companionAt: save.created }), 'dbt.app.v1': SEEN, 'dbt.audio.v1': audio });
    await reachHub(a.page);
    const seeded = await seedStores(a.page, SAVE, now);
    await a.page.reload();
    await reachHub(a.page);
    await shot(a.page, 'me91-01-home');

    const kept = JSON.parse((await ls(a.page, SAVE)) ?? 'null');
    expect(kept?.v === save.v, 'the save was not kept: ' + JSON.stringify(kept)?.slice(0, 200));
    const keptIds = new Set(kept.events.map((e) => e.id));
    expect(save.events.every((e) => keptIds.has(e.id)), 'events went missing on load');
    for (const k of ['theme', 'accent', 'cardBack', 'plate', 'title', 'playerName', 'companion', 'region']) expect(kept.profile[k] === save.profile[k], `profile.${k} reset to ${kept.profile[k]}`);
    expect(same(kept.profile.names, save.profile.names), 'a shadow name was dropped: ' + JSON.stringify(kept.profile.names));
    expect(ids.title.every((x) => kept.profile.titlesSeen.includes(x)), 'a title was dropped: ' + kept.profile.titlesSeen);
    expect(kept.settings.motion === 'reduce' && kept.settings.sound === false, 'sound or motion reset');
    expect(same(kept.lines.map((l) => l.id).sort(), [...ids.line].sort()), 'a line id was dropped');
    expect((await ls(a.page, 'dbt.audio.v1')) === audio, 'audio levels reset');
    expect((await youOf(a.page))?.name === 'Kit', 'names mirror lost');

    const shadowsA = await shadowCounts(a.page, reachHub, server.url);
    await shot(a.page, 'me91-02-shadows');
    expect(shadowsA.skills === ids.skill.length, `the collection shows ${shadowsA.skills} of ${ids.skill.length} skills`);
    expect(shadowsA.allies >= 1, 'the drawn ally is not on the Shadows page');

    await a.page.goto(server.url + '/?mute');
    await reachHub(a.page);
    await a.page.locator('.dq-safe').first().click();
    await a.page.locator('.ca-sz-light').click();
    expect((await ls(a.page, `${SAVE}.safe-light`)) === 'up', 'Safe Zone light not stored under .safe-light');
    await a.page.goto(server.url + '/?mute');
    await reachHub(a.page);
    await a.page.locator('.dq-tile', { hasText: 'Stealth' }).first().click();
    await a.page.getByRole('button', { name: 'Aquarium' }).click();
    expect(JSON.parse((await ls(a.page, `${SAVE}.stealth`)) ?? '{}').aquarium === true, 'Stealth room look not stored under .stealth');
    await a.page.goto(server.url + '/?mute');

    const fileX = path.join(out, 'me91-crystal-x.json');
    const x = await exportCrystal(a.page, openSettings, fileX);
    await storedNamesOk(a.page, SAVE, expect);
    expect(x.app === ids['save-crystal-app'][0], 'Save Crystal app id: ' + x.app);
    const have = paths(x);
    const lost = [...ids['save-field'], ...ids['crystal-field']].filter((p) => !have.has(p));
    expect(!lost.length, `fields missing from the Save Crystal: ${lost.join(', ')}`);
    const cx = content(x);
    for (const d of seeded.drawings) expect(same(cx.art[d.meta.id]?.strokes, d.strokes) && cx.art[d.meta.id]?.name === d.meta.name, `drawing ${d.meta.id} not in the Save Crystal intact`);
    for (const c of seeded.story.chapters) expect(cx.chapters[c.id]?.text === c.text, `chapter ${c.id} not in the Save Crystal intact`);
    expect(same(cx.drafts[seeded.draft.key], seeded.draft), 'the unfinished drawing is not in the Save Crystal intact: ' + JSON.stringify(cx.drafts[seeded.draft.key]));
    expect(ids['event-kind'].every((k) => x.events.some((e) => e.k === k)), 'an event kind is missing from the Save Crystal');
    expect(!a.errors.length, a.errors.join('\n'));
    await a.ctx.close();

    const b = await open({ 'dbt.app.v1': SEEN });
    await reachHub(b.page);
    const fresh = JSON.parse(await ls(b.page, SAVE));
    const said = await restoreCrystal(b.page, openSettings, fileX);
    expect(/drawings/.test(said) && /stories/.test(said), 'restore did not bring drawings and stories: ' + said);
    const shadowsB = await shadowCounts(b.page, reachHub, server.url);
    await shot(b.page, 'me91-03-restored-shadows');
    expect(shadowsB.skills === ids.skill.length && shadowsB.allies >= 1, `restored collection shows ${shadowsB.skills} skills and ${shadowsB.allies} allies`);
    await b.page.goto(server.url + '/?mute');
    const y = await exportCrystal(b.page, openSettings, path.join(out, 'me91-crystal-y.json'));
    await storedNamesOk(b.page, SAVE, expect);
    const cy = content(y);
    expect(y.settings.sound === x.settings.sound && y.settings.motion === x.settings.motion, 'restore onto a fresh device did not bring back sound and motion');
    expect(save.events.every((e) => same(cx.events[e.id], e)), 'the first export changed an event field');
    expect(same(x.gone, save.gone) && Object.entries(save.setAt).every(([k, v]) => x.setAt[k] === v), 'the first export lost removal or setting times');
    expect(x.flags.safeCredit === save.flags.safeCredit && x.setAt.safeCredit === save.setAt.safeCredit, 'visiting the Safe Zone changed its credit choice');
    expect(Object.entries(save.flags).every(([k, v]) => x.flags[k] === v), 'the first export changed flags');
    expect(Object.entries(x.flags).filter(([k]) => !k.endsWith('Day') && k !== 'safeCredit').every(([k, v]) => y.flags[k] === v), 'restore lost progress flags');
    expect(y.flags.safeCredit === fresh.flags.safeCredit, 'restore changed device Safe Zone credit preference');
    expect(y.created === x.created, 'restore lost the first visit time');
    expect(same(y.unreadSaves, x.unreadSaves) && same(x.unreadSaves, [{ at: String(now - 5), raw: '{not a save' }]), 'the unreadable save did not round-trip: ' + JSON.stringify([x.unreadSaves, y.unreadSaves]));
    const pins = (o) => JSON.stringify(Object.entries(o ?? {}).sort((p, q) => (p[0] < q[0] ? -1 : 1)));
    expect(pins(x.skillPins) === pins(save.skillPins) && pins(y.skillPins) === pins(x.skillPins), `pins changed on the way through: ${pins(save.skillPins)} then ${pins(x.skillPins)} then ${pins(y.skillPins)}`);
    expect(same(y.profile.setAt, x.profile.setAt), 'restore lost profile choice times');
    for (const k of ['emotionRows', 'urgeRows']) expect(x.settings[k].every((row) => y.settings[k].includes(row)), `restore lost ${k}`);
    for (const part of ['events', 'diary', 'lists', 'maps', 'lines', 'profile', 'art', 'drafts', 'stories', 'chapters']) {
      const want = cx[part], got = cy[part];
      const missing = want && typeof want === 'object' && !Array.isArray(want) && part !== 'diary' && part !== 'profile' ? Object.keys(want).filter((k) => !same(want[k], got?.[k])) : same(want, got) ? [] : [part];
      expect(!missing.length, `${part} changed on the way through a fresh device: ${missing.slice(0, 5).join(', ')}\nbefore: ${JSON.stringify(missing.length && want[missing[0]] !== undefined ? want[missing[0]] : want)?.slice(0, 300)}\nafter:  ${JSON.stringify(missing.length && got?.[missing[0]] !== undefined ? got[missing[0]] : got)?.slice(0, 300)}`);
    }
    expect((await youOf(b.page))?.name === 'Kit', 'restore did not bring the names to the mirror');
    expect(!b.errors.length, b.errors.join('\n'));
    await b.ctx.close();

    for (let i = 0; i < Math.max(...['theme', 'accent', 'card-back', 'plate', 'motion'].map((k) => ids[k].length)); i++) {
      const variant = fullSave(now);
      for (const [field, kind] of [['theme', 'theme'], ['accent', 'accent'], ['cardBack', 'card-back'], ['plate', 'plate']]) variant.profile[field] = ids[kind][i % ids[kind].length];
      variant.settings.motion = ids.motion[i % ids.motion.length];
      const v = await open({ [SAVE]: JSON.stringify(variant), 'dbt.app.v1': SEEN });
      await reachHub(v.page);
      const got = JSON.parse(await ls(v.page, SAVE));
      for (const k of ['theme', 'accent', 'cardBack', 'plate']) expect(got.profile[k] === variant.profile[k], `${k} ${variant.profile[k]} did not load`);
      expect(got.settings.motion === variant.settings.motion, 'a motion setting did not load');
      expect(!v.errors.length, v.errors.join('\n'));
      await v.ctx.close();
    }
  },

  async 'final-ids-old-shape'({ open, ls, expect, reachHub, shot, SAVE, SEEN }) {
    const now = Date.now();
    const t0 = now - 3 * DAY;
    const old = {
      created: t0,
      events: [
        { id: 'o-1', t: t0, day: dayOf(t0), k: 'visit', xp: 10 },
        { id: 'o-2', t: t0 + 1000, day: dayOf(t0), k: 'skill', xp: 20, stat: 'sense', skill: ids.skill[0] },
      ],
      diary: { [dayOf(t0)]: { day: dayOf(t0), emotions: { Sadness: 3 }, urges: {}, note: 'old note', updatedAt: t0 } },
      lists: { comfort: [{ id: 'oc-1', text: 'Blanket' }] },
      settings: { sound: true, motion: 'system', emotionRows: ['Sadness'], urgeRows: [] },
      flags: { rankSeen: 0 },
    };
    const { page, errors } = await open({ [SAVE]: JSON.stringify(old), 'dbt.app.v1': SEEN });
    await reachHub(page);
    await shot(page, 'me91-04-old-shape-home');
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(!keys.some((k) => k.includes('.unreadable')), 'the old save was set aside as unreadable');
    const s = JSON.parse((await ls(page, SAVE)) ?? 'null');
    expect(s?.v === Number(ids['save-schema'][0]), 'the old save was not brought up to the current version: ' + s?.v);
    expect(['o-1', 'o-2'].every((id) => s.events.some((e) => e.id === id)), 'old events lost');
    expect(s.diary[dayOf(t0)]?.note === 'old note' && s.lists.comfort[0]?.text === 'Blanket', 'old diary or list lost');
    const p = s.profile;
    expect(p && p.theme === ids.theme[0] && p.accent === ids.accent[0] && p.cardBack === ids['card-back'][0] && p.plate === ids.plate[0] && p.title === '' && same(p.names, {}), 'missing profile did not get defaults: ' + JSON.stringify(p));
    expect(Array.isArray(s.lines) && Array.isArray(s.maps) && s.gone && typeof s.setAt === 'object', 'missing fields did not get defaults');
    expect(!errors.length, errors.join('\n'));
  },

  async 'final-ids-guard'({ out, expect }) {
    const write = (snap) => {
      const file = path.join(out, `me91-snapshot-${Math.random().toString(36).slice(2, 8)}.json`);
      fs.writeFileSync(file, JSON.stringify(snap));
      return file;
    };
    const run = (snap, base = snap, env = process.env) => {
      const args = ['scripts/check-stored-ids.mjs', `--snapshot=${write(snap)}`, ...(base ? [`--baseline=${write(base)}`] : [])];
      try {
        return { code: 0, text: execFileSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
      } catch (e) {
        return { code: e.status, text: `${e.stdout}${e.stderr}` };
      }
    };
    const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    const now = run(snap, null);
    fs.writeFileSync(path.join(out, 'me91-guard-main.txt'), now.text);
    expect(now.code === 0 && /^OK/m.test(now.text), 'guard fails on the committed snapshot against main:\n' + now.text);
    const lost = run(snap, null, { ...process.env, STORED_IDS_BASE: 'no-such-ref-me91' });
    expect(lost.code === 1 && lost.text.includes("Can't find the earlier list"), 'guard passed without an earlier list to compare with:\n' + lost.text);
    const renamed = structuredClone(snap);
    renamed.ids.skill.push('renamed-away');
    const r = run(renamed);
    fs.writeFileSync(path.join(out, 'me91-guard-renamed.txt'), r.text);
    expect(r.code === 1 && /skill "renamed-away" is stored on players' devices but no longer in the source/.test(r.text), 'guard passed a lost skill id:\n' + r.text);
    renamed.migrations = [{ kind: 'skill', from: 'renamed-away', to: ids.skill[0], since: '2026-10-23' }];
    const m = run(renamed);
    expect(m.code === 0, 'guard refused a lost id that has a migration:\n' + m.text);
    const moved = structuredClone(renamed);
    moved.migrations[0].to = ids.skill[1];
    const mv = run(moved, renamed);
    expect(mv.code === 1 && mv.text.includes('was changed or removed'), 'guard accepted a shipped migration being changed:\n' + mv.text);
    const added = structuredClone(snap);
    const fresh = added.ids.skill.pop();
    const a = run(added);
    fs.writeFileSync(path.join(out, 'me91-guard-added.txt'), a.text);
    expect(a.code === 0 && a.text.includes(`skill: ${fresh}`) && a.text.includes('--update'), 'guard did not pass and list a new id:\n' + a.text);
    renamed.migrations[0].since = '';
    const invalid = run(renamed);
    expect(invalid.code === 1 && invalid.text.includes('Invalid migration'), 'guard accepted an undocumented migration');
    const empty = run({ ids: {}, migrations: [] });
    expect(empty.code === 1 && empty.text.includes('Invalid stored-id snapshot'), 'guard accepted an empty snapshot');

    const scratch = path.join(out, 'guard-source');
    fs.mkdirSync(path.join(scratch, 'scripts'), { recursive: true });
    fs.cpSync(path.join(root, 'src'), path.join(scratch, 'src'), { recursive: true });
    for (const file of ['check-stored-ids.mjs', 'stored-ids.json']) fs.copyFileSync(path.join(root, 'scripts', file), path.join(scratch, 'scripts', file));
    fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(scratch, 'node_modules'), 'dir');
    const sourceRun = (label, code, match) => {
      let actual = 0, output;
      try { output = execFileSync(process.execPath, ['scripts/check-stored-ids.mjs', `--baseline=${SNAP}`], { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { actual = e.status; output = `${e.stdout}${e.stderr}`; }
      fs.writeFileSync(path.join(out, `me91-source-${label}.txt`), output);
      expect(actual === code && match.test(output), `${label}: exit ${actual}\n${output}`);
    };
    const file = path.join(scratch, 'src/content/dbt.ts');
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original.replace("id: 'lie-low'", "id: 'lay-low'"));
    sourceRun('rename', 1, /skill "lie-low" is stored/);
    const scratchSnap = path.join(scratch, 'scripts/stored-ids.json');
    const frozen = fs.readFileSync(scratchSnap, 'utf8');
    fs.writeFileSync(scratchSnap, frozen.replace('"lie-low"', '"lay-low"'));
    sourceRun('rename-list-too', 1, /skill "lie-low" was frozen in .+ and is gone from the list/);
    const kept = JSON.parse(frozen);
    kept.ids.skill.push('lay-low');
    kept.migrations.push({ kind: 'skill', from: 'lie-low', to: 'lay-low', since: '2026-10-23' });
    fs.writeFileSync(scratchSnap, JSON.stringify(kept));
    sourceRun('rename-migrated', 0, /renamed by a migration/);
    fs.writeFileSync(scratchSnap, frozen);
    fs.writeFileSync(file, original.replace('export const SKILL =', "SKILLS.push({ ...SKILLS[0], id: 'guard-new-skill' });\nexport const SKILL ="));
    sourceRun('addition', 0, /skill: guard-new-skill[\s\S]*--update/);
    fs.writeFileSync(file, original);
    const sw = path.join(scratch, 'src/pwa/sw-template.js');
    fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/^const (PREFIX|META) = .*;$/gm, ''));
    sourceRun('zero', 1, /found no sw-cache ids/);
    fs.copyFileSync(path.join(root, 'src/pwa/sw-template.js'), sw);
    fs.writeFileSync(file, 'export const broken = ;');
    sourceRun('import', 1, /Error|error/i);
  },
};
