import { clamp } from '../../core/math';

/**
 * On-screen "AWAKEN" (REFERENCE beat 5 type spec, pacing W5 slam): outline strokes draw on while a glint sweeps
 * left to right in 100 ms, the word holds with +5 % growth per frame for 4 frames, then a ghost exit. 333 ms total.
 * Stroke core #D3F7FD, glow #66A3CE, two-layer glow. Pure function of p (0..1 over WORD_DUR).
 */
export const WORD_DUR = 0.333;

export function buildAwakenWord(parent?: HTMLElement) {
  const host = parent ?? document.getElementById('ui') ?? document.body;
  const root = document.createElement('div');
  root.className = 'awaken-word';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:40;visibility:hidden;contain:strict;';
  const id = 'awg' + Math.floor(Math.random() * 1e6);
  root.innerHTML = `
<svg viewBox="0 0 1000 320" style="width:min(88vw,980px);overflow:visible;will-change:transform,opacity">
  <defs>
    <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="0">
      <stop offset="0" stop-color="#d3f7fd"/>
      <stop class="g0" offset="0.4" stop-color="#d3f7fd"/>
      <stop class="g1" offset="0.45" stop-color="#ffffff"/>
      <stop class="g2" offset="0.5" stop-color="#d3f7fd"/>
      <stop offset="1" stop-color="#d3f7fd"/>
    </linearGradient>
  </defs>
  <g class="ghost" style="transform-origin:500px 170px;transform-box:view-box">
    <text x="500" y="232" text-anchor="middle" font-family="Bodoni Moda, Didot, serif" font-weight="700" font-size="236"
      letter-spacing="26" fill="none" stroke="#9fd6f0" stroke-width="2.4" transform="skewX(-9)" transform-origin="500 170">AWAKEN</text>
  </g>
  <g class="main" style="transform-origin:500px 170px;transform-box:view-box">
    <text class="halo" x="500" y="232" text-anchor="middle" font-family="Bodoni Moda, Didot, serif" font-weight="700" font-size="236"
      letter-spacing="26" fill="none" stroke="#66a3ce" stroke-width="9" stroke-linejoin="round" opacity="0.32"
      transform="skewX(-9)" transform-origin="500 170" style="filter:blur(6px)">AWAKEN</text>
    <text class="stroke" x="500" y="232" text-anchor="middle" font-family="Bodoni Moda, Didot, serif" font-weight="700" font-size="236"
      letter-spacing="26" fill="none" stroke="url(#${id})" stroke-width="3.2" stroke-linejoin="round"
      stroke-dasharray="1500" stroke-dashoffset="1500" transform="skewX(-9)" transform-origin="500 170">AWAKEN</text>
  </g>
</svg>`;
  host.appendChild(root);
  const svg = root.querySelector('svg') as SVGSVGElement;
  svg.style.filter = 'drop-shadow(0 0 2px rgba(156,251,255,0.85)) drop-shadow(0 0 12px rgba(20,87,172,0.85))';
  const main = root.querySelector('.main') as SVGGElement;
  const ghost = root.querySelector('.ghost') as SVGGElement;
  const stroke = root.querySelector('.stroke') as SVGTextElement;
  const halo = root.querySelector('.halo') as SVGTextElement;
  const stops = ['.g0', '.g1', '.g2'].map((s) => root.querySelector(s) as SVGStopElement);

  const set = (p: number) => {
    if (p <= 0 || p >= 1) {
      root.style.visibility = 'hidden';
      return;
    }
    root.style.visibility = 'visible';
    const t = p * WORD_DUR;
    const draw = clamp(t / 0.1);
    stroke.setAttribute('stroke-dashoffset', String(1500 * (1 - (1 - Math.pow(1 - draw, 2)))));
    halo.setAttribute('opacity', String(0.32 * draw));
    const gx = -0.15 + 1.3 * draw;
    stops[0].setAttribute('offset', String(clamp(gx - 0.07)));
    stops[1].setAttribute('offset', String(clamp(gx)));
    stops[2].setAttribute('offset', String(clamp(gx + 0.07)));
    const frames = Math.min(4, Math.max(0, Math.floor((t - 0.1) / 0.0333) + (t >= 0.1 ? 1 : 0)));
    const sc = Math.pow(1.05, frames);
    const ex = clamp((t - 0.233) / 0.1);
    main.style.transform = `scale(${sc})`;
    main.style.opacity = String(1 - ex);
    ghost.style.opacity = String(ex > 0 ? 0.55 * (1 - ex) : 0);
    ghost.style.transform = `scale(${sc * (1 + 0.22 * ex)})`;
    ghost.style.filter = `blur(${(ex * 3).toFixed(2)}px)`;
  };
  set(0);
  return { el: root, set, dispose: () => root.remove() };
}
