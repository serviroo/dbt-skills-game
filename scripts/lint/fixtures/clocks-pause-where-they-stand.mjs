export async function stopTime(page, ctx, pauseClock) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  await ctx.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const clock = page.clock;
  await clock.pauseAt(await page.evaluate(() => Date.now()));
  const { clock: held } = ctx;
  await held.pauseAt(await page.evaluate(() => Date.now()));
  const later = held;
  await later.pauseAt(await page.evaluate(() => Date.now()));
  await pauseClock(page);
  await page.clock.runFor(300);
  const video = page.locator('video');
  await video.pauseAt(300);
  await page.pauseAt(0);
}

export const stopWith = async ({ clock }) => clock.pauseAt(Date.now());
