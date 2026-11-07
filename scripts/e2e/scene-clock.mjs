import * as pageClock from './clock.mjs';

export const scenes = (page) =>
  page.evaluate(() => (window.__scenes ? JSON.parse(JSON.stringify(window.__scenes)) : null));

/** The scene's probe after jumping the page clock forward `ms` and letting a few frames draw. */
export async function after(h, page, ms) {
  // the page clock is stopped: the jump runs the next animation frame once, which draws the scene at the new moment
  if (ms > 0) await pageClock.fastForward(page, Math.round(ms));
  return (await scenes(page)).last;
}

export async function* steps(h, page, where, ms, { run = false } = {}) {
  const first = (await scenes(page)).last;
  for (let ran = 0, at = first; ; ran += ms) {
    yield at;
    h.expect(
      ran < first.dur * 1000,
      `${where}: the scene stopped drawing at e=${at.e.toFixed(1)} s, ${ran / 1000} s on, ` +
        `past the step's ${first.dur} s (${JSON.stringify(at)})`,
    );
    at = run ? (await pageClock.runFor(page, ms), (await scenes(page)).last) : await after(h, page, ms);
  }
}

async function stepWhenDrawn(page, stage) {
  const drawn = await page.evaluate((sel) => {
    const gl = document.querySelector(sel)?.getContext('webgl2');
    if (!gl || gl.isContextLost() || !(window.__scenes?.frames > 0)) return false;
    if (!gl.isSync(window.__probeFence ?? null)) {
      window.__probeFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      return false;
    }
    if (gl.getSyncParameter(window.__probeFence, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
    gl.deleteSync(window.__probeFence);
    window.__probeFence = null;
    return true;
  }, `${stage} .dq-scene canvas`);
  if (drawn) await pageClock.runFor(page, 16);
}

/**
 * Waits, with the page clock stopped, until the scene shows: it shows once its first frame is drawn, which it looks for
 * on animation frames, so the clock is stepped a frame at a time once the GPU has drawn all it was given. The scene's
 * time then starts from where it first shows, however long the GPU took, and moves only when a check moves it.
 */
export async function showsStopped(h, page, where, stage = '.dq-timer-stage') {
  const live = async () => {
    if ((await page.locator(`${stage}.is-scene-live`).count()) > 0) return true;
    await stepWhenDrawn(page, stage);
    return false;
  };
  const missing = `${where}: the 3D scene never came on screen`;
  await h.poll(page, live, Boolean, missing, { timeout: 30000, polling: 0 }).catch(async (e) => {
    await h.shot(page, `fail-${where.replace(/\W+/g, '-')}`);
    throw e;
  });
}
