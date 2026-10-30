/**
 * "Copy your lists" on Comfort and in the Safe Zone: the player's own support lists as plain text, in a preview they
 * can select, copied only when they tap Copy. Built from the store every time, so it follows another open copy.
 */
import { LISTS_COPY } from '../content/dbt';
import { mayMentionTherapist } from '../core/session';
import type { App } from './app';
import { uid, type State } from './store';
import { btn, copyText, h, p } from './ui';

/** Things that are yours, comfort kit, go-to activities and people, exactly as typed; an empty list is left out. */
export function supportListsText(s: State) {
  const part = (head: string, lines: string[]) => (lines.length ? [head, ...lines.map((l) => `- ${l}`)].join('\n') : '');
  return [
    part(LISTS_COPY.heads.reasons, s.lists.reasons.map((i) => i.text)),
    part(LISTS_COPY.heads.comfort, s.lists.comfort.map((i) => i.text)),
    part(LISTS_COPY.heads.activities, s.lists.activities.map((i) => i.text)),
    part(LISTS_COPY.heads.people, s.lists.people.map((x) => (x.phone ? `${x.name}: ${x.phone}` : x.name))),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The "Copy your lists" button and the preview it opens right below where `box` is placed. Call `dispose` on leave. */
export function supportListsCopy(app: App) {
  const st = app.store;
  let said: boolean | undefined;
  const hint = p('', 'dq-small');
  const pre = h('pre', { class: 'dq-pre dq-lists-pre', tabindex: '0', 'aria-label': LISTS_COPY.preview });
  const empty = p(LISTS_COPY.empty, 'dq-text');
  const status = h('span', { class: 'dq-hint', 'aria-live': 'polite' });
  const render = () => {
    const text = supportListsText(st.state);
    if (pre.textContent !== text) pre.textContent = text;
    pre.classList.toggle('is-hidden', !text);
    copy.classList.toggle('is-hidden', !text);
    empty.classList.toggle('is-hidden', !!text);
    return text;
  };
  const copy = btn(LISTS_COPY.copy, async () => {
    const text = render();
    status.textContent = text && (await copyText(text)) ? LISTS_COPY.copied : LISTS_COPY.failed;
  }, { kind: 'quiet', ic: 'copy' });
  const close = btn(LISTS_COPY.close, () => show(false), { kind: 'quiet' });
  const box = h('div', { class: 'dq-lists-copy is-hidden', id: `dq-lists-${uid()}` }, hint, pre, empty, h('div', { class: 'dq-actions' }, copy, close, status));
  const open = btn(LISTS_COPY.open, () => show(box.classList.contains('is-hidden')), { kind: 'quiet', ic: 'copy' });
  open.setAttribute('aria-expanded', 'false');
  open.setAttribute('aria-controls', box.id);
  function show(on: boolean) {
    box.classList.toggle('is-hidden', !on);
    open.setAttribute('aria-expanded', String(on));
    status.textContent = '';
    if (!on) return open.focus();
    said ??= mayMentionTherapist();
    hint.textContent = said ? `${LISTS_COPY.therapist} ${LISTS_COPY.local}` : LISTS_COPY.local;
    const text = render();
    // bringing it into view can hide the button under the top bar, so focus on that button moves into the preview
    const to = document.activeElement === open ? (text ? pre : close) : null;
    // opened with the keys, what takes focus is brought in after the preview, from its top where the words above it
    // fill the screen, clear of the pinned bars
    const keyed = to && open.matches(':focus-visible') ? to : null;
    to?.focus({ preventScroll: true });
    // on a small screen it opens below the fold
    box.scrollIntoView({ block: 'nearest', behavior: app.reduced() || keyed ? 'auto' : 'smooth' });
    keyed?.scrollIntoView({ block: 'nearest' });
  }
  // a list changed in another open copy: the open preview follows it, and nothing else on the screen moves
  const off = st.onChange(() => {
    if (!box.classList.contains('is-hidden')) render();
  });
  return { open, box, dispose: () => void off() };
}
