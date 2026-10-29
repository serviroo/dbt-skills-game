// What comes due while the Safe Zone is open waits until the player leaves it, and nothing opens inside it:
//   safe-zone-welcome-waits  the first open's welcome when Home is left before it comes. For the Safe Zone, at 390x844
//                            and 320x568: nothing over the Safe Zone, the welcome kept in the save and a Save Crystal,
//                            then shown on Home once the player leaves. For Settings: shown back on Home. Through a
//                            reload: shown on Home. Shown in another open copy: not shown again here. Queued behind the
//                            daily gift when the Safe Zone opens: still owed, and shown on Home after leaving. The
//                            first save that counts the first visit already owes it
//   safe-zone-new-day-waits  a day that turns while the Safe Zone is open: nothing is credited inside, and the new
//                            day's visit counts as the player leaves. On Home a new day still counts at once
//   safe-zone-nothing-opens  due while inside, from elsewhere: a rank-up earned in another open copy, and the Home
//                            Screen note on an iPhone. Neither opens inside; the rank-up shows on Home after leaving,
//                            and the note isn't put away as if it had been read

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const WELCOME = /quiet side of the Lantern/;
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const HINT = 'dbt.install-hint.v1';

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Visited yesterday with `xp` more from a rest, so today's open counts a visit (rank D comes at 100 XP). */
function returning(xp = 0) {
  const t = Date.now() - 86400e3;
  const day = dayKey(t);
  const events = [{ id: 'waits-visit', t, day, k: 'visit', xp: 10 }];
  if (xp) events.push({ id: 'waits-rest', t: t + 1, day, k: 'rest', xp });
  return JSON.stringify({ v: 1, created: t, events, flags: { greetDay: day, giftDay: day, cardDay: day } });
}

async function open(h, { save, device, viewport = PHONE, init } = {}) {
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, ...(save ? { [h.SAVE]: save } : {}) };
  const prepare = async (c) => {
    await c.clock.install();
    if (init) await c.addInitScript(init, h.SAVE);
  };
  const { ctx, page, errors } = await h.open(seed, '?mute', viewport, prepare, device);
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
  return { ctx, page, errors };
}

/** Anything open over the screen: a Lantern window, the Home Screen note, a toast or the dim scrim. */
const opened = (page) =>
  page.evaluate(() => ({
    windows: [...document.querySelectorAll('.dq-sw')].map((w) => w.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)),
    note: document.querySelectorAll('.pwa-hint').length,
    toast: !!document.querySelector('.dq-toast.is-on'),
    scrim: !!document.querySelector('.dq-scrim.is-on'),
  }));
const nothing = (o) => !o.windows.length && !o.note && !o.toast && !o.scrim;
const welcome = (page) => page.waitForFunction((re) => [...document.querySelectorAll('.dq-sw')].some((w) => new RegExp(re).test(w.textContent)), WELCOME.source, { timeout: 5000 }).then(() => true, () => false);
/** The window has opened and typed its lines: its chevron pulses (or rests, with reduced motion). */
const typed = (page) =>
  page.waitForFunction(() => {
    const n = document.querySelector('.dq-sw .sw-next');
    return !!n && (n.getAnimations().length > 0 || n.style.opacity === '0.85');
  }, null, { timeout: 10000 });
const owed = (page) => page.evaluate(() => window.__daily.store.state.flags.welcomeOwed);
const screen = (page) => page.evaluate(() => window.__daily.route.name);
const counted = (page) =>
  page.evaluate(() => {
    const s = window.__daily.store;
    return { visits: s.state.events.filter((e) => e.k === 'visit').length, xp: s.derived().xp, today: s.today() };
  });

export const scenarios = {
  async 'safe-zone-welcome-waits'(h) {
    const problems = [];
    /** A first open, left by `leave` before the welcome comes: it comes 0.7 s after Home, and the clock stops here. */
    const firstOpen = async (tag, leave, viewport = PHONE) => {
      const { ctx, page, errors } = await open(h, { viewport });
      await h.pauseClock(page);
      const early = await opened(page);
      if (!nothing(early)) problems.push(`${tag}: the welcome came before Home could be left: ${JSON.stringify(early)}`);
      await leave(page);
      await page.clock.runFor(3000);
      return { ctx, page, errors };
    };
    const toSafe = (page) => page.locator('.dq-top .dq-safe').click();

    for (const viewport of [PHONE, SMALL]) {
      const tag = `Safe Zone ${viewport.width}x${viewport.height}`;
      const { ctx, page, errors } = await firstOpen(tag, toSafe, viewport);
      const inside = await opened(page);
      if ((await screen(page)) !== 'safe' || !nothing(inside)) problems.push(`${tag}: in the Safe Zone: ${await screen(page)}, ${JSON.stringify(inside)}`);
      await page.clock.resume();
      const kept = await page.evaluate(async () => {
        const { makeCrystal, readCrystal } = await import('/src/daily/crystal.ts');
        const { json } = await makeCrystal(window.__daily.store);
        const peek = await readCrystal(new File([json], 'crystal.json'));
        return { save: JSON.parse(localStorage.getItem(window.__daily.store.key)).flags.welcomeOwed, crystal: typeof peek === 'object' ? peek.data.flags.welcomeOwed : peek };
      });
      if (kept.save !== true || kept.crystal !== true) problems.push(`${tag}: the owed welcome is not kept in the save and a Save Crystal: ${JSON.stringify(kept)}`);
      await page.locator('.dq-top .dq-back').click();
      if (!(await welcome(page))) problems.push(`${tag}: back on Home the welcome did not come: ${JSON.stringify(await opened(page))}`);
      if (await owed(page)) problems.push(`${tag}: the welcome showed but is still owed`);
      await typed(page);
      await h.shot(page, `welcome-after-safe-zone-${viewport.width}x${viewport.height}`);
      problems.push(...errors.map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await firstOpen('Settings', (p) => p.locator('.dq-tile').filter({ hasText: 'Settings' }).click());
      if ((await screen(page)) !== 'settings' || !nothing(await opened(page))) problems.push(`Settings: something opened over Settings: ${JSON.stringify(await opened(page))}`);
      await page.clock.resume();
      await page.locator('header .dq-back').click();
      if (!(await welcome(page))) problems.push(`Settings: back on Home the welcome did not come: ${JSON.stringify(await opened(page))}`);
      problems.push(...errors.map((e) => `Settings: ${e}`));
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await firstOpen('reload', toSafe);
      await page.clock.resume();
      await page.reload();
      await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
      if (!(await welcome(page))) problems.push(`reload: the owed welcome did not come on Home: ${JSON.stringify(await opened(page))}`);
      problems.push(...errors.map((e) => `reload: ${e}`));
      await ctx.close();
    }
    {
      // the daily gift opened first: the welcome queues behind it, and the Safe Zone then closes both
      const { ctx, page, errors } = await firstOpen('gift', (p) => p.locator('.dq-chest').click());
      const queued = await opened(page);
      if (queued.windows.length !== 1 || !/Daily gift/.test(queued.windows[0])) problems.push(`gift: the gift is not the one window open: ${JSON.stringify(queued)}`);
      if (!(await owed(page))) problems.push('gift: the welcome waiting behind the gift is no longer owed');
      await toSafe(page);
      await page.clock.resume();
      await page.locator('.dq-top .dq-back').click();
      if (!(await welcome(page))) problems.push(`gift: back on Home the welcome did not come: ${JSON.stringify(await opened(page))}`);
      problems.push(...errors.map((e) => `gift: ${e}`));
      await ctx.close();
    }
    {
      // every save the first open writes: the one that counts the first visit already owes the welcome
      const record = (key) => {
        window.__saves = [];
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === key) {
            const s = JSON.parse(v);
            window.__saves.push({ visits: s.events.filter((e) => e.k === 'visit').length, owed: s.flags?.welcomeOwed === true });
          }
          return set.call(this, k, v);
        };
      };
      const { ctx, page, errors } = await open(h, { init: record });
      const first = await page.evaluate(() => window.__saves.find((s) => s.visits > 0));
      if (!first?.owed) problems.push(`first save: the save that counts the first visit does not owe the welcome: ${JSON.stringify(first)}`);
      problems.push(...errors.map((e) => `first save: ${e}`));
      await ctx.close();
    }
    {
      // shown in another open copy while this one is in the Safe Zone: this one doesn't show it again
      const { ctx, page, errors } = await firstOpen('two copies', toSafe);
      await page.clock.resume();
      const other = await ctx.newPage();
      await other.goto(page.url());
      if (!(await welcome(other))) problems.push(`two copies: the other copy did not show the owed welcome: ${JSON.stringify(await opened(other))}`);
      await page.waitForFunction(() => !window.__daily.store.state.flags.welcomeOwed, null, { timeout: 5000 }).catch(() => problems.push('two copies: the welcome shown in the other copy is still owed here'));
      await page.locator('.dq-top .dq-back').click();
      if (await welcome(page)) problems.push('two copies: the welcome showed again after the other copy had shown it');
      problems.push(...errors.map((e) => `two copies: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'safe-zone-new-day-waits'(h) {
    const problems = [];
    const { ctx, page, errors } = await open(h, { save: returning() });
    const tomorrow = () => page.evaluate(() => Date.now() + 86400e3).then((t) => page.clock.setSystemTime(t));
    // the phone comes back to the page, as when it is unlocked
    const shown = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const before = await counted(page);
    await page.locator('.dq-top .dq-safe').click();
    await page.waitForFunction(() => window.__daily.route.name === 'safe');
    await tomorrow();
    await shown();
    const inside = await counted(page);
    if (inside.visits !== before.visits || inside.xp !== before.xp) problems.push(`a new day was credited in the Safe Zone: ${JSON.stringify(before)} -> ${JSON.stringify(inside)}`);
    await page.locator('.dq-top .dq-back').click();
    await page.waitForFunction(() => window.__daily.route.name === 'hub');
    const left = await counted(page);
    if (left.visits !== before.visits + 1 || left.today === before.today) problems.push(`leaving did not count the new day's visit: ${JSON.stringify(before)} -> ${JSON.stringify(left)}`);
    await tomorrow();
    await shown();
    const home = await counted(page);
    if (home.visits !== left.visits + 1) problems.push(`on Home a new day did not count at once: ${JSON.stringify(left)} -> ${JSON.stringify(home)}`);
    h.expect(!problems.length && !errors.length, [...problems, ...errors].join('\n'));
    await ctx.close();
  },

  async 'safe-zone-nothing-opens'(h) {
    const problems = [];
    {
      // 90 XP with today's visit, rank E: another open copy earns the 20 XP that makes rank D while this one is in the
      // Safe Zone
      const { ctx, page, errors } = await open(h, { save: returning(70) });
      await page.locator('.dq-top .dq-safe').click();
      await page.waitForFunction(() => window.__daily.route.name === 'safe');
      const was = await page.evaluate(() => ({ xp: window.__daily.store.derived().xp, rank: window.__daily.store.derived().rank }));
      if (was.xp !== 90 || was.rank !== 0) problems.push(`before the other copy: ${JSON.stringify(was)}, not 90 XP and rank E`);
      const other = await ctx.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
      await other.evaluate(() => {
        window.__daily.store.add('rest', 20);
        window.__daily.store.save();
      });
      await page.waitForFunction(() => window.__daily.store.derived().rank === 1, null, { timeout: 10000 });
      await page.clock.runFor(3000);
      const inside = await opened(page);
      if (!nothing(inside)) problems.push(`a rank-up from another copy opened in the Safe Zone: ${JSON.stringify(inside)}`);
      await page.locator('.dq-top .dq-back').click();
      await page.clock.runFor(2000);
      const home = await opened(page);
      if (!home.windows.length) problems.push(`the rank-up did not show on Home after leaving: ${JSON.stringify(home)}`);
      problems.push(...errors);
      await ctx.close();
    }
    for (const safe of [false, true]) {
      // the note comes 1.5 s after Home on iPhone Safari: first on Home, to show it is due, then with the Safe Zone open
      const { ctx, page, errors } = await open(h, { save: returning(), device: { userAgent: SAFARI } });
      if (!safe) {
        await page.clock.runFor(5000);
        if (!(await opened(page)).note) problems.push('on Home the Home Screen note never came, so the Safe Zone check proves nothing');
        await ctx.close();
        continue;
      }
      await page.locator('.dq-top .dq-safe').click();
      await page.clock.runFor(5000);
      const inside = await opened(page);
      if ((await screen(page)) !== 'safe' || !nothing(inside)) problems.push(`the Home Screen note opened in the Safe Zone: ${JSON.stringify(inside)}`);
      if ((await h.ls(page, HINT)) !== null) problems.push('the Home Screen note was put away as read while the Safe Zone was open');
      problems.push(...errors);
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
