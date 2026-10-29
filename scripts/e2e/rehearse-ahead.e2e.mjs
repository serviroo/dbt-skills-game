// Ready the Path (Cope Ahead), the Emotion Regulation skill of rehearsing a hard moment before it comes: the facts,
// what might show up, a plan and its words, two rehearsals (the plan, then a snag) and a settling pause.
// cope-walk: a concrete example carries every answer into both rehearsals and the plan at the end; the timers skip and
// take +15 s; one credit for opening, none for finishing. cope-blank: nothing typed, an own plan, still a full plan.
// cope-too-much: "This feels too much" leads with People to talk to and opens the talk screen. cope-leave: Leave from
// the first screen and from a running rehearsal goes straight Home with one credit. ABC PLEASE keeps its short C path.
// cope-sizes: every screen at 390x844, 320x568, 844x390 and 1280x800 with long answers, nothing clipped.
import { credits, returning, toHub } from './skill-check.e2e.mjs';
import { ended, leave, look, openFromList, peopleFirst, plain, sees, SIZES, tap, toggle } from './choose-ask-refusal-strength.e2e.mjs';

const ID = 'cope-ahead';
const NAME = 'Ready the Path';
const REAL = 'Cope Ahead';
const MOD = 'Emotion';
const PHONE = { width: 390, height: 844 };
const field = (page) => page.locator('.dq-step-body textarea, .dq-step-body input:not([type=range])').first();
const startTimer = (page) => page.locator('.dq-step-body .dq-timer .dq-actions .dq-btn--primary', { hasText: /start/i }).first().click();
const num = async (page) => plain(await page.locator('.dq-step-body .dq-timer-num').textContent());

export const scenarios = {
  async 'cope-walk'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await page.clock.install();
    await page.reload();
    await h.reachHub(page);
    const had = await credits(h, page, ID);
    await openFromList(h, page, NAME, REAL, MOD);
    h.expect((await credits(h, page, ID)) === had + 1, 'opening it did not credit it once');
    await sees(h, page, 'intro', { text: 'Not a crisis: something you can practise for.' });
    await tap(page, 'Begin');
    await sees(h, page, 'what', { text: 'Stick to the facts' });
    await field(page).fill('a meeting with my manager on Monday');
    await tap(page, 'Next');
    await sees(h, page, 'feel', { text: 'What might show up for you there?' });
    await toggle(page, 'Worry');
    await toggle(page, 'An urge to leave');
    await tap(page, 'Next');
    await tap(page, 'Slow breathing');
    await field(page).fill('I can take a breath before I answer');
    await tap(page, 'Next');
    await sees(h, page, 'picture', { text: ["Imagine you're there now: a meeting with my manager on Monday.", 'Notice worry and an urge to leave starting.', 'using your plan: slow breathing, and saying "I can take a breath before I answer".', 'Words or sounds are fine'] });
    h.expect((await num(page)) === '30', `the first rehearsal shows ${await num(page)}, not 30`);
    await h.pauseClock(page);
    await startTimer(page);
    await page.clock.runFor(2500);
    await page.locator('.dq-step-body .dq-timer button', { hasText: /^\+15 s$/ }).click();
    await page.clock.runFor(1000);
    h.expect((await num(page)) === '42', `after +15 s the rehearsal shows ${await num(page)}, not 42`);
    await tap(page, 'Next');
    await sees(h, page, 'snag', { text: 'Now add one snag.' });
    await tap(page, 'I freeze');
    await sees(h, page, 'snag rehearsal', { text: ['Picture this happening: I freeze.', 'staying with your plan anyway: slow breathing.', 'Coping is the goal.'] });
    await tap(page, 'Next');
    await sees(h, page, 'settle', { text: 'Let the scene go.' });
    await tap(page, 'Next');
    await sees(h, page, 'ready', { text: ['Coming up: A meeting with my manager on Monday.', 'Might show up: Worry and an urge to leave.', 'Your plan: Slow breathing.', 'Your words: "I can take a breath before I answer"', 'If it snags: I freeze.'], offers: ['Done', 'Plan the words with DEAR MAN'] });
    await tap(page, 'Done');
    await ended(h, page, 'walk', NAME);
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) === had + 1, 'finishing added a credit');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'cope-blank'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    await openFromList(h, page, NAME, REAL, MOD);
    await tap(page, 'Begin');
    await tap(page, 'Keep it in my head');
    await tap(page, 'Next');
    await page.locator('.dq-step-body button', { hasText: /^My own$/ }).click();
    await page.locator('.dq-step-body .dq-other input').fill('Count five things I can see');
    await tap(page, 'Use this');
    await tap(page, 'Skip');
    await sees(h, page, 'picture', { text: ["Imagine you're there now. Notice whatever comes up starting.", 'using your plan: Count five things I can see.'], not: ['saying', 'undefined'] });
    await tap(page, 'Next');
    await tap(page, 'They react badly');
    await tap(page, 'Next');
    await tap(page, 'Next');
    await sees(h, page, 'ready', { text: ['Might show up: Whatever comes up.', 'Your plan: Count five things I can see.', 'If it snags: They react badly.'], not: ['Coming up:', 'Your words:', 'undefined'] });
    await tap(page, 'Done');
    await ended(h, page, 'blank', NAME);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'cope-too-much'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    const had = await credits(h, page, ID);
    await openFromList(h, page, NAME, REAL, MOD);
    await tap(page, 'Begin');
    await tap(page, 'Keep it in my head');
    await page.locator('.dq-step-body .dq-opt', { hasText: /^This feels too much$/ }).click();
    await sees(h, page, 'too much', { text: "Some things are too big to rehearse on your own, and you don't have to.", offers: ['People to talk to', 'Done'] });
    await peopleFirst(h, page, 'too much');
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) === had + 1, 'the too-much path did not credit it once');
    // ABC PLEASE keeps its own short C path
    const abc = await page.evaluate(async () => (await import('/src/content/dbt.ts')).SKILL['abc-please'].steps.map((s) => s.id).filter(Boolean));
    h.expect(['c', 'rehearse', 'shoulders'].every((id) => abc.includes(id)), `ABC PLEASE lost its C path: ${abc.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'cope-leave'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    await h.reachHub(page);
    for (const [where, go] of [['the first screen', async () => {}], ['a running rehearsal', async () => { await tap(page, 'Begin'); await tap(page, 'Keep it in my head'); await tap(page, 'Next'); await tap(page, 'Slow breathing'); await tap(page, 'Skip'); await startTimer(page); }]]) {
      const had = await credits(h, page, ID);
      await openFromList(h, page, NAME, REAL, MOD);
      await go();
      await leave(h, page, where);
      h.expect((await credits(h, page, ID)) === had + 1, `${where}: opening and leaving did not credit it once`);
    }
    h.expect(!dialogs.length, `a dialog opened: ${dialogs.join('; ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'cope-sizes'(h) {
    const problems = [];
    const shots = [];
    for (const size of SIZES) {
      const at = (s) => `cope-${size.width}x${size.height}-${s}`;
      const { ctx, page, errors } = await h.open(returning(h), '?mute', size);
      await h.reachHub(page);
      await openFromList(h, page, NAME, REAL, MOD);
      await look(h, page, problems, shots, at('01-intro'));
      await tap(page, 'Begin');
      await field(page).fill('the long family dinner on Sunday where everyone talks over each other');
      await look(h, page, problems, shots, at('02-what'));
      await tap(page, 'Next');
      await toggle(page, 'An urge to shut down');
      await look(h, page, problems, shots, at('03-feel'));
      await tap(page, 'Next');
      await look(h, page, problems, shots, at('04-plan'));
      await tap(page, 'Take a short break');
      await field(page).fill("I need five minutes outside, then I'll come back to the table");
      await look(h, page, problems, shots, at('05-words'));
      await tap(page, 'Next');
      await startTimer(page);
      await look(h, page, problems, shots, at('06-picture'));
      await tap(page, 'Next');
      await look(h, page, problems, shots, at('07-snag'));
      await tap(page, 'It takes longer than I hoped');
      await look(h, page, problems, shots, at('08-snag-rehearse'));
      await tap(page, 'Next');
      await look(h, page, problems, shots, at('09-settle'));
      await tap(page, 'Next');
      await look(h, page, problems, shots, at('10-ready'));
      await tap(page, 'Done');
      await ended(h, page, at('end'), NAME);
      await openFromList(h, page, NAME, REAL, MOD);
      await tap(page, 'Begin');
      await tap(page, 'Keep it in my head');
      await page.locator('.dq-step-body .dq-opt', { hasText: /^This feels too much$/ }).click();
      await look(h, page, problems, shots, at('11-too-much'));
      await toHub(h, page);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
    return { shots };
  },
};
