// The optional buzz for skill timers: off by default, its own Settings switch (shown only on a touch-first device whose
// browser can vibrate), one short pulse as a timer starts and a soft double pulse as it ends or is skipped. Nothing
// every second, on more time, while the page is out of sight, inside the Safe Zone or in the intro, and the choice
// survives a reload.

import { gone } from './harness.mjs';

const START = JSON.stringify([40]);
const END = JSON.stringify([40, 120, 40]);
/** a skip's double pulse, a 200 ms rest, then the next timer's start pulse: one pattern, so neither cuts the other off */
const END_THEN_START = JSON.stringify([40, 120, 40, 200, 40]);
/** what stops a pattern still playing */
const STOP = JSON.stringify(0);
const SWITCH = 'Vibrate when a timer starts or ends';

/**
 * navigator.vibrate records each pattern instead of buzzing (or is missing, as on iPhone Safari), and __hide puts
 * the page out of sight the way a switched tab or a locked phone does. With `frames: false` the hidden page also gets
 * no animation frames, as on a phone: they wait until it is back.
 */
const device = ({ vibrates = true, clock = true } = {}) => async (ctx) => {
  if (clock) await ctx.clock.install();
  await ctx.addInitScript((vibrates) => {
    window.__buzz = [];
    if (!vibrates) delete Navigator.prototype.vibrate;
    else Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true, value: (p) => (window.__buzz.push(JSON.stringify(p)), true) });
    let hidden = false;
    let still = false;
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    const held = new Map();
    let n = 0;
    window.requestAnimationFrame = (fn) => {
      if (!still) return raf(fn);
      held.set(--n, fn);
      return n;
    };
    window.cancelAnimationFrame = (id) => (id < 0 ? held.delete(id) : caf(id));
    window.__hide = (on, { frames = true } = {}) => {
      hidden = on;
      still = on && !frames;
      document.dispatchEvent(new Event('visibilitychange'));
      if (on) return;
      const waiting = [...held.values()];
      held.clear();
      waiting.forEach((fn) => raf(fn));
    };
  }, vibrates);
};
/** A phone: touch first, so Settings offers the switch. `touch: false` is a desktop, where a vibrate call does nothing. */
const open = (h, { touch = true, ...o } = {}) => h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 }, device(o), { hasTouch: touch });
/** The buzzes since the last look. */
const buzzes = async (page) => JSON.stringify(await page.evaluate(() => window.__buzz.splice(0)));
const none = '[]';
const only = (p) => JSON.stringify([p]);
const tap = (page, name) => page.getByRole('button', { name, exact: true }).first().click();
const timer = (page) => page.locator('.dq-step-body .dq-timer-num');

/** Settings, the switch turned on (it gives one start pulse so the player feels it), then back Home. */
async function turnOn(h, page) {
  await h.openSettings(page);
  const sw = page.getByRole('switch', { name: SWITCH });
  h.expect(!(await sw.isChecked()), 'the vibration switch is on before the player turned it on');
  await sw.click();
  h.expect(await sw.isChecked(), 'the vibration switch did not turn on');
  const got = await buzzes(page);
  h.expect(got === only(START), `turning the switch on did not give one start pulse: ${got}`);
  await page.evaluate(() => window.__daily.go({ name: 'hub' }));
}

/**
 * The page clock stands still from a second on, so a pulse given just before (the switch turned on) is long over, as
 * it is for a player, and a timer's start pulse plays on its own.
 */
async function standStill(h, page) {
  await h.pauseClock(page);
  await page.clock.runFor(1000);
}

/** Wise Mind's 20 second timer, which starts by itself after the breathing step. The page clock stands still from here. */
async function wiseMind(h, page) {
  await page.waitForFunction(() => !!window.__daily, null, { timeout: 30000 });
  await page.clock.resume();
  await page.evaluate(() => window.__daily.go({ name: 'hub' }));
  await h.reachHub(page);
  await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'wise-mind' }));
  await standStill(h, page);
  await tap(page, 'Begin');
  await tap(page, 'Next');
  await timer(page).waitFor({ timeout: 5000 });
}

export const scenarios = {
  /** a player who never touched the switch feels nothing, start to end */
  async 'vibration-off-by-default'(h) {
    const { ctx, page, errors } = await open(h);
    await wiseMind(h, page);
    await page.clock.runFor(21000);
    h.expect((await timer(page).textContent()).trim() === 'Done', 'the Wise Mind timer did not finish');
    await tap(page, 'Next');
    const got = await buzzes(page);
    h.expect(got === none, `the timer buzzed with the switch never turned on: ${got}`);
    await page.clock.resume();
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await h.openSettings(page);
    h.expect(!(await page.getByRole('switch', { name: SWITCH }).isChecked()), 'the vibration switch starts on');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** the switch is a real, readable switch at phone widths, and the choice is saved and comes back after a reload */
  async 'vibration-switch-and-reload'(h) {
    const { ctx, page, errors } = await open(h, { clock: false });
    await turnOn(h, page);
    await h.openSettings(page);
    const sw = page.getByRole('switch', { name: SWITCH });
    const row = page.locator('.dq-setting', { has: sw });
    for (const [width, height] of [[390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await row.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const look = await row.evaluate((r) => {
        const box = r.getBoundingClientRect();
        const t = r.querySelector('.dq-setting-t');
        const hint = r.querySelector('.dq-setting-h');
        const knob = r.querySelector('.dq-switch').getBoundingClientRect();
        return {
          inside: box.left >= 0 && box.right <= innerWidth + 0.5 && knob.right <= box.right + 0.5,
          wide: document.documentElement.scrollWidth <= innerWidth,
          title: parseFloat(getComputedStyle(t).fontSize),
          hint: parseFloat(getComputedStyle(hint).fontSize),
          knob: [knob.width, knob.height],
        };
      });
      h.expect(look.inside && look.wide, `${width} px: the vibration row runs off the screen: ${JSON.stringify(look)}`);
      h.expect(look.title >= 16 && look.hint >= 16, `${width} px: the vibration text is too small: ${JSON.stringify(look)}`);
      h.expect(look.knob[0] >= 44 && look.knob[1] >= 44, `${width} px: the switch is under 44 px to tap: ${JSON.stringify(look)}`);
      await h.shot(page, `settings-vibration-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const save = JSON.parse((await h.ls(page, h.SAVE)) ?? 'null');
    h.expect(save?.settings?.vibrate === true && save?.setAt?.vibrate > 0, `the choice is not saved: ${JSON.stringify({ settings: save?.settings, setAt: save?.setAt })}`);
    await page.reload();
    await h.openSettings(page);
    h.expect(await page.getByRole('switch', { name: SWITCH }).isChecked(), 'the vibration switch is off again after a reload');
    // turning it off saves too, and turning it off doesn't buzz
    await page.getByRole('switch', { name: SWITCH }).click();
    const off = await buzzes(page);
    h.expect(off === none, `turning the switch off buzzed: ${off}`);
    await page.reload();
    await h.openSettings(page);
    h.expect(!(await page.getByRole('switch', { name: SWITCH }).isChecked()), 'the vibration switch is on again after it was turned off and the page reloaded');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** one start pulse, one end pulse; nothing every second, on more time or after it ends; moving on early is a skip */
  async 'vibration-timer-start-end'(h) {
    const { ctx, page, errors } = await open(h);
    await turnOn(h, page);
    await wiseMind(h, page);
    let got = await buzzes(page);
    h.expect(got === only(START), `the timer starting did not give one start pulse: ${got}`);
    await page.clock.runFor(5000);
    got = await buzzes(page);
    h.expect(got === none, `the timer buzzed while it ran: ${got}`);
    await tap(page, '+15 s');
    await page.clock.runFor(1000);
    got = await buzzes(page);
    h.expect(got === none, `more time buzzed: ${got}`);
    // 20 s and 15 more: 6 s gone, 29 s left
    await page.clock.runFor(28500);
    h.expect((await timer(page).textContent()).trim() !== 'Done', 'the timer ended before its extra 15 seconds');
    h.expect((await buzzes(page)) === none, 'the timer buzzed before it ended');
    await page.clock.runFor(1000);
    h.expect((await timer(page).textContent()).trim() === 'Done', 'the timer did not end after its extra 15 seconds');
    got = await buzzes(page);
    h.expect(got === only(END), `the timer ending did not give one end pulse: ${got}`);
    await page.clock.runFor(5000);
    await tap(page, 'Next');
    got = await buzzes(page);
    h.expect(got === none, `the finished timer buzzed again, or moving on after it ended buzzed: ${got}`);

    // Next while it runs skips it: the end pulse, once
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the second timer did not give one start pulse');
    await page.clock.runFor(3000);
    await tap(page, 'Next');
    await page.locator('.dq-step-body input, .dq-step-body textarea').first().waitFor({ timeout: 5000 });
    await page.clock.runFor(25000);
    got = await buzzes(page);
    h.expect(got === only(END), `skipping the timer did not give one end pulse: ${got}`);
    await h.shot(page, 'after-skip');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** no buzz in the Safe Zone: not when it opens over a running timer, and not for its own cool-water timer */
  async 'vibration-not-in-safe-zone'(h) {
    const { ctx, page, errors } = await open(h);
    await turnOn(h, page);
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the timer did not give one start pulse');
    await page.clock.runFor(1000);
    await page.locator('header .dq-safe').click();
    await page.locator('.dq-safezone').waitFor({ timeout: 5000 });
    await page.clock.runFor(25000);
    let got = await buzzes(page);
    h.expect(got === none, `opening the Safe Zone over a running timer buzzed: ${got}`);
    await page.evaluate(() => window.__daily.go({ name: 'safe', at: 'cold' }));
    await tap(page, 'Cool air');
    await page.clock.runFor(32000);
    got = await buzzes(page);
    h.expect(got === none, `the Safe Zone's own timer buzzed: ${got}`);
    await h.shot(page, 'safe-zone-quiet');
    // an end pulse still playing as the Safe Zone opens stops at once, so no part of it is felt in there
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the second timer did not give one start pulse');
    await page.clock.runFor(20050);
    h.expect((await buzzes(page)) === only(END), 'the second timer did not give one end pulse');
    await page.locator('header .dq-safe').click();
    await page.locator('.dq-safezone').waitFor({ timeout: 5000 });
    got = await buzzes(page);
    h.expect(got === only(STOP), `the end pulse went on playing into the Safe Zone: ${got}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** out of sight: pausing and coming back is not a start, an end out of sight is felt by no one, and no late buzz */
  async 'vibration-not-while-hidden'(h) {
    const { ctx, page, errors } = await open(h);
    await turnOn(h, page);
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the timer did not give one start pulse');
    await page.evaluate(() => window.__hide(true));
    await page.clock.runFor(3000);
    await page.evaluate(() => window.__hide(false));
    await page.clock.runFor(1000);
    let got = await buzzes(page);
    h.expect(got === none, `hiding the page and coming back buzzed: ${got}`);
    // the end while the page is out of sight, frames still running
    await page.evaluate(() => window.__hide(true));
    await page.clock.runFor(17000);
    await page.evaluate(() => window.__hide(false));
    await page.clock.runFor(1000);
    h.expect((await timer(page).textContent()).trim() === 'Done', 'the timer did not end');
    got = await buzzes(page);
    h.expect(got === none, `the timer buzzed as it ended out of sight, or when the page came back: ${got}`);
    // a phone gives a hidden page no frames, so the end is only drawn once the page is back: no late buzz then, not
    // even when it comes back just after the end
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the second timer did not give one start pulse');
    await page.clock.runFor(5000);
    await page.evaluate(() => window.__hide(true, { frames: false }));
    await page.clock.runFor(15400);
    h.expect((await timer(page).textContent()).trim() !== 'Done', 'the hidden page drew the end, so this proves nothing');
    await page.evaluate(() => window.__hide(false));
    await page.clock.runFor(500);
    h.expect((await timer(page).textContent()).trim() === 'Done', 'the timer did not end once the page was back');
    got = await buzzes(page);
    h.expect(got === none, `the timer buzzed when the page came back 0.4 s after it ended out of sight: ${got}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a timer that ended out of sight is over even before the page draws it: Next then is no skip and gives no pulse */
  async 'vibration-next-after-hidden-end'(h) {
    const { ctx, page, errors } = await open(h);
    await turnOn(h, page);
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the timer did not give one start pulse');
    await page.evaluate(() => window.__hide(true, { frames: false }));
    await page.clock.runFor(25000);
    await page.evaluate(() => window.__hide(false));
    // the page clock stands still, so no frame comes before the tap
    h.expect((await timer(page).textContent()).trim() !== 'Done', 'a frame drew the end before Next, so this proves nothing');
    await tap(page, 'Next');
    await page.clock.runFor(1000);
    const got = await buzzes(page);
    h.expect(got === none, `Next on a timer that had ended out of sight buzzed as a skip: ${got}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** closing the skill while its timer runs skips it like Next: the end pulse, once; closing it after the end gives nothing more */
  async 'vibration-skip-by-leaving'(h) {
    const { ctx, page, errors } = await open(h);
    await turnOn(h, page);
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the timer did not give one start pulse');
    await page.clock.runFor(3000);
    await page.getByRole('button', { name: 'Leave this skill' }).click();
    h.expect((await page.evaluate(() => window.__daily.route.name)) === 'hub', 'Leave this skill did not go Home');
    await page.clock.runFor(25000);
    let got = await buzzes(page);
    h.expect(got === only(END), `closing the skill while its timer ran did not give one end pulse: ${got}`);
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the second timer did not give one start pulse');
    await page.clock.runFor(21000);
    h.expect((await timer(page).textContent()).trim() === 'Done', 'the Wise Mind timer did not finish');
    h.expect((await buzzes(page)) === only(END), 'the second timer did not give one end pulse');
    await page.getByRole('button', { name: 'Leave this skill' }).click();
    await page.clock.runFor(1000);
    got = await buzzes(page);
    h.expect(got === none, `closing the skill after its timer ended buzzed again: ${got}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** another open copy turning it on or off moves this copy's switch too, so the switch shows the choice a buzz follows */
  async 'vibration-switch-follows-other-tab'(h) {
    const { ctx, page, errors } = await open(h, { clock: false });
    await h.openSettings(page);
    h.expect(!(await page.getByRole('switch', { name: SWITCH }).isChecked()), 'the vibration switch starts on');
    const other = await ctx.newPage();
    other.on('pageerror', (e) => errors.push('pageerror (second tab): ' + e.message));
    await other.goto(h.server.url + '/?mute');
    await h.openSettings(other);
    const shows = (on) =>
      page
        .waitForFunction(([name, on]) => [...document.querySelectorAll('.dq-settings input[role="switch"]')].find((i) => i.labels[0]?.textContent.includes(name))?.checked === on, [SWITCH, on], { timeout: 5000 })
        .then(() => true, () => false);
    await other.getByRole('switch', { name: SWITCH }).click();
    h.expect(await shows(true), 'the other tab turned vibration on, and this open Settings still shows it off');
    await other.getByRole('switch', { name: SWITCH }).click();
    h.expect(await shows(false), 'the other tab turned vibration off, and this open Settings still shows it on');
    await h.shot(page, 'settings-vibration-follows');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** Next on a running timer that leads straight into the next one: the skip pulse plays out, then the start pulse */
  async 'vibration-skip-into-next-timer'(h) {
    const { ctx, page, errors } = await open(h);
    await turnOn(h, page);
    await page.waitForFunction(() => !!window.__daily, null, { timeout: 30000 });
    await page.clock.resume();
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await h.reachHub(page);
    // Open Gauntlets: three 20 second timers in a row, each starting by itself
    await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'willing-hands' }));
    await standStill(h, page);
    await tap(page, 'Begin');
    await timer(page).waitFor({ timeout: 5000 });
    h.expect((await buzzes(page)) === only(START), 'the first timer did not give one start pulse');
    await page.clock.runFor(3000);
    await tap(page, 'Next');
    // the second call replaces the first, so it has to carry the skip pulse too
    const got = await buzzes(page);
    h.expect(got === JSON.stringify([END, END_THEN_START]), `the next timer's start pulse cut off the skip pulse: ${got}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** the intro never buzzes, even with the switch on */
  async 'vibration-not-in-intro'(h) {
    const { ctx, page, errors } = await open(h, { clock: false });
    await turnOn(h, page);
    await page.goto(h.server.url + '/?fresh&mute');
    await h.sleep(2500);
    await page.mouse.click(195, 500);
    const name = page.locator('#np-name');
    await name.waitFor({ timeout: 15000 });
    await name.fill('Sky');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await gone(name, 10000);
    for (let i = 0; i < 12; i++) {
      await h.sleep(1500);
      await page.mouse.click(195, 700);
    }
    await h.shot(page, 'intro-quiet');
    const got = await buzzes(page);
    h.expect(got === none, `the intro buzzed: ${got}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** where the browser can't vibrate there is no switch at all, not a dead one */
  async 'vibration-switch-hidden-without-support'(h) {
    const { ctx, page, errors } = await open(h, { vibrates: false, clock: false });
    await h.openSettings(page);
    h.expect(await page.locator('.dq-settings [aria-label="Motion"]').isVisible(), 'Settings lost the Motion choice beside it');
    h.expect((await page.getByRole('switch', { name: SWITCH }).count()) === 0, 'Settings shows a vibration switch on a browser that cannot vibrate');
    h.expect(!(await page.getByText(SWITCH).count()), 'Settings mentions vibration on a browser that cannot vibrate');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** desktop Chrome and Edge have navigator.vibrate, but nothing there buzzes: no dead switch, and an "on" brought from a phone asks for nothing */
  async 'vibration-switch-hidden-on-desktop'(h) {
    const { ctx, page, errors } = await open(h, { touch: false });
    await page.waitForFunction(() => !!window.__daily, null, { timeout: 30000 });
    h.expect(await page.evaluate(() => typeof navigator.vibrate === 'function' && !matchMedia('(pointer: coarse)').matches), 'this browser is not a desktop with navigator.vibrate, so it proves nothing');
    await page.evaluate(() => {
      const a = window.__daily;
      a.store.state.settings.vibrate = true;
      a.store.touch('vibrate');
      a.store.save();
    });
    await wiseMind(h, page);
    await page.clock.runFor(21000);
    h.expect((await timer(page).textContent()).trim() === 'Done', 'the Wise Mind timer did not finish');
    const got = await buzzes(page);
    h.expect(got === none, `a desktop was asked to vibrate: ${got}`);
    await page.clock.resume();
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await h.openSettings(page);
    h.expect(await page.locator('.dq-settings [aria-label="Motion"]').isVisible(), 'Settings lost the Motion choice beside it');
    h.expect((await page.getByRole('switch', { name: SWITCH }).count()) === 0, 'Settings shows a vibration switch on a desktop, where nothing buzzes');
    h.expect(!(await page.getByText(SWITCH).count()), 'Settings mentions vibration on a desktop');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
