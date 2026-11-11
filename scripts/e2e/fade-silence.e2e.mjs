const SILENT_PEAK = 2 ** -15;

async function missedFadeBlocks(h, kind) {
  const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
  try {
    await page.waitForFunction(() => window.__lab === true);
    const result = await page.evaluate(async (kind) => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const rate = 96000, q = 128, endFrame = 330 * q - 1;
      const end = endFrame / rate, at = end - 0.04;
      const run = async (miss) => {
        const ac = new OfflineAudioContext(2, Math.ceil(rate * 1.4), rate);
        const e = new AudioEngine(ac, { user: { master: 1, music: 0, sfx: 1, muted: false } });
        let gate, target;
        if (kind === 'echo') {
          e.play('endcard', { at: 0 });
          gate = e.echo.out[1];
          target = e.echo.endpointGates[1].gain;
          e.stopAll(0.04, at);
          const tap = ac.createGain();
          e.volume.disconnect();
          target.connect(tap).connect(ac.destination);
        } else {
          gate = e.safe;
          target = e.safeEndpointGate.gain;
          const source = ac.createConstantSource();
          source.offset.value = 0.5;
          source.connect(gate);
          source.start(0);
          e.quiet(true, 0.04, at);
        }
        const first = Math.floor(end * rate / q) * q;
        const next = (Math.ceil(end * rate / q) + 2) * q;
        const before = ac.suspend(first / rate), after = ac.suspend(next / rate);
        const rendering = ac.startRendering();
        await before;
        if (miss) gate.disconnect();
        await ac.resume();
        await after;
        if (miss) {
          gate.connect(target);
        }
        const resumed = ac.resume();
        const stop = performance.now() + 250;
        while (performance.now() < stop) {}
        await resumed;
        const audio = await rendering;
        let peak = 0, beforePeak = 0;
        for (let ch = 0; ch < audio.numberOfChannels; ch++) {
          const samples = audio.getChannelData(ch);
          for (let i = Math.floor((end - 0.012) * rate); i < first; i++) {
            beforePeak = Math.max(beforePeak, Math.abs(samples[i]));
          }
          for (let i = endFrame; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
        }
        return { peak, beforePeak };
      };
      return { control: await run(false), missed: await run(true) };
    }, kind);
    for (const [name, out] of Object.entries(result)) {
      h.expect(out.beforePeak > SILENT_PEAK, `${kind}: ${name} had no signal before the fade ended`);
      h.expect(out.peak < SILENT_PEAK, `${kind}: ${name} sounded after the fade ended (peak ${out.peak})`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return result;
  } finally {
    await ctx.close();
  }
}

async function reopenedGateAfterSkippedBlocks(h) {
  const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
  try {
    await page.waitForFunction(() => window.__lab === true);
    const results = await page.evaluate(async () => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const rate = 44100, q = 128, at = 0.4, end = at + 0.04;
      const out = [];
      for (const gap of [0.005, 0.1]) {
        const ac = new OfflineAudioContext(1, rate, rate);
        const e = new AudioEngine(ac);
        const source = ac.createConstantSource();
        source.offset.value = 0.5;
        source.connect(e.safe);
        source.start(0);
        e.quiet(true, 0.04, at);
        e.quiet(false, 0.2, at + gap);
        const first = Math.floor(end * rate / q) * q;
        const next = (Math.ceil(end * rate / q) + 2) * q;
        const before = ac.suspend(first / rate), after = ac.suspend(next / rate);
        const rendering = ac.startRendering();
        await before;
        e.safe.disconnect();
        await ac.resume();
        await after;
        e.safe.connect(e.safeEndpointGate.gain);
        await ac.resume();
        const data = (await rendering).getChannelData(0);
        let closed = 0, reopened = 0;
        for (let i = Math.ceil(end * rate); i < Math.floor((at + gap) * rate); i++) {
          closed = Math.max(closed, Math.abs(data[i]));
        }
        for (let i = Math.ceil(0.8 * rate); i < data.length; i++) {
          reopened = Math.max(reopened, Math.abs(data[i]));
        }
        out.push({ gap, closed, reopened, afterGap: Math.abs(data[Math.ceil(0.46 * rate)]) });
      }
      return out;
    });
    for (const r of results) {
      h.expect(r.reopened > 0.49, 'the Safe Zone gate did not reopen after skipped blocks');
      if (r.gap > 0.04) h.expect(r.closed < SILENT_PEAK, 'the Safe Zone gate reopened before leaving');
      else h.expect(r.afterGap > 0.4, 'cancelling a close silenced the reopened gate');
    }
    h.expect(!errors.length, errors.join('\n'));
    return results;
  } finally {
    await ctx.close();
  }
}

export const scenarios = {
  async 'pending-echo-cannot-reopen-after-stop'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const result = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const rate = 96000, q = 128, at = 0.41, end = at + 0.005;
        const run = async (close) => {
          const ac = new OfflineAudioContext(1, Math.ceil(rate * 1.2), rate);
          const e = new AudioEngine(ac);
          e.play('endcard', { at: 0 });
          e.quiet(true, 0.04, 0.4);
          e.quiet(false, 0.2, 0.405);
          const echo = e.echo, start = e.stoppedUntil;
          const endpoint = echo.endpointGates[1].gain, output = echo.out[1];
          const source = ac.createConstantSource();
          source.offset.value = 0.5;
          source.connect(output);
          source.start(0);
          e.volume.disconnect();
          endpoint.connect(ac.destination);
          if (close) e.stopAll(0.005, at);
          const first = Math.floor(end * rate / q) * q;
          const next = (Math.ceil(end * rate / q) + 2) * q;
          if (close) {
            const before = ac.suspend(first / rate), after = ac.suspend(next / rate);
            const rendering = ac.startRendering();
            await before;
            output.disconnect();
            await ac.resume();
            await after;
            output.connect(endpoint);
            const resumed = ac.resume(), until = performance.now() + 250;
            while (performance.now() < until) {}
            await resumed;
            const data = (await rendering).getChannelData(0);
            let peak = 0;
            for (let i = Math.ceil(start * rate); i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
            return { start, peak };
          }
          const data = (await ac.startRendering()).getChannelData(0);
          let peak = 0;
          for (let i = Math.ceil(start * rate); i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
          return { start, peak };
        };
        return { control: await run(false), closed: await run(true), end };
      });
      h.expect(result.closed.start > result.end, 'the echo did not have a pending start after the stop');
      h.expect(result.control.peak > 0.1, `the pending echo had no signal (${result.control.peak})`);
      h.expect(result.closed.peak < SILENT_PEAK, `the stopped pending echo sounded (${result.closed.peak})`);
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally {
      await ctx.close();
    }
  },
  async 'late-close-silences-from-submission'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const result = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const rate = 48000, q = 128, at = 0.2, end = at + 0.005;
        const ac = new OfflineAudioContext(1, rate, rate);
        const e = new AudioEngine(ac);
        const source = ac.createConstantSource();
        source.offset.value = 0.5;
        source.connect(e.safeEndpointGate.gain);
        source.start(0);
        const first = Math.ceil(0.3 * rate / q) * q;
        const before = ac.suspend(first / rate);
        const rendering = ac.startRendering();
        await before;
        const submitted = ac.currentTime;
        e.quiet(true, 0.005, at);
        await ac.resume();
        const data = (await rendering).getChannelData(0);
        let prior = 0, later = 0;
        for (let i = Math.ceil(0.27 * rate); i < first; i++) prior = Math.max(prior, Math.abs(data[i]));
        for (let i = first; i < data.length; i++) later = Math.max(later, Math.abs(data[i]));
        return { end, submitted, prior, later };
      });
      h.expect(result.submitted > result.end, 'the close was not submitted after its endpoint');
      h.expect(result.prior > 0.1, `the input had no signal before submission (${result.prior})`);
      h.expect(result.later < SILENT_PEAK, `sound continued after the late close (${result.later})`);
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally {
      await ctx.close();
    }
  },
  async 'endpoint-gate-sources-clean-up'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const result = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const ac = new AudioContext(), live = new Set();
        const make = ac.createConstantSource.bind(ac);
        let created = 0, disconnected = 0;
        ac.createConstantSource = () => {
          const node = make(), connect = node.connect.bind(node), disconnect = node.disconnect.bind(node);
          node.connect = (target) => {
            if (target instanceof AudioParam && !live.has(node)) {
              live.add(node);
              created++;
            }
            return connect(target);
          };
          node.disconnect = () => {
            if (live.delete(node)) disconnected++;
            return disconnect();
          };
          return node;
        };
        const e = new AudioEngine(ac, { muted: true });
        try {
          await ac.resume();
          const counts = [];
          for (let i = 0; i < 12; i++) {
            const at = ac.currentTime + 0.005;
            e.quiet(true, 0.01, at);
            e.quiet(false, 0.02, at + 0.025);
            e.stopAll(0.01, at + 0.04);
            while (ac.currentTime < at + 0.2) await new Promise((done) => setTimeout(done, 10));
            if (i === 2 || i === 11) counts.push(live.size);
          }
          return { counts, created, disconnected };
        } finally {
          await ac.close();
          e.dispose();
        }
      });
      h.expect(result.created >= 40, `too few gate sources were exercised (${result.created})`);
      h.expect(result.disconnected >= 30, `gate sources were not disconnected (${result.disconnected})`);
      h.expect(result.counts.every((n) => n <= 5), `live gate sources grew (${result.counts})`);
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally {
      await ctx.close();
    }
  },
  async 'safe-zone-repeat-close-stays-silent'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const rate = 48000, results = [];
        for (const ordering of ['deferred', 'after-close', 'no-reopen', 'multiple']) {
          for (const fade of [0.005, 0.04, 0.08, 0.2]) {
            const again = ordering === 'after-close' ? 0.45 : ordering === 'multiple' ? 0.42 : 0.41;
            const end = again + fade, reopen = end + 0.15;
            const render = async () => {
              const ac = new OfflineAudioContext(1, Math.ceil(rate * 1.4), rate);
              const e = new AudioEngine(ac, { user: { master: 1, music: 0, sfx: 0, muted: false } });
              const source = ac.createConstantSource();
              source.offset.value = 0.5;
              source.connect(e.safe);
              source.start(0);
              e.play('endcard', { at: 0 });
              e.quiet(true, 0.04, 0.4);
              if (ordering === 'multiple') {
                e.quiet(false, 0.2, 0.405);
                e.quiet(true, 0.08, 0.41);
                e.quiet(false, 0.2, 0.415);
              } else if (ordering !== 'no-reopen') {
                e.quiet(false, 0.2, ordering === 'deferred' ? 0.405 : 0.445);
              }
              e.quiet(true, fade, again);
              e.quiet(false, 0.2, reopen);
              const expected = new Float32Array(ac.length);
              for (let i = 0; i < expected.length; i++) expected[i] = 0.5 * e.safe.curve.valueAt(i / rate);
              return { data: (await ac.startRendering()).getChannelData(0), expected };
            };
            const { data, expected } = await render();
            let before = 0, during = 0, closed = 0, reopened = 0, shape = 0, afterReopen = 0;
            for (let i = 0; i < Math.floor(0.39 * rate); i++) before = Math.max(before, Math.abs(data[i]));
            for (let i = Math.ceil((again + fade / 2) * rate); i < Math.floor((again + fade * 0.6) * rate); i++) {
              during = Math.max(during, Math.abs(data[i]));
            }
            for (let i = 0; i < Math.ceil(end * rate); i++) {
              shape = Math.max(shape, Math.abs(data[i] - expected[i]));
            }
            for (let i = Math.ceil(end * rate); i < Math.floor(reopen * rate); i++) {
              closed = Math.max(closed, Math.abs(data[i]));
            }
            for (let i = Math.ceil(reopen * rate); i < data.length; i++) {
              afterReopen = Math.max(afterReopen, Math.abs(data[i] - expected[i]));
            }
            for (let i = Math.ceil((reopen + 0.3) * rate); i < data.length; i++) {
              reopened = Math.max(reopened, Math.abs(data[i]));
            }
            results.push({ ordering, fade, before, during, closed, reopened, shape, afterReopen });
          }
        }
        return results;
      });
      for (const r of results) {
        const label = `${r.ordering}, ${r.fade}s`;
        h.expect(r.before > 0.1, `${label}: no sound before closing (${r.before})`);
        if (r.ordering === 'no-reopen' && r.fade >= 0.08) {
          h.expect(r.during > 0.05, `${label}: the longer fade stopped early (${r.during})`);
        }
        h.expect(r.shape < SILENT_PEAK, `${label}: fade differs from its curve (${r.shape})`);
        h.expect(r.afterReopen < SILENT_PEAK, `${label}: reopen differs from its curve (${r.afterReopen})`);
        h.expect(r.closed < SILENT_PEAK, `${label}: sound after closing (${r.closed})`);
        h.expect(r.reopened > 0.1, `${label}: no sound after reopening (${r.reopened})`);
      }
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally {
      await ctx.close();
    }
  },
  async 'echo-stays-quiet-through-skipped-blocks'(h) {
    return missedFadeBlocks(h, 'echo');
  },
  async 'safe-zone-reopens-after-skipped-blocks'(h) {
    return reopenedGateAfterSkippedBlocks(h);
  },
  async 'safe-zone-stays-quiet-through-skipped-blocks'(h) {
    return missedFadeBlocks(h, 'safe');
  },
};
