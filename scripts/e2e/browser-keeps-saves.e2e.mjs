import fs from 'node:fs';
import path from 'node:path';

const FIREFOX_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SIZES = { phone: { width: 390, height: 844 }, small: { width: 320, height: 568 }, landscape: { width: 844, height: 390 }, desktop: { width: 1280, height: 800 } };
const OVERPROMISE = /backed up|backup is|forever|permanent|guarantee|home screen|install/i;

const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'keep-visit', k: 'visit', xp: 10, t: 1, day: day() }, { id: 'keep-skill', k: 'skill', skill: 'tipp', xp: 25, t: 2, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});

function simulate(cfg) {
  const k = (window.__keep = { granted: !!cfg.granted, persisted: cfg.persisted ?? 'answer', persist: [...(cfg.persist ?? [false])], missing: !!cfg.missing, calls: [], holds: [...(cfg.holds ?? [])], held: [], active: 0, most: 0 });
  if (cfg.noStorage) Object.defineProperty(Navigator.prototype, 'storage', { configurable: true, get: () => undefined });
  const proto = window.StorageManager?.prototype;
  if (!proto) return;
  const fail = () => new DOMException('simulated failure', 'UnknownError');
  const later = (ms, f) => new Promise((res, rej) => setTimeout(() => { try { res(f()); } catch (e) { rej(e); } }, ms));
  const hold = (what, settle) => {
    const i = k.holds.indexOf(what);
    if (i < 0) return null;
    k.holds.splice(i, 1);
    return new Promise((res, rej) => k.held.push({ what, go: (v) => { try { res(settle(v)); } catch (e) { rej(e); } } }));
  };
  k.release = (what, v) => {
    const i = k.held.findIndex((x) => x.what === what);
    if (i < 0) throw new Error('nothing held: ' + what);
    k.held.splice(i, 1)[0].go(v);
  };
  function persisted() {
    k.calls.push('persisted');
    const held = hold('persisted', (v) => {
      if (v === 'reject') throw fail();
      return v === undefined ? k.granted : v;
    });
    if (held) return held;
    const m = k.persisted;
    if (m === 'reject') return Promise.reject(fail());
    if (m === 'hang') return new Promise(() => {});
    return later(typeof m === 'number' ? m : 0, () => k.granted);
  }
  function persist() {
    k.calls.push('persist');
    k.most = Math.max(k.most, ++k.active);
    const answer = (give) => {
      if (give === 'reject') throw fail();
      if (give === true) k.granted = true;
      return k.granted;
    };
    const held = hold('persist', answer);
    if (held) return held.finally(() => k.active--);
    const a = k.persist.length > 1 ? k.persist.shift() : k.persist[0];
    const { ms = 0, give, then } = a && typeof a === 'object' ? a : { give: a };
    return later(ms, () => {
      if (then !== undefined) k.persisted = then;
      return answer(give);
    }).finally(() => k.active--);
  }
  Object.defineProperty(proto, 'persisted', { configurable: true, get: () => (k.missing ? undefined : persisted) });
  Object.defineProperty(proto, 'persist', { configurable: true, get: () => (k.missing ? undefined : persist) });
}

/** Holds the page's first open of the database `name` until window.__open.release(), as a slow disk would. */
function holdOpen(name) {
  const open = IDBFactory.prototype.open;
  const g = (window.__open = { asked: [], release: null });
  IDBFactory.prototype.open = function (...a) {
    g.asked.push(a[0]);
    if (a[0] !== name || g.release) return open.apply(this, a);
    let real = null;
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, get result() { return real?.result; }, get error() { return real?.error ?? null; } };
    g.release = () => {
      real = open.apply(indexedDB, a);
      for (const ev of ['upgradeneeded', 'success', 'error', 'blocked']) real['on' + ev] = (e) => req['on' + ev]?.(e);
    };
    return req;
  };
}

/** Through the app's own stores: waits for their databases to open, then saves a drawing, a draft and a story. */
async function seedSaves(today) {
  const [{ artStore }, { storyStore }, { ART_DB, STORY_DB, BESIDE }] = await Promise.all([import('/src/daily/artstore.ts'), import('/src/daily/storystore.ts'), import('/src/core/stored-names.ts')]);
  const key = window.__daily.store.key;
  const art = artStore(key);
  const stories = storyStore(key);
  const seeding = (window.__seeding = { art: false, stories: false });
  await Promise.all([art.list().then(() => (seeding.art = true)), stories.list().then(() => (seeding.stories = true))]);
  const line = (i, x) => ({ i, w: 14, p: [x, 300, x + 120, 520, x + 260, 760, x + 300, 1100] });
  const drawn = await art.put({ id: 'keep-drawing', kind: 'today', day: today, t: 1, updated: 1, prompt: 'Something that helped today', n: 2, strokes: [line(1, 200), line(3, 640)] });
  await art.putDraft({ key: 'today:keep', kind: 'today', strokes: [line(2, 420)], t: 2 });
  const { story, first } = await stories.create('The lantern by the river');
  const kept = await stories.saveChapter({ id: first.id, story: story.id, kind: 'page', title: first.title, text: 'Kit sat by the water and let the breath go slowly.' }, [first.rev]);
  await stories.putCards(first.id, [{ id: 'keep-card', mode: 'continue', text: 'What does Lumen notice next?', t: 3 }]);
  await stories.markOpened(today);
  return {
    wrote: [drawn.stored, kept.stored],
    drawing: drawn.id,
    chapter: first.id,
    stores: [...ART_DB.stores.map((s) => `${key}${BESIDE.art}/${s}`), ...STORY_DB.stores.map((s) => `${key}${BESIDE.story}/${s}`)],
  };
}

async function savesReady(h, page) {
  const saved = await page.evaluate(seedSaves, day());
  const idb = JSON.parse(await storage(page)).idb;
  const bare = saved.stores.filter((s) => !(JSON.parse(idb[s] ?? '[]').length > 0));
  h.expect(saved.wrote.every((w) => w === 'wrote') && !bare.length, 'the drawings and stories were not all saved before the baseline: ' + JSON.stringify({ ...saved, bare }));
  return saved;
}

async function loadKeep(h, cfg = {}, { viewport = SIZES.phone, ua, hold } = {}) {
  const ctx = await h.browser.newContext({ viewport, deviceScaleFactor: viewport.width > 900 ? 1 : 2, acceptDownloads: true, serviceWorkers: 'block', ...(ua && { userAgent: ua }) });
  await ctx.addInitScript(simulate, cfg);
  if (hold) await ctx.addInitScript(holdOpen, hold);
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed(h));
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/WebGL|GPU stall|AudioContext/i.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(h.server.url + '/?mute');
  return { ctx, page, errors, requests };
}

/** Home shows before the drawings and stories it lists have finished opening, so every baseline waits for them. */
async function openKeep(h, cfg = {}, opts = {}) {
  const k = await loadKeep(h, cfg, opts);
  await k.page.locator('.dq-tile--story').waitFor({ state: 'attached', timeout: 60000 });
  await savesReady(h, k.page);
  return k;
}

const calls = (page) => page.evaluate(() => window.__keep.calls.slice());
const asks = async (page) => (await calls(page)).filter((c) => c === 'persist').length;
const tune = (page, patch) => page.evaluate((p) => Object.assign(window.__keep, p), patch);
const release = (page, what, v) => page.evaluate(([w, x]) => window.__keep.release(w, x), [what, v]);
const asking = (page) => page.evaluate(() => ({ asks: window.__keep.calls.filter((c) => c === 'persist').length, most: window.__keep.most }));
const reads = async (page) => (await calls(page)).filter((c) => c === 'persisted').length;
async function holdAnswerRead(h, page) {
  const at = await asks(page);
  const from = (await calls(page)).length;
  await tune(page, { holds: ['persisted'] });
  await askBtn(page).click();
  await page.waitForFunction(() => window.__keep.held.some((x) => x.what === 'persisted'), null, { timeout: 5000 });
  const k = await page.evaluate(() => ({ active: window.__keep.active, held: window.__keep.held.map((x) => x.what) }));
  const after = (await calls(page)).slice(from);
  h.expect(JSON.stringify(after) === '["persist","persisted"]' && k.active === 0 && JSON.stringify(k.held) === '["persisted"]', `the read after the answer is not the one held: ${JSON.stringify({ after, ...k })}`);
  await stillAsking(h, page, 'answer read held');
  return at;
}
const bootAsked = (page, what) => page.waitForFunction((w) => window.__keep.calls.includes(w), what, { timeout: 15000 });
const panelReady = (page) =>
  page.waitForFunction(() => {
    const k = document.querySelector('.dq-keep');
    return !!k && (!!k.querySelector('[aria-busy="true"]') || k.dataset.keep !== 'checking');
  }, null, { timeout: 10000 });
async function tapHard(page) {
  const b = page.locator('.dq-keep-ask');
  await b.click({ force: true, timeout: 2000 }).catch(() => {});
  await b.dispatchEvent('click').catch(() => {});
}
async function stillAsking(h, page, where) {
  const busy = page.locator('.dq-keep-ask[aria-busy="true"]');
  if (!(await busy.count())) {
    await h.shot(page, `fail-asking-${where}`);
    throw new Error(`${where}: Settings does not show the request already out (it shows ${await stateOf(page)})`);
  }
  h.expect((await busy.isDisabled()) && /Asking your browser/i.test(await busy.innerText()), `${where}: the waiting request can be tapped again`);
}
const keep = (page) => page.locator('.dq-keep');
const askBtn = (page) => page.getByRole('button', { name: 'Ask browser to keep saves' });
const crystalBtn = (page) => page.getByRole('button', { name: 'Save Crystal' });
const stateOf = (page) => keep(page).getAttribute('data-keep', { timeout: 10000 });
async function waitKeep(h, page, state, ms = 10000) {
  await page.locator(`.dq-keep[data-keep="${state}"]`).waitFor({ timeout: ms }).catch(async (e) => {
    await h.shot(page, `fail-keep-${state}`);
    throw new Error(`Your data never showed "${state}" (it shows ${await keep(page).getAttribute('data-keep', { timeout: 1000 }).catch(() => 'nothing')}): ${e.message.split('\n')[0]}`);
  });
}
async function bootDone(h, page, expectAsk) {
  await h.reachHub(page);
  for (const end = Date.now() + 15000; Date.now() < end; await h.sleep(150)) {
    const c = await calls(page);
    if (c.includes('persisted') && (!expectAsk || c.includes('persist'))) return h.sleep(300);
  }
  throw new Error('the boot request never read the decision: ' + JSON.stringify(await calls(page)));
}
const comeBack = (page) =>
  page.evaluate(() => {
    const set = (v) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    set('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    set('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
const storage = (page) =>
  page.evaluate(async () => {
    const all = (s) => Object.fromEntries(Object.keys(s).sort().map((k) => [k, s.getItem(k)]));
    const bytes = (k, v) => (v instanceof ArrayBuffer ? { bytes: btoa(Array.from(new Uint8Array(v), (b) => String.fromCharCode(b)).join('')) } : v);
    const idb = {};
    for (const { name } of (await indexedDB.databases?.()) ?? []) {
      const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      for (const store of [...db.objectStoreNames].sort()) {
        idb[`${name}/${store}`] = await new Promise((res, rej) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => res(JSON.stringify(r.result, bytes));
          r.onerror = () => rej(new Error(`${name}/${store} could not be read: ${r.error?.message}`));
        });
      }
      db.close();
    }
    return JSON.stringify({ local: all(localStorage), session: all(sessionStorage), idb });
  });
const copyOf = (page) => keep(page).locator('.dq-keep-s').innerText();
function noOverpromise(h, text) {
  h.expect(!OVERPROMISE.test(text), 'the status overpromises: ' + text);
}
function localOnly(h, requests) {
  const away = requests.filter((u) => !u.startsWith(h.server.url) && !/^(data|blob):/.test(u));
  h.expect(!away.length, 'requests left the device: ' + away.join(', '));
}
async function unchanged(h, page, before, what) {
  const after = await storage(page);
  if (after !== before) fs.writeFileSync(path.join(h.out, `storage-${what}.json`), JSON.stringify({ before: JSON.parse(before), after: JSON.parse(after) }, null, 2));
  h.expect(after === before, `${what} changed the saved game or choices`);
}
function plant([db, store, id]) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(db);
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      const g = s.get(id);
      g.onsuccess = () => {
        const v = g.result;
        if (Array.isArray(v)) v[0].p[0] += 1;
        else v.text += ' Then the rain stopped.';
        if (s.keyPath) s.put(v);
        else s.put(v, id);
      };
      t.oncomplete = () => (r.result.close(), res());
      t.onerror = () => rej(t.error);
    };
  });
}

export const scenarios = {
  async 'keeps-granted-at-start (simulated)'(h) {
    const { ctx, page, errors, requests } = await openKeep(h, { granted: true });
    await bootDone(h, page, false);
    const before = await storage(page);
    await h.openSettings(page);
    await waitKeep(h, page, 'granted');
    const text = await copyOf(page);
    h.expect(/agreed to keep these saves/.test(text) && /Clearing this site.s data still removes them/.test(text), 'the granted copy is wrong: ' + text);
    noOverpromise(h, text);
    h.expect(!(await askBtn(page).isVisible()), 'the ask button shows although the browser already agreed');
    h.expect(await crystalBtn(page).isVisible(), 'the Save Crystal button is missing');
    h.expect((await asks(page)) === 0, 'persist() was called although the browser had already agreed');
    await unchanged(h, page, before, 'opening-settings');
    localOnly(h, requests);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { simulated: 'persisted() true from the start' };
  },

  async 'keeps-ask-gets-yes (simulated)'(h) {
    const { ctx, page, errors, requests } = await openKeep(h, { granted: false, persist: [false, { ms: 900, give: true }] });
    await bootDone(h, page, true);
    const atBoot = await asks(page);
    h.expect(atBoot === 1, `the boot request asked ${atBoot} times`);
    const before = await storage(page);
    await h.openSettings(page);
    await waitKeep(h, page, 'not-granted');
    await h.sleep(400);
    h.expect((await asks(page)) === atBoot, 'opening Settings asked the browser');
    const text = await copyOf(page);
    h.expect(/hasn.t agreed to keep these saves/.test(text) && /Save Crystal/.test(text), 'the not-kept copy is wrong: ' + text);
    noOverpromise(h, text);
    h.expect((await askBtn(page).isEnabled()) && (await crystalBtn(page).isVisible()), 'the ask or Save Crystal button is missing');
    const sent = requests.length;
    await askBtn(page).click();
    await page.locator('.dq-keep-ask[aria-busy="true"]').waitFor({ timeout: 2000 });
    const pending = page.locator('.dq-keep-ask');
    h.expect((await pending.isDisabled()) && /Asking your browser/i.test(await pending.innerText()), 'the ask button has no waiting state');
    h.expect(await page.locator('.dq-top .dq-safe').isEnabled(), 'the Safe Zone button is blocked while asking');
    await pending.click({ force: true }).catch(() => {});
    await pending.click({ force: true }).catch(() => {});
    await waitKeep(h, page, 'granted');
    h.expect((await asks(page)) === atBoot + 1, `one tap asked ${(await asks(page)) - atBoot} times`);
    h.expect(!(await askBtn(page).isVisible()), 'the ask button stays after a yes');
    await unchanged(h, page, before, 'asking');
    h.expect(requests.length === sent, 'asking made requests: ' + requests.slice(sent).join(', '));
    localOnly(h, requests);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { simulated: 'persist() no at boot, yes after 900 ms on the tap' };
  },

  async 'keeps-refusal (simulated)'(h) {
    const { ctx, page, errors, requests } = await openKeep(h, { granted: false, persist: [false] });
    await bootDone(h, page, true);
    const before = await storage(page);
    await h.openSettings(page);
    await waitKeep(h, page, 'not-granted');
    const atOpen = await asks(page);
    await askBtn(page).click();
    await waitKeep(h, page, 'refused');
    const text = await copyOf(page);
    h.expect(/didn.t agree this time/.test(text) && /saves are still here/.test(text) && /Save Crystal keeps a copy/.test(text), 'the refusal copy is wrong: ' + text);
    noOverpromise(h, text);
    h.expect(await askBtn(page).isEnabled(), 'the ask button is gone after a no');
    await askBtn(page).click();
    await page.waitForFunction((n) => window.__keep.calls.filter((c) => c === 'persist').length === n, atOpen + 2, { timeout: 5000 });
    await waitKeep(h, page, 'refused');
    await comeBack(page);
    await h.sleep(400);
    await waitKeep(h, page, 'refused');
    await unchanged(h, page, before, 'refusal');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), crystalBtn(page).click()]);
    h.expect(/^save-crystal-.*\.json$/.test(dl.suggestedFilename()), 'the Save Crystal did not download: ' + dl.suggestedFilename());
    const file = path.join(h.out, 'keep-refusal-crystal.json');
    await dl.saveAs(file);
    const crystal = fs.readFileSync(file, 'utf8');
    h.expect(h.deepFind(JSON.parse(crystal), 'playerName').includes('Kit') && !/persist|keepStatus|data-keep/i.test(crystal), 'the Save Crystal is wrong or carries the browser decision');
    localOnly(h, requests);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { simulated: 'persist() always no' };
  },

  async 'keeps-desktop-firefox-asks-only-on-tap (simulated)'(h) {
    const { ctx, page, errors, requests } = await openKeep(h, { granted: false, persist: [{ ms: 600, give: true }] }, { viewport: SIZES.desktop, ua: FIREFOX_DESKTOP });
    h.expect(/Firefox\//.test(await page.evaluate(() => navigator.userAgent)), 'the Firefox user agent is not in place');
    await bootDone(h, page, false);
    await h.sleep(1500);
    h.expect((await asks(page)) === 0, 'desktop Firefox was asked at boot');
    const before = await storage(page);
    await h.openSettings(page);
    await waitKeep(h, page, 'not-granted');
    await h.sleep(400);
    h.expect((await asks(page)) === 0, 'desktop Firefox was asked when Settings opened');
    await askBtn(page).click();
    await waitKeep(h, page, 'granted');
    h.expect((await asks(page)) === 1, 'the tap did not ask exactly once');
    await unchanged(h, page, before, 'firefox-ask');
    localOnly(h, requests);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { simulated: 'Chromium with a desktop Firefox user agent; the prompt answered yes' };
  },

  async 'keeps-missing-methods (simulated)'(h) {
    for (const cfg of [{ missing: true }, { noStorage: true }]) {
      const { ctx, page, errors, requests } = await openKeep(h, cfg);
      await h.reachHub(page);
      const before = await storage(page);
      await h.openSettings(page);
      await waitKeep(h, page, 'unsupported');
      const text = await copyOf(page);
      h.expect(/doesn.t say whether it keeps these saves/.test(text) && /Save Crystal/.test(text), 'the unsupported copy is wrong: ' + text);
      noOverpromise(h, text);
      h.expect(!(await askBtn(page).isVisible()), 'the ask button shows where the browser has no request');
      h.expect(await crystalBtn(page).isEnabled(), 'the Save Crystal button is missing');
      await unchanged(h, page, before, 'unsupported');
      localOnly(h, requests);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    return { simulated: 'StorageManager methods removed; navigator.storage removed' };
  },

  async 'keeps-baseline-waits-for-stores (simulated)'(h) {
    const held = `${h.SAVE}.story`;
    const { ctx, page, errors, requests } = await loadKeep(h, { missing: true }, { hold: held });
    await h.reachHub(page);
    await page.waitForFunction(() => !!window.__open.release, null, { timeout: 10000 });
    const early = await storage(page);
    h.expect(!Object.keys(JSON.parse(early).idb).some((k) => k.startsWith(held + '/')), 'the stories opened while their first open was held');
    let ready = false;
    const readying = savesReady(h, page).then((s) => ((ready = true), s));
    await Promise.race([readying, page.waitForFunction(() => window.__seeding?.art, null, { timeout: 10000 })]);
    const seeding = await page.evaluate(() => window.__seeding);
    h.expect(!ready && seeding.art && !seeding.stories, 'the baseline was ready before the stories opened');
    await page.evaluate(() => window.__open.release());
    const saved = await readying;
    h.expect((await page.evaluate((n) => window.__open.asked.filter((x) => x === n).length, held)) === 2, 'the stories were opened by more than the app and one snapshot');
    const before = await storage(page);
    await h.openSettings(page);
    await waitKeep(h, page, 'unsupported');
    await unchanged(h, page, before, 'held-open');
    h.expect(early !== (await storage(page)), 'a baseline taken as soon as Home showed still matched once the stories opened');
    for (const [db, store, id] of [[held, 'chapters', saved.chapter], [`${h.SAVE}.art`, 'strokes', saved.drawing]]) {
      const base = await storage(page);
      await page.evaluate(plant, [db, store, id]);
      const caught = await unchanged(h, page, base, `planted-${store}`).then(() => '', (e) => e.message);
      h.expect(caught === `planted-${store} changed the saved game or choices`, `a changed ${store} value went unnoticed`);
    }
    localOnly(h, requests);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { simulated: "the app's first open of the stories held until after Home showed; StorageManager methods removed; one story page and one drawing changed after a baseline" };
  },

  async 'keeps-rejections (simulated)'(h) {
    const { ctx, page, errors, requests } = await openKeep(h, { granted: false, persisted: 'reject', persist: ['reject'] });
    await h.reachHub(page);
    await h.sleep(800);
    h.expect((await asks(page)) === 0, 'boot asked although the read failed');
    const before = await storage(page);
    await h.openSettings(page);
    await waitKeep(h, page, 'failed');
    const text = await copyOf(page);
    h.expect(/didn.t answer just now/.test(text) && /saves are still here/.test(text) && !/hasn.t agreed|didn.t agree/.test(text), 'a failed check reads as not kept: ' + text);
    noOverpromise(h, text);
    h.expect(await askBtn(page).isEnabled(), 'the ask button is missing after a failed check');
    await askBtn(page).click();
    await page.waitForFunction(() => window.__keep.calls.includes('persist'), null, { timeout: 5000 });
    await page.locator('.dq-keep-ask:not([aria-busy])').waitFor({ timeout: 10000 });
    await waitKeep(h, page, 'failed');
    await tune(page, { persisted: 'answer' });
    await askBtn(page).click();
    await waitKeep(h, page, 'not-granted');
    await tune(page, { persist: [{ give: false, then: 'reject' }] });
    await askBtn(page).click();
    await waitKeep(h, page, 'refused');
    await tune(page, { persist: [{ give: true, then: 'reject' }] });
    await askBtn(page).click();
    await waitKeep(h, page, 'granted');
    h.expect((await asks(page)) === 4, `four taps asked ${await asks(page)} times`);
    await unchanged(h, page, before, 'rejections');
    localOnly(h, requests);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { simulated: 'persisted() rejects; persist() rejects with and without a working re-read; a no and a yes whose re-read rejects' };
  },

  async 'keeps-slow-answers (simulated)'(h) {
    const { ctx, page, errors, requests } = await openKeep(h, { granted: false, persisted: 1500, persist: [false, { ms: 2500, give: true }] });
    await bootDone(h, page, true);
    const atBoot = await asks(page);
    const before = await storage(page);
    await h.openSettings(page);
    h.expect((await stateOf(page)) === 'checking', 'the slow check does not show it is checking');
    h.expect(!(await askBtn(page).isVisible()), 'the ask button shows before the browser answered');
    await page.locator('.dq-panel', { has: keep(page) }).screenshot({ path: path.join(h.out, 'keep-checking-phone.png') });
    await page.locator('.dq-back').click();
    await h.sleep(2500);
    await h.reachHub(page);
    h.expect(!(await keep(page).count()), 'a late answer landed in a page that was left');
    await tune(page, { persisted: 0 });
    await h.openSettings(page);
    await waitKeep(h, page, 'not-granted');
    await askBtn(page).click();
    await page.locator('.dq-back').click();
    await h.openSettings(page);
    await page.locator('.dq-keep-ask[aria-busy="true"]').waitFor({ timeout: 2000 });
    h.expect((await page.locator('.dq-keep-ask').isDisabled()) && (await asks(page)) === atBoot + 1, 'reopened Settings asked again or lost the waiting request');
    await waitKeep(h, page, 'granted');
    h.expect((await asks(page)) === atBoot + 1, 'the request was repeated');
    await tune(page, { granted: false, persist: [{ ms: 2500, give: true }] });
    await comeBack(page);
    await waitKeep(h, page, 'not-granted');
    await askBtn(page).click();
    await page.locator('.dq-top .dq-safe').click();
    await page.getByText('Talk to someone now').first().waitFor({ timeout: 5000 });
    await h.sleep(3200);
    h.expect(!(await keep(page).count()) && (await page.getByText('Talk to someone now').first().isVisible()), 'a late answer landed in the Safe Zone');
    await page.locator('.dq-back').click();
    await h.openSettings(page);
    await waitKeep(h, page, 'granted');
    h.expect((await asks(page)) === atBoot + 2, 'the request from before the Safe Zone was repeated');
    await tune(page, { persisted: 'hang' });
    await page.locator('.dq-back').click();
    await h.openSettings(page);
    await waitKeep(h, page, 'failed', 12000);
    await unchanged(h, page, before, 'slow-answers');
    localOnly(h, requests);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { simulated: 'persisted() after 1.5 s, persist() after 2.5 s (left via Lantern and via the Safe Zone), then persisted() never answers' };
  },

  async 'keeps-rechecks-on-return (simulated)'(h) {
    const { ctx, page, errors, requests } = await openKeep(h, { granted: false, persist: [false] });
    await bootDone(h, page, true);
    const before = await storage(page);
    await h.openSettings(page);
    await waitKeep(h, page, 'not-granted');
    const atOpen = await asks(page);
    await tune(page, { granted: true });
    await comeBack(page);
    await waitKeep(h, page, 'granted');
    await tune(page, { granted: false });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await waitKeep(h, page, 'not-granted');
    h.expect((await asks(page)) === atOpen, 'coming back asked the browser');
    await unchanged(h, page, before, 'rechecks');
    localOnly(h, requests);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { simulated: 'the decision flips to yes, then back to no, while the page is away' };
  },

  async 'keeps-boot-request-shared (simulated)'(h) {
    const { ctx, page, errors, requests } = await openKeep(h, { granted: false, holds: ['persist'] });
    await h.reachHub(page);
    await bootAsked(page, 'persist');
    const before = await storage(page);
    await h.openSettings(page);
    await panelReady(page);
    await tapHard(page);
    await h.sleep(400);
    let n = await asking(page);
    h.expect(n.asks === 1 && n.most === 1, `with the boot request out, a tap asked again (${n.asks} requests, ${n.most} at once)`);
    await stillAsking(h, page, 'first open');
    await page.locator('.dq-panel', { has: keep(page) }).screenshot({ path: path.join(h.out, 'keep-boot-asking-phone.png') });
    await page.locator('.dq-back').click();
    await h.openSettings(page);
    await panelReady(page);
    await stillAsking(h, page, 'reopen');
    await comeBack(page);
    await h.sleep(400);
    await stillAsking(h, page, 'return');
    await tapHard(page);
    await h.sleep(400);
    n = await asking(page);
    h.expect(n.asks === 1 && n.most === 1, `reopening or coming back asked again (${n.asks} requests, ${n.most} at once)`);
    await page.evaluate(() => (window.__sameLoad = true));
    const from = (await calls(page)).length;
    await release(page, 'persist', true);
    await waitKeep(h, page, 'granted');
    const after = (await calls(page)).slice(from);
    h.expect(after.includes('persisted') && !after.includes('persist'), 'the yes was shown without reading the decision again: ' + JSON.stringify(after));
    h.expect(await page.evaluate(() => window.__sameLoad === true), 'the page reloaded to show the yes');
    h.expect(await page.evaluate(() => navigator.storage.persisted()), 'the simulated browser does not keep the saves after the yes');
    const text = await copyOf(page);
    h.expect(/agreed to keep these saves/.test(text), 'the granted copy is wrong: ' + text);
    h.expect(!(await askBtn(page).isVisible()) && (await crystalBtn(page).isVisible()), 'the ask button stays or the Save Crystal button is missing after the yes');
    h.expect((await asks(page)) === 1, 'the yes asked again');
    await unchanged(h, page, before, 'boot-request');
    localOnly(h, requests);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { simulated: 'the boot persist() held open across Settings open, leave, reopen, return and taps, then a yes' };
  },

  async 'keeps-boot-request-no (simulated)'(h) {
    for (const away of [false, true]) {
      const { ctx, page, errors, requests } = await openKeep(h, { granted: false, holds: ['persist'] });
      await h.reachHub(page);
      await bootAsked(page, 'persist');
      const before = await storage(page);
      await h.openSettings(page);
      await panelReady(page);
      await stillAsking(h, page, away ? 'before the Safe Zone' : 'open');
      if (!away) {
        await release(page, 'persist', false);
        await waitKeep(h, page, 'refused');
        const text = await copyOf(page);
        h.expect(/didn.t agree this time/.test(text) && /saves are still here/.test(text) && /Save Crystal keeps a copy/.test(text), 'the boot no reads wrong: ' + text);
        h.expect((await askBtn(page).isEnabled()) && (await crystalBtn(page).isVisible()), 'the ask or Save Crystal button is missing after the boot no');
        await askBtn(page).click();
        await page.waitForFunction(() => window.__keep.calls.filter((c) => c === 'persist').length === 2, null, { timeout: 5000 });
        await page.locator('.dq-keep-ask:not([aria-busy])').waitFor({ timeout: 10000 });
        await waitKeep(h, page, 'refused');
      } else {
        await page.locator('.dq-top .dq-safe').click();
        await page.getByText('Talk to someone now').first().waitFor({ timeout: 5000 });
        const toast = await page.locator('.dq-toast').innerText();
        await release(page, 'persist', 'reject');
        await h.sleep(1200);
        h.expect(!(await keep(page).count()) && (await page.getByText('Talk to someone now').first().isVisible()), 'the boot answer landed in the Safe Zone');
        h.expect((await page.locator('.dq-toast').innerText()) === toast, 'the boot answer raised a toast in the Safe Zone');
        await page.locator('.dq-back').click();
        await h.openSettings(page);
        await waitKeep(h, page, 'not-granted');
        h.expect(await askBtn(page).isEnabled(), 'the ask button is missing after the boot request failed');
      }
      const n = await asking(page);
      h.expect(n.asks === (away ? 1 : 2) && n.most === 1, `asked ${n.asks} times, ${n.most} at once`);
      await unchanged(h, page, before, away ? 'boot-reject-safe-zone' : 'boot-no');
      localOnly(h, requests);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    return { simulated: 'the boot persist() held, then no with Settings open; held, then rejected while the player is in the Safe Zone' };
  },

  async 'keeps-boot-read-overlap (simulated)'(h) {
    for (const answered of [false, true]) {
      const { ctx, page, errors, requests } = await openKeep(h, { granted: false, holds: answered ? ['persisted'] : ['persisted', 'persist'] });
      await h.reachHub(page);
      await bootAsked(page, 'persisted');
      const before = await storage(page);
      await h.openSettings(page);
      await waitKeep(h, page, 'not-granted');
      h.expect((await asks(page)) === 0, 'the boot request asked before its own read answered');
      await askBtn(page).click();
      if (answered) await waitKeep(h, page, 'refused');
      else await stillAsking(h, page, 'tap');
      await release(page, 'persisted');
      await h.sleep(800);
      const n = await asking(page);
      h.expect(n.asks === 1 && n.most === 1, `the boot request asked again after the tap (${n.asks} requests, ${n.most} at once)`);
      if (answered) {
        h.expect((await stateOf(page)) === 'refused' && (await askBtn(page).isEnabled()), 'the boot request disturbed the answer the tap got');
      } else {
        await stillAsking(h, page, 'boot read answered');
        await release(page, 'persist', true);
        await waitKeep(h, page, 'granted');
        h.expect((await asks(page)) === 1, 'the yes asked again');
      }
      await unchanged(h, page, before, answered ? 'boot-read-after-answer' : 'boot-read-during-ask');
      localOnly(h, requests);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    return { simulated: "the boot persisted() read held while a tap asks; released once with the tap's request still out and once after its no" };
  },

  async 'keeps-answer-read-held (simulated)'(h) {
    for (const way of ['return', 'reopen']) {
      const { ctx, page, errors, requests } = await openKeep(h, { granted: false, persist: [false] });
      await bootDone(h, page, true);
      const before = await storage(page);
      await h.openSettings(page);
      await waitKeep(h, page, 'not-granted');
      const at = await holdAnswerRead(h, page);
      const read = await reads(page);
      if (way === 'return') {
        await comeBack(page);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      } else {
        await page.locator('.dq-back').click();
        await h.openSettings(page);
        await panelReady(page);
      }
      await h.sleep(400);
      await stillAsking(h, page, way);
      await page.locator('.dq-panel', { has: keep(page) }).screenshot({ path: path.join(h.out, `keep-answer-read-${way}-phone.png`) });
      await tapHard(page);
      await h.sleep(400);
      let n = await asking(page);
      const extra = (await reads(page)) - read;
      h.expect(n.asks === at + 1 && n.most === 1 && extra === 0, `${way}: asked or read again before the first answer was read (${n.asks - at} requests, ${n.most} at once, ${extra} extra reads)`);
      await release(page, 'persisted', false);
      await waitKeep(h, page, 'refused');
      await h.sleep(400);
      h.expect((await stateOf(page)) === 'refused' && (await askBtn(page).isEnabled()), `${way}: the no did not stay or the ask button is gone`);
      const text = await copyOf(page);
      h.expect(/didn.t agree this time/.test(text) && /saves are still here/.test(text) && /Save Crystal keeps a copy/.test(text), `${way}: the no reads wrong: ` + text);
      await askBtn(page).click();
      await page.waitForFunction((x) => window.__keep.calls.filter((c) => c === 'persist').length === x, at + 2, { timeout: 5000 });
      await page.locator('.dq-keep-ask:not([aria-busy])').waitFor({ timeout: 10000 });
      await waitKeep(h, page, 'refused');
      n = await asking(page);
      h.expect(n.asks === at + 2 && n.most === 1, `${way}: the tap after the no asked ${n.asks - at - 1} times, ${n.most} at once`);
      await unchanged(h, page, before, `answer-read-${way}`);
      localOnly(h, requests);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    return { simulated: "a tap's persist() said no, then its persisted() read was held across a return (visibility and bfcache) or a leave and reopen, then answered no" };
  },

  async 'keeps-answer-read-late (simulated)'(h) {
    for (const way of ['safe-zone', 'newer', 'reject']) {
      const { ctx, page, errors, requests } = await openKeep(h, { granted: false, persist: [false] });
      await bootDone(h, page, true);
      const before = await storage(page);
      await h.openSettings(page);
      await waitKeep(h, page, 'not-granted');
      const at = await holdAnswerRead(h, page);
      const read = await reads(page);
      if (way === 'safe-zone') {
        await page.locator('.dq-top .dq-safe').click();
        await page.getByText('Talk to someone now').first().waitFor({ timeout: 5000 });
        const toast = await page.locator('.dq-toast').innerText();
        await comeBack(page);
        await release(page, 'persisted', false);
        await h.sleep(1200);
        h.expect(!(await keep(page).count()) && (await page.getByText('Talk to someone now').first().isVisible()), 'the answer landed in the Safe Zone');
        h.expect((await page.locator('.dq-toast').innerText()) === toast, 'the answer raised a toast in the Safe Zone');
        h.expect((await reads(page)) === read, 'Settings read the decision again after it was left');
        await page.locator('.dq-back').click();
        await h.openSettings(page);
        await waitKeep(h, page, 'not-granted');
      } else {
        if (way === 'newer') await tune(page, { granted: true });
        await comeBack(page);
        await h.sleep(400);
        await stillAsking(h, page, `${way} return`);
        h.expect((await reads(page)) === read, `${way}: coming back read the decision before the first answer was read`);
        await release(page, 'persisted', way === 'newer' ? false : 'reject');
        await waitKeep(h, page, way === 'newer' ? 'granted' : 'refused');
        await h.sleep(400);
      }
      if (way === 'newer') {
        const text = await copyOf(page);
        h.expect((await stateOf(page)) === 'granted' && /agreed to keep these saves/.test(text), 'the older no replaced the newer yes: ' + text);
        h.expect(!(await askBtn(page).isVisible()) && (await crystalBtn(page).isVisible()), 'the ask button stays or the Save Crystal button is missing after the newer yes');
        h.expect((await asks(page)) === at + 1, 'the newer yes asked again');
      } else {
        h.expect((await stateOf(page)) === (way === 'reject' ? 'refused' : 'not-granted') && (await askBtn(page).isEnabled()), `${way}: the status or the ask button is wrong after the answer`);
        await askBtn(page).click();
        await page.waitForFunction((x) => window.__keep.calls.filter((c) => c === 'persist').length === x, at + 2, { timeout: 5000 });
        await page.locator('.dq-keep-ask:not([aria-busy])').waitFor({ timeout: 10000 });
        await waitKeep(h, page, 'refused');
      }
      const n = await asking(page);
      h.expect(n.asks === at + (way === 'newer' ? 1 : 2) && n.most === 1, `${way}: asked ${n.asks - at} times, ${n.most} at once`);
      await unchanged(h, page, before, `answer-read-${way}`);
      localOnly(h, requests);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    return { simulated: "a tap's persist() said no, then its persisted() read was held while the player went to the Safe Zone, while the decision turned to yes, and before the read failed" };
  },

  async 'keeps-fit (simulated)'(h) {
    const shots = [];
    const look = async (page, state, size) => {
      const panel = page.locator('.dq-panel', { has: keep(page) });
      if (state === 'asking') await page.locator('.dq-keep-ask[aria-busy="true"]').waitFor({ timeout: 2000 });
      else await waitKeep(h, page, state);
      await page.evaluate(() => {
        const k = document.querySelector('.dq-keep');
        k.scrollIntoView({ block: 'start' });
        let s = k.parentElement;
        while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
        (s ?? document.scrollingElement).scrollBy(0, -((document.querySelector('.dq-top')?.getBoundingClientRect().bottom ?? 0) + 16));
      });
      await h.settled(page, '.dq-keep, .dq-keep .dq-btn');
      const fit = await panel.evaluate((p) => {
        const box = p.getBoundingClientRect();
        const bad = [...p.querySelectorAll('.dq-keep-s, .dq-btn')]
          .filter((el) => el.getClientRects().length)
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.left < box.left - 0.5 || r.right > box.right + 0.5 || el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
          })
          .map((el) => el.textContent.trim().slice(0, 40));
        return { bad, wide: document.documentElement.scrollWidth > innerWidth, right: box.right, vw: innerWidth };
      });
      h.expect(!fit.bad.length && !fit.wide && fit.right <= fit.vw, `${size} ${state}: clipped or too wide: ${JSON.stringify(fit)}`);
      const cb = await crystalBtn(page).boundingBox();
      h.expect(cb && cb.y + cb.height <= page.viewportSize().height, `${size} ${state}: the Save Crystal button is off screen under the status`);
      await page.screenshot({ path: path.join(h.out, `keep-${state}-${size}.png`) });
      shots.push(`keep-${state}-${size}`);
    };
    for (const [size, viewport] of Object.entries(SIZES)) {
      const { ctx, page, errors } = await openKeep(h, { granted: false, missing: true, persist: [false] }, { viewport });
      await h.reachHub(page);
      await h.openSettings(page);
      await look(page, 'unsupported', size);
      await tune(page, { missing: false });
      await comeBack(page);
      await look(page, 'not-granted', size);
      await tune(page, { persisted: 'reject' });
      await comeBack(page);
      await look(page, 'failed', size);
      await tune(page, { persisted: 'answer' });
      await askBtn(page).click();
      await look(page, 'refused', size);
      await tune(page, { granted: true });
      await comeBack(page);
      await look(page, 'granted', size);
      await tune(page, { granted: false, persist: [{ ms: 600000, give: false }] });
      await comeBack(page);
      await waitKeep(h, page, 'not-granted');
      await askBtn(page).click();
      await look(page, 'asking', size);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    return { simulated: 'each status set by the simulated browser', shots };
  },
};
