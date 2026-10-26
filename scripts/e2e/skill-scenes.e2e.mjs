// Wise Mind's stone step shows a calm 3D scene through the companion's shared scene host: live and drawn at phone,
// sideways and desktop sizes; in step with the countdown after the page freezes and through more time; one still frame
// with reduced motion; the flat picture with no WebGL, never hidden again once the device is known to have none, and
// never hidden at all in a browser without WebGL 2; one WebGL context however often it opens; back after a lost context.
// The wave, the breathing light and the tide go through the same host: each is live and drawn at four screen sizes and
// does what its picture promises (the board rides the swell, the light swells with the breath in the player's colour,
// the water comes in and goes out), keeps to its timer's clock, stops on leaving, holds still with reduced motion and
// leaves its flat picture with no WebGL.
import sharp from 'sharp';

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
  // a slow page can pass the moment asked for before the pause lands, so it asks a little ahead and again if it must
  for (let i = 0; pause; i++) {
    try {
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
      break;
    } catch (e) {
      if (i === 4) throw e;
    }
  }
  await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
}

async function live(h, page, where, stage = '.dq-timer-stage') {
  await page.locator(`${stage}.is-scene-live`).waitFor({ timeout: 15000 }).catch(async () => {
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

/** A live scene of this kind, drawn, alone in its window, over its hidden flat picture and inside its stage and the screen. */
async function looks(h, page, tag, kind, vp, stage = '.dq-timer-stage') {
  // it keeps drawing; how fast is checked on the real clock (scene-live, scene-slow-gpu), since these run on a fake one
  const s0 = await scenes(page);
  await h.sleep(1500);
  const s = await scenes(page);
  h.expect(s.live === 1 && s.contexts === 1 && s.frames - s0.frames >= 3, `${kind} ${tag}: ${s.frames - s0.frames} frames in 1.5 s, ${JSON.stringify(s)}`);
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
  if (ms > 0) await page.clock.fastForward(Math.round(ms));
  await h.sleep(160);
  return (await scenes(page)).last;
}

/** The page freezes and comes back: the scene picks up in step with the countdown. Then leaving frees it. */
async function keepsTime(h, page, kind) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  await h.sleep(1200);
  const b = await pair(page);
  await page.clock.resume();
  await h.sleep(1500);
  const c = await pair(page);
  h.expect(c.s.frames > b.s.frames + 10 && c.s.last.e > b.s.last.e + 1, `${kind} resumed: the scene did not move on (${b.s.frames} -> ${c.s.frames} frames)`);
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
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
    await h.sleep(1500);
    const b = await pair(page);
    await page.clock.resume();
    await h.sleep(1500);
    const c = await pair(page);
    h.expect(c.s.frames > b.s.frames + 10 && c.s.last.e > b.s.last.e + 1, `resumed: the scene did not move on (${b.s.frames} -> ${c.s.frames} frames)`);
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

  /** the wave: the board rides the swell, low at first, high on the first crest, low again after, always on the water */
  async 'wave-scene'(h) {
    for (const [tag, vp] of VIEWS) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      // the clock waits on the ride's first moment, however slowly the page got there, so its start can be seen
      await toStep(h, page, 'urge-surf', 'ride', { pause: true });
      await live(h, page, `wave ${tag}`);
      const first = (await scenes(page)).last;
      await page.clock.resume();
      await h.sleep(1200);
      await looks(h, page, tag, 'wave', vp);
      const seen = [first, await after(h, page, 0)];
      while (seen[seen.length - 1].probe.t < 34) seen.push(await after(h, page, 2500));
      const at = (a, b) => seen.filter((x) => x.probe.t >= a && x.probe.t <= b).map((x) => x.probe.board);
      const [start, crest, past] = [at(0, 4), at(12, 18), at(26, 34)];
      h.expect(start.length && Math.max(...start) < 0.15, `wave ${tag}: the board is not low at the start: ${start}`);
      h.expect(crest.length && Math.max(...crest) > 0.3, `wave ${tag}: the board never rose on the first crest: ${crest}`);
      h.expect(past.length && Math.min(...past) < 0.15, `wave ${tag}: the board did not come back down after the crest: ${past}`);
      const off = seen.filter((x) => Math.abs(x.probe.gap - 0.012) > 0.002);
      h.expect(!off.length, `wave ${tag}: the board left the surface at ${off.map((x) => x.probe.t.toFixed(1))}`);
      console.log(`  wave ${tag}: board ${seen.map((x) => `${x.probe.t.toFixed(0)}s ${x.probe.board.toFixed(2)}`).join(', ')}`);
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
      await toStep(h, page, 'sense-up', 'only-this');
      await live(h, page, `ring ${tag}`);
      await h.sleep(1200);
      await looks(h, page, tag, 'ring', vp);
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

  /** the tide: the water's edge comes in and goes back out at least once in 20 s, at every size */
  async 'tide-scene'(h) {
    for (const [tag, vp] of VIEWS) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      await toStep(h, page, 'current-emotion', 'watch');
      await live(h, page, `tide ${tag}`);
      await h.sleep(1200);
      await looks(h, page, tag, 'tide', vp);
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
