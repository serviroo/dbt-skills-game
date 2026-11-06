export const scenarios = {
  async 'safe-zone-leaves-earlier-bed-and-score-unchanged'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const sr = 48000;
        const render = async (sound, visit) => {
          const c = new OfflineAudioContext(2, 4 * sr, sr);
          const eng = new AudioEngine(c);
          if (sound === 'bed') eng.bed('gate_hum', { at: 0.02 });
          else {
            eng.music.to('windows', 0.5, { at: 0.02 });
            eng.music.scheduleUntil(4);
          }
          if (visit) {
            eng.quiet(true, SCORE.safeOutSec, 2);
            eng.quiet(false, SCORE.safeBackSec, 3);
          }
          return (await c.startRendering()).getChannelData(0);
        };
        const out = [];
        for (const sound of ['bed', 'score']) {
          const twin = await render(sound, false);
          const visit = await render(sound, true);
          for (const [a, b] of [[0.5, 1], [1, 1.5], [1.5, 1.99]]) {
            let reference = 0;
            let level = 0;
            for (let i = Math.ceil(a * sr); i < Math.floor(b * sr); i++) {
              reference += twin[i] ** 2;
              level += visit[i] ** 2;
            }
            out.push({ sound, a, b, reference, db: 10 * Math.log10(level / reference) });
          }
        }
        return out;
      });
      for (const r of results) {
        expect(r.reference > 1e-6, `${r.sound}: no reference sound`);
        expect(Math.abs(r.db) < 0.1, `${r.sound} before visit ${r.a}-${r.b}s: ${r.db.toFixed(3)} dB`);
      }
      expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },

  async 'held-fades-keep-their-curve-without-native-hold'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const results = await page.evaluate(async () => {
        delete AudioParam.prototype.cancelAndHoldAtTime;
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const sr = 48000;
        const out = [];
        for (const kind of ['safe-linear', 'echo-linear', 'safe-target', 'repeated-hold', 'endpoint']) {
          const c = new OfflineAudioContext(1, 3 * sr, sr);
          const eng = new AudioEngine(c);
          const gain = kind === 'echo-linear' ? eng.echo.out[0] : eng.safe;
          gain.disconnect();
          gain.connect(c.destination);
          const source = c.createConstantSource();
          source.connect(gain);
          source.start();
          let at = 1.5;
          let expected = 0.5;
          let slope = 0.5;
          if (kind === 'echo-linear') {
            eng.stopAll(2, 0.5);
            eng.stopAll(0.25, at);
          } else if (kind === 'safe-target') {
            eng.quiet(true, 0.5, 0.5);
            eng.quiet(false, 2, 1.25);
            expected = 1 - Math.exp(-0.25 / 0.5);
            slope = 1 / 0.5;
            eng.quiet(true, 0.25, at);
          } else {
            eng.quiet(true, 2, 0.5);
            if (kind === 'endpoint') {
              at = 2.5;
              expected = 0;
            }
            eng.quiet(false, 1, at);
            if (kind === 'repeated-hold') {
              at = 1.625;
              expected = 1 - 0.5 * Math.exp(-0.125 / 0.25);
              slope = 2;
              eng.quiet(true, 0.25, at);
            }
          }
          const data = (await c.startRendering()).getChannelData(0);
          const i = Math.round(at * sr);
          const previous = data[i - 1];
          out.push({ kind, expected, actual: data[i], step: Math.abs(data[i] - previous), slope });
          if (kind.endsWith('linear')) {
            out.at(-1).before = data[sr];
          }
        }
        return out;
      });
      for (const r of results) {
        expect(Math.abs(r.actual - r.expected) < 1e-6,
          `${r.kind}: held ${r.actual}, expected ${r.expected}`);
        expect(r.step <= r.slope / 48000 + 2e-7,
          `${r.kind}: hold jumped ${r.step}, ramp step ${r.slope / 48000}`);
        if (r.before !== undefined) expect(Math.abs(r.before - 0.75) < 1e-6,
          `${r.kind}: the hold erased the earlier ramp (${r.before})`);
      }
      expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },

  async 'tracked-values-match-the-rendered-automation'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const results = await page.evaluate(async () => {
        const { trackParam } = await import('/src/audio/curve.ts');
        const { holdAt } = await import('/src/audio/param.ts');
        const sr = 48000;
        const out = [];
        const schedules = {
          implicit: (p) => p.linearRampToValueAtTime(0, 2),
          sets: (p) => {
            p.value = 0.75;
            p.setValueAtTime(0.25, 0.25);
            p.setValueAtTime(0.5, 1);
            p.setValueAtTime(0.625, 1);
          },
          ordered: (p) => {
            p.setValueAtTime(1, 0);
            p.linearRampToValueAtTime(0, 2);
            p.setValueAtTime(0.5, 1);
          },
          targets: (p) => {
            p.setTargetAtTime(0, 0.25, 0.5);
            p.setTargetAtTime(1, 0.75, 0.25);
            p.setValueAtTime(0.25, 1.5);
          },
          zeroTarget: (p) => {
            p.setTargetAtTime(0, 0.25, 0);
            p.setTargetAtTime(0.75, 0.25, 0);
          },
          zeroTargetRamp: (p) => {
            p.setTargetAtTime(0, 0.25, 0);
            p.linearRampToValueAtTime(0.25, 1.5);
          },
          startedTargetRamp: async (p, c) => {
            p.setTargetAtTime(0, 0.25, 0.5);
            const paused = c.suspend(0.75);
            const rendering = c.startRendering();
            await paused;
            p.linearRampToValueAtTime(0.25, 1.5);
            holdAt(p, 1.25);
            return { rendering };
          },
          targetRamp: (p) => {
            p.setTargetAtTime(0, 0.25, 0.5);
            p.linearRampToValueAtTime(0.25, 1.5);
          },
          cancelled: (p) => {
            p.setValueAtTime(0.5, 0);
            p.linearRampToValueAtTime(0, 1);
            p.setTargetAtTime(1, 1.5, 0.25);
            p.cancelScheduledValues(0.75);
          },
          held: (p) => {
            p.setValueAtTime(1, 0.25);
            p.linearRampToValueAtTime(0, 2.25);
            holdAt(p, 1.25);
            holdAt(p, 1.75);
          },
        };
        for (const [name, schedule] of Object.entries(schedules)) {
          const c = new OfflineAudioContext(1, 3 * sr, sr);
          const gain = c.createGain();
          gain.connect(c.destination);
          const source = c.createConstantSource();
          source.connect(gain);
          source.start();
          const p = trackParam(gain.gain, c);
          const pending = await schedule(p, c);
          const expected = [];
          for (let i = 0; i < 3 * sr; i += 97) expected.push([i, p.valueAt(i / sr)]);
          if (pending?.rendering) await c.resume();
          const data = (await (pending?.rendering ?? c.startRendering())).getChannelData(0);
          const error = Math.max(...expected.map(([i, value]) => Math.abs(data[i] - value)));
          const outsideSample = expected.filter(([i, value]) => {
            const step = Math.max(Math.abs(data[i] - data[Math.max(0, i - 1)]),
              Math.abs(data[i + 1] - data[i]));
            return Math.abs(data[i] - value) > step + 2e-7;
          });
          out.push({ name, error, outsideSample: outsideSample.slice(0, 3) });
        }
        return out;
      });
      for (const r of results) expect(!r.outsideSample.length, JSON.stringify(r));
      expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },

  async 'replacement-echo-keeps-the-gliding-send-levels'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const sr = 48000;
        const c = new OfflineAudioContext(6, sr, sr);
        const eng = new AudioEngine(c);
        eng.setUser({ master: 1, music: 0.25, sfx: 0.5, muted: false }, 4);
        const paused = c.suspend(0.5);
        const rendering = c.startRendering();
        await paused;
        const at = c.currentTime;
        eng.stopAll(0.25, at);
        const probe = c.createChannelMerger(6);
        probe.connect(c.destination);
        const source = c.createConstantSource();
        const targets = [];
        Object.entries(eng.echo.sends).forEach(([name, gain], i) => {
          source.connect(gain);
          gain.connect(probe, 0, i + 2);
          const target = name.startsWith('mus') ? 0.25 ** 2 : 0.5 ** 2;
          targets.push({ name, target, channel: i + 2, expected: target + (1 - target) * Math.exp(-at) });
        });
        source.start(at);
        await c.resume();
        const data = await rendering;
        return targets.map((r) => ({ ...r, actual: data.getChannelData(r.channel)[Math.round(at * sr)] }));
      });
      for (const r of results) expect(Math.abs(r.actual - r.expected) < 1e-6,
        r.name + ': replacement started at ' + r.actual + ', expected ' + r.expected);
      expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
};
