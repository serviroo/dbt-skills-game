export const scenarios = {
  async 'cue-queued-before-unlock-starts-during-a-stall'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(h.server.url + '/scripts/e2e/audio-start-probe.html');
      await page.keyboard.press('Shift');
      const result = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const clock = new AudioContext();
        const engine = new AudioEngine(clock);
        try {
          await engine.timeline.ready;
          await clock.audioWorklet.addModule('/scripts/e2e/audio-wave-recorder.mjs');
          const recorder = new AudioWorkletNode(clock, 'e2e-wave', {
            channelCount: 2,
            channelCountMode: 'explicit',
            processorOptions: { from: 0, length: Math.ceil(clock.sampleRate * 1.2) },
          });
          engine.testInput('sfx').connect(recorder);
          recorder.connect(clock.destination);
          const recorded = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('The cue was not recorded')), 15000);
            recorder.port.onmessage = ({ data }) => {
              clearTimeout(timer);
              resolve(data);
            };
          });
          const before = clock.currentTime;
          const behind = [];
          let watch = true;
          const untap = tapAudioSchedule((_, method, args, time) => {
            if (watch && time > 0 && time < clock.currentTime)
              behind.push({ method, time, clock: clock.currentTime });
          });
          const cue = engine.play('check');
          const unlock = engine.unlock();
          const until = performance.now() + 500;
          while (performance.now() < until);
          const after = clock.currentTime;
          const [ack] = await Promise.all([cue.started, unlock]);
          watch = false;
          untap();
          const live = await recorded;
          const sr = clock.sampleRate;
          const into = (ack.start * sr) % 128;
          const frame = Math.ceil((0.25 * sr) / 128) * 128 + into;
          const offline = new OfflineAudioContext(2, Math.ceil(frame + 1.2 * sr), sr);
          const reference = new AudioEngine(offline);
          reference.volume.disconnect();
          reference.testInput('sfx').connect(offline.destination);
          reference.play('check', { at: frame / sr });
          const rendered = await offline.startRendering();
          const first = Math.ceil(ack.start * sr);
          const refFirst = Math.ceil(frame);
          let got = 0;
          let expected = 0;
          let error = 0;
          let firstGot = 0;
          let firstExpected = 0;
          for (let channel = 0; channel < 2; channel++) {
            const ref = rendered.getChannelData(channel);
            const data = channel ? live.right : live.left;
            for (let i = 0; i < Math.floor(0.25 * sr); i++) {
              const a = ref[refFirst + i];
              const b = data[first + i];
              expected += a * a;
              got += b * b;
              error += (a - b) ** 2;
              if (i < 256) {
                firstExpected += a * a;
                firstGot += b * b;
              }
            }
          }
          recorder.disconnect();
          return {
            before,
            after,
            ...ack,
            behind,
            lead: Math.max(2 / 60, (clock.baseLatency || 0) + 1 / 60),
            first: firstGot / firstExpected,
            energy: got / expected,
            difference: Math.sqrt(error / expected),
          };
        } finally {
          await clock.close();
        }
      });
      h.expect(
        result.start >= result.before &&
          result.start >= result.receivedAt &&
          result.start <= result.before + result.lead &&
          !result.behind.length,
        `The queued cue missed the first audio frames: ${JSON.stringify(result)}`,
      );
      h.expect(
        result.first >= 0.5 && result.energy >= 0.7 && result.energy <= 1.4 && result.difference < 0.01,
        `The queued cue did not play its whole onset: ${JSON.stringify(result)}`,
      );
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally {
      await ctx.close();
    }
  },
  async 'a-first-ramp-follows-the-audio-clock'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const result = await page.evaluate(async () => {
        const { TimelineHost } = await import('/src/audio/timeline.ts');
        const clock = new AudioContext();
        await clock.resume();
        const host = new TimelineHost(clock);
        await host.ready;
        await clock.audioWorklet.addModule('/scripts/e2e/audio-wave-recorder.mjs');
        try {
          await clock.resume();
          const results = [];
          for (const kind of ['linear', 'exponential']) {
            const node = await host.create([1]);
            const from = Math.floor((clock.currentTime * clock.sampleRate) / 128) * 128;
            const recorder = new AudioWorkletNode(clock, 'e2e-wave', {
              processorOptions: { from, length: Math.ceil(clock.sampleRate) },
            });
            node.node.connect(recorder);
            recorder.connect(clock.destination);
            try {
              const recorded = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('The automation was not recorded')), 10000);
                recorder.port.onmessage = ({ data }) => {
                  clearTimeout(timer);
                  resolve(data.left);
                };
              });
              const ack = await node.moment(clock.currentTime + 0.05, [
                { kind: 'adopt', channel: 0, value: 0.2 },
                { kind, channel: 0, time: 0.3, value: 0.8 },
              ]);
              const data = await recorded;
              const frame = Math.ceil((ack.receivedAt + 0.15) * clock.sampleRate);
              const got = data[frame - from];
              const fraction =
                (frame / clock.sampleRate - ack.receivedAt) / (ack.start + 0.3 - ack.receivedAt);
              const expected = kind === 'linear' ? 0.6 * fraction : 0.2 * (4 ** fraction - 1);
              results.push({ kind, got, expected, difference: Math.abs(got - expected) });
            } finally {
              node.dispose();
              recorder.disconnect();
            }
          }
          return results;
        } finally {
          await clock.close();
        }
      });
      h.expect(
        result.every((r) => r.difference < 0.002),
        `The first ramp did not begin at the current audio time: ${JSON.stringify(result)}`,
      );
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally {
      await ctx.close();
    }
  },
  async 'fresh-cue-timelines-receive-every-opening'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const result = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const clock = new AudioContext();
        await clock.resume();
        const engine = new AudioEngine(clock);
        await engine.unlock();
        const pending = [];
        try {
          for (let i = 0; i < 60; i++) {
            const requestedAfter = clock.currentTime;
            const handle = engine.play(i % 2 ? 'soft_chime' : 'check');
            pending.push(handle.started.then((ack) => ({ ...ack, requestedAfter })));
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          let timer;
          const acks = await Promise.race([
            Promise.all(pending),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('A fresh cue did not reach the audio thread')),
                15000,
              );
            }),
          ]).finally(() => clearTimeout(timer));
          return {
            count: acks.length,
            early: acks.filter((ack) => ack.start < ack.requestedAfter || ack.start < ack.receivedAt).length,
          };
        } finally {
          await clock.close();
        }
      });
      h.expect(
        result.count === 60 && result.early === 0,
        `A cue opening was lost or started early: ${JSON.stringify(result)}`,
      );
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally {
      await ctx.close();
    }
  },
  async 'cue-moments-never-collide-or-leak'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const result = await page.evaluate(async () => {
        const { TimelineHost } = await import('/src/audio/timeline.ts');
        const clock = new AudioContext();
        const Native = window.AudioWorkletNode;
        const sources = new Set();
        const timelines = new Set();
        const mailboxes = new Set();
        const delays = new Set();
        const make = clock.createBufferSource.bind(clock);
        const makeDelay = clock.createDelay.bind(clock);
        clock.createDelay = (...args) => {
          const delay = makeDelay(...args);
          delays.add(delay);
          const disconnect = delay.disconnect.bind(delay);
          delay.disconnect = (...values) => {
            if (!values.length) delays.delete(delay);
            return disconnect(...values);
          };
          return delay;
        };
        clock.createBufferSource = () => {
          const source = make();
          sources.add(source);
          const disconnect = source.disconnect.bind(source);
          source.disconnect = (...args) => {
            sources.delete(source);
            return disconnect(...args);
          };
          return source;
        };
        window.AudioWorkletNode = class extends Native {
          constructor(context, name, options) {
            super(context, name, options);
            if (name === 'cue-timeline') {
              timelines.add(this);
              const disconnect = this.disconnect.bind(this);
              this.disconnect = (...args) => {
                timelines.delete(this);
                return disconnect(...args);
              };
            }
            if (name === 'cue-mailbox') {
              mailboxes.add(this);
              const disconnect = this.disconnect.bind(this);
              this.disconnect = (...args) => {
                mailboxes.delete(this);
                return disconnect(...args);
              };
            }
          }
        };
        const wait = async (check, name) => {
          const until = performance.now() + 30000;
          while (!check()) {
            if (performance.now() > until)
              throw new Error(`${name} did not finish: ${sources.size} sources, ${timelines.size} timelines`);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };
        try {
          await clock.resume();
          const host = new TimelineHost(clock);
          const node = await host.create([1]);
          await clock.resume();
          const silence = clock.createGain();
          silence.gain.value = 0;
          node.node.connect(silence).connect(clock.destination);
          await node.moment(clock.currentTime, [{ kind: 'adopt', channel: 0, value: 0 }]);
          const settle = () => wait(() => !sources.size && !mailboxes.size, 'Packet cleanup');
          await settle();
          let sequence = 0;
          let accepted = 0;
          let rejected = 0;
          let worstLate = 0;
          let peakLive = 0;
          const all = (promises, name) => {
            let timer;
            return Promise.race([
              Promise.all(promises),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        `${name} timed out: ${accepted} accepted, ${rejected} rejected, ` +
                          `${sources.size} sources, clock ${clock.currentTime}`,
                      ),
                    ),
                  30000,
                );
              }),
            ]).finally(() => clearTimeout(timer));
          };
          const send = () => {
            const value = ++sequence / 1000;
            const requested = clock.currentTime + 0.05;
            const pending = node.moment(requested, [{ kind: 'set', channel: 0, time: 0, value }]);
            peakLive = Math.max(peakLive, sources.size);
            return pending.then(
              (ack) => {
                accepted++;
                worstLate = Math.max(worstLate, ack.start - Math.max(requested, ack.receivedAt));
                if (ack.start < requested || ack.start < ack.receivedAt)
                  throw new Error('A moment started before it arrived');
                return ack;
              },
              (error) => {
                rejected++;
                throw error;
              },
            );
          };
          await all(Array.from({ length: 50 }, send), 'First burst');
          await settle();
          for (let i = 0; i < 50; i++) {
            const pending = send();
            const until = performance.now() + (i % 2 ? 500 : 65);
            while (performance.now() < until);
            await all([pending], `Stalled packet ${i}`);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          await settle();
          const burst = Array.from({ length: 128 }, send);
          const burstLive = mailboxes.size;
          await all(burst, 'Large burst');
          await settle();
          const liveAfter = [];
          for (let batch = 0; batch < 10; batch++) {
            await all(Array.from({ length: 50 }, send), 'Cleanup batch');
            await settle();
            liveAfter.push({
              sources: sources.size,
              timelines: timelines.size,
              mailboxes: mailboxes.size,
              delays: delays.size,
            });
          }
          node.dispose();
          return {
            accepted,
            rejected,
            peakLive,
            burstLive,
            worstLate,
            liveAfter,
            afterDispose: { timelines: timelines.size, mailboxes: mailboxes.size, delays: delays.size },
          };
        } finally {
          window.AudioWorkletNode = Native;
          await clock.close();
        }
      });
      h.expect(
        result.accepted === 728 && result.rejected === 0,
        `Moments were lost: ${JSON.stringify(result)}`,
      );
      const clean = result.liveAfter.every(
        (v) => !v.sources && v.timelines === 1 && !v.mailboxes && !v.delays,
      );
      h.expect(
        result.peakLive >= 128 &&
          result.burstLive >= 128 &&
          result.worstLate < 1e-6 &&
          !result.afterDispose.timelines &&
          !result.afterDispose.mailboxes &&
          !result.afterDispose.delays &&
          clean,
        `Packets collided or grew: ${JSON.stringify(result)}`,
      );
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally {
      await ctx.close();
    }
  },
};
