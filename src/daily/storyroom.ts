/**
 * Story Room: their stories on this device (chapters and a Notes page), and a co-writer the player asks only when the player wants.
 * Their words are only ever set through textContent or .value. The co-writer runs on this device and never touches the network.
 */
import { animate } from '../ui/anim';
import { cowrite } from '../cowriter/local';
import type { CowriteReq, CowriteRes, CowriteTurn } from '../cowriter/types';
import { BESIDE, CARE_KEY, READ_SIZES, type ReadSize } from '../core/stored-names';
import { STORY_IMPORT, STORY_READ, STORY_START } from '../content/story-lines';
import { write } from '../core/cleared';
import type { App, Route, ScreenOut } from './app';
import { icon } from './art';
import { dayDiff, dayKey } from './store';
import { creditStory, STORY_CAP, storyStore, type Card, type CardMode, type Chapter, type Story } from './storystore';
import { storyFromText, storyToText, type StoryText } from './storytext';
import { btn, h, p, segmented, shareOrSave } from './ui';

export const STORY = {
  title: 'Story Room',
  sub: 'Write whatever you like. It stays on this device.',
  empty: 'No stories yet. Start one whenever you like.',
  privacyShelf: 'Your stories stay on this device.',
  privacyCw: 'Ask works right here on this device. Your story never leaves it.',
  saved: 'Saved on this device',
  notSaving: 'Not saving right now. Download the story to keep a copy.',
  copied: 'A newer version of this chapter arrived, so yours was kept as its own chapter.',
  recovered: 'Recovered your last words.',
  untitled: 'Untitled story',
  cardsEmpty: 'Ideas show up here as cards. Use what helps, toss the rest.',
  selectFirst: 'Select a few lines first.',
  moved: 'Your text changed, so this went at the end.',
  full: 'That’s the most one chapter can hold. Start a new chapter to keep going.',
  fullShort: 'Chapter full',
  addedNotes: 'Added to Notes.',
  gone: 'This story isn’t on this device any more.',
  deleteAsk: 'Delete for good? This can’t be undone.',
  care: 'If you need it tonight, the Safe Zone is one tap away.',
  msg: {
    toolong: 'That’s a lot of text at once. Select a smaller piece and ask again.',
  },
};
export const MODE_LABEL: Record<CardMode, string> = { continue: 'Keep going', whatif: 'What if', polish: 'Help with this bit', questions: 'Ask me questions' };
const MODES: CardMode[] = ['continue', 'whatif', 'polish', 'questions'];
const UNDO_CAP = 200;
/** Care shows at most once per page life even when sessionStorage can't keep the flag. */
let cared = false;

const store = (app: App) => storyStore(app.store.key);
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const shuffled = <T>(xs: readonly T[]) => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "edited today" / "edited Tuesday" / "edited 3 March", on the companion's day (it turns over at 6 AM). */
export function editedWhen(app: App, t: number) {
  const day = dayKey(t);
  const today = app.store.today();
  const d = dayDiff(day, today);
  if (d <= 0) return 'edited today';
  if (d === 1) return 'edited yesterday';
  const [y, m, dd] = day.split('-').map(Number);
  if (d < 7) return `edited ${DOW[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}`;
  return `edited ${dd} ${MON[m - 1]}${today.slice(0, 4) === String(y) ? '' : ` ${y}`}`;
}
export function storyMeta(app: App, s: Story) {
  const n = s.chapters.length;
  return `${n} chapter${n === 1 ? '' : 's'}, ${editedWhen(app, s.updated)}`;
}
const shownTitle = (t: string) => t.trim() || STORY.untitled;

const pageHead = (title: string, sub: string, extra?: HTMLElement | null) =>
  h('header', { class: 'dq-pagehead st-head' }, h('div', { class: 'st-head-row' }, h('h1', { class: 'dq-h1', 'data-focus': '', text: title }), extra ?? null), p(sub, 'dq-text dq-pagesub'));

// ---------------- the shelf ----------------
export function storiesScreen(app: App): ScreenOut {
  const ss = store(app);
  void ss.sweepLives();
  const xp = creditStory(app);
  const list = h('div', { class: 'st-shelf' });
  const removedBox = h('section', { class: 'st-removed is-hidden', 'aria-label': 'Removed stories' });
  let creating = false;
  const newStory = async () => {
    if (creating) return;
    creating = true;
    try {
      const { story, first } = await ss.create();
      app.go({ name: 'write', id: story.id, ch: first.id });
    } finally {
      creating = false;
    }
  };
  const newBtn = btn('New story', () => void newStory(), { kind: 'primary', ic: 'plus', cls: 'st-new' });

  // ---- bring in a story: a .txt or .md file read here as plain text, shown first, then added only as a new story ----
  const fileIn = h('input', { type: 'file', class: 'dq-sr', tabindex: '-1', 'aria-hidden': 'true', accept: '.txt,.md,.markdown,.text,text/plain,text/markdown', onchange: () => void pick() });
  let from: HTMLElement | null = null;
  const bringBtn = () => {
    const b = btn(STORY_IMPORT.open, () => ((from = b), fileIn.click()), { kind: 'quiet', ic: 'import', cls: 'st-bring' });
    return b;
  };
  const bringBox = h('section', { class: 'dq-panel st-bring-box is-hidden' });
  const bringSaid = h('p', { class: 'st-bring-said', role: 'status', 'aria-live': 'polite' });
  let bringing: StoryText | null = null;
  let bringDone: (() => void) | null = null;
  const closeBring = (focus = true) => {
    bringing = null;
    bringDone?.();
    bringDone = null;
    bringBox.classList.add('is-hidden');
    bringBox.replaceChildren();
    bringBox.removeAttribute('aria-labelledby');
    if (focus && from?.isConnected) from.focus({ preventScroll: true });
  };
  const showBring = (head: string, kids: (HTMLElement | null)[], acts: HTMLElement[]) => {
    const hd = h('h2', { class: 'st-bring-h', id: 'st-bring-h', tabindex: '-1', text: head });
    bringBox.replaceChildren(hd, ...kids.filter((k): k is HTMLElement => !!k), h('div', { class: 'dq-actions st-bring-acts' }, acts));
    // named by its heading only once the heading is there
    bringBox.setAttribute('aria-labelledby', hd.id);
    bringBox.classList.remove('is-hidden');
    // Back and Escape close it like any panel
    bringDone ??= app.sheet(() => closeBring());
    bringSaid.textContent = '';
    hd.focus({ preventScroll: true });
    bringBox.scrollIntoView({ block: 'nearest' });
  };
  const oops = (msg: string) => showBring(STORY_IMPORT.open, [p(msg, 'dq-text st-bring-t')], [btn(STORY_IMPORT.close, () => closeBring(), { kind: 'quiet' })]);
  const shownLine = (title: string, text: string) => {
    const line = text.trim().split('\n')[0] ?? '';
    return h('li', { class: 'st-bring-ch' }, h('span', { class: 'st-bring-ct', text: title }), line ? h('span', { class: 'st-bring-cx', text: line.length > 90 ? `${line.slice(0, 90).trimEnd()}…` : line }) : null);
  };
  const SHOWN = 8;
  const pick = async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    if (f.size > IMPORT_MAX) return oops(STORY_IMPORT.tooBig);
    let raw: string;
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer());
    } catch {
      return oops(STORY_IMPORT.notText);
    }
    if (raw.includes('\u0000')) return oops(STORY_IMPORT.notText);
    const s = fitted(storyFromText(raw, f.name));
    if (!s.chapters.some((c) => c.text.trim()) && !s.notes.trim()) return oops(STORY_IMPORT.empty);
    if (s.chapters.length > STORY_CAP.chapters) return oops(STORY_IMPORT.tooMany);
    const same = (await ss.list()).some((x) => x.title.trim().toLowerCase() === s.title.toLowerCase());
    bringing = s;
    const more = s.chapters.length - SHOWN;
    showBring(
      STORY_IMPORT.ask(s.title),
      [
        p(STORY_IMPORT.count(s.chapters.length, !!s.notes.trim()), 'dq-text st-bring-t'),
        h('ol', { class: 'st-bring-list' }, [...s.chapters.slice(0, SHOWN).map((c) => shownLine(c.title, c.text)), ...(s.notes.trim() ? [shownLine('Notes', s.notes)] : [])]),
        more > 0 ? p(STORY_IMPORT.more(more), 'dq-small st-bring-more') : null,
        same ? p(STORY_IMPORT.same, 'dq-small st-bring-same') : null,
        p(STORY_IMPORT.privacy, 'dq-small st-bring-p'),
      ],
      [btn(STORY_IMPORT.add, () => void add(), { kind: 'primary', ic: 'plus' }), btn(STORY_IMPORT.cancel, () => closeBring(), { kind: 'quiet' })],
    );
  };
  const add = async () => {
    const s = bringing;
    // one tap adds it once
    if (!s) return;
    bringing = null;
    try {
      await ss.createFrom(s);
    } catch (e) {
      return oops(e instanceof RangeError && /stories/.test(e.message) ? STORY_IMPORT.full : STORY_IMPORT.tooMany);
    }
    closeBring(false);
    bringSaid.textContent = STORY_IMPORT.added(s.title);
    // the newest story is first on the shelf
    await render();
    list.querySelector<HTMLElement>('.st-row')?.focus({ preventScroll: true });
  };

  const top = h('div', { class: 'st-shelf-acts' }, newBtn, bringBtn());
  const el = h(
    'div',
    { class: 'dq-page st-page st-shelfpage' },
    pageHead(STORY.title, STORY.sub, xp ? h('span', { class: 'dq-xp st-xp', text: `+${xp} XP` }) : null),
    top,
    fileIn,
    bringBox,
    bringSaid,
    list,
    removedBox,
    h('p', { class: 'dq-small st-privacy', text: STORY.privacyShelf }),
  );
  let showRemoved = false;
  let seq = 0;
  const render = async () => {
    const n = ++seq;
    const [stories, gone] = await Promise.all([ss.list(), ss.removed()]);
    if (n !== seq) return;
    top.classList.toggle('is-hidden', !stories.length);
    if (!stories.length) {
      list.replaceChildren(h('div', { class: 'dq-panel st-empty' }, h('p', { class: 'st-empty-t', text: STORY.empty }), h('div', { class: 'dq-actions' }, btn('New story', () => void newStory(), { kind: 'primary', ic: 'plus' }), bringBtn())));
    } else {
      list.replaceChildren(
        ...stories.map((s) =>
          h(
            'button',
            { type: 'button', class: 'dq-panel st-row', onclick: () => app.go({ name: 'write', id: s.id }) },
            h('span', { class: `st-row-t ${s.title.trim() ? '' : 'is-untitled'}`, text: shownTitle(s.title) }),
            h('span', { class: 'st-row-m', text: storyMeta(app, s) }),
            h('span', { class: 'st-row-go', 'aria-hidden': 'true', html: icon('chev') }),
          ),
        ),
      );
    }
    removedBox.classList.toggle('is-hidden', !gone.length);
    if (!gone.length) return removedBox.replaceChildren();
    const rows = h(
      'ul',
      { class: 'st-removed-list', id: 'st-removed-list' },
      gone.map((s) =>
        h(
          'li',
          { class: 'st-removed-row' },
          h('span', { class: `st-removed-t ${s.title.trim() ? '' : 'is-untitled'}`, text: shownTitle(s.title) }),
          h(
            'span',
            { class: 'st-removed-acts' },
            btn('Put back', () => void ss.putBack(s.id), { kind: 'quiet', cls: 'dq-btn--sm' }),
            btn('Delete for good', () => void deleteForGood(s.id), { kind: 'link', cls: 'st-del' }),
          ),
        ),
      ),
    );
    rows.classList.toggle('is-hidden', !showRemoved);
    const tg = h(
      'button',
      {
        type: 'button',
        class: 'st-removed-tg',
        'aria-expanded': String(showRemoved),
        'aria-controls': 'st-removed-list',
        onclick: () => {
          showRemoved = !showRemoved;
          tg.setAttribute('aria-expanded', String(showRemoved));
          rows.classList.toggle('is-hidden', !showRemoved);
        },
      },
      h('span', { text: 'Removed' }),
      h('span', { class: 'st-removed-n', text: String(gone.length) }),
      h('span', { class: 'st-removed-chev', 'aria-hidden': 'true', html: icon('chevdown') }),
    );
    removedBox.replaceChildren(tg, rows);
  };
  const deleteForGood = async (id: string) => {
    const v = await app.window({ kind: 'notification', title: 'Story Room', icon: 'alert', html: `<p>${STORY.deleteAsk}</p>`, actions: [{ label: 'Delete', value: 'delete' }, { label: 'Keep it', value: 'keep', variant: 'quiet' }] });
    if (v === 'delete') await ss.deleteForever(id);
  };
  const off = ss.onChange(() => void render());
  void render();
  return { el, title: STORY.title, mode: 'sub', bubbles: [1.4, 0.55], leave: off };
}

/** A file to bring in is read only up to this size. */
const IMPORT_MAX = 1_000_000;
/**
 * A story read from a file, shaped the way the Story Room holds one: every chapter named, none longer than a chapter
 * can hold (a longer one goes on in a chapter after it, split between paragraphs), titles within their caps.
 */
function fitted(s: StoryText): StoryText {
  const chapters: StoryText['chapters'] = [];
  s.chapters.forEach((c, i) => {
    const name = c.title.trim() || `Chapter ${i + 1}`;
    let text = c.text;
    let part = 1;
    const named = () => (part === 1 ? name : `${name.slice(0, STORY_CAP.chapterTitle - 6)} (${part})`).slice(0, STORY_CAP.chapterTitle);
    while (text.length > STORY_CAP.text) {
      let cut = text.lastIndexOf('\n\n', STORY_CAP.text);
      if (cut < STORY_CAP.text / 2) cut = text.lastIndexOf(' ', STORY_CAP.text);
      if (cut <= 0) cut = STORY_CAP.text;
      chapters.push({ title: named(), text: text.slice(0, cut).replace(/\s+$/, '') });
      text = text.slice(cut).replace(/^\s+/, '');
      part++;
    }
    chapters.push({ title: named(), text });
  });
  if (!chapters.length) chapters.push({ title: 'Chapter 1', text: '' });
  return { title: s.title.trim().slice(0, STORY_CAP.title) || STORY.untitled, chapters, notes: s.notes.slice(0, STORY_CAP.text) };
}

// ---------------- writing view ----------------
interface Snap {
  text: string;
  s: number;
  e: number;
}
interface Hist {
  undo: Snap[];
  redo: Snap[];
  base: Snap;
}
interface Open {
  id: string;
  kind: 'page' | 'notes';
  title: string;
  bases: string[];
}
type Sel = { start: number; end: number; text: string };

export function writeScreen(app: App, route: Route): ScreenOut {
  const r = route as Extract<Route, { name: 'write' }>;
  const ss = store(app);
  const storyId = r.id;
  const offs: (() => void)[] = [];
  const on = <K extends string>(t: EventTarget, ev: K, fn: (e: Event) => void, opt?: AddEventListenerOptions) => {
    t.addEventListener(ev, fn, opt);
    offs.push(() => t.removeEventListener(ev, fn, opt));
  };
  let alive = true;
  let story: Story | null = null;
  let notesId = '';
  let pageId = '';
  let tab: 'page' | 'notes' = 'page';
  let cur: Open | null = null;
  let dirty = false;
  let saving: Promise<void> | null = null;
  let again = false;
  let failed = false;
  let mirrorOff = false;
  let saveTimer = 0;
  let liveTimer = 0;
  let lastLive = 0;
  let idle = 0;
  let caret: number | null = null;
  let sel: Sel | null = null;
  const hist = new Map<string, Hist>();
  let pageIn!: () => void;
  /** settles once the first page is in the editor: nothing that edits the page runs before there is one */
  const pageLoaded = new Promise<void>((done) => (pageIn = done));

  // ---- head: title, chapter bar ----
  const titleIn = h('input', { class: 'st-title', type: 'text', maxlength: 120, placeholder: STORY.untitled, 'aria-label': 'Story title', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'true', enterkeyhint: 'done' });
  const chLabel = h('span', { class: 'st-chbtn-t' });
  const chBtn = h('button', { type: 'button', class: 'st-chbtn', 'aria-haspopup': 'dialog', onclick: () => void openChapters() }, h('span', { class: 'st-chbtn-k', text: 'Chapter' }), chLabel, h('span', { class: 'st-chbtn-ic', 'aria-hidden': 'true', html: icon('chevdown') }));
  const seg = segmented('Show', ['page', 'notes'], 'page', (v) => void switchTab(v === 'notes' ? 'notes' : 'page'), { labels: ['Page', 'Notes'], cls: 'st-seg' });
  const segBtns = [...seg.querySelectorAll<HTMLButtonElement>('.dq-seg-b')];
  const moreBtn = h('button', { type: 'button', class: 'dq-icbtn st-more', 'aria-label': 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: icon('more') });
  const menu = h('div', { class: 'st-menu is-hidden', role: 'menu', 'aria-label': 'Story' });
  const moreWrap = h('div', { class: 'st-morewrap' }, moreBtn, menu);
  const note = h('p', { class: 'st-note', role: 'status', 'aria-live': 'polite' });

  // ---- a starting point: one scripted line at a time, written to the page only on Use this ----
  const starts = shuffled(STORY_START.prompts);
  let startAt = 0;
  const startT = h('p', { class: 'st-start-t', 'aria-live': 'polite' });
  const startBox = h(
    'div',
    { class: 'st-start-box is-hidden', id: `st-start-${rid()}` },
    startT,
    h('div', { class: 'st-start-acts' }, btn(STORY_START.another, () => showStart(startAt + 1), { kind: 'ghost', ic: 'shuffle', cls: 'dq-btn--sm' }), btn(STORY_START.use, () => void useStart(), { kind: 'primary', cls: 'dq-btn--sm' })),
  );
  const startBtn = h(
    'button',
    { type: 'button', class: 'st-start-tg', 'aria-expanded': 'false', 'aria-controls': startBox.id, disabled: true, onclick: () => (startBox.classList.contains('is-hidden') ? showStart(startAt) : closeStart()) },
    h('span', { class: 'st-start-ic', 'aria-hidden': 'true', html: icon('pencil') }),
    h('span', { text: STORY_START.ask }),
  );
  const start = h('div', { class: 'st-start' }, startBtn, startBox);

  // ---- the page ----
  const ta = h('textarea', { class: 'st-ta', maxlength: STORY_CAP.text, spellcheck: 'true', autocapitalize: 'sentences', autocomplete: 'off', 'aria-label': 'Your page', placeholder: 'Start anywhere.', rows: 8 }) as HTMLTextAreaElement;
  const frame = h('div', { class: 'dq-panel st-frame' }, h('span', { class: 'dq-hairbar', 'aria-hidden': 'true' }), ta);

  // ---- dock ----
  const undoB = h('button', { type: 'button', class: 'dq-icbtn st-dock-b', 'aria-label': 'Undo', html: icon('undo'), disabled: true, onclick: () => undo() });
  const redoB = h('button', { type: 'button', class: 'dq-icbtn st-dock-b', 'aria-label': 'Redo', html: icon('redo'), disabled: true, onclick: () => redo() });
  const stateEl = h('span', { class: 'st-state', role: 'status', 'aria-live': 'polite', text: STORY.saved });
  const cwBtn = btn('Co-writer', () => openCw(), { kind: 'primary', ic: 'quill', cls: 'st-cwbtn' });
  cwBtn.setAttribute('aria-expanded', 'false');
  cwBtn.setAttribute('aria-controls', 'st-cw');
  const dock = h('div', { class: 'st-dock' }, h('div', { class: 'st-dock-in' }, undoB, redoB, stateEl, cwBtn));

  // ---- co-writer ----
  let mode: CardMode = 'continue';
  let cards: Card[] = [];
  let asking = false;
  const steers = new Map<number, string>();
  const cwHead = h('h2', { class: 'st-cw-h', id: 'st-cw-h', tabindex: '-1' }, h('span', { class: 'dq-chip-ic', html: icon('quill') }), h('span', { class: 'dq-chip-t', text: 'Co-writer' }));
  const cwClose = h('button', { type: 'button', class: 'dq-icbtn st-cw-x', 'aria-label': 'Close the co-writer', html: icon('close'), onclick: () => closeCw() });
  const modeBtns = MODES.map((m) =>
    h(
      'button',
      { type: 'button', class: `dq-opt st-mode st-mode--${m}`, 'aria-pressed': String(m === mode), 'data-mode': m, onclick: () => setMode(m) },
      h('span', { class: 'st-mode-t', text: MODE_LABEL[m] }),
      m === 'polish' ? h('span', { class: 'st-mode-h', text: STORY.selectFirst }) : null,
    ),
  );
  const steerId = `st-steer-${rid()}`;
  const steerIn = h('input', { id: steerId, class: 'dq-input st-steer', type: 'text', maxlength: 240, placeholder: 'Spookier, shorter, more dialogue…', autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'true', enterkeyhint: 'send' });
  const askB = btn('Ask', () => void ask(), { kind: 'primary', cls: 'st-ask' });
  const askT = askB.querySelector('.dq-btn-t')!;
  const cwMsg = h('p', { class: 'st-cwmsg is-hidden', role: 'status', 'aria-live': 'polite' });
  const careBox = h('div', { class: 'st-careslot' });
  const wait = h('div', { class: 'st-wait is-hidden', 'aria-hidden': 'true' }, h('span', { class: 'st-scan' }), h('span', { class: 'st-wait-l' }), h('span', { class: 'st-wait-l st-wait-l--b' }), h('span', { class: 'st-wait-l st-wait-l--c' }));
  const cardsEl = h('div', { class: 'st-cards', 'aria-live': 'polite' });
  const cw = h(
    'aside',
    { class: 'st-cw dq-panel', id: 'st-cw', 'aria-labelledby': 'st-cw-h' },
    h('span', { class: 'dq-hairbar', 'aria-hidden': 'true' }),
    h('header', { class: 'st-cw-top' }, cwHead, cwClose),
    h('div', { class: 'dq-opts dq-opts--grid st-modes', role: 'group', 'aria-label': 'What kind of help' }, modeBtns),
    h('div', { class: 'dq-field st-steerf' }, h('label', { for: steerId, class: 'dq-label st-steer-l', text: 'Anything to steer it?' }), steerIn),
    askB,
    h('p', { class: 'st-privacy st-privacy--cw', text: STORY.privacyCw }),
    cwMsg,
    careBox,
    wait,
    cardsEl,
  );

  const main = h('div', { class: 'st-main' }, titleIn, h('div', { class: 'st-bar' }, chBtn, seg, moreWrap), note, start, frame, dock);
  const el = h('div', { class: 'st-write' }, h('h1', { class: 'dq-sr', 'data-focus': '', text: 'Your story' }), main, cw);

  // ---------- save state ----------
  const atCap = () => !!cur && ta.value.length >= STORY_CAP.text;
  const syncState = () => {
    const off = failed || mirrorOff || !ss.persistent;
    const full = !off && atCap();
    stateEl.textContent = off ? STORY.notSaving : full ? STORY.fullShort : STORY.saved;
    stateEl.classList.toggle('is-off', off);
    stateEl.classList.toggle('is-full', full);
  };
  let noteTimer = 0;
  const say = (text: string, ms = 7000) => {
    note.textContent = text;
    clearTimeout(noteTimer);
    if (ms) noteTimer = window.setTimeout(() => (note.textContent = ''), ms);
  };

  // ---------- undo / redo ----------
  const snap = (): Snap => ({ text: ta.value, s: ta.selectionStart, e: ta.selectionEnd });
  const H = () => {
    let hh = hist.get(cur!.id);
    if (!hh) hist.set(cur!.id, (hh = { undo: [], redo: [], base: snap() }));
    return hh;
  };
  const syncUndo = () => {
    if (!cur) return;
    const hh = H();
    undoB.disabled = !hh.undo.length && ta.value === hh.base.text;
    redoB.disabled = !hh.redo.length;
  };
  const commit = () => {
    clearTimeout(idle);
    idle = 0;
    if (!cur) return;
    const hh = H();
    const now = snap();
    if (now.text !== hh.base.text) {
      hh.undo.push(hh.base);
      if (hh.undo.length > UNDO_CAP) hh.undo.shift();
    }
    hh.base = now;
    syncUndo();
  };
  const applySnap = (s: Snap) => {
    ta.value = s.text;
    const n = s.text.length;
    try {
      ta.setSelectionRange(Math.min(s.s, n), Math.min(s.e, n));
    } catch {
      /* detached */
    }
    if (tab === 'page') caret = Math.min(s.e, n);
    grow();
    edited();
    syncUndo();
  };
  const undo = () => {
    if (!cur) return;
    commit();
    const hh = H();
    const prev = hh.undo.pop();
    if (!prev) return syncUndo();
    hh.redo.push(hh.base);
    hh.base = prev;
    applySnap(prev);
  };
  const redo = () => {
    if (!cur) return;
    commit();
    const hh = H();
    const next = hh.redo.pop();
    if (!next) return syncUndo();
    hh.undo.push(hh.base);
    hh.base = next;
    applySnap(next);
  };
  /** A change the player asked for (Insert, Replace, Add to Notes): exactly one Undo step. False when it would pass the cap. */
  const change = (next: string, s: number, e: number) => {
    if (next.length > STORY_CAP.text) {
      say(STORY.full);
      return false;
    }
    commit();
    const hh = H();
    hh.redo.length = 0;
    hh.undo.push(hh.base);
    if (hh.undo.length > UNDO_CAP) hh.undo.shift();
    ta.value = next;
    try {
      ta.setSelectionRange(s, e);
    } catch {
      /* detached */
    }
    hh.base = snap();
    grow();
    edited();
    syncUndo();
    return true;
  };

  // ---------- page size ----------
  const grow = () => {
    const sc = app.root.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
    app.root.scrollTop = sc;
  };

  // ---------- saving ----------
  const live = (force = false) => {
    if (!cur) return;
    const now = Date.now();
    if (!force && now - lastLive < 300) {
      if (!liveTimer) liveTimer = window.setTimeout(() => ((liveTimer = 0), live(true)), 300 - (now - lastLive));
      return;
    }
    clearTimeout(liveTimer);
    liveTimer = 0;
    lastLive = now;
    const off = !ss.setLive({ chapter: cur.id, text: ta.value, bases: [...cur.bases], t: now });
    if (off !== mirrorOff) {
      mirrorOff = off;
      if (alive) syncState();
    }
  };
  /** The mirror catches up now when anything is not yet written (unsaved words, a write in flight, a throttled mirror). */
  const pinLive = () => {
    if (dirty || saving || liveTimer) live(true);
  };
  const edited = () => {
    dirty = true;
    live();
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 600);
  };
  const save = (): Promise<void> => {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (saving) {
      if (dirty) again = true;
      return saving;
    }
    if (!cur || !dirty) return Promise.resolve();
    const c = cur;
    const text = ta.value;
    dirty = false;
    saving = (async () => {
      let res: Awaited<ReturnType<typeof ss.saveChapter>> | null = null;
      try {
        res = await ss.saveChapter({ id: c.id, story: storyId, kind: c.kind, title: c.title, text }, c.bases);
      } catch {
        res = null;
      }
      if (!res) {
        failed = true;
        if (cur === c) dirty = true;
      } else if (res.stored === 'wrote') {
        c.bases = [res.rev];
        if (cur === c && ta.value !== text) live(true);
        failed = false;
        ss.clearLive(c.id, text);
      } else if (res.stored === 'failed') {
        c.bases = [...c.bases, res.rev];
        failed = true;
        if (cur === c) live(true);
      } else {
        const old = c.id;
        const hh = hist.get(old);
        if (hh) hist.set(res.id, hh), hist.delete(old);
        c.id = res.id;
        c.bases = [res.rev];
        failed = false;
        // words typed while it was saving move to the copy's mirror before the old one goes
        if (cur === c) {
          if (ta.value !== text) live(true);
          if (ta.value === text || ss.live(c.id)?.text === ta.value) ss.clearLive(old);
        } else ss.clearLive(old, text);
        const copy = await ss.chapter(res.id);
        if (copy) (c.title = copy.title), (c.kind = copy.kind);
        if (pageId === old) {
          if (cards.length) void ss.putCards(res.id, cards);
          pageId = res.id;
        }
        say(STORY.copied, 0);
        void refreshStory();
      }
      if (alive) syncState();
    })().finally(() => {
      saving = null;
      if (again) {
        again = false;
        void save();
      }
    });
    return saving;
  };
  /** Everything typed so far is written before the editor moves to another chapter. */
  const flushAll = async () => {
    commit();
    pinLive();
    for (let i = 0; i < 6 && (saving || dirty); i++) await (saving ?? save());
  };

  // ---------- story, chapters ----------
  const syncSeg = () => segBtns.forEach((b, i) => b.setAttribute('aria-checked', String((i === 0 ? 'page' : 'notes') === tab)));
  const refreshStory = async () => {
    const s = await ss.story(storyId);
    if (!s) return;
    story = s;
    notesId = s.notes;
    const pc = pageId ? await ss.chapter(pageId) : null;
    const idx = s.chapters.indexOf(pageId);
    chLabel.textContent = pc ? pc.title : '';
    chBtn.setAttribute('aria-label', pc ? `Chapter: ${pc.title}${idx >= 0 ? `, ${idx + 1} of ${s.chapters.length}` : ''}. Open the chapter list.` : 'Open the chapter list');
  };
  const saveStoryFresh = async (patch: { title?: string; chapters?: string[] }) => {
    const fresh = await ss.story(storyId);
    if (!fresh) return;
    const res = await ss.saveStory({ id: storyId, title: patch.title ?? titleIn.value, chapters: patch.chapters ?? fresh.chapters }, [fresh.rev]).catch(() => null);
    if (!res || res.stored === 'failed') {
      failed = true;
      syncState();
    }
    await refreshStory();
  };
  let titleTimer = 0;
  let titleDirty = false;
  const saveTitle = () => {
    clearTimeout(titleTimer);
    if (!titleDirty) return;
    titleDirty = false;
    void saveStoryFresh({ title: titleIn.value });
  };
  on(titleIn, 'input', () => {
    titleDirty = true;
    clearTimeout(titleTimer);
    titleTimer = window.setTimeout(saveTitle, 600);
  });
  on(titleIn, 'blur', saveTitle);
  on(titleIn, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') titleIn.blur();
  });

  const load = async (id: string) => {
    const c = await ss.chapter(id);
    if (!c || !alive) return false;
    let text = c.text;
    let bases = [c.rev];
    let recovered = false;
    const keep: { key: string; text: string }[] = [];
    // every tab's mirror of this chapter, and no clock compared: a mirror built on the stored version comes back into
    // the editor, any other mirror that reads differently is kept as its own chapter
    for (const l of ss.lives(c.id)) {
      if (l.text === c.text) continue;
      if (!recovered && l.bases.includes(c.rev)) {
        text = l.text;
        bases = [...l.bases];
        recovered = true;
      } else keep.push(l);
    }
    cur = { id: c.id, kind: c.kind, title: c.title, bases };
    pageIn();
    startBtn.disabled = false;
    tab = c.kind === 'notes' ? 'notes' : 'page';
    ta.value = text;
    ta.placeholder = tab === 'notes' ? 'Characters, places, anything you want to remember.' : 'Start anywhere.';
    ta.setAttribute('aria-label', tab === 'notes' ? 'Notes for this story' : `Page, ${c.title}`);
    frame.classList.toggle('is-notes', tab === 'notes');
    start.classList.toggle('is-hidden', tab === 'notes');
    if (tab === 'notes') closeStart();
    const hh = hist.get(c.id);
    if (hh) hh.base = { text, s: text.length, e: text.length };
    syncSeg();
    grow();
    syncUndo();
    let copied = false;
    const kept = new Set<string>();
    for (const k of keep) {
      if (recovered && k.text === text) continue;
      if (!kept.has(k.text)) {
        const res = await ss.saveChapter({ id: c.id, story: storyId, kind: c.kind, title: c.title, text: k.text }, [], { copy: true }).catch(() => null);
        if (res?.stored !== 'copied') {
          failed = true;
          continue;
        }
        kept.add(k.text);
        copied = true;
      }
      ss.dropLive(k.key, c.id, k.text);
    }
    if (recovered) {
      dirty = true;
      say(STORY.recovered);
      await save();
    }
    ss.settleLives(c.id, (await ss.onDisk(c.id))?.text ?? null);
    if (copied) {
      say(STORY.copied, 0);
      void refreshStory();
    }
    if (alive) syncState();
    return true;
  };
  const switchTab = async (to: 'page' | 'notes') => {
    if (to === tab && cur) return syncSeg();
    await flushAll();
    tab = to;
    await load(to === 'notes' ? notesId : pageId);
  };
  const openPage = async (id: string) => {
    await flushAll();
    if (id !== pageId) {
      pageId = id;
      caret = null;
      sel = null;
      syncModes();
      await loadCards();
    }
    tab = 'page';
    await load(id);
    await refreshStory();
  };

  // ---------- chapter sheet ----------
  let sheet: HTMLElement | null = null;
  let sheetDone: (() => void) | null = null;
  const closeSheet = () => {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    sheetDone?.();
    sheetDone = null;
    if (chBtn.isConnected) chBtn.focus({ preventScroll: true });
  };
  const openChapters = async () => {
    await flushAll();
    await refreshStory();
    if (!story || !alive) return;
    closeSheet();
    const list = h('ol', { class: 'st-chlist' });
    const body = h('div', { class: 'dq-panel dq-sheet-p st-chsheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'st-ch-h' });
    const wrap = h('div', { class: 'dq-sheet st-sheet' }, body);
    sheet = wrap;
    const render = async () => {
      const s = await ss.story(storyId);
      if (!s) return;
      story = s;
      const chs = (await Promise.all(s.chapters.map((id) => ss.chapter(id)))).filter((c): c is Chapter => !!c);
      const only = chs.length <= 1;
      list.replaceChildren(
        ...chs.map((c, i) => {
          const isCur = c.id === pageId;
          const tbtn = h(
            'button',
            { type: 'button', class: 'st-chrow-b', 'aria-current': isCur ? 'true' : null, onclick: async () => (closeSheet(), await openPage(c.id)) },
            h('span', { class: 'st-chrow-n', text: String(i + 1).padStart(2, '0') }),
            h('span', { class: 'st-chrow-t', text: c.title }),
          );
          const rename = () => {
            const inp = h('input', { class: 'dq-input st-rename', type: 'text', maxlength: 80, 'aria-label': `New name for ${c.title}`, autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done' });
            inp.value = c.title;
            let done = false;
            const finish = async (keep: boolean) => {
              if (done) return;
              done = true;
              const v = inp.value.trim();
              if (keep && v && v !== c.title) await renameChapter(c.id, v);
              await render();
              list.querySelectorAll<HTMLElement>('.st-chrow-b')[i]?.focus();
            };
            inp.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') void finish(true);
              if (e.key === 'Escape') (e.stopPropagation(), void finish(false));
            });
            inp.addEventListener('blur', () => void finish(true));
            tbtn.replaceWith(inp);
            inp.focus();
            inp.select();
          };
          const ib = (ic: string, label: string, tip: string, fn: () => void, disabled = false) => h('button', { type: 'button', class: 'dq-icbtn st-chrow-i', 'data-act': ic, 'aria-label': label, title: tip, html: icon(ic), disabled, onclick: fn });
          return h(
            'li',
            { class: `st-chrow ${isCur ? 'is-cur' : ''}` },
            tbtn,
            h(
              'span',
              { class: 'st-chrow-acts' },
              ib('pencil', `Rename ${c.title}`, 'Rename', rename),
              ib('up', `Move ${c.title} up`, 'Move up', () => void move(i, -1), i === 0),
              ib('down', `Move ${c.title} down`, 'Move down', () => void move(i, 1), i === chs.length - 1),
              ib('trash', `Remove ${c.title}`, 'Remove', () => void removeCh(c.id, i), only),
            ),
          );
        }),
      );
    };
    const move = async (i: number, d: number) => {
      const s = await ss.story(storyId);
      if (!s) return;
      const order = [...s.chapters];
      const j = i + d;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      await saveStoryFresh({ chapters: order });
      await render();
      const target = list.querySelectorAll<HTMLElement>('.st-chrow')[j]?.querySelector<HTMLButtonElement>(d < 0 ? '[data-act="up"]' : '[data-act="down"]');
      (target && !target.disabled ? target : list.querySelectorAll<HTMLElement>('.st-chrow-b')[j])?.focus();
    };
    const removeCh = async (id: string, index: number) => {
      const s = await ss.story(storyId);
      if (!s || s.chapters.length <= 1) return;
      const wasOpen = id === pageId;
      if (wasOpen) await flushAll();
      await ss.removeChapter(storyId, id);
      if (wasOpen) {
        const rest = s.chapters.filter((c) => c !== id);
        await openPage(rest[Math.max(0, index - 1)] ?? rest[0]);
      }
      await refreshStory();
      if (sheet) await render();
      app.toast('Chapter removed.', {
        label: 'Undo',
        run: async () => {
          await ss.putBackChapter(storyId, id, index);
          await refreshStory();
          if (sheet) await render();
        },
      });
    };
    const addNew = async () => {
      await flushAll();
      const c = await ss.addChapter(storyId);
      closeSheet();
      await openPage(c.id);
      ta.focus({ preventScroll: true });
    };
    body.append(
      h('div', { class: 'st-sheet-top' }, h('h2', { class: 'dq-sheet-h', id: 'st-ch-h', text: 'Chapters' }), h('button', { type: 'button', class: 'dq-icbtn st-sheet-x', 'aria-label': 'Close the chapter list', html: icon('close'), onclick: closeSheet })),
      list,
      h('div', { class: 'dq-actions st-sheet-acts' }, btn('New chapter', () => void addNew(), { kind: 'quiet', ic: 'plus' })),
    );
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) closeSheet();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') (e.stopPropagation(), closeSheet());
    });
    await render();
    el.append(wrap);
    sheetDone = app.sheet(closeSheet);
    if (!app.reduced()) animate(body, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
    list.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: true });
  };
  const renameChapter = async (id: string, title: string) => {
    if (cur && cur.id === id) {
      cur.title = title;
      dirty = true;
      await flushAll();
    } else {
      const c = await ss.chapter(id);
      if (c) await ss.saveChapter({ ...c, title }, [c.rev]);
    }
    await refreshStory();
  };

  // ---------- more menu ----------
  let prepared: Promise<{ text: string; name: string }> | null = null;
  const storyText = async () => {
    await flushAll();
    const s = await ss.story(storyId);
    const chs = s ? (await Promise.all(s.chapters.map((id) => ss.chapter(id)))).filter((c): c is Chapter => !!c) : [];
    // the open page always goes out as the editor holds it, saved or not
    const open = cur && cur.kind === 'page' ? cur : null;
    const shown = chs.map((c) => (open && c.id === open.id ? { title: open.title, text: ta.value } : { title: c.title, text: c.text }));
    if (open && !chs.some((c) => c.id === open.id)) shown.push({ title: open.title, text: ta.value });
    // then Notes, as it is now: the open editor, else what this copy holds unsaved, else what is stored
    const notes = cur && cur.kind === 'notes' ? ta.value : (ss.unsaved(notesId) ?? (await ss.chapter(notesId)))?.text ?? '';
    const slug = titleIn.value.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').slice(0, 60) || 'story';
    // headings mark the title, each chapter and Notes, so Bring in a story reads it back exactly
    return { text: storyToText({ title: shownTitle(titleIn.value), chapters: shown, notes }), name: `${slug}.txt` };
  };
  let menuDone: (() => void) | null = null;
  const closeMenu = (focus = false) => {
    menuDone?.();
    menuDone = null;
    menu.classList.add('is-hidden');
    moreBtn.setAttribute('aria-expanded', 'false');
    if (focus) moreBtn.focus({ preventScroll: true });
  };
  const item = (ic: string, label: string, fn: () => void) => h('button', { type: 'button', role: 'menuitem', class: 'st-menu-i', onclick: () => (closeMenu(), fn()) }, h('span', { class: 'st-menu-ic', html: icon(ic) }), h('span', { text: label }));
  const nav = navigator as Omit<Navigator, 'share'> & { share?: (d: ShareData) => Promise<void> };
  menu.append(
    item('book', STORY_READ.open, () => void openRead()),
    item('export', 'Download story', () => void download()),
    ...(typeof nav.share === 'function' ? [item('share', 'Share', () => void share())] : []),
    item('trash', 'Remove story', () => void removeStory()),
  );
  on(moreBtn, 'click', () => {
    const open = menu.classList.contains('is-hidden');
    if (!open) return closeMenu();
    prepared = storyText();
    menu.classList.remove('is-hidden');
    moreBtn.setAttribute('aria-expanded', 'true');
    menuDone = app.sheet(() => closeMenu(true));
    menu.querySelector<HTMLElement>('.st-menu-i')?.focus({ preventScroll: true });
  });
  on(document, 'pointerdown', (e) => {
    if (!menu.classList.contains('is-hidden') && !moreWrap.contains(e.target as Node)) closeMenu();
  });
  on(menu, 'keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    const items = [...menu.querySelectorAll<HTMLElement>('.st-menu-i')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (k === 'Escape') (e.stopPropagation(), closeMenu(true));
    else if (k === 'ArrowDown') (e.preventDefault(), items[(i + 1) % items.length]?.focus());
    else if (k === 'ArrowUp') (e.preventDefault(), items[(i - 1 + items.length) % items.length]?.focus());
  });
  const openRead = async () => {
    await flushAll();
    if (!alive) return;
    // back from reading lands on the chapter they were on
    r.ch = pageId || undefined;
    app.go({ name: 'read', id: storyId, ch: pageId || undefined });
  };
  const download = async () => {
    const { text, name } = await (prepared ?? storyText());
    const r2 = await shareOrSave(text, name, 'text/plain');
    if (r2 === 'saved') say('Story saved to your downloads.');
    else if (r2 === 'shared') say('Story ready. Pick Save to Files to keep it.');
  };
  const share = async () => {
    const { text } = await (prepared ?? storyText());
    try {
      await nav.share?.({ title: shownTitle(titleIn.value), text });
    } catch {
      /* the player closed the share sheet */
    }
  };
  const removeStory = async () => {
    await flushAll();
    await ss.remove(storyId);
    app.back();
    app.toast('Story removed.', { label: 'Undo', run: () => void ss.putBack(storyId) });
  };

  // ---------- selection ----------
  const syncModes = () => {
    if (mode === 'polish' && !sel) mode = 'continue';
    modeBtns.forEach((b, i) => {
      const m = MODES[i];
      b.setAttribute('aria-pressed', String(m === mode));
      if (m === 'polish') {
        b.disabled = !sel;
        b.classList.toggle('is-locked', !sel);
      }
    });
  };
  const setMode = (m: CardMode) => {
    if (m === 'polish' && !sel) return;
    mode = m;
    syncModes();
  };
  const track = () => {
    if (tab !== 'page' || !cur) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    caret = e;
    if (e > s) {
      const had = !!sel;
      sel = { start: s, end: e, text: ta.value.slice(s, e) };
      if (!had) syncModes();
    }
  };
  for (const ev of ['select', 'keyup', 'pointerup', 'mouseup', 'touchend', 'focus']) on(ta, ev, track);
  on(document, 'selectionchange', () => {
    if (document.activeElement === ta) track();
  });

  // ---------- typing ----------
  on(ta, 'input', (e) => {
    if (!cur) return;
    const ie = e as InputEvent;
    const hh = H();
    hh.redo.length = 0;
    const t = ie.inputType ?? '';
    if ((t === 'insertText' && ie.data && /[\s.,!?;:]/.test(ie.data)) || t === 'insertLineBreak' || t === 'insertParagraph' || t === 'insertFromPaste' || t === 'insertFromDrop') commit();
    else {
      clearTimeout(idle);
      idle = window.setTimeout(commit, 800);
    }
    if (tab === 'page') caret = ta.selectionEnd;
    grow();
    edited();
    syncUndo();
    if (atCap()) fullLine();
    else fullToast = false;
    syncState();
  });
  /** The page reached the cap: the calm line up top, and once per reach where the player is typing. */
  let fullToast = false;
  const fullLine = () => {
    say(STORY.full);
    if (!fullToast) {
      fullToast = true;
      app.toast(STORY.full);
    }
  };
  /** Room left for an insertion that replaces the current selection. */
  const room = () => STORY_CAP.text - (ta.value.length - (ta.selectionEnd - ta.selectionStart));
  on(ta, 'paste', (e) => {
    const t = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    if (t.length > room()) fullLine();
  });
  on(ta, 'keydown', (e) => {
    const k = e as KeyboardEvent;
    if (!(k.ctrlKey || k.metaKey) || k.altKey) return;
    const key = k.key.toLowerCase();
    if (key === 'z') {
      k.preventDefault();
      if (k.shiftKey) redo();
      else undo();
    } else if (key === 'y' && k.ctrlKey) {
      k.preventDefault();
      redo();
    }
  });
  on(ta, 'beforeinput', (e) => {
    const ie = e as InputEvent;
    const t = ie.inputType;
    if (t === 'historyUndo') (e.preventDefault(), undo());
    else if (t === 'historyRedo') (e.preventDefault(), redo());
    else if (t?.startsWith('insert') && (ie.data?.length ?? (t === 'insertFromPaste' || t === 'insertFromDrop' ? 0 : 1)) > room()) fullLine();
  });
  on(window, 'pagehide', () => (commit(), pinLive(), void save(), saveTitle()));
  on(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') (commit(), pinLive(), void save(), saveTitle());
  });

  // ---------- co-writer panel ----------
  const wide = matchMedia('(min-width: 1100px)');
  let cwOpen = false;
  let cwDone: (() => void) | null = null;
  const openCw = () => {
    if (wide.matches) return modeBtns[0].focus();
    // pressed again while open: it is already one sheet, so only focus moves into it
    if (cwOpen) return cwHead.focus({ preventScroll: true });
    cwOpen = true;
    cwDone = app.sheet(closeCw);
    cw.classList.add('is-open');
    cw.setAttribute('role', 'dialog');
    cw.setAttribute('aria-modal', 'false');
    cwBtn.setAttribute('aria-expanded', 'true');
    el.classList.add('is-cw-open');
    cw.scrollTop = 0;
    cwHead.focus({ preventScroll: true });
  };
  const closeCw = () => {
    if (!cwOpen) return;
    cwOpen = false;
    cwDone?.();
    cwDone = null;
    cw.classList.remove('is-open');
    cw.removeAttribute('role');
    cw.removeAttribute('aria-modal');
    cwBtn.setAttribute('aria-expanded', 'false');
    el.classList.remove('is-cw-open');
    cwBtn.focus({ preventScroll: true });
  };
  on(wide, 'change', () => {
    if (wide.matches && cwOpen) {
      cwOpen = false;
      cwDone?.();
      cwDone = null;
      cw.classList.remove('is-open');
      el.classList.remove('is-cw-open');
    }
  });
  on(steerIn, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') (e.preventDefault(), void ask());
  });

  const pageNow = async () => {
    if (tab === 'page' && cur) return ta.value;
    return (await ss.chapter(pageId))?.text ?? '';
  };
  const notesNow = async () => {
    if (tab === 'notes' && cur) return ta.value;
    return (await ss.chapter(notesId))?.text ?? '';
  };
  const historyFor = (m: CardMode): CowriteTurn[] => {
    const batches: { t: number; texts: string[] }[] = [];
    for (const c of cards) {
      if (c.mode !== m) continue;
      const b = batches.find((x) => x.t === c.t);
      if (b) b.texts.push(c.text);
      else batches.push({ t: c.t, texts: [c.text] });
    }
    const out: CowriteTurn[] = [];
    for (const b of batches.sort((a, b2) => b2.t - a.t).slice(0, 2).reverse()) {
      const s = steers.get(b.t);
      if (s) out.push({ role: 'me', text: s.slice(0, 600) });
      out.push({ role: 'cowriter', text: b.texts.join('\n\n').slice(0, 600) });
    }
    return out.slice(-4);
  };
  const showMsg = (text: string | null) => {
    cwMsg.textContent = text ?? '';
    cwMsg.classList.toggle('is-hidden', !text);
  };
  const ask = async () => {
    if (asking || !story) return;
    if (mode === 'polish' && !sel?.text.trim()) return showMsg(STORY.selectFirst);
    asking = true;
    askB.disabled = true;
    askT.textContent = 'Thinking it over…';
    showMsg(null);
    wait.classList.remove('is-hidden');
    const m = mode;
    const steer = steerIn.value.trim().slice(0, 240);
    const askPage = pageId;
    let res: CowriteRes;
    let usedSel: Sel | undefined;
    try {
      // only the tab that isn't open is read from storage; if that read fails, Ask works from what is on screen
      const page = await pageNow().catch(() => '');
      const notes = await notesNow().catch(() => '');
      let before = '', selection = '', after = '';
      if (m === 'polish' && sel) {
        // the remembered range, or the one place the words still appear; never a guess between two matches
        let at = page.slice(sel.start, sel.end) === sel.text ? sel.start : -1;
        if (at < 0) {
          const i = page.indexOf(sel.text);
          if (i >= 0 && page.indexOf(sel.text, i + 1) < 0) at = i;
        }
        if (at < 0) at = page.length;
        usedSel = { start: at, end: at + sel.text.length, text: sel.text };
        before = page.slice(0, at);
        selection = sel.text;
        after = page.slice(at + sel.text.length);
      } else {
        const at = Math.min(caret ?? page.length, page.length);
        before = page.slice(0, at);
        after = page.slice(at);
      }
      const req: CowriteReq = { mode: m, title: titleIn.value, before, selection, after, notes, steer, history: historyFor(m) };
      res = await cowrite(req);
    } finally {
      asking = false;
      askB.disabled = false;
      askT.textContent = 'Ask';
      wait.classList.add('is-hidden');
    }
    if (!alive) return;
    if (res.kind === 'cards') {
      const t = Date.now();
      if (steer) steers.set(t, steer);
      const batch: Card[] = res.cards.map((text) => ({ id: rid(), mode: m, text, t, ...(usedSel ? { sel: usedSel } : {}) }));
      if (askPage !== pageId) {
        // the player moved to another chapter while it was thinking: the cards belong to the chapter the player asked from
        void ss.cards(askPage).then((old) => ss.putCards(askPage, [...batch, ...old].slice(0, 12)));
        return;
      }
      cards = [...batch, ...cards].slice(0, 12);
      void ss.putCards(pageId, cards);
      renderCards(true);
      if (res.care) care();
    } else showMsg(STORY.msg[res.kind]);
  };
  const care = () => {
    if (cared) return;
    try {
      if (sessionStorage.getItem(CARE_KEY)) return;
    } catch {
      /* private mode: the page's own flag keeps it to once */
    }
    cared = true;
    write(() => {
      try {
        sessionStorage.setItem(CARE_KEY, '1');
      } catch {
        /* private mode: still show it this once */
      }
    });
    const box: HTMLElement = h(
      'div',
      { class: 'dq-panel st-care', role: 'note' },
      h('p', { class: 'dq-text st-care-t', text: STORY.care }),
      h('div', { class: 'dq-actions' }, btn('Safe Zone', () => app.go({ name: 'safe' }), { kind: 'primary', ic: 'safe' }), btn('Not now', () => box.remove(), { kind: 'quiet' })),
    );
    careBox.replaceChildren(box);
  };

  // ---------- cards ----------
  const loadCards = async () => {
    cards = pageId ? await ss.cards(pageId) : [];
    renderCards(false);
  };
  const persistCards = () => void ss.putCards(pageId, cards);
  const toPage = async () => {
    await pageLoaded;
    if (tab !== 'page') await switchTab('page');
  };
  const insertText = async (t: string) => {
    await toPage();
    const text = ta.value;
    const at = Math.min(caret ?? text.length, text.length);
    const piece = t.trim();
    const multi = /\n\s*\n/.test(piece);
    const b = text.slice(0, at), a = text.slice(at);
    let pre = '', post = '';
    if (b.length) pre = multi ? (b.endsWith('\n\n') ? '' : b.endsWith('\n') ? '\n' : '\n\n') : /\s$/.test(b) ? '' : ' ';
    if (a.length && !/^[\s.,;:!?)\]”’…—-]/.test(a)) post = multi ? '\n\n' : ' ';
    const end = (b + pre + piece).length;
    if (!change(b + pre + piece + post + a, end, end)) return null;
    caret = end;
    return b + pre + piece + post + a;
  };
  const showStart = (i: number) => {
    startAt = i % starts.length;
    startT.textContent = starts[startAt];
    startBox.classList.remove('is-hidden');
    startBtn.setAttribute('aria-expanded', 'true');
    // above the pinned dock, so Use this is never under it on a phone held sideways
    startBox.scrollIntoView({ block: 'nearest' });
  };
  const closeStart = () => {
    startBox.classList.add('is-hidden');
    startBtn.setAttribute('aria-expanded', 'false');
  };
  const useStart = async () => {
    if ((await insertText(starts[startAt])) === null) return;
    closeStart();
    // the next time they ask, a line they haven't seen yet
    startAt = (startAt + 1) % starts.length;
    ta.focus();
  };
  const replaceSel = async (s: Sel | undefined, t: string) => {
    await toPage();
    const text = ta.value;
    const piece = t.trim();
    // only the exact range it was asked about; if those words changed, never search for them elsewhere
    if (s && s.text && text.slice(s.start, s.end) === s.text) {
      // the spaces or line breaks the selection started or ended with stay, so it never glues onto the next word
      const put = `${s.text.match(/^\s*/)![0]}${piece}${s.text.match(/\s*$/)![0]}`;
      const at = s.start;
      const end = at + put.length;
      const next = text.slice(0, at) + put + text.slice(at + s.text.length);
      if (!change(next, at, end)) return null;
      caret = end;
      sel = { start: at, end, text: put };
      return { next, moved: false };
    }
    const pre = text.length ? (text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n') : '';
    const next = text + pre + piece;
    if (!change(next, next.length, next.length)) return null;
    caret = next.length;
    return { next, moved: true };
  };
  /** A Notes change made from the Page: mirrored first, as typing is, then written; the mirror goes once it is stored. */
  const writeNotes = async (n: Chapter, text: string) => {
    const bases = [...new Set([...(ss.live(n.id)?.bases ?? []), n.rev])];
    const mirrored = ss.setLive({ chapter: n.id, text, bases, t: Date.now() });
    const res = await ss.saveChapter({ id: n.id, story: storyId, kind: 'notes', title: n.title, text }, [n.rev]).catch(() => null);
    if (res && res.stored !== 'failed') ss.clearLive(n.id, text);
    else if (res && mirrored) ss.setLive({ chapter: n.id, text, bases: [...bases, res.rev], t: Date.now() });
    return res;
  };
  /** Adds a line to Notes as one Undo step there, with a toast whose Undo takes back exactly that addition. */
  const appendNotes = async (line: string): Promise<'ok' | 'full' | 'fail'> => {
    const join = (t: string) => (t ? `${t}${t.endsWith('\n') ? '' : '\n'}${line}` : line);
    let prev: string;
    let next: string;
    if (tab === 'notes' && cur) {
      prev = ta.value;
      next = join(prev);
      if (!change(next, next.length, next.length)) return 'full';
    } else {
      const n = await ss.chapter(notesId);
      if (!n) return 'fail';
      prev = n.text;
      next = join(prev);
      if (next.length > STORY_CAP.text) return 'full';
      const res = await writeNotes(n, next);
      if (!res || res.stored === 'failed') {
        failed = true;
        syncState();
        return 'fail';
      }
      if (res.stored !== 'wrote') return 'ok';
      let hh = hist.get(n.id);
      if (!hh) hist.set(n.id, (hh = { undo: [], redo: [], base: { text: prev, s: prev.length, e: prev.length } }));
      hh.undo.push({ text: prev, s: prev.length, e: prev.length });
      if (hh.undo.length > UNDO_CAP) hh.undo.shift();
      hh.redo.length = 0;
      hh.base = { text: next, s: next.length, e: next.length };
    }
    const at = prev.length;
    const added = next.slice(at);
    app.toast(STORY.addedNotes, { label: 'Undo', run: () => void takeBackNotes(at, added, next) });
    return 'ok';
  };
  const takeBackNotes = async (at: number, added: string, next: string) => {
    if (tab === 'notes' && cur && cur.id === notesId) {
      if (ta.value === next) return undo();
      if (ta.value.slice(at, at + added.length) === added) change(ta.value.slice(0, at) + ta.value.slice(at + added.length), at, at);
      return;
    }
    const n = await ss.chapter(notesId);
    if (!n || n.text.slice(at, at + added.length) !== added) return;
    const text = n.text.slice(0, at) + n.text.slice(at + added.length);
    const res = await writeNotes(n, text);
    if (!res || res.stored === 'failed') {
      failed = true;
      syncState();
      return;
    }
    const hh = hist.get(n.id);
    if (!hh || res.stored !== 'wrote') return;
    const top = hh.undo[hh.undo.length - 1];
    if (hh.base.text === n.text && top?.text === text) hh.base = hh.undo.pop()!;
    else {
      hh.undo.push(hh.base);
      hh.base = { text, s: at, e: at };
    }
  };
  const afterChange = (msg: string, next: string) => {
    if (cwOpen) closeCw();
    app.toast(msg, {
      label: 'Undo',
      run: () => {
        if (cur && tab === 'page' && ta.value === next) undo();
      },
    });
  };
  const cardEl = (c: Card) => {
    const textEl = h('p', { class: 'st-card-t', text: c.text });
    const msg = h('p', { class: 'st-card-msg', role: 'status' });
    let editor: HTMLTextAreaElement | null = null;
    let editTimer = 0;
    const value = () => (editor ? editor.value : c.text).trim();
    const tell = (t: string) => (msg.textContent = t);
    const acts = h('div', { class: 'st-card-acts' });
    const card = h('article', { class: `st-card st-card--${c.mode}`, 'data-id': c.id }, h('span', { class: 'st-card-k', text: MODE_LABEL[c.mode] }), textEl, acts, msg);
    let main: HTMLButtonElement;
    if (c.mode === 'continue')
      main = btn('Insert', async () => {
        const next = await insertText(value());
        if (next === null) return tell(STORY.full);
        afterChange('Added to your page.', next);
      }, { kind: 'primary', cls: 'dq-btn--sm' });
    else if (c.mode === 'polish')
      main = btn('Replace', async () => {
        const done = await replaceSel(c.sel, value());
        if (!done) return tell(STORY.full);
        const { next, moved } = done;
        if (moved) {
          tell(STORY.moved);
          say(STORY.moved);
        }
        afterChange(moved ? STORY.moved : 'Replaced.', next);
      }, { kind: 'primary', cls: 'dq-btn--sm' });
    else if (c.mode === 'whatif')
      main = btn('Add to Notes', async () => {
        const r2 = await appendNotes(`• ${value()}`);
        tell(r2 === 'ok' ? STORY.addedNotes : r2 === 'full' ? STORY.full : STORY.notSaving);
      }, { kind: 'primary', cls: 'dq-btn--sm' });
    else {
      main = btn('Answer', () => {
        if (card.querySelector('.st-answer')) return card.querySelector<HTMLInputElement>('.st-answer input')?.focus();
        const id = `st-ans-${c.id}`;
        const inp = h('input', { id, class: 'dq-input', type: 'text', maxlength: 600, autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'true', enterkeyhint: 'done' });
        const saveA = async () => {
          const a = inp.value.trim();
          if (!a) return inp.focus();
          const r2 = await appendNotes(`Q: ${value()}\nA: ${a}`);
          tell(r2 === 'ok' ? 'Saved to Notes.' : r2 === 'full' ? STORY.full : STORY.notSaving);
          if (r2 === 'ok') row.remove();
        };
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') (e.preventDefault(), void saveA());
        });
        const row = h('div', { class: 'st-answer' }, h('label', { for: id, class: 'dq-sr', text: 'Your answer' }), inp, btn('Save', () => void saveA(), { kind: 'primary', cls: 'dq-btn--sm' }));
        acts.after(row);
        inp.focus();
      }, { kind: 'primary', cls: 'dq-btn--sm' });
    }
    const editB = btn('Edit', () => {
      if (editor) {
        c.text = editor.value;
        textEl.textContent = c.text;
        editor.replaceWith(textEl);
        editor = null;
        editB.querySelector('.dq-btn-t')!.textContent = 'Edit';
        persistCards();
        return;
      }
      editor = h('textarea', { class: 'st-card-edit', 'aria-label': `Edit this ${MODE_LABEL[c.mode]} card`, maxlength: STORY_CAP.card, spellcheck: 'true', autocapitalize: 'sentences' }) as HTMLTextAreaElement;
      editor.value = c.text;
      editor.addEventListener('input', () => {
        clearTimeout(editTimer);
        editTimer = window.setTimeout(() => {
          if (!editor) return;
          c.text = editor.value;
          persistCards();
        }, 500);
        editor!.style.height = 'auto';
        editor!.style.height = `${editor!.scrollHeight + 2}px`;
      });
      textEl.replaceWith(editor);
      editor.style.height = `${Math.max(88, editor.scrollHeight + 2)}px`;
      editor.focus();
      editB.querySelector('.dq-btn-t')!.textContent = 'Done';
    }, { kind: 'quiet', cls: 'dq-btn--sm' });
    const tossB = btn('Toss', () => {
      const i = cards.indexOf(c);
      if (i < 0) return;
      cards.splice(i, 1);
      persistCards();
      renderCards(false);
      app.toast('Tossed.', {
        label: 'Undo',
        run: () => {
          cards.splice(Math.min(i, cards.length), 0, c);
          cards = cards.slice(0, 12);
          persistCards();
          renderCards(false);
        },
      });
    }, { kind: 'link', cls: 'st-toss' });
    acts.append(main, editB, tossB);
    return card;
  };
  const renderCards = (fresh: boolean) => {
    if (!cards.length) {
      cardsEl.replaceChildren(h('p', { class: 'st-cards-empty', text: STORY.cardsEmpty }));
      return;
    }
    const groups: Card[][] = [];
    for (const c of cards) {
      const g = groups[groups.length - 1];
      if (g && g[0].t === c.t) g.push(c);
      else groups.push([c]);
    }
    cardsEl.replaceChildren(
      ...groups.map((g, i) => h('div', { class: `st-batch ${i ? 'is-older' : ''}` }, i === 1 ? h('p', { class: 'st-batch-k', text: 'Earlier' }) : null, g.map(cardEl))),
    );
    if (fresh && !app.reduced()) {
      const first = cardsEl.querySelector('.st-batch');
      if (first) animate(first as HTMLElement, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  };

  // ---------- on-screen keyboard (iPhone): keep the dock and the sheet above it ----------
  const vv = window.visualViewport;
  const kb = () => {
    if (!vv) return;
    const inset = Math.max(0, Math.round(innerHeight - (vv.height + vv.offsetTop)));
    el.style.setProperty('--st-kb', `${inset}px`);
    dock.style.transform = inset > 0 ? `translateY(${-inset}px)` : '';
  };
  if (vv) {
    on(vv, 'resize', kb);
    on(vv, 'scroll', kb);
  }
  on(window, 'resize', grow);

  // ---------- start ----------
  const init = async () => {
    await ss.sweepLives();
    const s = await ss.story(storyId);
    if (!alive) return;
    if (!s || s.removed) {
      main.replaceChildren(h('div', { class: 'dq-panel st-empty' }, h('p', { class: 'st-empty-t', text: STORY.gone }), h('div', { class: 'dq-actions' }, btn('Story Room', () => app.go({ name: 'stories' }, { replace: true }), { kind: 'primary' }))));
      cw.remove();
      return;
    }
    story = s;
    notesId = s.notes;
    titleIn.value = s.title;
    pageId = r.ch && s.chapters.includes(r.ch) ? r.ch : s.chapters[0] ?? '';
    if (!pageId) pageId = (await ss.addChapter(storyId)).id;
    await loadCards();
    await load(pageId);
    await refreshStory();
    syncState();
    syncModes();
    kb();
  };
  renderCards(false);
  syncModes();
  void init();

  return {
    el,
    title: STORY.title,
    mode: 'sub',
    bubbles: [0.9, 0.45],
    foot: dock,
    // the screen's entry animation holds an identity transform, which would pin the fixed sheets to this element
    after: () => el.getAnimations().forEach((a) => void a.finished.then(() => a.cancel()).catch(() => undefined)),
    leave: () => {
      commit();
      pinLive();
      void save();
      saveTitle();
      alive = false;
      closeMenu();
      if (sheet) sheet.remove();
      offs.forEach((f) => f());
    },
  };
}

// ---------------- reading ----------------
const sizeKey = (app: App) => `${app.store.key}${BESIDE.readSize}`;
/** The reading size chosen on this device. Nothing stored, or a size this version doesn't know, reads as the first. */
function storedSize(app: App): ReadSize {
  try {
    const v = localStorage.getItem(sizeKey(app));
    return READ_SIZES.find((x) => x === v) ?? READ_SIZES[0];
  } catch {
    return READ_SIZES[0];
  }
}

/** The story to read straight through, every chapter in order, at the text size they pick. Nothing here changes it. */
export function readScreen(app: App, route: Route): ScreenOut {
  const r = route as Extract<Route, { name: 'read' }>;
  const ss = store(app);
  let alive = true;
  const title = h('h1', { class: 'dq-h1', 'data-focus': '' });
  const sub = h('p', { class: 'dq-text dq-pagesub' });
  const sizeL = h('span', { class: 'st-read-tools-l', id: `st-size-${rid()}`, text: STORY_READ.size });
  const sizeBtns = READ_SIZES.map((v) => h('button', { type: 'button', class: `dq-seg-b st-size-b st-size-b--${v}`, 'aria-label': STORY_READ.sizes[v], 'aria-pressed': 'false', onclick: () => setSize(v, true), text: 'A' }));
  const tools = h('div', { class: 'st-read-tools' }, sizeL, h('div', { class: 'dq-seg st-size', role: 'group', 'aria-labelledby': sizeL.id }, sizeBtns));
  const body = h('div', { class: 'st-read-body' });
  const page = h('article', { class: 'dq-panel st-read', 'aria-label': 'Your story' }, h('span', { class: 'dq-hairbar', 'aria-hidden': 'true' }), body);
  const el = h(
    'div',
    { class: 'st-reader' },
    h('header', { class: 'dq-pagehead st-head' }, h('div', { class: 'st-head-row' }, title), sub),
    tools,
    page,
    h('div', { class: 'dq-actions st-read-acts' }, btn(STORY_READ.back, () => app.back(), { kind: 'quiet', ic: 'pencil' })),
  );
  const setSize = (v: ReadSize, keep = false) => {
    page.dataset.size = v;
    sizeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(READ_SIZES[i] === v)));
    if (keep)
      write(() => {
        try {
          localStorage.setItem(sizeKey(app), v);
        } catch {
          /* storage blocked or full: the size still holds while this screen is open */
        }
      });
  };
  setSize(storedSize(app));

  const init = async () => {
    const s = await ss.story(r.id);
    if (!alive) return;
    if (!s || s.removed) {
      title.textContent = STORY.title;
      tools.remove();
      body.replaceChildren(h('p', { class: 'st-read-empty', text: STORY_READ.gone }));
      return;
    }
    title.textContent = shownTitle(s.title);
    sub.textContent = storyMeta(app, s);
    // what this copy holds but couldn't store yet reads as it is in the editor
    const chs = await Promise.all(s.chapters.map(async (id) => ss.unsaved(id) ?? (await ss.chapter(id))));
    if (!alive) return;
    const secs = chs.flatMap((c, i) =>
      c && c.text.trim()
        ? [h('section', { class: 'st-read-ch', 'data-id': c.id }, h('h2', { class: 'st-read-ch-h', text: c.title.trim() || `Chapter ${i + 1}` }), h('div', { class: 'st-read-text', text: c.text.replace(/\s+$/, '') }))]
        : [],
    );
    if (!secs.length) return body.replaceChildren(h('p', { class: 'st-read-empty', text: STORY_READ.empty }));
    body.replaceChildren(...secs);
    const at = secs.findIndex((x) => x.dataset.id === r.ch);
    if (at > 0) secs[at].scrollIntoView({ block: 'start' });
  };
  void init();

  return {
    el,
    title: STORY.title,
    mode: 'sub',
    bubbles: [0.9, 0.45],
    leave: () => {
      alive = false;
    },
  };
}
