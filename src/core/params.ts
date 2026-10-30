import { SAVE_KEY } from './stored-names';

const q = new URLSearchParams(location.search);
const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);

// the device's reduce-motion setting, kept current while the page is open; ?reduced stands in for it being on
const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
const deviceReduced = () => q.has('reduced') || reduceQuery.matches;
let systemReduced = deviceReduced();
function savedMotion(): string {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null')?.settings?.motion ?? 'system';
  } catch {
    return 'system';
  }
}
/** the saved Motion setting, as stored until the companion's store holds it (setMotion) */
let motion = savedMotion();
let held = false;
// the companion's rule: the saved Motion setting wins; ?reduced stands in for the system's own setting
const still = () => motion === 'reduce' || (motion !== 'full' && systemReduced);
let reduced = still();
const motionFns = new Set<() => void>();
/** Tells everyone listening, once, when motion has turned on or off. */
function follow() {
  if (still() === reduced) return;
  reduced = !reduced;
  motionFns.forEach((f) => f());
}
reduceQuery.addEventListener('change', () => {
  systemReduced = deviceReduced();
  follow();
});
// Motion saved in another open copy (or that copy clearing the game): the companion's store merges it and says so
// through setMotion; until it is open, as in the intro, the stored setting is the one every copy wrote
window.addEventListener('storage', (e) => {
  if (held || (e.key !== SAVE_KEY && e.key !== null)) return;
  motion = savedMotion();
  follow();
});

/**
 * Calls fn when motion turns on or off while the page is open: the device's setting changed, or the saved Motion
 * setting did, here or in another open copy. Returns the function that stops it.
 */
export function onMotion(fn: () => void) {
  motionFns.add(fn);
  return () => void motionFns.delete(fn);
}

/** The companion's store holds the saved Motion setting from here on, with other copies' changes merged in. */
export function setMotion(m: string) {
  held = true;
  motion = m;
  follow();
}
/** The companion's store is closing: the stored setting is the one again. */
export function releaseMotion() {
  held = false;
  motion = savedMotion();
  follow();
}

export const params = {
  lab: q.get('lab') ?? '',
  view: q.get('view') ?? '',
  shot: q.get('shot') ?? '',
  t: num('t'),
  capture: q.has('capture'),
  debug: q.has('debug'),
  dpr: num('dpr'),
  msaa: num('msaa'),
  mute: q.has('mute'),
  get reduced() {
    return reduced;
  },
  skipIntro: q.has('skipintro'),
  fresh: q.has('fresh'),
  nopost: q.has('nopost'),
  cutscene: q.has('cutscene'),
};
