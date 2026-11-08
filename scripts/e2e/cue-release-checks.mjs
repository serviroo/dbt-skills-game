import { audioRecorded, audioHeard, captureEngine } from './audio-recorder.mjs';

export async function droppedRelease(h, { ctx, page, errors }, kind = 'hit') {
  try {
    await captureEngine(page);
    await page.evaluate((kind) => {
      const e = window.__engine;
      e.music.to('awaken', 0.05);
      e.bed('gate_hum', { fadeIn: 0.05 });
      if (kind === 'close') e.play('ui_open', { detune: 500 });
      else e.hush();
    }, kind);
    await page.waitForFunction((kind) => {
      const e = window.__engine;
      return kind === 'close' ? e.shelf.gain.value > 4.9 : e.hushMusic.gain.value < 0.009;
    }, kind);
    const r = await page.evaluate(async (kind) => {
      const { Voice } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const open = Voice.prototype.openInTime;
      const tries = [];
      Voice.prototype.openInTime = function (...args) {
        window.__stall = tries.length < 2 ? { after: 'start', by: 0.15 } : null;
        const kept = open.apply(this, args);
        tries.push(kept);
        return kept;
      };
      const asked = e.now;
      window.__watch = true;
      try {
        if (kind === 'hush') e.hush(asked, asked + 0.2);
        else e.play(kind === 'close' ? 'ui_close' : 'awaken_hit', { at: asked });
      } finally {
        Voice.prototype.openInTime = open;
        window.__watch = false;
        window.__stall = null;
      }
      return { asked, tries, returned: e.now, stalls: window.__stalls, behind: window.__behind };
    }, kind);
    await page.waitForFunction(([at, kind]) => {
      const e = window.__engine;
      return kind === 'close' ? e.shelf.gain.value < 0.1 : e.now >= at + 0.08;
    }, [r.returned, kind]);
    const levels = await page.evaluate((kind) => {
      const e = window.__engine;
      return kind === 'close' ? [e.shelf.gain.value] :
        [e.hushMusic, e.hushBeds, e.hushHall, e.hushRoom].map((g) => g.gain.value);
    }, kind);
    const attempts = kind === 'hush' ? 1 : 2;
    h.expect(r.tries.length === attempts && r.tries.every((kept) => kept === false),
      `expected ${attempts} dropped builds, got ${JSON.stringify(r.tries)}`);
    if (kind === 'hush') h.expect(r.returned <= r.asked + 0.2, 'the hush retried past its end');
    h.expect(kind === 'close' ? levels[0] < 0.1 : levels.every((g) => g > 0.99),
      `dropped ${kind} left controls at ${levels.join(', ')}`);
    h.expect(!r.behind.length, `${r.behind.length} operations fell behind the clock`);
    h.expect(!errors.length, errors.join('\n'));
    return { tries: r.tries, levels, stalls: r.stalls.length };
  } finally {
    await ctx.close();
  }
}

export async function checkedRoar(h, { ctx, page, errors }) {
  try {
    await captureEngine(page);
    const r = await page.evaluate(async () => {
      const { Voice } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const part = Voice.prototype.part;
      const place = Voice.prototype.place;
      const parts = new WeakSet();
      let stalled = false;
      Voice.prototype.part = function (...args) {
        const v = part.apply(this, args);
        parts.add(v);
        return v;
      };
      Voice.prototype.place = function (...args) {
        if (!stalled && parts.has(this.clock)) {
          stalled = true;
          window.__stall = { after: 'start', by: 0.1 };
        }
        return place.apply(this, args);
      };
      e.music.to('awaken', 0.05, { standAt: e.now + 5 });
      window.__watch = true;
      try {
        e.play('awaken_hit');
      } finally {
        window.__watch = false;
        window.__stall = null;
      }
      Voice.prototype.part = part;
      Voice.prototype.place = place;
      return { behind: window.__behind, stalls: window.__stalls };
    });
    h.expect(r.stalls.length === 1, 'the opening did not encounter the 100 ms placement stall');
    h.expect(!r.behind.length, `${r.behind.length} roar operations fell behind the clock`);
    h.expect(!errors.length, errors.join('\n'));
    return { behind: r.behind.length, stalls: r.stalls.length };
  } finally {
    await ctx.close();
  }
}

export async function unownedDoor(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    await page.evaluate(async () => {
      const { soon } = await import('/src/audio/param.ts');
      const { stoppedBy } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const at = soon(e.ctx);
      e.stopAll(0.005, at);
      window.__quietAfter = stoppedBy(at, 0.005);
    });
    await page.waitForFunction((tap) => {
      const r = window.__taps[tap];
      return (r.end - 16) * 128 / r.context.sampleRate > window.__quietAfter &&
        [...r.q].filter(([k]) => k >= r.end - 16).every(([, [p]]) => p < 1e-6);
    }, tap);
    const rows = [];
    for (const kind of ['osc', 'lfo', 'child']) {
      const r = await page.evaluate(async (kind) => {
        const { Voice } = await import('/src/audio/voice.ts');
        const e = window.__engine;
        const output = e.ctx.createGain();
        output.connect(e.sfx);
        const v = new Voice(e.lib, 0, e.sfx, { held: true });
        let carrier;
        if (kind === 'child') {
          const c = v.child();
          c.sends(1, 1);
          c.osc('sine', 440, 0, 1, c.wet);
        } else if (kind === 'osc') v.osc('sine', 440, 0, 1, output);
        else {
          output.gain.value = 0;
          carrier = e.ctx.createOscillator();
          carrier.connect(output);
          carrier.start();
          v.lfo(5, 0.2, output.gain, 0, 1);
        }
        const from = e.now;
        window.__stall = { after: 'start', by: 0.15 };
        window.__watch = true;
        let kept;
        try {
          kept = v.openInTime();
        } finally {
          window.__watch = false;
          window.__stall = null;
        }
        window.__unownedOutput = { output, carrier };
        return { from, to: e.now + 0.15, kept };
      }, kind);
      await audioRecorded(page, tap, r.to);
      const heard = await audioHeard(page, tap, r.from, r.to, [1e-6, 1e-6]);
      await page.evaluate(() => {
        window.__unownedOutput.carrier?.stop();
        window.__unownedOutput.output.disconnect();
      });
      rows.push({ kind, kept: r.kept, ...heard });
    }
    h.expect(rows.every((r) => r.kept === false), 'the placement stall did not drop the held sounds');
    h.expect(rows.every((r) => r.cover === 1 && r.peak < 1e-6),
      `an unowned destination leaked: ${JSON.stringify(rows)}`);
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}
