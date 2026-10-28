// A lost WebGL context in the intro (a GPU reset, a phone in the background, too many contexts) never freezes it: the
// scene ends there as Skip ends it, also on a first run, which has no Skip; the dead canvas is hidden instead of showing
// the browser's broken-canvas picture; and the rewards, letter and end card carry on to Home. The beat checks step the
// real intro frame by frame in ?capture and read what the scene asked of the audio from the capture's audio log; the
// last two play in real time.

/** The intro from `from` on, on a first run, stepped 1/15 s at a time. */
async function intro(h, from, viewport) {
  const { page, errors } = await h.open({}, `?shot=${from}&capture&mute&dpr=1&nopost`, viewport);
  await page.waitForFunction(() => !!window.__stage && !!window.__audioLog, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__steps = async (until, max = 3000) => {
      for (let i = 0; i < max && !until(); i++) {
        window.__stage.step(1 / 15);
        await new Promise((r) => setTimeout(r));
      }
      return until();
    };
  });
  return { page, errors };
}

const loseContext = (page) => page.evaluate(() => window.__stage.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
const canvasHidden = (page) => page.evaluate(() => getComputedStyle(window.__stage.canvas).visibility === 'hidden');

/** Loses the context the way a GPU reset does, steps on, and returns what the scene asked of the audio from then on. */
async function lose(h, page, tag) {
  const before = await page.evaluate(() => window.__audioLog.length);
  await loseContext(page);
  // two seconds of the scene at most: the scene ends at once, as on Skip, and the rewards open on its next frames
  h.expect(await page.evaluate(() => window.__steps(() => !!document.querySelector('.rw'), 30)), `${tag}: the rewards never came after the context was lost`);
  h.expect(await canvasHidden(page), `${tag}: the lost canvas still shows over the page`);
  h.expect(!(await page.locator('.ui-skip').count()), `${tag}: Skip stayed over the rewards`);
  await page.evaluate(() => { let i = 0; return window.__steps(() => ++i > 30); });
  return page.evaluate((n) => window.__audioLog.slice(n).map((e) => `${e.kind} ${e.name}`), before);
}

/** A player's tap on a button once it shows on top (the end card's buttons keep moving, so a Playwright click waits on). */
async function tap(page, loc) {
  await loc.waitFor({ timeout: 30000 });
  await page.waitForFunction((b) => {
    const r = b.getBoundingClientRect();
    return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }, await loc.elementHandle({ timeout: 2000 }), { timeout: 30000 });
  const box = await loc.boundingBox({ timeout: 2000 });
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Taps through the rewards, the letter and the end card, in real time. */
async function closingCards(page, sleep) {
  const note = page.getByRole('button', { name: 'Read the note' });
  await note.waitFor({ timeout: 30000 });
  for (let i = 0; i < 40 && (await page.locator('.rw').count()); i++) {
    const box = await note.boundingBox({ timeout: 1000 }).catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(500);
  }
  await tap(page, page.getByRole('button', { name: 'Continue' }));
  await tap(page, page.getByRole('button', { name: 'Enter the Lantern' }));
}

export const scenarios = {
  /** Lost in the slow push-in to his eyes: the eyes never ignite and the score never turns to the awaken */
  async 'context-lost-mid-silhouette'(h) {
    const { page, errors } = await intro(h, 'silhouette');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'play' && e.name === 'whoosh'))), 'the silhouette never started');
    // 8 s in: inside the 5.13 s push-in that starts 6.4 s after the whoosh
    await page.evaluate(() => { let i = 0; return window.__steps(() => ++i > 120); });
    const after = await lose(h, page, 'silhouette');
    const late = after.filter((e) => e === 'play eye_swell' || e === 'music awaken');
    h.expect(!late.length, `the silhouette played on blind after the context was lost: ${late.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Lost in the hush before the hit, on a desktop screen: the sound comes back for the rewards and the hit never lands */
  async 'context-lost-in-the-hush'(h) {
    const { page, errors } = await intro(h, 'awaken', { width: 1440, height: 900 });
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'hush'))), 'the awaken scene never hushed before the hit');
    const after = await lose(h, page, 'hush');
    h.expect(after.includes('unhush master'), `the hush before the hit held over the rewards: ${after.join(', ')}`);
    const late = after.filter((e) => /^play (awaken_hit|riser|soldier_ignite|stand_swell)$/.test(e));
    h.expect(!late.length, `the awaken scene played on blind after the context was lost: ${late.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Lost while the chest charges: the charge hum stops and the chest never bursts */
  async 'context-lost-in-the-chest-charge'(h) {
    const { page, errors } = await intro(h, 'chest');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'charge' && e.name === 'start'))), 'the chest never started to charge');
    const after = await lose(h, page, 'chest');
    h.expect(after.includes('charge stop'), `the charge hum kept going over the rewards: ${after.join(', ')}`);
    h.expect(!after.includes('play chest_burst'), 'the chest still burst open after the context was lost');
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Real time, on a first run: lost while the chest waits for its hold, the intro still reaches Home without a tap on
   *  the chest, marked as seen, with the Safe Zone one tap away. */
  async 'context-lost-intro-reaches-home'(h) {
    const { ctx, page, errors } = await h.open({}, '?shot=chest&mute');
    try {
      const title = page.locator('.title-screen');
      await title.waitFor({ timeout: 60000 });
      await h.sleep(1500);
      await title.click();
      await page.locator('.chest-hold').waitFor({ timeout: 60000 });
      await loseContext(page);
      await page.locator('.rw').waitFor({ timeout: 15000 }).catch(async (e) => {
        await h.shot(page, 'fail-context-lost-no-rewards');
        throw e;
      });
      h.expect(await canvasHidden(page), 'the lost canvas still shows behind the rewards');
      h.expect(!(await page.locator('.chest-hold').count()), 'the chest hold stayed over the rewards');
      await h.shot(page, 'context-lost-rewards');
      await closingCards(page, h.sleep);
      await h.reachHub(page);
      const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('dbt.app.v1') || '{}').seenCutscene);
      h.expect(seen === true, 'the intro was not marked as seen');
      await page.locator('header .dq-safe').click({ timeout: 4000 });
      await page.waitForFunction(() => window.__daily?.route.name === 'safe', null, { timeout: 4000 }).catch(() => {});
      h.expect((await page.evaluate(() => window.__daily?.route.name)) === 'safe', 'the Safe Zone did not open in one tap after the intro');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Real time: lost on the title screen and given back before the tap, the scene plays and draws as ever, and Skip still
   *  takes it to the rewards. */
  async 'context-back-before-the-scene'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?shot=silhouette&mute', { width: 1440, height: 900 });
    try {
      const title = page.locator('.title-screen');
      await title.waitFor({ timeout: 60000 });
      await page.evaluate(() => (window.__lose = window.__stage.renderer.getContext().getExtension('WEBGL_lose_context')).loseContext());
      await page.waitForFunction(() => window.__stage.lost, null, { timeout: 5000 });
      h.expect(await canvasHidden(page), 'the lost canvas still shows behind the title');
      await page.evaluate(() => window.__lose.restoreContext());
      await page.waitForFunction(() => !window.__stage.lost, null, { timeout: 5000 });
      await h.sleep(1500);
      await title.click();
      await page.locator('.ui-skip').waitFor({ timeout: 60000 });
      const frame = () => page.evaluate(() => window.__stage.renderer.info.render.frame);
      const f0 = await frame();
      await page.waitForFunction((f) => window.__stage.renderer.info.render.frame > f + 2, f0, { timeout: 30000 }).catch(() => {});
      h.expect((await frame()) > f0 + 2, 'the scene drew no frames on the context it got back');
      h.expect(!(await canvasHidden(page)), 'the canvas stayed hidden after the context came back');
      await page.locator('.ui-skip').click();
      await page.locator('.rw').waitFor({ timeout: 15000 });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
