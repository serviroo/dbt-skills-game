import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const scenarios = {
  async 'audio-moments-match-main-by-target'(h) {
    const baseDir = path.join(h.out, 'audio-main');
    fs.mkdirSync(baseDir, { recursive: true });
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim();
    const archive = execFileSync('git', ['archive', base, 'src'], { maxBuffer: 100 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', baseDir], { input: archive });
    const baseUrl = `/${path.relative(process.cwd(), path.join(baseDir, 'src/audio/engine.ts'))}`;
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      const results = await page.evaluate(async (url) => {
        const base = await import(url);
        const current = await import('/src/audio/engine.ts');
        const { recordAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const actions = {
          section(e) { e.music.to('intro', 0.04, { at: 0.1 }); e.music.to('windows', 0.04, { at: 0.7 }); },
          sectionNow(e) { e.music.to('intro', 0.04); e.music.to('windows', 0.04); },
          bedsLift(e) {
            e.bed('gate_hum', { at: 0.1 });
            e.bed('aura_bed', { at: 0.1 });
            e.music.to('intro', 0.04, { at: 0.1 });
            e.play('ui_open', { at: 0.2, detune: 500 });
            e.music.to('reward', 0.3, { at: 0.7 });
          },
          timedHush(e) { e.hush(0.1, 0.88); },
          openHush(e) { e.hush(0.1); },
          repeatedHush(e) { e.hush(0.1); e.hush(0.4, 1.18); },
          unhush(e) { e.hush(0.1); e.unhush(0.7); },
          awakenHush(e) { e.music.to('awaken', 0.04, { at: 0.1 }); e.hush(0.7, 1.48); },
          stopAll(e) { e.bed('ambient', { at: 0.1 }); e.hush(0.4); e.stopAll(0.7); },
        };
        const jobs = [
          ...base.CUE_NAMES.map((cue) => ({ name: `cue:${cue}`, events: [{ t: 0.1, cue }] })),
          ...base.BED_NAMES.map((cue) => ({ name: `bed:${cue}`,
            events: [{ t: 0.1, cue, loop: { name: cue, until: 2 } }] })),
          ...base.SECTIONS.map((section) => ({ name: `section:${section}`,
            events: [{ t: 0.1, cue: 'music', opts: { section, fade: 0.3 } }] })),
          { name: 'hush', events: [{ t: 0.1, cue: 'hush', opts: { until: 0.88 } }] },
        ];
        const capture = async (mod, action, live) => {
          const clock = live ? new AudioContext({ latencyHint: 'interactive' })
            : new OfflineAudioContext(2, 48000, 48000);
          if (live) await clock.suspend();
          const tap = recordAudioSchedule(clock);
          const engine = new mod.AudioEngine(clock, { seed: 20261020, stats: true });
          action(engine);
          tap.stop();
          const groups = {};
          for (const call of tap.calls) (groups[call.target] ??= []).push([call.method, call.values]);
          const spans = engine.spans.map((s) => [s.a, s.b]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          if (live) await clock.close();
          engine.dispose();
          return { groups, spans };
        };
        const out = [];
        const compare = async (name, action, live) => {
          const a = await capture(base, action, live);
          const b = await capture(current, action, live);
          const keys = [...new Set([...Object.keys(a.groups), ...Object.keys(b.groups)])];
          const differences = keys.filter((key) => JSON.stringify(a.groups[key]) !== JSON.stringify(b.groups[key]));
          const sources = Object.entries(b.groups).filter(([key]) => /(?:Oscillator|BufferSource)Node$/.test(key));
          const badSources = sources.filter(([, calls]) => {
            const start = calls.findIndex(([method]) => method === 'start');
            return calls.some(([method], i) => method === 'stop' && (start < 0 || i < start));
          }).map(([key]) => key);
          const hushSources = name === 'live:timedHush' ? sources.filter(([, calls]) =>
            calls.some(([method, args]) => method === 'stop' && args[0] > 100)) : [];
          const finalStops = hushSources.map(([key, calls]) => ({ key,
            time: calls.filter(([method]) => method === 'stop').at(-1)?.[1][0] }));
          out.push({ name, targets: keys.length, badSources, finalStops,
            spansMatch: JSON.stringify(a.spans) === JSON.stringify(b.spans),
            differences: differences.slice(0, 4)
              .map((key) => ({ key, main: a.groups[key], current: b.groups[key] })) });
        };
        for (const job of jobs) {
          await compare(`offline:${job.name}`, (e) => {
            e.schedule(job.events, 0);
            e.music.scheduleUntil(5);
          }, false);
        }
        for (const [name, action] of Object.entries(actions)) await compare(`live:${name}`, action, true);
        return out;
      }, baseUrl);
      h.expect(results.length === 48 && results.every((r) => r.spansMatch && !r.differences.length
        && !r.badSources.length), JSON.stringify(results.filter((r) => !r.spansMatch || r.differences.length
        || r.badSources.length)));
      const hush = results.find((r) => r.name === 'live:timedHush');
      h.expect(hush.finalStops.length === 2 && hush.finalStops.every((s) => s.time > 0.9 && s.time < 1),
        `hush source stops: ${JSON.stringify(hush.finalStops)}`);
      h.expect(!errors.length, errors.join('\n'));
      return results.map(({ name, targets }) => ({ name, targets }));
    } finally {
      await ctx.close();
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  },
};
