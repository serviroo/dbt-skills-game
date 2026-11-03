export const scenes = (page) =>
  page.evaluate(() => (window.__scenes ? JSON.parse(JSON.stringify(window.__scenes)) : null));

/** The scene's probe after jumping the page clock forward `ms` and letting a few frames draw. */
export async function after(h, page, ms) {
  // the page clock is stopped: the jump runs the next animation frame once, which draws the scene at the new moment
  if (ms > 0) await page.clock.fastForward(Math.round(ms));
  return (await scenes(page)).last;
}

export async function* steps(h, page, where, ms, { run = false } = {}) {
  const first = (await scenes(page)).last;
  for (let ran = 0, at = first; ; ran += ms) {
    yield at;
    h.expect(
      ran < first.dur * 1000,
      `${where}: the scene stopped drawing at e=${at.e.toFixed(1)} s, ${ran / 1000} s on, ` +
        `past the step's ${first.dur} s (${JSON.stringify(at)})`,
    );
    at = run ? (await page.clock.runFor(ms), (await scenes(page)).last) : await after(h, page, ms);
  }
}
