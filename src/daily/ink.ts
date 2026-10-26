/**
 * Lantern ink: glowing strokes drawn with a finger.
 * A stroke is a list of points in a fixed logical resolution, so a drawing renders the same on any screen and can be
 * re-rendered for thumbnails, exports and restores. Each stroke is one smoothed path drawn in passes: a blurred halo
 * at quarter resolution (screen-blended, so light adds up between strokes), then body, mid and core. One stroke()
 * call per pass, so nothing builds up where a line crosses itself. A soft-glow stroke is a light instead: a tight
 * bright core and a wide soft halo. An eraser stroke cuts the ink under it and puts out the halo there; strokes keep
 * their order, so what is drawn after it shows again.
 */

export interface Ink {
  id: string;
  name: string;
  body: string;
  mid: string | null;
  core: string | null;
  halo: string;
}

export const INKS: Ink[] = [
  { id: 'ice', name: 'Ice', body: '#b9d8f6', mid: 'rgba(226,240,255,0.7)', core: '#f2f8ff', halo: '#2f6fae' },
  { id: 'system', name: 'Lantern blue', body: '#2f9cf0', mid: 'rgba(110,205,255,0.75)', core: '#d2f5ff', halo: '#1a5fd0' },
  { id: 'violet', name: 'Violet glow', body: '#8a68e8', mid: 'rgba(186,164,255,0.7)', core: '#efe8ff', halo: '#5f2fc0' },
  { id: 'mint', name: 'Mint', body: '#5fae78', mid: 'rgba(150,222,172,0.75)', core: '#e3fbea', halo: '#2a7a52' },
  { id: 'shadow', name: 'Shadow', body: '#080c18', mid: null, core: null, halo: '#4a2aa6' },
];

export const SIZES = [
  { id: 'fine', name: 'Fine', k: 0.009 },
  { id: 'medium', name: 'Medium', k: 0.021 },
  { id: 'bold', name: 'Bold', k: 0.05 },
];

export const TOOLS = [
  { id: 'brush', name: 'Brush' },
  { id: 'glow', name: 'Soft glow' },
  { id: 'erase', name: 'Eraser' },
] as const;
export type Tool = (typeof TOOLS)[number]['id'];
/** What a stroke made with a tool other than the brush stores as its m; a stroke without one is a brush stroke. */
export const STROKE_MODES = ['glow', 'erase'] as const;
export type StrokeMode = (typeof STROKE_MODES)[number];
/** The eraser cuts a little wider than a line of the same size, so one pass along a line takes it away. */
const ERASE = 1.4;

/**
 * i: ink index, w: line width in logical px, p: flat x,y pairs in logical px, m: the tool, when not the brush. A stroke
 * never changes once drawn. One this build can't draw (a tool from a newer build) has no points and draws nothing.
 * Stored, a tool's stroke keeps its points elsewhere (see storedStroke in artstore.ts).
 */
export interface Stroke {
  i: number;
  w: number;
  p: number[];
  m?: StrokeMode;
}

export type Paper = 'today' | 'ally';
export const HALO = 0.25;
const FX = 0.5;
export const PAGE: Record<Paper, { w: number; h: number }> = { today: { w: 1200, h: 1600 }, ally: { w: 1000, h: 1400 } };

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d')!;
type Box = [number, number, number, number];
/** Replaces everything on g with the canvas from, or only what is in box b (canvas px). */
const paste = (g: CanvasRenderingContext2D, from: HTMLCanvasElement, b?: Box) => {
  g.save();
  if (b) clip(g, b);
  g.globalCompositeOperation = 'copy';
  g.drawImage(from, 0, 0);
  g.restore();
};
const clip = (g: CanvasRenderingContext2D, b: Box) => {
  g.beginPath();
  g.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
  g.clip();
};

/** The box around a stroke's points (from point pair k on): left, top, right, bottom. */
function bounds(p: number[], k = 0): Box {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (; k + 1 < p.length; k += 2) {
    b[0] = Math.min(b[0], p[k]);
    b[1] = Math.min(b[1], p[k + 1]);
    b[2] = Math.max(b[2], p[k]);
    b[3] = Math.max(b[3], p[k + 1]);
  }
  return b;
}
const grow = (b: Box, m: number): Box => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
const meets = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const join = (a: Box | null, b: Box): Box => (a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b);
/** The longest step between two points of a stroke (from point pair k on). */
function stepOf(p: number[], k = 0) {
  let top = 0;
  for (k += 2; k + 1 < p.length; k += 2) top = Math.max(top, Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]));
  return top;
}
/** The squared distance from point x, y to the segment from a to b. */
function toSeg(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
  return (ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2;
}
const side = (ax: number, ay: number, bx: number, by: number, x: number, y: number) => Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
/** Whether the line through the points of e (from point pair k on) comes within d of the line through the points of p. */
function touches(p: number[], e: number[], k: number, d: number) {
  const d2 = d * d;
  for (; k + 1 < e.length; k += 2) {
    const ax = e[k], ay = e[k + 1], bx = e[k + 2] ?? ax, by = e[k + 3] ?? ay;
    for (let j = 0; j + 1 < p.length; j += 2) {
      const cx = p[j], cy = p[j + 1], ex = p[j + 2] ?? cx, ey = p[j + 3] ?? cy;
      if (side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, ex, ey) < 0 && side(cx, cy, ex, ey, ax, ay) * side(cx, cy, ex, ey, bx, by) < 0) return true;
      if (Math.min(toSeg(ax, ay, cx, cy, ex, ey), toSeg(bx, by, cx, cy, ex, ey), toSeg(cx, cy, ax, ay, bx, by), toSeg(ex, ey, ax, ay, bx, by)) <= d2) return true;
    }
  }
  return false;
}

/** The smoothed path through a stroke's points at scale s, moved by ox, oy canvas px. */
function trace(g: CanvasRenderingContext2D, p: number[], s: number, ox = 0, oy = 0) {
  const n = p.length >> 1;
  g.beginPath();
  g.moveTo(p[0] * s - ox, p[1] * s - oy);
  if (n === 1) {
    g.lineTo(p[0] * s - ox + 0.01, p[1] * s - oy);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2] * s - ox, y = p[i * 2 + 1] * s - oy;
    g.quadraticCurveTo(x, y, (x + p[i * 2 + 2] * s - ox) / 2, (y + p[i * 2 + 3] * s - oy) / 2);
  }
  g.lineTo(p[n * 2 - 2] * s - ox, p[n * 2 - 1] * s - oy);
}

/**
 * The smoothed path of an eraser stroke, only the pieces within reach r (logical px) of box b (logical px), so a long
 * stroke costs only where it is. The stroke is round-capped and joined, so pieces stroked apart cover what it does.
 */
function traceNear(g: CanvasRenderingContext2D, p: number[], s: number, ox: number, oy: number, b: Box, r: number) {
  const n = p.length >> 1;
  if (n < 3) return trace(g, p, s, ox, oy);
  const near = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) =>
    Math.min(x0, x1, x2) - r <= b[2] && Math.max(x0, x1, x2) + r >= b[0] && Math.min(y0, y1, y2) - r <= b[3] && Math.max(y0, y1, y2) + r >= b[1];
  g.beginPath();
  let open = false;
  let sx = p[0], sy = p[1];
  // piece i runs from (sx, sy) through point i to the midpoint after it; the last runs straight to the last point
  for (let i = 1; i < n; i++) {
    const last = i === n - 1;
    const cx = p[i * 2], cy = p[i * 2 + 1];
    const ex = last ? cx : (cx + p[i * 2 + 2]) / 2, ey = last ? cy : (cy + p[i * 2 + 3]) / 2;
    if (near(sx, sy, cx, cy, ex, ey)) {
      if (!open) g.moveTo(sx * s - ox, sy * s - oy);
      if (last) g.lineTo(ex * s - ox, ey * s - oy);
      else g.quadraticCurveTo(cx * s - ox, cy * s - oy, ex * s - ox, ey * s - oy);
      open = true;
    } else open = false;
    sx = ex;
    sy = ey;
  }
}

/**
 * A stroke's light on the halo at scale s, as passes: line width and blur in canvas px, alpha and colour. A soft-glow
 * line glows three times: the soft edge of its bright core, its halo, and a wider, fainter breath of the same light,
 * as a light source does. All of it starts from a line an eraser can cut (see haloPass), so one pass takes it all
 * away. An eraser has none.
 */
function lights(st: Stroke, s: number): [number, number, number, string][] {
  if (st.m === 'erase' || !st.p.length) return [];
  const ink = INKS[st.i] ?? INKS[0];
  if (st.m === 'glow')
    return [
      [Math.max(1, Math.max(1.4, st.w * 0.26) * s), st.w * 1.5 * s, 1, ink.mid ?? ink.halo],
      [Math.max(1, st.w * 1.2 * s), (st.w * 3.4 + 44) * s, 1, ink.halo],
      [Math.max(1, st.w * 1.2 * s), (st.w * 5.5 + 72) * s, 0.75, ink.halo],
    ];
  return [[Math.max(1, st.w * 1.25 * s), Math.max(4, (st.w * 2.2 + 26) * s), 1, ink.halo]];
}
/** How far a stroke's light reaches from its points, in logical px (a blur has faded out at twice its size). */
const reach = (st: Stroke, s: number) => Math.max(0, ...lights(st, s).map(([w, blur]) => (w / 2 + blur * 2 + 2) / s));
/** Half the widest line a stroke's light starts from, in logical px at the halo's scale. */
const lineHalf = (st: Stroke) => Math.max(2, st.w * 0.65);
/** Whether eraser stroke e (in box eb) may pass over the line stroke a (in box ab) takes its light from. */
const crosses = (a: Stroke, ab: Box, e: Stroke, eb: Box) => meets(grow(ab, lineHalf(a) + (e.w * ERASE) / 2 + 4), eb);
/** For each stroke, the eraser strokes after it that pass over it (none for most). */
function eraserCuts(strokes: Stroke[]) {
  const out: (Stroke[] | undefined)[] = [];
  const at = strokes.flatMap((s, k) => (s.m === 'erase' ? [k] : []));
  if (!at.length) return out;
  const box = strokes.map((s) => bounds(s.p));
  strokes.forEach((s, i) => {
    if (s.m === 'erase') return;
    for (const k of at) if (k > i && crosses(s, box[i], strokes[k], box[k])) (out[i] ??= []).push(strokes[k]);
  });
  return out;
}

let scratch: HTMLCanvasElement | null = null;
/** A colour as its opaque part and its alpha, so a see-through light draws the same with or without a cut. */
function solid(c: string): [string, number] {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(c);
  return m ? [`rgb(${m[1]},${m[2]},${m[3]})`, +m[4]] : [c, 1];
}
/**
 * Halo pass at scale s onto an opaque black canvas, or a clear one laid over it later with the same blend (screen, so
 * overlapping light adds softly), its origin at ox, oy canvas px of the halo. cut: the eraser strokes drawn after this
 * one. They cut its line before it glows, so its light goes out where it was erased while the light of everything
 * else stays. An eraser stroke adds no light of its own.
 */
export function haloPass(g: CanvasRenderingContext2D, st: Stroke, s: number, cut?: Stroke[], ox = 0, oy = 0) {
  const passes = lights(st, s);
  if (!passes.length) return;
  g.save();
  g.globalCompositeOperation = 'screen';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // a cut line is drawn on a scratch canvas reaching past this one as far as its light does, so the light of a
  // line partly off this canvas is all there; passes from the same line share one cut
  const W = g.canvas.width, H = g.canvas.height;
  const M = cut?.length ? Math.ceil(Math.max(...passes.map(([w, blur]) => w / 2 + blur * 2))) + 2 : 0;
  let held = '';
  for (const [w, blur, a, color] of passes) {
    const [rgb, alpha] = solid(color);
    g.globalAlpha = a * alpha;
    g.lineWidth = w;
    g.shadowBlur = blur;
    g.strokeStyle = g.shadowColor = rgb;
    if (!cut?.length) {
      trace(g, st.p, s, ox, oy);
      g.stroke();
      continue;
    }
    // one scratch canvas, never smaller than any use of it, so it isn't made again for each one; cleared whole
    const c = (scratch ??= document.createElement('canvas'));
    if (held !== `${w} ${rgb}`) {
      held = `${w} ${rgb}`;
      if (c.width < W + 2 * M || c.height < H + 2 * M) [c.width, c.height] = [Math.max(c.width, W + 2 * M), Math.max(c.height, H + 2 * M)];
      const cg = ctx2d(c);
      cg.clearRect(0, 0, c.width, c.height);
      cg.lineCap = 'round';
      cg.lineJoin = 'round';
      cg.strokeStyle = rgb;
      cg.lineWidth = w;
      trace(cg, st.p, s, ox - M, oy - M);
      cg.stroke();
      // an opaque cut, so it takes the light out completely
      cg.globalCompositeOperation = 'destination-out';
      cg.strokeStyle = '#000';
      // the scratch canvas covers this box of the page, in logical px
      const box: Box = [(ox - M) / s, (oy - M) / s, (ox + W + M) / s, (oy + H + M) / s];
      for (const e of cut) {
        cg.lineWidth = e.w * ERASE * s;
        traceNear(cg, e.p, s, ox - M, oy - M, box, (e.w * ERASE) / 2 + 2 / s);
        cg.stroke();
      }
      cg.globalCompositeOperation = 'source-over';
    }
    g.drawImage(c, 0, 0, W + 2 * M, H + 2 * M, -M, -M, W + 2 * M, H + 2 * M);
  }
  g.restore();
}

export function inkPass(g: CanvasRenderingContext2D, st: Stroke, s: number) {
  if (!st.p.length) return;
  const ink = INKS[st.i] ?? INKS[0];
  g.lineCap = 'round';
  g.lineJoin = 'round';
  trace(g, st.p, s);
  if (st.m === 'erase') {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = '#000';
    g.lineWidth = st.w * ERASE * s;
    g.stroke();
    g.restore();
    return;
  }
  if (st.m === 'glow') {
    // the core: a thin bright line (its soft edge is light, on the halo: see lights)
    g.strokeStyle = ink.core ?? ink.body;
    g.lineWidth = Math.max(1.4, st.w * 0.26) * s;
    g.stroke();
    return;
  }
  g.strokeStyle = ink.body;
  g.lineWidth = st.w * s;
  g.stroke();
  if (ink.mid) {
    g.strokeStyle = ink.mid;
    g.lineWidth = st.w * 0.62 * s;
    g.stroke();
  }
  if (ink.core) {
    g.strokeStyle = ink.core;
    g.lineWidth = Math.max(1.4, st.w * 0.3) * s;
    g.stroke();
  }
}

/** The page under the ink: void with a cold lift; an ally page adds a violet shadow pool to stand in. */
export function paintPaper(g: CanvasRenderingContext2D, w: number, h: number, kind: Paper) {
  g.save();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#07080f';
  g.fillRect(0, 0, w, h);
  const lift = g.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.3, Math.max(w, h) * 0.78);
  lift.addColorStop(0, 'rgba(22,48,86,0.62)');
  lift.addColorStop(0.55, 'rgba(12,26,50,0.32)');
  lift.addColorStop(1, 'rgba(7,8,15,0)');
  g.fillStyle = lift;
  g.fillRect(0, 0, w, h);
  if (kind === 'ally') {
    g.globalCompositeOperation = 'screen';
    const cx = w * 0.5, cy = h * 0.8;
    g.translate(cx, cy);
    g.scale(1, 0.16);
    const pool = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.42);
    pool.addColorStop(0, 'rgba(123,63,228,0.55)');
    pool.addColorStop(0.45, 'rgba(80,40,170,0.3)');
    pool.addColorStop(1, 'rgba(40,20,90,0)');
    g.fillStyle = pool;
    g.beginPath();
    g.arc(0, 0, w * 0.42, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = w * 0.006;
    g.strokeStyle = 'rgba(150,120,255,0.35)';
    g.beginPath();
    g.arc(0, 0, w * 0.3, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

/** Renders a stored drawing to a new canvas outW px wide (paper, halo, ink). Pure function of its inputs. */
export function renderDrawing(strokes: Stroke[], kind: Paper, outW: number, W = PAGE[kind].w, H = PAGE[kind].h) {
  const q = outW / W;
  const out = canvas(outW, H * q);
  const g = ctx2d(out);
  paintPaper(g, out.width, out.height, kind);
  const hc = canvas(W * HALO, H * HALO);
  const hg = ctx2d(hc);
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, hc.width, hc.height);
  const cuts = eraserCuts(strokes);
  strokes.forEach((st, i) => haloPass(hg, st, HALO, cuts[i]));
  g.save();
  g.globalCompositeOperation = 'screen';
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(hc, 0, 0, out.width, out.height);
  g.restore();
  // an eraser cuts ink only, so a drawing that has one inks its own layer and lays it over the paper
  const layer = strokes.some((st) => st.m === 'erase') ? canvas(out.width, out.height) : null;
  const ig = layer ? ctx2d(layer) : g;
  for (const st of strokes) inkPass(ig, st, q);
  if (layer) g.drawImage(layer, 0, 0);
  return out;
}

export function canvasBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob | null> {
  return new Promise((r) => {
    try {
      c.toBlob((b) => r(b), type, quality);
    } catch {
      r(null);
    }
  });
}

export interface PadOpts {
  kind: Paper;
  /** reduced motion: no fingertip glow, motes or settle */
  still?: () => boolean;
  strokes?: Stroke[];
  onChange?: () => void;
  onStroke?: () => void;
}

/**
 * The drawing surface: paper, committed halo, live halo, committed ink, live ink.
 * Pointer events with coalesced points, streamlined toward the finger and smoothed with quadratic midpoints.
 * Two-finger tap undoes. touch-action: none, so nothing scrolls or zooms while drawing. An eraser stroke works on the
 * committed layers themselves, from a copy of them taken as it starts, so the page shows exactly what it will keep.
 */
export class InkPad {
  readonly el: HTMLDivElement;
  readonly W: number;
  readonly H: number;
  inkIdx = 1;
  sizeIdx = 1;
  tool: Tool = 'brush';
  strokes: Stroke[] = [];
  /**
   * The eraser stroke in progress (see erase): the committed ink and light as they were when it started, the light of
   * the strokes it hasn't reached, each stroke's box, longest step, earlier cuts and the box its light fills on the
   * halo, the strokes it has reached with their own light as it cuts them, and how many of its points are done.
   */
  private er: {
    ink: HTMLCanvasElement;
    halo: HTMLCanvasElement;
    rest: HTMLCanvasElement;
    box: Box[];
    step: number[];
    cuts: (Stroke[] | undefined)[];
    lit: (Box | undefined)[];
    near: Map<number, HTMLCanvasElement>;
    groups: { c: HTMLCanvasElement | null; box: Box | null; ok: boolean }[];
    size: number;
    done: number;
  } | null = null;
  private spare: { ink: HTMLCanvasElement; halo: HTMLCanvasElement; rest: HTMLCanvasElement } | null = null;
  private undoStack: Stroke[][] = [];
  private redoStack: Stroke[][] = [];
  private paper: HTMLCanvasElement;
  private halo: HTMLCanvasElement;
  private haloLive: HTMLCanvasElement;
  private ink: HTMLCanvasElement;
  private live: HTMLCanvasElement;
  private fx: HTMLCanvasElement;
  private fg: CanvasRenderingContext2D;
  private tip: { x: number; y: number; off: number; ring: number } | null = null;
  private motes: { x: number; y: number; vx: number; vy: number; born: number; life: number; r: number; c: string }[] = [];
  private travel = 0;
  private fxBusy = false;
  private hg: CanvasRenderingContext2D;
  private hlg: CanvasRenderingContext2D;
  private ig: CanvasRenderingContext2D;
  private lg: CanvasRenderingContext2D;
  private cur: { st: Stroke; id: number; left: number; top: number; k: number; t0: number; box: [number, number, number, number] } | null = null;
  private lastBox: [number, number, number, number] | null = null;
  private pointers = new Map<number, { x: number; y: number; t: number }>();
  private twoFinger: { t: number; moved: boolean } | null = null;
  private raf = 0;
  private offs: (() => void)[] = [];
  /** frame times while drawing, for the perf check */
  readonly frames: number[] = [];

  constructor(readonly opts: PadOpts) {
    const { w, h } = PAGE[opts.kind];
    this.W = w;
    this.H = h;
    const mk = (cls: string, cw: number, ch: number) => {
      const c = canvas(cw, ch);
      c.className = `dq-ink-c ${cls}`;
      c.setAttribute('aria-hidden', 'true');
      return c;
    };
    this.paper = mk('dq-ink-paper', w * HALO, h * HALO);
    this.halo = mk('dq-ink-halo', w * HALO, h * HALO);
    this.haloLive = mk('dq-ink-halo', w * HALO, h * HALO);
    this.ink = mk('dq-ink-ink', w, h);
    this.live = mk('dq-ink-live', w, h);
    this.hg = ctx2d(this.halo);
    this.hlg = ctx2d(this.haloLive);
    this.ig = ctx2d(this.ink);
    this.lg = ctx2d(this.live);
    this.fx = mk('dq-ink-fx', w * FX, h * FX);
    this.fg = ctx2d(this.fx);
    paintPaper(ctx2d(this.paper), this.paper.width, this.paper.height, opts.kind);
    this.hlg.fillStyle = '#000';
    this.hlg.fillRect(0, 0, this.haloLive.width, this.haloLive.height);
    this.el = document.createElement('div');
    this.el.className = `dq-ink-stage dq-ink-stage--${opts.kind}`;
    this.el.style.aspectRatio = `${w} / ${h}`;
    this.el.append(this.paper, this.halo, this.haloLive, this.ink, this.fx, this.live);
    this.strokes = opts.strokes ? opts.strokes.slice() : [];
    this.redraw();
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, o);
      this.offs.push(() => t.removeEventListener(type, fn as EventListener, o));
    };
    on(this.live, 'pointerdown', this.down);
    on(this.live, 'pointermove', this.move);
    on(this.live, 'pointerup', this.up);
    on(this.live, 'pointercancel', this.up);
    on(this.live, 'lostpointercapture', this.up);
    on(this.live, 'contextmenu', (e: Event) => e.preventDefault());
    const stop = (e: Event) => e.cancelable && e.preventDefault();
    on(this.el, 'touchstart', stop, { passive: false });
    on(this.el, 'touchmove', stop, { passive: false });
    on(this.el, 'gesturestart', stop);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get drawing() {
    return !!this.cur;
  }

  private push() {
    this.undoStack.push(this.strokes);
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.strokes);
    this.strokes = prev;
    this.redraw();
    this.opts.onChange?.();
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.strokes);
    this.strokes = next;
    this.redraw();
    this.opts.onChange?.();
    return true;
  }

  clear() {
    if (!this.strokes.length) return false;
    this.push();
    this.strokes = [];
    this.redraw();
    this.opts.onChange?.();
    return true;
  }

  /** Replaces the page (a saved drawing or a draft opened again). History starts fresh from here. */
  load(strokes: Stroke[]) {
    this.strokes = strokes.slice();
    this.undoStack = [];
    this.redoStack = [];
    this.redraw();
    this.opts.onChange?.();
  }

  redraw() {
    this.endSettle();
    this.ig.clearRect(0, 0, this.W, this.H);
    this.hg.globalCompositeOperation = 'source-over';
    this.hg.fillStyle = '#000';
    this.hg.fillRect(0, 0, this.halo.width, this.halo.height);
    const cuts = eraserCuts(this.strokes);
    this.strokes.forEach((st, i) => {
      haloPass(this.hg, st, HALO, cuts[i]);
      inkPass(this.ig, st, 1);
    });
    // the page changed under an eraser stroke in progress (undo by key): it goes on from the page as it is now
    if (this.cur?.st.m === 'erase') {
      this.keepBefore();
      this.erase(this.cur.st);
    }
  }

  private keepBefore() {
    this.letGo();
    const sp = (this.spare ??= { ink: canvas(this.W, this.H), halo: canvas(this.halo.width, this.halo.height), rest: canvas(this.halo.width, this.halo.height) });
    paste(ctx2d(sp.ink), this.ink);
    paste(ctx2d(sp.halo), this.halo);
    paste(ctx2d(sp.rest), this.halo);
    // strokes in groups of about the square root of their number: see restAt
    const size = Math.max(8, Math.ceil(Math.sqrt(this.strokes.length)));
    const groups = Array.from({ length: Math.ceil(this.strokes.length / size) }, () => ({ c: null, box: null, ok: false }));
    this.er = { ...sp, box: this.strokes.map((s) => bounds(s.p)), step: this.strokes.map((s) => stepOf(s.p)), cuts: eraserCuts(this.strokes), lit: [], near: new Map(), groups, size, done: 0 };
  }
  /** Lets go of the eraser stroke in progress and the light it kept for the strokes it reached. */
  private letGo() {
    for (const c of [...(this.er?.near.values() ?? []), ...(this.er?.groups.map((g) => g.c) ?? [])]) if (c) c.width = c.height = 0;
    this.er = null;
  }
  /**
   * The light of the strokes the eraser stroke hasn't reached, drawn again in box b of the halo after it reaches more.
   * Each group of strokes keeps its light, drawn again only when one of its strokes was reached, so reaching one
   * more stroke draws again the light of its group alone; the groups' light is laid together.
   */
  private restAt(b: Box) {
    const er = this.er!;
    const g = ctx2d(er.rest);
    g.save();
    clip(g, b);
    g.fillStyle = '#000';
    g.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    g.globalCompositeOperation = 'screen';
    er.groups.forEach((grp, k) => {
      const of = this.strokes.slice(k * er.size, (k + 1) * er.size).map((_, j) => k * er.size + j);
      grp.box ??= of.reduce<Box | null>((a, i) => (lights(this.strokes[i], HALO).length ? join(a, this.litOf(i)) : a), null);
      const gb = grp.box;
      if (!gb || !meets(gb, b)) return;
      if (!grp.ok) {
        const c = (grp.c ??= canvas(gb[2] - gb[0], gb[3] - gb[1]));
        const cg = ctx2d(c);
        cg.clearRect(0, 0, c.width, c.height);
        for (const i of of) if (!er.near.has(i)) haloPass(cg, this.strokes[i], HALO, er.cuts[i], gb[0], gb[1]);
        grp.ok = true;
      }
      g.drawImage(grp.c!, gb[0], gb[1]);
    });
    g.restore();
  }
  /** Box b of the page (logical px) on the halo, in its whole px. */
  private onHalo(b: Box): Box {
    return [Math.max(0, Math.floor(b[0] * HALO)), Math.max(0, Math.floor(b[1] * HALO)), Math.min(this.halo.width, Math.ceil(b[2] * HALO)), Math.min(this.halo.height, Math.ceil(b[3] * HALO))];
  }
  /** The box stroke i's light fills on the halo, in its px. */
  private litOf(i: number): Box {
    const er = this.er!;
    return (er.lit[i] ??= this.onHalo(grow(er.box[i], reach(this.strokes[i], HALO))));
  }
  /** The committed ink cut by eraser stroke st from its copy, within box b (all of it without one). */
  private cutInk(st: Stroke, b?: Box) {
    const er = this.er!;
    paste(this.ig, er.ink, b);
    this.ig.save();
    if (b) clip(this.ig, b);
    inkPass(this.ig, st, 1);
    this.ig.restore();
  }
  /**
   * The committed layers cut by the eraser stroke in progress, for its points not done yet (null puts them back as
   * they were). Only what the newest part of the stroke changes is drawn again. The ink is cut again around it from
   * its copy. The light: each stroke it cuts keeps its own light, drawn again, cut, only when the stroke is cut further.
   * A stroke reached for the first time leaves the light of the strokes not reached, drawn again only where its light
   * was. The light is then laid together only where the light of the strokes it cut falls.
   */
  private erase(st: Stroke | null) {
    const er = this.er!;
    if (!st) {
      paste(this.ig, er.ink);
      paste(this.hg, er.halo);
      return;
    }
    const p = st.p;
    if (p.length >> 1 <= er.done) return;
    // the path is smoothed through midpoints, so the last two points done change shape as more arrive
    const k = Math.max(0, er.done - 2) * 2;
    er.done = p.length >> 1;
    const r = (st.w * ERASE) / 2;
    const tail = bounds(p, k);
    this.cutInk(st, grow(tail, r + 4));
    // a smoothed path stays within a quarter step of the line through its points; 6 more for the light's soft edge
    const slack = stepOf(p, k) * 0.3 + 6;
    const cut: number[] = [];
    this.strokes.forEach((s, i) => {
      const d = lineHalf(s) + r + er.step[i] * 0.3 + slack;
      if (lights(s, HALO).length && meets(grow(er.box[i], d), tail) && touches(s.p, p, k, d)) cut.push(i);
    });
    if (!cut.length) return;
    let fresh: Box | null = null;
    let area: Box | null = null;
    // where each stroke's light changes: around the newest part of the eraser, as far as its light reaches (all of
    // it for one reached for the first time)
    const at = new Map<number, Box>();
    const newly: number[] = [];
    for (const i of cut) {
      const lb = this.litOf(i);
      if (er.near.has(i)) {
        const b = this.onHalo(grow(tail, r + 2 + reach(this.strokes[i], HALO)));
        at.set(i, [Math.max(b[0], lb[0]), Math.max(b[1], lb[1]), Math.min(b[2], lb[2]), Math.min(b[3], lb[3])]);
      } else {
        fresh = join(fresh, lb);
        newly.push(i);
        er.near.set(i, canvas(lb[2] - lb[0], lb[3] - lb[1]));
        at.set(i, lb);
      }
      area = join(area, at.get(i)!);
    }
    if (fresh) {
      // their groups' light no longer holds theirs
      for (const i of newly) er.groups[Math.floor(i / er.size)].ok = false;
      this.restAt(fresh);
    }
    for (const i of cut) {
      const c = er.near.get(i)!, lb = this.litOf(i);
      const g = ctx2d(c);
      const b = at.get(i)!;
      const cb: Box = [b[0] - lb[0], b[1] - lb[1], b[2] - lb[0], b[3] - lb[1]];
      g.save();
      clip(g, cb);
      g.clearRect(cb[0], cb[1], cb[2] - cb[0], cb[3] - cb[1]);
      haloPass(g, this.strokes[i], HALO, [...(er.cuts[i] ?? []), st], lb[0], lb[1]);
      g.restore();
    }
    const g = this.hg;
    paste(g, er.rest, area!);
    g.save();
    clip(g, area!);
    g.globalCompositeOperation = 'screen';
    for (const [i, c] of er.near) {
      const lb = this.litOf(i);
      if (meets(lb, area!)) g.drawImage(c, lb[0], lb[1]);
    }
    g.restore();
  }
  /** Lets go of the stroke in progress without keeping it. */
  private drop() {
    const c = this.cur;
    this.cur = null;
    if (c?.st.m === 'erase') {
      this.erase(null);
      this.letGo();
    }
    this.clearLive();
  }

  private down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (this.pointers.size === 2 && this.cur && performance.now() - this.cur.t0 < 260 && this.cur.st.p.length < 24) {
      this.drop();
      this.twoFinger = { t: performance.now(), moved: false };
      return;
    }
    if (this.cur || this.twoFinger) return;
    try {
      this.live.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    const r = this.live.getBoundingClientRect();
    const k = this.W / Math.max(1, r.width);
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const w = Math.round(SIZES[this.sizeIdx].k * this.W * 10) / 10;
    this.endSettle();
    const st: Stroke = { i: this.inkIdx, w, p: [x, y] };
    if (this.tool !== 'brush') st.m = this.tool;
    if (st.m === 'erase') this.keepBefore();
    this.cur = { st, id: e.pointerId, left: r.left, top: r.top, k, t0: performance.now(), box: [x, y, x, y] };
    this.schedule();
  };

  private move = (e: PointerEvent) => {
    const p0 = this.pointers.get(e.pointerId);
    if (this.twoFinger && p0 && Math.hypot(e.clientX - p0.x, e.clientY - p0.y) > 14) this.twoFinger.moved = true;
    const c = this.cur;
    if (!c || e.pointerId !== c.id) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of list.length ? list : [e]) this.addPoint(ev.clientX, ev.clientY, false);
    this.schedule();
  };

  private up = (e: PointerEvent) => {
    const had = this.pointers.delete(e.pointerId);
    if (this.twoFinger) {
      if (!this.pointers.size) {
        const quick = performance.now() - this.twoFinger.t < 450 && !this.twoFinger.moved;
        this.twoFinger = null;
        if (quick && had) this.undo();
      }
      return;
    }
    const c = this.cur;
    if (!c || e.pointerId !== c.id) return;
    if (e.type === 'pointerup') this.addPoint(e.clientX, e.clientY, true);
    this.commit();
  };

  private addPoint(cx: number, cy: number, final: boolean) {
    const c = this.cur!;
    const x = (cx - c.left) * c.k, y = (cy - c.top) * c.k;
    const p = c.st.p;
    const n = p.length;
    const lx = p[n - 2], ly = p[n - 1];
    const t = final ? 1 : 0.62;
    const sx = lx + (x - lx) * t, sy = ly + (y - ly) * t;
    if (Math.hypot(sx - lx, sy - ly) < (final ? 0.5 : 1.25) * c.k) return;
    p.push(sx, sy);
    const erasing = c.st.m === 'erase';
    if (!this.opts.still?.()) this.tip = { x: sx, y: sy, off: 0, ring: erasing ? (c.st.w * ERASE) / 2 : 0 };
    this.travel += Math.hypot(sx - lx, sy - ly) / c.k;
    if (this.travel > 15 && this.motes.length < 36 && !erasing && !this.opts.still?.()) {
      this.travel = 0;
      const ink = INKS[c.st.i] ?? INKS[0];
      const a = Math.random() * Math.PI * 2;
      this.motes.push({ x: sx + Math.cos(a) * c.st.w * 0.6, y: sy + Math.sin(a) * c.st.w * 0.6, vx: (Math.random() - 0.5) * 0.05, vy: -0.04 - Math.random() * 0.06, born: performance.now(), life: 600 + Math.random() * 500, r: 2.5 + Math.random() * 3.5, c: ink.core ?? ink.halo });
    }
    const b = c.box;
    if (sx < b[0]) b[0] = sx;
    if (sy < b[1]) b[1] = sy;
    if (sx > b[2]) b[2] = sx;
    if (sy > b[3]) b[3] = sy;
  }

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private settleOn = false;
  private endSettle() {
    if (!this.settleOn) return;
    this.settleOn = false;
    this.haloLive.getAnimations().forEach((a) => a.cancel());
    this.hlg.fillStyle = '#000';
    this.hlg.fillRect(0, 0, this.haloLive.width, this.haloLive.height);
  }
  private clearLive() {
    this.endSettle();
    const b = this.lastBox;
    if (b) this.lg.clearRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    this.lastBox = null;
    this.hlg.fillStyle = '#000';
    this.hlg.fillRect(0, 0, this.haloLive.width, this.haloLive.height);
  }

  private frame = () => {
    this.raf = 0;
    const c = this.cur;
    this.drawFx(performance.now());
    if (this.fxBusy) this.schedule();
    if (!c) return;
    const t0 = performance.now();
    if (c.st.m === 'erase') {
      this.erase(c.st);
      this.frames.push(performance.now() - t0);
      if (this.frames.length > 2000) this.frames.splice(0, 1000);
      return;
    }
    const m = c.st.w;
    const box: [number, number, number, number] = [Math.max(0, c.box[0] - m), Math.max(0, c.box[1] - m), Math.min(this.W, c.box[2] + m), Math.min(this.H, c.box[3] + m)];
    const prev = this.lastBox;
    const clr = prev ? [Math.min(prev[0], box[0]), Math.min(prev[1], box[1]), Math.max(prev[2], box[2]), Math.max(prev[3], box[3])] : box;
    this.lg.clearRect(clr[0], clr[1], clr[2] - clr[0], clr[3] - clr[1]);
    this.lastBox = box;
    inkPass(this.lg, c.st, 1);
    this.hlg.fillStyle = '#000';
    this.hlg.fillRect(0, 0, this.haloLive.width, this.haloLive.height);
    haloPass(this.hlg, c.st, HALO);
    this.frames.push(performance.now() - t0);
    if (this.frames.length > 2000) this.frames.splice(0, 1000);
  };

  private drawFx(now: number) {
    const g = this.fg;
    const fw = this.fx.width, fh = this.fx.height;
    g.clearRect(0, 0, fw, fh);
    let busy = false;
    if (this.opts.still?.()) {
      this.motes = [];
      this.tip = null;
      this.fxBusy = false;
      return;
    }
    g.globalCompositeOperation = 'lighter';
    const t = this.tip;
    if (t) {
      const a = this.cur ? 1 : 1 - (now - t.off) / 280;
      if (a > 0 && t.ring) {
        // the eraser's edge, so the player sees how much it takes
        g.globalAlpha = 0.6 * a;
        g.strokeStyle = '#e6f1ff';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(t.x * FX, t.y * FX, t.ring * FX, 0, Math.PI * 2);
        g.stroke();
        busy = true;
      } else if (a > 0) {
        const ink = INKS[this.cur?.st.i ?? this.inkIdx] ?? INKS[0];
        const w = (this.cur?.st.w ?? SIZES[this.sizeIdx].k * this.W) * FX;
        const r = w * 1.4 + 22 * FX;
        const gr = g.createRadialGradient(t.x * FX, t.y * FX, 0, t.x * FX, t.y * FX, r);
        gr.addColorStop(0, ink.core ?? ink.halo);
        gr.addColorStop(0.25, ink.halo);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.42 * a;
        g.fillStyle = gr;
        g.fillRect(t.x * FX - r, t.y * FX - r, r * 2, r * 2);
        busy = true;
      } else this.tip = null;
    }
    this.motes = this.motes.filter((m) => now - m.born < m.life);
    for (const m of this.motes) {
      const age = now - m.born, k = age / m.life;
      const x = (m.x + m.vx * age + Math.sin(age * 0.006 + m.r) * 3) * FX, y = (m.y + m.vy * age) * FX;
      const r = m.r * FX * 2.2;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, m.c);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = Math.sin(Math.PI * k) * 0.8;
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      busy = true;
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.fxBusy = busy;
  }

  private commit() {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    const st = c.st;
    st.p = st.p.map((v) => Math.round(v * 10) / 10);
    if (this.tip) this.tip.off = performance.now();
    if (st.m === 'erase') {
      this.schedule();
      this.erase(st);
      // one that reaches nothing on the page isn't kept; one that does cuts the ink by its points as they are kept
      const kept = this.er!.near.size > 0;
      if (kept) this.cutInk(st);
      else this.erase(null);
      this.letGo();
      if (!kept) return;
      this.push();
      this.strokes = [...this.strokes, st];
      // the light it leaves is drawn once more from the strokes, so the page shows exactly what a render of it does
      const cuts = eraserCuts(this.strokes);
      this.hg.fillStyle = '#000';
      this.hg.fillRect(0, 0, this.halo.width, this.halo.height);
      this.strokes.forEach((s, i) => haloPass(this.hg, s, HALO, cuts[i]));
      this.opts.onStroke?.();
      this.opts.onChange?.();
      return;
    }
    this.clearLive();
    if (!this.opts.still?.()) {
      haloPass(this.hlg, st, HALO);
      this.haloLive.animate([{ opacity: 0.38 }, { opacity: 0 }], { duration: 300, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' });
      this.settleOn = true;
    }
    this.schedule();
    this.push();
    this.strokes = [...this.strokes, st];
    haloPass(this.hg, st, HALO);
    inkPass(this.ig, st, 1);
    this.opts.onStroke?.();
    this.opts.onChange?.();
  }

  /** The drawing as a canvas outW px wide, rendered fresh from the strokes (same path as restores and thumbnails). */
  render(outW = this.W) {
    return renderDrawing(this.strokes, this.opts.kind, outW, this.W, this.H);
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.offs.forEach((f) => f());
    this.offs = [];
    this.letGo();
    for (const c of [this.paper, this.halo, this.haloLive, this.ink, this.fx, this.live, this.spare?.ink, this.spare?.halo, this.spare?.rest]) {
      if (!c) continue;
      c.width = 1;
      c.height = 1;
    }
  }
}
