// The harness waits for layout to rest, including delayed entrances and animated parents, without waiting on paint, and
// counts its deadline in the time the page could run.

/** A timeout naming `target` and its bob, either moving (its box before and after) or, on a slow compositor, still
 *  waiting to start. */
const namesBob = (message, target) => new RegExp(`${target}.*did not settle`).test(message) && /bob/.test(message) && /transform/.test(message) && (/before.*after/.test(message) || /"started":false/.test(message));

export const scenarios = {
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
      await h.pauseClock(page);
      const paused = await page.evaluate(() => Date.now());
      await page.locator('section').evaluate((el) => { el.getBoundingClientRect(); el.classList.add('on'); });
      await h.settled(page, 'button');
      h.expect(await page.locator('section').evaluate((el) => !el.getAnimations().some((a) => a.playState === 'running')), 'the button was measured while its parent moved');
      await h.frames(page, 2);
      h.expect(await page.evaluate(() => Date.now()) === paused, 'the frame wait resumed the paused page clock');
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
      try { await h.settled(page, '#moving', { timeout: 1000 }); } catch (e) { message = e.message; }
      h.expect(namesBob(message, '#moving'), `the timeout did not name the moving target and animation: ${message}`);
    } finally { await ctx.close(); }
  },
  // a page frozen mid-entrance for longer than the deadline settles all the same once it runs again
  async 'settled-waits-out-a-freeze'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes enter { from { transform:translateY(50px) } to { transform:translateY(0) } } button { height:44px; animation:enter 800ms both }</style><button>One</button>');
      await page.evaluate(() => void setTimeout(() => {
        const end = performance.now() + 3000;
        while (performance.now() < end);
      }, 200));
      const after = await h.settled(page, 'button', { timeout: 2000 }).then(() => 'settled', (e) => e.message);
      h.expect(after === 'settled', `a page frozen mid-entrance past the deadline, which came to rest soon after, failed: ${after}`);
    } finally { await ctx.close(); }
  },
  // an endless bob holds still until it starts, in its delay here, and on CI for the frames a new animation waits to
  // start on a slow compositor: two still frames then must not pass for rest
  async 'settled-bob-waits-to-start'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<style>@keyframes bob { to { transform:translateY(50px) } } button { animation:bob 1s 500ms infinite alternate linear }</style><button id="waiting">Bob</button>');
      let message = '';
      try { await h.settled(page, '#waiting', { timeout: 1500 }); } catch (e) { message = e.message; }
      h.expect(namesBob(message, '#waiting'), `a bob still waiting to start passed for rest: ${message}`);
    } finally { await ctx.close(); }
  },
};
