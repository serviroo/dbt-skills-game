// Every fade ends in silence. A sound stopped with a fade (a cue, a bed, the score, the charge hum, everything at once
// on Skip or a replay's reset) keeps its sources running until the fade has fallen below the floor, so the end is never
// a step, and Skip while a fade is still under way ends that fade too. Each fade is rendered offline through the engine at the game's real lengths, beside a twin render that never
// stops, and read where the sounds go into the mix (the beds', score's and effects' inputs, ahead of the echo and the
// limiter). There both renders agree, to within rounding far under the floor, until the stop, so the level just before
// the sources end, against the twin's at the same moment, is how far the fade has fallen (in Chromium, a fade that far
// down has already landed on exact silence: it sets the value to its target past 10 time constants).

// nothing of a sound is heard below -80 dB
const FLOOR_DB = -80;
// the render and its twin agree before the stop to this much under the sound, so the measure reads below the floor
const TWIN_DB = -100;
// how much just before the sources end, and how much after (the stop is final: nothing runs on)
const BEFORE = 0.002;
const AFTER = [0.002, 0.05];
// the fades the game makes, at their lengths (src/app.ts, src/audio/engine.ts, src/audio/events.ts, the director)
// (a cue the engine plays offline is not one it stops with the rest: the cue's own stop stands for it)
const FADES = [
  { name: 'replay: reset', fade: 0.3, start: ['ambient', 'calm', 'charge'], stop: 'reset' },
  { name: 'Skip: stopAll', fade: 'leaveSec', start: ['gate_hum', 'windows', 'charge'], stop: 'stopAll' },
  { name: 'gate hum at the lift into D major', fade: 2.5, start: ['gate_hum'], stop: 'bed' },
  { name: 'vortex roar after the stand', fade: 1.5, start: ['vortex_roar'], stop: 'bed' },
  { name: 'score fading out of a section', fade: 2, start: ['windows'], stop: 'music' },
  { name: 'a cue the cut scene stops', fade: 0.04, start: ['breath_out'], stop: 'cue' },
  { name: 'charge hum cut for the burst', fade: 0.03, start: ['charge'], stop: 'charge' },
  // Skip half a second into a long fade: it ends as Skip ends everything
  { name: 'Skip during the gate hum fading', fade: 2.5, start: ['gate_hum'], stop: 'bed', skip: 0.5 },
  { name: 'Skip during the score fading out', fade: 2, start: ['windows'], stop: 'music', skip: 0.5 },
  { name: 'Skip during the lift into D major', fade: 2.5, start: ['gate_hum', 'aura_bed', 'windows'], stop: 'lift', skip: 0.5 },
  { name: 'Skip just after a replay\'s reset', fade: 0.3, start: ['ambient', 'calm', 'charge'], stop: 'reset', skip: 0.1 },
  { name: 'Skip during a scheduled bed stop', fade: 2.5, start: ['gate_hum'], stop: 'bed_stop', skip: 0.5 },
];
const RATES = [44100, 48000];

export const scenarios = {
  /** every fade has fallen below -80 dB where its sources end, and nothing of it sounds after */
  async 'every-fade-ends-in-silence'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
    const got = await page.evaluate(async ([fades, rates, before, after]) => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { BED_NAMES } = await import('/src/audio/beds.ts');
      const { CUES } = await import('/src/audio/cues.ts');
      const { stoppedBy } = await import('/src/audio/voice.ts');
      const { SCORE } = await import('/src/motion/tokens.ts');
      const T0 = 0.02;
      const AT = 2;
      // the mix's inputs come out on this channel of the render, beside the speakers' two
      const PROBE = 2;
      const render = async (f, sr, fade, stopped) => {
        const len = stoppedBy(AT, fade) + after[1] + 0.1;
        const c = new OfflineAudioContext(4, Math.ceil(len * sr), sr);
        const eng = new AudioEngine(c);
        const probe = c.createChannelMerger(4);
        probe.connect(c.destination);
        for (const n of [eng.bedBus, eng.testInput('music'), eng.testInput('sfx')]) n.connect(probe, 0, PROBE);
        let cue = null;
        let bed = null;
        let charge = null;
        for (const s of f.start) {
          if (BED_NAMES.includes(s)) bed ??= eng.bed(s, { at: T0 });
          else if (CUES[s]) cue = eng.play(s, { at: T0, dur: 6 });
          else if (s === 'charge') charge = eng.chargeLoop({ at: T0 });
          else eng.music.to(s, 0.5, { at: T0 });
        }
        charge?.set(0.6, T0 + 0.5);
        eng.music.scheduleUntil(len);
        if (stopped) {
          if (f.stop === 'reset') eng.reset(fade, AT);
          else if (f.stop === 'stopAll') eng.stopAll(fade, AT);
          else if (f.stop === 'bed') bed.stop(fade, AT);
          else if (f.stop === 'music') eng.music.stop(fade, AT);
          // the score lifting into D major lets the dark world's beds go over `fade` (2.5 s)
          else if (f.stop === 'lift') eng.music.to('reward', 1, { at: AT });
          else if (f.stop === 'bed_stop') eng.schedule([{ t: 0, cue: 'bed_stop', loop: { name: f.start[0] }, opts: { fade } }], AT);
          else if (f.stop === 'cue') cue.stop(AT, fade);
          else charge.stop(AT, fade);
          if (f.skip) eng.stopAll(SCORE.leaveSec, AT + f.skip);
        }
        return (await c.startRendering()).getChannelData(PROBE);
      };
      const rms = (d, a, b) => {
        let s = 0;
        for (let i = a; i < b; i++) s += d[i] * d[i];
        return Math.sqrt(s / (b - a));
      };
      const dB = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
      const out = [];
      for (const sr of rates) {
        for (const f of fades) {
          const fade = typeof f.fade === 'number' ? f.fade : SCORE[f.fade];
          const [cut, twin] = await Promise.all([render(f, sr, fade, true), render(f, sr, fade, false)]);
          // the last sample the sources play: Skip's end, where Skip comes during the fade
          const k = Math.floor((f.skip ? stoppedBy(AT + f.skip, SCORE.leaveSec) : stoppedBy(AT, fade)) * sr) - 1;
          const w = Math.round(before * sr);
          const [a0, a1] = after.map((s) => k + Math.round(s * sr));
          const [b0, b1] = [Math.floor((AT - 1) * sr), Math.floor(AT * sr)];
          let diff = 0;
          for (let i = b0; i < b1; i++) diff += (cut[i] - twin[i]) ** 2;
          out.push({
            name: f.name,
            sr,
            fade,
            level: rms(twin, k - w, k),
            apart: dB(Math.sqrt(diff / (b1 - b0)) / rms(twin, b0, b1)),
            atStop: dB(rms(cut, k - w, k) / rms(twin, k - w, k)),
            after: dB(rms(cut, a0, a1) / rms(twin, a0, a1)),
          });
        }
      }
      return out;
    }, [FADES, RATES, BEFORE, AFTER]);
    expect(got.length === FADES.length * RATES.length, `rendered ${got.length} of ${FADES.length * RATES.length} fades`);
    for (const g of got) {
      const at = `${g.name} (${g.fade} s, ${g.sr} Hz)`;
      expect(g.level > 1e-4, `${at}: the sound is too quiet to measure its fade (${g.level.toExponential(2)})`);
      expect(g.apart < TWIN_DB, `${at}: the render and its twin differ before the stop, at ${g.apart.toFixed(1)} dB`);
      expect(g.atStop < FLOOR_DB, `${at}: still at ${g.atStop.toFixed(1)} dB where its sources end, above ${FLOOR_DB} dB`);
      expect(g.after < FLOOR_DB, `${at}: still sounds at ${g.after.toFixed(1)} dB after its sources end`);
    }
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    const db = (x) => (Number.isFinite(x) ? +x.toFixed(1) : 'silent');
    return Object.fromEntries(got.map((g) => [`${g.name} ${g.sr}`, { atStop: db(g.atStop), after: db(g.after), twin: db(g.apart) }]));
  },

};
