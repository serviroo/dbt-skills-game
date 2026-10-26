// The optional buzz for skill timers: off by default, its own Settings switch (shown only where the browser can
// vibrate), one short pulse as a timer starts and a soft double pulse as it ends or is skipped. Nothing every second,
// on more time, while the page is out of sight, inside the Safe Zone or in the intro, and the choice survives a reload.

const START = JSON.stringify([40]);
const END = JSON.stringify([40, 120, 40]);
const SWITCH = 'Vibrate when a timer starts or ends';

/**
 * navigator.vibrate records each pattern instead of buzzing (or is missing, as on most desktops), and __hide puts the
 * page out of sight the way a switched tab or a locked phone does.
 */
const device = ({ vibrates = true, clock = true } = {}) => async (ctx) => {
  if (clock) await ctx.clock.install();
  await ctx.addInitScript((vibrates) => {
    window.__buzz = [];
    if (!vibrates) delete Navigator.prototype.vibrate;
    else Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true, value: (p) => (window.__buzz.push(JSON.stringify(p)), true) });
    let hidden = false;
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
    window.__hide = (on) => {
      hidden = on;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  }, vibrates);
};
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

/** Wise Mind's 20 second timer, which starts by itself after the breathing step. The page clock stands still from here. */
async function wiseMind(h, page) {
  await page.waitForFunction(() => !!window.__daily, null, { timeout: 30000 });
  await page.clock.resume();
  await page.evaluate(() => window.__daily.go({ name: 'hub' }));
  await h.reachHub(page);
  await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'wise-mind' }));
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await tap(page, 'Begin');
  await tap(page, 'Next');
  await timer(page).waitFor({ timeout: 5000 });
}

export const scenarios = {
  /** a player who never touched the switch feels nothing, start to end */
  async 'vibration-off-by-default'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 }, device());
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
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 }, device({ clock: false }));
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
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 }, device());
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
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 }, device());
    await turnOn(h, page);
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the timer did not give one start pulse');
    await page.locator('header .dq-safe').click();
    await page.locator('.dq-safezone').waitFor({ timeout: 5000 });
    await page.clock.runFor(25000);
    let got = await buzzes(page);
    h.expect(got === none, `opening the Safe Zone over a running timer buzzed: ${got}`);
    await page.evaluate(() => window.__daily.go({ name: 'safe', at: 'cold' }));
    await tap(page, 'Start 30 seconds');
    await page.clock.runFor(32000);
    got = await buzzes(page);
    h.expect(got === none, `the Safe Zone's own timer buzzed: ${got}`);
    await h.shot(page, 'safe-zone-quiet');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** out of sight: pausing and coming back is not a start, an end out of sight is felt by no one, and no late buzz */
  async 'vibration-not-while-hidden'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 }, device());
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
    // a phone stops a hidden page's frames, so the end is only seen when the page is back: no late buzz then
    await wiseMind(h, page);
    h.expect((await buzzes(page)) === only(START), 'the second timer did not give one start pulse');
    await page.clock.fastForward(40000);
    await page.clock.runFor(500);
    h.expect((await timer(page).textContent()).trim() === 'Done', 'the timer did not end after the jump');
    got = await buzzes(page);
    h.expect(got === none, `the timer buzzed long after it ended: ${got}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** the intro never buzzes, even with the switch on */
  async 'vibration-not-in-intro'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 }, device({ clock: false }));
    await turnOn(h, page);
    await page.goto(h.server.url + '/?fresh&mute');
    await h.sleep(2500);
    await page.mouse.click(195, 500);
    const name = page.locator('#np-name');
    await name.waitFor({ timeout: 15000 });
    await name.fill('Sky');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await name.waitFor({ state: 'detached', timeout: 10000 });
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
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 }, device({ vibrates: false, clock: false }));
    await h.openSettings(page);
    h.expect(await page.locator('.dq-settings [aria-label="Motion"]').isVisible(), 'Settings lost the Motion choice beside it');
    h.expect((await page.getByRole('switch', { name: SWITCH }).count()) === 0, 'Settings shows a vibration switch on a browser that cannot vibrate');
    h.expect(!(await page.getByText(SWITCH).count()), 'Settings mentions vibration on a browser that cannot vibrate');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
