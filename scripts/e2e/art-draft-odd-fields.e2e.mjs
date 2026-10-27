// An unfinished drawing from a Save Crystal keeps every field this build doesn't read exactly as it was stored, even
// ones named "__proto__" or "constructor": they stay plain fields, never what the draft inherits from, and come back
// out through the Art room's store and the next Save Crystal unchanged.

export const scenarios = {
  /** a draft with "__proto__" and "constructor" fields reads, stores and comes back out unchanged */
  async 'art-draft-keeps-odd-fields'(h) {
    const { expect } = h;
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute');
    await h.reachHub(page);
    const got = await page.evaluate(async () => {
      const { artStore, cleanDraft } = await import('/src/daily/artstore.ts');
      // parsed, so "__proto__" is a plain field here as it is in a real file. Its editId would pass, the draft's doesn't
      const file = '{"key":"odd-fields","kind":"today","editId":7,"strokes":[{"i":1,"w":3,"p":[10,10,40,40]}],"t":5,"__proto__":{"editId":"inherited","polluted":1},"constructor":{"k":1}}';
      const d = cleanDraft(JSON.parse(file));
      const again = cleanDraft(JSON.parse(JSON.stringify(d)));
      const as = artStore(window.__daily.store.key);
      const added = (await as.importDrafts([JSON.parse(file)])).added;
      const back = (await as.exportDrafts()).drafts.find((x) => x.key === 'odd-fields');
      return {
        proto: Object.getPrototypeOf(d) === Object.prototype && Object.getPrototypeOf(back ?? {}) === Object.prototype,
        own: Object.hasOwn(d, '__proto__') && Object.hasOwn(d, 'constructor'),
        editId: d.editId ?? null,
        polluted: d.polluted ?? ({}).polluted ?? null,
        json: JSON.stringify(d),
        again: JSON.stringify(again),
        added,
        back: JSON.stringify(back),
      };
    });
    const want = '{"key":"odd-fields","kind":"today","strokes":[{"i":1,"w":3,"p":[10,10,40,40]}],"t":5,"__proto__":{"editId":"inherited","polluted":1},"constructor":{"k":1}}';
    expect(got.proto, 'a stored "__proto__" field changed what the draft inherits from');
    expect(got.own && got.json === want, 'a draft did not keep its "__proto__" and "constructor" fields as stored: ' + got.json);
    expect(got.editId === null && got.polluted === null, `a field read through a stored "__proto__" (editId ${got.editId}, polluted ${got.polluted})`);
    expect(got.again === want, 'a draft read back from what it wrote is not the same draft: ' + got.again);
    expect(got.added === 1 && got.back === want, `the draft did not come through the store and the Save Crystal unchanged (added ${got.added}): ${got.back}`);
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
