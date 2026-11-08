import { settle } from './layout-fit.e2e.mjs';

const DAY = 864e5;
const dayOf = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const noonAgo = (now, ago) => {
  const d = new Date(`${dayOf(now)}T12:00:00`);
  d.setDate(d.getDate() - ago);
  return d.getTime();
};
const WEEK = [
  ['wise-mind', 1],
  ['opposite-action', 2],
  ['wise-mind', 2],
  ['tipp', 3, 'Yes'],
  ['opposite-action', 4, 'Not this time'],
  ['wise-mind', 6],
  ['radical-acceptance', 7, 'Yes'],
  ['radical-acceptance', 12, 'A little'],
];
const NARROW = [...WEEK, ['dear-man', 5]];
const OLDER = [
  ['radical-acceptance', 8, 'Yes'],
  ['wise-mind', 20],
];
const STEADY = 'Sable underlines Still Center. You keep coming back to it, Kit. That’s how a skill gets steady.';
const CLOSES = [
  ['again', [['wise-mind', 1], ['tipp', 2, 'Not this time'], ['wise-mind', 3]], STEADY],
  ['each', [['wise-mind', 1], ['tipp', 2]], 'Every one of those is real practice, Kit.'],
];
const QUIET = 'Sable says the log is quiet this week, and quiet is allowed. The Watch is glad you’re here, Kit.';
const BANNED = /\d|streak|in a row|missed|haven't|yet|again|should|try|days?\b|come back/i;
const ROW = '.w2-roster-row .w2-sh--sable';

function save(now, practice) {
  const ev = [];
  for (let i = 0; i < 14; i++) {
    const t = i ? noonAgo(now, i) : now - 1000;
    ev.push({ id: `v-${i}`, t, day: dayOf(t), k: 'visit', xp: 10 });
  }
  practice.forEach(([skill, ago, answer], i) => {
    const t = noonAgo(now, ago) + i * 60e3;
    ev.push({ id: `sk-${i}`, t, day: dayOf(t), k: 'skill', xp: 20, stat: 'sense', skill });
    if (answer) ev.push({ id: `fb-${i}`, t: t + 1000, day: dayOf(t), k: 'feedback', xp: 0, skill, data: { answer } });
  });
  ev.sort((a, b) => a.t - b.t);
  return { v: 1, created: now - 30 * DAY, events: ev, flags: { greetDay: dayOf(now), therapistLineShown: true } };
}

async function openWatch(h, practice, viewport, device) {
  const seed = {
    [h.SAVE]: JSON.stringify(save(Date.now(), practice)),
    [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
    'dbt.app.v1': h.SEEN,
  };
  const opened = await h.open(seed, '?mute', viewport, undefined, device);
  await h.reachHub(opened.page);
  await toWatch(opened.page);
  return opened;
}

async function toWatch(page) {
  await page.evaluate(() => window.__daily.go({ name: 'shadows' }));
  await page.locator(ROW).waitFor({ timeout: 10000 });
  await settle(page);
}

const progress = (page, key) =>
  page.evaluate((key) => {
    const st = window.__daily.store;
    const d = st.derived();
    return JSON.stringify({
      xp: d.xp,
      rank: d.rank,
      stats: d.stats,
      collection: [...d.collection].sort(),
      visits: d.visitDays,
      events: st.state.events.map((e) => e.id),
      saved: localStorage.getItem(key),
    });
  }, key);

const ids = (said) => said.log.map((l) => l.id).join(', ');

async function ask(page, within = ROW) {
  const panel = page.locator(within);
  await panel.locator('.w2-sable-ask').click();
  await panel.locator('.w2-sable-say .w2-sable-line').last().waitFor({ timeout: 10000 });
  return panel.evaluate((p) => ({
    lines: [...p.querySelectorAll('.w2-sable-say .w2-sable-line')].map((l) => l.textContent),
    log: [...p.querySelectorAll('.w2-sable-log li')].map((li) => ({
      id: li.dataset.skill,
      text: li.innerText.replace(/\s+/g, ' ').trim(),
      helped: !!li.querySelector('.w2-sable-h'),
    })),
  }));
}

const unseen = (page, within, frame) =>
  page.locator(`${within} .w2-sable-say`).evaluate((say, frame) => {
    const bad = [];
    if (document.activeElement !== say) {
      const at = document.activeElement?.className || document.activeElement?.tagName;
      bad.push(`focus is on ${at}, not Sable's answer`);
    }
    const r = say.getBoundingClientRect();
    const bar = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const f = frame && say.closest(frame).getBoundingClientRect();
    const box = { top: Math.max(bar, f ? f.top : 0), bottom: Math.min(innerHeight, f ? f.bottom : innerHeight) };
    if (r.top < box.top - 1 || r.top > box.bottom - 24) {
      const where = `${Math.round(box.top)} to ${Math.round(box.bottom)} px`;
      bad.push(`Sable's answer starts at ${Math.round(r.top)} px, outside the ${where} in view`);
    }
    return bad;
  }, frame);

const offPanel = (page, within) =>
  page.locator(within).evaluate((panel) => {
    const bad = [];
    const box = panel.getBoundingClientRect();
    const left = box.left + panel.clientLeft;
    const right = left + panel.clientWidth;
    const wide = document.documentElement.scrollWidth;
    if (wide > innerWidth) bad.push(`the page scrolls sideways (${wide} px in ${innerWidth})`);
    const part = panel.querySelector('.w2-sable');
    for (const e of [part, ...part.querySelectorAll('*')]) {
      const r = e.getBoundingClientRect();
      if (!r.width) continue;
      const name = e.className || e.tagName.toLowerCase();
      if (r.left < left - 0.5 || r.right > right + 0.5) {
        bad.push(`${name} runs ${Math.round(Math.max(left - r.left, r.right - right))} px past the panel`);
      }
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') {
        bad.push(`${name} clips its words`);
      }
    }
    const b = part.querySelector('.w2-sable-ask').getBoundingClientRect();
    if (b.height < 44 || b.width < 44) {
      bad.push(`Ask Sable is ${Math.round(b.width)}x${Math.round(b.height)} px, under 44`);
    }
    const walk = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()); ) {
      if (!n.data.trim()) continue;
      const size = parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (size < 16 && n.parentElement.closest('.w2-sable-say')) {
        bad.push(`"${n.data.trim().slice(0, 30)}" is ${size} px, under 16`);
      }
      for (const w of n.data.matchAll(/[^\s-]+-?/g)) {
        const range = document.createRange();
        range.setStart(n, w.index);
        range.setEnd(n, w.index + w[0].length);
        const rects = [...range.getClientRects()].filter((q) => q.width > 0);
        const lines = new Set(rects.map((q) => Math.round(q.top)));
        if (lines.size > 1) bad.push(`"${w[0]}" breaks across ${lines.size} lines`);
        if (rects.some((q) => q.left < left - 0.5 || q.right > right + 0.5)) bad.push(`"${w[0]}" runs past the panel`);
      }
    }
    return bad;
  });

const splitCounts = (page, within) =>
  page.locator(`${within} .w2-sable-log li`).evaluateAll((items) => {
    const lineOf = ({ node, at }) => {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      return Math.round(range.getBoundingClientRect().top);
    };
    const bad = [];
    for (const li of items) {
      const chars = [];
      const walk = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      for (let node; (node = walk.nextNode()); ) {
        for (let at = 0; at < node.data.length; at++) chars.push({ node, at });
      }
      const text = chars.map(({ node, at }) => node.data[at]).join('');
      for (const m of text.matchAll(/\d\s+\p{L}+/gu)) {
        const noun = chars[m.index + m[0].length - 1];
        if (lineOf(chars[m.index]) !== lineOf(noun)) bad.push(`"${m[0].replace(/\s+/, ' ')}" splits across lines`);
      }
    }
    return bad;
  });

export const scenarios = {
  'ask-sable-names-the-week': async (h) => {
    const { ctx, page, errors } = await openWatch(h, WEEK);
    try {
      await h.shot(page.locator(ROW), 'ask-sable-week-before');
      const before = await progress(page, h.SAVE);
      h.expect((await page.locator('.w2-sable-say').textContent()) === '', 'Sable spoke before being asked');
      const said = await ask(page);
      await h.shot(page.locator(ROW), 'ask-sable-week');
      h.expect(
        ids(said) === 'wise-mind, opposite-action, tipp',
        `Sable named ${ids(said)}, not this week's wise-mind, opposite-action and tipp, most practised first`,
      );
      const [wise, opposite, tipp] = said.log;
      h.expect(wise.text === 'Still Center Wise Mind, 3 times', `Wise Mind reads "${wise.text}"`);
      h.expect(
        opposite.text === 'Reverse Cast Opposite Action, twice' && !opposite.helped,
        `Opposite Action reads "${opposite.text}"${opposite.helped ? ', marked as helping after "Not this time"' : ''}`,
      );
      h.expect(tipp.text === 'Frost Rune TIPP, once You said it helped.' && tipp.helped, `TIPP reads "${tipp.text}"`);
      h.expect(
        said.lines.at(-1) === 'Sable underlines Frost Rune. It helped, so it’s one to keep close, Kit.',
        `Sable's last line is "${said.lines.at(-1)}"`,
      );
      h.expect(!said.lines.join(' ').includes('{'), 'a name token was left unfilled');
      h.expect((await progress(page, h.SAVE)) === before, 'asking Sable changed the save, XP or a stat');

      const again = await ask(page);
      h.expect(JSON.stringify(again) === JSON.stringify(said), 'asking twice gave a different answer');
      h.expect((await progress(page, h.SAVE)) === before, 'asking Sable twice changed the save, XP or a stat');

      await page.reload();
      await h.reachHub(page);
      await toWatch(page);
      const quietAfterReload = (await page.locator('.w2-sable-say').textContent()) === '';
      h.expect(quietAfterReload, 'after a reload Sable speaks without being asked');
      h.expect(!(await page.locator('.dq-sw').count()), 'a reload after asking Sable opened a window');
      const kept = JSON.parse(await progress(page, h.SAVE));
      const was = JSON.parse(before);
      const lasting = (p) => JSON.stringify([p.xp, p.rank, p.stats, p.collection, p.events]);
      h.expect(lasting(kept) === lasting(was), 'XP, a stat or the log moved after asking and a reload');
      const reloaded = await ask(page);
      h.expect(JSON.stringify(reloaded) === JSON.stringify(said), 'after a reload Sable says something different');
      h.expect(!errors.length, errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  'ask-sable-quiet-week': async (h) => {
    for (const [tag, practice] of [['older', OLDER], ['empty', []]]) {
      const { ctx, page, errors } = await openWatch(h, practice);
      try {
        const before = await progress(page, h.SAVE);
        const said = await ask(page);
        await h.shot(page.locator(ROW), `ask-sable-${tag}`);
        h.expect(!said.log.length, `${tag}: Sable listed ${ids(said)} from outside this week`);
        h.expect(said.lines.length === 1 && said.lines[0] === QUIET, `${tag}: Sable says "${said.lines.join(' / ')}"`);
        h.expect(!BANNED.test(said.lines[0]), `${tag}: the quiet line counts, nudges or blames: "${said.lines[0]}"`);
        h.expect((await progress(page, h.SAVE)) === before, `${tag}: asking Sable changed the save, XP or a stat`);
        h.expect(!errors.length, `${tag}: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  'ask-sable-closing-lines': async (h) => {
    for (const [tag, practice, want] of CLOSES) {
      const { ctx, page, errors } = await openWatch(h, practice);
      try {
        const said = await ask(page);
        await h.shot(page.locator(ROW), `ask-sable-${tag}`);
        h.expect(ids(said) === 'wise-mind, tipp', `${tag}: Sable named ${ids(said)}`);
        h.expect(!said.log.some((l) => l.helped), `${tag}: a skill no one said helped is marked as helping`);
        h.expect(said.lines.at(-1) === want, `${tag}: Sable's last line is "${said.lines.at(-1)}", not "${want}"`);
        h.expect(!errors.length, `${tag}: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  'ask-sable-fits': async (h) => {
    const failed = [];
    for (const phone of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      for (const zoom of [1, 2]) {
        const size = `${phone.width}x${phone.height} at ${zoom * 100}%`;
        const viewport = { width: phone.width / zoom, height: phone.height / zoom };
        const { ctx, page, errors } = await openWatch(h, NARROW, viewport, { reducedMotion: 'reduce' });
        const note = (where) => (bad) => failed.push(...bad.map((b) => `${size}, ${where}: ${b}`));
        const fits = async (within, where) => {
          note(where)(await offPanel(page, within));
          note(where)(await splitCounts(page, within));
        };
        try {
          await page.locator(ROW).scrollIntoViewIfNeeded();
          await h.shot(page, `ask-sable-${phone.width}-${zoom * 100}-before`);
          await ask(page, ROW);
          await page.waitForFunction(
            (sel) => getComputedStyle(document.querySelector(sel)).opacity === '1',
            `${ROW} .w2-sable-say`,
            { timeout: 10000 },
          );
          note('in the row')(await unseen(page, ROW));
          await h.shot(page, `ask-sable-${phone.width}-${zoom * 100}`);
          const voice = await page.locator(`${ROW} .w2-sable-log li[data-skill="dear-man"] .w2-sable-n`).textContent();
          if (voice !== 'Commander’s Voice') failed.push(`${size}: Commander's Voice reads "${voice}"`);
          await fits(ROW, 'in the row');
          const safe = await page.locator('.dq-safe').isVisible();
          h.expect(safe, `${size}: the Safe Zone is not one tap away beside Sable`);
          await page.locator('.w2-camp').scrollIntoViewIfNeeded();
          await page.locator('.w2-camp.is-scene-live').waitFor({ timeout: 15000 });
          await page.locator('.w2-camp-hit[data-shadow="sable"]').click();
          const card = '.w2-camp-card .w2-sh--sable';
          await page.locator(card).waitFor({ timeout: 10000 });
          await ask(page, card);
          note("in Sable's card")(await unseen(page, card, '.w2-camp-card'));
          await h.shot(page, `ask-sable-${phone.width}-${zoom * 100}-card`);
          await fits(card, "in Sable's card");
          if (errors.length) failed.push(`${size}: ${errors.join(' | ')}`);
        } finally {
          await ctx.close();
        }
      }
    }
    h.expect(!failed.length, failed.join('\n'));
  },
};
