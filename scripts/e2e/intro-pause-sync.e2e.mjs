async function intro(h, beat, reduced = false) {
  const opened = await h.open({ 'dbt.app.v1': h.SEEN }, `?shot=${beat}&mute&dpr=1&nopost${reduced ? '&reduced' : ''}`, { width: 390, height: 844 }, (ctx) => ctx.addInitScript(() => {
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
      document.dispatchEvent(new Event('visibilitychange'));
      if (!on) for (const fn of waiting.splice(0)) raf(fn);
    };
  }));
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
      window.__introCues.push({ cue, at: this.now, picture: window.__stage.time });
      return play.call(this, cue, ...args);
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
        void after(600).then(() => { window.__introExistingDelayDone = true; });
        setTimeout(() => window.__introHide(true), 30);
      }
      return a;
    };
  });
  await page.locator('.title-screen').click();
  await page.locator('.ui-skip').waitFor({ timeout: 60000 });
  const cue = { silhouette: 'whoosh', awaken: 'hush', chest: 'chest_rise', windows: 'ui_open' }[beat];
  await page.waitForFunction((cue) => window.__introCues.some((c) => c.cue === cue), cue, { timeout: 60000 });
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
const suspended = (page) => page.waitForFunction(() => window.__introAudio.state === 'suspended', null, { timeout: 5000, polling: 50 });
const running = (page) => page.waitForFunction(() => window.__introAudio.state === 'running', null, { timeout: 5000 });

async function checkPause(h, page, tag) {
  await hidden(page, true);
  await suspended(page);
  const before = await read(page);
  await h.sleep(1300);
  const after = await read(page);
  h.expect(after.audio === before.audio, `${tag}: sound advanced while hidden`);
  h.expect(after.picture === before.picture, `${tag}: picture advanced ${(after.picture - before.picture).toFixed(3)} s while sound was paused`);
  h.expect(JSON.stringify(after.camera) === JSON.stringify(before.camera), `${tag}: the camera moved while hidden`);
  h.expect(after.cues === before.cues, `${tag}: cues fired while hidden`);
  await hidden(page, false);
  await running(page);
  const resumed = await read(page);
  await h.sleep(800);
  const later = await read(page);
  h.expect(later.picture > resumed.picture + 0.3, `${tag}: picture never resumed`);
  const drift = (later.picture - before.picture) - (later.audio - before.audio);
  h.expect(Math.abs(drift) < 0.12, `${tag}: sound and picture drifted ${drift.toFixed(3)} s after resuming`);
}

export const scenarios = {
  ...Object.fromEntries(['silhouette', 'awaken', 'chest'].map((beat) => [`intro-pause-${beat}`, async (h) => {
    const { page, errors } = await intro(h, beat);
    await checkPause(h, page, beat);
    await checkPause(h, page, `${beat} again`);
    if (beat === 'awaken') {
      await page.waitForFunction(() => window.__introCues.some((c) => c.cue === 'awaken_hit'), null, { timeout: 15000 });
      const hits = await page.evaluate(() => window.__introCues.filter((c) => c.cue === 'awaken_hit').length);
      h.expect(hits === 1, `the awaken hit played ${hits} times`);
      const cues = await page.evaluate(() => window.__introCues.map((c) => c.cue));
      const expected = ['whoosh', 'awaken_voice', 'hush', 'awaken_hit'];
      h.expect(JSON.stringify(cues.filter((c) => expected.includes(c))) === JSON.stringify(expected), `awaken cues changed order or repeated: ${cues.join(', ')}`);
    }
    await page.locator('.ui-skip').click();
    await page.getByRole('button', { name: 'Read the note' }).waitFor({ timeout: 15000 });
    h.expect(!errors.length, errors.join('\n'));
  }])),
  ...Object.fromEntries([false, true].map((reduced) => [`intro-pause-window-${reduced ? 'reduced' : 'full'}`, async (h) => {
    const { page, errors } = await intro(h, 'windows', reduced);
    await suspended(page);
    await page.evaluate(async () => {
      const { after } = await import('/src/ui/anim.ts');
      window.__introDelayDone = false;
      void after(300).then(() => { window.__introDelayDone = true; });
    });
    const before = await page.evaluate(() => window.__introOpening.currentTime);
    await h.sleep(800);
    const after = await page.evaluate(() => ({ time: window.__introOpening.currentTime, done: window.__introDelayDone, existing: window.__introExistingDelayDone }));
    h.expect(after.time === before, 'the window opening animation ran while hidden');
    h.expect(!after.existing, 'a pending window delay expired while hidden');
    h.expect(!after.done, 'a window delay created while hidden ran before returning');
    await hidden(page, false);
    await running(page);
    await page.waitForFunction(() => window.__introDelayDone && window.__introExistingDelayDone, null, { timeout: 5000 });
    await page.locator('.ui-skip').click();
    await page.getByRole('button', { name: 'Read the note' }).waitFor({ timeout: 15000 });
    h.expect(!errors.length, errors.join('\n'));
  }])),
  async 'intro-pause-leaves-companion-alone'(h) {
    const { page, errors } = await intro(h, 'chest');
    await checkPause(h, page, 'before leaving the intro');
    await page.locator('.ui-skip').click();
    await page.getByRole('button', { name: 'Read the note' }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.ec-actions')?.inert === false);
    await page.getByRole('button', { name: 'Enter the Lantern', exact: true }).press('Enter');
    await page.locator('.dq-top').waitFor({ timeout: 30000 });
    await hidden(page, true);
    const untouched = await page.evaluate(async () => {
      const { after } = await import('/src/ui/anim.ts');
      const el = document.createElement('span');
      document.body.append(el);
      const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000 });
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
      ctx.suspend = async () => {
        await new Promise((r) => setTimeout(r, 300));
        return suspend();
      };
      window.__introHide(true);
      window.__introHide(false);
    });
    await h.sleep(700);
    h.expect((await read(page)).state === 'running', 'a quick tab return left sound suspended');
    await checkPause(h, page, 'after a quick return');
    h.expect(!errors.length, errors.join('\n'));
  },
};
