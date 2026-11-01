// Willing hands through the companion's shared scene host. At phone, small phone, sideways and desktop sizes Willing
// Hands' hands step shows the scene live and drawn over its hidden flat picture, both hands whole inside the round
// window (every joint inside its clear middle, nothing lit on its fading rim) and the countdown readable (3:1) under
// them; from the start of the countdown to Done the fingers only loosen, never curling back, and end less curled than
// they began. On a phone the scene keeps the countdown's time through a freeze, stays open with more time and frees
// everything on leaving. Radical Acceptance's open hands, Willing Hands' think-of-it and Willingness's open hands show
// it too. At 390, 320 and 844x390: reduced motion (the device's, or Motion set in another open copy mid-scene) holds one
// still frame of open hands and Full moves them again in step; a lost context hands back to the flat drawing and a
// restored one picks up in step; a slow GPU gets fewer pixels and keeps moving. With no WebGL the flat drawing shows and
// Willing Hands still counts.
import { after, countdownContrast, DESK, drawn, flat, inStep, keepsTime, live, looks, pair, PHONE, sceneShot, scenes, seed, showsStopped, SIDE, slowGpu, toSkill, until } from './skill-scenes.e2e.mjs';

const SMALL = { width: 320, height: 568 };
/** the sizes reduced motion, a lost context and a slow GPU are checked at */
const SIZES = [['phone', PHONE], ['small', SMALL], ['side', SIDE]];
/** the share of the window's radius the hands keep within: its mask starts fading them at 84% */
const CLEAR = 0.8;

/** Home, then straight to one of the hands' timer steps, scrolled into view. */
async function toHands(h, page, id = 'willing-hands', entry = 'hands') {
  await toSkill(h, page, id, entry);
  await page.locator('.dq-timer-svg--hands').waitFor({ timeout: 10000 });
  await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
}

/**
 * How bright the window shows where its mask starts fading the scene out (from 84% to 92% of its radius), as the 99th
 * percentile of its brightness with the countdown hidden: about 10 over the dark, and 50 or more once a hand reaches
 * out there and is cut off.
 */
async function rimLight(page) {
  const { data, info } = await sceneShot(page);
  const { width: w, height: ht, channels: c } = info;
  const ls = [];
  for (let y = 0; y < ht; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.hypot((x + 0.5 - w / 2) / (w / 2), (y + 0.5 - ht / 2) / (ht / 2));
      if (r < 0.84 || r > 0.92) continue;
      const i = (y * w + x) * c;
      ls.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    }
  }
  ls.sort((a, b) => a - b);
  return Math.round(ls[Math.floor(ls.length * 0.99)]);
}

/** Both hands whole inside the window as drawn now, and the countdown readable under them. */
async function inFrame(h, page, where) {
  const { probe } = (await scenes(page)).last;
  h.expect(probe.reach <= CLEAR, `${where}: the hands reach ${probe.reach.toFixed(3)} of the window's radius, past ${CLEAR}`);
  const rim = await rimLight(page);
  h.expect(rim <= 30, `${where}: something lit reaches the window's fading rim (brightness ${rim})`);
  const contrast = await countdownContrast(page);
  h.expect(contrast >= 3, `${where}: the countdown has ${contrast.toFixed(2)}:1 against the hands`);
  return `reach ${probe.reach.toFixed(3)}, rim ${rim}, countdown ${contrast.toFixed(1)}:1`;
}

/** Motion as another open copy of the game sets it on its own Settings screen, with this copy kept in view. */
async function otherCopy(h, ctx, page, errors) {
  const [other] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(() => void window.open('/?mute'))]);
  other.on('pageerror', (e) => errors.push('pageerror, other copy: ' + e.message));
  await h.openSettings(other);
  await page.bringToFront();
  return (m) => other.getByRole('radio', { name: `Motion: ${m}`, exact: true }).click();
}

const handsRuns = async (h, page) => JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}').events.filter((e) => e.k === 'skill' && e.skill === 'willing-hands').length;

export const scenarios = {
  /**
   * the hands step at four sizes: live and drawn, the hands whole in the window and the countdown readable from start
   * to Done, the fingers only ever loosening and ending less curled; on a phone, in step through a freeze, still open
   * with more time, and freed on leaving
   */
  async 'hands-scene'(h) {
    for (const [tag, vp] of [...SIZES, ['desk', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      await toSkill(h, page, 'willing-hands', 'hands');
      await page.locator('.dq-timer-svg--hands').waitFor({ timeout: 10000 });
      await h.pauseClock(page);
      await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
      await showsStopped(h, page, `hands ${tag}`);
      await looks(h, page, tag, 'hands', vp, undefined, { stopped: true });
      const seen = [await after(h, page, 0)];
      const said = [`${seen[0].e.toFixed(0)}s ${await inFrame(h, page, `hands ${tag} at the start`)}`];
      // two seconds at a time: a jump that long reads as a pause, not as a slow device
      while (!seen[seen.length - 1].done) {
        const at = await after(h, page, 2000);
        seen.push(at);
        said.push(`${at.e.toFixed(0)}s ${await inFrame(h, page, `hands ${tag} at ${at.e.toFixed(1)} s`)}`);
      }
      const curls = seen.map((s) => +s.probe.curl.toFixed(4));
      h.expect(curls.every((c, i) => !i || c <= curls[i - 1]), `hands ${tag}: the fingers curled back at some point: ${curls.join(', ')}`);
      h.expect(curls[curls.length - 1] < curls[0] - 0.25, `hands ${tag}: the fingers end about as curled as they began: ${curls.join(', ')}`);
      await h.shot(page, `hands-${tag}-done`);
      console.log(`  hands ${tag}: curl ${curls.join(' > ')}; ${said.join('; ')}`);
      if (tag === 'phone') {
        // more time after Done carries on from the open hands: nothing closes again
        await page.clock.resume();
        const done = curls[curls.length - 1];
        const { frames } = await scenes(page);
        await page.locator('.dq-timer').getByRole('button', { name: '+15 s', exact: true }).click();
        await until(page, (n) => window.__scenes.frames > n + 10 && !window.__scenes.last.done, frames);
        const more = await pair(page);
        inStep(h, more, 'hands phone, more time');
        h.expect(more.s.last.probe.curl <= done + 1e-4, `hands phone, more time: the fingers curled again (${done} -> ${more.s.last.probe.curl})`);
        await keepsTime(h, page, 'hands');
      }
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** Radical Acceptance's open hands, and Willing Hands' and Willingness's steps that wait for Start, show the hands too */
  async 'hands-steps'(h) {
    for (const [id, entry, start] of [['radical-acceptance', 'open-hands', null], ['willing-hands', 'think-of-it', 'Start 30 s'], ['willingness', 'hands', 'Start 20 s']]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
      await toHands(h, page, id, entry);
      await live(h, page, `${id} ${entry}`);
      if (start) {
        // before Start, the hands wait at the start of their loosening
        const before = await scenes(page);
        h.expect(before.last.kind === 'hands' && !before.last.done && before.last.e === 0, `${id} ${entry}: before Start the scene is ${JSON.stringify(before.last)}`);
        await page.locator('.dq-timer').getByRole('button', { name: start, exact: true }).click();
      }
      await looks(h, page, `${id}-${entry}`, 'hands', PHONE);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /**
   * reduced motion holds one still frame of the hands open, from the device's setting or from Motion set in another
   * open copy while they move, and the scene follows at once; Full moves them again in step with the countdown
   */
  async 'hands-still'(h) {
    for (const [tag, vp] of SIZES) {
      {
        const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await toHands(h, page);
        await live(h, page, `still ${tag}`);
        await h.sleep(800);
        const a = await scenes(page);
        await h.sleep(2000);
        const b = await scenes(page);
        h.expect(a.last.kind === 'hands' && a.last.still && b.frames === a.frames && b.frames <= 3, `reduced motion ${tag}: not one still frame (${a.frames} -> ${b.frames}, ${JSON.stringify(a.last)})`);
        h.expect(a.last.probe.curl < 0.2, `reduced motion ${tag}: the still hands are not open (curl ${a.last.probe.curl})`);
        await drawn(h, page, `still ${tag}`);
        console.log(`  still ${tag}: ${await inFrame(h, page, `still ${tag}`)}`);
        await h.shot(page, `hands-still-${tag}`);
        h.expect(!errors.length, errors.join('\n'));
        await ctx.close();
      }
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toHands(h, page);
      await live(h, page, `motion ${tag}`);
      const set = await otherCopy(h, ctx, page, errors);
      const moving = async (where) => {
        const from = await scenes(page);
        await until(page, (n) => window.__scenes.frames > n + 10 && !window.__scenes.last.still, from.frames);
        const c = await pair(page);
        h.expect(c.s.frames > from.frames + 10 && !c.s.last.still, `${where}: the hands are not moving (${from.frames} -> ${c.s.frames})`);
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
      // the timer step is 20 s; more time keeps it running for Full to move again
      await page.locator('.dq-timer').getByRole('button', { name: '+15 s', exact: true }).click();
      await set('Full');
      await moving(`motion ${tag}, Full again`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** a lost WebGL context hands back to the flat drawing and the scene stops; restored, it draws again in step */
  async 'hands-context-loss'(h) {
    for (const [tag, vp] of SIZES) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toHands(h, page);
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
      h.expect(shown.length === 2 && shown.every(Boolean), `lost ${tag}: the flat drawing did not come back (${JSON.stringify(shown)})`);
      await h.shot(page, `hands-lost-${tag}`);
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
  async 'hands-slow-gpu'(h) {
    for (const [tag, vp] of SIZES) {
      // each of its five draws costs about 100 ms at each size's full canvas, and nothing at a fifth of its pixels
      await slowGpu(h, { vp, reach: (h, page) => toHands(h, page), more: 2, cost: [30000, 1000], tag: `hands-slow-gpu-${tag}` });
    }
  },

  /** with no WebGL the flat drawing of the hands shows, the countdown runs out and Willing Hands counts */
  async 'hands-no-webgl'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await ctx.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest);
      };
    });
    await page.clock.install();
    await page.reload();
    await h.reachHub(page);
    const before = await handsRuns(h, page);
    await toHands(h, page);
    await h.sleep(1500);
    const s = await scenes(page);
    h.expect(s && s.contexts === 0 && s.live === 0 && !(await page.locator('.dq-scene').count()), `no WebGL: a scene was left on the page: ${JSON.stringify(s)}`);
    const shown = await flat(page);
    h.expect(shown.length === 2 && shown.every(Boolean), `no WebGL: the flat drawing is hidden (${JSON.stringify(shown)})`);
    await h.shot(page, 'hands-no-webgl-phone');
    await page.clock.fastForward(21000);
    await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 5000 });
    const tap = (name) => page.locator('.dq-skill').getByRole('button', { name, exact: true }).first().click();
    await tap('Next');
    await tap('Skip');
    await tap('A little');
    await page.locator('.dq-feedback').waitFor({ timeout: 5000 });
    await tap('Yes');
    await page.locator('.dq-after:not(.is-hidden)').waitFor({ timeout: 5000 });
    h.expect((await handsRuns(h, page)) === before + 1, 'no WebGL: Willing Hands was not credited once');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
