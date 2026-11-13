import { uid } from './store';

/**
 * This page load's id, fresh every load and never shared (a tab opened with window.open copies sessionStorage, so a
 * tab id there could be two tabs'): each load writes and clears only its own mirrors.
 */
export const LOAD = (() => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* not a secure context */
  }
  return `${uid()}${Math.random().toString(36).slice(2, 10)}`;
})();
