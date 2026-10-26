// Urgent help first: after "Higher" the Safe Zone keeps "Talk to someone now" above every screen for the visit, "I
// might not be safe" puts that country's emergency calls before every other line, and leaving starts the next visit
// plainly. Emergency numbers below are checked against each country's official sources, independently of the app.

const SIZES = [
  ['390x844', { width: 390, height: 844 }],
  ['320x568', { width: 320, height: 568 }],
  ['844x390', { width: 844, height: 390 }],
  ['1280x800', { width: 1280, height: 800 }],
];
const EMERGENCY = { us: ['911'], ca: ['911'], uk: ['999'], ie: ['112', '999'], au: ['000'], nz: ['111'], in: ['112'], sg: ['995', '999'], za: ['112', '10177'], mt: ['112'] };

async function home(h, viewport) {
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN };
  const { ctx, page, errors } = await h.open(seed, '?mute', viewport);
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss().catch(() => {});
  });
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
  return { ctx, page, errors, dialogs };
}

const progress = (page) =>
  page.evaluate(() => {
    const s = window.__daily.store.state;
    return JSON.stringify({ n: s.events.length, xp: s.events.reduce((a, e) => a + (e.xp || 0), 0) });
  });

const heading = (page, text) => page.locator('.dq-sz-t', { hasText: text }).first().waitFor({ timeout: 10000 });

async function enter(page) {
  await page.getByRole('button', { name: 'Safe Zone, help right now' }).click();
  await page.waitForFunction(() => window.__daily.route.name === 'safe' && !!document.querySelector('.dq-sz-t'), null, { timeout: 10000 });
}

/** Where "Talk to someone now" is, and whether a tap at its centre lands on it. */
const talk = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.dq-sz-talk');
    const frame = document.querySelector('.dq-sz').getBoundingClientRect();
    if (!b || !b.checkVisibility()) return { shown: false };
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { shown: true, top: Math.round(r.top), bottom: Math.round(r.bottom), frameTop: Math.round(frame.top), whole: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, hit: !!hit && b.contains(hit), upper: r.bottom <= innerHeight / 2, strong: b.classList.contains('is-strong') };
  });

const toBottom = (page) =>
  page.evaluate(async () => {
    for (const s of [document.querySelector('.dq-sz-body'), document.querySelector('.dq')]) s.scrollTop = s.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

/** Every call or text action on Talk, in order, and whether it is an emergency call for `region`. */
const actions = (page, region) =>
  page.evaluate((nums) => [...document.querySelectorAll('.dq-res-list .dq-res-a')].map((a) => ({ href: a.getAttribute('href'), sos: nums.some((n) => a.getAttribute('href') === `tel:${n}`) })), EMERGENCY[region] ?? []);

const dangerLine = (page) => page.evaluate(() => [...document.querySelectorAll('.dq-sz-danger')].map((e) => e.textContent.trim()));

export const scenarios = {
  /** "Higher" brings "Talk to someone now" above the screen, on arrival and after scrolling, at every size */
  async 'urgent-higher-talk-first'(h) {
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors, dialogs } = await home(h, viewport);
      const before = await progress(page);
      await enter(page);
      await page.getByRole('button', { name: 'Calm my body first' }).click();
      await heading(page, 'Breathe with the light');
      const calm = await talk(page);
      h.expect(calm.shown && !calm.strong && calm.top > calm.frameTop, `${tag}: before Higher, Talk is not the usual bottom link: ${JSON.stringify(calm)}`);
      for (const next of ['Squeeze and release', 'Cool air', 'Is it even a little lower?']) {
        await page.locator('.dq-sz-main').getByRole('button', { name: 'Next', exact: true }).last().click();
        await heading(page, next);
      }
      await page.getByRole('button', { name: 'Higher' }).click();
      await heading(page, 'Talk to someone now');
      h.expect(!(await dangerLine(page)).length, `${tag}: Higher showed the danger line: ${await dangerLine(page)}`);
      const first = (await actions(page, 'us'))[0];
      h.expect(first && !first.sos, `${tag}: Higher put an emergency call first: ${JSON.stringify(first)}`);

      await page.getByRole('button', { name: 'Back to breathing' }).click();
      await heading(page, 'Breathe with the light');
      const top = await talk(page);
      h.expect(top.shown && top.bottom <= top.frameTop + 1, `${tag}: after Higher, Talk is not above the screen: ${JSON.stringify(top)}`);
      h.expect(top.whole && top.hit && top.strong, `${tag}: after Higher, Talk is not whole, tappable and strong at the top: ${JSON.stringify(top)}`);
      await h.shot(page, `urgent-top-${tag}`);
      await page.locator('.dq-sz-main').getByRole('button', { name: 'Next', exact: true }).last().click();
      await heading(page, 'Squeeze and release');
      await page.locator('.dq-sz-main').getByRole('button', { name: 'Next', exact: true }).last().click();
      await heading(page, 'Cool air');
      await toBottom(page);
      const scrolled = await talk(page);
      h.expect(scrolled.shown && scrolled.whole && scrolled.hit && scrolled.upper, `${tag}: scrolled down, Talk is not still at the top and tappable: ${JSON.stringify(scrolled)}`);
      await h.shot(page, `urgent-top-scrolled-${tag}`);
      await page.locator('.dq-sz-talk').click();
      await heading(page, 'Talk to someone now');
      h.expect((await talk(page)).shown === false, `${tag}: Talk's own screen still shows the Talk link`);
      h.expect((await progress(page)) === before, `${tag}: the Safe Zone changed progress: ${before} -> ${await progress(page)}`);
      h.expect(!dialogs.length && !errors.length, `${tag}: ${[...dialogs, ...errors].join('\n')}`);
      await ctx.close();
    }
  },

  /** "I might not be safe" puts the emergency calls first in every country, through a country change, and only for this visit */
  async 'urgent-danger-every-country'(h) {
    const { ctx, page, errors, dialogs } = await home(h, { width: 390, height: 844 });
    const before = await progress(page);
    await enter(page);
    await page.getByRole('button', { name: 'I might not be safe' }).click();
    await heading(page, 'Talk to someone now');
    const picker = page.locator('.dq-region select');
    for (const region of Object.keys(EMERGENCY)) {
      await picker.selectOption(region);
      await page.waitForFunction((r) => document.querySelector('.dq-region select')?.value === r, region);
      const acts = await actions(page, region);
      const sos = acts.filter((a) => a.sos).map((a) => a.href);
      const lastSos = acts.findLastIndex((a) => a.sos);
      const firstLine = acts.findIndex((a) => !a.sos);
      h.expect(JSON.stringify(sos) === JSON.stringify(EMERGENCY[region].map((n) => `tel:${n}`)), `${region}: emergency calls ${JSON.stringify(sos)}`);
      h.expect(firstLine === -1 || lastSos < firstLine, `${region}: a support line comes before an emergency call: ${JSON.stringify(acts)}`);
      const said = await dangerLine(page);
      h.expect(said.length === 1 && EMERGENCY[region].every((n) => said[0].includes(n)), `${region}: danger line ${JSON.stringify(said)}`);
    }
    await picker.selectOption('elsewhere');
    await page.waitForFunction(() => document.querySelector('.dq-region select')?.value === 'elsewhere');
    h.expect(!(await actions(page, 'elsewhere')).length, 'Somewhere else: shows a call button from some country');
    h.expect(JSON.stringify(await dangerLine(page)) === JSON.stringify(['If you are in danger right now, call your local emergency number.']), `Somewhere else: danger line ${await dangerLine(page)}`);
    h.expect(await page.getByRole('link', { name: 'findahelpline.com' }).isVisible(), 'Somewhere else: no directory link');

    await picker.selectOption('ie');
    await page.getByRole('button', { name: 'Back to breathing' }).click();
    await heading(page, 'Breathe with the light');
    const top = await talk(page);
    h.expect(top.shown && top.bottom <= top.frameTop + 1 && top.hit, `danger: Talk is not above the screen after leaving Talk: ${JSON.stringify(top)}`);
    await page.locator('.dq-sz-talk').click();
    await heading(page, 'Talk to someone now');
    const ie = await actions(page, 'ie');
    h.expect(ie[0]?.sos && ie[1]?.sos, `danger after a country change and breathing: Ireland's emergency calls are not first: ${JSON.stringify(ie)}`);

    await page.getByRole('button', { name: 'Leave' }).click();
    await page.waitForFunction(() => window.__daily.route.name === 'hub');
    await enter(page);
    const fresh = await talk(page);
    h.expect(fresh.shown && !fresh.strong && fresh.top > fresh.frameTop, `next visit: Talk is still pinned at the top: ${JSON.stringify(fresh)}`);
    await page.getByRole('button', { name: 'I need a person now' }).click();
    await heading(page, 'Talk to someone now');
    h.expect(!(await dangerLine(page)).length && !(await actions(page, 'ie'))[0]?.sos, 'next visit: still treated as danger');
    h.expect((await progress(page)) === before, `the Safe Zone changed progress: ${before} -> ${await progress(page)}`);
    h.expect(!dialogs.length && !errors.length, [...dialogs, ...errors].join('\n'));
    await ctx.close();
  },
};
