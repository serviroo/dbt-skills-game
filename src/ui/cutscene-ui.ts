import '../styles/cutscene.css';
import { after, animate, complete, el, finished, wait } from './anim';
import { inertUntil, onTaps } from './taps';
import { onSystemMotion, params } from '../core/params';
import { EASE, WINDOW as W, css } from '../motion/tokens';
import { ICON_LETTER, ICON_LANTERN, ICON_MOTH, ICON_STAR, FLOURISH } from './icons';
import type { RewardItem } from '../content/intro';
import { LETTER, END_CARD, NAME_PROMPT, TITLE_SCREEN } from '../content/intro';
import { DEFAULT_COMPANION, DEFAULT_NAME, chooseYou, cleanName } from '../core/you';
import { mayMentionTherapist } from '../core/session';
import { LanternWindow, lanternLayer } from './lantern-window';

/** Sound hook (wired to the audio engine by the app). */
export const uiSounds: { play?: (cue: string, opts?: Record<string, number>) => void } = {};
const snd = (cue: string, opts?: Record<string, number>) => uiSounds.play?.(cue, opts);

const ui = () => document.getElementById('ui')!;

/* ---------------------------------------------------------------- title */

export function showTitle(onGesture?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const root = el('div', 'ov title-screen');
    root.setAttribute('role', 'button');
    const label = matchMedia('(pointer: fine)').matches ? TITLE_SCREEN.promptMouse : TITLE_SCREEN.prompt;
    root.setAttribute('aria-label', label);
    root.tabIndex = 0;
    const slit = el('div', 'title-slit');
    const prompt = el('div', 'title-prompt', label);
    const hint = el(
      'div',
      'title-hint',
      `<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M11 5.5c1 .8 1 4.2 0 5M12.8 4c1.8 1.6 1.8 6.4 0 8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>${TITLE_SCREEN.hint}`,
    );
    root.append(slit, prompt, hint);
    ui().append(root);
    // the slit breathes and the prompt pulses while motion is on; with reduce-motion (now or later) both rest
    let pulses: Animation[] = [];
    let still: boolean | null = null;
    const pulse = () => {
      if (params.reduced === still) return;
      still = params.reduced;
      pulses.forEach((a) => a.cancel());
      pulses = still
        ? []
        : [
            animate(slit, [{ opacity: 0.35, transform: 'translateX(-50%) scaleY(.96)' }, { opacity: 1, transform: 'translateX(-50%) scaleY(1)' }], {
              duration: 2600,
              iterations: Infinity,
              direction: 'alternate',
              easing: 'ease-in-out',
            }),
            animate(prompt, [{ opacity: 0.62 }, { opacity: 1 }], { duration: 1800, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }),
          ];
      prompt.style.opacity = still ? '0.85' : '';
    };
    pulse();
    const offPulse = onSystemMotion(pulse);
    const go = async () => {
      offPulse();
      onGesture?.();
      root.style.pointerEvents = 'none';
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('keydown', onKey);
      resolve();
      await finished(animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-in' }));
      // the pulses end with the title: endless, they would run on in the removed slit and prompt
      pulses.forEach((a) => a.cancel());
      root.remove();
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 0) go();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
      // the key is the title's alone: the name field takes focus in this keydown, so the key's own character and its
      // auto-repeat would land in it
      e.preventDefault();
      swallowRepeat(e.key);
      go();
    };
    root.addEventListener('pointerup', onUp);
    root.addEventListener('keydown', onKey);
    if (params.capture) wait(0.6).then(go);
  });
}

/** Takes the auto-repeat of a held key until it is released, wherever focus goes meanwhile. */
function swallowRepeat(key: string) {
  const off = () => {
    window.removeEventListener('keydown', onDown, true);
    window.removeEventListener('keyup', onUp, true);
  };
  const onDown = (e: KeyboardEvent) => {
    if (e.key !== key) return;
    // a fresh press: the release was missed (focus left the page), so it is no longer held
    if (!e.repeat) return off();
    e.preventDefault();
  };
  const onUp = (e: KeyboardEvent) => e.key === key && off();
  window.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup', onUp, true);
}

/* ---------------------------------------------------------------- first-run names */

/** Asks once, right after the title: the player's name and their companion's, both optional. Skip keeps the defaults. */
export async function namePrompt(): Promise<void> {
  const field = (id: string, label: string, ph: string) =>
    `<label class="np-f" for="${id}"><span class="np-l">${label}</span><input id="${id}" class="np-in" type="text" maxlength="24" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="next" placeholder="${ph}"></label>`;
  const html = `<p>${NAME_PROMPT.line}</p><div class="sw-custom np">${field('np-name', NAME_PROMPT.nameLabel, DEFAULT_NAME)}${field('np-comp', NAME_PROMPT.companionLabel, DEFAULT_COMPANION)}<p class="np-hint">${NAME_PROMPT.hint}</p></div>`;
  const w = new LanternWindow(lanternLayer(), {
    kind: 'info',
    title: NAME_PROMPT.title,
    icon: 'info',
    html,
    actions: [
      { label: NAME_PROMPT.skip, value: 'skip', variant: 'quiet' },
      { label: NAME_PROMPT.go, value: 'go', variant: 'gold' },
    ],
  });
  const opened = w.open();
  const name = w.root.querySelector<HTMLInputElement>('#np-name')!;
  const comp = w.root.querySelector<HTMLInputElement>('#np-comp')!;
  const go = w.root.querySelector<HTMLButtonElement>('.sw-btn.gold')!;
  name.addEventListener('keydown', (e) => e.key === 'Enter' && !e.repeat && comp.focus());
  comp.addEventListener('keydown', (e) => e.key === 'Enter' && !e.repeat && go.click());
  // the fields are there from the first frame: focus goes in once, as the prompt opens, never when the Lantern's typing
  // ends, by which time a quick player may already be typing in the other field
  if (matchMedia('(pointer: fine)').matches) name.focus({ preventScroll: true });
  // a letter typed while neither field has focus (a keyboard on a touch-first device, which gets no focus above) moves
  // focus to the field the player was last in before the letter lands, so it goes in there
  let into = name;
  for (const f of [name, comp]) f.addEventListener('focus', () => (into = f));
  const onKey = (e: KeyboardEvent) => {
    // AltGr types letters (Ł, ß) and reports Ctrl and Alt with them; a dead key (the ´ of Á) starts a letter, which
    // composes only in a focused field
    const altGraph = e.getModifierState('AltGraph');
    if ((e.key.length !== 1 && e.key !== 'Dead') || e.key === ' ' || e.metaKey || (!altGraph && (e.ctrlKey || e.altKey))) return;
    if (document.activeElement?.closest('button, a[href], input, select, textarea, [contenteditable]')) return;
    into.focus({ preventScroll: true });
  };
  window.addEventListener('keydown', onKey);
  await opened;
  const v = params.capture ? 'skip' : await w.waitForInput();
  window.removeEventListener('keydown', onKey);
  const keep = v === 'go';
  chooseYou(keep ? cleanName(name.value) : '', keep ? cleanName(comp.value) : '', Date.now());
  name.blur();
  comp.blur();
  await w.close();
}

/* ---------------------------------------------------------------- letterbox */

export class Letterbox {
  private top = el('div', 'lb top');
  private bot = el('div', 'lb bot');
  h = 0;
  constructor() {
    ui().append(this.top, this.bot);
  }
  /** fraction of viewport height per bar */
  set(f: number) {
    this.h = f;
    const px = `${(f * 100).toFixed(3)}vh`;
    this.top.style.height = px;
    this.bot.style.height = px;
  }
  dispose() {
    this.top.remove();
    this.bot.remove();
  }
}

/* ---------------------------------------------------------------- skip */

export function skipButton(onSkip: () => void) {
  const b = el('button', 'ui-skip', 'Skip') as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onSkip();
  });
  ui().append(b);
  return () => b.remove();
}

/* ---------------------------------------------------------------- AWAKEN word */

/** Outline word slam: strokes draw on with a glint sweep, push toward camera, ghost exit (pacing W5, lengthened). */
export async function awakenWord(text = 'AWAKEN', holdSec = 0.5) {
  const root = el('div', 'awaken-word');
  const aw = el('div', 'aw');
  const w = el('div', 'w', text);
  const glint = el('div', 'w glint', text);
  const g1 = el('div', 'w ghost', text);
  const g2 = el('div', 'w ghost', text);
  aw.append(g1, g2, w, glint);
  root.append(aw);
  ui().append(root);
  const D = (holdSec + 0.25) * 1000;
  animate(w, [
    { opacity: 0, transform: 'scale(1.06)', clipPath: 'inset(0 100% 0 0)' },
    { opacity: 1, transform: 'scale(1)', clipPath: 'inset(0 0% 0 0)', offset: 0.12 },
    { opacity: 1, transform: 'scale(1.12)', clipPath: 'inset(0 0% 0 0)', offset: 0.8 },
    { opacity: 0, transform: 'scale(1.16)', clipPath: 'inset(0 0% 0 0)' },
  ], { duration: D, easing: 'linear' });
  animate(glint, [
    { backgroundPosition: '100% 0', opacity: 1, transform: 'scale(1)' },
    { backgroundPosition: '0% 0', opacity: 1, transform: 'scale(1.02)', offset: 0.22 },
    { backgroundPosition: '0% 0', opacity: 0, transform: 'scale(1.12)' },
  ], { duration: D, easing: 'linear' });
  for (const [g, dx] of [[g1, -1], [g2, 1]] as [HTMLElement, number][])
    animate(g, [
      { opacity: 0, transform: 'scale(1.12) translateX(0)' },
      { opacity: 0, transform: 'scale(1.12) translateX(0)', offset: 0.7 },
      { opacity: 0.5, transform: `scale(1.18) translateX(${dx * 2}%)`, offset: 0.82 },
      { opacity: 0, transform: `scale(1.26) translateX(${dx * 5}%)` },
    ], { duration: D, easing: 'ease-out' });
  await wait(D / 1000);
  root.remove();
}

/* ---------------------------------------------------------------- rewards */

function still(frames: Keyframe[]): Keyframe[] {
  const end = { ...frames[frames.length - 1] };
  delete end.offset;
  delete end.easing;
  return [{ ...end, opacity: frames[0].opacity ?? end.opacity ?? 1 }, end];
}

function entrance() {
  const reduced = params.reduced;
  const anims: Animation[] = [];
  const due = new Set<() => void>();
  const flush = () => [...due].forEach((run) => run());
  const off = onTaps(() => {
    flush();
    anims.forEach(complete);
  });
  return {
    reduced,
    animate(e: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
      const a = reduced ? animate(e, still(frames), { ...opts, duration: W.reducedFadeMs, delay: 0, easing: css(EASE.outCubic) }) : animate(e, frames, opts);
      anims.push(a);
      return a;
    },
    /** `fn` runs once: at `sec`, or at once when a tap completes the entrance or the screen leaves. `sound` plays only on time. */
    cue(sec: number, fn: () => void, sound?: () => void) {
      const run = () => {
        due.delete(run);
        fn();
      };
      due.add(run);
      after(reduced ? 0 : sec * 1000).then(() => {
        if (!due.has(run)) return;
        run();
        sound?.();
      });
    },
    buttons(acts: HTMLElement, shown: Animation) {
      inertUntil(acts, finished(shown));
    },
    async leave(root: HTMLElement, ms: number) {
      flush();
      off();
      snd('ui_tap');
      const out = reduced ? W.reducedCloseMs : ms;
      animate(root, [{ opacity: 1 }, { opacity: 0 }], reduced ? { duration: out, easing: css(EASE.outCubic) } : { duration: out, easing: 'ease-in' });
      // page timers, like a window's close: the screen leaves on time however slowly the 3D scene behind it draws
      await after(out);
      root.remove();
    },
  };
}

const EMBLEM: Record<RewardItem['id'], () => string> = {
  letter: () => ICON_LETTER,
  companion: () => (window as unknown as { __companionSVG?: () => string }).__companionSVG?.() ?? ICON_MOTH,
  lantern: () => ICON_LANTERN,
  charm: () => ICON_STAR,
};

/** Gacha-style reveal: cards flip in one by one, rarity light first, then the item. Resolves with the action. */
export async function rewardCards(items: RewardItem[], opts: { onCard?: (i: number) => void } = {}): Promise<'letter'> {
  const root = el('div', 'ov interactive rw');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Rewards');
  const head = el('div', 'rw-head', `<span class="line"></span><span>Rewards</span><span class="line r"></span>`);
  const grid = el('div', 'rw-grid');
  const cards = items.map((it) => {
    const c = el('div', 'rw-card');
    c.dataset.r = it.rarity;
    c.innerHTML = `<div class="em">${EMBLEM[it.id]()}</div><div class="nm">${it.name}</div><div><div class="kd">${cap(it.rarity)} ${it.kind.toLowerCase()}</div><div class="ds">${it.desc}</div></div><div class="fx"><div class="sweep"></div></div>`;
    c.style.opacity = '0';
    grid.append(c);
    return c;
  });
  const actions = el('div', 'rw-actions');
  const btn = el('button', 'sw-btn gold', 'Read the note') as HTMLButtonElement;
  btn.type = 'button';
  btn.style.opacity = '0';
  actions.append(btn);
  root.append(head, grid, actions);
  ui().append(root);
  const e = entrance();
  e.animate(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease-out' });
  e.animate(head, [{ opacity: 0, letterSpacing: '0.5em' }, { opacity: 1, letterSpacing: '0.22em' }], { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)' });
  let at = 450;
  cards.forEach((c, i) => {
    e.cue(
      at / 1000,
      () => opts.onCard?.(i),
      () => (!e.reduced || i === 0) && snd('reward_chime', { index: i }),
    );
    e.animate(c, [
      { opacity: 0, transform: 'rotateY(-95deg) translateY(10px) scale(.94)', filter: 'brightness(2.2)' },
      { opacity: 1, transform: 'rotateY(8deg) translateY(0) scale(1.01)', filter: 'brightness(1.5)', offset: 0.62 },
      { opacity: 1, transform: 'rotateY(0deg) translateY(0) scale(1)', filter: 'brightness(1)' },
    ], { duration: 620, delay: at, easing: 'cubic-bezier(.16,1,.3,1)' });
    e.animate(c.querySelector('.sweep')!, [{ transform: 'translateX(-100%)' }, { transform: 'translateX(100%)' }], { duration: 900, delay: at + 260, easing: 'ease-out' });
    at += 500;
  });
  at += 300;
  e.buttons(btn, e.animate(btn, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, delay: at, easing: 'cubic-bezier(.16,1,.3,1)' }));
  await new Promise<void>((resolve) => {
    btn.addEventListener('click', () => resolve(), { once: true });
    if (params.capture) wait(at / 1000 + 2.2).then(resolve);
  });
  await e.leave(root, 380);
  return 'letter';
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/* ---------------------------------------------------------------- letter */

export async function letterView(): Promise<void> {
  // the letter mentions a therapist, so nothing else in the companion does this session
  mayMentionTherapist();
  const wrap = el('div', 'ov interactive letter-wrap');
  const card = el('article', 'letter');
  card.setAttribute('aria-label', 'Welcome note');
  card.innerHTML = `
    <div class="curl l">${FLOURISH}</div><div class="curl r">${FLOURISH}</div>
    <h2>${LETTER.greeting}</h2>
    ${LETTER.paragraphs.map((p) => `<p>${p}</p>`).join('')}
    <div class="sign">${LETTER.signoff}</div>
    <div class="sw-actions"><button type="button" class="sw-btn gold">Continue</button></div>`;
  wrap.append(card);
  ui().append(wrap);
  snd('letter_open');
  const e = entrance();
  e.animate(wrap, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
  e.animate(card, [{ opacity: 0, transform: 'translateY(24px) scale(.985)', filter: 'brightness(1.6)' }, { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'brightness(1)' }], {
    duration: 900,
    easing: 'cubic-bezier(.16,1,.3,1)',
  });
  const acts = card.querySelector<HTMLElement>('.sw-actions')!;
  const parts = Array.from(card.querySelectorAll<HTMLElement>('h2, p, .sign, .sw-actions'));
  parts.forEach((p, i) => {
    const a = e.animate(p, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 700, delay: 380 + i * 260, easing: 'cubic-bezier(.16,1,.3,1)' });
    if (p === acts) e.buttons(acts, a);
  });
  const btn = card.querySelector<HTMLButtonElement>('button')!;
  await new Promise<void>((resolve) => {
    btn.addEventListener('click', () => resolve(), { once: true });
    if (params.capture) wait(9).then(resolve);
  });
  await e.leave(wrap, 500);
}

/* ---------------------------------------------------------------- end card */

export async function endCard(): Promise<'replay' | 'enter'> {
  const root = el('div', 'ov endcard');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', END_CARD.title);
  const stage = el('div', 'ec-stage');
  const ring = `<svg class="ec-ring" viewBox="0 0 200 200"><defs><linearGradient id="ecg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffec7"/><stop offset=".5" stop-color="#c9a45c"/><stop offset="1" stop-color="#7a6440"/></linearGradient></defs>
    <circle cx="100" cy="100" r="96" fill="none" stroke="url(#ecg)" stroke-width=".7" stroke-dasharray="604" stroke-dashoffset="604" class="r1"/>
    <circle cx="100" cy="100" r="90" fill="none" stroke="#c9a45c" stroke-opacity=".35" stroke-width=".4" stroke-dasharray="2 5" class="r2"/></svg>`;
  stage.innerHTML = `<div class="ec-col">
      <div class="ec-hero">${ring}<div class="ec-curls">${FLOURISH}${FLOURISH}</div>
        <h1 class="ec-title">${END_CARD.title.replace(/ /g, '<br>')}</h1></div>
      <div class="ec-line">${END_CARD.line.replace('already strong', '<b>already strong</b>')}</div>
      <div class="ec-actions"><button type="button" class="sw-btn quiet" data-v="replay">Replay</button><button type="button" class="sw-btn gold" data-v="enter">Enter the Lantern</button></div>
    </div>`;
  root.append(stage);
  ui().append(root);
  snd('endcard');
  const title = stage.querySelector<HTMLElement>('.ec-title')!;
  const line = stage.querySelector<HTMLElement>('.ec-line')!;
  const acts = stage.querySelector<HTMLElement>('.ec-actions')!;
  const r1 = stage.querySelector<SVGCircleElement>('.r1')!;
  const curls = stage.querySelector<HTMLElement>('.ec-curls')!;
  const e = entrance();
  e.animate(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
  // soft slam (no white blur frame), then a slow exponential settle
  e.animate(title, [
    { opacity: 0, transform: 'scale(1.3)', filter: 'blur(6px) brightness(1.8)' },
    { opacity: 1, transform: 'scale(1)', filter: 'blur(0) brightness(1)', offset: 0.25 },
    { opacity: 1, transform: 'scale(.96)', filter: 'blur(0) brightness(1)' },
  ], { duration: 1600, easing: 'cubic-bezier(.16,1,.3,1)' });
  e.animate(r1, [{ strokeDashoffset: 604 }, { strokeDashoffset: 0 }], { duration: 1400, delay: 150, easing: 'cubic-bezier(.65,0,.35,1)' });
  e.animate(curls, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.94)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 1600, delay: 300, easing: 'cubic-bezier(.16,1,.3,1)' });
  e.animate(line, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 900, delay: 700, easing: 'cubic-bezier(.16,1,.3,1)' });
  e.buttons(acts, e.animate(acts, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 2600, easing: 'ease-out' }));
  // breathing drift on the held card, stopped and started again as the device's reduce-motion changes
  let drift: Animation | null = null;
  const sway = () => {
    if (params.reduced) {
      drift?.cancel();
      drift = null;
    } else drift ??= animate(stage, [{ transform: 'scale(1)' }, { transform: 'scale(.985)' }], { duration: 9000, delay: 1600, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  };
  sway();
  const offSway = onSystemMotion(sway);
  const v = await new Promise<'replay' | 'enter'>((resolve) => {
    acts.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => resolve(b.dataset.v as 'replay' | 'enter'), { once: true }));
    if (params.capture) wait(6).then(() => resolve('enter'));
  });
  offSway();
  await e.leave(root, 600);
  return v;
}

/* ---------------------------------------------------------------- fader */

export function fader() {
  let f = document.querySelector<HTMLDivElement>('.fader');
  if (!f) {
    f = el('div', 'fader') as HTMLDivElement;
    ui().append(f);
  }
  return {
    to: async (o: number, sec: number, easing = 'ease-in-out') => {
      await finished(animate(f!, [{ opacity: getComputedStyle(f!).opacity }, { opacity: o }], { duration: sec * 1000, easing }));
      f!.style.opacity = String(o);
    },
    set: (o: number) => (f!.style.opacity = String(o)),
  };
}
