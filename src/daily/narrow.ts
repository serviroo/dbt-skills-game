const NARROW_AT: [selector: string, ch: number][] = [
  ['.dq-ease-panel', 20],
  ['.dq-artentries', 24],
  ['.dq-art-pages', 24],
  ['.dq-liblist', 27],
];
const NARROWS = NARROW_AT.map(([selector]) => selector).join(', ');

function chWide(el: Element, ch: number) {
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.width = `${ch}ch`;
  el.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

function fit(el: Element) {
  const ch = NARROW_AT.find(([selector]) => el.matches(selector))?.[1];
  if (!ch || !el.isConnected) return;
  const style = getComputedStyle(el);
  const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  el.toggleAttribute('data-narrow', width <= chWide(el, ch));
}

export function watchNarrow(root: HTMLElement) {
  const watched = new Set<Element>();
  const sizes = new ResizeObserver((entries) => {
    const resized = entries.map((e) => e.target);
    requestAnimationFrame(() => resized.forEach(fit));
  });
  const add = (el: Element) => {
    if (watched.has(el)) return;
    watched.add(el);
    fit(el);
    sizes.observe(el);
  };
  const watch = (changes: MutationRecord[]) => {
    for (const el of watched) {
      if (el.isConnected) continue;
      sizes.unobserve(el);
      watched.delete(el);
    }
    for (const { addedNodes } of changes) {
      for (const node of addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(NARROWS)) add(node);
        node.querySelectorAll(NARROWS).forEach(add);
      }
    }
  };
  const refit = () => watched.forEach(fit);
  const added = new MutationObserver(watch);
  added.observe(root, { childList: true, subtree: true });
  document.fonts.addEventListener('loadingdone', refit);
  root.querySelectorAll(NARROWS).forEach(add);
  return () => {
    added.disconnect();
    sizes.disconnect();
    document.fonts.removeEventListener('loadingdone', refit);
  };
}
