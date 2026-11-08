import { renderedAutomation, repeatedTargets, rejectedAutomation } from './audio-automation.mjs';
import { renderedBusDips, renderedHorizonCollisions } from './bus-stop-automation.mjs';

async function checkAutomation({ open, expect }, render, passes, input) {
  const { ctx, page, errors } = await open({}, '?lab=audio&mute');
  try {
    await page.waitForFunction(() => window.__lab === true);
    const results = await page.evaluate(render, input);
    const failed = results.filter((result) => !passes(result));
    expect(!failed.length, JSON.stringify(failed));
    expect(!errors.length, errors.join('\n'));
    return results;
  } finally {
    await ctx.close();
  }
}

const staysDipped = (r) => r.rise < 1e-6 && r.held > 0.1 && Math.abs(r.end - r.last) < 1e-4;

export const scenarios = {
  async 'skip-keeps-a-later-duck-dip-falling'(h) {
    return checkAutomation(h, renderedBusDips, staysDipped, ['duckG']);
  },

  async 'skip-keeps-every-later-bus-dip-falling'(h) {
    return checkAutomation(h, renderedBusDips, staysDipped);
  },

  async 'skip-merges-level-changes-at-the-silence-horizon'(h) {
    return checkAutomation(h, renderedHorizonCollisions,
      (r) => !r.error && r.dipKept && r.rise < 1e-6 && Math.abs(r.end - r.expected) < 1e-6);
  },

  async 'held-buses-keep-targets-before-linear-fades'(h) {
    return checkAutomation(h, async () => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const sr = 48000;
      const render = async (held) => {
        const c = new OfflineAudioContext(1, 3 * sr, sr);
        const eng = new AudioEngine(c, { volume: 0 });
        const gain = eng.safe;
        gain.disconnect();
        gain.connect(c.destination);
        const source = c.createConstantSource();
        source.connect(gain);
        source.start();
        eng.busLevels.set(gain.curve, 0.5, 0.5, 0.1);
        eng.busLevels.ramp(gain.curve, 0, 1, 2);
        if (held) eng.busLevels.hold(0.25, 2.5);
        return (await c.startRendering()).getChannelData(0);
      };
      const twin = await render(false);
      const held = await render(true);
      let error = 0;
      for (let i = 0; i < twin.length; i++) error = Math.max(error, Math.abs(twin[i] - held[i]));
      return [{ error, middle: held[0.75 * sr], expected: 0.5 + 0.5 * Math.exp(-2.5), end: held[2 * sr] }];
    }, (r) => r.error < 1e-6 && Math.abs(r.middle - r.expected) < 1e-6 && r.end === 0);
  },

  async 'quick-safe-zone-exits-never-raise-a-fading-gate'(h) {
    return checkAutomation(h, async () => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { stoppedBy } = await import('/src/audio/voice.ts');
      const sr = 48000;
      const hold = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'cancelAndHoldAtTime');
      const out = [];
      for (const firefox of [false, true]) {
        if (firefox) delete AudioParam.prototype.cancelAndHoldAtTime;
        try {
          const c = new OfflineAudioContext(1, 8 * sr, sr);
          const eng = new AudioEngine(c, { volume: 0 });
          eng.bed('gate_hum', { at: 0, level: 0 });
          const gain = eng.safe;
          gain.disconnect();
          gain.connect(c.destination);
          const source = c.createConstantSource();
          source.connect(gain);
          source.start();
          eng.quiet(true, 1, 1);
          eng.stopAll(1, 1);
          eng.quiet(false, 1, 1.005);
          const data = (await c.startRendering()).getChannelData(0);
          const first = Math.round(1.005 * sr);
          const end = Math.floor(stoppedBy(1, 1) * sr);
          let rise = 0;
          let low = data[first - 1];
          for (let i = first; i < end; i++) {
            low = Math.min(low, data[i - 1]);
            rise = Math.max(rise, data[i] - low);
          }
          out.push({ firefox, rise, held: data[first], end: data[end - 1], restored: data.at(-1) });
        } finally {
          if (hold) Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', hold);
        }
      }
      return out;
    }, (r) => r.rise < 1e-6 && Math.abs(r.held - 0.995) < 1e-6 && r.end === 0 && r.restored > 0.99);
  },

  async 'holding-keeps-a-falling-fade-on-its-line'(h) {
    return checkAutomation(h, async () => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const sr = 48000;
      const hold = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'cancelAndHoldAtTime');
      const out = [];
      for (const firefox of [false, true]) {
        if (firefox) delete AudioParam.prototype.cancelAndHoldAtTime;
        try {
          const cases = [[1, 2, 1.2, 1.5], [1.05, 1.065, 1.05, 1.057], [1.05, 1.065, 1.05, 1.065]];
          for (const [from, to, at, until] of cases) {
            const c = new OfflineAudioContext(1, 3 * sr, sr);
            const eng = new AudioEngine(c, { volume: 0 });
            const gain = eng.safe;
            gain.disconnect();
            gain.connect(c.destination);
            const source = c.createConstantSource();
            source.connect(gain);
            source.start();
            eng.busLevels.ramp(gain.curve, 0, from, to);
            eng.busLevels.hold(at, until);
            const data = (await c.startRendering()).getChannelData(0);
            let off = 0;
            for (let i = Math.ceil(at * sr); i < Math.ceil(to * sr); i++) {
              off = Math.max(off, Math.abs(data[i] - (to - i / sr) / (to - from)));
            }
            out.push({ firefox, from, to, at, until, off, end: data.at(-1) });
          }
        } finally {
          if (hold) Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', hold);
        }
      }
      return out;
    }, (r) => r.off < 1e-4 && r.end === 0);
  },

  async 'holding-at-a-fade-end-keeps-earlier-samples'(h) {
    return checkAutomation(h, async () => {
      const { trackParam } = await import('/src/audio/curve.ts');
      const { holdAt } = await import('/src/audio/param.ts');
      const sr = 48000;
      const out = [];
      for (const kind of ['set', 'target', 'instant-target', 'set-target']) {
        const c = new OfflineAudioContext(1, 2 * sr, sr);
        const gain = c.createGain();
        gain.connect(c.destination);
        const source = c.createConstantSource();
        source.connect(gain);
        source.start();
        const p = trackParam(gain.gain, c, 1);
        p.setValueAtTime(1, 0);
        p.linearRampToValueAtTime(0, 1);
        if (kind === 'set' || kind === 'set-target') p.setValueAtTime(0.5, 1);
        if (kind !== 'set') p.setTargetAtTime(0.75, 1, kind === 'instant-target' ? 0 : 0.25);
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

  async 'held-fades-keep-their-curve'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true);
      const results = await page.evaluate(async () => {
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
      && Number.isFinite(r.error) && r.error <= r.maxStep + 2e-7
      && (r.held === undefined || Math.abs(r.actual - r.held) <= 1e-6));
  },

  async 'unsupported-automation-throws-before-changing-the-curve'(h) {
    return checkAutomation(h, rejectedAutomation, (r) => r.rejected && r.unchanged && r.error < 1e-5);
  },

  async 'tracked-values-match-rendering-within-float-precision'(h) {
    return checkAutomation(h, repeatedTargets, (r) => r.maxRelativeError < 1e-3
      && r.holds.every((hold) => hold.relativeStep < 1e-3)
      && r.evaluationWork <= 2 && r.compactionError === 0);
  },

  async 'tracking-requires-a-known-start-and-one-owner'(h) {
    return checkAutomation(h, async () => {
      const { trackParam, trackedGain } = await import('/src/audio/curve.ts');
      const c = new OfflineAudioContext(1, 48000, 48000);
      const gain = c.createGain();
      gain.gain.setTargetAtTime(0, 0.1, 0.25);
      const rejected = (run) => {
        try {
          run();
          return false;
        } catch (error) {
          return error instanceof Error;
        }
      };
      const missing = rejected(() => trackParam(gain.gain, c));
      const owned = trackedGain(c, 0.5);
      owned.curve.linearRampToValueAtTime(0, 1);
      const duplicate = rejected(() => trackParam(owned.gain, c, 1));
      return [{ missing, duplicate, middle: owned.curve.valueAt(0.5) }];
    }, (r) => r.missing && r.duplicate && r.middle === 0.25);
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
        eng.setUser({ master: 1, music: 0.5, sfx: 0.75, muted: false }, 4);
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
