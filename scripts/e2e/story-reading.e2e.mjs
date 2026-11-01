// Story Room reading: a starting point offered one line at a time that reaches the page only on Use this, and a
// reading view whose story text comes in three sizes, never under 16 px, without sideways scrolling on a phone,
// remembered on this device and carried by a Save Crystal. The Safe Zone stays one tap away on both screens.
import fs from 'node:fs';
import path from 'node:path';

const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'reading-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});
const SIZE_KEY = (h) => `${h.SAVE}.read-size`;
const ta = (page) => page.locator('.st-write .st-ta');
const ready = (page) => page.waitForFunction(() => !!window.__daily, null, { timeout: 30000 });
const routeIs = (page, name) => page.waitForFunction((n) => window.__daily?.route.name === n, name, { timeout: 10000 });
/** the first page of the open story as IndexedDB holds it, not as the editor shows it */
const stored = (page) =>
  page.evaluate(async () => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    const ss = storyStore(window.__daily.store.key);
    const s = await ss.story(window.__daily.route.id);
    return s ? ((await ss.onDisk(s.chapters[0]))?.text ?? null) : null;
  });
async function storedIs(h, page, text, label) {
  await h.poll(page, () => stored(page), (s) => s === text, (s) => `${label}: the page stored ${JSON.stringify(s)}, not ${JSON.stringify(text)}`, { timeout: 8000, polling: 200 });
}
/** From here the story store's `kinds` of reads and saves wait until the test lets them through, as on a slow phone where
 *  storage answers after the next tap: `release()` lets the oldest through, `release(what)` that one, `drain()` all. */
export async function holdStorage(page, kinds) {
  await page.evaluate(async (ks) => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    const ss = storyStore(window.__daily.store.key);
    const held = [];
    ss.__real ??= {};
    for (const k of ks) {
      const real = (ss.__real[k] ??= ss[k]);
      ss[k] = function (...a) {
        let go, finish;
        const done = new Promise((r) => (finish = r));
        held.push({ what: `${k} ${a[0]?.id ?? a[0]}`, go: () => go(), done });
        return new Promise((r) => (go = r)).then(() => real.apply(this, a)).finally(finish);
      };
    }
    window.__held = () => held.map((x) => x.what);
    window.__releaseOne = async (what) => {
      const i = what ? held.findIndex((x) => x.what === what) : 0;
      const x = i < 0 ? undefined : held.splice(i, 1)[0];
      if (!x) return false;
      x.go();
      await x.done;
      return true;
    };
  }, kinds);
  return {
    waitHeld: (what, count = 1) => page.waitForFunction(([w, c]) => window.__held().filter((x) => x === w).length === c, [what, count], { timeout: 5000 }),
    release: (what) => page.evaluate((w) => window.__releaseOne(w), what),
    drain: async () => {
      while (await page.evaluate(() => window.__releaseOne()));
    },
  };
}
/** True while the writer is still opening: out of sight and out of reach, so no tap lands on it */
export const opening = (page) =>
  page.evaluate(() => {
    const w = document.querySelector('.st-write');
    return !!w && w.inert && getComputedStyle(w).opacity === '0';
  });
/** Lets the held reads through one at a time, all but those starting with `keep`, until the writer is in */
export async function letIn(page, keep) {
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(() => document.querySelector('.st-write')?.inert === false)) return;
    const next = (await page.evaluate(() => window.__held())).find((x) => !x.startsWith(keep));
    if (next) await page.evaluate((w) => window.__releaseOne(w), next);
    else await page.waitForTimeout(50);
  }
  throw new Error('the writer never came in');
}
/** the Page or Notes control, the editor's label and its text */
export const shownIn = (page) =>
  page.evaluate(() => ({
    seg: document.querySelector('.st-seg [aria-checked="true"]')?.textContent,
    box: document.querySelector('.st-write .st-ta')?.getAttribute('aria-label'),
    text: document.querySelector('.st-write .st-ta')?.value,
  }));
/** every value in localStorage, so a starting point kept anywhere before Use this shows up */
const everything = (page) => page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '').join('\n'));
async function safeOneTap(h, page, label) {
  const safe = page.locator('.dq-top .dq-safe');
  h.expect(await safe.isVisible(), `${label}: the Safe Zone button is not showing`);
  await safe.click();
  await routeIs(page, 'safe');
}
/** no sideways scroll, and nothing on the reading screen reaches past either edge */
const fits = (page) =>
  page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const scrollers = [document.scrollingElement, document.querySelector('.dq'), document.querySelector('#dq-main')].filter(Boolean);
    const wide = scrollers.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => `${e.className || e.tagName} ${e.scrollWidth}>${e.clientWidth}`);
    const out = [...document.querySelectorAll('.st-reader *')].filter((e) => e.checkVisibility()).filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width && (r.left < -1 || r.right > w + 1);
    });
    return [...wide, ...out.slice(0, 4).map((e) => `${e.className || e.tagName} reaches past the edge`)];
  });
const sizes = (page) =>
  page.evaluate(() => ({
    text: [...document.querySelectorAll('.st-read-text')].map((e) => parseFloat(getComputedStyle(e).fontSize)),
    title: parseFloat(getComputedStyle(document.querySelector('.st-reader .dq-h1')).fontSize),
    label: parseFloat(getComputedStyle(document.querySelector('.st-read-tools-l')).fontSize),
    pressed: [...document.querySelectorAll('.st-size [aria-pressed="true"]')].map((b) => b.getAttribute('aria-label')),
  }));

const CH1 = 'The lantern hung by the door all winter.\n\nEvery night it glowed a little brighter, and nobody could say why. The fox who lived under the porch had a theory, but nobody had asked the fox.';
const CH2 = 'In spring the door opened by itself.\n\nOutside, the path went on further than anyone remembered, past the old mill and the bridge, all the way to the sea.';
const NAMES = ['A regular', 'A larger', 'A largest'];

export const scenarios = {
  /** Another shows a new line each time, nothing is kept before Use this, and Use this writes it at the cursor */
  async 'story-starting-points'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await page.locator('.dq-tile--story').click();
      await page.locator('.st-shelf > *').first().waitFor();
      await page.locator('.st-shelfpage button:visible', { hasText: 'New story' }).first().click();
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      const ask = page.getByRole('button', { name: 'Need a starting point?' });
      h.expect(await ask.isVisible(), 'the page offers no starting point');
      h.expect((await ask.getAttribute('aria-expanded')) === 'false', 'starting points open before anyone asked');
      const all = await page.evaluate(async () => (await import('/src/content/story-lines.ts')).STORY_START.prompts);
      h.expect(all.length >= 12 && all.length <= 20, `there are ${all.length} starting points, not 12 to 20`);
      h.expect(all.every((x) => !/—|–/.test(x)), 'a starting point has a dash in it');
      await ask.click();
      const line = page.locator('.st-start-t');
      await line.waitFor();
      h.expect((await ask.getAttribute('aria-expanded')) === 'true', 'the toggle does not say the starting points are open');
      const seen = [await line.textContent()];
      for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: 'Another', exact: true }).click();
        seen.push(await line.textContent());
      }
      h.expect(new Set(seen).size === seen.length, `Another repeated a line: ${JSON.stringify(seen)}`);
      h.expect(seen.every((x) => all.includes(x)), `a shown line is not one of the starting points: ${JSON.stringify(seen)}`);
      await h.shot(page, 'prompts-390x844');

      // nothing reaches the page, the store or the mirrors until Use this
      await h.sleep(1500);
      h.expect((await ta(page).inputValue()) === '', 'the page changed before Use this');
      h.expect((await stored(page)) === '', 'the story stored text before Use this');
      const kept = await everything(page);
      h.expect(!seen.some((x) => kept.includes(x)), 'a starting point was kept in localStorage before Use this');

      // an empty page: the line becomes the page, as editable text, with the caret after it
      const first = seen.at(-1);
      await page.getByRole('button', { name: 'Use this', exact: true }).click();
      h.expect((await ta(page).inputValue()) === first, `Use this on an empty page gave ${JSON.stringify(await ta(page).inputValue())}`);
      h.expect(await page.locator('.st-start-box').evaluate((e) => !e.checkVisibility()), 'the starting point stayed open after Use this');
      h.expect(await ta(page).evaluate((e) => e === document.activeElement), 'the page is not focused after Use this');
      await page.keyboard.type(' Then the bell rang.');
      h.expect((await ta(page).inputValue()) === `${first} Then the bell rang.`, 'typing after Use this did not continue the line');
      await storedIs(h, page, `${first} Then the bell rang.`, 'after Use this');
      await h.shot(page, 'prompts-used-390x844');

      // the cursor: at the start of their own words, the next line goes in before them
      await ta(page).fill('Hello there.');
      await storedIs(h, page, 'Hello there.', 'their own words');
      await ta(page).press('Control+Home');
      await ask.click();
      const second = await line.textContent();
      h.expect(second !== first, 'the next starting point repeated the one just used');
      await h.sleep(1200);
      h.expect((await stored(page)) === 'Hello there.', 'the page stored a starting point before Use this');
      await page.getByRole('button', { name: 'Use this', exact: true }).click();
      h.expect((await ta(page).inputValue()) === `${second} Hello there.`, `Use this at the cursor gave ${JSON.stringify(await ta(page).inputValue())}`);
      await storedIs(h, page, `${second} Hello there.`, 'Use this at the cursor');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      h.expect((await ta(page).inputValue()) === 'Hello there.', 'Undo did not take back the starting point in one step');

      // Notes is for notes: the starting point is offered on the page only
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await page.getByRole('textbox', { name: 'Notes for this story' }).waitFor();
      h.expect(!(await ask.isVisible()), 'starting points show on Notes');
      await page.getByRole('radio', { name: 'Show: Page' }).click();
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      h.expect(await ask.isVisible(), 'starting points did not come back on the page');

      await page.setViewportSize({ width: 320, height: 568 });
      await ask.click();
      await h.shot(page, 'prompts-320x568');
      const wide = await page.evaluate(() => [document.scrollingElement, document.querySelector('.dq')].filter((e) => e && e.scrollWidth > e.clientWidth + 1).length);
      h.expect(!wide, 'the writing view scrolls sideways at 320 px with a starting point open');

      // a phone on its side: opening it brings Use this out from under the dock
      await ask.click();
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(() => (document.querySelector('.dq').scrollTop = 0));
      await ask.click();
      await h.settled(page, '.st-start');
      const hit = await page.getByRole('button', { name: 'Use this', exact: true }).evaluate((b) => {
        const r = b.getBoundingClientRect();
        return [r.top + 3, r.top + r.height / 2, r.bottom - 3].every((y) => b.contains(document.elementFromPoint(r.left + r.width / 2, y)));
      });
      h.expect(hit, 'at 844x390, Use this opens under the dock');
      await h.shot(page, 'prompts-844x390');
      await safeOneTap(h, page, 'writing');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** while the page is still loading the writer is out of reach, the Safe Zone still one tap away: taps on it do nothing,
   *  nothing throws or is lost, and once the page is in a card's Insert lands */
  async 'story-edits-wait-for-the-page'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Slow Night');
        await ss.putCards(first.id, [{ id: 'slow-card', mode: 'continue', text: 'The kettle began to hum.', t: Date.now() }]);
        // the page's chapter read waits until the test lets it through, as a slow IndexedDB open would
        const real = ss.chapter;
        let go;
        const gate = new Promise((done) => (go = done));
        ss.chapter = async function (...a) {
          await gate;
          return real.apply(this, a);
        };
        window.__letPageIn = () => {
          ss.chapter = real;
          go();
        };
        return story.id;
      });
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
      await page.locator('.st-write').waitFor({ state: 'attached' });
      await h.sleep(300);
      h.expect(await page.evaluate(() => !document.querySelector('.st-write .st-ta').getAttribute('aria-label').startsWith('Page,')), 'the page loaded before the test let it');
      h.expect(await opening(page), 'the writer showed before its page was in');

      // taps while loading
      const ask = page.locator('.st-write').getByRole('button', { name: 'Need a starting point?', includeHidden: true });
      await ask.click({ force: true, timeout: 3000 }).catch(() => {});
      await page.locator('.st-write').getByRole('button', { name: 'Co-writer', exact: true, includeHidden: true }).click({ force: true, timeout: 3000 }).catch(() => {});
      await h.shot(page, 'loading-390x844');
      await h.sleep(300);
      h.expect(await opening(page), 'a tap reached the writer before its page was in');
      h.expect(!(await page.getByRole('button', { name: 'Use this', exact: true }).isVisible()), 'a starting point opened before the page was in');
      h.expect(!errors.length, `tapping while the page loads broke something:\n${errors.join('\n')}`);
      const safe = page.locator('.dq-top .dq-safe');
      h.expect((await safe.isVisible()) && (await safe.isEnabled()), 'the Safe Zone was out of reach while the page loaded');

      // once the page is in, the controls come on and a card's Insert lands
      await page.evaluate(() => window.__letPageIn());
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      h.expect(await ask.isEnabled(), 'the starting point did not come on once the page loaded');
      await page.getByRole('button', { name: 'Co-writer', exact: true }).click();
      const insert = page.locator('.st-card', { hasText: 'The kettle began to hum.' }).getByRole('button', { name: 'Insert', exact: true });
      await insert.click({ timeout: 5000 });
      await page.waitForFunction(() => document.querySelector('.st-write .st-ta')?.value === 'The kettle began to hum.', null, { timeout: 5000 }).catch(() => {});
      h.expect((await ta(page).inputValue()) === 'The kettle began to hum.', `the card's Insert was lost: ${JSON.stringify(await ta(page).inputValue())}`);
      await storedIs(h, page, 'The kettle began to hum.', "the card's Insert");
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Page and Notes: the last tap wins, however slowly the story's storage answers, and words still saving are kept */
  async 'story-tab-last-tap-wins'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const { id, notes, first } = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Two Doors');
        return { id: story.id, notes: story.notes, first: first.id };
      });
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
      const pageBox = page.getByRole('textbox', { name: /^Page,/ });
      await pageBox.waitFor();
      // from here every chapter read and save waits until the test lets it through, one at a time in the order asked
      const { waitHeld, drain } = await holdStorage(page, ['chapter', 'saveChapter']);
      const shown = () => shownIn(page);
      const notesTab = page.getByRole('radio', { name: 'Show: Notes' });
      const pageTab = page.getByRole('radio', { name: 'Show: Page' });
      const WORDS = 'The fox kept watch.';

      // typed words still saving: Notes, then Page before the save lands
      await pageBox.fill(WORDS);
      await notesTab.click();
      await waitHeld(`saveChapter ${first}`);
      await pageTab.click();
      await drain();
      let s = await shown();
      h.expect(s.seg === 'Page' && /^Page,/.test(s.box) && s.text === WORDS, `Notes then Page while the page was saving left ${JSON.stringify(s)}`);
      await storedIs(h, page, WORDS, 'Notes then Page while the page was saving');

      // two reads in flight: Notes, then Page; the Notes read answering first must not bring Notes back
      await notesTab.click();
      await waitHeld(`chapter ${notes}`);
      await pageTab.click();
      await waitHeld(`chapter ${first}`);
      await page.evaluate(() => window.__releaseOne());
      s = await shown();
      h.expect(s.seg === 'Page' && /^Page,/.test(s.box), `the Notes read answering after Page was tapped showed ${JSON.stringify(s)}`);
      await drain();
      s = await shown();
      h.expect(s.seg === 'Page' && /^Page,/.test(s.box) && s.text === WORDS, `once both reads answered, the Story Room showed ${JSON.stringify(s)}`);

      // Notes tapped again while its read is still out still opens Notes
      await notesTab.click();
      await waitHeld(`chapter ${notes}`);
      await notesTab.click();
      await waitHeld(`chapter ${notes}`, 2);
      await drain();
      s = await shown();
      h.expect(s.seg === 'Notes' && s.box === 'Notes for this story', `Notes tapped twice while it loaded showed ${JSON.stringify(s)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** a tap a newer tap overtook changes nothing: a page opened from the chapter list and an Insert waiting for the page
   *  give way to a later Notes tap, no card moves to another page and nothing lands in the notes (wide screen, where the
   *  Co-writer sits beside the page) */
  async 'story-overtaken-taps-change-nothing'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', { width: 1280, height: 800 });
    try {
      await h.reachHub(page);
      const { id, notes, first, second } = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Two Doors');
        const second = await ss.addChapter(story.id, 'Second Door');
        await ss.putCards(first.id, [
          { id: 'first-card', mode: 'continue', text: 'The kettle began to hum.', t: Date.now() },
          { id: 'lamp-card', mode: 'continue', text: 'The lamp went out.', t: Date.now() },
        ]);
        await ss.putCards(second.id, [{ id: 'second-card', mode: 'continue', text: 'The second door stuck.', t: Date.now() }]);
        return { id: story.id, notes: story.notes, first: first.id, second: second.id };
      });
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      // the chapter list is open before storage slows down; its rows are what the player taps
      await page.locator('.st-chbtn').click();
      const secondRow = page.locator('.st-chrow-b', { hasText: 'Second Door' });
      await secondRow.waitFor();
      const { waitHeld, release, drain } = await holdStorage(page, ['chapter', 'saveChapter', 'cards', 'onDisk']);
      const notesTab = page.getByRole('radio', { name: 'Show: Notes' });
      const card = (text) => page.locator('.st-card', { hasText: text });
      // lets every held read and save through until `ok`, including ones the app asks for only after an earlier one answers,
      // for up to 5 s of the page running
      const settle = (ok) => h.poll(page, async () => (await drain(), ok()), Boolean, 'the held reads and saves never let it through', { timeout: 5000, polling: 50 });
      const boxIs = (re) => async () => re.test((await shownIn(page)).box ?? '');
      const notesOnDisk = () =>
        page.evaluate(async (n) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const ss = storyStore(window.__daily.store.key);
          return (await (ss.__real?.onDisk ?? ss.onDisk).call(ss, n))?.text ?? '';
        }, notes);

      // Second Door opened from the chapter list, then Notes before its cards are read, and the Notes read answers first
      await secondRow.click();
      await waitHeld(`cards ${second}`);
      await notesTab.click();
      await waitHeld(`chapter ${notes}`);
      await release(`chapter ${notes}`);
      await drain();
      await h.sleep(200);
      await drain();
      let s = await shownIn(page);
      h.expect(s.seg === 'Notes' && s.box === 'Notes for this story', `Second Door then Notes showed ${JSON.stringify(s)}`);
      h.expect((await card('The second door stuck.').count()) === 0, 'the overtaken page open put its cards beside another page');

      // Second Door again, its cards read but its chapter still loading when Notes is tapped: nothing of it is taken
      await page.locator('.st-chbtn').click();
      await settle(() => secondRow.isVisible());
      await secondRow.click();
      await waitHeld(`cards ${second}`);
      await release(`cards ${second}`);
      await waitHeld(`chapter ${second}`);
      await notesTab.click();
      await waitHeld(`chapter ${notes}`);
      await release(`chapter ${notes}`);
      await drain();
      await h.sleep(200);
      await drain();
      s = await shownIn(page);
      h.expect(s.seg === 'Notes' && s.box === 'Notes for this story', `Second Door loading, then Notes, showed ${JSON.stringify(s)}`);
      h.expect((await card('The second door stuck.').count()) === 0, 'the page open overtaken while its chapter loaded still took its cards');

      // an Insert from Notes brings the page in first and lands there, never in the notes on screen
      await card('The kettle began to hum.').getByRole('button', { name: 'Insert', exact: true }).click();
      await settle(boxIs(/^Page,/));
      s = await shownIn(page);
      h.expect(s.seg === 'Page' && s.text === 'The kettle began to hum.', `the Insert from Notes left ${JSON.stringify(s)}`);
      h.expect((await notesOnDisk()) === '', `the Insert from Notes wrote into the notes: ${JSON.stringify(await notesOnDisk())}`);

      // an Insert waiting for the page gives way to a Notes tap after it, and nothing lands in the notes
      await notesTab.click();
      await settle(boxIs(/^Notes for this story$/));
      await card('The lamp went out.').getByRole('button', { name: 'Insert', exact: true }).click();
      await waitHeld(`chapter ${first}`);
      await notesTab.click();
      await waitHeld(`chapter ${notes}`);
      // the Notes read answers first, then the page read the Insert waited for
      await release(`chapter ${notes}`);
      await drain();
      await h.sleep(300);
      await drain();
      s = await shownIn(page);
      h.expect(s.seg === 'Notes' && s.box === 'Notes for this story' && s.text === '', `a Notes tap after an Insert still let the card in: ${JSON.stringify(s)}`);
      h.expect((await notesOnDisk()) === '', `the overtaken Insert wrote into the notes: ${JSON.stringify(await notesOnDisk())}`);

      // the page is in but still settling (its stored copy is being read) when Notes is tapped: the Insert gives way too
      await card('The lamp went out.').getByRole('button', { name: 'Insert', exact: true }).click();
      await waitHeld(`chapter ${first}`);
      await release(`chapter ${first}`);
      await waitHeld(`onDisk ${first}`);
      await notesTab.click();
      await waitHeld(`chapter ${notes}`);
      await release(`chapter ${notes}`);
      await drain();
      await h.sleep(300);
      await drain();
      s = await shownIn(page);
      h.expect(s.seg === 'Notes' && s.box === 'Notes for this story' && s.text === '', `a Notes tap while the page settled still let the card in: ${JSON.stringify(s)}`);
      h.expect((await notesOnDisk()) === '', `the Insert overtaken while the page settled wrote into the notes: ${JSON.stringify(await notesOnDisk())}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Notes tapped while the Story Room is still settling its first page wins: what is left of that page's opening
   *  doesn't take the editor back. Before the page is in, the writer is out of reach */
  async 'story-notes-tapped-while-opening-wins'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const { id, notes, first } = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Slow Door');
        return { id: story.id, notes: story.notes, first: first.id };
      });
      const { waitHeld, release, drain } = await holdStorage(page, ['chapter', 'cards', 'onDisk']);
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
      await waitHeld(`cards ${first}`);
      h.expect(await opening(page), 'the writer came in before its page');
      await letIn(page, 'onDisk');
      await waitHeld(`onDisk ${first}`);
      await page.getByRole('radio', { name: 'Show: Notes' }).click();
      await waitHeld(`chapter ${notes}`);
      await release(`chapter ${notes}`);
      await drain();
      await h.sleep(200);
      await drain();
      const s = await shownIn(page);
      h.expect(s.seg === 'Notes' && s.box === 'Notes for this story', `Notes tapped while the first page opened showed ${JSON.stringify(s)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** a story with no pages makes its first page on opening, out of reach until it is in: a Page tap meanwhile lands
   *  nowhere, the page reaches the editor and what is typed there is kept */
  async 'story-page-tapped-while-first-page-is-made'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const id = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('No Pages Yet');
        await ss.removeChapter(story.id, first.id);
        return story.id;
      });
      const { waitHeld, drain } = await holdStorage(page, ['addChapter']);
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
      await waitHeld(`addChapter ${id}`);
      h.expect(await opening(page), 'the writer came in before its first page was made');
      await page.getByRole('radio', { name: 'Show: Page', includeHidden: true }).click({ force: true, timeout: 3000 }).catch(() => {});
      await drain();
      const box = page.getByRole('textbox', { name: /^Page,/ });
      await box.waitFor({ timeout: 5000 }).catch(() => {});
      const s = await shownIn(page);
      h.expect(/^Page,/.test(s.box ?? ''), `a Page tap while the first page was made left the editor as ${JSON.stringify(s)}`);
      await box.fill('The first line.');
      await storedIs(h, page, 'The first line.', 'typed into the page made on opening');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** the Story Room comes in only once its first page's cards are read, and another page opened then shows its own
   *  cards, never the first page's beside it (or saved with it) */
  async 'story-first-cards-read-overtaken'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const { id, first, second } = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const { story, first } = await ss.create('Two Doors');
        const second = await ss.addChapter(story.id, 'Second Door');
        await ss.putCards(first.id, [{ id: 'first-card', mode: 'continue', text: 'The kettle began to hum.', t: Date.now() }]);
        await ss.putCards(second.id, [{ id: 'second-card', mode: 'continue', text: 'The second door stuck.', t: Date.now() }]);
        return { id: story.id, first: first.id, second: second.id };
      });
      const { waitHeld, release, drain } = await holdStorage(page, ['cards']);
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id });
      await waitHeld(`cards ${first}`);
      h.expect(await opening(page), "the writer came in before its first page's cards were read");
      await release(`cards ${first}`);
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor({ timeout: 5000 });
      const card = (text) => page.locator('.st-card', { hasText: text }).count();
      h.expect((await card('The kettle began to hum.')) === 1, "the first page came in without its cards");
      await page.locator('.st-chbtn').click();
      const secondRow = page.locator('.st-chrow-b', { hasText: 'Second Door' });
      await secondRow.click({ timeout: 10000 });
      await waitHeld(`cards ${second}`);
      await release(`cards ${second}`);
      await page.getByRole('textbox', { name: 'Page, Second Door' }).waitFor({ timeout: 5000 }).catch(() => {});
      await drain();
      await h.sleep(300);
      const s = await shownIn(page);
      h.expect(s.box === 'Page, Second Door', `opening Second Door during the first read showed ${JSON.stringify(s)}`);
      h.expect((await card('The kettle began to hum.')) === 0 && (await card('The second door stuck.')) === 1, "the first page's late card read put its cards beside Second Door");
      const kept = await page.evaluate(async (c) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        return ((await (ss.__real?.cards ?? ss.cards).call(ss, c)) ?? []).map((x) => x.text);
      }, second);
      h.expect(kept.length === 1 && kept[0] === 'The second door stuck.', `Second Door's stored cards became ${JSON.stringify(kept)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** three sizes on the story text only, never under 16 px, no sideways scroll, kept after a reload and in a Save Crystal */
  async 'story-reading-size'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await page.evaluate(
        async ([one, two]) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const ss = storyStore(window.__daily.store.key);
          const { story, first } = await ss.create('The Long Night');
          await ss.saveChapter({ ...first, text: one }, [first.rev]);
          const next = await ss.addChapter(story.id);
          await ss.saveChapter({ ...next, text: two }, [next.rev]);
          return { story: story.id, ch1: first.id, ch2: next.id };
        },
        [CH1, CH2],
      );
      h.expect((await h.ls(page, SIZE_KEY(h))) === null, 'a reading size is stored before anyone chose one');
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch2 });
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Read', exact: true }).click();
      await routeIs(page, 'read');
      await page.locator('.st-read-text').nth(1).waitFor();
      h.expect((await page.locator('.st-reader h1').textContent()) === 'The Long Night', 'the reading view does not show the story title');
      h.expect((await page.locator('.st-read-text').allTextContents()).join('|') === `${CH1}|${CH2}`, 'the reading view does not show both chapters as written');
      h.expect(!(await page.locator('.st-reader textarea, .st-reader input').count()), 'the reading view has a field to edit');
      await safeOneTap(h, page, 'reading');
      await page.evaluate((r) => window.__daily.go(r), { name: 'read', id: ids.story });
      await page.locator('.st-read-text').nth(1).waitFor();

      for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(vp);
        const at = `${vp.width}x${vp.height}`;
        let last = null;
        for (const [i, name] of NAMES.entries()) {
          const b = page.getByRole('button', { name, exact: true });
          await b.click();
          await h.settled(page, '.st-read');
          const s = await sizes(page);
          h.expect(s.pressed.length === 1 && s.pressed[0] === name, `${at}: ${name} is not the one pressed: ${JSON.stringify(s.pressed)}`);
          h.expect(s.text.length === 2 && s.text.every((x) => x === s.text[0]), `${at}: the chapters are not one size: ${s.text}`);
          h.expect(s.text[0] >= 16, `${at}: ${name} story text is ${s.text[0]} px, under 16`);
          if (last) {
            h.expect(s.text[0] > last.text[0], `${at}: ${name} did not make the story text bigger (${last.text[0]} to ${s.text[0]})`);
            h.expect(s.title === last.title && s.label === last.label, `${at}: ${name} changed more than the story text`);
          }
          const bad = await fits(page);
          h.expect(!bad.length, `${at}: ${name}: ${bad.join('; ')}`);
          await h.shot(page, `read-${i + 1}-${at}`);
          last = s;
        }
      }
      h.expect((await h.ls(page, SIZE_KEY(h))) === 'largest', 'the chosen size is not stored on this device');
      const largest = (await sizes(page)).text[0];

      // after a reload the reading view opens at the size chosen
      await page.setViewportSize({ width: 320, height: 568 });
      await page.reload();
      await ready(page);
      await page.evaluate((r) => window.__daily.go(r), { name: 'read', id: ids.story });
      await page.locator('.st-read-text').nth(1).waitFor();
      const again = await sizes(page);
      h.expect(again.pressed[0] === 'A largest' && again.text[0] === largest, `after a reload the size went back: ${JSON.stringify(again)}`);

      for (const vp of [{ width: 844, height: 390 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(vp);
        await h.settled(page, '.st-read');
        const bad = await fits(page);
        h.expect(!bad.length, `${vp.width}x${vp.height}: ${bad.join('; ')}`);
        await h.shot(page, `read-3-${vp.width}x${vp.height}`);
      }

      // Back to writing lands on the chapter it came from
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch2 });
      await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Read', exact: true }).click();
      await routeIs(page, 'read');
      await page.getByRole('button', { name: 'Back to writing' }).click();
      await routeIs(page, 'write');
      await page.getByRole('textbox', { name: 'Page, Chapter 2' }).waitFor();

      // a Save Crystal carries the size to a device that never chose one
      await page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save Crystal', exact: true }).click();
      const file = path.join(h.out, 'reading-crystal.json');
      await (await pending).saveAs(file);
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      h.expect(raw.preferences?.readSize === 'largest', `the Save Crystal has no reading size: ${JSON.stringify(raw.preferences)}`);
      h.expect(!errors.length, errors.join('\n'));

      const fresh = await h.open(seed(h));
      try {
        await ready(fresh.page);
        await fresh.page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
        await fresh.page.locator('input[type=file]').setInputFiles({ name: 'crystal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
        await fresh.page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
        await fresh.page.waitForFunction(() => /Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''), null, { timeout: 15000 });
        h.expect((await h.ls(fresh.page, SIZE_KEY(h))) === 'largest', 'Restore did not bring the reading size');
        // Settings, still open, shows the restored size, and Tab into it lands on that choice
        const shown = await fresh.page.evaluate(() => [...document.querySelectorAll('.dq-settings [aria-label="Text size"] [role=radio]')].map((b) => `${b.textContent}:${b.getAttribute('aria-checked')}:${b.tabIndex}`).join(' '));
        h.expect(shown === 'Regular:false:-1 Larger:false:-1 Largest:true:0', `after Restore the Text size control shows ${shown}`);
        h.expect(!fresh.errors.length, fresh.errors.join('\n'));
      } finally {
        await fresh.ctx.close();
      }
    } finally {
      await ctx.close();
    }
  },
};
