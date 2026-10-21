/**
 * ?lab=daily mounts the companion into #ui with its own fresh store (never the real one).
 *   &seed=demo|rankup|gap|full   preload progress for screenshots (default: a brand-new player)
 *   &nogreet                      skip today's Lantern window
 *   &screen=hub|rest|shadows|library|diary|comfort|settings|safe|skill:<id>[@entry]|art|draw:today|draw:ally|lines|stories|write:<storyId>[@chapterId]
 *   &days=N                       move the clock N days ahead (day turnover tests)
 *   &hour=H                       pretend it is H o'clock local today (4 AM turnover tests)
 *   &keep                         keep the lab store between reloads
 *   &art                          art sheet (moth, cat, crystal)
 */
import type { Stage } from '../core/stage';
import { useRealClock } from '../ui/anim';
import { catSVG, crystalSVG, mothSVG } from '../daily/art';
import { mountDaily } from '../daily';
import type { Route } from '../daily/app';
import { SKILLS } from '../content/dbt';
import { TODAY_LINES } from '../content/daily-lines';
import { addDays, dayKey, freshState, rankFor, type Ev, type State } from '../daily/store';

const KEY = 'dbt.lantern.lab';

function seedState(kind: string, now: number): State {
  const s = freshState(now - 40 * 86400e3);
  const today = dayKey(now);
  let n = 0;
  const ev = (day: string, k: Ev['k'], xp: number, extra: Partial<Ev> = {}) => s.events.push({ id: `seed${n++}`, t: now - 86400e3 * 3, day, k, xp, ...extra });
  const statOf = (id: string) => ({ mind: 'sense', dt: 'stamina', er: 'intelligence', ie: 'agility' } as const)[SKILLS.find((k) => k.id === id)!.module];
  if (kind === 'demo' || kind === 'full') {
    const days = kind === 'full' ? 120 : 14;
    const order = ['wise-mind', 'tipp', 'name-emotion', 'self-soothe', 'self-validation', 'stop', 'sense-up', 'abc-please', 'willing-hands', 'give', 'mana-tide', 'accepts', 'clear-sight', 'check-facts', 'improve', 'validation', 'opposite-action', 'urge-surf', 'fast', 'pros-cons', 'radical-acceptance', 'dear-man'];
    for (let i = days; i >= 1; i--) {
      if (kind === 'demo' && (i === 9 || i === 10)) continue;
      const d = addDays(today, -i);
      ev(d, 'visit', 10);
      const id = order[(days - i) % order.length];
      ev(d, 'card', 0, { skill: id });
      ev(d, 'skill', 20, { stat: statOf(id), skill: id });
      ev(d, 'feedback', 0, { skill: id, data: { answer: i % 3 ? 'A little' : 'Yes' } });
      if (i % 2) ev(d, 'checkin', 10, { data: { feel: ['Calm', 'Tired', 'Anxious', 'Okay'][i % 4], level: 4 } });
      if (i % 3 === 0) ev(d, 'skill', 20, { stat: 'stamina', skill: 'tipp' });
      if (i <= 6 && i !== 3) {
        ev(d, 'diary', 10);
        s.diary[d] = { day: d, emotions: { Sadness: (i * 2) % 5, 'Fear or anxiety': (i + 1) % 4, Anger: i % 2, Shame: i === 4 ? 2 : null, Joy: (i % 3) + 1 }, urges: { 'Urge to give up on today': i % 3 }, note: i === 2 ? 'Long day. TIPP before bed helped.' : '', updatedAt: now - i * 86400e3 };
      }
      s.flags.cardDay = d;
      s.flags.giftDay = d;
      s.flags.greetDay = d;
    }
    s.lists.comfort = [{ id: 'c1', text: 'Oversized hoodie' }, { id: 'c2', text: 'Lo-fi rain playlist' }, { id: 'c3', text: 'A hot shower' }];
    s.lists.activities = [{ id: 'a1', text: 'A cosy game run' }, { id: 'a2', text: 'One episode of something comfy' }, { id: 'a3', text: 'Draw for ten minutes' }];
    s.lists.reasons = [{ id: 'r1', text: 'The next season of the show' }, { id: 'r2', text: 'Mornings with nowhere to be' }];
    s.lists.people = [{ id: 'p1', name: 'A friend', phone: '+1 555 0100' }];
    const picks = [TODAY_LINES.mid[0], TODAY_LINES.low[1], TODAY_LINES.up[5], TODAY_LINES.mid[9], TODAY_LINES.low[13], TODAY_LINES.up[2]];
    picks.forEach((l, k) => {
      const d = addDays(today, -(1 + k * 2));
      s.lines.push({ day: d, id: l.id, tag: l.tag, text: l.text, t: now - (1 + k * 2) * 86400e3 });
      ev(d, 'line', 5, { data: { id: l.id } });
    });
    s.lines.sort((a, b) => (a.day < b.day ? -1 : 1));
    s.maps = [{ id: 'm1', t: now - 5 * 86400e3, urge: 'Send the long message at 3 AM', p1: 'Relief right now', c1: 'Feeling exposed tomorrow', p2: 'Saying it calmly, my way', c2: 'Sitting with it tonight', choice: 'ride' }];
  } else if (kind === 'rankup') {
    for (let i = 3; i >= 1; i--) {
      const d = addDays(today, -i);
      ev(d, 'visit', 10);
      ev(d, 'skill', 20, { stat: 'stamina', skill: 'tipp' });
      ev(d, 'checkin', i === 1 ? 5 : 10);
      s.flags.greetDay = d;
      s.flags.giftDay = d;
    }
  } else if (kind === 'gap') {
    for (let i = 52; i >= 47; i--) {
      const d = addDays(today, -i);
      ev(d, 'visit', 10);
      ev(d, 'skill', 20, { stat: 'sense', skill: 'wise-mind' });
      s.flags.greetDay = d;
    }
  }
  const xp = s.events.reduce((a, e) => a + e.xp, 0);
  s.flags.rankSeen = kind === 'rankup' ? 0 : rankFor(xp);
  return s;
}

export function lab(stage: Stage) {
  const q = new URLSearchParams(location.search);
  const ui = document.getElementById('ui')!;
  (window as unknown as { __lab: unknown }).__lab = { stage };
  if (q.has('art')) {
    ui.style.pointerEvents = 'auto';
    ui.innerHTML = `<div style="position:fixed;inset:0;background:#07080f;display:flex;flex-wrap:wrap;gap:40px;align-items:center;justify-content:center;padding:30px">
      <div style="background:#0b1322;padding:20px">${mothSVG({ size: 420 })}</div>
      <div style="background:#0b1322;padding:20px">${mothSVG({ size: 140, eye: 'open' })}${mothSVG({ size: 140, tone: 'lilac' })}${mothSVG({ size: 48 })}</div>
      <div style="background:#0b1322;padding:20px">${catSVG(360)}${catSVG(90)}</div>
      <div style="background:#0b1322;padding:20px">${crystalSVG(120)}</div>
    </div>`;
    return;
  }
  const shiftDays = Number(q.get('days') ?? 0);
  const hour = q.has('hour') ? Number(q.get('hour')) : null;
  const base = (() => {
    if (hour === null) return 0;
    const d = new Date();
    d.setHours(hour, 20, 0, 0);
    return d.getTime() - Date.now();
  })();
  const now = () => Date.now() + base + shiftDays * 86400e3;
  const seed = q.get('seed') ?? '';
  let initialState: State | undefined;
  if (!q.has('keep')) {
    localStorage.removeItem(KEY);
    for (const db of [`${KEY}.art`, `${KEY}.story`])
      try {
        indexedDB.deleteDatabase(db);
      } catch {
        /* no IndexedDB here */
      }
    for (const k of Object.keys(localStorage)) if (k.startsWith(`${KEY}.story`)) localStorage.removeItem(k);
    initialState = seed ? seedState(seed, now()) : undefined;
    if (initialState && q.has('nogreet')) {
      initialState.flags.greetDay = dayKey(now());
      initialState.flags.giftDay = dayKey(now());
      if (!initialState.events.some((e) => e.k === 'visit' && e.day === dayKey(now()))) initialState.events.push({ id: 'seedtoday', t: now(), day: dayKey(now()), k: 'visit', xp: 10 });
      initialState.flags.rankSeen = rankFor(initialState.events.reduce((a, e) => a + e.xp, 0));
    }
  }
  if (!initialState && q.has('nogreet') && !q.has('keep')) {
    initialState = freshState(now());
    initialState.flags.greetDay = dayKey(now());
    initialState.events.push({ id: 'seedtoday', t: now(), day: dayKey(now()), k: 'visit', xp: 10 });
  }
  const audio = { log: [] as string[], play(cue: string) { this.log.push(cue); } };
  const handle = mountDaily(ui, {
    onReplay: () => {
      (window as unknown as { __replayed: number }).__replayed = ((window as unknown as { __replayed?: number }).__replayed ?? 0) + 1;
    },
    sound: audio,
    storageKey: KEY,
    now,
    initialState,
  });
  const app = (window as unknown as { __daily: { go(r: Route): void; screens: Record<string, unknown> } }).__daily;
  const screen = q.get('screen');
  if (screen && Object.prototype.hasOwnProperty.call(app.screens, screen.split(':')[0])) {
    const [name, rest] = screen.split(':');
    if (name === 'skill') {
      const [id, entry] = (rest ?? 'wise-mind').split('@');
      app.go({ name: 'skill', id, entry });
    } else if (name === 'safe') app.go({ name: 'safe', at: rest });
    else if (name === 'draw') app.go({ name: 'draw', kind: rest === 'ally' ? 'ally' : 'today' });
    else if (name === 'write') {
      const [id, ch] = (rest ?? '').split('@');
      app.go({ name: 'write', id, ch: ch || undefined });
    }
    else app.go({ name } as Route);
  }
  (window as unknown as { __lab: unknown }).__lab = { stage, app, handle, audio };
  // the companion does not need the WebGL loop; stop it like the real app should (keep it with &stage or in capture mode)
  if (!q.has('stage') && !q.has('capture'))
    setTimeout(() => {
      stage.stop();
      useRealClock();
    }, 0);
}
