/**
 * Guided-practice widgets. Every visual is a pure function of elapsed time from clock.onFrame, so they pause,
 * seek and capture cleanly. Reduced motion keeps the pacing (numbers, words, fades) and drops movement.
 */
import type { Skill, Visual } from '../content/dbt';
import { hasScene, mountScene, type Beat } from '../scene/vignettes/host';
import { onFrame, now } from './clock';
import { btn, h, typo } from './ui';

const LN = 'fill="none" stroke="#a9dcff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const MINT = 'fill="none" stroke="#89cf9d" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const fluff = (x0: number, y: number, n: number, r: number, step: number) => Array.from({ length: n }, (_, i) => `<circle cx="${x0 + i * step}" cy="${y + (i % 2 ? 2 : -1.5)}" r="${r}"/>`).join('');
const mitten = (tx: number, rot: number, flip = false) =>
  `<g transform="translate(${tx} 6) rotate(${rot} 40 60)${flip ? ' translate(84 0) scale(-1 1)' : ''}">` +
  `<path d="M21 76 C12 54 12 26 30 17 C43 11 58 18 59 35 L61 47 C67 38 78 40 78 51 C78 60 70 68 63 75 L62 80 Z" fill="rgba(79,184,255,.12)" stroke="#bfe6ff" stroke-width="1.6" stroke-linejoin="round"/>` +
  `<path d="M28 34 Q37 28 46 34 M26 47 Q37 41 48 47 M26 60 Q37 54 48 60" fill="none" stroke="rgba(190,230,255,.34)" stroke-width="1.2" stroke-linecap="round"/>` +
  `<g fill="#3d6d58">${fluff(15, 84, 8, 7.2, 6.8)}</g><g fill="#a6dcb6">${fluff(16, 80, 8, 6.2, 6.6)}</g><g fill="#dcf3e3" opacity=".9">${fluff(19, 78, 7, 3.4, 7.2)}</g>` +
  `</g>`;
const ART: Record<NonNullable<Skill['art']>, string> = {
  mittens:
    `<radialGradient id="caw" cx="50%" cy="58%" r="50%"><stop offset="0" stop-color="#c9a45c" stop-opacity=".22"/><stop offset="1" stop-color="#c9a45c" stop-opacity="0"/></radialGradient>` +
    `<ellipse cx="100" cy="66" rx="88" ry="54" fill="url(#caw)"/>${mitten(14, -12)}${mitten(102, 12, true)}`,
  lobby:
    `<path d="M70 104 V30 a30 30 0 0 1 60 0 V104" ${LN}/><path d="M78 104 V34 a22 22 0 0 1 44 0 V104" fill="rgba(79,184,255,.12)" stroke="rgba(169,220,255,.45)" stroke-width="1.2"/>` +
    `<path d="M40 104 H160" ${LN} stroke-opacity=".6"/><path d="M92 70 h22 m-8 -8 l8 8 l-8 8" ${MINT}/>`,
  heal:
    `<path d="M100 14 L142 38 V86 L100 110 L58 86 V38 Z" fill="rgba(137,207,157,.08)" ${MINT}/>` +
    `<path d="M100 44 V80 M82 62 H118" fill="none" stroke="#c9f0d4" stroke-width="5" stroke-linecap="round"/>`,
  scroll:
    `<path d="M50 28 H140 a10 10 0 0 1 0 20 H60 M60 28 a10 10 0 0 0 0 20 V96 H150 a10 10 0 0 0 0 -20 V38" ${LN}/>` +
    `<path d="M74 60 q8 -8 16 0 t16 0 t16 0 M74 76 q6 -6 12 0 t12 0" fill="none" stroke="#c9a45c" stroke-width="1.5" stroke-linecap="round"/>`,
  tier: [['S', 22, '#c9a45c', 92], ['A', 52, '#89cf9d', 64], ['B', 82, '#a9dcff', 40]]
    .map(([t, y, c, w]) => `<rect x="54" y="${y}" width="22" height="22" fill="none" stroke="${c}" stroke-width="1.5"/><text x="65" y="${Number(y) + 16}" text-anchor="middle" font-family="Bodoni Moda, serif" font-size="15" fill="${c}">${t}</text><rect x="84" y="${Number(y) + 5}" width="${w}" height="12" rx="2" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-opacity=".6"/>`)
    .join(''),
  air: `<rect x="56" y="18" width="88" height="88" rx="4" ${LN} stroke-opacity=".7"/><path d="M100 18 V106 M56 62 H144" fill="none" stroke="rgba(169,220,255,.35)" stroke-width="1.2"/><path d="M30 46 h70 q14 0 14 -10 t-12 -8 M24 66 h108 q14 0 14 10 t-12 8 M40 86 h50" ${MINT}/>`,
  volume:
    `<path d="M44 50 h16 l20 -18 v60 l-20 -18 h-16 z" fill="rgba(79,184,255,.1)" ${LN}/>` +
    [0, 1, 2, 3, 4].map((i) => `<rect x="${98 + i * 14}" y="${30 + i * 10}" width="8" height="${64 - i * 10}" rx="2" fill="#4fb8ff" fill-opacity="${(0.55 - i * 0.09).toFixed(2)}"/>`).join(''),
  supplies: `<path d="M74 26 H126 L118 104 H82 Z" fill="rgba(79,184,255,.08)" ${LN}/><path d="M78 56 q11 6 22 0 t22 0 L118 104 H82 Z" fill="rgba(79,184,255,.18)" stroke="none"/><path d="M146 40 q8 12 0 20 q-8 -8 0 -20 z" ${MINT}/>`,
  queue: `<rect x="50" y="26" width="100" height="72" rx="10" ${LN}/><path d="M92 46 L116 62 L92 78 Z" fill="rgba(137,207,157,.2)" ${MINT}/><path d="M64 108 h72" ${LN} stroke-opacity=".5"/>`,
  lowlight: `<path d="M118 22 a32 32 0 1 0 22 46 a26 26 0 1 1 -22 -46 z" fill="rgba(79,184,255,.08)" ${LN}/><path d="M36 100 H164" ${LN} stroke-opacity=".55"/><path d="M60 92 q20 -8 50 0" ${MINT} stroke-opacity=".8"/>`,
};
/** Small line-art badge for a skill's intro (Warm Hands gets the fluffy mittens). */
export function loadoutArt(id: Skill['art']) {
  return id ? `<svg viewBox="0 0 200 120" width="200" height="120" aria-hidden="true">${ART[id]}</svg>` : '';
}

export interface Ctx {
  sound(cue: string): void;
  reduced(): boolean;
}

const NS = 'http://www.w3.org/2000/svg';
const sv = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
const arcPath = (r: number, frac: number, cx = 100, cy = 100) => {
  const f = Math.min(0.9999, Math.max(0, frac));
  if (f <= 0) return '';
  const a = -Math.PI / 2 + f * Math.PI * 2;
  const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
  return `M${cx} ${cy - r}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
};
let gid = 0;
/** Writes text only when it changes, so per-frame updates do not force layout. */
const put = (el: HTMLElement, v: string) => {
  if (el.textContent !== v) el.textContent = v;
};

function ringBase(svg: SVGSVGElement, ticks = true) {
  const defs = sv('defs');
  const id = `dqg${++gid}`;
  const grad = sv('radialGradient', { id, cx: '50%', cy: '50%', r: '50%' });
  grad.append(sv('stop', { offset: '0', 'stop-color': '#4fb8ff', 'stop-opacity': '0.28' }), sv('stop', { offset: '0.7', 'stop-color': '#1f6df3', 'stop-opacity': '0.08' }), sv('stop', { offset: '1', 'stop-color': '#1f6df3', 'stop-opacity': '0' }));
  defs.append(grad);
  svg.append(defs);
  svg.append(sv('circle', { cx: 100, cy: 100, r: 92, fill: 'none', stroke: 'rgba(125,150,197,.28)', 'stroke-width': 1 }));
  if (ticks) {
    let d = '';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, r1 = i % 6 === 0 ? 82 : 85.5, r2 = 89;
      d += `M${(100 + Math.cos(a) * r1).toFixed(2)} ${(100 + Math.sin(a) * r1).toFixed(2)}L${(100 + Math.cos(a) * r2).toFixed(2)} ${(100 + Math.sin(a) * r2).toFixed(2)}`;
    }
    svg.append(sv('path', { d, stroke: 'rgba(150,200,240,.38)', 'stroke-width': 1.2, 'stroke-linecap': 'round' }));
  }
  return id;
}

/** Paced breathing: orb grows on the in-breath, shrinks on the longer out-breath. */
export function breathRing(ctx: Ctx, opts: { inhale: number; exhale: number; rounds: number; words?: [string, string]; onRounds?: () => void }) {
  let inhale = opts.inhale, exhale = opts.exhale;
  const svg = sv('svg', { viewBox: '0 0 200 200', class: 'dq-ring-svg', 'aria-hidden': 'true' }) as SVGSVGElement;
  const gradId = ringBase(svg);
  const orb = sv('circle', { cx: 100, cy: 100, r: 50, fill: `url(#${gradId})` });
  const orbLine = sv('circle', { cx: 100, cy: 100, r: 50, fill: 'none', stroke: 'rgba(170,225,255,.75)', 'stroke-width': 1.3 });
  const arc = sv('path', { d: '', fill: 'none', stroke: '#4fb8ff', 'stroke-width': 2, 'stroke-linecap': 'round', class: 'dq-arc' });
  svg.append(orb, orbLine, arc);
  const word = h('div', { class: 'dq-ring-word', 'aria-live': 'polite' });
  const count = h('div', { class: 'dq-ring-count' });
  const round = h('div', { class: 'dq-ring-round' });
  const el = h('div', { class: 'dq-ring' }, h('div', { class: 'dq-ring-stage' }, svg, h('div', { class: 'dq-ring-center' }, word, count)), round);
  let t0 = now();
  let lastPhase = '';
  let roundsDone = false;
  const tick = (t: number) => {
    const cyc = inhale + exhale;
    const e = Math.max(0, t - t0);
    const n = Math.floor(e / cyc);
    const inC = e - n * cyc;
    const inPhase = inC < inhale;
    const pp = inPhase ? inC / inhale : (inC - inhale) / exhale;
    const s = inPhase ? ease(pp) : 1 - ease(pp);
    const phase = `${n}${inPhase ? 'i' : 'o'}`;
    if (phase !== lastPhase) {
      lastPhase = phase;
      word.textContent = opts.words ? (inPhase ? opts.words[0] : opts.words[1]) : inPhase ? 'Breathe in' : 'Breathe out';
      ctx.sound(inPhase ? 'breath_in' : 'breath_out');
    }
    const left = Math.ceil((inPhase ? inhale : exhale) * (1 - pp));
    put(count, String(Math.max(1, left)));
    const still = ctx.reduced();
    const r = still ? 58 : 40 + s * 34;
    orb.setAttribute('r', String(r + 8));
    orbLine.setAttribute('r', String(r));
    orbLine.setAttribute('stroke-opacity', String(still ? 0.45 + s * 0.5 : 0.75));
    orb.setAttribute('opacity', String(still ? 0.4 + s * 0.6 : 1));
    arc.setAttribute('d', arcPath(78, pp));
    arc.setAttribute('stroke', inPhase ? '#4fb8ff' : '#89b9ff');
    const done = n >= opts.rounds;
    put(round, done ? 'Rounds done. Keep breathing as long as you like.' : `Round ${Math.min(opts.rounds, n + 1)} of ${opts.rounds}`);
    if (done && !roundsDone) {
      roundsDone = true;
      opts.onRounds?.();
    }
  };
  const stop = onFrame(tick);
  tick(now());
  return {
    el,
    stop,
    pattern(i: number, o: number) {
      inhale = i;
      exhale = o;
      t0 = now();
      lastPhase = '';
    },
  };
}

function palm(x: number, flip: boolean) {
  const g = sv('g', { transform: `translate(${x} 0) scale(${flip ? -1 : 1} 1)` });
  g.append(
    sv('path', {
      d: 'M-18 112C-20 98 -16 84 -10 80L-10 60Q-10 55 -6 55Q-2 55 -2 60L-2 76L-1 52Q-1 47 3 47Q7 47 7 52L7 76L9 55Q9 50 13 50Q17 50 17 55L16 79L20 66Q21 62 25 63Q28 64 27 68L22 92C20 104 14 112 4 114Z',
      fill: 'rgba(79,184,255,.08)',
      stroke: 'rgba(170,225,255,.7)',
      'stroke-width': 1.3,
      'stroke-linejoin': 'round',
    }),
  );
  return g;
}

function frost() {
  const g = sv('g', { stroke: 'rgba(200,235,255,.85)', 'stroke-width': 1.6, 'stroke-linecap': 'round', fill: 'none' });
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(a), s = Math.sin(a);
    const p = (r: number) => [100 + c * r, 100 + s * r];
    const [x1, y1] = p(30);
    d += `M100 100L${x1.toFixed(1)} ${y1.toFixed(1)}`;
    for (const r of [14, 22]) {
      const [bx, by] = p(r);
      for (const sg of [-1, 1]) {
        const a2 = a + sg * 0.62;
        d += `M${bx.toFixed(1)} ${by.toFixed(1)}l${(Math.cos(a2) * 7).toFixed(1)} ${(Math.sin(a2) * 7).toFixed(1)}`;
      }
    }
  }
  g.append(sv('path', { d }));
  return g;
}

/**
 * Countdown with an optional visual. Waits for a tap when `start` is given; that tap brings `reveal` (the countdown
 * unless the caller names something further down) into view if it isn't, stopping clear of anything pinned.
 */
export function timerView(ctx: Ctx, opts: { seconds: number; visual?: Visual; start?: string; extend?: number; big?: string; extra?: HTMLElement[]; peers?: HTMLElement[]; reveal?: HTMLElement; onStart?: () => void; onDone: () => void }) {
  let dur = opts.seconds;
  const visual = opts.visual ?? 'ring';
  const wide = visual === 'wave';
  const svg = sv('svg', { viewBox: wide ? '0 0 320 160' : '0 0 200 200', class: `dq-timer-svg dq-timer-svg--${visual}`, 'aria-hidden': 'true' }) as SVGSVGElement;
  const parts: Record<string, SVGElement> = {};
  if (!wide) {
    const gradId = ringBase(svg, visual !== 'drift' && visual !== 'tide');
    parts.orb = sv('circle', { cx: 100, cy: 100, r: 60, fill: `url(#${gradId})` });
    if (hasScene(visual)) parts.orb.classList.add('dq-scene-flat');
    svg.append(parts.orb);
    parts.track = sv('circle', { cx: 100, cy: 100, r: 78, fill: 'none', stroke: 'rgba(125,150,197,.18)', 'stroke-width': 2 });
    parts.arc = sv('path', { d: '', fill: 'none', stroke: visual === 'cold' ? '#bfe9ff' : '#4fb8ff', 'stroke-width': 2, 'stroke-linecap': 'round' });
    svg.append(parts.track, parts.arc);
  }
  if (visual === 'drift') {
    const clip = `dqc${++gid}`;
    const cp = sv('clipPath', { id: clip });
    cp.append(sv('circle', { cx: 100, cy: 100, r: 70 }));
    svg.append(cp);
    const water = sv('g', { 'clip-path': `url(#${clip})`, class: 'dq-scene-flat' });
    water.append(sv('path', { d: 'M20 158Q60 146 100 152T180 150V200H20Z', fill: 'rgba(137,180,220,.14)' }));
    parts.rays = sv('g', { stroke: 'rgba(170,215,255,.12)', 'stroke-width': 1 });
    for (let i = 0; i < 5; i++) parts.rays.append(sv('path', { d: `M${50 + i * 25} 20L${40 + i * 25} 170` }));
    parts.stone = sv('ellipse', { cx: 100, cy: 50, rx: 9, ry: 5.5, fill: '#2a3a52', stroke: 'rgba(190,225,255,.6)', 'stroke-width': 1 });
    water.append(parts.rays, parts.stone);
    svg.append(water);
  } else if (visual === 'tide') {
    parts.tide = sv('g', { fill: 'none', 'stroke-linecap': 'round' });
    for (let i = 0; i < 4; i++) parts.tide.append(sv('path', { d: '', stroke: `rgba(150,205,255,${0.6 - i * 0.12})`, 'stroke-width': 1.4 }));
    svg.append(parts.tide);
  } else if (visual === 'wave') {
    parts.wave = sv('path', { d: '', fill: 'rgba(79,184,255,.1)', stroke: 'rgba(160,215,255,.8)', 'stroke-width': 1.6 });
    parts.wave2 = sv('path', { d: '', fill: 'none', stroke: 'rgba(160,215,255,.25)', 'stroke-width': 1 });
    parts.board = sv('g');
    parts.board.append(sv('rect', { x: -13, y: -3, width: 26, height: 5, rx: 2.5, fill: '#cfe9ff' }), sv('circle', { cx: 0, cy: -8, r: 3.2, fill: '#89cf9d' }));
    svg.append(parts.wave2, parts.wave, parts.board);
  } else if (visual === 'hands') {
    const g = sv('g', { transform: 'translate(0 -8)' });
    g.append(palm(78, true), palm(122, false));
    svg.append(g);
  } else if (visual === 'cold') {
    svg.append(frost());
  }
  const num = h('div', { class: 'dq-timer-num' });
  const big = opts.big ? h('p', { class: 'dq-timer-big', text: typo(opts.big) }) : null;
  const stageEl = h('div', { class: `dq-timer-stage ${wide ? 'is-wide' : ''}` }, svg, h('div', { class: 'dq-timer-center' }, num));
  const peers = opts.peers ?? [];
  const extra = [...(opts.extra ?? []), ...peers];
  const actions = h('div', { class: `dq-actions dq-actions--center ${peers.length ? 'dq-actions--pair' : ''}` });
  const el = h('div', { class: `dq-timer ${peers.length ? 'dq-timer--peers' : ''}` }, big, peers.length ? actions : null, stageEl, peers.length ? null : actions);
  let t0 = -1;
  let stop: (() => void) | null = null;
  let finished = false;
  // a visual with a 3D scene follows this countdown: the scene ticks only when the timer renders, with its beat
  const ticks = new Set<(t: number) => void>();
  let beat: Beat = { e: 0, dur, started: false, done: false };
  const unmount = hasScene(visual)
    ? mountScene(stageEl, {
        kind: visual,
        reduced: () => ctx.reduced(),
        clock: {
          now,
          onFrame: (fn) => {
            ticks.add(fn);
            return () => void ticks.delete(fn);
          },
          beat: () => beat,
        },
      })
    : null;
  // whole seconds left, rounded up all the way down, so no second shows twice ("1:00" then "60")
  const fmt = (s: number) => {
    const c = Math.ceil(s);
    return c >= 60 ? `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}` : String(c);
  };
  const render = (t: number) => {
    const e = t0 < 0 ? 0 : t - t0;
    const left = Math.max(0, dur - e);
    const p = Math.min(1, e / dur);
    const still = ctx.reduced();
    put(num, t0 < 0 ? fmt(dur) : left > 0 ? fmt(left) : 'Done');
    if (parts.arc) parts.arc.setAttribute('d', arcPath(78, 1 - p));
    if (parts.orb) {
      const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin((e / 10) * Math.PI * 2 - Math.PI / 2);
      parts.orb.setAttribute('r', String(visual === 'glow' ? 46 + pulse * 18 : 58));
      parts.orb.setAttribute('opacity', String(visual === 'glow' ? 0.55 + pulse * 0.45 : 0.6));
    }
    if (parts.stone) {
      const k = still ? p : 1 - Math.pow(1 - p, 1.6);
      parts.stone.setAttribute('cy', (48 + k * 98).toFixed(2));
      parts.stone.setAttribute('cx', (100 + (still ? 0 : Math.sin(e * 0.9) * 6 * (1 - p))).toFixed(2));
      parts.stone.setAttribute('transform', `rotate(${(still ? 0 : Math.sin(e * 0.7) * 14 * (1 - p)).toFixed(2)} 100 ${(48 + k * 98).toFixed(2)})`);
      parts.rays.setAttribute('transform', `translate(${still ? 0 : (Math.sin(e * 0.3) * 6).toFixed(2)} 0)`);
    }
    if (parts.tide) {
      const kids = Array.from(parts.tide.children);
      kids.forEach((c, i) => {
        const y = 82 + i * 14 + (still ? 0 : Math.sin(e * (Math.PI / 4) + i * 0.4) * 8);
        let d = '';
        for (let x = 30; x <= 170; x += 5) {
          const yy = y + (still ? 0 : Math.sin(x * 0.06 + e * 0.8 + i) * 3);
          d += `${x === 30 ? 'M' : 'L'}${x} ${yy.toFixed(2)}`;
        }
        c.setAttribute('d', d);
      });
    }
    if (parts.wave) {
      const amp = (still ? 0.3 : 0.22 + 0.78 * Math.pow(Math.sin(Math.PI * p), 1.1)) * 36 + 4;
      const ph = still ? 0 : e * 1.6;
      const yAt = (x: number) => 104 - amp * (0.75 + 0.25 * Math.sin(x * 0.012)) * Math.sin(x * 0.028 - ph) * 0.9 - amp * 0.35;
      let d = 'M0 160';
      for (let x = 0; x <= 320; x += 5) d += `L${x} ${yAt(x).toFixed(2)}`;
      d += 'L320 160Z';
      parts.wave.setAttribute('d', d);
      let d2 = '';
      for (let x = 0; x <= 320; x += 5) d2 += `${x ? 'L' : 'M'}${x} ${(yAt(x) + 14).toFixed(2)}`;
      parts.wave2.setAttribute('d', d2);
      const by = yAt(160), sl = (yAt(165) - yAt(155)) / 10;
      parts.board.setAttribute('transform', `translate(160 ${(by - 2).toFixed(2)}) rotate(${((Math.atan(sl) * 180) / Math.PI).toFixed(2)})`);
    }
    if (t0 >= 0 && left <= 0 && !finished) {
      finished = true;
      stop?.();
      stop = null;
      ctx.sound('check');
      opts.onDone();
    }
    beat = { e, dur, started: t0 >= 0, done: finished };
    ticks.forEach((f) => f(t));
  };
  const begin = () => {
    t0 = now();
    actions.replaceChildren(...extra);
    if (opts.extend) {
      actions.prepend(
        btn(`+${opts.extend} s`, () => {
          dur = Math.max(dur, now() - t0) + opts.extend!;
          if (finished) {
            // a finished timer runs again the way it first started (a dimmed timer dims again)
            finished = false;
            opts.onStart?.();
            stop = onFrame(render);
          }
        }, { kind: 'quiet' }),
      );
    }
    opts.onStart?.();
    stop = onFrame(render);
  };
  const tapped = () => {
    begin();
    (opts.reveal ?? stageEl).scrollIntoView({ block: 'nearest', behavior: ctx.reduced() ? 'auto' : 'smooth' });
  };
  if (opts.start) actions.append(btn(opts.start, tapped, { kind: 'primary' }), ...extra);
  else begin();
  render(now());
  return {
    el,
    stop: () => {
      stop?.();
      stop = null;
      unmount?.();
    },
    begin,
    started: () => t0 >= 0,
  };
}

/** Press and hold. Letting go early simply drains the ring back; nothing is lost. */
export function holdButton(ctx: Ctx, opts: { seconds: number; label: string; done: string; tone?: 'heal'; onDone: () => void }) {
  const heal = opts.tone === 'heal';
  const rgb = heal ? '137,207,157' : '79,184,255';
  const svg = sv('svg', { viewBox: '0 0 200 200', class: 'dq-hold-svg', 'aria-hidden': 'true' }) as SVGSVGElement;
  svg.append(sv('circle', { cx: 100, cy: 100, r: 78, fill: 'none', stroke: heal ? 'rgba(137,207,157,.28)' : 'rgba(125,150,197,.25)', 'stroke-width': 2 }));
  const arc = sv('path', { d: '', fill: 'none', stroke: heal ? '#89cf9d' : '#4fb8ff', 'stroke-width': heal ? 4 : 3, 'stroke-linecap': 'round' });
  const core = sv('circle', { cx: 100, cy: 100, r: 64, fill: `rgba(${rgb},.06)`, stroke: heal ? 'rgba(190,240,205,.4)' : 'rgba(170,225,255,.35)', 'stroke-width': 1 });
  svg.append(core, arc);
  const cross = heal ? sv('path', { d: 'M100 58V82M88 70H112', stroke: 'rgba(201,240,212,.22)', 'stroke-width': 6, 'stroke-linecap': 'round', fill: 'none', class: 'ca-heal-cross' }) : null;
  if (cross) svg.insertBefore(cross, arc);
  const label = h('span', { class: 'dq-hold-t', text: typo(opts.label) });
  const b = h('button', { type: 'button', class: `dq-hold ${heal ? 'ca-hold--heal' : ''}` }, svg, label);
  const hint = h('p', { class: 'dq-hint', 'aria-live': 'polite' });
  const el = h('div', { class: 'dq-hold-wrap' }, b, hint);
  let v = 0;
  let holding = false;
  let last = now();
  let done = false;
  let stop: (() => void) | null = null;
  const loop = (t: number) => {
    const dt = Math.min(0.1, t - last);
    last = t;
    v = Math.max(0, Math.min(1, v + (holding ? dt / opts.seconds : -dt / 1.2)));
    arc.setAttribute('d', arcPath(78, v));
    core.setAttribute('fill', `rgba(${rgb},${(0.06 + v * 0.22).toFixed(3)})`);
    cross?.setAttribute('stroke', `rgba(201,240,212,${(0.3 + v * 0.6).toFixed(3)})`);
    if (!ctx.reduced()) core.setAttribute('r', (64 - v * 6).toFixed(2));
    if (v >= 1 && !done) {
      done = true;
      holding = false;
      unwatch();
      label.textContent = typo(opts.done);
      b.classList.add('is-done');
      if (heal && !ctx.reduced()) b.classList.add('ca-healed');
      b.setAttribute('aria-pressed', 'true');
      hint.textContent = '';
      ctx.sound('check');
      stop?.();
      opts.onDone();
    }
    if (!holding && v <= 0 && stop) {
      stop();
      stop = null;
    }
  };
  const press = () => {
    if (done) return;
    holding = true;
    hint.textContent = '';
    last = now();
    stop ??= onFrame(loop);
    // a hold ends when the key or finger can no longer be on it: the window loses focus or the page is hidden
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', onHidden);
  };
  const unwatch = () => {
    window.removeEventListener('blur', release);
    window.removeEventListener('pagehide', release);
    document.removeEventListener('visibilitychange', onHidden);
  };
  const release = () => {
    unwatch();
    if (done || !holding) return;
    holding = false;
    if (v < 1) hint.textContent = 'Hold a little longer when you want. No rush.';
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') release();
  };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.setPointerCapture?.(e.pointerId);
    press();
  });
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('lostpointercapture', release);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      press();
    }
  });
  b.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') release();
  });
  // Tab or Shift+Tab mid-hold: the key comes up somewhere else, so focus leaving ends the hold
  b.addEventListener('blur', release);
  return {
    el,
    stop: () => {
      unwatch();
      stop?.();
    },
  };
}

/** Paired muscle relaxation: tighten on the in-breath (5 s), let go on the out-breath (10 s). */
export function pmrView(ctx: Ctx, opts: { rounds: number; onDone: () => void }) {
  const svg = sv('svg', { viewBox: '0 0 200 200', class: 'dq-ring-svg', 'aria-hidden': 'true' }) as SVGSVGElement;
  const gradId = ringBase(svg);
  const orb = sv('circle', { cx: 100, cy: 100, r: 50, fill: `url(#${gradId})` });
  const line = sv('circle', { cx: 100, cy: 100, r: 50, fill: 'none', stroke: 'rgba(170,225,255,.75)', 'stroke-width': 1.3 });
  svg.append(orb, line);
  const word = h('div', { class: 'dq-ring-word', 'aria-live': 'polite' });
  const count = h('div', { class: 'dq-ring-count' });
  const round = h('div', { class: 'dq-ring-round' });
  const el = h('div', { class: 'dq-ring' }, h('div', { class: 'dq-ring-stage' }, svg, h('div', { class: 'dq-ring-center' }, word, count)), round);
  const T = 5, R = 10, cyc = T + R;
  const t0 = now();
  let last = '';
  let finished = false;
  const tick = (t: number) => {
    const e = t - t0;
    const n = Math.floor(e / cyc);
    if (n >= opts.rounds) {
      if (!finished) {
        finished = true;
        word.textContent = 'Let it all drop';
        count.textContent = '';
        round.textContent = 'Rounds done.';
        stop();
        opts.onDone();
      }
      return;
    }
    const c = e - n * cyc;
    const tense = c < T;
    const pp = tense ? c / T : (c - T) / R;
    const key = `${n}${tense}`;
    if (key !== last) {
      last = key;
      word.textContent = tense ? 'Tighten' : 'Let it drop';
      ctx.sound(tense ? 'breath_in' : 'breath_out');
    }
    put(count, String(Math.max(1, Math.ceil((tense ? T : R) * (1 - pp)))));
    const s = tense ? ease(pp) : 1 - ease(pp);
    const still = ctx.reduced();
    const r = still ? 54 : 66 - s * 26;
    orb.setAttribute('r', String(r + 8));
    line.setAttribute('r', String(r));
    line.setAttribute('stroke', tense ? 'rgba(220,240,255,.9)' : 'rgba(150,205,255,.6)');
    orb.setAttribute('opacity', String(0.5 + s * 0.5));
    put(round, `Round ${n + 1} of ${opts.rounds}`);
  };
  const stop = onFrame(tick);
  tick(now());
  return { el, stop };
}

/** Tap to mark each thing noticed. */
export function counter(ctx: Ctx, opts: { n: number; label: string; onDone: () => void }) {
  let k = 0;
  const dots = Array.from({ length: opts.n }, () => h('span', { class: 'dq-dot' }));
  const status = h('span', { class: 'dq-sr', 'aria-live': 'polite' });
  const b = btn(opts.label, () => {
    if (k >= opts.n) return;
    dots[k].classList.add('is-on');
    k++;
    status.textContent = `${k} of ${opts.n}`;
    ctx.sound('bubble');
    if (k >= opts.n) {
      b.disabled = true;
      opts.onDone();
    }
  }, { kind: 'quiet' });
  return { el: h('div', { class: 'dq-counter' }, h('div', { class: 'dq-dots' }, dots), b, status) };
}
