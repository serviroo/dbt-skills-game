// The soft-glow brush is a light at every size: a thin bright core in a halo that fades smoothly away from it, with no
// flat band of colour and no hard edge around the line (DESIGN.md: a tight bright core plus a wide soft halo).
import { drawPage } from './art-eraser-glow.e2e.mjs';

const SIZES = { Medium: 25.2, Bold: 60 };
const INKS = ['Ice', 'Lantern blue', 'Violet glow', 'Mint', 'Shadow'];

/** Brightness (r + g + b) of the saved drawing at 1200 px, from the middle of a level line at y 800 down 300 px. */
const profile = (page, strokes) =>
  page.evaluate((strokes) => {
    const pad = window.__daily.ink;
    pad.load(strokes);
    const d = pad.render(1200).getContext('2d').getImageData(600, 800, 1, 301).data;
    return Array.from({ length: 301 }, (_, k) => d[k * 4] + d[k * 4 + 1] + d[k * 4 + 2]);
  }, strokes);

export const scenarios = {
  async 'art-glow-falls-off-softly'(h) {
    const { expect } = h;
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    await drawPage(h, page);
    const blank = await profile(page, []);
    const seen = {};
    for (const [size, w] of Object.entries(SIZES))
      for (const [i, ink] of INKS.entries()) {
        const at = await profile(page, [{ i, w, p: [200, 800, 400, 800, 600, 800, 800, 800, 1000, 800], m: 'glow' }]);
        // the light alone, from just outside the core outward
        const light = at.map((v, d) => v - blank[d]);
        const from = Math.ceil(Math.max(1.4, w * 0.26) / 2 + 2);
        const top = light[from];
        // the steepest fall over a tenth of the line's width: a glow fades, a band has an edge
        const step = Math.ceil(w * 0.1);
        let fall = 0;
        for (let d = from; d + step <= 300; d++) fall = Math.max(fall, light[d] - light[d + step]);
        // how much light is left a third of the line's width further out: a glow is already fading there
        const held = light[from + Math.round(w * 0.3)] / top;
        seen[`${ink} ${size}`] = { top, fall: +(fall / top).toFixed(3), held: +held.toFixed(3), step, out: Math.round(w * 0.3) };
      }
    console.log('soft glow light outward from the core:', JSON.stringify(seen));
    for (const [name, { top, fall, held, step, out }] of Object.entries(seen)) {
      expect(top >= 120, `the ${name} soft glow has almost no light around its core (${top})`);
      expect(fall <= 0.18, `the ${name} soft glow has a hard edge: its light falls ${Math.round(fall * 100)}% within ${step} px`);
      expect(held <= 0.9, `the ${name} soft glow is a flat band: ${Math.round(held * 100)}% of its light is left ${out} px further out`);
    }
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
