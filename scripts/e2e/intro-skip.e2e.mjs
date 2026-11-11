import { install, pauseClock, runFor } from './clock.mjs';

// Skip in the intro ends the scene in flight and goes straight to Home: nothing more of it plays or moves, every sound
// it started stops, and the letterbox and any hush before the hit are gone. Steps the real intro frame by frame in
// ?capture, so every run checks the same frames, and reads what the scene asked of the audio from the capture's audio log.

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

/** Presses Skip, steps on to Home, and returns what the scene asked of the audio from the press on. */
async function skip(h, page, tag) {
  const before = await page.evaluate(() => window.__audioLog.length);
  await page.locator('.ui-skip').click();
  const cam = () => page.evaluate(() => { const c = window.__stage.camera; return [...c.position.toArray(), ...c.quaternion.toArray(), c.fov].map((v) => v.toFixed(5)).join(' '); });
  const held = await cam();
  h.expect(await page.evaluate(() => window.__steps(() => window.__daily?.route.name === 'hub', 600)), `${tag}: Home never came after Skip`);
  await page.evaluate(() => { let i = 0; return window.__steps(() => ++i > 30); });
  const now = await cam();
  h.expect(now === held, `${tag}: the camera kept moving after Skip (${held} -> ${now})`);
  const after = await page.evaluate((n) => window.__audioLog.slice(n).map((e) => `${e.kind} ${e.name}`), before);
  const bars = await page.evaluate(() => [...document.querySelectorAll('.lb')].map((b) => parseFloat(b.style.height) || 0));
  h.expect(bars.every((v) => v === 0), `${tag}: the letterbox stayed over Home (${bars.join(', ')} vh)`);
  // every sound, bed, charge hum and score section the cut scene started before Skip is stopped at the press
  const playing = await page.evaluate((n) => {
    const log = window.__audioLog;
    const left = new Map();
    for (const e of log.slice(0, n)) {
      if (e.kind === 'play') left.set(`sound ${e.name}`, (left.get(`sound ${e.name}`) ?? 0) + 1);
      if (e.kind === 'stop' && left.get(`sound ${e.name}`)) left.set(`sound ${e.name}`, left.get(`sound ${e.name}`) - 1);
      if (e.kind === 'bed') left.set(`bed ${e.name}`, e.args[0] > 0 ? 1 : 0);
      if (e.kind === 'charge' && e.name !== 'set') left.set('charge hum', e.name === 'stop' ? 0 : 1);
      if (e.kind === 'music') left.set('score', e.name === 'stop' ? 0 : 1);
    }
    for (const e of log.slice(n)) {
      const k = e.kind === 'stop' ? `sound ${e.name}` : e.kind === 'bed' && e.args[0] === 0 ? `bed ${e.name}` : e.kind === 'charge' && e.name === 'stop' ? 'charge hum' : e.kind === 'music' && e.name === 'stop' ? 'score' : null;
      if (k && left.get(k)) left.set(k, left.get(k) - 1);
    }
    return [...left].filter(([, c]) => c > 0).map(([k]) => k);
  }, before);
  h.expect(!playing.length, `${tag}: still playing over Home after Skip: ${playing.join(', ')}`);
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

  /** Skip in the hush before the hit: the sound comes back for Home and the hit never lands */
  async 'skip-in-the-hush'(h) {
    const { page, errors } = await intro(h, 'awaken');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'hush'))), 'the awaken scene never hushed before the hit');
    const after = await skip(h, page, 'hush');
    h.expect(after.includes('unhush master'), `the hush before the hit held over Home: ${after.join(', ')}`);
    const late = after.filter((e) => /^play (awaken_hit|riser|soldier_ignite|stand_swell)$/.test(e));
    h.expect(!late.length, `the skipped awaken scene still played on after Skip: ${late.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Skip late in the awaken scene, under the stand-up swell, its loudest sound: it and the roar stop at the press */
  async 'skip-late-in-awaken'(h) {
    const { page, errors } = await intro(h, 'awaken');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'play' && e.name === 'stand_swell'))), 'the awaken scene never reached the stand-up swell');
    // about 12 s in: the swell is 1.2 s old and runs for 7 s
    await page.evaluate(() => { let i = 0; return window.__steps(() => ++i > 18); });
    const after = await skip(h, page, 'late-awaken');
    h.expect(after.includes('stop stand_swell'), `the stand-up swell played on over Home: ${after.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** The rewards keep their own pace on the page clock, however slowly the 3D scene behind them draws: here every 3D
   *  frame comes a full second apart, and Read the note answers within its natural entrance and exit time.
   *  Not ?capture. */
  async 'rewards-keep-their-pace-on-slow-frames'(h) {
    const { ctx, page, errors } = await h.open(
      { 'dbt.app.v1': h.SEEN }, '?shot=rewards&mute', undefined, async (ctx) => {
      await install(ctx);
      await ctx.addInitScript(() => {
        const animate = Element.prototype.animate;
        const moments = { cards: [] };
        window.__rewardMoments = moments;
        Element.prototype.animate = function (frames, options) {
          const animation = animate.call(this, frames, options);
          if (!this.closest('.rw')) return animation;
          const start = performance.now();
          const end = Number(animation.effect.getComputedTiming().endTime);
          const card = this.matches('.rw-card') ? [...this.parentElement.children].indexOf(this) : -1;
          if (this.matches('.rw') && moments.attach !== undefined) moments.exit = start;
          animation.pause();
          animation.currentTime = 0;
          const timer = setInterval(() => {
            const elapsed = performance.now() - start;
            animation.currentTime = Math.min(elapsed, end);
            if (elapsed >= end) {
              if (card >= 0) moments.cards[card] = performance.now();
              animation.finish();
              clearInterval(timer);
            }
          }, 10);
          return animation;
        };
        document.addEventListener('click', (event) => {
          if (event.isTrusted && event.target.closest('.rw button')) moments.tap = performance.now();
        }, true);
        let root;
        new MutationObserver(() => {
          const rewards = document.querySelector('.rw');
          if (rewards && !root) {
            root = rewards;
            moments.attach = performance.now();
            moments.stageStart = window.__stage.time;
            window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 1000);
          }
          const button = rewards?.querySelector('button');
          if (button && !button.closest('[inert]') && moments.ready === undefined) moments.ready = performance.now();
          if (root && !root.isConnected && moments.gone === undefined) {
            moments.gone = performance.now();
            moments.stageEnd = window.__stage.time;
          }
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['inert'] });
      });
    });
    try {
      const title = page.locator('.title-screen');
      await title.waitFor({ timeout: 60000 });
      await h.sleep(1500);
      await pauseClock(page);
      const titleBox = await title.boundingBox();
      await page.mouse.click(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
      await h.poll(page, () => page.locator('.rw').count(), Boolean,
        'rewards did not attach while loading the world', { timeout: 60000, polling: 50 });
      const note = page.getByRole('button', { name: 'Read the note' });
      let ready = false;
      for (let i = 0; i < 13; i++) {
        await runFor(page, 300);
        ready = await note.evaluate((button) => !button.closest('[inert]') && !button.disabled
          && getComputedStyle(button).opacity === '1');
        if (ready) break;
      }
      const timeline = async () => page.evaluate(() => {
        const m = window.__rewardMoments;
        const at = (time) => time === undefined ? 'missing' : `${time - m.attach} ms`;
        return `attach: 0 ms, card ends: ${m.cards.map(at).join(', ') || 'missing'}, ready: ${at(m.ready)}, `
          + `tap: ${at(m.tap)}, exit start: ${at(m.exit)}, gone: ${at(m.gone)}`;
      });
      h.expect(ready, `Read the note stayed inert with 1 fps stage frames (${await timeline()})`);
      const box = await note.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await runFor(page, 400);
      const result = await page.evaluate(() => window.__rewardMoments);
      const detail = await timeline();
      h.expect(result.gone !== undefined && result.gone - result.attach <= 3850,
        `rewards did not leave within 3850 ms of browser time (${detail})`);
      h.expect(result.tap !== undefined && result.stageEnd - result.stageStart < 1,
        `stage advanced a second or more, or the note was not tapped (${detail})`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Skip after the chest is fully charged while Space is still held: the hold leaves with the scene instead of waiting
   *  over Home for the key to come up, and the key coming up does nothing there. Real time, not ?capture. */
  async 'skip-after-a-full-hold'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?shot=chest&mute');
    try {
      const title = page.locator('.title-screen');
      await title.waitFor({ timeout: 60000 });
      await h.sleep(1500);
      await title.click();
      await page.locator('.chest-hold').waitFor({ timeout: 60000 });
      await page.keyboard.down('Space');
      // the charge runs on the scene's clock, which a slow renderer advances a tenth of a second a frame at most: step it
      // past the 1.5 s charge here, as the ?capture checks step it, so reaching full doesn't depend on the frame rate
      await page.evaluate(() => {
        for (let i = 0; i < 4; i++) window.__stage.step(0.5);
      });
      await page.locator('.chest-hold.is-full').waitFor({ state: 'attached', timeout: 30000 });
      await page.locator('.ui-skip').click();
      await h.until(page, () => window.__daily?.route.name === 'hub', null, { timeout: 15000 });
      const left = await page.locator('.chest-hold').count();
      await page.keyboard.up('Space');
      await h.frames(page, 30);
      h.expect(!left, 'the full chest hold stayed on the page over Home while Space was held');
      h.expect(await page.evaluate(() => window.__daily.route.name === 'hub' && !document.querySelector('.rw')), 'letting go of Space after Skip moved on from Home');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Skip while the chest charges: the charge hum stops and the chest never bursts */
  async 'skip-in-the-chest-charge'(h) {
    const { page, errors } = await intro(h, 'chest');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'charge' && e.name === 'start'))), 'the chest never started to charge');
    const after = await skip(h, page, 'chest');
    h.expect(after.includes('charge stop'), `the charge hum kept going over Home: ${after.join(', ')}`);
    h.expect(!after.includes('play chest_burst'), 'the skipped chest still burst open after Skip');
    h.expect(!errors.length, errors.join('\n'));
  },
};
