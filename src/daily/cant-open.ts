import { CANT_OPEN } from '../content/daily-lines';
import { wakeStorage } from './idb-link';
import { btn, h, p, panel, row, typo } from './ui';
import './cant-open.css';

export type CantOpenWhat = 'story' | 'chapters' | 'storyText' | 'drawing' | 'stories' | 'search' | 'drawings' | 'ideas';

export function cantOpen(what: CantOpenWhat, again: () => Promise<boolean>): HTMLElement {
  const title = h('h2', { class: 'dq-cant-t', 'data-focus': '', tabindex: '-1', text: typo(CANT_OPEN[what]) });
  const note = p(CANT_OPEN.note);
  const retry = btn(CANT_OPEN.retry, () => void tryAgain());
  const label = retry.querySelector('.dq-btn-t')!;
  const busy = (on: boolean) => {
    retry.setAttribute('aria-disabled', String(on));
    label.textContent = typo(on ? CANT_OPEN.trying : CANT_OPEN.retry);
  };
  const tryAgain = async () => {
    if (retry.getAttribute('aria-disabled') === 'true') return;
    busy(true);
    wakeStorage(true);
    const ok = await again().catch(() => false);
    if (!box.isConnected) return;
    busy(false);
    if (!ok) note.textContent = typo(CANT_OPEN.still);
  };
  const box = panel({ cls: 'dq-cant' }, title, note, row(retry));
  box.setAttribute('role', 'alert');
  const lost = () => {
    const at = document.activeElement;
    return !at || at === document.body || at.matches('h1[data-focus]');
  };
  queueMicrotask(() => box.isConnected && lost() && title.focus({ preventScroll: true }));
  return box;
}
