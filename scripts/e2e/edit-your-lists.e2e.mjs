// Change and reorder your own lists: the comfort kit, things that are yours and your people, on Comfort and in the Safe
// Zone, on a save from before entries had an order of their own.
//   edit-your-lists         Edit opens an entry's words (a person's name and number) in place, filled in, focus in
//                           them with nothing selected; Enter or Save keeps the change, Cancel and Escape drop it, an
//                           empty one is never saved, and focus goes back to that entry's Edit. The change shows after
//                           a reload and in the other view, and the new number dials in one tap. In the Safe Zone the
//                           list stays calm until "Edit the list", Escape closes the edit and not the Safe Zone, Leave
//                           leaves at once and keeps nothing half typed, and nothing plays, credits or shows a toast
//   reorder-your-lists      Move up and Move down by keyboard alone: focus stays on the button that moved its entry,
//                           in view with its ring, the top one's Move up dims and does nothing, a screen reader hears
//                           where it went, and the order holds in the Safe Zone, on Comfort, in "Copy your lists", in
//                           what is stored and after a reload
//   edit-your-lists-saves   a save from before places loads in its stored order (an older build's add goes last), two
//                           added at the same place keep their order through an edit and a reload, and a Save Crystal
//                           carries the words and the order to a new device, or after a device's own
//   edit-your-lists-newer-save  what a newer build stored past this build's limits, and fields it doesn't know, stay
//                           as stored through a move, a change to the number alone, a removal undone, a Crystal and a
//                           restore after a device's own entries; one with no places yet keeps every place a move gives
//   edit-your-lists-tabs    an edit in one tab and a move in another both stay: the open edit keeps its words, caret
//                           and focus as the move lands, the mover keeps focus, and a copy that never saw either
//                           change, or saw all but the move, can't undo them, where they are stored or after a reload
//   edit-your-lists-fit     with Edit and the moves showing and an edit open, everything fits at 390 and 320 wide,
//                           held sideways and at 200% zoom: nothing runs off the side, every button is a tap in size,
//                           the field shows whole and "Talk to someone now" stays pinned
import fs from 'node:fs';
import path from 'node:path';
import { until } from './harness.mjs';
import { nameOf, whole } from './safe-zone-access.e2e.mjs';

const T = Date.now() - 86400e3;
const LISTS = {
  comfort: [{ id: 'c1', text: 'Tea', at: T }, { id: 'c2', text: 'Blanket', at: T }, { id: 'c3', text: 'Rain', at: T }],
  activities: [{ id: 'a1', text: 'A puzzle', at: T }],
  reasons: [{ id: 'r1', text: 'Quillfeather walks', at: T }, { id: 'r2', text: 'Lanternfish facts', at: T }, { id: 'r3', text: 'Kestrel feathers', at: T }],
  people: [{ id: 'p1', name: 'Sam', phone: '+1 555 0100', at: T }, { id: 'p2', name: 'Robin', phone: '', at: T }],
};
const SIZES = [
  ['390x844', { width: 390, height: 844 }],
  ['320x568', { width: 320, height: 568 }],
];
const PANEL = { comfort: 'Comfort kit', reasons: 'Things that are yours', people: 'People' };
const HEADING = { comfort: 'Your comfort kit', reasons: 'Things that are yours', people: 'Your people' };

const seedOf = (h, save = { lists: LISTS }) => ({
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: T, companionAt: T }),
  'dbt.app.v1': h.SEEN,
  [h.SAVE]: JSON.stringify({ v: 1, created: T, events: [], ...save }),
});
/** Notes every sound the companion plays from now on. */
const hear = (page) =>
  page.evaluate(() => {
    const app = window.__daily;
    const play = app.sound.bind(app);
    window.__played = [];
    app.sound = (cue) => (window.__played.push(cue), play(cue));
  });
async function open(h, viewport, save) {
  const { ctx, page, errors } = await h.open(seedOf(h, save), '?mute', viewport);
  await h.reachHub(page);
  await hear(page);
  return { ctx, page, errors };
}
const go = (page, route) => page.evaluate((r) => window.__daily.go(r), route);
const safeAt = async (page, at) => {
  await go(page, { name: 'safe', at });
  await page.locator('.dq-sz-t', { hasText: HEADING[at] }).first().waitFor({ timeout: 10000 });
};
const button = (page, name) => page.getByRole('button', { name, exact: true });
const editing = (page) => page.locator('li.is-editing');
const stored = async (h, page) => JSON.parse(await h.ls(page, h.SAVE));
const words = (l) => l.map((x) => x.text ?? [x.name, x.phone].filter(Boolean).join(' '));
/** What a list shows, top to bottom: a Comfort panel by its title, else the Safe Zone screen's list. */
const shown = (page, panel) =>
  page.evaluate((panel) => {
    const box = panel ? [...document.querySelectorAll('.dq-listp')].find((p) => p.querySelector('.dq-chip-t')?.textContent === panel) : document.querySelector('.dq-safezone');
    return [...(box?.querySelectorAll('.dq-items > li, .dq-sz-list > li, .dq-people > li') ?? [])].map((li) => li.querySelector('.dq-entry-t, .dq-person-n')?.textContent ?? '');
  }, panel);
/** What the companion did that the Safe Zone and a list change never do: a sound, XP, a toast, a window, an effect. */
const noise = (page, xp) =>
  page.evaluate((xp) => {
    const out = [];
    if (window.__played.length) out.push(`played ${window.__played.join(', ')}`);
    if (window.__daily.store.derived().xp !== xp) out.push(`XP went from ${xp} to ${window.__daily.store.derived().xp}`);
    const fx = document.querySelectorAll('[data-fx], .dq-toast.is-on, .dq-sw, .lw').length;
    if (fx) out.push(`${fx} toast, window or effect`);
    return out;
  }, xp);
/**
 * What has focus: its name, whether the player sees it whole, and whether its ring (the outline past its gap) is on the
 * screen and clear of the pinned bars.
 */
const focusIs = (page) =>
  page.evaluate(`(() => {
    const nameOf = ${nameOf};
    const whole = ${whole};
    const a = document.activeElement;
    if (!a || a === document.body) return { name: 'nothing', seen: false, ring: false };
    const cs = getComputedStyle(a);
    const w = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) + Math.max(0, parseFloat(cs.outlineOffset));
    const r = a.getBoundingClientRect();
    const o = { top: r.top - w, bottom: r.bottom + w, left: r.left - w, right: r.right + w };
    const onScreen = o.top >= -0.5 && o.left >= -0.5 && o.bottom <= innerHeight + 0.5 && o.right <= innerWidth + 0.5;
    const clear = [...document.querySelectorAll('.dq-top, .dq-sz-foot, .dq.is-typing > .dq-sz-talk')].every((bar) => {
      if (bar.contains(a) || !bar.checkVisibility()) return true;
      const b = bar.getBoundingClientRect();
      return o.bottom <= b.top + 0.5 || o.top >= b.bottom - 0.5 || o.right <= b.left + 0.5 || o.left >= b.right - 0.5;
    });
    return { name: nameOf(a).slice(0, 60), seen: whole(a), ring: onScreen && clear, field: a.matches('input') };
  })()`);
/** A problem unless focus is on the control called `name`, seen whole with its ring. */
async function focusOn(page, name, what) {
  const f = await focusIs(page);
  if (f.name !== name) return [`${what}: focus is on ${f.name}, not ${name}`];
  return f.seen && f.ring ? [] : [`${what}: focus is on ${name}, but ${f.seen ? 'its ring is cut' : 'it is not seen whole'}`];
}
/** Focuses the Safe Zone's top, then tabs on to the control called `name`. */
async function tabTo(page, name) {
  await page.evaluate(() => document.querySelector('.dq-safezone h1').focus());
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if ((await focusIs(page)).name === name) return;
  }
  throw new Error(`Tab never reached "${name}"`);
}
/** Opens an entry's edit and puts `values` in its fields, unsaved. */
async function typeIn(page, entry, ...values) {
  await button(page, `Edit ${entry}`).click();
  for (const [i, v] of values.entries()) await editing(page).locator('input').nth(i).fill(v);
}
const save = (page) => editing(page).getByRole('button', { name: 'Save', exact: true }).click();
const said = (page) => page.evaluate(() => [...document.querySelectorAll('.dq-sr[role="status"]')].map((e) => e.textContent).filter(Boolean));
const live = (page, want) => until(page, (want) => [...document.querySelectorAll('.dq-sr[role="status"]')].some((e) => e.textContent === want), want, { timeout: 3000 }).then(() => true, () => false);
/** Saves a Crystal from Settings into this run's folder: where it went and what it holds. */
async function crystalOf(h, page, name) {
  await go(page, { name: 'settings' });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), button(page, 'Save Crystal').click()]);
  const file = path.join(h.out, `${name}.json`);
  await dl.saveAs(file);
  return { file, raw: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
/** Restores the Crystal at `file` from Settings. */
async function restoreFrom(page, file) {
  await go(page, { name: 'settings' });
  await page.locator('input[type=file]').setInputFiles(file);
  await button(page, 'Restore this Save Crystal').click();
  await page.getByText(/^Restored/).first().waitFor({ timeout: 20000 });
}

export const scenarios = {
  async 'edit-your-lists'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport);
      const xp = await page.evaluate(() => window.__daily.store.derived().xp);
      await go(page, { name: 'comfort' });
      // an item: its words in place, filled in, focus in them and the caret at their end, nothing selected to type over
      await button(page, 'Edit Tea').click();
      const field = editing(page).locator('input').first();
      const opened = await field.evaluate((i) => ({ value: i.value, focus: i === document.activeElement, caret: `${i.selectionStart},${i.selectionEnd}` }));
      if (opened.value !== 'Tea' || !opened.focus || opened.caret !== '3,3') problems.push(`${tag} Comfort: Edit Tea opened ${JSON.stringify(opened)}`);
      problems.push(...(await focusOn(page, 'Words', `${tag} Comfort: Edit Tea opened`)));
      await field.fill('Warm tea');
      await field.press('Enter');
      problems.push(...(await focusOn(page, 'Edit Warm tea', `${tag} Comfort: Enter saved Warm tea`)));
      await typeIn(page, 'Lanternfish facts', 'Lanternfish facts and maps');
      await save(page);
      problems.push(...(await focusOn(page, 'Edit Lanternfish facts and maps', `${tag} Comfort: Save kept a reason`)));
      // a person: name and number, and the number still dials in one tap
      await button(page, 'Edit Sam').click();
      const was = await editing(page).locator('input').evaluateAll((l) => l.map((i) => i.value));
      if (was.join('|') !== 'Sam|+1 555 0100') problems.push(`${tag} Comfort: Edit Sam opened with ${JSON.stringify(was)}`);
      await editing(page).locator('input').nth(0).fill('Sam Okoro');
      await editing(page).locator('input').nth(1).fill('+1 555 0199');
      await save(page);
      problems.push(...(await focusOn(page, 'Edit Sam Okoro', `${tag} Comfort: Save kept a person`)));
      const call = await page.locator('.dq-item--person', { hasText: 'Sam Okoro' }).getByRole('link', { name: 'Call' }).getAttribute('href');
      if (call !== 'tel:+15550199') problems.push(`${tag} Comfort: Sam's Call dials ${call}`);
      // Cancel drops what was typed; an empty entry is never saved; Escape closes the edit as it was
      await typeIn(page, 'Blanket', 'Blanket, the heavy one');
      await editing(page).getByRole('button', { name: 'Cancel', exact: true }).click();
      problems.push(...(await focusOn(page, 'Edit Blanket', `${tag} Comfort: Cancel`)));
      await typeIn(page, 'Rain', '');
      await save(page);
      if (!(await editing(page).count()) || (await focusIs(page)).name !== 'Words') problems.push(`${tag} Comfort: an empty entry closed its edit or lost focus`);
      await page.keyboard.press('Escape');
      if ((await editing(page).count()) || (await page.evaluate(() => window.__daily.route.name)) !== 'comfort') problems.push(`${tag} Comfort: Escape did not close just the edit`);
      problems.push(...(await focusOn(page, 'Edit Rain', `${tag} Comfort: Escape`)));
      const want = { comfort: ['Warm tea', 'Blanket', 'Rain'], reasons: ['Quillfeather walks', 'Lanternfish facts and maps', 'Kestrel feathers'], people: ['Sam Okoro +1 555 0199', 'Robin'] };
      const s = await stored(h, page);
      for (const k of ['comfort', 'reasons', 'people']) if (JSON.stringify(words(s.lists[k])) !== JSON.stringify(want[k])) problems.push(`${tag}: stored ${k} is ${JSON.stringify(words(s.lists[k]))}`);
      problems.push(...(await noise(page, xp)).map((n) => `${tag} Comfort: ${n}`));
      await h.shot(page, `edit-comfort-${tag}`);

      // after a reload, on Comfort and in the Safe Zone
      await page.reload();
      await h.reachHub(page);
      await hear(page);
      await go(page, { name: 'comfort' });
      for (const k of ['comfort', 'reasons']) if (JSON.stringify(await shown(page, PANEL[k])) !== JSON.stringify(want[k])) problems.push(`${tag} reloaded Comfort: ${k} shows ${JSON.stringify(await shown(page, PANEL[k]))}`);
      for (const k of ['comfort', 'reasons']) {
        await safeAt(page, k);
        if (JSON.stringify(await shown(page)) !== JSON.stringify(want[k])) problems.push(`${tag} Safe Zone: ${k} shows ${JSON.stringify(await shown(page))}`);
      }
      await safeAt(page, 'people');
      const dial = await page.locator('.dq-people a[href^="tel:"]').first().evaluate((a) => `${a.getAttribute('aria-label')} ${a.getAttribute('href')}`);
      if (dial !== 'Call Sam Okoro tel:+15550199') problems.push(`${tag} Safe Zone: the first Call is ${dial}`);

      // in the Safe Zone the list stays calm until "Edit the list"
      await safeAt(page, 'comfort');
      if (await page.locator('.dq-sz-list [data-act]').count()) problems.push(`${tag} Safe Zone: Edit or a move shows before Edit the list`);
      await button(page, 'Edit the list').click();
      if ((await focusIs(page)).name !== 'Done editing') problems.push(`${tag} Safe Zone: Edit the list left focus on ${(await focusIs(page)).name}`);
      await typeIn(page, 'Rain', 'Rain sounds');
      await save(page);
      problems.push(...(await focusOn(page, 'Edit Rain sounds', `${tag} Safe Zone: Save`)));
      await typeIn(page, 'Blanket', 'zzz');
      await page.keyboard.press('Escape');
      if ((await editing(page).count()) || (await page.evaluate(() => window.__daily.route.name)) !== 'safe') problems.push(`${tag} Safe Zone: Escape did not close just the edit`);
      const talk = await page.evaluate(() => {
        const t = document.querySelector('.dq-sz-foot .dq-sz-talk');
        const r = t?.getBoundingClientRect();
        return !!r && t.checkVisibility() && r.top >= 0 && r.bottom <= innerHeight;
      });
      if (!talk) problems.push(`${tag} Safe Zone: Talk to someone now is not pinned in view while editing`);
      await typeIn(page, 'Blanket', 'Half typed');
      await h.shot(page, `edit-safe-zone-${tag}`);
      problems.push(...(await noise(page, xp)).map((n) => `${tag} Safe Zone: ${n}`));
      // leaving with an edit open goes at once, asking nothing, and keeps nothing of it
      await page.locator('.dq-top .dq-back').click();
      const left = await page.evaluate(() => window.__daily.route.name !== 'safe' && !document.querySelector('.lw, .dq-sw, [role=alertdialog]'));
      const after = words((await stored(h, page)).lists.comfort);
      if (!left || JSON.stringify(after) !== '["Warm tea","Blanket","Rain sounds"]') problems.push(`${tag} Safe Zone: Leave mid-edit left ${left}, stored ${JSON.stringify(after)}`);
      problems.push(...errors.map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'reorder-your-lists'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport);
      const xp = await page.evaluate(() => window.__daily.store.derived().xp);
      await safeAt(page, 'reasons');
      await tabTo(page, 'Edit the list');
      await page.keyboard.press('Enter');
      // up twice to the top, with keys alone: focus stays on the button, in view, and its place is said
      await tabTo(page, 'Move Kestrel feathers up');
      await page.keyboard.press('Enter');
      if (!(await live(page, 'Kestrel feathers, now 2 of 3'))) problems.push(`${tag}: the first move was said as ${JSON.stringify(await said(page))}`);
      await page.keyboard.press('Enter');
      if (!(await live(page, 'Kestrel feathers, now 1 of 3'))) problems.push(`${tag}: the second move was said as ${JSON.stringify(await said(page))}`);
      problems.push(...(await focusOn(page, 'Move Kestrel feathers up', `${tag} Safe Zone: moved to the top`)));
      const top = await page.evaluate(() => document.activeElement.getAttribute('aria-disabled'));
      await page.keyboard.press('Enter');
      if (top !== 'true') problems.push(`${tag}: Move up at the top is not dimmed (aria-disabled ${top})`);
      await tabTo(page, 'Move Quillfeather walks down');
      await page.keyboard.press('Enter');
      problems.push(...(await focusOn(page, 'Move Quillfeather walks down', `${tag} Safe Zone: moved down`)));
      const order = ['Kestrel feathers', 'Lanternfish facts', 'Quillfeather walks'];
      if (JSON.stringify(await shown(page)) !== JSON.stringify(order)) problems.push(`${tag} Safe Zone: reasons show ${JSON.stringify(await shown(page))}`);
      await h.shot(page, `reorder-safe-zone-${tag}`);
      // people, on Comfort, by key
      await go(page, { name: 'comfort' });
      await button(page, 'Move Robin up').focus();
      await page.keyboard.press('Enter');
      problems.push(...(await focusOn(page, 'Move Robin up', `${tag} Comfort: moved Robin up`)));
      if (!(await live(page, 'Robin, now 1 of 2'))) problems.push(`${tag} Comfort: the move was said as ${JSON.stringify(await said(page))}`);
      if (JSON.stringify(await shown(page, PANEL.reasons)) !== JSON.stringify(order)) problems.push(`${tag} Comfort: reasons show ${JSON.stringify(await shown(page, PANEL.reasons))}`);
      await h.shot(page, `reorder-comfort-${tag}`);
      // what is stored, in order of place, and Copy your lists
      const s = await stored(h, page);
      const placed = (l) => l.every((x, i) => typeof x.place === 'number' && (!i || x.place > l[i - 1].place));
      if (JSON.stringify(words(s.lists.reasons)) !== JSON.stringify(order) || !placed(s.lists.reasons)) problems.push(`${tag}: stored reasons ${JSON.stringify(s.lists.reasons)}`);
      if (JSON.stringify(words(s.lists.people)) !== '["Robin","Sam +1 555 0100"]' || !placed(s.lists.people)) problems.push(`${tag}: stored people ${JSON.stringify(s.lists.people)}`);
      await page.getByRole('button', { name: 'Copy your lists' }).click();
      const text = await page.locator('.dq-lists-copy pre').textContent();
      if (!text.includes(['Things that are yours', ...order.map((o) => `- ${o}`)].join('\n')) || !text.includes('People\n- Robin\n- Sam: +1 555 0100')) problems.push(`${tag}: Copy your lists reads ${JSON.stringify(text)}`);
      problems.push(...(await noise(page, xp)).map((n) => `${tag}: ${n}`));
      // after a reload, in the Safe Zone
      await page.reload();
      await h.reachHub(page);
      await safeAt(page, 'reasons');
      if (JSON.stringify(await shown(page)) !== JSON.stringify(order)) problems.push(`${tag} reloaded: reasons show ${JSON.stringify(await shown(page))}`);
      await safeAt(page, 'people');
      if (JSON.stringify(await shown(page)) !== '["Robin","Sam"]') problems.push(`${tag} reloaded: people show ${JSON.stringify(await shown(page))}`);
      problems.push(...errors.map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'edit-your-lists-saves'(h) {
    const problems = [];
    // two copies each added one at the same place: an edit never changes which comes first, now or after a reload
    const tied = await open(h, { width: 390, height: 844 }, { lists: { ...LISTS, comfort: [{ id: 'c2', text: 'Blanket', at: T + 1, place: 0 }, { id: 'c1', text: 'Tea', at: T, place: 0 }] } });
    await go(tied.page, { name: 'comfort' });
    await typeIn(tied.page, 'Tea', 'Warm tea');
    await save(tied.page);
    const edited = await shown(tied.page, PANEL.comfort);
    await tied.page.reload();
    await h.reachHub(tied.page);
    await go(tied.page, { name: 'comfort' });
    const reloaded = await shown(tied.page, PANEL.comfort);
    if (JSON.stringify(edited) !== '["Warm tea","Blanket"]' || JSON.stringify(reloaded) !== JSON.stringify(edited)) problems.push(`same place: after an edit ${JSON.stringify(edited)}, after a reload ${JSON.stringify(reloaded)}`);
    problems.push(...tied.errors);
    await tied.ctx.close();
    // places from this build on three of them and none on the fourth, as an older build adds one; reasons have none at all
    const mixed = { ...LISTS, comfort: [{ id: 'c1', text: 'Tea', at: T, place: 0 }, { id: 'c2', text: 'Blanket', at: T, place: 2, placeAt: T }, { id: 'c3', text: 'Rain', at: T, place: 1, placeAt: T }, { id: 'c4', text: 'Soup', at: T }] };
    const { ctx, page, errors } = await open(h, { width: 390, height: 844 }, { lists: mixed });
    await go(page, { name: 'comfort' });
    if (JSON.stringify(await shown(page, PANEL.comfort)) !== '["Tea","Rain","Blanket","Soup"]') problems.push(`old save: the comfort kit shows ${JSON.stringify(await shown(page, PANEL.comfort))}`);
    if (JSON.stringify(await shown(page, PANEL.reasons)) !== '["Quillfeather walks","Lanternfish facts","Kestrel feathers"]') problems.push(`old save: reasons show ${JSON.stringify(await shown(page, PANEL.reasons))}`);
    await typeIn(page, 'Tea', 'Warm tea');
    await save(page);
    await button(page, 'Move Soup up').click();
    await button(page, 'Move Lanternfish facts up').click();
    const order = { comfort: ['Warm tea', 'Rain', 'Soup', 'Blanket'], reasons: ['Lanternfish facts', 'Quillfeather walks', 'Kestrel feathers'] };
    // the Save Crystal holds the words and the order
    const { file, raw } = await crystalOf(h, page, 'edit-your-lists-crystal');
    for (const k of ['comfort', 'reasons']) if (JSON.stringify(words(raw.lists[k])) !== JSON.stringify(order[k])) problems.push(`Crystal: ${k} is ${JSON.stringify(words(raw.lists[k]))}`);
    problems.push(...errors);
    await ctx.close();
    const restore = async (save, want, what) => {
      const d = await open(h, { width: 390, height: 844 }, save);
      await restoreFrom(d.page, file);
      await go(d.page, { name: 'comfort' });
      if (JSON.stringify(await shown(d.page, PANEL.comfort)) !== JSON.stringify(want)) problems.push(`${what}: the comfort kit shows ${JSON.stringify(await shown(d.page, PANEL.comfort))}`);
      if (JSON.stringify(await shown(d.page, PANEL.reasons)) !== JSON.stringify(order.reasons)) problems.push(`${what}: reasons show ${JSON.stringify(await shown(d.page, PANEL.reasons))}`);
      await safeAt(d.page, 'comfort');
      if (JSON.stringify(await shown(d.page)) !== JSON.stringify(want)) problems.push(`${what}: the Safe Zone's comfort kit shows ${JSON.stringify(await shown(d.page))}`);
      problems.push(...d.errors.map((e) => `${what}: ${e}`));
      return { s: await stored(h, d.page), close: () => d.ctx.close() };
    };
    // a new device: every entry as it was in the Crystal, its place included
    const fresh = await restore({}, order.comfort, 'new device');
    const same = (l) => JSON.stringify(l.map(({ id, text, name, phone, place, placeAt }) => ({ id, text, name, phone, place, placeAt })));
    for (const k of ['comfort', 'reasons', 'people']) if (same(fresh.s.lists[k]) !== same(raw.lists[k])) problems.push(`new device: ${k} became ${same(fresh.s.lists[k])}, the Crystal has ${same(raw.lists[k])}`);
    await fresh.close();
    // a device with its own comfort kit: what the Crystal adds comes after it, in the Crystal's order
    const own = await restore({ lists: { comfort: [{ id: 'own', text: 'Own mug', at: T, place: 0 }] } }, ['Own mug', ...order.comfort], 'own device');
    await own.close();
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'edit-your-lists-newer-save'(h) {
    const problems = [];
    const long = 'A long note about warm tea '.repeat(12).slice(0, 300);
    const name = 'Samantha Rose '.repeat(8).slice(0, 100);
    const newer = { v: 2, lists: { comfort: [{ id: 'c1', text: 'Tea', at: T, place: 0 }, { id: 'c2', text: long, at: T, place: 1, mood: 'kept' }, { id: 'c3', text: 'Rain', at: T, place: 2 }], activities: [], reasons: [], people: [{ id: 'p1', name, phone: '+1 555 0100', at: T, place: 0, ring: 'soft' }] } };
    /** A problem unless the comfort and the person a newer build stored are still whole, words past this build's limits and fields it doesn't know included. */
    const intact = (s, what) => {
      const c2 = s.lists.comfort.find((x) => x.id === 'c2');
      const p1 = s.lists.people.find((x) => x.id === 'p1');
      if (c2?.text !== long || c2.mood !== 'kept') problems.push(`${what}: the long comfort became ${JSON.stringify(c2)?.slice(0, 120)}`);
      if (p1?.name !== name || p1.ring !== 'soft') problems.push(`${what}: the person became ${JSON.stringify(p1)?.slice(0, 160)}`);
    };
    const order = (page) => page.evaluate(() => [...document.querySelectorAll('.dq-listp--comfort .dq-items > li')].map((li) => li.dataset.item).join());
    const { ctx, page, errors } = await open(h, { width: 390, height: 844 }, newer);
    await go(page, { name: 'comfort' });
    // a move renumbers the long one too
    await button(page, 'Move Rain up').click();
    if ((await order(page)) !== 'c1,c3,c2') problems.push(`the move left ${await order(page)}`);
    intact(await stored(h, page), 'after a move');
    // only the number changes
    await page.locator('.dq-item--person [data-act="edit"]').click();
    await editing(page).locator('input').nth(1).fill('+1 555 0199');
    await save(page);
    const s = await stored(h, page);
    if (s.lists.people[0]?.phone !== '+1 555 0199') problems.push(`the new number was stored as ${s.lists.people[0]?.phone}`);
    intact(s, 'after the number changed');
    // removed, then Undo
    await page.locator('li[data-item="c2"] [data-act="remove"]').click();
    await page.getByRole('button', { name: 'Undo' }).click();
    if (!(await until(page, (k) => JSON.parse(localStorage.getItem(k)).lists.comfort.some((x) => x.id === 'c2'), h.SAVE, { timeout: 5000 }).then(() => true, () => false))) problems.push('Undo did not bring the long comfort back');
    intact(await stored(h, page), 'after Undo');
    if ((await order(page)) !== 'c1,c3,c2') problems.push(`Undo put it back at ${await order(page)}`);
    const { file, raw } = await crystalOf(h, page, 'edit-your-lists-newer-crystal');
    intact(raw, 'the Crystal');
    problems.push(...errors);
    await ctx.close();
    // restored after a device's own entry, its place moved along
    const d = await open(h, { width: 390, height: 844 }, { lists: { comfort: [{ id: 'own', text: 'Own mug', at: T, place: 0 }] } });
    await restoreFrom(d.page, file);
    await go(d.page, { name: 'comfort' });
    if ((await order(d.page)) !== 'own,c1,c3,c2') problems.push(`restored next to the device's own: ${await order(d.page)}`);
    intact(await stored(h, d.page), 'restored next to the device\'s own');
    problems.push(...d.errors);
    await d.ctx.close();
    // a newer build's save with no places yet: after a move every entry keeps its place, after a reload and in a Crystal
    const bare = await open(h, { width: 390, height: 844 }, { v: 2, lists: { comfort: [{ id: 'c1', text: 'Tea', at: T, mood: 'kept' }, { id: 'c2', text: 'Blanket', at: T }, { id: 'c3', text: 'Rain', at: T }], activities: [], reasons: [], people: [] } });
    await go(bare.page, { name: 'comfort' });
    await button(bare.page, 'Move Rain up').click();
    const moved = await order(bare.page);
    await bare.page.reload();
    await h.reachHub(bare.page);
    await go(bare.page, { name: 'comfort' });
    const back = await order(bare.page);
    const kit = (await crystalOf(h, bare.page, 'edit-your-lists-newer-bare')).raw.lists.comfort;
    if (moved !== 'c1,c3,c2' || back !== moved || kit.map((x) => x.id).join() !== moved || kit[0].mood !== 'kept') problems.push(`newer save with no places: moved ${moved}, reloaded ${back}, Crystal ${JSON.stringify(kit)}`);
    problems.push(...bare.errors);
    await bare.ctx.close();
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'edit-your-lists-tabs'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page: a, errors } = await open(h, viewport);
      const before = await h.ls(a, h.SAVE);
      await go(a, { name: 'comfort' });
      const b = await ctx.newPage();
      const bErrors = [];
      b.on('pageerror', (e) => bErrors.push(`pageerror: ${e.message}`));
      await b.goto(`${h.server.url}/?mute`);
      await b.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
      await safeAt(b, 'comfort');
      await button(b, 'Edit the list').click();
      // an edit half typed here, the caret mid-word
      await typeIn(a, 'Blanket', 'Blanket, the heavy one');
      const field = editing(a).locator('input');
      await field.evaluate((i) => i.setSelectionRange(5, 5));
      // a move in the other tab lands while it is open
      await button(b, 'Move Rain up').focus();
      await b.keyboard.press('Enter');
      if (!(await until(a, () => [...document.querySelectorAll('.dq-listp--comfort .dq-items > li')].map((li) => li.dataset.item).join() === 'c1,c3,c2', undefined, { timeout: 5000 }).then(() => true, () => false))) problems.push(`${tag}: the move did not reach the open Comfort page: ${JSON.stringify(await a.evaluate(() => [...document.querySelectorAll('.dq-listp--comfort .dq-items > li')].map((li) => li.dataset.item)))}`);
      const kept = await field.evaluate((i) => `${i.value}|${i.selectionStart},${i.selectionEnd}|${i === document.activeElement}`);
      if (kept !== 'Blanket, the heavy one|5,5|true') problems.push(`${tag}: the open edit became ${kept} as the move landed`);
      await save(a);
      if (!(await until(b, () => [...document.querySelectorAll('.dq-sz-list .dq-entry-t')].map((e) => e.textContent).join('|') === 'Tea|Rain|Blanket, the heavy one', undefined, { timeout: 5000 }).then(() => true, () => false))) problems.push(`${tag}: the Safe Zone shows ${JSON.stringify(await shown(b))} after the edit`);
      problems.push(...(await focusOn(b, 'Move Rain up', `${tag} Safe Zone: as the edit landed`)));
      // a copy that never saw the move or the edit writes its own change to Rain: all three stay
      const old = JSON.parse(before);
      old.lists.comfort.find((x) => x.id === 'c3').text = 'Rain on the roof';
      old.lists.comfort.find((x) => x.id === 'c3').at = Date.now();
      await a.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, JSON.stringify(old)]);
      const want = 'Tea|Rain on the roof|Blanket, the heavy one';
      if (!(await until(b, (want) => [...document.querySelectorAll('.dq-sz-list .dq-entry-t')].map((e) => e.textContent).join('|') === want, want, { timeout: 5000 }).then(() => true, () => false))) problems.push(`${tag}: after an older copy's write the Safe Zone shows ${JSON.stringify(await shown(b))}`);
      if (!(await until(a, (want) => [...document.querySelectorAll('.dq-listp--comfort .dq-entry-t')].map((e) => e.textContent).join('|') === want, want, { timeout: 5000 }).then(() => true, () => false))) problems.push(`${tag}: after an older copy's write Comfort shows ${JSON.stringify(await shown(a, PANEL.comfort))}`);
      const s = await stored(h, b);
      if (words(s.lists.comfort).join('|') !== want) problems.push(`${tag}: stored ${JSON.stringify(s.lists.comfort)}`);
      // Tea moves down here, and a copy that saw everything but that move changes Tea: the move still holds where it is
      // stored, so a reload shows it too
      const unmoved = await h.ls(b, h.SAVE);
      await button(b, 'Move Tea down').click();
      const stale = JSON.parse(unmoved);
      Object.assign(stale.lists.comfort.find((x) => x.id === 'c1'), { text: 'Tea for two', at: Date.now() });
      await a.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, JSON.stringify(stale)]);
      const last = 'Rain on the roof|Tea for two|Blanket, the heavy one';
      const reads = (page, sel) => until(page, ([sel, want]) => [...document.querySelectorAll(sel)].map((e) => e.textContent).join('|') === want, [sel, last], { timeout: 5000 }).then(() => true, () => false);
      if (!(await reads(b, '.dq-sz-list .dq-entry-t'))) problems.push(`${tag}: after a copy that missed the move, the Safe Zone shows ${JSON.stringify(await shown(b))}`);
      if (!(await until(b, ([k, want]) => JSON.parse(localStorage.getItem(k)).lists.comfort.map((x) => x.text).join('|') === want, [h.SAVE, last], { timeout: 5000 }).then(() => true, () => false))) problems.push(`${tag}: after a copy that missed the move, stored ${JSON.stringify(words((await stored(h, b)).lists.comfort))}`);
      await b.reload();
      await b.waitForFunction(() => !!window.__daily, null, { timeout: 30000 });
      await safeAt(b, 'comfort');
      if (!(await reads(b, '.dq-sz-list .dq-entry-t'))) problems.push(`${tag}: reloaded after a copy that missed the move, the Safe Zone shows ${JSON.stringify(await shown(b))}`);
      await h.shot(a, `tabs-comfort-${tag}`);
      await h.shot(b, `tabs-safe-zone-${tag}`);
      problems.push(...[...errors, ...bErrors].map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'edit-your-lists-fit'(h) {
    const problems = [];
    for (const [w, ht, zoom] of [[390, 844, 1], [320, 568, 1], [844, 390, 1], [568, 320, 1], [320, 568, 2], [568, 320, 2]]) {
      const tag = `${w}x${ht}${zoom > 1 ? ' at 200%' : ''}`;
      const view = { width: w / zoom, height: ht / zoom };
      const { ctx, page, errors } = await open(h, view);
      if (zoom > 1) await (await ctx.newCDPSession(page)).send('Emulation.setDeviceMetricsOverride', { ...view, deviceScaleFactor: 4, mobile: false });
      const fits = (what) =>
        page.evaluate((what) => {
          const out = [];
          if (document.documentElement.scrollWidth > innerWidth + 0.5) out.push(`${what}: the page is ${document.documentElement.scrollWidth}px wide in ${innerWidth}px`);
          for (const e of document.querySelectorAll('li[data-item], li[data-item] button, li[data-item] a, li[data-item] input')) {
            if (!e.checkVisibility()) continue;
            const r = e.getBoundingClientRect();
            if (r.right > innerWidth + 0.5 || r.left < -0.5) out.push(`${what}: ${e.getAttribute('aria-label') ?? e.textContent.trim().slice(0, 30)} runs off the side`);
            if (e.matches('[data-act]') && (r.width < 44 || r.height < 44)) out.push(`${what}: ${e.getAttribute('aria-label')} is ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
          return out;
        }, what);
      for (const at of ['reasons', 'people']) {
        await safeAt(page, at);
        await button(page, 'Edit the list').click();
        problems.push(...(await fits(`${tag} Safe Zone ${at}`)));
        await h.shot(page, `fit-${w}x${ht}${zoom > 1 ? '-200' : ''}-${at}`);
        await button(page, at === 'people' ? 'Edit Sam' : 'Edit Lanternfish facts').click();
        problems.push(...(await fits(`${tag} Safe Zone ${at} editing`)));
        const f = await focusIs(page);
        const talk = await page.evaluate(() => [...document.querySelectorAll('.dq-sz-talk')].some((t) => {
          const r = t.getBoundingClientRect();
          return t.checkVisibility() && r.top >= -0.5 && r.bottom <= innerHeight + 0.5;
        }));
        if (!f.field || !f.seen || !talk) problems.push(`${tag} Safe Zone ${at} editing: the field seen whole ${f.seen}, Talk pinned ${talk}`);
        await h.shot(page, `fit-${w}x${ht}${zoom > 1 ? '-200' : ''}-${at}-editing`);
        await page.keyboard.press('Escape');
      }
      await go(page, { name: 'comfort' });
      problems.push(...(await fits(`${tag} Comfort`)));
      await button(page, 'Edit Sam').click();
      problems.push(...(await fits(`${tag} Comfort editing`)));
      const f = await focusIs(page);
      if (!f.field || !f.seen) problems.push(`${tag} Comfort editing: the field is not seen whole`);
      await h.shot(page, `fit-${w}x${ht}${zoom > 1 ? '-200' : ''}-comfort-editing`);
      problems.push(...errors.map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
