// The game follows the device's reduce-motion setting while it shows, with no reload; on a first visit, and with
// Motion on Auto, it is the player's only one. In the intro, the title's slit and prompt, the chest hold's breathing,
// a Lantern window's plasma and waiting arrow, and the end card's slow drift stop as it is turned on and start again as
// it is turned off, and a closed window leaves nothing moving behind; turned on, the chest doesn't rattle as it
// charges and the hold's entrance is in place at once; with Motion saved as Full the title's breath carries on through
// a change. In the companion, the daily gift opened while it is on starts moving once it is turned off and stills again
// when it comes back on; in the Stealth Room, opened while it is on, the glow rests and the cat doesn't blep, then the
// glow breathes, the cat bleps and the shark swims again once it is turned off; A quiet minute's glow rests while it is
// on, breathes once it is turned off, and settles again when it comes back on. With Motion saved as Full, the glint on
// the card's back and the Story Room's scan keep moving whatever the device says. The title's pulses and the end card's
// drift end with their screen, however it goes, a capture's wait on a dismissed window's typing ends with it, and the
// Stealth Room's Breathing words still breathe with its glow once motion is back. Motion chosen in another open tab
// reaches the intro the same way, with no reload: Reduced stills the title, a waiting window, the hold's breathing and
// the end card's drift, and Auto moves them again; a window still opening and the end card still coming in land where
// they end at once, also in a tab stopped for a while just as the change is made; one made while this tab was in the
// page cache or out of sight reaches its title once it is back.

const PHONE = { width: 390, height: 844 };

/** Sets the device's reduce-motion setting on `page` through CDP, as a change in the phone's own settings does. */
export async function deviceMotion(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  return (value) => cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
}

/**
 * Every --breath value the hold shows over the next `frames` frames it draws: many while it breathes, one steady 0.5
 * while it is still. Counted in frames, not time: a page a busy host lets draw only now and then shows as many, only
 * later.
 */
const breaths = (page, frames) =>
  page.evaluate(async (frames) => {
    const root = document.querySelector('.chest-hold');
    const seen = new Set();
    for (let i = 0; i < frames; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      seen.add(root.style.getPropertyValue('--breath'));
    }
    return [...seen];
  }, frames);

/** Resolves once the page has drawn `n` more frames, however long it is stopped meanwhile. */
const drawn = (page, n) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);

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

/**
 * True once the game has motion `on`. It hears of the device's setting as the next frame is drawn, and of another tab's
 * Motion once the page runs again, so this waits frame by frame: a page stopped for a while uses none of the wait.
 */
const reducedHere = (page, on) =>
  page.evaluate(async (on) => {
    const { params } = await import('/src/core/params.ts');
    for (let i = 0; i < 120 && params.reduced !== on; i++) await new Promise((r) => requestAnimationFrame(r));
    return params.reduced === on;
  }, on);

/** Animations under `selector` that never end. */
const endless = (page, selector) => page.evaluate((sel) => document.querySelector(sel).getAnimations({ subtree: true }).filter((a) => a.effect.getTiming().iterations === Infinity && a.playState !== 'idle').length, selector);

/** True once `n` animations under `selector` never end, looked at frame by frame for 300 frames the page draws. */
const endlessReach = (page, selector, n) =>
  page.evaluate(
    async ([sel, n]) => {
      for (let i = 0; i < 300; i++) {
        if (document.querySelector(sel).getAnimations({ subtree: true }).filter((a) => a.effect.getTiming().iterations === Infinity && a.playState !== 'idle').length === n) return true;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return false;
    },
    [selector, n],
  );

/** The end card's drift: an animation on its stage that never ends. */
const drifts = (page) => page.evaluate(() => document.querySelector('.ec-stage').getAnimations().filter((a) => a.effect.getTiming().iterations === Infinity && a.playState !== 'idle').length);

/**
 * Stops the page, as a software renderer (CI's SwiftShader) does while it compiles a new frame's shaders: it runs nothing
 * until resume(), so whatever comes meanwhile, a change from another tab among it, waits for it. read(fn, arg) looks into
 * it meanwhile, where page.evaluate would wait for it to run again. Resolves once the page has stopped.
 */
const pause = async (ctx, page) => {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Debugger.enable');
  const stopped = new Promise((r) => cdp.once('Debugger.paused', r));
  await cdp.send('Debugger.pause');
  await stopped;
  return {
    async read(fn, arg) {
      const r = await cdp.send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg)})`, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async resume() {
      await cdp.send('Debugger.resume');
      await cdp.detach();
    },
  };
};

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
    const still = await breaths(page, 8);
    h.expect(still.length === 1 && Number(still[0]) === 0.5, `with the device's reduce-motion turned on, the hold kept breathing: ${JSON.stringify(still)}`);
    await device('no-preference');
    h.expect(await reducedHere(page, false), 'the game never heard the device turn reduce-motion off');
    const again = await breaths(page, 8);
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

  async 'intro-title-follows-motion-from-another-tab'(h) {
    // the companion in one tab and the intro's title, replayed, in another: Motion chosen on the companion's Settings
    // screen reaches the title at once, with no reload
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', PHONE);
    const title = await ctx.newPage();
    title.on('pageerror', (e) => errors.push('pageerror, title tab: ' + e.message));
    await title.goto(h.server.url + '/?cutscene=1&mute');
    await title.locator('.title-screen').waitFor({ timeout: 30000 });
    /** True once the title has `n` endless animations; the other tab's change arrives as an event, so this waits on it. */
    const moving = (n) => endlessReach(title, '.title-screen', n);
    h.expect(await moving(2), `the title's slit and prompt do not move with motion on (${await endless(title, '.title-screen')})`);
    await h.openSettings(page);
    await page.getByRole('radio', { name: 'Motion: Reduced', exact: true }).click();
    h.expect(await moving(0), `with Motion: Reduced chosen in another tab, the title kept moving (${await endless(title, '.title-screen')})`);
    await page.getByRole('radio', { name: 'Motion: Auto', exact: true }).click();
    h.expect(await moving(2), `with Motion back on Auto in another tab, the title stayed still (${await endless(title, '.title-screen')})`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'intro-openings-land-on-motion-from-another-tab'(h) {
    // Reduced chosen in another tab while a Lantern window is still opening and typing, and while the end card is still
    // coming in: every finite animation of either lands where it ends at once, the window's text and the card's buttons
    // with them. The page's animation clock stands still meanwhile, so nothing could have ended on its own. The piece's
    // tab is stopped from before the change is made until it is stored, as CI's software renderer once stopped one for
    // 5.4 s: it lands all the same once it runs again
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', PHONE);
    await h.openSettings(page);
    const pieces = [
      { kind: 'notification', root: '.sw', ready: (p) => p.waitForFunction(() => window.__win?.typing === true, null, { timeout: 30000 }) },
      { kind: 'endcard', root: '.endcard', ready: (p) => p.locator('.endcard').waitFor({ timeout: 30000 }) },
    ];
    for (const k of pieces) {
      const piece = await ctx.newPage();
      piece.on('pageerror', (e) => errors.push(`pageerror, ${k.kind} tab: ${e.message}`));
      const cdp = await ctx.newCDPSession(piece);
      await cdp.send('Animation.enable');
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
      await piece.goto(h.server.url + `/?lab=window&kind=${k.kind}&mute`);
      await k.ready(piece);
      /** the piece's finite animations not yet at their end, and what is still to show */
      const state = (sel) => {
        const root = document.querySelector(sel);
        return {
          running: root.getAnimations({ subtree: true }).filter((a) => a.effect.getTiming().iterations !== Infinity && !['finished', 'idle'].includes(a.playState)).length,
          typing: window.__win?.typing ?? null,
          hidden: [...root.querySelectorAll('.sw-u')].filter((u) => Number(getComputedStyle(u).opacity) < 1).length,
          inert: [...root.querySelectorAll('.sw-actions, .ec-actions')].filter((a) => a.inert).length,
        };
      };
      const coming = () => piece.evaluate(state, k.root);
      const before = await coming();
      h.expect(before.running > 0, `${k.kind}: nothing was still coming in to begin with: ${JSON.stringify(before)}`);
      const stopped = await pause(ctx, piece);
      let stored, held;
      try {
        await page.getByRole('radio', { name: 'Motion: Reduced', exact: true }).click();
        // stored while the tab is stopped, which still shows just what it showed before
        stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).settings.motion, h.SAVE);
        held = await stopped.read(state, k.root);
      } finally {
        await stopped.resume();
      }
      h.expect(stored === 'reduce' && JSON.stringify(held) === JSON.stringify(before), `${k.kind}: the stop was not exercised: with Motion ${stored} stored in another tab, the stopped tab showed ${JSON.stringify(held)}`);
      h.expect(await reducedHere(piece, true), `${k.kind}: the piece never heard Motion: Reduced chosen in another tab`);
      const now = await coming();
      h.expect(!now.running && !now.typing && !now.hidden && !now.inert, `${k.kind}: with Motion: Reduced chosen in another tab, it kept coming in: ${JSON.stringify(now)}`);
      // Auto again, so the next piece opens with motion on
      await page.getByRole('radio', { name: 'Motion: Auto', exact: true }).click();
      await piece.close();
    }
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'intro-title-follows-motion-missed-while-away'(h) {
    // a change another tab made while this one was in the page cache or out of sight sent no event this tab heard: a
    // write from this same tab sends it none either, so it stands in for one. Back from the page cache, or back in
    // view, the title follows what is stored
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?cutscene=1&mute', PHONE);
    await page.locator('.title-screen').waitFor({ timeout: 30000 });
    const moving = (n) => endlessReach(page, '.title-screen', n);
    const stored = (motion, back) =>
      page.evaluate(
        ([key, motion, back]) => {
          localStorage.setItem(key, JSON.stringify({ v: 1, settings: { motion } }));
          if (back === 'pageshow') window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
          else document.dispatchEvent(new Event('visibilitychange'));
        },
        [h.SAVE, motion, back],
      );
    h.expect(await moving(2), `the title's slit and prompt do not move with motion on (${await endless(page, '.title-screen')})`);
    await stored('reduce', 'pageshow');
    h.expect(await moving(0), `with Motion: Reduced stored while away, the title kept moving once back from the page cache (${await endless(page, '.title-screen')})`);
    await stored('system', 'visibilitychange');
    h.expect(await moving(2), `with Motion back on Auto stored while away, the title stayed still once back in view (${await endless(page, '.title-screen')})`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'intro-pieces-follow-motion-from-another-tab'(h) {
    // the same for a Lantern window waiting on a tap, the chest hold's breathing and the end card's drift, each alone in
    // the window lab beside the companion
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', PHONE);
    await h.openSettings(page);
    const pieces = [
      { kind: 'notification', ready: (p) => p.waitForFunction(() => document.querySelector('.sw .sw-next')?.getAnimations().length > 0, null, { timeout: 30000 }), moving: async (p) => (await windowMotion(p)).endless > 1, still: async (p) => (await windowMotion(p)).endless === 0 },
      { kind: 'hold', ready: (p) => p.locator('.chest-hold').waitFor({ timeout: 30000 }), moving: async (p) => (await breaths(p, 8)).length > 3, still: async (p) => { const b = await breaths(p, 8); return b.length === 1 && Number(b[0]) === 0.5; } },
      { kind: 'endcard', ready: (p) => p.locator('.ec-stage').waitFor({ timeout: 30000 }), moving: async (p) => (await drifts(p)) === 1, still: async (p) => (await drifts(p)) === 0 },
    ];
    for (const k of pieces) {
      const piece = await ctx.newPage();
      piece.on('pageerror', (e) => errors.push(`pageerror, ${k.kind} tab: ${e.message}`));
      await piece.goto(h.server.url + `/?lab=window&kind=${k.kind}&mute`);
      await k.ready(piece);
      /** True once the piece shows `want` (moving or still), asked again every 5 frames it draws, 60 times at most. */
      const shows = async (want) => {
        for (let i = 0; i < 60; i++) {
          if (await k[want](piece)) return true;
          await drawn(piece, 5);
        }
        return false;
      };
      h.expect(await shows('moving'), `${k.kind}: it does not move with motion on`);
      await page.getByRole('radio', { name: 'Motion: Reduced', exact: true }).click();
      h.expect(await reducedHere(piece, true), `${k.kind}: the piece never heard Motion: Reduced chosen in another tab`);
      h.expect(await shows('still'), `${k.kind}: with Motion: Reduced chosen in another tab, it kept moving`);
      await page.getByRole('radio', { name: 'Motion: Auto', exact: true }).click();
      h.expect(await reducedHere(piece, false), `${k.kind}: the piece never heard Motion back on Auto in another tab`);
      h.expect(await shows('moving'), `${k.kind}: with Motion back on Auto in another tab, it stayed still`);
      await piece.close();
    }
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
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

  /**
   * the title's slit and prompt and the end card's drift stop for good once their screen has gone, however it went: the
   * title by a tap, Enter, Space, ?shot= or a capture, the end card by Enter the Lantern, Replay or a capture. A capture
   * steps its stage 1/15 s at a time, and every step would bring back an animation it still kept
   */
  async 'endless-motion-ends-with-its-screen'(h) {
    const title = ['.title-screen', '.title-slit, .title-prompt', 2];
    const card = ['.endcard', '.ec-stage', 1];
    const tap = (sel) => (page) => page.locator(sel).click();
    // the end card drifts, so a wait for its button to hold still never ends: a player taps where it is once it is live
    const press = (v) => async (page) => {
      await page.locator('.ec-actions:not([inert])').waitFor({ timeout: 15000 });
      const b = await page.locator(`.ec-actions [data-v="${v}"]`).boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    };
    const capture = (screen) => (page) =>
      page.evaluate(async (sel) => {
        for (let i = 0; i < 600 && document.querySelector(sel); i++) {
          window.__stage.step(1 / 15);
          await new Promise((r) => setTimeout(r));
        }
      }, screen);
    const ways = [
      ['the title, a tap', '?lab=window&kind=title&mute', title, tap('.title-screen')],
      ['the title, Enter', '?lab=window&kind=title&mute', title, (page) => page.locator('.title-screen').press('Enter')],
      ['the title, Space', '?lab=window&kind=title&mute', title, (page) => page.locator('.title-screen').press(' ')],
      ['the title, ?shot=', '?shot=gate&mute', title, tap('.title-screen')],
      ['the title, a capture', '?lab=window&kind=title&mute&capture', title, capture('.title-screen')],
      ['the end card, Enter the Lantern', '?lab=window&kind=endcard&mute', card, press('enter')],
      ['the end card, Replay', '?lab=window&kind=endcard&mute', card, press('replay')],
      ['the end card, a capture', '?lab=window&kind=endcard&mute&capture', card, capture('.endcard')],
    ];
    for (const [how, query, [screen, parts, n], close] of ways) {
      const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, query, PHONE);
      await page.locator(screen).waitFor({ timeout: 30000 });
      // the endless animations themselves, kept from while the screen shows, so they can be looked at once it has gone
      const endless = await page.evaluate(
        (parts) => (window.__endless = [...document.querySelectorAll(parts)].flatMap((e) => e.getAnimations()).filter((a) => a.effect.getTiming().iterations === Infinity)).length,
        parts,
      );
      h.expect(endless === n, `${how}: ${endless} endless animations to begin with, not ${n}`);
      // the page says when the screen went, so a browser frozen for a while on a busy machine doesn't count against it
      const gone = h.leaves(page, screen);
      await close(page);
      await gone(15000).catch((e) => {
        throw new Error(`${how}: the screen never went (${e.message})`);
      });
      if (query.includes('capture')) await page.evaluate(() => window.__stage.step(1 / 15));
      const left = await page.evaluate(() => window.__endless.map((a) => a.playState).filter((p) => p !== 'idle'));
      h.expect(!left.length, `${how}: ${left.length} of its endless animations are still ${left.join(', ')} after it has gone`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /**
   * in a capture, a Lantern window dismissed while it types cancels its typing, and a wait for that typing to finish ends
   * then, with an AbortError as in real time, instead of looking again on every step for the rest of the capture
   */
  async 'capture-wait-ends-with-a-dismissed-window'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?lab=window&kind=notification&mute&capture', PHONE);
    await page.waitForFunction(() => !!window.__stage && !!window.__win, null, { timeout: 30000 });
    const ended = await page.evaluate(async () => {
      const step = async (n) => {
        for (let i = 0; i < n; i++) {
          window.__stage.step(1 / 15);
          await new Promise((r) => setTimeout(r));
        }
      };
      const w = window.__win;
      for (let i = 0; i < 200 && !w.typeAnims.length; i++) await step(1);
      if (!w.typeAnims.length) return 'no typing';
      // the same module the window's own waits come from
      const { finished } = await import('/src/ui/anim.ts');
      let how = 'still waiting';
      finished(w.typeAnims[0]).then(() => (how = 'finished'), (e) => (how = e.name));
      w.destroy();
      await step(5);
      return how;
    });
    h.expect(ended === 'AbortError', `in a capture, a wait on a dismissed window's typing ${ended === 'still waiting' ? 'never ends' : `ended as ${ended}`}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * the Stealth Room's Breathing words keep pacing the breath while the glow rests with reduce-motion on; once it is
   * off again the glow breathes in step with them, not from the start of its own breath
   */
  async 'stealth-words-breathe-with-glow'(h) {
    const day = (ms) => new Date(ms - 6 * 3600e3).toISOString().slice(0, 10);
    const t = Date.now() - 86400e3;
    const save = JSON.stringify({ v: 1, created: t, events: [{ id: 'motion-visit', t, day: day(t), k: 'visit', xp: 10 }], flags: { greetDay: day(t), cardDay: day(t), giftDay: day(t) } });
    const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 });
    const { ctx, page, errors } = await h.open({ [h.SAVE]: save, [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', PHONE);
    const device = await deviceMotion(ctx, page);
    await h.reachHub(page);
    await page.evaluate(() => window.__daily.go({ name: 'rest' }));
    await page.locator('.dq-st-glow').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /^Breathing words/ }).click();
    // how far apart the glow's breath and the words' are, in ms either way round the breath; null while the glow rests
    const apart = () =>
      page.evaluate(() => {
        const [glow] = document.querySelector('.dq-st-glow').getAnimations();
        const [words] = document.querySelector('.dq-st-in').getAnimations();
        if (!glow || !words) return null;
        const p = glow.effect.getTiming().duration;
        const d = (((glow.currentTime - words.currentTime) % p) + p) % p;
        return Math.round(Math.min(d, p - d));
      });
    const first = await apart();
    h.expect(first !== null && first < 100, `the words start ${first} ms out of step with the glow`);
    await device('reduce');
    await page.waitForFunction(() => window.__daily.reduced() && !document.querySelector('.dq-st-glow').getAnimations().length, null, { timeout: 5000 });
    // the glow rests a while; the words keep pacing the breath
    await h.sleep(3300);
    await device('no-preference');
    await page.waitForFunction(() => !window.__daily.reduced() && document.querySelector('.dq-st-glow').getAnimations().length === 1, null, { timeout: 5000 });
    const back = await apart();
    h.expect(back !== null && back < 100, `once reduce-motion was off again, the words are ${back} ms out of step with the glow`);
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
