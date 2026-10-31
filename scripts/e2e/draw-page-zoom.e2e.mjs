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
// Draw today and asks for the ally's name on the shadow ally page. Last, a line begun at 390x844 goes on while the
// phone zooms to 200%: what was drawn stays, the rest lands under the pointer, and it is kept as a draft and saved;
// Back with the tray open closes only the tray, and as the tools unfold again focus on Tools moves to the ink.
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

/** What the art store keeps now: the drafts of new pages, and every saved page, each with its strokes as JSON. */
const stored = (page) =>
  page.evaluate(async () => {
    const as = (await import('/src/daily/artstore.ts')).artStore(window.__daily.store.key);
    const drafts = (await as.drafts()).filter((d) => !d.editId).map((d) => ({ kind: d.kind, strokes: JSON.stringify(d.strokes) }));
    const pages = await Promise.all((await as.list()).map(async (m) => ({ id: m.id, strokes: JSON.stringify((await as.get(m.id))?.strokes) })));
    return { drafts, pages };
  });

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
            const drawn = await page.evaluate(() => JSON.stringify(window.__daily.ink.strokes));
            // Back closes the open tray first, and the drawing page and its line stay
            if (await tray.isVisible()) {
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
              // Save waits for the store, so the page is there as the note shows
              const kept = (await stored(page)).pages.filter((m) => !before.some((b) => b.id === m.id));
              if (kept.length !== 1 || kept[0].strokes !== drawn) bad.push(`Save did not keep the line as drawn: ${kept.length} new pages`);
              await h.shot(page, `${shot}-saved`);
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
    // the line is kept as a draft as it was drawn, every point from before the zoom and after it, before anything else
    // is tapped; then Save keeps those same strokes as a page from the folded tools, and the draft goes
    const drawn = await page.evaluate(() => JSON.stringify(window.__daily.ink.strokes));
    const { pages: before } = await h.poll(page, () => stored(page), (s) => s.drafts.some((d) => d.kind === 'today' && d.strokes === drawn), (s) => `no draft kept the line as drawn: ${s ? `${s.drafts.filter((d) => d.kind === 'today').length} drafts of the page, none the same` : 'the store was not read'}`);
    await page.locator('.dq-save').click();
    await page.locator('.dq-tools-saved').waitFor({ timeout: 10000 });
    // Save waits for the store, so the page is there, and the draft gone, as the note shows
    const after = await stored(page);
    const kept = after.pages.filter((m) => !before.some((b) => b.id === m.id));
    h.expect(kept.length === 1 && kept[0].strokes === drawn, `Save did not keep the line as drawn: ${kept.length} new pages`);
    h.expect(!after.drafts.some((d) => d.kind === 'today'), 'the draft stayed after Save');
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

export const scenarios = {
  ...Object.fromEntries(PHONES.map((phone) => [`draw-page-zoom-${phone.width}x${phone.height}`, phoneAt(phone)])),
  'draw-page-zoom-stroke-kept': strokeKept,
};
