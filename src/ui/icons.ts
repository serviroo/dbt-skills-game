/** Crisp geometric SVG emblems drawn in code (no image assets). */

export const ICON_LETTER = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <linearGradient id="lg-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffec7"/><stop offset=".45" stop-color="#f9c58c"/><stop offset="1" stop-color="#ac9173"/>
    </linearGradient>
  </defs>
  <rect x="18" y="32" width="84" height="58" rx="3" fill="#0d1120" stroke="url(#lg-gold)" stroke-width="2.2"/>
  <path d="M19 34 L60 66 L101 34" fill="none" stroke="url(#lg-gold)" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M19 89 L48 60 M101 89 L72 60" fill="none" stroke="#c9a45c" stroke-opacity=".55" stroke-width="1.4"/>
  <circle cx="60" cy="66" r="10.5" fill="#1a1222" stroke="url(#lg-gold)" stroke-width="2"/>
  <path d="M60 59.5 L66 66 L60 72.5 L54 66 Z" fill="#f9c58c"/>
</svg>`;

export const ICON_LANTERN = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <rect x="20" y="30" width="80" height="60" fill="#071424" stroke="#7d96c5" stroke-width="1.6"/>
  <path d="M14 26 H106 M14 94 H106" stroke="#4fb8ff" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M26 36 h8 M26 36 v8 M94 36 h-8 M94 36 v8 M26 84 h8 M26 84 v-8 M94 84 h-8 M94 84 v-8" stroke="#a8ddff" stroke-width="1.6" fill="none"/>
  <circle cx="60" cy="60" r="15" fill="none" stroke="#d2f4ff" stroke-width="2.6"/>
  <path d="M60 51 v11" stroke="#d2f4ff" stroke-width="3.2" stroke-linecap="round"/>
  <circle cx="60" cy="68.5" r="2" fill="#d2f4ff"/>
</svg>`;

/** A folded paper star: five creased points, lit along the folds. */
export const ICON_STAR = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <path d="M60 16 L72 46 L104 48 L79 68 L88 100 L60 82 L32 100 L41 68 L16 48 L48 46 Z" fill="#1a2238" stroke="#e8d8a8" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M60 16 L60 60 M104 48 L60 60 M88 100 L60 60 M32 100 L60 60 M16 48 L60 60" fill="none" stroke="#c9a45c" stroke-opacity=".7" stroke-width="1.1"/>
  <path d="M60 16 L72 46 L60 60 Z M104 48 L79 68 L60 60 Z M88 100 L60 82 L60 60 Z M32 100 L41 68 L60 60 Z M16 48 L48 46 L60 60 Z" fill="#f4e6bf" fill-opacity=".14"/>
  <circle cx="60" cy="60" r="2.2" fill="#fff4d6"/>
</svg>`;

/** Fallback moth (the daily module ships the full drawing; this is replaced when available). */
export const ICON_MOTH = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <g fill="#121a33" stroke="#c1b3fc" stroke-width="1.8" stroke-linejoin="round">
    <path d="M60 50 C72 38 92 32 106 36 C108 50 102 62 94 68 C82 70 70 64 60 58 Z"/><path d="M60 50 C48 38 28 32 14 36 C12 50 18 62 26 68 C38 70 50 64 60 58 Z"/>
    <path d="M60 60 C70 66 84 72 84 84 C80 94 68 94 62 84 Z"/><path d="M60 60 C50 66 36 72 36 84 C40 94 52 94 58 84 Z"/>
  </g>
  <ellipse cx="60" cy="66" rx="4" ry="16" fill="#121a33" stroke="#c1b3fc" stroke-width="1.6"/>
  <circle cx="60" cy="44" r="5" fill="#121a33" stroke="#c1b3fc" stroke-width="1.6"/>
  <path d="M58 40 C55 32 50 27 44 25 M62 40 C65 32 70 27 76 25" fill="none" stroke="#c1b3fc" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M57 44 q1.4 1.4 2.4 0 M60.6 44 q1.4 1.4 2.4 0" fill="none" stroke="#89cf9d" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

/** Thin gold rule with a lantern diamond at its centre. */
export const FLOURISH = `<svg viewBox="0 0 220 60" aria-hidden="true" fill="none">
  <path d="M6 36 L88 36 M132 36 L214 36" stroke="#c9a45c" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M110 18 L124 36 L110 54 L96 36 Z" stroke="#c9a45c" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M110 28 L116 36 L110 44 L104 36 Z" fill="#c9a45c" fill-opacity=".55"/>
  <circle cx="78" cy="36" r="2.2" fill="#c9a45c"/><circle cx="142" cy="36" r="2.2" fill="#c9a45c"/>
  <path d="M40 44 L99 44 M121 44 L180 44" stroke="#ac9173" stroke-width="1" stroke-linecap="round" stroke-opacity=".5"/>
</svg>`;
