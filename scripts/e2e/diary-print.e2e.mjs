// Print a week of the diary card: a clean page for a therapist, printed or saved as a PDF from the browser's own print
// window. On a returning save with a name chosen, days rated across two weeks, skills practised and a note:
//   diary-print-week      a day changed through the diary's Earlier day shows on the page as changed: each rated row by
//                         day (a row today's card no longer has too, 0 as 0 and blank as blank), each day's skills and
//                         note, the chosen name and nothing that counts or scores. Print or save as PDF opens the print
//                         window. Printed, in every Wardrobe look and with the ratings focused, the page is all that
//                         shows, black on white with nothing under or around the words, at least 9 pt, inside an A4 page's width; as a PDF on A4 and on Letter
//                         with background graphics on, it is one or two pages of real text. Earlier week
//                         shows the week before and hands focus on as it goes, Back from the Safe Zone keeps that week,
//                         and the keyboard reaches every control. Nothing is requested from any other address, nothing
//                         at all once the page is open, and the save is as it was
//   diary-print-no-name   with no name chosen and no earlier days, the page names no one, the week can't go earlier,
//                         and every day reads as an open column
//   diary-print-two-tabs  with the ratings focused, their last row removed in another open copy takes them off the page
//                         there, and focus moves on to Print
//   diary-print-fit       with the longest, widest name the game keeps, the page passes layout-fit's checks at 390x844,
//                         320x568 and 844x390, every word on it (the week's heading and the buttons too) is at least
//                         16 px, every word but the ratings (which scroll in their own box) is on screen, and at 200% zoom
//                         nothing scrolls sideways and the week buttons, Print and the Safe Zone button are on screen
// Each scenario runs on one fixed time, so today never turns over partway.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, dayOf, returning, route } from './first-actions.e2e.mjs';
import { audit, boot, PAGE, settle, SKIP } from './layout-fit.e2e.mjs';

const URGE = 'Urge to give up on today';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return { dow: DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], d, mon: MON[m - 1], y };
};
const label = (day) => `${parts(day).dow} ${parts(day).d} ${parts(day).mon}`;
const span = (from, to) => {
  const a = parts(from), b = parts(to);
  return `${a.d} ${a.mon}${a.y === b.y ? '' : ` ${a.y}`} to ${b.d} ${b.mon} ${b.y}`;
};
const week = (end) => Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
// every look the Wardrobe has, as the game lists them
const looks = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/content/roster-lines.ts'), 'utf8');
const idsOf = (name) => JSON.parse(looks.match(new RegExp(`${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));
const LOOKS = { themes: idsOf('THEME_IDS'), accents: idsOf('ACCENT_IDS') };
// counting, scoring or gap words a page of what was entered must never hold
const COUNTING = /miss|skip|streak|in a row|gap|XP|level|rank|score|average|trend|\d+ (days|of 7)/i;

/** Every page in a scenario reads one fixed time, and the print window only notes that it was asked for. */
const prepared = (now) => async (ctx) => {
  await ctx.clock.setFixedTime(new Date(now));
  await ctx.addInitScript(() => {
    window.__printed = 0;
    window.print = () => window.__printed++;
  });
};

/** A returning save with a name, two weeks of diary days (one on a row the card no longer has), skills and notes. */
function seeded(h) {
  const now = Date.now();
  const today = dayOf(now), y = addDays(today, -1), d3 = addDays(today, -3), old = addDays(today, -9);
  const storage = returning(h, 10);
  const save = JSON.parse(storage[h.SAVE]);
  save.events.push(
    { id: 'pr-s1', k: 'skill', xp: 20, t: now - 86400e3, day: y, stat: 'sense', skill: 'wise-mind' },
    { id: 'pr-s2', k: 'skill', xp: 20, t: now - 3 * 86400e3, day: d3, stat: 'stamina', skill: 'tipp' },
    { id: 'pr-f2', k: 'feedback', xp: 0, t: now - 3 * 86400e3 + 60e3, day: d3, skill: 'tipp', data: { answer: 'Yes' } },
    { id: 'pr-s3', k: 'skill', xp: 20, t: now - 9 * 86400e3, day: old, stat: 'intelligence', skill: 'opposite-action' },
  );
  save.diary = {
    [old]: { day: old, emotions: { Sadness: 2 }, urges: { [URGE]: 3 }, note: 'Long week at work.', updatedAt: now - 9 * 86400e3 },
    [d3]: { day: d3, emotions: { Anger: 0, Shame: 1 }, urges: {}, note: '', updatedAt: now - 3 * 86400e3 },
    [y]: { day: y, emotions: { Sadness: 3, Restless: 2 }, urges: { [URGE]: 1 }, note: 'Walked to the river.', updatedAt: now - 86400e3 },
    [today]: { day: today, emotions: { Joy: 4 }, urges: {}, note: 'Tea with a friend.', updatedAt: now - 60e3 },
  };
  storage[h.SAVE] = JSON.stringify(save);
  storage[h.YOU] = JSON.stringify({ name: 'Robin', companion: '', nameAt: now - 3600e3, companionAt: 0 });
  return { storage, now, today, y, d3, old };
}

async function openDiary(h, page) {
  await h.reachHub(page);
  await page.locator('.dq-tile', { hasText: 'Diary card' }).click();
  await route(page, 'diary');
  await page.locator('.dq-today').waitFor();
}
const weekBtn = (page, name) => page.locator('.dq-printweek .dq-daynav').getByRole('button', { name, exact: true });
const printBtn = (page) => page.getByRole('button', { name: 'Print or save as PDF', exact: true });
const titled = (page, text) => page.waitForFunction((t) => document.querySelector('.dq-printweek .dq-chip-t')?.textContent === t, text, { timeout: 5000 });
const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent.trim() || document.activeElement?.tagName);
/** The page as it reads now: its head lines, the days across the top, each rated row by day, and each day's lines. */
const sheet = (page) =>
  page.evaluate(() => {
    const s = document.querySelector('.dq-paper');
    const shown = (e) => !!e && e.checkVisibility();
    return {
      title: s.querySelector('.dq-paper-t')?.textContent,
      meta: [...s.querySelectorAll('.dq-paper-meta')].map((e) => e.textContent),
      days: [...s.querySelectorAll('thead th')].map((th) => [...th.children].map((c) => c.textContent).join(' ')),
      groups: [...s.querySelectorAll('.dq-paper-group')].map((g) => g.textContent),
      rows: Object.fromEntries([...s.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('th[scope=row]')).map((tr) => [tr.querySelector('th').textContent, [...tr.querySelectorAll('td')].map((td) => td.textContent)])),
      perDay: [...s.querySelectorAll('.dq-paper-days li')].map((li) => [...li.children].map((c) => c.textContent)),
      text: s.innerText,
      week: document.querySelector('.dq-printweek .dq-chip-t').textContent,
      buttons: [...document.querySelectorAll('.dq-printweek button')].filter(shown).map((b) => b.textContent.trim()),
    };
  });
/** A PDF's pages, each page's size in points, and the fonts its text is set in. */
function pdfPages(buf) {
  const s = buf.toString('latin1');
  const boxes = [...s.matchAll(/\/Type\s*\/Page\b(?!s)[\s\S]*?\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Math.round(m[3] - m[1]), Math.round(m[4] - m[2])]);
  const fonts = [...new Set([...s.matchAll(/\/FontName\s*\/(?:[A-Z]{6}\+)?([\w-]+)/g)].map((m) => m[1]))];
  return { count: (s.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length, boxes, fonts };
}

/** Run in the page with print styles on: what keeps the printed page from being the page alone, black on white, the type
 * at least 9 pt, and the whole width inside an A4 page. */
function paperProblems() {
  const out = [];
  const s = document.querySelector('.dq-paper');
  for (const e of document.body.querySelectorAll('*')) if (!s.contains(e) && !e.contains(s) && e.checkVisibility()) out.push(`${e.tagName.toLowerCase()}.${e.className} shows`);
  // nothing drawn over, under or around the words: the panel's ticks, texture and fill, a glow or the focus ring would
  // cover them or waste ink on paper
  const printed = [...s.querySelectorAll('*')];
  for (let e = s; e; e = e.parentElement) printed.push(e);
  for (const e of printed) {
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(e, pseudo);
      if (ps.display !== 'none' && !/^(none|normal)$/.test(ps.content)) out.push(`${e.tagName.toLowerCase()}.${e.className}${pseudo} prints`);
    }
    const cs = getComputedStyle(e);
    if (cs.backgroundImage !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) out.push(`${e.tagName.toLowerCase()}.${e.className} has a background: ${cs.backgroundColor} ${cs.backgroundImage.slice(0, 40)}`);
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) out.push(`${e.tagName.toLowerCase()}.${e.className} has an outline: ${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`);
    if (cs.boxShadow !== 'none' || cs.textShadow !== 'none') out.push(`${e.tagName.toLowerCase()}.${e.className} has a shadow: ${cs.boxShadow} ${cs.textShadow}`);
  }
  for (let e = s; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed' || cs.position === 'absolute' || cs.overflow !== 'visible') out.push(`${e.tagName.toLowerCase()}.${e.className} is ${cs.position}, overflow ${cs.overflow}`);
  }
  const walk = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent.trim()) continue;
    const cs = getComputedStyle(n.parentElement);
    if (cs.color !== 'rgb(0, 0, 0)') out.push(`"${n.textContent.trim()}" is ${cs.color}`);
    if (parseFloat(cs.fontSize) < 12) out.push(`"${n.textContent.trim()}" is ${cs.fontSize}`);
  }
  const r = s.getBoundingClientRect();
  for (const e of s.querySelectorAll('*')) {
    const b = e.getBoundingClientRect();
    if (b.width && (b.left < r.left - 0.5 || b.right > r.right + 0.5)) out.push(`${e.tagName.toLowerCase()} reaches past the page: ${Math.round(b.left)} to ${Math.round(b.right)} of ${Math.round(r.left)} to ${Math.round(r.right)}`);
  }
  if (r.width < 690) out.push(`the page is ${Math.round(r.width)} px wide on paper`);
  return out;
}

export const scenarios = {
  async 'diary-print-week'(h) {
    const { storage, now, today, y, d3, old } = seeded(h);
    const { ctx, page, errors } = await h.open(storage, '?mute', undefined, prepared(now));
    const own = new URL(h.server.url).origin;
    const outside = [];
    let asked = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (!['data:', 'blob:'].includes(u.protocol) && u.origin !== own) outside.push(r.url());
      asked.push(r.url());
    });
    try {
      await openDiary(h, page);
      // yesterday changed the way the diary changes an earlier day: a rating and the note, then Save
      await page.locator('.dq-today .dq-daynav').getByRole('button', { name: 'Earlier day', exact: true }).click();
      await page.waitForFunction((t) => document.querySelector('.dq-today .dq-chip-t')?.textContent === t, label(y), { timeout: 5000 });
      await page.locator('.dq-today').getByRole('radio', { name: 'Sadness: 4', exact: true }).click();
      await page.locator('.dq-today').getByRole('textbox', { name: 'One line, optional' }).fill('Walked to the river. Slept well.');
      await page.locator('.dq-today').getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-today .dq-hint[aria-live]').filter({ hasText: `Saved to ${label(y)}` }).waitFor({ timeout: 5000 });
      const before = await h.ls(page, h.SAVE);

      await page.locator('.dq-export').getByRole('button', { name: 'Print a week', exact: true }).click();
      await route(page, 'print');
      await page.locator('.dq-paper').waitFor();
      asked = [];
      let s = await sheet(page);
      const days = week(today);
      h.expect(s.week === span(days[0], today) && s.title === 'DBT diary card' && JSON.stringify(s.meta) === JSON.stringify(['Name: Robin', span(days[0], today)]), `the page's head: ${JSON.stringify({ week: s.week, title: s.title, meta: s.meta })}`);
      h.expect(JSON.stringify(s.days) === JSON.stringify(days.map((d) => `${parts(d).dow} ${parts(d).d}`)), `the days across the top: ${JSON.stringify(s.days)}`);
      h.expect(JSON.stringify(s.groups) === JSON.stringify(['Feelings, 0 to 5', 'Urges, 0 to 5']), `the row groups: ${JSON.stringify(s.groups)}`);
      const want = {
        Sadness: ['', '', '', '', '', '4', ''],
        'Fear or anxiety': ['', '', '', '', '', '', ''],
        Anger: ['', '', '', '0', '', '', ''],
        Shame: ['', '', '', '1', '', '', ''],
        Joy: ['', '', '', '', '', '', '4'],
        Restless: ['', '', '', '', '', '2', ''],
        [URGE]: ['', '', '', '', '', '1', ''],
      };
      h.expect(JSON.stringify(s.rows) === JSON.stringify(want), `the rated rows by day:\n${JSON.stringify(s.rows)}\nwanted\n${JSON.stringify(want)}`);
      const wantDays = days.map((d) => [label(d)]);
      wantDays[3].push('Skills: TIPP (helped)');
      wantDays[5].push('Skills: Wise Mind (practised)', 'Note: Walked to the river. Slept well.');
      wantDays[6].push('Note: Tea with a friend.');
      h.expect(JSON.stringify(s.perDay) === JSON.stringify(wantDays), `each day's skills and note:\n${JSON.stringify(s.perDay)}\nwanted\n${JSON.stringify(wantDays)}`);
      h.expect(!COUNTING.test(s.text) && !/Long week|Opposite Action/.test(s.text), `the page holds more than what was entered that week: ${s.text}`);
      h.expect(JSON.stringify(s.buttons) === JSON.stringify(['Earlier week', 'Print or save as PDF']), `the buttons on this week: ${JSON.stringify(s.buttons)}`);
      h.expect(await page.locator('.dq-top .dq-safe').isVisible(), 'the Safe Zone button is not on the print page');
      await h.shot(page, 'diary-print-week-390');

      // by keyboard: the heading, then Earlier week, Print, and the ratings, which scroll on a narrow screen
      await page.waitForFunction(() => document.activeElement?.matches('.dq-print h1'), null, { timeout: 5000 });
      const order = [];
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
        order.push(await focused(page));
      }
      h.expect(JSON.stringify(order) === JSON.stringify(['Earlier week', 'Print or save as PDF', 'Ratings, day by day']), `Tab from the heading goes ${JSON.stringify(order)}`);
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Enter');
      h.expect((await page.evaluate(() => window.__printed)) === 1, `Print or save as PDF opened the print window ${await page.evaluate(() => window.__printed)} times`);
      // printed with the ratings focused from the keyboard, as they are while a narrow screen scrolls them
      await page.keyboard.press('Tab');
      h.expect((await focused(page)) === 'Ratings, day by day' && (await page.locator('.dq-paper-scroll').evaluate((e) => e.matches(':focus-visible'))), `printing with ${await focused(page)} focused`);

      // printed, in every look the Wardrobe has: the page alone, black on white, the type at least 9 pt, inside an A4 page
      await page.emulateMedia({ media: 'print' });
      await page.setViewportSize({ width: 703, height: 1032 });
      const worn = await page.evaluate(() => ({ ...document.documentElement.dataset }));
      const paper = [];
      for (const theme of LOOKS.themes) {
        for (const accent of LOOKS.accents) {
          await page.evaluate(([t, a]) => Object.assign(document.documentElement.dataset, { dqTheme: t, dqAccent: a }), [theme, accent]);
          paper.push(...(await page.evaluate(paperProblems)).map((f) => `${theme} ${accent}: ${f}`));
        }
      }
      h.expect(!paper.length, `printed, the page is not clean:\n${paper.slice(0, 20).join('\n')}`);
      await h.shot(page, 'diary-print-week-printed');
      // the PDFs in the look with the most colour, with the print window's background graphics on
      for (const format of ['A4', 'Letter']) {
        const pdf = await page.pdf({ format, printBackground: true });
        fs.writeFileSync(path.join(h.out, `diary-print-week-${format}.pdf`), pdf);
        const got = pdfPages(pdf);
        const size = format === 'A4' ? [595, 842] : [612, 792];
        h.expect(got.count >= 1 && got.count <= 2, `${format}: ${got.count} pages`);
        h.expect(got.boxes.length === got.count && got.boxes.every((b) => Math.abs(b[0] - size[0]) <= 2 && Math.abs(b[1] - size[1]) <= 2), `${format} page sizes: ${JSON.stringify(got.boxes)}`);
        h.expect(got.fonts.some((f) => /Jost/i.test(f)), `${format}: no text set in Jost, fonts ${JSON.stringify(got.fonts)}`);
      }
      await page.evaluate((d) => {
        for (const k of ['dqTheme', 'dqAccent']) delete document.documentElement.dataset[k];
        Object.assign(document.documentElement.dataset, d);
      }, worn);
      await page.emulateMedia({ media: 'screen' });
      await page.setViewportSize({ width: 390, height: 844 });

      // the week before, which is as far back as this save goes; focus moves on from the button that goes
      const prev = week(addDays(today, -7));
      await weekBtn(page, 'Earlier week').focus();
      await page.keyboard.press('Enter');
      await titled(page, span(prev[0], prev[6]));
      h.expect((await focused(page)) === 'Later week', `focus after Earlier week is on ${await focused(page)}`);
      s = await sheet(page);
      h.expect(JSON.stringify(s.buttons) === JSON.stringify(['Later week', 'This week', 'Print or save as PDF']), `the buttons on the week before: ${JSON.stringify(s.buttons)}`);
      const at = prev.indexOf(old);
      h.expect(s.rows.Sadness?.[at] === '2' && s.rows[URGE]?.[at] === '3' && !s.rows.Restless && s.rows.Joy?.every((v) => v === ''), `the week before's rows: ${JSON.stringify(s.rows)}`);
      h.expect(JSON.stringify(s.perDay[at]) === JSON.stringify([label(old), 'Skills: Opposite Action (practised)', 'Note: Long week at work.']), `the week before's day: ${JSON.stringify(s.perDay[at])}`);
      await h.shot(page, 'diary-print-week-before-390');

      // the Safe Zone and back: the same week
      await page.locator('.dq-top .dq-safe').click();
      await route(page, 'safe');
      await page.goBack();
      await route(page, 'print');
      await titled(page, span(prev[0], prev[6]));
      await weekBtn(page, 'This week').click();
      await titled(page, span(days[0], today));

      h.expect(!outside.length, `requests to another address: ${outside.join('\n')}`);
      h.expect(!asked.length, `requests once the page was open: ${asked.join('\n')}`);
      h.expect((await h.ls(page, h.SAVE)) === before, 'printing changed the save');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-print-no-name'(h) {
    const now = Date.now();
    const today = dayOf(now);
    const { ctx, page, errors } = await h.open(returning(h, 0), '?mute', undefined, prepared(now));
    try {
      await openDiary(h, page);
      await page.locator('.dq-export').getByRole('button', { name: 'Print a week', exact: true }).click();
      await route(page, 'print');
      const s = await sheet(page);
      const days = week(today);
      h.expect(JSON.stringify(s.meta) === JSON.stringify([span(days[0], today)]) && !/Player|Name/.test(s.text), `with no name chosen the page reads: ${JSON.stringify(s.meta)}`);
      h.expect(JSON.stringify(s.buttons) === JSON.stringify(['Print or save as PDF']), `the buttons on a new save: ${JSON.stringify(s.buttons)}`);
      h.expect(Object.values(s.rows).flat().every((v) => v === '') && Object.keys(s.rows).length === 6, `the rows on a new save: ${JSON.stringify(s.rows)}`);
      h.expect(JSON.stringify(s.perDay) === JSON.stringify(days.map((d) => [label(d)])), `the days on a new save: ${JSON.stringify(s.perDay)}`);
      h.expect(!COUNTING.test(s.text), `the open page's words: ${s.text}`);
      await h.shot(page, 'diary-print-no-name-390');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-print-two-tabs'(h) {
    const now = Date.now();
    const { ctx, page: a, errors } = await h.open(returning(h, 0, { settings: { emotionRows: ['Sadness'], urgeRows: [] } }), '?mute', undefined, prepared(now));
    try {
      await openDiary(h, a);
      await a.locator('.dq-export').getByRole('button', { name: 'Print a week', exact: true }).click();
      await route(a, 'print');
      await printBtn(a).focus();
      await a.keyboard.press('Tab');
      h.expect((await focused(a)) === 'Ratings, day by day', `before: focus is on ${await focused(a)}`);
      const b = await ctx.newPage();
      b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
      await b.goto(h.server.url + '/?mute');
      await openDiary(h, b);
      await b.locator('.dq-today').getByRole('button', { name: 'Edit rows', exact: true }).click();
      await b.getByRole('button', { name: 'Remove Sadness', exact: true }).click();
      await a.bringToFront();
      await a.locator('.dq-paper-scroll').waitFor({ state: 'detached', timeout: 5000 });
      const s = await sheet(a);
      h.expect(!Object.keys(s.rows).length && !s.groups.length && s.perDay.length === 7, `the page once the last row went: ${JSON.stringify(s)}`);
      h.expect((await focused(a)) === 'Print or save as PDF', `focus once the ratings went is on ${await focused(a)}`);
      await h.shot(a, 'diary-print-two-tabs');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-print-fit'(h) {
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
      const { ctx, page, errors } = await boot(h, { width: vp.width / zoom, height: vp.height / zoom }, { prepare: (ctx) => ctx.clock.setFixedTime(new Date(now)) });
      try {
        // the longest name the game keeps, in its widest letters
        await page.evaluate(([k, v]) => localStorage.setItem(k, v), [h.YOU, JSON.stringify({ name: 'W'.repeat(24), companion: 'Lumen', nameAt: now, companionAt: now })]);
        await page.reload();
        await h.reachHub(page);
        await page.evaluate(() => window.__daily.go({ name: 'print' }));
        await route(page, 'print');
        await settle(page);
        await h.shot(page, `diary-print-fit-${size}`);
        // every word on the screen is on it, apart from the ratings, which scroll in their own box
        const cut = await page.evaluate(() => {
          const out = [];
          const walk = document.createTreeWalker(document.querySelector('.dq-print'), NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('.dq-paper-scroll') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (!n.textContent.trim() || !n.parentElement.checkVisibility()) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            for (const r of range.getClientRects()) if (r.left < -0.5 || r.right > innerWidth + 0.5) out.push(`"${n.textContent.trim().slice(0, 40)}" runs off the screen: ${Math.round(r.left)} to ${Math.round(r.right)} of ${innerWidth}`);
          }
          return out;
        });
        problems.push(...cut.map((f) => `${size} ${f}`));
        h.expect((await page.locator('.dq-paper-meta').first().textContent()) === `Name: ${'W'.repeat(24)}`, `${size}: the long name is not on the page`);
        if (zoom === 1) {
          problems.push(...(await audit(page, PAGE, SKIP)).map((f) => `${size} ${f.kind} ${f.what} (${f.detail})`));
          const small = await page.evaluate(() => {
            const out = [];
            const walk = document.createTreeWalker(document.querySelector('.dq-print'), NodeFilter.SHOW_TEXT);
            for (let n = walk.nextNode(); n; n = walk.nextNode()) {
              const px = parseFloat(getComputedStyle(n.parentElement).fontSize);
              if (n.textContent.trim() && n.parentElement.checkVisibility() && px < 16) out.push(`"${n.textContent.trim().slice(0, 40)}" is ${px} px`);
            }
            return out;
          });
          problems.push(...small.map((f) => `${size} ${f}`));
          await page.locator('.dq-paper').scrollIntoViewIfNeeded();
          await h.shot(page, `diary-print-fit-${size}-page`);
        } else {
          const found = await page.evaluate(() => {
            const out = [];
            for (const s of [document.scrollingElement, document.querySelector('.dq')]) if (s.scrollWidth > s.clientWidth + 1) out.push(`scrolls sideways: ${s.scrollWidth} px in ${s.clientWidth}`);
            for (const e of [...document.querySelectorAll('.dq-printweek button')].filter((b) => b.checkVisibility()).concat(document.querySelector('.dq-top .dq-safe'))) {
              const r = e.getBoundingClientRect();
              if (r.left < 0 || r.right > innerWidth + 0.5 || !e.checkVisibility()) out.push(`${e.textContent.trim() || e.getAttribute('aria-label')} is off screen: ${Math.round(r.left)} to ${Math.round(r.right)} of ${innerWidth}`);
            }
            return out;
          });
          problems.push(...found.map((f) => `${size} ${f}`));
        }
        h.expect(!errors.length, `${size}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!problems.length, `the print page does not fit:\n${problems.join('\n')}`);
  },
};
