const NEW = {
  'problem-solving': { sl: 'Keysmith', real: 'Problem Solving' },
  'long-term-positives': { sl: 'Main Quest', real: 'Long-Term Positives' },
  'emotion-myths': { sl: 'Patch Notes', real: 'Myths About Emotions' },
};
const BANNED = [/\{(name|companion)\}/, /\b(disorders?|diagnos\w*|symptoms?|patients?|illness\w*|treatments?|relapse\w*)\b/i, /game over/i, /you died/i, /\u2014/];
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const LANDSCAPE = { width: 844, height: 390 };

const norm = (t) => t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

function returning(prior, extra = []) {
  const today = dayKey(Date.now());
  const yesterday = addDays(today, -1);
  const events = [];
  const ev = (day, k, xp, more = {}) => events.push({ id: `e2e${events.length}`, t: Date.now() - 86400e3, day, k, xp, ...more });
  for (let i = prior; i >= 1; i--) ev(addDays(today, -i), 'visit', 10);
  ev(yesterday, 'skill', 20, { stat: 'sense', skill: 'wise-mind' });
  for (const [k, xp, more] of extra) ev(yesterday, k, xp, more);
  return JSON.stringify({ v: 1, created: Date.now() - 400 * 86400e3, events, flags: { rankSeen: 5, wardenSeen: true, greetDay: yesterday, giftDay: yesterday, cardDay: yesterday } });
}
const seedFor = (h, save) => ({ [h.SAVE]: save, 'dbt.app.v1': h.SEEN, [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }) });

async function progress(h, page, id) {
  const ev = JSON.parse(await h.ls(page, h.SAVE)).events;
  return {
    xp: ev.reduce((a, e) => a + e.xp, 0),
    intelligence: ev.filter((e) => e.stat === 'intelligence').length,
    uses: ev.filter((e) => e.k === 'skill' && e.skill === id).length,
  };
}

async function home(h, page) {
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.dq-sw').count()) await page.locator('.dq-sw').first().click().catch(() => undefined);
    else if (await page.locator('.dq-tile').first().isVisible().catch(() => false)) return;
    await h.sleep(250);
  }
  throw new Error('Home never appeared');
}
async function library(h, page) {
  await home(h, page);
  await page.locator('.dq-tile', { has: page.locator('.dq-tile-t', { hasText: /^Skills$/ }) }).click();
  await page.locator('.dq-library').waitFor({ timeout: 10000 });
}
async function openFromLibrary(h, page, id) {
  const row = page.locator('.dq-libsec.dq-mod-er .dq-librow', { has: page.locator('.dq-librow-n', { hasText: new RegExp(`^${NEW[id].sl}$`) }) });
  h.expect((await row.count()) === 1, `${NEW[id].sl} is not listed once under Emotion Regulation`);
  h.expect(norm(await row.locator('.dq-librow-r').textContent()) === NEW[id].real, `${NEW[id].sl} does not show its DBT name`);
  await row.click();
  const durations = await page.evaluate(async (id) => (await import('/src/content/dbt.ts')).SKILL[id].steps.filter((s) => s.kind === 'timer').map((s) => typeof s.seconds === 'function' ? s.seconds({}) : s.seconds), id);
  h.expect(durations.every((n) => n >= 20 && n <= 90), `${id}: timer duration outside 20-90 seconds`);
  await page.locator('.dq-skill .dq-intro-name').waitFor({ timeout: 10000 });
  h.expect(norm(await page.locator('.dq-skill .dq-intro-name').textContent()) === NEW[id].sl, `opened the wrong skill for ${id}`);
}

const stepText = async (page) => norm((await page.locator('.dq-step-body').textContent().catch(() => '')) ?? '');
async function tap(page, label) {
  const btns = page.locator('.dq-skill button:visible');
  const n = await btns.count();
  for (let i = 0; i < n; i++) if (norm(await btns.nth(i).textContent()) === label) return btns.nth(i).click();
  throw new Error(`no visible "${label}" button; screen: ${await stepText(page)}`);
}

async function checkScreen(h, page, name, see) {
  await h.sleep(450);
  const text = norm(await page.locator('body').innerText());
  for (const re of BANNED) h.expect(!re.test(text), `${name}: screen text matches ${re}: ${text.slice(0, 300)}`);
  if (see) h.expect(norm(await page.locator('.dq-skill').textContent()).includes(see), `${name}: expected "${see}" on screen, got: ${await stepText(page)}`);
  const over = await page.evaluate(() => {
    const W = window.innerWidth;
    const bad = [];
    if (document.documentElement.scrollWidth > W + 1) bad.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
    for (const el of document.querySelectorAll('.dq-skill *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || el.closest('.dq-sr') || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.right > W + 1 || r.left < -1) bad.push(`${el.tagName}.${el.className} spans ${Math.round(r.left)}-${Math.round(r.right)}`);
      if (/^(P|H3|SPAN|BUTTON|LABEL|DIV)$/.test(el.tagName) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) bad.push(`${el.tagName}.${el.className} overflows: "${el.textContent.slice(0, 40)}"`);
    }
    return bad;
  });
  h.expect(!over.length, `${name}: overflow at ${page.viewportSize().width} px: ${over.slice(0, 5).join('; ')}`);
  if (await page.locator('.dq-step-body .dq-timer').count()) {
    const clock = await page.locator('.dq-timer-num').innerText();
    h.expect(clock === 'Done' || Number(clock) >= 0 && Number(clock) <= 90, `${name}: invalid timer display (${clock})`);
    const skip = page.locator('.dq-step-body .dq-actions button', { hasText: /^Next$/ });
    h.expect(await skip.isVisible(), `${name}: timer screen has no visible skip`);
    await skip.scrollIntoViewIfNeeded();
    await skip.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('.dq-step-body .dq-actions button')].find((el) => el.textContent === 'Next');
      const r = button?.getBoundingClientRect();
      return r && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight + 1;
    }, null, { timeout: 3000 });
  }
  await page.evaluate(() => { document.querySelector('.dq').scrollTop = 0; });
  await h.shot(page, name);
}

async function act(page, step) {
  const [kind, a, b] = step.do;
  if (kind === 'tap') return tap(page, a);
  if (kind === 'type') {
    await page.locator('.dq-step-body textarea:visible, .dq-step-body input[type=text]:visible').first().fill(a);
    return tap(page, b ?? 'Next');
  }
  if (kind === 'chip') {
    await tap(page, a);
    return tap(page, b ?? 'Next');
  }
  if (kind === 'extend') {
    const before = await page.locator('.dq-timer-num').evaluate((el) => ({ left: Number(el.textContent), at: performance.now() }));
    await tap(page, '+20 s');
    await page.waitForFunction((b) => {
      const left = Number(document.querySelector('.dq-timer-num')?.textContent);
      const added = left + (performance.now() - b.at) / 1000 - b.left;
      return added >= 18 && added <= 22;
    }, before, { timeout: 5000 });
    return;
  }
  if (kind === 'other') {
    await tap(page, a);
    await page.locator('.dq-other input:visible').fill(b);
    return tap(page, 'Use this');
  }
  throw new Error('unknown step ' + kind);
}

async function walk(h, page, name, path, { quiet = false } = {}) {
  let n = 0;
  for (const step of path) {
    await checkScreen(h, page, `${name}-${String(++n).padStart(2, '0')}`, step.see);
    const before = await stepText(page);
    await act(page, step);
    await page.waitForFunction((b) => {
      const t = document.querySelector('.dq-step-body')?.textContent ?? '';
      return t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim() !== b;
    }, before, { timeout: 5000 });
  }
  await page.locator('.dq-intro--end').waitFor({ timeout: 5000 });
  await checkScreen(h, page, `${name}-${String(++n).padStart(2, '0')}-end`);
  if (quiet) return h.expect(!(await page.locator('.dq-gain').count()), `${name}: a quiet ending showed a reward`);
  const gain = norm(await page.locator('.dq-gain').textContent());
  h.expect(gain.includes('Intelligence +1') && gain.includes('+20 XP'), `${name}: end screen gain is "${gain}"`);
  await tap(page, 'Not this time');
  await page.locator('.dq-skill .dq-lead', { hasText: 'Thanks for trying it' }).waitFor({ timeout: 3000 });
  await h.shot(page, `${name}-${String(n).padStart(2, '0')}-thanks`);
}

const PATHS = {
  'problem-solving': [
    {
      name: 'main',
      steps: [
        { see: 'it makes sense that it\'s getting to you', do: ['tap', 'Begin'] },
        { see: 'thinking room', do: ['tap', 'Calm or mild. Go on'] },
        { see: "What's the problem?", do: ['type', 'Slides for the group project are due Friday and half are not done.'] },
        { see: 'What would need to change', do: ['type', 'Have a plan for Friday'] },
        { see: 'Brainstorm', do: ['chip', 'Do a smaller piece'] },
        { see: 'most likely to get you there', do: ['tap', 'Torn between two'] },
        { see: 'Start with the easier one', do: ['chip', 'Write it down'] },
        { see: 'try another idea', do: ['tap', 'Trying it now'] },
      ],
    },
    {
      name: 'stuck',
      steps: [
        { do: ['tap', 'Begin'] },
        { do: ['tap', 'Calm or mild. Go on'] },
        { do: ['tap', 'Keep it in my head'] },
        { do: ['tap', 'Skip'] },
        { do: ['tap', 'Thought of some'] },
        { do: ['tap', 'None of them fit'] },
        { see: 'Some problems need more ideas', do: ['tap', 'More ideas'] },
        { see: 'Brainstorm', do: ['tap', 'Thought of some'] },
        { do: ['tap', 'Got one'] },
        { see: 'first step', do: ['tap', 'Skip'] },
        { do: ['tap', 'Later'] },
      ],
    },
    {
      name: 'heavy',
      quiet: true,
      steps: [
        { do: ['tap', 'Begin'] },
        { do: ['tap', 'Heavy right now'] },
        { see: 'Heavy feelings get comfort first', do: ['tap', 'Done'] },
      ],
    },
  ],
  'long-term-positives': [
    {
      name: 'main',
      steps: [
        { see: 'all chores lately', do: ['tap', 'Begin'] },
        { see: 'Not what should matter', do: ['tap', 'Looking after me'] },
        { see: 'Looking after me matters to you', do: ['tap', 'Wind down earlier at night'] },
        { see: 'Break it down', do: ['chip', 'Write it down'] },
        { see: 'What matters: Looking after me. Goal: Wind down earlier at night. First step: Write it down', do: ['tap', 'Next'] },
        { see: 'Smaller still counts', do: ['tap', 'This week'] },
      ],
    },
    {
      name: 'own',
      steps: [
        { do: ['tap', 'Begin'] },
        { do: ['other', 'My own', 'music'] },
        { see: 'Music matters to you', do: ['other', 'My own goal', 'Learn three songs on guitar'] },
        { do: ['tap', 'Skip'] },
        { see: "First step: Pick one when you're ready.", do: ['tap', 'Next'] },
        { do: ['tap', 'Only planning'] },
      ],
    },
  ],
  'emotion-myths': [
    {
      name: 'main',
      steps: [
        { see: 'Feelings are hard enough on their own', do: ['tap', 'Begin'] },
        { see: 'loudest lately', do: ['tap', "I shouldn't feel this way"] },
        { see: "There's no right way to feel", do: ['tap', 'Next'] },
        { see: 'How does that thought sit?', do: ['tap', "Doesn't fit"] },
        { see: 'Reading it still counts', do: ['type', 'Feelings can just be here.'] },
        { see: "Feelings aren't right or wrong", do: ['tap', 'Done'] },
      ],
    },
    {
      name: 'own',
      steps: [
        { do: ['tap', 'Begin'] },
        { do: ['other', 'A different one', 'Crying means I lost'] },
        { see: 'Old rule: "Crying means I lost." Another way to see it: Feelings aren\'t rules or verdicts', do: ['extend'] },
        { see: 'Read it slowly', do: ['tap', 'Next'] },
        { do: ['tap', 'Rings true'] },
        { do: ['tap', 'Skip'] },
        { do: ['tap', 'Done'] },
      ],
    },
  ],
};

async function playAll(h, id, viewport, tag) {
  const { ctx, page, errors } = await h.open(seedFor(h, returning(12)), '', viewport);
  await library(h, page);
  for (const path of PATHS[id]) {
    const before = await progress(h, page, id);
    await openFromLibrary(h, page, id);
    h.expect(await page.getByRole('button', { name: 'Safe Zone, help right now', exact: true }).isVisible(), 'Safe Zone is not one tap away');
    await walk(h, page, `${tag}-${path.name}`, path.steps, { quiet: path.quiet });
    const after = await progress(h, page, id);
    h.expect(after.uses === before.uses + 1 && after.xp === before.xp + 20 && after.intelligence === before.intelligence + 1, `${tag}-${path.name}: not credited once: ${JSON.stringify({ before, after })}`);
    await tap(page, 'Another skill');
    await page.locator('.dq-library').waitFor({ timeout: 10000 });
  }
  const before = await progress(h, page, id);
  await openFromLibrary(h, page, id);
  await page.getByRole('button', { name: 'Leave this skill' }).click();
  await home(h, page);
  const after = await progress(h, page, id);
  h.expect(after.uses === before.uses + 1 && after.xp === before.xp + 20 && after.intelligence === before.intelligence + 1, `${tag}: leaving on screen one was not credited: ${JSON.stringify({ before, after })}`);
  h.expect(!errors.length, errors.join('\n'));
  await ctx.close();
}

export const scenarios = {
  'skills-er-problem-solving-390': (h) => playAll(h, 'problem-solving', PHONE, 'er-ps-390'),
  'skills-er-problem-solving-320': (h) => playAll(h, 'problem-solving', SMALL, 'er-ps-320'),
  'skills-er-long-term-positives-390': (h) => playAll(h, 'long-term-positives', PHONE, 'er-ltp-390'),
  'skills-er-long-term-positives-320': (h) => playAll(h, 'long-term-positives', SMALL, 'er-ltp-320'),
  'skills-er-emotion-myths-390': (h) => playAll(h, 'emotion-myths', PHONE, 'er-em-390'),
  'skills-er-emotion-myths-320': (h) => playAll(h, 'emotion-myths', SMALL, 'er-em-320'),
  async 'skills-er-landscape'(h) {
    for (const id of Object.keys(NEW)) await playAll(h, id, LANDSCAPE, `er-landscape-${id}`);
  },

  async 'skills-er-comfort-exits'(h) {
    const { ctx, page, errors } = await h.open(seedFor(h, returning(12)), '?mute', PHONE);
    try {
      await library(h, page);
      for (const exit of ['Something soothing', 'Safe Zone']) {
        const before = await progress(h, page, 'problem-solving');
        await openFromLibrary(h, page, 'problem-solving');
        for (const label of ['Begin', 'Heavy right now', exit]) await tap(page, label);
        if (exit === 'Something soothing') {
          await page.locator('.dq-intro-real', { hasText: /^Self-Soothe$/ }).waitFor();
          await page.getByRole('button', { name: 'Leave this skill' }).click();
        } else {
          await page.getByRole('button', { name: 'Talk to someone now', exact: true }).waitFor();
          h.expect(!(await page.locator('.dq-gain').count()), 'Safe Zone showed a reward');
          await page.getByRole('button', { name: 'Leave', exact: true }).click();
        }
        h.expect((await progress(h, page, 'problem-solving')).uses === before.uses + 1, exit + ': practice credit was lost');
        await library(h, page);
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally { await ctx.close(); }
  },

  async 'skills-er-custom-values'(h) {
    const { ctx, page, errors } = await h.open(seedFor(h, returning(12)), '?mute', SMALL);
    try {
      await library(h, page);
      for (const value of ['constructor', '__proto__', 'toString', 'A'.repeat(160)]) {
        await openFromLibrary(h, page, 'long-term-positives');
        await walk(h, page, 'er-own-value-' + value.slice(0, 12), [
          { do: ['tap', 'Begin'] },
          { do: ['other', 'My own', value] },
          { see: 'One small project', do: ['tap', 'One small project'] },
          { do: ['tap', 'Skip'] },
          { see: "First step: Pick one when you're ready.", do: ['tap', 'Next'] },
          { do: ['tap', 'Only planning'] },
        ]);
        await tap(page, 'Another skill');
        await openFromLibrary(h, page, 'emotion-myths');
        await walk(h, page, 'er-own-myth-' + value.slice(0, 12), [
          { do: ['tap', 'Begin'] },
          { do: ['other', 'A different one', value] },
          { see: "Feelings aren't rules or verdicts", do: ['tap', 'Next'] },
          { do: ['tap', 'Partly'] },
          { do: ['tap', 'Skip'] },
          { do: ['tap', 'Done'] },
        ]);
        await tap(page, 'Another skill');
      }
      h.expect(!errors.length, errors.join('\n'));
    } finally { await ctx.close(); }
  },

  async 'skills-er-mute-reduced'(h) {
    const { ctx, page, errors } = await h.open(seedFor(h, returning(12)), '?mute', PHONE);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    h.expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'reduced motion is not on');
    await library(h, page);
    for (const id of Object.keys(NEW)) {
      const before = await progress(h, page, id);
      await openFromLibrary(h, page, id);
      await walk(h, page, `er-still-${id}`, PATHS[id][0].steps);
      h.expect((await progress(h, page, id)).uses === before.uses + 1, `${id} not credited with reduced motion`);
      await tap(page, 'Another skill');
      await page.locator('.dq-library').waitFor({ timeout: 10000 });
    }
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'skills-er-old-save'(h) {
    const old = returning(20, [['skill', 20, { stat: 'intelligence', skill: 'check-facts' }], ['skill', 20, { stat: 'stamina', skill: 'a-skill-from-a-newer-build' }], ['card', 0, { skill: 'current-emotion' }]]);
    const { ctx, page, errors } = await h.open(seedFor(h, old), '?mute', PHONE);
    await home(h, page);
    await page.locator('.dq-tile', { has: page.locator('.dq-tile-t', { hasText: /^Shadows$/ }) }).click();
    await page.locator('.dq-shadows').waitFor({ timeout: 10000 });
    const owned = norm(await page.locator('.dq-shadows').textContent());
    h.expect(owned.includes('True Sight') && owned.includes('Ebb and Flow'), 'old save lost its collection');
    for (const { sl } of Object.values(NEW)) h.expect(!owned.includes(sl), `${sl} is in the collection before it was ever opened`);
    await h.shot(page, 'er-old-save-01-shadows-before');
    await page.getByRole('button', { name: 'All skills' }).click();
    await page.locator('.dq-library').waitFor({ timeout: 10000 });
    await h.shot(page, 'er-old-save-02-library');
    for (const id of Object.keys(NEW)) {
      await openFromLibrary(h, page, id);
      await page.getByRole('button', { name: 'Leave this skill' }).click();
      await library(h, page);
    }
    await page.getByRole('button', { name: /Lantern/ }).first().click();
    await home(h, page);
    await page.locator('.dq-tile', { has: page.locator('.dq-tile-t', { hasText: /^Shadows$/ }) }).click();
    await page.locator('.dq-shadows').waitFor({ timeout: 10000 });
    for (const { sl, real } of Object.values(NEW)) {
      const card = page.locator('.dq-cardbtn', { has: page.locator('.dq-cf-name', { hasText: new RegExp(`^${sl}$`) }) });
      h.expect((await card.count()) === 1, `${sl} did not join Shadows`);
      h.expect(norm(await card.textContent()).includes(real) && norm(await card.textContent()).includes('Practised 1x'), `${sl} card is missing its DBT name or count`);
    }
    await h.shot(page, 'er-old-save-03-shadows-after');
    await page.getByRole('button', { name: /Lantern/ }).first().click();
    await home(h, page);
    await page.locator('.dq-tile', { has: page.locator('.dq-tile-t', { hasText: /^Diary card$/ }) }).click();
    const used = page.locator('.dq-skillsused');
    await used.waitFor({ timeout: 10000 });
    const list = norm(await used.textContent());
    for (const { sl, real } of Object.values(NEW)) h.expect(list.includes(`${sl} (${real})`), `diary card does not list ${sl} (${real}): ${list}`);
    await h.shot(page, 'er-old-save-04-diary');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'skills-er-rotation'(h) {
    const probe = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', PHONE);
    const rotation = await probe.page.evaluate(async () => (await import('/src/content/dbt.ts')).ROTATION.map((q) => (q.special ? '' : q.skill)));
    await probe.ctx.close();
    const days = Object.keys(NEW).map((id) => [id, rotation.indexOf(id)]);
    for (const [id, i] of days) h.expect(i >= 0, `${id} is not in the rotation`);
    days.push(['wrap', rotation.length]);
    for (const [id, prior] of days) {
      const { ctx, page, errors } = await h.open(seedFor(h, returning(prior)), '?mute', PHONE);
      await home(h, page);
      const before = JSON.parse(await h.ls(page, h.SAVE)).events;
      h.expect(before.filter((e) => e.k === 'skill').length === 1 && !before.some((e) => e.k === 'card'), `${id}: opening Home credited something`);
      await page.locator('.dq-card').click({ force: true });
      await page.locator('.dq-quest-acts:not(.is-hidden)').waitFor({ timeout: 5000 });
      const after = JSON.parse(await h.ls(page, h.SAVE)).events;
      h.expect(after.filter((e) => e.k === 'skill').length === 1 && after.reduce((a, e) => a + e.xp, 0) === before.reduce((a, e) => a + e.xp, 0), `${id}: flipping the card credited XP or a skill`);
      if (NEW[id]) {
        h.expect(norm(await page.locator('.dq-card .dq-cf-name').textContent()) === NEW[id].sl, `${id}: today's card is not ${NEW[id].sl}`);
        h.expect(norm(await page.locator('.dq-quest-note').textContent()) === `Shadow acquired: ${NEW[id].sl}. It joins your collection.`, `${id}: the card is not shown as new`);
        await page.locator('.dq-card').evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await h.sleep(500);
        await h.shot(page, `er-rotation-${id}`);
      }
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'skills-er-links'(h) {
    const { ctx, page, errors } = await h.open(seedFor(h, returning(12)), '?mute', PHONE);
    await library(h, page);
    await page.locator('.dq-librow', { has: page.locator('.dq-librow-n', { hasText: /^True Sight$/ }) }).click();
    for (const label of ['Begin', 'Calm or mild. Go on', 'Anger', 'Skip', 'Skip', 'Skip', 'Skip', 'Skip', 'Skip', 'Yes, it fits']) {
      await page.locator('.dq-step-body').waitFor();
      await h.sleep(250);
      await tap(page, label);
    }
    await h.sleep(300);
    await checkScreen(h, page, 'er-links-01-check-facts', 'working on the problem');
    await tap(page, 'Problem Solving');
    await page.locator('.dq-skill .dq-intro-name', { hasText: /^Keysmith$/ }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Leave this skill' }).click();
    await library(h, page);
    await page.locator('.dq-librow', { has: page.locator('.dq-librow-n', { hasText: /^Reverse Cast$/ }) }).click();
    for (const label of ['Begin', 'Fear', 'Avoid it', 'It fits, and following it helps']) {
      await h.sleep(250);
      await tap(page, label);
    }
    await h.sleep(300);
    await checkScreen(h, page, 'er-links-02-opposite-action', 'Want to work on the problem, or plan what to say?');
    await tap(page, 'Problem Solving');
    await page.locator('.dq-skill .dq-intro-name', { hasText: /^Keysmith$/ }).waitFor({ timeout: 5000 });
    h.expect((await progress(h, page, 'problem-solving')).uses === 2, 'the links did not open Problem Solving');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
