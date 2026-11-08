import { watchStage, stageState, compareStillFrame } from './still-stage.mjs';
import { screenshot } from './harness.mjs';

async function audioBackdrop(h, nopost) {
  const query = '?lab=audio&mute&dpr=1' + (nopost ? '&nopost' : '');
  const { ctx, page, errors } = await h.open({}, query);
  try {
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await watchStage(page, true);
    const blooms = nopost ? 0 : 1;
    const refreshed = await h.poll(page, () => stageState(page), (s) => s.scenes > 0,
      'the audio lab did not refresh its backdrop');
    h.expect(refreshed.scenes === 1 && refreshed.blooms === blooms,
      `the audio lab did not refresh its expensive passes once (${JSON.stringify(refreshed)})`);
    await h.frames(page, 60);
    const rested = await stageState(page);
    h.expect(rested.scenes === 1 && rested.blooms === blooms,
      `the audio lab kept rendering its expensive passes (${JSON.stringify(rested)})`);
    h.expect(rested.time > refreshed.time && rested.frames - refreshed.frames >= 60,
      'the audio lab stopped its clock or lost its frame trail');
    h.expect(rested.frames - refreshed.frames === rested.loopFrames - refreshed.loopFrames,
      `the audio lab frame trail missed live frames (${JSON.stringify([refreshed, rested])})`);
    let maxDelta;
    let staleDelta;
    if (nopost) {
      const index = await page.evaluate(() => [...document.querySelectorAll('canvas')].indexOf(window.__stage.canvas));
      const canvas = page.locator('canvas').nth(index);
      const kept = await screenshot(canvas);
      await page.evaluate(() => {
        window.__stage.invalidate();
        window.__stage.draw(0);
      });
      const redrawn = await screenshot(canvas);
      h.expect(kept.equals(redrawn), 'the audio lab kept canvas differs from a full redraw without post-processing');
      const changed = await stageState(page);
      h.expect(changed.scenes === 2 && changed.blooms === 0,
        'the audio lab did not refresh once without post-processing');
    } else {
      maxDelta = await compareStillFrame(page);
      h.expect(maxDelta <= 1, `the audio lab kept image differs from a full redraw by ${maxDelta}`);
      staleDelta = await compareStillFrame(page, true);
      h.expect(staleDelta > 1, `the audio lab image check accepted a stale backdrop (${staleDelta})`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return { refreshed, rested, maxDelta, staleDelta };
  } finally {
    await ctx.close();
  }
}

export const scenarios = {
  'audio-lab-backdrop-rests': (h) => audioBackdrop(h, false),
  'audio-lab-backdrop-rests-nopost': (h) => audioBackdrop(h, true),

  async 'stage-slow-updates-are-timed'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute&dpr=1');
    try {
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
      const results = [];
      for (const capture of [false, true]) {
        await page.evaluate((capture) => {
          const s = window.__stage;
          window.__slowFrame = null;
          const off = s.onUpdate(() => {
            const trail = window.__e2eTrail;
            const start = performance.now();
            while (performance.now() - start < 60) Math.sqrt(performance.now());
            window.__slowFrame = { n: trail.frames + 1, start, ms: performance.now() - start };
            off();
          });
          if (capture) s.step(0);
        }, capture);
        await page.waitForFunction(() => window.__slowFrame &&
          window.__e2eTrail.frames >= window.__slowFrame.n);
        const result = await page.evaluate(() => {
          const slow = window.__slowFrame;
          const frame = window.__e2eTrail.ev.find((e) => e.ev === 'frame' && e.n === slow.n);
          return { slow, frame };
        });
        h.expect(result.frame && result.frame.ms >= Math.floor(result.slow.ms) &&
          result.frame.t <= Math.round(result.slow.start),
        `the ${capture ? 'capture' : 'live'} frame log missed its slow update (${JSON.stringify(result)})`);
        results.push(result);
      }
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
};
