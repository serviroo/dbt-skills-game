// Room to Ask (Myths in the Way of Interpersonal Effectiveness), the Interpersonal skill of checking one belief that
// stops you asking or saying no, and finding a fairer way to see it. It sits apart from Myths About Emotions.
// beliefs-pairs: every built-in belief shows its own challenge and no other, and the review keeps it as the answer.
// Opening credits it once and finishing adds nothing.
// beliefs-own-words: a belief of your own gets a scripted reflection, not a pretend reply; your own answer and small
// step show as typed, and HTML in them stays text, never page elements. "Not sure", "This doesn't fit" and "Asking
// went badly before" all reach a warm review. Nothing typed is stored or sent.
// beliefs-safety: "Asking or saying no could get me hurt" leads with people to talk to and opens the Safe Zone talk
// screen.
// beliefs-leave: "Leave this skill" from the first screen, the challenge and a half-typed answer goes straight Home with
// one credit each time; DEAR MAN opens only after its own tap, after Done.
// beliefs-sizes: every screen at 390x844, 320x568, 844x390 and 1280x800, with the long real name and a multiline
// answer: nothing sticks out sideways or clips, and the Safe Zone button stays on screen.
import { credits, returning, toHub } from './skill-check.e2e.mjs';
import { ended, everything, has, keyTap, leave, look, offsite, openFromList, peopleFirst, plain, screen, sees, SIZES, tap, toggle } from './choose-ask-refusal-strength.e2e.mjs';

const ID = 'interpersonal-myths';
const NAME = 'Room to Ask';
const REAL = 'Myths in the Way of Interpersonal Effectiveness';
const PHONE = { width: 390, height: 844 };
const PAIRS = [
  ['They should know what I need without me saying it', 'Nobody can read minds, even people who care about you a lot. Saying it plainly gives them a fair chance to help.'],
  ["If I ask, they'll like me less", "Most people don't mind a clear, kind request. And if someone is a bit disappointed for a while, you can get through that."],
  ["Other people's needs always come first", 'Their needs count, and so do yours. Looking after yourself is part of what lets you look after others.'],
  ["If they might say no, there's no point asking", "A no answers one request. It isn't a verdict on you. Asking still shows what matters to you, and the next ask might land."],
  ["Needing help means I can't manage", 'Everyone needs things from other people. Asking is a skill, and using it takes some nerve.'],
  ['Saying no makes me a bad friend', 'A no protects your time and energy, so your yes means something. You can care about someone and still say no.'],
];
const UNSAFE = 'Asking or saying no could get me hurt';
const FACTS = ['Someone said yes', 'I said no and we were okay', 'Someone helped once they knew', 'Asking went badly before'];
const OWN_BELIEF = 'If I need something, I\'m a burden <img src=x onerror="window.__pwned=1">';
const OWN_ANSWER = 'People who care about me <b>want</b> to know. Asking gives them the chance.';
const OWN_STEP = 'Ask my sister to pick a film on Friday';
const LONG_ANSWER = 'Asking is ordinary. People ask me for things all the time and I never think less of them for it.\nSo I can give myself the same room.';
const skillEvents = async (h, page) => (JSON.parse((await h.ls(page, h.SAVE)) ?? 'null')?.events ?? []).filter((e) => e.k === 'skill');
const field = (page) => page.locator('.dq-step-body textarea, .dq-step-body input').first();

/** Plays from the first screen to the challenge, with this belief and these facts. */
async function toChallenge(h, page, where, belief, facts = []) {
  await sees(h, page, `${where}, intro`, { text: "Sometimes the hard part of asking isn't the words." });
  await tap(page, 'Begin');
  await sees(h, page, `${where}, belief`, { text: 'Which belief gets in your way most?', offers: [...PAIRS.map(([b]) => b), 'Not sure', UNSAFE, 'A different one'] });
  if (belief.own) {
    await page.locator('.dq-step-body button', { hasText: /^A different one$/ }).click();
    await page.locator('.dq-step-body .dq-other input').fill(belief.own);
    await tap(page, 'Use this');
  } else await tap(page, belief);
  await sees(h, page, `${where}, facts`, { text: "Think of times you've asked or said no before.", offers: [...FACTS, 'Next'] });
  for (const f of facts) await toggle(page, f);
  await tap(page, 'Next');
}

export const scenarios = {
  async 'beliefs-pairs'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const away = offsite(page);
    await h.reachHub(page);
    for (const [i, [belief, challenge]] of PAIRS.entries()) {
      const where = `pair ${i + 1}`;
      const before = await skillEvents(h, page);
      await openFromList(h, page, NAME, REAL);
      h.expect((await credits(h, page, ID)) === before.filter((e) => e.skill === ID).length + 1, `${where}: opening it did not credit it once`);
      await toChallenge(h, page, where, belief);
      const s = await sees(h, page, `${where}, challenge`, { text: [`The belief: "${belief}."`, `Another way to see it: ${challenge}`], offers: ['Rings true', 'Partly', "This doesn't fit"] });
      for (const [other, otherChallenge] of PAIRS) if (other !== belief) h.expect(!has(s.text, otherChallenge), `${where}: shows the challenge for "${other}" too`);
      h.expect(!has(s.text, 'Some asks really have gone badly'), `${where}: acknowledges a bad ask nobody picked`);
      await tap(page, ['Rings true', 'Partly', "This doesn't fit"][i % 3]);
      await sees(h, page, `${where}, mine`, { text: ['Want to put it in your own words?', ['Good. Keep it handy for next time.', 'Partly is a real start. Old beliefs loosen slowly.', "Thanks for being honest. You don't have to agree with it. Looking at it still counts."][i % 3]] });
      await tap(page, 'Skip');
      await sees(h, page, `${where}, try`, { text: 'One small ask or no to try this week?' });
      await tap(page, 'Next');
      // the review keeps to what was said on the challenge: a reframe the player didn't agree with is not their answer
      const answer = [`Your answer to it: ${challenge}`, `Another way to see it, in part: ${challenge}`, 'Your answer to it: Not settled yet. You looked at it honestly, and that counts.'][i % 3];
      const review = await sees(h, page, `${where}, review`, { text: [`The belief: "${belief}."`, answer, 'Beliefs loosen with practice, one small ask at a time.'], not: 'One small step:', offers: ['Done', 'Plan it with DEAR MAN'] });
      if (i % 3 === 2) h.expect(!has(review.text, challenge), `${where}: the review shows the reframe the player said doesn't fit`);
      await tap(page, 'Done');
      await ended(h, page, where, NAME);
      await toHub(h, page);
      const added = (await skillEvents(h, page)).filter((e) => !before.some((b) => b.id === e.id)).map((e) => e.skill);
      h.expect(added.length === 1 && added[0] === ID, `${where}: credited ${JSON.stringify(added)}, not ${ID} once (finishing must add nothing)`);
    }
    // it is its own skill: Myths About Emotions is still there, unchanged in name
    await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
    await page.locator('.dq-library').waitFor({ timeout: 10000 });
    const names = (await page.locator('.dq-librow-r').allTextContents()).map(plain);
    h.expect(names.includes('Myths About Emotions') && names.includes(REAL), `the Skills list does not hold both myth skills: ${JSON.stringify(names.filter((n) => /myth/i.test(n)))}`);
    h.expect(!away.length, `requests left the page: ${away.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'beliefs-own-words'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const away = offsite(page);
    await h.reachHub(page);
    // a belief of your own, with your own answer and a small step
    const before = await credits(h, page, ID);
    await openFromList(h, page, NAME, REAL);
    await toChallenge(h, page, 'own', { own: OWN_BELIEF }, ['Asking went badly before']);
    const ch = await sees(h, page, 'own, challenge', { text: [`The belief: "${OWN_BELIEF}."`, 'Beliefs like this usually start somewhere real. Is it true every single time? What would you say to a friend who believed it?', "Some asks really have gone badly, and that hurt. It doesn't mean every ask will."], not: 'Another way to see it:' });
    for (const [, c] of PAIRS) h.expect(!has(ch.text, c), 'own: a built-in challenge pretends to answer a belief of your own');
    h.expect((await page.locator('.dq-step-body img').count()) === 0 && !(await page.evaluate(() => window.__pwned)), 'own: the typed belief became a page element');
    await h.shot(page, 'beliefs-own-challenge-390x844');
    await tap(page, "This doesn't fit");
    await sees(h, page, 'own, mine', { text: ["Thanks for being honest. You don't have to agree with it.", 'What would you tell a friend who believed this?'] });
    await field(page).fill(OWN_ANSWER);
    await tap(page, 'Next');
    await field(page).fill(OWN_STEP);
    await tap(page, 'Next');
    const review = await sees(h, page, 'own, review', { text: [`The belief: "${OWN_BELIEF}."`, `Your answer to it: ${OWN_ANSWER}`, `One small step: ${OWN_STEP}.`], offers: ['Done', 'Plan it with DEAR MAN'] });
    h.expect((await page.locator('.dq-step-body img').count()) === 0 && !(await page.evaluate(() => window.__pwned)), 'own: typed words became page elements on the review');
    h.expect(!has(review.text, 'Still working on it'), 'own: the review ignored the answer you wrote');
    await h.shot(page, 'beliefs-own-review-390x844');
    await tap(page, 'Done');
    await ended(h, page, 'own', NAME);
    // a belief of your own, left without an answer, and "Not sure"
    await openFromList(h, page, NAME, REAL);
    await toChallenge(h, page, 'own blank', { own: 'Asking for things is rude' });
    await tap(page, 'Partly');
    await tap(page, 'Skip');
    await tap(page, 'Skip');
    await sees(h, page, 'own blank, review', { text: ['The belief: "Asking for things is rude."', 'Your answer to it: Still working on it, and that counts.'], not: 'One small step:' });
    await tap(page, 'Done');
    await ended(h, page, 'own blank', NAME);
    await openFromList(h, page, NAME, REAL);
    await toChallenge(h, page, 'not sure', 'Not sure', ['Someone said yes', 'Someone helped once they knew']);
    await sees(h, page, 'not sure, challenge', { text: ['Not sure is fine. These beliefs often hide in the background.', `The belief: "${PAIRS[3][0]}."`, `Another way to see it: ${PAIRS[3][1]}`], not: 'Some asks really have gone badly' });
    await tap(page, 'Rings true');
    await tap(page, 'Skip');
    await tap(page, 'Skip');
    await sees(h, page, 'not sure, review', { text: [`A belief to watch for: "${PAIRS[3][0]}."`, `Your answer to it: ${PAIRS[3][1]}`], not: 'The belief:' });
    await tap(page, 'Done');
    await ended(h, page, 'not sure', NAME);
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) - before === 3, `three walks credited it ${(await credits(h, page, ID)) - before} times, not three`);
    const stored = await everything(page);
    h.expect(!stored.includes('burden') && !stored.includes('pick a film') && !stored.includes('rude'), 'typed words were stored');
    h.expect(!away.length, `requests left the page: ${away.join(', ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'beliefs-safety'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    const before = await credits(h, page, ID);
    await openFromList(h, page, NAME, REAL);
    await tap(page, 'Begin');
    await tap(page, UNSAFE);
    await sees(h, page, 'unsafe', { text: "Then that isn't a myth to argue with. It's a real risk, and your safety comes first.", offers: ['People to talk to', 'Done'] });
    await h.shot(page, 'beliefs-unsafe-390x844');
    await peopleFirst(h, page, 'unsafe');
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) - before === 1, 'the safety path did not credit it once');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'beliefs-leave'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    await h.reachHub(page);
    const cases = {
      'the first screen': async () => {},
      'the challenge': async () => toChallenge(h, page, 'leave', PAIRS[0][0]),
      'a half-typed answer': async () => {
        await toChallenge(h, page, 'leave', PAIRS[1][0]);
        await tap(page, 'Partly');
        await field(page).fill('Most people');
      },
    };
    for (const [where, go] of Object.entries(cases)) {
      const had = await credits(h, page, ID);
      await openFromList(h, page, NAME, REAL);
      await go();
      await leave(h, page, where);
      h.expect((await credits(h, page, ID)) - had === 1, `${where}: opening and leaving credited it ${(await credits(h, page, ID)) - had} times, not once`);
    }
    // DEAR MAN is a second choice on the review, and opens only when tapped
    const had = await credits(h, page, ID);
    await openFromList(h, page, NAME, REAL);
    await toChallenge(h, page, 'dear man', PAIRS[2][0]);
    await tap(page, 'Rings true');
    await tap(page, 'Skip');
    await tap(page, 'Skip');
    await sees(h, page, 'dear man, review', { offers: ['Done', 'Plan it with DEAR MAN'] });
    const still = await screen(page);
    h.expect(has(still.text, 'Your answer to it:'), 'dear man: the review moved on by itself');
    await tap(page, 'Plan it with DEAR MAN');
    const now = plain(await page.locator('.dq-skill h1').textContent());
    h.expect(/Commander/.test(now), `dear man: the second choice opened "${now}", not DEAR MAN`);
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) - had === 1, 'dear man: following the link credited Room to Ask more than once');
    h.expect(!dialogs.length, `a browser dialog opened: ${dialogs.join('; ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'beliefs-sizes'(h) {
    const problems = [];
    const shots = [];
    for (const size of SIZES) {
      const tag = `${size.width}x${size.height}`;
      const at = (s) => `beliefs-${tag}-${s}`;
      const { ctx, page, errors } = await h.open(returning(h), '?mute', size);
      await h.reachHub(page);
      await openFromList(h, page, NAME, REAL);
      await look(h, page, problems, shots, at('01-intro'));
      await keyTap(h, page, 'Begin', at('intro'));
      await look(h, page, problems, shots, at('02-belief'));
      await keyTap(h, page, PAIRS[0][0], at('belief'));
      await keyTap(h, page, FACTS[3], at('facts'), true);
      await look(h, page, problems, shots, at('03-facts'));
      await keyTap(h, page, 'Next', at('facts'));
      await look(h, page, problems, shots, at('04-challenge'));
      await keyTap(h, page, 'Partly', at('challenge'));
      await field(page).fill(LONG_ANSWER);
      await look(h, page, problems, shots, at('05-mine'));
      await tap(page, 'Next');
      await field(page).fill(OWN_STEP);
      await look(h, page, problems, shots, at('06-try'));
      await tap(page, 'Next');
      await look(h, page, problems, shots, at('07-review'));
      await keyTap(h, page, 'Done', at('review'));
      await ended(h, page, at('end'), NAME);
      await look(h, page, problems, shots, at('08-end'));
      await openFromList(h, page, NAME, REAL);
      await tap(page, 'Begin');
      await page.locator('.dq-step-body button', { hasText: /^A different one$/ }).click();
      await page.locator('.dq-step-body .dq-other input').fill(OWN_BELIEF);
      await look(h, page, problems, shots, at('09-own'));
      await toHub(h, page);
      await openFromList(h, page, NAME, REAL);
      await tap(page, 'Begin');
      await tap(page, UNSAFE);
      await look(h, page, problems, shots, at('10-unsafe'));
      await toHub(h, page);
      h.expect(!errors.length, `${tag}: ${errors.join('\n')}`);
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
    return { shots };
  },
};
