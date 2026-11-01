// Spectator Mode's watch step shows the player's thoughts going by in the picture they chose, through the companion's
// shared scene host: clouds across a moonlit sky, pairs of headlights along a road below a hill, or leaves down a
// stream. For each choice, at phone, small phone, sideways and desktop sizes, the scene is live and drawn over its hidden
// flat picture, reports its picture, and the countdown sits clear below it. On a phone, through the minute, thoughts come
// in from beyond the window, cross it at a steady pace and go out again, never more at once than the pace allows and
// never on top of each other (the clouds dim the moon as they pass it); the scene keeps the countdown's time through a
// freeze and frees everything on leaving. At 390, 320 and 844x390: reduced motion holds one still frame with a thought
// in view, and the device's setting or Motion set in another open copy reaches the scene at once, both ways; a lost
// context hands back to that choice's flat picture and a restored one picks up in step; a slow GPU gets fewer pixels and
// keeps moving. With no WebGL each choice's flat picture shows and moves (and holds still with reduced motion), and the
// skill still finishes and counts once, storing nothing new. The emotion skill's watch step keeps its tide.
import { deviceMotion } from './device-motion.e2e.mjs';
import { DESK, drawn, flat, inStep, keepsTime, live, looks, losesContext, moreTime, openStopped, pair, PHONE, scenes, seed, SIDE, slowGpu, steps, toSkill, until } from './skill-scenes.e2e.mjs';

const SMALL = { width: 320, height: 568 };
/** the sizes reduced motion, a lost context and a slow GPU are checked at */
const SIZES = [['phone', PHONE], ['small', SMALL], ['side', SIDE]];
/** each choice: the button that picks it, what the watch step then says, and how many of its thoughts can be up at once */
const PICS = {
  clouds: { label: 'Clouds crossing the sky', words: /Each thought is a cloud/, most: 3 },
  cars: { label: 'Cars on a quiet road', words: /car going past/, most: 2 },
  leaves: { label: 'Leaves on a stream', words: /sits on a leaf/, most: 3 },
};
const NAMES = Object.keys(PICS);

const tap = (page, name) => page.locator('.dq-skill').getByRole('button', { name, exact: true }).first().click();
/** Home, then Spectator Mode: its picture chosen, through to the watch step's countdown, which starts at once. */
async function toThoughts(h, page, pic) {
  await toSkill(h, page, 'mindful-thoughts');
  await tap(page, PICS[pic].label);
  await tap(page, 'Ready');
  await page.locator('.dq-timer-svg--thoughts').waitFor({ timeout: 10000 });
  await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
}

/** the thoughts in the scene's probe: [n, x, y] for thought n at (x, y) in the frame */
const thoughts = (last) => last.probe.things.split(' ').filter(Boolean).map((t) => t.split(':').map(Number));
/** how far from the middle of the round window a thought is: 1 at its edge */
const out = ([, x, y]) => Math.hypot(x, y);

/** The countdown sits below the scene window, never over it. */
async function countdownClear(h, page, where) {
  const [num, win] = await Promise.all([page.locator('.dq-timer-num').boundingBox(), page.locator('.dq-scene').boundingBox()]);
  h.expect(num && win && num.y >= win.y + win.height - 1, `${where}: the countdown is over the scene (${JSON.stringify({ num, win })})`);
}

/** Motion as another open copy of the game sets it on its own Settings screen, with this copy kept in view. */
async function otherCopy(h, ctx, page, errors) {
  const [other] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(() => void window.open('/?mute'))]);
  other.on('pageerror', (e) => errors.push('pageerror, other copy: ' + e.message));
  await h.openSettings(other);
  await page.bringToFront();
  return (m) => other.getByRole('radio', { name: `Motion: ${m}`, exact: true }).click();
}

/** One still frame: nothing more is drawn, and a thought stands in the window. */
async function holdsStill(h, page, pic, where) {
  await page.waitForFunction(() => window.__scenes?.last.still, null, { timeout: 15000 });
  const a = await scenes(page);
  await h.frames(page, 60);
  const b = await scenes(page);
  h.expect(a.last.kind === 'thoughts' && a.last.probe.pic === pic && b.frames === a.frames, `${where}: not one still frame of the ${pic} (${a.frames} -> ${b.frames}, ${JSON.stringify(a.last)})`);
  h.expect(thoughts(a.last).some((t) => out(t) < 0.8), `${where}: no thought stands in the window (${a.last.probe.things})`);
}

/** The scene draws again, in step with the countdown. */
async function moving(h, page, where) {
  const from = await scenes(page);
  await until(page, (n) => window.__scenes.frames > n + 10 && !window.__scenes.last.still, from.frames);
  const c = await pair(page);
  h.expect(c.s.frames > from.frames + 10 && !c.s.last.still, `${where}: the scene is not moving (${from.frames} -> ${c.s.frames})`);
  inStep(h, c, where);
}

/** Counts the page's WebGL buffers still held (made and not yet deleted), as window.__buffers. */
const countBuffers = () => {
  window.__buffers = 0;
  const p = WebGL2RenderingContext.prototype;
  const [make, drop] = [p.createBuffer, p.deleteBuffer];
  p.createBuffer = function () {
    const b = make.call(this);
    if (b) window.__buffers++;
    return b;
  };
  p.deleteBuffer = function (b) {
    if (b && this.isBuffer(b)) window.__buffers--;
    return drop.call(this, b);
  };
};

/**
 * The picture at four sizes: live, drawn and reporting its picture, the countdown clear below it. On a phone, two seconds
 * at a time through the minute: thoughts come in from beyond the window, cross it steadily and go out, never more at
 * once than the pace allows and never on top of each other; then it keeps the countdown's time and frees everything,
 * every buffer it gave the GPU included.
 */
async function picture(h, pic) {
  for (const [tag, vp] of [...SIZES, ['desk', DESK]]) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
    await ctx.addInitScript(countBuffers);
    await openStopped(h, page, (h, page) => toThoughts(h, page, pic), `${pic} ${tag}`);
    h.expect(PICS[pic].words.test(await page.locator('.dq-skill').innerText()), `${pic} ${tag}: the watch step does not say ${PICS[pic].words}`);
    await looks(h, page, `${pic}-${tag}`, 'thoughts', vp, undefined, { stopped: true });
    h.expect((await scenes(page)).last.probe.pic === pic, `${pic} ${tag}: the scene shows ${(await scenes(page)).last.probe.pic}`);
    await countdownClear(h, page, `${pic} ${tag}`);
    if (tag === 'phone') {
      const path = new Map();
      let most = 0;
      for await (const at of steps(h, page, pic, 2000, { run: true })) {
        const up = thoughts(at);
        for (const t of up) path.set(t[0], [...(path.get(t[0]) ?? []), { e: at.e, x: t[1], y: t[2], r: out(t) }]);
        const seen = up.filter((t) => out(t) < 1);
        most = Math.max(most, seen.length);
        h.expect(seen.length <= PICS[pic].most, `${pic}: ${seen.length} thoughts in the window at once at ${at.e.toFixed(1)} s (${at.probe.things})`);
        for (const a of seen) for (const b of seen) if (a !== b) h.expect(Math.hypot(a[1] - b[1], a[2] - b[2]) >= 0.3, `${pic}: two thoughts on top of each other at ${at.e.toFixed(1)} s (${at.probe.things})`);
        // to the minute's last few seconds
        if (at.e >= at.dur - 4) break;
      }
      const said = [...path].map(([n, ps]) => `${n}: ${ps.map((p) => `${p.e.toFixed(0)}s ${p.x.toFixed(2)}/${p.r.toFixed(2)}`).join(' ')}`).join('; ');
      // came in from beyond the window during the minute, crossed it, never stopping or turning back, and went out again
      const crossed = [...path].filter(([, ps]) => {
        const inside = ps.filter((p) => p.r < 0.75);
        const steady = ps.every((p, i) => !i || (Math.hypot(p.x - ps[i - 1].x, p.y - ps[i - 1].y) > 0.05 && p.x > ps[i - 1].x - 0.02));
        return ps[0].r > 1 && inside.length && ps[ps.length - 1].r > 1 && steady && inside[inside.length - 1].e - inside[0].e >= 4;
      });
      h.expect(crossed.length >= 1, `${pic}: no thought came in, crossed the window steadily and went out within the minute (${said})`);
      console.log(`  ${pic}: ${crossed.length} crossed in the minute, at most ${most} in view; ${said}`);
      // more time, so the countdown keeps running through the freeze however slowly the page draws once it comes back
      await page.locator('.dq-timer').getByRole('button', { name: '+30 s', exact: true }).click();
      await keepsTime(h, page, 'thoughts');
      const held = await page.evaluate(() => window.__buffers);
      h.expect(held === 0, `${pic} left: ${held} GPU buffers still held`);
    }
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  }
}

export const scenarios = {
  async 'thoughts-clouds'(h) {
    await picture(h, 'clouds');
  },
  async 'thoughts-cars'(h) {
    await picture(h, 'cars');
  },
  async 'thoughts-leaves'(h) {
    await picture(h, 'leaves');
  },

  /** the clouds dim the moon while one passes it, and it comes back after */
  async 'thoughts-clouds-moon'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await openStopped(h, page, (h, page) => toThoughts(h, page, 'clouds'), 'clouds moon');
    const moon = [];
    let shot = false;
    for await (const at of steps(h, page, 'clouds moon', 2000, { run: true })) {
      if (at.e >= at.dur - 2) break;
      moon.push(at.probe.moon);
      if (!shot && at.probe.moon < 0.5) {
        shot = true;
        await h.shot(page, 'thoughts-clouds-moon');
      }
    }
    const low = moon.indexOf(Math.min(...moon));
    h.expect(moon[low] < 0.5 && moon.slice(low).some((m) => m > 0.95), `clouds: the moon did not dim behind a cloud and come back (${moon.map((m) => m.toFixed(2)).join(' ')})`);
    console.log(`  clouds moon: ${moon.map((m) => m.toFixed(2)).join(' ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * reduced motion holds one still frame of each choice with a thought in view; the device's setting, and Motion set in
   * another open copy, each reach a moving scene at once and back
   */
  async 'thoughts-still'(h) {
    for (const [k, [tag, vp]] of SIZES.entries()) {
      for (const pic of NAMES) {
        const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await toThoughts(h, page, pic);
        await live(h, page, `still ${pic} ${tag}`);
        await holdsStill(h, page, pic, `reduced motion, ${pic} ${tag}`);
        await drawn(h, page, `still ${pic} ${tag}`);
        await h.shot(page, `thoughts-still-${pic}-${tag}`);
        h.expect(!errors.length, errors.join('\n'));
        await ctx.close();
      }
      const pic = NAMES[k];
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      const device = await deviceMotion(ctx, page);
      await toThoughts(h, page, pic);
      await live(h, page, `motion ${pic} ${tag}`);
      await moreTime(page);
      await moving(h, page, `${pic} ${tag}, Full`);
      await device('reduce');
      await holdsStill(h, page, pic, `${pic} ${tag}, device set to reduce motion`);
      await device('no-preference');
      await moving(h, page, `${pic} ${tag}, device back to motion`);
      const set = await otherCopy(h, ctx, page, errors);
      await set('Reduced');
      await holdsStill(h, page, pic, `${pic} ${tag}, Reduced in another copy`);
      await set('Full');
      await moving(h, page, `${pic} ${tag}, Full again`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** a lost WebGL context hands back to that choice's flat picture and the scene stops; restored, it draws again in step */
  async 'thoughts-context-loss'(h) {
    for (const [k, [tag, vp]] of SIZES.entries()) {
      const pic = NAMES[k];
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await openStopped(h, page, (h, page) => toThoughts(h, page, pic), `lost ${pic} ${tag}`);
      const { now } = await losesContext(h, page, `${pic} ${tag}`, `thoughts-lost-${pic}-${tag}`, async () => {
        h.expect(await page.locator(`.dq-thoughts--${pic}`).isVisible(), `lost ${pic} ${tag}: the flat ${pic} did not come back`);
      });
      h.expect(now.s.last.probe.pic === pic, `restored ${pic} ${tag}: the scene shows ${now.s.last.probe.pic}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** a GPU too slow for the full size: the scene draws fewer pixels within a few frames and keeps moving smoothly */
  async 'thoughts-slow-gpu'(h) {
    // each picture's draws together cost about 400 ms a frame at a phone's full canvas, and nothing at a sixth of its pixels
    const COST = { clouds: [40000, 600], cars: [40000, 3500], leaves: [40000, 2000] };
    for (const [k, [tag, vp]] of SIZES.entries()) {
      const pic = NAMES[k];
      await slowGpu(h, { vp, reach: (h, page) => toThoughts(h, page, pic), more: 0, cost: COST[pic], tag: `thoughts-slow-gpu-${pic}-${tag}` });
    }
  },

  /**
   * with no WebGL each choice's flat picture shows, alone, and its thoughts move (and hold still with reduced motion);
   * the skill still finishes and counts once, and stores nothing it didn't before
   */
  async 'thoughts-no-webgl'(h) {
    for (const pic of NAMES) {
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
      const save = async () => JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}');
      const keys = async () => page.evaluate(() => Object.keys(localStorage).sort());
      const [before, storedBefore] = [await save(), await keys()];
      await toThoughts(h, page, pic);
      await page.clock.runFor(1500);
      // the flat picture fades back in on the browser's own time
      await h.sleep(800);
      const s = await scenes(page);
      h.expect(s && s.contexts === 0 && s.live === 0 && !(await page.locator('.dq-scene').count()), `no WebGL ${pic}: a scene was left on the page: ${JSON.stringify(s)}`);
      const shown = await flat(page);
      const others = NAMES.filter((p) => p !== pic);
      h.expect(shown.length > 1 && shown.every(Boolean) && (await page.locator(`.dq-thoughts--${pic}`).isVisible()), `no WebGL ${pic}: the flat ${pic} is hidden (${JSON.stringify(shown)})`);
      h.expect((await page.locator(others.map((p) => `.dq-thoughts--${p}`).join(',')).count()) === 0, `no WebGL ${pic}: another choice's picture is there too`);
      const look = () => page.$$eval('.dq-thoughts > [visibility]', (els) => els.map((e) => `${e.getAttribute('visibility')} ${e.getAttribute('transform')}`).join(' | '));
      const a = await look();
      await page.clock.runFor(2000);
      const b = await look();
      h.expect(a !== b, `no WebGL ${pic}: the flat picture's thoughts do not move (${a})`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // the change reaches the page on its next rendering, in real time
      await h.sleep(500);
      await page.clock.runFor(100);
      const c = await look();
      await page.clock.runFor(2000);
      h.expect(c === (await look()), `no WebGL ${pic}, reduced motion: the flat picture's thoughts still move (${c})`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await h.shot(page, `thoughts-no-webgl-${pic}`);
      // through the rest of the minute and the skill to its end
      await page.clock.fastForward(61000);
      await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 5000 });
      // the countdown's Next, then the words after it
      await tap(page, 'Next');
      await tap(page, 'Next');
      await tap(page, 'Quieter');
      await tap(page, 'Done');
      await page.locator('.dq-feedback').waitFor({ timeout: 5000 });
      await tap(page, 'Yes');
      await page.locator('.dq-after:not(.is-hidden)').waitFor({ timeout: 5000 });
      const after = await save();
      const runs = (sv) => sv.events.filter((e) => e.k === 'skill' && e.skill === 'mindful-thoughts');
      h.expect(runs(after).length === runs(before).length + 1, `no WebGL ${pic}: Spectator Mode was not counted once (${runs(before).length} -> ${runs(after).length})`);
      const run = runs(after).at(-1);
      h.expect(JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(before).sort()) && JSON.stringify(await keys()) === JSON.stringify(storedBefore), `no WebGL ${pic}: something new was stored (${Object.keys(after)}; ${await keys()})`);
      h.expect(!JSON.stringify(run).includes(pic), `no WebGL ${pic}: the picture went into the save: ${JSON.stringify(run)}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** the emotion skill's watch step keeps its tide */
  async 'thoughts-emotion-keeps-tide'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await toSkill(h, page, 'current-emotion', 'watch');
    await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
    await live(h, page, 'emotion watch');
    const s = await scenes(page);
    h.expect(s.last.kind === 'tide' && !(await page.locator('.dq-timer-svg--thoughts').count()), `the emotion skill's watch step shows ${s.last.kind}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
