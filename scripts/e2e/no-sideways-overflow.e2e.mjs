// At 200% no companion screen is wider than the phone, so a sideways scroll can never push the Safe Zone button off the
// edge (DESIGN.md principle 6). A phone at 320x568, 390x844, 568x320 and 844x390, one scenario each at 200% zoom (the
// page laid out at half the size, as browser zoom does) and one with the phone's own text at 200% (each word twice its
// size in a page as wide as before, see scaleText), opens every screen on a returning save with everything unlocked and
// its drawings named with a long word, Settings with a look tried on in the Wardrobe too: on each, the page is exactly
// as wide as the screen, nothing scrolls sideways inside the companion, nothing reaches past the screen's edge, no box
// that clips its words (a card's edge) cuts one at its side, a word kept whole breaks only where a hyphen shows in the
// screen's pixels, the diary's week (its own sideways scroller) is a named stop for the keyboard with a whole focus
// ring, and the Safe Zone button is in reach (whole inside the screen and every box that clips it, and taking taps at
// its corners). Outside a skill's window and the Safe Zone, no row or card squeezes a word, so none breaks onto the
// next line without a hyphen; no Night Watch card cuts its words or sets them smaller than its own sizes (at the
// phone's own size too), and A quiet minute's moth stays clear of its badge. The same holds inside every watcher's card
// in the Night Watch camp, and inside the sheets opened from the drawing page and the story editor, checked as they
// open at the phone's own size and once it zooms to 200% (with the phone's text at 200%, there alone); each sits below
// the top bar, its close button at least 44 px and in reach the same way. A failure names the widest boxes, or the
// words, that reach past the edge, and the words that break or are cut.
import { fullSave, seedStores } from './me-91-final-save-ids.e2e.mjs';
import { cutShort, scaleText } from './safe-zone-reach.e2e.mjs';

const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 844, height: 390 },
];
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
  ['Pick a day', { name: 'days' }],
  ['Print a week', { name: 'print' }],
  ['Comfort', { name: 'comfort' }],
  ['Lines', { name: 'lines' }],
  ['Night Watch', { name: 'shadows' }],
  ['Settings', { name: 'settings' }],
  ['Art room', { name: 'art' }],
  ['drawing page', { name: 'draw', kind: 'today' }],
  ['shadow ally page', { name: 'draw', kind: 'ally' }],
  ['a drawing', { name: 'piece', id: 'draw-today' }],
  ['a shadow ally', { name: 'piece', id: 'draw-ally' }],
  ['Story Room', { name: 'stories' }],
  ['writing', { name: 'write', id: 'tale-1' }],
  ['reading', { name: 'read', id: 'tale-1' }],
  ...SAFE_AT.map((at) => [`Safe Zone ${at}`, { name: 'safe', at }]),
];

/** Waits until the screen stops changing: no DOM changes for 300 ms (at most 3 s), and its entry motion done. */
const settle = (page) =>
  page.evaluate(async () => {
    await new Promise((done) => {
      let quiet;
      const mo = new MutationObserver(() => {
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
 * How wide the page and the companion's own scroller are against the screen, the widest boxes past its edge, the words
 * a box cuts at its side, the cards that cut their words, and whether A quiet minute's moth is over its badge; with
 * `sheet`, the boxes inside that sheet
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
    // words only a screen reader hears, as .dq-sr is or a label clipped to nothing as it is
    const unseen = (e) => !!e.closest('.dq-sr') || getComputedStyle(e).clipPath === 'inset(50%)';
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
      if (!n.textContent.trim() || !p.checkVisibility() || clips(p) || unseen(p)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (out(r) && !past.some((x) => x.startsWith(label(p)))) past.push(`"${n.textContent.trim().slice(0, 24)}" in ${label(p)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    // words the nearest box that clips them (a card's edge) cuts at its side; a box that scrolls them shows them whole
    const sides = [];
    const main = document.querySelector('#dq-main');
    const texts = main && document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n; texts && (n = texts.nextNode()) && sides.length < 6; ) {
      const p = n.parentElement;
      if (!n.textContent.trim() || !p.checkVisibility() || unseen(p)) continue;
      let at = p;
      while (at !== main && getComputedStyle(at).overflowX === 'visible') at = at.parentElement;
      if (at === main || /auto|scroll/.test(getComputedStyle(at).overflowX)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      const left = at.getBoundingClientRect().left + at.clientLeft;
      if (r.width && (r.left < left - 0.5 || r.right > left + at.clientWidth + 0.5)) sides.push(`"${n.textContent.trim().slice(0, 24)}" in ${label(p)}, cut by ${label(at)}`);
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
      sides,
      inner,
      under: !!box && box.getBoundingClientRect().top < bar - 0.5,
      cut,
      small,
      moth: !!moth && [...document.querySelectorAll('.dq-ease-panel > .dq-chip > *')].some((c) => meets(c.getBoundingClientRect(), moth)),
    };
  }, sheet);

/**
 * The words kept whole (wholeWords in ui.ts) in `scope` that break at a soft hyphen with no hyphen to see there. Each
 * break is scrolled into view and shot twice, with its mark and with the mark made clear, and `pixels` (a blank page)
 * counts what changed: a hyphen draws a stroke of at least 3% of its letters' size by a quarter of it (Bodoni Moda's
 * hairline is near 1% thick), so a mark too thin to see, one a box clips at its edge or one never drawn counts.
 */
async function hyphens(page, pixels, scope = 'body') {
  const count = await page.evaluate((scope) => {
    const unseen = (e) => !!e.closest('.dq-sr') || getComputedStyle(e).clipPath === 'inset(50%)';
    const lines = (t) => {
      const range = document.createRange();
      range.selectNodeContents(t);
      return [...range.getClientRects()];
    };
    const marks = [...document.querySelectorAll(`${scope} dq-shy`)].filter((s) => {
      if (!s.parentElement.checkVisibility() || unseen(s.parentElement)) return false;
      const [a, b] = [lines(s.previousSibling).at(-1), lines(s.nextSibling)[0]];
      return !!a && !!b && b.top > a.top + a.height / 2;
    });
    // every box that scrolling a mark into view may move, put back as it was afterwards
    const scrollers = new Set([document.scrollingElement]);
    for (const s of marks) for (let p = s.parentElement; p; p = p.parentElement) if (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth) scrollers.add(p);
    window.__marks = { marks, was: [...scrollers].map((e) => [e, e.scrollTop, e.scrollLeft]) };
    return marks.length;
  }, scope);
  const out = [];
  const shown = (i, clear) =>
    page.evaluate(
      async ([i, clear]) => {
        window.__marks.marks[i].style.color = clear ? 'transparent' : '';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      },
      [i, clear],
    );
  for (let i = 0; i < count && out.length < 6; i++) {
    // the mark's box and the room its stroke may reach past it, inside the screen
    const at = await page.evaluate(async (i) => {
      const s = window.__marks.marks[i];
      s.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = s.getBoundingClientRect();
      const size = parseFloat(getComputedStyle(s).fontSize);
      const [x, y] = [Math.max(r.left - size / 2, 0), Math.max(r.top, 0)];
      return { x, y, width: Math.min(r.right + size, innerWidth) - x, height: Math.min(r.bottom, innerHeight) - y, size, word: `${s.previousSibling.textContent}|${s.nextSibling.textContent}` };
    }, i);
    let ink = 0;
    if (at.width >= 1 && at.height >= 1) {
      const clip = { x: at.x, y: at.y, width: at.width, height: at.height };
      const marked = (await page.screenshot({ clip })).toString('base64');
      await shown(i, true);
      const clear = (await page.screenshot({ clip })).toString('base64');
      await shown(i, false);
      ink = await pixels.evaluate(changed, [marked, clear]);
    }
    if (ink < at.size * at.size * 0.03 * 0.25) out.push(`"${at.word}" at ${at.size}px`);
  }
  await page.evaluate(() => {
    for (const [e, top, left] of window.__marks.was) e.scrollTo(left, top);
    delete window.__marks;
  });
  return out;
}

/** The area, in square CSS pixels, where two PNG shots of the same box differ. */
async function changed(pngs) {
  const [a, b] = await Promise.all(
    pngs.map(async (png) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const g = new OffscreenCanvas(img.width, img.height).getContext('2d');
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height).data;
    }),
  );
  let n = 0;
  for (let k = 0; k < a.length; k += 4) if (Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2])) > 40) n++;
  return n / devicePixelRatio ** 2;
}

/**
 * Why the diary's week, which scrolls sideways inside its panel on a narrow screen, is out of a keyboard's reach, or ''
 * if it isn't: a region named Past seven days that Tab lands on from the control before it, showing a focus ring of at
 * least 2 px that no box around it cuts.
 */
async function weekReach(page) {
  if ((await page.getByRole('region', { name: 'Past seven days', exact: true }).count()) !== 1) return 'is not a region named Past seven days';
  const before = await page.evaluate(() => {
    const stops = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((e) => e.tabIndex >= 0 && !e.disabled && e.checkVisibility());
    const at = stops.indexOf(document.querySelector('.dq-week'));
    if (at > 0) stops[at - 1].focus();
    return at > 0;
  });
  if (!before) return 'is no stop for the keyboard';
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const e = document.activeElement;
    if (!e?.matches('.dq-week')) return `is skipped: Tab lands on ${e?.tagName.toLowerCase()}.${[...(e?.classList ?? [])].join('.')}`;
    const cs = getComputedStyle(e);
    const ring = parseFloat(cs.outlineWidth);
    if (!e.matches(':focus-visible') || cs.outlineStyle === 'none' || ring < 2) return `shows no focus ring (${cs.outlineStyle} ${cs.outlineWidth})`;
    e.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = e.getBoundingClientRect();
    const out = ring + parseFloat(cs.outlineOffset);
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      const q = p.getBoundingClientRect();
      // a box that scrolls up and down (the page) brings the ring's top and bottom into view; nothing may cut its sides
      if ((ps.overflowX !== 'visible' && (r.left - out < q.left - 0.5 || r.right + out > q.right + 0.5)) || (/hidden|clip/.test(ps.overflowY) && (r.top - out < q.top - 0.5 || r.bottom + out > q.bottom + 0.5))) return `has its focus ring cut by ${p.tagName.toLowerCase()}.${[...p.classList].join('.')} (${[r.left - out, r.right + out, r.top - out, r.bottom + out].map(Math.round)} in ${[q.left, q.right, q.top, q.bottom].map(Math.round)})`;
    }
    return '';
  });
}

/**
 * Why the control `sel` names is out of reach, or '' if it isn't: it is at least 44 px each way, its whole box is on
 * screen (with `below`, under the top bar) and inside every box that clips it, and it takes the tap at its centre and at
 * a point a quarter in from each corner, so a control a scrolling sheet cuts at one edge is out of reach though its centre
 * still takes the tap. With `optional`, a control the screen doesn't have is no problem.
 */
const reach = (page, sel, { below = true, optional = false } = {}) =>
  page.evaluate(
    ({ sel, below, optional }) => {
      const e = document.querySelector(sel);
      if (!e) return optional ? '' : 'it is missing';
      const r = e.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) return `it is ${Math.round(r.width)}x${Math.round(r.height)} px`;
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

/** Every screen, and the sheets, on one phone at 200% zoom, or with `font`, with the phone's own text at 200%. */
function sweep(phone, { font = false } = {}) {
  return async (h) => {
    const failed = [];
    const size = `${phone.width}x${phone.height} ${font ? 'with its text at 200%' : 'at 200%'}`;
    const zoomed = font ? phone : { width: phone.width / 2, height: phone.height / 2 };
    const now = Date.now();
    const save = fullSave(now);
    const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: save.created, companionAt: save.created });
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(save), [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', zoomed, undefined, font ? { isMobile: true, hasTouch: true } : {});
    // a blank page that reads the screen's pixels
    const pixels = await ctx.newPage();
    try {
      await h.reachHub(page);
      await seedStores(page, h.SAVE, now);
      // the drawings named with a long word, as a player may name them
      await page.evaluate(async (key) => {
        const { artStore } = await import('/src/daily/artstore.ts');
        await artStore(key).setLabels('draw-today', { name: 'Chrysanthemums' });
        await artStore(key).setLabels('draw-ally', { name: 'Chrysanthemum' });
      }, h.SAVE);
      await page.reload();
      await h.reachHub(page);
      if (font) await scaleText(page);
      const check = async (where, { words = true, sheet = null, close = null } = {}) => {
        await settle(page);
        const w = await width(page, sheet);
        const bad = [];
        if (w.doc !== w.vw) bad.push(`the page is ${w.doc} px wide`);
        if (w.dq > 0) bad.push(`the companion scrolls ${w.dq} px sideways`);
        if (w.past.length) bad.push('something reaches past the edge');
        if (w.sides.length) bad.push(`words cut at the side: ${w.sides.join(', ')}`);
        const marks = await hyphens(page, pixels, sheet ?? 'body');
        if (marks.length) bad.push(`words broken with no hyphen to see: ${marks.join(', ')}`);
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
        await h.shot(page, `wide-${phone.width}x${phone.height}${font ? '-text' : ''}-${where.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
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
        if (route.name === 'diary') {
          const week = await weekReach(page);
          if (week) failed.push(`${size} Diary: the week that scrolls sideways ${week}`);
        }
      }
      // Night Watch at the phone's own size, where its cards keep their words whole at their own sizes too
      if (!font) {
        await page.setViewportSize(phone);
        await page.evaluate(() => window.__daily.go({ name: 'shadows' }));
        await page.waitForFunction(() => window.__daily.route.name === 'shadows', null, { timeout: 10000 });
        await check('Night Watch, unzoomed');
        await page.setViewportSize(zoomed);
      }
      // Home once the check-in is answered with a feeling that asks how strong it is
      await page.evaluate(() => window.__daily.go({ name: 'hub' }));
      await page.locator('.dq-feels .dq-opt').filter({ hasText: 'Tired' }).click({ timeout: 10000 });
      await page.locator('.dq-level [role=radiogroup]').waitFor({ timeout: 10000 });
      await check('Home, How strong');
      // Settings with a look tried on in the Wardrobe, its bar under the page
      await page.evaluate(() => window.__daily.go({ name: 'settings' }));
      await page.locator('.w2-wopt:enabled[aria-checked="false"]').first().click({ timeout: 10000 });
      await page.locator('.w2-try').waitFor({ timeout: 10000 });
      await check('Wardrobe, a look tried on');

      // the sheets opened from the drawing page and the story editor
      // each sheet opens at the phone's own size, where the page can be drawn on, and is checked there and once zoomed to
      // 200%, or with the phone's text at 200%, there alone
      const sheet = async (where, { panel, close = null, clip = false }, open) => {
        await page.setViewportSize(phone);
        try {
          await open();
        } catch (e) {
          return failed.push(`${size} ${where}: could not open it: ${String(e.message).split('\n')[0]}`);
        }
        if (!font) {
          await check(`${where}, unzoomed`, { sheet: panel, close });
          await page.setViewportSize(zoomed);
        }
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

export const scenarios = Object.fromEntries(
  SIZES.flatMap((phone) => [
    [`no-sideways-overflow-${phone.width}x${phone.height}`, sweep(phone)],
    [`no-sideways-overflow-${phone.width}x${phone.height}-text-200`, sweep(phone, { font: true })],
  ]),
);
