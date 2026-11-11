import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { transformWithOxc } from 'vite';

const SILENT_PEAK = 2 ** -15;
const MAIN = '92faca2cc97491d4ce6321c5876667298346b7be';
const git = promisify(execFile);

async function mainEngine(page) {
  for (const name of ['engine', 'echo']) {
    const { stdout } = await git('git', ['show', `${MAIN}:src/audio/${name}.ts`]);
    const { code } = await transformWithOxc(stdout, `src/audio/${name}.ts`, { target: 'es2022' });
    const js = code.replace(/(from\s+['"])(\.\.?\/[^'"]+)/g, (_, prefix, specifier) => {
      const path = specifier === './echo' ? '/__e2e-main/echo.js'
        : `${new URL(specifier, `http://local/src/audio/${name}.ts`).pathname}.ts`;
      return prefix + path;
    });
    await page.route(`**/__e2e-main/${name}.js`, (route) => route.fulfill({
      contentType: 'application/javascript', body: js,
    }));
  }
}

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
        let gate, target, tap, tapSource;
        if (kind === 'echo') {
          e.play('endcard', { at: 0 });
          gate = e.echo.out[1];
          target = e.echo.end?.[1].gain ?? e.hushHall;
          e.stopAll(0.04, at);
          tap = ac.createGain();
          e.volume.disconnect();
          tapSource = target === e.hushHall ? gate : target;
          tapSource.connect(tap).connect(ac.destination);
        } else {
          gate = e.safe;
          target = e.safeEnd?.gain ?? e.volume;
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
          if (tap && tapSource === gate) gate.connect(tap);
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
        e.safe.connect(e.safeEnd?.gain ?? e.volume);
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
      await mainEngine(page);
      const results = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { AudioEngine: MainEngine } = await import('/__e2e-main/engine.js');
        const rate = 48000, results = [];
        for (const ordering of ['deferred', 'after-close', 'no-reopen', 'multiple']) {
          for (const fade of [0.005, 0.04, 0.08, 0.2]) {
            const again = ordering === 'after-close' ? 0.45 : ordering === 'multiple' ? 0.42 : 0.41;
            const end = again + fade, reopen = end + 0.15;
            const render = async (Engine) => {
              const ac = new OfflineAudioContext(1, Math.ceil(rate * 1.4), rate);
              const e = new Engine(ac, { user: { master: 1, music: 0, sfx: 0, muted: false } });
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
              return (await ac.startRendering()).getChannelData(0);
            };
            const data = await render(AudioEngine), main = await render(MainEngine);
            let before = 0, during = 0, closed = 0, reopened = 0, shape = 0, afterReopen = 0;
            for (let i = 0; i < Math.floor(0.39 * rate); i++) before = Math.max(before, Math.abs(data[i]));
            for (let i = Math.ceil((again + fade / 2) * rate); i < Math.floor((again + fade * 0.6) * rate); i++) {
              during = Math.max(during, Math.abs(data[i]));
            }
            for (let i = 0; i < Math.ceil(end * rate); i++) shape = Math.max(shape, Math.abs(data[i] - main[i]));
            for (let i = Math.ceil(end * rate); i < Math.floor(reopen * rate); i++) {
              closed = Math.max(closed, Math.abs(data[i]));
            }
            for (let i = Math.ceil(reopen * rate); i < data.length; i++) {
              afterReopen = Math.max(afterReopen, Math.abs(data[i] - main[i]));
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
        h.expect(r.shape < SILENT_PEAK, `${label}: fade differs from main (${r.shape})`);
        h.expect(r.afterReopen < SILENT_PEAK, `${label}: reopen differs from main (${r.afterReopen})`);
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
