// The low hum in Give me a moment has its own Hum level. Settings and the companion's speaker control show it beside
// Master, Music and Effects (100 by default, also for a save from before it), it survives a reload, and moving it
// changes the playing hum in step with the curve the other sliders use, live and without a click, while Music and
// Effects leave it alone. The hum never pops or stays gone: hiding the page fades it out before it pauses, and however
// it was paused (the page hidden, a locked phone, a call) it comes back from silence with a short fade. Mute, the Safe
// Zone and Done still silence it. Measured on the hum's real output, render quantum by render quantum.
import fs from 'node:fs';
import path from 'node:path';

/** What each check measured, one line a check, in the run's artifacts. */
const note = (h, name, o) => fs.appendFileSync(path.join(h.out, 'hum-volume.jsonl'), JSON.stringify({ name, ...o }) + '\n');

const TALL = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const AUDIO = 'dbt.audio.v1';
const Q = 128;
// silent: a peak below one step of 16-bit audio, as in safe-zone-quiet
const SILENT_PEAK = 2 ** -15;
// the Safe Zone silences the speakers this soon after the tap
const WITHIN = 0.05;
// a click: a step between two samples more than this many times the steepest the steady hum ever moves
const CLICK = 3;
// the slider curve the engine gives Master, Music and Effects
const taper = (p) => p * p;

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function returning() {
  const t = Date.now() - 86400e3;
  const day = dayKey(t);
  return JSON.stringify({ v: 1, created: t, events: [{ id: 'hum-visit', t, day, k: 'visit', xp: 10 }], flags: { greetDay: day } });
}
// a save from before the Hum level: no `hum` field
const levels = (o) => JSON.stringify({ v: 1, master: 1, music: 0, sfx: 1, muted: false, ...o });

// Runs before the app (safe-zone-quiet's recorder): every gain that feeds a speaker also feeds an analyser holding the
// last 32768 frames, read every 10 ms and cut into 128-frame render quanta keyed by frame index. Each quantum keeps its
// peak, sum of squares and its biggest step between two samples, so a click shows wherever it falls.
const recorder = () => {
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
  const Q = 128;
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
        let step = 0;
        for (let k = j * Q; k < (j + 1) * Q; k++) {
          ss += buf[k] * buf[k];
          peak = Math.max(peak, Math.abs(buf[k]));
          if (k) step = Math.max(step, Math.abs(buf[k] - buf[k - 1]));
        }
        tap.q.set(end - n + j, [peak, ss, step]);
      }
    }
  }, 10);
};

async function boot(h, { viewport = TALL, prefs = levels() } = {}) {
  const ctx = await h.browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'en-US' });
  await ctx.addInitScript(recorder);
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: returning() };
  if (prefs !== null) seed[AUDIO] = prefs;
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
  // the hum's audio clock at every step into or out of the Safe Zone
  await page.evaluate(() => {
    const a = window.__daily;
    window.__marks = [];
    const go = a.go.bind(a);
    a.go = (route, o) => {
      const was = a.route.name;
      const at = window.__taps.map((t) => t.a.context.currentTime);
      go(route, o);
      window.__marks.push({ from: was, to: a.route.name, at });
    };
  });
  return { ctx, page, errors };
}

/** Give me a moment with the low hum on and settled; n is the hum's speaker tap. */
async function humOn(h, page) {
  if ((await page.evaluate(() => window.__daily.route.name)) !== 'moment') await page.getByRole('button', { name: 'Give me a moment', exact: true }).click();
  const n = await page.evaluate(() => window.__taps.length);
  await page.getByRole('switch', { name: 'Low hum', exact: true }).check();
  await page.waitForFunction((n) => window.__taps.length > n && window.__taps.at(-1).a.context.state === 'running', n, { timeout: 10000 });
  // past its first swell
  await recorded(page, n, (await clock(page, n)) + 2.5);
  return n;
}

const clock = (page, n) => page.evaluate((n) => window.__taps[n].a.context.currentTime, n);
/** Waits until tap n has recorded its output up to audio time t. */
const recorded = (page, n, t) => page.waitForFunction(([n, t]) => {
  const tap = window.__taps[n];
  return tap.end !== undefined && (tap.end * 128) / tap.a.context.sampleRate >= t;
}, [n, t], { timeout: Math.max(10000, (t + 5) * 1000) });
/** Tap n's quanta in [t0, t1) of audio time, in order: [start s, peak, rms, biggest step]. */
const quanta = (page, n, t0, t1) => page.evaluate(([n, t0, t1, Q]) => {
  const tap = window.__taps[n];
  const per = Q / tap.a.context.sampleRate;
  return [...tap.q].filter(([i]) => i * per >= t0 && i * per < t1).sort((a, b) => a[0] - b[0]).map(([i, [peak, ss, step]]) => [i * per, peak, Math.sqrt(ss / Q), step]);
}, [n, t0, t1, Q]);
const rate = (page, n) => page.evaluate((n) => window.__taps[n].a.context.sampleRate, n);

const rms = (qs) => Math.sqrt(qs.reduce((s, q) => s + q[2] ** 2, 0) / Math.max(1, qs.length));
const steepest = (qs) => Math.max(...qs.map((q) => q[3]));
/** Every quantum from t0 to t1 was recorded: none lost between reads. */
function whole(h, name, qs, per, t0, t1) {
  const missing = qs.findIndex((q, i) => i && q[0] - qs[i - 1][0] > per * 1.5);
  h.expect(qs.length && missing === -1 && qs[0][0] - t0 < per * 3 && t1 - qs.at(-1)[0] < per * 3, `${name}: the recording has a hole at ${missing === -1 ? 'an end' : qs[missing][0].toFixed(3) + ' s'} (${qs.length} quanta)`);
}
/** 8-quantum blocks (two periods of the hum's lowest note), for gaps: [start s, rms]. */
const blocks = (qs) => {
  const out = [];
  for (let i = 0; i + 8 <= qs.length; i += 4) out.push([qs[i][0], rms(qs.slice(i, i + 8))]);
  return out;
};

async function soundControls(page) {
  const button = page.getByRole('button', { name: 'Sound settings', exact: true });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  return page.getByRole('dialog', { name: 'Sound', exact: true });
}
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), AUDIO);

/** Pretends the page went to the background (a phone locked or another app in front) or came back. */
const setHidden = (page, hidden) => page.evaluate((hidden) => {
  if (hidden) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  } else {
    delete document.hidden;
    delete document.visibilityState;
  }
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

/**
 * The quanta around a pause at audio time `frozen`: the hum fades back in from silence (its first quanta are under 30%
 * of `level`), is back within a second and a half, and nothing from `from` on clicks.
 */
function wokeSoftly(h, name, qs, per, frozen, level, ref, from = -Infinity) {
  const after = qs.filter((q) => q[0] >= frozen + 3 * per);
  h.expect(after.length > 400, `${name}: under a second recorded after it woke (${after.length} quanta)`);
  const first = rms(after.slice(0, 5));
  h.expect(first < 0.3 * level, `${name}: it came back at ${((first / level) * 100).toFixed(0)}% of its level at once, not from silence`);
  const back = rms(after.filter((q) => q[0] >= frozen + 0.5 && q[0] < frozen + 1.5));
  h.expect(back > 0.2 * ref.rms, `${name}: still quiet a second after it woke (${((back / ref.rms) * 100).toFixed(0)}% of its level)`);
  const step = steepest(qs.filter((q) => q[0] >= from));
  note(h, name, { first: first / level, back: back / ref.rms, step, steady: ref.step });
  h.expect(step <= CLICK * ref.step, `${name}: a click, a step of ${step.toExponential(2)} against the steady hum's ${ref.step.toExponential(2)}`);
}

export const scenarios = {
  /** The companion's speaker control, now four sliders tall, opens whole on every phone size, upright and sideways. */
  async 'hum-in-the-speaker-control-fits'(h) {
    for (const viewport of [TALL, SMALL, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
      const tag = `${viewport.width}x${viewport.height}`;
      const { ctx, page, errors } = await boot(h, { viewport });
      try {
        const pop = await soundControls(page);
        await h.sleep(600);
        const names = await pop.getByRole('slider').evaluateAll((els) => els.map((e) => e.labels[0]?.textContent));
        h.expect(JSON.stringify(names) === '["Master","Music","Effects","Hum"]', `${tag}: speaker control sliders are ${JSON.stringify(names)}`);
        await h.shot(page, `speaker-control-${tag}`);
        const box = await pop.boundingBox();
        const mute = await pop.getByRole('button', { name: 'Mute', exact: true }).boundingBox();
        h.expect(box.y >= 0 && box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, `${tag}: the speaker control spills off screen at ${JSON.stringify(box)}`);
        h.expect(mute.y + mute.height <= box.y + box.height, `${tag}: Mute is cut off inside the speaker control`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** A save from before the Hum level and a fresh device both get 100; the slider sits with the others and fits. */
  async 'hum-slider-in-settings'(h) {
    for (const [viewport, prefs, tag] of [[TALL, levels({ master: 0.8, music: 0.6, sfx: 0.7 }), '390'], [SMALL, null, '320']]) {
      const { ctx, page, errors } = await boot(h, { viewport, prefs });
      try {
        await h.openSettings(page);
        const group = page.locator('.dq-settings').getByRole('group', { name: 'Sound levels', exact: true });
        const names = await group.getByRole('slider').evaluateAll((els) => els.map((e) => e.labels[0]?.textContent));
        h.expect(JSON.stringify(names) === '["Master","Music","Effects","Hum"]', `${tag}: Settings sliders are ${JSON.stringify(names)}`);
        const hum = group.getByRole('slider', { name: 'Hum', exact: true });
        const attrs = await hum.evaluate((e) => [e.min, e.max, e.step, e.value, e.getAttribute('aria-valuetext')]);
        h.expect(JSON.stringify(attrs) === '["0","100","1","100","100 percent"]', `${tag}: Hum slider min, max, step, value: ${JSON.stringify(attrs)}`);
        // aligned with Master and inside the screen
        const [m, u] = await Promise.all(['Master', 'Hum'].map((name) => group.getByRole('slider', { name, exact: true }).boundingBox()));
        h.expect(Math.abs(m.x - u.x) < 1 && Math.abs(m.width - u.width) < 1 && u.x >= 0 && u.x + u.width <= viewport.width, `${tag}: Hum slider at ${JSON.stringify(u)}, Master at ${JSON.stringify(m)}`);
        await page.locator('.dq-setting--vol').evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await h.sleep(400);
        await h.shot(page, `settings-sound-${tag}`);
        if (prefs) {
          h.expect((await stored(page)).hum === undefined, `${tag}: opening Settings wrote a Hum level`);
          // the level is kept, the others untouched, and it is still there after a reload
          await hum.fill('40');
          const s = await stored(page);
          h.expect(s.hum === 0.4 && s.master === 0.8 && s.music === 0.6 && s.sfx === 0.7 && s.muted === false, `${tag}: stored levels after Hum 40: ${JSON.stringify(s)}`);
          await page.reload();
          await h.openSettings(page);
          const again = page.locator('.dq-settings').getByRole('slider', { name: 'Hum', exact: true });
          h.expect((await again.inputValue()) === '40', `${tag}: Hum shows ${await again.inputValue()} after a reload`);
          const popover = await soundControls(page);
          h.expect((await popover.getByRole('slider', { name: 'Hum', exact: true }).inputValue()) === '40', `${tag}: the speaker control's Hum is not 40 after a reload`);
          await h.shot(page, `speaker-control-${tag}`);
        } else {
          const s = await stored(page);
          h.expect(s === null || s.hum === undefined || s.hum === 1, `${tag}: a fresh device stored ${JSON.stringify(s)}`);
        }
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /**
   * Hum 100, then 40, then Master 50 with Music and Effects moved too, each over a whole 10 s breath (six beats of the
   * hum's two close notes), so the breath and the beat cancel out: the hum's RMS follows the Hum level on the slider
   * curve with Master on top, Music and Effects don't touch it, and no change clicks or leaves a gap.
   */
  async 'hum-level-changes-the-playing-hum'(h) {
    const { ctx, page, errors } = await boot(h);
    try {
      const n = await humOn(h, page);
      const per = Q / (await rate(page, n));
      const controls = await soundControls(page);
      const slider = (name) => controls.getByRole('slider', { name, exact: true });
      h.expect((await slider('Hum').inputValue()) === '100', `Hum starts at ${await slider('Hum').inputValue()}, not 100`);
      await h.sleep(600);
      await h.shot(page, 'moment-speaker-control');
      const t0 = await clock(page, n);
      await recorded(page, n, t0 + 10);
      const b1 = await clock(page, n);
      await slider('Hum').fill('40');
      const c1 = await clock(page, n);
      await recorded(page, n, c1 + 10.4);
      const b2 = await clock(page, n);
      await slider('Master').fill('50');
      await slider('Effects').fill('20');
      await slider('Music').fill('30');
      const c2 = await clock(page, n);
      await recorded(page, n, c2 + 10.4);
      const qs = await quanta(page, n, t0, c2 + 10.4);
      whole(h, 'levels', qs, per, t0, c2 + 10.4);
      const span = (a, b) => qs.filter((q) => q[0] >= a && q[0] < b);
      const A = span(t0, t0 + 10);
      const B = span(c1 + 0.4, c1 + 10.4);
      const C = span(c2 + 0.4, c2 + 10.4);
      const [ra, rb, rc] = [rms(A), rms(B), rms(C)];
      h.expect(ra > 1e-3, `the hum is too quiet to measure at full level: RMS ${ra}`);
      for (const [name, got, want] of [['Hum 40', rb / ra, taper(0.4)], ['Hum 40 with Master 50', rc / ra, taper(0.4) * taper(0.5)]])
        h.expect(Math.abs(got / want - 1) < 0.12, `${name}: the hum is at ${(got * 100).toFixed(1)}% of full, not ${(want * 100).toFixed(1)}%`);
      // no click: the steepest step at each moment against the steady hum's at the louder of the levels around it
      const ref = steepest(A);
      const bound = (t) => (t < c1 + 0.5 ? 1 : t < c2 + 0.5 ? taper(0.4) : taper(0.4) * taper(0.5));
      const click = qs.find((q) => q[3] > CLICK * ref * bound(q[0]));
      h.expect(!click, `a click at ${click?.[0].toFixed(3)} s: a step of ${click?.[3].toExponential(2)} against the steady hum's ${(ref * bound(click?.[0] ?? 0)).toExponential(2)}`);
      // no gap: every 20 ms holds at least an eighth of the quietest level it could be at
      const floor = (t) => 0.12 * (t < b1 ? ra : t < b2 ? rb : rc);
      const gap = blocks(qs).find(([t, r]) => r < floor(t));
      note(h, 'levels', { full: ra, hum40: rb / ra, hum40master50: rc / ra, click: Math.max(...qs.map((q) => q[3] / bound(q[0]))) / ref, quietest: Math.min(...blocks(qs).map(([t, r]) => r / floor(t))) * 0.12 });
      h.expect(!gap, `a gap at ${gap?.[0].toFixed(3)} s: RMS ${gap?.[1].toExponential(2)}`);
      const s = await stored(page);
      h.expect(s.hum === 0.4 && s.master === 0.5, `stored levels: ${JSON.stringify(s)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /**
   * The page hides (a locked phone): the hum fades out, then pauses with the rest of the app's sound. It comes back
   * from silence with a short fade. A pause the system makes on its own (a call, iOS locking) is picked up the same way.
   */
  async 'hum-sleeps-and-wakes-without-a-pop'(h) {
    const { ctx, page, errors } = await boot(h);
    try {
      const n = await humOn(h, page);
      const per = Q / (await rate(page, n));
      const now = await clock(page, n);
      const steady = await quanta(page, n, now - 2, now);
      const ref = { rms: rms(steady), step: steepest(steady) };

      const hide = await clock(page, n);
      await setHidden(page, true);
      await page.waitForFunction((n) => window.__taps[n].a.context.state === 'suspended', n, { timeout: 3000 }).catch(() => {
        throw new Error('the hum kept playing on a hidden page');
      });
      const frozen = await clock(page, n);
      await h.sleep(1200);
      h.expect((await clock(page, n)) === frozen, 'the hum\'s clock ran while the page was hidden');
      await setHidden(page, false);
      await recorded(page, n, frozen + 1.6);
      const qs = await quanta(page, n, hide - 0.5, frozen + 1.6);
      whole(h, 'hidden', qs, per, hide - 0.5, frozen + 1.6);
      const faded = rms(qs.filter((q) => q[0] < frozen - 2 * per).slice(-8));
      h.expect(faded < 0.02 * ref.rms, `the hum was at ${((faded / ref.rms) * 100).toFixed(1)}% when the page paused it, not faded out`);
      // faded out and back in, so nothing clicks across the pause either
      wokeSoftly(h, 'page shown again', qs, per, frozen, ref.rms, ref);
      await h.shot(page, 'moment-after-wake');

      // The system pauses the hum at full level (a call, iOS locking) while the page stays in front. The hum waits,
      // like the rest of the app's sound, until the system lets it go, or until the next tap or key press, also one in
      // the speaker control, which keeps its taps and keys from the page.
      for (const how of ['the system', 'a key press', 'the Hum slider']) {
        const hum = how === 'the Hum slider' ? (await soundControls(page)).getByRole('slider', { name: 'Hum', exact: true }) : null;
        await hum?.focus();
        const at = await clock(page, n);
        await recorded(page, n, at + 1);
        const sys = await page.evaluate(async (n) => {
          const c = window.__taps[n].a.context;
          let frozen = null;
          c.addEventListener('statechange', () => frozen ??= c.state === 'suspended' ? c.currentTime : null);
          await c.suspend();
          await new Promise((r) => setTimeout(r, 300));
          return frozen ?? c.currentTime;
        }, n);
        h.expect((await clock(page, n)) === sys, `paused by the system, the hum woke itself before ${how} let it go`);
        if (how === 'the system') await page.evaluate((n) => window.__taps[n].a.context.resume(), n);
        else await page.keyboard.press(hum ? 'ArrowLeft' : 'Shift');
        await page.waitForFunction((n) => window.__taps[n].a.context.state === 'running', n, { timeout: 3000 }).catch(() => {
          throw new Error(`the hum stayed paused after ${how} let it go`);
        });
        await recorded(page, n, sys + 1.6);
        // the system cut it off at full level, so the wake is set against the hum just before the cut (the same point
        // of its breath and beat), and only what the page played after the cut must be free of clicks
        const around = await quanta(page, n, sys - 0.5, sys + 1.6);
        whole(h, `system pause, ${how}`, around, per, sys - 0.5, sys + 1.6);
        const cut = rms(around.filter((q) => q[0] < sys - 2 * per).slice(-5));
        wokeSoftly(h, `woken by ${how}`, around, per, sys, cut, ref, sys + 4 * per);
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Mute silences the hum and Unmute brings it back; the Safe Zone silences it at once; Done ends it. Nothing else hums. */
  async 'hum-still-stops-for-mute-safe-zone-and-done'(h) {
    const { ctx, page, errors } = await boot(h);
    try {
      let n = await humOn(h, page);
      const first = n;
      const controls = await soundControls(page);
      await controls.getByRole('button', { name: 'Mute', exact: true }).click();
      const m = await clock(page, n);
      await recorded(page, n, m + 1.2);
      const muted = await quanta(page, n, m + 0.5, m + 1.2);
      h.expect(muted.length > 100 && muted.every((q) => q[1] < SILENT_PEAK), `muted, the hum still peaks at ${Math.max(...muted.map((q) => q[1])).toExponential(2)}`);
      await controls.getByRole('button', { name: 'Unmute', exact: true }).click();
      const u = await clock(page, n);
      await recorded(page, n, u + 1.5);
      h.expect(rms(await quanta(page, n, u + 0.5, u + 1.5)) > 1e-3, 'Unmute did not bring the hum back');
      await page.keyboard.press('Escape');

      await page.locator('header .dq-safe').click({ timeout: 4000 });
      await page.waitForFunction(() => window.__daily.route.name === 'safe', null, { timeout: 3000 });
      await page.waitForFunction((n) => window.__taps[n].a.context.state === 'closed', n, { timeout: 3000 }).catch(() => {
        throw new Error('the hum kept going in the Safe Zone');
      });
      const tap = (await page.evaluate(() => window.__marks.filter((k) => k.to === 'safe'))).at(-1).at[n];
      const inside = await quanta(page, n, tap + WITHIN, Infinity);
      h.expect(inside.every((q) => q[1] < SILENT_PEAK), `the hum was heard ${WITHIN * 1000} ms into the Safe Zone`);
      await page.locator('header .dq-back').click({ timeout: 4000 });
      await page.waitForFunction(() => window.__daily.route.name !== 'safe', null, { timeout: 3000 });

      n = await humOn(h, page);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.waitForFunction((n) => window.__taps[n].a.context.state === 'closed', n, { timeout: 4000 }).catch(() => {
        throw new Error('the hum kept going after Done');
      });
      const left = await page.evaluate(() => window.__daily.route.name);
      h.expect(left !== 'moment', `Done stayed on ${left}`);
      await h.sleep(500);
      const humming = await page.evaluate((first) => window.__taps.slice(first).filter((t) => t.a.context.state !== 'closed').length, first);
      h.expect(!humming, `${humming} hum(s) still open after the moment ended`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
