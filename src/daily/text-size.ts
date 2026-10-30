/**
 * The text size chosen on this device, kept beside the save under BESIDE.readSize. Settings and the Story Room's
 * reading page set it; reading and the Safe Zone follow it; a Save Crystal carries it.
 */
import { onClear, write } from '../core/cleared';
import { BESIDE, READ_SIZES, type ReadSize } from '../core/stored-names';
import type { App } from './app';

const key = (saveKey: string) => `${saveKey}${BESIDE.readSize}`;
/** A size kept while storage refused it, held for the rest of the visit; a later stored size takes over again. */
const held = new Map<string, string>();
// clearing the game's data lets go of a held size, as it removes a stored one
onClear({ clear: () => held.clear() });

/** The size held for a save while storage refused it, if any; a Save Crystal carries it. */
export const heldTextSize = (saveKey: string) => held.get(key(saveKey));

/** Nothing kept, a size this version doesn't know, or storage that can't be read, reads as the first. */
export function textSize(app: App): ReadSize {
  let v = heldTextSize(app.store.key) ?? null;
  if (v === null)
    try {
      v = localStorage.getItem(key(app.store.key));
    } catch {
      /* unreadable: the first size */
    }
  return READ_SIZES.find((x) => x === v) ?? READ_SIZES[0];
}

/**
 * Keeps `v` for a save: stored, or held for the rest of the visit where storage refuses it. False when it could only be
 * held, so it goes when the visit ends.
 */
export function keepTextSizeFor(saveKey: string, v: string) {
  const k = key(saveKey);
  let stored = true;
  write(() => {
    try {
      localStorage.setItem(k, v);
      held.delete(k);
    } catch {
      // storage blocked or full: the size still holds everywhere until the visit ends
      held.set(k, v);
      stored = false;
    }
  });
  return stored;
}

export const keepTextSize = (app: App, v: ReadSize) => void keepTextSizeFor(app.store.key, v);
