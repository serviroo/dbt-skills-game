import { audit, boot, PAGE, settle, SKIP } from './layout-fit.e2e.mjs';

export const dayOf = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const URGE = 'Urge to give up on today';
const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
];

export function returning(h, vi, extra = {}) {
  const now = Date.now(), today = dayOf(now);
  const events = [];
  for (let i = vi; i >= 1; i--) events.push({ id: `fa-v${i}`, k: 'visit', xp: 10, t: now - i * 86400e3, day: addDays(today, -i) });
  events.push({ id: 'fa-v0', k: 'visit', xp: 10, t: now - 60e3, day: today });
  const save = { v: 1, events, flags: { rankSeen: 5, greetDay: today, giftDay: today, cardDay: '', therapistLineShown: true }, ...extra };
  return { [h.SAVE]: JSON.stringify(save), 'dbt.app.v1': h.SEEN };
}

export async function content(h) {
  if (h.shared.firstActions) return h.shared.firstActions;
  const { ctx, page } = await h.open(returning(h, 0));
  try {
    await page.waitForFunction(() => !!window.__daily);
    return (h.shared.firstActions = await page.evaluate(async () => {
      const m = await import('/src/content/dbt.ts');
      const lines = await import('/src/content/daily-lines.ts');
      const ui = await import('/src/daily/ui.ts');
      const q = lines.QUEST ?? {};
      const say = (s) => (typeof s === 'string' ? ui.typo(s) : null);
      return { rotation: m.ROTATION, names: Object.fromEntries(Object.entries(m.SKILL).map(([id, s]) => [id, s.sl])), done: q.done ?? null, look: say(q.look) ?? 'Just look around', aside: say(q.aside), back: say(q.back) };
    }));
  } finally {
    await ctx.close();
  }
}

export async function progress(h, page) {
  const s = JSON.parse(await h.ls(page, h.SAVE));
  const today = dayOf(Date.now());
  return {
    cards: s.events.filter((e) => e.k === 'card' && e.day === today),
    skills: s.events.filter((e) => e.k === 'skill').map((e) => e.skill),
    xp: s.events.reduce((a, e) => a + e.xp, 0),
    cardDay: s.flags.cardDay,
    collection: await page.evaluate(() => [...window.__daily.store.derived().collection]),
  };
}

const quest = (page) => {
  const q = page.locator('.dq-quest');
  return { card: q.locator('.dq-card'), pick: q.getByRole('button', { name: 'Pick another', exact: true }), primary: q.locator('.dq-quest-go') };
};
const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? `${a.tagName.toLowerCase()} "${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40)}"` : 'nothing';
});
export const route = (page, name) => page.waitForFunction((n) => window.__daily.route.name === n, name, { timeout: 10000 });
const homeView = (page) => page.evaluate(() => {
  const box = (el) => {
    if (!el?.checkVisibility()) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
  };
  const main = document.querySelector('#dq-main');
  const m = main.getBoundingClientRect();
  const safe = document.querySelector('.dq-top .dq-safe');
  const sr = safe?.getBoundingClientRect();
  const quest = document.querySelector('.dq-quest');
  const status = document.querySelector('.dq-status');
  return {
    vw: innerWidth,
    scrollTop: Math.round(document.querySelector('.dq').scrollTop),
    main: { top: Math.max(m.top, 0), bottom: Math.min(m.bottom, innerHeight) },
    safe: !!sr && !!safe.checkVisibility() && sr.top >= 0 && sr.bottom <= innerHeight,
    questFirstInPage: !!(quest.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING),
    quest: box(quest),
    status: box(status),
    card: box(quest.querySelector('.dq-card')),
    go: box(quest.querySelector('.dq-quest-go')),
    pick: box([...quest.querySelectorAll('.dq-quest-acts button')].find((b) => b.textContent.trim() === 'Pick another')),
    primary: [...quest.querySelectorAll('.dq-btn--primary')].find((b) => b.checkVisibility())?.textContent.trim() ?? null,
    done: quest.classList.contains('is-done'),
    note: quest.querySelector('.dq-quest-note').textContent.trim(),
    look: box([...quest.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Just look around')),
  };
});

export const asideView = (page) => page.evaluate(() => {
  const q = document.querySelector('.dq-quest');
  const seen = (el) => !!el?.checkVisibility();
  const text = q.querySelector('.dq-quest-aside-t');
  const f = window.__daily.store.state.flags;
  return {
    closed: q.classList.contains('is-aside'),
    held: window.__daily.store.questAside(),
    stamps: f.questAsideDay === window.__daily.store.today() && f.questAsideAt > 0,
    card: seen(q.querySelector('.dq-card')),
    buttons: [...q.querySelectorAll('button')].filter(seen).map((b) => b.textContent.trim()),
    text: seen(text) ? text.textContent.trim() : null,
    focus: document.activeElement === text ? 'aside text' : document.activeElement === q.querySelector('.dq-card') ? 'card' : document.activeElement?.textContent.trim().slice(0, 40) ?? 'nothing',
    window: !!document.querySelector('.dq-sw'),
    route: window.__daily.route.name,
  };
});

async function asideHome(h, page, c, before, where, dialogs) {
  await page.locator('.dq-quest.is-aside').waitFor({ timeout: 5000 });
  const v = await asideView(page);
  h.expect(v.route === 'hub', `${where}: Just look around left Home for "${v.route}"`);
  h.expect(v.held && v.stamps, `${where}: the store does not hold today's suggestion as closed (${JSON.stringify({ held: v.held, stamps: v.stamps })})`);
  h.expect(!v.card, `${where}: today's card still shows`);
  h.expect(v.text === c.aside, `${where}: the quest says "${v.text}", not "${c.aside}"`);
  h.expect(JSON.stringify(v.buttons) === JSON.stringify([c.back]), `${where}: the closed quest offers ${JSON.stringify(v.buttons)}`);
  h.expect(!v.window && !dialogs.length, `${where}: closing the suggestion asked something: ${dialogs.join(' | ') || 'a window opened'}`);
  h.expect(await page.locator('.dq-top').getByRole('button', { name: /Safe Zone/ }).isVisible(), `${where}: the Safe Zone button is gone`);
  const p = await progress(h, page);
  h.expect(p.xp === before.xp && p.cards.length === before.cards.length && p.skills.length === before.skills.length && p.cardDay === before.cardDay && p.collection.length === before.collection.length, `${where}: progress changed: ${JSON.stringify({ before: { ...before, collection: before.collection.length }, after: { ...p, collection: p.collection.length } })}`);
  return v;
}

async function faceDown(h, page, q, where) {
  const { card, pick, primary } = quest(page);
  h.expect(!(await card.evaluate((c) => c.classList.contains('is-open'))), `${where}: today's card is already face-up`);
  h.expect((await card.getAttribute('aria-label')) === "Reveal today's skill card", `${where}: the card is labelled "${await card.getAttribute('aria-label')}"`);
  h.expect(await pick.isVisible(), `${where}: there is no Pick another on Home while today's card is face-down`);
  h.expect(!(await primary.isVisible()), `${where}: the card's own button shows before it is revealed`);
  const p = await progress(h, page);
  h.expect(!p.cards.length && p.cardDay !== dayOf(Date.now()), `${where}: today's card was revealed (${p.cards.length} card events, cardDay ${p.cardDay})`);
  if (!q.special) h.expect(!p.collection.includes(q.skill), `${where}: ${q.skill} joined the collection without the card being revealed`);
  return p;
}

async function faceUp(h, page, q, label, where) {
  const { card, pick, primary } = quest(page);
  await primary.waitFor({ timeout: 8000 });
  h.expect(await card.evaluate((c) => c.classList.contains('is-open')), `${where}: today's card is not face-up`);
  h.expect((await primary.textContent()).trim() === label, `${where}: the card's button says "${(await primary.textContent()).trim()}"`);
  h.expect(await pick.isVisible(), `${where}: Pick another is gone after the reveal`);
  const p = await progress(h, page);
  h.expect(p.cards.length === 1, `${where}: ${p.cards.length} card events today`);
  h.expect(q.special ? p.cards[0].data?.special === q.special : p.cards[0].skill === q.skill && p.collection.includes(q.skill), `${where}: the card event or collection is wrong: ${JSON.stringify(p.cards[0])}`);
}

const today = () => dayOf(Date.now());
const stored = async (h, page) => JSON.parse(await h.ls(page, h.SAVE));
const kindOf = (row) => (row === URGE ? 'urges' : 'emotions');
const listOf = (row) => (row === URGE ? 'urgeRows' : 'emotionRows');
const groupOf = (row) => (row === URGE ? 'Urges' : 'Feelings');

async function openDiary(h, page) {
  await h.reachHub(page);
  await page.locator('.dq-tile', { hasText: 'Diary card' }).click();
  await route(page, 'diary');
  await page.locator('.dq-today').waitFor();
}
const rowOnCard = (page, row) => page.locator('.dq-today').getByRole('radiogroup', { name: row, exact: true });
const rating = (page, row, v) => page.locator('.dq-today').getByRole('radio', { name: `${row}: ${v}`, exact: true });
async function rowsEditor(page) {
  const ed = page.locator('.dq-rowsed');
  if (!(await ed.isVisible())) await page.getByRole('button', { name: 'Edit rows' }).click();
  await ed.waitFor();
  return ed;
}
async function removeRow(page, row) {
  const ed = await rowsEditor(page);
  await ed.getByRole('button', { name: `Remove ${row}`, exact: true }).click();
}
async function addRow(page, row) {
  const ed = await rowsEditor(page);
  const box = ed.locator('.dq-addrow', { has: page.getByLabel(`Add a row to ${groupOf(row)}`) });
  await box.getByRole('textbox').fill(row);
  await box.getByRole('button', { name: 'Add' }).click();
}
async function offCard(h, page, row, where) {
  await rowOnCard(page, row).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  h.expect(!(await rowOnCard(page, row).count()), `${where}: "${row}" is still on today's card after it was removed`);
  if (row === URGE) h.expect(!(await page.locator('.dq-today h3', { hasText: 'Urges, 0 to 5' }).isVisible()), `${where}: today's card still shows the Urges heading with no urge rows`);
}
async function history(page, row) {
  const week = await page.locator('.dq-weekp tbody tr').evaluateAll((trs, r) => [...(trs.find((tr) => tr.querySelector('th')?.textContent === r)?.querySelectorAll('td') ?? [])].map((td) => td.textContent), row);
  const text = await page.locator('.dq-pre').textContent();
  const line = text.split('\n').find((l) => l.slice(0, 30).trim() === row);
  const exported = line ? line.slice(30).match(/.{4}/g).map((c) => c.trim()) : [];
  return { week, exported };
}

export const slug = (s) => s.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
export const holdDaily = (h, held) => (ctx) =>
  ctx.route('**/src/daily/index.ts', async (r) => {
    const t = Date.now();
    await h.sleep(9000);
    held.push(Date.now() - t);
    await r.continue().catch(() => {});
  });

async function welcomed(h, page, run, where) {
  try {
    await page.waitForFunction(() => !!window.__daily);
    const welcome = page.locator('.dq-sw');
    await welcome.waitFor({ timeout: 8000 });
    if (run.media) {
      await page.emulateMedia({ reducedMotion: run.media });
      await page.reload();
    } else {
      for (let i = 0; (await welcome.count()) && i < 4; i++) {
        // a window whose scrim is off is closing: tap it no more, wait until it is gone, so no tap lands on Home
        if (!(await page.locator('.dq-scrim.is-on').count())) {
          await page.waitForFunction(() => !document.querySelector('.dq-sw') || !!document.querySelector('.dq-scrim.is-on'), null, { timeout: 5000 });
          continue;
        }
        await welcome.click({ force: true }).catch(() => {});
        await h.sleep(400);
      }
      h.expect(!(await welcome.count()), `${where}: the welcome window would not close`);
    }
    await page.waitForFunction(() => !!window.__daily);
    await page.evaluate(() => window.__daily.settled);
  } catch (e) {
    await h.evidence(page, `fail-first-visit-${slug(where)}`);
    throw e;
  }
}

const yesterday = () => {
  const d = addDays(today(), -1);
  return { [d]: { day: d, emotions: { Sadness: 1 }, urges: { [URGE]: 2 }, note: '', updatedAt: Date.now() - 86400e3 } };
};

export const scenarios = {
  async 'home-pick-another-before-reveal'(h) {
    const c = await content(h);
    const vi = c.rotation.findIndex((q, i) => i >= 2 && !q.special);
    const { ctx, page, errors } = await h.open(returning(h, vi));
    try {
      await h.reachHub(page);
      const q = await page.evaluate(() => window.__daily.store.quest());
      h.expect(!q.special && q.skill === c.rotation[vi].skill, `visit ${vi} should deal ${c.rotation[vi].skill}, Home deals ${q.special ?? q.skill}`);
      const start = await faceDown(h, page, q, 'arriving');
      const { card, pick, primary } = quest(page);

      await card.focus();
      await page.keyboard.press('Tab');
      h.expect(await pick.evaluate((b) => b === document.activeElement), `Tab from today's card went to ${await focused(page)}, not Pick another`);
      await page.keyboard.press('Enter');
      await route(page, 'library');
      await page.locator('.dq-library .dq-librow').first().waitFor();
      await h.shot(page, 'first-actions-chooser');
      await page.getByRole('button', { name: 'Lantern', exact: true }).click();
      await route(page, 'hub');
      await h.reachHub(page);
      const back = await faceDown(h, page, q, 'back from the chooser');
      h.expect(back.xp === start.xp && back.skills.length === start.skills.length, 'opening the chooser credited something');

      await pick.click();
      await route(page, 'library');
      const other = page.locator('.dq-librow').filter({ hasNot: page.locator('.dq-librow-n', { hasText: new RegExp(`^${c.names[q.skill]}$`) }) }).first();
      await other.click();
      await route(page, 'skill');
      const picked = await page.evaluate(() => window.__daily.route.id);
      h.expect(picked !== q.skill, 'the chooser opened the suggested skill');
      await page.getByRole('button', { name: 'Leave this skill' }).click();
      await route(page, 'hub');
      await h.reachHub(page);
      const after = await faceDown(h, page, q, 'after picking another skill');
      h.expect(after.skills.length === start.skills.length + 1 && after.skills.at(-1) === picked, `picking ${picked} credited ${JSON.stringify(after.skills)}`);
      h.expect(after.collection.includes(picked), `${picked} did not join the collection`);
      await h.shot(page, 'first-actions-home-face-down');

      await card.click({ force: true });
      await faceUp(h, page, q, 'Begin', 'revealed');
      await h.sleep(1200);
      h.expect((await page.locator('.dq-quest-note').textContent()) === c.done && (await page.locator('.dq-quest.is-done').count()), `after the reveal the done quest says "${await page.locator('.dq-quest-note').textContent()}"`);
      await card.focus();
      await page.keyboard.press('Tab');
      h.expect(await primary.evaluate((b) => b === document.activeElement), `after the reveal, Tab from the card went to ${await focused(page)}, not Begin`);
      await page.keyboard.press('Tab');
      h.expect(await pick.evaluate((b) => b === document.activeElement), `after the reveal, Tab from Begin went to ${await focused(page)}, not Pick another`);
      await h.shot(page, 'first-actions-home-face-up');

      await pick.click();
      await route(page, 'library');
      await page.getByRole('button', { name: 'Lantern', exact: true }).click();
      await route(page, 'hub');
      await faceUp(h, page, q, 'Begin', 'back from the chooser after the reveal');
      await page.reload();
      await h.reachHub(page);
      await faceUp(h, page, q, 'Begin', 'after a reload');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'home-pick-another-special-card'(h) {
    const c = await content(h);
    for (const special of ['comfort', 'free']) {
      const vi = c.rotation.findIndex((q) => q.special === special);
      h.expect(vi >= 0, `the rotation has no ${special} card`);
      const { ctx, page, errors } = await h.open(returning(h, vi));
      try {
        await h.reachHub(page);
        const q = await page.evaluate(() => window.__daily.store.quest());
        h.expect(q.special === special, `visit ${vi} should deal the ${special} card, Home deals ${q.special ?? q.skill}`);
        await faceDown(h, page, q, special);
        await quest(page).pick.click();
        await route(page, 'library');
        await page.getByRole('button', { name: 'Lantern', exact: true }).click();
        await route(page, 'hub');
        await faceDown(h, page, q, `${special}, back from the chooser`);
        await quest(page).card.click({ force: true });
        await faceUp(h, page, q, 'Open', `${special}, revealed`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  async 'home-pick-another-layout'(h) {
    const measure = (page) => page.evaluate(() => {
      const box = (el) => {
        if (!el || !el.checkVisibility({ checkVisibilityCSS: true })) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, cx: r.left + r.width / 2 };
      };
      const acts = document.querySelector('.dq-quest-acts');
      const pick = [...acts.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pick another');
      return {
        scene: box(document.querySelector('.dq-quest .dq-card-scene')),
        note: box(document.querySelector('.dq-quest-note')),
        acts: box(acts),
        pick: box(pick),
        pickQuiet: !!pick?.classList.contains('dq-btn--quiet'),
        begin: box(acts.querySelector('.dq-quest-go')),
        moved: pick ? !new DOMMatrix(getComputedStyle(pick).transform).isIdentity : false,
        vw: innerWidth,
      };
    });
    const near = (a, b, d = 1) => Math.abs(a - b) <= d;
    for (const vp of SIZES) {
      const size = `${vp.width}x${vp.height}`;
      const beside = vp.width > vp.height && vp.height <= 540;
      const { ctx, page, errors } = await boot(h, vp, {
        edit: (save) => {
          save.settings.motion = 'full';
          save.events = save.events.filter((e) => !(e.k === 'card' && e.day === save.flags.cardDay));
          save.flags.cardDay = '';
        },
      });
      try {
        await settle(page);
        const problems = await audit(page, PAGE, SKIP);
        h.expect(!problems.length, `${size}, card face-down: ${JSON.stringify(problems)}`);
        const pre = await measure(page);
        h.expect(pre.pick, `${size}: no Pick another under today's face-down card`);
        h.expect(pre.pickQuiet, `${size}: Pick another is not the quiet button it is after the reveal`);
        h.expect(pre.pick.w >= 44 && pre.pick.h >= 44, `${size}: Pick another is ${Math.round(pre.pick.w)}x${Math.round(pre.pick.h)} px`);
        h.expect(pre.pick.left >= 0 && pre.pick.right <= pre.vw, `${size}: Pick another runs off the screen`);
        if (beside) h.expect(pre.pick.left >= pre.scene.right && pre.pick.top < pre.scene.bottom, `${size}: Pick another is not beside the card`);
        else h.expect(near(pre.pick.cx, pre.scene.cx), `${size}: Pick another is not centred under the card (${Math.round(pre.pick.cx)} vs ${Math.round(pre.scene.cx)})`);
        h.expect(!pre.begin, `${size}: the card's own button shows before the reveal`);
        await h.shot(page, `first-actions-layout-face-down-${size}`);

        await page.locator('.dq-quest .dq-card').click({ force: true });
        await page.locator('.dq-quest-go').waitFor({ timeout: 8000 });
        await settle(page);
        const after = await audit(page, PAGE, SKIP);
        h.expect(!after.length, `${size}, card face-up: ${JSON.stringify(after)}`);
        const post = await measure(page);
        h.expect(post.begin && post.pick, `${size}: after the reveal the card's button or Pick another is missing`);
        h.expect(near(post.begin.h, post.pick.h, 0.5), `${size}: the two buttons differ in height (${post.begin.h} and ${post.pick.h})`);
        const oneRow = near(post.begin.top, post.pick.top, 0.5);
        if (beside) h.expect(near(post.begin.left, post.pick.left, 0.5) && near(post.begin.w, post.pick.w, 0.5) && post.begin.left >= post.scene.right, `${size}: beside the card the two buttons are not one even column`);
        else if (oneRow) h.expect(near((post.begin.left + post.pick.right) / 2, post.scene.cx), `${size}: the two buttons are not centred under the card`);
        else h.expect(near(post.begin.cx, post.scene.cx) && near(post.pick.cx, post.scene.cx), `${size}: the stacked buttons are not centred under the card`);
        h.expect(!post.moved, `${size}: Pick another was left out of place`);
        h.expect(near(pre.acts.top, post.acts.top, 0.5), `${size}: the buttons moved down with the reveal (${pre.acts.top} to ${post.acts.top})`);
        h.expect(post.note && post.note.top >= post.acts.bottom, `${size}: the reveal's note sits above the buttons`);
        await h.shot(page, `first-actions-layout-face-up-${size}`);
        h.expect(!errors.length, `${size}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  async 'home-pick-another-reduced-motion'(h) {
    const c = await content(h);
    const vi = c.rotation.findIndex((q, i) => i >= 2 && !q.special);
    const MOVES = ['transform', 'translate', 'scale', 'rotate', 'top', 'left', 'right', 'bottom'];
    for (const [mode, motion, media] of [['setting', 'reduce', 'no-preference'], ['system', 'system', 'reduce']]) {
      const seed = returning(h, vi);
      const save = JSON.parse(seed[h.SAVE]);
      save.settings = { motion };
      seed[h.SAVE] = JSON.stringify(save);
      const { ctx, page, errors } = await h.open(seed);
      try {
        await page.emulateMedia({ reducedMotion: media });
        await page.reload();
        await h.reachHub(page);
        h.expect(await page.evaluate(() => window.__daily.reduced()), `${mode}: reduced motion is not in effect`);
        const { card, pick, primary } = quest(page);
        h.expect(await pick.isVisible(), `${mode}: there is no Pick another while today's card is face-down`);
        await page.evaluate(() => {
          const seen = new Set();
          const tick = () => {
            for (const a of document.getAnimations()) if (a.effect?.target?.closest?.('.dq-quest-acts')) seen.add(a);
            window.__faRaf = requestAnimationFrame(tick);
          };
          tick();
          window.__faSeen = seen;
        });
        await card.click({ force: true });
        await primary.waitFor({ timeout: 2000 });
        await h.sleep(600);
        const anims = await page.evaluate((MOVES) => {
          cancelAnimationFrame(window.__faRaf);
          return [...window.__faSeen].map((a) => {
            const frames = a.effect.getKeyframes();
            return { on: a.effect.target.textContent.trim(), ms: a.effect.getComputedTiming().activeDuration, moves: MOVES.filter((p) => frames.some((f) => p in f && f[p] !== 'none')) };
          });
        }, MOVES);
        for (const a of anims) {
          h.expect(!a.moves.length, `${mode}: "${a.on}" moves (${a.moves.join(', ')}) with reduced motion`);
          h.expect(a.ms <= 180, `${mode}: "${a.on}" fades for ${a.ms} ms, longer than the reduced fade`);
        }
        await faceUp(h, page, await page.evaluate(() => window.__daily.store.quest()), 'Begin', `${mode}, revealed`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  async 'home-just-look-around'(h) {
    const c = await content(h);
    const vi = c.rotation.findIndex((q, i) => i >= 2 && !q.special);
    const { ctx, page, errors } = await h.open(returning(h, vi));
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    try {
      await h.reachHub(page);
      const q = await page.evaluate(() => window.__daily.store.quest());
      const start = await faceDown(h, page, q, 'arriving');
      const { card, pick, primary } = quest(page);
      const look = page.locator('.dq-quest').getByRole('button', { name: c.look, exact: true });
      const back = page.locator('.dq-quest').getByRole('button', { name: c.back, exact: true });

      h.expect(await look.isVisible(), "there is no Just look around under today's face-down card");
      await card.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      h.expect(await look.evaluate((b) => b === document.activeElement), `two Tabs from today's card went to ${await focused(page)}, not Just look around`);

      await page.keyboard.press('Enter');
      const shut = await asideHome(h, page, c, start, 'after Just look around', dialogs);
      h.expect(shut.focus === 'aside text', `after Just look around, focus is on ${shut.focus}`);
      await h.shot(page, 'first-actions-look-around');

      await page.evaluate(() => window.__daily.go({ name: 'library' }));
      await route(page, 'library');
      await page.getByRole('button', { name: 'Lantern', exact: true }).click();
      await route(page, 'hub');
      await h.reachHub(page);
      await asideHome(h, page, c, start, 'back from the chooser', dialogs);
      await page.reload();
      await h.reachHub(page);
      await asideHome(h, page, c, start, 'after a reload', dialogs);

      const b = await ctx.newPage();
      b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
      b.on('dialog', (d) => {
        dialogs.push(d.message());
        d.dismiss().catch(() => {});
      });
      await b.goto(h.server.url + '/?mute');
      await h.reachHub(b);
      await asideHome(h, b, c, start, 'tab B, opened after Just look around', dialogs);
      await b.locator('.dq-quest').getByRole('button', { name: c.back, exact: true }).click();
      await b.locator('.dq-quest:not(.is-aside) .dq-card').waitFor({ timeout: 5000 });
      h.expect((await asideView(b)).focus === 'card', `tab B: after ${c.back}, focus is on ${(await asideView(b)).focus}`);
      await faceDown(h, b, q, `tab B, after ${c.back}`);
      await page.reload();
      await h.reachHub(page);
      await faceDown(h, page, q, `tab A, after tab B brought the card back`);
      h.expect(await look.isVisible(), 'tab A: Just look around is gone after the card came back');
      await look.click();
      await asideHome(h, page, c, start, 'tab A, closed again', dialogs);
      await b.reload();
      await h.reachHub(b);
      await asideHome(h, b, c, start, 'tab B, after tab A closed it again', dialogs);
      await b.close();

      await back.click();
      await faceDown(h, page, q, `after ${c.back}`);
      await card.click({ force: true });
      await faceUp(h, page, q, 'Begin', 'revealed');
      h.expect(await look.isVisible(), 'Just look around is gone after the reveal');
      await card.focus();
      for (const [name, el] of [['Begin', primary], ['Pick another', pick], ['Just look around', look]]) {
        await page.keyboard.press('Tab');
        h.expect(await el.evaluate((x) => x === document.activeElement), `after the reveal, Tab went to ${await focused(page)}, not ${name}`);
      }
      const shown = await progress(h, page);
      await look.click();
      await asideHome(h, page, c, shown, 'after Just look around on the revealed card', dialogs);
      await page.reload();
      await h.reachHub(page);
      await asideHome(h, page, c, shown, 'revealed, closed, after a reload', dialogs);
      await back.click();
      await faceUp(h, page, q, 'Begin', `revealed, after ${c.back}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }

    const now = Date.now();
    for (const [what, flags, closed] of [
      ['closed a minute ago', { questAsideDay: dayOf(now), questAsideAt: now - 60e3 }, true],
      ['closed, then brought back', { questAsideDay: '', questAsideAt: now - 60e3 }, false],
      ['closed yesterday', { questAsideDay: addDays(dayOf(now), -1), questAsideAt: now - 30 * 3600e3 }, false],
      ['closed on a day still to come', { questAsideDay: addDays(dayOf(now), 1), questAsideAt: now + 30 * 3600e3 }, false],
      ['broken values', { questAsideDay: 'soon', questAsideAt: -5 }, false],
    ]) {
      const seed = returning(h, vi);
      const save = JSON.parse(seed[h.SAVE]);
      Object.assign(save.flags, flags);
      seed[h.SAVE] = JSON.stringify(save);
      const { ctx, page, errors } = await h.open(seed);
      try {
        await h.reachHub(page);
        const v = await asideView(page);
        h.expect(v.closed === closed && v.held === closed, `${what}: today's suggestion is ${v.closed ? 'closed' : 'open'}`);
        h.expect(closed ? JSON.stringify(v.buttons) === JSON.stringify([c.back]) : v.card && v.buttons.includes(c.look) && v.buttons.includes('Pick another'), `${what}: the quest shows ${JSON.stringify(v.buttons)}`);
        h.expect(!errors.length, `${what}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  async 'home-just-look-around-layout'(h) {
    const c = await content(h);
    const MOVES = ['transform', 'translate', 'scale', 'rotate', 'top', 'left', 'right', 'bottom'];
    const measure = (page) => page.evaluate(() => {
      const box = (el) => {
        if (!el?.checkVisibility()) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, cx: r.left + r.width / 2 };
      };
      const q = document.querySelector('.dq-quest');
      const m = document.querySelector('#dq-main').getBoundingClientRect();
      const look = q.querySelector('.dq-quest-look');
      return {
        vw: innerWidth,
        scroll: document.querySelector('.dq').scrollTop,
        main: { top: Math.max(m.top, 0), bottom: Math.min(m.bottom, innerHeight) },
        scene: box(q.querySelector('.dq-card-scene')),
        acts: box(q.querySelector('.dq-quest-acts')),
        look: box(look),
        lookPx: look ? parseFloat(getComputedStyle(look).fontSize) : 0,
        aside: box(q.querySelector('.dq-quest-aside')),
        back: box(q.querySelector('.dq-quest-back')),
      };
    });
    const watch = (page) => page.evaluate(() => {
      const seen = new Set();
      const held = new Set(document.getAnimations());
      const tick = () => {
        for (const a of document.getAnimations()) if (!held.has(a) && !(a instanceof CSSAnimation) && !(a instanceof CSSTransition) && a.effect?.getComputedTiming().iterations !== Infinity && a.effect?.target?.closest?.('.dq-quest')) seen.add(a);
        window.__faRaf = requestAnimationFrame(tick);
      };
      tick();
      window.__faSeen = seen;
    });
    const moves = (page) => page.evaluate((MOVES) => {
      cancelAnimationFrame(window.__faRaf);
      return [...window.__faSeen].map((a) => {
        const frames = a.effect.getKeyframes();
        return { on: a.effect.target.className, ms: a.effect.getComputedTiming().activeDuration, moves: MOVES.filter((p) => frames.some((f) => p in f && f[p] !== 'none')) };
      });
    }, MOVES);
    const near = (a, b, d = 1) => Math.abs(a - b) <= d;
    const RUNS = [
      ...SIZES.map((vp) => ({ vp, mode: 'motion on', motion: 'full' })),
      { vp: SIZES[0], mode: 'reduced motion in Settings', motion: 'reduce' },
      { vp: SIZES[1], mode: 'system reduced motion', motion: 'system', media: { reducedMotion: 'reduce' } },
    ];
    for (const run of RUNS) {
      const size = `${run.vp.width}x${run.vp.height}`;
      const where = `${size}, ${run.mode}`;
      const { ctx, page, errors } = await boot(h, run.vp, {
        edit: (save) => {
          save.settings.motion = run.motion;
          save.events = save.events.filter((e) => !(e.k === 'card' && e.day === save.flags.cardDay));
          save.flags.cardDay = '';
        },
        media: run.media,
      });
      try {
        await settle(page);
        h.expect(run.mode === 'motion on' ? !(await page.evaluate(() => window.__daily.reduced())) : await page.evaluate(() => window.__daily.reduced()), `${where}: reduced motion is ${run.mode === 'motion on' ? 'on' : 'off'}`);
        for (const face of ['face-down', 'face-up']) {
          if (face === 'face-up') {
            await page.locator('.dq-quest .dq-card').click({ force: true });
            await page.locator('.dq-quest-go').waitFor({ timeout: 8000 });
            await settle(page);
          }
          const pre = await measure(page);
          h.expect(pre.look, `${where}, ${face}: no Just look around`);
          h.expect(pre.look.w >= 44 && pre.look.h >= 44, `${where}, ${face}: Just look around is ${Math.round(pre.look.w)}x${Math.round(pre.look.h)} px`);
          h.expect(pre.lookPx >= 16, `${where}, ${face}: Just look around is set at ${pre.lookPx} px`);
          h.expect(pre.look.left >= 0 && pre.look.right <= pre.vw, `${where}, ${face}: Just look around runs off the screen`);
          if (run.vp.width > run.vp.height && run.vp.height <= 540) h.expect(near(pre.look.left, pre.acts.left, 6) && pre.look.left >= pre.scene.right, `${where}, ${face}: Just look around is not under the buttons beside the card`);
          else h.expect(near(pre.look.cx, pre.scene.cx), `${where}, ${face}: Just look around is not centred under the card (${Math.round(pre.look.cx)} vs ${Math.round(pre.scene.cx)})`);
          h.expect(pre.scroll === 0 && pre.look.bottom <= pre.main.bottom + 0.5, `${where}, ${face}: Just look around is below the first screen (bottom ${Math.round(pre.look.bottom)}, screen ${Math.round(pre.main.bottom)}, scrolled ${pre.scroll})`);
          h.expect(pre.look.top >= pre.acts.bottom - 0.5, `${where}, ${face}: Just look around overlaps the buttons above it`);
          const problems = await audit(page, PAGE, SKIP);
          h.expect(!problems.length, `${where}, ${face}: ${JSON.stringify(problems)}`);

          const at = await measure(page);
          await watch(page);
          await page.mouse.click(at.look.left + at.look.w / 2, at.look.top + at.look.h / 2);
          await page.locator('.dq-quest.is-aside').waitFor({ timeout: 5000 });
          await settle(page);
          const shut = await measure(page);
          h.expect(shut.aside && !shut.scene && !shut.look, `${where}, ${face}: after Just look around the quest shows ${JSON.stringify({ aside: !!shut.aside, card: !!shut.scene, look: !!shut.look })}`);
          h.expect(shut.aside.top >= shut.main.top - 0.5 && shut.aside.bottom <= shut.main.bottom + 0.5, `${where}, ${face}: the quiet line is off screen (${Math.round(shut.aside.top)} to ${Math.round(shut.aside.bottom)}, screen ${Math.round(shut.main.top)} to ${Math.round(shut.main.bottom)})`);
          h.expect(shut.back.w >= 44 && shut.back.h >= 44 && shut.back.left >= 0 && shut.back.right <= shut.vw, `${where}, ${face}: ${c.back} is ${JSON.stringify(shut.back)}`);
          h.expect(await page.locator('.dq-top .dq-safe').isVisible(), `${where}, ${face}: the Safe Zone button left the screen`);
          const closed = await audit(page, PAGE, SKIP);
          h.expect(!closed.length, `${where}, ${face}, closed: ${JSON.stringify(closed)}`);
          if (face === 'face-down') await h.shot(page, `first-actions-look-around-${size}${run.mode === 'motion on' ? '' : '-reduced'}`);

          await page.mouse.click(shut.back.left + shut.back.w / 2, shut.back.top + shut.back.h / 2);
          await page.locator('.dq-quest:not(.is-aside) .dq-card').waitFor({ timeout: 5000 });
          await settle(page);
          const open = await measure(page);
          h.expect(open.scene && open.scene.top < open.main.bottom && open.scene.bottom > open.main.top, `${where}, ${face}: the card came back off screen`);
          h.expect((await page.locator('.dq-quest .dq-card').evaluate((e) => e.classList.contains('is-open'))) === (face === 'face-up'), `${where}, ${face}: the card came back ${face === 'face-up' ? 'face-down' : 'face-up'}`);
          const anims = await moves(page);
          h.expect(anims.length, `${where}, ${face}: closing and reopening the suggestion ran no fade`);
          for (const a of anims) {
            h.expect(!a.moves.length, `${where}, ${face}: "${a.on}" moves (${a.moves.join(', ')})`);
            if (run.mode !== 'motion on') h.expect(a.ms <= 180, `${where}, ${face}: "${a.on}" fades for ${a.ms} ms with reduced motion`);
          }
        }
        h.expect(!errors.length, `${where}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  async 'first-visit-two-minutes'(h) {
    const c = await content(h);
    const RUNS = [
      ...SIZES.map((vp) => ({ vp, mode: 'motion on' })),
      { vp: SIZES[0], mode: 'reduced motion in Settings', motion: 'reduce' },
      { vp: SIZES[1], mode: 'system reduced motion', media: 'reduce' },
    ];
    for (const run of RUNS) {
      const size = `${run.vp.width}x${run.vp.height}`;
      const where = `${size}, ${run.mode}`;
      const seed = { 'dbt.app.v1': h.SEEN, ...(run.motion ? { [h.SAVE]: JSON.stringify({ v: 1, events: [], settings: { motion: run.motion } }) } : {}) };
      const { ctx, page, errors } = await h.open(seed, '?mute', run.vp);
      try {
        await welcomed(h, page, run, where);
        await h.reachHub(page);
        h.expect(!run.mode.startsWith('motion on') === (await page.evaluate(() => window.__daily.reduced())), `${where}: reduced motion is ${run.mode.startsWith('motion on') ? 'on' : 'off'}`);
        const q = await page.evaluate(() => window.__daily.store.quest());
        h.expect(!q.special && q.skill === c.rotation[0].skill, `${where}: a new player is dealt ${q.special ?? q.skill}, not ${c.rotation[0].skill}`);
        const secs = await page.locator('.dq-quest .dq-cf-min').evaluate((e) => {
          const m = /(\d+)\s*(s|min)/.exec(e.textContent);
          return m ? +m[1] * (m[2] === 'min' ? 60 : 1) : Infinity;
        });
        h.expect(secs <= 120, `${where}: the first card takes ${secs} s, more than two minutes`);
        const start = await progress(h, page);

        const home = await homeView(page);
        h.expect(home.scrollTop === 0, `${where}: Home opened scrolled down by ${home.scrollTop} px`);
        h.expect(home.safe, `${where}: the Safe Zone button is not on the first screen`);
        h.expect(home.questFirstInPage, `${where}: today's quest comes after Status in the page, so Tab and a screen reader reach Status first`);
        if (home.vw < 760) h.expect(home.quest.top < home.status.top, `${where}: on a phone, Status sits above today's card`);
        else h.expect(home.status.right <= home.quest.left + 1, `${where}: Status is no longer the column left of today's card`);
        h.expect(home.card.top >= home.main.top - 0.5 && home.card.top + Math.min(home.card.h, 200) <= home.main.bottom, `${where}: today's card is not on the first screen (card ${Math.round(home.card.top)} to ${Math.round(home.card.bottom)}, screen ${Math.round(home.main.top)} to ${Math.round(home.main.bottom)})`);
        if (run.vp.height >= 568 && run.vp.height > run.vp.width) h.expect(home.card.bottom <= home.main.bottom, `${where}: the bottom of today's card is below the first screen`);
        h.expect(!home.primary, `${where}: before the reveal the quest shows a button to start`);
        h.expect(home.look, `${where}: there is no Just look around with today's card`);
        if (run.mode === 'motion on') await h.shot(page, `first-visit-arrival-${size}`);

        await page.locator('.dq-quest .dq-card').click({ force: true });
        await page.locator('.dq-quest-go').waitFor({ timeout: 8000 });
        await settle(page);
        const shown = await homeView(page);
        h.expect(shown.go && shown.go.top >= shown.main.top - 0.5 && shown.go.bottom <= shown.main.bottom + 0.5, `${where}: after the reveal the card's Begin is off screen (${JSON.stringify(shown.go)}, screen ${Math.round(shown.main.top)} to ${Math.round(shown.main.bottom)})`);
        h.expect(shown.pick && shown.pick.bottom <= shown.main.bottom + 0.5, `${where}: after the reveal Pick another is off screen`);
        h.expect(shown.look, `${where}: Just look around is gone after the reveal`);
        h.expect(shown.primary === 'Begin', `${where}: the revealed card's button is "${shown.primary}", not a glowing Begin`);
        h.expect(shown.safe, `${where}: the Safe Zone button left the screen with the reveal`);
        if (run.mode === 'motion on') await h.shot(page, `first-visit-revealed-${size}`);
        await page.mouse.click(shown.go.left + shown.go.w / 2, shown.go.top + shown.go.h / 2);
        await route(page, 'skill');
        h.expect((await page.evaluate(() => window.__daily.route.id)) === q.skill, `${where}: Begin opened another skill`);

        let taps = 2;
        for (;;) {
          h.expect(taps <= 10, `${where}: the first visit took more than 10 taps to get back to the Lantern`);
          await page.locator('#dq-main button:visible').first().waitFor({ timeout: 8000 });
          h.expect(await page.locator('.dq-top').getByRole('button', { name: /Safe Zone/ }).isVisible(), `${where}: no Safe Zone button on skill screen ${taps - 1}`);
          const back = page.locator('#dq-main').getByRole('button', { name: 'Back to the Lantern', exact: true });
          if (await back.isVisible()) {
            await back.click();
            taps++;
            break;
          }
          const yes = page.locator('#dq-main').getByRole('button', { name: 'Yes', exact: true });
          const next = page.locator('#dq-main button:visible').filter({ hasText: /^(Begin|Next|Done)$/ }).last();
          const tap = (await yes.isVisible()) ? yes : next;
          h.expect(await tap.count(), `${where}: skill screen ${taps - 1} has no way forward: ${JSON.stringify(await page.locator('#dq-main button:visible').allTextContents())}`);
          const before = await page.locator('#dq-main').innerText();
          await tap.click();
          taps++;
          await page.waitForFunction((b) => window.__daily.route.name !== 'skill' || document.querySelector('#dq-main').innerText !== b, before, { timeout: 8000 });
        }
        await route(page, 'hub');

        await page.locator('.dq-quest').waitFor();
        await h.sleep(2500);
        h.expect(!(await page.locator('.dq-sw').count()), `${where}: a window opened on the way back to Home`);
        const after = await homeView(page);
        h.expect(after.done, `${where}: Home does not show today's quest as done`);
        h.expect(after.note === c.done, `${where}: the quest note says "${after.note}"`);
        h.expect(!after.primary, `${where}: Home still has a glowing "${after.primary}" in today's quest`);
        h.expect(after.go && after.pick, `${where}: the card's button or Pick another went away`);
        h.expect(after.look, `${where}: Just look around went away once the quest was done`);
        h.expect(after.scrollTop === 0 && after.safe, `${where}: Home came back scrolled by ${after.scrollTop} px or without the Safe Zone`);
        const end = await progress(h, page);
        h.expect(end.skills.length === start.skills.length + 1 && end.skills.at(-1) === q.skill, `${where}: the skill was credited as ${JSON.stringify(end.skills)}`);
        h.expect(end.xp > start.xp && end.cards.length === 1, `${where}: XP ${start.xp} to ${end.xp}, ${end.cards.length} card events`);
        if (run.mode === 'motion on') await h.shot(page, `first-visit-done-${size}`);
        h.expect(!errors.length, `${where}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  async 'first-visit-late-mount'(h) {
    const run = { vp: SIZES[3], mode: 'motion on' };
    const where = `${run.vp.width}x${run.vp.height}, companion held 9 s`;
    const held = [];
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', run.vp, holdDaily(h, held));
    try {
      await welcomed(h, page, run, where);
      h.expect(held.length === 1 && held[0] >= 9000, `${where}: the companion module was held ${JSON.stringify(held)} ms`);
      await h.reachHub(page);
      h.expect(await page.evaluate(() => window.__daily.route.name === 'hub' && !document.querySelector('.dq-sw')), `${where}: Home did not settle after the welcome`);
      h.expect(!errors.length, `${where}: ${errors.join('\n')}`);
    } finally {
      await ctx.close();
    }
  },

  async 'first-visit-old-save'(h) {
    const c = await content(h);
    const vi = c.rotation.findIndex((q, i) => i >= 2 && !q.special);
    const old = JSON.parse(returning(h, vi)[h.SAVE]);
    const seed = { [h.SAVE]: JSON.stringify({ v: 1, events: old.events }), 'dbt.app.v1': h.SEEN };
    for (const vp of [SIZES[1], SIZES[2]]) {
      const size = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open(seed, '?mute', vp);
      try {
        await h.reachHub(page);
        const q = await page.evaluate(() => window.__daily.store.quest());
        const start = await faceDown(h, page, q, size);
        const home = await homeView(page);
        h.expect(home.questFirstInPage && !home.done && home.note === '', `${size}: Home before any skill: ${JSON.stringify({ first: home.questFirstInPage, done: home.done, note: home.note })}`);
        h.expect(home.look && !(await page.locator('.dq-quest.is-aside').count()), `${size}: an old save opens without Just look around, or with today's suggestion closed`);
        await page.locator('.dq-quest .dq-card').click({ force: true });
        await faceUp(h, page, q, 'Begin', size);
        await settle(page);
        const shown = await homeView(page);
        h.expect(shown.go && shown.go.top >= shown.main.top - 0.5 && shown.go.bottom <= shown.main.bottom + 0.5, `${size}: after the reveal Begin is off screen`);
        await page.mouse.click(shown.go.left + shown.go.w / 2, shown.go.top + shown.go.h / 2);
        await route(page, 'skill');
        await page.getByRole('button', { name: 'Leave this skill' }).click();
        await route(page, 'hub');
        await page.locator('.dq-quest.is-done').waitFor({ timeout: 5000 });
        const after = await homeView(page);
        h.expect(after.note === c.done && !after.primary, `${size}: after leaving the skill Home shows ${JSON.stringify({ note: after.note, primary: after.primary })}`);
        const end = await progress(h, page);
        h.expect(end.skills.length === start.skills.length + 1 && end.xp > start.xp, `${size}: leaving on screen one did not credit the skill (${start.xp} to ${end.xp} XP)`);
        await page.reload();
        await h.reachHub(page);
        h.expect((await homeView(page)).done, `${size}: after a reload Home forgot the quest is done`);
        if (vp === SIZES[1]) await h.shot(page, 'first-visit-old-save-done');
        h.expect(!errors.length, `${size}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
  },

  async 'diary-remove-rated-row'(h) {
    const { ctx, page, errors } = await h.open(returning(h, 3, { diary: yesterday() }));
    try {
      await openDiary(h, page);
      for (const [row, val, before, other] of [[URGE, 3, '2', 'Joy'], ['Sadness', 4, '1', 'Anger']]) {
        const kind = kindOf(row);
        await rating(page, row, val).click();
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        h.expect((await stored(h, page)).diary[today()]?.[kind]?.[row] === val, `${row}: Save did not keep ${val}`);

        await removeRow(page, row);
        let s = await stored(h, page);
        h.expect(!s.settings[listOf(row)].includes(row), `${row}: still in settings.${listOf(row)} after Remove`);
        await offCard(h, page, row, `${row}, right after Remove`);
        h.expect(await page.evaluate(() => !!document.activeElement?.closest('.dq-rowsed')), `${row}: after Remove, focus went to ${await focused(page)}, out of the rows editor`);
        h.expect(s.diary[today()][kind][row] === val, `${row}: Remove erased today's stored ${val}`);
        const past = await history(page, row);
        h.expect(past.week[5] === before, `${row}: the past seven days lost yesterday's ${before} (${JSON.stringify(past.week)})`);
        h.expect(past.exported[5] === before, `${row}: the export lost yesterday's ${before} (${JSON.stringify(past.exported)})`);
        await h.shot(page, `first-actions-diary-removed-${kind}`);

        await rating(page, other, 2).click();
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        s = await stored(h, page);
        h.expect(s.diary[today()][kind][row] === val && s.diary[today()].emotions[other] === 2, `${row}: saving after the removal changed today's entry: ${JSON.stringify(s.diary[today()])}`);
        h.expect(!s.settings[listOf(row)].includes(row), `${row}: saving brought the row back`);

        await page.reload();
        await openDiary(h, page);
        await offCard(h, page, row, `${row}, after a reload`);

        await addRow(page, row);
        await rowOnCard(page, row).waitFor({ timeout: 5000 });
        h.expect((await rating(page, row, val).getAttribute('aria-checked')) === 'true', `${row}: added again, today's ${val} is not checked`);
        s = await stored(h, page);
        h.expect(s.settings[listOf(row)].includes(row) && s.diary[today()][kind][row] === val, `${row}: adding it again lost something: ${JSON.stringify({ rows: s.settings[listOf(row)], day: s.diary[today()] })}`);
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'diary-remove-row-two-tabs'(h) {
    const { ctx, page: a, errors } = await h.open(returning(h, 3, { diary: yesterday() }));
    try {
      await h.reachHub(a);
      const b = await ctx.newPage();
      b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
      await b.goto(h.server.url + '/?mute');
      await openDiary(h, a);
      await openDiary(h, b);

      await rating(a, URGE, 3).click();
      await a.getByRole('button', { name: 'Save', exact: true }).click();
      await b.locator(`.dq-today [role=radio][aria-label="${URGE}: 3"][aria-checked=true]`).waitFor({ timeout: 5000 });
      await removeRow(a, URGE);
      await offCard(h, b, URGE, 'tab B, after tab A removed the urge row');
      const edB = await rowsEditor(b);
      h.expect(!(await edB.getByRole('button', { name: `Remove ${URGE}`, exact: true }).count()), "tab B's rows editor still offers the removed urge row");

      await rating(b, 'Sadness', 2).click();
      await b.getByRole('button', { name: 'Save', exact: true }).click();
      let s = await stored(h, b);
      h.expect(!s.settings.urgeRows.includes(URGE), `tab B's save brought the urge row back: ${JSON.stringify(s.settings.urgeRows)}`);
      h.expect(s.diary[today()].urges[URGE] === 3 && s.diary[today()].emotions.Sadness === 2, `tab B's save changed today's entry: ${JSON.stringify(s.diary[today()])}`);
      await offCard(h, a, URGE, "tab A, after tab B's save");
      await b.reload();
      await openDiary(h, b);
      await offCard(h, b, URGE, 'tab B, after a reload');

      await rating(b, 'Joy', 4).click();
      await removeRow(a, 'Joy');
      await offCard(h, b, 'Joy', 'tab B, after tab A removed Joy');
      await h.sleep(1200);
      s = await stored(h, a);
      h.expect(!s.settings.emotionRows.includes('Joy'), `Joy came back: ${JSON.stringify(s.settings.emotionRows)}`);
      h.expect(s.diary[today()].emotions.Joy === 4, `tab B's rating of Joy was lost: ${JSON.stringify(s.diary[today()])}`);

      await addRow(a, 'Joy');
      for (const [p, tab] of [[a, 'A'], [b, 'B']]) {
        await rowOnCard(p, 'Joy').waitFor({ timeout: 5000 });
        h.expect((await rating(p, 'Joy', 4).getAttribute('aria-checked')) === 'true', `tab ${tab}: Joy came back without its 4`);
      }
      await h.shot(b, 'first-actions-diary-two-tabs');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
