import { settled } from './harness.mjs';
import path from 'node:path';

const CARRIER = [/carrier|network/i, /rates? may apply/i];
const FACTS = {
  us: {
    locale: 'en-US',
    sos: ['tel:911'],
    lines: {
      'Crisis Text Line': {
        actions: [{ to: 'sms:741741', body: 'HOME', note: [...CARRIER, /message and data/i] }],
        says: ['741741', 'HOME', '24/7', /free support/i],
      },
      'National Domestic Violence Hotline': {
        actions: [{ to: 'tel:18007997233' }, { to: 'sms:88788', body: 'START', note: [...CARRIER, /message and data/i] }],
        says: ['1-800-799-7233', '88788', 'START', '24/7', /free, confidential support/i],
      },
    },
    kept: { '988 Suicide & Crisis Lifeline': [{ to: 'tel:988' }, { to: 'sms:988' }] },
  },
  ie: {
    locale: 'en-IE',
    sos: ['tel:112', 'tel:999'],
    lines: {
      'Text About It': {
        actions: [
          { to: 'sms:50808', body: 'HELLO', note: [/free to text/i, /main networks/i] },
          { to: 'sms:0861800280', body: 'HELLO', note: [/\b48\b/, /An Post/, /Clear Mobile/, /standard text rate may apply/i] },
        ],
        says: ['spunout', '50808', '086 1800 280', 'HELLO', '24/7', /free support/i],
        never: [/anonymous/i, /Text 50808/],
      },
    },
    kept: { Samaritans: [{ to: 'tel:116123' }], "Women's Aid": [{ to: 'tel:1800341900' }] },
  },
  au: {
    locale: 'en-AU',
    sos: ['tel:000'],
    lines: {
      '1800RESPECT': {
        actions: [
          { to: 'tel:1800737732', note: [/landlines/i, /payphones/i, /most mobiles/i, /some mobile carriers charge/i] },
          { to: 'sms:0458737732', note: [...CARRIER, /standard text rates/i] },
        ],
        says: ['1800 737 732', '0458 737 732', '24/7', /free, confidential support/i],
      },
    },
    kept: { Lifeline: [{ to: 'tel:131114' }, { to: 'sms:0477131114' }] },
  },
};
const SIZES = { '390x844': { width: 390, height: 844 }, '320x568': { width: 320, height: 568 }, '844x390': { width: 844, height: 390 }, '1280x800': { width: 1280, height: 800 } };

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const returning = () => {
  const t = Date.now() - 86400e3;
  return JSON.stringify({ v: 1, created: t, events: [{ id: 'q8-visit', t, day: dayKey(t), k: 'visit', xp: 10 }], flags: { greetDay: dayKey(t) } });
};

async function boot(h, locale, viewport = SIZES['390x844']) {
  const ctx = await h.browser.newContext({ viewport, locale, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: returning() };
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  const outside = [];
  const origin = new URL(h.server.url).origin;
  ctx.on('request', (r) => {
    const u = r.url();
    if (!/^(data|blob):/.test(u) && new URL(u).origin !== origin) outside.push(u);
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(h.server.url + '/?mute');
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 60000 });
  return { ctx, page, errors, outside };
}

async function talk(page, { danger = false } = {}) {
  await page.locator('header .dq-safe').click();
  if (danger) await page.getByRole('button', { name: 'I might not be safe' }).click();
  else await page.locator('.dq-sz-talk').click();
  await page.locator('.dq-region select').waitFor();
  await settled(page, '.dq-safezone');
}

const target = (href) => {
  const [, scheme, rest] = /^(tel|sms):(.*)$/.exec(href) ?? [];
  if (!scheme) return null;
  const body = /[?&]body=([^&]*)/.exec(rest)?.[1];
  return { to: `${scheme}:${rest.split(/[?&;]/)[0]}`, body: body === undefined ? undefined : decodeURIComponent(body) };
};

const rows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.dq-safezone .dq-res')].map((row) => ({
      name: row.querySelector('.dq-res-n')?.textContent ?? '',
      how: row.querySelector('.dq-res-how')?.textContent ?? '',
      text: row.textContent.replace(/\s+/g, ' '),
      actions: [...row.querySelectorAll('a.dq-res-a')].map((a) => ({
        href: a.getAttribute('href'),
        describedBy: a.getAttribute('aria-describedby'),
        note: (a.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' '),
      })),
    })),
  );

const has = (text, fact) => (typeof fact === 'string' ? text.includes(fact) : fact.test(text));

function expectLine(h, label, row, want) {
  h.expect(!!row, `${label}: the row is missing`);
  if (!row) return;
  const got = row.actions.map((a) => ({ ...a, ...target(a.href) })).filter((a) => a.to);
  const shape = (list) => JSON.stringify(list.map((a) => [a.to, a.body ?? null]));
  h.expect(shape(got) === shape(want.actions), `${label}: buttons go to ${shape(got)}, want ${shape(want.actions)}`);
  if (want.actions.every((a) => a.to.startsWith('sms:'))) h.expect(!got.some((a) => a.to.startsWith('tel:')), `${label}: a text-only line shows a call button`);
  want.actions.forEach((w, i) => {
    if (!w.note) h.expect(!got[i]?.describedBy, `${label}: the ${w.to} button has a note ${JSON.stringify(got[i]?.note)} (aria-describedby ${JSON.stringify(got[i]?.describedBy)}), want none`);
    for (const fact of w.note ?? []) h.expect(has(got[i]?.note ?? '', fact), `${label}: the ${w.to} button's note ${JSON.stringify(got[i]?.note)} doesn't say ${fact}`);
  });
  for (const fact of want.says ?? []) h.expect(has(row.text, fact), `${label}: the row doesn't say ${fact}`);
  for (const fact of want.never ?? []) h.expect(!has(row.text, fact), `${label}: the row still says ${fact}`);
}

function expectRegion(h, id, list, label = id) {
  const facts = FACTS[id];
  for (const [name, want] of Object.entries(facts.lines)) expectLine(h, `${label} ${name}`, list.find((r) => r.name === name), want);
  for (const [name, actions] of Object.entries(facts.kept)) expectLine(h, `${label} ${name}`, list.find((r) => r.name === name), { actions });
}

function expectClean(h, label, { errors, outside }) {
  h.expect(!errors.length, `${label}: ${errors.join(' | ')}`);
  h.expect(!outside.length, `${label}: requests left the device before any link was followed: ${outside.join(', ')}`);
}

export const scenarios = {
  async 'support-numbers-facts'(h) {
    for (const id of Object.keys(FACTS)) {
      const b = await boot(h, FACTS[id].locale);
      try {
        await talk(b.page);
        expectRegion(h, id, await rows(b.page));
        expectClean(h, id, b);
      } finally {
        await b.ctx.close();
      }
    }
  },

  async 'support-numbers-danger-first'(h) {
    for (const id of Object.keys(FACTS)) {
      const b = await boot(h, FACTS[id].locale);
      try {
        await talk(b.page, { danger: true });
        const list = await rows(b.page);
        const first = list[0]?.actions.map((a) => target(a.href)?.to) ?? [];
        h.expect(JSON.stringify(first) === JSON.stringify(FACTS[id].sos), `${id}: first row dials ${JSON.stringify(first)}, want ${JSON.stringify(FACTS[id].sos)}`);
        expectRegion(h, id, list, `${id} danger`);
        if (id === 'ie') await h.shot(b.page, 'q8-danger-ie-390');
        expectClean(h, `${id} danger`, b);
      } finally {
        await b.ctx.close();
      }
    }
  },

  async 'support-numbers-screen-sizes'(h) {
    for (const [size, viewport] of Object.entries(SIZES)) {
      for (const id of Object.keys(FACTS)) {
        const b = await boot(h, FACTS[id].locale, viewport);
        try {
          await talk(b.page);
          await h.shot(b.page, `q8-talk-${id}-${size}`);
          for (const name of Object.keys(FACTS[id].lines)) {
            const row = b.page.locator('.dq-safezone .dq-res').filter({ has: b.page.locator('.dq-res-n', { hasText: name }) });
            await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
            await settled(b.page, '.dq-res');
            const m = await row.evaluate((el) => {
              const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
              const rowBox = box(el);
              const acts = [...el.querySelectorAll('a.dq-res-a')].map((a) => {
                a.scrollIntoView({ block: 'center', behavior: 'instant' });
                const r = box(a);
                const lands = [0.2, 0.5, 0.8].every((f) => a.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height * f)));
                const words = a.querySelector('span:last-child')?.firstChild;
                const from = words?.textContent.search(/\d/) ?? -1;
                const range = document.createRange();
                if (from >= 0) { range.setStart(words, from); range.setEnd(words, words.textContent.length); }
                const numberLines = from >= 0 ? new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size : 0;
                const note = document.getElementById(a.getAttribute('aria-describedby') ?? '');
                const under = [...el.querySelectorAll('.dq-res-note')].filter((n) => { const q = box(n); return q.top >= r.bottom - 1 && q.top - r.bottom <= 16 && q.left < r.right && q.right > r.left; }).map((n) => n.textContent);
                return { label: a.textContent, ...r, lands, numberLines, describedBy: a.getAttribute('aria-describedby'), under, note: note ? { ...box(note), font: parseFloat(getComputedStyle(note).fontSize), visible: getComputedStyle(note).visibility !== 'hidden' && note.offsetHeight > 0 } : null };
              });
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              const out = [...el.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && (r.right > rowBox.right + 1 || r.left < rowBox.left - 1); }).map((e) => e.className || e.tagName);
              return { innerWidth, innerHeight, wide: document.documentElement.scrollWidth <= innerWidth, row: rowBox, acts, out };
            });
            const label = `${size} ${id} ${name}`;
            h.expect(m.wide && !m.out.length && m.row.left >= 0 && m.row.right <= m.innerWidth, `${label}: spills past the screen or its card: ${m.out.join(', ')}`);
            for (const a of m.acts) {
              h.expect(a.width >= 44 && a.height >= 44, `${label}: "${a.label}" is ${Math.round(a.width)}x${Math.round(a.height)}, under a 44px tap target`);
              h.expect(a.lands, `${label}: a tap on "${a.label}" lands on something else`);
              h.expect(a.numberLines <= 1, `${label}: the number in "${a.label}" breaks across ${a.numberLines} lines`);
            }
            FACTS[id].lines[name].actions.forEach((w, i) => {
              const a = m.acts[i];
              h.expect(!!a, `${label}: the ${w.to} button is missing`);
              if (!w.note) {
                h.expect(!a.describedBy && !a.under.length, `${label}: "${a.label}" has a note: ${JSON.stringify({ describedBy: a.describedBy, under: a.under })}`);
                return;
              }
              const n = a.note;
              h.expect(!!n && n.visible, `${label}: "${a.label}" has no visible note`);
              if (!n) return;
              h.expect(n.top >= a.bottom - 1 && n.top - a.bottom <= 16 && Math.abs(n.left - a.left) <= 2 && n.right <= m.row.right, `${label}: the note for "${a.label}" isn't right under it: ${JSON.stringify({ a, n })}`);
              h.expect(n.font >= 16, `${label}: the note for "${a.label}" is ${n.font}px`);
            });
            await row.screenshot({ path: path.join(h.out, `q8-row-${id}-${name.replace(/\W+/g, '-').toLowerCase()}-${size}.png`) });
          }
          expectClean(h, `${size} ${id}`, b);
        } finally {
          await b.ctx.close();
        }
      }
    }
  },
};
