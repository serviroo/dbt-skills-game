export const install = (target, options) => target.clock.install(options);

export async function reloadOnFakeClock(page) {
  await install(page);
  await page.reload();
}

export const runFor = (page, ms) => page.clock.runFor(ms);

export const fastForward = (page, ms) => page.clock.fastForward(ms);

export const resume = (page) => page.clock.resume();

export const coolRunning = (page, choice) => page.waitForFunction((choice) => {
  const cool = document.querySelector('.dq-sz-body .dq-cool');
  const count = Number(cool?.querySelector('.dq-timer-num')?.textContent);
  const selected = [...(cool?.querySelectorAll('.dq-cool-pick button[aria-pressed=true]') ?? [])];
  return count > 0 && count < 30 && selected.some((button) => button.textContent.trim() === choice);
}, choice);

export const setFixedTime = (target, time) => target.clock.setFixedTime(time);

export const setSystemTime = (target, time) => target.clock.setSystemTime(time);

/**
 * Holds the page's clock, runs tap(), which raises a toast, and lets the screen it opens settle for 1 s of that clock.
 * The toast's Undo lasts 6 s of the page's timers, and a screenshot on a slow machine, or a browser stopped for a
 * while, can take longer; held, it waits for the scenario. pageClock.resume(page) lets it run out again.
 */
export async function holdToast(h, page, tap, { installed = false } = {}) {
  if (!installed) await install(page);
  await pauseClock(page);
  await tap();
  await runFor(page, 1000);
}

/**
 * Stops the page clock where it is, so time moves only when the scenario says. clock.pauseAt alone takes a wall time,
 * which a running clock may pass before the call lands on a slow page. Holding Date still first makes the pause land
 * exactly there; then Date catches up with the time the clock ran on before it stopped.
 */
export async function pauseClock(page) {
  const [wall, ticks] = await page.evaluate(() => [Date.now(), performance.now()]);
  await page.clock.setFixedTime(wall);
  await page.clock.pauseAt(wall);
  await page.clock.setSystemTime(wall + (await page.evaluate((t) => performance.now() - t, ticks)));
}
