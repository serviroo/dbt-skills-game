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

/** i: ink index, w: line width in logical px, p: flat x,y pairs in logical px, m: the tool, when not the brush */
export interface Stroke {
  i: number;
  w: number;
  p: number[];
  m?: StrokeMode;
}
/** A stroke as it is stored: a brush stroke keeps the same three fields it always had. */
export const plainStroke = (s: Stroke): Stroke => (s.m ? { i: s.i, w: s.w, p: s.p, m: s.m } : { i: s.i, w: s.w, p: s.p });

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
/** Replaces everything on g with the canvas from. */
const paste = (g: CanvasRenderingContext2D, from: HTMLCanvasElement) => {
  g.save();
  g.globalCompositeOperation = 'copy';
  g.drawImage(from, 0, 0);
  g.restore();
};

/** The box around a stroke's points: left, top, right, bottom. */
function bounds(p: number[]): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 1 < p.length; k += 2) {
    b[0] = Math.min(b[0], p[k]);
    b[1] = Math.min(b[1], p[k + 1]);
    b[2] = Math.max(b[2], p[k]);
    b[3] = Math.max(b[3], p[k + 1]);
  }
  return b;
}

function trace(g: CanvasRenderingContext2D, p: number[], s: number) {
  const n = p.length >> 1;
  g.beginPath();
  g.moveTo(p[0] * s, p[1] * s);
  if (n === 1) {
    g.lineTo(p[0] * s + 0.01, p[1] * s);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2] * s, y = p[i * 2 + 1] * s;
    g.quadraticCurveTo(x, y, (x + p[i * 2 + 2] * s) / 2, (y + p[i * 2 + 3] * s) / 2);
  }
  g.lineTo(p[n * 2 - 2] * s, p[n * 2 - 1] * s);
}

type Box = [number, number, number, number];
/** Whether eraser stroke e (in box eb) passes over stroke a (in box ab): its line, or a soft-glow core's soft edge. */
const crosses = (a: Stroke, ab: Box, e: Stroke, eb: Box) => {
  const m = a.w * (a.m === 'glow' ? 2.5 : 1.4) + (e.w * ERASE) / 2 + 2;
  return ab[0] - m <= eb[2] && ab[2] + m >= eb[0] && ab[1] - m <= eb[3] && ab[3] + m >= eb[1];
};
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
/**
 * Halo pass onto an opaque black canvas at scale s (screen blend, so overlapping light adds softly). cut: the eraser
 * strokes drawn after this one. They cut its line before it glows, so its light goes out where it was erased while
 * the light of everything else stays. An eraser stroke adds no light of its own.
 */
export function haloPass(g: CanvasRenderingContext2D, st: Stroke, s: number, cut?: Stroke[]) {
  if (st.m === 'erase') return;
  const ink = INKS[st.i] ?? INKS[0];
  // a soft-glow line glows twice: its halo, and a wider, fainter breath of the same light, as a light source does
  const passes = st.m === 'glow' ? [[1.2, st.w * s * 3.4 + 44 * s, 1], [1.2, st.w * s * 5.5 + 72 * s, 0.75]] : [[1.25, Math.max(4, st.w * s * 2.2 + 26 * s), 1]];
  g.save();
  g.globalCompositeOperation = 'screen';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = g.shadowColor = ink.halo;
  for (const [k, blur, a] of passes) {
    g.globalAlpha = a;
    g.lineWidth = Math.max(1, st.w * k * s);
    g.shadowBlur = blur;
    if (!cut?.length) {
      trace(g, st.p, s);
      g.stroke();
      continue;
    }
    const c = (scratch ??= document.createElement('canvas'));
    if (c.width !== g.canvas.width || c.height !== g.canvas.height) [c.width, c.height] = [g.canvas.width, g.canvas.height];
    const cg = ctx2d(c);
    cg.clearRect(0, 0, c.width, c.height);
    cg.lineCap = 'round';
    cg.lineJoin = 'round';
    cg.strokeStyle = ink.halo;
    cg.lineWidth = g.lineWidth;
    trace(cg, st.p, s);
    cg.stroke();
    cg.globalCompositeOperation = 'destination-out';
    for (const e of cut) {
      cg.lineWidth = e.w * ERASE * s;
      trace(cg, e.p, s);
      cg.stroke();
    }
    cg.globalCompositeOperation = 'source-over';
    g.drawImage(c, 0, 0);
  }
  g.restore();
}

export function inkPass(g: CanvasRenderingContext2D, st: Stroke, s: number) {
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
    // the core: a thin bright line with a soft edge of its own light
    g.save();
    g.strokeStyle = ink.core ?? ink.body;
    g.shadowColor = ink.mid ?? ink.halo;
    g.shadowBlur = st.w * 1.5 * s;
    g.lineWidth = Math.max(1.4, st.w * 0.26) * s;
    g.stroke();
    g.restore();
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
   * The eraser stroke in progress: the committed ink as it was when it started, the light of the strokes it hasn't
   * reached, each stroke's box and earlier cuts, and the strokes it has reached.
   */
  private er: { ink: HTMLCanvasElement; rest: HTMLCanvasElement; box: Box[]; cuts: (Stroke[] | undefined)[]; near: Set<number> } | null = null;
  private spare: { ink: HTMLCanvasElement; rest: HTMLCanvasElement } | null = null;
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
    const sp = (this.spare ??= { ink: canvas(this.W, this.H), rest: canvas(this.halo.width, this.halo.height) });
    paste(ctx2d(sp.ink), this.ink);
    paste(ctx2d(sp.rest), this.halo);
    this.er = { ...sp, box: this.strokes.map((s) => bounds(s.p)), cuts: eraserCuts(this.strokes), near: new Set() };
  }
  /**
   * The committed layers cut by the eraser stroke in progress (or as they were, for null). The ink is cut from its
   * copy. The light is the light of every stroke it hasn't reached, drawn again only when it reaches one more, plus
   * the light of the ones it has, each cut by it.
   */
  private erase(st: Stroke | null) {
    const er = this.er!;
    paste(this.ig, er.ink);
    if (st) {
      const eb = bounds(st.p);
      let more = false;
      this.strokes.forEach((s, i) => {
        if (s.m === 'erase' || er.near.has(i) || !crosses(s, er.box[i], st, eb)) return;
        er.near.add(i);
        more = true;
      });
      if (more) {
        const g = ctx2d(er.rest);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#000';
        g.fillRect(0, 0, er.rest.width, er.rest.height);
        this.strokes.forEach((s, i) => er.near.has(i) || haloPass(g, s, HALO, er.cuts[i]));
      }
      inkPass(this.ig, st, 1);
    }
    paste(this.hg, er.rest);
    for (const i of er.near) haloPass(this.hg, this.strokes[i], HALO, st ? [...(er.cuts[i] ?? []), st] : er.cuts[i]);
  }
  /** Lets go of the stroke in progress without keeping it. */
  private drop() {
    const c = this.cur;
    this.cur = null;
    if (c?.st.m === 'erase') {
      this.erase(null);
      this.er = null;
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
    // a soft-glow core's own light reaches further than a brush line, and all of it is cleared next frame
    const m = c.st.m === 'glow' ? c.st.w * 2.5 + 4 : c.st.w;
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
      // one that reaches nothing on the page isn't kept
      const kept = this.er!.near.size > 0;
      if (!kept) this.erase(null);
      this.er = null;
      if (!kept) return;
      this.push();
      this.strokes = [...this.strokes, st];
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
    for (const c of [this.paper, this.halo, this.haloLive, this.ink, this.fx, this.live, this.spare?.ink, this.spare?.rest]) {
      if (!c) continue;
      c.width = 1;
      c.height = 1;
    }
  }
}
