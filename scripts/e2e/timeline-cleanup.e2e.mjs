export const scenarios = {
  async 'packet-input-lives-until-its-moment-is-applied'(h) {
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
          processorOptions: { from, length: Math.ceil(clock.sampleRate * 0.4) },
        });
        timeline.node.connect(recorder).connect(clock.destination);
        const recording = new Promise((resolve) => { recorder.port.onmessage = ({ data }) => resolve(data.left); });
        const make = clock.createBufferSource.bind(clock);
        let ended = false;
        let disconnected = false;
        clock.createBufferSource = () => {
          const source = make();
          const disconnect = source.disconnect.bind(source);
          source.addEventListener('ended', () => { ended = true; });
          source.disconnect = (...args) => { disconnected = true; return disconnect(...args); };
          return source;
        };
        const post = timeline.node.port.postMessage.bind(timeline.node.port);
        timeline.node.port.postMessage = (message, ...args) => {
          if (message !== 'flush') post(message, ...args);
        };
        let acknowledged = false;
        try {
          const opening = timeline.moment(clock.currentTime + 0.06, [
            { kind: 'adopt', channel: 0, value: 0 },
            { kind: 'set', channel: 0, time: 0, value: 0.75 },
          ]).then((ack) => { acknowledged = true; return ack; });
          const samples = await recording;
          const before = { ended, disconnected, acknowledged, peak: Math.max(...samples) };
          post('flush');
          const ack = await opening;
          const limit = performance.now() + 3000;
          while (!disconnected && performance.now() < limit) await new Promise((resolve) => setTimeout(resolve, 10));
          return { before, disconnected, ack };
        } finally {
          timeline.node.port.postMessage = post;
          clock.createBufferSource = make;
          timeline.dispose();
          recorder.disconnect();
          await clock.close();
        }
      });
      h.expect(
        result.before.ended && !result.before.disconnected && !result.before.acknowledged &&
          result.before.peak > 0.74 && result.disconnected,
        `Packet cleanup did not follow application: ${JSON.stringify(result)}`,
      );
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally {
      await ctx.close();
    }
  },
};
