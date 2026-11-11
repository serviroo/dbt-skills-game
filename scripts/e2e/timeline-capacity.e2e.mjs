export const scenarios = {
  async 'timeline-automation-matches-native'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const result = await page.evaluate(async () => {
        const { TimelineHost } = await import('/src/audio/timeline.ts');
        const clock = new AudioContext();
        const host = new TimelineHost(clock);
        await host.ready;
        await clock.audioWorklet.addModule('/scripts/e2e/audio-wave-recorder.mjs');
        await clock.resume();
        const timeline = await host.create([1]);
        const from = Math.floor(clock.currentTime * clock.sampleRate / 128) * 128;
        const recorder = new AudioWorkletNode(clock, 'e2e-wave', {
          processorOptions: { from, length: Math.ceil(clock.sampleRate) },
        });
        timeline.node.connect(recorder).connect(clock.destination);
        try {
          const recording = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Automation was not recorded')), 15000);
            recorder.port.onmessage = ({ data }) => { clearTimeout(timer); resolve(data.left); };
          });
          const ack = await timeline.moment(clock.currentTime + 0.1, [
            { kind: 'adopt', channel: 0, value: 0.2 },
            { kind: 'set', channel: 0, time: 0, value: 0.2 },
            { kind: 'target', channel: 0, time: 0.05, value: 0.8, tau: 0.03 },
            { kind: 'cancel', channel: 0, time: 0.14 },
            { kind: 'target', channel: 0, time: 0.18, value: 0.1, tau: 0.04 },
          ]);
          const live = await recording;
          const rate = clock.sampleRate;
          const start = Math.ceil(ack.start * rate);
          const offline = new OfflineAudioContext(1, Math.ceil(rate * 0.6), rate);
          const source = offline.createConstantSource();
          const gain = offline.createGain();
          source.offset.value = 1;
          gain.gain.value = 0.2;
          source.connect(gain).connect(offline.destination);
          source.start();
          gain.gain.setValueAtTime(0.2, 0);
          gain.gain.setTargetAtTime(0.8, 0.05, 0.03);
          gain.gain.cancelScheduledValues(0.14);
          gain.gain.setTargetAtTime(0.1, 0.18, 0.04);
          const reference = (await offline.startRendering()).getChannelData(0);
          let maxError = 0;
          for (let i = 0; i < Math.floor(rate * 0.4); i++) {
            maxError = Math.max(maxError, Math.abs(live[start - from + i] - (reference[i] - 0.2)));
          }
          timeline.dispose();
          return { maxError, start: ack.start, receivedAt: ack.receivedAt };
        } finally {
          recorder.disconnect();
          await clock.close();
        }
      });
      h.expect(result.maxError < 0.001, `Automation differed from native output: ${JSON.stringify(result)}`);
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally { await ctx.close(); }
  },
  async 'timeline-preserves-packet-order'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const result = await page.evaluate(async () => {
        const { TimelineHost } = await import('/src/audio/timeline.ts');
        const clock = new AudioContext();
        const host = new TimelineHost(clock);
        await host.ready;
        await clock.resume();
        await clock.audioWorklet.addModule('/scripts/e2e/audio-wave-recorder.mjs');
        const timeline = await host.create([1]);
        const recorder = new AudioWorkletNode(clock, 'e2e-wave');
        timeline.node.connect(recorder).connect(clock.destination);
        try {
          const from = Math.floor((clock.currentTime * clock.sampleRate) / 128) * 128;
          const data = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('No timeline output')), 15000);
            recorder.port.onmessage = ({ data }) => {
              clearTimeout(timer);
              resolve(data.left);
            };
          });
          recorder.port.postMessage({ from, length: clock.sampleRate });
          const requested = clock.currentTime + 0.15;
          const large = [{ kind: 'adopt', channel: 0, value: 0 }];
          for (let i = 0; i < 400; i++) large.push({ kind: 'set', channel: 0, time: 0, value: 0.1 });
          const first = timeline.moment(requested, large);
          const second = timeline.moment(requested, [{ kind: 'set', channel: 0, time: 0, value: 0.8 }]);
          const [a, b] = await Promise.all([first, second]);
          const samples = await data;
          const value = samples[Math.ceil((Math.max(a.start, b.start) + 0.03) * clock.sampleRate) - from];
          const bursts = [];
          for (let batch = 0; batch < 4; batch++) {
            const batchFrom = Math.floor(clock.currentTime * clock.sampleRate / 128) * 128;
            const probe = new AudioWorkletNode(clock, 'e2e-wave', {
              processorOptions: { from: batchFrom, length: Math.ceil(clock.sampleRate * 1.5) },
            });
            timeline.node.connect(probe).connect(clock.destination);
            const recorded = new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('Interleaved output was not recorded')), 15000);
              probe.port.onmessage = ({ data }) => { clearTimeout(timer); resolve(data.left); };
            });
            const items = [];
            for (let i = 0; i < 40; i++) {
              const count = i % 2 ? 1 : 400;
              const events = Array.from({ length: count }, () => ({
                kind: 'set',
                channel: 0,
                time: 0,
                value: i / 40,
              }));
              items.push(timeline.moment(clock.currentTime + 0.15, events));
            }
            const acks = await Promise.all(items);
            const output = await recorded;
            const last = Math.max(...acks.map((ack) => ack.start));
            const heard = output[Math.ceil((last + 0.03) * clock.sampleRate) - batchFrom];
            probe.disconnect();
            bursts.push({ acks, heard });
          }
          timeline.dispose();
          return { a, b, value, bursts };
        } finally {
          recorder.disconnect();
          await clock.close();
        }
      });
      h.expect(
        Math.abs(result.value - 0.8) < 0.001,
        `A short packet overtook its opening: ${JSON.stringify(result)}`,
      );
      for (const batch of result.bursts) {
        h.expect(
          batch.acks.every((v, i) => v.start >= v.receivedAt && (!i || v.start >= batch.acks[i - 1].start)) &&
            Math.abs(batch.heard - 39 / 40) < 0.001,
          `Interleaved packets were applied out of order: ${JSON.stringify(batch)}`,
        );
      }
      h.expect(!errors.length, errors.join('\n'));
      return {
        value: result.value, batches: result.bursts.length, moments: result.bursts.flatMap((b) => b.acks).length,
      };
    } finally {
      await ctx.close();
    }
  },
  async 'timeline-burst-survives-a-page-stall'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const result = await page.evaluate(async () => {
        const { TimelineHost } = await import('/src/audio/timeline.ts');
        const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const clock = new AudioContext();
        const host = new TimelineHost(clock);
        await host.ready;
        await clock.resume();
        const timeline = await host.create([1]);
        const silent = clock.createGain();
        silent.gain.value = 0;
        timeline.node.connect(silent).connect(clock.destination);
        try {
          await timeline.moment(clock.currentTime, [{ kind: 'adopt', channel: 0, value: 0 }]);
          const lead = Math.max(2 / 60, (clock.baseLatency || 0) + 1 / 60);
          const behind = [];
          const untap = tapAudioSchedule((_, method, args, time) => {
            if (time > 0 && time < clock.currentTime) behind.push({ method, time, clock: clock.currentTime });
          });
          const batches = [];
          for (let batch = 0; batch < 2; batch++) {
            const requested = clock.currentTime;
            const pending = Array.from({ length: 100 }, (_, i) =>
              timeline.moment(requested, [{ kind: 'set', channel: 0, time: 0, value: i / 100 }]),
            );
            const before = clock.currentTime;
            if (batch) {
              const until = performance.now() + 500;
              while (performance.now() < until);
            }
            const after = clock.currentTime;
            const acks = await Promise.all(pending);
            batches.push({ before, after, acks });
          }
          untap();
          timeline.dispose();
          return { batches, lead, behind };
        } finally {
          silent.disconnect();
          await clock.close();
        }
      });
      for (const [i, batch] of result.batches.entries()) {
        const bad = batch.acks.filter(
          (ack) => ack.start < ack.receivedAt || ack.start > ack.receivedAt + result.lead,
        );
        if (i) bad.push(...batch.acks.filter((ack) => ack.receivedAt >= batch.after - 0.02));
        h.expect(
          !bad.length && batch.acks.length === 100,
          `Burst ${i} missed audio-thread timing: ${JSON.stringify({ before: batch.before, after: batch.after, bad })}`,
        );
      }
      h.expect(
        !result.behind.length,
        `A packet was placed behind the clock: ${JSON.stringify(result.behind)}`,
      );
      h.expect(!errors.length, errors.join('\n'));
      return { batches: result.batches.length, moments: 200 };
    } finally {
      await ctx.close();
    }
  },
};
