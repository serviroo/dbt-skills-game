// A Night Watch card keeps its share of the row. On a returning save with every skill met (an odd number of cards) and
// no ally drawn yet (Design an ally alone in its row), at 320x568, 390x844 and 1000x800, each at its own size and at
// 200% zoom (the page laid out at half the size, as browser zoom does), every card in both of the screen's collections
// is its share of the row (half, a quarter on a wide screen, all of it on a phone zoomed to 200%), or the whole row when
// its longest word can't fit that share; and a card alone in its row for any other reason (the last, or the one before
// a wide card) is as tall as it is at its share. A failure names each card and its size.
import { fullSave } from './me-91-final-save-ids.e2e.mjs';
import { settle } from './layout-fit.e2e.mjs';

const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1000, height: 800 },
];

/**
 * Every card that is neither its share of the row nor, when its longest word can't fit that share, the whole of it, and
 * every card alone in its row that isn't as tall as at its share. How narrow a card can be with every word whole, and
 * how tall it is at its share, are read from a copy of it laid out on its own.
 */
const offShare = (page) =>
  page.evaluate(() => {
    const bad = [];
    const cols = innerWidth <= 260 ? 1 : innerWidth >= 900 ? 4 : 2;
    for (const list of document.querySelectorAll('.dq-collection')) {
      const share = (list.clientWidth - parseFloat(getComputedStyle(list).columnGap) * (cols - 1)) / cols;
      const cards = [...list.querySelectorAll('.dq-cardbtn')];
      const copy = (card, width) => {
        const c = card.cloneNode(true);
        c.style.cssText = `position: absolute; visibility: hidden; width: ${width}`;
        list.append(c);
        const r = c.getBoundingClientRect();
        c.remove();
        return r;
      };
      for (const card of cards) {
        const r = card.getBoundingClientRect();
        const name = card.getAttribute('aria-label')?.split(',')[0] || card.innerText.split('\n')[0];
        const wide = copy(card, 'min-content').width > share + 0.5;
        const want = wide ? list.clientWidth : share;
        if (Math.abs(r.width - want) > 1) {
          bad.push(`"${name}" is ${Math.round(r.width)}x${Math.round(r.height)} px, not ${wide ? 'the whole row' : 'its share'} (${Math.round(want)} px wide)`);
          continue;
        }
        const alone = !cards.some((o) => o !== card && Math.abs(o.getBoundingClientRect().top - r.top) < 1);
        const tall = alone && !wide && copy(card, `${share}px`).height;
        if (tall && Math.abs(r.height - tall) > 1) bad.push(`"${name}", alone in its row, is ${Math.round(r.height)} px tall, not ${Math.round(tall)} px as at its share`);
      }
    }
    return bad;
  });

export const scenarios = {
  'night-watch-cards': async (h) => {
    const failed = [];
    for (const phone of SIZES) {
      const save = fullSave(Date.now());
      const you = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: save.created, companionAt: save.created });
      const { ctx, page, errors } = await h.open({ [h.SAVE]: JSON.stringify(save), [h.YOU]: you, 'dbt.app.v1': h.SEEN }, '?mute', phone);
      try {
        await h.reachHub(page);
        for (const zoom of [1, 2]) {
          const size = `${phone.width}x${phone.height} at ${zoom * 100}%`;
          await page.setViewportSize({ width: phone.width / zoom, height: phone.height / zoom });
          await page.evaluate(() => window.__daily.go({ name: 'shadows' }));
          await page.waitForFunction(() => window.__daily.route.name === 'shadows', null, { timeout: 10000 });
          await settle(page);
          failed.push(...(await offShare(page)).map((b) => `${size}: ${b}`));
          const shot = `night-watch-cards-${phone.width}x${phone.height}-${zoom * 100}`;
          for (const [part, sel] of [['ally', '.dq-allyslot'], ['last', '.dq-collection:not(.dq-allies) .dq-cardbtn:last-of-type']]) {
            await page.locator(sel).last().evaluate((e) => e.scrollIntoView({ block: 'center' }));
            await h.shot(page, `${shot}-${part}`);
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
