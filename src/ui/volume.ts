/**
 * The speaker control: a small Lantern-window popover with Master, Music and Effects sliders (and Hum in the
 * companion) plus Mute, reachable on
 * every cutscene beat (top-left, beside the skip button's layer) and in the companion's top bar and Settings.
 */
import '../styles/volume.css';
import { onMotion, params } from '../core/params';
import type { AudioLevels, VolumeCtrl } from '../audio/prefs';

export type { VolumeCtrl } from '../audio/prefs';

type Key = 'master' | 'music' | 'sfx' | 'hum';
const ROWS: [Key, string][] = [
  ['master', 'Master'],
  ['music', 'Music'],
  ['sfx', 'Effects'],
];
/** The low hum's own level, shown where the hum can play: the companion, not the intro. */
const HUM_ROW: [Key, string] = ['hum', 'Hum'];
const STOP = ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup'];
/** The keys the control acts on: pressing its buttons and moving its sliders. */
const OWN_KEYS = new Set([' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
let uid = 0;

const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/**
 * Keeps touches, and the keys the control acts on, from reaching the cutscene (continue, chest hold) or the companion.
 * Any other key (Escape while the popover is closed) goes on to whatever else is open.
 */
function isolate(root: HTMLElement, ctrl: VolumeCtrl) {
  let unlocked = false;
  for (const t of STOP)
    root.addEventListener(t, (e) => {
      if (t === 'pointerdown' && !unlocked) {
        unlocked = true;
        ctrl.unlock?.();
      }
      if (e instanceof KeyboardEvent && !OWN_KEYS.has(e.key)) return;
      e.stopPropagation();
    });
}

/** Speaker glyph: thin strokes, 0-3 waves by the master level, a short slash when silent. */
export function speakerSVG(l: AudioLevels) {
  const silent = l.muted || l.master <= 0;
  const waves = silent ? 0 : l.master < 0.34 ? 1 : l.master < 0.67 ? 2 : 3;
  const arcs = ['M15 9.6a3.4 3.4 0 0 1 0 4.8', 'M17.4 7.4a6.6 6.6 0 0 1 0 9.2', 'M19.8 5.2a9.8 9.8 0 0 1 0 13.6'].slice(0, waves);
  return `<svg class="vol-ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
<path d="M3.8 9.4h3.4L11.6 5.8v12.4L7.2 14.6H3.8z"/>${arcs.map((d) => `<path d="${d}"/>`).join('')}${silent ? '<path d="M15.2 9.2l5 5.6"/>' : ''}</svg>`;
}

export type VolumeSliders = HTMLElement & { dispose(): void; focusFirst(): void };

/** The sliders (Hum too when `hum`) and the Mute button. Used inside the popover and inline in the companion's Settings. */
export function volumeSliders(ctrl: VolumeCtrl, o: { compact?: boolean; hum?: boolean } = {}): VolumeSliders {
  const root = el('div', `vol-sl${o.compact ? ' vol-sl--compact' : ''}`, { role: 'group', 'aria-label': 'Sound levels' }) as unknown as VolumeSliders;
  const n = ++uid;
  const inputs = new Map<Key, { input: HTMLInputElement; out: HTMLOutputElement }>();
  for (const [k, label] of o.hum ? [...ROWS, HUM_ROW] : ROWS) {
    const id = `vol-${k}-${n}`;
    const row = el('div', 'vol-row');
    const head = el('div', 'vol-row-h');
    const lab = el('label', 'vol-l', { for: id });
    lab.textContent = label;
    const out = el('output', 'vol-v', { for: id, 'aria-hidden': 'true' });
    head.append(lab, out);
    const input = el('input', 'vol-range', { type: 'range', id, min: '0', max: '100', step: '1' });
    row.append(head, input);
    root.append(row);
    inputs.set(k, { input, out });
    // A finger on a slider waits for its first clear move to tell what it is, and the level holds until then, whatever
    // the browser's own range does under the finger (Chrome's jumps to it): up or down is the panel scrolling past (the
    // browser takes that touch, and it changes nothing), sideways is a drag, and a lift without one is a tap. iOS moves
    // a native range only by its thumb, so a tap on the track jumps there and a drag that started on the track follows
    // the finger; a drag on the thumb stays native
    let drag = -1;
    let press: { id: number; x: number; y: number; thumb: boolean } | null = null;
    // the level a finger's touch holds the slider at until it shows what it is, and for the rest of a touch that scrolls
    let hold: string | null = null;
    input.addEventListener('input', () => {
      if (hold !== null) input.value = hold;
      else ctrl.set({ [k]: Number(input.value) / 100 }, { persist: false });
    });
    input.addEventListener('change', () => {
      if (hold === null) ctrl.set({ [k]: Number(input.value) / 100 }, { persist: true });
    });
    input.addEventListener('keydown', () => (hold = null));
    // and ends with that touch, once the browser's own change at its end has gone by: a screen reader sets the level
    // next with no press at all
    const release = () => setTimeout(() => !press && (hold = null));
    input.addEventListener('touchend', release, { passive: true });
    input.addEventListener('touchcancel', release, { passive: true });
    const valueAt = (x: number) => {
      const r = input.getBoundingClientRect();
      const half = 7;
      const f = (x - r.left - half) / Math.max(1, r.width - half * 2);
      return Math.round(Math.max(0, Math.min(1, f)) * 100);
    };
    const put = (v: number) => {
      if (Number(input.value) === v) return;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    input.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      hold = null;
      const r = input.getBoundingClientRect();
      const thumbX = r.left + 7 + (Number(input.value) / 100) * (r.width - 14);
      const thumb = Math.abs(e.clientX - thumbX) <= 12;
      if (e.pointerType === 'mouse') {
        if (!thumb) put(valueAt(e.clientX));
        return;
      }
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, thumb };
      hold = input.value;
    });
    // a sideways move from the track: the finger drags the slider, which follows it from here
    const follow = (e: PointerEvent) => {
      drag = e.pointerId;
      try {
        input.setPointerCapture(e.pointerId);
      } catch {
        /* capture unavailable: the slider still follows while the finger is on it */
      }
      put(valueAt(e.clientX));
    };
    input.addEventListener('pointermove', (e) => {
      if (e.pointerId === drag) return put(valueAt(e.clientX));
      if (e.pointerId !== press?.id) return;
      const dx = Math.abs(e.clientX - press.x);
      const dy = Math.abs(e.clientY - press.y);
      if (Math.max(dx, dy) < 8) return;
      const { thumb } = press;
      press = null;
      if (dy >= dx) return;
      hold = null;
      if (!thumb) follow(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === press?.id) {
        const { thumb } = press;
        press = null;
        // a tap, which on the track jumps there; or the browser took the touch to scroll, which keeps holding
        if (e.type === 'pointerup') {
          hold = null;
          if (!thumb) {
            put(valueAt(e.clientX));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
      if (e.pointerId === drag) {
        drag = -1;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      ctrl.flush();
    };
    input.addEventListener('pointerup', end);
    input.addEventListener('pointercancel', end);
  }
  const mute = el('button', 'vol-mute', { type: 'button', 'aria-pressed': 'false' });
  mute.addEventListener('click', () => ctrl.set({ muted: !ctrl.get().muted }, { persist: true }));
  root.append(mute);

  const sync = (l: AudioLevels) => {
    for (const [k, { input, out }] of inputs) {
      const v = pct(l[k]);
      if (Number(input.value) !== v) input.value = String(v);
      input.style.setProperty('--fill', `${v}%`);
      input.setAttribute('aria-valuetext', `${v} percent`);
      out.textContent = `${v}%`;
    }
    mute.textContent = l.muted ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-pressed', String(l.muted));
    root.classList.toggle('is-muted', l.muted);
  };
  sync(ctrl.get());
  const off = ctrl.subscribe(sync);
  root.dispose = off;
  root.focusFirst = () => inputs.get('master')!.input.focus({ preventScroll: true });
  return root;
}

export type VolumeButton = HTMLElement & { close(focus?: boolean): void; dispose(): void };

/** Help is one tap with the popover open too: a tap on the Safe Zone, Talk to someone now, a number to call or text, or the
 *  intro's Safe Zone and Skip closes the popover and lands. */
const ONE_TAP = '.dq-safe, .dq-sz-talk, a[href^="tel:"], a[href^="sms:"], .ui-ways button';

/** The speaker button and its Lantern-window popover. */
export function volumeButton(ctrl: VolumeCtrl, o: { placement: 'cutscene' | 'top'; align: 'left' | 'right' }): VolumeButton {
  const n = ++uid;
  const root = el('div', `vol vol--${o.placement} vol--${o.align}`) as unknown as VolumeButton;
  // in the companion the page's .is-still follows motion; in the intro it is kept current here
  const still = () => root.classList.toggle('vol--still', params.reduced);
  let offStill = () => {};
  if (o.placement === 'cutscene') {
    still();
    offStill = onMotion(still);
  }
  const popId = `vol-pop-${n}`;
  const btn = el('button', 'vol-btn', { type: 'button', 'aria-label': 'Sound settings', 'aria-expanded': 'false', 'aria-controls': popId });
  const pop = el('div', 'vol-pop', { id: popId, role: 'dialog', 'aria-label': 'Sound' });
  const frame = el('div', 'vol-frame', { 'aria-hidden': 'true' });
  frame.innerHTML = '<i class="vol-scan"></i><i class="vol-inset"></i><i class="vol-c tl"></i><i class="vol-c tr"></i><i class="vol-c bl"></i><i class="vol-c br"></i>';
  const head = el('div', 'vol-head');
  const title = el('span', 'vol-title');
  title.textContent = 'Sound';
  head.append(title);
  const sliders = volumeSliders(ctrl, { compact: true, hum: o.placement === 'top' });
  // the title and sliders scroll together inside the frame when the panel is shorter than they are
  const body = el('div', 'vol-body');
  body.append(head, sliders);
  pop.append(frame, body);
  root.append(btn, pop);
  isolate(root, ctrl);

  let open = false;
  let swallowUntil = 0;
  let swallowId: number | null = null;
  const place = () => {
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const w = pop.offsetWidth;
    let left = o.align === 'left' ? r.left : r.right - w;
    left = Math.max(14, Math.min(vw - 14 - w, left));
    // under the button and the rest of the bar it sits in, all of its rows when it wraps, so it never covers the Safe
    // Zone button beside it; what doesn't fit in the height left there scrolls inside it
    const bar = root.closest('header');
    const top = (bar ? Math.max(r.bottom, bar.getBoundingClientRect().bottom - parseFloat(getComputedStyle(bar).paddingBottom)) : r.bottom) + 8;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.maxHeight = `${Math.floor(vh - 14 - top)}px`;
  };
  const onOutside = (e: PointerEvent) => {
    if (!open || root.contains(e.target as Node)) return;
    close(false);
    if ((e.target as Element).closest(ONE_TAP)) return;
    // any other tap that dismisses the popover is spent on that: it never continues a window or charges the chest
    e.stopPropagation();
    swallowId = e.pointerId;
  };
  const onUpCapture = (e: PointerEvent) => {
    if (swallowId === null || e.pointerId !== swallowId) return;
    swallowId = null;
    if (e.type === 'pointercancel') return;
    swallowUntil = performance.now() + 600;
    e.stopPropagation();
  };
  const onClickCapture = (e: Event) => {
    if (performance.now() < swallowUntil && !root.contains(e.target as Node)) {
      swallowUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close(true);
    }
  };
  const onResize = () => open && place();
  const arm = (on: boolean) => {
    const f = on ? window.addEventListener : window.removeEventListener;
    f.call(window, 'pointerdown', onOutside as EventListener, true);
    f.call(window, 'keydown', onKey as EventListener, true);
    f.call(window, 'resize', onResize);
  };
  // the dismissing tap's pointerup and click are swallowed even after the popover has closed
  window.addEventListener('pointerup', onUpCapture as EventListener, true);
  window.addEventListener('pointercancel', onUpCapture as EventListener, true);
  window.addEventListener('click', onClickCapture, true);

  const show = () => {
    if (open) return;
    open = true;
    place();
    root.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    arm(true);
    sliders.focusFirst();
  };
  function close(focus = true) {
    if (!open) return;
    open = false;
    root.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    arm(false);
    ctrl.flush();
    if (focus && root.isConnected) btn.focus({ preventScroll: true });
  }
  btn.addEventListener('click', () => (open ? close(true) : show()));

  let drawn = '';
  const draw = (l: AudioLevels) => {
    const svg = speakerSVG(l);
    if (svg === drawn) return;
    drawn = svg;
    btn.innerHTML = svg;
    btn.classList.toggle('is-silent', l.muted || l.master <= 0);
  };
  draw(ctrl.get());
  const off = ctrl.subscribe(draw);
  root.close = (focus = false) => close(focus);
  root.dispose = () => {
    close(false);
    off();
    offStill();
    sliders.dispose();
    window.removeEventListener('pointerup', onUpCapture as EventListener, true);
    window.removeEventListener('pointercancel', onUpCapture as EventListener, true);
    window.removeEventListener('click', onClickCapture, true);
    root.remove();
  };
  return root;
}
