// Single source of truth for the PWA images: scripts/icons.mjs draws them, the Vite plugin links the splash screens.

export const ICONS = [
  { file: 'icons/apple-touch-icon-180.png', size: 180, kind: 'any' },
  { file: 'icons/icon-192.png', size: 192, kind: 'any' },
  { file: 'icons/icon-512.png', size: 512, kind: 'any' },
  { file: 'icons/icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'icons/icon-maskable-1024.png', size: 1024, kind: 'maskable' },
  { file: 'icons/favicon-32.png', size: 32, kind: 'tiny' },
];

// iPhone screens in CSS points and device pixel ratio. Newer models share these sizes
// (18 Pro = 17 Pro = 402x874, 18 Pro Max = 17 Pro Max = 440x956).
export const SPLASH_DEVICES = [
  { w: 440, h: 956, dpr: 3, note: '16/17/18 Pro Max' },
  { w: 420, h: 912, dpr: 3, note: 'Air' },
  { w: 402, h: 874, dpr: 3, note: '16 Pro, 17, 17/18 Pro' },
  { w: 430, h: 932, dpr: 3, note: '14 Pro Max, 15 Plus/Pro Max, 16 Plus' },
  { w: 393, h: 852, dpr: 3, note: '14 Pro, 15, 15 Pro, 16' },
  { w: 428, h: 926, dpr: 3, note: '12/13 Pro Max, 14 Plus' },
  { w: 390, h: 844, dpr: 3, note: '12, 13, 14, 16e' },
  { w: 375, h: 812, dpr: 3, note: '11 Pro, 12/13 mini' },
  { w: 414, h: 896, dpr: 3, note: '11 Pro Max' },
  { w: 414, h: 896, dpr: 2, note: '11, XR' },
  { w: 375, h: 667, dpr: 2, note: 'SE 2/3, 8' },
];

export function splashImages() {
  const out = [];
  for (const d of SPLASH_DEVICES) {
    for (const orientation of ['portrait', 'landscape']) {
      const pw = d.w * d.dpr, ph = d.h * d.dpr;
      const [W, H] = orientation === 'portrait' ? [pw, ph] : [ph, pw];
      out.push({
        file: `splash/splash-${W}x${H}.png`,
        width: W,
        height: H,
        media: `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: ${orientation})`,
      });
    }
  }
  return out;
}

export function splashLinkTags(base = './') {
  return splashImages()
    .map((s) => `<link rel="apple-touch-startup-image" media="${s.media}" href="${base}${s.file}" />`)
    .join('\n    ');
}

// Content Security Policy for the built app. Only this origin; data: and blob: where canvas textures,
// three.js loaders and generated audio need them. Inline styles stay allowed because UI templates use
// style attributes (e.g. SVG transform-origin); nothing on the page renders text from outside.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Response headers for Cloudflare Pages and Netlify (both read <publish dir>/_headers); `base` is where the site is served.
export function headersFile(base = '/') {
  return `/*
  Content-Security-Policy: ${CSP}; frame-ancestors 'none'
  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()

${base}assets/*
  Cache-Control: public, max-age=31536000, immutable

${base}sw.js
  Cache-Control: no-cache

${base}manifest.webmanifest
  Cache-Control: no-cache
`;
}
