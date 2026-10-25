const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const TALL = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const WIDE = { width: 844, height: 390 };
const SHORT = { width: 568, height: 320 };
const MID = { width: 375, height: 667 };
const MID_WIDE = { width: 667, height: 375 };
const AUDIO = 'dbt.audio.v1';
const HINT = 'dbt.install-hint.v1';

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function returning(xp = 0) {
  const t = Date.now() - 86400e3;
  const day = dayKey(t);
  const events = [{ id: 'me92-visit', t, day, k: 'visit', xp: 10 }];
  if (xp) events.push({ id: 'me92-rest', t: t + 1, day, k: 'rest', xp });
  return JSON.stringify({ v: 1, created: t, events, flags: { greetDay: day } });
}

async function boot(h, { save, viewport = TALL, reduced = false, ua, extra = {}, init, live = false } = {}) {
  const ctx = await h.browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: reduced ? 'reduce' : 'no-preference', locale: 'en-US', ...(ua ? { userAgent: ua } : {}) });
  if (init) await ctx.addInitScript(init);
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, ...(save ? { [h.SAVE]: save } : {}), ...extra };
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
  await page.goto(h.server.url + '/');
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
  await page.evaluate((live) => {
    const a = window.__daily;
    window.__cues = [];
    window.__tries = [];
    const play = a.opts.sound?.play;
    if (play)
      a.opts.sound.play = (c) => {
        window.__cues.push([a.route.name, c]);
        if (live) play(c);
      };
    if (live) {
      const sound = a.sound.bind(a);
      a.sound = (c) => {
        window.__tries.push([a.route.name, c]);
        sound(c);
      };
    }
  }, live);
  return { ctx, page, errors };
}

const probe = (page) =>
  page.evaluate(() => {
    const a = window.__daily;
    const d = a.store.derived();
    const talk = [...document.querySelectorAll('.dq-sz-talk')].find((b) => !b.classList.contains('is-hidden'));
    let talkOnTop = false;
    if (talk) {
      const r = talk.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      talkOnTop = !!hit && talk.contains(hit) && r.top >= 0 && r.bottom <= innerHeight;
    }
    const c = a.bubbles.canvas;
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < px.length; i += 4) ink += px[i];
    const f = document.activeElement;
    return {
      route: a.route.name,
      windows: document.querySelectorAll('.sw').length,
      hint: document.querySelectorAll('.pwa-hint').length,
      scrim: document.querySelector('.dq-scrim').classList.contains('is-on'),
      windowed: a.root.classList.contains('is-windowed'),
      inert: document.getElementById('dq-main').inert,
      talkOnTop,
      focus: f && f.closest('.dq-safezone') && /^H[12]$/.test(f.tagName) ? 'heading' : `${f?.tagName}.${f?.className}`,
      xp: d.xp,
      stats: JSON.stringify(d.stats),
      bubbles: a.bubbles.density,
      ink,
      fx: document.querySelectorAll('.w2-vesper, .w2-rise').length,
      prefs: localStorage.getItem('dbt.audio.v1'),
      volume: JSON.stringify(window.__dbtVolume?.get()),
      score: window.__dbtVolume?.gains().score,
      cues: window.__cues.filter(([r]) => r === 'safe').map(([, c]) => c),
    };
  });

const tapOutput = () => {
  const connect = AudioNode.prototype.connect;
  window.__taps = [];
  window.__starts = [];
  AudioNode.prototype.connect = function (dest, ...rest) {
    const out = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) {
      const a = this.context.createAnalyser();
      a.fftSize = 32768;
      connect.call(this, a);
      window.__taps.push({ a, from: this.constructor.name });
    }
    return out;
  };
  for (const P of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
    const start = P.start;
    P.start = function (...args) {
      window.__starts.push(Math.max(args[0] ?? 0, this.context.currentTime));
      return start.apply(this, args);
    };
  }
};
const outputLevel = (page) =>
  page.evaluate(() => {
    let rms = 0;
    let peak = 0;
    for (const { a } of window.__taps) {
      const x = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(x);
      let sum = 0;
      for (const v of x) {
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      rms = Math.max(rms, Math.sqrt(sum / x.length));
    }
    const c = window.__taps[0]?.a.context;
    return { rms, peak, t: c?.currentTime ?? 0, span: (window.__taps[0]?.a.fftSize ?? 0) / (c?.sampleRate ?? 1), state: c?.state, from: window.__taps.map((x) => x.from) };
  });
async function listen(h, page, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(await outputLevel(page));
    await h.sleep(650);
  }
  return out;
}
const fmt = (xs) => xs.map((x) => `${x.rms.toExponential(1)}/${x.peak.toExponential(1)}`).join(' ');
const userGains = (page) =>
  page.evaluate(() => {
    const g = window.__dbtVolume.gains();
    return JSON.stringify([g.master, g.music, g.sfx].map((v) => +v.toFixed(4)));
  });
const scoreLevel = (page) => page.evaluate(() => window.__dbtVolume?.gains().score);
async function scoreReaches(h, page, ok, ms) {
  for (let t = 0; t < ms; t += 150) {
    const v = await scoreLevel(page);
    if (typeof v === 'number' && ok(v)) return v;
    await h.sleep(150);
  }
  return scoreLevel(page);
}

function step() {
  const bad = [];
  return {
    ok: (cond, msg) => void (cond || bad.push(msg)),
    end: () => {
      if (bad.length) throw new Error(bad.join('\n'));
    },
  };
}

async function enterSafe(h, page, label, before) {
  const c = step();
  await page.locator('header .dq-safe').click({ timeout: 4000 });
  const s = await probe(page);
  c.ok(s.route === 'safe', `${label}: route is ${s.route}, not the Safe Zone`);
  c.ok(s.windows === 0 && s.hint === 0, `${label}: ${s.windows} window(s) and ${s.hint} install hint(s) still over the Safe Zone`);
  c.ok(!s.scrim && !s.windowed, `${label}: the dim scrim or windowed header is still on`);
  c.ok(s.inert === false, `${label}: #dq-main is still inert`);
  c.ok(s.focus === 'heading', `${label}: focus is on ${s.focus}, not a Safe Zone heading`);
  c.ok(s.talkOnTop, `${label}: "Talk to someone now" is covered or off screen`);
  c.ok(s.xp === before.xp && s.stats === before.stats, `${label}: entering changed XP ${before.xp} -> ${s.xp} or stats`);
  c.ok(s.bubbles === 0, `${label}: bubble density ${s.bubbles} inside the Safe Zone`);
  c.ok(s.fx === 0, `${label}: ${s.fx} effect layer(s) over the Safe Zone`);
  c.ok(s.prefs === before.prefs && s.volume === before.volume, `${label}: entering changed their volume settings`);
  await h.sleep(120);
  const ink = (await probe(page)).ink;
  c.ok(ink === 0, `${label}: bubbles drawn inside the Safe Zone (alpha sum ${ink})`);
  c.end();
  return s;
}

async function useSafe(h, page, label, before) {
  const c = step();
  await page.getByRole('button', { name: 'Calm my body first', exact: true }).click({ timeout: 3000 });
  await page.locator('.dq-ring').waitFor({ timeout: 3000 });
  await h.sleep(600);
  await page.getByRole('button', { name: 'Talk to someone now', exact: true }).click({ timeout: 3000 });
  const links = await page.evaluate(() => {
    const as = [...document.querySelectorAll('.dq-safezone a[href]')];
    const tel = as.find((a) => a.getAttribute('href').startsWith('tel:'));
    tel?.scrollIntoView({ block: 'center' });
    const r = tel?.getBoundingClientRect();
    const hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { tel: as.filter((a) => a.getAttribute('href').startsWith('tel:')).length, sms: as.filter((a) => a.getAttribute('href').startsWith('sms:')).length, telOnTop: !!hit && tel.contains(hit) };
  });
  c.ok(links.tel > 0 && links.sms > 0, `${label}: Talk shows ${links.tel} tel: and ${links.sms} sms: links`);
  c.ok(links.telOnTop, `${label}: the first call link is covered`);
  const s = await probe(page);
  c.ok(s.xp === before.xp && s.stats === before.stats, `${label}: breathing in the Safe Zone changed XP ${before.xp} -> ${s.xp} or stats`);
  c.ok(s.cues.length === 0, `${label}: cues played inside the Safe Zone: ${s.cues.join(', ')}`);
  c.end();
  return s;
}

async function leaveSafe(h, page, label, before) {
  const c = step();
  await page.locator('header .dq-back').click({ timeout: 3000 });
  await page.waitForFunction(() => window.__daily.route.name === 'hub', null, { timeout: 3000 });
  await h.sleep(1500);
  const s = await probe(page);
  c.ok(s.windows === 0 && s.hint === 0 && !s.scrim && !s.inert, `${label}: a window came back after leaving (${s.windows} window, ${s.hint} hint, scrim ${s.scrim})`);
  c.ok(s.xp === before.xp && s.stats === before.stats, `${label}: XP or stats changed by the visit (${before.xp} -> ${s.xp})`);
  c.ok(s.prefs === before.prefs && s.volume === before.volume, `${label}: the visit changed their volume settings`);
  c.end();
  return s;
}

const WINDOWS = {
  gift: {
    save: () => returning(),
    open: (page) => page.locator('.dq-chest').click(),
    kept: async (h, page) => {
      const r = await page.evaluate(() => ({ day: window.__daily.store.state.flags.giftDay, today: window.__daily.store.today(), label: document.querySelector('.dq-chest')?.getAttribute('aria-label') }));
      h.expect(r.day !== r.today && !/opened/.test(r.label ?? ''), `gift: the cancelled gift is not claimable on Home (${JSON.stringify(r)})`);
      await page.locator('.dq-chest').click();
      await page.locator('.dq-sw').waitFor({ state: 'visible', timeout: 5000 });
      await page.evaluate(() => {
        const w = document.querySelector('.dq-sw');
        w.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        w.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      });
      await page.waitForFunction(() => window.__daily.store.state.flags.giftDay === window.__daily.store.today());
      h.expect((await probe(page)).windows === 0, 'gift: accepting it did not close the window');
    },
  },
  welcome: { save: () => null, open: async () => {} },
  rank: {
    save: () => returning(150),
    open: async (page) => {
      await page.evaluate(() => window.__daily.go({ name: 'library' }));
      await page.locator('header .dq-back').click();
    },
    kept: async (h, page) => {
      const r = await page.evaluate(() => ({ rank: window.__daily.store.derived().rank, seen: window.__daily.store.state.flags.rankSeen }));
      h.expect(r.rank >= 1 && r.seen === r.rank, `rank: the new rank is not kept (${JSON.stringify(r)})`);
    },
  },
  'story-delete': {
    save: () => returning(),
    open: async (page) => {
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story } = await ss.create('Kept story');
        await ss.remove(story.id);
        window.__me92story = story.id;
        window.__daily.go({ name: 'stories' });
      });
      await page.getByRole('button', { name: /^Removed/ }).click({ timeout: 5000 });
      await page.getByRole('button', { name: 'Delete for good', exact: true }).click({ timeout: 3000 });
    },
    kept: async (h, page) => {
      await h.sleep(500);
      const kept = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        return (await storyStore(window.__daily.store.key).removed()).some((s) => s.id === window.__me92story);
      });
      h.expect(kept, 'story-delete: the story was deleted after the confirm window was closed by the Safe Zone');
    },
  },
  'install-hint': {
    save: () => returning(),
    ua: SAFARI,
    sel: '.pwa-hint',
    open: async () => {},
    kept: async (h, page) => {
      h.expect((await h.ls(page, HINT)) === null, 'install-hint: closing it for the Safe Zone was stored as a dismissal');
    },
  },
};

async function windowCase(h, kind, { viewport, reduced = false, score = true }) {
  const w = WINDOWS[kind];
  const tag = `${kind}-${viewport.width}x${viewport.height}${reduced ? '-reduced' : ''}`;
  const { ctx, page, errors } = await boot(h, { save: w.save(), viewport, reduced, ua: w.ua });
  try {
    h.expect(await page.evaluate(() => !!window.__daily.opts.sound), `${tag}: no sound callback to watch`);
    await w.open(page);
    await page.locator(w.sel ?? '.dq-sw').first().waitFor({ state: 'visible', timeout: 12000 });
    await h.sleep(400);
    const before = await probe(page);
    await h.shot(page, `me92-${tag}-1-window`);
    await enterSafe(h, page, tag, before);
    await h.shot(page, `me92-${tag}-2-safe`);
    if (score) {
      const v = await scoreReaches(h, page, (x) => x < 0.05, 4000);
      h.expect(before.score > 0.9 && v < 0.05, `${tag}: the score did not fade out in the Safe Zone (level ${before.score} before, ${v} inside)`);
    }
    await useSafe(h, page, tag, before);
    await h.shot(page, `me92-${tag}-3-talk`);
    await leaveSafe(h, page, tag, before);
    if (score) {
      const v = await scoreReaches(h, page, (x) => x > 0.9, 5000);
      h.expect(v > 0.9, `${tag}: the score did not come back after leaving (level ${v})`);
    }
    await w.kept?.(h, page);
    await h.shot(page, `me92-${tag}-4-home`);
    h.expect(!errors.length, `${tag}: page errors: ${errors.join(' | ')}`);
  } finally {
    await ctx.close();
  }
}

async function allWindows(h, opts) {
  const failed = [];
  for (const kind of Object.keys(WINDOWS)) {
    try {
      await windowCase(h, kind, opts);
    } catch (e) {
      failed.push(String(e.message ?? e));
    }
  }
  h.expect(!failed.length, failed.join('\n'));
}

async function allRoutes(h, { viewport, reduced = false }) {
  const tag = `${viewport.width}x${viewport.height}${reduced ? '-reduced' : ''}`;
  const { ctx, page, errors } = await boot(h, { save: returning(), viewport, reduced });
  const failed = [];
  try {
    const routes = await page.evaluate(async () => {
      const a = window.__daily;
      const { SKILL } = await import('/src/content/dbt.ts');
      const { storyStore } = await import('/src/daily/storystore.ts');
      const { artStore } = await import('/src/daily/artstore.ts');
      const { story } = await storyStore(a.store.key).create('A story');
      const t = Date.now();
      await artStore(a.store.key).put({ id: 'me92-piece', kind: 'today', day: a.store.today(), t, updated: t, n: 1, strokes: [{ i: 1, w: 3, p: [20, 20, 80, 80] }] });
      return [
        { name: 'hub' },
        { name: 'skill', id: Object.keys(SKILL)[0] },
        { name: 'rest' },
        { name: 'shadows' },
        { name: 'library' },
        { name: 'diary' },
        { name: 'comfort' },
        { name: 'settings' },
        { name: 'art' },
        { name: 'draw', kind: 'today' },
        { name: 'piece', id: 'me92-piece' },
        { name: 'stories' },
        { name: 'write', id: story.id },
        { name: 'lines' },
        { name: 'ease' },
        { name: 'moment' },
      ];
    });
    for (const route of routes) {
      const label = `${route.name}-${tag}`;
      try {
        await page.evaluate((r) => window.__daily.go(r), route);
        await h.sleep(500);
        const before = await probe(page);
        await enterSafe(h, page, label, before);
        if (route.name === 'hub' || route.name === 'write') await h.shot(page, `me92-route-${label}`);
        await leaveSafe(h, page, label, before);
      } catch (e) {
        failed.push(String(e.message ?? e));
        await page.evaluate(() => window.__daily.go({ name: 'hub' })).catch(() => {});
      }
    }
    const cues = await page.evaluate(() => window.__cues.filter(([r]) => r === 'safe'));
    h.expect(!cues.length, `${tag}: cues inside the Safe Zone: ${JSON.stringify(cues)}`);
    h.expect(!errors.length, `${tag}: page errors: ${errors.join(' | ')}`);
  } finally {
    await ctx.close();
  }
  h.expect(!failed.length, failed.join('\n'));
}

// What each Safe Zone screen must show whole on arrival, on any phone either way up: its choices, or the first thing
// it has. The cold-water caution and both of its choices count (DESIGN.md principle 11).
const ACTS = '.dq-actions--stack .dq-btn';
const SHOWN = {
  start: [ACTS, 4],
  breathe: ['.dq-ring-count', 1],
  squeeze: ['.dq-ring-count', 1],
  cold: ['.dq-small, .dq-timer .dq-btn', 3],
  check: ['.dq-opt', 3],
  stop: [`.dq-sz-stop:not(.is-hidden), ${ACTS}:first-child`, 2],
  reasons: ['.dq-sz-list > li:first-child', 1],
  comfort: ['.dq-sz-list > li:first-child', 1],
  people: ['.dq-person:first-child', 1],
  talk: ['.dq-res-list > li:first-child .dq-res-a:first-child', 1],
  close: [ACTS, 2],
};
const listed = (n, k) => Array.from({ length: n }, (_, i) => ({ id: `me92-${k}${i}`, text: `${k} ${i + 1}, a few words long`, at: Date.now() - 86400e3 }));
const filled = () => JSON.stringify({ ...JSON.parse(returning()), lists: { reasons: listed(3, 'reason'), comfort: listed(3, 'comfort'), activities: [], people: [{ id: 'me92-p1', name: 'Sam', phone: '+1 555 0100', at: Date.now() - 86400e3 }, { id: 'me92-p2', name: 'Robin', phone: '', at: Date.now() - 86400e3 }] } });
// an iPhone with a notch held sideways (the smallest is 812x375): 47 px each side, 21 px for the home bar
const NOTCH = { top: 0, left: 47, right: 47, bottom: 21 };

/**
 * Every Safe Zone screen at one size (ME-127, ME-210). On arrival: what SHOWN names is whole on screen, clear of the top
 * bar, the pinned foot and the screen's safe-area insets, and taps land on it; "Talk to someone now" stays pinned and
 * tappable; every text is at least 20 px and every button, link and picker at least 44 px; nothing scrolls sideways.
 * With notch insets, the top bar's buttons and the Safe Zone keep clear of them. Held sideways, an opened "Add one" box
 * keeps the column's width. Upright, grouping the heading apart from the rest moves no box at all.
 */
async function everyScreen(h, viewport, { insets } = {}) {
  const size = `${viewport.width}x${viewport.height}${insets ? ' with a notch' : ''}`;
  const sideways = viewport.width > viewport.height;
  const { ctx, page, errors } = await boot(h, { save: filled(), viewport, reduced: true });
  const failed = [];
  try {
    if (insets) {
      await (await ctx.newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride', { insets });
      await page.reload();
      await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
    }
    await page.locator('header .dq-safe').click();
    let heading = '';
    for (const [at, [sel, n]] of Object.entries(SHOWN)) {
      const label = `${size} ${at}`;
      await page.evaluate((at) => window.__daily.go({ name: 'safe', at }), at);
      await page.waitForFunction(([was, sel]) => {
        const t = document.querySelector('.dq-sz-body [data-focus]')?.textContent;
        return t && t !== was && !!document.querySelector(`.dq-sz-body :is(${sel})`);
      }, [heading, sel]);
      // fonts in and the screen's fade-in done, so the boxes and screenshots are what the player sees
      await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.querySelectorAll('.dq-sz-body, .dq-sz-body > *')].flatMap((e) => e.getAnimations()).map((a) => a.finished)]));
      heading = await page.locator('.dq-sz-body [data-focus]').textContent();
      const look = (sel) => page.evaluate(([sel, insets]) => {
        const left = insets?.left ?? 0;
        const right = innerWidth - (insets?.right ?? 0);
        const bottom = innerHeight - (insets?.bottom ?? 0);
        const top = document.querySelector('.dq-top').getBoundingClientRect().bottom;
        const name = (e) => (e.getAttribute('aria-label') || e.textContent).trim().replace(/\s+/g, ' ').slice(0, 24);
        // 4 px in from each corner, clear of the rounded corners; anything pinned over a control takes the tap instead,
        // and words or a visual must not sit under the pinned foot
        const off = (e) => {
          const r = e.getBoundingClientRect();
          const at = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4], [r.left + r.width / 2, r.top + r.height / 2]];
          const whole = r.left >= left - 0.5 && r.right <= right + 0.5 && r.top >= top - 0.5 && r.bottom <= bottom + 0.5;
          const f = document.querySelector('.dq-sz-foot').getBoundingClientRect();
          const clear = e.matches('button, a, select') ? at.every(([x, y]) => e.contains(document.elementFromPoint(x, y))) : !(f.height && r.right > f.left && r.left < f.right && r.bottom > f.top + 0.5);
          return whole && clear ? null : `${name(e)} at ${[r.left, r.top, r.right, r.bottom].map(Math.round).join(', ')}`;
        };
        const shown = [...document.querySelectorAll(`.dq-sz-body :is(${sel})`)];
        const talk = document.querySelector('.dq-sz-talk:not(.is-hidden)');
        const t = talk?.getBoundingClientRect();
        const tap = [...document.querySelectorAll('.dq-safezone :is(button, a[href], select), .dq-top .ca-sz-light')].filter((e) => !e.closest('.is-hidden'));
        const words = [...document.querySelectorAll('.dq-safezone *')].filter((e) => !e.closest('button, a, select, .dq-chip, .dq-sr, .dq-ring, .dq-timer-stage, .is-hidden') && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
        const bar = [...document.querySelectorAll('.dq-top button')].filter((b) => b.offsetParent && !b.closest('[hidden], .vol-pop'));
        const zone = document.querySelector('.dq-safezone').getBoundingClientRect();
        return {
          count: shown.length,
          off: shown.map(off).filter(Boolean),
          talk: !talk || (t.bottom <= bottom + 0.5 && talk.contains(document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2))),
          tiny: tap.map((e) => [name(e), e.getBoundingClientRect()]).filter(([, r]) => r.width < 44 || r.height < 44).map(([t, r]) => `${t} ${Math.round(r.width)}x${Math.round(r.height)}`),
          small: [...new Set(words.map((e) => [e.textContent.trim().slice(0, 24), parseFloat(getComputedStyle(e).fontSize)]).filter(([, px]) => px < 20).map(([t, px]) => `"${t}" ${px}px`))],
          bar: bar.map((b) => [name(b) || 'sound', b.getBoundingClientRect()]).filter(([, r]) => r.left < left - 0.5 || r.right > right + 0.5).map(([t, r]) => `${t} at ${Math.round(r.left)}-${Math.round(r.right)}`),
          zone: zone.left >= left - 0.5 && zone.right <= right + 0.5,
          wide: document.documentElement.scrollWidth <= innerWidth,
        };
      }, [sel, insets]);
      const judge = (label, got, sel, n) => {
        if (got.count !== n) failed.push(`${label}: found ${got.count} of the ${n} things (${sel}) it should show`);
        if (got.off.length) failed.push(`${label}: not whole on screen, or covered: ${got.off.join('; ')}`);
        if (!got.talk) failed.push(`${label}: "Talk to someone now" is not pinned and tappable`);
        if (got.tiny.length) failed.push(`${label}: tap targets under 44 px: ${got.tiny.join(', ')}`);
        if (got.small.length) failed.push(`${label}: Safe Zone text under 20 px: ${got.small.join(', ')}`);
        if (got.bar.length) failed.push(`${label}: top bar buttons inside the notch: ${got.bar.join(', ')}`);
        if (!got.zone) failed.push(`${label}: the Safe Zone runs into the notch`);
        if (!got.wide) failed.push(`${label}: the page scrolls sideways`);
      };
      judge(`${label} on arrival`, await look(sel), sel, n);
      if (at === 'cold') {
        // principle 11: "Breathe instead" carries the same weight as Start, not a quieter link under it
        const pair = await page.locator('.dq-sz-body .dq-timer .dq-btn').evaluateAll((bs) => bs.map((b) => `${b.textContent.trim()}: ${b.className} ${Math.round(b.getBoundingClientRect().height)}px`));
        const weights = new Set(pair.map((p) => p.slice(p.indexOf(':'))));
        if (pair.length !== 2 || !/^Breathe instead:/.test(pair[1]) || weights.size !== 1) failed.push(`${label}: Start and "Breathe instead" are not two choices of the same weight: ${pair.join(' | ')}`);
      }
      await h.shot(page, `me92-every-${at}-${size.replace(/ /g, '-')}`);
      if (sideways && at === 'reasons') {
        const add = page.getByRole('button', { name: 'Add one' });
        await add.evaluate((b) => b.scrollIntoView({ block: 'center' }));
        await add.click();
        const row = await page.evaluate(() => {
          const r = document.querySelector('.dq-sz .dq-addrow');
          return { row: r.getBoundingClientRect().width, field: r.querySelector('.dq-field').getBoundingClientRect().width };
        });
        if (row.field < Math.min(row.row - 1, 240)) failed.push(`${label}: with Add one open the text box is squeezed to ${Math.round(row.field)} of ${Math.round(row.row)} px`);
      }
      if (!sideways && !insets) {
        // live counters (the breathing word and number) are left out: they change while the boxes are read
        const boxes = () => page.evaluate(() => [...document.querySelectorAll('.dq-safezone *')].filter((e) => e instanceof HTMLElement && !e.matches('.dq-sz-lead, .dq-sz-main') && !e.closest('.dq-ring-center, .dq-timer-center')).map((e) => `${e.tagName.toLowerCase()}.${e.className} ${e.offsetLeft},${e.offsetTop},${e.offsetWidth},${e.offsetHeight}`));
        const grouped = await boxes();
        await page.evaluate(() => document.querySelectorAll('.dq-sz-lead, .dq-sz-main').forEach((w) => w.replaceWith(...w.childNodes)));
        const flat = await boxes();
        const moved = grouped.filter((b, i) => b !== flat[i]);
        if (grouped.length !== flat.length || moved.length) failed.push(`${label}: grouping the heading moved ${moved.length} of ${grouped.length} boxes: ${moved.slice(0, 3).join(' | ')}`);
      }
      if (at === 'cold') {
        // once Start is tapped, the countdown and "Breathe instead" are on screen together (principle 11)
        await page.getByRole('button', { name: 'Start 30 seconds', exact: true }).click();
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const running = '.dq-timer-num, .dq-timer .dq-btn';
        judge(`${label} after Start`, await look(running), running, 2);
        await h.shot(page, `me92-every-cold-started-${size.replace(/ /g, '-')}`);
      }
    }
    if (insets) {
      await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await page.locator('.dq-tile').first().waitFor();
      const bar = await page.evaluate((insets) => [...document.querySelectorAll('.dq-top :is(button, .dq-brand)')].filter((b) => b.offsetParent && !b.closest('.vol-pop')).map((b) => [(b.getAttribute('aria-label') || b.textContent).trim().slice(0, 24), b.getBoundingClientRect()]).filter(([, r]) => r.left < insets.left - 0.5 || r.right > innerWidth - insets.right + 0.5).map(([t, r]) => `${t} at ${Math.round(r.left)}-${Math.round(r.right)}`), insets);
      if (bar.length) failed.push(`${size} Home: top bar inside the notch: ${bar.join(', ')}`);
    }
    if (errors.length) failed.push(`${size}: ${errors.join(' | ')}`);
  } finally {
    await ctx.close();
  }
  return failed;
}

export const scenarios = {
  'safe-zone-stays-quiet': async (h) => {
    const { ctx, page, errors } = await boot(h, { save: returning() });
    const c = step();
    try {
      const before = await probe(page);
      await page.locator('header .dq-safe').click();
      await h.sleep(200);
      const inside = await probe(page);
      c.ok(inside.xp === before.xp && inside.stats === before.stats, `quiet: entry changed XP ${before.xp} -> ${inside.xp} or stats`);
      c.ok(inside.ink === 0 && inside.bubbles === 0, `quiet: bubbles remain (density ${inside.bubbles}, alpha ${inside.ink})`);
      try { await useSafe(h, page, 'quiet', before); } catch (e) { c.ok(false, e.message); }
      await h.shot(page, 'me92-quiet-breathing-talk');
      const score = await scoreReaches(h, page, (v) => v < 0.05, 4000);
      c.ok(score < 0.05, `quiet: score did not fade out (${score})`);
      c.ok(!errors.length, `quiet: ${errors.join(' | ')}`);
      c.end();
    } finally { await ctx.close(); }
  },

  'safe-zone-over-windows-390': (h) => allWindows(h, { viewport: TALL }),
  'safe-zone-over-windows-390-reduced': (h) => allWindows(h, { viewport: TALL, reduced: true }),
  'safe-zone-over-windows-320': (h) => allWindows(h, { viewport: SMALL, score: false }),
  'safe-zone-over-windows-320-reduced': (h) => allWindows(h, { viewport: SMALL, reduced: true, score: false }),
  'safe-zone-over-windows-landscape': (h) => allWindows(h, { viewport: WIDE, score: false }),
  'safe-zone-over-windows-landscape-reduced': (h) => allWindows(h, { viewport: WIDE, reduced: true, score: false }),
  'safe-zone-from-every-route': async (h) => {
    await allRoutes(h, { viewport: TALL });
    await allRoutes(h, { viewport: SMALL, reduced: true });
    await allRoutes(h, { viewport: WIDE });
  },
  'safe-zone-every-screen-sideways': async (h) => {
    const failed = [...(await everyScreen(h, WIDE)), ...(await everyScreen(h, MID_WIDE)), ...(await everyScreen(h, SHORT))];
    h.expect(!failed.length, failed.join('\n'));
  },
  'safe-zone-every-screen-upright': async (h) => {
    const failed = [...(await everyScreen(h, TALL)), ...(await everyScreen(h, MID)), ...(await everyScreen(h, SMALL))];
    h.expect(!failed.length, failed.join('\n'));
  },
  // principle 11: "Breathe instead" goes straight to breathing, whose Next then skips past cool water; the quiet Next
  // skips too. Each screen is told apart by the heading the player sees.
  'safe-zone-cold-breathe-instead': async (h) => {
    const { ctx, page, errors } = await boot(h, { save: returning(), reduced: true });
    const c = step();
    await page.evaluate(async () => {
      const { SAFE } = await import('/src/content/dbt.ts');
      const { typo } = await import('/src/daily/ui.ts');
      const by = new Map([[SAFE.breathe.title, 'breathe'], [SAFE.squeeze.title, 'squeeze'], [SAFE.cold.title, 'cold'], [SAFE.check, 'check']].map(([t, at]) => [typo(t), at]));
      window.__me92at = () => {
        const t = document.querySelector('.dq-sz-body [data-focus]')?.textContent ?? '';
        return by.get(t) ?? t;
      };
    });
    const at = () => page.evaluate(() => window.__me92at());
    const reach = (want, timeout) => page.waitForFunction((w) => window.__me92at() === w, want, { timeout });
    const tap = async (name, want) => {
      await page.getByRole('button', { name, exact: true }).click({ timeout: 3000 });
      await reach(want, 3000).catch(() => {});
      return at();
    };
    const open = async (to) => {
      await page.evaluate((to) => window.__daily.go({ name: 'safe', at: to }), to);
      await reach(to);
    };
    try {
      await page.locator('header .dq-safe').click();
      for (const start of [true, false]) {
        const tag = start ? 'after Start' : 'before Start';
        await open('cold');
        if (start) await page.getByRole('button', { name: 'Start 30 seconds', exact: true }).click();
        c.ok((await tap('Breathe instead', 'breathe')) === 'breathe', `${tag}: "Breathe instead" did not open breathing (at ${await at()})`);
        c.ok((await tap('Next', 'check')) === 'check', `${tag}: Next after breathing instead went to ${await at()}, not past cool water`);
      }
      await open('cold');
      c.ok((await tap('Next', 'check')) === 'check', `cold's own Next went to ${await at()}`);
      await open('breathe');
      c.ok((await tap('Next', 'squeeze')) === 'squeeze', `breathing reached the usual way went to ${await at()}, not squeeze`);
      c.ok(!errors.length, errors.join(' | '));
      c.end();
    } finally {
      await ctx.close();
    }
  },
  'safe-zone-every-screen-notch': async (h) => {
    const failed = [...(await everyScreen(h, WIDE, { insets: NOTCH })), ...(await everyScreen(h, { width: 812, height: 375 }, { insets: NOTCH }))];
    h.expect(!failed.length, failed.join('\n'));
  },

  'safe-zone-cancels-queued-windows': async (h) => {
    const { ctx, page, errors } = await boot(h, { save: returning() });
    try {
      await page.evaluate(() => {
        const a = window.__daily;
        window.__answers = [];
        for (const title of ['First', 'Second', 'Third']) void a.window({ kind: 'notification', title, html: '<p>Queued.</p>', tapToContinue: true }).then((v) => window.__answers.push(v));
      });
      await page.locator('.dq-sw').first().waitFor({ state: 'visible', timeout: 5000 });
      const before = await probe(page);
      await enterSafe(h, page, 'queued', before);
      await h.sleep(1500);
      const r = await page.evaluate(() => ({ windows: document.querySelectorAll('.sw').length, answers: window.__answers }));
      h.expect(r.windows === 0, `queued: ${r.windows} queued window(s) opened over the Safe Zone`);
      h.expect(r.answers.length === 3 && r.answers.every((v) => v === 'dismissed'), `queued: callers got ${JSON.stringify(r.answers)}, not three "dismissed"`);
      await leaveSafe(h, page, 'queued', before);
      h.expect(!errors.length, `queued: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  },

  'safe-zone-cancels-closing-actions': async (h) => {
    const { ctx, page, errors } = await boot(h, { save: returning() });
    try {
      await WINDOWS['story-delete'].open(page);
      await page.getByRole('button', { name: 'Delete', exact: true }).waitFor({ state: 'visible' });
      await page.evaluate(() => {
        [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete')?.click();
        document.querySelector('header .dq-safe')?.click();
      });
      await page.locator('header .dq-back').click();
      await h.sleep(700);
      await WINDOWS['story-delete'].kept(h, page);
      h.expect((await probe(page)).windows === 0, 'closing: a window came back after the cancelled action');
      h.expect(!errors.length, `closing: ${errors.join(' | ')}`);
    } finally { await ctx.close(); }
  },

  'safe-zone-cancels-reduced-callbacks': async (h) => {
    const { ctx, page, errors } = await boot(h, { save: returning(), reduced: true });
    try {
      await page.evaluate(async () => {
        const { LanternWindow, lanternLayer } = await import('/src/ui/lantern-window.ts');
        window.__lateCues = [];
        const w = new LanternWindow(lanternLayer(), { title: 'Quiet', html: '<p>Quiet.</p>', tapToContinue: true, onCue: (c) => window.__lateCues.push(c) });
        w.root.classList.add('dq-sw--still');
        void w.open();
        void w.waitForInput().then((v) => window.__lateAnswer = v);
        window.__daily.go({ name: 'safe' });
      });
      await h.sleep(400);
      const r = await page.evaluate(() => ({ cues: window.__lateCues, answer: window.__lateAnswer, windows: document.querySelectorAll('.sw').length }));
      h.expect(r.cues.length === 0 && r.answer === 'dismissed' && r.windows === 0, `reduced callbacks: ${JSON.stringify(r)}`);
      h.expect(!errors.length, `reduced callbacks: ${errors.join(' | ')}`);
    } finally { await ctx.close(); }
  },

  'safe-zone-refuses-late-windows': async (h) => {
    const { ctx, page, errors } = await boot(h, { save: returning() });
    try {
      await page.locator('.dq-chest').click();
      await page.locator('header .dq-safe').click({ timeout: 3000 });
      await h.sleep(1500);
      const r = await probe(page);
      h.expect(r.route === 'safe' && r.windows === 0 && !r.scrim && !r.inert && r.talkOnTop, `late: the gift window opened inside the Safe Zone (${r.windows} window, scrim ${r.scrim}, inert ${r.inert})`);
      await page.locator('header .dq-back').click({ timeout: 3000 });
      await h.sleep(1500);
      const home = await page.evaluate(() => ({ windows: document.querySelectorAll('.sw').length, giftDay: window.__daily.store.state.flags.giftDay, today: window.__daily.store.today() }));
      h.expect(home.windows === 0 && home.giftDay !== home.today, `late: after leaving, ${home.windows} window(s) and the gift marked opened (${home.giftDay})`);
      await page.locator('.dq-chest').click();
      await page.locator('.dq-sw').waitFor({ state: 'visible', timeout: 5000 });
      await h.shot(page, 'me92-late-gift-still-there');
      h.expect(!errors.length, `late: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  },

  'install-hint-waits-out-safe-zone': async (h) => {
    for (const viewport of [TALL, SMALL]) {
      const tag = `hint-race-${viewport.width}`;
      const { ctx, page, errors } = await boot(h, { save: returning(), viewport, ua: SAFARI });
      try {
        h.expect((await probe(page)).hint === 0, `${tag}: the hint was already up before the race`);
        await page.locator('header .dq-safe').click({ timeout: 3000 });
        await h.sleep(3000);
        const s = await probe(page);
        h.expect(s.route === 'safe' && s.hint === 0 && s.talkOnTop, `${tag}: the install hint arrived over the Safe Zone (${s.hint}, talk on top ${s.talkOnTop})`);
        await h.shot(page, `me92-${tag}`);
        h.expect((await h.ls(page, HINT)) === null, `${tag}: the hint was stored as dismissed without being shown`);
        h.expect(!errors.length, `${tag}: page errors: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  'safe-zone-clears-effects': async (h) => {
    const { ctx, page, errors } = await boot(h, { save: returning() });
    try {
      await page.evaluate(async () => (await import('/src/daily/roster.ts')).awakenRise(window.__daily));
      const before = await probe(page);
      h.expect(before.fx === 1, `effects: the rising shadows did not start (${before.fx})`);
      await enterSafe(h, page, 'effects', before);
      h.expect(!errors.length, `effects: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  },

  // Measured at the speakers, where the score, its reverb, beds and effects all end up. Silent means a peak below
  // 2^-15 (one step of 16-bit audio) and RMS below 1e-5 (-100 dBFS).
  'safe-zone-silences-effect-echo': async (h) => {
    const prefs = JSON.stringify({ v: 1, master: 0.8, music: 0, sfx: 1, muted: false });
    const { ctx, page, errors } = await boot(h, { save: returning(), init: tapOutput, live: true, extra: { [AUDIO]: prefs } });
    const c = step();
    try {
      await h.sleep(3000);
      const before = await probe(page);
      await page.evaluate(() => ['reward_chime', 'chest_burst', 'soft_chime'].forEach((cue) => window.__daily.sound(cue)));
      await h.sleep(250);
      const ringing = await outputLevel(page);
      await enterSafe(h, page, 'echo', before);
      const entered = (await outputLevel(page)).t;
      await h.sleep(3000);
      const inside = await listen(h, page, 3);
      c.ok(ringing.rms > 1e-3, `echo: the effects never reached the speakers (${fmt([ringing])})`);
      c.ok(inside[0].t - entered > 2.8, `echo: listened only ${(inside[0].t - entered).toFixed(1)} s after entry`);
      c.ok(inside.every((x) => x.rms < 1e-5), `echo: the echo of effects played just before entry still reaches the speakers in the Safe Zone (${fmt(inside)})`);
      c.ok(!errors.length, `echo: page errors: ${errors.join(' | ')}`);
      console.log(`echo: ringing ${fmt([ringing])} | inside ${fmt(inside)}`);
      c.end();
    } finally {
      await ctx.close();
    }
  },

  'safe-zone-silences-score-and-reverb': async (h) => {
    const prefs = JSON.stringify({ v: 1, master: 0.8, music: 0.6, sfx: 0.7, muted: false });
    const { ctx, page, errors } = await boot(h, { save: returning(), init: tapOutput, live: true, extra: { [AUDIO]: prefs } });
    const c = step();
    try {
      await h.sleep(3000);
      const home = await listen(h, page, 3);
      c.ok(home[0].from.length && home[0].from.every((n) => n === 'GainNode') && home.every((x) => x.state === 'running'), `output: the speaker tap is on ${home[0].from} (${home[0].state}), not a running GainNode`);
      c.ok(Math.max(...home.map((x) => x.rms)) > 1e-3, `output: no score reached the speakers on Home to compare with (${fmt(home)})`);
      const gains = await userGains(page);
      const before = await probe(page);
      await enterSafe(h, page, 'output', before);
      const entered = (await outputLevel(page)).t;
      await page.getByRole('button', { name: 'Calm my body first', exact: true }).click({ timeout: 3000 });
      await h.sleep(9000);
      const inside = await listen(h, page, 14);
      const from = inside[0].t - inside[0].span;
      const to = inside.at(-1).t;
      const notes = await page.evaluate(([a, b]) => window.__starts.filter((t) => t >= a && t <= b).length, [from, to]);
      const tries = await page.evaluate(() => window.__tries.filter(([r]) => r === 'safe').length);
      c.ok(inside[0].t - entered > 8.5 && to - from > 9 && inside.every((x) => x.state === 'running'), `output: listened ${(from - entered).toFixed(1)} to ${(to - entered).toFixed(1)} s after entry, not 9+ s of running audio past the fade`);
      c.ok(notes > 0, 'output: no notes were scheduled while listening, so silence proves nothing');
      c.ok(tries > 0, 'output: the breathing ring asked for no sound, so effects were not exercised');
      c.ok(inside.every((x) => x.rms < 1e-5 && x.peak < 2 ** -15), `output: sound reaches the speakers in the Safe Zone over ${notes} scheduled notes (RMS/peak ${fmt(inside)})`);
      c.ok((await userGains(page)) === gains, `output: the Safe Zone changed their Master/Music/Effects gains ${gains} -> ${await userGains(page)}`);
      await leaveSafe(h, page, 'output', before);
      await h.sleep(4000);
      const back = await listen(h, page, 3);
      c.ok(Math.max(...back.map((x) => x.rms)) > 1e-3, `output: the score did not come back after leaving (${fmt(back)})`);
      c.ok((await userGains(page)) === gains, `output: leaving changed their Master/Music/Effects gains ${gains} -> ${await userGains(page)}`);
      c.ok(!errors.length, `output: page errors: ${errors.join(' | ')}`);
      console.log(`output: home ${fmt(home)} | inside ${fmt(inside)} over ${notes} notes, ${tries} sound requests | back ${fmt(back)}`);
      c.end();
    } finally {
      await ctx.close();
    }
  },

  'safe-zone-keeps-mute-and-levels': async (h) => {
    const prefs = JSON.stringify({ v: 1, master: 0.7, music: 0.4, sfx: 0.9, muted: true });
    const { ctx, page, errors } = await boot(h, { save: returning(), extra: { [AUDIO]: prefs } });
    try {
      const before = await probe(page);
      h.expect(JSON.parse(before.volume).muted === true, 'mute: the seeded mute did not load');
      await enterSafe(h, page, 'mute', before);
      await leaveSafe(h, page, 'mute', before);
      const after = await probe(page);
      h.expect(after.prefs === prefs && JSON.parse(after.volume).muted === true && JSON.parse(after.volume).music === 0.4, `mute: settings changed to ${after.prefs} / ${after.volume}`);
      h.expect(!errors.length, `mute: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  },
};
