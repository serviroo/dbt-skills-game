export function breakable(s: string, at: Set<number>) {
  let out = '';
  for (let k = 0; k < s.length; k++) out += `${at.has(k) ? '­' : ''}${s[k]}`;
  return out;
}
