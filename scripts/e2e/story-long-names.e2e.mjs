// Long names in the Story Room: a story whose title and first chapter's name are each one unbroken word of 80 letters,
// and a removed story with that title too, on a 390x844 and a 320x568 phone, at normal text and with the phone's own
// text at 200%. The story list with its removed stories open, the writing page's chapter bar and the chapter list keep
// every name whole inside the screen, broken where it must: nothing reaches past either side, scrolls sideways or is
// cut short.
import { boot, settle } from './layout-fit.e2e.mjs';
import { scaleText } from './safe-zone-reach.e2e.mjs';

const PHONES = { '390x844': { width: 390, height: 844 }, '320x568': { width: 320, height: 568 } };
const LONG = 'Lanternlight'.repeat(7).slice(0, 80);

/** What under `scope` reaches past the screen or is cut short, and whether the page scrolls sideways. */
const unfit = (page, scope) =>
  page.evaluate((scope) => {
    const out = [];
    for (const s of [document.scrollingElement, document.querySelector('.dq')]) if (s.scrollWidth > s.clientWidth + 1) out.push(`the page scrolls sideways (${s.scrollWidth} px wide in ${s.clientWidth})`);
    for (const e of document.querySelectorAll(scope)) {
      const cs = getComputedStyle(e);
      if (e.closest('.dq-sr') || cs.clipPath === 'inset(50%)' || !e.checkVisibility({ checkVisibilityCSS: true })) continue;
      const name = `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${e.textContent.trim().slice(0, 24)}"`;
      const r = e.getBoundingClientRect();
      if (r.left < -0.5 || r.right > innerWidth + 0.5) out.push(`${name} reaches past the screen (${Math.round(r.left)} to ${Math.round(r.right)} of ${innerWidth})`);
      const text = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (text && (/hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1) out.push(`${name} is cut short (${e.clientWidth} of ${e.scrollWidth} px)`);
    }
    return out;
  }, scope);

function names(phone, { font = false } = {}) {
  return async (h) => {
    const p = PHONES[phone];
    const at = `${phone}${font ? ' with its text at 200%' : ''}`;
    const problems = [];
    const { ctx, page, errors } = await boot(h, p, { device: { isMobile: true, hasTouch: true } });
    if (font) await scaleText(page);
    const ids = await page.evaluate(async (long) => {
      const { storyStore } = await import('/src/daily/storystore.ts');
      const ss = storyStore(window.__daily.store.key);
      const { story, first } = await ss.create(long);
      await ss.saveChapter({ ...first, title: long }, [first.rev]);
      await ss.remove((await ss.create(long)).story.id);
      return { story: story.id, ch: first.id };
    }, LONG);

    await page.evaluate(() => window.__daily.go({ name: 'stories' }));
    await page.locator('.st-row').first().waitFor({ timeout: 10000 });
    await page.locator('.st-removed-tg[aria-expanded="false"]').click();
    await page.locator('.st-removed-row').first().waitFor();
    await settle(page);
    for (const f of await unfit(page, '.st-row, .st-row *, .st-removed-row, .st-removed-row *')) problems.push(`${at}, the story list: ${f}`);
    await h.shot(page, `story-long-names-${phone}${font ? '-text-200' : ''}-list`);

    await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch });
    await page.locator('.st-chbtn').waitFor({ timeout: 10000 });
    await settle(page);
    for (const f of await unfit(page, '.st-bar, .st-bar *')) problems.push(`${at}, the chapter bar: ${f}`);
    await h.shot(page, `story-long-names-${phone}${font ? '-text-200' : ''}-bar`);

    await page.locator('.st-chbtn').click();
    await page.locator('.st-chsheet .st-chrow-t').first().waitFor({ timeout: 10000 });
    await settle(page);
    for (const f of await unfit(page, '.st-chsheet, .st-chsheet *')) problems.push(`${at}, the chapter list: ${f}`);
    await h.shot(page, `story-long-names-${phone}${font ? '-text-200' : ''}-chapters`);

    if (errors.length) problems.push(`${at}: ${errors.join(' | ')}`);
    await ctx.close();
    h.expect(!problems.length, `${problems.length} problems:\n${problems.join('\n')}`);
  };
}

export const scenarios = Object.fromEntries(Object.keys(PHONES).flatMap((phone) => [false, true].map((font) => [`story-long-names-${phone}${font ? '-text-200' : ''}`, names(phone, { font })])));
