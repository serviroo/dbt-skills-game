// The bowl of cool water beside TIPP's cool air or cold water, through the companion's shared scene host. At phone,
// small phone, sideways and desktop sizes the scene is live and drawn over its hidden flat picture before anything is
// picked, the moon round and bright on the water, with the caution, both choices and the 30 s (no "+15 s") exactly as
// they were and the caution whole on screen, clear of the scene, before and while the countdown runs; then a breath of
// air ruffles the water within 10 s and the mist lifts and fades; on a phone it keeps the countdown's time through a
// freeze and frees everything on leaving. Cool Air's own 30 s shows it too. At 390, 320 and 844x390: reduced motion (the
// device's, or Motion set in another open copy mid-scene) holds one still frame with the moon on the water and Full
// moves it again in step; a lost context hands back to the flat bowl and a restored one picks up in
// step; a slow GPU gets fewer pixels and keeps moving. With no WebGL the flat bowl shows and moves and TIPP still counts,
// and the Safe Zone's cool choice never has a 3D scene.
import sharp from 'sharp';
import { screenshot } from './harness.mjs';
import { after, DESK, drawn, flat, inStep, keepsTime, live, looks, losesContext, moonOf, openStopped, pair, PHONE, sceneShot, scenes, seed, showsStopped, SIDE, slowGpu, toSkill, until } from './skill-scenes.e2e.mjs';

const SMALL = { width: 320, height: 568 };
/** the sizes reduced motion, a lost context and a slow GPU are checked at */
const SIZES = [['phone', PHONE], ['small', SMALL], ['side', SIDE]];

/** Home, then TIPP's cool air or cold water; the scene starts as the step shows, before anything is picked. */
async function toCool(h, page) {
  await toSkill(h, page, 'tipp', 'cold');
  await page.locator('.dq-cool-pick').waitFor({ timeout: 10000 });
}
const pick = (page, label) => page.locator('.dq-cool-pick').getByRole('button', { name: label, exact: true }).click();

/** The cool choice as the player sees it: the caution's words and place, the two choices, the countdown and any more time. */
const cool = (page) =>
  page.evaluate(async () => {
    const { COOL } = await import('/src/content/dbt.ts');
    const care = document.querySelector('.dq-cool-care');
    const r = care.getBoundingClientRect();
    const top = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const win = document.querySelector('.dq-scene')?.getBoundingClientRect();
    const corners = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
    return {
      words: care.textContent.trim() === COOL.caution,
      whole: r.top >= top - 0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5,
      // nothing drawn over it anywhere, the scene included
      clear: corners.every(([x, y]) => care.contains(document.elementFromPoint(x, y))),
      apart: !!win && (win.top >= r.bottom || win.bottom <= r.top),
      choices: [...document.querySelectorAll('.dq-cool-pick button')].map((b) => b.textContent.trim()).join('|') === [COOL.air, COOL.water].join('|'),
      count: document.querySelector('.dq-cool .dq-timer-num')?.textContent.trim(),
      more: [...document.querySelectorAll('.dq-skill button')].filter((b) => /^\+\d+ s$/.test(b.textContent.trim())).length,
    };
  });

/**
 * How rippled the water looks in each of eight patches across the middle of the scene window: the mean brightness step
 * from each pixel to the next, across and down. Calm water is smooth; ripples are fine light and dark lines.
 */
async function rippled(page) {
  const { data, info } = await sharp(await screenshot(page.locator('.dq-scene'))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: ht, channels: c } = info;
  const luma = (x, y) => {
    const i = (y * w + x) * c;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const patches = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0, n = 0;
      for (let y = Math.floor(ht * (0.35 + row * 0.12)); y < ht * (0.47 + row * 0.12); y++) {
        for (let x = Math.floor(w * (0.25 + col * 0.125)); x < w * (0.375 + col * 0.125); x++) {
          sum += Math.abs(luma(x + 1, y) - luma(x, y)) + Math.abs(luma(x, y + 1) - luma(x, y));
          n++;
        }
      }
      patches.push(sum / n);
    }
  }
  return patches;
}

/**
 * The moon's reflection on the water, in the middle of the window: a bright round disc with light round it, wherever the
 * scene is drawn calm (before the countdown starts, or held still).
 */
async function moonShows(h, page, where) {
  await drawn(h, page, where);
  const m = moonOf(await sceneShot(page), [0.25, 0.65]);
  const said = `${where}: ${JSON.stringify(m)}`;
  h.expect(m.max >= 220 && m.round >= 0.75 && m.glow >= 40, `${said}: no moon on the water`);
  h.expect(m.box[0] > 0.3 && m.box[2] < 0.7 && m.box[1] > 0.3 && m.box[3] < 0.6, `${said}: the moon is not out on the water, clear of its edge`);
  console.log(`  moon ${said}`);
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
  /**
   * the scene at four sizes: live before a choice with the moon on the water, the caution, both choices and the 30 s as
   * they were and the caution whole and clear of it, which it stays once the countdown runs; then a breath of air within
   * 10 s that changes the water, and a mist that lifts and fades
   */
  async 'cool-water-scene'(h) {
    for (const [tag, vp] of [...SIZES, ['desk', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await page.clock.install();
      await page.reload();
      await toCool(h, page);
      await live(h, page, `cool ${tag}`);
      await moonShows(h, page, `cool ${tag}`);
      const before = await cool(page);
      h.expect(before.words && before.choices && before.count === '30' && !before.more, `cool ${tag}: the choice changed with the scene up: ${JSON.stringify(before)}`);
      h.expect(before.whole && before.clear && before.apart, `cool ${tag}: the caution is not whole on screen and clear of the scene: ${JSON.stringify(before)}`);
      await h.shot(page, `cool-${tag}`);

      await h.pauseClock(page);
      await pick(page, 'Cool air');
      await showsStopped(h, page, `cool ${tag}`);
      await looks(h, page, tag, 'cold', vp, undefined, { stopped: true });
      const started = await cool(page);
      h.expect(started.words && started.apart && !started.more, `cool ${tag}, counting down: ${JSON.stringify(started)}`);
      h.expect(started.whole && started.clear, `cool ${tag}, counting down: the caution went off screen or under something: ${JSON.stringify(started)}`);
      // two seconds at a time: a jump that long reads as a pause, not as a slow device
      const calm = await rippled(page);
      const seen = [await after(h, page, 0)];
      // how much more rippled than calm the water looks where the breath of air is, at its most within the first 10 s
      let ruffled = 0;
      while (seen[seen.length - 1].e < 14) {
        const at = await after(h, page, 2000);
        seen.push(at);
        if (at.e <= 10) ruffled = Math.max(ruffled, ...(await rippled(page)).map((v, i) => v / Math.max(calm[i], 0.5)));
      }
      const says = seen.map((s) => `${s.e.toFixed(0)}s breeze ${s.probe.breeze.toFixed(2)} mist ${s.probe.mist.toFixed(2)}`).join(', ');
      h.expect(seen.some((s) => s.e <= 10 && s.probe.breeze > 0.5), `cool ${tag}: no breath of air crossed the water in 10 s: ${says}`);
      h.expect(ruffled > 1.5, `cool ${tag}: no patch of water looks rippled under the breath of air (at most ${ruffled.toFixed(2)} times as rippled as calm): ${says}`);
      const mist = seen.map((s) => s.probe.mist);
      const top = mist.indexOf(Math.max(...mist));
      h.expect(mist[top] > 0.6 && mist.slice(top).some((m) => m < 0.3), `cool ${tag}: the mist did not lift and fade: ${says}`);
      await h.shot(page, `cool-${tag}-breeze`);
      console.log(`  cool ${tag}: up to ${ruffled.toFixed(2)} times as rippled in the breeze; ${says}`);
      if (tag === 'phone') await keepsTime(h, page, 'cold');
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** Cool Air's optional 30 s shows the bowl too: still before Start, moving once it runs, with its own +15 s as before */
  async 'cool-air-scene'(h) {
    for (const [tag, vp] of [['phone', PHONE], ['small', SMALL]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toSkill(h, page, 'cool-air');
      await page.locator('.dq-skill').getByRole('button', { name: 'Open a window', exact: true }).click();
      await page.locator('.dq-timer-stage').waitFor({ timeout: 10000 });
      await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
      await live(h, page, `cool air ${tag}`);
      await page.locator('.dq-skill').getByRole('button', { name: 'Start 30 s', exact: true }).click();
      await looks(h, page, `air-${tag}`, 'cold', vp);
      h.expect((await page.locator('.dq-timer').getByRole('button', { name: '+15 s', exact: true }).count()) === 1, `cool air ${tag}: its +15 s is gone`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /**
   * reduced motion holds one still frame with the moon round on the water and no mist up, from the device's setting or
   * from Motion set in another open copy while the water moves, and the scene follows at once; Full moves it again in
   * step with the countdown
   */
  async 'cool-water-still'(h) {
    for (const [tag, vp] of SIZES) {
      {
        const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await toCool(h, page);
        await live(h, page, `still ${tag}`);
        await pick(page, 'Cold water');
        await h.sleep(800);
        const a = await scenes(page);
        await h.sleep(2000);
        const b = await scenes(page);
        h.expect(a.last.kind === 'cold' && a.last.still && b.frames === a.frames && b.frames <= 3, `reduced motion ${tag}: not one still frame (${a.frames} -> ${b.frames}, ${JSON.stringify(a.last)})`);
        // mist is drawn from noise that differs between GPUs, so none may be up where the moon must show round on all
        h.expect(b.last.probe.mist === 0, `reduced motion ${tag}: mist is up over the water (${b.last.probe.mist})`);
        await moonShows(h, page, `still ${tag}`);
        await h.shot(page, `cool-still-${tag}`);
        h.expect(!errors.length, errors.join('\n'));
        await ctx.close();
      }
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toCool(h, page);
      await live(h, page, `motion ${tag}`);
      await pick(page, 'Cool air');
      const set = await otherCopy(h, ctx, page, errors);
      const moving = async (where) => {
        const from = await scenes(page);
        await until(page, (n) => window.__scenes.frames > n + 10 && !window.__scenes.last.still, from.frames);
        const c = await pair(page);
        h.expect(c.s.frames > from.frames + 10 && !c.s.last.still, `${where}: the water is not moving (${from.frames} -> ${c.s.frames})`);
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

  /** a lost WebGL context hands back to the flat bowl and the scene stops; restored, it draws again in step */
  async 'cool-water-context-loss'(h) {
    for (const [tag, vp] of SIZES) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      // the choice's 30 s outlast the check
      const reach = async (h, page) => {
        await toCool(h, page);
        await pick(page, 'Cool air');
      };
      await openStopped(h, page, reach, `lost ${tag}`);
      await losesContext(h, page, tag, `cool-lost-${tag}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** a GPU too slow for the full size: the scene draws fewer pixels within a few frames and keeps moving smoothly */
  async 'cool-water-slow-gpu'(h) {
    for (const [tag, vp] of SIZES) {
      const reach = async (h, page) => {
        await toCool(h, page);
        await pick(page, 'Cool air');
      };
      // each of its four draws costs about 100 ms at each size's full canvas, and nothing at a fifth of its pixels
      await slowGpu(h, { vp, reach, more: 0, cost: [30000, 1000], tag: `cool-slow-gpu-${tag}` });
    }
  },

  /**
   * with no WebGL the flat bowl shows and its ripples drift, the countdown runs out and TIPP counts; and the Safe Zone's
   * cool choice keeps the flat bowl with no 3D scene, WebGL or not
   */
  async 'cool-water-no-webgl'(h) {
    {
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
      // TIPP counts from its first screen, so its runs are counted before it starts
      const runs = async () => JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}').events.filter((e) => e.k === 'skill' && e.skill === 'tipp').length;
      const before = await runs();
      await toCool(h, page);
      await pick(page, 'Cold water');
      await h.sleep(1500);
      const s = await scenes(page);
      h.expect(s && s.contexts === 0 && s.live === 0 && !(await page.locator('.dq-scene').count()), `no WebGL: a scene was left on the page: ${JSON.stringify(s)}`);
      const shown = await flat(page);
      h.expect(shown.length > 1 && shown.every(Boolean), `no WebGL: the flat bowl is hidden (${JSON.stringify(shown)})`);
      const ripple = page.locator('.dq-timer-svg--cold .dq-scene-flat g path').first();
      const t0 = await ripple.getAttribute('transform');
      await h.sleep(700);
      h.expect(t0 !== (await ripple.getAttribute('transform')), 'no WebGL: the flat bowl\'s ripples do not drift');
      await h.shot(page, 'cool-no-webgl-phone');
      await page.clock.fastForward(31000);
      await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 5000 });
      await page.locator('.dq-skill').getByRole('button', { name: 'Next', exact: true }).click();
      await page.locator('.dq-skill').getByRole('button', { name: 'Lower', exact: true }).click();
      await page.locator('.dq-skill').getByRole('button', { name: 'Done', exact: true }).click();
      await page.locator('.dq-feedback').waitFor({ timeout: 5000 });
      await page.locator('.dq-skill').getByRole('button', { name: 'Yes', exact: true }).click();
      await page.locator('.dq-after:not(.is-hidden)').waitFor({ timeout: 5000 });
      h.expect((await runs()) === before + 1, 'no WebGL: TIPP was not credited once');
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await toSkill(h, page, 'tipp', 'cold');
    await page.locator('header .dq-safe').click();
    await page.evaluate(() => window.__daily.go({ name: 'safe', at: 'cold' }));
    await page.locator('.dq-sz-body .dq-cool-pick').waitFor({ timeout: 10000 });
    await page.locator('.dq-sz-body .dq-cool-pick').getByRole('button', { name: 'Cool air', exact: true }).click();
    await h.sleep(1500);
    const s = await scenes(page);
    h.expect(!s?.live && !(await page.locator('.dq-sz-body .dq-scene, .dq-sz-body .is-scene-wait, .dq-sz-body .is-scene-live').count()), `Safe Zone: a 3D scene came up: ${JSON.stringify(s)}`);
    h.expect((await page.locator('.dq-sz-body .dq-timer-svg--cold .dq-scene-flat').count()) === 1, 'Safe Zone: the flat bowl is missing');
    await h.shot(page, 'cool-safe-zone-phone');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
