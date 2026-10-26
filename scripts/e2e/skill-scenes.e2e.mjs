// Wise Mind's stone step shows a calm 3D scene through the companion's shared scene host: live and drawn at phone,
// sideways and desktop sizes; in step with the countdown after the page freezes and through more time; one still frame
// with reduced motion; the flat picture with no WebGL, never hidden again once the device is known to have none, and
// never hidden at all in a browser without WebGL 2; one WebGL context however often it opens; back after a lost context.
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
      const b = await win.boundingBox({ timeout: 500 }).catch(() => null);
      if (b) await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height - 8, b.height / 2));
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
  await h.sleep(500);
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

async function live(h, page, where) {
  await page.locator('.dq-timer-stage.is-scene-live').waitFor({ timeout: 15000 }).catch(async () => {
    await h.shot(page, `fail-${where}`);
    throw new Error(`${where}: the 3D scene never came on screen`);
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
  for (const t0 = Date.now(); Number(await page.locator('.dq-scene').evaluate((e) => getComputedStyle(e).opacity)) < 0.99 && Date.now() - t0 < 5000; ) await h.sleep(50);
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

export const scenarios = {
  /** the stone step is a live, drawn 3D scene at phone, sideways and desktop sizes, with the flat picture hidden */
  async 'scene-live'(h) {
    for (const [tag, vp] of [['phone', PHONE], ['side', SIDE], ['desk', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toStone(h, page);
      await live(h, page, tag);
      await h.sleep(1500);
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
    await h.sleep(1200);
    inStep(h, await pair(page), 'running');

    // the page freezes (its clock and its frames stop together, as in a background tab), then comes back
    await pauseSoon(page);
    await h.sleep(1500);
    const b = await pair(page);
    await page.clock.resume();
    await h.sleep(1500);
    const c = await pair(page);
    h.expect(c.s.frames > b.s.frames + 10 && c.s.last.e > b.s.last.e + 1, `resumed: the scene did not move on (${b.s.frames} -> ${c.s.frames} frames, ${b.s.last.e.toFixed(2)} -> ${c.s.last.e.toFixed(2)} s)`);
    inStep(h, c, 'resumed');

    await page.locator('.dq-timer').getByRole('button', { name: '+15 s' }).click();
    await h.sleep(400);
    const d = await pair(page);
    h.expect(d.s.last.dur === 35, `more time mid-way: the scene still thinks the timer is ${d.s.last.dur} s`);
    inStep(h, d, 'more time mid-way');

    await page.clock.fastForward(40000);
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
    await h.sleep(1200);
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

  /**
   * a GPU that copes with a small canvas but not a big one (here a draw costs 1 ms for every 1000 pixels over 60000):
   * the scene draws fewer pixels straight away and keeps moving smoothly instead of a frame every half second
   */
  async 'scene-slow-gpu'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', DESK);
    await ctx.addInitScript(() => {
      const P = WebGL2RenderingContext.prototype;
      for (const name of ['drawArrays', 'drawElements']) {
        const draw = P[name];
        P[name] = function (...args) {
          const r = draw.apply(this, args);
          // only the scene's own canvas is slow; the rest of the page draws as usual
          if (!this.canvas.closest?.('.dq-scene')) return r;
          const until = performance.now() + Math.max(0, this.drawingBufferWidth * this.drawingBufferHeight - 60000) / 1000;
          while (performance.now() < until);
          return r;
        };
      }
    });
    await page.reload();
    await toStone(h, page);
    await live(h, page, 'slow');
    await h.sleep(4000);
    const a = await scenes(page);
    await h.sleep(2000);
    const b = await scenes(page);
    const full = await page.evaluate(() => Math.min(window.devicePixelRatio, 2));
    h.expect(b.frames - a.frames >= 20, `slow GPU: only ${b.frames - a.frames} frames in 2 s at pixel ratio ${b.dpr}`);
    h.expect(b.dpr < full, `slow GPU: the scene still draws at the full pixel ratio ${b.dpr}`);
    inStep(h, await pair(page), 'slow');
    await drawn(h, page, 'slow');
    await h.shot(page, 'slow-gpu-desk');
    console.log(`  slow GPU: pixel ratio ${b.dpr}, ${b.frames - a.frames} frames in 2 s`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
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
      await h.sleep(300);
      await tap(page, 'Start 30 s');
      await h.sleep(900);
      const box = await page.locator('.dq-timer-stage').boundingBox();
      h.expect(box.y >= -1 && box.y + box.height <= vp.height + 1, `${vp.width}x${vp.height}: 900 ms after Start the scene is still off screen (${Math.round(box.y)}..${Math.round(box.y + box.height)})`);
      await h.sleep(1500);
      const waits = await page.evaluate(() => window.__gpuWaits);
      h.expect(waits === 0 && (await scenes(page)).frames > 3, `${vp.width}x${vp.height}: the scene made the page wait for the GPU ${waits} times`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /**
   * one slow frame (here the first frame's fence says the GPU took 600 ms) lowers this scene only and for now: once its
   * frames keep up it is back at the full pixel ratio, nothing is kept for the visit, and no change of ratio ever shows
   * a blank frame. The page clock drives the frames, so this reads the same on any renderer.
   */
  async 'scene-one-slow-frame'(h) {
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
    h.expect(low.dpr < full, `the slow first frame did not lower the scene (${low.dpr})`);
    await page.clock.runFor(6000);
    const back = await scenes(page);
    const blank = await page.evaluate(() => window.__blank);
    h.expect(blank === 0, `a change of pixel ratio showed ${blank} blank frames`);
    h.expect(back.dpr === full && !back.kept, `one slow frame left the scene at ${back.dpr} (kept for the visit: ${back.kept}), not back at ${full}`);
    console.log(`  one slow frame: ${low.dpr} for now, back to ${back.dpr}, kept ${back.kept ?? 'nothing'}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
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
    await h.sleep(1200);
    const c = await scenes(page);
    h.expect(c.live === 1 && c.contexts === 1 && c.frames > b.frames + 10, `restored: ${JSON.stringify(c)}`);
    inStep(h, await pair(page), 'restored');
    await drawn(h, page, 'restored');
    await h.shot(page, 'restored-phone');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
