// The Night Watch gathers around a 3D camp on the Shadows screen: live and drawn at phone, sideways and desktop sizes
// with everyone who has arrived (and only them); a tap or the keyboard on a watcher opens their own card, name field
// and all, while the Safe Zone stays one tap away and takes the camp down; one still frame with reduced motion; the
// roster as before with no WebGL; one WebGL context however often it opens; back after a lost context; every part of
// every watcher where the model file puts it; an old save; no :has(); a failed load retried on the next visit;
// a card opened during the page's entrance; a late chapter list stays closed after leaving.
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import sharp from 'sharp';

const PHONE = { width: 390, height: 844 };
const SIDE = { width: 844, height: 390 };
const DESK = { width: 1440, height: 900 };
const ALL = ['sable', 'anvil', 'bramble', 'vesper', 'crest', 'block', 'harrow'];

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** a save with a visit on each of the last `days` days, its arrival windows already seen */
function save(days) {
  const now = Date.now();
  const events = Array.from({ length: days }, (_, i) => ({ id: `camp-v${i}`, k: 'visit', xp: 10, t: now - i * 864e5, day: dayKey(now - i * 864e5) }));
  const today = dayKey(now);
  return JSON.stringify({ v: 1, events, flags: { greetDay: today, cardDay: today, giftDay: today, checkinDay: today, therapistLineShown: true, rankSeen: 9, wardenSeen: true } });
}
const seed = (h, days, raw) => ({ [h.SAVE]: raw ?? save(days), 'dbt.app.v1': h.SEEN });

const state = (page) =>
  page.evaluate(() => ({
    scenes: window.__scenes ? JSON.parse(JSON.stringify(window.__scenes)) : null,
    camp: window.__camp ? JSON.parse(JSON.stringify(window.__camp)) : null,
    // the scenes' canvases only: the intro's stage and the companion's bubbles have their own
    canvases: document.querySelectorAll('.dq-scene canvas').length,
    route: window.__daily?.route?.name,
  }));

/** Home, then the Shadows screen with the camp scrolled into view (it draws only while on screen). */
async function toCamp(h, page, where, wait = true) {
  // the first-visit welcome can open a moment after Home appears, so Home has to stay clear for a while
  await h.reachHub(page);
  await h.sleep(1500);
  await h.reachHub(page);
  await page.evaluate(() => window.__daily.go({ name: 'shadows' }));
  await page.locator('.w2-roster').waitFor({ timeout: 10000 });
  if (!wait) return;
  await page.locator('.w2-camp').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.locator('.w2-camp.is-scene-live').waitFor({ timeout: 30000 }).catch(async () => {
    await h.shot(page, `fail-${where}`);
    throw new Error(`${where}: the camp never came on screen`);
  });
}

/** Brightness of the camp as shown on screen: its mean, spread and brightest pixel. */
async function pixels(page) {
  const { data, info } = await sharp(await page.locator('.w2-camp').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: ht, channels: c } = info;
  let n = 0, sum = 0, sq = 0, max = 0;
  for (let y = Math.floor(ht * 0.15); y < ht * 0.8; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * c;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++, (sum += l), (sq += l * l), (max = Math.max(max, l));
    }
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(1), max: Math.round(max) };
}
async function drawn(h, page, where) {
  // the camp fades in over its first frames; it is measured once it is fully there
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.w2-camp > .dq-scene')).opacity) > 0.99, null, { timeout: 5000 });
  const p = await pixels(page);
  h.expect(p.sd > 6 && p.max > 120 && p.mean > 4, `${where}: the camp looks blank (${JSON.stringify(p)})`);
  return p;
}

/**
 * Every watcher's button: one per arrived shadow, at least a finger in size, inside the camp, over its figure, and the
 * thing a tap at its middle lands on.
 */
async function buttons(h, page, ids, where) {
  const got = await page.evaluate(() => {
    const stage = document.querySelector('.w2-camp').getBoundingClientRect();
    return {
      stage: { x: stage.x, y: stage.y, w: stage.width, h: stage.height },
      hits: window.__camp.hits,
      btns: [...document.querySelectorAll('.w2-camp-hit')].map((b) => {
        const r = b.getBoundingClientRect();
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        const top = document.elementFromPoint(cx, cy)?.closest('.w2-camp-hit');
        return { id: b.dataset.shadow, label: b.getAttribute('aria-label'), x: r.x, y: r.y, w: r.width, h: r.height, cx, cy, top: top?.dataset.shadow ?? null };
      }),
    };
  });
  h.expect(JSON.stringify(got.btns.map((b) => b.id)) === JSON.stringify(ids), `${where}: buttons for ${got.btns.map((b) => b.id)} but ${ids} have arrived`);
  h.expect(JSON.stringify(got.hits.map((x) => x.id)) === JSON.stringify(ids), `${where}: figures for ${got.hits.map((x) => x.id)} but ${ids} have arrived`);
  for (const b of got.btns) {
    const f = got.hits.find((x) => x.id === b.id);
    const fx = got.stage.x + (f.x + f.w / 2) * got.stage.w, fy = got.stage.y + (f.y + f.h / 2) * got.stage.h;
    h.expect(b.w >= 43.5 && b.h >= 43.5, `${where}: ${b.id}'s button is ${b.w.toFixed(0)} x ${b.h.toFixed(0)} px`);
    h.expect(Math.abs(b.cx - fx) < 1.5 && Math.abs(b.cy - fy) < 1.5, `${where}: ${b.id}'s button is not over the figure`);
    h.expect(b.cx > got.stage.x && b.cx < got.stage.x + got.stage.w && b.cy > got.stage.y && b.cy < got.stage.y + got.stage.h, `${where}: ${b.id}'s button is outside the camp`);
    h.expect(b.top === b.id, `${where}: a tap on ${b.id} lands on ${b.top}`);
    h.expect(/\S, \S/.test(b.label ?? ''), `${where}: ${b.id}'s button has no name (${b.label})`);
  }
  return got.btns;
}

/**
 * Holds the n-th read of the stories store from now on: a write transaction on the same stores is started just before it
 * and kept busy, so the read waits behind it until window.__release(). window.__held says the hold is on,
 * window.__readDone that the held read has finished.
 */
const holdRead = () => {
  const make = IDBDatabase.prototype.transaction;
  window.__hold = 0;
  IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    const names = [].concat(stores);
    if (names.includes('stories') && mode !== 'readwrite') {
      if (window.__hold > 0 && --window.__hold === 0) {
        const block = make.call(this, names, 'readwrite');
        const store = block.objectStore(names[0]);
        let on = true;
        window.__release = () => (on = false);
        const spin = () => {
          if (on) store.get('held').onsuccess = spin;
        };
        spin();
        window.__held = true;
        const t = make.call(this, stores, mode, ...rest);
        t.addEventListener('complete', () => (window.__readDone = true));
        return t;
      }
    }
    return make.call(this, stores, mode, ...rest);
  };
};

/** An init script: the first part the camp's models settle throws, as a phone short of memory might, once a page. */
const settleThrowsOnce = () => {
  window.__watch = {
    parts: new Proxy({}, {
      set(parts, name, box) {
        if (!window.__thrown) {
          window.__thrown = true;
          throw new RangeError('out of memory (a test)');
        }
        parts[name] = box;
        return true;
      },
    }),
  };
};

export const scenarios = {
  /**
   * The chapter list loads from IndexedDB before its sheet opens. Left in that moment (here for the Safe Zone), the sheet
   * never opens: the sheet layer outlives the page, so a late one would cover "Talk to someone now".
   */
  async 'sheet-after-leaving'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', PHONE);
    await ctx.addInitScript(holdRead);
    await page.reload();
    await h.reachHub(page);
    await page.evaluate(() => window.__daily.go({ name: 'stories' }));
    // the shelf shows its top New story until the list has loaded, then an empty shelf hides it and offers the one in
    // the empty card: the button is picked once the list is there
    await page.locator('.st-empty, .st-row').first().waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'New story', exact: true }).filter({ visible: true }).first().click({ timeout: 10000 });
    await page.locator('.st-chbtn').waitFor({ timeout: 10000 });
    // Chapters reads the story twice: once to bring the screen up to date, then for the list itself, which is held
    await page.evaluate(() => (window.__hold = 2));
    await page.locator('.st-chbtn').click();
    await page.waitForFunction(() => window.__held === true, null, { timeout: 10000 });
    h.expect(!(await page.locator('.st-sheet').count()), 'the chapter list opened before its read was let go');
    await page.locator('.dq-safe').click();
    const talk = page.getByRole('button', { name: 'Talk to someone now', exact: true });
    await talk.waitFor({ timeout: 10000 });
    await page.evaluate(() => window.__release());
    await page.waitForFunction(() => window.__readDone === true, null, { timeout: 10000 });
    // the read's answer has come back; whatever it was going to open has had its turn
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const sheets = await page.locator('.st-sheet').count();
    const hit = await talk.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!at && b.contains(at);
    });
    await h.shot(page, 'sheet-after-leaving');
    h.expect(sheets === 0 && hit, `after leaving for the Safe Zone the chapter list opened over it (${sheets} sheets, "Talk to someone now" can be tapped: ${hit})`);
    h.expect((await page.evaluate(() => window.__daily.route.name)) === 'safe', 'the Safe Zone did not stay open');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
  /** the camp is live and drawn at phone, sideways and desktop sizes, with everyone on day 30 and Sable alone on day 1 */
  async 'camp-live'(h) {
    const runs = [['phone-day30', PHONE, 30, ALL], ['side-day30', SIDE, 30, ALL], ['desk-day30', DESK, 30, ALL], ['phone-day1', PHONE, 1, ['sable']], ['side-day1', SIDE, 1, ['sable']]];
    for (const [tag, vp, days, ids] of runs) {
      const { ctx, page, errors } = await h.open(seed(h, days), '?mute', vp);
      await toCamp(h, page, tag);
      await h.sleep(1500);
      // the camp moves, but its buttons stay put: nothing in them is rewritten while the frame keeps its size
      const writes = await page.evaluate(
        () =>
          new Promise((done) => {
            let n = 0;
            const mo = new MutationObserver((rs) => (n += rs.length));
            mo.observe(document.querySelector('.w2-camp-hits'), { subtree: true, attributes: true, childList: true });
            setTimeout(() => (mo.disconnect(), done(n)), 2000);
          }),
      );
      h.expect(writes === 0, `${tag}: the camp rewrote its buttons ${writes} times in 2 s with nothing changed`);
      const s = await state(page);
      h.expect(s.scenes.live === 1 && s.scenes.contexts === 1 && s.scenes.frames > 10 && s.scenes.last.kind === 'camp' && !s.scenes.last.still, `${tag}: ${JSON.stringify(s.scenes)}`);
      h.expect((await page.locator('.w2-camp canvas').count()) === 1 && s.canvases === 1, `${tag}: expected one canvas, in the camp`);
      h.expect(JSON.stringify(s.camp.ids) === JSON.stringify(ids), `${tag}: the camp shows ${s.camp.ids}, expected ${ids}`);
      await buttons(h, page, ids, tag);
      const box = await page.locator('.w2-camp').boundingBox();
      h.expect(box.x >= -0.5 && box.x + box.width <= vp.width + 0.5 && box.height >= 250, `${tag}: the camp is cut off or squashed: ${JSON.stringify(box)}`);
      const p = await drawn(h, page, tag);
      // the roster is still there under the camp, for screen readers and as it always was
      h.expect((await page.locator('.w2-roster-row .w2-sh:not(.is-locked)').count()) === ids.length, `${tag}: the roster under the camp lost a card`);
      await h.shot(page, `live-${tag}`);
      console.log(`  ${tag}: ${s.scenes.frames} frames at ratio ${s.scenes.dpr}, pixels ${JSON.stringify(p)}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** a tap or the keyboard on a watcher opens their own card; the name typed there is theirs; the Safe Zone stays one tap away */
  async 'camp-card'(h) {
    const { ctx, page, errors } = await h.open(seed(h, 30), '?mute', PHONE);
    await toCamp(h, page, 'card');
    const btns = await buttons(h, page, ALL, 'card');
    const anvil = btns.find((b) => b.id === 'anvil');
    await page.mouse.click(anvil.cx, anvil.cy);
    const card = page.locator('.w2-camp-card[role="dialog"]');
    await card.waitFor({ timeout: 5000 });
    h.expect((await card.locator('.w2-sh--anvil').count()) === 1, 'tapping Anvil did not open his card');
    h.expect((await card.getAttribute('aria-labelledby')) === 'w2h-anvil' && (await page.locator('#w2h-anvil').textContent()) === 'Anvil', 'the card is not labelled by its name');
    h.expect((await page.locator('.w2-roster-row .w2-sh--anvil').count()) === 0, "Anvil's card is in the sheet and in the row at once");
    h.expect(await page.evaluate(() => document.activeElement?.classList.contains('w2-camp-x')), 'focus did not move into the card');
    await h.shot(page, 'card-anvil');
    // the name field is the card's own: what is typed is stored as Anvil's name and shows on his card in the row
    await card.locator('input[data-shadow="anvil"]').fill('Ironside');
    await page.keyboard.press('Escape');
    await card.waitFor({ state: 'detached', timeout: 5000 });
    h.expect((await page.locator('.w2-roster-row .w2-sh--anvil .w2-sh-nick').textContent()) === '“Ironside”', 'the name typed in the card did not reach the row');
    const saved = await page
      .waitForFunction((k) => JSON.parse(localStorage.getItem(k) ?? '{}').profile?.names?.anvil === 'Ironside', h.SAVE, { timeout: 5000 })
      .then(() => true, () => false);
    h.expect(saved, `the name typed in the card was not saved: ${await h.ls(page, h.SAVE)}`.slice(0, 400));
    h.expect(await page.evaluate(() => document.activeElement?.dataset.shadow === 'anvil'), "closing the card did not return focus to Anvil's button");
    // Back closes an open card first and stays on the camp, like every other sheet
    await page.mouse.click(anvil.cx, anvil.cy);
    await card.waitFor({ timeout: 5000 });
    await page.goBack({ waitUntil: 'commit' });
    const closed = await card.waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
    h.expect(closed && (await page.evaluate(() => window.__daily.route.name)) === 'shadows', `Back with a card open ${closed ? 'left the camp for ' + (await page.evaluate(() => window.__daily.route.name)) : 'did not close the card'}`);
    // the keyboard: Tab-reachable buttons, Enter opens; the close button and the backdrop close
    await page.locator('.w2-camp-hit[data-shadow="sable"]').focus();
    await page.keyboard.press('Enter');
    await card.waitFor({ timeout: 5000 });
    h.expect((await card.locator('.w2-sh--sable').count()) === 1, 'Enter on Sable did not open her card');
    await page.locator('.w2-camp-x').click();
    await card.waitFor({ state: 'detached', timeout: 5000 });
    const block = btns.find((b) => b.id === 'block');
    await page.mouse.click(block.cx, block.cy);
    await card.waitFor({ timeout: 5000 });
    h.expect((await card.locator('.w2-sh--block').count()) === 1, 'tapping the Unlisted did not open its card');
    await page.mouse.click(8, PHONE.height - 8);
    await card.waitFor({ state: 'detached', timeout: 5000 });
    h.expect((await page.locator('.w2-roster-row .w2-sh--block').count()) === 1, 'the backdrop did not close the card');
    // with a card open the Safe Zone is still on top and one tap away, and nothing of the camp comes along
    await page.mouse.click(anvil.cx, anvil.cy);
    await card.waitFor({ timeout: 5000 });
    const safe = await page.locator('.dq-safe').boundingBox();
    const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.dq-safe'), [safe.x + safe.width / 2, safe.y + safe.height / 2]);
    h.expect(onTop, 'the card sheet covers the Safe Zone button');
    await page.mouse.click(safe.x + safe.width / 2, safe.y + safe.height / 2);
    await page.waitForFunction(() => window.__daily.route.name === 'safe', null, { timeout: 5000 });
    await h.sleep(300);
    const s = await state(page);
    const left = await page.evaluate(() => document.querySelectorAll('.w2-camp, .w2-camp-sheet, .w2-camp-card, .dq-scene').length);
    h.expect(left === 0 && s.canvases === 0 && s.scenes.live === 0 && s.camp.ids.length === 0 && s.camp.disposed === s.camp.builds, `the camp came into the Safe Zone: ${left} pieces, ${JSON.stringify(s)}`);
    await h.shot(page, 'card-safe-zone');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * on a return visit the camp is live within a moment, while the page is still sliding in: a tap then opens the card on
   * screen at once, and it stays where it opened
   */
  async 'camp-card-at-once'(h) {
    const { ctx, page, errors } = await h.open(seed(h, 30), '?mute', PHONE);
    await toCamp(h, page, 'at once');
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await h.sleep(500);
    const r = await page.evaluate(
      () =>
        new Promise((done) => {
          const t0 = performance.now();
          window.__daily.go({ name: 'shadows' });
          document.querySelector('.w2-camp').scrollIntoView({ block: 'center' });
          let tLive = -1;
          const tick = () => {
            const now = performance.now() - t0;
            if (now > 20000) return done({ err: 'the camp never came back' });
            if (tLive < 0 && document.querySelector('.w2-camp.is-scene-live')) tLive = now;
            // tapped on the first frame after the camp went live
            if (tLive < 0 || now === tLive) return void requestAnimationFrame(tick);
            document.querySelector('.w2-camp-hit[data-shadow="anvil"]').click();
            const rect = (s) => {
              const b = document.querySelector(s)?.getBoundingClientRect();
              return b && { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
            };
            done({ tLive: Math.round(tLive), tTap: Math.round(performance.now() - t0), sheet: rect('.w2-camp-sheet'), card: rect('.w2-camp-card'), vh: innerHeight });
          };
          requestAnimationFrame(tick);
        }),
    );
    console.log(`  at once: live ${r.tLive} ms after going to Shadows, tapped at ${r.tTap} ms`);
    h.expect(!r.err, r.err);
    h.expect(r.tTap - r.tLive <= 100, `the tap came ${r.tTap - r.tLive} ms after the camp went live`);
    h.expect(r.sheet && Math.abs(r.sheet.top) <= 1 && Math.abs(r.sheet.height - r.vh) <= 1, `the sheet is not over the screen: ${JSON.stringify(r)}`);
    // it opens with its own short rise of 16 px, so on its first frame it may sit up to that much lower
    h.expect(r.card && r.card.top >= 0 && r.card.bottom <= r.vh + 17, `the card opened off screen: ${JSON.stringify(r)}`);
    await h.sleep(600);
    const later = await page.locator('.w2-camp-card').boundingBox();
    h.expect(Math.abs(later.y - r.card.top) <= 17, `the card jumped from ${r.card.top} to ${Math.round(later.y)} px after it opened`);
    h.expect(later.y >= 0 && later.y + later.height <= r.vh + 0.5, `the card settled off screen: ${JSON.stringify(later)}`);
    h.expect((await page.locator('.w2-camp-card .w2-sh--anvil').count()) === 1, 'the quick tap did not open Anvil');
    await h.shot(page, 'card-at-once');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** reduced motion, from the device or the game's setting: one still frame, drawn once */
  async 'camp-still'(h) {
    for (const mode of ['device', 'setting']) {
      const { ctx, page, errors } = await h.open(seed(h, 30), '?mute', PHONE);
      if (mode === 'device') {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
      } else {
        await h.openSettings(page);
        await page.getByRole('radio', { name: 'Motion: Reduced', exact: true }).click();
        await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      }
      await toCamp(h, page, `still ${mode}`);
      await h.sleep(800);
      const a = await state(page);
      await h.sleep(2000);
      const b = await state(page);
      h.expect(a.scenes.last.still && b.scenes.frames === a.scenes.frames && b.scenes.frames <= 3, `reduced motion (${mode}): the camp kept drawing (${a.scenes.frames} -> ${b.scenes.frames}, still ${a.scenes.last.still})`);
      await drawn(h, page, `still ${mode}`);
      await buttons(h, page, ALL, `still ${mode}`);
      await h.shot(page, `still-${mode}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** no WebGL (none at all, or a browser that can't make a context): no camp and no canvas, the roster as it always was */
  async 'camp-no-webgl'(h) {
    for (const mode of ['no-context', 'no-webgl2']) {
      const { ctx, page, errors } = await h.open(seed(h, 30), '?mute', PHONE, async (c) => {
        await c.addInitScript((m) => {
          if (m === 'no-webgl2') delete window.WebGL2RenderingContext;
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
            return /webgl/i.test(type) ? null : get.call(this, type, ...rest);
          };
        }, mode);
      });
      await toCamp(h, page, mode, false);
      await h.sleep(2500);
      const s = await state(page);
      const camp = await page.evaluate(() => {
        const c = document.querySelector('.w2-camp');
        return c ? { shown: getComputedStyle(c).display !== 'none', h: c.getBoundingClientRect().height, cls: c.className } : null;
      });
      h.expect(!camp || (!camp.shown && camp.h === 0), `${mode}: the camp still takes room: ${JSON.stringify(camp)}`);
      h.expect(s.canvases === 0 && (!s.scenes || (s.scenes.contexts === 0 && s.scenes.live === 0)), `${mode}: ${JSON.stringify(s)}`);
      h.expect((await page.locator('.w2-roster-row .w2-sh:not(.is-locked)').count()) === ALL.length, `${mode}: the roster lost a card`);
      h.expect(await page.locator('.w2-roster-row .w2-sh-in').first().isVisible(), `${mode}: the roster's name fields are hidden`);
      await h.shot(page, `no-webgl-${mode}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** in and out of Shadows 20 times: one WebGL context throughout, the camp freed each time, released when idle */
  async 'camp-cycles'(h) {
    const { ctx, page, errors } = await h.open(seed(h, 30), '?mute', PHONE);
    await toCamp(h, page, 'cycles');
    const first = await state(page);
    let kept = null;
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await h.sleep(150);
      const out = await state(page);
      h.expect(out.scenes.live === 0 && out.scenes.contexts === 1 && out.canvases === 0 && out.camp.disposed === out.camp.builds && out.camp.ids.length === 0, `cycle ${i}: after leaving ${JSON.stringify(out)}`);
      // three.js keeps one lookup table for its lit materials for as long as the renderer lives; nothing else stays
      kept ??= out.scenes.left?.textures;
      h.expect(out.scenes.left && out.scenes.left.geometries === 0 && out.scenes.left.programs === 0 && kept <= 1 && out.scenes.left.textures === kept, `cycle ${i}: the camp left GPU memory behind: ${JSON.stringify(out.scenes.left)}`);
      await page.evaluate(() => window.__daily.go({ name: 'shadows' }));
      await page.locator('.w2-camp').evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await page.locator('.w2-camp.is-scene-live').waitFor({ timeout: 20000 });
      const s = await state(page);
      h.expect(s.scenes.live === 1 && s.scenes.contexts === 1 && s.canvases === 1 && s.camp.builds === first.camp.builds + i + 1, `cycle ${i}: ${JSON.stringify(s)}`);
    }
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await h.sleep(16000);
    const idle = await state(page);
    h.expect(idle.scenes.contexts === 0 && idle.scenes.live === 0, `idle: the shared renderer kept its context: ${JSON.stringify(idle.scenes)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a lost WebGL context takes the picture and the buttons away, the roster stays; once restored the camp comes back */
  async 'camp-context-restored'(h) {
    const { ctx, page, errors } = await h.open(seed(h, 30), '?mute', PHONE);
    await toCamp(h, page, 'restored');
    await h.sleep(600);
    await page.evaluate(() => {
      window.__lose = document.querySelector('.w2-camp canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await page.waitForFunction(() => !document.querySelector('.w2-camp.is-scene-live'), null, { timeout: 5000 });
    // the picture and the hint fade out
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.w2-camp > .dq-scene')).opacity) < 0.05, null, { timeout: 5000 }).catch(() => {});
    const lost = await page.evaluate(() => ({ hits: [...document.querySelectorAll('.w2-camp-hit')].filter((b) => b.checkVisibility()).length, picture: getComputedStyle(document.querySelector('.w2-camp > .dq-scene')).opacity, hint: getComputedStyle(document.querySelector('.w2-camp-hint')).opacity }));
    h.expect(lost.hits === 0 && Number(lost.picture) < 0.05 && Number(lost.hint) < 0.05, `lost: the camp's picture, buttons or hint still show: ${JSON.stringify(lost)}`);
    h.expect(await page.locator('.w2-roster-row .w2-sh-in').first().isVisible(), 'lost: the roster is hidden');
    await h.shot(page, 'restored-lost');
    const b = await state(page);
    await page.evaluate(() => window.__lose.restoreContext());
    await page.locator('.w2-camp').evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await page.locator('.w2-camp.is-scene-live').waitFor({ timeout: 15000 });
    await h.sleep(1200);
    const c = await state(page);
    h.expect(c.scenes.live === 1 && c.scenes.contexts === 1 && c.scenes.frames > b.scenes.frames + 10, `restored: ${JSON.stringify(c.scenes)}`);
    await drawn(h, page, 'restored');
    await buttons(h, page, ALL, 'restored');
    await h.shot(page, 'restored-back');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * A browser without :has() (Firefox before 121 has WebGL 2 but not :has()) drops every rule that uses it: the camp
   * still comes on screen, and comes back after a lost context
   */
  async 'camp-without-has'(h) {
    const { ctx, page, errors } = await h.open(seed(h, 30), '?mute', PHONE);
    // drops each rule that uses :has() as its stylesheet arrives, as such a browser would
    await page.evaluate(() => {
      const drop = () => {
        for (const s of document.styleSheets) for (let i = s.cssRules.length - 1; i >= 0; i--) if (s.cssRules[i].selectorText?.includes(':has(')) s.deleteRule(i);
      };
      drop();
      setInterval(drop, 20);
    });
    await toCamp(h, page, 'without :has()');
    await drawn(h, page, 'without :has()');
    await page.evaluate(() => {
      window.__lose = document.querySelector('.w2-camp canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await page.waitForFunction(() => !document.querySelector('.w2-camp.is-scene-live'), null, { timeout: 5000 });
    await page.evaluate(() => window.__lose.restoreContext());
    const back = await page.locator('.w2-camp.is-scene-live').waitFor({ timeout: 15000 }).then(() => true, () => false);
    h.expect(back, `restored: the camp never came back (${await page.locator('.w2-camp').getAttribute('class')})`);
    await drawn(h, page, 'without :has(), restored');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a load that fails while it settles the watchers' parts is tried again the next time the camp opens */
  async 'camp-load-retried'(h) {
    const { ctx, page, errors } = await h.open(seed(h, 30), '?mute', PHONE);
    await ctx.addInitScript(settleThrowsOnce);
    await page.reload();
    await toCamp(h, page, 'failed load', false);
    // the stage stops waiting once the load has failed, and the roster is the Watch
    await page.waitForFunction(() => window.__thrown && !document.querySelector('.w2-camp.is-scene-wait'), null, { timeout: 30000 });
    h.expect(!(await page.locator('.w2-camp.is-scene-live').count()), 'failed load: the camp came up anyway');
    h.expect(await page.locator('.w2-roster-row .w2-sh-in').first().isVisible(), 'failed load: the roster is hidden');
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await toCamp(h, page, 'next visit');
    await drawn(h, page, 'next visit');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * Every part of every watcher stands in camp where the model file puts it. The file's positions are quantized and
   * the packer shares identical geometry between figures (the knights' eyes), so a part put back in place for one
   * figure must not move another's.
   */
  async 'camp-parts-in-place'(h) {
    const { ctx, page, errors } = await h.open(seed(h, 30), '?mute', PHONE);
    await toCamp(h, page, 'parts in place');
    const got = await page.evaluate(() => window.__watch?.parts ?? {});
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(fileURLToPath(new URL('../../public/models/watch.glb', import.meta.url)));
    const off = [];
    let n = 0;
    for (const fig of doc.getRoot().listScenes()[0].listChildren()) {
      for (const part of fig.listChildren()) {
        n++;
        const { min, max } = getBounds(part);
        const want = [...min, ...max];
        const have = got[part.getName()];
        const r = (v) => v.map((x) => x.toFixed(3)).join(' ');
        if (!have || have.some((v, i) => Math.abs(v - want[i]) > 0.002)) off.push(`${part.getName()}: ${have ? r(have) : 'missing'}, the file has ${r(want)}`);
      }
    }
    h.expect(n > 0 && Object.keys(got).length === n && !off.length, `parts out of place (${Object.keys(got).length} loaded, ${n} in the file):\n${off.join('\n')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** an old save, before flags, settings and names existed, with six visit days: the camp has Sable, Anvil and Bramble */
  async 'camp-old-save'(h) {
    const now = Date.now();
    const raw = JSON.stringify({ v: 1, events: Array.from({ length: 6 }, (_, i) => ({ id: `old-v${i}`, k: 'visit', xp: 10, t: now - (i + 1) * 864e5, day: dayKey(now - (i + 1) * 864e5) })) });
    const { ctx, page, errors } = await h.open(seed(h, 0, raw), '?mute', PHONE);
    await toCamp(h, page, 'old save');
    const s = await state(page);
    h.expect(JSON.stringify(s.camp.ids) === JSON.stringify(['sable', 'anvil', 'bramble']), `old save: the camp shows ${s.camp.ids}`);
    await buttons(h, page, ['sable', 'anvil', 'bramble'], 'old save');
    await drawn(h, page, 'old save');
    await h.shot(page, 'old-save');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
