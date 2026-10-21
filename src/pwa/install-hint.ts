import './install-hint.css';
import { SystemWindow, windowSounds } from '../ui/system-window';
import { animate, el, finished, uiNow, wait } from '../ui/anim';
import { params } from '../core/params';

const KEY = 'system.pwa.installHint';

const SHARE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 9.5H6.8a1.3 1.3 0 0 0-1.3 1.3v8.4a1.3 1.3 0 0 0 1.3 1.3h10.4a1.3 1.3 0 0 0 1.3-1.3v-8.4a1.3 1.3 0 0 0-1.3-1.3h-1.7M12 14.5V3.2M8.4 6.6 12 3l3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ADD = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const MORE = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18" cy="12" r="1.7" fill="currentColor"/></svg>`;

const glyph = (svg: string) => `<span class="pwa-glyph">${svg}</span>`;

function isIOSSafari() {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // other iOS browsers and in-app views put Share somewhere else (or not at all)
  const otherShell = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\/|Instagram|FBAN|FBAV|Line\/|Snapchat|Twitter|Discord/i.test(ua);
  return iOS && /Safari\//.test(ua) && !otherShell;
}

function isStandalone() {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
}

function seen(): boolean | null {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return null;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, 'dismissed');
  } catch {
    /* private mode: the check above already kept the hint away */
  }
}

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

/** True when the UI clock (stage time) is running. The quiet companion pauses the stage, which freezes wait(). */
async function clockRuns() {
  if (params.capture) return true;
  const t0 = uiNow();
  for (let i = 0; i < 3; i++) await frame();
  return uiNow() !== t0;
}

/** Page-clock delay, only for when the stage clock is frozen. */
async function realWait(sec: number) {
  const start = performance.now();
  while (performance.now() - start < sec * 1000) await frame();
}

let active = false;

/**
 * A one-time, quiet note that the System can live on her Home Screen. Only in iOS Safari outside the installed app,
 * only until she dismisses it once, and never when storage can't remember that. Resolves true once she dismissed it,
 * false when it wasn't shown. Call it at a calm moment (end card, companion home), never during the cutscene.
 */
export async function maybeShowInstallHint(opts: { delay?: number; force?: boolean } = {}): Promise<boolean> {
  if (active) return false;
  if (!opts.force) {
    if (!isIOSSafari() || isStandalone()) return false;
    if (seen() !== false) return false;
  }
  active = true;
  try {
    return await show(opts.delay ?? 0);
  } finally {
    active = false;
  }
}

async function show(delay: number) {
  const live = await clockRuns();
  const pause = live ? wait : realWait;
  if (delay) await pause(delay);

  let layer = document.querySelector<HTMLDivElement>('.pwa-hint-layer');
  if (!layer) {
    layer = el('div', 'pwa-hint-layer') as HTMLDivElement;
    (document.getElementById('ui') ?? document.body).append(layer);
  }
  const win = new SystemWindow(layer, {
    kind: 'info',
    icon: 'info',
    title: 'Notification',
    html: `
      <p class="center">Keep the System on your Home Screen. It opens full screen, even offline.</p>
      <ol class="pwa-steps">
        <li><span class="n">1</span><span>Tap <span class="nw">${glyph(SHARE)}<b>Share</b></span></span></li>
        <li><span class="n">2</span><span>Choose <span class="nw">${glyph(ADD)}<b>Add to Home Screen</b></span></span></li>
      </ol>
      <p class="center pwa-note">Share can hide in Safari's ${glyph(MORE)} menu.</p>`,
    actions: [{ label: 'Got it', value: 'ok', variant: 'quiet' }],
  });
  win.root.classList.add('pwa-hint');
  win.root.setAttribute('role', 'region');

  // a hint arrives without a chime; her own tap still answers with one
  const chime = windowSounds.open;
  windowSounds.open = undefined;
  const opening = win.open();
  windowSounds.open = chime;
  // listen right away: open() ends on a stage-clock wait that never resolves while the stage is paused
  const answered = win.waitForInput();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') (win.root.querySelector('.sw-btn') as HTMLButtonElement | null)?.click();
  };
  window.addEventListener('keydown', onKey);
  await answered;
  window.removeEventListener('keydown', onKey);
  remember();
  const closing = win.close();
  if (live) {
    await opening;
    await closing;
  } else {
    // the measured collapse still plays on the page clock; finish it here instead of waiting on stage time
    await realWait(0.19);
    if (win.root.isConnected) {
      await finished(animate(win.root, [{ opacity: 1, filter: 'brightness(1.4)' }, { opacity: 0, filter: 'brightness(1)' }], { duration: 140, easing: 'ease-out' }));
      win.destroy();
    }
  }
  return true;
}
