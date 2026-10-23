/**
 * Two quiet screens.
 *   ease:   what a heavy check-in opens first. Comfort only: no skill name, no XP, no question, no reason field.
 *   moment: "Give me a moment". Dim screen, a slow 4-in 6-out ring, calm lines one at a time at speaking pace.
 *           No questions, no chips, no XP shown, exit any time, optional low hum (off by default).
 */
import { animate } from '../ui/anim';
import { type Next } from '../content/dbt';
import { CHECKIN } from '../content/daily-lines';
import type { App, Route, ScreenOut } from './app';
import { icon, mothSVG } from './art';
import { now, onFrame } from './clock';
import { btn, h, toggle, typo } from './ui';
import { isSkillId } from './store';

export function goNext(app: App, n: Next, replace = false) {
  if (n.to === 'rest') return app.go({ name: 'rest' }, { replace });
  if (n.to === 'moment') return app.go({ name: 'moment', then: n.then }, { replace });
  if (!isSkillId(n.id)) return app.go({ name: 'rest' }, { replace });
  return app.go({ name: 'skill', id: n.id, entry: n.entry }, { replace });
}

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag: string, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
const INHALE = 4;
const EXHALE = 6;
/** 0..1 breath size at time e (seconds): rises over 4 s, falls over 6 s. */
const breath = (e: number) => {
  const c = e % (INHALE + EXHALE);
  return c < INHALE ? ease(c / INHALE) : 1 - ease((c - INHALE) / EXHALE);
};

// ---------------- comfort-first (after a heavy check-in) ----------------
export function easeScreen(app: App, route: Route): ScreenOut {
  const r = route as Extract<Route, { name: 'ease' }>;
  const next: Next = r.next ?? { to: 'moment' };
  const glow = h('div', { class: 'dq-ease-glow', 'aria-hidden': 'true' });
  const sea = h('div', { class: 'dq-ease-sea', 'aria-hidden': 'true', html: mothSVG({ size: 72 }) });
  const [l1, l2] = CHECKIN.comfort;
  const small = next.to === 'rest' ? null : btn(CHECKIN.small, () => goNext(app, next), { kind: 'quiet' });
  const panelEl = h(
    'section',
    { class: 'dq-panel dq-ease-panel', 'aria-label': 'Lantern' },
    h('header', { class: 'dq-chip' }, h('span', { class: 'dq-chip-ic', html: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 L17 10 L10 17.5 L3 10 Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' }), h('h2', { class: 'dq-chip-t', text: 'Lantern' })),
    sea,
    h('p', { class: 'dq-ease-t', 'data-focus': '', text: typo(l1) }),
    h('p', { class: 'dq-ease-s', text: typo(l2) }),
    h('div', { class: 'dq-actions dq-actions--stack dq-ease-acts' }, btn(CHECKIN.stay, () => app.go({ name: 'rest' }), { kind: 'primary', ic: 'rest' }), small),
    h('button', { type: 'button', class: 'dq-ease-safe', onclick: () => app.go({ name: 'safe' }) }, h('span', { class: 'dq-ease-safe-ic', html: icon('safe') }), h('span', { text: 'Safe Zone' })),
  );
  const t0 = now();
  const stop = onFrame((t) => {
    const s = breath(t - t0);
    glow.style.opacity = String(0.4 + s * 0.6);
    if (!app.reduced()) {
      glow.style.transform = `translate(-50%, -50%) scale(${(0.88 + s * 0.2).toFixed(3)})`;
      sea.style.transform = `translateY(${(Math.sin((t - t0) * 0.45) * 4).toFixed(2)}px)`;
    }
  });
  const el = h('div', { class: 'dq-ease' }, h('h1', { class: 'dq-sr', text: 'A quiet minute' }), glow, panelEl);
  return { el, title: 'A quiet minute', mode: 'sub', bubbles: [1, 0.4], leave: () => stop() };
}

// ---------------- Give me a moment ----------------
/** A low, soft two-note hum that swells a little with the breath. Off by default; made only after the player turns it on. */
function lowHum(scale: number) {
  type AC = typeof AudioContext;
  const Ctor: AC | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  void ctx.resume?.();
  // two gains in a row, one writer each: the breath slowly swells `breath`, the player's volume glides `vol`
  const breath = ctx.createGain();
  breath.gain.value = 0;
  const vol = ctx.createGain();
  vol.gain.value = scale;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 360;
  lp.Q.value = 0.4;
  lp.connect(breath).connect(vol).connect(ctx.destination);
  const oscs = [
    [98, 'sine', 0.6],
    [98.6, 'sine', 0.35],
    [146.8, 'sine', 0.22],
    [196.4, 'triangle', 0.06],
  ].map(([f, type, g]) => {
    const o = ctx.createOscillator();
    o.type = type as OscillatorType;
    o.frequency.value = f as number;
    const gn = ctx.createGain();
    gn.gain.value = g as number;
    o.connect(gn).connect(lp);
    o.start();
    return o;
  });
  breath.gain.setTargetAtTime(0.05, ctx.currentTime, 0.8);
  let dead = false;
  return {
    setScale(s: number) {
      if (dead) return;
      // the glide the engine gives Master, Music and Effects (setUser: ramp 0.08 s, tau = ramp / 4), so no click
      vol.gain.setTargetAtTime(s, ctx.currentTime, 0.02);
    },
    breathe(s: number) {
      if (dead) return;
      breath.gain.setTargetAtTime(0.035 + s * 0.03, ctx.currentTime, 0.25);
      lp.frequency.setTargetAtTime(300 + s * 140, ctx.currentTime, 0.3);
    },
    stop() {
      if (dead) return;
      dead = true;
      breath.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      setTimeout(() => {
        oscs.forEach((o) => o.stop());
        void ctx.close();
      }, 1200);
    },
  };
}

const LINE_S = 7;

export function momentScreen(app: App, route: Route): ScreenOut {
  const r = route as Extract<Route, { name: 'moment' }>;
  const st = app.store;
  // a moment is rest: credited quietly once a day, never shown here
  if (!st.state.events.some((e) => e.k === 'rest' && e.day === st.today())) st.add('rest', 10);

  const svg = sv('svg', { viewBox: '0 0 200 200', class: 'dq-mo-svg', 'aria-hidden': 'true' });
  const defs = sv('defs');
  const grad = sv('radialGradient', { id: 'dqmo-g', cx: '50%', cy: '50%', r: '50%' });
  grad.append(
    sv('stop', { offset: '0', 'stop-color': '#a9dcff', 'stop-opacity': '0.3' }),
    sv('stop', { offset: '0.45', 'stop-color': '#4fb8ff', 'stop-opacity': '0.16' }),
    sv('stop', { offset: '0.82', 'stop-color': '#7b3fe4', 'stop-opacity': '0.1' }),
    sv('stop', { offset: '1', 'stop-color': '#7b3fe4', 'stop-opacity': '0' }),
  );
  defs.append(grad);
  const outer = sv('circle', { cx: 100, cy: 100, r: 93, fill: 'none', stroke: 'rgba(125,150,197,.22)', 'stroke-width': 1 });
  let ticks = '';
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, r1 = i % 10 === 0 ? 85 : 88, r2 = 90.5;
    ticks += `M${(100 + Math.cos(a) * r1).toFixed(2)} ${(100 + Math.sin(a) * r1).toFixed(2)}L${(100 + Math.cos(a) * r2).toFixed(2)} ${(100 + Math.sin(a) * r2).toFixed(2)}`;
  }
  const tickPath = sv('path', { d: ticks, stroke: 'rgba(150,200,240,.26)', 'stroke-width': 1, 'stroke-linecap': 'round' });
  const orb = sv('circle', { cx: 100, cy: 100, r: 60, fill: 'url(#dqmo-g)' });
  const line = sv('circle', { cx: 100, cy: 100, r: 52, fill: 'none', stroke: 'rgba(170,225,255,.7)', 'stroke-width': 1.2 });
  const echo = sv('circle', { cx: 100, cy: 100, r: 52, fill: 'none', stroke: 'rgba(124,200,255,.22)', 'stroke-width': 0.8 });
  svg.append(defs, outer, tickPath, orb, echo, line);

  const words = h('p', { class: 'dq-mo-line', 'aria-live': 'polite' });
  const after = r.then ? btn(CHECKIN.momentNext, () => {
    const [id, entry] = r.then!.split('@');
    goNext(app, { to: 'skill', id, entry });
  }, { kind: 'quiet', cls: 'dq-mo-next is-hidden' }) : null;
  let hum: ReturnType<typeof lowHum> = null;
  const humScale = () => {
    const l = app.opts.volume?.get();
    return l ? (l.muted ? 0 : l.master * l.sfx) : (st.state.settings.sound ? 1 : 0);
  };
  const offVolume = app.opts.volume?.subscribe(() => hum?.setScale(humScale()));
  const humToggle = toggle('Low hum', false, (on) => {
    if (on) hum = lowHum(humScale());
    else {
      hum?.stop();
      hum = null;
    }
  });
  humToggle.classList.add('dq-mo-hum');
  const done = btn('Done', () => app.back(), { kind: 'link', cls: 'dq-mo-done' });

  const t0 = now();
  let shown = -1;
  let passes = 0;
  const fades: Animation[] = [];
  const L = CHECKIN.moment;
  const stop = onFrame((t) => {
    const e = t - t0;
    const s = breath(e);
    const still = app.reduced();
    const rr = still ? 64 : 44 + s * 32;
    line.setAttribute('r', rr.toFixed(2));
    line.setAttribute('stroke-opacity', (0.55 + s * 0.4).toFixed(3));
    orb.setAttribute('r', (rr + 14).toFixed(2));
    orb.setAttribute('opacity', (still ? 0.35 + s * 0.65 : 0.75 + s * 0.25).toFixed(3));
    echo.setAttribute('r', (still ? 72 : rr + 6 + (1 - s) * 10).toFixed(2));
    echo.setAttribute('stroke-opacity', (0.15 + s * 0.35).toFixed(3));
    hum?.breathe(s);
    // one line at a time: a beat of quiet first, then a new line every LINE_S seconds
    const k = Math.floor((e - 1.2) / LINE_S);
    if (k >= 0 && k !== shown) {
      shown = k;
      const i = k % L.length;
      if (i === 0 && k > 0) passes++;
      words.textContent = typo(L[i]);
      fades.splice(0).forEach((a) => a.cancel());
      fades.push(
        animate(words, [{ opacity: 0, transform: still ? 'none' : 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: still ? 400 : 1300, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }),
        animate(words, [{ opacity: 1 }, { opacity: 0 }], { duration: 900, delay: (LINE_S - 1.1) * 1000, easing: 'ease-in', fill: 'forwards' }),
      );
      if (after && (passes > 0 || i === L.length - 1) && after.classList.contains('is-hidden')) {
        after.classList.remove('is-hidden');
        animate(after, [{ opacity: 0 }, { opacity: 1 }], { duration: 1200 });
      }
    }
  });

  const el = h(
    'div',
    { class: 'dq-moment' },
    h('h1', { class: 'dq-sr', 'data-focus': '', text: 'Give me a moment' }),
    h('div', { class: 'dq-mo-stage' }, h('div', { class: 'dq-mo-halo', 'aria-hidden': 'true' }), svg),
    words,
    h('div', { class: 'dq-mo-foot' }, after, h('div', { class: 'dq-mo-row' }, humToggle, done)),
  );
  return {
    el,
    title: 'Give me a moment',
    mode: 'sub',
    bubbles: [0.6, 0.3],
    leave: () => {
      stop();
      offVolume?.();
      hum?.stop();
      hum = null;
    },
  };
}
