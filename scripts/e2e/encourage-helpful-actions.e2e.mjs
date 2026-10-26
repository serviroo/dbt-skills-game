// Small Steps (Reinforcement and Shaping), applied to yourself: one helpful action, a first step small enough for a low
// day, and a small free reward straight after it. small-plans: a scripted plan, a plan in your own words (shown
// literally, markup and all), a smaller step chosen twice and "Not today" all finish with exactly one credit for
// opening; revising and finishing add nothing and XP never drops. small-sizes: every screen at four sizes.
import { credits, returning, toHub } from './skill-check.e2e.mjs';
import { ended, leave, look, openFromList, sees, SIZES, tap } from './choose-ask-refusal-strength.e2e.mjs';

const ID = 'reinforcement';
const NAME = 'Small Steps';
const REAL = 'Reinforcement and Shaping';
const PHONE = { width: 390, height: 844 };
const xp = (page) => page.evaluate(() => window.__daily.store.derived().xp);
const events = async (h, page) => (JSON.parse((await h.ls(page, h.SAVE)) ?? 'null')?.events ?? []).length;
async function own(page, text) {
  await page.locator('.dq-step-body button', { hasText: /^My own$/ }).click();
  await page.locator('.dq-step-body .dq-other input').fill(text);
  await tap(page, 'Use this');
}

export const scenarios = {
  async 'small-plans'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    // a scripted plan
    let n = await events(h, page);
    const x0 = await xp(page);
    await openFromList(h, page, NAME, REAL);
    h.expect((await events(h, page)) === n + 1, 'opening it did not add exactly one credit');
    n = await events(h, page);
    await tap(page, 'Begin');
    await tap(page, 'Start a task I keep putting off');
    await sees(h, page, 'first', { text: 'Make the first step of "Start a task I keep putting off" small enough', offers: ['Open it and write one line', 'Set a timer for two minutes', 'Get out what I need', 'My own'] });
    await tap(page, 'Open it and write one line');
    await sees(h, page, 'reward', { text: 'Rest, food, care and people never have to be earned.', offers: ['A favourite song', 'A few minutes of a show I like', 'A chapter of a book', 'A round of a game I like', 'Time on a hobby', 'My own'] });
    await tap(page, 'A favourite song');
    await sees(h, page, 'link', { text: 'Picture it now, or say it in words: open it and write one line, then a favourite song.', offers: ['Straight after, got it', 'Make the step smaller'] });
    await tap(page, 'Straight after, got it');
    await sees(h, page, 'plan', { text: ['Helpful action: Start a task I keep putting off.', 'First small step: Open it and write one line.', 'Then, straight after: A favourite song.', "It's shaping, and each small step counts."], not: ['proof', 'lose', 'XP'], offers: ['Done', 'Make the step smaller'] });
    await tap(page, 'Done');
    await ended(h, page, 'scripted', NAME);
    h.expect((await events(h, page)) === n, 'finishing added an event');
    // your own words, shown literally
    await openFromList(h, page, NAME, REAL);
    await tap(page, 'Begin');
    await own(page, 'Water the <b>plants</b>');
    await sees(h, page, 'own first', { text: 'Make the first step of "Water the <b>plants</b>" small enough', offers: ['Do the very first bit', 'Two minutes of it', 'Get out what I need', 'My own'] });
    await own(page, 'Fill the can');
    await own(page, 'Sit in the sun for <i>one</i> minute');
    await tap(page, 'Straight after, got it');
    await sees(h, page, 'own plan', { text: ['Helpful action: Water the <b>plants</b>.', 'First small step: Fill the can.', 'Then, straight after: Sit in the sun for <i>one</i> minute.'] });
    h.expect((await page.locator('.dq-step-body b:text("plants"), .dq-step-body i:text("one")').count()) === 0, 'typed markup became page elements');
    await tap(page, 'Done');
    // a smaller step, twice, with no extra credit
    n = await events(h, page);
    await openFromList(h, page, NAME, REAL);
    n += 1;
    await tap(page, 'Begin');
    await tap(page, 'Move my body a bit');
    await tap(page, 'Walk to the end of the street');
    await tap(page, 'A chapter of a book');
    await tap(page, 'Make the step smaller');
    await sees(h, page, 'smaller', { text: 'Smaller is smart.', offers: ['One minute of it', 'Stand up once', 'Roll my shoulders', 'My own'] });
    await tap(page, 'One minute of it');
    await sees(h, page, 'revised plan', { text: ['First small step: One minute of it.', 'Then, straight after: A chapter of a book.'], not: 'Walk to the end of the street' });
    await tap(page, 'Make the step smaller');
    await sees(h, page, 'smaller again', { offers: ['Stand up once', 'Roll my shoulders', 'My own'] });
    await tap(page, 'Roll my shoulders');
    await sees(h, page, 'revised again', { text: 'First small step: Roll my shoulders.' });
    // the smallest step has nothing smaller: the plan stays, and never grows
    await tap(page, 'Make the step smaller');
    await sees(h, page, 'smallest', { text: "That's already about as small as a step gets", offers: ['Back to my plan'] });
    await tap(page, 'Back to my plan');
    await sees(h, page, 'plan kept', { text: 'First small step: Roll my shoulders.' });
    h.expect((await events(h, page)) === n, 'revising the plan added an event');
    await tap(page, 'Done');
    await ended(h, page, 'smaller', NAME);
    // not today
    await openFromList(h, page, NAME, REAL);
    await tap(page, 'Begin');
    await tap(page, 'Not today');
    await sees(h, page, 'not today', { text: "That's okay. Today can just be today." });
    await tap(page, 'Done');
    await ended(h, page, 'not today', NAME);
    await toHub(h, page);
    h.expect((await xp(page)) >= x0, 'XP went down');
    // Leave on the first screen keeps the one credit
    const had = await credits(h, page, ID);
    await openFromList(h, page, NAME, REAL);
    await leave(h, page, 'first screen');
    h.expect((await credits(h, page, ID)) === had + 1, 'opening and leaving did not credit it once');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'small-sizes'(h) {
    const problems = [];
    const shots = [];
    for (const size of SIZES) {
      const at = (s) => `small-${size.width}x${size.height}-${s}`;
      const { ctx, page, errors } = await h.open(returning(h), '?mute', size);
      await h.reachHub(page);
      await openFromList(h, page, NAME, REAL);
      await look(h, page, problems, shots, at('01-intro'));
      await tap(page, 'Begin');
      await look(h, page, problems, shots, at('02-action'));
      await tap(page, 'Reply to messages');
      await look(h, page, problems, shots, at('03-first'));
      await own(page, 'Reply to the one from my cousin about the weekend plans');
      await look(h, page, problems, shots, at('04-reward'));
      await tap(page, 'A round of a game I like');
      await look(h, page, problems, shots, at('05-link'));
      await tap(page, 'Make the step smaller');
      await look(h, page, problems, shots, at('06-smaller'));
      await tap(page, 'Open the messages app');
      await look(h, page, problems, shots, at('07-plan'));
      await tap(page, 'Done');
      await ended(h, page, at('end'), NAME);
      await toHub(h, page);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
    return { shots };
  },
};
