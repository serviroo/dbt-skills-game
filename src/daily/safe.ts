/**
 * Safe Zone: body first (breathing, squeeze and release, then cool air or cold water), then STOP, then their own
 * lists, then people and services. No XP, toasts, glows or sound effects in here. One calm link to people on every
 * screen, and a lights-up toggle beside the dim default.
 */
import { animate } from '../ui/anim';
import { SAFE_FADE, WINDOW } from '../motion/tokens';
import { COOL, SAFE } from '../content/dbt';
import { BESIDE } from '../core/stored-names';
import { cleared, write } from '../core/cleared';
import { REGIONS, regionById, regionFromLocale, type CrisisLine } from '../content/crisis-lines';
import type { App, Route, ScreenOut } from './app';
import { icon } from './art';
import { momentView } from './moment';
import { nextPlace, uid, type Item, type Person } from './store';
import { entryList } from './entries';
import { btn, chip, field, focusWhole, h, p, panel, typo, wholeWords } from './ui';
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
    // noted once it is stored, now or after a hold: read before then, a write that waits leaves the old light noted
    write(() => {
      try {
        localStorage.setItem(lightKey(st.key), light);
        stored = storedLight(st.key);
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
  const el = h('div', { class: 'dq-safezone', 'data-size': textSize(app) }, top, foot, box, live);
  const unwhole = wholeWords(el);
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
  const vvProps = ['--vv-top', '--vv-left', '--vv-w', '--vv-h'];
  const wide = window.matchMedia('(min-width: 540px)');
  let typing = false;
  // the tallest the visual viewport has been at each width it has had while typing: the room there with the keyboard
  // down, since a keyboard only ever takes height. Resized with nothing typed in (see typedIn), there's no keyboard, so
  // its height is the room, taller or shorter (another app put above or below it, a toolbar coming or going). Both as
  // it shows on the screen, in the page's px unpinched, so pinching in or out changes neither
  const tallest = new Map<number, number>();
  // widths first had with the keyboard up (the phone turned, or the window resized beside another app, while typing;
  // either leaves it up), each with the least height it has had there and the room it should have there: turned, the
  // screen's sides swap, so that's the width turned from and its room, less the width turned to; resized, the screen's
  // height stays, and with it the room. The keyboard counts as up there, the room not yet seen, until the page is
  // halfway from the least to that room; short of that it's the keyboard settling after the move, a little taller or
  // shorter. That holds where the usual screen fits above the keyboard too, since pinching in can still leave too
  // little. Moved on again before the keyboard goes down, the room carries over.
  // `up`: the keyboard was up as of the last fit; `last`, `lastHeld`: the last width the visual viewport had and how
  // the screen was held then
  const moved = new Map<number, { low: number; room: number }>();
  let up = false;
  const calm = () => ({ duration: app.reduced() ? WINDOW.reducedFadeMs : SAFE_FADE.ms, easing: 'ease-out' });
  // how wide letters are in a field's font
  const ruler = document.createElement('canvas').getContext('2d')!;
  // Safari before 16.4 says how the phone is held only as window.orientation
  const held = () => screen.orientation?.type.split('-')[0] ?? (Math.abs(window.orientation) === 90 ? 'landscape' : 'portrait');
  let last = vv ? Math.round(vv.width * vv.scale) : 0;
  let lastHeld = held();
  if (vv) tallest.set(last, vv.height * vv.scale);
  // the field being typed in: one here with focus while the page has it too, since the keyboard goes when the page
  // loses it (the phone putting the page beside another app, say), though the field keeps focus
  const typedIn = () => {
    const f = document.activeElement;
    return document.hasFocus() && f?.matches('input.dq-input, textarea.dq-input') && el.contains(f) ? f : null;
  };
  /**
   * Talk goes back under the frame, or while typing into the top bar's row between Leave and Lights up, where its words
   * fit on one line held sideways, else just after the bar: a row of its own upright, a column at the side held
   * sideways. Held sideways is by the part that shows: 540px wide or more, or the phone held that way, pinched in or
   * at 200% zoom too, where it's narrower but still too short for a row (is-sideways, daily.css). Held sideways with
   * the box the field being typed in scrolls in, inside the frame, too short for it to show whole, the bar, the field
   * and Talk's column share one row (is-one-row, daily.css). Held sideways with the field too narrow to show 15 letters,
   * it takes more of the width (is-narrow): the frame and an entry being changed give up their sides, and in that one
   * row Lights up and Sound step aside until the keyboard goes down, fading back in. Focus on it stays.
   */
  const pin = () => {
    const had = document.activeElement === talkLink;
    const aside = () => app.root.matches('.is-one-row.is-narrow');
    const wasAside = aside();
    const side = typing && !!vv && (vv.width >= 540 || held() === 'landscape');
    app.root.classList.toggle('is-sideways', side);
    app.root.classList.remove('is-one-row', 'is-narrow');
    if (!typing) foot.append(talkLink);
    else {
      if (side) lightBtn.before(talkLink);
      const words = talkLink.lastElementChild!;
      if (!side || words.getBoundingClientRect().height > 1.5 * parseFloat(getComputedStyle(words).lineHeight)) el.parentElement!.before(talkLink);
      const field = typedIn();
      let port = field?.parentElement;
      while (port && getComputedStyle(port).overflowY === 'visible') port = port.parentElement;
      if (side && field && port && port.clientHeight < field.getBoundingClientRect().height) {
        el.parentElement!.before(talkLink);
        app.root.classList.add('is-one-row');
      }
      if (side && field) {
        const s = getComputedStyle(field);
        ruler.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
        if (field.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) < ruler.measureText('n'.repeat(15)).width) app.root.classList.add('is-narrow');
      }
    }
    if (wasAside && !aside()) for (const e of lightBtn.parentElement!.children) if (e !== talkLink) animate(e, [{ opacity: 0 }, { opacity: 1 }], calm());
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
    // as it shows on the screen (see tallest)
    const width = Math.round(vv.width * vv.scale);
    const height = vv.height * vv.scale;
    const fits = wide.matches ? 300 : 361;
    const now = held();
    const room = (tallest.get(last) ?? moved.get(last)?.room ?? Infinity) + (now !== lastHeld ? last - width : 0);
    const t = moved.get(width) ?? (up && field && !tallest.has(width) ? { low: height, room } : null);
    if (!field && e.type === 'resize') {
      moved.delete(width);
      tallest.set(width, height);
    } else if (t) {
      t.low = Math.min(t.low, height);
      if (height >= (t.low + t.room) / 2) moved.delete(width);
      else moved.set(width, t);
    }
    if (width !== last) [last, lastHeld] = [width, now];
    const rest = moved.has(width) ? Infinity : Math.max(tallest.get(width) ?? 0, height);
    if (rest !== Infinity) tallest.set(width, rest);
    const covered = Math.round(height) < document.documentElement.clientHeight;
    up = covered || height < rest;
    // down, the widths moved to with it up are only the room it left there
    if (!up) moved.clear();
    const short = height < rest && vv.height < fits;
    const on = (covered || short) && (typing || !!field);
    // typing, the Safe Zone has only the part above the keyboard, whichever kind it is (.dq.is-typing): its short-room
    // rule reads that, not the page's height, which a keyboard over the page leaves as it was
    el.classList.toggle('is-short', on && vv.height <= 230);
    if (on) {
      app.root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
      app.root.style.setProperty('--vv-left', `${vv.offsetLeft}px`);
      app.root.style.setProperty('--vv-w', `${vv.width}px`);
      app.root.style.setProperty('--vv-h', `${vv.height}px`);
    }
    if (on === typing) {
      if (e.type === 'resize') refit();
      return;
    }
    typing = on;
    app.root.classList.toggle('is-typing', on);
    if (!on) for (const v of vvProps) app.root.style.removeProperty(v);
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
    for (const v of vvProps) app.root.style.removeProperty(v);
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
    for (const e of [body, ...halves]) animate(e, [{ opacity: 0 }, { opacity: 1 }], calm());
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
    const hint = at === 'reasons' ? SAFE.reasons.add : 'Something that helps, even a little';
    // the list follows every change as it lands, one saved here, another open copy's or a clear, so an entry open to
    // change keeps what is typed in it; "Edit the list" shows each entry's Edit and moves
    const list = entryList(app, { key: at, cls: 'dq-sz-list', row: 'dq-sz-entry', view: (x: Item) => [h('span', { class: 'dq-entry-t', text: typo(x.text) })], empty: () => p(empty, 'dq-text dq-sz-empty'), lost: () => addOne, say, hint, toggle: true, removable: true });
    stops.push(st.onChange(list.update), list.leave);
    const lists = supportListsCopy(app);
    stops.push(lists.dispose);
    const f = field('Add one', { placeholder: hint, hideLabel: true });
    // saved, the new one shows in its place in the list, the row closes and focus goes back to Add one
    const add = h('div', { class: 'dq-addrow is-hidden' }, f.el, btn('Save', () => {
      const v = f.input.value.trim();
      if (!v) return f.input.focus();
      const items = st.state.lists[at];
      items.push({ id: uid(), text: v.slice(0, 200), at: st.now(), place: nextPlace(items) });
      f.input.value = '';
      add.classList.add('is-hidden');
      st.save();
      focusWhole(addOne);
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
      h('div', { class: 'dq-actions dq-actions--stack' }, nextBtn(at), addOne, list.flip, lists.open),
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
        // the people follow every change as it lands, one saved here, another open copy's or a clear: a person open to
        // change keeps what is typed, someone removed elsewhere can't be called from here, and focus on their Call or
        // Text goes to Add a person
        const list = entryList(app, {
          key: 'people',
          cls: 'dq-people',
          row: 'dq-person',
          view: (x: Person) => [
            h('span', { class: 'dq-person-n', text: x.name }),
            x.phone
              ? h('span', { class: 'dq-person-acts' }, h('a', { class: 'dq-btn dq-btn--quiet', href: telHref(x.phone), 'aria-label': `Call ${x.name}`, html: `<span class="dq-btn-ic">${icon('phone')}</span><span>Call</span>` }), h('a', { class: 'dq-btn dq-btn--quiet', href: smsHref(x.phone.replace(/[^\d+]/g, '')), 'aria-label': `Text ${x.name}`, html: `<span class="dq-btn-ic">${icon('text')}</span><span>Text</span>` }))
              : null,
          ],
          empty: () => p(SAFE.people.empty, 'dq-text dq-sz-empty'),
          lost: () => addPerson,
          say,
          toggle: true,
          removable: true,
        });
        stops.push(st.onChange(list.update), list.leave);
        const n = field('Name', { placeholder: 'Name', autocomplete: 'off' });
        const ph = field('Number', { placeholder: 'Phone number', type: 'tel', inputmode: 'tel' });
        const lists = supportListsCopy(app);
        stops.push(lists.dispose);
        // saved, the person shows in their place in the list, the fields close and focus goes back to Add a person
        const add = h('div', { class: 'dq-person-add is-hidden' }, n.el, ph.el, h('div', { class: 'dq-actions' }, btn('Save', () => {
          const name = n.input.value.trim();
          if (!name) return n.input.focus();
          const ppl = st.state.lists.people;
          ppl.push({ id: uid(), name: name.slice(0, 80), phone: ph.input.value.trim().slice(0, 40), at: st.now(), place: nextPlace(ppl) });
          n.input.value = '';
          ph.input.value = '';
          add.classList.add('is-hidden');
          st.save();
          focusWhole(addPerson);
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
          h('div', { class: 'dq-actions dq-actions--stack' }, nextBtn(at), addPerson, list.flip, lists.open),
          lists.box,
        );
      }
      case 'talk': {
        // each button says which line it calls, so a screen reader names it in full: "Call 116 123, Samaritans"
        const action = (line: CrisisLine, l: CrisisLine['links'][number], noteId?: string) => {
          const web = l.href.startsWith('https:');
          const href = web ? l.href : l.href.startsWith('sms:') ? smsHref(l.href.slice(4), l.body) : telHref(l.href.slice(4));
          return h('a', { class: 'dq-btn dq-btn--quiet dq-res-a', href, target: web ? '_blank' : null, rel: web ? 'noopener noreferrer' : null, 'aria-label': `${l.label}, ${line.name}`, 'aria-describedby': noteId, html: `<span class="dq-btn-ic">${icon(l.href.startsWith('tel:') ? 'phone' : 'text')}</span><span class="dq-btn-t">${l.label}</span>` });
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
      unwhole();
      clear();
      offShown();
      unfit();
      app.root.classList.remove('ca-szlit');
    },
    after: () => show((r.at as At) ?? 'start'),
  };
}
