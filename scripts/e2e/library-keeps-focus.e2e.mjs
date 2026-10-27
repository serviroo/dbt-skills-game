// The Skills list keeps focus through every redraw.
// library-focus: with two copies open, a pin in the other copy redraws the list here, and whatever had focus keeps it:
// Clear filters in the empty state (in the same place on screen, and Enter still clears), Show all skills, a skill's
// row as it moves into Your favourites, and a skill's pin as it moves back out.
import { returning } from './skill-check.e2e.mjs';
import { control, openLibrary } from './find-skills.e2e.mjs';

const PHONE = { width: 390, height: 844 };

/** What has focus, the way a player would name it: the control's label, or which part of which skill row. */
const focused = (page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body || !e.isConnected) return 'nothing (the page)';
    const skill = e.closest('.dq-libitem')?.dataset.skill;
    if (skill) return `the ${e.classList.contains('dq-libpin') ? 'pin' : 'row'} of ${skill}`;
    return (e.getAttribute('aria-label') ?? e.textContent ?? e.tagName).trim();
  });
const top = (loc) => loc.evaluate((e) => Math.round(e.getBoundingClientRect().top));

export const scenarios = {
  async 'library-focus'(h) {
    const { ctx, page: a, errors } = await h.open(returning(h), '?mute', PHONE);
    try {
      await h.reachHub(a);
      const b = await ctx.newPage();
      const bErrors = [];
      b.on('pageerror', (e) => bErrors.push(e.message));
      await b.goto(a.url());
      await h.reachHub(b);
      await openLibrary(h, a);
      await openLibrary(h, b);
      // count this copy's redraws, so each check waits for the one the other copy caused
      await a.evaluate(() => {
        window.__redraws = 0;
        new MutationObserver(() => window.__redraws++).observe(document.querySelector('.dq-libresults'), { childList: true });
      });
      const pinThere = async (id, where) => {
        const n = await a.evaluate(() => window.__redraws);
        await b.locator(`.dq-libitem[data-skill="${id}"] .dq-libpin`).click();
        h.expect(await a.waitForFunction((n) => window.__redraws > n, n, { timeout: 5000 }).then(() => true, () => false), `${where}: the pin in the other copy never redrew this one`);
      };

      // nothing fits: Clear filters keeps focus and its place, and Enter on it still clears
      await control.search(a).fill('qqzx');
      const clear = a.getByRole('button', { name: 'Clear filters' });
      await clear.focus();
      const was = await top(clear);
      await pinThere('give', 'Clear filters');
      h.expect((await focused(a)) === 'Clear filters', `focus went to ${await focused(a)} from Clear filters when the other copy pinned a skill`);
      const now = await top(clear);
      h.expect(Math.abs(now - was) <= 1, `Clear filters moved from ${was} px to ${now} px down the screen`);
      await h.shot(a, 'clear-filters-kept');
      await a.keyboard.press('Enter');
      h.expect((await control.search(a).inputValue()) === '' && (await control.search(a).evaluate((e) => e === document.activeElement)), 'Enter on the kept Clear filters did not clear them and move to the search');

      // Show all skills, above the list, keeps focus too
      await control.search(a).fill('qqzx');
      await a.getByRole('button', { name: 'Show all skills' }).focus();
      await pinThere('fast', 'Show all skills');
      h.expect((await focused(a)) === 'Show all skills', `focus went to ${await focused(a)} from Show all skills when the other copy pinned a skill`);
      await control.search(a).fill('');

      // a skill's row keeps focus as it moves into Your favourites, and its pin as it moves back out
      await a.locator('.dq-libitem[data-skill="validation"] .dq-librow').focus();
      await pinThere('validation', 'a row');
      h.expect((await focused(a)) === 'the row of validation', `focus went to ${await focused(a)} from the row of validation as it moved into Your favourites`);
      h.expect((await a.locator('.dq-libsec--fav [data-skill="validation"]').count()) === 1, 'validation did not move into Your favourites');
      await a.locator('.dq-libitem[data-skill="give"] .dq-libpin').focus();
      await pinThere('give', 'a pin');
      h.expect((await focused(a)) === 'the pin of give', `focus went to ${await focused(a)} from the pin of give as it moved out of Your favourites`);
      h.expect((await a.locator('.dq-libsec--fav [data-skill="give"]').count()) === 0, 'give is still in Your favourites after the other copy unpinned it');
      await h.shot(a, 'pin-kept');
      h.expect(!errors.length && !bErrors.length, [...errors, ...bErrors].join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
