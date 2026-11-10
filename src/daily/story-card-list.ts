import { uid } from './store';
import { CARD_MODES, STORY_CAP, type Card, type CardMode } from './storystore';

const ID = /^[A-Za-z0-9~._-]{1,40}$/;
const LISTED = 2000;
const MAX_STAMP = 8.64e15;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const validId = (x: unknown): x is string => typeof x === 'string' && ID.test(x);
const stampOf = (x: unknown) => (fin(x) ? Math.max(0, Math.min(MAX_STAMP, x)) : 0);

export function cleanCard(x: unknown): Card | null {
  if (!isObj(x) || !CARD_MODES.includes(x.mode as CardMode) || typeof x.text !== 'string') return null;
  const c: Card = {
    id: validId(x.id) ? x.id : uid(), mode: x.mode as CardMode,
    text: x.text.slice(0, STORY_CAP.card), t: stampOf(x.t),
  };
  const s = x.sel;
  if (isObj(s) && fin(s.start) && fin(s.end) && typeof s.text === 'string') {
    c.sel = { start: Math.max(0, s.start), end: Math.max(0, s.end), text: s.text.slice(0, STORY_CAP.card) };
  }
  return c;
}

export function mergeCards(local: Card[], incoming: unknown[]) {
  const merged = new Map<string, Card>();
  for (const card of local) {
    const had = merged.get(card.id);
    if (!had || card.t > had.t) merged.set(card.id, card);
  }
  let skipped = Math.max(0, incoming.length - LISTED);
  for (const value of incoming.slice(0, LISTED)) {
    const card = cleanCard(value);
    if (!card) { skipped++; continue; }
    const had = merged.get(card.id);
    if (!had && merged.size >= STORY_CAP.cards) { skipped++; continue; }
    if (!had || card.t > had.t) merged.set(card.id, card);
  }
  return { cards: [...merged.values()], skipped };
}

export function cardLists(x: Record<string, unknown>) {
  const maxCh = STORY_CAP.stories * (STORY_CAP.chapters + 2);
  const entries = Object.entries(x);
  const lists: [string, unknown[]][] = [];
  let skipped = Math.max(0, entries.length - maxCh);
  for (const [id, list] of entries.slice(0, maxCh)) {
    if (validId(id) && Array.isArray(list)) lists.push([id, list]);
    else skipped++;
  }
  return { lists, skipped };
}

export function skippedCards(x: unknown) {
  if (!isObj(x)) return 0;
  const { lists, skipped } = cardLists(x);
  return lists.reduce((n, [, list]) => n + mergeCards([], list).skipped, skipped);
}
