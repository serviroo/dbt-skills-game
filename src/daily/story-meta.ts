import type { App } from './app';
import { dayDiff, dayKey } from './store';
import type { Story } from './storystore';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "edited today" / "edited Tuesday" / "edited 3 March", on the companion's day (it turns over at 6 AM). */
export function editedWhen(app: App, t: number) {
  const day = dayKey(t);
  const today = app.store.today();
  const d = dayDiff(day, today);
  if (d <= 0) return 'edited today';
  if (d === 1) return 'edited yesterday';
  const [y, m, dd] = day.split('-').map(Number);
  if (d < 7) return `edited ${DOW[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}`;
  return `edited ${dd} ${MON[m - 1]}${today.slice(0, 4) === String(y) ? '' : ` ${y}`}`;
}
export function storyMeta(app: App, s: Story) {
  const n = s.chapters.length;
  return `${n} chapter${n === 1 ? '' : 's'}, ${editedWhen(app, s.updated)}`;
}
