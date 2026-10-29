/**
 * The text size chosen on this device, kept beside the save under BESIDE.readSize. Settings and the Story Room's
 * reading page set it; reading and the Safe Zone follow it.
 */
import { write } from '../core/cleared';
import { BESIDE, READ_SIZES, type ReadSize } from '../core/stored-names';
import type { App } from './app';

const key = (app: App) => `${app.store.key}${BESIDE.readSize}`;

/** Nothing stored, or a size this version doesn't know, reads as the first. */
export function textSize(app: App): ReadSize {
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
    } catch {
      /* storage blocked or full: the size still holds on the screen it was picked on */
    }
  });
}
