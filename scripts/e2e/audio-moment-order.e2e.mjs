export const scenarios = {
  async 'audio-moments-place-what-they-are-given'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const result = await page.evaluate(async () => {
        const { AudioEngine, SECTIONS } = await import('/src/audio/engine.ts');
        const { Voice } = await import('/src/audio/voice.ts');
        const { Moment } = await import('/src/audio/moment.ts');
        const { recordAudioSchedule, tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const cases = [
          ...SECTIONS.map((section) => ({ name: `section:${section}`, at: 0.7,
            setup: (e) => e.music.to('intro', 0.04, { at: 0.1 }),
            run: (e) => e.music.to(section, 0.3, { at: 0.7 }) })),
          { name: 'beds-and-lift', at: 0.7, setup: (e) => {
            e.bed('gate_hum', { at: 0.1 });
            e.bed('aura_bed', { at: 0.1 });
            e.music.to('intro', 0.04, { at: 0.1 });
            e.play('ui_open', { at: 0.2, detune: 500 });
          }, run: (e) => e.music.to('reward', 0.3, { at: 0.7 }) },
          { name: 'timed-hush', at: 0.1, run: (e) => e.hush(0.1, 0.88) },
          { name: 'open-hush', at: 0.1, run: (e) => e.hush(0.1) },
          { name: 'repeated-hush', at: 0.4, setup: (e) => e.hush(0.1), run: (e) => e.hush(0.4, 1.18) },
          { name: 'awaken-hush', at: 0.7, setup: (e) => e.music.to('awaken', 0.04, { at: 0.1 }),
            run: (e) => e.hush(0.7, 1.48) },
          { name: 'cancel-barrier', at: 0.7, barrier: true,
            setup: (e) => e.music.to('intro', 0.04, { at: 0.1 }),
            run: (e) => e.music.to('windows', 0.04, { at: 0.7 }) },
        ];
        const run = async (test, live, expected) => {
          const clock = live ? new AudioContext({ latencyHint: 'interactive' })
            : new OfflineAudioContext(2, 48000, 48000);
          if (live) await clock.suspend();
          const restores = [];
          if (expected) {
            for (const [proto, methods] of [
              [AudioParam.prototype, ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
                'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']],
              [AudioScheduledSourceNode.prototype, ['start', 'stop']],
              [AudioBufferSourceNode.prototype, ['start', 'stop']],
            ]) {
              for (const name of methods) {
                if (!Object.hasOwn(proto, name)) continue;
                const original = proto[name];
                proto[name] = function () { return this; };
                restores.push(() => { proto[name] = original; });
              }
            }
          }
          const tap = recordAudioSchedule(clock);
          const engine = new AudioEngine(clock, { seed: 20261020, stats: true });
          test.setup?.(engine);
          const add = Moment.prototype.add;
          const place = Moment.prototype.place;
          const prepare = Voice.prototype.prepare;
          const voiceAt = Voice.prototype.at;
          const reg = Voice.prototype.reg;
          const moments = new Map();
          const parametersAtPick = new Set();
          const builderAsked = new Map();
          const builderPlaced = new Map();
          const sourceAsked = new Map();
          const sourcePlaced = new Map();
          const sourceAtPick = new Map();
          const barrierAsked = [];
          const barrierPlaced = [];
          let barrierParam;
          let placing = false;
          const undo = tapAudioSchedule((target, method, args) => {
            if (placing && target === barrierParam) barrierPlaced.push([method, args]);
            if (placing && builderAsked.has(target)) {
              if (!builderPlaced.has(target)) builderPlaced.set(target, []);
              builderPlaced.get(target).push([method, args]);
            }
            if (placing && sourcePlaced.has(target)) sourcePlaced.get(target).push([method, args]);
          });
          const record = (moment, first) => {
            let calls = moments.get(moment);
            if (!calls) moments.set(moment, (calls = []));
            calls.push(...tap.calls.slice(first));
          };
          Moment.prototype.add = function (time, call, key, options) {
            const op = add.call(this, time, call, key, options);
            if (expected) {
              const first = tap.calls.length;
              placing = true;
              try { call(test.at); } finally { placing = false; }
              record(this, first);
            }
            return op;
          };
          Moment.prototype.place = function (at) {
            if (expected) return;
            const first = tap.calls.length;
            placing = true;
            try { return place.call(this, at); } finally { placing = false; record(this, first); }
          };
          Voice.prototype.at = function (param) {
            const timed = voiceAt.call(this, param);
            if (!this.isHeld) return timed;
            return Object.fromEntries(Object.entries(timed).map(([method, fn]) => [method, (...args) => {
              if (!builderAsked.has(param)) builderAsked.set(param, []);
              builderAsked.get(param).push([method, args]);
              return fn(...args);
            }]));
          };
          Voice.prototype.reg = function (node, t0, t1, into, offset = 0) {
            const result = reg.call(this, node, t0, t1, into, offset);
            if (this.isHeld) {
              const source = this.holding().at(-1)?.source;
              if (source) {
                sourceAsked.set(source, { node, start: t0, offset });
                sourcePlaced.set(node, []);
              }
            }
            return result;
          };
          Voice.prototype.prepare = function (moment) {
            if (test.barrier && !barrierParam) {
              const gain = this.gain(0, this.dry);
              barrierParam = gain.gain;
              const param = this.at(barrierParam);
              for (const [method, args] of [
                ['setValueAtTime', [0.4, 0.3]], ['setValueAtTime', [0.3, 0.25]],
                ['cancelScheduledValues', [0.1]], ['setValueAtTime', [0.2, 0.05]],
              ]) {
                barrierAsked.push([method, args]);
                param[method](...args);
              }
            }
            for (const entry of this.holding() ?? []) {
              if (entry.key instanceof AudioParam) parametersAtPick.add(entry.key);
              const source = entry.source;
              if (sourceAsked.has(source)) {
                sourceAtPick.set(source, { ...sourceAsked.get(source), stop: source.stop, kill: source.voice.killAt });
              }
            }
            return prepare.call(this, moment);
          };
          try {
            test.run(engine);
            const groups = [...moments.values()].map((calls) => {
              const byTarget = {};
              for (const call of calls) {
                (byTarget[call.target] ??= []).push([call.method, call.values, call.time - test.at]);
              }
              return byTarget;
            });
            const sources = {};
            for (const call of tap.calls) {
              if (/(?:Oscillator|BufferSource|ConstantSource)Node$/.test(call.target)) {
                (sources[call.target] ??= []).push(call.method);
              }
            }
            const badSources = Object.entries(sources).filter(([, calls]) => {
              const start = calls.indexOf('start');
              return calls.some((method, i) => method === 'stop' && (start < 0 || i < start));
            }).map(([key]) => key);
            const badBuilders = [];
            for (const [param, calls] of builderAsked) {
              if (!parametersAtPick.has(param)) continue;
              const actual = builderPlaced.get(param) ?? [];
              let i = 0;
              for (const [method, args] of calls) {
                const wanted = [method, args.map((value, n) =>
                  n === (method === 'cancelScheduledValues' ? 0 : 1) ? value + test.at : value)];
                while (i < actual.length && JSON.stringify(actual[i]) !== JSON.stringify(wanted)) i++;
                if (i++ === actual.length) { badBuilders.push({ wanted, actual }); break; }
              }
            }
            const badSourceBuilders = [];
            for (const [source, request] of sourceAtPick) {
              if (request.start + test.at >= request.kill) continue;
              const calls = sourcePlaced.get(request.node);
              const args = request.node instanceof AudioBufferSourceNode
                ? [request.start + test.at, request.offset] : [request.start + test.at];
              const start = ['start', args];
              const stop = ['stop', [Math.min(request.stop + test.at, request.kill)]];
              if (JSON.stringify(calls[0]) !== JSON.stringify(start)
                || JSON.stringify(calls[1]) !== JSON.stringify(stop)) {
                badSourceBuilders.push({ start, stop, calls });
              }
            }
            return { groups, barrierAsked, barrierPlaced, badSources, badBuilders, badSourceBuilders };
          } finally {
            Moment.prototype.add = add;
            Moment.prototype.place = place;
            Voice.prototype.prepare = prepare;
            Voice.prototype.at = voiceAt;
            Voice.prototype.reg = reg;
            undo();
            tap.stop();
            if (live) await clock.close();
            engine.dispose();
            for (const restore of restores.reverse()) restore();
          }
        };
        const results = [];
        for (const live of [false, true]) for (const test of cases) {
          const asked = await run(test, live, true);
          const placed = await run(test, live, false);
          const differences = [];
          const wrongStops = [];
          let multiStopSources = 0;
          for (let i = 0; i < Math.max(asked.groups.length, placed.groups.length); i++) {
            const a = asked.groups[i] ?? {};
            const b = placed.groups[i] ?? {};
            for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
              if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
                differences.push({ moment: i, key, asked: a[key], placed: b[key] });
              }
              if (/(?:Oscillator|BufferSource|ConstantSource)Node$/.test(key)) {
                const wanted = (a[key] ?? []).filter(([method]) => method === 'stop');
                const actual = (b[key] ?? []).filter(([method]) => method === 'stop');
                if (wanted.length > 1) multiStopSources++;
                if (JSON.stringify(wanted.at(-1)) !== JSON.stringify(actual.at(-1))) wrongStops.push(key);
              }
            }
          }
          const barrier = placed.barrierAsked.map(([method, args]) => [method,
            args.map((value, i) => i === (method === 'cancelScheduledValues' ? 0 : 1) ? value + test.at : value)]);
          const barrierMatches = (!test.barrier || barrier.length === 4)
            && JSON.stringify(barrier) === JSON.stringify(placed.barrierPlaced);
          results.push({ name: test.name, live, moments: asked.groups.length, differences: differences.slice(0, 3),
            badSources: placed.badSources, badBuilders: placed.badBuilders.slice(0, 2),
            badSourceBuilders: placed.badSourceBuilders.slice(0, 2), wrongStops,
            multiStopSources, barrierMatches,
            ...(!barrierMatches && { barrier, barrierPlaced: placed.barrierPlaced }) });
        }
        return results;
      });
      const failed = result.filter((r) => !r.moments || r.differences.length || r.badSources.length
        || r.badBuilders.length || r.badSourceBuilders.length || r.wrongStops.length || !r.barrierMatches
        || (r.name === 'timed-hush' && r.multiStopSources !== 2));
      h.expect(!failed.length, JSON.stringify(failed));
      h.expect(!errors.length, errors.join('\n'));
      return result.map(({ name, live, moments }) => ({ name, live, moments }));
    } finally {
      await ctx.close();
    }
  },
};
