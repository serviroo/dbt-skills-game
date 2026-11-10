import { animate } from '../ui/anim';
import { cantOpen } from './cant-open';
import { MODE_LABEL, STORY } from './storyroom';
import { STORY_CAP, type Card } from './storystore';
import { btn, h } from './ui';

type Selection = { start: number; end: number; text: string };
type Options = {
  cardsEl: HTMLElement; cards: Card[]; unread: boolean; reduced: () => boolean;
  retry: (present: () => boolean) => Promise<boolean>;
  edit: (card: Card) => void; toss: (card: Card) => void;
  insertText: (text: string) => Promise<string | null | undefined>;
  replaceSel: (sel: Selection | undefined, text: string) =>
    Promise<{ next: string; moved: boolean } | null | undefined>;
  appendNotes: (line: string) => Promise<'ok' | 'full' | 'fail'>;
  afterChange: (msg: string, next: string) => void; say: (text: string) => void;
};

export function renderStoryCards(options: Options, fresh: boolean) {
  const { cardsEl, cards, unread, retry, reduced, edit, toss, insertText, replaceSel,
    appendNotes, afterChange, say } = options;
  const cardEl = (c: Card) => {
    const textEl = h('p', { class: 'st-card-t', text: c.text });
    const msg = h('p', { class: 'st-card-msg', role: 'status' });
    let editor: HTMLTextAreaElement | null = null;
    let editTimer = 0;
    const value = () => (editor ? editor.value : c.text).trim();
    const tell = (t: string) => (msg.textContent = t);
    const acts = h('div', { class: 'st-card-acts' });
    const card = h('article', { class: `st-card st-card--${c.mode}`, 'data-id': c.id },
      h('span', { class: 'st-card-k', text: MODE_LABEL[c.mode] }), textEl, acts, msg);
    let main: HTMLButtonElement;
    if (c.mode === 'continue')
      main = btn('Insert', async () => {
        const next = await insertText(value());
        if (next === undefined) return;
        if (next === null) return tell(STORY.full);
        afterChange('Added to your page.', next);
      }, { kind: 'primary', cls: 'dq-btn--sm' });
    else if (c.mode === 'polish')
      main = btn('Replace', async () => {
        const done = await replaceSel(c.sel, value());
        if (done === undefined) return;
        if (!done) return tell(STORY.full);
        const { next, moved } = done;
        if (moved) {
          tell(STORY.moved);
          say(STORY.moved);
        }
        afterChange(moved ? STORY.moved : 'Replaced.', next);
      }, { kind: 'primary', cls: 'dq-btn--sm' });
    else if (c.mode === 'whatif')
      main = btn('Add to Notes', async () => {
        const r2 = await appendNotes(`• ${value()}`);
        tell(r2 === 'ok' ? STORY.addedNotes : r2 === 'full' ? STORY.full : STORY.notSaving);
      }, { kind: 'primary', cls: 'dq-btn--sm' });
    else {
      main = btn('Answer', () => {
        if (card.querySelector('.st-answer')) return card.querySelector<HTMLInputElement>('.st-answer input')?.focus();
        const id = `st-ans-${c.id}`;
        const inp = h('input', { id, class: 'dq-input', type: 'text', maxlength: 600, autocomplete: 'off',
          autocapitalize: 'sentences', spellcheck: 'true', enterkeyhint: 'done' });
        const saveA = async () => {
          const a = inp.value.trim();
          if (!a) return inp.focus();
          const r2 = await appendNotes(`Q: ${value()}\nA: ${a}`);
          tell(r2 === 'ok' ? 'Saved to Notes.' : r2 === 'full' ? STORY.full : STORY.notSaving);
          if (r2 === 'ok') row.remove();
        };
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') (e.preventDefault(), void saveA());
        });
        const row = h('div', { class: 'st-answer' }, h('label', { for: id, class: 'dq-sr', text: 'Your answer' }),
          inp, btn('Save', () => void saveA(), { kind: 'primary', cls: 'dq-btn--sm' }));
        acts.after(row);
        inp.focus();
      }, { kind: 'primary', cls: 'dq-btn--sm' });
    }
    const editB = btn('Edit', () => {
      if (editor) {
        c.text = editor.value;
        textEl.textContent = c.text;
        editor.replaceWith(textEl);
        editor = null;
        editB.querySelector('.dq-btn-t')!.textContent = 'Edit';
        edit(c);
        return;
      }
      editor = h('textarea', { class: 'st-card-edit', 'aria-label': `Edit this ${MODE_LABEL[c.mode]} card`,
        maxlength: STORY_CAP.card, spellcheck: 'true', autocapitalize: 'sentences' }) as HTMLTextAreaElement;
      editor.value = c.text;
      editor.addEventListener('input', () => {
        clearTimeout(editTimer);
        editTimer = window.setTimeout(() => {
          if (!editor) return;
          c.text = editor.value;
          edit(c);
        }, 500);
        editor!.style.height = 'auto';
        editor!.style.height = `${editor!.scrollHeight + 2}px`;
      });
      textEl.replaceWith(editor);
      editor.style.height = `${Math.max(88, editor.scrollHeight + 2)}px`;
      editor.focus();
      editB.querySelector('.dq-btn-t')!.textContent = 'Done';
    }, { kind: 'quiet', cls: 'dq-btn--sm' });
    const tossB = btn('Toss', () => {
      toss(c);
    }, { kind: 'link', cls: 'st-toss' });
    acts.append(main, editB, tossB);
    return card;
  };
  const retryPanel = () => {
    const box = cantOpen('ideas', () => retry(() => box.isConnected));
    return box;
  };
  cardsEl.replaceChildren();
  if (!cards.length) {
    cardsEl.append(unread ? retryPanel() : h('p', { class: 'st-cards-empty', text: STORY.cardsEmpty }));
    return;
  }
  const groups: Card[][] = [];
  for (const c of cards) {
    const g = groups[groups.length - 1];
    if (g && g[0].t === c.t) g.push(c);
    else groups.push([c]);
  }
  cardsEl.append(
    ...groups.map((g, i) => h('div', { class: `st-batch ${i ? 'is-older' : ''}` },
      i === 1 ? h('p', { class: 'st-batch-k', text: 'Earlier' }) : null, g.map(cardEl))),
  );
  if (unread) cardsEl.append(retryPanel());
  if (fresh && !reduced()) {
    const first = cardsEl.querySelector('.st-batch');
    if (first) animate(first as HTMLElement,
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 360, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
}
