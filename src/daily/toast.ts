import { animate } from '../ui/anim';
import { wait } from './clock';
import { h, typo } from './ui';

export interface ToastAction {
  label: string;
  run(): void;
  end?(): void;
}

export interface Note {
  text: string;
  action?: ToastAction;
  after?: number;
}

export class Toaster {
  readonly el = h('div', { class: 'dq-toast', role: 'status', 'aria-live': 'polite' });
  private n = 0;
  /** what happens when the toast showing now goes without its action being taken */
  private end: (() => void) | null = null;

  constructor(private readonly reduced: () => boolean) {}

  /**
   * A short message at the bottom, with an optional action (Undo). Its end runs once if the toast goes without the
   * action: it ran out, another toast took its place, they left for a screen it wasn't for, or the Safe Zone opened.
   */
  show(text: string, action?: ToastAction) {
    this.ended();
    const n = ++this.n;
    this.end = action?.end ?? null;
    this.el.replaceChildren(h('span', { text: typo(text) }));
    if (action)
      this.el.append(
        h('button', {
          type: 'button',
          class: 'dq-toast-btn',
          text: action.label,
          onclick: () => {
            // once the toast has gone, what it offered to undo has landed
            if (n !== this.n) return;
            this.n++;
            this.end = null;
            this.el.classList.remove('is-on');
            action.run();
          },
        }),
      );
    this.el.classList.add('is-on');
    const from = { opacity: 0, transform: 'translate(-50%, 8px)' };
    const to = { opacity: 1, transform: 'translate(-50%, 0)' };
    animate(this.el, [from, to], { duration: this.reduced() ? 1 : 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    void wait(action ? 6 : 5).then(async () => {
      if (n !== this.n) return;
      // the action still works while the toast fades; its end lands once the toast is gone
      animate(this.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-in' });
      await wait(0.24);
      if (n !== this.n) return;
      this.n++;
      this.el.classList.remove('is-on');
      this.ended();
    });
  }

  /** Takes the toast away at once: a screen it wasn't for, the Safe Zone opening, or the game being cleared. */
  drop() {
    this.n++;
    this.el.classList.remove('is-on');
    this.ended();
  }

  private ended() {
    const end = this.end;
    this.end = null;
    end?.();
  }
}
