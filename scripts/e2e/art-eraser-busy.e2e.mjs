// The eraser on the real drawing page: one pass of the same size takes a soft-glow line away completely, its light
// too; on a busy page (150 soft-glow lines, a phone-speed CPU) it keeps up with the finger; and what the page shows
// while erasing is what a fresh render of the drawing shows.
import { drawPage, pick } from './art-eraser-glow.e2e.mjs';

/** One mouse stroke through points given as fractions of the page (the finger still down when up is false). */
async function path(page, pts, steps = 14, up = true) {
  const box = await page.locator('.dq-ink-live').boundingBox();
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  await page.mouse.move(...at(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...at(p), { steps });
  if (up) await page.mouse.up();
}

/** Keeps copies of the ink and light layers' pixels in the page (copies: a canvas read back draws on the CPU after). */
const keepLayers = (page, name) =>
  page.evaluate((name) => {
    window[name] = ['.dq-ink-ink', '.dq-ink-halo'].map((s) => {
      const c = document.querySelector(s), d = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height });
      d.getContext('2d').drawImage(c, 0, 0);
      return { w: d.width, h: d.height, d: d.getContext('2d').getImageData(0, 0, d.width, d.height).data };
    });
  }, name);

/**
 * How the two kept copies differ, per layer: the share of values (colour times alpha, as they land on the page) that
 * are off. One is off when it is more than 32 from the other's at that pixel and outside what the other has within one
 * pixel of it. A renderer may smooth the same edge with 8 samples in one batch and exactly in another (a step of 32),
 * and its blur may differ a little with the size of the canvas it works on; a cut left out or made twice, ink left at
 * the edge of a box, or light left on is far more than that.
 */
const offBetween = (page, a, b) =>
  page.evaluate(([a, b]) => {
    const flat = (d) => {
      const o = new Uint8ClampedArray(d.length);
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) o[i + c] = Math.round((d[i + c] * d[i + 3]) / 255);
        o[i + 3] = d[i + 3];
      }
      return o;
    };
    return window[a].map(({ w, h, d }, k) => {
      const x = flat(d), y = flat(window[b][k].d);
      const within = (d, px, py, c, v) => {
        let lo = 255, hi = 0;
        for (let j = Math.max(0, py - 1); j <= Math.min(h - 1, py + 1); j++)
          for (let i = Math.max(0, px - 1); i <= Math.min(w - 1, px + 1); i++) {
            const u = d[(j * w + i) * 4 + c];
            lo = Math.min(lo, u);
            hi = Math.max(hi, u);
          }
        return v >= lo - 6 && v <= hi + 6;
      };
      let n = 0, top = 0;
      for (let py = 0; py < h; py++)
        for (let px = 0; px < w; px++)
          for (let c = 0; c < 4; c++) {
            const i = (py * w + px) * 4 + c, e = Math.abs(x[i] - y[i]);
            top = Math.max(top, e);
            if (e > 32 && !(within(y, px, py, c, x[i]) && within(x, px, py, c, y[i]))) n++;
          }
      return { share: +(n / x.length).toFixed(6), top };
    });
  }, [a, b]);

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

/**
 * Starts a trace of the page and marks the page's clock in it, so a frame's time on that clock is found in the trace
 * (see cpuTimes). Returns the mark's time on the page's clock.
 */
async function traceFrom(ctx, page) {
  await ctx.browser().startTracing(page, { categories: ['devtools.timeline', 'blink.user_timing'] });
  return page.evaluate(() => performance.mark('eraser-clock').startTime);
}

/**
 * Ends the trace and gives, for each frame ([began, took] in ms on the page's clock), the CPU time of the page's main
 * thread in the animation frame that ran it: its own work, not time it waited. On a runner without a GPU the browser
 * draws the canvases on the CPU too, on the same few cores (a phone draws them on its GPU), and the browser's CPU
 * slowdown counted the main thread's wait for a core 4 times over as its work. NaN for a frame not found.
 */
async function cpuTimes(ctx, clock, frames) {
  const ev = JSON.parse(String(await ctx.browser().stopTracing())).traceEvents;
  const mark = ev.find((e) => e.name === 'eraser-clock');
  if (!mark) return frames.map(() => NaN);
  const off = mark.ts - clock * 1000;
  const fire = ev.filter((e) => e.ph === 'X' && e.name === 'FireAnimationFrame' && e.pid === mark.pid && e.tid === mark.tid && e.tdur !== undefined);
  // the frame the eraser's work overlaps most: the page's clock is coarse, so a neighbour may touch its edges
  return frames.map(([at, took]) => {
    const a = at * 1000 + off, b = a + took * 1000;
    let best = null, most = 0;
    for (const e of fire) {
      const o = Math.min(b, e.ts + e.dur) - Math.max(a, e.ts);
      if (o > most) [best, most] = [e, o];
    }
    return best ? best.tdur / 1000 : NaN;
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
    const from = await page.evaluate(() => window.__daily.ink.frames.length);
    const clock = await traceFrom(ctx, page);
    // one long stroke sweeping the page three times, as a player clearing a corner of a busy drawing would; the page is
    // read while the finger is still down, so it is the eraser's own drawing as it goes, not the page kept after
    await path(page, [[0.1, 0.15], [0.9, 0.3], [0.1, 0.5], [0.9, 0.7], [0.1, 0.85]], 30, false);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const frames = await page.evaluate((n) => window.__daily.ink.frames.slice(n), from);
    // a CPU 4 times slower than this one takes 4 times its CPU time
    const f = (await cpuTimes(ctx, clock, frames)).map((t) => t * 4).sort((a, b) => a - b);
    const q = (k) => f[Math.min(f.length - 1, Math.floor(f.length * k))];
    const took = { frames: f.length, median: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), max: +f[f.length - 1].toFixed(1) };
    const wall = frames.map(([, t]) => t).sort((a, b) => a - b);
    console.log('eraser frame work at 4x CPU slowdown, ms:', JSON.stringify(took), 'on the wall here, at 1x:', JSON.stringify({ median: +wall[wall.length >> 1].toFixed(1), p90: +wall[Math.floor(wall.length * 0.9)].toFixed(1) }));
    await keepLayers(page, '__live');
    await page.mouse.up();
    await page.evaluate(() => window.__daily.ink.redraw());
    await keepLayers(page, '__fresh');
    // what the page showed while erasing is what a fresh render of the drawing shows
    const off = await offBetween(page, '__live', '__fresh');
    await h.shot(page, 'busy-erased-390x844');
    expect(f.length >= 20, `the eraser drew only ${f.length} frames`);
    expect(f.every(Number.isFinite), `an eraser frame is missing from the trace: ${JSON.stringify(f)}`);
    expect(took.p90 <= 12, `erasing on a busy page stutters at 4x CPU slowdown: ${JSON.stringify(took)}`);
    expect(off.every((o) => o.share < 0.0005), `while erasing the page showed something other than the drawing it keeps: ${JSON.stringify(off)}`);
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
