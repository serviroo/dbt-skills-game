export const scenarios = {
  async 'cue-batches-merge-same-time-bus-writes'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { stoppedBy } = await import('/src/audio/voice.ts');
        const sr = 48000;
        const hold = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'cancelAndHoldAtTime');
        const out = [];
        for (const firefox of [false, true]) {
          if (firefox) delete AudioParam.prototype.cancelAndHoldAtTime;
          try {
            for (const kind of ['repeated-ui-dip', 'paired-rise', 'Skip', 'replay']) {
              const c = new OfflineAudioContext(1, 6 * sr, sr);
              const e = new AudioEngine(c, {
                volume: 0,
                user: { master: 1, music: 0, sfx: 0, muted: false },
              });
              const node = kind === 'repeated-ui-dip' ? e.uiDuck : e.yieldG;
              node.disconnect();
              node.connect(c.destination);
              const source = c.createConstantSource();
              source.connect(node);
              source.start();
              let error = '';
              const press = kind === 'repeated-ui-dip' ? 0.25 : 0.4;
              const fade = kind === 'repeated-ui-dip' ? 0.3 : 0.6;
              const horizon = stoppedBy(press, fade);
              try {
                e.bed('gate_hum', { at: 0, level: 0 });
                if (kind === 'repeated-ui-dip') {
                  e.play('ui_open', { at: 0, gain: 0 });
                  e.reset(fade, press);
                  e.schedule([
                    { t: 0.26, cue: 'reward_chime', opts: { gain: 0 } },
                    { t: 0.27, cue: 'soft_chime', opts: { gain: 0, id: 'after' } },
                  ], 0);
                } else {
                  e.play('soldier_ignite', { at: 0, gain: 0 });
                  e.music.to('windows', 0.1, { at: 0 });
                  e.music.to('calm', 0.1, { at: 0.2, fadeOut: 2 });
                  if (kind === 'replay') e.reset(fade, press);
                  else e.stopAll(fade, press);
                  if (kind === 'paired-rise') e.makeRoom(0.5, -2, 0.2, 1.54, 0.004);
                  e.schedule([
                    { t: 0.5, cue: 'stand_swell', opts: { gain: 0 } },
                    { t: 0.51, cue: 'soft_chime', opts: { gain: 0, id: 'after' } },
                  ], 0);
                }
              } catch (err) {
                error = err.message;
              }
              const batchFinished = !!e.plans.sound('after');
              const data = (await c.startRendering()).getChannelData(0);
              const first = Math.ceil(press * sr);
              let floor = data[first];
              let rise = 0;
              for (let i = first + 1; i < Math.floor(horizon * sr); i++) {
                rise = Math.max(rise, data[i] - floor);
                floor = Math.min(floor, data[i]);
              }
              out.push({ firefox, kind, error, batchFinished, horizon, rise,
                held: data[Math.ceil(press * sr)], end: data.at(-1) });
            }
          } finally {
            if (hold) Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', hold);
          }
        }
        return out;
      });
      const failed = results.filter((r) => r.error || !r.batchFinished || r.rise > 1e-6
        || r.held < 0.7 || r.held > 0.71 || Math.abs(r.end - 1) > 1e-6);
      expect(!failed.length, JSON.stringify(failed));
      expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },

  async 'paired-bus-levels-replace-a-deferred-rise'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const sr = 48000;
        const hold = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'cancelAndHoldAtTime');
        const out = [];
        for (const firefox of [false, true]) {
          if (firefox) delete AudioParam.prototype.cancelAndHoldAtTime;
          try {
            const c = new OfflineAudioContext(1, 3 * sr, sr);
            const e = new AudioEngine(c, { volume: 0 });
            const node = e.yieldG;
            node.disconnect();
            node.connect(c.destination);
            const source = c.createConstantSource();
            source.connect(node);
            source.start();
            const p = node.curve;
            let error = '';
            try {
              e.play('soldier_ignite', { at: 0, gain: 0 });
              e.busLevels.hold(0.4, 1.6);
              e.busLevels.set(p, 10 ** (-2 / 20), 0.5, 0.2);
              e.busLevels.set(p, 1, 1.54, 0.004, false);
            } catch (err) {
              error = err.message;
            }
            const data = (await c.startRendering()).getChannelData(0);
            let floor = data[0.4 * sr];
            let rise = 0;
            for (let i = 0.4 * sr + 1; i < 1.6 * sr; i++) {
              rise = Math.max(rise, data[i] - floor);
              floor = Math.min(floor, data[i]);
            }
            out.push({ firefox, error, rise, held: data[0.4 * sr], end: data.at(-1) });
          } finally {
            if (hold) Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', hold);
          }
        }
        return out;
      });
      expect(results.every((r) => !r.error && r.rise < 1e-6 && r.held > 0.7
        && r.held < 0.71 && Math.abs(r.end - 1) < 1e-6), JSON.stringify(results));
      expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
};
