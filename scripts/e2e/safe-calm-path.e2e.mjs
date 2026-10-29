// The Safe Zone's calming path stays inside it. "Give me a moment" from the Safe Zone keeps the player in the Safe
// Zone: "Talk to someone now" pinned and tappable, the score still quiet, no cues, bubbles or XP, no low hum, and Done
// comes back to its first screen; Leave still goes Home, whether the Safe Zone was opened from Home or from a skill.

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function returning() {
  const t = Date.now() - 86400e3;
  const day = dayKey(t);
  return JSON.stringify({ v: 1, created: t, events: [{ id: 'calm-visit', t, day, k: 'visit', xp: 10 }], flags: { greetDay: day } });
}

/** Home on a returning save. Every quiet() the score gets and every cue asked for is noted, not played. */
async function boot(h, viewport) {
  const ctx = await h.browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'en-US' });
  await ctx.clock.install();
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: returning() };
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
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile') && !document.querySelector('.dq-sw'), null, { timeout: 30000 });
  await page.evaluate(() => {
    const s = window.__daily.opts.sound;
    window.__quiet = [];
    window.__cues = [];
    if (!s) return;
    const quiet = s.quiet?.bind(s);
    s.quiet = (on) => (window.__quiet.push(on), quiet?.(on));
    s.play = (c) => window.__cues.push(c);
  });
  return { ctx, page, errors };
}

const onScreen = (page, name) => page.waitForFunction((n) => document.querySelector('.dq')?.dataset.screen === n && !!document.querySelector('#dq-main > *'), name, { timeout: 10000 });

/** Whole on screen and not covered: the corners and the middle of its box land on it. Runs in the page. */
function seen(e) {
  if (!e) return false;
  const r = e.getBoundingClientRect();
  if (!r.width || !r.height || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return false;
  const at = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4], [r.left + r.width / 2, r.top + r.height / 2]];
  return at.every(([x, y]) => e.contains(document.elementFromPoint(x, y)));
}
/** Gives the page seen() before a read. */
const withSeen = (page) => page.evaluate(`window.__seen = ${seen.toString()}`);

/** What the Safe Zone promises, read from the page. */
const inside = async (page) => {
  await withSeen(page);
  return page.evaluate(() => {
    const seen = window.__seen;
    const a = window.__daily;
    const talk = [...document.querySelectorAll('.dq-sz-talk')].find((b) => !b.classList.contains('is-hidden'));
    return {
      route: a.route.name,
      mode: a.root.dataset.mode,
      talk: seen(talk),
      bubbles: a.bubbles.density,
      quiet: [...window.__quiet],
      cues: [...window.__cues],
      xp: a.store.derived().xp,
      events: a.store.state.events.length,
      hum: document.querySelectorAll('.dq-mo-hum').length,
      leave: document.querySelector('.dq-top > :first-child')?.textContent.trim(),
      line: document.querySelector('.dq-mo-line')?.textContent.trim() ?? '',
      done: seen(document.querySelector('.dq-mo-done')),
    };
  });
};

/** Opens the Safe Zone from Home, or from a skill opened from the Skills list. */
async function intoSafe(page, from) {
  if (from === 'a skill') {
    await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
    await onScreen(page, 'library');
    await page.locator('.dq-librow').first().click();
    await onScreen(page, 'skill');
  }
  await page.locator('.dq-top .dq-safe').click();
  await onScreen(page, 'safe');
}

/** Give me a moment from the Safe Zone's first screen, once its first calm line shows. */
async function moment(page) {
  await page.locator('.dq-sz-main').getByRole('button', { name: 'Give me a moment', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.dq-mo-line')?.textContent.trim().length > 0, null, { timeout: 15000 });
}

export const scenarios = {
  'safe-moment-stays-inside': async (h) => {
    const failed = [];
    const ok = (c, m) => c || failed.push(m);
    for (const [size, viewport] of [['390x844', PHONE], ['1440x900', DESK]]) {
      for (const from of ['Home', 'a skill']) {
        const tag = `${size} from ${from}`;
        const { ctx, page, errors } = await boot(h, viewport);
        try {
          await intoSafe(page, from);
          const was = await inside(page);
          ok(was.quiet.at(-1) === true, `${tag}: the score did not go quiet in the Safe Zone (${was.quiet})`);

          await moment(page);
          await h.sleep(1500);
          const got = await inside(page);
          await h.shot(page, `safe-calm-moment-${size}-${from.replace(/ /g, '-')}`);
          ok(got.route === 'safe' && got.mode === 'safe', `${tag}: Give me a moment left the Safe Zone (route ${got.route}, mode ${got.mode})`);
          ok(got.talk, `${tag}: "Talk to someone now" is not pinned and tappable in Give me a moment`);
          ok(!got.quiet.includes(false), `${tag}: the score came back inside the Safe Zone (quiet ${got.quiet.join(', ')})`);
          ok(!got.cues.length, `${tag}: cues inside the Safe Zone: ${got.cues.join(', ')}`);
          ok(got.bubbles === 0, `${tag}: bubbles came back (density ${got.bubbles})`);
          ok(got.xp === was.xp && got.events === was.events, `${tag}: Give me a moment credited something (XP ${was.xp} -> ${got.xp}, events ${was.events} -> ${got.events})`);
          ok(got.hum === 0, `${tag}: the low hum is offered inside the Safe Zone`);
          ok(got.leave === 'Leave', `${tag}: the top bar shows "${got.leave}", not Leave`);
          if (got.route !== 'safe') continue;

          // a short window held sideways still shows the ring beside the words
          if (size === '390x844' && from === 'Home') {
            await page.setViewportSize({ width: 540, height: 240 });
            const ring = await page.evaluate(() => document.querySelector('.dq-sz .dq-mo-stage').getBoundingClientRect().width);
            ok(ring >= 100, `540x240: the moment's ring is ${ring}px wide`);
            await page.setViewportSize(viewport);
          }

          await page.getByRole('radio', { name: '1 minute', exact: true }).check();
          await h.pauseClock(page);
          await page.clock.fastForward(61000);
          const ended = await inside(page);
          ok(/^That[’']s your moment\./.test(ended.line), `${tag}: the timed moment did not end (${ended.line})`);
          ok(ended.done, `${tag}: Done is missing or covered after the timer ends`);
          ok(ended.route === 'safe' && ended.mode === 'safe' && ended.talk, `${tag}: the timer left the Safe Zone or hid the pinned help link`);
          ok(!ended.quiet.includes(false) && !ended.cues.length && ended.hum === 0, `${tag}: sound returned when the timer ended (quiet ${ended.quiet}, cues ${ended.cues})`);
          ok(ended.bubbles === 0, `${tag}: effects returned when the timer ended`);
          ok(ended.xp === was.xp && ended.events === was.events, `${tag}: the timer credited something (XP ${was.xp} -> ${ended.xp}, events ${was.events} -> ${ended.events})`);
          await page.clock.resume();
          if (size === '390x844' && from === 'Home') {
            await page.locator('.dq-mo-line').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
            const settled = await inside(page);
            ok(settled.done, `${tag}: Done disappeared after the timer's fade`);
            await h.shot(page, 'safe-calm-ended-390x844');
          }

          // Done comes back to the Safe Zone's first screen, still inside
          await page.locator('.dq-sz-main').getByRole('button', { name: 'Done', exact: true }).click();
          await page.locator('.dq-sz-main').getByRole('button', { name: 'Give me a moment', exact: true }).waitFor({ timeout: 5000 });
          const done = await inside(page);
          ok(done.route === 'safe' && done.talk && !done.quiet.includes(false), `${tag}: Done left the Safe Zone (route ${done.route}, quiet ${done.quiet.join(', ')})`);

          // "Talk to someone now" is one tap from the moment
          await moment(page);
          await page.locator('.dq-sz-talk').click();
          await page.locator('.dq-sz-t', { hasText: 'Talk to someone now' }).waitFor({ timeout: 5000 });

          // Leave goes Home, and the score comes back there
          await page.locator('.dq-top .dq-back', { hasText: 'Leave' }).click();
          await onScreen(page, 'hub');
          const out = await inside(page);
          ok(out.quiet.at(-1) === false, `${tag}: the score stayed quiet after Leave (${out.quiet.join(', ')})`);
          ok(out.xp === was.xp, `${tag}: the round trip changed XP ${was.xp} -> ${out.xp}`);
          ok(!errors.length, `${tag}: ${errors.join(' | ')}`);
        } finally {
          await ctx.close();
        }
      }
    }
    h.expect(!failed.length, failed.join('\n'));
  },
};
