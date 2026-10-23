/**
 * Their sound levels (Master, Music, Effects, mute), kept on this device only. The controller applies every change to
 * the engine with a short ramp, persists it, and follows a second tab through the storage event.
 */
import type { AudioEngine, UserLevels } from './engine';

export type AudioLevels = UserLevels;

export const PREFS_KEY = 'dbt.audio.v1';
const DEFAULTS: AudioLevels = { master: 1, music: 1, sfx: 1, muted: false };

const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);

/** Parses a stored value; anything missing, corrupt or foreign gives the defaults. */
export function parsePrefs(raw: string | null): AudioLevels {
  if (raw == null) return { ...DEFAULTS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return { ...DEFAULTS };
    return { master: unit(o.master), music: unit(o.music), sfx: unit(o.sfx), muted: o.muted === true };
  } catch {
    return { ...DEFAULTS };
  }
}

export function loadPrefs(): AudioLevels & { fresh: boolean } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return { ...parsePrefs(raw), fresh: raw == null };
  } catch {
    return { ...DEFAULTS, fresh: true };
  }
}

export function savePrefs(p: AudioLevels) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ v: 1, master: unit(p.master), music: unit(p.music), sfx: unit(p.sfx), muted: p.muted === true }));
  } catch {
    /* storage blocked or full: the levels still hold for this visit */
  }
}

export interface VolumeCtrl {
  /** The levels the controls show (mute includes a ?mute override until the player changes it). */
  get(): AudioLevels;
  /** persist: true (default) saves now; false saves 250 ms after the last change (slider drags). */
  set(p: Partial<AudioLevels>, o?: { persist?: boolean }): void;
  restore(p: AudioLevels): AudioLevels;
  /** Saves a pending debounced change now. */
  flush(): void;
  subscribe(fn: (l: AudioLevels) => void): () => void;
  unlock?(): void;
  readonly available: boolean;
  /** Nothing was stored when the app started (first launch with this control). */
  readonly fresh: boolean;
}

export function createVolume(engine: AudioEngine | null, opts: { fresh: boolean; initial: AudioLevels; forceMute?: boolean }): VolumeCtrl {
  let state: AudioLevels = { ...opts.initial };
  let force = !!opts.forceMute;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  const subs = new Set<(l: AudioLevels) => void>();
  const chosen = new Set<keyof AudioLevels>();
  const view = (): AudioLevels => ({ ...state, muted: state.muted || force });
  const apply = () => {
    try {
      engine?.setUser(view(), 0.08);
    } catch {
      /* audio is optional */
    }
    const v = view();
    for (const f of subs) {
      try {
        f(v);
      } catch {
        /* one broken view must not stop the others */
      }
    }
  };
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    savePrefs(state);
  };
  if (typeof window !== 'undefined') {
    // a drag that ends as the app is closed still keeps its last level
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.hidden && flush());
    window.addEventListener('storage', (e) => {
      if (e.key !== PREFS_KEY && e.key !== null) return;
      if (e.key === null && e.storageArea !== localStorage) return;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      state = parsePrefs(e.key === null ? null : e.newValue);
      chosen.clear();
      apply();
    });
  }
  return {
    available: !!engine,
    fresh: opts.fresh,
    get: view,
    flush,
    restore(p) {
      flush();
      const next = { ...state };
      for (const k of ['master', 'music', 'sfx'] as const) if (!chosen.has(k)) next[k] = unit(p[k]);
      if (!chosen.has('muted')) next.muted ||= p.muted === true;
      state = next;
      apply();
      savePrefs(state);
      return { ...state };
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    unlock: engine ? () => void engine.unlock() : undefined,
    set(p, o = {}) {
      const next = { ...state };
      for (const k of ['master', 'music', 'sfx', 'muted'] as const) if (p[k] !== undefined) chosen.add(k);
      if (p.master !== undefined) next.master = unit(p.master);
      if (p.music !== undefined) next.music = unit(p.music);
      if (p.sfx !== undefined) next.sfx = unit(p.sfx);
      if (p.muted !== undefined) {
        next.muted = p.muted === true;
        force = false;
      } else if (p.master !== undefined && next.master > 0 && (state.muted || force)) {
        next.muted = false;
        force = false;
        chosen.add('muted');
      }
      state = next;
      apply();
      if (o.persist === false) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = 0;
          savePrefs(state);
        }, 250);
      } else {
        if (timer) clearTimeout(timer);
        timer = 0;
        savePrefs(state);
      }
    },
  };
}
