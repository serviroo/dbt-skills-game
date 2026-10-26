// Screen reader names (ME-164): every companion screen has a name for each thing a screen reader stops on. Each screen
// opens on a returning save with everything unlocked, at 390x844, and is checked for:
//   name     a button, link, field or ARIA control a screen reader can reach whose accessible name, as Chromium
//            computes it from aria-label, aria-labelledby, a label, its text or title, is empty
//   image    an img or svg a screen reader can reach that is neither hidden from it (aria-hidden, alt="", role none or
//            presentation) nor named
//   id       an id that more than one element on the page uses
//   ref      aria-labelledby or aria-describedby naming an id that no element has
//   hidden   a control a player can tab to that aria-hidden keeps from screen readers
// Controls and images count when they are rendered, even see-through, since a screen reader still reads them. The
// Safe Zone, the Save Crystal panel and the install hint are left out (layout-fit checks the Safe Zone too). Screens
// in ENFORCED fail the run; every other screen passes and lists its problems on stdout and under `result` in
// report.json, as the todo list.
import { PAGE, SCREENS, SKIP, WALK, boot, forward, settle } from './layout-fit.e2e.mjs';

const ENFORCED = ['home', 'skill', 'library', 'moment', 'diary', 'night-watch', 'wardrobe', 'art', 'draw', 'stories', 'write', 'read', 'settings', 'shadows'];

const SIZE = { width: 390, height: 844 };
const CONTROLS = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=switch], [role=radio], [role=checkbox], [role=tab], [role=slider]';

/** Every problem on the screen as it is now, inside `scope` and outside `skip`, with names from Chromium's own accessibility tree. */
async function audit(page, cdp, scope, skip) {
  const { found, items } = await page.evaluate(
    ({ scope, skip, CONTROLS }) => {
      const found = [];
      const roots = scope.flatMap((s) => [...document.querySelectorAll(s)]);
      const els = [...new Set(roots.flatMap((r) => [r, ...r.querySelectorAll('*')]))].filter((el) => !skip.some((s) => el.closest(s)));
      const name = (el) => {
        const cls = [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
        const type = el.matches('input') ? `[type=${el.type}]` : '';
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
        return `${el.tagName.toLowerCase()}${cls}${type}${text ? ` "${text}"` : ''}`;
      };
      const probe = els.filter((el) => el.checkVisibility({ checkVisibilityCSS: true }) && (el.matches(CONTROLS) || (el.matches('img, svg') && !el.parentElement.closest('svg'))));
      window.__a11yProbe = probe;
      const seen = new Set();
      for (const el of els.filter((e) => e.id)) {
        const n = document.querySelectorAll(`[id="${CSS.escape(el.id)}"]`).length;
        if (n > 1 && !seen.has(el.id)) found.push({ kind: 'id', what: `#${el.id}`, detail: `${n} elements` });
        seen.add(el.id);
      }
      for (const el of els) {
        for (const attr of ['aria-labelledby', 'aria-describedby']) {
          for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
            if (!document.getElementById(id)) found.push({ kind: 'ref', what: name(el), detail: `${attr} "${id}"` });
          }
        }
      }
      const tabbable = (el) => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]');
      return { found, items: probe.map((el) => ({ kind: el.matches(CONTROLS) ? 'name' : 'image', what: name(el), tabbable: el.matches(CONTROLS) && tabbable(el) })) };
    },
    { scope, skip, CONTROLS },
  );
  for (const [i, { kind, what, tabbable }] of items.entries()) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__a11yProbe[${i}]`, objectGroup: 'a11y' });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    const [node] = nodes;
    if (node.ignored && tabbable && node.ignoredReasons?.some((r) => r.name.startsWith('ariaHidden'))) found.push({ kind: 'hidden', what, detail: 'aria-hidden but reachable with Tab' });
    if (node.ignored || String(node.name?.value ?? '').trim()) continue;
    found.push({ kind, what, detail: `${node.role?.value ?? 'no role'} with no name` });
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'a11y' });
  await page.evaluate(() => delete window.__a11yProbe);
  return found;
}

async function open(h) {
  const { ctx, page, errors } = await boot(h, SIZE);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Accessibility.enable');
  return { ctx, page, errors, cdp };
}

function scenario(id, spec) {
  return async (h) => {
    const { ctx, page, errors, cdp } = await open(h);
    await page.evaluate((r) => window.__daily.go(r), spec.route);
    await page.waitForFunction((n) => window.__daily.route.name === n, spec.route.name, { timeout: 10000 });
    await settle(page);
    const scope = spec.scope ?? PAGE;
    const skip = [...SKIP, ...(spec.skip ?? [])];
    const views = [];
    if (spec.walk) {
      for (let step = 1; step <= 25 && (await page.evaluate((id) => window.__daily.route.name === 'skill' && window.__daily.route.id === id, spec.route.id)); step++) {
        views.push({ at: `step ${step}`, found: await audit(page, cdp, scope, skip) });
        const before = await page.evaluate(() => document.querySelector('.dq-step-body')?.innerHTML);
        if (!(await forward(page))) break;
        await settle(page);
        if ((await page.evaluate(() => document.querySelector('.dq-step-body')?.innerHTML)) === before) break;
      }
      const left = await page.evaluate((sid) => !(window.__daily.route.name === 'skill' && window.__daily.route.id === sid), spec.route.id);
      h.expect(left && views.length > 3, `${id}: the walk through ${WALK} stopped after ${views.length} steps without finishing it`);
    } else {
      h.expect(await page.evaluate((s) => s.some((x) => document.querySelector(x)), scope), `${id}: nothing on screen matches ${scope.join(', ')}`);
      views.push({ at: '', found: await audit(page, cdp, scope, skip) });
    }
    h.expect(!errors.length, `${id}: ${errors.join('\n')}`);
    await ctx.close();
    const problems = [];
    const seen = new Set();
    for (const { at, found } of views) {
      for (const f of found) {
        const key = `${f.kind} ${f.what} ${f.detail}`;
        if (seen.has(key)) continue;
        seen.add(key);
        problems.push({ ...f, ...(at && { at }) });
      }
    }
    const lines = problems.map((p) => `  ${p.kind.padEnd(6)} ${p.what} (${p.detail}${p.at ? `, ${p.at}` : ''})`);
    if (ENFORCED.includes(id)) h.expect(!problems.length, `${id} has things a screen reader can't name:\n${lines.join('\n')}`);
    else if (problems.length) console.log(`todo a11y-names ${id}: ${problems.length} problems\n${lines.join('\n')}`);
    return { enforced: ENFORCED.includes(id), problems };
  };
}

// one of each problem, marked a11y-plant, and look-alikes that are fine, marked a11y-decoy
const PLANTED = `
  <button class="a11y-plant"></button>
  <div class="a11y-plant" role="switch" tabindex="0"></div>
  <input class="a11y-plant" type="checkbox" style="opacity: 0">
  <svg class="a11y-plant" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>
  <img class="a11y-plant" width="20" height="20">
  <span id="a11y-twin"></span><span id="a11y-twin"></span>
  <p class="a11y-plant" aria-describedby="a11y-gone">Hint</p>
  <div aria-hidden="true"><button class="a11y-plant">Go</button></div>
  <div aria-hidden="true"><button class="a11y-decoy" tabindex="-1"></button><svg class="a11y-decoy" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg></div>
  <img class="a11y-decoy" alt="" width="20" height="20">
  <svg class="a11y-decoy" width="20" height="20"><title>Moon</title><circle cx="10" cy="10" r="8"/></svg>
  <button class="a11y-decoy" aria-label="Close"></button>
  <button class="a11y-decoy" title="Close"></button>
  <button class="a11y-decoy" aria-labelledby="a11y-here"></button><span id="a11y-here">Here</span>
  <label>Loud <input class="a11y-decoy" type="checkbox" style="opacity: 0"></label>`;

/** The check itself: on Home with PLANTED added, it reports every planted problem and none of the look-alikes. */
async function planted(h) {
  const { ctx, page, errors, cdp } = await open(h);
  await settle(page);
  await page.evaluate((html) => document.getElementById('dq-main').insertAdjacentHTML('beforeend', `<div>${html}</div>`), PLANTED);
  const found = (await audit(page, cdp, PAGE, SKIP)).map((f) => `${f.kind} ${f.what}`).filter((f) => /a11y-/.test(f)).sort();
  const want = ['hidden button.a11y-plant "Go"', 'id #a11y-twin', 'image img.a11y-plant', 'image svg.a11y-plant', 'name button.a11y-plant', 'name div.a11y-plant', 'name input.a11y-plant[type=checkbox]', 'ref p.a11y-plant "Hint"'];
  h.expect(!errors.length, errors.join('\n'));
  await ctx.close();
  h.expect(JSON.stringify(found) === JSON.stringify(want), `the check reported:\n  ${found.join('\n  ')}\ninstead of:\n  ${want.join('\n  ')}`);
  return { found };
}

export const scenarios = {
  ...Object.fromEntries(Object.entries(SCREENS).map(([id, spec]) => [`a11y-names-${id}`, scenario(id, spec)])),
  'a11y-names-planted': planted,
};
