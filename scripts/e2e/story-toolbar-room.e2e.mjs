// The bars at the bottom of the Story Room and the Art room take their own room on a phone held sideways (568x320,
// 667x375, 844x390), at the regular and the largest reading size: on arrival the writing page's first line (Page and
// Notes) sits between the top bar and the writing bar, and every control above it stays whole and tappable; nothing
// pinned covers the story list's first story or the read view's first line; the drawing page's tools are whole on
// screen, every one of them tappable, and never over the page.

const SIZES = [
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
];
const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'toolbar-room-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});
const para = (w) => Array.from({ length: 6 }, (_, i) => `${w} ${i + 1}. The path went on past the mill and the bridge, and the lantern swung on its hook the whole way down to the sea.`).join('\n\n');

/** a story of two chapters with notes, made through the app's own store */
const story = (page) =>
  page.evaluate(async (texts) => {
    const { storyStore } = await import('/src/daily/storystore.ts');
    const ss = storyStore(window.__daily.store.key);
    const { story, first } = await ss.create('The Long Night');
    await ss.saveChapter({ ...first, text: texts[0] }, [first.rev]);
    const second = await ss.addChapter(story.id);
    await ss.saveChapter({ ...second, text: texts[1] }, [second.rev]);
    return { story: story.id, ch: first.id };
  }, [para('Snow'), para('Rain')]);

/**
 * Where the top bar ends, where the writing bar starts and where the page's first line ends, and the controls above
 * the page that are not whole on screen or are covered where a tap lands.
 */
const writePlace = (page) =>
  page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const ta = document.querySelector('.st-ta');
    const cs = getComputedStyle(ta);
    const top = ta.getBoundingClientRect().top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
    const bar = r('.dq-top').bottom;
    const dock = r('.st-dock');
    const name = (e) => (e.getAttribute('aria-label') || e.textContent).trim().replace(/\s+/g, ' ').slice(0, 28);
    const hidden = [...document.querySelectorAll('.st-main button, .st-main input.st-title')]
      .filter((e) => e.getClientRects().length && !e.closest('.is-hidden, .st-dock, .st-menu, .st-start-box'))
      .filter((e) => {
        const b = e.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return b.top < bar - 0.5 || b.bottom > dock.top + 0.5 || !e.contains(hit);
      })
      .map(name);
    return { bar, dock: dock.top, dockWhole: dock.bottom <= innerHeight + 0.5, top, line: top + parseFloat(cs.lineHeight), hidden };
  });

/** what covers the first line of the first element matching `sel` where it shows on screen, if anything does */
const covered = (page, sel) =>
  page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return `nothing matches ${sel}`;
    const b = e.getBoundingClientRect();
    const y = b.top + Math.min(b.height / 2, 12);
    // below the bottom of the screen it is only further down the page, not under anything
    if (y > innerHeight) return null;
    const hit = document.elementFromPoint(b.left + Math.min(b.width / 2, 40), y);
    return e.contains(hit) ? null : `${sel} is covered by ${hit?.className || hit?.tagName}`;
  }, sel);

export const scenarios = {
  async 'story-toolbar-room'(h) {
    const failed = [];
    for (const vp of SIZES) {
      for (const size of ['regular', 'largest']) {
        const at = `${vp.width}x${vp.height} ${size}`;
        const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
        try {
          await h.reachHub(page);
          await page.evaluate((v) => localStorage.setItem(`${window.__daily.store.key}.read-size`, v), size);
          const ids = await story(page);

          await page.evaluate(() => window.__daily.go({ name: 'stories' }));
          await page.locator('.st-row').first().waitFor({ timeout: 10000 });
          await h.settled(page, '.dq-view');
          const row = await covered(page, '.st-row');
          if (row) failed.push(`${at} story list: ${row}`);
          await h.shot(page, `toolbar-stories-${at.replace(' ', '-')}`);

          await page.evaluate((r) => window.__daily.go(r), { name: 'write', id: ids.story, ch: ids.ch });
          await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
          for (const tab of ['Page', 'Notes']) {
            if (tab === 'Notes') {
              await page.locator('.st-seg').getByRole('radio', { name: 'Show: Notes' }).click();
              await page.getByRole('textbox', { name: 'Notes for this story' }).waitFor();
            }
            await h.settled(page, '.st-main, .st-dock');
            const p = await writePlace(page);
            if (p.line > p.dock + 0.5) failed.push(`${at} ${tab}: the first line ends at ${p.line.toFixed(1)}, under the writing bar at ${p.dock.toFixed(1)}`);
            if (p.top < p.bar - 0.5) failed.push(`${at} ${tab}: the first line starts at ${p.top.toFixed(1)}, under the top bar at ${p.bar.toFixed(1)}`);
            if (!p.dockWhole) failed.push(`${at} ${tab}: the writing bar runs off the bottom of the screen`);
            if (p.hidden.length) failed.push(`${at} ${tab}: not whole and tappable between the bars: ${p.hidden.join(', ')}`);
            await h.shot(page, `toolbar-write-${tab.toLowerCase()}-${at.replace(' ', '-')}`);
          }

          await page.evaluate((r) => window.__daily.go(r), { name: 'read', id: ids.story, ch: ids.ch });
          await page.locator('.st-read-text').first().waitFor({ timeout: 10000 });
          await h.settled(page, '.st-read');
          const read = await covered(page, '.st-read-text');
          if (read) failed.push(`${at} read: ${read}`);
          await h.shot(page, `toolbar-read-${at.replace(' ', '-')}`);

          await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'today' }));
          await page.locator('.dq-tools').waitFor({ timeout: 10000 });
          await h.settled(page, '.dq-draw');
          const tools = await page.evaluate(() => {
            const tb = document.querySelector('.dq-tools').getBoundingClientRect();
            const fr = document.querySelector('.dq-draw-frame').getBoundingClientRect();
            const bar = document.querySelector('.dq-top').getBoundingClientRect().bottom;
            const name = (e) => (e.getAttribute('aria-label') || e.textContent).trim().replace(/\s+/g, ' ').slice(0, 20);
            const covered = [...document.querySelectorAll('.dq-tools button')]
              .filter((e) => e.getClientRects().length && !e.closest('.is-hidden'))
              .filter((e) => {
                const b = e.getBoundingClientRect();
                const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
                return b.top < bar - 0.5 || b.bottom > innerHeight + 0.5 || b.left < -0.5 || b.right > innerWidth + 0.5 || !e.contains(hit);
              })
              .map(name);
            const over = tb.left < fr.right - 0.5 && tb.right > fr.left + 0.5 && tb.top < fr.bottom - 0.5 && tb.bottom > fr.top + 0.5;
            const page = fr.top >= bar - 0.5 && fr.bottom <= innerHeight + 0.5;
            return { covered, over, page };
          });
          if (tools.covered.length) failed.push(`${at} drawing: tools not whole and tappable: ${tools.covered.join(', ')}`);
          if (tools.over) failed.push(`${at} drawing: the tools sit over the page`);
          if (!tools.page) failed.push(`${at} drawing: the page is not whole on screen`);
          await h.shot(page, `toolbar-draw-${at.replace(' ', '-')}`);
          if (errors.length) failed.push(`${at}: ${errors.join(' | ')}`);
        } finally {
          await ctx.close();
        }
      }
    }
    h.expect(!failed.length, failed.join('\n'));
  },
};
