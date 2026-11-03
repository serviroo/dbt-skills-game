import type { App } from './app';

export function showContrast(app: App) {
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
