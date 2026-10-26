// The eraser on the real drawing page: one pass of the same size takes a soft-glow line away completely, its light
// too; on a busy page (150 soft-glow lines, a phone-speed CPU) it keeps up with the finger; and what the page shows
// while erasing is what a fresh render of the drawing shows.
import { drawPage, pick } from './art-eraser-glow.e2e.mjs';

/** One mouse stroke through points given as fractions of the page. */
async function path(page, pts, steps = 14) {
  const box = await page.locator('.dq-ink-live').boundingBox();
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  await page.mouse.move(...at(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...at(p), { steps });
  await page.mouse.up();
}

/** The brightest pixel (r + g + b, or alpha for the ink layer) of a canvas in a box of logical page px. */
const brightest = (page, sel, box, alpha) =>
  page.evaluate(([sel, box, alpha]) => {
    const c = typeof sel === 'string' ? document.querySelector(sel) : window.__daily.ink.render(1200);
    const k = c.width / 1200;
    const [x0, y0, x1, y1] = box.map((v) => Math.round(v * k));
    const d = c.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let top = 0;
    for (let i = 0; i < d.length; i += 4) top = Math.max(top, alpha ? d[i + 3] : d[i] + d[i + 1] + d[i + 2]);
    return top;
  }, [sel, box, alpha]);

/** n soft-glow lines in every ink and size over the whole page, the same every run. */
function busyPage(n) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, (_, k) => {
    const p = [];
    let x = 80 + rnd() * 1040, y = 80 + rnd() * 1440;
    const a = rnd() * Math.PI * 2;
    for (let j = 0; j < 32; j++) {
      p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      x += Math.cos(a + j * 0.12) * 12;
      y += Math.sin(a + j * 0.12) * 12;
    }
    return { i: k % 5, w: [10.8, 25.2, 60][k % 3], p, m: 'glow' };
  });
}

export const scenarios = {
  async 'art-eraser-takes-a-glow-line-away'(h) {
    const { expect } = h;
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    await drawPage(h, page);
    const w = await page.evaluate(() => window.__daily.ink.W * 0.021);
    // the band a glow line at half height lights, edge to edge
    const band = [300, 800 - 3 * w, 900, 800 + 3 * w];
    const blank = await brightest(page, null, band);
    await pick(page, 'Soft glow');
    await path(page, [[0.2, 0.5], [0.8, 0.5]]);
    expect((await brightest(page, '.dq-ink-ink', band, true)) > 200, 'the soft-glow line did not draw');
    await pick(page, 'Eraser');
    await path(page, [[0.12, 0.5], [0.88, 0.5]]);
    expect(JSON.stringify(await page.evaluate(() => window.__daily.ink.strokes.map((s) => s.m ?? 'brush'))) === '["glow","erase"]', 'the eraser stroke was not kept');
    const ink = await brightest(page, '.dq-ink-ink', band, true);
    const light = await brightest(page, '.dq-ink-halo', band);
    const saved = await brightest(page, null, band);
    await h.shot(page, 'glow-erased-390x844');
    expect(ink <= 2, `one same-size eraser pass left the soft-glow line's edges on the page (ink alpha ${ink})`);
    expect(light <= 3, `one same-size eraser pass left the soft-glow line's light on the page (brightness ${light})`);
    expect(saved <= blank + 3, `the saved drawing still shows the erased soft-glow line (brightness ${saved}, blank page ${blank})`);
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'art-eraser-keeps-up-on-a-busy-page'(h) {
    const { expect } = h;
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    await drawPage(h, page);
    await page.evaluate((s) => window.__daily.ink.load(s), busyPage(150));
    await pick(page, 'Eraser');
    await pick(page, 'Bold size');
    const cdp = await ctx.newCDPSession(page);
    const from = await page.evaluate(() => window.__daily.ink.frames.length);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // one long stroke sweeping the page three times, as a player clearing a corner of a busy drawing would
    await path(page, [[0.1, 0.15], [0.9, 0.3], [0.1, 0.5], [0.9, 0.7], [0.1, 0.85]], 30);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const f = (await page.evaluate((n) => window.__daily.ink.frames.slice(n), from)).sort((a, b) => a - b);
    const q = (k) => f[Math.min(f.length - 1, Math.floor(f.length * k))];
    const took = { frames: f.length, median: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), max: +f[f.length - 1].toFixed(1) };
    console.log('eraser frame work at 4x CPU slowdown, ms:', JSON.stringify(took));
    // what the page showed when the finger lifted is what a fresh render of the drawing shows
    const off = await page.evaluate(() => {
      const pad = window.__daily.ink;
      // read from copies: a canvas read back is drawn on the CPU from then on, and its redraw would differ in the last bit
      const grab = () => ['.dq-ink-ink', '.dq-ink-halo'].map((s) => {
        const c = document.querySelector(s), d = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height });
        d.getContext('2d').drawImage(c, 0, 0);
        return d.getContext('2d').getImageData(0, 0, d.width, d.height).data;
      });
      const live = grab();
      pad.redraw();
      const fresh = grab();
      return live.map((d, k) => {
        let n = 0, top = 0;
        for (let i = 0; i < d.length; i++) {
          const e = Math.abs(d[i] - fresh[k][i]);
          if (e > 6) n++;
          top = Math.max(top, e);
        }
        return { share: n / d.length, top };
      });
    });
    await h.shot(page, 'busy-erased-390x844');
    expect(f.length >= 20, `the eraser drew only ${f.length} frames`);
    expect(took.p90 <= 12, `erasing on a busy page stutters at 4x CPU slowdown: ${JSON.stringify(took)}`);
    expect(off.every((o) => o.share < 0.002), `while erasing the page showed something other than the drawing it keeps: ${JSON.stringify(off)}`);
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
