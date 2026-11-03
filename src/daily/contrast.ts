import type { App } from './app';
import { toggle } from './ui';

function showContrast(app: App) {
  const html = document.documentElement;
  if (app.store.state.settings.highContrast) html.dataset.dqContrast = 'high';
  else delete html.dataset.dqContrast;
}

export function wireContrast(app: App) {
  showContrast(app);
  const off = app.store.onChange(() => showContrast(app));
  return () => {
    off();
    delete document.documentElement.dataset.dqContrast;
  };
}

export function contrastSwitch(app: App) {
  const st = app.store;
  const row = toggle('Higher contrast', st.state.settings.highContrast, (v) => {
    st.state.settings.highContrast = v;
    st.touch('highContrast');
    st.save();
  }, 'Brighter words and firmer edges on every screen, the Safe Zone too.');
  const input = row.querySelector('input')!;
  const off = st.onChange(() => {
    if (!input.isConnected) return void off();
    input.checked = st.state.settings.highContrast;
  });
  return row;
}
