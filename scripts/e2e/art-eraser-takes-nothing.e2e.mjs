// An eraser stroke that takes nothing from the page leaves the history alone: erasing beside a line, over paper an
// eraser already cleared, or in an empty corner of a line's box after an Undo keeps Redo, and Redo brings the drawing
// back, as it does after erasing ink too far off the page to show. One that does take ink is still kept, undone and
// redone.
import { drawPage, inkAt, line, pick, strokes } from './art-eraser-glow.e2e.mjs';

/** A tap at a point given as a fraction of the page. */
async function tap(page, a) {
  const box = await page.locator('.dq-ink-live').boundingBox();
  await page.mouse.move(box.x + box.width * a[0], box.y + box.height * a[1]);
  await page.mouse.down();
  await page.mouse.up();
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
/** The page is 1200 by 1600 logical px; a point there as a fraction of it. */
const at = (x, y) => [x / 1200, y / 1600];

export const scenarios = {
  /** 390 px: erasing nothing after an Undo keeps Redo; erasing ink is kept, undone and redone */
  async 'art-eraser-takes-nothing-keeps-redo'(h) {
    const { expect } = h;
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 390, height: 844 });
    await drawPage(h, page);
    const undo = () => button(page, 'Undo').click();
    const redo = () => button(page, 'Redo').click();
    const canRedo = async () => !(await button(page, 'Redo').isDisabled());

    // a line, and a second one undone so Redo holds it
    await line(page, [0.2, 0.3], [0.8, 0.3]);
    const [a] = await page.evaluate(() => window.__daily.ink.strokes.map((s) => ({ w: s.w, y: s.p.filter((_, i) => i % 2).reduce((t, v, _, l) => t + v / l.length, 0) })));
    await line(page, [0.2, 0.75], [0.8, 0.75]);
    await undo();
    expect((await strokes(page)).length === 1 && (await canRedo()), 'Undo did not leave the second line to Redo');

    // beside the line, a few px past where the eraser would reach the line its light starts from: nothing is taken
    await pick(page, 'Eraser');
    const gap = (a.w * 1.4) / 2 + Math.max(2, a.w * 0.625) + 4;
    await line(page, at(360, a.y + gap), at(840, a.y + gap));
    await h.shot(page, 'beside-the-line');
    expect((await strokes(page)).length === 1, 'an eraser stroke beside a line, taking nothing, was kept: ' + JSON.stringify(await strokes(page)));
    expect(await canRedo(), 'an eraser stroke that took nothing cleared Redo');
    expect((await inkAt(page, 600, Math.round(a.y))) > 200, 'the line beside the eraser lost its ink');
    await redo();
    expect((await strokes(page)).length === 2 && (await inkAt(page, 600, 1200)) > 200, 'Redo did not bring the undone line back after erasing nothing');

    // an eraser stroke across the line takes ink: it is kept, and Undo and Redo treat it like any stroke
    await line(page, [0.5, 0.2], [0.5, 0.4]);
    expect(JSON.stringify(await strokes(page)) === '["brush","brush","erase"]', 'an eraser stroke across a line was not kept: ' + JSON.stringify(await strokes(page)));
    expect((await inkAt(page, 600, Math.round(a.y))) === 0, 'the eraser left ink where it crossed the line');
    await undo();
    expect((await strokes(page)).length === 2 && (await inkAt(page, 600, Math.round(a.y))) > 200, 'Undo did not bring the erased ink back');
    await redo();
    expect((await strokes(page)).length === 3 && (await inkAt(page, 600, Math.round(a.y))) === 0, 'Redo did not erase the line again');

    // the same pass again, over paper that eraser already cleared: nothing is taken, so a line undone just before stays
    // in Redo
    await pick(page, 'Brush');
    await line(page, [0.2, 0.9], [0.8, 0.9]);
    await undo();
    await pick(page, 'Eraser');
    await line(page, [0.5, 0.2], [0.5, 0.4]);
    expect((await strokes(page)).length === 3, 'an eraser stroke over ink already erased was kept: ' + JSON.stringify(await strokes(page)));
    expect(await canRedo(), 'erasing what was already erased cleared Redo');
    await redo();
    expect((await strokes(page)).length === 4 && (await inkAt(page, 600, 1440)) > 200, 'Redo did not bring the undone line back after erasing cleared paper');

    // a fine diagonal line and a tap inside its box but far from it, after an Undo
    await pick(page, 'Brush');
    await page.getByRole('radio', { name: 'Fine size', exact: true }).click();
    await line(page, at(200, 200), at(1000, 1000));
    await line(page, at(700, 1500), at(1100, 1500));
    await undo();
    await pick(page, 'Eraser');
    await tap(page, at(200, 800));
    expect((await strokes(page)).length === 5, 'an eraser tap on empty paper inside a line\'s box was kept: ' + JSON.stringify(await strokes(page)));
    expect(await canRedo(), 'an eraser tap on empty paper cleared Redo');
    await redo();
    expect((await strokes(page)).length === 6 && (await inkAt(page, 900, 1500)) > 200, 'Redo did not bring the undone line back after the tap');

    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** 1280 px: ink off the page shows only as far as its light reaches onto it; erasing beyond that takes nothing */
  async 'art-eraser-off-the-page'(h) {
    const { expect } = h;
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', { width: 1280, height: 800 });
    await drawPage(h, page);
    const undo = () => button(page, 'Undo').click();
    const redo = () => button(page, 'Redo').click();
    const canRedo = async () => !(await button(page, 'Redo').isDisabled());
    const box = await page.locator('.dq-ink-live').boundingBox();
    expect(box.x + box.width * (-500 / 1200) > 0, 'the page is too close to the window edge to draw off it: ' + JSON.stringify(box));

    // a line running from the page far off its left edge, and a second line undone so Redo holds it
    await line(page, at(200, 500), at(-500, 500));
    const left = await page.evaluate(() => Math.min(...window.__daily.ink.strokes[0].p.filter((_, i) => i % 2 === 0)));
    expect(left < -400, `the line did not run off the page (it reaches ${left})`);
    await line(page, at(300, 1200), at(900, 1200));
    await undo();

    // from the page to the line far off it, past where the line's light reaches the page: nothing it shows is taken
    await pick(page, 'Eraser');
    await line(page, at(100, 900), at(-400, 500));
    expect((await strokes(page)).length === 1, 'an eraser stroke over ink too far off the page to show was kept: ' + JSON.stringify(await strokes(page)));
    expect(await canRedo(), 'an eraser stroke off the page that took nothing cleared Redo');
    await redo();
    expect((await strokes(page)).length === 2, 'Redo did not bring the undone line back after erasing off the page');

    // just off the page the line's light still reaches it, so erasing there is kept
    await line(page, at(100, 900), at(-60, 500));
    expect(JSON.stringify(await strokes(page)) === '["brush","brush","erase"]', 'an eraser stroke over ink whose light reaches the page was not kept: ' + JSON.stringify(await strokes(page)));
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
