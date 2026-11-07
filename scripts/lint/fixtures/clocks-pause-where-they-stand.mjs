export async function stopTime(page, ctx, pauseClock) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  await ctx.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await pauseClock(page);
  await page.clock.runFor(300);
  await page.pauseAt(0);
}
