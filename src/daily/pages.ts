import { LOADOUT, LOADOUT_COPY, MODULES, MODULE_ORDER, SAFE, SKILL, SKILLS } from '../content/dbt';
import { CRISIS_CHECKED } from '../content/crisis-lines';
import { ABOUT, CRYSTAL_COPY } from '../content/daily-lines';
import type { App, ScreenOut } from './app';
import { glyph, icon, mothSVG } from './art';
import { skillCard } from './hub';
import { regionPicker, telHref, smsHref } from './safe';
import { allyCard } from './artroom';
import { artStore } from './artstore';
import { storyStore } from './storystore';
import { addDays, cleanName, fieldKey, fieldTimes, isSkillId, normalize, ROW_CAP, uid, type DiaryEntry, type State, type Store } from './store';
import { btn, copyText, field, h, p, panel, segmented, shareOrSave, toggle, typo } from './ui';
import { volumeSliders } from '../ui/volume';
import { STEALTH, STEALTH_LINES } from '../content/stealth-lines';
import { fishSVG, lurkCatSVG, seaweedSVG, sharkFinSVG, sharkTailSVG } from './art';
import { Slime } from './bubbles';
import { inventorySection, rosterSection, brambleNap } from './roster';
import { wardrobePanel } from './wardrobe';
import { DEFAULT_COMPANION, DEFAULT_NAME } from '../core/you';
import { BESIDE } from '../core/stored-names';
import { exportPreferences, restorePreferences } from './crystal';

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
  try {
    localStorage.setItem(`${key}${BESIDE.stealth}`, JSON.stringify(prefs));
  } catch {
    /* the room still works; the look resets next visit */
  }
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
  const setWords = (on: boolean) => {
    prefs.words = on;
    el.classList.toggle('is-words', on);
    // the words only run while shown; start them in step with the glow's breath
    const t = glow.getAnimations()[0]?.currentTime;
    if (on && typeof t === 'number') word.querySelectorAll('span').forEach((s) => s.getAnimations().forEach((a) => (a.currentTime = t)));
  };
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
  const slime = new Slime({ reduced: () => app.reduced(), label: STEALTH.slimeLabel, onPoke: () => app.sound('bubble') });
  el.append(
    h('header', { class: 'dq-pagehead dq-st-head' }, h('p', { class: 'dq-st-kicker', text: STEALTH.kicker }), h('h1', { class: 'dq-h1', 'data-focus': '', text: STEALTH.title }), p(STEALTH.sub, 'dq-text dq-pagesub dq-st-sub')),
    title,
    stage,
    h(
      'div',
      { class: 'dq-st-modes' },
      mode(STEALTH.aquarium, ST_IC.fish, prefs.aquarium, setAquarium),
      mode(STEALTH.words, ST_IC.breath, prefs.words, setWords, `${STEALTH.words}, ${STEALTH.wordsHint}`),
    ),
    p(line, 'dq-text dq-st-line'),
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
    if (catBusy === 'nudge') return;
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
  every([18, 40], [55, 140], blep);
  if (!app.reduced()) {
    every([8, 16], [45, 100], swim);
    every([35, 70], [100, 190], sprawl);
    every([65, 100], [120, 230], nudge);
  }
  const hook = { blep, sprawl, nudge, swim, slime };
  (window as unknown as { __stealth?: typeof hook }).__stealth = hook;

  return {
    el,
    title: STEALTH.title,
    mode: 'sub',
    bubbles: prefs.aquarium ? [13, 1.2] : [7, 1],
    leave: () => {
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
export function shadowsScreen(app: App): ScreenOut {
  const d = app.store.derived();
  const counts: Record<string, number> = {};
  for (const e of app.store.state.events) if (e.k === 'skill' && e.skill) counts[e.skill] = (counts[e.skill] ?? 0) + 1;
  const owned = SKILLS.filter((s) => d.collection.has(s.id));
  const first = h(
    'article',
    { class: 'dq-first' },
    h('div', { class: 'dq-first-art', html: mothSVG({ size: 150 }) }),
    h('div', { class: 'dq-first-txt' }, h('h2', { class: 'dq-first-n', text: typo('{companion}') }), p('A small night moth, asleep. It was here before any skill, and it stays.', 'dq-text'), h('span', { class: 'dq-tag dq-mint', text: 'Yours' })),
  );
  const grid = h(
    'div',
    { class: 'dq-collection' },
    owned.map((s) =>
      h(
        'button',
        { type: 'button', class: 'dq-cardbtn', onclick: () => app.go({ name: 'skill', id: s.id }), 'aria-label': `${s.sl}, ${s.real}. Practise it.` },
        skillCard(s.id, { small: true }),
        counts[s.id] ? h('span', { class: 'dq-cardbtn-n', text: `Practised ${counts[s.id]}x` }) : h('span', { class: 'dq-cardbtn-n', text: 'Met' }),
      ),
    ),
  );
  const designSlot = h(
    'button',
    { type: 'button', class: 'dq-cardbtn dq-allyslot', onclick: () => app.go({ name: 'draw', kind: 'ally' }) },
    h('span', { class: 'dq-cardface dq-allyslot-face' }, h('span', { class: 'dq-allyslot-ic', html: icon('brush') }), h('span', { class: 'dq-allyslot-t', text: 'Design an ally' }), h('span', { class: 'dq-allyslot-s', text: 'Draw one. It joins your army.' })),
  );
  const allies = h('div', { class: 'dq-collection dq-allies' }, designSlot);
  void artStore(app.store.key)
    .list()
    .then((list) => {
      const mine = list.filter((m) => m.kind === 'ally');
      allies.replaceChildren(
        ...mine.map((m) =>
          h('button', { type: 'button', class: 'dq-cardbtn dq-allybtn', onclick: () => app.go({ name: 'piece', id: m.id }), 'aria-label': `${m.name || 'Shadow ally'}, a shadow ally you designed` }, allyCard(app, m)),
        ),
        designSlot,
      );
    });
  const el = h(
    'div',
    { class: 'dq-page dq-shadows' },
    pageHead('Shadows', 'Every skill you meet joins the Night Watch as a shadow ally, and so does every ally you draw. They stay.'),
    first,
    rosterSection(app),
    h('h2', { class: 'dq-sec-h' }, h('span', { text: 'Designed by you' }), h('span', { class: 'dq-sec-sub', text: 'From the Art room' })),
    allies,
    h('h2', { class: 'dq-sec-h' }, h('span', { text: 'Skill shadows' }), h('span', { class: 'dq-sec-sub', text: 'Every skill you have met' })),
    owned.length ? grid : p('Flip a daily card or open any skill, and it joins here.', 'dq-text dq-empty'),
    inventorySection(app),
    h('div', { class: 'dq-actions' }, btn('All skills', () => app.go({ name: 'library' }), { kind: 'quiet', ic: 'book' })),
  );
  return { el, title: 'Shadows', mode: 'sub' };
}

// ---------------- Library ----------------
export function libraryScreen(app: App): ScreenOut {
  const row = (s: (typeof SKILLS)[number]) => h('li', {}, h('button', { type: 'button', class: 'dq-librow', onclick: () => app.go({ name: 'skill', id: s.id }) }, h('span', { class: 'dq-librow-n', text: typo(s.sl) }), h('span', { class: 'dq-librow-r', text: typo(s.real) }), h('span', { class: 'dq-librow-m', text: s.minutes }), h('span', { class: 'dq-librow-c', html: icon('chev') })));
  const el = h(
    'div',
    { class: 'dq-page dq-library' },
    pageHead('Skills', 'Any skill, any time. Each one counts the moment you open it.'),
    h('section', { class: 'dq-libsec dq-libsec--loadout' }, h('h2', { class: 'dq-libsec-h' }, h('span', { class: 'dq-libsec-ic', html: icon('comfort') }), h('span', { text: LOADOUT_COPY.title }), h('span', { class: 'dq-libsec-s', text: LOADOUT_COPY.sub })), h('ul', { class: 'dq-liblist' }, LOADOUT.map((id) => row(SKILL[id])))),
    MODULE_ORDER.map((mid) => {
      const m = MODULES[mid];
      return h(
        'section',
        { class: `dq-libsec dq-mod-${mid}` },
        h('h2', { class: 'dq-libsec-h' }, h('span', { class: 'dq-libsec-ic', html: glyph(mid) }), h('span', { text: m.name }), h('span', { class: 'dq-libsec-s', text: m.statName })),
        h(
          'ul',
          { class: 'dq-liblist' },
          SKILLS.filter((s) => s.module === mid && !s.loadout).map(row),
        ),
      );
    }),
  );
  return { el, title: 'Skills', mode: 'sub' };
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


export function diaryScreen(app: App): ScreenOut {
  const st = app.store;
  const today = st.today();
  const s = st.state;
  const entry = s.diary[today] ?? { day: today, emotions: {}, urges: {}, note: '', updatedAt: 0 };
  const draft = { emotions: { ...entry.emotions }, urges: { ...entry.urges }, note: entry.note };
  type Kind = 'emotions' | 'urges';
  const rowsShown = new Map<string, { kind: Kind; name: string; mount: () => void; busy: () => boolean }>();
  const touched = new Set<string>();
  let noteTouched = false;
  const rowEl = (name: string, kind: Kind) => {
    const key = `${kind}:${name}`;
    const row = h('div', { class: 'dq-drow' }, h('span', { class: 'dq-drow-t', text: name }));
    let seg: HTMLElement | null = null;
    const mount = () => {
      const next = segmented(name, [0, 1, 2, 3, 4, 5], draft[kind][name] ?? null, (v) => {
        draft[kind][name] = typeof v === 'number' ? v : null;
        touched.add(key);
        touch();
      }, { allowClear: true, cls: 'dq-seg--6' });
      if (seg) seg.replaceWith(next);
      else row.append(next);
      seg = next;
    };
    mount();
    rowsShown.set(key, { kind, name, mount, busy: () => !!seg?.contains(document.activeElement) });
    return row;
  };
  const writeTouched = () => {
    st.sync();
    const cur = s.diary[today];
    const ft = fieldTimes(cur);
    const at = Math.max(st.now(), Math.max(cur?.updatedAt ?? -Infinity, ...Object.values(ft)) + 1);
    const e: DiaryEntry = { day: today, emotions: { ...cur?.emotions }, urges: { ...cur?.urges }, note: cur?.note ?? '', updatedAt: cur?.updatedAt ?? 0, ft };
    for (const key of touched) {
      const r = rowsShown.get(key);
      if (!r) continue;
      e[r.kind][r.name] = draft[r.kind][r.name] ?? null;
      ft[fieldKey(r.kind, r.name)] = at;
    }
    if (noteTouched) {
      e.note = draft.note.trim().slice(0, 300);
      ft.note = at;
    }
    if (!cur || touched.size || noteTouched) e.updatedAt = Math.max(e.updatedAt, at);
    s.diary[today] = e;
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
  const codes = st.skillCodes(today);
  const used = Object.keys(codes).filter(isSkillId);
  const note = field('One line, optional', { value: draft.note, placeholder: 'A note for today (optional)', max: 300, oninput: (v) => {
    draft.note = v;
    noteTouched = true;
    touch();
  } });
  const saved = h('p', { class: 'dq-hint', 'aria-live': 'polite' });
  const save = () => {
    window.clearTimeout(timer);
    dirty = false;
    writeTouched();
    const first = !s.events.some((e) => e.k === 'diary' && e.day === today);
    if (first) st.add('diary', 10);
    else st.save();
    written();
    app.sound('check');
    saved.textContent = st.saving ? (first ? 'Saved on this device. +10 XP' : 'Updated on this device.') : `${NOT_SAVING}${first ? ' +10 XP' : ''}`;
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
    p('For your therapist, if you want. Plain text, and it only leaves this device if you send it.', 'dq-text'),
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
  const rowsEditor = h('div', { class: 'dq-rowsed is-hidden' });
  const renderRowsEd = () => {
    const mk = (kind: 'emotionRows' | 'urgeRows', label: string) => {
      const list = s.settings[kind];
      const cap = ROW_CAP[kind === 'emotionRows' ? 'emotions' : 'urges'];
      const f = field(`Add a row to ${label}`, { placeholder: 'Row name', hideLabel: true, max: 60 });
      const full = p(`The card holds ${cap} rows here. Remove one to add another.`, 'dq-small is-hidden');
      return h(
        'div',
        { class: 'dq-rowsed-g' },
        h('h3', { class: 'dq-label', text: label }),
        h('ul', { class: 'dq-items' }, list.map((r) => h('li', { class: 'dq-item' }, h('span', { text: r }), h('button', { type: 'button', class: 'dq-icbtn dq-icbtn--sm', 'aria-label': `Remove ${r}`, html: icon('close'), onclick: () => {
          st.sync();
          const j = list.indexOf(r);
          if (j >= 0) list.splice(j, 1);
          st.touch(kind);
          st.save();
          app.go({ name: 'diary' }, { replace: true, quiet: true });
        } })))),
        h('div', { class: 'dq-addrow' }, f.el, btn('Add', () => {
          st.sync();
          const v = f.input.value.trim();
          if (!v || list.includes(v)) return f.input.focus();
          if (list.length >= cap) return full.classList.remove('is-hidden');
          list.push(v);
          st.touch(kind);
          st.save();
          app.go({ name: 'diary' }, { replace: true, quiet: true });
        }, { kind: 'quiet', ic: 'plus' })),
        full,
      );
    };
    rowsEditor.replaceChildren(p('Rename by removing and adding. Use private words if you like. Past entries keep their rows.', 'dq-small'), mk('emotionRows', 'Feelings'), mk('urgeRows', 'Urges'));
  };
  renderRowsEd();
  const urgeRows = rowsFor(s, 'urges', [today]);
  const el = h(
    'div',
    { class: 'dq-page dq-diary' },
    pageHead('Diary card', 'Optional, and under a minute. Blank is fine: blank and 0 mean different things.'),
    h(
      'div',
      { class: 'dq-diary-grid' },
      panel(
        { title: dayLabel(today), ic: icon('diary'), cls: 'dq-today' },
        h('h3', { class: 'dq-label', text: 'Feelings, 0 to 5' }),
        h('div', { class: 'dq-drows' }, rowsFor(s, 'emotions', [today]).map((r) => rowEl(r, 'emotions'))),
        urgeRows.length ? h('h3', { class: 'dq-label', text: 'Urges, 0 to 5' }) : null,
        h('div', { class: 'dq-drows' }, urgeRows.map((r) => rowEl(r, 'urges'))),
        h('h3', { class: 'dq-label', text: 'Skills today' }),
        used.length
          ? h('ul', { class: 'dq-skillsused' }, used.map((id) => h('li', {}, h('span', { text: typo(`${SKILL[id].sl} (${SKILL[id].real})`) }), h('span', { class: 'dq-code', text: codes[id] === 5 ? 'helped' : codes[id] === 4 ? "didn't help this time" : 'practised' }))))
          : p('None yet today. That is fine.', 'dq-small'),
        note.el,
        h('div', { class: 'dq-actions' }, btn('Save', save, { kind: 'primary' }), btn('Edit rows', () => rowsEditor.classList.toggle('is-hidden'), { kind: 'link' }), saved),
        rowsEditor,
      ),
      h('div', { class: 'dq-diary-side' }, panel({ title: 'Past 7 days', ic: icon('diary'), cls: 'dq-weekp' }, p('Only what you entered. No averages, no trends.', 'dq-small'), week), exportPanel),
    ),
  );
  const off = st.onChange(() => {
    const cur = s.diary[today];
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
    refresh();
  });
  return {
    el,
    title: 'Diary card',
    mode: 'sub',
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
    return panel(
      { title, ic: icon(ic), cls: `dq-listp dq-listp--${key}` },
      p(hint, 'dq-small'),
      items.length
        ? h('ul', { class: 'dq-items' }, items.map((it) => h('li', { class: 'dq-item' }, h('span', { text: typo(it.text) }), h('button', { type: 'button', class: 'dq-icbtn dq-icbtn--sm', 'aria-label': `Remove ${it.text}`, html: icon('close'), onclick: () => {
            const out = st.removeItem(items, it.id);
            st.save();
            rerender();
            if (out) removed(out.item.text, () => st.reviveItem(app.store.state.lists[key], out.item, out.index));
          } }))))
        : null,
      h('div', { class: 'dq-addrow' }, f.el, btn('Add', add, { kind: 'quiet', ic: 'plus' })),
    );
  };
  const people = s.lists.people;
  const pn = field('Name', { placeholder: 'Name' });
  const pp = field('Number', { placeholder: 'Phone number', type: 'tel', inputmode: 'tel' });
  const peoplePanel = panel(
    { title: 'People', ic: icon('phone'), cls: 'dq-listp' },
    p('People you could call or text. A professional too, if you have one. Added only by you.', 'dq-small'),
    people.length
      ? h('ul', { class: 'dq-items' }, people.map((x) => h('li', { class: 'dq-item dq-item--person' }, h('span', { class: 'dq-person-n', text: x.name }), x.phone ? h('span', { class: 'dq-person-acts' }, h('a', { class: 'dq-btn dq-btn--quiet dq-btn--sm', href: telHref(x.phone), html: `<span class="dq-btn-ic">${icon('phone')}</span><span>Call</span>` }), h('a', { class: 'dq-btn dq-btn--quiet dq-btn--sm', href: smsHref(x.phone.replace(/[^\d+]/g, '')), html: `<span class="dq-btn-ic">${icon('text')}</span><span>Text</span>` })) : null, h('button', { type: 'button', class: 'dq-icbtn dq-icbtn--sm', 'aria-label': `Remove ${x.name}`, html: icon('close'), onclick: () => {
          const out = st.removeItem(people, x.id);
          st.save();
          rerender();
          if (out) removed(out.item.name, () => st.reviveItem(app.store.state.lists.people, out.item, out.index));
        } }))))
      : null,
    h('div', { class: 'dq-person-add' }, pn.el, pp.el, h('div', { class: 'dq-actions' }, btn('Add person', () => {
      const name = pn.input.value.trim();
      if (!name) return pn.input.focus();
      people.push({ id: uid(), name: name.slice(0, 80), phone: pp.input.value.trim().slice(0, 40), at: st.now() });
      st.save();
      rerender();
    }, { kind: 'quiet', ic: 'plus' }))),
  );
  const maps = s.maps;
  const mapsPanel = maps.length
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
                { class: 'dq-item dq-item--map' },
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
    : null;
  const el = h(
    'div',
    { class: 'dq-page dq-comfort' },
    pageHead('Comfort', 'Your own lists. They show up in the Safe Zone and in skills, right when you need them.'),
    h(
      'div',
      { class: 'dq-comfort-grid' },
      listPanel('comfort', 'Comfort kit', 'Things that help, even a little.', 'Something that helps', 'comfort'),
      listPanel('activities', 'Go-to activities', 'Absorbing things for Trade Places: games, shows, songs, foods.', 'A game, a show, a song', 'shadows'),
      listPanel('reasons', 'Things that are yours', 'Things you like, want to see, want to do, want to try.', 'Something you like', 'rest'),
      peoplePanel,
      mapsPanel,
    ),
  );
  return { el, title: 'Comfort', mode: 'sub' };
}

// ---------------- Settings ----------------
export function settingsScreen(app: App): ScreenOut {
  const st = app.store;
  const s = st.state;
  const status = h('p', { class: 'dq-hint', 'aria-live': 'polite' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'dq-sr', 'aria-hidden': 'true', tabindex: -1 });
  const notSaving = p("This device isn't saving right now (storage may be full or private browsing). Your progress is safe for this visit; a Save Crystal keeps a copy.", `dq-small${st.saving ? ' is-hidden' : ''}`);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const homeTip = (window as unknown as { __persisted?: boolean }).__persisted === false && !standalone ? p('Tip: add the Lantern to your Home Screen so your phone keeps it safe. A Save Crystal is a spare copy.', 'dq-small') : null;
  const restore = async (f: File) => {
    if (f.size > 80 * 1024 * 1024) return 'That file is too big to be a Save Crystal. Nothing changed.';
    let text: string;
    try {
      text = await f.text();
    } catch {
      return "That file couldn't be read. Nothing changed.";
    }
    let raw: unknown = null;
    let data: ReturnType<typeof normalize> = null;
    try {
      raw = JSON.parse(text);
      data = normalize(raw);
    } catch {
      data = null;
    }
    if (!data) return "That file doesn't look like a Save Crystal from this app. Nothing changed.";
    const fileIncomplete = (raw as { incomplete?: unknown }).incomplete === true;
    const { saving } = st.merge(data);
    const choicesSaved = restorePreferences((raw as { preferences?: unknown }).preferences, st, app.opts.volume);
    app.applyMotion();
    app.applySound();
    app.root.querySelectorAll('.dq-settings [aria-label="Motion"] [role="radio"]').forEach((b, i) => b.setAttribute('aria-checked', String(['system', 'reduce', 'full'][i] === s.settings.motion)));
    if (!app.opts.volume) {
      const sound = app.root.querySelector<HTMLInputElement>('.dq-settings input[role="switch"]');
      if (sound) sound.checked = s.settings.sound;
    }
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
    const counts = art && (art.added || art.kept || !art.unsaved) ? `${art.added} new${art.kept ? `, ${art.kept} kept as ${art.kept === 1 ? 'its own page' : 'their own pages'} so nothing was replaced` : ''}` : '';
    const told = tales && (tales.added || tales.updated) ? `${tales.added} new${tales.updated ? `, ${tales.updated} updated` : ''}` : '';
    const too = counts && told ? `, drawings (${counts}) and stories (${told}) too` : counts ? `, drawings too (${counts})` : told ? `, stories too (${told})` : '';
    const parts = [
      !saving
        ? `Restored for this visit. This device isn't saving right now, so keep the Save Crystal file.${counts ? ` Drawings: ${counts}.` : ''}${told ? ` Stories: ${told}.` : ''}`
        : artFailed || talesFailed || art?.skipped || tales?.skipped || fileIncomplete
          ? 'Restored your progress and lists.'
          : `Restored. Everything in the file was added${too}. Nothing was removed.`,
    ];
    if (artFailed) parts.push("The drawings in the file couldn't be added on this device; nothing was removed.");
    if (talesFailed) parts.push("The stories in the file couldn't be added on this device; nothing was removed.");
    if (art?.unsaved) parts.push('Some drawings are here for this visit only; keep the Save Crystal file.');
    if (tales?.unsaved) parts.push('Some stories are here for this visit only; keep the Save Crystal file.');
    if (art?.skipped) parts.push("A few drawings in the file couldn't be read and were left out.");
    if (tales?.skipped) parts.push(CRYSTAL_COPY.storySkipped);
    if (!choicesSaved) parts.push(CRYSTAL_COPY.choicesUnsaved);
    if (fileIncomplete) parts.push(CRYSTAL_COPY.incompleteRestore);
    return parts.join(' ');
  };
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      status.textContent = await restore(f);
    } catch {
      status.textContent = "That file doesn't look like a Save Crystal from this app. Nothing changed.";
    }
    notSaving.classList.toggle('is-hidden', st.saving);
    file.value = '';
  });
  const showTherapist = !s.flags.therapistLineShown;
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
  const levels = app.opts.volume ? volumeSliders(app.opts.volume) : null;
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
      ),
      panel({ title: 'Crisis lines', ic: icon('phone') }, regionPicker(app, undefined, SAFE.settings)),
      wardrobePanel(app),
      panel(
        { title: 'Intro', ic: icon('replay') },
        p('The cutscene, the shadows and the chest. As many times as you like.', 'dq-text'),
        h('div', { class: 'dq-actions' }, btn('Replay cutscene', () => app.opts.onReplay(), { kind: 'quiet', ic: 'replay' })),
      ),
      panel(
        { title: 'Your data', ic: icon('export') },
        p('**Saved only on this device.** No account, no tracking.', 'dq-text'),
        p('A Save Crystal is a backup file of everything here, your stories and saved drawings included (an unfinished drawing is not, until you save it). Keep one somewhere safe; Restore adds it back without removing anything.', 'dq-small'),
        notSaving,
        homeTip,
        h(
          'div',
          { class: 'dq-actions' },
          btn('Save Crystal', async () => {
            app.opts.volume?.flush();
            const art = await artStore(st.key).exportAll();
            const { stories, chapters, cards, incomplete } = await storyStore(st.key).exportAll();
            const choices = exportPreferences(st, app.opts.volume);
            const missing = [art.incomplete ? 'drawings' : '', incomplete ? 'stories' : '', choices.incomplete ? 'choices' : ''].filter(Boolean).join(' and ');
            const r = await shareOrSave(st.exportJSON({ art: art.records, stories: { stories, chapters, cards }, preferences: choices.preferences, incomplete: !!missing }), `save-crystal-${st.today()}.json`, 'application/json');
            const done = r === 'saved' ? 'Saved' : r === 'shared' ? 'Shared' : '';
            status.textContent = done && missing ? `${done}. ${CRYSTAL_COPY.incomplete.replace('{items}', missing)}` : r === 'saved' ? 'Save Crystal downloaded.' : r === 'shared' ? 'Save Crystal shared.' : '';
          }, { kind: 'quiet', ic: 'export' }),
          btn('Restore', () => file.click(), { kind: 'quiet', ic: 'import' }),
          btn('Diary card text', () => app.go({ name: 'diary' }), { kind: 'link' }),
        ),
        file,
        status,
      ),
      panel(
        { title: 'About', ic: icon('book') },
        p(ABOUT.what, 'dq-text'),
        p(ABOUT.device, 'dq-text'),
        showTherapist ? p(ABOUT.therapist, 'dq-text dq-quietline') : null,
        p(`Crisis lines in the Safe Zone were checked on ${CRISIS_CHECKED} against each service's own site.`, 'dq-small'),
      ),
    ),
  );
  return {
    el,
    title: 'Settings',
    mode: 'sub',
    leave: () => {
      offSaving();
      levels?.dispose();
    },
  };
}

