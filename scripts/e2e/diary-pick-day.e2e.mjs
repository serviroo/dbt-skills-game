// Pick a day: from the diary card, a list of every earlier day with something on its card, newest first and a month at
// a time, opens any of them on the card in one tap. On a returning save whose diary runs back more than a year, with
// gaps, a day rated with nothing left on it, today's card and one dated after today:
//   diary-pick-day-list   by keyboard from the card, Pick a day opens the list: its months and the days in each newest
//                         first, each day with what is on its card, only days with something on them, no word about
//                         gaps, counts or missed days, and a real list (a heading and a list per month, list items,
//                         buttons named with their day and described with what is on it, a ring on the one with
//                         focus). The Lantern button and the browser's Back both come back to the card on the day it
//                         showed, focus on Pick a day
//   diary-pick-day-open   a day from months back and one from last year open on the card as they were (ratings, a
//                         row today's card no longer has, the note, the skills), its title read first and naming the
//                         year when it isn't this one, with Earlier day, Later day and Today as on any earlier day;
//                         saving there keeps the change with that day and adds no XP. The first day, a skill
//                         practised before the diary began, opens too, and Back from the Safe Zone comes back to it.
//                         Print a week goes back as far, to the week with that skill on it, and Back from there comes
//                         back to the card on that day
//   diary-pick-day-empty  with nothing on any earlier day, the list is one calm line and no list. A day filled in in
//                         another open copy shows up; cleared there while it has focus here, the line comes back and
//                         focus goes to the heading
//   diary-pick-day-tabs   a day filled in and the day with focus rated in another open copy show in the open list,
//                         focus staying on its day
//   diary-pick-day-fit    the list passes layout-fit's checks at 390x844, 320x568 and 844x390, and at 200% zoom
//                         nothing scrolls sideways, every day and the Safe Zone button are on screen and its words
//                         are at least 16 px
//   diary-pick-day-year   a year and a month of days, every one with something on it, opens in under 400 ms with the
//                         CPU slowed four times, all of them listed down to the first
// Each scenario runs on one fixed time, so today never turns over partway.
import { addDays, dayOf, returning, route } from './first-actions.e2e.mjs';
import { audit, PAGE, settle, SKIP } from './layout-fit.e2e.mjs';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The card's name for a day, with the year when it isn't this one. */
const label = (day, today) => {
  const [y, m, d] = day.split('-').map(Number);
  const t = `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTH[m - 1].slice(0, 3)}`;
  return today && day.slice(0, 4) !== today.slice(0, 4) ? `${t} ${y}` : t;
};
const monthOf = (day) => `${MONTH[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
/** Words that count days or point at the ones without anything on them. */
const COUNTING = /miss|skip|streak|gap|in a row|\bago\b|count|empty|nothing|\d+\s*(days|entries)/i;

const at = (now) => (ctx) => ctx.clock.setFixedTime(new Date(now));
const skill = (id, day, now, n) => ({ id: `pk-s${n}`, k: 'skill', xp: 20, t: now - 86400e3, day, stat: 'sense', skill: id });

/**
 * A returning save whose diary goes back more than a year, with gaps between: each day listed with what its card shows,
 * and the days that hold nothing to list (an emptied one, today's, and one dated after today). The save doesn't say when
 * it began, as an old one may not, and its first day is a skill practised before the diary's first day.
 */
function seeded(h) {
  const now = Date.now();
  const today = dayOf(now);
  const d = (n) => addDays(today, -n);
  const storage = returning(h, 3);
  const save = JSON.parse(storage[h.SAVE]);
  const entry = (day, emotions, urges, note) => ({ day, emotions, urges, note, updatedAt: now - 86400e3 });
  save.diary = {
    [today]: entry(today, { Joy: 4 }, {}, 'Tea with a friend.'),
    [addDays(today, 2)]: entry(addDays(today, 2), { Joy: 1 }, {}, ''),
    [d(1)]: entry(d(1), { Sadness: 3 }, {}, ''),
    [d(3)]: entry(d(3), {}, {}, 'Slept in.'),
    [d(10)]: entry(d(10), { Anger: null }, { 'Urge to give up on today': null }, ''),
    [d(40)]: entry(d(40), { Restless: 2 }, { 'Urge to give up on today': 1 }, 'Walked to the river.'),
    [d(41)]: entry(d(41), { Shame: 1 }, {}, ''),
    [d(95)]: entry(d(95), {}, {}, 'Rain all day.'),
    [d(400)]: entry(d(400), { Sadness: 2, Calm: 4 }, {}, 'A slow year end.'),
  };
  save.events.push(skill('wise-mind', d(9), now, 1), skill('wise-mind', d(40), now, 2), skill('stop', d(41), now, 3), skill('check-facts', d(95), now, 4), skill('wise-mind', d(450), now, 5));
  save.events.push({ id: 'pk-f1', k: 'feedback', xp: 0, t: now - 86400e3, day: d(41), skill: 'stop', data: { answer: 'Yes' } });
  storage[h.SAVE] = JSON.stringify(save);
  const listed = [
    [d(1), 'Ratings'],
    [d(3), 'A note'],
    [d(9), 'Skills'],
    [d(40), 'Ratings, a note and skills'],
    [d(41), 'Ratings and skills'],
    [d(95), 'A note and skills'],
    [d(400), 'Ratings and a note'],
    [d(450), 'Skills'],
  ];
  return { storage, now, today, d, listed };
}

async function openDiary(h, page) {
  await page.bringToFront();
  await h.reachHub(page);
  await page.locator('.dq-tile', { hasText: 'Diary card' }).click();
  await route(page, 'diary');
  await page.locator('.dq-today').waitFor();
}
const dayBtn = (page, name) => page.locator('.dq-today .dq-daynav').getByRole('button', { name, exact: true });
const titled = (page, t) => page.waitForFunction((t) => document.querySelector('.dq-today .dq-chip-t')?.textContent === t, t, { timeout: 5000 });
const focused = (page) => page.evaluate(() => document.activeElement?.textContent.trim() || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);
const progress = (page) => page.evaluate(() => ({ xp: window.__daily.store.derived().xp, diary: window.__daily.store.state.events.filter((e) => e.k === 'diary').length }));
/** The list as it reads: each month's heading and its days, in order. */
const list = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.dq-days section')].map((s) => ({
      month: s.querySelector('h2')?.textContent,
      days: [...s.querySelectorAll(':scope > ul > li > button')].map((b) => [b.querySelector('.dq-dayrow-d').textContent, b.querySelector('.dq-dayrow-w').textContent]),
    })),
  );
const expected = (listed) => {
  const out = [];
  for (const [day, what] of listed) {
    if (out.at(-1)?.month !== monthOf(day)) out.push({ month: monthOf(day), days: [] });
    out.at(-1).days.push([label(day), what]);
  }
  return JSON.stringify(out);
};
const noteBox = (page) => page.locator('.dq-today').getByRole('textbox', { name: 'One line, optional' });
const pageText = (page) => page.locator('#dq-main').innerText();
/** The card as it reads now. */
const card = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.dq-today');
    return {
      title: c.querySelector('.dq-chip-t').textContent,
      rows: [...c.querySelectorAll('.dq-drows [role=radiogroup]')].map((g) => g.getAttribute('aria-label')),
      rated: [...c.querySelectorAll('.dq-drows [role=radio][aria-checked=true]')].map((r) => r.getAttribute('aria-label')),
      skills: c.querySelector('.dq-skillsused')?.checkVisibility() ? c.querySelector('.dq-skillsused').textContent : null,
      days: [...c.querySelectorAll('.dq-daynav button')].filter((b) => b.checkVisibility()).map((b) => b.textContent.trim()),
    };
  });

export const scenarios = {
  async 'diary-pick-day-list'(h) {
    const { storage, now, today, d, listed } = seeded(h);
    const { ctx, page, errors } = await h.open(storage, '?mute', undefined, at(now));
    try {
      await openDiary(h, page);
      // by keyboard: from the heading, Earlier day, then Pick a day
      await page.waitForFunction(() => document.activeElement?.matches('.dq-diary h1'), null, { timeout: 5000 });
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      h.expect((await focused(page)) === 'Pick a day', `two Tabs from the heading is on ${await focused(page)}`);
      await page.keyboard.press('Enter');
      await route(page, 'days');
      await page.locator('.dq-days section').first().waitFor();
      h.expect((await page.locator('#dq-main h1').textContent()) === 'Pick a day', 'the list has no Pick a day heading');
      const shown = await list(page);
      h.expect(JSON.stringify(shown) === expected(listed), `the list:\n${JSON.stringify(shown)}\nnot\n${expected(listed)}`);
      const text = await pageText(page);
      h.expect(!COUNTING.test(text), `the list counts days or points at gaps: ${text.match(COUNTING)?.[0]}\n${text}`);
      for (const day of [today, addDays(today, 2), d(10)]) h.expect(!text.includes(label(day)), `${day} is listed: ${text}`);
      h.expect(await page.locator('.dq-top .dq-safe').isVisible(), 'the Safe Zone button is not on the list');

      // a real list: a heading and a list for each month, each day a button in a list item, named with its day and
      // described with what is on it
      const months = [...new Set(listed.map(([day]) => monthOf(day)))];
      h.expect((await page.getByRole('heading', { level: 2 }).allTextContents()).join('|') === months.join('|'), 'the months are not headings');
      h.expect((await page.getByRole('list').count()) === months.length && (await page.locator('.dq-days ul[role=list]').count()) === months.length, 'a month is not a list of its own');
      h.expect((await page.locator('.dq-days ul > li > button').count()) === listed.length && (await page.getByRole('listitem').count()) === listed.length, 'the days are not list items');
      for (const [day, what] of listed) {
        const b = page.getByRole('button', { name: label(day), exact: true });
        const said = (await b.count()) === 1 ? await b.evaluate((e) => document.getElementById(e.getAttribute('aria-describedby'))?.textContent) : null;
        h.expect(said === what, said === null ? `no one button named "${label(day)}"` : `the button for ${label(day)} is described as "${said}", not "${what}"`);
      }
      await page.keyboard.press('Tab');
      h.expect((await focused(page)).startsWith(label(d(1))), `one Tab from the list's heading is on ${await focused(page)}`);
      const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      h.expect(ring !== 'none', 'the day with focus shows no ring');
      await h.shot(page, 'diary-pick-day-list-390');

      // the Lantern button comes back to the card, focus on Pick a day
      await page.locator('.dq-top .dq-back').click();
      await route(page, 'diary');
      await titled(page, label(today));
      await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Pick a day', null, { timeout: 5000 }).catch(() => {});
      h.expect((await focused(page)) === 'Pick a day', `focus back from the list with the Lantern button is on ${await focused(page)}`);

      // from an earlier day on the card, the browser's Back comes back to that day, focus on Pick a day again
      await dayBtn(page, 'Earlier day').click();
      await titled(page, label(d(1)));
      await dayBtn(page, 'Pick a day').click();
      await route(page, 'days');
      await page.goBack();
      await route(page, 'diary');
      await titled(page, label(d(1)));
      await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Pick a day', null, { timeout: 5000 }).catch(() => {});
      h.expect((await focused(page)) === 'Pick a day', `focus back from the list with Back is on ${await focused(page)}`);
      const c = await card(page);
      h.expect(c.rated.includes('Sadness: 3') && JSON.stringify(c.days) === JSON.stringify(['Earlier day', 'Later day', 'Today', 'Pick a day']), `the card back from the list: ${JSON.stringify(c)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-pick-day-open'(h) {
    const { storage, now, today, d } = seeded(h);
    const { ctx, page, errors } = await h.open(storage, '?mute', undefined, at(now));
    try {
      await openDiary(h, page);
      const before = await progress(page);
      await dayBtn(page, 'Pick a day').click();
      await route(page, 'days');
      // by keyboard, Tab down to a day from more than a month back
      await page.locator('#dq-main h1').focus();
      for (let i = 0; i < 8 && !(await focused(page)).startsWith(label(d(40))); i++) await page.keyboard.press('Tab');
      h.expect((await focused(page)).startsWith(label(d(40))), `Tab never reached ${label(d(40))}`);
      await page.keyboard.press('Enter');
      await route(page, 'diary');
      await titled(page, label(d(40), today));
      await page.waitForFunction(() => document.activeElement?.matches('.dq-today .dq-chip-t'), null, { timeout: 5000 }).catch(() => {});
      h.expect(await page.evaluate(() => document.activeElement?.matches('.dq-today .dq-chip-t')), `focus on the day opened is on ${await focused(page)}`);
      let c = await card(page);
      for (const r of ['Restless: 2', 'Urge to give up on today: 1']) h.expect(c.rated.includes(r), `${d(40)} does not show ${r}: ${JSON.stringify(c)}`);
      h.expect(c.rows.includes('Restless') && (await noteBox(page).inputValue()) === 'Walked to the river.' && /Still Center/.test(c.skills ?? ''), `${d(40)} as opened: ${JSON.stringify(c)}`);
      h.expect(JSON.stringify(c.days) === JSON.stringify(['Earlier day', 'Later day', 'Today', 'Pick a day']), `the day buttons: ${JSON.stringify(c.days)}`);
      h.expect(await page.locator('.dq-top .dq-safe').isVisible(), 'the Safe Zone button is not on the day opened');
      await noteBox(page).evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await h.shot(page, 'diary-pick-day-open-390');

      // a change there stays with that day, and adds no XP
      await page.locator('.dq-today').getByRole('radio', { name: 'Restless: 3', exact: true }).click();
      await page.locator('.dq-today').getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-today .dq-hint[aria-live]').filter({ hasText: `Saved to ${label(d(40), today)} on this device.` }).waitFor({ timeout: 5000 });
      const stored = JSON.parse(await h.ls(page, h.SAVE)).diary;
      h.expect(stored[d(40)]?.emotions?.Restless === 3 && stored[today]?.emotions?.Joy === 4 && stored[today]?.emotions?.Restless === undefined, `as stored: ${JSON.stringify({ day: stored[d(40)], today: stored[today] })}`);
      h.expect(JSON.stringify(await progress(page)) === JSON.stringify(before), 'saving a day opened from the list changed XP or diary events');

      // last year's day names its year, and steps on from there as any earlier day does
      await dayBtn(page, 'Pick a day').click();
      await route(page, 'days');
      await page.getByRole('button', { name: label(d(400)), exact: true }).click();
      await route(page, 'diary');
      await titled(page, label(d(400), today));
      c = await card(page);
      h.expect(c.title.endsWith(d(400).slice(0, 4)) && c.rated.includes('Sadness: 2') && c.rated.includes('Calm: 4') && (await noteBox(page).inputValue()) === 'A slow year end.', `last year's day: ${JSON.stringify(c)}`);
      await h.shot(page, 'diary-pick-day-open-last-year-390');
      await dayBtn(page, 'Later day').click();
      await titled(page, label(d(399), today));
      h.expect(!(await card(page)).rated.length, 'the day after last year\'s day shows ratings');

      // the first day, a skill practised before the diary began, opens too, and Back from the Safe Zone comes back to it
      await dayBtn(page, 'Pick a day').click();
      await route(page, 'days');
      await page.getByRole('button', { name: label(d(450)), exact: true }).click();
      await route(page, 'diary');
      await titled(page, label(d(450), today));
      c = await card(page);
      h.expect(/Still Center/.test(c.skills ?? '') && JSON.stringify(c.days) === JSON.stringify(['Later day', 'Today', 'Pick a day']), `the first day: ${JSON.stringify(c)}`);
      await page.locator('.dq-top .dq-safe').click();
      await route(page, 'safe');
      await page.goBack();
      await route(page, 'diary');
      await titled(page, label(d(450), today));

      // Print a week goes back as far, and Back from there comes back to the card on that day
      await page.getByRole('button', { name: 'Print a week', exact: true }).click();
      await route(page, 'print');
      const earlierWeek = page.locator('.dq-printweek .dq-daynav').getByRole('button', { name: 'Earlier week', exact: true });
      await earlierWeek.focus();
      for (let i = 0; i < 70 && (await earlierWeek.isVisible()); i++) await page.keyboard.press('Enter');
      const first = await page.locator('.dq-paper-days li', { hasText: label(d(450)) }).innerText().catch(() => '');
      h.expect(!(await earlierWeek.isVisible()) && /Wise Mind \(practised\)/.test(first), `the earliest week Print a week reaches: ${await page.locator('.dq-printweek .dq-chip-t').textContent()}`);
      await page.goBack();
      await route(page, 'diary');
      await titled(page, label(d(450), today));
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-pick-day-empty'(h) {
    const now = Date.now();
    const today = dayOf(now);
    const storage = returning(h, 3);
    const save = JSON.parse(storage[h.SAVE]);
    // today's card, and an earlier day rated and then cleared: nothing on any earlier day
    save.diary = {
      [today]: { day: today, emotions: { Joy: 4 }, urges: {}, note: 'Tea.', updatedAt: now - 60e3 },
      [addDays(today, -2)]: { day: addDays(today, -2), emotions: { Joy: null }, urges: {}, note: '', updatedAt: now - 86400e3 },
    };
    storage[h.SAVE] = JSON.stringify(save);
    const { ctx, page, errors } = await h.open(storage, '?mute', undefined, at(now));
    try {
      await openDiary(h, page);
      await dayBtn(page, 'Pick a day').click();
      await route(page, 'days');
      await settle(page);
      const text = await pageText(page);
      h.expect(text.includes('No earlier days yet. Each day you fill in shows up here.'), `the empty list reads: ${text}`);
      h.expect(!(await page.locator('#dq-main ul, #dq-main li, .dq-dayrow').count()), 'the empty list draws a list');
      h.expect(!COUNTING.test(text), `the empty list counts days or points at gaps: ${text}`);
      h.expect(await page.locator('.dq-top .dq-safe').isVisible(), 'the Safe Zone button is not on the empty list');
      await h.shot(page, 'diary-pick-day-empty-390');

      // another open copy fills in an earlier day, which shows here; cleared there again while it has focus here, the
      // calm line comes back and focus goes to the heading
      const day = addDays(today, -2);
      const b = await ctx.newPage();
      b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
      await b.goto(h.server.url + '/?mute');
      await openDiary(h, b);
      for (let i = 0; i < 2; i++) await dayBtn(b, 'Earlier day').click();
      await titled(b, label(day));
      await noteBox(b).fill('Called home.');
      await b.locator('.dq-today').getByRole('button', { name: 'Save', exact: true }).click();
      await b.locator('.dq-today .dq-hint[aria-live]').filter({ hasText: `Saved to ${label(day)}` }).waitFor({ timeout: 5000 });
      await page.bringToFront();
      const row = page.getByRole('button', { name: label(day), exact: true });
      await row.waitFor({ timeout: 5000 });
      await row.focus();
      await b.bringToFront();
      await noteBox(b).fill('');
      await b.locator('.dq-today').getByRole('button', { name: 'Save', exact: true }).click();
      await page.bringToFront();
      await page.getByText('No earlier days yet. Each day you fill in shows up here.').waitFor({ timeout: 5000 });
      const on = await page.evaluate(() => (document.activeElement?.matches('#dq-main h1') ? 'the heading' : document.activeElement?.tagName));
      h.expect(on === 'the heading', `focus after the last day went is on ${on}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-pick-day-tabs'(h) {
    const { storage, now, d } = seeded(h);
    const { ctx, page: a, errors } = await h.open(storage, '?mute', undefined, at(now));
    try {
      await openDiary(h, a);
      await dayBtn(a, 'Pick a day').click();
      await route(a, 'days');
      await a.getByRole('button', { name: label(d(3)), exact: true }).focus();
      const b = await ctx.newPage();
      b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
      await b.goto(h.server.url + '/?mute');
      await openDiary(h, b);
      // the other copy fills in a day the list doesn't have, then rates the day that has focus here
      for (let i = 0; i < 2; i++) await dayBtn(b, 'Earlier day').click();
      await titled(b, label(d(2)));
      await noteBox(b).fill('Called home.');
      await b.locator('.dq-today').getByRole('button', { name: 'Save', exact: true }).click();
      await b.locator('.dq-today .dq-hint[aria-live]').filter({ hasText: `Saved to ${label(d(2))}` }).waitFor({ timeout: 5000 });
      await dayBtn(b, 'Earlier day').click();
      await titled(b, label(d(3)));
      await b.locator('.dq-today').getByRole('radio', { name: 'Sadness: 2', exact: true }).click();
      await b.locator('.dq-today').getByRole('button', { name: 'Save', exact: true }).click();
      await b.locator('.dq-today .dq-hint[aria-live]').filter({ hasText: `Saved to ${label(d(3))}` }).waitFor({ timeout: 5000 });
      await a.bringToFront();
      await a.waitForFunction((day) => document.getElementById(`dq-holds-${day}`)?.textContent === 'Ratings and a note', d(3), { timeout: 5000 }).catch(() => {});
      const shown = (await list(a)).flatMap((m) => m.days);
      h.expect(JSON.stringify(shown.slice(0, 3)) === JSON.stringify([[label(d(1)), 'Ratings'], [label(d(2)), 'A note'], [label(d(3)), 'Ratings and a note']]), `the list after another copy filled in ${d(2)} and rated ${d(3)}: ${JSON.stringify(shown)}`);
      const on = await a.evaluate(() => document.activeElement?.closest('[data-item]')?.getAttribute('data-item'));
      h.expect(on === d(3), `focus after the list drew again is on ${on ?? (await focused(a))}, not ${d(3)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-pick-day-fit'(h) {
    const problems = [];
    for (const [zoom, vp] of [
      [1, { width: 390, height: 844 }],
      [1, { width: 320, height: 568 }],
      [1, { width: 844, height: 390 }],
      [2, { width: 390, height: 844 }],
      [2, { width: 320, height: 568 }],
      [2, { width: 844, height: 390 }],
    ]) {
      const size = `${vp.width}x${vp.height}${zoom === 2 ? '-200' : ''}`;
      const { storage, now, listed } = seeded(h);
      const { ctx, page, errors } = await h.open(storage, '?mute', { width: vp.width / zoom, height: vp.height / zoom }, at(now));
      try {
        await openDiary(h, page);
        await dayBtn(page, 'Pick a day').click();
        await route(page, 'days');
        await settle(page);
        await h.shot(page, `diary-pick-day-fit-${size}`);
        if (zoom === 1) problems.push(...(await audit(page, PAGE, SKIP)).map((f) => `${size} ${f.kind} ${f.what} (${f.detail})`));
        else {
          const found = await page.evaluate(() => {
            const out = [];
            for (const s of [document.scrollingElement, document.querySelector('.dq')]) if (s.scrollWidth > s.clientWidth + 1) out.push(`scrolls sideways: ${s.scrollWidth} px in ${s.clientWidth}`);
            const safe = document.querySelector('.dq-top .dq-safe').getBoundingClientRect();
            if (safe.left < 0 || safe.right > innerWidth + 0.5) out.push(`the Safe Zone button is off screen: ${Math.round(safe.left)} to ${Math.round(safe.right)} of ${innerWidth}`);
            return out;
          });
          problems.push(...found.map((f) => `${size} ${f}`));
          // each day, brought into view the way focus brings it, sits on screen whole, at least 44 px tall, in words of 16 px or more
          for (let i = 0; i < listed.length; i++) {
            const row = page.locator('.dq-dayrow').nth(i);
            await row.focus();
            const f = await row.evaluate((b) => {
              const out = [];
              const r = b.getBoundingClientRect();
              if (r.left < 0 || r.right > innerWidth + 0.5) out.push(`is off screen: ${Math.round(r.left)} to ${Math.round(r.right)} of ${innerWidth}`);
              if (r.height < 44) out.push(`is ${Math.round(r.height)} px tall`);
              for (const t of b.querySelectorAll('.dq-dayrow-d, .dq-dayrow-w')) if (parseFloat(getComputedStyle(t).fontSize) < 16) out.push(`"${t.textContent}" is ${getComputedStyle(t).fontSize}`);
              return out.map((x) => `"${b.querySelector('.dq-dayrow-d').textContent}" ${x}`);
            });
            problems.push(...f.map((x) => `${size} ${x}`));
          }
          await page.locator('.dq-dayrow').nth(3).focus();
          await h.shot(page, `diary-pick-day-fit-${size}-focus`);
        }
        h.expect(!errors.length, `${size}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!problems.length, `the list does not fit:\n${problems.join('\n')}`);
  },

  async 'diary-pick-day-year'(h) {
    const now = Date.now();
    const today = dayOf(now);
    const DAYS = 400;
    // a visit, a rated card with a note, and every other day a skill, on each of the 400 days before today
    const storage = returning(h, DAYS);
    const save = JSON.parse(storage[h.SAVE]);
    save.diary = {};
    for (let i = 1; i <= DAYS; i++) {
      const day = addDays(today, -i);
      save.diary[day] = { day, emotions: { Sadness: i % 6, Calm: (i + 2) % 6 }, urges: { 'Urge to give up on today': i % 3 }, note: `Day note ${i}.`, updatedAt: now - i * 86400e3 };
      if (i % 2) save.events.push(skill('wise-mind', day, now - i * 86400e3, i));
    }
    storage[h.SAVE] = JSON.stringify(save);
    const { ctx, page, errors } = await h.open(storage, '?mute', undefined, at(now));
    let cdp;
    try {
      cdp = await ctx.newCDPSession(page);
      await openDiary(h, page);
      await settle(page);
      // from the tap until the list is on screen, with the CPU slowed the way a slow phone or a busy CI box runs it
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const opened = await page.evaluate(async () => {
        const pick = [...document.querySelectorAll('.dq-today .dq-daynav button')].find((b) => b.textContent.trim() === 'Pick a day');
        const t0 = performance.now();
        pick.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { ms: Math.round(performance.now() - t0), rows: document.querySelectorAll('.dq-dayrow').length };
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      h.expect(opened.rows === DAYS, `${opened.rows} days listed of ${DAYS}`);
      h.expect(opened.ms < 400, `the list took ${opened.ms} ms to open with the CPU slowed four times`);
      // the first day at the bottom, under its month
      const last = page.locator('.dq-dayrow').last();
      await last.scrollIntoViewIfNeeded();
      h.expect((await last.locator('.dq-dayrow-d').textContent()) === label(addDays(today, -DAYS)), `the last day listed: ${await last.locator('.dq-dayrow-d').textContent()}`);
      h.expect((await page.locator('.dq-days section').last().locator('h2').textContent()) === monthOf(addDays(today, -DAYS)), 'the last month is not the first one in the diary');
      await h.shot(page, 'diary-pick-day-year-end-390');
      h.expect(!errors.length, errors.join('\n'));
      return { opened };
    } finally {
      await cdp?.detach().catch(() => {});
      await ctx.close();
    }
  },
};
