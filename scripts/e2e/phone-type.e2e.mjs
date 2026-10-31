// Type on phones (DESIGN.md, Type). At 390x844 and 320x568, every companion screen (on a returning save with everything
// unlocked, with Home's stats, title list and check-in answered, the diary's export, the removed stories, the story's
// menu and co-writer and a shadow ally's name sheet open, and a first visit's Home, Rest, Night Watch, Story Room, an
// empty story's reading page and Settings), every skill's window as it opens, skills walked from their intro to their
// end with something typed wherever they ask, so that every kind of step shows, every Safe Zone screen and the intro's
// title, name prompt, rewards, letter and end card keep their body text at 16 px or more: every word on screen not set
// or written in capitals, except what stays small on purpose (KEPT). Bodoni Moda sets only a display moment of one to
// three words, and in the Story Room the player's own words ("Jost for the Lantern, Bodoni Moda for theirs",
// story.css): the reading page sets their story in it and the Lantern's words around it in Jost. The rewards also held
// sideways (844x390): each card's words at 16 px inside it, every card and Read the note in reach by scrolling. In the
// skills' windows and the Safe Zone, at both phones' own size and at 200% zoom (there with the Talk list of every
// country at the regular and largest text size too): no word breaks onto the next line without a hyphen, typed ones in
// a field neither (an address in the Talk list breaks where it must, as a hyphen would read as part of it), and nothing
// scrolls sideways (at 200% a walked step's controls aside, which no-sideways-overflow checks). Every walk reaches its
// skill's end, each move showing another step.
import { boot, settle } from './layout-fit.e2e.mjs';
import { cutShort } from './safe-zone-reach.e2e.mjs';
import { until } from './harness.mjs';

const PHONES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];
const SIDEWAYS = { width: 844, height: 390 };
// small on purpose: tags and badges ([STATUS], +10 XP), the faces of skill and ally cards, whose words scale with the
// card (no-sideways-overflow holds them to their sizes), a reward's rarity, and the top bar and the intro's Safe Zone
// and Skip, sized so the Safe Zone stays whole and in reach at 200% zoom (safe-zone-reach, help-or-skip-first-intro)
const KEPT = ['.dq-line-tag', '.dq-xp', '.dq-cardface', '.rw-card .kd', '.dq-top', '.ui-ways'];
// Bodoni Moda past three words: the player's own words in the Story Room
const THEIRS = ['.dq-tile-story.is-title', '.st-row-t', '.st-removed-t', '.st-title', '.st-frame', '.st-chrow-t', '.st-rename', '.st-found-snip', '.st-card-t', '.st-card-edit', '.st-start-t', '.st-bring-cx', '.st-read-ch-h', '.st-read-text'];
// every kind of step a skill's window shows, each one shown by the walks below
const KINDS = ['intro', 'say', 'choice', 'input', 'slider', 'breath', 'timer', 'hold', 'tier', 'count', 'pmr', 'cool', 'cards', 'list', 'checks', 'draft', 'map', 'highlight', 'save'];
// skills walked from their intro to their end, some from one of their parts (the route's entry), as TIPP's movement
// with its caution, its cool air or cold water and its muscle relaxation, and ABC PLEASE's body check, are each a part
// of their own
const WALKS = [['wise-mind'], ['sense-up'], ['tipp', 'more'], ['tipp', 'cold'], ['tipp', 'pmr'], ['accepts'], ['pros-cons'], ['check-facts'], ['abc-please', 'please'], ['dear-man'], ['fast'], ['validation'], ['flavour-tier'], ['stop']];
const SAFE_AT = ['start', 'breathe', 'squeeze', 'cold', 'check', 'stop', 'reasons', 'comfort', 'people', 'talk', 'close'];
const SCREENS = [
  ['Home', { name: 'hub' }],
  ['Library', { name: 'library' }],
  ['Give me a moment', { name: 'moment' }],
  ['A quiet minute', { name: 'ease' }],
  ['Rest', { name: 'rest' }],
  ['Diary', { name: 'diary' }],
  ['Comfort', { name: 'comfort' }],
  ['Lines', { name: 'lines' }],
  ['Night Watch', { name: 'shadows' }],
  ['Settings', { name: 'settings' }],
  ['Art room', { name: 'art' }],
  ['drawing page', { name: 'draw', kind: 'today' }],
  ['shadow ally page', { name: 'draw', kind: 'ally' }],
  ['a drawing', { name: 'piece', id: 'draw-today' }],
  ['Story Room', { name: 'stories' }],
  ['writing', { name: 'write', id: 'tale-1' }],
  ['reading', { name: 'read', id: 'tale-1' }],
  ...SAFE_AT.map((at) => [`Safe Zone ${at}`, { name: 'safe', at }]),
];
const SKILL = '.dq-skill *';
const SAFE = '.dq-safezone *:not(.dq-a, .dq-a *)';

/** The words on screen set under 16 px though not in capitals, or in Bodoni Moda past three words though not the player's own. */
const look = (page) =>
  page.evaluate(
    ({ KEPT, THEIRS }) => {
      const out = new Set();
      const label = (e) => e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => `.${c}`).join('');
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        const el = t.parentElement;
        if (!/\p{L}{2}/u.test(t.data) || el.closest('svg, .dq-sr, [aria-hidden="true"], script, style') || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        // a word kept whole (wholeWords in ui.ts) reads as part of the words around it
        const owner = el.closest('dq-words')?.parentElement ?? el;
        const text = owner.textContent.replace(/\s+/g, ' ').trim();
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const capitals = cs.textTransform === 'uppercase' || !/\p{Ll}/u.test(t.data);
        if (!capitals && size < 15.99 && !el.closest(KEPT.join())) out.add(`"${text.slice(0, 40)}" in ${label(owner)} is ${size} px`);
        const words = text.match(/\S*\p{L}\S*/gu)?.length ?? 0;
        if (/Bodoni/.test(cs.fontFamily) && words > 3 && !owner.closest(THEIRS.join())) out.add(`"${text.slice(0, 40)}" in ${label(owner)} is set in Bodoni Moda, ${words} words`);
      }
      return [...out];
    },
    { KEPT, THEIRS },
  );

/**
 * Waits for what the screen just drew to come in: its entry motion done (at most 2 s), then two frames. A skill's timer
 * or breathing ring changes the page every second, so a wait for the page to go quiet would only wait out its cap.
 */
const drawn = (page) =>
  page.evaluate(async () => {
    const ending = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 2000))]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

/** Opens `route` and waits for it to settle, or with `wait`, for that. */
async function go(page, route, wait = settle) {
  await page.evaluate((r) => window.__daily.go(r), route);
  await page.waitForFunction((r) => Object.entries(r).every(([k, v]) => window.__daily.route[k] === v), route, { timeout: 10000 });
  await wait(page);
}

// typed wherever a skill asks: a short word wider than most (Warm) and a long one, so the steps that show the answers
// back (the map, the draft) show words of both kinds
const TYPED = 'Warm hands and a conversation';

/**
 * Moves a skill on one step as a player would: where a step takes several choices, the first two; then Done or Next,
 * else the step's main button, else its first choice. Never a timer's Start or more time, which keep the step there.
 */
const onward = (page) =>
  page.evaluate(() => {
    const body = document.querySelector('.dq-step-body');
    const usable = (b) => b.checkVisibility({ checkVisibilityCSS: true }) && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
    const several = [...body.querySelectorAll('.dq-opts .dq-opt[aria-pressed]')].filter(usable);
    if (!several.some((b) => b.getAttribute('aria-pressed') === 'true')) several.slice(0, 2).forEach((b) => b.click());
    const buttons = [...body.querySelectorAll('button')].filter((b) => usable(b) && !/^(Start|\+\d)/.test(b.textContent.trim()));
    const pick = buttons.find((b) => /^(Done|Next)$/.test(b.textContent.trim())) ?? buttons.find((b) => b.matches('.dq-actions .dq-btn--primary')) ?? buttons.find((b) => b.matches('.dq-opts button'));
    pick?.click();
    return !!pick;
  });

/** What a skill's step says, its numbers aside, so a countdown ticking is the same step. */
const stepWords = (page) => page.evaluate(() => document.querySelector('.dq-step-body')?.textContent.replace(/\d+/g, '#') ?? '');

/**
 * Walks the skill `id` from its intro, by way of its part `entry` if given, to its end, with TYPED in every empty field
 * and a message's marked words asked for, calling `each(step)` on every step it shows, the end too. Each move must show
 * another step of the same skill. Returns the kinds of step it showed.
 */
async function walkSkill(h, page, id, entry, each) {
  await go(page, { name: 'skill', id, ...(entry && { entry }) }, drawn);
  const kinds = new Set();
  for (let step = 1; ; step++) {
    for (const field of await page.locator('.dq-step-body :is(textarea, input:not([type]), input[type=text])').all()) {
      if ((await field.isVisible()) && !(await field.inputValue())) await field.fill(TYPED);
    }
    const ask = page.locator('.dq-step-body .ca-hl-ask');
    if (await ask.isVisible()) {
      await ask.click();
      await page.locator('.dq-step-body .dq-hl-n').waitFor({ timeout: 10000 });
    }
    await drawn(page);
    // the step the skill marked as it showed it
    kinds.add(
      await page.evaluate(async (id) => {
        const d = window.__daily;
        const at = d.trail?.[d.at]?.place;
        return typeof at === 'number' ? (await import('/src/content/dbt.ts')).SKILL[id].steps[at]?.kind : null;
      }, id),
    );
    await each(step);
    if (await page.locator('.dq-step-body .dq-intro--end').isVisible()) return kinds;
    h.expect(step < 30, `${id}: no end after 30 steps`);
    const was = await stepWords(page);
    h.expect(await onward(page), `${id} step ${step}: nothing on it moves the skill on`);
    await page
      .waitForFunction((was) => window.__daily.route.name !== 'skill' || (document.querySelector('.dq-step-body')?.textContent.replace(/\d+/g, '#') ?? '') !== was, was, { timeout: 10000 })
      .catch(() => h.expect(false, `${id} step ${step}: moving on left it on the same step`));
    h.expect(await page.evaluate((id) => window.__daily.route.name === 'skill' && window.__daily.route.id === id, id), `${id} step ${step}: the walk left the skill before its end`);
    await drawn(page);
  }
}

/** Walks every skill in WALKS, calling `each(where)` on every step it shows; every kind of step must show. */
async function walkAll(h, page, each) {
  const kinds = new Set();
  for (const [id, entry] of WALKS) for (const k of await walkSkill(h, page, id, entry, (step) => each(`${id}${entry ? ` from ${entry}` : ''} step ${step}`))) kinds.add(k);
  const missed = KINDS.filter((k) => !kinds.has(k));
  h.expect(!missed.length, `the walks never showed a step of kind ${missed.join(', ')}`);
}

/** The words in `scope` and in a field that break with no hyphen, and, with `sideways`, the page if it scrolls sideways. */
async function bareBreaks(page, scope, sideways = true) {
  const out = [...(await cutShort(page, { scope })), ...(await fieldBreaks(page))];
  if (!sideways) return out;
  const wide = await page.evaluate(() => Math.max(...[document.scrollingElement, document.querySelector('.dq')].map((s) => s.scrollWidth - s.clientWidth)));
  if (wide > 1) out.push(`the page scrolls ${wide} px sideways`);
  return out;
}

/** Every companion screen, the walked skills and the Safe Zone on one phone; a first visit's screens; the intro. */
function sizes(phone) {
  return async (h) => {
    const problems = [];
    const size = `${phone.width}x${phone.height}`;
    const note = (where, found) => problems.push(...found.map((f) => `${size} ${where}: ${f}`));
    const { ctx, page, errors } = await boot(h, phone);
    for (const [where, route] of SCREENS) {
      await go(page, route);
      note(where, [...(await look(page)), ...(route.name === 'safe' ? await bareBreaks(page, SAFE) : [])]);
      await h.shot(page, `phone-type-${size}-${where.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
    }
    // the reading page sets the player's story in Bodoni Moda and the Lantern's words around it in Jost
    await go(page, { name: 'read', id: 'tale-1' });
    const reading = await page.evaluate(() => ({ story: getComputedStyle(document.querySelector('.st-read-text')).fontFamily, size: getComputedStyle(document.querySelector('.st-read-tools-l')).fontFamily }));
    if (!/^"?Bodoni Moda/.test(reading.story) || !/^"?Jost/.test(reading.size)) problems.push(`${size} reading: the story is in ${reading.story} and Text size in ${reading.size}`);
    // what opens on them
    const opened = async (where, route, open) => {
      await go(page, route);
      await open();
      await drawn(page);
      note(where, await look(page));
    };
    await opened('Home, stats and titles open', { name: 'hub' }, async () => {
      await page.locator('.dq-stats-toggle').click();
      await page.locator('.w2-title-btn').click();
      await page.locator('.w2-title-opt').first().waitFor({ timeout: 10000 });
    });
    await opened('Home, checked in', { name: 'hub' }, async () => {
      await page.locator('.dq-feels .dq-opt').filter({ hasText: 'Tired' }).click();
      await page.locator('.dq-suggest-why').waitFor({ timeout: 10000 });
    });
    await opened('Diary, export preview open', { name: 'diary' }, () => page.locator('.dq-export summary').click());
    await opened('Story Room, removed stories open', { name: 'stories' }, () => page.locator('.st-removed-tg').click());
    await opened('writing, menu open', { name: 'write', id: 'tale-1' }, async () => {
      await page.locator('.st-more').click();
      await page.locator('.st-menu-i').first().waitFor({ timeout: 10000 });
    });
    await opened('writing, co-writer open', { name: 'write', id: 'tale-1' }, async () => {
      await page.locator('.st-cwbtn').click();
      await page.locator('.st-mode').first().waitFor({ timeout: 10000 });
    });
    await opened('a shadow ally named', { name: 'draw', kind: 'ally' }, async () => {
      // a short line inside the part of the page that shows
      const frame = page.locator('.dq-draw-frame');
      await frame.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('.dq-ink-stage')?.inert === false, null, { timeout: 10000 });
      const b = await frame.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const top = Math.max(r.top, 0);
        return { x: r.left, w: r.width, top, h: Math.min(r.bottom, innerHeight) - top };
      });
      await page.mouse.move(b.x + b.w * 0.3, b.top + b.h * 0.3);
      await page.mouse.down();
      await page.mouse.move(b.x + b.w * 0.7, b.top + b.h * 0.7, { steps: 8 });
      await page.mouse.up();
      await page.locator('.dq-save:enabled').click({ timeout: 10000 });
      await page.locator('.dq-sheet:not(.is-hidden) .dq-opts--names').waitFor({ timeout: 10000 });
    });
    for (const id of await page.evaluate(async () => (await import('/src/content/dbt.ts')).SKILLS.map((s) => s.id))) {
      await go(page, { name: 'skill', id }, drawn);
      note(`${id} as it opens`, [...(await look(page)), ...(await bareBreaks(page, SKILL))]);
    }
    await walkAll(h, page, async (where) => note(where, [...(await look(page)), ...(await bareBreaks(page, SKILL))]));
    h.expect(!errors.length, `${size}: ${errors.join(' | ')}`);
    await ctx.close();

    // a first visit: no story yet, Rest's title just unlocked, watchers still to come, nothing unlocked in the Wardrobe
    const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now(), companionAt: Date.now() });
    const first = await h.open({ [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', phone);
    await h.reachHub(first.page);
    for (const [where, route] of [['first Home', { name: 'hub' }], ['first Rest', { name: 'rest' }], ['first Night Watch', { name: 'shadows' }], ['first Settings', { name: 'settings' }], ['first Story Room', { name: 'stories' }]]) {
      await go(first.page, route);
      note(where, await look(first.page));
    }
    // a story with nothing in it yet, read
    await first.page.getByRole('button', { name: 'New story' }).click();
    await first.page.waitForFunction(() => window.__daily.route.name === 'write', null, { timeout: 10000 });
    await go(first.page, { name: 'read', id: await first.page.evaluate(() => window.__daily.route.id) });
    await first.page.locator('.st-read-empty').waitFor({ timeout: 10000 });
    note('an empty story read', await look(first.page));
    await h.shot(first.page, `phone-type-${size}-empty-reading`);
    h.expect(!first.errors.length, `${size} first visit: ${first.errors.join(' | ')}`);
    await first.ctx.close();

    // the intro: the title and name prompt of a first visit, then from the rewards to the end card
    const intro = await h.open({}, '?mute&nopost&msaa=0', phone);
    await intro.page.locator('.title-screen').waitFor({ timeout: 60000 });
    await settle(intro.page);
    note('title', await look(intro.page));
    await intro.page.locator('.title-screen').click();
    await intro.page.locator('#np-name').waitFor({ timeout: 30000 });
    await settle(intro.page);
    note('name prompt', await look(intro.page));
    await h.shot(intro.page, `phone-type-${size}-name-prompt`);
    await intro.ctx.close();
    const end = await rewards(h, phone, problems);
    for (const [button, next, where] of [['.rw .sw-btn', '.letter .sw-btn', 'letter'], ['.letter .sw-btn', '.ec-actions .sw-btn.gold', 'end card']]) {
      await end.page.evaluate((b) => document.querySelector(b).click(), button);
      await shown(end.page, next);
      note(where, await look(end.page));
      await h.shot(end.page, `phone-type-${size}-${where.replace(' ', '-')}`);
    }
    await end.ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

/** Waits until `sel` has faded in where it shows. */
const shown = (page, sel) => until(page, (s) => {
  const b = document.querySelector(s);
  return !!b && b.checkVisibility({ checkOpacity: true }) && b.getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity);
}, sel, { timeout: 60000 });

/**
 * The rewards on `phone`, all four cards in: each card's words at 16 px or more and inside it, and every card and Read
 * the note in reach, below the Safe Zone and Skip, once the list scrolls to them. Leaves the page open on them.
 */
async function rewards(h, phone, problems) {
  const size = `${phone.width}x${phone.height}`;
  const opened = await h.open({}, '?shot=rewards&mute&nopost&msaa=0', phone);
  const { page } = opened;
  await page.locator('.title-screen').waitFor({ timeout: 60000 });
  await page.locator('.title-screen').click();
  await shown(page, '.rw .sw-btn');
  problems.push(...(await look(page)).map((f) => `${size} rewards: ${f}`));
  const found = await page.evaluate(() => {
    const out = [];
    const top = document.querySelector('.ui-ways').getBoundingClientRect().bottom;
    const inside = (q, r) => q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5;
    for (const e of [...document.querySelectorAll('.rw-card'), document.querySelector('.rw .sw-btn')]) {
      e.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const r = e.getBoundingClientRect();
      const name = e.querySelector('.nm')?.textContent ?? e.textContent;
      if (r.top < top - 0.5 || r.bottom > innerHeight + 0.5) out.push(`"${name}" is out of reach (${Math.round(r.top)} to ${Math.round(r.bottom)}, under ${Math.round(top)} to ${innerHeight})`);
      if (!e.matches('.rw-card')) continue;
      const ds = e.querySelector('.ds');
      if (parseFloat(getComputedStyle(ds).fontSize) < 15.99) out.push(`"${name}" says what it is at ${getComputedStyle(ds).fontSize}`);
      const range = document.createRange();
      for (const part of e.querySelectorAll('.em, .nm, .kd, .ds')) {
        range.selectNodeContents(part);
        if (![part.getBoundingClientRect(), ...range.getClientRects()].every((q) => inside(q, r))) out.push(`"${name}": its ${part.className} reaches past the card`);
      }
    }
    return out;
  });
  problems.push(...found.map((f) => `${size} rewards: ${f}`));
  await page.evaluate(() => document.querySelector('.rw').scrollTo(0, 0));
  await h.shot(page, `phone-type-${size}-rewards`);
  return opened;
}

/**
 * The words typed in a field of a skill or the Safe Zone that it breaks with no hyphen: laid out as the field lays them
 * out, its width, font and wrapping, but with the browser's hyphenation off, no word may break at all.
 */
const fieldBreaks = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const f of document.querySelectorAll('.dq-skill textarea, .dq-safezone textarea')) {
      if (!f.value.trim() || !f.checkVisibility()) continue;
      const cs = getComputedStyle(f);
      const m = document.createElement('div');
      m.textContent = f.value;
      Object.assign(m.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        visibility: 'hidden',
        width: `${f.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        wordSpacing: cs.wordSpacing,
        textTransform: cs.textTransform,
        whiteSpace: cs.whiteSpace,
        overflowWrap: cs.overflowWrap,
        wordBreak: cs.wordBreak,
        hyphens: 'manual',
      });
      document.body.append(m);
      const t = m.firstChild;
      let top = null;
      for (let i = 0; i < t.length; i++) {
        if (/\s/.test(t.data[i])) {
          top = null;
          continue;
        }
        const r = document.createRange();
        r.setStart(t, i);
        r.setEnd(t, i + 1);
        const q = r.getClientRects()[0];
        if (!q) continue;
        if (top !== null && q.top > top + q.height / 2 && t.data[i - 1] !== '-') {
          const [from, to] = [t.data.slice(0, i).search(/\S*$/), i + t.data.slice(i).search(/\s|$/)];
          out.push(`"${t.data.slice(from, i)}|${t.data.slice(i, to)}" in a field breaks with no hyphen`);
        }
        top = q.top;
      }
      m.remove();
    }
    return out;
  });

/** At 200% zoom on `phone`: no word in what `walk` opens breaks without a hyphen, and nothing scrolls sideways. */
function zoomed(phone, walk) {
  return async (h) => {
    const problems = [];
    const size = `${phone.width}x${phone.height} at 200%`;
    const { ctx, page, errors } = await boot(h, { width: phone.width / 2, height: phone.height / 2 });
    const check = async (where, scope, sideways) => problems.push(...(await bareBreaks(page, scope, sideways)).map((f) => `${size} ${where}: ${f}`));
    await walk(h, page, check);
    h.expect(!errors.length, `${size}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

/**
 * Every skill's window as it opens, and the walked skills' every step, there for their words only: how a step's controls
 * fit a zoomed phone is no-sideways-overflow's to check.
 */
async function skills(h, page, check) {
  for (const id of await page.evaluate(async () => (await import('/src/content/dbt.ts')).SKILLS.map((s) => s.id))) {
    await go(page, { name: 'skill', id }, drawn);
    await check(`${id} as it opens`, SKILL);
  }
  await h.shot(page, `phone-type-${page.viewportSize().width * 2}-200-skill`);
  await walkAll(h, page, (where) => check(where, SKILL, false));
}

/** Every Safe Zone screen, and every country's Talk list at the regular and the largest text size. */
async function safeZone(h, page, check) {
  for (const at of SAFE_AT.filter((at) => at !== 'talk')) {
    await go(page, { name: 'safe', at }, drawn);
    await check(`Safe Zone ${at}`, SAFE);
  }
  for (const text of ['regular', 'largest']) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`${h.SAVE}.read-size`, text]);
    await go(page, { name: 'safe', at: 'talk' }, drawn);
    for (const region of await page.locator('.dq-region select option').evaluateAll((os) => os.map((o) => o.value))) {
      await page.locator('.dq-region select').selectOption(region);
      await drawn(page);
      await check(`Talk, ${region}, ${text} text`, SAFE);
    }
    await page.locator('.dq-region select').selectOption('mt');
    await drawn(page);
    await h.shot(page, `phone-type-${page.viewportSize().width * 2}-200-talk-${text}`);
  }
}

export const scenarios = {
  ...Object.fromEntries(PHONES.map((p) => [`phone-type-${p.width}x${p.height}`, sizes(p)])),
  'phone-type-rewards-sideways': async (h) => {
    const problems = [];
    const { ctx } = await rewards(h, SIDEWAYS, problems);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  },
  ...Object.fromEntries(PHONES.flatMap((p) => [[`phone-type-${p.width}x${p.height}-200-skills`, zoomed(p, skills)], [`phone-type-${p.width}x${p.height}-200-safe-zone`, zoomed(p, safeZone)]])),
};
