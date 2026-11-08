import { audioRecorded, audioHeard, captureEngine } from './audio-recorder.mjs';

export async function timedHush(h, { ctx, page, errors }) {
  try {
    await captureEngine(page);
    const rows = [];
    for (const duration of [0.5, 0.08]) {
      const r = await page.evaluate(async (duration) => {
        const { Voice } = await import('/src/audio/voice.ts');
        const e = window.__engine;
        const open = Voice.prototype.openInTime;
        const tries = [];
        e.hush();
        const restores = [];
        const set = AudioParam.prototype.setTargetAtTime;
        const gains = [e.hushMusic, e.hushBeds, e.hushHall, e.hushRoom].map((g) => g.gain);
        AudioParam.prototype.setTargetAtTime = function (v, t, tau) {
          if (v === 1 && gains.includes(this)) restores.push(t);
          return set.call(this, v, t, tau);
        };
        Voice.prototype.openInTime = function (...args) {
          if (!tries.length) window.__stall = { after: 'start', by: 0.1 };
          const kept = open.apply(this, args);
          tries.push({ kept, at: this.t });
          return kept;
        };
        const from = e.now;
        const to = from + duration;
        window.__watch = true;
        try {
          e.hush(from, to);
        } finally {
          Voice.prototype.openInTime = open;
          AudioParam.prototype.setTargetAtTime = set;
          window.__watch = false;
          window.__stall = null;
        }
        return { from, to, tries, restores, returned: e.now };
      }, duration);
      await page.waitForFunction((to) => window.__engine.now >= to + 0.04, Math.max(r.to, ...r.restores));
      const gains = await page.evaluate(() => {
        const e = window.__engine;
        return [e.hushMusic, e.hushBeds, e.hushHall, e.hushRoom].map((g) => g.gain.value);
      });
      rows.push({ ...r, duration, gains });
    }
    for (const r of rows) {
      h.expect(r.tries[0]?.kept === false, 'the 100 ms stall did not miss the first hush opening');
      h.expect(r.gains.every((g) => g > 0.99),
        `hush ended past its asked time: ${JSON.stringify(r)}`);
      if (r.duration < 0.1) {
        h.expect(r.tries.every((t) => t.kept === false), 'a hush opened after its end');
      } else {
        h.expect(r.tries.some((t) => t.kept), 'the hush never rebuilt');
        h.expect(r.restores.length === 4 && r.restores.every((t) => t === r.to),
          'retrying moved the requested hush end');
      }
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}

export async function lastSourceStall(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    await page.evaluate(async () => {
      const { soon } = await import('/src/audio/param.ts');
      const { stoppedBy } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const quiet = soon(e.ctx);
      e.stopAll(0.005, quiet);
      window.__quietAfter = stoppedBy(quiet, 0.005);
    });
    await page.waitForFunction((tap) => {
      const r = window.__taps[tap];
      return (r.end - 16) * 128 / r.context.sampleRate > window.__quietAfter &&
        [...r.q].filter(([k]) => k >= r.end - 16).every(([, [p]]) => p < 1e-6);
    }, tap);
    const result = await page.evaluate(async () => {
      const { Voice } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const open = Voice.prototype.openInTime;
      const tries = [];
      Voice.prototype.openInTime = function (...args) {
        if (!tries.length) window.__stall = { after: 'start', nth: 3, by: 0.15 };
        const index = window.__scheduled.length;
        const kept = open.apply(this, args);
        const first = Math.min(...window.__scheduled.slice(index));
        tries.push({ kept: kept !== false, first, returned: e.now, at: this.t });
        return kept;
      };
      const from = e.now;
      window.__watch = true;
      try {
        e.play('ui_tap', { at: from });
      } finally {
        window.__watch = false;
        window.__stall = null;
        Voice.prototype.openInTime = open;
      }
      return { from, tries, stalls: window.__stalls, behind: window.__behind };
    });
    const at = result.tries.find((t) => t.kept)?.at;
    h.expect(result.stalls.length === 1, 'the third source start never stalled');
    h.expect(result.tries[0]?.kept === false, `the last source stall opened a stale build: ${JSON.stringify(result)}`);
    h.expect(!result.behind.length, `scheduling fell behind the clock: ${JSON.stringify(result.behind)}`);
    h.expect(Number.isFinite(at), 'the stalled tap never rebuilt');
    h.expect(result.tries.filter((t) => t.kept).every((t) => t.first > t.returned),
      'a build opened after its earliest scheduled time had passed');
    await audioRecorded(page, tap, at + 0.4);
    const lost = await audioHeard(page, tap, result.from, at - 0.01, [1e-6, 1e-6]);
    const heard = await audioHeard(page, tap, at, at + 0.35, [1e-6, 1e-6]);
    h.expect(lost.cover === 1 && lost.peak < 1e-6, `the dropped tap leaked: ${JSON.stringify(lost)}`);
    h.expect(heard.cover === 1 && heard.peak > 1e-4, `the rebuilt tap was silent: ${JSON.stringify(heard)}`);
    h.expect(!errors.length, errors.join('\n'));
    return { tries: result.tries, behind: result.behind.length, lost, heard };
  } finally {
    await ctx.close();
  }
}

export async function expiredEnds(h, { ctx, page, errors }) {
  try {
    await captureEngine(page);
    const rows = await page.evaluate(async () => {
      const { Voice } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const open = Voice.prototype.openInTime;
      const rows = [];
      for (const kind of ['bed', 'ambient', 'charge', 'cue']) {
        const tries = [];
        Voice.prototype.openInTime = function (...args) {
          if (!tries.length) window.__stall = { after: 'start', by: 0.1 };
          const kept = open.apply(this, args);
          tries.push(kept);
          return kept;
        };
        const at = e.now;
        const until = 0.08;
        const sound = kind === 'cue' ? { t: 0, cue: 'bubble', opts: { id: 'ending-cue' } } :
          { t: 0, cue: kind, loop: { name: 'ambient', until } };
        const events = kind === 'cue' ? [sound, { t: until, cue: 'stop', opts: { id: 'ending-cue' } }] : [sound];
        window.__watch = true;
        try {
          e.schedule(events, at);
        } finally {
          window.__watch = false;
          window.__stall = null;
          Voice.prototype.openInTime = open;
        }
        rows.push({ kind, tries, ended: kind === 'cue' ? e.plans.sound('ending-cue').end :
          kind === 'charge' ? e.charge === null : !e.beds.has('ambient'), at, returned: e.now });
      }
      return rows;
    });
    for (const r of rows) {
      h.expect(r.tries.length > 0 && r.tries.every((kept) => kept === false),
        `${r.kind} opened after its end: ${JSON.stringify(r)}`);
      h.expect(r.ended, `${r.kind} left a running handle after its end`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}

export async function fixedScoreTimes(h, { ctx, page, errors }) {
  try {
    await captureEngine(page);
    const r = await page.evaluate(async () => {
      const { Voice } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      e.stopAll(0.005);
      const open = Voice.prototype.openInTime;
      const tries = [];
      Voice.prototype.openInTime = function (...args) {
        if (!tries.length) window.__stall = { after: 'start', by: 0.1 };
        const kept = open.apply(this, args);
        tries.push({ asked: args[0], at: this.t, kept });
        return kept;
      };
      const at = e.now;
      const hitAt = at + 2;
      const standAt = at + 5;
      window.__watch = true;
      try {
        e.music.to('awaken', 0.02, { at, hitAt, standAt });
        e.play('awaken_hit', { at: hitAt });
        e.music.scheduleUntil(standAt + 0.05);
      } finally {
        window.__watch = false;
        window.__stall = null;
        Voice.prototype.openInTime = open;
      }
      return { tries, at, hitAt, standAt, times: window.__scheduled, behind: window.__behind };
    });
    h.expect(r.tries[0]?.kept === false && r.tries[1]?.kept === true,
      `the score did not rebuild after the stall: ${JSON.stringify(r.tries)}`);
    const roar = r.tries.slice(2);
    h.expect(roar.some((t) => t.kept && t.asked === r.hitAt), 'retrying moved the requested hit');
    h.expect(r.times.some((t) => Math.abs(t - (r.standAt - 0.004)) < 1e-6),
      'retrying moved the requested stand');
    h.expect(!r.behind.length, `the score placed times behind the clock: ${JSON.stringify(r.behind)}`);
    h.expect(!errors.length, errors.join('\n'));
    return { tries: r.tries, hitAt: r.hitAt, standAt: r.standAt };
  } finally {
    await ctx.close();
  }
}
