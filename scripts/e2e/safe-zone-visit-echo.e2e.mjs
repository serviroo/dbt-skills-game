export const scenarios = {
  async 'completed-cues-release-their-tracking'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const out = [];
      for (const sr of [44100, 48000]) {
        const before = await page.evaluate(async (sr) => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const c = new AudioContext({ sampleRate: sr });
          const live = new Set();
          let clocks = 0;
          const make = c.createConstantSource.bind(c);
          let peak = 0;
          let destinations = 0;
          c.createConstantSource = () => {
            const node = make();
            const connect = node.connect.bind(node);
            const disconnect = node.disconnect.bind(node);
            live.add(node);
            clocks++;
            peak = Math.max(peak, live.size);
            node.connect = (to) => {
              if (to === c.destination) destinations++;
              return connect(to);
            };
            node.disconnect = () => {
              live.delete(node);
              return disconnect();
            };
            return node;
          };
          const eng = new AudioEngine(c, { muted: true });
          await c.resume();
          const voices = [];
          const play = (at) => {
            eng.play('ui_tap', { at });
            const voice = [...eng.active].at(-1);
            const row = { voice, by: voice.end + 4, disconnected: null };
            const disconnect = voice.out.disconnect.bind(voice.out);
            voice.out.disconnect = () => {
              row.disconnected = c.currentTime;
              return disconnect();
            };
            voices.push(row);
          };
          const from = c.currentTime + 0.05;
          for (let i = 0; i < 52; i++) play(from + (3 - i % 4) * 0.1);
          window.__cleanup = {
            c, eng, live, voices, play,
            counts: () => ({ peak, destinations, clocks }),
          };
          return { active: eng.active.size, peak, destinations };
        }, sr);
        expect(before.active === 52 && before.peak === 1 && before.destinations === 0,
          `52 cues need one shared cleanup clock through the mixer: ${JSON.stringify(before)}`);
        for (const count of [52, 53]) {
          await page.waitForFunction((count) => {
            const { c, eng, live, voices } = window.__cleanup;
            return voices.length === count && c.currentTime >= Math.max(...voices.map((v) => v.by))
              && !eng.active.size && !live.size && voices.every((v) => v.disconnected !== null);
          }, count, { timeout: 10000, polling: 20 });
          if (count === 52) await page.evaluate(() => window.__cleanup.play(window.__cleanup.c.currentTime + 0.05));
        }
        const got = await page.evaluate(async () => {
          const { c, eng, live, voices, counts } = window.__cleanup;
          const got = {
            sr: c.sampleRate, ...counts(), active: eng.active.size, live: live.size,
            disconnected: voices.filter((v) => v.disconnected >= v.by).length,
            earliest: Math.min(...voices.map((v) => v.disconnected - v.by)),
          };
          await c.close();
          eng.dispose();
          delete window.__cleanup;
          return got;
        });
        expect(got.peak === 1 && got.clocks >= 3 && got.destinations === 0
          && got.active === 0 && got.live === 0 && got.disconnected === 53, JSON.stringify(got));
        out.push(got);
      }
      expect(!errors.length, errors.join('\n'));
      return out;
    } finally {
      await page.evaluate(async () => {
        if (window.__cleanup) {
          await window.__cleanup.c.close();
          window.__cleanup.eng.dispose();
        }
      });
      await ctx.close();
    }
  },

  async 'accepted-stops-outlast-a-quick-visit'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const got = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const out = [];
        for (const sr of [44100, 48000]) {
          for (const sound of ['cue', 'score']) {
            const c = new OfflineAudioContext(4, sr * 5, sr);
            const eng = new AudioEngine(c);
            if (sound === 'cue') {
              eng.play('breath_out', { at: 0.02, dur: 6 }).stop(1.012, 0.001);
            } else {
              eng.music.to('windows', 0.05, { at: 0.02 });
              eng.music.to('calm', 0.6, { at: 1.01 });
              eng.music.scheduleUntil(10);
            }
            eng.quiet(true, SCORE.safeOutSec, 1);
            if (sound === 'score') eng.stopAll(SCORE.safeOutSec, 1);
            eng.quiet(false, SCORE.safeBackSec, 1.005);
            const probe = c.createChannelMerger(4);
            eng.echo.hall.connect(probe, 0, 3);
            probe.connect(c.destination);
            eng.play('reward_chime', { at: 4.2 });
            const data = await c.startRendering();
            const db = (channel, from, to) => {
              const samples = data.getChannelData(channel);
              let energy = 0;
              const start = Math.ceil(from * sr);
              const end = Math.ceil(to * sr);
              for (let i = start; i < end; i++) energy += samples[i] ** 2;
              return 10 * Math.log10(energy / (end - start));
            };
            out.push({ sr, sound, before: db(0, 0.5, 0.9), old: db(3, 1.005, 4), back: db(3, 4.2, 4.8) });
          }
        }
        return out;
      });
      const failures = got.filter((r) => !(r.before > -75 && r.old < -100 && r.back > -75));
      expect(!failures.length, JSON.stringify(failures));
      expect(!errors.length, errors.join('\n'));
      return got;
    } finally {
      await ctx.close();
    }
  },

  async 'stopped-beds-cannot-feed-a-quiet-only-visit'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const got = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const out = [];
        for (const sr of [44100, 48000]) {
          for (const stop of ['handle', 'engine', 'overlap']) {
            const c = new OfflineAudioContext(4, sr * 6, sr);
            const eng = new AudioEngine(c);
            const bed = eng.bed('ambient', { at: 0.02, level: 10, fadeIn: 0.05 });
            if (stop === 'handle') bed.stop(0.6, 1);
            else if (stop === 'engine') eng.stopBed('ambient', 0.6, 1);
            else {
              bed.stop(8, 0.5);
              bed.stop(0.6, 1.012);
            }
            eng.quiet(true, SCORE.safeOutSec, 1.01);
            eng.quiet(false, SCORE.safeBackSec, 1.015);
            const probe = c.createChannelMerger(4);
            eng.echo.room.connect(probe, 0, 2);
            eng.echo.hall.connect(probe, 0, 3);
            probe.connect(c.destination);
            eng.play('reward_chime', { at: 5 });
            const rendered = await c.startRendering();
            const db = (ch, from, to) => {
              const samples = rendered.getChannelData(ch);
              const start = Math.ceil(from * sr);
              const end = Math.ceil(to * sr);
              let energy = 0;
              for (let i = start; i < end; i++) energy += samples[i] ** 2;
              return 10 * Math.log10(energy / (end - start));
            };
            for (const [i, bus] of ['room', 'hall'].entries()) {
              out.push({ sr, stop, bus, before: db(0, 0.5, 0.9), old: db(i + 2, 1.015, 4.8),
                back: db(i + 2, 5, 5.8) });
            }
          }
        }
        return out;
      });
      const failures = [];
      for (const g of got) {
        const at = `${g.sr} Hz, ${g.stop}, ${g.bus}`;
        if (!(g.before > -60)) failures.push(`${at}: the bed was inaudible before its stop (${g.before} dB)`);
        if (g.old > -100) failures.push(`${at}: the stopped bed fed the new echo at ${g.old.toFixed(1)} dB`);
        if (!(g.back > -75)) failures.push(`${at}: new sound did not return (${g.back.toFixed(1)} dB)`);
      }
      expect(!failures.length, failures.join('\n'));
      expect(!errors.length, errors.join('\n'));
      return got;
    } finally {
      await ctx.close();
    }
  },

  async 'a-bed-stopping-later-keeps-the-returning-echo'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const got = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const out = [];
        for (const [sr, stop] of [[44100, [0.6, 8]], [48000, [0.6, 8]], [44100, [8, 2.01]], [48000, [8, 2.01]]]) {
          const c = new OfflineAudioContext(4, sr * 6, sr);
          const eng = new AudioEngine(c);
          eng.bed('ambient', { at: 0.02, fadeIn: 0.05 }).stop(...stop);
          eng.music.to('calm', 0.5, { at: 0.02 });
          eng.music.scheduleUntil(6);
          eng.quiet(true, SCORE.safeOutSec, 2);
          eng.quiet(false, SCORE.safeBackSec, 3);
          const probe = c.createChannelMerger(4);
          eng.echo.hall.connect(probe, 0, 3);
          probe.connect(c.destination);
          const rendered = await c.startRendering();
          const samples = rendered.getChannelData(3);
          let energy = 0;
          for (let i = 4 * sr; i < 5 * sr; i++) energy += samples[i] ** 2;
          out.push({ sr, stop, hall: 10 * Math.log10(energy / sr) });
        }
        return out;
      });
      const quiet = got.filter((g) => !(g.hall > -60));
      const shut = quiet.map((g) => `${g.sr} Hz, stop ${g.stop}: the hall stayed shut after the exit (${g.hall} dB)`);
      expect(!quiet.length, shut.join('\n'));
      expect(!errors.length, errors.join('\n'));
      return got;
    } finally {
      await ctx.close();
    }
  },

  async 'named-cues-cannot-carry-a-visit-into-the-next'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const got = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const out = [];
        for (const sr of [44100, 48000]) {
          const c = new OfflineAudioContext(6, sr * 5, sr);
          const eng = new AudioEngine(c);
          const probe = c.createChannelMerger(6);
          probe.connect(c.destination);
          for (const [i, node] of [eng.hushRoom, eng.hushHall].entries()) {
            const stereo = c.createChannelSplitter(2);
            node.connect(stereo);
            stereo.connect(probe, 0, 2 + i * 2);
            stereo.connect(probe, 1, 3 + i * 2);
          }
          eng.schedule([{ t: 0.02, cue: 'reward_chime', opts: { id: 'before' } }], 0);
          for (const at of [1, 3]) {
            eng.quiet(true, SCORE.safeOutSec, at);
            eng.schedule([{ t: 60, cue: 'stand_swell', opts: { id: 'suppressed' } }], 0);
            eng.quiet(false, SCORE.safeBackSec, at + 0.005);
            eng.schedule([{ t: at + 0.5, cue: 'reward_chime', opts: { id: 'outside' } }], 0);
          }
          const rendered = await c.startRendering();
          const db = (pair, from, to) => {
            let energy = 0;
            for (const ch of [pair * 2, pair * 2 + 1]) {
              const samples = rendered.getChannelData(ch);
              for (let i = Math.ceil(from * sr); i < Math.ceil(to * sr); i++) energy += samples[i] ** 2;
            }
            return 10 * Math.log10(energy / (2 * (Math.ceil(to * sr) - Math.ceil(from * sr))));
          };
          for (const at of [1, 3]) {
            for (const [pair, bus] of ['speakers', 'room', 'hall'].entries()) {
              out.push({ sr, at, bus, old: db(pair, at + 0.2, at + 0.45), back: db(pair, at + 0.5, at + 1) });
            }
          }
        }
        return out;
      });
      const failures = [];
      for (const g of got) {
        const at = `${g.sr} Hz, visit ${g.at === 1 ? 1 : 2}, ${g.bus}`;
        if (g.old > -100) failures.push(`${at}: an old cue returned at ${g.old.toFixed(1)} dB`);
        if (!(g.back > -75)) failures.push(`${at}: new sound did not return (${g.back.toFixed(1)} dB)`);
      }
      expect(!failures.length, failures.join('\n'));
      expect(!errors.length, errors.join('\n'));
      return got;
    } finally {
      await ctx.close();
    }
  },

  async 'echo-inputs-fade-in-after-the-visit-stops'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const got = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const out = [];
        for (const sr of [44100, 48000]) {
          for (const stops of [0, 1, 2]) {
            const c = new OfflineAudioContext(4, sr, sr);
            const eng = new AudioEngine(c);
            eng.music.to('calm', 0.05, { at: 0.02 });
            eng.music.scheduleUntil(1);
            eng.quiet(true, SCORE.safeOutSec, 0.2);
            if (stops) eng.stopAll(0.12, 0.202);
            eng.quiet(false, SCORE.safeBackSec, 0.205);
            if (stops === 2) {
              eng.quiet(true, SCORE.safeOutSec, 0.25);
              eng.stopAll(SCORE.safeOutSec, 0.25);
              eng.quiet(false, SCORE.safeBackSec, 0.255);
            }
            const impulse = c.createBuffer(1, 1, sr);
            impulse.getChannelData(0)[0] = 1;
            eng.echo.hall.buffer = impulse;
            const tone = c.createConstantSource();
            tone.connect(eng.echo.sends.sfxHall);
            tone.start(0.205);
            const probe = c.createChannelMerger(4);
            eng.echo.hall.connect(probe, 0, 2);
            probe.connect(c.destination);
            const rendered = await c.startRendering();
            const samples = rendered.getChannelData(2);
            let step = 0;
            for (let i = Math.ceil(0.2 * sr); i < samples.length; i++) {
              step = Math.max(step, Math.abs(samples[i] - samples[i - 1]));
            }
            out.push({ sr, stops, step, end: samples.at(-1), limit: 2 / (sr * SCORE.safeOutSec) });
          }
        }
        return out;
      });
      for (const g of got) {
        expect(g.end > 0.99, `${g.sr} Hz, ${g.stops} stops: the hall never opened (${g.end})`);
        expect(g.step < g.limit,
          `${g.sr} Hz, ${g.stops} stops: the hall opened with a ${g.step} step, above its fade slope ${g.limit}`);
      }
      expect(!errors.length, errors.join('\n'));
      return got;
    } finally {
      await ctx.close();
    }
  },

  async 'unnamed-cues-stay-stopped-after-every-exit'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const got = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const out = [];
        for (const sr of [44100, 48000]) {
          for (const stop of ['quiet', 'stopAll', 'both']) {
            for (const exit of [2.005, 3]) {
              const c = new OfflineAudioContext(6, sr * 5, sr);
              const eng = new AudioEngine(c);
              const probe = c.createChannelMerger(6);
              probe.connect(c.destination);
              for (const [i, node] of [eng.hushRoom, eng.hushHall].entries()) {
                const stereo = c.createChannelSplitter(2);
                node.connect(stereo);
                stereo.connect(probe, 0, 2 + i * 2);
                stereo.connect(probe, 1, 3 + i * 2);
              }
              eng.play('breath_out', { at: 0.02, dur: 6 });
              if (stop !== 'stopAll') eng.quiet(true, SCORE.safeOutSec, 2);
              if (stop !== 'quiet') eng.stopAll(0.12, 2);
              if (stop !== 'stopAll') eng.quiet(false, SCORE.safeBackSec, exit);
              eng.play('reward_chime', { at: 4.2 });
              const rendered = await c.startRendering();
              const db = (pair, from, to) => {
                let energy = 0;
                for (const ch of [pair * 2, pair * 2 + 1]) {
                  const samples = rendered.getChannelData(ch);
                  for (let i = Math.ceil(from * sr); i < Math.ceil(to * sr); i++) energy += samples[i] ** 2;
                }
                return 10 * Math.log10(energy / (2 * (Math.ceil(to * sr) - Math.ceil(from * sr))));
              };
              for (const [pair, bus] of ['speakers', 'room', 'hall'].entries()) {
                out.push({ sr, stop, exit, bus, before: db(pair, 1, 1.5), old: db(pair, 3.1, 4),
                  back: db(pair, 4.2, 4.7) });
              }
            }
          }
        }
        return out;
      });
      const failures = [];
      for (const g of got) {
        const at = `${g.sr} Hz, ${g.stop}, exit at ${g.exit}, ${g.bus}`;
        if (g.bus !== 'room' && !(g.before > -75)) {
          failures.push(`${at}: the cue was inaudible before entry (${g.before} dB)`);
        }
        if (g.old > -100) failures.push(`${at}: an unnamed cue returned at ${g.old.toFixed(1)} dB`);
        if (!(g.back > -75)) failures.push(`${at}: new sound did not return (${g.back.toFixed(1)} dB)`);
      }
      expect(!failures.length, failures.join('\n'));
      expect(!errors.length, errors.join('\n'));
      return got;
    } finally {
      await ctx.close();
    }
  },
};
