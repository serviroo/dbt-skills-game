// Skip in the intro ends the scene in flight: nothing more of it plays or moves, the letterbox and any hush before the
// hit are gone, and the rewards come next. Steps the real intro frame by frame in ?capture, so every run checks the
// same frames, and reads what the scene asked of the audio from the capture's audio log.

/** The intro from `from` on, stepped 1/15 s at a time, with Skip on screen (the intro was seen before). */
async function intro(h, from) {
  const { page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, `?shot=${from}&capture&mute&dpr=1&nopost`);
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

/** Presses Skip, steps on to the rewards, and returns what the scene asked of the audio from the press on. */
async function skip(h, page, tag) {
  const before = await page.evaluate(() => window.__audioLog.length);
  await page.locator('.ui-skip').click();
  h.expect(await page.evaluate(() => window.__steps(() => !!document.querySelector('.rw'), 600)), `${tag}: the rewards never came after Skip`);
  await page.evaluate(() => { let i = 0; return window.__steps(() => ++i > 30); });
  const after = await page.evaluate((n) => window.__audioLog.slice(n).map((e) => `${e.kind} ${e.name}`), before);
  const bars = await page.evaluate(() => [...document.querySelectorAll('.lb')].map((b) => parseFloat(b.style.height) || 0));
  h.expect(bars.every((v) => v === 0), `${tag}: the letterbox stayed over the rewards (${bars.join(', ')} vh)`);
  await h.shot(page, `intro-skip-${tag}`);
  return after;
}

export const scenarios = {
  /** Skip in the slow push-in to his eyes: the eyes never ignite, no letterbox closes in, the score never turns to the awaken */
  async 'skip-mid-silhouette'(h) {
    const { page, errors } = await intro(h, 'silhouette');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'play' && e.name === 'whoosh'))), 'the silhouette never started');
    // 8 s in: inside the 5.13 s push-in that starts 6.4 s after the whoosh
    await page.evaluate(() => { let i = 0; return window.__steps(() => ++i > 120); });
    const after = await skip(h, page, 'silhouette');
    const late = after.filter((e) => e === 'play eye_swell' || e === 'music awaken');
    h.expect(!late.length, `the skipped silhouette still played on after Skip: ${late.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Skip in the hush before the hit: the sound comes back for the rewards and the hit never lands */
  async 'skip-in-the-hush'(h) {
    const { page, errors } = await intro(h, 'awaken');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'hush'))), 'the awaken scene never hushed before the hit');
    const after = await skip(h, page, 'hush');
    h.expect(after.includes('unhush master'), `the hush before the hit held over the rewards: ${after.join(', ')}`);
    const late = after.filter((e) => /^play (awaken_hit|riser|soldier_ignite|stand_swell)$/.test(e));
    h.expect(!late.length, `the skipped awaken scene still played on after Skip: ${late.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Skip while the chest charges: the charge hum stops and the chest never bursts */
  async 'skip-in-the-chest-charge'(h) {
    const { page, errors } = await intro(h, 'chest');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'charge' && e.name === 'start'))), 'the chest never started to charge');
    const after = await skip(h, page, 'chest');
    h.expect(after.includes('charge stop'), `the charge hum kept going over the rewards: ${after.join(', ')}`);
    h.expect(!after.includes('play chest_burst'), 'the skipped chest still burst open after Skip');
    h.expect(!errors.length, errors.join('\n'));
  },
};
