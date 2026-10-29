// Wise Mind's stone step shows a calm 3D scene through the companion's shared scene host: live and drawn at phone,
// sideways and desktop sizes; in step with the countdown after the page freezes and through more time; one still frame
// with reduced motion, and in step again when Motion changes mid-scene (here or in another copy); the flat picture with no
// WebGL, never hidden again once the device is known to have none, and never hidden at all in a browser without WebGL 2;
// one WebGL context however often it opens, let go while the page is hidden; back after a lost context.
import sharp from 'sharp';

const PHONE = { width: 390, height: 844 };
const SIDE = { width: 844, height: 390 };
const DESK = { width: 1440, height: 900 };

const seed = (h) => ({ 'dbt.app.v1': h.SEEN });
const scenes = (page) => page.evaluate(() => (window.__scenes ? JSON.parse(JSON.stringify(window.__scenes)) : null));
/** the scene's last beat and the countdown on screen, read in the same moment */
const pair = (page) => page.evaluate(() => ({ s: window.__scenes ? JSON.parse(JSON.stringify(window.__scenes)) : null, num: document.querySelector('.dq-timer-num')?.textContent ?? '' }));
const wiseRuns = async (h, page) => JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}').events.filter((e) => e.k === 'skill' && e.skill === 'wise-mind').length;

/** Taps through any window the companion opens on arrival, then waits for Home. */
async function home(h, page) {
  let clear = 0;
  for (let i = 0; i < 80; i++) {
    const win = page.locator('.dq-sw').first();
    if (await win.count()) {
      clear = 0;
      // a window whose scrim is off is closing: tap it no more, wait until it is gone, so no tap lands on Home
      if (!(await page.locator('.dq-scrim.is-on').count())) await page.waitForFunction(() => !document.querySelector('.dq-sw') || !!document.querySelector('.dq-scrim.is-on'), null, { timeout: 5000 });
      else {
        const b = await win.boundingBox({ timeout: 500 }).catch(() => null);
        if (b) await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height - 8, b.height / 2));
      }
    } else if (!(await page.locator('.dq-scrim.is-on').count()) && (await page.locator('.dq-tile').first().isVisible().catch(() => false))) {
      if (++clear >= 3) return;
    } else clear = 0;
    await h.sleep(300);
  }
  await h.shot(page, 'fail-home');
  throw new Error('Home never appeared');
}

const tap = (page, name) => page.locator('.dq-skill').getByRole('button', { name, exact: true }).first().click();

/** Home, then Skills, Still Center, Begin and past the breathing to the stone step. */
async function toStone(h, page) {
  // the first-visit welcome opens a moment after Home appears, so a tap that lands on its scrim goes home and retries
  for (let i = 0; ; i++) {
    await home(h, page);
    try {
      await page.locator('.dq-tile', { hasText: 'Skills' }).first().click({ timeout: 4000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.locator('.dq-librow', { hasText: 'Still Center' }).first().click();
  await page.locator('.dq-intro-name', { hasText: 'Still Center' }).waitFor({ timeout: 10000 });
  await tap(page, 'Begin');
  await h.settled(page, '.dq-step-body .dq-actions');
  await tap(page, 'Next');
  await page.locator('.dq-timer-svg--drift').waitFor({ timeout: 10000 });
  await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
}

/** Stops the page clock a moment from now; a slow page can pass a moment asked for too soon, so it asks again. */
async function pauseSoon(page) {
  for (let i = 0; ; i++) {
    try {
      return await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
    } catch (e) {
      if (i === 4) throw e;
    }
  }
}

/** The page goes to the background (hidden, as in another tab) or comes back, as the page sees it. */
const hide = (page, on) =>
  page.evaluate((hidden) => {
    if (!window.__vis) {
      window.__vis = { hidden: false };
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__vis.hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__vis.hidden ? 'hidden' : 'visible') });
    }
    window.__vis.hidden = hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  }, on);

/** The scene is on screen: its first frame is drawn, which took CI's software GPU about 16 s in some runs. */
async function live(h, page, where) {
  await page.locator('.dq-timer-stage.is-scene-live').waitFor({ timeout: 30000 }).catch(async () => {
    await h.shot(page, `fail-${where}`);
    throw new Error(`${where}: the 3D scene never came on screen`);
  });
}

/**
 * 15 s more on the countdown, once its first frame has put the scene on screen: the scene draws only while its
 * countdown runs, and that first frame can take most of it. Done once the scene has drawn a frame with the new length.
 */
async function moreTime(page) {
  const dur = (await scenes(page)).last.dur;
  await page.locator('.dq-timer').getByRole('button', { name: '+15 s' }).click();
  await page.waitForFunction((dur) => window.__scenes?.last.dur > dur, dur, { timeout: 15000 });
}

/**
 * Waits up to 30 s for `test` in the page, so a busy GPU holding frames back only slows this down. On a timeout the check
 * that follows says what is missing.
 */
async function until(page, test, arg) {
  await page.waitForFunction(test, arg, { timeout: 30000 }).catch((e) => {
    if (e.name !== 'TimeoutError') throw e;
  });
}

/** Brightness of the middle of the scene window as shown on screen: its mean, spread and brightest pixel. */
async function pixels(page) {
  const { data, info } = await sharp(await page.locator('.dq-scene').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: ht, channels: c } = info;
  let n = 0, sum = 0, sq = 0, max = 0;
  for (let y = Math.floor(ht * 0.2); y < ht * 0.8; y++) {
    for (let x = Math.floor(w * 0.2); x < w * 0.8; x++) {
      const i = (y * w + x) * c;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++, (sum += l), (sq += l * l), (max = Math.max(max, l));
    }
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(1), max: Math.round(max) };
}

async function drawn(h, page, where) {
  // a scene fades in over its flat picture once it shows, so it is judged once fully in (the page clock may be stopped,
  // so this looks from here rather than from the page)
  for (const end = Date.now() + 5000; Number(await page.locator('.dq-scene').evaluate((e) => getComputedStyle(e).opacity)) < 0.99; ) {
    h.expect(Date.now() < end, `${where}: the scene never finished fading in`);
    await h.sleep(50);
  }
  const p = await pixels(page);
  h.expect(p.sd > 4 && p.max > 40 && p.mean > 6, `${where}: the scene looks blank (${JSON.stringify(p)})`);
  return p;
}

/** The flat picture is hidden behind a live scene, or showing when there is none. */
/**
 * Counts every time a scene stage hid its flat picture to wait for a scene (read as window.__waits): each wait that
 * ended, even one that began and ended within the same moment, plus any still going.
 */
const countWaits = () => {
  window.__ended = 0;
  new MutationObserver((records) => {
    for (const r of records) if (String(r.oldValue).split(' ').includes('is-scene-wait') && !r.target.classList.contains('is-scene-wait')) window.__ended++;
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  Object.defineProperty(window, '__waits', { get: () => window.__ended + document.querySelectorAll('.is-scene-wait').length });
};
async function flat(page) {
  return page.$$eval('.dq-scene-flat', (els) => els.map((e) => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && Number(s.opacity) > 0.5; }));
}

/** The countdown shows whole seconds left, rounded up; the scene draws at most 30 times a second, so it may trail a frame. */
function inStep(h, { s, num }, where) {
  const b = s?.last;
  h.expect(b && !b.still, `${where}: no moving frame has been drawn`);
  if (num === 'Done') return h.expect(b.done && b.e >= b.dur - 0.05, `${where}: the countdown is done but the scene is at ${b.e.toFixed(2)} of ${b.dur} s`);
  const left = Number(num);
  const sceneLeft = b.dur - b.e;
  h.expect(!b.done && sceneLeft > left - 1 - 0.1 && sceneLeft <= left + 0.1, `${where}: the scene is at ${b.e.toFixed(2)} of ${b.dur} s but the countdown says ${num}`);
}

/**
 * one slow frame (here the first frame's fence says the GPU took 600 ms) lowers this scene only and for now: once its
 * frames keep up it is back at the full pixel ratio, nothing is kept for the visit, and no change of ratio ever shows
 * a blank frame, on a page running at 60 frames a second or held to 30. The page clock drives the frames, so this reads
 * the same on any renderer.
 */
async function oneSlowFrame(h, hz) {
  const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
  await ctx.addInitScript(() => {
    window.__blank = 0;
    const P = WebGL2RenderingContext.prototype;
    const make = P.fenceSync, get = P.getSyncParameter;
    let first = null;
    P.fenceSync = function (...args) {
      const f = make.apply(this, args);
      if (!first && this.canvas.closest?.('.dq-scene')) first = { f, at: performance.now() };
      return f;
    };
    P.getSyncParameter = function (f, pname) {
      if (first && f === first.f && pname === this.SYNC_STATUS && performance.now() - first.at < 600) return this.UNSIGNALED;
      return get.call(this, f, pname);
    };
  });
  await page.clock.install();
  await page.reload();
  await home(h, page);
  await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'wise-mind', entry: 'stone' }));
  await page.locator('.dq-skill').getByRole('button', { name: 'Begin', exact: true }).first().click({ timeout: 10000 });
  await page.locator('.dq-scene canvas').waitFor({ state: 'attached', timeout: 15000 });
  await pauseSoon(page);
  // a page held to 30 frames a second: every animation frame callback waits for the frame after the one it asked for
  if (hz === 30) {
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
      const ids = new Map();
      let n = 0;
      window.requestAnimationFrame = (cb) => {
        const id = ++n;
        ids.set(id, raf(() => ids.set(id, raf((t) => (ids.delete(id), cb(t))))));
        return id;
      };
      window.cancelAnimationFrame = (id) => (caf(ids.get(id)), ids.delete(id));
    });
  }
  // every change of the canvas size has to come with a frame drawn at the new size before the page shows it
  await page.evaluate(() => {
    const c = document.querySelector('.dq-scene canvas');
    new MutationObserver(() => {
      if (Math.abs(c.width / c.parentElement.clientWidth - window.__scenes.dpr) > 0.02) window.__blank++;
    }).observe(c, { attributes: true, attributeFilter: ['width'] });
  });
  const full = await page.evaluate(() => Math.min(window.devicePixelRatio, 2));
  // the scene shows once its first frame is drawn: the page clock is stepped until then (600 ms at least)
  for (const t0 = Date.now(); !(await page.locator('.dq-timer-stage.is-scene-live').count()); ) {
    if (Date.now() - t0 > 30000) {
      await h.shot(page, 'fail-one-slow-frame');
      throw new Error('one slow frame: the 3D scene never came on screen');
    }
    await page.clock.runFor(100);
  }
  const low = await scenes(page);
  h.expect(low.dpr < full, `${hz} fps: the slow first frame did not lower the scene (${low.dpr})`);
  await page.clock.runFor(6000);
  const back = await scenes(page);
  const blank = await page.evaluate(() => window.__blank);
  h.expect(blank === 0, `${hz} fps: a change of pixel ratio showed ${blank} blank frames`);
  h.expect(back.dpr === full && !back.kept, `${hz} fps: one slow frame left the scene at ${back.dpr} (kept for the visit: ${back.kept}), not back at ${full}`);
  console.log(`  one slow frame at ${hz} fps: ${low.dpr} for now, back to ${back.dpr}, kept ${back.kept ?? 'nothing'}`);
  h.expect(!errors.length, errors.join('\n'));
  await ctx.close();
}

/**
 * A GPU that copes with a small canvas but not a big one (here a draw costs 1 ms for every 1000 pixels over 60000): the
 * scene draws fewer pixels within a few frames and keeps moving smoothly instead of a frame every half second. It is
 * counted in frames the scene drew, not in time, since a slow GPU can hold frames back for seconds. `late`: the first
 * frame takes until the countdown is nearly over, as CI's software GPU did in the runs where this drew no frames.
 */
async function slowGpu(h, late) {
  const { ctx, page, errors } = await h.open(seed(h), '?mute', DESK);
  await ctx.addInitScript((late) => {
    window.__gpuMs = 0;
    // frames whose added work went over the scene's 30 fps budget
    window.__overBudget = 0;
    let frame = -1, work = 0;
    const P = WebGL2RenderingContext.prototype;
    for (const name of ['drawArrays', 'drawElements']) {
      const draw = P[name];
      P[name] = function (...args) {
        const r = draw.apply(this, args);
        // only the scene's own canvas is slow; the rest of the page draws as usual
        if (!this.canvas.closest?.('.dq-scene')) return r;
        const ms = Math.max(0, this.drawingBufferWidth * this.drawingBufferHeight - 60000) / 1000;
        window.__gpuMs += ms;
        // a frame's draws all come before the scene counts that frame
        if (window.__scenes.frames !== frame) (frame = window.__scenes.frames), (work = 0);
        const before = work;
        work += ms;
        if (before <= 1000 / 30 && work > 1000 / 30) window.__overBudget++;
        const until = performance.now() + ms;
        while (performance.now() < until);
        return r;
      };
    }
    if (!late) return;
    const make = P.fenceSync, get = P.getSyncParameter;
    let first = null;
    P.fenceSync = function (...args) {
      const f = make.apply(this, args);
      if (!first && this.canvas.closest?.('.dq-scene')) first = f;
      return f;
    };
    // the first frame is done once the countdown shows 3 s left
    P.getSyncParameter = function (f, pname) {
      if (f === first && pname === this.SYNC_STATUS && Number(document.querySelector('.dq-timer-num')?.textContent) > 3) return this.UNSIGNALED;
      return get.call(this, f, pname);
    };
  }, late);
  await page.reload();
  await toStone(h, page);
  // held that long, the first frame outlasts live()'s wait
  if (late) await page.waitForFunction(() => !(Number(document.querySelector('.dq-timer-num')?.textContent) > 3), null, { timeout: 30000 });
  await live(h, page, 'slow');
  // 30 s more, so the countdown outlasts the measuring however late the scene came on screen
  await moreTime(page);
  await moreTime(page);
  const full = await page.evaluate(() => Math.min(window.devicePixelRatio, 2));
  const read = () => page.evaluate(() => ({ ...window.__scenes, gpuMs: window.__gpuMs, overBudget: window.__overBudget }));
  // only sustained slowness keeps a ratio for the visit; a slow first frame lowers it for now, then it comes back
  await until(page, (full) => window.__scenes.kept != null && window.__scenes.dpr < full, full);
  const a = await read();
  h.expect(a.kept != null && a.dpr < full, `slow GPU: the scene kept no lower ratio (ratio ${a.dpr}, kept ${a.kept})`);
  // five here: the first frame, then four that show the slowness is sustained; a page that stalls may add a few, since
  // the scene leaves out gaps over 1.5 s
  h.expect(a.overBudget <= 8, `slow GPU: ${a.overBudget} frames over budget before the scene kept a lower ratio`);
  const t0 = Date.now();
  await until(page, (n) => window.__scenes.frames >= n, a.frames + 20);
  const b = await read();
  const secs = (Date.now() - t0) / 1000;
  const frames = b.frames - a.frames;
  h.expect(frames >= 20, `slow GPU: the scene drew only ${frames} frames once it kept a ratio (countdown done: ${b.last.done})`);
  const ms = (b.gpuMs - a.gpuMs) / frames;
  // Full size costs about 400 ms per frame here; adaptation must fit that work into the scene's 30 fps budget.
  // Count the work this fixture adds, since a busy browser can present fewer frames even after the scene adapts.
  h.expect(ms <= 1000 / 30, `slow GPU: ${ms.toFixed(1)} ms per frame at pixel ratio ${b.dpr}`);
  h.expect(b.dpr < full, `slow GPU: the scene still draws at the full pixel ratio ${b.dpr}`);
  inStep(h, await pair(page), 'slow');
  await drawn(h, page, 'slow');
  await h.shot(page, late ? 'slow-gpu-late-desk' : 'slow-gpu-desk');
  console.log(`  slow GPU${late ? ', late first frame' : ''}: ${a.overBudget} frames over budget, then pixel ratio ${b.dpr}, ${frames} frames in ${secs.toFixed(1)} s, ${ms.toFixed(1)} ms per frame`);
  h.expect(!errors.length, errors.join('\n'));
  await ctx.close();
}

export const scenarios = {
  /** the stone step is a live, drawn 3D scene at phone, sideways and desktop sizes, with the flat picture hidden */
  async 'scene-live'(h) {
    for (const [tag, vp] of [['phone', PHONE], ['side', SIDE], ['desk', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toStone(h, page);
      await live(h, page, tag);
      await moreTime(page);
      await until(page, () => window.__scenes.frames > 10);
      const s = await scenes(page);
      h.expect(s.live === 1 && s.contexts === 1 && s.frames > 10, `${tag}: ${JSON.stringify(s)}`);
      h.expect(s.last.kind === 'drift' && !s.last.still && s.last.e > 0.5, `${tag}: the scene is not following the timer: ${JSON.stringify(s.last)}`);
      h.expect((await page.locator('.dq-scene canvas').count()) === 1, `${tag}: expected one canvas in the scene window`);
      h.expect((await flat(page)).every((on) => !on), `${tag}: the flat picture still shows over the 3D scene`);
      const p = await drawn(h, page, tag);
      const [stage, win] = await Promise.all([page.locator('.dq-timer-stage').boundingBox(), page.locator('.dq-scene').boundingBox()]);
      h.expect(win.x >= stage.x - 0.5 && win.x + win.width <= stage.x + stage.width + 0.5 && win.y >= stage.y - 0.5 && win.y + win.height <= stage.y + stage.height + 0.5, `${tag}: the scene window spills out of the timer`);
      h.expect(win.x >= 0 && win.x + win.width <= vp.width, `${tag}: the scene window is cut off at the sides`);
      await h.shot(page, `live-${tag}`);
      console.log(`  ${tag}: ${s.frames} frames, pixels ${JSON.stringify(p)}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** the scene runs on the timer's clock: after the page freezes it picks up in step, and more time keeps them together */
  async 'scene-clock'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await page.clock.install();
    await page.reload();
    await toStone(h, page);
    await live(h, page, 'clock');
    await moreTime(page);
    await h.sleep(1200);
    inStep(h, await pair(page), 'running');

    // the page freezes (its clock and its frames stop together, as in a background tab), then comes back
    await pauseSoon(page);
    await h.sleep(1500);
    const b = await pair(page);
    await page.clock.resume();
    await until(page, (b) => window.__scenes.frames > b.frames + 10 && window.__scenes.last.e > b.last.e + 1, b.s);
    const c = await pair(page);
    h.expect(c.s.frames > b.s.frames + 10 && c.s.last.e > b.s.last.e + 1, `resumed: the scene did not move on (${b.s.frames} -> ${c.s.frames} frames, ${b.s.last.e.toFixed(2)} -> ${c.s.last.e.toFixed(2)} s)`);
    inStep(h, c, 'resumed');

    await moreTime(page);
    const d = await pair(page);
    h.expect(d.s.last.dur === c.s.last.dur + 15, `more time mid-way: the scene thinks the timer is ${d.s.last.dur} s, not ${c.s.last.dur + 15} s`);
    inStep(h, d, 'more time mid-way');

    await page.clock.fastForward(60000);
    await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 5000 });
    await h.sleep(300);
    const e = await pair(page);
    inStep(h, e, 'done');
    await h.sleep(1200);
    const f = await pair(page);
    h.expect(f.s.frames - e.s.frames <= 1, `done: the scene kept drawing after the timer stopped (${e.s.frames} -> ${f.s.frames})`);
    await drawn(h, page, 'done');
    await h.shot(page, 'clock-done');

    await page.locator('.dq-timer').getByRole('button', { name: '+15 s' }).click();
    await until(page, (f) => window.__scenes.frames > f.frames + 10, f.s);
    const g = await pair(page);
    h.expect(!g.s.last.done && g.s.last.dur > e.s.last.dur + 14 && g.s.frames > f.s.frames + 10, `more time after done: the scene did not start again (${JSON.stringify(g.s.last)})`);
    inStep(h, g, 'more time after done');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** reduced motion, from the device or from Motion: Reduced in Settings, draws one still frame of the stone at rest */
  async 'scene-still'(h) {
    for (const mode of ['device', 'setting']) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
      if (mode === 'device') {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
      } else {
        await h.openSettings(page);
        await page.getByRole('radio', { name: 'Motion: Reduced', exact: true }).click();
        await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      }
      await toStone(h, page);
      await live(h, page, `still ${mode}`);
      await h.sleep(800);
      const a = await scenes(page);
      await h.sleep(2000);
      const b = await scenes(page);
      h.expect(a.last.still && b.frames === a.frames, `reduced motion (${mode}): the scene kept drawing (${a.frames} -> ${b.frames}, still ${a.last.still})`);
      h.expect(b.frames <= 3, `reduced motion (${mode}): ${b.frames} frames drawn for one still picture`);
      await drawn(h, page, `still ${mode}`);
      await h.shot(page, `still-${mode}-phone`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** with no WebGL the flat picture shows and moves as before, and the skill still completes and counts */
  async 'scene-no-webgl'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await ctx.addInitScript(countWaits);
    await ctx.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest);
      };
    });
    await page.clock.install();
    await page.reload();
    await home(h, page);
    const before = await wiseRuns(h, page);
    await toStone(h, page);
    await h.sleep(1500);
    const s = await scenes(page);
    h.expect(s && s.contexts === 0 && s.live === 0, `no WebGL: the scene host never tried, or holds a context: ${JSON.stringify(s)}`);
    h.expect(!(await page.locator('.dq-scene').count()) && !(await page.locator('.is-scene-live, .is-scene-wait').count()), 'no WebGL: a scene window was left on the page');
    h.expect((await flat(page)).every(Boolean), 'no WebGL: the flat picture is hidden');
    const y0 = await page.locator('.dq-timer-svg--drift ellipse').getAttribute('cy');
    await h.sleep(1000);
    const y1 = await page.locator('.dq-timer-svg--drift ellipse').getAttribute('cy');
    h.expect(y0 !== y1, 'no WebGL: the flat stone does not move');
    await h.shot(page, 'no-webgl-phone');
    await page.clock.fastForward(21000);
    await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 5000 });
    await tap(page, 'Next');
    await h.sleep(500);
    await tap(page, 'Skip');
    await h.sleep(500);
    await tap(page, 'Done');
    await page.locator('.dq-feedback').waitFor({ timeout: 5000 });
    await tap(page, 'Yes');
    await page.locator('.dq-after:not(.is-hidden)').waitFor({ timeout: 5000 });
    h.expect((await wiseRuns(h, page)) === before + 1, 'no WebGL: Still Center was not credited once');
    // the next visit knows: the flat picture shows from the first frame, never hidden to wait for a scene
    await tap(page, 'Back to the Lantern');
    const waited = await page.evaluate(() => window.__waits);
    await toStone(h, page);
    await h.sleep(1000);
    h.expect((await page.evaluate(() => window.__waits)) === waited, `no WebGL, second visit: the flat picture was hidden again to wait for a scene`);
    h.expect((await flat(page)).every(Boolean), 'no WebGL, second visit: the flat picture is hidden');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a browser without WebGL 2 at all: the flat picture shows from the first frame of the first visit */
  async 'scene-no-webgl2'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await ctx.addInitScript(countWaits);
    // a browser with no WebGL at all: neither the API nor a context
    await ctx.addInitScript(() => {
      delete window.WebGL2RenderingContext;
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest);
      };
    });
    await page.reload();
    await toStone(h, page);
    await h.sleep(1000);
    const s = await scenes(page);
    h.expect((await page.evaluate(() => window.__waits)) === 0, 'no WebGL 2: the flat picture was hidden to wait for a scene');
    h.expect(!s || (s.contexts === 0 && s.live === 0), `no WebGL 2: the scene host made a context: ${JSON.stringify(s)}`);
    h.expect((await flat(page)).every(Boolean) && (await flat(page)).length > 0, 'no WebGL 2: the flat picture is hidden');
    await h.shot(page, 'no-webgl2-phone');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a hidden page holds no scene: past the idle period its WebGL context is gone, and shown again the scene is in step */
  async 'scene-hidden'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await page.clock.install();
    await page.reload();
    await toStone(h, page);
    await live(h, page, 'before hiding');
    // more time, so the countdown outlasts the time spent hidden
    await moreTime(page);
    await h.sleep(800);
    inStep(h, await pair(page), 'before hiding');
    await hide(page, true);
    await h.sleep(300);
    const a = await scenes(page);
    h.expect(a.live === 0 && !(await page.locator('.dq-scene').count()), `hidden: the scene is still up: ${JSON.stringify(a)}`);
    await page.clock.fastForward(16000);
    await h.sleep(300);
    const b = await scenes(page);
    h.expect(b.contexts === 0, `hidden past the idle period: the shared renderer kept its WebGL context: ${JSON.stringify(b)}`);
    await hide(page, false);
    await live(h, page, 'shown again');
    await moreTime(page);
    await until(page, (n) => window.__scenes.frames > n, b.frames + 10);
    const c = await pair(page);
    h.expect(c.s.live === 1 && c.s.contexts === 1 && c.s.frames > b.frames + 10, `shown again: ${JSON.stringify(c.s)}`);
    inStep(h, c, 'shown again');
    await drawn(h, page, 'shown again');
    await h.shot(page, 'hidden-back-phone');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** Motion changed mid-scene, in this copy or another open one: Reduced stills the scene, Full moves it again in step */
  async 'scene-motion'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await toStone(h, page);
    await live(h, page, 'motion');
    // more time, so the countdown outlasts every change below
    await moreTime(page);
    inStep(h, await pair(page), 'motion: full');
    const still = async (where) => {
      await page.waitForFunction(() => window.__scenes?.last.still, null, { timeout: 15000 });
      const a = await scenes(page);
      await h.frames(page, 60);
      const b = await scenes(page);
      h.expect(a.last.still && b.frames === a.frames, `${where}: the scene did not settle on one still frame (${a.frames} -> ${b.frames}, still ${a.last.still})`);
      return b;
    };
    const moving = async (where, from) => {
      await page.waitForFunction((from) => {
        const s = window.__scenes;
        return s?.frames > from.frames + 10 && !s.last.still && s.last.e > from.last.e;
      }, from, { timeout: 15000 }).catch(async (e) => {
        if (e.name !== 'TimeoutError') throw e;
        const s = await scenes(page);
        throw new Error(`${where}: only ${(s?.frames ?? 0) - from.frames} new frames, progress ${((s?.last?.e ?? 0) - from.last.e).toFixed(2)} s (needed 11 frames and advancing time)`);
      });
      const c = await pair(page);
      inStep(h, c, where);
    };
    // Settings is a screen of its own, so this copy sets Motion mid-scene the way its Settings screen does
    const here = (m) =>
      page.evaluate((v) => {
        const app = window.__daily;
        app.store.state.settings.motion = v;
        app.store.touch('motion');
        app.store.save();
        app.applyMotion();
      }, m);
    await here('reduce');
    let s = await still('Reduced here');
    await here('full');
    await moving('Full here', s);

    // another open copy (a second tab of this one) changes it on its own Settings screen
    const [other] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(() => void window.open('/?mute'))]);
    other.on('pageerror', (e) => errors.push('pageerror, other copy: ' + e.message));
    await h.openSettings(other);
    // the copy with the scene is the one in view: a window left under another draws hardly any frames
    await page.bringToFront();
    await other.getByRole('radio', { name: 'Motion: Reduced', exact: true }).click();
    s = await still('Reduced in another copy');
    await other.getByRole('radio', { name: 'Motion: Full', exact: true }).click();
    await moving('Full in another copy', s);
    h.expect((await page.evaluate(() => document.visibilityState)) === 'visible', 'the copy with the scene was hidden meanwhile, so it was not followed while in view');
    await drawn(h, page, 'motion');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** going in and out of the scene 20 times keeps one WebGL context, frees everything on leaving, then lets go */
  async 'scene-cycles'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await page.clock.install();
    await page.reload();
    for (let i = 1; i <= 20; i++) {
      await toStone(h, page);
      await live(h, page, `cycle ${i}`);
      const s = await scenes(page);
      const same = await page.evaluate(() => (window.__firstCanvas ??= document.querySelector('.dq-scene canvas')) === document.querySelector('.dq-scene canvas'));
      h.expect(s.live === 1 && s.contexts === 1 && same, `cycle ${i}: ${s.live} live, ${s.contexts} contexts, same canvas ${same}`);
      await page.getByRole('button', { name: 'Leave this skill' }).click();
      await page.locator('.dq-timer-stage').waitFor({ state: 'detached', timeout: 5000 });
      const out = await scenes(page);
      h.expect(out.live === 0 && out.contexts === 1 && !(await page.locator('.dq-scene').count()), `cycle ${i}: after leaving ${JSON.stringify(out)}`);
      h.expect(out.left && !out.left.geometries && !out.left.textures && !out.left.programs, `cycle ${i}: leaving left things on the GPU: ${JSON.stringify(out.left)}`);
    }
    await page.clock.fastForward(16000);
    await h.sleep(300);
    const idle = await scenes(page);
    h.expect(idle.contexts === 0 && idle.live === 0, `idle: the shared renderer kept its context: ${JSON.stringify(idle)}`);
    await toStone(h, page);
    await live(h, page, 'after idle');
    h.expect((await scenes(page)).contexts === 1, 'after idle: the scene did not get a fresh context');
    await drawn(h, page, 'after idle');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'scene-slow-gpu'(h) {
    await slowGpu(h, false);
  },
  async 'scene-slow-gpu-late-start'(h) {
    await slowGpu(h, true);
  },

  /**
   * the scene never makes the page wait for the GPU (no read-back or finish on its context), so tapping Start on a step
   * with a scene scrolls the scene into view straight away, at the small and sideways sizes where it has to move
   */
  async 'scene-never-waits'(h) {
    for (const vp of [SIDE, { width: 320, height: 568 }]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await ctx.addInitScript(() => {
        window.__gpuWaits = 0;
        const P = WebGL2RenderingContext.prototype;
        for (const name of ['readPixels', 'finish', 'clientWaitSync']) {
          const call = P[name];
          P[name] = function (...args) {
            if (this.canvas.closest?.('.dq-scene')) window.__gpuWaits++;
            return call.apply(this, args);
          };
        }
      });
      await page.reload();
      await home(h, page);
      await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'cope-ahead', entry: 'picture' }));
      await page.locator('.dq-skill').getByRole('button', { name: 'Begin', exact: true }).first().click({ timeout: 10000 });
      await page.locator('.dq-timer-svg--drift').waitFor({ timeout: 10000 });
      await live(h, page, `never waits ${vp.width}x${vp.height}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await h.settled(page, '.dq-timer-stage');
      await tap(page, 'Start 30 s');
      await h.sleep(900);
      const box = await page.locator('.dq-timer-stage').boundingBox();
      h.expect(box.y >= -1 && box.y + box.height <= vp.height + 1, `${vp.width}x${vp.height}: 900 ms after Start the scene is still off screen (${Math.round(box.y)}..${Math.round(box.y + box.height)})`);
      await h.settled(page, '.dq-timer-stage');
      await h.sleep(1500);
      const waits = await page.evaluate(() => window.__gpuWaits);
      h.expect(waits === 0 && (await scenes(page)).frames > 3, `${vp.width}x${vp.height}: the scene made the page wait for the GPU ${waits} times`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'scene-one-slow-frame'(h) {
    await oneSlowFrame(h, 60);
  },
  async 'scene-one-slow-frame-30fps'(h) {
    await oneSlowFrame(h, 30);
  },

  /** a lost WebGL context shows the flat picture; when it comes back the scene draws again */
  async 'scene-context-restored'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await toStone(h, page);
    await live(h, page, 'restore');
    await page.evaluate(() => {
      window.__lose = document.querySelector('.dq-scene canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await page.locator('.dq-timer-stage:not(.is-scene-live)').waitFor({ timeout: 5000 });
    await h.sleep(800);
    const a = await scenes(page);
    await h.sleep(800);
    const b = await scenes(page);
    h.expect(a.live === 0 && b.frames === a.frames, `lost: the scene kept drawing (${a.frames} -> ${b.frames})`);
    h.expect((await flat(page)).every(Boolean), 'lost: the flat picture did not come back');
    await page.evaluate(() => window.__lose.restoreContext());
    await live(h, page, 'restored');
    await moreTime(page);
    await until(page, (n) => window.__scenes.frames > n, b.frames + 10);
    const c = await scenes(page);
    h.expect(c.live === 1 && c.contexts === 1 && c.frames > b.frames + 10, `restored: ${JSON.stringify(c)}`);
    inStep(h, await pair(page), 'restored');
    await drawn(h, page, 'restored');
    await h.shot(page, 'restored-phone');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
