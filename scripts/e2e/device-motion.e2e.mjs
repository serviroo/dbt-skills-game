// The game follows the device's reduce-motion setting while it shows, with no reload; on a first visit, and with
// Motion on Auto, it is the player's only one. In the intro, the title's slit and prompt, the chest hold's breathing,
// a Lantern window's plasma and waiting arrow, and the end card's slow drift stop as it is turned on and start again as
// it is turned off, and a closed window leaves nothing moving behind; turned on before the chest is held, the chest
// doesn't rattle as it charges; with Motion saved as Full the title's breath carries on through a change. In the
// companion, the daily gift opened while it is on starts moving once it is turned off and stills again when it comes
// back on, and the Stealth Room's shark, opened while it is on, swims again once it is turned off.

const PHONE = { width: 390, height: 844 };

/** Sets the device's reduce-motion setting on `page` through CDP, as a change in the phone's own settings does. */
async function deviceMotion(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  return (value) => cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
}

/** Every --breath value the hold shows over `ms`: many while it breathes, one steady 0.5 while it is still. */
const breaths = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        const root = document.querySelector('.chest-hold');
        const seen = new Set();
        const end = performance.now() + ms;
        const tick = () => {
          seen.add(root.style.getPropertyValue('--breath'));
          if (performance.now() < end) requestAnimationFrame(tick);
          else done([...seen]);
        };
        tick();
      }),
    ms,
  );

/** The window's endless animations (the plasma along its bars, the waiting arrow's pulse), and the arrow's opacity. */
const windowMotion = (page) =>
  page.evaluate(() => {
    const w = document.querySelector('.sw');
    const endless = w.getAnimations({ subtree: true }).filter((a) => a.effect.getTiming().iterations === Infinity && a.playState !== 'idle');
    return { endless: endless.length, arrow: endless.some((a) => a.effect.target.matches('.sw-next')), opacity: getComputedStyle(w.querySelector('.sw-next')).opacity };
  });

/** How far the chest rocks (its rig's tilt) on every frame while it charges, over `ms`. */
const rattle = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        const rig = window.__lab.chest.group.children[0];
        const tilts = [];
        const end = performance.now() + ms;
        const tick = () => {
          const c = window.__lab.charge;
          if (c > 0 && c < 0.999) tilts.push(Math.abs(rig.rotation.z));
          if (performance.now() < end && c < 0.999) requestAnimationFrame(tick);
          else done(tilts);
        };
        tick();
      }),
    ms,
  );

/** Animations under `selector` that never end. */
const endless = (page, selector) => page.evaluate((sel) => document.querySelector(sel).getAnimations({ subtree: true }).filter((a) => a.effect.getTiming().iterations === Infinity && a.playState !== 'idle').length, selector);

/** The end card's drift: an animation on its stage that never ends. */
const drifts = (page) => page.evaluate(() => document.querySelector('.ec-stage').getAnimations().filter((a) => a.effect.getTiming().iterations === Infinity && a.playState !== 'idle').length);

export const scenarios = {
  async 'intro-hold-follows-device-motion'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=chest&mute', PHONE);
    const device = await deviceMotion(ctx, page);
    await page.locator('.chest-hold').waitFor({ timeout: 30000 });
    const moving = await breaths(page, 1500);
    h.expect(moving.length > 3, `the hold does not breathe with motion on: ${JSON.stringify(moving)}`);
    await device('reduce');
    await h.frames(page, 2);
    const still = await breaths(page, 1500);
    h.expect(still.length === 1 && Number(still[0]) === 0.5, `with the device's reduce-motion turned on, the hold kept breathing: ${JSON.stringify(still)}`);
    await device('no-preference');
    await h.frames(page, 2);
    const again = await breaths(page, 1500);
    h.expect(again.length > 3, `with it turned off again, the hold stayed still: ${JSON.stringify(again)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'intro-window-follows-device-motion'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=window&kind=notification&mute', PHONE);
    const device = await deviceMotion(ctx, page);
    // typed out, the window waits on a tap with its arrow pulsing
    await page.waitForFunction(() => document.querySelector('.sw .sw-next')?.getAnimations().length > 0, null, { timeout: 30000 });
    const moving = await windowMotion(page);
    h.expect(moving.endless > 1 && moving.arrow, `the waiting window does not move with motion on: ${JSON.stringify(moving)}`);
    await device('reduce');
    await h.frames(page, 2);
    const still = await windowMotion(page);
    h.expect(still.endless === 0 && Number(still.opacity) === 0.85, `with the device's reduce-motion turned on, the window kept moving: ${JSON.stringify(still)}`);
    await device('no-preference');
    await h.frames(page, 2);
    const again = await windowMotion(page);
    h.expect(again.endless === moving.endless && again.arrow, `with it turned off again, the window stayed still: ${JSON.stringify(again)}`);
    // closed, it leaves nothing moving: every endless animation it ran, the arrow's pulse among them, is stopped
    await page.evaluate(() => (window.__endless = document.querySelector('.sw').getAnimations({ subtree: true }).filter((a) => a.effect.getTiming().iterations === Infinity)));
    await page.evaluate(() => window.__win.close());
    await page.waitForFunction(() => !document.querySelector('.sw'), null, { timeout: 5000 });
    const left = await page.evaluate(() => window.__endless.filter((a) => a.playState !== 'idle').map((a) => a.effect.target.className));
    h.expect(!left.length, `the closed window left endless animations running on: ${JSON.stringify(left)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'intro-chest-follows-device-motion'(h) {
    // the chest is built as the beat starts; the device turns reduce-motion on before the scripted hold at 3.3 s
    const { ctx, page, errors } = await h.open({}, '?lab=chest&autohold=1&mute', PHONE);
    const device = await deviceMotion(ctx, page);
    await page.waitForFunction(() => !!window.__lab?.chest, null, { timeout: 30000 });
    h.expect(await page.evaluate(() => window.__lab.charge === 0), 'the hold had begun before the device setting could change');
    await device('reduce');
    await page.waitForFunction(() => window.__lab.charge > 0, null, { timeout: 30000 });
    const tilts = await rattle(page, 4000);
    h.expect(tilts.length > 10 && tilts.every((t) => t === 0), `with the device's reduce-motion turned on, the chest rattled as it charged: ${tilts.length} frames, up to ${Math.max(...tilts)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'companion-window-follows-device-motion'(h) {
    const day = (ms) => new Date(ms - 6 * 3600e3).toISOString().slice(0, 10);
    const t = Date.now() - 86400e3;
    const save = JSON.stringify({ v: 1, created: t, events: [{ id: 'motion-visit', t, day: day(t), k: 'visit', xp: 10 }], flags: { greetDay: day(t), cardDay: day(t), giftDay: day(t) } });
    const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 });
    const { ctx, page, errors } = await h.open({ [h.SAVE]: save, [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', PHONE);
    const device = await deviceMotion(ctx, page);
    await h.reachHub(page);
    await device('reduce');
    await page.locator('.dq-chest').click();
    await page.waitForFunction(() => {
      const n = document.querySelector('.dq-sw .sw-next');
      return !!n && getComputedStyle(n).opacity === '0.85';
    }, null, { timeout: 15000 });
    const read = async () => ({ ...(await windowMotion(page)), still: await page.evaluate(() => document.querySelector('.dq-sw').classList.contains('dq-sw--still')) });
    const opened = await read();
    h.expect(opened.endless === 0 && opened.still, `the gift opened with reduce-motion on is not still: ${JSON.stringify(opened)}`);
    await device('no-preference');
    await h.frames(page, 2);
    const moving = await read();
    h.expect(moving.endless > 1 && moving.arrow && !moving.still, `with the device's reduce-motion turned off, the gift stayed still: ${JSON.stringify(moving)}`);
    await device('reduce');
    await h.frames(page, 2);
    const again = await read();
    h.expect(again.endless === 0 && again.still && Number(again.opacity) === 0.85, `with it turned on again, the gift kept moving: ${JSON.stringify(again)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'intro-title-follows-device-motion'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=window&kind=title&mute', PHONE);
    const device = await deviceMotion(ctx, page);
    await page.locator('.title-screen').waitFor({ timeout: 30000 });
    h.expect((await endless(page, '.title-screen')) === 2, `the title's slit and prompt do not move with motion on (${await endless(page, '.title-screen')})`);
    await device('reduce');
    await h.frames(page, 2);
    h.expect((await endless(page, '.title-screen')) === 0, `with the device's reduce-motion turned on, the title kept moving (${await endless(page, '.title-screen')})`);
    await device('no-preference');
    await h.frames(page, 2);
    h.expect((await endless(page, '.title-screen')) === 2, `with it turned off again, the title stayed still (${await endless(page, '.title-screen')})`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    // Motion saved as Full: the device's setting changes nothing, so the slit's breath runs on, not from its start
    const full = await h.open({ [h.SAVE]: JSON.stringify({ v: 1, settings: { motion: 'full' } }) }, '?lab=window&kind=title&mute', PHONE);
    const fullDevice = await deviceMotion(full.ctx, full.page);
    await full.page.locator('.title-screen').waitFor({ timeout: 30000 });
    await full.page.evaluate(() => (window.__breath = document.querySelector('.title-slit').getAnimations()[0]));
    await fullDevice('reduce');
    await h.frames(full.page, 2);
    const kept = await full.page.evaluate(() => ({ same: document.querySelector('.title-slit').getAnimations()[0] === window.__breath, running: window.__breath.playState === 'running' }));
    h.expect(kept.same && kept.running, `with Motion on Full, a device change restarted the title's breath: ${JSON.stringify(kept)}`);
    h.expect(!full.errors.length, full.errors.join('\n'));
    await full.ctx.close();
  },

  async 'stealth-follows-device-motion'(h) {
    const day = (ms) => new Date(ms - 6 * 3600e3).toISOString().slice(0, 10);
    const t = Date.now() - 86400e3;
    const save = JSON.stringify({ v: 1, created: t, events: [{ id: 'motion-visit', t, day: day(t), k: 'visit', xp: 10 }], flags: { greetDay: day(t), cardDay: day(t), giftDay: day(t) } });
    const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 });
    const { ctx, page, errors } = await h.open({ [h.SAVE]: save, [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', PHONE, (c) => c.clock.install());
    const device = await deviceMotion(ctx, page);
    await h.reachHub(page);
    await device('reduce');
    // the room is built once the game has the device's setting
    await page.waitForFunction(() => window.__daily.reduced(), null, { timeout: 5000 });
    await page.evaluate(() => window.__daily.go({ name: 'rest' }));
    await page.locator('.dq-st-shark').waitFor({ state: 'attached', timeout: 10000 });
    // every time the shark sets off
    await page.evaluate(() => {
      window.__swims = 0;
      const shark = document.querySelector('.dq-st-shark');
      new MutationObserver(() => shark.classList.contains('is-swim') && window.__swims++).observe(shark, { attributes: true, attributeFilter: ['class'] });
    });
    await page.clock.runFor(20000);
    h.expect((await page.evaluate(() => window.__swims)) === 0, 'with reduce-motion on, the shark swam');
    await device('no-preference');
    // the next swim is due 45 to 100 s after the first
    await page.clock.runFor(110000);
    h.expect((await page.evaluate(() => window.__swims)) > 0, 'with the device\'s reduce-motion turned off, the shark never swam');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'intro-end-card-follows-device-motion'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=window&kind=endcard&mute', PHONE);
    const device = await deviceMotion(ctx, page);
    await page.locator('.ec-stage').waitFor({ timeout: 30000 });
    h.expect((await drifts(page)) === 1, `the end card does not drift with motion on (${await drifts(page)} drifting)`);
    await device('reduce');
    await h.frames(page, 2);
    h.expect((await drifts(page)) === 0, `with the device's reduce-motion turned on, the end card kept drifting (${await drifts(page)})`);
    await device('no-preference');
    await h.frames(page, 2);
    h.expect((await drifts(page)) === 1, `with it turned off again, the end card did not drift again (${await drifts(page)})`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
