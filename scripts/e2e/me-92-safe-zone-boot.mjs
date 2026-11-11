import { installAudioRecorder, audioReady } from './audio-recorder.mjs';

export async function boot(h, {
  save, viewport = { width: 390, height: 844 }, reduced = false, ua, extra = {},
  init, live = false, keepWelcome = false, prepare,
} = {}) {
  const ctx = await h.browser.newContext({
    viewport, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'en-US',
    reducedMotion: reduced ? 'reduce' : 'no-preference', ...(ua ? { userAgent: ua } : {}),
  });
  if (prepare) await prepare(ctx);
  if (init) {
    await installAudioRecorder(ctx);
    await ctx.addInitScript(init);
  }
  const seed = {
    [h.YOU]: JSON.stringify({
      name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000,
    }),
    'dbt.app.v1': h.SEEN, ...(save ? { [h.SAVE]: save } : {}), ...extra,
  };
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) &&
    errors.push('console: ' + m.text().slice(0, 300)));
  await page.goto(h.server.url + '/');
  if (keepWelcome) {
    await page.waitForFunction(() => {
      const tile = document.querySelector('.dq-tile');
      return window.__daily?.route.name === 'hub' && window.__daily.greeting && tile?.getClientRects().length &&
        getComputedStyle(tile).visibility !== 'hidden';
    }, null, { timeout: 60000 });
  } else await h.reachHub(page);
  if (init) await audioReady(page);
  await page.evaluate((live) => {
    const a = window.__daily;
    window.__cues = [];
    window.__tries = [];
    const play = a.opts.sound?.play;
    if (play)
      a.opts.sound.play = (c) => {
        window.__cues.push([a.route.name, c]);
        if (live) play(c);
      };
    if (live) {
      const sound = a.sound.bind(a);
      a.sound = (c) => {
        window.__tries.push([a.route.name, c]);
        sound(c);
      };
    }
  }, live);
  return { ctx, page, errors };
}
