import { settle } from './layout-fit.e2e.mjs';
import { content, returning } from './first-actions.e2e.mjs';

// Tablets either way up and a phone held sideways: Home's first screen holds today's card, Pick another, Give me a
// moment and the Safe Zone button, each whole, untouched by anything else and big enough to tap.
const SIZES = [
  { width: 844, height: 390 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 1366, height: 1024 },
];

const view = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const q = document.querySelector('.dq-quest');
    const named = (name) => [...q.querySelectorAll('button')].find((b) => b.textContent.trim() === name && b.checkVisibility({ checkVisibilityCSS: true }));
    const look = (name, el, below = true) => {
      if (!el?.checkVisibility({ checkVisibilityCSS: true })) return { name, missing: true };
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // the middle and the middle of each edge, so a pill-shaped button's rounded corners don't count as covered
      const pts = [[cx, cy], [r.left + 4, cy], [r.right - 4, cy], [cx, r.top + 4], [cx, r.bottom - 4]];
      return {
        name,
        box: [r.left, r.top, r.right, r.bottom].map(Math.round),
        shown: r.top >= (below ? bar : 0) - 0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5,
        covered: pts.filter(([x, y]) => !el.contains(document.elementFromPoint(x, y))).length,
        size: r.width >= 44 && r.height >= 44,
      };
    };
    // Home's panels by column, top to bottom: a gap taller than the hub's own row gap is room left empty
    const hub = document.querySelector('.dq-hub');
    const gap = parseFloat(getComputedStyle(hub).rowGap) || 0;
    const cols = new Map();
    for (const c of hub.querySelectorAll('.dq-col:not(.dq-col--t)')) {
      const r = c.getBoundingClientRect();
      if (!r.height) continue;
      const k = Math.round(r.left);
      cols.set(k, [...(cols.get(k) ?? []), r]);
    }
    const holes = [];
    for (const [left, rs] of cols) {
      rs.sort((a, b) => a.top - b.top);
      for (let i = 1; i < rs.length; i++) if (rs[i].top - rs[i - 1].bottom > gap + 2) holes.push(`${Math.round(rs[i].top - rs[i - 1].bottom)} px at x ${left}, y ${Math.round(rs[i - 1].bottom)}`);
    }
    return {
      scrolled: document.querySelector('.dq').scrollTop + document.scrollingElement.scrollTop,
      sideways: document.documentElement.scrollWidth > innerWidth,
      holes,
      parts: [
        look('Safe Zone', document.querySelector('.dq-top .dq-safe'), false),
        look('Give me a moment', document.querySelector('.dq-momentbtn')),
        look("today's card", q.querySelector('.dq-card')),
        look('Pick another', named('Pick another')),
        ...(q.querySelector('.dq-card.is-open') ? [look('Begin', q.querySelector('.dq-quest-go'))] : []),
      ],
    };
  });

function check(v, where) {
  const out = [];
  if (v.scrolled) out.push(`${where}: Home arrived scrolled by ${v.scrolled} px`);
  if (v.sideways) out.push(`${where}: Home scrolls sideways`);
  for (const hole of v.holes) out.push(`${where}: Home leaves an empty ${hole} between its panels`);
  for (const p of v.parts) {
    if (p.missing) out.push(`${where}: no ${p.name}`);
    else {
      if (!p.shown) out.push(`${where}: ${p.name} is not all on the first screen (${p.box.join(', ')})`);
      if (p.covered) out.push(`${where}: something covers ${p.name} (${p.covered} of 5 points miss it)`);
      if (!p.size) out.push(`${where}: ${p.name} is smaller than 44 px`);
    }
  }
  return out;
}

/**
 * The Daily gift and Give me a moment, on a phone at 200% zoom held either way (the page laid out at half the size): each
 * shows whole once scrolled to, clear of the top bar, apart from the other, takes its own taps and is at least 44 px.
 */
function strip(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const parts = [['the Daily gift', document.querySelector('.dq-chest')], ['Give me a moment', document.querySelector('.dq-momentbtn')]];
    const out = [];
    for (const [name, el] of parts) {
      if (!el?.checkVisibility({ checkVisibilityCSS: true })) {
        out.push(`no ${name}`);
        continue;
      }
      el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      // the page never scrolls sideways for the player, though a script can move it there
      for (const s of [document.scrollingElement, document.querySelector('.dq')]) s.scrollLeft = 0;
      const r = el.getBoundingClientRect();
      const box = [r.left, r.top, r.right, r.bottom].map(Math.round).join(', ');
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const pts = [[cx, cy], [r.left + 4, cy], [r.right - 4, cy], [cx, r.top + 4], [cx, r.bottom - 4]];
      if (r.top < bar - 0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5) out.push(`${name} doesn't show whole (${box} in ${innerWidth}x${innerHeight})`);
      const missed = pts.filter(([x, y]) => !el.contains(document.elementFromPoint(x, y))).length;
      if (missed) out.push(`something covers ${name} (${missed} of 5 points miss it, at ${box})`);
      if (r.width < 44 || r.height < 44) out.push(`${name} is ${Math.round(r.width)}x${Math.round(r.height)}, under 44 px`);
    }
    const [a, b] = parts.map(([, e]) => e?.getBoundingClientRect());
    if (a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push('the Daily gift and Give me a moment overlap');
    return out;
  });
}

export const scenarios = {
  async 'home-strip-200'(h) {
    const c = await content(h);
    const vi = c.rotation.findIndex((q, i) => i >= 2 && !q.special);
    const problems = [];
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
      const size = `${vp.width}x${vp.height} at 200%`;
      const { ctx, page, errors } = await h.open(returning(h, vi), '?mute', { width: vp.width / 2, height: vp.height / 2 });
      try {
        await h.reachHub(page);
        await settle(page);
        problems.push(...(await strip(page)).map((p) => `${size}: ${p}`));
        await h.shot(page, `home-strip-${vp.width}x${vp.height}-200`);
        if (errors.length) problems.push(`${size}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!problems.length, problems.join('\n'));
  },
  async 'home-roomy-tablets-and-sideways'(h) {
    const c = await content(h);
    const vi = c.rotation.findIndex((q, i) => i >= 2 && !q.special);
    const problems = [];
    for (const vp of SIZES) {
      const size = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open(returning(h, vi), '?mute', vp);
      try {
        await h.reachHub(page);
        await settle(page);
        h.expect(!(await page.locator('.dq-quest .dq-card.is-open').count()), `${size}: today's card is not face-down`);
        problems.push(...check(await view(page), `${size}, card face-down`));
        await h.shot(page, `home-roomy-${size}-face-down`);
        // the card floats, so tap its middle rather than wait for it to hold still
        const at = await page.locator('.dq-quest .dq-card').evaluate((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.mouse.click(at.x, at.y);
        await page.locator('.dq-quest-go').waitFor({ timeout: 8000 });
        await settle(page);
        problems.push(...check(await view(page), `${size}, card revealed`));
        await h.shot(page, `home-roomy-${size}-revealed`);
        if (errors.length) problems.push(`${size}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
