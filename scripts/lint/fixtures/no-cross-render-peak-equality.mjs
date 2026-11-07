export function compare(returned, held, ch, i, apart) {
  const d = returned.getChannelData(ch);
  const twin = held.getChannelData(ch);
  const alias = twin;
  apart = Math.max(apart, Math.abs(d[i] - twin[i]));
  apart = Math.max(apart, Math.abs(d[i] - alias[i]));
  const step = Math.max(apart, Math.abs(d[i] - d[i - 1]));
  const buffer = returned;
  const same = buffer.getChannelData(ch);
  apart = Math.max(apart, Math.abs(d[i] - same[i]));
  const energy = (d[i] - twin[i]) ** 2;
  return { apart, step, energy };
}
