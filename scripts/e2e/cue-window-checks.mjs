import { audioRecorded, audioHeard, captureEngine } from './audio-recorder.mjs';

async function quietStart(page, tap) {
  await captureEngine(page);
  await page.evaluate(() => window.__engine.stopAll(0.005));
  await page.waitForFunction((tap) => {
    const r = window.__taps[tap];
    return [...r.q].filter(([k]) => k >= r.end - 16).every(([, [p]]) => p < 1e-6);
  }, tap);
}

const reached = (page, t) => page.waitForFunction((t) => window.__engine.now >= t, t, { timeout: 20000 });

export async function missedSectionKeepsItsChord(h, { ctx, page, errors, tap }) {
  try {
    await quietStart(page, tap);
    const r = await page.evaluate(async () => {
      const { Voice } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const open = Voice.prototype.openInTime;
      const place = Voice.prototype.place;
      const tries = [];
      let stalled = false;
      Voice.prototype.openInTime = function (...args) {
        const kept = open.apply(this, args);
        tries.push({ continuing: !!args[4], kept });
        return kept;
      };
      Voice.prototype.place = function (s, t0, ...rest) {
        if (!stalled && !tries.length) {
          stalled = true;
          while (e.ctx.currentTime < t0 + 0.01);
        }
        return place.call(this, s, t0, ...rest);
      };
      try {
        e.music.to('calm', 0.05);
      } finally {
        Voice.prototype.openInTime = open;
        Voice.prototype.place = place;
      }
      const s = e.music.live.find((x) => x.name === 'calm');
      return { tries, at: s?.start };
    });
    await audioRecorded(page, tap, r.at + 2);
    const heard = await audioHeard(page, tap, r.at + 0.3, r.at + 2, [0, 0]);
    const detail = JSON.stringify({ ...r, heard });
    h.expect(r.tries.length >= 2 && !r.tries[0].kept, `the first try never missed: ${detail}`);
    const last = r.tries.at(-1);
    h.expect(!last.continuing && last.kept, `a section that missed once opened past its attacks: ${detail}`);
    h.expect(heard.rms > 1e-4, `Home's score was silent after one missed placement: ${detail}`);
    h.expect(!errors.length, errors.join('\n'));
    return { ...r, heard };
  } finally {
    await ctx.close();
  }
}

const voiceOf = (page, id) => page.evaluate((id) => {
  const v = window.__engine.named.get(id)?.voice;
  return v ? { opened: v.opened, stopped: v.isStopped, dropped: v.isDropped, t: v.t, silentAt: v.silentAt } : null;
}, id);

export async function windowTiming(h, { ctx, page, errors, tap }) {
  try {
    await quietStart(page, tap);
    const r = await page.evaluate(async () => {
      const { AHEAD } = await import('/src/audio/music.ts');
      const e = window.__engine;
      const play = e.play;
      window.__calls = [];
      e.play = function (cue, o) {
        window.__calls.push({ cue, now: e.ctx.currentTime });
        return play.call(this, cue, o);
      };
      const t0 = e.now;
      e.schedule([{ t: 0, cue: 'ui_tap' }, { t: 2, cue: 'ui_tap', opts: { id: 'later' } }], t0);
      return { t0, AHEAD, atOnce: window.__calls.length };
    });
    await page.waitForFunction(() => window.__calls.length >= 2, null, { timeout: 20000 });
    const later = await page.evaluate(() => window.__calls[1].now);
    const detail = JSON.stringify({ ...r, later });
    h.expect(r.atOnce === 1, `an event already due waited for the window: ${detail}`);
    h.expect(later >= r.t0 + 2 - r.AHEAD - 1e-3, `an event was built before its window: ${detail}`);
    h.expect(later < r.t0 + 2, `an event was built after its time: ${detail}`);
    h.expect(!errors.length, errors.join('\n'));
    return { ...r, later };
  } finally {
    await ctx.close();
  }
}

export async function stopsReachTheWindow(h, { ctx, page, errors, tap }) {
  try {
    await quietStart(page, tap);
    const t0 = await page.evaluate(() => {
      const e = window.__engine;
      const t0 = e.now;
      e.schedule([
        { t: 1, cue: 'breath_out', opts: { id: 'before', dur: 4 } },
        { t: 2.2, cue: 'breath_out', opts: { id: 'after', dur: 2 } },
      ], t0);
      e.stopAll(0.05, t0 + 1.6);
      return t0;
    });
    await reached(page, t0 + 3.4);
    await audioRecorded(page, tap, t0 + 3.4);
    const playing = await audioHeard(page, tap, t0 + 1.15, t0 + 1.55, [0, 0]);
    const after = await audioHeard(page, tap, t0 + 1.9, t0 + 3.4, [0, 0]);
    const states = { before: await voiceOf(page, 'before'), after: await voiceOf(page, 'after') };
    const detail = JSON.stringify({ playing, after, states });
    h.expect(playing.rms > 1e-4, `a waiting cue due before a later stopAll never played until it: ${detail}`);
    h.expect(after.rms < 1e-5, `a waiting cue sounded past stopAll: ${detail}`);
    h.expect(!states.after?.opened, `a cue due after stopAll still opened: ${detail}`);
    h.expect(!errors.length, errors.join('\n'));
    return { playing, after, states };
  } finally {
    await ctx.close();
  }
}

export async function visitsReachTheWindow(h, { ctx, page, errors, tap }) {
  try {
    await quietStart(page, tap);
    const t0 = await page.evaluate(() => {
      const e = window.__engine;
      const t0 = e.now;
      e.schedule([{ t: 1.4, cue: 'breath_out', opts: { id: 'before-visit', dur: 2 } }], t0);
      e.quiet(true, 0.05);
      e.schedule([{ t: 1.4, cue: 'stand_swell', opts: { id: 'in-visit' } }], t0);
      return t0;
    });
    await reached(page, t0 + 0.5);
    const back = await page.evaluate(() => {
      const e = window.__engine;
      e.quiet(false, 0.05);
      const t = e.now;
      e.schedule([{ t: 0.9, cue: 'ui_tap', opts: { id: 'outside' } }], t);
      return t + 0.9;
    });
    await reached(page, t0 + 2.8);
    await audioRecorded(page, tap, t0 + 2.8);
    const carried = await audioHeard(page, tap, t0 + 1.5, t0 + 2.8, [0, 0]);
    const states = {
      beforeVisit: await voiceOf(page, 'before-visit'), inVisit: await voiceOf(page, 'in-visit'),
      outside: await voiceOf(page, 'outside'),
    };
    const detail = JSON.stringify({ t0, back, carried, states });
    h.expect(!states.beforeVisit?.opened && !states.inVisit?.opened, `a cue waiting from a visit opened: ${detail}`);
    h.expect(states.outside?.opened, `a cue asked for after the visit did not play: ${detail}`);
    h.expect(!errors.length, errors.join('\n'));
    return { carried, states };
  } finally {
    await ctx.close();
  }
}

const states = (page, ids) => page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
  const v = id === 'first' ? window.__first : window.__engine.named.get(id)?.voice;
  return [id, v && { opened: v.opened, stopped: v.isStopped, silentAt: v.silentAt }];
})), ids);

export async function resetKeepsItsBatch(h, { ctx, page, errors, tap }) {
  try {
    await quietStart(page, tap);
    const t0 = await page.evaluate(() => {
      const e = window.__engine;
      const t0 = e.now;
      e.schedule([{ t: 0, cue: 'breath_out', opts: { id: 'first', dur: 6 } }], t0);
      window.__first = e.named.get('first')?.voice;
      e.schedule([{ t: 1.6, cue: 'breath_out', opts: { id: 'old', dur: 2 } }], t0);
      e.schedule([
        { t: 1, cue: 'reset', opts: { fade: 0.05 } },
        { t: 1.4, cue: 'breath_out', opts: { id: 'own', dur: 2 } },
      ], t0);
      return t0;
    });
    await reached(page, t0 + 2.2);
    const r = await states(page, ['first', 'old', 'own']);
    const detail = JSON.stringify({ t0, ...r });
    h.expect(r.own?.opened && !r.own.stopped, `a reset stopped the rest of its own list: ${detail}`);
    h.expect(!r.old?.opened, `a cue from an earlier list outlived the reset: ${detail}`);
    h.expect(r.first?.stopped, `the reset did not stop what was already playing: ${detail}`);
    h.expect(!errors.length, errors.join('\n'));
    return r;
  } finally {
    await ctx.close();
  }
}

export async function laterStopReachesWaitingCue(h, { ctx, page, errors, tap }) {
  try {
    await quietStart(page, tap);
    const t0 = await page.evaluate(() => {
      const e = window.__engine;
      const t0 = e.now;
      e.schedule([{ t: 0, cue: 'breath_out', opts: { id: 'x', dur: 6 } }], t0);
      window.__first = e.named.get('x')?.voice;
      e.schedule([{ t: 1.2, cue: 'breath_out', opts: { id: 'x', dur: 4 } }], t0);
      e.schedule([{ t: 1.6, cue: 'stop', opts: { id: 'x', ramp: 0.05 } }], t0);
      e.schedule([{ t: 1.4, cue: 'breath_out', opts: { id: 'y', dur: 4 } }], t0);
      e.schedule([{ t: 1.8, cue: 'stop', opts: { id: 'y', ramp: 0.05 } }], t0);
      return t0;
    });
    await reached(page, t0 + 2.4);
    const r = await states(page, ['first', 'x', 'y']);
    const detail = JSON.stringify({ t0, ...r });
    h.expect(r.x?.opened && r.x.silentAt <= t0 + 1.8,
      `a later stop missed the waiting cue that took its name: ${detail}`);
    h.expect(r.y?.opened && r.y.silentAt <= t0 + 2, `a later stop missed a waiting named cue: ${detail}`);
    h.expect(!r.first?.stopped, `a stop meant for the waiting cue stopped the one it replaced: ${detail}`);
    h.expect(!errors.length, errors.join('\n'));
    return r;
  } finally {
    await ctx.close();
  }
}
