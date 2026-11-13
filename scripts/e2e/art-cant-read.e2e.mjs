import { drawPage, line } from './art-eraser-glow.e2e.mjs';

async function savedDrawing(h) {
  const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN });
  await drawPage(h, page);
  await line(page, [0.2, 0.4], [0.8, 0.6]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.dq-tools-saved').waitFor();
  const id = await page.evaluate(async () => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    return (await as.list())[0].id;
  });
  await page.reload();
  await page.waitForFunction(() => window.__daily?.store);
  return { ctx, page, errors, id };
}

async function failReads(page, stores) {
  await page.evaluate(async (stores) => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    const proto = IDBObjectStore.prototype;
    const originals = { get: proto.get, getAll: proto.getAll };
    window.restoreArtReads = () => Object.assign(proto, originals);
    for (const method of ['get', 'getAll']) {
      proto[method] = function (...args) {
        if (this.transaction.db.name === as.name && stores.includes(this.name)) {
          throw new DOMException('The disk could not be read.', 'NotReadableError');
        }
        return originals[method].apply(this, args);
      };
    }
  }, stores);
}

async function holdRead(page, store, method) {
  await page.evaluate(async ({ store, method }) => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    const proto = IDBObjectStore.prototype;
    const original = proto[method];
    const gate = { ready: false, used: false, release: null };
    window.focusReadGate = gate;
    proto[method] = function (...args) {
      const request = original.apply(this, args);
      if (this.transaction.db.name !== as.name || this.name !== store || gate.used) return request;
      gate.used = true;
      const delayed = { result: undefined, error: null, onsuccess: null, onerror: null };
      request.onsuccess = () => {
        delayed.result = request.result;
        gate.release = () => { proto[method] = original; delayed.onsuccess?.(); };
        gate.ready = true;
      };
      request.onerror = () => {
        delayed.error = request.error;
        gate.release = () => { proto[method] = original; delayed.onerror?.(); };
        gate.ready = true;
      };
      return delayed;
    };
  }, { store, method });
}

const restoreReads = (page) => page.evaluate(() => window.restoreArtReads());
const go = (page, route) => page.evaluate((route) => window.__daily.go(route), route);
const panel = (page, word) => page.getByRole('heading', { name: `Can’t ${word} right now` });
const retry = (page) => page.getByRole('button', { name: 'Try again' }).click();
async function failedRetry(h, page) {
  await page.locator('.dq-cant').evaluate((el) => { window.originalCantPanel = el; });
  await retry(page);
  await page.getByText('Still can’t open it. Nothing was changed. Try again in a moment.').waitFor();
  const same = await page.evaluate(() => ({
    panel: document.querySelector('.dq-cant') === window.originalCantPanel,
    focused: document.activeElement?.textContent === 'Try again',
  }));
  h.expect(same.panel && same.focused, 'failed retry replaced the panel or lost button focus');
}
const changed = (page) => page.evaluate(async () => {
  const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
  const channel = new BroadcastChannel(as.name);
  channel.postMessage('changed');
  channel.close();
});

async function disk(page, id) {
  return page.evaluate(async (id) => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    const db = await new Promise((ok, bad) => {
      const req = indexedDB.open(as.name);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    const read = (store, method, key) => new Promise((ok, bad) => {
      const obj = db.transaction(store).objectStore(store);
      const req = method === 'get' ? IDBObjectStore.prototype.get.call(obj, key)
        : IDBObjectStore.prototype.getAll.call(obj);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    const result = { strokes: await read('strokes', 'get', id), drafts: await read('drafts', 'getAll') };
    db.close();
    return result;
  }, id);
}

async function drawingRead(h, failedStores) {
  const { ctx, page, errors, id } = await savedDrawing(h);
  try {
    const before = await disk(page, id);
    h.expect(before.strokes.length > 0 && before.drafts.length === 0, 'fixture has no strokes or has a draft');
    await failReads(page, failedStores);
    await go(page, { name: 'draw', kind: 'today', id });
    const heading = panel(page, 'open this drawing');
    await heading.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('.dq-cant-t'));
    h.expect(await page.locator('.dq-draw canvas').count() === 0, 'unreadable drawing exposes a canvas');
    h.expect(!(await page.getByText('This is a fresh one.', { exact: false }).count()), 'read failure looks missing');
    await h.frames(page, 40);
    await failedRetry(h, page);
    await restoreReads(page);
    h.expect(JSON.stringify(await disk(page, id)) === JSON.stringify(before), 'failed read changed drawing or drafts');
    await retry(page);
    await page.waitForFunction(() => window.__daily?.ink?.strokes.length > 0 &&
      !document.querySelector('.dq-ink-stage')?.inert);
    h.expect((await page.evaluate(() => window.__daily.ink.strokes.length)) === before.strokes.length,
      'retry did not reopen the saved strokes');
    h.expect(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}

async function deleteDrawing(page, id) {
  await page.evaluate(async (id) => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    const db = await new Promise((ok, bad) => {
      const req = indexedDB.open(as.name);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    await new Promise((ok, bad) => {
      const t = db.transaction(['meta', 'strokes'], 'readwrite');
      for (const s of ['meta', 'strokes']) t.objectStore(s).delete(id);
      t.oncomplete = ok;
      t.onerror = () => bad(t.error);
    });
    db.close();
  }, id);
}

export const scenarios = {
  async 'art-cant-read-gallery-recovers-itself'(h) {
    const { ctx, page, errors } = await savedDrawing(h);
    try {
      await failReads(page, ['meta', 'drafts']);
      await go(page, { name: 'art' });
      await panel(page, 'read your drawings').waitFor();
      await page.getByRole('button', { name: 'Try again' }).focus();
      await restoreReads(page);
      await changed(page);
      await page.locator('[data-piece]').first().waitFor();
      const at = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
      h.expect(at === 'dq-pages-h', `the gallery recovered by itself and left focus on ${at}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-piece-outside-focus'(h) {
    const { ctx, page, errors, id } = await savedDrawing(h);
    try {
      await failReads(page, ['meta', 'strokes']);
      await go(page, { name: 'piece', id });
      await panel(page, 'open this drawing').waitFor();
      await restoreReads(page);
      await page.locator('.dq-top .dq-safe').focus();
      await changed(page);
      await page.getByRole('button', { name: 'Keep drawing', exact: true }).waitFor();
      h.expect(await page.locator('.dq-top .dq-safe').evaluate((el) => el === document.activeElement),
        'saved drawing recovery took focus from Safe Zone');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-draw-outside-focus'(h) {
    const { ctx, page, errors, id } = await savedDrawing(h);
    try {
      await failReads(page, ['drafts']);
      await go(page, { name: 'draw', kind: 'today', id });
      await panel(page, 'open this drawing').waitFor();
      await restoreReads(page);
      await holdRead(page, 'drafts', 'get');
      await retry(page);
      await page.waitForFunction(() => window.focusReadGate.ready);
      await page.locator('.dq-top .dq-safe').focus();
      await page.evaluate(() => window.focusReadGate.release());
      await page.waitForFunction(() => document.querySelector('.dq-ink-stage') &&
        !document.querySelector('.dq-ink-stage').inert);
      h.expect(await page.locator('.dq-top .dq-safe').evaluate((el) => el === document.activeElement),
        'drawing retry took focus from Safe Zone');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-gallery-outside-focus'(h) {
    for (const away of ['.dq-top .dq-safe', '.dq-artentry--today']) {
      const { ctx, page, errors } = await savedDrawing(h);
      try {
        await failReads(page, ['meta', 'drafts']);
        await go(page, { name: 'art' });
        await panel(page, 'read your drawings').waitFor();
        await restoreReads(page);
        await holdRead(page, 'drafts', 'getAll');
        await retry(page);
        await page.waitForFunction(() => window.focusReadGate.ready);
        await page.locator(away).focus();
        await page.evaluate(() => window.focusReadGate.release());
        await page.locator('[data-piece]').first().waitFor();
        h.expect(await page.locator(away).evaluate((el) => el === document.activeElement),
          `gallery retry took focus from ${away}`);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },
  async 'art-cant-read-lost-focus'(h) {
    const cases = [
      { name: 'piece', stores: ['meta', 'strokes'], store: 'meta', method: 'get', target: '.dq-piece [data-focus]' },
      { name: 'draw', stores: ['drafts'], store: 'drafts', method: 'get', target: '.dq-draw [data-focus]' },
      { name: 'art', stores: ['drafts'], store: 'drafts', method: 'getAll', target: '#dq-pages-h' },
    ];
    for (const test of cases) {
      const { ctx, page, errors, id } = await savedDrawing(h);
      try {
        await failReads(page, test.stores);
        const route = test.name === 'draw' ? { name: 'draw', kind: 'today', id }
          : test.name === 'piece' ? { name: 'piece', id } : { name: 'art' };
        await go(page, route);
        await panel(page, test.name === 'art' ? 'read your drawings' : 'open this drawing').waitFor();
        await restoreReads(page);
        await holdRead(page, test.store, test.method);
        await retry(page);
        await page.waitForFunction(() => window.focusReadGate.ready);
        await page.evaluate(() => document.activeElement.blur());
        await page.evaluate(() => window.focusReadGate.release());
        await page.waitForFunction((target) => document.activeElement === document.querySelector(target), test.target);
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },
  async 'art-cant-read-piece-removed-lost-focus'(h) {
    const { ctx, page, errors, id } = await savedDrawing(h);
    try {
      await failReads(page, ['meta', 'strokes']);
      await go(page, { name: 'piece', id });
      await panel(page, 'open this drawing').waitFor();
      await deleteDrawing(page, id);
      await restoreReads(page);
      await holdRead(page, 'meta', 'get');
      await retry(page);
      await page.waitForFunction(() => window.focusReadGate.ready);
      await page.evaluate(() => document.activeElement.blur());
      await page.evaluate(() => window.focusReadGate.release());
      await page.getByText('That page is no longer here.').waitFor();
      const focused = await page.evaluate(() => !!document.activeElement?.matches('.dq-piece [data-focus]'));
      h.expect(focused, 'a removed drawing left lost focus on the document');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-piece-removed'(h) {
    const { ctx, page, errors, id } = await savedDrawing(h);
    try {
      await failReads(page, ['meta', 'strokes']);
      await go(page, { name: 'piece', id });
      await panel(page, 'open this drawing').waitFor();
      await deleteDrawing(page, id);
      await restoreReads(page);
      await page.getByRole('button', { name: 'Try again' }).focus();
      await retry(page);
      await page.getByText('That page is no longer here.').waitFor();
      const focused = await page.evaluate(() => !!document.activeElement?.matches('.dq-piece [data-focus]'));
      h.expect(focused, 'a retry that found the drawing removed dropped the focus');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-gallery'(h) {
    const { ctx, page, errors } = await savedDrawing(h);
    try {
      await failReads(page, ['meta', 'drafts']);
      await go(page, { name: 'art' });
      await panel(page, 'read your drawings').waitFor();
      h.expect(!(await page.getByText('No pages yet', { exact: false }).count()), 'gallery says no pages');
      h.expect(await page.locator('[data-piece]').count() === 0, 'gallery shows a partial list');
      await restoreReads(page);
      await retry(page);
      await page.locator('[data-piece]').first().waitFor();
      const focused = await page.evaluate(() => document.activeElement?.id === 'dq-pages-h');
      h.expect(focused, 'gallery retry did not focus the Your pages heading');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-gallery-change'(h) {
    const { ctx, page, id } = await savedDrawing(h);
    try {
      await go(page, { name: 'art' });
      await page.locator('[data-piece]').first().waitFor();
      await failReads(page, ['drafts']);
      await changed(page);
      await panel(page, 'read your drawings').waitFor();
      h.expect(await page.locator('[data-piece]').count() === 0, 'gallery kept an incomplete list');
      await restoreReads(page);
      await changed(page);
      await page.locator(`[data-piece="${id}"]`).waitFor();
      h.expect(!(await panel(page, 'read your drawings').count()), 'gallery did not replace the error');
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-piece-change'(h) {
    for (const failedStore of ['meta', 'strokes']) {
      const { ctx, page, errors, id } = await savedDrawing(h);
      try {
        const other = await ctx.newPage();
        await other.goto(h.server.url + '/?mute');
        await other.waitForFunction(() => window.__daily?.store);
        await go(other, { name: 'piece', id });
        await other.getByRole('button', { name: 'Rename', exact: true }).waitFor();
        await go(page, { name: 'piece', id });
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        const input = page.locator('.dq-piece-rename input');
        await input.fill('Still typing');
        await page.evaluate(async () => {
          const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
          window.artChecks = { shown: 0, get: 0 };
          for (const [method, count] of [['isShown', 'shown'], ['get', 'get']]) {
            const original = as[method].bind(as);
            as[method] = async (...args) => {
              try { return await original(...args); }
              finally { window.artChecks[count]++; }
            };
          }
        });
        await failReads(page, [failedStore]);
        await changed(page);
        await page.waitForFunction((key) => window.artChecks[key] > 0,
          failedStore === 'meta' ? 'shown' : 'get');
        await h.frames(page, 10);
        h.expect(await input.isVisible() && await input.inputValue() === 'Still typing',
          `a failed ${failedStore} recheck closed Rename or lost its text`);
        h.expect(await page.locator('.dq-cant').count() === 0, 'a failed recheck replaced the page with a panel');
        h.expect(await page.getByText('That page is no longer here.').count() === 0,
          'a failed recheck made the drawing look gone');
        await restoreReads(page);
        await other.getByRole('button', { name: 'Rename', exact: true }).click();
        await other.locator('.dq-piece-rename input').fill('New sky');
        await other.keyboard.press('Enter');
        await other.locator('.dq-piece-h', { hasText: 'New sky' }).waitFor();
        await h.poll(page, () => page.locator('.dq-piece-h').textContent(), (text) => text.trim() === 'New sky',
          'a later change did not update the drawing');
        h.expect(await input.isVisible() && await input.inputValue() === 'Still typing',
          'a later change closed Rename or lost its text');
        h.expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
  },
  async 'art-cant-read-change-during-load'(h) {
    const { ctx, page, errors, id } = await savedDrawing(h);
    try {
      const other = await ctx.newPage();
      await other.goto(h.server.url + '/?mute');
      await other.waitForFunction(() => window.__daily?.store);
      await go(other, { name: 'piece', id });
      await other.getByRole('button', { name: 'Rename', exact: true }).waitFor();
      await failReads(page, ['meta', 'strokes']);
      await go(page, { name: 'piece', id });
      await panel(page, 'open this drawing').waitFor();
      await restoreReads(page);
      await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const getAll = IDBObjectStore.prototype.getAll;
        const gate = { finish: null, changes: 0, latest: [], button: null };
        window.artChangeGate = gate;
        as.onChange(() => { gate.changes++; });
        as.drop();
        IDBObjectStore.prototype.getAll = function (...args) {
          const request = getAll.apply(this, args);
          if (this.transaction.db.name !== as.name || this.name !== 'meta' || gate.finish) return request;
          const delayed = { result: undefined, error: null, onsuccess: null, onerror: null };
          request.onsuccess = () => {
            delayed.result = request.result;
            gate.finish = () => {
              IDBObjectStore.prototype.getAll = getAll;
              const get = IDBObjectStore.prototype.get;
              IDBObjectStore.prototype.get = function (...args) {
                const next = get.apply(this, args);
                if (this.transaction.db.name !== as.name || !['meta', 'strokes'].includes(this.name)) return next;
                const held = { result: undefined, error: null, onsuccess: null, onerror: null };
                next.onsuccess = () => {
                  held.result = next.result;
                  gate.latest.push(() => held.onsuccess?.());
                };
                next.onerror = () => {
                  held.error = next.error;
                  gate.latest.push(() => held.onerror?.());
                };
                return held;
              };
              gate.release = () => {
                IDBObjectStore.prototype.get = get;
                gate.latest.splice(0).forEach((finish) => finish());
              };
              delayed.onsuccess?.();
            };
          };
          request.onerror = () => {
            delayed.error = request.error;
            gate.finish = () => {
              IDBObjectStore.prototype.getAll = getAll;
              delayed.onerror?.();
            };
          };
          return delayed;
        };
      });
      await page.evaluate(() => { window.artChangeGate.button = document.querySelector('.dq-cant button'); });
      await retry(page);
      await page.waitForFunction(() => !!window.artChangeGate.finish);
      await other.getByRole('button', { name: 'Rename', exact: true }).click();
      await other.locator('.dq-piece-rename input').fill('New sky');
      await other.keyboard.press('Enter');
      await other.locator('.dq-piece-h', { hasText: 'New sky' }).waitFor();
      await page.waitForFunction(() => window.artChangeGate.changes > 0);
      await page.evaluate(() => window.artChangeGate.finish());
      await page.getByRole('button', { name: 'Rename', exact: true }).waitFor();
      await page.waitForFunction(() => window.artChangeGate.latest.length >= 2);
      h.expect(await page.evaluate(() => window.artChangeGate.button.getAttribute('aria-disabled') === 'true'),
        'retry stopped waiting before the newer drawing was read');
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      const input = page.locator('.dq-piece-rename input');
      await input.fill('Still typing');
      await page.evaluate(() => window.artChangeGate.release());
      await h.poll(page, () => page.locator('.dq-piece-h').textContent(), (text) => text.trim() === 'New sky',
        'a change during the read did not update the drawing name');
      h.expect(await input.isVisible() && await input.inputValue() === 'Still typing',
        'the newer drawing replaced the rename field or its text');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-overlapping-retries'(h) {
    const { ctx, page, errors, id } = await savedDrawing(h);
    try {
      await failReads(page, ['meta', 'strokes']);
      await go(page, { name: 'piece', id });
      await panel(page, 'open this drawing').waitFor();
      await restoreReads(page);
      await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const get = IDBObjectStore.prototype.get;
        const pending = [];
        const gate = window.artReadGate = {
          pending,
          outstanding: 0,
          pass: false,
          release: (count) => {
            if (count === Infinity) gate.pass = true;
            pending.splice(0, count).forEach((finish) => finish());
          },
          restore: () => { IDBObjectStore.prototype.get = get; },
        };
        IDBObjectStore.prototype.get = function (...args) {
          const request = get.apply(this, args);
          if (this.transaction.db.name !== as.name || !['meta', 'strokes'].includes(this.name)) return request;
          const delayed = { result: undefined, error: null, onsuccess: null, onerror: null };
          gate.outstanding++;
          const deliver = (finish) => {
            const complete = () => { finish(); gate.outstanding--; };
            if (gate.pass) complete();
            else pending.push(complete);
          };
          request.onsuccess = () => {
            delayed.result = request.result;
            deliver(() => delayed.onsuccess?.());
          };
          request.onerror = () => {
            delayed.error = request.error;
            deliver(() => delayed.onerror?.());
          };
          return delayed;
        };
      });
      await changed(page);
      await page.waitForFunction(() => window.artReadGate.pending.length >= 2);
      await retry(page);
      await h.frames(page, 10);
      await page.evaluate(() => window.artReadGate.release(2));
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      const input = page.locator('.dq-piece-rename input');
      await input.fill('Blue sky');
      await page.evaluate(() => window.artReadGate.release(Infinity));
      await page.waitForFunction(() => window.artReadGate.outstanding === 0);
      h.expect(await input.isVisible() && await input.inputValue() === 'Blue sky',
        'an overlapping load closed the rename field or lost its text');
      await page.evaluate(() => window.artReadGate.restore());
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-piece'(h) {
    const { ctx, page, errors, id } = await savedDrawing(h);
    try {
      await failReads(page, ['meta', 'strokes']);
      await go(page, { name: 'piece', id });
      await panel(page, 'open this drawing').waitFor();
      h.expect(!(await page.getByText('That page is no longer here.').count()), 'saved drawing looks gone');
      await failedRetry(h, page);
      await restoreReads(page);
      await retry(page);
      await page.getByRole('button', { name: 'Keep drawing', exact: true }).waitFor();
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-ally-name-after-two-returns'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN });
    try {
      await h.reachHub(page);
      await page.locator('.dq-tile--art').click();
      await page.locator('.dq-artentry--ally').click();
      await page.waitForFunction(() => window.__daily?.ink && document.querySelector('.dq-ink-stage') &&
        !document.querySelector('.dq-ink-stage').inert &&
        !document.querySelector('.dq-draw').getAnimations().some((a) => a.playState === 'running'));
      await line(page, [0.2, 0.3], [0.7, 0.4]);
      await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        const put = as.put;
        as.put = function () {
          as.put = put;
          return Promise.reject(new Error('save refused'));
        };
      });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-sheet input').fill('Moth');
      await page.getByRole('button', { name: 'Rise', exact: true }).click();
      await page.getByText(/save this drawing\. Please try again/).waitFor();
      await page.locator('.dq-top .dq-safe').click();
      await page.waitForFunction(() => window.__daily?.route.name === 'safe');
      await failReads(page, ['drafts']);
      await page.goBack();
      await panel(page, 'open this drawing').waitFor();
      await page.locator('.dq-top .dq-safe').click();
      await page.waitForFunction(() => window.__daily?.route.name === 'safe');
      await page.goBack();
      await panel(page, 'open this drawing').waitFor();
      await restoreReads(page);
      await retry(page);
      await page.waitForFunction(() => window.__daily?.ink && document.querySelector('.dq-ink-stage') &&
        !document.querySelector('.dq-ink-stage').inert);
      h.expect(await page.evaluate(() => window.__daily.ink.strokes.length) === 1,
        'the ally lost its strokes after two returns');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const name = await page.locator('.dq-sheet input').inputValue();
      h.expect(name === 'Moth', `the ally name after two returns is "${name}", not "Moth"`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-resumed-visit'(h) {
    const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN });
    try {
      await drawPage(h, page);
      await line(page, [0.2, 0.4], [0.8, 0.6]);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.dq-tools-saved').waitFor();
      const id = await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return (await as.list())[0].id;
      });
      const before = await disk(page, id);
      await page.locator('.dq-top .dq-safe').click();
      await page.waitForFunction(() => window.__daily?.route.name === 'safe');
      await failReads(page, ['drafts', 'strokes']);
      await page.goBack();
      await panel(page, 'open this drawing').waitFor();
      await restoreReads(page);
      await retry(page);
      await page.waitForFunction(() => document.querySelector('.dq-ink-stage') &&
        !document.querySelector('.dq-ink-stage').inert);
      const count = await page.evaluate(() => window.__daily.ink.strokes.length);
      h.expect(count === before.strokes.length && count > 0, 'retry lost the resumed drawing’s strokes');
      await h.frames(page, 40);
      h.expect(JSON.stringify(await disk(page, id)) === JSON.stringify(before),
        'retry changed the saved strokes or wrote a stray draft');
      const ids = await page.evaluate(async () => {
        const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
        return (await as.list()).map((item) => item.id);
      });
      h.expect(ids.length === 1 && ids[0] === id, 'retry created another drawing');
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
  async 'art-cant-read-draft'(h) {
    await drawingRead(h, ['drafts']);
  },
  async 'art-cant-read-drawing'(h) {
    await drawingRead(h, ['strokes']);
  },
};
