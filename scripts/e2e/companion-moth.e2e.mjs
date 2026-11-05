import sharp from 'sharp';
import { screenshot } from './harness.mjs';

const SIZES = { 390: { width: 390, height: 844 }, 320: { width: 320, height: 568 } };
const FOLDED = 1.45;
const REST = 0.14;
const REWARDS = '?lab=window&kind=rewards&mute';

const card = (page) => page.locator('.rw-card', { hasText: 'Epic companion' });
const state = (page) =>
  page.evaluate(() => ({
    scenes: window.__scenes ? JSON.parse(JSON.stringify(window.__scenes)) : null,
    moth: window.__moth ? { builds: window.__moth.builds, disposed: window.__moth.disposed } : null,
    canvases: document.querySelectorAll('.dq-scene canvas').length,
  }));

export async function mothOnCard(h, page, where) {
  await card(page).locator('.em.is-scene-live').waitFor({ timeout: 30000 }).catch(async () => {
    await h.shot(page, `fail-${where}`);
    throw new Error(`${where}: the 3D moth never came on its card`);
  });
  const s = await state(page);
  const live = s.scenes.last.kind === 'moth' && s.scenes.live === 1;
  h.expect(live, `${where}: the moth is not live (${JSON.stringify(s)})`);
  return s.scenes.last.probe;
}

export async function mothGone(h, page, where) {
  const gone = (n) => n.scenes.live === 0 && n.canvases === 0 && n.moth.disposed === n.moth.builds;
  await h.poll(page, () => state(page), gone, (n) => `${where}: the moth was left behind (${JSON.stringify(n)})`, {
    timeout: 8000,
  });
}

async function shown(h, page, where) {
  const em = card(page).locator('.em');
  const opacity = () => em.locator('.dq-scene').evaluate((e) => Number(getComputedStyle(e).opacity));
  await h.poll(page, opacity, (o) => o >= 0.99, `${where}: the moth never finished fading in`, { timeout: 5000 });
  const drawing = () => em.locator('svg.dq-scene-flat').evaluate((e) => getComputedStyle(e).visibility);
  const hidden = (v) => v === 'hidden';
  await h.poll(page, drawing, hidden, `${where}: the drawing still shows over the moth`, { timeout: 3000 });
}

const luma = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
const raw = async (png) => sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });

async function pixels(page) {
  const { data, info } = await raw(await screenshot(card(page).locator('.dq-scene')));
  const { width: w, height: ht, channels: c } = info;
  let n = 0, sum = 0, sq = 0, max = 0;
  for (let y = Math.floor(ht * 0.15); y < ht * 0.85; y++) {
    for (let x = Math.floor(w * 0.15); x < w * 0.85; x++) {
      const l = luma(data, (y * w + x) * c);
      n++, (sum += l), (sq += l * l), (max = Math.max(max, l));
    }
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(1), max: Math.round(max) };
}

async function seamless(h, page, where) {
  const c = card(page);
  const [box, em] = await Promise.all([c.boundingBox(), c.locator('.em').boundingBox()]);
  const { data, info } = await raw(await screenshot(c));
  const k = info.width / box.width;
  const pixel = (x, y) => Math.round((y - box.y) * k) * info.width + Math.round((x - box.x) * k);
  const at = (x, y) => luma(data, pixel(x, y) * info.channels);
  const [left, right, top, bottom] = [em.x, em.x + em.width, em.y + 3, em.y + em.height - 3];
  const gaps = [[left, top, -1], [right, top, 1], [left, bottom, -1], [right, bottom, 1]].map(
    ([x, y, out]) => +(at(x + out * 3, y) - at(x - out * 3, y)).toFixed(1),
  );
  h.expect(gaps.every((g) => Math.abs(g) < 6), `${where}: the moth's window shows as a square (${gaps})`);
  const edge = (x) => Math.max(...Array.from({ length: Math.floor(em.height) - 6 }, (_, i) => at(x, em.y + 3 + i)));
  const beside = Math.max(at(left - 3, em.y + em.height / 2), at(right + 3, em.y + em.height / 2));
  const sides = [edge(left + 1), edge(right - 1)];
  const whole = sides.every((l) => l < beside + 25);
  h.expect(whole, `${where}: the moth is cut off at its window's side (${sides}, ${beside})`);
}

export const scenarios = {
  async 'companion-moth'(h) {
    for (const [tag, vp] of Object.entries(SIZES)) {
      const { ctx, page, errors } = await h.open({}, REWARDS, vp);
      const lifts = [await mothOnCard(h, page, tag)];
      await seamless(h, page, `${tag}, fading in`);
      const probe = async () => (lifts.push((await state(page)).scenes.last.probe), lifts.at(-1));
      await h.poll(page, probe, (p) => p.e > 3.2, `${tag}: the moth never finished waking`, { timeout: 15000 });
      const early = lifts.filter((p) => p.e < 0.6);
      const asleep = early.length && early.every((p) => p.lift > FOLDED - 0.15);
      h.expect(asleep, `${tag}: the moth was not met asleep, its wings folded (${JSON.stringify(lifts.slice(0, 4))})`);
      h.expect(lifts.at(-1).lift < REST + 0.2, `${tag}: the wings never opened (${lifts.map((p) => p.lift)})`);
      await shown(h, page, tag);
      await seamless(h, page, `${tag}, awake`);
      const a = (await state(page)).scenes.last.probe;
      const later = (p) => p.e - a.e > 1.5;
      const b = await h.poll(page, probe, later, `${tag}: the awake moth stopped drawing`, { timeout: 10000 });
      const breathing = Math.abs(b.lift - REST) < 0.08 && b.lift !== a.lift && b.antenna !== a.antenna;
      h.expect(breathing, `${tag}: the awake moth is not breathing at rest (${JSON.stringify([a, b])})`);
      h.expect(b.antennaeAbove > 0.08, `${tag}: the antennae barely show above the head (${b.antennaeAbove})`);
      const p = await pixels(page);
      h.expect(p.sd > 10 && p.max > 140 && p.mean > 8, `${tag}: the moth looks blank (${JSON.stringify(p)})`);
      const s = await state(page);
      h.expect(s.scenes.contexts === 1 && s.canvases === 1, `${tag}: more than one context or canvas for the moth`);
      await h.shot(card(page), `companion-moth-${tag}`);
      await h.shot(page, `companion-moth-cards-${tag}`);
      await page.getByRole('button', { name: 'Read the note' }).click();
      await mothGone(h, page, `${tag}, Read the note`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'companion-moth-still'(h) {
    for (const [tag, vp] of Object.entries(SIZES)) {
      const { ctx, page, errors } = await h.open({}, REWARDS + '&reduced', vp);
      await mothOnCard(h, page, `still ${tag}`);
      await shown(h, page, `still ${tag}`);
      await page.waitForFunction(() => window.__scenes?.last.still, null, { timeout: 15000 });
      const a = (await state(page)).scenes;
      await h.frames(page, 60);
      const b = (await state(page)).scenes;
      h.expect(b.frames === a.frames && b.last.still, `still ${tag}: the moth kept drawing (${a.frames}, ${b.frames})`);
      const awake = Math.abs(b.last.probe.lift - REST) < 0.08;
      h.expect(awake, `still ${tag}: the moth is not awake at rest (${JSON.stringify(b.last.probe)})`);
      const p = await pixels(page);
      h.expect(p.sd > 10 && p.max > 140, `still ${tag}: the moth looks blank (${JSON.stringify(p)})`);
      await h.shot(card(page), `companion-moth-still-${tag}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'companion-moth-no-webgl'(h) {
    const { ctx, page, errors } = await h.open({}, REWARDS, SIZES[390]);
    await ctx.addInitScript(() => delete window.WebGL2RenderingContext);
    await page.reload();
    const drawing = card(page).locator('.em svg');
    await drawing.waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Read the note' }).waitFor({ state: 'visible', timeout: 15000 });
    await h.settled(page, '.rw-card');
    const s = await state(page);
    const visible = await drawing.evaluate((e) => {
      const st = getComputedStyle(e);
      return st.visibility !== 'hidden' && Number(st.opacity) > 0.9;
    });
    const none = s.canvases === 0 && !(s.scenes?.live > 0);
    h.expect(visible && none, `no WebGL: the drawing is hidden or a scene left (${JSON.stringify({ visible, s })})`);
    await h.shot(card(page), 'companion-moth-no-webgl');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
