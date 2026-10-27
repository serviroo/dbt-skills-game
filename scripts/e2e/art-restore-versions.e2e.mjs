// Restoring a Save Crystal never loses a drawing: two copies of one version in the file both come in, two Restores at
// once both keep what they bring, and a version an older build edited without its tools' strokes comes back whole
// beside that edit. A version this build edited, or one cleared and drawn again, stays behind the edit as before.
import { drawPage, line, pick } from './art-eraser-glow.e2e.mjs';
import { crystal, restore } from './newer-save-safety.e2e.mjs';

/** A brush line, a soft-glow line and an eraser cutting the brush line, saved, and the Save Crystal with it. */
async function drawnCrystal(h) {
  const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
  await drawPage(h, page);
  await line(page, [0.2, 0.4], [0.8, 0.4]);
  await pick(page, 'Soft glow');
  await line(page, [0.2, 0.7], [0.8, 0.7]);
  await pick(page, 'Eraser');
  await line(page, [0.5, 0.25], [0.5, 0.55]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved in your Art room.').waitFor();
  await page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
  await page.locator('.dq-settings').waitFor({ timeout: 10000 });
  const raw = await crystal(h, page, 'drawn');
  h.expect(raw.art?.length === 1 && raw.art[0].strokes.length === 3, 'the Save Crystal does not hold the drawing: ' + JSON.stringify(raw.art?.map((r) => r.strokes.length)));
  h.expect(!errors.length, errors.join('\n'));
  await ctx.close();
  return raw;
}
/** Each drawing stored on this device: its id and its strokes as stored. */
const stored = (page) =>
  page.evaluate(async () => {
    const db = await new Promise((ok, bad) => Object.assign(indexedDB.open(`${window.__daily.store.key}.art`), { onsuccess: (e) => ok(e.target.result), onerror: bad }));
    const t = db.transaction('strokes');
    const [ids, strokes] = await Promise.all(['getAllKeys', 'getAll'].map((m) => new Promise((ok, bad) => Object.assign(t.objectStore('strokes')[m](), { onsuccess: (e) => ok(e.target.result), onerror: bad }))));
    db.close();
    return ids.map((id, i) => ({ id, strokes: strokes[i] }));
  });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** A plain brush line across the page at y. */
const across = (y) => ({ i: 3, w: 25.2, p: [200, y, 1000, y] });
/** An empty device on this build. */
async function fresh(h) {
  const s = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
  await h.reachHub(s.page);
  return s;
}

export const scenarios = {
  /** a file holding two copies of one version, neither holding all of the other (as a Restore keeps them), restores both */
  async 'art-restore-two-copies-of-one-version'(h) {
    const { expect } = h;
    const raw = await drawnCrystal(h);
    const rec = raw.art[0];
    const copy = { ...rec, id: `${rec.id}~k1`, strokes: [rec.strokes[0], across(1400)], n: 2 };
    const { ctx, page, errors } = await fresh(h);
    const said = await restore(h, page, { ...raw, art: [rec, copy] }, 'two-copies.json');
    const got = await stored(page);
    expect(got.length === 2 && got.some((g) => same(g.strokes, rec.strokes)) && got.some((g) => same(g.strokes, copy.strokes)), `restoring two copies of one version did not keep both (${said}): ` + JSON.stringify(got.map((g) => [g.id, g.strokes.length])));
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** two tabs restoring the same version with different strokes at once both keep what they bring */
  async 'art-restore-two-at-once'(h) {
    const { expect } = h;
    const raw = await drawnCrystal(h);
    const rec = raw.art[0];
    const { ctx, page, errors } = await fresh(h);
    await restore(h, page, raw);
    const other = await ctx.newPage();
    other.on('pageerror', (e) => errors.push('other tab: ' + e.message));
    await other.goto(page.url());
    await h.reachHub(other);
    const b = [...rec.strokes, across(1400)], c = [...rec.strokes, across(1200)];
    const bring = (p, strokes) =>
      p.evaluate(async (art) => {
        const { artStore } = await import('/src/daily/artstore.ts');
        return artStore(window.__daily.store.key).importAll(art);
      }, [{ ...rec, strokes, n: strokes.length }]);
    const said = await Promise.all([bring(page, b), bring(other, c)]);
    const got = await stored(page);
    expect(got.some((g) => same(g.strokes, b)) && got.some((g) => same(g.strokes, c)), 'two Restores at once lost one of them: ' + JSON.stringify({ said, got: got.map((g) => [g.id, g.strokes.length]) }));
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a version an older build edited without its tools' strokes comes back beside the edit; other edits keep it behind */
  async 'art-restore-after-an-older-build-edit'(h) {
    const { expect } = h;
    const raw = await drawnCrystal(h);
    const rec = raw.art[0];
    const edit = (strokes) => ({ ...raw, art: [{ ...rec, rev: 'olderedit1', updated: rec.updated + 1000, from: [`${rec.rev ?? ''}@${rec.updated}`, ...(rec.from ?? [])], strokes, n: strokes.length }] });
    const cases = [
      // a build from before the tools keeps the strokes it can read and drops the tools' strokes
      { name: 'older-build', strokes: [...rec.strokes.filter((s) => !s.m), across(1400)], back: true },
      // this build keeps every stroke
      { name: 'this-build', strokes: [...rec.strokes, across(1400)], back: false },
      // cleared here and drawn again
      { name: 'cleared', strokes: [across(1400)], back: false },
    ];
    for (const c of cases) {
      const { ctx, page, errors } = await fresh(h);
      await restore(h, page, edit(c.strokes), `edit-${c.name}.json`);
      const said = await restore(h, page, raw, `original-${c.name}.json`);
      const got = await stored(page);
      const kept = got.find((g) => g.id === rec.id);
      expect(kept && same(kept.strokes, c.strokes), `${c.name}: restoring the version it was edited from changed the edit: ` + JSON.stringify(got.map((g) => [g.id, g.strokes.length])));
      const whole = got.some((g) => same(g.strokes, rec.strokes));
      if (c.back) expect(whole && got.length === 2 && /kept as its own page/.test(said), `${c.name}: the version with the tools' strokes did not come back beside the edit (${said}): ` + JSON.stringify(got.map((g) => [g.id, g.strokes.length])));
      else expect(got.length === 1, `${c.name}: the version the edit holds or replaced came back as a page of its own (${said})`);
      expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },
};
