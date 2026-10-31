// The Safe Zone and Skip on every screen of the intro, a first visit's too: the first title, the names, a pending load,
// every 3D beat, the chest's hold, the rewards, the letter and the end card, at phone, small phone, sideways and desktop
// sizes and with no WebGL. Both are on top, inside the screen and a few Tabs away. The Safe Zone opens the real Safe
// Zone at once, with no name, welcome, XP, sound or reward first and nothing of the intro after it, and on a first visit
// Leave goes straight to Home. Skip goes straight to Home with everything a watched intro gives. One press leaves the
// intro once: the window under it never moves on, and a double tap or a held Enter lands nowhere else.
import { installAudioRecorder, audioReady, audioRecorded } from './audio-recorder.mjs';
import { until } from './harness.mjs';

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const SIDE = { width: 844, height: 390 };
const DESK = { width: 1440, height: 900 };
// the 3D scene is only a backdrop to these checks: drawn light, as the intro's other DOM checks draw it, so a software
// renderer finishes its frames in the time a capture allows (see screenshot() in harness.mjs)
const LIGHT = '&nopost&msaa=0&dpr=1';
// silent at the speakers: a peak below one step of 16-bit audio and RMS below -100 dBFS, as in safe-zone-quiet
const SILENT_PEAK = 2 ** -15;
const SILENT_RMS = 1e-5;
/** what the intro puts on the page */
const INTRO = '.title-screen, .ui-ways, .rw, .letter-wrap, .endcard, .chest-hold, .lb, .awaken-word, .sw';

/**
 * A first visit (or `seed`) at `query`. The page keeps the companion screens it draws in order, the intro screens
 * added from the press on Safe Zone or Skip, and every cue the audio engine is asked to play, with when.
 */
async function visit(h, query, viewport = PHONE, { seed = {}, prepare } = {}) {
  const opened = await h.open(seed, query, viewport, async (ctx) => {
    await ctx.addInitScript((intro) => {
      window.__screens = [];
      window.__late = [];
      window.__leftAt = null;
      addEventListener('click', (e) => e.target.closest?.('.ui-ways') && (window.__leftAt ??= performance.now()), true);
      new MutationObserver((recs) => {
        const s = document.querySelector('.dq')?.dataset.screen;
        if (s && s !== window.__screens.at(-1)) window.__screens.push(s);
        if (window.__leftAt === null) return;
        for (const r of recs)
          for (const n of r.addedNodes)
            if (n instanceof Element && n.matches(intro) && !n.closest('.dq-sw-layer') && getComputedStyle(n).visibility !== 'hidden') window.__late.push(n.className);
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-screen'] });
    }, INTRO);
    await prepare?.(ctx);
  });
  const { page } = opened;
  await appears(page, '.title-screen', 60000);
  await page.evaluate(async () => {
    window.__cues = [];
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const play = AudioEngine.prototype.play;
    AudioEngine.prototype.play = function (cue, ...args) {
      window.__cues.push({ cue, at: performance.now() });
      return play.call(this, cue, ...args);
    };
  });
  return opened;
}

// The waits here count their timeouts in the time the page could run (see until() in harness.mjs): CI's software renderer
// stops the tab for seconds at a time while it draws the scene, and leaving the intro loads the companion right then.

/** Waits for `sel` to be on the page and drawn, as locator.waitFor() does. */
const appears = (page, sel, timeout) => until(page, (s) => !!document.querySelector(s)?.checkVisibility(), sel, { timeout });

/** Waits for one of the cues the scene plays. */
const cue = (page, name) => until(page, (n) => window.__cues.some((c) => c.cue === n), name, { timeout: 60000, polling: 50 });

/** Waits until `sel` is on top where it shows, faded in, scrolled to as a player would. */
const shown = (page, sel) =>
  until(page, (s) => {
    const b = document.querySelector(s);
    b?.scrollIntoView({ block: 'nearest' });
    const r = b?.getBoundingClientRect();
    return r && r.width && !b.closest('[inert]') && b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && b.getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity);
  }, sel, { timeout: 30000 });

/** The middle of `sel`, scrolled to first if it is out of sight (the end card's buttons never hold still for a Playwright
 *  scroll, so the page scrolls itself). */
const middle = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, sel);

/** A player's tap on the middle of `sel`. */
async function tap(page, sel) {
  await page.mouse.click(...(await middle(page, sel)));
}

/** Taps a closing screen's button and waits for the next screen's. */
async function next(page, button, then) {
  await tap(page, button);
  await shown(page, then);
}

/** The intro's screens, reached the way a player gets there, each from a fresh page at `query`. */
const STAGES = {
  title: { query: `?fresh&mute${LIGHT}`, reach: async () => {} },
  names: { query: `?fresh&mute${LIGHT}`, reach: (page) => next(page, '.title-screen', '.sw .sw-btn.gold') },
  gate: { query: `?shot=gate&mute${LIGHT}`, reach: async (page) => { await page.locator('.title-screen').click(); await cue(page, 'gate_air'); } },
  windows: { query: `?shot=windows&mute${LIGHT}`, reach: async (page) => { await page.locator('.title-screen').click(); await appears(page, '.sw[data-kind="notification"]', 60000); } },
  silhouette: { query: `?shot=silhouette&mute${LIGHT}`, reach: async (page) => { await page.locator('.title-screen').click(); await cue(page, 'whoosh'); } },
  awaken: { query: `?shot=awaken&mute${LIGHT}`, reach: async (page) => { await page.locator('.title-screen').click(); await cue(page, 'awaken_voice'); } },
  chest: { query: `?shot=chest&mute${LIGHT}`, reach: async (page) => { await page.locator('.title-screen').click(); await appears(page, '.chest-hold .ch-target', 60000); } },
  rewards: { query: `?shot=rewards&mute${LIGHT}`, reach: async (page) => { await page.locator('.title-screen').click(); await shown(page, '.rw .sw-btn'); } },
  letter: { query: `?shot=rewards&mute${LIGHT}`, reach: async (page) => { await STAGES.rewards.reach(page); await next(page, '.rw .sw-btn', '.letter .sw-btn'); } },
  endcard: { query: `?shot=rewards&mute${LIGHT}`, reach: async (page) => { await STAGES.letter.reach(page); await next(page, '.letter .sw-btn', '.ec-actions .sw-btn.gold'); } },
};

/** Presses `key` until focus is on `sel`: how many presses it took, or Infinity after 8. */
async function keysTo(page, sel, key) {
  for (let n = 1; n <= 8; n++) {
    await page.keyboard.press(key);
    if (await page.evaluate((s) => document.activeElement?.matches(s), sel)) return n;
  }
  return Infinity;
}

/** Where a tap on `sel` lands on it, found by hit-testing out from its middle: [width, height] in CSS px. */
const tapArea = (page, sel) =>
  page.evaluate((s) => {
    const b = document.querySelector(s);
    const r = b.getBoundingClientRect();
    const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
    const on = (x, y) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && b.contains(document.elementFromPoint(x, y));
    const reach = (dx, dy) => {
      let n = 0;
      while (on(cx + dx * (n + 0.25), cy + dy * (n + 0.25))) n += 0.25;
      return n;
    };
    return [reach(-1, 0) + reach(1, 0), reach(0, -1) + reach(0, 1)];
  }, sel);

/** Scrolls `scroller` to its top and its bottom and returns every line of text it shows behind the Safe Zone or Skip. */
const textBehind = (page, scroller) =>
  page.evaluate(async (s) => {
    const sc = document.querySelector(s);
    const controls = [...document.querySelectorAll('.ui-safe, .ui-skip')].map((b) => b.getBoundingClientRect());
    const found = [];
    for (const end of ['top', 'bottom']) {
      sc.scrollTop = end === 'top' ? 0 : sc.scrollHeight;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const view = sc.getBoundingClientRect();
      const walk = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        if (!t.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(t);
        for (const r of range.getClientRects()) {
          // the part of the line the scroll area shows
          const [top, bottom] = [Math.max(r.top, view.top), Math.min(r.bottom, view.bottom)];
          if (bottom > top && controls.some((c) => r.left < c.right && r.right > c.left && top < c.bottom && bottom > c.top)) found.push(`${end}: "${t.textContent.trim().slice(0, 32)}"`);
        }
      }
    }
    sc.scrollTop = 0;
    return found;
  }, scroller);

/** Both buttons are on screen, inside it, on top of everything at their middle, at least 44 by 44 px to tap, and a few
 *  Tabs or Shift+Tabs from where focus is on this screen. Returns their names. */
async function bothThere(h, page, tag) {
  const found = await page.evaluate(() =>
    ['.ui-safe', '.ui-skip'].map((sel) => {
      const b = document.querySelector(sel);
      if (!b) return { sel, missing: true };
      const r = b.getBoundingClientRect();
      const css = getComputedStyle(b);
      return {
        sel,
        name: b.getAttribute('aria-label') ?? b.textContent,
        box: [r.left, r.top, r.right, r.bottom].map(Math.round),
        inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        onTop: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        shown: css.visibility === 'visible' && +css.opacity === 1 && !b.closest('[inert]'),
      };
    }),
  );
  for (const b of found) h.expect(!b.missing && b.inside && b.onTop && b.shown, `${tag}: ${b.sel} can't be pressed: ${JSON.stringify(b)}`);
  for (const sel of ['.ui-safe', '.ui-skip']) {
    const [w, ht] = await tapArea(page, sel);
    h.expect(w >= 44 && ht >= 44, `${tag}: ${sel} takes taps over ${w} x ${ht} px, under 44 x 44`);
  }
  const from = await page.evaluateHandle(() => document.activeElement);
  const back = () => page.evaluate((e) => (e === document.body ? document.activeElement?.blur() : e.focus({ preventScroll: true })), from);
  for (const sel of ['.ui-safe', '.ui-skip']) {
    const n = [];
    for (const key of ['Tab', 'Shift+Tab']) {
      await back();
      n.push(await keysTo(page, sel, key));
    }
    h.expect(Math.min(...n) <= 4, `${tag}: ${sel} takes ${n[0]} Tabs or ${n[1]} Shift+Tabs from where focus is`);
  }
  await back();
  return found.map((b) => b.name);
}

/** What the page holds once the player has left the intro. */
const after = (page) =>
  page.evaluate((intro) => {
    const app = window.__daily;
    const talk = document.querySelector('.dq-sz-talk');
    const r = talk?.getBoundingClientRect();
    return {
      route: app?.route.name,
      screens: window.__screens,
      late: window.__late,
      cues: window.__cues.filter((c) => c.at >= window.__leftAt).map((c) => c.cue),
      xp: app?.store.derived().xp,
      visits: app?.store.derived().visitDays.length,
      toast: !!document.querySelector('.dq-toast.is-on'),
      windows: [...document.querySelectorAll('.sw')].map((w) => w.getAttribute('aria-label') ?? w.className),
      intro: [...document.querySelectorAll(intro)].filter((n) => !n.closest('.dq-sw-layer') && getComputedStyle(n).visibility !== 'hidden').map((n) => n.className),
      talk: !!r && !talk.classList.contains('is-hidden') && r.top >= 0 && r.bottom <= innerHeight,
      leave: !!document.querySelector('.dq-top .dq-back'),
      seen: JSON.parse(localStorage.getItem('dbt.app.v1') ?? '{}').seenCutscene === true,
      you: localStorage.getItem('dbt.you.v1'),
    };
  }, INTRO);

/** The scene's clock stands still: nothing of the intro runs behind the companion. */
async function sceneStill(h, page, tag) {
  const t = () => page.evaluate(() => window.__stage?.time ?? null);
  const t0 = await t();
  await h.frames(page, 36);
  const t1 = await t();
  h.expect(t0 === t1, `${tag}: the 3D scene still ran behind the companion (${t0} -> ${t1})`);
}

/** The Safe Zone, opened at once from the intro and quiet, with nothing of the intro or of the companion's day first. */
async function safeZoneAtOnce(h, page, tag) {
  await until(page, () => window.__daily?.route.name === 'safe' && !!document.querySelector('.dq-sz-talk'), null, { timeout: 30000 });
  // two seconds of frames at least: long enough for anything the intro still had coming to show
  await h.frames(page, 120);
  const s = await after(page);
  h.expect(s.screens.join(' > ') === 'safe', `${tag}: the companion showed ${s.screens.join(' > ')} on the way to the Safe Zone`);
  h.expect(!s.intro.length && !s.late.length, `${tag}: the intro showed over the Safe Zone: ${[...s.intro, ...s.late].join(', ')}`);
  h.expect(!s.windows.length && !s.toast, `${tag}: a window or toast showed in the Safe Zone: ${s.windows.join(', ')}${s.toast ? ' toast' : ''}`);
  h.expect(s.xp === 0 && s.visits === 0, `${tag}: the visit counted inside the Safe Zone (${s.xp} XP, ${s.visits} days)`);
  h.expect(!s.cues.length, `${tag}: sound was asked for from the press on: ${s.cues.join(', ')}`);
  h.expect(s.talk && s.leave, `${tag}: the Safe Zone opened without Talk to someone now on screen (${s.talk}) or Leave (${s.leave})`);
  h.expect(s.seen, `${tag}: the intro was not kept as seen`);
  await sceneStill(h, page, tag);
  return s;
}

/** Leave goes straight to Home on a first visit; the day's visit and the first welcome come there, once. */
async function leaveToHome(h, page, tag) {
  await page.locator('.dq-top .dq-back').click();
  await until(page, () => window.__daily.route.name === 'hub', null, { timeout: 5000 });
  const closed = await h.reachHub(page);
  const s = await after(page);
  h.expect(s.screens.join(' > ') === 'safe > hub', `${tag}: Leave went ${s.screens.join(' > ')}, not straight to Home`);
  h.expect(s.xp === 10 && s.visits === 1, `${tag}: Home after the Safe Zone has ${s.xp} XP over ${s.visits} days, not the first visit's 10 over 1`);
  h.expect(closed.length === 1, `${tag}: Home after the Safe Zone greeted with ${closed.length} windows (${closed.join(', ')}), not the first welcome once`);
  return s;
}

/** Skip lands on Home at once, with nothing of the intro after it and the first welcome there, as after a watched intro. */
async function homeAtOnce(h, page, tag) {
  await until(page, () => window.__daily?.route.name === 'hub', null, { timeout: 30000 });
  const closed = await h.reachHub(page);
  await h.frames(page, 48);
  const s = await after(page);
  h.expect(s.screens.join(' > ') === 'hub', `${tag}: Skip went ${s.screens.join(' > ')}, not straight to Home`);
  h.expect(!s.intro.length && !s.late.length, `${tag}: the intro showed over Home: ${[...s.intro, ...s.late].join(', ')}`);
  h.expect(s.xp === 10 && s.visits === 1, `${tag}: Home after Skip has ${s.xp} XP over ${s.visits} days, not the first visit's 10 over 1`);
  h.expect(closed.length === 1, `${tag}: Home after Skip greeted with ${closed.length} windows (${closed.join(', ')}), not the first welcome once`);
  h.expect(!s.cues.length, `${tag}: sound was asked for from the press on: ${s.cues.join(', ')}`);
  h.expect(s.seen, `${tag}: the intro was not kept as seen`);
  await sceneStill(h, page, tag);
  return s;
}

/** Holds Space on the chest's hold until it is a third of the way to open, and returns the function that lets it go. */
async function partCharge(page) {
  await page.locator('.chest-hold .ch-target').focus();
  await page.keyboard.down('Space');
  await until(page, () => +document.querySelector('.chest-hold').style.getPropertyValue('--c') >= 1 / 3, null, { timeout: 15000 });
  return () => page.keyboard.up('Space');
}

/** Presses `way` on a fresh page at `at`, a first visit, and checks where it lands. */
async function leaveAt(h, at, way, tag = `${way === 'safe' ? 'Safe Zone' : 'Skip'} at ${at}`) {
  const { ctx, page, errors } = await visit(h, STAGES[at].query);
  try {
    await STAGES[at].reach(page);
    const release = at === 'chest' ? await partCharge(page) : null;
    await tap(page, way === 'safe' ? '.ui-safe' : '.ui-skip');
    if (way === 'safe') await safeZoneAtOnce(h, page, tag);
    else await homeAtOnce(h, page, tag);
    if (release) {
      await release();
      await h.frames(page, 30);
      const s = await after(page);
      h.expect(s.route === (way === 'safe' ? 'safe' : 'hub') && !s.late.length && !s.cues.length, `${tag}: letting go of the hold changed something: ${JSON.stringify(s)}`);
    }
    if (way === 'safe') await leaveToHome(h, page, tag);
    h.expect(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}

/** The intro screens that scroll when they don't fit, by what scrolls. */
const SCROLLS = { names: '.sw-layer', rewards: '.rw', letter: '.letter-wrap' };

/** Both buttons on every intro screen at this size, with no text scrolling behind them: one page for the title and
 *  names, one for each 3D beat and the chest's hold, and one for the rewards, the letter and the end card. */
async function everyStage(h, size, viewport) {
  const names = {};
  const check = async (page, at) => {
    // what a player sees first on a screen that scrolls
    await page.evaluate(() => document.querySelectorAll('.rw, .letter-wrap').forEach((n) => n.scrollTo(0, 0)));
    names[at] = await bothThere(h, page, `${size} ${at}`);
    if (SCROLLS[at]) {
      const behind = await textBehind(page, SCROLLS[at]);
      h.expect(!behind.length, `${size} ${at}: text scrolls behind the Safe Zone or Skip: ${behind.join(', ')}`);
    }
    await h.shot(page, `${size}-${at}`);
  };
  for (const at of ['title', 'gate', 'windows', 'silhouette', 'awaken', 'chest', 'rewards']) {
    const { ctx, page, errors } = await visit(h, STAGES[at].query, viewport);
    try {
      await STAGES[at].reach(page);
      await check(page, at);
      if (at === 'title') {
        await STAGES.names.reach(page);
        await check(page, 'names');
      }
      if (at === 'rewards') {
        await next(page, '.rw .sw-btn', '.letter .sw-btn');
        await check(page, 'letter');
        await next(page, '.letter .sw-btn', '.ec-actions .sw-btn.gold');
        await check(page, 'endcard');
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  }
  return names;
}

/** Where a tap on `sel` lands on it, nearest its middle, with whatever is open over it: null if it is covered. */
const tappable = (page, sel) =>
  page.evaluate((s) => {
    const b = document.querySelector(s);
    const r = b.getBoundingClientRect();
    const spots = [];
    for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) spots.push([r.left + (r.width * i) / 6, r.top + (r.height * j) / 6]);
    const off = ([x, y]) => Math.hypot(x - r.left - r.width / 2, y - r.top - r.height / 2);
    return spots.sort((p, q) => off(p) - off(q)).find(([x, y]) => b.contains(document.elementFromPoint(x, y))) ?? null;
  }, sel);

/** Opens Sound, then taps `sel` once where it shows, as a player would with the Sound panel still open. */
async function tapWithSoundOpen(h, page, sel, tag) {
  await page.locator('.vol-btn').click();
  await page.locator('.vol.is-open .vol-pop').waitFor({ timeout: 10000 });
  const at = await tappable(page, sel);
  h.expect(at, `${tag}: the Sound panel covers ${sel}`);
  await page.mouse.click(...at);
}

/** Settings' Welcome note, opened and read: the note, its sign-off and the gifts that came with it. */
async function welcomeNote(h, page) {
  await h.openSettings(page);
  await page.getByRole('button', { name: 'Welcome note' }).click();
  const win = page.locator('.dq-sw');
  await appears(page, '.dq-sw', 10000);
  await until(page, () => getComputedStyle(document.querySelector('.dq-sw .sw-next') ?? document.body).opacity > 0, null, { timeout: 15000 });
  const text = (await win.innerText()).replace(/\s+/g, ' ');
  await win.press('Enter');
  await h.gone(win, 10000);
  return text;
}

/** The speakers over [from, to] of the audio clock: loudest sample, RMS, and how much of the stretch was read. */
const heard = (page, from, to) =>
  page.evaluate(
    ([from, to]) => {
      const tap = window.__taps[0];
      const q = 128 / tap.context.sampleRate;
      const inside = (k) => k * q >= from && (k + 1) * q <= to;
      const blocks = [...tap.q].filter(([k]) => inside(k));
      // a block the graph never rendered played nothing, so there was nothing to read
      const unrendered = [...tap.unrendered].filter(inside).length;
      let peak = 0;
      let ss = 0;
      for (const [, [p, s]] of blocks) {
        peak = Math.max(peak, p);
        ss += s;
      }
      return { peak, rms: blocks.length ? Math.sqrt(ss / (blocks.length * 128)) : 0, read: (blocks.length * q) / (to - from - unrendered * q) };
    },
    [from, to],
  );

/** No WebGL on this device: getContext gives none, as on a browser with graphics turned off. */
const noWebGL = (ctx) =>
  ctx.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/i.test(type) ? null : get.call(this, type, ...rest);
    };
  });

export const scenarios = {
  /** A first visit's title has the Safe Zone, and it opens the real Safe Zone at once; Leave goes straight to Home */
  async 'first-title-safe-zone'(h) {
    for (const [size, viewport] of [['phone', PHONE], ['small', SMALL]]) {
      const { ctx, page, errors } = await visit(h, '?mute', viewport);
      try {
        await bothThere(h, page, `${size} first title`);
        await page.locator('.ui-safe').click();
        await safeZoneAtOnce(h, page, `${size} Safe Zone from the first title`);
        await h.shot(page, `${size}-safe-zone-from-the-title`);
        await leaveToHome(h, page, `${size} Safe Zone from the first title`);
        await page.reload();
        await appears(page, '.dq-top', 30000);
        h.expect(!(await page.locator('.title-screen').count()), `${size}: the intro played again after help was asked for in it`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** A first visit's title has Skip, and it goes straight to Home */
  async 'first-title-skip'(h) {
    for (const [size, viewport] of [['phone', PHONE], ['small', SMALL]]) {
      const { ctx, page, errors } = await visit(h, '?mute', viewport);
      try {
        await bothThere(h, page, `${size} first title`);
        await page.locator('.ui-skip').click();
        await homeAtOnce(h, page, `${size} Skip from the first title`);
        await h.shot(page, `${size}-home-after-skip`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  ...Object.fromEntries(
    Object.entries({ phone: PHONE, small: SMALL, side: SIDE, desk: DESK }).map(([size, viewport]) => [`both-on-every-stage-${size}`, (h) => everyStage(h, size, viewport)]),
  ),

  /** A name typed but not kept, then the Safe Zone: no name is chosen, and the prompt never takes the press */
  async 'safe-zone-from-the-names'(h) {
    const { ctx, page, errors } = await visit(h, STAGES.names.query);
    try {
      await STAGES.names.reach(page);
      await page.locator('#np-name').fill('Ash');
      await page.locator('.ui-safe').click();
      const s = await safeZoneAtOnce(h, page, 'Safe Zone from the names');
      h.expect(s.you === null, `the Safe Zone from the names chose names: ${s.you}`);
      await leaveToHome(h, page, 'Safe Zone from the names');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** The Safe Zone or Skip while the scene's code or its 3D world is still on its way, or once the code failed to load
   *  and a reload is offered: the companion opens at once, the scene never starts once what it waited on comes, and the
   *  offer goes without reloading */
  async 'leave-while-loading'(h) {
    const cases = [
      ['safe', 'the code on its way', '**/src/cutscene/director.ts*'],
      ['skip', 'the code on its way', '**/src/cutscene/director.ts*'],
      ['safe', 'the 3D world on its way', '**/models/hero.glb'],
      ['safe', 'the code failed', '**/src/cutscene/director.ts*'],
    ];
    for (const [way, load, url] of cases) {
      let release;
      const held = new Promise((r) => (release = r));
      const { ctx, page, errors } = await visit(h, STAGES.names.query, PHONE, {
        prepare: (c) => c.route(url, async (r) => (load.endsWith('failed') ? r.abort('failed') : held.then(() => r.continue()))),
      });
      const tag = `${way} with ${load}`;
      try {
        await STAGES.names.reach(page);
        const asked = page.waitForRequest((r) => r.url().includes(url.replace(/^\*\*|\*$/g, '')), { timeout: 30000 });
        await page.getByRole('button', { name: 'Continue' }).click();
        await asked;
        if (load.endsWith('failed')) await h.poll(page, () => page.getByRole('button', { name: 'Reload' }).count(), Boolean, `${tag}: no reload was offered`, { timeout: 20000 });
        await bothThere(h, page, tag);
        await page.evaluate(() => (window.__samePage = true));
        await tap(page, way === 'safe' ? '.ui-safe' : '.ui-skip');
        await until(page, (w) => window.__daily?.route.name === w, way === 'safe' ? 'safe' : 'hub', { timeout: 30000 });
        release();
        if (way === 'safe') await safeZoneAtOnce(h, page, tag);
        else await homeAtOnce(h, page, tag);
        h.expect(await page.evaluate(() => window.__samePage === true), `${tag}: the page reloaded after the player left the intro`);
        if (way === 'safe') await leaveToHome(h, page, tag);
        // the scene file this case blocks is the one resource that may fail to load
        const real = errors.filter((e) => !/Failed to load resource: net::ERR_FAILED/.test(e));
        h.expect(!real.length, real.join('\n'));
      } finally {
        release();
        await ctx.close();
      }
    }
  },

  /** Sound on: the speakers go silent at the press on the Safe Zone and stay silent while the companion still loads */
  async 'safe-zone-quiet-from-the-press'(h) {
    let release;
    const held = new Promise((r) => (release = r));
    const { ctx, page, errors } = await visit(h, `?shot=windows${LIGHT}`, PHONE, {
      prepare: async (c) => {
        await installAudioRecorder(c);
        await c.route('**/src/daily/index.ts*', (r) => held.then(() => r.continue()));
      },
    });
    try {
      await STAGES.windows.reach(page);
      await audioReady(page);
      await h.sleep(1500);
      await page.evaluate(() => addEventListener('click', (e) => e.target.closest?.('.ui-safe') && (window.__pressAt ??= window.__taps[0].context.currentTime), true));
      await page.locator('.ui-safe').click();
      const at = await page.evaluate(() => window.__pressAt);
      // two and a half seconds of the companion still on its way
      await audioRecorded(page, 0, at + 2.5);
      const before = await heard(page, at - 0.5, at);
      const after = await heard(page, at + 0.05, at + 2.5);
      release();
      h.expect(before.rms > 1e-3, `the intro was not audible before the press (RMS ${before.rms}), so silence proves nothing`);
      h.expect(after.read >= 0.9, `the recorder read only ${Math.round(after.read * 100)}% of the time after the press`);
      h.expect(after.peak < SILENT_PEAK && after.rms < SILENT_RMS, `sound reached the speakers while the Safe Zone loaded (peak ${after.peak}, RMS ${after.rms})`);
      await until(page, () => window.__daily?.route.name === 'safe', null, { timeout: 30000 });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      release();
      await ctx.close();
    }
  },

  /** The Safe Zone at every 3D beat, mid-window, mid-charge and on every closing screen */
  async 'safe-zone-from-every-beat'(h) {
    for (const at of ['gate', 'windows', 'silhouette', 'awaken', 'chest', 'rewards', 'letter', 'endcard']) await leaveAt(h, at, 'safe');
  },

  /** Skip at the names (names kept) and at every 3D beat, mid-window, mid-charge and on every closing screen */
  async 'skip-from-every-stage'(h) {
    for (const at of ['names', 'gate', 'windows', 'silhouette', 'awaken', 'chest', 'rewards', 'letter', 'endcard']) await leaveAt(h, at, 'skip');
  },

  /** A player who names themselves and then skips keeps the names, and has what one who watched to the end has: the
   *  visit, the first welcome, the intro kept as seen, and the welcome note with the moth, the Lantern and the paper star.
   *  The name is "{companion}", as a name that reads like a token stays itself: each name is filled in once */
  async 'skip-gives-what-a-watch-gives'(h) {
    const watched = await visit(h, STAGES.endcard.query);
    let watch;
    try {
      const { page } = watched;
      await STAGES.endcard.reach(page);
      await tap(page, '.ec-actions .sw-btn.gold');
      const closed = await h.reachHub(page);
      const s = await after(page);
      watch = { xp: s.xp, visits: s.visits, seen: s.seen, welcomes: closed.length, note: await welcomeNote(h, page) };
      h.expect(!watched.errors.length, watched.errors.join('\n'));
    } finally {
      await watched.ctx.close();
    }
    const skipped = await visit(h, STAGES.names.query);
    try {
      const { page } = skipped;
      await STAGES.names.reach(page);
      await page.locator('#np-name').fill('{companion}');
      await page.locator('#np-comp').fill('Pip');
      await page.getByRole('button', { name: 'Continue' }).click();
      await cue(page, 'gate_air');
      await page.locator('.ui-skip').click();
      const s = await homeAtOnce(h, page, 'Skip after naming');
      const note = await welcomeNote(h, page);
      const names = [await page.locator('#set-playerName').inputValue(), await page.locator('#set-companion').inputValue()];
      h.expect(names.join() === '{companion},Pip', `Skip after naming kept ${names.join(' and ')}, not {companion} and Pip`);
      const skip = { xp: s.xp, visits: s.visits, seen: s.seen, welcomes: 1, note: note.replaceAll('{companion}', 'Player').replaceAll('Pip', 'Moth') };
      for (const k of ['xp', 'visits', 'seen', 'welcomes', 'note']) h.expect(skip[k] === watch[k], `Skip gave ${k} ${JSON.stringify(skip[k])}, a watched intro ${JSON.stringify(watch[k])}`);
      for (const gift of ['Welcome, Player.', 'The Lantern', 'Moth.', 'A small night moth.', 'Paper star.', 'Folded for luck.'])
        h.expect(watch.note.includes(gift), `the welcome note in Settings has no "${gift}": ${watch.note}`);
      h.expect(!skipped.errors.length, skipped.errors.join('\n'));
      return { watch, skip };
    } finally {
      await skipped.ctx.close();
    }
  },

  /** Help is one tap with the Sound panel open: the tap that closes it still lands on the intro's Skip and Safe Zone, and
   *  in the companion on the Safe Zone, Talk to someone now and a number to call */
  async 'one-tap-with-sound-open'(h) {
    {
      const { ctx, page, errors } = await visit(h, '?mute');
      try {
        await tapWithSoundOpen(h, page, '.ui-skip', 'Skip');
        await homeAtOnce(h, page, 'Skip with Sound open');
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
    {
      const { ctx, page, errors } = await visit(h, '?mute');
      try {
        await tapWithSoundOpen(h, page, '.ui-safe', 'the intro');
        await safeZoneAtOnce(h, page, 'Safe Zone from the intro with Sound open');
        await tapWithSoundOpen(h, page, '.dq-sz-talk', 'the Safe Zone');
        await until(page, () => [...document.querySelectorAll('.dq-sz-t')].some((t) => t.textContent.includes('Talk to someone now')), null, { timeout: 5000 });
        // the number's tap is kept here, as no phone answers it
        await page.evaluate(() =>
          addEventListener('click', (e) => {
            const a = e.target.closest?.('a[href^="tel:"]');
            if (!a) return;
            window.__dialled = a.getAttribute('href');
            e.preventDefault();
          }),
        );
        await tapWithSoundOpen(h, page, 'a[href^="tel:"]', 'Talk to someone now');
        const dialled = await page.evaluate(() => window.__dialled ?? null);
        h.expect(dialled, 'with Sound open, a tap on a number to call only closed the Sound panel');
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    try {
      await h.reachHub(page);
      await tapWithSoundOpen(h, page, 'header .dq-safe', 'Home');
      await until(page, () => window.__daily.route.name === 'safe', null, { timeout: 5000 });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** No WebGL: both on the title, names and every closing screen; the Safe Zone from the rewards, Skip from the end card */
  async 'no-webgl'(h) {
    for (const way of ['safe', 'skip']) {
      const { ctx, page, errors } = await visit(h, '?mute', PHONE, { prepare: noWebGL });
      const tag = `no WebGL, ${way}`;
      try {
        h.expect(!(await page.evaluate(() => !!window.__stage)), `${tag}: the stage was made without WebGL`);
        await bothThere(h, page, `${tag} title`);
        await STAGES.names.reach(page);
        await bothThere(h, page, `${tag} names`);
        await page.getByRole('button', { name: 'Skip', exact: true }).click();
        await shown(page, '.rw .sw-btn');
        await bothThere(h, page, `${tag} rewards`);
        if (way === 'safe') {
          await page.locator('.ui-safe').click();
          await safeZoneAtOnce(h, page, tag);
          await leaveToHome(h, page, tag);
        } else {
          await next(page, '.rw .sw-btn', '.letter .sw-btn');
          await bothThere(h, page, `${tag} letter`);
          await next(page, '.letter .sw-btn', '.ec-actions .sw-btn.gold');
          await bothThere(h, page, `${tag} end card`);
          await h.shot(page, 'no-webgl-endcard');
          await page.locator('.ui-skip').click();
          await homeAtOnce(h, page, tag);
        }
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** A double tap and a held Enter on either button leave the intro once, and land on nothing in what opens */
  async 'double-tap-and-held-enter'(h) {
    const cases = [
      ['double tap on Skip', 'title', '.ui-skip', 'hub'],
      ['double tap on Safe Zone', 'title', '.ui-safe', 'safe'],
      ['held Enter on Skip over a window', 'windows', '.ui-skip', 'hub'],
      ['held Enter on Safe Zone over the names', 'names', '.ui-safe', 'safe'],
    ];
    for (const [tag, at, sel, lands] of cases) {
      const { ctx, page, errors } = await visit(h, STAGES[at].query);
      try {
        await STAGES[at].reach(page);
        if (tag.startsWith('double')) {
          await page.mouse.dblclick(...(await middle(page, sel)));
        } else {
          await page.locator(sel).focus();
          for (let i = 0; i < 8; i++) {
            await page.keyboard.down('Enter');
            await h.sleep(60);
          }
          await page.keyboard.up('Enter');
        }
        await until(page, (r) => window.__daily?.route.name === r && (r === 'hub' || !!document.querySelector('.dq-sz-talk')), lands, { timeout: 30000 });
        const step = () => page.evaluate(() => document.querySelector('.dq-sz-t')?.textContent ?? null);
        const first = await step();
        await h.frames(page, 90);
        const s = await after(page);
        h.expect(s.route === lands && s.screens.join(' > ') === lands, `${tag}: went ${s.screens.join(' > ')}, not just ${lands}`);
        h.expect(!s.late.length, `${tag}: the intro moved on under the press: ${s.late.join(', ')}`);
        h.expect(!(await page.locator('.vol.is-open').count()), `${tag}: the second press opened the speaker`);
        h.expect((await step()) === first, `${tag}: the second press moved the Safe Zone on from "${first}"`);
        h.expect(s.you === null, `${tag}: the press chose names: ${s.you}`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },
};
