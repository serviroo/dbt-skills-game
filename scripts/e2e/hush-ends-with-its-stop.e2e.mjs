const SILENT_PEAK = 2 ** -15;

export const scenarios = {
  async 'every-stop-ends-the-hush-before-the-hit'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const rate = 44100;
        const press = 0.2;
        const stops = {
          Skip: (e) => {
            e.bed('gate_hum', { at: 0, level: 20, fadeIn: 0.05 });
            e.hush(0);
            e.stopAll(SCORE.leaveSec, press);
            e.unhush(press + 0.01);
          },
          'Skip in a hush with its end set': (e) => {
            e.bed('gate_hum', { at: 0, level: 20, fadeIn: 0.05 });
            e.hush(0, 1);
            e.stopAll(SCORE.leaveSec, press);
          },
          'Skip after a slower stop': (e) => {
            e.hush(0);
            e.reset(0.6, press);
            e.stopAll(SCORE.leaveSec, press + 0.1);
          },
          'a slower stop after Skip': (e) => {
            e.hush(0);
            e.stopAll(SCORE.leaveSec, press);
            e.stopAll(0.6, press + 0.05);
          },
          'Skip without cancelAndHoldAtTime': (e) => {
            const hold = AudioParam.prototype.cancelAndHoldAtTime;
            delete AudioParam.prototype.cancelAndHoldAtTime;
            try {
              e.bed('gate_hum', { at: 0, level: 20, fadeIn: 0.05 });
              e.hush(0);
              e.stopAll(SCORE.leaveSec, press);
            } finally {
              AudioParam.prototype.cancelAndHoldAtTime = hold;
            }
          },
          'Skip before an unhush set for later': (e) => {
            e.hush(0);
            e.unhush(1.5);
            e.stopAll(SCORE.leaveSec, press);
          },
          'the Safe Zone': (e) => {
            e.hush(0);
            e.quiet(true, SCORE.safeOutSec, press);
            e.stopAll(SCORE.safeOutSec, press);
            e.quiet(false, SCORE.safeOutSec, 0.5);
          },
        };
        const render = async (stop) => {
          const c = new OfflineAudioContext(2, rate * 2, rate);
          const e = new AudioEngine(c);
          stop?.(e);
          e.bed('ambient', { at: 0.8, fadeIn: 0.1 });
          const buf = await c.startRendering();
          const read = (a, b) => {
            let peak = 0;
            let ss = 0;
            let n = 0;
            for (let ch = 0; ch < 2; ch++) {
              for (const x of buf.getChannelData(ch).subarray(Math.ceil(a * rate), Math.ceil(b * rate))) {
                peak = Math.max(peak, Math.abs(x));
                ss += x * x;
                n++;
              }
            }
            return { peak, rms: Math.sqrt(ss / n) };
          };
          const [held, fade] = [read(0.1, press), read(press, press + 0.15)];
          return { held, fade, between: read(0.5, 0.8), bed: read(1, 1.45) };
        };
        const ways = {};
        for (const [way, stop] of Object.entries(stops)) ways[way] = await render(stop);
        return { clean: (await render(null)).bed, ways };
      });
      h.expect(r.clean.rms > 10 * SILENT_PEAK, `the bed was not audible on its own (RMS ${r.clean.rms})`);
      for (const [way, w] of Object.entries(r.ways)) {
        const { held, fade, between } = w;
        h.expect(held.peak > 10 * SILENT_PEAK, `${way}: the hush was silent (peak ${held.peak})`);
        h.expect(fade.peak <= held.peak, `${way}: the hush swelled from ${held.peak} to ${fade.peak} as it stopped`);
        h.expect(between.peak < SILENT_PEAK, `${way}: the hush played on after it (peak ${between.peak})`);
        const level = w.bed.rms / r.clean.rms;
        h.expect(level > 0.7, `${way}: a bed after it plays at ${level.toFixed(3)} of its level`);
      }
      h.expect(!errors.length, errors.join('\n'));
      return { clean: r.clean.rms, ways: Object.fromEntries(Object.entries(r.ways).map(([k, w]) => [k, w.bed.rms])) };
    } finally {
      await ctx.close();
    }
  },
};
