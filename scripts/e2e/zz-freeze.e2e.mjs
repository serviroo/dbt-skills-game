// CI proof only: what blocks the page after the name prompt closes
const probe = () => {
  const P = (window.__p = { long: [], gl: {}, removed: null, marks: {} });
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => P.long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask' }); } catch {}
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    for (const k of ['getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'linkProgram', 'compileShader', 'drawElements', 'drawArrays', 'texImage2D', 'readPixels', 'getError', 'clear', 'bufferData']) {
      const f = C.prototype[k];
      if (!f) continue;
      C.prototype[k] = function (...a) {
        const t = performance.now();
        const r = f.apply(this, a);
        const d = performance.now() - t;
        const s = (P.gl[k] ??= { n: 0, ms: 0, max: 0, after: 0 });
        s.n++; s.ms += d; s.max = Math.max(s.max, d);
        if (P.marks.click && t > P.marks.click) s.after += d;
        return r;
      };
    }
  }
  new MutationObserver(() => {
    if (P.marks.click && !P.removed && !document.querySelector('#np-name')) P.removed = performance.now();
  }).observe(document.documentElement, { childList: true, subtree: true });
};
const report = (p) => p.evaluate(() => {
  const P = window.__p, c = P.marks.click;
  const gl = Object.fromEntries(Object.entries(P.gl).filter(([, s]) => s.after > 50).map(([k, s]) => [k, `${Math.round(s.after)}ms max ${Math.round(s.max)}`]));
  const g = document.createElement('canvas').getContext('webgl2');
  return JSON.stringify({
    removedAfterMs: P.removed ? Math.round(P.removed - c) : null,
    longAfterClick: P.long.filter(([s, d]) => s + d > c).map(([s, d]) => `${s - Math.round(c)}+${d}`).slice(0, 12),
    glAfterClick: gl,
    parallelCompile: !!g?.getExtension('KHR_parallel_shader_compile'),
    res: performance.getEntriesByType('resource').filter((r) => /director|hero\.glb|world/.test(r.name) && r.startTime > c).map((r) => `${r.name.split('/').pop().slice(0, 24)}@${Math.round(r.startTime - c)}+${Math.round(r.duration)}`),
  });
});
export const scenarios = {
  async 'two-prompts-freeze'({ server, open, sleep }) {
    const { ctx, page: a } = await open();
    await ctx.addInitScript(probe);
    await a.reload();
    const b = await ctx.newPage();
    await b.goto(server.url + '/?mute');
    for (const p of [a, b]) {
      await sleep(2500);
      await p.mouse.click(195, 500);
      await p.locator('#np-name').waitFor({ timeout: 15000 });
    }
    await a.locator('#np-name').fill('Robin');
    await a.locator('#np-comp').fill('Pip');
    await a.evaluate(() => (window.__p.marks.click = performance.now()));
    await a.getByRole('button', { name: 'Continue' }).click();
    const t = Date.now();
    const ok = await a.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
    const seen = Date.now() - t;
    await a.locator('#np-name').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
    await sleep(15000);
    console.log(`FREEZE ${ok ? 'ok' : 'FAILED'} test saw it gone after ${seen} ms: ${await report(a)}`);
    await ctx.close();
  },
};
