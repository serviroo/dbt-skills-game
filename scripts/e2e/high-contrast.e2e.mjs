import { boot, settle } from './layout-fit.e2e.mjs';
import { capture, contrast, NO_TEXT, px, ratio } from './home-sky.e2e.mjs';

const SWITCH = 'Higher contrast';
const TEXT_MIN = 7;
const LARGE_MIN = 4.5;
const EDGE_MIN = 3;
const DPR = 2;

const SAFE_AT = ['start', 'breathe', 'squeeze', 'cold', 'check', 'stop'];
SAFE_AT.push('reasons', 'comfort', 'people', 'talk', 'close');
const SCREENS = [
  ['home', { name: 'hub' }],
  ['settings', { name: 'settings' }],
  ['skill', { name: 'skill', id: 'check-facts' }],
  ['library', { name: 'library' }],
  ['moment', { name: 'moment' }],
  ['diary', { name: 'diary' }],
  ['night-watch', { name: 'shadows' }],
  ['art', { name: 'art' }],
  ['draw', { name: 'draw', kind: 'today' }],
  ['stories', { name: 'stories' }],
  ['write', { name: 'write', id: 'tale-1' }],
  ['read', { name: 'read', id: 'tale-1' }],
  ...SAFE_AT.map((at) => [`safe-${at}`, { name: 'safe', at }]),
  ['safe-lit-start', { name: 'safe', at: 'start' }, true],
  ['safe-lit-talk', { name: 'safe', at: 'talk' }, true],
];
const ZOOMED = ['home', 'settings', 'night-watch', 'safe-start', 'safe-talk', 'safe-lit-start'];
const LOOKS = [
  [{ width: 390, height: 844 }, null, null],
  [{ width: 195, height: 422 }, ZOOMED, { theme: 'mint', accent: 'green' }],
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

const FIELDS = 'select, textarea, input:not([type=checkbox]):not([type=range])';
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
        out.push({ where, side, text, x, inward, y });
      }
    }
    return out;
  }, CONTROLS);

async function edgeScores(page) {
  const found = await edges(page);
  if (!found.length) return [];
  const img = await capture(page, NO_TEXT);
  return found.map((e) => {
    const off = px(img, (e.x - e.inward * 5) * DPR, e.y * DPR);
    let best = 1;
    for (let d = -1 * DPR; d <= 3 * DPR; d++) {
      best = Math.max(best, ratio(px(img, e.x * DPR + e.inward * d, e.y * DPR), off));
    }
    return { ...e, score: Math.round(best * 100) / 100 };
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
  const low = text.filter((r) => r.score < (r.need === 3 ? LARGE_MIN : TEXT_MIN));
  const dull = edge.filter((r) => r.score < EDGE_MIN);
  const seen = new Set();
  const lines = [
    ...low.map((r) => `text "${r.text}" (${r.where}) ${r.score}:1`),
    ...dull.map((r) => `${r.side} edge of ${r.where} "${r.text}" ${r.score}:1 at ${r.at}+${Math.round(r.y)}`),
  ];
  return lines.filter((l) => !seen.has(l) && seen.add(l));
}

export const scenarios = {
  async 'high-contrast-saved'(h) {
    let seeded;
    const { ctx, page, errors } = await boot(h, { width: 390, height: 844 }, { edit: (s) => {
      delete s.settings.highContrast;
      delete s.setAt.highContrast;
      seeded = structuredClone(s);
    } });
    h.expect(!('highContrast' in seeded.settings), 'the old save already holds a contrast choice');
    await openSettings(page);
    h.expect(!(await toggleIn(page).isChecked()), 'Higher contrast is on for a save from before it');
    h.expect((await shown(page)) === null, 'the page shows higher contrast for a save from before it');
    await h.shot(page, 'high-contrast-settings-off');
    const other = await ctx.newPage();
    await other.goto(page.url());
    await h.reachHub(other);
    await toggleIn(page).click();
    h.expect((await shown(page)) === 'high', 'turning Higher contrast on did not raise the contrast');
    await other.waitForFunction(() => document.documentElement.dataset.dqContrast === 'high', null, { timeout: 10000 });
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

  async 'high-contrast-every-screen'(h) {
    const problems = [];
    const table = {};
    for (const [vp, which, look] of LOOKS) {
      const size = vp.width === 195 ? `390x844 at 200%, ${look.theme}` : '390x844';
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
        await h.shot(page, `high-contrast-${id}-${vp.width}`);
      }
      h.expect(!errors.length, `${size}: ${errors.join('\n')}`);
      await ctx.close();
    }
    console.log(JSON.stringify(table, null, 1));
    h.expect(!problems.length, `with Higher contrast on, these fall short:\n${problems.join('\n')}`);
    return table;
  },
};
