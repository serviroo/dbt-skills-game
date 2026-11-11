const AUDIO = 'dbt.audio.v1';

export const scenarios = {
  async 'first-cue-bed-and-score-sound-after-unlock'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.keyboard.press('Shift');
      const result = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const clock = new AudioContext();
        const engine = new AudioEngine(clock);
        const taps = [engine.testInput('sfx'), engine.bedBus, engine.testInput('music')].map((bus) => {
          const analyser = clock.createAnalyser();
          analyser.fftSize = 2048;
          const silent = clock.createGain();
          silent.gain.value = 0;
          bus.connect(analyser).connect(silent).connect(clock.destination);
          return analyser;
        });
        const rms = (analyser) => {
          const samples = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(samples);
          return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        };
        const wait = async (until) => {
          const limit = performance.now() + 15000;
          while (clock.currentTime < until) {
            if (performance.now() > limit) throw new Error('The audio clock did not advance');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };
        try {
          const asked = performance.now();
          const readyAtUnlock = engine.timeline.isReady;
          await engine.unlock();
          const runningMs = performance.now() - asked;
          const cue = engine.play('check');
          const ack = await cue.started;
          await wait(ack.start + 0.1);
          const cueRms = rms(taps[0]);
          engine.bed('gate_hum', { level: 0.5, fadeIn: 0.05 });
          engine.music.to('calm', 0.05);
          await wait(clock.currentTime + 1.2);
          return { readyAtUnlock, runningMs, state: clock.state, cueRms, bedRms: rms(taps[1]), scoreRms: rms(taps[2]) };
        } finally {
          engine.dispose();
          if (clock.state !== 'closed') await new Promise((resolve) => clock.addEventListener('statechange', () => { if (clock.state === 'closed') resolve(); }, { once: true }));
        }
      });
      h.expect(!result.readyAtUnlock && result.state === 'running' && result.cueRms > 1e-5 && result.bedRms > 1e-5 && result.scoreRms > 1e-5, `The first audio after unlock was not heard: ${JSON.stringify(result)}`);
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally { await ctx.close(); }
  },
  async 'app-audio-starts-suspended-and-keeps-running'(h) {
    const rows = [];
    for (let i = 0; i < 50; i++) {
      const ctx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'en-US' });
      try {
        await ctx.addInitScript((seed) => {
          for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
          window.__startupContexts = [];
          const Native = window.AudioContext;
          window.AudioContext = class extends Native {
            constructor(...args) {
              super(...args);
              const context = this;
              const row = { created: performance.now(), initial: this.state, stack: new Error().stack, suspend: null, module: null, running: null, earlyResumes: 0, states: [] };
              const resume = this.resume.bind(this);
              this.resume = (...values) => {
                if (!row.module?.finished) row.earlyResumes++;
                return resume(...values);
              };
              const suspend = this.suspend.bind(this);
              this.suspend = (...values) => {
                row.suspend = { before: context.state, after: null };
                return suspend(...values).then(() => { row.suspend.after = context.state; });
              };
              this.addEventListener('statechange', () => {
                row.states.push(context.state);
                if (context.state === 'running') {
                  if (row.running === null) row.running = performance.now();
                }
              });
              const add = this.audioWorklet.addModule.bind(this.audioWorklet);
              this.audioWorklet.addModule = (...values) => {
                const entry = row.module = { before: context.state, after: null, finished: null, samples: [] };
                const timer = setInterval(() => {
                  entry.samples.push(context.state);
                }, 1);
                return add(...values).then(() => { entry.after = context.state; entry.finished = performance.now(); }).finally(() => clearInterval(timer));
              };
              window.__startupContexts.push({ context, row });
            }
          };
        }, { 'dbt.app.v1': h.SEEN, [AUDIO]: JSON.stringify({ v: 1, master: 1, music: 0, sfx: 1, muted: false }) });
        const page = await ctx.newPage();
        await page.goto(h.server.url + '/');
        await page.waitForFunction(() => window.__daily && window.__startupContexts.length, null, { timeout: 30000 });
        await page.keyboard.press('Shift');
        let ready = true;
        try { await page.waitForFunction(() => { const x = window.__startupContexts[0]; return x.row.module?.finished && x.context.state === 'running'; }, null, { timeout: 10000 }); }
        catch { ready = false; }
        const before = await page.evaluate(() => { const x = window.__startupContexts[0]; return { t: x.context.currentTime, state: x.context.state }; });
        await page.waitForTimeout(500);
        const result = await page.evaluate(() => { const x = window.__startupContexts[0]; return { t: x.context.currentTime, state: x.context.state, row: x.row, all: window.__startupContexts.map((item) => ({ state: item.context.state, row: item.row })) }; });
        const row = { i, ready, before, ...result };
        rows.push(row);
        h.expect(ready && result.state === 'running' && result.t - before.t > 0.2 && result.row.module.after !== 'running' && result.row.earlyResumes === 0, `App clock stopped, resumed early or was running at module readiness at start ${i + 1}: ${JSON.stringify(row)}`);
      } finally { await ctx.close(); }
    }
    const times = rows.map((r) => r.row.running - r.row.created).sort((a, b) => a - b);
    return { starts: rows.length, stopped: 0, minMs: times[0], medianMs: times[25], maxMs: times.at(-1), transitions: rows.map(({ i, row }) => ({ i, initial: row.initial, module: row.module, states: row.states })) };
  },
};
