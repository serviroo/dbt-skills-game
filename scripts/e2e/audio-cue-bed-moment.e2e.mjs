import { installAudioRecorder } from './audio-recorder.mjs';

export const scenarios = {
  async 'cue-and-charge-bus-moves-use-picked-start'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { Voice } = await import('/src/audio/voice.ts');
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
            const opens = [];
            let afterPause;
            const open = Voice.prototype.open;
            const undo = tapAudioSchedule((node, method, _args, time) => {
              if (stalled && afterPause === undefined && method === 'start') {
                const until = clock.currentTime + (soon(clock) - clock.currentTime) + 0.1;
                while (clock.currentTime < until);
                afterPause = clock.currentTime;
              }
              if (node === target && method === 'setTargetAtTime') times.push(time);
            });
            Voice.prototype.open = function (at, ...args) {
              opens.push({ voice: this, at });
              return open.call(this, at, ...args);
            };
            try {
              if (kind === 'charge') engine.chargeLoop();
              else if (kind === 'lift') engine.play('ui_open', { detune: 500 });
              else if (kind === 'close') engine.play('ui_close');
              else engine.play(kind, kind === 'breath_out' ? { dur: 12 } : {});
              const picked = opens.find(({ voice }) => !voice.isStopped)?.at;
              out.push({ kind, stalled, picked, afterPause, offsets, times,
                correct: Number.isFinite(picked) && (!stalled || (Number.isFinite(afterPause) && picked > afterPause))
                  && times.length === offsets.length
                  && offsets.every((offset, i) => Math.abs(times[i] - picked - offset) < 1e-7) });
            } finally {
              Voice.prototype.open = open;
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
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute', undefined, installAudioRecorder);
    try {
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { Moment } = await import('/src/audio/moment.ts');
        const { Voice } = await import('/src/audio/voice.ts');
        const { soon } = await import('/src/audio/param.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const out = [];
        for (const kind of ['cue', 'bed', 'charge']) {
          const clock = new AudioContext({ latencyHint: 'interactive' });
          await clock.resume();
          const engine = new AudioEngine(clock, { seed: 20261020, stats: true });
          const tap = window.__taps.find((t) => t.context === clock);
          while (tap.start === undefined && !tap.error) await new Promise((done) => setTimeout(done, 10));
          if (tap.error) throw new Error(tap.error);
          const pauseMs = (soon(clock) - clock.currentTime) * 1000 + 120;
          const place = Moment.prototype.place;
          const open = Voice.prototype.open;
          let attempt;
          let pausedAt;
          const attempts = [];
          const opens = [];
          const gates = [];
          const started = new WeakSet();
          let unstartedStops = 0;
          const undo = tapAudioSchedule((node, method, args, time) => {
            if (method === 'start') started.add(node);
            if (method === 'stop' && !started.has(node)) unstartedStops++;
            if (attempt && pausedAt === undefined && method === 'start') {
              const until = clock.currentTime + pauseMs / 1000;
              while (clock.currentTime < until);
              pausedAt = clock.currentTime;
            }
            if (attempt) attempt.calls.push({ method, time, now: clock.currentTime });
            if (method === 'setValueAtTime') gates.push({ node, value: args[0], time });
          });
          Moment.prototype.place = function (at, ...args) {
            const previous = attempt;
            attempt = { at, calls: [] };
            attempts.push(attempt);
            try { return place.call(this, at, ...args); } finally { attempt = previous; }
          };
          Voice.prototype.open = function (at, ...args) {
            opens.push({ voice: this, at });
            return open.call(this, at, ...args);
          };
          try {
            const from = clock.currentTime;
            if (kind === 'cue') engine.play('ui_open');
            else if (kind === 'bed') engine.bed('gate_hum');
            else engine.chargeLoop();
            const heard = opens.filter(({ voice }) => !voice.isStopped);
            const discarded = opens.filter(({ voice }) => voice.isStopped);
            const first = heard[0];
            const firstPlace = attempts[0];
            const accepted = first && attempts.find((a) => a.at === first.at
              && a.calls.some((c) => c.method === 'start'));
            const through = (first?.at ?? clock.currentTime) + 0.5;
            while ((tap.end ?? -1) * 128 / clock.sampleRate < through && !tap.error) {
              await new Promise((done) => setTimeout(done, 10));
            }
            if (tap.error) throw new Error(tap.error);
            const rms = (a, b) => {
              const blocks = [...tap.q].filter(([i]) => i * 128 / clock.sampleRate >= a
                && (i + 1) * 128 / clock.sampleRate <= b);
              return Math.sqrt(blocks.reduce((sum, [, v]) => sum + v[1], 0) / Math.max(1, blocks.length * 128));
            };
            out.push({ kind, pausedAt, attempts: attempts.length, heard: heard.length, discarded: discarded.length,
              firstLate: firstPlace.calls.filter((c) => c.time > 0 && c.time < c.now).length,
              stoppedPlacing: firstPlace.calls.at(-1)?.method === 'start', unstartedStops,
              acceptedLate: accepted?.calls.filter((c) => c.time > 0 && c.time < c.now).length,
              starts: accepted?.calls.filter((c) => c.method === 'start').length,
              opensAfterPause: first?.at > pausedAt,
              discardedClosed: discarded.every(({ voice }) => [voice.wet.gain, voice.dry.gain]
                .every((p) => !gates.some((g) => g.node === p && g.value > 0))),
              silence: rms(from, (first?.at ?? pausedAt) - 0.01),
              sound: rms((first?.at ?? pausedAt) + 0.08, through),
            });
          } finally {
            Moment.prototype.place = place;
            Voice.prototype.open = open;
            undo();
            await clock.close();
            engine.dispose();
          }
        }
        return out;
      });
      h.expect(results.every((r) => r.firstLate > 0 && r.heard === 1 && r.discarded > 0
        && r.starts > 0 && r.acceptedLate === 0 && r.stoppedPlacing && r.unstartedStops === 0
        && r.opensAfterPause && r.discardedClosed && r.silence < 1e-6 && r.sound > 1e-5), JSON.stringify(results));
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
};
