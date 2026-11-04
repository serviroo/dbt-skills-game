import type { Place, Route } from './app';

/** One of the companion's entries in the browser's history: a route and a place, never anything typed. */
export interface Entry {
  dq: 1;
  /** position from the companion's first entry, which is always Home */
  i: number;
  /** one visit to a screen; its places and anything open over it share the key */
  key: string;
  route: Route;
  place?: Place;
  /** a window, sheet, menu or panel open over the screen */
  sheet?: true;
  replayed?: true;
}

export const HOME: Entry = { dq: 1, i: 0, key: 'home', route: { name: 'hub' } };

export const REPLAYED = Symbol('replayed');

export const isEntry = (s: unknown): s is Entry => {
  const e = s as Entry;
  return !!e && typeof e === 'object' && e.dq === 1 && Number.isInteger(e.i) && !!e.route;
};
