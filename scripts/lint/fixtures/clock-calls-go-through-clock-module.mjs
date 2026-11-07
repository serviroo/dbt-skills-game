import * as pageClock from '../../e2e/clock.mjs';

export async function stopTime(page, ctx) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  await ctx.clock.runFor(1000);
  const held = page['clock'];
  const { clock } = ctx;
  const { clock: kept = held } = page;
  await page.context().clock.install();
  const { 'clock': quoted } = ctx;
  await page[`clock`].resume();
  await pageClock.pauseClock(page);
  await pageClock.runFor(page, 300);
  const video = page.locator('video');
  await video.pauseAt(300);
  const { clockwork, ...rest } = page;
  return [clock, kept, quoted, clockwork, rest, { clock: false }];
}
