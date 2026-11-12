export const scenarios = {
  async 'cue-and-charge-bus-moves-use-picked-start'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { Moment } = await import('/src/audio/moment.ts');
        const { soon } = await import('/src/audio/param.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const cases = [
          ['ui_open', 'uiDuck', [0, 0.28]], ['reward_chime', 'uiDuck', [0, 0.28]],
          ['level_resolve', 'uiDuck', [0, 0.28]], ['letter_open', 'uiDuck', [0, 0.28]],
          ['breath_in', 'focus', [0, 10.4]], ['breath_out', 'focus', [0, 12.4]],
          ['lift', 'shelf', [0]], ['close', 'shelf', [0]],
          ['soldier_ignite', 'yieldG', [0, 0.5]], ['stand_swell', 'yieldG', [0.12, 1.04]],
          ['charge', 'focus', [0]],
        ];
        const out = [];
        for (const [kind, bus, offsets] of cases) {
          for (const stalled of [false, true]) {
            const clock = new AudioContext({ latencyHint: 'interactive' });
            await clock.resume();
            const engine = new AudioEngine(clock, { stats: true });
            if (kind === 'close') engine.play('ui_open', { detune: 500 });
            const target = bus === 'shelf' ? engine.shelf.gain : engine[bus].curve.param;
            const times = [];
            let picked;
            let afterPause;
            const place = Moment.prototype.place;
            const undo = tapAudioSchedule((node, method, _args, time) => {
              if (node === target && method === 'setTargetAtTime') times.push(time);
            });
            Moment.prototype.place = function (at) {
              picked = at;
              const result = place.call(this, at);
              if (stalled) {
                const until = performance.now() + (soon(clock) - clock.currentTime) * 1000 + 100;
                while (performance.now() < until);
                afterPause = clock.currentTime;
              }
              return result;
            };
            try {
              if (kind === 'charge') engine.chargeLoop();
              else if (kind === 'lift') engine.play('ui_open', { detune: 500 });
              else if (kind === 'close') engine.play('ui_close');
              else engine.play(kind, kind === 'breath_out' ? { dur: 12 } : {});
              out.push({ kind, stalled, picked, afterPause, offsets, times,
                correct: Number.isFinite(picked) && (!stalled || afterPause > picked) && times.length === offsets.length
                  && offsets.every((offset, i) => Math.abs(times[i] - picked - offset) < 1e-7) });
            } finally {
              Moment.prototype.place = place;
              undo();
              await clock.close();
              engine.dispose();
            }
          }
        }
        return out;
      });
      h.expect(results.every((result) => result.correct), JSON.stringify(results.filter((result) => !result.correct)));
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
  async 'cues-beds-and-charge-record-placement-pauses'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { Moment } = await import('/src/audio/moment.ts');
        const { soon } = await import('/src/audio/param.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const out = [];
        for (const kind of ['cue', 'bed', 'charge']) {
          const clock = new AudioContext({ latencyHint: 'interactive' });
          await clock.resume();
          const pauseMs = (soon(clock) - clock.currentTime) * 1000 + 100;
          const engine = new AudioEngine(clock, { seed: 20261020, stats: true });
          const place = Moment.prototype.place;
          let placing = false;
          let paused = false;
          const calls = [];
          const undo = tapAudioSchedule((_, method, _args, time) => {
            if (!placing) return;
            if (!paused && method === 'start') {
              const until = performance.now() + pauseMs;
              while (performance.now() < until);
              paused = true;
            }
            calls.push({ method, time, now: clock.currentTime, afterPause: paused });
          });
          Moment.prototype.place = function (...args) {
            placing = true;
            try { return place.apply(this, args); } finally { placing = false; }
          };
          try {
            if (kind === 'cue') engine.play('ui_open');
            else if (kind === 'bed') engine.bed('gate_hum');
            else engine.chargeLoop();
            const before = calls.filter((c) => !c.afterPause && c.time > 0);
            const after = calls.filter((c) => c.afterPause && c.time > 0);
            out.push({ kind, pauseMs, before: before.length, after: after.length,
              beforeLate: before.filter((c) => c.time < c.now).length,
              afterLate: after.filter((c) => c.time < c.now).length });
          } finally {
            Moment.prototype.place = place;
            undo();
            await clock.close();
            engine.dispose();
          }
        }
        return out;
      });
      h.expect(results.every((r) => r.before > 0 && r.after > 0 && r.beforeLate === 0 && r.afterLate > 0),
        JSON.stringify(results));
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
};
