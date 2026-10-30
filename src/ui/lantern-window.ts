import '../styles/lantern-window.css';
import { after, animate, complete, el, finished, wait } from './anim';
import { inertUntil, onTaps } from './taps';
import { onMotion, params } from '../core/params';
import { EASE, LEVEL, WINDOW as W, css, fr } from '../motion/tokens';

export type WindowKind = 'notification' | 'quest' | 'level' | 'reward' | 'info';

export interface WindowAction {
  label: string;
  value: string;
  variant?: 'gold' | 'quiet';
}

export interface WindowSpec {
  kind?: WindowKind;
  title: string;
  icon?: 'alert' | 'quest' | 'level' | 'reward' | 'info';
  html: string;
  actions?: WindowAction[];
  /** show the ▾ indicator and resolve on a tap anywhere */
  tapToContinue?: boolean;
  width?: string;
  /** Custom reveal for content marked .sw-custom, called when the panel reaches full height. Returns the ms (from
   * that moment) before the body starts typing. Animations made through ctx.animate complete on a tap. */
  reveal?: (ctx: RevealCtx) => number | void;
  /** Timing cues for sound: the rolled number lands, a stat row starts typing, typing is done. */
  onCue?: (cue: WindowCue, index?: number) => void;
}

/** Sound hook, wired by the audio module. */
export const windowSounds: { open?: (kind: WindowKind) => void; close?: () => void; tap?: () => void } = {};

export const DISMISSED = 'dismissed';

const live = new Set<LanternWindow>();

export function dismissWindows() {
  for (const w of [...live]) w.dismiss();
}

const ICONS: Record<string, string> = {
  alert: `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16.5" fill="none" stroke="#d2f4ff" stroke-width="2.6"/><path d="M20 10.5v12.5" stroke="#d2f4ff" stroke-width="3.2" stroke-linecap="round"/><circle cx="20" cy="29" r="2.1" fill="#d2f4ff"/></svg>`,
  quest: `<svg viewBox="0 0 40 40"><rect x="8" y="6" width="24" height="28" rx="2" fill="none" stroke="#d2f4ff" stroke-width="2.4"/><path d="M13 14h14M13 20h14M13 26h8" stroke="#d2f4ff" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  level: `<svg viewBox="0 0 40 40"><path d="M20 6l12 14h-7v14h-10v-14h-7z" fill="none" stroke="#d2f4ff" stroke-width="2.4" stroke-linejoin="round"/></svg>`,
  reward: `<svg viewBox="0 0 40 40"><path d="M20 5l4.2 9.6 10.3 1-7.8 6.9 2.3 10.2L20 27.4 11 32.7l2.3-10.2-7.8-6.9 10.3-1z" fill="none" stroke="#fff3d0" stroke-width="2.4" stroke-linejoin="round"/></svg>`,
  info: `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16.5" fill="none" stroke="#d2f4ff" stroke-width="2.6"/><path d="M20 17v12" stroke="#d2f4ff" stroke-width="3.2" stroke-linecap="round"/><circle cx="20" cy="11.5" r="2.1" fill="#d2f4ff"/></svg>`,
};

const CHEVRON = `<svg viewBox="0 0 14 9"><path d="M1 1.5l6 6 6-6" fill="none" stroke="#bfe9ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let texCache: { plasma: string; plasmaB: string; scratch: string } | null = null;

/** Procedural textures, drawn once: boiling plasma strips and the panel's diagonal scratch streaks. */
function textures() {
  if (texCache) return texCache;
  const strip = (w: number, seed: number, blobs: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = 16;
    const g = c.getContext('2d')!;
    let s = seed;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < blobs; i++) {
      const x = r() * w, y = 8 + (r() - 0.5) * 6, rw = 6 + r() * 22, rh = 1.5 + r() * 3.2;
      const a = 0.25 + r() * 0.75;
      for (const dx of [-w, 0, w]) {
        const grd = g.createRadialGradient(x + dx, y, 0, x + dx, y, rw);
        grd.addColorStop(0, `rgba(235,255,255,${a})`);
        grd.addColorStop(0.35, `rgba(120,240,255,${a * 0.6})`);
        grd.addColorStop(1, 'rgba(40,120,255,0)');
        g.fillStyle = grd;
        g.save();
        g.translate(x + dx, y);
        g.scale(1, rh / rw);
        g.translate(-(x + dx), -y);
        g.beginPath();
        g.arc(x + dx, y, rw, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    return c.toDataURL();
  };
  const scratch = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const x = r() * 700 - 100, y = r() * 700 - 100;
      const len = 30 + r() * 220;
      const ang = (52 + r() * 10) * (Math.PI / 180);
      const a = 0.025 + r() * 0.07;
      g.strokeStyle = `rgba(110,150,200,${a})`;
      g.lineWidth = 0.6 + r() * 1.1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.stroke();
    }
    // faint cracked-glass veins near the edges
    for (let i = 0; i < 18; i++) {
      let x = r() < 0.5 ? r() * 60 : 452 + r() * 60, y = r() * 512;
      g.strokeStyle = `rgba(129,195,239,${0.04 + r() * 0.05})`;
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (r() - 0.5) * 40;
        y += (r() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return c.toDataURL();
  })();
  texCache = { plasma: strip(220, 3, 26), plasmaB: strip(140, 11, 14), scratch };
  return texCache;
}

function barSVG(bottom: boolean) {
  // thin circuit traces with 45° jogs and node glyphs around the core bar
  const y1 = bottom ? 20 : 6, y2 = bottom ? 6 : 20;
  return `<svg viewBox="0 0 1000 26" preserveAspectRatio="none">
    <g fill="none" stroke="#5fd6ff" stroke-width="1.1" vector-effect="non-scaling-stroke" opacity=".75">
      <path d="M0 ${y1} H40 L52 ${12} H70" vector-effect="non-scaling-stroke"/>
      <path d="M1000 ${y1} H960 L948 ${12} H930" vector-effect="non-scaling-stroke"/>
      <path d="M120 ${y2} H330 L340 ${y2 === 6 ? 2 : 24} H520" vector-effect="non-scaling-stroke" opacity=".6"/>
      <path d="M560 ${y2} H880" vector-effect="non-scaling-stroke" opacity=".6"/>
    </g>
    <g fill="#b5fbfc" opacity=".9">
      <rect x="250" y="${y2 - 1.5}" width="10" height="3"/><rect x="610" y="${y2 - 1.5}" width="6" height="3"/>
      <rect x="700" y="${y2 - 1.5}" width="14" height="3"/><rect x="44" y="${y1 - 1.5}" width="5" height="3"/>
      <rect x="951" y="${y1 - 1.5}" width="5" height="3"/>
    </g>
  </svg>`;
}

type Unit = { els: Element[]; kind: 'char' | 'word' | 'block' | 'roll'; row?: number };

const PUNCT = /^[.,!?;:)\]»”’…]+$/;

/** Splits the window's text into typing units in reading order, without changing layout (inline spans only). */
function collectUnits(root: Element, rows: Element[]): Unit[] {
  const units: Unit[] = [];
  const rowOf = (n: Node) => {
    const r = (n instanceof Element ? n : n.parentElement)?.closest('.sw-row');
    return r ? rows.indexOf(r) : undefined;
  };
  const chars = (host: Element) => {
    const text = host.textContent ?? '';
    host.textContent = '';
    const wrap = el('span', 'sw-tt');
    for (const ch of text) {
      const s = el('span', 'sw-c');
      s.textContent = ch;
      wrap.append(s);
      if (ch.trim()) units.push({ els: [s], kind: 'char' });
    }
    host.append(wrap);
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (!text.trim()) continue;
        const frag = document.createDocumentFragment();
        const parts = text.split(/(\s+)/);
        parts.forEach((part, i) => {
          if (!part) return;
          if (!part.trim()) return void frag.append(part);
          const s = el('span', 'sw-u');
          s.textContent = part;
          frag.append(s);
          const prev = units[units.length - 1];
          // punctuation glued to the previous word (e.g. "<b>Player</b>.") lands with it
          if (i === 0 && PUNCT.test(part) && prev && prev.kind === 'word') prev.els.push(s);
          else units.push({ els: [s], kind: 'word', row: rowOf(child) });
        });
        child.replaceWith(frag);
      } else if (child instanceof Element) {
        if (child.matches('.sw-custom')) continue;
        if (child.matches('.sw-roll')) units.push({ els: [child], kind: 'roll' });
        else if (child.matches('.sw-chars, .sw-big')) chars(child);
        else if (child instanceof SVGElement || child.matches('img, .n')) units.push({ els: [child], kind: 'block', row: rowOf(child) });
        else walk(child);
      }
    }
  };
  walk(root);
  return units;
}

/** Rolls "from" up and out while the new number rises in, inside a fixed clip box. */
function buildRoll(r: HTMLElement) {
  const to = r.textContent ?? '';
  const from = r.dataset.from ?? '';
  r.textContent = '';
  const oldN = el('span', 'sw-roll-n sw-roll-old', from);
  const newN = el('span', 'sw-roll-n sw-roll-new', to);
  const glow = el('span', 'sw-roll-n sw-roll-glow', to);
  glow.setAttribute('aria-hidden', 'true');
  oldN.setAttribute('aria-hidden', 'true');
  r.append(oldN, newN, glow);
  r.setAttribute('aria-label', to);
  return { box: r, oldN, newN, glow };
}

export interface RevealCtx {
  root: HTMLElement;
  reduced: boolean;
  /** schedules an animation that a tap-to-skip completes */
  animate: (el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) => Animation;
  /** runs `fn` `ms` into the reveal, unless the typing has ended (a tap completed it, or the window went) */
  cue: (ms: number, fn: () => void) => void;
}

export type WindowCue = 'land' | 'row' | 'typed';

export class LanternWindow {
  readonly root: HTMLDivElement;
  private tilt: HTMLDivElement;
  private plate: HTMLDivElement;
  private wash: HTMLDivElement;
  private bars: HTMLDivElement[];
  private slices: HTMLElement[];
  private next: HTMLDivElement;
  private plasmaAnims: Animation[] = [];
  /** the waiting arrow's pulse, while it shows and motion is on */
  private pulse: Animation | null = null;
  private waiting = false;
  private offMotion: (() => void) | null = null;
  private typeAnims: Animation[] = [];
  private typing = false;
  private skipRes: (() => void) | null = null;
  private offInput: (() => void) | null = null;
  private reduced = params.reduced;
  private resolveTap: ((v: string) => void) | null = null;
  /** an answer that came before anyone waited for one (a button tapped while the window opens), kept for waitForInput */
  private early: string | null = null;
  private gone = false;
  readonly spec: WindowSpec;

  constructor(readonly layer: HTMLElement, spec: WindowSpec) {
    this.spec = spec;
    const t = textures();
    const kind = spec.kind ?? 'notification';
    const root = el('div', 'sw') as HTMLDivElement;
    root.dataset.kind = kind;
    if (spec.width) root.style.setProperty('--w', spec.width);
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', spec.title);
    const tilt = el('div', 'sw-tilt') as HTMLDivElement;
    const barTop = el('div', 'sw-bar sw-bar--top', barSVG(false)) as HTMLDivElement;
    const barBot = el('div', 'sw-bar sw-bar--bottom', barSVG(true)) as HTMLDivElement;
    for (const b of [barTop, barBot]) {
      const core = el('div', 'core');
      const p1 = el('i', 'plasma');
      p1.style.backgroundImage = `url(${t.plasma})`;
      const p2 = el('i', 'plasma b');
      p2.style.backgroundImage = `url(${t.plasmaB})`;
      core.append(p1, p2);
      b.append(core);
    }
    const plate = el('div', 'sw-plate') as HTMLDivElement;
    const tex = el('div', 'sw-tex');
    tex.style.backgroundImage = `url(${t.scratch})`;
    const wash = el('div', 'sw-wash') as HTMLDivElement;
    plate.append(tex, el('div', 'sw-scan'), el('div', 'sw-inset'));
    for (const c of ['tl', 'tr', 'bl', 'br']) plate.append(el('span', `sw-corner ${c}`));
    const chip = el('header', 'sw-chip');
    if (spec.icon !== undefined || kind) {
      const ic = el('span', 'sw-icon', ICONS[spec.icon ?? (kind === 'reward' ? 'reward' : kind === 'quest' ? 'quest' : kind === 'level' ? 'level' : 'alert')]);
      chip.append(ic);
    }
    chip.append(el('span', 'sw-title sw-chars', spec.title));
    const body = el('div', 'sw-body', spec.html);
    plate.append(chip, body);
    if (spec.actions?.length) {
      const acts = el('div', 'sw-actions');
      for (const a of spec.actions) {
        const btn = el('button', `sw-btn ${a.variant ?? ''}`, a.label) as HTMLButtonElement;
        btn.type = 'button';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          windowSounds.tap?.();
          this.answer(a.value);
        });
        acts.append(btn);
      }
      plate.append(acts);
    }
    const next = el('div', 'sw-next', CHEVRON) as HTMLDivElement;
    plate.append(next, wash);
    // glitch-in slices: displaced pieces of the frame (bars and plate edges), never over the text
    const glitch = el('div', 'sw-glitch');
    glitch.setAttribute('aria-hidden', 'true');
    const slices = [0, 1, 2, 3].map((i) => el('i', `sw-slice s${i}`));
    glitch.append(...slices);
    tilt.append(barTop, plate, barBot, glitch);
    root.append(tilt);
    this.root = root;
    this.tilt = tilt;
    this.plate = plate;
    this.wash = wash;
    this.bars = [barTop, barBot];
    this.slices = slices;
    this.next = next;
    root.style.visibility = 'hidden';
    layer.append(root);
    live.add(this);
  }

  private startPlasma() {
    if (this.reduced) return;
    const ps = this.root.querySelectorAll<HTMLElement>('.plasma');
    ps.forEach((p, i) => {
      const w = i % 2 ? 140 : 220;
      const dir = i % 4 < 2 ? 1 : -1;
      // drawn "on 2s": stepped at 12 fps
      const dur = (i % 2 ? 1.6 : 2.6) * 1000;
      this.plasmaAnims.push(
        animate(p, [{ backgroundPositionX: '0px' }, { backgroundPositionX: `${w * dir}px` }], {
          duration: dur,
          iterations: Infinity,
          easing: `steps(${Math.round((dur / 1000) * 12)}, end)`,
        }),
      );
    });
  }

  private typed(e: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    const a = animate(e, frames, opts);
    this.typeAnims.push(a);
    return a;
  }

  private appear(e: Element, delay: number, frames: number = W.unitFadeFrames) {
    return this.typed(e, [{ opacity: 0 }, { opacity: 1 }], { duration: fr(frames), delay, easing: 'linear' });
  }

  /** Measured open: a full-width line, stepped height 23 / 61 / 61 / 100 % in 33 ms steps, a 3-frame glitch on the
   * frame, then the Lantern types: title per character, body per word (per line when long). A tap completes it. */
  async open() {
    if (this.gone) return;
    const kind = this.spec.kind ?? 'notification';
    this.reduced = params.reduced || this.root.classList.contains('dq-sw--still');
    this.root.style.visibility = 'visible';
    windowSounds.open?.(kind);
    this.listen();
    this.offMotion = onMotion(() => this.setStill(params.reduced || this.root.classList.contains('dq-sw--still')));
    let hookAt = 0;
    const ctx: RevealCtx = {
      root: this.root,
      reduced: this.reduced,
      animate: (e, f, o) => this.typed(e, f, { ...o, delay: hookAt + Number(o.delay ?? 0) }),
      cue: (ms, fn) => this.cue(hookAt + ms, fn),
    };
    const rolls = Array.from(this.root.querySelectorAll<HTMLElement>('.sw-roll')).map(buildRoll);
    const acts = this.root.querySelector<HTMLElement>('.sw-actions');
    if (this.reduced) {
      this.spec.reveal?.(ctx);
      for (const r of rolls) r.oldN.style.opacity = '0';
      // the one fade is the whole opening: a press during it completes it, like a tap while the Lantern types
      const shown = this.typed(this.root, [{ opacity: 0 }, { opacity: 1 }], { duration: W.reducedFadeMs, easing: css(EASE.outCubic) });
      if (acts) inertUntil(acts, finished(shown));
      return this.typeOut(W.reducedFadeMs);
    }

    // 1. stepped height open (frames 0, 2, 4, 6, 8)
    const h = this.plate.offsetHeight;
    const steps = W.openSteps.map((s, i) => (i === 0 ? Math.max(W.lineMinPx / h, s) : s));
    const D = fr(W.openStepFrames * (steps.length - 1));
    // each step changes a quarter frame before its frame boundary, so rounding to the display's frames never shows a
    // step for one frame instead of two
    const lead = fr(W.openStepLeadFrames) / D;
    const stepped = (vals: number[], key: (v: number) => Keyframe): Keyframe[] => [
      ...vals.map((v, i) => ({ ...key(v), offset: i && i / (vals.length - 1) - lead, easing: 'steps(1, end)' })),
      { ...key(vals[vals.length - 1]), offset: 1 },
    ];
    animate(this.plate, stepped(steps, (s) => ({ clipPath: `inset(${((1 - s) / 2) * 100}% -2px ${((1 - s) / 2) * 100}% -2px)` })), { duration: D, easing: 'linear' });
    const ys = steps.map((s) => ((1 - s) * h) / 2);
    const [bt, bb] = this.bars;
    animate(bt, stepped(ys, (y) => ({ transform: `translateY(${y}px)` })), { duration: D, easing: 'linear' });
    animate(bb, stepped(ys, (y) => ({ transform: `translateY(${-y}px)` })), { duration: D, easing: 'linear' });
    this.startPlasma();

    // 2. glitch-in on the frame only: slices shift each frame, bars twitch sideways, a decaying cyan wash
    const G = W.glitchFrames;
    const gDur = fr(G);
    const per = (vals: readonly number[], f: (v: number) => Keyframe, end: Keyframe) => [...vals.map((v, i) => ({ ...f(v), offset: i / G, easing: 'steps(1, end)' })), { ...end, offset: 1 }];
    this.slices.forEach((s, i) => {
      const xs = W.glitchSliceShiftPx.map((row) => row[i]);
      animate(s, per(xs, (x) => ({ opacity: 1, transform: `translateX(${x}px)` }), { opacity: 0, transform: `translateX(${xs[G - 1]}px)` }), { duration: gDur, delay: D, fill: 'forwards' });
    });
    for (const b of this.bars)
      for (const part of b.querySelectorAll('.core, svg'))
        animate(part, per(W.glitchBarShiftPx, (x) => ({ transform: `translateX(${x}px)` }), { transform: 'translateX(0px)' }), { duration: gDur, delay: D, fill: 'forwards' });
    animate(this.wash, per(W.washByFrame, (o) => ({ opacity: o }), { opacity: 0 }), { duration: gDur, delay: D, fill: 'forwards' });

    // 3. typing schedule (ms from now)
    const chipAt = D + fr(G - 1);
    const chipBoxes = this.root.querySelectorAll('.sw-icon, .sw-title');
    chipBoxes.forEach((b) => this.appear(b, chipAt, W.chipFadeFrames));
    const title = this.root.querySelector('.sw-title')!;
    const body = this.root.querySelector('.sw-body')!;
    const rows = Array.from(body.querySelectorAll('.sw-row'));
    const titleUnits = collectUnits(title.parentElement!, []).filter((u) => title.contains(u.els[0]));
    titleUnits.forEach((u, i) => u.els.forEach((e) => this.appear(e, chipAt + i * W.titleCharMs, 1)));
    let at = chipAt + titleUnits.length * W.titleCharMs * W.bodyOverlap;
    hookAt = D;
    const hookMs = this.spec.reveal?.(ctx);
    if (typeof hookMs === 'number') at = Math.max(at, D + hookMs);
    const units = collectUnits(body, rows);
    const words = units.filter((u) => u.kind === 'word').length;
    const lineMode = words > W.bodyWordModeMax;
    const cues: [number, WindowCue, number?][] = [];
    const rowCued = new Set<number>();
    let lastTop = NaN;
    let rollIdx = 0;
    let bigEnd = 0;
    for (const u of units) {
      if (u.kind === 'char') {
        u.els.forEach((e) => this.appear(e, at, 1));
        at += W.titleCharMs;
        if (u.els[0].parentElement?.closest('.sw-big')) bigEnd = at;
      } else if (u.kind === 'roll') {
        const r = rolls[rollIdx++];
        this.appear(r.oldN, at);
        const rollAt = at + fr(W.unitFadeFrames) + LEVEL.rollHoldMs;
        const opts: KeyframeAnimationOptions = { duration: LEVEL.rollMs, delay: rollAt, easing: css(LEVEL.rollEase), fill: 'forwards' };
        // the clip box exists only while the numbers travel, so the settled glow is never cut
        this.typed(r.box, [{ clipPath: 'inset(0 -40%)' }, { clipPath: 'inset(0 -40%)' }], { duration: LEVEL.rollMs, delay: rollAt, fill: 'none' });
        this.typed(r.oldN, [{ transform: 'translateY(0%)', opacity: 1 }, { transform: 'translateY(-105%)', opacity: 1, offset: 0.999 }, { transform: 'translateY(-105%)', opacity: 0 }], opts);
        this.typed(r.newN, [{ transform: 'translateY(105%)', opacity: 1 }, { transform: 'translateY(0%)', opacity: 1 }], opts);
        const land = rollAt + LEVEL.rollMs;
        this.typed(r.glow, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], { duration: LEVEL.glowSettleMs, delay: land - fr(1), easing: css(EASE.outCubic) });
        cues.push([land, 'land']);
        at = land + fr(LEVEL.rowsDelayFrames);
      } else {
        if (u.row !== undefined && !rowCued.has(u.row)) {
          rowCued.add(u.row);
          cues.push([at, 'row', u.row]);
        }
        if (lineMode) {
          const top = Math.round((u.els[0] as HTMLElement).getBoundingClientRect().top);
          if (!Number.isNaN(lastTop) && Math.abs(top - lastTop) > 4) at += W.bodyLineMs;
          lastTop = top;
          u.els.forEach((e) => this.appear(e, at));
        } else {
          u.els.forEach((e) => this.appear(e, at));
          at += W.bodyWordMs;
        }
      }
    }
    if (lineMode) at += W.bodyLineMs;
    if (!rolls.length && bigEnd) cues.push([bigEnd, 'land']);
    if (acts) {
      at += fr(W.actionsDelayFrames);
      // a press where a button hasn't shown yet finishes the typing instead of pressing it
      inertUntil(acts, finished(this.typed(acts, [{ opacity: 0 }, { opacity: 1 }], { duration: W.actionsFadeMs, delay: at, easing: css(EASE.outCubic) })));
      at += W.actionsFadeMs;
    }
    for (const [t, c, i] of cues) this.cue(t, () => this.spec.onCue?.(c, i));

    // 4. a tap (or Enter / Space) while the Lantern types completes the text at once
    return this.typeOut(at);
  }

  /** The opening lasts `ms` and until it is really on screen: every animation of it has finished on the frames drawn,
   *  a reveal's own ones included, so a tap before then completes it however late the frames come. */
  private async typeOut(ms: number) {
    this.typing = true;
    const skipped = new Promise<void>((r) => (this.skipRes = r));
    await Promise.race([Promise.all([after(ms), ...this.typeAnims.map((a) => finished(a).catch(() => undefined))]), skipped]);
    this.endTyping();
  }

  private cue(ms: number, fn: () => void) {
    after(ms).then(() => this.typing && fn());
  }

  /** Taps and Enter / Space from open to close: one completes the typing, or answers a tap-to-continue window. */
  private listen() {
    this.offInput ??= onTaps((tap) => {
      if (this.typing) return this.skipTyping();
      if (!this.spec.tapToContinue) return;
      if (tap) windowSounds.tap?.();
      this.answer('tap');
    });
  }

  /** Completes the typed text now (a tap while the Lantern types). */
  skipTyping() {
    if (!this.typing) return;
    for (const a of this.typeAnims) complete(a);
    this.endTyping();
  }

  private endTyping() {
    if (!this.typing) return;
    this.typing = false;
    this.skipRes?.();
    this.spec.onCue?.('typed');
    if (!this.spec.tapToContinue || !this.root.isConnected) return;
    this.waiting = true;
    this.arrow();
  }

  /** The arrow that waits for a tap: pulsing, or steady while motion is off. */
  private arrow() {
    this.pulse?.cancel();
    this.pulse = null;
    this.next.style.opacity = this.reduced ? '0.85' : '';
    if (!this.reduced) this.pulse = animate(this.next, [{ opacity: W.nextPulseLow }, { opacity: 1 }], { duration: W.nextPulseMs, iterations: Infinity, direction: 'alternate', easing: css(EASE.inOutSine) });
  }

  /** Motion turned off or on while the window is up: the plasma along its bars and the waiting arrow follow at once. */
  setStill(still: boolean) {
    if (this.gone || still === this.reduced) return;
    this.reduced = still;
    this.plasmaAnims.forEach((a) => a.cancel());
    this.plasmaAnims = [];
    this.startPlasma();
    if (this.waiting) this.arrow();
  }

  /** Answers the wait for input. One that comes while the window still opens, before anyone waits, is kept for
   *  waitForInput and completes the typing, so the opener moves on at once and the tap is never lost. */
  private answer(v: string) {
    if (this.resolveTap) return this.resolveTap(v);
    this.early ??= v;
    this.skipTyping();
  }

  /** Resolves with an action value (also one tapped before this call, while the window opened), or 'tap' on any tap
   *  when tapToContinue; or 'timeout'; or 'dismissed' once the window is gone, even after such a tap. */
  waitForInput(timeoutSec = 0): Promise<string> {
    const early = this.early;
    this.early = null;
    if (this.gone) return Promise.resolve(DISMISSED);
    if (early !== null) return Promise.resolve(early);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: string) => {
        if (done) return;
        done = true;
        this.resolveTap = null;
        resolve(v);
      };
      this.resolveTap = finish;
      if (timeoutSec > 0) wait(timeoutSec).then(() => finish('timeout'));
    });
  }

  /** Measured close: one frame at scale .85 with a soft wash, 167 ms collapse to a bright bar, the bar fades. */
  async close() {
    if (this.gone) return;
    this.offInput?.();
    this.skipTyping();
    windowSounds.close?.();
    const h = this.plate.offsetHeight;
    if (this.reduced) {
      animate(this.root, [{ opacity: 1 }, { opacity: 0 }], { duration: W.reducedCloseMs, easing: css(EASE.outCubic) });
      await after(W.reducedCloseMs);
      this.destroy();
      return;
    }
    const ease = css(EASE.collapse);
    const flash = fr(1) / W.closeMs;
    animate(this.wash, [{ opacity: W.closeWash }, { opacity: W.closeWash, offset: flash }, { opacity: 0, offset: flash * 2 }, { opacity: 0 }], { duration: W.closeMs, easing: 'linear' });
    animate(this.plate, [{ clipPath: 'inset(0% -2px 0% -2px)', opacity: 1 }, { clipPath: 'inset(49% -2px 49% -2px)', opacity: 0.6 }], { duration: W.closeMs, easing: ease });
    const [bt, bb] = this.bars;
    animate(bt, [{ transform: 'translateY(0)' }, { transform: `translateY(${h / 2}px)` }], { duration: W.closeMs, easing: ease });
    animate(bb, [{ transform: 'translateY(0)' }, { transform: `translateY(${-h / 2}px)` }], { duration: W.closeMs, easing: ease });
    const rx = `rotateX(${W.tiltDeg}deg)`;
    const [sx, sy] = W.closeEndScale;
    animate(this.tilt, [{ transform: `${rx} scale(1)` }, { transform: `${rx} scale(${W.closeFlashScale})`, offset: flash, easing: 'linear' }, { transform: `${rx} scale(${sx},${sy})` }], { duration: W.closeMs, easing: 'linear' });
    const fadeAt = W.closeMs + W.closeBarHoldMs;
    animate(this.root, [{ opacity: 1 }, { opacity: 0 }], { duration: W.closeFadeMs, delay: fadeAt, easing: css(EASE.outCubic) });
    await after(fadeAt + W.closeFadeMs);
    this.destroy();
  }

  dismiss() {
    const answer = this.resolveTap;
    this.destroy();
    answer?.(DISMISSED);
  }

  /** Ends the wait for input as dismissed (Back, Escape) and leaves the window up for the usual close. */
  cancel() {
    this.answer(DISMISSED);
  }

  destroy() {
    live.delete(this);
    this.gone = true;
    this.offInput?.();
    this.offMotion?.();
    this.typing = false;
    this.skipRes?.();
    this.typeAnims.forEach((a) => a.cancel());
    this.plasmaAnims.forEach((a) => a.cancel());
    this.pulse?.cancel();
    this.root.remove();
  }
}

/** Body of the LEVEL window: a small typed label over the numeral, which rolls up from the previous level. */
export function levelBody(big: string, rows: [string, string][], footer: string) {
  const m = /^level\s+(\d+)$/i.exec(big.trim());
  const head = m
    ? `<div class="sw-lv"><div class="sw-lv-label sw-chars">Level</div><div class="sw-lv-num"><span class="sw-roll" data-from="${Number(m[1]) - 1}">${m[1]}</span></div></div>`
    : `<div class="sw-big">${big}</div>`;
  const rowHtml = rows.map(([k, v]) => `<div class="sw-row"><span class="k">${k}</span><span class="v">[${v}]<span class="up">▲</span></span></div>`).join('');
  return `${head}<div class="sw-rows">${rowHtml}</div><p class="center sw-foot">${footer}</p>`;
}

export function lanternLayer() {
  let layer = document.querySelector<HTMLDivElement>('.sw-layer');
  if (!layer) {
    layer = el('div', 'sw-layer') as HTMLDivElement;
    document.getElementById('ui')!.append(layer);
  }
  return layer;
}

/** Convenience: open, wait for input, close. */
export async function lanternMessage(spec: WindowSpec, opts: { hold?: number; timeout?: number } = {}) {
  const w = new LanternWindow(lanternLayer(), spec);
  await w.open();
  let v = 'auto';
  if (spec.tapToContinue || spec.actions?.length) v = await w.waitForInput(opts.timeout ?? 0);
  else await wait(opts.hold ?? 3);
  await w.close();
  return v;
}
