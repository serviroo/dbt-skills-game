import type { App } from './app';
import type { Paper } from './ink';

/** First saved drawing of a day adds 10 XP, whatever it is. */
export function creditArt(app: App, kind: Paper) {
  const st = app.store;
  const today = st.today();
  if (st.state.events.some((e) => e.k === 'art' && e.day === today)) return false;
  st.add('art', 10, { data: { kind } });
  return true;
}
