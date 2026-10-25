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
  return fillYou(s)
    .replace(/(^|[\s(\[—-])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/(^|[\s(\[])'/g, '$1‘')
    .replace(/'/g, '’');
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

/** Segmented single choice (radio semantics). value null = nothing chosen. */
export function segmented(name: string, values: (string | number)[], value: string | number | null, change: (v: string | number | null) => void, opts: { allowClear?: boolean; labels?: string[]; cls?: string } = {}) {
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
  return wrap;
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
