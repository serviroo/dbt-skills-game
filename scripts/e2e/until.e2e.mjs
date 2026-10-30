// The harness's until() waits for a check in the page that awaits something, and gives up at its deadline even when the
// check never answers, or turns true only after it while a long wait between checks runs. Its waits count the page's
// running time: until(), poll(), leaves() and gone() pass on a page frozen mid-wait past the deadline that lets the
// wait end soon after, and fail at the deadline on one that never does. stopwatch() and quick() leave a freeze out of how
// long the page took, and count the app's own work in full: one task past the limit, two under it that add up past it,
// or an app call a test makes in the page fail quick(), and so does a page that stops answering anywhere in it. gone()
// takes something that goes only once the page has run past its deadline as late, and gives up on a page that stops
// answering just after it has gone.
import { pause } from './device-motion.e2e.mjs';

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

const STUCK = 'still waiting 30 s later';
/**
 * What wait() came to, and how long the page ran meanwhile, counted as the harness's waits count their deadlines (a gap
 * over 250 ms between 50 ms ticks as 250 ms), so a stopped browser stretches neither. The count shows in window.ran.ms
 * meanwhile, for a check that turns true in it. A wait still going 30 s later is stuck, and its page isn't asked again
 * (ms is NaN).
 */
async function timed(page, wait) {
  await page.evaluate(() => {
    const { setTimeout: later, now } = window.__e2eReal;
    const c = (window.ran = { ms: 0, stop: false });
    let last = now();
    const tick = () => {
      if (c.stop) return;
      const t = now();
      c.ms += Math.min(t - last, 250);
      last = t;
      later(tick, 50);
    };
    later(tick, 50);
  });
  let timer;
  const after = await Promise.race([wait(), new Promise((done) => (timer = setTimeout(() => done(STUCK), 30000)))]).finally(() => clearTimeout(timer));
  if (after === STUCK) return { after, ms: NaN };
  const ms = await page.evaluate(() => {
    window.ran.stop = true;
    return Math.round(window.ran.ms);
  });
  return { after, ms };
}

export const scenarios = {
  async 'until-hung-check-fails'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      const hung = await timed(page, () => h.until(page, () => new Promise(() => {}), null, { timeout: 500 }).then(() => 'answered', (e) => e.message));
      h.expect(/^waited 500 ms for /.test(hung.after) && hung.ms < 2000, `a check that never answers gave "${hung.after}" after ${hung.ms} ms of the page running`);
      const late = await h.until(page, () => new Promise((r) => setTimeout(() => r(true), 300)), null, { timeout: 2000 }).then(() => 'answered', (e) => e.message);
      h.expect(late === 'answered', `a check that answered before its deadline failed: ${late}`);
    } finally { await ctx.close(); }
  },

  async 'until-fails-at-its-deadline'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      // true once the page has run 1 s, on the count the deadline is checked in, so a stopped browser can't make it true first
      const { after, ms } = await timed(page, () => h.until(page, () => window.ran.ms > 1000, null, { timeout: 300, polling: 2000 }).then(() => 'answered', (e) => e.message));
      h.expect(/^waited 300 ms for /.test(after) && ms < 1000, `a check true only after its deadline gave "${after}" after ${ms} ms of the page running`);
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
      const { after, ms } = await timed(page, () => h.poll(page, () => page.locator('#x').count(), (n) => n === 0, (n) => `#x is still there (${n})`, { timeout: 500 }).then(() => 'answered', (e) => `${e.name}: ${e.message}`));
      h.expect(after === 'TimeoutError: #x is still there (1)' && ms < 2000, `something that never went gave "${after}" after ${ms} ms of the page running`);
    } finally { await ctx.close(); }
  },

  async 'stopwatch-leaves-out-a-freeze'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<p>x</p>');
      const ran = await h.stopwatch(page);
      await h.sleep(500);
      // the freeze: the browser doesn't time a plain loop a test runs in the page, so to the page it is a stopped browser
      await page.evaluate(() => {
        const end = performance.now() + 3000;
        while (performance.now() < end);
      });
      const ms = await ran();
      // about 0.75 s: the 0.5 s the page ran, then the freeze as one 0.25 s tick
      h.expect(ms >= 450 && ms < 1500, `0.5 s of the page running, then a 3 s freeze, came to ${ms} ms`);
    } finally { await ctx.close(); }
  },

  async 'quick-counts-the-apps-own-work'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<button id="one">one</button><button id="two">two</button>');
      await page.evaluate(() => {
        document.body.addEventListener('ping', () => {});
        window.hold = (ms) => {
          const end = performance.now() + ms;
          while (performance.now() < end);
        };
        document.querySelector('#one').onclick = () => {
          window.hold(4000);
          window.done = 'one';
        };
        document.querySelector('#two').onclick = () => {
          window.hold(1500);
          setTimeout(() => {
            window.hold(1500);
            window.done = 'two';
          });
        };
      });
      const tap = (id) => async () => {
        await page.click(id, { timeout: 0 });
        await page.waitForFunction((id) => window.done === id.slice(1), id, { timeout: 0 });
      };
      const took = (ms, step) => h.quick(page, ms, 'the step', step).then(() => 0, (e) => Number(/took (\d+) ms/.exec(e.message)?.[1] ?? NaN));
      const one = await took(3000, tap('#one'));
      h.expect(one >= 4000, `one 4 s task passed a 3 s check, or failed it otherwise (took ${one} ms)`);
      const two = await took(2000, tap('#two'));
      h.expect(two >= 3000, `two 1.5 s tasks passed a 2 s check, or failed it otherwise (took ${two} ms)`);
      const called = await took(1000, (ran) => ran.evaluate((ms) => window.hold(ms), 1500));
      h.expect(called >= 1500, `an app call of 1.5 s the test made in the page passed a 1 s check, or failed it otherwise (took ${called} ms)`);
      // one that runs a listener of the page's, which the browser then times as well, counts once
      const both = await took(1000, (ran) => ran.evaluate((ms) => {
        document.body.dispatchEvent(new Event('ping'));
        window.hold(ms);
      }, 1500));
      h.expect(both >= 1500 && both < 2500, `an app call of 1.5 s that the browser timed too came to ${both} ms`);
    } finally { await ctx.close(); }
  },

  // a page that stops answering, before the check starts, in its step or as the step ends, fails it at its stuck limit
  async 'quick-ends-on-a-page-that-stops'(h) {
    const ctx = await h.browser.newContext();
    try {
      const stops = {
        before: async (page) => {
          await pause(ctx, page);
          return async () => {};
        },
        'in the step': async (page) => async () => {
          await pause(ctx, page);
          await new Promise(() => {});
        },
        'as the step ends': async (page) => () => pause(ctx, page),
      };
      for (const [where, stop] of Object.entries(stops)) {
        const page = await ctx.newPage();
        await page.setContent('<p>x</p>');
        const step = await stop(page);
        let timer;
        const after = await Promise.race([
          h.quick(page, 1000, 'the step', step, { stuck: 2000 }).then(() => 'passed', (e) => e.message),
          new Promise((done) => (timer = setTimeout(() => done('still waiting 15 s later'), 15000))),
        ]).finally(() => clearTimeout(timer));
        h.expect(after === 'the step took over 1000 ms of the page running (2 s went by, the page stopped for most of them)', `a page that stopped ${where} gave "${after}"`);
      }
    } finally { await ctx.close(); }
  },

  async 'quick-leaves-out-a-freeze'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent('<p>x</p>');
      // as in stopwatch-leaves-out-a-freeze, a plain loop the test runs in the page stands for a stopped browser
      const after = await h
        .quick(page, 1000, 'the step', () =>
          page.evaluate(() => {
            const end = performance.now() + 3000;
            while (performance.now() < end);
          }),
        )
        .then(() => 'passed', (e) => e.message);
      h.expect(after === 'passed', `a 3 s freeze failed a 1 s check: ${after}`);
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
      const { after, ms } = await timed(page, () => gone(500).then(() => 'left', (e) => e.message));
      h.expect(after === '#x was still in the page after 0.5 s of the page running' && ms < 2000, `something that never left gave "${after}" after ${ms} ms of the page running`);
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
      const { after, ms } = await timed(page, () => h.gone(page.getByRole('dialog', { name: 'Pick' }), 500).then(() => 'left', (e) => e.message));
      h.expect(/^getByRole\(.* was still in the page after 0\.5 s of the page running$/.test(after) && ms < 2000, `something that never left gave "${after}" after ${ms} ms of the page running`);
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
