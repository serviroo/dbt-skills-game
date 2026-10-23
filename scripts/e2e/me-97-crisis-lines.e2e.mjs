// Crisis lines by country (ME-97): the Safe Zone's Talk screen shows the verified lines for the player's country,
// picked from the device language until the player chooses, changeable in one tap there and in Settings.
import path from 'node:path';

// Written out by hand from the verified table, so a wrong number in the app fails here.
const EXPECT = {
  us: { locale: 'en-US', name: 'United States', hrefs: ['tel:988', 'sms:988', 'sms:741741?body=HOME', 'tel:911', 'tel:18007997233', 'sms:88788?body=START'], sos: ['tel:911'] },
  ca: { locale: 'en-CA', name: 'Canada', hrefs: ['tel:988', 'sms:988', 'tel:911'], sos: ['tel:911'] },
  uk: { locale: 'en-GB', name: 'United Kingdom', hrefs: ['tel:116123', 'sms:85258?body=SHOUT', 'tel:999'], sos: ['tel:999'] },
  ie: { locale: 'en-IE', name: 'Ireland', hrefs: ['tel:116123', 'sms:50808?body=HELLO', 'tel:112', 'tel:999', 'tel:1800341900'], sos: ['tel:112', 'tel:999'] },
  au: { locale: 'en-AU', name: 'Australia', hrefs: ['tel:131114', 'sms:0477131114', 'tel:1800737732', 'sms:0458737732', 'tel:000'], sos: ['tel:000'] },
  nz: { locale: 'en-NZ', name: 'New Zealand', hrefs: ['tel:1737', 'sms:1737', 'tel:0800733843', 'tel:111'], sos: ['tel:111'] },
  in: { locale: 'en-IN', name: 'India', hrefs: ['tel:14416', 'tel:181', 'tel:112'], sos: ['tel:112'] },
  elsewhere: { locale: 'de-DE', name: 'Somewhere else', hrefs: [], sos: [] },
};
const TALL = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
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
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 60000 });
  return { ctx, page, errors };
}

async function talk(page, { danger = false } = {}) {
  await page.locator('header .dq-safe').click();
  if (danger) await page.getByRole('button', { name: 'I might not be safe' }).click();
  else await page.locator('.dq-sz-talk').click();
  await page.locator('.dq-region select').waitFor();
  await page.waitForTimeout(1500);
}

const shown = (page) =>
  page.evaluate(() => ({
    hrefs: [...document.querySelectorAll('.dq-safezone .dq-res-a')].map((a) => a.getAttribute('href')),
    first: [...(document.querySelector('.dq-safezone .dq-res')?.querySelectorAll('.dq-res-a') ?? [])].map((a) => a.getAttribute('href')),
    region: document.querySelector('.dq-region select')?.value,
    regionName: document.querySelector('.dq-region select')?.selectedOptions[0]?.textContent,
    text: document.querySelector('.dq-safezone')?.textContent ?? '',
    help: !!document.querySelector('.dq-safezone a[href="https://findahelpline.com"]'),
  }));

function expectRegion(h, got, id, label) {
  const want = EXPECT[id];
  h.expect(got.region === id && got.regionName === want.name, `${label}: picker shows ${got.region} (${got.regionName}), want ${id}`);
  h.expect(JSON.stringify(got.hrefs) === JSON.stringify(want.hrefs), `${label}: lines ${JSON.stringify(got.hrefs)}, want ${JSON.stringify(want.hrefs)}`);
  h.expect(got.help, `${label}: the findahelpline link is missing`);
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
      await page.locator('.dq-region select').selectOption('nz');
      await page.waitForFunction(() => document.querySelector('.dq-safezone .dq-res-a')?.getAttribute('href') === 'tel:1737');
      expectRegion(h, await shown(page), 'nz', 'picked in the Safe Zone');
      const saved = await page.evaluate(() => window.__daily.store.state.settings.region);
      h.expect(saved === 'nz', `the choice was not saved (${saved})`);
      await page.reload();
      await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 60000 });
      await talk(page);
      expectRegion(h, await shown(page), 'nz', 'after a reload');
      await page.evaluate(() => window.__daily.go({ name: 'settings' }));
      const picker = page.locator('.dq-settings .dq-region select');
      await picker.waitFor();
      h.expect((await picker.inputValue()) === 'nz', 'Settings does not show the chosen country');
      await picker.selectOption('au');
      await picker.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await h.shot(page, 'me97-settings-au-390');
      await ctx.setOffline(true);
      await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await talk(page);
      expectRegion(h, await shown(page), 'au', 'picked in Settings, offline');
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
      await b.page.waitForFunction(() => window.__daily.store.state.settings.region === 'in', null, { timeout: 15000 });
      await b.page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await talk(b.page);
      expectRegion(h, await shown(b.page), 'in', 'restored on a new device');
    } finally {
      await b.ctx.close();
    }
  },
};
