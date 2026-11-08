import { READ_SIZES, type ReadSize } from '../core/stored-names';
import { STORY_READ } from '../content/story-lines';
import type { App, Route, ScreenOut } from './app';
import { artStore } from './artstore';
import { keepTextSize, textSize } from './text-size';
import { btn, h, p } from './ui';
import { wholeText } from './page-head';
import { drawingFig, drawingsOf, picOf, rid, shownTitle, store, STORY, storyMeta } from './storyroom';

/** The story to read straight through, every chapter in order, at the text size they pick. Nothing here changes it. */
export function readScreen(app: App, route: Route): ScreenOut {
  const r = route as Extract<Route, { name: 'read' }>;
  const ss = store(app);
  let alive = true;
  let offArt = () => {};
  const title = h('h1', { class: 'dq-h1', 'data-focus': '' });
  const sub = h('p', { class: 'dq-text dq-pagesub' });
  const sizeL = h('span', { class: 'st-read-tools-l', id: `st-size-${rid()}`, text: STORY_READ.size });
  const sizeBtns = READ_SIZES.map((v) =>
    h('button', {
      type: 'button',
      class: `dq-seg-b st-size-b st-size-b--${v}`,
      'aria-label': STORY_READ.sizes[v],
      'aria-pressed': 'false',
      onclick: () => setSize(v, true),
      text: 'A',
    }),
  );
  const tools = h(
    'div',
    { class: 'st-read-tools' },
    sizeL,
    h('div', { class: 'dq-seg st-size', role: 'group', 'aria-labelledby': sizeL.id }, sizeBtns),
  );
  const body = h('div', { class: 'st-read-body' });
  const page = h(
    'article',
    { class: 'dq-panel st-read', 'aria-label': 'Your story' },
    h('span', { class: 'dq-hairbar', 'aria-hidden': 'true' }),
    body,
  );
  const el = h(
    'div',
    { class: 'st-reader' },
    h('header', { class: 'dq-pagehead st-head' }, h('div', { class: 'st-head-row' }, title), sub),
    tools,
    page,
    h(
      'div',
      { class: 'dq-actions st-read-acts' },
      btn(STORY_READ.back, () => app.back(), { kind: 'quiet', ic: 'pencil' }),
    ),
  );
  const setSize = (v: ReadSize, keep = false) => {
    page.dataset.size = v;
    sizeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(READ_SIZES[i] === v)));
    if (keep) keepTextSize(app, v);
  };
  setSize(textSize(app));
  // a size chosen in another open copy
  const offSize = app.store.onChange(() => setSize(textSize(app)));

  let unkeep = () => {};
  /**
   * The chapter they came from starts just clear of the top bar and its shade (the scroll padding in daily.css), even a
   * short last one: room after the page lets it scroll that far. Measured from the layout, so the screen's entry motion
   * can't shift it, and placed again whenever the page or the screen changes size (the fonts coming in, a turn of the
   * phone) until they scroll.
   */
  const openAt = (sec: HTMLElement) => {
    const box = app.root;
    const room = el.appendChild(h('div', { 'aria-hidden': 'true' }));
    const sizes = () => [box.clientWidth, box.clientHeight, body.offsetHeight].join();
    let put = 0;
    let placedAt = '';
    const place = () => {
      let y = 0;
      for (let n: HTMLElement | null = sec; n && n !== box; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      const top = y - (parseFloat(getComputedStyle(box).scrollPaddingTop) || 0);
      // a page shorter than the screen still scrolls a full screen high, so give it a screen of room and trim the
      // excess
      room.style.height = `${box.clientHeight}px`;
      room.style.height = `${Math.max(0, box.clientHeight - (box.scrollHeight - box.clientHeight - top))}px`;
      box.scrollTop = top;
      put = box.scrollTop;
      placedAt = sizes();
    };
    place();
    const keep = new ResizeObserver(place);
    // a scroll with no change of size is theirs and ends it; a screen grown past the end of the page also pulls the
    // scroll back, but that comes with a new size and is placed again
    const theirs = () => Math.abs(box.scrollTop - put) >= 1 && sizes() === placedAt && unkeep();
    keep.observe(box);
    keep.observe(body);
    box.addEventListener('scroll', theirs, { passive: true });
    unkeep = () => (keep.disconnect(), box.removeEventListener('scroll', theirs));
  };

  const init = async () => {
    const s = await ss.story(r.id);
    if (!alive) return;
    if (!s || s.removed) {
      wholeText(title, STORY.title);
      tools.remove();
      body.replaceChildren(h('p', { class: 'st-read-empty', text: STORY_READ.gone }));
      return;
    }
    wholeText(title, shownTitle(s.title));
    sub.textContent = storyMeta(app, s);
    // what this copy holds but couldn't store yet reads as it is in the editor
    const chs = await Promise.all(s.chapters.map(async (id) => ss.unsaved(id) ?? (await ss.chapter(id))));
    if (!alive) return;
    const shown = chs.flatMap((c, i) =>
      c && c.text.trim()
        ? [
            {
              i,
              id: c.id,
              sec: h(
                'section',
                { class: 'st-read-ch', 'data-id': c.id },
                h('h2', { class: 'st-read-ch-h', text: c.title.trim() || `Chapter ${i + 1}` }),
                h('div', { class: 'st-read-text', text: c.text.trimEnd() }),
              ),
            },
          ]
        : [],
    );
    if (!shown.length) return body.replaceChildren(h('p', { class: 'st-read-empty', text: STORY_READ.empty }));
    body.replaceChildren(...shown.map((x) => x.sec));
    // the words come first; each drawing joins above its chapter once found, its room kept by its shape, and follows
    // the Art room from then on (a drawing removed, brought back with its Undo or renamed, in any tab)
    const pics = new Map<string, string>();
    let turn = 0;
    const showPics = async () => {
      const n = ++turn;
      const by = await drawingsOf(app, s);
      if (!alive || n !== turn) return;
      for (const x of shown) {
        const m = by.get(x.id);
        if ((pics.get(x.id) ?? '') === picOf(m)) continue;
        pics.set(x.id, picOf(m));
        x.sec.querySelector(':scope > .st-read-pic')?.remove();
        if (m) x.sec.prepend(drawingFig(app, m));
      }
    };
    offArt = artStore(app.store.key).onChange(() => void showPics());
    void showPics();
    // an empty chapter isn't shown, so Read from one (a chapter just added) opens at the nearest chapter before it;
    // only chapter 1 opens at the top of the page, so a chapter 2 that comes first (chapter 1 has no words yet) is
    // placed too
    const from = r.ch ? s.chapters.indexOf(r.ch) : -1;
    let at = -1;
    for (const [k, x] of shown.entries()) if (x.i <= from) at = k;
    if (at >= 0 && shown[at].i > 0) openAt(shown[at].sec);
  };

  return {
    el,
    title: STORY.title,
    mode: 'sub',
    bubbles: [0.9, 0.45],
    // focus lands on the heading once it holds the story, its words and the place it opens at
    ready: init(),
    leave: () => {
      alive = false;
      unkeep();
      offArt();
      offSize();
    },
  };
}
