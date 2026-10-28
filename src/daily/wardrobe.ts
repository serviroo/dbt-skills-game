/**
 * Wave 2 Wardrobe: Lantern window themes, an accent, card backs and name-plate styles. What is unlocked is derived from
 * distinct visit days (or rank) on every render and never shrinks; the picks are SetKeys in settings, so the later pick
 * wins across open copies. A pick that is not (or no longer provably) unlocked shows as the default. A tapped look is only
 * tried on (in memory, never saved) until the player keeps it.
 */
import { ACCENTS, ACCENT_IDS, CARD_BACKS, CARD_BACK_IDS, PLATES, PLATE_IDS, THEMES, THEME_IDS, WARDROBE_COPY, type Look } from '../content/roster-lines';
import { RANKS, TRY_ON } from '../content/daily-lines';
import { CALM, css, WINDOW } from '../motion/tokens';
import { animate } from '../ui/anim';
import { playerName } from '../core/you';
import type { App } from './app';
import { cardBackSVG } from './art';
import { btn, h, panel, radioKeys } from './ui';
import { icon } from './art';
import type { Store } from './store';

type Slot = 'theme' | 'accent' | 'cardBack' | 'plate';
const TABLE: Record<Slot, { ids: readonly string[]; looks: Record<string, Look> }> = {
  theme: { ids: THEME_IDS, looks: THEMES },
  accent: { ids: ACCENT_IDS, looks: ACCENTS },
  cardBack: { ids: CARD_BACK_IDS, looks: CARD_BACKS },
  plate: { ids: PLATE_IDS, looks: PLATES },
};

export function lookUnlocked(st: Store, look: Look) {
  const d = st.derived();
  return d.visitDays.length >= look.days || (look.rank !== undefined && d.rank >= look.rank);
}

/** What shows: their pick if it is unlocked, otherwise the default (the first id). */
export function worn(st: Store, slot: Slot): string {
  const t = TABLE[slot];
  const pick = st.state.settings[slot] as string;
  return t.ids.includes(pick) && lookUnlocked(st, t.looks[pick]) ? pick : t.ids[0];
}

export const plateClass = (app: App) => `w2-plate--${worn(app.store, 'plate')}`;

/** Looks tried on in the Wardrobe and not kept yet: in memory only, gone when the Wardrobe closes. */
let tried: Partial<Record<Slot, string>> = {};
/** What the screen wears: a look being tried on, else what they keep. */
const shown = (st: Store, slot: Slot) => tried[slot] ?? worn(st, slot);

/** Applies theme and accent to the companion and its Lantern windows (both read the attributes on <html>). */
function paint(st: Store) {
  const html = document.documentElement;
  html.dataset.dqTheme = shown(st, 'theme');
  html.dataset.dqAccent = shown(st, 'accent');
}

export function wireWardrobe(app: App) {
  const apply = () => paint(app.store);
  apply();
  const off = app.store.onChange(apply);
  return () => {
    off();
    tried = {};
    delete document.documentElement.dataset.dqTheme;
    delete document.documentElement.dataset.dqAccent;
  };
}

let backN = 0;
/** Card backs: the tick ring (default), a gate, and the warden sigil. */
export function cardBackArt(app: App) {
  const id = worn(app.store, 'cardBack');
  return backArt(id);
}
function backArt(id: string) {
  if (id === 'gate') {
    const n = `cb${++backN}`;
    const bars: string[] = [];
    for (let i = 0; i < 9; i++) bars.push(`M${38 + i * 3} 30V78`);
    return `<svg viewBox="0 0 100 100" aria-hidden="true" class="dq-cardback-art">
<defs><linearGradient id="${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe9ff" stop-opacity=".9"/><stop offset="1" stop-color="#4fb8ff" stop-opacity=".1"/></linearGradient></defs>
<path d="M28 84V40C28 26 38 16 50 16S72 26 72 40V84" fill="none" stroke="#5d8fbf" stroke-width=".9"/>
<path d="M33 84V42C33 30 40 22 50 22S67 30 67 42V84" fill="none" stroke="#3e6485" stroke-width=".6"/>
<path d="${bars.join('')}" stroke="#3e6485" stroke-width=".5" opacity=".7"/>
<path d="M50 26Q53.6 54 50 82Q46.4 54 50 26Z" fill="url(#${n})" class="dq-slit"/>
<path d="M22 84H78M26 88H74" stroke="#7fb6e0" stroke-width=".7" opacity=".7"/>
</svg>`;
  }
  if (id === 'crown') {
    const ticks: string[] = [];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r1 = i % 3 === 0 ? 33 : 35;
      ticks.push(`M${(50 + Math.cos(a) * r1).toFixed(2)} ${(50 + Math.sin(a) * r1).toFixed(2)}L${(50 + Math.cos(a) * 37).toFixed(2)} ${(50 + Math.sin(a) * 37).toFixed(2)}`);
    }
    return `<svg viewBox="0 0 100 100" aria-hidden="true" class="dq-cardback-art">
<circle cx="50" cy="50" r="40" fill="none" stroke="#3e6485" stroke-width=".6"/>
<path d="${ticks.join('')}" stroke="#a48be8" stroke-width=".8" stroke-linecap="round" opacity=".7"/>
<path d="M33 60V42L41.5 50L50 36L58.5 50L67 42V60Z" fill="none" stroke="#bfe9ff" stroke-width="1" stroke-linejoin="round"/>
<path d="M33 65H67" stroke="#7fb6e0" stroke-width="1"/>
<path d="M50 70L54 76L50 82L46 76Z" fill="#bfe9ff" class="dq-slit"/>
<circle cx="50" cy="30" r="1.6" fill="#bfe9ff"/>
</svg>`;
  }
  return cardBackSVG();
}

/** One radio option of the Wardrobe; locked ones are disabled and say, calmly, when they arrive. */
function option(app: App, slot: Slot, id: string, preview: HTMLElement, onPick: (slot: Slot) => void) {
  const st = app.store;
  const look = TABLE[slot].looks[id];
  const open = lookUnlocked(st, look);
  const d = st.derived();
  const left = Math.max(1, look.days - d.visitDays.length);
  const hint = open ? '' : WARDROBE_COPY.locked(left, look.rank !== undefined ? RANKS[look.rank] : undefined);
  const b = h(
    'button',
    {
      type: 'button',
      role: 'radio',
      class: `w2-wopt w2-wopt--${slot}${open ? '' : ' is-locked'}`,
      'data-slot': slot,
      'data-id': id,
      'aria-checked': String(shown(st, slot) === id),
      'aria-label': `${look.name}${open ? '' : `. ${hint}`}`,
      disabled: !open,
      onclick: () => {
        if (!open) return;
        // tried on only: the look they keep goes back on with one tap of its own option
        if (id === worn(st, slot)) delete tried[slot];
        else tried[slot] = id;
        onPick(slot);
      },
    },
    preview,
    h('span', { class: 'w2-wopt-n', text: look.name }),
    open ? null : h('span', { class: 'w2-wopt-h', text: hint }),
  );
  return b;
}

function themePreview(id: string) {
  return h(
    'span',
    { class: `w2-pv`, 'data-pv': id, 'aria-hidden': 'true' },
    h('span', { class: 'w2-pv-bar' }),
    h('span', { class: 'w2-pv-plate' }, h('span', { class: 'w2-pv-chip', text: WARDROBE_COPY.preview }), h('span', { class: 'w2-pv-line', text: WARDROBE_COPY.previewLine }), h('span', { class: 'w2-pv-btn', text: 'OK' })),
  );
}
function accentPreview(id: string) {
  return h('span', { class: 'w2-pv-acc', 'data-acc': id, 'aria-hidden': 'true' }, h('span', { class: 'w2-pv-accbtn', text: 'Begin' }), h('span', { class: 'w2-pv-accbar' }));
}
function backPreview(id: string) {
  return h('span', { class: 'w2-pv-back', 'aria-hidden': 'true', html: backArt(id) });
}
function platePreview(id: string) {
  return h('span', { class: 'w2-pv-plate-wrap', 'aria-hidden': 'true' }, h('span', { class: `w2-plate w2-plate--${id} dq-mint`, 'data-you-name': '', text: playerName() }));
}

/**
 * Settings > Wardrobe, below Feel. A tapped look is tried on: the screen wears its window and accent, and the bar under
 * the page shows it with its card back and name plate, until Keep this look saves it the usual way or Go back drops it.
 * Settings calls leave() when the player goes anywhere else, the Safe Zone included, so a look is never kept unasked.
 */
export function wardrobePanel(app: App) {
  const st = app.store;
  const body = h('div', { class: 'w2-wardrobe' });
  const status = h('p', { class: 'dq-sr', role: 'status' });
  const say = h('p', { class: 'w2-try-t' });
  const back = h('span', { class: 'dq-cardface dq-cardface--back w2-try-back', 'aria-hidden': 'true' });
  const plate = h('span', { 'data-you-name': '' });
  let last: Slot = 'theme';
  const end = (keep: boolean) => {
    if (keep) {
      st.sync();
      for (const slot of Object.keys(tried) as Slot[]) {
        (st.state.settings as unknown as Record<Slot, string>)[slot] = tried[slot]!;
        st.touch(slot);
      }
    }
    tried = {};
    if (keep) st.save();
    paint(st);
    refresh();
    body.querySelector<HTMLElement>(`[data-slot="${last}"][aria-checked="true"]`)?.focus({ preventScroll: true });
  };
  const bar = h(
    'div',
    { class: 'w2-try', role: 'region', 'aria-label': TRY_ON.label, hidden: true },
    h(
      'div',
      { class: 'w2-try-in' },
      back,
      h('div', { class: 'w2-try-say' }, say, plate),
      h('div', { class: 'dq-actions w2-try-acts' }, btn(TRY_ON.keep, () => end(true)), btn(TRY_ON.back, () => end(false), { kind: 'quiet' })),
    ),
  );
  /** Redraws the options and the bar from what is tried on and what is kept now, here or in another open copy. */
  const refresh = () => {
    render();
    const on = (Object.keys(TABLE) as Slot[]).filter((k) => tried[k]);
    if (!on.length) {
      bar.hidden = true;
      status.textContent = '';
      return;
    }
    const line = TRY_ON.trying(on.map((k) => TABLE[k].looks[tried[k]!].name));
    say.textContent = line;
    if (status.textContent !== line) status.textContent = line;
    back.innerHTML = backArt(shown(st, 'cardBack'));
    plate.className = `dq-mint w2-plate w2-plate--${shown(st, 'plate')}`;
    plate.textContent = playerName();
    if (!bar.hidden) return;
    bar.hidden = false;
    animate(bar, [{ opacity: 0 }, { opacity: 1 }], { duration: app.reduced() ? WINDOW.reducedFadeMs : CALM.fadeMs, easing: css(CALM.ease) });
  };
  const pick = (slot: Slot) => {
    last = slot;
    paint(st);
    refresh();
  };
  const render = () => {
    // a pick redraws the Wardrobe: focus stays on the look just picked
    const on = body.contains(document.activeElement) ? { ...(document.activeElement as HTMLElement).dataset } : null;
    const group = (slot: Slot, title: string, pv: (id: string) => HTMLElement) =>
      h(
        'div',
        { class: `w2-wgroup w2-wgroup--${slot}` },
        h('h3', { class: 'dq-label w2-wgroup-t', text: title }),
        radioKeys(
          h(
            'div',
            { class: 'w2-wopts', role: 'radiogroup', 'aria-label': title },
            TABLE[slot].ids.map((id) => option(app, slot, id, pv(id), pick)),
          ),
        ),
      );
    body.replaceChildren(
      h('p', { class: 'dq-small', text: WARDROBE_COPY.sub }),
      group('theme', WARDROBE_COPY.theme, themePreview),
      group('accent', WARDROBE_COPY.accent, accentPreview),
      group('cardBack', WARDROBE_COPY.cardBack, backPreview),
      group('plate', WARDROBE_COPY.plate, platePreview),
    );
    if (on?.slot) body.querySelector<HTMLElement>(`[data-slot="${on.slot}"][data-id="${on.id}"]`)?.focus({ preventScroll: true });
  };
  render();
  const off = st.onChange(refresh);
  return {
    el: panel({ title: WARDROBE_COPY.title, ic: icon('card'), cls: 'w2-wardrobe-p' }, body, status),
    bar,
    leave: () => {
      off();
      tried = {};
      paint(st);
    },
  };
}
