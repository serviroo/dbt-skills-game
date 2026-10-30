// What the player types in a skill is never lost, with real taps on a returning save at 390x844 (turning the phone
// keeps it too: skill-flows' skill-answers-rotate):
//   answers-kept-back-and-return  Back by mistake, then the same step again with its own button: an answer typed in
//                                 "My own" is still there
//   answers-kept-leave-and-return leaving the skill (its close button, or Back out of it), then opening it again from
//                                 Skills, opens it where the player was with the answer typed in; Start over clears it
//                                 with no second credit
//   answers-kept-reload           a reload mid-skill opens Home; the skill then opens where the player was with the
//                                 answer typed in. Finishing the skill clears what was kept: Practise again starts
//                                 empty. A suggested phrase tapped onto an answer, and picks made after typing, are kept
//                                 too. What is kept never adds XP or anything else to the save
//   answers-kept-two-tabs         empty and older tabs leave newer words alone; finishing and starting over keep
//                                 another tab's different words
//   answers-kept-old-layout       an outdated step layout drops positions but keeps answers under their content keys
//   answers-kept-picks-only       a slot with only picks is left alone; a Crystal does not export or restore it
//   answers-kept-route-part       each requested part resumes its own words
//   answers-kept-crystal          backup and restore keep answers, validate fields and leave newer local words alone
//   answers-kept-ranks            ranks survive reload; clearing all ranks leaves no draft
//   answers-kept-branch           passing a branch after typing leaves no extra copy behind when the skill ends
import { boot, settle } from './layout-fit.e2e.mjs';
import { reachHub as home } from './harness.mjs';
import { crystal, restore } from './newer-save-safety.e2e.mjs';

const PHONE = { width: 390, height: 844 };
const JUDGED = 'I judged the rain';
const FACT = 'It rained and I felt flat';

const field = (page) => page.locator('.dq-step-body textarea, .dq-step-body input.dq-input').first();
const value = (page) => field(page).inputValue().catch(() => 'no field');
const stepText = (page) => page.evaluate(() => document.querySelector('.dq-step-body')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '');
const screenOf = (page) => page.evaluate(() => document.querySelector('.dq')?.dataset.screen ?? null);
const onScreen = (page, name) => page.waitForFunction((n) => document.querySelector('.dq')?.dataset.screen === n && !!document.querySelector('#dq-main > *'), name, { timeout: 10000 });
const events = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{"events":[]}').events.map((e) => e.k), key);
const kept = (page, key) => page.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith(`${k}.skill-draft.`)), key);
const tap = async (page, name) => {
  await page.locator('.dq-step-body').getByRole('button', { name, exact: true }).click();
  await settle(page);
};

async function openSkill(page, sl) {
  await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
  await onScreen(page, 'library');
  await page.locator('.dq-librow').filter({ has: page.locator('.dq-librow-n', { hasText: new RegExp(`^${sl.replace(/'/g, "['’]")}$`) }) }).click();
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
  'answers-kept-branch': async (h) => {
    const { ctx, page, errors } = await boot(h, PHONE);
    const open = async (p) => {
      await p.evaluate(() => window.__daily.go({ name: 'skill', id: 'name-emotion' }));
      await onScreen(p, 'skill');
      await settle(p);
    };
    await open(page);
    await tap(page, 'Begin');
    await tap(page, 'Sadness');
    await tap(page, 'Next');
    await tap(page, 'Next');
    await tap(page, 'Chest');
    await field(page).fill('The rain changed my plans');
    const other = await ctx.newPage();
    other.on('pageerror', (e) => errors.push('second tab pageerror: ' + e.message));
    other.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push('second tab console: ' + m.text().slice(0, 300)));
    await other.goto(page.url());
    await home(other);
    await open(other);
    h.expect((await value(other)) === 'The rain changed my plans', 'the second tab did not hold the same words before the branch');
    await tap(page, 'Next');
    await tap(page, 'Done');
    h.expect(!(await kept(page, h.SAVE)).length, 'passing a branch left a copy of the finished skill behind');
    await other.close();
    h.expect(!errors.length, errors.join('\n'));
  },

  'answers-kept-two-tabs': async (h) => {
    const { ctx, page, errors } = await boot(h, PHONE);
    const other = await ctx.newPage();
    other.on('pageerror', (e) => errors.push('second tab pageerror: ' + e.message));
    other.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push('second tab console: ' + m.text().slice(0, 300)));
    await other.goto(page.url());
    await home(other);
    await openSkill(other, 'Clear Sight');
    await upToFact(page);
    await tap(other, 'Begin');
    await other.locator('.dq-top [aria-label="Leave this skill"]').click();
    await page.reload();
    await home(page);
    await openSkill(page, 'Clear Sight');
    h.expect((await value(page)) === FACT, 'an empty tab deleted the other tab\'s words');

    await openSkill(other, 'Clear Sight');
    await field(page).fill('Newer words from the first tab');
    await other.locator('.dq-top [aria-label="Leave this skill"]').click();
    await openSkill(other, 'Clear Sight');
    h.expect((await value(other)) === 'Newer words from the first tab', 'closing an older copy overwrote newer words');
    await field(other).fill('Newer words from the second tab');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await openSkill(page, 'Clear Sight');
    h.expect((await value(page)) === 'Newer words from the second tab', 'the first tab overwrote the second tab\'s newer words');

    await field(other).fill('Words only the second tab holds');
    await tap(page, 'Next');
    await tap(page, 'A bit lighter');
    await tap(page, 'Done');
    await tap(page, 'Skip');
    await tap(page, 'Practise again');
    h.expect(await page.getByRole('button', { name: 'Begin', exact: true }).isVisible(), 'Practise again picked up another tab\'s draft');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await openSkill(page, 'Clear Sight');
    h.expect((await value(page)) === 'Words only the second tab holds', 'finishing an older copy deleted another tab\'s different words');
    await field(other).fill('Different words while the first tab starts over');
    await tap(page, 'Start over');
    h.expect(await page.getByRole('button', { name: 'Begin', exact: true }).isVisible(), 'Start over picked up another tab\'s draft');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await openSkill(page, 'Clear Sight');
    h.expect((await value(page)) === 'Different words while the first tab starts over', 'Start over deleted a divergent draft');
    await other.close();
    h.expect(!errors.length, errors.join('\n'));
  },

  'answers-kept-old-layout': async (h) => {
    const { page, errors } = await boot(h, PHONE);
    await page.evaluate((key) => {
      localStorage.setItem(`${key}.skill-draft.old-layout.clear-sight.`, JSON.stringify({
        skill: 'clear-sight', part: '', at: 3, answers: { judged: 'A judgment kept by its key', fact: 'A fact kept by its key', removed: 'A removed answer' },
        typed: { 1: [['', 'Words for a removed question']], 3: [['A fact kept by its key', 'More words for a removed question']] },
        leads: { 1: 'An old reply' }, done: [1, 3],
        layout: [['intro', '', ''], ['input', '', 'removed'], ['choice', '', 'word'], ['input', '', 'judged'], ['input', '', 'fact'], ['say', '', '']],
      }));
    }, h.SAVE);
    await openSkill(page, 'Clear Sight');
    h.expect(await page.getByRole('button', { name: 'Begin', exact: true }).isVisible(), 'an old layout reopened a step by its former position');
    await tap(page, 'Begin');
    h.expect((await value(page)) === 'A judgment kept by its key', 'old position-based typing landed in a different question');
    await tap(page, 'Next');
    await tap(page, 'Found it');
    h.expect((await value(page)) === 'A fact kept by its key', 'an answer that still maps to a step was lost');
    h.expect(!errors.length, errors.join('\n'));
  },

  'answers-kept-picks-only': async (h) => {
    const { page, errors } = await boot(h, PHONE);
    const seeded = await page.evaluate(async (save) => {
      const { SKILL } = await import('/src/content/dbt.ts');
      const { stepLayout } = await import('/src/daily/skilldraft.ts');
      const draft = { skill: 'clear-sight', part: '', at: 1, answers: { word: 'Found it' }, typed: {}, leads: {}, done: [], t: 1, layout: stepLayout(SKILL['clear-sight'].steps) };
      const key = `${save}.skill-draft.picks-only.clear-sight.`;
      const old = { ...draft, layout: [...draft.layout, ['input', '', 'removed']], typed: { 1: [['', 'Words from a removed question']] } };
      const bytes = JSON.stringify(old);
      localStorage.setItem(key, bytes);
      return { key, bytes, draft };
    }, h.SAVE);
    await openSkill(page, 'Clear Sight');
    h.expect(!(await page.getByRole('button', { name: 'Start over', exact: true }).count()), 'a draft with only picks was offered for resume');
    await tap(page, 'Begin');
    h.expect(await page.evaluate((key) => localStorage.getItem(key), seeded.key) === seeded.bytes, 'an unusable draft was deleted');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await home(page);
    const file = await crystal(h, page, 'picks-only');
    h.expect(!file.skillDrafts?.length, 'a draft with only picks was exported');
    file.skillDrafts = [seeded.draft];
    await restore(h, page, file, 'picks-only.json');
    h.expect((await kept(page, h.SAVE)).length === 1, 'a draft with only picks was restored');
    h.expect(await page.evaluate((key) => localStorage.getItem(key), seeded.key) === seeded.bytes, 'restore changed an unusable local draft');
    h.expect(!errors.length, errors.join('\n'));
  },

  'answers-kept-route-part': async (h) => {
    const { page, errors } = await boot(h, PHONE);
    const open = async (entry) => {
      await page.evaluate((entry) => window.__daily.go({ name: 'skill', id: 'abc-please', entry }), entry);
      await onScreen(page, 'skill');
      await settle(page);
    };
    await open('c');
    await field(page).fill('A hard conversation tomorrow');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await open('a');
    h.expect(/A\. Accumulate positives/.test(await stepText(page)), 'part C overrode the requested part A');
    await tap(page, 'My own');
    await field(page).fill('Sit by the window');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await open('c');
    h.expect((await value(page)) === 'A hard conversation tomorrow', 'opening part A lost part C\'s words');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await open('a');
    h.expect((await value(page)) === 'Sit by the window', 'opening part C lost part A\'s words');
    h.expect(!errors.length, errors.join('\n'));
  },

  'answers-kept-crystal': async (h) => {
    const { page, errors } = await boot(h, PHONE);
    await upToFact(page);
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await home(page);
    const file = await crystal(h, page, 'skill-answers');
    h.expect(file.skillDrafts?.some((d) => d.skill === 'clear-sight' && d.answers.fact === FACT), 'the Save Crystal dropped kept answers');
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await home(page);
    await openSkill(page, 'Clear Sight');
    await field(page).fill('A newer local answer');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await home(page);
    await restore(h, page, file, 'older-skill-answers.json');
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await home(page);
    await openSkill(page, 'Clear Sight');
    h.expect((await value(page)) === 'A newer local answer', 'restoring an older Save Crystal overwrote newer local words');

    await page.evaluate((key) => {
      for (const k of Object.keys(localStorage)) if (k.startsWith(`${key}.skill-draft.`)) localStorage.removeItem(k);
    }, h.SAVE);
    await page.reload();
    await home(page);
    await restore(h, page, file, 'skill-answers.json');
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await home(page);
    await openSkill(page, 'Clear Sight');
    h.expect((await value(page)) === FACT, 'the restored Save Crystal lost the answer or its step');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await home(page);
    file.skillDrafts = [{ skill: 'clear-sight', at: 3, answers: { fact: { bad: true }, judged: 'Valid words' }, typed: { 3: 'bad' }, leads: null, done: [3, 'bad'], layout: [] }, { skill: 'missing-skill', answers: {} }];
    await page.evaluate((key) => {
      for (const k of Object.keys(localStorage)) if (k.startsWith(`${key}.skill-draft.`)) localStorage.removeItem(k);
    }, h.SAVE);
    await restore(h, page, file, 'invalid-skill-answers.json');
    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await home(page);
    await openSkill(page, 'Clear Sight');
    h.expect(await page.getByRole('button', { name: 'Begin', exact: true }).isVisible(), 'restore trusted an unvalidated position');
    await tap(page, 'Begin');
    h.expect((await value(page)) === 'Valid words', 'restore did not validate answers individually');
    h.expect(!errors.length, errors.join('\n'));
  },

  'answers-kept-ranks': async (h) => {
    const { page, errors } = await boot(h, PHONE);
    await openSkill(page, 'Flavour Tier List');
    await tap(page, 'Begin');
    await tap(page, 'Something sweet');
    await tap(page, 'A cold drink');
    await tap(page, 'Next');
    await tap(page, 'Skip the timer');
    const rows = page.locator('.ca-tier-row');
    await rows.nth(0).getByRole('radio', { name: /: S$/ }).click();
    await rows.nth(1).getByRole('radio', { name: /: B$/ }).click();
    await page.reload();
    await home(page);
    await openSkill(page, 'Flavour Tier List');
    h.expect(await rows.count() === 2, 'reload did not return to the ranking step');
    h.expect(await rows.nth(0).getByRole('radio', { name: /: S$/ }).getAttribute('aria-checked') === 'true', 'the first rank was lost');
    h.expect(await rows.nth(1).getByRole('radio', { name: /: B$/ }).getAttribute('aria-checked') === 'true', 'the second rank was lost');
    await tap(page, 'Lock it in');
    h.expect(/TIER LIST LOCKED/.test(await stepText(page)), 'Lock it in did not move on from the restored ranks');
    await page.goBack({ waitUntil: 'commit' });
    await settle(page);
    await rows.nth(0).getByRole('radio', { name: /: S$/ }).click();
    await rows.nth(1).getByRole('radio', { name: /: B$/ }).click();
    await page.reload();
    await home(page);
    await openSkill(page, 'Flavour Tier List');
    h.expect(await page.getByRole('button', { name: 'Begin', exact: true }).isVisible(), 'clearing both ranks still offered a draft');
    h.expect(!(await kept(page, h.SAVE)).length, 'clearing both ranks left their slot on the device');
    h.expect(!errors.length, errors.join('\n'));
  },

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
    // every open is credited as before; Start over begins the same practice again and, like what was kept, adds nothing
    const added = (await events(page, h.SAVE)).filter((k) => k === 'skill').length - skills;
    expect(added === 3, `expected 3 skill credits (one for each open), got ${added}`);
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

    // so are picks made after something was typed
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await onScreen(page, 'hub');
    await openSkill(page, "Wanderer's Code");
    await tap(page, 'Begin');
    await tap(page, 'Next');
    await typeInto(page, field(page), 'Can we talk tonight');
    await tap(page, 'Next');
    for (const v of ['Honesty', 'My time']) await page.locator('.dq-step-body .dq-opt', { hasText: v }).click();
    await page.reload();
    await home(page);
    await openSkill(page, "Wanderer's Code");
    const pressed = await page.locator('.dq-step-body .dq-opt[aria-pressed="true"]').allTextContents();
    expect(pressed.map((t) => t.trim()).join('|') === 'Honesty|My time', `after a reload the picks made after typing were lost: ${JSON.stringify(pressed)}`);
    expect(!errors.length, errors.join('\n'));
  },
};
