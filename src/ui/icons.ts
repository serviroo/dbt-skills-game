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

export const ICON_SYSTEM = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <rect x="20" y="30" width="80" height="60" fill="#071424" stroke="#7d96c5" stroke-width="1.6"/>
  <path d="M14 26 H106 M14 94 H106" stroke="#4fb8ff" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M26 36 h8 M26 36 v8 M94 36 h-8 M94 36 v8 M26 84 h8 M26 84 v-8 M94 84 h-8 M94 84 v-8" stroke="#a8ddff" stroke-width="1.6" fill="none"/>
  <circle cx="60" cy="60" r="15" fill="none" stroke="#d2f4ff" stroke-width="2.6"/>
  <path d="M60 51 v11" stroke="#d2f4ff" stroke-width="3.2" stroke-linecap="round"/>
  <circle cx="60" cy="68.5" r="2" fill="#d2f4ff"/>
</svg>`;

/** A leaf folded into a butterfly: two pairs of leaf wings with midribs. */
export const ICON_BUTTERFLY = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <g stroke="#c9e8b8" stroke-width="1.4" stroke-linejoin="round">
    <path d="M60 58 C44 30 18 26 16 40 C14 54 34 62 60 60 Z" fill="#2f5a43"/>
    <path d="M60 58 C76 30 102 26 104 40 C106 54 86 62 60 60 Z" fill="#2f5a43"/>
    <path d="M60 62 C46 70 32 88 40 94 C48 100 58 82 60 64 Z" fill="#24493a"/>
    <path d="M60 62 C74 70 88 88 80 94 C72 100 62 82 60 64 Z" fill="#24493a"/>
  </g>
  <g fill="none" stroke="#89cf9d" stroke-width="1" stroke-opacity=".8">
    <path d="M58 58 C46 46 32 40 22 40"/><path d="M62 58 C74 46 88 40 98 40"/>
    <path d="M59 64 C52 74 46 84 42 92"/><path d="M61 64 C68 74 74 84 78 92"/>
  </g>
  <path d="M60 50 V76" stroke="#e7f6dc" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M60 50 C57 44 54 40 50 38 M60 50 C63 44 66 40 70 38" fill="none" stroke="#c9e8b8" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

/** Fallback seahorse (the daily module ships the canonical one; this is replaced when available). */
export const ICON_SEAHORSE = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <path d="M66 18 C80 18 88 30 84 42 C81 50 74 52 70 58 C66 64 70 72 74 78 C80 88 74 102 62 102 C52 102 48 94 52 88 C55 84 60 86 60 90 C60 94 56 95 55 93
    M66 18 C58 18 52 24 50 30 L36 34 L50 38 C48 46 52 52 58 54" fill="#121a33" stroke="#c1b3fc" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M66 26 C70 23 76 24 78 28" fill="none" stroke="#c1b3fc" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M60 60 C56 66 58 74 62 80" fill="none" stroke="#7b6ed0" stroke-width="1.4" stroke-dasharray="2 3"/>
  <path d="M64 33 q4 2 7 0" fill="none" stroke="#89cf9d" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M80 40 q6 2 8 -2" fill="none" stroke="#c1b3fc" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

/** Thin gold cloud-scroll curl (her offline-screen motif), drawn as one stroke. */
export const CLOUD_CURL = `<svg viewBox="0 0 220 60" aria-hidden="true" fill="none">
  <path d="M4 44 C30 44 40 30 58 30 C74 30 80 44 70 50 C62 55 52 48 58 40 C64 32 80 34 90 40 C104 48 120 46 130 34 C140 22 160 20 170 30 C178 38 172 50 162 48 C154 46 156 36 164 34
           C178 30 196 38 216 38" stroke="#c9a45c" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M30 52 C48 54 60 54 74 58" stroke="#ac9173" stroke-width="1" stroke-linecap="round" stroke-opacity=".7"/>
</svg>`;
