import { LOADOUT, LOADOUT_COPY, MODULES, MODULE_ORDER, SAFE, SKILL, SKILLS, type Skill } from '../content/dbt';
import { LABEL_SECONDS, LIBRARY_COPY, NEEDS, TIMES, TOPICS } from '../content/skill-library';
import { CRISIS_CHECKED } from '../content/crisis-lines';
import { LETTER, REWARDS } from '../content/intro';
import { ABOUT, CLEAR_COPY, CRYSTAL_COPY, KEEP_COPY, PEEK_COPY } from '../content/daily-lines';
import type { App, Route, ScreenOut, Visit } from './app';
import { glyph, icon, mothSVG } from './art';
import { skillCard } from './hub';
import { regionPicker, telHref, smsHref } from './safe';
import { allyCard, allyName, cardOf, favFirst, focusBack, refill } from './artroom';
import { artStore } from './artstore';
import { storyStore } from './storystore';
import { addDays, cleanName, dayKey, fieldKey, fieldTimes, isSkillId, ROW_CAP, uid, type DiaryEntry, type State, type Store } from './store';
import { btn, copyText, field, h, md, p, panel, place, quotes, redrawn, segmented, shareOrSave, toggle, typo, youCopy } from './ui';
import type { KeepStatus } from '../pwa/register';
import { volumeSliders } from '../ui/volume';
import { STEALTH, STEALTH_LINES } from '../content/stealth-lines';
import { fishSVG, lurkCatSVG, seaweedSVG, sharkFinSVG, sharkTailSVG } from './art';
import { Slime } from './bubbles';
import { inventorySection, rosterSection, brambleNap } from './roster';
import { wardrobePanel } from './wardrobe';
import { DEFAULT_COMPANION, DEFAULT_NAME } from '../core/you';
import { BESIDE, READ_SIZES, type ReadSize } from '../core/stored-names';
import { mayMentionTherapist } from '../core/session';
import { canWrite, cleared, clearStatus, holdAll, onClearStatus, write } from '../core/cleared';
import { siteUrl } from '../core/base';
import { clearGame } from './clear';
import { crystalContent, makeCrystal, readCrystal, restorePreferences, restoreUnread, type Peek } from './crystal';
import { restoreSkillDrafts } from './skilldraft';
import { supportListsCopy } from './support-lists';
import { keepTextSize, textSize } from './text-size';

const pageHead = (title: string, sub?: string) => h('header', { class: 'dq-pagehead' }, h('h1', { class: 'dq-h1', 'data-focus': '', text: title }), sub ? p(sub, 'dq-text dq-pagesub') : null);

// ---------------- Stealth room (the Rest room) ----------------
/** The Stealth title is never stored separately: any rest event means it is unlocked. The first one carries its id. */
export const LURKER_TITLE = 'professional-lurker';
export const lurkerUnlocked = (st: Store) => st.state.events.some((e) => e.k === 'rest');

/** Room look only (aquarium, breathing words). Kept beside the save, never part of it. */
function stealthPrefs(key: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(`${key}${BESIDE.stealth}`) ?? 'null') as { aquarium?: unknown; words?: unknown } | null;
    return { aquarium: raw?.aquarium === true, words: raw?.words === true };
  } catch {
    return { aquarium: false, words: false };
  }
}
function saveStealthPrefs(key: string, prefs: { aquarium: boolean; words: boolean }) {
  const out = JSON.stringify(prefs);
  write(() => {
    try {
      localStorage.setItem(`${key}${BESIDE.stealth}`, out);
    } catch {
      /* the room still works; the look resets next visit */
    }
  });
}

const ST_IC = {
  fish: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12c-2.6-4.2-8.4-5.2-12.4-1.4L4 7.6v8.8l4.1-3c4 3.8 9.8 2.8 12.4-1.4z"/><path d="M16.6 10.8h.01" stroke-width="2.2"/></svg>',
  breath: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 9.5q4.25-4 8.5 0t8.5 0"/><path d="M3.5 15q4.25-4 8.5 0t8.5 0" opacity=".55"/></svg>',
};

export function restScreen(app: App): ScreenOut {
  const st = app.store;
  const firstEver = !lurkerUnlocked(st);
  if (!st.state.events.some((e) => e.k === 'rest' && e.day === st.today())) {
    // Default Skin Day: the Stealth room was the first thing the player did today (kept on the event, so it can't be lost)
    const quiet = !st.state.events.some((e) => e.day === st.today() && e.k !== 'visit');
    st.add('rest', 10, firstEver || quiet ? { data: { ...(firstEver ? { title: LURKER_TITLE } : {}), ...(quiet ? { quiet: true } : {}) } } : {});
  }
  const prefs = stealthPrefs(st.key);
  const line = STEALTH_LINES[st.visitIndex() % STEALTH_LINES.length];

  const fish = ([0, 1, 2] as const).map((tone) => h('div', { class: `dq-st-fish dq-st-fish${tone}` }, h('div', { class: 'dq-st-fish-in', html: fishSVG(tone) })));
  const weeds = [0, 1, 2].map((i) => h('div', { class: `dq-st-weed dq-st-weed${i}`, html: seaweedSVG([118, 82, 104][i], i * 1.7) }));
  const tank = h('div', { class: 'dq-st-tank', 'aria-hidden': 'true' }, h('div', { class: 'dq-st-caustic' }), ...weeds, ...fish);
  const glow = h('div', { class: 'dq-st-glow', 'aria-hidden': 'true' });
  const sea = h('div', { class: 'dq-st-sea' }, h('div', { class: 'dq-st-sea-in', html: mothSVG({ size: 190 }) }));
  const word = h('p', { class: 'dq-st-word', 'aria-hidden': 'true' }, h('span', { class: 'dq-st-in', text: 'in' }), h('span', { class: 'dq-st-out', text: 'out' }));
  const cat = h('div', { class: 'dq-st-cat', html: lurkCatSVG(250) });
  const shark = h(
    'div',
    { class: 'dq-st-shark' },
    h('div', { class: 'dq-st-shark-dir' }, h('span', { class: 'dq-st-wake' }), h('span', { class: 'dq-st-pop dq-st-pop0' }), h('span', { class: 'dq-st-pop dq-st-pop1' }), h('span', { class: 'dq-st-tail', html: sharkTailSVG() }), h('span', { class: 'dq-st-fin', html: sharkFinSVG() })),
  );
  const floor = h('div', { class: 'dq-st-floor', 'aria-hidden': 'true' }, shark);
  const stage = h('div', { class: 'dq-st-stage' }, tank, glow, sea, word, floor, cat, brambleNap(app));

  const title = firstEver
    ? h(
        'div',
        { class: 'dq-st-unlock', role: 'status' },
        h('span', { class: 'dq-st-unlock-k', text: STEALTH.unlockKicker }),
        h('span', { class: 'dq-st-unlock-n', text: STEALTH.titleName }),
        h('span', { class: 'dq-st-unlock-l', text: typo(STEALTH.titleLine) }),
      )
    : h('p', { class: 'dq-st-title' }, h('span', { class: 'dq-st-title-k', text: STEALTH.titleChip }), h('span', { class: 'dq-st-title-n', text: STEALTH.titleName }));

  const el = h('div', { class: 'dq-rest dq-stealth' });
  const setAquarium = (on: boolean) => {
    prefs.aquarium = on;
    el.classList.toggle('is-aquarium', on);
    app.bubbles.set(on ? 13 : 7, on ? 1.2 : 1);
  };
  /**
   * The room's one breath, started when the room opened on the clock its animations run on. The glow and the
   * Breathing words take that start whenever either starts again (the words turned on, or the glow breathing again
   * once motion is back), so they always breathe together. A start, not a place in the breath: one that waits for its
   * first frame would only count from that frame, however long a slow device takes to draw it. The words, paused while
   * they are off, stay paused.
   */
  const opened = Number(document.timeline.currentTime);
  const inStep = () => {
    for (const a of [glow, ...word.querySelectorAll('span')].flatMap((e) => e.getAnimations())) if (a.playState !== 'paused') a.startTime = opened;
  };
  const setWords = (on: boolean) => {
    prefs.words = on;
    el.classList.toggle('is-words', on);
    if (on) inStep();
  };
  const offMotion = app.onMotion(inStep);
  const mode = (label: string, ic: string, on: boolean, set: (v: boolean) => void, aria?: string) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'dq-opt dq-st-mode',
        'aria-pressed': String(on),
        'aria-label': aria ?? null,
        onclick: () => {
          const v = b.getAttribute('aria-pressed') !== 'true';
          b.setAttribute('aria-pressed', String(v));
          set(v);
          saveStealthPrefs(st.key, prefs);
        },
      },
      h('span', { class: 'dq-st-mode-ic', html: ic }),
      h('span', { text: label }),
    );
    return b;
  };
  const fishBtn = mode(STEALTH.aquarium, ST_IC.fish, prefs.aquarium, setAquarium);
  const wordsBtn = mode(STEALTH.words, ST_IC.breath, prefs.words, setWords, `${STEALTH.words}, ${STEALTH.wordsHint}`);
  // the look chosen in another open copy's Stealth room: this one takes it on, the breath going on as it was
  let kept = JSON.stringify(stealthPrefs(st.key));
  const offLook = st.onChange(() => {
    const now = stealthPrefs(st.key);
    if (JSON.stringify(now) === kept) return;
    kept = JSON.stringify(now);
    for (const [b, on, set] of [[fishBtn, now.aquarium, setAquarium], [wordsBtn, now.words, setWords]] as const) {
      if (b.getAttribute('aria-pressed') === String(on)) continue;
      b.setAttribute('aria-pressed', String(on));
      set(on);
    }
  });
  const slime = new Slime({ reduced: () => app.reduced(), label: STEALTH.slimeLabel, onPoke: () => app.sound('bubble') });
  el.append(
    h('header', { class: 'dq-pagehead dq-st-head' }, h('p', { class: 'dq-st-kicker', text: STEALTH.kicker }), h('h1', { class: 'dq-h1', 'data-focus': '', text: STEALTH.title }), p(STEALTH.sub, 'dq-text dq-pagesub dq-st-sub')),
    title,
    stage,
    h(
      'div',
      { class: 'dq-st-modes' },
      fishBtn,
      wordsBtn,
    ),
    youCopy(p(line, 'dq-text dq-st-line'), line, true),
    h('section', { class: 'dq-st-bath', 'aria-label': 'Bubble bath' }, h('p', { class: 'dq-st-kicker', text: STEALTH.slimeKicker }), slime.el, p(STEALTH.slimeLine, 'dq-text dq-st-bath-l')),
  );
  el.classList.toggle('is-aquarium', prefs.aquarium);
  el.classList.toggle('is-words', prefs.words);

  // Small things that happen on their own, now and then. Timers only; every motion itself is a CSS animation.
  const timers = new Set<number>();
  const later = (sec: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, sec * 1000);
    timers.add(id);
  };
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  let catBusy = '';
  const blep = () => {
    if (catBusy === 'nudge' || app.reduced()) return;
    cat.classList.add('is-blep');
    later(1, () => cat.classList.remove('is-blep'));
  };
  const sprawl = () => {
    if (catBusy || app.reduced()) return;
    catBusy = 'sprawl';
    cat.classList.add('is-sprawl');
    later(rnd(24, 40), () => {
      cat.classList.remove('is-sprawl');
      later(6, () => (catBusy = ''));
    });
  };
  const nudge = () => {
    if (catBusy || app.reduced()) return;
    catBusy = 'nudge';
    cat.classList.add('is-nudge');
    later(6.2, () => {
      cat.classList.remove('is-nudge');
      catBusy = '';
    });
  };
  const swim = () => {
    if (app.reduced() || shark.classList.contains('is-swim')) return;
    shark.classList.toggle('is-rtl', Math.random() < 0.5);
    shark.classList.add('is-swim');
    later(11.2, () => shark.classList.remove('is-swim'));
  };
  const every = (first: [number, number], next: [number, number], fn: () => void) => {
    const arm = (r: [number, number]) => later(rnd(r[0], r[1]), () => (fn(), arm(next)));
    arm(first);
  };
  // each one rests while motion is off when its time comes, so they all follow the setting as it changes
  every([18, 40], [55, 140], blep);
  every([8, 16], [45, 100], swim);
  every([35, 70], [100, 190], sprawl);
  every([65, 100], [120, 230], nudge);
  const hook = { blep, sprawl, nudge, swim, slime };
  (window as unknown as { __stealth?: typeof hook }).__stealth = hook;

  return {
    el,
    title: STEALTH.title,
    mode: 'sub',
    bubbles: prefs.aquarium ? [13, 1.2] : [7, 1],
    leave: () => {
      offMotion();
      offLook();
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      slime.destroy();
      const w = window as unknown as { __stealth?: typeof hook };
      if (w.__stealth === hook) delete w.__stealth;
      // B10: one quiet line wherever the player lands, except the Safe Zone. Waits for a pending Safe Zone credit to finish.
      const delay = st.state.flags.safeCredit ? 5600 : 420;
      window.setTimeout(() => {
        const r = app.route.name;
        if (app.root.isConnected && r !== 'rest' && r !== 'safe') app.toast(STEALTH.leave);
      }, delay);
    },
  };
}

// ---------------- Shadows (collection) ----------------
/** A card in a collection, in the cell its row stretches (.dq-cardcell). */
const cell = (card: HTMLElement) => h('div', { class: 'dq-cardcell' }, card);

export function shadowsScreen(app: App): ScreenOut {
  const first = h(
    'article',
    { class: 'dq-first' },
    h('div', { class: 'dq-first-art', html: mothSVG({ size: 150 }) }),
    h('div', { class: 'dq-first-txt' }, youCopy(h('h2', { class: 'dq-first-n', text: typo('{companion}') }), '{companion}'), p('A small night moth, asleep. It was here before any skill, and it stays.', 'dq-text'), h('span', { class: 'dq-tag dq-mint', text: 'Yours' })),
  );
  // every skill met and practised, another open copy's too, as it lands; focus stays on the same skill's card
  const grid = redrawn(() => {
    const d = app.store.derived();
    const counts: Record<string, number> = {};
    for (const e of app.store.state.events) if (e.k === 'skill' && e.skill) counts[e.skill] = (counts[e.skill] ?? 0) + 1;
    const owned = SKILLS.filter((s) => d.collection.has(s.id));
    return owned.length
      ? h(
          'div',
          { class: 'dq-collection' },
          owned.map((s) =>
            cell(
              h(
                'button',
                { type: 'button', class: 'dq-cardbtn', 'data-item': s.id, onclick: () => app.go({ name: 'skill', id: s.id }), 'aria-label': `${s.sl}, ${s.real}. Practise it.` },
                skillCard(s.id, { small: true }),
                counts[s.id] ? h('span', { class: 'dq-cardbtn-n', text: `Practised ${counts[s.id]}x` }) : h('span', { class: 'dq-cardbtn-n', text: 'Met' }),
              ),
            ),
          ),
        )
      : p('Flip a daily card or open any skill, and it joins here.', 'dq-text dq-empty');
  }, () => null);
  const inventory = inventorySection(app);
  const offShown = app.store.onChange(() => {
    grid.update();
    inventory.sync();
  });
  const designSlot = h(
    'button',
    { type: 'button', class: 'dq-cardbtn dq-allyslot', onclick: () => app.go({ name: 'draw', kind: 'ally' }) },
    h('span', { class: 'dq-cardface dq-allyslot-face' }, h('span', { class: 'dq-allyslot-ic', html: icon('brush') }), h('span', { class: 'dq-allyslot-t', text: 'Design an ally' }), h('span', { class: 'dq-allyslot-s', text: 'Draw one. It joins your army.' })),
  );
  const slot = cell(designSlot);
  const allies = h('div', { class: 'dq-collection dq-allies' }, slot);
  const roster = rosterSection(app);
  const as = artStore(app.store.key);
  let turn = 0;
  const showAllies = async () => {
    const n = ++turn;
    const list = await as.shown();
    if (n !== turn) return;
    const mine = favFirst(list.filter((m) => m.kind === 'ally'));
    refill(allies, mine.map(cardOf).join('\n'), () => [
      ...mine.map((m) =>
        cell(
          h(
            'button',
            { type: 'button', class: 'dq-cardbtn dq-allybtn', 'data-piece': m.id, onclick: () => app.go({ name: 'piece', id: m.id }), 'aria-label': `${m.name || 'Shadow ally'}, a shadow ally you designed${m.fav ? ', a favourite' : ''}` },
            allyCard(app, m, undefined, true),
            h('span', { class: 'dq-allybtn-fit', 'aria-hidden': 'true', text: typo(allyName(m)) }),
          ),
        ),
      ),
      slot,
    ]);
    focusBack(allies);
  };
  const off = as.onChange(() => void showAllies());
  void showAllies();
  const el = h(
    'div',
    { class: 'dq-page dq-shadows' },
    pageHead('Shadows', 'Every skill you meet joins the Night Watch as a shadow ally, and so does every ally you draw. They stay.'),
    first,
    roster.el,
    h('h2', { class: 'dq-sec-h' }, h('span', { text: 'Designed by you' }), h('span', { class: 'dq-sec-sub', text: 'From the Art room' })),
    allies,
    h('h2', { class: 'dq-sec-h' }, h('span', { text: 'Skill shadows' }), h('span', { class: 'dq-sec-sub', text: 'Every skill you have met' })),
    grid.node,
    inventory.el,
    h('div', { class: 'dq-actions' }, btn('All skills', () => app.go({ name: 'library' }), { kind: 'quiet', ic: 'book' })),
  );
  return { el, title: 'Shadows', mode: 'sub', leave: () => { turn++; off(); offShown(); roster.leave(); } };
}

// ---------------- Library ----------------
/** What the player is looking for in the Skills list. Kept for this visit (so it is still there after a skill), never saved. */
const finding = { q: '', need: '', topic: '', time: '' };
type Finding = typeof finding;
/** Every skill once, in the order the list shows them: the loadout, then each module. */
const CATALOGUE = [...LOADOUT, ...MODULE_ORDER.flatMap((m) => SKILLS.filter((s) => s.module === m && !s.loadout).map((s) => s.id))];
/** Text as a search compares it: any case, any quote marks, hyphens as spaces, runs of space as one. */
const fold = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[-‐‑–]/g, ' ').replace(/\s+/g, ' ').trim();
const ownKey = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Whether a skill fits everything chosen: its need, topic and time, and every word typed, in either of its names. */
function fits(s: Skill, f: Finding) {
  if (f.need && !NEEDS.find((n) => n.id === f.need)?.skills.includes(s.id)) return false;
  if (f.topic && s.module !== f.topic) return false;
  if (f.time) {
    const secs = ownKey(LABEL_SECONDS, s.minutes) ? LABEL_SECONDS[s.minutes] : null;
    const upTo = TIMES.find((t) => t.id === f.time)?.upTo;
    if (upTo === undefined ? secs !== null : secs === null || secs > upTo) return false;
  }
  const hay = fold(`${s.sl} ${s.real}`);
  return fold(f.q)
    .split(' ')
    .every((w) => hay.includes(w));
}

/** The nearest box that scrolls the page. */
const scrollerOf = (el: HTMLElement) => {
  for (let e = el.parentElement; e; e = e.parentElement) if (/auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight) return e;
  return document.scrollingElement as HTMLElement | null;
};

export function libraryScreen(app: App): ScreenOut {
  const st = app.store;
  const C = LIBRARY_COPY;
  const tag = Math.random().toString(36).slice(2, 7);
  const search = h('input', { id: `lib-q-${tag}`, class: 'dq-input dq-libf-in', type: 'search', placeholder: C.searchHint, maxlength: 60, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  search.value = finding.q;
  search.addEventListener('input', () => {
    finding.q = search.value;
    render();
  });
  const picks: Record<'need' | 'topic' | 'time', HTMLSelectElement> = {} as Record<'need' | 'topic' | 'time', HTMLSelectElement>;
  const pick = (key: 'need' | 'topic' | 'time', label: string, all: string, opts: { id: string; label: string }[]) => {
    const id = `lib-${key}-${tag}`;
    const sel = h('select', { id, class: 'dq-input dq-select dq-libf-in' }, h('option', { value: '', text: all }), opts.map((o) => h('option', { value: o.id, text: o.label })));
    sel.value = opts.some((o) => o.id === finding[key]) ? finding[key] : '';
    finding[key] = sel.value;
    sel.addEventListener('change', () => {
      finding[key] = sel.value;
      render();
    });
    picks[key] = sel;
    return h('div', { class: 'dq-libf' }, h('label', { for: id, class: 'dq-libf-l', text: label }), sel);
  };
  const count = h('p', { class: 'dq-libcount', role: 'status' });
  const clearAll = () => {
    Object.assign(finding, { q: '', need: '', topic: '', time: '' });
    search.value = '';
    for (const sel of Object.values(picks)) sel.value = '';
    render();
    search.focus();
  };
  const showAll = btn(C.showAll, clearAll, { kind: 'link', cls: 'dq-libreset' });
  const results = h('div', { class: 'dq-libresults' });

  const row = (s: Skill) => {
    const on = st.pinned(s.id);
    return h(
      'li',
      { class: 'dq-libitem', 'data-skill': s.id },
      h('button', { type: 'button', class: 'dq-librow', 'data-spot': `row ${s.id}`, onclick: () => app.go({ name: 'skill', id: s.id }) }, h('span', { class: 'dq-librow-n', text: typo(s.sl) }), h('span', { class: 'dq-librow-r', text: typo(s.real) }), h('span', { class: 'dq-librow-m', text: s.minutes }), h('span', { class: 'dq-librow-c', html: icon('chev') })),
      h('button', { type: 'button', class: 'dq-libpin', 'data-spot': `pin ${s.id}`, 'aria-pressed': String(on), 'aria-label': C.pin(typo(s.sl), typo(s.real)), html: icon('star'), onclick: (e: Event) => pin(s.id, !on, e.currentTarget as HTMLElement) }),
    );
  };
  const section = (cls: string, ic: string, title: string, sub: string, ids: string[]) =>
    ids.length ? h('section', { class: `dq-libsec ${cls}` }, h('h2', { class: 'dq-libsec-h' }, h('span', { class: 'dq-libsec-ic', html: ic }), h('span', { text: title }), h('span', { class: 'dq-libsec-s', text: sub })), h('ul', { class: 'dq-liblist' }, ids.map((id) => row(SKILL[id])))) : null;
  const clear = () => {
    const b = btn(C.clear, clearAll, { kind: 'quiet' });
    b.dataset.spot = 'clear';
    return b;
  };
  const pinsNow = () => CATALOGUE.filter((id) => st.pinned(id)).join(' ');
  let pinsShown = '';

  /**
   * Draws the list for what is chosen. Every control in it has a spot (a skill's row or pin, or Clear filters), and
   * whatever redraws the list (a pin here or in another open copy), the control in the same spot keeps focus and stays
   * where it was on screen, even when its row moves.
   */
  function render(keep?: { spot: string; top: number }) {
    const at = document.activeElement instanceof HTMLElement && results.contains(document.activeElement) ? document.activeElement : null;
    if (!keep && at?.dataset.spot) keep = { spot: at.dataset.spot, top: at.getBoundingClientRect().top };
    const shown = new Set(SKILLS.filter((s) => fits(s, finding)).map((s) => s.id));
    const free = (id: string) => shown.has(id) && !st.pinned(id);
    pinsShown = pinsNow();
    results.replaceChildren(
      ...[
        section('dq-libsec--fav', icon('star'), C.favourites, C.favouritesSub, CATALOGUE.filter((id) => shown.has(id) && st.pinned(id))),
        section('dq-libsec--loadout', icon('comfort'), LOADOUT_COPY.title, LOADOUT_COPY.sub, LOADOUT.filter(free)),
        ...MODULE_ORDER.map((mid) => section(`dq-mod-${mid}`, glyph(mid), MODULES[mid].name, MODULES[mid].statName, CATALOGUE.filter((id) => SKILL[id].module === mid && !SKILL[id].loadout && free(id)))),
        shown.size ? null : h('div', { class: 'dq-libempty' }, h('p', { class: 'dq-libempty-t', text: C.empty }), p(C.emptySub, 'dq-small'), clear()),
      ].filter((x): x is HTMLElement => !!x),
    );
    // the count and Show all skills follow what shows: a search every skill fits still shows all of them
    const every = shown.size === SKILLS.length;
    const said = every ? C.all(SKILLS.length) : C.some(shown.size, SKILLS.length);
    if (count.textContent !== said) count.textContent = said;
    showAll.classList.toggle('is-hidden', every);
    if (!keep) return;
    const to = results.querySelector<HTMLElement>(`[data-spot="${keep.spot}"]`);
    if (!to) return;
    to.focus({ preventScroll: true });
    const box = scrollerOf(to);
    if (box) box.scrollTop += to.getBoundingClientRect().top - keep.top;
  }
  let pinning = false;
  const pin = (id: string, on: boolean, from: HTMLElement) => {
    const top = from.getBoundingClientRect().top;
    pinning = true;
    try {
      st.pinSkill(id, on);
    } finally {
      pinning = false;
    }
    render({ spot: `pin ${id}`, top });
  };
  const off = st.onChange(() => {
    if (!pinning && pinsNow() !== pinsShown) render();
  });

  const el = h(
    'div',
    { class: 'dq-page dq-library' },
    pageHead(C.title, C.sub),
    h(
      'div',
      { class: 'dq-libfind', role: 'search', 'aria-label': C.find },
      h('div', { class: 'dq-libf' }, h('label', { for: search.id, class: 'dq-libf-l', text: C.search }), search),
      pick('need', C.need, C.needAll, NEEDS),
      pick('topic', C.topic, C.topicAll, TOPICS),
      pick('time', C.time, C.timeAll, TIMES),
    ),
    h('div', { class: 'dq-libbar' }, count, showAll),
    results,
  );
  render();
  return { el, title: C.title, mode: 'sub', leave: () => off() };
}

// ---------------- Diary card ----------------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayParts = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { dow: DOW[dt.getUTCDay()], d, mon: MON[m - 1], y };
};
const dayLabel = (day: string) => {
  const p = dayParts(day);
  return `${p.dow} ${p.d} ${p.mon}`;
};

const rowsFor = (s: State, kind: 'emotions' | 'urges', days: string[]) => {
  const out = [...(kind === 'emotions' ? s.settings.emotionRows : s.settings.urgeRows)];
  for (const d of days) for (const [k, v] of Object.entries(s.diary[d]?.[kind] ?? {})) if (v !== null && !out.includes(k)) out.push(k);
  return out;
};
const NOT_SAVING = "Kept for this visit. This device isn't saving right now.";

/** Plain-text diary card, laid out like the UW DBT diary card, trimmed to what the player enters. */
export function diaryText(st: Store, days: number) {
  const today = st.today();
  const range = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  const s = st.state;
  const rowsE = rowsFor(s, 'emotions', range), rowsU = rowsFor(s, 'urges', range);
  const pad = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}.` : t.padEnd(n));
  const out: string[] = [];
  const a = dayParts(range[0]), b = dayParts(range[range.length - 1]);
  out.push(`DBT Diary Card    ${a.d} ${a.mon} ${a.y} to ${b.d} ${b.mon} ${b.y}`);
  out.push('(made on my phone, kept on my phone)', '');
  for (let w = 0; w < range.length; w += 7) {
    const wk = range.slice(w, w + 7);
    const W = 30;
    out.push(pad('', W) + wk.map((d) => dayParts(d).dow.padStart(4)).join(''));
    out.push(pad('', W) + wk.map((d) => String(dayParts(d).d).padStart(4)).join(''));
    const val = (d: string, k: string, kind: 'emotions' | 'urges') => {
      const e = s.diary[d];
      const v = e?.[kind][k];
      return (v === undefined || v === null ? '-' : String(v)).padStart(4);
    };
    for (const r of rowsE) out.push(pad(r, W) + wk.map((d) => val(d, r, 'emotions')).join(''));
    for (const r of rowsU) out.push(pad(r, W) + wk.map((d) => val(d, r, 'urges')).join(''));
    const codes = wk.map((d) => st.skillCodes(d));
    const used = new Set(codes.flatMap((c) => Object.keys(c).filter(isSkillId)));
    if (used.size) {
      out.push('', 'Skills (use code 0-7)');
      for (const id of used) out.push(pad(SKILL[id].real, W) + codes.map((c) => (c[id] === undefined ? '.' : c[id] === 'p' ? '*' : String(c[id])).padStart(4)).join(''));
    }
    out.push('');
  }
  const notes = range.filter((d) => s.diary[d]?.note);
  if (notes.length) {
    out.push('Notes');
    for (const d of notes) out.push(`${dayLabel(d)}: ${s.diary[d].note}`);
    out.push('');
  }
  out.push('Ratings 0-5. "-" = no entry. Skill use codes: 0 not thought about or used, 1 thought about, not used,');
  out.push("didn't want to, 2 thought about, not used, wanted to, 3 tried but couldn't use them, 4 tried, could do");
  out.push("them but they didn't help, 5 tried, could use them, helped, 6 didn't try, used them, didn't help,");
  out.push("7 didn't try, used them, helped. * practised, not rated.");
  return out.join('\n');
}


export function diaryScreen(app: App, _route: Route, visit: Visit): ScreenOut {
  const st = app.store;
  const today = st.today();
  const s = st.state;
  // how far back Earlier day goes: a week, or to the day the save or its diary began if that is earlier
  const earliest = () => [addDays(today, -6), dayKey(s.created), ...Object.keys(s.diary)].reduce((a, b) => (b < a ? b : a));
  let day = visit.again && typeof visit.kept === 'string' && visit.kept < today && visit.kept >= earliest() ? visit.kept : today;
  const draftOf = (d: string) => {
    const e = s.diary[d];
    return { emotions: { ...e?.emotions }, urges: { ...e?.urges }, note: e?.note ?? '' };
  };
  let draft = draftOf(day);
  type Kind = 'emotions' | 'urges';
  const rowsShown = new Map<string, { kind: Kind; name: string; el: HTMLElement; mount: () => void; busy: () => boolean }>();
  // an earlier day keeps the rows it was rated on while it is open, beside today's rows to fill in
  const dayRows = { emotions: new Set<string>(), urges: new Set<string>() };
  const touched = new Map<string, { kind: Kind; name: string }>();
  let noteTouched = false;
  const rowEl = (name: string, kind: Kind) => {
    const key = `${kind}:${name}`;
    const row = h('div', { class: 'dq-drow' }, h('span', { class: 'dq-drow-t', text: name }));
    let seg: HTMLElement | null = null;
    const mount = () => {
      const next = segmented(name, [0, 1, 2, 3, 4, 5], draft[kind][name] ?? null, (v) => {
        draft[kind][name] = typeof v === 'number' ? v : null;
        touched.set(key, { kind, name });
        touch();
      }, { allowClear: true, cls: 'dq-seg--6' });
      if (seg) seg.replaceWith(next);
      else row.append(next);
      seg = next;
    };
    mount();
    rowsShown.set(key, { kind, name, el: row, mount, busy: () => !!seg?.contains(document.activeElement) });
    return row;
  };
  const ROWS = { emotions: 'emotionRows', urges: 'urgeRows' } as const;
  const heads = { emotions: h('h3', { class: 'dq-label', text: 'Feelings, 0 to 5' }), urges: h('h3', { class: 'dq-label', text: 'Urges, 0 to 5' }) };
  const boxes = { emotions: h('div', { class: 'dq-drows' }), urges: h('div', { class: 'dq-drows' }) };
  const rowNames = (kind: Kind) => {
    const names = s.settings[ROWS[kind]];
    if (day === today) return names;
    for (const r of rowsFor(s, kind, [day])) if (!names.includes(r)) dayRows[kind].add(r);
    return [...names, ...[...dayRows[kind]].filter((r) => !names.includes(r))];
  };
  const renderRows = () => {
    for (const kind of ['emotions', 'urges'] as const) {
      const names = rowNames(kind);
      for (const [key, r] of rowsShown) if (r.kind === kind && !names.includes(r.name)) rowsShown.delete(key);
      place(boxes[kind], names.map((n) => rowsShown.get(`${kind}:${n}`)?.el ?? rowEl(n, kind)), () => (kind === 'emotions' ? boxes.urges.querySelector('button') : null) ?? note.input);
      heads[kind].classList.toggle('is-hidden', !names.length);
      boxes[kind].classList.toggle('is-hidden', !names.length);
    }
  };
  renderRows();
  const writeTouched = () => {
    st.sync();
    const cur = s.diary[day];
    const known = fieldTimes(cur);
    const at = Math.max(st.now(), Math.max(cur?.updatedAt ?? -Infinity, ...Object.values(known)) + 1);
    // what a newer build stored on the day and its field times stays as it was; only the fields edited here change
    const ft = { ...cur?.ft, ...known };
    const e: DiaryEntry = { ...cur, day, emotions: { ...cur?.emotions }, urges: { ...cur?.urges }, note: cur?.note ?? '', updatedAt: cur?.updatedAt ?? 0, ft };
    for (const { kind, name } of touched.values()) {
      e[kind][name] = draft[kind][name] ?? null;
      ft[fieldKey(kind, name)] = at;
    }
    if (noteTouched) {
      e.note = draft.note.trim().slice(0, 300);
      ft.note = at;
    }
    if (!cur || touched.size || noteTouched) e.updatedAt = Math.max(e.updatedAt, at);
    s.diary[day] = e;
  };
  const written = () => {
    if (!st.saving) return;
    touched.clear();
    noteTouched = false;
  };
  let dirty = false;
  let timer = 0;
  const keep = () => {
    window.clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    writeTouched();
    st.save();
    written();
    if (!st.saving) saved.textContent = NOT_SAVING;
    else if (!saved.textContent || saved.textContent === NOT_SAVING) saved.textContent = 'Kept on this device as you go.';
  };
  const touch = () => {
    dirty = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(keep, 500);
  };
  const onHide = () => document.visibilityState === 'hidden' && keep();
  document.addEventListener('visibilitychange', onHide);
  const skillsHead = h('h3', { class: 'dq-label' });
  // a skill practised in another open copy shows up here too; an earlier day without one shows nothing
  const usedOn = redrawn(() => {
    const codes = st.skillCodes(day);
    const used = Object.keys(codes).filter(isSkillId);
    skillsHead.textContent = day === today ? 'Skills today' : 'Skills that day';
    skillsHead.classList.toggle('is-hidden', !used.length && day !== today);
    return used.length
      ? h('ul', { class: 'dq-skillsused' }, used.map((id) => h('li', {}, h('span', { text: typo(`${SKILL[id].sl} (${SKILL[id].real})`) }), h('span', { class: 'dq-code', text: codes[id] === 5 ? 'helped' : codes[id] === 4 ? "didn't help this time" : 'practised' }))))
      : day === today ? p('None yet today. That is fine.', 'dq-small') : null;
  }, () => null);
  const notePrompt = () => (day === today ? 'A note for today (optional)' : 'A note for this day (optional)');
  const note = field('One line, optional', { value: draft.note, placeholder: notePrompt(), max: 300, oninput: (v) => {
    draft.note = v;
    noteTouched = true;
    touch();
  } });
  const saved = h('p', { class: 'dq-hint', 'aria-live': 'polite' });
  const save = () => {
    window.clearTimeout(timer);
    dirty = false;
    writeTouched();
    // the diary's XP is for today's card, once a day: an earlier day's card saves without it
    const first = day === today && !s.events.some((e) => e.k === 'diary' && e.day === today);
    if (first) st.add('diary', 10);
    else st.save();
    written();
    app.sound('check');
    if (day !== today) saved.textContent = st.saving ? `Saved to ${dayLabel(day)} on this device.` : NOT_SAVING;
    else saved.textContent = st.saving ? (first ? 'Saved on this device. +10 XP' : 'Updated on this device.') : `${NOT_SAVING}${first ? ' +10 XP' : ''}`;
    // Save tapped at the bottom of the screen brings the line under it into sight
    saved.scrollIntoView({ block: 'nearest', behavior: app.reduced() ? 'auto' : 'smooth' });
  };
  const week = h('div', { class: 'dq-week' });
  const renderWeek = () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const rows = [...rowsFor(s, 'emotions', days).map((r) => [r, 'emotions'] as const), ...rowsFor(s, 'urges', days).map((r) => [r, 'urges'] as const)];
    week.replaceChildren(
      h(
        'table',
        { class: 'dq-table' },
        h('caption', { class: 'dq-sr', text: 'Past seven days, only what you entered' }),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '' }), days.map((d) => h('th', { scope: 'col' }, h('span', { text: dayParts(d).dow }), h('span', { class: 'dq-table-d', text: String(dayParts(d).d) }))))),
        h(
          'tbody',
          {},
          rows.map(([r, kind]) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row', text: r }),
              days.map((d) => {
                const v = s.diary[d]?.[kind][r];
                return h('td', { text: v === undefined || v === null ? '·' : String(v) });
              }),
            ),
          ),
        ),
      ),
    );
  };
  renderWeek();
  // export
  let range = 7;
  const pre = h('pre', { class: 'dq-pre' });
  const status = h('span', { class: 'dq-hint', 'aria-live': 'polite' });
  const refresh = () => {
    keep();
    return (pre.textContent = diaryText(st, range));
  };
  refresh();
  const exportPanel = panel(
    { title: 'Export', ic: icon('export'), cls: 'dq-export' },
    p(`${mayMentionTherapist() ? 'For your therapist, if you want. ' : ''}Plain text, and it only leaves this device if you send it.`, 'dq-text'),
    h('div', { class: 'dq-pace' }, h('span', { class: 'dq-label', text: 'Range' }), segmented('Range', [7, 14, 30], 7, (v) => {
      range = Number(v ?? 7);
      refresh();
    }, { labels: ['7 days', '14 days', '30 days'], cls: 'dq-seg--range' })),
    h('details', { class: 'dq-details', ontoggle: refresh }, h('summary', { text: 'Preview' }), pre),
    h(
      'div',
      { class: 'dq-actions' },
      btn('Copy text', async () => (status.textContent = (await copyText(refresh())) ? 'Copied.' : 'Open the preview and select the text.'), { kind: 'quiet', ic: 'copy' }),
      btn('Share or save', async () => {
        const r = await shareOrSave(refresh(), `diary-card-${today}.txt`, 'text/plain');
        status.textContent = r === 'saved' ? 'Saved as a text file.' : r === 'shared' ? 'Shared.' : '';
      }, { kind: 'quiet', ic: 'export' }),
      status,
    ),
  );
  // rows editor
  const rowsGroup = (kind: Kind, label: string) => {
    const cap = ROW_CAP[kind];
    const f = field(`Add a row to ${label}`, { placeholder: 'Row name', hideLabel: true, max: 60 });
    const full = p(`The card holds ${cap} rows here. Remove one to add another.`, 'dq-small is-hidden');
    const items = h('ul', { class: 'dq-items' });
    const shown = new Map<string, HTMLElement>();
    const item = (r: string) => h('li', { class: 'dq-item' }, h('span', { text: r }), h('button', { type: 'button', class: 'dq-icbtn dq-icbtn--sm', 'aria-label': `Remove ${r}`, html: icon('close'), onclick: () => remove(r) }));
    const render = () => {
      const list = s.settings[ROWS[kind]];
      for (const r of [...shown.keys()]) if (!list.includes(r)) shown.delete(r);
      for (const r of list) if (!shown.has(r)) shown.set(r, item(r));
      place(items, list.map((r) => shown.get(r)!), () => f.input);
      if (list.length < cap) full.classList.add('is-hidden');
    };
    const remove = (r: string) => {
      st.sync();
      const list = s.settings[ROWS[kind]];
      const j = list.indexOf(r);
      if (j >= 0) list.splice(j, 1);
      st.touch(ROWS[kind]);
      st.save();
      const left = items.querySelectorAll<HTMLElement>('button');
      (left[Math.min(Math.max(j, 0), left.length - 1)] ?? f.input).focus();
    };
    const add = () => {
      st.sync();
      const list = s.settings[ROWS[kind]];
      const v = f.input.value.trim();
      if (!v || list.includes(v)) return f.input.focus();
      if (list.length >= cap) return full.classList.remove('is-hidden');
      list.push(v);
      st.touch(ROWS[kind]);
      st.save();
      f.input.value = '';
      f.input.focus();
    };
    render();
    return { render, el: h('div', { class: 'dq-rowsed-g' }, h('h3', { class: 'dq-label', text: label }), items, h('div', { class: 'dq-addrow' }, f.el, btn('Add', add, { kind: 'quiet', ic: 'plus' })), full) };
  };
  const groups = [rowsGroup('emotions', 'Feelings'), rowsGroup('urges', 'Urges')];
  const rowsEditor = h('div', { class: 'dq-rowsed is-hidden' }, p('Rename by removing and adding. Use private words if you like. Past entries keep their rows.', 'dq-small'), groups.map((g) => g.el));
  const earlier = btn('Earlier day', () => openDay(addDays(day, -1)), { kind: 'link', ic: 'back' });
  const later = btn('Later day', () => openDay(addDays(day, 1)), { kind: 'link', ic: 'chev', cls: 'dq-btn--icend' });
  const toToday = btn('Today', () => openDay(today), { kind: 'link' });
  const pastNote = p('An earlier day. Anything you add or change here stays with this day.', 'dq-small dq-daynote');
  const card = panel(
    { title: dayLabel(day), ic: icon('diary'), cls: 'dq-today' },
    h('div', { class: 'dq-actions dq-daynav' }, earlier, later, toToday),
    pastNote,
    heads.emotions,
    boxes.emotions,
    heads.urges,
    boxes.urges,
    skillsHead,
    usedOn.node,
    note.el,
    h('div', { class: 'dq-actions' }, btn('Save', save, { kind: 'primary' }), btn('Edit rows', () => rowsEditor.classList.toggle('is-hidden'), { kind: 'link' }), saved),
    rowsEditor,
  );
  const title = card.querySelector<HTMLElement>('.dq-chip-t')!;
  title.setAttribute('aria-live', 'polite');
  const showDay = () => {
    const was = document.activeElement;
    earlier.classList.toggle('is-hidden', day <= earliest());
    for (const e of [later, toToday, pastNote]) e.classList.toggle('is-hidden', day === today);
    // focus on a button the new day hides moves to the one beside it
    if (was instanceof HTMLElement && was.classList.contains('is-hidden')) (earlier.classList.contains('is-hidden') ? later : earlier).focus({ preventScroll: true });
  };
  showDay();
  const openDay = (d: string) => {
    keep();
    touched.clear();
    noteTouched = false;
    day = d;
    draft = draftOf(d);
    rowsShown.clear();
    dayRows.emotions.clear();
    dayRows.urges.clear();
    renderRows();
    note.input.value = draft.note;
    note.input.placeholder = typo(notePrompt());
    title.textContent = dayLabel(d);
    saved.textContent = '';
    usedOn.update();
    showDay();
  };
  const el = h(
    'div',
    { class: 'dq-page dq-diary' },
    pageHead('Diary card', 'Optional, and under a minute. Blank is fine: blank and 0 mean different things.'),
    h(
      'div',
      { class: 'dq-diary-grid' },
      card,
      h('div', { class: 'dq-diary-side' }, panel({ title: 'Past 7 days', ic: icon('diary'), cls: 'dq-weekp' }, p('Only what you entered. No averages, no trends.', 'dq-small'), week), exportPanel),
    ),
  );
  const off = st.onChange(() => {
    renderRows();
    groups.forEach((g) => g.render());
    showDay();
    const cur = s.diary[day];
    for (const [key, r] of rowsShown) {
      if (touched.has(key) || r.busy()) continue;
      const v = cur?.[r.kind][r.name] ?? null;
      if ((draft[r.kind][r.name] ?? null) === v) continue;
      draft[r.kind][r.name] = v;
      r.mount();
    }
    if (!noteTouched && document.activeElement !== note.input && draft.note !== (cur?.note ?? '')) {
      draft.note = cur?.note ?? '';
      note.input.value = draft.note;
    }
    renderWeek();
    usedOn.update();
    refresh();
  });
  return {
    el,
    title: 'Diary card',
    mode: 'sub',
    keep: () => day,
    leave: () => {
      keep();
      off();
      document.removeEventListener('visibilitychange', onHide);
    },
  };
}

// ---------------- Comfort inventory ----------------
export function comfortScreen(app: App): ScreenOut {
  const st = app.store;
  const s = st.state;
  const rerender = () => app.go({ name: 'comfort' }, { replace: true, quiet: true });
  const removed = (text: string, restore: () => void) =>
    app.toast(`Removed "${text.length > 36 ? `${text.slice(0, 35)}…` : text}".`, {
      label: 'Undo',
      run: () => {
        restore();
        st.save();
        if (app.route.name === 'comfort') rerender();
      },
    });
  // what the lists show follows another open copy's changes in place, so what is being typed here stays; focus on
  // something removed goes to the Add button below it
  const parts: ReturnType<typeof redrawn>[] = [];
  const listPanel = (key: 'comfort' | 'activities' | 'reasons', title: string, hint: string, ph: string, ic: string) => {
    const items = s.lists[key];
    const f = field(`Add to ${title}`, { placeholder: ph, hideLabel: true, max: 200 });
    const add = () => {
      const v = f.input.value.trim();
      if (!v) return f.input.focus();
      items.push({ id: uid(), text: v, at: st.now() });
      st.save();
      app.sound('bubble');
      rerender();
    };
    f.input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && add());
    const addBtn = btn('Add', add, { kind: 'quiet', ic: 'plus' });
    const list = redrawn(() =>
      items.length
        ? h('ul', { class: 'dq-items' }, items.map((it) => h('li', { class: 'dq-item', 'data-item': it.id }, h('span', { text: typo(it.text) }), h('button', { type: 'button', class: 'dq-icbtn dq-icbtn--sm', 'aria-label': `Remove ${it.text}`, html: icon('close'), onclick: () => {
            const out = st.removeItem(items, it.id);
            st.save();
            rerender();
            if (out) removed(out.item.text, () => st.reviveItem(app.store.state.lists[key], out.item, out.index));
          } }))))
        : null,
    () => addBtn);
    parts.push(list);
    return panel(
      { title, ic: icon(ic), cls: `dq-listp dq-listp--${key}` },
      p(hint, 'dq-small'),
      list.node,
      h('div', { class: 'dq-addrow' }, f.el, addBtn),
    );
  };
  const people = s.lists.people;
  const pn = field('Name', { placeholder: 'Name' });
  const pp = field('Number', { placeholder: 'Phone number', type: 'tel', inputmode: 'tel' });
  const addPerson = btn('Add person', () => {
    const name = pn.input.value.trim();
    if (!name) return pn.input.focus();
    people.push({ id: uid(), name: name.slice(0, 80), phone: pp.input.value.trim().slice(0, 40), at: st.now() });
    st.save();
    rerender();
  }, { kind: 'quiet', ic: 'plus' });
  const peopleList = redrawn(() =>
    people.length
      ? h('ul', { class: 'dq-items' }, people.map((x) => h('li', { class: 'dq-item dq-item--person', 'data-item': x.id }, h('span', { class: 'dq-person-n', text: x.name }), x.phone ? h('span', { class: 'dq-person-acts' }, h('a', { class: 'dq-btn dq-btn--quiet dq-btn--sm', href: telHref(x.phone), html: `<span class="dq-btn-ic">${icon('phone')}</span><span>Call</span>` }), h('a', { class: 'dq-btn dq-btn--quiet dq-btn--sm', href: smsHref(x.phone.replace(/[^\d+]/g, '')), html: `<span class="dq-btn-ic">${icon('text')}</span><span>Text</span>` })) : null, h('button', { type: 'button', class: 'dq-icbtn dq-icbtn--sm', 'aria-label': `Remove ${x.name}`, html: icon('close'), onclick: () => {
          const out = st.removeItem(people, x.id);
          st.save();
          rerender();
          if (out) removed(out.item.name, () => st.reviveItem(app.store.state.lists.people, out.item, out.index));
        } }))))
      : null,
  () => addPerson);
  parts.push(peopleList);
  const peoplePanel = panel(
    { title: 'People', ic: icon('phone'), cls: 'dq-listp' },
    p('People you could call or text. A professional too, if you have one. Added only by you.', 'dq-small'),
    peopleList.node,
    h('div', { class: 'dq-person-add' }, pn.el, pp.el, h('div', { class: 'dq-actions' }, addPerson)),
  );
  const maps = s.maps;
  const mapsPanel = redrawn(() => maps.length
    ? panel(
        { title: 'Strategy maps', ic: icon('card'), cls: 'dq-listp' },
        p('Maps you saved in Pros and Cons. Reread one when that urge shows up.', 'dq-small'),
        h(
          'ul',
          { class: 'dq-items' },
          maps
            .slice()
            .reverse()
            .map((m) =>
              h(
                'li',
                { class: 'dq-item dq-item--map', 'data-item': m.id },
                h(
                  'details',
                  { class: 'dq-details' },
                  h('summary', { text: typo(m.urge || 'An urge (unnamed)') }),
                  h('div', { class: 'dq-map' }, [['Act on it: good now', m.p1], ['Act on it: costs later', m.c1], ['Ride it out: good later', m.p2], ['Ride it out: hard part', m.c2]].map(([k, v]) => h('div', { class: 'dq-map-c' }, h('span', { class: 'dq-map-k', text: k }), h('span', { class: 'dq-map-v', text: typo(v || '–') })))),
                ),
              ),
            ),
        ),
      )
    : null,
  () => null);
  parts.push(mapsPanel);
  const lists = supportListsCopy(app);
  const el = h(
    'div',
    { class: 'dq-page dq-comfort' },
    pageHead('Comfort', 'Your own lists. They show up in the Safe Zone and in skills, right when you need them.'),
    h('div', { class: 'dq-lists-row' }, lists.open, lists.box),
    h(
      'div',
      { class: 'dq-comfort-grid' },
      listPanel('comfort', 'Comfort kit', 'Things that help, even a little.', 'Something that helps', 'comfort'),
      listPanel('activities', 'Go-to activities', 'Absorbing things for Trade Places: games, shows, songs, foods.', 'A game, a show, a song', 'shadows'),
      listPanel('reasons', 'Things that are yours', 'Things you like, want to see, want to do, want to try.', 'Something you like', 'rest'),
      peoplePanel,
      mapsPanel.node,
    ),
  );
  const off = st.onChange(() => parts.forEach((x) => x.update()));
  return {
    el,
    title: 'Comfort',
    mode: 'sub',
    leave: () => {
      lists.dispose();
      off();
    },
  };
}

// ---------------- Settings ----------------
const longDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
function browserKeeps() {
  const say = h('p', { class: 'dq-small dq-keep-s', 'aria-live': 'polite' });
  const ask = btn(KEEP_COPY.ask, () => request(), { kind: 'quiet', cls: 'dq-keep-ask' });
  const askT = ask.querySelector('.dq-btn-t')!;
  const el = h('div', { class: 'dq-keep' }, say, h('div', { class: 'dq-actions' }, ask));
  const copy: Record<KeepStatus | 'checking', string> = {
    checking: KEEP_COPY.checking,
    granted: KEEP_COPY.granted,
    'not-granted': KEEP_COPY.notGranted,
    refused: KEEP_COPY.refused,
    unsupported: KEEP_COPY.unsupported,
    failed: KEEP_COPY.failed,
  };
  let mod: typeof import('../pwa/register') | null = null;
  let seq = 0;
  let gone = false;
  let refused = false;
  let off = () => {};
  const show = (s: KeepStatus | 'checking') => {
    if (s === 'refused') refused = true;
    else if (s === 'granted') refused = false;
    const shown = s === 'not-granted' && refused ? 'refused' : s;
    el.dataset.keep = shown;
    say.innerHTML = md(copy[shown]);
    ask.classList.toggle('is-hidden', s === 'checking' || s === 'granted' || !mod?.canAskToKeep());
    ask.disabled = false;
    ask.removeAttribute('aria-busy');
    askT.textContent = typo(KEEP_COPY.ask);
  };
  const wait = async (job: Promise<KeepStatus>) => {
    const n = ++seq;
    ask.classList.remove('is-hidden');
    ask.disabled = true;
    ask.setAttribute('aria-busy', 'true');
    askT.textContent = typo(KEEP_COPY.asking);
    const s = await job;
    if (!gone && n === seq) show(s);
  };
  const request = () => {
    if (mod && !ask.disabled) mod.askToKeep();
  };
  const check = async (): Promise<void> => {
    if (gone || !mod) return;
    const job = mod.keepRequest();
    if (job) return void job.then(check);
    const n = ++seq;
    const s = await mod.readKeepStatus();
    if (!gone && n === seq) show(s);
  };
  const onBack = (e: Event) => {
    if (e.type === 'pageshow' ? !(e as PageTransitionEvent).persisted : document.visibilityState !== 'visible') return;
    void check();
  };
  show('checking');
  void import('../pwa/register').then(
    (m) => {
      if (gone) return;
      mod = m;
      off = m.onKeepRequest((job) => void wait(job));
      const job = m.keepRequest();
      void (job ? wait(job) : check());
    },
    () => !gone && show('failed'),
  );
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('pageshow', onBack);
  const stop = () => {
    gone = true;
    off();
    document.removeEventListener('visibilitychange', onBack);
    window.removeEventListener('pageshow', onBack);
  };
  return { el, stop };
}

/**
 * Settings once this game's data is being cleared, here or in another tab: how it is going, then a way to start again.
 * Every screen but the Safe Zone shows this (see App.go), and the Safe Zone stays one tap away in the top bar.
 */
function clearedScreen(): ScreenOut {
  const head = h('h1', { class: 'dq-h1 dq-cleared-h', 'data-focus': '' });
  const text = h('p', { class: 'dq-text', 'aria-live': 'polite' });
  const note = p(CLEAR_COPY.againNote, 'dq-small');
  const actions = h('div', { class: 'dq-actions' });
  const el = h('div', { class: 'dq-page dq-cleared' }, h('section', { class: 'dq-cleared-card', 'aria-labelledby': 'dq-cleared-h' }, head, text, actions, note));
  head.id = 'dq-cleared-h';
  const lines: Record<ReturnType<typeof clearStatus>, string> = {
    clearing: CLEAR_COPY.clearing,
    waiting: CLEAR_COPY.waiting,
    done: CLEAR_COPY.done,
    failed: CLEAR_COPY.failed,
    elsewhere: CLEAR_COPY.elsewhere,
    'elsewhere-done': CLEAR_COPY.elsewhereDone,
    'elsewhere-failed': CLEAR_COPY.failed,
  };
  const render = () => {
    const now = clearStatus();
    const done = now === 'done' || now === 'elsewhere-done';
    const failed = now === 'failed' || now === 'elsewhere-failed';
    head.textContent = typo(done ? CLEAR_COPY.doneTitle : failed ? CLEAR_COPY.failedTitle : CLEAR_COPY.clearingTitle);
    // the line is a live region: nothing around it is marked busy, so each change is read out as it comes
    text.textContent = typo(lines[now]);
    note.classList.toggle('is-hidden', !done);
    actions.classList.toggle('is-hidden', !done && !failed);
    const lost = actions.contains(document.activeElement);
    actions.replaceChildren(
      ...(done ? [btn(CLEAR_COPY.again, () => location.assign(siteUrl('')), { kind: 'primary' })] : failed ? [btn(CLEAR_COPY.retry, () => void clearGame(), { kind: 'primary' })] : []),
    );
    if (lost) (actions.querySelector('button') ?? head).focus({ preventScroll: true });
  };
  render();
  return { el, title: 'Cleared', mode: 'hub', leave: onClearStatus(render) };
}

/** The intro's welcome note and what came with it, the same for a player who skipped the intro as for one who watched.
 *  The intro's copy has its names filled in. */
function welcomeNote(app: App) {
  const note = [LETTER.greeting, ...LETTER.paragraphs(mayMentionTherapist())].map((l) => `<p>${quotes(l)}</p>`).join('');
  const gifts = REWARDS.filter((r) => r.id !== 'letter').map((r) => `<p class="sys"><b>${r.name}.</b> ${quotes(r.desc)}</p>`).join('');
  return app.window({ kind: 'notification', title: LETTER.title, html: `${note}<p class="sys">${LETTER.signoff}</p>${gifts}`, tapToContinue: true }, true);
}

export function settingsScreen(app: App): ScreenOut {
  if (cleared()) return clearedScreen();
  const st = app.store;
  const s = st.state;
  const status = h('p', { class: 'dq-hint', 'aria-live': 'polite' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'dq-sr', 'aria-hidden': 'true', tabindex: -1 });
  const notSaving = p("This device isn't saving right now (storage may be full or private browsing). Your progress is safe for this visit; a Save Crystal keeps a copy.", `dq-small${st.saving ? ' is-hidden' : ''}`);
  const keeps = browserKeeps();
  const restoreBtn = btn('Restore', () => file.click(), { kind: 'quiet', ic: 'import' });
  /** Each choice as it is now: brought back by a Save Crystal, or made in another open copy. */
  const showChoices = () => {
    app.root.querySelectorAll('.dq-settings [aria-label="Motion"] [role="radio"]').forEach((b, i) => b.setAttribute('aria-checked', String(['system', 'reduce', 'full'][i] === s.settings.motion)));
    // the group moves its Tab stop to the Text size shown
    const size = textSize(app);
    app.root.querySelectorAll('.dq-settings [aria-label="Text size"] [role="radio"]').forEach((b, i) => b.setAttribute('aria-checked', String(READ_SIZES[i] === size)));
    if (!app.opts.volume) {
      const sound = app.root.querySelector<HTMLInputElement>('.dq-settings input[role="switch"]');
      if (sound) sound.checked = s.settings.sound;
    }
    if (buzzIn) buzzIn.checked = s.settings.vibrate;
  };
  const restore = async ({ raw, data, incomplete: fileIncomplete }: Peek) => {
    const merged = st.merge(data);
    const draftsSaved = restoreSkillDrafts(st.key, raw.skillDrafts);
    const saving = merged.saving && draftsSaved;
    const choicesSaved = restorePreferences((raw as { preferences?: unknown }).preferences, st, app.opts.volume);
    const unreadBack = restoreUnread((raw as { unreadSaves?: unknown }).unreadSaves, st);
    app.applyMotion();
    app.applySound();
    showChoices();
    app.shown = null;
    const rawArt = (raw as { art?: unknown }).art;
    let art: Awaited<ReturnType<ReturnType<typeof artStore>['importAll']>> | null = null;
    let artFailed = false;
    if (Array.isArray(rawArt) && rawArt.length) {
      try {
        art = await artStore(st.key).importAll(rawArt);
      } catch {
        artFailed = true;
      }
    }
    const rawDrafts = (raw as { drafts?: unknown }).drafts;
    let drafts: Awaited<ReturnType<ReturnType<typeof artStore>['importDrafts']>> | null = null;
    if (Array.isArray(rawDrafts) && rawDrafts.length) {
      try {
        drafts = await artStore(st.key).importDrafts(rawDrafts);
      } catch {
        artFailed = true;
      }
    }
    const rawStories = (raw as { stories?: { stories?: unknown; chapters?: unknown; cards?: unknown } | null }).stories;
    let tales: Awaited<ReturnType<ReturnType<typeof storyStore>['importAll']>> | null = null;
    let talesFailed = false;
    const some = (x: unknown) => Array.isArray(x) && x.length > 0;
    if (rawStories && typeof rawStories === 'object' && (some(rawStories.stories) || some(rawStories.chapters) || rawStories.cards && typeof rawStories.cards === 'object')) {
      try {
        tales = await storyStore(st.key).importAll(rawStories);
      } catch {
        talesFailed = true;
      }
    }
    const counts = art && (art.added || art.updated || art.kept || !art.unsaved) ? `${art.added} new${art.updated ? `, ${art.updated} updated` : ''}${art.kept ? `, ${art.kept} kept as ${art.kept === 1 ? 'its own page' : 'their own pages'} so nothing was replaced` : ''}` : '';
    const told = tales && (tales.added || tales.updated) ? `${tales.added} new${tales.updated ? `, ${tales.updated} updated` : ''}` : '';
    const too = counts && told ? `, drawings (${counts}) and stories (${told}) too` : counts ? `, drawings too (${counts})` : told ? `, stories too (${told})` : '';
    const parts = [
      !saving
        ? `Restored for this visit. This device isn't saving right now, so keep the Save Crystal file.${counts ? ` Drawings: ${counts}.` : ''}${told ? ` Stories: ${told}.` : ''}`
        : artFailed || talesFailed || art?.skipped || drafts?.skipped || tales?.skipped || fileIncomplete
          ? 'Restored your progress and lists.'
          : `Restored. Everything in the file was added${too}. Nothing was removed.`,
    ];
    if (artFailed) parts.push("The drawings in the file couldn't be added on this device; nothing was removed.");
    if (talesFailed) parts.push("The stories in the file couldn't be added on this device; nothing was removed.");
    if (art?.unsaved) parts.push('Some drawings are here for this visit only; keep the Save Crystal file.');
    if (tales?.unsaved) parts.push('Some stories are here for this visit only; keep the Save Crystal file.');
    if (art?.skipped || drafts?.skipped) parts.push("A few drawings in the file couldn't be read and were left out.");
    if (tales?.skipped) parts.push(CRYSTAL_COPY.storySkipped);
    if (!choicesSaved) parts.push(CRYSTAL_COPY.choicesUnsaved);
    if (!unreadBack) parts.push(CRYSTAL_COPY.unreadUnsaved);
    if (fileIncomplete) parts.push(CRYSTAL_COPY.incompleteRestore);
    return parts.join(' ');
  };
  const peek = h('section', { class: 'dq-peek is-hidden' });
  let pick = 0;
  let held: Peek | null = null;
  let gone = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && held) (e.stopPropagation(), cancel());
  };
  const close = () => {
    const open = held !== null;
    held = null;
    document.removeEventListener('keydown', onKey);
    peek.classList.add('is-hidden');
    peek.replaceChildren();
    peek.removeAttribute('aria-labelledby');
    if (open) document.dispatchEvent(new Event('crystal-closed'));
  };
  const cancel = () => {
    const at = document.activeElement;
    const lost = !at || at === document.body || peek.contains(at);
    pick++;
    close();
    status.textContent = typo(PEEK_COPY.closed);
    if (lost) restoreBtn.focus({ preventScroll: true });
  };
  const confirm = async () => {
    const c = held;
    if (!c) return;
    const n = ++pick;
    close();
    restoreBtn.focus({ preventScroll: true });
    let said: string;
    try {
      said = await restore(c);
    } catch {
      said = "That file doesn't look like a Save Crystal from this app. Nothing changed.";
    }
    // another file was picked while this one restored: its preview owns the status line now
    if (n === pick) status.textContent = said;
    notSaving.classList.toggle('is-hidden', st.saving);
  };
  const show = (c: Peek, fileName: string, { here, lost }: { here: number; lost: number }) => {
    stopClear();
    held = c;
    document.addEventListener('keydown', onKey);
    const missing = typo(PEEK_COPY.notSaved);
    const row = (label: string, value: string | number | null, cls = '') =>
      h('div', { class: 'dq-peek-row' }, h('dt', { text: typo(label) }), h('dd', { class: value === null || value === '' ? 'is-missing' : cls, text: value === null || value === '' ? missing : String(value) }));
    const head = h('h3', { class: 'dq-peek-h', id: 'dq-peek-h', tabindex: -1, text: typo(PEEK_COPY.title) });
    peek.replaceChildren(
      head,
      h('p', { class: 'dq-peek-file' }, `${typo(PEEK_COPY.file)} `, h('span', { class: 'dq-peek-fname', text: fileName })),
      h(
        'dl',
        { class: 'dq-peek-list' },
        row(PEEK_COPY.name, c.name),
        row(PEEK_COPY.began, c.began === null ? null : longDate(c.began)),
        row(PEEK_COPY.made, c.made === null ? null : longDate(c.made)),
        row(PEEK_COPY.skills, c.skills, 'dq-num'),
        row(PEEK_COPY.diary, c.diaryDays, 'dq-num'),
        row(PEEK_COPY.drawings, c.drawings, 'dq-num'),
        row(PEEK_COPY.stories, c.stories, 'dq-num'),
      ),
      ...[
        c.incomplete && p(CRYSTAL_COPY.incompleteRestore, 'dq-small dq-peek-note'),
        c.unreadable && p(PEEK_COPY.unreadable, 'dq-small dq-peek-note'),
        lost > 0 && p(lost === 1 ? PEEK_COPY.lostOne : PEEK_COPY.lost.replace('{n}', String(lost)), 'dq-small dq-peek-note dq-peek-lost'),
        here > 0 && p(here === 1 ? PEEK_COPY.hereOne : PEEK_COPY.here.replace('{n}', String(here)), 'dq-small dq-peek-note dq-peek-here'),
      ].filter((x) => !!x),
      p(PEEK_COPY.adds, 'dq-small'),
      h('div', { class: 'dq-actions' }, btn(PEEK_COPY.confirm, () => void confirm(), { kind: 'primary', ic: 'import' }), btn(PEEK_COPY.cancel, cancel, { kind: 'quiet' })),
    );
    peek.setAttribute('aria-labelledby', head.id);
    peek.classList.remove('is-hidden');
    head.focus({ preventScroll: true });
    head.scrollIntoView({ block: 'start' });
  };
  /** Every read of a chosen file ends with this, whether its preview showed, the file was turned down or a later choice took over. */
  const settled = (name: string, outcome: 'shown' | 'refused' | 'dropped') => document.dispatchEvent(new CustomEvent('crystal-read', { detail: { name, outcome } }));
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    const n = ++pick;
    close();
    status.textContent = typo(PEEK_COPY.reading);
    const r = await readCrystal(f).catch(() => 'wrong' as const);
    if (gone || n !== pick) return settled(f.name, 'dropped');
    if (typeof r !== 'string') {
      // what Restore would leave out, as Restore itself decides (read only): pages whose story is nowhere, and clashes here
      const told = r.raw.stories;
      const none = { here: 0, lost: 0 };
      const left = told && typeof told === 'object' ? await storyStore(st.key).skips(told).catch(() => none) : none;
      if (gone || n !== pick) return settled(f.name, 'dropped');
      status.textContent = '';
      show(r, f.name, left);
      return settled(f.name, 'shown');
    }
    status.textContent =
      r === 'big' ? 'That file is too big to be a Save Crystal. Nothing changed.' : r === 'unread' ? "That file couldn't be read. Nothing changed." : "That file doesn't look like a Save Crystal from this app. Nothing changed.";
    settled(f.name, 'refused');
  });
  // back up, then clear this game's data: a Save Crystal first, then one confirmation
  const clearBox = h('section', { class: 'dq-clear', 'aria-labelledby': 'dq-clear-h' });
  /** what the Save Crystal just made holds (see crystalContent), while its confirmation is open */
  let backup: string | null = null;
  let clearRun = 0;
  const onClearKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && backup) (e.stopPropagation(), keepAll());
  };
  const clearHead = (text: string) => h('h3', { class: 'dq-clear-h', id: 'dq-clear-h', tabindex: -1, text: typo(text) });
  const startBtn = btn(CLEAR_COPY.start, () => void backUp(), { kind: 'quiet' });
  const idle = [p(CLEAR_COPY.intro, 'dq-small'), h('div', { class: 'dq-actions' }, startBtn)];
  /**
   * Back to the one button: a confirmation (or a backup still being made) is dropped. The button is never moved while it
   * is in place (moving it would drop focus). With refocus, focus that was in here, or lost to the page, comes back to it.
   */
  const stopClear = (refocus = false) => {
    const at = document.activeElement;
    const lost = refocus && (!at || at === document.body || clearBox.contains(at));
    clearRun++;
    backup = null;
    document.removeEventListener('keydown', onClearKey);
    startBtn.disabled = false;
    startBtn.removeAttribute('aria-busy');
    clearBox.removeAttribute('aria-busy');
    clearBox.classList.remove('is-asking');
    if (clearBox.children.length !== idle.length || idle.some((x, i) => clearBox.children[i] !== x)) clearBox.replaceChildren(...idle);
    if (lost) startBtn.focus({ preventScroll: true });
  };
  const keepAll = () => {
    stopClear(true);
    status.textContent = typo(CLEAR_COPY.kept);
  };
  const ask = (b: string, head: HTMLElement, ...kids: HTMLElement[]) => {
    backup = b;
    clearBox.removeAttribute('aria-busy');
    clearBox.classList.add('is-asking');
    document.addEventListener('keydown', onClearKey);
    clearBox.replaceChildren(head, ...kids);
    head.focus({ preventScroll: true });
    head.scrollIntoView({ block: 'start' });
  };
  const backUp = async () => {
    // a Save Crystal preview gives way
    if (held) {
      pick++;
      close();
    }
    stopClear(true);
    const n = clearRun;
    if (!canWrite()) return void (status.textContent = typo(CLEAR_COPY.busy));
    startBtn.disabled = true;
    startBtn.setAttribute('aria-busy', 'true');
    status.textContent = typo(CLEAR_COPY.making);
    const made = await makeCrystal(st, app.opts.volume).catch(() => null);
    if (gone || n !== clearRun) return;
    if (!made || made.missing) {
      stopClear(true);
      status.textContent = made ? typo(CLEAR_COPY.incomplete.replace('{items}', made.missing)) : typo(CLEAR_COPY.unmade);
      return;
    }
    const name = `save-crystal-${st.today()}.json`;
    // a share or download that started is all a page can know of: the confirmation asks them to check the file
    const r = await shareOrSave(made.json, name, 'application/json').catch(() => 'failed' as const);
    if (gone || n !== clearRun) return;
    if (r !== 'saved' && r !== 'shared') {
      stopClear(true);
      status.textContent = typo(r === 'cancelled' ? CLEAR_COPY.cancelled : CLEAR_COPY.unmade);
      return;
    }
    status.textContent = '';
    ask(
      crystalContent(made.json),
      clearHead(CLEAR_COPY.title),
      h('p', { class: 'dq-text dq-clear-file' }, `${typo(r === 'shared' ? CLEAR_COPY.shared : CLEAR_COPY.saved)} `, h('span', { class: 'dq-clear-fname', text: name }), '.'),
      p(CLEAR_COPY.keep, 'dq-small'),
      p(CLEAR_COPY.goes, 'dq-small'),
      h('div', { class: 'dq-actions' }, btn(CLEAR_COPY.confirm, () => void clearAll(), { kind: 'primary' }), btn(CLEAR_COPY.cancel, keepAll, { kind: 'quiet' })),
    );
  };
  const clearAll = async () => {
    const b = backup;
    if (!b) return;
    const n = ++clearRun;
    backup = null;
    document.removeEventListener('keydown', onClearKey);
    clearBox.querySelectorAll('button').forEach((x) => (x.disabled = true));
    clearBox.setAttribute('aria-busy', 'true');
    if (!canWrite()) {
      stopClear(true);
      return void (status.textContent = typo(CLEAR_COPY.busy));
    }
    status.textContent = typo(CLEAR_COPY.checking);
    const hold = await holdAll();
    // the Save Crystal must still hold everything this device has: another tab may have changed something since
    const now = await makeCrystal(st, app.opts.volume).catch(() => null);
    if (!now || now.missing || crystalContent(now.json) !== b) {
      hold.release();
      if (gone || n !== clearRun) return;
      status.textContent = '';
      ask(
        b,
        clearHead(CLEAR_COPY.changedTitle),
        p(CLEAR_COPY.changed, 'dq-small'),
        h('div', { class: 'dq-actions' }, btn(CLEAR_COPY.fresh, () => void backUp(), { kind: 'primary' }), btn(CLEAR_COPY.cancel, keepAll, { kind: 'quiet' })),
      );
      return;
    }
    // Settings was left during the check (the Safe Zone, say): nothing is cleared under the player
    if (gone || n !== clearRun) return void hold.release();
    // every open copy stops writing and shows how clearing goes (this screen too, see App.go)
    hold.clear();
    void clearGame();
  };
  stopClear();
  const showTherapist = !s.flags.therapistLineShown && mayMentionTherapist();
  if (showTherapist) {
    s.flags.therapistLineShown = true;
    st.save();
  }
  notSaving.classList.toggle('is-hidden', st.saving);
  const offSaving = st.onChange(() => notSaving.classList.toggle('is-hidden', st.saving));
  // the two names: saved when a field is left (or Enter), so typing never fights a save from another open copy
  const nameIn = (key: 'playerName' | 'companion', label: string, hint: string, ph: string) => {
    const id = `set-${key}`;
    const input = h('input', { id, class: 'dq-input', type: 'text', maxlength: 24, autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done', placeholder: ph });
    input.value = s.settings[key];
    input.addEventListener('change', () => {
      const v = cleanName(input.value);
      input.value = v;
      if (v === s.settings[key]) return;
      s.settings[key] = v;
      st.touch(key);
      st.save();
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
    const offName = st.onChange(() => {
      if (!input.isConnected) return void offName();
      if (document.activeElement !== input && input.value !== s.settings[key]) input.value = s.settings[key];
    });
    return h('div', { class: 'dq-setting dq-setting--col' }, h('label', { for: id, class: 'dq-setting-l' }, h('span', { class: 'dq-setting-t', text: label }), h('span', { class: 'dq-setting-h', text: hint })), input);
  };
  const motionLabels = ['Auto', 'Reduced', 'Full'];
  // no switch at all where the browser can't vibrate
  const vibrate = app.canBuzz()
    ? toggle('Vibrate when a timer starts or ends', s.settings.vibrate, (v) => {
        s.settings.vibrate = v;
        st.touch('vibrate');
        st.save();
        if (v) app.buzz('start');
      }, 'One soft buzz as it starts, two as it ends.')
    : null;
  // another open copy can turn it on or off: the switch shows the choice a buzz follows, as Motion, Text size and Sound
  // show theirs
  const buzzIn = vibrate?.querySelector('input');
  const offChoices = st.onChange(showChoices);
  const levels = app.opts.volume ? volumeSliders(app.opts.volume, { hum: true }) : null;
  const robe = wardrobePanel(app);
  const el = h(
    'div',
    { class: 'dq-page dq-settings' },
    pageHead('Settings'),
    h(
      'div',
      { class: 'dq-settings-grid' },
      panel(
        { title: 'You', ic: icon('settings') },
        nameIn('playerName', 'Your name', `What the Lantern calls you. Empty shows ${DEFAULT_NAME}.`, DEFAULT_NAME),
        nameIn('companion', "Your companion's name", `The little moth that keeps watch. Empty shows ${DEFAULT_COMPANION}.`, DEFAULT_COMPANION),
      ),
      panel(
        { title: 'Feel', ic: icon('settings') },
        levels
          ? h(
              'div',
              { class: 'dq-setting dq-setting--col dq-setting--vol' },
              h('span', { class: 'dq-setting-l' }, h('span', { class: 'dq-setting-t', text: 'Sound' }), h('span', { class: 'dq-setting-h', text: 'Music, soft chimes and breathing cues. Never required.' })),
              levels,
            )
          : toggle('Sound', s.settings.sound, (v) => {
              s.settings.sound = v;
              st.touch('sound');
              st.save();
              app.applySound();
              if (v) app.sound('soft_chime');
            }, 'Music, soft chimes and breathing cues. Never required.'),
        h(
          'div',
          { class: 'dq-setting dq-setting--col' },
          h('span', { class: 'dq-setting-l' }, h('span', { class: 'dq-setting-t', text: 'Motion' }), h('span', { class: 'dq-setting-h', text: 'Auto follows your device. Reduced keeps fades and drops movement.' })),
          segmented('Motion', ['system', 'reduce', 'full'], s.settings.motion, (v) => {
            s.settings.motion = (v as 'system' | 'reduce' | 'full') ?? 'system';
            st.touch('motion');
            st.save();
            app.applyMotion();
          }, { labels: motionLabels, cls: 'dq-seg--3' }),
        ),
        h(
          'div',
          { class: 'dq-setting dq-setting--col' },
          h('span', { class: 'dq-setting-l' }, h('span', { class: 'dq-setting-t', text: 'Text size' }), h('span', { class: 'dq-setting-h', text: 'Bigger words in the Safe Zone and when you read a story.' })),
          segmented('Text size', [...READ_SIZES], textSize(app), (v) => keepTextSize(app, v as ReadSize), { labels: ['Regular', 'Larger', 'Largest'], cls: 'dq-seg--3' }),
        ),
        vibrate,
      ),
      panel({ title: 'Crisis lines', ic: icon('phone') }, regionPicker(app, undefined, SAFE.settings)),
      robe.el,
      panel(
        { title: 'Intro', ic: icon('replay') },
        p('The cutscene, the shadows and the chest. As many times as you like.', 'dq-text'),
        h('div', { class: 'dq-actions' }, btn('Replay cutscene', () => app.opts.onReplay(), { kind: 'quiet', ic: 'replay' }), btn(LETTER.title, () => void welcomeNote(app), { kind: 'quiet', ic: 'book' })),
      ),
      panel(
        { title: 'Your data', ic: icon('export') },
        p('**Saved only on this device.** No account, no tracking.', 'dq-text'),
        p('A Save Crystal is a backup file of everything here, your stories and drawings included, unfinished ones too. Keep one somewhere safe; Restore adds it back without removing anything.', 'dq-small'),
        notSaving,
        keeps.el,
        h(
          'div',
          { class: 'dq-actions' },
          btn('Save Crystal', async () => {
            const { json, missing } = await makeCrystal(st, app.opts.volume);
            const r = await shareOrSave(json, `save-crystal-${st.today()}.json`, 'application/json');
            const done = r === 'saved' ? 'Saved' : r === 'shared' ? 'Shared' : '';
            status.textContent = done && missing ? `${done}. ${CRYSTAL_COPY.incomplete.replace('{items}', missing)}` : r === 'saved' ? 'Save Crystal downloaded.' : r === 'shared' ? 'Save Crystal shared.' : '';
          }, { kind: 'quiet', ic: 'export' }),
          restoreBtn,
          btn('Diary card text', () => app.go({ name: 'diary' }), { kind: 'link' }),
        ),
        file,
        peek,
        status,
        clearBox,
      ),
      panel(
        { title: 'About', ic: icon('book') },
        p(ABOUT.what, 'dq-text'),
        p(ABOUT.device, 'dq-text'),
        showTherapist ? p(ABOUT.therapist, 'dq-text dq-quietline') : null,
        p(`Crisis lines in the Safe Zone were checked on ${CRISIS_CHECKED} against each service's own site or an official government page.`, 'dq-small'),
      ),
    ),
    robe.bar,
  );
  return {
    el,
    title: 'Settings',
    mode: 'sub',
    foot: robe.bar,
    leave: () => {
      robe.leave();
      offSaving();
      offChoices();
      keeps.stop();
      gone = true;
      pick++;
      close();
      clearRun++;
      backup = null;
      document.removeEventListener('keydown', onClearKey);
      levels?.dispose();
    },
  };
}

