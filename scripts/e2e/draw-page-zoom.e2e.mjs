// The drawing page at 200% zoom leaves room to draw and keeps Save and every tool in reach. A phone at 320x568,
// 390x844 and 568x320, at 200% zoom (the page laid out at half the size, as browser zoom does) and at its own size,
// opens Draw today and the shadow ally page on a returning save, with Motion reduced and a mouse, and with Motion on
// and touch (each shows its own hint). On each:
//   page      the page is wholly on screen, nothing covers it, and it is at least 63x90 px at 200% (126x180 px at the
//             phone's own size: the same height on the glass)
//   reach     Save is in reach as the page opens, and every tool (inks, pens, sizes, Undo, Redo, Clear), the prompt's
//             buttons and the Safe Zone button are on screen, uncovered and at least 44x44 px, either as the page opens
//             or once the Tools button opens the tray (scrolled inside the tray, never the page), taking a tap across
//             the whole of each at 200%; at the phone's own size every tool shows at once and takes a tap in its
//             middle, as before
//   sideways  nothing scrolls sideways, and the page never scrolls to show a tool
//   hint      the page's hint is at least 16 px (DESIGN.md's body text), stays on the page and overlaps no button
// Then a pen, an ink and a size are picked from wherever they are, a line is drawn with them, and Save keeps it on
// Draw today and asks for the ally's name on the shadow ally page. The note after Save shows whole over the page's
// room, at body size, never under the top bar; at 200% a tap on its words puts it away for the next line. Last, a line
// begun at 390x844 goes on while the phone zooms to 200%: what was drawn stays and the rest lands under the pointer.
// Back with the tray open closes only the tray, and as the tools unfold again focus on Tools moves to the ink. What is
// kept is read from the device's storage, as a reload would read it: the line as drawn is there as a draft before
// anything is tapped, and as a page after Save. On a wide screen (760x700) the note shows whole as it comes in the
// tools beside the page, and as the screen turns wide under a note shown over the page; once another line clears it,
// the tools lie as they do without it. With no room for the page at all (320x340 at 200%) none of it shows, and with
// little (360x364 at 200%, a page a few pixels high) its hint shows only whole on it; either way the note and the tray
// show a line or more on screen, beside the Tools button, which closes the tray however it opened. On the shadow ally
// page at 320x568 and 390x844, at 200% and at the phone's own size, the message after Save card image reads at body size
// in a room of its own, over the rise's backdrop and clear of every button.
import { boot, settle } from './layout-fit.e2e.mjs';

const PHONES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
];
const MIN_TAP = 44;
const MIN_PAGE = 180;
const MIN_TEXT = 16;
const CONTROLS = '.dq-swatch, .dq-pen, .dq-size, .dq-tools .dq-tool, .dq-save, .dq-prompt button, .dq-top .dq-safe';

/**
 * What a reload would find on this device: the drafts of new pages and every saved page, read from IndexedDB itself
 * (never the art store's copy in memory) and cleaned as the art store reads them back, as each matches the strokes on
 * the drawing page when kept whole; and those strokes (`drawn`). Strokes come as JSON with their keys in order.
 */
const stored = (page) =>
  page.evaluate(async () => {
    const { artStore, cleanDraft, cleanStrokes } = await import('/src/daily/artstore.ts');
    const db = await new Promise((ok, bad) => Object.assign(indexedDB.open(artStore(window.__daily.store.key).name), { onsuccess: (e) => ok(e.target.result), onerror: bad }));
    const read = (store, how) => new Promise((ok, bad) => Object.assign(db.transaction(store).objectStore(store)[how](), { onsuccess: (e) => ok(e.target.result), onerror: bad }));
    const [drafts, metas, ids, strokes] = await Promise.all([read('drafts', 'getAll'), read('meta', 'getAll'), read('strokes', 'getAllKeys'), read('strokes', 'getAll')]);
    db.close();
    const json = (s) => JSON.stringify(s ?? null, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
    return {
      drafts: drafts.map(cleanDraft).filter((d) => d && !d.editId).map((d) => ({ kind: d.kind, strokes: json(d.strokes) })),
      pages: metas.map((m) => ({ id: m.id, strokes: json(cleanStrokes(strokes[ids.indexOf(m.id)], m.kind)) })),
      drawn: json(window.__daily.ink?.strokes),
    };
  });

/**
 * What keeps the note after a save from showing whole: reaching past its room (the page's, over the page; the drawing
 * page's, in a wide screen's tools) or under the top bar, being covered, words cut off with no way to scroll to them,
 * words under body size, or a link of its, or Save, out of a tap.
 */
const noteShown = (page) =>
  page.evaluate((MIN_TEXT) => {
    const bad = [];
    const m = document.querySelector('.dq-tools-msg');
    const r = m.getBoundingClientRect();
    const over = getComputedStyle(m).position === 'absolute';
    const room = document.querySelector(over ? '.dq-draw-fit' : '.dq-draw').getBoundingClientRect();
    const at = `${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)}`;
    if (r.top < document.querySelector('.dq-top').getBoundingClientRect().bottom - 0.5) bad.push(`the note after Save reaches under the top bar (${at})`);
    if (r.top < room.top - 0.5 || r.bottom > Math.min(room.bottom, innerHeight) + 0.5 || r.left < room.left - 0.5 || r.right > room.right + 0.5) bad.push(`the note after Save reaches past ${over ? "the page's room" : 'the drawing page'} (${at})`);
    else if (![[r.left + r.width / 2, r.top + 2], [r.left + r.width / 2, r.bottom - 2]].every(([x, y]) => m.contains(document.elementFromPoint(x, y)))) bad.push('something covers the note after Save');
    if (m.scrollHeight > m.clientHeight + 1 && !/auto|scroll/.test(getComputedStyle(m).overflowY)) bad.push(`the note after Save is cut off, ${m.scrollHeight} px in ${m.clientHeight}`);
    for (const e of [m, ...m.querySelectorAll('*')]) {
      if (!e.checkVisibility() || ![...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) continue;
      const px = parseFloat(getComputedStyle(e).fontSize);
      if (px < MIN_TEXT - 0.01) bad.push(`"${e.textContent.trim().slice(0, 24)}" in the note after Save is ${px} px`);
    }
    // its links, each brought into view inside it, and Save take a tap in their middle
    for (const b of [...m.querySelectorAll('button, a[href]'), document.querySelector('.dq-save')]) {
      if (m.contains(b)) {
        const q = b.getBoundingClientRect();
        m.scrollTop += q.top < r.top ? q.top - r.top - 2 : q.bottom > r.bottom ? q.bottom - r.bottom + 2 : 0;
      }
      const q = b.getBoundingClientRect();
      if (!b.contains(document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2))) bad.push(`${b.textContent.trim()} is out of a tap with the note after Save showing (${Math.round(q.left)},${Math.round(q.top)})`);
    }
    return bad;
  }, MIN_TEXT);

/**
 * What of a fresh page shows where it has little room for it, or none: with none, the page having room after all, or
 * any of it showing (its frame drew a 10 px square); with little, a hint that shows reaching past the page.
 */
const pageShown = (page, none) =>
  page.evaluate((none) => {
    const frame = document.querySelector('.dq-draw-frame');
    const f = frame.getBoundingClientRect();
    const size = `${Math.round(f.width)}x${Math.round(f.height)} px`;
    if (none) return f.width && f.height ? [`the page has room, ${size}`] : frame.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ? ['the page shows with no room for it'] : [];
    const hint = document.querySelector('.dq-draw-hint');
    if (!hint.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return [];
    const range = document.createRange();
    range.selectNodeContents(hint);
    return [...range.getClientRects()].some((l) => l.left < f.left - 0.5 || l.right > f.right + 0.5 || l.top < f.top - 0.5 || l.bottom > f.bottom + 0.5) ? [`the hint "${hint.textContent}" reaches past the ${size} page`] : [];
  }, none);

/**
 * What keeps `sel` (the note after a save, or the tray) from showing whole where the page has little room or none:
 * reaching off the screen or under the top bar (as one placed for a roomier layout would), covering the Tools button,
 * being covered, too short for a line of words, words cut off with no way to scroll to them, or, with `words`, words
 * under body size.
 */
const tightShown = (page, sel, words) =>
  page.evaluate(
    ({ sel, words, MIN_TEXT }) => {
      const bad = [];
      const e = document.querySelector(sel);
      const r = e.getBoundingClientRect();
      const at = `${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)}`;
      const b = document.querySelector('.dq-tray-b').getBoundingClientRect();
      if (r.top < document.querySelector('.dq-top').getBoundingClientRect().bottom - 0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5) bad.push(`${sel} reaches off the screen or under the top bar (${at})`);
      else if (r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom) bad.push(`${sel} covers the Tools button (${at})`);
      else if (![[r.left + r.width / 2, r.top + 2], [r.left + r.width / 2, r.bottom - 2]].every(([x, y]) => e.contains(document.elementFromPoint(x, y)))) bad.push(`something covers ${sel} (${at})`);
      const cs = getComputedStyle(e);
      if (e.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) < MIN_TEXT * 1.2) bad.push(`${sel} is too short for a line of words (${at})`);
      if (e.scrollHeight > e.clientHeight + 1 && !/auto|scroll/.test(cs.overflowY)) bad.push(`${sel} is cut off, ${e.scrollHeight} px in ${e.clientHeight}`);
      for (const t of words ? [e, ...e.querySelectorAll('*')] : []) {
        if (!t.checkVisibility() || ![...t.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) continue;
        const px = parseFloat(getComputedStyle(t).fontSize);
        if (px < MIN_TEXT - 0.01) bad.push(`"${t.textContent.trim().slice(0, 24)}" in ${sel} is ${px} px`);
      }
      return bad;
    },
    { sel, words, MIN_TEXT },
  );

/**
 * Why a tap on the Tools button doesn't close the open tray, or '' if it does: the Tools button shows whole, at least
 * 44 px and uncovered at its middle and just inside each edge, and a tap in its middle closes the tray.
 */
async function toolsCloses(page) {
  const b = await page.evaluate(() => {
    const e = document.querySelector('.dq-tray-b');
    const r = e.getBoundingClientRect();
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    const missed = [[x, y], [x, r.top + 2], [x, r.bottom - 2], [r.left + 2, y], [r.right - 2, y]].filter(([px, py]) => !e.contains(document.elementFromPoint(px, py)));
    return { x, y, w: r.width, h: r.height, open: e.getAttribute('aria-expanded') === 'true', missed: missed.length };
  });
  if (!b.open) return 'the tray did not open';
  if (b.w < MIN_TAP - 0.5 || b.h < MIN_TAP - 0.5) return `the Tools button is ${Math.round(b.w)}x${Math.round(b.h)} px`;
  if (b.missed) return `the open tray covers the Tools button at ${b.missed} of its 5 tap points`;
  await page.mouse.click(b.x, b.y);
  const shut = await page.evaluate(() => document.querySelector('.dq-tray').classList.contains('is-hidden') && document.querySelector('.dq-tray-b').getAttribute('aria-expanded') === 'false');
  return shut ? '' : 'a tap on the Tools button left the tray open';
}

/**
 * What keeps the message on the rise from reading in a room of its own once brought into view: words under body size,
 * reaching off the screen or under the top bar, anywhere along its lines anything over or under it before the rise's
 * backdrop (a button of the rise or the top bar, or the drawing page with no backdrop there), or a backdrop the drawing
 * page shows through.
 */
const riseMsgShown = (page) =>
  page.evaluate((MIN_TEXT) => {
    const bad = [];
    const m = document.querySelector('.dq-rise-msg');
    m.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const px = parseFloat(getComputedStyle(m).fontSize);
    if (px < MIN_TEXT - 0.01) bad.push(`the message is ${px} px`);
    const r = m.getBoundingClientRect();
    if (r.top < document.querySelector('.dq-top').getBoundingClientRect().bottom - 0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5) bad.push(`the message reaches off the screen or under the top bar (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`);
    const backdrop = getComputedStyle(document.querySelector('.dq-rise-bg')).backgroundColor.match(/[\d.]+/g).map(Number);
    if (backdrop.length > 3 && backdrop[3] < 1) bad.push(`the drawing page shows through the rise's backdrop (${backdrop.join(', ')})`);
    const label = (e) => e.getAttribute('aria-label') || (e.matches('button, a') ? e.textContent.trim() : `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
    const range = document.createRange();
    range.selectNodeContents(m);
    for (const l of range.getClientRects()) {
      for (const x of [l.left + 2, (l.left + l.right) / 2, l.right - 2]) {
        const y = (l.top + l.bottom) / 2;
        const stack = document.elementsFromPoint(x, y);
        const bg = stack.findIndex((e) => e.matches('.dq-rise-bg'));
        const crossed = stack.slice(0, bg < 0 ? stack.length : bg).filter((e) => !m.contains(e) && !e.contains(m));
        if (bg < 0 || crossed.length) bad.push(`at ${Math.round(x)},${Math.round(y)} the message crosses ${crossed.map(label).slice(0, 3).join(', ') || 'nothing'}${bg < 0 ? ', with no backdrop under it' : ''}`);
      }
    }
    return bad;
  }, MIN_TEXT);

/** Opens a drawing page and waits until it takes strokes. */
async function open(page, kind) {
  await page.evaluate((k) => window.__daily.go({ name: 'draw', kind: k }), kind);
  await page.waitForFunction(() => document.querySelector('.dq-ink-stage')?.inert === false, null, { timeout: 10000 });
  await settle(page);
}

/** What is wrong with the page and the hint, and every control that shows now and is out of reach. */
const look = (page, min, whole) =>
  page.evaluate(
    ({ min, whole, MIN_TAP, MIN_TEXT, CONTROLS }) => {
      const bad = [];
      const name = (e) => e.getAttribute('aria-label') || e.textContent.trim();
      const off = (r) => r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5;
      // the tray, while it is open, covers the page on purpose
      const open = !!document.querySelector('.dq-tray:not(.is-hidden)');
      const frame = document.querySelector('.dq-draw-frame').getBoundingClientRect();
      if (frame.height < min - 0.5 || frame.width < min * 0.7 - 0.5) bad.push(`the page is ${Math.round(frame.width)}x${Math.round(frame.height)} px, under ${Math.round(min * 0.7)}x${min} px`);
      if (off(frame)) bad.push(`the page reaches off the screen (${Math.round(frame.left)},${Math.round(frame.top)} to ${Math.round(frame.right)},${Math.round(frame.bottom)})`);
      else if (!open && !document.elementFromPoint(frame.left + frame.width / 2, frame.top + frame.height / 2)?.closest('.dq-ink-stage')) bad.push('something covers the page');
      for (const s of [document.scrollingElement, document.querySelector('.dq'), document.querySelector('.dq-tray')]) {
        if (s && s.scrollWidth > s.clientWidth + 1) bad.push(`${s.className || 'the document'} scrolls sideways, ${s.scrollWidth} px in ${s.clientWidth}`);
      }
      // controls that show, each brought into view inside the tray if it is there (the page itself is never scrolled),
      // and taking a tap in its middle and, with `whole`, just inside each edge
      window.__reached ??= new Set();
      for (const e of document.querySelectorAll(CONTROLS)) {
        if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const tray = e.closest('.dq-tray');
        if (tray) {
          const [r, t] = [e.getBoundingClientRect(), tray.getBoundingClientRect()];
          tray.scrollTop += r.top < t.top ? r.top - t.top - 2 : r.bottom > t.bottom ? r.bottom - t.bottom + 2 : 0;
        }
        const r = e.getBoundingClientRect();
        if (r.width < MIN_TAP - 0.5 || r.height < MIN_TAP - 0.5) bad.push(`${name(e)} is ${Math.round(r.width)}x${Math.round(r.height)} px`);
        else if (off(r)) bad.push(`${name(e)} is off the screen at ${Math.round(r.left)},${Math.round(r.top)}`);
        else {
          const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
          const missed = [[x, y], ...(whole ? [[x, r.top + 2], [x, r.bottom - 2], [r.left + 2, y], [r.right - 2, y]] : [])].filter(([px, py]) => !e.contains(document.elementFromPoint(px, py)));
          if (missed.length) bad.push(`${name(e)} is covered or cut off at ${missed.map(([px, py]) => `${Math.round(px)},${Math.round(py)}`).join(' ')}`);
          else window.__reached.add(e);
        }
      }
      // the hint, while the tray is closed: at body size, on the page, and over no button
      if (!open) {
        const hint = document.querySelector('.dq-draw-hint');
        const px = parseFloat(getComputedStyle(hint).fontSize);
        if (px < MIN_TEXT - 0.01) bad.push(`the hint "${hint.textContent}" is ${px} px`);
        const range = document.createRange();
        range.selectNodeContents(hint);
        const buttons = [...document.querySelectorAll('button, a[href], [role=radio]')].filter((b) => b.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
        for (const l of range.getClientRects()) {
          if (l.left < frame.left - 0.5 || l.right > frame.right + 0.5 || l.top < frame.top - 0.5 || l.bottom > frame.bottom + 0.5) bad.push(`the hint reaches past the page (${Math.round(l.left)},${Math.round(l.top)} to ${Math.round(l.right)},${Math.round(l.bottom)})`);
          for (const b of buttons) {
            const r = b.getBoundingClientRect();
            if (l.left < r.right && r.left < l.right && l.top < r.bottom && r.top < l.bottom) bad.push(`the hint overlaps ${name(b)}`);
          }
        }
      }
      return [...new Set(bad)];
    },
    { min, whole, MIN_TAP, MIN_TEXT, CONTROLS },
  );

const unreached = (page) => page.evaluate((CONTROLS) => [...document.querySelectorAll(CONTROLS)].filter((e) => !window.__reached?.has(e)).map((e) => e.getAttribute('aria-label') || e.textContent.trim()), CONTROLS);
const scrolled = (page) => page.evaluate(() => [document.scrollingElement, document.querySelector('.dq')].some((s) => s.scrollTop || s.scrollLeft));

/** Picks a tool by name: on screen, or in the tray, opened for it with the Tools button. */
async function pick(page, name) {
  const tool = page.getByRole('radio', { name, exact: true });
  if (!(await tool.isVisible())) await page.locator('.dq-tray-b').click();
  await tool.click();
}

/** A line across the middle of the page, from 30% to 70% of its width. */
async function line(page) {
  const f = await page.locator('.dq-draw-frame').boundingBox();
  await page.mouse.move(f.x + f.width * 0.3, f.y + f.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width * 0.7, f.y + f.height * 0.6, { steps: 8 });
  await page.mouse.up();
}

function phoneAt(phone) {
  return async (h) => {
    const failed = [];
    for (const zoom of [2, 1]) {
      for (const motion of ['reduce', 'full']) {
        const touch = motion === 'full';
        const size = `${phone.width}x${phone.height} at ${zoom * 100}%${touch ? ' with Motion on, by touch' : ''}`;
        const { ctx, page, errors } = await boot(h, { width: phone.width / zoom, height: phone.height / zoom }, { edit: (s) => (s.settings.motion = motion), device: { hasTouch: touch } });
        try {
          for (const kind of ['today', 'ally']) {
            const where = `${size}, ${kind === 'ally' ? 'shadow ally page' : 'Draw today'}`;
            const shot = `draw-page-zoom-${phone.width}x${phone.height}-${zoom * 100}-${kind}${touch ? '-touch' : ''}`;
            await open(page, kind);
            const bad = await look(page, MIN_PAGE / zoom, zoom === 2);
            // Save is in reach as the page opens, not only once the tray is open
            if (!(await page.evaluate(() => window.__reached.has(document.querySelector('.dq-save'))))) bad.push('Save is not in reach as the page opens');
            const said = await page.locator('.dq-draw-hint').textContent();
            if (said !== (touch ? 'Tap two fingers to undo' : 'Draw anywhere on the page.')) bad.push(`the hint for ${touch ? 'touch' : 'a mouse'} says "${said}"`);
            await h.shot(page, shot);
            const tray = page.locator('.dq-tray-b');
            if (zoom === 1 && (await tray.count())) bad.push("the tools are folded into the tray at the phone's own size");
            if (await tray.isVisible()) {
              await tray.click();
              await settle(page);
              bad.push(...(await look(page, MIN_PAGE / zoom, zoom === 2)));
              await page.evaluate(() => document.querySelector('.dq-tray').scrollTo(0, 0));
              await h.shot(page, `${shot}-tray`);
              await tray.click();
            }
            const missing = await unreached(page);
            if (missing.length) bad.push(`out of reach: ${missing.join(', ')}`);
            // Escape closes the tray even once a prompt picked in it has taken focus away with it
            if (kind === 'today' && (await tray.isVisible())) {
              await tray.click();
              await page.getByRole('button', { name: 'No prompt' }).click();
              await page.keyboard.press('Escape');
              const shut = await page.evaluate(() => {
                const b = document.querySelector('.dq-tray-b');
                return document.querySelector('.dq-tray').classList.contains('is-hidden') && b.getAttribute('aria-expanded') === 'false' && document.activeElement === b;
              });
              if (!shut) bad.push('Escape after No prompt left the tray open, or focus away from the Tools button');
            }
            failed.push(...bad.map((b) => `${where}: ${b}`));
            // a page out of reach is not drawn on and saved here; one in reach gets a line, with tools picked from
            // wherever they are, then saved
            if (bad.length) continue;
            const { pages: before } = await stored(page);
            for (const name of ['Soft glow', 'Mint ink', 'Bold size']) await pick(page, name);
            if (await page.locator('.dq-tray-b[aria-expanded="true"]').count()) await tray.click();
            await line(page);
            const strokes = await page.evaluate(() => window.__daily.ink.strokes.map((s) => ({ i: s.i, m: s.m, w: s.w, n: s.p.length })));
            const w = await page.evaluate(() => Math.round(0.05 * window.__daily.ink.W * 10) / 10);
            if (strokes.length !== 1 || strokes[0].m !== 'glow' || strokes[0].i !== 3 || strokes[0].w !== w) bad.push(`the line was not drawn with Soft glow, Mint and Bold: ${JSON.stringify(strokes)}`);
            // Back closes the open tray first, and the drawing page and its line stay
            if (await tray.isVisible()) {
              const drawn = await page.evaluate(() => JSON.stringify(window.__daily.ink.strokes));
              await tray.click();
              await page.evaluate(() => history.back());
              await page.waitForFunction(() => window.__daily.route.name !== 'draw' || document.querySelector('.dq-tray')?.classList.contains('is-hidden'), null, { timeout: 10000 });
              const after = await page.evaluate(() => ({ route: window.__daily.route.name, open: document.querySelector('.dq-tray-b')?.getAttribute('aria-expanded'), strokes: JSON.stringify(window.__daily.ink?.strokes) }));
              if (after.route !== 'draw' || after.open !== 'false' || after.strokes !== drawn) bad.push(`Back with the tray open did not just close it: ${JSON.stringify({ ...after, strokes: after.strokes === drawn ? 'kept' : 'changed' })}`);
              // gone from the drawing page, there is no Save to tap here
              if (after.route !== 'draw') {
                failed.push(...bad.map((b) => `${where}: ${b}`));
                continue;
              }
            }
            await page.locator('.dq-save').click();
            if (kind === 'ally') {
              await page.locator('.dq-sheet:not(.is-hidden) .dq-sheet-h').waitFor({ timeout: 10000 });
              await page.keyboard.press('Escape');
            } else {
              await page.locator('.dq-tools-saved').waitFor({ timeout: 10000 });
              // the note shows whole, then the page is on the device as drawn, read back as a reload would
              bad.push(...(await noteShown(page)));
              await h.shot(page, `${shot}-saved`);
              const fresh = (s) => s.pages.filter((m) => !before.some((b) => b.id === m.id));
              await h.poll(page, () => stored(page), (s) => fresh(s).length === 1 && fresh(s)[0].strokes === s.drawn, (s) => `Save did not keep the line as drawn on the device: ${s ? `${fresh(s).length} new pages` : 'storage unread'}`).catch((e) => bad.push(e.message));
              // the note can cover all the page's room: a tap on its words puts it away, and the page takes a line again
              if (zoom === 2) {
                await page.locator('.dq-tools-saved').click();
                await line(page);
                const lines = await page.evaluate(() => window.__daily.ink.strokes.length);
                if (lines !== 2) bad.push(`after a tap on the note's words, a new line did not land on the page (${lines} lines)`);
              }
            }
            if (await scrolled(page)) bad.push('the page scrolled');
            failed.push(...bad.map((b) => `${where}: ${b}`));
          }
          if (errors.length) failed.push(`${size}: ${errors.join(' | ')}`);
        } finally {
          await ctx.close();
        }
      }
    }
    h.expect(!failed.length, failed.join('\n'));
  };
}

/** A line begun at the phone's own size goes on while the phone zooms to 200% and the tools fold into the tray. */
async function strokeKept(h) {
  const { ctx, page, errors } = await boot(h, { width: 390, height: 844 });
  try {
    await open(page, 'today');
    h.expect(!(await page.locator('.dq-tray-b').count()), 'the tools are folded at 390x844');
    const f = await page.locator('.dq-draw-frame').boundingBox();
    await page.mouse.move(f.x + f.width * 0.2, f.y + f.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(f.x + f.width * 0.5, f.y + f.height * 0.4, { steps: 6 });
    await page.setViewportSize({ width: 195, height: 422 });
    await settle(page);
    h.expect(await page.locator('.dq-tray-b').isVisible(), 'the tools did not fold into the tray at 200%');
    const g = await page.locator('.dq-draw-frame').boundingBox();
    await page.mouse.move(g.x + g.width * 0.7, g.y + g.height * 0.7, { steps: 6 });
    await page.mouse.up();
    // its points, on the page's own grid: where it began and where it was as the phone zoomed are kept, and it goes
    // on under the pointer on the page as the page is now
    const { W, H, strokes } = await page.evaluate(() => ({ W: window.__daily.ink.W, H: window.__daily.ink.H, strokes: window.__daily.ink.strokes.map((s) => s.p) }));
    h.expect(strokes.length === 1, `the line drawn while the phone zoomed was not kept: ${strokes.length} strokes`);
    const p = strokes[0];
    const pts = Array.from({ length: p.length / 2 }, (_, i) => [p[2 * i], p[2 * i + 1]]);
    // (a line trails the pointer a little, as it smooths it)
    const near = ([x, y], [fx, fy]) => Math.hypot(x - fx * W, y - fy * H) < 0.04 * W;
    const at = (q) => `${Math.round(q[0])},${Math.round(q[1])}`;
    h.expect(near(pts[0], [0.2, 0.3]), `the line begins at ${at(pts[0])}, not ${0.2 * W},${0.3 * H}`);
    h.expect(pts.some((q) => near(q, [0.5, 0.4])), `the part drawn before the zoom, to ${0.5 * W},${0.4 * H}, is gone: ${pts.map(at).join(' ')}`);
    h.expect(near(pts.at(-1), [0.7, 0.7]), `the line ends at ${at(pts.at(-1))}, not under the pointer at ${0.7 * W},${0.7 * H}`);
    // on the device, as a reload would find it: the line is kept as a draft as it was drawn, every point from before the
    // zoom and after it, before anything else is tapped; then Save keeps those same strokes as a page from the folded
    // tools, and the draft goes
    const { pages: before } = await h.poll(page, () => stored(page), (s) => s.drafts.some((d) => d.kind === 'today' && d.strokes === s.drawn), (s) => `no draft on the device kept the line as drawn: ${s ? `${s.drafts.filter((d) => d.kind === 'today').length} drafts of the page, none the same` : 'storage was not read'}`);
    await page.locator('.dq-save').click();
    await page.locator('.dq-tools-saved').waitFor({ timeout: 10000 });
    const fresh = (s) => s.pages.filter((m) => !before.some((b) => b.id === m.id));
    await h.poll(page, () => stored(page), (s) => fresh(s).length === 1 && fresh(s)[0].strokes === s.drawn && !s.drafts.some((d) => d.kind === 'today'), (s) => `after Save the device has ${s ? `${fresh(s).length} new pages, ${fresh(s).filter((m) => m.strokes === s.drawn).length} the line as drawn, and ${s.drafts.filter((d) => d.kind === 'today').length} drafts of the page` : 'storage unread'}`);
    // back at the phone's own size the tools unfold, and focus on the Tools button moves to the ink it showed
    await page.locator('.dq-tray-b').focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    const focus = await page.evaluate(() => ({ tray: !!document.querySelector('.dq-tray-b'), on: document.activeElement?.matches('.dq-inks [aria-checked="true"]') && document.activeElement.checkVisibility(), what: document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName }));
    h.expect(!focus.tray && focus.on, `as the tools unfolded, focus went to ${focus.what}, not the ink the Tools button showed`);
    await h.shot(page, 'draw-page-zoom-stroke-kept');
    h.expect(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}

/**
 * On a wide screen the note after a save sits in the tools beside the page and takes room of its own there: it shows
 * whole as it comes, and as the screen turns wide under a note shown over the page; once another line clears it, the
 * tools lie as they do without it, with no resize.
 */
async function noteRoom(h) {
  const failed = [];
  // how the tools lie at 760x700 with no note, taken from the first page before its Save
  let bare = null;
  for (const [from, to] of [[{ width: 760, height: 700 }], [{ width: 390, height: 844 }, { width: 760, height: 700 }]]) {
    const where = `saved at ${from.width}x${from.height}${to ? `, then ${to.width}x${to.height}` : ''}`;
    const { ctx, page, errors } = await boot(h, from);
    try {
      await open(page, 'today');
      bare ??= await page.evaluate(() => !!document.querySelector('.dq-draw--tray'));
      await line(page);
      await page.locator('.dq-save').click();
      await page.locator('.dq-tools-saved').waitFor({ timeout: 10000 });
      if (to) {
        await page.setViewportSize(to);
        await settle(page);
      }
      failed.push(...(await noteShown(page)).map((b) => `${where}: ${b}`));
      await h.shot(page, `draw-page-zoom-note-${from.width}x${from.height}${to ? `-${to.width}x${to.height}` : ''}`);
      // another line clears the note, and the tools go back to how they lie with no note, with no resize
      await line(page);
      const after = await page.evaluate(() => ({ note: document.querySelector('.dq-tools-msg').hasChildNodes(), lines: window.__daily.ink.strokes.length, folded: !!document.querySelector('.dq-draw--tray') }));
      if (after.note || after.lines !== 2 || after.folded !== bare) failed.push(`${where}: after another line the note is ${after.note ? 'still there' : 'gone'}, the page has ${after.lines} lines, and the tools are ${after.folded ? 'folded' : 'unfolded'}, not ${bare ? 'folded' : 'unfolded'} as with no note`);
      if (errors.length) failed.push(`${where}: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  }
  h.expect(!failed.length, failed.join('\n'));
}

/**
 * A phone zoomed to 200% with no room for the page (320 px wide, split to 340 px tall) or little (360x364, a page a few
 * pixels high). As a fresh page opens, none of the page shows with no room, and with little its hint shows only whole
 * on it. The tray opened by Tools shows whole beside the Tools button, Tools closes it, and Escape does too, back to
 * Tools. A line drawn with room is saved at that size: the note shows whole beside the Tools button too, shows whole
 * over the page's room once the page has room again, and back at that size shows as it did, with nothing kept from the
 * roomier layout; a tap on its words puts it away with Save back in a tap. Last, Tools closes the tray when it opened
 * as the tools folded, with focus in them or with the Clear question open.
 */
function tight(size, none) {
  return async (h) => {
    const roomy = { width: 195, height: 422 };
    const where = none ? 'with no room' : 'with little room';
    const shot = `draw-page-zoom-${none ? 'no' : 'little'}-room`;
    const failed = [];
    const { ctx, page, errors } = await boot(h, roomy);
    const at = async (s) => {
      await page.setViewportSize(s);
      await settle(page);
    };
    try {
      await open(page, 'today');
      await at(size);
      failed.push(...(await pageShown(page, none)).map((b) => `${where}: ${b}`));
      await h.shot(page, shot);
      await page.locator('.dq-tray-b').click();
      await settle(page);
      failed.push(...(await tightShown(page, '.dq-tray', false)).map((b) => `${where}: ${b}`));
      await h.shot(page, `${shot}-tray`);
      const shut = await toolsCloses(page);
      if (shut) failed.push(`${where}, the tray opened by Tools: ${shut}`);
      if (await page.locator('.dq-tray-b[aria-expanded="false"]').count()) await page.locator('.dq-tray-b').click();
      await page.keyboard.press('Escape');
      const back = await page.evaluate(() => document.querySelector('.dq-tray').classList.contains('is-hidden') && document.activeElement === document.querySelector('.dq-tray-b'));
      if (!back) failed.push(`${where}, Escape left the tray open, or focus away from the Tools button`);

      await at(roomy);
      await line(page);
      await at(size);
      await page.locator('.dq-save').click();
      await page.locator('.dq-tools-saved').waitFor({ timeout: 10000 });
      await settle(page);
      const note = await tightShown(page, '.dq-tools-msg', true);
      failed.push(...note.map((b) => `${where}: ${b}`));
      await h.shot(page, `${shot}-note`);
      // a note out of place is not tapped here
      if (!note.length) {
        await at(roomy);
        failed.push(...(await noteShown(page)).map((b) => `back with room: ${b}`));
        await at(size);
        failed.push(...(await tightShown(page, '.dq-tools-msg', true)).map((b) => `${where} again: ${b}`));
        await page.locator('.dq-tools-saved').click();
        const save = await page.evaluate(() => {
          const s = document.querySelector('.dq-save');
          const q = s.getBoundingClientRect();
          return { note: document.querySelector('.dq-tools-msg').hasChildNodes(), tap: s.contains(document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2)) };
        });
        if (save.note || !save.tap) failed.push(`${where}, after a tap on the note's words the note is ${save.note ? 'still there' : 'gone'} and Save is ${save.tap ? 'in' : 'out of'} a tap`);
      }

      // the tray opens as the tools fold with focus in them, or with the Clear question open in it
      for (const how of ['with focus in them', 'with the Clear question open']) {
        await at({ width: 390, height: 844 });
        if (how === 'with focus in them') await page.getByRole('radio', { name: 'Mint ink' }).focus();
        else {
          await line(page);
          await page.locator('.dq-tool--clear').click();
        }
        await at(size);
        const why = await toolsCloses(page);
        if (why) failed.push(`${where}, the tray opened as the tools folded ${how}: ${why}`);
      }
      if (errors.length) failed.push(errors.join(' | '));
    } finally {
      await ctx.close();
    }
    h.expect(!failed.length, failed.join('\n'));
  };
}

/**
 * On the shadow ally page at 320x568 and 390x844, at 200% and at the phone's own size, a line is saved as an ally and it
 * rises; Save card image then says how that went, in a room of its own, read with the rise scrolled to it.
 */
async function riseMessage(h) {
  const failed = [];
  for (const phone of [PHONES[0], PHONES[1]]) {
    for (const zoom of [2, 1]) {
      const size = `${phone.width}x${phone.height} at ${zoom * 100}%`;
      const { ctx, page, errors } = await boot(h, { width: phone.width / zoom, height: phone.height / zoom });
      try {
        await open(page, 'ally');
        await line(page);
        await page.locator('.dq-save').click();
        await page.locator('.dq-sheet:not(.is-hidden) .dq-sheet-h').waitFor({ timeout: 10000 });
        await page.keyboard.press('Enter');
        await page.locator('.dq-rise:not(.is-hidden) .dq-rise-acts').waitFor({ timeout: 10000 });
        await settle(page);
        await page.getByRole('button', { name: 'Save card image' }).click();
        await page.waitForFunction(() => document.querySelector('.dq-rise-msg')?.textContent, null, { timeout: 10000 });
        await settle(page);
        failed.push(...(await riseMsgShown(page)).map((b) => `${size}: ${b}`));
        await h.shot(page, `draw-page-zoom-rise-${phone.width}x${phone.height}-${zoom * 100}`);
        if (errors.length) failed.push(`${size}: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
  }
  h.expect(!failed.length, failed.join('\n'));
}

export const scenarios = {
  ...Object.fromEntries(PHONES.map((phone) => [`draw-page-zoom-${phone.width}x${phone.height}`, phoneAt(phone)])),
  'draw-page-zoom-stroke-kept': strokeKept,
  'draw-page-zoom-note-room': noteRoom,
  'draw-page-zoom-no-room': tight({ width: 160, height: 170 }, true),
  'draw-page-zoom-little-room': tight({ width: 180, height: 182 }, false),
  'draw-page-zoom-rise': riseMessage,
};
