// What the player types in a skill is never lost, with real taps on a returning save at 390x844 (turning the phone
// keeps it too: skill-flows' skill-answers-rotate):
//   answers-kept-back-and-return  Back by mistake, then the same step again with its own button: an answer typed in
//                                 "My own" is still there
//   answers-kept-leave-and-return leaving the skill (its close button, or Back out of it), then opening it again from
//                                 Skills, opens it where the player was with the answer typed in; Start over clears it
//   answers-kept-reload           a reload mid-skill opens Home; the skill then opens where the player was with the
//                                 answer typed in. Finishing the skill clears what was kept: Practise again starts
//                                 empty. A suggested phrase tapped onto an answer is kept too. What is kept never adds
//                                 XP or anything else to the save
import { boot, settle } from './layout-fit.e2e.mjs';

const PHONE = { width: 390, height: 844 };
const JUDGED = 'I judged the rain';
const FACT = 'It rained and I felt flat';

const field = (page) => page.locator('.dq-step-body textarea, .dq-step-body input.dq-input').first();
const value = (page) => field(page).inputValue().catch(() => 'no field');
const stepText = (page) => page.evaluate(() => document.querySelector('.dq-step-body')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '');
const screenOf = (page) => page.evaluate(() => document.querySelector('.dq')?.dataset.screen ?? null);
const onScreen = (page, name) => page.waitForFunction((n) => document.querySelector('.dq')?.dataset.screen === n && !!document.querySelector('#dq-main > *'), name, { timeout: 10000 });
const home = (page) => page.waitForFunction(() => window.__daily?.route.name === 'hub' && !!document.querySelector('.dq-tile') && !document.querySelector('.dq-sw'), null, { timeout: 30000 });
const events = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{"events":[]}').events.map((e) => e.k), key);
const kept = (page, key) => page.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith(`${k}.skill-draft.`)), key);
const tap = async (page, name) => {
  await page.locator('.dq-step-body').getByRole('button', { name, exact: true }).click();
  await settle(page);
};

async function openSkill(page, sl) {
  await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
  await onScreen(page, 'library');
  await page.locator('.dq-librow').filter({ has: page.locator('.dq-librow-n', { hasText: new RegExp(`^${sl}$`) }) }).click();
  await onScreen(page, 'skill');
  await settle(page);
}

async function typeInto(page, loc, text) {
  await loc.click();
  await page.keyboard.type(text);
}

/** Clear Sight up to its fact step, with both answers typed. */
async function upToFact(page) {
  await openSkill(page, 'Clear Sight');
  await tap(page, 'Begin');
  await typeInto(page, field(page), JUDGED);
  await tap(page, 'Next');
  await tap(page, 'Found it');
  await typeInto(page, field(page), FACT);
}

export const scenarios = {
  'answers-kept-back-and-return': async (h) => {
    const { page, errors } = await boot(h, PHONE);
    const { expect } = h;

    // Single Target: an answer typed in "My own", Back by mistake, then Begin again
    await openSkill(page, 'Single Target');
    await tap(page, 'Begin');
    await tap(page, 'My own');
    const own = page.locator('.dq-other').locator('input, textarea').first();
    await typeInto(page, own, 'Water the plant');
    await page.goBack({ waitUntil: 'commit' });
    await settle(page);
    expect(await page.locator('.dq-step-body').getByRole('button', { name: 'Begin', exact: true }).isVisible(), `Back from the first question did not show the intro: "${await stepText(page)}"`);
    await tap(page, 'Begin');
    await h.shot(page, 'answers-kept-back-1-own-answer');
    expect((await own.isVisible()) && (await own.inputValue()) === 'Water the plant', `Back, then Begin again, lost the answer typed in "My own": "${await own.inputValue().catch(() => 'no field')}"`);
    expect(!errors.length, errors.join('\n'));
  },

  'answers-kept-leave-and-return': async (h) => {
    const { page, errors } = await boot(h, PHONE);
    const { expect } = h;
    const skills = (await events(page, h.SAVE)).filter((k) => k === 'skill').length;

    // Clear Sight: leave with the close button, then open it again from Skills
    await upToFact(page);
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await onScreen(page, 'hub');
    await settle(page);
    await openSkill(page, 'Clear Sight');
    await h.shot(page, 'answers-kept-back-2-reopened');
    expect(/facts and feelings/.test(await stepText(page)) && (await value(page)) === FACT, `opening the skill again did not bring back the typed answer: "${await stepText(page)}" "${await value(page)}"`);
    expect(await page.locator('.dq-step-body').getByRole('button', { name: 'Start over', exact: true }).isVisible(), 'the skill opened where the player was, with no way to start over');

    // Back out of it with the phone's Back, then open it again: still there
    await page.goBack({ waitUntil: 'commit' });
    await onScreen(page, 'library');
    await page.locator('.dq-librow').filter({ has: page.locator('.dq-librow-n', { hasText: /^Clear Sight$/ }) }).click();
    await onScreen(page, 'skill');
    await settle(page);
    expect((await value(page)) === FACT, `Back out of the skill and in again lost the typed answer: "${await value(page)}"`);

    // Start over: the intro again, every field empty, nothing kept
    await tap(page, 'Start over');
    expect(await page.locator('.dq-step-body').getByRole('button', { name: 'Begin', exact: true }).isVisible(), `Start over did not open the intro: "${await stepText(page)}"`);
    expect(!(await kept(page, h.SAVE)).length, `Start over left the answers kept: ${await kept(page, h.SAVE)}`);
    await tap(page, 'Begin');
    expect((await value(page)) === '', `after Start over the first answer was still typed in: "${await value(page)}"`);
    // every open is credited as before, Start over as a new practice: what was kept adds nothing
    const added = (await events(page, h.SAVE)).filter((k) => k === 'skill').length - skills;
    expect(added === 4, `expected 4 skill credits (three opens and Start over), got ${added}`);
    expect(!errors.length, errors.join('\n'));
  },

  'answers-kept-reload': async (h) => {
    const { page, errors } = await boot(h, PHONE);
    const { expect } = h;
    await upToFact(page);
    const before = await events(page, h.SAVE);
    await page.reload();
    await home(page);
    await settle(page);
    expect(JSON.stringify(await events(page, h.SAVE)) === JSON.stringify(before), 'the reload added to the save');
    await openSkill(page, 'Clear Sight');
    await h.shot(page, 'answers-kept-reload-1-reopened');
    expect(/facts and feelings/.test(await stepText(page)) && (await value(page)) === FACT, `after a reload the skill lost the typed answer: "${await stepText(page)}" "${await value(page)}"`);
    const after = await events(page, h.SAVE);
    expect(after.length === before.length + 1 && after.at(-1) === 'skill', `opening the skill after the reload should credit it once, as any open does: ${JSON.stringify(after.slice(before.length))}`);

    // finishing clears what was kept: Practise again starts empty
    await tap(page, 'Next');
    await tap(page, 'A bit lighter');
    await tap(page, 'Done');
    expect(!(await kept(page, h.SAVE)).length, `the finished skill is still kept: ${await kept(page, h.SAVE)}`);
    await tap(page, 'Skip');
    await tap(page, 'Practise again');
    await tap(page, 'Begin');
    expect((await value(page)) === '', `Practise again opened with the old answer typed in: "${await value(page)}"`);

    // a suggested phrase tapped onto a typed answer is kept too
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await onScreen(page, 'hub');
    await openSkill(page, 'Play the Map');
    await tap(page, 'Begin');
    await tap(page, 'Something small');
    await typeInto(page, field(page), 'Make a plan');
    await tap(page, 'To be heard');
    await page.reload();
    await home(page);
    await openSkill(page, 'Play the Map');
    expect((await value(page)) === 'Make a plan To be heard', `after a reload the tapped phrase was lost: "${await value(page)}"`);
    expect(!errors.length, errors.join('\n'));
  },
};
