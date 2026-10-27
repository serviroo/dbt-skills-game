// Home's sky follows the device's clock: dawn (05:00-08:00), day, dusk (17:00-20:00) and night, which is the sky the
// companion always shows. Each mood is a picture in public/sky/. With Playwright's clock at each mood: Home shows it
// (data-sky, the mood's picture loaded from this origin and painted where it should be), and the Safe Zone button keeps
// its contrast. Every visible text keeps 5.4:1 against the sky at every scroll position, 80 px apart, on a returning
// player's Home with the daily gift opened, from a 320 px phone to a 1920x1080 screen. Crossing 08:00 with Home open
// drifts over seconds without dipping toward night; with reduced motion it switches at once.
// Leaving Home stops its clock watch and gives the other screens the night sky back, at once for the Safe Zone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SIZES = [
  ['390', { width: 390, height: 844 }],
  ['320', { width: 320, height: 568 }],
  ['sideways', { width: 844, height: 390 }],
];
// with the gift opened, which keeps every line a first visit shows (the same elements, colours and sizes) but the
// closed card's, and adds the gift's, so its sweep covers a first visit's too: phones upright and sideways, and the
// common laptop and desktop screens. 1366x768 is left out: it is 1280x720's shape and layout, the column at the same
// share of the screen.
const SCREENS = [
  ['390', { width: 390, height: 844 }],
  ['320', { width: 320, height: 568 }],
  ['sideways', { width: 844, height: 390 }],
  ['1280', { width: 1280, height: 720 }],
  ['1440', { width: 1440, height: 900 }],
  ['1920', { width: 1920, height: 1080 }],
];
const MOODS = { dawn: [6, 30], day: [13, 0], dusk: [18, 30], night: [23, 0] };
// the plain sky before the pictures left every Home text at 5.6:1 or better; a mood may cost a little of that, never
// more, so even the faintest line keeps a clear margin over WCAG AA's 4.5:1
const FLOOR = 5.4;
const DPR = 2;
const DAYTIME = ['dawn', 'day', 'dusk'];

/** A time today in the browser's zone (the harness gives Node the same zone). */
const at = (h, m, s = 0) => new Date(2026, 9, 27, h, m, s).getTime();

/** Every timer, interval and frame callback a page has waiting, with the stack that made it, so a test can ask
 *  which ones a module still holds. Added after the fake clock, so it wraps the clock's timers. */
function trackTimers() {
  const live = new Map();
  const wrap = (set, clear, once) => {
    const s = window[set];
    const c = window[clear];
    window[set] = function (fn, ...rest) {
      const stack = new Error().stack ?? '';
      let id = 0;
      const run = typeof fn === 'function' && once ? function (...a) { live.delete(id); return fn.apply(this, a); } : fn;
      id = s.call(this, run, ...rest);
      live.set(id, stack);
      return id;
    };
    window[clear] = function (id) {
      live.delete(id);
      return c.call(this, id);
    };
  };
  wrap('setTimeout', 'clearTimeout', true);
  wrap('setInterval', 'clearInterval', false);
  wrap('requestAnimationFrame', 'cancelAnimationFrame', true);
  window.__liveTimers = (part) => [...live.values()].filter((s) => s.includes(part)).length;
}

/** The sky as the page has it right now: the mood attribute, how opaque each mood's picture is and which picture it
 *  draws, and how many of its fades are still running. In the page, so a move and a read can share one task. */
function skyReader() {
  window.__readSky = () => {
    const root = document.querySelector('.dq');
    const layers = {};
    const img = {};
    for (const l of root.querySelector(':scope > .dq-sky:not(.dq-sky-top)').children) {
      const cs = getComputedStyle(l);
      const m = l.className.replace('dq-sky-', '');
      layers[m] = Math.round(Number(cs.opacity) * 1000) / 1000;
      img[m] = cs.backgroundImage;
    }
    return {
      mood: root.dataset.sky ?? null,
      screen: root.dataset.screen,
      layers,
      img,
      fading: document.getAnimations().filter((a) => a instanceof CSSTransition && a.effect?.target?.closest?.('.dq-sky')).length,
      hours: new Date().getHours(),
      // the clock the fades run on (the fake clock leaves it alone)
      at: document.timeline.currentTime,
    };
  };
}

/** A returning player's save: five days of visits, with today's greeting, card and check-in done and the daily gift
 *  opened, so Home shows the gift's own lines under the quest. The day turns at 06:00, as the store counts it. */
function returning(h, time) {
  const day = (ms) => {
    const d = new Date(ms - 6 * 3600e3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = day(time);
  const events = Array.from({ length: 5 }, (_, i) => ({ id: `sky-v${i}`, k: 'visit', xp: 10, t: time - i * 864e5, day: day(time - i * 864e5) }));
  const flags = { greetDay: today, cardDay: today, giftDay: today, checkinDay: today, therapistLineShown: true, rankSeen: 9, wardenSeen: true };
  return { [h.SAVE]: JSON.stringify({ v: 1, events, flags }), 'dbt.app.v1': h.SEEN };
}

async function home(h, time, query = '?mute', viewport, seed = { 'dbt.app.v1': h.SEEN }) {
  const r = await h.open(seed, query, viewport, async (ctx) => {
    await ctx.clock.install({ time });
    await ctx.addInitScript(trackTimers);
    await ctx.addInitScript(skyReader);
  });
  await calm(h, r.page);
  return r;
}

/** Home with nothing over it: the first-visit welcome opens a moment after Home appears, so tap until it stays clear. */
async function calm(h, page) {
  for (let quiet = 0, end = Date.now() + 60000; quiet < 4; ) {
    h.expect(Date.now() < end, 'Home never stayed clear of windows');
    await h.reachHub(page);
    const busy = await page.evaluate(() => !!document.querySelector('.dq-scrim.is-on') || [...document.querySelectorAll('.dq-sw')].some((w) => !w.closest('.pwa-hint-layer')));
    quiet = busy ? 0 : quiet + 1;
    await h.sleep(500);
  }
}

const rgba = (s) => {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [r, g, b, a];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], ((a[3] ?? 1) - (b[3] ?? 1)) * 255);

const skyOf = (page) => page.evaluate(() => window.__readSky());

async function settle(h, page) {
  for (const end = Date.now() + 8000; Date.now() < end; await h.sleep(100)) if (!(await skyOf(page)).fading) return;
  throw new Error('the sky never stopped fading');
}

/** Screenshot with extra CSS applied through constructed sheets (no inline style, so the page's CSP never matters).
 *  Transitions are off while the CSS goes on and comes off again, so the page is left exactly as it was. */
async function capture(page, css) {
  await page.evaluate((text) => {
    const still = new CSSStyleSheet();
    still.replaceSync('.dq *, .dq *::before, .dq *::after { transition: none !important; }');
    const look = new CSSStyleSheet();
    look.replaceSync(text);
    window.__shotSheets = [still, look];
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, still, look];
  }, css);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const png = await page.screenshot();
  await page.evaluate(() => {
    const [still, look] = window.__shotSheets;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== look);
    void document.querySelector('.dq').offsetHeight;
    document.querySelectorAll('.dq *').forEach((e) => getComputedStyle(e).color);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== still);
  });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const px = (img, x, y) => {
  const i = (Math.min(img.h - 1, Math.max(0, Math.round(y))) * img.w + Math.min(img.w - 1, Math.max(0, Math.round(x)))) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
/** the mean colour of a 9x9 device-pixel patch around a CSS point */
const patch = (img, x, y) => {
  const acc = [0, 0, 0];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) px(img, x * DPR + dx, y * DPR + dy).forEach((v, i) => (acc[i] += v / 81));
  return acc.map(Math.round);
};

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// the bubbles drift on their own clock, so the pictures leave them out
const NO_BUBBLES = '.dq-bubbles { visibility: hidden !important; }';
const NO_TEXT = `${NO_BUBBLES} .dq, .dq * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }`;
const SKY_ONLY = `${NO_BUBBLES} .dq-view, .dq-top > *, .dq-toast { visibility: hidden !important; }`;

/** Every piece of text the player can see, with the colour it is drawn in and the part of it that shows. */
const textBoxes = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.dq');
    const top = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const out = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()); ) {
      const el = n.parentElement;
      if (!n.data.trim() || !el) continue;
      // decorative, screen-reader-only and disabled text has no contrast minimum
      if (el.closest('[aria-hidden="true"], .dq-sr, :disabled, [aria-disabled="true"]')) continue;
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const cs = getComputedStyle(el);
      if (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') continue;
      let op = 1;
      for (let e = el; e && e !== document.body; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      if (op < 0.05) continue;
      const clips = [];
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') clips.push(e.getBoundingClientRect());
      }
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const b of range.getClientRects()) {
        let [l, t, r, btm] = [b.left, b.top, b.right, b.bottom];
        for (const c of [...clips, { left: 0, top: el.closest('.dq-top') ? 0 : top, right: innerWidth, bottom: innerHeight }]) {
          [l, t, r, btm] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(r, c.right), Math.min(btm, c.bottom)];
        }
        if (r - l < 3 || btm - t < 3) continue;
        out.push({
          text: n.data.trim().slice(0, 40),
          where: el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName.toLowerCase(),
          box: [l, t, r, btm],
          color: cs.color,
          size: parseFloat(cs.fontSize),
          weight: Number(cs.fontWeight),
          op,
        });
      }
    }
    return out;
  });

/** WCAG AA for each visible text: the contrast against the background behind it, taken where it is weakest
 *  (the tenth percentile of the pixels behind its line box, so one stray edge pixel does not decide it). */
async function contrast(page) {
  const boxes = await textBoxes(page);
  const bg = await capture(page, NO_TEXT);
  const rows = [];
  for (const t of boxes) {
    const [r, g, b, a] = rgba(t.color);
    const alpha = a * t.op;
    const scores = [];
    const [l, tp, rt, bt] = t.box.map((v) => v * DPR);
    const step = Math.max(1, Math.floor(Math.min(rt - l, bt - tp) / 12));
    for (let y = Math.ceil(tp); y < bt; y += step)
      for (let x = Math.ceil(l); x < rt; x += step) {
        const p = px(bg, x, y);
        scores.push(ratio(p.map((v, i) => v + ([r, g, b][i] - v) * alpha), p));
      }
    scores.sort((p, q) => p - q);
    const score = scores[Math.floor(scores.length * 0.1)];
    const need = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700) ? 3 : 4.5;
    rows.push({ text: t.text, where: t.where, score: Math.round(score * 100) / 100, need, color: t.color, op: Math.round(t.op * 100) / 100, box: t.box.map(Math.round) });
  }
  return rows;
}

/** Every text's contrast at each scroll position of Home, 80 px apart from the top to the very end. The sky stays put
 *  while the page moves over it, so each line passes over every part of the sky behind its column. */
async function sweep(h, page) {
  const max = await page.evaluate(() => { const r = document.querySelector('.dq'); return r.scrollHeight - r.clientHeight; });
  const rows = [];
  for (let y = 0; ; y = Math.min(y + 80, max)) {
    await page.evaluate((top) => document.querySelector('.dq').scrollTo({ top, behavior: 'instant' }), y);
    await h.sleep(100);
    for (const r of await contrast(page)) rows.push({ ...r, y });
    if (y >= max) return rows;
  }
}
const weakest = (rows) => rows.reduce((a, r) => (r.score < a.score ? r : a));

/** The painted sky alone: the middle of its top edge (under the top bar) and the band just above the ridges, where
 *  dawn and dusk glow (the pictures put the horizon at 43% of a tall one and 55% of a wide one). */
async function skyPixels(page) {
  const img = await capture(page, SKY_ONLY);
  const w = img.w / DPR;
  const { band } = await page.evaluate(() => {
    const l = document.querySelector('.dq > .dq-sky > .dq-sky-night');
    const r = l.getBoundingClientRect();
    // the pictures cover the screen from the top: a tall one is 9:16, a wide one 16:9
    const [iw, ih] = innerWidth >= innerHeight ? [16, 9] : [9, 16];
    const s = Math.max(r.width / iw, r.height / ih);
    return { band: r.top + ih * s * (innerWidth >= innerHeight ? 0.48 : 0.37) };
  });
  const across = [0.2, 0.5, 0.8].map((f) => patch(img, w * f, band));
  // warm: how far red leads blue at the warmest of the three
  return { top: patch(img, w / 2, 6), band: across.map((c) => c.map(Math.round)), warm: Math.max(...across.map((c) => c[0] - c[2])) };
}

/** The mood's own picture, from this origin, decoded, and painted as the page should draw it: covering the screen
 *  from the top. Checked against the file itself at twelve points where the vignette is clear. */
async function paintsPicture(page, mood) {
  const at = await page.evaluate(async (m) => {
    const l = document.querySelector(`.dq > .dq-sky:not(.dq-sky-top) > .dq-sky-${m}`);
    const r = l.getBoundingClientRect();
    const url = getComputedStyle(l).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1] ?? null;
    if (!url) return { url };
    const i = new Image();
    i.src = url;
    await i.decode();
    return { url, same: new URL(url).origin === location.origin, size: [i.naturalWidth, i.naturalHeight], box: [r.left, r.top, r.width, r.height] };
  }, mood);
  if (!at.url) return at;
  const file = path.join(ROOT, 'public', new URL(at.url).pathname);
  const [bx, by, bw, bh] = at.box;
  const [iw, ih] = at.size;
  const s = Math.max(bw / iw, bh / ih);
  const { data, info } = await sharp(file).resize(Math.round(iw * s * DPR), Math.round(ih * s * DPR), { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const want = { data, w: info.width, h: info.height };
  const got = await capture(page, SKY_ONLY);
  const off = (bw - iw * s) / 2;
  const miss = [];
  for (const fx of [0.3, 0.5, 0.7])
    for (const fy of [0.06, 0.2, 0.33, 0.46]) {
      const [x, y] = [bx + bw * fx, by + bh * fy];
      miss.push(Math.round(dist(patch(want, x - bx - off, y - by), patch(got, x, y))));
    }
  return { url: new URL(at.url).pathname, same: at.same, size: at.size, miss: Math.max(...miss) };
}

const SAFE = '.dq-top .dq-safe';
async function safeButton(page) {
  const box = await page.locator(SAFE).first().boundingBox();
  const bg = await capture(page, NO_TEXT);
  const label = rgba(await page.locator(`${SAFE} .dq-safe-t`).first().evaluate((e) => getComputedStyle(e).color));
  const inside = patch(bg, box.x + box.width * 0.62, box.y + box.height / 2);
  const outside = patch(bg, Math.max(5, box.x - 14), box.y + box.height / 2);
  return { label: Math.round(ratio(label, inside) * 100) / 100, inside, outside };
}

async function crossEight(h, page) {
  const left = at(8, 0, 0) - (await page.evaluate(() => Date.now()));
  h.expect(left > 1000, 'the page reached Home after 08:00, so the clock could not be crossed with Home open');
  h.expect((await skyOf(page)).mood === 'dawn', 'Home before 08:00 does not show dawn: ' + JSON.stringify(await skyOf(page)));
  // the clock jumps to 08:00 as if the phone lay still, then runs on a second at a time until the open Home's next
  // look sees the new hour. Jumping well past that look would replay every frame callback of the extra time in one
  // go after the drift had started, and on a slow machine that eats the real seconds the drift is measured in.
  await page.clock.fastForward(left);
  for (let i = 0; i < 40 && (await skyOf(page)).mood !== 'day'; i++) await page.clock.fastForward(1000);
}

const isNight = (s) => s.mood === null && !s.fading && s.layers.night === 1 && DAYTIME.every((m) => s.layers[m] === 0);

/** In the page: reads the sky, makes one move (`how`: 'tap' clicks `arg`, 'history' goes `arg` steps), then reads the
 *  sky again in the same task as the screen the move opened, before any frame of it is drawn. So `after` is exactly
 *  what that screen's first frame shows, and `before` says whether a fade was still running when the move came. */
const moveAndRead = (page, how, arg) =>
  page.evaluate(
    ([how, arg]) => {
      const before = window.__readSky();
      if (how === 'tap') {
        document.querySelector(arg).click();
        return { before, after: window.__readSky() };
      }
      // the app's own popstate listener came first, so this one reads the screen it has just drawn
      return new Promise((done) => {
        // a Back or Forward with nowhere to go never fires popstate; say so instead of waiting forever
        setTimeout(() => done({ before, after: { ...window.__readSky(), stuck: true } }), 3000);
        addEventListener('popstate', () => done({ before, after: window.__readSky() }), { once: true });
        history.go(arg);
      });
    },
    [how, arg],
  );

/** The Safe Zone opened by `move` while the sky was still fading: night from its first frame and still night after. */
async function safeAtOnce(h, page, move, what) {
  const { before, after } = await move();
  h.expect(before.fading > 0, `${what}: the sky had stopped fading before the move, so this proves nothing: ` + JSON.stringify(before));
  h.expect(after.screen === 'safe' && isNight(after), `${what}: the Safe Zone opened mid-fade: ` + JSON.stringify(after));
  await h.sleep(300);
  const later = await skyOf(page);
  h.expect(isNight(later), `${what}: the Safe Zone's sky moved after it opened: ` + JSON.stringify(later));
  return { from: before.layers, first: after.layers };
}

export const scenarios = {
  /** each mood at its hour: the attribute, the painted sky at three sizes and the Safe Zone button, and the closed
   *  card's text at three sizes */
  async 'home-sky-moods'(h) {
    const { expect, out, shot } = h;
    const seen = {};
    for (const [mood, [hh, mm]] of Object.entries(MOODS)) {
      const { ctx, page, errors } = await home(h, at(hh, mm));
      await settle(h, page);
      const sky = await skyOf(page);
      expect(sky.hours === hh, `the page clock reads ${sky.hours}h, not ${hh}h`);
      expect(sky.mood === mood, `at ${hh}:${String(mm).padStart(2, '0')} Home shows ${sky.mood}, not ${mood}`);
      expect(sky.layers[mood] === 1 && DAYTIME.every((m) => m === mood || sky.layers[m] === 0), `${mood}: its picture is not the one showing: ` + JSON.stringify(sky.layers));
      const pictures = {};
      for (const [name, size] of SIZES) {
        await page.setViewportSize(size);
        await h.sleep(500);
        await page.evaluate(() => document.querySelector('.dq').scrollTo({ top: 0, behavior: 'instant' }));
        await shot(page, `${mood}-${name}`);
        const pic = (pictures[name] = await paintsPicture(page, mood));
        const shape = size.width >= size.height ? 'wide' : 'tall';
        expect(pic.url === `/sky/${mood}-${shape}.webp` && pic.same, `${mood} at ${name} does not draw its own ${shape} picture from this origin: ` + JSON.stringify(pic));
        expect(pic.miss <= 10, `${mood} at ${name}: the painted sky is not the picture (off by ${pic.miss}): ` + JSON.stringify(pic));
        if (name === '390') seen[mood] = { px: await skyPixels(page), safe: await safeButton(page) };
        // the day's card is only closed on a first visit (the gift save has it turned over, its back hidden); the back
        // is opaque, so the sky never reaches it and one mood proves it
        if (mood === 'night') {
          await page.evaluate(() => document.querySelector('.dq-card:not(.is-open) .dq-cb-t').scrollIntoView({ block: 'center', behavior: 'instant' }));
          await h.sleep(100);
          const back = (await contrast(page)).filter((r) => r.where === 'dq-cb-t');
          expect(back.length && back.every((r) => r.score >= FLOOR), `the closed card's text at ${name} is missing or below ${FLOOR}:1: ` + JSON.stringify(back));
        }
      }
      fs.writeFileSync(path.join(out, `home-sky-${mood}.json`), JSON.stringify({ sky, pictures, seen: seen[mood] }, null, 2));
      expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    // night is the companion's usual sky: the same as a screen that never follows the clock, here Settings by day
    const { ctx, page } = await home(h, at(13, 0));
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.locator('#set-playerName').waitFor({ timeout: 10000 });
    await settle(h, page);
    const plain = { ...(await skyOf(page)), px: await skyPixels(page) };
    await ctx.close();
    expect(isNight(plain), 'Settings does not show the night sky alone: ' + JSON.stringify(plain));
    expect(dist(seen.night.px.top, plain.px.top) <= 3 && seen.night.px.band.every((c, i) => dist(c, plain.px.band[i]) <= 3), `Home at night is not the usual sky: ${JSON.stringify(seen.night.px)} vs ${JSON.stringify(plain.px)}`);
    // each mood is its own sky: day lifts the top, dawn and dusk warm the horizon, and no two look alike
    const n = seen.night.px;
    expect(seen.day.px.top[2] >= n.top[2] + 10 && seen.day.px.top[1] >= n.top[1] + 8, `day does not lift the sky: ${JSON.stringify(seen.day.px)} vs night ${JSON.stringify(n)}`);
    for (const m of ['dawn', 'dusk']) {
      const p = seen[m].px;
      expect(p.warm > 0 && p.warm >= n.warm + 20 && Math.max(...p.band.map((c) => c[0])) >= Math.max(...n.band.map((c) => c[0])) + 20, `${m} has no warm horizon: ${JSON.stringify(p)} vs night ${JSON.stringify(n)}`);
    }
    const names = Object.keys(seen);
    const look = (p) => [p.top, ...p.band];
    for (const a of names)
      for (const b of names)
        if (a < b) expect(look(seen[a].px).reduce((t, c, i) => t + dist(c, look(seen[b].px)[i]), 0) >= 24, `${a} and ${b} look the same`);
    // the Safe Zone button reads as well as at night in every mood (AAA and within 5%), and keeps its own look
    for (const m of names) {
      const s = seen[m].safe;
      expect(s.label >= 7 && s.label >= seen.night.safe.label * 0.95, `the Safe Zone label is weaker at ${m}: ${s.label} vs night ${seen.night.safe.label}`);
      expect(ratio(s.inside, seen.night.safe.inside) <= 1.1, `the Safe Zone button itself looks different at ${m}: ${s.inside} vs night ${seen.night.safe.inside}`);
    }
    return { moods: Object.fromEntries(names.map((m) => [m, { top: seen[m].px.top, band: seen[m].px.band, safe: seen[m].safe.label }])) };
  },

  /** a returning player with today's gift opened: every text at every scroll position, in each mood, on phones upright
   *  and sideways and on laptop and desktop screens. Every mood and size runs even when one fails, so a failure names
   *  all it reaches. */
  async 'home-sky-contrast'(h) {
    const { expect, out, shot } = h;
    const bad = [];
    const table = {};
    for (const [mood, [hh, mm]] of Object.entries(MOODS)) {
      const time = at(hh, mm);
      const { ctx, page, errors } = await home(h, time, '?mute', SCREENS[0][1], returning(h, time));
      await settle(h, page);
      expect((await skyOf(page)).mood === mood, `Home at ${hh}h is not ${mood}: ` + JSON.stringify(await skyOf(page)));
      expect(await page.locator('.dq-gift:not(.is-hidden) .dq-gift-k').isVisible(), "today's gift is not open on Home");
      table[mood] = {};
      for (const [name, size] of SCREENS) {
        await page.setViewportSize(size);
        await h.sleep(500);
        // the sweep only means something over the mood's own picture, so it starts once that is painted at this size
        const pic = await paintsPicture(page, mood);
        const shape = size.width >= size.height ? 'wide' : 'tall';
        if (pic.url !== `/sky/${mood}-${shape}.webp` || !pic.same || !(pic.miss <= 10)) {
          bad.push(`${mood} at ${name} does not paint its own ${shape} picture: ` + JSON.stringify(pic));
          continue;
        }
        const rows = await sweep(h, page);
        const low = rows.filter((r) => r.score < FLOOR);
        const w = weakest(rows);
        // the three weakest lines, each at its weakest place, so the report shows the sky's own margin next to any text
        // that sits on a panel of its own
        const least = [...new Map([...rows].sort((a, b) => b.score - a.score).map((r) => [r.text, r])).values()].sort((a, b) => a.score - b.score);
        table[mood][name] = { positions: new Set(rows.map((r) => r.y)).size, weakest: least.slice(0, 3).map((r) => ({ text: r.text, where: r.where, score: r.score, y: r.y })) };
        if (rows.length < 10) bad.push(`${mood} at ${name}: only ${rows.length} text pieces found`);
        if (!low.length) continue;
        bad.push(`${mood} at ${name}: ${low.length} text below ${FLOOR}:1, weakest ${JSON.stringify(w)}`);
        await page.evaluate((top) => document.querySelector('.dq').scrollTo({ top, behavior: 'instant' }), w.y);
        await shot(page, `low-${mood}-${name}-y${w.y}`);
      }
      if (errors.length) bad.push(errors.join('\n'));
      await ctx.close();
    }
    fs.writeFileSync(path.join(out, 'home-sky-contrast.json'), JSON.stringify(table, null, 2));
    expect(!bad.length, bad.join('\n'));
    return Object.fromEntries(Object.entries(table).map(([m, t]) => [m, Object.fromEntries(Object.entries(t).map(([n, r]) => [n, r.weakest[0].score]))]));
  },

  /** 07:58 to 08:00 with Home open: day's picture comes in over dawn's over seconds, never in one frame, and dawn's
   *  stays whole under it until it has, so the sky never dips toward night on the way */
  async 'home-sky-drift'(h) {
    const { expect, shot } = h;
    const { ctx, page, errors } = await home(h, at(7, 58, 0));
    await settle(h, page);
    expect((await page.evaluate(() => window.__liveTimers('sky.ts'))) >= 1, 'Home does not watch the clock (no sky timer while open)');
    await crossEight(h, page);
    const series = [];
    for (let i = 0; i < 140; i++) {
      const s = await skyOf(page);
      series.push({ t: Math.round(s.at - (series[0]?.at0 ?? s.at)), at0: series[0]?.at0 ?? s.at, day: s.layers.day, dawn: s.layers.dawn, mood: s.mood, fading: s.fading });
      if (i === 25) await shot(page, 'drift-mid');
      if (series.length > 5 && !s.fading && series.at(-2).fading === 0 && s.mood === 'day' && i > 30) break;
      await h.sleep(90);
    }
    const last = series.at(-1);
    expect(last.mood === 'day' && last.day === 1 && last.dawn === 0, 'Home did not move on to day after 08:00: ' + JSON.stringify(last));
    const moving = series.filter((s) => s.day > 0.02 && s.day < 0.98);
    // how fast the picture came in between each two looks, per second of the fades' own clock, so a slow machine
    // that looks less often still measures the fade and not its own pace; an 8 s ease-in-out peaks near 0.19 a second
    const rates = series.slice(1).map((s, i) => Math.abs(s.day - series[i].day) / Math.max(0.001, (s.t - series[i].t) / 1000));
    const took = moving.length ? moving.at(-1).t - moving[0].t : 0;
    expect(took >= 4000, `the drift took ${took} ms; it should take several seconds: ` + JSON.stringify(series.slice(0, 12)));
    expect(Math.max(...rates) <= 0.4, `the sky came in at ${Math.round(Math.max(...rates) * 100)}% a second at its fastest, faster than an 8 s fade: ` + JSON.stringify(series.slice(0, 40)));
    const dip = series.find((s) => s.day < 1 && s.dawn < 1);
    expect(!dip, 'dawn went before day had come in, so the sky dipped toward night: ' + JSON.stringify(dip));
    expect((await paintsPicture(page, 'day')).miss <= 10, 'after the drift the sky is not the day picture');
    await shot(page, 'drift-day');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { tookMs: took, fastestPerSec: Math.round(Math.max(...rates) * 1000) / 1000, samples: series.length };
  },

  /** reduced motion: the same crossing changes the sky at once, with nothing fading */
  async 'home-sky-reduced'(h) {
    const { expect } = h;
    const { ctx, page, errors } = await home(h, at(7, 58, 0), '?mute&reduced');
    await settle(h, page);
    await crossEight(h, page);
    const looks = [];
    for (let i = 0; i < 6; i++) {
      looks.push(await skyOf(page));
      await h.sleep(80);
    }
    expect(looks.every((s) => s.mood === 'day' && !s.fading), 'with reduced motion the sky faded or did not change: ' + JSON.stringify(looks));
    expect(looks.every((s) => s.layers.day === 1 && s.layers.dawn === 0), 'with reduced motion the sky still moved: ' + JSON.stringify(looks.map((s) => s.layers)));
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** leaving Home ends its clock watch; other screens keep the night sky, the Safe Zone gets it back at once */
  async 'home-sky-leave'(h) {
    const { expect, shot } = h;
    const { ctx, page, errors } = await home(h, at(13, 0));
    await settle(h, page);
    const live = () => page.evaluate(() => window.__liveTimers('sky.ts'));
    expect((await skyOf(page)).mood === 'day' && (await live()) >= 1, 'Home at 13:00 is not day with its clock watch running');
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.locator('#set-playerName').waitFor({ timeout: 10000 });
    expect((await live()) === 0, `${await live()} sky timers still run after leaving Home`);
    await settle(h, page);
    let s = await skyOf(page);
    expect(isNight(s), 'Settings did not get the night sky back: ' + JSON.stringify(s));
    // hours pass on Settings: nothing wakes up and the sky stays night
    await page.clock.fastForward(5 * 60 * 60 * 1000);
    s = await skyOf(page);
    expect((await live()) === 0 && s.mood === null && !s.fading, 'the sky woke up on Settings: ' + JSON.stringify(s));
    // back on Home (now dusk) the watch starts again; the Safe Zone then takes the night sky without a fade
    await page.goBack();
    await calm(h, page);
    await settle(h, page);
    expect((await skyOf(page)).mood === 'dusk' && (await live()) >= 1, 'Home after 18:00 is not dusk with its watch running: ' + JSON.stringify(await skyOf(page)));
    await page.locator(SAFE).first().click();
    await page.locator('.dq[data-screen="safe"]').waitFor({ timeout: 10000 });
    s = await skyOf(page);
    expect(isNight(s), 'the Safe Zone opened with a sky mood or a fade: ' + JSON.stringify(s));
    expect((await live()) === 0, 'sky timers run in the Safe Zone');
    await h.sleep(1200);
    await shot(page, 'safe-zone-at-dusk');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** Home, then another screen, then the Safe Zone before the sky is back to night: the Safe Zone's first frame is
   *  already night at dawn, day and dusk, not the rest of the fade */
  async 'home-sky-safe-mid-fade'(h) {
    const { expect } = h;
    const seen = {};
    const bad = [];
    // every mood runs even when one fails, so a failure says which moods it reaches
    for (const mood of ['dawn', 'day', 'dusk']) {
      const { ctx, page, errors } = await home(h, at(...MOODS[mood]));
      await settle(h, page);
      expect((await skyOf(page)).mood === mood, `Home is not ${mood}: ` + JSON.stringify(await skyOf(page)));
      await page.locator('.dq-momentbtn').click();
      await page.locator('.dq[data-screen="moment"]').waitFor({ timeout: 10000 });
      try {
        seen[mood] = await safeAtOnce(h, page, () => moveAndRead(page, 'tap', SAFE), `${mood}, Give me a moment then the Safe Zone`);
        expect(!errors.length, errors.join('\n'));
      } catch (e) {
        bad.push(e.message);
      }
      await ctx.close();
    }
    expect(!bad.length, bad.join('\n'));
    return seen;
  },

  /** the other ways into the Safe Zone while the sky moves: Forward through history while it fades back to night,
   *  the Safe Zone button while Home's sky is still coming in, and while the hour turns on an open Home */
  async 'home-sky-safe-mid-fade-routes'(h) {
    const { expect } = h;
    const seen = {};
    let { ctx, page, errors } = await home(h, at(...MOODS.dusk));
    await settle(h, page);
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.locator('.dq[data-screen="settings"]').waitFor({ timeout: 10000 });
    await page.locator(SAFE).first().click();
    await page.locator('.dq[data-screen="safe"]').waitFor({ timeout: 10000 });
    for (let i = 0; i < 2; i++) await moveAndRead(page, 'history', -1);
    await calm(h, page);
    await settle(h, page);
    expect((await skyOf(page)).mood === 'dusk', 'Back did not bring Home at dusk: ' + JSON.stringify(await skyOf(page)));
    // Forward to Settings starts the fade back to night; Forward again lands in the Safe Zone in the middle of it
    const toSettings = await moveAndRead(page, 'history', 1);
    expect(toSettings.after.screen === 'settings', 'Forward did not open Settings: ' + JSON.stringify(toSettings.after));
    seen.forward = await safeAtOnce(h, page, () => moveAndRead(page, 'history', 1), 'Forward into the Safe Zone');
    // Back twice to Home, whose sky starts coming in, and the Safe Zone button straight away
    await moveAndRead(page, 'history', -1);
    const toHome = await moveAndRead(page, 'history', -1);
    expect(toHome.after.screen === 'hub', 'Back did not reach Home: ' + JSON.stringify(toHome.after));
    seen.homeFadingIn = await safeAtOnce(h, page, () => moveAndRead(page, 'tap', SAFE), 'the Safe Zone while Home fades in');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();

    ({ ctx, page, errors } = await home(h, at(7, 58, 0)));
    await settle(h, page);
    await crossEight(h, page);
    for (const end = Date.now() + 5000; !(await skyOf(page)).fading; await h.sleep(50)) expect(Date.now() < end, 'dawn never started drifting into day');
    seen.drift = await safeAtOnce(h, page, () => moveAndRead(page, 'tap', SAFE), 'the Safe Zone while the hour turns');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return seen;
  },

  /** the Safe Zone's Lights up reaches the top bar too: the bar's copy of the sky matches the lit screen under it */
  async 'home-sky-safe-lights-up'(h) {
    const { expect, shot } = h;
    const { ctx, page, errors } = await home(h, at(23, 0));
    await page.locator(SAFE).first().click();
    await page.locator('.dq[data-screen="safe"]').waitFor({ timeout: 10000 });
    await page.locator('.dq-top .ca-sz-light').click();
    await page.locator('.dq.ca-szlit').waitFor({ timeout: 10000 });
    await h.sleep(800);
    // only the sky and what lies on it: the same screen with the bar's copy, then without it
    const bare = `${NO_TEXT} .dq-view, .dq-top > * { visibility: hidden !important; }`;
    const copy = await capture(page, bare);
    const under = await capture(page, `${bare} .dq-sky-top { visibility: hidden !important; }`);
    const bar = await page.locator('.dq-top').boundingBox();
    const off = [];
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.3, 0.7]) {
        const [x, y] = [bar.width * fx, bar.y + bar.height * fy];
        const [a, b] = [patch(copy, x, y), patch(under, x, y)];
        if (dist(a, b) > 3) off.push(`at ${Math.round(x)},${Math.round(y)} the bar shows ${a} over the page's ${b}`);
      }
    }
    expect(!off.length, 'with Lights up the top bar is darker than the screen: ' + off.join('; '));
    await shot(page, 'safe-zone-lights-up');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
