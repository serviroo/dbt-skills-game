/**
 * The text size chosen on this device, kept beside the save under BESIDE.readSize. Settings and the Story Room's
 * reading page set it; reading and the Safe Zone follow it.
 */
import { onClear, write } from '../core/cleared';
import { BESIDE, READ_SIZES, type ReadSize } from '../core/stored-names';
import type { App } from './app';

const key = (app: App) => `${app.store.key}${BESIDE.readSize}`;
/** A size picked while storage refused it, held for the rest of the visit; a later stored size takes over again. */
const held = new Map<string, ReadSize>();
// clearing the game's data lets go of a held size, as it removes a stored one
onClear({ clear: () => held.clear() });

/** Nothing stored, or a size this version doesn't know, reads as the first. */
export function textSize(app: App): ReadSize {
  const kept = held.get(key(app));
  if (kept) return kept;
  try {
    const v = localStorage.getItem(key(app));
    return READ_SIZES.find((x) => x === v) ?? READ_SIZES[0];
  } catch {
    return READ_SIZES[0];
  }
}

export function keepTextSize(app: App, v: ReadSize) {
  write(() => {
    try {
      localStorage.setItem(key(app), v);
      held.delete(key(app));
    } catch {
      // storage blocked or full: the size still holds everywhere until the visit ends
      held.set(key(app), v);
    }
  });
}
