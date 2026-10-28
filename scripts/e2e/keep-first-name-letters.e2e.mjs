// The first letters a player types into the name prompt are never lost, however the intro was started. The keys go in
// at once, as real key presses, with no wait for the prompt to finish opening and no tap into the field first.

const PROMPT = (page) => page.evaluate(() => ({ name: document.querySelector('#np-name')?.value, comp: document.querySelector('#np-comp')?.value, focus: document.activeElement?.id || document.activeElement?.tagName }));

/** Enter to the companion field, a tap beside the fields (focus leaves it), its name, Enter to continue: the name goes
 * back into the companion field and both names are stored exactly as typed */
async function finish(page, { youOf, leaves, expect }, label) {
  await page.keyboard.press('Enter');
  await page.locator('#np-comp').evaluate((el) => el.blur());
  await page.keyboard.type('Pip');
  const back = await PROMPT(page);
  expect(back.name === 'Robin' && back.comp === 'Pip' && back.focus === 'np-comp', `${label}: the companion's name did not go back into its field: ${JSON.stringify(back)}`);
  const left = leaves(page, '#np-name');
  await page.keyboard.press('Enter');
  await left(10000);
  const you = await youOf(page);
  expect(you?.name === 'Robin' && you?.companion === 'Pip', `${label}: names not stored as typed: ${JSON.stringify(you)}`);
}

export const scenarios = {
  /** Space or Enter starts the intro, held down long enough to repeat: the key and its repeats stay with the title, so
   * the name typed straight after is the whole name, with no spaces before it and nothing pushed past the field's end */
  async 'title-key-stays-on-title'(h) {
    const { open, expect } = h;
    for (const key of [' ', 'Enter']) {
      const label = key === ' ' ? 'Space' : key;
      const { ctx, page, errors } = await open({}, '?mute', { width: 1440, height: 900 });
      const title = page.locator('.title-screen');
      await title.waitFor({ timeout: 30000 });
      await title.focus();
      await page.keyboard.down(key);
      for (let i = 0; i < 30; i++) await page.keyboard.down(key);
      await page.keyboard.up(key);
      await page.keyboard.type('Robin');
      const typed = await PROMPT(page);
      expect(typed.name === 'Robin' && typed.focus === 'np-name', `${label}: the typed name did not land whole: ${JSON.stringify(typed)}`);
      await finish(page, h, label);
      expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** a phone or tablet with a keyboard: the intro starts with a tap, which leaves the field unfocused (no on-screen
   * keyboard pops up over the prompt), and the name typed straight after still goes into the name field */
  async 'touch-start-keeps-keys'(h) {
    const { open, expect } = h;
    const { ctx, page, errors } = await open({}, '?mute', { width: 390, height: 844 }, undefined, { isMobile: true, hasTouch: true });
    const title = page.locator('.title-screen');
    await title.waitFor({ timeout: 30000 });
    await title.tap();
    await page.locator('#np-name').waitFor({ state: 'attached', timeout: 15000 });
    const opened = await PROMPT(page);
    expect(opened.focus !== 'np-name', `the name field took focus on a touch-first phone: ${JSON.stringify(opened)}`);
    await page.keyboard.type('Robin');
    const typed = await PROMPT(page);
    expect(typed.name === 'Robin' && typed.focus === 'np-name', `the typed name did not land in the name field: ${JSON.stringify(typed)}`);
    await finish(page, h, 'touch');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
