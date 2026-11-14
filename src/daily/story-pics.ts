import { STORY_DRAWING } from '../content/story-lines';
import type { App } from './app';
import { artStore, revOf, type DrawingMeta } from './artstore';
import { dayLabel } from './lines';
import { cantOpen } from './cant-open';
import { reading } from './reading';
import { icon } from './art';
import { refill } from './art-cards';
import type { Story, StoryStore } from './storystore';
import { btn, h, keptWhole, p, typo } from './ui';

/** What a drawing is called: its own name, else what the Art room calls it. */
const drawingName = (m: DrawingMeta) =>
  typo(m.name?.trim() || (m.kind === 'ally' ? STORY_DRAWING.ally : STORY_DRAWING.page(dayLabel(m.day))));
/** What a drawing shows in the Story Room: a new version or name changes it, a favourite does not. None is ''. */
export const picOf = (m: DrawingMeta | undefined) => (m ? `${m.id}|${revOf(m)}|${drawingName(m)}` : '');
/** The drawing above each page of the story that this device shows, by chapter id. One gone, waiting for its Undo
 * or kept elsewhere is simply not here. */
export async function drawingsOf(app: App, s: Story) {
  const out = new Map<string, DrawingMeta>();
  if (!s.drawings) return out;
  const list = await artStore(app.store.key)
    .shown()
    .catch((): DrawingMeta[] => []);
  for (const [c, id] of Object.entries(s.drawings)) {
    const m = list.find((x) => x.id === id);
    if (m) out.set(c, m);
  }
  return out;
}
/** A drawing's picture, filled in once it is ready; `box` is taken away when there is no picture to show. */
function drawingImg(app: App, m: DrawingMeta, alt: string, box?: HTMLElement) {
  const img = h('img', { class: 'st-pic-img', alt, decoding: 'async', draggable: 'false' });
  void artStore(app.store.key)
    .thumbUrl(m)
    .then(
      (u) => (u ? (img.src = u) : box?.remove()),
      () => box?.remove(),
    );
  return img;
}
/** A drawing above a chapter of the story they read, at its own shape. */
export function drawingFig(app: App, m: DrawingMeta) {
  const fig = h('figure', { class: `st-read-pic st-pic--${m.kind}` });
  fig.append(drawingImg(app, m, drawingName(m), fig));
  return fig;
}

async function shownDrawings(app: App): Promise<DrawingMeta[] | null> {
  const store = artStore(app.store.key);
  const read = reading(store);
  try {
    const list = await store.shown();
    return read.failed() ? null : list;
  } catch {
    return null;
  }
}

type PictureOptions = {
  app: App; ss: StoryStore; storyId: string;
  current: () => { id: string; kind: 'page' | 'notes' } | null;
  alive: () => boolean; closeSheet: () => void; flushAll: () => Promise<void>; syncState: () => void;
  openSheet: (wrap: HTMLElement, body: HTMLElement) => void; isOpen: (wrap: HTMLElement) => boolean;
  picThumb: HTMLElement; picIc: HTMLElement; picT: HTMLElement; picBtn: HTMLElement;
};

export function storyPictures(options: PictureOptions) {
  const { app, ss, storyId, current, alive, closeSheet, flushAll, syncState, openSheet, isOpen } = options;
  const { picThumb, picIc, picT, picBtn } = options;
  /** every look at the open page's drawing takes a number, and only the newest one shows */
  let picTurn = 0;
  let picShown: string | null = null;
  const showPic = async () => {
    const turn = ++picTurn;
    const at = current()?.kind === 'page' ? current()!.id : '';
    const s = at ? await ss.story(storyId) : null;
    const list = s ? await shownDrawings(app) : [];
    const m = list?.find((x) => x.id === s?.drawings?.[at]);
    const unread = list === null && !!s?.drawings?.[at];
    const shown = unread ? 'unread' : picOf(m);
    if (turn !== picTurn || !alive() || shown === picShown) return;
    picShown = shown;
    picThumb.replaceChildren(...(m ? [drawingImg(app, m, '')] : []));
    picThumb.classList.toggle('is-hidden', !m);
    picIc.classList.toggle('is-hidden', !!m);
    picT.textContent = unread ? STORY_DRAWING.unread : m ? STORY_DRAWING.change : STORY_DRAWING.add;
    // the name they see first, then which drawing it is
    if (m) picBtn.setAttribute('aria-label', `${STORY_DRAWING.change}, ${drawingName(m)}`);
    else picBtn.removeAttribute('aria-label');
  };
  /** `at` is the page the picker opened for, which keeps the pick even if another page came in while it was open */
  const placeDrawing = async (at: string, id: string | null) => {
    closeSheet();
    await ss.setDrawing(storyId, at, id);
    if (!alive()) return;
    // a change this device couldn't store says so, as the words do
    syncState();
    await showPic();
  };
  /** the drawing picker while it is open: it follows the Art room as the page's drawing does */
  let picker: { wrap: HTMLElement; fill: () => Promise<boolean> } | null = null;
  const openDrawings = async () => {
    const at = current()?.kind === 'page' ? current()!.id : '';
    if (!at) return;
    const body = h('div', {
      class: 'dq-panel dq-sheet-p st-chsheet st-picks', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'st-pick-h',
    });
    const wrap = h('div', { class: 'dq-sheet st-sheet' }, body);
    const toArt = async () => {
      closeSheet();
      await flushAll();
      if (alive()) app.go({ name: 'art' });
    };
    const top = h('div', { class: 'dq-sheet-top' },
      h('h2', { class: 'dq-sheet-h', id: 'st-pick-h', text: STORY_DRAWING.pick }),
      h('button', { type: 'button', class: 'dq-icbtn dq-sheet-x', 'aria-label': STORY_DRAWING.close,
        html: icon('close'), onclick: closeSheet }));
    const takeOff = h('div', { class: 'dq-actions st-sheet-acts' },
      btn(STORY_DRAWING.remove, () => void placeDrawing(at, null), { kind: 'quiet', ic: 'close' }));
    let turn = 0;
    const focusPicker = () => (
      body.querySelector<HTMLElement>('.st-pick[aria-current="true"]') ??
      body.querySelector<HTMLElement>('.st-pick, .st-picks-none .dq-btn, .dq-cant .dq-btn') ??
      body.querySelector<HTMLElement>('.dq-sheet-x')
    )?.focus({ preventScroll: true });
    const fill = async () => {
      const n = ++turn;
      const [list, s] = await Promise.all([shownDrawings(app), ss.story(storyId)]);
      if (n !== turn) return false;
      if (list !== null) void showPic();
      const placed = s?.drawings?.[at];
      const inside = body.contains(document.activeElement);
      refill(body, list === null ? 'unread' : ['read', placed ?? '', ...list.map(picOf)].join('\n'), () => [
        top,
        list === null ? cantOpen('drawings', fill) : list.length
          ? h(
              'div',
              { class: 'st-picks-grid' },
              list.map((m) =>
                h(
                  'button',
                  { type: 'button', class: 'st-pick', 'data-piece': m.id,
                    'aria-current': m.id === placed ? 'true' : null, onclick: () => void placeDrawing(at, m.id) },
                  h('span', { class: `st-pick-img st-pic--${m.kind}` }, drawingImg(app, m, '')),
                  keptWhole(h('span', { class: 'st-pick-t', text: drawingName(m) })),
                ),
              ),
            )
          : h('div', { class: 'st-picks-none' }, p(STORY_DRAWING.none, 'dq-text'),
              h('div', { class: 'dq-actions st-sheet-acts' },
                btn(STORY_DRAWING.toArt, () => void toArt(), { kind: 'quiet', ic: 'brush' }))),
        ...(list?.some((m) => m.id === placed) ? [takeOff] : []),
      ]);
      // focus that was on a pick or a button the change took away stays in the picker
      if (inside && !body.contains(document.activeElement)) focusPicker();
      return list !== null;
    };
    await fill();
    if (!alive() || current()?.id !== at) return;
    closeSheet();
    picker = { wrap, fill };
    openSheet(wrap, body);
    focusPicker();
  };
  const update = () => {
    void showPic();
    if (picker && isOpen(picker.wrap)) void picker.fill();
  };
  return { showPic, openDrawings, update };
}
