const IDS = ['one-mindfully', 'effectively', 'mindful-thoughts'];
const NAMES = { 'one-mindfully': ['Single Target', 'One-Mindfully'], effectively: ['Play the Map', 'Effectively'], 'mindful-thoughts': ['Spectator Mode', 'Mindfulness of Current Thoughts'] };
const BANNED = /\b(disorder|diagnos\w*|symptoms?|patients?|illness|treatment|relapse)\b|game over|you died|\u2014/i;
const TOKEN = /\{(name|companion)\}/i;
const ROUTES = ['end', 'end:quiet', 'safe', 'safe:people'];
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const WIDE = { width: 844, height: 390 };
const STAT = { 'wise-mind': 'sense', 'sense-up': 'sense', 'clear-sight': 'sense', stop: 'stamina', tipp: 'stamina', 'name-emotion': 'intelligence' };
const WALKS = {
  'one-mindfully': {
    a: ['Begin', 'Wash one cup', { timer: /^Wash one cup\. Only this\./ }, 'A few times', { see: /^Wandering is normal/, tap: 'Done' }, { end: 'Not this time', thanks: /Thanks for trying it/, code: "didn't help this time" }],
    b: ['Begin', { other: 'My own', text: 'tidy my desk.' }, { timer: /^Tidy my desk\. Only this\./ }, 'Lost count', 'Done', { end: 'Yes', thanks: /helped/, code: 'helped' }],
  },
  effectively: {
    a: ['Begin', 'Something small', { chip: 'To be heard', tap: 'Next' }, 'Wanting to be right', { see: /^That makes sense/, tap: 'Ask plainly for what I need' }, { see: /^“Ask plainly for what I need\.” You picked your goal/, tap: 'Done' }, { end: 'Not this time', thanks: /Thanks for trying it/, code: "didn't help this time" }],
    b: ['Begin', 'Nothing right now', { see: /^Then picture a small one/, tap: 'Keep it in my head' }, 'Nothing much', { see: /^Clear road/, other: 'My own move', text: 'Take a walk first!' }, { see: /^“Take a walk first\.” You picked/, tap: 'Done' }, { end: 'A little', thanks: /A little counts/, code: 'helped' }],
  },
  'mindful-thoughts': {
    a: ['Begin', 'Cars on a quiet road', 'Ready', { timer: /car going past/ }, 'Next', 'Quieter', { see: /^You let some go by/, tap: 'Done' }, { end: 'Not this time', thanks: /Thanks for trying it/, code: "didn't help this time" }],
    b: ['Begin', 'Leaves on a stream', 'Ready', { timer: /sits on a leaf/ }, 'Next', 'Louder', { see: /Safe Zone is one tap away/, tap: 'Done' }, { end: 'Yes', thanks: /helped/, code: 'helped' }],
  },
};

const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
async function baseSave(h) {
  if (h.shared.me86Base) return h.shared.me86Base;
  const { ctx, page } = await h.open({ 'dbt.app.v1': h.SEEN });
  await h.reachHub(page);
  const save = JSON.parse(await h.ls(page, h.SAVE));
  await ctx.close();
  const today = save.events.find((e) => e.k === 'visit')?.day;
  h.expect(today, 'the app did not record a visit');
  return (h.shared.me86Base = { save, today });
}

async function returning(h, days = 12) {
  const { save, today } = await baseSave(h);
  const s = structuredClone(save);
  s.events = s.events.filter((e) => e.day !== today);
  if (s.flags) Object.assign(s.flags, { greetDay: '', giftDay: '', cardDay: '', checkinDay: '' });
  const old = Object.keys(STAT);
  for (let i = days; i >= 1; i--) {
    const day = addDays(today, -i), t = Date.now() - i * 86400e3, skill = old[i % old.length];
    s.events.push({ id: `me86v${i}`, t, day, k: 'visit', xp: 10 }, { id: `me86s${i}`, t: t + 1000, day, k: 'skill', xp: 20, stat: STAT[skill], skill });
  }
  h.expect(IDS.every((id) => !JSON.stringify(s).includes(id)), 'the seeded save already knows the new skills');
  return { [h.SAVE]: JSON.stringify(s), 'dbt.app.v1': h.SEEN, [h.YOU]: JSON.stringify({ name: 'Robin', companion: 'Pip', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }) };
}

async function progress(h, page, id) {
  const s = JSON.parse(await h.ls(page, h.SAVE));
  const ev = s.events;
  return {
    xp: ev.reduce((n, e) => n + Math.max(0, e.xp), 0),
    sense: ev.filter((e) => e.stat === 'sense').length,
    mine: ev.filter((e) => e.k === 'skill' && e.skill === id).length,
    owned: ev.some((e) => (e.k === 'skill' || e.k === 'card') && e.skill === id),
    feedback: ev.filter((e) => e.k === 'feedback' && e.skill === id).map((e) => e.data?.answer),
  };
}

async function home(h, page) {
  let clear = 0;
  for (let i = 0; i < 80; i++) {
    const win = page.locator('.dq-sw').first();
    if (await win.count()) {
      clear = 0;
      const b = await win.boundingBox().catch(() => null);
      if (b) await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height - 8, b.height / 2));
    } else if (!(await page.locator('.dq-scrim.is-on').count()) && (await page.locator('.dq-tile').first().isVisible().catch(() => false))) {
      if (++clear >= 4) return;
    } else clear = 0;
    await h.sleep(350);
  }
  throw new Error('Home never appeared');
}

async function tile(h, page, name) {
  await home(h, page);
  await page.locator('.dq-tile', { hasText: name }).first().click();
}

async function openFromLibrary(h, page, id) {
  await tile(h, page, 'Skills');
  const row = page.locator('.dq-librow', { hasText: NAMES[id][0] });
  await row.first().waitFor({ timeout: 5000 });
  h.expect(await row.count() === 1, `${id}: the library must list the skill exactly once`);
  h.expect((await row.textContent()).includes(NAMES[id][1]), `${id}: the library row does not show the DBT name next to the game name`);
  await row.click();
  await page.locator('.dq-intro-name', { hasText: NAMES[id][0] }).waitFor({ timeout: 10000 });
}

async function checkScreen(h, page, where) {
  const text = await page.locator('.dq-skill').innerText();
  h.expect(!TOKEN.test(text), `${where}: unfilled name token in "${text}"`);
  const bad = text.match(BANNED);
  h.expect(!bad, `${where}: "${bad?.[0]}" on screen`);
  h.expect(await page.getByRole('button', { name: 'Safe Zone, help right now' }).isVisible(), `${where}: the Safe Zone button is not one tap away`);
  const over = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out = [];
    const walker = document.createTreeWalker(document.querySelector('.dq-skill'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.closest('.dq-sr')) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const b of r.getClientRects()) if (b.width && (b.right > W + 0.5 || b.left < -0.5)) out.push(n.textContent.trim().slice(0, 40));
    }
    for (const b of document.querySelectorAll('.dq-skill button, .dq-skill input, .dq-skill textarea')) {
      const r = b.getBoundingClientRect();
      if (r.width && (r.right > W + 0.5 || r.left < -0.5)) out.push('control: ' + b.textContent.trim().slice(0, 40));
    }
    return { out, wide: document.documentElement.scrollWidth > W + 1 };
  });
  h.expect(!over.out.length && !over.wide, `${where}: content runs off the side of the screen: ${over.out.join(' | ')}`);
}

async function stepText(page) {
  return (await page.locator('.dq-step-body').innerText()).replace(/\s+/g, ' ').trim();
}

async function walk(h, page, id, steps, tag, reduced) {
  const tapIn = (name) => page.locator('.dq-skill').getByRole('button', { name, exact: true }).first();
  const settle = () => h.sleep(reduced ? 320 : 560);
  for (let i = 0; i < steps.length; i++) {
    await settle();
    const s = typeof steps[i] === 'string' ? { tap: steps[i] } : steps[i];
    const where = `${tag} screen ${i + 1}`;
    await checkScreen(h, page, where);
    await h.shot(page, `${tag}-${String(i + 1).padStart(2, '0')}`);
    const body = await stepText(page);
    if (s.see) h.expect(s.see.test(body), `${where}: expected ${s.see} in "${body}"`);
    if (s.timer) {
      h.expect(s.timer.test(body), `${where}: expected ${s.timer} in "${body}"`);
      const left = (await page.locator('.dq-timer-num').innerText()).trim();
      const secs = left.includes(':') ? Number(left.split(':')[0]) * 60 + Number(left.split(':')[1]) : Number(left);
      h.expect(secs >= 20 && secs <= 90, `${where}: timer starts at ${left}, not 20 to 90 seconds`);
      h.expect(await page.locator('.dq-timer').getByRole('button', { name: /^\+\d+ s$/ }).isVisible(), `${where}: the timer can't be extended`);
      const skip = tapIn('Next');
      h.expect((await skip.isVisible()) && (await skip.isEnabled()), `${where}: no visible way to skip the timer`);
      await skip.click();
      continue;
    }
    if (s.end) {
      await page.locator('.dq-feedback').waitFor({ timeout: 5000 });
      h.expect((await page.locator('.dq-gain').textContent()).includes('Sense +1'), `${where}: the end screen does not show Sense +1`);
      await tapIn(s.end).click();
      await page.locator('.dq-after:not(.is-hidden)').waitFor({ timeout: 5000 });
      const reply = await page.locator('.dq-skill .dq-lead').innerText();
      h.expect(s.thanks.test(reply), `${where}: "${s.end}" got "${reply}"`);
      await settle();
      await checkScreen(h, page, where + ' (after)');
      await h.shot(page, `${tag}-${String(i + 1).padStart(2, '0')}-after`);
      continue;
    }
    if (s.chip) await tapIn(s.chip).click();
    if (s.other) {
      await page.locator('.dq-skill').getByRole('button', { name: s.other }).first().click();
      const f = page.getByPlaceholder('Type your own');
      await f.fill(s.text);
      await tapIn('Use this').click();
      continue;
    }
    await tapIn(s.tap).click();
  }
}

async function play(h, id, path, vp, tag, opts = {}) {
  const { ctx, page, errors } = await h.open(await returning(h), opts.mute ? '?mute' : '', vp);
  if (opts.reduced) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    h.expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'reduced motion is not on');
  }
  await home(h, page);
  const before = await progress(h, page, id);
  h.expect(before.mine === 0 && !before.owned, `${id}: credited before it was opened`);
  await openFromLibrary(h, page, id);
  await walk(h, page, id, WALKS[id][path], tag, opts.reduced);
  const after = await progress(h, page, id);
  h.expect(after.mine === 1 && after.owned, `${id}: not credited once after playing (${after.mine})`);
  h.expect(after.xp >= before.xp + 20 && after.sense === before.sense + 1, `${id}: XP ${before.xp}->${after.xp}, Sense ${before.sense}->${after.sense}`);
  const last = WALKS[id][path].at(-1);
  h.expect(after.feedback.at(-1) === last.end, `${id}: the answer "${last.end}" was not stored`);

  await page.locator('.dq-skill').getByRole('button', { name: 'Back to the Lantern' }).click();
  await tile(h, page, 'Diary card');
  const used = page.locator('.dq-skillsused li', { hasText: `${NAMES[id][0]} (${NAMES[id][1]})` });
  await used.waitFor({ timeout: 10000 });
  h.expect((await used.textContent()).includes(last.code), `${id}: the diary card says "${await used.textContent()}"`);
  await used.scrollIntoViewIfNeeded();
  await h.shot(page, `${tag}-diary`);

  await page.goto(page.url().split('?')[0] + (opts.mute ? '?mute' : ''));
  await openFromLibrary(h, page, id);
  await page.getByRole('button', { name: 'Leave this skill' }).click();
  await home(h, page);
  const again = await progress(h, page, id);
  h.expect(again.mine === 2 && again.xp >= after.xp + 20 && again.sense === after.sense + 1, `${id}: leaving on screen one did not credit it (${again.mine}, ${after.xp}->${again.xp})`);
  await tile(h, page, 'Shadows');
  await page.getByRole('button', { name: `${NAMES[id][0]}, ${NAMES[id][1]}. Practise it.` }).waitFor({ timeout: 10000 });
  h.expect(!errors.length, errors.join('\n'));
  await ctx.close();
}

export const scenarios = {
  async 'skills-mind-content'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN });
    const r = await page.evaluate(
      async ([ids, banned, token, routes]) => {
        const { SKILL, SKILLS, ROTATION } = await import('/src/content/dbt.ts');
        const bad = new RegExp(banned, 'i'), tok = new RegExp(token);
        const out = [];
        const strings = (sk) => {
          const all = [sk.sl, sk.real, sk.card, sk.minutes];
          const keys = sk.steps.filter((st) => st.key).map((st) => st.key);
          const answers = [{}];
          for (const pickAt of [0, -1]) {
            const a = {};
            for (const st of sk.steps) if (st.kind === 'choice' && Array.isArray(st.options)) { const o = st.options.at(pickAt); a[st.key] = o.value ?? o.label; }
            answers.push(a);
          }
          answers.push(Object.fromEntries(keys.map((k) => [k, 'something of my own'])));
          for (const st of sk.steps)
            for (const v of [st.title, st.text, st.small, st.cta, st.placeholder, st.skip, st.other, st.label, st.done, ...(st.fills ?? [])]) {
              if (typeof v === 'function') for (const a of answers) all.push(v(a));
              else if (typeof v === 'string') all.push(v);
            }
          for (const st of sk.steps) if (Array.isArray(st.options)) for (const o of st.options) all.push(o.label, o.reply ?? '');
          return all;
        };
        for (const id of ids) {
          const sk = SKILL[id];
          if (!sk) { out.push(`${id}: not in SKILL`); continue; }
          if (SKILLS.filter((k) => k.id === id).length !== 1) out.push(`${id}: listed more than once`);
          if (sk.module !== 'mind' || sk.loadout || sk.art) out.push(`${id}: not a plain mindfulness skill`);
          if (!sk.sl || !sk.real || !sk.card || !sk.minutes) out.push(`${id}: missing a name, card line or time`);
          if (sk.steps[0]?.kind !== 'intro') out.push(`${id}: does not open on an intro`);
          if (sk.steps.length < 4 || sk.steps.length > 9) out.push(`${id}: ${sk.steps.length} screens`);
          const stepIds = new Set(sk.steps.map((st) => st.id).filter(Boolean));
          const lands = (go) => go === undefined || routes.includes(go) || stepIds.has(go) || (go.startsWith('skill:') && !!SKILL[go.slice(6).split('@')[0]]);
          sk.steps.forEach((st, i) => {
            if (st.kind === 'branch') out.push(`${id}: step ${i + 1} is a branch (not walkable by this check)`);
            if (!lands(st.go)) out.push(`${id}: step ${i + 1} goes to missing "${st.go}"`);
            if (Array.isArray(st.options)) for (const o of st.options) if (!lands(o.go)) out.push(`${id}: "${o.label}" goes to missing "${o.go}"`);
            if (st.kind === 'timer' && (typeof st.seconds !== 'number' || st.seconds < 20 || st.seconds > 90)) out.push(`${id}: step ${i + 1} timer is ${st.seconds} s`);
          });
          for (const t of strings(sk)) {
            if (bad.test(t)) out.push(`${id}: "${t.match(bad)[0]}" in "${t}"`);
            if (tok.test(t)) out.push(`${id}: unfilled token in "${t}"`);
          }
          if (!ROTATION.some((q) => q.skill === id)) out.push(`${id}: not in the daily rotation`);
        }
        for (const q of ROTATION) {
          if (!SKILL[q.skill]) out.push(`rotation names a missing skill "${q.skill}"`);
          else if (q.entry && !SKILL[q.skill].steps.some((st) => st.id === q.entry)) out.push(`rotation entry "${q.skill}@${q.entry}" is missing`);
        }
        return out;
      },
      [IDS, BANNED.source, TOKEN.source, ROUTES],
    );
    h.expect(!r.length, r.join('\n'));
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'skills-mind-old-save'(h) {
    const { ctx: c0, page: p0 } = await h.open({ 'dbt.app.v1': h.SEEN });
    const at = await p0.evaluate(async (id) => (await import('/src/content/dbt.ts')).ROTATION.findIndex((q) => q.skill === id), IDS[2]);
    await c0.close();
    h.expect(at >= 0, 'Spectator Mode is not in the rotation');
    const seed = await returning(h, at);
    const { ctx, page, errors } = await h.open(seed, '?mute');
    await home(h, page);
    const s = JSON.parse(await h.ls(page, h.SAVE));
    const was = JSON.parse(seed[h.SAVE]).events;
    h.expect(s.events.filter((e) => e.k === 'skill').length === was.filter((e) => e.k === 'skill').length, 'arriving credited a skill');
    h.expect(s.events.reduce((n, e) => n + e.xp, 0) >= was.reduce((n, e) => n + e.xp, 0), 'XP went down on load');
    await page.getByRole('button', { name: "Reveal today's skill card" }).click({ force: true });
    await page.locator('.dq-quest-note', { hasText: 'Shadow acquired: Spectator Mode' }).waitFor({ timeout: 10000 });
    h.expect((await page.locator('.dq-quest .dq-cardface--front').textContent()).includes('Mindfulness of Current Thoughts'), "today's card does not show the DBT name");
    await h.shot(page, 'skills-mind-old-save-card');
    await page.locator('.dq-quest-acts').getByRole('button', { name: 'Begin' }).click();
    await page.locator('.dq-intro-name', { hasText: 'Spectator Mode' }).waitFor({ timeout: 10000 });
    h.expect((await progress(h, page, IDS[2])).mine === 1, "opening today's card did not credit it");
    await page.getByRole('button', { name: 'Leave this skill' }).click();
    await tile(h, page, 'Skills');
    const rows = await page.locator('.dq-libsec.dq-mod-mind .dq-librow').allTextContents();
    for (const id of IDS) h.expect(rows.some((t) => t.includes(NAMES[id][0]) && t.includes(NAMES[id][1])), `the Mindfulness list is missing ${NAMES[id][0]}`);
    await checkScreenWidth(h, page, 'library');
    await h.shot(page, 'skills-mind-old-save-library');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'skills-mind-thoughts-same'(h) {
    const { ctx, page, errors } = await h.open(await returning(h), '?mute', PHONE);
    try {
      await openFromLibrary(h, page, 'mindful-thoughts');
      await walk(h, page, 'mindful-thoughts', [
        'Begin', 'Clouds crossing the sky', 'Ready', { timer: /Each thought is a cloud/ },
        'Next', 'About the same', { see: /^That[’']s okay\. Watching was the practice, not the quiet\./, tap: 'Done' },
        { end: 'A little', thanks: /A little counts/, code: 'helped' },
      ], 'skills-mind-thoughts-same-390', false);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'skills-mind-landscape'(h) {
    const { ctx, page, errors } = await h.open(await returning(h), '?mute', WIDE);
    for (const id of IDS) {
      await home(h, page);
      await openFromLibrary(h, page, id);
      await walk(h, page, id, WALKS[id].a, `skills-mind-${id}-844`, false);
      await page.locator('.dq-skill').getByRole('button', { name: 'Back to the Lantern' }).click();
    }
    await home(h, page);
    await openFromLibrary(h, page, 'mindful-thoughts');
    await walk(h, page, 'mindful-thoughts', WALKS['mindful-thoughts'].b.slice(0, 6), 'skills-mind-mindful-thoughts-844-louder', false);
    await page.locator('.dq-skill').getByRole('button', { name: 'Safe Zone', exact: true }).click();
    await page.getByText('Talk to someone now').first().waitFor({ timeout: 10000 });
    await h.shot(page, 'skills-mind-mindful-thoughts-844-safe');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};

async function checkScreenWidth(h, page, where) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  h.expect(!wide, `${where}: the page scrolls sideways`);
}

for (const id of IDS) {
  scenarios[`skills-mind-${id}-390`] = (h) => play(h, id, 'a', PHONE, `skills-mind-${id}-390`);
  scenarios[`skills-mind-${id}-320`] = (h) => play(h, id, 'b', SMALL, `skills-mind-${id}-320`, { mute: true, reduced: true });
}
