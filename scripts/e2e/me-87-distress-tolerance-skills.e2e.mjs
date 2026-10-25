const DAY = 864e5;
const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function oldSave({ days = 5, today = false, flags } = {}) {
  const now = Date.now();
  const events = [];
  for (let i = days; i >= 1; i--) {
    const t = now - i * DAY;
    events.push({ id: `v${i}`, t, day: dayKey(t), k: 'visit', xp: 10 });
    if (i % 2) events.push({ id: `s${i}`, t: t + 1000, day: dayKey(t), k: 'skill', xp: 20, stat: 'stamina', skill: 'stop' });
  }
  if (today) events.push({ id: 'v0', t: now - 60000, day: dayKey(now), k: 'visit', xp: 10 });
  return { v: 1, created: now - (days + 1) * DAY, events, ...(flags ? { flags } : {}) };
}

const SKILLS = {
  'turning-the-mind': { sl: 'Crossroads', real: 'Turning the Mind', minutes: '2 min' },
  'body-scan': { sl: 'Quiet Scan', real: 'Body Scan', minutes: '2 min' },
  'alternate-rebellion': { sl: 'Off-Script', real: 'Alternate Rebellion', minutes: '1 min' },
};
const BANNED = [/\{(name|companion)\}/i, /\b(disorder\w*|diagnos\w*|symptom\w*|patients?|illness\w*|treatment\w*|relaps\w*)\b/i, /game over|you died/i, /\u2014/];

const progress = (save, id) => {
  const ev = save?.events ?? [];
  return {
    xp: ev.reduce((n, e) => n + (e.xp || 0), 0),
    stamina: ev.filter((e) => e.stat === 'stamina').length,
    uses: ev.filter((e) => e.k === 'skill' && e.skill === id).length,
    owned: ev.some((e) => (e.k === 'skill' || e.k === 'card') && e.skill === id),
  };
};
const saved = async (h, page) => JSON.parse((await h.ls(page, h.SAVE)) ?? 'null');

const tap = (name) => async (page) => page.getByRole('button', { name, exact: typeof name === 'string' }).first().click();
const taps = (...names) => async (page) => {
  for (const n of names) await tap(n)(page);
};
const own = (text) => async (page) => {
  await page.locator('.dq-step-body').getByRole('button', { name: 'My own', exact: true }).click();
  await page.locator('.dq-other input, .dq-other textarea').first().fill(text);
  await tap('Use this')(page);
};
const hold = (ms) => async (page) => {
  const box = await page.locator('.dq-hold').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, ms));
  await page.mouse.up();
  await page.locator('.dq-hold.is-done').waitFor({ timeout: 3000 });
  await page.locator('.dq-step-body .dq-btn--primary', { hasText: 'Next' }).waitFor({ timeout: 3000 });
  await tap('Next')(page);
};
const runOut = async (page) => {
  await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 45000 });
  await page.locator('.dq-step-body .dq-btn--primary', { hasText: 'Next' }).waitFor({ timeout: 3000 });
  await tap('Next')(page);
};

const END = { see: /Quest complete/, end: true };
const WALKS = {
  'turning-the-mind': {
    main: [
      { see: /Still fighting something that already happened/, small: /never means staying somewhere unsafe/, act: tap('Begin') },
      { see: /Notice the fight/, act: taps(/Why me/, 'Bitterness', 'Next') },
      { see: /fork in the road/, act: hold(4600), skip: tap('Next') },
      { see: /Plan for next time/, act: tap('A tight jaw or fists') },
      { see: /Turn again\./, act: tap('Next') },
      { see: /Every turn counts/, act: tap('A bit lighter') },
      { see: /You turned your mind/, act: tap('Done') },
      { ...END, act: tap('Yes'), after: /It goes in your diary card as a skill that helped/ },
    ],
    branches: [
      [
        { see: /Still fighting/, act: tap('Begin') },
        { see: /Notice the fight/, act: tap('Next') },
        { see: /fork in the road/, act: tap('Next') },
        { see: /Plan for next time/, act: own('My shoulders creep up') },
        { see: /Turn again\./, act: tap('Next') },
        { see: /Every turn counts/, act: tap('About the same') },
        { see: /Thanks for trying it\. Sometimes it takes a lot of turns/, act: tap('Done') },
        { ...END, act: tap('Not this time'), after: /Thanks for trying it\. Some skills land on other days/ },
      ],
      [
        { see: /Still fighting/, act: tap('Begin') },
        { see: /Notice the fight/, act: tap('Next') },
        { see: /fork in the road/, act: tap('Next') },
        { see: /Plan for next time/, act: tap('Feeling bitter') },
        { see: /Turn again\./, act: tap('Next') },
        { see: /Every turn counts/, act: tap(/It.s a lot/) },
        { see: /Thanks for being honest\. Then only a little today/, act: tap('Safe Zone') },
        { safe: true },
      ],
    ],
  },
  'body-scan': {
    main: [
      { see: /Wound up, or a bit far away from yourself/, act: tap('Begin') },
      { see: /Sit or lie down/, act: tap('Ready') },
      { see: /Feet and legs/, timer: 30, act: tap('Next') },
      { see: /Back, hands and shoulders/, timer: 30, act: tap('Next') },
      { see: /Face and head/, timer: 30, act: runOut, skip: tap('Next') },
      { see: /whole body at once/, act: tap('A bit calmer') },
      { see: /feet to head\. That was care/, act: tap('Done') },
      { ...END, act: tap('A little'), after: /A little counts/ },
    ],
    branches: [
      [
        { see: /Wound up/, act: tap('Begin') },
        { see: /Sit or lie down/, act: tap('Ready') },
        { see: /Feet and legs/, timer: 30, act: taps('+15 s', 'Next'), extended: true },
        { see: /Back, hands and shoulders/, timer: 30, act: tap('Next') },
        { see: /Face and head/, timer: 30, act: tap('Next') },
        { see: /whole body at once/, act: tap('About the same') },
        { see: /Thanks for trying it\. Noticing is the whole skill/, act: tap('Done') },
        { ...END, act: tap('Skip'), after: /Practice still counts/ },
      ],
      [
        { see: /Wound up/, act: tap('Begin') },
        { see: /Sit or lie down/, act: tap('Ready') },
        { see: /Feet and legs/, timer: 30, act: tap('Next') },
        { see: /Back, hands and shoulders/, timer: 30, act: tap('Next') },
        { see: /Face and head/, timer: 30, act: tap('Next') },
        { see: /whole body at once/, act: tap('Harder') },
        { see: /Thanks for being honest\. Some days, paying attention to your body is a lot/, act: tap('Sense Up') },
        { see: /Three small moves/, chip: 'Sense Up', act: tap('Begin'), other: true },
        { see: /Find three things you can see/, chip: 'Sense Up', other: true },
      ],
    ],
  },
  'alternate-rebellion': {
    main: [
      { see: /Sick of rules, plans and being careful/, act: tap('Begin') },
      { see: /pushing against today/, act: tap('Being bored') },
      { see: /Pick a harmless rebellion/, act: tap('Take a totally different route') },
      { see: /Take a totally different route\. Quick check/, act: tap(/No, it.s harmless/) },
      { see: /Go do it\. Small, harmless and on purpose/, act: tap('Done') },
      { ...END, act: tap('Yes'), after: /It goes in your diary card/ },
    ],
    branches: [
      [
        { see: /Sick of rules/, act: tap('Begin') },
        { see: /pushing against today/, act: tap('Everything, honestly') },
        { see: /Pick a harmless rebellion/, act: own('Wear my socks inside out.') },
        { see: /Wear my socks inside out\. Quick check/, notSee: /\.\./, act: tap('Maybe') },
        { see: /Good catch\. Pick a gentler one/, act: tap('Pick again') },
        { see: /Pick a harmless rebellion/, act: tap('Sit somewhere you never sit') },
        { see: /Sit somewhere you never sit\. Quick check/, act: tap(/No, it.s harmless/) },
        { see: /Go do it/, act: tap('Done') },
        { ...END },
      ],
      [
        { see: /Sick of rules/, act: tap('Begin') },
        { see: /pushing against today/, act: own('Being on my best behaviour all week') },
        { see: /Pick a harmless rebellion/, act: tap(/Blast a song you.d never admit to liking/) },
        { see: /Quick check/, act: tap('Maybe') },
        { see: /Good catch/, act: tap('Done') },
        { ...END },
      ],
    ],
  },
};

async function home(page) {
  const screen = await page.evaluate(() => document.querySelector('.dq')?.dataset.screen);
  if (screen === 'skill') await page.getByRole('button', { name: 'Leave this skill' }).click();
  else if (screen === 'safe') await page.locator('.dq-top .dq-back').click();
  await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'hub', null, { timeout: 10000 });
}

async function rotationSlot(h, id) {
  const ctx = await h.browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(h.server.url + '/?lab=daily&mute');
  const at = await page.evaluate(async (skill) => (await import('/src/content/dbt.ts')).ROTATION.findIndex((q) => q.skill === skill && !q.special), id);
  await ctx.close();
  h.expect(at >= 0, `${id} is not in the daily rotation`);
  return at;
}

async function openFromLibrary(h, page, id) {
  const k = SKILLS[id];
  await h.reachHub(page);
  await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
  await page.locator('.dq-library').waitFor({ timeout: 10000 });
  const row = page.locator('.dq-libsec.dq-mod-dt .dq-librow').filter({ has: page.locator('.dq-librow-n', { hasText: new RegExp(`^${k.sl}$`) }) });
  h.expect((await row.count()) === 1, `${k.sl} is not listed once under Distress Tolerance`);
  h.expect((await row.locator('.dq-librow-r').textContent()) === k.real, `${k.sl} row does not show ${k.real}`);
  h.expect((await row.locator('.dq-librow-m').textContent()) === k.minutes, `${k.sl} row does not show ${k.minutes}`);
  await row.click();
  await page.locator('.dq-skill').waitFor({ timeout: 10000 });
}

async function checkScreen(h, page, id, step, label) {
  const body = page.locator('.dq-step-body');
  const want = step.see;
  await page
    .waitForFunction((src) => new RegExp(src, 'i').test(document.querySelector('.dq-skill')?.innerText ?? ''), want.source, { timeout: 10000 })
    .catch(async () => {
      await h.shot(page, `fail-${label}`);
      throw new Error(`${label}: expected ${want} but the screen says: ${(await page.locator('.dq-skill').innerText().catch(() => '')).slice(0, 300)}`);
    });
  const firstTimer = (await body.locator('.dq-timer-num').count()) ? (await body.locator('.dq-timer-num').textContent()).trim() : null;
  await h.sleep(450);
  await h.shot(page, label);
  const text = await page.locator('.dq-skill').evaluate((el) => `${el.innerText}\n${el.textContent}`);
  for (const re of BANNED) h.expect(!re.test(text), `${label}: screen text matches ${re}: ${text.slice(0, 200)}`);
  if (step.notSee) h.expect(!step.notSee.test(text), `${label}: screen text matches ${step.notSee}`);
  if (step.small) h.expect(step.small.test(text), `${label}: missing ${step.small}`);
  const chip = await page.locator('.dq-skill .dq-chip-t').textContent();
  if (!step.end) h.expect(chip === (step.chip ?? SKILLS[id].sl), `${label}: header says ${chip}`);
  if (!step.other && !step.end) h.expect((await page.locator('.dq-skill .dq-chip-sub').textContent()) === SKILLS[id].real, `${label}: the real DBT name is not shown next to the game name`);
  h.expect(await page.locator('.dq-top .dq-safe').isVisible(), `${label}: Safe Zone button is not on screen`);
  const vw = page.viewportSize().width;
  const spill = await page.evaluate((w) => {
    const bad = [];
    if (document.documentElement.scrollWidth > w + 1) bad.push(`page is ${document.documentElement.scrollWidth}px wide`);
    for (const el of document.querySelectorAll('.dq-skill *')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.right > w + 1 || r.left < -1) bad.push(`${el.className || el.tagName} spills to ${Math.round(r.left)}..${Math.round(r.right)}`);
      if ((el.matches('.dq-opt, .dq-btn, .dq-text, .dq-step-t, .dq-intro-name') && el.scrollWidth > el.clientWidth + 1)) bad.push(`${el.className} text overflows`);
    }
    return bad.slice(0, 5);
  }, vw);
  h.expect(!spill.length, `${label}: content spills at ${vw}px: ${spill.join('; ')}`);
  if (await body.locator('.dq-timer').count()) {
    const skip = body.getByRole('button', { name: 'Next', exact: true });
    h.expect(await skip.isVisible(), `${label}: timer screen has no visible skip`);
    const raw = firstTimer ?? '';
    const secs = raw.includes(':') ? raw.split(':').reduce((m, x) => m * 60 + Number(x), 0) : Number(raw);
    h.expect(secs >= 19 && secs <= 90, `${label}: timer shows ${raw}, outside 20 to 90 s`);
    if (step.timer) h.expect(secs <= step.timer && secs >= step.timer - 3, `${label}: timer shows ${raw}, expected about ${step.timer}`);
    if (step.extended) {
      h.expect(await body.getByRole('button', { name: '+15 s' }).isVisible(), `${label}: no way to extend the timer`);
    }
  } else if (step.timer) {
    throw new Error(`${label}: expected a timer`);
  }
}

async function walk(h, page, id, steps, tag, { fast = false } = {}) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = `${tag}-${String(i + 1).padStart(2, '0')}`;
    if (step.safe) {
      await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'safe', null, { timeout: 10000 });
      await page.getByText('Talk to someone now').first().waitFor({ timeout: 10000 });
      await h.sleep(400);
      await h.shot(page, label);
      continue;
    }
    await checkScreen(h, page, id, step, label);
    if (step.end) {
      h.expect(/Stamina \+1/i.test(await page.locator('.dq-skill').innerText()), `${label}: end screen does not show Stamina +1`);
    }
    const act = fast && step.skip ? step.skip : step.act;
    if (act) await act(page);
    if (step.after) {
      await page.locator('.dq-skill').getByText(step.after).first().waitFor({ timeout: 5000 });
      await h.shot(page, `${label}-after`);
    }
  }
}

async function leaveOnFirst(h, page, id) {
  const before = progress(await saved(h, page), id);
  await openFromLibrary(h, page, id);
  await page.locator('.dq-skill .dq-intro-name', { hasText: SKILLS[id].sl }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Leave this skill' }).click();
  await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'hub', null, { timeout: 10000 });
  const after = progress(await saved(h, page), id);
  h.expect(after.uses === before.uses + 1 && after.xp >= before.xp + 20 && after.stamina === before.stamina + 1, `leaving ${id} on screen one did not credit it: ${JSON.stringify({ before, after })}`);
}

function full(id, viewport, query) {
  return async (h) => {
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(oldSave()), 'dbt.app.v1': h.SEEN }, query, viewport);
    const tag = `dt-${id}-${viewport.width}`;
    await h.reachHub(page);
    const before = progress(await saved(h, page), id);
    h.expect(!before.owned, `${id} was already owned before the walk`);
    await openFromLibrary(h, page, id);
    await walk(h, page, id, WALKS[id].main, tag);
    const after = progress(await saved(h, page), id);
    h.expect(after.uses === before.uses + 1, `${id} was not credited exactly once: ${JSON.stringify({ before, after })}`);
    h.expect(after.xp >= before.xp + 20 && after.stamina === before.stamina + 1 && after.owned, `${id} did not raise XP, Stamina and the collection: ${JSON.stringify({ before, after })}`);
    await page.getByRole('button', { name: 'Back to the Lantern' }).click();
    if (viewport.width >= 390) {
      for (const [b, steps] of WALKS[id].branches.entries()) {
        await openFromLibrary(h, page, id);
        await walk(h, page, id, steps, `${tag}-b${b + 1}`);
        await home(page);
      }
    }
    await leaveOnFirst(h, page, id);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  };
}

export const scenarios = {
  'skills-dt-crossroads-390': full('turning-the-mind', { width: 390, height: 844 }, '?'),
  'skills-dt-crossroads-320': full('turning-the-mind', { width: 320, height: 568 }, '?mute'),
  'skills-dt-quiet-scan-390': full('body-scan', { width: 390, height: 844 }, '?'),
  'skills-dt-quiet-scan-320': full('body-scan', { width: 320, height: 568 }, '?mute'),
  'skills-dt-off-script-390': full('alternate-rebellion', { width: 390, height: 844 }, '?'),
  'skills-dt-off-script-320': full('alternate-rebellion', { width: 320, height: 568 }, '?mute'),

  async 'skills-dt-reduced-motion'(h) {
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(oldSave()), 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await h.reachHub(page);
    h.expect(await page.locator('.dq').evaluate((el) => el.classList.contains('is-still')), 'reduced motion is not in effect');
    for (const id of Object.keys(SKILLS)) {
      const before = progress(await saved(h, page), id);
      await openFromLibrary(h, page, id);
      await walk(h, page, id, WALKS[id].main, `dt-reduced-${id}`, { fast: true });
      const after = progress(await saved(h, page), id);
      h.expect(after.uses === before.uses + 1 && after.owned, `${id} did not complete and credit with reduced motion: ${JSON.stringify({ before, after })}`);
      await page.getByRole('button', { name: 'Back to the Lantern' }).click();
    }
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'skills-dt-diary-and-shadows'(h) {
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(oldSave()), 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 });
    await h.reachHub(page);
    for (const id of Object.keys(SKILLS)) await leaveOnFirst(h, page, id);
    await page.locator('.dq-tile').filter({ hasText: 'Diary card' }).first().click();
    await page.locator('.dq-skillsused').waitFor({ timeout: 10000 });
    const used = await page.locator('.dq-skillsused').innerText();
    for (const k of Object.values(SKILLS)) h.expect(used.includes(`${k.sl} (${k.real})`), `diary card does not list ${k.sl} (${k.real}): ${used}`);
    await page.locator('.dq-export summary', { hasText: 'Preview' }).click();
    const plain = await page.locator('.dq-export pre').innerText();
    for (const k of Object.values(SKILLS)) h.expect(new RegExp(`^${k.real}\\s+`, 'm').test(plain), `diary export has no row for ${k.real}`);
    await page.locator('.dq-skillsused').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await h.sleep(400);
    await h.shot(page, 'dt-diary');
    await page.locator('.dq-export pre').evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await h.sleep(300);
    await h.shot(page, 'dt-diary-export');
    await page.getByRole('button', { name: /Lantern/ }).first().click();
    await h.reachHub(page);
    await page.locator('.dq-tile').filter({ hasText: 'Shadows' }).first().click();
    for (const k of Object.values(SKILLS)) await page.locator(`.dq-cardbtn[aria-label^="${k.sl}, ${k.real}."]`).waitFor({ timeout: 10000 });
    await page.locator('.dq-cardbtn[aria-label^="Crossroads, "]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await h.sleep(400);
    await h.shot(page, 'dt-shadows');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'skills-dt-rotation-old-save'(h) {
    const today = dayKey(Date.now());
    const slot = await rotationSlot(h, 'turning-the-mind');
    const flipped = oldSave({ days: slot, today: true, flags: { cardDay: today, greetDay: today, giftDay: today } });
    flipped.events.push({ id: 'c0', t: Date.now() - 30000, day: today, k: 'card', xp: 0, skill: 'wise-mind' });
    const a = await h.open({ [h.SAVE]: JSON.stringify(flipped), 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 });
    await h.reachHub(a.page);
    await h.sleep(800);
    const card = a.page.locator('.dq-card');
    h.expect(await card.evaluate((el) => el.classList.contains('is-open')), 'the card already flipped today is closed again');
    h.expect(/Still Center/.test(await card.getAttribute('aria-label')), `the card already revealed today changed when the rotation grew: ${await card.getAttribute('aria-label')}`);
    await h.shot(a.page, 'dt-rotation-flipped');
    const kept = await saved(h, a.page);
    h.expect(kept.events.length === flipped.events.length && progress(kept, 'turning-the-mind').xp === progress(flipped, 'turning-the-mind').xp, 'loading after the rotation change credited something');
    h.expect(!progress(kept, 'turning-the-mind').owned, 'loading after the rotation change put Crossroads in the collection');
    h.expect(!a.errors.length, a.errors.join('\n'));
    await a.ctx.close();

    const fresh = oldSave({ days: slot, today: true, flags: { greetDay: today, giftDay: today } });
    const b = await h.open({ [h.SAVE]: JSON.stringify(fresh), 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 });
    await h.reachHub(b.page);
    await b.page.locator('.dq-card').click({ force: true });
    await b.page.locator('.dq-quest-note', { hasText: 'Shadow acquired: Crossroads. It joins your collection.' }).waitFor({ timeout: 10000 });
    await h.sleep(600);
    await h.shot(b.page, 'dt-rotation-new-card');
    await b.page.locator('.dq-quest-acts').getByRole('button', { name: 'Begin' }).click();
    await b.page.locator('.dq-skill .dq-intro-name', { hasText: 'Crossroads' }).waitFor({ timeout: 10000 });
    const now = progress(await saved(h, b.page), 'turning-the-mind');
    h.expect(now.uses === 1 && now.owned, `opening today's new card did not credit it: ${JSON.stringify(now)}`);
    h.expect(!b.errors.length, b.errors.join('\n'));
    await b.ctx.close();
  },

  async 'skills-dt-trade-places-timer'(h) {
    const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(oldSave()), 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 });
    await page.clock.install();
    await page.reload();
    await h.reachHub(page);
    const before = progress(await saved(h, page), 'accepts');
    await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
    await page.locator('.dq-libsec.dq-mod-dt .dq-librow').filter({ has: page.locator('.dq-librow-n', { hasText: /^Trade Places$/ }) }).click();
    // The page clock stands still from here and only moves when told to, so no time slips in between a tap and a
    // reading however slow the machine is, and every reading lands half a second into a second. (The page's time runs
    // until the pause lands, so it pauses a second ahead.)
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    for (const name of ['Begin', 'Thoughts', 'Count blue things in the room', '1 min']) await tap(name)(page);
    await page.locator('.dq-step-body', { hasText: 'Your break can go on as long as you like.' }).waitFor({ timeout: 5000 });
    const num = page.locator('.dq-timer-num');
    const shows = async () => (await num.textContent()).trim();
    const start = await shows();
    h.expect(start === '1:00', `the timer does not start at one minute (shows ${start})`);
    await page.clock.fastForward(60500);
    h.expect((await shows()) === 'Done', `half a second after its minute the timer shows ${await shows()}, not Done`);
    await tap('+30 s')(page);
    await page.clock.runFor(500);
    const left = await shows();
    h.expect(left === '30', `+30 s on a finished timer shows ${left} half a second later, not 30`);
    await page.clock.runFor(29000);
    const last = await shows();
    h.expect(last === '1', `half a second before its 30 more seconds end the timer shows ${last}, not 1`);
    await page.clock.runFor(1000);
    h.expect((await shows()) === 'Done', `half a second after its 30 more seconds the timer shows ${await shows()}, not Done`);
    await tap('Next')(page);
    await page.locator('.dq-step-body .dq-intro--end').waitFor({ timeout: 5000 });
    const after = progress(await saved(h, page), 'accepts');
    h.expect(after.uses === before.uses + 1, `Trade Places was not credited once: ${JSON.stringify({ before, after })}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
