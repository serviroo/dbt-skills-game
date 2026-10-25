import { animate } from '../ui/anim';
import { CALM, css, WINDOW } from '../motion/tokens';
import { FEELINGS, isHeavy, MODULES, MODULE_ORDER, SKILL, STRENGTH_FEELINGS, suggestFor, type Feeling } from '../content/dbt';
import { CHECKIN, QUEST, RANKS } from '../content/daily-lines';
import type { App, ScreenOut } from './app';
import { cardArtSVG, catSVG, crystalSVG, glyph, icon, mothSVG } from './art';
import { wait } from './clock';
import { btn, chip, h, md, panel, segmented, typo } from './ui';
import { artStore } from './artstore';
import { storyStore } from './storystore';
import { todayPrompt, thumbImg } from './artroom';
import { linePanel } from './lines';
import { goNext } from './moment';
import { isSkillId } from './store';
import { loadoutArt } from './widgets';
import { foilLayer, wandererRows, moonflower, titleUnlock } from './wave2';
import { cardBackArt } from './wardrobe';

export function skillCard(id: string, opts: { label?: string; special?: 'comfort' | 'free'; small?: boolean } = {}) {
  const sk = SKILL[isSkillId(id) ? id : 'wise-mind'];
  const m = MODULES[sk.module];
  if (opts.special === 'comfort')
    return h(
      'div',
      { class: 'dq-cardface dq-cardface--front is-special' },
      h('div', { class: 'dq-cf-top' }, h('span', { class: 'dq-cf-mod', html: `${icon('comfort')}<span>Your inventory</span>` }), h('span', { class: 'dq-cf-min', text: '1 min' })),
      h('div', { class: 'dq-cf-art', html: cardArtSVG(null, 'comfort') }),
      h('div', { class: 'dq-cf-name', text: 'Comfort' }),
      h('div', { class: 'dq-cf-real', text: 'Add one thing that helps' }),
      h('p', { class: 'dq-cf-blurb', text: typo('A song, a hoodie, a show, a person. It shows up in the Safe Zone when you need it.') }),
    );
  if (opts.special === 'free')
    return h(
      'div',
      { class: 'dq-cardface dq-cardface--front is-special' },
      h('div', { class: 'dq-cf-top' }, h('span', { class: 'dq-cf-mod', html: `${icon('shadows')}<span>Your collection</span>` }), h('span', { class: 'dq-cf-min', text: 'Any' })),
      h('div', { class: 'dq-cf-art', html: cardArtSVG(null, 'shadows') }),
      h('div', { class: 'dq-cf-name', text: 'Free choice' }),
      h('div', { class: 'dq-cf-real', text: 'Any skill, or none' }),
      h('p', { class: 'dq-cf-blurb', text: typo("Every skill you've met is in your collection. Pick whichever fits today.") }),
    );
  return h(
    'div',
    { class: `dq-cardface dq-cardface--front dq-mod-${sk.module}` },
    h('div', { class: 'dq-cf-top' }, h('span', { class: 'dq-cf-mod', html: `${glyph(sk.module)}<span>${m.name}</span>` }), h('span', { class: 'dq-cf-min', text: sk.minutes })),
    h('div', { class: 'dq-cf-art', html: sk.art ? loadoutArt(sk.art) : cardArtSVG(sk.module) }),
    h('div', { class: 'dq-cf-name', text: typo(sk.sl) }),
    h('div', { class: 'dq-cf-real', text: typo(opts.label ? `${sk.real} · ${opts.label}` : sk.real) }),
    opts.small ? null : h('p', { class: 'dq-cf-blurb', text: typo(sk.card) }),
    h('div', { class: 'dq-cf-stat', text: `${m.statName} +1` }),
  );
}

function statusPanel(app: App) {
  const d = app.store.derived();
  const { from, to, order } = app.statFrom();
  const rank = RANKS[d.rank];
  const ranked = d.rank > 0;
  const letter = ranked
    ? h('span', { class: 'dq-rank-letter', text: rank })
    : h('span', { class: 'dq-rank-mark', html: '<svg viewBox="0 0 20 30" width="20" height="30" aria-hidden="true"><path d="M10 1.5 L18.5 15 L10 28.5 L1.5 15 Z"/><path class="dq-rank-slit" d="M10 7.5 C11.4 11 11.4 19 10 22.5 C8.6 19 8.6 11 10 7.5 Z"/></svg>' });
  const xpEl = h('span', { class: 'dq-num', text: String(from.xp) });
  const statEls: Record<string, HTMLElement> = {};
  const stats = h(
    'dl',
    { class: 'dq-stats', id: 'dq-stats' },
    MODULE_ORDER.map((mid) => {
      const m = MODULES[mid];
      const n = h('dd', { class: 'dq-stat-n dq-num', text: String(from.stats[m.stat]) });
      statEls[m.stat] = n;
      return h('div', { class: `dq-stat dq-mod-${mid}` }, h('dt', {}, h('span', { class: 'dq-stat-ic', html: glyph(mid) }), h('span', { class: 'dq-stat-k', text: m.statName }), h('span', { class: 'dq-stat-m', text: m.name })), n);
    }),
  );
  const el = panel(
    { title: 'Status', ic: icon('status'), cls: 'dq-status', label: 'Status' },
    h('div', { class: 'dq-hairbar', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'dq-player' },
      h('div', { class: 'dq-crystal', 'aria-hidden': 'true', html: crystalSVG(58) }, letter),
      h(
        'dl',
        { class: 'dq-kvs' },
        wandererRows(app),
        ranked ? h('div', { class: 'dq-kv' }, h('dt', { text: 'Rank' }), h('dd', { text: `${rank}-Rank Wanderer` })) : null,
        h('div', { class: 'dq-kv' }, h('dt', { text: 'XP' }), h('dd', {}, xpEl)),
      ),
      h('div', { class: 'dq-firstshadow', title: typo('{companion}, asleep'), html: mothSVG({ size: 84, label: typo('{companion}, a small night moth, asleep') }) }),
      moonflower(app),
    ),
    titleUnlock(app),
    h(
      'button',
      {
        type: 'button',
        class: 'dq-stats-toggle',
        'aria-expanded': 'false',
        'aria-controls': 'dq-stats',
        onclick: (e: Event) => {
          const open = el.classList.toggle('is-open');
          (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(open));
          if (open) animate(stats, app.reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: app.reduced() ? WINDOW.reducedFadeMs : 220, easing: 'cubic-bezier(.16,1,.3,1)' });
        },
      },
      h('span', { text: 'Stats' }),
      h('span', { class: 'dq-stats-chev', 'aria-hidden': 'true' }),
    ),
    stats,
  );
  // count up anything earned since the panel was last shown
  const grow: [HTMLElement, number, number][] = [];
  if (to.xp > from.xp) grow.push([xpEl, from.xp, to.xp]);
  for (const s of order) if (to.stats[s] > from.stats[s]) grow.push([statEls[s], from.stats[s], to.stats[s]]);
  if (grow.length) {
    if (grow.some(([node]) => node !== xpEl)) {
      el.classList.add('is-open');
      el.querySelector('.dq-stats-toggle')?.setAttribute('aria-expanded', 'true');
    }
    void wait(0.5).then(async () => {
      const steps = app.reduced() ? 1 : 24;
      for (const [e] of grow) e.closest('.dq-stat, .dq-kv')?.classList.add('is-up');
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const e = 1 - Math.pow(1 - k, 3);
        for (const [node, a, b] of grow) node.textContent = String(Math.round(a + (b - a) * e));
        await wait(1 / 30);
      }
      await wait(1.6);
      for (const [e] of grow) e.closest('.dq-stat, .dq-kv')?.classList.remove('is-up');
    });
  }
  return el;
}

function questSection(app: App) {
  const st = app.store;
  const q = st.quest();
  const today = st.today();
  const practised = () => st.state.events.some((e) => e.k === 'skill' && e.day === today);
  let open = st.state.flags.cardDay === today;
  let done = practised();
  const front = skillCard(q.skill, { label: q.label, special: q.special });
  front.append(h('span', { class: 'dq-sheen', 'aria-hidden': 'true' }));
  const foil = foilLayer(app, front, today);
  const cardName = q.special === 'comfort' ? 'Comfort' : q.special === 'free' ? 'Free choice' : SKILL[isSkillId(q.skill) ? q.skill : 'wise-mind'].sl;
  const openLabel = `Today's skill card: ${cardName}. Open it.`;
  const back = h('div', { class: 'dq-cardface dq-cardface--back', html: cardBackArt(app) }, h('span', { class: 'dq-cb-orn', 'aria-hidden': 'true' }), h('span', { class: 'dq-cb-t', text: 'Tap to reveal' }));
  const inner = h('div', { class: 'dq-card-inner' }, back, front);
  const note = h('p', { class: 'dq-quest-note', 'aria-live': 'polite', text: done ? typo(QUEST.done) : '' });
  const card = h('button', { type: 'button', class: `dq-card ${open ? 'is-open' : ''}`, 'aria-label': open ? openLabel : "Reveal today's skill card" }, inner);
  const begin = () => {
    if (q.special === 'comfort') app.go({ name: 'comfort' });
    else if (q.special === 'free') app.go({ name: 'shadows' });
    else app.go({ name: 'skill', id: q.skill, entry: q.entry });
  };
  const go = btn(q.special ? 'Open' : 'Begin', begin, { kind: done ? 'quiet' : 'primary', cls: 'dq-quest-go' });
  const pick = btn('Pick another', () => app.go({ name: 'library' }), { kind: 'quiet' });
  const acts = h('div', { class: 'dq-actions dq-actions--center dq-quest-acts' }, go, pick);
  if (!open) go.classList.add('is-hidden');
  const look = btn(QUEST.look, () => setAside(true), { kind: 'link', cls: 'dq-quest-look' });
  const asideText = h('p', { class: 'dq-quest-aside-t', tabindex: '-1', text: typo(QUEST.aside) });
  const aside = h('div', { class: 'dq-quest-aside' }, asideText, h('div', { class: 'dq-actions dq-actions--center' }, btn(QUEST.back, () => setAside(false), { kind: 'quiet', cls: 'dq-quest-back' })));
  const fade = (...els: Element[]) => {
    for (const e of els) animate(e, [{ opacity: 0 }, { opacity: 1 }], { duration: app.reduced() ? WINDOW.reducedFadeMs : CALM.fadeMs, easing: css(CALM.ease) });
  };
  const shown = (from: number) => [...section.children].slice(from).filter((e) => e.getClientRects().length);
  const flip = async () => {
    if (open) return begin();
    open = true;
    const isNew = !st.derived().collection.has(q.skill) && !q.special;
    card.classList.add('is-open');
    card.setAttribute('aria-label', openLabel);
    st.state.flags.cardDay = today;
    st.add('card', 0, q.special ? { data: { slot: q.slot, special: q.special } } : { skill: q.skill, data: { slot: q.slot } });
    app.sound('card_flip');
    if (app.reduced()) {
      animate(front, [{ opacity: 0 }, { opacity: 1 }], { duration: WINDOW.reducedFadeMs });
    } else {
      animate(inner, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], { duration: 900, easing: 'cubic-bezier(.3,.05,.15,1)' });
      animate(front.querySelector('.dq-sheen')!, [{ transform: 'translateX(-120%) skewX(-18deg)', opacity: 0 }, { opacity: 0.9, offset: 0.4 }, { transform: 'translateX(140%) skewX(-18deg)', opacity: 0 }], {
        duration: 1100,
        delay: 650,
        easing: 'cubic-bezier(.4,0,.2,1)',
      });
    }
    foil?.play();
    await wait(app.reduced() ? 0 : 0.9);
    if (!q.special && !done) note.textContent = typo(isNew ? QUEST.acquired(SKILL[isSkillId(q.skill) ? q.skill : 'wise-mind'].sl) : QUEST.again);
    go.classList.remove('is-hidden');
    fade(...shown(2));
  };
  card.addEventListener('click', flip);
  const section = h(
    'section',
    { class: `dq-quest ${done ? 'is-done' : ''} ${st.questAside() ? 'is-aside' : ''}`, 'aria-labelledby': 'dq-quest-h' },
    h('h2', { class: 'dq-sec-h', id: 'dq-quest-h' }, h('span', { text: "Today's quest" }), h('span', { class: 'dq-sec-sub', text: 'One skill card' })),
    h('div', { class: 'dq-card-scene' }, card),
    acts,
    h('div', { class: 'dq-quest-alt' }, look),
    note,
    h('p', { class: 'dq-quest-foot', text: typo(QUEST.foot) }),
    aside,
  );
  const sync = () => {
    if (!open && st.state.flags.cardDay === today) {
      open = true;
      card.classList.add('is-open');
      card.setAttribute('aria-label', openLabel);
      go.classList.remove('is-hidden');
      fade(card, ...shown(2));
    }
    if (!done && practised()) {
      done = true;
      section.classList.add('is-done');
      note.textContent = typo(QUEST.done);
      go.classList.replace('dq-btn--primary', 'dq-btn--quiet');
    }
    const on = st.questAside();
    if (on === section.classList.contains('is-aside')) return;
    const had = section.contains(document.activeElement) ? document.activeElement : null;
    section.classList.toggle('is-aside', on);
    fade(...shown(1));
    if (had && !had.getClientRects().length) (on ? asideText : card).focus({ preventScroll: true });
  };
  const setAside = (on: boolean) => {
    st.setQuestAside(on);
    sync();
    (on ? aside : card).scrollIntoView({ block: 'nearest', behavior: app.reduced() ? 'auto' : 'smooth' });
    (on ? asideText : card).focus({ preventScroll: true });
  };
  return { el: section, sync };
}

function checkinPanel(app: App) {
  const st = app.store;
  const body = h('div', { class: 'dq-checkin-body' });
  const el = panel({ title: 'Check-in', ic: icon('checkin'), cls: 'dq-checkin', label: 'Check-in' }, body);
  const fade = () => animate(body, [{ opacity: 0 }, { opacity: 1 }], { duration: app.reduced() ? 150 : 380 });
  const ask = () => {
    body.replaceChildren(
      h('p', { class: 'dq-text dq-ask', text: typo(CHECKIN.ask) }),
      h(
        'div',
        { class: 'dq-opts dq-opts--wrap dq-feels' },
        FEELINGS.map((f) => chip(f, () => answer(f))),
      ),
    );
  };
  /** After a heavy check-in today: no question, no task, a door left open. */
  const after = () => {
    body.replaceChildren(
      h('p', { class: 'dq-lead dq-after' }, CHECKIN.after.map((l) => h('span', { text: typo(l) }))),
      h('div', { class: 'dq-actions dq-actions--end' }, btn('Check in again', () => (ask(), fade()), { kind: 'link' })),
    );
  };
  const answer = (feel: Feeling) => {
    st.sync();
    const first = st.state.flags.checkinDay !== st.today();
    const ev = st.add('checkin', first ? 10 : 0, { data: { feel, level: null } });
    st.state.flags.checkinDay = st.today();
    st.save();
    const s0 = suggestFor(feel, null, st.quest().skill);
    // heavy: comfort comes first, on its own quiet screen, before any skill
    if (s0.heavy) return app.go({ name: 'ease', next: s0.next });
    app.sound('check');
    let level: number | null = null;
    const sug = h('div', { class: 'dq-suggest-wrap' });
    const render = () => {
      const s = suggestFor(feel, level, st.quest().skill);
      const alt = s.alt ? btn(s.alt.label, () => goNext(app, s.alt!.next), { kind: 'quiet' }) : null;
      const n = s.next;
      if (n.to === 'skill' && isSkillId(n.id)) {
        const sk = SKILL[n.id];
        sug.replaceChildren(
          h(
            'div',
            { class: `dq-suggest dq-mod-${sk.module}` },
            h('span', { class: 'dq-suggest-ic', html: glyph(sk.module) }),
            h('div', {}, h('div', { class: 'dq-suggest-name', text: typo(sk.sl) }), h('div', { class: 'dq-suggest-real', text: `${typo(sk.real)} · ${sk.minutes}` }), h('p', { class: 'dq-suggest-why', text: typo(s.why) })),
          ),
          h('div', { class: 'dq-actions' }, btn('Try it', () => goNext(app, n), { kind: 'primary' }), alt),
        );
        return;
      }
      const quiet = n.to === 'moment';
      sug.replaceChildren(
        h(
          'div',
          { class: 'dq-suggest dq-suggest--rest' },
          h('div', { class: 'dq-cat', html: catSVG(132) }),
          h('div', {}, h('div', { class: 'dq-suggest-name', text: quiet ? 'Give me a moment' : 'Stealth room' }), h('p', { class: 'dq-suggest-why', text: typo(s.why) })),
        ),
        h('div', { class: 'dq-actions' }, btn(quiet ? 'Open' : 'Go rest', () => goNext(app, quiet ? n : { to: 'rest' }), { kind: 'primary', ic: 'rest' }), alt),
      );
    };
    render();
    const strength = STRENGTH_FEELINGS.includes(feel)
      ? h('div', { class: 'dq-level' }, h('p', { class: 'dq-label', text: CHECKIN.level }), segmented('How strong', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], null, (v) => {
          level = typeof v === 'number' ? v : null;
          if (ev.data) ev.data.level = level;
          st.save();
          if (isHeavy(feel, level)) return app.go({ name: 'ease', next: suggestFor(feel, level, st.quest().skill).next });
          render();
        }, { allowClear: true, cls: 'dq-seg--10' }))
      : null;
    const s = suggestFor(feel, null, st.quest().skill);
    // Numb gets no label echoed back; the two newest answers get their own first line
    const lead = s.lead ?? (feel === 'Numb' ? CHECKIN.thanks : `${feel}. ${CHECKIN.thanks}`);
    body.replaceChildren(
      h('p', { class: 'dq-lead' }, h('span', { text: typo(lead) })),
      ...(strength ? [strength] : []),
      sug,
      h('div', { class: 'dq-actions dq-actions--end' }, btn('Check in again', () => (ask(), fade()), { kind: 'link' })),
    );
    fade();
  };
  if (app.hushed()) after();
  else ask();
  return el;
}

/** Home's top strip: the daily gift chest (opens only when tapped) and Give me a moment, next to the Safe Zone. */
let chestN = 0;
function chestSVG() {
  const n = ++chestN;
  return `<svg class="dq-chest-svg" viewBox="0 0 48 40" aria-hidden="true">
<defs><linearGradient id="dqcb${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a3e"/><stop offset="1" stop-color="#0a121e"/></linearGradient>
<radialGradient id="dqcg${n}" cx="50%" cy="60%" r="55%"><stop offset="0" stop-color="#ffe2a0" stop-opacity=".95"/><stop offset=".45" stop-color="#c9a45c" stop-opacity=".45"/><stop offset="1" stop-color="#c9a45c" stop-opacity="0"/></radialGradient></defs>
<ellipse class="dq-chest-glow" cx="24" cy="18" rx="22" ry="13" fill="url(#dqcg${n})"/>
<path d="M7.5 19.5h33v15c0 .8-.7 1.5-1.5 1.5H9c-.8 0-1.5-.7-1.5-1.5z" fill="url(#dqcb${n})" stroke="#c9a45c" stroke-width="1.4" stroke-linejoin="round"/>
<path d="M7.5 25.5h33" stroke="#c9a45c" stroke-opacity=".45" stroke-width="1"/>
<path d="M15.5 19.5V36M32.5 19.5V36" stroke="#c9a45c" stroke-opacity=".6" stroke-width="1.2"/>
<g class="dq-chest-lid"><path d="M7.5 19.5v-4.2c0-4.6 3.8-8.3 8.5-8.3h16c4.7 0 8.5 3.7 8.5 8.3v4.2z" fill="url(#dqcb${n})" stroke="#c9a45c" stroke-width="1.4" stroke-linejoin="round"/>
<path d="M15.5 7.4v12.1M32.5 7.4v12.1" stroke="#c9a45c" stroke-opacity=".6" stroke-width="1.2"/><path class="dq-chest-shine" d="M11 12.5q2-3.6 6-3.9" stroke="#f3dca6" stroke-opacity=".7" stroke-width="1.1" fill="none" stroke-linecap="round"/></g>
<path class="dq-chest-lock" d="M24 16.6l2.9 3.4-2.9 3.4-2.9-3.4z" fill="#e6f1ff" stroke="#c9a45c" stroke-width="1"/>
<path class="dq-chest-spark" d="M42.5 2.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="#f6e2b0"/>
</svg>`;
}

function lobby(app: App, giftLine: HTMLElement) {
  const st = app.store;
  const today = st.today();
  const sub = h('span', { class: 'dq-chest-s' });
  const chest = h('button', { type: 'button', class: 'dq-chest' }, h('span', { class: 'dq-chest-art', html: chestSVG() }), h('span', { class: 'dq-chest-txt' }, h('span', { class: 'dq-chest-t', text: 'Daily gift' }), sub));
  const sync = () => {
    const open = st.state.flags.giftDay === today;
    chest.classList.toggle('is-open', open);
    chest.classList.remove('is-opening');
    chest.setAttribute('aria-label', open ? 'Daily gift, opened. Read it again.' : 'Daily gift. Tap to open.');
    sub.textContent = open ? CHECKIN.gift.open : CHECKIN.gift.closed;
    giftLine.classList.toggle('is-hidden', !open);
  };
  let busy = false;
  chest.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const first = st.state.flags.giftDay !== today;
    if (first) {
      chest.classList.add('is-opening');
      await wait(app.reduced() ? 0.05 : 0.55);
    }
    try {
      if (chest.isConnected) await app.openGift();
    } finally {
      busy = false;
      sync();
      if (first && !giftLine.classList.contains('is-hidden')) animate(giftLine, app.reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: app.reduced() ? WINDOW.reducedFadeMs : 600, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  });
  sync();
  const moment = h(
    'button',
    { type: 'button', class: 'dq-momentbtn', onclick: () => app.go({ name: 'moment' }) },
    h('span', { class: 'dq-momentbtn-ring', 'aria-hidden': 'true' }),
    h('span', { class: 'dq-momentbtn-t', text: 'Give me a moment' }),
  );
  return h('div', { class: 'dq-lobby' }, chest, moment);
}

function menu(app: App) {
  const n = app.store.derived().collection.size;
  const items: [string, string, string, () => void][] = [
    ['rest', 'Stealth', 'Unseen. No task.', () => app.go({ name: 'rest' })],
    ['shadows', 'Shadows', n ? `${n + 1} allies` : 'Your first shadow', () => app.go({ name: 'shadows' })],
    ['book', 'Skills', 'All of them, any time', () => app.go({ name: 'library' })],
    ['diary', 'Diary card', 'Optional', () => app.go({ name: 'diary' })],
    ['comfort', 'Comfort', 'Your own lists', () => app.go({ name: 'comfort' })],
    ['settings', 'Settings', 'Your name, sound, backup', () => app.go({ name: 'settings' })],
  ];
  const artThumb = h('span', { class: 'dq-tile-thumb', 'aria-hidden': 'true' });
  void artStore(app.store.key)
    .list()
    .then((list) => {
      if (list[0]) artThumb.replaceChildren(thumbImg(app, list[0], ''));
      else artThumb.remove();
      const allies = list.filter((m) => m.kind === 'ally').length;
      if (allies) shadowsSub.textContent = `${n + 1 + allies} allies`;
    });
  const art = h(
    'button',
    { type: 'button', class: 'dq-tile dq-tile--art', onclick: () => app.go({ name: 'art' }) },
    h('span', { class: 'dq-tile-ic', html: icon('brush') }),
    h('span', { class: 'dq-tile-t', text: 'Art room' }),
    h('span', { class: 'dq-tile-s', text: typo(todayPrompt(app)) }),
    artThumb,
  );
  const storySub = h('span', { class: 'dq-tile-s dq-tile-story', text: 'Start your first story' });
  const story = h(
    'button',
    { type: 'button', class: 'dq-tile dq-tile--story', onclick: () => app.go({ name: 'stories' }) },
    h('span', { class: 'dq-tile-ic', html: icon('quill') }),
    h('span', { class: 'dq-tile-t', text: 'Story Room' }),
    storySub,
  );
  void storyStore(app.store.key)
    .list()
    .then((list) => {
      if (!list[0]) return;
      storySub.textContent = list[0].title.trim() || 'Untitled story';
      storySub.classList.add('is-title');
    })
    .catch(() => undefined);
  const tiles = items.map(([ic, t, sub, fn]) => h('button', { type: 'button', class: 'dq-tile', onclick: fn }, h('span', { class: 'dq-tile-ic', html: icon(ic) }), h('span', { class: 'dq-tile-t', text: t }), h('span', { class: 'dq-tile-s', text: typo(sub) })));
  const shadowsSub = tiles[1].querySelector<HTMLElement>('.dq-tile-s')!;
  return h('nav', { class: 'dq-menu', 'aria-label': 'Places' }, art, story, tiles);
}

export function hubScreen(app: App): ScreenOut {
  const gift = h('p', { class: 'dq-gift' }, h('span', { class: 'dq-gift-k', text: 'Daily gift' }), h('span', { class: 'dq-gift-t', html: md(app.store.giftLine()) }));
  const quest = questSection(app);
  const el = h(
    'div',
    { class: 'dq-hub' },
    h('h1', { class: 'dq-sr', text: 'The Lantern' }),
    h('div', { class: 'dq-col dq-col--t' }, lobby(app, gift)),
    h('div', { class: 'dq-hcol dq-hcol--m' }, h('div', { class: 'dq-col dq-col--b' }, quest.el), h('div', { class: 'dq-col dq-col--g' }, gift), h('div', { class: 'dq-col dq-col--l' }, linePanel(app))),
    h('div', { class: 'dq-hcol dq-hcol--l' }, h('div', { class: 'dq-col dq-col--a' }, statusPanel(app))),
    h('div', { class: 'dq-hcol dq-hcol--r' }, h('div', { class: 'dq-col dq-col--c' }, checkinPanel(app)), h('div', { class: 'dq-col dq-col--m' }, menu(app))),
  );
  const off = app.store.onChange(quest.sync);
  return { el, title: 'The Lantern', mode: 'hub', bubbles: [2.4, 0.75], leave: () => void off() };
}
