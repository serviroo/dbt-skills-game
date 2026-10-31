// At 200% no companion screen is wider than the phone, so a sideways scroll can never push the Safe Zone button off the
// edge (DESIGN.md principle 6). A phone at 320x568, 390x844, 568x320 and 844x390 at 200% zoom (the page laid out at
// half the size, as browser zoom does), one scenario each, opens every screen on a returning save with everything
// unlocked: on each, the page is exactly as wide as the screen, nothing scrolls sideways inside the companion, and the
// Safe Zone button is whole on screen. Outside a skill's window and the Safe Zone, no row or card squeezes a word, so
// none breaks onto the next line without a hyphen. The same holds inside every watcher's card in the Night Watch camp,
// and inside the sheets opened from the drawing page and the story editor, which are opened at the phone's own size and
// checked once it zooms to 200%. A failure names the widest boxes, or the words, that reach past the edge, and the
// words that break.
import { fullSave, seedStores } from './me-91-final-save-ids.e2e.mjs';
import { cutShort } from './safe-zone-reach.e2e.mjs';

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
 * How wide the page and the companion's own scroller are against the screen, the widest boxes past its edge, and with
 * `sheet`, the boxes inside that sheet that scroll or clip sideways.
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
    const safe = document.querySelector('.dq-top .dq-safe')?.getBoundingClientRect();
    return {
      doc: doc.scrollWidth,
      dq: dq ? dq.scrollWidth - dq.clientWidth : 0,
      vw: innerWidth,
      safe: !safe || (safe.left >= -0.5 && safe.right <= innerWidth + 0.5),
      past: past.slice(0, 6),
      inner,
    };
  }, sheet);

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
      const check = async (where, { words = true, sheet = null } = {}) => {
        await settle(page);
        const w = await width(page, sheet);
        const bad = [];
        if (w.doc !== w.vw) bad.push(`the page is ${w.doc} px wide`);
        if (w.dq > 0) bad.push(`the companion scrolls ${w.dq} px sideways`);
        if (!w.safe) bad.push('the Safe Zone button is off the edge');
        if (w.inner.length) bad.push(`inside the sheet: ${w.inner.join(', ')}`);
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

      // the sheets opened from the drawing page and the story editor
      // each sheet opens at the phone's own size, where the page can be drawn on, and is checked once zoomed to 200%
      const sheet = async (where, panel, open) => {
        await page.setViewportSize(phone);
        try {
          await open();
        } catch (e) {
          return failed.push(`${size} ${where}: could not open it: ${String(e.message).split('\n')[0]}`);
        }
        await page.setViewportSize(zoomed);
        await check(where, { sheet: panel });
        await page.keyboard.press('Escape');
      };
      await sheet('shadow ally name sheet', '.dq-sheet:not(.is-hidden)', async () => {
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
      await sheet('chapter sheet', '.st-chsheet', async () => {
        await page.evaluate(() => window.__daily.go({ name: 'write', id: 'tale-1' }));
        await page.getByRole('textbox', { name: /^Page,/ }).waitFor({ timeout: 10000 });
        await page.locator('.st-chbtn').click();
        await page.locator('.st-chsheet').first().waitFor({ timeout: 10000 });
      });
      await sheet('drawing picker sheet', '.st-picks', async () => {
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
        await check(`${id}'s card`, { sheet: '.w2-camp-card' });
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

export const scenarios = Object.fromEntries(SIZES.map((phone) => [`no-sideways-overflow-${phone.width}x${phone.height}`, sweep(phone)]));
