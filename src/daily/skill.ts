import { animate } from '../ui/anim';
import { LOADOUT_COPY, MODULES, SKILL, type Answers, type Go, type Opt, type Step, type Txt } from '../content/dbt';
import { SKILL_END } from '../content/daily-lines';
import type { App, Place, Route, ScreenOut, Visit } from './app';
import { glyph, icon } from './art';
import { isSkillId, uid } from './store';
import { dropDraft, keepDraft, newestDraft, stepLayout, worthKeeping, type SkillDraft } from './skilldraft';
import { btn, chip, copyText, field, h, md, p, panel, segmented, typo } from './ui';
import { breathRing, coolChoice, counter, holdButton, loadoutArt, pmrView, timerView, type Ctx } from './widgets';

const tx = (t: Txt | undefined, a: Answers) => (t === undefined ? '' : typeof t === 'function' ? t(a) : t);
/** Long option labels read better as a stacked menu; short ones (Yes, Same, 5 min) stay inline. */
const stackable = (labels: string[]) => labels.some((l) => l.length > 18) || (labels.length >= 3 && labels.reduce((n, l) => n + l.length, 0) / labels.length > 11);

/**
 * What a skill visit keeps when the player leaves it with Back or Forward, in memory (never in history). Coming back
 * to the visit puts it all back, so nothing typed is lost and nothing is credited twice.
 */
export interface SkillKept {
  answers: Answers;
  /** per step, each field's [value as drawn, value as left]; put back only when the step draws the same value again */
  typed: Record<number, [string, string][]>;
  /** the end's "did this help" answer, so the end shows it answered */
  fed: string | null;
  /** the line shown above a step (a reply, "Saved on this device."), so it shows there again */
  leads: Record<number, string>;
  /** steps last left by going on from them: shown again going forward (Make the step smaller), they start empty */
  done: number[];
  /** the skill reached its end: nothing of this visit is kept on the device any more */
  ended: boolean;
}

/** Handed to the visit Start over opens: the same practice begun again, already credited when it was opened. */
const STARTED_OVER = Symbol('started over');
const PRACTISE_AGAIN = Symbol('practise again');

export function skillScreen(app: App, route: Route, visit: Visit): ScreenOut {
  const r = route as Extract<Route, { name: 'skill' }>;
  const sk = SKILL[isSkillId(r.id) ? r.id : 'wise-mind'];
  const mod = MODULES[sk.module];
  // opening a skill is practice: credited now, even if the player leaves on the first screen; coming back is not a second open
  if (!visit.again && visit.handed !== STARTED_OVER) app.store.skillEvent(sk.id);
  const kept = visit.again ? (visit.kept as SkillKept | undefined) : undefined;
  const part = r.entry && sk.steps.some((s) => s.id === r.entry) ? r.entry : '';
  const resumed = kept || visit.handed === STARTED_OVER || visit.handed === PRACTISE_AGAIN ? null : newestDraft(app.store.key, sk.id, part);
  const draft = resumed?.draft;
  const layout = stepLayout(sk.steps);
  const from = kept ?? draft;
  const answers: Answers = { ...from?.answers };
  const typed: SkillKept['typed'] = { ...from?.typed };
  const leads: SkillKept['leads'] = { ...from?.leads };
  const done = new Set(from?.done);
  let fed = kept?.fed ?? null;
  /** this visit's typed text is kept on the device: not once the skill has ended or the player starts over */
  let drafting = !kept?.ended;
  /** the player is going on from the step on screen (not Back, Forward or leaving the skill) */
  let going = false;
  /** showing a place again for Back or Forward: it isn't marked, chimes or asks again */
  let replaying = false;
  /** the Safe Zone is opening over this skill (or the game's data is being cleared): what it stops stops quietly */
  let hushed = false;
  const stops: (() => void)[] = [];
  const ctx: Ctx = { sound: (c) => app.sound(c), reduced: () => app.reduced(), onMotion: (fn) => app.onMotion(fn), buzz: (k) => app.buzz(k) };
  const stepsById = new Map<string, number>();
  sk.steps.forEach((s, i) => s.id && stepsById.set(s.id, i));

  const chipHead = h('header', { class: 'dq-chip' }, h('span', { class: 'dq-chip-ic', html: glyph(sk.module) }), h('h2', { class: 'dq-chip-t', text: typo(sk.sl) }), h('span', { class: 'dq-chip-sub', text: typo(sk.real) }));
  /** The header says "Quest complete" on the end only: Back to a step shows the skill's own name again. */
  const complete = (on: boolean) => {
    chipHead.querySelector('.dq-chip-t')!.textContent = on ? 'Quest complete' : typo(sk.sl);
    chipHead.querySelector('.dq-chip-sub')?.classList.toggle('is-hidden', on);
    chipHead.querySelector('.dq-chip-ic')!.innerHTML = on ? icon('check') : glyph(sk.module);
    box.classList.toggle('is-complete', on);
  };
  const body = h('div', { class: 'dq-step-body' });
  const box = panel({ cls: `dq-stepbox dq-mod-${sk.module}` }, chipHead, body);
  const el = h('div', { class: 'dq-skill' }, h('h1', { class: 'dq-sr', text: `${sk.sl}: ${sk.real}` }), box);
  let lead = '';
  let idx = -1;
  /** the step's fields as drawn, so what was typed in them comes back with the step */
  let drawn: [HTMLInputElement | HTMLTextAreaElement, string][] = [];
  /** the step `drawn` was drawn for: its fields are only ever read back into that step */
  let drawnAt = -1;
  const snap = () => {
    if (idx !== drawnAt || idx < 0 || idx >= sk.steps.length) return;
    const t = drawn.map(([f, was]): [string, string] => [was, f.value]);
    if (t.some(([was, now]) => was !== now)) typed[idx] = t;
    else if (!typed[idx]?.every(([, value], k) => value === drawn[k]?.[0].value)) delete typed[idx];
  };

  const clear = () => {
    snap();
    if (idx >= 0) {
      if (going) done.add(idx);
      else done.delete(idx);
    }
    going = false;
    stops.splice(0).forEach((f) => f());
    el.classList.remove('is-dim');
  };

  const snapshot = (): SkillDraft => ({ skill: sk.id, part, at: idx, layout, answers, typed, leads, done: [...done], t: draft?.t ?? 0 });
  const words = () => JSON.stringify([answers, typed]);
  let lastWords = words();
  let restoring = false;
  const persist = () => {
    if (!drafting || restoring || idx < 0 || idx >= sk.steps.length) return;
    snap();
    const now = words();
    const changed = now !== lastWords;
    lastWords = now;
    if (worthKeeping(sk.steps, answers, typed)) keepDraft(app.store.key, snapshot(), changed);
    else dropDraft(app.store.key, snapshot(), resumed);
  };
  const drop = () => {
    snap();
    drafting = false;
    dropDraft(app.store.key, snapshot(), resumed);
  };
  el.addEventListener('input', persist);

  const follow = (go: Go | undefined, fallbackNext: number): void => {
    going = true;
    if (go === 'end') return showEnd();
    if (go === 'end:quiet') return showEnd(true);
    if (go === 'safe') return app.go({ name: 'safe' });
    if (go === 'safe:people') return app.go({ name: 'safe', at: 'talk' });
    if (go?.startsWith('skill:')) {
      const [id, entry] = go.slice(6).split('@');
      return app.go({ name: 'skill', id, entry }, { replace: true });
    }
    if (go && stepsById.has(go)) return show(stepsById.get(go)!);
    if (fallbackNext >= sk.steps.length) return showEnd();
    return show(fallbackNext);
  };

  const swap = (...kids: (Node | null)[]) => {
    body.replaceChildren(...kids.filter((k): k is Node => !!k));
    drawn = [...body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input:not([type=range]):not([type=checkbox]):not([type=radio])')].map((f) => [f, f.value]);
    drawnAt = idx;
    // what was typed comes back with the step (Back, Forward, or Back and then on again); a step shown again after the
    // player went on from it (Make the step smaller) starts empty
    restoring = true;
    drawn.forEach(([f, was], k) => {
      const t = replaying || !done.has(idx) ? typed[idx]?.[k] : undefined;
      if (!t || t[0] !== was || t[1] === was) return;
      f.value = t[1];
      f.closest<HTMLElement>('.is-hidden')?.classList.remove('is-hidden');
      f.dispatchEvent(new Event('input', { bubbles: true }));
    });
    restoring = false;
    animate(body, app.reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
      duration: app.reduced() ? 180 : 360,
      easing: 'cubic-bezier(.16,1,.3,1)',
    });
    const first = body.querySelector<HTMLElement>('[data-focus]');
    first?.setAttribute('tabindex', '-1');
    first?.focus({ preventScroll: true });
    app.root.scrollTo({ top: 0 });
    persist();
  };

  const optButtons = (opts: Opt[], onPick: (o: Opt) => void, grid = false) =>
    h(
      'div',
      { class: `dq-opts ${grid ? 'dq-opts--grid' : stackable(opts.map((o) => o.label)) ? 'dq-opts--stack' : ''}` },
      opts.map((o) => chip(o.label, () => onPick(o))),
    );

  const head = (s: Step) => {
    const kids: Node[] = [];
    if (!replaying) {
      if (lead) leads[idx] = lead;
      else delete leads[idx];
    }
    if (leads[idx]) kids.push(h('p', { class: 'dq-lead', text: typo(leads[idx]) }));
    lead = '';
    const title = tx(s.title, answers);
    if (title) kids.push(h('h3', { class: 'dq-step-t', 'data-focus': '', html: md(title) }));
    return kids;
  };
  const textEl = (t: string, focus: boolean) => {
    const e = p(t, 'dq-text dq-text--step');
    if (focus) e.setAttribute('data-focus', '');
    return e;
  };

  /** What a tier step ranks: the picks it ranks from, without "Not this time". */
  const tierItems = (s: Extract<Step, { kind: 'tier' }>) => {
    const from = answers[s.from];
    return (Array.isArray(from) ? from : typeof from === 'string' && from ? [from] : []).filter((x) => x !== 'Not this time');
  };

  function show(i: number): void {
    clear();
    idx = i;
    if (box.classList.contains('is-complete')) complete(false);
    const s = sk.steps[i];
    // a branch, or a tier step with nothing to rank, is passed straight through: never a place Back stops at
    if (s.kind !== 'branch' && !(s.kind === 'tier' && !tierItems(s).length) && !replaying) visit.mark(i);
    const next = () => follow(s.go, i + 1);
    const titled = !!tx(s.title, answers);
    switch (s.kind) {
      case 'branch':
        return follow(s.pick(answers), i + 1);
      case 'intro': {
        const art = loadoutArt(sk.art);
        return swap(
          sk.loadout ? h('p', { class: 'ca-loadtag' }, h('span', { class: 'ca-loadtag-k', text: LOADOUT_COPY.tag }), h('span', { text: typo(LOADOUT_COPY.sub) })) : null,
          art ? h('div', { class: `ca-art ca-art--${sk.art}`, 'aria-hidden': 'true', html: art }) : null,
          h(
            'div',
            { class: 'dq-intro' },
            h('div', { class: 'dq-intro-name', 'data-focus': '', text: typo(sk.sl) }),
            h('div', { class: 'dq-intro-real', text: typo(sk.real) }),
            h('div', { class: 'dq-intro-meta' }, h('span', { text: mod.name }), h('span', { text: sk.minutes }), h('span', { text: `${mod.statName} +1` })),
          ),
          p(s.text, 'dq-text dq-text--step'),
          s.small ? p(s.small, 'dq-small') : null,
          h('div', { class: 'dq-actions' }, btn(s.cta ?? 'Begin', () => follow(r.entry && stepsById.has(r.entry) && i === 0 ? r.entry : s.go, i + 1), { kind: 'primary' })),
        );
      }
      case 'say': {
        const opt = (o: Opt, kind: 'primary' | 'quiet') => btn(o.label, () => follow(o.go, i + 1), { kind });
        const [first, ...rest] = s.options ?? [];
        const peers = rest.filter((o) => o.instead);
        const acts = first
          ? h(
              'div',
              { class: 'dq-actions dq-actions--stack' },
              peers.length ? h('div', { class: 'dq-actions dq-actions--pair' }, [first, ...peers].map((o) => opt(o, 'primary'))) : opt(first, 'primary'),
              rest.filter((o) => !o.instead).map((o) => opt(o, 'quiet')),
            )
          : h('div', { class: 'dq-actions' }, btn(s.cta ?? 'Next', next, { kind: 'primary' }));
        return swap(...head(s), textEl(tx(s.text, answers), !titled), s.small ? p(s.small, 'dq-small') : null, acts);
      }
      case 'choice': {
        const opts = typeof s.options === 'function' ? s.options(answers) : s.options;
        if (s.multi) {
          const picked = new Set<string>(Array.isArray(answers[s.key]) ? (answers[s.key] as string[]) : []);
          const btns = opts.map((o) =>
            chip(
              o.label,
              (e) => {
                if (o.go) return follow(o.go, i + 1);
                const b = e.currentTarget as HTMLElement;
                if (picked.has(o.label)) picked.delete(o.label);
                else {
                  if (s.max && picked.size >= s.max) return;
                  picked.add(o.label);
                }
                b.setAttribute('aria-pressed', String(picked.has(o.label)));
                answers[s.key] = [...picked];
                persist();
              },
              o.go ? undefined : picked.has(o.label),
            ),
          );
          const otherBtn = s.other ? btn(s.other, () => { answers[s.key] = [s.other!]; next(); }, { kind: 'link' }) : null;
          return swap(...head(s), textEl(tx(s.text, answers), !titled), h('div', { class: `dq-opts ${s.grid ? 'dq-opts--grid' : ''}` }, btns), h('div', { class: 'dq-actions' }, btn('Next', next, { kind: 'primary' }), otherBtn));
        }
        const pick = (o: Opt) => {
          answers[s.key] = o.value ?? o.label;
          if (o.reply) lead = o.reply;
          follow(o.go ?? s.go, i + 1);
        };
        let other: HTMLElement | null = null;
        if (s.other) {
          const f = field(s.other, { placeholder: 'Type your own', hideLabel: true });
          const wrap = h('div', { class: 'dq-other is-hidden' }, f.el, h('div', { class: 'dq-actions' }, btn('Use this', () => {
            const v = f.input.value.trim();
            if (!v) return f.input.focus();
            answers[s.key] = v;
            follow(s.go, i + 1);
          }, { kind: 'primary' })));
          other = h('div', {}, h('div', { class: 'dq-actions' }, btn(s.other, () => {
            wrap.classList.remove('is-hidden');
            f.input.focus();
          }, { kind: 'link', ic: 'plus' })), wrap);
        }
        return swap(...head(s), textEl(tx(s.text, answers), !titled), s.small ? p(s.small, 'dq-small') : null, optButtons(opts, pick, s.grid), other);
      }
      case 'input': {
        const f = field(tx(s.text, answers), { placeholder: s.placeholder, lines: s.lines ?? 2, hideLabel: true, value: typeof answers[s.key] === 'string' ? (answers[s.key] as string) : '' });
        f.input.addEventListener('input', () => (answers[s.key] = f.input.value));
        const fills = s.fills?.length
          ? h(
              'div',
              { class: 'dq-opts dq-opts--fills' },
              s.fills.map((t) =>
                chip(t, () => {
                  const cur = f.input.value.trim();
                  f.input.value = cur && !cur.endsWith(t) ? `${cur} ${t}` : t;
                  answers[s.key] = f.input.value;
                  persist();
                  f.input.focus();
                }),
              ),
            )
          : null;
        const go = () => {
          answers[s.key] = f.input.value.trim();
          next();
        };
        return swap(
          ...head(s),
          textEl(tx(s.text, answers), !titled),
          f.el,
          fills,
          h('p', { class: 'dq-hint', text: 'Optional. Stays on this device.' }),
          h('div', { class: 'dq-actions' }, btn(s.cta ?? 'Next', go, { kind: 'primary' }), s.skip ? btn(s.skip, () => { answers[s.key] = ''; next(); }, { kind: 'quiet' }) : null),
        );
      }
      case 'slider': {
        const out = h('output', { class: 'dq-slider-v', text: '\u2013' });
        const id = `sl${uid()}`;
        const input = h('input', { type: 'range', min: s.min, max: s.max, step: 1, id, class: 'dq-range', 'aria-valuetext': 'Not set' });
        input.value = String(Math.round((s.min + s.max) / 2));
        input.classList.add('is-unset');
        const set = () => {
          const v = Number(input.value);
          answers[s.key] = v;
          input.classList.remove('is-unset');
          const word = s.words ? s.words[v - s.min] : String(v);
          out.textContent = word;
          input.setAttribute('aria-valuetext', word);
          input.style.setProperty('--pct', `${((v - s.min) / (s.max - s.min)) * 100}%`);
        };
        input.style.setProperty('--pct', '50%');
        input.addEventListener('input', set);
        input.addEventListener('change', set);
        if (typeof answers[s.key] === 'number') {
          input.value = String(answers[s.key]);
          set();
        }
        return swap(
          ...head(s),
          h('label', { for: id, class: 'dq-text dq-text--step', 'data-focus': titled ? null : '', html: md(tx(s.text, answers)) }),
          h('div', { class: 'dq-slider' }, out, input, s.ends ? h('div', { class: 'dq-slider-ends' }, h('span', { text: s.ends[0] }), h('span', { text: s.ends[1] })) : null),
          h('div', { class: 'dq-actions' }, btn('Next', next, { kind: 'primary' }), btn('Skip', () => { delete answers[s.key]; next(); }, { kind: 'quiet' })),
        );
      }
      case 'breath': {
        const ring = breathRing(ctx, { inhale: s.inhale, exhale: s.exhale, rounds: s.rounds, words: s.words });
        stops.push(ring.stop);
        const nextB = btn('Next', next, { kind: 'quiet' });
        let pace: HTMLElement | null = null;
        if (s.alt) {
          pace = segmented('Pace', ['a', 'b'], 'a', (v) => (v === 'b' ? ring.pattern(s.alt![0], s.alt![1]) : ring.pattern(s.inhale, s.exhale)), { labels: [`${s.inhale}/${s.exhale}`, `${s.alt[0]}/${s.alt[1]}`], cls: 'dq-seg--pace' });
        }
        return swap(...head(s), textEl(tx(s.text, answers), !titled), ring.el, pace ? h('div', { class: 'dq-pace' }, h('span', { class: 'dq-label', text: 'Pace, in/out' }), pace) : null, h('div', { class: 'dq-actions dq-actions--center' }, nextB));
      }
      case 'timer': {
        const secs = typeof s.seconds === 'function' ? s.seconds(answers) : s.seconds;
        const nextBtn = btn('Next', next, { kind: 'quiet' });
        const go = (o: Opt) => () => follow(o.go, i + 1);
        const peers = s.options?.filter((o) => o.instead).map((o) => btn(o.label, go(o), { kind: 'primary' })) ?? [];
        const tv = timerView(ctx, {
          seconds: secs,
          visual: s.visual,
          input: s.scene?.(answers),
          start: s.start,
          // every timer can take more time (principle 3): +15 s up to 30 s, +30 s above
          extend: secs <= 30 ? 15 : 30,
          peers,
          // with choices beside Start, Next sits below the countdown and has to show too
          reveal: peers.length ? nextBtn : undefined,
          big: s.big ? tx(s.big, answers) : undefined,
          onStart: s.dim ? () => el.classList.add('is-dim') : undefined,
          onDone: () => {
            el.classList.remove('is-dim');
            nextBtn.classList.remove('dq-btn--quiet');
            nextBtn.classList.add('dq-btn--primary');
          },
        });
        // leaving while it runs (Next, a choice, Back, closing the skill) skips the timer: the same soft double pulse as
        // its end, but not when the Safe Zone opens over it
        stops.push(() => {
          if (tv.running() && !hushed) ctx.buzz?.('end');
          tv.stop();
        });
        const alts = s.options?.filter((o) => !o.instead).map((o) => btn(o.label, go(o), { kind: 'link' })) ?? [];
        return swap(...head(s), textEl(tx(s.text, answers), !titled), s.small ? p(s.small, 'dq-small') : null, tv.el, h('div', { class: 'dq-actions dq-actions--center' }, nextBtn, ...alts));
      }
      case 'cool': {
        const nextBtn = btn('Next', next, { kind: 'quiet' });
        const cc = coolChoice(ctx, {
          reveal: nextBtn,
          onDone: () => {
            nextBtn.classList.remove('dq-btn--quiet');
            nextBtn.classList.add('dq-btn--primary');
          },
        });
        stops.push(() => {
          if (cc.running() && !hushed) ctx.buzz?.('end');
          cc.stop();
        });
        const alts = s.options?.map((o) => btn(o.label, () => follow(o.go, i + 1), { kind: 'link' })) ?? [];
        return swap(...head(s), cc.el, h('div', { class: 'dq-actions dq-actions--center' }, nextBtn, ...alts));
      }
      case 'hold': {
        const nextBtn = btn('Next', next, { kind: 'quiet' });
        const hb = holdButton(ctx, {
          seconds: s.seconds,
          label: s.label,
          done: s.done,
          tone: s.tone,
          onDone: () => {
            nextBtn.classList.replace('dq-btn--quiet', 'dq-btn--primary');
            nextBtn.focus({ preventScroll: true });
          },
        });
        stops.push(hb.stop);
        return swap(...head(s), textEl(tx(s.text, answers), !titled), hb.el, h('div', { class: 'dq-actions dq-actions--center' }, nextBtn));
      }
      case 'count': {
        const nextBtn = btn('Next', next, { kind: 'quiet' });
        const c = counter(ctx, { n: s.n, label: s.label, onDone: () => nextBtn.classList.replace('dq-btn--quiet', 'dq-btn--primary') });
        return swap(...head(s), textEl(tx(s.text, answers), !titled), c.el, h('div', { class: 'dq-actions dq-actions--center' }, nextBtn));
      }
      case 'pmr': {
        const nextBtn = btn('Next', next, { kind: 'quiet' });
        const v = pmrView(ctx, { rounds: s.rounds, onDone: () => nextBtn.classList.replace('dq-btn--quiet', 'dq-btn--primary') });
        stops.push(v.stop);
        return swap(...head(s), textEl(tx(s.text, answers), !titled), v.el, h('div', { class: 'dq-actions dq-actions--center' }, nextBtn));
      }
      case 'cards': {
        const track = h(
          'div',
          { class: 'dq-swipe', tabindex: 0, 'aria-label': 'Six cards, scroll sideways' },
          s.cards.map(([t, b], k) => h('article', { class: 'dq-mini' }, h('span', { class: 'dq-mini-n', text: `${k + 1} of ${s.cards.length}` }), h('h4', { class: 'dq-mini-t', text: typo(t) }), p(b, 'dq-mini-b'))),
        );
        return swap(...head(s), textEl(tx(s.text, answers), !titled), track, h('div', { class: 'dq-actions' }, btn('Next', next, { kind: 'primary' })));
      }
      case 'list': {
        const items = app.store.state.lists[s.list];
        const opts = items.length ? items.map((x) => x.text) : s.fallback;
        const f = field('Add one', { placeholder: 'Add one of your own', hideLabel: true });
        const pick = (v: string) => {
          answers[s.key] = v;
          app.sound('check');
          next();
        };
        return swap(
          ...head(s),
          textEl(tx(s.text, answers), !titled),
          items.length ? null : p(s.empty, 'dq-small'),
          h('div', { class: `dq-opts ${stackable(opts) ? 'dq-opts--stack' : ''}` }, opts.map((o) => chip(o, () => pick(o)))),
          h('div', { class: 'dq-addrow' }, f.el, btn('Add and pick', () => {
            const v = f.input.value.trim().slice(0, 200);
            if (!v) return f.input.focus();
            // Back brings the typed text back: Add and pick again picks the one saved, as the comfort list does
            const list = app.store.state.lists[s.list];
            if (!list.some((x) => x.text === v)) {
              list.push({ id: uid(), text: v, at: app.store.now() });
              app.store.save();
            }
            pick(v);
          }, { kind: 'quiet', ic: 'plus' })),
        );
      }
      case 'tier': {
        const items = tierItems(s);
        if (!items.length) return next();
        // ranks already given in this visit come back with the step
        const ranks: Record<string, string> = {};
        for (const x of Array.isArray(answers[s.key]) ? (answers[s.key] as string[]) : []) {
          const cut = x.indexOf('|');
          const [t, it] = [x.slice(0, cut), x.slice(cut + 1)];
          if (cut > 0 && s.tiers.includes(t) && items.includes(it)) ranks[it] = t;
        }
        const save = () => (answers[s.key] = items.filter((it) => ranks[it]).map((it) => `${ranks[it]}|${it}`));
        const rowsEl = items.map((it) =>
          h(
            'div',
            { class: 'dq-check ca-tier-row' },
            h('span', { class: 'dq-check-t', text: typo(it) }),
            segmented(it, s.tiers, ranks[it] ?? null, (v) => {
              if (v === null) delete ranks[it];
              else ranks[it] = String(v);
              save();
              persist();
            }, { allowClear: true, cls: 'dq-seg--3 ca-tier' }),
          ),
        );
        save();
        return swap(...head(s), textEl(tx(s.text, answers), !titled), h('div', { class: 'dq-checks ca-tiers' }, rowsEl), h('div', { class: 'dq-actions' }, btn('Lock it in', next, { kind: 'primary' })));
      }
      case 'checks': {
        const rowsEl = s.rows.map((rw) => h('div', { class: 'dq-check' }, h('span', { class: 'dq-check-t', text: typo(rw) }), segmented(rw, ['Yes', 'No', 'Skip'], null, () => {}, { allowClear: true, cls: 'dq-seg--3' })));
        return swap(...head(s), textEl(tx(s.text, answers), !titled), h('div', { class: 'dq-checks' }, rowsEl), h('div', { class: 'dq-actions' }, btn('Next', next, { kind: 'primary' })));
      }
      case 'draft': {
        const text = s.parts.map((k) => String(answers[k] ?? '').trim()).filter(Boolean).join(' ');
        const ta = field('Your draft', { value: text, lines: 6, placeholder: 'Your draft shows up here. You can edit it.' });
        const status = h('span', { class: 'dq-hint', 'aria-live': 'polite' });
        return swap(
          ...head(s),
          textEl(tx(s.text, answers), !titled),
          ta.el,
          h('div', { class: 'dq-actions' }, btn('Copy', async () => {
            status.textContent = (await copyText(ta.input.value)) ? 'Copied. Nothing was sent.' : 'Select the text to copy it.';
          }, { kind: 'quiet', ic: 'copy' }), status),
          h('div', { class: 'dq-actions' }, btn('Next', next, { kind: 'primary' })),
        );
      }
      case 'map': {
        const cell = (k: string, t: string) => h('div', { class: 'dq-map-c' }, h('span', { class: 'dq-map-k', text: t }), h('span', { class: 'dq-map-v', text: typo(String(answers[k] || '\u2013')) }));
        return swap(
          ...head(s),
          answers.urge ? h('p', { class: 'dq-small', text: typo(`The urge: ${answers.urge}`) }) : null,
          h('div', { class: 'dq-map' }, cell('p1', 'Act on it: good now'), cell('c1', 'Act on it: costs later'), cell('p2', 'Ride it out: good later'), cell('c2', 'Ride it out: hard part')),
          textEl(tx(s.text, answers), !titled),
          optButtons(s.options, (o) => {
            answers.mapChoice = o.value ?? o.label;
            follow(o.go, i + 1);
          }),
        );
      }
      case 'highlight': {
        const f = field('Your message', { lines: 4, placeholder: 'Paste or type a message (optional)' });
        const preview = h('div', { class: 'dq-hl', 'aria-live': 'polite' });
        const words = s.words.slice().sort((a, b) => b.length - a.length);
        const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['\u2019]")).join('|')})`, 'gi');
        // opt-in only: nothing the player types is looked at until the player asks for it
        const render = () => {
          const v = f.input.value;
          if (!v.trim()) return preview.replaceChildren(h('p', { class: 'dq-hl-n', text: 'Paste or type a message first. Only if you want to.' }));
          const parts = v.split(re);
          const found = parts.filter((_, k) => k % 2 === 1).length;
          preview.replaceChildren(
            h('p', { class: 'dq-hl-n', text: found ? `Marked: ${found} you could drop. Keep any you mean.` : 'Nothing extra in this one.' }),
            h('p', { class: 'dq-hl-text' }, parts.map((t, k) => (k % 2 ? h('mark', { text: t }) : t))),
          );
        };
        f.input.addEventListener('input', () => {
          answers[s.key] = f.input.value;
          preview.replaceChildren();
        });
        const status = h('span', { class: 'dq-hint', 'aria-live': 'polite' });
        return swap(
          ...head(s),
          textEl(tx(s.text, answers), !titled),
          f.el,
          h('div', { class: 'dq-actions' }, btn('Want to see a version without the extra sorry?', render, { kind: 'link', cls: 'ca-hl-ask' })),
          preview,
          h('div', { class: 'dq-actions' }, btn('Copy', async () => {
            status.textContent = (await copyText(f.input.value)) ? 'Copied. Nothing was sent.' : 'Select the text to copy it.';
          }, { kind: 'quiet', ic: 'copy' }), status),
          h('div', { class: 'dq-actions' }, btn('Next', next, { kind: 'primary' })),
        );
      }
      case 'save': {
        const save = () => {
          const st = app.store;
          if (s.effect === 'saveSoothe') {
            const v = String(answers.soothe ?? '').trim();
            if (v && !st.state.lists.comfort.some((c) => c.text === v)) st.state.lists.comfort.push({ id: uid(), text: v, at: st.now() });
          } else if (s.effect === 'saveMap') {
            const g = (k: string) => String(answers[k] ?? '').slice(0, 2000);
            const m = { urge: g('urge'), p1: g('p1'), c1: g('c1'), p2: g('p2'), c2: g('c2'), choice: g('mapChoice') };
            // Back to this step and Save again keeps the map already saved, as the comfort list does
            if (!st.state.maps.some((x) => x.urge === m.urge && x.p1 === m.p1 && x.c1 === m.c1 && x.p2 === m.p2 && x.c2 === m.c2 && x.choice === m.choice)) st.state.maps.push({ id: uid(), t: st.now(), ...m, at: st.now() });
          }
          st.save();
          app.sound('check');
          lead = st.saving ? 'Saved on this device.' : "Kept for this visit. This device isn't saving right now.";
          next();
        };
        return swap(...head(s), textEl(tx(s.text, answers), !titled), h('div', { class: 'dq-actions' }, btn(s.yes, save, { kind: 'primary' }), btn(s.no, next, { kind: 'quiet' })));
      }
    }
  }

  function showEnd(quiet = false) {
    clear();
    idx = sk.steps.length;
    // finished: what was typed is kept no longer (an end shown again by Back or Forward leaves a newer visit's alone)
    if (replaying) drafting = false;
    else drop();
    if (!replaying) visit.mark(quiet ? 'end:quiet' : 'end');
    if (!quiet) {
      complete(true);
      if (!replaying) app.sound('soft_chime');
    }
    const reply = h('p', { class: 'dq-lead', 'aria-live': 'polite' });
    // a quiet end is the player saying "not now", so it doesn't offer a repeat; a repeat opens the same part they opened
    const again = quiet ? null : btn('Practise again', () => app.go({ name: 'skill', id: sk.id, entry: r.entry }, { replace: true, hand: PRACTISE_AGAIN }), { kind: 'quiet' });
    const after = h('div', { class: 'dq-after is-hidden' }, h('div', { class: 'dq-actions dq-actions--stack' }, btn('Back to the Lantern', () => app.go({ name: 'hub' }), { kind: 'primary' }), again, btn('Another skill', () => app.go({ name: 'library' }, { replace: true }), { kind: 'quiet' })));
    const answered = (a: string) => {
      reply.textContent = typo(SKILL_END.thanks[a]);
      ask.classList.add('is-hidden');
      after.classList.remove('is-hidden');
    };
    const answer = (a: string) => {
      app.store.add('feedback', 0, { skill: sk.id, data: { answer: a } });
      fed = a;
      answered(a);
      after.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    };
    const ask = h(
      'div',
      { class: 'dq-feedback' },
      h('p', { class: 'dq-text', text: typo(SKILL_END.ask) }),
      h('div', { class: 'dq-opts' }, ['Yes', 'A little', 'Not this time'].map((a) => chip(a, () => answer(a)))),
      h('div', { class: 'dq-actions dq-actions--end' }, btn('Skip', () => answer('Skip'), { kind: 'link' })),
    );
    if (quiet) after.classList.remove('is-hidden');
    else if (fed) answered(fed);
    swap(
      h('div', { class: 'dq-intro dq-intro--end' }, h('div', { class: 'dq-intro-name', 'data-focus': '', text: typo(sk.sl) }), h('div', { class: 'dq-intro-real', text: typo(sk.real) })),
      quiet ? h('p', { class: 'dq-text ca-quietend', text: typo(sk.loadout ? 'Not this time is a real answer. The move stays in your loadout.' : 'Not this time is a real answer. It keeps for another day.') }) : h('p', { class: 'dq-gain' }, h('span', { text: `${mod.statName} +1` }), h('span', { text: '+20 XP' })),
      quiet ? null : ask,
      reply,
      after,
    );
  }

  return {
    el,
    title: `${sk.sl}`,
    mode: 'skill',
    bubbles: [1.6, 0.6],
    leave: () => {
      clear();
      persist();
    },
    silence: () => {
      hushed = true;
    },
    // a revisit opens where the player was; a new visit, or one with no place yet, starts and marks the first step.
    // A new visit to a skill left with something typed opens where the player left it, with a way to start over.
    after: () => {
      if (visit.again || !draft) return open(visit.at, visit.again && visit.at !== undefined);
      open(draft.at < 0 ? undefined : draft.at, true);
      visit.mark(idx);
      body.prepend(
        h(
          'p',
          { class: 'dq-lead' },
          h('span', { text: 'Picking up where you left off.' }),
          btn('Start over', () => {
            drop();
            app.go({ name: 'skill', id: sk.id, entry: r.entry }, { replace: true, hand: STARTED_OVER });
          }, { kind: 'link' }),
        ),
      );
    },
    moveTo: (place) => open(place, true),
    keep: (): SkillKept => {
      snap();
      return { answers: { ...answers }, typed: { ...typed }, fed, leads: { ...leads }, done: [...done], ended: !drafting };
    },
  };

  /** Shows a place of this visit: a step number, 'end' or 'end:quiet'; none is where the skill starts. */
  function open(place: Place | undefined, replay: boolean) {
    replaying = replay;
    try {
      if (place === 'end' || place === 'end:quiet') showEnd(place === 'end:quiet');
      else if (typeof place === 'number' && sk.steps[place]) show(place);
      else if (r.entry && stepsById.has(r.entry) && sk.steps[0].kind !== 'intro') show(stepsById.get(r.entry)!);
      else show(0);
    } finally {
      replaying = false;
    }
  }
}
