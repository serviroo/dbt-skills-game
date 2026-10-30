// The harness's until() waits for a check in the page that awaits something, and gives up at its deadline even when the
// check never answers, or turns true only after it while a long wait between checks runs. Its leaves() and gone() wait
// for something to leave the page on the page's running time: a page frozen mid-wait past the deadline that lets it go
// soon after passes, and one that never lets it go fails at its deadline.

/**
 * A moment into a wait the page can't run for 3 s, as a browser a busy machine stops for a while, and lets `sel` go a
 * little after: counted in full, the freeze alone would be past a 2 s deadline.
 */
const freezeThenLet = (page, sel) =>
  page.evaluate(
    (sel) =>
      void setTimeout(() => {
        const end = performance.now() + 3000;
        while (performance.now() < end);
        setTimeout(() => document.querySelector(sel).remove(), 600);
      }, 300),
    sel,
  );

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
      await freezeThenLet(page, '#x');
      const after = await gone(2000).then(() => 'left', (e) => e.message);
      h.expect(after === 'left', `a page frozen mid-wait past the deadline, which let it go soon after, failed: ${after}`);
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

  async 'gone-waits-out-a-freeze'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div role="dialog" aria-label="Pick">x</div>');
      await freezeThenLet(page, '[role=dialog]');
      const after = await h.gone(page.getByRole('dialog', { name: 'Pick' }), 2000).then((ms) => ms, (e) => e.message);
      // about 1.15 s: 0.3 s before the freeze, the freeze as one 0.25 s tick and 0.6 s after it, where a count begun
      // only once the freeze was over would give about 0.6 s
      h.expect(typeof after === 'number' && after >= 900, `a page frozen mid-wait past the deadline, which let it go soon after, gave ${after}`);
    } finally { await ctx.close(); }
  },

  async 'gone-fails-at-its-deadline'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div role="dialog" aria-label="Pick">x</div>');
      const t0 = Date.now();
      const after = await h.gone(page.getByRole('dialog', { name: 'Pick' }), 500).then(() => 'left', (e) => e.message);
      const took = Date.now() - t0;
      h.expect(/^getByRole\(.* was still in the page after 0\.5 s of the page running$/.test(after) && took < 2000, `something that never left gave "${after}" after ${took} ms`);
    } finally { await ctx.close(); }
  },
};
