import { renderedAutomation, repeatedTargets } from './audio-automation.mjs';

async function checkAutomation({ open, expect }, render, passes) {
  const { ctx, page, errors } = await open({}, '?lab=audio&mute');
  try {
    await page.waitForFunction(() => window.__lab === true);
    const results = await page.evaluate(render);
    const failed = results.filter((result) => !passes(result));
    expect(!failed.length, JSON.stringify(failed));
    expect(!errors.length, errors.join('\n'));
    return results;
  } finally {
    await ctx.close();
  }
}

export const scenarios = {
  async 'holding-at-a-fade-end-keeps-earlier-samples'(h) {
    return checkAutomation(h, async () => {
      const { trackParam } = await import('/src/audio/curve.ts');
      const { holdAt } = await import('/src/audio/param.ts');
      const sr = 48000;
      const out = [];
      for (const kind of ['set', 'target', 'instant-target', 'set-target', 'target-set']) {
        const c = new OfflineAudioContext(1, 2 * sr, sr);
        const gain = c.createGain();
        gain.connect(c.destination);
        const source = c.createConstantSource();
        source.connect(gain);
        source.start();
        const p = trackParam(gain.gain, c);
        p.setValueAtTime(1, 0);
        p.linearRampToValueAtTime(0, 1);
        if (kind === 'set' || kind === 'set-target') p.setValueAtTime(0.5, 1);
        if (kind !== 'set') p.setTargetAtTime(0.75, 1, kind === 'instant-target' ? 0 : 0.25);
        if (kind === 'target-set') p.setValueAtTime(0.5, 1);
        const held = kind === 'target' ? 0 : kind === 'instant-target' ? 0.75 : 0.5;
        holdAt(p, 1);
        holdAt(p, 1.25);
        const curve = [p.valueAt(0.5), p.valueAt(1), p.valueAt(1.5)];
        const data = (await c.startRendering()).getChannelData(0);
        let earlierError = 0;
        for (let i = 0; i < sr; i++) earlierError = Math.max(earlierError, Math.abs(data[i] - (1 - i / sr)));
        out.push({ kind, held, earlierError, middle: data[sr / 2], at: data[sr], after: data[1.5 * sr], curve });
      }
      return out;
    }, (r) => r.earlierError < 1e-6 && Math.abs(r.middle - 0.5) < 1e-6
      && [r.at, r.after, ...r.curve.slice(1)].every((value) => Math.abs(value - r.held) < 1e-6)
      && Math.abs(r.curve[0] - 0.5) < 1e-6);
  },

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

  async 'tracked-values-match-the-rendered-automation'(h) {
    return checkAutomation(h, renderedAutomation, (r) => !r.outsideSample.length
      && (r.held === undefined || Math.abs(r.actual - r.held) <= 1e-6));
  },

  async 'tracked-values-match-rendering-within-float-precision'(h) {
    return checkAutomation(h, repeatedTargets, (r) => r.maxRelativeError < 1e-3
      && r.holds.every((hold) => hold.relativeStep < 1e-3)
      && r.retained <= 2 && r.compactionError === 0);
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
