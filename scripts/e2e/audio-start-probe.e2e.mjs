export const scenarios = {
  async 'running-context-suspends-before-worklet-load'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto(h.server.url + '/scripts/e2e/audio-start-probe.html');
      await page.getByRole('button', { name: 'Start' }).click();
      const rows = [];
      for (let i = 0; i < 50; i++) {
        const row = await page.evaluate(async () => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const clock = new AudioContext();
          await clock.resume();
          const before = clock.state;
          let resolved = false;
          let atResolution = null;
          let earlyResumes = 0;
          const resume = clock.resume.bind(clock);
          clock.resume = (...args) => {
            if (!resolved) earlyResumes++;
            return resume(...args);
          };
          const add = clock.audioWorklet.addModule.bind(clock.audioWorklet);
          clock.audioWorklet.addModule = (...args) => add(...args).then(() => {
            atResolution = clock.state;
            resolved = true;
          });
          const engine = new AudioEngine(clock);
          try {
            await engine.unlock();
            const first = clock.currentTime;
            await new Promise((resolve) => setTimeout(resolve, 500));
            return { before, atResolution, earlyResumes, state: clock.state, first, last: clock.currentTime };
          } finally {
            engine.dispose();
            if (clock.state !== 'closed') await new Promise((resolve) => clock.addEventListener('statechange', () => { if (clock.state === 'closed') resolve(); }, { once: true }));
          }
        });
        rows.push(row);
        h.expect(row.before === 'running' && row.atResolution !== 'running' && row.earlyResumes === 0 && row.state === 'running' && row.last - row.first > 0.2, `Already-running context failed at start ${i + 1}: ${JSON.stringify(row)}`);
      }
      return { starts: rows.length, stopped: 0, rows };
    } finally { await ctx.close(); }
  },
  async 'suspended-worklet-startup-probe'(h) {
    const rows = [];
    for (let i = 0; i < 50; i++) {
      const ctx = await h.browser.newContext();
      try {
        const page = await ctx.newPage();
        await page.goto(h.server.url + '/scripts/e2e/audio-start-probe.html');
        await page.getByRole('button', { name: 'Start' }).click();
        const row = await page.evaluate(async () => {
          const begin = performance.now();
          const clock = new AudioContext();
          const initial = clock.state;
          const events = [];
          let loading = false;
          let loaded = false;
          let earlyResumes = 0;
          const resume = clock.resume.bind(clock);
          clock.resume = (...args) => {
            if (!loaded) earlyResumes++;
            return resume(...args);
          };
          clock.addEventListener('statechange', () => {
            events.push({ state: clock.state, time: performance.now() - begin, loading });
          });
          try {
            void clock.suspend().catch((error) => events.push({ error: String(error) }));
            const beforeLoad = clock.state;
            loading = true;
            await clock.audioWorklet.addModule('/scripts/e2e/audio-wave-recorder.mjs');
            const afterLoad = clock.state;
            loaded = true;
            loading = false;
            await clock.resume();
            const runningMs = performance.now() - begin;
            const before = clock.currentTime;
            await new Promise((resolve) => setTimeout(resolve, 600));
            return { initial, beforeLoad, afterLoad, earlyResumes, state: clock.state, before, after: clock.currentTime, runningMs, events };
          } finally { await clock.close(); }
        });
        rows.push(row);
      } finally { await ctx.close(); }
    }
    const stopped = rows.filter((r) => r.state !== 'running' || r.after - r.before < 0.25);
    const unsafe = rows.filter((r) => r.afterLoad === 'running' || r.earlyResumes);
    h.expect(!stopped.length && !unsafe.length, `${stopped.length} of 50 clocks stopped; ${unsafe.length} resumed early or resolved while running: ${JSON.stringify({ stopped, unsafe })}`);
    const times = rows.map((r) => r.runningMs).sort((a, b) => a - b);
    return { starts: rows.length, stopped: stopped.length, minMs: times[0], medianMs: times[25], maxMs: times.at(-1), transitions: rows.map((r) => ({ initial: r.initial, beforeLoad: r.beforeLoad, afterLoad: r.afterLoad, events: r.events })) };
  },
};
