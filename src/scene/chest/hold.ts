import './hold.css';
import { animate, el, uiNow } from '../../ui/anim';
import { params } from '../../core/params';
import { SystemWindow, systemLayer } from '../../ui/system-window';
import { chestSounds } from './sounds';

export { chestSounds };

export interface HoldOpts {
  /** seconds of holding from empty to full (default 1.5) */
  durationSec?: number;
  onProgress(c: number): void;
  onStart?(): void;
  onRelease?(): void;
  /** prompt text (default "Hold to open") */
  label?: string;
  /** mount point (default #ui) */
  parent?: HTMLElement;
  /**
   * Frame source. Default: requestAnimationFrame. Pass `(fn) => stage.onUpdate(fn)` so progress follows the stage
   * clock frame-exactly (needed for ?capture).
   */
  onFrame?: (fn: () => void) => () => void;
  /** QA only: scripted presses as [downAt, upAt] in uiNow() seconds; upAt = Infinity holds to full. */
  script?: [number, number][];
}

// ---------------------------------------------------------------------------------------------------------------
// Haptics.
// iOS Safari has no Vibration API. Since Safari 17.4 / iOS 18 a native <input type="checkbox" switch> plays the
// system haptic when toggled, and a programmatic label.click() on its label toggles it too (the cobalt.tools /
// ios-haptics trick). Reported limits: it is a non-standard quirk; WebKit may close it (one tester reports the
// programmatic path patched in iOS 26.5 while a real tap on a real switch still ticks). So we do both: a hidden
// label we click programmatically (start, 50 %, 100 %), and the real hit area of the overlay IS a switch, so her own
// tap toggles it natively (a tick on release, which survives the patch). Elsewhere: navigator.vibrate when present.

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let hapticLabel: HTMLLabelElement | null = null;

function hapticEl() {
  if (hapticLabel) return hapticLabel;
  const id = 'chest-haptic-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = id;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  const label = document.createElement('label');
  label.htmlFor = id;
  label.setAttribute('aria-hidden', 'true');
  label.className = 'ch-haptic';
  label.append(input);
  // the synthetic clicks must never reach app-level tap handlers
  label.addEventListener('click', (e) => e.stopPropagation());
  document.body.append(label);
  hapticLabel = label;
  return label;
}

export function haptic(kind: 'tick' | 'full' = 'tick') {
  if (params.capture) return;
  try {
    if (typeof navigator.vibrate === 'function' && !isIOS) {
      navigator.vibrate(kind === 'full' ? [18, 40, 26] : 10);
      return;
    }
    if (isIOS) hapticEl().click();
  } catch {
    /* haptics are a nicety; never let them break the hold */
  }
}

// ---------------------------------------------------------------------------------------------------------------

const R = 54;
const CIRC = 2 * Math.PI * R;
/** the falling star's head (viewBox units) and its trail angle (up-left, the way it came from) */
const SX = 68, SY = 68;
const TRAIL_DEG = 225;

/** Four-point star with concave sides: tall points `h`, side points `w`, waist `k`. */
const star4 = (cx: number, cy: number, h: number, w: number, k: number) =>
  `M${cx} ${cy - h}Q${cx + k} ${cy - k} ${cx + w} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + h}Q${cx - k} ${cy + k} ${cx - w} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - h}Z`;

function markup(label: string) {
  return `
  <input class="ch-hit" type="checkbox" switch tabindex="-1" aria-hidden="true">
  <div class="ch-dock">
    <div class="ch-target" role="button" tabindex="0" aria-label="${label}. Press and hold, or hold Space.">
      <div class="ch-bloom"></div>
      <svg class="ch-ring" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="chGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fffec7"/>
            <stop offset=".45" stop-color="#f9c58c"/>
            <stop offset="1" stop-color="#c9a45c"/>
          </linearGradient>
          <linearGradient id="chTrail" gradientUnits="userSpaceOnUse" x1="2" y1="0" x2="45" y2="0">
            <stop offset="0" stop-color="#fffdf0" stop-opacity="1"/>
            <stop offset=".28" stop-color="#f9d9a6" stop-opacity=".9"/>
            <stop offset=".66" stop-color="#c9a45c" stop-opacity=".42"/>
            <stop offset="1" stop-color="#c9a45c" stop-opacity="0"/>
          </linearGradient>
          <filter id="chSoft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4"/></filter>
          <filter id="chSoft2" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.6"/></filter>
          <linearGradient id="chStar" x1=".5" y1="0" x2=".5" y2="1">
            <stop offset="0" stop-color="#fffec7"/>
            <stop offset=".5" stop-color="#f3d39a"/>
            <stop offset="1" stop-color="#c9a45c"/>
          </linearGradient>
        </defs>
        <circle class="ch-plate" cx="60" cy="60" r="${R - 3}"/>
        <circle class="ch-track" cx="60" cy="60" r="${R}"/>
        <circle class="ch-track2" cx="60" cy="60" r="${R + 5}"/>
        <g class="ch-ticks">
          <path d="M60 1.5v5"/><path d="M60 113.5v5"/><path d="M1.5 60h4"/><path d="M114.5 60h4"/>
        </g>
        <circle class="ch-fill" cx="60" cy="60" r="${R}" transform="rotate(-90 60 60)"
          stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${CIRC.toFixed(2)}"/>
        <path class="ch-head" d="${star4(0, 0, 4.6, 3.1, 0.7)}" transform="translate(60 ${60 - R})"/>
        <g class="ch-fall">
          <g class="ch-trail" transform="translate(${SX} ${SY}) rotate(${TRAIL_DEG})">
            <g class="ch-trail-k">
              <path class="ch-tr-glow" d="M2 -8 L34 -2.2 Q46 0 34 2.2 L2 8 Z" filter="url(#chSoft)"/>
              <path class="ch-tr-main" d="M2 -4.8 L39 -0.75 Q45 0 39 0.75 L2 4.8 Z"/>
              <path class="ch-tr-line" d="M11 -7.4 L33 -5.3"/>
              <path class="ch-tr-line" d="M14 7.2 L29 5.8"/>
              <path class="ch-crumb" d="${star4(30, -8.6, 2.2, 1.6, 0.36)}"/>
              <path class="ch-crumb ch-crumb2" d="${star4(43, 4.6, 1.7, 1.2, 0.3)}"/>
            </g>
          </g>
          <g class="ch-star">
            <path class="ch-star-halo" d="${star4(SX, SY, 21, 15, 3.6)}" filter="url(#chSoft)"/>
            <path class="ch-star-glow" d="${star4(SX, SY, 15.5, 11, 2.3)}" filter="url(#chSoft2)"/>
            <path class="ch-star-body" d="${star4(SX, SY, 15.5, 11, 2.3)}"/>
            <path class="ch-star-core" d="${star4(SX, SY, 7.4, 5.2, 1.05)}"/>
          </g>
        </g>
      </svg>
      <div class="ch-pulse"></div>
    </div>
    <div class="ch-chip"><i></i><span>${label}</span><i></i></div>
  </div>`;
}

/**
 * Hold-to-charge overlay. Resolves when the charge reaches 100 %. Releasing early drains over 300-400 ms with no
 * penalty; she can press again at any time and continue from where the drain is.
 */
export function holdToCharge(opts: HoldOpts): Promise<void> {
  const dur = Math.max(0.2, opts.durationSec ?? 1.5);
  const reduced = params.reduced;
  const label = opts.label ?? 'Hold to open';
  const root = el('div', 'chest-hold') as HTMLDivElement;
  root.innerHTML = markup(label);
  (opts.parent ?? document.getElementById('ui') ?? document.body).append(root);
  const hit = root.querySelector<HTMLInputElement>('.ch-hit')!;
  const target = root.querySelector<HTMLDivElement>('.ch-target')!;
  const fill = root.querySelector<SVGCircleElement>('.ch-fill')!;
  const head = root.querySelector<SVGPathElement>('.ch-head')!;
  const trailK = root.querySelector<SVGGElement>('.ch-trail-k')!;
  const fall = root.querySelector<SVGGElement>('.ch-fall')!;
  const star = root.querySelector<SVGGElement>('.ch-star')!;
  const lines = Array.from(root.querySelectorAll<SVGPathElement>('.ch-tr-line'));
  const chip = root.querySelector<HTMLDivElement>('.ch-chip')!;
  const pulse = root.querySelector<HTMLDivElement>('.ch-pulse')!;

  // ---- charge as a pure function of the press log
  let level = 0; // charge at the last event
  let since = uiNow(); // time of the last event
  let pressed = false;
  let crossedHalf = false;
  let done = false;
  let lastC = -1;
  const drainDur = (c: number) => 0.3 + 0.1 * c;
  const valueAt = (now: number) => {
    const dt = Math.max(0, now - since);
    if (pressed) return Math.min(1, level + dt / dur);
    const dd = drainDur(level);
    const k = Math.min(1, dt / dd);
    return level * (1 - (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2));
  };
  const setPressed = (down: boolean, at: number) => {
    if (done || down === pressed) return;
    level = valueAt(at);
    since = at;
    pressed = down;
    root.classList.toggle('is-pressed', down);
    if (down) {
      crossedHalf = level >= 0.5;
      haptic('tick');
      opts.onStart?.();
    } else {
      opts.onRelease?.();
    }
  };

  let resolveP!: () => void;
  const promise = new Promise<void>((r) => (resolveP = r));

  // ---- input: pointer anywhere on the overlay, keyboard Space / Enter
  const pointers = new Set<number>();
  let keyHeld = false;
  // after full she is usually still holding: swallow that pointer and key (and its auto-repeat) until released,
  // so the release can never dismiss the reward window that opens next
  let finished = false;
  const maybeCleanup = () => {
    if (finished && !pointers.size && !keyHeld) cleanup();
  };
  const onDown = (e: PointerEvent) => {
    if (done) {
      e.stopPropagation();
      return;
    }
    pointers.add(e.pointerId);
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic events have no capturable pointer */
    }
    setPressed(true, uiNow());
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (done) {
      e.stopPropagation();
      maybeCleanup();
      return;
    }
    if (!pointers.size && !keyHeld) setPressed(false, uiNow());
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (done) {
      if (keyHeld) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    e.preventDefault();
    keyHeld = true;
    if (e.repeat) return;
    setPressed(true, uiNow());
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    const was = keyHeld;
    keyHeld = false;
    if (done) {
      if (was) e.stopImmediatePropagation();
      maybeCleanup();
      return;
    }
    if (!pointers.size) setPressed(false, uiNow());
  };
  const onBlur = () => {
    pointers.clear();
    keyHeld = false;
    if (done) maybeCleanup();
    else setPressed(false, uiNow());
  };
  const onVis = () => document.hidden && onBlur();
  const noMenu = (e: Event) => e.preventDefault();
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('lostpointercapture', onUp as EventListener);
  root.addEventListener('contextmenu', noMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  // keep the native switch from scrolling or zooming; its toggle is only there for the haptic
  hit.addEventListener('click', (e) => e.stopPropagation());

  // ---- scripted presses (QA): applied at their exact times, so seeking stays correct
  const script = (opts.script ?? []).flatMap(([a, b]) => [{ t: a, down: true }, { t: b, down: false }]).sort((x, y) => x.t - y.t);
  let si = 0;

  // ---- entry
  if (reduced) {
    animate(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' });
  } else {
    animate(target, [{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    animate(chip, [{ opacity: 0, clipPath: 'inset(0 50% 0 50%)' }, { opacity: 1, clipPath: 'inset(0 0% 0 0%)' }], { duration: 260, delay: 120, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }
  const born = uiNow();

  function render(c: number, now: number) {
    const off = CIRC * (1 - c);
    fill.setAttribute('stroke-dashoffset', off.toFixed(2));
    const a = c * Math.PI * 2 - Math.PI / 2;
    head.setAttribute('transform', `translate(${(60 + Math.cos(a) * R).toFixed(2)} ${(60 + Math.sin(a) * R).toFixed(2)})`);
    const breath = 0.5 + 0.5 * Math.sin(Math.PI * 2 * 0.25 * (now - born) - Math.PI / 2);
    // the star keeps falling in place: the trail stretches with the charge and its speed lines stream back
    const b = reduced ? 0.5 : breath;
    const ce = c * c * (3 - 2 * c);
    trailK.setAttribute('transform', `scale(${(0.78 + 0.26 * ce + 0.04 * b).toFixed(3)} ${(0.94 + 0.1 * ce).toFixed(3)})`);
    const drop = reduced ? 0 : (b - 0.5) * 1.6 + ce * 1.4;
    fall.setAttribute('transform', `translate(${(drop * 0.707).toFixed(2)} ${(drop * 0.707).toFixed(2)})`);
    const sk = 1 + 0.1 * ce + (reduced ? 0 : 0.025 * (b - 0.5));
    star.setAttribute('transform', `translate(${SX} ${SY}) scale(${sk.toFixed(4)}) translate(${-SX} ${-SY})`);
    const flow = reduced ? 0 : -((now - born) * (9 + 30 * ce)) % 20;
    for (const l of lines) l.setAttribute('stroke-dashoffset', flow.toFixed(2));
    root.style.setProperty('--c', c.toFixed(4));
    root.style.setProperty('--breath', (reduced ? 0.5 : breath).toFixed(4));
  }

  function finish(at: number) {
    done = true;
    pressed = false;
    root.classList.remove('is-pressed');
    root.classList.add('is-full');
    haptic('full');
    chestSounds.full?.();
    opts.onProgress(1);
    render(1, at);
    if (!reduced) animate(pulse, [{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.45)' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    const out = animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 190, delay: 0, easing: 'ease-out' });
    chestSounds.charge?.(1);
    const after = () => {
      finished = true;
      maybeCleanup();
    };
    out.finished.then(after, after);
    resolveP();
  }

  let stop: () => void = () => {};
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    stop();
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVis);
    root.remove();
  }

  function tick() {
    if (done) return;
    const now = uiNow();
    while (si < script.length && script[si].t <= now) {
      const ev = script[si++];
      setPressed(ev.down, ev.t);
    }
    // exact full time while pressed
    if (pressed) {
      const fullAt = since + (1 - level) * dur;
      if (!crossedHalf) {
        const halfAt = since + (0.5 - level) * dur;
        if (now >= halfAt) {
          crossedHalf = true;
          haptic('tick');
        }
      }
      if (now >= fullAt) {
        finish(fullAt);
        return;
      }
    }
    const c = valueAt(now);
    if (Math.abs(c - lastC) > 1e-5) {
      lastC = c;
      opts.onProgress(c);
      chestSounds.charge?.(c);
    }
    render(c, now);
  }

  if (opts.onFrame) stop = opts.onFrame(tick);
  else {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      tick();
    };
    raf = requestAnimationFrame(loop);
    stop = () => cancelAnimationFrame(raf);
  }
  render(0, born);
  // focus for keyboard users without stealing the page scroll
  if (!params.capture) target.focus({ preventScroll: true });
  return promise;
}

/** "[SYSTEM] Reward unlocked." Opens the gold reward window and returns it (the caller waits for input or closes it). */
export async function showRewardUnlocked(spec: { title?: string; html?: string; tapToContinue?: boolean } = {}) {
  const w = new SystemWindow(systemLayer(), {
    kind: 'reward',
    title: spec.title ?? 'System',
    icon: 'reward',
    html: spec.html ?? `<p class="center">Reward unlocked.</p>`,
    tapToContinue: spec.tapToContinue ?? true,
  });
  await w.open();
  return w;
}
