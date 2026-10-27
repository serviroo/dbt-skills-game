// A tap on a Lantern window's button while the window still types itself in is the player's answer: it is never
// dropped for having come before the window finished opening. The new-version notice opens on its own, with no tap in
// flight to complete its typing, and the page clock stands still from just before it opens until after the tap, so
// the tap lands while it still opens however slow the machine is.

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
};
