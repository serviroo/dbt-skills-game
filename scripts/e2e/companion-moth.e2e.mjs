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

async function grain(page) {
  return page.evaluate(async () => {
    const s = window.__stage;
    const gl = s.renderer.getContext();
    const pass = s.composer.passes.at(-1);
    const scale = pass.timeScale;
    const time = pass.fullscreenMaterial.time;
    let grainFrame = 0;
    pass.timeScale = 0;
    const off = s.onUpdate(() => { pass.fullscreenMaterial.time = 0.5 + grainFrame++ / 60; });
    const sample = async () => {
      await new Promise((done) => requestAnimationFrame(done));
      const pixels = new Uint8Array(s.canvas.width * s.canvas.height * 4);
      gl.readPixels(0, 0, s.canvas.width, s.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    try {
      let previous = await sample();
      let changed = 0;
      let samples = 0;
      for (let frame = 0; frame < 3; frame++) {
        const next = await sample();
        for (let i = 0; i < next.length; i++) {
          if (i % 4 === 3) continue;
          changed += Number(previous[i] !== next[i]);
          samples++;
        }
        previous = next;
      }
      return changed / samples;
    } finally {
      off();
      pass.timeScale = scale;
      pass.fullscreenMaterial.time = time;
    }
  });
}

export const scenarios = {
  async 'companion-moth-backdrop-rests'(h) {
    const { ctx, page, errors } = await h.open({}, REWARDS + '&reduced&dpr=1', SIZES[390]);
    await mothOnCard(h, page, 'backdrop');
    await shown(h, page, 'backdrop');
    await page.evaluate(() => {
      const s = window.__stage;
      const counts = window.__backdropCounts = { scenes: 0, blooms: 0 };
      const render = s.renderer.render.bind(s.renderer);
      s.renderer.render = (scene, camera) => {
        if (scene === s.scene) counts.scenes++;
        return render(scene, camera);
      };
      const blur = s.bloom.mipmapBlurPass;
      const bloom = blur.render.bind(blur);
      blur.render = (...args) => {
        counts.blooms++;
        return bloom(...args);
      };
    });
    const backdrop = () => page.evaluate(() => ({
      ...window.__backdropCounts,
      time: window.__stage.time,
      width: document.getElementById('gl').width,
      height: document.getElementById('gl').height,
      lost: window.__stage.lost,
    }));
    const a = await backdrop();
    await h.frames(page, 60);
    const b = await backdrop();
    h.expect(b.time > a.time, 'the rewards clock stopped with its backdrop');
    const stillGrain = await grain(page);
    await page.evaluate(() => { window.__stage.sceneStill = false; });
    const movingGrain = await grain(page);
    h.expect(stillGrain > 0.2 && Math.abs(stillGrain - movingGrain) < 0.03,
      `the rested grain changed ${stillGrain}, continuous rendering changed ${movingGrain}`);
    h.expect(b.scenes === a.scenes && b.blooms === a.blooms,
      `the unchanged rewards backdrop kept drawing (${JSON.stringify([a, b])}; grain ${stillGrain}, ${movingGrain})`);
    const beforeStill = await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => {
      const counts = { ...window.__backdropCounts };
      window.__stage.sceneStill = true;
      done(counts);
    })));
    const still = await h.poll(page, backdrop,
      (s) => s.scenes > beforeStill.scenes && s.blooms > beforeStill.blooms,
      'the rewards scene never resumed');
    h.expect(still.scenes === beforeStill.scenes + 1 && still.blooms === beforeStill.blooms + 1,
      'the resumed rewards backdrop did not render its expensive passes once');
    await h.frames(page, 1);
    await page.setViewportSize(SIZES[320]);
    const resized = await h.poll(page, backdrop,
      (s) => s.scenes > still.scenes && s.width !== still.width && s.height !== still.height,
      'the rewards backdrop did not redraw at its new size');
    h.expect(resized.scenes === still.scenes + 1 && resized.blooms === still.blooms + 1,
      'the resized rewards backdrop did not render its expensive passes once');
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await h.frames(page, 60);
    const c = await backdrop();
    h.expect(c.scenes === resized.scenes && c.blooms === resized.blooms,
      'the unchanged-size rewards backdrop redrew');
    h.expect(await grain(page) > 0.2, 'the resized rewards backdrop lost its grain');
    await shown(h, page, 'resized backdrop');
    await page.evaluate(() => {
      window.__backdropContext = window.__stage.renderer.getContext().getExtension('WEBGL_lose_context');
      window.__backdropContext.loseContext();
    });
    await page.waitForFunction(() => window.__stage.lost);
    await page.evaluate(() => window.__backdropContext.restoreContext());
    const restored = await h.poll(page, backdrop, (s) => !s.lost && s.scenes > c.scenes && s.blooms > c.blooms,
      'the rewards backdrop did not redraw after its context returned');
    h.expect(restored.scenes === c.scenes + 1 && restored.blooms === c.blooms + 1,
      'the restored rewards backdrop did not render its expensive passes once');
    await h.frames(page, 60);
    const afterRestore = await backdrop();
    h.expect(afterRestore.scenes === restored.scenes && afterRestore.blooms === restored.blooms,
      'the restored rewards backdrop kept drawing');
    h.expect(await grain(page) > 0.2, 'the restored rewards backdrop lost its grain');
    await page.evaluate(() => {
      const s = window.__stage;
      s.camera.position.x += 1;
      s.invalidate();
    });
    const invalidated = await h.poll(page, backdrop,
      (s) => s.scenes > afterRestore.scenes && s.blooms > afterRestore.blooms,
      'the changed rewards scene did not redraw when requested');
    h.expect(invalidated.scenes === afterRestore.scenes + 1 && invalidated.blooms === afterRestore.blooms + 1,
      'the changed rewards backdrop did not render its expensive passes once');
    await h.frames(page, 60);
    const settled = await backdrop();
    h.expect(settled.scenes === invalidated.scenes && settled.blooms === invalidated.blooms,
      'the invalidated rewards backdrop kept drawing');
    await page.evaluate(() => window.__stage.step(0));
    const captured = await backdrop();
    h.expect(captured.scenes > settled.scenes && captured.blooms > settled.blooms,
      'an explicit rewards capture did not draw');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { stillGrain, movingGrain, restored, invalidated };
  },

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
      await page.evaluate(() => import('/src/core/params.ts').then(({ setMotion }) => setMotion('full')));
      await h.poll(page, () => state(page), (s) => !s.scenes.last.still && s.scenes.frames > b.frames,
        `still ${tag}: the moth did not wake when motion returned`);
      await page.evaluate(() => import('/src/core/params.ts').then(({ setMotion }) => setMotion('reduce')));
      await page.waitForFunction(() => window.__scenes.last.still);
      const settled = (await state(page)).scenes.frames;
      await h.frames(page, 60);
      const again = (await state(page)).scenes;
      h.expect(again.frames === settled && again.last.still, `still ${tag}: the moth did not settle again`);
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
