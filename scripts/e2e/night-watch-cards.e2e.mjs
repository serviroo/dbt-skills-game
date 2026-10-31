// A Night Watch card keeps its share of the row. On a returning save with every skill met (an odd number of cards) and
// no ally drawn yet (Design an ally alone in its row), at 320x568, 390x844 and 1000x800, each at its own size and at
// 200% zoom (the page laid out at half the size, as browser zoom does), every card in both of the screen's collections
// is its share of the row (half, a quarter on a wide screen, all of it on a phone zoomed to 200%), or, when its longest
// word can't fit that share, the whole row (four a row, as wide as its words need); a card alone in its row for any other
// reason (the last, or the one before a wide card) is as tall as it is at its share; each row's cards sit side by side
// from its start, a gap apart, so a short last row keeps to the columns; and no card breaks a word across lines while it
// is short of the whole row. Then an ally is drawn and named with one 24-letter word, as long as a name
// can be, and the same holds for its card at every size. A failure names each card and its size.
import { fullSave } from './me-91-final-save-ids.e2e.mjs';
import { settle } from './layout-fit.e2e.mjs';

const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1000, height: 800 },
];
const LONG_NAME = 'Lanternkeeperofthenights';

/**
 * Every card that is neither its share of the row nor, when its longest word can't fit that share, the whole of it (as
 * wide as its words need, four a row); every card alone in its row that isn't as tall as at its share; every card that
 * doesn't start a gap after the one before it in its row (or at the row's start); and every word broken across lines in
 * a card short of the whole row. How narrow a card can be with every word whole, and how tall it
 * is at its share, are read from a copy of it laid out on its own beside it.
 */
const offShare = (page) =>
  page.evaluate(() => {
    const bad = [];
    const cols = innerWidth <= 260 ? 1 : innerWidth >= 900 ? 4 : 2;
    for (const list of document.querySelectorAll('.dq-collection')) {
      const gap = parseFloat(getComputedStyle(list).columnGap);
      const share = (list.clientWidth - gap * (cols - 1)) / cols;
      const cards = [...list.querySelectorAll('.dq-cardbtn')];
      const start = list.getBoundingClientRect().left + list.clientLeft;
      const copy = (card, width) => {
        const c = card.cloneNode(true);
        c.style.cssText = `position: absolute; visibility: hidden; width: ${width}`;
        card.parentElement.append(c);
        const r = c.getBoundingClientRect();
        c.remove();
        return r;
      };
      for (const card of cards) {
        const r = card.getBoundingClientRect();
        const name = card.getAttribute('aria-label')?.split(',')[0] || card.innerText.split('\n')[0];
        const fit = copy(card, 'min-content').width;
        const wide = fit > share + 0.5;
        const want = !wide ? share : cols === 4 ? fit : list.clientWidth;
        if (Math.abs(r.width - want) > 1) {
          bad.push(`"${name}" is ${Math.round(r.width)}x${Math.round(r.height)} px, not ${!wide ? 'its share' : cols === 4 ? 'as wide as its words need' : 'the whole row'} (${Math.round(want)} px wide)`);
          continue;
        }
        const row = cards.filter((o) => Math.abs(o.getBoundingClientRect().top - r.top) < 1);
        const before = row.map((o) => o.getBoundingClientRect().right).filter((x) => x < r.left + 1);
        const from = before.length ? Math.max(...before) + gap : start;
        if (Math.abs(r.left - from) > 1) bad.push(`"${name}" starts ${Math.round(r.left - from)} px past ${before.length ? 'a gap after the card before it' : 'the start of its row'}`);
        const alone = row.length === 1;
        const tall = alone && !wide && copy(card, `${share}px`).height;
        if (tall && Math.abs(r.height - tall) > 1) bad.push(`"${name}", alone in its row, is ${Math.round(r.height)} px tall, not ${Math.round(tall)} px as at its share`);
        if (r.width > list.clientWidth - 1) continue;
        const walk = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode()); ) {
          if (!n.parentElement.checkVisibility({ visibilityProperty: true })) continue;
          // a word, or the part of one up to a hyphen, where a line may end
          for (const w of n.data.matchAll(/[^\s-]+-?/g)) {
            const range = document.createRange();
            range.setStart(n, w.index);
            range.setEnd(n, w.index + w[0].length);
            const lines = new Set([...range.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
            if (lines.size > 1) bad.push(`"${name}" breaks "${w[0]}" across ${lines.size} lines in a ${Math.round(r.width)} px card, short of the ${Math.round(list.clientWidth)} px row`);
          }
        }
      }
    }
    return bad;
  });

/** Draws a line on the shadow ally page and saves it as an ally called `name`, through the name sheet. */
async function drawAlly(page, name) {
  await page.evaluate(() => window.__daily.go({ name: 'draw', kind: 'ally' }));
  await page.waitForFunction(() => document.querySelector('.dq-ink-stage')?.inert === false, null, { timeout: 10000 });
  await settle(page);
  const f = await page.locator('.dq-draw-frame').boundingBox();
  await page.mouse.move(f.x + f.width * 0.3, f.y + f.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width * 0.7, f.y + f.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await page.locator('.dq-save').click();
  await page.locator('.dq-sheet:not(.is-hidden) input').fill(name);
  await page.keyboard.press('Enter');
  await page.locator('.dq-rise:not(.is-hidden)').waitFor({ timeout: 10000 });
}

export const scenarios = {
  'night-watch-cards': async (h) => {
    const failed = [];
    for (const phone of SIZES) {
      const save = fullSave(Date.now());
      const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: save.created, companionAt: save.created });
      const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(save), [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', phone);
      try {
        await h.reachHub(page);
        for (const ally of [null, LONG_NAME]) {
          if (ally) {
            await page.setViewportSize(phone);
            await drawAlly(page, ally);
          }
          for (const zoom of [1, 2]) {
            const size = `${phone.width}x${phone.height} at ${zoom * 100}%${ally ? ` with an ally called ${ally}` : ''}`;
            await page.setViewportSize({ width: phone.width / zoom, height: phone.height / zoom });
            await page.evaluate(() => window.__daily.go({ name: 'shadows' }));
            await page.waitForFunction(() => window.__daily.route.name === 'shadows', null, { timeout: 10000 });
            if (ally) await page.locator('.dq-allybtn').waitFor({ timeout: 10000 });
            await settle(page);
            failed.push(...(await offShare(page)).map((b) => `${size}: ${b}`));
            const shot = `night-watch-cards-${phone.width}x${phone.height}-${zoom * 100}${ally ? '-named' : ''}`;
            for (const [part, sel] of [['ally', ally ? '.dq-allybtn' : '.dq-allyslot'], ['last', '.dq-collection:not(.dq-allies) .dq-cardbtn:last-of-type']]) {
              await page.locator(sel).last().evaluate((e) => e.scrollIntoView({ block: 'center' }));
              await h.shot(page, `${shot}-${part}`);
            }
          }
        }
        if (errors.length) failed.push(`${phone.width}x${phone.height}: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!failed.length, failed.join('\n'));
  },
};
