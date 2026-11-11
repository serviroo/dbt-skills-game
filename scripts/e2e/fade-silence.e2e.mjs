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
        let gate, target, tap;
        if (kind === 'echo') {
          e.play('endcard', { at: 0 });
          gate = e.echo.out[1];
          target = e.hushHall;
          e.stopAll(0.04, at);
          tap = ac.createGain();
          e.volume.disconnect();
          gate.connect(tap).connect(ac.destination);
        } else {
          gate = e.safe;
          target = e.volume;
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
          if (tap) gate.connect(tap);
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
        e.safe.connect(e.volume);
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
  async 'safe-zone-repeat-close-stays-silent'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const rate = 48000, results = [];
        for (const ordering of ['deferred', 'after-close', 'no-reopen', 'multiple']) {
          for (const fade of [0.005, 0.04, 0.08]) {
            const ac = new OfflineAudioContext(1, rate, rate);
            const e = new AudioEngine(ac);
            const source = ac.createConstantSource();
            source.offset.value = 0.5;
            source.connect(e.safe);
            source.start(0);
            e.play('endcard', { at: 0 });
            e.quiet(true, 0.04, 0.4);
            const again = ordering === 'after-close' ? 0.45 : ordering === 'multiple' ? 0.42 : 0.41;
            if (ordering === 'multiple') {
              e.quiet(false, 0.2, 0.405);
              e.quiet(true, 0.08, 0.41);
              e.quiet(false, 0.2, 0.415);
            } else if (ordering !== 'no-reopen') {
              e.quiet(false, 0.2, ordering === 'deferred' ? 0.405 : 0.445);
            }
            e.quiet(true, fade, again);
            const end = again + fade, reopen = end + 0.15;
            e.quiet(false, 0.2, reopen);
            const data = (await ac.startRendering()).getChannelData(0);
            let before = 0, closed = 0, reopened = 0;
            for (let i = 0; i < Math.floor(0.39 * rate); i++) before = Math.max(before, Math.abs(data[i]));
            for (let i = Math.ceil(end * rate); i < Math.floor(reopen * rate); i++) {
              closed = Math.max(closed, Math.abs(data[i]));
            }
            for (let i = Math.ceil((reopen + 0.3) * rate); i < data.length; i++) {
              reopened = Math.max(reopened, Math.abs(data[i]));
            }
            results.push({ ordering, fade, before, closed, reopened });
          }
        }
        return results;
      });
      for (const r of results) {
        const label = `${r.ordering}, ${r.fade}s`;
        h.expect(r.before > 0.1, `${label}: no sound before closing (${r.before})`);
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
