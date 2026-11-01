/**
 * The player's own lists (comfort kit, go-to activities, things that are yours, people) as entries they can change in
 * place. Edit opens an entry's words, or a person's name and number, filled in, with Save and Cancel; Move up and Move
 * down set the order every list shows. The rows follow another open copy's changes as they land, and what the player
 * is on or looking at stays put (see holdView): an open edit keeps its words and focus, and a moved entry keeps focus on
 * the button that moved it, in view. Nothing here plays a sound or credits anything, in the Safe Zone or out of it.
 */
import { ENTRY_COPY } from '../content/dbt';
import type { App } from './app';
import { icon } from './art';
import type { Item, Person } from './store';
import { btn, field, focusWhole, h, holdView, typo } from './ui';

type Entry = Item | Person;
const nameOf = (x: Entry) => ('text' in x ? typo(x.text) : x.name);
/** A control's name among its row's: what it does, else its label, else its words. */
const actOf = (e: HTMLElement) => e.dataset.act ?? e.getAttribute('aria-label') ?? e.textContent;

export interface EntryOpts<T extends Entry> {
  key: 'comfort' | 'activities' | 'reasons' | 'people';
  /** the list's class, and each row's */
  cls: string;
  row: string;
  /** what a row shows ahead of its controls */
  view: (x: T) => (Node | null)[];
  /** a control after Edit and the moves, among them (Remove, on Comfort) */
  end?: (x: T) => HTMLElement;
  /** what shows in the list's place while it is empty */
  empty?: () => HTMLElement;
  /** where focus goes when the entry it was on goes */
  lost: () => HTMLElement | null;
  /** says where a moved entry is now, politely, to a screen reader */
  say: (t: string) => void;
  /** an item's words when they are cleared */
  hint?: string;
  /** Edit and the moves show only after "Edit the list" (the Safe Zone, kept calm), else always */
  toggle?: boolean;
  /**
   * Remove among Edit and the moves, its Undo shown in the removed entry's place until editing ends: for the Safe Zone,
   * which shows no toasts
   */
  removable?: boolean;
}

export function entryList<T extends Entry>(app: App, o: EntryOpts<T>) {
  const st = app.store;
  const list = () => st.state.lists[o.key] as T[];
  let tools = !o.toggle;
  let rows = new Map<string, { el: HTMLElement; sig: string }>();
  let editing: { id: string; el: HTMLElement; done: () => void } | null = null;
  /** the entry just removed here, in its place with Undo, until it is back, another one goes or editing ends */
  let gone: { item: T; el: HTMLElement } | null = null;
  /** the control focus goes to once a change made here lands: its save draws the list again */
  let then: { id: string; act: string } | undefined;
  const ul = h('ul', { class: o.cls });
  const blank = o.empty?.() ?? document.createComment('');
  let node: HTMLElement | Comment = ul;

  const tool = (act: string, ic: string, label: string, run: () => void) => {
    const b = h('button', { type: 'button', class: 'dq-icbtn dq-icbtn--sm', 'data-act': act, 'aria-label': label, html: icon(ic) });
    // at the top or the bottom it stays where it is, focus included, and says it can't go further
    b.addEventListener('click', () => b.getAttribute('aria-disabled') !== 'true' && run());
    return b;
  };
  const move = (id: string, by: -1 | 1) => {
    if (!st.moveItem(list(), id, by)) return;
    const now = list();
    const i = now.findIndex((x) => x.id === id);
    o.say(ENTRY_COPY.moved(nameOf(now[i]), i + 1, now.length));
  };
  const remove = (id: string) => {
    const out = st.removeItem(list(), id);
    if (!out) return;
    const back = btn(ENTRY_COPY.undo, () => {
      if (gone?.item.id !== id) return;
      st.reviveItem(list(), gone.item);
      gone = null;
      then = { id, act: 'remove' };
      st.save();
    }, { kind: 'quiet', aria: ENTRY_COPY.undoFor(nameOf(out.item)) });
    back.dataset.act = 'undo';
    gone = { item: out.item, el: h('li', { class: `${o.row} dq-entry-gone`, 'data-item': id }, h('span', { class: 'dq-entry-t', text: ENTRY_COPY.removed(nameOf(out.item)) }), back) };
    then = { id, act: 'undo' };
    st.save();
  };
  const draw = (x: T) =>
    h(
      'li',
      { class: o.row, 'data-item': x.id },
      ...o.view(x),
      tools
        ? h(
            'span',
            { class: 'dq-entry-tools' },
            tool('edit', 'pencil', ENTRY_COPY.edit(nameOf(x)), () => open(x.id)),
            tool('up', 'up', ENTRY_COPY.up(nameOf(x)), () => move(x.id, -1)),
            tool('down', 'down', ENTRY_COPY.down(nameOf(x)), () => move(x.id, 1)),
            o.removable ? tool('remove', 'close', ENTRY_COPY.remove(nameOf(x)), () => remove(x.id)) : null,
            o.end?.(x) ?? null,
          )
        : null,
    );

  /** Closes the open edit, dropping what was typed in it; with `back`, focus goes to that entry's Edit. */
  const shut = (back: boolean) => {
    if (!editing) return;
    const { id, done } = editing;
    editing = null;
    done();
    update(back ? { id, act: 'edit' } : undefined);
  };
  const open = (id: string) => {
    const x = list().find((e) => e.id === id);
    if (!x) return;
    shut(false);
    const fields =
      'name' in x
        ? [field(ENTRY_COPY.name, { value: x.name, placeholder: ENTRY_COPY.name, max: 80 }), field(ENTRY_COPY.number, { value: x.phone, placeholder: ENTRY_COPY.numberHint, type: 'tel', inputmode: 'tel', max: 40 })]
        : [field(ENTRY_COPY.words, { value: x.text, placeholder: o.hint, max: 200, hideLabel: true })];
    const save = () => {
      const [a, b = ''] = fields.map((f) => f.input.value.trim());
      if (!a) return fields[0].input.focus();
      const now = list().find((e) => e.id === id);
      if (now && ('name' in now ? now.name !== a || now.phone !== b : now.text !== a)) st.changeItem(list(), id, 'name' in now ? { name: a, phone: b } : { text: a });
      shut(true);
    };
    // an Enter that confirms an IME composition (keyCode 229 in Safari) finishes the word, not the edit
    for (const f of fields)
      f.input.addEventListener('keydown', (e) => {
        const k = e as KeyboardEvent;
        if (k.key !== 'Enter' || k.isComposing || k.keyCode === 229) return;
        k.preventDefault();
        save();
      });
    const el = h(
      'li',
      { class: `${o.row} is-editing`, 'data-item': id },
      h('div', { class: 'dq-entry-edit', role: 'group', 'aria-label': ENTRY_COPY.edit(nameOf(x)) }, fields.map((f) => f.el), h('div', { class: 'dq-actions' }, btn(ENTRY_COPY.save, save, { kind: 'quiet' }), btn(ENTRY_COPY.cancel, () => shut(true), { kind: 'quiet' }))),
    );
    // Back and Escape close it like any panel, what was typed dropped
    editing = { id, el, done: app.sheet(() => shut(true)) };
    const first = fields[0].input;
    first.dataset.act = 'field';
    // the words stay as they are, ready to fix one letter, never selected to be typed over
    first.setSelectionRange(first.value.length, first.value.length);
    update({ id, act: 'field' });
  };

  const flip = o.toggle
    ? btn(ENTRY_COPY.editList, () => {
        tools = !tools;
        gone = null;
        shut(false);
        update();
      }, { kind: 'quiet', ic: 'pencil', cls: 'dq-entry-flip' })
    : null;

  /**
   * Draws the list as it is now. A row whose words and controls are the same stays the same element, and the row with
   * focus never leaves the page: the rest are put in order around it. With `want` (else the one a change made here
   * left), focus goes to that control of that entry's row.
   */
  function update(want = then) {
    then = undefined;
    const items = list();
    // back in the list (Undo, or brought back in another open copy), or its removal no longer kept (this game's data
    // cleared, here or in another copy): its Undo goes, and nothing of it stays
    if (gone && (items.some((x) => x.id === gone!.item.id) || !Object.hasOwn(st.state.gone, gone.item.id))) gone = null;
    const f = document.activeElement;
    const was = f instanceof HTMLElement && node.contains(f) ? f : null;
    const from = was?.closest('[data-item]')?.getAttribute('data-item');
    const hold = holdView(node instanceof Element ? node : node.parentElement);
    if (editing && !items.some((x) => x.id === editing!.id)) {
      editing.done();
      editing = null;
    }
    const any = items.length > 0 || !!gone;
    if (!any) tools = !o.toggle;
    const next = new Map<string, { el: HTMLElement; sig: string }>();
    const els = items.map((x) => {
      const sig = editing?.id === x.id ? '' : JSON.stringify([tools, 'text' in x ? typo(x.text) : [x.name, x.phone]]);
      const had = rows.get(x.id);
      const el = editing?.id === x.id ? editing.el : had && had.sig === sig ? had.el : draw(x);
      next.set(x.id, { el, sig });
      return el;
    });
    els.forEach((e, i) => {
      e.querySelector('[data-act="up"]')?.setAttribute('aria-disabled', String(i === 0));
      e.querySelector('[data-act="down"]')?.setAttribute('aria-disabled', String(i === els.length - 1));
    });
    if (gone) {
      const g = gone.item;
      const at = items.findIndex((x) => x.place > g.place || (x.place === g.place && x.id > g.id));
      els.splice(at < 0 ? els.length : at, 0, gone.el);
      next.set(g.id, { el: gone.el, sig: '' });
    }
    rows = next;
    const kids = [...ul.children];
    const moved = kids.length !== els.length || els.some((e, i) => kids[i] !== e);
    if (moved) {
      for (const c of kids) if (!els.includes(c as HTMLElement)) c.remove();
      const pivot = was && els.find((e) => e.contains(was));
      const i = pivot ? els.indexOf(pivot) : -1;
      if (i < 0) ul.replaceChildren(...els);
      else {
        pivot!.before(...els.slice(0, i));
        pivot!.after(...els.slice(i + 1));
      }
    }
    const shown = any ? ul : blank;
    if (node !== shown) {
      node.replaceWith(shown);
      node = shown;
    }
    if (flip) {
      flip.querySelector('.dq-btn-t')!.textContent = tools ? ENTRY_COPY.doneList : ENTRY_COPY.editList;
      flip.querySelector('.dq-btn-ic')!.innerHTML = icon(tools ? 'check' : 'pencil');
      const to = !any && document.activeElement === flip ? o.lost() : null;
      if (to) focusWhole(to);
      flip.classList.toggle('is-hidden', !any);
    }
    const reach = (e: HTMLElement | null | undefined) => e && focusWhole(e);
    if (want) return reach(rows.get(want.id)?.el.querySelector<HTMLElement>(`[data-act="${want.act}"]`) ?? o.lost());
    if (!was || was.isConnected) {
      hold({ part: node instanceof Element ? node : null });
      return void (was && moved && reach(was));
    }
    // its row drawn anew (changed in another open copy): the same control there, else where `lost` says
    const same = [...(rows.get(from ?? '')?.el.querySelectorAll<HTMLElement>('a[href], button') ?? [])].find((e) => actOf(e) === actOf(was));
    hold({ focus: same ?? null });
    reach(same ?? o.lost());
  }

  update();
  return {
    get node() {
      return node;
    },
    /** "Edit the list" where Edit and the moves wait for it, else null */
    flip,
    update: () => update(),
    /** Leaving: an open edit closes, what was typed in it dropped. */
    leave: () => shut(false),
  };
}
