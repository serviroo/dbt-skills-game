import { returning, route } from './first-actions.e2e.mjs';
import { holdStorage } from './story-reading.e2e.mjs';
import * as pageClock from './clock.mjs';

const SMALL = { width: 320, height: 568 };
const REST = '[Rest complete. Fatigue cleared.]';
const CREDIT = 'Stamina +1. You looked after yourself.';
const REMOVED = 'Chapter removed.';

const notice = (page) =>
  page.evaluate(() => {
    const t = document.querySelector('.dq-toast');
    return t?.classList.contains('is-on') ? t.firstElementChild.textContent : '';
  });
const tile = (page, name) => page.locator('.dq-tile', { hasText: name }).click();
const tap = async (page, selector, to) => {
  await page.locator(selector).click();
  await route(page, to);
};

async function leaveStealth(h, page, by, to, { credit = false } = {}) {
  await tile(page, 'Stealth');
  await route(page, 'rest');
  await pageClock.pauseClock(page);
  if (credit) await page.evaluate(() => (window.__daily.store.state.flags.safeCredit = true));
  await tap(page, by, to);
}

const threeChapters = (page) =>
  page.evaluate(async () => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    const ss = storyStore(window.__daily.store.key);
    const { story } = await ss.create('Three Doors');
    await ss.addChapter(story.id, 'Second Door');
    await ss.addChapter(story.id, 'Third Door');
    return story.id;
  });

async function removeHeld(page, id, title) {
  await page.locator('.st-chbtn').click();
  const list = page.getByRole('dialog', { name: 'Chapters' });
  const held = await holdStorage(page, ['removeChapter']);
  await list.getByRole('button', { name: `Remove ${title}`, exact: true }).click();
  await held.waitHeld(`removeChapter ${id}`);
  await list.getByRole('button', { name: 'Close the chapter list', exact: true }).click();
  return held;
}

const chaptersLeft = (page, button, n) =>
  page.waitForFunction(
    ([b, m]) => b.hasAttribute('aria-label') && b.getAttribute('aria-label').includes(`of ${m}.`),
    [button, n],
    { timeout: 5000 },
  );

export const scenarios = {
  async 'rest-notice-moves-on'(h) {
    const { ctx, page, errors } = await h.open(returning(h, 3), '?mute', SMALL, (c) => pageClock.install(c));
    await h.reachHub(page);
    await leaveStealth(h, page, '.dq-top .dq-back', 'hub');
    await tile(page, 'Diary card');
    await route(page, 'diary');
    await page.locator('.dq-today .dq-daynav').getByRole('button', { name: 'Pick a day', exact: true }).click();
    await route(page, 'days');
    await pageClock.runFor(page, 1000);
    const onDays = await notice(page);
    await h.shot(page, 'rest-notice-moves-on-days-320x568');
    await tap(page, '.dq-top .dq-back', 'diary');
    await tap(page, '.dq-top .dq-back', 'hub');
    await pageClock.runFor(page, 8000);
    await pageClock.resume(page);
    await leaveStealth(h, page, '.dq-top .dq-back', 'hub', { credit: true });
    await pageClock.runFor(page, 1000);
    const credited = await notice(page);
    await tap(page, '.dq-top .dq-safe', 'safe');
    await tap(page, '.dq-top .dq-back', 'hub');
    await pageClock.runFor(page, 6000);
    const homeAgain = await notice(page);
    await ctx.close();
    h.expect(onDays === '', `the rest notice from Home came onto Pick a day: ${onDays}`);
    h.expect(credited === CREDIT, `the Safe Zone credit on Home is "${credited}"`);
    h.expect(homeAgain === '', `the rest notice came back onto Home after the Safe Zone: ${homeAgain}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'rest-notice-on-landing'(h) {
    const { ctx, page, errors } = await h.open(returning(h, 3), '?mute', SMALL, (c) => pageClock.install(c));
    await h.reachHub(page);
    await leaveStealth(h, page, '.dq-top .dq-back', 'hub');
    await pageClock.runFor(page, 1000);
    const onHome = await notice(page);
    await h.shot(page, 'rest-notice-on-home-320x568');
    await pageClock.runFor(page, 8000);
    await pageClock.resume(page);
    await leaveStealth(h, page, '.dq-top .dq-back', 'hub', { credit: true });
    await pageClock.runFor(page, 1000);
    const credited = await notice(page);
    await pageClock.runFor(page, 5000);
    const afterCredit = await notice(page);
    await pageClock.runFor(page, 8000);
    await pageClock.resume(page);
    await leaveStealth(h, page, '.dq-top .dq-safe', 'safe');
    await pageClock.runFor(page, 1000);
    const inSafe = await notice(page);
    await tap(page, '.dq-top .dq-back', 'hub');
    await pageClock.runFor(page, 1000);
    const afterSafe = await notice(page);
    await ctx.close();
    h.expect(onHome === REST, `staying on Home after Stealth, the rest notice is "${onHome}"`);
    h.expect(credited === CREDIT, `with a Safe Zone credit owed, Home first shows "${credited}"`);
    h.expect(afterCredit === REST, `after the Safe Zone credit, the rest notice is "${afterCredit}"`);
    h.expect(inSafe === '', `a notice showed in the Safe Zone: ${inSafe}`);
    h.expect(afterSafe === '', `the rest notice held for the Safe Zone came onto Home after it: ${afterSafe}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'toast-after-a-slow-save'(h) {
    const { ctx, page, errors } = await h.open(returning(h, 3), '?mute', SMALL, (c) => pageClock.install(c));
    await h.reachHub(page);
    const id = await threeChapters(page);
    await page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
    await route(page, 'write');
    const left = await page.waitForSelector('.st-chbtn');
    await chaptersLeft(page, left, 3);
    const leaving = await removeHeld(page, id, 'Second Door');
    await tap(page, '.dq-top .dq-back', 'hub');
    await leaving.drain();
    await page.waitForFunction(async (storyId) => {
      const { storyStore } = await import('/src/daily/storystore.ts');
      return (await storyStore(window.__daily.store.key).story(storyId, false))?.chapters.length === 2;
    }, id, { timeout: 5000 });
    const onHome = await notice(page);
    await page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
    await route(page, 'write');
    const stay = await page.waitForSelector('.st-chbtn');
    await chaptersLeft(page, stay, 2);
    const staying = await removeHeld(page, id, 'Third Door');
    await staying.drain();
    await chaptersLeft(page, stay, 1);
    const onStory = await notice(page);
    await ctx.close();
    h.expect(onHome === '', `a chapter removed in the Story Room was announced on Home: ${onHome}`);
    h.expect(onStory === REMOVED, `removing a chapter and staying, the toast is "${onStory}"`);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'story-removed-after-leaving'(h) {
    const { ctx, page, errors } = await h.open(returning(h, 3), '?mute', SMALL, (c) => pageClock.install(c));
    await h.reachHub(page);
    const removeStory = async () => {
      const id = await threeChapters(page);
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
      await route(page, 'write');
      await page.getByRole('textbox', { name: /^Page, / }).waitFor();
      const held = await holdStorage(page, ['remove']);
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Remove story', exact: true }).click();
      await held.waitHeld(`remove ${id}`);
      return held;
    };
    const leaving = await removeStory();
    await tap(page, '.dq-top .dq-safe', 'safe');
    await leaving.drain();
    await h.frames(page, 2);
    const stayedSafe = await page.evaluate(() => window.__daily.route.name);
    const inSafe = await notice(page);
    await tap(page, '.dq-top .dq-back', 'hub');
    const staying = await removeStory();
    await staying.drain();
    await route(page, 'hub');
    await page.locator('.dq-toast.is-on').waitFor({ timeout: 5000 });
    const landed = await notice(page);
    await ctx.close();
    h.expect(stayedSafe === 'safe', `a story removed before the Safe Zone opened took the player to ${stayedSafe}`);
    h.expect(inSafe === '', `a notice showed in the Safe Zone: ${inSafe}`);
    h.expect(landed === 'Story removed.', `removing a story and staying, the toast where it lands is "${landed}"`);
    h.expect(!errors.length, errors.join('\n'));
  },
};
