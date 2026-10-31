/**
 * Wave 2, the hub side: titles earned by using things, Class: Support, the moonflower that only grows and the rare foil
 * card. All derived from their events on each render. The one stored piece is which title lines were already shown
 * (flags.titlesSeen, a set that only grows) and which title the player equipped (settings.title).
 */
import { animate } from '../ui/anim';
import { WARDEN_XP } from '../content/daily-lines';
import { playerName } from '../core/you';
import { CLASS_LINE, MOONFLOWER, TITLE_COPY, TITLES, type TitleId } from '../content/roster-lines';
import type { App } from './app';
import type { Store } from './store';
import { h, radioKeys, typo } from './ui';
import { plateClass } from './wardrobe';

/** Every title the player has earned, oldest first, with when it was earned. Never shrinks: each rests on an event. */
export function earnedTitles(st: Store): { id: TitleId; t: number }[] {
  const at = new Map<TitleId, number>();
  const mark = (id: TitleId, t: number) => {
    const had = at.get(id);
    if (had === undefined || t < had) at.set(id, t);
  };
  let xp = 0;
  for (const e of [...st.state.events].sort((a, b) => a.t - b.t)) {
    xp += Math.max(0, e.xp);
    if (xp >= WARDEN_XP) mark('night-warden', e.t);
    if (e.k === 'rest') {
      mark('professional-lurker', e.t);
      if (e.data?.quiet === true) mark('default-skin-day', e.t);
    }
    if (e.k === 'skill' && e.skill === 'leave-lobby') mark('left-the-lobby', e.t);
    if (e.k === 'skill' && e.skill === 'self-validation') mark('self-healer', e.t);
  }
  return [...at.entries()].map(([id, t]) => ({ id, t })).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
}

export function activeTitle(st: Store): TitleId | null {
  const earned = earnedTitles(st);
  if (!earned.length) return null;
  const pick = st.state.settings.title;
  return pick && earned.some((x) => x.id === pick) ? pick : earned[earned.length - 1].id;
}

/**
 * Titles earned but not yet announced. The Stealth room shows Professional Lurker itself and Night Warden has its own
 * rank window, so those two are only marked as seen.
 */
function takeUnseen(app: App): TitleId[] {
  const st = app.store;
  const f = st.state.flags;
  const fresh = earnedTitles(st).filter((x) => !f.titlesSeen.includes(x.id)).map((x) => x.id);
  if (!fresh.length || app.hushed()) return [];
  f.titlesSeen.push(...fresh);
  st.save();
  return fresh.filter((id) => id !== 'professional-lurker' && id !== 'night-warden');
}

/** The Wanderer card's Name row, in their plate style. */
export function nameRow(app: App) {
  return h('div', { class: 'dq-kv' }, h('dt', { text: 'Name' }), h('dd', { class: `dq-mint w2-plate ${plateClass(app)}`, 'data-you-name': '', text: playerName() }));
}

/** The Wanderer card's Class: Support row. */
export function classRow() {
  return h('div', { class: 'dq-kv w2-class-kv' }, h('dt', { text: CLASS_LINE.k }), h('dd', {}, h('span', { text: CLASS_LINE.v }), h('span', { class: 'w2-class-sp', text: CLASS_LINE.specialty })));
}

/**
 * The Wanderer card's title row: the title the player wears, tap to equip another they have earned. Hidden before the
 * first. `sync` shows titles earned and worn since, here or in another open copy, in place: a list that is open stays
 * open, and focus stays where it is.
 */
export function titleRow(app: App) {
  const st = app.store;
  const label = h('span', { class: 'w2-title-t' });
  const list = radioKeys(h('div', { class: 'w2-title-list is-hidden', role: 'radiogroup', 'aria-label': TITLE_COPY.choose }), { manual: true });
  const toggleBtn = h('button', { type: 'button', class: 'w2-title-btn', 'aria-expanded': 'false' }, label, h('span', { class: 'w2-title-chev', 'aria-hidden': 'true' }));
  const el = h('div', { class: 'dq-kv w2-title-kv' }, h('dt', { text: TITLE_COPY.label }), h('dd', {}, toggleBtn, list));
  const option = (id: TitleId) =>
    h('button', {
      type: 'button',
      role: 'radio',
      class: 'dq-opt w2-title-opt',
      'data-title': id,
      text: TITLES[id].name,
      onclick: () => {
        st.sync();
        st.state.settings.title = id;
        st.touch('title');
        st.save();
        sync();
        const inside = list.contains(document.activeElement);
        list.classList.add('is-hidden');
        toggleBtn.setAttribute('aria-expanded', 'false');
        if (inside) toggleBtn.focus({ preventScroll: true });
      },
    });
  const sync = () => {
    const earned = earnedTitles(st);
    el.classList.toggle('is-hidden', !earned.length);
    // newest first; one earned since goes in its place, and the ones already there stay put
    const order = earned.map((x) => x.id).reverse();
    order.forEach((id, i) => {
      if (list.querySelector(`[data-title="${id}"]`)) return;
      const after = order.slice(i + 1).map((x) => list.querySelector(`[data-title="${x}"]`)).find(Boolean) ?? null;
      list.insertBefore(option(id), after);
    });
    const now = activeTitle(st);
    if (!now) return;
    label.textContent = TITLES[now].name;
    toggleBtn.setAttribute('aria-label', `Title: ${TITLES[now].name}. ${TITLE_COPY.choose}`);
    list.querySelectorAll<HTMLElement>('[role=radio]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.title === now)));
  };
  toggleBtn.addEventListener('click', () => {
    const open = list.classList.toggle('is-hidden') === false;
    toggleBtn.setAttribute('aria-expanded', String(open));
    if (open) animate(list, [{ opacity: 0 }, { opacity: 1 }], { duration: app.reduced() ? 120 : 220 });
  });
  sync();
  return { el, sync };
}

/** "[TITLE UNLOCKED] <name>. <line>" under the Wanderer card, once per title (held back on a heavy day, never lost). */
export function titleUnlock(app: App) {
  const fresh = takeUnseen(app);
  if (!fresh.length) return null;
  const lines = h(
    'div',
    { class: 'w2-title-unlock', role: 'status' },
    fresh.map((id) => h('p', {}, h('span', { class: 'w2-title-unlock-k', text: TITLE_COPY.kicker }), ' ', h('span', { class: 'w2-title-unlock-n', text: `${TITLES[id].name}.` }), ' ', h('span', { text: typo(TITLES[id].line) }))),
  );
  animate(lines, app.reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: app.reduced() ? 200 : 700, delay: 350, easing: 'cubic-bezier(.16,1,.3,1)' });
  return lines;
}

/** Golden-angle petals, so each new day's petal fills a gap and none of the earlier ones move. */
export function moonflowerSVG(days: number, size = 46) {
  const petals = Math.min(days, MOONFLOWER.petalCap);
  const seeds = Math.min(Math.max(0, days - MOONFLOWER.petalCap), 55);
  const out: string[] = [];
  for (let i = 0; i < petals; i++) {
    const a = ((i * 137.508) % 360) - 90;
    out.push(`<path class="w2-sf-p" transform="rotate(${a.toFixed(2)} 50 46)" d="M50 46C55.2 40.6 57.4 33 56 25.6C55 21 52.6 17.8 50 16.2C47.4 17.8 45 21 44 25.6C42.6 33 44.8 40.6 50 46Z"/>`);
  }
  const dots: string[] = [];
  for (let k = 0; k < seeds; k++) {
    const r = 1.35 * Math.sqrt(k + 0.6);
    const a = k * 2.39996;
    dots.push(`<circle cx="${(50 + Math.cos(a) * r).toFixed(2)}" cy="${(46 + Math.sin(a) * r).toFixed(2)}" r=".62"/>`);
  }
  return `<svg class="w2-sf" viewBox="0 0 100 110" width="${size}" height="${Math.round(size * 1.1)}" aria-hidden="true" data-petals="${petals}" data-seeds="${seeds}">
<path d="M50 60C50.6 74 49.2 92 50.4 108" fill="none" stroke="#6f8fb8" stroke-width="2.2" stroke-linecap="round"/>
<path d="M50.2 88C57 80 66 79 72 82C66 88 57 90 50.2 88Z" fill="#101a2c" stroke="#8fb8ff" stroke-opacity=".6" stroke-width="1"/>
<g fill="url(#w2sfg)" stroke="#e6f0ff" stroke-opacity=".75" stroke-width=".7">${out.join('')}</g>
<circle cx="50" cy="46" r="10.6" fill="#0a0f1e" stroke="#8fb8ff" stroke-width="1.1"/>
<g fill="#cfe4ff">${dots.join('')}</g>
<defs><linearGradient id="w2sfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f6ff"/><stop offset="1" stop-color="#9fb8e8"/></linearGradient></defs>
</svg>`;
}

/** The moonflower next to the status: small, quiet, a petal per distinct visit day. */
export function moonflower(app: App) {
  const days = app.store.derived().visitDays.length;
  const b = h('button', { type: 'button', class: 'w2-moonflower', 'data-days': String(days), 'aria-label': MOONFLOWER.label(Math.min(days, MOONFLOWER.petalCap)), html: moonflowerSVG(days) });
  b.addEventListener('click', () => app.toast(MOONFLOWER.toast));
  return b;
}

/** About 1 day in 7 (FNV-1a over the day key), the same all day on every device. */
export function foilDay(day: string) {
  let x = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) {
    x ^= day.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x % 7 === 3;
}

/** On a foil day the card front carries a holographic layer: one sweep on reveal, a still sheen under reduced motion. */
export function foilLayer(app: App, front: HTMLElement, day: string) {
  if (!foilDay(day)) return null;
  const layer = h('span', { class: 'w2-foil', 'aria-hidden': 'true' });
  front.classList.add('is-foil');
  front.append(layer, h('span', { class: 'w2-foil-tag', text: 'Foil' }));
  return {
    play() {
      if (app.reduced()) return;
      animate(layer, [{ backgroundPosition: '-60% 0', opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0.85, offset: 0.75 }, { backgroundPosition: '160% 0', opacity: 0.35 }], { duration: 1500, delay: 760, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      (window as unknown as { __w2foil?: number }).__w2foil = ((window as unknown as { __w2foil?: number }).__w2foil ?? 0) + 1;
    },
  };
}
