// The companion moth in 3D on its reward card: on a phone and a desktop the card's emblem shows the moth live and drawn,
// its drawing hidden underneath; it wakes as it is met (its wings, folded up over its back, open to rest) and then
// breathes, its wings and antennae moving on; every part of it is where the model file puts it, left and right alike;
// with reduced motion it is one still frame, awake; with no WebGL the drawing stays and no scene is left; reading the
// note takes it down with nothing left behind, and so does leaving the real intro from its rewards by Skip or the Safe
// Zone, with the intro's own 3D stage drawing behind the cards.
import sharp from 'sharp';
import { screenshot } from './harness.mjs';

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };
/** the wings' lift above flat, in radians (src/scene/vignettes/scenes/moth.ts): folded asleep and at rest */
const FOLDED = 1.45;
const REST = 0.14;
const REWARDS = '?lab=window&kind=rewards&mute';

const card = (page) => page.locator('.rw-card', { hasText: 'Epic companion' });
const state = (page) =>
  page.evaluate(() => ({
    scenes: window.__scenes ? JSON.parse(JSON.stringify(window.__scenes)) : null,
    moth: window.__moth ? JSON.parse(JSON.stringify(window.__moth)) : null,
    canvases: document.querySelectorAll('.dq-scene canvas').length,
    rewards: document.querySelectorAll('.rw').length,
  }));

/** The companion card's emblem shows the moth: its first frame is drawn and it is fading in over its drawing. */
async function onCard(h, page, where) {
  await card(page).locator('.em.is-scene-live').waitFor({ timeout: 30000 }).catch(async () => {
    await h.shot(page, `fail-${where}`);
    throw new Error(`${where}: the 3D moth never came on its card`);
  });
}
/** The moth fully faded in on its card, its drawing hidden. */
async function shown(h, page, where) {
  const em = card(page).locator('.em');
  await h.poll(page, () => em.locator('.dq-scene').evaluate((e) => Number(getComputedStyle(e).opacity)), (o) => o >= 0.99, `${where}: the moth never finished fading in`, { timeout: 5000, polling: 50 });
  // the drawing goes once the moth has faded in over it
  await h.poll(page, () => em.locator('svg.dq-scene-flat').evaluate((e) => getComputedStyle(e).visibility), (v) => v === 'hidden', (v) => `${where}: the moth's drawing still shows over the 3D moth (${v})`, { timeout: 3000, polling: 50 });
}

/** Brightness of the emblem's window as shown: its mean, spread and brightest pixel. */
async function pixels(page) {
  const { data, info } = await sharp(await screenshot(card(page).locator('.dq-scene'))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: ht, channels: c } = info;
  let n = 0, sum = 0, sq = 0, max = 0;
  for (let y = Math.floor(ht * 0.15); y < ht * 0.85; y++) {
    for (let x = Math.floor(w * 0.15); x < w * 0.85; x++) {
      const i = (y * w + x) * c;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++, (sum += l), (sq += l * l), (max = Math.max(max, l));
    }
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(1), max: Math.round(max) };
}

/**
 * The moth's window melts into the card: just inside the emblem's corners the card looks as it does just outside them,
 * with no dark square round the moth, while it fades in as much as after; and the moth fits inside it.
 */
async function seamless(h, page, where) {
  const c = card(page);
  const [box, em] = await Promise.all([c.boundingBox(), c.locator('.em').boundingBox()]);
  const { data, info } = await sharp(await screenshot(c)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const k = info.width / box.width;
  const at = (x, y) => {
    const i = (Math.round((y - box.y) * k) * info.width + Math.round((x - box.x) * k)) * info.channels;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const pairs = [[em.x + 3, em.y + 3, em.x - 3, em.y + 3], [em.x + em.width - 3, em.y + 3, em.x + em.width + 3, em.y + 3], [em.x + 3, em.y + em.height - 3, em.x - 3, em.y + em.height - 3], [em.x + em.width - 3, em.y + em.height - 3, em.x + em.width + 3, em.y + em.height - 3]];
  const gaps = pairs.map(([x0, y0, x1, y1]) => +(at(x1, y1) - at(x0, y0)).toFixed(1));
  h.expect(gaps.every((g) => Math.abs(g) < 6), `${where}: the moth's window shows as a square on the card (outside minus inside: ${gaps})`);
  // and the moth is whole inside it: nothing of it reaches the window's left and right edges, where it would be cut off
  const edge = (x) => Math.max(...Array.from({ length: Math.floor(em.height) - 6 }, (_, i) => at(x, em.y + 3 + i)));
  const card0 = Math.max(at(em.x - 3, em.y + em.height / 2), at(em.x + em.width + 3, em.y + em.height / 2));
  const sides = [edge(em.x + 1), edge(em.x + em.width - 1)];
  h.expect(sides.every((l) => l < card0 + 25), `${where}: the moth is cut off at its window's side (edge brightness ${sides.map(Math.round)}, card ${Math.round(card0)})`);
}

/** Every part of the moth where the model puts it: both sides alike, the antennae above the head, the feet on the ground. */
function parts(h, moth) {
  const p = moth.parts;
  const want = ['moth-body', 'moth-eye', 'moth-wing1', 'moth-wing-1', 'moth-ant1', 'moth-ant-1'];
  h.expect(want.every((k) => p[k]), `the moth's model is missing parts: has ${Object.keys(p).join(', ')}`);
  const [bx0, by0, , bx1, by1] = p['moth-body'];
  const [rx0, , , rx1] = p['moth-wing1'];
  const [lx0, , , lx1] = p['moth-wing-1'];
  h.expect(rx1 > 0.5 && lx0 < -0.5 && Math.abs(rx1 + lx0) < 0.01 && Math.abs(rx0 + lx1) < 0.01, `the wings are not a mirrored pair a metre across: right ${rx0}..${rx1}, left ${lx0}..${lx1}`);
  h.expect(Math.abs(bx0 + bx1) < 0.01 && by0 > -0.01 && by0 < 0.02 && by1 < 0.32, `the body is off its middle or off the ground: x ${bx0}..${bx1}, y ${by0}..${by1}`);
  for (const s of [1, -1]) {
    const [ax0, ay0, , ax1, ay1] = p[`moth-ant${s}`];
    h.expect(ay1 > by1 && ay0 > 0.15 && (s > 0 ? ax1 > 0.15 : ax0 < -0.15), `antenna ${s} does not rise up and out from the head: x ${ax0}..${ax1}, y ${ay0}..${ay1}`);
  }
}

export const scenarios = {
  /** live on the card at both sizes, waking then breathing, drawn and in place; Read the note takes it down cleanly */
  async 'companion-moth'(h) {
    for (const [tag, vp] of [['phone', PHONE], ['desk', DESK]]) {
      const { ctx, page, errors } = await h.open({}, REWARDS, vp);
      await onCard(h, page, tag);
      const first = (await state(page)).scenes;
      h.expect(first.last.kind === 'moth', `${tag}: the card shows ${first.last.kind}, not the moth`);
      // it is met asleep, from the first frame anyone sees: its wings start folded up, then open to rest
      const lifts = [first.last.probe];
      await seamless(h, page, `${tag}, fading in`);
      await h.poll(page, async () => (lifts.push((await state(page)).scenes.last.probe), lifts.at(-1)), (p) => p.e > 3.2, `${tag}: the moth never finished waking`, { timeout: 15000, polling: 100 });
      const early = lifts.filter((p) => p.e < 0.6);
      h.expect(early.length && early.every((p) => p.lift > FOLDED - 0.15), `${tag}: the moth was not seen asleep, its wings folded, as it woke (${JSON.stringify(lifts.slice(0, 4))})`);
      h.expect(lifts.at(-1).lift < REST + 0.2, `${tag}: the wings never opened (${JSON.stringify(lifts.map((p) => p.lift.toFixed(2)))})`);
      await shown(h, page, tag);
      await seamless(h, page, `${tag}, awake`);
      // then it breathes: the wings lift and settle near rest, the antennae drift
      const a = (await state(page)).scenes.last.probe;
      await h.sleep(1500);
      const b = (await state(page)).scenes.last.probe;
      h.expect(Math.abs(b.lift - REST) < 0.08 && b.lift !== a.lift && b.antenna !== a.antenna, `${tag}: the awake moth is not breathing at rest (${JSON.stringify([a, b])})`);
      const p = await pixels(page);
      h.expect(p.sd > 10 && p.max > 140 && p.mean > 8, `${tag}: the moth looks blank (${JSON.stringify(p)})`);
      const s = await state(page);
      parts(h, s.moth);
      h.expect(s.scenes.contexts === 1 && s.canvases === 1, `${tag}: ${s.scenes.contexts} contexts and ${s.canvases} canvases for one moth`);
      await h.shot(card(page), `companion-moth-${tag}`);
      await h.shot(page, `companion-moth-cards-${tag}`);
      // reading the note takes the moth down, and everything it made with it
      await page.getByRole('button', { name: 'Read the note' }).click();
      await h.poll(page, () => state(page), (n) => n.scenes.live === 0 && n.canvases === 0 && n.moth.disposed === n.moth.builds, (n) => `${tag}: the moth was left behind the rewards (${JSON.stringify({ ...n, moth: { ...n.moth, parts: undefined } })})`, { timeout: 5000 });
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** with reduced motion the moth is one still frame, awake with its wings at rest, and draws nothing more */
  async 'companion-moth-still'(h) {
    const { ctx, page, errors } = await h.open({}, REWARDS + '&reduced', PHONE);
    await onCard(h, page, 'still');
    await shown(h, page, 'still');
    await page.waitForFunction(() => window.__scenes?.last.still, null, { timeout: 15000 });
    const a = (await state(page)).scenes;
    await h.frames(page, 60);
    const b = (await state(page)).scenes;
    h.expect(b.frames === a.frames && b.last.still, `still: the moth kept drawing (${a.frames} -> ${b.frames})`);
    h.expect(Math.abs(b.last.probe.lift - REST) < 0.08, `still: the moth is not awake at rest (${JSON.stringify(b.last.probe)})`);
    const p = await pixels(page);
    h.expect(p.sd > 10 && p.max > 140, `still: the moth looks blank (${JSON.stringify(p)})`);
    await h.shot(card(page), 'companion-moth-still');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * In the real intro, with its 3D stage drawing behind the cards on its own context, the moth comes on its card; leaving
   * from there by Skip or the Safe Zone takes it down with everything it made.
   */
  async 'companion-moth-intro-leaves'(h) {
    // by their names as a screen reader hears them (INTRO_WAYS in src/content/intro.ts)
    for (const way of ['Skip intro', 'Safe Zone, help right now']) {
      const { ctx, page, errors } = await h.open({}, '?shot=rewards&mute', PHONE);
      await page.locator('.title-screen').click({ timeout: 15000 });
      await onCard(h, page, way);
      const s = await state(page);
      h.expect(s.scenes.last.kind === 'moth' && s.scenes.live === 1, `${way}: the moth is not live in the intro (${JSON.stringify(s.scenes)})`);
      await page.getByRole('button', { name: way, exact: true }).click();
      await h.poll(page, () => state(page), (n) => n.scenes.live === 0 && n.canvases === 0 && n.moth.disposed === n.moth.builds && !n.rewards, (n) => `${way}: the moth was left behind the intro (${JSON.stringify({ ...n, moth: { ...n.moth, parts: undefined } })})`, { timeout: 8000 });
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** no WebGL 2: the drawing stays on the card and no scene is left on the page */
  async 'companion-moth-no-webgl'(h) {
    const { ctx, page, errors } = await h.open({}, REWARDS, PHONE);
    await ctx.addInitScript(() => delete window.WebGL2RenderingContext);
    await page.reload();
    await card(page).locator('.em svg').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Read the note' }).waitFor({ state: 'visible', timeout: 15000 });
    const s = await state(page);
    const shown = await card(page).locator('.em svg').evaluate((e) => {
      const st = getComputedStyle(e);
      return st.visibility !== 'hidden' && Number(st.opacity) > 0.9;
    });
    h.expect(shown && s.canvases === 0 && !(s.scenes?.live > 0), `no WebGL: the moth's drawing is hidden or a scene was left (${JSON.stringify({ shown, s })})`);
    await h.shot(card(page), 'companion-moth-no-webgl');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
