export const scenarios = {
  async 'packet-source-waits-for-its-audio-input'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const results = await page.evaluate(async () => {
        const { TimelineHost } = await import('/src/audio/timeline.ts');
        const clock = new AudioContext();
        const host = new TimelineHost(clock);
        await host.ready;
        await clock.resume();
        const timeline = await host.create([1]);
        const silence = clock.createGain();
        silence.gain.value = 0;
        timeline.node.connect(silence).connect(clock.destination);
        const make = clock.createBufferSource.bind(clock);
        const gates = [];
        const results = [];
        try {
          for (const delay of [65, 500]) {
            clock.createBufferSource = () => {
              const source = make();
              const connect = source.connect.bind(source);
              source.connect = (destination, ...args) => {
                const gate = clock.createGain();
                gates.push(gate);
                gate.gain.value = 0;
                gate.gain.setValueAtTime(1, clock.currentTime + delay / 1000);
                connect(gate);
                gate.connect(destination, ...args);
                return destination;
              };
              return source;
            };
            const asked = clock.currentTime;
            const result = await Promise.race([
              timeline.moment(asked, [{ kind: 'adopt', channel: 0, value: 0 }]),
              new Promise((resolve) => setTimeout(() => resolve(null), delay + 3000)),
            ]);
            results.push({ delay, asked, result });
            if (!result) break;
          }
          return results;
        } finally {
          clock.createBufferSource = make;
          timeline.dispose();
          for (const gate of gates) gate.disconnect();
          silence.disconnect();
          await clock.close();
        }
      });
      for (const { delay, asked, result } of results) {
        h.expect(
          result && result.receivedAt >= asked + (delay - 10) / 1000 &&
            result.start >= result.receivedAt && result.start <= result.receivedAt + 2 / 60,
          `Packet lost while input was silent for ${delay} ms: ${JSON.stringify({ asked, result })}`,
        );
      }
      h.expect(results.length === 2, `Only ${results.length} delayed inputs completed`);
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
};
