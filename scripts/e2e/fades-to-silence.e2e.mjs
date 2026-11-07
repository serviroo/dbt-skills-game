const FLOOR_DB = -80;
const TWIN_DB = -100;
const BEFORE = 0.002;
const AFTER = [0.002, 0.05];
const FADES = [
  { name: 'replay: reset', fade: 0.3, start: ['ambient', 'calm', 'charge'], stop: 'reset' },
  { name: 'Skip: stopAll', fade: 'leaveSec', start: ['gate_hum', 'windows', 'charge'], stop: 'stopAll' },
  { name: 'gate hum at the lift into D major', fade: 2.5, start: ['gate_hum'], stop: 'bed' },
  { name: 'vortex roar after the stand', fade: 1.5, start: ['vortex_roar'], stop: 'bed' },
  { name: 'score fading out of a section', fade: 2, start: ['windows'], stop: 'music' },
  { name: 'a cue the cut scene stops', fade: 0.04, start: ['breath_out'], stop: 'cue' },
  { name: 'charge hum cut for the burst', fade: 0.03, start: ['charge'], stop: 'charge' },
  { name: 'Skip during the gate hum fading', fade: 2.5, start: ['gate_hum'], stop: 'bed', skip: 0.5 },
  { name: 'Skip during the score fading out', fade: 2, start: ['windows'], stop: 'music', skip: 0.5 },
  {
    name: 'Skip during the lift into D major',
    fade: 2.5,
    start: ['gate_hum', 'aura_bed', 'windows'],
    stop: 'lift',
    skip: 0.5,
  },
  {
    name: "Skip just after a replay's reset",
    fade: 0.3,
    start: ['ambient', 'calm', 'charge'],
    stop: 'reset',
    skip: 0.1,
  },
  { name: 'Skip during a scheduled bed stop', fade: 2.5, start: ['gate_hum'], stop: 'bed_stop', skip: 0.5 },
  {
    name: "the Safe Zone in and out during a replay's reset",
    fade: 0.3,
    start: ['charge'],
    stop: 'reset',
    quiet: 0.02,
  },
];
const RATES = [44100, 48000];

export const scenarios = {
  async 'safe-zone-offline-leaves-no-old-sound'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const got = await page.evaluate(async (rates) => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { stoppedBy } = await import('/src/audio/voice.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const { recordAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
        const entry = 2;
        const gaps = [0.005, 0.02, 1];
        const duration = entry + Math.max(...gaps) + SCORE.safeBackSec + 1;
        const out = [];
        for (const sr of rates) {
          for (const name of ['bed', 'score', 'bed+score+cue']) {
            const render = async (gap) => {
              const c = new OfflineAudioContext(6, Math.ceil(duration * sr), sr);
              const schedule = recordAudioSchedule(c);
              try {
                const eng = new AudioEngine(c);
                const probe = c.createChannelMerger(6);
                probe.connect(c.destination);
                for (const [i, node] of [eng.hushRoom, eng.hushHall].entries()) {
                  const stereo = c.createChannelSplitter(2);
                  node.connect(stereo);
                  stereo.connect(probe, 0, 2 + i * 2);
                  stereo.connect(probe, 1, 3 + i * 2);
                }
                if (name !== 'score') eng.bed(name === 'bed' ? 'gate_hum' : 'ambient', { at: 0.02 });
                if (name !== 'bed') eng.music.to('windows', 0.5, { at: 0.02 });
                if (name === 'bed+score+cue') {
                  eng.schedule([{ t: 0.02, cue: 'breath_out', opts: { id: 'long', dur: 6 } }], 0);
                }
                eng.music.scheduleUntil(duration);
                eng.quiet(true, SCORE.safeOutSec, entry);
                eng.stopAll(SCORE.safeOutSec, entry);
                if (gap !== null) eng.quiet(false, SCORE.safeBackSec, entry + gap);
                const data = await c.startRendering();
                return { data, calls: schedule.calls.filter((call) => call.time < entry) };
              } finally {
                schedule.stop();
              }
            };
            const held = await render(null);
            for (const gap of gaps) {
              const returned = await render(gap);
              const before = [0, 0, 0];
              const peak = [0, 0, 0];
              const atExit = [0, 0, 0];
              const echoClosed = [0, 0, 0];
              const from = Math.ceil(stoppedBy(entry, SCORE.safeOutSec) * sr);
              for (let ch = 0; ch < returned.data.numberOfChannels; ch++) {
                const d = returned.data.getChannelData(ch);
                const pair = Math.floor(ch / 2);
                for (let i = sr; i < entry * sr; i++) {
                  before[pair] = Math.max(before[pair], Math.abs(d[i]));
                }
                for (let i = from; i < d.length; i++) peak[pair] = Math.max(peak[pair], Math.abs(d[i]));
                for (let i = Math.ceil((entry + gap) * sr); i < d.length; i++) {
                  atExit[pair] = Math.max(atExit[pair], Math.abs(d[i]));
                }
                for (let i = Math.ceil((entry + gap + SCORE.safeOutSec) * sr); i < d.length; i++) {
                  echoClosed[pair] = Math.max(echoClosed[pair], Math.abs(d[i]));
                }
              }
              const db = (x) => x > 0 ? 20 * Math.log10(x) : -Infinity;
              const levels = ['speakers', 'room', 'hall'].map((bus, i) => ({
                bus, before: db(before[i]), after: db(peak[i]), atExit: db(atExit[i]), closed: db(echoClosed[i]),
              }));
              out.push({ name, sr, gap, levels, scheduled: held.calls.length,
                sameSchedule: JSON.stringify(held.calls) === JSON.stringify(returned.calls) });
            }
          }
        }
        return out;
      }, RATES);
      expect(got.length === RATES.length * 9, `rendered ${got.length} of ${RATES.length * 9} visits`);
      for (const g of got) {
        const at = `${g.name} (${g.sr} Hz, leave after ${g.gap * 1000} ms)`;
        expect(g.scheduled > 0 && g.sameSchedule, `${at}: leaving early changed scheduling before entry`);
        for (const level of g.levels) {
          const where = `${at}, ${level.bus}`;
          if (level.bus !== 'room' || g.name === 'bed+score+cue') {
            expect(level.before > -60, `${where}: no audible sound before the visit (${level.before} dB)`);
          }
          if (level.bus !== 'speakers' && g.gap < 1) {
            expect(level.atExit <= level.before,
              `${where}: echo rises from the exit at ${level.atExit.toFixed(1)} dB`);
            expect(level.closed < TWIN_DB,
              `${where}: old echo survives its exit fade at ${level.closed.toFixed(1)} dB`);
          }
          if (level.bus !== 'speakers' || g.gap === 1) {
            expect(level.after < TWIN_DB,
              `${where}: old sound returns after the visit at ${level.after.toFixed(1)} dB`);
          }
        }
      }
      expect(!errors.length, errors.join('\n'));
      return got;
    } finally {
      await ctx.close();
    }
  },

  async 'safe-zone-hub-hall-refills-from-the-exit'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const got = await page.evaluate(async (rates) => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { SCORE } = await import('/src/motion/tokens.ts');
        const entry = 2;
        const duration = 7;
        const out = [];
        for (const sr of rates) {
          const render = async (gap, hallFrom = null) => {
            const c = new OfflineAudioContext(4, duration * sr, sr);
            const eng = new AudioEngine(c);
            if (hallFrom !== null) {
              const input = eng.echo.sends.musHall.gain;
              input.cancelScheduledValues(0);
              input.setValueAtTime(0, 0);
              input.setValueAtTime(0, hallFrom);
              input.linearRampToValueAtTime(1, hallFrom + SCORE.safeOutSec);
            }
            const probe = c.createChannelMerger(4);
            probe.connect(c.destination);
            const stereo = c.createChannelSplitter(2);
            eng.hushHall.connect(stereo);
            stereo.connect(probe, 0, 2);
            stereo.connect(probe, 1, 3);
            eng.music.to('windows', 0.5, { at: 0.02 });
            eng.music.scheduleUntil(1);
            eng.music.to('calm', 2, { at: 1 });
            eng.music.scheduleUntil(duration);
            if (gap !== null) {
              eng.quiet(true, SCORE.safeOutSec, entry);
              eng.quiet(false, SCORE.safeBackSec, entry + gap);
            }
            return c.startRendering();
          };
          const twin = await render(null);
          for (const gap of [0.005, 1]) {
            const returned = await render(gap);
            const exit = entry + gap;
            const empty = await render(null, exit);
            const windows = [[exit, exit + 1]];
            for (let from = exit + 1; from + 1 <= duration; from++) windows.push([from, from + 1]);
            for (const [from, to] of windows) {
              let level = 0;
              let reference = 0;
              for (const ch of [2, 3]) {
                const d = returned.getChannelData(ch);
                const t = (from === exit ? empty : twin).getChannelData(ch);
                for (let i = Math.ceil(from * sr); i < Math.ceil(to * sr); i++) {
                  level += d[i] ** 2;
                  reference += t[i] ** 2;
                }
              }
              const samples = 2 * (Math.ceil(to * sr) - Math.ceil(from * sr));
              out.push({ sr, gap, from, atExit: from === exit,
                reference: 10 * Math.log10(reference / samples),
                apart: 10 * Math.log10(level / reference) });
            }
          }
        }
        return out;
      }, RATES);
      expect(got.length === RATES.length * 8, `measured ${got.length} of ${RATES.length * 8} hall windows`);
      for (const g of got) {
        const at = `${g.sr} Hz, ${g.gap * 1000} ms visit, ${g.from.toFixed(3)} s`;
        const reference = g.atExit ? 'an empty hall from the exit' : 'no visit';
        expect(g.reference > -60, `${at}: no audible hall in ${reference} (${g.reference.toFixed(1)} dB)`);
        expect(Math.abs(g.apart) < 0.1, `${at}: hall differs from ${reference} by ${g.apart.toFixed(2)} dB`);
      }
      expect(!errors.length, errors.join('\n'));
      return got;
    } finally {
      await ctx.close();
    }
  },

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
      const PROBE = 2;
      const render = async (f, sr, fade, stopped) => {
        const len = stoppedBy(AT, fade) + after[1] + 0.1;
        const c = new OfflineAudioContext(4, Math.ceil(len * sr), sr);
        const eng = new AudioEngine(c);
        const probe = c.createChannelMerger(4);
        probe.connect(c.destination);
        for (const n of [eng.bedBus, eng.testInput('music'), eng.testInput('sfx')]) n.connect(probe, 0, PROBE);
        let cue = null;
        const beds = [];
        let charge = null;
        for (const s of f.start) {
          if (BED_NAMES.includes(s)) beds.push(eng.bed(s, { at: T0 }));
          else if (CUES[s]) cue = eng.play(s, { at: T0, dur: 6 });
          else if (s === 'charge') charge = eng.chargeLoop({ at: T0 });
          else eng.music.to(s, 0.5, { at: T0 });
        }
        charge?.set(0.6, T0 + 0.5);
        eng.music.scheduleUntil(len);
        if (stopped) {
          if (f.stop === 'reset') eng.reset(fade, AT);
          else if (f.stop === 'stopAll') eng.stopAll(fade, AT);
          else if (f.stop === 'bed') beds[0].stop(fade, AT);
          else if (f.stop === 'music') eng.music.stop(fade, AT);
          else if (f.stop === 'lift') eng.music.to('reward', 1, { at: AT });
          else if (f.stop === 'bed_stop') {
            eng.schedule([{ t: 0, cue: 'bed_stop', loop: { name: f.start[0] }, opts: { fade } }], AT);
          }
          else if (f.stop === 'cue') cue.stop(AT, fade);
          else charge.stop(AT, fade);
          if (f.skip) eng.stopAll(SCORE.leaveSec, AT + f.skip);
          if (f.quiet) {
            eng.quiet(true, SCORE.safeOutSec, AT + f.quiet);
            eng.quiet(false, SCORE.safeBackSec, AT + f.quiet + SCORE.safeOutSec);
          }
        }
        const out = await c.startRendering();
        return { probe: out.getChannelData(PROBE), speaker: out.getChannelData(0) };
      };
      const rms = (d, a, b) => {
        let s = 0;
        for (let i = a; i < b; i++) s += d[i] * d[i];
        return Math.sqrt(s / (b - a));
      };
      const dB = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
      const endsAll = (f) => f.skip || f.quiet || f.stop === 'reset' || f.stop === 'stopAll';
      const out = [];
      for (const sr of rates) {
        for (const f of fades) {
          const fade = typeof f.fade === 'number' ? f.fade : SCORE[f.fade];
          const [stopped, unstopped] = await Promise.all([render(f, sr, fade, true), render(f, sr, fade, false)]);
          const [cut, twin] = [stopped.probe, unstopped.probe];
          const last = f.skip ? [AT + f.skip, SCORE.leaveSec] : f.quiet ? [AT + f.quiet, SCORE.safeOutSec] : [AT, fade];
          const k = Math.floor(stoppedBy(...last) * sr) - 1;
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
            echo: endsAll(f) ? dB(rms(stopped.speaker, a0, a1) / rms(stopped.speaker, b0, b1)) : -Infinity,
          });
        }
      }
      return out;
    }, [FADES, RATES, BEFORE, AFTER]);
    const renders = FADES.length * RATES.length;
    expect(got.length === renders, `rendered ${got.length} of ${renders} fades`);
    for (const g of got) {
      const at = `${g.name} (${g.fade} s, ${g.sr} Hz)`;
      const atStop = g.atStop.toFixed(1);
      expect(g.level > 1e-4, `${at}: the sound is too quiet to measure its fade (${g.level.toExponential(2)})`);
      expect(g.apart < TWIN_DB, `${at}: the render and its twin differ before the stop, at ${g.apart.toFixed(1)} dB`);
      expect(g.atStop < FLOOR_DB, `${at}: still at ${atStop} dB where its sources end, above ${FLOOR_DB} dB`);
      expect(g.after < FLOOR_DB, `${at}: still sounds at ${g.after.toFixed(1)} dB after its sources end`);
      expect(g.echo < FLOOR_DB, `${at}: its echo still rings at ${g.echo.toFixed(1)} dB after everything stopped`);
    }
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    const db = (x) => (Number.isFinite(x) ? +x.toFixed(1) : 'silent');
    const measured = (g) => ({ atStop: db(g.atStop), after: db(g.after), twin: db(g.apart), echo: db(g.echo) });
    return Object.fromEntries(got.map((g) => [`${g.name} ${g.sr}`, measured(g)]));
  },

  async 'no-note-starts-after-a-sooner-stop'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
    const got = await page.evaluate(async () => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { stoppedBy } = await import('/src/audio/voice.ts');
      const { SCORE } = await import('/src/motion/tokens.ts');
      const sr = 48000;
      const [T0, AT, AHEAD] = [0.02, 2, 1.5];
      const render = async (stop, fade, late) => {
        const len = stoppedBy(AT, fade) + 0.2;
        const c = new OfflineAudioContext(4, Math.ceil(len * sr), sr);
        const eng = new AudioEngine(c);
        const probe = c.createChannelMerger(4);
        probe.connect(c.destination);
        eng.testInput('music').connect(probe, 0, 2);
        eng.music.to('windows', 0.5, { at: T0 });
        eng.music.scheduleUntil(AT);
        eng.music.stop(2, AT + AHEAD);
        eng[stop](fade, AT);
        if (late) eng.music.scheduleUntil(len);
        return (await c.startRendering()).getChannelData(2);
      };
      const out = [];
      for (const [name, stop, fade] of [['Skip', 'stopAll', SCORE.leaveSec], ["a replay's reset", 'reset', 0.3]]) {
        const [placed, held] = await Promise.all([render(stop, fade, true), render(stop, fade, false)]);
        let diff = 0;
        let level = 0;
        const from = Math.floor(AT * sr);
        for (let i = from; i < placed.length; i++) diff += (placed[i] - held[i]) ** 2;
        for (let i = Math.floor((AT - 1) * sr); i < from; i++) level += held[i] ** 2;
        const dB = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
        const rms = Math.sqrt(level / sr);
        out.push({ name, level: rms, apart: dB(Math.sqrt(diff / (placed.length - from)) / rms) });
      }
      return out;
    });
    for (const g of got) {
      expect(g.level > 1e-4, `${g.name}: the score is too quiet to measure (${g.level.toExponential(2)})`);
      const apart = g.apart.toFixed(1);
      expect(g.apart < TWIN_DB, `${g.name}: notes placed after it sound in its fade, at ${apart} dB of the score`);
    }
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return Object.fromEntries(got.map((g) => [g.name, Number.isFinite(g.apart) ? +g.apart.toFixed(1) : 'silent']));
  },

  async 'skip-reaches-a-shortened-score-fade-after-the-score-moves-on'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
    const got = await page.evaluate(async (rates) => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { stoppedBy } = await import('/src/audio/voice.ts');
      const { SCORE } = await import('/src/motion/tokens.ts');
      const { AHEAD } = await import('/src/audio/music.ts');
      const [T0, LONG, SHORT, SKIP, PROBE] = [0.02, 1, 6.5, 6.6, 2];
      const out = [];
      for (const sr of rates) {
        const len = stoppedBy(SHORT, 0.5) + 0.1;
        const c = new OfflineAudioContext(4, Math.ceil(len * sr), sr);
        const eng = new AudioEngine(c);
        const probe = c.createChannelMerger(4);
        probe.connect(c.destination);
        eng.testInput('music').connect(probe, 0, PROBE);
        eng.music.to('windows', 0.5, { at: T0 });
        eng.music.scheduleUntil(LONG);
        eng.music.stop(8, LONG);
        eng.music.stop(0.5, SHORT);
        eng.music.scheduleUntil(SHORT + AHEAD);
        eng.stopAll(SCORE.leaveSec, SKIP);
        const d = (await c.startRendering()).getChannelData(PROBE);
        const rms = (a, b) => {
          let x = 0;
          for (let i = a; i < b; i++) x += d[i] * d[i];
          return Math.sqrt(x / (b - a));
        };
        const level = rms(Math.floor((LONG - 0.5) * sr), Math.floor(LONG * sr));
        const after = rms(Math.ceil(stoppedBy(SKIP, SCORE.leaveSec) * sr), d.length);
        out.push({ sr, level, after: 20 * Math.log10(after / level) });
      }
      return out;
    }, RATES);
    for (const g of got) {
      expect(g.level > 1e-4, `${g.sr} Hz: the score is too quiet to measure (${g.level.toExponential(2)})`);
      expect(g.after < FLOOR_DB, `${g.sr} Hz: the shortened fade still sounds at ${g.after.toFixed(1)} dB after Skip`);
    }
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return Object.fromEntries(got.map((g) => [g.sr, Number.isFinite(g.after) ? +g.after.toFixed(1) : 'silent']));
  },

  async 'a-sooner-stop-wins'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
    const got = await page.evaluate(async (rates) => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { stoppedBy } = await import('/src/audio/voice.ts');
      const { SCORE } = await import('/src/motion/tokens.ts');
      const T0 = 0.02;
      const AT = 2;
      const PROBE = 2;
      const skip = (e) => e.stopAll(SCORE.leaveSec, AT);
      const score = (e) => e.music.to('windows', 0.5, { at: T0 });
      const gateHum = (e) => e.bed('gate_hum', { at: T0 });
      const STOPS = [
        {
          name: 'score stopped later, then fading out of its section',
          start: score,
          first: (e) => e.music.stop(2, AT + 4),
          then: (e) => e.music.stop(1, AT),
          keeps: 'then',
          ends: stoppedBy(AT, 1),
        },
        {
          name: 'score stopped soon, then asked sooner to fade far longer',
          start: score,
          first: (e) => e.music.stop(0.5, AT + 0.5),
          then: (e) => e.music.stop(4, AT),
          keeps: 'first',
          ends: stoppedBy(AT + 0.5, 0.5),
        },
        {
          name: 'gate hum stopping later, then the lift into D major',
          start: gateHum,
          first: (e, h) => h.stop(0.5, AT + 6),
          then: (e) => e.music.to('reward', 1, { at: AT }),
          keeps: 'then',
          ends: stoppedBy(AT, 2.5),
          lifts: true,
        },
        {
          name: 'gate hum stopping later, then Skip',
          start: gateHum,
          first: (e, h) => h.stop(0.5, AT + 6),
          then: skip,
          keeps: 'then',
          ends: stoppedBy(AT, SCORE.leaveSec),
        },
        {
          name: 'vortex roar fading out, then the cut scene ending at once',
          start: (e) => e.bed('vortex_roar', { at: T0 }),
          first: (e) => e.stopBed('vortex_roar', 1.5, AT),
          then: (e) => e.stopBed('vortex_roar', 0.04, AT),
          keeps: 'then',
          ends: stoppedBy(AT, 0.04),
        },
        {
          name: 'cue stopped later, then stopped sooner as Skip stops it',
          start: (e) => e.play('breath_out', { at: T0, dur: 6 }),
          first: (e, h) => h.stop(AT + 3, 2),
          then: (e, h) => h.stop(AT, SCORE.leaveSec),
          keeps: 'then',
          ends: stoppedBy(AT, SCORE.leaveSec),
        },
        {
          name: 'charge hum stopped later, then Skip',
          start: (e) => e.chargeLoop({ at: T0 }),
          first: (e, h) => h.stop(AT + 3, 1),
          then: skip,
          keeps: 'then',
          ends: stoppedBy(AT, SCORE.leaveSec),
        },
      ];
      const render = async (s, sr, stops) => {
        const len = s.ends + 0.1;
        const c = new OfflineAudioContext(4, Math.ceil(len * sr), sr);
        const eng = new AudioEngine(c);
        const probe = c.createChannelMerger(4);
        probe.connect(c.destination);
        for (const n of [eng.bedBus, eng.testInput('music'), eng.testInput('sfx')]) n.connect(probe, 0, PROBE);
        const h = s.start(eng);
        eng.music.scheduleUntil(AT);
        for (const k of stops) s[k](eng, h);
        eng.music.scheduleUntil(len);
        return (await c.startRendering()).getChannelData(PROBE);
      };
      const rms = (d, a, b) => {
        let x = 0;
        for (let i = a; i < b; i++) x += d[i] * d[i];
        return Math.sqrt(x / (b - a));
      };
      const out = [];
      for (const sr of rates) {
        for (const s of STOPS) {
          const [both, kept] = await Promise.all([render(s, sr, ['first', 'then']), render(s, sr, [s.keeps])]);
          const [a, b] = [Math.floor((AT - 1) * sr), Math.floor(AT * sr)];
          let diff = 0;
          for (let i = b; i < both.length; i++) diff += (both[i] - kept[i]) ** 2;
          const level = rms(kept, a, b);
          const apart = 20 * Math.log10(Math.sqrt(diff / (both.length - b)) / level);
          const end = Math.ceil(s.ends * sr);
          const after = s.lifts ? -Infinity : 20 * Math.log10(rms(both, end, both.length) / level);
          out.push({ name: s.name, sr, level, apart, after });
        }
      }
      return out;
    }, RATES);
    expect(got.length === 7 * RATES.length, `rendered ${got.length} of ${7 * RATES.length} stops`);
    for (const g of got) {
      const at = `${g.name} (${g.sr} Hz)`;
      expect(g.level > 1e-4, `${at}: the sound is too quiet to measure (${g.level.toExponential(2)})`);
      expect(g.apart < FLOOR_DB, `${at}: differs from the stop it keeps alone by ${g.apart.toFixed(1)} dB`);
      expect(g.after < FLOOR_DB, `${at}: still sounds at ${g.after.toFixed(1)} dB after the stop it keeps`);
    }
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    const apart = (g) => (Number.isFinite(g.apart) ? +g.apart.toFixed(1) : 'same');
    return Object.fromEntries(got.map((g) => [`${g.name} ${g.sr}`, apart(g)]));
  },
};
