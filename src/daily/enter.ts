import { animate } from '../ui/anim';
import { WINDOW } from '../motion/tokens';
import type { ScreenOut } from './app';

const RISE = [
  { opacity: 0, transform: 'translateY(10px)' },
  { opacity: 1, transform: 'none' },
];
const FADE = [{ opacity: 0 }, { opacity: 1 }];

export function enterScreen(out: ScreenOut, o: { quiet?: boolean; reduced: () => boolean; current: () => boolean }) {
  const focus = o.quiet ? null : (out.el.querySelector<HTMLElement>('[data-focus]') ?? out.el.querySelector('h1'));
  focus?.setAttribute('tabindex', '-1');
  const come = (waited: boolean) => {
    out.el.inert = false;
    out.el.style.visibility = '';
    if (!o.quiet) {
      const still = o.reduced();
      const a = animate(out.el, still ? FADE : RISE, {
        duration: still ? WINDOW.reducedFadeMs : 300,
        easing: 'cubic-bezier(.16,1,.3,1)',
      });
      // drop the entrance transform so fixed elements inside the page (the story co-writer) sit on the screen
      a.finished.then(() => a.cancel(), () => {});
    }
    // still this screen, and nothing else was focused while it waited
    const free = !document.activeElement || document.activeElement === document.body;
    if (focus && (!waited || free)) focus.focus({ preventScroll: true });
  };
  if (!out.ready) return come(false);
  out.el.inert = true;
  out.el.style.visibility = 'hidden';
  const go = () => o.current() && come(true);
  void out.ready.then(go, go);
}
