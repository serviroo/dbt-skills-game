// The game follows the device's reduce-motion setting while it shows, with no reload; on a first visit, and with
// Motion on Auto, it is the player's only one. In the intro, the title's slit and prompt, the chest hold's breathing,
// a Lantern window's plasma and waiting arrow, and the end card's slow drift stop as it is turned on and start again as
// it is turned off, and a closed window leaves nothing moving behind; turned on, the chest doesn't rattle as it
// charges and the hold's entrance is in place at once; with Motion saved as Full the title's breath carries on through
// a change. In the companion, the daily gift opened while it is on starts moving once it is turned off and stills again
// when it comes back on; in the Stealth Room, opened while it is on, the glow rests and the cat doesn't blep, then the
// glow breathes, the cat bleps and the shark swims again once it is turned off; A quiet minute's glow rests while it is
// on, breathes once it is turned off, and settles again when it comes back on. With Motion saved as Full, the glint on
// the card's back and the Story Room's scan keep moving whatever the device says.

const PHONE = { width: 390, height: 844 };

/** Sets the device's reduce-motion setting on `page` through CDP, as a change in the phone's own settings does. */
export async function deviceMotion(ctx, page) {
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

/**
 * How far the chest rocks (its rig's tilt) as it charges, at forty moments: the charge and the time are handed to the
 * chest as the stage would hand them. The lab's stage clock moves only as frames are drawn, which a software renderer
 * does slowly, so nothing here waits on it.
 */
const rattle = (page) =>
  page.evaluate(() => {
    const { chest } = window.__lab;
    const rig = chest.group.children[0];
    const tilts = [];
    for (let i = 0; i < 40; i++) {
      chest.setCharge(0.6);
      chest.update(10 + i * 0.037);
      tilts.push(Math.abs(rig.rotation.z));
    }
    return tilts;
  });

/** True once the game has the device's setting: it hears of it as the next frame is drawn, so this waits frame by frame. */
const reducedHere = (page, on) =>
  page.evaluate(async (on) => {
    const { params } = await import('/src/core/params.ts');
    for (let i = 0; i < 120 && params.reduced !== on; i++) await new Promise((r) => requestAnimationFrame(r));
    return params.reduced === on;
  }, on);

/** Animations under `selector` that never end. */
const endless = (page, selector) => page.evaluate((sel) => document.querySelector(sel).getAnimations({ subtree: true }).filter((a) => a.effect.getTiming().iterations === Infinity && a.playState !== 'idle').length, selector);

/** The end card's drift: an animation on its stage that never ends. */
const drifts = (page) => page.evaluate(() => document.querySelector('.ec-stage').getAnimations().filter((a) => a.effect.getTiming().iterations === Infinity && a.playState !== 'idle').length);

export const scenarios = {
  async 'intro-hold-follows-device-motion'(h) {
    // the hold alone in the window lab, which draws no chest. The page's animation clock stands still at first, so the
    // hold's entrance is still under way when the device setting changes, however slow the machine
    const ctx = await h.browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
    const device = (value) => cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
    await page.goto(h.server.url + '/?lab=window&kind=hold&mute');
    await page.locator('.chest-hold').waitFor({ state: 'attached' });
    /** Each of the entrance's animations, by its play state. */
    const entrance = () => page.evaluate(() => document.querySelector('.chest-hold').getAnimations({ subtree: true }).filter((a) => a.effect.getTiming().iterations !== Infinity).map((a) => a.playState));
    const coming = await entrance();
    h.expect(coming.length === 2 && coming.every((s) => s === 'running'), `the hold's entrance is not under way: ${JSON.stringify(coming)}`);
    await device('reduce');
    h.expect(await reducedHere(page, true), 'the game never heard the device turn reduce-motion on');
    const placed = await entrance();
    h.expect(placed.every((s) => s === 'finished'), `with the device's reduce-motion turned on, the hold kept coming in: ${JSON.stringify(placed)}`);
    // the breath runs on the same animation clock, which moves again from here
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    const still = await breaths(page, 1500);
    h.expect(still.length === 1 && Number(still[0]) === 0.5, `with the device's reduce-motion turned on, the hold kept breathing: ${JSON.stringify(still)}`);
    await device('no-preference');
    h.expect(await reducedHere(page, false), 'the game never heard the device turn reduce-motion off');
    const again = await breaths(page, 1500);
    h.expect(again.length > 3, `with it turned off again, the hold did not breathe: ${JSON.stringify(again)}`);
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
    const { ctx, page, errors } = await h.open({}, '?lab=chest&mute', PHONE);
    const device = await deviceMotion(ctx, page);
    // the lab is ready once its chest is built
    await page.waitForFunction(() => !!window.__lab?.chest);
    const moving = await rattle(page);
    h.expect(moving.some((t) => t > 0), `the chest does not rattle as it charges with motion on: ${JSON.stringify(moving)}`);
    await device('reduce');
    h.expect(await reducedHere(page, true), 'the game never heard the device turn reduce-motion on');
    const still = await rattle(page);
    h.expect(still.every((t) => t === 0), `with the device's reduce-motion turned on, the chest rattled as it charged: up to ${Math.max(...still)}`);
    await device('no-preference');
    h.expect(await reducedHere(page, false), 'the game never heard the device turn reduce-motion off');
    h.expect((await rattle(page)).some((t) => t > 0), 'with it turned off again, the chest no longer rattled');
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
    // the glow rests, and a blep's turn comes and goes with no blep
    const room = () => page.evaluate(() => ({ glow: document.querySelector('.dq-st-glow').getAnimations().length, opacity: getComputedStyle(document.querySelector('.dq-st-glow')).opacity }));
    const blep = () => page.evaluate(() => {
      window.__stealth.blep();
      return document.querySelector('.dq-st-cat').classList.contains('is-blep');
    });
    const still = { ...(await room()), blep: await blep() };
    h.expect(still.glow === 0 && Number(still.opacity) === 0.7 && !still.blep, `with reduce-motion on, the glow kept breathing or the cat blepped: ${JSON.stringify(still)}`);
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
    const moving = { ...(await room()), blep: await blep() };
    h.expect(moving.glow === 1 && moving.blep, `with it turned off, the glow did not breathe again or the cat did not blep: ${JSON.stringify(moving)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'quiet-minute-follows-device-motion'(h) {
    const day = (ms) => new Date(ms - 6 * 3600e3).toISOString().slice(0, 10);
    const t = Date.now() - 86400e3;
    const save = JSON.stringify({ v: 1, created: t, events: [{ id: 'motion-visit', t, day: day(t), k: 'visit', xp: 10 }], flags: { greetDay: day(t), cardDay: day(t), giftDay: day(t) } });
    const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 });
    const { ctx, page, errors } = await h.open({ [h.SAVE]: save, [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', PHONE, (c) => c.clock.install());
    const device = await deviceMotion(ctx, page);
    await h.reachHub(page);
    await device('reduce');
    await page.waitForFunction(() => window.__daily.reduced(), null, { timeout: 5000 });
    await page.evaluate(() => window.__daily.go({ name: 'ease' }));
    await page.locator('.dq-ease-glow').waitFor({ state: 'attached', timeout: 10000 });
    /** The opacity the screen gives its glow every half second for four seconds: one while it rests, several while it breathes. */
    const glow = async () => {
      const seen = new Set();
      for (let i = 0; i < 8; i++) {
        await page.clock.runFor(500);
        seen.add(await page.evaluate(() => document.querySelector('.dq-ease-glow').style.opacity));
      }
      return [...seen];
    };
    const still = await glow();
    h.expect(still.length === 1 && Number(still[0]) === 0.7, `with reduce-motion on, A quiet minute's glow kept breathing: ${JSON.stringify(still)}`);
    await device('no-preference');
    await page.waitForFunction(() => !window.__daily.reduced(), null, { timeout: 5000 });
    const moving = await glow();
    h.expect(moving.length > 3, `with it turned off, A quiet minute's glow did not breathe again: ${JSON.stringify(moving)}`);
    // turned on again mid-breath: the glow and the moth settle where they rest, not wherever the breath had them
    await device('reduce');
    await page.waitForFunction(() => window.__daily.reduced(), null, { timeout: 5000 });
    const settled = await glow();
    const placed = await page.evaluate(() => ({ glow: document.querySelector('.dq-ease-glow').style.transform, moth: document.querySelector('.dq-ease-sea').style.transform }));
    h.expect(settled.length === 1 && Number(settled[0]) === 0.7 && !placed.glow && !placed.moth, `turned on mid-visit, A quiet minute did not settle: ${JSON.stringify({ settled, placed })}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'full-motion-wins-over-device'(h) {
    const day = (ms) => new Date(ms - 6 * 3600e3).toISOString().slice(0, 10);
    const t = Date.now() - 86400e3;
    const save = JSON.stringify({ v: 1, created: t, events: [{ id: 'motion-visit', t, day: day(t), k: 'visit', xp: 10 }], flags: { greetDay: day(t), cardDay: day(t), giftDay: day(t) }, settings: { motion: 'full' } });
    const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 });
    const { ctx, page, errors } = await h.open({ [h.SAVE]: save, [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', PHONE);
    const device = await deviceMotion(ctx, page);
    await h.reachHub(page);
    await device('reduce');
    await h.frames(page, 2);
    h.expect(!(await page.evaluate(() => window.__daily.reduced())), 'with Motion on Full, the device setting took over');
    // today's card, still face down on Home, keeps the glint on its back
    await page.locator('.dq-slit').first().waitFor({ state: 'attached', timeout: 10000 });
    const glint = await page.evaluate(() => document.querySelector('.dq-slit').getAnimations().length);
    h.expect(glint === 1, `with Motion on Full, the device's reduce-motion stopped the glint on the card's back (${glint})`);
    // the Story Room's scan, shown while the co-writer works, keeps moving
    const id = await page.evaluate(async () => {
      const { storyStore } = await import('/src/daily/storystore.ts');
      return (await storyStore(window.__daily.store.key).create('A story')).story.id;
    });
    await page.evaluate((id) => window.__daily.go({ name: 'write', id }), id);
    await page.locator('.st-wait').waitFor({ state: 'attached', timeout: 10000 });
    const scan = await page.evaluate(() => {
      document.querySelector('.st-wait').classList.remove('is-hidden');
      return document.querySelector('.st-scan').getAnimations().length;
    });
    h.expect(scan === 1, `with Motion on Full, the device's reduce-motion stopped the Story Room's scan (${scan})`);
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
