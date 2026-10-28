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
      // a chapter longer than one chapter holds goes on in the next, nothing lost, indents kept
      const para = 'The waves came in and went out again, over and over, all through the long grey afternoon.';
      const long = Array.from({ length: 6000 }, (_, i) => (i ? '  ' : '') + para).join('\n\n');
      r = await added('long.txt', `# Long Tide\n\n${long}\n`);
      h.expect(r.p.count === '2 chapters', `long.txt preview says ${r.p.count}`);
      h.expect(r.story.chapters.map((c) => c.title).join('|') === 'Chapter 1|Chapter 1 (2)' && r.story.chapters.every((c) => c.text.length <= 400000), `long.txt split as ${r.story.chapters.map((c) => `${c.title} ${c.text.length}`)}`);
      h.expect(r.story.chapters.map((c) => c.text).join('\n\n') === long, 'long.txt lost text where it was split');
      // a cut at a cap never splits a character in two: an emoji at the edge stays whole
      const wide = 'a'.repeat(399999);
      r = await added('wide.md', `# ${'c'.repeat(119)}😀\n\n## ${'b'.repeat(79)}😀\n\n${wide}😀end\n`);
      h.expect(r.story.title === 'c'.repeat(119) && JSON.stringify(r.story.chapters) === JSON.stringify([{ title: 'b'.repeat(79), text: wide }, { title: `${'b'.repeat(74)} (2)`, text: '😀end' }]), `wide.md came in as ${JSON.stringify([r.story.title.slice(-2), r.story.chapters.map((c) => [c.title.slice(-4), c.text.slice(-6)])])}`);
      // Notes longer than Notes hold go on in a page after the chapters, nothing lost
      const many = 'n'.repeat(400000);
      r = await added('big-notes.md', `# Big Notes\n\n## One\n\nA page.\n\n## Notes for this story\n\n${many}\n\nLAST WORDS\n`);
      h.expect(r.story.notes === many && JSON.stringify(r.story.chapters) === JSON.stringify([{ title: 'One', text: 'A page.' }, { title: 'Notes (2)', text: 'LAST WORDS' }]), `big-notes.md came in as Notes of ${r.story.notes.length} and ${JSON.stringify(r.story.chapters.map((c) => [c.title, c.text.slice(0, 20)]))}`);
      h.expect(!(await page.evaluate(() => window.__ran)) && !errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** long runs of spaces read, download and show in one pass: the page never freezes and the Safe Zone is one tap away */
  async 'story-bring-in-spaces'(h) {
    const gap = ' '.repeat(200_000);
    const files = [
      // a heading line and a chapter each with 200k spaces inside
      ['gap-heading.md', `# Wide Open\n\n## The${gap}gap\n\nShort${gap}story.\n`, 'Short' + gap + 'story.'],
      // 900 KB of spaces between two words
      ['gap-text.txt', `Once${' '.repeat(900_000)}upon a time.\n`, 'Once'],
    ];
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await shelfOf(h, page);
      // reading each file, and writing it back out the way Download does, take under 200 ms each
      const timed = await Promise.race([
        page
          .evaluate(async (list) => {
            const { storyFromText, storyToText } = await import('/src/daily/storytext.ts');
            return list.map(([name, body]) => {
              const t0 = performance.now();
              const s = storyFromText(body, name);
              const t1 = performance.now();
              storyToText(s);
              return { name, read: t1 - t0, write: performance.now() - t1 };
            });
          }, files)
          .catch(() => null),
        h.sleep(10000).then(() => null),
      ]);
      h.expect(timed, 'reading the files froze the page for more than 10 s');
      fs.writeFileSync(path.join(h.out, 'spaces-timing.json'), JSON.stringify(timed, null, 1));
      for (const t of timed) h.expect(t.read < 200 && t.write < 200, `${t.name}: read in ${Math.round(t.read)} ms, written in ${Math.round(t.write)} ms`);

      const quick = async (what, ms, step) => {
        const t0 = Date.now();
        await step();
        h.expect(Date.now() - t0 < ms, `${what} took ${Date.now() - t0} ms`);
      };
      for (const [name, body, first] of files) {
        // through the real chooser: the preview comes up at once and the Safe Zone opens on the first tap
        const file = write(h, name, body);
        await quick(`${name}: the preview`, 2000, () => bringIn(page, file));
        await quick(`${name}: the Safe Zone`, 1000, async () => {
          await page.locator('.dq-top .dq-safe').click({ timeout: 1000 });
          await page.waitForFunction(() => window.__daily?.route.name === 'safe', null, { timeout: 1000 });
        });
        await shelfOf(h, page);
        // added, it keeps its words and reads at once, the Safe Zone still one tap away
        const was = await everything(page);
        await bringIn(page, file);
        await page.getByRole('button', { name: 'Add as a new story' }).click();
        await page.locator('.st-bring-said:not(:empty)').waitFor();
        const story = (await everything(page)).find((s) => !was.some((w) => w.id === s.id));
        h.expect(story?.chapters[0]?.text === first, `${name}: the first chapter came in as ${JSON.stringify(story?.chapters[0]?.text.slice(0, 40))}…`);
        await quick(`${name}: the reading view`, 2000, async () => {
          await page.evaluate((r) => window.__daily.go(r), { name: 'read', id: story.id });
          await page.locator('.st-read-text').first().waitFor({ timeout: 2000 });
        });
        await quick(`${name}: the Safe Zone from the reading view`, 1000, async () => {
          await page.locator('.dq-top .dq-safe').click({ timeout: 1000 });
          await page.waitForFunction(() => window.__daily?.route.name === 'safe', null, { timeout: 1000 });
        });
        await shelfOf(h, page);
      }

      // the co-writer reads up to 4,000 characters before the words: long runs there answer every mode in under 50 ms
      const cases = [
        ['blank lines', 'Once.\n' + '\n'.repeat(4000) + 'She ', 'smiled'],
        ['lines of one space', 'Once.\n' + ' \n'.repeat(4000) + 'She ', 'smiled'],
        ['spaces', 'Once. ' + ' '.repeat(4000) + 'She ', 'smiled'],
        ['quote marks', 'Once. ' + '"'.repeat(4000) + ' She ', 'smiled'],
        ['stops', 'Once' + '?!'.repeat(2000) + ' she ', 'smiled' + '?!'.repeat(590) + 'x'],
      ];
      const asked = await Promise.race([
        page
          .evaluate(async (list) => {
            const { cowrite } = await import('/src/cowriter/local.ts');
            const out = [];
            for (const [what, before, selection] of list)
              for (const mode of ['polish', 'continue', 'whatif', 'questions']) {
                const t0 = performance.now();
                const res = await cowrite({ mode, title: 'Gap', before, selection, after: ' at the sea.', notes: '', steer: '', history: [] });
                out.push({ what, mode, ms: performance.now() - t0, kind: res.kind });
              }
            return out;
          }, cases)
          .catch(() => null),
        h.sleep(10000).then(() => null),
      ]);
      h.expect(asked, 'the co-writer froze the page for more than 10 s');
      fs.writeFileSync(path.join(h.out, 'spaces-cowriter-timing.json'), JSON.stringify(asked, null, 1));
      for (const a of asked) h.expect(a.ms < 50, `${a.mode} after 4,000 ${a.what}: ${Math.round(a.ms)} ms`);

      // in the real page: a story brought in with 4,000 blank lines, a word picked, Polish, then the Safe Zone on the first tap
      const was = await everything(page);
      await bringIn(page, write(h, 'blank-lines.txt', `Once.\n${'\n'.repeat(4000)}She smiled at the sea.\n`));
      await page.getByRole('button', { name: 'Add as a new story' }).click();
      await page.locator('.st-bring-said:not(:empty)').waitFor();
      const story = (await everything(page)).find((x) => !was.some((w) => w.id === x.id));
      const ch = await page.evaluate(async (id) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        return (await storyStore(window.__daily.store.key).list()).find((x) => x.id === id).chapters[0];
      }, story.id);
      await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: story.id, ch });
      const ta = page.locator('.st-write .st-ta');
      // the page is open once its words are in the editor; a word picked before that is not on the page
      await page.waitForFunction(() => document.querySelector('.st-write .st-ta')?.value.includes('smiled'));
      await ta.evaluate((el) => {
        const at = el.value.indexOf('smiled');
        el.focus();
        el.setSelectionRange(at, at + 'smiled'.length);
        el.dispatchEvent(new Event('select'));
      });
      if (!(await page.evaluate(() => matchMedia('(min-width: 1100px)').matches)) && !(await page.locator('.st-cw.is-open').count())) {
        await page.locator('.st-cwbtn').click();
        await page.locator('.st-cw.is-open').waitFor();
      }
      await page.locator('.st-cw .st-mode--polish').click();
      await quick('Polish after 4,000 blank lines', 2000, async () => {
        await page.locator('.st-cw .st-ask').click();
        await page.locator('.st-cards > .st-batch:first-child .st-card').first().waitFor({ timeout: 2000 });
      });
      const card = await page.locator('.st-cards > .st-batch:first-child .st-card-t').first().textContent();
      h.expect(card === 'smiled', `Polish came back as ${JSON.stringify(card)}`);
      await quick('the Safe Zone after Polish', 1000, async () => {
        await page.locator('.dq-top .dq-safe').click({ timeout: 1000 });
        await page.waitForFunction(() => window.__daily?.route.name === 'safe', null, { timeout: 1000 });
      });
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** a story this device can't save says so plainly, stays off the shelf, keeps the file's story in the panel, and Add tries again */
  async 'story-bring-in-not-saved'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await shelfOf(h, page);
      const shown = await bringIn(page, write(h, 'the-harbour.md', '# The Harbour\n\n## Snow\n\nSnow fell on the harbour.\n\n## Thaw\n\nThe ice let go of the boats.\n'));
      // every write of a story fails, the way a full or blocked store fails it
      await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        window.__put = put;
        IDBObjectStore.prototype.put = function (...a) {
          if (this.name === 'stories') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          return put.apply(this, a);
        };
      });
      await page.getByRole('button', { name: 'Add as a new story' }).click();
      const fail = page.locator('.st-bring-box:not(.is-hidden) .st-bring-fail');
      await fail.waitFor({ timeout: 5000 });
      const now = await page.evaluate(() => ({
        head: document.querySelector('.st-bring-h')?.textContent,
        chapters: [...document.querySelectorAll('.st-bring-ch')].map((c) => [c.querySelector('.st-bring-ct').textContent, c.querySelector('.st-bring-cx')?.textContent ?? '']),
        said: document.querySelector('.st-bring-said').textContent,
        rows: [...document.querySelectorAll('.st-row')].map((r) => r.textContent),
        role: document.querySelector('.st-bring-fail').getAttribute('role'),
        text: document.querySelector('.st-bring-fail').textContent,
      }));
      await h.shot(page, 'not-saved');
      h.expect(now.role === 'alert' && /couldn’t save it/.test(now.text) && /isn’t on your shelf/.test(now.text), 'the failed write was not said plainly: ' + JSON.stringify(now.text));
      h.expect(now.head === shown.head && JSON.stringify(now.chapters) === JSON.stringify(shown.chapters), 'the panel lost the file’s story: ' + JSON.stringify(now));
      h.expect(!now.said && !now.rows.some((r) => r.includes('The Harbour')), 'the shelf shows the story as saved: ' + JSON.stringify(now));
      h.expect(!(await everything(page)).some((x) => x.title === 'The Harbour'), 'the store holds the story as if it were saved');
      h.expect(await page.getByRole('button', { name: 'Add as a new story' }).isVisible(), 'there is no way to try again');

      // once writes work again, Add saves it, and it is still there after a reload
      await page.evaluate(() => (IDBObjectStore.prototype.put = window.__put));
      await page.getByRole('button', { name: 'Add as a new story' }).click();
      await page.locator('.st-bring-said:not(:empty)').waitFor();
      h.expect((await page.locator('.st-bring-said').textContent()) === '“The Harbour” is on your shelf now.', 'the retry did not say it was added');
      h.expect(await page.locator('.st-bring-box').evaluate((b) => b.classList.contains('is-hidden')), 'the panel stayed open after the story was added');
      await page.reload();
      await page.waitForFunction(() => !!window.__daily);
      const back = (await everything(page)).filter((x) => x.title === 'The Harbour');
      h.expect(back.length === 1 && JSON.stringify(back[0].chapters.map((c) => c.title)) === '["Snow","Thaw"]' && /Snow fell/.test(back[0].chapters[0].text) && /ice let go/.test(back[0].chapters[1].text), 'after a reload the story is not on this device once: ' + JSON.stringify(back));
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** a story of more chapters than the preview lists at first: one tap shows every one before Add */
  async 'story-bring-in-every-chapter'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute');
    try {
      await h.reachHub(page);
      await shelfOf(h, page);
      // twelve chapters: the preview lists eight, and one tap shows the other four
      const parts = Array.from({ length: 12 }, (_, i) => `## Part ${i + 1}\n\nLine ${i + 1}.`).join('\n\n');
      const p = await bringIn(page, write(h, 'twelve.md', `# Twelve\n\n${parts}\n\n## Notes for this story\n\nKeep count.\n`));
      await h.shot(page, 'first-eight');
      h.expect(p.chapters.length === 9 && p.chapters[8][0] === 'Notes', `twelve.md: the preview first lists ${JSON.stringify(p.chapters)}`);
      await page.getByRole('button', { name: 'Show 4 more chapters' }).click({ timeout: 5000 });
      const all = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('.st-bring-ch')].map((c) => `${c.querySelector('.st-bring-ct').textContent}:${c.querySelector('.st-bring-cx')?.textContent ?? ''}`),
        focus: document.activeElement?.querySelector?.('.st-bring-ct')?.textContent,
      }));
      await h.shot(page, 'every-chapter');
      const want = [...Array.from({ length: 12 }, (_, i) => `Part ${i + 1}:Line ${i + 1}.`), 'Notes:Keep count.'];
      h.expect(JSON.stringify(all.rows) === JSON.stringify(want), `twelve.md: the preview lists ${JSON.stringify(all.rows)}`);
      h.expect(all.focus === 'Part 9' && !(await page.getByRole('button', { name: /more chapter/ }).count()), `twelve.md: focus is on ${all.focus} or the button stayed`);
      await page.getByRole('button', { name: 'Not now' }).click();
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** blank lines at the edges of a page or Notes, and a page named like Notes, come back exactly */
  async 'story-bring-in-exact'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute');
    try {
      await h.reachHub(page);
      const bad = [];
      const stories = [
        { title: 'Edges', chapters: [{ title: 'Opening', text: '\n\n  \nAfter three blank lines.\n\n' }, { title: 'Spaces', text: '   ' }, { title: 'Last', text: '\nOne line down.\n' }], notes: '\n\nNotes after two blank lines.\n' },
        { title: 'Called Notes', chapters: [{ title: 'Before', text: 'A page.' }, { title: '\\Notes for this story', text: 'A slash in its name.' }, { title: 'Notes for this story', text: 'A page, not the notes.' }], notes: '' },
      ];
      for (const s of stories) {
        const ids = await page.evaluate(async (s) => {
          const { storyStore } = await import('/src/daily/storystore.ts');
          const ss = storyStore(window.__daily.store.key);
          const { story, first } = await ss.create(s.title);
          for (const [i, c] of s.chapters.entries()) {
            const ch = i ? await ss.addChapter(story.id) : first;
            await ss.saveChapter({ ...ch, title: c.title, text: c.text }, [ch.rev]);
          }
          const notes = await ss.chapter(story.notes);
          await ss.saveChapter({ ...notes, text: s.notes }, [notes.rev]);
          return { story: story.id, ch: first.id };
        }, s);
        // out through Download story, back in through the file chooser
        await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch });
        await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
        await page.getByRole('button', { name: 'More', exact: true }).click();
        const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download story' }).click()]);
        const file = path.join(h.out, `exact-${ids.story}.txt`);
        await dl.saveAs(file);
        const was = await everything(page);
        const held = was.find((x) => x.id === ids.story);
        h.expect(JSON.stringify({ title: held.title, chapters: held.chapters, notes: held.notes }) === JSON.stringify(s), `${s.title}: the store holds ${JSON.stringify(held)}`);
        await shelfOf(h, page);
        await bringIn(page, file);
        await page.getByRole('button', { name: 'Add as a new story' }).click();
        await page.locator('.st-bring-said:not(:empty)').waitFor();
        const added = (await everything(page)).find((x) => !was.some((w) => w.id === x.id));
        const got = { title: added?.title, chapters: added?.chapters, notes: added?.notes };
        if (JSON.stringify(got) !== JSON.stringify(s)) bad.push(`${s.title}: came back as ${JSON.stringify(got)}`);
      }
      h.expect(!bad.length, bad.join('\n'));
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** a file still reading or a save still writing changes nothing once the panel is closed or the shelf is left */
  async 'story-bring-in-overtaken'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute');
    try {
      await h.reachHub(page);
      await shelfOf(h, page);
      const bad = [];
      const file = write(h, 'slow.md', '# Slow\n\n## One\n\nA page.\n');
      // the file is still reading when the player leaves the shelf: Back afterwards goes straight back to the shelf
      await page.evaluate(() => {
        const read = Blob.prototype.arrayBuffer;
        window.__read = read;
        window.__gate = new Promise((r) => (window.__open = r));
        Blob.prototype.arrayBuffer = function () {
          return window.__gate.then(() => read.call(this));
        };
      });
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Bring in a story' }).first().click()]);
      await chooser.setFiles(file);
      await page.evaluate(() => window.__daily.go({ name: 'settings' }));
      await routeIs(page, 'settings');
      await page.evaluate(() => {
        Blob.prototype.arrayBuffer = window.__read;
        window.__open();
      });
      await h.sleep(500);
      await page.goBack();
      await routeIs(page, 'stories').catch(() => {});
      const back = await page.evaluate(() => window.__daily.route.name);
      if (back !== 'stories') bad.push(`after the file finished reading on another screen, Back went to ${back}`);

      // Not now while Add is still writing: a write that then fails does not open the panel again
      await shelfOf(h, page);
      await bringIn(page, file);
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        window.__gate = new Promise((r) => (window.__open = r));
        storyStore(window.__daily.store.key).createFrom = async () => (await window.__gate, null);
      });
      await page.getByRole('button', { name: 'Add as a new story' }).click();
      await page.getByRole('button', { name: 'Not now' }).click();
      await page.evaluate(() => window.__open());
      await h.sleep(500);
      if (!(await page.locator('.st-bring-box').evaluate((b) => b.classList.contains('is-hidden')))) bad.push('the panel opened again after Not now');
      h.expect(!bad.length, bad.join('\n'));
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** an empty shelf whose stories are slow to arrive shows its buttons once, where they stay, so a tap as they land counts */
  async 'story-bring-in-holds-still'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute');
    try {
      await h.reachHub(page);
      // the stories arrive only when let in, as on a slow phone
      await page.evaluate(async () => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        const list = ss.list;
        window.__gate = new Promise((r) => (window.__open = r));
        ss.list = async function () {
          await window.__gate;
          return list.call(this);
        };
      });
      await page.evaluate(() => window.__daily.go({ name: 'stories' }));
      await page.evaluate(() => Promise.all(document.querySelector('.st-shelfpage').getAnimations().map((a) => a.finished)));
      await page.evaluate(() => {
        window.__shown = [...document.querySelectorAll('.st-shelfpage button')].filter((b) => b.checkVisibility()).map((b) => ({ b, r: JSON.stringify(b.getBoundingClientRect()) }));
        window.__open();
      });
      await page.locator('.st-empty').waitFor();
      const moved = await page.evaluate(() => window.__shown.filter(({ b, r }) => !b.checkVisibility() || JSON.stringify(b.getBoundingClientRect()) !== r).map(({ b }) => b.textContent.trim()));
      h.expect(!moved.length, `shown before the stories arrived, then gone or moved: ${moved.join(', ')}`);
      await bringIn(page, write(h, 'still.md', '# Still\n\n## One\n\nA page.\n'));
      h.expect(!errors.length, errors.join('\n'));
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
