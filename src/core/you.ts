/**
 * The player's own name and their companion's name. The companion's store keeps them (so they travel in a Save Crystal
 * and merge across open copies); this small mirror lets the intro use them before that store loads.
 */
import { YOU_KEY } from './stored-names';
import { cleared, write } from './cleared';

export const DEFAULT_NAME = 'Player';
export const DEFAULT_COMPANION = 'Moth';

export interface You {
  /** '' = not chosen, the default shows */
  name: string;
  companion: string;
  /** when each was last chosen (ms); 0 = never (skipped or left blank), so any real choice wins over it */
  nameAt: number;
  companionAt: number;
}

/** A name as stored: no control, bidi or zero-width characters and no <>&" (so it is safe in HTML copy), single spaces,
 * trimmed, at most 24 characters. */
export const cleanName = (x: unknown) =>
  typeof x === 'string'
    ? Array.from(x.slice(0, 400).replace(/[<>&"]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 24).join('').trim()
    : '';

let cache: You | null | undefined;

/** What was chosen on this device, or null if the player was never asked (or storage can't be read). */
export function readYou(): You | null {
  // this game's data was cleared: the names went with it
  if (cleared()) return null;
  if (cache !== undefined) return cache;
  cache = null;
  try {
    const raw = JSON.parse(localStorage.getItem(YOU_KEY) ?? 'null') as Partial<You> | null;
    // a timestamp from the future (beyond a day of clock skew) could never be overtaken by a later choice
    const ok = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= Date.now() + 864e5;
    if (raw && typeof raw === 'object' && typeof raw.name === 'string' && typeof raw.companion === 'string' && ok(raw.nameAt) && ok(raw.companionAt))
      cache = { name: cleanName(raw.name), companion: cleanName(raw.companion), nameAt: raw.nameAt, companionAt: raw.companionAt };
  } catch {
    cache = null;
  }
  return cache;
}

export function writeYou(y: You) {
  if (cleared()) return;
  const you = (cache = { name: cleanName(y.name), companion: cleanName(y.companion), nameAt: y.nameAt, companionAt: y.companionAt });
  write(() => {
    try {
      localStorage.setItem(YOU_KEY, JSON.stringify(you));
    } catch {
      // storage blocked: the names hold for this visit
    }
  });
}

/** A choice from the first-run prompt, merged per name with what is stored, so another open prompt's choice made later
 * (or a real choice over a skip) is never erased. */
export function chooseYou(name: string, companion: string, at: number) {
  const cur = readYou();
  const keep = (t: number, ct: number | undefined) => cur !== null && (ct ?? 0) > t;
  const nameAt = name ? at : 0, companionAt = companion ? at : 0;
  writeYou({
    name: keep(nameAt, cur?.nameAt) ? cur!.name : name,
    nameAt: keep(nameAt, cur?.nameAt) ? cur!.nameAt : nameAt,
    companion: keep(companionAt, cur?.companionAt) ? cur!.companion : companion,
    companionAt: keep(companionAt, cur?.companionAt) ? cur!.companionAt : companionAt,
  });
}

export const playerName = () => readYou()?.name || DEFAULT_NAME;
export const companionName = () => readYou()?.companion || DEFAULT_COMPANION;

/** Copy with {name} and {companion} filled in. */
export const fillYou = (s: string) => (s.includes('{') ? s.replace(/\{(name|companion)\}/g, (_, k: string) => (k === 'name' ? playerName() : companionName())) : s);

// another open copy chose new names: read them again on next use
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === YOU_KEY || e.key === null) cache = undefined;
  });
