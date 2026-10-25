// CI proof only: two-prompts with a trace of frames, clicks and the window when the prompt stays open
const trace = () => {
  window.__t = { frames: [], clicks: [] };
  const raf = requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    const L = window.__t.frames;
    if (L[L.length - 1] !== t) L.push(t);
    if (L.length > 6000) L.splice(0, 3000);
    cb(t);
  });
  addEventListener('click', (e) => window.__t.clicks.push([performance.now(), (e.target?.textContent ?? '').trim().slice(0, 10)]), true);
};
const mark = (p) => p.evaluate(() => ({ at: performance.now(), stage: window.__stage?.time ?? null }));
const state = (p, m) => p.evaluate((m) => {
  const f = window.__t.frames.filter((t) => t >= m.at);
  const gaps = f.slice(1).map((t, i) => Math.round(t - f[i]));
  const sw = document.querySelector('.sw');
  const anims = (el) => (el ? el.getAnimations().map((a) => `${a.playState}:${Math.round(a.currentTime ?? -1)}/${Math.round(a.effect.getComputedTiming().endTime)}`) : null);
  return JSON.stringify({
    pageSec: +((performance.now() - m.at) / 1000).toFixed(2),
    stageSec: window.__stage ? +(window.__stage.time - m.stage).toFixed(3) : null,
    frames: f.length,
    firstFrameAfterMs: f.length ? Math.round(f[0] - m.at) : null,
    gaps: gaps.slice(0, 40),
    clicks: window.__t.clicks.filter((c) => c[0] >= m.at - 50).map((c) => [Math.round(c[0] - m.at), c[1]]),
    you: localStorage.getItem('dbt.you.v1'),
    win: sw ? { opacity: getComputedStyle(sw).opacity, root: anims(sw), tilt: anims(sw.querySelector('.sw-tilt')) } : 'gone',
  });
}, m);

export const scenarios = {
  async 'two-prompts-trace'({ server, open, sleep, youOf, expect }) {
    const { ctx, page: a, errors } = await open();
    await ctx.addInitScript(trace);
    await a.reload();
    const b = await ctx.newPage();
    b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
    await b.goto(server.url + '/?mute');
    for (const p of [a, b]) {
      await sleep(2500);
      await p.mouse.click(195, 500);
      await p.locator('#np-name').waitFor({ timeout: 15000 });
    }
    await a.locator('#np-name').fill('Robin');
    await a.locator('#np-comp').fill('Pip');
    const closes = async (p, label, btn, other) => {
      const m = await mark(p);
      const mo = await mark(other);
      await p.getByRole('button', { name: btn }).click();
      const ok = await p.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
      if (!ok) {
        console.log(`TRACE ${label} stayed open: ${await state(p, m)}`);
        console.log(`TRACE other tab meanwhile: ${await state(other, mo)}`);
        const later = await p.locator('#np-name').waitFor({ state: 'detached', timeout: 30000 }).then(() => true, () => false);
        console.log(`TRACE ${label} ${later ? 'closed later' : 'still open 30 s later'}: ${await state(p, m)}`);
        throw new Error(`${label}: prompt still open 10 s after ${btn}`);
      }
    };
    await closes(a, 'A', 'Continue', b);
    await sleep(300);
    await closes(b, 'B', 'Skip', a);
    for (const p of [a, b]) {
      const you = await youOf(p);
      expect(you?.name === 'Robin' && you?.companion === 'Pip', 'a Skip erased the chosen names: ' + JSON.stringify(you));
    }
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
