import '../styles/cutscene.css';
import { animate, el, finished, wait } from './anim';
import { params } from '../core/params';
import { ICON_LETTER, ICON_LANTERN, ICON_MOTH, ICON_STAR, FLOURISH } from './icons';
import type { RewardItem } from '../content/intro';
import { LETTER, END_CARD, NAME_PROMPT, TITLE_SCREEN } from '../content/intro';
import { DEFAULT_COMPANION, DEFAULT_NAME, chooseYou, cleanName } from '../core/you';
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
    animate(slit, [{ opacity: 0.35, transform: 'translateX(-50%) scaleY(.96)' }, { opacity: 1, transform: 'translateX(-50%) scaleY(1)' }], {
      duration: 2600,
      iterations: Infinity,
      direction: 'alternate',
      easing: 'ease-in-out',
    });
    animate(prompt, [{ opacity: 0.62 }, { opacity: 1 }], { duration: 1800, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    const go = async () => {
      onGesture?.();
      root.removeEventListener('pointerup', go);
      root.removeEventListener('keydown', onKey);
      resolve();
      await finished(animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-in' }));
      root.remove();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') go();
    };
    root.addEventListener('pointerup', go);
    root.addEventListener('keydown', onKey);
    if (params.capture) wait(0.6).then(go);
  });
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
  name.addEventListener('keydown', (e) => e.key === 'Enter' && comp.focus());
  comp.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  await opened;
  if (matchMedia('(pointer: fine)').matches) name.focus({ preventScroll: true });
  const v = params.capture ? 'skip' : await w.waitForInput();
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
  animate(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease-out' });
  animate(head, [{ opacity: 0, letterSpacing: '0.5em' }, { opacity: 1, letterSpacing: '0.22em' }], { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)' });
  await wait(0.45);
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    opts.onCard?.(i);
    snd('reward_chime', { index: i });
    animate(c, [
      { opacity: 0, transform: 'rotateY(-95deg) translateY(10px) scale(.94)', filter: 'brightness(2.2)' },
      { opacity: 1, transform: 'rotateY(8deg) translateY(0) scale(1.01)', filter: 'brightness(1.5)', offset: 0.62 },
      { opacity: 1, transform: 'rotateY(0deg) translateY(0) scale(1)', filter: 'brightness(1)' },
    ], { duration: params.reduced ? 200 : 620, easing: 'cubic-bezier(.16,1,.3,1)' });
    animate(c.querySelector('.sweep')!, [{ transform: 'translateX(-100%)' }, { transform: 'translateX(100%)' }], { duration: 900, delay: 260, easing: 'ease-out' });
    await wait(params.reduced ? 0.2 : 0.5);
  }
  await wait(0.3);
  animate(btn, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
  await new Promise<void>((resolve) => {
    btn.addEventListener('click', () => resolve(), { once: true });
    if (params.capture) wait(2.2).then(resolve);
  });
  snd('ui_tap');
  await finished(animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-in' }));
  root.remove();
  return 'letter';
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/* ---------------------------------------------------------------- letter */

export async function letterView(): Promise<void> {
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
  animate(wrap, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
  animate(card, [{ opacity: 0, transform: 'translateY(24px) scale(.985)', filter: 'brightness(1.6)' }, { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'brightness(1)' }], {
    duration: 900,
    easing: 'cubic-bezier(.16,1,.3,1)',
  });
  const parts = Array.from(card.querySelectorAll<HTMLElement>('h2, p, .sign, .sw-actions'));
  parts.forEach((p, i) => animate(p, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 700, delay: 380 + i * 260, easing: 'cubic-bezier(.16,1,.3,1)' }));
  const btn = card.querySelector<HTMLButtonElement>('button')!;
  await new Promise<void>((resolve) => {
    btn.addEventListener('click', () => resolve(), { once: true });
    if (params.capture) wait(9).then(resolve);
  });
  snd('ui_tap');
  await finished(animate(wrap, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: 'ease-in' }));
  wrap.remove();
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
  animate(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
  // soft slam (no white blur frame), then a slow exponential settle
  animate(title, [
    { opacity: 0, transform: 'scale(1.3)', filter: 'blur(6px) brightness(1.8)' },
    { opacity: 1, transform: 'scale(1)', filter: 'blur(0) brightness(1)', offset: 0.25 },
    { opacity: 1, transform: 'scale(.96)', filter: 'blur(0) brightness(1)' },
  ], { duration: 1600, easing: 'cubic-bezier(.16,1,.3,1)' });
  animate(r1, [{ strokeDashoffset: 604 }, { strokeDashoffset: 0 }], { duration: 1400, delay: 150, easing: 'cubic-bezier(.65,0,.35,1)' });
  animate(curls, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.94)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 1600, delay: 300, easing: 'cubic-bezier(.16,1,.3,1)' });
  animate(line, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 900, delay: 700, easing: 'cubic-bezier(.16,1,.3,1)' });
  animate(acts, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 2600, easing: 'ease-out' });
  // breathing drift on the held card
  animate(stage, [{ transform: 'scale(1)' }, { transform: 'scale(.985)' }], { duration: 9000, delay: 1600, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  const v = await new Promise<'replay' | 'enter'>((resolve) => {
    acts.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => resolve(b.dataset.v as 'replay' | 'enter'), { once: true }));
    if (params.capture) wait(6).then(() => resolve('enter'));
  });
  snd('ui_tap');
  await finished(animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'ease-in' }));
  root.remove();
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
