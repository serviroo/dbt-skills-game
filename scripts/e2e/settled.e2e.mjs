// The harness waits for layout to rest, including delayed entrances and animated parents, without waiting on paint.
export const scenarios = {
  async 'settled-old-quiet-red'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes enter { from { transform:translateY(100px) } to { transform:translateY(0) } } button { animation:enter 5s linear both }</style><button>One</button>');
      // The former layout wait stops after its quiet period and animation cap, even while the entrance runs.
      await page.evaluate(async () => {
        await new Promise((done) => {
          let quiet;
          const mo = new MutationObserver(() => {
            clearTimeout(quiet);
            quiet = setTimeout(end, 400);
          });
          const end = () => {
            mo.disconnect();
            clearTimeout(cap);
            done();
          };
          const cap = setTimeout(end, 4000);
          quiet = setTimeout(end, 400);
          mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        });
        const ending = document.getAnimations().filter((a) => {
          const t = a.effect?.getComputedTiming();
          if (!t || t.endTime === Infinity || a.playState !== 'running' || !a.playbackRate) return false;
          const left = a.playbackRate > 0 ? t.endTime - (a.currentTime ?? 0) : a.currentTime ?? 0;
          return left / Math.abs(a.playbackRate) <= 3000;
        });
        await Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 3000))]);
      });
      let red = '';
      try { h.expect(await page.locator('button').evaluate((el) => !el.getAnimations().some((a) => a.playState === 'running')), 'old quiet wait measured a moving button'); } catch (e) { red = e.message; }
      h.expect(!!red, 'the old quiet wait unexpectedly waited for the whole entrance');
      await h.settled(page, 'button');
      h.expect(await page.locator('button').evaluate((el) => !el.getAnimations().some((a) => a.playState === 'running')), 'the shared wait measured a moving button');
      return { oldFailure: red };
    } finally { await ctx.close(); }
  },
  async 'settled-old-read-waits-red'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes enter { from { transform:translateY(100px) } to { transform:translateY(0) } } section { animation:enter 1.6s linear both }</style><section>Chapter two</section>');
      await h.sleep(400);
      const first = await page.locator('section').boundingBox();
      await h.sleep(700);
      const p = await page.locator('section').boundingBox();
      let red = '';
      try { h.expect(Math.abs(p.y - first.y) <= 1, 'old Read waits measured the entrance moving'); } catch (e) { red = e.message; }
      h.expect(!!red, 'the old Read waits unexpectedly outlasted the entrance');
      await h.settled(page, 'section');
      const a = await page.locator('section').boundingBox();
      await h.frames(page, 60);
      const b = await page.locator('section').boundingBox();
      h.expect(Math.abs(b.y - a.y) <= 1, 'Read moved after settling');
      return { oldFailure: red };
    } finally { await ctx.close(); }
  },
  async 'settled-old-tap-target-red'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes enter { from { transform:scale(.8) } to { transform:scale(1) } } button { height:44px; min-width:44px; animation:enter 1s linear both }</style><button>Brush</button>');
      await h.frames(page, 2);
      const r = await page.locator('button').boundingBox();
      let red = '';
      try { h.expect(r.width >= 44 && r.height >= 44, 'old tap-target check measured less than 44 px during the entrance'); } catch (e) { red = e.message; }
      h.expect(!!red, 'the old tap-target check unexpectedly waited for the entrance');
      await h.settled(page, 'button');
      const p = await page.locator('button').boundingBox();
      h.expect(p.width >= 44 && p.height >= 44, 'the settled tap target is less than 44 px');
      return { oldFailure: red };
    } finally { await ctx.close(); }
  },
  async 'settled-old-motion-window-red'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div>Slow scene</div>');
      await page.evaluate(() => {
        window.__fixtureFrames = 0;
        let n = 0;
        const tick = () => { if (++n % 30 === 0) window.__fixtureFrames++; window.__e2eRaf(tick); };
        window.__e2eRaf(tick);
      });
      const from = await page.evaluate(() => window.__fixtureFrames);
      await h.sleep(1500);
      const at = await page.evaluate(() => window.__fixtureFrames);
      let red = '';
      try { h.expect(at > from + 10, 'old 1.5 s motion window did not draw 11 frames'); } catch (e) { red = e.message; }
      h.expect(!!red, 'the slow-frame fixture did not expose the old motion window');
      await page.waitForFunction((from) => window.__fixtureFrames > from + 10, from, { timeout: 15000 });
      h.expect(await page.evaluate((from) => window.__fixtureFrames > from + 10, from), 'the frame-count wait did not see 11 frames');
      return { oldFailure: red };
    } finally { await ctx.close(); }
  },
  async 'settled-svg-child-scale'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes spark { to { transform:scale(2) } } path { animation:spark 29.5s }</style><section><button>One</button><svg><path d="M0 10H100" stroke="blue" /></svg></section>');
      await h.settled(page, 'section, button, svg', { timeout: 1000 });
      h.expect(await page.locator('path').evaluate((el) => el.getAnimations().some((a) => a.playState === 'running')), 'the spark ended before the boxes settled');
    } finally { await ctx.close(); }
  },
  async 'settled-descendant-height'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes grow { from { height:10px } to { height:100px } } div { animation:grow 300ms 200ms both }</style><section><div></div></section>');
      await h.settled(page, 'section');
      h.expect(await page.locator('div').evaluate((el) => el.getBoundingClientRect().height === 100), 'the descendant was still changing the measured box height');
    } finally { await ctx.close(); }
  },
  async 'settled-button-transform'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes enter { from { transform:scale(.8) } to { transform:scale(1) } } button { height:44px; animation:enter 500ms both }</style><button>Brush</button>');
      await h.settled(page, 'button');
      h.expect(await page.locator('button').evaluate((el) => el.getBoundingClientRect().height >= 44), 'the matched button was measured during its transform');
    } finally { await ctx.close(); }
  },
  async 'settled-delayed-entry'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes enter { from { transform: translateY(50px) } to { transform: translateY(0) } } button { height:44px; animation: enter 300ms 200ms both }</style><button>One</button><button style="animation-delay:400ms">Two</button>');
      await h.settled(page, 'button');
      h.expect(await page.locator('button').evaluateAll((els) => els.every((el) => el.getAnimations().every((a) => a.playState === 'finished') && el.getBoundingClientRect().height === 44)), 'a delayed entrance was measured before both buttons rested');
    } finally { await ctx.close(); }
  },
  async 'settled-ancestor-transition'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>section { transform:translateY(50px); transition:transform 300ms } section.on { transform:translateY(0) }</style><section><button>One</button></section>');
      await page.clock.install();
      await page.locator('section').evaluate((el) => { el.getBoundingClientRect(); el.classList.add('on'); });
      await h.settled(page, 'button');
      h.expect(await page.locator('section').evaluate((el) => !el.getAnimations().some((a) => a.playState === 'running')), 'the button was measured while its parent moved');
    } finally { await ctx.close(); }
  },
  async 'settled-endless-opacity'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes glow { to { opacity:.3 } } button { animation:glow 1s infinite alternate }</style><button>Glow</button>');
      await h.settled(page, 'button', { timeout: 1000 });
      h.expect(await page.locator('button').evaluate((el) => el.getAnimations().some((a) => a.playState === 'running')), 'the glow ended, so this did not test an endless animation');
    } finally { await ctx.close(); }
  },
  async 'settled-stroke-opacity'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes shine { to { stroke-opacity:.2 } } path { animation:shine 29.5s }</style><svg><path d="M0 10H100" stroke="blue" /></svg>');
      await h.settled(page, 'path', { timeout: 1000 });
      h.expect(await page.locator('path').evaluate((el) => el.getAnimations().some((a) => a.playState === 'running')), 'the shine ended, so this did not test a long paint animation');
    } finally { await ctx.close(); }
  },
  async 'settled-bob-times-out'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes bob { to { transform:translateY(50px) } } button { animation:bob 1s infinite alternate linear }</style><button id="moving">Bob</button>');
      let message = '';
      try { await h.settled(page, '#moving', { timeout: 300 }); } catch (e) { message = e.message; }
      h.expect(/#moving.*did not settle/.test(message) && /bob/.test(message) && /transform/.test(message) && /before.*after/.test(message), `the timeout did not name the moving target and animation: ${message}`);
    } finally { await ctx.close(); }
  },
};
