// Every cue plays whole and on time, even on a busy page. A cue is built before its start is read, then placed a stated
// lead past the audio clock (soon() in src/audio/param.ts), so neither a slow main thread building it nor the audio
// thread rendering ahead can push its start, attack or stop behind what has already been rendered. The companion's short cues play through its real sound path
// while the page stalls and the CPU is slowed, and each is measured on the real output, render quantum by render
// quantum, through its whole tail, against an offline render of the same cue placed where the engine put it. Each part
// of the score is built before its start is set, so it opens on time on a busy page too, and the score, scheduled ahead
// in windows, drops what a long stall made it miss instead of playing it late.
import fs from 'node:fs';
import path from 'node:path';
import { installAudioRecorder, audioReady, audioRecorded } from './audio-recorder.mjs';

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
  const tap = await page.evaluate(() => {
    const tap = window.__taps.findIndex((t) => t.from === 'GainNode');
    const clock = window.__taps[tap].context;
    window.__behind = [];
    window.__watch = false;
    const behind = (what, t) => {
      if (window.__watch && t > 0 && t < clock.currentTime) window.__behind.push([what, clock.currentTime - t]);
    };
    const P = AudioParam.prototype;
    for (const [m, i] of [['setValueAtTime', 1], ['linearRampToValueAtTime', 1], ['exponentialRampToValueAtTime', 1], ['setTargetAtTime', 1], ['cancelScheduledValues', 0], ['cancelAndHoldAtTime', 0]]) {
      const f = P[m];
      P[m] = function (...a) {
        behind(m, a[i]);
        return f.apply(this, a);
      };
    }
    const S = AudioScheduledSourceNode.prototype;
    for (const m of ['start', 'stop']) {
      const f = S[m];
      S[m] = function (...a) {
        behind(m, a[0]);
        return f.apply(this, a);
      };
    }
    return tap;
  });
  return { ctx, page, errors, tap };
}

export const scenarios = {
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
      const plays = await run(1, 2);
      const cdp = await ctx.newCDPSession(page);
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
        // well past the start of an offline render, where the limiter has settled
        const T0 = 0.25;
        const refs = {};
        for (const cue of cues) {
          const end = new AudioEngine(new OfflineAudioContext(2, sr, sr)).play(cue, { at: 0 }).end;
          const buf = await renderOffline([{ t: T0, cue }], T0 + 3.5, sr, { volume: window.__dbtVolume.gains().master, user: { master: 1, music: 0, sfx: 1, muted: false } });
          const [l, r] = [buf.getChannelData(0), buf.getChannelData(1)];
          const from = Math.round(T0 * sr);
          const cum = new Float64Array(l.length - from + 1);
          // the recorder hears the speakers' mix down to one channel
          for (let i = from; i < l.length; i++) cum[i - from + 1] = cum[i - from] + (0.5 * (l[i] + r[i])) ** 2;
          refs[cue] = { end, cum };
        }
        const starts = plays.map((p) => Math.round((p.end - refs[p.cue].end) * sr));
        const energy = (j, k) => {
          const { cum } = refs[plays[j].cue];
          const at = (f) => cum[Math.max(0, Math.min(cum.length - 1, f - starts[j]))];
          return at((k + 1) * Q) - at(k * Q);
        };
        return plays.map((p, i) => {
          const k0 = Math.floor(starts[i] / Q);
          const total = refs[p.cue].cum.at(-1);
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
   * placed behind the audio clock, a part starts no more than two frames plus that time past the clock once it is open,
   * each is heard, and the roar's first chord after the stall is as full as the one without it (heard before the roar's
   * first notes, 0.2 s on).
   */
  async 'every-score-part-opens-on-time-on-a-busy-page'(h) {
    const { ctx, page, errors, tap } = await boot(h, { music: 1, sfx: 0 });
    try {
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
            const ask = clock.currentTime;
            const t0 = performance.now();
            window.__watch = true;
            fn();
            window.__watch = false;
            return { name, rate, ask, done: clock.currentTime, ms: performance.now() - t0, behind: window.__behind.slice(was) };
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
        if (!o.hit && (o.start < o.ask - 1e-4 || o.start > o.done + LEAD + o.ms / 1000 + 1e-4)) why.push(`it starts ${v.leadMs} ms past the clock once it is open`);
        if (!(level > 3e-4)) why.push(`it was not heard (RMS ${level})`);
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

  /**
   * In the intro the gate's crack, the hit and the chest's burst are asked for on the frame their picture lands (the crack
   * 0.1 s after the air before it, the hit 0.75 s after the hush, the burst with the duck that lifts for it) and sound
   * two frames later, the lead every sound gets: visuals lead their sound by 1 or 2 frames, not 4.
   */
  async 'the-crack-hit-and-burst-sound-two-frames-after-their-pictures'(h) {
    const result = {};
    for (const [beat, cue, from, after] of [['gate', 'gate_crack', 'gate_air', 0.1], ['awaken', 'awaken_hit', 'hush', 0.75], ['chest', 'chest_burst', 'duck', 0]]) {
      const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, `?shot=${beat}&mute&dpr=1&nopost`);
      try {
        await page.locator('.title-screen').waitFor({ timeout: 60000 });
        await page.evaluate(async () => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          window.__asked = [];
          for (const m of ['play', 'hush', 'duck']) {
            const f = AudioEngine.prototype[m];
            AudioEngine.prototype[m] = function (...a) {
              const r = f.apply(this, a);
              window.__asked.push({ what: m === 'play' ? a[0] : m, picture: window.__stage.time, done: this.ctx.currentTime, end: r?.end });
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
        const r = await page.evaluate(async ([cue, from]) => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const hit = window.__asked.find((c) => c.what === cue);
          const ref = window.__asked.filter((c) => c.what === from && c.picture <= hit.picture).at(-1);
          const len = new AudioEngine(new OfflineAudioContext(2, 48000, 48000)).play(cue, { at: 0 }).end;
          return { asked: hit.picture - ref.picture, lead: hit.end - len - hit.done };
        }, [cue, from]);
        const late = r.asked - after;
        result[cue] = { askedLateMs: +(late * 1000).toFixed(1), leadMs: +(r.lead * 1000).toFixed(1) };
        note(h, 'gap', { cue, ...result[cue] });
        h.expect(late < 1 / 120, `${cue} was asked for ${(late * 1000).toFixed(1)} ms after its picture, not on its frame`);
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
