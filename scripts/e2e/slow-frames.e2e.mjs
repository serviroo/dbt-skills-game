const FRAME_MS = 2500;
const CLOSE_MS = 2000;

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

export const scenarios = {
  async 'slow-prompt'({ open, youOf, expect }) {
    for (const [btn, want] of [['Continue', { name: 'Robin', companion: 'Pip' }], ['Skip', { name: '', companion: '' }]]) {
      const { ctx, page, errors } = await slowPage(open);
      await page.locator('.title-screen').click();
      await page.locator('#np-name').fill('Robin');
      await page.locator('#np-comp').fill('Pip');
      await page.getByRole('button', { name: btn }).click();
      const closed = await page.locator('#np-name').waitFor({ state: 'detached', timeout: CLOSE_MS }).then(() => true, () => false);
      expect(closed, `the name prompt was still open ${CLOSE_MS} ms after ${btn}`);
      const you = await youOf(page);
      expect(you?.name === want.name && you?.companion === want.companion, `${btn} stored ${JSON.stringify(you)}`);
      expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'slow-action'({ open, expect, YOU }) {
    for (const when of ['shown', 'typing']) {
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
