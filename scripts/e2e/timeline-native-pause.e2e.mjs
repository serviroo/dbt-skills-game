import { runPauseCases } from './cues-timeline-scenarios.mjs';

export const scenarios = {
  async 'timeline-native-calls-survive-pauses'(h) {
    const { ctx, page, errors } = await h.open({
      'dbt.app.v1': h.SEEN,
      'dbt.audio.v1': JSON.stringify({ v: 1, master: 1, music: 0, sfx: 1, muted: false }),
    }, '');
    try {
      await page.waitForFunction(() => !!window.__daily, null, { timeout: 30000 });
      await page.keyboard.press('Shift');
      await h.reachHub(page);
      await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const play = AudioEngine.prototype.play;
        let engine;
        AudioEngine.prototype.play = function (...args) {
          engine = this;
          return play.apply(this, args);
        };
        try { window.__daily.sound('check'); } finally { AudioEngine.prototype.play = play; }
        await engine.unlock();
        if (engine.timeline) await engine.timeline.ready;
        window.__taps = [{ context: engine.ctx }];
        window.__behind = [];
        window.__watch = false;
        tapAudioSchedule((_, method, args, time) => {
          const now = engine.ctx.currentTime;
          if (window.__watch && time > 0 && time < now) window.__behind.push([method, now - time]);
        });
      });
      const rows = await page.evaluate(runPauseCases, [['check', 'soft_chime'], 0, 2 / 60]);
      const bad = rows.filter((r) => !r.paused || r.behind.length);
      const details = bad.map((r) =>
        `${r.cue} ${r.duration} ms ${r.seam}: paused=${r.paused}, behind=${r.behind.length}`,
      ).join('; ');
      h.expect(rows.length === 16 && !bad.length,
        `${bad.length} of ${rows.length} pauses placed calls behind the audio clock: ` + details);
      h.expect(!errors.length, errors.join('\n'));
      return { cases: rows.length, behind: 0 };
    } finally { await ctx.close(); }
  },
};
