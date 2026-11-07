export const install = (target, options) => target.clock.install(options);

export async function reloadOnFakeClock(page) {
  await install(page);
  await page.reload();
}

export const runFor = (page, ms) => page.clock.runFor(ms);

export const fastForward = (page, ms) => page.clock.fastForward(ms);

export const resume = (page) => page.clock.resume();

export const setFixedTime = (target, time) => target.clock.setFixedTime(time);

export const setSystemTime = (target, time) => target.clock.setSystemTime(time);

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
