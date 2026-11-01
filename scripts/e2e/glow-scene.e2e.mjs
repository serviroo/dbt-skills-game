// The soft glow behind every glow timer, through the companion's shared scene host: the Lantern resting on a stone in
// mist. Every glow step in the game shows it. At phone, small phone, sideways and desktop sizes it is live and drawn over
// its hidden flat picture, its light a soft heart where the probe says it is, in a wide halo that falls off smoothly with
// nothing burnt out, and the countdown above it readable (4.5:1). On phones its brightness swells at most once every 4 s,
// slowly, with no jump; on a phone it keeps the countdown's time through a freeze and frees everything on leaving. The
// line Read it again shows above it stays whole, uncovered and readable at the light's brightest. At 390, 320 and
// 844x390: reduced motion (the device's, or Motion set in another open copy mid-scene) holds one still frame with the
// light on, and Full moves it again in step; a lost context hands back to the flat Lantern and a restored one picks up in
// step; a slow GPU gets fewer pixels and keeps moving. With no WebGL the flat Lantern shows, its light pulses and its
// mist drifts, and the skill still finishes and counts.
import sharp from 'sharp';
import { countdownContrast, DESK, drawn, flat, home, inStep, keepsTime, live, looks, pair, PHONE, sceneShot, scenes, seed, SIDE, slowGpu, toSkill, until } from './skill-scenes.e2e.mjs';
import { screenshot } from './harness.mjs';

const SMALL = { width: 320, height: 568 };
/** the sizes reduced motion, a lost context and a slow GPU are checked at */
const SIZES = [['phone', PHONE], ['small', SMALL], ['side', SIDE]];

/**
 * Home, then a glow timer (Body scan's feet, which runs at once, by default): through the skill's intro and Begin, or
 * straight to it in a skill that opens on its steps.
 */
async function toGlow(h, page, id = 'body-scan', entry = 'feet') {
  const glow = page.locator('.dq-timer-svg--glow');
  const begin = page.locator('.dq-skill').getByRole('button', { name: 'Begin', exact: true }).first();
  // the first-visit welcome opens a moment after Home appears, so a tap it covers goes back Home and tries again
  for (let i = 0; ; i++) {
    if (i) await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await home(h, page);
    await page.evaluate(([id, entry]) => window.__daily.go({ name: 'skill', id, entry }), [id, entry]);
    try {
      await begin.or(glow).first().waitFor({ timeout: 10000 });
      if (!(await glow.count())) await begin.click({ timeout: 10000 });
      await glow.waitFor({ timeout: 10000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
}

/** the encouragement picked for Read it again */
const LINE = 'This feeling will pass.';

/** Home, then IMPROVE the moment's encouragement, a line picked, to Read it again with that line big above the glow. */
async function toReadAgain(h, page) {
  await toSkill(h, page, 'improve', 'enc');
  await page.locator('.dq-skill').getByRole('button', { name: LINE, exact: true }).click();
  await page.locator('.dq-timer-big').waitFor({ timeout: 10000 });
}

const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/**
 * The light as shown in the scene window (0-255 luma), at `at`, the probe's place for it in shares of the window: its
 * heart, the halo either side of it level with it (the mean of a short upright strip each side, at shares of the
 * window's width out from it, clear of the Lantern's glass and inside the window's soft edge), how far from it the
 * brightest pixel is, the share of the window burnt out to white, and the mean of everything within 0.3 of it.
 */
function lightOf({ data, info }, at) {
  const { width: w, height: ht, channels: c } = info;
  const [fx, fy] = [at.x * w, at.y * ht];
  const inside = (x, y) => Math.hypot(x - w / 2, y - ht / 2) <= w * 0.42;
  const L = (x, y) => luma(data, (Math.round(y) * w + Math.round(x)) * c);
  const side = (k) => {
    let n = 0, sum = 0;
    for (const s of [-1, 1]) for (let y = fy - w * 0.02; y <= fy + w * 0.02; y++) if (inside(fx + s * k * w, y)) (n++, (sum += L(fx + s * k * w, y)));
    return Math.round(sum / n);
  };
  let heart = 0, top = 0, tx = 0, ty = 0, clipped = 0, n = 0, halo = 0, hn = 0;
  for (let y = 0; y < ht; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const i = (y * w + x) * c, l = luma(data, i), r = Math.hypot(x - fx, y - fy) / w;
      n++;
      if (data[i] >= 254 && data[i + 1] >= 254 && data[i + 2] >= 254) clipped++;
      if (l > top) (top = l), (tx = x), (ty = y);
      if (r < 0.04) heart = Math.max(heart, l);
      if (r < 0.3) (hn++, (halo += l));
    }
  }
  return { heart: Math.round(heart), rings: [0.14, 0.2, 0.27, 0.35].map(side), off: +(Math.hypot(tx - fx, ty - fy) / w).toFixed(3), burnt: +(clipped / n).toFixed(4), halo: +(halo / hn).toFixed(2) };
}

/** A soft light where the probe puts it: a bright heart, a wide halo falling off smoothly, nothing burnt out. */
function softLight(h, l, where) {
  const said = `${where}: ${JSON.stringify(l)}`;
  h.expect(l.heart >= 200 && l.off <= 0.06, `${said}: the light's heart is not where the scene puts it`);
  h.expect(l.rings.every((v, i) => !i || v < l.rings[i - 1]) && l.rings[0] < l.heart * 0.85, `${said}: the halo does not fall off smoothly from the heart`);
  h.expect(l.rings[2] >= l.rings[3] + 3 && l.rings[3] >= 12, `${said}: no wide halo round the light`);
  h.expect(l.burnt <= 0.002, `${said}: too much of the light is burnt out to white`);
}

/**
 * The light's brightness (its halo's mean) every `step` ms of page time over `ms`, the page clock stopped and run on in
 * steps, so the scene's time is the page's however slowly it draws.
 */
async function swellOver(page, ms, step = 400) {
  const seen = [];
  for (let t = 0; t <= ms; t += step) {
    if (t) await page.clock.runFor(step);
    const s = await scenes(page);
    seen.push({ e: s.last.e, b: lightOf(await sceneShot(page), s.last.probe).halo });
  }
  return seen;
}

/**
 * The swells in `seen`: each top the light rose to by a quarter of the whole range and then fell from by as much (when
 * each one was); the range; and the biggest change from one look to the next.
 */
function swellsIn(seen) {
  const bs = seen.map((s) => s.b);
  const range = Math.max(...bs) - Math.min(...bs);
  const step = range * 0.25;
  const peaks = [];
  let low = seen[0], high = seen[0], rising = false;
  for (const s of seen) {
    if (s.b > high.b) high = s;
    if (s.b < low.b) low = s;
    if (!rising && s.b - low.b >= step) (rising = true), (high = s);
    else if (rising && high.b - s.b >= step) (peaks.push(+high.e.toFixed(1)), (rising = false), (low = s));
  }
  const jump = Math.max(...bs.slice(1).map((b, i) => Math.abs(b - bs[i])));
  return { peaks, range: +range.toFixed(2), jump: +jump.toFixed(2) };
}

/** Motion as another open copy of the game sets it on its own Settings screen, with this copy kept in view. */
async function otherCopy(h, ctx, page, errors) {
  const [other] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(() => void window.open('/?mute'))]);
  other.on('pageerror', (e) => errors.push('pageerror, other copy: ' + e.message));
  await h.openSettings(other);
  await page.bringToFront();
  return (m) => other.getByRole('radio', { name: `Motion: ${m}`, exact: true }).click();
}

export const scenarios = {
  /** every glow timer in the game shows the soft glow */
  async 'glow-every-step'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await h.reachHub(page);
    const steps = await page.evaluate(async () => {
      const { SKILLS } = await import('/src/content/dbt.ts');
      return SKILLS.flatMap((k) => k.steps.filter((s) => s.kind === 'timer' && s.visual === 'glow').map((s) => [k.id, s.id ?? null]));
    });
    h.expect(steps.length >= 10 && steps.every(([, id]) => id), `the glow steps are not all reachable: ${JSON.stringify(steps)}`);
    for (const [id, entry] of steps) {
      await toGlow(h, page, id, entry);
      await live(h, page, `glow ${id} ${entry}`);
      const s = await scenes(page);
      h.expect(s.live === 1 && s.contexts === 1 && s.last.kind === 'glow', `${id} ${entry}: ${JSON.stringify(s)}`);
      await page.getByRole('button', { name: 'Leave this skill' }).click();
      await page.locator('.dq-timer-stage').waitFor({ state: 'detached', timeout: 10000 });
      await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    }
    console.log(`  ${steps.length} glow steps: ${steps.map((s) => s.join(' ')).join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * the scene at four sizes: live and drawn with its flat picture hidden, its light soft and wide round a heart where the
   * scene puts it, the countdown readable; on phones it swells at most once every 4 s with no jump; on a phone it keeps
   * the countdown's time through a freeze and frees everything on leaving
   */
  async 'glow-scene'(h) {
    for (const [tag, vp] of [...SIZES, ['desk', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      await toGlow(h, page);
      await live(h, page, `glow ${tag}`);
      await h.pauseClock(page);
      await looks(h, page, tag, 'glow', vp, undefined, { stopped: true });
      if (tag !== 'side' && tag !== 'desk') {
        // two swells' worth, from wherever the light is now
        const seen = await swellOver(page, 12000);
        const sw = swellsIn(seen);
        const said = `glow ${tag}: ${JSON.stringify(sw)}, ${seen.map((s) => `${s.e.toFixed(1)}s ${s.b}`).join(' ')}`;
        h.expect(sw.peaks.length >= 1, `${said}: the light never swelled`);
        h.expect(sw.peaks.every((e, i) => !i || e - sw.peaks[i - 1] >= 4), `${said}: it swells more than once every 4 s`);
        h.expect(sw.range >= 3 && sw.jump <= sw.range * 0.3, `${said}: the swell is not a slow, visible change`);
        console.log(`  swell ${said}`);
      }
      // at its brightest: half a swell on from its dimmest
      const e = (await scenes(page)).last.e;
      await page.clock.runFor(Math.round(((5 - (e % 10) + 10) % 10) * 1000) + 100);
      const s = await scenes(page);
      const l = lightOf(await sceneShot(page), s.last.probe);
      softLight(h, l, `glow ${tag} at ${s.last.e.toFixed(1)} s`);
      const contrast = await countdownContrast(page);
      h.expect(contrast >= 4.5, `glow ${tag}: the countdown over the light is ${contrast.toFixed(2)}:1`);
      await h.shot(page, `glow-${tag}-bright`);
      console.log(`  glow ${tag} at ${s.last.e.toFixed(1)} s: ${JSON.stringify(l)}, countdown ${contrast.toFixed(1)}:1`);
      if (tag === 'phone') await keepsTime(h, page, 'glow');
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** Read it again: its line above the glow stays whole on screen, uncovered and readable with the light at its brightest */
  async 'glow-read-again'(h) {
    for (const [tag, vp] of SIZES) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      await toReadAgain(h, page);
      await live(h, page, `read again ${tag}`);
      await h.pauseClock(page);
      await drawn(h, page, `read again ${tag}`);
      const e = (await scenes(page)).last.e;
      await page.clock.runFor(Math.round(((5 - (e % 10) + 10) % 10) * 1000) + 100);
      const big = page.locator('.dq-timer-big');
      const seen = await big.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.querySelector('.dq-top').getBoundingClientRect().bottom;
        const win = document.querySelector('.dq-scene').getBoundingClientRect();
        const corners = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
        return {
          words: el.textContent.trim(),
          size: parseFloat(getComputedStyle(el).fontSize),
          whole: r.top >= top - 0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5,
          clear: corners.every(([x, y]) => el.contains(document.elementFromPoint(x, y))),
          apart: win.top >= r.bottom,
          color: getComputedStyle(el).color,
        };
      });
      h.expect(seen.words === LINE && seen.size >= 16, `read again ${tag}: the line is not shown as picked: ${JSON.stringify(seen)}`);
      h.expect(seen.whole && seen.clear && seen.apart, `read again ${tag}: the line is not whole on screen, clear of everything and above the glow: ${JSON.stringify(seen)}`);
      // what is behind its words, the words hidden: the lightest of it (98th percentile) against the words' colour
      const box = await big.boundingBox();
      await big.evaluate((el) => (el.style.visibility = 'hidden'));
      const { data, info } = await sharp(await screenshot(page, { clip: box })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      await big.evaluate((el) => (el.style.visibility = ''));
      const ls = [];
      for (let i = 0; i < data.length; i += info.channels) ls.push(lum(data[i], data[i + 1], data[i + 2]));
      ls.sort((a, b) => a - b);
      const bg = ls[Math.floor(ls.length * 0.98)], text = lum(...seen.color.match(/\d+/g).map(Number));
      const contrast = (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05);
      h.expect(contrast >= 4.5, `read again ${tag}: the line is ${contrast.toFixed(2)}:1 on what is behind it`);
      await h.shot(page, `glow-read-again-${tag}`);
      console.log(`  read again ${tag}: ${contrast.toFixed(1)}:1, ${JSON.stringify(seen)}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /**
   * reduced motion holds one still frame with the light on, from the device's setting or from Motion set in another open
   * copy while it moves, and the scene follows at once; Full moves it again in step with the countdown
   */
  async 'glow-still'(h) {
    for (const [tag, vp] of SIZES) {
      {
        const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await toGlow(h, page);
        await live(h, page, `still ${tag}`);
        await h.sleep(800);
        const a = await scenes(page);
        await h.sleep(2000);
        const b = await scenes(page);
        h.expect(a.last.kind === 'glow' && a.last.still && b.frames === a.frames && b.frames <= 3, `reduced motion ${tag}: not one still frame (${a.frames} -> ${b.frames}, ${JSON.stringify(a.last)})`);
        await drawn(h, page, `still ${tag}`);
        softLight(h, lightOf(await sceneShot(page), b.last.probe), `still ${tag}`);
        await h.shot(page, `glow-still-${tag}`);
        h.expect(!errors.length, errors.join('\n'));
        await ctx.close();
      }
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toGlow(h, page);
      await live(h, page, `motion ${tag}`);
      const set = await otherCopy(h, ctx, page, errors);
      const moving = async (where) => {
        const from = await scenes(page);
        await until(page, (n) => window.__scenes.frames > n + 10 && !window.__scenes.last.still, from.frames);
        const c = await pair(page);
        h.expect(c.s.frames > from.frames + 10 && !c.s.last.still, `${where}: the glow is not moving (${from.frames} -> ${c.s.frames})`);
        inStep(h, c, where);
      };
      await moving(`motion ${tag}, Full`);
      await set('Reduced');
      // with no reload: the other copy's change reaches the scene, which then draws nothing more
      await page.waitForFunction(() => window.__scenes?.last.still, null, { timeout: 15000 });
      const a = await scenes(page);
      await h.frames(page, 60);
      const b = await scenes(page);
      h.expect(a.last.still && b.frames === a.frames, `motion ${tag}, Reduced in another copy: not one still frame (${a.frames} -> ${b.frames})`);
      await set('Full');
      await moving(`motion ${tag}, Full again`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** a lost WebGL context hands back to the flat Lantern and the scene stops; restored, it draws again in step */
  async 'glow-context-loss'(h) {
    for (const [tag, vp] of SIZES) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toGlow(h, page);
      await live(h, page, `lost ${tag}`);
      await page.evaluate(() => {
        window.__lose = document.querySelector('.dq-scene canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
        window.__lose.loseContext();
      });
      await page.locator('.dq-timer-stage:not(.is-scene-live)').waitFor({ timeout: 5000 });
      await h.sleep(800);
      const a = await scenes(page);
      await h.sleep(800);
      const b = await scenes(page);
      h.expect(a.live === 0 && b.frames === a.frames, `lost ${tag}: the scene kept drawing (${a.frames} -> ${b.frames})`);
      const shown = await flat(page);
      h.expect(shown.length > 1 && shown.every(Boolean), `lost ${tag}: the flat Lantern did not come back (${JSON.stringify(shown)})`);
      await h.shot(page, `glow-lost-${tag}`);
      await page.evaluate(() => window.__lose.restoreContext());
      await live(h, page, `restored ${tag}`);
      await until(page, (n) => window.__scenes.frames > n, b.frames + 10);
      const c = await pair(page);
      h.expect(c.s.live === 1 && c.s.contexts === 1 && c.s.frames > b.frames + 10, `restored ${tag}: ${JSON.stringify(c.s)}`);
      inStep(h, c, `restored ${tag}`);
      await drawn(h, page, `restored ${tag}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** a GPU too slow for the full size: the scene draws fewer pixels within a few frames and keeps moving smoothly */
  async 'glow-slow-gpu'(h) {
    // each of its 13 draws costs about 35 ms at a phone's full canvas, so a full frame takes about 450 ms, and nothing at
    // a sixth of its pixels
    for (const [tag, vp] of SIZES) await slowGpu(h, { vp, reach: (h, page) => toGlow(h, page), cost: [30000, 4000], tag: `glow-slow-gpu-${tag}` });
  },

  /** with no WebGL the flat Lantern shows, its light pulses and its mist drifts, and Read it again finishes and counts */
  async 'glow-no-webgl'(h) {
    for (const [tag, vp] of [['phone', PHONE], ['small', SMALL]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await ctx.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest);
        };
      });
      await page.clock.install();
      await page.reload();
      await h.reachHub(page);
      const runs = async () => JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}').events.filter((e) => e.k === 'skill' && e.skill === 'improve').length;
      const before = await runs();
      await toReadAgain(h, page);
      await page.clock.runFor(1500);
      // the flat picture fades back in on the browser's own time
      await h.sleep(800);
      const s = await scenes(page);
      h.expect(s && s.contexts === 0 && s.live === 0 && !(await page.locator('.dq-scene').count()), `no WebGL ${tag}: a scene was left on the page: ${JSON.stringify(s)}`);
      const shown = await flat(page);
      h.expect(shown.length > 1 && shown.every(Boolean), `no WebGL ${tag}: the flat Lantern is hidden (${JSON.stringify(shown)})`);
      const look = () => page.evaluate(() => ({ light: document.querySelector('.dq-timer-svg--glow circle.dq-scene-flat').getAttribute('r'), mist: document.querySelector('.dq-timer-svg--glow g.dq-scene-flat g path').getAttribute('transform') }));
      const a = await look();
      await page.clock.runFor(2000);
      const b = await look();
      h.expect(a.light !== b.light && a.mist !== b.mist, `no WebGL ${tag}: the flat Lantern's light does not pulse or its mist does not drift: ${JSON.stringify([a, b])}`);
      await h.shot(page, `glow-no-webgl-${tag}`);
      if (tag === 'phone') {
        await page.clock.fastForward(21000);
        await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 5000 });
        await page.locator('.dq-skill').getByRole('button', { name: 'Next', exact: true }).click();
        await page.locator('.dq-skill').getByRole('button', { name: 'Done', exact: true }).click();
        await page.locator('.dq-feedback').waitFor({ timeout: 5000 });
        await page.locator('.dq-skill').getByRole('button', { name: 'Yes', exact: true }).click();
        await page.locator('.dq-after:not(.is-hidden)').waitFor({ timeout: 5000 });
        h.expect((await runs()) === before + 1, `no WebGL: IMPROVE the moment was not counted once (${before} -> ${await runs()})`);
      }
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },
};
