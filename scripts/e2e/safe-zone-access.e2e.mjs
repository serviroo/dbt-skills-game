// The Safe Zone with keys only, with a screen reader and with bigger text, on a returning save with lists and people:
//   safe-zone-keys       every Safe Zone screen used with the keyboard alone, at 390x844, 320x568 and 844x390. On each
//                        screen Tab reaches every control once, in the order they read ("Talk to someone now" first),
//                        each one in view with its focus ring, then goes on out of the Safe Zone, so nothing holds
//                        focus. Enter and Space do what a tap does. Choosing Cool air starts its countdown with focus
//                        kept on that choice, the arrow keys move through countries without losing the picker, and
//                        nothing is credited
//   safe-zone-escape     Escape leaves the Safe Zone from every kind of screen exactly as Leave does, with nothing
//                        asked: a running countdown, a half-typed list item, the country picker, Give me a moment. An
//                        open sound panel closes first, and Escape elsewhere in the companion doesn't leave the screen
//   safe-zone-spoken     what a screen reader hears, politely and never assertively: each step, breathing and squeezing
//                        by their words but never the count, and the countdown once as it starts but not each second
//   timer-said-each-time a skill's countdown is said as it starts, each time it gets more time (the same words twice
//                        are heard twice) and as it ends
//   start-keeps-focus    a skill countdown's Start pressed by key hands focus to "+15 s", which takes its place, in
//                        view with its ring, so focus is never left on nothing
//   safe-zone-text-size  Text size in Settings: at Largest every word in the Safe Zone is at least 1.3 times its
//                        Regular size and the Story Room reads at the same size. Nothing scrolls sideways, is cut off,
//                        runs outside its button or box or sits out of reach at 320x568, 390x844, 844x390 and 568x320,
//                        nor at 200% browser zoom on 320x568 upright and sideways
//   safe-zone-zoom-keys  at Largest and 200% zoom on 320x568, upright and sideways, every Safe Zone screen used with
//                        the keyboard alone: each control, and each choice of a group (How long's "Until I'm ready"
//                        among them), shows whole and clear of the top bar and "Talk to someone now" as it gets focus
import { boot, settle } from './layout-fit.e2e.mjs';
import { fits } from './move-like-an-app.e2e.mjs';

const PHONE = { width: 390, height: 844 };
const AT = ['start', 'moment', 'breathe', 'squeeze', 'cold', 'check', 'stop', 'reasons', 'comfort', 'people', 'talk', 'close'];

const onScreen = (page, name) => page.waitForFunction((n) => document.querySelector('.dq')?.dataset.screen === n && !!document.querySelector('#dq-main > *'), name, { timeout: 10000 });
const heading = (page, text) => page.locator('.dq-sz-t', { hasText: text }).first().waitFor({ timeout: 10000 });
/**
 * Records what the live regions inside `scope` say: their words each time they are filled while on the page, so words
 * cleared and filled again count again (a region added already holding words says nothing, as with a screen reader).
 */
const listen = (page, scope) =>
  page.evaluate((scope) => {
    window.__said = [];
    const last = new Map();
    new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        const r = el?.closest('[aria-live], [role=status], [role=alert], [role=log], [role=timer]');
        if (!r?.closest(scope)) continue;
        const text = r.textContent.trim();
        if (last.get(r) === text) continue;
        last.set(r, text);
        if (text) window.__said.push({ text, how: r.getAttribute('aria-live') ?? r.getAttribute('role') });
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, scope);
const heard = (page) => page.evaluate(() => window.__said.splice(0));
const xp = (page) => page.evaluate(() => JSON.stringify(window.__daily.store.state.events.map((e) => [e.k, e.xp ?? 0])));
/** What a control is called: its aria-label, else its label's words, else its own. Runs in the page. */
const nameOf = (e) => (e?.getAttribute('aria-label') || (e?.labels?.length ? e.labels[0].textContent : e?.textContent) || '').replace(/\s+/g, ' ').trim();

/**
 * Whether `e` shows whole: each of its lines on the screen and, at its corners, its middle and between them, not under
 * anything, a pinned bar most of all. A choice inside its label shows as the label. One taller than half the screen is
 * centred as it gets focus, so it need only show its first line, 22px down, across its width. Runs in the page.
 */
const whole = (e) => {
  if (e.matches('input') && e.closest('label')) e = e.closest('label');
  const rs = [...e.getClientRects()].filter((r) => r.width && r.height);
  return (
    !!rs.length &&
    rs.every((r) => {
      const tall = r.height > innerHeight / 2;
      const bottom = tall ? r.top + Math.min(r.height / 2, 22) : r.bottom;
      if (r.top < -0.5 || bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5) return false;
      const i = Math.min(2, r.width / 4, (bottom - r.top) / 4);
      const xs = [r.left + i, (r.left + r.right) / 2, r.right - i];
      const ys = tall ? [bottom] : [r.top + i, (r.top + bottom) / 2, bottom - i];
      return xs.every((x) => ys.every((y) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === e || e.contains(hit));
      }));
    })
  );
};

/** What has focus: its name, whether it is in the Safe Zone, and whether it shows its ring (a field its border and glow), whole and clear of the bars. */
const focusNow = (page) =>
  page.evaluate(`(() => {
    const nameOf = ${nameOf};
    const whole = ${whole};
    const a = document.activeElement;
    if (!a || a === document.body) return { k: null, name: 'nothing', inside: false };
    const cs = getComputedStyle(a);
    return {
      k: a.dataset.k ?? null,
      name: nameOf(a).slice(0, 40),
      inside: !!a.closest('.dq-safezone'),
      ring: (a.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (a.matches('.dq-input:focus') && cs.boxShadow !== 'none'),
      inView: whole(a),
    };
  })()`);

/**
 * Words out of place: a line of words that runs outside a box it sits in (each box around it, up to the page), a word
 * broken across two lines in a button, a choice or a note, and a breathing ring's word that reaches past the ring
 * instead of sitting inside it or just under it.
 */
const spills = (page) =>
  page.evaluate(() => {
    const out = new Set();
    const tag = (e) => `${e.tagName.toLowerCase()}.${(e.getAttribute('class') ?? '').trim().split(/\s+/).join('.')}`;
    for (const e of document.querySelectorAll('.dq-top *, .dq-safezone *')) {
      if (!e.checkVisibility({ visibilityProperty: true }) || e.closest('.dq-sr')) continue;
      const label = e.closest('.dq-btn, .dq-opt, .dq-mo-len-o, .dq-sz-talk, .dq-res-note, .dq-ring-word');
      for (const n of e.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const words = document.createRange();
        words.selectNodeContents(n);
        for (const line of words.getClientRects())
          for (let box = e; box && !box.matches('.dq'); box = box.parentElement) {
            if (/^(contents|inline)$/.test(getComputedStyle(box).display)) continue;
            const b = box.getBoundingClientRect();
            if (line.left < b.left - 1 || line.right > b.right + 1) {
              out.add(`"${n.textContent.trim().slice(0, 30)}" runs outside ${tag(box)}`);
              break;
            }
          }
        // a label or a note is sized so each word fits whole; it may still break after a hyphen
        if (label)
          for (const m of n.textContent.matchAll(/[^\s-]+-?/g)) {
            const word = document.createRange();
            word.setStart(n, m.index);
            word.setEnd(n, m.index + m[0].length);
            if (new Set([...word.getClientRects()].filter((r) => r.width).map((r) => Math.round(r.top))).size > 1) out.add(`"${m[0]}" breaks inside the word in ${tag(label)}`);
          }
      }
    }
    for (const w of document.querySelectorAll('.dq-safezone .dq-ring-word')) {
      const ring = w.closest('.dq-ring-stage')?.querySelector('svg')?.getBoundingClientRect();
      if (!ring || !w.textContent.trim()) continue;
      const [x, y, r] = [ring.left + ring.width / 2, ring.top + ring.height / 2, ring.width / 2 + 1];
      const words = document.createRange();
      words.selectNodeContents(w);
      for (const q of words.getClientRects()) {
        const inside = [[q.left, q.top], [q.right, q.top], [q.left, q.bottom], [q.right, q.bottom]].every(([a, b]) => Math.hypot(a - x, b - y) <= r);
        if (!inside && q.top < ring.bottom - 1) out.add(`the ring's "${w.textContent.trim()}" reaches past the ring, neither inside it nor under it`);
      }
    }
    return [...out];
  });

/**
 * Opens the companion on a returning save at `w` by `ht`, at 200% zoom when `zoom` is 2 (half the CSS pixels, each
 * drawn four times as on a 2x phone), with the Safe Zone's text at Largest.
 */
async function largest(h, w, ht, zoom) {
  const view = { width: w / zoom, height: ht / zoom };
  const opened = await boot(h, view, { edit: (s) => (s.profile.region = 'us') });
  if (zoom > 1) await (await opened.ctx.newCDPSession(opened.page)).send('Emulation.setDeviceMetricsOverride', { ...view, deviceScaleFactor: 4, mobile: false });
  await opened.page.evaluate((key) => localStorage.setItem(`${key}.read-size`, 'largest'), h.SAVE);
  return opened;
}

/**
 * Tabs through the screen from its top. Problems: two controls with the same name, a control skipped, reached twice or
 * out of reading order, one that shows no ring or isn't in view as it gets focus, and focus that never leaves the Safe
 * Zone.
 */
async function tabWalk(page, tag) {
  const want = await page.evaluate(`(() => {
    const nameOf = ${nameOf};
    // a group of radio buttons is one stop: the one picked, or the first when none is
    const stop = (e) => e.type !== 'radio' || e.checked || (![...document.getElementsByName(e.name)].some((r) => r.checked) && document.getElementsByName(e.name)[0] === e);
    const els = [...document.querySelectorAll('.dq-safezone :is(button, a[href], input:not([type=hidden]), select, textarea, [tabindex])')].filter(
      (e) => e.tabIndex >= 0 && !e.disabled && !e.closest('[inert]') && e.checkVisibility({ visibilityProperty: true }) && stop(e),
    );
    return els.map((e, i) => {
      e.dataset.k = String(i);
      const r = e.getBoundingClientRect();
      return { k: String(i), name: nameOf(e).slice(0, 40), col: e.closest('.dq-sz-lead') ? 'lead' : e.closest('.dq-sz-main') ? 'main' : 'foot', top: r.top, left: r.left, h: r.height };
    });
  })()`);
  const out = [];
  if (!want.length) out.push(`${tag}: no controls to reach`);
  const names = want.map((w) => w.name);
  for (const n of new Set(names.filter((n, i) => names.indexOf(n) !== i))) out.push(`${tag}: two controls are both called "${n}"`);
  // reading order: the pinned link, the words' half, then the choices' half, each from the top down and left to right
  const cols = want.map((w) => w.col);
  const firstMain = cols.indexOf('main');
  if (cols.slice(1).includes('foot') || (firstMain >= 0 && cols.slice(firstMain).includes('lead'))) out.push(`${tag}: Tab order jumps between parts: ${cols.join(' ')}`);
  for (let i = 1; i < want.length; i++) {
    const [a, b] = [want[i - 1], want[i]];
    const row = Math.abs(b.top - a.top) < Math.min(a.h, b.h) / 2;
    if (a.col === b.col && (row ? b.left < a.left : b.top < a.top)) out.push(`${tag}: "${b.name}" comes after "${a.name}" but sits before it`);
  }
  await page.evaluate(() => document.querySelector('.dq-safezone h1').focus());
  const got = [];
  let left = null;
  for (let i = 0; i <= want.length + 2; i++) {
    await page.keyboard.press('Tab');
    const f = await focusNow(page);
    if (!f.inside) {
      left = f;
      break;
    }
    got.push(f);
    if (!f.ring) out.push(`${tag}: "${f.name}" shows no focus ring`);
    if (!f.inView) out.push(`${tag}: "${f.name}" is not in view, or sits under something, as it gets focus`);
  }
  const order = (l) => l.map((x) => x.k).join(',');
  if (order(got) !== order(want)) out.push(`${tag}: Tab went ${JSON.stringify(got.map((g) => g.name))}, not ${JSON.stringify(want.map((w) => w.name))}`);
  if (!left) out.push(`${tag}: focus never left the Safe Zone`);
  return out;
}

/** Tabs on, from wherever focus is, to the control called `name` (or matching it), wrapping through the top bar, and presses `key`. */
async function press(page, name, key = 'Enter') {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const now = (await focusNow(page)).name;
    if (name instanceof RegExp ? name.test(now) : now === name) return page.keyboard.press(key);
  }
  throw new Error(`Tab never reached "${name}"`);
}

export const scenarios = {
  async 'safe-zone-keys'(h) {
    const problems = [];
    for (const viewport of [PHONE, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      const size = `${viewport.width}x${viewport.height}`;
      const { ctx, page, errors } = await boot(h, viewport, { edit: (s) => (s.profile.region = 'us') });
      const dialogs = [];
      page.on('dialog', (d) => (dialogs.push(d.message()), void d.dismiss().catch(() => {})));
      const before = await xp(page);
      const walk = async (at) => {
        await settle(page);
        problems.push(...(await tabWalk(page, `${size} ${at}`)));
      };
      await press(page, 'Safe Zone, help right now');
      await onScreen(page, 'safe');
      await walk('start');
      await press(page, 'Give me a moment');
      await heading(page, 'Give me a moment');
      await walk('moment');
      await press(page, 'Done');
      await heading(page, /You.re here/);
      await press(page, 'Calm my body first');
      await heading(page, 'Breathe with the light');
      await walk('breathe');
      await press(page, 'Next');
      await heading(page, 'Squeeze and release');
      await walk('squeeze');
      await press(page, 'Next');
      await heading(page, 'Cool air or cold water');
      await walk('cold');
      await press(page, 'Cool air');
      await settle(page);
      const started = await focusNow(page);
      if (started.name !== 'Cool air' || !started.ring || !started.inView) problems.push(`${size} cold: after Cool air focus went to ${started.name} (${JSON.stringify(started)})`);
      if (!(await page.evaluate(() => document.querySelector('.dq-cool .dq-btn[aria-pressed=true]')?.textContent.trim()))) problems.push(`${size} cold: Cool air by key did not start the countdown`);
      await press(page, 'Next');
      await heading(page, 'Is it even a little lower?');
      await walk('check');
      await press(page, 'About the same', ' ');
      await heading(page, 'Stop. Step back.');
      await walk('stop');
      await press(page, 'Next line');
      while ((await focusNow(page)).name === 'Next line') await page.keyboard.press('Enter');
      if ((await focusNow(page)).name !== 'Next') problems.push(`${size} stop: after the last line focus was on ${(await focusNow(page)).name}`);
      await page.keyboard.press('Enter');
      await heading(page, 'Things that are yours');
      await walk('reasons');
      await press(page, 'Add one');
      await page.keyboard.type('Rain on the window');
      await press(page, 'Save');
      await page.locator('.dq-sz-list li', { hasText: 'Rain on the window' }).waitFor({ timeout: 5000 });
      await press(page, 'Copy your lists');
      await page.locator('.dq-lists-copy pre').waitFor();
      await settle(page);
      // opening brings the preview into view, which can take the button off screen: focus shows where it went
      const opened = await focusNow(page);
      if (!opened.inside || !opened.ring || !opened.inView) problems.push(`${size} reasons: after opening the preview focus is on ${opened.name} (${JSON.stringify(opened)})`);
      await walk('reasons, lists open');
      await press(page, 'Close');
      if ((await focusNow(page)).name !== 'Copy your lists') problems.push(`${size} reasons: Close left focus on ${(await focusNow(page)).name}`);
      await press(page, 'Next');
      await heading(page, 'Your comfort kit');
      await walk('comfort');
      await press(page, 'Next');
      await heading(page, 'Your people');
      await walk('people');
      await press(page, 'Add a person');
      await page.keyboard.type('Robin');
      await page.keyboard.press('Tab');
      await page.keyboard.type('+1 202 555 0100');
      await press(page, 'Save');
      await page.getByRole('link', { name: 'Call Robin', exact: true }).waitFor({ timeout: 5000 });
      await press(page, 'Next');
      await heading(page, 'Talk to someone now');
      await walk('talk');
      // the arrow keys move through countries with the picker kept, and the lines follow each one
      const picker = page.locator('.dq-region select');
      await press(page, /^Lines for/, 'ArrowDown');
      await page.keyboard.press('ArrowDown');
      const moved = await page.evaluate(() => ({ focus: document.activeElement === document.querySelector('.dq-region select'), region: document.querySelector('.dq-region select').value, stored: window.__daily.store.state.settings.region }));
      const want = await picker.evaluate((s) => s.options[[...s.options].findIndex((o) => o.value === 'us') + 2].value);
      if (!moved.focus || moved.region !== want || moved.stored !== want) problems.push(`${size} talk: two arrow presses on the picker gave ${JSON.stringify(moved)}, not ${want} with focus kept`);
      await walk('talk, another country');
      await press(page, 'Next');
      await heading(page, 'This is here any time');
      await walk('close');
      await press(page, 'Back to the Lantern');
      await onScreen(page, 'hub');
      if ((await xp(page)) !== before) problems.push(`${size}: the Safe Zone credited something`);
      problems.push(...dialogs.map((d) => `${size}: a dialog asked "${d}"`), ...errors.map((e) => `${size}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'safe-zone-escape'(h) {
    const problems = [];
    const { ctx, page, errors } = await boot(h, PHONE, { edit: (s) => (s.profile.region = 'us') });
    const dialogs = [];
    page.on('dialog', (d) => (dialogs.push(d.message()), void d.dismiss().catch(() => {})));
    const before = await xp(page);
    const enter = async (at) => {
      await page.locator('.dq-top .dq-safe').click();
      await onScreen(page, 'safe');
      if (at) await page.evaluate((r) => window.__daily.go(r, { replace: true }), { name: 'safe', at });
      await settle(page);
    };
    const landed = () => page.evaluate(() => ({ screen: document.querySelector('.dq').dataset.screen, i: history.state?.i, focus: !!document.activeElement?.closest('[data-focus], h1') && !document.activeElement.closest('.dq-safezone') }));
    await enter();
    await page.locator('.dq-top .dq-back').click();
    await onScreen(page, 'hub');
    await settle(page);
    const leave = await landed();
    const cases = {
      'the first screen': async () => {},
      'a running countdown': async () => {
        await page.getByRole('button', { name: 'Cool air' }).click();
      },
      'a half-typed list item': async () => {
        await page.getByRole('button', { name: 'Add one' }).click();
        await page.keyboard.type('half typed');
      },
      'the country picker': async () => page.locator('.dq-region select').focus(),
      'Give me a moment': async () => {},
    };
    const where = { 'the first screen': null, 'a running countdown': 'cold', 'a half-typed list item': 'reasons', 'the country picker': 'talk', 'Give me a moment': 'moment' };
    for (const [tag, set] of Object.entries(cases)) {
      await enter(where[tag]);
      await set();
      await page.keyboard.press('Escape');
      await onScreen(page, 'hub').catch(() => {});
      await settle(page);
      const now = await landed();
      if (JSON.stringify(now) === JSON.stringify(leave)) continue;
      problems.push(`Escape from ${tag} gave ${JSON.stringify(now)}, Leave gives ${JSON.stringify(leave)}`);
      if (now.screen === 'safe') await page.locator('.dq-top .dq-back').click();
    }
    // an open sound panel is on top: Escape closes it and stays, the next one leaves
    await enter('breathe');
    await page.locator('.dq-top .vol-btn').click();
    await page.locator('.vol-pop').waitFor();
    await page.keyboard.press('Escape');
    const kept = await page.evaluate(() => ({ screen: document.querySelector('.dq').dataset.screen, open: document.querySelector('.vol-btn')?.getAttribute('aria-expanded') }));
    if (kept.screen !== 'safe' || kept.open !== 'false') problems.push(`Escape with the sound panel open gave ${JSON.stringify(kept)}`);
    await page.keyboard.press('Escape');
    await onScreen(page, 'hub').catch(() => {});
    if ((await landed()).screen !== 'hub') {
      problems.push('a second Escape after closing the sound panel did not leave');
      await page.locator('.dq-top .dq-back').click();
    }
    // elsewhere Escape still only closes what is open on top
    await page.locator('.dq-tile').filter({ hasText: 'Settings' }).click();
    await onScreen(page, 'settings');
    await page.keyboard.press('Escape');
    await settle(page);
    if ((await landed()).screen !== 'settings') problems.push('Escape on Settings left the screen');
    if ((await xp(page)) !== before) problems.push('the Safe Zone credited something');
    h.expect(!problems.length && !dialogs.length && !errors.length, [...problems, ...dialogs, ...errors].join('\n'));
    await ctx.close();
  },

  async 'safe-zone-spoken'(h) {
    const problems = [];
    const t = Date.now() - 86400e3;
    const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: JSON.stringify({ v: 1, created: t, events: [] }) };
    const { ctx, page, errors } = await h.open(seed, '?mute', PHONE, (c) => c.clock.install());
    await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
    await listen(page, '.dq-safezone');
    const said = () => heard(page);
    const run = (ms) => page.clock.runFor(ms);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
    await page.locator('.dq-top .dq-safe').click();
    await run(300);
    if (!(await page.evaluate(() => window.__daily.route.name === 'safe'))) problems.push('the Safe Zone did not open');
    await page.getByRole('button', { name: 'Calm my body first' }).click();
    await run(300);
    await said();
    await run(30000);
    const breathe = await said();
    const words = breathe.map((s) => s.text);
    if (words.length < 4 || words.length > 8 || words.some((w) => !/^Breathe (in|out)$/.test(w))) problems.push(`breathing for 30 s said ${JSON.stringify(words)}`);
    await page.locator('.dq-sz-main').getByRole('button', { name: 'Next', exact: true }).click();
    await run(300);
    const toSqueeze = await said();
    if (!toSqueeze.some((s) => s.text === 'Squeeze and release')) problems.push(`the squeeze step was not said: ${JSON.stringify(toSqueeze)}`);
    await run(30000);
    const squeeze = (await said()).map((s) => s.text);
    if (squeeze.length < 3 || squeeze.some((w) => !/^(Tighten|Let it drop|Let it all drop)$/.test(w))) problems.push(`squeezing for 30 s said ${JSON.stringify(squeeze)}`);
    await page.locator('.dq-sz-main').getByRole('button', { name: 'Next', exact: true }).last().click();
    await run(300);
    await said();
    await page.getByRole('button', { name: 'Cool air' }).click();
    await run(500);
    const start = (await said()).map((s) => s.text);
    if (start.length !== 1 || !/30 seconds/.test(start[0])) problems.push(`starting the countdown said ${JSON.stringify(start)}`);
    await run(28000);
    const ticking = (await said()).map((s) => s.text);
    if (ticking.length) problems.push(`the running countdown said ${JSON.stringify(ticking)}`);
    await run(3000);
    const end = (await said()).map((s) => s.text);
    if (!end.includes('Is it even a little lower?')) problems.push(`the countdown's end and the next step said ${JSON.stringify(end)}`);
    const loud = await page.evaluate(() => [...document.querySelectorAll('.dq-safezone :is([aria-live=assertive], [role=alert])')].map((e) => e.className));
    if (loud.length) problems.push(`assertive regions in the Safe Zone: ${loud.join(', ')}`);
    h.expect(!problems.length && !errors.length, [...problems, ...errors].join('\n'));
    await ctx.close();
  },

  async 'timer-said-each-time'(h) {
    const problems = [];
    const t = Date.now() - 86400e3;
    const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: JSON.stringify({ v: 1, created: t, events: [] }) };
    const { ctx, page, errors } = await h.open(seed, '?mute', PHONE, (c) => c.clock.install());
    await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
    await listen(page, '#dq-main');
    // Wise Mind's 20 second stone timer starts by itself after the breathing step
    await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'wise-mind' }));
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.clock.runFor(1000);
    const timerSaid = async () => (await heard(page)).filter((s) => /second|minute|^Done/.test(s.text)).map((s) => `${s.text} (${s.how})`);
    const start = await timerSaid();
    if (JSON.stringify(start) !== JSON.stringify(['20 seconds, starting now. (polite)'])) problems.push(`as it started the timer said ${JSON.stringify(start)}`);
    for (let i = 1; i <= 2; i++) {
      await page.getByRole('button', { name: '+15 s' }).click();
      await page.clock.runFor(500);
      const more = await timerSaid();
      if (JSON.stringify(more) !== JSON.stringify(['15 seconds more. (polite)'])) problems.push(`more time, press ${i}, said ${JSON.stringify(more)}`);
    }
    // 20 s and twice 15 more: it ends 50 s after it started
    await page.clock.runFor(50000);
    const end = await timerSaid();
    if (JSON.stringify(end) !== JSON.stringify(['Done. (polite)'])) problems.push(`running to its end the timer said ${JSON.stringify(end)}`);
    h.expect(!problems.length && !errors.length, [...problems, ...errors].join('\n'));
    await ctx.close();
  },

  async 'start-keeps-focus'(h) {
    const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, [h.SAVE]: JSON.stringify({ v: 1, created: Date.now() - 86400e3, events: [] }) };
    const { ctx, page, errors } = await h.open(seed, '?mute', PHONE);
    await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
    // Kind Light's wish for yourself waits for its Start button
    await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'loving-kindness' }));
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.locator('.dq-opt').first().click();
    await page.getByRole('button', { name: 'Me', exact: true }).click();
    await page.getByRole('button', { name: 'Start 20 s' }).waitFor();
    await press(page, 'Start 20 s');
    await settle(page);
    const f = await focusNow(page);
    h.expect(f.name === '+15 s' && f.ring && f.inView && !errors.length, [`after Start by key focus was on ${f.name} (${JSON.stringify(f)})`, ...errors].join('\n'));
    await ctx.close();
  },

  async 'safe-zone-text-size'(h) {
    const problems = [];
    /** The font size of every bit of words on each Safe Zone screen, in page order. */
    const sizes = async (page) => {
      const out = {};
      for (const at of AT) {
        await page.evaluate((r) => window.__daily.go(r, { replace: true }), { name: 'safe', at });
        await page.locator('.dq-sz-t').first().waitFor();
        out[at] = await page.evaluate(() =>
          [...document.querySelectorAll('.dq-safezone *')]
            .filter((e) => !e.closest('.dq-sr') && e.checkVisibility() && ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || e.matches('input:not([type=radio], [type=checkbox]), select, textarea')))
            .map((e) => ({ what: `${e.tagName.toLowerCase()}.${e.className} "${(e.textContent || e.value || '').trim().slice(0, 24)}"`, px: parseFloat(getComputedStyle(e).fontSize) })),
        );
      }
      return out;
    };
    {
      const { ctx, page, errors } = await boot(h, { width: 320, height: 568 }, { edit: (s) => (s.profile.region = 'us') });
      const regular = await sizes(page);
      await page.locator('.dq-top .dq-back').click();
      await onScreen(page, 'hub');
      await page.locator('.dq-tile').filter({ hasText: 'Settings' }).click();
      await onScreen(page, 'settings');
      const choice = page.getByRole('radio', { name: 'Text size: Largest' });
      await choice.scrollIntoViewIfNeeded();
      await choice.click();
      const largest = await sizes(page);
      for (const at of AT) {
        if (regular[at].length !== largest[at].length) problems.push(`${at}: ${regular[at].length} bits of words at Regular, ${largest[at].length} at Largest`);
        for (const [i, r] of regular[at].entries()) {
          const l = largest[at][i];
          if (l && l.px < r.px * 1.29) problems.push(`${at}: ${r.what} is ${l.px}px at Largest, ${r.px}px at Regular`);
        }
      }
      await h.shot(page, 'text-size-largest-320-close');
      // the Story Room reads at the size chosen in Settings, and the choice outlasts a reload
      await page.evaluate(() => window.__daily.go({ name: 'read', id: 'tale-1' }));
      await onScreen(page, 'read');
      const story = await page.evaluate(() => ({ size: document.querySelector('.st-read')?.dataset.size, pressed: document.querySelector('.st-size-b--largest')?.getAttribute('aria-pressed') }));
      if (story.size !== 'largest' || story.pressed !== 'true') problems.push(`the Story Room reads at ${JSON.stringify(story)} after Largest in Settings`);
      await page.reload();
      await page.waitForFunction(() => !!window.__daily);
      await page.evaluate(() => window.__daily.go({ name: 'settings' }));
      await onScreen(page, 'settings');
      if ((await page.getByRole('radio', { name: 'Text size: Largest' }).getAttribute('aria-checked')) !== 'true') problems.push('Text size forgot Largest after a reload');
      problems.push(...errors);
      await ctx.close();
    }
    // everything fits at Largest, a phone either way up and at 200% browser zoom
    for (const [w, ht, zoom] of [[320, 568, 1], [390, 844, 1], [844, 390, 1], [568, 320, 1], [320, 568, 2], [568, 320, 2]]) {
      const tag = `${w}x${ht}${zoom > 1 ? ' at 200%' : ''}`;
      const { ctx, page, errors } = await largest(h, w, ht, zoom);
      for (const at of AT) {
        await page.evaluate((r) => window.__daily.go(r, { replace: true }), { name: 'safe', at });
        await page.locator('.dq-sz-t').first().waitFor();
        await settle(page);
        if (!(await page.evaluate(() => document.querySelector('.dq-safezone')?.dataset.size === 'largest'))) problems.push(`${tag} ${at}: the Safe Zone is not at Largest`);
        for (const p of [...(await spills(page)), ...(await fits(page, at))]) problems.push(`${tag} ${at}: ${p}`);
        if (['start', 'breathe', 'talk'].includes(at) || (w === 320 && zoom > 1)) await h.shot(page, `text-size-largest-${w}x${ht}${zoom > 1 ? '-200' : ''}-${at}`);
      }
      problems.push(...errors.map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'safe-zone-zoom-keys'(h) {
    const problems = [];
    for (const [w, ht] of [[320, 568], [568, 320]]) {
      const tag = `${w}x${ht} at 200%`;
      const { ctx, page, errors } = await largest(h, w, ht, 2);
      for (const at of AT) {
        await page.evaluate((r) => window.__daily.go(r, { replace: true }), { name: 'safe', at });
        await page.locator('.dq-sz-t').first().waitFor();
        await settle(page);
        problems.push(...(await tabWalk(page, `${tag} ${at}`)));
        // Tab stops once in a group of choices and the arrow keys move through it: each choice shows whole with focus
        const hidden = await page.evaluate(`(async () => {
          const nameOf = ${nameOf};
          const whole = ${whole};
          const out = [];
          for (const r of document.querySelectorAll('.dq-safezone input[type=radio]')) {
            r.focus();
            await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
            if (!whole(r)) out.push(nameOf(r));
          }
          return out;
        })()`);
        for (const n of hidden) problems.push(`${tag} ${at}: "${n}" is not whole, or sits under something, as it gets focus`);
        if (['moment', 'breathe', 'check', 'people', 'talk', 'close'].includes(at)) await h.shot(page, `zoom-keys-${w}x${ht}-${at}`);
      }
      problems.push(...errors.map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
