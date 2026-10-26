// Kind Light (Loving-Kindness), the Mindfulness skill of sending one small, kind wish to yourself or someone easy to
// care about. On a returning save it opens from the Skills list, under Mindfulness.
// kindness-walks: yourself first, them first, adding the other, a name left empty, a name typed, your own words and
// "Not feeling it" all reach the same end screen, with one credit for opening and none for finishing.
// "It stirred up something hard" leads with people to talk to and opens the Safe Zone at its talk screen.
// kindness-leave: "Leave this skill" on the first screen, on a running timer and on the name field goes straight Home
// with no confirm and one credit each time; the Safe Zone opens in one tap from the middle of the skill.
// kindness-timer: its timers can be skipped before or while they run, and "+15 s" adds exactly 15 seconds.
// kindness-sizes: every screen at 390x844, 320x568, 844x390 and 1280x800, with a long name and long own words: nothing
// sticks out sideways or clips, the wish shows in full, and the Safe Zone button stays on screen.
import { credits, returning, toHub } from './skill-check.e2e.mjs';

const ID = 'loving-kindness';
const NAME = 'Kind Light';
const REAL = 'Loving-Kindness';
const PHONE = { width: 390, height: 844 };
const SIZES = [PHONE, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 }];
const LONG_NAME = 'my neighbour downstairs with the very old dog';
const LONG_WISH = 'May the people I love find a quiet minute to rest and breathe today';

const plain = (t) => (t ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const exact = (t) => new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]")}\\s*$`);
const skillEvents = async (h, page) => (JSON.parse((await h.ls(page, h.SAVE)) ?? 'null')?.events ?? []).filter((e) => e.k === 'skill');

/** Opens Kind Light from the Skills list, the way a player finds it. */
async function openFromList(h, page) {
  await toHub(h, page);
  await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
  await page.locator('.dq-library').waitFor({ timeout: 10000 });
  const rows = await page.evaluate(({ sl, real }) => {
    const plain = (t) => t.replace(/[‘’]/g, "'").trim();
    const found = [...document.querySelectorAll('.dq-librow')].filter((r) => plain(r.querySelector('.dq-librow-n').textContent) === sl && plain(r.querySelector('.dq-librow-r').textContent) === real);
    found.forEach((r) => r.setAttribute('data-kindness', 'row'));
    return found.map((r) => r.closest('section')?.querySelector('.dq-libsec-h')?.textContent ?? '');
  }, { sl: NAME, real: REAL });
  h.expect(rows.length === 1, `the Skills list shows ${rows.length} rows for ${NAME} (${REAL}), not one`);
  h.expect(rows[0].includes('Mindfulness'), `${NAME} is listed under "${rows[0]}", not Mindfulness`);
  await page.locator('[data-kindness="row"]').click();
  await page.locator('.dq-skill .dq-step-body > *').first().waitFor({ timeout: 10000 });
}

/** The current screen: where the app is, whether it is this skill's end screen, and the step's text. */
const screen = (page) =>
  page.evaluate(() => {
    const body = document.querySelector('.dq-step-body');
    return { at: document.querySelector('.dq')?.dataset.screen, end: !!body?.querySelector('.dq-intro--end'), text: body?.innerText ?? '', big: body?.querySelector('.dq-timer-big')?.textContent ?? null };
  });

/** Taps an answer or button on the step and waits until the step has moved on. */
async function tap(page, label) {
  await page.evaluate(() => document.querySelector('.dq-step-body')?.firstElementChild?.setAttribute('data-kindness-step', ''));
  await page.locator('.dq-step-body').locator('.dq-opt, button').filter({ hasText: exact(label) }).first().click();
  await page.waitForFunction(() => !document.querySelector('[data-kindness-step]') || document.querySelector('.dq')?.dataset.screen !== 'skill', null, { timeout: 10000 });
}

const startTimer = (page) => page.locator('.dq-step-body .dq-timer .dq-actions .dq-btn--primary', { hasText: /start/i }).first().click();

/** Checks this screen shows what it should, and that the Safe Zone is one tap away. */
async function sees(h, page, where, want) {
  const s = await screen(page);
  h.expect(s.at === 'skill' && !s.end, `${where}: expected a ${NAME} step, found ${s.end ? 'its end screen' : s.at}`);
  // titles are set in capitals on screen, so the words are matched in any case
  if (want.text) h.expect(new RegExp(want.text.source, 'i').test(plain(s.text)),`${where}: expected ${want.text}, the screen says "${plain(s.text).slice(0, 160)}"`);
  if (want.big !== undefined) h.expect(plain(s.big) === want.big, `${where}: the wish reads "${plain(s.big)}", not "${want.big}"`);
  h.expect(await page.locator('.dq-top .dq-safe').isVisible(), `${where}: the Safe Zone button is not on screen`);
}

/** Checks the walk ended on Kind Light's own end screen. */
async function ended(h, page, where) {
  const s = await screen(page);
  h.expect(s.at === 'skill' && s.end, `${where}: did not reach the end screen (at ${s.at}: "${plain(s.text).slice(0, 120)}")`);
  const name = plain(await page.locator('.dq-step-body .dq-intro--end .dq-intro-name').textContent());
  h.expect(name === NAME, `${where}: ended on the end screen of "${name}"`);
  h.expect(await page.locator('.dq-top .dq-safe').isVisible(), `${where}: the Safe Zone button is not on the end screen`);
}

// Each walk is a list of [what the screen shows, what the player does]. Every one ends where the last action leaves it.
const WALKS = {
  'yourself first, then them, name left empty, not feeling it': [
    [{ text: /Kindness can start as a small, quiet wish\. It doesn't have to feel warm to count\./ }, 'Begin'],
    [{ text: /Pick a kind wish that feels believable today/ }, 'May this moment be a little gentler'],
    [{ text: /Who gets it first\?/ }, 'Me'],
    [{ text: /For you/, big: 'May this moment be a little gentler for me.' }, 'Next'],
    [{ text: /Send the same wish to someone easy to care about too\?/ }, 'Yes, them too'],
    [{ text: /Picture someone easy to care about: a friend, family, a pet\. Leave out anyone who feels hard right now\./ }, { fill: '' }, 'Next'],
    [{ text: /Picture them for a moment/, big: 'May this moment be a little gentler for them.' }, 'start', 'Next'],
    [{ text: /How did that feel\?/ }, 'Not feeling it'],
    [{ text: /That's okay\. Warmth doesn't have to show up\. Each time you came back to the wish, you were practising\. A kind wish isn't a promise/ }, 'Done'],
  ],
  'them first with a name, then yourself, a little warmer': [
    [{}, 'Begin'],
    [{}, 'May today go a bit easier'],
    [{}, 'Someone easy to care about'],
    [{ text: /Picture someone easy to care about/ }, { fill: 'Sunny' }, 'Next'],
    [{ text: /For them Picture Sunny for a moment/, big: 'May today go a bit easier for Sunny.' }, 'Next'],
    [{ text: /Send the same wish to yourself too\?/ }, 'Yes, me too'],
    [{ text: /For you/, big: 'May today go a bit easier for me.' }, 'Next'],
    [{ text: /How did that feel\?/ }, 'A little warmer'],
    [{ text: /^(?!.*Warmth doesn't).*A kind wish isn't a promise/ }, 'Done'],
  ],
  'yourself only': [
    [{}, 'Begin'],
    [{}, 'May there be a moment of rest'],
    [{}, 'Me'],
    [{ big: 'May there be a moment of rest for me.' }, 'start', 'Next'],
    [{}, 'Just me today'],
    [{}, 'Quieter'],
    [{ text: /A kind wish isn't a promise/ }, 'Done'],
  ],
  'them only, kept in mind, in your own words, not feeling it': [
    [{}, 'Begin'],
    [{}, { own: 'May they sleep well tonight' }],
    [{}, 'Someone easy to care about'],
    [{}, 'Keep it in my head'],
    [{ text: /Picture them for a moment.*Change the words to fit them if you like\./, big: 'May they sleep well tonight.' }, 'Next'],
    [{}, 'Just them today'],
    [{}, 'Not feeling it'],
    [{ text: /Warmth doesn't have to show up/ }, 'Done'],
  ],
};

/** Plays one walk from Kind Light's first screen. */
async function play(h, page, name, steps) {
  for (const [i, [want, ...acts]] of steps.entries()) {
    const where = `${name}, screen ${i + 1}`;
    await sees(h, page, where, want);
    for (const act of acts) {
      if (act === 'start') await startTimer(page);
      else if (typeof act === 'object' && 'fill' in act) await page.locator('.dq-step-body input').fill(act.fill);
      else if (typeof act === 'object' && 'own' in act) {
        await page.locator('.dq-step-body button', { hasText: exact('My own wish') }).click();
        await page.locator('.dq-step-body .dq-other input').fill(act.own);
        await tap(page, 'Use this');
      } else await tap(page, act);
    }
  }
}

export const scenarios = {
  async 'kindness-walks'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    await h.reachHub(page);
    const walks = {};
    for (const [name, steps] of Object.entries(WALKS)) {
      const before = await skillEvents(h, page);
      await openFromList(h, page);
      h.expect((await credits(h, page, ID)) === before.filter((e) => e.skill === ID).length + 1, `${name}: opening it did not credit it once`);
      await play(h, page, name, steps);
      await ended(h, page, name);
      await toHub(h, page);
      const added = (await skillEvents(h, page)).filter((e) => !before.some((b) => b.id === e.id)).map((e) => e.skill);
      h.expect(added.length === 1 && added[0] === ID, `${name}: credited ${JSON.stringify(added)}, not ${ID} once (finishing must add nothing)`);
      walks[name] = steps.length;
    }
    // A hard answer leads with people to talk to, which opens the Safe Zone at "Talk to someone now"
    const before = await skillEvents(h, page);
    await openFromList(h, page);
    await play(h, page, 'something hard', [[{}, 'Begin'], [{}, 'May this moment be a little gentler'], [{}, 'Me'], [{}, 'Next'], [{}, 'Just me today']]);
    await sees(h, page, 'something hard, feeling', { text: /How did that feel\?/ });
    await tap(page, 'It stirred up something hard');
    await sees(h, page, 'something hard, answer', { text: /Thanks for telling me\. Kind words can stir up old hurt, and you don't have to sit with it alone\. Someone to talk to is one tap away\./ });
    const offers = (await page.locator('.dq-step-body .dq-actions button').allTextContents()).map(plain);
    h.expect(offers.join('|') === 'People to talk to|Done', `something hard: offers ${JSON.stringify(offers)}, not people to talk to first, then Done`);
    await h.shot(page, 'kindness-hard-390x844');
    await page.locator('.dq-step-body .dq-actions button').first().click();
    await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'safe', null, { timeout: 5000 });
    const talk = await page.locator('.dq-sz-t', { hasText: /^Talk to someone now$/ }).waitFor({ timeout: 5000 }).then(() => true, () => false);
    h.expect(talk, 'something hard: "People to talk to" did not open the Safe Zone at its talk screen');
    await h.shot(page, 'kindness-hard-safe-zone-390x844');
    await toHub(h, page);
    const added = (await skillEvents(h, page)).filter((e) => !before.some((b) => b.id === e.id)).map((e) => e.skill);
    h.expect(added.length === 1 && added[0] === ID, `something hard: credited ${JSON.stringify(added)}, not ${ID} once`);
    h.expect(!dialogs.length, `a browser dialog opened: ${dialogs.join('; ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { walks };
  },

  async 'kindness-leave'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    await h.reachHub(page);
    const leave = async (where) => {
      await page.locator('.dq-top [aria-label="Leave this skill"]').click();
      const home = await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'hub', null, { timeout: 5000 }).then(() => true, () => false);
      h.expect(home, `${where}: "Leave this skill" did not go straight Home`);
      await h.reachHub(page);
    };
    const cases = {
      'the first screen': [],
      'a running timer': [[{}, 'Begin'], [{}, 'May this moment be a little gentler'], [{}, 'Me'], [{ big: 'May this moment be a little gentler for me.' }, 'start']],
      'the name field, half typed': [[{}, 'Begin'], [{}, 'May today go a bit easier'], [{}, 'Someone easy to care about'], [{ text: /Picture someone easy/ }, { fill: 'Su' }]],
    };
    for (const [where, steps] of Object.entries(cases)) {
      const had = await credits(h, page, ID);
      await openFromList(h, page);
      await play(h, page, where, steps);
      await leave(where);
      h.expect((await credits(h, page, ID)) - had === 1, `${where}: opening and leaving credited it ${(await credits(h, page, ID)) - had} times, not once`);
    }
    // the Safe Zone, one tap from the middle of the skill
    const had = await credits(h, page, ID);
    await openFromList(h, page);
    await play(h, page, 'Safe Zone', [[{}, 'Begin'], [{}, 'May this moment be a little gentler'], [{}, 'Me'], [{}, 'start']]);
    await page.locator('.dq-top .dq-safe').click();
    await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'safe', null, { timeout: 5000 });
    h.expect(await page.getByRole('button', { name: 'Talk to someone now', exact: true }).isVisible(), 'the Safe Zone opened without "Talk to someone now"');
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) - had === 1, `opening it and going to the Safe Zone credited it ${(await credits(h, page, ID)) - had} times, not once`);
    h.expect(!dialogs.length, `a browser dialog opened: ${dialogs.join('; ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'kindness-timer'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await page.clock.install();
    await page.reload();
    await h.reachHub(page);
    const had = await credits(h, page, ID);
    // The page clock stands still and moves only when told to, so a reading can't drift between a tap and a check.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await openFromList(h, page);
    await play(h, page, 'timer', [[{}, 'Begin'], [{}, 'May this moment be a little gentler'], [{}, 'Me']]);
    const num = page.locator('.dq-step-body .dq-timer-num');
    const shows = async () => plain(await num.textContent());
    h.expect((await shows()) === '20', `the first timer shows ${await shows()} before it starts, not 20`);
    await startTimer(page);
    await page.clock.runFor(2500);
    h.expect((await shows()) === '18', `2.5 s in, the timer shows ${await shows()}, not 18`);
    const more = page.locator('.dq-step-body .dq-timer button', { hasText: /^\+\d+ s$/ });
    h.expect((await more.count()) === 1 && plain(await more.textContent()) === '+15 s', 'the running timer does not offer "+15 s"');
    await more.click();
    // the countdown redraws on its next tick: 20 s - 3.5 s + 15 s leaves 31.5 s
    await page.clock.runFor(1000);
    h.expect((await shows()) === '32', `1 s after "+15 s" the timer shows ${await shows()}, not 32`);
    const next = page.locator('.dq-step-body > .dq-actions > button', { hasText: /^Next$/ });
    h.expect((await next.isVisible()) && (await next.isEnabled()), 'the running timer has no Next to skip it');
    await h.shot(page, 'kindness-timer-extended-390x844');
    await tap(page, 'Next');
    await sees(h, page, 'after skipping the running timer', { text: /Send the same wish to someone easy to care about too\?/ });
    await play(h, page, 'timer', [[{}, 'Yes, them too'], [{}, 'Next']]);
    // the second timer, skipped before it starts
    h.expect((await shows()) === '20', `the second timer shows ${await shows()} before it starts, not 20`);
    await tap(page, 'Next');
    await sees(h, page, 'after skipping the second timer unstarted', { text: /How did that feel\?/ });
    await play(h, page, 'timer', [[{}, 'A little warmer'], [{}, 'Done']]);
    await ended(h, page, 'timer');
    h.expect((await credits(h, page, ID)) - had === 1, `extending and skipping credited it ${(await credits(h, page, ID)) - had} times, not once`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'kindness-sizes'(h) {
    const problems = [];
    const shots = [];
    for (const size of SIZES) {
      const tag = `${size.width}x${size.height}`;
      const { ctx, page, errors } = await h.open(returning(h), '?mute', size);
      await h.reachHub(page);
      /** Anything in the skill or the top bar sticking out sideways, a clipped label, or a wish not fully on screen. */
      const fit = (where) =>
        page.evaluate((where) => {
          const bad = [];
          const vw = document.documentElement.clientWidth;
          if (document.documentElement.scrollWidth > vw + 1) bad.push(`${where}: the page scrolls sideways (${document.documentElement.scrollWidth} px in ${vw} px)`);
          for (const e of document.querySelectorAll('.dq-top *, .dq-skill *')) {
            if (!e.getClientRects().length || e.closest('[aria-hidden="true"], svg, .dq-sr')) continue;
            const r = e.getBoundingClientRect();
            const name = (e.textContent || e.getAttribute('aria-label') || e.className || e.tagName).toString().trim().slice(0, 50);
            if (r.width && (r.left < -1 || r.right > vw + 1)) bad.push(`${where}: "${name}" sticks out sideways (${Math.round(r.left)} to ${Math.round(r.right)} px)`);
            if (e.matches('button, .dq-opt') && e.scrollWidth > e.clientWidth + 1) bad.push(`${where}: "${name}" is clipped`);
            if (e.matches('input') && !e.value && e.placeholder) {
              const cs = getComputedStyle(e);
              const ctx = document.createElement('canvas').getContext('2d');
              ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
              if (ctx.measureText(e.placeholder).width > e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 1) bad.push(`${where}: the placeholder "${e.placeholder}" is cut off`);
            }
          }
          const big = document.querySelector('.dq-timer-big');
          if (big) {
            const r = big.getBoundingClientRect();
            if (r.left < 0 || r.right > vw || parseFloat(getComputedStyle(big).fontSize) < 16) bad.push(`${where}: the wish is not fully readable`);
          }
          const safe = document.querySelector('.dq-top .dq-safe')?.getBoundingClientRect();
          if (!safe || safe.top < 0 || safe.bottom > innerHeight || safe.right > vw) bad.push(`${where}: the Safe Zone button is off screen`);
          return bad;
        }, where);
      let n = 0;
      const look = async (label) => {
        const name = `kindness-${tag}-${String(++n).padStart(2, '0')}-${label}`;
        // the screen as it settles, after its fade-in (looping glows and pulses never finish, so they are left out)
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))));
        problems.push(...(await fit(`${tag} ${label}`)));
        await h.shot(page, name);
        shots.push(name);
        // a wish below the fold or under the top bar gets a second shot, scrolled to it, so the wish itself is seen
        const big = page.locator('.dq-step-body .dq-timer-big');
        if ((await big.count()) && !(await big.evaluate((b) => { const r = b.getBoundingClientRect(); return r.top >= document.querySelector('.dq-top').getBoundingClientRect().bottom && r.bottom <= innerHeight; }))) {
          await big.evaluate((b) => b.scrollIntoView({ block: 'center' }));
          await h.shot(page, `${name}-wish`);
          shots.push(`${name}-wish`);
        }
      };
      await openFromList(h, page);
      await look('intro');
      await tap(page, 'Begin');
      await page.locator('.dq-step-body button', { hasText: exact('My own wish') }).click();
      await page.locator('.dq-step-body .dq-other input').fill(LONG_WISH);
      await look('wish-own');
      await tap(page, 'Use this');
      await look('who');
      await tap(page, 'Someone easy to care about');
      await look('name-empty');
      await page.locator('.dq-step-body input').fill(LONG_NAME);
      await look('name');
      await tap(page, 'Next');
      await sees(h, page, `${tag} them`, { big: `${LONG_WISH}.` });
      await look('them-timer');
      await startTimer(page);
      await look('them-timer-running');
      await tap(page, 'Next');
      await look('add-me');
      await tap(page, 'Yes, me too');
      await look('me-timer');
      await startTimer(page);
      await look('me-timer-running');
      await tap(page, 'Next');
      await look('felt');
      await tap(page, 'Not feeling it');
      await look('close');
      await tap(page, 'Done');
      await ended(h, page, tag);
      await look('end');
      // the presets, with the name left empty, and the hard answer
      await openFromList(h, page);
      await play(h, page, tag, [[{}, 'Begin']]);
      await look('wishes');
      await play(h, page, tag, [[{}, 'May this moment be a little gentler'], [{}, 'Me']]);
      await look('me-timer-preset');
      await startTimer(page);
      await look('me-timer-preset-running');
      await play(h, page, tag, [[{}, 'Next']]);
      await look('add-them');
      await play(h, page, tag, [[{}, 'Just me today'], [{}, 'It stirred up something hard']]);
      await look('hard');
      await toHub(h, page);
      h.expect(!errors.length, `${tag}: ${errors.join('\n')}`);
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
    return { shots };
  },
};
