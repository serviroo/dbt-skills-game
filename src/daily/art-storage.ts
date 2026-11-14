import { ART } from '../content/daily-lines';
import type { ArtStore } from './artstore';
import { STORAGE_SAVING_CHANGE } from './idb-link';
import { p, typo } from './ui';

export function watchArtSaving(as: ArtStore, msg: HTMLElement, say: (...kids: (Node | string | null)[]) => void) {
  let last = as.persistent;
  const change = () => {
    const now = as.persistent;
    if (now === last) return;
    last = now;
    if (!now && !msg.textContent?.includes(typo(ART.noStore))) say(p(ART.noStore, 'dq-small'));
    else if (now && msg.textContent === typo(ART.noStore)) say();
  };
  document.addEventListener(STORAGE_SAVING_CHANGE, change);
  return () => document.removeEventListener(STORAGE_SAVING_CHANGE, change);
}
