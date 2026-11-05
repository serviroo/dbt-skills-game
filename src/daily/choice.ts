import { h, keptWhole } from './ui';

const shownBy = new WeakMap<HTMLSelectElement, HTMLElement>();

function show(select: HTMLSelectElement) {
  const shown = shownBy.get(select);
  if (!shown) return;
  shown.textContent = select.selectedOptions[0]?.text ?? '';
  keptWhole(shown);
}

export function wholeChoice(select: HTMLSelectElement) {
  const shown = h('span', { class: 'dq-input dq-choice-shown', 'aria-hidden': 'true' });
  shownBy.set(select, shown);
  select.addEventListener('change', () => show(select));
  show(select);
  return h('span', { class: 'dq-choice' }, shown, select);
}

export function choose(select: HTMLSelectElement, value: string) {
  select.value = value;
  show(select);
}
