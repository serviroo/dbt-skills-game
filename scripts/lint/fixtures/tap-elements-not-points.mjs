export async function reachHome(page) {
  await page.mouse.click(195, 700);
  const box = await page.locator('.dq-sw').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
