// Open Path (Willingness and Wilfulness), the Distress Tolerance skill of noticing when you dig in and choosing one
// open step, and Urge Surfing putting support first when an urge climbs or doesn't move.
// willing-walks: a willing step, a boundary, asking for help and "Not ready yet" each finish warmly with one credit;
// "It's all too much right now" leads with People to talk to. surf-support: real sliders drive Urge Surfing: lower keeps
// its own finish, the same and higher lead with People to talk to, which opens the talk screen with tel: links, adds no
// credit inside, and Leave is immediate. willing-sizes: every screen at four sizes, nothing clipped.
import { credits, returning, toHub } from './skill-check.e2e.mjs';
import { ended, leave, look, openFromList, peopleFirst, plain, screen, sees, SIZES, tap } from './choose-ask-refusal-strength.e2e.mjs';

const ID = 'willingness';
const NAME = 'Open Path';
const REAL = 'Willingness and Wilfulness';
const MOD = 'Distress';
const PHONE = { width: 390, height: 844 };
const field = (page) => page.locator('.dq-step-body textarea, .dq-step-body input:not([type=range])').first();
const skills = async (h, page) => (JSON.parse((await h.ls(page, h.SAVE)) ?? 'null')?.events ?? []).filter((e) => e.k === 'skill').length;

async function walk(h, page, { stuck, fact, change, step, how, ready }) {
  await openFromList(h, page, NAME, REAL, MOD);
  await sees(h, page, 'intro', { text: "it's a moment to notice, not a label for you" });
  await tap(page, 'Begin');
  await tap(page, stuck);
  if (fact) await field(page).fill(fact);
  await tap(page, fact ? 'Next' : 'Skip');
  await tap(page, change);
  await sees(h, page, 'hands', { text: 'rest your hands open' });
  await tap(page, 'Next');
  await sees(h, page, 'step', { text: ["What's one willing step from here?", "Saying no, stepping away from harm and asking for help can all be willing."] });
  await tap(page, step);
  await sees(h, page, 'how', { text: `How will you start "${step}"?` });
  if (how) await field(page).fill(how);
  await tap(page, how ? 'Next' : 'Skip');
  const s = await sees(h, page, 'open', { text: [`One willing step: ${step}.`, 'How ready do you feel?'] });
  if (fact) h.expect(plain(s.text).includes(`What's here: ${fact.charAt(0).toUpperCase()}${fact.slice(1)}.`), 'the review does not show the fact');
  if (how) h.expect(plain(s.text).includes(`First move: ${how.charAt(0).toUpperCase()}${how.slice(1)}.`), 'the review does not show the first move');
  await tap(page, ready);
}

export const scenarios = {
  async 'willing-walks'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    const cases = [
      [{ stuck: 'A step I know would help', fact: 'the forms are due on Friday and I have not started', change: 'Some of it', step: 'Do the next small thing', how: 'open the first form', ready: 'Ready to try' }, 'You picked an open step.'],
      [{ stuck: 'Something that already happened', change: 'Not right now', step: 'Set a boundary', ready: 'Ready to try' }, 'You picked an open step.'],
      [{ stuck: "Something I can't change today", change: 'Not sure', step: 'Ask someone for help', how: 'text my sister', ready: 'Not ready yet' }, 'Noticing the digging in is the first part'],
    ];
    for (const [c, close] of cases) {
      const had = await credits(h, page, ID);
      await walk(h, page, c);
      await sees(h, page, `${c.step} close`, { text: close });
      await tap(page, 'Done');
      await ended(h, page, c.step, NAME);
      await toHub(h, page);
      h.expect((await credits(h, page, ID)) === had + 1, `${c.step}: credited ${(await credits(h, page, ID)) - had} times, not once`);
    }
    const had = await credits(h, page, ID);
    await openFromList(h, page, NAME, REAL, MOD);
    await tap(page, 'Begin');
    await tap(page, "It's all too much right now");
    await sees(h, page, 'too much', { offers: ['People to talk to', 'Done'] });
    await peopleFirst(h, page, 'too much');
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) === had + 1, 'the too-much path did not credit it once');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'surf-support'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    for (const [before, after, want] of [[5, 2, 'lower'], [5, 5, 'long'], [2, 8, 'long']]) {
      const where = `Urge Surfing ${before} then ${after}`;
      await openFromList(h, page, 'Wave Rider', 'Ride the Wave (Urge Surfing)', MOD);
      await tap(page, 'Begin');
      await tap(page, 'Chest');
      await page.locator('.dq-step-body input[type=range]').fill(String(before));
      await tap(page, 'Next');
      await tap(page, 'Next');
      await page.locator('.dq-step-body input[type=range]').fill(String(after));
      await tap(page, 'Next');
      const s = await screen(page);
      if (want === 'lower') {
        h.expect(plain(s.text).includes('See? It moved. You rode it.') && s.offers[0] === 'Done', `${where}: lower did not keep its own finish (${JSON.stringify(s.offers)})`);
        await tap(page, 'Done');
        await ended(h, page, where, 'Wave Rider');
        continue;
      }
      h.expect(plain(s.text).includes("If it's still climbing, you don't have to ride it alone"), `${where}: not the long-wave screen: ${plain(s.text).slice(0, 160)}`);
      h.expect(s.offers.map(plain).join('|') === 'People to talk to|Done|Another round|TIPP', `${where}: offers ${JSON.stringify(s.offers)}, not people first`);
      await h.shot(page, `surf-${before}-${after}-390x844`);
      const n = await skills(h, page);
      await peopleFirst(h, page, where);
      const tel = await page.locator('.dq a[href^="tel:"]').count();
      h.expect(tel > 0, `${where}: the talk screen has no tel: links`);
      h.expect((await skills(h, page)) === n, `${where}: going to the Safe Zone added a credit`);
      await toHub(h, page);
    }
    h.expect(!dialogs.length, `a dialog opened: ${dialogs.join('; ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'willing-sizes'(h) {
    const problems = [];
    const shots = [];
    for (const size of SIZES) {
      const at = (s) => `willing-${size.width}x${size.height}-${s}`;
      const { ctx, page, errors } = await h.open(returning(h), '?mute', size);
      await h.reachHub(page);
      await openFromList(h, page, NAME, REAL, MOD);
      await look(h, page, problems, shots, at('01-intro'));
      await tap(page, 'Begin');
      await look(h, page, problems, shots, at('02-stuck'));
      await tap(page, 'A step I know would help');
      await field(page).fill('the washing up has been piling up all week and I keep walking past it');
      await look(h, page, problems, shots, at('03-fact'));
      await tap(page, 'Next');
      await look(h, page, problems, shots, at('04-change'));
      await tap(page, 'Some of it');
      await look(h, page, problems, shots, at('05-hands'));
      await tap(page, 'Next');
      await look(h, page, problems, shots, at('06-step'));
      await tap(page, 'Step away from something harmful');
      await field(page).fill('close the app and put the phone in the other room');
      await look(h, page, problems, shots, at('07-how'));
      await tap(page, 'Next');
      await look(h, page, problems, shots, at('08-open'));
      await tap(page, 'Ready to try');
      await look(h, page, problems, shots, at('09-ready'));
      await tap(page, 'Done');
      await ended(h, page, at('end'), NAME);
      await openFromList(h, page, NAME, REAL, MOD);
      await tap(page, 'Begin');
      await tap(page, "It's all too much right now");
      await look(h, page, problems, shots, at('10-too-much'));
      await leave(h, page, at('leave'));
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
    return { shots };
  },
};
