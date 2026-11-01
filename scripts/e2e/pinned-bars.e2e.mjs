// Pinned bars: on every screen with a bar pinned over the page (the top bar, the Write dock, "Talk to someone now", the
// Wardrobe's try-on bar), every control scrolled to shows whole and clear of each bar it isn't part of, and every target
// stays 44 px. Each phone (320x568, 390x844 and 568x320) is checked at normal text, at 200% zoom and with the phone's own
// text at 200% (see safe-zone-reach), on Write, the Safe Zone and its Talk page, each step of a skill, Settings with and
// without a look tried on, Night Watch, the diary and the art room. Write is checked again with a keyboard over the
// page, as Safari and Chrome show one (the page its full height, only the part above the keyboard showing; see
// safe-zone-typing), and again with the page panned under it, as Safari pans it to the field (the top of the page hidden
// above what shows too). There the Safe Zone button also shows whole, at least 44 px, and takes a tap, and the dock shows
// whole unless it scrolls with the page: at 200% zoom the top bar is one row there, and held sideways the Safe Zone
// button alone at the side. And a tap on it the moment the keyboard comes up, each way,
// while the bar may still fade in, which takes focus from the field between press and release as a finger's does,
// opens the Safe Zone with its top bar shown at once. A control is scrolled to the middle of what shows, and the least
// it takes coming from the top of the page and from the bottom, as focus brings it there.
import { audit, boot, forward, PAGE, settle, SKIP, WALK } from './layout-fit.e2e.mjs';
import { scaleText } from './safe-zone-reach.e2e.mjs';
import { overlay } from './safe-zone-typing.e2e.mjs';

// a phone and about how tall its keyboard is with the suggestion bar
const PHONES = {
  '320x568': { width: 320, height: 568, kb: 253 },
  '390x844': { width: 390, height: 844, kb: 336 },
  '568x320': { width: 568, height: 320, kb: 194 },
};

const SCREENS = [
  ['write', { name: 'write', id: 'tale-1' }],
  ['safe zone', { name: 'safe', at: 'start' }],
  ['talk', { name: 'safe', at: 'talk' }],
  ['skill', { name: 'skill', id: WALK }],
  ['settings', { name: 'settings' }],
  ['night watch', { name: 'shadows' }],
  ['diary', { name: 'diary' }],
  ['art room', { name: 'art' }],
];

/**
 * Every control on the page that doesn't show whole and clear of the pinned bars once scrolled to. Whole: top to bottom
 * inside what shows of the screen (above a keyboard) and every box that clips it (cut off at the side is
 * no-sideways-overflow's). Clear: no point across it (five by five, 2 px in from its edges, past where the browser rounds
 * a bar's edge) lands on a bar pinned over the page (fixed or sticky) that it isn't part of. A control taller than a
 * third of what shows and than the room the bars leave down its column, like the writing page or a tall card, shows only
 * part of itself at a time, so there the edge it is scrolled to must show and clear them: its top coming from above, its
 * bottom from below. Any shorter control shows whole, so bars that leave less room than it needs fail.
 */
const underBars = (page) =>
  page.evaluate(
    ({ scope, skip }) => {
      const out = new Set();
      const frame = document.querySelector('.dq');
      const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=radio], [role=checkbox], [role=switch], [role=tab], [role=slider], [role=option]';
      const name = (e) => `"${(e.getAttribute('aria-label') || e.textContent || e.value || e.placeholder || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 32)}"`;
      const box = (r) => `${[r.left, r.top, r.right, r.bottom].map(Math.round).join(', ')} in ${innerWidth}x${innerHeight}`;
      const bar = (p) => `${p.tagName.toLowerCase()}.${[...p.classList].join('.')}`;
      // what shows of the screen, down to a keyboard
      const [top, end] = [visualViewport.offsetTop, visualViewport.offsetTop + visualViewport.height];
      // the bar pinned over the page at a point, unless the point is the control's own or the bar holds the control
      const pinAt = (c, x, y) => {
        const hit = document.elementFromPoint(x, y);
        if (!hit || c.contains(hit) || [...(c.labels ?? [])].some((l) => l.contains(hit))) return null;
        for (let p = hit; p && p !== frame; p = p.parentElement) if (/^(fixed|sticky)$/.test(getComputedStyle(p).position)) return p.contains(c) ? null : p;
        return null;
      };
      // the part that shows: inside what shows of the screen and inside every box around it that clips
      const shown = (c) => {
        const r = c.getBoundingClientRect();
        let [l, t, rt, b] = [Math.max(r.left, 0), Math.max(r.top, top), Math.min(r.right, innerWidth), Math.min(r.bottom, end)];
        for (let p = c.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const q = p.getBoundingClientRect();
          const [x, y] = [q.left + p.clientLeft, q.top + p.clientTop];
          [l, t, rt, b] = [Math.max(l, x), Math.max(t, y), Math.min(rt, x + p.clientWidth), Math.min(b, y + p.clientHeight)];
        }
        return { l, t, rt, b };
      };
      const across = (a, z) => [0, 0.25, 0.5, 0.75, 1].map((f) => a + 2 + f * (z - a - 4));
      // the room the bars leave the control: the tallest run down its column at x that no bar covers, and no more than
      // its scroller stops a scroll inside (within its scroll-padding)
      const room = (c, x) => {
        let [best, run] = [0, 0];
        for (let y = top + 0.5; y < end; y++) best = Math.max(best, (run = pinAt(c, x, y) ? 0 : run + 1));
        const s = scrollers(c)[0] ?? frame;
        const cs = getComputedStyle(s);
        return Math.min(best, s.clientHeight - (parseFloat(cs.scrollPaddingTop) || 0) - (parseFloat(cs.scrollPaddingBottom) || 0));
      };
      const check = (c, how) => {
        const r = c.getBoundingClientRect();
        const v = shown(c);
        const whole = v.rt > v.l && v.b - v.t >= r.height - 1;
        const over = v.rt > v.l && v.b > v.t ? across(v.t, v.b).flatMap((y) => across(v.l, v.rt).map((x) => pinAt(c, x, y))).find(Boolean) : null;
        if (whole && !over) return;
        // panned under a keyboard, the top of the page shows only as Safari pans back up to it: a control starting above
        // where a scroll stops, with the page at its top, is out of the page's own reach
        if (top > 0 && r.top < parseFloat(getComputedStyle(frame).scrollPaddingTop) && scrollers(c).every((s) => s.scrollTop <= 0)) return;
        if (r.height > (end - top) / 3 && r.height > room(c, (v.l + v.rt) / 2) + 1) {
          if (how === 'scrolled to the middle') return;
          const [edge, y, shows] = how === 'scrolled to from above' ? ['top', r.top + 2, v.t <= r.top + 1] : ['bottom', r.bottom - 2, v.b >= r.bottom - 1];
          const on = shows && across(v.l, v.rt).map((x) => pinAt(c, x, y)).find(Boolean);
          if (!shows) out.add(`${name(c)}, taller than the room between the bars, doesn't show its ${edge} ${how} (${box(r)})`);
          else if (on) out.add(`${name(c)}, taller than the room between the bars, has its ${edge} under ${bar(on)} ${how} (${box(r)})`);
          return;
        }
        out.add(over ? `${name(c)} is under ${bar(over)} ${how} (${box(r)})` : `${name(c)} doesn't show whole ${how} (${box(r)})`);
      };
      const controls = scope
        .flatMap((s) => [...document.querySelectorAll(s)])
        .flatMap((root) => [...root.querySelectorAll(sel)])
        .filter((c) => !skip.some((s) => c.closest(s)) && !c.parentElement?.closest(sel) && !c.closest('.dq-sr') && c.checkVisibility({ checkVisibilityCSS: true }))
        .filter((c) => c.getBoundingClientRect().width > 2 && c.getBoundingClientRect().height > 2);
      const scrollers = (c) => {
        const all = [];
        for (let p = c.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) all.push(p);
        return all;
      };
      const kept = new Map();
      // scrolled the way the player can: a row that scrolls sideways shows the card it is on from its start (where the
      // row snaps), and the page never scrolls sideways, though a script can still move it there
      const to = (c, block) => {
        c.scrollIntoView({ block, inline: 'start', behavior: 'instant' });
        for (const s of [document.scrollingElement, frame]) s.scrollLeft = 0;
      };
      for (const c of controls) {
        const ss = scrollers(c);
        for (const s of ss) if (!kept.has(s)) kept.set(s, s.scrollTop);
        to(c, 'center');
        check(c, 'scrolled to the middle');
        for (const [end, how] of [['top', 'scrolled to from above'], ['bottom', 'scrolled to from below']]) {
          for (const s of ss) s.scrollTop = end === 'top' ? 0 : s.scrollHeight;
          to(c, 'nearest');
          check(c, how);
        }
      }
      for (const [s, top] of kept) s.scrollTop = top;
      return [...out];
    },
    { scope: PAGE, skip: SKIP },
  );

/** What keeps the pinned bars from showing whole in what shows of the screen with a keyboard up: the top bar's Safe Zone
 * button, at least 44 px and taking a tap, and the Write dock unless it scrolls with the page. */
const barsShown = (page) =>
  page.evaluate(() => {
    const out = [];
    const [top, end] = [visualViewport.offsetTop, visualViewport.offsetTop + visualViewport.height];
    const where = (r) => `${[r.left, r.top, r.right, r.bottom].map(Math.round).join(', ')}, showing ${Math.round(top)} to ${Math.round(end)}`;
    const whole = (r) => r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= top - 0.5 && r.bottom <= end + 0.5;
    const b = document.querySelector('.dq-top .dq-safe');
    if (!b?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) out.push("the Safe Zone button doesn't show");
    else {
      const r = b.getBoundingClientRect();
      if (!whole(r)) out.push(`the Safe Zone button doesn't show whole (${where(r)})`);
      else if (r.width < 43.5 || r.height < 43.5) out.push(`the Safe Zone button is ${Math.round(r.width)}x${Math.round(r.height)} px (${where(r)})`);
      else if (!b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))) out.push(`the Safe Zone button doesn't take a tap (${where(r)})`);
    }
    const dock = document.querySelector('.st-dock');
    if (dock && !dock.hasAttribute('data-loose') && !whole(dock.getBoundingClientRect())) out.push(`the dock doesn't show whole (${where(dock.getBoundingClientRect())})`);
    return out;
  });

function scenario(phone, { zoom = 1, font = false } = {}) {
  return async (h) => {
    const p = PHONES[phone];
    const size = font ? `${phone} with its text at 200%` : `${phone}${zoom > 1 ? ` at ${zoom * 100}%` : ''}`;
    const tag = `${phone}-${font ? 'text-200' : zoom * 100}`;
    const problems = [];
    // the keyboard stands in for the page's visual viewport before the app starts, so the app follows it
    const prepare = (ctx) => ctx.addInitScript(overlay);
    const { ctx, page, errors } = font ? await boot(h, { width: p.width, height: p.height }, { prepare, device: { isMobile: true, hasTouch: true } }) : await boot(h, { width: p.width / zoom, height: p.height / zoom }, { prepare });
    if (font) await scaleText(page);
    const look = async (label) => {
      await settle(page);
      for (const f of await underBars(page)) problems.push(`${size}, ${label}: ${f}`);
      for (const f of await audit(page, PAGE, SKIP)) if (f.kind === 'tap') problems.push(`${size}, ${label}: ${f.what} is ${f.detail}, under 44 px`);
      await h.shot(page, `pinned-bars-${tag}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
    };
    for (const [label, route] of SCREENS) {
      await page.evaluate((r) => window.__daily.go(r), route);
      await page.waitForFunction((r) => Object.entries(r).every(([k, v]) => window.__daily.route[k] === v), route, { timeout: 10000 });
      if (route.name === 'skill') {
        // each step of the skill, from its intro to the thanks at the end
        for (let step = 1; step <= 25 && (await page.evaluate((id) => window.__daily.route.name === 'skill' && window.__daily.route.id === id, route.id)); step++) {
          await look(`skill step ${step}`);
          const before = await page.evaluate(() => document.querySelector('.dq-step-body')?.innerHTML);
          if (!(await forward(page))) break;
          await settle(page);
          if ((await page.evaluate(() => document.querySelector('.dq-step-body')?.innerHTML)) === before) break;
        }
        continue;
      }
      await look(label);
      if (route.name === 'write') {
        const kb = Math.round(p.kb / zoom);
        const up = { height: Math.round(p.height / zoom) - kb, top: 0 };
        // panned half the keyboard's height to the field, so as much of the page hides above what shows as under the keyboard
        const panned = { ...up, top: Math.round(kb / 2) };
        await page.locator('.st-ta').focus();
        for (const [k, how] of [
          [up, 'the keyboard up'],
          [panned, 'the page panned under the keyboard'],
        ]) {
          await page.evaluate((k) => window.__kb(k), k);
          await settle(page);
          for (const f of await barsShown(page)) problems.push(`${size}, write, ${how}: ${f}`);
          await look(`write, ${how}`);
        }
        // a tap each way the keyboard comes up, back on Write for the next
        for (const [k, how] of [
          [up, 'the keyboard up'],
          [panned, 'the page panned under the keyboard'],
        ]) {
          await page.evaluate(() => window.__kb(null));
          if (await page.evaluate(() => window.__daily.route.name !== 'write')) {
            await page.evaluate((r) => window.__daily.go(r), route);
            await page.waitForFunction(() => window.__daily.route.name === 'write', null, { timeout: 10000 });
          }
          await settle(page);
          await page.locator('.st-ta').focus();
          await page.evaluate((k) => window.__kb(k), k);
          const b = await page.locator('.dq-top .dq-safe').boundingBox();
          if (font) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
          else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
          if (!(await page.waitForFunction(() => window.__daily.route.name === 'safe', null, { timeout: 5000 }).then(() => true, () => false))) problems.push(`${size}, write, ${how}: a tap on the Safe Zone button left ${await page.evaluate(() => window.__daily.route.name)} open`);
          else {
            const shown = await page.evaluate(() => getComputedStyle(document.querySelector('.dq-top')).opacity);
            if (+shown < 0.99) problems.push(`${size}, write, ${how}: the Safe Zone opened with its top bar at opacity ${shown}`);
          }
        }
        await page.evaluate(() => window.__kb(null));
      }
      if (route.name === 'settings') {
        // a look tried on brings up the bar under the page
        await page.evaluate(() => document.querySelector('.w2-wopt[aria-checked="false"]:not(:disabled)').click());
        await page.locator('.w2-try').waitFor({ timeout: 5000 });
        await look('settings, a look tried on');
        await page.locator('.w2-try').getByRole('button', { name: 'Go back' }).click();
      }
    }
    if (errors.length) problems.push(`${size}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

export const scenarios = Object.fromEntries(
  Object.keys(PHONES).flatMap((phone) => [
    [`pinned-bars-${phone}`, scenario(phone)],
    [`pinned-bars-${phone}-200`, scenario(phone, { zoom: 2 })],
    [`pinned-bars-${phone}-text-200`, scenario(phone, { font: true })],
  ]),
);
