import { RANK, WINDOW as W, EASE, css, fr } from '../motion/tokens';
import { lanternMessage, type RevealCtx, type WindowSpec } from './lantern-window';

export type RankLetter = (typeof RANK.letters)[number] | 'M';

const NS = 'http://www.w3.org/2000/svg';

/** The rank crystal: concentric diamonds, cardinal ticks and rays that grow with the tier. Hairlines, no glow. */
function crystalSVG(tier: number) {
  const rings = RANK.rings[tier];
  const parts: string[] = [];
  for (let i = 0; i < rings; i++) {
    const r = 46 - i * 7;
    const stroke = i === rings - 1 && rings > 1 ? 'rgba(137,207,157,.75)' : i === 0 ? '#7d96c5' : 'rgba(125,150,197,.6)';
    parts.push(`<path d="M50 ${50 - r} L${50 + r} 50 L50 ${50 + r} L${50 - r} 50 Z" fill="${i === 0 ? 'rgba(4,18,32,.55)' : 'none'}" stroke="${stroke}" stroke-width="${i === 0 ? 1.5 : 1}"/>`);
  }
  if (RANK.ticks[tier])
    for (const [x1, y1, x2, y2] of [[50, 0, 50, -6], [100, 50, 106, 50], [50, 100, 50, 106], [0, 50, -6, 50]])
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7d96c5" stroke-width="1.5"/>`);
  for (let i = 0; i < RANK.rays[tier]; i++) {
    const a = (i / RANK.rays[tier]) * Math.PI * 2 + Math.PI / 8;
    const p = (r: number) => `${(50 + Math.cos(a) * r).toFixed(2)} ${(50 + Math.sin(a) * r).toFixed(2)}`;
    parts.push(`<path d="M${p(40)} L${p(52)}" stroke="rgba(137,207,157,.7)" stroke-width="1"/>`);
  }
  return `<svg class="sw-rank-frame" viewBox="0 0 100 100" xmlns="${NS}" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Lantern window spec for a rank-up (E..S) or the Night Warden title (M). */
export function rankSpec(letter: RankLetter, line: string): WindowSpec {
  const isTitle = letter === 'M';
  const tier = isTitle ? RANK.rings.length - 1 : RANK.letters.indexOf(letter);
  const prev = isTitle ? RANK.letters.length - 1 : Math.max(0, tier - 1);
  const shown = isTitle ? 'Night Warden' : letter;
  const pips = RANK.letters
    .map((l, i) => {
      const lit = isTitle || i < tier ? ' is-lit' : '';
      const fresh = !isTitle && i === tier ? `<span class="sw-pip-new">${l}</span>` : '';
      return `<span class="sw-pip${lit}">${l}${fresh}</span>`;
    })
    .join('');
  const html = `<div class="sw-rank sw-custom" data-tier="${letter}" style="--halo:${RANK.haloPx[tier]}px">
      <div class="sw-rank-crystal">${crystalSVG(tier)}<span class="sw-rank-letter">${shown}</span><span class="sw-rank-glow" aria-hidden="true">${shown}</span></div>
      <div class="sw-ladder" aria-hidden="true">${pips}<span class="sw-marker"></span></div>
    </div><p class="center">${line}</p>`;

  const reveal = ({ root, reduced, animate }: RevealCtx) => {
    const q = <T extends Element>(s: string) => root.querySelector<T>(s)!;
    const crystal = q<HTMLElement>('.sw-rank-crystal');
    const letterEl = q<HTMLElement>('.sw-rank-letter');
    const glow = q<HTMLElement>('.sw-rank-glow');
    const marker = q<HTMLElement>('.sw-marker');
    const fresh = root.querySelector<HTMLElement>('.sw-pip-new');
    const ladder = q<HTMLElement>('.sw-ladder');
    const slots = [...ladder.querySelectorAll<HTMLElement>('.sw-pip')];
    // from under one letter to under another, in whichever row a narrow window wraps each (the marker starts under the
    // ladder's last row)
    const at = (i: number) => `translate(${slots[i].offsetLeft}px, ${slots[i].offsetTop + slots[i].offsetHeight - ladder.offsetHeight}px)`;
    const to = isTitle ? prev : tier;
    // then it rests inside its letter, so it stays under it when the window reflows (a phone turned at 200% rewraps it)
    const rest = () => slots[to].append(marker);
    if (reduced) {
      rest();
      if (fresh) fresh.style.opacity = '1';
      return 0;
    }
    // R1: the crystal opens with the window's own stepped grammar
    // hidden until its own open starts (no line of the diamond during the window's open)
    const steps = W.openSteps.map((v, i) => (i === 0 ? 0 : v));
    animate(
      crystal,
      steps.map((s, i) => ({ clipPath: `inset(${((1 - s) / 2) * 100}% -20% ${((1 - s) / 2) * 100}% -20%)`, offset: i / (steps.length - 1), easing: 'steps(1, end)' })),
      { duration: fr(W.openStepFrames * (steps.length - 1)), delay: fr(RANK.crystalOpenFrames), easing: 'linear', fill: 'backwards' },
    );
    animate(ladder, [{ opacity: 0 }, { opacity: 1 }], { duration: fr(W.chipFadeFrames), delay: fr(RANK.crystalOpenFrames + W.openStepFrames * (steps.length - 1)), easing: 'linear' });
    // R2: the letter ignites like a seam, light overshoots and settles (no flash)
    const ign = RANK.igniteMs[tier];
    const ignAt = fr(RANK.igniteFrames);
    animate(letterEl, [{ opacity: 0 }, { opacity: 1 }], { duration: ign, delay: ignAt, easing: css(RANK.igniteEase) });
    animate(glow, [{ opacity: 0 }, { opacity: RANK.glowPeak, offset: ign / (ign + RANK.glowSettleMs) }, { opacity: 0 }], {
      duration: ign + RANK.glowSettleMs,
      delay: ignAt,
      easing: css(EASE.outCubic),
    });
    // R3 (beat 1): the marker moves one step, from where the player was to where the player is; the new pip lights
    const mAt = fr(RANK.markerFrames);
    const move = animate(marker, [{ opacity: 0, transform: at(prev) }, { opacity: 1, transform: at(prev), offset: 0.001 }, { opacity: 1, transform: at(to) }], {
      duration: to === prev ? RANK.pipLightMs : RANK.markerMs,
      delay: mAt,
      easing: css(RANK.markerEase),
    });
    // a tap that completes the typing finishes the move too; a window that goes first cancels it
    move.finished.then(
      () => {
        rest();
        move.cancel();
      },
      () => {},
    );
    if (fresh) animate(fresh, [{ opacity: 0 }, { opacity: 1 }], { duration: RANK.pipLightMs, delay: mAt + (to === prev ? 0 : RANK.markerMs), easing: css(EASE.outCubic) });
    // R4 (beat 2): the line types
    return fr(RANK.lineFrames);
  };

  return { kind: 'level', title: isTitle ? 'Title' : 'Rank up', icon: 'level', html, tapToContinue: true, reveal };
}

/**
 * Shows the rank-up reveal and resolves when the player continues. Pass `open` to route it through a host's own window
 * queue (the companion's scrim and focus handling); without it, it opens on the shared Lantern layer.
 */
export async function revealRank(letter: RankLetter, line: string, opts: { open?: (spec: WindowSpec) => Promise<unknown> } = {}): Promise<void> {
  const spec = rankSpec(letter, line);
  if (opts.open) await opts.open(spec);
  else await lanternMessage(spec);
}
