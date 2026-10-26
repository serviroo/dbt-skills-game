// Story Room, bringing a story back in: a downloaded story comes back as a new story with the same title, chapters
// and notes, exactly; nothing is added before Add, nothing already here is changed, the file's text is only ever
// text, and files that are too big, not text, empty or shaped differently are handled in plain words.
import fs from 'node:fs';
import path from 'node:path';

const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'bring-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});
const routeIs = (page, name) => page.waitForFunction((n) => window.__daily?.route.name === n, name, { timeout: 10000 });

const WINTER = 'Snow fell on the harbour.\n\n## Not a heading, just a line she wrote\n\n# Nor this one\n\\## or this\n\n    An indented line.\nThe end of winter.';
const SPRING = 'The kettle sang. <script>window.__ran = 1</script> **bold** <img src=x onerror="window.__ran=1">\n\nShe laughed.';
const NOTES = 'Mira keeps the brass key.\n\n## Places\nThe mill, the bridge.';

/** every story with its chapters and notes, as the store holds them */
const everything = (page) =>
  page.evaluate(async () => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    const ss = storyStore(window.__daily.store.key);
    const out = [];
    for (const s of await ss.list()) {
      const chs = await Promise.all(s.chapters.map((id) => ss.chapter(id)));
      out.push({ id: s.id, title: s.title, chapters: chs.map((c) => ({ title: c.title, text: c.text })), notes: (await ss.chapter(s.notes))?.text ?? '' });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  });

async function shelfOf(h, page) {
  await page.evaluate(() => window.__daily.go({ name: 'stories' }));
  await page.getByRole('button', { name: 'Bring in a story' }).first().waitFor();
}
/** taps Bring in a story and picks the file through the real chooser */
async function bringIn(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Bring in a story' }).first().click()]);
  await chooser.setFiles(file);
  await page.locator('.st-bring-box:not(.is-hidden) .st-bring-h').waitFor();
  return page.evaluate(() => ({
    head: document.querySelector('.st-bring-h').textContent,
    count: document.querySelector('.st-bring-box .st-bring-t')?.textContent ?? '',
    chapters: [...document.querySelectorAll('.st-bring-ch')].map((c) => [c.querySelector('.st-bring-ct').textContent, c.querySelector('.st-bring-cx')?.textContent ?? '']),
    same: !!document.querySelector('.st-bring-same'),
    focus: document.activeElement?.classList.contains('st-bring-h'),
  }));
}
const write = (h, name, body) => {
  const f = path.join(h.out, name);
  fs.writeFileSync(f, body);
  return f;
};

export const scenarios = {
  /** Download story, then Bring in a story: the same story again, next to the first, exactly */
  async 'story-bring-in-round-trip'(h) {
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const at = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      try {
        await h.reachHub(page);
        const ids = await page.evaluate(
          async (t) => {
            const { storyStore } = await import('/src/daily/storystore.ts');
            const ss = storyStore(window.__daily.store.key);
            const { story, first } = await ss.create('The Long Night');
            await ss.saveChapter({ ...first, title: 'Winter', text: t.WINTER }, [first.rev]);
            const next = await ss.addChapter(story.id);
            await ss.saveChapter({ ...next, title: 'Spring', text: t.SPRING }, [next.rev]);
            const notes = await ss.chapter(story.notes);
            await ss.saveChapter({ ...notes, text: t.NOTES }, [notes.rev]);
            return { story: story.id, ch: first.id };
          },
          { WINTER, SPRING, NOTES },
        );
        // the story goes out through Download story, as a player would
        await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch });
        await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
        await page.getByRole('button', { name: 'More', exact: true }).click();
        const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download story' }).click()]);
        const file = path.join(h.out, `round-trip-${at}.txt`);
        await dl.saveAs(file);
        const before = await everything(page);

        await shelfOf(h, page);
        let p = await bringIn(page, file);
        await h.shot(page, `preview-${at}`);
        h.expect(p.head === 'Bring in “The Long Night”?' && p.count === '2 chapters and notes', `${at}: the preview reads ${JSON.stringify(p)}`);
        h.expect(p.chapters.map((c) => c[0]).join('|') === 'Winter|Spring|Notes' && p.chapters[0][1] === 'Snow fell on the harbour.', `${at}: the preview lists ${JSON.stringify(p.chapters)}`);
        h.expect(p.same && p.focus, `${at}: the preview does not say a story has this name, or focus is not on it`);
        h.expect(!(await page.locator('.st-bring-box script, .st-bring-box img').count()) && !(await page.evaluate(() => window.__ran)), `${at}: text from the file ran as markup`);
        h.expect(JSON.stringify(await everything(page)) === JSON.stringify(before), `${at}: something was added before Add`);
        // the Safe Zone is one tap away with the preview open
        h.expect(await page.locator('.dq-top .dq-safe').isVisible(), `${at}: no Safe Zone button with the preview open`);

        // Not now adds nothing
        await page.getByRole('button', { name: 'Not now' }).click();
        h.expect(await page.locator('.st-bring-box').evaluate((e) => e.classList.contains('is-hidden')), `${at}: Not now left the preview open`);
        h.expect(JSON.stringify(await everything(page)) === JSON.stringify(before), `${at}: Not now added something`);
        h.expect(await page.evaluate(() => document.activeElement?.textContent?.includes('Bring in a story')), `${at}: focus did not go back to Bring in a story`);

        // Add brings it in as a new story, next to the first, which stays as it was
        p = await bringIn(page, file);
        await page.getByRole('button', { name: 'Add as a new story' }).click();
        await page.locator('.st-bring-said', { hasText: '“The Long Night” is on your shelf now.' }).waitFor();
        await h.sleep(300);
        await h.shot(page, `added-${at}`);
        const after = await everything(page);
        h.expect(after.length === before.length + 1, `${at}: ${after.length - before.length} stories were added`);
        const old = after.find((s) => s.id === ids.story);
        h.expect(JSON.stringify(old) === JSON.stringify(before.find((s) => s.id === ids.story)), `${at}: the story already here changed`);
        const added = after.find((s) => !before.some((b) => b.id === s.id));
        h.expect(added.title === 'The Long Night', `${at}: the new story is called ${added.title}`);
        h.expect(JSON.stringify(added.chapters) === JSON.stringify([{ title: 'Winter', text: WINTER }, { title: 'Spring', text: SPRING }]), `${at}: the chapters came back as ${JSON.stringify(added.chapters)}`);
        h.expect(added.notes === NOTES, `${at}: the notes came back as ${JSON.stringify(added.notes)}`);
        h.expect(await page.evaluate(() => document.activeElement?.classList.contains('st-row')), `${at}: focus is not on the new story`);
        h.expect((await page.locator('.st-row .st-row-t', { hasText: 'The Long Night' }).count()) === 2, `${at}: the shelf does not show both stories`);

        // the new story reads as text, never as markup
        await page.locator('.st-row').first().click();
        await routeIs(page, 'write');
        await page.getByRole('textbox', { name: 'Page, Winter' }).waitFor();
        h.expect((await page.getByRole('textbox', { name: 'Page, Winter' }).inputValue()) === WINTER, `${at}: the page shows something else`);
        h.expect(!(await page.evaluate(() => window.__ran)), `${at}: text from the file ran`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },

  /** too big, not text, empty, Markdown, plain text, an older download and a chapter longer than a chapter holds */
  async 'story-bring-in-files'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await shelfOf(h, page);
      const none = await everything(page);
      const refused = async (name, body, words) => {
        const p = await bringIn(page, write(h, name, body));
        const said = await page.locator('.st-bring-box .st-bring-t').textContent();
        h.expect(p.head === 'Bring in a story' && said === words, `${name}: says ${JSON.stringify(said)}`);
        h.expect(!(await page.getByRole('button', { name: 'Add as a new story' }).count()), `${name}: offers to add it anyway`);
        await page.getByRole('button', { name: 'Close' }).click();
        h.expect(JSON.stringify(await everything(page)) === JSON.stringify(none), `${name}: something was added`);
      };
      await refused('huge.txt', 'a'.repeat(1_000_001), 'That file is too big to bring in. A story file can be up to 1 MB.');
      await refused('picture.txt', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]), 'That file isn’t plain text. Try a .txt or .md file, like the ones Download story makes.');
      await refused('empty.txt', '\n\n   \n', 'That file has no words in it yet.');

      const added = async (name, body) => {
        const p = await bringIn(page, write(h, name, body));
        const was = await everything(page);
        await page.getByRole('button', { name: 'Add as a new story' }).click();
        await page.locator('.st-bring-said:not(:empty)').waitFor();
        await page.waitForFunction(() => !document.querySelector('.st-bring-said:empty'));
        const now = await everything(page);
        return { p, story: now.find((s) => !was.some((w) => w.id === s.id)) };
      };
      // Markdown: one "#" names it, "##" starts chapters
      let r = await added('river.md', '# The River\n\n## Morning\n\nMist on the water.\n\n## Evening\n\nLanterns on the bank.\n');
      h.expect(r.story.title === 'The River' && r.story.chapters.map((c) => `${c.title}:${c.text}`).join('|') === 'Morning:Mist on the water.|Evening:Lanterns on the bank.', `river.md came in as ${JSON.stringify(r.story)}`);
      // several "#" headings are chapters, named by the file
      r = await added('three_tales.md', '# One\nA fox.\n# Two\nA hare.\n');
      h.expect(r.story.title === 'three tales' && r.story.chapters.map((c) => c.title).join('|') === 'One|Two', `three_tales.md came in as ${JSON.stringify(r.story)}`);
      // plain text: a short first line on its own names it, the rest is one chapter
      r = await added('walk.txt', 'A Walk\n\nWe went down to the sea.\n\nThe tide was out.\n');
      h.expect(r.story.title === 'A Walk' && r.story.chapters.length === 1 && r.story.chapters[0].title === 'Chapter 1' && r.story.chapters[0].text === 'We went down to the sea.\n\nThe tide was out.', `walk.txt came in as ${JSON.stringify(r.story)}`);
      // a download from before headings: Chapter lines and Notes on their own
      r = await added('older.txt', 'Old Night\n\nChapter 1\n\nIt was dark.\n\nVery dark.\n\nChapter 2\n\nThen light.\n\nNotes\n\nRemember the owl.\n');
      h.expect(r.story.title === 'Old Night' && JSON.stringify(r.story.chapters) === JSON.stringify([{ title: 'Chapter 1', text: 'It was dark.\n\nVery dark.' }, { title: 'Chapter 2', text: 'Then light.' }]) && r.story.notes === 'Remember the owl.', `older.txt came in as ${JSON.stringify(r.story)}`);
      // a chapter longer than one chapter holds goes on in the next, nothing lost
      const para = 'The waves came in and went out again, over and over, all through the long grey afternoon.';
      const long = Array.from({ length: 6000 }, () => para).join('\n\n');
      r = await added('long.txt', `# Long Tide\n\n${long}\n`);
      h.expect(r.p.count === '2 chapters', `long.txt preview says ${r.p.count}`);
      h.expect(r.story.chapters.map((c) => c.title).join('|') === 'Chapter 1|Chapter 1 (2)' && r.story.chapters.every((c) => c.text.length <= 400000), `long.txt split as ${r.story.chapters.map((c) => `${c.title} ${c.text.length}`)}`);
      h.expect(r.story.chapters.map((c) => c.text).join('\n\n') === long, 'long.txt lost text where it was split');
      h.expect(!(await page.evaluate(() => window.__ran)) && !errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** the preview fits at every size, text at 16 px or more, nothing past the edge */
  async 'story-bring-in-fits'(h) {
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
      const at = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      try {
        await h.reachHub(page);
        await page.evaluate(async () => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          await storyStore(window.__daily.store.key).create('A Night by the Water');
        });
        await shelfOf(h, page);
        await h.shot(page, `shelf-${at}`);
        await bringIn(page, write(h, `fit-${at}.txt`, '# A Very Long Title For A Story About The Lighthouse Keeper And Her Cat\n\n## The first chapter, which has a long name too\n\nSupercalifragilisticexpialidociouswordthatkeepsgoingonandon and more words.\n\n## Notes for this story\n\nKeep the lamp lit.\n'));
        await h.shot(page, `preview-${at}`);
        const f = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          const sc = document.querySelector('.dq');
          const els = [...document.querySelectorAll('.st-bring-box *')].filter((e) => e.checkVisibility());
          return {
            wide: sc.scrollWidth > sc.clientWidth + 1,
            out: els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > w + 1); }).map((e) => e.className).slice(0, 3),
            small: els.filter((e) => !e.closest(".dq-btn") && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => `${e.className} ${getComputedStyle(e).fontSize}`).slice(0, 3),
          };
        });
        h.expect(!f.wide && !f.out.length, `${at}: the preview reaches past the edge: ${f.out.join(', ')}`);
        h.expect(!f.small.length, `${at}: text under 16 px: ${f.small.join(', ')}`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },
};
