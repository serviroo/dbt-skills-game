// Safe Zone reach: every control on every Safe Zone screen, in every state the player can put it in, can be reached
// and tapped. Each phone (390x844 and 320x568, upright and held sideways) is checked at normal text, at 200% zoom,
// which DESIGN.md asks the Safe Zone to fit on a 320 px phone (the page laid out at half the size, as browser zoom
// does), and with the phone's own text at 200% (each word twice its size in a page as wide as before, see scaleText).
// Each phone walks the Safe Zone twice, "Talk to someone now" under the frame and then, after "I might not be
// safe", above it, through Give me a moment (its ring whole too), cool air counting down, every STOP line, each list with
// "Add one" and "Copy your lists" open, Talk for three countries (many lines, notes under the buttons, none), the empty
// lists, and the Sound panel opened from the top bar (there only its own controls, the bar's buttons and where it sits
// are checked, since it covers part of the page while open). In each state:
//   audit       layout-fit's checks: nothing scrolls sideways or is cut off at the side, every button, link and field
//               is at least 44 px, none sits under a pinned bar when scrolled to from either end. How each screen
//               opens is layout-fit's own check; here a state is often reached by a tap that scrolls, and at 200% held
//               sideways the fold falls behind the pinned "Talk to someone now", so reach is checked by scrolling
//   reach       every control scrolled to shows whole, inside the screen and every box that clips it, and a tap on its
//               middle or near any corner lands on it, not on the top bar or the pinned foot; so does every ring
//               (breathing, a countdown, Give me a moment's)
//   talk        "Talk to someone now" shows whole and takes a tap, with the page and the frame scrolled to either end
//   under Talk  where the Safe Zone is one screen tall (normal text and the phone's own text at 200%, the keyboard
//               down), none of the frame's words or controls show under "Talk to someone now", as the screen opens or
//               scrolled to either end. At 200% zoom or with the keyboard up the page scrolls under it, and reach and
//               audit check that each control still scrolls clear of it
//   keyboard    while a list item or a person is typed, the on-screen keyboard takes the bottom of the screen (the page
//               gets the height above it, as a phone that resizes for the keyboard gives it): the field and its Save
//               show whole and take a tap, and the rest still passes reach. Held sideways at 200% zoom the keyboard
//               leaves under 100 px, less than "Talk to someone now" and the field need together, so typing is checked
//               upright there (a phone that keeps the page's full height under its keyboard is the check without it;
//               safe-zone-typing checks both kinds of keyboard, held either way, where Talk pins at the top)
// And on every other screen with a top bar, at 200%, the Safe Zone button stays one tap away: it and the rest of the bar
// show whole and take their taps, with the Sound panel open too, and Give me a moment's Done shows whole once scrolled
// to; Home and Settings also fit whole, with no text on top of other text.
import { gone } from './harness.mjs';
import { audit, boot, PAGE, SCREENS, settle, SKIP } from './layout-fit.e2e.mjs';
import { listed } from './me-92-safe-zone-clean.e2e.mjs';

// a phone and about how tall its keyboard is with the suggestion bar, held each way
const PHONES = {
  '390x844': { width: 390, height: 844, kb: 336 },
  '320x568': { width: 320, height: 568, kb: 253 },
  '844x390': { width: 844, height: 390, kb: 200 },
  '568x320': { width: 568, height: 320, kb: 194 },
};

/**
 * Whatever on the Safe Zone and its top bar can't be scrolled to whole and tapped, as the screen stands now. `typing`:
 * also the field that has focus and its Save, each scrolled to the least it takes, as a phone brings the field into
 * view. `sound`: only the open Sound panel's own controls and the button that closes it, and the bar it opens below.
 * `controls`: only these.
 */
const unreachable = (page, { typing = false, sound = false, controls = null } = {}) =>
  page.evaluate(async ({ typing, sound, controls: only }) => {
    const out = [];
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const name = (e) => `"${(e.getAttribute('aria-label') || e.textContent || e.value || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 32)}"`;
    const box = (r) => `${[r.left, r.top, r.right, r.bottom].map(Math.round).join(', ')} in ${innerWidth}x${innerHeight}`;
    // the part that shows: inside the window and inside every box around it that clips
    const whole = (e) => {
      const r = e.getBoundingClientRect();
      let [l, t, rt, b] = [Math.max(r.left, 0), Math.max(r.top, 0), Math.min(r.right, innerWidth), Math.min(r.bottom, innerHeight)];
      for (let p = e.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const q = p.getBoundingClientRect();
        const [x, y] = [q.left + p.clientLeft, q.top + p.clientTop];
        [l, t, rt, b] = [Math.max(l, x), Math.max(t, y), Math.min(rt, x + p.clientWidth), Math.min(b, y + p.clientHeight)];
      }
      return rt - l >= r.width - 1 && b - t >= r.height - 1;
    };
    // what a tap on the middle, or in from a corner far enough to be inside its rounding, lands on when it isn't the
    // control or one of its labels
    const taken = (e) => {
      const r = e.getBoundingClientRect();
      const d = Math.max(4, 0.3 * Math.min(parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0, r.width / 2, r.height / 2) + 1);
      const at = [[r.left + d, r.top + d], [r.right - d, r.top + d], [r.left + d, r.bottom - d], [r.right - d, r.bottom - d], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
      const mine = (x) => !!x && (e.contains(x) || [...(e.labels ?? [])].some((l) => l.contains(x)));
      const hit = at.map(([x, y]) => document.elementFromPoint(x, y)).find((x) => !mine(x));
      return hit === undefined ? null : hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing';
    };
    const scrollers = [...document.querySelectorAll('.dq, .dq-sz-body, .dq-sz-lead, .dq-sz-main')];
    const was = scrollers.map((s) => s.scrollTop);
    const talk = document.querySelector('.dq-sz-talk');
    const controls = [...document.querySelectorAll(only ?? (sound ? '.dq-top :is(.vol-btn, .vol-pop button, .vol-pop input)' : '.dq-top :is(button, a[href]), .dq-safezone :is(button, a[href], input, select, textarea)'))].filter((e) => e !== talk && e.checkVisibility({ checkVisibilityCSS: true }) && !e.closest('.dq-sr'));
    // scrolled to the way the player can: the page never scrolls sideways, though a script can still move it there
    const to = (e, block) => {
      e.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' });
      for (const s of [document.scrollingElement, document.querySelector('.dq')]) s.scrollLeft = 0;
    };
    for (const e of controls) {
      to(e, 'center');
      await frame();
      if (!whole(e)) out.push(`${name(e)} doesn't show whole when scrolled to (${box(e.getBoundingClientRect())})`);
      else if (taken(e)) out.push(`${name(e)} is under ${taken(e)} when scrolled to (${box(e.getBoundingClientRect())})`);
    }
    if (sound) {
      // it opens below everything in the top bar, so each of the bar's buttons, the Safe Zone's above all, still takes
      // its own tap
      const pop = document.querySelector('.dq-top .vol-pop');
      const bar = [...document.querySelectorAll('.dq-top :is(button, a[href], .dq-brand)')].filter((e) => !pop.contains(e) && e.checkVisibility());
      const under = Math.max(...bar.map((e) => e.getBoundingClientRect().bottom));
      const top = pop.getBoundingClientRect().top;
      if (top < under - 0.5) out.push(`the Sound panel reaches up into the top bar (its top at ${Math.round(top)}, the bar's buttons end at ${Math.round(under)})`);
      for (const e of bar) if (!e.matches('.dq-brand') && taken(e)) out.push(`${name(e)} is under ${taken(e)} with the Sound panel open`);
    }
    if (!sound && talk?.checkVisibility()) {
      for (const end of ['top', 'end']) {
        for (const s of scrollers) s.scrollTop = end === 'top' ? 0 : s.scrollHeight;
        await frame();
        if (!whole(talk) || taken(talk)) out.push(`"Talk to someone now" isn't whole and tappable with the page scrolled to the ${end} (${box(talk.getBoundingClientRect())}${taken(talk) ? `, under ${taken(talk)}` : ''})`);
      }
    }
    scrollers.forEach((s, i) => (s.scrollTop = was[i]));
    if (typing) {
      const field = document.activeElement;
      if (!field?.matches('.dq-safezone input')) return [...out, `focus is on ${field?.tagName.toLowerCase()}, not the field being typed in`];
      const save = [...field.closest('.dq-addrow, .dq-person-add').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save');
      for (const e of [field, save]) {
        to(e, 'nearest');
        await frame();
        if (!whole(e) || taken(e)) out.push(`${e === save ? 'Save' : 'the field'} doesn't show whole and clear above the keyboard (${box(e.getBoundingClientRect())}${taken(e) ? `, under ${taken(e)}` : ''})`);
      }
      field.focus({ preventScroll: true });
    }
    return out;
  }, { typing, sound, controls });

/**
 * What of the Safe Zone's frame, a run of its words or one of its controls, shows under "Talk to someone now": as much of
 * each as shows inside the boxes that clip or scroll it, as the screen stands and with it scrolled to either end.
 */
const underTalk = (page) =>
  page.evaluate(async () => {
    const talk = document.querySelector('.dq-sz-talk');
    if (!talk?.checkVisibility()) return [];
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const scrollers = [...document.querySelectorAll('.dq, .dq-sz-body, .dq-sz-lead, .dq-sz-main')];
    const was = scrollers.map((s) => s.scrollTop);
    const out = new Set();
    const shown = (e, r) => {
      let [l, t, rt, b] = [Math.max(r.left, 0), Math.max(r.top, 0), Math.min(r.right, innerWidth), Math.min(r.bottom, innerHeight)];
      for (let p = e; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const q = p.getBoundingClientRect();
        const [x, y] = [q.left + p.clientLeft, q.top + p.clientTop];
        [l, t, rt, b] = [Math.max(l, x), Math.max(t, y), Math.min(rt, x + p.clientWidth), Math.min(b, y + p.clientHeight)];
      }
      return [l, t, rt, b];
    };
    const look = (when) => {
      const k = talk.getBoundingClientRect();
      const parts = [];
      const texts = document.createTreeWalker(document.querySelector('.dq-sz'), NodeFilter.SHOW_TEXT);
      for (let n = texts.nextNode(); n; n = texts.nextNode()) {
        if (!n.data.trim() || n.parentElement.closest('.dq-sr') || !n.parentElement.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) parts.push([n.data.trim(), n.parentElement, r]);
      }
      for (const e of document.querySelectorAll('.dq-sz :is(button, a[href], input, select, textarea)')) if (e.checkVisibility({ checkVisibilityCSS: true })) parts.push([e.getAttribute('aria-label') || e.textContent.trim() || e.tagName, e, e.getBoundingClientRect()]);
      for (const [what, e, r] of parts) {
        const [l, t, rt, b] = shown(e, r);
        if (Math.min(rt, k.right) - Math.max(l, k.left) > 1 && Math.min(b, k.bottom) - Math.max(t, k.top) > 1) out.add(`"${what.replace(/\s+/g, ' ').slice(0, 32)}" shows under "Talk to someone now" ${when}`);
      }
    };
    look('as the screen opens');
    for (const end of ['top', 'end']) {
      for (const s of scrollers) s.scrollTop = end === 'top' ? 0 : s.scrollHeight;
      await frame();
      look(`with it scrolled to the ${end}`);
    }
    scrollers.forEach((s, i) => (s.scrollTop = was[i]));
    return [...out];
  });

function walk(phone, zoom, { font = false } = {}) {
  return async (h) => {
    const p = PHONES[phone];
    const viewport = { width: p.width / zoom, height: p.height / zoom };
    const size = font ? `${phone} with its text at 200%` : `${phone}${zoom > 1 ? ` at ${zoom * 100}%` : ''}`;
    const problems = [];
    let shots = 0;
    const look = async (page, label, o = {}) => {
      await settle(page);
      if (zoom === 1 && !o.typing) for (const f of await underTalk(page)) problems.push(`${size}, ${label}: ${f}`);
      for (const f of await audit(page, o.sound ? ['.dq-top .vol-pop'] : PAGE, SKIP)) if (!f.detail.endsWith('as the screen opens')) problems.push(`${size}, ${label}: ${f.kind} ${f.what} (${f.detail})`);
      for (const f of await unreachable(page, o)) problems.push(`${size}, ${label}: ${f}`);
      // a ring (breathing, a countdown, Give me a moment's) too shows whole and clear of the pinned bars once scrolled to
      if (!o.sound) for (const f of await unreachable(page, { controls: '.dq-sz :is(.dq-ring-stage, .dq-timer-stage, .dq-mo-stage)' })) problems.push(`${size}, ${label}, its ring: ${f}`);
      await h.shot(page, `safe-zone-reach-${phone}-${font ? 'text-200' : zoom * 100}-${String(++shots).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
    };
    // where the room above the keyboard holds "Talk to someone now" and the field (see the top)
    const typing = font || zoom === 1 || p.width < p.height;
    const keyboard = async (page, label) => {
      await page.setViewportSize({ width: viewport.width, height: Math.round((p.height - p.kb) / zoom) });
      await look(page, `${label} with the keyboard up`, { typing: true });
      await page.setViewportSize(viewport);
    };
    const tap = (page, name) => page.locator('.dq-sz-body').getByRole('button', { name, exact: true }).last().evaluate((b) => b.click());
    const at = (page, title) => page.locator('.dq-sz-t', { hasText: title }).first().waitFor({ timeout: 10000 });
    const lists = async (page, title, add, label) => {
      await at(page, title);
      await look(page, label);
      await tap(page, add);
      await look(page, `${label}, ${add} open`);
      if (typing) await keyboard(page, `${label}, ${add} open`);
      await tap(page, 'Copy your lists');
      await page.locator('.dq-lists-copy:not(.is-hidden)').waitFor();
      await look(page, `${label}, ${add} and Copy your lists open`);
    };
    // from breathing to the last screen, the way the player goes
    const onward = async (page, top) => {
      const t = top ? ', Talk above' : '';
      await at(page, 'Breathe with the light');
      await look(page, `breathe${t}`);
      await tap(page, 'Next');
      await at(page, 'Squeeze and release');
      await look(page, `squeeze${t}`);
      await tap(page, 'Next');
      await at(page, 'Cool air');
      await look(page, `cold${t}`);
      await tap(page, 'Cool air');
      await look(page, `cold, cool air counting down${t}`);
      await tap(page, 'Next');
      await at(page, 'Is it even a little lower?');
      await look(page, `check${t}`);
      await tap(page, 'About the same');
      await at(page, 'Stop. Step back.');
      while (await page.locator('.dq-sz-body').getByRole('button', { name: 'Next line', exact: true }).count()) await tap(page, 'Next line');
      await look(page, `stop, every line${t}`);
      await tap(page, 'Next');
      await lists(page, 'Things that are yours', 'Add one', `reasons${t}`);
      await tap(page, 'Next');
      await lists(page, 'Your comfort kit', 'Add one', `comfort${t}`);
      await tap(page, 'Next');
      await lists(page, 'Your people', 'Add a person', `people${t}`);
      await tap(page, 'Next');
      await at(page, 'Talk to someone now');
      for (const [region, label] of [['us', 'many lines'], ['sg', 'notes under the buttons'], ['elsewhere', 'no lines']]) {
        await page.locator('.dq-sz-body select').selectOption(region);
        await page.waitForFunction((r) => document.querySelector('.dq-sz-body select')?.value === r, region);
        await look(page, `talk, ${label}${t}`);
      }
      await page.locator('.dq-sz-body select').selectOption('us');
      await tap(page, 'Next');
      await look(page, `close${t}`);
    };

    const now = Date.now();
    const filled = (save) => {
      save.lists = { ...save.lists, reasons: listed(3, 'reason'), comfort: listed(3, 'comfort'), people: [{ id: 'reach-p1', name: 'Sam', phone: '+1 555 0100', at: now }, { id: 'reach-p2', name: 'Robin', phone: '', at: now }] };
      save.settings = { ...save.settings, region: 'us' };
    };
    const open = async (edit) => {
      const o = await boot(h, viewport, font ? { edit, device: { isMobile: true, hasTouch: true } } : { edit });
      if (font) await scaleText(o.page);
      await o.page.locator('header .dq-safe').click();
      await o.page.locator('.dq-sz-t').first().waitFor({ timeout: 10000 });
      return o;
    };
    {
      const { ctx, page, errors } = await open(filled);
      await look(page, 'start');
      await page.locator('.dq-top .vol-btn').click();
      await page.locator('.vol.is-open .vol-pop').waitFor();
      await look(page, 'start, Sound open', { sound: true });
      await page.keyboard.press('Escape');
      await gone(page.locator('.vol.is-open'), 10000);
      await tap(page, 'Give me a moment');
      await at(page, 'Give me a moment');
      await look(page, 'Give me a moment');
      // its heading comes first, above its ring, as it is read
      if (await page.evaluate(() => document.querySelector('.dq-sz .dq-mo-stage').getBoundingClientRect().top < document.querySelector('.dq-sz-body .dq-sz-t').getBoundingClientRect().bottom - 1)) problems.push(`${size}, Give me a moment: its ring sits above its heading`);
      await page.locator('.dq-sz-body .dq-mo-done').evaluate((b) => b.click());
      await at(page, 'here.');
      await tap(page, 'Calm my body first');
      await onward(page, false);
      if (errors.length) problems.push(`${size}: ${errors.join(' | ')}`);
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open(filled);
      await tap(page, 'I might not be safe');
      await at(page, 'Talk to someone now');
      await look(page, 'talk after "I might not be safe"');
      await tap(page, 'Back to breathing');
      await onward(page, true);
      if (errors.length) problems.push(`${size}, Talk above: ${errors.join(' | ')}`);
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open((save) => (save.lists = { comfort: [], activities: [], reasons: [], people: [] }));
      for (const [route, title, add] of [['reasons', 'Things that are yours', 'Add one'], ['comfort', 'Your comfort kit', 'Add one'], ['people', 'Your people', 'Add a person']]) {
        await page.evaluate((at) => window.__daily.go({ name: 'safe', at }), route);
        await lists(page, title, add, `${route}, empty`);
      }
      if (errors.length) problems.push(`${size}, empty lists: ${errors.join(' | ')}`);
      await ctx.close();
    }
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

/**
 * Runs of text that sit on top of other text, anywhere on the page: each pair once. A flip card shows one side at a time,
 * and lines whose letter boxes only touch aren't on top of each other.
 */
const crowded = (page) =>
  page.evaluate(() => {
    const runs = [];
    const walk = document.createTreeWalker(document.querySelector('#dq-main'), NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const el = t.parentElement;
      if (!t.data.trim() || el.closest('.dq-sr, .dq-card:not(.is-open) .dq-cardface--front, .dq-card.is-open .dq-cardface--back') || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      // only the part that shows inside every box around it that cuts it off (an ellipsis, a hidden overflow), wherever the
      // page is scrolled to: a box that scrolls cuts nothing off
      const cuts = (v) => v === 'hidden' || v === 'clip';
      for (const r of range.getClientRects()) {
        let [left, top, right, bottom] = [r.left, r.top, r.right, r.bottom];
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          const q = p.getBoundingClientRect();
          if (cuts(cs.overflowX)) [left, right] = [Math.max(left, q.left), Math.min(right, q.right)];
          if (cuts(cs.overflowY)) [top, bottom] = [Math.max(top, q.top), Math.min(bottom, q.bottom)];
        }
        if (right - left > 1 && bottom - top > 1) runs.push([t, { left, top, right, bottom, height: r.height }]);
      }
    }
    const out = new Set();
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) {
        const [[ta, a], [tb, b]] = [runs[i], runs[j]];
        if (ta !== tb && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.4 * Math.min(a.height, b.height)) out.add(`"${ta.data.trim().slice(0, 24)}" and "${tb.data.trim().slice(0, 24)}"`);
      }
    return [...out];
  });

/** The top bar's mark and icons that a box around them cuts into. */
const cutMarks = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.dq-top :is(.dq-brand-mark, svg)')].flatMap((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || !e.checkVisibility({ checkVisibilityCSS: true })) return [];
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (!/hidden|clip/.test(`${cs.overflowX} ${cs.overflowY}`)) continue;
        const q = p.getBoundingClientRect();
        if (r.left < q.left - 0.5 || r.right > q.right + 0.5 || r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5)
          return [`${e.matches('svg') ? 'an icon' : "Home's mark"} is cut by its box (${[r.left, r.right, r.top, r.bottom].map(Math.round).join(', ')} in ${[q.left, q.right, q.top, q.bottom].map(Math.round).join(', ')})`];
      }
      return [];
    }),
  );

/**
 * Words a box cuts short (an ellipsis, or a hidden overflow at the side) among the elements `scope` names, and with
 * `breaks`, words that run onto the next line anywhere but just after a hyphen (their own, or a soft one, which shows
 * as one there), leaving out names kept only for a screen reader (clipped to nothing, as .dq-sr is).
 */
export const cutShort = (page, { scope = '.dq-top *, #dq-main *', breaks = true } = {}) =>
  page.evaluate(
    async ({ scope, breaks }) => {
      const out = [];
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const at = (t, i) => {
        const r = document.createRange();
        r.setStart(t, i);
        r.setEnd(t, i + 1);
        return r.getClientRects()[0];
      };
      const els = [...document.querySelectorAll(scope)].filter((e) => !e.closest('.dq-sr') && getComputedStyle(e).clipPath !== 'inset(50%)' && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
      const near = [];
      for (const e of els) {
        const texts = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
        const cs = getComputedStyle(e);
        if (texts.length && (/hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1) out.push(`"${e.textContent.trim().slice(0, 32)}" is cut short (${e.clientWidth} of ${e.scrollWidth} px)`);
        // a letter that starts lower than the one before it in its word: the word may go on to a new line there
        for (const t of breaks ? texts : []) {
          let top = null;
          for (let i = 0; i < t.length; i++) {
            if (/\s/.test(t.data[i])) top = null;
            const q = /[\s\u00AD]/.test(t.data[i]) ? null : at(t, i);
            if (!q?.height) continue;
            if (top !== null && q.top > top + q.height / 2) near.push([e, t, i]);
            top = q.top;
          }
        }
      }
      // where the line really starts, as a tap there finds it (the letters by a soft hyphen can report the wrong line):
      // after a space it's no break, after a hyphen or a soft one a clean one, after a letter a bare one
      const scrollers = [document.scrollingElement, document.querySelector('.dq')];
      const was = scrollers.map((s) => s?.scrollTop);
      for (const [e, t, i] of near) {
        e.scrollIntoView({ block: 'center', behavior: 'instant' });
        await frame();
        const q = at(t, i);
        const whole = document.createRange();
        whole.selectNodeContents(t);
        const line = [...whole.getClientRects()].find((f) => f.width && Math.abs(f.top - q.top) < q.height / 2);
        const hit = line && document.caretRangeFromPoint(line.left + 1, line.top + line.height / 2);
        const k = hit?.startContainer === t ? hit.startOffset : i;
        if (k > 0 && !/[\s\u00AD-]/.test(t.data[k - 1])) {
          const [from, to] = [t.data.slice(0, k).search(/\S*$/), k + t.data.slice(k).search(/\s|$/)];
          out.push(`"${t.data.slice(from, k)}|${t.data.slice(k, to)}" breaks with no hyphen`.replace(/\u00AD/g, ''));
        }
      }
      scrollers.forEach((s, j) => s && (s.scrollTop = was[j]));
      return [...new Set(out)];
    },
    { scope, breaks },
  );

// every screen layout-fit checks, each route once
const ROUTES = [...new Map(Object.values(SCREENS).map(({ route }) => [JSON.stringify(route), route])).values()];
const BAR = '.dq-top :is(button, a[href]), .dq-mo-done';
// the screens laid out by their own words: Home, Settings and the Story Room
const WRAPS = new Set(['hub', 'settings', 'stories', 'write']);

/**
 * The Safe Zone stays one tap from every screen at 200%, browser zoom or the phone's own text: on every screen with a top
 * bar, the Safe Zone button and the rest of the bar show whole inside the screen, at least 44 px each way, and take their
 * own taps, its mark and icons whole; on Give me a moment its Done does too once scrolled to. The bar takes no more rows
 * than its buttons need with the back control down to its arrow (44 px) and Home's name down to its mark. With Sound open,
 * the panel sits below the whole bar and each of the bar's buttons still takes its own tap. No screen cuts its words
 * short, and on Home, Settings and the Story Room no word breaks onto the next line without a hyphen. Home, with its
 * stats open, and Settings have nothing cut off or scrolling sideways, too small to tap or under a pinned bar, and no two
 * runs of text on top of each other.
 */
function bars(phone, { font = false } = {}) {
  return async (h) => {
    const p = PHONES[phone];
    const problems = [];
    const size = font ? `${phone} with its text at 200%` : `${phone} at 200%`;
    const { ctx, page, errors } = font ? await boot(h, { width: p.width, height: p.height }, { device: { isMobile: true, hasTouch: true } }) : await boot(h, { width: p.width / 2, height: p.height / 2 });
    if (font) await scaleText(page);
    for (const route of ROUTES) {
      await page.evaluate((r) => window.__daily.go(r), route);
      await page.waitForFunction((n) => window.__daily.route.name === n && !!document.querySelector('.dq-top .dq-safe'), route.name, { timeout: 10000 });
      await settle(page);
      const at = `${size}, ${route.name}`;
      const small = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility({ checkVisibilityCSS: true })).map((e) => [(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 32), e.getBoundingClientRect()]).filter(([, r]) => r.width < 43.5 || r.height < 43.5).map(([n, r]) => `"${n}" ${Math.round(r.width)}x${Math.round(r.height)}`), BAR);
      for (const s of small) problems.push(`${at}: ${s}, under 44 px`);
      if (route.name === 'moment' && !(await page.locator('.dq-mo-done').isVisible())) problems.push(`${at}: Done doesn't show`);
      const bar = await page.evaluate(() => {
        const top = document.querySelector('.dq-top');
        const parts = [top.firstElementChild, ...top.querySelectorAll(':scope > .dq-top-end > *, :scope > .dq-safe')].filter((e) => e.checkVisibility());
        const cs = getComputedStyle(top);
        const room = top.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const narrow = (e) => (e.matches('.dq-back') ? 44 : e.matches('.dq-brand') ? parseFloat(getComputedStyle(e).paddingLeft) + e.querySelector('.dq-brand-mark').offsetWidth + parseFloat(getComputedStyle(e).paddingRight) : e.getBoundingClientRect().width);
        const gap = parseFloat(cs.columnGap);
        // as many rows as wrapping them in order takes, each part at its narrowest
        let need = 1;
        let line = 0;
        for (const w of parts.map(narrow)) {
          if (line && line + gap + w > room + 0.5) {
            need++;
            line = w;
          } else line = line ? line + gap + w : w;
        }
        const tops = parts.map((e) => e.getBoundingClientRect().top).sort((x, y) => x - y);
        return { rows: 1 + tops.filter((t, i) => i && t - tops[i - 1] > 20).length, need, room: Math.round(room) };
      });
      if (bar.rows > bar.need) problems.push(`${at}: the top bar takes ${bar.rows} rows where its buttons need ${bar.need} in ${bar.room} px with the back control down to its arrow and Home's name to its mark`);
      for (const f of await unreachable(page, { controls: BAR })) problems.push(`${at}: ${f}`);
      for (const f of await cutMarks(page)) problems.push(`${at}: ${f}`);
      if (route.name === 'hub' || route.name === 'settings') {
        // Home's stats, folded away on a phone, open
        const fold = page.locator('.dq-status:not(.is-open) .dq-stats-toggle');
        if (await fold.isVisible()) {
          await fold.click();
          await settle(page);
        }
        for (const f of await audit(page, PAGE, SKIP)) if (!f.detail.endsWith('as the screen opens')) problems.push(`${at}: ${f.kind} ${f.what} (${f.detail})`);
        for (const pair of await crowded(page)) problems.push(`${at}: ${pair} sit on top of each other`);
      }
      for (const words of await cutShort(page, { breaks: WRAPS.has(route.name) })) problems.push(`${at}: ${words}`);
      await h.shot(page, `safe-zone-button-${phone}-${font ? 'text-' : ''}200-${route.name}`);
      await page.locator('.dq-top .vol-btn').click();
      await page.locator('.vol.is-open .vol-pop').waitFor();
      for (const f of await unreachable(page, { sound: true })) problems.push(`${at}, Sound open: ${f}`);
      await page.keyboard.press('Escape');
      // gone once its fade out ends, so it takes no taps meant for the next screen
      await gone(page.locator('.dq-top .vol-pop'), 10000, { state: 'hidden' });
    }
    if (errors.length) problems.push(`${size}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

/**
 * The phone's own text size at 200%, as Android's text zoom applies it (an in-app browser's WebView): every word drawn at
 * twice its size in a page as wide as before, where browser zoom would narrow the page instead. Chrome's text autosizer,
 * which that text zoom drives, takes it as text-size-adjust on a phone's page.
 */
export const scaleText = (page) => page.addStyleTag({ content: 'html { -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }' });

/**
 * On a phone at 200%, where the Sound panel's sliders scroll inside it: a finger that swipes up across a slider's track,
 * away from its thumb, scrolls the panel and leaves that level as it was, kept or not; a tap on the track still jumps
 * the level there, and a sideways drag from the track still takes the level along with it.
 */
function swipe(phone) {
  return async (h) => {
    const { width, height } = PHONES[phone];
    const { ctx, page, errors } = await boot(h, { width: width / 2, height: height / 2 }, { device: { hasTouch: true, isMobile: true } });
    const problems = [];
    try {
      await page.locator('.dq-top .vol-btn').tap();
      await page.locator('.vol.is-open .vol-pop').waitFor();
      await settle(page);
      // the first slider, scrolled just into view, a quarter of its track from the end farther from its thumb
      const at = await page.evaluate(() => {
        const body = document.querySelector('.dq-top .vol-body');
        const input = body.querySelector('.vol-range');
        body.scrollTop = 0;
        input.scrollIntoView({ block: 'nearest' });
        const r = input.getBoundingClientRect();
        const v = Number(input.value);
        return { id: input.id, v, x: Math.round(v >= 50 ? r.left + r.width / 4 : r.right - r.width / 4), y: Math.round(r.top + r.height / 2), room: body.scrollHeight - body.clientHeight - body.scrollTop, top: body.scrollTop };
      });
      if (at.room < 30) problems.push(`${phone} at 200%: the Sound panel has only ${at.room} px left to scroll, too little to swipe`);
      const stored = () => page.evaluate(() => localStorage.getItem('dbt.audio.v1'));
      const level = () => page.evaluate((id) => Number(document.getElementById(id).value), at.id);
      const kept = await stored();
      const cdp = await ctx.newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      // straight up, a frame at a time
      const up = Math.min(60, at.y - 4);
      await touch('touchStart', at.x, at.y);
      for (let i = 1; i <= 10; i++) {
        await touch('touchMove', at.x, Math.round(at.y - (up * i) / 10));
        await h.sleep(16);
      }
      await touch('touchEnd');
      await h.sleep(400);
      const swiped = { level: await level(), stored: await stored(), top: await page.evaluate(() => document.querySelector('.dq-top .vol-body').scrollTop) };
      if (swiped.top <= at.top) problems.push(`${phone} at 200%: the swipe across the slider didn't scroll the Sound panel (${at.top} to ${swiped.top})`);
      if (swiped.level !== at.v || swiped.stored !== kept) problems.push(`${phone} at 200%: a swipe up across the ${at.id} slider moved its level from ${at.v} to ${swiped.level}${swiped.stored !== kept ? ' and kept it' : ''}`);
      // then a screen reader sets it, with no press: the value, then input and change
      const read = await page.evaluate((id) => {
        const input = document.getElementById(id);
        input.value = '40';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { level: Number(input.value), stored: JSON.parse(localStorage.getItem('dbt.audio.v1') ?? '{}')[id.split('-')[1]] };
      }, at.id);
      if (read.level !== 40 || read.stored !== 0.4) problems.push(`${phone} at 200%: after the swipe, a screen reader setting ${at.id} to 40 left it at ${read.level}, kept as ${read.stored}`);
      // a tap on the track, then a drag along it from there
      const track = await page.evaluate((id) => {
        const input = document.getElementById(id);
        input.scrollIntoView({ block: 'nearest' });
        const r = input.getBoundingClientRect();
        return { left: r.left + 7, width: r.width - 14, y: Math.round(r.top + r.height / 2) };
      }, at.id);
      const want = (x) => Math.round(Math.max(0, Math.min(1, (x - track.left) / track.width)) * 100);
      // on the side of the track away from the thumb where it is now
      const now = await level();
      const tapX = Math.round(now >= 50 ? track.left + track.width / 4 : track.left + (track.width * 3) / 4);
      await page.touchscreen.tap(tapX, track.y);
      await h.sleep(100);
      const tapped = await level();
      if (Math.abs(tapped - want(tapX)) > 1) problems.push(`${phone} at 200%: a tap on the ${at.id} track at ${want(tapX)} left the level at ${tapped}`);
      // from a sixth of the track away from the thumb, a quarter of the track farther the same way
      const dir = now >= 50 ? 1 : -1;
      const fromX = tapX + (dir * track.width) / 6;
      const toX = fromX + (dir * track.width) / 4;
      await touch('touchStart', Math.round(fromX), track.y);
      for (let i = 1; i <= 6; i++) await touch('touchMove', Math.round(fromX + ((toX - fromX) * i) / 6), track.y);
      await touch('touchEnd');
      await h.sleep(400);
      const dragged = await level();
      if (Math.abs(dragged - want(Math.round(toX))) > 1) problems.push(`${phone} at 200%: a drag along the ${at.id} track to ${want(Math.round(toX))} left the level at ${dragged}`);
      if (!(await stored())?.includes(String(dragged / 100))) problems.push(`${phone} at 200%: the dragged ${at.id} level ${dragged} wasn't kept (${await stored()})`);
      if (errors.length) problems.push(`${phone} at 200%: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  };
}

export const scenarios = {
  ...Object.fromEntries(Object.keys(PHONES).flatMap((phone) => [1, 2].map((zoom) => [`safe-zone-reach-${phone}${zoom > 1 ? '-200' : ''}`, walk(phone, zoom)]))),
  ...Object.fromEntries(Object.keys(PHONES).map((phone) => [`safe-zone-reach-${phone}-text-200`, walk(phone, 1, { font: true })])),
  ...Object.fromEntries(['568x320', '320x568'].map((phone) => [`sound-panel-swipe-${phone}-200`, swipe(phone)])),
  ...Object.fromEntries(Object.keys(PHONES).map((phone) => [`safe-zone-button-${phone}-200`, bars(phone)])),
  ...Object.fromEntries(Object.keys(PHONES).map((phone) => [`safe-zone-button-${phone}-text-200`, bars(phone, { font: true })])),
};
