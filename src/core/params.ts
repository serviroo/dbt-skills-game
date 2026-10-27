import { SAVE_KEY } from './stored-names';

const q = new URLSearchParams(location.search);
const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);

const systemReduced = q.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;
function savedMotion(): string {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null')?.settings?.motion ?? 'system';
  } catch {
    return 'system';
  }
}
let motion = savedMotion();

export function setMotion(m: string) {
  motion = m;
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
  systemReduced,
  get reduced() {
    // the companion's rule: the saved Motion setting wins; ?reduced stands in for the system's own setting
    return motion === 'reduce' || (motion !== 'full' && systemReduced);
  },
  skipIntro: q.has('skipintro'),
  fresh: q.has('fresh'),
  nopost: q.has('nopost'),
  cutscene: q.has('cutscene'),
};
