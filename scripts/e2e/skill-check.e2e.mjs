// One content and flow check for every skill in SKILLS (src/content/dbt.ts).
// Flow, on a seeded returning save at 390x844: open the skill from the library and walk it by the first offered option
// until its own end screen. Leaving it for anything else (another skill, the Safe Zone, Home) is a problem. It must end
// within 12 taps (starting a timer doesn't count, its Next does), credit the skill exactly once, and keep every timer it
// shows skippable while it runs. Then, for every screen of that walk, the skill is opened again, walked back to that
// screen (its timer started) and left with "Leave this skill": that must reach Home with no confirm and credit it once.
// Copy, read from the skill's content object with its text functions run on many answer sets: no em dash, no diagnosis
// words (DESIGN.md principle 8), none of principle 9's wording a lint can catch, no hard-coded "Player" or unknown
// token, every timer 20 to 90 s, and cold-water or intense-exercise steps carry a caution and a "breathe instead" option
// (principle 11).
// Skills in ENFORCED fail the run. Every other skill's problems are printed as a todo list and returned, so the runner
// keeps them in report.json. Once a skill passes, add it to ENFORCED.

const ENFORCED = new Set([
  'sense-up', 'clear-sight', 'one-mindfully', 'effectively', 'mindful-thoughts', 'stop', 'pros-cons',
  'radical-acceptance', 'urge-surf', 'turning-the-mind', 'body-scan', 'alternate-rebellion', 'current-emotion',
  'problem-solving', 'long-term-positives', 'emotion-myths', 'dear-man', 'fast', 'validation', 'self-validation',
  'dialectics', 'mindfulness-of-others', 'leave-lobby', 'volume-down', 'supplies', 'cool-air', 'warm-hands',
  'absurd-scroll', 'flavour-tier', 'queue-up', 'lie-low',
  'willing-hands',
]);
const MAX_TAPS = 12;
const WORKERS = 3;
const PHONE = { width: 390, height: 844 };
const DAY = 864e5;
const COPY = {
  emDash: '—',
  diagnosis: String.raw`\b(disorders?|diagnos\w*|symptoms?|patients?|illness\w*|treatments?|relapse\w*)\b`,
  // Principle 9, as far as set phrases go. A lint can't see method or means details, guilt, or abandonment, comparison
  // and body talk said in other words; those need a person reading the copy.
  unsafe: String.raw`committed suicide|successful attempt|failed attempt|you died|game over|less fortunate`,
  abandon: String.raw`you(?:'|’| a)re on your own|you(?:'|’| a)re all alone|no(?:body| ?-?one) (?:cares|would (?:care|notice|miss you)|will (?:care|notice|miss you))|better off without you|everyone (?:leaves|gives up on you)`,
  bodyNumber: String.raw`\b\d+(?:[.,]\d+)?\s?(?:kg|kgs|kilos?|kilograms?|lbs?|pounds?|calories|kcal)\b`,
  player: String.raw`\bPlayer\b`,
  token: String.raw`\{(?!(?:name|companion)\})[^}]*\}`,
  coldOrHard: String.raw`\bcold (water|shower)|\bice\b|(?<!not )\bicy\b|\bcool shower|intense (exercise|movement)|hard exercise|fast movement|move fast|\bjog\b|sprint|jumping jacks|star jumps|burpees`,
  caution: String.raw`\bskip\b[^.]*\bif\b|heart condition`,
};

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** A player back after a few days, with names set, who has practised STOP before. */
function returning(h) {
  const now = Date.now();
  const events = [];
  for (let i = 5; i >= 1; i--) {
    const t = now - i * DAY;
    events.push({ id: `sc-v${i}`, t, day: dayKey(t), k: 'visit', xp: 10 });
    if (i % 2) events.push({ id: `sc-s${i}`, t: t + 1000, day: dayKey(t), k: 'skill', xp: 20, stat: 'stamina', skill: 'stop' });
  }
  return {
    [h.SAVE]: JSON.stringify({ v: 1, created: now - 6 * DAY, events }),
    'dbt.app.v1': h.SEEN,
    [h.YOU]: JSON.stringify({ name: 'Robin', companion: 'Pip', nameAt: now - 1000, companionAt: now - 1000 }),
  };
}

/** Problems in each skill's own copy and timers, read from the content objects in the page. */
function copyProblems(page) {
  return page.evaluate(async (src) => {
    const { SKILLS } = await import('/src/content/dbt.ts');
    const re = Object.fromEntries(Object.entries(src).map(([k, v]) => [k, new RegExp(v, k === 'player' || k === 'token' ? '' : 'i')]));
    // fields that hold ids, keys, routes or match patterns, never words on screen
    const NOT_COPY = new Set(['kind', 'id', 'key', 'go', 'value', 'effect', 'list', 'from', 'visual', 'tone', 'parts', 'pick', 'seconds', 'options']);
    const run = (f, a) => {
      try {
        return f(a);
      } catch {
        return undefined;
      }
    };
    /** Answer sets that reach every option-dependent line: each option of each choice, slider ends, own text. */
    const answerSets = (sk) => {
      const sets = [{}];
      const keys = sk.steps.filter((st) => st.key).map((st) => st.key);
      sets.push(Object.fromEntries(keys.map((k) => [k, 'something of my own'])));
      const optsOf = (st, a) => (typeof st.options === 'function' ? run(st.options, a) ?? [] : st.options ?? []);
      for (const st of sk.steps) {
        if (st.kind === 'slider') for (const v of [st.min, st.max, Math.round((st.min + st.max) / 2)]) sets.push({ [st.key]: v });
        if (st.kind === 'choice' && Array.isArray(st.options)) for (const o of st.options) sets.push({ [st.key]: st.multi ? [o.label] : o.value ?? o.label });
      }
      for (const base of [...sets]) {
        for (const st of sk.steps) {
          if (st.kind !== 'choice' || typeof st.options !== 'function') continue;
          for (const o of optsOf(st, base)) sets.push({ ...base, [st.key]: st.multi ? [o.label] : o.value ?? o.label });
        }
      }
      const filled = sets.map((a) => {
        const out = { ...a };
        for (const st of sk.steps) if (st.kind === 'choice' && st.key && !(st.key in out)) { const o = optsOf(st, out)[0]; if (o) out[st.key] = st.multi ? [o.label] : o.value ?? o.label; }
        return out;
      });
      return [...sets, ...filled].slice(0, 600);
    };
    const texts = (v, sets, acc = []) => {
      if (typeof v === 'string') acc.push(v);
      else if (typeof v === 'function') for (const a of sets) { const t = run(v, a); if (typeof t === 'string') acc.push(t); }
      else if (Array.isArray(v)) for (const x of v) texts(x, sets, acc);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!NOT_COPY.has(k)) texts(x, sets, acc);
      return acc;
    };
    const optionsOf = (st, sets) => {
      if (typeof st.options === 'function') return sets.flatMap((a) => run(st.options, a) ?? []);
      return Array.isArray(st.options) ? st.options : [];
    };
    const out = {};
    for (const sk of SKILLS) {
      const bad = new Set();
      const sets = answerSets(sk);
      const byId = new Map(sk.steps.filter((st) => st.id).map((st) => [st.id, st]));
      const lines = texts([sk.sl, sk.real, sk.card, sk.minutes], sets);
      sk.steps.forEach((st, i) => {
        const where = `step ${i + 1}`;
        const own = texts(st, sets);
        const opts = optionsOf(st, sets);
        for (const o of opts) own.push(o.label, ...(o.reply ? [o.reply] : []));
        for (const t of own) lines.push([where, t]);
        if (st.kind === 'timer') {
          const secs = new Set(typeof st.seconds === 'function' ? sets.map((a) => run(st.seconds, a)) : [st.seconds]);
          for (const n of secs) {
            if (typeof n !== 'number' || !Number.isFinite(n)) bad.add(`${where}: timer has no real length (${String(n)})`);
            else if (n < 20 || n > 90) bad.add(`${where}: timer runs ${n} s, not 20 to 90 s`);
          }
        }
        // Cold water or hard exercise, named in the step itself or in an option that has no step of its own to warn on
        const said = texts([st.title, st.text, st.big], sets).join(' ');
        const isColdOrHard = (s) => !!s && re.coldOrHard.test(texts([s.title, s.text, s.big], sets).join(' '));
        const risky = re.coldOrHard.test(said) || opts.some((o) => re.coldOrHard.test(o.label) && !isColdOrHard(byId.get(o.go)));
        if (risky) {
          const small = texts(st.small, sets).join(' ');
          if (!re.caution.test(small)) bad.add(`${where}: cold water or hard exercise with no caution`);
          if (!opts.some((o) => /breath/i.test(o.label) && byId.get(o.go)?.kind === 'breath')) bad.add(`${where}: cold water or hard exercise with no "breathe instead" option`);
        }
      });
      for (const item of lines) {
        const [where, t] = Array.isArray(item) ? item : ['card', item];
        const quote = `"${t.length > 90 ? t.slice(0, 87) + '...' : t}"`;
        if (re.emDash.test(t)) bad.add(`${where}: em dash in ${quote}`);
        const d = t.match(re.diagnosis);
        if (d) bad.add(`${where}: diagnosis word "${d[0]}" in ${quote}`);
        const u = t.match(re.unsafe);
        if (u) bad.add(`${where}: unsafe wording "${u[0]}" in ${quote}`);
        const ab = t.match(re.abandon);
        if (ab) bad.add(`${where}: abandonment cue "${ab[0]}" in ${quote}`);
        const bn = t.match(re.bodyNumber);
        if (bn) bad.add(`${where}: body, food or weight number "${bn[0]}" in ${quote}`);
        if (re.player.test(t)) bad.add(`${where}: hard-coded "Player" in ${quote}, use {name}`);
        const k = t.match(re.token);
        if (k) bad.add(`${where}: unknown token ${k[0]} in ${quote}`);
      }
      out[sk.id] = [...bad].sort((a, b) => Number(/^step (\d+)/.exec(a)?.[1] ?? 0) - Number(/^step (\d+)/.exec(b)?.[1] ?? 0));
    }
    return out;
  }, COPY);
}

const credits = async (h, page, id) => (JSON.parse((await h.ls(page, h.SAVE)) ?? 'null')?.events ?? []).filter((e) => e.k === 'skill' && e.skill === id).length;

async function toHub(h, page) {
  const at = await page.evaluate(() => document.querySelector('.dq')?.dataset.screen);
  if (at !== 'hub') await page.locator(at === 'skill' ? '.dq-top [aria-label="Leave this skill"]' : '.dq-top .dq-back').click();
  const home = await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'hub', null, { timeout: 10000 }).then(() => true, () => false);
  if (!home) throw new Error(`leaving the ${at} screen did not reach Home`);
  await h.reachHub(page);
}

async function openFromLibrary(h, page, sk) {
  await toHub(h, page);
  await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
  await page.locator('.dq-library').waitFor({ timeout: 10000 });
  const found = await page.evaluate(({ sl, real }) => {
    const plain = (t) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
    const rows = [...document.querySelectorAll('.dq-librow')].filter((r) => plain(r.querySelector('.dq-librow-n').textContent) === sl && plain(r.querySelector('.dq-librow-r').textContent) === real);
    rows.forEach((r) => r.setAttribute('data-skill-check', 'row'));
    return rows.length;
  }, { sl: sk.sl, real: sk.real });
  if (found !== 1) throw new Error(`the library lists it ${found} times`);
  await page.locator('[data-skill-check="row"]').click();
  await page.locator('.dq-skill .dq-step-body > *').first().waitFor({ timeout: 10000 });
}

/** null while the walk is still in the skill, "end" on its own end screen, otherwise where it went instead. */
const ending = (page, title) =>
  page.evaluate((t) => {
    const at = document.querySelector('.dq')?.dataset.screen;
    if (at !== 'skill') return at;
    if (document.querySelector('.dq-skill h1')?.textContent !== t) return `skill ${document.querySelector('.dq-skill h1')?.textContent}`;
    return document.querySelector('.dq-step-body .dq-intro--end') ? 'end' : null;
  }, title);

/** null when "Leave this skill" is on screen and takes a tap, otherwise what is wrong with it. */
const leaveProblem = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.dq-top button[aria-label="Leave this skill"]');
    if (!b) return 'no "Leave this skill" button';
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height || b.disabled) return '"Leave this skill" is hidden or disabled';
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) return '"Leave this skill" is off screen';
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && b.contains(hit) ? null : '"Leave this skill" is covered';
  });

/**
 * Marks the first offered option on the current step: the first answer chip, else the first button in the step's own
 * action row (not the timer's Start or +s, Copy, or the opt-in "see a version without sorry" link).
 */
const markFirst = (page) =>
  page.evaluate(() => {
    document.querySelectorAll('[data-skill-check]').forEach((e) => e.removeAttribute('data-skill-check'));
    const body = document.querySelector('.dq-step-body');
    const shown = (e) => !!e.getClientRects().length && !e.disabled && !e.closest('.is-hidden');
    const chip = [...body.querySelectorAll('.dq-opts:not(.dq-opts--fills) > .dq-opt')].find(shown);
    const acts = [...body.querySelectorAll('.dq-actions > button')].filter((b) => shown(b) && !b.closest('.dq-timer') && !b.classList.contains('ca-hl-ask') && b.textContent.trim() !== 'Copy');
    const pick = chip ?? acts[0];
    if (!pick) return null;
    pick.setAttribute('data-skill-check', 'tap');
    const next = chip?.hasAttribute('aria-pressed') ? acts.find((b) => b.textContent.trim() === 'Next') : null;
    next?.setAttribute('data-skill-check', 'then');
    return { label: pick.textContent.trim(), then: next ? 'Next' : null };
  });

/** Marks the current step's content so a tap that moves on can be told from one that stays. */
const markStep = (page, n) => page.evaluate((k) => document.querySelector('.dq-step-body')?.firstElementChild?.setAttribute('data-skill-step', String(k)), n);
const stepGone = (page, n) => page.waitForFunction((k) => !document.querySelector(`[data-skill-step="${k}"]`) || document.querySelector('.dq')?.dataset.screen !== 'skill', n, { timeout: 10000 });

/** Taps "Leave this skill": it must reach Home straight away, so a confirm or a broken leave shows up here. */
async function leave(page, where, bad) {
  const problem = await leaveProblem(page);
  if (problem) {
    bad.add(`${where}: ${problem}`);
    return false;
  }
  await page.locator('.dq-top [aria-label="Leave this skill"]').click();
  const home = await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'hub', null, { timeout: 5000 }).then(() => true, () => false);
  if (!home) bad.add(`${where}: "Leave this skill" did not go straight to Home`);
  return home;
}

/** A fresh load, for when leaving didn't work and tapping it again would only repeat the problem. */
async function reload(h, page) {
  await page.goto(h.server.url + '/?mute');
  await h.reachHub(page);
}

/**
 * Taps the first offered option on each screen until the skill's own end screen, checking each timer on the way. With
 * leaveAt, it replays the walk up to that screen instead, starts its timer if it has one, and leaves from there.
 */
async function walk(h, page, sk, bad, leaveAt = 0) {
  const title = await page.locator('.dq-skill h1').textContent();
  const path = [];
  let taps = 0;
  for (let step = 1; ; step++) {
    const end = await ending(page, title);
    if (end && leaveAt) {
      bad.add(`walk step ${leaveAt}: walking back to it ended at ${end} instead`);
      return { left: false };
    }
    if (end) {
      if (end !== 'end') bad.add(`the walk left for ${end} before the skill's end screen (${path.join(' > ')})`);
      return { taps, end, path, screens: step - 1 };
    }
    if (taps > MAX_TAPS + 20) {
      bad.add(`walk did not end after ${taps} taps (${path.join(' > ')})`);
      return { taps, end: 'never', path, screens: step - 1 };
    }
    const where = `walk step ${step}`;
    const timer = page.locator('.dq-step-body .dq-timer');
    const timed = (await timer.count()) > 0 && (!leaveAt || leaveAt === step);
    if (timed) {
      const start = timer.locator('.dq-actions .dq-btn--primary');
      if (await start.count()) await start.first().click();
    }
    if (leaveAt === step) return { left: await leave(page, where, bad) };
    if (timed) {
      const skip = page.locator('.dq-step-body > .dq-actions > button', { hasText: /^Next$/ });
      if (!((await skip.count()) && (await skip.first().isVisible()) && (await skip.first().isEnabled()))) bad.add(`${where}: the running timer has no visible Next to skip it`);
    }
    const pick = await markFirst(page);
    if (!pick) {
      bad.add(`${where}: nothing to tap`);
      await h.shot(page, `skill-check-${sk.id}-stuck`);
      return leaveAt ? { left: false } : { taps, end: 'stuck', path, screens: step };
    }
    await markStep(page, step);
    await page.locator('[data-skill-check="tap"]').click();
    taps++;
    if (pick.then) {
      await page.locator('[data-skill-check="then"]').click();
      taps++;
    }
    path.push(pick.then ? `${pick.label} + Next` : pick.label);
    await stepGone(page, step);
  }
}

async function checkSkill(h, page, sk, bad) {
  await toHub(h, page);
  const before = await credits(h, page, sk.id);
  await openFromLibrary(h, page, sk);
  const walked = await walk(h, page, sk, bad);
  if (walked.taps > MAX_TAPS) bad.add(`walk takes ${walked.taps} taps, more than ${MAX_TAPS} (${walked.path.join(' > ')})`);
  await toHub(h, page);
  let had = await credits(h, page, sk.id);
  if (had - before !== 1) bad.add(`the walk credited it ${had - before} times, not once`);
  // Opening it again credits it each time, and leaving from any screen, the first included, must keep that credit.
  for (let at = 1; at <= walked.screens; at++) {
    await openFromLibrary(h, page, sk);
    if (!(await walk(h, page, sk, bad, at)).left) await reload(h, page);
    const now = await credits(h, page, sk.id);
    if (now - had !== 1) bad.add(`walk step ${at}: opening it and leaving there credited it ${now - had} times, not once`);
    had = now;
  }
  return { taps: walked.taps, end: walked.end, path: walked.path };
}

/** One returning player on their own profile, checking a share of the skills. */
async function worker(h, list, copy, results) {
  const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(`${d.type()} "${d.message()}"`);
    d.dismiss().catch(() => {});
  });
  await h.reachHub(page);
  h.expect(!errors.length, errors.join('\n'));
  for (const sk of list) {
    const bad = new Set();
    let walked = null;
    const seen = errors.length, opened = dialogs.length;
    try {
      walked = await checkSkill(h, page, sk, bad);
    } catch (e) {
      await h.shot(page, `skill-check-${sk.id}-error`).catch(() => {});
      bad.add(`the check could not finish: ${String(e?.message ?? e).split('\n')[0]}`);
      await reload(h, page);
    }
    const alerts = [...dialogs.slice(opened).map((d) => `a browser dialog opened: ${d}`), ...errors.slice(seen).map((e) => `page error: ${e}`)];
    results[sk.id] = { name: `${sk.sl} (${sk.real})`, problems: [...new Set([...copy[sk.id], ...bad, ...alerts])], walk: walked };
  }
  await ctx.close();
}

export const scenarios = {
  // --skills=wise-mind,tipp checks only those skills.
  async 'skill-check'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', PHONE);
    const all = await page.evaluate(async () => (await import('/src/content/dbt.ts')).SKILLS.map(({ id, sl, real }) => ({ id, sl, real })));
    const unknown = [...ENFORCED].filter((id) => !all.some((s) => s.id === id));
    h.expect(!unknown.length, `ENFORCED names skills that don't exist: ${unknown.join(', ')}`);
    const only = h.flags.skills?.split(',');
    const missing = only?.filter((id) => !all.some((s) => s.id === id)) ?? [];
    h.expect(!missing.length, `--skills names skills that don't exist: ${missing.join(', ')}`);
    const skills = only ? all.filter((s) => only.includes(s.id)) : all;
    const copy = await copyProblems(page);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();

    const results = {};
    await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(h, skills.filter((_, i) => i % WORKERS === w), copy, results)));

    const failing = skills.filter((s) => results[s.id].problems.length);
    const todo = failing.filter((s) => !ENFORCED.has(s.id)).map((s) => ({ id: s.id, ...results[s.id] }));
    const broken = failing.filter((s) => ENFORCED.has(s.id));
    console.log(`skill-check: ${skills.length - failing.length} of ${skills.length} skills pass, ${ENFORCED.size} enforced`);
    if (todo.length) {
      console.log(`skill-check todo (${todo.length}):`);
      for (const t of todo) console.log(`- [ ] ${t.id}, ${t.name}\n${t.problems.map((p) => `      ${p}`).join('\n')}`);
    }
    const passing = skills.filter((s) => !results[s.id].problems.length && !ENFORCED.has(s.id)).map((s) => s.id);
    if (passing.length) console.log(`skill-check: passing but not in ENFORCED yet: ${passing.join(', ')}`);
    h.expect(!broken.length, broken.map((s) => `${s.id}: ${results[s.id].problems.join('; ')}`).join('\n'));
    return { skills: skills.length, enforced: [...ENFORCED], passing, todo, walks: Object.fromEntries(skills.map((s) => [s.id, results[s.id].walk])) };
  },
};
