// The harness's until() waits for a check in the page that awaits something, and gives up at its deadline even when the
// check never answers, or turns true only after it while a long wait between checks runs. Its leaves() waits for
// something to leave the page on the page's running time: a page frozen past the deadline that lets it go once it runs
// again passes, and one that never lets it go fails at its deadline.

export const scenarios = {
  async 'until-hung-check-fails'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      const hung = await Promise.race([h.until(page, () => new Promise(() => {}), null, { timeout: 500 }).then(() => 'answered', (e) => e.message), h.sleep(3000).then(() => 'still waiting after 3 s')]);
      h.expect(/^waited 500 ms for /.test(hung), `a check that never answers did not fail at its deadline: ${hung}`);
      const late = await h.until(page, () => new Promise((r) => setTimeout(() => r(true), 300)), null, { timeout: 2000 }).then(() => 'answered', (e) => e.message);
      h.expect(late === 'answered', `a check that answered before its deadline failed: ${late}`);
    } finally { await ctx.close(); }
  },

  async 'until-fails-at-its-deadline'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      // the deadline comes from the page's own clock, which can differ from this one when the browser is remote (--ws)
      const at = await page.evaluate(() => Date.now() + 600);
      const t0 = Date.now();
      const after = await h.until(page, (t) => Date.now() > t, at, { timeout: 300, polling: 2000 }).then(() => 'answered', (e) => e.message);
      const took = Date.now() - t0;
      h.expect(/^waited 300 ms for /.test(after) && took < 1000, `a check true only after its deadline gave "${after}" after ${took} ms`);
    } finally { await ctx.close(); }
  },

  async 'leaves-waits-out-a-freeze'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div id="x">x</div>');
      const gone = h.leaves(page, '#x');
      // the page can't run for 3 s, then lets it go at once: as a browser a busy machine stops for a while
      await page.evaluate(() => void setTimeout(() => {
        const end = performance.now() + 3000;
        while (performance.now() < end);
        document.getElementById('x').remove();
      }));
      const after = await gone(1500).then(() => 'left', (e) => e.message);
      h.expect(after === 'left', `a page frozen past the deadline, which let it go as soon as it ran again, failed: ${after}`);
    } finally { await ctx.close(); }
  },

  async 'leaves-fails-at-its-deadline'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div id="x">x</div>');
      const gone = h.leaves(page, '#x');
      const t0 = Date.now();
      const after = await gone(500).then(() => 'left', (e) => e.message);
      const took = Date.now() - t0;
      h.expect(after === '#x was still in the page after 0.5 s of the page running' && took < 2000, `something that never left gave "${after}" after ${took} ms`);
    } finally { await ctx.close(); }
  },
};
