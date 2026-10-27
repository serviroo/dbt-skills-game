// A device that draws 3D slowly gets a size it can draw within the cinematic's first frames. Drawing dozens of frames
// at full size first is a slideshow for the player, and those frames hold the GPU (on a shared software renderer, every
// other open copy of the game waits behind them). Real time, not ?capture: the stage's own frame loop decides.

export const scenarios = {
  /** every 3D frame takes 0.4 s longer than it really did, as on a GPU far too slow for full quality */
  async 'slow-gpu-settles-fast'({ open, expect, YOU }) {
    const names = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now(), companionAt: Date.now() });
    const { ctx, page, errors } = await open({ [YOU]: names }, '?mute', undefined, (c) =>
      c.addInitScript(() => {
        const raf = window.requestAnimationFrame.bind(window);
        let late = 0;
        window.requestAnimationFrame = (cb) => raf((t) => cb(t + (late += 400)));
      }),
    );
    await page.waitForFunction(() => !!window.__stage, null, { timeout: 60000 });
    // the size and MSAA after each frame of the stage's loop
    await page.evaluate(() => {
      const s = window.__stage;
      window.__q = [];
      s.onUpdate(() => s.frameLog.length && window.__q.push([s.dpr, s.composer.multisampling]));
    });
    const title = page.locator('.title-screen');
    await title.waitFor({ timeout: 60000 });
    await title.click();
    await page.waitForFunction(() => window.__q.length >= 20, null, { timeout: 90000 });
    const q = await page.evaluate(() => ({ q: window.__q.slice(0, 20), floor: window.__stage.minDpr }));
    const at = (n) => q.q[n - 1];
    expect(at(4)[0] <= 0.85, `after 4 frames of 0.4 s the stage still drew at ${at(4)[0]} (it can go to 0.85): ${JSON.stringify(q.q)}`);
    expect(at(20)[0] === q.floor && q.floor === 0.75 && at(20)[1] === 0, `after 20 slow frames the stage is not at its lowest quality (0.75, no MSAA): ${JSON.stringify(q)}`);
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return q.q;
  },
  /** a device that keeps up, with one 1 s stall (a shader compile, a tab coming back): the stall alone changes nothing */
  async 'lone-stall-keeps-quality'({ open, expect, YOU }) {
    const names = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now(), companionAt: Date.now() });
    const { ctx, page, errors } = await open({ [YOU]: names }, '?mute');
    await page.waitForFunction(() => !!window.__stage, null, { timeout: 60000 });
    await page.evaluate(() => {
      const s = window.__stage;
      const raf = window.requestAnimationFrame.bind(window);
      let real = -1;
      let at = 0;
      let n = 0;
      // from the stage's first frame on it sees every frame take 1/60 s, and its 10th take 1 s: the old adapter dropped
      // quality about 22 frames later, so 50 frames show it while staying quick on a software renderer
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          if (!s.last) return cb(t);
          if (t !== real) (real = t), (at = (at || s.last) + 1000 / 60 + (++n === 10 ? 1000 : 0));
          cb(at);
        });
      window.__q = [];
      s.onUpdate(() => s.frameLog.length && window.__q.push([s.dpr, s.composer.multisampling]));
    });
    const title = page.locator('.title-screen');
    await title.waitFor({ timeout: 60000 });
    await title.click();
    await page.waitForFunction(() => window.__q.length >= 50, null, { timeout: 120000 });
    const q = await page.evaluate(() => ({ q: window.__q.slice(0, 50), max: Math.max(...window.__stage.frameLog), top: window.__stage.maxDpr }));
    expect(q.max >= 1, `the stage never saw the 1 s frame (longest ${q.max} s)`);
    const off = q.q.findIndex(([dpr, msaa]) => dpr !== q.top || msaa !== 4);
    expect(off < 0, `one 1 s stall on a device that keeps up lowered quality at frame ${off + 1}: ${JSON.stringify(q.q[off])}`);
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
