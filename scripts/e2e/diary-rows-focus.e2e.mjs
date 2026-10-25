import { returning, route } from './first-actions.e2e.mjs';

const ROWS = ['Sadness', 'Fear or anxiety', 'Anger', 'Shame', 'Joy'];

async function diary(h, page) {
  await page.bringToFront();
  await h.reachHub(page);
  await page.locator('.dq-tile', { hasText: 'Diary card' }).click();
  await route(page, 'diary');
  await page.locator('.dq-today').waitFor();
  if (!(await page.locator('.dq-rowsed').isVisible())) await page.getByRole('button', { name: 'Edit rows' }).click();
  await page.locator('.dq-rowsed').waitFor();
}
const radio = (page, row, v) => page.locator('.dq-today').getByRole('radio', { name: `${row}: ${v}`, exact: true });
const remove = (page, row) => page.locator('.dq-rowsed').getByRole('button', { name: `Remove ${row}`, exact: true });
const adder = (page) => page.locator('.dq-rowsed .dq-addrow').first().getByRole('textbox');
const gone = (page, row) => page.locator('.dq-today').getByRole('radiogroup', { name: row, exact: true }).waitFor({ state: 'detached', timeout: 5000 });
const tag = (page, name) => page.evaluate((n) => (document.activeElement.dataset.keep = n), name);
const focus = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return { keep: a?.dataset.keep ?? null, label: a?.getAttribute('aria-label') ?? a?.tagName ?? null, checked: a?.getAttribute('aria-checked') ?? null };
  });
async function removeIn(page, row) {
  await page.bringToFront();
  await remove(page, row).click();
}

export const scenarios = {
  async 'diary-rows-keep-focus'(h) {
    const { ctx, page: a, errors } = await h.open(returning(h, 3));
    try {
      await diary(h, a);
      const b = await ctx.newPage();
      b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
      await b.goto(h.server.url + '/?mute');
      await diary(h, b);
      await b.evaluate(() => (window.__live = 1));
      h.expect(JSON.stringify(await b.locator('.dq-today [role=radiogroup]').evaluateAll((g) => g.map((x) => x.getAttribute('aria-label')).slice(0, 5))) === JSON.stringify(ROWS), 'the diary does not start with the default feelings rows');

      await a.bringToFront();
      await radio(a, 'Sadness', 4).click();
      await a.getByRole('button', { name: 'Save', exact: true }).click();
      await b.locator('.dq-today [role=radio][aria-label="Sadness: 4"][aria-checked=true]').waitFor({ timeout: 5000 });

      await b.bringToFront();
      await adder(b).fill('Calm');
      await radio(b, 'Joy', 2).click();
      await radio(b, 'Joy', 2).focus();
      await tag(b, 'joy');
      const removeJoy = await remove(b, 'Joy').evaluate((e) => (e.dataset.same = 'joy'));

      await removeIn(a, 'Anger');
      await gone(b, 'Anger');
      let f = await focus(b);
      h.expect(f.keep === 'joy' && f.checked === 'true', `B's focus after A removed Anger: ${JSON.stringify(f)}`);
      h.expect((await adder(b).inputValue()) === 'Calm', `B's typed row name is now "${await adder(b).inputValue()}"`);
      h.expect(!(await remove(b, 'Anger').count()), "B's rows editor still offers Anger");
      h.expect((await remove(b, 'Joy').evaluate((e) => e.dataset.same)) === removeJoy, "B's Remove Joy button was rebuilt");

      await b.bringToFront();
      await remove(b, 'Fear or anxiety').focus();
      await tag(b, 'fear');
      await removeIn(a, 'Shame');
      await gone(b, 'Shame');
      f = await focus(b);
      h.expect(f.keep === 'fear', `B's focus after A removed Shame: ${JSON.stringify(f)}`);

      await removeIn(a, 'Fear or anxiety');
      await gone(b, 'Fear or anxiety');
      f = await focus(b);
      h.expect(f.label === 'Remove Joy', `B's focus after A removed the row it was on: ${JSON.stringify(f)}`);

      await b.bringToFront();
      await radio(b, 'Sadness', 4).focus();
      await removeIn(a, 'Sadness');
      await gone(b, 'Sadness');
      f = await focus(b);
      h.expect(f.label === 'Joy: 2' && f.checked === 'true', `B's focus after A removed the rated row it was on: ${JSON.stringify(f)}`);

      const rows = (page) => page.locator('.dq-today [role=radiogroup]').evaluateAll((g) => g.map((x) => x.getAttribute('aria-label')));
      h.expect(JSON.stringify((await rows(b)).slice(0, -1)) === JSON.stringify(['Joy']), `B's feelings rows: ${JSON.stringify(await rows(b))}`);
      await a.bringToFront();
      await a.locator('.dq-rowsed .dq-addrow').first().getByRole('textbox').fill('Sadness');
      await a.locator('.dq-rowsed .dq-addrow').first().getByRole('button', { name: 'Add' }).click();
      await b.locator('.dq-today [role=radio][aria-label="Sadness: 4"][aria-checked=true]').waitFor({ timeout: 5000 });

      await b.bringToFront();
      await b.getByRole('button', { name: 'Save', exact: true }).click();
      await b.locator('.dq-rowsed .dq-addrow').first().getByRole('button', { name: 'Add' }).click();
      await a.locator('.dq-today').getByRole('radiogroup', { name: 'Calm', exact: true }).waitFor({ timeout: 5000 });
      const s = JSON.parse(await h.ls(b, h.SAVE));
      const day = await b.evaluate(() => window.__daily.store.today());
      h.expect(s.diary[day]?.emotions?.Joy === 2 && s.diary[day]?.emotions?.Sadness === 4, `today's stored ratings: ${JSON.stringify(s.diary[day]?.emotions)}`);
      h.expect(JSON.stringify(s.settings.emotionRows) === JSON.stringify(['Joy', 'Sadness', 'Calm']), `stored feelings rows: ${JSON.stringify(s.settings.emotionRows)}`);
      h.expect(await b.evaluate(() => window.__live === 1), 'tab B reloaded');
      await h.shot(b, 'diary-rows-keep-focus');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
