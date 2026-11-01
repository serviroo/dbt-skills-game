// Names the player gave, as a screen reader says them and as they copy. A story whose title and first chapter's name are
// each one unbroken word of 80 letters, its second chapter "Remembering Everything Underneath", stories "WWWWWWXWWWWWW"
// and "Somewhere to Rest for a While", and a removed story with the long title too, on a 320x568 phone and the same
// phone at 200% zoom. On Home, the story list with its removed stories open, a title found by the X in the middle of
// its word, the writing page's chapter bar and the chapter list: no name, description or value in the browser's own
// accessibility tree has a soft hyphen in it; a button holding a name is named with it whole, each name copies as typed
// and finding it in the page finds it; and each name still breaks a word onto the next line only where a hyphen shows,
// with none showing mid-line.
import { boot, settle } from './layout-fit.e2e.mjs';

const PHONE = { width: 320, height: 568 };
const LONG = 'Lanternlight'.repeat(7).slice(0, 80);
const CHAPTER = 'Remembering Everything Underneath';
const FOUND = 'WWWWWWXWWWWWW';
// where the player's names show, each set by breakable()
const NAMES = '.dq-tile-story, .st-row-t, .st-removed-t, .st-chbtn-t, .st-chrow-t';

/** What the browser's accessibility tree gives a screen reader with a soft hyphen in it: a name, description or value. */
async function spokenShy(cdp) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const out = new Set();
  for (const n of nodes.filter((n) => !n.ignored)) {
    for (const k of ['name', 'description', 'value']) {
      const v = String(n[k]?.value ?? '');
      if (v.includes('\u00AD')) out.add(`${n.role?.value ?? 'a node'} ${k} "${v.replace(/\u00AD/g, '|')}" has a soft hyphen in it`);
    }
  }
  return [...out];
}

/** The names under `scope` that break a word onto the next line with no hyphen showing there, or show one mid-line. */
const hyphens = (page, scope) =>
  page.evaluate((scope) => {
    const out = [];
    const rect = (t, i) => {
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + 1);
      return r.getClientRects()[0];
    };
    for (const e of document.querySelectorAll(scope)) {
      if (!e.checkVisibility({ checkVisibilityCSS: true })) continue;
      // the word's last letter so far, and since it a typed hyphen or breakable()'s marks
      let last = null;
      let typed = false;
      let marks = [];
      const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.localName === 'dq-shy') marks.push(n);
        if (n.nodeType !== Node.TEXT_NODE) continue;
        for (let i = 0; i < n.length; i++) {
          if (/\s/.test(n.data[i])) last = null;
          if (n.data[i] === '-') typed = true;
          const q = /[\s-]/.test(n.data[i]) ? null : rect(n, i);
          if (!q?.height) continue;
          const wrapped = last && q.top > last.top + q.height / 2;
          const drawn = marks.some((m) => m.getBoundingClientRect().width > 0);
          const where = `"${e.textContent.slice(0, 24)}" before "${n.data.slice(i, i + 6)}"`;
          if (wrapped && !drawn && !typed) out.push(`${where}: a word breaks with no hyphen`);
          if (!wrapped && drawn) out.push(`${where}: a hyphen shows mid-line`);
          [last, typed, marks] = [q, false, []];
        }
      }
    }
    return [...new Set(out)];
  }, scope);

/**
 * How the name `name` in `selector` (the first match) goes: the button holding it, if one does, is named with it whole in
 * the browser's accessibility tree, copying it gives it as typed and finding it in the page finds it. The app keeps its
 * names from being selected, so this one is made selectable for the copy: the text itself copies.
 */
async function asTyped(page, cdp, selector, name) {
  const out = [];
  const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)}).closest('button')` });
  if (result.objectId) {
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    const said = String(nodes[0].name?.value ?? '');
    if (!said.includes(name)) out.push(`the button with ${selector} is named "${said.replace(/\u00AD/g, '|')}"`);
  }
  await page.evaluate((s) => {
    const e = document.querySelector(s);
    e.style.userSelect = 'text';
    const r = document.createRange();
    r.selectNodeContents(e);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  }, selector);
  await page.keyboard.press('ControlOrMeta+C');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  if (text !== name) out.push(`copying ${selector} gives "${text.replace(/\u00AD/g, '|')}"`);
  const found = await page.evaluate((n) => (getSelection().removeAllRanges(), window.find(n, true)), name);
  if (!found) out.push(`finding "${name.slice(0, 24)}" in the page finds nothing`);
  await page.evaluate((s) => (getSelection().removeAllRanges(), (document.querySelector(s).style.userSelect = '')), selector);
  return out;
}

function spoken(zoom) {
  return async (h) => {
    const at = `320x568${zoom > 1 ? ` at ${zoom * 100}%` : ''}`;
    const problems = [];
    const { ctx, page, errors } = await boot(h, { width: PHONE.width / zoom, height: PHONE.height / zoom }, { prepare: (c) => c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: h.server.url }) });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const check = async (where, names) => {
      await settle(page);
      const found = [...(await spokenShy(cdp)), ...(await hyphens(page, NAMES))];
      for (const [selector, name] of names) found.push(...(await asTyped(page, cdp, selector, name)));
      problems.push(...found.map((f) => `${at}, ${where}: ${f}`));
    };

    const ids = await page.evaluate(
      async ({ long, chapter, found }) => {
        const { storyStore } = await import('/src/daily/storystore.ts');
        const ss = storyStore(window.__daily.store.key);
        await ss.create('Somewhere to Rest for a While');
        await ss.create(found);
        await ss.remove((await ss.create(long)).story.id);
        const { story, first } = await ss.create(long);
        await ss.saveChapter({ ...first, title: long }, [first.rev]);
        const second = await ss.addChapter(story.id);
        await ss.saveChapter({ ...second, title: chapter }, [second.rev]);
        return { story: story.id, ch: first.id };
      },
      { long: LONG, chapter: CHAPTER, found: FOUND },
    );

    await page.evaluate(() => window.__daily.go({ name: 'stories' }));
    await page.locator('.st-row').first().waitFor({ timeout: 10000 });
    await page.locator('.st-removed-tg[aria-expanded="false"]').click();
    await page.locator('.st-removed-row').first().waitFor();
    await check('the story list', [
      ['.st-row .st-row-t', LONG],
      ['.st-removed-t', LONG],
    ]);
    await h.shot(page, `story-names-spoken-${zoom * 100}-list`);

    await page.getByRole('searchbox', { name: 'Search your stories and notes' }).fill('X');
    await page.locator('.st-found-head .st-mark').first().waitFor({ timeout: 10000 });
    await check('a title found', [['.st-found-head .st-row-t', FOUND]]);
    await h.shot(page, `story-names-spoken-${zoom * 100}-found`);

    await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch });
    await page.locator('.st-chbtn').waitFor({ timeout: 10000 });
    await check('the chapter bar', [['.st-chbtn-t', LONG]]);
    await h.shot(page, `story-names-spoken-${zoom * 100}-bar`);

    // by key: at 200% zoom the writing page's dock lies over its chapter bar, a layout matter of its own
    await page.locator('.st-chbtn').press('Enter');
    await page.locator('.st-chsheet .st-chrow-t').nth(1).waitFor({ timeout: 10000 });
    await check('the chapter list', [
      ['.st-chsheet .st-chrow-t', LONG],
      ['.st-chsheet .st-chrow:nth-child(2) .st-chrow-t', CHAPTER],
    ]);
    await h.shot(page, `story-names-spoken-${zoom * 100}-chapters`);
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__daily.go({ name: 'hub' }));
    await page.locator('.dq-tile-story.is-title').waitFor({ timeout: 10000 });
    await check('Home', [['.dq-tile-story', LONG]]);

    if (errors.length) problems.push(`${at}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

export const scenarios = {
  'story-names-spoken-320x568': spoken(1),
  'story-names-spoken-320x568-zoom-200': spoken(2),
};
