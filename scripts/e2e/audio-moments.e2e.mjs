export const scenarios = {
  async 'audio-moments-survive-slow-preparation'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { Voice } = await import('/src/audio/voice.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const out = [];
        for (const kind of ['section', 'hush']) {
          for (const phase of ['release', 'sort', 'bookkeeping']) {
            const clock = new AudioContext({ latencyHint: 'interactive' });
            await clock.resume();
            const engine = new AudioEngine(clock, { stats: true });
            if (kind === 'section') engine.music.to('intro', 0.04);
            let watching = false;
            let pauses = 0;
            let advance = 0;
            const calls = [];
            const pause = () => {
              if (!watching || (pauses && phase !== 'sort')) return;
              pauses++;
              const before = clock.currentTime;
              const until = performance.now() + 65;
              while (performance.now() < until);
              advance = (clock.currentTime - before) * 1000;
            };
            const undo = tapAudioSchedule((_, method, args, time) => {
              if (watching) calls.push({ method, time, now: clock.currentTime });
            });
            const release = Voice.prototype.release;
            const sort = Array.prototype.sort;
            const track = engine.lib.track;
            const musicTrack = engine.libMusic.track;
            Voice.prototype.release = function (...args) {
              if (phase === 'release') pause();
              return release.apply(this, args);
            };
            Array.prototype.sort = function (...args) {
              if (phase === 'sort' && this.length && this[0]?.place
                && ('cancelsBefore' in this[0] || 'absolute' in this[0])) pause();
              return sort.apply(this, args);
            };
            engine.lib.track = (...args) => {
              if (phase === 'bookkeeping') pause();
              return track(...args);
            };
            engine.libMusic.track = (...args) => {
              if (phase === 'bookkeeping') pause();
              return musicTrack(...args);
            };
            try {
              watching = true;
              if (kind === 'section') engine.music.to('windows', 0.04);
              else engine.hush(undefined, clock.currentTime + 0.78);
              watching = false;
              const late = calls.filter((c) => c.time > 0 && c.time < c.now);
              out.push({ kind, phase, pauses, advance, latency: clock.baseLatency, calls: calls.length,
                late: late.length,
                worstMs: Math.max(0, ...late.map((c) => (c.now - c.time) * 1000)) });
            } finally {
              watching = false;
              Voice.prototype.release = release;
              Array.prototype.sort = sort;
              engine.lib.track = track;
              engine.libMusic.track = musicTrack;
              undo();
              await clock.close();
              engine.dispose();
            }
          }
        }
        return out;
      });
      h.expect(results.every((r) => r.pauses > 0 && r.advance > 40 && r.calls > 0 && r.late === 0),
        JSON.stringify(results));
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
  async 'audio-moments-keep-their-order'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { tapAudioSchedule, recordAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const run = async (kind, pause, pauseFade = false) => {
          const clock = new AudioContext({ latencyHint: 'interactive' });
          await clock.resume();
          const schedule = recordAudioSchedule(clock);
          const engine = new AudioEngine(clock, { stats: true });
          if (kind.startsWith('section')) engine.music.to('intro', 0.04);
          let bed;
          if (kind === 'section-with-bed') {
            bed = engine.bed('gate_hum');
            engine.play('ui_open', { detune: 500 });
          }
          const firstCall = schedule.calls.length;
          const old = engine.music.live.at(-1)?.voice;
          const buses = [engine.hushBeds.gain, engine.hushMusic.gain, engine.hushHall.gain, engine.hushRoom.gain];
          const calls = [];
          let watching = true;
          let starts = 0;
          let busCancels = 0;
          let paused = false;
          const undo = tapAudioSchedule((target, method, _args, time) => {
            if (!watching) return;
            const atFade = pauseFade && target === old?.out.gain && method === 'cancelScheduledValues';
            const atBus = pause === 'bus' && buses.includes(target) && method === 'cancelScheduledValues'
              && ++busCancels === 2;
            if ((method === 'start' && ++starts === 2 && pause === true) || atFade || atBus) {
              const until = performance.now() + 65;
              while (performance.now() < until);
              paused = true;
            }
            calls.push({ target, method, time, now: clock.currentTime, afterPause: paused });
          });
          const to = clock.currentTime + 0.78;
          if (kind.startsWith('section')) engine.music.to(kind === 'section' ? 'windows' : 'reward', 0.04);
          else engine.hush(undefined, to);
          watching = false;
          const opening = calls.filter((c) => c.method === 'start');
          const at = Math.min(...opening.map((c) => c.time));
          const fade = calls.find((c) => c.target === old?.out.gain && c.method === 'cancelScheduledValues');
          const bedFade = calls.find((c) => c.target === bed?.voice.out.gain && c.method === 'cancelScheduledValues');
          const lift = calls.find((c) => c.target === engine.shelf.gain && c.method === 'cancelScheduledValues');
          const restores = calls.map((c, i) => ({ ...c, i })).filter((c) => buses.includes(c.target) && c.time === to);
          const urgent = calls.map((c, i) => ({ ...c, i })).filter((c) => c.time <= at + 0.03);
          const distant = calls.map((c, i) => ({ ...c, i })).filter((c) => c.method === 'stop' && c.time > at + 0.7);
          const before = calls.filter((c) => !c.afterPause && c.time > 0);
          const after = calls.filter((c) => c.afterPause && c.time > 0);
          const recorded = schedule.calls.slice(firstCall);
          const result = { kind, pause, at, fade: fade?.time, starts: opening.length,
            bedFade: bedFade?.time, lift: lift?.time,
            stops: calls.filter((c) => c.method === 'stop').length,
            events: recorded.map((c) => `${c.target}:${c.method}`).sort(),
            opening: recorded.filter((c) => c.method === 'start')
              .map((c) => `${c.target}:${(c.time - at).toFixed(8)}`).sort(),
            restores: restores.length, restoreFirst: Math.min(...restores.map((c) => c.i)),
            distantFirst: Math.min(...distant.map((c) => c.i)),
            urgentLast: Math.max(...urgent.map((c) => c.i)),
            before: before.length, beforeLate: before.filter((c) => c.time < c.now).length,
            afterLate: after.filter((c) => c.time < c.now).length };
          undo();
          schedule.stop();
          await clock.close();
          engine.dispose();
          return result;
        };
        const out = [];
        for (const kind of ['section', 'hush']) {
          out.push(await run(kind, false));
          out.push(await run(kind, true));
        }
        out.push(await run('section', false, true));
        out.push(await run('section-with-bed', false));
        out.push(await run('hush', 'bus'));
        return out;
      });
      const [section, stalledSection, hush, stalledHush, delayedFade, sectionWithBed, stalledBus] = results;
      const describe = (item) => {
        const { events, opening, ...summary } = item;
        return summary;
      };
      const problems = [];
      if (!(section.starts > 0 && section.fade === section.at)) {
        problems.push(`section: ${JSON.stringify(describe(section))}`);
      }
      if (delayedFade.fade !== delayedFade.at) problems.push(`delayed fade: ${JSON.stringify(describe(delayedFade))}`);
      if (sectionWithBed.fade !== sectionWithBed.at || sectionWithBed.bedFade !== sectionWithBed.at
        || sectionWithBed.lift !== sectionWithBed.at) {
        problems.push(`section levels: ${JSON.stringify(describe(sectionWithBed))}`);
      }
      if (!(hush.starts > 0 && hush.restores >= 4 && hush.restoreFirst > hush.urgentLast)) {
        problems.push(`hush restores: ${JSON.stringify(describe(hush))}`);
      }
      for (const item of [section, hush]) {
        if (!(item.distantFirst > item.urgentLast)) problems.push(`distant stops: ${JSON.stringify(describe(item))}`);
      }
      for (const [plain, stalled] of [[section, stalledSection], [hush, stalledHush], [hush, stalledBus]]) {
        if (!(stalled.before > 0 && stalled.beforeLate === 0 && stalled.afterLate > 0)) {
          problems.push(`pause inside ${stalled.kind}: ${JSON.stringify(describe(stalled))}`);
        }
        if (JSON.stringify(stalled.opening) !== JSON.stringify(plain.opening)
          || JSON.stringify(stalled.events) !== JSON.stringify(plain.events)) {
          problems.push(`${stalled.kind} changed its scheduled calls`);
        }
      }
      h.expect(!problems.length, problems.join('; '));
      h.expect(!errors.length, errors.join('\n'));
      return results.map(describe);
    } finally {
      await ctx.close();
    }
  },

};
