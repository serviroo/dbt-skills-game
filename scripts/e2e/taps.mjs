/** taps the middle of `loc` where it is now, as a player does: a Playwright click first waits for two still frames,
 *  which a scene drawing about one frame a second in software can take longer to give than the click waits. Like a
 *  player, it taps a button once it has shown: until then it takes no tap, and a tap there only completes the screen */
export async function tapWhereItIs(page, loc) {
  const el = await loc.elementHandle({ timeout: 2000 });
  await page.waitForFunction((b) => {
    const r = b.getBoundingClientRect();
    return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }, el, { timeout: 20000 });
  const box = await loc.boundingBox({ timeout: 2000 });
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
