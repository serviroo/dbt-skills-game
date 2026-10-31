/**
 * Safe Zone: body first (breathing, squeeze and release, then cool air or cold water), then STOP, then their own
 * lists, then people and services. No XP, toasts, glows or sound effects in here. One calm link to people on every
 * screen, and a lights-up toggle beside the dim default.
 */
import { animate } from '../ui/anim';
import { COOL, SAFE } from '../content/dbt';
import { BESIDE } from '../core/stored-names';
import { cleared, write } from '../core/cleared';
import { REGIONS, regionById, regionFromLocale, type CrisisLine } from '../content/crisis-lines';
import type { App, Route, ScreenOut } from './app';
import { icon } from './art';
import { momentView } from './moment';
import { uid } from './store';
import { btn, chip, field, h, p, panel, redrawn, typo } from './ui';
import { supportListsCopy } from './support-lists';
import { textSize } from './text-size';
import { breathRing, coolChoice, pmrView, type Ctx } from './widgets';

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

type At = 'start' | 'moment' | 'breathe' | 'cold' | 'squeeze' | 'check' | 'stop' | 'reasons' | 'people' | 'comfort' | 'talk' | 'close';
const FLOW: At[] = ['start', 'breathe', 'squeeze', 'cold', 'check', 'stop', 'reasons', 'comfort', 'people', 'talk', 'close'];
const lightKey = (key: string) => `${key}${BESIDE.safeLight}`;
/** The light as stored ('up' or 'dim'), or null when none is or storage can't be read. */
const storedLight = (key: string) => {
  // nothing kept counts once this game's data is cleared, though another copy may still be taking it off the device
  if (cleared()) return null;
  try {
    return localStorage.getItem(lightKey(key));
  } catch {
    return null;
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
  /** the light as stored when last read: only a change there (another open copy's, or a clear) turns it here */
  let stored = storedLight(st.key);
  let lit = stored === 'up';
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
    stored = storedLight(st.key);
    applyLight();
  });
  const foot = h('div', { class: 'dq-sz-foot' }, talkLink);
  // every screen starts at the top: one Tab from there reaches "Talk to someone now", wherever it shows
  const top = h('h1', { class: 'dq-sr', 'data-focus': '', text: 'Safe Zone' });
  // each step's heading is said politely as it shows
  const live = h('p', { class: 'dq-sr', role: 'status', 'aria-live': 'polite' });
  const el = h('div', { class: 'dq-safezone', 'data-size': textSize(app) }, top, foot, box, live);
  const say = (t: string) => {
    live.textContent = '';
    const id = setTimeout(() => (live.textContent = t), 100);
    stops.push(() => clearTimeout(id));
  };
  applyLight();
  // the text size or light chosen in another open copy, or this game's data cleared: the screen follows it at once. A
  // clear takes what was being typed in here and a light held for this visit too; any other change leaves them
  let wiped = cleared();
  const offShown = st.onChange(() => {
    el.dataset.size = textSize(app);
    refit();
    if (!wiped && cleared()) {
      wiped = true;
      for (const f of el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input.dq-input, textarea.dq-input')) f.value = '';
      lit = false;
      applyLight();
    }
    const now = storedLight(st.key);
    if (now === stored) return;
    stored = now;
    lit = now === 'up';
    applyLight();
  });

  // while a field here has focus and the keyboard covers part of the page (Safari and Chrome keep the page its full
  // height under it, so the visual viewport shows less than the page), or takes room from it and leaves too little for
  // the screen to be one screen tall (under 300px held sideways, 540px wide or more, else 361px, as daily.css has it),
  // the screen takes only the part above the keyboard and "Talk to someone now" pins at its top with Leave, Lights up
  // and Sound (daily.css), until the keyboard goes away
  const vv = window.visualViewport;
  const wide = window.matchMedia('(min-width: 540px)');
  let typing = false;
  // the tallest the visual viewport has been at each width it has had: the room there with the keyboard down, since a
  // keyboard only ever takes height
  const tallest = new Map<number, number>();
  // widths first had with the keyboard up (the phone turned while typing, and turning leaves it up), each with the least
  // height it has had there: the keyboard counts as up there, its room unknown, until the page grows past that as the
  // keyboard goes down. `up`: the keyboard was up as of the last fit
  const turned = new Map<number, number>();
  let up = false;
  if (vv) tallest.set(Math.round(vv.width), vv.height);
  const typedIn = () => {
    const f = document.activeElement;
    return f?.matches('input.dq-input, textarea.dq-input') && el.contains(f) ? f : null;
  };
  /**
   * Talk goes back under the frame, or while typing into the top bar's row between Leave and Lights up, where its words
   * fit on one line held sideways, else just after the bar: a row of its own upright, a column at the side held
   * sideways. Focus on it stays.
   */
  const pin = () => {
    const had = document.activeElement === talkLink;
    if (!typing) foot.append(talkLink);
    else {
      if (wide.matches) lightBtn.before(talkLink);
      const words = talkLink.lastElementChild!;
      if (!wide.matches || words.getBoundingClientRect().height > 1.5 * parseFloat(getComputedStyle(words).lineHeight)) el.parentElement!.before(talkLink);
    }
    if (had) talkLink.focus({ preventScroll: true });
  };
  // while typing, anything that changes Talk's size (the room above the keyboard, the screen turning, the text size
  // chosen in another open copy, a new screen) can move it, and the field stays in view, though not as the phone pans
  // to it
  const refit = () => {
    if (!typing) return;
    pin();
    typedIn()?.scrollIntoView({ block: 'nearest' });
  };
  const fit = (e: Event) => {
    if (!vv) return;
    const field = typedIn();
    const width = Math.round(vv.width);
    const low = turned.get(width);
    if (low !== undefined && Math.round(vv.height) > Math.round(low)) turned.delete(width);
    else if (low !== undefined || (up && field && !tallest.has(width))) turned.set(width, vv.height);
    const rest = turned.has(width) ? Infinity : Math.max(tallest.get(width) ?? 0, vv.height);
    if (rest !== Infinity) tallest.set(width, rest);
    const covered = Math.round(vv.height * vv.scale) < document.documentElement.clientHeight;
    up = covered || vv.height < rest;
    // down, the widths turned to with it up are only the room it left there
    if (!up) turned.clear();
    const short = vv.height < rest && vv.height < (wide.matches ? 300 : 361);
    const on = (covered || short) && (typing || !!field);
    if (on) {
      app.root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
      app.root.style.setProperty('--vv-h', `${vv.height}px`);
    }
    if (on === typing) {
      if (e.type === 'resize') refit();
      return;
    }
    typing = on;
    app.root.classList.toggle('is-typing', on);
    if (!on) for (const v of ['--vv-top', '--vv-h']) app.root.style.removeProperty(v);
    pin();
    typedIn()?.scrollIntoView({ block: 'nearest' });
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  el.addEventListener('focusin', fit);
  const unfit = () => {
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    typing = false;
    pin();
    app.root.classList.remove('is-typing');
    for (const v of ['--vv-top', '--vv-h']) app.root.style.removeProperty(v);
  };

  const nextOf = (at: At) => FLOW[Math.min(FLOW.length - 1, FLOW.indexOf(at) + 1)];
  const clear = () => stops.splice(0).forEach((f) => f());
  /** `lead` is the screen's heading and words, `kids` what the player does; a phone held sideways shows them side by side. */
  const swap = (at: At, lead: (Node | null)[], ...kids: (Node | null)[]) => {
    const halves = [h('div', { class: 'dq-sz-lead' }, lead), h('div', { class: 'dq-sz-main' }, kids)];
    body.replaceChildren(...halves);
    talkLink.classList.toggle('is-hidden', at === 'talk');
    foot.classList.toggle('is-talk', at === 'talk');
    talkLink.classList.toggle('is-strong', (higher || danger) && at !== 'talk');
    refit();
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
    // the list follows another open copy's changes, and a clear, as they land
    const list = redrawn(() => {
      const items = st.state.lists[at];
      return items.length ? h('ul', { class: 'dq-sz-list' }, items.map((i) => h('li', { text: typo(i.text) }))) : p(empty, 'dq-text dq-sz-empty');
    }, () => addOne);
    stops.push(st.onChange(list.update));
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
    const addOne = btn('Add one', () => {
      add.classList.remove('is-hidden');
      f.input.focus();
    }, { kind: 'quiet', ic: 'plus' });
    return swap(
      at,
      [h3(title), text ? p(text, 'dq-text') : null],
      list.node,
      add,
      h('div', { class: 'dq-actions dq-actions--stack' }, nextBtn(at), addOne, lists.open),
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
            btn('Give me a moment', () => show('moment'), { kind: 'primary' }),
            btn('Calm my body first', () => show('breathe'), { kind: 'quiet' }),
            btn('I need a person now', () => show('talk'), { kind: 'quiet' }),
            btn('I might not be safe', () => {
              danger = true;
              show('talk');
            }, { kind: 'quiet' }),
          ),
        );
      case 'moment': {
        // the moment stays in here, with people one tap away and no sound or credit; Done comes back to the first screen
        const m = momentView(app, { scene: false, done: () => show('start') });
        stops.push(m.leave);
        return swap(at, [h3('Give me a moment'), m.stage], h('div', { class: 'dq-moment' }, m.words, m.foot));
      }
      case 'breathe': {
        const ring = breathRing(ctx, { inhale: 4, exhale: 6, rounds: 6 });
        stops.push(ring.stop);
        return swap(at, [h3(SAFE.breathe.title), p(SAFE.breathe.text, 'dq-text')], ring.el, h('div', { class: 'dq-actions dq-actions--center' }, btn('Next', () => show(then ?? nextOf(at)), { kind: 'quiet' })));
      }
      case 'cold': {
        const nb = nextBtn(at, 'Next', 'quiet');
        const cc = coolChoice(ctx, { onDone: () => show(nextOf(at)) });
        stops.push(cc.stop);
        return swap(at, [h3(COOL.title)], cc.el, h('div', { class: 'dq-actions dq-actions--center' }, nb, btn('Breathe instead', () => show('breathe', nextOf(at)), { kind: 'quiet' })));
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
        // the people follow another open copy's changes, and a clear, as they land: someone removed elsewhere can't be
        // called from here, and focus on their Call or Text goes to Add a person
        const list = redrawn(() => {
          const ppl = st.state.lists.people;
          return ppl.length
            ? h(
                'ul',
                { class: 'dq-people' },
                ppl.map((x) =>
                  h(
                    'li',
                    { class: 'dq-person', 'data-item': x.id },
                    h('span', { class: 'dq-person-n', text: x.name }),
                    x.phone
                      ? h('span', { class: 'dq-person-acts' }, h('a', { class: 'dq-btn dq-btn--quiet', href: telHref(x.phone), 'aria-label': `Call ${x.name}`, html: `<span class="dq-btn-ic">${icon('phone')}</span><span>Call</span>` }), h('a', { class: 'dq-btn dq-btn--quiet', href: smsHref(x.phone.replace(/[^\d+]/g, '')), 'aria-label': `Text ${x.name}`, html: `<span class="dq-btn-ic">${icon('text')}</span><span>Text</span>` }))
                      : null,
                  ),
                ),
              )
            : p(SAFE.people.empty, 'dq-text dq-sz-empty');
        }, () => addPerson);
        stops.push(st.onChange(list.update));
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
        const addPerson = btn('Add a person', () => {
          add.classList.remove('is-hidden');
          n.input.focus();
        }, { kind: 'quiet', ic: 'plus' });
        return swap(
          at,
          [h3(SAFE.people.title), p(SAFE.people.text, 'dq-text')],
          list.node,
          add,
          h('div', { class: 'dq-actions dq-actions--stack' }, nextBtn(at), addPerson, lists.open),
          lists.box,
        );
      }
      case 'talk': {
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
        // the danger line says who to call, so it sits right above the buttons that call: on the emergency card, first in
        // line, when there is a number, and first among the choices when there isn't
        const dangerLine = (t: string) => p(t, `dq-text dq-sz-advice ${danger ? 'dq-sz-danger' : ''}`);
        /** What follows the country: the words under the heading, the danger line when there's no number, the lines. */
        const lines = (): ChildNode[] => {
          const region = regionOf(app);
          const rows = region.lines.map((line) => row(line));
          const nums = region.emergency;
          if (nums.length) {
            const sos = { name: 'Emergency', how: SAFE.talk.emergency, links: nums.map((n) => ({ label: `Call ${n}`, href: `tel:${n}`, note: region.emergencyNotes?.[n] })) };
            rows.splice(danger ? 0 : Math.min(2, rows.length), 0, row(sos, danger ? dangerLine(SAFE.talk.danger.replace('{num}', nums.join(' or '))) : undefined));
          }
          return [
            p(region.lines.length ? SAFE.talk.text : SAFE.talk.none, 'dq-text'),
            nums.length ? document.createComment('') : dangerLine(SAFE.talk.dangerElsewhere),
            rows.length ? h('ul', { class: 'dq-res-list' }, rows) : document.createComment(''),
          ];
        };
        let shown = lines();
        // another country swaps only these in place (an empty comment holds the place of one it has none of), so the picker
        // keeps focus as the arrow keys move through countries. A country picked in another open copy can take away the
        // call or text link that has focus: focus goes to the same link among the new lines (by its name, else its
        // number), or to the picker when the new country has none
        const picked = () => {
          const next = lines();
          const was = document.activeElement;
          const had = was instanceof HTMLAnchorElement && shown.some((n) => n.contains(was)) ? was : null;
          shown.forEach((n, i) => n.replaceWith(next[i]));
          shown = next;
          if (!had) return;
          const links = next.flatMap((n) => (n instanceof Element ? [...n.querySelectorAll<HTMLAnchorElement>('a[href]')] : []));
          const same = links.find((a) => a.getAttribute('aria-label') === had.getAttribute('aria-label')) ?? links.find((a) => a.getAttribute('href') === had.getAttribute('href'));
          (same ?? picker.querySelector('select'))?.focus();
        };
        const picker = regionPicker(app, picked);
        return swap(
          at,
          [h3(SAFE.talk.title), shown[0]],
          shown[1],
          shown[2],
          // named exactly as it reads: the browser hears the break before .com as a space
          h('p', { class: 'dq-small' }, h('a', { href: 'https://findahelpline.com', target: '_blank', rel: 'noopener noreferrer', class: 'dq-a', 'aria-label': 'findahelpline.com' }, h('span', {}, 'findahelpline', h('wbr'), '.com')), ` ${SAFE.talk.elsewhere}`),
          picker,
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
    foot,
    mode: 'safe',
    bubbles: [0, 0],
    leave: () => {
      clear();
      offShown();
      unfit();
      app.root.classList.remove('ca-szlit');
    },
    after: () => show((r.at as At) ?? 'start'),
  };
}
