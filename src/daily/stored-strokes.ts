import { INKS, PAGE, STROKE_MODES, type Paper, type Stroke, type StrokeMode } from './ink';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A stroke as it is stored on this device, in drafts and in a Save Crystal (see storedStroke). */
export interface StoredStroke {
  i: number;
  w: number;
  p: number[];
  m?: StrokeMode;
  q?: number[];
}
const STROKE_KEYS = ['i', 'w', 'p', 'm', 'q'];
/**
 * Each stroke read whose stored form isn't what this build would store for it (a tool, field, ink or size from a newer
 * build, or values past this build's limits), with that stored form. Strokes never change once drawn, so storedStroke
 * writes it back exactly as it came and this build never turns a newer build's stroke into one of its own (as store.ts
 * keeps a newer save's records, see AS_STORED there).
 */
const AS_STORED = new WeakMap<Stroke, unknown>();
/**
 * A stroke as it is stored. A brush stroke keeps the three fields it always had. A stroke made with another tool
 * keeps its points in q and an empty p, so a build from before tools skips it: it shows less, never a tool's stroke
 * painted as a brush line, and its saves can't turn one into a brush stroke.
 */
export function storedStroke(s: Stroke): StoredStroke {
  if (AS_STORED.has(s)) return AS_STORED.get(s) as StoredStroke;
  return s.m ? { i: s.i, w: s.w, p: [], m: s.m, q: s.p } : { i: s.i, w: s.w, p: s.p };
}

/**
 * Accepts anything JSON-parsed as stored strokes; drops what doesn't fit, clamps what does. A stroke made with a tool
 * this build doesn't know, or with fields it doesn't, is kept as it was stored; one it can't draw draws nothing.
 */
export function cleanStrokes(raw: unknown, kind: Paper): Stroke[] | null {
  if (!Array.isArray(raw)) return null;
  const { w, h } = PAGE[kind];
  const out: Stroke[] = [];
  for (const s of raw.slice(0, 20000)) {
    if (!isObj(s)) continue;
    // undefined: the brush; null: a tool this build doesn't know
    const m = s.m === undefined ? undefined : STROKE_MODES.includes(s.m as StrokeMode) ? (s.m as StrokeMode) : null;
    const unknown = m === null || Object.keys(s).some((k) => !STROKE_KEYS.includes(k));
    const src = m === null || !fin(s.i) || !fin(s.w) ? null : m ? s.q : s.p;
    const p: number[] = [];
    if (Array.isArray(src)) {
      for (let k = 0; k + 1 < Math.min(src.length, 400000); k += 2) {
        const x = src[k], y = src[k + 1];
        if (!fin(x) || !fin(y)) continue;
        p.push(Math.max(-w, Math.min(2 * w, x)), Math.max(-h, Math.min(2 * h, y)));
      }
    }
    if (!p.length && !unknown) continue;
    const st: Stroke = {
      i: fin(s.i) ? Math.max(0, Math.min(INKS.length - 1, Math.round(s.i))) : 0,
      w: fin(s.w) ? Math.max(1, Math.min(400, s.w)) : 1,
      p,
    };
    if (m) st.m = m;
    if (JSON.stringify(storedStroke(st)) !== JSON.stringify(s)) AS_STORED.set(st, s);
    out.push(st);
  }
  return out;
}
