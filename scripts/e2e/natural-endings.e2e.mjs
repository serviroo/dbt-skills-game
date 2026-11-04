const FLOOR_DB = -80;
const STEP_SEC = 0.002;
const PUSH = 2;
const SECTION_SEC = { silhouette: 15 };
const ANY_SEC = 10;
const HIT = 4;
const HIT_SEC = 20;

export const scenarios = {
  async 'nothing-is-cut-while-audible'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
    const got = await page.evaluate(async ([push, sectionSec, anySec, hit, hitSec, step]) => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { CUES } = await import('/src/audio/cues.ts');
      const { SECTIONS } = await import('/src/audio/music.ts');
      const sr = 44100;
      const PROBE = 2;
      const render = async (play, len, uncut) => {
        const c = new OfflineAudioContext(4, Math.ceil(len * sr), sr);
        const eng = new AudioEngine(c);
        const probe = c.createChannelMerger(4);
        probe.connect(c.destination);
        for (const n of [eng.bedBus, eng.testInput('music'), eng.testInput('sfx')]) n.connect(probe, 0, PROBE);
        const stop = AudioScheduledSourceNode.prototype.stop;
        if (uncut) {
          AudioScheduledSourceNode.prototype.stop = function (when = 0) {
            return stop.call(this, when + push);
          };
        }
        try {
          play(eng, len);
        } finally {
          AudioScheduledSourceNode.prototype.stop = stop;
        }
        return (await c.startRendering()).getChannelData(PROBE);
      };
      const w = Math.round(step * sr);
      const loud = Math.round(0.05 * sr);
      const worst = async (play, len) => {
        const [cut, uncut] = await Promise.all([render(play, len, false), render(play, len, true)]);
        let peak = 0;
        for (let i = 0; i + loud <= cut.length; i += loud >> 1) {
          let s = 0;
          for (let j = i; j < i + loud; j++) s += uncut[j] * uncut[j];
          peak = Math.max(peak, Math.sqrt(s / loud));
        }
        let most = 0, at = 0;
        for (let i = 0; i + w <= cut.length; i += w) {
          let s = 0;
          for (let j = i; j < i + w; j++) s += (uncut[j] - cut[j]) ** 2;
          if (s > most) [most, at] = [s, i / sr];
        }
        return { cut: most ? 20 * Math.log10(Math.sqrt(most / w) / peak) : -Infinity, at: +at.toFixed(3), peak };
      };
      const out = {};
      for (const cue of Object.keys(CUES)) {
        const end = new AudioEngine(new OfflineAudioContext(1, 1, sr)).play(cue, { at: 0.02 }).end;
        out[`cue ${cue}`] = await worst((eng) => eng.play(cue, { at: 0.02 }), end + 0.5);
      }
      for (const s of SECTIONS) {
        out[`score ${s}`] = await worst((eng, len) => {
          eng.music.to(s, 0.5, { at: 0.02 });
          eng.music.scheduleUntil(len);
        }, sectionSec[s] ?? anySec);
      }
      out['score awaken through its hit and stand'] = await worst((eng, len) => {
        eng.music.to('awaken', 0.5, { at: 0.02, hitAt: 0.02 + hit });
        eng.music.scheduleUntil(len);
      }, hitSec);
      return out;
    }, [PUSH, SECTION_SEC, ANY_SEC, HIT, HIT_SEC, STEP_SEC]);
    const sounds = Object.entries(got).filter(([, g]) => g.peak > 0);
    expect(sounds.length > 30, `only ${sounds.length} sounds rendered`);
    const loud = sounds.filter(([, g]) => !(g.cut < FLOOR_DB));
    const cuts = loud.map(([n, g]) => `${n} at ${g.at} s (${g.cut.toFixed(1)} dB)`);
    expect(!loud.length, 'cut off while still audible: ' + cuts.join(', '));
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return Object.fromEntries(sounds.map(([n, g]) => [n, Number.isFinite(g.cut) ? +g.cut.toFixed(1) : 'nothing cut']));
  },
};
