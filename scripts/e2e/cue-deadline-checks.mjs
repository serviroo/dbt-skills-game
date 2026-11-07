import { audioRecorded, audioHeard, captureEngine } from './audio-recorder.mjs';

export async function expiredBuilds(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    await page.evaluate(async () => {
      const { soon } = await import('/src/audio/param.ts');
      const { stoppedBy } = await import('/src/audio/voice.ts');
      const at = soon(window.__engine.ctx);
      window.__engine.stopAll(0.005, at);
      window.__quietAfter = stoppedBy(at, 0.005);
    });
    await page.waitForFunction((tap) => {
      const rec = window.__taps[tap];
      return (rec.end - 16) * 128 / rec.context.sampleRate > window.__quietAfter &&
        [...rec.q].filter(([k]) => k >= rec.end - 16).every(([, [peak]]) => peak < 1e-6);
    }, tap);
    const r = await page.evaluate(async (tap) => {
      const { Voice } = await import('/src/audio/voice.ts');
      const { SCORE } = await import('/src/motion/tokens.ts');
      const { soon } = await import('/src/audio/param.ts');
      const engine = window.__engine;
      const clock = window.__taps[tap].context;
      const open = Voice.prototype.openInTime;
      const rows = [];
      const from = clock.currentTime;
      const stall = 0.15;
      const late = SCORE.lateSec;
      for (const explicit of [true, false]) {
        for (const kind of ['cue', 'hush']) {
          const asked = explicit ? clock.currentTime : undefined;
          const attempts = [];
          const warnings = [];
          const warn = console.warn;
          console.warn = (...args) => warnings.push(args);
          let deadline;
          Voice.prototype.openInTime = function (...args) {
            deadline ??= (asked ?? soon(clock)) + late;
            window.__stall = { after: 'start', by: stall };
            const kept = open.apply(this, args);
            attempts.push({ kept: kept !== false, at: this.t });
            return kept;
          };
          window.__watch = true;
          let stopped = true;
          try {
            if (kind === 'cue') {
              const h = engine.play('bubble', { at: asked });
              h.stop();
              stopped = Number.isFinite(h.end) && engine.active.size === 0;
            } else {
              engine.hush(asked);
              stopped = engine.hushV === null;
            }
          } finally {
            window.__watch = false;
            window.__stall = null;
            Voice.prototype.openInTime = open;
            console.warn = warn;
          }
          rows.push({ kind, explicit, attempts, warnings, stopped, deadline, returned: clock.currentTime });
        }
      }
      return { rows, from, to: clock.currentTime + 0.15, behind: window.__behind, stall, late };
    }, tap);
    await audioRecorded(page, tap, r.to);
    const heard = await audioHeard(page, tap, r.from, r.to, [1e-6, 1e-6]);
    for (const row of r.rows) {
      const name = `${row.kind}, ${row.explicit ? 'asked time' : 'soon'}`;
      h.expect(row.attempts.length > 0 && row.attempts.every((a) => !a.kept), `${name}: a missed build opened`);
      h.expect(row.stopped, `${name}: the dropped handle was still running`);
      h.expect(row.warnings.length === 1 && row.warnings[0][1] === (row.kind === 'cue' ? 'bubble' : 'hush'),
        `${name}: the final drop was not reported once: ${JSON.stringify(row.warnings)}`);
      const over = row.returned - row.deadline;
      h.expect(over <= r.stall + 128 / 48000, `${name}: returned ${over}s past the deadline`);
    }
    h.expect(!r.behind.length, `${r.behind.length} parts were placed behind the clock`);
    h.expect(heard.cover === 1 && heard.peak < 1e-6, `a dropped sound was heard: ${JSON.stringify(heard)}`);
    h.expect(!errors.length, errors.join('\n'));
    return { rows: r.rows, heard };
  } finally {
    await ctx.close();
  }
}
