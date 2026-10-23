import { parsePrefs, PREFS_KEY, savePrefs, type AudioLevels, type VolumeCtrl } from '../audio/prefs';
import type { Store } from './store';

interface Preferences {
  audio?: AudioLevels & { v: 1 };
  room?: { aquarium: boolean; words: boolean };
  safeLight?: 'up' | 'dim';
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export function exportPreferences(store: Store, volume?: VolumeCtrl) {
  const key = store.key;
  const preferences: Preferences = volume ? { audio: { v: 1, ...volume.snapshot() } } : {};
  let incomplete = false;
  try {
    const audio = localStorage.getItem(PREFS_KEY);
    if (!volume) {
      const levels = parsePrefs(audio);
      preferences.audio = { v: 1, ...levels, muted: Object.hasOwn(store.state.setAt, 'sound') ? !store.state.settings.sound : levels.muted || !store.state.settings.sound };
    }
    const room = localStorage.getItem(`${key}:stealth`);
    if (room !== null) {
      const value: unknown = JSON.parse(room);
      if (object(value)) preferences.room = { aquarium: value.aquarium === true, words: value.words === true };
    }
    const light = localStorage.getItem(`${key}.safeLight`);
    if (light === 'up' || light === 'dim') preferences.safeLight = light;
  } catch {
    incomplete = true;
  }
  return { preferences, incomplete };
}

export function restorePreferences(raw: unknown, store: Store, volume?: VolumeCtrl) {
  const prefs = object(raw) ? raw : {};
  try {
    volume?.flush();
    const audioRaw = localStorage.getItem(PREFS_KEY);
    let destination: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(audioRaw ?? 'null');
      if (object(parsed) && parsed.v === 1) destination = parsed;
    } catch {}
    const audio = object(prefs.audio) && prefs.audio.v === 1 ? parsePrefs(JSON.stringify(prefs.audio)) : null;
    let saved = true;
    const levels = parsePrefs(audioRaw);
    let changed = false;
    if (audio) {
      for (const k of ['master', 'music', 'sfx'] as const) {
        if (typeof destination[k] !== 'number' || !Number.isFinite(destination[k])) { levels[k] = audio[k]; changed = true; }
      }
      if (typeof destination.muted !== 'boolean') { levels.muted ||= audio.muted; changed = true; }
    }
    if (!audio && typeof destination.muted !== 'boolean' && !store.state.settings.sound) { levels.muted = true; changed = true; }
    if (changed) {
      const expected = volume ? volume.restore(levels) : levels;
      if (!volume) savePrefs(levels);
      const stored = parsePrefs(localStorage.getItem(PREFS_KEY));
      saved = localStorage.getItem(PREFS_KEY) !== null && (Object.keys(expected) as (keyof AudioLevels)[]).every((k) => stored[k] === expected[k]);
    }
    if (object(prefs.room)) {
      const roomRaw = localStorage.getItem(`${store.key}:stealth`);
      const room: unknown = roomRaw === null ? {} : JSON.parse(roomRaw);
      if (object(room)) {
        const next = { ...room };
        for (const k of ['aquarium', 'words'] as const) if (!Object.hasOwn(room, k) && typeof prefs.room[k] === 'boolean') next[k] = prefs.room[k];
        if (JSON.stringify(next) !== JSON.stringify(room)) localStorage.setItem(`${store.key}:stealth`, JSON.stringify(next));
      }
    }
    if ((prefs.safeLight === 'up' || prefs.safeLight === 'dim') && localStorage.getItem(`${store.key}.safeLight`) === null) {
      localStorage.setItem(`${store.key}.safeLight`, prefs.safeLight);
    }
    return saved;
  } catch {
    return false;
  }
}
