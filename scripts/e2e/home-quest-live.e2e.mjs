import fs from 'node:fs';
import path from 'node:path';
import { asideView, content, progress, returning, route } from './first-actions.e2e.mjs';

const DAY = 86400e3;
const vis = (vi) => (c) => c.rotation.findIndex((q, i) => i >= vi && !q.special);
const live = (page) => page.evaluate(() => window.__live === 1);
const mark = (page) => page.evaluate(() => (window.__live = 1));
async function second(h, ctx, errors) {
  const b = await ctx.newPage();
  b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
  await b.goto(h.server.url + '/?mute');
  await h.reachHub(b);
  return b;
}
const questOf = (page) =>
  page.evaluate(() => {
    const q = document.querySelector('.dq-quest');
    const go = q.querySelector('.dq-quest-go');
    return {
      open: q.querySelector('.dq-card').classList.contains('is-open'),
      done: q.classList.contains('is-done'),
      note: q.querySelector('.dq-quest-note').textContent.trim(),
      go: go.checkVisibility() ? (go.classList.contains('dq-btn--primary') ? 'primary' : 'quiet') : null,
    };
  });
const front = async (page) => {
  await page.bringToFront();
  return page;
};
const tapLook = async (page) => (await front(page)).locator('.dq-quest-look').click();
const tapBack = async (page) => (await front(page)).locator('.dq-quest-back').click();
const closedIn = (page) => page.locator('.dq-quest.is-aside').waitFor({ timeout: 5000 });
const openIn = (page) => page.locator('.dq-quest:not(.is-aside) .dq-card').waitFor({ timeout: 5000 });

async function crystal(h, page, file) {
  await h.openSettings(page);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Save Crystal' }).click()]);
  await dl.saveAs(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function finish(h, page, how, where) {
  if (how === 'leave') {
    await page.getByRole('button', { name: 'Leave this skill' }).click();
    return route(page, 'hub');
  }
  for (let taps = 0; ; taps++) {
    h.expect(taps <= 14, `${where}: the skill never offered its way back to the Lantern`);
    await page.locator('#dq-main button:visible').first().waitFor({ timeout: 8000 });
    const back = page.locator('#dq-main').getByRole('button', { name: 'Back to the Lantern', exact: true });
    if (await back.isVisible()) {
      await back.click();
      return route(page, 'hub');
    }
    const quiet = page.locator('#dq-main').getByRole('button', { name: 'Not this time', exact: true });
    const yes = page.locator('#dq-main').getByRole('button', { name: 'Yes', exact: true });
    const next = page.locator('#dq-main button:visible').filter({ hasText: /^(Begin|Next|Done|Start)$/ }).last();
    const tap = how === 'quiet' && (await quiet.isVisible()) ? quiet : (await yes.isVisible()) ? yes : next;
    h.expect(await tap.count(), `${where}: no way forward on ${JSON.stringify(await page.locator('#dq-main button:visible').allTextContents())}`);
    const before = await page.locator('#dq-main').innerText();
    await tap.click();
    await page.waitForFunction((b) => window.__daily.route.name !== 'skill' || document.querySelector('#dq-main').innerText !== b, before, { timeout: 8000 });
  }
}

export const scenarios = {
  async 'home-quest-live-tabs'(h) {
    const c = await content(h);
    const { ctx, page: a, errors } = await h.open(returning(h, vis(2)(c)));
    try {
      await h.reachHub(a);
      const b = await second(h, ctx, errors);
      await mark(a);
      await mark(b);
      const held = await b.evaluate(() => window.__daily.store.listeners.size);

      await (await front(b)).locator('.dq-quest').getByRole('button', { name: 'Pick another', exact: true }).focus();
      await tapLook(a);
      await closedIn(b);
      let v = await asideView(b);
      h.expect(v.held && !v.card && v.text === c.aside && v.focus === 'aside text', `B after A set the card aside: ${JSON.stringify(v)}`);

      await tapBack(b);
      await openIn(a);
      v = await asideView(a);
      h.expect(!v.held && v.card && v.focus === 'card', `A after B brought the card back: ${JSON.stringify(v)}`);

      await (await front(a)).locator('.dq-tile').first().focus();
      await tapLook(b);
      await closedIn(a);
      h.expect(await a.evaluate(() => document.activeElement?.classList.contains('dq-tile')), `A's focus left its tile when B set the card aside: ${await a.evaluate(() => document.activeElement?.className)}`);
      await tapBack(b);
      await openIn(a);

      await (await front(a)).locator('.dq-quest .dq-card').click({ force: true });
      await a.locator('.dq-quest-go').waitFor({ timeout: 8000 });
      await b.locator('.dq-quest .dq-card.is-open').waitFor({ timeout: 5000 });
      await b.locator('.dq-quest-go').waitFor({ timeout: 5000 });
      h.expect((await progress(h, b)).cards.length === 1, 'the reveal was stored more than once');

      await (await front(b)).locator('.dq-quest-go').click();
      await route(b, 'skill');
      await a.locator('.dq-quest.is-done').waitFor({ timeout: 5000 });
      const qa = await questOf(a);
      h.expect(qa.note === c.done && qa.go === 'quiet' && qa.open, `A after B practised: ${JSON.stringify(qa)}`);
      h.expect((await live(a)) && (await live(b)), 'a tab reloaded');

      await finish(h, await front(b), 'leave', 'B');
      for (let i = 0; i < 3; i++) {
        await b.locator('.dq-tile', { hasText: 'Diary card' }).click();
        await route(b, 'diary');
        await b.getByRole('button', { name: 'Lantern', exact: true }).click();
        await route(b, 'hub');
      }
      const now = await b.evaluate(() => window.__daily.store.listeners.size);
      h.expect(now === held, `B's store has ${now} listeners after leaving and coming back to Home, ${held} before`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'home-quest-done-reveal'(h) {
    const c = await content(h);
    const { ctx, page, errors } = await h.open(returning(h, vis(2)(c)));
    try {
      await h.reachHub(page);
      const b = await second(h, ctx, errors);
      const q = await page.evaluate(() => window.__daily.store.quest());
      h.expect(!(await progress(h, page)).collection.includes(q.skill), `${q.skill} is already collected, so the reveal can't acquire it`);

      await (await front(page)).locator('.dq-quest').getByRole('button', { name: 'Pick another', exact: true }).click();
      await route(page, 'library');
      await page.locator('.dq-librow').filter({ hasNot: page.locator('.dq-librow-n', { hasText: new RegExp(`^${c.names[q.skill]}$`) }) }).first().click();
      await route(page, 'skill');
      await finish(h, page, 'leave', 'the other skill');
      await h.reachHub(page);
      let s = await questOf(page);
      h.expect(s.done && s.note === c.done && !s.open, `Home after another skill: ${JSON.stringify(s)}`);

      await (await front(page)).locator('.dq-quest .dq-card').click({ force: true });
      await page.locator('.dq-quest-go').waitFor({ timeout: 8000 });
      await h.sleep(1500);
      s = await questOf(page);
      h.expect(s.done && s.open && s.note === c.done && s.go === 'quiet', `after the reveal on a done day: ${JSON.stringify(s)}`);
      const p = await progress(h, page);
      h.expect(p.collection.includes(q.skill) && p.cards.length === 1, `the reveal did not credit ${q.skill} once: ${JSON.stringify({ cards: p.cards.length })}`);

      await b.locator('.dq-quest.is-done .dq-card.is-open').waitFor({ timeout: 5000 });
      s = await questOf(b);
      h.expect(s.done && s.note === c.done && s.go === 'quiet', `B after A's reveal: ${JSON.stringify(s)}`);
      await (await front(page)).locator('.dq-tile', { hasText: 'Diary card' }).click();
      await route(page, 'diary');
      await page.getByRole('button', { name: 'Lantern', exact: true }).click();
      await route(page, 'hub');
      s = await questOf(page);
      h.expect(s.done && s.open && s.note === c.done, `revisiting Home: ${JSON.stringify(s)}`);
      await page.reload();
      await h.reachHub(page);
      s = await questOf(page);
      h.expect(s.done && s.open && s.note === c.done && s.go === 'quiet', `after a reload: ${JSON.stringify(s)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'home-quest-aside-clock'(h) {
    const c = await content(h);
    const T = Date.now();
    const { ctx, page: a, errors } = await h.open(returning(h, vis(2)(c)));
    try {
      await h.reachHub(a);
      const today = await a.evaluate(() => window.__daily.store.today());
      const flags = async (page) => (await h.ls(page, h.SAVE).then(JSON.parse)).flags;

      await ctx.clock.setFixedTime(new Date(T + DAY));
      await a.reload();
      await h.reachHub(a);
      const ahead = await a.evaluate(() => window.__daily.store.today());
      h.expect(ahead !== today, 'the clock did not move to the next day');
      await tapLook(a);
      await closedIn(a);
      await tapBack(a);
      await openIn(a);
      const late = await flags(a);

      await ctx.clock.setFixedTime(new Date(T));
      await a.reload();
      await h.reachHub(a);
      let v = await asideView(a);
      h.expect(!v.closed && !v.held && v.card, `back on today the card is not offered: ${JSON.stringify(v)}`);
      await tapLook(a);
      await closedIn(a);
      v = await asideView(a);
      h.expect(v.held, `after Just look around today the store does not hold the card as set aside: ${JSON.stringify(v)}`);
      await a.reload();
      await h.reachHub(a);
      v = await asideView(a);
      h.expect(v.closed && v.held, `after a reload today's card came back: ${JSON.stringify(v)}`);
      const set = await flags(a);
      h.expect(v.stamps && set.questAsideDay === today && late.questAsideDay === '' && late.questAsideAt >= T + DAY && set.questAsideAt > late.questAsideAt, `stored a day ahead ${JSON.stringify(late)}, then today ${JSON.stringify(set)}`);

      const b = await second(h, ctx, errors);
      await mark(a);
      await mark(b);
      h.expect((await asideView(b)).closed, 'the second tab offers the card set aside in the first');
      await tapBack(b);
      await openIn(a);
      h.expect(!(await asideView(a)).held && !(await asideView(b)).held, 'the tabs disagree after Show today\'s card');
      await tapLook(a);
      await closedIn(b);
      h.expect((await asideView(a)).held && (await asideView(b)).held, 'the tabs disagree after Just look around');
      h.expect((await live(a)) && (await live(b)), 'a tab reloaded');

      const file = path.join(h.out, 'home-quest-aside-crystal.json');
      const x = await crystal(h, await front(a), file);
      h.expect(x.flags?.questAsideDay === today && x.flags?.questAsideAt > T, `the Save Crystal holds ${JSON.stringify({ day: x.flags?.questAsideDay, at: x.flags?.questAsideAt })}`);
      const fresh = await h.open({ 'dbt.app.v1': h.SEEN });
      try {
        await fresh.ctx.clock.setFixedTime(new Date(T));
        await fresh.page.reload();
        await h.openSettings(fresh.page);
        await fresh.page.locator('input[type=file]').setInputFiles(file);
        await fresh.page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
        await fresh.page.getByText(/^Restored/).first().waitFor({ timeout: 20000 });
        await fresh.page.getByRole('button', { name: 'Lantern', exact: true }).click();
        await route(fresh.page, 'hub');
        await closedIn(fresh.page);
        h.expect((await asideView(fresh.page)).held, 'after the restore the store does not hold the card as set aside');
        h.expect(!fresh.errors.length, fresh.errors.join('\n'));
      } finally {
        await fresh.ctx.close();
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'home-quest-aside-stamp'(h) {
    const c = await content(h);
    const big = (t) => BigInt(typeof t === 'number' ? Math.floor(t) : t);
    const flagsOf = (page) => page.evaluate(() => ({ day: window.__daily.store.state.flags.questAsideDay, at: window.__daily.store.state.flags.questAsideAt }));
    const fails = [];
    for (const [i, at] of [8.64e15, 8.64e15 - 1, 2 ** 53 - 1, 2 ** 53, Number.MAX_VALUE, '9'.repeat(400), 8.64e15 - 1e3].entries()) {
      const where = `a Save Crystal with questAsideAt ${typeof at === 'string' ? `of ${at.length} digits` : at}`;
      const { ctx, page: a, errors } = await h.open(returning(h, vis(2)(c)));
      try {
        await h.reachHub(a);
        const b = await second(h, ctx, errors);
        const today = await a.evaluate(() => window.__daily.store.today());
        const file = path.join(h.out, `home-quest-aside-stamp-${i}.json`);
        const x = await crystal(h, await front(a), file);
        fs.writeFileSync(file, JSON.stringify({ ...x, flags: { ...x.flags, questAsideDay: today, questAsideAt: at } }));
        await a.locator('input[type=file]').setInputFiles(file);
        await a.getByRole('button', { name: 'Restore this Save Crystal' }).click();
        await a.getByText(/^Restored/).first().waitFor({ timeout: 20000 });
        await a.getByRole('button', { name: 'Lantern', exact: true }).click();
        await route(a, 'hub');
        await closedIn(a);
        await closedIn(b);
        await mark(a);
        await mark(b);
        for (const [tab, other, tap, held] of [
          [a, b, tapBack, false],
          [b, a, tapLook, true],
          [b, a, tapBack, false],
          [a, b, tapLook, true],
        ]) {
          const what = `${where}: after ${held ? c.look : c.back} in tab ${tab === a ? 'A' : 'B'}`;
          const before = await flagsOf(tab);
          await tap(tab);
          const followed = await other.waitForFunction((held) => window.__daily.store.questAside() === held && document.querySelector('.dq-quest').classList.contains('is-aside') === held, held, { timeout: 5000 }).then(() => true, () => false);
          await h.sleep(600);
          const both = [await asideView(a), await asideView(b)].map((v) => ({ held: v.held, closed: v.closed }));
          h.expect(followed && both.every((v) => v.held === held && v.closed === held), `${what} the tabs show ${JSON.stringify(both)}`);
          const [fa, fb] = [await flagsOf(a), await flagsOf(b)];
          h.expect(JSON.stringify(fa) === JSON.stringify(fb), `${what} the tabs hold ${JSON.stringify(fa)} and ${JSON.stringify(fb)}`);
          h.expect(big(fa.at) > big(before.at), `${what} the stamp went from ${before.at} to ${fa.at}`);
        }
        h.expect((await live(a)) && (await live(b)), `${where}: a tab reloaded`);
        h.expect(!errors.length, `${where}: ${errors.join('\n')}`);
      } catch (e) {
        fails.push(e.message);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!fails.length, fails.join('\n'));
  },

  async 'home-calm-after-skill'(h) {
    const c = await content(h);
    const vi = vis(8)(c);
    for (const [how, open] of [['end', 'wise-mind'], ['quiet', 'cool-air'], ['leave', 'card']]) {
      const where = how === 'end' ? "the skill's end" : how === 'quiet' ? 'Not this time' : 'leaving on screen one';
      const seed = returning(h, vi);
      const save = JSON.parse(seed[h.SAVE]);
      save.flags.rankSeen = 0;
      seed[h.SAVE] = JSON.stringify(save);
      const { ctx, page, errors } = await h.open(seed);
      try {
        await h.reachHub(page);
        const before = await page.evaluate(() => ({ xp: window.__daily.store.derived().xp, rank: window.__daily.store.derived().rank }));
        h.expect(before.xp === 90 && before.rank === 0, `${where}: the player starts at ${JSON.stringify(before)}, not 90 XP and rank E`);
        if (open === 'card') {
          await page.locator('.dq-quest .dq-card').click({ force: true });
          await page.locator('.dq-quest-go').click();
        } else {
          await page.locator('.dq-quest').getByRole('button', { name: 'Pick another', exact: true }).click();
          await route(page, 'library');
          await page.locator('.dq-librow', { has: page.locator('.dq-librow-n', { hasText: new RegExp(`^${c.names[open]}$`) }) }).click();
        }
        await route(page, 'skill');
        await finish(h, page, how, where);

        await page.locator('.dq-quest').waitFor();
        await h.sleep(2500);
        const home = await page.evaluate(() => ({
          window: !!document.querySelector('.dq-sw'),
          inert: document.querySelector('#dq-main').inert,
          xp: window.__daily.store.derived().xp,
          rank: window.__daily.store.derived().rank,
          seen: window.__daily.store.state.flags.rankSeen,
          letter: document.querySelector('.dq-rank-letter')?.textContent ?? null,
        }));
        h.expect(!home.window && !home.inert, `${where}: a window opened over Home after the skill`);
        h.expect(home.xp === 110 && home.rank === 1 && home.letter === 'D', `${where}: Home after the skill shows ${JSON.stringify(home)}`);
        h.expect(home.seen === 0, `${where}: the rank-up was used up without being shown (rankSeen ${home.seen})`);
        await h.shot(page, `home-calm-after-skill-${how}`);

        await page.locator('.dq-tile', { hasText: 'Diary card' }).click();
        await route(page, 'diary');
        await page.getByRole('button', { name: 'Lantern', exact: true }).click();
        await route(page, 'hub');
        await page.locator('.dq-sw').waitFor({ timeout: 8000 });
        for (let i = 0; (await page.locator('.dq-sw').count()) && i < 8; i++) {
          // a window whose scrim is off is closing: tap it no more, wait until it is gone, so no tap lands on Home
          if (!(await page.locator('.dq-scrim.is-on').count())) {
            await page.waitForFunction(() => !document.querySelector('.dq-sw') || !!document.querySelector('.dq-scrim.is-on'), null, { timeout: 5000 });
            continue;
          }
          await page.locator('.dq-sw').first().click({ force: true }).catch(() => {});
          await h.sleep(500);
        }
        h.expect((await page.evaluate(() => window.__daily.store.state.flags.rankSeen)) === 1, `${where}: the rank-up was not marked as seen after it showed`);
        h.expect((await progress(h, page)).xp === 110, `${where}: XP changed after the rank-up`);
        h.expect(!errors.length, `${where}: ${errors.join('\n')}`);
      } finally {
        await ctx.close();
      }
    }
  },
};
