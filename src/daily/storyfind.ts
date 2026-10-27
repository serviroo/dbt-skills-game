/**
 * Finding words in the player's stories, here on the device. Case, accents and curly quotes don't matter, and a word
 * matches as a whole or as part of a longer one ("lant" finds "lantern"). Nothing here is stored.
 */

/** [start, end) in the original text */
export type Span = [number, number];

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", 'ʼ': "'", '“': '"', '”': '"' };

/** The text folded for matching, and for every folded unit the index in the original it came from. */
function fold(text: string): { s: string; at: number[] } {
  let s = '';
  const at: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = (QUOTES[ch] ?? ch).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
    for (let k = 0; k < f.length; k++) at.push(i);
    s += f;
    i += ch.length;
  }
  at.push(i);
  return { s, at };
}

/** The words looked for, folded the same way, none repeated. */
export function terms(query: string): string[] {
  return [...new Set(fold(query.slice(0, 200)).s.split(/\s+/).filter(Boolean))];
}

/** Every place any of the words appears, in order, overlaps joined. */
export function spans(text: string, words: string[]): Span[] {
  if (!words.length || !text) return [];
  const { s, at } = fold(text);
  // a match that ends partway through a letter that folded to two takes the whole letter
  const end = (b: number) => {
    while (b < s.length && at[b] === at[b - 1]) b++;
    return at[b];
  };
  const raw: Span[] = [];
  for (const w of words) for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1)) raw.push([at[i], end(i + w.length)]);
  raw.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: Span[] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** The places in `text` when every word is in it somewhere, else null. */
export function match(text: string, words: string[]): Span[] | null {
  if (!words.length) return null;
  const { s } = fold(text);
  if (!words.every((w) => s.includes(w))) return null;
  return spans(text, words);
}
