// Every intro scene framed for small phones. At 320x568, 390x844, 568x320 and 844x390, and on a 1440x900 desktop, the
// real intro plays in real time from each beat (`?shot=`), and every frame it draws is measured: the gate's slit keeps its share of the width, his
// hands and eyes stay inside the frame through the silhouette and AWAKEN, and the chest stays inside it and clear of its
// hold prompt, which stays on screen. Every Lantern window, the four reward cards, the welcome note and the end card's
// buttons can be reached whole, and the Safe Zone, Skip and Sound buttons stay on screen and off every word. Turning the
// phone mid-shot (the gate, the silhouette, AWAKEN, the chest while it is held, and the name prompt while typing) frames
// the same moment for the new shape, easing there or cutting there with reduced motion (also when it comes on mid-way),
// without restarting the beat, skipping ahead or losing typed names. A first visit then walks the whole intro, title to end card, with long names.
import { until } from './harness.mjs';
import { isSettled, windowCut } from './me-92-safe-zone-clean.e2e.mjs';

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const SHORT_SIDE = { width: 568, height: 320 };
const SIDE = { width: 844, height: 390 };
const DESK = { width: 1440, height: 900 };
const SIZES = [SMALL, PHONE, SHORT_SIDE, SIDE, DESK];
const size = ({ width, height }) => `${width}x${height}`;
// the framing is the same with or without post effects: drawn light, and with no more pixels than on a phone at any
// size, so a software renderer keeps up in real time
const light = ({ width, height }) => `&nopost&msaa=0&dpr=${Math.min(1, Math.sqrt((PHONE.width * PHONE.height) / (width * height))).toFixed(2)}`;
// the longest names a player can choose (24 characters), so every line that shows them is at its longest
const NAMES = { name: 'Wilhelmina Wolfgangsdott', companion: 'Moonmoth of the Far Hill' };
const LONG_NAMES = { 'dbt.you.v1': JSON.stringify({ ...NAMES, nameAt: 1, companionAt: 1 }) };
// a subject stays this share of the frame inside its edges
const IN = 0.03;
// after the screen turns, frames this long count as the re-frame on its way (REFRAME in src/motion/tokens.ts, and a frame)
const SETTLE = 0.6;

/**
 * Records every frame the intro draws from its first shot on: the beat's clock in seconds, the screen, and where its
 * subjects land on it as [left, top, right, bottom] in shares of the screen: his eyes and hands, the gate's slit, the
 * chest (its closed box) and the hold prompt.
 */
const watch = (page) =>
  page.evaluate(async () => {
    const { DIM, LID_W, LID_D } = await import('/src/scene/chest/geometry.ts');
    const s = window.__stage;
    const V3 = s.camera.position.constructor;
    const named = (n) => {
      let g = null;
      s.scene.traverse((o) => o.name === n && (g = o));
      return g;
    };
    const chestBox = [];
    for (const x of [-LID_W / 2, LID_W / 2]) for (const y of [0, DIM.lidY + DIM.lipH + DIM.domeH]) for (const z of [-LID_D / 2, LID_D / 2]) chestBox.push(new V3(x, y, z));
    const frames = (window.__frames = []);
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    let t0 = null;
    const render = s.renderer.render.bind(s.renderer);
    s.renderer.render = (scene, cam) => {
      // the first frame of the first shot starts the beat's clock (the camera stands at the origin until then)
      if (scene === s.scene && (t0 !== null || cam.position.lengthSq() > 0)) {
        t0 ??= s.time;
        cam.updateMatrixWorld();
        const box = (ps) => {
          const q = ps.map((p) => p.clone().project(cam)).map((p) => [(p.x + 1) / 2, (1 - p.y) / 2]);
          return q.length ? [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))] : null;
        };
        const f = { lt: s.time - t0, w: innerWidth, h: innerHeight, still: still.matches };
        const [hero, gate, chest] = ['hero', 'gate', 'chest'].map(named);
        if (hero?.visible) {
          hero.updateMatrixWorld(true);
          const bones = (n) => {
            const ps = [];
            hero.getObjectByName(n).traverse((o) => o.isBone && ps.push(o.getWorldPosition(new V3())));
            return ps;
          };
          const eyes = [];
          hero.traverse((o) => o.isSprite && eyes.push(o.getWorldPosition(new V3())));
          Object.assign(f, { eyes: box(eyes), handR: box(bones('hand_r')), handL: box(bones('hand_l')) });
        }
        // the slit as this frame draws it, from its own uniforms (the gate notes its width before the director sets it)
        let glow = null;
        gate?.traverse((o) => o.material?.uniforms?.uWidth && (glow = o.material.uniforms));
        const hw = gate?.visible && glow ? 0.5 * glow.uWidth.value * glow.uOpen.value : 0;
        if (hw) {
          const c = gate.getWorldPosition(new V3());
          f.slit = box([[-hw, 0], [hw, 0], [-hw, gate.userData.slitTop], [hw, gate.userData.slitTop]].map(([x, y]) => new V3(c.x + x, y, c.z)));
        }
        if (chest?.visible) {
          chest.updateMatrixWorld(true);
          f.chest = box(chestBox.map((p) => p.clone().applyMatrix4(chest.matrixWorld)));
        }
        const parts = [...document.querySelectorAll('.chest-hold .ch-target, .chest-hold .ch-chip')];
        if (parts.length) f.prompt = parts.map((e) => e.getBoundingClientRect()).map((r) => [r.left / innerWidth, r.top / innerHeight, r.right / innerWidth, r.bottom / innerHeight]);
        frames.push(f);
      }
      return render(scene, cam);
    };
  });

/** The intro from `shot`'s beat on, at `viewport`, with every frame watched from its first shot. */
async function beat(h, viewport, shot, { query = '', seed = LONG_NAMES } = {}) {
  const { page, errors } = await h.open(seed, `?shot=${shot}&mute${light(viewport)}${query}`, viewport);
  await page.locator('.title-screen').waitFor({ timeout: 60000 });
  await watch(page);
  await page.locator('.title-screen').click();
  return { page, errors };
}

/** Waits for the beat's clock to reach `sec`. */
const reach = (page, sec, timeout = 60000) => until(page, (s) => (window.__frames.at(-1)?.lt ?? -1) >= s, sec, { timeout, polling: 50 });

/** Turns the phone to `viewport`; returns the beat's clock as it turned. */
async function turn(page, viewport) {
  const at = await page.evaluate(() => window.__frames.at(-1)?.lt ?? 0);
  await page.setViewportSize(viewport);
  return at;
}

const where = (b) => (b ? `[${b.map((x) => x.toFixed(2)).join(', ')}]` : 'not drawn');
const inside = (b, m = IN) => !!b && b[0] >= m && b[1] >= m && b[2] <= 1 - m && b[3] <= 1 - m;
const overlap = (a, b) => Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
/** a check of one frame: what is off, or null */
const keeps = (...subjects) => (f) => subjects.map(([what, key]) => (inside(f[key]) ? null : `${what} at ${where(f[key])}`)).find(Boolean) ?? null;
const EYES = ['his eyes', 'eyes'];
const HAND = ['his right hand', 'handR'];

/** What each beat's shots frame, between two times on the beat's clock (clear of the cuts) */
const SHOTS = {
  gate: [
    {
      from: 2.6, to: 7.0, what: 'the open gate',
      check: (f) => {
        if (!f.slit) return 'the slit is not drawn';
        const share = f.slit[2] - f.slit[0], mid = (f.slit[0] + f.slit[2]) / 2;
        return share >= 0.12 && share <= 0.2 && Math.abs(mid - 0.5) < 0.03 ? null : `the slit is ${(share * 100).toFixed(1)} % of the width, its middle at ${(mid * 100).toFixed(1)} %`;
      },
    },
  ],
  silhouette: [
    { from: 0.4, to: 3.0, what: 'the low wide', check: keeps(EYES, HAND, ['his left hand', 'handL']) },
    { from: 3.4, to: 6.2, what: 'the mid shot', check: keeps(EYES) },
    { from: 6.6, to: 11.4, what: 'the push-in to his eyes', check: keeps(EYES) },
  ],
  awaken: [
    { from: 0.15, to: 1.8, what: 'the hand close-up', check: keeps(HAND) },
    { from: 1.95, to: 3.35, what: 'the reach', check: keeps(HAND, EYES) },
    { from: 3.55, to: 4.8, what: 'the command', check: keeps(EYES) },
    { from: 10.15, to: 11.85, what: 'the soldiers rising', check: keeps(EYES) },
    { from: 12.0, to: 13.05, what: 'the army standing', check: keeps(EYES, HAND) },
    { from: 13.2, to: 14.6, what: 'the kneel', check: keeps(EYES) },
  ],
  chest: [
    {
      from: 2.1, to: Infinity, what: 'the chest under its prompt', when: (f) => !!f.prompt,
      check: (f) => {
        if (!inside(f.chest)) return `the chest at ${where(f.chest)}`;
        if (!inside(f.eyes, 0)) return `his eyes at ${where(f.eyes)}`;
        const off = f.prompt.find((p) => !inside(p, 0));
        if (off) return `the prompt leaves the screen at ${where(off)}`;
        const on = f.prompt.find((p) => overlap(p, f.chest));
        return on ? `the prompt ${where(on)} covers the chest ${where(f.chest)}` : null;
      },
    },
  ],
};

/** Every frame of the beat against its shots; frames still easing to a new shape after the screen turned don't count. */
async function framing(page, shots) {
  const frames = await page.evaluate(() => window.__frames);
  const turns = frames.filter((f, i) => i && (f.w !== frames[i - 1].w || f.h !== frames[i - 1].h)).map((f) => f.lt);
  const bad = [];
  for (const s of shots) {
    const seen = frames.filter((f) => f.lt >= s.from && f.lt <= s.to && (s.when?.(f) ?? true) && !turns.some((t) => f.lt >= t && f.lt < t + SETTLE));
    if (!seen.length) bad.push(`${s.what}: no frame drawn`);
    for (const f of seen) {
      const why = s.check(f);
      if (why) {
        bad.push(`${s.what} at ${f.lt.toFixed(2)} s on ${f.w}x${f.h}: ${why}`);
        break;
      }
    }
  }
  return { frames, bad };
}

/** The beat's clock runs on through a turn: it never goes back (the beat restarting) or leaps (the beat skipped). */
const steady = (frames) => {
  for (let i = 1; i < frames.length; i++) {
    const dt = frames[i].lt - frames[i - 1].lt;
    if (dt < 0 || dt > 0.25) return `the beat's clock went from ${frames[i - 1].lt.toFixed(2)} to ${frames[i].lt.toFixed(2)} s`;
  }
  return null;
};

/**
 * The Safe Zone, Skip and Sound buttons that show: each whole on screen, none on another, and none over a word that
 * shows (inside every box that clips it).
 */
const waysClear = (page) =>
  page.evaluate(() => {
    const out = [];
    const ways = [...document.querySelectorAll('.ui-safe, .ui-skip, .vol--cutscene .vol-btn')].filter((e) => e.checkVisibility({ opacityProperty: true }));
    const name = (e) => (e.matches('.vol-btn') ? 'Sound' : `"${e.textContent.trim()}"`);
    const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const shown = (r, el) => {
      let [l, t, rt, b] = [Math.max(r.left, 0), Math.max(r.top, 0), Math.min(r.right, innerWidth), Math.min(r.bottom, innerHeight)];
      for (let p = el; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const q = p.getBoundingClientRect();
        [l, t, rt, b] = [Math.max(l, q.left + p.clientLeft), Math.max(t, q.top + p.clientTop), Math.min(rt, q.left + p.clientLeft + p.clientWidth), Math.min(b, q.top + p.clientTop + p.clientHeight)];
      }
      return { left: l, top: t, right: rt, bottom: b };
    };
    ways.forEach((a, i) => {
      const r = a.getBoundingClientRect();
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) out.push(`${name(a)} leaves the screen (${[r.left, r.top, r.right, r.bottom].map(Math.round)})`);
      for (const b of ways.slice(i + 1)) if (hit(r, b.getBoundingClientRect())) out.push(`${name(a)} overlaps ${name(b)}`);
    });
    const walk = document.createTreeWalker(document.getElementById('ui'), NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const el = t.parentElement;
      if (!t.data.trim() || el.closest('.ui-ways, .vol') || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) for (const w of ways) if (hit(shown(r, el), w.getBoundingClientRect())) out.push(`${name(w)} covers "${t.data.trim().slice(0, 32)}"`);
    }
    return [...new Set(out)];
  });

/** `sel` scrolled to as a player would: whole on screen and inside every box that clips it, and taking a tap at its middle */
const reachable = (page, sel) =>
  page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return `${sel} is not there`;
    e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = e.getBoundingClientRect();
    let [l, t, rt, b] = [Math.max(r.left, 0), Math.max(r.top, 0), Math.min(r.right, innerWidth), Math.min(r.bottom, innerHeight)];
    for (let p = e.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const q = p.getBoundingClientRect();
      [l, t, rt, b] = [Math.max(l, q.left + p.clientLeft), Math.max(t, q.top + p.clientTop), Math.min(rt, q.left + p.clientLeft + p.clientWidth), Math.min(b, q.top + p.clientTop + p.clientHeight)];
    }
    const box = [r.left, r.top, r.right, r.bottom].map(Math.round).join(', ');
    if (rt - l < r.width - 1 || b - t < r.height - 1) return `"${e.textContent.trim().slice(0, 32)}" doesn't show whole (${box} on ${innerWidth}x${innerHeight})`;
    return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) ? null : `"${e.textContent.trim().slice(0, 32)}" is under something else (${box})`;
  }, sel);

/** The hold prompt, the ring and its words: whole on screen, and a tap on either lands on the hold. */
const promptOn = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.chest-hold .ch-target, .chest-hold .ch-chip')].flatMap((e) => {
      const r = e.getBoundingClientRect();
      const box = [r.left, r.top, r.right, r.bottom].map(Math.round).join(', ');
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return [`the hold prompt leaves the screen (${box} on ${innerWidth}x${innerHeight})`];
      return e.closest('.chest-hold').contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) ? [] : [`the hold prompt is under something else (${box})`];
    }),
  );

/** A Lantern window once its words are typed: nothing of it cut, and the ways clear of it. */
async function windowFits(h, page, tag) {
  await page.waitForFunction(() => document.querySelector('.sw .sw-next')?.getAnimations().length > 0 || document.querySelector('.sw .sw-btn'), null, { polling: 'raf', timeout: 60000 });
  await page.waitForFunction(isSettled, '.sw', { polling: 'raf', timeout: 15000 });
  await h.shot(page, tag);
  const bad = [...(await windowCut(page, '.sw')), ...(await waysClear(page))];
  h.expect(!bad.length, `${tag}: ${bad.join('; ')}`);
}

/** Taps a tap-to-continue window on, and waits for the next screen. */
async function onward(page) {
  const win = await page.$('.sw');
  await page.keyboard.press('Enter');
  await page.waitForFunction((w) => !w.isConnected, win, { timeout: 15000 });
}

/** Holds the chest's prompt down until it charges and lets go, turning the phone to each of `turns` on the way. */
async function holdChest(page, turns = []) {
  const target = page.locator('.chest-hold .ch-target');
  await page.waitForFunction(isSettled, '.chest-hold', { polling: 'raf', timeout: 15000 });
  const b = await target.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (const v of turns) {
    await page.waitForTimeout(400);
    await turn(page, v);
  }
  // a full charge waits for the release
  await page.locator('.chest-hold.is-full').waitFor({ timeout: 15000 });
  await page.mouse.up();
  await page.locator('.chest-hold').waitFor({ state: 'detached', timeout: 15000 });
}

/** The four cards, the note and the end card: each reachable, nothing under the ways. */
async function closing(h, page, tag) {
  await page.locator('.rw-actions button').waitFor({ timeout: 60000 });
  await page.waitForFunction(isSettled, '.rw', { polling: 'raf', timeout: 15000 });
  await h.shot(page, `${tag}-rewards`);
  const bad = [];
  const cards = await page.evaluate(() => [...document.querySelectorAll('.rw-card')].map((c) => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  if (cards.length !== 4) bad.push(`${cards.length} reward cards`);
  cards.forEach((a, i) => cards.slice(i + 1).forEach((b) => overlap(a, b) && bad.push(`two reward cards overlap (${a.map(Math.round)} and ${b.map(Math.round)})`)));
  for (let i = 1; i <= 4; i++) bad.push(await reachable(page, `.rw-card:nth-child(${i}) .ds`));
  bad.push(await reachable(page, '.rw-actions button'), ...(await waysClear(page)));
  await page.locator('.rw-actions button').click();
  await page.locator('.letter .sw-actions button').last().waitFor({ timeout: 15000 });
  await page.waitForFunction(isSettled, '.letter-wrap', { polling: 'raf', timeout: 15000 });
  await h.shot(page, `${tag}-letter`);
  bad.push(...(await waysClear(page)), await reachable(page, '.letter .sw-actions button:last-child'), ...(await waysClear(page)));
  await page.locator('.letter .sw-actions button').last().click();
  await page.locator('.endcard .ec-actions button').last().waitFor({ timeout: 15000 });
  await page.waitForFunction(isSettled, '.endcard', { polling: 'raf', timeout: 15000 });
  await h.shot(page, `${tag}-end`);
  bad.push(await reachable(page, '.ec-title'), await reachable(page, '.ec-actions button:first-child'), await reachable(page, '.ec-actions button:last-child'), ...(await waysClear(page)));
  const off = bad.filter(Boolean);
  h.expect(!off.length, `${tag}: ${off.join('; ')}`);
}

function sized(viewport) {
  const tag = size(viewport);
  return {
    /** The gate opening: its slit keeps its share of the frame on this screen. */
    async [`frame-intro-gate-${tag}`](h) {
      const { page, errors } = await beat(h, viewport, 'gate');
      await reach(page, 3.2);
      await h.shot(page, `${tag}-gate`);
      const ways = await waysClear(page);
      await reach(page, 7.0);
      const { bad } = await framing(page, SHOTS.gate);
      h.expect(!bad.length && !ways.length, [...bad, ...ways].join('\n'));
      h.expect(!errors.length, errors.join('\n'));
    },
    /** The three windows over the gate: each whole on screen, under the ways. */
    async [`frame-intro-windows-${tag}`](h) {
      const { page, errors } = await beat(h, viewport, 'windows');
      for (const n of [1, 2, 3]) {
        await windowFits(h, page, `${tag}-window-${n}`);
        await onward(page);
      }
      h.expect(!errors.length, errors.join('\n'));
    },
    /** The silhouette, from the low wide to the push-in to his eyes. */
    async [`frame-intro-silhouette-${tag}`](h) {
      const { page, errors } = await beat(h, viewport, 'silhouette');
      for (const [at, name] of [[1.6, 'wide'], [4.6, 'mid'], [9.5, 'eyes']]) {
        await reach(page, at);
        await h.shot(page, `${tag}-silhouette-${name}`);
      }
      await reach(page, 11.5);
      const { bad } = await framing(page, SHOTS.silhouette);
      h.expect(!bad.length, bad.join('\n'));
      h.expect(!errors.length, errors.join('\n'));
    },
    /** AWAKEN, from the hand to the kneel, and the army's window over it. */
    async [`frame-intro-awaken-${tag}`](h) {
      const { page, errors } = await beat(h, viewport, 'awaken');
      for (const [at, name] of [[0.9, 'hand'], [2.8, 'reach'], [4.2, 'command'], [11, 'rise'], [12.6, 'stand'], [14, 'kneel']]) {
        await reach(page, at);
        await h.shot(page, `${tag}-awaken-${name}`);
      }
      await windowFits(h, page, `${tag}-awaken-army`);
      const { bad } = await framing(page, SHOTS.awaken);
      h.expect(!bad.length, bad.join('\n'));
      h.expect(!errors.length, errors.join('\n'));
    },
    /** The chest under its hold prompt, held open, and its reward window. */
    async [`frame-intro-chest-${tag}`](h) {
      const { page, errors } = await beat(h, viewport, 'chest');
      await page.locator('.chest-hold .ch-chip').waitFor({ timeout: 60000 });
      await page.waitForFunction(isSettled, '.chest-hold', { polling: 'raf', timeout: 15000 });
      await h.shot(page, `${tag}-chest`);
      const ways = [...(await waysClear(page)), ...(await promptOn(page))];
      await holdChest(page);
      await windowFits(h, page, `${tag}-chest-reward`);
      const { bad } = await framing(page, SHOTS.chest);
      h.expect(!bad.length && !ways.length, [...bad, ...ways].join('\n'));
      h.expect(!errors.length, errors.join('\n'));
    },
    /** The four reward cards, the welcome note and the end card, with the longest names. */
    async [`frame-intro-closing-${tag}`](h) {
      const { page, errors } = await beat(h, viewport, 'rewards');
      await closing(h, page, tag);
      h.expect(!errors.length, errors.join('\n'));
    },
  };
}

export const scenarios = {
  ...Object.assign({}, ...SIZES.map(sized)),

  /** The phone turns as the gate opens: the slit eases to its share of the new width, and the beat runs on. */
  async 'frame-intro-turn-gate'(h) {
    const { page, errors } = await beat(h, PHONE, 'gate');
    await reach(page, 3.4);
    const t1 = await turn(page, SIDE);
    await reach(page, 5.2);
    await turn(page, PHONE);
    await page.locator('.sw').waitFor({ timeout: 30000 });
    const { frames, bad } = await framing(page, SHOTS.gate);
    const share = (f) => f.slit[2] - f.slit[0];
    // with motion, the first frame on the new shape is the picture as it was, and the slit eases from there
    const first = frames.find((f) => f.lt >= t1 && f.w === SIDE.width);
    bad.push(steady(frames));
    if (first && share(first) >= 0.12) bad.push(`the slit was already ${(share(first) * 100).toFixed(1)} % of the new width on the first frame after the turn: it cut instead of easing`);
    const firstWindow = await page.evaluate(() => window.__frames.at(-1).lt);
    if (firstWindow < 6.9) bad.push(`the first window opened ${firstWindow.toFixed(2)} s into the gate: the turn skipped ahead`);
    await h.shot(page, 'turn-gate');
    h.expect(!bad.filter(Boolean).length, bad.filter(Boolean).join('\n'));
    h.expect(!errors.length, errors.join('\n'));
  },

  /** With reduced motion the gate's slit cuts to its share of the new width on the first frame after the turn. */
  async 'frame-intro-turn-gate-reduced'(h) {
    const { page, errors } = await beat(h, SIDE, 'gate', { query: '&reduced' });
    await reach(page, 3.4);
    const t = await turn(page, PHONE);
    await reach(page, 4.4);
    const frames = await page.evaluate(() => window.__frames);
    const after = frames.filter((f) => f.lt >= t && f.w === PHONE.width);
    const off = after.find((f) => !(f.slit[2] - f.slit[0] >= 0.12 && f.slit[2] - f.slit[0] <= 0.2));
    h.expect(after.length && !off, off ? `at ${off.lt.toFixed(2)} s, ${((off.slit[2] - off.slit[0]) * 100).toFixed(1)} % of the width: with reduced motion the slit eased instead of cutting` : 'no frame drawn after the turn');
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Reduced motion comes on while the slit eases to a turned phone's width: it cuts there on the next frame. */
  async 'frame-intro-turn-gate-motion-off'(h) {
    const { page, errors } = await beat(h, PHONE, 'gate');
    await reach(page, 3.4);
    await turn(page, SIDE);
    await until(page, (w) => window.__frames.at(-1).w === w, SIDE.width, { timeout: 15000, polling: 16 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await reach(page, 4.4);
    const frames = (await page.evaluate(() => window.__frames)).filter((f) => f.w === SIDE.width);
    const share = (f) => f.slit[2] - f.slit[0];
    const turned = frames[0], cut = frames.find((f) => f.still);
    h.expect(share(turned) < 0.12 && cut && cut.lt - turned.lt < 0.5, `reduced motion didn't come on while the slit eased (turned at ${turned.lt.toFixed(2)} s, ${(share(turned) * 100).toFixed(1)} %; reduced at ${cut?.lt.toFixed(2)} s)`);
    const off = frames.filter((f) => f.still).find((f) => share(f) < 0.12 || share(f) > 0.2);
    h.expect(!off, off && `at ${off.lt.toFixed(2)} s, with reduced motion on, the slit was still easing (${(share(off) * 100).toFixed(1)} % of the width)`);
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Turned in the low wide and again in the push-in to his eyes: he stays framed for each shape. */
  async 'frame-intro-turn-silhouette'(h) {
    const { page, errors } = await beat(h, SIDE, 'silhouette');
    await reach(page, 1.0);
    await turn(page, PHONE);
    await reach(page, 2.4);
    await h.shot(page, 'turn-silhouette-wide');
    await reach(page, 8.0);
    await turn(page, SHORT_SIDE);
    await reach(page, 9.2);
    await h.shot(page, 'turn-silhouette-eyes');
    await reach(page, 11.5);
    const { frames, bad } = await framing(page, SHOTS.silhouette);
    bad.push(steady(frames));
    h.expect(!bad.filter(Boolean).length, bad.filter(Boolean).join('\n'));
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Turned in the reach and again as the soldiers rise: AWAKEN frames each shot for the new shape and plays on. */
  async 'frame-intro-turn-awaken'(h) {
    const { page, errors } = await beat(h, PHONE, 'awaken');
    await reach(page, 2.3);
    await turn(page, SIDE);
    await reach(page, 10.4);
    await turn(page, SMALL);
    await page.locator('.sw').waitFor({ timeout: 30000 });
    const { frames, bad } = await framing(page, SHOTS.awaken);
    bad.push(steady(frames));
    const opened = frames.at(-1).lt;
    if (opened < 14.5) bad.push(`the army's window opened ${opened.toFixed(2)} s into AWAKEN: the turn skipped ahead`);
    await h.shot(page, 'turn-awaken');
    h.expect(!bad.filter(Boolean).length, bad.filter(Boolean).join('\n'));
    h.expect(!errors.length, errors.join('\n'));
  },

  /** Turned while the prompt waits, and twice while the chest is held: the same hold goes on, the chest re-framed clear of
   *  the prompt on each shape. */
  async 'frame-intro-turn-chest'(h) {
    const { page, errors } = await beat(h, PHONE, 'chest');
    await page.locator('.chest-hold .ch-chip').waitFor({ timeout: 60000 });
    await page.evaluate(() => (window.__prompt = document.querySelector('.chest-hold')));
    await turn(page, SHORT_SIDE);
    await page.waitForTimeout(SETTLE * 1000);
    await h.shot(page, 'turn-chest-waiting');
    const on = await promptOn(page);
    const same = await page.evaluate(() => window.__prompt === document.querySelector('.chest-hold') && !document.querySelector('.sw'));
    await holdChest(page, [SMALL, SIDE]);
    await windowFits(h, page, 'turn-chest-reward');
    const { frames, bad } = await framing(page, SHOTS.chest);
    bad.push(...on, steady(frames), same ? null : 'the hold prompt was replaced, or the reward came, as the phone turned');
    h.expect(!bad.filter(Boolean).length, bad.filter(Boolean).join('\n'));
    h.expect(!errors.length, errors.join('\n'));
  },

  /** A first visit, short and sideways: the title, the names typed at their longest and turned both ways while typing,
   *  then every beat to the end card, the Sound button with Safe Zone and Skip on every screen. */
  async 'frame-intro-first-visit'(h) {
    const { page, errors } = await h.open({}, `?fresh&mute${light(SHORT_SIDE)}`, SHORT_SIDE);
    await page.locator('.title-screen').waitFor({ timeout: 60000 });
    await page.waitForFunction(isSettled, '.title-screen', { polling: 'raf', timeout: 15000 });
    const bad = [...(await waysClear(page))];
    await page.locator('.title-screen').click();
    await page.locator('#np-name').waitFor({ timeout: 15000 });
    await windowFits(h, page, 'first-visit-names');
    await page.locator('#np-name').fill('');
    await page.locator('#np-name').pressSequentially(NAMES.name);
    await page.locator('#np-comp').click();
    await page.locator('#np-comp').pressSequentially(NAMES.companion.slice(0, 12));
    const prompt = await page.$('.sw');
    for (const v of [SMALL, SIDE]) {
      await page.setViewportSize(v);
      await page.waitForTimeout(300);
      const kept = await page.evaluate((w) => ({ same: w.isConnected, name: document.querySelector('#np-name').value, comp: document.querySelector('#np-comp').value, focus: document.activeElement?.id }), prompt);
      h.expect(kept.same && kept.name === NAMES.name && kept.comp === NAMES.companion.slice(0, 12) && kept.focus === 'np-comp', `turned to ${size(v)} while typing: ${JSON.stringify(kept)}`);
      bad.push(...(await windowCut(page, '.sw')), ...(await waysClear(page)));
      await h.shot(page, `first-visit-names-${size(v)}`);
    }
    await page.setViewportSize(SHORT_SIDE);
    await page.locator('#np-comp').pressSequentially(NAMES.companion.slice(12));
    await page.keyboard.press('Enter');
    await page.waitForFunction((w) => !w.isConnected, prompt, { timeout: 15000 });
    await page.locator('.sw').waitFor({ timeout: 60000 });
    for (const n of [1, 2, 3]) {
      await windowFits(h, page, `first-visit-window-${n}`);
      await onward(page);
    }
    await page.locator('.awaken-word').waitFor({ timeout: 60000 });
    bad.push(...(await waysClear(page)));
    await windowFits(h, page, 'first-visit-army');
    await onward(page);
    await page.locator('.chest-hold .ch-chip').waitFor({ timeout: 60000 });
    bad.push(...(await waysClear(page)), ...(await promptOn(page)));
    await holdChest(page);
    await windowFits(h, page, 'first-visit-chest-reward');
    await onward(page);
    await closing(h, page, 'first-visit');
    const off = bad.filter(Boolean);
    h.expect(!off.length, off.join('\n'));
    h.expect(!errors.length, errors.join('\n'));
  },
};
