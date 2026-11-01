import { SKILL, type Answers, type Step } from '../content/dbt';
import { cleared, dropBefore, fromBefore, marked, removeStored, setStored, write } from '../core/cleared';
import { BESIDE } from '../core/stored-names';
import { isSkillId, uid } from './store';

export interface SkillDraft {
  skill: string;
  part: string;
  at: number;
  layout: [string, string, string][];
  answers: Answers;
  typed: Record<number, [string, string][]>;
  leads: Record<number, string>;
  done: number[];
  t: number;
}

const LOAD = `${uid()}${Math.random().toString(36).slice(2, 10)}`;
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const string = (x: unknown): x is string => typeof x === 'string';
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(string);
export const stepLayout = (steps: Step[]): SkillDraft['layout'] => steps.map((s) => [s.kind, s.id ?? '', 'key' in s ? s.key : '']);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ordered = (x: object) => Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)));

export const worthKeeping = (steps: Step[], answers: Answers, typed: SkillDraft['typed']) =>
  Object.values(typed).some((t) => t.some(([, value]) => value.trim())) ||
  steps.some((s) => ((s.kind === 'input' || s.kind === 'highlight') && typeof answers[s.key] === 'string' && (answers[s.key] as string).trim()) ||
    (s.kind === 'tier' && Array.isArray(answers[s.key]) && (answers[s.key] as string[]).length));

/** Only step positions from this exact layout are trusted. Answers have their own content keys. */
export function readDraft(raw: unknown): SkillDraft | null {
  if (!object(raw) || !isSkillId(raw.skill)) return null;
  const steps = SKILL[raw.skill].steps;
  const part = raw.part ?? '';
  if (!string(part) || (part && !steps.some((s) => s.id === part))) return null;
  const t = raw.t === undefined ? 0 : raw.t;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return null;
  const layout = Array.isArray(raw.layout) && raw.layout.every((x) => strings(x) && x.length === 3) ? raw.layout as SkillDraft['layout'] : [];
  const same = equal(layout, stepLayout(steps));
  const validStep = (x: unknown): x is number => Number.isInteger(x) && typeof x === 'number' && !!steps[x] && steps[x].kind !== 'branch';
  const byStep = <T>(x: unknown, ok: (v: unknown) => v is T): Record<number, T> => same && object(x)
    ? Object.fromEntries(Object.entries(x).filter((e): e is [string, T] => /^\d+$/.test(e[0]) && validStep(+e[0]) && ok(e[1]))) : {};
  const answers: Answers = {};
  for (const s of steps) {
    const key = 'key' in s ? s.key : s.kind === 'map' ? 'mapChoice' : null;
    if (!key) continue;
    const v = object(raw.answers) ? raw.answers[key] : undefined;
    const ok = s.kind === 'slider' ? typeof v === 'number' && Number.isFinite(v)
      : s.kind === 'choice' ? string(v) || strings(v)
      : s.kind === 'tier' ? strings(v) && v.every((x) => x.indexOf('|') > 0 && s.tiers.includes(x.slice(0, x.indexOf('|'))))
      : string(v);
    if (ok) answers[key] = v as Answers[string];
  }
  const typed = byStep(raw.typed, (v): v is [string, string][] => Array.isArray(v) && v.every((x) => strings(x) && x.length === 2));
  if (!worthKeeping(steps, answers, typed)) return null;
  return {
    skill: raw.skill, part, at: same && validStep(raw.at) ? raw.at : -1, layout,
    answers: ordered(answers), typed: ordered(typed), leads: byStep(raw.leads, string),
    done: same && Array.isArray(raw.done) ? raw.done.filter(validStep) : [], t,
  };
}

/** Position and replies can differ while two slots hold exactly the same words. */
const words = (d: SkillDraft) => [d.skill, d.part, d.layout, ordered(d.answers), ordered(d.typed)];
const sameWords = (a: SkillDraft, b: SkillDraft) => equal(words(a), words(b));
const prefix = (save: string) => `${save}${BESIDE.skillDraft}.`;
const myKey = (save: string, skill: string, part: string) => `${prefix(save)}${LOAD}.${skill}.${part}`;
interface Slot { key: string; raw: string; draft: SkillDraft }

function slots(save: string): Slot[] {
  const out: Slot[] = [];
  for (const key of Object.keys(localStorage).filter((k) => k.startsWith(prefix(save)))) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { continue; }
    // answers stored before this device's latest clear (by a copy held up as it stored them) are cleared data
    if (fromBefore(value)) { dropBefore(key, raw); continue; }
    const end = key.slice(prefix(save).length).split('.');
    const draft = readDraft(value);
    if (!draft || end.length !== 3 || draft.skill !== end[1] || draft.part !== end[2]) continue;
    out.push({ key, raw, draft });
  }
  return out;
}

export function newestDraft(save: string, skill: string, part: string): Slot | null {
  try {
    const layout = stepLayout(SKILL[skill].steps);
    const mine = myKey(save, skill, part);
    return slots(save).filter((s) => s.draft.skill === skill && s.draft.part === part).sort((a, b) =>
      b.draft.t - a.draft.t || Number(equal(b.draft.layout, layout)) - Number(equal(a.draft.layout, layout)) || Number(b.key === mine) - Number(a.key === mine) || a.key.localeCompare(b.key),
    )[0] ?? null;
  } catch { return null; }
}

const remove = (slot: Slot) => {
  if (localStorage.getItem(slot.key) === slot.raw) removeStored(slot.key);
};

export function keepDraft(save: string, draft: SkillDraft, changed: boolean) {
  if (cleared()) return;
  // Capture the fields now: a held write must not read answers changed by a later keystroke.
  const copy = JSON.parse(JSON.stringify(draft)) as SkillDraft;
  write(() => {
    try {
      const all = slots(save);
      const key = myKey(save, copy.skill, copy.part);
      const own = all.find((s) => s.key === key);
      if (!changed && own && own.draft.t > copy.t && !sameWords(own.draft, copy)) return;
      copy.t = changed ? Math.max(Date.now(), copy.t + 1, ...all.map((s) => s.draft.t + 1)) : Math.max(copy.t, own?.draft.t ?? 0);
      const raw = JSON.stringify(marked(copy));
      setStored(key, raw);
      if (localStorage.getItem(key) !== raw) return;
      for (const s of all) if (s.key !== key && s.draft.t <= copy.t && sameWords(s.draft, copy)) remove(s);
    } catch {
      /* storage is full or blocked: the visit still holds its words in memory */
    }
  });
}

export function dropDraft(save: string, draft: SkillDraft, picked: Slot | null) {
  if (cleared()) return;
  const copy = JSON.parse(JSON.stringify(draft)) as SkillDraft;
  write(() => {
    try {
      removeStored(myKey(save, copy.skill, copy.part));
      if (picked) remove(picked);
      for (const s of slots(save)) if (sameWords(s.draft, copy)) remove(s);
    } catch {
      /* storage is blocked */
    }
  });
}

export function exportSkillDrafts(save: string) {
  try {
    const drafts = slots(save).map((s) => s.draft);
    drafts.sort((a, b) => a.skill.localeCompare(b.skill) || a.part.localeCompare(b.part) || a.t - b.t || JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { drafts: drafts.filter((d, i) => !drafts.slice(0, i).some((x) => equal(x, d))), incomplete: false };
  } catch { return { drafts: [], incomplete: true }; }
}

export function restoreSkillDrafts(save: string, raw: unknown) {
  if (!Array.isArray(raw)) return true;
  if (cleared()) return false;
  let saved = true;
  for (const value of raw) {
    const draft = readDraft(value);
    if (!draft) continue;
    write(() => {
      try {
        if (slots(save).some((s) => sameWords(s.draft, draft))) return;
        const key = `${prefix(save)}imp~${uid()}.${draft.skill}.${draft.part}`;
        const out = JSON.stringify(marked(draft));
        setStored(key, out);
        if (localStorage.getItem(key) !== out) saved = false;
      } catch { saved = false; }
    });
  }
  return saved;
}
