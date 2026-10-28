// A still companion screen costs nothing. Real time, not ?capture, on a returning save with Motion: Reduced in Settings,
// so nothing on these screens moves once their fades are over.
//   idle-screens-ask-no-frames   Home, Settings and the Safe Zone ask for no animation frames once they are still. A
//                                Lantern window that holds on the UI clock still closes on time, also when the page is
//                                frozen and resumed while it holds, and the screen goes quiet again.
//   returning-launch-makes-no-3d a returning launch reaches Home without a WebGL context on the intro's canvas or a 3D
//                                stage (renderer and postprocessing); Replay cutscene in Settings makes the stage and
//                                draws the intro's first frame behind the title.
// Frames are counted by wrapping requestAnimationFrame, which still hands every callback to the browser's own.
import { settle } from './layout-fit.e2e.mjs';

const IDLE_MS = 1200;
const HOLD_SEC = 0.5;
/** How long the page stays frozen mid-hold. */
const FROZEN_MS = 1000;

const dayKey = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function returning() {
  const t = Date.now() - 86400e3;
  const day = dayKey(t);
  return JSON.stringify({ v: 1, created: t, events: [{ id: 'idle-visit', t, day, k: 'visit', xp: 10 }], flags: { greetDay: day }, settings: { motion: 'reduce' } });
}
const names = () => JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now(), companionAt: Date.now() });

// Runs before the app: counts every frame asked for, by the line that asked (ui: the UI clock's, src/ui/anim.ts)
const counter = () => {
  const raf = window.requestAnimationFrame;
  const asked = (window.__rafs = { n: 0, ui: 0, from: {} });
  window.requestAnimationFrame = function (cb) {
    asked.n++;
    const at = (new Error().stack ?? '').split('\n')[2]?.trim().replace(location.origin, '') ?? '?';
    asked.from[at] = (asked.from[at] ?? 0) + 1;
    if (at.includes('/src/ui/anim.ts')) asked.ui++;
    return raf.call(window, cb);
  };
  const get = HTMLCanvasElement.prototype.getContext;
  window.__gl = [];
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = get.call(this, type, ...rest);
    if (/webgl/i.test(type) && c) window.__gl.push(this.id || this.className || 'canvas');
    return c;
  };
};

/** The frames a still screen asks for in IDLE_MS, and the lines that asked for them. */
async function framesWhileStill(h, page) {
  await settle(page);
  const read = () => page.evaluate(() => ({ n: window.__rafs.n, from: { ...window.__rafs.from } }));
  const a = await read();
  await h.sleep(IDLE_MS);
  const b = await read();
  const from = Object.entries(b.from)
    .map(([at, n]) => [at, n - (a.from[at] ?? 0)])
    .filter(([, n]) => n)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([at, n]) => `${n}x ${at}`);
  return { frames: b.n - a.n, from };
}

/** Opens a Lantern window that holds `sec` on the UI clock, the way lanternMessage does with no buttons. */
const hold = (page, sec) =>
  page.evaluate((sec) => {
    window.__held = import('/src/ui/lantern-window.ts').then(({ lanternMessage }) => {
      const t = (window.__heldFrom = performance.now());
      return lanternMessage({ kind: 'info', icon: 'info', title: 'Notification', html: '<p class="center">Still here.</p>' }, { hold: sec }).then(() => performance.now() - t);
    });
  }, sec);

export const scenarios = {
  async 'idle-screens-ask-no-frames'(h) {
    const { ctx, page, errors } = await h.open({ [h.SAVE]: returning(), [h.YOU]: names(), 'dbt.app.v1': h.SEEN }, '?mute', undefined, (c) => c.addInitScript(counter));
    const seen = {};
    const busy = [];
    const still = async (where) => {
      const r = (seen[where] = await framesWhileStill(h, page));
      if (r.frames) busy.push(`${where}: ${r.frames} (${r.from.join('; ')})`);
    };
    await h.reachHub(page);
    await still('home');
    await h.openSettings(page);
    await still('settings');

    // the UI clock wakes for a window that holds on it, and sleeps again once it closed
    const win = page.locator('.sw-layer .sw');
    await hold(page, HOLD_SEC);
    await win.waitFor({ timeout: 5000 });
    await win.waitFor({ state: 'detached', timeout: 5000 });
    const ms = await page.evaluate(() => window.__held);
    // a clock that failed to wake would never close it; the ceiling only leaves room for a busy machine
    h.expect(ms >= HOLD_SEC * 1000 && ms < HOLD_SEC * 1000 + 5000, `the held window closed after ${Math.round(ms)} ms, not after its ${HOLD_SEC} s hold`);
    seen.held = { ms: Math.round(ms) };
    await still('settings after a held window');

    // frozen mid-hold (as a phone freezes a tab in the background) and resumed: the hold still ends. Chromium freezes
    // only hidden pages and a test page is never hidden, so the debugger stops it. The hold has begun once the UI clock
    // asks for a frame, which it does only while something waits on it. It lasts the freeze and HOLD_SEC more, and it
    // must still be holding when the page freezes, or nothing waits across the freeze
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Debugger.enable');
    const asked = await page.evaluate(() => window.__rafs.ui);
    const across = HOLD_SEC + FROZEN_MS / 1000;
    await hold(page, across);
    await win.waitFor({ timeout: 5000 });
    await page.waitForFunction((n) => window.__rafs.ui > n, asked, { timeout: 5000, polling: 50 });
    const into = await page.evaluate(() => performance.now() - window.__heldFrom);
    h.expect(into < across * 1000, `the page froze ${Math.round(into)} ms into the window's ${across} s hold, after the hold was over`);
    const stopped = new Promise((r) => cdp.once('Debugger.paused', () => r(true)));
    await cdp.send('Debugger.pause');
    h.expect(await Promise.race([stopped, h.sleep(5000).then(() => false)]), 'the debugger did not stop the page mid-hold');
    await h.sleep(FROZEN_MS);
    await cdp.send('Debugger.resume');
    await cdp.send('Debugger.disable');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await win.waitFor({ state: 'detached', timeout: 5000 });
    const frozenMs = await page.evaluate(() => window.__held);
    h.expect(frozenMs >= across * 1000, `the window held across the freeze closed after ${Math.round(frozenMs)} ms, before its ${across} s hold`);
    await still('settings after a freeze and resume');

    await page.getByRole('button', { name: 'Safe Zone, help right now' }).click();
    await page.waitForFunction(() => window.__daily.route.name === 'safe' && !!document.querySelector('.dq-sz-t'), null, { timeout: 10000 });
    await still('safe zone');
    h.expect(!busy.length, `still screens asked for frames in ${IDLE_MS} ms: ${busy.join(' | ')}`);
    h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
    await h.shot(page, 'idle-safe-zone');
    await ctx.close();
    return seen;
  },

  async 'returning-launch-makes-no-3d'(h) {
    const { ctx, page, errors } = await h.open({ [h.SAVE]: returning(), [h.YOU]: names(), 'dbt.app.v1': h.SEEN }, '?mute', undefined, (c) => c.addInitScript(counter));
    await h.reachHub(page);
    await settle(page);
    const home = await page.evaluate(() => ({ contexts: window.__gl.filter((id) => id === 'gl').length, stage: !!window.__stage }));
    h.expect(!home.contexts && !home.stage, `a returning launch set up the intro's 3D stage for Home: ${home.contexts} WebGL contexts on its canvas, stage ${home.stage}`);
    await h.shot(page, 'returning-home');

    await h.openSettings(page);
    await page.getByRole('button', { name: 'Replay cutscene' }).click();
    await page.locator('.title-screen').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => window.__e2eTrail?.frames > 0, null, { timeout: 10000 });
    const replay = await page.evaluate(() => ({ contexts: window.__gl.filter((id) => id === 'gl').length, stage: !!window.__stage, frames: window.__e2eTrail.frames }));
    h.expect(replay.contexts === 1 && replay.stage, `Replay cutscene did not make the 3D stage: ${replay.contexts} WebGL contexts on its canvas, stage ${replay.stage}`);
    h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
    await h.shot(page, 'replay-title');
    await ctx.close();
    return { home, replay };
  },
};
