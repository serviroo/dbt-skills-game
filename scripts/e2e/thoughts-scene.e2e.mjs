import { flat, live, PHONE, scenes, seed, toSkill } from './skill-scenes.e2e.mjs';

const PICS = {
  clouds: { label: 'Clouds crossing the sky', words: /Each thought is a cloud/ },
  cars: { label: 'Cars on a quiet road', words: /car going past/ },
  leaves: { label: 'Leaves on a stream', words: /sits on a leaf/ },
};
const NAMES = Object.keys(PICS);

const tap = (page, name) => page.locator('.dq-skill').getByRole('button', { name, exact: true }).first().click();
async function toThoughts(h, page, pic) {
  await toSkill(h, page, 'mindful-thoughts');
  await tap(page, PICS[pic].label);
  await tap(page, 'Ready');
  await page.locator('.dq-timer-svg--thoughts').waitFor({ timeout: 10000 });
  await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
}

export const scenarios = {
  async 'thoughts-no-webgl'(h) {
    for (const pic of NAMES) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
      await ctx.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest);
        };
      });
      await page.clock.install();
      await page.reload();
      await h.reachHub(page);
      const save = async () => JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}');
      const keys = async () => page.evaluate(() => Object.keys(localStorage).sort());
      const [before, storedBefore] = [await save(), await keys()];
      await toThoughts(h, page, pic);
      await page.clock.runFor(1500);
      await h.sleep(800);
      const s = await scenes(page);
      h.expect(
        s && s.contexts === 0 && s.live === 0 && !(await page.locator('.dq-scene').count()),
        `no WebGL ${pic}: a scene was left on the page: ${JSON.stringify(s)}`,
      );
      const shown = await flat(page);
      const others = NAMES.filter((p) => p !== pic);
      h.expect(
        shown.length > 0 && shown.every(Boolean) && (await page.locator(`.dq-thoughts--${pic}`).isVisible()),
        `no WebGL ${pic}: the flat ${pic} is hidden (${JSON.stringify(shown)})`,
      );
      h.expect(
        (await page.locator(others.map((p) => `.dq-thoughts--${p}`).join(',')).count()) === 0,
        `no WebGL ${pic}: another choice's picture is there too`,
      );
      const look = () =>
        page.$$eval('.dq-thoughts > [visibility]', (els) =>
          els.map((e) => `${e.getAttribute('visibility')} ${e.getAttribute('transform')}`).join(' | '),
        );
      const a = await look();
      await page.clock.runFor(2000);
      const b = await look();
      h.expect(a !== b, `no WebGL ${pic}: the flat picture's thoughts do not move (${a})`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await h.sleep(500);
      await page.clock.runFor(100);
      const c = await look();
      await page.clock.runFor(2000);
      h.expect(c === (await look()), `no WebGL ${pic}, reduced motion: the flat picture's thoughts still move (${c})`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await h.shot(page, `thoughts-no-webgl-${pic}`);
      await page.clock.fastForward(61000);
      await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 5000 });
      await tap(page, 'Next');
      await tap(page, 'Next');
      await tap(page, 'Quieter');
      await tap(page, 'Done');
      await page.locator('.dq-feedback').waitFor({ timeout: 5000 });
      await tap(page, 'Yes');
      await page.locator('.dq-after:not(.is-hidden)').waitFor({ timeout: 5000 });
      const after = await save();
      const runs = (sv) => sv.events.filter((e) => e.k === 'skill' && e.skill === 'mindful-thoughts');
      h.expect(
        runs(after).length === runs(before).length + 1,
        `no WebGL ${pic}: Spectator Mode was not counted once (${runs(before).length} -> ${runs(after).length})`,
      );
      const run = runs(after).at(-1);
      h.expect(
        JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(before).sort())
          && JSON.stringify(await keys()) === JSON.stringify(storedBefore),
        `no WebGL ${pic}: something new was stored (${Object.keys(after)}; ${await keys()})`,
      );
      h.expect(
        !JSON.stringify(run).includes(pic),
        `no WebGL ${pic}: the picture went into the save: ${JSON.stringify(run)}`,
      );
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'thoughts-emotion-keeps-tide'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await toSkill(h, page, 'current-emotion', 'watch');
    await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
    await live(h, page, 'emotion watch');
    const s = await scenes(page);
    h.expect(
      s.last.kind === 'tide' && !(await page.locator('.dq-timer-svg--thoughts').count()),
      `the emotion skill's watch step shows ${s.last.kind}`,
    );
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
