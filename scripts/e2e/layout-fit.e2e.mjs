// Layout fit (ME-131): every companion screen fits a small phone and a phone on its side. Each screen opens on a
// returning save with everything unlocked, at 390x844, 320x568 and 844x390, and is checked for:
//   overflow    the page scrolls sideways
//   cut-off     a visible element or line of text reaches past the left or right edge of the screen (parts hidden
//               inside a box that clips or scrolls them don't count)
//   tap         a button, link or input smaller than 44x44 px whose taps don't land on it across a 44x44 px area
//   text        body text under 16 px: any visible run of four or more words, and the text in every field
// The Safe Zone and the Save Crystal panel are left out. Screens in ENFORCED fail the run; every other screen passes
// and lists its problems on stdout and under `result` in report.json, as the todo list.
import { fullSave, seedStores } from './me-91-final-save-ids.e2e.mjs';

const ENFORCED = ['library', 'skill', 'home', 'diary'];

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
];
const MIN_TAP = 44;
const MIN_TEXT = 16;
const PAGE = ['.dq-top', '#dq-main'];
const SKIP = ['.dq-safe', '.dq-safezone', '.pwa-hint-layer', '.dq-panel:has(input[type=file])'];
// one skill walked from its intro to the thanks at the end
const WALK = 'check-facts';

const SCREENS = {
  home: { route: { name: 'hub' } },
  skill: { route: { name: 'skill', id: WALK }, walk: true },
  library: { route: { name: 'library' } },
  moment: { route: { name: 'moment' } },
  diary: { route: { name: 'diary' } },
  'night-watch': { route: { name: 'shadows' }, scope: ['.w2-roster'] },
  wardrobe: { route: { name: 'settings' }, scope: ['.w2-wardrobe-p'] },
  art: { route: { name: 'art' } },
  draw: { route: { name: 'draw', kind: 'today' } },
  stories: { route: { name: 'stories' } },
  write: { route: { name: 'write', id: 'tale-1' } },
  settings: { route: { name: 'settings' }, skip: ['.w2-wardrobe-p'] },
  shadows: { route: { name: 'shadows' }, skip: ['.w2-roster'] },
};

async function boot(h, viewport) {
  const now = Date.now();
  const save = fullSave(now);
  const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: save.created, companionAt: save.created });
  const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(save), [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', viewport);
  await home(page);
  await seedStores(page, h.SAVE, now);
  await page.reload();
  await home(page);
  return { ctx, page, errors };
}

const home = (page) => page.waitForFunction(() => window.__daily?.route.name === 'hub' && !!document.querySelector('.dq-tile') && !document.querySelector('.dq-sw'), null, { timeout: 30000 });

/** Waits until the screen stops changing: no DOM changes for 400 ms (at most 4 s), then no finite animation running. */
const settle = (page) =>
  page.evaluate(async () => {
    await new Promise((done) => {
      let quiet;
      const mo = new MutationObserver(() => {
        clearTimeout(quiet);
        quiet = setTimeout(end, 400);
      });
      const end = () => {
        mo.disconnect();
        clearTimeout(cap);
        done();
      };
      const cap = setTimeout(end, 4000);
      quiet = setTimeout(end, 400);
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 3000))]);
  });

/** Every problem on the screen as it is now, inside `scope` and outside `skip`. */
const audit = (page, scope, skip) =>
  page.evaluate(
    async ({ scope, skip, MIN_TAP, MIN_TEXT }) => {
      const vw = innerWidth;
      const found = [];
      const roots = scope.flatMap((s) => [...document.querySelectorAll(s)]);
      const skipped = (el) => skip.some((s) => el.closest(s));
      const name = (el) => {
        const cls = [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
        const text = (el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 32);
        return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ''}`;
      };
      const shown = (el) => {
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      };
      // the page never scrolls sideways; the companion scrolls in .dq, whose hidden overflow still shifts on focus
      for (const s of [document.scrollingElement, document.querySelector('.dq')]) {
        if (s.scrollWidth > s.clientWidth + 1) found.push({ kind: 'overflow', what: name(s), detail: `${s.scrollWidth} px wide in ${s.clientWidth}` });
      }
      // boxes that clip their content; the page's own frame doesn't count, since that would hide what it cuts off
      const frame = new Set([document.documentElement, document.body, document.querySelector('.dq'), document.getElementById('dq-main')]);
      const clipX = (el, r) => {
        let [l, rt] = [r.left, r.right];
        for (let p = el; p && l < rt; p = p.parentElement) {
          if (frame.has(p) || getComputedStyle(p).overflowX === 'visible') continue;
          const b = p.getBoundingClientRect();
          l = Math.max(l, b.left);
          rt = Math.min(rt, b.right);
        }
        return [l, rt];
      };
      const cut = (l, rt) => rt > l + 1 && (l < -1 || rt > vw + 1);
      const els = roots.flatMap((r) => [r, ...r.querySelectorAll('*')]).filter((el) => !skipped(el) && !el.closest('svg *, .dq-sr') && shown(el));
      for (const el of els) {
        const [l, rt] = clipX(el.parentElement, el.getBoundingClientRect());
        if (cut(l, rt)) found.push({ kind: 'cut-off', what: name(el), detail: `${Math.round(l)} to ${Math.round(rt)} of ${vw}` });
      }
      // text: lines that run off the side, and body text under the minimum (labels set in capitals are not body text)
      for (const root of roots) {
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let t = walk.nextNode(); t; t = walk.nextNode()) {
          const el = t.parentElement;
          if (!t.data.trim() || skipped(el) || el.closest('svg, .dq-sr, [aria-hidden="true"]') || !shown(el)) continue;
          const range = document.createRange();
          range.selectNodeContents(t);
          for (const r of range.getClientRects()) {
            const [l, rt] = clipX(el, r);
            if (cut(l, rt)) {
              found.push({ kind: 'cut-off', what: `text "${t.data.trim().slice(0, 32)}"`, detail: `${Math.round(l)} to ${Math.round(rt)} of ${vw}` });
              break;
            }
          }
          const css = getComputedStyle(el);
          const words = t.data.match(/\S*\p{L}\S*/gu)?.length ?? 0;
          if (words >= 4 && css.textTransform !== 'uppercase' && parseFloat(css.fontSize) < MIN_TEXT - 0.01) found.push({ kind: 'text', what: name(el), detail: `${parseFloat(css.fontSize)} px` });
        }
      }
      for (const el of els.filter((e) => e.matches('textarea, select, input:is([type=text], [type=search], [type=email], [type=tel], [type=url], [type=number], [type=password], :not([type]))'))) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < MIN_TEXT - 0.01) found.push({ kind: 'text', what: name(el), detail: `${size} px` });
      }
      // tap targets: a control together with its labels, since a tap on a label lands on its control; a native field
      // drawn see-through over its own styled control still takes the tap
      const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=radio], [role=checkbox], [role=switch], [role=tab], [role=slider], [role=option]';
      const tappable = (el) => {
        const r = el.getBoundingClientRect();
        return el.checkVisibility({ checkVisibilityCSS: true }) && getComputedStyle(el).pointerEvents !== 'none' && r.width > 2 && r.height > 2;
      };
      const scrolled = new Map();
      for (const root of roots) {
        for (const c of [root, ...root.querySelectorAll(sel)]) {
          if (!c.matches(sel) || skipped(c) || c.parentElement?.closest(sel)) continue;
          const labels = [...(c.labels ?? [])].filter(shown);
          const parts = [...(shown(c) || (c.matches('input, select') && tappable(c)) ? [c] : []), ...labels];
          if (!parts.length) continue;
          const area = (e) => e.getBoundingClientRect().width * e.getBoundingClientRect().height;
          const anchor = parts.reduce((a, b) => (area(b) > area(a) ? b : a));
          for (let p = anchor.parentElement; p; p = p.parentElement) if (!scrolled.has(p)) scrolled.set(p, [p.scrollLeft, p.scrollTop]);
          anchor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
          if (parts.some((e) => e.getBoundingClientRect().width >= MIN_TAP - 0.5 && e.getBoundingClientRect().height >= MIN_TAP - 0.5)) continue;
          const r = anchor.getBoundingClientRect();
          const w = Math.max(MIN_TAP, r.width) / 2 - 1;
          const hh = Math.max(MIN_TAP, r.height) / 2 - 1;
          const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
          const mine = (n) => !!n && (c.contains(n) || labels.some((l) => l.contains(n)));
          const misses = [[-w, -hh], [0, -hh], [w, -hh], [-w, 0], [w, 0], [-w, hh], [0, hh], [w, hh]].filter(([dx, dy]) => !mine(document.elementFromPoint(cx + dx, cy + dy)));
          if (misses.length) found.push({ kind: 'tap', what: name(shown(c) ? c : anchor), detail: `${Math.round(r.width)}x${Math.round(r.height)} px` });
        }
      }
      for (const [p, [l, t]] of scrolled) p.scrollTo({ left: l, top: t, behavior: 'instant' });
      return found;
    },
    { scope, skip, MIN_TAP, MIN_TEXT },
  );

/** Taps the way forward on the current skill step: Done when it is offered, else the main button, else the first one in the step. */
const forward = (page) =>
  page.evaluate(() => {
    const body = document.querySelector('.dq-step-body');
    const vis = (b) => b.checkVisibility({ checkVisibilityCSS: true }) && !b.disabled;
    const all = [...body.querySelectorAll('.dq-actions button, .dq-opts button')].filter(vis);
    const pick = all.find((b) => b.textContent.trim() === 'Done') ?? [...body.querySelectorAll('.dq-actions .dq-btn--primary')].find(vis) ?? all[0];
    if (!pick) return false;
    pick.click();
    return true;
  });

function scenario(id, spec) {
  return async (h) => {
    const problems = [];
    for (const vp of SIZES) {
      const size = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await boot(h, vp);
      await page.evaluate((r) => window.__daily.go(r), spec.route);
      await page.waitForFunction((n) => window.__daily.route.name === n, spec.route.name, { timeout: 10000 });
      await settle(page);
      const scope = spec.scope ?? PAGE;
      const skip = [...SKIP, ...(spec.skip ?? [])];
      const views = [];
      if (spec.walk) {
        for (let step = 1; step <= 25 && (await page.evaluate((id) => window.__daily.route.name === 'skill' && window.__daily.route.id === id, spec.route.id)); step++) {
          views.push({ at: `step ${step}`, found: await audit(page, scope, skip) });
          if (step === 1) await h.shot(page, `layout-fit-${id}-${size}`);
          const before = await page.evaluate(() => document.querySelector('.dq-step-body')?.innerHTML);
          if (!(await forward(page))) break;
          await settle(page);
          if ((await page.evaluate(() => document.querySelector('.dq-step-body')?.innerHTML)) === before) break;
        }
        const left = await page.evaluate((sid) => !(window.__daily.route.name === 'skill' && window.__daily.route.id === sid), spec.route.id);
        h.expect(left && views.length > 3, `${id} ${size}: the walk through ${WALK} stopped after ${views.length} steps without finishing it`);
      } else {
        if (spec.scope) await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start', behavior: 'instant' }), spec.scope[0]);
        h.expect(await page.evaluate((s) => s.some((x) => document.querySelector(x)), scope), `${id} ${size}: nothing on screen matches ${scope.join(', ')}`);
        views.push({ at: '', found: await audit(page, scope, skip) });
        await h.shot(page, `layout-fit-${id}-${size}`);
      }
      h.expect(!errors.length, `${id} ${size}: ${errors.join('\n')}`);
      await ctx.close();
      const seen = new Set();
      for (const { at, found } of views) {
        for (const f of found) {
          const key = `${f.kind} ${f.what} ${f.detail}`;
          if (seen.has(key)) continue;
          seen.add(key);
          problems.push({ size, ...f, ...(at && { at }) });
        }
      }
    }
    const lines = problems.map((p) => `  ${p.size} ${p.kind.padEnd(8)} ${p.what} (${p.detail}${p.at ? `, ${p.at}` : ''})`);
    if (ENFORCED.includes(id)) h.expect(!problems.length, `${id} no longer fits:\n${lines.join('\n')}`);
    else if (problems.length) console.log(`todo layout-fit ${id}: ${problems.length} problems\n${lines.join('\n')}`);
    return { enforced: ENFORCED.includes(id), problems };
  };
}

export const scenarios = Object.fromEntries(Object.entries(SCREENS).map(([id, spec]) => [`layout-fit-${id}`, scenario(id, spec)]));
