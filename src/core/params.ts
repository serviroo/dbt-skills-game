const q = new URLSearchParams(location.search);
const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);

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
  reduced: q.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches,
  skipIntro: q.has('skipintro'),
  fresh: q.has('fresh'),
  nopost: q.has('nopost'),
  cutscene: q.has('cutscene'),
};
