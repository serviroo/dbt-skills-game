/**
 * Wave 2, the Shadows side: the roster (silhouettes drawn in code), their names for them, the hidden "awaken" rise,
 * Bramble's nap in the Stealth room, Vesper's lap on rank-ups and the small Inventory. Every unlock is derived from them
 * distinct visit days on each render; only their names are stored (settings.names, one setAt per shadow).
 */
import { animate } from '../ui/anim';
import { mountScene } from '../scene/vignettes/host';
import type { CampHit, CampInput } from '../scene/watch/camp';
import '../scene/watch/camp.css';
import { icon } from './art';
import { now, onFrame } from './clock';
import { INVENTORY, ROSTER, ROSTER_COPY, type ShadowDef, type ShadowId } from '../content/roster-lines';
import type { App } from './app';
import { cleanName, type Store } from './store';
import { h, typo } from './ui';

let svgN = 0;

export const visitCount = (st: Store) => st.derived().visitDays.length;
export const hasShadow = (st: Store, id: ShadowId) => visitCount(st) >= (ROSTER.find((s) => s.id === id)?.at ?? Infinity);

/** Silhouette shapes in a 100 x 140 box, standing on y = 132. Eyes are separate so they can glow. */
const SHAPES: Record<ShadowId, { body: string; extra?: string; eyes: string }> = {
  sable: {
    body:
      'M33 46C24 70 20 104 15 132H85C80 104 76 70 67 46Z' +
      'M50 19C57 19 61 24 61 31V37C61 40 59 42 57 43L69 46C74 47 77 51 76 56L72 60H68L66 82L64 84L63 130H56L54 92H46L44 130H37L36 84L34 82L32 60H28L24 56C23 51 26 47 31 46L43 43C41 42 39 40 39 37V31C39 24 43 19 50 19Z' +
      'M50 20C46 11 38 6 27 8C33 10 37 14 39 19C33 16 26 16 20 20C28 20 34 23 39 28Z',
    extra: 'M36.5 80H63.5M42 46.5L50 52L58 46.5',
    eyes: '<rect x="43.4" y="30.4" width="5.2" height="1.6" rx=".8"/><rect x="51.4" y="30.4" width="5.2" height="1.6" rx=".8"/>',
  },
  anvil: {
    body:
      'M50 16C58 16 63 19 63 24V40C63 42 61 44 59 45L72 47C79 48 83 53 82 60L79 66H74L71 86L68 89L67 130H58L56 96H44L42 130H33L32 89L29 86L26 66H21L18 60C17 53 21 48 28 47L41 45C39 44 37 42 37 40V24C37 19 42 16 50 16Z' +
      'M57 58H86V96C86 110 78 119 71.5 124C65 119 57 110 57 96Z',
    extra: 'M61 62H82V95C82 106 76 113 71.5 117C67 113 61 106 61 95ZM71.5 76V100M64 86H79M37 24H63',
    eyes: '<rect x="42" y="29" width="6" height="2" rx=".6"/><rect x="52" y="29" width="6" height="2" rx=".6"/>',
  },
  bramble: {
    body:
      'M12 131C7 116 14 99 34 93C52 88 74 90 86 103C93 111 93 125 87 131Z' +
      'M33 99C40 99 45 105 45 112C45 120 39 125 31 125C22 125 15 121 13 115C11 109 14 104 20 102C23 100 28 99 33 99Z' +
      'M19 104A5 5 0 1 1 25.5 98.5ZM30 99.5A5 5 0 1 1 38.5 97Z',
    extra: 'M12 121C16 124 22 125 28 124M55 129C57 126 61 125 64 127M70 129C72 126 76 125 79 127',
    eyes: '<path d="M24 110.5Q26.5 113 29 110.5" fill="none" stroke-width="1.5" stroke-linecap="round"/><path d="M33 109.5Q35.5 112 38 109.5" fill="none" stroke-width="1.5" stroke-linecap="round"/>',
  },
  vesper: {
    body:
      'M47 58C37 43 20 35 3 39C9 45 11 51 11 58C17 56 22 58 24 64C28 60 34 61 36 68C40 64 44 64 46 70Z' +
      'M53 58C63 43 80 35 97 39C91 45 89 51 89 58C83 56 78 58 76 64C72 60 66 61 64 68C60 64 56 64 54 70Z' +
      'M50 40C55 44 56.5 56 55.5 70C54.5 84 52.5 96 50 112C47.5 96 45.5 84 44.5 70C43.5 56 45 44 50 40Z' +
      'M50 44C48 36 46 30 46.5 24L43 16L49 19.5H51L57 16L53.5 24C54 30 52 36 50 44Z' +
      'M50 110C48 121 52 128 59 132C52 133 45.5 128 46 119Z',
    extra: 'M46.5 59L13 46M53.5 59L87 46M46 64L26 56M54 64L74 56',
    eyes: '<ellipse cx="48.2" cy="23.2" rx="1.1" ry=".8"/><ellipse cx="51.8" cy="23.2" rx="1.1" ry=".8"/>',
  },
  crest: {
    body: 'M50 16L82 34V88L50 108L18 88V34Z',
    extra: 'M50 26L73 39V83L50 97L27 83V39ZM35 72V56L42.5 63L50 49L57.5 63L65 56V72ZM35 77H65M50 33L53.5 38.5L50 44L46.5 38.5Z',
    eyes: '<circle cx="50" cy="38.5" r="1.4"/><circle cx="42.5" cy="63" r=".9"/><circle cx="57.5" cy="63" r=".9"/><circle cx="50" cy="49" r=".9"/>',
  },
  block: {
    body: 'M38 18H62V44H38ZM36 46H64V86H36ZM25 46H35V82H25ZM65 46H75V82H65ZM37 87H49.4V130H37ZM50.6 87H63V130H50.6Z',
    extra: 'M38 31H62M50 18V44M36 66H64M30 46V82M70 46V82',
    eyes: '<rect x="41.5" y="27" width="5" height="3.4"/><rect x="53.5" y="27" width="5" height="3.4"/>',
  },
  harrow: {
    body:
      'M30 44C17 72 9 104 5 132H95C91 104 83 72 70 44Z' +
      'M50 14C57 14 61 19 61 26V35C61 38 59 40 57 41L71 44C77 45 80 50 79 56L75 61H71L68 84L66 86L65 130H57L55 93H45L43 130H35L34 86L32 84L29 61H25L21 56C20 50 23 45 29 44L43 41C41 40 39 38 39 35V26C39 19 43 14 50 14Z' +
      'M42 21C34 16 30 8 33 1C35 8 40 12 45 16ZM58 21C66 16 70 8 67 1C65 8 60 12 55 16Z',
    extra: 'M34.5 82H65.5M44 44L50 50L56 44M30 46C26 64 24 96 22 130M70 46C74 64 76 96 78 130',
    eyes: '<rect x="43" y="25.4" width="5.4" height="1.6" rx=".8"/><rect x="51.6" y="25.4" width="5.4" height="1.6" rx=".8"/>',
  },
};

/** A roster silhouette. Unlocked: deep fill, Lantern-blue rim, a soft inner glow and lit eyes. Locked: a quiet outline. */
export function shadowSVG(id: ShadowId, opts: { size?: number; locked?: boolean; label?: string } = {}) {
  const { size = 96, locked = false, label } = opts;
  const s = SHAPES[id];
  const n = `rs${++svgN}`;
  const aria = label ? `role="img" aria-label="${label.replace(/"/g, '')}"` : 'aria-hidden="true"';
  if (locked)
    return `<svg class="w2-sil is-locked" viewBox="0 0 100 140" width="${size}" height="${Math.round(size * 1.4)}" ${aria}>
<path d="${s.body}" fill="none" stroke="rgba(125,150,197,.42)" stroke-width="1" stroke-dasharray="2.4 2.2" stroke-linejoin="round"/>
</svg>`;
  return `<svg class="w2-sil" viewBox="0 0 100 140" width="${size}" height="${Math.round(size * 1.4)}" ${aria}>
<defs>
<linearGradient id="${n}b" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#22304f"/><stop offset=".55" stop-color="#0d1426"/><stop offset="1" stop-color="#070a14"/></linearGradient>
<filter id="${n}i" x="-10%" y="-10%" width="120%" height="120%"><feFlood flood-color="#4fb8ff" flood-opacity=".9"/><feComposite in2="SourceAlpha" operator="out"/><feGaussianBlur stdDeviation="2.6"/><feComposite in2="SourceAlpha" operator="in" result="ig"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="ig"/></feMerge></filter>
<filter id="${n}o" x="-40%" y="-30%" width="180%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="3.2" result="b"/><feFlood flood-color="#7b3fe4" flood-opacity=".42"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="${n}e" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="1.2" result="a"/><feMerge><feMergeNode in="a"/><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<g filter="url(#${n}o)"><path d="${s.body}" fill="url(#${n}b)" filter="url(#${n}i)" fill-rule="nonzero"/></g>
<path d="${s.body}" fill="none" stroke="#4fb8ff" stroke-opacity=".62" stroke-width=".9" stroke-linejoin="round"/>
${s.extra ? `<path d="${s.extra}" fill="none" stroke="#9fd2f5" stroke-opacity=".34" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
<g class="w2-sil-eyes" fill="#cfefff" stroke="#cfefff" filter="url(#${n}e)">${s.eyes}</g>
</svg>`;
}

/** The hidden "awaken": a few small shadows rise from the bottom edge for about a second. None under reduced motion. */
export function awakenRise(app: App) {
  if (app.reduced()) return null;
  const layer = h('div', { class: 'w2-rise', 'aria-hidden': 'true', 'data-fx': '' });
  const xs = [14, 31, 50, 69, 86];
  const ids: ShadowId[] = ['anvil', 'sable', 'harrow', 'sable', 'anvil'];
  xs.forEach((x, i) => {
    const s = h('div', { class: 'w2-rise-s', html: shadowSVG(ids[i], { size: i === 2 ? 58 : 46 }) });
    s.style.left = `${x}%`;
    layer.append(s);
    animate(s, [{ transform: 'translate(-50%, 105%)', opacity: 0 }, { transform: 'translate(-50%, 6%)', opacity: 1, offset: 0.45 }, { transform: 'translate(-50%, 10%)', opacity: 0.9, offset: 0.7 }, { transform: 'translate(-50%, 105%)', opacity: 0 }], {
      duration: 1150,
      delay: Math.abs(i - 2) * 70,
      easing: 'cubic-bezier(.2,.7,.25,1)',
      fill: 'both',
    });
  });
  app.root.append(layer);
  window.setTimeout(() => layer.remove(), 1500);
  (window as unknown as { __w2rise?: number }).__w2rise = ((window as unknown as { __w2rise?: number }).__w2rise ?? 0) + 1;
  return layer;
}

/** Vesper's lap on a rank-up: once across the top of the screen, then gone. Nothing under reduced motion. */
export function vesperLap(app: App) {
  if (app.reduced() || !hasShadow(app.store, 'vesper')) return;
  const host = document.getElementById('ui') ?? document.body;
  const k = h('div', { class: 'w2-vesper', 'aria-hidden': 'true', 'data-fx': '', html: shadowSVG('vesper', { size: 70 }) });
  host.append(k);
  const a = animate(
    k,
    [
      { transform: 'translate(-12vw, 34vh) rotate(8deg) scale(.8)', opacity: 0 },
      { transform: 'translate(30vw, 14vh) rotate(-4deg) scale(1)', opacity: 0.95, offset: 0.35 },
      { transform: 'translate(70vw, 10vh) rotate(-10deg) scale(.95)', opacity: 0.9, offset: 0.7 },
      { transform: 'translate(108vw, 20vh) rotate(-16deg) scale(.8)', opacity: 0 },
    ],
    { duration: 1700, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'both' },
  );
  void a.finished.then(() => k.remove(), () => k.remove());
  (window as unknown as { __w2vesper?: number }).__w2vesper = ((window as unknown as { __w2vesper?: number }).__w2vesper ?? 0) + 1;
}

/** Bramble, asleep in a corner of the Stealth room, once he has arrived. */
export function brambleNap(app: App) {
  if (!hasShadow(app.store, 'bramble')) return null;
  return h('div', { class: 'w2-bramble', title: 'Bramble, asleep', html: shadowSVG('bramble', { size: 92, label: 'Bramble, a shadow bear, asleep in the corner' }) }, h('span', { class: 'w2-bramble-z', 'aria-hidden': 'true', text: 'z' }));
}

function namedPanel(app: App, s: ShadowDef, onName: (id: ShadowId, v: string) => void) {
  const st = app.store;
  const name = st.state.settings.names[s.id] ?? '';
  const nick = h('p', { class: `w2-sh-nick${name ? '' : ' is-hidden'}` });
  nick.textContent = name ? `“${name}”` : '';
  const id = `w2n-${s.id}`;
  const input = h('input', { id, class: 'dq-input w2-sh-in', type: 'text', maxlength: 24, autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done', placeholder: ROSTER_COPY.namePlaceholder, 'data-shadow': s.id });
  input.value = name;
  let had = /awaken/i.test(name);
  let timer = 0;
  const commit = () => {
    window.clearTimeout(timer);
    onName(s.id, input.value);
  };
  input.addEventListener('input', () => {
    const has = /awaken/i.test(input.value);
    if (has && !had) awakenRise(app);
    had = has;
    window.clearTimeout(timer);
    timer = window.setTimeout(commit, 400);
  });
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && input.blur());
  const el = h(
    'article',
    { class: `w2-sh w2-sh--${s.id}`, 'data-shadow': s.id, 'aria-label': `${s.name}, ${s.role}` },
    h('div', { class: 'w2-sh-stage' }, h('span', { class: 'w2-sh-floor', 'aria-hidden': 'true' }), h('div', { class: 'w2-sh-art', html: shadowSVG(s.id, { size: 96 }) })),
    h('h3', { class: 'w2-sh-n', id: `w2h-${s.id}`, text: s.name }),
    h('p', { class: 'w2-sh-role', text: s.role }),
    nick,
    h('p', { class: 'w2-sh-idle', text: typo(s.idle) }),
    h('div', { class: 'dq-field w2-sh-field' }, h('label', { for: id, class: 'dq-label w2-sh-label', text: ROSTER_COPY.nameLabel }), input),
  );
  return { el, input, nick };
}

/**
 * The camp above the roster: the 3D scene through the companion's scene host, with a labelled button laid over each
 * watcher who has arrived (so a tap, the keyboard and a screen reader all reach them). It shows only while the scene is
 * loading or running (a lost context leaves its room until it comes back); with no WebGL or a failed load it takes no
 * room and the roster under it is the Watch.
 */
function campStage(app: App, arrived: ShadowDef[], open: (id: ShadowId, from: HTMLButtonElement) => void) {
  const btns = new Map<ShadowId, HTMLButtonElement>();
  const hits = h('div', { class: 'w2-camp-hits', role: 'group', 'aria-label': ROSTER_COPY.campLabel });
  for (const s of arrived) {
    const b = h('button', { type: 'button', class: 'w2-camp-hit', 'data-shadow': s.id, 'aria-label': `${s.name}, ${s.role}`, 'aria-haspopup': 'dialog' }, h('span', { class: 'w2-camp-tag', 'aria-hidden': 'true', text: s.name }));
    b.addEventListener('click', () => open(s.id, b));
    btns.set(s.id, b);
    hits.append(b);
  }
  const stage = h('div', { class: 'w2-camp' }, hits, h('p', { class: 'w2-camp-hint', text: ROSTER_COPY.campHint }));
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const shown = new Map<ShadowId, { x: number; y: number; w: number; h: number; z: string }>();
  /** a change smaller than about a pixel: what a slow GPU's step down in resolution does to the framing */
  const near = (a: number, b: number) => Math.abs(a - b) < 0.002;
  const input: CampInput = {
    ids: arrived.map((s) => s.id),
    // called when the frame changes (its size or shape), never per frame: an idle camp does no style work
    onHits(list: CampHit[]) {
      // nearer figures sit on top, so a tap where two overlap goes to the one in front
      const order = [...list].sort((a, b) => b.depth - a.depth);
      for (const { id, x, y, w, h: ht } of list) {
        const b = btns.get(id);
        if (!b) continue;
        const z = String(1 + order.findIndex((o) => o.id === id));
        const was = shown.get(id);
        if (was && was.z === z && near(was.x, x) && near(was.y, y) && near(was.w, w) && near(was.h, ht)) continue;
        shown.set(id, { x, y, w, h: ht, z });
        b.style.setProperty('--x', pct(x));
        b.style.setProperty('--y', pct(y));
        b.style.setProperty('--w', pct(w));
        b.style.setProperty('--h', pct(ht));
        b.style.zIndex = z;
      }
    },
  };
  const unmount = mountScene(stage, { kind: 'camp', clock: { now, onFrame }, reduced: () => app.reduced(), onMotion: (fn) => app.onMotion(fn), waitMs: Infinity, input });
  return { stage, unmount };
}

/**
 * The full-width roster on the Shadows screen: the camp, then tall panels for the ones who arrived and quiet outlines
 * for the rest. Tapping a watcher in camp opens their own panel, name field and all, in a sheet over the page; the
 * top bar (and the Safe Zone in it) stays above the sheet and reachable. `leave` closes the sheet and takes the camp
 * down.
 */
export function rosterSection(app: App) {
  const st = app.store;
  let n = visitCount(st);
  const live = new Map<ShadowId, { el: HTMLElement; input: HTMLInputElement; nick: HTMLElement }>();
  const onName = (id: ShadowId, raw: string) => {
    const v = cleanName(raw);
    const cur = st.state.settings.names[id] ?? '';
    if (v === cur) return;
    if (v) st.state.settings.names[id] = v;
    else delete st.state.settings.names[id];
    st.touch(`name:${id}`);
    st.save();
    const p = live.get(id);
    if (p) {
      p.nick.textContent = v ? `“${v}”` : '';
      p.nick.classList.toggle('is-hidden', !v);
    }
  };
  /** A watcher's panel: their own once they have arrived, a quiet outline until then, nothing for a hidden one. */
  const panelOf = (s: ShadowDef) => {
    if (n >= s.at) {
      const p = namedPanel(app, s, onName);
      live.set(s.id, p);
      return p.el;
    }
    if (s.hidden) return null;
    return h(
      'article',
      { class: `w2-sh is-locked w2-sh--${s.id}`, 'data-shadow': s.id, 'aria-label': `${s.name}. ${ROSTER_COPY.arrives(s.at - n)}` },
      h('div', { class: 'w2-sh-stage' }, h('div', { class: 'w2-sh-art', html: shadowSVG(s.id, { size: 96, locked: true }) })),
      h('h3', { class: 'w2-sh-n', text: s.name }),
      h('p', { class: 'w2-sh-when', text: ROSTER_COPY.arrives(s.at - n) }),
    );
  };
  const arrived = () => ROSTER.filter((s) => n >= s.at);
  const row = h('div', { class: 'w2-roster-row' }, ROSTER.map(panelOf));

  // the card sheet: the watcher's own panel moves into it while it is open, and back to its place in the row after
  let sheet: { wrap: HTMLElement; panel: HTMLElement; spot: Comment; from: HTMLButtonElement; inert: HTMLElement[] } | null = null;
  // Back and Escape close an open card before anything else (see App.sheet)
  let cardDone: (() => void) | null = null;
  const closeCard = (refocus = true) => {
    if (!sheet) return;
    const { wrap, panel, spot, from, inert } = sheet;
    sheet = null;
    cardDone?.();
    cardDone = null;
    // a name still being typed is kept before the field moves
    const field = panel.querySelector('input');
    if (field && document.activeElement === field) field.blur();
    spot.replaceWith(panel);
    wrap.remove();
    for (const e of inert) e.inert = false;
    if (refocus && from.isConnected) from.focus({ preventScroll: true });
  };
  const openCard = (id: ShadowId, from: HTMLButtonElement) => {
    const p = live.get(id);
    const page = el.closest<HTMLElement>('.dq-page');
    if (!p || !page) return;
    closeCard(false);
    const spot = document.createComment(id);
    p.el.replaceWith(spot);
    const x = h('button', { type: 'button', class: 'dq-icbtn w2-camp-x', 'aria-label': ROSTER_COPY.closeCard, html: icon('close'), onclick: () => closeCard() });
    const card = h('div', { class: 'w2-camp-card', role: 'dialog', 'aria-labelledby': `w2h-${id}` }, x, p.el);
    const wrap = h('div', { class: 'dq-sheet w2-camp-sheet' }, card);
    wrap.addEventListener('click', (e) => e.target === wrap && closeCard());
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') (e.stopPropagation(), closeCard());
    });
    // the sheet goes in the app's sheet layer, outside the page, so it is on screen from the first tap; the page rests
    // behind it while the top bar (Back, the Safe Zone) stays live above it
    const inert = page.inert ? [] : [page];
    for (const c of inert) c.inert = true;
    app.sheetLayer.append(wrap);
    sheet = { wrap, panel: p.el, spot, from, inert };
    cardDone = app.sheet(() => closeCard());
    if (!app.reduced()) animate(card, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
    x.focus({ preventScroll: true });
  };

  let camp = arrived().length ? campStage(app, arrived(), openCard) : null;
  const el = h(
    'section',
    { class: 'w2-roster', 'aria-labelledby': 'w2-roster-h' },
    h('h2', { class: 'dq-sec-h', id: 'w2-roster-h' }, h('span', { text: ROSTER_COPY.title }), h('span', { class: 'dq-sec-sub', text: ROSTER_COPY.sub })),
    camp?.stage ?? null,
    row,
  );
  /** Where a watcher is in the row: their panel, or the spot it keeps while their card is open. */
  const placeOf = (id: ShadowId) => [...row.childNodes].find((c) => (c instanceof Element ? c.getAttribute('data-shadow') : c instanceof Comment ? c.data : null) === id);
  /**
   * Visit days counted since, here or in another open copy (a Save Crystal restored there): whoever arrives takes their
   * place in the row, the rest count down, and the camp is built again only when someone joins it. Fields being typed
   * in, an open card and focus in camp stay as they were.
   */
  const arrive = () => {
    const now = visitCount(st);
    if (now === n) return;
    const had = arrived().length;
    n = now;
    ROSTER.forEach((s, i) => {
      if (live.has(s.id)) return;
      const next = panelOf(s);
      const at = placeOf(s.id);
      if (at && next) at.replaceWith(next);
      else if (next) row.insertBefore(next, ROSTER.slice(i + 1).map((x) => placeOf(x.id)).find(Boolean) ?? null);
    });
    if (arrived().length === had) return;
    const focused = camp?.stage.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.shadow : undefined;
    camp?.unmount();
    const next = campStage(app, arrived(), openCard);
    if (camp) camp.stage.replaceWith(next.stage);
    else row.before(next.stage);
    camp = next;
    const hit = (id: string | undefined) => (id ? next.stage.querySelector<HTMLButtonElement>(`[data-shadow="${id}"]`) : null);
    if (sheet) sheet.from = hit(sheet.panel.dataset.shadow) ?? sheet.from;
    hit(focused)?.focus({ preventScroll: true });
  };
  // names set in another open copy show up here, without touching a field the player is typing in
  const off = st.onChange(() => {
    if (!el.isConnected) return void off();
    arrive();
    for (const [id, p] of live) {
      const v = st.state.settings.names[id] ?? '';
      p.nick.textContent = v ? `“${v}”` : '';
      p.nick.classList.toggle('is-hidden', !v);
      if (document.activeElement !== p.input && cleanName(p.input.value) !== v) p.input.value = v;
    }
  });
  return {
    el,
    leave() {
      closeCard(false);
      camp?.unmount();
    },
  };
}

let pebbleN = 0;
export function pebbleSVG(size = 64) {
  const n = `pb${++pebbleN}`;
  return `<svg viewBox="0 0 80 60" width="${size}" height="${Math.round(size * 0.75)}" aria-hidden="true" class="w2-pebble-svg">
<defs>
<radialGradient id="${n}s" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#5d6f96"/><stop offset=".55" stop-color="#27324f"/><stop offset="1" stop-color="#101627"/></radialGradient>
<radialGradient id="${n}g" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="#ffe2a0" stop-opacity=".4"/><stop offset="1" stop-color="#c9a45c" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="40" cy="36" rx="38" ry="22" fill="url(#${n}g)"/>
<ellipse cx="40" cy="50" rx="24" ry="3.4" fill="#05070d" opacity=".55"/>
<path d="M14 36C13 25 24 16 39 16C55 16 67 23 67 34C67 44 56 50 40 50C25 50 15 45 14 36Z" fill="url(#${n}s)" stroke="#f3dca6" stroke-opacity=".7" stroke-width="1" stroke-linejoin="round"/>
<path d="M22 28C26 22 33 20 41 20" fill="none" stroke="#e8f0ff" stroke-opacity=".45" stroke-width="1.4" stroke-linecap="round"/>
<path d="M37 27L41 33L37 39M45 27L41 33" fill="none" stroke="#f6e2b0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M66 8l1.2 3.3 3.3 1.2-3.3 1.2L66 17l-1.2-3.3-3.3-1.2 3.3-1.2z" fill="#f6e2b0"/>
</svg>`;
}

/**
 * A small Inventory: the Legendary Pebble after a few visit days, otherwise one quiet empty slot. `sync` lays the pebble
 * in once the visit days reach it, here or in another open copy (a Save Crystal restored there).
 */
export function inventorySection(app: App) {
  const holds = () => visitCount(app.store) >= INVENTORY.pebbleAt;
  const slotOf = (has: boolean) =>
    has
      ? h(
          'div',
          { class: 'w2-item w2-item--legendary', 'data-item': 'pebble' },
          h('div', { class: 'w2-item-art', html: pebbleSVG(70) }),
          h('div', { class: 'w2-item-txt' }, h('span', { class: 'w2-item-r', text: INVENTORY.pebble.rarity }), h('h3', { class: 'w2-item-n', text: INVENTORY.pebble.name }), h('p', { class: 'w2-item-l', text: typo(INVENTORY.pebble.line) })),
        )
      : h('div', { class: 'w2-item is-empty', 'data-item': 'empty' }, h('div', { class: 'w2-item-art w2-item-art--empty', 'aria-hidden': 'true' }), h('p', { class: 'w2-item-l', text: typo(INVENTORY.empty) }));
  let has = holds();
  let slot = slotOf(has);
  const el = h(
    'section',
    { class: 'w2-inv', 'aria-labelledby': 'w2-inv-h' },
    h('h2', { class: 'dq-sec-h', id: 'w2-inv-h' }, h('span', { text: INVENTORY.title }), h('span', { class: 'dq-sec-sub', text: INVENTORY.sub })),
    slot,
  );
  const sync = () => {
    if (holds() === has) return;
    has = holds();
    const next = slotOf(has);
    slot.replaceWith(next);
    slot = next;
  };
  return { el, sync };
}
