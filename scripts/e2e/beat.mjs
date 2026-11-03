import { poll } from './harness.mjs';

/** Waits for the scene to load and start playing, the page's own work. */
export const playing = (page) => page.locator('.lb').first().waitFor({ state: 'attached', timeout: 60000 });

/** The intro drawing no frame for this long of the page running means it stopped. */
const STALL = 15000;

/**
 * Waits for check(arg), run in the page, to come true within `sec` more of the scene's clock. That clock moves a
 * tenth of a second a frame at most, so on a slow renderer each moment of the intro comes later in the page's time
 * than on a phone, but never later on its own clock: the wait counts the scene's clock, and fails sooner only when no
 * frame comes for STALL ms of the page running. `what` is what is waited for, for the failure.
 */
export async function onBeat(page, check, arg, sec, what) {
  // the frames the renderer really drew: the clock runs on without them once the WebGL context is lost
  const read = async () => {
    const [time, drawn] = await page.evaluate(() => [
      window.__stage.time,
      window.__stage.renderer.info.render.frame,
    ]);
    return { time, drawn, done: await page.evaluate(check, arg) };
  };
  let r = await read();
  const by = r.time + sec;
  const stalled = `the intro drew no frame for ${STALL / 1000} s of the page running, waiting for ${what}`;
  while (!r.done) {
    if (r.time > by) throw new Error(`waited ${sec} s of the scene's clock for ${what}`);
    const { drawn } = r;
    r = await poll(page, read, (n) => n.done || n.drawn !== drawn, stalled, { timeout: STALL, polling: 50 });
  }
}

/** Waits for `sel` to be on the page within `sec` more of the scene's clock. */
export const appears = (page, sel, sec) => onBeat(page, (sel) => !!document.querySelector(sel), sel, sec, sel);
