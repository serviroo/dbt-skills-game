export const scenarios = {
  async 'oscillators-start-on-the-same-frame-as-offline'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.keyboard.press('Shift');
      const result = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const clock = new AudioContext();
        await clock.suspend();
        await clock.audioWorklet.addModule('/scripts/e2e/oscillator-boundary-worklet.mjs');
        const engine = new AudioEngine(clock);
        await engine.unlock();
        const sr = clock.sampleRate;
        const references = new Map();
        const ref = async (start) => {
          const into = Math.round(((((start * sr) % 128) + 128) % 128) * 1e6) / 1e6;
          const key = into.toFixed(3);
          if (references.has(key)) return references.get(key);
          const frame = Math.ceil(0.25 * sr / 128) * 128 + into;
          const offline = new OfflineAudioContext(7, Math.ceil(frame + sr * 0.18), sr);
          const offlineEngine = new AudioEngine(offline);
          offlineEngine.volume.disconnect();
          const merge = offline.createChannelMerger(7);
          merge.connect(offline.destination);
          const make = offline.createOscillator.bind(offline);
          let channel = 0;
          offline.createOscillator = () => {
            const osc = make();
            osc.connect(merge, 0, channel++);
            return osc;
          };
          offlineEngine.play('soft_chime', { at: frame / sr });
          const buffer = await offline.startRendering();
          const samples = Array.from({ length: 7 }, (_, ch) => buffer.getChannelData(ch));
          const value = { frame: Math.ceil(frame), samples, channels: channel };
          references.set(key, value);
          return value;
        };
        const failures = [];
        const timings = [];
        try {
          for (let run = 0; run < 1; run++) {
            const merge = clock.createChannelMerger(7);
            const from = Math.floor(clock.currentTime * sr / 128) * 128;
            const recorder = new AudioWorkletNode(clock, 'oscillator-boundary', {
              channelCount: 7, channelCountMode: 'explicit',
              processorOptions: { from, length: Math.ceil(sr * 1.3) },
            });
            merge.connect(recorder).connect(clock.destination);
            const data = new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('No oscillator capture')), 15000);
              recorder.port.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
              recorder.onprocessorerror = () => reject(new Error('The phase recorder failed'));
            });
            const make = clock.createOscillator.bind(clock);
            const nodes = [];
            clock.createOscillator = () => {
              const osc = make();
              osc.connect(merge, 0, nodes.length);
              nodes.push(osc);
              return osc;
            };
            const asked = clock.currentTime;
            const fractional = (1 - ((0.006 * sr) % 1)) % 1;
            let frame = Math.ceil((asked + 0.3) * sr / 128) * 128 + 64 + fractional;
            while (Math.ceil((frame / sr + 0.006) * sr) === Math.round(frame + 0.006 * sr)) frame += 128;
            const at = frame / sr;
            let handle;
            try { handle = engine.play('soft_chime', { at }); }
            finally { clock.createOscillator = make; }
            const until = performance.now() + 65;
            while (performance.now() < until);
            const ack = await handle.started;
            const captured = await data;
            const expected = await ref(ack.start);
            const startSamples = ack.start * sr;
            const first = Math.ceil(startSamples - Math.max(1, Math.abs(startSamples)) * Number.EPSILON * 2) - from;
            const difference = captured.map((channel, ch) => {
              let err = 0, energy = 0;
              for (let i = 0; i < Math.floor(sr * 0.1); i++) {
                const a = channel[first + i], b = expected.samples[ch][expected.frame + i];
                err += (a-b)**2;
                energy += b*b;
              }
              return Math.sqrt(err / energy);
            });
            const row = { run, asked, at, sampleRate: sr, ...ack, nodes: nodes.length, expected: expected.channels, difference };
            timings.push(row);
            if (nodes.length !== 7 || difference.some((value) => !(value < 0.02))) failures.push(row);
            for (const osc of nodes) osc.disconnect(merge);
            merge.disconnect();
            recorder.disconnect();
            if (failures.length) break;
          }
          return { failures, timings };
        } finally {
          engine.dispose();
        }
      });
      console.log('OSCILLATOR_PHASE ' + JSON.stringify(result.timings));
      h.expect(!result.failures.length, `Oscillator phase differed: ${JSON.stringify(result.failures)}`);
      h.expect(!errors.length, errors.join('\n'));
      return { cases: result.timings.length };
    } finally { await ctx.close(); }
  },
};
