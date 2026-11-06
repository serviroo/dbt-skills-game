import { LETTER } from '../content/intro';
import type { App, Visit } from './app';
import { icon } from './art';
import { REPLAYED } from './history';
import { btn, focusWhole, h, p, panel } from './ui';

export function introPanel(app: App, visit: Visit, openLetter: () => void) {
  const replay = btn('Replay cutscene', () => app.replay(), { kind: 'quiet', ic: 'replay' });
  const el = panel(
    { title: 'Intro', ic: icon('replay') },
    p('The cutscene, the shadows and the chest. As many times as you like.', 'dq-text'),
    h('div', { class: 'dq-actions' }, replay, btn(LETTER.title, openLetter, { kind: 'quiet', ic: 'book' })),
  );
  return { el, after: () => visit.handed === REPLAYED && focusWhole(replay) };
}
