/**
 * Two quiet screens.
 *   ease:   what a heavy check-in opens first. Comfort only: no skill name, no XP, no question, no reason field.
 *   moment: "Give me a moment". Dim screen, a slow 4-in 6-out ring, calm lines one at a time at speaking pace.
 *           No questions, no chips, no XP shown, exit any time, optional low hum (off by default).
 */
import { animate } from '../ui/anim';
import { SCORE, WINDOW } from '../motion/tokens';
import { holdAt, taper } from '../audio/param';
import { type Next } from '../content/dbt';
import { CHECKIN } from '../content/daily-lines';
import { write } from '../core/cleared';
import { BESIDE, MOMENT_LENGTHS, type MomentLength } from '../core/stored-names';
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
/** The hum's fade back in after the page wakes (about 0.4 s), and its fade out as the page hides (time constants). */
const WAKE_TAU = 0.12;
const SLEEP_TAU = 0.02;

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
  // three gains in a row, one writer each: the breath slowly swells `breath`, the player's levels glide `vol`, and
  // `wake` fades the hum out before the page sleeps and back in from silence when it wakes
  const breath = ctx.createGain();
  breath.gain.value = 0;
  const vol = ctx.createGain();
  vol.gain.value = scale;
  const wake = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 360;
  lp.Q.value = 0.4;
  lp.connect(breath).connect(vol).connect(wake).connect(ctx.destination);
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
  let nap: ReturnType<typeof setTimeout> | undefined;
  const resume = () => {
    if (!dead && !document.hidden && ctx.state !== 'running') ctx.resume().catch(() => {});
  };
  // A paused context (the page hidden, a locked phone, a call) picks up at the audio clock where it stopped, so
  // silence and a short fade-in are set at that time: whoever resumes it, the hum comes back without a pop. A pause
  // the system made is left to the system (or the next tap): a call keeps the hum quiet until it ends.
  const paused = () => {
    if (dead || ctx.state === 'running') return;
    const t = ctx.currentTime;
    wake.gain.cancelScheduledValues(0);
    wake.gain.setValueAtTime(0, t);
    wake.gain.setTargetAtTime(1, t, WAKE_TAU);
  };
  const seen = () => {
    if (dead) return;
    clearTimeout(nap);
    // already paused: `paused` has set where it comes back from
    if (ctx.state !== 'running') return resume();
    const t = ctx.currentTime;
    holdAt(wake.gain, t);
    if (!document.hidden) return void wake.gain.setTargetAtTime(1, t, WAKE_TAU);
    // hidden: fade out, then pause like the rest of the app's sound (a phone may pause it sooner; see `paused`)
    wake.gain.setTargetAtTime(0, t, SLEEP_TAU);
    nap = setTimeout(() => {
      // a page shown again before this pause lands still found the hum running, so it is woken once the pause lands
      if (!dead && document.hidden && ctx.state === 'running') ctx.suspend().then(resume, () => {});
    }, SLEEP_TAU * 6000);
  };
  document.addEventListener('visibilitychange', seen);
  ctx.addEventListener('statechange', paused);
  // iOS can keep a context it paused for a call or the lock screen waiting for a touch. Heard last, once the tap has
  // done its work: a tap that opens the Safe Zone has already stopped the hum, so it never wakes it.
  window.addEventListener('click', resume);
  window.addEventListener('keydown', resume);
  const unlisten = () => {
    clearTimeout(nap);
    document.removeEventListener('visibilitychange', seen);
    ctx.removeEventListener('statechange', paused);
    window.removeEventListener('click', resume);
    window.removeEventListener('keydown', resume);
  };
  return {
    setScale(s: number) {
      if (dead) return;
      // the glide the engine gives Master, Music and Effects (setUser: ramp 0.08 s, tau = ramp / 4), so no click
      vol.gain.setTargetAtTime(s, ctx.currentTime, 0.02);
      // a level moved in the speaker control wakes a paused hum like any tap: the control keeps its taps and keys
      resume();
    },
    breathe(s: number) {
      if (dead) return;
      breath.gain.setTargetAtTime(0.035 + s * 0.03, ctx.currentTime, 0.25);
      lp.frequency.setTargetAtTime(300 + s * 140, ctx.currentTime, 0.3);
    },
    /** A soft fade of about a second, or exact silence `ramp` seconds from now (the Safe Zone opening). */
    stop(ramp?: number) {
      if (dead) return;
      dead = true;
      unlisten();
      const t = ctx.currentTime;
      if (ramp !== undefined) {
        holdAt(breath.gain, t);
        breath.gain.linearRampToValueAtTime(0, t + ramp);
        oscs.forEach((o) => o.stop(t + ramp));
        // closed once the oscillators end; the timer covers a suspended context (a call came in), where they never do
        let open = true;
        const close = () => {
          if (open) void ctx.close();
          open = false;
        };
        oscs[0].onended = close;
        setTimeout(close, ramp * 1000 + 250);
        return;
      }
      breath.gain.setTargetAtTime(0, t, 0.25);
      setTimeout(() => {
        oscs.forEach((o) => o.stop());
        void ctx.close();
      }, 1200);
    },
  };
}

const LINE_S = 7;
/** How long the ring takes to settle once a timed moment ends. */
const SETTLE_S = 2.4;
const LENGTH_S: Record<MomentLength, number> = { '1': 60, '3': 180, open: Infinity };
const lengthKey = (key: string) => `${key}${BESIDE.momentLength}`;
/** The length chosen on this device. None chosen means until the player is ready, as it was before the choice. */
const readLength = (key: string): MomentLength => {
  try {
    const v = localStorage.getItem(lengthKey(key));
    return (MOMENT_LENGTHS as readonly (string | null)[]).includes(v) ? (v as MomentLength) : 'open';
  } catch {
    return 'open';
  }
};

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
  // its own Hum level with Master and mute on top, on the curve the engine gives the other sliders
  const humScale = () => {
    const l = app.opts.volume?.get();
    return l ? (l.muted ? 0 : taper(l.master) * taper(l.hum)) : (st.state.settings.sound ? 1 : 0);
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

  // how long it lasts: a timed moment ends softly that long after it began or after the last change, never counted out
  const LEN = CHECKIN.momentLength;
  let length = readLength(st.key);
  const group = `dqmo-len-${Math.random().toString(36).slice(2, 8)}`;
  const lengthBox = h(
    'fieldset',
    { class: 'dq-mo-len', role: 'radiogroup', 'aria-labelledby': `${group}-l` },
    h('legend', { id: `${group}-l`, class: 'dq-mo-len-l', text: LEN.legend }),
    h(
      'div',
      { class: 'dq-mo-len-opts' },
      MOMENT_LENGTHS.map((v) => {
        const input = h('input', { type: 'radio', name: group, value: v, class: 'dq-mo-len-in', onchange: () => choose(v) });
        input.checked = v === length;
        return h('label', { class: 'dq-mo-len-o' }, input, h('span', { text: typo(LEN.options[v]) }));
      }),
    ),
  );
  const choose = (v: MomentLength) => {
    length = v;
    from = now();
    arm();
    // a line that promises no timing goes at once: the next frame shows a line again, from the timed ones
    if (v !== 'open' && CHECKIN.momentOpen.some((l) => words.textContent === typo(l))) shown = -1;
    write(() => {
      try {
        localStorage.setItem(lengthKey(st.key), v);
      } catch {
        /* stays for this visit only */
      }
    });
  };

  const t0 = now();
  let from = t0;
  let endAt = -1;
  let shown = -1;
  let passes = 0;
  const fades: Animation[] = [];
  const stage = h('div', { class: 'dq-mo-stage' }, h('div', { class: 'dq-mo-halo', 'aria-hidden': 'true' }), svg);
  /** The chosen time has passed: the hum fades as when leaving, the ring settles, one calm line stays, and the way back is Done. */
  const end = (t: number) => {
    endAt = t;
    hum?.stop();
    hum = null;
    const still = app.reduced();
    const moving = document.activeElement instanceof HTMLElement && (lengthBox.contains(document.activeElement) || humToggle.contains(document.activeElement));
    const quiet = [lengthBox, humToggle];
    // out of reach at once, before the fade: a tap there now can't start a hum or change the length
    quiet.forEach((x) => (x.inert = true));
    lengthBox.disabled = true;
    humToggle.querySelectorAll('input').forEach((i) => (i.disabled = true));
    quiet.forEach((x) => animate(x, [{ opacity: 1 }, { opacity: 0 }], { duration: still ? WINDOW.reducedCloseMs : 900, easing: 'ease-in', fill: 'forwards' }));
    setTimeout(() => quiet.forEach((x) => x.classList.add('is-gone')), still ? WINDOW.reducedCloseMs : 900);
    if (moving) done.focus();
    animate(stage, [{ opacity: 1 }, { opacity: 0.55 }], { duration: still ? WINDOW.reducedFadeMs : SETTLE_S * 1000, easing: 'ease-out', fill: 'forwards' });
    fades.splice(0).forEach((a) => a.cancel());
    words.textContent = typo(LEN.end);
    fades.push(animate(words, still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: still ? WINDOW.reducedFadeMs : 1300, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }));
    if (after?.classList.contains('is-hidden')) {
      after.classList.remove('is-hidden');
      animate(after, [{ opacity: 0 }, { opacity: 1 }], { duration: still ? WINDOW.reducedFadeMs : 1200 });
    }
  };
  // frames stop while the phone is locked or the tab is hidden, so a timer ends the moment (and its hum) on time there too
  let timer = 0;
  const arm = () => {
    clearTimeout(timer);
    if (length !== 'open') timer = window.setTimeout(() => el.isConnected && endAt < 0 && end(now()), Math.max(0, (from + LENGTH_S[length] - now()) * 1000));
  };
  const stop = onFrame((t) => {
    const e = t - t0;
    if (endAt < 0 && t - from >= LENGTH_S[length]) end(t);
    // once ended, the breath settles to a slow exhale and the ring holds still
    const settle = endAt < 0 ? 0 : ease((t - endAt) / SETTLE_S);
    const s = breath(e) * (1 - settle);
    const still = app.reduced();
    const rr = still ? 64 : 44 + s * 32;
    line.setAttribute('r', rr.toFixed(2));
    line.setAttribute('stroke-opacity', (still ? 0.95 : 0.55 + s * 0.4).toFixed(3));
    orb.setAttribute('r', (rr + 14).toFixed(2));
    orb.setAttribute('opacity', (still ? 1 : 0.75 + s * 0.25).toFixed(3));
    echo.setAttribute('r', (still ? 72 : rr + 6 + (1 - s) * 10).toFixed(2));
    echo.setAttribute('stroke-opacity', (still ? 0.5 : 0.15 + s * 0.35).toFixed(3));
    hum?.breathe(s);
    if (settle >= 1) stop();
    // one line at a time: a beat of quiet first, then a new line every LINE_S seconds; a timed moment skips the open-ended lines
    const k = Math.floor((e - 1.2) / LINE_S);
    if (endAt < 0 && k >= 0 && k !== shown) {
      shown = k;
      const L = length === 'open' ? CHECKIN.moment : CHECKIN.moment.filter((l) => !CHECKIN.momentOpen.includes(l));
      const i = k % L.length;
      if (i === 0 && k > 0) passes++;
      words.textContent = typo(L[i]);
      fades.splice(0).forEach((a) => a.cancel());
      const closeMs = still ? WINDOW.reducedCloseMs : 900;
      fades.push(
        animate(words, still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: still ? WINDOW.reducedFadeMs : 1300, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }),
        animate(words, [{ opacity: 1 }, { opacity: 0 }], { duration: closeMs, delay: (LINE_S - 0.2) * 1000 - closeMs, easing: 'ease-in', fill: 'forwards' }),
      );
      if (after && (passes > 0 || i === L.length - 1) && after.classList.contains('is-hidden')) {
        after.classList.remove('is-hidden');
        animate(after, [{ opacity: 0 }, { opacity: 1 }], { duration: still ? WINDOW.reducedFadeMs : 1200 });
      }
    }
  });

  const el = h(
    'div',
    { class: 'dq-moment' },
    h('h1', { class: 'dq-sr', 'data-focus': '', text: 'Give me a moment' }),
    stage,
    words,
    h('div', { class: 'dq-mo-foot' }, after, lengthBox, h('div', { class: 'dq-mo-row' }, humToggle, done)),
  );
  arm();
  return {
    el,
    title: 'Give me a moment',
    mode: 'sub',
    bubbles: [0.6, 0.3],
    leave: () => {
      stop();
      fades.forEach((a) => a.cancel());
      offVolume?.();
      hum?.stop();
      hum = null;
    },
    silence: () => {
      hum?.stop(SCORE.safeOutSec);
      hum = null;
    },
  };
}
