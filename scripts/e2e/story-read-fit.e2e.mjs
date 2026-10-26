// Story Room, the read view and the writing bar: Read opened from a later chapter starts that chapter clear of the top
// bar and its shade and stays there (from an empty chapter, at the nearest one before it), focus lands on a heading
// that already holds the story title, the text size buttons carry their visible "A" in their names, the starting point
// leaves the page's first line in view on a phone held sideways, and no save message in the writing bar runs into the
// Co-writer button or out of the bar.

const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'read-fit-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});
const routeIs = (page, name) => page.waitForFunction((n) => window.__daily?.route.name === n, name, { timeout: 10000 });
const para = (n, w) => Array.from({ length: n }, (_, i) => `${w} ${i + 1}. The path went on past the mill and the bridge, and the lantern swung on its hook the whole way down to the sea.`).join('\n\n');
const PHONES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];
const SIDEWAYS = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
];
const ALL = [...PHONES, SIDEWAYS[0], { width: 1280, height: 800 }];
const tag = (vp) => `${vp.width}x${vp.height}`;

/** a story of three long chapters, made through the app's own store */
async function threeChapters(page) {
  return page.evaluate(
    async (texts) => {
      const { storyStore } = await import('/src/daily/storystore.ts');
      const ss = storyStore(window.__daily.store.key);
      const { story, first } = await ss.create('The Long Night');
      await ss.saveChapter({ ...first, title: 'Winter', text: texts[0] }, [first.rev]);
      const ids = [first.id];
      for (const [i, t] of texts.slice(1).entries()) {
        const next = await ss.addChapter(story.id);
        await ss.saveChapter({ ...next, title: ['Spring', 'Summer'][i], text: t }, [next.rev]);
        ids.push(next.id);
      }
      return { story: story.id, ch: ids };
    },
    [para(8, 'Snow'), para(8, 'Rain'), para(8, 'Sun')],
  );
}

/** where the top bar and its shade end, and where a chapter (its divider) and its heading sit on screen */
const chapterPlace = (page, i) =>
  page.evaluate((n) => {
    const bar = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const shade = parseFloat(getComputedStyle(document.querySelector('.dq')).getPropertyValue('--top-shade')) || 0;
    const sec = document.querySelectorAll('.st-read-ch')[n].getBoundingClientRect();
    const hd = document.querySelectorAll('.st-read-ch-h')[n].getBoundingClientRect();
    return { clear: bar + shade, top: sec.top, head: hd.top, headBottom: hd.bottom, vh: innerHeight };
  }, i);

async function openRead(page, ids, ch) {
  await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch });
  await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Read', exact: true }).click();
  await routeIs(page, 'read');
  await page.locator('.st-read-ch').nth(2).waitFor();
}

export const scenarios = {
  /** Read from chapter 2 or 3 opens with that chapter clear of the top bar and its shade, and stays put; from chapter 1 at the top */
  async 'story-read-opens-in-place'(h) {
    for (const vp of ALL) {
      const at = tag(vp);
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      try {
        await h.reachHub(page);
        const ids = await threeChapters(page);
        for (const n of [1, 2]) {
          await openRead(page, ids, ids.ch[n]);
          // once the screen's 300 ms entry has played, nothing moves it
          await h.sleep(400);
          const first = await chapterPlace(page, n);
          await h.sleep(700);
          const p = await chapterPlace(page, n);
          await h.shot(page, `read-ch${n + 1}-${at}`);
          h.expect(Math.abs(p.top - first.top) <= 1, `${at}: Read from chapter ${n + 1} moved after it opened (${first.top.toFixed(1)} to ${p.top.toFixed(1)})`);
          h.expect(p.top >= p.clear - 0.5, `${at}: Read from chapter ${n + 1} opens with the chapter under the top bar or its shade (${p.top.toFixed(1)} < ${p.clear.toFixed(1)})`);
          h.expect(p.top - p.clear < 24 && p.headBottom <= p.vh, `${at}: Read from chapter ${n + 1} does not open at that chapter (it starts at ${p.top.toFixed(1)}, the bar ends ${p.clear.toFixed(1)})`);
          await page.getByRole('button', { name: 'Back to writing' }).click();
          await routeIs(page, 'write');
        }
        await openRead(page, ids, ids.ch[0]);
        await h.sleep(400);
        h.expect((await page.evaluate(() => document.querySelector('.dq').scrollTop)) === 0, `${at}: Read from chapter 1 does not open at the top`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** Read from a chapter with no words yet (one just added) opens at the nearest chapter before it, not back at chapter 1 */
  async 'story-read-from-empty-chapter'(h) {
    for (const vp of [PHONES[0], SIDEWAYS[2]]) {
      const at = tag(vp);
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      try {
        await h.reachHub(page);
        const ids = await threeChapters(page);
        const empty = await page.evaluate(async (id) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          return (await storyStore(window.__daily.store.key).addChapter(id)).id;
        }, ids.story);
        await openRead(page, ids, empty);
        await h.sleep(400);
        const p = await chapterPlace(page, 2);
        await h.shot(page, `read-empty-ch4-${at}`);
        h.expect((await page.locator('.st-read-ch').count()) === 3, `${at}: the empty chapter shows in Read`);
        h.expect(p.top >= p.clear - 0.5 && p.top - p.clear < 24 && p.headBottom <= p.vh, `${at}: Read from an empty chapter 4 does not open at chapter 3 (it starts at ${p.top.toFixed(1)}, the bar ends ${p.clear.toFixed(1)})`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** focus lands on a heading that already says the story's title, and the size buttons are named by their visible "A" */
  async 'story-read-names'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      const ids = await threeChapters(page);
      // the story is slow to come out of storage, so focus can't be right by luck
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const story = ss.story;
        ss.story = async function (...a) {
          await new Promise((r) => setTimeout(r, 600));
          return story.apply(this, a);
        };
        window.__focusSeen = [];
        document.addEventListener('focusin', (e) => window.__focusSeen.push({ tag: e.target.tagName, text: e.target.textContent }), true);
      });
      await page.evaluate((r) => window.__daily.go(r), { name: 'read', id: ids.story, ch: ids.ch[1] });
      await page.locator('.st-read-ch').nth(2).waitFor();
      const seen = await page.evaluate(() => window.__focusSeen.filter((f) => f.tag === 'H1'));
      h.expect(seen.length >= 1, 'focus never reached the reading heading');
      h.expect(seen.every((f) => f.text === 'The Long Night'), `focus reached the heading before it held the title: ${JSON.stringify(seen)}`);
      const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent }));
      h.expect(active.tag === 'H1' && active.text === 'The Long Night', `focus is not on the titled heading: ${JSON.stringify(active)}`);

      // label in name: each button's name starts with what it shows, so "click A" and "click A larger" both work
      const names = await page.evaluate(() =>
        [...document.querySelectorAll('.st-size .dq-seg-b')].map((b) => ({ shows: b.textContent.trim(), label: b.getAttribute('aria-label') ?? b.textContent.trim() })),
      );
      h.expect(names.length === 3, `there are not three size buttons: ${JSON.stringify(names)}`);
      for (const n of names) h.expect(n.label.toLowerCase().startsWith(n.shows.toLowerCase() + ' '), `the size button showing "${n.shows}" is named "${n.label}"`);
      h.expect(new Set(names.map((n) => n.label)).size === 3, `two size buttons share a name: ${JSON.stringify(names)}`);
      // and the group still says what they change
      const group = await page.evaluate(() => {
        const g = document.querySelector('.st-size');
        return document.getElementById(g.getAttribute('aria-labelledby'))?.textContent;
      });
      h.expect(group === 'Text size', `the size buttons' group is named "${group}"`);
      const largest = page.getByRole('button', { name: names[2].label, exact: true });
      await largest.click();
      h.expect((await largest.getAttribute('aria-pressed')) === 'true', 'the largest size button is not pressed after a tap');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** the starting point keeps its line, Use this and the page's first line in view between the bars, sideways too */
  async 'story-start-sideways'(h) {
    for (const vp of [...SIDEWAYS, ...PHONES, { width: 1280, height: 800 }]) {
      const at = tag(vp);
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      try {
        await h.reachHub(page);
        const ids = await threeChapters(page);
        await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch[0] });
        await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
        await page.waitForFunction(() => document.querySelector('.st-start-tg') && !document.querySelector('.st-start-tg').disabled, null, { timeout: 10000 });
        const place = () =>
          page.evaluate(() => {
            const r = (s) => document.querySelector(s).getBoundingClientRect();
            const ta = document.querySelector('.st-ta');
            const cs = getComputedStyle(ta);
            const line = ta.getBoundingClientRect().top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop) + parseFloat(cs.lineHeight);
            return { bar: r('.dq-top').bottom, dock: r('.st-dock').top, box: r('.st-start-box'), use: r('.st-start-acts .dq-btn--primary'), line };
          });
        // every line in the list, since a longer one takes more rows
        const lines = await page.evaluate(async () => (await import('/src/content/story-lines.ts')).STORY_START.prompts.length);
        for (let n = 0; n < lines; n++) {
          const step = n ? `another ${n}` : 'open';
          await (n ? page.getByRole('button', { name: 'Another' }) : page.getByRole('button', { name: 'Need a starting point?' })).click();
          await h.sleep(n ? 150 : 400);
          const p = await place();
          if (n < 2) await h.shot(page, `start-${n ? 'another' : 'open'}-${at}`);
          h.expect(p.box.top >= p.bar - 0.5, `${at} ${step}: the starting point's line is under the top bar (${p.box.top.toFixed(1)} < ${p.bar.toFixed(1)})`);
          h.expect(p.use.bottom <= p.dock + 0.5, `${at} ${step}: Use this is under the bottom bar (${p.use.bottom.toFixed(1)} > ${p.dock.toFixed(1)})`);
          h.expect(p.line <= p.dock + 0.5, `${at} ${step}: the page's first line is under the bottom bar with the starting point open (it ends at ${p.line.toFixed(1)}, the bar starts at ${p.dock.toFixed(1)})`);
        }
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** every save message sits inside the writing bar in at most two lines, never over or under the Co-writer button */
  async 'story-writing-bar-fits'(h) {
    for (const vp of ALL) {
      for (const state of ['saved', 'not saving']) {
        const at = `${tag(vp)} ${state}`;
        // with the story store refused, the bar says it is not saving
        const deny =
          state === 'not saving'
            ? (ctx) =>
                ctx.addInitScript(() => {
                  const open = indexedDB.open.bind(indexedDB);
                  indexedDB.open = function (name, ...args) {
                    if (/\.story$/.test(String(name))) throw new DOMException('Storage denied', 'SecurityError');
                    return open(name, ...args);
                  };
                })
            : undefined;
        const { ctx, page, errors } = await h.open(seed(h), '?mute', vp, deny);
        try {
          await h.reachHub(page);
          const ids = await threeChapters(page);
          await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch[0] });
          await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
          await page.locator('.st-state').filter({ hasText: state === 'saved' ? 'Saved on this device' : 'Not saving right now' }).waitFor();
          await h.sleep(300);
          const d = await page.evaluate(() => {
            const r = (e) => e.getBoundingClientRect();
            const el = document.querySelector('.st-state');
            const range = document.createRange();
            range.selectNodeContents(el);
            const rects = [...range.getClientRects()].filter((x) => x.width > 0);
            const text = rects.reduce((a, x) => ({ left: Math.min(a.left, x.left), right: Math.max(a.right, x.right), top: Math.min(a.top, x.top), bottom: Math.max(a.bottom, x.bottom) }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
            const lines = new Set(rects.map((x) => Math.round(x.top))).size;
            const btns = [...document.querySelectorAll('.st-dock-in button')].filter((b) => b.checkVisibility()).map(r);
            return { text, lines, btns, dock: r(document.querySelector('.st-dock-in')), fs: parseFloat(getComputedStyle(el).fontSize), docW: document.documentElement.clientWidth };
          });
          await h.shot(page, `writing-bar-${at.replace(' ', '-')}`);
          const hit = d.btns.find((b) => d.text.right > b.left + 0.5 && d.text.left < b.right - 0.5 && d.text.bottom > b.top + 0.5 && d.text.top < b.bottom - 0.5);
          h.expect(!hit, `${at}: the save message runs into a button (text ${d.text.left.toFixed(1)}-${d.text.right.toFixed(1)} x ${d.text.top.toFixed(1)}-${d.text.bottom.toFixed(1)}, button ${hit?.left.toFixed(1)}-${hit?.right.toFixed(1)})`);
          h.expect(d.text.left >= d.dock.left - 0.5 && d.text.right <= d.dock.right + 0.5 && d.text.top >= d.dock.top - 0.5 && d.text.bottom <= d.dock.bottom + 0.5, `${at}: the save message spills out of the bar`);
          h.expect(d.lines <= 2, `${at}: the save message takes ${d.lines} lines`);
          h.expect(d.fs >= 16, `${at}: the save message is ${d.fs} px, under 16`);
          h.expect(d.dock.right <= d.docW + 0.5, `${at}: the writing bar reaches past the edge`);
          h.expect(!errors.length, errors.join('\n'));
        } finally {
          await ctx.close();
        }
      }
    }
  },
};
