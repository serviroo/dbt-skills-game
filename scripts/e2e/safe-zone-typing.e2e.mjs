// Typing in the Safe Zone with the phone's keyboard up: "Talk to someone now", Leave, Lights up and Sound stay on
// screen and take a tap, and the field being typed in shows whole with a line of the screen's words, on every Safe Zone
// screen with a field (the things that are yours, the comfort kit, and a person's name and number), adding one or
// changing one already there. Each phone is
// checked held sideways, where the keyboard leaves 126 or 190 px, and upright, at normal text, with the phone's own
// text at 200% (see scaleText), and with that and Largest in Settings too; at 200% zoom; with Largest picked in
// another open copy while typing; turned while typing (see turned); and pinched in (see pinched). The keyboard takes
// the bottom of the screen two ways: a phone that gives the page only the height above it, and one that keeps the page
// its full height and shows only the part above it, as Safari and Chrome do. Chromium shows no keyboard here, so that
// phone's part is reported to the page the way a phone reports it, as its visual viewport, panned down a little, as a
// phone pans to the field. In each state:
//   talk     "Talk to someone now", in those words, shows whole in the part of the screen above the keyboard (pinched
//            in, only the part pinched to), at least 44 px tall, its words no smaller than with the keyboard down, and
//            takes a tap
//   bar      Leave, Lights up and Sound show whole there with their icon or words, each at least 44 px and named, and
//            take their taps
//   field    the field keeps focus and shows whole there, at least 44 px wide, clear of the pinned bars and Talk, with
//            at least one whole line of the screen's words (its heading, a line of its list or the field's label) beside or above it; but
//            on the smaller phone with Largest in Settings or at 200% zoom, and held sideways at 200%, where Talk, the
//            bar and the field leave too little for one, only the field; and changing one, whose own words the field
//            holds, only the field
//   down     as the keyboard goes away the usual screen comes back at once: Talk under the frame, the field still
//            focused and in view
import path from 'node:path';
import { screenshot, until } from './harness.mjs';
import { boot, settle } from './layout-fit.e2e.mjs';
import { listed } from './me-92-safe-zone-clean.e2e.mjs';
import { scaleText } from './safe-zone-reach.e2e.mjs';

// a phone and about how tall its keyboard is with the suggestion bar, held each way
const PHONES = {
  '568x320': { width: 568, height: 320, kb: 194 },
  '844x390': { width: 844, height: 390, kb: 200 },
  '390x844': { width: 390, height: 844, kb: 336 },
  '320x568': { width: 320, height: 568, kb: 253 },
};
const SCREENS = [
  ['reasons', 'Things that are yours', 'Add one', ['Add one']],
  ['comfort', 'Your comfort kit', 'Add one', ['Add one']],
  ['people', 'Your people', 'Add a person', ['Name', 'Number']],
];

/**
 * In place of the page's visual viewport, one that reports the part of the screen above a keyboard that `window.__kb`
 * sets ({ height, top }, or null for none), never taller than the page, pinched in `window.__zoom` times (that much
 * narrower and shorter in the page's px, its scale that much more), and passes on the real one's events. And the
 * way the phone is held, `heldAs` and then as `window.__held` sets it ('portrait' or 'landscape'), as a phone reports
 * it in screen.orientation, since Chromium here takes it from the page's shape, which a keyboard or another app beside
 * it changes. And the page without focus while `window.__away` says so, as when the phone takes it to put the page
 * beside another app, since Chromium here gives every page focus.
 */
export const overlay = (heldAs) => {
  let held = heldAs ?? (innerWidth > innerHeight ? 'landscape' : 'portrait');
  Object.defineProperty(screen, 'orientation', { configurable: true, get: () => ({ type: `${held}-primary`, angle: held === 'portrait' ? 0 : 90 }) });
  window.__held = (h) => {
    held = h;
  };
  let away = false;
  document.hasFocus = () => !away;
  window.__away = (a) => {
    away = a;
  };
  const real = window.visualViewport;
  const own = new EventTarget();
  let kb = null;
  let zoom = 1;
  const vv = {
    get width() {
      return real.width / zoom;
    },
    get height() {
      return (kb ? Math.min(kb.height, real.height) : real.height) / zoom;
    },
    get offsetTop() {
      return kb ? kb.top : real.offsetTop;
    },
    get offsetLeft() {
      return real.offsetLeft;
    },
    get pageTop() {
      return kb ? kb.top : real.pageTop;
    },
    get pageLeft() {
      return real.pageLeft;
    },
    get scale() {
      return real.scale * zoom;
    },
    addEventListener(...a) {
      real.addEventListener(...a);
      own.addEventListener(...a);
    },
    removeEventListener(...a) {
      real.removeEventListener(...a);
      own.removeEventListener(...a);
    },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  window.__kb = (k) => {
    kb = k;
    own.dispatchEvent(new Event('resize'));
    own.dispatchEvent(new Event('scroll'));
  };
  window.__zoom = (z) => {
    zoom = z;
    own.dispatchEvent(new Event('resize'));
    own.dispatchEvent(new Event('scroll'));
  };
};

/**
 * What fails `talk`, `bar` and `field` (see the top) with the keyboard up, `size` being Talk's words with it down;
 * `line`: the line of words beside the field too.
 */
const up = (page, size, { line: needLine = true } = {}) =>
  page.evaluate(
    ({ size, needLine }) => {
      const out = [];
      const vv = visualViewport;
      const [left, top, right, bottom] = [vv.offsetLeft, vv.offsetTop, vv.offsetLeft + vv.width, vv.offsetTop + vv.height];
      const box = (r) => `${[r.left, r.top, r.right, r.bottom].map(Math.round).join(', ')} with ${[left, top, right, bottom].map(Math.round).join(', ')} showing`;
      // the part of `r` that shows: in the part of the screen above the keyboard and inside every box around `e` that
      // clips
      const shown = (e, r = e.getBoundingClientRect()) => {
        let [l, t, rt, b] = [Math.max(r.left, left), Math.max(r.top, top), Math.min(r.right, right), Math.min(r.bottom, bottom)];
        for (let p = e.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const q = p.getBoundingClientRect();
          const [x, y] = [q.left + p.clientLeft, q.top + p.clientTop];
          [l, t, rt, b] = [Math.max(l, x), Math.max(t, y), Math.min(rt, x + p.clientWidth), Math.min(b, y + p.clientHeight)];
        }
        return [l, t, rt, b];
      };
      const whole = (e, r = e.getBoundingClientRect()) => {
        const [l, t, rt, b] = shown(e, r);
        return rt - l >= r.width - 1 && b - t >= r.height - 1;
      };
      // what a tap on the middle, or in from a corner far enough to be inside its rounding, lands on when it isn't `e`
      const taken = (e) => {
        const r = e.getBoundingClientRect();
        const d = Math.max(4, 0.3 * Math.min(parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0, r.width / 2, r.height / 2) + 1);
        const at = [[r.left + d, r.top + d], [r.right - d, r.top + d], [r.left + d, r.bottom - d], [r.right - d, r.bottom - d], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
        const hit = at.map(([x, y]) => document.elementFromPoint(x, y)).find((x) => !x || !(e.contains(x) || [...(e.labels ?? [])].some((l) => l.contains(x))));
        return hit === undefined ? null : hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing';
      };
      const reach = (e, what) => {
        const r = e.getBoundingClientRect();
        if (!whole(e)) out.push(`${what} doesn't show whole above the keyboard (${box(r)})`);
        else if (taken(e)) out.push(`${what} is under ${taken(e)} (${box(r)})`);
        return r;
      };
      const talk = document.querySelector('.dq-sz-talk');
      const words = talk.textContent.replace(/\s+/g, ' ').trim();
      if (words !== 'Talk to someone now') out.push(`Talk reads "${words}"`);
      if (reach(talk, '"Talk to someone now"').height < 43.5) out.push(`"Talk to someone now" is ${Math.round(talk.getBoundingClientRect().height)} px tall, under 44 px`);
      const now = parseFloat(getComputedStyle(talk.lastElementChild).fontSize);
      if (now < size - 0.01) out.push(`"Talk to someone now" is ${now} px, smaller than its ${size} px with the keyboard down`);
      for (const [what, sel, name] of [['Leave', '.dq-top .dq-back', /^Leave$/], ['Lights up', '.dq-top .ca-sz-light', /^Lights (up|down)$/], ['Sound', '.dq-top .vol-btn', /^Sound settings$/]]) {
        const e = document.querySelector(sel);
        const r = reach(e, what);
        if (r.width < 43.5 || r.height < 43.5) out.push(`${what} is ${Math.round(r.width)}x${Math.round(r.height)}, under 44 px`);
        const drawn = [...e.querySelectorAll('*')].some((c) => c.getBoundingClientRect().width >= 8 && c.getBoundingClientRect().height >= 8 && c.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
        if (!drawn) out.push(`${what} shows neither its icon nor its words`);
        const said = (e.getAttribute('aria-label') ?? e.textContent).replace(/\s+/g, ' ').trim();
        if (!name.test(said)) out.push(`${what} is named "${said}"`);
      }
      const field = document.activeElement;
      if (!field?.matches('.dq-safezone input')) return [...out, `focus is on ${field?.tagName.toLowerCase()}.${[...(field?.classList ?? [])].join('.')}, not the field`];
      const r = reach(field, 'the field');
      if (r.width < 43.5) out.push(`the field is ${Math.round(r.width)} px wide, under 44 px`);
      for (const [what, e] of [['the bar', document.querySelector('.dq-top')], ['"Talk to someone now"', talk]]) {
        const q = e.getBoundingClientRect();
        if (r.left < q.right - 1 && q.left < r.right - 1 && r.top < q.bottom - 1 && q.top < r.bottom - 1) out.push(`the field is under ${what} (${box(r)})`);
      }
      // a whole line of the screen's own words that nothing covers: not a button's, a link's or one kept for a screen
      // reader
      const texts = document.createTreeWalker(document.querySelector('.dq-sz-body'), NodeFilter.SHOW_TEXT);
      let line = !needLine;
      for (let n = texts.nextNode(); n && !line; n = texts.nextNode()) {
        const e = n.parentElement;
        if (!n.data.trim() || e.closest('button, a, .dq-sr, .is-hidden')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        line = [...range.getClientRects()].some((r) => r.width > 1 && whole(e, r) && e.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)));
      }
      if (!line) out.push(`no whole line of the screen's words shows with the field (${box(field.getBoundingClientRect())})`);
      return out;
    },
    { size, needLine },
  );

/** What fails `down` (see the top), two frames after the keyboard goes away. */
const down = (page) =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = [];
    const talk = document.querySelector('.dq-sz-talk');
    if (!talk.closest('.dq-sz-foot')) out.push(`"Talk to someone now" isn't back under the frame`);
    const field = document.activeElement;
    if (!field?.matches('.dq-safezone input')) return [...out, `focus went to ${field?.tagName.toLowerCase()}.${[...(field?.classList ?? [])].join('.')}`];
    const r = field.getBoundingClientRect();
    let [t, b] = [Math.max(r.top, 0), Math.min(r.bottom, innerHeight)];
    for (let p = field.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowY === 'visible') continue;
      const q = p.getBoundingClientRect();
      [t, b] = [Math.max(t, q.top + p.clientTop), Math.min(b, q.top + p.clientTop + p.clientHeight)];
    }
    if (b - t < r.height - 1) out.push(`the field doesn't show whole (${Math.round(r.top)} to ${Math.round(r.bottom)})`);
    return out;
  });

function typing(phone, { zoom = 1, font = false, largest = false, elsewhere = false } = {}) {
  return async (h) => {
    const p = PHONES[phone];
    const tag = `${phone}${zoom > 1 ? '-200' : ''}${font ? '-text-200' : ''}${largest ? '-largest' : ''}`;
    const size = `${phone}${zoom > 1 ? ' at 200%' : ''}${font ? ' with its text at 200%' : ''}${largest ? ' and Largest in Settings' : ''}`;
    const [width, height, kb] = [p.width, p.height, p.kb].map((n) => Math.round(n / zoom));
    // the line of words beside the field (see the top)
    const line = !(['568x320', '320x568'].includes(phone) && (largest || zoom > 1)) && !(p.width > p.height && zoom > 1);
    const problems = [];
    const now = Date.now();
    const filled = (save) => {
      save.lists = { ...save.lists, reasons: listed(3, 'reason'), comfort: listed(3, 'comfort'), people: [{ id: 'kb-p1', name: 'Sam', phone: '+1 555 0100', at: now }] };
    };
    const { ctx, page, errors } = await boot(h, { width, height }, font ? { edit: filled, device: { isMobile: true, hasTouch: true } } : { edit: filled });
    if (font) await scaleText(page);
    if (largest) await page.evaluate((key) => localStorage.setItem(`${key}.read-size`, 'largest'), h.SAVE);
    await page.evaluate(overlay);
    await page.locator('header .dq-safe').click();
    await page.locator('.dq-sz-t').first().waitFor({ timeout: 10000 });
    // the part above the keyboard: the page resized to it, or the whole page with only it showing, panned down a little
    const raise = async (kind) => {
      if (kind === 'resize') await page.setViewportSize({ width, height: height - kb });
      else await page.evaluate((k) => window.__kb(k), { height: height - kb, top: Math.round(kb / 4) });
      // the phone brings the field into view, the least it takes
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.evaluate(() => document.activeElement?.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
      await settle(page);
    };
    const lower = async (kind) => {
      if (kind === 'resize') await page.setViewportSize({ width, height });
      else await page.evaluate(() => window.__kb(null));
    };
    // another open copy, where Text size is picked while the keyboard is up here
    const other = elsewhere ? await ctx.newPage() : null;
    if (other) {
      other.on('pageerror', (e) => errors.push(`another tab: ${e.message}`));
      await other.goto(`${h.server.url}/?mute`);
      await other.waitForFunction(() => !!window.__daily, null, { timeout: 30000 });
      await other.evaluate(() => window.__daily.go({ name: 'settings' }));
    }
    const pick = async (name, size) => {
      const radio = other.getByRole('radio', { name: `Text size: ${name}` });
      await radio.scrollIntoViewIfNeeded();
      await radio.click();
      await until(page, (s) => document.querySelector('.dq-safezone')?.dataset.size === s, size);
      await settle(page);
    };
    for (const [at, title, add, fields] of elsewhere ? SCREENS.slice(0, 1) : SCREENS) {
      await page.evaluate((a) => window.__daily.go({ name: 'safe', at: a }), at);
      await page.locator('.dq-sz-t', { hasText: title }).first().waitFor({ timeout: 10000 });
      await page.locator('.dq-sz-body').getByRole('button', { name: add, exact: true }).last().evaluate((b) => b.click());
      // each field a new one is typed in, then each of the first entry's, changed
      const changing = async (i) => {
        if (!(await page.locator('li.is-editing').count())) {
          await page.locator('.dq-sz-body').getByRole('button', { name: 'Edit the list', exact: true }).evaluate((b) => b.click());
          await page.locator('.dq-sz-body li [data-act="edit"]').first().evaluate((b) => b.click());
        }
        await page.locator('li.is-editing input').nth(i).focus();
      };
      const each = [
        ...fields.map((label) => [fields.length > 1 ? label : '', () => page.locator('.dq-sz-body').getByLabel(label, { exact: true }).focus()]),
        ...fields.map((label, i) => [`changing${fields.length > 1 ? ` ${label}` : ''}`, () => changing(i)]),
      ];
      for (const [name, focus] of each) {
        await focus();
        await settle(page);
        const words = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.dq-sz-talk').lastElementChild).fontSize));
        for (const kind of ['resize', 'over']) {
          const state = `${size}, ${at}${name ? `, ${name}` : ''}, keyboard ${kind === 'resize' ? 'resizing the page' : 'over the page'}`;
          await raise(kind);
          for (const f of await up(page, words, { line: line && !name.startsWith('changing') })) problems.push(`${state}: ${f}`);
          if (other) {
            await pick('Largest', 'largest');
            for (const f of await up(page, words, { line: false })) problems.push(`${state}, Largest picked in another tab: ${f}`);
            await pick('Regular', 'regular');
          }
          const clip = await page.evaluate(() => ({ x: 0, y: visualViewport.offsetTop, width: innerWidth, height: visualViewport.height }));
          await screenshot(page, { path: path.join(h.out, `safe-zone-typing-${tag}-${at}${name ? `-${name.toLowerCase().replace(/ /g, '-')}` : ''}-${kind}${other ? '-elsewhere' : ''}.png`), clip });
          await lower(kind);
          for (const f of await down(page)) problems.push(`${state}, then down: ${f}`);
          await settle(page);
        }
      }
    }
    if (errors.length) problems.push(`${size}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

/**
 * A phone at `viewport`, held as `held` is, typing on the Safe Zone's things that are yours, and the size of Talk's
 * words there. `strong`: come there by way of "I might not be safe" and the steps after it, so Talk shows stronger.
 */
async function typeIn(h, viewport, held, strong = false) {
  const { ctx, page, errors } = await boot(h, viewport);
  await page.evaluate(overlay, held);
  await page.locator('header .dq-safe').click();
  if (strong) {
    const tap = (name) => page.getByRole('button', { name, exact: true }).first().evaluate((b) => b.click());
    for (const name of ['I might not be safe', 'Back to breathing', 'Next', 'Next', 'Next', 'About the same']) await tap(name);
    while (await page.locator('.dq-sz-body').getByRole('button', { name: 'Next line', exact: true }).count()) await tap('Next line');
    await tap('Next');
  } else await page.evaluate(() => window.__daily.go({ name: 'safe', at: 'reasons' }));
  await page.locator('.dq-sz-t', { hasText: 'Things that are yours' }).first().waitFor({ timeout: 10000 });
  await page.locator('.dq-sz-body').getByRole('button', { name: 'Add one', exact: true }).last().evaluate((b) => b.click());
  await page.locator('.dq-sz-body').getByLabel('Add one', { exact: true }).focus();
  await settle(page);
  const words = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.dq-sz-talk').lastElementChild).fontSize));
  return { ctx, page, errors, words };
}

/**
 * Turning the phone while typing, upright to sideways and back, with each kind of keyboard: wherever the keyboard
 * goes down the usual screen comes back with the field focused, and with it up "Talk to someone now", Leave, Lights up
 * and Sound are on screen, upright, turned sideways, and sideways with the keyboard down and up again. A phone that
 * resizes the page, turned with its keyboard up, shows a height it hasn't had with the keyboard down, and the keyboard
 * stays up through the turn, coming up a strip taller first and then settling: turned from the bigger phone, where the
 * usual screen fits above it upright, and from the smaller, where it doesn't. At 200% zoom held sideways the keyboard
 * leaves under 100 px, too little for a line of words beside Talk, the bar and the field, and upright the list stays
 * where the turns left it, so that line is only checked at 100%.
 */
function turned(phone, zoom = 1) {
  return async (h) => {
    const [upright, sideways] = [phone, phone.split('x').reverse().join('x')].map((n) => PHONES[n]).map((p) => ({ width: p.width / zoom, height: p.height / zoom, kb: Math.round(p.kb / zoom) }));
    const size = `${phone} turned${zoom > 1 ? ' at 200%' : ''}`;
    const problems = [];
    const { ctx, page, errors, words } = await typeIn(h, { width: upright.width, height: upright.height }, 'portrait');
    // the keyboard up or down on the phone held as `s` is, the page resized to the part above it or with only that
    // showing; `strip`: it comes up that much taller first, a frame before it settles
    const to = async (s, kind, up, strip = 0) => {
      await page.evaluate((held) => window.__held(held), s === upright ? 'portrait' : 'landscape');
      for (const kb of strip ? [s.kb + strip, s.kb] : [s.kb]) {
        await page.setViewportSize({ width: s.width, height: kind === 'resize' && up ? s.height - kb : s.height });
        await page.evaluate((k) => window.__kb(k), kind === 'over' && up ? { height: s.height - kb, top: Math.round(kb / 4) } : null);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      }
      await page.evaluate(() => document.activeElement?.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
      await settle(page);
    };
    for (const kind of ['resize', 'over']) {
      const state = (what) => `${size}, keyboard ${kind === 'resize' ? 'resizing the page' : 'over the page'}, ${what}`;
      await to(upright, kind, true);
      for (const f of await up(page, words, { line: zoom === 1 })) problems.push(`${state('upright')}: ${f}`);
      await to(sideways, kind, true, Math.round(16 / zoom));
      for (const f of await up(page, words, { line: zoom === 1 })) problems.push(`${state('turned sideways')}: ${f}`);
      await to(sideways, kind, false);
      for (const f of await down(page)) problems.push(`${state('turned sideways, then down')}: ${f}`);
      await to(sideways, kind, true);
      for (const f of await up(page, words, { line: zoom === 1 })) problems.push(`${state('sideways, up again')}: ${f}`);
      await to(sideways, kind, false);
      await to(upright, kind, false);
      for (const f of await down(page)) problems.push(`${state('turned back upright')}: ${f}`);
    }
    if (errors.length) problems.push(`${size}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

/**
 * The window resized beside another app while typing, the smaller phone held sideways with a keyboard that resizes the
 * page: from half the screen's width to all of it, or from all of it to half, with the keyboard up, dragged there by
 * way of three quarters. The screen's height stays, so its room does too. Widened, "Talk to someone now", Leave, Lights
 * up and Sound stay on screen; narrowed, too narrow for those and the field above the keyboard, the usual screen comes
 * back as the keyboard goes down.
 */
function beside(widened) {
  return async (h) => {
    const p = PHONES['568x320'];
    const [from, to] = widened ? [p.width / 2, p.width] : [p.width, p.width / 2];
    const size = `568x320 ${widened ? 'widened from half' : 'narrowed to half'} beside another app`;
    const problems = [];
    const { ctx, page, errors, words } = await typeIn(h, { width: from, height: p.height }, 'landscape');
    for (const width of [from, (3 * p.width) / 4, to]) {
      await page.setViewportSize({ width, height: p.height - p.kb });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    await page.evaluate(() => document.activeElement?.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
    await settle(page);
    if (widened) for (const f of await up(page, words)) problems.push(`${size}, keyboard up: ${f}`);
    await page.setViewportSize({ width: to, height: p.height });
    for (const f of await down(page)) problems.push(`${size}, then down: ${f}`);
    if (errors.length) problems.push(`${size}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

/**
 * Pinching in to 200% while typing: the smaller phone held sideways with its keyboard over the page, as Safari has it,
 * and the bigger phone turned upright from sideways with a keyboard that resizes the page, where the usual screen fits
 * above the keyboard until the pinch. Pinched in with the keyboard up, "Talk to someone now", Leave, Lights up, Sound and
 * the field show whole in the part that shows and take their taps, with a line of words beside the field upright (held
 * sideways the keyboard leaves too little for one, as at 200% zoom); as the keyboard goes down, still pinched in, the
 * usual screen comes back, and stays as the pinch goes back out. Held sideways, `older`: on a phone that says how it's
 * held only as window.orientation, as Safari before 16.4 does; `strong`: with Talk stronger (see typeIn); `kb`: on the
 * bigger phone, with a keyboard that tall, so the bar leaves only just the field's height under it.
 */
function pinched(turnedFirst, { older = false, strong = false, kb = 0 } = {}) {
  return async (h) => {
    const [p, from] = turnedFirst ? [PHONES['390x844'], PHONES['844x390']] : kb ? [{ ...PHONES['844x390'], kb }, PHONES['844x390']] : [PHONES['568x320'], PHONES['568x320']];
    const tag = turnedFirst ? 'turned-pinched' : `pinched${older ? '-older' : ''}${strong ? '-strong' : ''}${kb ? `-${(p.height - kb) / 2}px` : ''}`;
    const size = turnedFirst
      ? '390x844 turned upright while typing, then pinched in to 200%'
      : `${p.width}x${p.height} pinched in to 200%${older ? ' on an older Safari' : ''}${strong ? ' with Talk stronger' : ''}${kb ? `, ${(p.height - kb) / 2} px above the keyboard` : ''}`;
    const problems = [];
    const { ctx, page, errors, words } = await typeIn(h, { width: from.width, height: from.height }, 'landscape', strong);
    const typing = () => page.evaluate(() => !!document.querySelector('.dq.is-typing'));
    if (older)
      await page.evaluate(() => {
        Object.defineProperty(screen, 'orientation', { configurable: true, get: () => undefined });
        Object.defineProperty(window, 'orientation', { configurable: true, get: () => 90 });
      });
    if (turnedFirst) {
      await page.setViewportSize({ width: from.width, height: from.height - from.kb });
      await settle(page);
      await page.evaluate(() => window.__held('portrait'));
      await page.setViewportSize({ width: p.width, height: p.height - p.kb });
    } else await page.evaluate((k) => window.__kb(k), { height: p.height - p.kb, top: Math.round(p.kb / 4) });
    await settle(page);
    await page.evaluate(() => window.__zoom(2));
    await page.evaluate(() => document.activeElement?.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
    await settle(page);
    if (!(await typing())) problems.push(`${size}, keyboard up: the typing layout isn't on`);
    for (const f of await up(page, words, { line: turnedFirst })) problems.push(`${size}, keyboard up: ${f}`);
    const clip = await page.evaluate(() => ({ x: visualViewport.offsetLeft, y: visualViewport.offsetTop, width: visualViewport.width, height: visualViewport.height }));
    await screenshot(page, { path: path.join(h.out, `safe-zone-typing-${tag}.png`), clip });
    if (turnedFirst) await page.setViewportSize({ width: p.width, height: p.height });
    else await page.evaluate(() => window.__kb(null));
    for (const f of await down(page)) problems.push(`${size}, then down: ${f}`);
    await page.evaluate(() => window.__zoom(1));
    await settle(page);
    if (await typing()) problems.push(`${size}, down and pinched back out: the typing layout came back`);
    if (errors.length) problems.push(`${size}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

/**
 * Typing in a window shorter than the screen, the Safe Zone put above another app after it opened, with a keyboard
 * that resizes the page: before typing, or while typing, the field keeping focus as the phone takes the page's focus,
 * and the keyboard with it, to put it there. The room is the window's, so as the keyboard goes down the usual screen
 * comes back.
 */
function split(midway) {
  return async (h) => {
    const p = PHONES['390x844'];
    const size = `390x844 put above another app ${midway ? 'while typing' : 'before typing'}, 340 px tall`;
    const problems = [];
    const { ctx, page, errors } = await typeIn(h, { width: p.width, height: p.height }, 'portrait');
    const field = page.locator('.dq-sz-body').getByLabel('Add one', { exact: true });
    if (midway) {
      await page.setViewportSize({ width: p.width, height: p.height - p.kb });
      await settle(page);
      await page.evaluate(() => window.__away(true));
    } else await field.blur();
    await page.setViewportSize({ width: p.width, height: 340 });
    await settle(page);
    if (midway) await page.evaluate(() => window.__away(false));
    else await field.focus();
    await page.setViewportSize({ width: p.width, height: 340 - 150 });
    await page.evaluate(() => document.activeElement?.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
    await settle(page);
    if (!(await page.evaluate(() => !!document.querySelector('.dq.is-typing')))) problems.push(`${size}, keyboard up: the typing layout isn't on`);
    await page.setViewportSize({ width: p.width, height: 340 });
    for (const f of await down(page)) problems.push(`${size}, then down: ${f}`);
    if (errors.length) problems.push(`${size}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

export const scenarios = Object.fromEntries([
  ...Object.keys(PHONES).flatMap((phone) => [
    [`safe-zone-typing-${phone}`, typing(phone)],
    [`safe-zone-typing-${phone}-text-200`, typing(phone, { font: true })],
    [`safe-zone-typing-${phone}-text-200-largest`, typing(phone, { font: true, largest: true })],
  ]),
  ...Object.keys(PHONES).map((phone) => [`safe-zone-typing-${phone}-200`, typing(phone, { zoom: 2 })]),
  ['safe-zone-typing-568x320-text-200-size-elsewhere', typing('568x320', { font: true, elsewhere: true })],
  ['safe-zone-typing-turned', turned('390x844')],
  ['safe-zone-typing-turned-200', turned('390x844', 2)],
  ['safe-zone-typing-turned-320x568', turned('320x568')],
  ['safe-zone-typing-widened', beside(true)],
  ['safe-zone-typing-narrowed', beside(false)],
  ['safe-zone-typing-pinched', pinched(false)],
  ['safe-zone-typing-pinched-older-safari', pinched(false, { older: true })],
  ['safe-zone-typing-pinched-strong', pinched(false, { strong: true })],
  ['safe-zone-typing-pinched-98px', pinched(false, { kb: 194 })],
  ['safe-zone-typing-turned-pinched', pinched(true)],
  ['safe-zone-typing-split', split(false)],
  ['safe-zone-typing-split-while-typing', split(true)],
]);
