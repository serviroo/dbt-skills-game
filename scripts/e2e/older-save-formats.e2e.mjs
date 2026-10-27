// Test every older save format. Each file in scripts/e2e/fixtures/older-saves/ is a save or Save Crystal the way one
// past build of The Lantern wrote it (manifest.json says which build and what it holds). Each one boots in the real
// app (a device save from storage, a Save Crystal through Restore on a clean device) and shows its names and motion
// choice in Settings. It is backed up, restored on another clean device, reloaded and backed up again. Every event,
// diary field, list item, map, line, choice, flag, drawing, story and preference it held must still be there, by id and
// value. Missing fields come back as defaults, XP and the collection never shrink, today's card stays the same card,
// and two tabs writing at once both keep what they added.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayKey } from './skill-check.e2e.mjs';
import { crystal, restore, settings } from './newer-save-safety.e2e.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/older-saves');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const DEFAULTS = { sound: true, motion: 'system', vibrate: false, theme: 'classic', accent: 'blue', cardBack: 'ring', plate: 'plain', title: '', region: '', playerName: '', companion: '' };

/** A fixture, with its second card moved to today so today's card can be checked. */
function fixture(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const card = raw.events?.find((e) => e.id === 'h-card-2');
  if (card) Object.assign(card, { day: dayKey(Date.now()), t: Date.now() - 60000 });
  return raw;
}

/** What must survive, read by id, day and choice rather than by layout. */
function parts(s) {
  const p = s.profile ?? {};
  const sorted = (l, f) => (l ?? []).map(f).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return {
    events: Object.fromEntries((s.events ?? []).map((e) => [e.id, [e.k, e.xp, e.stat ?? null, e.skill ?? null, e.data ?? null]])),
    diary: Object.fromEntries(Object.entries(s.diary ?? {}).map(([d, e]) => [d, [e.emotions, e.urges, e.note]])),
    // field times as stored; a day saved without them gets them from its save time when two copies merge
    ft: Object.fromEntries(Object.entries(s.diary ?? {}).map(([d, e]) => [d, e.ft ?? {}])),
    gone: Object.entries(s.gone ?? {}).sort(),
    lists: Object.fromEntries(['comfort', 'activities', 'reasons', 'people'].map((k) => [k, sorted(s.lists?.[k], (i) => [i.id, i.text ?? i.name, i.phone ?? null])])),
    maps: sorted(s.maps, (m) => [m.id, m.urge, m.p1, m.c1, m.p2, m.c2, m.choice]),
    lines: sorted(s.lines, (l) => [l.day, l.id, l.text]),
    choices: { sound: s.settings?.sound, motion: s.settings?.motion, vibrate: s.settings?.vibrate, theme: p.theme, accent: p.accent, cardBack: p.cardBack, plate: p.plate, title: p.title, region: p.region, playerName: p.playerName, companion: p.companion, names: p.names },
    rows: [s.settings?.emotionRows, s.settings?.urgeRows],
    titles: p.titlesSeen,
    // safeCredit is left out: it is a one-time notice that Home shows and clears as soon as it opens
    flags: s.flags ? [s.flags.rankSeen, s.flags.wardenSeen, s.flags.therapistLineShown, s.flags.questAsideDay ?? '', s.flags.questAsideAt ?? 0] : null,
    art: sorted(s.art, (a) => [a.id, a.kind, a.day, a.name ?? null, a.prompt ?? null, a.strokes]),
    stories: sorted(s.stories?.stories, (x) => [x.id, x.title, x.chapters, x.notes]),
    chapters: sorted(s.stories?.chapters, (c) => [c.id, c.story, c.kind, c.title, c.text]),
    // story cards are kept per chapter
    cards: sorted(Object.entries(s.stories?.cards ?? {}).flatMap(([ch, l]) => l.map((c) => ({ ch, ...c }))), (c) => [c.ch, c.id, c.mode, c.text]),
    preferences: s.preferences ?? null,
  };
}

/** Everything in want that got is missing or holds differently; newly added events, rows and defaults are fine. */
function lost(want, got, where) {
  const bad = [];
  const j = JSON.stringify;
  for (const [id, e] of Object.entries(want.events)) if (j(got.events[id]) !== j(e)) bad.push(`event ${id}: ${j(got.events[id])}, not ${j(e)}`);
  for (const [d, e] of Object.entries(want.diary)) if (j(got.diary[d]) !== j(e)) bad.push(`diary ${d}: ${j(got.diary[d])}, not ${j(e)}`);
  for (const [d, ft] of Object.entries(want.ft)) for (const [k, v] of Object.entries(ft)) if (got.ft[d]?.[k] !== v) bad.push(`diary ${d} field time ${k}: ${got.ft[d]?.[k]}, not ${v}`);
  // removals travel with a device save and its backup; a restore adds and never applies the file's removals
  for (const g of want.gone) if (!got.gone.some((x) => j(x) === j(g))) bad.push(`removal ${j(g)} is gone`);
  for (const [k, l] of Object.entries(want.lists)) for (const i of l) if (!got.lists[k].some((x) => j(x) === j(i))) bad.push(`${k} item ${j(i)} is gone`);
  for (const k of ['maps', 'lines', 'art', 'stories', 'chapters', 'cards']) for (const i of want[k]) if (!got[k].some((x) => j(x) === j(i))) bad.push(`${k}: ${j(i)} is gone`);
  for (const [k, v] of Object.entries(want.choices)) {
    const expect = v ?? (k === 'names' ? {} : DEFAULTS[k]);
    if (j(got.choices[k]) !== j(expect)) bad.push(`choice ${k}: ${j(got.choices[k])}, not ${j(expect)}`);
  }
  want.rows.forEach((rows, i) => (rows ?? []).forEach((r) => !got.rows[i]?.includes(r) && bad.push(`diary row "${r}" is gone`)));
  for (const t of want.titles ?? []) if (!got.titles?.includes(t)) bad.push(`title seen ${t} is gone`);
  if (want.flags && got.flags && (got.flags[0] < want.flags[0] || (want.flags[1] && !got.flags[1]) || (want.flags[2] && !got.flags[2]) || j(got.flags.slice(3)) !== j(want.flags.slice(3)))) bad.push(`flags: ${j(got.flags)}, not ${j(want.flags)}`);
  if (want.preferences && j(got.preferences) !== j(want.preferences)) bad.push(`preferences: ${j(got.preferences)}, not ${j(want.preferences)}`);
  return bad.map((b) => `${where}: ${b}`);
}

const savedOf = async (h, page) => JSON.parse((await h.ls(page, h.SAVE)) ?? 'null');
const progress = (page) => page.evaluate(() => { const st = window.__daily.store; const d = st.derived(); const q = st.quest(); return { xp: d.xp, collection: [...d.collection].sort(), card: [q.slot, q.skill, q.special ?? null, q.label ?? null] }; });

/** What Settings shows for the names and the motion choice. */
async function shown(h, page) {
  await settings(h, page);
  return page.evaluate(() => ({
    playerName: document.querySelector('#set-playerName')?.value ?? null,
    companion: document.querySelector('#set-companion')?.value ?? null,
    motion: ['system', 'reduce', 'full'][[...document.querySelectorAll('.dq-settings [aria-label="Motion"] [role="radio"]')].findIndex((b) => b.getAttribute('aria-checked') === 'true')] ?? null,
  }));
}

/** Boots one format, checks it, backs it up, restores it on a clean device and backs that up again. */
async function matrix(h, file, kind) {
  const src = fixture(file);
  const want = parts(src);
  const added = { ...want, gone: [] };
  const tag = file.replace(/^\.\.\//, '').replace(/\.json$/, '');
  const problems = [];
  // boot: a device save straight from storage, a Save Crystal through Restore on a clean device
  const a = await h.open(kind === 'local' ? { [h.SAVE]: JSON.stringify(src), 'dbt.app.v1': h.SEEN } : { 'dbt.app.v1': h.SEEN });
  await h.reachHub(a.page);
  if (kind === 'crystal') {
    h.expect(/Restored/.test(await restore(h, a.page, src, `${tag}.json`)), `${tag}: Restore refused it`);
    await a.page.reload();
    await h.reachHub(a.page);
  }
  const booted = await savedOf(h, a.page);
  h.expect(booted && booted.v === 1, `${tag}: booting did not keep a version 1 save (${booted?.v})`);
  problems.push(...lost({ ...(kind === 'local' ? want : added), art: [], stories: [], chapters: [], cards: [], preferences: null }, parts(booted), `${tag} booted`));
  const before = await progress(a.page);
  const sees = await shown(h, a.page);
  const choice = (k) => want.choices[k] ?? DEFAULTS[k];
  if (sees.playerName !== choice('playerName') || sees.companion !== choice('companion') || sees.motion !== choice('motion')) problems.push(`${tag}: Settings shows ${JSON.stringify(sees)}`);
  await h.shot(a.page, `older-${tag}-settings-390x844`);
  const one = await crystal(h, a.page, `older-${tag}-backup`);
  problems.push(...lost(kind === 'local' ? want : added, parts(one), `${tag} backup`));
  h.expect(!a.errors.length, `${tag}: ${a.errors.join('\n')}`);
  await a.ctx.close();
  // restored on a clean device, reloaded, backed up again
  const b = await h.open({ 'dbt.app.v1': h.SEEN });
  await h.reachHub(b.page);
  h.expect(/Restored/.test(await restore(h, b.page, one, `${tag}-backup.json`)), `${tag}: the backup was refused`);
  await b.page.reload();
  await h.reachHub(b.page);
  problems.push(...lost({ ...added, art: [], stories: [], chapters: [], cards: [], preferences: null }, parts(await savedOf(h, b.page)), `${tag} restored`));
  const after = await progress(b.page);
  if (after.xp < before.xp) problems.push(`${tag}: XP went from ${before.xp} to ${after.xp}`);
  for (const id of before.collection) if (!after.collection.includes(id)) problems.push(`${tag}: ${id} left the collection`);
  if (src.events?.some((e) => e.id === 'h-card-2') && JSON.stringify(after.card) !== JSON.stringify(before.card)) problems.push(`${tag}: today's card was ${JSON.stringify(before.card)}, is ${JSON.stringify(after.card)}`);
  const two = await crystal(h, b.page, `older-${tag}-backup-again`);
  problems.push(...lost(added, parts(two), `${tag} backed up again`));
  h.expect(!b.errors.length, `${tag}: ${b.errors.join('\n')}`);
  await b.ctx.close();
  h.expect(!problems.length, problems.join('\n'));
  return { xp: [before.xp, after.xp], card: before.card };
}

export const scenarios = {
  ...Object.fromEntries(MANIFEST.fixtures.filter((f) => f.writer !== '0530e1e').map((f) => [`older-${f.file.replace(/^\.\.\//, '').replace(/\.json$/, '')}`, (h) => matrix(h, f.file, f.kind)])),

  async 'older-two-tabs'(h) {
    const { ctx, page: a, errors } = await h.open({ [h.SAVE]: JSON.stringify(fixture('local-6ee8c03.json')), 'dbt.app.v1': h.SEEN });
    await h.reachHub(a);
    const b = await ctx.newPage();
    b.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await b.goto(a.url());
    await h.reachHub(b);
    const add = (page, skill) => page.evaluate((skill) => window.__daily.store.add('skill', 20, { skill, stat: 'stamina' }).id, skill);
    const [one, two] = await Promise.all([add(a, 'stop'), add(b, 'tipp')]);
    await a.reload();
    await h.reachHub(a);
    const s = await savedOf(h, a);
    h.expect(s.events.some((e) => e.id === one) && s.events.some((e) => e.id === two), 'one tab replaced what the other added');
    const bad = lost(parts(fixture('local-6ee8c03.json')), parts(s), 'two tabs');
    h.expect(!bad.length, bad.join('\n'));
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
