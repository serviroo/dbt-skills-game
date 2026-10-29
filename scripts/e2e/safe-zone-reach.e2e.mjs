// Safe Zone reach: every control on every Safe Zone screen, in every state the player can put it in, can be reached
// and tapped. Each phone (390x844 and 320x568, upright and held sideways) is checked at normal text and at 200% zoom,
// which DESIGN.md asks the Safe Zone to fit on a 320 px phone (the page laid out at half the size, as browser zoom
// does). Each phone walks
// the Safe Zone twice, "Talk to someone now" under the frame and then, after "I might not be safe", above it, through
// Give me a moment, cool air counting down, every STOP line, each list with "Add one" and "Copy your lists" open, Talk
// for three countries (many lines, notes under the buttons, none), the empty lists, and the Sound panel opened from the
// top bar (there only its own controls, the button that closes it and where it sits are checked, since it covers part
// of the page while open). In each state:
//   audit       layout-fit's checks: nothing scrolls sideways or is cut off at the side, every button, link and field
//               is at least 44 px, none sits under a pinned bar when scrolled to from either end. How each screen
//               opens is layout-fit's own check; here a state is often reached by a tap that scrolls, and at 200% held
//               sideways the fold falls behind the pinned "Talk to someone now", so reach is checked by scrolling
//   reach       every control scrolled to shows whole, inside the screen and every box that clips it, and a tap on its
//               middle or near any corner lands on it, not on the top bar or the pinned foot
//   talk        "Talk to someone now" shows whole and takes a tap, with the page and the frame scrolled to either end
//   keyboard    while a list item or a person is typed, the on-screen keyboard takes the bottom of the screen (the page
//               gets the height above it, as a phone that resizes for the keyboard gives it): the field and its Save
//               show whole and take a tap, and the rest still passes reach. Held sideways at 200% the keyboard leaves
//               under 100 px, less than "Talk to someone now" and the field need together, so typing at 200% is
//               checked upright (a phone that keeps the page's full height under its keyboard is the check without it)
// And on every other screen with a top bar, at 200%, the Safe Zone button stays one tap away: it and the rest of the bar
// show whole and take their taps, and Give me a moment's Done shows whole once scrolled to.
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
 * view. `sound`: only the open Sound panel's own controls and the button that closes it. `controls`: only these.
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
    const scrollers = [...document.querySelectorAll('.dq, .dq-sz-body')];
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
      // at rest its title and first slider show whole; it sits under its button, clear of Leave and Lights up, wherever
      // the room there holds them, and moves up only where it doesn't
      const pop = document.querySelector('.dq-top .vol-pop');
      const sl = pop.querySelector('.vol-sl');
      sl.scrollTop = 0;
      await frame();
      const [p, s, r, b] = [pop, sl, sl.querySelector('.vol-row'), document.querySelector('.dq-top .vol-btn')].map((e) => e.getBoundingClientRect());
      const need = r.bottom - p.top + (p.bottom - s.bottom);
      if (r.bottom > s.bottom + 0.5) out.push(`the Sound panel's first slider doesn't show whole before scrolling (it ends at ${Math.round(r.bottom)}, the sliders at ${Math.round(s.bottom)})`);
      if (b.bottom + 8 + need <= innerHeight - 14 + 0.5) {
        if (p.top < b.bottom - 0.5) out.push(`the Sound panel moved up over its button (top at ${Math.round(p.top)}, the button ends at ${Math.round(b.bottom)}) though ${Math.round(need)} px fit under it`);
        for (const e of document.querySelectorAll('.dq-top :is(.dq-back, .ca-sz-light)')) if (taken(e)) out.push(`${name(e)} is under ${taken(e)} with the Sound panel open`);
      }
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

function walk(phone, zoom) {
  return async (h) => {
    const p = PHONES[phone];
    const viewport = { width: p.width / zoom, height: p.height / zoom };
    const size = `${phone}${zoom > 1 ? ` at ${zoom * 100}%` : ''}`;
    const problems = [];
    let shots = 0;
    const look = async (page, label, o = {}) => {
      await settle(page);
      for (const f of await audit(page, o.sound ? ['.dq-top .vol-pop'] : PAGE, SKIP)) if (!f.detail.endsWith('as the screen opens')) problems.push(`${size}, ${label}: ${f.kind} ${f.what} (${f.detail})`);
      for (const f of await unreachable(page, o)) problems.push(`${size}, ${label}: ${f}`);
      await h.shot(page, `safe-zone-reach-${phone}-${zoom * 100}-${String(++shots).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
    };
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
      if (zoom === 1 || p.width < p.height) await keyboard(page, `${label}, ${add} open`);
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
      const o = await boot(h, viewport, { edit });
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
      await page.locator('.vol.is-open').waitFor({ state: 'detached' });
      await tap(page, 'Give me a moment');
      await at(page, 'Give me a moment');
      await look(page, 'Give me a moment');
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

// every screen layout-fit checks, each route once
const ROUTES = [...new Map(Object.values(SCREENS).map(({ route }) => [JSON.stringify(route), route])).values()];
const BAR = '.dq-top :is(button, a[href]), .dq-mo-done';

/**
 * The Safe Zone stays one tap from every screen at 200%: on every screen with a top bar, the Safe Zone button and the
 * rest of the bar show whole inside the screen, at least 44 px each way, and take their own taps; on Give me a moment
 * its Done does too once scrolled to. The bar takes no more rows than its buttons need with the back control down to
 * its arrow (44 px) and Home's name down to its mark. With Sound open, wherever its panel opens below its button, the
 * Safe Zone button stays clear of it.
 */
function bars(phone) {
  return async (h) => {
    const p = PHONES[phone];
    const problems = [];
    const { ctx, page, errors } = await boot(h, { width: p.width / 2, height: p.height / 2 });
    for (const route of ROUTES) {
      await page.evaluate((r) => window.__daily.go(r), route);
      await page.waitForFunction((n) => window.__daily.route.name === n && !!document.querySelector('.dq-top .dq-safe'), route.name, { timeout: 10000 });
      await settle(page);
      const at = `${phone} at 200%, ${route.name}`;
      const small = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility({ checkVisibilityCSS: true })).map((e) => [(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 32), e.getBoundingClientRect()]).filter(([, r]) => r.width < 43.5 || r.height < 43.5).map(([n, r]) => `"${n}" ${Math.round(r.width)}x${Math.round(r.height)}`), BAR);
      for (const s of small) problems.push(`${at}: ${s}, under 44 px`);
      if (route.name === 'moment' && !(await page.locator('.dq-mo-done').isVisible())) problems.push(`${at}: Done doesn't show`);
      const bar = await page.evaluate(() => {
        const top = document.querySelector('.dq-top');
        const parts = [top.firstElementChild, ...top.querySelectorAll(':scope > .dq-top-end > *, :scope > .dq-safe')].filter((e) => e.checkVisibility());
        const cs = getComputedStyle(top);
        const room = top.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const narrow = (e) => (e.matches('.dq-back') ? 44 : e.matches('.dq-brand') ? parseFloat(getComputedStyle(e).paddingLeft) + e.querySelector('.dq-brand-mark').getBoundingClientRect().width : e.getBoundingClientRect().width);
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
      await h.shot(page, `safe-zone-button-${phone}-200-${route.name}`);
      await page.locator('.dq-top .vol-btn').click();
      await page.locator('.vol.is-open .vol-pop').waitFor();
      const rose = await page.evaluate(() => document.querySelector('.dq-top .vol-pop').getBoundingClientRect().top < document.querySelector('.dq-top .vol-btn').getBoundingClientRect().bottom);
      if (!rose) for (const f of await unreachable(page, { controls: '.dq-top .dq-safe' })) problems.push(`${at}, Sound open: ${f}`);
      await page.keyboard.press('Escape');
      // gone once its fade out ends, so it takes no taps meant for the next screen
      await page.locator('.dq-top .vol-pop').waitFor({ state: 'hidden' });
    }
    if (errors.length) problems.push(`${phone} at 200%: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

export const scenarios = {
  ...Object.fromEntries(Object.keys(PHONES).flatMap((phone) => [1, 2].map((zoom) => [`safe-zone-reach-${phone}${zoom > 1 ? '-200' : ''}`, walk(phone, zoom)]))),
  ...Object.fromEntries(Object.keys(PHONES).map((phone) => [`safe-zone-button-${phone}-200`, bars(phone)])),
};
