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
        const stops = {
          Skip: (e) => e.stopAll(SCORE.leaveSec, 0.2),
          'the Safe Zone': (e) => {
            e.quiet(true, SCORE.safeOutSec, 0.2);
            e.quiet(false, SCORE.safeOutSec, 0.5);
          },
        };
        const render = async (stop) => {
          const c = new OfflineAudioContext(2, rate * 2, rate);
          const e = new AudioEngine(c);
          if (stop) {
            e.hush(0);
            stop(e);
          }
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
          return { room: read(0.05, 0.2), between: read(0.5, 0.8), bed: read(1.2, 2) };
        };
        const ways = {};
        for (const [way, stop] of Object.entries(stops)) ways[way] = await render(stop);
        return { clean: (await render(null)).bed, ways };
      });
      h.expect(r.clean.rms > 10 * SILENT_PEAK, `the bed was not audible on its own (RMS ${r.clean.rms})`);
      for (const [way, w] of Object.entries(r.ways)) {
        const { room, between } = w;
        h.expect(room.peak > 10 * SILENT_PEAK, `${way}: the hush was silent (peak ${room.peak})`);
        h.expect(between.peak < SILENT_PEAK, `${way}: the hush played on after it (peak ${between.peak})`);
        const level = (w.bed.rms / r.clean.rms).toFixed(3);
        h.expect(level > 0.7, `${way}: a bed started after it plays at ${level} of its level: the hush holds it down`);
      }
      h.expect(!errors.length, errors.join('\n'));
      return { clean: r.clean.rms, ways: Object.fromEntries(Object.entries(r.ways).map(([k, w]) => [k, w.bed.rms])) };
    } finally {
      await ctx.close();
    }
  },
};
