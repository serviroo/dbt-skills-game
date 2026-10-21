/** Pick today's line: three System lines offered on the hub, her pick kept privately in a small history. */
import { animate } from '../ui/anim';
import { LINE_COPY } from '../content/daily-lines';
import type { App, ScreenOut } from './app';
import { icon } from './art';
import { btn, h, p, panel, typo } from './ui';
import type { LineEntry } from './store';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function dayLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON[m - 1]}`;
}

const lineEl = (tag: string, text: string, cls = '') =>
  h('span', { class: `dq-line ${cls}` }, h('span', { class: 'dq-line-tag', text: `[${tag}]` }), h('span', { class: 'dq-line-t', text: typo(text) }));

export function linePanel(app: App) {
  const st = app.store;
  let roll = 0;
  const body = h('div', { class: 'dq-lines-body' });
  const el = panel({ title: LINE_COPY.title, ic: icon('quote'), cls: 'dq-lines', label: LINE_COPY.title }, body);
  const historyBtn = () => (st.state.lines.length ? btn(LINE_COPY.history, () => app.go({ name: 'lines' }), { kind: 'link' }) : null);

  const offer = () => {
    const opts = st.lineOffer(roll);
    const picked = st.lineToday();
    body.replaceChildren(
      p(LINE_COPY.ask, 'dq-small dq-lines-ask'),
      h(
        'div',
        { class: 'dq-lines-opts', role: 'radiogroup', 'aria-label': LINE_COPY.title },
        opts.map((l) =>
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(picked?.id === l.id),
              class: 'dq-lineopt',
              onclick: (e: Event) => choose(l, e.currentTarget as HTMLElement),
            },
            lineEl(l.tag, l.text),
          ),
        ),
      ),
      h(
        'div',
        { class: 'dq-actions dq-lines-acts' },
        btn(LINE_COPY.others, () => {
          roll++;
          offer();
          animate(body.querySelector('.dq-lines-opts')!, [{ opacity: 0 }, { opacity: 1 }], { duration: app.reduced() ? 120 : 320 });
        }, { kind: 'link' }),
        picked ? btn('Keep the one I had', show, { kind: 'link' }) : null,
        historyBtn(),
      ),
    );
  };

  const choose = (l: ReturnType<typeof st.lineOffer>[number], from?: HTMLElement) => {
    const { first } = st.pickLine(l);
    app.sound('check');
    if (from && !app.reduced()) {
      for (const b of body.querySelectorAll<HTMLElement>('.dq-lineopt')) if (b !== from) animate(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
      from.setAttribute('aria-checked', 'true');
      void animate(from, [{ transform: 'none' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' }).finished.then(() => show(first));
    } else show(first);
  };

  const show = (fresh: boolean | Event = false) => {
    const e = st.lineToday();
    if (!e) return offer();
    const pinned = h('div', { class: 'dq-lines-pin' }, lineEl(e.tag, e.text, 'dq-line--pinned'), h('span', { class: 'dq-sheen', 'aria-hidden': 'true' }));
    body.replaceChildren(
      pinned,
      h(
        'div',
        { class: 'dq-actions dq-lines-acts' },
        fresh === true ? h('span', { class: 'dq-xp', text: '+5 XP' }) : null,
        btn(LINE_COPY.change, offer, { kind: 'link' }),
        historyBtn(),
      ),
    );
    if (fresh === true && !app.reduced()) {
      animate(pinned, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' });
      animate(pinned.querySelector('.dq-sheen')!, [{ transform: 'translateX(-120%) skewX(-18deg)', opacity: 0 }, { opacity: 0.9, offset: 0.4 }, { transform: 'translateX(140%) skewX(-18deg)', opacity: 0 }], {
        duration: 1100,
        delay: 260,
        easing: 'cubic-bezier(.4,0,.2,1)',
      });
    }
  };

  if (st.lineToday()) show();
  else offer();
  return el;
}

export function linesScreen(app: App): ScreenOut {
  const all = app.store.state.lines.slice().sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.t - a.t));
  const groups = new Map<string, LineEntry[]>();
  for (const l of all) {
    const k = l.day.slice(0, 7);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const el = h(
    'div',
    { class: 'dq-page dq-lineslog' },
    h('header', { class: 'dq-pagehead' }, h('h1', { class: 'dq-h1', 'data-focus': '', text: LINE_COPY.history }), p(LINE_COPY.historySub, 'dq-text dq-pagesub')),
    all.length
      ? [...groups.entries()].map(([ym, list]) => {
          const [y, m] = ym.split('-').map(Number);
          return h(
            'section',
            { class: 'dq-loggroup' },
            h('h2', { class: 'dq-label', text: `${MONTH[m - 1]} ${y}` }),
            h(
              'ol',
              { class: 'dq-log' },
              list.map((l) => h('li', { class: 'dq-logrow' }, h('span', { class: 'dq-logrow-d', text: dayLabel(l.day) }), lineEl(l.tag, l.text))),
            ),
          );
        })
      : p(LINE_COPY.historyEmpty, 'dq-text dq-empty'),
  );
  return { el, title: LINE_COPY.history, mode: 'sub' };
}
