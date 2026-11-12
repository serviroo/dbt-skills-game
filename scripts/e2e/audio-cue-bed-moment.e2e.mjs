export const scenarios = {
  async 'cues-beds-and-charge-survive-slow-preparation'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const result = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { soon } = await import('/src/audio/param.ts');
        const { Voice } = await import('/src/audio/voice.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const out = [];
        const kinds = [
          'ui_open', 'lift', 'close', 'breath_in', 'soldier_ignite', 'stand_swell', 'bed', 'charge',
        ];
        for (const kind of kinds) {
          for (const phase of ['release', 'sort', 'registration']) {
            const clock = new AudioContext({ latencyHint: 'interactive' });
            await clock.resume();
            const pauseMs = (soon(clock) - clock.currentTime) * 1000 + 100;
            const engine = new AudioEngine(clock, { stats: true });
            if (kind === 'close') engine.play('ui_open', { detune: 500 });
            let watching = false;
            let pauses = 0;
            let advance = 0;
            let lastPause = -1;
            const calls = [];
            const pause = () => {
              if (!watching || (pauses && phase !== 'sort')) return;
              pauses++;
              const before = clock.currentTime;
              const until = performance.now() + pauseMs;
              while (performance.now() < until);
              advance = (clock.currentTime - before) * 1000;
              lastPause = calls.length;
            };
            const undo = tapAudioSchedule((_, method, _args, time) => {
              if (watching) calls.push({ method, time, now: clock.currentTime });
            });
            const release = Voice.prototype.release;
            const sort = Array.prototype.sort;
            const reg = Voice.prototype.reg;
            Voice.prototype.release = function (...args) {
              if (phase === 'release') pause();
              return release.apply(this, args);
            };
            Array.prototype.sort = function (...args) {
              if (phase === 'sort' && this.length && this[0]?.place
                && ('cancelsBefore' in this[0] || 'absolute' in this[0])) pause();
              return sort.apply(this, args);
            };
            Voice.prototype.reg = function (...args) {
              if (phase === 'registration') pause();
              return reg.apply(this, args);
            };
            try {
              watching = true;
              if (kind === 'bed') engine.bed('gate_hum');
              else if (kind === 'charge') engine.chargeLoop();
              else if (kind === 'lift') engine.play('ui_open', { detune: 500 });
              else if (kind === 'close') engine.play('ui_close');
              else engine.play(kind);
              watching = false;
              const late = calls.filter((c) => c.time > 0 && c.time < c.now);
              out.push({ kind, phase, pauses, advance, calls: calls.length, late: late.length,
                afterPause: calls.slice(lastPause).filter((c) => c.method === 'start').length,
                worstMs: Math.max(0, ...late.map((c) => (c.now - c.time) * 1000)) });
            } finally {
              watching = false;
              Voice.prototype.release = release;
              Array.prototype.sort = sort;
              Voice.prototype.reg = reg;
              undo();
              await clock.close();
              engine.dispose();
            }
          }
        }
        return out;
      });
      h.expect(result.every((r) => r.pauses > 0 && r.advance > 40 && r.afterPause > 0 && r.late === 0),
        JSON.stringify(result));
      h.expect(!errors.length, errors.join('\n'));
      return result;
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
