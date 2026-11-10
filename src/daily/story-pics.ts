import { STORY_DRAWING } from '../content/story-lines';
import type { App } from './app';
import { artStore, revOf, type DrawingMeta } from './artstore';
import { dayLabel } from './lines';
import { icon } from './art';
import { refill } from './artroom';
import type { Story, StoryStore } from './storystore';
import { btn, h, keptWhole, p, typo } from './ui';

const drawingName = (m: DrawingMeta) =>
  typo(m.name?.trim() || (m.kind === 'ally' ? STORY_DRAWING.ally : STORY_DRAWING.page(dayLabel(m.day))));
export const picOf = (m: DrawingMeta | undefined) => (m ? `${m.id}|${revOf(m)}|${drawingName(m)}` : '');
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
export function drawingFig(app: App, m: DrawingMeta) {
  const fig = h('figure', { class: `st-read-pic st-pic--${m.kind}` });
  fig.append(drawingImg(app, m, drawingName(m), fig));
  return fig;
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
  let picTurn = 0;
  let picShown: string | null = null;
  const showPic = async () => {
    const turn = ++picTurn;
    const at = current()?.kind === 'page' ? current()!.id : '';
    const s = at ? await ss.story(storyId) : null;
    const m = s ? (await drawingsOf(app, s)).get(at) : undefined;
    if (turn !== picTurn || !alive() || picOf(m) === picShown) return;
    picShown = picOf(m);
    picThumb.replaceChildren(...(m ? [drawingImg(app, m, '')] : []));
    picThumb.classList.toggle('is-hidden', !m);
    picIc.classList.toggle('is-hidden', !!m);
    picT.textContent = m ? STORY_DRAWING.change : STORY_DRAWING.add;
    if (m) picBtn.setAttribute('aria-label', `${STORY_DRAWING.change}, ${drawingName(m)}`);
    else picBtn.removeAttribute('aria-label');
  };
  const placeDrawing = async (at: string, id: string | null) => {
    closeSheet();
    await ss.setDrawing(storyId, at, id);
    if (!alive()) return;
    syncState();
    await showPic();
  };
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
    const fill = async () => {
      const n = ++turn;
      const [list, s] = await Promise.all([
        artStore(app.store.key).shown().catch((): DrawingMeta[] => []), ss.story(storyId),
      ]);
      if (n !== turn) return false;
      const placed = s?.drawings?.[at];
      const inside = body.contains(document.activeElement);
      refill(body, [placed ?? '', ...list.map(picOf)].join('\n'), () => [
        top,
        list.length
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
        ...(list.some((m) => m.id === placed) ? [takeOff] : []),
      ]);
      if (inside && !body.contains(document.activeElement)) {
        body.querySelector<HTMLElement>('.st-pick, .st-picks-none .dq-btn, .dq-sheet-x')
          ?.focus({ preventScroll: true });
      }
      return true;
    };
    if (!(await fill()) || !alive() || current()?.id !== at) return;
    closeSheet();
    picker = { wrap, fill };
    openSheet(wrap, body);
    (body.querySelector<HTMLElement>('.st-pick[aria-current="true"]') ??
      body.querySelector<HTMLElement>('.st-pick, .st-picks-none .dq-btn'))?.focus({ preventScroll: true });
  };
  const update = () => {
    void showPic();
    if (picker && isOpen(picker.wrap)) void picker.fill();
  };
  return { showPic, openDrawings, update };
}
