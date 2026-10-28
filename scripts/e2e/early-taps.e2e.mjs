// A tap on a Lantern window's button while the window still types itself in is the player's answer: it is never
// dropped for having come before the window finished opening. The new-version notice opens on its own, with no tap in
// flight to complete its typing, and the page clock stands still from just before it opens until after the tap, so
// the tap lands while it still opens however slow the machine is. A second tap as a window closes is the window's too.

export const scenarios = {
  /** Reload, tapped while the new-version notice is still opening, reloads the page */
  async 'reload-while-opening'({ open, expect }) {
    let left = null;
    const { ctx, page, errors } = await open({}, '?mute', undefined, async (c) => {
      await c.clock.install();
      // the scene's code is gone, as after a new version replaced it: the intro offers a reload in its place. The
      // notice waits on this file, so the page clock stops before the notice starts opening, and the opening (timed on
      // page timers) cannot end until the clock moves again. (The page's time runs until the pause lands, so it pauses
      // a second ahead.)
      await c.route('**/src/cutscene/director.ts*', async (r) => {
        await c.clock.pauseAt((await r.request().frame().evaluate(() => Date.now())) + 1000);
        await r.abort('failed');
      });
      // at the tap, how much of the opening was still to come on the page clock: the buttons fade in last, so their
      // fade ends with it
      await c.exposeFunction('__tapLeft', (label, ms) => label === 'Reload' && (left ??= ms));
      await c.addInitScript(() => {
        const ends = new WeakMap();
        const make = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const a = make.apply(this, args);
          if (this.classList.contains('sw-actions')) ends.set(this, performance.now() + a.effect.getComputedTiming().endTime);
          return a;
        };
        addEventListener('click', (e) => {
          const btn = e.target.closest?.('.sw-btn');
          const end = ends.get(btn?.closest('.sw-actions'));
          if (end !== undefined) window.__tapLeft(btn.textContent, end - performance.now());
        }, true);
      });
    });
    const title = page.locator('.title-screen');
    await title.waitFor({ timeout: 30000 });
    await title.click();
    await page.getByRole('button', { name: 'Skip' }).click({ timeout: 15000 });
    const reload = page.getByRole('button', { name: 'Reload' });
    await reload.waitFor({ timeout: 20000 });
    const reloaded = page.waitForEvent('load', { timeout: 10000 }).then(() => true, () => false);
    await reload.click();
    // the close (330 ms) runs on the page clock too: one step past it fires its timer once, and no 3D frames drawn in
    // software pile up behind the reload while the page unloads
    await page.clock.fastForward(1000);
    const ok = await reloaded;
    expect(left > 0, `the tap came after the notice had opened (${left} ms of the opening left)`);
    expect(ok, `Reload, tapped with ${Math.round(left)} ms of the opening to go, never reloaded the page`);
    // the scene file this scenario blocks is the one resource that may fail to load
    const real = errors.filter((e) => !/Failed to load resource: net::ERR_FAILED/.test(e));
    expect(!real.length, real.join('\n'));
    await ctx.close();
    return { openingLeftMs: Math.round(left) };
  },

  /** A window dismissed after a tap it kept answers dismissed, not the tap */
  async 'dismissed-after-early-tap'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=window&kind=quest&mute');
    // the lab opens the window and never waits for input, so the tap is kept for a wait that has not begun
    await page.getByRole('button', { name: 'Start' }).click({ timeout: 20000 });
    const v = await page.evaluate(() => {
      window.__win.dismiss();
      return window.__win.waitForInput();
    });
    expect(v === 'dismissed', `a window dismissed after a tap it kept answered ${v}, not dismissed`);
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** A second tap as a companion window closes is still the window's: what is under it never takes it, the Safe Zone
   *  stays one tap away (then and while the window waits, with nothing left over it), and Home takes taps again once
   *  the window is gone, with motion on and off */
  async 'second-tap-while-closing'({ open, expect, SEEN }) {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      for (const second of ['look', 'safe', 'safe alone']) {
        const where = `${reducedMotion}, ${second === 'safe alone' ? 'Safe Zone while the welcome waits' : `second tap on ${second}`}`;
        const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN }, '?mute', undefined, (c) => c.clock.install(), { reducedMotion });
        await page.locator('.dq-sw').waitFor({ timeout: 20000 });
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.dq-sw .sw-next')).opacity) > 0, null, { timeout: 20000 });
        // the close runs on the page clock, which stands still from before the first tap, so the second always lands
        // while the window still closes however slow the machine is
        await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
        const box = async (sel) => {
          const b = await page.locator(sel).first().boundingBox();
          return [b.x + b.width / 2, b.y + b.height / 2];
        };
        // the first tap, on the dimmed Home beside the welcome, continues it; the second lands on the same spot or on
        // the Safe Zone. Alone, the Safe Zone is the only tap.
        const look = await box('.dq-quest-look');
        const to = second === 'look' ? look : await box('.dq-safe');
        let closing = true;
        if (second !== 'safe alone') {
          await page.mouse.click(...look);
          closing = await page.evaluate(() => !!document.querySelector('.dq-sw') && !document.querySelector('.dq-scrim.is-on'));
        }
        await page.mouse.click(...to);
        await page.clock.resume();
        await page.waitForFunction(() => !document.querySelector('.dq-sw'), null, { timeout: 10000 });
        const screen = await page.evaluate(() => document.querySelector('.dq').dataset.screen);
        expect(closing, `${where}: the second tap did not come while the welcome closed`);
        if (second !== 'look') {
          expect(screen === 'safe', `${where}: the Safe Zone did not open on its first tap, the screen is ${screen}`);
          // a trial tap waits for the button to settle, then fails while anything else would take the tap
          const talk = page.getByRole('button', { name: 'Talk to someone now', exact: true });
          const over = await talk.click({ trial: true, timeout: 5000 }).then(() => null, (e) => e.message.split('\n').find((l) => l.includes('intercepts pointer events')) ?? e.message.split('\n')[0]);
          expect(!over, `${where}: "Talk to someone now" takes no tap: ${over}`);
        } else {
          expect(screen === 'hub' && !(await page.locator('.dq-quest-aside-t').isVisible()), `${where}: the tap meant for the closing welcome set today's card aside`);
          await page.locator('.dq-quest-look').click({ timeout: 5000 });
          await page.locator('.dq-quest-aside-t').waitFor({ timeout: 5000 });
        }
        expect(!errors.length, `${where}: ${errors.join('\n')}`);
        await ctx.close();
      }
    }
  },
};
