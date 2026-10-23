// The three interpersonal skills added in ME-89: Priority Call (Clarifying Priorities), Split Screen (Dialectics:
// Both-And) and Co-op Mode (Mindfulness of Others). Each one is opened from the library by a returning player whose
// save predates these ids, walked to the end at 390 and 320 px wide, muted in landscape and with reduced motion,
// and has to be credited, listed in the library and on the diary card, and stay inside the copy rules.

const MOD = 'ie';
const SKILLS = {
  'clarifying-priorities': { sl: 'Priority Call', real: 'Clarifying Priorities', minutes: '2 min' },
  dialectics: { sl: 'Split Screen', real: 'Dialectics: Both-And', minutes: '90 s' },
  'mindfulness-of-others': { sl: 'Co-op Mode', real: 'Mindfulness of Others', minutes: '2 min' },
};
const END = ['Quest complete', 'Agility +1', 'Did it help, even a little?'];
const thanks = { Yes: 'Good. It goes in your diary card', 'A little': 'A little counts.', 'Not this time': 'Thanks for trying it.', Skip: 'Practice still counts.' };

// One walk per screen: `see` must be on it, `fill` types first, `own` opens "write my own", `tap` presses a button,
// `timer` checks the skip is visible while the timer runs (`start` presses Start first).
const PATHS = {
  'clarifying-priorities': {
    a: [
      { see: 'Hard talks pull you three ways at once', tap: 'Begin' },
      { see: "Think of one talk that's coming up", fill: 'Asking for a weekend off', tap: 'Next' },
      { see: 'What do you want to walk away with?', tap: 'A yes to something I asked for' },
      { see: 'How do you want things to be between you afterwards?', tap: 'Calm and okay' },
      { see: 'How do you want to feel about yourself afterwards?', tap: 'Fair to both of us' },
      { see: 'Only one gets to lead this time', tap: 'The result' },
      { see: 'Then the result leads.', tap: 'Done' },
    ],
    b: [
      { see: 'Hard talks pull you three ways at once', tap: 'Begin' },
      { see: "Think of one talk that's coming up", tap: 'Keep it in my head' },
      { see: 'What do you want to walk away with?', tap: 'My no respected' },
      { see: 'How do you want things to be between you afterwards?', tap: 'As close as before' },
      { see: 'How do you want to feel about yourself afterwards?', tap: 'Steady, not small' },
      { see: 'Only one gets to lead this time', tap: 'The relationship' },
      { see: 'Then the relationship leads.', tap: 'Done' },
    ],
    c: [
      { see: 'Hard talks pull you three ways at once', tap: 'Begin' },
      { see: "Think of one talk that's coming up", tap: 'Keep it in my head' },
      { see: 'What do you want to walk away with?', tap: 'Not sure yet' },
      { see: 'How do you want things to be between you afterwards?', tap: 'Not sure yet' },
      { see: 'How do you want to feel about yourself afterwards?', tap: 'Honest' },
      { see: 'Only one gets to lead this time', tap: 'My self-respect' },
      { see: 'Then your self-respect leads.', tap: 'Done' },
    ],
    d: [
      { see: 'Hard talks pull you three ways at once', tap: 'Begin' },
      { see: "Think of one talk that's coming up", tap: 'Keep it in my head' },
      { see: 'What do you want to walk away with?', tap: 'My point taken seriously' },
      { see: 'How do you want things to be between you afterwards?', tap: 'It matters less this time' },
      { see: 'How do you want to feel about yourself afterwards?', tap: 'Not sure yet' },
      { see: 'Only one gets to lead this time', tap: "Can't pick one" },
      { see: 'which one would hurt most to lose?', tap: 'My self-respect' },
      { see: 'Then your self-respect leads.', tap: 'Done' },
    ],
  },
  dialectics: {
    a: [
      { see: 'Torn between two sides?', tap: 'Begin' },
      { see: "Two things that feel like they can't both be true", tap: "I'm doing my best, but I want to do better." },
      { see: "I'm doing my best, and I want to do better.", timer: true, tap: 'Next' },
      { see: 'How does the "and" version sit with you?', tap: 'A bit lighter' },
      { see: 'Which line leaves room for both?', tap: '"This went badly, and parts of it can still be fixed."' },
      { see: 'The middle one.', tap: 'Done' },
    ],
    b: [
      { see: 'Torn between two sides?', tap: 'Begin' },
      { see: "Two things that feel like they can't both be true", tap: "I care about them, but I'm upset with them." },
      { see: "I care about them, and I'm upset with them.", timer: true, tap: 'Next' },
      { see: 'How does the "and" version sit with you?', tap: 'Same as before' },
      { see: 'It often takes a few tries.', tap: '"Everything is ruined."' },
      { see: 'The middle one.', tap: 'Done' },
    ],
    c: [
      { see: 'Torn between two sides?', tap: 'Begin' },
      { see: "Two things that feel like they can't both be true", own: 'Write my own', fill: 'I miss them BUT I need space', tap: 'Use this' },
      { see: 'I miss them, and I need space', timer: true, tap: 'Next' },
      { see: 'How does the "and" version sit with you?', tap: 'Strange, and true' },
      { see: 'Which line leaves room for both?', tap: '"Nothing ever works out."' },
      { see: 'The middle one.', tap: 'Done' },
    ],
    d: [
      { see: 'Torn between two sides?', tap: 'Begin' },
      { see: "Two things that feel like they can't both be true", own: 'Write my own', fill: 'I want to rest and I want to finish this', tap: 'Use this' },
      { see: 'Say it again with an "and" in the middle.', timer: true, tap: 'Next' },
      { see: 'How does the "and" version sit with you?', tap: 'Not sure' },
      { see: 'Not sure is fine.', tap: '"Everything is ruined."' },
      { see: 'The middle one.', tap: 'Done' },
    ],
  },
  'mindfulness-of-others': {
    a: [
      { see: 'Being around people can take a lot out of you', tap: 'Begin' },
      { see: "Think of someone you'll see or talk to soon", tap: 'A friend' },
      { see: 'Observe', timer: 'start', tap: 'Next' },
      { see: 'Which one is a fact?', tap: 'They checked their phone twice.' },
      { see: 'A camera could catch it.', tap: 'Next' },
      { see: 'Participate', tap: 'Next' },
      { see: 'Which one will you try next time?', tap: 'Full attention' },
    ],
    b: [
      { see: 'Being around people can take a lot out of you', tap: 'Begin' },
      { see: "Think of someone you'll see or talk to soon", tap: 'Someone at work or school' },
      { see: 'Observe', timer: true, tap: 'Next' },
      { see: 'Which one is a fact?', tap: "They don't want to be here." },
      { see: 'A camera could catch it.', tap: 'Next' },
      { see: 'Participate', tap: 'Next' },
      { see: 'Which one will you try next time?', tap: 'Facts, not guesses' },
    ],
    c: [
      { see: 'Being around people can take a lot out of you', tap: 'Begin' },
      { see: "Think of someone you'll see or talk to soon", tap: 'A teammate' },
      { see: 'Observe', timer: 'start', tap: 'Next' },
      { see: 'Which one is a fact?', tap: 'Not sure' },
      { see: 'A camera could catch it.', tap: 'Next' },
      { see: 'Participate', tap: 'Next' },
      { see: 'Which one will you try next time?', tap: 'Join in all the way' },
    ],
    d: [
      { see: 'Being around people can take a lot out of you', tap: 'Begin' },
      { see: "Think of someone you'll see or talk to soon", tap: 'Not sure yet' },
      { see: 'Observe', timer: true, tap: 'Next' },
      { see: 'Which one is a fact?', tap: 'They checked their phone twice.' },
      { see: 'A camera could catch it.', tap: 'Next' },
      { see: 'Participate', tap: 'Next' },
      { see: 'Which one will you try next time?', tap: 'Not sure yet' },
    ],
  },
};

const BANNED = /\b(disorders?|diagnos\w*|symptoms?|patients?|illness(es)?|treatments?|relapse\w*)\b|game over|you died|\u2014/i;
const norm = (t) => (t ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();
const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

async function oldSave(h, pastDays = 6) {
  const key = `ie-seed-${pastDays}`;
  if (h.shared[key]) return h.shared[key];
  const { ctx, page } = await h.open({ 'dbt.app.v1': h.SEEN });
  await h.reachHub(page);
  const base = JSON.parse(await h.ls(page, h.SAVE));
  await ctx.close();
  const today = base.events.find((e) => e.k === 'visit')?.day;
  h.expect(today, 'a first visit wrote no visit event');
  const older = ['give', 'fast', 'wise-mind', 'stop', 'dear-man', 'validation'];
  const t0 = Date.now() - (pastDays + 1) * 86400e3;
  const events = [];
  for (let i = pastDays; i >= 1; i--) {
    const day = addDays(today, -i);
    const t = t0 + (pastDays - i) * 86400e3;
    const skill = older[i % older.length];
    events.push({ id: `seed-v${i}`, t, day, k: 'visit', xp: 10 });
    events.push({ id: `seed-s${i}`, t: t + 1000, day, k: 'skill', xp: 20, stat: { give: 'agility', fast: 'agility', 'dear-man': 'agility', validation: 'agility', 'wise-mind': 'sense', stop: 'stamina' }[skill], skill });
  }
  const save = { ...base, created: t0, events, flags: { ...base.flags, cardDay: '', greetDay: '', giftDay: '', rankSeen: 5, wardenSeen: true } };
  const all = JSON.stringify(save);
  h.expect(!Object.keys(SKILLS).some((id) => all.includes(id)), 'the seeded save already knows a new skill id');
  h.shared[key] = save;
  return save;
}

async function home(h, page) {
  const vp = page.viewportSize();
  let calm = 0;
  for (let i = 0; i < 60; i++) {
    const win = (await page.locator('.dq-sw').count()) + (await page.locator('.dq-scrim.is-on').count());
    if (!win && (await page.locator('.dq-tile').first().isVisible().catch(() => false))) {
      if (++calm >= 3) return;
    } else {
      calm = 0;
      if (win) await page.mouse.click(vp.width / 2, Math.round(vp.height * 0.83));
    }
    await h.sleep(300);
  }
  await h.shot(page, 'fail-ie-no-home');
  throw new Error('Home never appeared');
}

const settled = (page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity), null, { timeout: 3000 }).catch(() => {});
const tile = (page, name) => page.locator('.dq-tile', { has: page.locator('.dq-tile-t', { hasText: new RegExp(`^${name}$`) }) });
const progress = async (h, page, id) => {
  const s = JSON.parse(await h.ls(page, h.SAVE));
  const ev = s.events;
  return {
    xp: ev.reduce((n, e) => n + Math.max(0, e.xp), 0),
    agility: ev.filter((e) => e.stat === 'agility').length,
    opened: ev.filter((e) => e.k === 'skill' && e.skill === id).length,
    owned: ev.some((e) => (e.k === 'skill' || e.k === 'card') && e.skill === id),
    feedback: ev.filter((e) => e.k === 'feedback' && e.skill === id).map((e) => e.data?.answer),
  };
};

async function openFromLibrary(h, page, id) {
  const sk = SKILLS[id];
  await tile(page, 'Skills').click();
  const row = page.locator(`.dq-libsec.dq-mod-${MOD} .dq-librow`, { has: page.locator('.dq-librow-n', { hasText: new RegExp(`^${sk.sl}$`) }) });
  await row.waitFor({ timeout: 10000 });
  h.expect(norm(await row.locator('.dq-librow-r').textContent()) === sk.real, `library row for ${sk.sl} does not show ${sk.real}`);
  h.expect(norm(await row.locator('.dq-librow-m').textContent()) === sk.minutes, `library row for ${sk.sl} does not show ${sk.minutes}`);
  await row.click();
  await page.locator('.dq-skill .dq-intro-name').waitFor({ timeout: 10000 });
}

async function screenCheck(h, page, where) {
  const text = await page.locator('.dq-skill').innerText();
  h.expect(!/\{(name|companion)\}/.test(text), `${where}: unfilled name token in "${norm(text)}"`);
  const bad = text.match(BANNED);
  h.expect(!bad, `${where}: "${bad?.[0]}" on screen in "${norm(text)}"`);
  const out = await page.evaluate(() => {
    const box = document.querySelector('.dq-stepbox')?.getBoundingClientRect();
    const res = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) res.push(`page is ${document.documentElement.scrollWidth} px wide`);
    if (!box) return res;
    if (box.right > innerWidth + 1 || box.left < -1) res.push(`step box ${Math.round(box.left)}..${Math.round(box.right)}`);
    for (const el of document.querySelectorAll('.dq-stepbox *')) {
      if (el.closest('svg, .dq-sr')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.right > box.right + 1 || r.left < box.left - 1) res.push(`${el.tagName}.${el.className} "${(el.textContent ?? '').slice(0, 40)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'hidden') res.push(`${el.tagName}.${el.className} clips its text`);
    }
    return res;
  });
  h.expect(!out.length, `${where}: overflows at ${page.viewportSize()?.width} px: ${out.join('; ')}`);
  return norm(text);
}

async function tap(h, page, label, where) {
  const want = norm(label).toLowerCase();
  const btns = page.locator('.dq-skill button');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    if (!(await b.isVisible())) continue;
    if (norm(await b.innerText()).toLowerCase() === want) return b.click();
  }
  await h.shot(page, `fail-ie-${where}`);
  throw new Error(`${where}: no visible button "${label}"`);
}

async function walk(h, page, path, tag, answer) {
  let k = 0;
  const step = async (s) => {
    const where = `${tag} screen ${++k}`;
    await page
      .waitForFunction((want) => (document.querySelector('.dq-skill')?.innerText ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').toLowerCase().includes(want), norm(s.see).toLowerCase(), { timeout: 8000 })
      .catch(() => {});
    const text = await screenCheck(h, page, where);
    h.expect(text.toLowerCase().includes(norm(s.see).toLowerCase()), `${where}: expected "${s.see}" in "${text}"`);
    if (s.timer) {
      h.expect(await page.locator('.dq-skill .dq-timer').count(), `${where}: no timer on a timer screen`);
      if (s.timer === 'start') {
        const start = page.locator('.dq-timer .dq-btn', { hasText: /^Start/ });
        h.expect(await start.isVisible(), `${where}: no Start button on a timer that waits for the player`);
        await start.click();
        await page.locator('.dq-timer .dq-btn', { hasText: /^\+\d+ s$/ }).waitFor({ timeout: 3000 });
      }
      await h.sleep(600);
      const num = norm(await page.locator('.dq-timer-num').innerText());
      h.expect(/^\d/.test(num) && num !== '0', `${where}: the timer had already finished (${num}), so its skip was not tested`);
      const skip = page.locator('.dq-skill .dq-actions--center > .dq-btn', { hasText: /^Next$/ });
      h.expect(await skip.isVisible(), `${where}: no visible skip while the timer runs`);
    }
    await settled(page);
    await h.shot(page, `${tag}-${String(k).padStart(2, '0')}`);
    if (s.own) {
      await tap(h, page, s.own, where);
      const box = page.locator('.dq-skill .dq-other input, .dq-skill .dq-other textarea').first();
      await box.waitFor({ timeout: 3000 });
      await box.fill(s.fill);
    } else if (s.fill) {
      await page.locator('.dq-skill textarea, .dq-skill input[type=text]').first().fill(s.fill);
    }
    await tap(h, page, s.tap, where);
    await h.sleep(250);
  };
  for (const s of path) await step(s);
  await page.locator('.dq-stepbox.is-complete').waitFor({ timeout: 8000 });
  const endText = (await screenCheck(h, page, `${tag} end`)).toLowerCase();
  for (const see of END) h.expect(endText.includes(see.toLowerCase()), `${tag} end: expected "${see}"`);
  await settled(page);
  await h.shot(page, `${tag}-${String(++k).padStart(2, '0')}-end`);
  await tap(h, page, answer, `${tag} end`);
  await page.locator('.dq-skill .dq-lead', { hasText: thanks[answer].slice(0, 12) }).waitFor({ timeout: 5000 });
  await settled(page);
  await h.shot(page, `${tag}-${String(++k).padStart(2, '0')}-thanks`);
  await tap(h, page, 'Back to the Lantern', `${tag} end`);
  await home(h, page);
}

async function skillScenario(h, id) {
  const sk = SKILLS[id];
  const seed = await oldSave(h);
  const runs = [
    { tag: `ie-${id}-390`, query: '', vp: { width: 390, height: 844 }, path: 'a', answer: 'Not this time' },
    { tag: `ie-${id}-320`, query: '', vp: { width: 320, height: 568 }, path: 'b', answer: 'Yes' },
    { tag: `ie-${id}-mute-landscape`, query: '?mute', vp: { width: 844, height: 390 }, path: 'c', answer: 'A little' },
    { tag: `ie-${id}-reduced`, query: '', vp: { width: 320, height: 568 }, path: 'd', answer: 'Skip', reduced: true },
  ];
  for (const run of runs) {
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(seed), 'dbt.app.v1': h.SEEN }, run.query, run.vp);
    if (run.reduced) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload();
    }
    await home(h, page);
    if (run.reduced) h.expect(await page.locator('.dq.is-still').count(), `${run.tag}: reduced motion was not picked up`);
    const before = await progress(h, page, id);
    h.expect(!before.owned && before.opened === 0, `${run.tag}: the old save already has ${id}`);
    await openFromLibrary(h, page, id);
    await walk(h, page, PATHS[id][run.path], run.tag, run.answer);
    const after = await progress(h, page, id);
    h.expect(after.opened === 1, `${run.tag}: expected one credit for ${id}, got ${after.opened}`);
    h.expect(after.owned, `${run.tag}: ${id} did not join the collection`);
    h.expect(after.xp >= before.xp + 20, `${run.tag}: XP went from ${before.xp} to ${after.xp}`);
    h.expect(after.agility === before.agility + 1, `${run.tag}: Agility went from ${before.agility} to ${after.agility}`);
    h.expect(after.feedback.length === 1 && after.feedback[0] === run.answer, `${run.tag}: feedback stored as ${JSON.stringify(after.feedback)}`);

    if (run.path === 'a') {
      await openFromLibrary(h, page, id);
      await screenCheck(h, page, `${run.tag} again`);
      await page.getByRole('button', { name: 'Leave this skill' }).click();
      await home(h, page);
      const again = await progress(h, page, id);
      h.expect(again.opened === 2 && again.xp >= after.xp + 20 && again.agility === after.agility + 1, `${run.tag}: leaving on screen one was not credited: ${JSON.stringify(again)}`);

      await tile(page, 'Shadows').click();
      await page.locator('.dq-cardbtn', { hasText: sk.sl }).first().waitFor({ timeout: 10000 });
      h.expect((await page.locator(`.dq-cardbtn[aria-label^="${sk.sl}, ${sk.real}."]`).count()) === 1, `${run.tag}: Shadows does not show ${sk.sl}`);
      await h.shot(page, `${run.tag}-shadows`);
      await page.locator('.dq-top .dq-back').click();
      await home(h, page);
      await tile(page, 'Diary card').click();
      const used = page.locator('.dq-skillsused li', { hasText: `${sk.sl} (${sk.real})` });
      await used.first().waitFor({ timeout: 10000 });
      h.expect(norm(await used.first().locator('.dq-code').innerText()) === "didn't help this time", `${run.tag}: diary code for ${sk.sl} does not match the "Not this time" answer`);
      await h.shot(page, `${run.tag}-diary`);
      const text = await page.locator('.dq-page').innerText();
      h.expect(!/\{(name|companion)\}/.test(text), `${run.tag}: diary shows an unfilled token`);
    }
    h.expect(!errors.length, `${run.tag}: ${errors.join('\n')}`);
    await ctx.close();
  }
}

export const scenarios = {
  /** an old save with none of the new ids: Home loads, the library lists all three under Interpersonal, nothing is credited */
  async 'skills-ie-library'(h) {
    const seed = await oldSave(h);
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(seed), 'dbt.app.v1': h.SEEN }, '?mute', vp);
      await home(h, page);
      await tile(page, 'Skills').click();
      const sec = page.locator(`.dq-libsec.dq-mod-${MOD}`);
      await sec.waitFor({ timeout: 10000 });
      const rows = (await sec.locator('.dq-librow-n').allInnerTexts()).map(norm);
      for (const sk of Object.values(SKILLS)) h.expect(rows.includes(sk.sl), `Interpersonal does not list ${sk.sl}: ${rows.join(', ')}`);
      await sec.scrollIntoViewIfNeeded();
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      h.expect(wide <= 1, `library is ${wide} px wider than the screen`);
      await h.shot(page, `ie-library-${vp.width}`);
      const s = JSON.parse(await h.ls(page, h.SAVE));
      h.expect(!s.events.some((e) => Object.keys(SKILLS).includes(e.skill)), 'loading Home or the library credited a new skill');
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'skills-ie-clarifying-priorities'(h) {
    await skillScenario(h, 'clarifying-priorities');
  },
  async 'skills-ie-dialectics'(h) {
    await skillScenario(h, 'dialectics');
  },
  async 'skills-ie-mindfulness-of-others'(h) {
    await skillScenario(h, 'mindfulness-of-others');
  },

  /** the links from Priority Call open DEAR MAN, GIVE and FAST, each credited on its own */
  async 'skills-ie-priorities-links'(h) {
    const seed = await oldSave(h);
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(seed), 'dbt.app.v1': h.SEEN }, '?mute');
    await home(h, page);
    for (const [pick, link, target, chip] of [
      ['The result', 'Plan it with DEAR MAN', 'dear-man', "Commander's Voice"],
      ['The relationship', 'Practise GIVE', 'give', 'Guild Bond'],
      ['My self-respect', 'Practise FAST', 'fast', "Wanderer's Code"],
    ]) {
      const before = await progress(h, page, target);
      await openFromLibrary(h, page, 'clarifying-priorities');
      await walkTo(h, page, pick);
      await tap(h, page, link, `link ${target}`);
      await page.locator('.dq-chip-t', { hasText: chip.replace("'", '\u2019') }).waitFor({ timeout: 8000 });
      const after = await progress(h, page, target);
      h.expect(after.opened === before.opened + 1, `${link} did not open and credit ${target}`);
      await h.shot(page, `ie-priorities-link-${target}`);
      await page.getByRole('button', { name: 'Leave this skill' }).click();
      await home(h, page);
    }
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /**
   * A returning player whose save predates these ids lands on a visit day where the longer rotation deals a new skill:
   * Home loads, nothing is credited until the card is flipped, the card says it is new, and Begin opens it.
   */
  async 'skills-ie-rotation-old-save'(h) {
    const probe = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    const rotation = await probe.page.evaluate(async () => (await import('/src/content/dbt.ts')).ROTATION.map((q) => q.skill));
    await probe.ctx.close();
    for (const id of Object.keys(SKILLS)) {
      const at = rotation.indexOf(id);
      h.expect(at >= 0, `${id} is not in the daily rotation`);
      const seed = await oldSave(h, at);
      const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(seed), 'dbt.app.v1': h.SEEN }, '?mute', { width: 320, height: 568 });
      await home(h, page);
      const before = await progress(h, page, id);
      h.expect(!before.owned, `${id}: Home credited today's card before it was flipped`);
      const card = page.locator('.dq-card');
      await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await h.sleep(400);
      const box = await card.boundingBox();
      h.expect(box, `${id}: today's card is not on Home`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const note = page.locator('.dq-quest-note');
      await note.filter({ hasText: 'Shadow acquired' }).waitFor({ timeout: 8000 });
      h.expect(norm(await note.innerText()) === `Shadow acquired: ${SKILLS[id].sl}. It joins your collection.`, `${id}: card note was "${norm(await note.innerText())}"`);
      await h.shot(page, `ie-rotation-${id}`);
      const flipped = await progress(h, page, id);
      h.expect(flipped.owned && flipped.opened === 0, `${id}: flipping the card should add it to the collection without a practice credit`);
      await page.locator('.dq-quest-acts .dq-btn', { hasText: /^Begin$/ }).click();
      const name = page.locator('.dq-skill .dq-intro-name');
      await name.waitFor({ timeout: 8000 });
      h.expect(norm(await name.innerText()) === SKILLS[id].sl, `${id}: Begin opened ${await name.innerText()}`);
      h.expect((await progress(h, page, id)).opened === 1, `${id}: Begin did not credit the skill`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },
};

async function walkTo(h, page, pick) {
  for (const label of ['Begin', 'Keep it in my head', 'Not sure yet', 'Not sure yet', 'Not sure yet', pick]) {
    await tap(h, page, label, `walk to ${pick}`);
    await h.sleep(250);
  }
}
