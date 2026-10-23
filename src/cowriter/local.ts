import { COWRITER_CARE, COWRITER_FILLER, COWRITER_NEVER, COWRITER_NEXT, COWRITER_QUESTIONS, COWRITER_WHATIFS } from '../content/cowriter-lines';
import { CAPS, type CowriteReq, type CowriteRes } from './types';

type Mood = 'spooky' | 'gentle' | 'funny' | 'action';
type Slot = 'who' | 'who2' | 'it' | 'line' | 'title';
type Fill = Partial<Record<Slot, string>>;

const MOODS: [Mood, RegExp][] = [
  ['spooky', /spook|scar(?:y|ier)|creep|eerie|dark|haunt|ghost|horror|chill|myster/],
  ['gentle', /calm|soft|gentle|cos[yi]|cozy|quiet|kind|warm|sweet|hope|happ|peace/],
  ['funny', /funn|silly|light|joke|laugh|playful|goof|weird|absurd/],
  ['action', /action|fast|tense|excit|chase|quick|drama|thrill/],
];
const TALK = /dialog|talk|speak|speech|convers|chat/;
const SHORT = /short|brief|tight|simple|less|fewer/;

const words = (s: string) => new Set(s.split(' '));
const NOT_NAMES = words(
  'a an and as at but by for from he her here hers him his how i if in is it its me my no not now of oh ok okay on once one or our she so some still that the their them then there these they this those to too up us was we what when where which while who why with yes yet you your after again all also always another any are be because been before both did do does even every everyone everything first had has have just last let like maybe more most much never next nobody nothing only other perhaps really since sometimes soon suddenly than though through today tomorrow tonight until very well were will would yesterday chapter part notes mr mrs ms dr sir mum mom dad monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december',
);
const NOT_THINGS = words(
  'was is are were be been had has have and or but of in on at to for from by with as that which who whom whose then than so if into onto over under behind before after through about around up down out off away back again just very really quite too own same other only most more much many few each every all both such one ones way time times thing things moment moments end rest lot bit kind sort part side top bottom middle start beginning idea reason point fact sense day days night nights morning evening afternoon week weeks year years minute minutes second seconds hour hours story chapter page eyes eye hand hands face head hair arm arms leg legs feet foot mouth lips heart chest neck shoulder shoulders finger fingers skin body',
);
const ADJ = words(
  'old little big small new last first dark long tall short cold warm hot quiet empty tiny huge red blue green black white grey gray brown golden silver broken open strange whole young good bad great soft hard heavy light bright dim deep high low wide narrow thin thick wet dry loud sweet sad happy lonely tired lost secret hidden real true false front back',
);
const ADJ_END = /(?:y|ful|less|ous|ish|en|ed|ing|al|ic|ive)$/;
const MADE = words('brass stone glass iron gold copper steel tin metal paper leather velvet silk wool clay marble crystal');
const VERBS = words(
  'am can could did do does done may might must shall should will would ate began begins brought came comes drew fell felt flew found gave goes got grew heard held hid kept knew lay led left let made meant met ran rang rose runs said sang sank saw says sat seems shook shone slept spoke stood swam swung takes thought threw told took went woke wore',
);
const KEEP_DOUBLE = words('had that is ha ho hey bye no yes so knock tick la oh');
const ABBR = words('e.g i.e etc vs cf mr mrs ms dr st approx');
const NEVER = new Set(COWRITER_NEVER);

function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: T[], rand: () => number) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
const hasCare = (s: string) => {
  const n = norm(s);
  return COWRITER_CARE.some((w) => n.includes(` ${w} `));
};

function names(body: string, title: string, steer: string): string[] {
  const lower = new Set(body.match(/(?<![\p{L}])\p{Ll}+/gu) ?? []);
  const seen = new Map<string, { n: number; mid: boolean; at: number }>();
  for (const m of body.matchAll(/(?<![\p{L}\p{N}'’])\p{Lu}\p{Ll}+(?:['’-]\p{Lu}?\p{Ll}+)*/gu)) {
    const w = m[0].replace(/['’]s$/u, '');
    if (NOT_NAMES.has(w.toLowerCase())) continue;
    const pre = body.slice(Math.max(0, m.index - 3), m.index).replace(/[ \t]+$/u, '');
    const mid = !!pre && !/[.!?…:"“”‘’'(\n]$/u.test(pre);
    const e = seen.get(w) ?? { n: 0, mid: false, at: m.index };
    e.n++;
    e.mid ||= mid;
    seen.set(w, e);
  }
  const t = norm(title);
  const asked = norm(steer);
  return [...seen]
    .filter(([w, e]) => (e.n > 1 || e.mid || asked.includes(` ${w.toLowerCase()} `)) && (e.mid || !lower.has(w.toLowerCase())) && !hasCare(w))
    .map(([w, e]) => ({ w, at: e.at, score: e.n + (e.mid ? 2 : 0) + (t.includes(` ${w.toLowerCase()} `) ? 1 : 0) + (asked.includes(` ${w.toLowerCase()} `) ? 100 : 0) }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((x) => x.w)
    .slice(0, 4);
}

function things(body: string, steer: string): string[] {
  const seen = new Map<string, { n: number; at: number }>();
  for (const m of body.matchAll(/(?<![\p{L}])(?:[Tt]he|[Aa]n?|[Hh]er|[Hh]is|[Tt]heir|[Mm]y|[Oo]ur|[Yy]our|[Ii]ts)\s+(\p{Ll}+)(?:[ \t]+(\p{Ll}+))?/gu)) {
    const [, a, b] = m;
    const second = b && !NOT_THINGS.has(b) && !ADJ.has(b) && !VERBS.has(b) && !/(?:ed|ing)$/.test(b);
    const w = second && (ADJ.has(a) || MADE.has(a) || ADJ_END.test(a)) ? b : a;
    if (w.length < 3 || NOT_THINGS.has(w) || ADJ.has(w) || NEVER.has(w) || hasCare(w)) continue;
    const e = seen.get(w) ?? { n: 0, at: m.index };
    e.n++;
    seen.set(w, e);
  }
  const asked = norm(steer);
  return [...seen]
    .map(([w, e]) => ({ w, at: e.at, score: e.n + (asked.includes(` ${w} `) ? 100 : 0) }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((x) => x.w)
    .slice(0, 3);
}

function lastLine(text: string) {
  const t = text.replace(/\s+$/u, '');
  const parts = t.split(/(?<=[.!?…]["”’)]*)\s+|\n+/u).filter((s) => s.trim());
  let s = (parts[parts.length - 1] ?? '').trim().replace(/^["“”‘’'(]+|["“”‘’')]+$/gu, '').replace(/[.,;:]+$/u, '').trim();
  const ws = s.split(/\s+/u);
  if (ws.length < 3) return '';
  if (s.length > 70 || ws.length > 12) s = `…${ws.slice(-8).join(' ')}`;
  return s;
}

type Where = 'start' | 'para' | 'end' | 'mid' | 'speech';
function where(before: string): { at: Where; open: boolean } {
  if (!before.trim()) return { at: 'start', open: false };
  if (/\n\s*$/.test(before)) return { at: 'para', open: false };
  const tail = before.replace(/\s+$/u, '');
  const para = tail.slice(tail.lastIndexOf('\n') + 1);
  const curly = (para.match(/“/g)?.length ?? 0) > (para.match(/”/g)?.length ?? 0);
  const straight = (para.match(/"/g)?.length ?? 0) % 2 === 1;
  const open = !/[.!?…]["”’)\]]*$/u.test(tail);
  if (curly || straight) return { at: 'speech', open };
  return { at: open ? 'mid' : 'end', open };
}

const SLOT = /\{(who2|who|it|line|title)\}/g;
const slotsOf = (t: string) => [...t.matchAll(SLOT)].map((m) => m[1] as Slot);

function choose(tiers: string[][], fills: (k: number) => Fill, n: number, seen: string, rand: () => number) {
  const out: string[] = [];
  const used = new Set<string>();
  const recent = norm(seen);
  let its = 0;
  const filled = (t: string, f: Fill) => t.replace(SLOT, (_, k: Slot) => f[k] ?? '');
  for (const fresh of [true, false]) {
    for (const tier of tiers) {
      const left = shuffle(tier.filter((t) => slotsOf(t).every((k) => fills(0)[k])), rand);
      while (out.length < n && left.length) {
        const score = (t: string) => {
          const s = slotsOf(t).map((k) => k.replace('2', ''));
          return (s.includes('who') && !used.has('who') ? 3 : 0) + (s.some((k) => !used.has(k)) ? 2 : s.length ? 1 : 0);
        };
        let best = 0;
        for (let i = 1; i < left.length; i++) if (score(left[i]) > score(left[best])) best = i;
        const [t] = left.splice(best, 1);
        const text = filled(t, fills(its));
        if (out.includes(text) || (fresh && recent.includes(norm(text).trim().slice(0, 40)))) continue;
        slotsOf(t).forEach((k) => used.add(k.replace('2', '')));
        if (t.includes('{it}')) its++;
        out.push(text);
      }
    }
    if (out.length >= n) break;
  }
  return out;
}

const inStyle = (t: string, story: string) => (/["']/.test(story) && !/[“”‘’]/.test(story) ? t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'") : t);

function tidy(selection: string, before: string) {
  let s = selection.trim().replace(/(?<![\p{L}\p{N}'’])i(?=(?:['’](?:m|d|ll|ve|s))?(?![\p{L}\p{N}]|\.\p{L}))/gu, 'I');
  s = s
    .replace(/[ \t]+/g, ' ')
    .replace(/ +$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/([!?,;:])\1+/g, '$1')
    .replace(/\.{4,}/g, '...')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(/([,;:])(?=\p{L})/gu, '$1 ')
    .replace(/(\p{Ll}[.!?])(?=\p{Lu})/gu, '$1 ');
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/(?<![\p{L}\p{N}])(\p{L}+)([ \t]+)\1(?![\p{L}\p{N}])/giu, (m, w: string) => (KEEP_DOUBLE.has(w.toLowerCase()) ? m : w));
    if (next === s) break;
    s = next;
  }
  s = s.replace(/([.!?]+["”’)]*\s+)(\p{Ll})/gu, (m, pre: string, ch: string, at: number, all: string) => {
    if (pre.startsWith('..')) return m;
    const word = all.slice(0, at).match(/([\p{L}.]+)$/u)?.[1]?.toLowerCase() ?? '';
    return pre.startsWith('.') && ABBR.has(word) ? m : pre + ch.toUpperCase();
  });
  s = s.replace(/(\n[ \t]*\n[ \t]*)(\p{Ll})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
  const opens = !before.trim() || /\n\s*\n\s*$/.test(before) || (/[.!?]["”’)]*\s*$/u.test(before) && !/\.\.\s*$/.test(before));
  if (opens) s = s.replace(/^(["“‘'(]*)(\p{Ll})/u, (_, q: string, ch: string) => q + ch.toUpperCase());
  return s;
}

function trimFiller(s: string) {
  const re = new RegExp(`(?<=[\\p{L}\\p{N},;] )(?<!(?:not|n['’]t) )(?:${COWRITER_FILLER.join('|')}) (?=\\p{L})`, 'giu');
  return s.replace(re, '');
}

const head = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');
const tail = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(Math.max(0, s.length - n)) : '');

export async function cowrite(req: CowriteReq): Promise<CowriteRes> {
  const title = head(req.title, CAPS.title).trim();
  const before = tail(req.before, CAPS.before);
  const after = head(req.after, CAPS.after);
  const notes = head(req.notes, CAPS.notes);
  const steer = head(req.steer, CAPS.steer).trim();
  const selection = typeof req.selection === 'string' ? req.selection : '';
  const history = (Array.isArray(req.history) ? req.history : []).slice(-CAPS.history).map((t) => head(t?.text, CAPS.turn));
  const care = [title, before, selection, after, notes, steer].some(hasCare);

  if (req.mode === 'polish') {
    if (selection.length > CAPS.selection) return { kind: 'toolong' };
    const tidied = tidy(selection, before);
    const trimmed = tidy(trimFiller(tidied), before);
    const cards = SHORT.test(steer.toLowerCase()) ? [trimmed, tidied] : [tidied, trimmed];
    if (cards.some((c) => c.length > CAPS.selection)) return { kind: 'toolong' };
    return { kind: 'cards', cards: cards.filter((c, i) => c && cards.indexOf(c) === i), care };
  }

  const story = [before, selection, after, notes].join('\n');
  const asked = steer.toLowerCase();
  const rand = rng(hash(JSON.stringify([req.mode, title, before, selection, after, notes, steer, history])));
  const who = names(story, title, steer);
  const its = care ? [] : things(story, steer);
  const line = care ? '' : lastLine(before.trim() ? before : after);
  const fills = (k: number): Fill => ({
    who: who[0],
    who2: who[1],
    it: its[k % (Math.min(its.length, 2) || 1)],
    line: line || undefined,
    title: !care && title && title.length <= 60 ? title : undefined,
  });
  const mood = care ? 'gentle' : MOODS.find(([, re]) => re.test(asked))?.[0];
  const seen = history.join('\n');

  let tiers: string[][];
  if (req.mode === 'questions' || req.mode === 'whatif') {
    const set = req.mode === 'questions' ? COWRITER_QUESTIONS : COWRITER_WHATIFS;
    tiers = [mood ? set[mood] : [], set.base];
  } else {
    const { at, open } = where(before);
    const N = COWRITER_NEXT;
    const mid = at === 'mid';
    tiers = [];
    if (at === 'speech') {
      tiers.push(open ? N.speechMid : N.speech);
    } else {
      if (TALK.test(asked)) tiers.push(mid ? N.talkMid : N.talk);
      if (SHORT.test(asked)) tiers.push(mid ? N.shortMid : N.short);
      if (mood) tiers.push(N[mid ? (`${mood}Mid` as const) : mood]);
      tiers.push(mid ? N.mid : at === 'start' ? N.start : at === 'para' ? [...N.para, ...N.end] : N.end);
    }
  }
  const cards = choose(tiers, fills, 3, seen, rand).map((t) => inStyle(t, story));
  return { kind: 'cards', cards, care };
}
