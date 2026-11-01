/**
 * Art room: a finger-drawing page with glowing Lantern ink. Two ways in: "Draw today" (a blank page, optional prompt)
 * and "Design a shadow ally" (the drawing becomes the art on a new Shadow card). Nothing is graded.
 */
import { animate } from '../ui/anim';
import { ALLY_NAMES, ART, ART_PROMPTS } from '../content/daily-lines';
import { playerName } from '../core/you';
import type { App, Route, ScreenOut, Visit } from './app';
import { icon } from './art';
import { artStore, extrasOf, revOf, type Draft, type DrawingMeta, type DrawingRec } from './artstore';
import { canvasBlob, INKS, InkPad, PAGE, renderDrawing, SIZES, TOOLS, type Paper, type Stroke, type Tool } from './ink';
import { dayLabel } from './lines';
import { uid } from './store';
import { btn, chip, field, h, p, panel, radioKeys, redrawn, shareOrSave, typo } from './ui';

const store = (app: App) => artStore(app.store.key);
const KEPT_APART = 'A newer copy of this drawing arrived, so this one was kept as its own page.';
const pageHead = (title: string, sub?: string) => h('header', { class: 'dq-pagehead' }, h('h1', { class: 'dq-h1', 'data-focus': '', text: title }), sub ? p(sub, 'dq-text dq-pagesub') : null);

/** A draft untouched this long was left by an earlier session (iOS can hand a relaunched app a new tab id). */
const ORPHAN_MS = 120e3;
/** The colours an ink's dot is drawn in (.dq-swatch-dot). */
const dotStyle = (ink: (typeof INKS)[number]) => `--b:${ink.body};--c:${ink.core ?? ink.mid ?? ink.body};--g:${ink.halo}`;

export function todayPrompt(app: App, roll = 0) {
  return ART_PROMPTS[(app.store.visitIndex() * 5 + roll) % ART_PROMPTS.length];
}

/** First saved drawing of a day adds 10 XP, whatever it is. */
function creditArt(app: App, kind: Paper) {
  const st = app.store;
  const today = st.today();
  if (st.state.events.some((e) => e.k === 'art' && e.day === today)) return false;
  st.add('art', 10, { data: { kind } });
  return true;
}

/** An <img> that fills in once the thumbnail is ready. */
export function thumbImg(app: App, m: DrawingMeta, alt: string) {
  const img = h('img', { class: 'dq-thumb', alt, decoding: 'async', draggable: 'false' });
  void store(app)
    .thumbUrl(m)
    .then((u) => {
      if (u) img.src = u;
    });
  return img;
}

/** Favourites first, each group in the order it came in. */
export const favFirst = <T extends { fav?: boolean }>(list: T[]) => [...list.filter((m) => m.fav), ...list.filter((m) => !m.fav)];
/** The drawing an Undo just brought back: the list that shows it next takes focus to it. */
let back: string | null = null;
export function focusBack(list: HTMLElement) {
  const el = back ? list.querySelector<HTMLElement>(`[data-piece="${CSS.escape(back)}"]`) : null;
  if (!el) return;
  back = null;
  el.focus();
}

/** What a drawing's card shows: a save, a name or a favourite changes it; a thumbnail filled in elsewhere does not. */
export const cardOf = (m: DrawingMeta) => [m.id, m.kind, m.day, revOf(m), m.name ?? '', m.fav ? 1 : 0].join('|');
const filled = new WeakMap<HTMLElement, string>();
/**
 * Fills a list of drawing cards again, only when what it shows changed (`shows`). A card that had focus keeps it, or
 * the card now in its place takes it, so a change in another tab never drops a keyboard player out of the list.
 */
export function refill(list: HTMLElement, shows: string, cards: () => HTMLElement[]) {
  if (filled.get(list) === shows) return;
  filled.set(list, shows);
  const was = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
  const had = was?.closest<HTMLElement>('[data-piece]');
  const at = had ? [...list.querySelectorAll('[data-piece]')].indexOf(had) : -1;
  list.replaceChildren(...cards());
  const all = [...list.querySelectorAll<HTMLElement>('[data-piece]')];
  // a control kept across the refill (Design an ally) is focused again too
  const to = had ? (all.find((e) => e.dataset.piece === had.dataset.piece) ?? all[Math.min(at, all.length - 1)]) : was && list.contains(was) ? was : null;
  to?.focus({ preventScroll: true });
}

/** What an ally's card calls it. */
export const allyName = (m: DrawingMeta) => m.name?.trim() || 'Shadow ally';

/** A shadow ally as a full-art Shadow card. */
export function allyCard(app: App, m: DrawingMeta, img?: HTMLImageElement | HTMLCanvasElement, star = false) {
  const name = allyName(m);
  return h(
    'div',
    { class: 'dq-cardface dq-allycard' },
    h('div', { class: 'dq-allycard-art' }, img ?? thumbImg(app, m, `${name}, drawn by you`)),
    h('div', { class: 'dq-allycard-top' }, h('span', { class: 'dq-allycard-tag', html: `${icon('ally')}<span>Shadow ally</span>` }), star && m.fav ? h('span', { class: 'dq-allycard-fav', html: icon('star') }) : null),
    h('div', { class: 'dq-allycard-foot' }, h('div', { class: 'dq-allycard-name', text: typo(name) }), h('div', { class: 'dq-allycard-by', text: 'Your design' })),
  );
}

async function fontsReady() {
  try {
    await Promise.all([document.fonts.load('600 90px "Bodoni Moda"'), document.fonts.load('500 30px "Jost"')]);
  } catch {
    /* system fallback fonts still draw */
  }
}

function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, track: number) {
  let cx = x;
  for (const ch of text) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + track;
  }
}

/** The ally card as an image: the drawing, the card frame, its name. */
export async function renderAllyCard(rec: DrawingRec) {
  await fontsReady();
  const W = PAGE.ally.w, H = PAGE.ally.h;
  const c = renderDrawing(rec.strokes, 'ally', W);
  const g = c.getContext('2d')!;
  const shade = g.createLinearGradient(0, H * 0.62, 0, H);
  shade.addColorStop(0, 'rgba(4,8,16,0)');
  shade.addColorStop(0.55, 'rgba(4,8,16,0.72)');
  shade.addColorStop(1, 'rgba(4,8,16,0.92)');
  g.fillStyle = shade;
  g.fillRect(0, H * 0.62, W, H * 0.38);
  g.strokeStyle = 'rgba(143,180,225,0.62)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, W - 3, H - 3);
  g.strokeStyle = 'rgba(125,160,205,0.3)';
  g.lineWidth = 2;
  g.strokeRect(22, 22, W - 44, H - 44);
  g.strokeStyle = 'rgba(190,228,255,0.75)';
  g.lineWidth = 4;
  const L = 44, m = 36;
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
    g.beginPath();
    g.moveTo(x, y + dy * L);
    g.lineTo(x, y);
    g.lineTo(x + dx * L, y);
    g.stroke();
  }
  const top = g.createLinearGradient(W * 0.2, 0, W * 0.8, 0);
  top.addColorStop(0, 'rgba(164,248,255,0)');
  top.addColorStop(0.5, 'rgba(164,248,255,0.9)');
  top.addColorStop(1, 'rgba(164,248,255,0)');
  g.fillStyle = top;
  g.fillRect(W * 0.2, 0, W * 0.6, 4);
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#89cf9d';
  g.font = '500 30px "Jost", system-ui, sans-serif';
  spaced(g, 'SHADOW ALLY', 76, 104, 7);
  const name = rec.name?.trim() || 'Shadow ally';
  let size = 104;
  g.font = `600 ${size}px "Bodoni Moda", Didot, serif`;
  while (g.measureText(name).width > W - 152 && size > 48) {
    size -= 4;
    g.font = `600 ${size}px "Bodoni Moda", Didot, serif`;
  }
  g.fillStyle = '#eaf6ff';
  g.shadowColor = 'rgba(79,184,255,0.45)';
  g.shadowBlur = 18;
  g.fillText(name, 76, H - 150);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(79,184,255,0.45)';
  g.fillRect(76, H - 118, W - 152, 2);
  g.fillStyle = '#7cc8ff';
  g.font = '500 28px "Jost", system-ui, sans-serif';
  spaced(g, `DRAWN BY ${playerName().toUpperCase()}`, 76, H - 72, 6);
  return c;
}

const prepared = new Map<string, Promise<Blob | null>>();
/** Renders the export ahead of the tap, so the share sheet opens inside the tap's user activation on iPhone. */
export function prepImage(rec: DrawingRec) {
  const k = `${rec.id}:${rec.updated}:${rec.name ?? ''}:${playerName()}`;
  let pr = prepared.get(k);
  if (!pr) {
    if (prepared.size > 6) prepared.clear();
    pr = (async () => canvasBlob(rec.kind === 'ally' ? await renderAllyCard(rec) : renderDrawing(rec.strokes, rec.kind, PAGE[rec.kind].w), 'image/png'))();
    prepared.set(k, pr);
  }
  return pr;
}

async function saveImage(rec: DrawingRec) {
  const blob = await prepImage(rec);
  if (!blob) return 'failed';
  const base = rec.kind === 'ally' ? `shadow-ally-${(rec.name || 'ally').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ally'}` : `art-room-${rec.day}`;
  return shareOrSave(blob, `${base}.png`, 'image/png');
}
const savedText = (r: string) => (r === 'saved' ? 'Image saved to your downloads.' : r === 'shared' ? 'Image ready. Pick Save Image to keep it in Photos.' : r === 'failed' ? "That image couldn't be made. Your drawing is still saved here." : '');

// ---------------- Art room (landing + gallery) ----------------
export function artScreen(app: App): ScreenOut {
  const as = store(app);
  const draftBox = h('div', { class: 'dq-art-draft is-hidden' });
  const gallery = h('div', { class: 'dq-gallery', 'aria-live': 'polite' });
  const note = h('p', { class: 'dq-small dq-art-note is-hidden', text: ART.noStore });
  // today's prompt as every open copy deals it: visit days restored there, or the companion renamed, change it here too
  const prompt = redrawn(() => h('span', { class: 'dq-artentry-prompt', text: typo(todayPrompt(app)) }), () => null);
  const entry = (kind: Paper, title: string, sub: string, extra: HTMLElement | null) =>
    h(
      'button',
      { type: 'button', class: `dq-artentry dq-artentry--${kind}`, onclick: () => app.go({ name: 'draw', kind }) },
      h('span', { class: 'dq-artentry-art', 'aria-hidden': 'true', html: entryArt(kind) }),
      h('span', { class: 'dq-artentry-txt' }, h('span', { class: 'dq-artentry-t', text: title }), h('span', { class: 'dq-artentry-s', text: typo(sub) }), extra),
      h('span', { class: 'dq-artentry-go', html: icon('chev') }),
    );
  const el = h(
    'div',
    { class: 'dq-page dq-artroom' },
    pageHead(ART.title, ART.sub),
    draftBox,
    h(
      'div',
      { class: 'dq-artentries' },
      entry('today', ART.todayTitle, ART.todaySub, prompt.node as HTMLElement),
      entry('ally', ART.allyTitle, ART.allySub, null),
    ),
    h('section', { class: 'dq-art-pages', 'aria-labelledby': 'dq-pages-h' }, h('h2', { class: 'dq-sec-h', id: 'dq-pages-h' }, h('span', { text: ART.pages })), gallery, note),
  );
  let refresh = 0;
  // the draft on show, so a change elsewhere that leaves it the same doesn't rebuild it under the player's focus
  let draftShown: string | null = null;
  const render = async () => {
    const turn = ++refresh;
    const [list, drafts] = await Promise.all([as.shown(), as.drafts()]);
    if (turn !== refresh) return;
    if (!as.persistent) note.classList.remove('is-hidden');
    const d = drafts[0];
    const draftNow = d ? `${d.key}|${d.t}|${d.strokes.length}` : '';
    if (draftNow !== draftShown) {
      draftShown = draftNow;
      draftBox.classList.toggle('is-hidden', !d);
      if (d) {
        const thumb = renderDrawing(d.strokes, d.kind, 240);
        thumb.className = 'dq-thumb';
        draftBox.replaceChildren(
          h('div', { class: 'dq-art-draft-img' }, thumb),
          h(
            'div',
            { class: 'dq-art-draft-txt' },
            p(ART.draft, 'dq-text'),
            h(
              'div',
              { class: 'dq-actions' },
              btn('Keep drawing', () => app.go({ name: 'draw', kind: d.kind, ...(d.editId ? { id: d.editId } : {}), draft: d.key }), { kind: 'primary', ic: 'brush' }),
            ),
          ),
        );
      }
    }
    const shown = favFirst(list);
    refill(gallery, shown.map(cardOf).join('\n'), () =>
      !shown.length
        ? [p(ART.pagesEmpty, 'dq-text dq-empty')]
        : shown.map((m) => {
            const name = m.kind === 'ally' ? m.name?.trim() || 'Shadow ally' : m.name?.trim();
            const label = m.kind === 'ally' ? `${name}, a shadow ally from ${dayLabel(m.day)}` : name ? `${name}, a page from ${dayLabel(m.day)}` : `Page from ${dayLabel(m.day)}`;
            return h(
              'button',
              { type: 'button', class: `dq-galitem dq-galitem--${m.kind}`, 'data-piece': m.id, onclick: () => app.go({ name: 'piece', id: m.id }), 'aria-label': m.fav ? `${label}, a favourite` : label },
              m.kind === 'ally' ? allyCard(app, m) : h('span', { class: 'dq-galitem-img' }, thumbImg(app, m, '')),
              h('span', { class: 'dq-galitem-d' }, m.fav ? h('span', { class: 'dq-galitem-fav', html: icon('star') }) : null, h('span', { text: name ? `${name} · ${dayLabel(m.day)}` : dayLabel(m.day) })),
            );
          }),
    );
    focusBack(gallery);
  };
  const off = as.onChange(() => void render());
  const offPrompt = app.store.onChange(prompt.update);
  void render();
  return { el, title: ART.title, mode: 'sub', bubbles: [1.6, 0.6], leave: () => { refresh++; off(); offPrompt(); } };
}

function entryArt(kind: Paper) {
  if (kind === 'today')
    return `<svg viewBox="0 0 120 90"><defs><filter id="dqea1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter></defs>
<path d="M14 62C28 30 44 70 60 44S92 20 106 40" fill="none" stroke="#1f6df3" stroke-width="9" stroke-linecap="round" filter="url(#dqea1)" opacity=".9"/>
<path d="M14 62C28 30 44 70 60 44S92 20 106 40" fill="none" stroke="#4fb8ff" stroke-width="4.2" stroke-linecap="round"/>
<path d="M14 62C28 30 44 70 60 44S92 20 106 40" fill="none" stroke="#d2f5ff" stroke-width="1.4" stroke-linecap="round"/>
<path d="M30 74c10-4 22-4 32 0" fill="none" stroke="#89cf9d" stroke-width="2.6" stroke-linecap="round" opacity=".9"/></svg>`;
  return `<svg viewBox="0 0 120 90"><defs><radialGradient id="dqea2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#7b3fe4" stop-opacity=".75"/><stop offset="1" stop-color="#7b3fe4" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="60" cy="78" rx="40" ry="7" fill="url(#dqea2)"/>
<rect x="40" y="10" width="40" height="58" rx="3" fill="#0b1a30" stroke="#8fb4e1" stroke-opacity=".65"/>
<path d="M60 22c5 0 8 4 8 9 0 3-1.6 5.4-3.8 6.8l7 7-2 12H50.8l-2-12 7-7c-2.2-1.4-3.8-3.8-3.8-6.8 0-5 3-9 8-9z" fill="#070b16" stroke="#7b3fe4" stroke-opacity=".8"/>
<circle cx="57" cy="30.5" r="1.3" fill="#9cfbff"/><circle cx="63" cy="30.5" r="1.3" fill="#9cfbff"/></svg>`;
}

// ---------------- Drawing page ----------------
/** What a visit to the drawing page keeps for Back and Forward: the drawing it holds and the draft its strokes go to. */
interface DrawKept {
  readonly id: string | null;
  readonly key: string;
}
export function drawScreen(app: App, route: Route, visit: Visit): ScreenOut {
  const r = route as Extract<Route, { name: 'draw' }>;
  // Back or Forward to this visit, from the Safe Zone too, opens what it held: the page saved on it (a copy kept apart
  // included), as Keep drawing would, and the strokes drawn since
  const was = visit.again ? (visit.kept as DrawKept | undefined) : undefined;
  const editId = was?.id ?? r.id;
  const kind: Paper = r.kind === 'ally' ? 'ally' : 'today';
  const as = store(app);
  const tab = as.claimTab();
  const own = (id?: string | null) => (id ? `edit:${id}:${tab.id}` : `${kind}:${tab.id}`);
  let key = own(editId);
  let saving = false;
  let storing = false;
  let recId = editId ?? null;
  let rec: DrawingRec | null = null;
  let bases: string[] | undefined;
  let promptRoll = 0;
  let prompt: string | null = kind === 'today' ? todayPrompt(app) : null;
  let dirty = false;
  let draftTimer = 0;
  let left = false;
  let loading = true;
  const offs: (() => void)[] = [];

  const msg = h('div', { class: 'dq-tools-msg', 'aria-live': 'polite' });
  const say = (...kids: (Node | string | null)[]) => {
    const had = msg.hasChildNodes();
    msg.replaceChildren(...kids.filter((k): k is Node | string => k !== null));
    // in a wide screen's tools (laid out unfolded) the note takes room of its own, so what fits is weighed again as it
    // comes or goes, folded or not
    if ((had || msg.hasChildNodes()) && el.isConnected && noteInTools) layout();
  };

  const flushDraft = () => {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = 0;
    if (!dirty) return;
    if (!key.endsWith(`:${tab.id}`)) key = own(recId);
    if (!pad.strokes.length && !recId) return void as.dropDraft(key);
    void as.putDraft({ key, kind, editId: recId ?? undefined, bases: recId ? bases : undefined, prompt, strokes: pad.strokes, t: Date.now() });
  };
  const pad = new InkPad({
    kind,
    still: () => app.reduced(),
    onChange: () => {
      if (!loading) dirty = true;
      sync();
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = window.setTimeout(flushDraft, 500);
    },
    onStroke: () => {
      dirty = true;
      say();
      hint.classList.add('is-gone');
    },
  });
  app.ink = pad;
  pad.el.setAttribute('role', 'img');
  pad.el.setAttribute('aria-label', kind === 'ally' ? 'Drawing page for a shadow ally' : 'Drawing page');
  pad.el.inert = true;

  // prompt / hint
  const promptText = h('span', { class: 'dq-prompt-t' });
  const promptRow = h('div', { class: 'dq-prompt' });
  const renderPrompt = () => {
    if (kind === 'ally') {
      promptRow.replaceChildren(h('span', { class: 'dq-prompt-k', html: `${icon('ally')}<span>Shadow ally</span>` }), h('span', { class: 'dq-prompt-t', text: typo(ART.allyHint) }));
      return;
    }
    if (!prompt) {
      promptRow.replaceChildren(
        h('span', { class: 'dq-prompt-k', html: `${icon('brush')}<span>Free page</span>` }),
        h('button', { type: 'button', class: 'dq-prompt-b', onclick: () => ((prompt = todayPrompt(app, promptRoll)), renderPrompt()) }, h('span', { text: 'Show a prompt' })),
      );
      return;
    }
    promptText.textContent = typo(prompt);
    promptRow.replaceChildren(
      h('span', { class: 'dq-prompt-k', html: `${icon('brush')}<span>Prompt</span>` }),
      promptText,
      h(
        'span',
        { class: 'dq-prompt-acts' },
        h('button', { type: 'button', class: 'dq-prompt-b', 'aria-label': 'Another prompt', onclick: () => ((prompt = todayPrompt(app, ++promptRoll)), renderPrompt()) }, h('span', { class: 'dq-prompt-ic', html: icon('shuffle') }), h('span', { class: 'dq-prompt-bt', text: 'Another' })),
        h('button', { type: 'button', class: 'dq-prompt-b', 'aria-label': 'No prompt', onclick: () => ((prompt = null), renderPrompt()) }, h('span', { class: 'dq-prompt-ic', html: icon('close') }), h('span', { class: 'dq-prompt-bt', text: 'No prompt' })),
      ),
    );
  };
  renderPrompt();
  // the companion renamed in another open copy: the prompt being drawn to takes the new name, and stays the same prompt
  offs.push(
    app.store.onChange(() => {
      if (prompt) promptText.textContent = typo(prompt);
    }),
  );

  // tools. Picking an ink while erasing goes back to the last way of painting.
  let paint: Tool = 'brush';
  const pickTool = (t: Tool) => {
    pad.tool = t;
    if (t !== 'erase') paint = t;
    sync();
  };
  const pickInk = (i: number) => {
    pad.inkIdx = i;
    if (pad.tool === 'erase') pad.tool = paint;
    sync();
  };
  const toolBtns = TOOLS.map((t) =>
    h('button', { type: 'button', role: 'radio', class: `dq-pen dq-pen--${t.id}`, 'aria-label': t.name, title: t.name, onclick: () => pickTool(t.id) }, h('span', { class: 'dq-pen-ic', html: icon(t.id === 'erase' ? 'eraser' : t.id) }), h('span', { class: 'dq-pen-n', text: t.name })),
  );
  const inkBtns = INKS.map((ink, i) =>
    h(
      'button',
      { type: 'button', role: 'radio', class: `dq-swatch dq-swatch--${ink.id}`, 'aria-label': `${ink.name} ink`, title: ink.name, onclick: () => pickInk(i) },
      h('span', { class: 'dq-swatch-dot', style: dotStyle(ink) }),
      h('span', { class: 'dq-swatch-n', text: ink.name }),
    ),
  );
  const sizeBtns = SIZES.map((sz, i) =>
    h('button', { type: 'button', role: 'radio', class: 'dq-size', 'aria-label': `${sz.name} size`, title: sz.name, onclick: () => ((pad.sizeIdx = i), sync()) }, h('span', { class: 'dq-size-dot', style: `--d:${[5, 10, 18][i]}px` }), h('span', { class: 'dq-size-n', text: sz.name })),
  );
  const icb = (ic: string, label: string, fn: () => void, cls = '') => h('button', { type: 'button', class: `dq-tool ${cls}`, 'aria-label': label, title: label, onclick: fn }, h('span', { class: 'dq-tool-ic', html: icon(ic) }), h('span', { class: 'dq-tool-n', text: label }));
  const undoB = icb('undo', 'Undo', () => pad.undo());
  const redoB = icb('redo', 'Redo', () => pad.redo());
  const clearB = icb('trash', 'Clear', () => askClear(), 'dq-tool--clear');
  const saveB = btn('Save', () => void save(), { kind: 'primary', cls: 'dq-save' });
  const acts = h('div', { class: 'dq-tools-acts' }, undoB, redoB, clearB, h('span', { class: 'dq-tools-gap' }), saveB);
  const confirmRow = h('div', { class: 'dq-tools-acts dq-tools-confirm is-hidden', role: 'group', 'aria-label': 'Clear the page' });
  // On a screen too short for the page with the prompt and every tool around it (a phone zoomed in), they fold into a
  // tray that opens over the page from a button showing the ink, with Undo and Save always beside it.
  const trayDot = h('span', { class: 'dq-swatch-dot' });
  const trayB = h('button', { type: 'button', class: 'dq-tool dq-tray-b', 'aria-label': 'Tools', title: 'Tools', 'aria-expanded': 'false', 'aria-controls': 'dq-tray', onclick: () => openTray(!trayOpen) }, trayDot);
  const trayActs = h('div', { class: 'dq-tools-acts' });
  const tray = h('div', { class: 'dq-tray is-hidden', id: 'dq-tray', role: 'group', 'aria-label': 'Tools' }, trayActs);
  let trayOpen = false;
  // open, the tray is a sheet: Back and Escape close it first, back to the Tools button
  let trayDone: (() => void) | null = null;
  const openTray = (on: boolean) => {
    trayOpen = on;
    trayB.setAttribute('aria-expanded', String(on));
    tray.classList.toggle('is-hidden', !on);
    if (on) {
      trayDone ??= app.sheet(() => {
        openTray(false);
        trayB.focus({ preventScroll: true });
      });
    } else {
      trayDone?.();
      trayDone = null;
    }
  };
  const askClear = () => {
    if (!pad.strokes.length) return;
    confirmRow.replaceChildren(
      h('span', { class: 'dq-confirm-t', text: typo(ART.clearAsk) }),
      btn('Keep it', () => closeClear(), { kind: 'primary', cls: 'dq-btn--sm' }),
      btn('Clear', () => {
        pad.clear();
        dirty = true;
        closeClear();
      }, { kind: 'quiet', cls: 'dq-btn--sm' }),
    );
    clearB.parentElement!.classList.add('is-hidden');
    confirmRow.classList.remove('is-hidden');
    confirmRow.querySelector<HTMLElement>('.dq-btn--primary')?.focus();
  };
  const closeClear = () => {
    confirmRow.classList.add('is-hidden');
    clearB.parentElement!.classList.remove('is-hidden');
  };
  const sync = () => {
    toolBtns.forEach((b, i) => b.setAttribute('aria-checked', String(TOOLS[i].id === pad.tool)));
    tools.dataset.tool = pad.tool;
    inkBtns.forEach((b, i) => b.setAttribute('aria-checked', String(i === pad.inkIdx)));
    sizeBtns.forEach((b, i) => b.setAttribute('aria-checked', String(i === pad.sizeIdx)));
    trayDot.setAttribute('style', dotStyle(INKS[pad.inkIdx]));
    pad.el.style.setProperty('--ink', INKS[pad.inkIdx].body);
    tools.style.setProperty('--ink-b', INKS[pad.inkIdx].body);
    tools.style.setProperty('--ink-g', INKS[pad.inkIdx].halo);
    (undoB as HTMLButtonElement).disabled = !pad.canUndo;
    (redoB as HTMLButtonElement).disabled = !pad.canRedo;
    (clearB as HTMLButtonElement).disabled = !pad.strokes.length;
    (saveB as HTMLButtonElement).disabled = !pad.strokes.length;
  };
  const pick = h('div', { class: 'dq-tools-pick' }, radioKeys(h('div', { class: 'dq-inks', role: 'radiogroup', 'aria-label': 'Ink' }, inkBtns)), radioKeys(h('div', { class: 'dq-pens', role: 'radiogroup', 'aria-label': 'Tool' }, toolBtns)), radioKeys(h('div', { class: 'dq-sizes', role: 'radiogroup', 'aria-label': 'Size' }, sizeBtns)));
  const tools = h('div', { class: 'dq-tools' }, pick, acts, confirmRow, msg);

  const persist = async (name?: string) => {
    if (!key.endsWith(`:${tab.id}`)) key = own(recId);
    const now = app.store.now();
    const first = !recId;
    const id = recId ?? uid();
    recId = id;
    const snap = pad.strokes;
    const next: DrawingRec = {
      // fields a newer build stored on the drawing stay on it
      ...(rec ? extrasOf(rec) : {}),
      id,
      kind,
      day: rec?.day ?? app.store.today(),
      t: rec?.t ?? now,
      updated: now,
      prompt: kind === 'today' ? (prompt ?? undefined) : undefined,
      name: kind === 'ally' ? (name ?? rec?.name) : rec?.name,
      nameAt: kind === 'ally' && name !== undefined && name !== rec?.name ? Math.max(Date.now(), (rec?.nameAt ?? -1) + 1) : rec?.nameAt,
      fav: rec?.fav,
      favAt: rec?.favAt,
      n: pad.strokes.length,
      strokes: pad.strokes.slice(),
    };
    storing = true;
    const res = await as.put(first ? next : { ...next, bases: bases ?? [], after: rec?.updated }).finally(() => (storing = false));
    // removed in another tab meanwhile: the removal kept these strokes as a draft. A save that landed on the page went
    // with it, so that draft is the copy; one kept apart as its own page replaces the draft.
    const lost = recId !== id;
    if (lost && res.id === id) {
      dirty = true;
      flushDraft();
      return null;
    }
    // as stored: a name or favourite set later in another tab is the one it keeps
    const saved: DrawingRec = { ...next, ...res.labels, id: res.id, updated: res.updated };
    rec = saved;
    recId = res.id;
    const failed = res.stored === 'failed';
    bases = failed && res.id === id ? [...(bases ?? []), res.rev].slice(-8) : [res.rev];
    const copied = res.id !== id;
    const oldKey = key.endsWith(`:${tab.id}`) ? key : own(first ? undefined : id);
    key = oldKey;
    // a copy kept only in memory rewrites the removal's draft in place, so the strokes stay on disk as one draft
    if (copied && !(lost && failed)) key = own(res.id);
    if (failed) {
      dirty = true;
      flushDraft();
    } else if (pad.strokes === snap) {
      dirty = false;
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = 0;
      await as.dropDraft(oldKey);
    } else {
      flushDraft();
      if (copied) await as.dropDraft(oldKey);
    }
    const xp = creditArt(app, kind);
    app.sound('check');
    return { first, xp, rec: saved, copied, failed };
  };

  const save = async () => {
    if (!pad.strokes.length || saving) return;
    openTray(false);
    if (kind === 'ally') return nameSheet();
    saving = true;
    const result = await persist().finally(() => (saving = false));
    if (!result) return;
    const { first, xp, rec: saved, copied, failed } = result;
    void prepImage(saved);
    const imgB = btn('Save image', async () => say(savedText(await saveImage(saved))), { kind: 'link' });
    say(h('span', { class: 'dq-tools-saved', text: typo(copied ? KEPT_APART : first ? ART.saved : ART.savedAgain) }), xp ? h('span', { class: 'dq-xp', text: '+10 XP' }) : null, imgB, btn('Art room', () => app.go({ name: 'art' }), { kind: 'link' }));
    if (failed || !as.persistent) say(copied ? h('span', { class: 'dq-tools-saved', text: typo(KEPT_APART) }) : null, p(ART.noStore, 'dq-small'), imgB);
  };

  // ally: name it, then it rises
  const sheet = h('div', { class: 'dq-sheet is-hidden', role: 'dialog', 'aria-modal': 'true' });
  let nameDone: (() => void) | null = null;
  const hideName = (focus: boolean) => {
    sheet.classList.add('is-hidden');
    nameDone?.();
    nameDone = null;
    if (focus) saveB.focus({ preventScroll: true });
  };
  const nameSheet = () => {
    const f = field(ART.nameAsk, { value: rec?.name ?? '', placeholder: 'Shadow ally', max: 24, hideLabel: true, autocomplete: 'off' });
    const vi = app.store.visitIndex();
    const ideas = [0, 1, 2, 3].map((k) => ALLY_NAMES[(vi * 3 + k) % ALLY_NAMES.length]);
    const go = async () => {
      if (saving) return;
      const name = f.input.value.trim().slice(0, 24);
      hideName(false);
      saving = true;
      const result = await persist(name || undefined).finally(() => (saving = false));
      if (!result) return;
      const { xp, rec: saved, copied, failed } = result;
      void prepImage(saved);
      rise(saved, xp);
      const notes = [copied ? KEPT_APART : null, failed ? ART.noStore : null].filter((t): t is string => !!t);
      if (notes.length) {
        riseEl.querySelector<HTMLElement>('.dq-rise-msg')!.textContent = notes.map((t) => typo(t)).join(' ');
        say(...notes.map((t) => p(t, 'dq-small')));
      }
    };
    f.input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && void go());
    sheet.replaceChildren(
      panel(
        { cls: 'dq-sheet-p' },
        h(
          'div',
          { class: 'dq-sheet-top' },
          h('h2', { class: 'dq-sheet-h', id: 'dq-sheet-h', text: ART.nameAsk }),
          h('button', { type: 'button', class: 'dq-icbtn dq-sheet-x', 'aria-label': 'Back to drawing', html: icon('close'), onclick: () => hideName(true) }),
        ),
        p(ART.nameHint, 'dq-small'),
        f.el,
        h('div', { class: 'dq-opts dq-opts--names' }, ideas.map((n) => chip(n, () => ((f.input.value = n), f.input.focus())))),
        h('div', { class: 'dq-actions' }, btn('Rise', () => void go(), { kind: 'primary' }), btn('Back to drawing', () => hideName(true), { kind: 'link' })),
      ),
    );
    sheet.setAttribute('aria-labelledby', 'dq-sheet-h');
    sheet.classList.remove('is-hidden');
    nameDone ??= app.sheet(() => hideName(true));
    if (!app.reduced()) animate(sheet.firstElementChild!, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' });
    f.input.focus({ preventScroll: true });
  };

  const riseEl = h('div', { class: 'dq-rise is-hidden', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'A new shadow ally' });
  let riseDone: (() => void) | null = null;
  const hideRise = () => {
    const inside = riseEl.contains(document.activeElement);
    riseEl.classList.add('is-hidden');
    riseDone?.();
    riseDone = null;
    if (inside) saveB.focus({ preventScroll: true });
  };
  const rise = (saved: DrawingRec, xp: boolean) => {
    const art = renderDrawing(saved.strokes, 'ally', 720);
    art.className = 'dq-thumb';
    const card = allyCard(app, saved, art);
    const motes = h('div', { class: 'dq-rise-motes', 'aria-hidden': 'true' }, Array.from({ length: 9 }, (_, k) => h('i', { style: `--x:${8 + ((k * 37) % 84)}%;--d:${(k * 0.37) % 1.6}s;--s:${0.6 + ((k * 13) % 7) / 10}` })));
    riseEl.replaceChildren(
      h('div', { class: 'dq-rise-bg', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'dq-rise-in' },
        h('p', { class: 'dq-rise-sys' }, h('span', { class: 'dq-line-tag', text: '[LANTERN]' }), h('span', { text: typo(ART.risen) })),
        h('div', { class: 'dq-rise-stage' }, h('div', { class: 'dq-rise-pool', 'aria-hidden': 'true' }), motes, h('div', { class: 'dq-rise-clip' }, h('div', { class: 'dq-rise-card' }, card))),
        xp ? h('p', { class: 'dq-rise-xp' }, h('span', { class: 'dq-xp', text: '+10 XP' })) : null,
        h(
          'div',
          { class: 'dq-actions dq-actions--center dq-rise-acts' },
          btn('See your army', () => app.go({ name: 'shadows' }), { kind: 'primary', ic: 'shadows' }),
          btn('Save card image', async () => {
            const res = await saveImage(saved);
            riseMsg.textContent = savedText(res);
          }, { kind: 'quiet', ic: 'image' }),
          btn('Keep drawing', hideRise, { kind: 'link' }),
        ),
        h('p', { class: 'dq-hint dq-rise-msg', 'aria-live': 'polite' }),
      ),
    );
    const riseMsg = riseEl.querySelector<HTMLElement>('.dq-rise-msg')!;
    riseEl.classList.remove('is-hidden');
    riseDone ??= app.sheet(hideRise);
    app.sound('soft_chime');
    const still = app.reduced();
    const q = (s: string) => riseEl.querySelector<HTMLElement>(s)!;
    animate(q('.dq-rise-bg'), [{ opacity: 0 }, { opacity: 1 }], { duration: 500 });
    if (still) {
      animate(q('.dq-rise-in'), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
      return;
    }
    animate(q('.dq-rise-sys'), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 150, easing: 'cubic-bezier(.16,1,.3,1)' });
    animate(q('.dq-rise-pool'), [{ opacity: 0, transform: 'translateX(-50%) scale(0.2, 0.6)' }, { opacity: 1, transform: 'translateX(-50%) scale(1, 1)' }], { duration: 900, delay: 250, easing: 'cubic-bezier(.16,1,.3,1)' });
    animate(q('.dq-rise-card'), [{ transform: 'translateY(104%)' }, { transform: 'translateY(0)' }], { duration: 1500, delay: 650, easing: 'cubic-bezier(.22,1,.36,1)' });
    animate(q('.dq-rise-card'), [{ filter: 'brightness(0.35)' }, { filter: 'brightness(1)' }], { duration: 1300, delay: 1100, easing: 'ease-out' });
    for (const s of ['.dq-rise-xp', '.dq-rise-acts']) {
      const e = riseEl.querySelector(s);
      if (e) animate(e, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 2000 });
    }
  };

  const hint = h('p', { class: 'dq-draw-hint', 'aria-hidden': 'true', text: matchMedia('(pointer: coarse)').matches ? 'Tap two fingers to undo' : 'Draw anywhere on the page.' });
  const fit = h('div', { class: 'dq-draw-fit' }, h('div', { class: `dq-draw-frame dq-draw-frame--${kind}` }, pad.el, hint));
  const frame = fit.firstElementChild as HTMLElement;
  // a tap on the page while the tray is open closes it, and draws nothing
  fit.addEventListener(
    'pointerdown',
    (e) => {
      if (!trayOpen) return;
      e.stopPropagation();
      openTray(false);
    },
    true,
  );
  // over a small page the note after a save can cover all of it: a tap on its words puts it away, so the page takes
  // strokes again (its links still do what they say)
  msg.addEventListener('click', (e) => {
    if (folded && !(e.target as Element).closest('button, a')) say();
  });
  const main = h('div', { class: 'dq-draw-main' }, fit, tools);
  // the height the page keeps with the prompt and every tool around it; a screen that can't give it that folds them
  // into the tray (the page itself is never moved, so a stroke in progress carries on)
  const ROOM = 180;
  // the height of the page's room the tray needs to show a tool whole (44 px, with its padding)
  const TRAY_ROOM = 62;
  let folded = false;
  // whether the note after a save sits in the tools when they are laid out unfolded (beside a wide screen's page)
  let noteInTools = false;
  const place = (on: boolean) => {
    if (on === folded) return;
    folded = on;
    el.classList.toggle('dq-draw--tray', on);
    if (on) {
      trayActs.append(redoB, clearB);
      tray.prepend(promptRow, pick);
      tray.append(confirmRow);
      tools.prepend(trayB, tray);
    } else {
      el.insertBefore(promptRow, main);
      tools.prepend(pick);
      undoB.after(redoB, clearB);
      acts.after(confirmRow);
      trayB.remove();
      tray.remove();
    }
  };
  const room = () => {
    const side = getComputedStyle(main).display === 'contents';
    const box = side ? el : main;
    const row = side || getComputedStyle(main).flexDirection === 'row';
    const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
    const pad2 = row && !folded ? 12 : 0;
    const w = row ? box.clientWidth - tools.offsetWidth - gap - pad2 : fit.clientWidth;
    return { side, row, gap, pad2, w, hh: fit.clientHeight - pad2 };
  };
  const layout = () => {
    const was = folded;
    const had = document.activeElement;
    // measured with every tool laid out, and the page taking no room of its own
    place(false);
    frame.style.width = frame.style.height = '0px';
    const full = room();
    // the note after a save placed as it lies unfolded: over the page, or in a wide screen's tools, where it takes room
    // of its own and so counts in what has to fit
    noteInTools = full.row && !full.side;
    tools.classList.toggle('dq-tools--over', !noteInTools);
    const b = el.getBoundingClientRect();
    const inside = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    };
    place(Math.min(full.hh, (full.w * pad.H) / pad.W) < ROOM || !inside(promptRow) || !inside(tools));
    if (folded !== was) {
      // an open Clear question moves with Clear, and opens the tray it is now in
      const asking = !confirmRow.classList.contains('is-hidden');
      acts.classList.remove('is-hidden');
      trayActs.classList.remove('is-hidden');
      if (asking) clearB.parentElement!.classList.add('is-hidden');
      openTray(folded && (asking || tray.contains(had)));
    }
    // the Tools button goes as the tools unfold: focus moves to the ink it showed
    const back = had === trayB && !folded ? inkBtns[pad.inkIdx] : had;
    if (back instanceof HTMLElement && back !== document.activeElement && back.isConnected) back.focus({ preventScroll: true });
    const { side, row, gap, pad2, w, hh } = room();
    // the note after a save lies over the page everywhere but beside a wide screen's page, where it sits in the tools
    tools.classList.toggle('dq-tools--over', !row || side || folded);
    // no room for the page at all (a short screen zoomed in): none of it shows, not even its frame, and nothing kept
    // from a roomier layout may reach past the screen, so the page keeps the zero size it was measured at
    const none = w <= 0 || hh <= 0;
    frame.classList.toggle('is-hidden', none);
    if (none) {
      fit.style.flex = '';
      promptRow.style.width = '';
    } else {
      const a = pad.W / pad.H;
      const fw = Math.floor(Math.min(w, hh * a));
      frame.style.width = `${fw}px`;
      frame.style.height = `${Math.floor(fw / a)}px`;
      fit.style.flex = row && !side ? `0 0 ${fw + pad2}px` : '';
      promptRow.style.width = row && !side && !folded ? `${fw + pad2 + tools.offsetWidth + gap}px` : '';
      pad.moved();
      // the hint shows only on a page that holds all of it
      hint.classList.remove('is-hidden');
      hint.classList.toggle('is-hidden', hint.scrollWidth > hint.clientWidth || hint.offsetTop < 0);
    }
    // the room the note after a save covers from its foot wherever it lies over the page, and folded the tray too
    // (--room-*): the page's, or where that can't show a tool whole (a short screen zoomed in), from just below the top
    // bar (--dq-top) down over the tools from Undo on, so the Tools button stays in reach to close the tray
    const t = tools.getBoundingClientRect();
    const f = fit.getBoundingClientRect();
    const u = undoB.getBoundingClientRect();
    const bar = parseFloat(getComputedStyle(el).getPropertyValue('--dq-top')) || f.top;
    const r = folded && f.height < TRAY_ROOM ? new DOMRect(u.left, bar, t.right - u.left, t.bottom - bar) : f;
    tools.style.setProperty('--room-x', `${r.left - t.left - tools.clientLeft}px`);
    tools.style.setProperty('--room-b', `${t.top + tools.clientTop + tools.clientHeight - r.bottom}px`);
    tools.style.setProperty('--room-w', `${r.width}px`);
    tools.style.setProperty('--room-h', `${r.height}px`);
  };
  const ro = new ResizeObserver(layout);
  const el = h(
    'div',
    { class: `dq-draw dq-draw--${kind}` },
    h('h1', { class: 'dq-sr', 'data-focus': '', text: kind === 'ally' ? ART.allyTitle : ART.todayTitle }),
    promptRow,
    main,
  );
  sync();

  const key$ = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || (e.target as HTMLElement)?.closest?.('input,textarea')) return;
    e.preventDefault();
    if (e.shiftKey) pad.redo();
    else pad.undo();
  };
  const vis = () => document.visibilityState === 'hidden' && flushDraft();
  window.addEventListener('keydown', key$);
  document.addEventListener('visibilitychange', vis);
  window.addEventListener('pagehide', flushDraft);
  offs.push(() => window.removeEventListener('keydown', key$), () => document.removeEventListener('visibilitychange', vis), () => window.removeEventListener('pagehide', flushDraft));
  offs.push(as.onRemove((id) => {
    if (recId !== id) return;
    recId = null;
    rec = null;
    bases = undefined;
    // a save still on its way to the disk may keep these strokes as their own page, so they stay until it lands
    if (dirty || pad.drawing || storing) {
      dirty = true;
      flushDraft();
      say(p(ART.draft, 'dq-small'));
    } else {
      loading = true;
      pad.load([]);
      loading = false;
      say(p('That page is no longer here. This is a fresh one.', 'dq-small'));
    }
  }));

  void (async () => {
    await tab.ready;
    if (left) return;
    key = own(editId);
    let draft: Draft | null = null;
    // the draft it opened from, or coming back, the one its strokes went to: the first is in that one by now
    const from = was ? was.key : r.draft;
    if (from) {
      draft = await as.getDraft(from);
      if (draft?.key.endsWith(`:${tab.id}`)) key = draft.key;
    }
    if (!draft) draft = await as.getDraft(key);
    if (!draft && !from) {
      // this tab's other draft of the same page (a page first saved from a fresh screen), else one an earlier session
      // left; a younger draft may belong to a tab that is still open, so it only waits in the Art room
      const same = (await as.drafts()).filter((d) => (editId ? d.editId === editId : d.kind === kind && !d.editId));
      const found = same.find((d) => d.key.endsWith(`:${tab.id}`)) ?? same.find((d) => !(Date.now() - d.t < ORPHAN_MS));
      if (found) {
        draft = found;
        if (found.key.endsWith(`:${tab.id}`)) key = found.key;
      }
    }
    const id = editId ?? draft?.editId;
    if (id) {
      recId = id;
      rec = await as.get(id);
      if (rec) {
        const old = draft?.editId === id ? draft : null;
        bases = !old ? [revOf(rec)] : Array.isArray(old.bases) ? old.bases.filter((b): b is string => typeof b === 'string').slice(-8) : [];
      }
      if (!rec) {
        recId = null;
        say(p('That page is no longer here. This is a fresh one.', 'dq-small'));
      } else if (kind === 'today' && rec.prompt) {
        prompt = rec.prompt;
        renderPrompt();
      }
    }
    if (left) return;
    if (draft) {
      if (draft.prompt !== undefined && kind === 'today') {
        prompt = draft.prompt;
        renderPrompt();
      }
      pad.load(draft.strokes as Stroke[]);
      dirty = true;
      flushDraft();
    } else if (rec) pad.load(rec.strokes);
    loading = false;
    pad.el.inert = false;
    if (pad.strokes.length) hint.classList.add('is-gone');
    if (!as.persistent) say(p(ART.noStore, 'dq-small'));
  })();

  return {
    el,
    title: kind === 'ally' ? ART.allyTitle : ART.todayTitle,
    mode: 'sub',
    bubbles: [0, 0],
    // read as the visit comes back, so a save that lands after they leave (as a copy kept apart too) is what opens
    keep: (): DrawKept => ({
      get id() {
        return recId;
      },
      get key() {
        return key;
      },
    }),
    after: () => {
      app.sheetLayer.append(sheet, riseEl);
      ro.observe(main);
      ro.observe(el);
      layout();
    },
    leave: () => {
      left = true;
      sheet.remove();
      riseEl.remove();
      flushDraft();
      ro.disconnect();
      offs.forEach((f) => f());
      if (app.ink === pad) app.ink = null;
      pad.destroy();
    },
  };
}

// ---------------- One saved piece ----------------
export function pieceScreen(app: App, route: Route): ScreenOut {
  const id = (route as Extract<Route, { name: 'piece' }>).id;
  const as = store(app);
  const body = h('div', { class: 'dq-piece-body' });
  let removed = false;
  let endRename = () => {};
  const missing = () => {
    endRename();
    body.replaceChildren(p('That page is no longer here.', 'dq-text dq-empty'), h('div', { class: 'dq-actions' }, btn('Art room', () => app.go({ name: 'art' }), { kind: 'quiet' })));
  };
  const off = as.onRemove((gone) => {
    if (gone !== id) return;
    removed = true;
    missing();
  });
  // hidden while a removal's Undo lasts (from this tab or another): it shows as gone, and comes back with the Undo
  let hidden = false;
  const offShown = as.onChange(() => {
    void as.isShown(id).then((on) => {
      if (removed || on !== hidden) return;
      if (on) return app.go({ name: 'piece', id }, { replace: true, quiet: true });
      hidden = true;
      missing();
    });
  });
  let offChange = () => {};
  const el = h('div', { class: 'dq-page dq-piece' }, h('h1', { class: 'dq-sr', 'data-focus': '', text: 'Your page' }), body);
  void (async () => {
    let rec = await as.get(id);
    const on = !!rec && (await as.isShown(id));
    if (!rec || !on || removed || hidden) {
      if (!removed) hidden = true;
      missing();
      return;
    }
    const ally = rec.kind === 'ally';
    const dpr = Math.min(2, devicePixelRatio || 1);
    const outW = Math.min(PAGE[rec.kind].w, Math.round(Math.min(560, innerWidth - 32) * dpr));
    let art: HTMLCanvasElement, card: HTMLElement | null;
    const draw = (r: DrawingRec) => {
      art = renderDrawing(r.strokes, r.kind, outW);
      art.className = 'dq-thumb';
      art.setAttribute('role', 'img');
      card = ally ? allyCard(app, r, art) : null;
      return card ?? art;
    };
    const artBox = h('div', { class: `dq-piece-art dq-piece-art--${rec.kind}` }, draw(rec));
    const status = h('p', { class: 'dq-hint', 'aria-live': 'polite' });
    void prepImage(rec);
    const title = h('h2', { class: 'dq-h1 dq-piece-h' });
    const day = p(dayLabel(rec.day), 'dq-small dq-piece-day');
    const fav = h('button', { type: 'button', class: 'dq-btn dq-btn--quiet dq-piece-fav', 'aria-pressed': 'false', onclick: () => {
      rec = { ...rec!, fav: !rec!.fav };
      paint();
      void as.setLabels(id, { fav: rec.fav });
    } }, h('span', { class: 'dq-btn-ic', html: icon('star') }), h('span', { class: 'dq-btn-t', text: ART.favourite }));
    const renameB = btn(ART.rename, () => openRename(), { kind: 'quiet', ic: 'pencil' });
    const labels = h('div', { class: 'dq-actions dq-piece-labels' }, fav, renameB);
    const form = h('div', { class: 'dq-piece-rename is-hidden', role: 'group', 'aria-label': ART.rename });
    let editing = false;
    // the name field opens over the page: Back and Escape close it like any sheet
    let renameDone: (() => void) | null = null;
    // what the drawing is called and whether it is a favourite, as it is stored now
    const paint = () => {
      const r = rec!;
      const name = r.name?.trim();
      title.textContent = ally ? typo(name || 'Shadow ally') : name ? typo(name) : dayLabel(r.day);
      day.classList.toggle('is-hidden', ally || !name);
      fav.setAttribute('aria-pressed', String(!!r.fav));
      art.setAttribute('aria-label', ally ? `${name || 'Shadow ally'}, your shadow ally` : name ? `${name}, your page from ${dayLabel(r.day)}` : `Your page from ${dayLabel(r.day)}`);
      const cardName = card?.querySelector('.dq-allycard-name');
      if (cardName) cardName.textContent = typo(name || 'Shadow ally');
    };
    const closeRename = (focus: boolean) => {
      editing = false;
      renameDone?.();
      renameDone = null;
      form.classList.add('is-hidden');
      labels.classList.remove('is-hidden');
      if (focus) renameB.focus();
    };
    endRename = () => closeRename(false);
    const openRename = () => {
      const r = rec!;
      const f = field(ally ? ART.nameAsk : ART.pageNameAsk, { value: r.name ?? '', placeholder: ally ? 'Shadow ally' : dayLabel(r.day), max: 24, autocomplete: 'off' });
      let typed = false;
      f.input.addEventListener('input', () => (typed = true));
      const save = async () => {
        if (!editing) return;
        const name = f.input.value.trim().slice(0, 24);
        if (typed && name !== (rec!.name?.trim() ?? '')) await as.setLabels(id, { name });
        if (removed || !editing) return;
        closeRename(true);
        const now = await as.get(id);
        if (now && !removed) take(now);
      };
      // an Enter that confirms an IME composition (keyCode 229 in Safari) finishes the word, not the name
      f.input.addEventListener('keydown', (e) => {
        const k = e as KeyboardEvent;
        if (k.key !== 'Enter' || k.isComposing || k.keyCode === 229) return;
        k.preventDefault();
        void save();
      });
      form.replaceChildren(f.el, h('div', { class: 'dq-actions' }, btn('Save name', () => void save(), { kind: 'primary' }), btn('Cancel', () => closeRename(true), { kind: 'quiet' })));
      editing = true;
      renameDone ??= app.sheet(() => {
        renameDone = null;
        closeRename(true);
      });
      labels.classList.add('is-hidden');
      form.classList.remove('is-hidden');
      f.input.focus();
      f.input.select();
    };
    // a name or favourite set here or in another tab shows at once; a newer version saved in another tab redraws the
    // drawing in place, so what Remove takes away is the version on screen
    const take = (now: DrawingRec) => {
      if (revOf(now) !== revOf(rec!)) artBox.replaceChildren(draw(now));
      rec = now;
      paint();
      if (ally) void prepImage(now);
    };
    offChange = as.onChange(() => {
      void as.get(id).then((now) => {
        if (!now || removed) return;
        take(now);
      });
    });
    const actions = h(
      'div',
      { class: 'dq-actions' },
      btn(ally ? 'Save card image' : 'Save image', async () => (status.textContent = savedText(await saveImage(rec!))), { kind: 'primary', ic: 'image' }),
      btn('Keep drawing', () => app.go({ name: 'draw', kind: rec!.kind, id }), { kind: 'quiet', ic: 'brush' }),
      btn(ally ? 'Release' : 'Remove', () => {
        // it leaves every screen, in every tab, now and stays stored until the Undo runs out
        let done = false;
        removed = true;
        as.hide(id, revOf(rec!));
        app.go({ name: ally ? 'shadows' : 'art' }, { replace: true });
        app.toast(ally ? ART.released : ART.removed, {
          label: 'Undo',
          run: () => {
            if (done) return;
            done = true;
            // the list it went back to takes focus to it
            if (app.route.name === (ally ? 'shadows' : 'art')) back = id;
            as.unhide(id);
          },
          end: () => {
            if (done) return;
            done = true;
            void as.remove(id);
          },
        });
      }, { kind: 'link' }),
    );
    paint();
    body.replaceChildren(
      artBox,
      h(
        'div',
        { class: 'dq-piece-side' },
        title,
        day,
        ally ? p(`Shadow ally, drawn ${dayLabel(rec.day)}. Part of your army.`, 'dq-text') : rec.prompt ? p(rec.prompt, 'dq-text dq-piece-prompt') : p('A free page.', 'dq-text dq-piece-prompt'),
        labels,
        form,
        actions,
        status,
      ),
    );
  })();
  return { el, title: 'Your page', mode: 'sub', bubbles: [1.6, 0.6], leave: () => { removed = true; endRename(); off(); offShown(); offChange(); } };
}
