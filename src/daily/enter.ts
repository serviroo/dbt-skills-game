import { WINDOW } from '../motion/tokens';
import { animate } from '../ui/anim';
import type { ScreenOut } from './app';

const RISE = [
  { opacity: 0, transform: 'translateY(10px)' },
  { opacity: 1, transform: 'none' },
];
const FADE = [{ opacity: 0 }, { opacity: 1 }];

export function bringIn(out: ScreenOut, quiet: boolean, reduced: () => boolean, onScreen: () => boolean) {
  const focus = quiet ? null : (out.el.querySelector<HTMLElement>('[data-focus]') ?? out.el.querySelector('h1'));
  focus?.setAttribute('tabindex', '-1');
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
    if (focus && free) focus.focus({ preventScroll: true });
  };
  if (!out.ready) return enter(false);
  out.el.inert = true;
  out.el.style.visibility = 'hidden';
  const go = () => onScreen() && enter(true);
  void out.ready.then(go, go);
}
