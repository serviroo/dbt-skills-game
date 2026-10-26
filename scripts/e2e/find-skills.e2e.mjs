// Find a skill in the Skills list: a labelled search over both names and three filters (need, topic, time).
// find-combine: every need with every topic and every time gives exactly the skills that fit all three, in list order,
// each once; searches match either name in any case and spacing; the time budgets use each label's upper end (90 s,
// 1-3 min, 2.5 min) and songs, taps and a match only show under No set time; Show all skills brings every skill back
// once, and every need names real skills, the six newest included.
// find-keys: the search and filters work from the keyboard alone, nothing matching shows the empty state with Clear
// filters, and the Safe Zone stays one tap away.
// find-return: browsing credits nothing and stores nothing (no save change, no history entry, not even offline, where
// it makes no request at all); opening a skill from a filtered list credits it once, and the choices are still there
// after leaving it.
// find-sizes: at 390x844, 320x568, 844x390 and 1280x800 the filters, a long name, results and the empty state fit
// without sideways scrolling, clipping or text under 16 px.
import { credits, returning, toHub } from './skill-check.e2e.mjs';
import { everything, offsite, SIZES } from './choose-ask-refusal-strength.e2e.mjs';

const PHONE = { width: 390, height: 844 };
/** The longest each time label means, in seconds, as this check reads it. Any other label has no set time. */
const SECONDS = { '30 s': 30, '60 s': 60, '1 min': 60, '90 s': 90, '1-2 min': 120, '2 min': 120, '2.5 min': 150, '1-3 min': 180, '3 min': 180 };
const TIMES = [
  ['Any time', null],
  ['Up to 1 minute', 60],
  ['Up to 2 minutes', 120],
  ['Up to 3 minutes', 180],
  ['No set time', 'open'],
];
const NEWEST = ['loving-kindness', 'asking-intensity', 'interpersonal-myths', 'cope-ahead', 'willingness', 'reinforcement'];

const fold = (t) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[-‐‑–]/g, ' ').replace(/\s+/g, ' ').trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The skills and needs as the app ships them, read from its own content modules. */
export const catalogue = (page) =>
  page.evaluate(async () => {
    const dbt = await import('/src/content/dbt.ts');
    const lib = await import('/src/content/skill-library.ts');
    return {
      skills: dbt.SKILLS.map(({ id, sl, real, module, minutes, loadout }) => ({ id, sl, real, module, minutes, loadout: !!loadout })),
      topics: dbt.MODULE_ORDER.map((id) => ({ id, label: dbt.MODULES[id].name })),
      needs: lib.NEEDS.map(({ id, label, skills }) => ({ id, label, skills: [...skills] })),
    };
  });

/** Every skill in the order the list shows them: the loadout first, then each topic. */
export const listOrder = (cat) => [...cat.skills.filter((s) => s.loadout), ...cat.topics.flatMap((t) => cat.skills.filter((s) => s.module === t.id && !s.loadout))].map((s) => s.id);

/** What the list should show for these choices, worked out here from the content alone. */
function wanted(cat, { q = '', need = null, topic = null, time = null }) {
  const by = Object.fromEntries(cat.skills.map((s) => [s.id, s]));
  const words = fold(q).split(' ').filter(Boolean);
  return listOrder(cat).filter((id) => {
    const s = by[id];
    if (need && !cat.needs.find((n) => n.label === need).skills.includes(id)) return false;
    if (topic && cat.topics.find((t) => t.label === topic).id !== s.module) return false;
    const secs = Object.hasOwn(SECONDS, s.minutes) ? SECONDS[s.minutes] : null;
    if (time === 'open' && secs !== null) return false;
    if (typeof time === 'number' && (secs === null || secs > time)) return false;
    const hay = fold(`${s.sl} ${s.real}`);
    return words.every((w) => hay.includes(w));
  });
}

export async function openLibrary(h, page) {
  await toHub(h, page);
  await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
  await page.locator('.dq-library').waitFor({ timeout: 10000 });
}

/** The list as shown: each row's skill, each section with its rows, the count line and whether the empty state shows. */
export const view = (page) =>
  page.evaluate(() => {
    const ids = (root) => [...root.querySelectorAll('.dq-libitem')].map((li) => li.dataset.skill);
    const on = (e) => !!e && !e.closest('.is-hidden') && e.getClientRects().length > 0;
    return {
      ids: ids(document.querySelector('.dq-library')),
      groups: [...document.querySelectorAll('.dq-library .dq-libsec')].map((s) => ({ title: s.querySelector('.dq-libsec-h > span:nth-child(2)')?.textContent ?? '', fav: s.classList.contains('dq-libsec--fav'), ids: ids(s) })),
      count: document.querySelector('.dq-libcount')?.textContent ?? null,
      empty: on(document.querySelector('.dq-libempty')),
      showAll: on([...document.querySelectorAll('.dq-library button')].find((b) => b.textContent === 'Show all skills')),
    };
  });

export const control = {
  search: (page) => page.getByRole('searchbox', { name: 'Search' }),
  need: (page) => page.getByRole('combobox', { name: 'Need' }),
  topic: (page) => page.getByRole('combobox', { name: 'Topic' }),
  time: (page) => page.getByRole('combobox', { name: 'Time' }),
};

/** Sets the search and filters the way a player does (unset ones go back to their first option) and returns the list. */
export async function choose(page, { q = '', need = null, topic = null, time = null }) {
  await control.search(page).fill(q);
  await control.need(page).selectOption({ label: need ?? 'Anything' });
  await control.topic(page).selectOption({ label: topic ?? 'All topics' });
  await control.time(page).selectOption({ label: TIMES.find(([, t]) => t === time)?.[0] ?? 'Any time' });
  return view(page);
}

/** The list shows exactly these skills in this order, each once, under the right count. */
export function shows(h, got, want, total, where) {
  h.expect(same(got.ids, want), `${where}: shows ${JSON.stringify(got.ids)}, not ${JSON.stringify(want)}`);
  h.expect(new Set(got.ids).size === got.ids.length, `${where}: a skill shows twice`);
  h.expect(got.empty === !want.length, `${where}: the empty state ${got.empty ? 'shows with' : 'is missing with'} ${want.length} results`);
  h.expect(got.groups.every((g) => g.ids.length), `${where}: an empty section heading shows`);
  const filtered = got.showAll;
  h.expect(got.count === (filtered ? `${want.length} of ${total} skills` : `All ${total} skills`), `${where}: the count says "${got.count}" for ${want.length} of ${total}`);
}

/** Anything in the list or the top bar sticking out sideways, a clipped control, text under 16 px or a lost Safe Zone button. */
export const fitLibrary = (page, where) =>
  page.evaluate((where) => {
    const bad = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) bad.push(`${where}: the page scrolls sideways (${document.documentElement.scrollWidth} px in ${vw} px)`);
    for (const e of document.querySelectorAll('.dq-top *, .dq-library *')) {
      if (!e.getClientRects().length || e.closest('[aria-hidden="true"], svg, .dq-sr, .is-hidden')) continue;
      const r = e.getBoundingClientRect();
      const name = (e.textContent || e.getAttribute('aria-label') || e.className || e.tagName).toString().trim().slice(0, 50);
      if (r.width && (r.left < -1 || r.right > vw + 1)) bad.push(`${where}: "${name}" sticks out sideways (${Math.round(r.left)} to ${Math.round(r.right)} px)`);
      if (e.matches('button, .dq-library input, .dq-library select') && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) bad.push(`${where}: "${name}" is clipped`);
      if (e.matches('.dq-libpin') && (r.width < 44 || r.height < 44)) bad.push(`${where}: the pin for ${e.closest('.dq-libitem')?.dataset.skill} is ${Math.round(r.width)}x${Math.round(r.height)} px, under 44 px`);
    }
    for (const t of document.querySelectorAll('.dq-libfind label, .dq-libfind input, .dq-libfind select, .dq-libcount, .dq-libbar button, .dq-libempty p, .dq-libempty button, .dq-librow-n'))
      if (t.getClientRects().length && !t.closest('.is-hidden') && parseFloat(getComputedStyle(t).fontSize) < 16) bad.push(`${where}: "${t.textContent.trim().slice(0, 40)}" is smaller than 16 px`);
    const safe = document.querySelector('.dq-top .dq-safe')?.getBoundingClientRect();
    if (!safe || safe.top < 0 || safe.bottom > innerHeight || safe.right > vw) bad.push(`${where}: the Safe Zone button is off screen`);
    return bad;
  }, where);

const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))));
const saveOf = async (h, page) => JSON.parse((await h.ls(page, h.SAVE)) ?? 'null');

export const scenarios = {
  async 'find-combine'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const away = offsite(page);
    try {
      await h.reachHub(page);
      await openLibrary(h, page);
      for (const [what, c] of Object.entries(control)) h.expect(await c(page).isVisible().catch(() => false), `the Skills list has no ${what} control a player can reach by its label`);
      const cat = await catalogue(page);
      const all = listOrder(cat);
      const total = cat.skills.length;
      const first = await view(page);
      shows(h, first, all, total, 'on opening');
      h.expect(same(first.groups.map((g) => g.title), ['Your loadout', ...cat.topics.map((t) => t.label)]), `the sections are ${JSON.stringify(first.groups.map((g) => g.title))}`);

      // every need names real skills; the six newest each sit under at least one
      const ids = new Set(cat.skills.map((s) => s.id));
      for (const n of cat.needs) h.expect(n.skills.length && n.skills.every((id) => ids.has(id)) && new Set(n.skills).size === n.skills.length, `the need "${n.label}" names ${JSON.stringify(n.skills.filter((id) => !ids.has(id)))} (not skills) or a skill twice`);
      for (const id of [...NEWEST, ...ids]) h.expect(cat.needs.some((n) => n.skills.includes(id)), `${id} is under no need`);

      // each need with each topic and each time, and the need alone with a search
      let combos = 0;
      for (const need of [null, ...cat.needs.map((n) => n.label)])
        for (const topic of [null, ...cat.topics.map((t) => t.label)])
          for (const [, time] of TIMES) {
            shows(h, await choose(page, { need, topic, time }), wanted(cat, { need, topic, time }), total, `need ${need ?? 'Anything'}, topic ${topic ?? 'All topics'}, time ${time ?? 'any'}`);
            combos++;
          }
      h.expect(combos === (cat.needs.length + 1) * (cat.topics.length + 1) * TIMES.length, `only ${combos} combinations ran`);

      // the same answers written out by hand, so a change to the content shows up here too
      const fixed = [
        [{ need: 'A difficult conversation', topic: 'Interpersonal', time: 120 }, ['give', 'fast', 'validation', 'clarifying-priorities', 'asking-intensity', 'interpersonal-myths', 'reinforcement', 'dialectics', 'mindfulness-of-others']],
        [{ need: 'A pause', topic: 'Distress Tolerance', time: 60 }, ['cool-air', 'stop', 'leave-lobby']],
        [{ need: 'Something coming up', topic: 'Emotion Regulation' }, ['absurd-scroll', 'check-facts', 'cope-ahead', 'problem-solving', 'long-term-positives']],
        [{ need: 'Kindness for myself', time: 'open' }, ['volume-down', 'supplies', 'warm-hands']],
        [{ need: 'Accepting what is', topic: 'Distress Tolerance', time: 180 }, ['improve', 'radical-acceptance', 'willing-hands', 'willingness', 'turning-the-mind']],
        [{ time: 'open' }, ['volume-down', 'supplies', 'warm-hands', 'queue-up']],
        [{ q: '  STILL   center ' }, ['wise-mind']],
        [{ q: 'wise MIND' }, ['wise-mind', 'accepts']],
        [{ q: 'tipp' }, ['cool-air', 'tipp']],
        [{ q: 'Warden’s calm' }, ['radical-acceptance']],
        [{ q: "warden's CALM" }, ['radical-acceptance']],
        [{ q: 'self-SOOTHE' }, ['volume-down', 'warm-hands', 'flavour-tier', 'self-soothe']],
        [{ q: 'loving kindness' }, ['loving-kindness']],
        [{ q: 'check the facts' }, ['absurd-scroll', 'check-facts']],
        [{ q: 'self', need: 'Kindness for myself', topic: 'Distress Tolerance', time: 120 }, ['self-soothe']],
        [{ q: 'open', need: 'Accepting what is' }, ['willing-hands', 'willingness']],
        [{ q: 'kind light', topic: 'Mindfulness', time: 120 }, ['loving-kindness']],
      ];
      for (const [f, want] of fixed) shows(h, await choose(page, f), want, total, JSON.stringify(f));

      // the time budgets at their edges: a range counts as its upper end, 90 s is over a minute
      const under = async (time) => (await choose(page, { time })).ids;
      const [one, two, three, open] = [await under(60), await under(120), await under(180), await under('open')];
      const at = (id, list) => list.includes(id);
      for (const [id, inOne, inTwo, inThree] of [
        ['stop', true, true, true],
        ['leave-lobby', true, true, true],
        ['wise-mind', false, true, true],
        ['name-emotion', false, true, true],
        ['improve', false, true, true],
        ['tipp', false, false, true],
        ['radical-acceptance', false, false, true],
        ['urge-surf', false, false, true],
        ['pros-cons', false, false, true],
      ])
        h.expect(at(id, one) === inOne && at(id, two) === inTwo && at(id, three) === inThree && !at(id, open), `${id}: up to 1/2/3 minutes and no set time give ${[one, two, three, open].map((l) => at(id, l))}`);
      for (const id of ['volume-down', 'supplies', 'warm-hands', 'queue-up']) h.expect(at(id, open) && !at(id, one) && !at(id, two) && !at(id, three), `${id} (songs, taps or a match) is not under No set time alone`);

      // Show all skills brings every skill back once
      await choose(page, { q: 'mind', need: 'Being present', topic: 'Mindfulness', time: 120 });
      await page.getByRole('button', { name: 'Show all skills' }).click();
      const back = await view(page);
      shows(h, back, all, total, 'after Show all skills');
      h.expect(!back.showAll, 'Show all skills still shows with nothing chosen');
      h.expect((await control.search(page).inputValue()) === '' && (await control.need(page).inputValue()) === '' && (await control.topic(page).inputValue()) === '' && (await control.time(page).inputValue()) === '', 'Show all skills left a choice set');
      h.expect(await control.search(page).evaluate((e) => e === document.activeElement), 'focus did not go to the search after Show all skills');
      h.expect(!away.length, `requests left the page: ${away.join(', ')}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'find-keys'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    try {
      await h.reachHub(page);
      await openLibrary(h, page);
      const cat = await catalogue(page);
      const total = cat.skills.length;
      const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.querySelector(`label[for="${document.activeElement?.id}"]`)?.textContent || document.activeElement?.textContent?.trim() || '');
      await control.search(page).focus();
      await page.keyboard.type('KIND');
      shows(h, await view(page), wanted(cat, { q: 'kind' }), total, 'typed KIND');
      await page.keyboard.press('Tab');
      h.expect((await focused()) === 'Need', `Tab from the search reached "${await focused()}", not Need`);
      await page.keyboard.press('ArrowDown');
      h.expect((await control.need(page).inputValue()) === cat.needs[0].id, 'ArrowDown on Need did not choose the first need');
      shows(h, await view(page), wanted(cat, { q: 'kind', need: cat.needs[0].label }), total, `KIND and ${cat.needs[0].label} by keyboard`);
      await page.keyboard.press('Tab');
      h.expect((await focused()) === 'Topic', `Tab from Need reached "${await focused()}", not Topic`);
      await page.keyboard.press('Tab');
      h.expect((await focused()) === 'Time', `Tab from Topic reached "${await focused()}", not Time`);

      // nothing fits: the empty state, Clear filters, and the Safe Zone still one tap away
      await control.search(page).focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('qqzx');
      const none = await view(page);
      shows(h, none, [], total, 'qqzx');
      h.expect(none.groups.length === 0, `headings show with no results: ${JSON.stringify(none.groups.map((g) => g.title))}`);
      await h.shot(page, 'keys-empty');
      const safe = page.locator('.dq-top .dq-safe');
      h.expect(await safe.isVisible(), 'the Safe Zone button is not visible with no results');
      const clear = page.getByRole('button', { name: 'Clear filters' });
      await clear.focus();
      await page.keyboard.press('Enter');
      const cleared = await view(page);
      shows(h, cleared, listOrder(cat), total, 'after Clear filters');
      h.expect(await control.search(page).evaluate((e) => e === document.activeElement), 'focus did not go to the search after Clear filters');
      await control.search(page).fill('qqzx');
      await safe.click();
      h.expect(await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'safe', null, { timeout: 10000 }).then(() => true, () => false), 'the Safe Zone button did not open the Safe Zone from an empty list');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'find-return'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const away = offsite(page);
    try {
      await h.reachHub(page);
      await openLibrary(h, page);
      const cat = await catalogue(page);
      const total = cat.skills.length;
      const before = await h.ls(page, h.SAVE);
      const xp = () => page.evaluate(() => window.__daily.store.derived().xp);
      const xp0 = await xp();
      const hist = await page.evaluate(() => [history.length, location.href]);
      const asked = away.all.length;
      // offline, every choice: nothing written, no request, no history entry, nothing credited
      await ctx.setOffline(true);
      for (const n of cat.needs) await choose(page, { q: 'qzxv', need: n.label, topic: cat.topics[1].label, time: 'open' });
      const f = { q: '  cope   ', need: 'Something coming up', time: 120 };
      shows(h, await choose(page, f), wanted(cat, f), total, 'offline choices');
      h.expect(away.all.length === asked, `browsing made requests: ${away.all.slice(asked).join(', ')}`);
      await ctx.setOffline(false);
      h.expect((await h.ls(page, h.SAVE)) === before, 'browsing changed the save');
      h.expect(!(await everything(page)).includes('qzxv'), 'the search text was stored on the device');
      h.expect(same(await page.evaluate(() => [history.length, location.href]), hist), 'browsing added a history entry or changed the address');
      h.expect((await xp()) === xp0, `browsing changed XP from ${xp0} to ${await xp()}`);

      // open one from the filtered list: credited once; leave it and come back to the same choices
      const id = wanted(cat, f)[0];
      const had = await credits(h, page, id);
      await page.locator(`.dq-libitem[data-skill="${id}"] .dq-librow`).click();
      await page.locator('.dq-skill .dq-step-body > *').first().waitFor({ timeout: 10000 });
      h.expect((await credits(h, page, id)) === had + 1, `opening ${id} from a filtered list did not credit it once`);
      await toHub(h, page);
      await openLibrary(h, page);
      h.expect((await control.search(page).inputValue()) === f.q && (await control.need(page).inputValue()) === 'ahead' && (await control.time(page).inputValue()) === 'up2' && (await control.topic(page).inputValue()) === '', 'the choices were not kept after leaving a skill');
      shows(h, await view(page), wanted(cat, f), total, 'back from a skill');
      h.expect((await credits(h, page, id)) === had + 1, `coming back credited ${id} again`);
      const events = (await saveOf(h, page)).events.filter((e) => !JSON.parse(before).events.some((b) => b.id === e.id));
      h.expect(events.filter((e) => e.k === 'skill').length === 1, `browsing and one opening added ${events.filter((e) => e.k === 'skill').length} skill credits`);
      // a new visit starts with every skill
      await page.reload();
      await h.reachHub(page);
      await openLibrary(h, page);
      shows(h, await view(page), listOrder(cat), total, 'after a reload');
      h.expect(!away.length, `requests left the page: ${away.join(', ')}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'find-sizes'(h) {
    const problems = [];
    for (const size of SIZES) {
      const tag = `${size.width}x${size.height}`;
      const { ctx, page, errors } = await h.open(returning(h), '?mute', size);
      try {
        await h.reachHub(page);
        await openLibrary(h, page);
        await settle(page);
        problems.push(...(await fitLibrary(page, `${tag} filters`)));
        await h.shot(page, `sizes-${tag}-1-filters`);
        await choose(page, { topic: 'Interpersonal' });
        await page.locator('.dq-libitem[data-skill="interpersonal-myths"]').scrollIntoViewIfNeeded();
        problems.push(...(await fitLibrary(page, `${tag} long names`)));
        await h.shot(page, `sizes-${tag}-2-long-names`);
        await choose(page, { need: 'Strong feelings', time: 120 });
        await page.evaluate(() => document.querySelector('.dq-libbar')?.scrollIntoView({ block: 'start' }));
        problems.push(...(await fitLibrary(page, `${tag} results`)));
        await h.shot(page, `sizes-${tag}-3-results`);
        await control.search(page).focus();
        await choose(page, { q: 'nothing like this', need: 'A pause' });
        await page.keyboard.press('Tab');
        await page.evaluate(() => document.querySelector('.dq-library')?.scrollIntoView({ block: 'start' }));
        problems.push(...(await fitLibrary(page, `${tag} empty`)));
        await h.shot(page, `sizes-${tag}-4-empty`);
        h.expect(!errors.length, `${tag}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
