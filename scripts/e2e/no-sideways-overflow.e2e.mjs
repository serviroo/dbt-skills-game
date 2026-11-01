// At 200% no companion screen is wider than the phone, so a sideways scroll can never push the Safe Zone button off the
// edge (DESIGN.md principle 6). A phone at 320x568, 390x844, 568x320 and 844x390 at 200% zoom (the page laid out at
// half the size, as browser zoom does), one scenario each, opens every screen on a returning save with everything
// unlocked: on each, the page is exactly as wide as the screen, nothing scrolls sideways inside the companion, and the
// Safe Zone button is in reach (whole inside the screen and every box that clips it, and taking taps at its corners).
// Outside a skill's window and the Safe Zone, no row or card squeezes a word, so none breaks onto the next line without
// a hyphen; no Night Watch card cuts its words or sets them smaller than its own sizes (at the phone's own size too),
// and A quiet minute's moth stays clear of its badge. The same holds inside every watcher's card in the Night Watch
// camp, and inside the sheets opened from the drawing page and the story editor, checked as they open at the phone's
// own size and once it zooms to 200%; each sits below the top bar, its close button at least 44 px and in reach the
// same way. A failure names the widest boxes, or the words, that reach past the edge, and the words that break.
// A second scenario for each phone walks every kind of skill step, at 200% and at the phone's own size: every control in
// the step (a hold, a timer's More time, choices, a slider, Next and Done) is in reach the same way once scrolled into
// view, at least 44 px, with its words inside it and at least 16 px.
import { fullSave, seedStores } from './me-91-final-save-ids.e2e.mjs';
import { cutShort } from './safe-zone-reach.e2e.mjs';

const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 844, height: 390 },
];
// the skill steps also on a 320 phone with its browser's bars showing, which at 200% is narrow and short at once
const STEP_SIZES = [...SIZES, { width: 320, height: 534 }];
const SAFE_AT = ['start', 'breathe', 'squeeze', 'cold', 'check', 'stop', 'reasons', 'comfort', 'people', 'talk', 'close'];
const SCREENS = [
  ['Home', { name: 'hub' }],
  ['a skill', { name: 'skill', id: 'check-facts' }],
  ['a cool choice', { name: 'skill', id: 'tipp', entry: 'cold' }],
  ['Library', { name: 'library' }],
  ['Give me a moment', { name: 'moment' }],
  ['A quiet minute', { name: 'ease' }],
  ['Rest', { name: 'rest' }],
  ['Diary', { name: 'diary' }],
  ['Comfort', { name: 'comfort' }],
  ['Lines', { name: 'lines' }],
  ['Night Watch', { name: 'shadows' }],
  ['Settings', { name: 'settings' }],
  ['Art room', { name: 'art' }],
  ['drawing page', { name: 'draw', kind: 'today' }],
  ['shadow ally page', { name: 'draw', kind: 'ally' }],
  ['a drawing', { name: 'piece', id: 'draw-today' }],
  ['Story Room', { name: 'stories' }],
  ['writing', { name: 'write', id: 'tale-1' }],
  ['reading', { name: 'read', id: 'tale-1' }],
  ...SAFE_AT.map((at) => [`Safe Zone ${at}`, { name: 'safe', at }]),
];

/**
 * Waits until the screen stops changing: no DOM changes for 300 ms (at most 3 s), and its entry motion done. A ring that
 * redraws inside its SVG every frame doesn't count as a change.
 */
const settle = (page) =>
  page.evaluate(async () => {
    await new Promise((done) => {
      let quiet;
      const mo = new MutationObserver((records) => {
        if (records.every((r) => r.type === 'attributes' && r.target.closest?.('svg'))) return;
        clearTimeout(quiet);
        quiet = setTimeout(end, 300);
      });
      const end = () => {
        mo.disconnect();
        clearTimeout(cap);
        done();
      };
      const cap = setTimeout(end, 3000);
      quiet = setTimeout(end, 300);
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const ending = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 2000))]);
  });

/**
 * How wide the page and the companion's own scroller are against the screen, the widest boxes past its edge, the cards
 * that cut their words, and whether A quiet minute's moth is over its badge; with `sheet`, the boxes inside that sheet
 * that scroll or clip sideways, and whether its top is under the top bar.
 */
const width = (page, sheet = null) =>
  page.evaluate((sheet) => {
    const doc = document.documentElement;
    const dq = document.querySelector('.dq');
    const clips = (e) => {
      for (let p = e.parentElement; p && p !== dq && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true;
      return false;
    };
    const label = (e) => e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => `.${c}`).join('');
    const out = (r) => r.width && (r.right > innerWidth + 0.5 || r.left < -0.5);
    const past = [...document.querySelectorAll('body *')]
      .filter((e) => out(e.getBoundingClientRect()) && e.checkVisibility() && !clips(e))
      .filter((e, _, all) => !all.includes(e.parentElement))
      .map((e) => {
        const r = e.getBoundingClientRect();
        return `${label(e)} ${Math.round(r.left)}..${Math.round(r.right)}`;
      });
    // words that run out of a box that itself fits
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()) && past.length < 6; ) {
      const p = n.parentElement;
      if (!n.textContent.trim() || !p.checkVisibility() || clips(p) || p.closest('.dq-sr')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (out(r) && !past.some((x) => x.startsWith(label(p)))) past.push(`"${n.textContent.trim().slice(0, 24)}" in ${label(p)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    const box = sheet && document.querySelector(sheet);
    const inner = box ? [box, ...box.querySelectorAll('*')].filter((e) => getComputedStyle(e).overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1 && e.checkVisibility() && !e.closest('.dq-sr')).map((e) => `${label(e)} ${e.scrollWidth - e.clientWidth} px wider than it shows`) : [];
    const bar = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const meets = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    // a card's words at main's sizes or larger
    const small = Object.entries({ '.dq-cf-name': 22, '.dq-cf-real': 12, '.dq-cf-top': 12, '.dq-cardbtn-n': 13.5 }).flatMap(([sel, px]) => [...document.querySelectorAll(`.dq-cardbtn ${sel}`)].filter((e) => parseFloat(getComputedStyle(e).fontSize) < px - 0.01).slice(0, 1).map((e) => `${sel} at ${getComputedStyle(e).fontSize}, under ${px}px`));
    const cut = [...document.querySelectorAll('.dq-cardbtn .dq-cardface')].filter((c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1).map((c) => `"${c.textContent.trim().slice(0, 20)}"`);
    const moth = document.querySelector('.dq-ease-sea svg')?.getBoundingClientRect();
    return {
      doc: doc.scrollWidth,
      dq: dq ? dq.scrollWidth - dq.clientWidth : 0,
      vw: innerWidth,
      past: past.slice(0, 6),
      inner,
      under: !!box && box.getBoundingClientRect().top < bar - 0.5,
      cut,
      small,
      moth: !!moth && [...document.querySelectorAll('.dq-ease-panel > .dq-chip > *')].some((c) => meets(c.getBoundingClientRect(), moth)),
    };
  }, sheet);

/**
 * Why the control `sel` names (or `sel` itself, an element) is out of reach, or '' if it isn't: it is at least 44 px each
 * way, its whole box is on screen (with `below`, under the top bar) and inside every box that clips it, and it takes the
 * tap at its centre and at a point a quarter in from each corner, so a control a scrolling sheet cuts at one edge is out
 * of reach though its centre still takes the tap. With `optional`, a control the screen doesn't have is no problem.
 */
const reach = (page, sel, { below = true, optional = false } = {}) =>
  page.evaluate(
    ({ sel, below, optional }) => {
      const e = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!e) return optional ? '' : 'it is missing';
      const r = e.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) return `it is ${Math.round(r.width)}x${Math.round(r.height)} px`;
      const room = { left: 0, top: below ? document.querySelector('.dq-top').getBoundingClientRect().bottom : 0, right: innerWidth, bottom: innerHeight };
      // the boxes that clip it: an absolutely placed box only from its containing block out, a fixed one only within a
      // transformed ancestor
      let pos = getComputedStyle(e).position;
      for (let p = e.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (pos === 'fixed' ? cs.transform === 'none' : pos === 'absolute' && cs.position === 'static' && cs.transform === 'none') continue;
        const q = p.getBoundingClientRect();
        if (cs.overflowX !== 'visible') {
          room.left = Math.max(room.left, q.left + p.clientLeft);
          room.right = Math.min(room.right, q.left + p.clientLeft + p.clientWidth);
        }
        if (cs.overflowY !== 'visible') {
          room.top = Math.max(room.top, q.top + p.clientTop);
          room.bottom = Math.min(room.bottom, q.top + p.clientTop + p.clientHeight);
        }
        pos = cs.position;
      }
      const cut = [...['left', 'top'].filter((k) => r[k] < room[k] - 0.5), ...['right', 'bottom'].filter((k) => r[k] > room[k] + 0.5)];
      if (cut.length) return `its ${cut.join(' and ')} edge is cut off`;
      const missed = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].filter(([x, y]) => !e.contains(document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)));
      return missed.length ? `${missed.length} of its 5 tap points land on something else` : '';
    },
    { sel, below, optional },
  );

/** Every screen, and the sheets, on one phone at 200% zoom. */
function sweep(phone) {
  return async (h) => {
    const failed = [];
    const size = `${phone.width}x${phone.height} at 200%`;
    const zoomed = { width: phone.width / 2, height: phone.height / 2 };
    const now = Date.now();
    const save = fullSave(now);
    const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: save.created, companionAt: save.created });
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(save), [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', zoomed);
    try {
      await h.reachHub(page);
      await seedStores(page, h.SAVE, now);
      await page.reload();
      await h.reachHub(page);
      const check = async (where, { words = true, sheet = null, close = null } = {}) => {
        await settle(page);
        const w = await width(page, sheet);
        const bad = [];
        if (w.doc !== w.vw) bad.push(`the page is ${w.doc} px wide`);
        if (w.dq > 0) bad.push(`the companion scrolls ${w.dq} px sideways`);
        const safe = await reach(page, '.dq-top .dq-safe', { below: false, optional: true });
        if (safe) bad.push(`the Safe Zone button is out of reach: ${safe}`);
        if (w.inner.length) bad.push(`inside the sheet: ${w.inner.join(', ')}`);
        if (w.under) bad.push('the top of the sheet is under the top bar');
        const shut = close && (await reach(page, close));
        if (shut) bad.push(`its close button is out of reach: ${shut}`);
        if (w.small.length) bad.push(`card text below its size: ${w.small.join(', ')}`);
        if (w.cut.length) bad.push(`${w.cut.length} cards cut their words (${w.cut.slice(0, 3).join(', ')})`);
        if (w.moth) bad.push('the moth is over the badge');
        if (bad.length) failed.push(`${size} ${where}: ${bad.join('; ')} on a ${w.vw} px screen; past the edge: ${w.past.join(', ') || 'nothing found'}`);
        if (words) for (const f of await cutShort(page, { scope: sheet ? `${sheet} *` : '#dq-main *' })) failed.push(`${size} ${where}: ${f}`);
        await h.shot(page, `wide-${phone.width}x${phone.height}-${where.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
      };
      for (const [where, route] of SCREENS) {
        await page.evaluate((r) => window.__daily.go(r), route);
        await page.waitForFunction((n) => window.__daily.route.name === n, route.name, { timeout: 10000 });
        // a skill opened at one of its parts shows its intro first; that part is the screen to check
        if (route.entry) {
          await page.locator('.dq-step-body .dq-intro').waitFor({ timeout: 10000 });
          await page.locator('.dq-step-body .dq-actions .dq-btn--primary').first().click();
        }
        await check(where, { words: route.name !== 'skill' && route.name !== 'safe' });
      }
      // Night Watch at the phone's own size, where its cards keep their words whole at their own sizes too
      await page.setViewportSize(phone);
      await page.evaluate(() => window.__daily.go({ name: 'shadows' }));
      await page.waitForFunction(() => window.__daily.route.name === 'shadows', null, { timeout: 10000 });
      await check('Night Watch, unzoomed');
      await page.setViewportSize(zoomed);
      // Home once the check-in is answered with a feeling that asks how strong it is
      await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await page.locator('.dq-feels .dq-opt').filter({ hasText: 'Tired' }).click({ timeout: 10000 });
      await page.locator('.dq-level [role=radiogroup]').waitFor({ timeout: 10000 });
      await check('Home, How strong');

      // the sheets opened from the drawing page and the story editor
      // each sheet opens at the phone's own size, where the page can be drawn on, and is checked once zoomed to 200%
      const sheet = async (where, { panel, close = null, clip = false }, open) => {
        await page.setViewportSize(phone);
        try {
          await open();
        } catch (e) {
          return failed.push(`${size} ${where}: could not open it: ${String(e.message).split('\n')[0]}`);
        }
        await check(`${where}, unzoomed`, { sheet: panel, close });
        await page.setViewportSize(zoomed);
        await check(where, { sheet: panel, close });
        // the close check itself: a close the sheet cuts at its edge, by 10 px and by half, is out of reach though its centre
        // may still take the tap
        for (const by of clip ? [10, 0.5] : []) {
          await page.evaluate(
            ({ close, by }) => {
              const x = document.querySelector(close);
              const p = x.closest('.dq-sheet-p');
              const r = x.getBoundingClientRect();
              x.style.position = 'relative';
              x.style.left = `${p.getBoundingClientRect().left + p.clientLeft + p.clientWidth - r.right + (by < 1 ? r.width * by : by)}px`;
            },
            { close, by },
          );
          if (!(await reach(page, close))) failed.push(`${size} ${where}: a close the sheet cuts ${by < 1 ? 'in half' : `by ${by} px`} counts as in reach`);
          await page.evaluate((close) => {
            const x = document.querySelector(close);
            x.style.removeProperty('position');
            x.style.removeProperty('left');
          }, close);
        }
        await page.keyboard.press('Escape');
      };
      await sheet('shadow ally name sheet', { panel: '.dq-sheet:not(.is-hidden) .dq-sheet-p', close: '.dq-sheet:not(.is-hidden) .dq-sheet-x' }, async () => {
        await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'ally' }));
        const frame = page.locator('.dq-draw-frame');
        await frame.waitFor({ timeout: 10000 });
        await frame.scrollIntoViewIfNeeded();
        // the page takes strokes once its drafts are read
        await page.waitForFunction(() => document.querySelector('.dq-ink-stage')?.inert === false, null, { timeout: 10000 });
        await settle(page);
        // a short line inside the part of the page that shows
        const b = await frame.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const top = Math.max(r.top, 0);
          const bottom = Math.min(r.bottom, innerHeight);
          return { x: r.left, w: r.width, top, h: bottom - top };
        });
        await page.mouse.move(b.x + b.w * 0.3, b.top + b.h * 0.3);
        await page.mouse.down();
        await page.mouse.move(b.x + b.w * 0.7, b.top + b.h * 0.7, { steps: 8 });
        await page.mouse.up();
        await page.locator('.dq-save:enabled').click({ timeout: 10000 });
        await page.locator('.dq-sheet:not(.is-hidden) .dq-sheet-h').waitFor({ timeout: 10000 });
      });
      await sheet('chapter sheet', { panel: '.st-chsheet', close: '.st-chsheet .dq-sheet-x', clip: true }, async () => {
        await page.evaluate(() => window.__daily.go({ name: 'write', id: 'tale-1' }));
        await page.getByRole('textbox', { name: /^Page,/ }).waitFor({ timeout: 10000 });
        await page.locator('.st-chbtn').click();
        await page.locator('.st-chsheet').first().waitFor({ timeout: 10000 });
      });
      await sheet('drawing picker sheet', { panel: '.st-picks', close: '.st-picks .dq-sheet-x' }, async () => {
        await page.locator('.st-chsheet').first().waitFor({ state: 'detached', timeout: 10000 });
        await page.locator('.st-pic-b').click();
        await page.locator('.st-picks').waitFor({ timeout: 10000 });
      });

      // every watcher's card in the Night Watch camp, opened from the keyboard
      await page.evaluate(() => window.__daily.go({ name: 'shadows' }));
      await page.locator('.w2-camp').evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await page.locator('.w2-camp.is-scene-live').waitFor({ timeout: 30000 });
      for (const id of await page.locator('.w2-camp-hit').evaluateAll((bs) => bs.map((b) => b.dataset.shadow))) {
        await page.locator(`.w2-camp-hit[data-shadow="${id}"]`).focus();
        await page.keyboard.press('Enter');
        await page.locator('.w2-camp-card[role="dialog"]').waitFor({ timeout: 10000 });
        await check(`${id}'s card`, { sheet: '.w2-camp-card', close: '.w2-camp-x' });
        await page.keyboard.press('Escape');
        await page.locator('.w2-camp-card').waitFor({ state: 'hidden', timeout: 10000 });
      }
      if (errors.length) failed.push(`${size}: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
    h.expect(!failed.length, failed.join('\n'));
  };
}

/** What a player can tap, type in or slide inside a skill step. */
const CONTROLS = 'button, input, textarea, select';

/**
 * The skill steps to walk, each as its skill's id, its number from 0, for a hold how long its words for done are, and
 * for a ranking the number of the choice whose picks it ranks: every hold, whose words sit inside the control, and of
 * every other kind the first step and the first to have each part that kind can add (a second pace, choices beside
 * Start, a way to add your own).
 */
const stepsToWalk = (page) =>
  page.evaluate(async () => {
    const seen = new Set();
    return (await import('/src/content/dbt.ts')).SKILLS.flatMap((sk) =>
      sk.steps.flatMap((s, at) => {
        const parts = [s.kind, ...Object.keys(s).filter((k) => !['id', 'kind', 'text', 'title', 'go', 'key'].includes(k)).map((k) => `${s.kind}.${k}`)].filter((k) => !seen.has(k));
        if (s.kind === 'branch' || (s.kind !== 'hold' && !parts.length)) return [];
        parts.forEach((k) => seen.add(k));
        return [{ what: `${sk.id} step ${at + 1} (${s.kind})`, id: sk.id, at, done: s.kind === 'hold' ? s.done.length : 0, from: s.kind === 'tier' ? sk.steps.findIndex((c) => c.key === s.from) : -1 }];
      }),
    );
  });

/**
 * Every kind of skill step on one phone at 200% zoom and at its own size: nothing scrolls sideways, the Safe Zone button
 * is in reach, and so is every control in the step once it is scrolled into view the way focus brings it there, its
 * words inside it and at least 16 px. The hold with the longest words for done is held through and checked again, and so
 * are a cool choice once picked and the end once answered.
 */
function steps(phone) {
  return async (h) => {
    const failed = [];
    const now = Date.now();
    const save = fullSave(now);
    const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: save.created, companionAt: save.created });
    const zoomed = { width: phone.width / 2, height: phone.height / 2 };
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(save), [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', zoomed);
    try {
      await h.reachHub(page);
      const walk = await stepsToWalk(page);
      const held = walk.reduce((a, b) => (b.done > a.done ? b : a));
      const check = async (where) => {
        await settle(page);
        const w = await width(page);
        const bad = [];
        if (w.doc !== w.vw) bad.push(`the page is ${w.doc} px wide`);
        if (w.dq > 0) bad.push(`the companion scrolls ${w.dq} px sideways`);
        const safe = await reach(page, '.dq-top .dq-safe', { below: false });
        if (safe) bad.push(`the Safe Zone button is out of reach: ${safe}`);
        for (const c of await page.locator('.dq-step-body').locator(CONTROLS).elementHandles()) {
          const what = await c.evaluate((e) => {
            if (!e.checkVisibility()) return '';
            document.querySelector('.dq').scrollTo({ top: 0, behavior: 'instant' });
            e.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            return `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.textContent || e.placeholder || e.type).trim().slice(0, 24)}"`;
          });
          if (!what) continue;
          const why = await reach(page, c);
          if (why) bad.push(`${what} is out of reach: ${why}`);
          // its words: inside it and at least 16 px, a field's and every label's, capitals and one word too
          const words = await c.evaluate((e) => {
            const r = e.getBoundingClientRect();
            const out = [];
            if (e.matches('textarea, input:not([type=range])') && parseFloat(getComputedStyle(e).fontSize) < 15.99) out.push(`its text is ${getComputedStyle(e).fontSize}`);
            const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
            for (let n; (n = walk.nextNode()); ) {
              if (!n.textContent.trim() || n.parentElement.closest('.dq-sr')) continue;
              const range = document.createRange();
              range.selectNodeContents(n);
              const t = range.getBoundingClientRect();
              if (t.left < r.left - 0.5 || t.right > r.right + 0.5 || t.top < r.top - 0.5 || t.bottom > r.bottom + 0.5) out.push('it has words outside it');
              const css = getComputedStyle(n.parentElement);
              if (parseFloat(css.fontSize) < 15.99) out.push(`its words are ${css.fontSize}`);
            }
            return [...new Set(out)];
          });
          for (const x of words) bad.push(`${what}: ${x}`);
        }
        // the shot shows the step's controls: the end of the step in view
        const vh = await page.evaluate(() => {
          document.querySelector('.dq').scrollTo({ top: 0, behavior: 'instant' });
          document.querySelector('.dq-step-body').lastElementChild?.scrollIntoView({ block: 'end', behavior: 'instant' });
          return innerHeight;
        });
        if (bad.length) failed.push(`${where} on a ${w.vw}x${vh} screen: ${bad.join('; ')}; past the edge: ${w.past.join(', ') || 'nothing found'}`);
        await h.shot(page, `step-${w.vw}x${vh}-${where.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
      };
      // a step opened the way Back and Forward return to it; a ranking ranks what its choice picked, so three are picked
      // there first
      const open = async (id, at, from = -1) => {
        await page.evaluate((id) => window.__daily.go({ name: 'skill', id }), id);
        await page.locator('.dq-skill .dq-step-body > *').first().waitFor({ timeout: 10000 });
        if (from >= 0) {
          await page.evaluate((at) => window.__daily.current.moveTo(at), from);
          for (const o of (await page.locator('.dq-step-body .dq-opts .dq-opt').all()).slice(0, 3)) await o.click();
        }
        await page.evaluate((at) => window.__daily.current.moveTo(at), at);
      };
      for (const [size, viewport] of [[`${phone.width}x${phone.height} at 200%`, zoomed], [`${phone.width}x${phone.height}`, phone]]) {
        await page.setViewportSize(viewport);
        for (const { what, id, at, from } of walk) {
          await open(id, at, from);
          if (from >= 0 && (await page.locator('.dq-step-body .ca-tier-row').count()) !== 3) failed.push(`${size} ${what}: the three picks are not there to rank`);
          await check(`${size} ${what}`);
          if (what === held.what) {
            await page.locator('.dq-hold').scrollIntoViewIfNeeded();
            const b = await page.locator('.dq-hold').boundingBox();
            await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
            await page.mouse.down();
            await page.locator('.dq-hold.is-done').waitFor({ timeout: 15000 });
            await page.mouse.up();
            await check(`${size} ${what}, held`);
          }
          if (await page.locator('.dq-cool-pick').count()) {
            await page.locator('.dq-cool-pick .dq-btn').first().click();
            await check(`${size} ${what}, picked`);
          }
        }
        await open(walk[0].id, 'end');
        await check(`${size} the end`);
        await page.locator('.dq-feedback .dq-opt').first().click();
        await check(`${size} the end, answered`);
      }
      if (errors.length) failed.push(errors.join(' | '));
    } finally {
      await ctx.close();
    }
    h.expect(!failed.length, failed.join('\n'));
  };
}

export const scenarios = Object.fromEntries([
  ...SIZES.map((phone) => [`no-sideways-overflow-${phone.width}x${phone.height}`, sweep(phone)]),
  ...STEP_SIZES.map((phone) => [`no-sideways-overflow-steps-${phone.width}x${phone.height}`, steps(phone)]),
]);
