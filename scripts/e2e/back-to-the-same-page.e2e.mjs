import { drawPage, line } from './art-eraser-glow.e2e.mjs';

const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({
    v: 1,
    events: [{ id: 'same-page-visit', k: 'visit', xp: 10, t: 1, day: day() }],
    flags: { greetDay: day(), therapistLineShown: true },
  }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});
const KEPT_APART = 'A newer copy of this drawing arrived, so this one was kept as its own page.';
const EARLIER_DRAFT = 'today:an-earlier-tab';
const stroke = (x, y) => ({ i: 1, w: 25, p: [x, y, x + 300, y + 80, x + 520, y + 20] });
const routeIs = (page, name) =>
  page.waitForFunction((n) => window.__daily?.route.name === n, name, { timeout: 10000 });
const xp = (h, page) => h.ls(page, h.SAVE).then((s) => JSON.parse(s).events.reduce((n, e) => n + (e.xp ?? 0), 0));
const drawings = (page) =>
  page.evaluate(async () => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    return (await as.exportAll()).records.map((r) => r.strokes.length).sort();
  });
const drawingsAre = (h, page, want, where) =>
  h.poll(
    page,
    () => drawings(page),
    (d) => JSON.stringify(d) === want,
    (d) => `${where} the Art room holds drawings of ${JSON.stringify(d)} strokes, not ${want}`,
    { timeout: 5000 },
  );
async function save(page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.dq-tools-saved').waitFor();
}
async function safeAndBack(page, screen) {
  await page.locator('.dq-top .dq-safe').click();
  await routeIs(page, 'safe');
  await page.goBack();
  await routeIs(page, screen);
}
const drawReady = (page) =>
  page.waitForFunction(
    () =>
      window.__daily?.ink &&
      !document.querySelector('.dq-ink-stage')?.inert &&
      !document.querySelector('.dq-draw')?.getAnimations().some((a) => a.playState === 'running'),
    null,
    { timeout: 10000 },
  );
const shows = (h, page, n, where) =>
  h.poll(
    page,
    () => page.evaluate(() => window.__daily.ink.strokes.length),
    (k) => k === n,
    (k) => `${where} the page shows ${k} strokes, not the saved drawing's ${n}`,
    { timeout: 5000 },
  );
const earlierDraft = (page) =>
  page.evaluate(
    async ([key, s]) => {
      const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
      await as.putDraft({ key, kind: 'today', strokes: [s], t: Date.now() - 3600e3 });
    },
    [EARLIER_DRAFT, stroke(200, 500)],
  );
const openEarlierDraft = (page) =>
  page.evaluate((draft) => window.__daily.go({ name: 'draw', kind: 'today', draft }), EARLIER_DRAFT);
async function keepDrawingOverAnother(h, page) {
  await h.reachHub(page);
  await page.evaluate(async (s) => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    const day = window.__daily.store.today();
    await as.put({ id: 'pg-a', kind: 'today', day, t: 1, updated: 1, n: 1, strokes: [s] });
  }, stroke(200, 500));
  await page.locator('.dq-tile--art').click();
  await page.locator('[data-piece="pg-a"]').click();
  await page.getByRole('button', { name: 'Keep drawing', exact: true }).click();
  await routeIs(page, 'draw');
  await drawReady(page);
  await shows(h, page, 1, 'Keep drawing:');
  const other = await page.context().newPage();
  await other.goto(page.url());
  await other.waitForFunction(() => !!window.__daily?.store);
  await other.evaluate(async (ss) => {
    const m = await import('/src/daily/artstore.ts');
    const as = m.artStore(window.__daily.store.key);
    const rec = await as.get('pg-a');
    await as.put({ ...rec, n: ss.length, strokes: ss, updated: 2, bases: [m.revOf(rec)], after: rec.updated });
  }, [stroke(200, 500), stroke(200, 900), stroke(200, 1300)]);
  await other.close();
  await line(page, [0.2, 0.6], [0.7, 0.7]);
}

export const scenarios = {
  async 'back-to-a-saved-drawing'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await save(page);
      await drawingsAre(h, page, '[1]', 'after Save');
      const before = await xp(h, page);

      await safeAndBack(page, 'draw');
      await drawReady(page);
      await shows(h, page, 1, 'back from the Safe Zone');
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await save(page);
      await drawingsAre(h, page, '[2]', 'a line more and Save:');

      await page.locator('.dq-tools').getByRole('button', { name: 'Art room', exact: true }).click();
      await routeIs(page, 'art');
      await page.goForward();
      await routeIs(page, 'draw');
      await drawReady(page);
      await shows(h, page, 2, 'Forward to it');
      const after = await xp(h, page);
      h.expect(after === before, `coming back credited it again: ${before} XP, then ${after}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'back-to-a-saved-ally-after-a-fresh-one'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await page.locator('.dq-tile--art').click();
      await page.locator('.dq-artentry--ally').click();
      await routeIs(page, 'draw');
      await drawReady(page);
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByRole('button', { name: 'Rise', exact: true }).click();
      await page.getByRole('button', { name: 'See your army', exact: true }).click();
      await routeIs(page, 'shadows');
      await drawingsAre(h, page, '[1]', 'after Rise');

      await page.locator('.dq-allyslot').click();
      await routeIs(page, 'draw');
      await drawReady(page);
      await line(page, [0.2, 0.5], [0.7, 0.6]);
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await line(page, [0.2, 0.7], [0.7, 0.8]);
      await page.waitForFunction(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return (await as.drafts()).some((d) => d.kind === 'ally' && d.strokes.length === 3);
      });

      await page.goBack();
      await routeIs(page, 'shadows');
      await page.goBack();
      await routeIs(page, 'draw');
      await drawReady(page);
      await shows(h, page, 1, 'back to the saved ally after a fresh one');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByRole('button', { name: 'Rise', exact: true }).click();
      await page.getByRole('button', { name: 'See your army', exact: true }).waitFor();
      await drawingsAre(h, page, '[1]', 'Rise again on the saved ally:');
      const drafts = await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return (await as.drafts()).map((d) => d.strokes.length);
      });
      h.expect(drafts.includes(3), 'the new ally draft was lost');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'drawing-does-not-use-another-drawings-draft'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await page.evaluate(async (ss) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const tab = as.claimTab();
        await tab.ready;
        const day = window.__daily.store.today();
        await as.put({ id: 'pg-a', kind: 'today', day, t: 1, updated: 1, n: 1, strokes: [ss[0]] });
        await as.put({ id: 'pg-b', kind: 'today', day, t: 2, updated: 2, n: 1, strokes: [ss[0]] });
        await as.putDraft({ key: `edit:pg-a:${tab.id}`, kind: 'today', editId: 'pg-b', strokes: ss, t: Date.now() });
        window.__daily.go({ name: 'draw', kind: 'today', id: 'pg-a' });
      }, [stroke(200, 500), stroke(200, 900), stroke(200, 1300)]);
      await routeIs(page, 'draw');
      await drawReady(page);
      await shows(h, page, 1, 'opening a drawing with another drawing under its draft key');
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await safeAndBack(page, 'draw');
      await drawReady(page);
      await shows(h, page, 2, 'returning to the edited drawing');
      const other = await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return (await as.drafts()).find((d) => d.editId === 'pg-b')?.strokes.length;
      });
      h.expect(other === 3, "the other drawing's draft was changed");
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'back-to-a-copy-kept-apart'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await keepDrawingOverAnother(h, page);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText(KEPT_APART, { exact: true }).first().waitFor();
      await drawingsAre(h, page, '[2,3]', 'with the other copy saved first,');
      await safeAndBack(page, 'draw');
      await drawReady(page);
      await shows(h, page, 2, 'back from the Safe Zone');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }

    const late = await h.open(seed(h));
    try {
      await keepDrawingOverAnother(h, late.page);
      await late.page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const put = as.put;
        as.put = function (...a) {
          as.put = put;
          return new Promise((go) => (window.__letPut = go)).then(() => put.apply(this, a));
        };
      });
      await late.page.getByRole('button', { name: 'Save', exact: true }).click();
      await late.page.waitForFunction(() => !!window.__letPut);
      await late.page.locator('.dq-top .dq-safe').click();
      await routeIs(late.page, 'safe');
      await late.page.goBack();
      await routeIs(late.page, 'draw');
      await late.page.goForward();
      await routeIs(late.page, 'safe');
      await late.page.goBack();
      await routeIs(late.page, 'draw');
      await late.page.evaluate(() => window.__letPut());
      await drawingsAre(h, late.page, '[2,3]', 'after the late Save');
      await drawReady(late.page);
      await shows(h, late.page, 2, 'back from the Safe Zone after a late Save');
      await line(late.page, [0.2, 0.7], [0.7, 0.8]);
      await save(late.page);
      await drawingsAre(h, late.page, '[3,3]', 'saving the returned copy');
      h.expect(!late.errors.length, late.errors.join('\n'));
    } finally {
      await late.ctx.close();
    }
  },

  async 'back-to-a-resumed-draft'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.reachHub(page);
      await earlierDraft(page);
      await openEarlierDraft(page);
      await routeIs(page, 'draw');
      await drawReady(page);
      await shows(h, page, 1, 'the draft opened:');
      await line(page, [0.2, 0.6], [0.7, 0.7]);
      await save(page);
      await drawingsAre(h, page, '[2]', 'after Save');

      await safeAndBack(page, 'draw');
      await drawReady(page);
      await shows(h, page, 2, 'back from the Safe Zone');
      await save(page);
      await drawingsAre(h, page, '[2]', 'Save again:');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }

    const early = await h.open(seed(h));
    try {
      await h.reachHub(early.page);
      await earlierDraft(early.page);
      await early.page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const getDraft = as.getDraft;
        as.getDraft = function (...a) {
          as.getDraft = getDraft;
          return new Promise((go) => (window.__letDraft = go)).then(() => getDraft.apply(this, a));
        };
      });
      await openEarlierDraft(early.page);
      await early.page.waitForFunction(() => !!window.__letDraft);
      await early.page.locator('.dq-top .dq-safe').click();
      await routeIs(early.page, 'safe');
      await early.page.evaluate(() => window.__letDraft());
      await early.page.goBack();
      await routeIs(early.page, 'draw');
      await drawReady(early.page);
      await shows(h, early.page, 1, 'back from the Safe Zone tapped while the draft opened');
      h.expect(!early.errors.length, early.errors.join('\n'));
    } finally {
      await early.ctx.close();
    }

    const failed = await h.open(seed(h));
    try {
      await h.reachHub(failed.page);
      await earlierDraft(failed.page);
      await failed.page.reload();
      await h.reachHub(failed.page);
      await failed.page.evaluate(async (ss) => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const tab = as.claimTab();
        await tab.ready;
        await as.putDraft({ key: `today:${tab.id}`, kind: 'today', strokes: ss, t: Date.now() });
      }, [stroke(200, 500), stroke(200, 900), stroke(200, 1300)]);
      await failed.page.evaluate(() => {
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...a) {
          if (this.name !== 'drafts') return get.apply(this, a);
          IDBObjectStore.prototype.get = get;
          throw new DOMException('The disk could not be read.', 'NotReadableError');
        };
      });
      await openEarlierDraft(failed.page);
      await routeIs(failed.page, 'draw');
      await failed.page.getByText(/open this drawing/).waitFor();
      h.expect(await failed.page.locator('.dq-ink-stage').evaluate((el) => el.inert), 'drawing opened after a read error');
      await safeAndBack(failed.page, 'draw');
      await drawReady(failed.page);
      await shows(h, failed.page, 1, 'back to the draft whose read failed');
      const drafts = await failed.page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return (await as.drafts()).map((d) => d.strokes.length);
      });
      h.expect(drafts.includes(3), 'the other draft was overwritten');
      h.expect(!failed.errors.length, failed.errors.join('\n'));
    } finally {
      await failed.ctx.close();
    }
  },
};
