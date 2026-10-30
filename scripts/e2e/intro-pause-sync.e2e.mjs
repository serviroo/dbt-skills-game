import { poll } from './harness.mjs';

async function intro(h, beat, reduced = false, hiddenStart = false) {
  const opened = await h.open({ 'dbt.app.v1': h.SEEN }, `?shot=${beat}&mute&dpr=1&nopost${reduced ? '&reduced' : ''}`, { width: 390, height: 844 }, async (ctx) => {
    await ctx.clock.install();
    await ctx.addInitScript(() => {
      window.AudioContext = new Proxy(window.AudioContext, { construct(Target, args) {
        return window.__introAudio = new Target(...args);
      } });
      let hidden = false;
      const raf = window.requestAnimationFrame.bind(window);
      const waiting = [];
      window.requestAnimationFrame = (fn) => raf((t) => {
        if (hidden) waiting.push(fn);
        else fn(t);
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
      window.__introHide = (on) => {
        hidden = on;
        if (on) window.__introHiddenAt = performance.now();
        document.dispatchEvent(new Event('visibilitychange'));
        if (!on) for (const fn of waiting.splice(0)) raf(fn);
      };
    });
  });
  const { page } = opened;
  await page.locator('.title-screen').waitFor({ timeout: 60000 });
  await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const play = AudioEngine.prototype.play;
    const hush = AudioEngine.prototype.hush;
    AudioEngine.prototype.hush = function (...args) {
      window.__introCues.push({ cue: 'hush', at: this.now, picture: window.__stage.time });
      return hush.apply(this, args);
    };
    window.__introCues = [];
    AudioEngine.prototype.play = function (cue, ...args) {
      window.__introEngine = this;
      window.__introCues.push({ cue, at: this.now, picture: window.__stage.time });
      return play.call(this, cue, ...args);
    };
  });
  if (hiddenStart) await page.evaluate(async () => {
    const { Director } = await import('/src/cutscene/director.ts');
    const play = Director.prototype.play;
    Director.prototype.play = function (...args) {
      window.__introHide(true);
      return play.apply(this, args);
    };
  });
  if (beat === 'windows') await page.evaluate(async () => {
    const { after } = await import('/src/ui/anim.ts');
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const a = animate.apply(this, args);
      if (!window.__introOpening && this.matches('.sw-plate, .sw')) {
        window.__introOpening = a;
        window.__introExistingDelayDone = false;
        window.__introDelayAt = performance.now();
        void after(600).then(() => { window.__introExistingDelayDone = true; });
        if (!document.hidden) setTimeout(() => window.__introHide(true), 30);
      }
      return a;
    };
  });
  // the window's opening runs on the page's animation clock, which page.clock does not fake: that clock stays still until
  // the scenario has seen the page hide, so the hide lands while the window is opening however slow the machine is
  if (beat === 'windows' && !hiddenStart) {
    opened.timeline = await opened.ctx.newCDPSession(page);
    await opened.timeline.send('Animation.setPlaybackRate', { playbackRate: 0 });
  }
  if (beat === 'windows') await h.pauseClock(page);
  await page.locator('.title-screen').press('Enter');
  await page.locator('.ui-skip').waitFor({ timeout: 60000 });
  const cue = { silhouette: 'whoosh', awaken: 'hush', chest: 'chest_rise', windows: 'ui_open' }[beat];
  await page.waitForFunction((cue) => window.__introCues.some((c) => c.cue === cue), cue, { timeout: 60000, polling: 50 });
  if (beat === 'windows') await page.clock.fastForward(30);
  else await h.pauseClock(page);
  return opened;
}

const read = (page) => page.evaluate(() => ({
  picture: window.__stage.time,
  audio: window.__introAudio.currentTime,
  state: window.__introAudio.state,
  camera: [...window.__stage.camera.position.toArray(), ...window.__stage.camera.quaternion.toArray()],
  cues: window.__introCues.length,
}));
const hidden = (page, on) => page.evaluate((on) => window.__introHide(on), on);
/** The window's opening once its pending play or pause has taken effect, so its time no longer moves by itself. */
async function opening(page) {
  await poll(page, () => page.evaluate(() => window.__introOpening.ready.then(() => true)), Boolean, 'the window opening never settled', { timeout: 5000 });
  return page.evaluate(() => {
    const a = window.__introOpening;
    return { state: a.playState, time: a.currentTime, end: a.effect.getComputedTiming().endTime };
  });
}
async function audioState(page, state) {
  const became = () =>
    page.evaluate((state) => new Promise((resolve) => {
      const ctx = window.__introAudio;
      const check = () => {
        if (ctx.state !== state) return;
        ctx.removeEventListener('statechange', check);
        resolve(true);
      };
      ctx.addEventListener('statechange', check);
      check();
    }), state);
  await poll(page, became, Boolean, `sound never became ${state}`, { timeout: 5000 });
}
const suspended = (page) => audioState(page, 'suspended');
const running = (page) => audioState(page, 'running');

async function checkPause(h, page, tag) {
  await hidden(page, true);
  await suspended(page);
  const before = await read(page);
  await page.clock.fastForward(1300);
  const after = await read(page);
  h.expect(after.audio === before.audio, `${tag}: sound advanced while hidden`);
  h.expect(after.picture === before.picture, `${tag}: picture advanced ${(after.picture - before.picture).toFixed(3)} s while sound was paused`);
  h.expect(JSON.stringify(after.camera) === JSON.stringify(before.camera), `${tag}: the camera moved while hidden`);
  h.expect(after.cues === before.cues, `${tag}: cues fired while hidden`);
  await hidden(page, false);
  await running(page);
  const resumed = await read(page);
  await page.clock.fastForward(800);
  await h.sleep(100);
  const later = await read(page);
  h.expect(resumed.picture === before.picture, `${tag}: the picture jumped on return`);
  h.expect(later.picture > before.picture && later.picture < before.picture + 0.9, `${tag}: the picture did not carry on from its paused time`);
  h.expect(resumed.audio >= before.audio && later.audio > resumed.audio, `${tag}: sound did not carry on from its paused time`);
}

export const scenarios = {
  ...Object.fromEntries(['silhouette', 'awaken', 'chest'].map((beat) => [`intro-pause-${beat}`, async (h) => {
    const { page, errors } = await intro(h, beat);
    await checkPause(h, page, beat);
    await checkPause(h, page, `${beat} again`);
    if (beat === 'awaken') {
      for (let i = 0; i < 10; i++) await page.clock.fastForward(100);
      await page.waitForFunction(() => window.__introCues.some((c) => c.cue === 'awaken_hit'), null, { timeout: 15000 });
      const hits = await page.evaluate(() => window.__introCues.filter((c) => c.cue === 'awaken_hit').length);
      h.expect(hits === 1, `the awaken hit played ${hits} times`);
      const cues = await page.evaluate(() => window.__introCues.map((c) => c.cue));
      const expected = ['whoosh', 'awaken_voice', 'hush', 'awaken_hit'];
      h.expect(JSON.stringify(cues.filter((c) => expected.includes(c))) === JSON.stringify(expected), `awaken cues changed order or repeated: ${cues.join(', ')}`);
    }
    await page.locator('.ui-skip').press('Enter');
    await page.getByRole('button', { name: 'Read the note' }).waitFor({ timeout: 15000 });
    h.expect(!errors.length, errors.join('\n'));
  }])),
  ...Object.fromEntries([false, true].map((reduced) => [`intro-pause-window-${reduced ? 'reduced' : 'full'}`, async (h) => {
    const { page, errors, timeline } = await intro(h, 'windows', reduced);
    await suspended(page);
    const before = await opening(page);
    h.expect(before.time < before.end, `the window had finished opening before the page hid: ${JSON.stringify(before)}`);
    // the animation clock runs again: an opening left playing would reach its end in the real time waited below
    await timeline.send('Animation.setPlaybackRate', { playbackRate: 1 });
    await page.evaluate(async () => {
      const { after } = await import('/src/ui/anim.ts');
      window.__introDelayDone = false;
      void after(300).then(() => { window.__introDelayDone = true; });
    });
    await page.clock.fastForward(800);
    await h.sleep(before.end);
    const after = await page.evaluate(() => ({ time: window.__introOpening.currentTime, done: window.__introDelayDone, existing: window.__introExistingDelayDone }));
    h.expect(after.time === before.time, 'the window opening animation ran while hidden');
    h.expect(!after.existing, 'a pending window delay expired while hidden');
    h.expect(!after.done, 'a window delay created while hidden ran before returning');
    await hidden(page, false);
    await running(page);
    const left = await page.evaluate(() => 600 - (window.__introHiddenAt - window.__introDelayAt));
    h.expect(left > 1 && left < 600, `the pending delay did not start before hiding (${left} ms left)`);
    let elapsed = 0;
    for (const at of [left - 1, left + 1, 299, 301].sort((a, b) => a - b)) {
      await page.clock.fastForward(at - elapsed);
      elapsed = at;
      const done = await page.evaluate(() => ({ existing: window.__introExistingDelayDone, created: window.__introDelayDone }));
      h.expect(done.existing === (at >= left), `the pending delay lost its remaining time at ${at} ms`);
      h.expect(done.created === (at >= 300), `the delay created while hidden lost its duration at ${at} ms`);
    }
    await page.locator('.ui-skip').press('Enter');
    await page.getByRole('button', { name: 'Read the note' }).waitFor({ timeout: 15000 });
    h.expect(!errors.length, errors.join('\n'));
  }])),
  async 'intro-pause-window-hidden-start'(h) {
    const { page, errors } = await intro(h, 'windows', false, true);
    await suspended(page);
    const before = (await opening(page)).time;
    await h.sleep(300);
    const held = await page.evaluate(() => ({ time: window.__introOpening.currentTime, state: window.__introOpening.playState }));
    h.expect(held.state === 'paused' && held.time === before, 'a window created while hidden kept animating');
    await hidden(page, false);
    await running(page);
    await h.sleep(200);
    h.expect(await page.evaluate(() => window.__introOpening.currentTime > 0 && window.__introOpening.playState !== 'paused'), 'the hidden-start window did not resume');
    await page.locator('.ui-skip').press('Enter');
    await page.getByRole('button', { name: 'Read the note' }).waitFor({ timeout: 15000 });
    h.expect(!errors.length, errors.join('\n'));
  },
  async 'intro-pause-leaves-companion-alone'(h) {
    const { page, errors } = await intro(h, 'chest');
    await checkPause(h, page, 'before leaving the intro');
    await page.locator('.ui-skip').press('Enter');
    await page.getByRole('button', { name: 'Read the note' }).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await page.getByRole('button', { name: 'Read the note' }).press('Enter');
    await page.clock.fastForward(400);
    await page.locator('.sw-actions').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await page.getByRole('button', { name: 'Continue', exact: true }).press('Enter');
    await page.clock.fastForward(600);
    await page.locator('.ec-actions').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await page.getByRole('button', { name: 'Enter the Lantern', exact: true }).press('Enter');
    await page.clock.fastForward(700);
    await page.locator('.dq-top').waitFor({ timeout: 30000 });
    await page.clock.resume();
    await hidden(page, true);
    const untouched = await page.evaluate(async () => {
      const { after, animate } = await import('/src/ui/anim.ts');
      const el = document.createElement('span');
      document.body.append(el);
      const a = animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 1000 });
      const done = await Promise.race([after(150).then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
      const running = a.playState === 'running';
      a.cancel();
      el.remove();
      return done && running;
    });
    h.expect(untouched, 'intro pause handling remained attached in the companion');
    await hidden(page, false);
    h.expect(!errors.length, errors.join('\n'));
  },
  async 'intro-pause-rapid-return'(h) {
    const { page, errors } = await intro(h, 'silhouette');
    await page.evaluate(() => {
      const ctx = window.__introAudio;
      const suspend = ctx.suspend.bind(ctx);
      ctx.suspend = () => new Promise((resolve, reject) => {
        window.__introFinishSuspend = () => {
          ctx.suspend = suspend;
          return suspend().then(resolve, reject);
        };
      });
      window.__introHide(true);
      window.__introHide(false);
    });
    await page.evaluate(() => window.__introFinishSuspend());
    await h.sleep(100);
    h.expect((await read(page)).state === 'running', 'a quick tab return left sound suspended');
    await checkPause(h, page, 'after a quick return');
    h.expect(!errors.length, errors.join('\n'));
  },
  ...Object.fromEntries(['resume', 'unlock'].map((source) => [`intro-pause-hide-during-${source}`, async (h) => {
    const { page, errors } = await intro(h, 'silhouette');
    if (source === 'resume') await hidden(page, true);
    else await page.evaluate(() => window.__introAudio.suspend());
    await suspended(page);
    await page.evaluate((source) => {
      const ctx = window.__introAudio;
      const resume = ctx.resume.bind(ctx);
      ctx.resume = () => new Promise((resolve, reject) => {
        window.__introFinishResume = () => resume().then(resolve, reject);
      });
      if (source === 'resume') window.__introHide(false);
      else void window.__introEngine.unlock();
      window.__introHide(true);
    }, source);
    await page.evaluate(() => window.__introFinishResume());
    await h.sleep(100);
    h.expect((await read(page)).state === 'suspended', 'a pending resume left sound running while hidden');
    await page.clock.fastForward(500);
    const before = await read(page);
    await h.sleep(100);
    h.expect((await read(page)).audio === before.audio, 'sound advanced after a resume settled while hidden');
    h.expect(!errors.length, errors.join('\n'));
  }])),
};
