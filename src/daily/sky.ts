/**
 * Home's sky follows the device's clock: dawn, day, dusk and night, where night is the companion's usual sky.
 * Each mood is a picture (public/sky/, made in Blender for this game). The pictures are stacked with night at the
 * bottom, and the mood is only a data-sky attribute on the companion root; daily.css fades the mood's picture in over
 * the others. Nothing is stored, and the clock is only watched while Home is open.
 */
import { SKY } from '../motion/tokens';

export type Mood = 'dawn' | 'day' | 'dusk' | 'night';
const MOODS: Mood[] = ['night', 'dawn', 'day', 'dusk'];

export function moodAt(d: Date): Mood {
  const h = d.getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

/** One copy of the sky: a layer per mood, decorative only. */
function layers(cls: string) {
  const el = document.createElement('div');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  for (const m of MOODS) {
    const i = document.createElement('i');
    i.className = `dq-sky-${m}`;
    el.append(i);
  }
  return el;
}

export class Sky {
  private watch = 0;
  /** the sky behind every screen */
  readonly back = layers('dq-sky');
  /** the same sky again, shown only behind the top bar so a page scrolled under the bar never shows through */
  readonly shade = layers('dq-sky dq-sky-top');

  constructor(
    private readonly root: HTMLElement,
    private readonly reduced: () => boolean,
  ) {}

  /** Every screen opening or closing. `fadeMs` is how long the sky takes to come in or go back to night (0 for at
   *  once, which also lands any fade still running from the screen before). */
  set(home: boolean, fadeMs: number) {
    if (home && !this.watch) this.watch = window.setInterval(() => this.paint(moodAt(new Date()), SKY.driftMs), SKY.checkMs);
    if (!home && this.watch) {
      clearInterval(this.watch);
      this.watch = 0;
    }
    this.paint(home ? moodAt(new Date()) : null, fadeMs);
  }

  private paint(mood: Mood | null, ms: number) {
    const fade = this.reduced() ? 0 : ms;
    const was = this.root.dataset.sky;
    if ((mood ?? undefined) !== was) {
      this.root.style.setProperty('--sky-ms', `${fade}ms`);
      // from one daytime mood to another, the old picture stays whole under the new one until that has come in, so
      // the drift never dips toward night on the way; night itself is the bottom layer, so it needs no help
      if (mood && mood !== 'night' && was && was !== 'night') this.root.dataset.skyWas = was;
      else delete this.root.dataset.skyWas;
      if (mood) this.root.dataset.sky = mood;
      else delete this.root.dataset.sky;
    }
    // a running transition keeps the duration it started with, so "at once" finishes it rather than waiting it out
    if (!fade) for (const el of [this.back, this.shade]) for (const a of el.getAnimations({ subtree: true })) if (a instanceof CSSTransition) a.finish();
  }
}
