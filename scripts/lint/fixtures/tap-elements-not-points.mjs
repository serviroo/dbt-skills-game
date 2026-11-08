export async function reachHome(page) {
  await page.mouse.click(195, 700);
  const x = 195;
  const y = x * 2 + 310;
  await page.touchscreen.tap(x, y);
  await page.mouse.move(187, 400);
  await page.mouse.down();
  const box = await page.locator('.dq-sw').boundingBox();
  const middle = box.x + box.width / 2;
  await page.mouse.click(middle, box.y + box.height / 2);
}
