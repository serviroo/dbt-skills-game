import { watchStage, stageState, compareStillFrame } from './still-stage.mjs';

export const scenarios = {
  async 'audio-lab-backdrop-rests'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute&dpr=1');
    try {
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await watchStage(page, true);
      const refreshed = await h.poll(page, () => stageState(page), (s) => s.scenes > 0 && s.blooms > 0,
        'the audio lab did not refresh its backdrop');
      h.expect(refreshed.scenes === 1 && refreshed.blooms === 1,
        `the audio lab did not refresh its expensive passes once (${JSON.stringify(refreshed)})`);
      await h.frames(page, 60);
      const rested = await stageState(page);
      h.expect(rested.scenes === 1 && rested.blooms === 1,
        `the audio lab kept rendering its expensive passes (${JSON.stringify(rested)})`);
      h.expect(rested.time > refreshed.time && rested.frames - refreshed.frames >= 60,
        'the audio lab stopped its clock or lost its frame trail');
      h.expect(rested.frames - refreshed.frames === rested.loopFrames - refreshed.loopFrames,
        `the audio lab frame trail missed live frames (${JSON.stringify([refreshed, rested])})`);
      const maxDelta = await compareStillFrame(page);
      h.expect(maxDelta <= 1, `the audio lab kept image differs from a full redraw by ${maxDelta}`);
      h.expect(!errors.length, errors.join('\n'));
      return { refreshed, rested, maxDelta };
    } finally {
      await ctx.close();
    }
  },
};
