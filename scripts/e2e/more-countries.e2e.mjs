// Singapore, South Africa and Malta in the Safe Zone (Q10): each shows its checked line, its emergency numbers labelled
// by what they cover, and only the buttons the services really offer, picked from the device language or by hand.
// Nothing is called or texted, nothing asks for a location, and the only request that leaves the device is the
// WhatsApp link, once it is tapped (answered here by the test, never by the real site).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Written out by hand from the checked table, so a wrong number, hour, label or button in the app fails here.
const FACTS = {
  sg: {
    locales: ['en-SG', 'zh-SG'],
    name: 'Singapore',
    sos: [['tel:995', 'Call 995', 'Ambulance or fire.'], ['tel:999', 'Call 999', 'Police.']],
    danger: 'If you are in danger right now, call 995 or 999.',
    lines: {
      'Samaritans of Singapore (SOS)': {
        actions: [
          { href: 'tel:1767', label: 'Call 1767' },
          { href: 'https://wa.me/6591511767', label: 'WhatsApp', web: true, note: [/needs the internet/i, /WhatsApp account/i, /data rates may apply/i] },
        ],
        says: ['1767', 'CareText', 'WhatsApp', '+65 9151 1767', 'toll-free', '24/7', /free, confidential support/i],
        never: [/\bSMS\b/i, /text 1767/i, /text 9151/i],
      },
    },
  },
  za: {
    locales: ['en-ZA', 'af-ZA'],
    name: 'South Africa',
    sos: [['tel:112', 'Call 112', 'From a cellphone.'], ['tel:10177', 'Call 10177', 'Ambulance.']],
    danger: 'If you are in danger right now, call 112 or 10177.',
    lines: {
      'SADAG Suicide Crisis Helpline': {
        actions: [{ href: 'tel:0800567567', label: 'Call' }],
        says: ['0800 567 567', 'Toll-free', 'confidential', '24/7'],
        never: ['31393', /\bSMS\b/i, /\btext\b/i],
      },
    },
  },
  mt: {
    locales: ['en-MT', 'mt-MT'],
    name: 'Malta',
    sos: [['tel:112', 'Call 112', null]],
    danger: 'If you are in danger right now, call 112.',
    lines: {
      'Richmond Foundation': {
        actions: [{ href: 'tel:1770', label: 'Call 1770', note: ['Monday to Friday 8am to 8pm', 'Saturday 8am to 4pm', 'Malta time', 'Closed on Sundays and public holidays'] }],
        says: ['1770', 'Monday to Friday 8am to 8pm', 'Saturday 8am to 4pm', 'Malta time', 'Closed on Sundays and public holidays', 'Free from local landlines and mobiles', 'confidential'],
        never: ['1579', '24/7', /24 hours|any time|day or night|\bSMS\b|\btext\b/i],
      },
    },
  },
};
// The countries that were here before, with the buttons the earlier checks settled on (Q8 kept both Irish text routes).
const KEPT = {
  us: { locale: 'en-US', hrefs: ['tel:988', 'sms:988', 'sms:741741?body=HOME', 'tel:911', 'tel:18007997233', 'sms:88788?body=START'], sos: ['Call 911'] },
  ca: { locale: 'en-CA', hrefs: ['tel:988', 'sms:988', 'tel:911'], sos: ['Call 911'] },
  uk: { locale: 'en-GB', hrefs: ['tel:116123', 'sms:85258?body=SHOUT', 'tel:999'], sos: ['Call 999'] },
  ie: { locale: 'en-IE', hrefs: ['tel:116123', 'sms:50808?body=HELLO', 'sms:0861800280?body=HELLO', 'tel:112', 'tel:999', 'tel:1800341900'], sos: ['Call 112', 'Call 999'] },
  au: { locale: 'en-AU', hrefs: ['tel:131114', 'sms:0477131114', 'tel:1800737732', 'sms:0458737732', 'tel:000'], sos: ['Call 000'] },
  nz: { locale: 'en-NZ', hrefs: ['tel:1737', 'sms:1737', 'tel:0800733843', 'tel:111'], sos: ['Call 111'] },
  in: { locale: 'en-IN', hrefs: ['tel:14416', 'tel:181', 'tel:112'], sos: ['Call 112'] },
};
const PICKER = [['us', 'United States'], ['ca', 'Canada'], ['uk', 'United Kingdom'], ['ie', 'Ireland'], ['au', 'Australia'], ['nz', 'New Zealand'], ['in', 'India'], ['sg', 'Singapore'], ['za', 'South Africa'], ['mt', 'Malta'], ['elsewhere', 'Somewhere else']];
const NONE = 'This app doesn\u2019t have a checked free, confidential line for where you are.';
const SIZES = { '390x844': { width: 390, height: 844 }, '320x568': { width: 320, height: 568 }, '844x390': { width: 844, height: 390 }, '1280x800': { width: 1280, height: 800 } };
const TALL = SIZES['390x844'];

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// a returning player, so no first-visit window opens over the Safe Zone
const returning = (extra = {}) => {
  const t = Date.now() - 86400e3;
  return JSON.stringify({ v: 1, created: t, events: [{ id: 'q10-visit', t, day: dayKey(t), k: 'visit', xp: 10 }], flags: { greetDay: dayKey(t) }, ...extra });
};

async function context(h, { locale, viewport = TALL, save = returning(), sw = false, home = h.server.url }) {
  const ctx = await h.browser.newContext({ viewport, locale, deviceScaleFactor: 2, serviceWorkers: sw ? 'allow' : 'block', acceptDownloads: true });
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: save };
  await ctx.addInitScript((s) => {
    if (!sessionStorage.getItem('e2e-seeded')) {
      sessionStorage.setItem('e2e-seeded', '1');
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }
    // a location lookup of any kind would show up here
    window.__asked = [];
    const geo = navigator.geolocation;
    if (geo) for (const k of ['getCurrentPosition', 'watchPosition']) { const f = geo[k].bind(geo); geo[k] = (...a) => (window.__asked.push(k), f(...a)); }
    const perms = navigator.permissions;
    if (perms?.query) { const q = perms.query.bind(perms); perms.query = (d) => (/geo|location/i.test(String(d?.name)) && window.__asked.push('permissions:' + d.name), q(d)); }
  }, seed);
  const outside = [];
  const origin = new URL(home).origin;
  ctx.on('request', (r) => {
    const u = r.url();
    if (!/^(data|blob):/.test(u) && new URL(u).origin !== origin) outside.push(u);
  });
  return { ctx, outside };
}

async function page(h, ctx, url, errors) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p.goto(url);
  await p.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 60000 });
  return p;
}

async function boot(h, opts) {
  const { ctx, outside } = await context(h, opts);
  const errors = [];
  return { ctx, outside, errors, page: await page(h, ctx, h.server.url + '/?mute', errors) };
}

async function talk(page, { danger = false } = {}) {
  await page.evaluate(() => window.__daily.go({ name: 'hub' }));
  await page.locator('header .dq-safe').click();
  if (danger) await page.getByRole('button', { name: 'I might not be safe' }).click();
  else await page.locator('.dq-sz-talk').click();
  await page.locator('.dq-safezone .dq-region select').waitFor();
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.querySelectorAll('.dq-sz-body, .dq-sz-body > *')].flatMap((e) => e.getAnimations()).map((a) => a.finished)]));
}

const read = (page) =>
  page.evaluate(() => {
    const zone = document.querySelector('.dq-safezone');
    const select = zone.querySelector('.dq-region select');
    const help = zone.querySelector('a[href="https://findahelpline.com"]');
    return {
      region: select?.value,
      regionName: select?.selectedOptions[0]?.textContent,
      options: [...(select?.options ?? [])].map((o) => [o.value, o.textContent]),
      lead: [...zone.querySelectorAll('.dq-sz-lead .dq-text, .dq-sz-advice')].map((p) => p.textContent.replace(/\s+/g, ' ')),
      first: zone.querySelector('.dq-sz-main > *')?.textContent.replace(/\s+/g, ' ') ?? '',
      help: help ? { text: help.closest('p').textContent, target: help.getAttribute('target'), rel: help.getAttribute('rel') ?? '' } : null,
      rows: [...zone.querySelectorAll('.dq-res')].map((row) => ({
        name: row.querySelector('.dq-res-n')?.textContent ?? '',
        text: row.textContent.replace(/\s+/g, ' '),
        flat: row.textContent.replace(/[\s-]/g, ''),
        how: row.querySelector('.dq-res-how')?.textContent ?? '',
        actions: [...row.querySelectorAll('a.dq-res-a')].map((a) => ({
          href: a.getAttribute('href'),
          label: a.textContent.replace(/\s+/g, ' ').trim(),
          target: a.getAttribute('target'),
          rel: a.getAttribute('rel') ?? '',
          note: (a.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' '),
        })),
      })),
      asked: window.__asked ?? [],
    };
  });

const has = (text, fact) => (typeof fact === 'string' ? text.includes(fact) : fact.test(text));

function expectCountry(h, got, id, label, { danger = false } = {}) {
  const want = FACTS[id];
  h.expect(got.region === id && got.regionName === want.name, `${label}: the picker shows ${got.region} (${got.regionName}), want ${id} (${want.name})`);
  const names = got.rows.map((r) => r.name);
  const order = danger ? ['Emergency', ...Object.keys(want.lines)] : [...Object.keys(want.lines), 'Emergency'];
  h.expect(JSON.stringify(names) === JSON.stringify(order), `${label}: rows ${JSON.stringify(names)}, want ${JSON.stringify(order)}`);
  const sos = got.rows.find((r) => r.name === 'Emergency');
  const sosGot = sos?.actions.map((a) => [a.href, a.label, a.note || null]) ?? [];
  h.expect(JSON.stringify(sosGot) === JSON.stringify(want.sos), `${label}: emergency buttons ${JSON.stringify(sosGot)}, want ${JSON.stringify(want.sos)}`);
  for (const [name, line] of Object.entries(want.lines)) {
    const row = got.rows.find((r) => r.name === name);
    h.expect(!!row, `${label}: ${name} is missing`);
    if (!row) continue;
    const acts = row.actions.map((a) => [a.href, a.label]);
    h.expect(JSON.stringify(acts) === JSON.stringify(line.actions.map((a) => [a.href, a.label])), `${label} ${name}: buttons ${JSON.stringify(acts)}, want ${JSON.stringify(line.actions.map((a) => [a.href, a.label]))}`);
    line.actions.forEach((w, i) => {
      const a = row.actions[i];
      if (!a) return;
      if (w.web) h.expect(a.target === '_blank' && /\bnoopener\b/.test(a.rel) && /\bnoreferrer\b/.test(a.rel), `${label} ${name}: ${w.href} opens with target ${a.target} rel "${a.rel}", want a new tab with noopener noreferrer`);
      else h.expect(!a.target && !a.rel, `${label} ${name}: ${w.href} has target ${a.target} rel "${a.rel}"`);
      if (!w.note) h.expect(!a.note, `${label} ${name}: ${w.href} has a note ${JSON.stringify(a.note)}, want none`);
      for (const fact of w.note ?? []) h.expect(has(a.note, fact), `${label} ${name}: the note on ${w.href} ${JSON.stringify(a.note)} doesn't say ${fact}`);
    });
    for (const fact of line.says) h.expect(has(row.text, fact), `${label} ${name}: the row doesn't say ${fact}`);
    for (const fact of line.never) h.expect(!has(row.text, fact), `${label} ${name}: the row says ${fact}`);
  }
  for (const row of got.rows) {
    for (const a of row.actions) {
      const n = a.href.replace(/^(tel:|sms:|https:\/\/wa\.me\/)/, '').replace(/[?&]body=.*/, '');
      h.expect(row.flat.includes(n), `${label} ${row.name}: "${a.label}" goes to ${n} without the row saying it`);
      h.expect(!a.href.startsWith('sms:'), `${label} ${row.name}: "${a.label}" is a text route (${a.href}) no source confirmed`);
    }
  }
  if (danger) h.expect(got.lead.includes(want.danger), `${label}: the danger line is ${JSON.stringify(got.lead)}, want ${JSON.stringify(want.danger)}`);
  h.expect(!got.lead.includes(NONE), `${label}: says there is no checked line`);
  h.expect(!!got.help && got.help.target === '_blank' && /noopener/.test(got.help.rel) && /noreferrer/.test(got.help.rel), `${label}: the findahelpline link is missing or opens in this tab`);
  h.expect(JSON.stringify(got.options) === JSON.stringify(PICKER), `${label}: the picker lists ${JSON.stringify(got.options)}`);
}

function expectElsewhere(h, got, label) {
  h.expect(got.region === 'elsewhere' && got.regionName === 'Somewhere else', `${label}: the picker shows ${got.region}, want elsewhere`);
  h.expect(!got.rows.length, `${label}: shows rows ${JSON.stringify(got.rows.map((r) => r.name))}`);
  h.expect(got.lead.includes(NONE), `${label}: doesn't say plainly that there is no checked line here: ${JSON.stringify(got.lead)}`);
  h.expect(got.lead.some((t) => t.includes('call your local emergency number')), `${label}: no local emergency number advice`);
  h.expect(!got.lead.some((t) => /These are private|\d{3}/.test(t)), `${label}: talks about lines or numbers it doesn't have: ${JSON.stringify(got.lead)}`);
  h.expect(!!got.help && got.help.text === 'findahelpline.com lists free lines in many countries.', `${label}: the directory line is ${JSON.stringify(got.help?.text)}`);
}

function expectKept(h, got, id, label) {
  const hrefs = got.rows.flatMap((r) => r.actions.map((a) => a.href));
  h.expect(got.region === id, `${label}: the picker shows ${got.region}, want ${id}`);
  h.expect(JSON.stringify(hrefs) === JSON.stringify(KEPT[id].hrefs), `${label}: buttons ${JSON.stringify(hrefs)}, want ${JSON.stringify(KEPT[id].hrefs)}`);
  const sos = got.rows.find((r) => r.name === 'Emergency')?.actions.map((a) => a.label) ?? [];
  h.expect(JSON.stringify(sos) === JSON.stringify(KEPT[id].sos), `${label}: emergency labels ${JSON.stringify(sos)}, want ${JSON.stringify(KEPT[id].sos)}`);
  const notes = got.rows.find((r) => r.name === 'Emergency')?.actions.map((a) => a.note).filter(Boolean) ?? [];
  h.expect(!notes.length, `${label}: emergency buttons gained notes ${JSON.stringify(notes)}`);
  h.expect(!got.lead.includes(NONE), `${label}: says there is no checked line`);
}

function expectClean(h, label, b, got) {
  h.expect(!b.errors.length, `${label}: ${b.errors.join(' | ')}`);
  h.expect(!b.outside.length, `${label}: requests left the device before any link was tapped: ${b.outside.join(', ')}`);
  if (got) h.expect(!got.asked.length, `${label}: asked for a location: ${got.asked.join(', ')}`);
}

const pick = async (page, id) => {
  await page.locator('.dq-safezone .dq-region select').selectOption(id);
  await page.waitForFunction((id) => document.querySelector('.dq-safezone .dq-region select')?.value === id && window.__daily.store.state.settings.region === id, id);
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.dq-sz-body, .dq-sz-body > *')].flatMap((e) => e.getAnimations()).map((a) => a.finished)));
};
const stored = (page) => page.evaluate(() => window.__daily.store.state.settings.region);

// A production build with its service worker, served from this process, for the offline check.
let scratch;
const scratchDir = () => {
  if (!scratch) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-e2e-q10-'));
    process.once('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
  }
  return scratch;
};
function build(shared) {
  return (shared.q10Build ??= new Promise((resolve, reject) => {
    const dir = path.join(scratchDir(), 'dist');
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BASE_PATH: '' } });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('exit', (code) => (code === 0 ? resolve(dir) : reject(new Error('production build failed:\n' + log.slice(-2000)))));
  }));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };
async function host(dir) {
  const base = fs.realpathSync(dir);
  const server = http.createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return res.writeHead(400).end();
    }
    let f = path.resolve(base, '.' + p);
    if (f !== base && !f.startsWith(base + path.sep)) return res.writeHead(403).end();
    if (p.endsWith('/')) f = path.join(f, 'index.html');
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) f = path.join(base, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}

/** Where each label's number sits and whether the row, its buttons and notes fit, as the player sees them. */
const measure = (row) =>
  row.evaluate((el) => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const rowBox = box(el);
    const acts = [...el.querySelectorAll('a.dq-res-a')].map((a) => {
      a.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = box(a);
      const lands = [0.2, 0.5, 0.8].every((f) => a.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height * f)));
      const words = a.querySelector('span:last-child')?.firstChild;
      const m = /\d[\d\s]*\d|\d/.exec(words?.textContent ?? '');
      const range = document.createRange();
      if (m) { range.setStart(words, m.index); range.setEnd(words, m.index + m[0].length); }
      const numberLines = m ? new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size : 0;
      const note = document.getElementById(a.getAttribute('aria-describedby') ?? '');
      return { label: a.textContent, ...r, lands, hasNumber: !!m, numberLines, note: note ? { ...box(note), font: parseFloat(getComputedStyle(note).fontSize), visible: note.offsetHeight > 0 } : null };
    });
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const out = [...el.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && (r.right > rowBox.right + 1 || r.left < rowBox.left - 1); }).map((e) => e.className || e.tagName);
    return { innerWidth, wide: document.documentElement.scrollWidth <= innerWidth, row: rowBox, acts, out };
  });

export const scenarios = {
  /** the device language picks the country (any language spoken there), and the screen shows the checked table */
  async 'more-countries-by-locale'(h) {
    for (const [id, want] of Object.entries(FACTS)) {
      for (const locale of want.locales) {
        const b = await boot(h, { locale });
        try {
          await talk(b.page);
          const got = await read(b.page);
          expectCountry(h, got, id, locale);
          h.expect((await stored(b.page)) === '', `${locale}: the device language was saved as a choice`);
          if (locale === want.locales[0]) await h.shot(b.page, `q10-talk-${id}-390`);
          expectClean(h, locale, b, got);
        } finally {
          await b.ctx.close();
        }
      }
    }
  },

  /** I might not be safe: the emergency numbers come first, each labelled by what it covers, and the line still follows */
  async 'more-countries-danger-first'(h) {
    for (const [id, want] of Object.entries(FACTS)) {
      const b = await boot(h, { locale: want.locales[0] });
      try {
        await talk(b.page, { danger: true });
        const got = await read(b.page);
        expectCountry(h, got, id, `${id} danger`, { danger: true });
        await h.shot(b.page, `q10-danger-${id}-390`);
        expectClean(h, `${id} danger`, b, got);
      } finally {
        await b.ctx.close();
      }
    }
  },

  /**
   * Picked by hand on a device whose language has no lines here: "Somewhere else" says so plainly, then each new country
   * from the Talk picker and from Settings, and every country that was here before keeps its buttons.
   */
  async 'more-countries-picked'(h) {
    const b = await boot(h, { locale: 'de-DE' });
    try {
      await talk(b.page);
      expectElsewhere(h, await read(b.page), 'de-DE');
      await h.shot(b.page, 'q10-talk-elsewhere-390');
      await talk(b.page, { danger: true });
      const danger = await read(b.page);
      expectElsewhere(h, danger, 'de-DE danger');
      h.expect(danger.first === 'If you are in danger right now, call your local emergency number.', `de-DE danger: the first line beside the choices is ${JSON.stringify(danger.first)}`);
      await talk(b.page);
      for (const id of Object.keys(FACTS)) {
        await pick(b.page, id);
        expectCountry(h, await read(b.page), id, `${id} picked in Talk`);
      }
      for (const id of Object.keys(KEPT)) {
        await pick(b.page, id);
        expectKept(h, await read(b.page), id, `${id} picked in Talk`);
      }
      for (const id of Object.keys(FACTS)) {
        await b.page.evaluate(() => window.__daily.go({ name: 'settings' }));
        const set = b.page.locator('.dq-settings .dq-region select');
        await set.waitFor();
        h.expect(JSON.stringify(await set.evaluate((s) => [...s.options].map((o) => [o.value, o.textContent]))) === JSON.stringify(PICKER), 'Settings lists other countries');
        await set.selectOption(id);
        await talk(b.page);
        expectCountry(h, await read(b.page), id, `${id} picked in Settings`);
      }
      expectClean(h, 'picked', b, await read(b.page));
    } finally {
      await b.ctx.close();
    }
  },

  /**
   * A choice beats the device language, survives a reload and follows another open copy; old saves load; a country an
   * older build kept for a newer one now shows; an unknown country stays kept; a Save Crystal carries the choice.
   */
  async 'more-countries-choice-kept'(h) {
    const t = Date.now() - 3600e3;
    const ukSave = returning({ profile: { region: 'uk', setAt: { region: t } } });
    const a = await boot(h, { locale: 'en-SG', save: ukSave });
    try {
      await talk(a.page);
      expectKept(h, await read(a.page), 'uk', 'en-SG with the UK picked');
      await pick(a.page, 'za');
      await a.page.reload();
      await a.page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 60000 });
      await talk(a.page);
      expectCountry(h, await read(a.page), 'za', 'en-SG with South Africa picked, after a reload');
      // a second copy opened from this one shares its session, so it isn't seeded again
      const [b] = await Promise.all([a.ctx.waitForEvent('page'), a.page.evaluate((u) => void window.open(u), h.server.url + '/?mute')]);
      b.on('pageerror', (e) => a.errors.push('tab B pageerror: ' + e.message));
      await b.waitForFunction(() => !!window.__daily, null, { timeout: 60000 });
      await b.evaluate(() => window.__daily.go({ name: 'settings' }));
      const pickB = b.locator('.dq-settings .dq-region select');
      await pickB.waitFor();
      h.expect((await pickB.inputValue()) === 'za', 'tab B does not show the choice from tab A');
      await pickB.selectOption('mt');
      await a.page.waitForFunction(() => document.querySelector('.dq-safezone .dq-region select')?.value === 'mt', null, { timeout: 10000 });
      await a.page.evaluate(() => Promise.all([...document.querySelectorAll('.dq-sz-body, .dq-sz-body > *')].flatMap((e) => e.getAnimations()).map((x) => x.finished)));
      expectCountry(h, await read(a.page), 'mt', 'tab A after tab B picked Malta');
      await a.page.locator('.dq-safezone .dq-region select').selectOption('sg');
      await b.waitForFunction(() => document.querySelector('.dq-settings .dq-region select')?.value === 'sg', null, { timeout: 10000 });
      expectClean(h, 'two tabs', a, await read(a.page));
    } finally {
      await a.ctx.close();
    }

    // an old save from before countries could be picked
    const old = await boot(h, { locale: 'en-MT', save: returning({ settings: { sound: true, motion: 'system' } }) });
    try {
      await talk(old.page);
      expectCountry(h, await read(old.page), 'mt', 'old save on en-MT');
      h.expect((await stored(old.page)) === '', 'the old save gained a picked country');
    } finally {
      await old.ctx.close();
    }
    // a build without Singapore kept "sg" from a newer one; this build shows it, and an id it doesn't know stays kept
    for (const [region, locale, want] of [['sg', 'en-US', 'sg'], ['de', 'en-ZA', 'elsewhere']]) {
      const k = await boot(h, { locale, save: returning({ profile: { region, setAt: { region: t } } }) });
      try {
        await talk(k.page);
        const got = await read(k.page);
        if (want === 'elsewhere') expectElsewhere(h, got, `kept "${region}" on ${locale}`);
        else expectCountry(h, got, want, `kept "${region}" on ${locale}`);
        h.expect((await stored(k.page)) === region, `the kept "${region}" became ${await stored(k.page)}`);
        expectClean(h, `kept ${region}`, k, got);
      } finally {
        await k.ctx.close();
      }
    }

    // Save Crystal: South Africa picked on one device, restored on a device that never picked
    const from = await boot(h, { locale: 'en-GB' });
    let file;
    try {
      await talk(from.page);
      await pick(from.page, 'za');
      await from.page.evaluate(() => window.__daily.go({ name: 'settings' }));
      const [dl] = await Promise.all([from.page.waitForEvent('download', { timeout: 15000 }), from.page.getByRole('button', { name: 'Save Crystal' }).click()]);
      file = path.join(h.out, 'q10-crystal.json');
      await dl.saveAs(file);
      h.expect(h.deepFind(JSON.parse(fs.readFileSync(file, 'utf8')), 'region').includes('za'), 'the Save Crystal does not carry South Africa');
    } finally {
      await from.ctx.close();
    }
    const to = await boot(h, { locale: 'en-SG' });
    try {
      await to.page.evaluate(() => window.__daily.go({ name: 'settings' }));
      await to.page.locator('input[type=file]').setInputFiles(file);
      await to.page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
      await to.page.waitForFunction(() => window.__daily.store.state.settings.region === 'za', null, { timeout: 15000 });
      await talk(to.page);
      expectCountry(h, await read(to.page), 'za', 'restored on an en-SG device');
      expectClean(h, 'crystal', to, await read(to.page));
    } finally {
      await to.ctx.close();
    }
  },

  /** the WhatsApp button is the only way out: nothing leaves before the tap, and the tap opens wa.me in a new tab with no link back */
  async 'more-countries-whatsapp-tap'(h) {
    const b = await boot(h, { locale: 'en-SG' });
    const seen = [];
    try {
      await b.ctx.route('https://wa.me/**', (route) => {
        seen.push({ url: route.request().url(), referer: route.request().headers().referer ?? '' });
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stand-in</title>' });
      });
      await talk(b.page);
      expectClean(h, 'before the tap', b, await read(b.page));
      const [tab] = await Promise.all([b.ctx.waitForEvent('page'), b.page.getByRole('link', { name: /^WhatsApp, / }).click()]);
      await tab.waitForLoadState();
      h.expect(tab.url() === 'https://wa.me/6591511767', `the tap opened ${tab.url()}`);
      h.expect((await tab.evaluate(() => window.opener)) === null, 'the WhatsApp tab can reach back to the app');
      h.expect(seen.length === 1 && !seen[0].referer, `the tap sent ${JSON.stringify(seen)}`);
      h.expect(JSON.stringify(b.outside) === JSON.stringify(['https://wa.me/6591511767']), `requests after the tap: ${b.outside.join(', ')}`);
      h.expect((await b.page.locator('.dq-safezone .dq-sz-t').textContent()) === 'Talk to someone now', 'the app left the Talk screen');
      await tab.close();
    } finally {
      await b.ctx.close();
    }
  },

  /** once the production app is installed, a first open with no connection still shows every number and button */
  async 'more-countries-offline-first-open'(h) {
    const dir = await build(h.shared);
    const srv = await host(dir);
    const { ctx, outside } = await context(h, { locale: 'en-SG', sw: true, home: srv.url });
    const errors = [];
    try {
      const first = await page(h, ctx, srv.url + '?mute', errors);
      await first.evaluate(() => navigator.serviceWorker.ready);
      await first.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
      await first.close();
      await ctx.setOffline(true);
      const off = await page(h, ctx, srv.url + '?mute', errors);
      h.expect(await off.evaluate(() => !!navigator.serviceWorker.controller && !navigator.onLine), 'the offline open did not come from the installed app');
      await talk(off);
      expectCountry(h, await read(off), 'sg', 'offline en-SG');
      await h.shot(off, 'q10-offline-sg-390');
      for (const id of ['za', 'mt']) {
        await pick(off, id);
        expectCountry(h, await read(off), id, `offline ${id} picked`);
      }
      await pick(off, 'elsewhere');
      expectElsewhere(h, await read(off), 'offline elsewhere');
      const got = await read(off);
      h.expect(!errors.length, `offline: ${errors.join(' | ')}`);
      h.expect(!outside.length, `offline: requests left the device: ${outside.join(', ')}`);
      h.expect(!got.asked.length, `offline: asked for a location: ${got.asked.join(', ')}`);
    } finally {
      await ctx.close();
      await srv.close();
    }
  },

  /** phone, small phone, sideways and desktop: every row, button, note and the picker fit and read, calm and in danger */
  async 'more-countries-screen-sizes'(h) {
    for (const [size, viewport] of Object.entries(SIZES)) {
      const b = await boot(h, { locale: 'en-US', viewport });
      try {
        for (const id of [...Object.keys(FACTS), 'elsewhere']) {
          await b.page.evaluate((id) => {
            const st = window.__daily.store;
            st.state.settings.region = id;
            st.touch('region');
            st.save();
          }, id);
          for (const danger of [false, true]) {
            const label = `${size} ${id}${danger ? ' danger' : ''}`;
            await talk(b.page, { danger });
            const got = await read(b.page);
            if (id === 'elsewhere') expectElsewhere(h, got, label);
            else expectCountry(h, got, id, label, { danger });
            await h.shot(b.page, `q10-${id}${danger ? '-danger' : ''}-${size}`);
            // the moment Talk opens, with no scrolling, the first way to reach someone is whole on screen and clear of the bars
            const first = await b.page.evaluate(() => {
              const a = document.querySelector('.dq-safezone .dq-res-a') ?? document.querySelector('.dq-safezone a[href="https://findahelpline.com"]');
              const r = a.getBoundingClientRect();
              const top = document.querySelector('.dq-top').getBoundingClientRect().bottom;
              const f = document.querySelector('.dq-sz-foot').getBoundingClientRect();
              const under = r.right > f.left && r.left < f.right && r.bottom > f.top + 0.5;
              return { href: a.getAttribute('href'), box: [r.left, r.top, r.right, r.bottom].map(Math.round), whole: r.left >= 0 && r.right <= innerWidth && r.top >= top - 0.5 && r.bottom <= innerHeight + 0.5 && !under };
            });
            const want = id === 'elsewhere' ? 'https://findahelpline.com' : danger ? FACTS[id].sos[0][0] : Object.values(FACTS[id].lines)[0].actions[0].href;
            // a small phone upright is left to the Safe Zone fit work: there every country's danger call sits just below the fold
            if (size !== '320x568') h.expect(first.href === want && first.whole, `${label}: the first button on opening is ${first.href} at ${first.box}, whole: ${first.whole}; want ${want} whole on screen`);
            for (const row of await b.page.locator('.dq-safezone .dq-res').all()) {
              const m = await measure(row);
              const name = await row.locator('.dq-res-n').textContent();
              h.expect(m.wide && !m.out.length && m.row.left >= 0 && m.row.right <= m.innerWidth, `${label} ${name}: spills past the screen or its card: ${m.out.join(', ')}`);
              for (const a of m.acts) {
                h.expect(a.width >= 44 && a.height >= 44, `${label} ${name}: "${a.label}" is ${Math.round(a.width)}x${Math.round(a.height)}, under a 44px tap target`);
                h.expect(a.lands, `${label} ${name}: a tap on "${a.label}" lands on something else`);
                h.expect(!a.hasNumber || a.numberLines === 1, `${label} ${name}: the number in "${a.label}" breaks across ${a.numberLines} lines`);
                h.expect(a.right <= m.row.right && a.left >= m.row.left, `${label} ${name}: "${a.label}" sticks out of its card`);
                if (a.note) {
                  h.expect(a.note.visible && a.note.font >= 16, `${label} ${name}: the note for "${a.label}" is hidden or ${a.note.font}px`);
                  h.expect(a.note.top >= a.bottom - 1 && a.note.top - a.bottom <= 16 && Math.abs(a.note.left - a.left) <= 2 && a.note.right <= m.row.right, `${label} ${name}: the note for "${a.label}" isn't right under it`);
                }
              }
              if (!danger && size !== '1280x800') await h.shot(row, `q10-row-${id}-${name.replace(/\W+/g, '-').toLowerCase()}-${size}`);
            }
            const picker = b.page.locator('.dq-safezone .dq-region');
            await picker.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
            const p = await picker.evaluate((el) => {
              const s = el.querySelector('select').getBoundingClientRect();
              const r = el.getBoundingClientRect();
              const foot = document.querySelector('.dq-sz-foot')?.getBoundingClientRect();
              const covered = foot && s.bottom > foot.top && s.top < foot.bottom && s.right > foot.left && s.left < foot.right;
              const hit = el.querySelector('select') === document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
              return { left: r.left, right: r.right, sh: s.height, font: parseFloat(getComputedStyle(el.querySelector('select')).fontSize), covered, hit, innerWidth };
            });
            h.expect(p.left >= 0 && p.right <= p.innerWidth && p.sh >= 44 && p.font >= 16 && !p.covered && p.hit, `${label}: the country picker is cut off, covered or small: ${JSON.stringify(p)}`);
            if (!danger) await h.shot(picker, `q10-picker-${id}-${size}`);
          }
        }
        expectClean(h, size, b, await read(b.page));
      } finally {
        await b.ctx.close();
      }
    }
  },
};
