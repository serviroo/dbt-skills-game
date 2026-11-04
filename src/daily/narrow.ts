const NARROW_AT: [selector: string, ch: number][] = [
  ['.dq-ease-panel', 20],
  ['.dq-artentries', 24],
  ['.dq-art-pages', 24],
  ['.dq-liblist', 27],
];

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

export function narrowWithoutContainerQueries(root: HTMLElement) {
  if (CSS.supports('container-type', 'inline-size')) return () => {};
  const watched = new Set<Element>();
  const sizes = new ResizeObserver((entries) => {
    for (const { target, contentRect } of entries) {
      const ch = NARROW_AT.find(([selector]) => target.matches(selector))?.[1];
      if (ch) target.toggleAttribute('data-narrow', contentRect.width <= chWide(target, ch));
    }
  });
  const watch = () => {
    for (const el of watched) {
      if (el.isConnected) continue;
      sizes.unobserve(el);
      watched.delete(el);
    }
    for (const el of root.querySelectorAll(NARROW_AT.map(([selector]) => selector).join(', '))) {
      if (watched.has(el)) continue;
      watched.add(el);
      sizes.observe(el);
    }
  };
  const added = new MutationObserver(watch);
  added.observe(root, { childList: true, subtree: true });
  watch();
  return () => {
    added.disconnect();
    sizes.disconnect();
  };
}
