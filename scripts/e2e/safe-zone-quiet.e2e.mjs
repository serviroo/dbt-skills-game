// The Safe Zone goes quiet at once. Everything heard before the tap (the score, long cues and their echo, the low hum
// in Give me a moment) is silent at the speakers within a click-free moment of it, a quick visit never brings an old
// cue or echo back, their levels and mute never change, and a gift or rank cut short by the tap is kept. Measured on
// the real post-mix output, render quantum by render quantum, against the audio clock at the moment of the tap.

const TALL = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const WIDE = { width: 844, height: 390 };
const DESK = { width: 1280, height: 800 };
const AUDIO = 'dbt.audio.v1';
// silent: a peak below one step of 16-bit audio and RMS below -100 dBFS, as in me-92
const SILENT_PEAK = 2 ** -15;
const SILENT_RMS = 1e-5;
// the speakers must be silent this soon after the tap: the click-free ramp, and a few render quanta of audio clock
const WITHIN = 0.05;
const CUES = ['reward_chime', 'chest_burst', 'soft_chime'];

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function returning(xp = 0) {
  const t = Date.now() - 86400e3;
  const day = dayKey(t);
  const events = [{ id: 'q5-visit', t, day, k: 'visit', xp: 10 }];
  if (xp) events.push({ id: 'q5-rest', t: t + 1, day, k: 'rest', xp });
  return JSON.stringify({ v: 1, created: t, events, flags: { greetDay: day } });
}
const levels = (o) => JSON.stringify({ v: 1, master: 0.8, music: 0.6, sfx: 0.7, muted: false, ...o });

// Runs before the app: every gain that feeds a speaker also feeds an analyser, read every 10 ms. Each read is cut into
// 128-frame render quanta keyed by their frame index, so each speaker's output is known quantum by quantum. The
// analyser holds the last 32768 frames (about 0.7 s), so a page busy for longer than a read's 10 ms (a slow CI machine
// drawing Home in software) still loses nothing: the next read covers the quanta it missed.
const recorder = () => {
  const Q = 128;
  const connect = AudioNode.prototype.connect;
  const taps = (window.__taps = []);
  AudioNode.prototype.connect = function (dest, ...rest) {
    const out = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode && this instanceof GainNode && !taps.some((t) => t.node === this)) {
      const a = this.context.createAnalyser();
      a.fftSize = 32768;
      connect.call(this, a);
      taps.push({ node: this, a, q: new Map() });
    }
    return out;
  };
  const buf = new Float32Array(32768);
  setInterval(() => {
    for (const tap of taps) {
      const c = tap.a.context;
      if (c.state !== 'running') continue;
      tap.a.getFloatTimeDomainData(buf);
      const n = buf.length / Q;
      const end = Math.round((c.currentTime * c.sampleRate) / Q);
      // the quanta since the last read, plus two again (the clock and the analyser can be a quantum apart)
      const from = tap.end === undefined ? 0 : Math.max(0, n - (end - tap.end) - 2);
      tap.end = end;
      for (let j = from; j < n; j++) {
        let peak = 0;
        let ss = 0;
        for (let k = j * Q; k < (j + 1) * Q; k++) {
          ss += buf[k] * buf[k];
          peak = Math.max(peak, Math.abs(buf[k]));
        }
        tap.q.set(end - n + j, [peak, ss]);
      }
    }
  }, 10);
};

async function boot(h, { save = returning(), viewport = TALL, reduced = false, prefs = levels() } = {}) {
  const ctx = await h.browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: reduced ? 'reduce' : 'no-preference', locale: 'en-US' });
  await ctx.addInitScript(recorder);
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: save, [AUDIO]: prefs };
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
  await page.goto(h.server.url + '/');
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile') && window.__taps.length > 0, null, { timeout: 30000 });
  // the audio clock at every step into or out of the Safe Zone, and every sound the app asks for
  await page.evaluate(() => {
    const a = window.__daily;
    window.__marks = [];
    window.__asks = [];
    const go = a.go.bind(a);
    a.go = (route, o) => {
      const was = a.route.name === 'safe';
      const at = window.__taps.map((t) => t.a.context.currentTime);
      const t0 = performance.now();
      go(route, o);
      if (was !== (a.route.name === 'safe')) window.__marks.push({ into: !was, at, ms: performance.now() - t0 });
    };
    const sound = a.sound.bind(a);
    a.sound = (cue) => {
      window.__asks.push({ route: a.route.name, cue, at: window.__taps[0].a.context.currentTime });
      sound(cue);
    };
  });
  return { ctx, page, errors };
}

const probe = (page) =>
  page.evaluate(() => {
    const a = window.__daily;
    const d = a.store.derived();
    const talk = [...document.querySelectorAll('.dq-sz-talk')].find((b) => !b.classList.contains('is-hidden'));
    let talkOnTop = false;
    if (talk) {
      const r = talk.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      talkOnTop = !!hit && talk.contains(hit) && r.top >= 0 && r.bottom <= innerHeight;
    }
    return {
      route: a.route.name,
      windows: document.querySelectorAll('.sw').length,
      hint: document.querySelectorAll('.pwa-hint').length,
      scrim: document.querySelector('.dq-scrim').classList.contains('is-on'),
      fx: document.querySelectorAll('[data-fx]').length,
      toast: document.querySelector('.dq-toast').classList.contains('is-on'),
      talkOnTop,
      progress: JSON.stringify({ xp: d.xp, stats: d.stats, rank: d.rank, collection: [...d.collection].sort() }),
      rankSeen: a.store.state.flags.rankSeen,
      gift: a.store.state.flags.giftDay === a.store.today(),
      prefs: localStorage.getItem('dbt.audio.v1'),
      volume: JSON.stringify(window.__dbtVolume?.get()),
      gains: JSON.stringify(window.__dbtVolume?.gains()),
    };
  });
// Master, Music and Effects as the engine has them (the Safe Zone's own gate is not one of their levels)
const userGains = (page) => page.evaluate(() => JSON.stringify((({ master, music, sfx }) => [master, music, sfx].map((v) => +v.toFixed(4)))(window.__dbtVolume.gains())));
const scoreGate = (page) => page.evaluate(() => window.__dbtVolume.gains().score);
const lastMark = (page) => page.evaluate(() => window.__marks.at(-1));
const now = (page, i = 0) => page.evaluate((i) => window.__taps[i].a.context.currentTime, i);

/** Waits until tap i's audio clock is past `t` and a read has covered it. */
const until = (page, i, t) => page.waitForFunction(([i, t]) => window.__taps[i].a.context.currentTime > t + 0.05, [i, t], { timeout: 15000, polling: 20 });

/** Tap i's output over [from, to] (its audio clock): RMS, peak, how much of it the reads covered, and when silence began. */
const hear = (page, i, from, to) =>
  page.evaluate(
    ([i, from, to, P, R]) => {
      const tap = window.__taps[i];
      const sr = tap.a.context.sampleRate;
      const Q = 128;
      const qs = [...tap.q].filter(([k]) => (k * Q) / sr >= from && ((k + 1) * Q) / sr <= to).sort((x, y) => x[0] - y[0]);
      let peak = 0;
      let ss = 0;
      for (const [, [p, s]] of qs) {
        peak = Math.max(peak, p);
        ss += s;
      }
      let k = qs.length;
      while (k > 0 && qs[k - 1][1][0] < P && Math.sqrt(qs[k - 1][1][1] / Q) < R) k--;
      const quietFrom = k === qs.length ? null : k === 0 ? from : (qs[k][0] * Q) / sr;
      return { rms: qs.length ? Math.sqrt(ss / (qs.length * Q)) : 0, peak, cover: (qs.length * Q) / sr / (to - from), quietFrom };
    },
    [i, from, to, SILENT_PEAK, SILENT_RMS],
  );
const silent = (x) => x.peak < SILENT_PEAK && x.rms < SILENT_RMS;
// a stalled recorder must not pass for silence: every stretch judged silent has to be at least 90% read
const covered = (x) => x.cover >= 0.9;
const fmt = (x) => `${x.rms.toExponential(1)}/${x.peak.toExponential(1)}, ${(x.cover * 100).toFixed(0)}% read`;
const quietAt = (x, t) => (x.quietFrom === null ? 'never' : `${((x.quietFrom - t) * 1000).toFixed(1)} ms after the tap`);

function step() {
  const bad = [];
  return {
    ok: (cond, msg) => void (cond || bad.push(msg)),
    end: () => {
      if (bad.length) throw new Error(bad.join('\n'));
    },
  };
}

const enter = async (page) => {
  await page.locator('header .dq-safe').click({ timeout: 4000 });
  return lastMark(page);
};
const leave = async (page) => {
  await page.locator('header .dq-back').click({ timeout: 4000 });
  await page.waitForFunction(() => window.__daily.route.name === 'hub', null, { timeout: 3000 });
  return lastMark(page);
};

/**
 * Score and long cues are sounding; the tap silences the speakers within WITHIN and keeps them silent; help is on
 * screen in the same tap; their levels never move; outside, the score comes back.
 */
async function entryCase(h, c, { viewport = TALL, reduced = false, tag, shots = false }) {
  const prefs = levels();
  const { ctx, page, errors } = await boot(h, { viewport, reduced, prefs });
  try {
    await h.sleep(3500);
    const gains = await userGains(page);
    const before = await probe(page);
    await page.evaluate((cues) => cues.forEach((q) => window.__daily.sound(q)), CUES);
    await h.sleep(250);
    if (shots) await h.shot(page, `q5-${tag}-1-before`);
    const m = await enter(page);
    const at = await probe(page);
    const tIn = m.at[0];
    await until(page, 0, tIn + 1.2);
    if (shots) await h.shot(page, `q5-${tag}-2-inside`);
    const pre = await hear(page, 0, tIn - 0.25, tIn);
    const inside = await hear(page, 0, tIn + WITHIN, tIn + 1.2);
    const start = await hear(page, 0, tIn, tIn + 1.2);
    c.ok(pre.rms > 1e-3, `${tag}: the score and cues were not audible before the tap (${fmt(pre)}), so silence proves nothing`);
    c.ok(covered(inside), `${tag}: the reads covered only ${(inside.cover * 100).toFixed(0)}% of the first second inside`);
    c.ok(silent(inside), `${tag}: sound still reaches the speakers ${WITHIN * 1000} ms to 1.2 s after the tap (RMS/peak ${fmt(inside)}; silent from ${quietAt(start, tIn)})`);
    c.ok(at.route === 'safe' && at.talkOnTop && at.windows === 0, `${tag}: help was not on screen in the same tap (${at.route}, talk on top ${at.talkOnTop}, ${at.windows} windows)`);
    c.ok((await scoreGate(page)) === 0, `${tag}: the Safe Zone's score gate is ${await scoreGate(page)}, not exactly 0`);
    c.ok((await userGains(page)) === gains && at.prefs === prefs && at.volume === before.volume, `${tag}: entering changed their levels ${gains} -> ${await userGains(page)} or stored prefs`);
    const out = await leave(page);
    await h.sleep(3500);
    const t = await now(page);
    const back = await hear(page, 0, t - 1, t - 0.05);
    const after = await probe(page);
    if (shots) await h.shot(page, `q5-${tag}-3-after`);
    c.ok(back.rms > 1e-3, `${tag}: the score did not come back outside (${fmt(back)})`);
    c.ok((await userGains(page)) === gains && after.prefs === prefs && after.volume === before.volume, `${tag}: the visit changed their levels or stored prefs`);
    c.ok(after.progress === before.progress, `${tag}: the visit changed XP, stats, rank or the collection ${before.progress} -> ${after.progress}`);
    c.ok(!errors.length, `${tag}: page errors: ${errors.join(' | ')}`);
    console.log(`${tag}: before ${fmt(pre)} | silent from ${quietAt(start, tIn)}, then ${fmt(inside)} | help in ${m.ms.toFixed(1)} ms, Home in ${out.ms.toFixed(1)} ms | back ${fmt(back)}`);
  } finally {
    await ctx.close();
  }
}

/** Home, then Give me a moment with the low hum on and audible for 2.5 s; n is the hum's speaker tap. */
async function humOn(h) {
  const { ctx, page, errors } = await boot(h, { prefs: levels({ master: 1, music: 0, sfx: 1 }) });
  await page.getByRole('button', { name: 'Give me a moment', exact: true }).click();
  const n = await page.evaluate(() => window.__taps.length);
  await page.getByRole('switch', { name: 'Low hum', exact: true }).check();
  await page.waitForFunction((n) => window.__taps.length > n && window.__taps.at(-1).a.context.state === 'running', n, { timeout: 10000 });
  await h.sleep(2500);
  return { ctx, page, errors, n };
}

export const scenarios = {
  async 'entry-silences-score-and-cues-at-once'(h) {
    const c = step();
    await entryCase(h, c, { tag: 'entry' });
    c.end();
  },

  /**
   * Only effects are audible (Music at 0). Long cues ring, then the player steps in and out three times in quick
   * succession. Each visit is silent past WITHIN, and after the last one nothing from before comes back: no cue
   * envelope, no room or hall echo.
   */
  async 'quick-visits-bring-no-old-sound-back'(h) {
    const prefs = levels({ master: 1, music: 0, sfx: 1 });
    const { ctx, page, errors } = await boot(h, { prefs });
    const c = step();
    try {
      await h.sleep(1500);
      await page.evaluate((cues) => cues.forEach((q) => window.__daily.sound(q)), CUES);
      await h.sleep(250);
      const visits = [];
      for (let i = 0; i < 3; i++) {
        const a = await enter(page);
        await h.sleep(120);
        const b = await leave(page);
        visits.push([a.at[0], b.at[0]]);
        await h.sleep(80);
      }
      const tOut = visits.at(-1)[1];
      await until(page, 0, tOut + 2.5);
      const pre = await hear(page, 0, visits[0][0] - 0.25, visits[0][0]);
      c.ok(pre.rms > 1e-3, `quick: the cues were not audible before the first tap (${fmt(pre)})`);
      for (const [i, [a, b]] of visits.entries()) {
        const x = await hear(page, 0, a + WITHIN, b);
        c.ok(covered(x), `quick: the reads covered only ${(x.cover * 100).toFixed(0)}% of visit ${i + 1} past ${WITHIN * 1000} ms`);
        c.ok(silent(x), `quick: visit ${i + 1} (${((b - a) * 1000).toFixed(0)} ms) was not silent past ${WITHIN * 1000} ms (RMS/peak ${fmt(x)})`);
      }
      const gaps = [];
      for (let i = 0; i < visits.length; i++) gaps.push(await hear(page, 0, visits[i][1], visits[i + 1]?.[0] ?? tOut + 2.5));
      const asked = await page.evaluate((t) => window.__asks.filter((x) => x.at >= t), visits[0][0]);
      c.ok(asked.length === 0, `quick: the app asked for ${asked.map((x) => x.cue).join(', ')} after the first tap, so silence would prove nothing`);
      for (const [i, g] of gaps.entries()) c.ok(covered(g), `quick: the reads covered only ${(g.cover * 100).toFixed(0)}% of the time after visit ${i + 1}`);
      c.ok(gaps.every(silent), `quick: cues or their echo from before the Safe Zone came back outside (RMS/peak after each visit: ${gaps.map(fmt).join(' ')})`);
      c.ok(!errors.length, `quick: page errors: ${errors.join(' | ')}`);
      console.log(`quick: before ${fmt(pre)} | visits ${visits.map(([a, b]) => ((b - a) * 1000).toFixed(0) + ' ms').join(', ')} | after each ${gaps.map(fmt).join(' ')}`);
      c.end();
    } finally {
      await ctx.close();
    }
  },

  /** Muted with custom levels: the visit keeps the mute and every stored byte; the gate opens again outside. */
  async 'muted-visit-keeps-mute-and-levels'(h) {
    const prefs = levels({ master: 0.7, music: 0.4, sfx: 0.9, muted: true });
    const { ctx, page, errors } = await boot(h, { prefs });
    const c = step();
    try {
      await h.sleep(2000);
      const before = await probe(page);
      const gains = await userGains(page);
      c.ok(JSON.parse(before.volume).muted === true && JSON.parse(gains)[0] === 0, `mute: the seeded mute did not load (${before.volume}, ${gains})`);
      const m = await enter(page);
      await until(page, 0, m.at[0] + 0.5);
      const at = await probe(page);
      await leave(page);
      await h.sleep(2500);
      const after = await probe(page);
      const t = await now(page);
      const out = await hear(page, 0, m.at[0] - 1, t - 0.05);
      c.ok(at.prefs === prefs && after.prefs === prefs, `mute: stored levels changed ${prefs} -> ${at.prefs} -> ${after.prefs}`);
      c.ok(at.volume === before.volume && after.volume === before.volume, `mute: their levels changed ${before.volume} -> ${after.volume}`);
      c.ok((await userGains(page)) === gains, `mute: engine levels changed ${gains} -> ${await userGains(page)}`);
      c.ok(covered(out) && silent(out), `mute: sound reached the speakers while muted, or the reads missed it (${fmt(out)})`);
      c.ok((await scoreGate(page)) > 0.9, `mute: the Safe Zone gate did not open again outside (${await scoreGate(page)}), so unmuting would stay silent`);
      c.ok(!errors.length, `mute: page errors: ${errors.join(' | ')}`);
      c.end();
    } finally {
      await ctx.close();
    }
  },

  /** Give me a moment's low hum (its own audio context) stops within WITHIN of the tap, not over a second-long fade. */
  async 'moment-hum-stops-at-once'(h) {
    const { ctx, page, errors, n } = await humOn(h);
    const c = step();
    try {
      const m = await enter(page);
      const tIn = m.at[n];
      await page.waitForFunction((n) => window.__taps[n].a.context.state === 'closed', n, { timeout: 5000 }).catch(() => {});
      // a closed context plays nothing more: its clock stops where its last sound was rendered
      const { state, end } = await page.evaluate((n) => ({ state: window.__taps[n].a.context.state, end: window.__taps[n].a.context.currentTime }), n);
      const pre = await hear(page, n, tIn - 0.25, tIn);
      const inside = await hear(page, n, tIn + WITHIN, end);
      const start = await hear(page, n, tIn, end);
      c.ok(pre.rms > 1e-4, `hum: the hum was not audible before the tap (${fmt(pre)})`);
      c.ok(state === 'closed', `hum: the hum's audio is still ${state} a few seconds into the Safe Zone`);
      c.ok(end <= tIn + WITHIN || (covered(inside) && silent(inside)), `hum: the hum played on until ${((end - tIn) * 1000).toFixed(0)} ms after the tap (RMS/peak past ${WITHIN * 1000} ms ${fmt(inside)}, silent from ${quietAt(start, tIn)})`);
      await until(page, 0, m.at[0] + 0.5);
      const eng = await hear(page, 0, m.at[0] + WITHIN, m.at[0] + 0.5);
      c.ok(covered(eng) && silent(eng), `hum: the engine is not silent inside, or the reads missed it (${fmt(eng)})`);
      c.ok(!errors.length, `hum: page errors: ${errors.join(' | ')}`);
      console.log(`hum: before ${fmt(pre)} | its audio ended ${((end - tIn) * 1000).toFixed(1)} ms after the tap`);
      c.end();
    } finally {
      await ctx.close();
    }
  },

  /**
   * The hum's audio is suspended when the Safe Zone opens (a phone call took the audio, say): its oscillators never
   * reach their end, and it is still closed, silently, instead of staying open.
   */
  async 'suspended-hum-still-closes'(h) {
    const { ctx, page, errors, n } = await humOn(h);
    const c = step();
    try {
      await page.evaluate((n) => window.__taps[n].a.context.suspend(), n);
      const held = await page.evaluate((n) => window.__taps[n].a.context.currentTime, n);
      const m = await enter(page);
      const t0 = Date.now();
      await page.waitForFunction((n) => window.__taps[n].a.context.state === 'closed', n, { timeout: 3000, polling: 20 }).catch(() => {});
      const ms = Date.now() - t0;
      const { state, end } = await page.evaluate((n) => ({ state: window.__taps[n].a.context.state, end: window.__taps[n].a.context.currentTime }), n);
      c.ok(state === 'closed', `suspended: the hum's audio is still ${state} 3 s into the Safe Zone`);
      c.ok(end === held && m.at[n] === held, `suspended: the hum's clock moved while suspended (${held} -> ${end}), so it may have played`);
      c.ok(!errors.length, `suspended: page errors: ${errors.join(' | ')}`);
      console.log(`suspended: the hum's audio closed about ${ms} ms after the tap, still suspended`);
      c.end();
    } finally {
      await ctx.close();
    }
  },

  /**
   * A rank-up (window, chime, companion lap) and the daily gift (window opening with its chime) are each cut short by
   * the tap and the player steps straight back out: silent inside, nothing surfaces inside or comes back outside,
   * the rank stays earned, the gift stays claimable, and progress is unchanged.
   */
  async 'interrupted-rank-and-gift-stay-quiet-and-kept'(h) {
    const prefs = levels({ master: 1, music: 0, sfx: 1 });
    const c = step();
    const races = {
      rank: {
        save: returning(150),
        open: async (page) => {
          await page.evaluate(() => window.__daily.go({ name: 'library' }));
          await page.locator('header .dq-back').click();
          await page.locator('.dq-sw').first().waitFor({ state: 'visible', timeout: 8000 });
          await page.waitForFunction(() => window.__asks.some((x) => x.cue === 'soft_chime'), null, { timeout: 5000 });
        },
        kept: (s) => s.rankSeen >= 1 && JSON.parse(s.progress).rank === s.rankSeen,
      },
      gift: {
        save: returning(),
        open: async (page) => {
          await page.locator('.dq-chest').click();
          await page.waitForFunction(() => window.__asks.some((x) => x.cue === 'soft_chime'), null, { timeout: 5000 });
        },
        kept: (s) => !s.gift,
      },
    };
    for (const [kind, r] of Object.entries(races)) {
      const { ctx, page, errors } = await boot(h, { save: r.save, prefs });
      try {
        await h.sleep(1500);
        await r.open(page);
        const before = await probe(page);
        await h.shot(page, `q5-race-${kind}-1-window`);
        const a = await enter(page);
        const inside = await probe(page);
        await h.shot(page, `q5-race-${kind}-2-safe`);
        await page.evaluate(() => window.__daily.toast('A toast from outside'));
        const b = await leave(page);
        await until(page, 0, b.at[0] + 2);
        const after = await probe(page);
        await h.shot(page, `q5-race-${kind}-3-home`);
        const chimeAt = await page.evaluate(() => window.__asks.find((x) => x.cue === 'soft_chime').at);
        const pre = await hear(page, 0, chimeAt, a.at[0]);
        const visit = await hear(page, 0, a.at[0] + WITHIN, b.at[0]);
        const out = await hear(page, 0, b.at[0], b.at[0] + 2);
        const asked = await page.evaluate((t) => window.__asks.filter((x) => x.at >= t).map((x) => x.cue), a.at[0]);
        c.ok(before.windows > 0, `${kind}: no window was opening before the tap`);
        c.ok(pre.rms > 1e-3, `${kind}: the window's chime was not audible before the tap (${fmt(pre)})`);
        c.ok(inside.route === 'safe' && inside.windows === 0 && !inside.scrim && inside.fx === 0 && !inside.toast && inside.talkOnTop, `${kind}: something surfaced over the Safe Zone (${JSON.stringify({ w: inside.windows, scrim: inside.scrim, fx: inside.fx, toast: inside.toast, talk: inside.talkOnTop })})`);
        c.ok(covered(visit), `${kind}: the reads covered only ${(visit.cover * 100).toFixed(0)}% of the visit past ${WITHIN * 1000} ms`);
        c.ok(silent(visit), `${kind}: the visit (${((b.at[0] - a.at[0]) * 1000).toFixed(0)} ms) was not silent past ${WITHIN * 1000} ms (${fmt(visit)})`);
        c.ok(asked.length === 0, `${kind}: sound was asked for after the tap: ${asked.join(', ')}`);
        c.ok(covered(out) && silent(out), `${kind}: the chime or its echo came back outside, or the reads missed it (${fmt(out)})`);
        c.ok(after.windows === 0 && after.hint === 0 && !after.scrim && after.fx === 0 && !after.toast, `${kind}: a window, toast or effect came back after leaving`);
        c.ok(r.kept(after), `${kind}: the interrupted ${kind} was not kept (${JSON.stringify({ rankSeen: after.rankSeen, progress: after.progress, gift: after.gift })})`);
        c.ok(after.progress === before.progress, `${kind}: progress changed ${before.progress} -> ${after.progress}`);
        c.ok(after.prefs === prefs, `${kind}: stored levels changed`);
        c.ok(!errors.length, `${kind}: page errors: ${errors.join(' | ')}`);
        console.log(`${kind}: chime ${fmt(pre)} | visit ${fmt(visit)} | outside ${fmt(out)}`);
      } finally {
        await ctx.close();
      }
    }
    c.end();
  },

  /** Before, inside and after at phone, small phone, sideways and desktop sizes, with motion on and reduced. */
  async 'quiet-entry-at-every-size'(h) {
    const c = step();
    for (const viewport of [TALL, SMALL, WIDE, DESK])
      for (const reduced of [false, true]) await entryCase(h, c, { viewport, reduced, shots: true, tag: `${viewport.width}x${viewport.height}${reduced ? '-reduced' : ''}` });
    c.end();
  },
};
