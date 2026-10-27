/**
 * Safe Zone: body first (breathing, squeeze and release, then optional cool air), then STOP, then their own lists, then
 * people and services. No XP, toasts, glows or sound effects in here. One calm link to people on every screen, and a
 * lights-up toggle beside the dim default.
 */
import { animate } from '../ui/anim';
import { SAFE } from '../content/dbt';
import { BESIDE } from '../core/stored-names';
import { write } from '../core/cleared';
import { REGIONS, regionById, regionFromLocale, type CrisisLine } from '../content/crisis-lines';
import type { App, Route, ScreenOut } from './app';
import { icon } from './art';
import { uid } from './store';
import { btn, chip, field, h, p, panel, typo } from './ui';
import { supportListsCopy } from './support-lists';
import { breathRing, pmrView, timerView, type Ctx } from './widgets';

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

export function smsHref(num: string, body?: string) {
  if (!body) return `sms:${num}`;
  return isIOS() ? `sms:${num}&body=${encodeURIComponent(body)}` : `sms:${num}?body=${encodeURIComponent(body)}`;
}
export const telHref = (num: string) => `tel:${num.replace(/[^\d+]/g, '')}`;

/** The country whose lines show: the player's choice, else the device language's country, else "Somewhere else". */
export const regionOf = (app: App) => regionById(app.store.state.settings.region || regionFromLocale(navigator.languages ?? [navigator.language]));

/** One native picker, so changing country is a single tap and never covers the call buttons. */
export function regionPicker(app: App, picked?: () => void, text = { label: SAFE.talk.country, hint: SAFE.talk.countryHint }) {
  const id = `dq-region-${uid()}`;
  const select = h('select', { id, class: 'dq-input dq-select' }, REGIONS.map((r) => h('option', { value: r.id, text: r.name })));
  select.value = regionOf(app).id;
  select.addEventListener('change', () => {
    const st = app.store;
    st.state.settings.region = regionById(select.value).id;
    st.touch('region');
    st.save();
    picked?.();
  });
  // a country picked in another open copy (the later change wins): this picker and its lines follow it
  const off = app.store.onChange(() => {
    if (!select.isConnected) return void off();
    const now = regionOf(app).id;
    if (now === select.value) return;
    select.value = now;
    picked?.();
  });
  return h('div', { class: 'dq-setting dq-setting--col dq-region' }, h('label', { for: id, class: 'dq-setting-l' }, h('span', { class: 'dq-setting-t', text: text.label }), h('span', { class: 'dq-setting-h', text: text.hint })), select);
}

type At = 'start' | 'breathe' | 'cold' | 'squeeze' | 'check' | 'stop' | 'reasons' | 'people' | 'comfort' | 'talk' | 'close';
const FLOW: At[] = ['start', 'breathe', 'squeeze', 'cold', 'check', 'stop', 'reasons', 'comfort', 'people', 'talk', 'close'];
const lightKey = (key: string) => `${key}${BESIDE.safeLight}`;
const readLight = (key: string) => {
  try {
    return localStorage.getItem(lightKey(key)) === 'up';
  } catch {
    return false;
  }
};

export function safeScreen(app: App, route: Route): ScreenOut {
  const r = route as Extract<Route, { name: 'safe' }>;
  const st = app.store;
  const ctx: Ctx = { sound: (c) => app.sound(c), reduced: () => app.reduced(), onMotion: (fn) => app.onMotion(fn) };
  const stops: (() => void)[] = [];
  let higher = false;
  let danger = false;
  const body = h('div', { class: 'dq-sz-body' });
  const talkLink = h('button', { type: 'button', class: 'dq-sz-talk', onclick: () => show('talk') }, h('span', { html: icon('phone') }), h('span', { text: 'Talk to someone now' }));
  const box = panel({ title: 'Safe Zone', ic: icon('safe'), cls: 'dq-sz' }, body);
  let lit = readLight(st.key);
  const lightBtn = h('button', { type: 'button', class: 'ca-sz-light', title: SAFE.light.hint }, h('span', { class: 'ca-sz-light-ic', 'aria-hidden': 'true' }), h('span', { class: 'ca-sz-light-t' }));
  const applyLight = () => {
    el.classList.toggle('is-lit', lit);
    app.root.classList.toggle('ca-szlit', lit);
    const said = lit ? SAFE.light.down : SAFE.light.up;
    lightBtn.querySelector('.ca-sz-light-t')!.textContent = said;
    // its name stays when a zoomed phone shows only the icon
    lightBtn.setAttribute('aria-label', said);
  };
  lightBtn.addEventListener('click', () => {
    lit = !lit;
    const light = lit ? 'up' : 'dim';
    write(() => {
      try {
        localStorage.setItem(lightKey(st.key), light);
      } catch {
        /* stays for this visit only */
      }
    });
    applyLight();
  });
  const foot = h('div', { class: 'dq-sz-foot' }, talkLink);
  // every screen starts at the top: one Tab from there reaches "Talk to someone now", wherever it shows
  const top = h('h1', { class: 'dq-sr', 'data-focus': '', text: 'Safe Zone' });
  // each step's heading is said politely as it shows
  const live = h('p', { class: 'dq-sr', role: 'status', 'aria-live': 'polite' });
  const el = h('div', { class: 'dq-safezone' }, top, foot, box, live);
  const say = (t: string) => {
    live.textContent = '';
    const id = setTimeout(() => (live.textContent = t), 100);
    stops.push(() => clearTimeout(id));
  };
  applyLight();

  const nextOf = (at: At) => FLOW[Math.min(FLOW.length - 1, FLOW.indexOf(at) + 1)];
  const clear = () => stops.splice(0).forEach((f) => f());
  /** `lead` is the screen's heading and words, `kids` what the player does; a phone held sideways shows them side by side. */
  const swap = (at: At, lead: (Node | null)[], ...kids: (Node | null)[]) => {
    const halves = [h('div', { class: 'dq-sz-lead' }, lead), h('div', { class: 'dq-sz-main' }, kids)];
    body.replaceChildren(...halves);
    talkLink.classList.toggle('is-hidden', at === 'talk');
    foot.classList.toggle('is-talk', at === 'talk');
    talkLink.classList.toggle('is-strong', (higher || danger) && at !== 'talk');
    // once it's higher, or they might not be safe, "Talk to someone now" moves above the screen for the rest of the visit
    if (higher || danger) foot.classList.add('is-top');
    // upright the body fades in; held sideways the body is display: contents, so its two halves fade instead
    for (const e of [body, ...halves]) animate(e, [{ opacity: 0 }, { opacity: 1 }], { duration: app.reduced() ? 160 : 520, easing: 'ease-out' });
    top.setAttribute('tabindex', '-1');
    top.focus({ preventScroll: true });
    say(body.querySelector('.dq-sz-t')?.textContent ?? '');
    // upright only the body scrolls, held sideways the whole page does
    body.scrollTo({ top: 0 });
    app.root.scrollTo({ top: 0 });
  };
  const h3 = (t: string) => h('h2', { class: 'dq-sz-t', 'data-focus': '', text: typo(t) });
  const nextBtn = (at: At, label = 'Next', kind: 'primary' | 'quiet' = 'primary') => btn(label, () => show(nextOf(at)), { kind });

  const listScreen = (at: 'reasons' | 'comfort', title: string, text: string | null, empty: string) => {
    const items = st.state.lists[at];
    const list = h('ul', { class: 'dq-sz-list' }, items.map((i) => h('li', { text: typo(i.text) })));
    const lists = supportListsCopy(app);
    stops.push(lists.dispose);
    const f = field('Add one', { placeholder: at === 'reasons' ? SAFE.reasons.add : 'Something that helps, even a little', hideLabel: true });
    const add = h('div', { class: 'dq-addrow is-hidden' }, f.el, btn('Save', () => {
      const v = f.input.value.trim();
      if (!v) return f.input.focus();
      st.state.lists[at].push({ id: uid(), text: v.slice(0, 200), at: st.now() });
      st.save();
      show(at);
    }, { kind: 'quiet' }));
    return swap(
      at,
      [h3(title), text ? p(text, 'dq-text') : null],
      items.length ? list : p(empty, 'dq-text dq-sz-empty'),
      add,
      h('div', { class: 'dq-actions dq-actions--stack' }, nextBtn(at), btn('Add one', () => {
        add.classList.remove('is-hidden');
        f.input.focus();
      }, { kind: 'quiet', ic: 'plus' }), lists.open),
      lists.box,
    );
  };

  /** `then` is where breathing goes next when it was picked instead of cool water. */
  function show(at: At, then?: At) {
    clear();
    switch (at) {
      case 'start':
        return swap(
          at,
          [h('div', { class: 'dq-sz-hello' }, SAFE.intro.map((l, i) => h(i ? 'p' : 'h2', { class: i ? 'dq-text' : 'dq-sz-t', 'data-focus': i ? null : '', text: typo(l) })))],
          h(
            'div',
            { class: 'dq-actions dq-actions--stack' },
            btn('Give me a moment', () => app.go({ name: 'moment' }), { kind: 'primary' }),
            btn('Calm my body first', () => show('breathe'), { kind: 'quiet' }),
            btn('I need a person now', () => show('talk'), { kind: 'quiet' }),
            btn('I might not be safe', () => {
              danger = true;
              show('talk');
            }, { kind: 'quiet' }),
          ),
        );
      case 'breathe': {
        const ring = breathRing(ctx, { inhale: 4, exhale: 6, rounds: 6 });
        stops.push(ring.stop);
        return swap(at, [h3(SAFE.breathe.title), p(SAFE.breathe.text, 'dq-text')], ring.el, h('div', { class: 'dq-actions dq-actions--center' }, btn('Next', () => show(then ?? nextOf(at)), { kind: 'quiet' })));
      }
      case 'cold': {
        const instead = btn('Breathe instead', () => show('breathe', nextOf(at)), { kind: 'primary' });
        const tv = timerView(ctx, {
          seconds: 30,
          visual: 'cold',
          start: 'Start 30 seconds',
          peers: [instead],
          onDone: () => show(nextOf(at)),
        });
        stops.push(tv.stop);
        return swap(at, [h3(SAFE.cold.title)], p(SAFE.cold.small, 'dq-small'), tv.el, p(SAFE.cold.text, 'dq-text'), h('div', { class: 'dq-actions dq-actions--center' }, nextBtn(at, 'Next', 'quiet')));
      }
      case 'squeeze': {
        const nb = nextBtn(at, 'Next', 'quiet');
        const v = pmrView(ctx, { rounds: 3, onDone: () => nb.classList.replace('dq-btn--quiet', 'dq-btn--primary') });
        stops.push(v.stop);
        return swap(at, [h3(SAFE.squeeze.title), p(SAFE.squeeze.text, 'dq-text')], v.el, h('div', { class: 'dq-actions dq-actions--center' }, nb));
      }
      case 'check':
        return swap(
          at,
          [h3(SAFE.check)],
          h(
            'div',
            { class: 'dq-opts dq-opts--stack' },
            chip('A little lower', () => show('stop')),
            chip('About the same', () => show('stop')),
            chip('Higher', () => {
              higher = true;
              show('talk');
            }),
          ),
        );
      case 'stop': {
        let k = 0;
        const lines = SAFE.stop.map(([b, t]) => h('li', { class: 'dq-sz-stop is-hidden' }, h('b', { text: b }), ' ', h('span', { text: typo(t) })));
        const more = btn('Next line', () => {
          if (k < lines.length) {
            lines[k].classList.remove('is-hidden');
            say(lines[k].textContent ?? '');
            animate(lines[k], [{ opacity: 0 }, { opacity: 1 }], { duration: app.reduced() ? 120 : 600 });
            k++;
          }
          if (k >= lines.length) {
            const had = document.activeElement === more;
            more.remove();
            if (had) nb.focus({ preventScroll: true });
            nb.classList.replace('dq-btn--quiet', 'dq-btn--primary');
          }
        }, { kind: 'primary' });
        const nb = nextBtn(at, 'Next', 'quiet');
        lines[0].classList.remove('is-hidden');
        k = 1;
        return swap(at, [h3('Stop. Step back. Notice. Next step.')], h('ol', { class: 'dq-sz-stops' }, lines), h('div', { class: 'dq-actions dq-actions--stack' }, more, nb));
      }
      case 'reasons':
        return listScreen('reasons', SAFE.reasons.title, SAFE.reasons.text, SAFE.reasons.empty);
      case 'comfort':
        return listScreen('comfort', SAFE.comfort.title, SAFE.comfort.text, SAFE.comfort.empty);
      case 'people': {
        const ppl = st.state.lists.people;
        const list = h(
          'ul',
          { class: 'dq-people' },
          ppl.map((x) =>
            h(
              'li',
              { class: 'dq-person' },
              h('span', { class: 'dq-person-n', text: x.name }),
              x.phone
                ? h('span', { class: 'dq-person-acts' }, h('a', { class: 'dq-btn dq-btn--quiet', href: telHref(x.phone), 'aria-label': `Call ${x.name}`, html: `<span class="dq-btn-ic">${icon('phone')}</span><span>Call</span>` }), h('a', { class: 'dq-btn dq-btn--quiet', href: smsHref(x.phone.replace(/[^\d+]/g, '')), 'aria-label': `Text ${x.name}`, html: `<span class="dq-btn-ic">${icon('text')}</span><span>Text</span>` }))
                : null,
            ),
          ),
        );
        const n = field('Name', { placeholder: 'Name', autocomplete: 'off' });
        const ph = field('Number', { placeholder: 'Phone number', type: 'tel', inputmode: 'tel' });
        const lists = supportListsCopy(app);
        stops.push(lists.dispose);
        const add = h('div', { class: 'dq-person-add is-hidden' }, n.el, ph.el, h('div', { class: 'dq-actions' }, btn('Save', () => {
          const name = n.input.value.trim();
          if (!name) return n.input.focus();
          st.state.lists.people.push({ id: uid(), name: name.slice(0, 80), phone: ph.input.value.trim().slice(0, 40), at: st.now() });
          st.save();
          show('people');
        }, { kind: 'quiet' })));
        return swap(
          at,
          [h3(SAFE.people.title), p(SAFE.people.text, 'dq-text')],
          ppl.length ? list : p(SAFE.people.empty, 'dq-text dq-sz-empty'),
          add,
          h('div', { class: 'dq-actions dq-actions--stack' }, nextBtn(at), btn('Add a person', () => {
            add.classList.remove('is-hidden');
            n.input.focus();
          }, { kind: 'quiet', ic: 'plus' }), lists.open),
          lists.box,
        );
      }
      case 'talk': {
        const region = regionOf(app);
        // each button says which line it calls, so a screen reader names it in full: "Call 116 123, Samaritans"
        const action = (line: CrisisLine, l: CrisisLine['links'][number], noteId?: string) => {
          const web = l.href.startsWith('https:');
          const href = web ? l.href : l.href.startsWith('sms:') ? smsHref(l.href.slice(4), l.body) : telHref(l.href.slice(4));
          return h('a', { class: 'dq-btn dq-btn--quiet dq-res-a', href, target: web ? '_blank' : null, rel: web ? 'noopener noreferrer' : null, 'aria-label': `${l.label}, ${line.name}`, 'aria-describedby': noteId, html: `<span class="dq-btn-ic">${icon(l.href.startsWith('tel:') ? 'phone' : 'text')}</span><span>${l.label}</span>` });
        };
        const noted = (line: CrisisLine) =>
          line.links.map((l) => {
            const id = l.note ? `dq-res-note-${uid()}` : undefined;
            return h('div', { class: 'dq-res-act' }, action(line, l, id), l.note ? h('p', { id, class: 'dq-res-note', text: typo(l.note) }) : null);
          });
        // a lead line takes the place of the row's how, right under its name: it says who to call when the player might
        // not be safe
        const row = (line: CrisisLine, lead?: HTMLElement) =>
          h(
            'li',
            { class: `dq-res ${lead ? 'is-first' : ''}` },
            h('div', { class: 'dq-res-n', text: line.name }),
            lead ?? null,
            line.links.some((l) => l.note) ? h('div', { class: 'dq-res-acts dq-res-acts--notes' }, noted(line)) : h('div', { class: 'dq-res-acts' }, line.links.map((l) => action(line, l))),
            lead ? null : h('p', { class: 'dq-res-how', text: typo(line.how) }),
          );
        const rows = region.lines.map((line) => row(line));
        const nums = region.emergency;
        // the danger line says who to call, so it sits right above the buttons that call: on the emergency card, first in
        // line, when there is a number, and first among the choices when there isn't
        const dangerLine = (t: string) => p(t, `dq-text dq-sz-advice ${danger ? 'dq-sz-danger' : ''}`);
        if (nums.length) {
          const sos = { name: 'Emergency', how: SAFE.talk.emergency, links: nums.map((n) => ({ label: `Call ${n}`, href: `tel:${n}`, note: region.emergencyNotes?.[n] })) };
          rows.splice(danger ? 0 : Math.min(2, rows.length), 0, row(sos, danger ? dangerLine(SAFE.talk.danger.replace('{num}', nums.join(' or '))) : undefined));
        }
        return swap(
          at,
          [h3(SAFE.talk.title), p(region.lines.length ? SAFE.talk.text : SAFE.talk.none, 'dq-text')],
          nums.length ? null : dangerLine(SAFE.talk.dangerElsewhere),
          rows.length ? h('ul', { class: 'dq-res-list' }, rows) : null,
          h('p', { class: 'dq-small' }, h('a', { href: 'https://findahelpline.com', target: '_blank', rel: 'noopener noreferrer', class: 'dq-a', text: 'findahelpline.com' }), ` ${SAFE.talk.elsewhere}`),
          regionPicker(app, () => show('talk')),
          h('div', { class: 'dq-actions dq-actions--stack' }, nextBtn(at, 'Next', 'quiet'), btn('Back to breathing', () => show('breathe'), { kind: 'quiet' })),
        );
      }
      case 'close':
        return swap(
          at,
          [h('div', { class: 'dq-sz-hello' }, h('h2', { class: 'dq-sz-t', 'data-focus': '', text: typo(SAFE.close[0]) }), p(SAFE.close[1], 'dq-text'))],
          h('div', { class: 'dq-actions dq-actions--stack' }, btn('Stay a little longer', () => show('breathe'), { kind: 'quiet' }), btn('Back to the Lantern', () => app.go({ name: 'hub' }), { kind: 'primary' })),
        );
    }
  }

  return {
    el,
    title: 'Safe Zone',
    tools: [lightBtn],
    mode: 'safe',
    bubbles: [0, 0],
    leave: () => {
      clear();
      app.root.classList.remove('ca-szlit');
    },
    after: () => show((r.at as At) ?? 'start'),
  };
}
