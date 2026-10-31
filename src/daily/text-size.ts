/**
 * The text size chosen on this device, kept beside the save under BESIDE.readSize. Settings and the Story Room's
 * reading page set it; they and the Safe Zone show it in every open copy; a Save Crystal carries it.
 */
import { cleared, onClear, write } from '../core/cleared';
import { BESIDE, READ_SIZES, type ReadSize } from '../core/stored-names';
import type { App } from './app';

const key = (saveKey: string) => `${saveKey}${BESIDE.readSize}`;
/** What storage holds under `k`, or undefined where it can't be read. */
const storedAt = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return undefined;
  }
};
/**
 * A size kept while storage refused it, held for the rest of the visit, with what storage held then: a size stored
 * later, chosen here or in another open copy, takes over again.
 */
const held = new Map<string, { size: string; over: string | null | undefined }>();
// clearing the game's data lets go of a held size, as it removes a stored one
onClear({ clear: () => held.clear() });

/** The size held for a save while storage refused it, if any and none was stored since; a Save Crystal carries it. */
export function heldTextSize(saveKey: string) {
  const k = key(saveKey);
  const now = storedAt(k);
  if (now !== undefined && now !== held.get(k)?.over) held.delete(k);
  return held.get(k)?.size;
}

/**
 * Nothing kept, a size this version doesn't know, or storage that can't be read, reads as the first. Nothing is kept once
 * this game's data is cleared, here or in another copy, even while that copy is still taking it off the device.
 */
export function textSize(app: App): ReadSize {
  if (cleared()) return READ_SIZES[0];
  const v = heldTextSize(app.store.key) ?? storedAt(key(app.store.key));
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
      held.set(k, { size: v, over: storedAt(k) });
      stored = false;
    }
  });
  return stored;
}

export const keepTextSize = (app: App, v: ReadSize) => void keepTextSizeFor(app.store.key, v);
