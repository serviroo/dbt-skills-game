import { WINDOW } from '../motion/tokens';
import { animate } from '../ui/anim';
import type { ScreenOut } from './app';

const RISE = [
  { opacity: 0, transform: 'translateY(10px)' },
  { opacity: 1, transform: 'none' },
];
const FADE = [{ opacity: 0 }, { opacity: 1 }];
const LIVE = '[aria-live]:not([aria-live="off"]), [role="status"]';

type Words = { text: string | null; kids: ChildNode[] };
const wordsIn = (live: Element): Words => ({ text: live.textContent, kids: [...live.childNodes] });
const same = (a: Words, b: Words) =>
  a.text === b.text && a.kids.length === b.kids.length && a.kids.every((k, i) => b.kids[i] === k);

function sayAgainOnceIn(el: HTMLElement) {
  const regions = () => [...el.querySelectorAll(LIVE)];
  const before = new Map(regions().map((live) => [live, wordsIn(live)]));
  return () => {
    const lines = regions()
      .filter((live) => live.hasChildNodes())
      .map((live) => [live, wordsIn(live)] as const)
      .filter(([live, now]) => {
        const was = before.get(live);
        return !was || !same(was, now);
      });
    if (!lines.length) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const [live, then] of lines) {
        if (live.isConnected && same(then, wordsIn(live)) && !live.contains(document.activeElement)) {
          live.replaceChildren(...live.childNodes);
        }
      }
    }));
  };
}

export function bringIn(out: ScreenOut, quiet: boolean, reduced: () => boolean, onScreen: () => boolean) {
  const heading = quiet ? null : (out.el.querySelector<HTMLElement>('[data-focus]') ?? out.el.querySelector('h1'));
  heading?.setAttribute('tabindex', '-1');
  const enter = (waited: boolean) => {
    out.el.inert = false;
    out.el.style.visibility = '';
    if (!quiet) {
      const still = reduced();
      const timing = { duration: still ? WINDOW.reducedFadeMs : 300, easing: 'cubic-bezier(.16,1,.3,1)' };
      const a = animate(out.el, still ? FADE : RISE, timing);
      // drop the entrance transform so fixed elements inside the page (the story co-writer) sit on the screen
      a.finished.then(() => a.cancel(), () => {});
    }
    const free = !waited || !document.activeElement || document.activeElement === document.body;
    if (!free) return;
    for (const to of [...out.el.querySelectorAll<HTMLElement>('[role="alert"] [data-focus]'), heading]) {
      to?.focus({ preventScroll: true });
      if (to && document.activeElement === to) return;
    }
  };
  if (!out.ready) return enter(false);
  out.el.inert = true;
  out.el.style.visibility = 'hidden';
  const sayAgain = sayAgainOnceIn(out.el);
  void out.ready.then(() => {
    if (!onScreen()) return;
    enter(true);
    sayAgain();
  });
}
