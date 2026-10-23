import { parsePrefs, PREFS_KEY, savePrefs, type AudioLevels, type VolumeCtrl } from '../audio/prefs';
import type { Store } from './store';

interface Preferences {
  audio?: AudioLevels & { v: 1 };
  room?: { aquarium: boolean; words: boolean };
  safeLight?: 'up' | 'dim';
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export function exportPreferences(key: string) {
  const preferences: Preferences = {};
  let incomplete = false;
  try {
    const audio = localStorage.getItem(PREFS_KEY);
    if (audio !== null) preferences.audio = { v: 1, ...parsePrefs(audio) };
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
    const destination: unknown = audioRaw === null ? {} : JSON.parse(audioRaw);
    const audio = object(prefs.audio) && prefs.audio.v === 1 ? parsePrefs(JSON.stringify(prefs.audio)) : null;
    let saved = true;
    if (object(destination) && (audioRaw === null || destination.v === 1)) {
      const levels = volume?.get() ?? parsePrefs(audioRaw);
      let changed = false;
      if (audio) {
        for (const k of ['master', 'music', 'sfx'] as const) {
          if (!Object.hasOwn(destination, k)) { levels[k] = audio[k]; changed = true; }
        }
        if (!Object.hasOwn(destination, 'muted')) { levels.muted ||= audio.muted; changed = true; }
      }
      if (audioRaw === null && !audio && !store.state.settings.sound) { levels.muted = true; changed = true; }
      if (changed) {
        if (volume) volume.set(levels);
        else savePrefs(levels);
        const stored = parsePrefs(localStorage.getItem(PREFS_KEY));
        saved = localStorage.getItem(PREFS_KEY) !== null && (Object.keys(levels) as (keyof AudioLevels)[]).every((k) => stored[k] === levels[k]);
      }
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
