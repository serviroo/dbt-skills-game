/**
 * Art room: a finger-drawing page with glowing Lantern ink. Two ways in: "Draw today" (a blank page, optional prompt)
 * and "Design a shadow ally" (the drawing becomes the art on a new Shadow card). Nothing is graded.
 */
import { animate } from '../ui/anim';
import { ALLY_NAMES, ART, ART_PROMPTS } from '../content/daily-lines';
import { playerName } from '../core/you';
import { TAB_KEY } from '../core/stored-names';
import type { App, Route, ScreenOut } from './app';
import { icon } from './art';
import { artStore, revOf, type Draft, type DrawingMeta, type DrawingRec } from './artstore';
import { canvasBlob, INKS, InkPad, PAGE, renderDrawing, SIZES, type Paper, type Stroke } from './ink';
import { dayLabel } from './lines';
import { uid } from './store';
import { btn, chip, field, h, p, panel, shareOrSave, typo } from './ui';

const store = (app: App) => artStore(app.store.key);
const KEPT_APART = 'A newer copy of this drawing arrived, so this one was kept as its own page.';
const pageHead = (title: string, sub?: string) => h('header', { class: 'dq-pagehead' }, h('h1', { class: 'dq-h1', 'data-focus': '', text: title }), sub ? p(sub, 'dq-text dq-pagesub') : null);

let tabId = '';
/** Every draft belongs to the tab drawing it, so two open tabs never write over (or save away) each other's strokes. */
function thisTab() {
  if (!tabId) {
    try {
      tabId = sessionStorage.getItem(TAB_KEY) || '';
      if (!tabId) sessionStorage.setItem(TAB_KEY, (tabId = uid()));
    } catch {
      tabId ||= uid();
    }
  }
  return tabId;
}
/** A draft untouched this long was left by an earlier session (iOS can hand a relaunched app a new tab id). */
const ORPHAN_MS = 120e3;

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

/** A shadow ally as a full-art Shadow card. */
export function allyCard(app: App, m: DrawingMeta, img?: HTMLImageElement | HTMLCanvasElement) {
  const name = m.name?.trim() || 'Shadow ally';
  return h(
    'div',
    { class: 'dq-cardface dq-allycard' },
    h('div', { class: 'dq-allycard-art' }, img ?? thumbImg(app, m, `${name}, drawn by you`)),
    h('div', { class: 'dq-allycard-top' }, h('span', { class: 'dq-allycard-tag', html: `${icon('ally')}<span>Shadow ally</span>` })),
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
      entry('today', ART.todayTitle, ART.todaySub, h('span', { class: 'dq-artentry-prompt', text: typo(todayPrompt(app)) })),
      entry('ally', ART.allyTitle, ART.allySub, null),
    ),
    h('section', { class: 'dq-art-pages', 'aria-labelledby': 'dq-pages-h' }, h('h2', { class: 'dq-sec-h', id: 'dq-pages-h' }, h('span', { text: ART.pages })), gallery, note),
  );
  void (async () => {
    const [list, drafts] = await Promise.all([as.list(), as.drafts()]);
    if (!as.persistent) note.classList.remove('is-hidden');
    const d = drafts[0];
    if (d) {
      draftBox.classList.remove('is-hidden');
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
    if (!list.length) {
      gallery.replaceChildren(p(ART.pagesEmpty, 'dq-text dq-empty'));
      return;
    }
    gallery.replaceChildren(
      ...list.map((m) =>
        h(
          'button',
          { type: 'button', class: `dq-galitem dq-galitem--${m.kind}`, onclick: () => app.go({ name: 'piece', id: m.id }), 'aria-label': m.kind === 'ally' ? `${m.name || 'Shadow ally'}, a shadow ally from ${dayLabel(m.day)}` : `Page from ${dayLabel(m.day)}` },
          m.kind === 'ally' ? allyCard(app, m) : h('span', { class: 'dq-galitem-img' }, thumbImg(app, m, '')),
          h('span', { class: 'dq-galitem-d', text: m.kind === 'ally' ? `${m.name || 'Shadow ally'} · ${dayLabel(m.day)}` : dayLabel(m.day) }),
        ),
      ),
    );
  })();
  return { el, title: ART.title, mode: 'sub', bubbles: [1.6, 0.6] };
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
export function drawScreen(app: App, route: Route): ScreenOut {
  const r = route as Extract<Route, { name: 'draw' }>;
  const kind: Paper = r.kind === 'ally' ? 'ally' : 'today';
  const as = store(app);
  const tab = thisTab();
  const own = (id?: string | null) => (id ? `edit:${id}:${tab}` : `${kind}:${tab}`);
  let key = own(r.id);
  let saving = false;
  let recId = r.id ?? null;
  let rec: DrawingRec | null = null;
  let bases: string[] | undefined;
  let promptRoll = 0;
  let prompt: string | null = kind === 'today' ? todayPrompt(app) : null;
  let dirty = false;
  let draftTimer = 0;
  const offs: (() => void)[] = [];

  const msg = h('div', { class: 'dq-tools-msg', 'aria-live': 'polite' });
  const say = (...kids: (Node | string | null)[]) => msg.replaceChildren(...kids.filter((k): k is Node | string => k !== null));

  const flushDraft = () => {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = 0;
    if (!dirty) return;
    if (!pad.strokes.length && !recId) return void as.dropDraft(key);
    void as.putDraft({ key, kind, editId: recId ?? undefined, bases: recId ? bases : undefined, prompt, strokes: pad.strokes, t: Date.now() });
  };
  const pad = new InkPad({
    kind,
    still: () => app.reduced(),
    onChange: () => {
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

  // tools
  const inkBtns = INKS.map((ink, i) =>
    h(
      'button',
      { type: 'button', role: 'radio', class: `dq-swatch dq-swatch--${ink.id}`, 'aria-label': `${ink.name} ink`, title: ink.name, onclick: () => ((pad.inkIdx = i), sync()) },
      h('span', { class: 'dq-swatch-dot', style: `--b:${ink.body};--c:${ink.core ?? ink.mid ?? ink.body};--g:${ink.halo}` }),
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
    acts.classList.add('is-hidden');
    confirmRow.classList.remove('is-hidden');
    confirmRow.querySelector<HTMLElement>('.dq-btn--primary')?.focus();
  };
  const closeClear = () => {
    confirmRow.classList.add('is-hidden');
    acts.classList.remove('is-hidden');
  };
  const sync = () => {
    inkBtns.forEach((b, i) => b.setAttribute('aria-checked', String(i === pad.inkIdx)));
    sizeBtns.forEach((b, i) => b.setAttribute('aria-checked', String(i === pad.sizeIdx)));
    pad.el.style.setProperty('--ink', INKS[pad.inkIdx].body);
    tools.style.setProperty('--ink-b', INKS[pad.inkIdx].body);
    tools.style.setProperty('--ink-g', INKS[pad.inkIdx].halo);
    (undoB as HTMLButtonElement).disabled = !pad.canUndo;
    (redoB as HTMLButtonElement).disabled = !pad.canRedo;
    (clearB as HTMLButtonElement).disabled = !pad.strokes.length;
    (saveB as HTMLButtonElement).disabled = !pad.strokes.length;
  };
  const tools = h(
    'div',
    { class: 'dq-tools' },
    h('div', { class: 'dq-tools-pick' }, h('div', { class: 'dq-inks', role: 'radiogroup', 'aria-label': 'Ink' }, inkBtns), h('div', { class: 'dq-sizes', role: 'radiogroup', 'aria-label': 'Size' }, sizeBtns)),
    acts,
    confirmRow,
    msg,
  );

  const persist = async (name?: string) => {
    const now = app.store.now();
    const first = !recId;
    const id = recId ?? uid();
    recId = id;
    const snap = pad.strokes;
    const next: DrawingRec = {
      id,
      kind,
      day: rec?.day ?? app.store.today(),
      t: rec?.t ?? now,
      updated: now,
      prompt: kind === 'today' ? (prompt ?? undefined) : undefined,
      name: kind === 'ally' ? (name ?? rec?.name) : undefined,
      n: pad.strokes.length,
      strokes: pad.strokes.map((s) => ({ i: s.i, w: s.w, p: s.p })),
    };
    const res = await as.put(first ? next : { ...next, bases: bases ?? [], after: rec?.updated });
    const saved: DrawingRec = { ...next, id: res.id, updated: res.updated };
    rec = saved;
    recId = res.id;
    const failed = res.stored === 'failed';
    bases = failed && res.id === id ? [...(bases ?? []), res.rev].slice(-8) : [res.rev];
    const copied = res.id !== id;
    const oldKey = key;
    if (copied) key = own(res.id);
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
    if (kind === 'ally') return nameSheet();
    saving = true;
    const { first, xp, rec: saved, copied, failed } = await persist().finally(() => (saving = false));
    void prepImage(saved);
    const imgB = btn('Save image', async () => say(savedText(await saveImage(saved))), { kind: 'link' });
    say(h('span', { class: 'dq-tools-saved', text: typo(copied ? KEPT_APART : first ? ART.saved : ART.savedAgain) }), xp ? h('span', { class: 'dq-xp', text: '+10 XP' }) : null, imgB, btn('Art room', () => app.go({ name: 'art' }), { kind: 'link' }));
    if (failed || !as.persistent) say(copied ? h('span', { class: 'dq-tools-saved', text: typo(KEPT_APART) }) : null, p(ART.noStore, 'dq-small'), imgB);
  };

  // ally: name it, then it rises
  const sheet = h('div', { class: 'dq-sheet is-hidden', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dq-sheet-h' });
  const nameSheet = () => {
    const f = field(ART.nameAsk, { value: rec?.name ?? '', placeholder: 'Shadow ally', max: 24, hideLabel: true, autocomplete: 'off' });
    const vi = app.store.visitIndex();
    const ideas = [0, 1, 2, 3].map((k) => ALLY_NAMES[(vi * 3 + k) % ALLY_NAMES.length]);
    const go = async () => {
      if (saving) return;
      const name = f.input.value.trim().slice(0, 24);
      sheet.classList.add('is-hidden');
      saving = true;
      const { xp, rec: saved, copied, failed } = await persist(name || undefined).finally(() => (saving = false));
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
        h('h2', { class: 'dq-sheet-h', id: 'dq-sheet-h', text: ART.nameAsk }),
        p(ART.nameHint, 'dq-small'),
        f.el,
        h('div', { class: 'dq-opts dq-opts--names' }, ideas.map((n) => chip(n, () => ((f.input.value = n), f.input.focus())))),
        h('div', { class: 'dq-actions' }, btn('Rise', () => void go(), { kind: 'primary' }), btn('Back to drawing', () => sheet.classList.add('is-hidden'), { kind: 'link' })),
      ),
    );
    sheet.classList.remove('is-hidden');
    if (!app.reduced()) animate(sheet.firstElementChild!, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' });
    f.input.focus({ preventScroll: true });
  };

  const riseEl = h('div', { class: 'dq-rise is-hidden', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'A new shadow ally' });
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
          btn('Keep drawing', () => riseEl.classList.add('is-hidden'), { kind: 'link' }),
        ),
        h('p', { class: 'dq-hint dq-rise-msg', 'aria-live': 'polite' }),
      ),
    );
    const riseMsg = riseEl.querySelector<HTMLElement>('.dq-rise-msg')!;
    riseEl.classList.remove('is-hidden');
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
  const layout = () => {
    const main = fit.parentElement!;
    const row = getComputedStyle(main).flexDirection === 'row';
    const pad2 = row ? 12 : 0;
    const w = row ? main.clientWidth - tools.offsetWidth - parseFloat(getComputedStyle(main).columnGap || '0') - pad2 : fit.clientWidth;
    const hh = fit.clientHeight - pad2;
    if (w <= 0 || hh <= 0) return;
    const a = pad.W / pad.H;
    const fw = Math.floor(Math.min(w, hh * a));
    frame.style.width = `${fw}px`;
    frame.style.height = `${Math.floor(fw / a)}px`;
    fit.style.flex = row ? `0 0 ${fw + pad2}px` : '';
    promptRow.style.width = row ? `${fw + pad2 + tools.offsetWidth + parseFloat(getComputedStyle(main).columnGap || '0')}px` : '';
  };
  const ro = new ResizeObserver(layout);
  const el = h(
    'div',
    { class: `dq-draw dq-draw--${kind}` },
    h('h1', { class: 'dq-sr', 'data-focus': '', text: kind === 'ally' ? ART.allyTitle : ART.todayTitle }),
    promptRow,
    h('div', { class: 'dq-draw-main' }, fit, tools),
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

  void (async () => {
    // a draft picked up here goes on under its own key: it is never copied or removed to resume it
    let draft: Draft | null = null;
    if (r.draft) {
      draft = await as.getDraft(r.draft);
      if (draft) key = r.draft;
    }
    if (!draft) draft = await as.getDraft(key);
    if (!draft && !r.draft) {
      // this tab's other draft of the same page (a page first saved from a fresh screen), else one an earlier session
      // left; a younger draft may belong to a tab that is still open, so it only waits in the Art room
      const same = (await as.drafts()).filter((d) => (r.id ? d.editId === r.id : d.kind === kind && !d.editId));
      const found = same.find((d) => d.key.endsWith(`:${tab}`)) ?? same.find((d) => !(Date.now() - d.t < ORPHAN_MS));
      if (found) {
        draft = found;
        key = found.key;
      }
    }
    const id = r.id ?? draft?.editId;
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
    if (draft) {
      if (draft.prompt !== undefined && kind === 'today') {
        prompt = draft.prompt;
        renderPrompt();
      }
      pad.load(draft.strokes as Stroke[]);
      dirty = true;
    } else if (rec) pad.load(rec.strokes);
    if (pad.strokes.length) hint.classList.add('is-gone');
    if (!as.persistent) say(p(ART.noStore, 'dq-small'));
  })();

  return {
    el,
    title: kind === 'ally' ? ART.allyTitle : ART.todayTitle,
    mode: 'sub',
    bubbles: [0, 0],
    after: () => {
      app.root.append(sheet, riseEl);
      ro.observe(fit.parentElement!);
      layout();
    },
    leave: () => {
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
  const el = h('div', { class: 'dq-page dq-piece' }, h('h1', { class: 'dq-sr', 'data-focus': '', text: 'Your page' }), body);
  void (async () => {
    const rec = await as.get(id);
    if (!rec) {
      body.replaceChildren(p('That page is no longer here.', 'dq-text dq-empty'), h('div', { class: 'dq-actions' }, btn('Art room', () => app.go({ name: 'art' }), { kind: 'quiet' })));
      return;
    }
    const dpr = Math.min(2, devicePixelRatio || 1);
    const outW = Math.min(PAGE[rec.kind].w, Math.round(Math.min(560, innerWidth - 32) * dpr));
    const art = renderDrawing(rec.strokes, rec.kind, outW);
    art.className = 'dq-thumb';
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', rec.kind === 'ally' ? `${rec.name || 'Shadow ally'}, your shadow ally` : `Your page from ${dayLabel(rec.day)}`);
    const status = h('p', { class: 'dq-hint', 'aria-live': 'polite' });
    const confirm = h('div', { class: 'dq-piece-confirm is-hidden' });
    void prepImage(rec);
    const actions = h(
      'div',
      { class: 'dq-actions' },
      btn(rec.kind === 'ally' ? 'Save card image' : 'Save image', async () => (status.textContent = savedText(await saveImage(rec))), { kind: 'primary', ic: 'image' }),
      btn('Keep drawing', () => app.go({ name: 'draw', kind: rec.kind, id: rec.id }), { kind: 'quiet', ic: 'brush' }),
      btn(rec.kind === 'ally' ? 'Release' : 'Remove', () => {
        confirm.replaceChildren(
          p(rec.kind === 'ally' ? ART.releaseAsk : ART.removeAsk, 'dq-text'),
          h(
            'div',
            { class: 'dq-actions' },
            btn('Keep it', () => confirm.classList.add('is-hidden'), { kind: 'quiet' }),
            btn(rec.kind === 'ally' ? 'Release' : 'Remove', async () => {
              await as.remove(rec.id);
              app.go({ name: rec.kind === 'ally' ? 'shadows' : 'art' }, { replace: true });
            }, { kind: 'link' }),
          ),
        );
        confirm.classList.remove('is-hidden');
      }, { kind: 'link' }),
    );
    body.replaceChildren(
      h('div', { class: `dq-piece-art dq-piece-art--${rec.kind}` }, rec.kind === 'ally' ? allyCard(app, rec, art) : art),
      h(
        'div',
        { class: 'dq-piece-side' },
        h('h2', { class: 'dq-h1 dq-piece-h', text: rec.kind === 'ally' ? typo(rec.name || 'Shadow ally') : dayLabel(rec.day) }),
        rec.kind === 'ally' ? p(`Shadow ally, drawn ${dayLabel(rec.day)}. Part of your army.`, 'dq-text') : rec.prompt ? p(rec.prompt, 'dq-text dq-piece-prompt') : p('A free page.', 'dq-text dq-piece-prompt'),
        actions,
        status,
        confirm,
      ),
    );
  })();
  return { el, title: 'Your page', mode: 'sub', bubbles: [1.6, 0.6] };
}
