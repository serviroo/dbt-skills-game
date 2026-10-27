// Story Room search: one field on the shelf finds stories by title, chapter text and notes, whatever the case,
// accents or curly quotes, as whole words or parts of words. Each result names its chapter and shows the words with
// the match marked, opens that chapter at that place with the place marked, comes back to the same search, works
// offline, stores nothing and never runs the player's text as markup. The Safe Zone stays one tap away. The search
// lives in memory with its visit: the browser's history, address and saved session never hold a word of it.
import { holdStorage, shownIn } from './story-reading.e2e.mjs';

const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'search-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});
const routeIs = (page, name) => page.waitForFunction((n) => window.__daily?.route.name === n, name, { timeout: 10000 });
const filler = (n) => Array.from({ length: n }, (_, i) => `Line ${i + 1}. The tide came in and went out again, and the boats rocked at their ropes all afternoon.`).join('\n\n');

const WINTER = 'Snow fell on the Café by the harbour.\n\nMira’s lamp burned all night in the window.';
const SPRING = `${filler(14)}\n\nAt last the lighthouse blinked twice and the ferry turned for home.`;
const NOTES = 'Mira keeps the brass key in her coat. The ferry leaves at six.';
const HARBOUR = 'Three LANTERNS hung over the old Cafe sign.\n\nSomeone had written <img src=x onerror="window.__ran=1"> on the wall in chalk.';

/** three stories, made through the app's own store */
async function shelf(page) {
  return page.evaluate(
    async (t) => {
      const { storyStore } = await import('/src/daily/storystore.ts');
      const ss = storyStore(window.__daily.store.key);
      const a = await ss.create('The Long Night');
      await ss.saveChapter({ ...a.first, title: 'Winter', text: t.WINTER }, [a.first.rev]);
      const spring = await ss.addChapter(a.story.id);
      await ss.saveChapter({ ...spring, title: 'Spring', text: t.SPRING }, [spring.rev]);
      const notes = await ss.chapter(a.story.notes);
      await ss.saveChapter({ ...notes, text: t.NOTES }, [notes.rev]);
      const b = await ss.create('Harbour Days');
      await ss.saveChapter({ ...b.first, text: t.HARBOUR }, [b.first.rev]);
      const c = await ss.create('');
      await ss.saveChapter({ ...c.first, text: 'Nothing much happened, and that was fine.' }, [c.first.rev]);
      return { night: a.story.id, winter: a.first.id, spring: spring.id, notes: a.story.notes, harbour: b.story.id };
    },
    { WINTER, SPRING, NOTES, HARBOUR },
  );
}

const field = (page) => page.getByRole('searchbox', { name: 'Search your stories and notes' });
async function search(h, page, q) {
  await field(page).fill(q);
  // past the field's 120 ms pause and the read
  await h.sleep(450);
  await page.waitForFunction(() => (document.querySelector('.st-find-n')?.textContent ?? '') !== '', null, { timeout: 5000 });
  return page.evaluate(() => ({
    status: document.querySelector('.st-find-n').textContent,
    stories: [...document.querySelectorAll('.st-found-story')].map((s) => ({
      title: s.querySelector('.st-found-head .st-row-t').textContent,
      titleMarks: [...s.querySelectorAll('.st-found-head .st-mark')].map((m) => m.textContent),
      rows: [...s.querySelectorAll('.st-found-row')].map((r) => ({ where: r.querySelector('.st-found-where').textContent, snip: r.querySelector('.st-found-snip').textContent, marks: [...r.querySelectorAll('.st-mark')].map((m) => m.textContent) })),
    })),
    shelfShown: !!document.querySelector('.st-shelf')?.checkVisibility(),
  }));
}
/** everything kept in this browser's storage, to show a search adds nothing */
const kept = (page) =>
  page.evaluate(async () => {
    const ls = Object.keys(localStorage).sort().map((k) => `${k}=${localStorage.getItem(k)}`);
    const dbs = await indexedDB.databases();
    const rows = [];
    for (const { name } of dbs) {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of db.objectStoreNames) {
        const all = await new Promise((res) => {
          const q = db.transaction(store).objectStore(store).getAll();
          q.onsuccess = () => res(q.result);
        });
        rows.push(`${name}/${store}:${JSON.stringify(all)}`);
      }
      db.close();
    }
    return [...ls, ...rows.sort()].join('\n');
  });
/** the place a search opened, where it sits between the top bar and the dock */
const placeShown = (page) =>
  page.evaluate(() => {
    const m = document.querySelector('.st-hl .st-mark.is-place');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const ta = document.querySelector('.st-ta');
    return {
      text: m.textContent,
      top: r.top,
      bottom: r.bottom,
      bar: document.querySelector('.dq-top').getBoundingClientRect().bottom,
      dock: document.querySelector('.st-dock').getBoundingClientRect().top,
      sel: ta.value.slice(ta.selectionStart, ta.selectionEnd),
      marks: document.querySelectorAll('.st-hl .st-mark').length,
    };
  });

/** every history entry the game writes, as written: the browser keeps them all, and saves them with the session */
const recordHistory = (ctx) =>
  ctx.addInitScript(() => {
    const written = (window.__written = []);
    for (const how of ['pushState', 'replaceState']) {
      const real = history[how].bind(history);
      history[how] = (state, title, url) => {
        written.push(JSON.stringify({ state, url: url ?? null }));
        return real(state, title, url);
      };
    }
  });
const TYPED = /brass|ferry/i;
/** the history entry the browser stands on and the address hold none of the words typed */
async function noneTyped(page, when, bad) {
  const s = await page.evaluate(() => ({ state: JSON.stringify(history.state), url: location.href }));
  if (TYPED.test(s.state)) bad.push(`${when}: history holds the search: ${s.state}`);
  if (TYPED.test(s.url)) bad.push(`${when}: the address holds the search: ${s.url}`);
}

export const scenarios = {
  /** every way of finding words, at phone sizes, offline, storing nothing */
  async 'story-search-finds'(h) {
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const at = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      try {
        await h.reachHub(page);
        const ids = await shelf(page);
        await page.evaluate(() => window.__daily.go({ name: 'stories' }));
        await field(page).waitFor();
        // no network from here on: search runs on this device only
        await ctx.setOffline(true);
        const before = await kept(page);

        // accents and case: "cafe" finds "Café" and "Cafe"
        let r = await search(h, page, 'cafe');
        await h.shot(page, `cafe-${at}`);
        h.expect(!r.shelfShown, `${at}: the shelf still shows under the results`);
        h.expect(r.stories.map((s) => s.title).join('|') === 'Harbour Days|The Long Night' || r.stories.map((s) => s.title).join('|') === 'The Long Night|Harbour Days', `${at}: "cafe" found ${JSON.stringify(r.stories.map((s) => s.title))}`);
        h.expect(r.status === 'Found in 2 stories', `${at}: the count reads "${r.status}"`);
        const night = r.stories.find((s) => s.title === 'The Long Night');
        h.expect(night.rows.length === 1 && night.rows[0].where === 'Winter' && night.rows[0].marks.join() === 'Café', `${at}: "cafe" in The Long Night: ${JSON.stringify(night.rows)}`);
        h.expect(r.stories.find((s) => s.title === 'Harbour Days').rows[0].marks.join() === 'Cafe', `${at}: "cafe" in Harbour Days is not marked`);
        r = await search(h, page, 'CAFÉ');
        h.expect(r.stories.length === 2, `${at}: "CAFÉ" found ${r.stories.length} stories`);

        // parts of words and whole words, any case
        r = await search(h, page, 'lant');
        h.expect(r.stories.length === 1 && r.stories[0].title === 'Harbour Days' && r.stories[0].rows[0].marks.join() === 'LANT', `${at}: "lant" did not find part of LANTERNS: ${JSON.stringify(r.stories)}`);

        // curly quotes match straight ones
        r = await search(h, page, "mira's lamp");
        h.expect(r.stories.length === 1 && r.stories[0].rows[0].where === 'Winter' && r.stories[0].rows[0].marks.join('|') === 'Mira’s|lamp', `${at}: "mira's lamp": ${JSON.stringify(r.stories)}`);

        // a title
        r = await search(h, page, 'night');
        h.expect(r.stories.length >= 1 && r.stories[0].title === 'The Long Night' && r.stories[0].titleMarks.join() === 'Night', `${at}: a title match is not marked: ${JSON.stringify(r.stories)}`);

        // the player's text is shown as text, never run
        r = await search(h, page, 'onerror');
        h.expect(r.stories.length === 1 && r.stories[0].rows[0].snip.includes('<img src=x onerror='), `${at}: the snippet does not show the text as written: ${JSON.stringify(r.stories)}`);
        h.expect(!(await page.locator('.st-found img').count()) && !(await page.evaluate(() => window.__ran)), `${at}: text in a story ran as markup`);

        // nothing found
        r = await search(h, page, 'zebra');
        h.expect(r.status === 'Nothing matches that yet.' && !r.stories.length, `${at}: no match reads "${r.status}"`);
        // every word counts, however many: eight that are in Winter and a ninth that is nowhere find nothing
        r = await search(h, page, 'snow fell on the cafe by harbour lamp zebra');
        h.expect(r.status === 'Nothing matches that yet.' && !r.stories.length, `${at}: a ninth word was left out: ${JSON.stringify(r.stories)}`);

        // notes, with two words that aren't side by side
        r = await search(h, page, 'key ferry');
        await h.shot(page, `notes-${at}`);
        const notesRow = r.stories[0]?.rows.find((x) => x.where === 'Notes');
        h.expect(r.stories.length === 1 && notesRow && notesRow.marks.join('|') === 'key|ferry', `${at}: "key ferry" did not find the notes: ${JSON.stringify(r.stories)}`);

        // searching stored nothing at all
        h.expect((await kept(page)) === before, `${at}: searching changed what this browser keeps`);

        // the Safe Zone is one tap away with results showing, and coming back keeps the search
        await page.locator('.dq-top .dq-safe').click();
        await routeIs(page, 'safe');
        await page.evaluate(() => window.__daily.back());
        await routeIs(page, 'stories');
        await page.waitForFunction(() => document.querySelectorAll('.st-found-row').length > 0, null, { timeout: 5000 });
        h.expect((await field(page).inputValue()) === 'key ferry', `${at}: back from the Safe Zone lost the search`);

        // a result opens that chapter at that place, marked, and the cursor waits there
        await page.locator('.st-found-row', { hasText: 'Notes' }).click();
        await routeIs(page, 'write');
        await page.getByRole('textbox', { name: 'Notes for this story' }).waitFor();
        await page.waitForSelector('.st-hl .st-mark.is-place');
        let p = await placeShown(page);
        h.expect(p.text === 'key' && p.sel === 'key' && p.marks === 2, `${at}: the notes did not open at "key": ${JSON.stringify(p)}`);
        h.expect((await page.locator('.st-note').textContent()) === 'What you searched for is marked on the page.', `${at}: the page does not say what is marked`);
        await h.shot(page, `opened-notes-${at}`);

        // Back comes to the same search
        await page.evaluate(() => window.__daily.back());
        await routeIs(page, 'stories');
        await page.waitForFunction(() => document.querySelectorAll('.st-found-row').length > 0, null, { timeout: 5000 });
        h.expect((await field(page).inputValue()) === 'key ferry', `${at}: Back lost the search`);

        // a place far down a long chapter is brought into view between the bars
        await search(h, page, 'lighthouse');
        await page.locator('.st-found-row', { hasText: 'Spring' }).click();
        await routeIs(page, 'write');
        await page.getByRole('textbox', { name: 'Page, Spring' }).waitFor();
        await page.waitForSelector('.st-hl .st-mark.is-place');
        await h.sleep(400);
        p = await placeShown(page);
        await h.shot(page, `opened-far-${at}`);
        h.expect(p.text === 'lighthouse' && p.sel === 'lighthouse', `${at}: Spring did not open at "lighthouse": ${JSON.stringify(p)}`);
        h.expect(p.top >= p.bar && p.bottom <= p.dock, `${at}: the place is not in view between the bars (${p.top.toFixed(1)}-${p.bottom.toFixed(1)}, bars ${p.bar.toFixed(1)} and ${p.dock.toFixed(1)})`);
        // the marks sit in the page's own box and type, so they line up with its words
        const off = await page.evaluate(() => {
          const a = document.querySelector('.st-ta');
          const b = document.querySelector('.st-hl');
          const ca = getComputedStyle(a);
          const cb = getComputedStyle(b);
          const keys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'whiteSpace', 'overflowWrap', 'tabSize'];
          const diff = keys.filter((k) => ca[k] !== cb[k]).map((k) => `${k} ${ca[k]} vs ${cb[k]}`);
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          if (Math.abs(ra.left - rb.left) > 0.5 || Math.abs(ra.top - rb.top) > 0.5 || Math.abs(ra.width - rb.width) > 0.5) diff.push(`box ${ra.left},${ra.top},${ra.width} vs ${rb.left},${rb.top},${rb.width}`);
          return diff;
        });
        h.expect(!off.length, `${at}: the marks are not set like the page: ${off.join('; ')}`);
        // writing clears the marks
        await page.getByRole('textbox', { name: 'Page, Spring' }).click();
        await page.keyboard.type(' ');
        h.expect(!(await page.locator('.st-hl .st-mark').count()), `${at}: the marks stayed after the page changed`);

        await page.evaluate(() => window.__daily.go({ name: 'stories' }));
        await field(page).waitFor();
        h.expect((await field(page).inputValue()) === '', `${at}: a new visit to the Story Room kept an old search`);
        h.expect(!errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|net::/.test(e)).length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** a result opening its chapter gives way to a Page or Notes tap made while it opened, however slowly storage
   *  answers: the tapped side shows, with nothing marked, selected or said about the search on it */
  async 'story-search-open-overtaken'(h) {
    const cases = [
      { row: 'Winter', tap: 'Notes', box: 'Notes for this story', text: NOTES },
      { row: 'Notes', tap: 'Page', box: 'Page, Winter', text: WINTER },
    ];
    for (const c of cases) {
      const at = `${c.row} overtaken by ${c.tap}`;
      const { ctx, page, errors } = await h.open(seed(h), '?mute');
      try {
        await h.reachHub(page);
        const ids = await shelf(page);
        await page.evaluate(() => window.__daily.go({ name: 'stories' }));
        await field(page).waitFor();
        // "mira" is on both sides of The Long Night: in Winter and in its notes
        const r = await search(h, page, 'mira');
        const rows = r.stories.find((s) => s.title === 'The Long Night')?.rows.map((x) => x.where).join();
        h.expect(rows === 'Winter,Notes', `${at}: "mira" found ${JSON.stringify(r.stories)}`);
        const opened = c.row === 'Winter' ? ids.winter : ids.notes;
        const tapped = c.row === 'Winter' ? ids.notes : ids.winter;
        // from here every chapter read waits until the test lets it through
        const { waitHeld, release, drain } = await holdStorage(page, ['chapter']);
        await page.locator('.st-found-row', { hasText: c.row }).click();
        await routeIs(page, 'write');
        await waitHeld(`chapter ${opened}`);
        await page.getByRole('radio', { name: `Show: ${c.tap}` }).click();
        await waitHeld(`chapter ${tapped}`);
        // the tapped side reaches the editor first, then the chapter the result asked for answers
        await release(`chapter ${tapped}`);
        await release(`chapter ${opened}`);
        await drain();
        await h.sleep(200);
        await drain();
        const s = await shownIn(page);
        h.expect(s.seg === c.tap && s.box === c.box && s.text === c.text, `${at}: the Story Room showed ${JSON.stringify(s)}`);
        const left = await page.evaluate(() => {
          const ta = document.querySelector('.st-write .st-ta');
          return { marks: document.querySelectorAll('.st-hl .st-mark').length, sel: ta.value.slice(ta.selectionStart, ta.selectionEnd), note: document.querySelector('.st-note')?.textContent ?? '' };
        });
        h.expect(!left.marks && !left.sel && left.note !== 'What you searched for is marked on the page.', `${at}: the search was marked on the ${c.tap} side: ${JSON.stringify(left)}`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** the browser's own Back and Forward (a phone's back gesture is the same step): Back from a result shows the search
   *  the player left, from memory; Forward opens the page unmarked; nothing typed reaches history, the address or the
   *  saved session at any point, and after Clear everything no search words are left anywhere */
  async 'story-search-browser-history'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', undefined, recordHistory);
    const bad = [];
    try {
      await h.reachHub(page);
      await shelf(page);
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await field(page).waitFor();
      const r = await search(h, page, 'brass ferry');
      h.expect(r.stories.length === 1 && r.stories[0].rows.map((x) => x.where).join() === 'Notes', `"brass ferry" found ${JSON.stringify(r.stories)}`);
      await noneTyped(page, 'searching', bad);
      await page.locator('.st-found-row', { hasText: 'Notes' }).click();
      await routeIs(page, 'write');
      await page.waitForSelector('.st-hl .st-mark.is-place');
      h.expect((await placeShown(page)).text === 'brass', 'the result did not open the notes at "brass"');
      await noneTyped(page, 'a result opened', bad);

      const searchShown = (when) =>
        page.evaluate(() => ({ q: document.querySelector('.st-find-in').value, rows: document.querySelectorAll('.st-found-row').length })).then((s) => {
          if (s.q !== 'brass ferry' || !s.rows) bad.push(`${when} showed ${JSON.stringify(s)}, not the search they left`);
        });
      // Back comes to the search as they left it, kept in memory with that visit
      await page.goBack({ waitUntil: 'commit' });
      await routeIs(page, 'stories');
      await field(page).waitFor();
      await h.sleep(450);
      await searchShown('Back from the result');
      await noneTyped(page, 'Back', bad);

      // Forward opens the page as a revisit does: nothing marked, selected or said about the search
      await page.goForward({ waitUntil: 'commit' });
      await routeIs(page, 'write');
      await page.getByRole('textbox', { name: 'Notes for this story' }).waitFor();
      await page.waitForFunction((t) => document.querySelector('.st-write .st-ta')?.value === t, NOTES, { timeout: 5000 });
      await h.sleep(400);
      const fwd = await page.evaluate(() => {
        const ta = document.querySelector('.st-write .st-ta');
        return { marks: document.querySelectorAll('.st-hl .st-mark').length, sel: ta.value.slice(ta.selectionStart, ta.selectionEnd), note: document.querySelector('.st-note')?.textContent ?? '' };
      });
      if (fwd.marks || fwd.sel || fwd.note === 'What you searched for is marked on the page.') bad.push(`Forward marked the page again from history: ${JSON.stringify(fwd)}`);
      await noneTyped(page, 'Forward', bad);

      // and Back again still has the search
      await page.goBack({ waitUntil: 'commit' });
      await routeIs(page, 'stories');
      await field(page).waitFor();
      await h.sleep(450);
      await searchShown('A second Back');
      await noneTyped(page, 'a second Back', bad);
      await page.goForward({ waitUntil: 'commit' });
      await routeIs(page, 'write');
      await page.getByRole('textbox', { name: 'Notes for this story' }).waitFor();

      // Clear everything from there, so the opened result stays behind in history; then every entry left in history,
      // the session and what the app holds for Back and Forward
      await page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
      await page.locator('#set-playerName').waitFor();
      await page.locator('.dq-clear').scrollIntoViewIfNeeded();
      await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Back up, then clear' }).click()]);
      await page.locator('.dq-clear.is-asking').waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: /^Clear this game.s data$/ }).click();
      await page.locator('.dq-cleared-h', { hasText: 'All clear' }).waitFor({ timeout: 30000 });
      const held = await page.evaluate(() => ({ session: JSON.stringify(Object.entries(sessionStorage)), memory: JSON.stringify([window.__daily.trail, [...window.__daily.kept.values()]]) }));
      if (TYPED.test(held.session)) bad.push(`after clearing, the session holds the search: ${held.session}`);
      if (TYPED.test(held.memory)) bad.push(`after clearing, the app still holds the search for Back and Forward: ${held.memory}`);
      for (let n = 0; n < 12; n++) {
        await noneTyped(page, `after clearing, ${n} steps back`, bad);
        if (!((await page.evaluate(() => history.state?.i)) > 0)) break;
        await page.goBack({ waitUntil: 'commit' });
        await h.sleep(200);
      }
      // the saved session is made of these entries: none was ever written with a word of the search
      const written = (await page.evaluate(() => window.__written)).filter((w) => TYPED.test(w));
      if (written.length) bad.push(`the search was written into history ${written.length} times, first as ${written[0]}`);
      h.expect(!bad.length, bad.join('\n'));
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** each result opens what it showed: every place in a story can be opened (past the first six, Notes too), a tap
   *  made before the next search runs opens with the words that found it, and typing on the page while it opens wins
   *  over the marks and the cursor */
  async 'story-search-result-taps'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute');
    try {
      await h.reachHub(page);
      await shelf(page);
      // "comet" in eight chapters and the notes of one story
      const sky = await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const a = await ss.create('Sky Book');
        const ids = [a.first.id];
        await ss.saveChapter({ ...a.first, title: 'Sky 1', text: 'A comet crossed the sky.' }, [a.first.rev]);
        for (let i = 2; i <= 8; i++) {
          const c = await ss.addChapter(a.story.id);
          await ss.saveChapter({ ...c, title: `Sky ${i}`, text: `Night ${i}: the comet came back.` }, [c.rev]);
          ids.push(c.id);
        }
        const notes = await ss.chapter(a.story.notes);
        await ss.saveChapter({ ...notes, text: 'The comet comes every spring.' }, [notes.rev]);
        return ids;
      });
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await field(page).waitFor();
      const places = () => page.evaluate(() => [...[...document.querySelectorAll('.st-found-story')].find((s) => s.querySelector('.st-found-head .st-row-t').textContent === 'Sky Book').querySelectorAll('.st-found-where')].map((e) => e.textContent).join());

      // six places show; the rest, Notes last, come on a tap, and the first of them takes the focus
      await search(h, page, 'comet');
      h.expect((await places()) === 'Sky 1,Sky 2,Sky 3,Sky 4,Sky 5,Sky 6', `the first look shows ${await places()}`);
      const more = page.getByRole('button', { name: 'Show 3 more places in this story' });
      const tall = await more.evaluate((e) => e.getBoundingClientRect().height);
      h.expect(tall >= 44, `"more places" is ${tall}px tall, under a 44px tap`);
      await more.scrollIntoViewIfNeeded();
      await h.shot(page, 'more-places');
      await more.click();
      h.expect((await places()) === 'Sky 1,Sky 2,Sky 3,Sky 4,Sky 5,Sky 6,Sky 7,Sky 8,Notes', `after "more" the story shows ${await places()}`);
      h.expect(!(await more.count()), '"more places" stayed after showing them');
      h.expect((await page.evaluate(() => document.activeElement?.querySelector('.st-found-where')?.textContent)) === 'Sky 7', 'the focus did not move to the first place shown');
      await page.locator('.st-found-row', { hasText: 'Notes' }).click();
      await routeIs(page, 'write');
      await page.getByRole('textbox', { name: 'Notes for this story' }).waitFor();
      await page.waitForSelector('.st-hl .st-mark.is-place', { timeout: 5000 }).catch(() => null);
      let p = await placeShown(page);
      h.expect(p?.text === 'comet' && p.sel === 'comet', `the notes found past the first six did not open at "comet": ${JSON.stringify(p)}`);

      // they change the words and tap a result before the next search runs: it opens with the words that found it
      await page.evaluate(() => window.__daily.back());
      await routeIs(page, 'stories');
      await page.waitForFunction(() => document.querySelectorAll('.st-found-row').length > 0, null, { timeout: 5000 });
      await page.evaluate(() => {
        const f = document.querySelector('.st-find-in');
        f.value = 'zebra';
        f.dispatchEvent(new Event('input', { bubbles: true }));
        [...document.querySelectorAll('.st-found-row')].find((b) => b.querySelector('.st-found-where').textContent === 'Sky 2').click();
      });
      await routeIs(page, 'write');
      await page.getByRole('textbox', { name: 'Page, Sky 2' }).waitFor();
      await page.waitForSelector('.st-hl .st-mark.is-place', { timeout: 5000 }).catch(() => null);
      p = await placeShown(page);
      h.expect(p?.text === 'comet' && p.sel === 'comet', `a tap before the next search opened without its words marked: ${JSON.stringify(p)}`);

      // they type while the result is still opening: nothing is marked after, and the cursor stays where they typed
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await field(page).waitFor();
      await search(h, page, 'comet');
      const { waitHeld, drain } = await holdStorage(page, ['onDisk']);
      await page.locator('.st-found-row', { hasText: 'Sky 3' }).click();
      await routeIs(page, 'write');
      const box = page.getByRole('textbox', { name: 'Page, Sky 3' });
      await box.waitFor();
      // the page shows Sky 3, and the opening waits on storage
      await waitHeld(`onDisk ${sky[2]}`);
      await box.click();
      await page.keyboard.press('End');
      await page.keyboard.type('!');
      await drain();
      await h.sleep(300);
      await drain();
      const left = await page.evaluate(() => {
        const ta = document.querySelector('.st-write .st-ta');
        return { text: ta.value, marks: document.querySelectorAll('.st-hl .st-mark').length, at: [ta.selectionStart, ta.selectionEnd], note: document.querySelector('.st-note')?.textContent ?? '' };
      });
      h.expect(left.text === 'Night 3: the comet came back.!' && !left.marks && left.at[0] === left.text.length && left.at[1] === left.text.length && left.note !== 'What you searched for is marked on the page.', `typing while the result opened was overruled by the search: ${JSON.stringify(left)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** removing the only story from a search result comes back to the empty shelf, not to a search with no field left */
  async 'story-search-last-story-removed'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute');
    try {
      await h.reachHub(page);
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const a = await ss.create('Only One');
        await ss.saveChapter({ ...a.first, text: 'The comet came back.' }, [a.first.rev]);
      });
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await field(page).waitFor();
      await search(h, page, 'comet');
      await page.locator('.st-found-row').first().click();
      await routeIs(page, 'write');
      await page.getByRole('textbox', { name: /^Page, / }).waitFor();
      await page.getByRole('button', { name: 'More' }).click();
      await page.getByRole('menuitem', { name: 'Remove story' }).click();
      await routeIs(page, 'stories');
      await page.waitForFunction(() => !!document.querySelector('.st-empty')?.checkVisibility(), null, { timeout: 5000 }).catch(() => null);
      await h.sleep(300);
      const s = await page.evaluate(() => ({
        empty: !!document.querySelector('.st-empty')?.checkVisibility(),
        newStory: [...document.querySelectorAll('.st-empty button')].some((b) => b.checkVisibility()),
        finding: document.querySelector('.st-shelfpage').classList.contains('is-finding'),
        status: document.querySelector('.st-find-n').textContent,
        field: document.querySelector('.st-find-in').value,
      }));
      await h.shot(page, 'last-story-removed');
      h.expect(s.empty && s.newStory && !s.finding && !s.status && !s.field, `removing the last story left a search with no way out: ${JSON.stringify(s)}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** results fit at every size: no sideways scroll, 16 px text, held sideways and on desktop too */
  async 'story-search-fits'(h) {
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
      const at = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      try {
        await h.reachHub(page);
        await shelf(page);
        await page.evaluate(() => window.__daily.go({ name: 'stories' }));
        await field(page).waitFor();
        await h.shot(page, `shelf-${at}`);
        await search(h, page, 'the');
        await h.shot(page, `results-${at}`);
        const f = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          const sc = document.querySelector('.dq');
          const out = [...document.querySelectorAll('.st-find, .st-found *')].filter((e) => e.checkVisibility()).filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width && (r.left < -1 || r.right > w + 1);
          });
          return {
            wide: sc.scrollWidth > sc.clientWidth + 1,
            out: out.slice(0, 3).map((e) => e.className),
            snip: Math.min(...[...document.querySelectorAll('.st-found *')].filter((e) => e.checkVisibility() && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize))),
            input: parseFloat(getComputedStyle(document.querySelector('.st-find-in')).fontSize),
            rows: Math.min(...[...document.querySelectorAll('.st-found-row, .st-found-head')].map((e) => e.getBoundingClientRect().height)),
          };
        });
        h.expect(!f.wide && !f.out.length, `${at}: results reach past the edge: ${f.out.join(', ')}`);
        h.expect(f.snip >= 16 && f.input >= 16, `${at}: search text under 16 px (snippets ${f.snip}, field ${f.input})`);
        h.expect(f.rows >= 44, `${at}: a result is ${f.rows}px tall, under a 44px tap`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },
};
