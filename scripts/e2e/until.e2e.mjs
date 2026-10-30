// The harness's until() waits for a check in the page that awaits something, and gives up at its deadline even when the
// check never answers, or turns true only after it while a long wait between checks runs. Its waits count the page's
// running time: until(), poll(), leaves() and gone() pass on a page frozen mid-wait past the deadline that lets the
// wait end soon after, and fail at the deadline on one that never does, and stopwatch() leaves a freeze out of how long
// the page took. gone() takes something that goes only once the page has run past its deadline as late, and gives up on
// a page that stops answering just after it has gone.

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

  async 'until-waits-out-a-freeze'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div id="x">x</div>');
      await freezeThenLet(page, '#x');
      const after = await h.until(page, () => !document.querySelector('#x'), null, { timeout: 2000 }).then(() => 'answered', (e) => e.message);
      h.expect(after === 'answered', `a page frozen mid-wait past the deadline, which let the check come true soon after, failed: ${after}`);
    } finally { await ctx.close(); }
  },

  async 'poll-waits-out-a-freeze'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div id="x">x</div>');
      await freezeThenLet(page, '#x');
      const after = await h.poll(page, () => page.locator('#x').count(), (n) => n === 0, '#x stayed', { timeout: 2000 }).then(() => 'answered', (e) => e.message);
      h.expect(after === 'answered', `a page frozen mid-wait past the deadline, which let #x go soon after, failed: ${after}`);
    } finally { await ctx.close(); }
  },

  async 'poll-fails-at-its-deadline'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div id="x">x</div>');
      const t0 = Date.now();
      const after = await h.poll(page, () => page.locator('#x').count(), (n) => n === 0, (n) => `#x is still there (${n})`, { timeout: 500 }).then(() => 'answered', (e) => `${e.name}: ${e.message}`);
      const took = Date.now() - t0;
      h.expect(after === 'TimeoutError: #x is still there (1)' && took < 2000, `something that never went gave "${after}" after ${took} ms`);
    } finally { await ctx.close(); }
  },

  async 'stopwatch-leaves-out-a-freeze'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<p>x</p>');
      const ran = h.stopwatch(page);
      await h.sleep(500);
      await page.evaluate(() => {
        const end = performance.now() + 3000;
        while (performance.now() < end);
      });
      const ms = await ran();
      // about 0.75 s: the 0.5 s the page ran, then the freeze as one 0.25 s tick
      h.expect(ms >= 450 && ms < 1500, `0.5 s of the page running, then a 3 s freeze, came to ${ms} ms`);
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

  async 'gone-counts-a-late-leave-as-late'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div role="dialog" aria-label="Pick">x</div>');
      // the dialog goes as soon as the page has run 0.8 s, before the wait can have looked again: as a window that was
      // to stay open for 0.8 s and did
      await page.evaluate(() => {
        const watch = () => (Object.values(window.__e2eRuns ?? {}).some((c) => c.run >= 800) ? document.querySelector('[role=dialog]').remove() : setTimeout(watch, 5));
        watch();
      });
      const after = await h.gone(page.getByRole('dialog', { name: 'Pick' }), 800).then((ms) => `left after ${ms} ms`, (e) => e.message);
      h.expect(/ left only after 0\.8 s of the page running$/.test(after), `a dialog that went once the page had run past the deadline gave "${after}"`);
    } finally { await ctx.close(); }
  },

  async 'gone-ends-if-the-page-stops-once-it-left'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<div role="dialog" aria-label="Pick">x</div>');
      // the dialog goes, then the page stops for 8 s just as the wait asks it how long it ran
      await page.evaluate(() => {
        let runs;
        let stall = false;
        Object.defineProperty(window, '__e2eRuns', {
          configurable: true,
          get() {
            if (stall) {
              stall = false;
              const end = performance.now() + 8000;
              while (performance.now() < end);
            }
            return runs;
          },
          set(v) {
            runs = v;
          },
        });
        setTimeout(() => {
          document.querySelector('[role=dialog]').remove();
          stall = true;
        }, 300);
      });
      const t0 = Date.now();
      const after = await h.gone(page.getByRole('dialog', { name: 'Pick' }), 2000, { stuck: 2000 }).then((ms) => `left after ${ms} ms`, (e) => e.message);
      const took = Date.now() - t0;
      h.expect(/ left, then the page answered nothing until 2 s after the wait began$/.test(after) && took < 6000, `a page that stopped once the dialog had gone gave "${after}" after ${took} ms`);
    } finally { await ctx.close(); }
  },
};
