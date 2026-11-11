// Every cue plays whole and on time, even on a busy page. A cue is built before its start is read, then placed a stated
// lead past the audio clock (soon() in src/audio/param.ts), so neither a slow main thread building it nor the audio
// thread rendering ahead can push its start, attack or stop behind what has already been rendered. The companion's short cues play through its real sound path
// while the page stalls and the CPU is slowed, and each is measured on the real output, render quantum by render
// quantum, through its whole tail, against an offline render of the same cue placed where the engine put it. Each part
// of the score is built before its start is set, so it opens on time on a busy page too, and the score, scheduled ahead
// in windows, drops what a long stall made it miss instead of playing it late.
import fs from 'node:fs';
import path from 'node:path';
import { installAudioRecorder, audioReady, audioRecorded, audioHeard } from './audio-recorder.mjs';

/** What each check measured, in the run's artifacts. */
const note = (h, name, o) => fs.appendFileSync(path.join(h.out, 'cues-on-time.jsonl'), JSON.stringify({ name, ...o }) + '\n');

const AUDIO = 'dbt.audio.v1';
const Q = 128;
// the companion's short cues that sound the same every time (card_flip's attack is random noise and bubble's notes
// fall by chance, so one play can't be matched quantum by quantum against a render), and whose start follows from the
// end of their handle
const CUES = ['ui_tap', 'ui_close', 'check', 'soft_chime'];
const TIMELINE_CUES = ['check', 'soft_chime'];
const PER = 5;
// the CPU slowed 4, 10 and 20 times
const RATES = [4, 10, 20];
// visuals lead their sound by 1 or 2 frames (DESIGN.md)
const LEAD = 2 / 60;
// its first quanta above a twentieth of its loudest where it rings louder than what still sounds from the cues before it
const ONSET = 6;
// and the rest of it through its tail, in parts by how much of its energy has come: to half, 90%, 99% and 99.9%
const PARTS = [0.5, 0.9, 0.99, 0.999];
const SECTIONS = ['intro', 'windows', 'silhouette', 'awaken', 'reward', 'end', 'calm'];

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function returning() {
  const t = Date.now() - 86400e3;
  const day = dayKey(t);
  return JSON.stringify({ v: 1, created: t, events: [{ id: 'cue-visit', t, day, k: 'visit', xp: 10 }], flags: { greetDay: day } });
}

async function boot(h, levels) {
  const ctx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'en-US' });
  await installAudioRecorder(ctx);
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: returning(), [AUDIO]: JSON.stringify({ v: 1, master: 1, muted: false, ...levels }) };
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  const page = await ctx.newPage();
  ctx.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
  await page.goto(h.server.url + '/');
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile') && window.__taps.length > 0, null, { timeout: 30000 });
  await page.keyboard.press('Shift');
  await audioReady(page);
  await h.reachHub(page);
  // the engine's output tap, and a count of every time something is placed behind the audio clock while `window.__watch`
  // is set: such a part has already been rendered past, so it starts late, cuts in or never plays
  const tap = await page.evaluate(async () => {
    const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
    const tap = window.__taps.findIndex((t) => t.from === 'GainNode');
    const clock = window.__taps[tap].context;
    window.__behind = [];
    window.__watch = false;
    const behind = (what, t) => {
      if (window.__watch && t > 0 && t < clock.currentTime) window.__behind.push([what, clock.currentTime - t]);
    };
    tapAudioSchedule((_, method, args, time) => behind(method, time));
    return tap;
  });
  return { ctx, page, errors, tap };
}

async function recordOpens() {
  const { Voice } = await import('/src/audio/voice.ts');
  const open = Voice.prototype.open;
  window.__opens = [];
  Voice.prototype.open = function (at) {
    if (window.__watch) window.__opens.push(at);
    return open.call(this, at);
  };
}

const SLOW_BUILDS = {
  beds: { levels: { music: 0, sfx: 1 }, hold: 0.6, what: 'beds and charge loops' },
  score: { levels: { music: 1, sfx: 1 }, hold: 1.15, what: 'score sections and hushes' },
};

async function startsOnTimeHoweverSlowItsBuild(h, kind) {
  const { levels, hold, what } = SLOW_BUILDS[kind];
  const { ctx, page, errors, tap } = await boot(h, levels);
  try {
    await page.evaluate(recordOpens);
    await page.evaluate(async () => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { Voice } = await import('/src/audio/voice.ts');
      const play = AudioEngine.prototype.play;
      AudioEngine.prototype.play = function (...a) {
        window.__engine = this;
        return play.apply(this, a);
      };
      for (const m of ['osc', 'noise', 'lfo', 'loop']) {
        const make = Voice.prototype[m];
        Voice.prototype[m] = function (...a) {
          const until = performance.now() + (window.__watch ? 2 : 0);
          while (performance.now() < until);
          return make.apply(this, a);
        };
      }
      window.__daily.sound('ui_tap');
    });
    await page.waitForFunction(() => !!window.__engine);
    const cdp = await ctx.newCDPSession(page);
    const started = [];
    for (const rate of RATES) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      started.push(...(await page.evaluate(async ([kind, hold, rate, LEAD, tap, Q]) => {
        const { BED_NAMES } = await import('/src/audio/beds.ts');
        const { SECTIONS } = await import('/src/audio/music.ts');
        const { stoppedBy } = await import('/src/audio/voice.ts');
        const engine = window.__engine;
        const rec = window.__taps[tap];
        const clock = rec.context;
        const recent = () => {
          let ss = 0;
          for (let k = rec.end - 31; k <= rec.end; k++) ss += rec.q.get(k)?.[1] ?? 0;
          return Math.sqrt(ss / (32 * Q));
        };
        const until = async (ready, what) => {
          const by = performance.now() + 15000;
          while (!ready()) {
            if (rec.error || performance.now() > by) {
              const now = `the context ${clock.state} at ${clock.currentTime.toFixed(3)} s`;
              throw new Error(`${what} never came: ${now}, recorder ${rec.error ?? rec.status}, RMS ${recent()}`);
            }
            await new Promise((done) => setTimeout(done, 10));
          }
        };
        const reach = (t) => until(() => clock.currentTime >= t, `the audio clock reaching ${t.toFixed(3)} s`);
        const silence = () => {
          const from = clock.currentTime;
          const heard = () => rec.end !== undefined && ((rec.end - 31) * Q) / clock.sampleRate > from;
          return until(() => heard() && recent() < 3e-5, 'silence before the next opening');
        };
        const out = [];
        const play = async (name, start, stop) => {
          await silence();
          const was = window.__behind.length;
          const opened = window.__opens.length;
          const ask = clock.currentTime;
          const t0 = performance.now();
          window.__watch = true;
          const handle = start();
          window.__watch = false;
          const ms = performance.now() - t0;
          const opens = window.__opens.slice(opened);
          out.push({ name, rate, ask, done: clock.currentTime, ms, behind: window.__behind.slice(was), opens });
          await reach(Math.max(ask, ...opens) + hold);
          const at = clock.currentTime + LEAD;
          stop(handle, at);
          await reach(stoppedBy(at, 0.05));
        };
        if (kind === 'beds') {
          for (const name of BED_NAMES) {
            await play(name, () => engine.bed(name, { level: 0.5 }), (bed, at) => bed.stop(0.05, at));
          }
          await play('charge loop', () => engine.chargeLoop(), (charge, at) => charge.stop(at, 0.05));
          return out;
        }
        engine.music.stop(0.05);
        for (const name of SECTIONS) {
          await play(name, () => engine.music.to(name, 0.3), (_, at) => engine.music.stop(0.05, at));
        }
        await play('hush', () => engine.hush(), (_, at) => engine.unhush(at));
        return out;
      }, [kind, hold, rate, LEAD, tap, Q])));
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await audioRecorded(page, tap, Math.max(...started.map((s) => Math.max(s.ask, ...s.opens))) + hold);
    const bad = [];
    for (const s of started) {
      const at = Math.min(...s.opens);
      const lag = Math.max(...s.opens) - at;
      const { rms } = await audioHeard(page, tap, at + 0.2, at + hold - 0.05, [0, 0]);
      const before = (await audioHeard(page, tap, at - 0.1, at - 0.01, [0, 0])).rms;
      const worstMs = s.behind.length ? Math.max(...s.behind.map((b) => b[1])) * 1000 : 0;
      const leadMs = +((at - s.done) * 1000).toFixed(1);
      const buildMs = +s.ms.toFixed(1);
      note(h, kind, { part: s.name, rate: s.rate, buildMs, behind: s.behind.length, worstMs, leadMs, rms, before });
      const why = [];
      if (s.behind.length) {
        const where = [...new Set(s.behind.map((b) => b[0]))].join(', ');
        const worst = worstMs.toFixed(1);
        why.push(`${s.behind.length} of its parts were placed up to ${worst} ms behind the clock (${where})`);
      }
      if (!s.opens.length) why.push('it never opened');
      else if (at < s.ask - 1e-4 || at > s.done + LEAD + 1e-4) why.push(`it opens ${leadMs} ms past the clock`);
      if (lag > 1e-6) why.push(`its parts opened ${(lag * 1000).toFixed(1)} ms apart`);
      if (!(before < 1e-4)) why.push(`something still sounded as it opened (RMS ${before})`);
      if (!(rms > 3e-4)) why.push(`it was not heard (RMS ${rms})`);
      if (why.length) bad.push(`${s.name} at CPU x${s.rate} (built in ${s.ms.toFixed(1)} ms): ${why.join(', ')}`);
    }
    h.expect(!bad.length, `${bad.length} of ${started.length} ${what} did not start on time: ${bad.join('; ')}`);
    h.expect(!errors.length, errors.join('\n'));
    return { started: started.length, slowestMs: Math.max(...started.map((s) => +s.ms.toFixed(1))) };
  } finally {
    await ctx.close();
  }
}

async function measureCueEnergy([plays, tap, cues, Q, ONSET, PARTS]) {
        const { AudioEngine, renderOffline } = await import('/src/audio/engine.ts');
        const rec = window.__taps[tap];
        const sr = rec.context.sampleRate;
        const length = Object.fromEntries(cues.map((cue) => [cue, new AudioEngine(new OfflineAudioContext(2, sr, sr)).play(cue, { at: 0 }).end]));
        const frame = plays.map((p) => (p.start ?? (p.end - length[p.cue])) * sr);
        // well past the start of an offline render, where the limiter has settled, on a quantum's first frame
        const from0 = Math.ceil((0.25 * sr) / Q) * Q;
        // Chromium renders a cue's FM voices differently by where in a quantum they start, so each play is matched against
        // a render of its cue started at the same point of a quantum as the engine put it
        const refs = new Map();
        const cums = [];
        for (const [i, p] of plays.entries()) {
          const into = frame[i] - Q * Math.floor(frame[i] / Q);
          const key = `${p.cue} ${into.toFixed(3)}`;
          if (!refs.has(key)) {
            const T0 = (from0 + into) / sr;
            const buf = await renderOffline([{ t: T0, cue: p.cue }], T0 + 3.5, sr, { volume: window.__dbtVolume.gains().master, user: { master: 1, music: 0, sfx: 1, muted: false } });
            const [l, r] = [buf.getChannelData(0), buf.getChannelData(1)];
            const from = Math.round(T0 * sr);
            const cum = new Float64Array(l.length - from + 1);
            // the recorder hears the speakers' mix down to one channel
            for (let f = from; f < l.length; f++) cum[f - from + 1] = cum[f - from] + (0.5 * (l[f] + r[f])) ** 2;
            refs.set(key, cum);
          }
          cums.push(refs.get(key));
        }
        const starts = frame.map(Math.round);
        const energy = (j, k) => {
          const cum = cums[j];
          const at = (f) => cum[Math.max(0, Math.min(cum.length - 1, f - starts[j]))];
          return at((k + 1) * Q) - at(k * Q);
        };
        return plays.map((p, i) => {
          const k0 = Math.floor(starts[i] / Q);
          const total = cums[i].at(-1);
          const blocks = [];
          for (let k = k0, own = 0; own < PARTS.at(-1) * total; k++) {
            let others = 0;
            for (let j = 0; j < plays.length; j++) if (j !== i && starts[j] < (k + 1) * Q && starts[j] > k * Q - 4 * sr) others += energy(j, k);
            blocks.push([rec.q.get(k)?.[1] ?? NaN, energy(i, k), others]);
            own += energy(i, k);
          }
          const loud = Math.max(...blocks.map((b) => b[1]));
          const onset = blocks.filter((b) => b[1] >= loud / 20 && b[1] >= 2 * b[2]).slice(0, ONSET);
          const parts = [];
          for (let b = 0, own = 0, from = 0; b < blocks.length; b++) {
            own += blocks[b][1];
            if (own >= PARTS[parts.length] * total || b === blocks.length - 1) {
              parts.push(blocks.slice(from, b + 1));
              from = b + 1;
            }
          }
          return { start: starts[i] / sr, blocks, onset, parts };
        });
}

export const scenarios = {
  async 'cue-reaches-audio-before-the-page-stalls'(h) {
    const { ctx, page, errors } = await boot(h, { music: 0, sfx: 1 });
    try {
      const results = await page.evaluate(async (cues) => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const play = AudioEngine.prototype.play;
        let engine;
        AudioEngine.prototype.play = function (...args) { engine = this; return play.apply(this, args); };
        try { window.__daily.sound('check'); } finally { AudioEngine.prototype.play = play; }
        await engine.timeline.ready;
        const clock = engine.ctx;
        const results = [];
        for (const cue of cues) for (const duration of [65, 500]) {
          const ask = clock.currentTime;
          const handle = engine.play(cue);
          const until = performance.now() + duration;
          while (performance.now() < until);
          const after = clock.currentTime;
          const ack = await handle.started;
          results.push({ cue, duration, ask, after, ...ack });
        }
        return results;
      }, TIMELINE_CUES);
      const missed = results.filter((r) => r.after - r.receivedAt < 0.02 || r.start < r.ask);
      h.expect(!missed.length, `Cues reached the audio thread after the stall: ${JSON.stringify(missed)}`);
      h.expect(!errors.length, errors.join('\n'));
      return results;
    } finally { await ctx.close(); }
  },
  async 'cue-placement-survives-main-thread-pauses'(h) {
    const { ctx, page, errors, tap } = await boot(h, { music: 0, sfx: 1 });
    try {
      const results = await page.evaluate(async ([cues, tap, LEAD]) => {
        const { Voice } = await import('/src/audio/voice.ts');
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const open = Voice.prototype.open;
        const play = AudioEngine.prototype.play;
        const set = AudioParam.prototype.setValueAtTime;
        const connect = AudioNode.prototype.connect;
        const clock = window.__taps[tap].context;
        const lead = Math.max(LEAD, (clock.baseLatency || 0) + 1 / 60);
        let seam = '';
        let duration = 0;
        let paused = false;
        let timing;
        let handle;
        let connections = 0;
        const pause = () => {
          paused = true;
          const before = clock.currentTime;
          const wall = performance.now();
          const until = performance.now() + duration;
          while (performance.now() < until);
          timing = { before, after: clock.currentTime, wall: performance.now() - wall };
        };
        Voice.prototype.open = function (...args) {
          if (window.__watch && seam === 'open' && !paused) {
            pause();
            timing.requested = args[0];
          }
          return open.apply(this, args);
        };
        AudioEngine.prototype.play = function (...args) {
          handle = play.apply(this, args);
          return handle;
        };
        AudioParam.prototype.setValueAtTime = function (...args) {
          const result = set.apply(this, args);
          if (window.__watch && seam === 'placement' && !paused) {
            pause();
            timing.requested = args[1];
          }
          return result;
        };
        AudioNode.prototype.connect = function (...args) {
          const result = connect.apply(this, args);
          if (window.__watch && seam === 'placement' && this instanceof ChannelSplitterNode && ++connections === 2 && !paused) pause();
          return result;
        };
        try {
          const results = [];
          for (const cue of cues) for (duration of [65, 500]) for (seam of ['open', 'placement']) {
            paused = false;
            connections = 0;
            handle = undefined;
            const before = window.__behind.length;
            const ask = clock.currentTime;
            window.__watch = true;
            window.__daily.sound(cue);
            const ack = handle?.started && await Promise.race([
              handle.started,
              new Promise((_, reject) => setTimeout(() => reject(new Error('The cue did not acknowledge its start')), 15000)),
            ]);
            window.__watch = false;
            const end = handle?.end;
            results.push({ cue, duration, seam, paused, timing, ask, end, start: ack?.start, receivedAt: ack?.receivedAt, lead, behind: window.__behind.slice(before) });
            if (ack) {
              const limit = performance.now() + 15000;
              while (clock.currentTime < end + 0.2) {
                if (performance.now() > limit) throw new Error('The cue did not finish');
                await new Promise((done) => setTimeout(done, 10));
              }
            }
          }
          return results;
        } finally {
          window.__watch = false;
          Voice.prototype.open = open;
          AudioEngine.prototype.play = play;
          AudioParam.prototype.setValueAtTime = set;
          AudioNode.prototype.connect = connect;
        }
      }, [TIMELINE_CUES, tap, LEAD]);
      for (const r of results) note(h, 'paused-placement', { ...r, behind: r.behind.length });
      const missed = results.filter((r) => !r.paused || r.behind.length || r.start === undefined || r.start < r.ask - 1e-4 || r.start < r.receivedAt - 1e-4 || r.start > r.receivedAt + r.lead + 1e-4);
      h.expect(!missed.length, `${missed.length} cues missed a pause, missed their acknowledgement or placed calls behind the audio clock: ${missed.map((r) => `${r.cue} ${r.duration} ms ${r.seam}: paused=${r.paused}, behind=${r.behind.length}, start=${r.start}`).join('; ')}`);
      await audioRecorded(page, tap, Math.max(...results.map((r) => r.end)) + 0.2);
      const measured = await page.evaluate(measureCueEnergy, [results, tap, TIMELINE_CUES, Q, ONSET, PARTS]);
      const sum = (bs, i) => bs.reduce((total, block) => total + block[i], 0);
      const bad = [];
      results.forEach((result, i) => {
        const { blocks, onset, parts } = measured[i];
        const ratio = (bs) => sum(bs, 0) / (sum(bs, 1) + sum(bs, 2));
        const first = ratio(onset.slice(0, 2));
        const attack = ratio(onset);
        const levels = parts.map(ratio);
        note(h, 'paused-energy', { cue: result.cue, duration: result.duration, seam: result.seam, first, attack, levels });
        if (onset.length < 3 || blocks.some((b) => !Number.isFinite(b[0])) || !(first >= 0.5) || !(attack >= 0.6 && attack <= 1.7) || levels.some((v) => !(v >= 0.7 && v <= 1.4))) {
          bad.push(`${result.cue} ${result.duration} ms ${result.seam}: first=${first}, attack=${attack}, parts=${levels}`);
        }
      });
      h.expect(!bad.length, `${bad.length} cues did not match their offline renders: ${bad.join('; ')}`);
      h.expect(!errors.length, errors.join('\n'));
      return { cases: results.length };
    } finally {
      await ctx.close();
    }
  },
  async 'cue-stops-survive-main-thread-pauses'(h) {
    const { ctx, page, errors } = await boot(h, { music: 0, sfx: 1 });
    try {
      const probe = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const play = AudioEngine.prototype.play;
        let engine;
        AudioEngine.prototype.play = function (...args) {
          engine = this;
          return play.apply(this, args);
        };
        try {
          window.__daily.sound('ui_tap');
        } finally {
          AudioEngine.prototype.play = play;
        }
        window.__stopEngine = engine;
        const output = engine.ctx.createGain();
        engine.testInput('sfx').connect(output);
        output.connect(engine.ctx.destination);
        return window.__taps.findIndex((t) => t.node === output);
      });
      await audioReady(page);
      const results = await page.evaluate(async () => {
        const { Voice, stoppedBy } = await import('/src/audio/voice.ts');
        const engine = window.__stopEngine;
        const clock = engine.ctx;
        const original = Voice.prototype.stop;
        let target;
        let paused;
        Voice.prototype.stop = function (...args) {
          if (this === target && !paused) {
            const until = performance.now() + 500;
            while (performance.now() < until);
            paused = clock.currentTime;
          }
          return original.apply(this, args);
        };
        const until = async (condition, what) => {
          const limit = performance.now() + 15000;
          while (!condition()) {
            if (performance.now() > limit) throw new Error(`${what} did not finish`);
            await new Promise((done) => setTimeout(done, 10));
          }
        };
        try {
          const results = [];
          for (const mode of ['handle', 'stopAll', 'quiet', 'schedule']) {
            const at = clock.currentTime + 0.06;
            let handle;
            if (mode === 'schedule') {
              engine.schedule([{ t: 0, cue: 'chest_rise', opts: { id: 'stop-probe' } }], at);
              handle = engine.named.get('stop-probe');
            } else handle = engine.play('chest_rise', { at });
            const start = (await handle.started).start;
            const voice = [...engine.active].at(-1);
            await until(() => clock.currentTime >= start + 0.15, 'The cue opening');
            target = voice;
            paused = 0;
            const ask = clock.currentTime;
            const requested = ask + 0.05;
            const before = window.__behind.length;
            window.__watch = mode === 'handle';
            if (mode === 'handle') handle.stop(requested, 0.05);
            else if (mode === 'stopAll') engine.stopAll(0.05, requested);
            else if (mode === 'quiet') engine.quiet(true, 0.05, requested);
            else engine.schedule([{ t: 0, cue: 'stop', opts: { id: 'stop-probe', ramp: 0.05 } }], requested);
            await until(() => !voice.pendingStops.length, 'The cue stop');
            window.__watch = false;
            const stop = voice.stopStartsAt;
            const silent = voice.silentAt;
            results.push({ mode, start, ask, requested, paused, stop, silent, expected: stoppedBy(stop, 0.05), behind: window.__behind.slice(before) });
            await until(() => clock.currentTime >= silent + 0.25, 'The cue silence');
            if (mode === 'quiet') engine.quiet(false, 0.05);
          }
          return results;
        } finally {
          window.__watch = false;
          Voice.prototype.stop = original;
        }
      });
      await audioRecorded(page, probe, Math.max(...results.map((r) => r.silent)) + 0.25);
      const failures = [];
      for (const r of results) {
        const before = await audioHeard(page, probe, r.start + 0.2, r.stop, [0, 0]);
        const after = await audioHeard(page, probe, r.silent + 0.04, r.silent + 0.2, [0, 0]);
        note(h, 'paused-stop', { ...r, behind: r.behind.length, before: before.rms, after: after.rms });
        if (!r.paused || r.stop < r.paused - 1e-4 || Math.abs(r.silent - r.expected) > 1e-6 || r.behind.length || !(before.rms > 1e-6) || !(after.rms < 3e-5)) {
          failures.push(`${r.mode}: paused=${r.paused}, stop=${r.stop}, silent=${r.silent}, behind=${r.behind.length}, RMS=${before.rms}/${after.rms}`);
        }
      }
      h.expect(!failures.length, failures.join('; '));
      h.expect(!errors.length, errors.join('\n'));
      return { cases: results.length };
    } finally {
      await ctx.close();
    }
  },
  async 'cue-stop-reaches-audio-before-the-page-stalls'(h) {
    const { ctx, page, errors } = await boot(h, { music: 0, sfx: 1 });
    try {
      const probe = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const play = AudioEngine.prototype.play;
        let engine;
        AudioEngine.prototype.play = function (...args) { engine = this; return play.apply(this, args); };
        try { window.__daily.sound('ui_tap'); } finally { AudioEngine.prototype.play = play; }
        window.__stopEngine = engine;
        const output = engine.ctx.createGain();
        engine.testInput('sfx').connect(output);
        output.connect(engine.ctx.destination);
        return window.__taps.findIndex((tap) => tap.node === output);
      });
      await audioReady(page);
      const result = await page.evaluate(async () => {
        const { stoppedBy } = await import('/src/audio/voice.ts');
        const engine = window.__stopEngine;
        const clock = engine.ctx;
        const wait = async (check) => { while (!check()) await new Promise((resolve) => setTimeout(resolve, 10)); };
        const handle = engine.play('chest_rise', { at: clock.currentTime + 0.06 });
        const start = (await handle.started).start;
        const voice = [...engine.active].at(-1);
        await wait(() => clock.currentTime >= start + 0.25);
        const requested = clock.currentTime + 0.05;
        handle.stop(requested, 0.05);
        const until = performance.now() + 500;
        while (performance.now() < until);
        await wait(() => !voice.pendingStops.length);
        return { start, requested, stopped: voice.stopStartsAt, silent: stoppedBy(requested, 0.05) };
      });
      await audioRecorded(page, probe, result.silent + 0.2);
      const before = await audioHeard(page, probe, result.start + 0.1, result.requested, [0, 0]);
      const after = await audioHeard(page, probe, result.silent + 0.03, result.silent + 0.18, [0, 0]);
      note(h, 'stop-before-stall', { ...result, before: before.rms, after: after.rms });
      h.expect(Math.abs(result.stopped - result.requested) < 1e-4, `The stop reached audio ${((result.stopped - result.requested) * 1000).toFixed(1)} ms late`);
      h.expect(before.rms > 1e-6 && after.rms < 3e-5, `The cue was not cut during the stall: RMS ${before.rms} before and ${after.rms} after`);
      h.expect(!errors.length, errors.join('\n'));
      return result;
    } finally { await ctx.close(); }
  },
  async 'live-cues-match-their-native-waveforms'(h) {
    const results = [];
    for (const cue of [...TIMELINE_CUES, '__phase_sine', '__phase_triangle', '__phase_sawtooth', '__phase_square', '__phase_envelope', '__phase_fm', '__phase_mod']) for (const offset of ['check', '__phase_sine', '__phase_fm'].includes(cue) ? [0.25, 37.25, 90.25] : [37.25]) {
      const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
      try {
        await page.waitForFunction(() => window.__lab === true);
        const result = await page.evaluate(async ({ cue, offset }) => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { CUES: definitions } = await import('/src/audio/cues.ts');
        definitions.__phase_sine = { timeline: true, fn: (voice) => voice.osc('sine', 880, voice.t, voice.t + 1, voice.wet) };
        for (const shape of ['triangle', 'sawtooth', 'square']) definitions[`__phase_${shape}`] = { timeline: true, fn: (voice) => voice.osc(shape, 880, voice.t, voice.t + 1, voice.wet) };
        definitions.__phase_envelope = { timeline: true, fn: (voice) => {
          const gain = voice.gain(0, voice.wet);
          const end = voice.perc(gain.gain, voice.t, 0.045, 0.005, 0.24);
          voice.osc('sine', 880, voice.t, end, gain);
        } };
        definitions.__phase_fm = { timeline: true, fn: (voice) => voice.fm({ t: voice.t, f: 880, ratio: 1, index: 0.9, idxEnd: 0.1, idxTau: 0.08, a: 0.005, tau: 0.24, peak: 0.045, dest: voice.wet }) };
        definitions.__phase_mod = { timeline: true, fn: (voice) => {
          const gain = voice.gain(0, voice.wet);
          const param = voice.at(gain.gain);
          param.setValueAtTime(792, voice.t);
          param.setTargetAtTime(88, voice.t + 0.005, 0.08);
          voice.osc('sine', 880, voice.t, voice.t + 1, gain);
        } };
        const capture = async (cue, timeline, offset, rate) => {
          if (!timeline) {
            const frame = 12800;
            const length = Math.ceil(1.4 * rate);
            const clock = new OfflineAudioContext(2, frame - 128 + length, rate);
            const engine = new AudioEngine(clock);
            engine.volume.disconnect();
            engine.testInput('sfx').connect(clock.destination);
            engine.play(cue, { at: (frame + offset) / rate });
            const data = await clock.startRendering();
            return { left: data.getChannelData(0).slice(frame - 128), right: data.getChannelData(1).slice(frame - 128), rate, frame };
          }
          const clock = new AudioContext();
          const engine = new AudioEngine(clock);
          try {
            await engine.timeline.ready;
            await clock.audioWorklet.addModule('/scripts/e2e/audio-wave-recorder.mjs');
            let resumeTimeout;
            await Promise.race([
              engine.unlock(),
              new Promise((_, reject) => { resumeTimeout = setTimeout(() => reject(new Error(`The ${cue} audio context did not resume`)), 10000); }),
            ]).finally(() => clearTimeout(resumeTimeout));
            const recorder = new AudioWorkletNode(clock, 'e2e-wave', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
            engine.testInput('sfx').connect(recorder);
            recorder.connect(clock.destination);
            const frame = Math.ceil((clock.currentTime + 0.8) * clock.sampleRate / 128) * 128;
            const start = (frame + offset) / clock.sampleRate;
            const recorded = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error(`The ${cue} waveform was not recorded`)), 15000);
              recorder.port.onmessage = ({ data }) => { clearTimeout(timeout); resolve(data); };
              recorder.onprocessorerror = () => { clearTimeout(timeout); reject(new Error('The waveform recorder stopped')); };
            });
            recorder.port.postMessage({ from: frame - 128, length: Math.ceil(1.4 * clock.sampleRate) });
            const handle = engine.play(cue, { at: start });
            let timeout;
            const ack = await Promise.race([
              handle.started,
              new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`The ${cue} start was not acknowledged`)), 15000); }),
            ]).finally(() => clearTimeout(timeout));
            if (Math.abs(ack.start - start) > 1 / clock.sampleRate) throw new Error(`${cue} started after the capture window`);
            const data = await recorded;
            return { ...data, rate: clock.sampleRate, frame };
          } finally {
            engine.dispose();
            if (clock.state !== 'closed') await new Promise((resolve) => clock.addEventListener('statechange', () => { if (clock.state === 'closed') resolve(); }, { once: true }));
          }
        };
          const live = await capture(cue, true, offset);
          const native = await capture(cue, false, offset, live.rate);
          if (native.rate !== live.rate) throw new Error('The sample rates changed');
          let signal = 0;
          let error = 0;
          let dot = 0;
          let actual = 0;
          for (const ch of ['left', 'right']) for (let i = 0; i < native[ch].length; i++) {
            const a = native[ch][i];
            const b = live[ch][i];
            signal += a * a;
            actual += b * b;
            error += (a - b) ** 2;
            dot += a * b;
          }
          const windows = [];
          for (const [from, to] of [[0, 0.08], [0.1, 0.4]]) {
            let reference = 0;
            let delta = 0;
            for (let i = 165 + Math.floor(from * native.rate); i < 165 + Math.floor(to * native.rate); i++) {
              reference += native.left[i] ** 2;
              delta += (native.left[i] - live.left[i]) ** 2;
            }
            windows.push(Math.sqrt(delta / reference));
          }
          let before = 0;
          for (let i = 0; i < 128 + Math.ceil(offset); i++) before = Math.max(before, Math.abs(live.left[i]), Math.abs(live.right[i]));
          const onset = [native, live].map((data) => data.left.findIndex((sample) => Math.abs(sample) > 1e-7));
          const samples = cue === '__phase_sine' ? [native, live].map((data) => [...data.left.slice(128 + Math.ceil(offset) - 1, 128 + Math.ceil(offset) + 10)]) : [];
          return { cue, offset, difference: Math.sqrt(error / signal), correlation: dot / Math.sqrt(signal * actual), windows, before, onset, samples, frames: [native.frame, live.frame], rate: live.rate };
        }, { cue, offset });
        results.push(result);
        note(h, 'waveform', result);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
    h.expect(results.every((r) => r.before === 0), `A cue sounded before its start: ${JSON.stringify(results.filter((r) => r.before !== 0))}`);
    h.expect(results.every((r) => r.difference < 0.01), `Live cue waveforms differ from offline playback: ${JSON.stringify(results)}`);
    return results;
  },
  async 'live-oscillator-control-starts-on-one-frame'(h) {
    const results = [];
    for (let run = 0; run < 6; run++) {
      const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
      try {
        await page.waitForFunction(() => window.__lab === true);
        const result = await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { CUES } = await import('/src/audio/cues.ts');
        const { TimelineNode } = await import('/src/audio/timeline.ts');
        CUES.__phase_sine = { timeline: true, fn: (voice) => voice.osc('sine', 880, voice.t, voice.t + 1, voice.wet) };
        const original = TimelineNode.prototype.moment;
        const limit = (promise, name) => {
          let timeout;
          return Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${name} timed out`)), 15000); })]).finally(() => clearTimeout(timeout));
        };
        try {
            const clock = new AudioContext();
            const engine = new AudioEngine(clock);
            try {
              await engine.timeline.ready;
              await clock.audioWorklet.addModule('/scripts/e2e/audio-wave-recorder.mjs');
              await limit(engine.unlock(), 'Audio resume');
              const audio = new AudioWorkletNode(clock, 'e2e-wave', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
              engine.testInput('sfx').connect(audio);
              audio.connect(clock.destination);
              const frame = Math.ceil((clock.currentTime + 0.8) * clock.sampleRate / 128) * 128;
              const start = (frame + 37.25) / clock.sampleRate;
              const record = (node) => {
                const ready = new Promise((resolve, reject) => {
                  node.port.onmessage = ({ data }) => resolve(data);
                  node.onprocessorerror = () => reject(new Error('The recorder stopped'));
                });
                node.port.postMessage({ from: frame - 128, length: 512 });
                return ready;
              };
              const output = record(audio);
              let control;
              let raw;
              let oscillator;
              let intrinsic;
              const makeOscillator = clock.createOscillator.bind(clock);
              clock.createOscillator = () => (oscillator = makeOscillator());
              TimelineNode.prototype.moment = function (requested, events) {
                const frequency = events.find((event) => event.kind === 'align').channel;
                const gate = events.find((event) => event.kind === 'set' && event.value === 1).channel;
                const split = clock.createChannelSplitter(32);
                const merge = clock.createChannelMerger(2);
                const probe = new AudioWorkletNode(clock, 'e2e-wave', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
                this.node.connect(split);
                split.connect(merge, frequency, 0);
                split.connect(merge, gate, 1);
                merge.connect(probe);
                probe.connect(clock.destination);
                control = record(probe);
                const rawProbe = new AudioWorkletNode(clock, 'e2e-wave', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
                oscillator.connect(rawProbe);
                rawProbe.connect(clock.destination);
                raw = record(rawProbe);
                intrinsic = oscillator.frequency.value;
                return original.call(this, requested, events);
              };
              const handle = engine.play('__phase_sine', { at: start });
              const ack = await limit(handle.started, 'Cue acknowledgement');
              const [sound, signals, waveform] = await limit(Promise.all([output, control, raw]), 'Waveform recording');
              const first = (data) => data.findIndex((value) => Math.abs(value) > 1e-7);
              return { frame, start, ack: ack.start, frequency: first(signals.left), gate: first(signals.right), audio: first(sound.left), raw: first(waveform.left), intrinsic, values: [...sound.left.slice(164, 170)], rawValues: [...waveform.left.slice(164, 170)] };
            } finally {
              TimelineNode.prototype.moment = original;
              engine.dispose();
              if (clock.state !== 'closed') await new Promise((resolve) => clock.addEventListener('statechange', () => { if (clock.state === 'closed') resolve(); }, { once: true }));
            }
        } finally {
          TimelineNode.prototype.moment = original;
        }
        });
        results.push(result);
        note(h, 'phase-control', result);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
    h.expect(results.every((r) => r.frequency === 166 && r.gate === 166 && r.audio === 167), JSON.stringify(results));
    return results;
  },
  /**
   * The companion's short cues, played through its sound path again and again while the page stalls for 5 to 45 ms at a
   * time and the CPU is slowed: every one starts no more than two frames after it was asked for, nothing of it is placed
   * behind the audio clock, and the output holds all of it, attack first.
   */
  async 'every-cue-plays-whole-and-on-time-on-a-busy-page'(h) {
    const { ctx, page, errors, tap } = await boot(h, { music: 0, sfx: 1 });
    try {
      await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const play = AudioEngine.prototype.play;
        window.__plays = [];
        AudioEngine.prototype.play = function (cue, o) {
          const ask = this.ctx.currentTime;
          const t0 = performance.now();
          const was = window.__behind.length;
          window.__watch = true;
          try {
            const hd = play.call(this, cue, o);
            window.__plays.push({ cue, ask, done: this.ctx.currentTime, ms: performance.now() - t0, end: hd.end, behind: window.__behind.length - was });
            return hd;
          } finally {
            window.__watch = false;
          }
        };
      });
      const run = (rate, per) => page.evaluate(async ([cues, per, rate]) => {
        const { cueLength } = await import('/src/audio/engine.ts');
        const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
        let busy = true;
        const stalls = (async () => {
          while (busy) {
            const until = performance.now() + 5 + Math.random() * 40;
            while (performance.now() < until);
            await sleep(Math.random() * 30);
          }
        })();
        const from = window.__plays.length;
        // each one after the one before has rung out
        let last = 0;
        for (let k = 0; k < per; k++) {
          for (const cue of cues) {
            await sleep(last * 1000 + 50 + Math.random() * 100);
            window.__daily.sound(cue);
            last = cueLength(cue);
          }
        }
        await sleep(last * 1000);
        busy = false;
        await stalls;
        return window.__plays.slice(from).map((p) => ({ ...p, rate }));
      }, [CUES, per, rate]);
      // the check sets the page's CPU rate itself, full speed first, whatever rate the run slows every page by
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const plays = await run(1, 2);
      for (const rate of RATES) {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        plays.push(...(await run(rate, PER)));
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const rates = [1, ...RATES];
      const median = (r) => {
        const ms = plays.filter((p) => p.rate === r).map((p) => p.ms).sort((a, b) => a - b);
        return ms[ms.length >> 1];
      };
      // the throttle took hold: building a cue at CPU xN takes well over N / 4 times as long as at full speed
      const slow = RATES.find((r) => !(median(r) >= (median(1) * r) / 4));
      h.expect(!slow, `the CPU throttle at x${slow} did not slow the page: a cue built in a median ${median(slow)} ms, ${median(1)} ms at full speed`);
      await audioRecorded(page, tap, Math.max(...plays.map((p) => p.end)) + 0.5, 60000);

      // each cue rendered offline through the same output chain at the same levels, then for every play the recorded
      // energy of each quantum around it beside the energy its own render and those of the plays before it put there
      const measured = await page.evaluate(measureCueEnergy, [plays, tap, CUES, Q, ONSET, PARTS]);

      const sum = (bs, i) => bs.reduce((s, b) => s + b[i], 0);
      const verdicts = plays.map((p, i) => {
        const { start, blocks, onset, parts } = measured[i];
        const got = (bs) => sum(bs, 0) / (sum(bs, 1) + sum(bs, 2));
        const v = { cue: p.cue, rate: p.rate, buildMs: +p.ms.toFixed(2), leadMs: +((start - p.ask) * 1000).toFixed(1), behind: p.behind, first: +got(onset.slice(0, 2)).toFixed(2), attack: +got(onset).toFixed(2), parts: parts.map((bs) => +got(bs).toFixed(2)) };
        const why = [];
        if (onset.length < 3) why.push(`only ${onset.length} quanta of it ring over the cues before it, too few to judge`);
        if (blocks.some((b) => !Number.isFinite(b[0]))) why.push('the recording has a hole');
        if (start < p.ask - 1e-4 || start > p.done + LEAD + 1e-4) why.push(`it starts ${v.leadMs} ms after it was asked for`);
        if (p.behind) why.push(`${p.behind} of its parts were placed behind the audio clock`);
        // a late start leaves its first quanta empty; a dropped cue leaves all of them
        if (!(v.first >= 0.5)) why.push(`its first quanta hold ${(v.first * 100).toFixed(0)}% of their energy`);
        if (!(v.attack >= 0.6 && v.attack <= 1.7)) why.push(`its attack holds ${(v.attack * 100).toFixed(0)}% of its energy`);
        v.parts.forEach((g, k) => {
          if (!(g >= 0.7 && g <= 1.4)) why.push(`the part of it up to ${PARTS[k] * 100}% of its energy holds ${(g * 100).toFixed(0)}% of it`);
        });
        return { ...v, why };
      });
      const bad = verdicts.filter((v) => v.why.length);
      for (const v of verdicts) note(h, 'busy', v);
      const at = (r) => verdicts.filter((v) => v.rate === r);
      const heard = (v) => !(v.first >= 0.5 && v.attack >= 0.6 && v.attack <= 1.7 && v.parts.every((g) => g >= 0.7 && g <= 1.4));
      const summary = { buildMs: rates.map(median), rates, plays: verdicts.length, bad: bad.length, perRate: rates.map((r) => ({ rate: r, of: at(r).length, bad: at(r).filter((v) => v.why.length).length, heard: at(r).filter(heard).length, behind: at(r).filter((v) => v.behind).length, slowestBuildMs: Math.max(...at(r).map((v) => v.buildMs)) })) };
      note(h, 'busy-summary', summary);
      h.expect(!bad.length, `${bad.length} of ${verdicts.length} cues did not play whole and on time: ` + bad.slice(0, 8).map((v) => `${v.cue} at CPU x${v.rate} (built in ${v.buildMs} ms): ${v.why.join(', ')}`).join('; '));
      h.expect(!errors.length, errors.join('\n'));
      return summary;
    } finally {
      await ctx.close();
    }
  },

  /**
   * Each part of the score opened in turn, as the intro and the companion open them, and AWAKEN's hit played into its
   * build, once on time and once straight after a 1.3 s stall, with the CPU slowed 4, 10 and 20 times: building a part
   * and placing its first notes takes tens of milliseconds then, and none of it (nor of the hit and the roar it opens) is
   * placed behind the audio clock, a part starts no more than two frames past the clock once it is built,
   * each is heard, and the roar's first chord after the stall is as full as the one without it (heard before the roar's
   * first notes, 0.2 s on).
   */
  async 'every-score-part-opens-on-time-on-a-busy-page'(h) {
    const { ctx, page, errors, tap } = await boot(h, { music: 1, sfx: 0 });
    try {
      await page.evaluate(recordOpens);
      await page.evaluate(async () => {
        const { Music } = await import('/src/audio/music.ts');
        const schedule = Music.prototype.scheduleUntil;
        Music.prototype.scheduleUntil = function (...a) {
          window.__music = this;
          return schedule.apply(this, a);
        };
      });
      await page.waitForFunction(() => !!window.__music);
      const cdp = await ctx.newCDPSession(page);
      const opened = [];
      for (const rate of RATES) {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        opened.push(...(await page.evaluate(async ([sections, rate]) => {
          const clock = window.__taps.find((t) => t.from === 'GainNode').context;
          const out = [];
          const watched = (name, fn) => {
            const was = window.__behind.length;
            const opened = window.__opens.length;
            const ask = clock.currentTime;
            const t0 = performance.now();
            window.__watch = true;
            fn();
            window.__watch = false;
            const opens = window.__opens.slice(opened);
            const ms = performance.now() - t0;
            return { name, rate, ask, done: clock.currentTime, ms, behind: window.__behind.slice(was), opens };
          };
          for (const name of sections) {
            const o = watched(name, () => window.__music.to(name, 0.3));
            out.push({ ...o, start: window.__music.live.at(-1).start });
            if (name === 'awaken') {
              await new Promise((done) => setTimeout(done, 600));
              out.push({ ...watched('awaken hit', () => window.__daily.sound('awaken_hit')), hit: true });
            }
            await new Promise((done) => setTimeout(done, 1200));
          }
          // the hit straight after a stall longer than the score is placed ahead
          window.__music.to('awaken', 0.3);
          await new Promise((done) => setTimeout(done, 600));
          const until = clock.currentTime + 1.3;
          while (clock.currentTime < until);
          out.push({ ...watched('awaken hit after a stall', () => window.__daily.sound('awaken_hit')), hit: true });
          await new Promise((done) => setTimeout(done, 1200));
          return out;
        }, [SECTIONS, rate])));
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await audioRecorded(page, tap, Math.max(...opened.map((o) => o.start ?? o.done)) + 1.2);
      const bad = [];
      const levels = {};
      for (const o of opened) {
        const level = await page.evaluate(([n, a, b, Q]) => {
          const rec = window.__taps[n];
          const per = Q / rec.context.sampleRate;
          const qs = [...rec.q].filter(([i]) => i * per >= a && i * per < b);
          return Math.sqrt(qs.reduce((s, [, [, ss]]) => s + ss, 0) / Math.max(1, qs.length * Q));
        }, [tap, ...(o.hit ? [o.done + LEAD + 0.03, o.done + LEAD + 0.19] : [o.start + 0.25, o.start + 1.1]), Q]);
        const v = { part: o.name, rate: o.rate, buildMs: +o.ms.toFixed(1), leadMs: o.hit ? null : +((o.start - o.done) * 1000).toFixed(1), behind: o.behind.length, worstMs: o.behind.length ? +(Math.max(...o.behind.map((b) => b[1])) * 1000).toFixed(1) : 0, level };
        note(h, 'score-part', v);
        levels[`${o.name} ${o.rate}`] = level;
        const why = [];
        if (v.behind) why.push(`${v.behind} of its parts were placed up to ${v.worstMs} ms behind the audio clock (${[...new Set(o.behind.map((b) => b[0]))].join(', ')})`);
        const late = o.start < o.ask - 1e-4 || o.start > o.done + LEAD + 1e-4;
        if (!o.hit && late) why.push(`it starts ${v.leadMs} ms past the clock once it is built`);
        if (!(level > 3e-4)) why.push(`it was not heard (RMS ${level})`);
        const roarLag = o.hit ? Math.max(...o.opens) - Math.min(...o.opens) : 0;
        if (o.hit && !(o.opens.length >= 2 && roarLag < 1e-6)) {
          why.push(`its roar opened ${(roarLag * 1000).toFixed(1)} ms after the hit (${o.opens.length} parts opened)`);
        }
        const plain = levels[`awaken hit ${o.rate}`];
        if (o.name === 'awaken hit after a stall' && !(level >= 0.7 * plain)) why.push(`its first chord is at ${((level / plain) * 100).toFixed(0)}% of the one without a stall`);
        if (why.length) bad.push(`${o.name} at CPU x${o.rate} (built in ${v.buildMs} ms): ${why.join(', ')}`);
      }
      h.expect(!bad.length, `${bad.length} of ${opened.length} parts of the score did not open on time: ${bad.join('; ')}`);
      h.expect(!errors.length, errors.join('\n'));
      return { opened: opened.length, slowestMs: Math.max(...opened.map((o) => +o.ms.toFixed(1))) };
    } finally {
      await ctx.close();
    }
  },

  'every-bed-and-the-charge-loop-start-on-time-however-slow-their-build': (h) =>
    startsOnTimeHoweverSlowItsBuild(h, 'beds'),

  'every-score-section-and-the-hush-open-on-time-however-slow-their-build': (h) =>
    startsOnTimeHoweverSlowItsBuild(h, 'score'),

  /**
   * In the intro the gate's crack, the hit and the chest's burst are asked for on the frame their picture lands (the crack
   * 0.1 s after the air before it, the hit 0.75 s after the hush, the burst with the duck that lifts for it) and sound
   * two frames later, the lead every sound gets: visuals lead their sound by 1 or 2 frames, not 4. A picture lands on the
   * first frame at or past its time on the beat clock, which on a slow device can be a long frame later, so each sound is
   * checked against that time (asked for at it, on the first frame at or past it), not against the frame the sound before
   * it was asked on.
   */
  async 'the-crack-hit-and-burst-sound-two-frames-after-their-pictures'(h) {
    const result = {};
    for (const [beat, cue, from, after] of [['gate', 'gate_crack', 'gate_air', 0.1], ['awaken', 'awaken_hit', 'hush', 0.75], ['chest', 'chest_burst', 'duck', 0]]) {
      const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, `?shot=${beat}&mute&dpr=1&nopost`);
      try {
        await page.locator('.title-screen').waitFor({ timeout: 60000 });
        await page.evaluate(async () => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const { Director } = await import('/src/cutscene/director.ts');
          const { uiNow } = await import('/src/ui/anim.ts');
          window.__asked = [];
          // the stage times of the frame before this one and of this one (a frame the stage held its clock on shows nothing new)
          let frames = [-Infinity, -Infinity];
          const watch = () => {
            if (!window.__stage) return requestAnimationFrame(watch);
            window.__stage.onUpdate((t) => {
              if (t !== frames[1]) frames = [frames[1], t];
            });
          };
          watch();
          // what a beat cue asks for is due at the cue's time on the beat clock; anything else when it is asked
          let due;
          const cue = Director.prototype.cue;
          Director.prototype.cue = function (sec, fn) {
            const at = uiNow() + sec;
            return cue.call(this, sec, () => {
              due = at;
              try {
                fn();
              } finally {
                due = undefined;
              }
            });
          };
          for (const m of ['play', 'hush', 'duck']) {
            const f = AudioEngine.prototype[m];
            AudioEngine.prototype[m] = function (...a) {
              const r = f.apply(this, a);
              window.__asked.push({ what: m === 'play' ? a[0] : m, picture: window.__stage.time, before: frames[0], due: due ?? window.__stage.time, done: this.ctx.currentTime, end: r?.end });
              return r;
            };
          }
        });
        await page.locator('.title-screen').press('Enter');
        if (beat === 'chest') {
          // hold Space to charge the chest, as a player does, until it bursts
          await page.locator('.ch-target').waitFor({ timeout: 60000 });
          await page.keyboard.down(' ');
        }
        await page.waitForFunction((cue) => window.__asked.some((c) => c.what === cue), cue, { timeout: 60000 });
        if (beat === 'chest') await page.keyboard.up(' ');
        const r = await page.evaluate(async ([cue, from, after]) => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const hit = window.__asked.find((c) => c.what === cue);
          const ref = window.__asked.filter((c) => c.what === from && c.picture <= hit.picture).at(-1);
          const len = new AudioEngine(new OfflineAudioContext(2, 48000, 48000)).play(cue, { at: 0 }).end;
          return { picture: ref.due + after, due: hit.due, at: hit.picture, before: hit.before, lead: hit.end - len - hit.done };
        }, [cue, from, after]);
        const late = r.due - r.picture;
        result[cue] = { askedLateMs: +(late * 1000).toFixed(1), frameLateMs: +((r.at - r.due) * 1000).toFixed(1), frameMs: +((r.at - r.before) * 1000).toFixed(1), leadMs: +(r.lead * 1000).toFixed(1) };
        note(h, 'gap', { cue, ...result[cue] });
        h.expect(Math.abs(late) < 1e-6, `${cue} was asked for ${(late * 1000).toFixed(1)} ms after its picture on the beat clock`);
        // a frame within rounding of its time may show it or leave it to the next frame, as the picture does
        h.expect(r.at >= r.due - 1e-6 && r.before < r.due + 1e-6, `${cue} was asked for on a frame ${((r.at - r.due) * 1000).toFixed(1)} ms past its time, not the first one at or past it`);
        h.expect(r.lead > 0 && r.lead <= LEAD + 1e-4, `${cue} sounds ${(r.lead * 1000).toFixed(1)} ms past the clock once it was asked for`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
    return result;
  },

  /**
   * A stop is final. Rendered as a capture renders the intro, the reward's cut stops AWAKEN before AWAKEN reaches its
   * hit, so the roar, held until the hit opens it, opens after its stop: none of it, nor any note AWAKEN places then,
   * is scheduled past the moment the stop has silenced it.
   */
  async 'a-part-stopped-before-it-opens-places-nothing-past-its-stop'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        const { renderOffline } = await import('/src/audio/engine.ts');
        const { stoppedBy } = await import('/src/audio/voice.ts');
        const placed = new Map();
        const S = AudioScheduledSourceNode.prototype;
        const start = S.start;
        const stop = S.stop;
        S.start = function (t, ...a) {
          placed.set(this, { start: t, stop: Infinity });
          return start.call(this, t, ...a);
        };
        S.stop = function (t) {
          const p = placed.get(this);
          if (p) p.stop = t;
          return stop.call(this, t);
        };
        const [hit, cut, fadeOut] = [1, 1.5, 0.04];
        try {
          await renderOffline([{ t: 0.1, cue: 'music', opts: { section: 'awaken', fade: 0.3, hitAt: hit } }, { t: cut, cue: 'music', opts: { section: 'reward', fade: 3.5, fadeOut } }], 2.5, 48000);
        } finally {
          S.start = start;
          S.stop = stop;
        }
        const silent = stoppedBy(cut, fadeOut);
        // what AWAKEN started once its stop was asked for: the roar at the hit and the notes after it, before the cut
        const late = [...placed.values()].filter((p) => p.start >= hit && p.start < cut);
        return { silent, late: late.length, past: late.filter((p) => p.stop > silent + 1e-9).map((p) => +p.stop.toFixed(3)) };
      });
      note(h, 'stopped-part', { ...r, past: r.past.length, longest: r.past.length ? Math.max(...r.past) : null });
      h.expect(r.late > 0, 'AWAKEN placed nothing between its hit and its stop, so the stop was not tested');
      h.expect(!r.past.length, `${r.past.length} of the ${r.late} sources AWAKEN placed after its stop was asked for run past it (${r.silent.toFixed(3)} s), up to ${Math.max(...r.past)} s`);
      h.expect(!errors.length, errors.join('\n'));
      return { placedAfterStop: r.late };
    } finally {
      await ctx.close();
    }
  },

  async 'a-hit-scheduled-in-the-first-window-opens-the-roar-on-the-hit'(h) {
    const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
    try {
      await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
      const [at, hit] = [0.3, 0.9];
      const opens = await page.evaluate(async ([at, hit]) => {
        const { renderOffline } = await import('/src/audio/engine.ts');
        const { Voice } = await import('/src/audio/voice.ts');
        const open = Voice.prototype.open;
        const opens = [];
        Voice.prototype.open = function (t) {
          opens.push(t);
          return open.call(this, t);
        };
        try {
          const awaken = { t: at, cue: 'music', opts: { section: 'awaken', fade: 0.3, hitAt: hit } };
          await renderOffline([awaken], hit + 0.05, 48000);
        } finally {
          Voice.prototype.open = open;
        }
        return opens;
      }, [at, hit]);
      note(h, 'hit-in-first-window', { opens });
      const roar = opens.filter((t) => t > at + 1e-9);
      const where = roar.length ? roar.map((t) => t.toFixed(3)).join(', ') + ' s' : 'never';
      const onTheHit = roar.length === 1 && Math.abs(roar[0] - hit) < 1e-9;
      h.expect(onTheHit, `the roar opened ${where}, not once on the hit at ${hit} s`);
      h.expect(!errors.length, errors.join('\n'));
      return { opens: opens.length };
    } finally {
      await ctx.close();
    }
  },


  /**
   * The score is scheduled up to 0.7 s ahead. A stall longer than that, across one of the calm score's chord changes,
   * leaves the change behind the clock: it is dropped, so nothing is placed in the past, and the score plays on.
   */
  async 'the-score-drops-what-a-long-stall-missed'(h) {
    const { ctx, page, errors, tap } = await boot(h, { music: 1, sfx: 0 });
    try {
      // the score fades in over its first seconds on Home
      await h.sleep(4000);
      const r = await page.evaluate(async () => {
        const { Music } = await import('/src/audio/music.ts');
        const clock = window.__taps.find((t) => t.from === 'GainNode').context;
        const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
        const schedule = Music.prototype.scheduleUntil;
        let music;
        Music.prototype.scheduleUntil = function (...a) {
          music = this;
          return schedule.apply(this, a);
        };
        while (!music) await sleep(20);
        // the calm score changes chord every 8 s from its start (src/audio/music.ts)
        const calm = music.live.find((s) => s.name === 'calm' && s.end === Infinity);
        const change = calm.start + 8 * Math.ceil((clock.currentTime + 1.5 - calm.start) / 8);
        while (clock.currentTime < change - 1) await sleep(10);
        const from = clock.currentTime;
        while (clock.currentTime < change + 0.3);
        const to = clock.currentTime;
        window.__watch = true;
        await sleep(1500);
        window.__watch = false;
        return { change, from, to, behind: window.__behind };
      });
      await audioRecorded(page, tap, r.to + 2);
      const rms = (a, b) => page.evaluate(([n, a, b, Q]) => {
        const rec = window.__taps[n];
        const per = Q / rec.context.sampleRate;
        const qs = [...rec.q].filter(([i]) => i * per >= a && i * per < b);
        return Math.sqrt(qs.reduce((s, [, [, ss]]) => s + ss, 0) / Math.max(1, qs.length * Q));
      }, [tap, a, b, Q]);
      const before = await rms(r.from - 1.5, r.from);
      const level = (await rms(r.to + 0.5, r.to + 2)) / before;
      note(h, 'stall', { ...r, behind: r.behind.length, worstMs: r.behind.length ? Math.max(...r.behind.map((b) => b[1])) * 1000 : 0, before, level });
      h.expect(r.to - r.from > 1.2, `the stall lasted only ${(r.to - r.from).toFixed(2)} s of audio clock`);
      h.expect(!r.behind.length, `after the stall the score placed ${r.behind.length} parts behind the audio clock, up to ${(Math.max(...r.behind.map((b) => b[1])) * 1000).toFixed(0)} ms late (${[...new Set(r.behind.map((b) => b[0]))].join(', ')})`);
      h.expect(before > 1e-4 && level > 0.3, `the score fell away after the stall: ${(level * 100).toFixed(0)}% of its level before it (RMS ${before})`);
      h.expect(!errors.length, errors.join('\n'));
      return { stallSec: +(r.to - r.from).toFixed(2), level: +level.toFixed(4) };
    } finally {
      await ctx.close();
    }
  },
};
