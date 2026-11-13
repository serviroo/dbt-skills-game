import type { App } from './app';
import { icon } from './art';
import { artStore, revOf, type DrawingMeta } from './artstore';
import { h, keptWhole, typo } from './ui';

const store = (app: App) => artStore(app.store.key);

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
export const favFirst = <T extends { fav?: boolean }>(list: T[]) =>
  [...list.filter((m) => m.fav), ...list.filter((m) => !m.fav)];
/** What a drawing's card shows: a save, a name or a favourite changes it; a thumbnail filled in elsewhere does not. */
export const cardOf = (m: DrawingMeta) => [m.id, m.kind, m.day, revOf(m), m.name ?? '', m.fav ? 1 : 0].join('|');
/** The drawing an Undo just brought back: the list that shows it next takes focus to it. */
let back: string | null = null;
export function focusBack(list: HTMLElement) {
  const el = back ? list.querySelector<HTMLElement>(`[data-piece="${CSS.escape(back)}"]`) : null;
  if (!el) return;
  back = null;
  el.focus();
}

export const setFocusBack = (id: string) => { back = id; };

const filled = new WeakMap<HTMLElement, string>();
/**
 * Fills a list of drawing cards again, only when what it shows changed (`shows`). A card that had focus keeps it, or
 * the card now in its place takes it, so a change in another tab never drops a keyboard player out of the list.
 */
export function refill(list: HTMLElement, shows: string, cards: () => HTMLElement[]) {
  if (filled.get(list) === shows) return;
  filled.set(list, shows);
  const was = document.activeElement instanceof HTMLElement && list.contains(document.activeElement)
    ? document.activeElement : null;
  const had = was?.closest<HTMLElement>('[data-piece]');
  const at = had ? [...list.querySelectorAll('[data-piece]')].indexOf(had) : -1;
  list.replaceChildren(...cards());
  const all = [...list.querySelectorAll<HTMLElement>('[data-piece]')];
  // a control kept across the refill (Design an ally) is focused again too
  const to = had ? (all.find((e) => e.dataset.piece === had.dataset.piece) ?? all[Math.min(at, all.length - 1)])
    : was && list.contains(was) ? was : null;
  to?.focus({ preventScroll: true });
}

/** What an ally's card calls it. */
export const allyName = (m: DrawingMeta) => m.name?.trim() || 'Shadow ally';

/** A shadow ally as a full-art Shadow card. */
export function allyCard(app: App, m: DrawingMeta, img?: HTMLImageElement | HTMLCanvasElement, star = false) {
  const name = allyName(m);
  return keptWhole(h(
    'div',
    { class: 'dq-cardface dq-allycard' },
    h('div', { class: 'dq-allycard-art' }, img ?? thumbImg(app, m, `${name}, drawn by you`)),
    h('div', { class: 'dq-allycard-top' },
      h('span', { class: 'dq-allycard-tag', html: `${icon('ally')}<span>Shadow ally</span>` }),
      star && m.fav ? h('span', { class: 'dq-allycard-fav', html: icon('star') }) : null),
    h('div', { class: 'dq-allycard-foot' }, h('div', { class: 'dq-allycard-name', text: typo(name) }),
      h('div', { class: 'dq-allycard-by', text: 'Your design' })),
  ));
}
