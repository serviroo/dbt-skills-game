// Open a past day in the diary. The card steps back a day at a time from today's, shows the day as it was (its ratings,
// a row it was rated on that today's card no longer has, its note and the skills practised that day) and keeps what is
// changed there with that day, never today's. On a returning save with yesterday's card filled in:
//   diary-past-day-open-edit   by keyboard from the card's heading, Earlier day opens yesterday as it was; a rating and
//                              the note changed there and saved are yesterday's after a reload, and today's card is as
//                              it was. Saving an earlier day never adds XP or a diary event, and today's first Save
//                              still adds its 10 XP once. Back from the Safe Zone comes back to the day that was open,
//                              and Later day hands focus to Earlier day as it goes on today's card
//   diary-past-day-two-tabs    two open copies on the same earlier day each see the other's rating and note, and the
//                              stored day holds both beside what it had
//   diary-past-day-crystal     an empty earlier day reads as an open page; what is filled in there goes into a Save
//                              Crystal and comes back whole, field times and all, on a fresh device
//   diary-past-day-fit         the earlier day's card passes layout-fit's checks at 390x844, 320x568 and 844x390, and
//                              at 200% zoom nothing scrolls sideways and the day buttons and Safe Zone button are on
//                              screen; after Save, at every size, every status line on the diary is at least 16 px and
//                              the line after Save sits in sight, below the top bar, and clear of the buttons. Each
//                              scenario runs on one fixed time, so today never turns over partway
import { addDays, dayOf, returning, route } from './first-actions.e2e.mjs';
import { audit, boot, PAGE, settle, SKIP } from './layout-fit.e2e.mjs';
import { crystal, restore } from './newer-save-safety.e2e.mjs';

const URGE = 'Urge to give up on today';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON[m - 1]}`;
};

/** Every page in a scenario reads one fixed time, so today can't turn over between the seed, the screen and a check. */
const at = (now) => (ctx) => ctx.clock.setFixedTime(new Date(now));
/** A returning save with today's and yesterday's cards filled in, yesterday's on a row the card no longer has. */
function seeded(h) {
  const now = Date.now();
  const today = dayOf(now), y = addDays(today, -1);
  const storage = returning(h, 3);
  const save = JSON.parse(storage[h.SAVE]);
  save.events.push({ id: 'pd-s1', k: 'skill', xp: 20, t: now - 86400e3, day: y, stat: 'sense', skill: 'wise-mind' });
  save.diary = {
    [y]: { day: y, emotions: { Sadness: 3, Restless: 2 }, urges: { [URGE]: 1 }, note: 'Walked to the river.', updatedAt: now - 86400e3 },
    [today]: { day: today, emotions: { Joy: 4 }, urges: {}, note: 'Tea with a friend.', updatedAt: now - 60e3 },
  };
  storage[h.SAVE] = JSON.stringify(save);
  return { storage, now, today, y };
}

async function openDiary(h, page) {
  await page.bringToFront();
  await home(page);
  await h.reachHub(page);
  await page.locator('.dq-tile', { hasText: 'Diary card' }).click();
  await route(page, 'diary');
  await page.locator('.dq-today').waitFor();
}
/** From another screen, Home the way the Lantern button goes there. */
const home = (page) => page.evaluate(() => window.__daily && window.__daily.route.name !== 'hub' && window.__daily.go({ name: 'hub' }));
const dayBtn = (page, name) => page.locator('.dq-today .dq-daynav').getByRole('button', { name, exact: true });
const noteBox = (page) => page.locator('.dq-today').getByRole('textbox', { name: 'One line, optional' });
const save = (page) => page.locator('.dq-today').getByRole('button', { name: 'Save', exact: true });
const said = (page) => page.locator('.dq-today .dq-hint[aria-live]');
const titled = (page, day) => page.waitForFunction((t) => document.querySelector('.dq-today .dq-chip-t')?.textContent === t, label(day), { timeout: 5000 });
const progress = (page) => page.evaluate(() => ({ xp: window.__daily.store.derived().xp, diary: window.__daily.store.state.events.filter((e) => e.k === 'diary').length }));
const stored = async (h, page) => JSON.parse(await h.ls(page, h.SAVE)).diary;
const fields = (e) => JSON.stringify({ emotions: e?.emotions, urges: e?.urges, note: e?.note });
/** The card as it reads now. */
const card = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.dq-today');
    const shown = (e) => !!e && e.checkVisibility();
    return {
      title: c.querySelector('.dq-chip-t').textContent,
      rows: [...c.querySelectorAll('.dq-drows [role=radiogroup]')].map((g) => g.getAttribute('aria-label')),
      rated: [...c.querySelectorAll('.dq-drows [role=radio][aria-checked=true]')].map((r) => r.getAttribute('aria-label')),
      skills: shown(c.querySelector('.dq-skillsused')) ? c.querySelector('.dq-skillsused').textContent : null,
      days: [...c.querySelectorAll('.dq-daynav button')].filter(shown).map((b) => b.textContent.trim()),
      text: c.innerText,
    };
  });
const focused = (page) => page.evaluate(() => document.activeElement?.textContent.trim() || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);

export const scenarios = {
  async 'diary-past-day-open-edit'(h) {
    const { storage, now, today, y } = seeded(h);
    const { ctx, page, errors } = await h.open(storage, '?mute', undefined, at(now));
    try {
      await openDiary(h, page);
      let c = await card(page);
      h.expect(c.title === label(today) && JSON.stringify(c.days) === JSON.stringify(['Earlier day']), `today's card: ${JSON.stringify(c)}`);
      h.expect(c.rated.includes('Joy: 4') && (await noteBox(page).inputValue()) === 'Tea with a friend.', `today's card does not show today: ${JSON.stringify(c)}`);
      await h.shot(page, 'diary-past-day-today-390');
      const before = await progress(page);

      // by keyboard: the heading, then one Tab to Earlier day
      await page.waitForFunction(() => document.activeElement?.matches('.dq-diary h1'), null, { timeout: 5000 });
      await page.keyboard.press('Tab');
      h.expect((await focused(page)) === 'Earlier day', `one Tab from the heading is on ${await focused(page)}`);
      await page.keyboard.press('Enter');
      await titled(page, y);
      h.expect((await focused(page)) === 'Earlier day', `focus after Earlier day is on ${await focused(page)}`);
      h.expect((await page.locator('.dq-today .dq-chip-t').getAttribute('aria-live')) === 'polite', 'the day it opens is not read out');
      c = await card(page);
      h.expect(JSON.stringify(c.days) === JSON.stringify(['Earlier day', 'Later day', 'Today']), `the day buttons on an earlier day: ${JSON.stringify(c.days)}`);
      for (const r of ['Sadness: 3', 'Restless: 2', `${URGE}: 1`]) h.expect(c.rated.includes(r), `yesterday's card does not show ${r}: ${JSON.stringify(c.rated)}`);
      h.expect(c.rows.includes('Restless') && !c.rated.includes('Joy: 4'), `yesterday's rows: ${JSON.stringify(c)}`);
      h.expect(/Still Center/.test(c.skills ?? '') && /Skills that day/i.test(c.text), `yesterday's skills: ${c.skills}`);
      h.expect((await noteBox(page).inputValue()) === 'Walked to the river.', `yesterday's note: ${await noteBox(page).inputValue()}`);
      h.expect(/An earlier day\. Anything you add or change here stays with this day\./.test(c.text), 'the card does not say an earlier day keeps its own changes');
      h.expect(await page.locator('.dq-top .dq-safe').isVisible(), 'the Safe Zone button is not on the earlier day');
      await h.shot(page, 'diary-past-day-open-390');

      // a rating and the note, still by keyboard, then Save
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      h.expect((await focused(page)) === '3' && (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Sadness: 3', `three Tabs on is ${await focused(page)}`);
      await page.keyboard.press('ArrowRight');
      for (let i = 0; i < 12 && !(await noteBox(page).evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
      await page.keyboard.press('End');
      await page.keyboard.type(' Slept well.');
      await page.keyboard.press('Tab');
      h.expect((await focused(page)) === 'Save', `Tab after the note is on ${await focused(page)}`);
      await page.keyboard.press('Enter');
      await page.waitForFunction((t) => document.querySelector('.dq-today .dq-hint[aria-live]')?.textContent === t, `Saved to ${label(y)} on this device.`, { timeout: 5000 });
      let after = await progress(page);
      h.expect(JSON.stringify(after) === JSON.stringify(before), `saving an earlier day changed XP or diary events: ${JSON.stringify({ before, after })}`);
      let d = await stored(h, page);
      h.expect(d[y]?.emotions?.Sadness === 4 && d[y]?.emotions?.Restless === 2 && d[y]?.note === 'Walked to the river. Slept well.', `yesterday as stored: ${fields(d[y])}`);
      h.expect(fields(d[today]) === fields({ emotions: { Joy: 4 }, urges: {}, note: 'Tea with a friend.' }), `today as stored: ${fields(d[today])}`);
      await h.shot(page, 'diary-past-day-saved-390');

      // the Safe Zone is one tap away, and Back comes back to the day that was open
      await page.locator('.dq-top .dq-safe').click();
      await route(page, 'safe');
      await page.goBack();
      await route(page, 'diary');
      await titled(page, y);

      // after a reload: today's card is today's, and the earlier day has the edit
      await page.reload();
      await openDiary(h, page);
      c = await card(page);
      h.expect(c.title === label(today) && c.rated.includes('Joy: 4') && !c.rated.includes('Sadness: 4') && (await noteBox(page).inputValue()) === 'Tea with a friend.', `today's card after a reload: ${JSON.stringify(c)}`);
      await dayBtn(page, 'Earlier day').click();
      await titled(page, y);
      c = await card(page);
      h.expect(c.rated.includes('Sadness: 4') && c.rated.includes('Restless: 2') && (await noteBox(page).inputValue()) === 'Walked to the river. Slept well.', `yesterday after a reload: ${JSON.stringify(c)}`);

      // Later day back to today hands focus to Earlier day; today's first Save adds 10 XP once, earlier days none
      await dayBtn(page, 'Later day').focus();
      await page.keyboard.press('Enter');
      await titled(page, today);
      h.expect((await focused(page)) === 'Earlier day', `focus after Later day reached today is on ${await focused(page)}`);
      await save(page).click();
      await page.waitForFunction(() => document.querySelector('.dq-today .dq-hint[aria-live]')?.textContent === 'Saved on this device. +10 XP', null, { timeout: 5000 });
      after = await progress(page);
      h.expect(after.xp === before.xp + 10 && after.diary === before.diary + 1, `today's first Save: ${JSON.stringify({ before, after })}`);
      await dayBtn(page, 'Earlier day').click();
      await titled(page, y);
      await save(page).click();
      await page.waitForFunction((t) => document.querySelector('.dq-today .dq-hint[aria-live]')?.textContent === t, `Saved to ${label(y)} on this device.`, { timeout: 5000 });
      await dayBtn(page, 'Today').click();
      await titled(page, today);
      await save(page).click();
      await page.waitForFunction(() => document.querySelector('.dq-today .dq-hint[aria-live]')?.textContent === 'Updated on this device.', null, { timeout: 5000 });
      const last = await progress(page);
      h.expect(JSON.stringify(last) === JSON.stringify(after), `XP after saving yesterday and today again: ${JSON.stringify({ after, last })}`);
      d = await stored(h, page);
      h.expect(d[y]?.emotions?.Sadness === 4 && fields(d[today]) === fields({ emotions: { Joy: 4 }, urges: {}, note: 'Tea with a friend.' }), `stored at the end: ${JSON.stringify({ y: fields(d[y]), today: fields(d[today]) })}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-past-day-two-tabs'(h) {
    const { storage, now, today, y } = seeded(h);
    const { ctx, page: a, errors } = await h.open(storage, '?mute', undefined, at(now));
    try {
      await openDiary(h, a);
      const b = await ctx.newPage();
      b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
      await b.goto(h.server.url + '/?mute');
      await openDiary(h, b);
      for (const p of [a, b]) {
        await p.bringToFront();
        await dayBtn(p, 'Earlier day').click();
        await titled(p, y);
      }
      await a.bringToFront();
      await a.locator('.dq-today').getByRole('radio', { name: 'Fear or anxiety: 2', exact: true }).click();
      await save(a).click();
      await b.locator('.dq-today [role=radio][aria-label="Fear or anxiety: 2"][aria-checked=true]').waitFor({ timeout: 5000 });
      await b.bringToFront();
      await noteBox(b).fill('Rain all day.');
      await save(b).click();
      await a.waitForFunction(() => document.querySelector('.dq-today .dq-field input')?.value === 'Rain all day.', null, { timeout: 5000 });
      for (const [n, p] of [['A', a], ['B', b]]) {
        const c = await card(p);
        h.expect(c.title === label(y) && ['Sadness: 3', 'Fear or anxiety: 2', 'Restless: 2', `${URGE}: 1`].every((r) => c.rated.includes(r)), `tab ${n}'s card: ${JSON.stringify(c)}`);
      }
      const d = await stored(h, a);
      h.expect(fields(d[y]) === fields({ emotions: { Sadness: 3, Restless: 2, 'Fear or anxiety': 2 }, urges: { [URGE]: 1 }, note: 'Rain all day.' }), `yesterday as stored: ${fields(d[y])}`);
      h.expect(fields(d[today]) === fields({ emotions: { Joy: 4 }, urges: {}, note: 'Tea with a friend.' }), `today as stored: ${fields(d[today])}`);
      await h.shot(b, 'diary-past-day-two-tabs');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-past-day-crystal'(h) {
    const { storage, now, today } = seeded(h);
    const d2 = addDays(today, -2);
    const { ctx, page, errors } = await h.open(storage, '?mute', undefined, at(now));
    let fresh;
    try {
      await openDiary(h, page);
      await dayBtn(page, 'Earlier day').click();
      await dayBtn(page, 'Earlier day').click();
      await titled(page, d2);
      // an empty earlier day is an open page: nothing rated, no skills line, nothing about a gap
      const c = await card(page);
      h.expect(!c.rated.length && c.skills === null && !/skills/i.test(c.text) && (await noteBox(page).inputValue()) === '', `the empty day: ${JSON.stringify(c)}`);
      h.expect(!/miss|skip|streak|gap|empty|nothing/i.test(c.text), `the empty day's words: ${c.text}`);
      h.expect((await noteBox(page).getAttribute('placeholder')) === 'A note for this day (optional)', `the empty day's note prompt: ${await noteBox(page).getAttribute('placeholder')}`);
      await h.shot(page, 'diary-past-day-empty-390');
      await page.locator('.dq-today').getByRole('radio', { name: 'Anger: 1', exact: true }).click();
      await noteBox(page).fill('Quiet day.');
      await save(page).click();
      await said(page).filter({ hasText: `Saved to ${label(d2)}` }).waitFor({ timeout: 5000 });
      const kept = await stored(h, page);
      h.expect(kept[d2]?.emotions?.Anger === 1 && kept[d2]?.note === 'Quiet day.' && kept[d2]?.ft?.note > 0, `the day as stored: ${JSON.stringify(kept[d2])}`);
      await home(page);
      const file = await crystal(h, page, 'diary-past-day-crystal');
      h.expect(JSON.stringify(file.diary?.[d2]) === JSON.stringify(kept[d2]), `the Save Crystal's copy of the day: ${JSON.stringify(file.diary?.[d2])}`);

      fresh = await h.open(returning(h, 0), '?mute', undefined, at(now));
      const said2 = await restore(h, fresh.page, file, 'diary-past-day-crystal.json');
      h.expect(/Restored/.test(said2), `restoring said: ${said2}`);
      const back = await stored(h, fresh.page);
      for (const day of [d2, addDays(today, -1), today]) h.expect(JSON.stringify(back[day]) === JSON.stringify(kept[day]), `${day} after the restore: ${JSON.stringify(back[day])} (was ${JSON.stringify(kept[day])})`);
      await openDiary(h, fresh.page);
      await dayBtn(fresh.page, 'Earlier day').click();
      await dayBtn(fresh.page, 'Earlier day').click();
      await titled(fresh.page, d2);
      const r = await card(fresh.page);
      h.expect(r.rated.includes('Anger: 1') && (await noteBox(fresh.page).inputValue()) === 'Quiet day.', `the restored day: ${JSON.stringify(r)}`);
      h.expect(!errors.length && !fresh.errors.length, [...errors, ...fresh.errors].join('\n'));
    } finally {
      await fresh?.ctx.close();
      await ctx.close();
    }
  },

  async 'diary-past-day-fit'(h) {
    const now = Date.now();
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
      const { ctx, page, errors } = await boot(h, { width: vp.width / zoom, height: vp.height / zoom }, { prepare: at(now) });
      try {
        await page.evaluate(() => window.__daily.go({ name: 'diary' }));
        await route(page, 'diary');
        await settle(page);
        await dayBtn(page, 'Earlier day').click();
        await settle(page);
        await page.locator('.dq-today').scrollIntoViewIfNeeded();
        await h.shot(page, `diary-past-day-fit-${size}`);
        // the line after Save is body text, like every status line on the diary, and sits on screen clear of the buttons
        await save(page).click();
        await said(page).filter({ hasText: `Saved to ${label(addDays(dayOf(now), -1))}` }).waitFor({ timeout: 5000 });
        await settle(page);
        // it may come up with a smooth scroll: measured once in sight, or after 3 s
        await page.waitForFunction(() => {
          const m = document.querySelector('.dq-today .dq-hint[aria-live]').getBoundingClientRect();
          return m.top >= document.querySelector('.dq-top').getBoundingClientRect().bottom - 0.5 && m.bottom <= innerHeight + 0.5;
        }, null, { timeout: 3000 }).catch(() => {});
        const lines = await page.evaluate(() => {
          const out = [];
          for (const e of document.querySelectorAll('.dq-diary .dq-hint')) {
            const px = parseFloat(getComputedStyle(e).fontSize);
            if (px < 16) out.push(`status line "${e.textContent.trim() || '(empty)'}" is ${px} px`);
          }
          const m = document.querySelector('.dq-today .dq-hint[aria-live]').getBoundingClientRect();
          if (m.left < 0 || m.right > innerWidth + 0.5) out.push(`the line after Save is off screen: ${Math.round(m.left)} to ${Math.round(m.right)} of ${innerWidth}`);
          // in sight where Save was tapped, below the pinned top bar
          const top = document.querySelector('.dq-top').getBoundingClientRect().bottom;
          if (m.top < top - 0.5 || m.bottom > innerHeight + 0.5) out.push(`the line after Save is out of sight: ${Math.round(m.top)} to ${Math.round(m.bottom)}, the screen shows ${Math.round(top)} to ${innerHeight}`);
          for (const b of document.querySelectorAll('.dq-today .dq-actions button')) {
            const r = b.getBoundingClientRect();
            if (m.left < r.right && r.left < m.right && m.top < r.bottom && r.top < m.bottom) out.push(`the line after Save overlaps ${b.textContent.trim()}`);
          }
          return out;
        });
        problems.push(...lines.map((f) => `${size} ${f}`));
        if (zoom === 1) problems.push(...(await audit(page, PAGE, SKIP)).map((f) => `${size} ${f.kind} ${f.what} (${f.detail})`));
        else {
          const found = await page.evaluate(() => {
            const out = [];
            for (const s of [document.scrollingElement, document.querySelector('.dq')]) if (s.scrollWidth > s.clientWidth + 1) out.push(`scrolls sideways: ${s.scrollWidth} px in ${s.clientWidth}`);
            for (const e of [...document.querySelectorAll('.dq-today .dq-daynav button'), document.querySelector('.dq-top .dq-safe')]) {
              const r = e.getBoundingClientRect();
              if (r.left < 0 || r.right > innerWidth + 0.5 || !e.checkVisibility()) out.push(`${e.textContent.trim() || e.getAttribute('aria-label')} is off screen: ${Math.round(r.left)} to ${Math.round(r.right)} of ${innerWidth}`);
            }
            return out;
          });
          problems.push(...found.map((f) => `${size} ${f}`));
        }
        await said(page).scrollIntoViewIfNeeded();
        await h.shot(page, `diary-past-day-fit-${size}-saved`);
        h.expect(!errors.length, `${size}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!problems.length, `the earlier day's card does not fit:\n${problems.join('\n')}`);
  },
};
