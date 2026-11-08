// The camp's sky follows the player's own night on the device's clock. The moon has that night's phase: full on the
// night of the March 2026 eclipse, lost in the sky at the August 2026 new moon, half lit at first quarter, on its right
// in a northern zone, in UTC, Bahia de Banderas and Kolkata, and on its left in Sydney and Johannesburg. It climbs
// across the sky from low on the left at dusk to the top around midnight and down to the right as dawn ends, drifting
// back by day and riding over the pines, and an open camp follows the clock as the hours pass, with no jump on a night
// the clocks change. The stars turn about the pole with the hour, frame by frame. At dusk an amber glow comes up low on
// the right over half an hour and at dawn a rose one on the left, while the faint stars fade; at night neither glows.
// Everything is read off the pixels the camp shows, with reduced motion so the frame holds still where the moon was
// placed, at phone, sideways and desktop sizes.
import sharp from 'sharp';
import { screenshot } from './harness.mjs';
import * as pageClock from './clock.mjs';

const PHONE = { width: 390, height: 844 };
const SIDE = { width: 844, height: 390 };
const DESK = { width: 1440, height: 900 };
const STILL = { reducedMotion: 'reduce' };
const TAU = Math.PI * 2;
/** a sidereal day in hours: the stars come round again in this time */
const STAR_DAY_H = 23.9344696;

/** A time in the run's zone (the harness gives Node and every page the same one). */
const at = (y, mo, d, h, m = 0) => new Date(y, mo - 1, d, h, m).getTime();
/** the app's day for a moment: its day turns at 6 a.m. (src/daily/store.ts) */
const dayKey = (t) => {
  const d = new Date(t - 6 * 36e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** a save with a visit on each of the 30 days before `now`, so the whole Watch is in camp, its windows already seen */
function save(now) {
  const events = Array.from({ length: 30 }, (_, i) => ({ id: `sky-v${i}`, k: 'visit', xp: 10, t: now - i * 864e5, day: dayKey(now - i * 864e5) }));
  const today = dayKey(now);
  return JSON.stringify({ v: 1, events, flags: { greetDay: today, cardDay: today, giftDay: today, checkinDay: today, therapistLineShown: true, rankSeen: 9, wardenSeen: true } });
}

/** Opens the camp with the page's clock at `time`, the clock running on from there. */
async function campAt(h, time, viewport, device = STILL) {
  const seed = { [h.SAVE]: save(time), 'dbt.app.v1': h.SEEN };
  const { ctx, page, errors } = await h.open(seed, '?mute', viewport, (c) => pageClock.install(c, { time }), device);
  await h.reachHub(page);
  await h.sleep(1500);
  await h.reachHub(page);
  await toCamp(h, page);
  return { ctx, page, errors };
}
async function toCamp(h, page) {
  await page.evaluate(() => window.__daily.go({ name: 'shadows' }));
  await page.locator('.w2-roster').waitFor({ timeout: 10000 });
  await page.locator('.w2-camp').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.locator('.w2-camp.is-scene-live').waitFor({ timeout: 30000 });
  // the camp fades in over its first frames; it is read once it is fully there
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.w2-camp > .dq-scene')).opacity) > 0.99, null, { timeout: 5000 });
  await h.frames(page, 4);
}
/** the camp again from Home, so a still camp is built for the clock as it is now */
async function reopen(h, page) {
  await page.evaluate(() => window.__daily.go({ name: 'hub' }));
  await h.reachHub(page);
  await toCamp(h, page);
}
const skyOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__camp.sky ?? null)));

/** The camp's pixels as shown, with its width and height. */
async function grab(page) {
  const { data, info } = await sharp(await screenshot(page.locator('.w2-camp'))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}
const lum = (g, x, y) => {
  const i = (Math.round(y) * g.w + Math.round(x)) * g.c;
  return 0.2126 * g.data[i] + 0.7152 * g.data[i + 1] + 0.0722 * g.data[i + 2];
};

/**
 * The moon's disc where the camp says it is: the mean of its left and right halves inside 80% of its radius, clear of
 * the line between them, and the brightest of each out to the rim; a ring just outside its rim; and the sky beside its
 * halo for comparison.
 */
function disc(g, moon) {
  const cx = ((moon.x + 1) / 2) * g.w, cy = ((1 - moon.y) / 2) * g.h;
  // the moon's quad is 0.36 of the frame's height and its disc the middle fifth of that
  const r = g.h * 0.036;
  const peak = {};
  const half = (side) => {
    let n = 0, s = 0, top = 0;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * side <= r * 0.15) continue;
        // the brightest out to the rim, where a young crescent's thin lit edge is; the mean inside 80% of the radius
        const d2 = x * x + y * y;
        if (d2 < (r * 0.95) ** 2) top = Math.max(top, lum(g, cx + x, cy + y));
        if (d2 < (r * 0.8) ** 2) (n++, (s += lum(g, cx + x, cy + y)));
      }
    }
    peak[side] = top;
    return s / n;
  };
  // the sky beside the halo, left and right of the moon and inside the frame
  let n = 0, s = 0;
  for (let dy = -r; dy <= r; dy += 4) {
    for (const k of [-3.6, -3.2, 3.2, 3.6]) {
      const x = cx + k * r, y = cy + dy;
      if (x >= 0 && x < g.w && y >= 0 && y < g.h) (n++, (s += lum(g, x, y)));
    }
  }
  // just outside the rim, where a halo or a dark edge would show
  let rn = 0, rs = 0;
  for (let a = 0; a < 48; a++) {
    for (const k of [1.08, 1.25, 1.45]) {
      const x = cx + Math.cos((a / 48) * TAU) * r * k, y = cy + Math.sin((a / 48) * TAU) * r * k;
      if (x >= 0 && x < g.w && y >= 0 && y < g.h) (rn++, (rs += lum(g, x, y)));
    }
  }
  const left = +half(-1).toFixed(1), right = +half(1).toFixed(1);
  return { left, right, peakLeft: Math.round(peak[-1]), peakRight: Math.round(peak[1]), ring: +(rs / rn).toFixed(1), sky: +(s / n).toFixed(1), at: [Math.round(cx), Math.round(cy)], r: +r.toFixed(1) };
}

/**
 * The sky on each side, as the mean red over blue of the sky above the trees (down to `low`, a share of the frame's
 * height) in the left and right fifths of the frame, away from the moon, and the stars there: how many pixels stand out
 * from the sky around them.
 */
function horizon(g, moon, low) {
  const cx0 = ((moon.x + 1) / 2) * g.w, cy0 = ((1 - moon.y) / 2) * g.h, clear = (g.h * 0.036 * 5) ** 2;
  const side = (x0, x1) => {
    let r = 0, b = 0;
    for (let y = 0; y < g.h * low; y++) {
      for (let x = Math.floor(g.w * x0); x < g.w * x1; x++) {
        if ((x - cx0) ** 2 + (y - cy0) ** 2 < clear) continue;
        const i = (y * g.w + x) * g.c;
        (r += g.data[i]), (b += g.data[i + 2]);
      }
    }
    return +(r / Math.max(1, b)).toFixed(3);
  };
  const cx = ((moon.x + 1) / 2) * g.w, cy = ((1 - moon.y) / 2) * g.h, keep = (g.h * 0.036 * 5) ** 2;
  let stars = 0;
  for (let y = 2; y < g.h * low; y++) {
    for (let x = 2; x < g.w - 2; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 < keep) continue;
      const l = lum(g, x, y);
      if (l > 40 && l > lum(g, x - 2, y) + 18 && l > lum(g, x + 2, y) + 18 && l > lum(g, x, y - 2) + 18 && l > lum(g, x, y + 2) + 18) stars++;
    }
  }
  return { left: side(0, 0.2), right: side(0.8, 1), stars };
}

/** the sky above the pines, as a share of the frame's height from its top: about the top fifth at every shape */
const SKY_BAND = 0.2;

export const scenarios = {
  /** tonight's phase: full; new, lost in the sky; a young crescent, faint but there; first quarter, lit on the right in
   *  the north and UTC and on the left in Sydney and Johannesburg */
  async 'camp-sky-moon-phase'(h) {
    const runs = [
      ['full', at(2026, 3, 3, 23, 30), {}, (s) => s.lit > 0.95, (d) => d.left > d.sky + 60 && d.right > d.sky + 60 && Math.abs(d.left - d.right) < 40],
      // just past the mean new moon (07:46 UTC on 13 August, about 14 hours after the eclipse's): the moon is lost in
      // the sky, no dark disc, no ring. Midnight in UTC-8, so the moon is at the top of the sky, clear of the pines and
      // the glow, whatever zone this run is in
      ['new', Date.UTC(2026, 7, 13, 8, 0), { timezoneId: 'Etc/GMT+8' }, (s) => s.lit < 0.001, (d) => Math.abs(d.left - d.sky) < 8 && Math.abs(d.right - d.sky) < 8 && Math.abs(d.ring - d.sky) < 8],
      // two and a half days on, a young crescent: its lit edge clearly there, the dark side close to the sky, never
      // darker (no dark disc) and only a faint earthshine above it, at noon in UTC-8, near the top of the sky again
      ['crescent', Date.UTC(2026, 7, 15, 20, 0), { timezoneId: 'Etc/GMT+8' }, (s) => s.lit > 0.05 && s.lit < 0.1 && !s.south, (d) => d.peakRight > d.sky + 60 && d.left > d.sky - 8 && d.left < d.sky + 20],
      ['quarter-north', at(2026, 3, 25, 23, 30), {}, (s) => s.lit > 0.35 && s.lit < 0.65 && !s.south, (d) => d.right > d.sky + 60 && d.right > d.left + 50],
      // 23:30 in Sydney (summer time, UTC+11), whatever zone this run is in
      ['quarter-sydney', Date.UTC(2026, 2, 25, 12, 30), { timezoneId: 'Australia/Sydney' }, (s) => s.lit > 0.35 && s.lit < 0.65 && s.south, (d) => d.left > d.sky + 60 && d.left > d.right + 50],
      // a southern zone without summer time, known by its name (23:30 in Johannesburg, UTC+2), and plain UTC, northern
      ['quarter-johannesburg', Date.UTC(2026, 2, 25, 21, 30), { timezoneId: 'Africa/Johannesburg' }, (s) => s.lit > 0.35 && s.lit < 0.65 && s.south, (d) => d.left > d.sky + 60 && d.left > d.right + 50],
      ['quarter-utc', Date.UTC(2026, 2, 25, 23, 30), { timezoneId: 'UTC' }, (s) => s.lit > 0.35 && s.lit < 0.65 && !s.south, (d) => d.right > d.sky + 60 && d.right > d.left + 50],
      // northern zones without daylight saving whose names start like southern ones or are nowhere on the list: 23:30
      // in Bahia de Banderas (UTC-6, not Bahia in Brazil) and in Kolkata (UTC+5:30)
      ['quarter-bahia-banderas', Date.UTC(2026, 2, 26, 5, 30), { timezoneId: 'America/Bahia_Banderas' }, (s) => s.lit > 0.35 && s.lit < 0.65 && !s.south, (d) => d.right > d.sky + 60 && d.right > d.left + 50],
      ['quarter-kolkata', Date.UTC(2026, 2, 25, 18, 0), { timezoneId: 'Asia/Kolkata' }, (s) => s.lit > 0.35 && s.lit < 0.65 && !s.south, (d) => d.right > d.sky + 60 && d.right > d.left + 50],
    ];
    const seen = {};
    for (const [tag, time, zone, okSky, okDisc] of runs) {
      const { ctx, page, errors } = await campAt(h, time, PHONE, { ...STILL, ...zone });
      const sky = await skyOf(page);
      h.expect(sky && okSky(sky), `${tag}: the camp's night is ${JSON.stringify(sky)}`);
      const d = disc(await grab(page), sky.moon);
      seen[tag] = d;
      console.log(`  ${tag}: lit ${sky.lit.toFixed(3)}, age ${sky.age.toFixed(3)}, disc ${JSON.stringify(d)}`);
      await h.shot(page, `phase-${tag}`);
      h.expect(okDisc(d), `${tag}: the moon's disc shows ${JSON.stringify(d)}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    // the same half-lit moon, the other way round, so the zone and not the frame decides which side is lit
    h.expect(seen['quarter-north'].right - seen['quarter-north'].left > 50 && seen['quarter-sydney'].left - seen['quarter-sydney'].right > 50, 'first quarter is not mirrored between the north and Sydney');
  },

  /** the moon climbs from the left at dusk to the top around midnight and down to the right by dawn, back at the top by
   *  midday, whole and clear of the pines at every point; the stars turn with the hour */
  async 'camp-sky-moon-climbs'(h) {
    for (const [tag, vp] of [['phone', PHONE], ['side', SIDE], ['desk', DESK]]) {
      const first = at(2026, 3, 3, 17, 0);
      const { ctx, page, errors } = await campAt(h, first, vp);
      const marks = [];
      // the night runs from dusk at 17:00 to the end of dawn at 08:00, so 00:30 is its middle; the day goes back from
      // 08:00 to 17:00, so 12:30 is the middle of that
      // and the hours between, where the moon passes the pines
      const hours = [['17:00', first], ['00:30', at(2026, 3, 4, 0, 30)], ['07:59', at(2026, 3, 4, 7, 59)], ['12:30', at(2026, 3, 4, 12, 30)]];
      for (const [hh, mm] of [[18, 45], [20, 0], [22, 0], [26, 30], [29, 0], [30, 45]]) hours.push([`${hh % 24}:${String(mm).padStart(2, '0')}`, at(2026, 3, 3, hh, mm)]);
      for (const [name, time] of hours) {
        if (time !== first) {
          await pageClock.setSystemTime(page, time);
          await reopen(h, page);
        }
        const sky = await skyOf(page);
        const g = await grab(page);
        const d = disc(g, sky.moon);
        marks.push({ name, sky, d });
        console.log(`  ${tag} ${name}: p ${sky.p.toFixed(3)}, moon ${JSON.stringify(sky.moon)}, turn ${sky.turn.toFixed(3)}, disc ${JSON.stringify(d)}`);
        await h.shot(page, `climb-${tag}-${name.replace(':', '')}`);
        // the full moon is there on screen, where the camp put it: whole where it rests (dusk, midnight, dawn, midday),
        // as a pine across either half would darken it; on its way between, it may pass behind a tall pine, never
        // all of it
        // and whole at 06:45 on a desktop, where a pine used to touch it
        const rest = hours.indexOf(hours.find((x) => x[0] === name)) < 4 || (tag === 'desk' && name === '6:45');
        const whole = d.left > d.sky + 60 && d.right > d.sky + 60 && Math.abs(d.left - d.right) < 40;
        h.expect(rest ? whole : Math.max(d.left, d.right) > d.sky + 60, `${tag} ${name}: no ${rest ? 'whole ' : ''}full moon at ${JSON.stringify(d.at)} (${JSON.stringify(d)})`);
        h.expect(d.at[0] - d.r > 0 && d.at[0] + d.r < g.w && d.at[1] - d.r > 0, `${tag} ${name}: the moon is off the frame at ${JSON.stringify(d.at)} in ${g.w} x ${g.h}`);
      }
      const [dusk, mid, dawn, noon] = marks;
      h.expect(dusk.sky.p < 0.01 && Math.abs(mid.sky.p - 0.5) < 0.01 && dawn.sky.p > 0.99 && Math.abs(noon.sky.p - 0.5) < 0.01, `${tag}: the moon's place reads ${marks.map((m) => m.sky.p)}`);
      h.expect(Math.abs(noon.d.at[0] - mid.d.at[0]) < 2 && Math.abs(noon.d.at[1] - mid.d.at[1]) < 2, `${tag}: the moon at 12:30 is not back at the top (${noon.d.at} against ${mid.d.at})`);
      h.expect(dusk.d.at[0] < mid.d.at[0] - 60 && mid.d.at[0] < dawn.d.at[0] - 60, `${tag}: the moon does not cross from left to right (${marks.map((m) => m.d.at[0])})`);
      h.expect(mid.d.at[1] < dusk.d.at[1] - 15 && mid.d.at[1] < dawn.d.at[1] - 15, `${tag}: the moon is not highest at midnight (${marks.map((m) => m.d.at[1])})`);
      // seven and a half hours of night turn the stars as far as seven and a half sidereal hours
      const turned = (((mid.sky.turn - dusk.sky.turn) % TAU) + TAU) % TAU;
      h.expect(Math.abs(turned - (7.5 / STAR_DAY_H) * TAU) < 0.01, `${tag}: the stars turned ${turned.toFixed(3)} rad in seven and a half hours`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** an open, moving camp follows the clock: the stars turn as the seconds pass, and two hours on the moon has climbed */
  async 'camp-sky-follows-open'(h) {
    const first = at(2026, 3, 3, 20, 0);
    const { ctx, page, errors } = await campAt(h, first, PHONE, {});
    const a = await skyOf(page);
    await page.waitForFunction((t) => window.__camp.sky && window.__camp.sky.turn > t, a.turn, { timeout: 10000 }).catch(async (e) => {
      if (e.name !== 'TimeoutError') throw e;
      throw new Error(`the stars of the open camp never turned (${JSON.stringify(await skyOf(page))})`);
    });
    h.expect(Math.abs(a.p - 3 / 15) < 0.01, `the camp opened at 20:00 shows the night at ${a.p}`);
    await pageClock.setSystemTime(page, at(2026, 3, 3, 22, 0));
    await page.waitForFunction((p) => window.__camp.sky && window.__camp.sky.p > p + 0.1, a.p, { timeout: 10000 }).catch(async (e) => {
      if (e.name !== 'TimeoutError') throw e;
      throw new Error(`two hours on, the open camp still shows ${JSON.stringify(await skyOf(page))}`);
    });
    const b = await skyOf(page);
    const route = await page.evaluate(() => window.__daily.route.name);
    console.log(`  20:00 ${JSON.stringify(a.moon)} -> 22:00 ${JSON.stringify(b.moon)}`);
    // it goes on along its path to the right (up or down a little, as it rides over the pines)
    h.expect(Math.abs(b.p - 5 / 15) < 0.01 && b.moon.x > a.moon.x + 0.1 && Math.abs(b.moon.y - a.moon.y) < 0.1, `two hours on, the moon moved from ${JSON.stringify(a.moon)} to ${JSON.stringify(b.moon)} (night at ${b.p})`);
    h.expect(route === 'shadows' && (await page.evaluate(() => window.__camp.builds)) === 1, 'the camp was built again to follow the clock');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a night that changes the clocks (London, 01:00 GMT to 02:00 BST): an open camp's moon and stars go on as they were */
  async 'camp-sky-clock-change'(h) {
    const first = Date.UTC(2026, 2, 29, 0, 58);
    const { ctx, page, errors } = await campAt(h, first, PHONE, { timezoneId: 'Europe/London' });
    const a = await skyOf(page);
    await pageClock.setSystemTime(page, Date.UTC(2026, 2, 29, 1, 2));
    await page.waitForFunction((p) => window.__camp.sky && window.__camp.sky.p > p, a.p, { timeout: 10000 }).catch(async (e) => {
      if (e.name !== 'TimeoutError') throw e;
      throw new Error(`after the clocks changed, the open camp still shows ${JSON.stringify(await skyOf(page))}`);
    });
    const b = await skyOf(page);
    const turned = (((b.turn - a.turn) % TAU) + TAU) % TAU;
    console.log(`  00:58 GMT p ${a.p.toFixed(4)} moon ${JSON.stringify(a.moon)} -> 02:02 BST p ${b.p.toFixed(4)} moon ${JSON.stringify(b.moon)}, stars ${turned.toFixed(4)} rad`);
    // a few minutes of night, not an hour: the moon goes on by about a hundredth of its path and the stars by a degree
    h.expect(b.p - a.p < 0.01 && Math.abs(b.moon.x - a.moon.x) < 0.01 && Math.abs(b.moon.y - a.moon.y) < 0.01, `the moon jumped as the clocks changed: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    h.expect(turned < 0.03, `the stars jumped ${turned.toFixed(3)} rad as the clocks changed`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** amber low on the right at dusk, rose low on the left at dawn, the faint stars fading; neither at night; each glow
   *  comes up over its first half hour */
  async 'camp-sky-dusk-dawn'(h) {
    for (const [tag, vp] of [['phone', PHONE], ['side', SIDE], ['desk', DESK]]) {
      const first = at(2026, 3, 25, 18, 45);
      const { ctx, page, errors } = await campAt(h, first, vp);
      const read = {};
      for (const [mood, time] of [['dusk', first], ['night', at(2026, 3, 25, 22, 30)], ['dawn', at(2026, 3, 26, 6, 45)]]) {
        if (time !== first) {
          await pageClock.setSystemTime(page, time);
          await reopen(h, page);
        }
        const sky = await skyOf(page);
        h.expect(sky.mood === mood && sky.glow === (mood === 'night' ? 0 : 1), `${tag}: at ${new Date(time).toTimeString().slice(0, 5)} the camp's sky is ${sky.mood} at ${sky.glow}, not all ${mood}`);
        read[mood] = horizon(await grab(page), sky.moon, SKY_BAND);
        console.log(`  ${tag} ${mood}: ${JSON.stringify(read[mood])}`);
        await h.shot(page, `glow-${tag}-${mood}`);
      }
      // a quarter hour into dusk its glow is half up: the hour changes the sky gently, not at once
      await pageClock.setSystemTime(page, at(2026, 3, 26, 17, 15));
      await reopen(h, page);
      const early = await skyOf(page);
      h.expect(early.mood === 'dusk' && early.glow > 0.4 && early.glow < 0.6, `${tag}: at 17:15 the dusk glow is at ${early.glow}`);
      const { dusk, night, dawn } = read;
      h.expect(dusk.right > night.right + 0.12 && dusk.right > dusk.left + 0.08, `${tag}: no amber glow low on the right at dusk (${JSON.stringify(read)})`);
      h.expect(dawn.left > night.left + 0.12 && dawn.left > dawn.right + 0.08, `${tag}: no rose glow low on the left at dawn (${JSON.stringify(read)})`);
      h.expect(night.left < 0.75 && night.right < 0.75, `${tag}: the night sky glows warm (${JSON.stringify(night)})`);
      h.expect(dusk.stars < night.stars * 0.8 && dawn.stars < night.stars * 0.8, `${tag}: the faint stars do not fade at dusk and dawn (${dusk.stars}, ${night.stars}, ${dawn.stars})`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },
};
