// Reduced motion (ME-167): with prefers-reduced-motion or Motion: Reduced in Settings, every companion screen goes
// straight to its finished state with at most a short soft fade (DESIGN.md, Motion grammar). Each screen from the
// layout check opens on the same returning save three times: with Motion: Full as the reference, with Motion: Auto
// and the system asking for reduced motion, and with Motion: Reduced in Settings. Each time it does its main
// interaction. With reduced motion, every animation and CSS transition that starts from the moment the screen opens
// until 2 s after the interaction is checked for:
//   moves     it animates transform, translate, scale, rotate, top, left, right, bottom or background-position
//   long      it runs longer than the longest reduced fade in src/motion/tokens.ts (WINDOW.reducedFadeMs to open,
//             WINDOW.reducedCloseMs to close); a delay before it starts doesn't count
//   endless   it repeats forever and runs for longer than that fade
// and, at the end, the screen is compared with the reference:
//   hidden    fewer elements of a kind (same tag and classes) can be seen than with motion on, so an effect was
//             hidden or dropped instead of given a still version
// Anything over in one frame counts as instant and passes. Motion drawn frame by frame from script (the bubbles, the
// moment's light) is not an animation and isn't seen here. The intro, the Safe Zone and the Save Crystal panel are
// left out. Screens in ENFORCED fail the run; every other screen passes and lists its problems on stdout and under
// `result` in report.json, as the todo list.
import fs from 'node:fs';
import { boot, forward, SCREENS, settle, SKIP } from './layout-fit.e2e.mjs';

const ENFORCED = Object.keys(SCREENS);

const tokens = fs.readFileSync(new URL('../../src/motion/tokens.ts', import.meta.url), 'utf8');
const token = (k) => Number(new RegExp(`\\b${k}:\\s*(\\d+)`).exec(tokens)?.[1]);
const FADE = Math.max(token('reducedFadeMs'), token('reducedCloseMs'));
if (!(FADE > 0)) throw new Error('WINDOW.reducedFadeMs and reducedCloseMs are missing from src/motion/tokens.ts');
const FRAME = 1000 / 60;
const MOVES = ['transform', 'translate', 'scale', 'rotate', 'top', 'left', 'right', 'bottom', 'backgroundPosition'];
const PHONE = { width: 390, height: 844 };
const SAMPLE_MS = 2000;

const MODES = {
  // the reference: what the screen shows once it is done, with motion on
  full: { motion: 'full', media: { reducedMotion: 'no-preference' }, still: false },
  system: { motion: 'system', media: { reducedMotion: 'reduce' }, still: true },
  setting: { motion: 'reduce', media: { reducedMotion: 'no-preference' }, still: true },
};

const scrollDown = (page) => page.evaluate(() => document.querySelector('.dq').scrollTo({ top: 1e6, behavior: 'instant' }));

/** Each screen's main interaction; null when the screen plays by itself. */
const ACT = {
  home: {
    // today's card and gift are still waiting: flip the card, open Stats, then open the gift and tap its window closed
    edit: (save) => (save.flags.cardDay = save.flags.giftDay = save.events[0].day),
    run: async (page) => {
      // with motion on the card floats, so it is never still enough for a normal click
      await page.locator('.dq-card').click({ force: true });
      await page.locator('.dq-quest-go').waitFor({ timeout: 5000 });
      await page.locator('.dq-stats-toggle').click();
      const win = page.locator('.sw-layer .dq-sw');
      // with motion on, the first tap finishes the typing and the next one closes the window
      for (let opening = 0; opening < 2; opening++) {
        await page.locator('.dq-chest').click();
        await win.waitFor({ timeout: 5000 });
        for (let i = 0; i < 3 && (await win.count()); i++) {
          await win.click({ force: true });
          await win.waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
        }
        await win.waitFor({ state: 'detached', timeout: 5000 });
        await page.locator('.dq-gift:not(.is-hidden)').waitFor();
      }
      await page.locator('.dq-stats-toggle[aria-expanded=true]').click();
      await page.locator('.dq-stats-toggle[aria-expanded=false]').click();
      await page.locator('.dq-stats-toggle[aria-expanded=true]').waitFor();
    },
  },
  skill: {
    run: async (page) => {
      for (let i = 0; i < 3 && (await forward(page)); i++) await settle(page);
    },
  },
  library: { run: scrollDown },
  moment: null,
  diary: {
    run: async (page) => {
      await page.getByRole('radio', { name: 'Sadness: 3' }).click();
      await page.getByRole('button', { name: 'Edit rows' }).click();
      await page.locator('.dq-details summary').click();
    },
  },
  'night-watch': { run: (page) => page.locator('.w2-sh-in').first().click() },
  wardrobe: { run: (page) => page.locator('.w2-wopt--theme[aria-checked=false]:not([disabled])').first().click() },
  art: {
    run: async (page) => {
      await page.locator('.dq-galitem').first().click();
      await page.waitForFunction(() => window.__daily.route.name === 'piece', null, { timeout: 5000 });
    },
  },
  draw: {
    run: async (page) => {
      await page.getByRole('button', { name: 'Another prompt' }).click();
      await page.locator('.dq-swatch[aria-checked=false]').first().click();
    },
  },
  stories: { run: (page) => page.locator('.st-removed-tg').click() },
  write: {
    run: async (page) => {
      await page.locator('.st-chbtn').click();
      await page.getByRole('dialog', { name: 'Chapters' }).waitFor({ timeout: 5000 });
    },
  },
  read: { run: (page) => page.getByRole('button', { name: 'A largest', exact: true }).click() },
  settings: { run: (page) => page.getByRole('button', { name: 'Sound settings' }).click() },
  shadows: { run: scrollDown },
};
for (const id of Object.keys(SCREENS)) if (!(id in ACT)) throw new Error(`reduced-motion has no main interaction for the ${id} screen`);

/** Records every animation and CSS transition that starts from now on; the ones already there are left out. */
const watch = (page) =>
  page.evaluate(() => {
    const before = new Set(document.getAnimations());
    const seen = new Map();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      for (const a of document.getAnimations()) {
        if (before.has(a)) continue;
        if (!seen.has(a)) seen.set(a, { from: null, to: null });
        const s = seen.get(a);
        if (a.playState === 'running') [s.from, s.to] = [s.from ?? now, now];
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    window.__motionWatch = { seen, stop: () => cancelAnimationFrame(raf) };
  });

/** How many of each kind of element (tag and classes) can be seen, inside `scope` (the whole page when null) and outside `skip`. */
const shown = (page, scope, skip) =>
  page.evaluate(
    ({ scope, skip }) => {
      const count = {};
      const roots = scope ? scope.flatMap((s) => [...document.querySelectorAll(s)]) : [document.body];
      for (const el of roots.flatMap((r) => [r, ...r.querySelectorAll('*')])) {
        if (skip.some((s) => el.closest(s)) || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        // the classes that only say motion is off don't count
        const key = el.tagName.toLowerCase() + [...el.classList].filter((c) => !/^is-still$|--still$/.test(c)).sort().map((c) => '.' + c).join('');
        count[key] = (count[key] ?? 0) + 1;
      }
      return count;
    },
    { scope, skip },
  );

/** Stops the recording and returns what broke the rule, inside `scope` (the whole page when null) and outside `skip`. */
const verdict = (page, scope, skip) =>
  page.evaluate(
    ({ scope, skip, FADE, FRAME, MOVES }) => {
      const { seen, stop } = window.__motionWatch;
      stop();
      const found = [];
      const name = (el, pseudo) => {
        const cls = [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
        const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
        return `${el.tagName.toLowerCase()}${cls}${pseudo ?? ''}${text && text.length <= 32 ? ` "${text}"` : ''}`;
      };
      const ms = (n) => `${Math.round(n)} ms`;
      for (const [a, { from, to }] of seen) {
        const el = a.effect?.target;
        if (!el || (scope && !scope.some((s) => el.closest(s))) || skip.some((s) => el.closest(s))) continue;
        const t = a.effect.getComputedTiming();
        if (t.activeDuration <= FRAME) continue;
        const what = name(el, a.effect.pseudoElement);
        const kind = a instanceof CSSTransition ? `transition ${a.transitionProperty}` : a instanceof CSSAnimation ? `animation ${a.animationName}` : 'script animation';
        const frames = a.effect.getKeyframes();
        const moved = MOVES.filter((p) => {
          const v = frames.filter((f) => p in f).map((f) => String(f[p]));
          return v.length && (v.length < frames.length || new Set(v).size > 1);
        });
        if (moved.length) found.push({ kind: 'moves', what, detail: `${kind}, ${moved.join(' and ')} over ${ms(t.duration)}` });
        if (t.iterations === Infinity) {
          if (from !== null && to - from > FADE) found.push({ kind: 'endless', what, detail: `${kind}, loops every ${ms(t.duration)}` });
        } else if (t.activeDuration > FADE + 1) {
          found.push({ kind: 'long', what, detail: `${kind}, ${ms(t.activeDuration)}` });
        }
      }
      return found;
    },
    { scope, skip, FADE, FRAME, MOVES },
  );

function scenario(id, spec) {
  return async (h) => {
    const act = ACT[id];
    const problems = [];
    let done;
    for (const [mode, { motion, media, still }] of Object.entries(MODES)) {
      const edit = (save) => {
        save.settings.motion = motion;
        act?.edit?.(save);
      };
      const viewport = { width: Number(h.flags.width ?? PHONE.width), height: Number(h.flags.height ?? PHONE.height) };
      const { ctx, page, errors } = await boot(h, viewport, { edit, media });
      const reduced = await page.evaluate(() => window.__daily.reduced() && document.querySelector('.dq').classList.contains('is-still'));
      h.expect(reduced === still, `${id} ${mode}: reduced motion is ${still ? 'not ' : ''}in effect`);
      if (still) await watch(page);
      await page.evaluate((r) => window.__daily.go(r), spec.route);
      await page.waitForFunction((n) => window.__daily.route.name === n, spec.route.name, { timeout: 10000 });
      await settle(page);
      if (spec.scope) h.expect(await page.locator(spec.scope.join(', ')).count(), `${id} ${mode}: nothing on screen matches ${spec.scope.join(', ')}`);
      if (act) await act.run(page);
      const ring = id === 'moment' ? await page.locator('.dq-mo-svg').innerHTML() : null;
      await page.waitForTimeout(SAMPLE_MS);
      if (ring && still) h.expect((await page.locator('.dq-mo-svg').innerHTML()) === ring, `${mode}: the reduced-motion ring keeps changing`);
      const skip = [...SKIP, ...(spec.skip ?? [])];
      const now = await shown(page, spec.scope ?? null, skip);
      const found = [];
      if (!still) done = now;
      else {
        found.push(...(await verdict(page, spec.scope ?? null, skip)));
        for (const [key, n] of Object.entries(done)) if ((now[key] ?? 0) < n) found.push({ kind: 'hidden', what: key, detail: `${now[key] ?? 0} of the ${n} seen with motion on` });
      }
      await h.shot(page, `reduced-motion-${id}-${mode}`);
      h.expect(!errors.length, `${id} ${mode}: ${errors.join('\n')}`);
      await ctx.close();
      if (page.video()) await page.video().saveAs(`${h.out}/reduced-motion-${id}-${mode}.webm`);
      const seen = new Set();
      for (const f of found) {
        const key = `${f.kind} ${f.what} ${f.detail}`;
        if (seen.has(key)) continue;
        seen.add(key);
        problems.push({ mode, ...f });
      }
    }
    const lines = problems.map((p) => `  ${p.mode.padEnd(7)} ${p.kind.padEnd(7)} ${p.what} (${p.detail})`);
    if (ENFORCED.includes(id)) h.expect(!problems.length, `${id} does not hold still with reduced motion:\n${lines.join('\n')}`);
    else if (problems.length) console.log(`todo reduced-motion ${id}: ${problems.length} problems\n${lines.join('\n')}`);
    return { enforced: ENFORCED.includes(id), problems };
  };
}

export const scenarios = {
  ...Object.fromEntries(Object.entries(SCREENS).map(([id, spec]) => [`reduced-motion-${id}`, scenario(id, spec)])),
  async 'reduced-motion-moment-follow-up'(h) {
    for (const [mode, { motion, media, still }] of Object.entries(MODES)) {
      const { ctx, page, errors } = await boot(h, PHONE, { edit: (save) => (save.settings.motion = motion), media });
      if (still) await watch(page);
      await page.evaluate(() => window.__daily.go({ name: 'moment', then: 'wise-mind' }));
      await page.locator('.dq-mo-next:not(.is-hidden)').waitFor({ timeout: 60000 });
      await page.waitForTimeout(SAMPLE_MS);
      const problems = still ? await verdict(page, null, SKIP) : [];
      await h.shot(page, `reduced-motion-moment-follow-up-${mode}`);
      const oldLine = await page.locator('.dq-mo-line').elementHandle();
      await page.locator('.dq-mo-next').click();
      await page.waitForFunction(() => window.__daily.route.name === 'skill' && window.__daily.route.id === 'wise-mind');
      h.expect(await oldLine.evaluate((el) => el.getAnimations().length === 0), `${mode}: text fades survived leaving the moment`);
      await ctx.close();
      if (page.video()) await page.video().saveAs(`${h.out}/reduced-motion-moment-follow-up-${mode}.webm`);
      h.expect(!errors.length, `${mode}: ${errors.join('\n')}`);
      h.expect(!problems.length, `${mode}: ${JSON.stringify(problems)}`);
    }
  },
};
