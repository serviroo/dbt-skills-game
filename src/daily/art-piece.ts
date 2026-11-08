import { ART } from '../content/daily-lines';
import type { App, Route, ScreenOut, Visit } from './app';
import { icon } from './art';
import { allyCard, focusLater, prepImage, saveImage, savedText, store } from './artroom';
import { revOf, type DrawingRec } from './artstore';
import { PAGE, renderDrawing } from './ink';
import { dayLabel } from './lines';
import { btn, field, h, p, typo } from './ui';
import { wholeText } from './page-head';

export function pieceScreen(app: App, route: Route, visit: Visit): ScreenOut {
  const id = (route as Extract<Route, { name: 'piece' }>).id;
  const as = store(app);
  const body = h('div', { class: 'dq-piece-body' });
  let removed = false;
  let endRename = () => {};
  const missing = () => {
    endRename();
    body.replaceChildren(
      p('That page is no longer here.', 'dq-text dq-empty'),
      h(
        'div',
        { class: 'dq-actions' },
        btn('Art room', () => app.go({ name: 'art' }), { kind: 'quiet' }),
      ),
    );
  };
  const off = as.onRemove((gone) => {
    if (gone !== id) return;
    removed = true;
    missing();
  });
  // hidden while a removal's Undo lasts (from this tab or another): it shows as gone, and comes back with the Undo
  let hidden = false;
  const offShown = as.onChange(() => {
    void as.isShown(id).then((on) => {
      if (removed || on !== hidden) return;
      if (on) return app.go({ name: 'piece', id }, { replace: true, quiet: true });
      hidden = true;
      missing();
    });
  });
  let offChange = () => {};
  const el = h(
    'div',
    { class: 'dq-page dq-piece' },
    h('h1', { class: 'dq-sr', 'data-focus': '', text: 'Your page' }),
    body,
  );
  void (async () => {
    let rec = await as.get(id);
    const on = !!rec && (await as.isShown(id));
    if (!rec || !on || removed || hidden) {
      if (!removed) hidden = true;
      missing();
      return;
    }
    const ally = rec.kind === 'ally';
    const dpr = Math.min(2, devicePixelRatio || 1);
    const outW = Math.min(PAGE[rec.kind].w, Math.round(Math.min(560, innerWidth - 32) * dpr));
    let art: HTMLCanvasElement, card: HTMLElement | null;
    const draw = (r: DrawingRec) => {
      art = renderDrawing(r.strokes, r.kind, outW);
      art.className = 'dq-thumb';
      art.setAttribute('role', 'img');
      card = ally ? allyCard(app, r, art) : null;
      return card ?? art;
    };
    const artBox = h('div', { class: `dq-piece-art dq-piece-art--${rec.kind}` }, draw(rec));
    const status = h('p', { class: 'dq-hint', 'aria-live': 'polite' });
    void prepImage(rec);
    const title = h('h2', { class: 'dq-h1 dq-piece-h' });
    const day = p(dayLabel(rec.day), 'dq-small dq-piece-day');
    const fav = h(
      'button',
      {
        type: 'button',
        class: 'dq-btn dq-btn--quiet dq-piece-fav',
        'aria-pressed': 'false',
        onclick: () => {
          rec = { ...rec!, fav: !rec!.fav };
          paint();
          void as.setLabels(id, { fav: rec.fav });
        },
      },
      h('span', { class: 'dq-btn-ic', html: icon('star') }),
      h('span', { class: 'dq-btn-t', text: ART.favourite }),
    );
    const renameB = btn(ART.rename, () => openRename(), { kind: 'quiet', ic: 'pencil' });
    const labels = h('div', { class: 'dq-actions dq-piece-labels' }, fav, renameB);
    const form = h('div', { class: 'dq-piece-rename is-hidden', role: 'group', 'aria-label': ART.rename });
    let editing = false;
    // the name field opens over the page: Back and Escape close it like any sheet
    let renameDone: (() => void) | null = null;
    // what the drawing is called and whether it is a favourite, as it is stored now
    const paint = () => {
      const r = rec!;
      const name = r.name?.trim();
      wholeText(title, ally ? typo(name || 'Shadow ally') : name ? typo(name) : dayLabel(r.day));
      day.classList.toggle('is-hidden', ally || !name);
      fav.setAttribute('aria-pressed', String(!!r.fav));
      art.setAttribute(
        'aria-label',
        ally
          ? `${name || 'Shadow ally'}, your shadow ally`
          : name
            ? `${name}, your page from ${dayLabel(r.day)}`
            : `Your page from ${dayLabel(r.day)}`,
      );
      const cardName = card?.querySelector<HTMLElement>('.dq-allycard-name');
      if (cardName) wholeText(cardName, typo(name || 'Shadow ally'));
    };
    const closeRename = (focus: boolean) => {
      editing = false;
      renameDone?.();
      renameDone = null;
      form.classList.add('is-hidden');
      labels.classList.remove('is-hidden');
      if (focus) renameB.focus();
    };
    endRename = () => closeRename(false);
    const openRename = () => {
      const r = rec!;
      const f = field(ally ? ART.nameAsk : ART.pageNameAsk, {
        value: r.name ?? '',
        placeholder: ally ? 'Shadow ally' : dayLabel(r.day),
        max: 24,
        autocomplete: 'off',
      });
      let typed = false;
      f.input.addEventListener('input', () => (typed = true));
      const save = async () => {
        if (!editing) return;
        const name = f.input.value.trim().slice(0, 24);
        if (typed && name !== (rec!.name?.trim() ?? '')) await as.setLabels(id, { name });
        if (removed || !editing) return;
        closeRename(true);
        const now = await as.get(id);
        if (now && !removed) take(now);
      };
      // an Enter that confirms an IME composition (keyCode 229 in Safari) finishes the word, not the name
      f.input.addEventListener('keydown', (e) => {
        const k = e as KeyboardEvent;
        if (k.key !== 'Enter' || k.isComposing || k.keyCode === 229) return;
        k.preventDefault();
        void save();
      });
      form.replaceChildren(
        f.el,
        h(
          'div',
          { class: 'dq-actions' },
          btn('Save name', () => void save(), { kind: 'primary' }),
          btn('Cancel', () => closeRename(true), { kind: 'quiet' }),
        ),
      );
      editing = true;
      renameDone ??= app.sheet(() => {
        renameDone = null;
        closeRename(true);
      });
      labels.classList.add('is-hidden');
      form.classList.remove('is-hidden');
      f.input.focus();
      f.input.select();
    };
    // a name or favourite set here or in another tab shows at once; a newer version saved in another tab redraws the
    // drawing in place, so what Remove takes away is the version on screen
    const take = (now: DrawingRec) => {
      if (revOf(now) !== revOf(rec!)) artBox.replaceChildren(draw(now));
      rec = now;
      paint();
      if (ally) void prepImage(now);
    };
    offChange = as.onChange(() => {
      void as.get(id).then((now) => {
        if (!now || removed) return;
        take(now);
      });
    });
    const actions = h(
      'div',
      { class: 'dq-actions' },
      btn(
        ally ? 'Save card image' : 'Save image',
        async () => (status.textContent = savedText(await saveImage(rec!))),
        { kind: 'primary', ic: 'image' },
      ),
      btn('Keep drawing', () => app.go({ name: 'draw', kind: rec!.kind, id }), { kind: 'quiet', ic: 'brush' }),
      btn(
        ally ? 'Release' : 'Remove',
        () => {
          // it leaves every screen, in every tab, now and stays stored until the Undo runs out
          let done = false;
          removed = true;
          as.hide(id, revOf(rec!));
          const list = ally ? 'shadows' : 'art';
          const run = () => {
            if (done) return;
            done = true;
            // the list it went back to takes focus to it
            if (app.route.name === list) focusLater(id);
            as.unhide(id);
          };
          const end = () => {
            if (done) return;
            done = true;
            void as.remove(id);
          };
          const action = { label: 'Undo', run, end };
          visit.go({ name: list }, { replace: true, toast: { text: ally ? ART.released : ART.removed, action } });
        },
        { kind: 'link' },
      ),
    );
    paint();
    body.replaceChildren(
      artBox,
      h(
        'div',
        { class: 'dq-piece-side' },
        title,
        day,
        ally
          ? p(`Shadow ally, drawn ${dayLabel(rec.day)}. Part of your army.`, 'dq-text')
          : rec.prompt
            ? p(rec.prompt, 'dq-text dq-piece-prompt')
            : p('A free page.', 'dq-text dq-piece-prompt'),
        labels,
        form,
        actions,
        status,
      ),
    );
  })();
  return {
    el,
    title: 'Your page',
    mode: 'sub',
    bubbles: [1.6, 0.6],
    leave: () => {
      removed = true;
      endRename();
      off();
      offShown();
      offChange();
    },
  };
}
