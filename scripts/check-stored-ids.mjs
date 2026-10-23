import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const snapPath = path.resolve(root, flags.snapshot ?? 'scripts/stored-ids.json');
const KEBAB = new Set(['skill', 'stat', 'event-kind', 'shadow', 'title', 'theme', 'accent', 'card-back', 'plate', 'motion', 'art-paper', 'chapter-kind', 'region']);

class MemoryStorage {
  #m = new Map();
  get length() { return this.#m.size; }
  key(i) { return [...this.#m.keys()][i] ?? null; }
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(String(k), String(v)); }
  removeItem(k) { this.#m.delete(k); }
}
globalThis.localStorage = new MemoryStorage();

const MAPS = { diary: '<day>', 'diary.<day>.emotions': '<row>', 'diary.<day>.urges': '<row>', 'diary.<day>.ft': '<field>', gone: '<id>', 'profile.names': '<shadow>' };
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

function interfaceFields(file, type) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const body = source.match(new RegExp(`(?:export )?interface ${type} \\{\\n([\\s\\S]*?)^\\}`, 'm'))?.[1];
  const fields = [...(body ?? '').matchAll(/^  (\w+)\??:/gm)].map((m) => `${type}.${m[1]}`);
  if (!fields.length) throw new Error(`Cannot read ${type} fields in ${file}; update the stored-id collector.`);
  return fields;
}

async function collect() {
  const vite = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const load = (f) => vite.ssrLoadModule(path.join(root, f));
    const names = await load('src/core/stored-names.ts');
    const store = await load('src/daily/store.ts');
    const dbt = await load('src/content/dbt.ts');
    const lines = await load('src/content/daily-lines.ts');
    const roster = await load('src/content/roster-lines.ts');
    const crisis = await load('src/content/crisis-lines.ts');
    const art = await load('src/daily/artstore.ts');
    const ink = await load('src/daily/ink.ts');
    const story = await load('src/daily/storystore.ts');
    const you = await load('src/core/you.ts');
    const prefs = await load('src/audio/prefs.ts');
    const sw = fs.readFileSync(path.join(root, 'src/pwa/sw-template.js'), 'utf8');
    const swName = (k) => sw.match(new RegExp(`^const ${k} = '([^']+)';`, 'm'))?.[1];

    const t = Date.UTC(2026, 9, 20, 12);
    const day = store.dayKey(t);
    const stats = [...new Set(Object.values(dbt.MODULES).map((m) => m.stat))];
    const shadow = roster.SHADOW_IDS[0];
    const s = store.freshState(t);
    s.events.push({ id: 'e1', t, day, k: 'skill', xp: 20, stat: stats[0], skill: dbt.SKILLS[0].id, data: { answer: 'Yes' } });
    s.diary[day] = { day, emotions: { Joy: 2 }, urges: { Rest: 1 }, note: 'n', updatedAt: t, ft: { [store.fieldKey('emotions', 'Joy')]: t, [store.fieldKey('urges', 'Rest')]: t, note: t } };
    for (const k of ['comfort', 'activities', 'reasons']) s.lists[k].push({ id: `${k}1`, text: 'x', at: t });
    s.lists.people.push({ id: 'p1', name: 'A', phone: '1', at: t });
    s.maps.push({ id: 'm1', t, urge: 'u', p1: 'a', c1: 'b', p2: 'c', c2: 'd', choice: 'e', at: t });
    s.lines.push({ day, id: lines.TODAY_LINES.low[0].id, tag: 'STATUS', text: 'x', t });
    s.gone.g1 = t;
    s.settings.names[shadow] = 'Ash';
    s.flags.titlesSeen.push(roster.TITLE_IDS[0]);
    for (const k of [...Object.keys(s.settings).filter((k) => k !== 'names'), 'safeCredit', `name:${shadow}`]) s.setAt[k] = t;
    new store.Store('check.first', () => t, s);
    const back = store.normalize(JSON.parse(localStorage.getItem('check.first') ?? 'null'));
    if (!back) throw new Error('the save the Store wrote could not be read back');
    const st = new store.Store('check.save', () => t, back);
    const saved = JSON.parse(localStorage.getItem('check.save') ?? 'null');
    const rec = art.cleanRec({ id: 'a1', kind: 'ally', day, t, updated: t, prompt: 'p', name: 'n', rev: 'r1', from: ['r0@1'], strokes: [{ i: 0, w: 4, p: [1, 2, 3, 4] }] });
    const tale = story.cleanStory({ id: 's1', title: 'T', created: t, updated: t, rev: 'r1', chapters: ['c1'], notes: 'c2', removed: t });
    const chapter = story.cleanChapter({ id: 'c1', story: 's1', kind: 'page', title: 'C', text: 'x', updated: t, rev: 'r1' });
    const crystal = JSON.parse(st.exportJSON({ art: [rec], stories: { stories: [tale], chapters: [chapter] } }));
    const card = story.cleanCard({ id: 'k1', mode: story.CARD_MODES[0], text: 'x', t, sel: { start: 0, end: 1, text: 'x' } });
    you.writeYou({ name: 'Kit', companion: 'Lumen', nameAt: t, companionAt: t });
    prefs.savePrefs({ master: 1, music: 1, sfx: 1, muted: false });
    const json = (k) => Object.keys(JSON.parse(localStorage.getItem(k) ?? '{}'));

    return {
      'local-storage': [names.SAVE_KEY, names.LAB_SAVE_KEY, names.APP_KEY, names.YOU_KEY, names.AUDIO_KEY, names.COWRITER_KEY, names.INSTALL_HINT_KEY],
      'beside-save-key': Object.values(names.BESIDE),
      'indexeddb-store': [...names.ART_DB.stores.map((x) => `${names.BESIDE.art}/${x}`), ...names.STORY_DB.stores.map((x) => `${names.BESIDE.story}/${x}`), `${names.BESIDE.story}/chapters/index:${names.STORY_DB.chapterIndex}`],
      'indexeddb-version': [`${names.BESIDE.art}@${names.ART_DB.version}`, `${names.BESIDE.story}@${names.STORY_DB.version}`],
      'session-storage': [names.TAB_KEY, names.CARE_KEY],
      'sw-cache': [swName('PREFIX'), swName('META')].filter(Boolean),
      'save-crystal-app': [names.APP_ID],
      'save-schema': [String(store.SCHEMA)],
      'save-field': [...paths(saved)],
      'crystal-field': [...paths(crystal)].filter((p) => !Object.prototype.hasOwnProperty.call(saved, p.split(/[.[]/)[0])),
      'story-card-field': [...paths(card)],
      'diary-field-key': Object.keys(store.fieldTimes({ day, emotions: { '<row>': 1 }, urges: { '<row>': 1 }, note: 'n', updatedAt: t })),
      'you-field': json(names.YOU_KEY),
      'audio-field': json(names.AUDIO_KEY),
      'stored-interface-field': [
        ...['Ev', 'Item', 'Person', 'SavedMap', 'DiaryEntry', 'LineEntry', 'Settings', 'Flags', 'State'].flatMap((type) => interfaceFields('src/daily/store.ts', type)),
        ...['DrawingMeta', 'Draft'].flatMap((type) => interfaceFields('src/daily/artstore.ts', type)),
        ...['Story', 'Chapter', 'Card', 'Live'].flatMap((type) => interfaceFields('src/daily/storystore.ts', type)),
        ...interfaceFields('src/cowriter/client.ts', 'Cred'),
      ],
      'app-field': [...fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8').matchAll(/^  (\w+): boolean;/gm)].map((m) => m[1]),
      'stealth-field': [...fs.readFileSync(path.join(root, 'src/daily/pages.ts'), 'utf8').matchAll(/prefs: \{ ([^}]+) \}/g)].flatMap((m) => [...m[1].matchAll(/(\w+): boolean/g)].map((x) => x[1])),
      'sw-record': [...sw.matchAll(/meta\.(?:match|put)\('([^']+)'/g)].map((m) => m[1]).filter((x, i, a) => a.indexOf(x) === i),
      'ink-index': ink.INKS.map((x, i) => `${i}:${x.id}`),
      skill: dbt.SKILLS.map((x) => x.id),
      stat: stats,
      'event-kind': store.EV_KINDS,
      'event-data': Object.entries(store.EV_DATA).flatMap(([k, keys]) => keys.map((x) => `${k}.${x}`)),
      feeling: [...dbt.FEELINGS],
      'feedback-answer': Object.keys(lines.SKILL_END.thanks),
      line: Object.values(lines.TODAY_LINES).flat().map((x) => x.id),
      shadow: [...roster.SHADOW_IDS],
      title: [...roster.TITLE_IDS],
      theme: [...roster.THEME_IDS],
      accent: [...roster.ACCENT_IDS],
      'card-back': [...roster.CARD_BACK_IDS],
      plate: [...roster.PLATE_IDS],
      region: crisis.REGIONS.map((r) => r.id),
      motion: [...store.MOTIONS],
      'art-paper': Object.keys(ink.PAGE),
      'chapter-kind': [...story.CHAPTER_KINDS],
      'cowriter-card-mode': [...story.CARD_MODES],
    };
  } finally {
    await vite.close();
  }
}

const now = await collect();
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
if (!snap.ids || typeof snap.ids !== 'object' || Array.isArray(snap.ids) || !Object.keys(snap.ids).length || !Array.isArray(snap.migrations)) throw new Error('Invalid stored-id snapshot: expected nonempty ids and a migrations array.');
const migrations = snap.migrations;
const problems = [];
const added = [];
let migrated = 0;
for (const [kind, ids] of Object.entries(snap.ids)) {
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id)) throw new Error(`Invalid stored-id snapshot group: ${kind}`);
}
for (const m of migrations) {
  if (!m || !Object.hasOwn(snap.ids, m.kind) || !snap.ids[m.kind].includes(m.from) || !(m.to === null || typeof m.to === 'string' && m.to) || typeof m.since !== 'string' || !m.since.trim()) problems.push(`Invalid migration: expected { kind, from, to, since } naming a frozen id and its first release.`);
}

function earlier() {
  if (flags.baseline) {
    const file = path.resolve(root, flags.baseline);
    return { from: path.relative(root, file), snap: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let ref;
  try {
    ref = process.env.STORED_IDS_BASE || git('merge-base', 'HEAD', 'origin/main');
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    problems.push(`Can't find the earlier list to compare with (${ref ?? 'origin/main'}). Run: git fetch origin main, or pass --baseline=<an earlier stored-ids.json>.`);
    return null;
  }
  try { git('cat-file', '-e', `${ref}:scripts/stored-ids.json`); } catch { return { from: ref, snap: null }; }
  return { from: ref, snap: JSON.parse(git('show', `${ref}:scripts/stored-ids.json`)) };
}
const base = earlier();
if (base && !base.snap) console.log(`No list at ${base.from} yet: this is the first freeze.`);
for (const [kind, ids] of Object.entries(base?.snap?.ids ?? {})) {
  const kept = new Set(snap.ids[kind] ?? []);
  for (const id of ids) if (!kept.has(id)) problems.push(`${kind} "${id}" was frozen in ${base.from} and is gone from the list. Frozen ids stay listed for good: to rename one, keep it, freeze the new one and add a migration (CONTRIBUTING.md).`);
}
for (const m of base?.snap?.migrations ?? []) {
  if (!migrations.some((x) => x?.kind === m.kind && x.from === m.from && x.to === m.to && x.since === m.since)) problems.push(`migration ${JSON.stringify(m)} from ${base.from} was changed or removed. Migrations stay as they shipped.`);
}
for (const [kind, ids] of Object.entries(now)) {
  if (!ids.length) problems.push(`found no ${kind} ids in the source: this check can't read them any more, so it can't protect them (fix scripts/check-stored-ids.mjs)`);
  if (new Set(ids).size !== ids.length) problems.push(`${kind}: the same id twice: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);
  const frozen = new Set(snap.ids?.[kind] ?? []);
  for (const id of ids) {
    if (frozen.has(id)) continue;
    added.push(`${kind}: ${id}`);
    if (KEBAB.has(kind) && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) problems.push(`${kind} "${id}": new ids are lowercase words joined by '-'`);
  }
}
for (const [kind, ids] of Object.entries(snap.ids ?? {})) {
  const cur = new Set(now[kind] ?? []);
  for (const id of ids) {
    if (cur.has(id)) continue;
    const m = migrations.find((x) => x?.kind === kind && x.from === id);
    if (!m) problems.push(`${kind} "${id}" is stored on players' devices but no longer in the source. Put it back, or add a migration { kind, from, to, since } and the code that reads the old one (CONTRIBUTING.md).`);
    else if (m.to !== null && !cur.has(m.to)) problems.push(`${kind} migration "${id}" -> "${m.to}": "${m.to}" is not in the source either`);
    else migrated++;
  }
}

if (added.length) console.log(`New since the snapshot (${added.length}):\n  ${added.join('\n  ')}`);
if (problems.length) {
  console.error(`\nFAIL: ${problems.length} stored name${problems.length === 1 ? '' : 's'} at risk:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
if (added.length && flags.update) {
  const ids = { ...snap.ids };
  for (const [kind, list] of Object.entries(now)) ids[kind] = [...new Set([...(ids[kind] ?? []), ...list])];
  const body = Object.entries(ids).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  const mig = migrations.length ? `[\n${migrations.map((m) => `    ${JSON.stringify(m)}`).join(',\n')}\n  ]` : '[]';
  fs.writeFileSync(snapPath, `{\n  "about": ${JSON.stringify(snap.about)},\n  "ids": {\n${body}\n  },\n  "migrations-format": ${JSON.stringify(snap['migrations-format'])},\n  "migrations": ${mig}\n}\n`);
  console.log(`\nFroze ${added.length} new id${added.length === 1 ? '' : 's'} in ${path.relative(root, snapPath)}.`);
} else if (added.length) console.log('\nOK. Once these are final, freeze them with: npm run check:ids -- --update');
else console.log(`OK: all ${Object.values(now).flat().length} stored names and ids are in place${migrated ? `, and ${migrated} renamed by a migration` : ""}.`);
