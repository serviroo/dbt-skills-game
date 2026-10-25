// Slow frames (ME-126): on a slow phone, or in CI's software renderer, the 3D stage can draw a frame a second or
// slower, and its clock moves at most 0.1 s a frame. Windows and taps keep the page's time however slowly it draws.
// Each scenario hands the page an animation frame only every FRAME_MS (timers, DOM animations and input keep their
// pace) and checks:
//   slow-prompt      the name prompt closes within CLOSE_MS of Continue, and of Skip, and keeps the answer
//   slow-action      a window's action counts as soon as it shows, and even when tapped while the Lantern still types
//   slow-home        a returning player taps the first-visit welcome away and reaches Home inside the live check's
//                    budget (scripts/live-check.mjs reachHome), with every tap on the window's scrim, none on Home
const FRAME_MS = 2500;
// the close plays in 330 ms; on the stage clock it needs two frames, so at least FRAME_MS
const CLOSE_MS = 2000;

/** Runs every requestAnimationFrame callback only on the next tick of a slow ticker, like a phone drawing a frame every `ms`. */
const slowFrames = (ms) => {
  const raf = requestAnimationFrame.bind(window);
  const waiting = new Map();
  let id = 0;
  setInterval(() => {
    const due = [...waiting.keys()];
    if (due.length)
      raf((t) => {
        for (const i of due) {
          const cb = waiting.get(i);
          waiting.delete(i);
          cb?.(t);
        }
      });
  }, ms);
  window.requestAnimationFrame = (cb) => (waiting.set(++id, cb), id);
  window.cancelAnimationFrame = (i) => void waiting.delete(i);
};

async function slowPage(open, seed) {
  const opened = await open(seed);
  await opened.ctx.addInitScript(slowFrames, FRAME_MS);
  await opened.ctx.addInitScript(() => {
    window.__taps = [];
    addEventListener('pointerup', (e) => window.__taps.push(e.target.closest('.dq-scrim, .sw') ? 'window' : String(e.target.className)), true);
  });
  await opened.page.reload();
  return opened;
}

const gone = (page, sel, timeout) => page.locator(sel).waitFor({ state: 'detached', timeout }).then(() => true, () => false);

export const scenarios = {
  async 'slow-prompt'({ open, youOf, expect }) {
    for (const [btn, want] of [['Continue', { name: 'Robin', companion: 'Pip' }], ['Skip', { name: '', companion: '' }]]) {
      const { ctx, page, errors } = await slowPage(open);
      await page.locator('.title-screen').click();
      await page.locator('#np-name').fill('Robin');
      await page.locator('#np-comp').fill('Pip');
      await page.getByRole('button', { name: btn }).click();
      expect(await gone(page, '#np-name', CLOSE_MS), `the name prompt was still open ${CLOSE_MS} ms after ${btn}`);
      const you = await youOf(page);
      expect(you?.name === want.name && you?.companion === want.companion, `${btn} stored ${JSON.stringify(you)}`);
      expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'slow-action'({ open, expect, YOU }) {
    for (const when of ['shown', 'typing']) {
      // a returning player with names whose intro file is gone gets the Reload window instead of the scene
      const { ctx, page } = await slowPage(open, { [YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }) });
      await page.route('**/src/cutscene/director.ts*', (r) => r.abort());
      await page.locator('.title-screen').click();
      const reload = page.getByRole('button', { name: 'Reload' });
      await reload.waitFor();
      if (when === 'shown') await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.sw-actions')).opacity) === 1, null, { polling: 50 });
      else expect(await page.evaluate(() => Number(getComputedStyle(document.querySelector('.sw-actions')).opacity) < 1), 'the Lantern finished typing before the tap');
      const reloaded = page.waitForEvent('framenavigated', { predicate: (f) => f === page.mainFrame(), timeout: CLOSE_MS }).then(() => true, () => false);
      await reload.click();
      expect(await reloaded, `Reload tapped while ${when === 'shown' ? 'fully shown' : 'the Lantern typed'} did not reload the page within ${CLOSE_MS} ms`);
      await ctx.close();
    }
  },

  async 'slow-home'({ open, sleep, expect, YOU, SEEN }) {
    const { ctx, page, errors } = await slowPage(open, { [YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }), 'dbt.app.v1': SEEN });
    await page.locator('.dq-sw').waitFor();
    // the live check's walk: up to 40 reads 400 ms apart, Home on three in a row, a tap only while a scrim is up
    let clear = 0;
    for (let i = 0; i < 40 && clear < 3; i++) {
      const home = !(await page.locator('.dq-sw').count()) && (await page.locator('.dq-tile').first().isVisible().catch(() => false));
      clear = home ? clear + 1 : 0;
      if (!home && (await page.locator('.dq-scrim.is-on').count())) await page.mouse.click(195, 700);
      await sleep(400);
    }
    expect(clear === 3, 'Home never appeared inside the live check budget');
    const taps = await page.evaluate(() => window.__taps);
    expect(taps.length && taps.every((t) => t === 'window'), 'a tap reached Home: ' + taps.join(', '));
    expect(await page.locator('.dq-card:not(.is-open)').count(), 'the quest card was turned over');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
