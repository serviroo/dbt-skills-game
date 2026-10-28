import { settle } from './layout-fit.e2e.mjs';
import { content, holdDaily, progress, returning, slug } from './first-actions.e2e.mjs';

const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 568, height: 320 },
  { width: 320, height: 480 },
];
const MOVES = ['transform', 'translate', 'scale', 'rotate', 'top', 'left', 'right', 'bottom'];

const choice = (page, name) =>
  page.evaluate((name) => {
    const q = document.querySelector('.dq-quest');
    const el = [...q.querySelectorAll('button')].find((b) => b.textContent.trim() === name && b.checkVisibility({ checkVisibilityCSS: true }));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const bar = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]];
    return {
      name,
      box: [r.left, r.top, r.right, r.bottom].map(Math.round),
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      size: r.width >= 44 && r.height >= 44,
      shown: r.top >= bar - 0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5,
      covered: pts.filter(([x, y]) => !el.contains(document.elementFromPoint(x, y))).length,
    };
  }, name);
const scrolled = (page) => page.evaluate(() => document.querySelector('.dq').scrollTop + document.scrollingElement.scrollTop);

async function choices(h, page, names, where) {
  const out = {};
  for (const name of names) {
    const c = await choice(page, name);
    h.expect(c, `${where}: no ${name}`);
    h.expect(c.shown, `${where}: ${name} is not all on the first screen (${c.box.join(', ')})`);
    h.expect(!c.covered, `${where}: something covers ${name} (${c.covered} of 5 points miss it)`);
    h.expect(c.size, `${where}: ${name} is smaller than 44 px`);
    out[name] = c;
  }
  return out;
}

const watch = (page) =>
  page.evaluate(() => {
    const seen = new Set();
    const tick = () => {
      for (const a of document.getAnimations()) if (!(a instanceof CSSAnimation) && a.effect?.target?.closest?.('.dq-quest') && !a.effect.target.closest('.dq-card')) seen.add(a);
      window.__fitRaf = requestAnimationFrame(tick);
    };
    tick();
    window.__fitSeen = seen;
  });
const moves = (page) =>
  page.evaluate((MOVES) => {
    cancelAnimationFrame(window.__fitRaf);
    return [...window.__fitSeen].map((a) => ({ on: a.effect.target.className, ms: a.effect.getComputedTiming().activeDuration, moves: MOVES.filter((p) => a.effect.getKeyframes().some((f) => p in f && f[p] !== 'none')) }));
  }, MOVES);

const faces = (page) =>
  page.evaluate(async () => {
    const { skillCard } = await import('/src/daily/hub.ts');
    const { ROTATION } = await import('/src/content/dbt.ts');
    const card = document.querySelector('.dq-quest .dq-card');
    const inner = card.querySelector('.dq-card-inner');
    const real = inner.querySelector('.dq-cardface--front');
    const bar = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const box = (e) => {
      const r = e.getBoundingClientRect();
      return [r.left, r.top, r.right, r.bottom].map(Math.round).join(', ');
    };
    const off = (e) => {
      const r = e.getBoundingClientRect();
      return r.top < bar - 0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5;
    };
    const parts = (face) => [card, face.querySelector('.dq-cf-name'), face.querySelector('.dq-cf-real'), ...[...card.closest('.dq-quest').querySelectorAll('button')].filter((b) => b !== card && b.checkVisibility({ checkVisibilityCSS: true }))];
    const label = real.querySelector('.dq-cf-real').getBoundingClientRect();
    const drawn = {
      card: box(card),
      label: box(real.querySelector('.dq-cf-real')),
      off: parts(real).filter(off).map((e) => (e === card ? 'the card' : e.className.split(' ')[0])),
      hit: card.contains(document.elementFromPoint(label.left + label.width / 2, label.top + label.height / 2)),
    };
    const cut = [];
    const out = [];
    for (const q of ROTATION) {
      const face = skillCard(q.skill, { label: q.label, special: q.special });
      inner.replaceChild(face, inner.querySelector('.dq-cardface--front'));
      const who = `${q.special ?? q.skill}${q.label ? ` (${q.label})` : ''}`;
      const gone = parts(face).filter(off);
      if (gone.length) out.push(`${who}: ${gone.map((e) => `${e === card ? 'the card' : e.className.split(' ')[0]} at ${box(e)}`).join(', ')}`);
      const f = face.getBoundingClientRect();
      const cs = getComputedStyle(face);
      const bottom = f.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
      const right = f.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      for (const c of face.querySelectorAll('*')) {
        if (!c.checkVisibility() || c.closest('svg')) continue;
        const r = c.getBoundingClientRect();
        if (r.bottom > bottom + 0.5 || r.right > right + 0.5) {
          cut.push(`${who}: ${c.className || c.tagName}`);
          break;
        }
      }
    }
    inner.replaceChild(real, inner.querySelector('.dq-cardface--front'));
    return { width: Math.round(inner.getBoundingClientRect().width), cut, out, drawn };
  });

async function onScreen(h, page, where) {
  const fit = await faces(page);
  h.expect(!fit.drawn.off.length, `${where}: ${fit.drawn.off.join(', ')} not all on the first screen (card ${fit.drawn.card}, label ${fit.drawn.label})`);
  h.expect(fit.drawn.hit, `${where}: something covers the card's skill label`);
  h.expect(!fit.out.length, `${where}: at ${fit.width} px off the first screen: ${fit.out.join('; ')}`);
  return fit;
}

async function seedOf(h, run) {
  const c = await content(h);
  const vi = c.rotation.findIndex((q, i) => i >= 2 && !q.special);
  if (run.save === 'first run') return { 'dbt.app.v1': h.SEEN };
  if (run.save === 'old save') return { [h.SAVE]: JSON.stringify({ v: 1, events: JSON.parse(returning(h, vi)[h.SAVE]).events }), 'dbt.app.v1': h.SEEN };
  const seed = returning(h, vi);
  const save = JSON.parse(seed[h.SAVE]);
  save.settings = { motion: 'reduce' };
  seed[h.SAVE] = JSON.stringify(save);
  return seed;
}

async function arrive(h, page, run, where) {
  try {
    if (run.save === 'first run') {
      await page.waitForFunction(() => !!window.__daily);
      const welcome = page.locator('.dq-sw');
      await welcome.waitFor({ timeout: 8000 });
      if (run.media) {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
      }
      for (let i = 0; (await welcome.count()) && i < 6; i++) {
        // a window whose scrim is off is closing: tap it no more, wait until it is gone, so no tap lands on Home
        if (!(await page.locator('.dq-scrim.is-on').count())) {
          await page.waitForFunction(() => !document.querySelector('.dq-sw') || !!document.querySelector('.dq-scrim.is-on'), null, { timeout: 5000 });
          continue;
        }
        const box = await welcome.boundingBox().catch(() => null);
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await h.sleep(400);
      }
      await page.waitForFunction(() => !!window.__daily);
      await page.evaluate(() => window.__daily.settled);
    }
    await h.reachHub(page);
    await settle(page);
  } catch (e) {
    await h.evidence(page, `fail-home-quest-fit-${slug(where)}`);
    throw e;
  }
}

export const scenarios = {
  async 'home-quest-fit'(h) {
    const c = await content(h);
    const RUNS = [
      ...SIZES.flatMap((vp) => [
        { vp, save: 'first run' },
        { vp, save: 'old save' },
      ]),
      ...[SIZES[0], SIZES[2], SIZES[5], SIZES[6]].flatMap((vp) => [
        { vp, save: 'returning', motion: 'reduced in Settings' },
        { vp, save: 'first run', motion: 'system reduced', media: true },
      ]),
    ];
    for (const run of RUNS) {
      const where = `${run.vp.width}x${run.vp.height}, ${run.save}${run.motion ? `, ${run.motion}` : ''}`;
      const { ctx, page, errors } = await h.open(await seedOf(h, run), '?mute', run.vp);
      try {
        await arrive(h, page, run, where);
        const reduced = await page.evaluate(() => window.__daily.reduced());
        h.expect(reduced === !!run.motion, `${where}: reduced motion is ${reduced ? 'on' : 'off'}`);
        h.expect(!(await page.locator('.dq-quest.is-aside, .dq-quest .dq-card.is-open').count()), `${where}: today's card is not face-down and offered`);
        h.expect((await scrolled(page)) === 0, `${where}: Home arrived scrolled by ${await scrolled(page)} px`);
        h.expect(!(await page.locator('.dq-quest-go').isVisible()), `${where}: Begin shows before the reveal`);
        await choices(h, page, ['Pick another', c.look], `${where}, arrival`);
        await onScreen(h, page, `${where}, arrival`);
        await h.shot(page, `home-quest-fit-arrival-${run.vp.width}x${run.vp.height}-${run.save.replace(' ', '-')}${run.motion ? '-reduced' : ''}`);

        const card = await page.locator('.dq-quest .dq-card').evaluate((e) => {
          const r = e.getBoundingClientRect();
          const bar = document.querySelector('.dq-top').getBoundingClientRect().bottom;
          const x = r.left + r.width / 2, y = (Math.max(r.top, bar) + Math.min(r.bottom, innerHeight)) / 2;
          return { x, y, hit: e.contains(document.elementFromPoint(x, y)) };
        });
        h.expect(card.hit, `${where}: a tap on today's card lands on something else`);
        const before = await progress(h, page);
        await watch(page);
        await page.mouse.click(card.x, card.y);
        await page.locator('.dq-quest-go').waitFor({ timeout: 8000 });
        await settle(page);
        const anims = await moves(page);
        h.expect(anims.length, `${where}: the reveal brought its buttons in without a fade`);
        for (const a of anims) {
          h.expect(!a.moves.length, `${where}: with the reveal "${a.on}" moves (${a.moves.join(', ')})`);
          if (reduced) h.expect(a.ms <= 180, `${where}: with the reveal "${a.on}" fades for ${a.ms} ms with reduced motion`);
        }
        h.expect((await scrolled(page)) === 0, `${where}: the reveal scrolled Home by ${await scrolled(page)} px`);
        const shown = await choices(h, page, ['Begin', 'Pick another', c.look], `${where}, revealed`);
        const fit = await onScreen(h, page, `${where}, revealed`);
        h.expect(!fit.cut.length, `${where}: at ${fit.width} px the card face cuts off ${fit.cut.join('; ')}`);
        await h.shot(page, `home-quest-fit-revealed-${run.vp.width}x${run.vp.height}-${run.save.replace(' ', '-')}${run.motion ? '-reduced' : ''}`);

        const mid = await progress(h, page);
        await watch(page);
        await page.mouse.click(shown[c.look].x, shown[c.look].y);
        await page.locator('.dq-quest.is-aside').waitFor({ timeout: 5000 });
        await settle(page);
        for (const a of await moves(page)) h.expect(!a.moves.length, `${where}: closing the suggestion moves "${a.on}" (${a.moves.join(', ')})`);
        h.expect(!(await page.locator('.dq-sw').count()), `${where}: Just look around opened a window`);
        const after = await progress(h, page);
        h.expect(after.xp === mid.xp && after.collection.length === mid.collection.length && after.cards.length === mid.cards.length && mid.cards.length === before.cards.length + 1, `${where}: progress changed: ${JSON.stringify({ before: before.xp, mid: mid.xp, after: after.xp })}`);
        h.expect(await page.evaluate(() => window.__daily.store.questAside()), `${where}: the store does not hold today's card as set aside`);
        const back = await choices(h, page, [c.back], `${where}, set aside`);
        await page.mouse.click(back[c.back].x, back[c.back].y);
        await page.locator('.dq-quest:not(.is-aside) .dq-card.is-open').waitFor({ timeout: 5000 });
        await settle(page);
        await choices(h, page, ['Begin', 'Pick another', c.look], `${where}, card shown again`);
        h.expect(!errors.length, `${where}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  async 'home-quest-fit-late-mount'(h) {
    const run = { vp: SIZES[3], save: 'first run' };
    const where = `${run.vp.width}x${run.vp.height}, first run, companion held 9 s`;
    const held = [];
    const { ctx, page, errors } = await h.open(await seedOf(h, run), '?mute', run.vp, holdDaily(h, held));
    try {
      await arrive(h, page, run, where);
      h.expect(held.length === 1 && held[0] >= 9000, `${where}: the companion module was held ${JSON.stringify(held)} ms`);
      h.expect(!(await page.locator('.dq-sw').count()) && (await page.evaluate(() => window.__daily.route.name)) === 'hub', `${where}: Home did not settle after the welcome`);
      await choices(h, page, ['Pick another', (await content(h)).look], `${where}, arrival`);
      h.expect(!errors.length, `${where}: ${errors.join('\n')}`);
    } finally {
      await ctx.close();
    }
  },
};
