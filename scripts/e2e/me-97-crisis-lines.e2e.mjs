// Crisis lines by country (ME-97): the Safe Zone's Talk screen shows the verified lines for the player's country,
// picked from the device language until the player chooses, changeable in one tap there and in Settings. Another open
// copy's later choice wins; a Save Crystal never replaces a choice made on this device.
import fs from 'node:fs';
import path from 'node:path';
import { settled } from './harness.mjs';

// Written out by hand from the verified table, so a wrong number in the app fails here.
const EXPECT = {
  us: { locale: 'en-US', name: 'United States', services: ['988 Suicide & Crisis Lifeline', 'Crisis Text Line', 'Emergency', 'National Domestic Violence Hotline'], hrefs: ['tel:988', 'sms:988', 'sms:741741?body=HOME', 'tel:911', 'tel:18007997233', 'sms:88788?body=START'], sos: ['tel:911'] },
  ca: { locale: 'en-CA', name: 'Canada', services: ['9-8-8: Suicide Crisis Helpline', 'Emergency'], hrefs: ['tel:988', 'sms:988', 'tel:911'], sos: ['tel:911'] },
  uk: { locale: 'en-GB', name: 'United Kingdom', services: ['Samaritans', 'Shout', 'Emergency'], hrefs: ['tel:116123', 'sms:85258?body=SHOUT', 'tel:999'], sos: ['tel:999'] },
  ie: { locale: 'en-IE', name: 'Ireland', services: ['Samaritans', 'Text About It', 'Emergency', "Women's Aid"], hrefs: ['tel:116123', 'sms:50808?body=HELLO', 'sms:0861800280?body=HELLO', 'tel:112', 'tel:999', 'tel:1800341900'], sos: ['tel:112', 'tel:999'] },
  au: { locale: 'en-AU', name: 'Australia', services: ['Lifeline', '1800RESPECT', 'Emergency'], hrefs: ['tel:131114', 'sms:0477131114', 'tel:1800737732', 'sms:0458737732', 'tel:000'], sos: ['tel:000'] },
  nz: { locale: 'en-NZ', name: 'New Zealand', services: ['1737', "Women's Refuge", 'Emergency'], hrefs: ['tel:1737', 'sms:1737', 'tel:0800733843', 'tel:111'], sos: ['tel:111'] },
  in: { locale: 'en-IN', name: 'India', services: ['Tele-MANAS', 'Women Helpline', 'Emergency'], hrefs: ['tel:14416', 'tel:181', 'tel:112'], sos: ['tel:112'] },
  elsewhere: { locale: 'de-DE', name: 'Somewhere else', services: [], hrefs: [], sos: [] },
};
const TALL = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const WIDE = { width: 844, height: 390 };
const SHORT = { width: 568, height: 320 };
const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// a returning player, so no first-visit window opens over the Safe Zone
const returning = (extra = {}) => {
  const t = Date.now() - 86400e3;
  return JSON.stringify({ v: 1, created: t, events: [{ id: 'me97-visit', t, day: dayKey(t), k: 'visit', xp: 10 }], flags: { greetDay: dayKey(t) }, ...extra });
};

async function boot(h, { locale = 'en-US', viewport = TALL, save = returning() } = {}) {
  const ctx = await h.browser.newContext({ viewport, locale, deviceScaleFactor: 2, serviceWorkers: 'block', acceptDownloads: true });
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: save };
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(h.server.url + '/?mute');
  await h.reachHub(page);
  return { ctx, page, errors };
}

async function talk(page, { danger = false } = {}) {
  await page.locator('header .dq-safe').click();
  if (danger) await page.getByRole('button', { name: 'I might not be safe' }).click();
  else await page.locator('.dq-sz-talk').click();
  await page.locator('.dq-region select').waitFor();
  await settled(page, '.dq-safezone');
}

const shown = (page) =>
  page.evaluate(() => ({
    hrefs: [...document.querySelectorAll('.dq-safezone .dq-res-a')].map((a) => a.getAttribute('href')),
    first: [...(document.querySelector('.dq-safezone .dq-res')?.querySelectorAll('.dq-res-a') ?? [])].map((a) => a.getAttribute('href')),
    region: document.querySelector('.dq-region select')?.value,
    regionName: document.querySelector('.dq-region select')?.selectedOptions[0]?.textContent,
    services: [...document.querySelectorAll('.dq-safezone .dq-res-n')].map((n) => n.textContent),
    // a number a button dials that its row doesn't say in words
    unsaid: [...document.querySelectorAll('.dq-safezone .dq-res')].flatMap((row) => {
      const said = row.textContent.replace(/[\s-]/g, '');
      return [...row.querySelectorAll('.dq-res-a')].map((a) => a.getAttribute('href').replace(/^(tel|sms):/, '').replace(/[?&]body=.*/, '')).filter((n) => !said.includes(n));
    }),
    // a number a row names that none of its buttons dials (3 digits or more, so "24/7" doesn't count)
    undialled: [...document.querySelectorAll('.dq-safezone .dq-res')].flatMap((row) => {
      const dials = [...row.querySelectorAll('.dq-res-a')].map((a) => a.getAttribute('href').replace(/[?&]body=.*/, '').replace(/\D/g, ''));
      return (row.querySelector('.dq-res-how')?.textContent.match(/\d[\d\s-]*\d/g) ?? []).map((n) => n.replace(/\D/g, '')).filter((n) => n.length > 2 && !dials.includes(n));
    }),
    text: document.querySelector('.dq-safezone')?.textContent ?? '',
    help: !!document.querySelector('.dq-safezone a[href="https://findahelpline.com"]'),
  }));

function expectRegion(h, got, id, label) {
  const want = EXPECT[id];
  h.expect(got.region === id && got.regionName === want.name, `${label}: picker shows ${got.region} (${got.regionName}), want ${id}`);
  h.expect(JSON.stringify(got.hrefs) === JSON.stringify(want.hrefs), `${label}: lines ${JSON.stringify(got.hrefs)}, want ${JSON.stringify(want.hrefs)}`);
  h.expect(got.help, `${label}: the findahelpline link is missing`);
  h.expect(JSON.stringify(got.services) === JSON.stringify(want.services), `${label}: services ${JSON.stringify(got.services)}, want ${JSON.stringify(want.services)}`);
  h.expect(!got.unsaid.length, `${label}: buttons dial ${got.unsaid.join(', ')} without saying it`);
  h.expect(!got.undialled.length, `${label}: the text names ${got.undialled.join(', ')} but no button dials it`);
}

export const scenarios = {
  /** each supported device language shows its own country's lines; any other shows "Somewhere else" */
  async 'crisis-lines-by-locale'(h) {
    for (const [id, want] of Object.entries(EXPECT)) {
      const { ctx, page, errors } = await boot(h, { locale: want.locale });
      try {
        await talk(page);
        const got = await shown(page);
        expectRegion(h, got, id, want.locale);
        if (id === 'elsewhere') h.expect(got.text.includes('call your local emergency number'), 'elsewhere: no local emergency number advice');
        if (['uk', 'au', 'elsewhere'].includes(id)) await h.shot(page, `me97-talk-${id}-390`);
        h.expect(!errors.length, `${id}: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
    const bare = await boot(h, { locale: 'en' });
    try {
      await talk(bare.page);
      expectRegion(h, await shown(bare.page), 'elsewhere', 'en without a country');
    } finally {
      await bare.ctx.close();
    }
  },

  /** "I might not be safe" puts the country's emergency number first and says it */
  async 'crisis-lines-danger-first'(h) {
    for (const id of ['uk', 'ie', 'us', 'elsewhere']) {
      const { ctx, page } = await boot(h, { locale: EXPECT[id].locale });
      try {
        await talk(page, { danger: true });
        const got = await shown(page);
        if (EXPECT[id].sos.length) {
          h.expect(JSON.stringify(got.first) === JSON.stringify(EXPECT[id].sos), `${id}: first row ${JSON.stringify(got.first)}, want ${JSON.stringify(EXPECT[id].sos)}`);
          const nums = EXPECT[id].sos.map((s) => s.slice(4)).join(' or ');
          h.expect(got.text.includes(`call ${nums}.`), `${id}: the danger line doesn't name ${nums}`);
        } else h.expect(got.text.includes('call your local emergency number'), `${id}: no local emergency number advice`);
        if (id === 'ie') await h.shot(page, 'me97-danger-ie-390');
      } finally {
        await ctx.close();
      }
    }
  },

  /** one tap changes country in the Safe Zone and in Settings; the choice survives a reload and works offline */
  async 'crisis-lines-change-country'(h) {
    const { ctx, page, errors } = await boot(h, { locale: 'en-US' });
    try {
      await talk(page);
      expectRegion(h, await shown(page), 'us', 'start');
      const progress = () => page.evaluate(() => ({ events: window.__daily.store.state.events.length, xp: window.__daily.store.state.events.reduce((n, e) => n + e.xp, 0), toast: !!document.querySelector('.dq-toast.is-on') }));
      const before = await progress();
      await page.locator('.dq-region select').selectOption('nz');
      await page.waitForFunction(() => document.querySelector('.dq-safezone .dq-res-a')?.getAttribute('href') === 'tel:1737');
      expectRegion(h, await shown(page), 'nz', 'picked in the Safe Zone');
      const picked = await progress();
      h.expect(picked.events === before.events && picked.xp === before.xp && !picked.toast, `picking a country in the Safe Zone gave progress or a toast: ${JSON.stringify(before)} -> ${JSON.stringify(picked)}`);
      const saved = await page.evaluate(() => window.__daily.store.state.settings.region);
      h.expect(saved === 'nz', `the choice was not saved (${saved})`);
      await page.reload();
      await h.reachHub(page);
      await talk(page);
      expectRegion(h, await shown(page), 'nz', 'after a reload');
      await page.evaluate(() => window.__daily.go({ name: 'settings' }));
      const picker = page.locator('.dq-settings .dq-region select');
      await picker.waitFor();
      h.expect((await picker.inputValue()) === 'nz', 'Settings does not show the chosen country');
      await picker.selectOption('au');
      await picker.scrollIntoViewIfNeeded();
      await settled(page, '.dq-region');
      await h.shot(page, 'me97-settings-au-390');
      await ctx.setOffline(true);
      await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await talk(page);
      expectRegion(h, await shown(page), 'au', 'picked in Settings, offline');
      const after = await progress();
      h.expect(after.events === before.events && after.xp === before.xp, `changing country gave progress: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      h.expect(!errors.length, errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  /** at 320 px the call buttons come before the picker, so changing country never pushes them away */
  async 'crisis-lines-small-phone'(h) {
    const { ctx, page } = await boot(h, { locale: 'en-GB', viewport: SMALL });
    try {
      await talk(page);
      const order = await page.evaluate(() => {
        const call = document.querySelector('.dq-safezone .dq-res-a').getBoundingClientRect();
        const pick = document.querySelector('.dq-region').getBoundingClientRect();
        return { call: call.top, pick: pick.top, wide: document.documentElement.scrollWidth <= window.innerWidth };
      });
      h.expect(order.call < order.pick && order.wide, `small phone: call ${order.call}, picker ${order.pick}, fits ${order.wide}`);
      await h.shot(page, 'me97-talk-uk-320');
    } finally {
      await ctx.close();
    }
  },

  /** an old save without the field follows the device language; a Save Crystal carries the choice to a new device */
  async 'crisis-lines-old-save-and-crystal'(h) {
    const old = returning({ settings: { sound: true, motion: 'system' } });
    const a = await boot(h, { locale: 'en-GB', save: old });
    let file;
    try {
      await talk(a.page);
      expectRegion(h, await shown(a.page), 'uk', 'old save');
      const loaded = await a.page.evaluate(() => window.__daily.store.state.settings.region);
      h.expect(loaded === '', `old save loaded region ${JSON.stringify(loaded)}, want ""`);
      await a.page.locator('.dq-region select').selectOption('in');
      await a.page.evaluate(() => window.__daily.go({ name: 'settings' }));
      const [dl] = await Promise.all([a.page.waitForEvent('download', { timeout: 15000 }), a.page.getByRole('button', { name: 'Save Crystal' }).click()]);
      file = path.join(h.out, 'me97-crystal.json');
      await dl.saveAs(file);
    } finally {
      await a.ctx.close();
    }
    const b = await boot(h, { locale: 'en-US' });
    try {
      await b.page.evaluate(() => window.__daily.go({ name: 'settings' }));
      await b.page.locator('input[type=file]').setInputFiles(file);
      await b.page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
      await b.page.waitForFunction(() => window.__daily.store.state.settings.region === 'in', null, { timeout: 15000 });
      await b.page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await talk(b.page);
      expectRegion(h, await shown(b.page), 'in', 'restored on a new device');
    } finally {
      await b.ctx.close();
    }
  },
  /** two open copies: the later country change wins, and an open Talk screen or Settings picker follows it */
  async 'crisis-lines-two-tabs'(h) {
    const a = await boot(h, { locale: 'en-US' });
    try {
      await talk(a.page);
      expectRegion(h, await shown(a.page), 'us', 'tab A at start');
      // opened from tab A, so it shares the session and isn't seeded again
      const [b] = await Promise.all([a.ctx.waitForEvent('page'), a.page.evaluate((u) => void window.open(u), h.server.url + '/?mute')]);
      await b.waitForFunction(() => !!window.__daily, null, { timeout: 60000 });
      await b.evaluate(() => window.__daily.go({ name: 'settings' }));
      const pickB = b.locator('.dq-settings .dq-region select');
      await pickB.waitFor();
      h.expect((await pickB.inputValue()) === 'us', 'tab B Settings does not show the device language country');
      await pickB.selectOption('uk');
      await a.page.waitForFunction(() => document.querySelector('.dq-region select')?.value === 'uk', null, { timeout: 10000 });
      expectRegion(h, await shown(a.page), 'uk', 'tab A after tab B picked the UK');
      await a.page.locator('.dq-region select').selectOption('au');
      await b.waitForFunction(() => document.querySelector('.dq-settings .dq-region select')?.value === 'au', null, { timeout: 10000 });
      const at = await a.page.evaluate(() => window.__daily.store.state.setAt.region);
      // another copy writes Ireland, first with a change older than tab A's, then with a newer one
      const push = (t) => b.evaluate(([key, t]) => {
        const s = JSON.parse(localStorage.getItem(key));
        s.profile.region = 'ie';
        s.profile.setAt.region = t;
        localStorage.setItem(key, JSON.stringify(s));
      }, [h.SAVE, t]);
      await push(at - 60000);
      await a.page.waitForTimeout(800);
      expectRegion(h, await shown(a.page), 'au', 'tab A after an older change');
      await push(at + 60000);
      await a.page.waitForFunction(() => document.querySelector('.dq-region select')?.value === 'ie', null, { timeout: 10000 });
      expectRegion(h, await shown(a.page), 'ie', 'tab A after a newer change');
      h.expect(!a.errors.length, a.errors.join(' | '));
    } finally {
      await a.ctx.close();
    }
  },

  /**
   * Restore never replaces a country picked on this device, even one the crystal changed later; a device that never
   * picked takes the crystal's; a country this build doesn't know shows "Somewhere else", never the device language's.
   */
  async 'crisis-lines-restore-rule'(h) {
    const crystal = (name, profile) => {
      const t = Date.now() - 3 * 86400e3;
      const file = path.join(h.out, `me97-${name}.json`);
      fs.writeFileSync(file, JSON.stringify({ app: 'the-quiet-lantern', v: 1, created: t, events: [{ id: `me97-${name}`, t, day: dayKey(t), k: 'visit', xp: 10 }], profile }));
      return file;
    };
    const restore = async (page, name, profile) => {
      await page.evaluate(() => window.__daily.go({ name: 'settings' }));
      await page.locator('input[type=file]').setInputFiles(crystal(name, profile));
      await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
      await page.waitForFunction((id) => window.__daily.store.state.events.some((e) => e.id === id), `me97-${name}`, { timeout: 15000 });
      await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await talk(page);
    };
    const later = await boot(h, { locale: 'en-US' });
    try {
      await talk(later.page);
      await later.page.locator('.dq-region select').selectOption('au');
      await restore(later.page, 'crystal-later', { region: 'in', setAt: { region: Date.now() + 3600e3 } });
      expectRegion(h, await shown(later.page), 'au', 'own pick after restoring a later pick');
    } finally {
      await later.ctx.close();
    }
    const unknown = await boot(h, { locale: 'en-US' });
    try {
      await restore(unknown.page, 'crystal-newer-build', { region: 'de', setAt: { region: Date.now() - 1000 } });
      const got = await shown(unknown.page);
      expectRegion(h, got, 'elsewhere', 'unknown country from a newer build');
      h.expect(got.text.includes('call your local emergency number'), 'unknown country: no local emergency number advice');
      const kept = await unknown.page.evaluate(() => window.__daily.store.state.settings.region);
      h.expect(kept === 'de', `the newer build's country was not kept (${kept})`);
      await unknown.page.reload();
      await h.reachHub(unknown.page);
      await talk(unknown.page);
      expectRegion(h, await shown(unknown.page), 'elsewhere', 'unknown country after a reload');
    } finally {
      await unknown.ctx.close();
    }
  },

  /** phone portrait, small phone and landscape: fits the width, call buttons above the picker, picker reachable and readable */
  async 'crisis-lines-screen-sizes'(h) {
    for (const [size, viewport] of [['390x844', TALL], ['320x568', SMALL], ['844x390', WIDE]]) {
      const { ctx, page, errors } = await boot(h, { locale: 'en-AU', viewport });
      try {
        await page.locator('header .dq-safe').click();
        await page.locator('.dq-sz-talk').waitFor();
        h.expect(await page.locator('.dq-sz-talk').isVisible(), `${size}: "Talk to someone now" is not pinned on the first Safe Zone screen`);
        await page.locator('.dq-sz-talk').click();
        await page.locator('.dq-region select').waitFor();
        await settled(page, '.dq-safezone');
        expectRegion(h, await shown(page), 'au', size);
        await h.shot(page, `me97-talk-au-${size}`);
        const m = await page.evaluate(() => {
          const call = document.querySelector('.dq-safezone .dq-res-a').getBoundingClientRect();
          const box = document.querySelector('.dq-region');
          const sel = box.querySelector('select');
          const out = [...document.querySelectorAll('.dq-safezone *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && (r.right > innerWidth + 1 || r.left < -1); }).map((e) => e.className || e.tagName);
          const firstCall = { top: call.top, bottom: call.bottom };
          box.scrollIntoView({ block: 'center' });
          // Talk has no pinned foot; where one shows, the picker has to clear it
          const f = document.querySelector('.dq-sz-foot').getBoundingClientRect();
          const foot = f.height ? f.top : innerHeight;
          const r = sel.getBoundingClientRect();
          return { innerHeight, foot, wide: document.documentElement.scrollWidth <= innerWidth, out, firstCall, pickTop: box.getBoundingClientRect().top + 0, sel: { top: r.top, bottom: r.bottom, height: r.height, right: r.right, font: parseFloat(getComputedStyle(sel).fontSize) }, label: box.querySelector('label')?.htmlFor === sel.id };
        });
        console.log(`  ${size}: ${JSON.stringify(m)}`);
        h.expect(m.wide && !m.out.length, `${size}: wider than the screen: ${m.out.join(', ')}`);
        h.expect(m.sel.top >= 0 && m.sel.bottom <= Math.min(m.foot, m.innerHeight) && m.sel.right <= viewport.width, `${size}: the picker can't be scrolled clear of the screen edge and the pinned foot`);
        h.expect(m.sel.height >= 44 && m.sel.font >= 16 && m.label, `${size}: picker is ${m.sel.height}px tall, ${m.sel.font}px text, labelled ${m.label}`);
        await settled(page, '.dq-region');
        await h.shot(page, `me97-talk-au-${size}-picker`);
        h.expect(!errors.length, `${size}: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  /**
   * Every phone, upright and sideways (ME-127, ME-210): the moment Talk opens, with no scrolling, the first call button is
   * whole on screen, clear of the top bar and anything pinned, and a tap anywhere on it lands on it. Every country,
   * opened from "Talk to someone now" and from "I might not be safe" (local emergency number first). With no lines
   * known, the same holds for the findahelpline link. At the four phone sizes the danger line ("If you are in danger right
   * now, call ...") is whole on screen too. Every text on Talk is at least 20 px and every button, link and picker at
   * least 44 px. 780x280 and 640x280 are Chrome on a 360 px Android phone held sideways, toolbar showing.
   */
  async 'crisis-lines-first-call-on-arrival'(h) {
    const failed = [];
    const sizes = [['390x844', TALL, true], ['320x568', SMALL, true], ['844x390', WIDE, true], ['568x320', SHORT, true], ['780x280', { width: 780, height: 280 }, false], ['640x280', { width: 640, height: 280 }, false]];
    for (const [size, viewport, note] of sizes) {
      const { ctx, page, errors } = await boot(h, { locale: 'en-US', viewport });
      try {
        for (const [id, want] of Object.entries(EXPECT)) {
          await page.evaluate((id) => {
            const st = window.__daily.store;
            st.state.settings.region = id;
            st.touch('region');
            st.save();
          }, id);
          for (const danger of [false, true]) {
            const label = `${size} ${id}${danger ? ', might not be safe' : ''}`;
            await page.evaluate(() => window.__daily.go({ name: 'hub' }));
            await page.locator('header .dq-safe').click();
            if (danger) await page.getByRole('button', { name: 'I might not be safe' }).click();
            else await page.locator('.dq-sz-talk').click();
            await page.locator('.dq-region select').waitFor();
            // fonts in and the screen's fade-in done, so the boxes and screenshots are what the player sees
            await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.querySelectorAll('.dq-sz-body, .dq-sz-body > *')].flatMap((e) => e.getAnimations()).map((a) => a.finished)]));
            const got = await page.evaluate(() => {
              const top = document.querySelector('.dq-top').getBoundingClientRect().bottom;
              const seen = (el) => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                // 4 px in from each corner, clear of the rounded corners; anything pinned over it takes the tap instead
                const at = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4], [r.left + r.width / 2, r.top + r.height / 2]];
                return {
                  box: [r.left, r.top, r.right, r.bottom].map(Math.round).join(', '),
                  whole: r.left >= 0 && r.right <= innerWidth && r.top >= top - 0.5 && r.bottom <= innerHeight + 0.5,
                  hit: at.every(([x, y]) => el.contains(document.elementFromPoint(x, y))),
                };
              };
              const a = document.querySelector('.dq-safezone .dq-res-a') ?? document.querySelector('.dq-safezone a[href="https://findahelpline.com"]');
              const tap = [...document.querySelectorAll('.dq-safezone :is(button, a[href], select), .dq-top .ca-sz-light')].filter((e) => !e.closest('.is-hidden'));
              const words = [...document.querySelectorAll('.dq-safezone *')].filter((e) => !e.closest('button, a, select, .dq-chip, .dq-sr, .is-hidden') && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
              return {
                href: a.getAttribute('href'),
                first: seen(a),
                note: seen([...document.querySelectorAll('.dq-safezone .dq-text')].find((p) => p.textContent.startsWith('If you are in danger right now, call'))),
                top: Math.round(top),
                tiny: tap.map((e) => [e.textContent.trim().slice(0, 24), e.getBoundingClientRect()]).filter(([, r]) => r.width < 44 || r.height < 44).map(([t, r]) => `${t} ${Math.round(r.width)}x${Math.round(r.height)}`),
                small: [...new Set(words.map((e) => [e.textContent.trim().slice(0, 24), parseFloat(getComputedStyle(e).fontSize)]).filter(([, px]) => px < 20).map(([t, px]) => `"${t}" ${px}px`))],
                wide: document.documentElement.scrollWidth <= innerWidth,
              };
            });
            const first = (danger ? want.sos[0] : want.hrefs[0]) ?? 'https://findahelpline.com';
            if (got.href !== first) failed.push(`${label}: the first button dials ${got.href}, want ${first}`);
            else if (!got.first.whole || !got.first.hit) failed.push(`${label}: ${first} at ${got.first.box} is not whole on screen below the top bar (${got.top}) or something pinned covers it`);
            if (danger && !got.note) failed.push(`${label}: no danger line naming the emergency number`);
            if (note && got.note && (!got.note.whole || !got.note.hit)) failed.push(`${label}: the danger line at ${got.note.box} is cut off or covered`);
            if (got.tiny.length) failed.push(`${label}: tap targets under 44 px: ${got.tiny.join(', ')}`);
            if (got.small.length) failed.push(`${label}: Safe Zone text under 20 px: ${got.small.join(', ')}`);
            if (!got.wide) failed.push(`${label}: the page scrolls sideways`);
            if (['us', 'ca', 'ie', 'elsewhere'].includes(id)) await h.shot(page, `me97-arrival-${id}${danger ? '-danger' : ''}-${size}`);
          }
        }
        if (errors.length) failed.push(`${size}: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!failed.length, failed.join('\n'));
  },
};
