import { CANT_OPEN } from '../content/daily-lines';
import type { App } from './app';
import type { IdbLink } from './idb-link';
import { btn, p, panel, row } from './ui';

export function opening(link: IdbLink) {
  const [misses, stalls] = [link.misses, link.stalls];
  return { stalled: () => link.stalls !== stalls, missed: () => link.present && link.misses !== misses };
}

export function cantOpen(app: App, link: IdbLink, what: 'story' | 'drawing') {
  const again = () => {
    link.reopen();
    app.reopen();
  };
  const title = p(CANT_OPEN[what], 'st-empty-t');
  return panel({ cls: 'st-empty dq-cant' }, title, p(CANT_OPEN.note), row(btn(CANT_OPEN.retry, again)));
}
