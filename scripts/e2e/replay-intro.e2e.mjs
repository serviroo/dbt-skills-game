// Replay cutscene in Settings plays the intro once, however it ends, on a returning save at 390x844 with real taps:
//   replay-skip-reload       Skip intro lands back on Settings, focus on Replay cutscene and the address as it was
//                            before the replay; Back goes Home and Forward to Settings without the intro (Forward
//                            again, onto the replay's own entry, stays there), and a reload opens the companion
//   replay-end-card-reload   played to its end card (the scene cut short, as when the graphics are lost), the end
//                            card's Replay plays it once more and Enter the Lantern lands on Settings the same way; a
//                            reload opens the companion
//   replay-back              at 320x568, Back during the replay ends it on Settings with the address as it was, and
//                            the untouched page adds no history entry (the browser's own Back would skip the one
//                            before it); Back, Forward and a reload from there never play it again

const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'replay-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});

/** The companion's screen once it shows one, or null. */
const screenOf = () => (window.__daily && document.querySelector('#dq-main > *') ? document.querySelector('.dq')?.dataset.screen : null);
/** What a page just loaded settles into: 'intro' or the companion's screen. */
const showing = (h, page) => h.until(page, () => (document.querySelector('.title-screen') ? 'intro' : (window.__daily && document.querySelector('#dq-main > *') ? document.querySelector('.dq')?.dataset.screen : null)), null, { timeout: 30000 });

/** Counts the history entries each page load adds, as __pushes. */
const countPushes = () => {
  window.__pushes = 0;
  const push = history.pushState.bind(history);
  history.pushState = (...a) => {
    window.__pushes++;
    return push(...a);
  };
};

async function settings(h, viewport) {
  const { ctx, page, errors } = await h.open(seed(h), '?mute&reduced', viewport, (c) => c.addInitScript(countPushes));
  await h.openSettings(page);
  return { ctx, page, errors, before: new URL(page.url()).search };
}

async function replay(page) {
  await page.getByRole('button', { name: 'Replay cutscene' }).click();
  await page.getByRole('button', { name: 'Skip intro' }).waitFor({ timeout: 30000 });
}

/** The replay is over: the companion is on Settings, focus on Replay cutscene, and the address is the one before it. */
async function backOnSettings(h, page, before, tag) {
  // the intro stays up until the press (or Back's popstate) has ended it and the companion has opened
  const at = await h.until(page, screenOf, null, { timeout: 30000 });
  h.expect(at === 'settings', `${tag}: the replay ended on ${at}, not back on Settings where it was played from`);
  const search = new URL(page.url()).search;
  h.expect(search === before, `${tag}: the address is ${search} after the replay, not ${before} as before it`);
  const focus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  h.expect(focus === 'Replay cutscene', `${tag}: focus is on "${focus}" after the replay, not on Replay cutscene`);
  await h.shot(page, `${tag}-settings`);
}

/**
 * Back goes Home and Forward to Settings in the same page, and neither plays the intro again; Forward once more (onto
 * the replay's own entry) stays on Settings. Then a reload opens the companion.
 */
async function neverAgain(h, page, before, tag) {
  await page.evaluate(() => {
    window.__samePage = true;
    window.__moves = 0;
    window.addEventListener('popstate', () => window.__moves++);
  });
  // the replay's own entry is stepped back over, so Forward onto it is two moves
  for (const [move, to, moves] of [['back', 'hub', 1], ['forward', 'settings', 1], ['forward', 'settings', 2]]) {
    await page.evaluate((m) => {
      window.__moves = 0;
      history[m]();
    }, move);
    await h.until(page, (n) => window.__moves >= n, moves);
    const shown = () => (document.querySelector('.title-screen') ? 'intro' : document.querySelector('.dq')?.dataset.screen);
    const at = await h.until(page, (n) => document.querySelector('.title-screen') || document.querySelector('.dq')?.dataset.screen === n, to).then(() => page.evaluate(shown), () => page.evaluate(shown).catch(() => 'a new page'));
    h.expect(at === to, `${tag}: ${move} after the replay showed ${at}, not ${to}`);
    h.expect(await page.evaluate(() => window.__samePage === true), `${tag}: ${move} after the replay loaded the page again`);
  }
  await page.reload();
  const at = await showing(h, page);
  h.expect(at !== 'intro', `${tag}: a reload after the replay played the intro again`);
  const search = new URL(page.url()).search;
  h.expect(search === before, `${tag}: the address is ${search} after a reload, not ${before}`);
  await h.shot(page, `${tag}-reloaded`);
}

/** The cinematic cut short, as when its graphics are lost, then the rewards and the letter tapped through to the end card. */
async function toEndCard(page) {
  await page.locator('.title-screen').click();
  await page.locator('.lb').first().waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(() => window.__stage.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
  for (const button of ['.rw .sw-btn', '.letter .sw-btn']) await page.locator(button).first().click({ timeout: 30000 });
  await page.locator('.endcard').waitFor({ timeout: 30000 });
}

export const scenarios = {
  async 'replay-skip-reload'(h) {
    const { ctx, page, errors, before } = await settings(h);
    try {
      await replay(page);
      await h.shot(page, 'skip-replaying');
      await page.getByRole('button', { name: 'Skip intro' }).click();
      await backOnSettings(h, page, before, 'skip');
      await neverAgain(h, page, before, 'skip');
      h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
    } catch (e) {
      await h.evidence(page, 'replay-skip-fail');
      throw e;
    } finally {
      await ctx.close();
    }
  },

  async 'replay-end-card-reload'(h) {
    const { ctx, page, errors, before } = await settings(h);
    try {
      await replay(page);
      await toEndCard(page);
      await page.locator('.ec-actions [data-v="replay"]').click();
      await page.locator('.title-screen').waitFor({ timeout: 30000 });
      await toEndCard(page);
      await h.shot(page, 'end-card');
      await page.locator('.ec-actions .sw-btn.gold').click();
      await backOnSettings(h, page, before, 'end-card');
      await neverAgain(h, page, before, 'end-card');
      h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
    } catch (e) {
      await h.evidence(page, 'replay-end-card-fail');
      throw e;
    } finally {
      await ctx.close();
    }
  },

  async 'replay-back'(h) {
    const { ctx, page, errors, before } = await settings(h, { width: 320, height: 568 });
    try {
      await replay(page);
      // the page playing the replay has not been touched: it must add no history entry, or the browser's own Back
      // would skip the one before it
      await page.evaluate(() => history.back());
      await backOnSettings(h, page, before, 'back');
      const pushes = await page.evaluate(() => window.__pushes);
      h.expect(pushes === 0, `back: the page playing the replay, never touched, added ${pushes} history entries`);
      await neverAgain(h, page, before, 'back');
      h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
    } catch (e) {
      await h.evidence(page, 'replay-back-fail');
      throw e;
    } finally {
      await ctx.close();
    }
  },
};
