import fs from 'node:fs';
import path from 'node:path';

export const scenarios = {
  async 'audio-renders-use-same-seeds-and-schedule'(h) {
    const pages = [];
    try {
      const results = [];
      for (let pageNumber = 0; pageNumber < 2; pageNumber++) {
        const opened = await h.open({}, '?lab=audio&mute');
        pages.push(opened.ctx);
        const result = await opened.page.evaluate(async () => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const { recordAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
          const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            (n) => n.toString(16).padStart(2, '0')).join('');
          const render = async (name) => {
            const rate = 48000;
            const clock = new OfflineAudioContext(2, rate * 4, rate);
            const buffers = [];
            const create = clock.createBuffer.bind(clock);
            clock.createBuffer = (...args) => {
              const buffer = create(...args);
              buffers.push(buffer);
              return buffer;
            };
            const tap = recordAudioSchedule(clock);
            const engine = new AudioEngine(clock, { seed: 20261020 });
            const seeds = [];
            const nextSeed = engine.nextSeed.bind(engine);
            engine.nextSeed = () => {
              const seed = nextSeed();
              seeds.push(seed);
              return seed;
            };
            if (name === 'windows') {
              engine.music.to('windows', 0.3, { at: 0.1 });
              engine.music.scheduleUntil(3.5, 0);
            } else if (name === 'hush') engine.hush(0.1, 0.88);
            else engine.play(name, { at: 0.1 });
            tap.stop();
            const inputs = [];
            for (const buffer of buffers) {
              for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                inputs.push(await digest(buffer.getChannelData(ch).buffer));
              }
            }
            const schedule = await digest(new TextEncoder().encode(JSON.stringify(tap.calls)));
            const sound = await clock.startRendering();
            const samples = new Float32Array(sound.length * sound.numberOfChannels);
            for (let ch = 0; ch < sound.numberOfChannels; ch++) {
              samples.set(sound.getChannelData(ch), ch * sound.length);
            }
            return { seeds, inputs, schedule, calls: tap.calls.length, samples: Array.from(samples) };
          };
          const out = [];
          for (const name of ['ui_close', 'gate_crack', 'check', 'windows', 'hush']) {
            const a = await render(name);
            const b = await render(name);
            let different = 0;
            let largest = 0;
            let sum = 0;
            for (let i = 0; i < a.samples.length; i++) {
              const d = Math.abs(a.samples[i] - b.samples[i]);
              if (d) different++;
              largest = Math.max(largest, d);
              sum += d * d;
            }
            out.push({ name, seeds: a.seeds.length, inputs: a.inputs.length, calls: a.calls,
              sameSeeds: JSON.stringify(a.seeds) === JSON.stringify(b.seeds),
              sameInputs: JSON.stringify(a.inputs) === JSON.stringify(b.inputs),
              sameSchedule: a.schedule === b.schedule, different, largest, rms: Math.sqrt(sum / a.samples.length),
              first: await digest(new Float32Array(a.samples).buffer) });
          }
          return out;
        });
        results.push(result);
        await opened.ctx.close();
        pages.pop();
      }
      h.expect(results.flat().every((r) => r.seeds > 0 && r.inputs > 0 && r.calls > 0
        && r.sameSeeds && r.sameInputs && r.sameSchedule), JSON.stringify(results));
      fs.writeFileSync(path.join(h.out, 'audio-main-determinism.json'), JSON.stringify(results, null, 2));
      return results;
    } finally {
      for (const ctx of pages) await ctx.close();
    }
  },
  async 'audio-moments-offline-renders' (h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const results = await page.evaluate(async () => {
        const { AudioEngine, CUE_NAMES, BED_NAMES, SECTIONS, cueLength, renderOffline } =
          await import('/src/audio/engine.ts');
        const { recordAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const sr = 48000;
        const jobs = [
          ...CUE_NAMES.map((cue) => ({
            name: `cue:${cue}`, events: [{ t: 0.1, cue }], duration: cueLength(cue) + 4.1,
          })),
          ...BED_NAMES.map((cue) => ({
            name: `bed:${cue}`, events: [{ t: 0.1, cue, loop: { name: cue, until: 2 } }], duration: 5,
          })),
          ...SECTIONS.map((section) => ({
            name: `section:${section}`, events: [{ t: 0.1, cue: 'music', opts: { section, fade: 0.3 } }], duration: 4,
          })),
          { name: 'hush', events: [{ t: 0.1, cue: 'hush', opts: { until: 0.88 } }], duration: 4 },
        ];
        const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          (n) => n.toString(16).padStart(2, '0')).join('');
        const hash = async (buf) => {
          const bytes = new Uint8Array(buf.numberOfChannels * buf.length * 4);
          for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            bytes.set(new Uint8Array(buf.getChannelData(ch).buffer), ch * buf.length * 4);
          }
          return digest(bytes);
        };
        const out = [];
        const schedules = [];
        for (const job of jobs) {
          const clock = new OfflineAudioContext(2, Math.ceil(job.duration * sr), sr);
          const tap = recordAudioSchedule(clock);
          const engine = new AudioEngine(clock, { seed: 20261020 });
          engine.schedule(job.events, 0);
          engine.music.scheduleUntil(Math.min(job.duration, 5));
          tap.stop();
          const groups = {};
          for (const call of tap.calls) (groups[call.target] ??= []).push([call.method, call.values]);
          const ordered = Object.keys(groups).sort().map((key) => [key, groups[key]]);
          schedules.push([job.name, await digest(new TextEncoder().encode(JSON.stringify(ordered)))]);
          const buf = await renderOffline(job.events, job.duration, sr);
          let peak = 0;
          for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            for (const sample of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(sample));
          }
          out.push({ name: job.name, samples: buf.length, hash: await hash(buf), peak });
        }
        return { out, scheduleHash: await digest(new TextEncoder().encode(JSON.stringify(schedules))) };
      });
      fs.writeFileSync(path.join(h.out, 'audio-moments-offline.json'), JSON.stringify(results, null, 2));
      h.expect(results.out.length === 39, `rendered ${results.out.length} cases`);
      h.expect(results.out.every((r) => r.samples > 0 && r.hash.length === 64
        && (r.name === 'cue:awaken_voice' ? r.peak === 0 : r.peak > 0)), 'missing rendered samples');
      h.expect(results.scheduleHash === '5f61cbd7123b5235344edeff7b1e060149efe3190ac4b57a114f94013c269a3c',
        `the offline schedule changed: ${results.scheduleHash}`);
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
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
  async 'audio-moments-placement-time'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const cdp = await ctx.newCDPSession(page);
      const results = [];
      for (const rate of [1, 20]) {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        results.push(...await page.evaluate(async (rate) => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const { Moment } = await import('/src/audio/moment.ts');
          const { BusLevels } = await import('/src/audio/bus-levels.ts');
          const out = [];
          for (const kind of ['section', 'hush']) {
            for (let trial = 0; trial < 3; trial++) {
              const clock = new AudioContext({ latencyHint: 'interactive' });
              await clock.resume();
              const engine = new AudioEngine(clock, { stats: true });
              if (kind === 'section') engine.music.to('intro', 0.04);
              const timeDescriptor = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'currentTime');
              const place = Moment.prototype.place;
              const busSet = BusLevels.prototype.set;
              const restore = [];
              const calls = [];
              let watching = false;
              let busDepth = 0;
              let busWall = 0;
              let busNative = 0;
              let lastClockRead = 0;
              let choice = 0;
              let at = 0;
              Object.defineProperty(BaseAudioContext.prototype, 'currentTime', {
                ...timeDescriptor,
                get() {
                  const value = timeDescriptor.get.call(this);
                  if (this === clock) lastClockRead = performance.now();
                  return value;
                },
              });
              Moment.prototype.place = function (time) {
                at = time;
                choice = lastClockRead;
                watching = true;
                try { return place.call(this, time); }
                finally { watching = false; }
              };
              BusLevels.prototype.set = function (...args) {
                if (!watching) return busSet.apply(this, args);
                const start = performance.now();
                busDepth++;
                try { return busSet.apply(this, args); }
                finally { busDepth--; busWall += performance.now() - start; }
              };
              for (const [proto, methods] of [
                [AudioParam.prototype, [['setValueAtTime', 1], ['linearRampToValueAtTime', 1],
                  ['exponentialRampToValueAtTime', 1], ['setTargetAtTime', 1], ['cancelScheduledValues', 0]]],
                [AudioScheduledSourceNode.prototype, [['start', 0], ['stop', 0]]],
                [AudioBufferSourceNode.prototype, [['start', 0], ['stop', 0]]],
              ]) {
                for (const [method, arg] of methods) {
                  if (!Object.hasOwn(proto, method)) continue;
                  const original = proto[method];
                  proto[method] = function (...args) {
                    if (!watching) return original.apply(this, args);
                    const start = performance.now();
                    try { return original.apply(this, args); }
                    finally {
                      const end = performance.now();
                      if (busDepth) busNative += end - start;
                      calls.push({ time: args[arg] ?? 0, start, end });
                    }
                  };
                  restore.push(() => { proto[method] = original; });
                }
              }
              try {
                if (kind === 'section') engine.music.to('windows', 0.04);
                else engine.hush(undefined, clock.currentTime + 0.78);
                const urgent = calls.filter((call) => call.time <= at + 2 / 60);
                const gaps = [];
                for (let i = 1; i < calls.length; i++) {
                  if (calls[i - 1].time <= at + 2 / 60 && calls[i].time <= at + 2 / 60) {
                    gaps.push(calls[i].start - calls[i - 1].end);
                  }
                }
                out.push({ kind, rate, trial, calls: calls.length, urgent: urgent.length,
                  pickToFirstMs: calls[0].start - choice, busWallMs: busWall, busNativeMs: busNative,
                  busJsMs: Math.max(0, busWall - busNative), urgentGapMs: gaps.reduce((a, b) => a + b, 0),
                  maxUrgentGapMs: Math.max(0, ...gaps) });
              } finally {
                Object.defineProperty(BaseAudioContext.prototype, 'currentTime', timeDescriptor);
                Moment.prototype.place = place;
                BusLevels.prototype.set = busSet;
                for (const reset of restore.reverse()) reset();
                await clock.close();
                engine.dispose();
              }
            }
          }
          return out;
        }, rate));
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      fs.writeFileSync(path.join(h.out, 'audio-placement-time.json'), JSON.stringify(results, null, 2));
      h.expect(results.length === 12 && results.every((r) => r.calls > 0 && r.urgent > 0), JSON.stringify(results));
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
};
