/**
 * Code-drawn art for the companion. Every piece is crisp geometry (computed curves and offsets), no sketch filters.
 * seahorseSVG() is self-contained (own gradients and filters, unique ids, no CSS) so the cutscene can reuse it,
 * including rasterised into a texture via an <img> data URL.
 */
import type { ModuleId } from '../content/dbt';

type P = [number, number];
let svgN = 0;
const f = (n: number) => +n.toFixed(2);

function catmull(pts: P[], perSeg = 10): P[] {
  const out: P[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function interp(keys: [number, number, number][], s: number): [number, number] {
  if (s <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      const t = (s - a[0]) / (b[0] - a[0]);
      const e = t * t * (3 - 2 * t);
      return [a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
    }
  }
  const l = keys[keys.length - 1];
  return [l[1], l[2]];
}

/** Seahorse body: a spine (head to curled tail) with an asymmetric width profile (back, belly). */
function seahorseGeometry() {
  const body: P[] = [
    [50, 14.5],
    [51.6, 23.5],
    [46.4, 36],
    [45.6, 50],
    [50.4, 66],
    [51.6, 82],
    [47.6, 98],
    [42.2, 112],
  ];
  const c: P = [54.2, 120.5];
  const r0 = Math.hypot(42.2 - c[0], 113 - c[1]) * 0.98;
  const a0 = Math.atan2(113 - c[1], 42.2 - c[0]);
  const turns = 2.05 * Math.PI;
  const k = Math.log(r0 / 2.6) / turns;
  for (let i = 1; i <= 26; i++) {
    const d = (i / 26) * turns;
    const r = r0 * Math.exp(-k * d);
    const a = a0 - d;
    body.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  const pts = catmull(body, 9);
  const len: number[] = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = len[len.length - 1];
  // [arc length, back half-width, belly half-width]
  const W: [number, number, number][] = [
    [0, 5.4, 5.6],
    [6, 9.2, 9.8],
    [13, 7.8, 7.4],
    [23, 5.1, 4.6],
    [34, 6, 9.4],
    [48, 6.4, 13.6],
    [62, 6.2, 13.2],
    [77, 5.4, 8.4],
    [92, 4.1, 4.4],
    [114, 3.1, 3.1],
    [146, 1.9, 1.9],
    [L, 0.45, 0.45],
  ];
  const back: P[] = [], front: P[] = [], mid: P[] = [];
  const norms: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const n: P = [-ty, tx];
    const [wb, wf] = interp(W, len[i]);
    norms.push(n);
    back.push([pts[i][0] + n[0] * wb, pts[i][1] + n[1] * wb]);
    front.push([pts[i][0] - n[0] * wf, pts[i][1] - n[1] * wf]);
    mid.push(pts[i]);
  }
  return { pts, back, front, len, L, norms, W };
}

let geoCache: ReturnType<typeof seahorseGeometry> | null = null;

function polyPath(p: P[]) {
  return p.map((q, i) => `${i ? 'L' : 'M'}${f(q[0])} ${f(q[1])}`).join('');
}

export interface SeahorseOpts {
  size?: number;
  eye?: 'sleep' | 'open';
  glow?: boolean;
  /** 'shadow' (her first shadow, near-black with cold rim) or 'lilac' (her channel's seahorse colour) */
  tone?: 'shadow' | 'lilac';
  label?: string;
}

/** Her first shadow: a small sleeping shadow seahorse with a mint eye-light. Returns a standalone SVG string. */
export function seahorseSVG(opts: SeahorseOpts = {}) {
  const { size = 120, eye = 'sleep', glow = true, tone = 'shadow', label = 'A small shadow seahorse, asleep' } = opts;
  const g = (geoCache ??= seahorseGeometry());
  const id = `sh${++svgN}`;
  const { back, front, len, pts, norms, W } = g;
  // head cap: round from back[0] to front[0]
  const outline = `${polyPath(back)}${polyPath(front.slice().reverse()).replace(/^M/, 'L')}Q${f(pts[0][0] - 1)} ${f(pts[0][1] - 7)} ${f(back[0][0])} ${f(back[0][1])}Z`;
  // belly plates across the trunk and tail rings
  const plates: string[] = [];
  for (let s = 26; s < len[len.length - 1] - 8; s += s < 96 ? 5.2 : 6) {
    const i = len.findIndex((x) => x >= s);
    if (i < 0) break;
    const [wb, wf] = interp(W, s);
    const p = pts[i], n = norms[i];
    // belly plates run from the spine to the belly edge; tail rings go all the way round
    const from = s < 92 ? -0.15 : 0.75;
    plates.push(`M${f(p[0] + n[0] * wb * from)} ${f(p[1] + n[1] * wb * from)}L${f(p[0] - n[0] * wf * 0.86)} ${f(p[1] - n[1] * wf * 0.86)}`);
  }
  // dorsal fin on the back, between arc lengths 40 and 70
  const at = (s: number) => {
    const i = Math.max(0, len.findIndex((x) => x >= s));
    return { p: back[i], n: norms[i] };
  };
  const finA = at(38), finB = at(64);
  const finPts: P[] = [];
  const ribs: string[] = [];
  // rays fan out from a point inside the back; the edge is scalloped between ray tips
  const hub: P = [(finA.p[0] + finB.p[0]) / 2 + 3, (finA.p[1] + finB.p[1]) / 2];
  for (let k = 0; k <= 7; k++) {
    const { p } = at(38 + (k / 7) * 26);
    const dx = p[0] - hub[0], dy = p[1] - hub[1];
    const dl = Math.hypot(dx, dy) || 1;
    const h = Math.sin((k / 7) * Math.PI) * 6.2 + 0.8;
    const tip: P = [p[0] + (dx / dl) * h, p[1] + (dy / dl) * h];
    finPts.push(tip);
    if (k > 0 && k < 7) ribs.push(`M${f(p[0])} ${f(p[1])}L${f(tip[0])} ${f(tip[1])}`);
  }
  let fin = `M${f(finA.p[0])} ${f(finA.p[1])}L${f(finPts[0][0])} ${f(finPts[0][1])}`;
  for (let k = 1; k < finPts.length; k++) {
    const a = finPts[k - 1], b = finPts[k];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const ox = mx - hub[0], oy = my - hub[1], ol = Math.hypot(ox, oy) || 1;
    fin += `Q${f(mx - (ox / ol) * 1.1)} ${f(my - (oy / ol) * 1.1)} ${f(b[0])} ${f(b[1])}`;
  }
  fin += `L${f(finB.p[0])} ${f(finB.p[1])}Z`;
  const pecA = at(17).p;
  const pec = `M${f(pecA[0] + 0.5)} ${f(pecA[1] - 1)}q-6 1 -7.5 6.5q5 -0.6 8.2 -2.6z`;
  const snout = "M55.4 18.6C61 19.4 66.6 21.4 71.8 23.2L73.6 22.4Q76.2 25.8 73.8 29.4L72 28.6C66.6 28.2 61.4 28.6 56 29.4Z";
  const crown = "M45.2 15.8L46.2 9.2L48.6 13.8L50.8 7.6L52.8 13.2L55.2 9.4L55.8 16.2Z";
  const shade = tone === 'shadow' ? ['#1d2740', '#0c1120', '#070a14'] : ['#d8cdfd', '#c1b3fc', '#9a8ad8'];
  const rim = tone === 'shadow' ? '#4fb8ff' : '#efeaff';
  const plateCol = tone === 'shadow' ? 'rgba(126,160,220,0.16)' : 'rgba(90,70,160,0.28)';
  const eyeEl =
    eye === 'sleep'
      ? `<path d="M51.6 22.6Q54.2 25.4 56.8 22.6" fill="none" stroke="#89cf9d" stroke-width="1.45" stroke-linecap="round" filter="url(#${id}e)"/>`
      : `<circle cx="54.2" cy="23.4" r="2" fill="#89cf9d" filter="url(#${id}e)"/><circle cx="54.9" cy="22.7" r=".55" fill="#eafff1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150" width="${f(size * 0.667)}" height="${size}" role="img" aria-label="${label}">
<defs>
<linearGradient id="${id}b" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${shade[0]}"/><stop offset=".55" stop-color="${shade[1]}"/><stop offset="1" stop-color="${shade[2]}"/></linearGradient>
<linearGradient id="${id}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rim}"/><stop offset=".6" stop-color="#5a74ff"/><stop offset="1" stop-color="#7b3fe4" stop-opacity=".6"/></linearGradient>
<linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fb8ff" stop-opacity=".05"/><stop offset="1" stop-color="#4fb8ff" stop-opacity=".32"/></linearGradient>
<filter id="${id}g" x="-40%" y="-30%" width="180%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="3.4" result="b1"/><feFlood flood-color="#7b3fe4" flood-opacity=".5" result="c1"/><feComposite in="c1" in2="b1" operator="in" result="g1"/><feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="b2"/><feFlood flood-color="#4fb8ff" flood-opacity=".42" result="c2"/><feComposite in="c2" in2="b2" operator="in" result="g2"/><feMerge><feMergeNode in="g1"/><feMergeNode in="g2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="${id}e" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.1" result="a"/><feMerge><feMergeNode in="a"/><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<g${glow ? ` filter="url(#${id}g)"` : ''}>
<path d="${fin}" fill="url(#${id}f)" stroke="${rim}" stroke-opacity=".35" stroke-width=".5" stroke-linejoin="round"/>
<path d="${ribs.join('')}" stroke="${rim}" stroke-opacity=".28" stroke-width=".45" fill="none"/>
<path d="${snout}" fill="url(#${id}b)"/>
<path d="${crown}" fill="${shade[0]}" stroke-linejoin="round"/>
<path d="${outline}" fill="url(#${id}b)" stroke-linejoin="round"/>
<path d="${pec}" fill="url(#${id}f)" stroke="${rim}" stroke-opacity=".3" stroke-width=".4"/>
</g>
<path d="${plates.join('')}" stroke="${plateCol}" stroke-width=".7" stroke-linecap="round" fill="none"/>
<path d="${polyPath(back.slice(Math.floor(back.length * 0.05), Math.floor(back.length * 0.72)))}" fill="none" stroke="url(#${id}r)" stroke-width=".9" stroke-linecap="round" stroke-opacity=".75"/>
<path d="M56.6 19.2C61.6 20 66.6 21.8 71.4 23.4" fill="none" stroke="${rim}" stroke-width=".5" stroke-opacity=".35" stroke-linecap="round"/>
<path d="M48.6 28.2Q51.2 31 55 30.6" fill="none" stroke="${plateCol}" stroke-width=".8" stroke-linecap="round"/>
${eyeEl}
</svg>`;
}

/** A sleepy white chibi cat, curled into a loaf. Original drawing in clean geometry. */
export function catSVG(size = 150, label = 'A small white cat, asleep') {
  const id = `ct${++svgN}`;
  const line = '#0a0e1a';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 86" width="${size}" height="${f((size * 86) / 132)}" role="img" aria-label="${label}">
<defs>
<linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef4fc"/><stop offset=".62" stop-color="#dfe8f5"/><stop offset="1" stop-color="#b9c7dc"/></linearGradient>
<radialGradient id="${id}s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#4fb8ff" stop-opacity=".2"/><stop offset="1" stop-color="#4fb8ff" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="72" cy="80" rx="52" ry="5" fill="url(#${id}s)"/>
<g class="cat-tail"><path d="M108 64C122 64 124 48 116 42" fill="none" stroke="${line}" stroke-width="10.5" stroke-linecap="round"/><path d="M108 64C122 64 124 48 116 42" fill="none" stroke="url(#${id}w)" stroke-width="6" stroke-linecap="round"/></g>
<g class="cat-body" style="transform-origin:72px 78px">
<path d="M40 76C30 76 27 66 31 56C36 42 56 34 78 34C100 34 114 44 115 58C116 70 108 77 96 77Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.6" stroke-linejoin="round"/>
<path d="M86 50Q92 47 98 50M90 57Q96 54 102 57" fill="none" stroke="#c2d0e4" stroke-width="2" stroke-linecap="round"/>
</g>
<g class="cat-head">
<path d="M17 30L14.5 12.6Q14.6 9.6 17.4 10.8L31 20Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.6" stroke-linejoin="round"/>
<path d="M44 19L56.6 9.8Q59.4 8.6 59.6 11.6L58.6 29Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.6" stroke-linejoin="round"/>
<path d="M18.6 22.6L17.6 15.6L25 20.8ZM50.4 17.8L56.4 13.6L56.2 21.4Z" fill="#ffcdba" opacity=".55"/>
<ellipse cx="37.5" cy="44" rx="25.5" ry="21.5" fill="url(#${id}w)" stroke="${line}" stroke-width="2.6"/>
<path d="M24.6 45.4Q28.6 49.6 32.6 45.4M42.6 45.4Q46.6 49.6 50.6 45.4" fill="none" stroke="${line}" stroke-width="2.3" stroke-linecap="round"/>
<ellipse cx="23" cy="53" rx="4.2" ry="2.4" fill="#ffcdba" opacity=".6"/>
<ellipse cx="52.4" cy="53" rx="4.2" ry="2.4" fill="#ffcdba" opacity=".6"/>
<path d="M34.4 52.6q1.6 2 3.2 0q1.6 2 3.2 0" fill="none" stroke="${line}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<g class="cat-paws">
<path d="M26 70.6C26 64.6 38 64.6 38 70.6C38 74.6 26 74.6 26 70.6Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.4"/>
<path d="M40 71C40 65 52 65 52 71C52 75 40 75 40 71Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.4"/>
</g>
</svg>`;
}

/** Her rank crystal (mint is hers). The rank letter sits on top in Bodoni Moda, set by CSS. */
export function crystalSVG(size = 64) {
  const id = `cr${++svgN}`;
  const O: P[] = [[32, 2], [60, 20], [60, 64], [32, 82], [4, 64], [4, 20]];
  const I: P[] = [[32, 14], [49, 24.5], [49, 59.5], [32, 70], [15, 59.5], [15, 24.5]];
  const facets = O.map((p, i) => `M${p[0]} ${p[1]}L${I[i][0]} ${I[i][1]}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 84" width="${size}" height="${f((size * 84) / 64)}" aria-hidden="true">
<defs>
<linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#173a2e"/><stop offset=".5" stop-color="#0b1c18"/><stop offset="1" stop-color="#07110f"/></linearGradient>
<linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#89cf9d" stop-opacity=".22"/><stop offset="1" stop-color="#89cf9d" stop-opacity=".04"/></linearGradient>
<filter id="${id}g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<path d="${polyPath(O)}Z" fill="url(#${id}a)" stroke="#89cf9d" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round" filter="url(#${id}g)"/>
<path d="${polyPath(I)}Z" fill="url(#${id}b)" stroke="#89cf9d" stroke-opacity=".35" stroke-width=".8" stroke-linejoin="round"/>
<path d="${facets}" stroke="#89cf9d" stroke-opacity=".28" stroke-width=".7"/>
<path d="M32 2L60 20L49 24.5L32 14Z" fill="#89cf9d" fill-opacity=".1"/>
</svg>`;
}

/** Card back: a 24-tick System ring around a vertical gate slit. */
export function cardBackSVG() {
  const ticks: string[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r1 = i % 6 === 0 ? 30 : 32.5, r2 = 36;
    ticks.push(`M${f(50 + Math.cos(a) * r1)} ${f(50 + Math.sin(a) * r1)}L${f(50 + Math.cos(a) * r2)} ${f(50 + Math.sin(a) * r2)}`);
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true" class="dq-cardback-art">
<circle cx="50" cy="50" r="40" fill="none" stroke="#3e6485" stroke-width=".6"/>
<path d="${ticks.join('')}" stroke="#7fb6e0" stroke-width="1" stroke-linecap="round" opacity=".7"/>
<circle cx="50" cy="50" r="24" fill="none" stroke="#3e6485" stroke-width=".6"/>
<path d="M50 30L62 50L50 70L38 50Z" fill="none" stroke="#5d8fbf" stroke-width=".8"/>
<path d="M50 36.5Q52.4 50 50 63.5Q47.6 50 50 36.5Z" fill="#bfe9ff" class="dq-slit"/>
</svg>`;
}

const ICON: Record<string, string> = {
  status: '<path d="M12 3.4l7.4 4.3v8.6L12 20.6l-7.4-4.3V7.7z"/><circle cx="12" cy="10.2" r="2.4"/><path d="M8.1 16.4c.9-1.9 2.2-2.8 3.9-2.8s3 .9 3.9 2.8"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chev: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  safe: '<path d="M12 3.2l7 2.9v5.3c0 4.4-2.9 7.9-7 9.6-4.1-1.7-7-5.2-7-9.6V6.1z"/><path d="M8.6 12.4q1.7-1.6 3.4 0t3.4 0"/>',
  rest: '<path d="M18.8 14.6A7.6 7.6 0 1 1 9.4 5.2a6.2 6.2 0 0 0 9.4 9.4z"/>',
  shadows: '<rect x="7.5" y="5" width="11" height="15" rx="1"/><path d="M5 7.5v12.2c0 .7.5 1.3 1.3 1.3h9.2"/>',
  diary: '<rect x="5" y="4.5" width="14" height="15" rx="1"/><path d="M5 9h14M9.7 9v10.5M14.3 9v10.5M5 14.2h14"/>',
  comfort: '<path d="M6.5 9h11l-1 10.5h-9z"/><path d="M9.2 9V7.6a2.8 2.8 0 0 1 5.6 0V9"/>',
  settings: '<path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="1.9" fill="currentColor"/><circle cx="15" cy="12" r="1.9" fill="currentColor"/><circle cx="8" cy="17" r="1.9" fill="currentColor"/>',
  check: '<path d="M5.5 12.5l4.2 4.2 8.8-9.4"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  copy: '<rect x="8.5" y="8.5" width="10.5" height="11" rx="1"/><path d="M15.5 5.2H6.2c-.6 0-1 .4-1 1v10"/>',
  export: '<path d="M12 15V4.5M7.8 8.7L12 4.5l4.2 4.2"/><path d="M5.5 13.5v5.2c0 .6.4 1 1 1h11c.6 0 1-.4 1-1v-5.2"/>',
  import: '<path d="M12 4.5V15M7.8 10.8L12 15l4.2-4.2"/><path d="M5.5 13.5v5.2c0 .6.4 1 1 1h11c.6 0 1-.4 1-1v-5.2"/>',
  replay: '<path d="M5.5 12a6.5 6.5 0 1 0 2-4.7"/><path d="M5.2 4.6v3.6h3.6"/>',
  phone: '<path d="M7.4 4.5h2.4l1.3 3.6-1.7 1.2a9 9 0 0 0 5.3 5.3l1.2-1.7 3.6 1.3v2.4c0 .8-.7 1.5-1.5 1.5A13.6 13.6 0 0 1 5.9 6c0-.8.7-1.5 1.5-1.5z"/>',
  text: '<path d="M5 6.5c0-.8.7-1.5 1.5-1.5h11c.8 0 1.5.7 1.5 1.5v8c0 .8-.7 1.5-1.5 1.5H10l-4 3.2V16h-.5c-.3 0-.5-.2-.5-.5z"/>',
  sound: '<path d="M5 9.5h3l4.5-3.8v12.6L8 14.5H5z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6M17.6 7a7 7 0 0 1 0 10"/>',
  mute: '<path d="M5 9.5h3l4.5-3.8v12.6L8 14.5H5z"/><path d="M15.5 9.5l4.5 5M20 9.5l-4.5 5"/>',
  trash: '<path d="M6 7.5h12M10 7.5V5.6h4v1.9M7.6 7.5l.8 11.4c0 .6.5 1.1 1.1 1.1h5c.6 0 1.1-.5 1.1-1.1l.8-11.4"/>',
  card: '<rect x="6.5" y="4" width="11" height="16" rx="1.2"/><path d="M12 8.5l2.4 3.5-2.4 3.5-2.4-3.5z"/>',
  checkin: '<circle cx="12" cy="12" r="7.5"/><path d="M8.6 13.6q3.4 2.6 6.8 0"/><path d="M9.4 9.8h.01M14.6 9.8h.01" stroke-width="2.4"/>',
  book: '<path d="M5 5.5h5.2c1 0 1.8.8 1.8 1.8v12.2c0-.9-.7-1.5-1.6-1.5H5z"/><path d="M19 5.5h-5.2c-1 0-1.8.8-1.8 1.8v12.2c0-.9.7-1.5 1.6-1.5H19z"/>',
  brush: '<path d="M19.2 4.8c-2.6 1.4-6.4 5-8.3 7.6l1.7 1.7c2.6-1.9 6.2-5.7 7.6-8.3z"/><path d="M10.2 13.3c-1.9-.2-3.3 1-3.5 2.7-.1 1.1-.7 2-1.9 2.4 2.7 1.4 6.2.6 6.9-2.2.2-.9-.3-2.2-1.5-2.9z"/>',
  undo: '<path d="M9 7.5L5 11.5l4 4"/><path d="M5.5 11.5h8.2a4.8 4.8 0 0 1 0 9.6H11"/>',
  redo: '<path d="M15 7.5l4 4-4 4"/><path d="M18.5 11.5h-8.2a4.8 4.8 0 0 0 0 9.6H13"/>',
  quote: '<path d="M6 7.5h4.5v4.6c0 2.6-1.4 4.2-4 4.6"/><path d="M13.5 7.5H18v4.6c0 2.6-1.4 4.2-4 4.6"/>',
  image: '<rect x="4.5" y="5" width="15" height="14" rx="1"/><circle cx="9.3" cy="9.8" r="1.6"/><path d="M5 17.2l4.4-4 3 2.6 2.6-2.2 4.5 3.8"/>',
  shuffle: '<path d="M5 8h3.2c4 0 4.6 8 8.6 8H19"/><path d="M5 16h3.2c1.4 0 2.3-1 3-2.3M13.6 10.3c.7-1.3 1.6-2.3 3.2-2.3H19"/><path d="M17 6l2 2-2 2M17 14l2 2-2 2"/>',
  quill: '<path d="M19.6 4.4C13.2 4.9 8.9 9.2 8.2 15.8"/><path d="M19.6 4.4c-.5 5.7-4.5 10-10.8 11.1"/><path d="M8.8 15.2L4.8 19.6"/><path d="M12.3 11.7l3.6-3.6"/><path d="M12.5 19.6h6.7"/>',
  more: '<circle cx="6" cy="12" r="1.25" fill="currentColor"/><circle cx="12" cy="12" r="1.25" fill="currentColor"/><circle cx="18" cy="12" r="1.25" fill="currentColor"/>',
  pencil: '<path d="M15.6 5.4l3 3L8.8 18.2l-3.8.8.8-3.8z"/><path d="M13.6 7.4l3 3"/>',
  up: '<path d="M12 18.5V5.8M6.8 11L12 5.8l5.2 5.2"/>',
  down: '<path d="M12 5.5v12.7M6.8 13L12 18.2l5.2-5.2"/>',
  chevdown: '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
  share: '<path d="M12 14.5V4.5M8.2 8.3L12 4.5l3.8 3.8"/><path d="M7.5 10.5H6.5c-.6 0-1 .4-1 1v7.2c0 .6.4 1 1 1h11c.6 0 1-.4 1-1v-7.2c0-.6-.4-1-1-1h-1"/>',
  ally: '<path d="M12 4.2c1.9 0 3.2 1.5 3.2 3.4 0 1.4-.7 2.4-1.6 3l3.6 3.4-1.1 6.2H7.9l-1.1-6.2 3.6-3.4c-.9-.6-1.6-1.6-1.6-3 0-1.9 1.3-3.4 3.2-3.4z"/><path d="M10.6 7.4h.01M13.4 7.4h.01" stroke-width="2.2"/>',
};

export function icon(name: keyof typeof ICON | string, cls = '') {
  return `<svg class="dq-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[name] ?? ''}</svg>`;
}

const GLYPH: Record<ModuleId, string> = {
  mind: '<path d="M3.5 12C6 7.6 9 5.8 12 5.8s6 1.8 8.5 6.2C18 16.4 15 18.2 12 18.2S6 16.4 3.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
  dt: '<path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z"/><path d="M12 8l3.8 2.2v4.4L12 16.8l-3.8-2.2v-4.4z"/>',
  er: '<circle cx="12" cy="12" r="8.2"/><path d="M5.2 13.2q1.7-2.2 3.4 0t3.4 0 3.4 0 3.4 0"/><path d="M7 9.4q1.25-1.4 2.5 0t2.5 0 2.5 0 2.5 0" opacity=".55"/>',
  ie: '<circle cx="9.2" cy="12" r="5"/><circle cx="14.8" cy="12" r="5"/>',
};
export function glyph(m: ModuleId, cls = '') {
  return `<svg class="dq-glyph ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${GLYPH[m]}</svg>`;
}

/** The art window on a skill card: a System sigil ring around the module glyph (or a named icon). */
export function cardArtSVG(m: ModuleId | null, iconName?: string) {
  const ticks: string[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
    const r1 = i % 9 === 0 ? 27 : 29.5, r2 = 31.5;
    ticks.push(`M${f(50 + Math.cos(a) * r1)} ${f(37 + Math.sin(a) * r1)}L${f(50 + Math.cos(a) * r2)} ${f(37 + Math.sin(a) * r2)}`);
  }
  const inner = m ? GLYPH[m] : ICON[iconName ?? 'card'];
  return `<svg class="dq-cf-art-svg" viewBox="0 0 100 74" aria-hidden="true">
<circle cx="50" cy="37" r="35" fill="none" stroke="rgba(62,100,133,.55)" stroke-width=".5"/>
<path d="${ticks.join('')}" stroke="rgba(150,200,240,.5)" stroke-width=".7" stroke-linecap="round"/>
<circle cx="50" cy="37" r="21" fill="none" stroke="rgba(62,100,133,.7)" stroke-width=".5"/>
<path d="M50 9.5V14M50 60v4.5M22.5 37H27M73 37h4.5" stroke="rgba(150,200,240,.55)" stroke-width=".7"/>
<g class="dq-cf-art-g" transform="translate(36.8 23.8) scale(1.1)" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${inner}</g>
</svg>`;
}

/**
 * The Stealth room cat: the same white loaf as catSVG, on a floating System plate, with a cup near the plate's edge.
 * Extra parts are driven by classes on an ancestor: .is-blep (tongue), .is-sprawl (long stretch), .is-nudge (cup).
 */
export function lurkCatSVG(size = 250, label = 'A small white cat, asleep on a floating plate, next to a cup') {
  const id = `lc${++svgN}`;
  const line = '#0a0e1a';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-36 0 172 96" width="${size}" height="${f((size * 96) / 172)}" role="img" aria-label="${label}" class="lc">
<defs>
<linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef4fc"/><stop offset=".62" stop-color="#dfe8f5"/><stop offset="1" stop-color="#b9c7dc"/></linearGradient>
<linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16304f"/><stop offset="1" stop-color="#070d1a"/></linearGradient>
<linearGradient id="${id}e" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fb8ff" stop-opacity="0"/><stop offset=".18" stop-color="#4fb8ff" stop-opacity=".9"/><stop offset=".82" stop-color="#4fb8ff" stop-opacity=".9"/><stop offset="1" stop-color="#4fb8ff" stop-opacity="0"/></linearGradient>
<radialGradient id="${id}u" cx=".5" cy="0" r=".6"><stop offset="0" stop-color="#4fb8ff" stop-opacity=".22"/><stop offset=".6" stop-color="#7b3fe4" stop-opacity=".08"/><stop offset="1" stop-color="#7b3fe4" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="43" cy="92" rx="88" ry="6" fill="url(#${id}u)"/>
<g class="lc-plate">
<path d="M-24 79.2h158l-3 6.6h-152z" fill="url(#${id}p)"/>
<path d="M-24 79.2h158" stroke="url(#${id}e)" stroke-width=".9"/>
<path d="M-21 85.8h152" stroke="rgba(123,63,228,.35)" stroke-width=".6"/>
<path d="M-24 82.6v-3.4h4M134 82.6v-3.4h-4" fill="none" stroke="#a5d0ee" stroke-width=".7" stroke-opacity=".8"/>
</g>
<g class="lc-cup">
<path class="lc-steam" d="M-7.6 60.6q-2 -3 0 -6t0 -6M-2.4 59.4q-1.8 -2.6 0 -5.2t0 -5.2" fill="none" stroke="#a5d0ee" stroke-width=".8" stroke-linecap="round" stroke-opacity=".4"/>
<path d="M-12 66.6q-5.6 0 -5.6 4.4t5.6 4.4" fill="none" stroke="${line}" stroke-width="3.6" stroke-linecap="round"/>
<path d="M-12 66.6q-5.6 0 -5.6 4.4t5.6 4.4" fill="none" stroke="url(#${id}w)" stroke-width="1.4" stroke-linecap="round"/>
<path d="M-12.4 63.6h16v12.2q0 3 -3 3h-10q-3 0 -3 -3z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.2" stroke-linejoin="round"/>
<rect x="-12.4" y="68.2" width="16" height="2.8" fill="#89cf9d" opacity=".9"/>
<path d="M-10.6 63.8h12.4" stroke="#4a3830" stroke-width="1.3" stroke-linecap="round"/>
</g>
<g class="lc-arm">
<path d="M12 67.4h53a3.7 3.7 0 0 1 0 7.4h-53z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.2"/>
<ellipse cx="10.4" cy="71" rx="6.4" ry="5.2" fill="url(#${id}w)" stroke="${line}" stroke-width="2.2"/>
<path d="M6.8 69v4M9.6 68.4v5.2" stroke="#c2d0e4" stroke-width="1.1" stroke-linecap="round"/>
<ellipse cx="7.4" cy="74.4" rx="1.6" ry=".9" fill="#ffcdba" opacity=".7"/>
</g>
<g class="lc-tail"><path d="M108 66C122 66 124 50 116 44" fill="none" stroke="${line}" stroke-width="10.5" stroke-linecap="round"/><path d="M108 66C122 66 124 50 116 44" fill="none" stroke="url(#${id}w)" stroke-width="6" stroke-linecap="round"/></g>
<g class="lc-body">
<path d="M40 78C30 78 27 68 31 58C36 44 56 36 78 36C100 36 114 46 115 60C116 72 108 79 96 79Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.6" stroke-linejoin="round"/>
<path d="M86 52Q92 49 98 52M90 59Q96 56 102 59" fill="none" stroke="#c2d0e4" stroke-width="2" stroke-linecap="round"/>
</g>
<g class="lc-head">
<path d="M17 32L14.5 14.6Q14.6 11.6 17.4 12.8L31 22Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.6" stroke-linejoin="round"/>
<path d="M44 21L56.6 11.8Q59.4 10.6 59.6 13.6L58.6 31Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.6" stroke-linejoin="round"/>
<path d="M18.6 24.6L17.6 17.6L25 22.8ZM50.4 19.8L56.4 15.6L56.2 23.4Z" fill="#ffcdba" opacity=".55"/>
<ellipse cx="37.5" cy="46" rx="25.5" ry="21.5" fill="url(#${id}w)" stroke="${line}" stroke-width="2.6"/>
<path d="M24.6 47.4Q28.6 51.6 32.6 47.4" fill="none" stroke="${line}" stroke-width="2.3" stroke-linecap="round"/>
<path class="lc-shut" d="M42.6 47.4Q46.6 51.6 50.6 47.4" fill="none" stroke="${line}" stroke-width="2.3" stroke-linecap="round"/>
<g class="lc-peek"><ellipse cx="46.2" cy="48" rx="2.7" ry="3.1" fill="${line}"/><circle cx="45.4" cy="46.9" r=".95" fill="#fff"/></g>
<ellipse cx="23" cy="55" rx="4.2" ry="2.4" fill="#ffcdba" opacity=".6"/>
<ellipse cx="52.4" cy="55" rx="4.2" ry="2.4" fill="#ffcdba" opacity=".6"/>
<path class="lc-tongue" d="M35.9 55.2Q35.7 60.8 37.6 60.8Q39.5 60.8 39.3 55.2Z" fill="#ff93a8" stroke="${line}" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M34.4 54.6q1.6 2 3.2 0q1.6 2 3.2 0" fill="none" stroke="${line}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<g class="lc-paws">
<path d="M26 72.6C26 66.6 38 66.6 38 72.6C38 76.6 26 76.6 26 72.6Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.4"/>
<path d="M40 73C40 67 52 67 52 73C52 77 40 77 40 73Z" fill="url(#${id}w)" stroke="${line}" stroke-width="2.4"/>
</g>
</svg>`;
}

/** Shadow-tone fill, cold rim and violet glow shared by the Stealth room creatures. */
function shadowDefs(id: string) {
  return `<linearGradient id="${id}b" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#22304f"/><stop offset=".55" stop-color="#0d1324"/><stop offset="1" stop-color="#070a14"/></linearGradient>
<filter id="${id}g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="b1"/><feFlood flood-color="#7b3fe4" flood-opacity=".55" result="c1"/><feComposite in="c1" in2="b1" operator="in" result="g1"/><feMerge><feMergeNode in="g1"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

/** The land-shark's fin (an original small shadow creature): a rounded dorsal fin with a cold rim. */
export function sharkFinSVG() {
  const id = `sf${++svgN}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 44" width="60" height="44" aria-hidden="true">
<defs>${shadowDefs(id)}</defs>
<g filter="url(#${id}g)">
<path d="M5 42C13 40 17.4 28 16.6 12.4Q16.4 5.6 21.6 6.6C33 10 44 28 54 42Z" fill="url(#${id}b)"/>
<path d="M16.6 12.4Q16.4 5.6 21.6 6.6C33 10 44 28 54 42" fill="none" stroke="#4fb8ff" stroke-width="1.2" stroke-opacity=".8" stroke-linecap="round"/>
<path d="M22 14.6C30 19 37 28 42 36" fill="none" stroke="#a5d0ee" stroke-width=".7" stroke-opacity=".35" stroke-linecap="round"/>
</g>
</svg>`;
}

/** The land-shark's tail, which flicks up once as it dives. */
export function sharkTailSVG() {
  const id = `st${++svgN}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 36" width="40" height="36" aria-hidden="true">
<defs>${shadowDefs(id)}</defs>
<g filter="url(#${id}g)">
<path d="M20 36C19 28 14 20 5 12Q11 11.6 17 16Q19.4 9 26 4Q25 16 23.4 36Z" fill="url(#${id}b)" stroke="#4fb8ff" stroke-width=".9" stroke-opacity=".7" stroke-linejoin="round"/>
</g>
</svg>`;
}

/** A slow aquarium fish, facing right. tone 0 plain, 1 with a mint stripe, 2 small and round. */
export function fishSVG(tone: 0 | 1 | 2 = 0) {
  const id = `fs${++svgN}`;
  const body = tone === 2 ? 'M40 14C35 4 21 3 14 14C21 25 35 24 40 14Z' : 'M44 14C38 4 22 3 13 14C22 24 38 23 44 14Z';
  const stripe = tone === 1 ? `<path d="M27 6.6Q24.6 14 27 21.4" fill="none" stroke="#89cf9d" stroke-width="1.6" stroke-opacity=".75" stroke-linecap="round"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 28" width="48" height="28" aria-hidden="true">
<defs>${shadowDefs(id)}</defs>
<g filter="url(#${id}g)">
<path d="M14 14L3 6Q6.4 14 3 22Z" fill="url(#${id}b)" stroke="#4fb8ff" stroke-width=".8" stroke-opacity=".6" stroke-linejoin="round"/>
<path d="M24 6.4Q28 1.6 33 5" fill="none" stroke="#4fb8ff" stroke-width=".8" stroke-opacity=".5" stroke-linecap="round"/>
<path d="${body}" fill="url(#${id}b)" stroke="#4fb8ff" stroke-width=".9" stroke-opacity=".7"/>
</g>
${stripe}
<circle cx="${tone === 2 ? 34.4 : 37.6}" cy="12.4" r="1.5" fill="#89cf9d"/>
</svg>`;
}

/** A soft seaweed ribbon for the aquarium floor. */
export function seaweedSVG(height = 120, seed = 0) {
  const w = 26;
  const left: string[] = [];
  const right: string[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const y = height - (i / n) * height;
    const x = w / 2 + Math.sin(i * 0.9 + seed) * 5;
    const half = 4.2 * (1 - i / (n + 2));
    left.push(`${f(x - half)} ${f(y)}`);
    right.unshift(`${f(x + half)} ${f(y)}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height}" width="${w}" height="${height}" aria-hidden="true">
<path d="M${left.join('L')}L${right.join('L')}Z" fill="rgba(46,110,120,.32)" stroke="rgba(137,207,157,.32)" stroke-width=".8" stroke-linejoin="round"/>
</svg>`;
}
