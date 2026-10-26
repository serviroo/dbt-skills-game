/**
 * Home's sky follows the device's clock: dawn, day, dusk and night, where night is the companion's usual sky.
 * The mood is only a data-sky attribute on the companion root; daily.css turns it into the two glow colours, which
 * are registered properties so they cross-fade. Nothing is stored, and the clock is only watched while Home is open.
 */
import { SKY } from '../motion/tokens';

export type Mood = 'dawn' | 'day' | 'dusk' | 'night';

export function moodAt(d: Date): Mood {
  const h = d.getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

export class Sky {
  private watch = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly reduced: () => boolean,
  ) {}

  /** Home opened or closed. `fadeMs` is how long the sky takes to come in or go back to night (0 for at once). */
  set(home: boolean, fadeMs: number) {
    if (home === !!this.watch) return;
    if (home) this.watch = window.setInterval(() => this.paint(moodAt(new Date()), SKY.driftMs), SKY.checkMs);
    else {
      clearInterval(this.watch);
      this.watch = 0;
    }
    this.paint(home ? moodAt(new Date()) : null, fadeMs);
  }

  private paint(mood: Mood | null, ms: number) {
    if ((mood ?? undefined) === this.root.dataset.sky) return;
    this.root.style.setProperty('--sky-ms', `${this.reduced() ? 0 : ms}ms`);
    if (mood) this.root.dataset.sky = mood;
    else delete this.root.dataset.sky;
  }
}
