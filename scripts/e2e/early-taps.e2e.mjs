// A tap on a Lantern window's button while the window still types itself in is the player's answer: it is never
// dropped for having come before the window finished opening. The new-version notice opens on its own, with no tap in
// flight to complete its typing, so a quick Reload lands while it still opens.

export const scenarios = {
  /** Reload, tapped while the new-version notice is still opening, reloads the page */
  async 'reload-while-opening'({ open, expect }) {
    let left = null;
    const { ctx, page, errors } = await open({}, '?mute', undefined, async (c) => {
      // the scene's code is gone, as after a new version replaced it: the intro offers a reload in its place
      await c.route('**/src/cutscene/director.ts*', (r) => r.abort('failed'));
      // at the tap, how much of the opening was still to come: the buttons fade in last, so their fade ends with it
      await c.exposeFunction('__tapLeft', (label, ms) => label === 'Reload' && (left ??= ms));
      await c.addInitScript(() =>
        addEventListener('click', (e) => {
          const btn = e.target.closest?.('.sw-btn');
          const fade = btn?.closest('.sw-actions').getAnimations()[0];
          if (fade) window.__tapLeft(btn.textContent, fade.effect.getComputedTiming().endTime - fade.currentTime);
        }, true),
      );
    });
    const title = page.locator('.title-screen');
    await title.waitFor({ timeout: 30000 });
    await title.click();
    await page.getByRole('button', { name: 'Skip' }).click({ timeout: 15000 });
    const reload = page.getByRole('button', { name: 'Reload' });
    await reload.waitFor({ timeout: 20000 });
    const reloaded = page.waitForEvent('load', { timeout: 10000 }).then(() => true, () => false);
    await reload.click();
    const ok = await reloaded;
    expect(left > 0, `the tap came after the notice had opened (${left} ms of the opening left)`);
    expect(ok, `Reload, tapped with ${Math.round(left)} ms of the opening to go, never reloaded the page`);
    // the scene file this scenario blocks is the one resource that may fail to load
    const real = errors.filter((e) => !/Failed to load resource: net::ERR_FAILED/.test(e));
    expect(!real.length, real.join('\n'));
    await ctx.close();
    return { openingLeftMs: Math.round(left) };
  },
};
