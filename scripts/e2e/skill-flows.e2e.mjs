// How each skill's flows finish, on a seeded returning save at 390x844. skill-check makes every timer and every screen
// with a way out carry a step id; these open each one in its real skill (from Home, past the intro) and play it.
// skill-timers: every timer offers "+N s" once it runs (+15 s up to 30 s, +30 s above), and it adds N seconds both
// while running and after Done, on the same screen, with Next still there and no extra credit. Cold water is the one
// exception (principle 11: about 30 s), so its timer has no "+N s".
// skill-exits: on a screen that offers another skill or the Safe Zone, the first button finishes this skill on its own
// end screen (or opens the Safe Zone when that leads), crediting this skill once and no other. After a "Higher" answer
// the first button is people to talk to, which opens the Safe Zone at its talk screen.
// skill-practise-again: a full end screen offers "Practise again", which opens the same skill fresh (one credit, like
// any opening) at the part the player opened; a quiet "not this time" end doesn't offer it.
// skill-answers-rotate: what the player typed or picked stays through turning the phone sideways and back.
import { credits, returning, toHub, walk } from './skill-check.e2e.mjs';

const PHONE = { width: 390, height: 844 };
const SIDEWAYS = { width: 844, height: 390 };

const skillEvents = async (h, page) => (JSON.parse((await h.ls(page, h.SAVE)) ?? 'null')?.events ?? []).filter((e) => e.k === 'skill');

/** Opens a skill at one of its steps the way a "skill:<id>@<step>" link does: past its intro, straight to that step. */
async function openAt(page, id, step) {
  await page.evaluate(({ id, step }) => window.__daily.go({ name: 'skill', id, entry: step }), { id, step });
  await pastIntro(page);
}

/** Taps through a skill's intro, if it has one, to the step it leads to. */
async function pastIntro(page) {
  await page.locator('.dq-skill .dq-step-body > *').first().waitFor({ timeout: 10000 });
  if (await page.locator('.dq-step-body .dq-intro').count()) {
    await page.locator('.dq-step-body .dq-actions .dq-btn--primary').first().click();
    await page.waitForFunction(() => !document.querySelector('.dq-step-body .dq-intro'), null, { timeout: 10000 });
  }
}

const secsOf = (t) => (/^\d+(:\d\d)?$/.test(t) ? t.split(':').reduce((n, part) => n * 60 + Number(part), 0) : NaN);
/** What a countdown shows with this many seconds left: the whole seconds, rounded up, as m:ss from a minute up. */
const countdown = (left) => {
  const c = Math.ceil(left);
  return c >= 60 ? `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}` : String(c);
};

export const scenarios = {
  async 'skill-timers'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await page.clock.install();
    await page.reload();
    await h.reachHub(page);
    const timers = await page.evaluate(async () =>
      (await import('/src/content/dbt.ts')).SKILLS.flatMap((sk) =>
        sk.steps.flatMap((st, i) => {
          if (st.kind !== 'timer') return [];
          const text = typeof st.text === 'function' ? st.text({}) : st.text;
          return [{ skill: sk.id, step: st.id, where: `${sk.id} step ${i + 1}`, dim: !!st.dim, cold: /\bcold water\b/i.test(`${text} ${st.small ?? ''}`) }];
        }),
      ),
    );
    const bad = [];
    for (const t of timers) {
      const { where } = t;
      if (!t.step) {
        bad.push(`${where}: no step id`);
        continue;
      }
      try {
        const before = await credits(h, page, t.skill);
        // The page clock stands still while a timer is checked and only moves when told to, so the countdown can't
        // move between a tap and a reading however slow the machine is. Every reading lands half a second into a
        // second, away from the edge where the display ticks over. (The page's time runs until the pause lands, so it
        // pauses a second ahead.)
        await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
        await openAt(page, t.skill, t.step);
        const timer = page.locator('.dq-step-body .dq-timer');
        await timer.waitFor({ timeout: 5000 });
        const num = page.locator('.dq-step-body .dq-timer-num');
        const shows = async () => (await num.textContent()).trim();
        // no time has passed on this screen yet, so it shows its full length
        const len = secsOf(await shows());
        const start = timer.locator('.dq-actions .dq-btn--primary', { hasText: /start/i });
        if (await start.count()) await start.first().click();
        const more = timer.locator('button', { hasText: /^\+\d+ s$/ });
        const next = page.locator('.dq-step-body > .dq-actions > button', { hasText: /^Next$/ });
        if (t.cold) {
          if (await more.count()) bad.push(`${where}: cold water offers "${await more.first().textContent()}"; it stays about 30 s`);
        } else if (!(await more.count())) {
          bad.push(`${where}: the running timer has no "+N s"`);
        } else {
          const n = Number(/\d+/.exec(await more.first().textContent())[0]);
          if (n !== (len <= 30 ? 15 : 30)) bad.push(`${where}: its ${len} s timer offers "+${n} s"; up to 30 s it's +15 s, above that +30 s`);
          await page.clock.runFor(2500);
          const ran = await shows();
          if (ran !== countdown(len - 2.5)) bad.push(`${where}: 2.5 s into its ${len} s the timer shows ${ran}, not ${countdown(len - 2.5)}`);
          await more.first().click();
          await page.clock.runFor(1000);
          const now = await shows();
          if (now !== countdown(len + n - 3.5)) bad.push(`${where}: "+${n} s" while running shows ${now} a second later, not ${countdown(len + n - 3.5)}`);
          // well past Done, so a tap that only added to the time already used up would show far less than N
          await page.clock.fastForward((len + n - 3.5 + 5) * 1000);
          const done = (await shows()) === 'Done';
          if (!done) bad.push(`${where}: the timer shows ${await shows()}, not Done, 5 s after its ${len + n} s`);
          else {
            await more.first().click();
            await page.clock.runFor(500);
            const again = await shows();
            if (again !== countdown(n - 0.5)) bad.push(`${where}: "+${n} s" after Done shows ${again} half a second later, not ${countdown(n - 0.5)}`);
            if (t.dim && !(await page.locator('.dq-skill.is-dim').count())) bad.push(`${where}: running again after Done, the screen didn't dim the way it does at the start`);
          }
          if (!(await next.isVisible())) bad.push(`${where}: Next is gone after "+${n} s"`);
          if (!(await timer.count())) bad.push(`${where}: "+${n} s" left the timer screen`);
        }
        await page.clock.resume();
        await toHub(h, page);
        const now = await credits(h, page, t.skill);
        if (now - before !== 1) bad.push(`${where}: opening it and using the timer credited it ${now - before} times, not once`);
      } catch (e) {
        bad.push(`${where}: the check could not finish: ${String(e?.message ?? e).split('\n')[0]}`);
        await page.clock.resume();
        await page.goto(h.server.url + '/?mute');
        await h.reachHub(page);
      }
    }
    h.expect(!errors.length, errors.join('\n'));
    h.expect(!bad.length, bad.join('\n'));
    await ctx.close();
    return { timers: timers.length, cold: timers.filter((t) => t.cold).map((t) => t.where) };
  },

  async 'skill-exits'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    const exits = await page.evaluate(async () =>
      (await import('/src/content/dbt.ts')).SKILLS.flatMap((sk) =>
        sk.steps.flatMap((st, i) => {
          if (st.kind !== 'say' || !st.options?.some((o) => /^(skill:|safe)/.test(o.go ?? ''))) return [];
          const go = st.options[0].go ?? '';
          // the screen a "Higher" answer leads to
          const higher = sk.steps.some((c) => c.kind === 'choice' && (typeof c.options === 'function' ? c.options({}) : c.options).some((o) => o.label === 'Higher' && o.go === st.id));
          return [{ skill: sk.id, sl: sk.sl, step: st.id, where: `${sk.id} step ${i + 1} (${st.id})`, first: st.options[0].label, safe: /^safe/.test(go), talk: go === 'safe:people', higher }];
        }),
      ),
    );
    const bad = new Set();
    for (const x of exits) {
      // DESIGN.md: a "Higher" answer brings "Talk to someone now" to the top
      if (x.higher && !x.talk) bad.add(`${x.where}: after a "Higher" answer it leads with "${x.first}", not people to talk to`);
      try {
        await toHub(h, page);
        const before = await skillEvents(h, page);
        await openAt(page, x.skill, x.step);
        if (x.safe) {
          await page.locator('.dq-step-body .dq-actions button').first().click();
          const safe = await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'safe', null, { timeout: 5000 }).then(() => true, () => false);
          if (!safe) bad.add(`${x.where}: "${x.first}" did not open the Safe Zone`);
          else if (x.talk && !(await page.locator('.dq-sz-t', { hasText: /^Talk to someone now$/ }).waitFor({ timeout: 5000 }).then(() => true, () => false))) bad.add(`${x.where}: "${x.first}" opened the Safe Zone but not its talk screen`);
        } else {
          const found = new Set();
          const walked = await walk(h, page, { id: x.skill }, found);
          for (const f of found) bad.add(`${x.where}: ${f}`);
          if (walked.end === 'end') {
            const name = (await page.locator('.dq-step-body .dq-intro--end .dq-intro-name').textContent())?.trim();
            // the screen sets curly apostrophes
            if (name?.replace(/’/g, "'") !== x.sl) bad.add(`${x.where}: ended on the end screen of "${name}", not "${x.sl}"`);
          }
        }
        await toHub(h, page);
        const after = await skillEvents(h, page);
        const added = after.filter((e) => !before.some((b) => b.id === e.id)).map((e) => e.skill);
        if (added.length !== 1 || added[0] !== x.skill) bad.add(`${x.where}: credited ${JSON.stringify(added)}, not ${x.skill} once`);
      } catch (e) {
        bad.add(`${x.where}: the check could not finish: ${String(e?.message ?? e).split('\n')[0]}`);
        await page.goto(h.server.url + '/?mute');
        await h.reachHub(page);
      }
    }
    h.expect(!errors.length, errors.join('\n'));
    h.expect(!bad.size, [...bad].join('\n'));
    await ctx.close();
    return { exits: exits.map((x) => `${x.where}: ${x.first}`) };
  },

  async 'skill-practise-again'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    const feedback = async () => (JSON.parse((await h.ls(page, h.SAVE)) ?? 'null')?.events ?? []).filter((e) => e.k === 'feedback' && e.skill === 'wise-mind').length;
    const before = await credits(h, page, 'wise-mind');
    await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'wise-mind' }));
    await page.locator('.dq-skill .dq-step-body > *').first().waitFor({ timeout: 10000 });
    const found = new Set();
    h.expect((await walk(h, page, { id: 'wise-mind' }, found)).end === 'end', `Wise Mind did not reach its end screen: ${[...found].join('; ')}`);
    await page.locator('.dq-feedback .dq-opt', { hasText: /^Yes$/ }).click();
    const after = page.locator('.dq-after:not(.is-hidden) button');
    await after.first().waitFor({ timeout: 5000 });
    const labels = (await after.allTextContents()).map((t) => t.trim());
    h.expect(labels.join('|') === 'Back to the Lantern|Practise again|Another skill', `the end screen offers ${JSON.stringify(labels)}`);
    h.expect((await feedback()) === 1, `one answer recorded ${await feedback()} feedback events`);
    await page.locator('.dq-after button', { hasText: /^Practise again$/ }).click();
    await page.locator('.dq-step-body .dq-intro:not(.dq-intro--end)').waitFor({ timeout: 5000 });
    h.expect((await page.locator('.dq-skill h1').textContent()).startsWith('Still Center'), 'Practise again opened a different skill');
    h.expect(!(await page.locator('.dq-stepbox.is-complete').count()), 'Practise again kept the finished look');
    h.expect((await credits(h, page, 'wise-mind')) - before === 2, `two openings credited ${(await credits(h, page, 'wise-mind')) - before} times`);
    found.clear();
    h.expect((await walk(h, page, { id: 'wise-mind' }, found)).end === 'end', `the second practice did not reach its end screen: ${[...found].join('; ')}`);
    h.expect(await page.locator('.dq-feedback').isVisible(), 'the second practice did not ask how it went');
    h.expect((await credits(h, page, 'wise-mind')) - before === 2, 'finishing the second practice credited it again');
    // a quiet end ("not this time") offers the way out, not a repeat
    await toHub(h, page);
    await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'lie-low' }));
    await page.locator('.dq-step-body .dq-actions .dq-btn--primary').first().click();
    await page.locator('.dq-step-body button', { hasText: /^Not this time$/ }).click();
    await page.locator('.dq-step-body .ca-quietend').waitFor({ timeout: 5000 });
    const quiet = (await page.locator('.dq-after:not(.is-hidden) button').allTextContents()).map((t) => t.trim());
    h.expect(quiet.join('|') === 'Back to the Lantern|Another skill', `the quiet end offers ${JSON.stringify(quiet)}`);
    // a part opened on its own (TIPP's Paced breathing, from the skill's parts) practises that part again, not the start
    await toHub(h, page);
    await openAt(page, 'tipp', 'paced');
    const paced = page.locator('.dq-step-body', { hasText: 'Paced breathing' });
    h.expect(await paced.isVisible(), 'opening TIPP at Paced breathing did not show it');
    found.clear();
    h.expect((await walk(h, page, { id: 'tipp' }, found)).end === 'end', `Paced breathing did not reach TIPP's end screen: ${[...found].join('; ')}`);
    await page.locator('.dq-feedback .dq-opt', { hasText: /^Yes$/ }).click();
    await page.locator('.dq-after button', { hasText: /^Practise again$/ }).click();
    await pastIntro(page);
    h.expect(await paced.isVisible(), `Practise again after Paced breathing opened "${(await page.locator('.dq-step-body').textContent()).trim().slice(0, 60)}"`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'skill-answers-rotate'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    const turn = async () => {
      await page.setViewportSize(SIDEWAYS);
      await page.waitForTimeout(400);
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(400);
    };
    const field = page.locator('.dq-step-body textarea, .dq-step-body input[type=text]').first();
    const next = () => page.locator('.dq-step-body .dq-actions .dq-btn--primary', { hasText: /^Next$/ }).click();
    await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'pros-cons' }));
    await page.locator('.dq-step-body .dq-actions .dq-btn--primary').first().click();
    // typed but not sent yet, then turned
    await field.fill('a long scroll at night');
    await turn();
    h.expect((await field.inputValue()) === 'a long scroll at night', `the unsent urge text became "${await field.inputValue()}" after turning the phone`);
    await next();
    await field.fill('Relief right now');
    await next();
    await field.fill('Losing sleep');
    await turn();
    h.expect((await field.inputValue()) === 'Losing sleep', 'the unsent cost text was lost by turning the phone');
    await next();
    await next();
    await next();
    await page.locator('.dq-step-body .dq-map').waitFor({ timeout: 5000 });
    await turn();
    const map = await page.locator('.dq-step-body').textContent();
    for (const t of ['a long scroll at night', 'Relief right now', 'Losing sleep']) h.expect(map.includes(t), `"${t}" is missing from the map after turning the phone: ${map}`);
    // a picked chip and a set slider stay picked
    await toHub(h, page);
    await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'name-emotion' }));
    await page.locator('.dq-step-body .dq-actions .dq-btn--primary').first().click();
    await page.locator('.dq-step-body .dq-opt', { hasText: /^Fear$/ }).click();
    const worried = page.locator('.dq-step-body .dq-opt', { hasText: /^Worried$/ });
    await worried.click();
    await turn();
    h.expect((await worried.getAttribute('aria-pressed')) === 'true', 'the picked feeling was unpicked by turning the phone');
    await next();
    const range = page.locator('.dq-step-body input[type=range]');
    await range.fill('4');
    await turn();
    h.expect((await range.inputValue()) === '4' && (await page.locator('.dq-step-body .dq-slider-v').textContent()) !== '–', 'the set strength was lost by turning the phone');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
