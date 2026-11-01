/** Small DOM vocabulary for the companion: one panel, one button, one chip, one switch, used everywhere. */
import { icon } from './art';
import { fillYou } from '../core/you';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (k === 'html') e.innerHTML = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

/** Typographic quotes and apostrophes for display copy, with {name} and {companion} filled in. */
export function typo(s: string) {
  return quotes(fillYou(s));
}

/** Typographic quotes and apostrophes alone, for copy whose names are filled in already (the intro's): a name is never
 *  read as a token, so a player named "{companion}" stays that. */
export function quotes(s: string) {
  return s
    .replace(/(^|[\s(\[—-])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/(^|[\s(\[])'/g, '$1‘')
    .replace(/'/g, '’');
}

/**
 * Where a name the player gave may break a word: the offsets a soft hyphen goes before, so that a word wider than its
 * line breaks with a hyphen, never bare. Browsers don't hyphenate capitalised English words themselves, and a name's
 * words mostly are. A word gets them when it is at least as wide as 7.5 ordinary letters, the most the narrowest line a
 * name takes holds (wide letters count 1.5, narrow ones 0.5), with 2 letters kept before a break and 3 after; words
 * narrower than that fit their line whole, so nothing else breaks.
 */
function softBreaks(s: string) {
  const width = (c: string) => (/[MWmwÆŒæœ]/.test(c) ? 1.5 : /[fijlrtIJ]/.test(c) ? 0.5 : 1);
  const at = new Set<number>();
  for (const m of s.matchAll(/\p{L}+/gu)) {
    if ([...m[0]].reduce((n, c) => n + width(c), 0) >= 7.5) for (const k of breaksIn(m[0], m.index)) at.add(k);
  }
  return at;
}

/** The offsets a run of letters `run`, at `start` in its text, may break before: 2 letters kept before a break, 3 after. */
function breaksIn(run: string, start: number) {
  const cs = [...run];
  const at: number[] = [];
  let k = start;
  cs.forEach((c, j) => {
    k += c.length;
    if (j >= 1 && j <= cs.length - 4) at.push(k);
  });
  return at;
}

/** A name past the one to three words Bodoni Moda sets (DESIGN.md), so set in Jost: `is-long` on its element. */
export const longName = (s: string) => s.trim().split(/\s+/).length > 3;

/**
 * `s` from `from` to `to`, with the soft hyphens its whole breaks there (so a highlighted part keeps them). They are
 * shy() marks, not characters, so the name reads, copies and finds as typed.
 */
export function breakable(s: string, from = 0, to = s.length) {
  const out = document.createDocumentFragment();
  let i = from;
  for (const k of softBreaks(s)) {
    if (k < from || k >= to) continue;
    out.append(s.slice(i, k), shy());
    i = k;
  }
  out.append(s.slice(i, to));
  out.normalize();
  return out;
}

// never inside words only a screen reader hears, an address (where a hyphen would read as part of it) or a field
const KEEP_OUT = '.dq-sr, .dq-a, dq-words, svg, textarea, select, option, [contenteditable]';

/**
 * An element of the words wholeWords and breakable() set (dq-words, dq-word and dq-shy in daily.css): no other rule's
 * selector meets it.
 */
function piece(tag: string, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  e.append(...kids.filter((k) => k !== ''));
  return e;
}

/** A soft hyphen drawn by CSS, kept out of what a screen reader hears, so a button's name reads as written. */
function shy() {
  const e = piece('dq-shy');
  e.setAttribute('aria-hidden', 'true');
  return e;
}

/** The words of each text in `node` set as dq-words, each word that can break whole in it, with its breaks. */
function setWhole(node: Node) {
  const texts: Text[] = [];
  if (node instanceof Text) texts.push(node);
  else for (let w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), t = w.nextNode(); t; t = w.nextNode()) texts.push(t as Text);
  for (const t of texts) {
    if (!t.parentElement || t.parentElement.closest(KEEP_OUT)) continue;
    const parts: (string | Node)[] = [];
    let from = 0;
    // a word, or a number its no-break spaces hold together
    for (const m of t.data.matchAll(/\S+(?:\u00A0\S+)*/g)) {
      // it breaks at a soft hyphen in a run of letters, or after a no-break space
      const breaks = new Map<number, () => Node>();
      for (const r of m[0].matchAll(/\p{L}+/gu)) for (const k of breaksIn(r[0], r.index)) breaks.set(k, shy);
      for (const r of m[0].matchAll(/\u00A0/g)) breaks.set(r.index + 1, () => h('wbr'));
      if (!breaks.size) continue;
      const at = [...breaks.keys()].sort((x, y) => x - y);
      const word = piece('dq-word', m[0].slice(0, at[0]));
      at.forEach((k, i) => word.append(breaks.get(k)!(), m[0].slice(k, at[i + 1])));
      parts.push(t.data.slice(from, m.index), word);
      from = m.index + m[0].length;
    }
    // one element for the whole text, as the text was one box in its parent, a flex row's too
    if (parts.length) t.replaceWith(piece('dq-words', ...parts, t.data.slice(from)));
  }
}

/**
 * Keeps the words in `root` whole, now and as they change: a word moves to the next line whole, and only one wider than
 * its line breaks, with a hyphen, where breakable() would break a name (a number its no-break spaces hold together breaks
 * after one of them). The soft hyphens are drawn by CSS and hidden from a screen reader, so the words read, copy and
 * search as written. Returns the stop.
 */
export function wholeWords(root: HTMLElement) {
  setWhole(root);
  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === 'characterData') setWhole(r.target);
      else r.addedNodes.forEach(setWhole);
    }
  });
  mo.observe(root, { subtree: true, childList: true, characterData: true });
  return () => mo.disconnect();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Display copy to HTML: escapes, typographic quotes, **bold** as Lantern emphasis. */
export function md(s: string) {
  return typo(esc(s)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
export function p(text: string, cls = 'dq-text') {
  return h('p', { class: cls, html: md(text) });
}

export function panel(opts: { title?: string; ic?: string; cls?: string; tag?: 'section' | 'div' | 'article'; label?: string } = {}, ...kids: (Child | Child[])[]) {
  const head = opts.title
    ? h('header', { class: 'dq-chip' }, opts.ic ? h('span', { class: 'dq-chip-ic', html: opts.ic }) : null, h('h2', { class: 'dq-chip-t', text: opts.title }))
    : null;
  return h(opts.tag ?? 'section', { class: `dq-panel ${opts.cls ?? ''}`, 'aria-label': opts.label ?? null }, head, ...kids);
}

export function btn(label: string, onclick: (e: Event) => void, opts: { kind?: 'primary' | 'quiet' | 'ghost' | 'link'; ic?: string; cls?: string; aria?: string } = {}) {
  return h(
    'button',
    { type: 'button', class: `dq-btn dq-btn--${opts.kind ?? 'primary'} ${opts.cls ?? ''}`, onclick, 'aria-label': opts.aria ?? null },
    opts.ic ? h('span', { class: 'dq-btn-ic', html: icon(opts.ic) }) : null,
    h('span', { class: 'dq-btn-t', text: typo(label) }),
  );
}

export function chip(label: string, onclick: (e: Event) => void, pressed?: boolean) {
  const b = h('button', { type: 'button', class: 'dq-opt', onclick }, h('span', { text: typo(label) }));
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
  return b;
}

export function row(...kids: (Child | Child[])[]) {
  return h('div', { class: 'dq-actions' }, ...kids);
}

/** Switch built on a real checkbox (role=switch), so keyboard and screen readers get it for free. */
export function toggle(label: string, on: boolean, change: (v: boolean) => void, hint?: string) {
  const id = `sw${Math.random().toString(36).slice(2, 8)}`;
  const input = h('input', { type: 'checkbox', role: 'switch', id, class: 'dq-switch-in', onchange: (e: Event) => change((e.target as HTMLInputElement).checked) });
  input.checked = on;
  return h(
    'div',
    { class: 'dq-setting' },
    h('label', { for: id, class: 'dq-setting-l' }, h('span', { class: 'dq-setting-t', text: label }), hint ? h('span', { class: 'dq-setting-h', text: hint }) : null),
    h('span', { class: 'dq-switch' }, input, h('span', { class: 'dq-switch-ui', 'aria-hidden': 'true' })),
  );
}

/**
 * Keys for a radio group, like any app: the group is one Tab stop (the checked radio, else the first that can be
 * picked), arrows move through it and wrap, Home and End go to the ends, and locked radios are skipped. Moving picks
 * as it goes; with `manual` (a group whose pick also does something, such as opening a screen) it only moves, and
 * Space or Enter picks. Taps work as before.
 */
export function radioKeys(group: HTMLElement, o: { manual?: boolean } = {}) {
  const radios = () => [...group.querySelectorAll<HTMLButtonElement>('[role=radio]')].filter((r) => r.closest('[role=radiogroup]') === group);
  const usable = (r: HTMLButtonElement) => !r.disabled && r.getAttribute('aria-disabled') !== 'true';
  const stop = (to?: HTMLButtonElement) => {
    const rs = radios();
    to ??= rs.find((r) => r === document.activeElement) ?? rs.find((r) => r.getAttribute('aria-checked') === 'true' && usable(r)) ?? rs.find(usable);
    rs.forEach((r) => (r.tabIndex = r === to ? 0 : -1));
  };
  group.addEventListener('keydown', (e) => {
    const k = e.key;
    const by = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 0;
    if ((!by && k !== 'Home' && k !== 'End') || e.altKey || e.ctrlKey || e.metaKey) return;
    const rs = radios().filter(usable);
    const from = rs.indexOf(e.target as HTMLButtonElement);
    if (from < 0) return;
    e.preventDefault();
    const to = k === 'Home' ? rs[0] : k === 'End' ? rs[rs.length - 1] : rs[(from + by + rs.length) % rs.length];
    if (to === e.target) return;
    stop(to);
    to.focus();
    if (!o.manual && to.getAttribute('aria-checked') !== 'true') to.click();
  });
  // leaving the group puts its Tab stop back on the checked radio
  group.addEventListener('focusout', (e) => {
    if (!group.contains(e.relatedTarget as Node | null)) stop(radios().find((r) => r.getAttribute('aria-checked') === 'true' && usable(r)) ?? radios().find(usable));
  });
  new MutationObserver(() => stop()).observe(group, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked', 'disabled'] });
  stop();
  return group;
}

/** Segmented single choice (radio semantics). value null = nothing chosen. */
export function segmented(name: string, values: (string | number)[], value: string | number | null, change: (v: string | number | null) => void, opts: { allowClear?: boolean; labels?: string[]; cls?: string; manual?: boolean } = {}) {
  const wrap = h('div', { class: `dq-seg ${opts.cls ?? ''}`, role: 'radiogroup', 'aria-label': name });
  let cur = value;
  const btns = values.map((v, i) => {
    const b = h('button', {
      type: 'button',
      role: 'radio',
      class: 'dq-seg-b',
      'aria-label': opts.labels ? `${name}: ${opts.labels[i]}` : `${name}: ${v}`,
      onclick: () => {
        cur = opts.allowClear && cur === v ? null : v;
        sync();
        change(cur);
      },
      text: opts.labels ? opts.labels[i] : String(v),
    });
    return b;
  });
  const sync = () => btns.forEach((b, i) => b.setAttribute('aria-checked', String(values[i] === cur)));
  sync();
  wrap.append(...btns);
  return radioKeys(wrap, { manual: opts.manual });
}

export function field(label: string, opts: { value?: string; placeholder?: string; lines?: number; type?: string; oninput?: (v: string) => void; max?: number; hideLabel?: boolean; autocomplete?: string; inputmode?: string } = {}) {
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  const common = {
    id,
    class: 'dq-input',
    placeholder: opts.placeholder ? typo(opts.placeholder) : null,
    maxlength: opts.max ?? 600,
    autocomplete: opts.autocomplete ?? 'off',
    autocapitalize: 'sentences',
    spellcheck: 'true',
    inputmode: opts.inputmode ?? null,
    oninput: (e: Event) => opts.oninput?.((e.target as HTMLInputElement).value),
  };
  const input = (opts.lines ?? 1) > 1 ? h('textarea', { ...common, rows: opts.lines }) : h('input', { ...common, type: opts.type ?? 'text', enterkeyhint: 'done' });
  input.value = opts.value ?? '';
  return { el: h('div', { class: 'dq-field' }, h('label', { for: id, class: `dq-label ${opts.hideLabel ? 'dq-sr' : ''}`, text: typo(label) }), input), input };
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { class: 'dq-sr' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function place(box: HTMLElement, kids: HTMLElement[], fallback?: () => HTMLElement | null | undefined) {
  const keep = new Set<Element>(kids);
  const was = [...box.children];
  const lost = was.findIndex((c) => !keep.has(c) && c.contains(document.activeElement));
  for (const c of was) if (!keep.has(c)) c.remove();
  kids.forEach((k, i) => {
    if (box.children[i] !== k) box.insertBefore(k, box.children[i] ?? null);
  });
  if (lost < 0) return;
  const next = was.slice(lost + 1).find((c) => keep.has(c)) ?? was.slice(0, lost).reverse().find((c) => keep.has(c));
  const to = next?.querySelector<HTMLElement>('[aria-checked="true"]') ?? next?.querySelector<HTMLElement>('button, input, textarea') ?? fallback?.();
  to?.focus({ preventScroll: true });
}

/**
 * Part of a screen drawn from the player's own data (null draws nothing), which `update` draws again in place when what
 * it shows changed: in another open copy, or by a clear. `node` is what shows now, and `update` says whether it drew;
 * `update(true)` draws it even when the drawing is the same, for a screen that showed something else in its place.
 * Focus on a control that goes moves to that same control drawn again (the same item's, by the data-item id of the row
 * it is in, with the same name and link: its label, else its words), else to `lost`, never to a control of someone or
 * something else. It goes only where the player can see it, brought whole into view, focus ring and all, clear of the
 * pinned bars (their scroll padding in daily.css). What the player is looking at stays put (see holdView), and a box
 * in it that the player scrolled stays scrolled (see keepScrolled).
 */
/** The nearest box that scrolls `e`, else the page. */
export function scrollerOf(e: Element) {
  for (let p = e.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
  return document.scrollingElement as HTMLElement | null;
}

/** The top of what `box` shows, under its pinned bars (its scroll padding). */
const viewTop = (box: Element) => (box === document.scrollingElement ? 0 : box.getBoundingClientRect().top) + (parseFloat(getComputedStyle(box).scrollPaddingTop) || 0);

type Span = { top: number; bottom: number };
/** Where `e` reaches on screen, top to bottom; one with no box of its own (display: contents) spans its children. */
function span(e: Element): Span | null {
  if (e.getClientRects().length) return e.getBoundingClientRect();
  const kids = [...e.children].map(span).filter((r): r is Span => !!r);
  return kids.length ? { top: Math.min(...kids.map((r) => r.top)), bottom: Math.max(...kids.map((r) => r.bottom)) } : null;
}

/** Notes where `e`'s top (or bottom) is on screen; what it returns scrolls so `to` has it there again. */
function pin(e: Element, edge: 'top' | 'bottom' = 'top') {
  const box = scrollerOf(e);
  const at = span(e)?.[edge];
  return (to: Element) => {
    const now = to.isConnected ? span(to)?.[edge] : undefined;
    if (box && at !== undefined && now !== undefined) box.scrollTop += now - at;
  };
}

type Held = (now?: { focus?: Element | null; part?: Element | null }) => void;
/**
 * Before `part` of a screen changes: notes what the player is looking at, so it stays where it is after. That is the
 * control with focus, if it is on this screen; else, with `part` partly in view, the first item in view (a row with
 * its data-item id, found again by that id when it is drawn anew), else the first of its children in view (or, if that
 * went, `part`'s top); else, with all of `part` above what is in view, what follows it. Call the result once the change
 * is made, with the control drawn in place of the focused one if that went, and with what stands in `part`'s place now.
 */
export function holdView(part: Element | null): Held {
  const box = part && scrollerOf(part);
  if (!part || !box) return () => {};
  const f = document.activeElement;
  if (f instanceof HTMLElement && f !== document.body && scrollerOf(f) === box) {
    const back = pin(f);
    return ({ focus } = {}) => {
      const to = f.isConnected ? f : focus;
      if (to) back(to);
    };
  }
  const at = span(part);
  if (!at) return () => {};
  const top = viewTop(box);
  if (at.bottom <= top) {
    const back = pin(part, 'bottom');
    return ({ part: now } = {}) => now && back(now);
  }
  if (at.top >= top) return () => {};
  const inView = (e: Element) => (span(e)?.bottom ?? -Infinity) > top;
  const item = [...part.querySelectorAll('[data-item]')].find(inView);
  const id = item?.getAttribute('data-item');
  const kid = item ?? [...part.children].find(inView);
  const backKid = kid && pin(kid);
  const back = pin(part);
  return ({ part: now } = {}) => {
    const again = kid?.isConnected ? kid : id != null ? now?.querySelector(`[data-item="${CSS.escape(id)}"]`) : null;
    if (again && backKid) backKid(again);
    else if (now) back(now);
  };
}

/** Whether the player can see `e`: shown, with a size, and not hidden from anyone, a screen reader's eyes only included. */
export const seen = (e: HTMLElement) => {
  const r = e.getBoundingClientRect();
  return e.checkVisibility({ visibilityProperty: true }) && r.width > 0 && r.height > 0 && !e.closest('[aria-hidden="true"], [inert], .dq-sr');
};

/**
 * Before `part` is drawn anew: notes each box in it, `part` too, that is scrolled from its start (ratings wider than the
 * screen, say). The result scrolls the same box drawn anew, found by its row's data-item id, its classes and its label,
 * back to where it was.
 */
function keepScrolled(part: ChildNode) {
  if (!(part instanceof Element)) return () => {};
  const key = (e: Element) => [e.closest('[data-item]')?.getAttribute('data-item'), e.getAttribute('class'), e.getAttribute('aria-label')].join('\n');
  const boxes = (p: Element) => [p, ...p.querySelectorAll('*')];
  const was = boxes(part);
  const kept = was.filter((e) => e.scrollLeft || e.scrollTop).map((e) => ({ key: key(e), nth: was.filter((o) => key(o) === key(e)).indexOf(e), left: e.scrollLeft, top: e.scrollTop }));
  return (now: ChildNode) => {
    if (!kept.length || !(now instanceof Element)) return;
    const is = boxes(now);
    for (const k of kept) {
      const e = is.filter((o) => key(o) === k.key)[k.nth];
      if (!e) continue;
      e.scrollLeft = k.left;
      e.scrollTop = k.top;
    }
  };
}

export function redrawn(draw: () => Element | null, lost: () => HTMLElement | null) {
  const make = () => draw() ?? document.createComment('');
  const html = (n: ChildNode) => (n instanceof Element ? n.outerHTML : '');
  let node = make();
  // what it showed as drawn: a map the player opened since is not a change
  let shown = html(node);
  return {
    get node() {
      return node;
    },
    update(again = false) {
      const next = make();
      const now = html(next);
      if (now === shown && !again) return false;
      const had = document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement : null;
      const hold = holdView(node instanceof Element ? node : node.parentElement);
      const scrolled = keepScrolled(node);
      node.replaceWith(next);
      scrolled(next);
      node = next;
      shown = now;
      if (!had) {
        hold({ part: next instanceof Element ? next : null });
        return true;
      }
      const item = (e: Element) => e.closest('[data-item]')?.getAttribute('data-item') ?? null;
      const name = (e: Element) => e.getAttribute('aria-label') ?? e.textContent;
      const like = (e: Element) => item(e) === item(had) && name(e) === name(had) && e.getAttribute('href') === had.getAttribute('href');
      const same = next instanceof Element ? [...next.querySelectorAll<HTMLElement>('a[href], button, summary')].find(like) : undefined;
      const to = [same, lost()].find((e): e is HTMLElement => !!e && seen(e));
      hold({ focus: to === same ? to : null });
      if (to) focusWhole(to);
      return true;
    },
  };
}

/** Focuses `to` and brings all of it into view, focus ring and all, clear of the pinned bars. */
export function focusWhole(to: HTMLElement) {
  to.focus({ preventScroll: true });
  // the ring is drawn outside the box, by its width and gap: the scroll takes it in too, past whatever scroll margin the
  // control has of its own
  const cs = getComputedStyle(to);
  const ring = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) + Math.max(0, parseFloat(cs.outlineOffset));
  const own = to.style.scrollMargin;
  to.style.scrollMargin = (['Top', 'Right', 'Bottom', 'Left'] as const).map((s) => `${parseFloat(cs[`scrollMargin${s}`]) + ring}px`).join(' ');
  to.scrollIntoView({ block: 'nearest' });
  to.style.scrollMargin = own;
}

export function sr(text: string) {
  return h('span', { class: 'dq-sr', text });
}

/** Share sheet with the file where the device offers it (iPhone: Save Image / Save to Files), a download otherwise. */
export async function shareOrSave(data: BlobPart, filename: string, type: string) {
  const file = new File([data], filename, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}
