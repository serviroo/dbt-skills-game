import { boot, SAFE_AT, settle } from './layout-fit.e2e.mjs';
import { capture, contrast, FIELDS, NO_TEXT, px, ratio } from './home-sky.e2e.mjs';

const SWITCH = 'Higher contrast';
const TEXT_MIN = 7;
const EDGE_MIN = 3;
const DPR = 2;
const FIRST_SAVE = 'e2e-first-save';

const SCREENS = [
  ['home', { name: 'hub' }],
  ['settings', { name: 'settings' }],
  ['skill', { name: 'skill', id: 'check-facts' }],
  ['library', { name: 'library' }],
  ['moment', { name: 'moment' }],
  ['ease', { name: 'ease' }],
  ['rest', { name: 'rest' }],
  ['diary', { name: 'diary' }],
  ['days', { name: 'days' }],
  ['print', { name: 'print' }],
  ['comfort', { name: 'comfort' }],
  ['lines', { name: 'lines' }],
  ['night-watch', { name: 'shadows' }],
  ['art', { name: 'art' }],
  ['draw', { name: 'draw', kind: 'today' }],
  ['piece', { name: 'piece', id: 'draw-today' }],
  ['stories', { name: 'stories' }],
  ['write', { name: 'write', id: 'tale-1' }],
  ['read', { name: 'read', id: 'tale-1' }],
  ...SAFE_AT.map((at) => [`safe-${at}`, { name: 'safe', at }]),
  ['safe-lit-start', { name: 'safe', at: 'start' }, true],
  ['safe-lit-check', { name: 'safe', at: 'check' }, true],
  ['safe-lit-talk', { name: 'safe', at: 'talk' }, true],
];
const ZOOMED = ['home', 'settings', 'night-watch', 'safe-start', 'safe-talk', 'safe-lit-start'];
const THEMED = ['home', 'settings', 'skill', 'safe-check', 'safe-lit-start', 'safe-lit-check', 'safe-lit-talk'];
const LOOKS = [
  [{ width: 390, height: 844 }, null, { theme: 'classic', accent: 'blue' }],
  [{ width: 195, height: 422 }, ZOOMED, { theme: 'mint', accent: 'green' }],
];
const THEMES = [
  [{ width: 390, height: 844 }, THEMED, { theme: 'night', accent: 'violet' }],
  [{ width: 390, height: 844 }, THEMED, { theme: 'gold', accent: 'honey' }],
];

const shown = (page) => page.evaluate(() => document.documentElement.dataset.dqContrast ?? null);
const toggleIn = (page) => page.getByRole('switch', { name: SWITCH });

async function openSettings(page) {
  await page.evaluate(() => window.__daily.go({ name: 'settings' }));
  await toggleIn(page).waitFor({ timeout: 10000 });
}

async function go(page, route) {
  await page.evaluate((r) => window.__daily.go(r), route);
  const there = (r) => Object.entries(r).every(([k, v]) => window.__daily.route[k] === v);
  await page.waitForFunction(there, route, { timeout: 10000 });
  await settle(page);
}

const CONTROLS = `button, a.dq-btn, ${FIELDS}, .dq-switch-ui, .dq-seg, .dq-panel`;

const edges = (page) =>
  page.evaluate((sel) => {
    const top = document.querySelector('.dq-top')?.getBoundingClientRect().bottom ?? 0;
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('[aria-hidden="true"]:not(.dq-switch-ui), :disabled, [aria-disabled="true"]')) continue;
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      if (r.height < 8 || r.width < 16 || y < (el.closest('.dq-top') ? 0 : top + 12) || y > innerHeight - 2) continue;
      const where = [el.tagName.toLowerCase(), ...el.classList].slice(0, 2).join('.');
      for (const [side, x, inward] of [['left', r.left, 1], ['right', r.right, -1]]) {
        const w = side === 'left' ? cs.borderLeftWidth : cs.borderRightWidth;
        const style = side === 'left' ? cs.borderLeftStyle : cs.borderRightStyle;
        const color = side === 'left' ? cs.borderLeftColor : cs.borderRightColor;
        const clear = color === 'transparent' || /,\s*0\)$/.test(color);
        if (parseFloat(w) < 1 || style === 'none' || clear || x < 6 || x > innerWidth - 6) continue;
        const hit = document.elementFromPoint(x + inward * 2, y);
        if (!hit || !el.parentElement.contains(hit)) continue;
        const text = (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30);
        out.push({ where, side, text, x, inward, y, width: parseFloat(w) });
      }
    }
    return out;
  }, CONTROLS);

const alike = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 6);

async function edgeScores(page) {
  const found = await edges(page);
  if (!found.length) return [];
  const img = await capture(page, NO_TEXT);
  return found.map((e) => {
    const y = e.y * DPR;
    const off = px(img, (e.x - e.inward * 5) * DPR, y);
    const fill = px(img, (e.x + e.inward * (e.width + 3)) * DPR, y);
    const band = [];
    for (let d = -1; d <= e.width * DPR; d++) band.push(px(img, e.x * DPR + e.inward * (d + 0.5), y));
    const line = band.filter((c) => !alike(c, fill));
    const score = Math.max(...(line.length ? line : [fill]).map((c) => ratio(c, off)));
    return { ...e, score: Math.round(score * 100) / 100 };
  });
}

async function sweep(h, page) {
  const max = await page.evaluate(() => {
    const r = document.querySelector('.dq');
    return r.scrollHeight - r.clientHeight;
  });
  const stride = await page.evaluate(() => Math.max(120, document.querySelector('.dq').clientHeight - 140));
  const text = [];
  const edge = [];
  for (let y = 0; ; y = Math.min(y + stride, max)) {
    await page.evaluate((t) => document.querySelector('.dq').scrollTo({ top: t, behavior: 'instant' }), y);
    await h.sleep(120);
    text.push(...(await contrast(page)).map((r) => ({ ...r, y })));
    edge.push(...(await edgeScores(page)).map((r) => ({ ...r, at: y })));
    if (y >= max) break;
  }
  await page.evaluate(() => document.querySelector('.dq').scrollTo({ top: 0, behavior: 'instant' }));
  return { text, edge };
}

function weak({ text, edge }) {
  const low = text.filter((r) => r.score < TEXT_MIN);
  const dull = edge.filter((r) => r.score < EDGE_MIN);
  const lines = [
    ...low.map((r) => `text "${r.text}" (${r.where}) ${r.score}:1`),
    ...dull.map((r) => `${r.side} edge of ${r.where} "${r.text}" ${r.score}:1 at ${r.at}+${Math.round(r.y)}`),
  ];
  return [...new Set(lines)];
}

async function walk(h, looks) {
  const problems = [];
  const table = {};
  for (const [vp, which, look] of looks) {
    const zoom = vp.width === 195 ? ' at 200%' : '';
    const size = `390x844${zoom}, ${look.theme}`;
    const edit = (s) => {
      s.settings.highContrast = true;
      Object.assign(s.profile, look);
    };
    const { ctx, page, errors } = await boot(h, vp, { edit });
    h.expect((await shown(page)) === 'high', `${size}: a save with Higher contrast on opened without it`);
    for (const [id, route, lit] of SCREENS) {
      if (which && !which.includes(id)) continue;
      await go(page, route);
      if (lit && !(await page.locator('.dq-safezone.is-lit').count())) {
        await page.locator('.ca-sz-light').click();
        await page.locator('.dq-safezone.is-lit').waitFor({ timeout: 10000 });
        await settle(page);
      }
      const rows = await sweep(h, page);
      const bad = weak(rows);
      const least = (l) => (l.length ? Math.min(...l.map((r) => r.score)) : null);
      const { text, edge } = rows;
      table[`${id} ${size}`] = { lines: text.length, edges: edge.length, text: least(text), edge: least(edge) };
      problems.push(...bad.map((b) => `${id} ${size}: ${b}`));
      h.expect(rows.text.length > 0, `${id} ${size}: no text measured`);
      await h.shot(page, `high-contrast-${id}-${vp.width}-${look.theme}`);
    }
    h.expect(!errors.length, `${size}: ${errors.join('\n')}`);
    await ctx.close();
  }
  console.log(JSON.stringify(table, null, 1));
  h.expect(!problems.length, `with Higher contrast on, these fall short:\n${problems.join('\n')}`);
  return table;
}

export const scenarios = {
  async 'high-contrast-saved'(h) {
    const keepFirstSave = (ctx) => ctx.addInitScript(([key, slot]) => {
      if (!sessionStorage.getItem(slot)) sessionStorage.setItem(slot, localStorage.getItem(key) ?? '');
    }, [h.SAVE, FIRST_SAVE]);
    const { ctx, page, errors } = await boot(h, { width: 390, height: 844 }, { prepare: keepFirstSave, edit: (s) => {
      delete s.settings.highContrast;
      delete s.setAt.highContrast;
    } });
    const first = JSON.parse((await page.evaluate((k) => sessionStorage.getItem(k), FIRST_SAVE)) || 'null');
    const old = first?.settings && !('highContrast' in first.settings) && !('highContrast' in (first.setAt ?? {}));
    h.expect(old, 'the app did not start on a save from before Higher contrast: ' + JSON.stringify(first?.settings));
    await openSettings(page);
    h.expect(!(await toggleIn(page).isChecked()), 'Higher contrast is on for a save from before it');
    h.expect((await shown(page)) === null, 'the page shows higher contrast for a save from before it');
    await h.shot(page, 'high-contrast-settings-off');
    const other = await ctx.newPage();
    await other.goto(page.url());
    await h.reachHub(other);
    await toggleIn(page).click();
    h.expect((await shown(page)) === 'high', 'turning Higher contrast on did not raise the contrast');
    const raised = () => document.documentElement.dataset.dqContrast === 'high';
    await other.waitForFunction(raised, null, { timeout: 10000 });
    const saved = JSON.parse(await h.ls(page, h.SAVE));
    const kept = saved.settings?.highContrast;
    h.expect(kept === true, 'Higher contrast was not saved: ' + JSON.stringify(kept));
    h.expect(typeof saved.setAt?.highContrast === 'number', 'the choice has no time, so another copy can undo it');
    await h.shot(page, 'high-contrast-settings-on');
    await page.reload();
    await h.reachHub(page);
    h.expect((await shown(page)) === 'high', 'Higher contrast did not last through a reload');
    await openSettings(page);
    h.expect(await toggleIn(page).isChecked(), 'the switch shows off after a reload with it on');
    await go(page, { name: 'safe', at: 'start' });
    h.expect((await shown(page)) === 'high', 'the Safe Zone leaves higher contrast out');
    await openSettings(page);
    await toggleIn(page).click();
    h.expect((await shown(page)) === null, 'turning Higher contrast off left it on');
    await other.waitForFunction(() => !document.documentElement.dataset.dqContrast, null, { timeout: 10000 });
    h.expect(JSON.parse(await h.ls(page, h.SAVE)).settings?.highContrast === false, 'turning it off was not saved');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'high-contrast-follows-other-tab'(h) {
    const { ctx, page, errors } = await boot(h, { width: 390, height: 844 });
    const other = await ctx.newPage();
    other.on('pageerror', (e) => errors.push('pageerror (second tab): ' + e.message));
    await other.goto(page.url());
    await h.reachHub(other);
    await openSettings(page);
    await openSettings(other);
    const disk = async () => JSON.parse(await h.ls(page, h.SAVE));
    const before = await disk();
    const caughtUp = (tab, on, motion) =>
      tab.waitForFunction(([name, on, motion]) => {
        const inputs = [...document.querySelectorAll('.dq-settings input[role="switch"]')];
        const input = inputs.find((i) => i.labels[0]?.textContent.includes(name));
        const picked = document.querySelector(`.dq-settings [aria-label="Motion: ${motion}"]`);
        const raised = document.documentElement.dataset.dqContrast === 'high';
        return input?.checked === on && raised === on && picked?.getAttribute('aria-checked') === 'true';
      }, [SWITCH, on, motion], { timeout: 10000 }).then(() => true, () => false);
    await other.getByRole('radio', { name: 'Motion: Full' }).click();
    await toggleIn(page).click();
    h.expect(await caughtUp(other, true, 'Full'), 'the second tab did not pick up Higher contrast turned on');
    h.expect(await caughtUp(page, true, 'Full'), 'turning Higher contrast on undid Motion set in the other tab');
    let saved = await disk();
    h.expect(saved.settings.highContrast === true && saved.settings.motion === 'full', 'the save lost a choice: '
      + JSON.stringify({ highContrast: saved.settings.highContrast, motion: saved.settings.motion }));
    await page.getByRole('radio', { name: 'Motion: Auto' }).click();
    await toggleIn(other).click();
    h.expect(await caughtUp(page, false, 'Auto'), 'the first tab did not pick up Higher contrast turned off');
    h.expect(await caughtUp(other, false, 'Auto'), 'turning Higher contrast off undid Motion set in the other tab');
    saved = await disk();
    h.expect(saved.settings.highContrast === false && saved.settings.motion === 'system', 'the save lost a choice: '
      + JSON.stringify({ highContrast: saved.settings.highContrast, motion: saved.settings.motion }));
    const moved = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => k !== 'motion' && k !== 'highContrast' && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const overwritten = [
      ...moved(before.settings, saved.settings).map((k) => `settings.${k}`),
      ...moved(before.setAt, saved.setAt).map((k) => `setAt.${k}`),
      ...moved(before.profile, saved.profile).map((k) => `profile.${k}`),
    ];
    h.expect(!overwritten.length, `switching between tabs changed other choices: ${overwritten.join(', ')}`);
    await h.shot(other, 'high-contrast-follows-other-tab');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  'high-contrast-every-screen': (h) => walk(h, LOOKS),
  'high-contrast-themes': (h) => walk(h, THEMES),
};
