import { STORY_FIND } from '../content/story-lines';
import { reading } from './reading';
import { match, terms, type Span } from './storyfind';
import type { Chapter, Story, StoryStore } from './storystore';
import { breakable, h } from './ui';

export const marked = (
  text: string,
  at: Span[],
  place?: Span,
  shown = (from: number, to: number): Node => document.createTextNode(text.slice(from, to)),
) => {
  const out: Node[] = [];
  let i = 0;
  for (const [a, b] of at) {
    if (a > i) out.push(shown(i, a));
    out.push(h('mark', { class: `st-mark${place && place[0] === a ? ' is-place' : ''}` }, shown(a, b)));
    i = b;
  }
  if (i < text.length) out.push(shown(i, text.length));
  return out;
};

function snip(text: string, at: Span[]) {
  const [s0, e0] = at[0];
  let a = Math.max(0, s0 - 48);
  let b = Math.min(text.length, e0 + 96);
  if (a > 0) {
    const sp = text.slice(a, s0).search(/\s/);
    if (sp >= 0) a += sp + 1;
  }
  if (b < text.length) {
    const sp = text.slice(e0, b).search(/\s\S*$/);
    if (sp >= 0) b = e0 + sp;
  }
  const part = text.slice(a, b);
  const inPart = at.filter(([x, y]) => x >= a && y <= b).map(([x, y]): Span => [x - a, y - a]);
  return [a > 0 ? '…' : '', ...marked(part, inPart), b < text.length ? '…' : ''];
}


type Shelf = { story: Story; chs: { ch: Chapter; where: string }[] }[];
type Place = { ch: Chapter; where: string; at: Span[] };
export type FindResult = { story: Story; inTitle: Span[] | null; places: Place[] }[];
const shelves = new WeakMap<StoryStore, Promise<Shelf | 'unread'>>();

export function clearFind(ss: StoryStore) {
  shelves.delete(ss);
}

async function readShelf(ss: StoryStore): Promise<Shelf | 'unread'> {
  const read = reading(ss);
  const stories = await ss.list();
  const shelf = await Promise.all(stories.map(async (story) => {
    const chs = await Promise.all([...story.chapters, story.notes].filter(Boolean)
      .map(async (id) => ss.unsaved(id) ?? (await ss.chapter(id))));
    return { story, chs: chs.flatMap((ch, i) => ch
      ? [{ ch, where: ch.kind === 'notes' ? STORY_FIND.notes : ch.title.trim() || `Chapter ${i + 1}` }]
      : []) };
  }));
  return read.failed() ? 'unread' : shelf;
}

export async function findIn(ss: StoryStore, query: string): Promise<FindResult | 'unread'> {
  let pending = shelves.get(ss);
  if (!pending) {
    pending = readShelf(ss);
    shelves.set(ss, pending);
  }
  const shelf = await pending;
  if (shelf === 'unread') {
    if (shelves.get(ss) === pending) shelves.delete(ss);
    return 'unread';
  }
  const words = terms(query);
  return shelf.flatMap(({ story, chs }) => {
    const inTitle = story.title.trim() ? match(story.title.trim(), words) : null;
    const places = chs.flatMap(({ ch, where }) => {
      const at = match(ch.text, words);
      return at ? [{ ch, where, at }] : [];
    });
    return inTitle || places.length ? [{ story, inTitle, places }] : [];
  });
}

export function renderFind(
  result: FindResult,
  open: (story: Story, ch?: Chapter, at?: number) => void,
  meta: (story: Story) => string,
  titleOf: (title: string) => string,
): HTMLElement[] {
  return result.map(({ story, inTitle, places }) => {
    const title = titleOf(story.title);
    const row = (x: Place) => h('li', {}, h('button', {
      type: 'button', class: 'st-found-row', onclick: () => open(story, x.ch, x.at[0][0]),
    }, h('span', { class: 'st-found-where', text: x.where }),
    h('span', { class: 'st-found-snip' }, snip(x.ch.text, x.at))));
    const rows = places.length ? h('ul', { class: 'st-found-list' }, places.slice(0, 6).map(row)) : null;
    const more = rows && places.length > 6 ? h('button', {
      type: 'button', class: 'st-found-more', text: STORY_FIND.more(places.length - 6),
      onclick: () => {
        const rest = places.slice(6).map(row);
        rows.append(...rest);
        more?.remove();
        rest[0].querySelector('button')?.focus();
      },
    }) : null;
    return h('li', { class: 'dq-panel st-found-story' },
      h('button', { type: 'button', class: 'st-found-head', onclick: () => open(story) },
        h('span', { class: `st-row-t ${story.title.trim() ? '' : 'is-untitled'}` },
          inTitle ? marked(title, inTitle, undefined, (from, to) => breakable(title, from, to)) : breakable(title)),
        h('span', { class: 'st-row-m st-found-m', text: meta(story) })), rows, more);
  });
}
