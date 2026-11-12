export const scenarios = {
  async 'late-stand-keeps-first-chord-times'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { Moment } = await import('/src/audio/moment.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const out = [];
        for (const live of [false, true]) for (const offset of [1, 1.65, 7.04, null, 'known']) {
          const clock = live ? new AudioContext({ latencyHint: 'interactive' })
            : new OfflineAudioContext(2, 48000, 48000);
          if (live) await clock.suspend();
          const engine = new AudioEngine(clock, { seed: 20261020, stats: true });
          const at = 10;
          const stand = typeof offset === 'number' ? offset : 7.04;
          const opts = offset === null ? { at: 0.1 } : { at: 0.1, standAt: at + stand,
            ...(offset === 'known' ? { hitAt: at } : {}) };
          engine.music.to('awaken', 0.04, opts);
          const place = Moment.prototype.place;
          let placing = false;
          let passed = false;
          const calls = [];
          Moment.prototype.place = function (...args) {
            placing = true;
            try { return place.apply(this, args); } finally { placing = false; passed = true; }
          };
          const undo = tapAudioSchedule((target, method, args, time) => {
            calls.push({ target, method, value: args[0], time, placing, passed });
          });
          try {
            if (offset === 'known') engine.music.scheduleUntil(at + 0.21, at - 0.01);
            engine.play('awaken_hit', { at });
            const close = (a, b) => Math.abs(a - b) < 1e-8;
            const B = Math.max(1.5, stand / 2);
            const where = (c) => offset === null ? c.placing
              : offset === 'known' ? !c.passed && !c.placing : c.passed && !c.placing;
            const roll = calls.find((c) => c.method === 'setValueAtTime' && close(c.value, 0.0015)
              && close(c.time, at + B * 0.45));
            const rollCalls = calls.filter((c) => c.target === roll?.target && where(c));
            const rollOK = !!roll && where(roll)
              && rollCalls.some((c) => c.method === 'exponentialRampToValueAtTime' && close(c.value, 0.08)
                && close(c.time, at + B - 0.015))
              && rollCalls.some((c) => c.method === 'setTargetAtTime' && close(c.value, 0.0012)
                && close(c.time, at + B));
            const horn = calls.filter((c) => c.method === 'setTargetAtTime' && c.value === 3600
              && close(c.time, at + B * 0.62) && where(c));
            const swellAt = at + stand - 1.6;
            const dipAt = at + stand - 0.95;
            const inWindow = (t) => t >= at && t < at + (60 / 72) / 4;
            const swell = calls.filter((c) => c.method === 'setValueAtTime' && close(c.value, 0.0006)
              && close(c.time, swellAt) && where(c));
            const timp = calls.filter((c) => c.method === 'setValueAtTime' && close(c.value, 0.0048)
              && close(c.time, swellAt) && where(c));
            const swellStarts = calls.filter((c) => c.method === 'start' && close(c.time, swellAt) && where(c));
            const dip = calls.filter((c) => c.method === 'setTargetAtTime' && close(c.value, 10 ** (-4 / 20))
              && close(c.time, dipAt) && where(c));
            const restored = dip.filter((d) => calls.some((c) => c.target === d.target && where(c)
              && c.method === 'setTargetAtTime' && c.value === 1 && close(c.time, at + stand - 0.004)));
            out.push({ live, offset, rollOK, horn: horn.length, swell: swell.length, timp: timp.length,
              swellStarts: swellStarts.length, dip: dip.length, restored: restored.length,
              wantSwell: inWindow(swellAt), wantDip: inWindow(dipAt) });
          } finally {
            Moment.prototype.place = place;
            undo();
            if (live) await clock.close();
            engine.dispose();
          }
        }
        return out;
      });
      h.expect(results.every((r) => r.rollOK && r.horn === 1 && r.swell === Number(r.wantSwell)
        && r.timp === Number(r.wantSwell) && r.swellStarts === 4 * Number(r.wantSwell)
        && r.dip === 2 * Number(r.wantDip) && r.restored === r.dip), JSON.stringify(results));
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
  async 'hit-survives-slow-preparation'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { soon } = await import('/src/audio/param.ts');
        const { Voice } = await import('/src/audio/voice.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const out = [];
        for (const phase of ['release', 'sort', 'registration']) {
          const clock = new AudioContext({ latencyHint: 'interactive' });
          await clock.resume();
          const pauseMs = (soon(clock) - clock.currentTime) * 1000 + 100;
          const engine = new AudioEngine(clock, { stats: true });
          engine.music.to('awaken', 0.04);
          engine.hush();
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
            engine.play('awaken_hit');
            watching = false;
            const late = calls.filter((c) => c.time > 0 && c.time < c.now);
            out.push({ phase, pauses, advance, calls: calls.length,
              afterPause: calls.slice(lastPause).filter((c) => c.method === 'start').length,
              late: late.length, worstMs: Math.max(0, ...late.map((c) => (c.now - c.time) * 1000)) });
          } finally {
            Voice.prototype.release = release;
            Array.prototype.sort = sort;
            Voice.prototype.reg = reg;
            undo();
            await clock.close();
            engine.dispose();
          }
        }
        return out;
      });
      h.expect(results.every((r) => r.pauses && r.advance > 40 && r.afterPause && !r.late), JSON.stringify(results));
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
  async 'hit-places-roar-before-distant-cue-calls'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { Voice } = await import('/src/audio/voice.ts');
        const { Moment } = await import('/src/audio/moment.ts');
        const { soon } = await import('/src/audio/param.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const out = [];
        for (const pause of [false, true]) {
          const clock = new AudioContext({ latencyHint: 'interactive' });
          await clock.resume();
          const pauseMs = (soon(clock) - clock.currentTime) * 1000 + 100;
          const engine = new AudioEngine(clock, { stats: true });
          engine.music.to('awaken', 0.04);
          engine.hush();
          const prepare = Voice.prototype.prepare;
          const place = Moment.prototype.place;
          const voices = [];
          let placing = false;
          let paused = false;
          let at = 0;
          const calls = [];
          Voice.prototype.prepare = function (...args) {
            voices.push(new Set((this.holding() ?? []).map((h) => h.source?.n).filter(Boolean)));
            return prepare.apply(this, args);
          };
          Moment.prototype.place = function (time) {
            at = time;
            placing = true;
            try { return place.call(this, time); } finally { placing = false; }
          };
          const undo = tapAudioSchedule((target, method, _args, time) => {
            if (!placing) return;
            if (pause && !paused && method === 'start') {
              const until = performance.now() + pauseMs;
              while (performance.now() < until);
              paused = true;
            }
            calls.push({ target, method, time, now: clock.currentTime, after: paused });
          });
          try {
            engine.play('awaken_hit');
            const roar = calls.map((c, i) => ({ ...c, i }))
              .filter((c) => voices[1]?.has(c.target) && c.method === 'start' && Math.abs(c.time - at) < 1e-8);
            const distant = calls.map((c, i) => ({ ...c, i }))
              .filter((c) => voices[0]?.has(c.target) && c.method === 'stop' && c.time > at + 0.7);
            const before = calls.filter((c) => !c.after && c.time > 0);
            const after = calls.filter((c) => c.after && c.time > 0);
            out.push({ pause, roar: roar.length, distant: distant.length,
              roarLast: Math.max(-1, ...roar.map((c) => c.i)),
              distantFirst: Math.min(...distant.map((c) => c.i)), before: before.length, after: after.length,
              beforeLate: before.filter((c) => c.time < c.now).length,
              afterLate: after.filter((c) => c.time < c.now).length });
          } finally {
            Voice.prototype.prepare = prepare;
            Moment.prototype.place = place;
            undo();
            await clock.close();
            engine.dispose();
          }
        }
        return out;
      });
      h.expect(results.every((r) => r.roar && r.distant && r.roarLast < r.distantFirst), JSON.stringify(results));
      h.expect(results[1].before && results[1].after && !results[1].beforeLate && results[1].afterLate,
        JSON.stringify(results));
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
};
