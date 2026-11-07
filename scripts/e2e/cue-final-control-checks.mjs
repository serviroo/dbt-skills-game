import { audioReady, audioRecorded, audioHeard, captureEngine } from './audio-recorder.mjs';

export async function finalControlDeadline(h, { ctx, page, errors }) {
  try {
    await captureEngine(page);
    const tap = await page.evaluate(() => {
      const e = window.__engine;
      window.__finalOutput = e.ctx.createGain();
      window.__finalOutput.connect(e.ctx.destination);
      return window.__taps.length - 1;
    });
    await audioReady(page);
    const rows = [];
    for (const kind of ['bed', 'charge', 'music', 'cue']) {
      const r = await page.evaluate(async ([kind, tap]) => {
        const { Voice, stoppedBy } = await import('/src/audio/voice.ts');
        const e = window.__engine;
        e.stopAll(0.005);
        const output = window.__finalOutput;
        const osc = Voice.prototype.osc;
        const control = Voice.prototype.control;
        const open = Voice.prototype.openInTime;
        let built = false;
        let settled = false;
        const voices = [];
        const warnings = [];
        const warn = console.warn;
        const hush = e.music.host.hush;
        let hushes = 0;
        e.music.host.hush = function (...args) {
          hushes++;
          return hush.apply(this, args);
        };
        console.warn = (...args) => warnings.push(args);
        const stall = (by) => {
          const until = e.now + by;
          while (e.now < until);
        };
        Voice.prototype.osc = function (...args) {
          if (!built) {
            built = true;
            stall(kind === 'cue' ? 0.1 : 0.35);
          }
          return osc.apply(this, args);
        };
        Voice.prototype.control = function (at, apply, replay) {
          return control.call(this, at, (time) => {
            apply(time);
            if (!settled) {
              settled = true;
              stall(0.15);
            }
          }, replay);
        };
        Voice.prototype.openInTime = function (...args) {
          if (!voices.includes(this)) {
            voices.push(this);
            this.link(this.out, output);
          }
          return open.apply(this, args);
        };
        const from = e.now;
        const duration = kind === 'cue' ? 0.23 : 0.48;
        const stop = from + duration;
        const cue = kind === 'cue' ? 'breath_out' : kind;
        try {
          e.schedule([
            { t: 0, cue, loop: { name: 'gate_hum' },
              opts: { id: 'final', section: 'awaken', hitAt: kind === 'music' ? 0.6 : undefined, fade: 0.005 } },
            ...kind === 'cue' ? [] : [{ t: 0.08, cue: kind === 'music' ? 'music_level' : kind,
              loop: { name: 'gate_hum', level: 0.4 }, opts: { c: 0.4, v: 0.4, ramp: 0.005, fade: 0.005 } }],
            { t: duration, cue: kind === 'cue' ? 'stop' : kind + '_stop', loop: { name: 'gate_hum' },
              opts: { id: 'final', fade: 0.005, ramp: 0.005 } },
          ], from);
        } finally {
          Voice.prototype.osc = osc;
          Voice.prototype.control = control;
          Voice.prototype.openInTime = open;
          console.warn = warn;
          e.music.host.hush = hush;
        }
        return { kind, tap, built, settled, stop, to: e.now + 0.2,
          after: stoppedBy(stop, 0.005) + 0.02, warnings, hushes,
          dropped: voices.every((v) => v.isDropped), released: voices.every((v) => !v.doors.length),
          live: e.music.live.filter((s) => s.voice.isDropped && s.end === Infinity).length };
      }, [kind, tap]);
      await audioRecorded(page, r.tap, r.to);
      rows.push({ ...r, heard: await audioHeard(page, r.tap, r.after, r.to, [1e-6, 1e-6]) });
    }
    for (const r of rows) {
      h.expect(r.built && r.settled, `${r.kind}: the build and last control did not both stall`);
      h.expect(r.dropped && r.released && r.heard.cover === 1 && r.heard.peak < 1e-6,
        `${r.kind}: the final control let an expired sound open: ${JSON.stringify(r)}`);
      h.expect(r.warnings.length === 1 && r.warnings[0][2] > (r.kind === 'cue' ? 200 : 450),
        `${r.kind}: the final drop was not reported once: ${JSON.stringify(r.warnings)}`);
      h.expect(!r.live && !r.hushes, `${r.kind}: a dropped section remained live or opened a hush`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}

export async function globalControlOrder(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    const rows = [];
    for (const running of [true, false]) {
      const r = await page.evaluate((running) => {
        const e = window.__engine;
        e.reset(0.005);
        if (running) e.music.to('calm', 0.005);
        const from = e.now;
        e.schedule([
          { t: 0.5, cue: 'music_level', opts: { v: 0.4, ramp: 0.005 } },
          { t: 0.3, cue: 'reset', opts: { fade: 0.005 } },
          { t: 0.4, cue: 'music', opts: { section: 'calm', fade: 0.005 } },
          { t: 0.5, cue: 'music_lowpass', opts: { hz: 400, ramp: 0.005 } },
          { t: 0.5, cue: 'music_lift', opts: { db: -5, ramp: 0.005 } },
          { t: 0.5, cue: 'music_level', opts: { v: 0.2, ramp: 0.005 } },
          { t: 0.5, cue: 'music_level', opts: { v: 0.4, ramp: 0.005 } },
        ], from);
        return { running, to: from + 0.8 };
      }, running);
      await audioRecorded(page, tap, r.to);
      const values = await page.evaluate(() => {
        const e = window.__engine;
        return { level: e.mlevel.gain.value, lowpass: e.mlp.frequency.value, lift: e.shelf.gain.value };
      });
      rows.push({ ...r, ...values });
    }
    for (const r of rows) h.expect(Math.abs(r.level - 0.4) < 1e-5 &&
      Math.abs(r.lowpass - 400) < 0.01 && Math.abs(r.lift + 5) < 1e-5,
    `reset reordered later score controls: ${JSON.stringify(r)}`);
    const focus = await page.evaluate(() => {
      const e = window.__engine;
      e.reset(0.005);
      e.chargeLoop().set(1);
      const from = e.now;
      e.schedule([
        { t: 0.3, cue: 'reset', opts: { fade: 0.005 } },
        { t: 0.4, cue: 'charge', opts: { c: 1 } },
        { t: 0.45, cue: 'breath_out', opts: { dur: 1 } },
        { t: 0.5, cue: 'charge_release' },
      ], from);
      return from + 0.9;
    });
    await audioRecorded(page, tap, focus);
    const level = await page.evaluate(() => window.__engine.focus.gain.value);
    h.expect(level > 0.7, `the charge release jumped ahead of an earlier cue: ${level}`);
    const output = await page.evaluate(() => {
      const e = window.__engine;
      e.reset(0.005);
      window.__reboundOutput = e.ctx.createGain();
      window.__reboundOutput.connect(e.ctx.destination);
      return window.__taps.length - 1;
    });
    await audioReady(page);
    const rebound = await page.evaluate(async () => {
      const { Voice } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const open = Voice.prototype.openInTime;
      const attempts = [];
      Voice.prototype.openInTime = function (...args) {
        window.__stall = attempts.length ? null : { after: 'start', by: 0.1 };
        const kept = open.apply(this, args);
        attempts.push(kept);
        return kept;
      };
      window.__watch = true;
      try {
        e.schedule([
          { t: 0, cue: 'bed', loop: { name: 'gate_hum', level: 1 }, opts: { fade: 0.005 } },
          { t: 0.02, cue: 'ui_tap' },
          { t: 0.04, cue: 'bed', loop: { name: 'gate_hum', level: 0 }, opts: { fade: 0.005 } },
        ], e.now);
        e.beds.get('gate_hum').voice.out.connect(window.__reboundOutput);
      } finally {
        window.__watch = false;
        window.__stall = null;
        Voice.prototype.openInTime = open;
      }
      return { attempts, to: e.now + 0.3 };
    });
    await audioRecorded(page, output, rebound.to);
    const heard = await audioHeard(page, output, rebound.to - 0.1, rebound.to, [1e-6, 1e-6]);
    h.expect(rebound.attempts[0] === false && rebound.attempts[1] === true && heard.cover === 1 && heard.peak < 1e-6,
      `a later control lost its rebuilt sound: ${JSON.stringify({ ...rebound, heard })}`);
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}
