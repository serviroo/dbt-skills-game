// Wise Mind's stone step shows a calm 3D scene through the companion's shared scene host: live and drawn at phone,
// sideways and desktop sizes; in step with the countdown after the page freezes and through more time; one still frame
// with reduced motion, and in step again when Motion changes mid-scene (here or in another copy); the flat picture with no
// WebGL, never hidden again once the device is known to have none, and never hidden at all in a browser without WebGL 2;
// one WebGL context however often it opens, let go while the page is hidden; back after a lost context.
// The wave, the breathing light and the tide go through the same host: each is live and drawn at four screen sizes and
// does what its picture promises (the board rides the swell, the light swells with the breath in the player's colour,
// the water comes in and goes out), keeps to its timer's clock, stops on leaving, holds still with reduced motion and
// leaves its flat picture with no WebGL. The breathing light is a small hot core in a halo gone by half its ring, with
// the countdown readable (3:1) under it all breath long; the wave's moon is a light that shows whole at every size.
import sharp from 'sharp';
import { screenshot } from './harness.mjs';

const PHONE = { width: 390, height: 844 };
const SIDE = { width: 844, height: 390 };
const DESK = { width: 1440, height: 900 };
/** the four sizes every new scene is checked at */
const VIEWS = [['phone', PHONE], ['small', { width: 320, height: 568 }], ['side', SIDE], ['desk', { width: 1280, height: 800 }]];


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

/**
 * Home, then straight to one step of a skill (Begin on its intro goes to the step). With `pause` the page clock stops
 * the moment the step shows, so a check can see the step's first seconds however slowly the page draws.
 */
async function toStep(h, page, id, entry, { pause = false } = {}) {
  // the first-visit welcome opens a moment after Home appears, so a tap it covers goes back Home and tries again
  for (let i = 0; ; i++) {
    if (i) await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await home(h, page);
    await page.evaluate(([id, entry]) => window.__daily.go({ name: 'skill', id, entry }), [id, entry]);
    try {
      await page.locator('.dq-skill').getByRole('button', { name: 'Begin', exact: true }).first().click({ timeout: 10000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.locator('.dq-timer-stage').waitFor({ timeout: 10000 });
  if (pause) await h.pauseClock(page);
  await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
}

/** The scene is on screen: its first frame is drawn, which took CI's software GPU about 16 s in some runs. */
async function live(h, page, where, stage = '.dq-timer-stage') {
  await page.locator(`${stage}.is-scene-live`).waitFor({ timeout: 30000 }).catch(async () => {
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
  const { data, info } = await sharp(await screenshot(page.locator('.dq-scene'))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
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
  await h.pauseClock(page);
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

/** A live scene of this kind, drawn, alone in its window, over its hidden flat picture and inside its stage and the screen. */
async function looks(h, page, tag, kind, vp, stage = '.dq-timer-stage', { stopped = false } = {}) {
  // it keeps drawing; how fast is checked on the real clock (scene-live, scene-slow-gpu). On a stopped page clock the
  // clock is run half a second instead, so the scene's own time moves only that much however slowly the page draws.
  const s0 = await scenes(page);
  if (stopped) await page.clock.runFor(500);
  else await h.sleep(1500);
  const s = await scenes(page);
  h.expect(s.live === 1 && s.contexts === 1 && s.frames - s0.frames >= 3, `${kind} ${tag}: ${s.frames - s0.frames} frames in ${stopped ? '0.5 s of page time' : '1.5 s'}, ${JSON.stringify(s)}`);
  h.expect(s.last.kind === kind && !s.last.still, `${kind} ${tag}: expected a moving ${kind} scene, got ${JSON.stringify(s.last)}`);
  h.expect((await page.locator('.dq-scene canvas').count()) === 1, `${kind} ${tag}: expected one canvas in the scene window`);
  h.expect((await flat(page)).every((on) => !on), `${kind} ${tag}: the flat picture still shows over the 3D scene`);
  const p = await drawn(h, page, `${kind} ${tag}`);
  const [box, win] = await Promise.all([page.locator(stage).boundingBox(), page.locator('.dq-scene').boundingBox()]);
  h.expect(win.x >= box.x - 0.5 && win.x + win.width <= box.x + box.width + 0.5 && win.y >= box.y - 0.5 && win.y + win.height <= box.y + box.height + 0.5, `${kind} ${tag}: the scene window spills out of its stage`);
  h.expect(win.x >= 0 && win.x + win.width <= vp.width, `${kind} ${tag}: the scene window is cut off at the sides`);
  await h.shot(page, `${kind}-${tag}`);
  console.log(`  ${kind} ${tag}: ${s.frames} frames at pixel ratio ${s.dpr}, pixels ${JSON.stringify(p)}`);
}

/** The scene's probe after jumping the page clock forward `ms` and letting a few frames draw. */
async function after(h, page, ms) {
  // the page clock is stopped: the jump runs the next animation frame once, which draws the scene at the new moment
  if (ms > 0) await page.clock.fastForward(Math.round(ms));
  return (await scenes(page)).last;
}

/**
 * Waits, with the page clock stopped, until the scene shows: it shows once its first frame is drawn, which it looks for
 * on animation frames, so the clock is stepped a frame at a time until then. The scene's time then starts from where it
 * first shows, however long the GPU took, and moves only when a check moves it.
 */
async function showsStopped(h, page, where, stage = '.dq-timer-stage') {
  for (const t0 = Date.now(); !(await page.locator(`${stage}.is-scene-live`).count()); ) {
    if (Date.now() - t0 > 30000) {
      await h.shot(page, `fail-${where.replace(/\W+/g, '-')}`);
      throw new Error(`${where}: the 3D scene never came on screen`);
    }
    await page.clock.runFor(16);
  }
}

/**
 * The clock runs again, as when the page comes back. Returns once the scene has drawn 10 more frames and moved on 1 s:
 * a slow page can still be on one long frame when a fixed wait ends, but a scene that stays put still fails.
 */
async function comesBack(page, b) {
  await page.clock.resume();
  await until(page, (b) => window.__scenes.frames > b.frames + 10 && window.__scenes.last.e > b.last.e + 1, b.s);
  return pair(page);
}

/** The page freezes and comes back: the scene picks up in step with the countdown. Then leaving frees it. */
async function keepsTime(h, page, kind) {
  await h.pauseClock(page);
  await h.sleep(1200);
  const b = await pair(page);
  const c = await comesBack(page, b);
  h.expect(c.s.frames > b.s.frames + 10 && c.s.last.e > b.s.last.e + 1, `${kind} resumed: the scene did not move on (${b.s.frames} -> ${c.s.frames} frames, ${b.s.last.e.toFixed(2)} -> ${c.s.last.e.toFixed(2)} s)`);
  inStep(h, c, `${kind} resumed`);
  await page.getByRole('button', { name: 'Leave this skill' }).click();
  await page.locator('.dq-timer-stage').waitFor({ state: 'detached', timeout: 5000 });
  const out = await scenes(page);
  h.expect(out.live === 0 && !(await page.locator('.dq-scene').count()), `${kind} left: ${JSON.stringify(out)}`);
  h.expect(out.left && !out.left.geometries && !out.left.textures && !out.left.programs, `${kind} left things on the GPU: ${JSON.stringify(out.left)}`);
}

/** The average hue (degrees) of the lit middle of the scene window, with the countdown hidden. */
async function hueOfMiddle(page) {
  await page.addStyleTag({ content: '.dq-timer-center{visibility:hidden!important}' });
  const { data, info } = await sharp(await page.locator('.dq-scene').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('dq-timer-center{visibility') && s.remove()));
  const { width: w, height: ht, channels: c } = info;
  let r = 0, g = 0, b = 0;
  for (let y = Math.floor(ht * 0.4); y < ht * 0.6; y++) {
    for (let x = Math.floor(w * 0.4); x < w * 0.6; x++) {
      const i = (y * w + x) * c;
      r += data[i], g += data[i + 1], b += data[i + 2];
    }
  }
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min || 1;
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (hue * 60 + 360) % 360;
}
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const hueOf = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min || 1;
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (hue * 60 + 360) % 360;
};

/** relative luminance (WCAG) of an sRGB pixel */
const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const raw = (png) => sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });

/** The countdown's contrast (WCAG) with the lightest of what is behind it: the 98th percentile, its figures hidden. */
async function countdownContrast(page) {
  const num = page.locator('.dq-timer-num');
  const [box, color] = [await num.boundingBox(), await num.evaluate((e) => getComputedStyle(e).color)];
  await num.evaluate((e) => (e.style.visibility = 'hidden'));
  const { data, info } = await raw(await page.screenshot({ clip: box }));
  await num.evaluate((e) => (e.style.visibility = ''));
  const ls = [];
  for (let i = 0; i < data.length; i += info.channels) ls.push(lum(data[i], data[i + 1], data[i + 2]));
  ls.sort((a, b) => a - b);
  const bg = ls[Math.floor(ls.length * 0.98)];
  const text = lum(...color.match(/\d+/g).map(Number));
  return (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05);
}

/** Shoots the scene window with the countdown hidden. */
async function sceneShot(page) {
  await page.addStyleTag({ content: '.dq-timer-center{visibility:hidden!important}' });
  const png = await page.locator('.dq-scene').screenshot();
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('dq-timer-center{visibility') && s.remove()));
  return raw(png);
}

/**
 * The breathing light as shown (0-255 luma): its middle, and the mean round circles at a share of the countdown ring's
 * radius (the ring's track is r 78 of the 200 wide picture; the scene window is the picture less 13% each side).
 */
function lightOf({ data, info }) {
  const { width: w, height: ht, channels: c } = info;
  const R = (0.39 / 0.74) * w;
  const at = (x, y) => luma(data, (Math.round(y) * w + Math.round(x)) * c);
  const circle = (k) => {
    let n = 0, sum = 0;
    for (let a = 0; a < 360; a += 2) (n++, (sum += at(w / 2 + Math.cos((a * Math.PI) / 180) * R * k, ht / 2 + Math.sin((a * Math.PI) / 180) * R * k)));
    return sum / n;
  };
  let mid = 0;
  for (let y = ht / 2 - 3; y <= ht / 2 + 3; y++) for (let x = w / 2 - 3; x <= w / 2 + 3; x++) mid = Math.max(mid, at(x, y));
  return { mid: Math.round(mid), half: Math.round(circle(0.5)), out: Math.round(circle(0.6)) };
}

/**
 * The wave's moon as shown: the brightest thing in the sky (the top third of the window) and everything joined to it within 85%
 * of its brightness (the disc), where it sits (shares of the window), how round it shows, and the light round it: the
 * mean just outside the disc (1.5 radii) against the sky further out (5 radii, above it), inside the window's soft edge.
 */
function moonOf({ data, info }) {
  const { width: W, height: H, channels: c } = info;
  const L = (x, y) => luma(data, (y * W + x) * c);
  let max = 0, mx = 0, my = 0;
  for (let y = 0; y < H * 0.32; y++) for (let x = 0; x < W; x++) if (L(x, y) > max) (max = L(x, y)), (mx = x), (my = y);
  const seen = new Uint8Array(W * H);
  const todo = [[mx, my]];
  let [x0, x1, y0, y1] = [mx, mx, my, my];
  while (todo.length) {
    const [x, y] = todo.pop();
    if (x < 0 || y < 0 || x >= W || y >= H || seen[y * W + x] || L(x, y) < max * 0.85) continue;
    seen[y * W + x] = 1;
    (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
    todo.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const [w, ht] = [x1 - x0 + 1, y1 - y0 + 1];
  const [cx, cy, r] = [(x0 + x1) / 2, (y0 + y1) / 2, (w + ht) / 4];
  const ring = (k, above) => {
    let n = 0, sum = 0;
    for (let a = 0; a < 360; a += 3) {
      const x = Math.round(cx + Math.cos((a * Math.PI) / 180) * r * k), y = Math.round(cy - Math.sin((a * Math.PI) / 180) * r * k);
      if ((above && y > cy) || x < W * 0.13 || x > W * 0.87 || y < H * 0.09 || y >= H) continue;
      (n++, (sum += L(x, y)));
    }
    return n ? sum / n : 0;
  };
  return { max: Math.round(max), box: [x0 / W, y0 / H, (x1 + 1) / W, (y1 + 1) / H].map((v) => +v.toFixed(3)), round: +(Math.min(w, ht) / Math.max(w, ht)).toFixed(2), glow: Math.round(ring(1.5) - ring(5, true)) };
}

/** the new scenes, the step each lives on, and how its flat picture moves without WebGL */
const KINDS = [
  { kind: 'wave', id: 'urge-surf', entry: 'ride', flat: '.dq-timer-svg--wave .dq-scene-flat path' },
  { kind: 'ring', id: 'sense-up', entry: 'only-this', flat: null },
  { kind: 'tide', id: 'current-emotion', entry: 'watch', flat: '.dq-timer-svg--tide .dq-scene-flat path' },
];

export const scenarios = {
  /** the stone step is a live, drawn 3D scene at phone, sideways and desktop sizes, with the flat picture hidden */
  async 'scene-live'(h) {
    for (const [tag, vp] of [['phone', PHONE], ['side', SIDE], ['desk', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toStone(h, page);
      await live(h, page, tag);
      await moreTime(page);
      await until(page, () => window.__scenes.frames > 10 && window.__scenes.last.e > 0.5);
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
    await h.pauseClock(page);
    await h.sleep(1500);
    const b = await pair(page);
    const c = await comesBack(page, b);
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
  /** the wave: the board rides the swell, low at first, high on the first crest, low again after, always on the water */
  async 'wave-scene'(h) {
    for (const [tag, vp] of VIEWS) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      // the clock waits on the ride's first moment, however slowly the page got there, so its start can be seen
      await toStep(h, page, 'urge-surf', 'ride', { pause: true });
      await showsStopped(h, page, `wave ${tag}`);
      const first = (await scenes(page)).last;
      await looks(h, page, tag, 'wave', vp, undefined, { stopped: true });
      const seen = [first, await after(h, page, 0)];
      while (seen[seen.length - 1].probe.t < 34) seen.push(await after(h, page, 2500));
      const at = (a, b) => seen.filter((x) => x.probe.t >= a && x.probe.t <= b).map((x) => x.probe.board);
      const [start, crest, past] = [at(0, 4), at(12, 18), at(26, 34)];
      const ride = seen.map((x) => `${x.probe.t.toFixed(1)}s ${x.probe.board.toFixed(2)}`).join(', ');
      h.expect(start.length && Math.max(...start) < 0.15, `wave ${tag}: the board is not low at the start: ${ride}`);
      h.expect(crest.length && Math.max(...crest) > 0.3, `wave ${tag}: the board never rose on the first crest: ${ride}`);
      h.expect(past.length && Math.min(...past) < 0.15, `wave ${tag}: the board did not come back down after the crest: ${ride}`);
      const off = seen.filter((x) => Math.abs(x.probe.gap - 0.012) > 0.002);
      h.expect(!off.length, `wave ${tag}: the board left the surface at ${off.map((x) => x.probe.t.toFixed(1))}`);
      console.log(`  wave ${tag}: board ${ride}`);
      if (tag === 'phone') await keepsTime(h, page, 'wave');
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** the breathing light: bigger at 4 s than at the start, back down by 10 s, at every size */
  async 'ring-scene'(h) {
    for (const [tag, vp] of VIEWS) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      // the clock stays stopped while the breath is read, so the 30 s timer still runs when the pause is checked
      await toStep(h, page, 'sense-up', 'only-this', { pause: true });
      await showsStopped(h, page, `ring ${tag}`);
      await looks(h, page, tag, 'ring', vp, undefined, { stopped: true });
      // one breath: in for 4 s, out for 6; the countdown keeps going round it
      const a = await after(h, page, 0);
      // start from the beginning of a breath: the next one, if this one is already well under way
      const first = a.e % 10 < 1.2 ? a : await after(h, page, (10 - (a.e % 10)) * 1000 + 300);
      const top = await after(h, page, (4 - (first.e % 10)) * 1000);
      const low = await after(h, page, (9.95 - (top.e % 10)) * 1000);
      h.expect(top.probe.scale > first.probe.scale + 0.05, `ring ${tag}: the light did not swell by 4 s (${first.e.toFixed(1)} s ${first.probe.scale.toFixed(3)}, ${top.e.toFixed(1)} s ${top.probe.scale.toFixed(3)})`);
      h.expect(low.probe.scale < top.probe.scale - 0.12 && low.probe.scale < 0.56, `ring ${tag}: the light did not ease back down by 10 s (${low.e.toFixed(1)} s ${low.probe.scale.toFixed(3)})`);
      h.expect((await page.locator('.dq-timer-num').isVisible()) && (await page.locator('.dq-timer-svg--ring .dq-timer-arc').count()) === 1, `ring ${tag}: the countdown is not showing round the light`);
      if (tag === 'phone') await keepsTime(h, page, 'ring');
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** the breathing light takes the player's accent colour, and so does the countdown round it */
  async 'ring-accent'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    for (const [accent, hex] of [['blue', '#4fb8ff'], ['rose', '#f58fb0'], ['green', '#6fd39a']]) {
      await home(h, page);
      await page.evaluate((acc) => {
        const st = window.__daily.store;
        st.state.settings.accent = acc;
        st.touch('accent');
        st.save();
      }, accent);
      h.expect((await page.evaluate(() => document.documentElement.dataset.dqAccent)) === accent, `the ${accent} accent was not applied`);
      await toStep(h, page, 'sense-up', 'only-this');
      await live(h, page, `ring ${accent}`);
      await h.sleep(4300);
      const hue = await hueOfMiddle(page);
      h.expect(hueGap(hue, hueOf(hex)) < 30, `${accent}: the light's middle is hue ${hue.toFixed(0)}, not the accent's ${hueOf(hex).toFixed(0)}`);
      const arc = await page.$eval('.dq-timer-svg--ring .dq-timer-arc', (p) => getComputedStyle(p).stroke);
      const want = `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      h.expect(arc === want, `${accent}: the countdown round the light is ${arc}, not ${want}`);
      await h.shot(page, `ring-accent-${accent}`);
      console.log(`  ${accent}: middle hue ${hue.toFixed(0)} (accent ${hueOf(hex).toFixed(0)}), countdown ${arc}`);
      await page.getByRole('button', { name: 'Leave this skill' }).click();
    }
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * the breathing light is a small hot core in a soft halo that is gone by about half the countdown ring, and the
   * countdown reads against what is behind it (3:1 or more) all through the breath, at every size
   */
  async 'ring-countdown'(h) {
    // every size is looked at before failing, so a failure lists each size it fails at
    const bad = [];
    for (const [tag, vp] of [...VIEWS, ['wide', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      await toStep(h, page, 'sense-up', 'only-this', { pause: true });
      await showsStopped(h, page, `ring ${tag}`);
      await drawn(h, page, `ring ${tag}`);
      const a = await after(h, page, 0);
      let at = a.e % 10 < 0.5 ? a : await after(h, page, (10 - (a.e % 10)) * 1000 + 100);
      const start = at.e;
      const seen = [];
      let light;
      for (const p of [0, 1, 2, 3, 4, 5.5, 7, 9]) {
        at = await after(h, page, (start + p - at.e) * 1000);
        seen.push({ p, ratio: await countdownContrast(page) });
        if (p === 4) {
          light = lightOf(await sceneShot(page));
          await h.shot(page, `ring-countdown-${tag}`);
        }
      }
      const list = seen.map((x) => `${x.p}s ${x.ratio.toFixed(2)}:1`).join(', ');
      console.log(`  ring ${tag}: countdown ${list}; light at the top of the breath ${JSON.stringify(light)}`);
      if (!seen.every((x) => x.ratio >= 3)) bad.push(`ring ${tag}: the countdown is under 3:1 against the light: ${list}`);
      if (light.mid < 215) bad.push(`ring ${tag}: the light's core is not hot at the top of the breath (${JSON.stringify(light)})`);
      if (light.out > 30 || light.half > 60) bad.push(`ring ${tag}: the light spreads past half the ring at the top of the breath (${JSON.stringify(light)})`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    h.expect(!bad.length, bad.join('\n'));
  },

  /** the wave's moon is a light (a bright disc in a core of light and a halo) and shows whole at every size, rest to crest */
  async 'wave-moon'(h) {
    const bad = [];
    for (const [tag, vp] of [...VIEWS, ['wide', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      await toStep(h, page, 'urge-surf', 'ride', { pause: true });
      await showsStopped(h, page, `wave ${tag}`);
      await drawn(h, page, `wave ${tag}`);
      let at = await after(h, page, 0);
      // calm at the start, then the middle swell's crest, where the camera rises furthest
      for (const t of [1, 45]) {
        if (at.probe.t < t) at = await after(h, page, (t - at.probe.t) * 1000);
        const m = moonOf(await sceneShot(page));
        const where = `wave ${tag} at ${at.probe.t.toFixed(1)} s: ${JSON.stringify(m)}`;
        if (m.max < 205) bad.push(`${where}: the moon is not bright`);
        if (m.box[0] < 0.13 || m.box[2] > 0.87 || m.box[1] < 0.09 || m.box[3] > 0.5) bad.push(`${where}: the moon is cut off or under the window's soft edge`);
        if (m.round < 0.85) bad.push(`${where}: the moon does not show whole`);
        if (m.glow < 60) bad.push(`${where}: the moon has no light round it`);
        if (t === 45) await h.shot(page, `wave-moon-${tag}`);
        console.log(`  ${where}`);
      }
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    h.expect(!bad.length, bad.join('\n'));
  },

  /** Give me a moment breathes with the same 3D light, keeps its lines, and lets it go on Done */
  async 'moment-scene'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await home(h, page);
    await page.evaluate(() => window.__daily.go({ name: 'moment' }));
    await live(h, page, 'moment', '.dq-mo-stage');
    await page.waitForFunction(() => { const l = document.querySelector('.dq-mo-line'); return l && l.textContent.trim() && Number(getComputedStyle(l).opacity) > 0.5; }, null, { timeout: 6000 });
    await h.sleep(800);
    await looks(h, page, 'moment', 'ring', PHONE, '.dq-mo-stage');
    const ticks = await page.$$eval('.dq-mo-svg path', (ps) => ps.filter((p) => getComputedStyle(p).visibility !== 'hidden' && Number(getComputedStyle(p).opacity) > 0.5).length);
    h.expect(ticks >= 1, 'moment: the ticks round the light are gone');
    await page.locator('.dq-mo-done').click();
    await page.locator('.dq-mo-stage').waitFor({ state: 'detached', timeout: 5000 });
    const out = await scenes(page);
    h.expect(out.live === 0 && out.left && !out.left.geometries && !out.left.textures, `moment: leaving did not free the scene: ${JSON.stringify(out)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** Motion changed while Give me a moment is open: Reduced stills its light, Full moves it again */
  async 'moment-motion'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await home(h, page);
    await page.evaluate(() => window.__daily.go({ name: 'moment' }));
    await live(h, page, 'moment motion', '.dq-mo-stage');
    // set the way the Settings screen of this copy or another open one does
    const here = (m) =>
      page.evaluate((v) => {
        const app = window.__daily;
        app.store.state.settings.motion = v;
        app.store.touch('motion');
        app.store.save();
        app.applyMotion();
      }, m);
    await here('reduce');
    await h.sleep(600);
    const a = await scenes(page);
    await h.sleep(1000);
    const b = await scenes(page);
    h.expect(a.last.still && b.frames === a.frames, `moment, Reduced: the light did not settle on one still frame (${a.frames} -> ${b.frames}, still ${a.last.still})`);
    await here('full');
    await h.sleep(1500);
    const c = await scenes(page);
    h.expect(c.frames > b.frames + 10 && !c.last.still, `moment, Full: the light stayed still (${b.frames} -> ${c.frames} frames, still ${c.last.still})`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a timed Give me a moment ends with its light settled to a slow exhale and holding still, as its flat ring does */
  async 'moment-end-light'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await page.clock.install();
    await home(h, page);
    await page.evaluate(() => window.__daily.go({ name: 'moment' }));
    await live(h, page, 'moment end', '.dq-mo-stage');
    await h.pauseClock(page);
    await page.getByRole('radiogroup', { name: 'How long' }).getByRole('radio', { name: '1 minute' }).check();
    await page.clock.runFor(2000);
    const on = await scenes(page);
    h.expect(on.last.probe.breath > 0.05, `moment end: the light was not breathing before the end (${JSON.stringify(on.last)})`);
    await page.clock.fastForward(60000);
    await page.locator('.dq-mo-line', { hasText: /your moment/ }).waitFor({ timeout: 5000 });
    // the flat ring settles over 2.4 s; a slow page can skip from part way through that straight past its end
    await page.clock.runFor(300);
    await page.clock.fastForward(2300);
    await page.clock.runFor(500);
    const a = await scenes(page);
    await page.clock.runFor(2000);
    const b = await scenes(page);
    h.expect(a.last.done && a.last.probe.breath < 0.01, `moment end: the light did not settle to its exhale (${JSON.stringify(a.last)})`);
    h.expect(b.frames === a.frames, `moment end: the light kept drawing after it settled (${a.frames} -> ${b.frames} frames)`);
    await page.clock.resume();
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** the tide: the water's edge comes in and goes back out at least once in 20 s, at every size */
  async 'tide-scene'(h) {
    for (const [tag, vp] of VIEWS) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      await toStep(h, page, 'current-emotion', 'watch', { pause: true });
      await showsStopped(h, page, `tide ${tag}`);
      await looks(h, page, tag, 'tide', vp, undefined, { stopped: true });
      // two seconds at a time: a jump that long reads as a pause, not as a slow device
      const edge = [(await after(h, page, 0)).probe.shore];
      for (let i = 0; i < 10; i++) edge.push((await after(h, page, 2000)).probe.shore);
      // some moment where the water had come in from lower and went back out again after
      const inOut = edge.some((x, j) => x - Math.min(...edge.slice(0, j + 1)) > 0.5 && x - Math.min(...edge.slice(j)) > 0.5);
      h.expect(inOut, `tide ${tag}: the water did not come in and go back out in 20 s: ${edge.map((x) => x.toFixed(2))}`);
      console.log(`  tide ${tag}: edge ${edge.map((x) => x.toFixed(1)).join(' ')}`);
      if (tag === 'phone') await keepsTime(h, page, 'tide');
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** with reduced motion the wave, the light, the tide and Give me a moment each draw one still frame */
  async 'water-scenes-still'(h) {
    for (const k of [...KINDS, { kind: 'ring', moment: true }]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload();
      const stage = k.moment ? '.dq-mo-stage' : '.dq-timer-stage';
      if (k.moment) {
        await home(h, page);
        await page.evaluate(() => window.__daily.go({ name: 'moment' }));
      } else await toStep(h, page, k.id, k.entry);
      await live(h, page, `still ${k.kind}`, stage);
      await h.sleep(800);
      const a = await scenes(page);
      await h.sleep(2000);
      const b = await scenes(page);
      const name = k.moment ? 'moment' : k.kind;
      h.expect(a.last.kind === k.kind && a.last.still && b.frames === a.frames && b.frames <= 3, `reduced motion (${name}): not one still frame (${a.frames} -> ${b.frames}, ${JSON.stringify(a.last)})`);
      await drawn(h, page, `still ${name}`);
      await h.shot(page, `still-${name}-phone`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** with no WebGL each step keeps its flat picture, which still moves, and the timer still finishes; the wave's skill counts */
  async 'water-scenes-no-webgl'(h) {
    for (const k of KINDS) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
      await ctx.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest);
        };
      });
      await page.clock.install();
      await page.reload();
      await home(h, page);
      const before = JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}').events.filter((e) => e.k === 'skill' && e.skill === k.id).length;
      await toStep(h, page, k.id, k.entry);
      await h.sleep(1500);
      const s = await scenes(page);
      h.expect(s && s.contexts === 0 && s.live === 0 && !(await page.locator('.dq-scene').count()), `no WebGL (${k.kind}): a scene was left on the page: ${JSON.stringify(s)}`);
      const shown = await flat(page);
      h.expect(shown.length > 0 && shown.every(Boolean), `no WebGL (${k.kind}): the flat picture is hidden`);
      if (k.flat) {
        const d0 = await page.locator(k.flat).first().getAttribute('d');
        await h.sleep(700);
        h.expect(d0 !== (await page.locator(k.flat).first().getAttribute('d')), `no WebGL (${k.kind}): the flat picture does not move`);
      }
      await h.shot(page, `no-webgl-${k.kind}-phone`);
      await page.clock.fastForward(91000);
      await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 5000 });
      if (k.kind === 'wave') {
        await tap(page, 'Next');
        await h.sleep(400);
        await tap(page, 'Skip');
        await h.sleep(400);
        await tap(page, 'Done');
        await page.locator('.dq-feedback').waitFor({ timeout: 5000 });
        await tap(page, 'Yes');
        await page.locator('.dq-after:not(.is-hidden)').waitFor({ timeout: 5000 });
        const now = JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}').events.filter((e) => e.k === 'skill' && e.skill === k.id).length;
        h.expect(now === before + 1, `no WebGL: Wave Rider was not credited once (${before} -> ${now})`);
      }
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },
};
