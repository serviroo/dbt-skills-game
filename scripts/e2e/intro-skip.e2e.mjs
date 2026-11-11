import { install, pauseClock, resume, runFor } from './clock.mjs';

// Skip in the intro ends the scene in flight and goes straight to Home: nothing more of it plays or moves, every sound
// it started stops, and the letterbox and any hush before the hit are gone. Steps the real intro frame by frame in
// ?capture, so every run checks the same frames, and reads what the scene asked of the audio from the capture's audio log.

/** The intro from `from` on, stepped 1/15 s at a time, with Skip on screen (the intro was seen before). */
async function intro(h, from) {
  const { page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, `?shot=${from}&capture&mute&dpr=1&nopost`);
  await page.waitForFunction(() => !!window.__stage && !!window.__audioLog, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__steps = async (until, max = 3000) => {
      for (let i = 0; i < max && !until(); i++) {
        window.__stage.step(1 / 15);
        await new Promise((r) => setTimeout(r));
      }
      return until();
    };
  });
  return { page, errors };
}

/** Presses Skip, steps on to Home, and returns what the scene asked of the audio from the press on. */
async function skip(h, page, tag) {
  const before = await page.evaluate(() => window.__audioLog.length);
  await page.locator('.ui-skip').click();
  const cam = () => page.evaluate(() => { const c = window.__stage.camera; return [...c.position.toArray(), ...c.quaternion.toArray(), c.fov].map((v) => v.toFixed(5)).join(' '); });
  const held = await cam();
  h.expect(await page.evaluate(() => window.__steps(() => window.__daily?.route.name === 'hub', 600)), `${tag}: Home never came after Skip`);
  await page.evaluate(() => { let i = 0; return window.__steps(() => ++i > 30); });
  const now = await cam();
  h.expect(now === held, `${tag}: the camera kept moving after Skip (${held} -> ${now})`);
  const after = await page.evaluate((n) => window.__audioLog.slice(n).map((e) => `${e.kind} ${e.name}`), before);
  const bars = await page.evaluate(() => [...document.querySelectorAll('.lb')].map((b) => parseFloat(b.style.height) || 0));
  h.expect(bars.every((v) => v === 0), `${tag}: the letterbox stayed over Home (${bars.join(', ')} vh)`);
  // every sound, bed, charge hum and score section the cut scene started before Skip is stopped at the press
  const playing = await page.evaluate((n) => {
    const log = window.__audioLog;
    const left = new Map();
    for (const e of log.slice(0, n)) {
      if (e.kind === 'play') left.set(`sound ${e.name}`, (left.get(`sound ${e.name}`) ?? 0) + 1);
      if (e.kind === 'stop' && left.get(`sound ${e.name}`)) left.set(`sound ${e.name}`, left.get(`sound ${e.name}`) - 1);
      if (e.kind === 'bed') left.set(`bed ${e.name}`, e.args[0] > 0 ? 1 : 0);
      if (e.kind === 'charge' && e.name !== 'set') left.set('charge hum', e.name === 'stop' ? 0 : 1);
      if (e.kind === 'music') left.set('score', e.name === 'stop' ? 0 : 1);
    }
    for (const e of log.slice(n)) {
      const k = e.kind === 'stop' ? `sound ${e.name}` : e.kind === 'bed' && e.args[0] === 0 ? `bed ${e.name}` : e.kind === 'charge' && e.name === 'stop' ? 'charge hum' : e.kind === 'music' && e.name === 'stop' ? 'score' : null;
      if (k && left.get(k)) left.set(k, left.get(k) - 1);
    }
    return [...left].filter(([, c]) => c > 0).map(([k]) => k);
  }, before);
  h.expect(!playing.length, `${tag}: still playing over Home after Skip: ${playing.join(', ')}`);
  return after;
}

export const scenarios = {
  /** Skip in the slow push-in to his eyes: the eyes never ignite, no letterbox closes in, the score never turns to the awaken */
  async 'skip-mid-silhouette'(h) {
    const { page, errors } = await intro(h, 'silhouette');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'play' && e.name === 'whoosh'))), 'the silhouette never started');
    // 8 s in: inside the 5.13 s push-in that starts 6.4 s after the whoosh
    await page.evaluate(() => { let i = 0; return window.__steps(() => ++i > 120); });
    const after = await skip(h, page, 'silhouette');
    const late = after.filter((e) => e === 'play eye_swell' || e === 'music awaken');
    h.expect(!late.length, `the skipped silhouette still played on after Skip: ${late.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Skip in the hush before the hit: the sound comes back for Home and the hit never lands */
  async 'skip-in-the-hush'(h) {
    const { page, errors } = await intro(h, 'awaken');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'hush'))), 'the awaken scene never hushed before the hit');
    const after = await skip(h, page, 'hush');
    h.expect(after.includes('unhush master'), `the hush before the hit held over Home: ${after.join(', ')}`);
    const late = after.filter((e) => /^play (awaken_hit|riser|soldier_ignite|stand_swell)$/.test(e));
    h.expect(!late.length, `the skipped awaken scene still played on after Skip: ${late.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Skip late in the awaken scene, under the stand-up swell, its loudest sound: it and the roar stop at the press */
  async 'skip-late-in-awaken'(h) {
    const { page, errors } = await intro(h, 'awaken');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'play' && e.name === 'stand_swell'))), 'the awaken scene never reached the stand-up swell');
    // about 12 s in: the swell is 1.2 s old and runs for 7 s
    await page.evaluate(() => { let i = 0; return window.__steps(() => ++i > 18); });
    const after = await skip(h, page, 'late-awaken');
    h.expect(after.includes('stop stand_swell'), `the stand-up swell played on over Home: ${after.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Rewards cards, cues and the note keep their own pace while every 3D frame is held. Not ?capture. */
  async 'rewards-keep-their-pace-on-slow-frames'(h) {
    const { ctx, page, errors } = await h.open(
      { 'dbt.app.v1': h.SEEN }, '?shot=rewards&mute', undefined, async (ctx) => {
      await install(ctx);
      await ctx.addInitScript(() => {
        const request = window.requestAnimationFrame.bind(window);
        const cancel = window.cancelAnimationFrame.bind(window);
        const scheduled = new Map();
        const held = new Map();
        const state = { cues: [], requested: 0, ran: 0 };
        window.__rewardsPace = state;
        let frozen = false;
        let released = false;
        let next = 0;
        window.requestAnimationFrame = (callback) => {
          const id = ++next;
          const run = (time) => {
            scheduled.delete(id);
            if (frozen) {
              state.requested++;
              held.set(id, callback);
              return;
            }
            if (document.querySelector('.rw')) state.ran++;
            callback(time);
          };
          if (frozen) {
            state.requested++;
            held.set(id, callback);
          } else scheduled.set(id, request(run));
          return id;
        };
        window.cancelAnimationFrame = (id) => {
          held.delete(id);
          if (scheduled.has(id)) cancel(scheduled.get(id));
          scheduled.delete(id);
        };
        window.__releaseRewardsFrames = () => {
          released = true;
          frozen = false;
          for (const callback of held.values()) window.requestAnimationFrame(callback);
          held.clear();
        };
        let root;
        new MutationObserver(() => {
          if (!released && document.querySelector('.lb')) frozen = true;
          const rewards = document.querySelector('.rw');
          if (rewards && !root) {
            root = rewards;
            state.attached = performance.now();
            state.stageStart = window.__stage.time;
          }
          if (root && !root.isConnected && state.gone === undefined) {
            state.gone = performance.now();
            state.stageEnd = window.__stage.time;
          }
        }).observe(document, { subtree: true, childList: true });
      });
    });
    try {
      const title = page.locator('.title-screen');
      await title.waitFor({ timeout: 60000 });
      await h.sleep(1500);
      const soundReady = await page.evaluate(async () => {
        const { uiSounds } = await import('/src/ui/cutscene-ui.ts');
        const play = uiSounds.play;
        if (!play) return false;
        uiSounds.play = (cue, options) => {
          if (cue === 'reward_chime') window.__rewardsPace.cues.push({ index: options?.index, at: performance.now() });
          return play(cue, options);
        };
        return true;
      });
      h.expect(soundReady, 'rewards cue sound hook was not available');
      await pauseClock(page);
      const titleBox = await title.boundingBox();
      await page.mouse.click(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
      await h.poll(page, () => page.locator('.rw').count(), Boolean,
        'rewards did not attach while loading the world', { timeout: 60000, polling: 50 });
      const timings = await page.evaluate(() => {
        const timing = (element) => element?.getAnimations().map((a) => ({
          end: a.effect.getComputedTiming().endTime, state: a.playState, rate: a.playbackRate,
        })) ?? [];
        const root = document.querySelector('.rw');
        const cards = [...document.querySelectorAll('.rw-card')];
        const button = document.querySelector('.rw button');
        window.__rewardsPace.rootAnimation = root?.getAnimations()[0];
        window.__rewardsPace.animations = [...cards, button].map((element) => element?.getAnimations()[0]);
        return { root: timing(root), cards: cards.map(timing), button: timing(button) };
      });
      h.expect(timings.root.length === 1 && timings.root[0].rate === 1
        && ['running', 'finished'].includes(timings.root[0].state),
      `rewards root entrance expected rate 1 and live playback, saw ${JSON.stringify(timings.root)}`);
      const ends = [1070, 1570, 2070, 2570, 3170];
      const steps = [...timings.cards, timings.button];
      h.expect(timings.cards.length === 4, `rewards has ${timings.cards.length} cards, expected 4`);
      for (let i = 0; i < ends.length; i++) {
        const name = i < 4 ? `card ${i + 1}` : 'button';
        const found = steps[i];
        h.expect(found.length === 1 && Math.abs(found[0].end - ends[i]) < 0.001 && found[0].rate === 1
          && ['running', 'finished'].includes(found[0].state),
        `${name} animation expected end ${ends[i]} ms, rate 1 and live playback, saw ${JSON.stringify(found)}`);
      }
      const animation = (index) => page.evaluate((index) => {
        const a = index === -1 ? window.__rewardsPace.rootAnimation : window.__rewardsPace.animations[index];
        const end = a.effect.getComputedTiming().endTime;
        return { end, state: a.playState, rate: a.playbackRate, start: a.startTime,
          finish: a.startTime === null ? null : a.startTime + end / a.playbackRate };
      }, index);
      const root = await h.poll(page, () => animation(-1), (a) => typeof a.start === 'number',
        (a) => `rewards root entrance had no start time: ${JSON.stringify(a)}`, { timeout: 30000, polling: 50 });
      h.expect(root.rate === 1 && ['running', 'finished'].includes(root.state),
        `rewards root entrance expected rate 1 and live playback, saw ${JSON.stringify(root)}`);
      const schedules = [];
      for (let i = 0; i < ends.length; i++) {
        const name = i < 4 ? `card ${i + 1}` : 'button';
        const initial = await h.poll(page, () => animation(i), (a) => typeof a.start === 'number',
          (a) => `${name} animation had no start time: ${JSON.stringify(a)}`, { timeout: 30000, polling: 50 });
        h.expect(Math.abs(initial.start - root.start) <= 1 && initial.rate === 1
          && Math.abs(initial.end - ends[i]) < 0.001 && ['running', 'finished'].includes(initial.state),
        `${name} schedule expected start within 1 ms of root ${root.start}, saw ${JSON.stringify(initial)}`);
        schedules.push(initial);
      }
      const buttonTime = schedules[4].end / schedules[4].rate;
      const tapInterval = 300;
      const exitTime = 380;
      const total = buttonTime + tapInterval + exitTime;
      const buttonFromRoot = schedules[4].finish - root.start;
      h.expect(Math.abs(buttonFromRoot - 3170) <= 1.001 && total <= 3850,
        `rewards pace: button ${buttonFromRoot} ms from root, tap ${tapInterval} ms, `
          + `exit ${exitTime} ms, budget ${total} ms`);
      let elapsed = 0;
      for (let i = 0; i < 4; i++) {
        const boundary = 450 + i * 500;
        await runFor(page, boundary - elapsed - 1);
        const before = await page.evaluate(() => window.__rewardsPace.cues);
        h.expect(before.length === i, `cue ${i + 1} fired before ${boundary} ms: ${JSON.stringify(before)}`);
        await runFor(page, 1);
        const observed = await page.evaluate(() => {
          const { cues, attached } = window.__rewardsPace;
          return cues.map((cue) => ({ index: cue.index, at: cue.at - attached }));
        });
        h.expect(observed.length === i + 1 && observed[i].index === i && observed[i].at === boundary,
          `cue ${i + 1} expected ${boundary} ms, saw ${JSON.stringify(observed)}`);
        elapsed = boundary;
      }
      for (let i = 0; i < ends.length; i++) {
        const name = i < 4 ? `card ${i + 1}` : 'button';
        const done = await h.poll(page, () => animation(i), (a) => a.state === 'finished',
          (a) => `${name} animation did not finish: ${JSON.stringify(a)}`, { timeout: 30000, polling: 50 });
        h.expect(done.rate === 1 && done.start === schedules[i].start && Math.abs(done.end - ends[i]) < 0.001
          && Math.abs(done.finish - schedules[i].finish) < 0.001,
        `${name} animation schedule changed: started ${JSON.stringify(schedules[i])}, `
          + `finished ${JSON.stringify(done)}`);
      }
      const rootDone = await animation(-1);
      h.expect(rootDone.state === 'finished' && rootDone.rate === 1 && rootDone.start === root.start
        && rootDone.end === root.end,
      `rewards root entrance schedule changed: started ${JSON.stringify(root)}, finished ${JSON.stringify(rootDone)}`);
      const note = page.getByRole('button', { name: 'Read the note' });
      await h.poll(page, () => note.evaluate((button) => ({
        inert: !!button.closest('[inert]'), disabled: button.disabled,
      })), (button) => !button.inert && !button.disabled,
      (button) => `button did not become ready: ${JSON.stringify(button)}`,
      { timeout: 30000, polling: 50 });
      const box = await note.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await runFor(page, 379);
      h.expect(await page.locator('.rw').count(), 'exit removed rewards before 380 ms');
      await runFor(page, 1);
      await h.poll(page, () => page.locator('.rw').count(), (count) => count === 0,
        'exit did not remove rewards after 380 ms of page time', { timeout: 30000, polling: 50 });
      const state = await page.evaluate(() => window.__rewardsPace);
      h.expect(state.requested > 0 && state.ran === 0 && state.stageEnd === state.stageStart,
        `stage frames were not frozen: ${JSON.stringify(state)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await page.evaluate(() => window.__releaseRewardsFrames?.()).catch(() => {});
      await resume(page).catch(() => {});
      await ctx.close();
    }
  },

  /** Skip after the chest is fully charged while Space is still held: the hold leaves with the scene instead of waiting
   *  over Home for the key to come up, and the key coming up does nothing there. Real time, not ?capture. */
  async 'skip-after-a-full-hold'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?shot=chest&mute');
    try {
      const title = page.locator('.title-screen');
      await title.waitFor({ timeout: 60000 });
      await h.sleep(1500);
      await title.click();
      await page.locator('.chest-hold').waitFor({ timeout: 60000 });
      await page.keyboard.down('Space');
      // the charge runs on the scene's clock, which a slow renderer advances a tenth of a second a frame at most: step it
      // past the 1.5 s charge here, as the ?capture checks step it, so reaching full doesn't depend on the frame rate
      await page.evaluate(() => {
        for (let i = 0; i < 4; i++) window.__stage.step(0.5);
      });
      await page.locator('.chest-hold.is-full').waitFor({ state: 'attached', timeout: 30000 });
      await page.locator('.ui-skip').click();
      await h.until(page, () => window.__daily?.route.name === 'hub', null, { timeout: 15000 });
      const left = await page.locator('.chest-hold').count();
      await page.keyboard.up('Space');
      await h.frames(page, 30);
      h.expect(!left, 'the full chest hold stayed on the page over Home while Space was held');
      h.expect(await page.evaluate(() => window.__daily.route.name === 'hub' && !document.querySelector('.rw')), 'letting go of Space after Skip moved on from Home');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Skip while the chest charges: the charge hum stops and the chest never bursts */
  async 'skip-in-the-chest-charge'(h) {
    const { page, errors } = await intro(h, 'chest');
    h.expect(await page.evaluate(() => window.__steps(() => window.__audioLog.some((e) => e.kind === 'charge' && e.name === 'start'))), 'the chest never started to charge');
    const after = await skip(h, page, 'chest');
    h.expect(after.includes('charge stop'), `the charge hum kept going over Home: ${after.join(', ')}`);
    h.expect(!after.includes('play chest_burst'), 'the skipped chest still burst open after Skip');
    h.expect(!errors.length, errors.join('\n'));
  },
};
