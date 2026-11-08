import { finalControlDeadline, globalControlOrder } from './cue-final-control-checks.mjs';
import {
  pendingStops, pendingHandleStops, explicitHitGate, slowCueStop, pendingLevels, riderStop, existingStops,
} from './cue-pending-checks.mjs';
import {
  continuedSounds, missedAttacks, stoppedParts, slowCleanupOpens, lateSectionKeepsItsWindow,
  lateSectionWaitsForItsOpening, expiredNoteStaysSilent,
} from './cue-continuation-checks.mjs';
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
import {
  doorPath, stalledDoorPath, independentStops, spareRoarGoes, repeatedMisses, sharedGateOutlivesTheHit,
} from './cue-door-checks.mjs';
import { timedHush, lastSourceStall, expiredEnds, fixedScoreTimes } from './cue-end-checks.mjs';
import { expiredBuilds } from './cue-deadline-checks.mjs';
import { droppedRelease, checkedRoar, unownedDoor } from './cue-release-checks.mjs';

/** What each check measured, in the run's artifacts. */
const note = (h, name, o) => fs.appendFileSync(path.join(h.out, 'cues-on-time.jsonl'), JSON.stringify({ name, ...o }) + '\n');

const AUDIO = 'dbt.audio.v1';
const Q = 128;
// the companion's short cues that sound the same every time (card_flip's attack is random noise and bubble's notes
// fall by chance, so one play can't be matched quantum by quantum against a render), and whose start follows from the
// end of their handle
const CUES = ['ui_tap', 'ui_close', 'check', 'soft_chime'];
const PER = 5;
// the CPU slowed 4, 10 and 20 times
const RATES = [4, 10, 20];
// visuals lead their sound by 1 or 2 frames (DESIGN.md)
const LEAD = 2 / 60;
const STALL = 3 * LEAD;
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
  await audioReady(page);
  await h.reachHub(page);
  // the engine's output tap, and a count of every time something is placed behind the audio clock while `window.__watch`
  // is set: such a part has already been rendered past, so it starts late, cuts in or never plays
  const tap = await page.evaluate(async () => {
    const { tapAudioSchedule } = await import('/scripts/e2e/audio-schedule.mjs');
    const tap = window.__taps.findIndex((t) => t.from === 'GainNode');
    const clock = window.__taps[tap].context;
    window.__behind = [];
    window.__scheduled = [];
    window.__watch = false;
    window.__stall = null;
    window.__stalls = [];
    window.__started = 0;
    const behind = (what, t) => {
      if (!window.__watch || !(t > 0)) return;
      window.__scheduled.push(t);
      if (t < clock.currentTime) window.__behind.push([what, clock.currentTime - t]);
    };
    const stall = (what) => {
      if (!window.__watch || window.__stall?.after !== what) return;
      if (window.__stall.nth && --window.__stall.nth > 0) return;
      const from = clock.currentTime;
      const until = from + window.__stall.by;
      window.__stall = null;
      while (clock.currentTime < until);
      window.__stalls.push({ what, from, to: clock.currentTime });
    };
    tapAudioSchedule((_, method, args, time) => behind(method, time), (receiver, method) => {
      if (receiver instanceof ConstantSourceNode) return;
      if (window.__watch && method === 'start') window.__started++;
      stall(method);
    });
    return tap;
  });
  return { ctx, page, errors, tap };
}

async function recordOpens() {
  const { Voice } = await import('/src/audio/voice.ts');
  const { soon } = await import('/src/audio/param.ts');
  const { SCORE } = await import('/src/motion/tokens.ts');
  window.__opens = [];
  window.__extras = [];
  window.__drops = [];
  window.__late = SCORE.lateSec;
  const open = Voice.prototype.openInTime;
  Voice.prototype.openInTime = function (...args) {
    const riders = [this, ...this.riders];
    const earliest = Math.max(args[0] ?? 0, soon(this.ctx)) + args[1];
    const kept = open.apply(this, args);
    if (window.__watch && kept) {
      window.__opens.push(...riders.map((v) => v.openedAt));
      window.__extras.push(...riders.map(() => args[1]));
    }
    if (window.__watch && !kept) {
      const released = riders.every((v) => v.isStopped && !v.doors.length && v.parts.every((p) => p.isStopped));
      window.__drops.push({ deadline: args[2], returned: this.ctx.currentTime, earliest, released,
        nextAt: soon(this.ctx) + 2 * args[1] + SCORE.leadSec });
    }
    return kept;
  };
}

const SLOW_BUILDS = {
  beds: { levels: { music: 0, sfx: 1 }, hold: 0.6, what: 'beds and charge loops' },
  cues: { levels: { music: 0, sfx: 1 }, hold: 0.6, what: 'cues' },
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
      started.push(...(await page.evaluate(async ([kind, hold, rate, LEAD, STALL, tap, Q]) => {
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
        const silence = (level = 3e-5) => {
          const from = clock.currentTime;
          const heard = () => rec.end !== undefined && ((rec.end - 31) * Q) / clock.sampleRate > from;
          return until(() => heard() && recent() < level, 'silence before the next opening');
        };
        const out = [];
        const watched = (after, fn) => {
          const was = window.__behind.length;
          window.__stall = { after, by: STALL };
          window.__watch = true;
          const r = fn();
          window.__watch = false;
          const stalled = window.__stall === null;
          window.__stall = null;
          return { r, stalled, behind: window.__behind.slice(was) };
        };
        const play = async (name, start, stop, span = hold) => {
          await silence(name === 'awaken_voice' ? 1e-7 : 3e-5);
          const opened = window.__opens.length;
          const missed = window.__drops.length;
          const ask = clock.currentTime;
          const t0 = performance.now();
          const starting = window.__started;
          const { r: handle, stalled, behind } = watched('start', () => start(ask));
          const sources = window.__started - starting;
          const dropped = window.__opens.length === opened
            ? { from: ask, to: clock.currentTime + span, attempts: window.__drops.slice(missed) } : null;
          const ms = performance.now() - t0;
          const opens = window.__opens.slice(opened);
          const extra = window.__extras[opened];
          const deadline = ask + window.__late;
          const s = { name, rate, ask, deadline, done: clock.currentTime, ms, behind, stalled,
            opens, extra, dropped, span, sources, attempts: window.__drops.length - missed };
          out.push(s);
          await reach(dropped ? dropped.to : Math.max(ask, ...opens) + span);
          const at = clock.currentTime + LEAD;
          const ended = watched('stop', () => stop(handle, at));
          Object.assign(s, { stopBehind: ended.behind, stopStalled: ended.stalled });
          await reach(stoppedBy(at, 0.05));
        };
        if (kind === 'cues') {
          const { CUE_NAMES, cueLength } = await import('/src/audio/engine.ts');
          for (const cue of CUE_NAMES) {
            await play(cue, (at) => engine.play(cue, { at }),
              (h, at) => h.stop(at, 0.05), cueLength(cue));
          }
          return out;
        }
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
      }, [kind, hold, rate, LEAD, STALL, tap, Q])));
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await audioRecorded(page, tap, Math.max(...started.map((s) => Math.max(s.ask, ...s.opens))) + hold);
    const bad = [];
    for (const s of started) {
      const at = s.opens.length ? Math.min(...s.opens) : s.ask;
      const lag = s.opens.length ? Math.max(...s.opens) - at : 0;
      const { rms } = await audioHeard(page, tap, at + Math.min(0.2, s.span / 10), at + s.span * 0.9, [0, 0]);
      const before = (await audioHeard(page, tap, Math.min(at - 0.1, s.ask), at - 0.01, [0, 0])).rms;
      const worstMs = s.behind.length ? Math.max(...s.behind.map((b) => b[1])) * 1000 : 0;
      const leadMs = +((at - s.done) * 1000).toFixed(1);
      const buildMs = +s.ms.toFixed(1);
      const { stalled, stopStalled } = s;
      const behind = s.behind.length;
      const part = s.name;
      note(h, kind, {
        part, rate: s.rate, buildMs, behind, worstMs, leadMs, rms, before, stalled, stopStalled, dropped: s.dropped,
      });
      const why = [];
      if (s.dropped) {
        if (kind !== 'cues') why.push('the stalled long sound was dropped');
        const { from, to, attempts } = s.dropped;
        const lost = await audioHeard(page, tap, from, to, [0, 0]);
        if (lost.cover !== 1 || lost.rms >= 1e-4) why.push(`a dropped build was heard (RMS ${lost.rms})`);
        const last = attempts.at(-1);
        if (!last || !Number.isFinite(last.deadline) || Math.max(last.earliest, last.nextAt) < last.deadline) {
          why.push(`a build was dropped before its deadline: ${JSON.stringify(attempts)}`);
        }
        if (!attempts.every((a) => a.released)) why.push('a dropped build kept its holds');
      }
      const placed = [[s.behind, 'of its parts were placed'], [s.stopBehind, 'parts of its stop were placed']];
      for (const [list, what] of placed) {
        if (!list.length) continue;
        const where = [...new Set(list.map((b) => b[0]))].join(', ');
        const worst = (Math.max(...list.map((b) => b[1])) * 1000).toFixed(1);
        why.push(`${list.length} ${what} up to ${worst} ms behind the clock (${where})`);
      }
      const silent = kind === 'cues' && s.name === 'awaken_voice';
      const firstAttempt = s.dropped?.attempts[0];
      const expiredBeforePlacement = firstAttempt && firstAttempt.earliest >= firstAttempt.deadline;
      if (!stalled && !silent && !expiredBeforePlacement) {
        const counts = `${s.sources} sources started, ${s.attempts} attempts dropped`;
        why.push(`the page never stalled while it was placed (${counts}), so the stall was not tested`);
      }
      const untested = 'the page never stalled while it was stopped, so that stall was not tested';
      if (kind !== 'cues' && !stopStalled) why.push(untested);
      if (!s.opens.length && !s.dropped) why.push('it never opened');
      else if (at < s.ask - 1e-4 || at - s.extra > s.done + LEAD + 1e-4) {
        why.push(`it opens ${leadMs} ms past the clock with ${s.extra * 1000} ms of retry lead`);
      }
      if (!s.dropped && kind === 'cues' && at > s.deadline) {
        why.push(`it opened at ${at}, past the deadline ${s.deadline}`);
      }
      if (lag > 1e-6) why.push(`its parts opened ${(lag * 1000).toFixed(1)} ms apart`);
      if (!(before < 1e-4)) why.push(`something still sounded as it opened (RMS ${before})`);
      if (!s.dropped && (silent ? rms >= 1e-6 : rms <= 3e-4)) why.push(`its level was wrong (RMS ${rms})`);
      if (why.length) bad.push(`${s.name} at CPU x${s.rate} (built in ${s.ms.toFixed(1)} ms): ${why.join(', ')}`);
    }
    h.expect(!bad.length, `${bad.length} of ${started.length} ${what} did not start on time: ${bad.join('; ')}`);
    h.expect(!errors.length, errors.join('\n'));
    return { started: started.length, slowestMs: Math.max(...started.map((s) => +s.ms.toFixed(1))) };
  } finally {
    await ctx.close();
  }
}

export const scenarios = {
  'stopping-an-opened-voice-ends-unopened-part-gates': stoppedParts,
  'slow-cleanups-still-open-a-late-continuing-sound': slowCleanupOpens,
  'a-late-section-schedules-on-from-its-first-window': async (h) =>
    lateSectionKeepsItsWindow(h, await boot(h, { music: 1, sfx: 0 })),
  'a-section-opened-past-its-first-window-places-nothing-before-it': async (h) =>
    lateSectionWaitsForItsOpening(h, await boot(h, { music: 1, sfx: 0 })),
  'a-note-placed-after-its-end-stays-silent': expiredNoteStaysSilent,
  'cleanup-stalls-never-open-a-score-gate-behind-the-clock': async (h) =>
    missedAttacks(h, await boot(h, { music: 1, sfx: 1 }), true),
  'a-late-score-opening-drops-attacks-that-already-started': async (h) =>
    missedAttacks(h, await boot(h, { music: 1, sfx: 1 })),
  'the-last-queued-control-rechecks-every-opening-deadline': async (h) =>
    finalControlDeadline(h, await boot(h, { music: 1, sfx: 1 })),
  'score-controls-keep-their-order-across-reset-and-new-sections': async (h) =>
    globalControlOrder(h, await boot(h, { music: 1, sfx: 1 })),
  'existing-sounds-keep-their-stops-while-an-unrelated-sound-builds': async (h) =>
    existingStops(h, await boot(h, { music: 1, sfx: 1 })),
  'a-rebuilt-pair-keeps-the-stop-on-the-sound-that-asked-for-it': async (h) =>
    riderStop(h, await boot(h, { music: 0, sfx: 1 })),
  'held-sounds-keep-level-filter-lift-and-release-controls': async (h) =>
    pendingLevels(h, await boot(h, { music: 1, sfx: 1 })),
  'a-cue-stopped-during-its-build-never-sounds': async (h) =>
    slowCueStop(h, await boot(h, { music: 0, sfx: 1 })),
  'pending-bed-and-charge-handles-keep-their-stops-across-retries': async (h) =>
    pendingHandleStops(h, await boot(h, { music: 0, sfx: 1 })),
  'pending-beds-and-charge-honour-separate-stop-events': async (h) =>
    pendingStops(h, await boot(h, { music: 1, sfx: 1 })),
  'a-stalled-explicit-hit-drops-its-roar-and-the-next-hit-brings-a-new-one': async (h) =>
    explicitHitGate(h, await boot(h, { music: 1, sfx: 1 }), 'hit'),
  'a-stalled-roar-drops-its-explicit-hit-and-the-next-hit-brings-a-new-one': async (h) =>
    explicitHitGate(h, await boot(h, { music: 1, sfx: 1 }), 'roar'),
  'late-long-sounds-continue-and-end-the-outgoing-section': async (h) =>
    continuedSounds(h, await boot(h, { music: 1, sfx: 1 })),
  'retries-drop-sounds-that-have-already-ended': async (h) =>
    expiredEnds(h, await boot(h, { music: 0, sfx: 1 })),
  'a-retried-score-keeps-the-asked-hit-and-stand-times': async (h) =>
    fixedScoreTimes(h, await boot(h, { music: 1, sfx: 1 })),
  'a-retried-hush-keeps-its-asked-end': async (h) =>
    timedHush(h, await boot(h, { music: 1, sfx: 1 })),
  'a-stall-after-the-last-source-start-keeps-every-time-ahead': async (h) =>
    lastSourceStall(h, await boot(h, { music: 0, sfx: 1 })),
  'a-dropped-hit-releases-the-music-and-beds': async (h) =>
    droppedRelease(h, await boot(h, { music: 1, sfx: 1 })),
  'a-dropped-close-releases-the-score-lift': async (h) =>
    droppedRelease(h, await boot(h, { music: 1, sfx: 1 }), 'close'),
  'a-dropped-timed-hush-releases-the-hush-it-replaces': async (h) =>
    droppedRelease(h, await boot(h, { music: 1, sfx: 1 }), 'hush'),
  'a-stand-time-without-a-hit-time-opens-the-roar-checked': async (h) =>
    checkedRoar(h, await boot(h, { music: 1, sfx: 1 })),
  'held-sounds-door-unowned-destinations-too': async (h) =>
    unownedDoor(h, await boot(h, { music: 0, sfx: 1 })),
  'the-door-path-changes-no-sample': doorPath,
  'a-hit-cleanup-keeps-the-gate-its-roar-shares-until-the-score-ends': sharedGateOutlivesTheHit,
  'a-long-stall-after-opening-leaves-the-door-path-unchanged': async (h) =>
    stalledDoorPath(h, await boot(h, { music: 0, sfx: 1 })),
  'the-hit-and-roar-stop-independently': independentStops,
  'a-played-hit-lets-every-spare-roar-go': spareRoarGoes,
  'two-placement-misses-keep-the-sound-and-open-on-the-next-try': async (h) =>
    repeatedMisses(h, await boot(h, { music: 0, sfx: 1 }), 2 * LEAD),
  'placement-stalls-past-the-deadline-drop-the-sound-unheard': async (h) =>
    expiredBuilds(h, await boot(h, { music: 0, sfx: 1 })),
  async 'every-cue-plays-whole-and-on-time-on-a-busy-page'(h) {
    const { ctx, page, errors, tap } = await boot(h, { music: 0, sfx: 1 });
    try {
      await page.evaluate(async () => {
        const { AudioEngine } = await import('/src/audio/engine.ts');
        const { Voice } = await import('/src/audio/voice.ts');
        const { soon } = await import('/src/audio/param.ts');
        const open = Voice.prototype.openInTime;
        let attempts = [];
        Voice.prototype.openInTime = function (...args) {
          const kept = open.apply(this, args);
          attempts.push({ kept, extra: args[1], deadline: args[2] });
          return kept;
        };
        const play = AudioEngine.prototype.play;
        window.__plays = [];
        AudioEngine.prototype.play = function (cue, o) {
          const ask = this.ctx.currentTime;
          const t0 = performance.now();
          const was = window.__behind.length;
          window.__watch = true;
          attempts = [];
          try {
            const hd = play.call(this, cue, o);
            const opened = attempts.findLast((a) => a.kept);
            const latest = opened ? soon(this.ctx) + opened.extra : null;
            window.__plays.push({ cue, ask, latest, deadline: opened?.deadline,
              done: this.ctx.currentTime, ms: performance.now() - t0, end: hd.end,
              behind: window.__behind.length - was });
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
      const measured = await page.evaluate(async ([plays, tap, cues, Q, ONSET, PARTS]) => {
        const { AudioEngine, renderOffline } = await import('/src/audio/engine.ts');
        const rec = window.__taps[tap];
        const sr = rec.context.sampleRate;
        const length = Object.fromEntries(cues.map((cue) => [cue, new AudioEngine(new OfflineAudioContext(2, sr, sr)).play(cue, { at: 0 }).end]));
        const frame = plays.map((p) => (p.end - length[p.cue]) * sr);
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
      }, [plays, tap, CUES, Q, ONSET, PARTS]);

      const sum = (bs, i) => bs.reduce((s, b) => s + b[i], 0);
      const verdicts = plays.map((p, i) => {
        const { start, blocks, onset, parts } = measured[i];
        const got = (bs) => sum(bs, 0) / (sum(bs, 1) + sum(bs, 2));
        const v = { cue: p.cue, rate: p.rate, buildMs: +p.ms.toFixed(2), leadMs: +((start - p.ask) * 1000).toFixed(1), behind: p.behind, first: +got(onset.slice(0, 2)).toFixed(2), attack: +got(onset).toFixed(2), parts: parts.map((bs) => +got(bs).toFixed(2)) };
        const why = [];
        if (onset.length < 3) why.push(`only ${onset.length} quanta of it ring over the cues before it, too few to judge`);
        if (blocks.some((b) => !Number.isFinite(b[0]))) why.push('the recording has a hole');
        if (!Number.isFinite(p.latest) || start < p.ask - 1e-4 || start > p.latest + 1e-4 || start >= p.deadline) {
          why.push(`it starts ${v.leadMs} ms after it was asked for, outside its checked placement window`);
        }
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
        opened.push(...(await page.evaluate(async ([sections, rate, STALL]) => {
          const clock = window.__taps.find((t) => t.from === 'GainNode').context;
          const out = [];
          const watched = (name, fn, stall) => {
            const was = window.__behind.length;
            const opened = window.__opens.length;
            const ask = clock.currentTime;
            const t0 = performance.now();
            window.__stall = stall ? { after: 'start', by: STALL } : null;
            window.__watch = true;
            fn();
            window.__watch = false;
            const stalled = window.__stall === null;
            window.__stall = null;
            const opens = window.__opens.slice(opened);
            const extra = Math.max(0, ...window.__extras.slice(opened));
            const ms = performance.now() - t0;
            return { name, rate, ask, done: clock.currentTime, ms, behind: window.__behind.slice(was),
              opens, extra, stalled };
          };
          for (const name of sections) {
            const o = watched(name, () => window.__music.to(name, 0.3));
            out.push({ ...o, start: window.__music.live.at(-1).start });
            if (name === 'awaken') {
              await new Promise((done) => setTimeout(done, 600));
              out.push({ ...watched('awaken hit', () => window.__daily.sound('awaken_hit'), true), hit: true });
            }
            await new Promise((done) => setTimeout(done, 1200));
          }
          // the hit straight after a stall longer than the score is placed ahead
          window.__music.to('awaken', 0.3);
          await new Promise((done) => setTimeout(done, 600));
          const until = clock.currentTime + 1.3;
          while (clock.currentTime < until);
          const late = watched('awaken hit after a stall', () => window.__daily.sound('awaken_hit'), true);
          out.push({ ...late, hit: true });
          await new Promise((done) => setTimeout(done, 1200));
          return out;
        }, [SECTIONS, rate, STALL])));
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
        const late = o.start < o.ask - 1e-4 || o.start > o.done + LEAD + o.extra + 1e-4;
        if (!o.hit && late) why.push(`it starts ${v.leadMs} ms past the clock once it is built`);
        if (!(level > 3e-4)) why.push(`it was not heard (RMS ${level})`);
        const roarLag = o.hit ? Math.max(...o.opens) - Math.min(...o.opens) : 0;
        if (o.hit && !o.stalled) why.push('the page never stalled while it was placed, so the stall was not tested');
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

  'every-cue-starts-on-time-however-slow-its-build': (h) => startsOnTimeHoweverSlowItsBuild(h, 'cues'),

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
        const { Voice, stoppedBy } = await import('/src/audio/voice.ts');
        const { Music } = await import('/src/audio/music.ts');
        const placed = new Map();
        const musicSources = new WeakSet();
        let musicLib;
        const to = Music.prototype.to;
        const place = Voice.prototype.place;
        Music.prototype.to = function (...args) {
          musicLib = this.host.lib;
          return to.apply(this, args);
        };
        Voice.prototype.place = function (source, ...args) {
          if (this.lib === musicLib) musicSources.add(source.n);
          return place.call(this, source, ...args);
        };
        const S = AudioScheduledSourceNode.prototype;
        const start = S.start;
        const stop = S.stop;
        S.start = function (t, ...a) {
          if (musicSources.has(this)) placed.set(this, { start: t, stop: Infinity });
          return start.call(this, t, ...a);
        };
        S.stop = function (t) {
          const p = placed.get(this);
          if (p) p.stop = t;
          return stop.call(this, t);
        };
        const [hit, cut, fadeOut] = [1, 1.5, 0.04];
        try {
          await renderOffline([
            { t: 0.1, cue: 'music', opts: { section: 'awaken', fade: 0.3, hitAt: hit } },
            { t: hit, cue: 'awaken_hit' },
            { t: cut, cue: 'music', opts: { section: 'reward', fade: 3.5, fadeOut } },
          ], 2.5, 48000);
        } finally {
          S.start = start;
          S.stop = stop;
          Music.prototype.to = to;
          Voice.prototype.place = place;
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
        const open = Voice.prototype.openInTime;
        const opens = [];
        Voice.prototype.openInTime = function (...args) {
          opens.push(args[0]);
          return open.apply(this, args);
        };
        try {
          const awaken = { t: at, cue: 'music', opts: { section: 'awaken', fade: 0.3, hitAt: hit } };
          await renderOffline([awaken, { t: hit, cue: 'awaken_hit' }], hit + 0.05, 48000);
        } finally {
          Voice.prototype.openInTime = open;
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
