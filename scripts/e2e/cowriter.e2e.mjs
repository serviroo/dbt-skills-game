import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOISE = /WebGL|GPU stall|AudioContext|Failed to load resource|ERR_INTERNET_DISCONNECTED/i;
const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({ v: 1, events: [{ id: 'cw-visit', k: 'visit', xp: 10, t: 1, day: day() }], flags: { greetDay: day(), therapistLineShown: true } }),
  'dbt.app.v1': h.SEEN,
  'dbt.cowriter.v1': JSON.stringify({ install: 'old-install', key: 'old-key' }),
});

const TITLE = 'The Night Garden';
const STORY = 'Mira found the brass key under the garden gate. She showed it to Tobin, who only shrugged.\n"It\'s just a key," Tobin said.\nBut Mira kept the key in her pocket all day, and that night the garden began to glow';
const FROM_STORY = /Mira|Tobin|key|gate|garden|pocket|brass/;

async function lines(h) {
  return (h.shared.cwLines ??= (async () => {
    const code = await (await fetch(h.server.url + '/src/content/cowriter-lines.ts')).text();
    return import('data:text/javascript,' + encodeURIComponent(code));
  })());
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plain = (s) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const fits = (card, set) => set.some((t) => new RegExp('^' + esc(plain(t)).replace(/\\\{(?:who2|who|it|line|title)\\\}/g, '.+') + '$', 's').test(plain(card)));

async function openCtx(h, { url = h.server.url + '/', viewport = { width: 390, height: 844 }, sw = false, video = false } = {}) {
  const ctx = await h.browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: sw ? 'allow' : 'block', ...(video ? { recordVideo: { dir: path.join(h.out, 'video'), size: viewport } } : {}) });
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed(h));
  const reqs = [];
  ctx.on('request', (r) => reqs.push({ method: r.method(), url: r.url() }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !NOISE.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
  await page.goto(url + '?mute');
  return { ctx, page, errors, reqs, origin: new URL(url).origin };
}

function onlyOwnGets(h, { reqs, origin }, label) {
  const web = reqs.filter((r) => /^https?:/.test(r.url));
  const bad = web.filter((r) => r.method !== 'GET' || new URL(r.url).origin !== origin || /\/api\//.test(new URL(r.url).pathname));
  h.expect(web.length > 0, `${label}: no requests were recorded at all`);
  h.expect(!bad.length, `${label}: requests left the page: ${JSON.stringify(bad.slice(0, 5))}`);
  return web.length;
}

const ta = (page) => page.locator('.st-write .st-ta');
async function newStory(h, page, { viaHome = true } = {}) {
  if (viaHome) {
    await h.reachHub(page);
    await page.locator('.dq-tile--story').click();
  } else {
    await page.waitForFunction(() => !!window.__daily);
    await page.evaluate(() => window.__daily.go({ name: 'stories' }, { quiet: true }));
  }
  await page.locator('.st-shelf > *').first().waitFor();
  await page.locator('.st-shelfpage button:visible', { hasText: 'New story' }).first().click();
  await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
}
async function write(page, title, text) {
  await page.locator('.st-write .st-title').fill(title);
  await ta(page).fill(text);
}
const caretAt = (page, start, end = start) =>
  ta(page).evaluate((el, [s, e]) => {
    el.focus();
    el.setSelectionRange(s, e);
    el.dispatchEvent(new Event('select'));
  }, [start, end]);

async function openCw(h, page) {
  if (await page.evaluate(() => matchMedia('(min-width: 1100px)').matches)) return;
  if (await page.locator('.st-cw.is-open').count()) return;
  const btn = page.locator('.st-cwbtn');
  if (!(await btn.isVisible())) await h.shot(page, 'cowriter-before-no-ask');
  h.expect(await btn.isVisible(), 'There is no Co-writer button on the page, so Ask can’t be opened.');
  await btn.click();
  await page.locator('.st-cw.is-open').waitFor();
  h.expect((await btn.getAttribute('aria-expanded')) === 'true', 'The Co-writer button does not say the panel is open.');
}
const newest = (page) => page.locator('.st-cards > .st-batch:first-child .st-card');
async function ask(h, page, mode, steer = '') {
  await openCw(h, page);
  await page.locator(`.st-cw .st-mode--${mode}`).click();
  await page.locator('.st-cw .st-steer').fill(steer);
  const prev = await newest(page).first().getAttribute('data-id', { timeout: 500 }).catch(() => null);
  await page.locator('.st-cw .st-ask').click();
  await page.waitForFunction((p) => {
    const id = document.querySelector('.st-cards > .st-batch:first-child .st-card')?.getAttribute('data-id');
    return id && id !== p && !document.querySelector('.st-cw .st-ask').disabled;
  }, prev, { timeout: 10000 });
  const cards = await newest(page).locator('.st-card-t').allTextContents();
  h.expect(cards.length > 0 && cards.every((c) => c.trim()), `${mode}: Ask came back without cards: ${JSON.stringify(cards)}`);
  return cards;
}
async function notesText(page) {
  await page.locator('.st-write .st-seg .dq-seg-b', { hasText: 'Notes' }).click();
  await page.getByRole('textbox', { name: 'Notes for this story', exact: true }).waitFor();
  const text = await ta(page).inputValue();
  await page.locator('.st-write .st-seg .dq-seg-b', { hasText: 'Page' }).click();
  await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
  return text;
}

async function production(h) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-e2e-cw-'));
  process.once('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (args, env = {}) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    return { child, log: () => log };
  };
  const build = run([path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', path.join(dir, 'dist'), '--emptyOutDir', '--logLevel', 'warn'], { BASE_PATH: '/dbt-skills-game/' });
  const code = await new Promise((res) => build.child.once('exit', res));
  if (code !== 0) throw new Error('production build failed:\n' + build.log().slice(-2000));
  const srv = run([path.join(root, 'scripts/serve-static.mjs'), `--dir=${path.join(dir, 'dist')}`, '--base=/dbt-skills-game/', '--host=127.0.0.1', '--port=0']);
  const stop = () => new Promise((res) => {
    if (srv.child.exitCode !== null || srv.child.signalCode !== null) return res();
    const timer = setTimeout(() => srv.child.kill('SIGKILL'), 5000);
    srv.child.once('exit', () => (clearTimeout(timer), res()));
    srv.child.kill('SIGTERM');
  });
  for (let i = 0; i < 100; i++) {
    const m = /at (http:\/\/\S+\/dbt-skills-game\/)/.exec(srv.log());
    if (m) return { url: m[1], stop };
    if (srv.child.exitCode !== null) break;
    await h.sleep(100);
  }
  await stop();
  throw new Error('serve-static did not start:\n' + srv.log());
}

export const scenarios = {
  async 'cowriter-card-edits'(h) {
    const s = await openCtx(h);
    const { page } = s;
    await newStory(h, page);
    await write(page, TITLE, STORY);
    await ask(h, page, 'questions');
    const card = newest(page).first();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = card.locator('.st-card-edit');
    const text = 'Mira '.repeat(239) + 'Mira.';
    await edit.fill(text);
    await edit.press('End');
    await edit.pressSequentially(' more');
    h.expect((await edit.inputValue()) === text, 'Editing a card accepted text that would be cut on save.');
    await card.getByRole('button', { name: 'Done', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__daily.go({ name: 'stories' }, { quiet: true }));
    await page.locator('.st-row', { hasText: TITLE }).click();
    await page.getByRole('textbox', { name: /^Page,/ }).waitFor();
    await openCw(h, page);
    h.expect((await newest(page).first().locator('.st-card-t').textContent()) === text, 'Reopening a story lost the edited card.');
    onlyOwnGets(h, s, 'edited card');
  },

  async 'cowriter-four-modes'(h) {
    const L = await lines(h);
    const s = await openCtx(h);
    const { page, ctx } = s;
    await newStory(h, page);
    h.expect((await h.ls(page, 'dbt.cowriter.v1')) === seed(h)['dbt.cowriter.v1'], 'Ask changed legacy stored data.');
    await write(page, TITLE, STORY);
    await ctx.setOffline(true);
    await caretAt(page, STORY.length);
    const out = {};

    const q1 = await ask(h, page, 'questions');
    h.expect(q1.length === 3 && q1.every((c) => fits(c, Object.values(L.COWRITER_QUESTIONS).flat())), 'Questions are not three scripted questions: ' + JSON.stringify(q1));
    h.expect(q1.some((c) => /Mira|Tobin/.test(c)), 'No question names a character from the story: ' + JSON.stringify(q1));
    const q2 = await ask(h, page, 'questions');
    h.expect(q2.length === 3 && !q2.some((c) => q1.includes(c)), 'Asking again repeated a question: ' + JSON.stringify({ q1, q2 }));
    out.questions = [q1, q2];
    await h.shot(page, 'cowriter-questions-390x844');
    await newest(page).first().getByRole('button', { name: 'Answer' }).click();
    await newest(page).first().locator('.st-answer input').fill('Because it hums at night.');
    await newest(page).first().locator('.st-answer').getByRole('button', { name: 'Save' }).click();
    await newest(page).first().locator('.st-card-msg', { hasText: 'Saved to Notes.' }).waitFor();

    const w1 = await ask(h, page, 'whatif');
    h.expect(w1.length === 3 && w1.every((c) => fits(c, Object.values(L.COWRITER_WHATIFS).flat())), 'What-ifs are not three scripted lines: ' + JSON.stringify(w1));
    h.expect(w1.some((c) => FROM_STORY.test(c)), 'No what-if uses a name or thing from the story: ' + JSON.stringify(w1));
    await newest(page).first().getByRole('button', { name: 'Add to Notes' }).click();
    await newest(page).first().locator('.st-card-msg').filter({ hasText: /Notes/ }).waitFor();
    out.whatif = w1;

    const mid = await ask(h, page, 'continue');
    h.expect(mid.length === 3 && mid.every((c) => fits(c, L.COWRITER_NEXT.mid)), 'Mid-sentence starters do not carry on the sentence: ' + JSON.stringify(mid));
    await caretAt(page, STORY.indexOf('\n'));
    const end = await ask(h, page, 'continue');
    h.expect(end.length === 3 && end.every((c) => fits(c, L.COWRITER_NEXT.end)), 'Starters after a full sentence are not new sentences: ' + JSON.stringify(end));
    await caretAt(page, STORY.indexOf(',"'));
    const speech = await ask(h, page, 'continue');
    h.expect(speech.length === 3 && speech.every((c) => fits(c, L.COWRITER_NEXT.speechMid)), 'Starters inside an open quote do not finish the line: ' + JSON.stringify(speech));
    out.continue = { mid, end, speech };

    await caretAt(page, STORY.length);
    const talk = await ask(h, page, 'continue', 'more dialogue');
    h.expect(talk.every((c) => fits(c, L.COWRITER_NEXT.talkMid)), '"more dialogue" did not bring dialogue: ' + JSON.stringify(talk));
    const short = await ask(h, page, 'continue', 'shorter');
    h.expect(short.every((c) => fits(c, L.COWRITER_NEXT.shortMid)), '"shorter" did not bring short starters: ' + JSON.stringify(short));
    const spooky = await ask(h, page, 'whatif', 'spookier');
    h.expect(spooky.every((c) => fits(c, L.COWRITER_WHATIFS.spooky)), '"spookier" did not bring spooky what-ifs: ' + JSON.stringify(spooky));
    out.steer = { talk, short, spooky };
    const all = [...q1, ...q2, ...w1, ...mid, ...end, ...speech, ...talk, ...short, ...spooky];
    h.expect(!all.some((c) => /\{|\}|undefined|the began/.test(c)), 'A card has an unfilled slot or a verb as a thing: ' + JSON.stringify(all));

    await caretAt(page, STORY.length);
    const ins = await ask(h, page, 'continue');
    await newest(page).first().getByRole('button', { name: 'Insert' }).click();
    await page.waitForFunction((want) => document.querySelector('.st-write .st-ta').value === want, STORY + ' ' + ins[0]);
    h.expect(!(await page.locator('.st-cw.is-open').count()), 'The panel stayed over the page after Insert.');

    const messy = ' the the  cat ,ran home. it was really just very dark.';
    const text = `${STORY}.\nMira smiled.${messy}\nTobin laughed.`;
    await ta(page).fill(text);
    const at = text.indexOf(messy);
    await caretAt(page, at, at + messy.length);
    const pol = await ask(h, page, 'polish');
    h.expect(JSON.stringify(pol) === JSON.stringify(['The cat, ran home. It was really just very dark.', 'The cat, ran home. It was dark.']), 'Polish did not tidy the line: ' + JSON.stringify(pol));
    await newest(page).first().getByRole('button', { name: 'Replace' }).click();
    const want = `${STORY}.\nMira smiled. The cat, ran home. It was really just very dark.\nTobin laughed.`;
    await page.waitForFunction((w) => document.querySelector('.st-write .st-ta').value === w, want).catch(async () => {
      throw new Error('Replace changed more than the selection: ' + JSON.stringify(await ta(page).inputValue()));
    });
    out.polish = pol;

    const long = 'Rain kept tapping on the roof all night. '.repeat(32).trim();
    await ta(page).fill(`${want}\n${long}`);
    await caretAt(page, want.length + 1, want.length + 1 + long.length);
    await openCw(h, page);
    await page.locator('.st-cw .st-mode--polish').click();
    const before = await page.locator('.st-card').count();
    await page.locator('.st-cw .st-ask').click();
    await page.locator('.st-cwmsg:not(.is-hidden)', { hasText: 'a lot of text at once' }).waitFor({ timeout: 5000 });
    h.expect((await page.locator('.st-card').count()) === before, 'A too-long polish still made a card.');

    const expands = 'a,'.repeat(599) + 'b';
    await page.keyboard.press('Escape');
    await ta(page).fill(expands);
    await caretAt(page, 0, expands.length);
    await openCw(h, page);
    await page.locator('.st-cw .st-ask').click();
    await page.locator('.st-cwmsg:not(.is-hidden)', { hasText: 'a lot of text at once' }).waitFor({ timeout: 5000 });
    h.expect((await page.locator('.st-card').count()) === before, 'An expanded polish still made a card that would be cut on save.');
    h.expect((await ta(page).inputValue()) === expands, 'The oversized polished line changed the page.');

    const notes = await notesText(page);
    h.expect(notes.includes(`Q: ${q2[0]}\nA: Because it hums at night.`), 'The answer did not reach Notes: ' + JSON.stringify(notes));
    h.expect(notes.includes(`• ${w1[0]}`), 'Add to Notes did not add the what-if: ' + JSON.stringify(notes));

    await newStory(h, page, { viaHome: false });
    const blankQ = await ask(h, page, 'questions');
    const blankC = await ask(h, page, 'continue');
    h.expect(blankQ.length === 3 && blankC.length === 3 && blankC.every((c) => fits(c, L.COWRITER_NEXT.start)), 'A blank page got no cards or odd starters: ' + JSON.stringify({ blankQ, blankC }));
    out.blank = { blankQ, blankC };

    out.requests = onlyOwnGets(h, s, 'four modes');
    h.expect(!s.errors.length, 'Page errors: ' + s.errors.join(' | '));
    fs.writeFileSync(path.join(h.out, 'cowriter-cards.json'), JSON.stringify(out, null, 2));
    return { requests: out.requests };
  },

  async 'cowriter-care'(h) {
    const L = await lines(h);
    const s = await openCtx(h);
    const { page } = s;
    await newStory(h, page);
    const text = 'Tobin said he didn’t want to be here anymore. Mira sat with him by the old bridge and held the rope swing.';
    await write(page, 'By the bridge', text);
    await s.ctx.setOffline(true);
    await caretAt(page, text.length);
    const echo = /want to be here|anymore|bridge|rope|swing/i;
    const cards = [];
    for (const mode of ['questions', 'whatif', 'continue']) {
      const got = await ask(h, page, mode);
      h.expect(!got.some((c) => echo.test(c) || L.COWRITER_NEVER.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(c))), `${mode} cards echo the story's crisis or means words: ` + JSON.stringify(got));
      cards.push(...got);
      if (mode === 'questions') {
        await page.locator('.st-cw .st-care').waitFor({ timeout: 5000 });
        await h.shot(page, 'cowriter-care-390x844');
      }
    }
    h.expect((await page.locator('.st-cw .st-care').count()) === 1, 'The Safe Zone note showed more than once.');
    await page.locator('.st-cw .st-care').getByRole('button', { name: 'Safe Zone' }).click();
    await page.waitForFunction(() => window.__daily?.route?.name === 'safe' || !!document.querySelector('.dq-safe-page, [data-route="safe"], .sz'), null, { timeout: 5000 }).catch(() => {});
    const route = await page.evaluate(() => window.__daily?.route?.name);
    h.expect(route === 'safe', 'The care note’s Safe Zone button did not open the Safe Zone: ' + route);
    onlyOwnGets(h, s, 'care');
    h.expect(!s.errors.length, 'Page errors: ' + s.errors.join(' | '));
    return { cards };
  },

  async 'cowriter-same-cards'(h) {
    const got = [];
    for (let i = 0; i < 2; i++) {
      const s = await openCtx(h);
      await newStory(h, s.page);
      await write(s.page, TITLE, STORY);
      await caretAt(s.page, STORY.length);
      got.push({ whatif: await ask(h, s.page, 'whatif'), questions: await ask(h, s.page, 'questions') });
      onlyOwnGets(h, s, 'same cards ' + i);
      await s.ctx.close();
    }
    h.expect(JSON.stringify(got[0]) === JSON.stringify(got[1]), 'The same story gave different cards: ' + JSON.stringify(got));
    return got[0];
  },

  async 'cowriter-panel-sizes'(h) {
    const sizes = [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 844, height: 390 },
      { width: 1280, height: 800 },
    ];
    const result = [];
    for (const viewport of sizes) {
      const tag = `${viewport.width}x${viewport.height}`;
      const s = await openCtx(h, { viewport, video: !!h.flags.media && viewport.width === 390 });
      const { page } = s;
      await newStory(h, page);
      await write(page, TITLE, STORY);
      await caretAt(page, STORY.length);
      const wide = viewport.width >= 1100;
      if (wide) {
        h.expect(await page.locator('.st-cw').isVisible(), `${tag}: the co-writer column is not on the page.`);
        h.expect(!(await page.locator('.st-cwbtn').isVisible()), `${tag}: the Co-writer button shows next to the open column.`);
        const [m, c] = await Promise.all([page.locator('.st-main').boundingBox(), page.locator('.st-cw').boundingBox()]);
        h.expect(c.x >= m.x + m.width - 1, `${tag}: the co-writer column overlaps the page.`);
      } else await openCw(h, page);
      const cards = await ask(h, page, 'questions');
      await newest(page).first().scrollIntoViewIfNeeded();
      await h.shot(page, `cowriter-${tag}`);
      const fit = await page.evaluate(() => {
        const cw = document.querySelector('.st-cw').getBoundingClientRect();
        const ask = document.querySelector('.st-cw .st-ask').getBoundingClientRect();
        return { overflow: document.scrollingElement.scrollWidth > innerWidth + 1, left: cw.left, right: cw.right, w: innerWidth, askW: ask.width, askH: ask.height };
      });
      h.expect(!fit.overflow && fit.left >= -1 && fit.right <= fit.w + 1, `${tag}: the panel runs off the screen: ` + JSON.stringify(fit));
      h.expect(fit.askH >= 44, `${tag}: Ask is too small to tap: ` + JSON.stringify(fit));
      if (!wide) {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.st-cw.is-open'));
        h.expect((await page.locator('.st-cwbtn').getAttribute('aria-expanded')) === 'false', `${tag}: closing did not reset the Co-writer button.`);
      }
      onlyOwnGets(h, s, tag);
      h.expect(!s.errors.length, `${tag}: page errors: ` + s.errors.join(' | '));
      result.push({ tag, cards: cards.length, ...fit });
      await s.ctx.close();
    }
    return result;
  },

  async 'cowriter-production-offline'(h) {
    const L = await lines(h);
    const srv = await production(h);
    try {
      const s = await openCtx(h, { url: srv.url, sw: true });
      const { page, ctx } = s;
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
      await page.evaluate(() => navigator.serviceWorker.ready);
      for (let i = 0; i < 50 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await h.sleep(200);
      h.expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'The service worker never took over the page.');
      await ctx.setOffline(true);
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
      await newStory(h, page);
      h.expect((await h.ls(page, 'dbt.cowriter.v1')) === seed(h)['dbt.cowriter.v1'], 'Ask changed legacy stored data.');
      await write(page, TITLE, STORY);
      await caretAt(page, STORY.length);
      const q = await ask(h, page, 'questions');
      h.expect(q.some((c) => /Mira|Tobin/.test(c)), 'No question names a character: ' + JSON.stringify(q));
      const w = await ask(h, page, 'whatif');
      h.expect(w.every((c) => fits(c, Object.values(L.COWRITER_WHATIFS).flat())), 'What-ifs are not scripted lines: ' + JSON.stringify(w));
      const c = await ask(h, page, 'continue');
      await newest(page).first().getByRole('button', { name: 'Insert' }).click();
      await page.waitForFunction((want) => document.querySelector('.st-write .st-ta').value === want, STORY + ' ' + c[0]);
      const line = '\nthe the  cat ,ran home.';
      const text = (await ta(page).inputValue()) + line;
      await ta(page).fill(text);
      await caretAt(page, text.length - line.length + 1, text.length);
      const p = await ask(h, page, 'polish');
      h.expect(p[0] === 'The cat, ran home.', 'Polish did not tidy the line: ' + JSON.stringify(p));
      await h.shot(page, 'cowriter-production-offline');
      const n = onlyOwnGets(h, s, 'production');
      h.expect(!s.errors.length, 'Page errors: ' + s.errors.join(' | '));
      return { url: srv.url, requests: n, questions: q, whatif: w, continue: c, polish: p };
    } finally {
      await srv.stop();
    }
  },
};
