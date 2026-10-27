import fs from 'node:fs';
import path from 'node:path';

const VIEWPORTS = [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }];
const PHONE = VIEWPORTS[0];
const CLOSE_MS = 1500;
// the 3D scene is only a backdrop to these DOM checks: drawn light, as other DOM checks draw it, and at one size, so a
// software renderer neither stalls the page for seconds nor resizes the canvas while a tap or a close is being timed
const LIGHT = '&nopost&msaa=0&dpr=1';
const LIVENESS_MS = 30000;
const BODY = '<p>The Lantern keeps a light for you. It stays on through the night and waits while you rest.</p>';
const GOT_IT = { kind: 'info', title: 'Notification', html: BODY, actions: [{ label: 'Got it', value: 'ok' }] };
const TAP_ON = { kind: 'notification', title: 'Notification', html: BODY, tapToContinue: true };
const tokens = fs.readFileSync(new URL('../../src/motion/tokens.ts', import.meta.url), 'utf8');
/** A motion token's number, as written in tokens.ts; a missing or computed one stops the run instead of skipping checks. */
const token = (k) => {
  const v = Number(new RegExp(`\\b${k}:\\s*([\\d.]+)\\s*(?:,|$|//)`, 'm').exec(tokens)?.[1]);
  if (!Number.isFinite(v)) throw new Error(`motion token ${k} is not a plain number in src/motion/tokens.ts`);
  return v;
};
const FRAME = 1000 / 60;
const STEP_MS = token('openStepFrames') * FRAME;
const LEAD_MS = token('openStepLeadFrames') * FRAME;
const FADE_MS = token('reducedFadeMs');
const CLOSE_FADE_MS = token('reducedCloseMs');
const GONE_MS = token('closeMs') + token('closeBarHoldMs') + token('closeFadeMs');

const watchTyping = () => {
  window.__typing = [];
  new MutationObserver((_, obs) => {
    const w = document.querySelector('.sw');
    if (!w) return;
    obs.disconnect();
    const t0 = performance.now();
    const tick = () => {
      const a = w.querySelector('.sw-actions');
      const words = [...w.querySelectorAll('.sw-body .sw-u')];
      window.__typing.push({ ms: Math.round(performance.now() - t0), actions: a ? Number(getComputedStyle(a).opacity) : null, hidden: words.filter((u) => Number(getComputedStyle(u).opacity) < 0.99).length });
      if (performance.now() - t0 < 4000 && w.isConnected) requestAnimationFrame(tick);
    };
    tick();
  }).observe(document, { childList: true, subtree: true });
};

/**
 * About 1 s after a fresh tab navigates, Chrome tears down the blank first page's compositor (`WidgetBase::Shutdown`
 * posts `~LayerTreeHost` with a 1 s delay, and its GPU `Finish()` blocks the new page's main thread). On SwiftShader the
 * page then gets no timers, input or frames for up to a few seconds, and the 3D stage may still be stepping its
 * resolution down to what the software renderer can draw, each resize waiting on the GPU again. A check that times a tap
 * or a close in that time would time the teardown, not the app, so those checks wait here first: until the page is
 * STARTUP_MS into its own clock and its last STEADY_MS of frames each came within STEADY_GAP_MS of the one before at
 * one stage canvas size. The stage steps after 0.6 s of slow frames, so a steady second at one size means it has
 * settled. Checks about the startup itself don't use it.
 */
const STARTUP_MS = 1500;
const STEADY_MS = 1000;
const STEADY_GAP_MS = 250;
const steadyFrames = ([from, span, gap]) =>
  new Promise((resolve, reject) => {
    const size = () => { const c = document.getElementById('gl'); return c ? `${c.width}x${c.height}` : ''; };
    const gaps = [];
    let last = null;
    let since = null;
    let was = size();
    const limit = setTimeout(() => reject(new Error(`the page never drew ${span} ms of steady frames after its first ${from} ms (gaps ${JSON.stringify(gaps.slice(-20))})`)), from + 30000);
    const tick = (ts) => {
      const now = size();
      if (last !== null) gaps.push(Math.round(ts - last));
      if (last === null || ts - last > gap || now !== was) since = ts;
      last = ts;
      was = now;
      if (ts < from || ts - since < span) return requestAnimationFrame(tick);
      clearTimeout(limit);
      resolve();
    };
    requestAnimationFrame(tick);
  });
const pastStartup = (page) => page.evaluate(steadyFrames, [STARTUP_MS, STEADY_MS, STEADY_GAP_MS]);

async function firstRun(open, viewport, { query = '?mute' } = {}) {
  const opened = await open({}, `${query}${LIGHT}`, viewport);
  await opened.ctx.addInitScript(watchTyping);
  await opened.page.reload();
  await opened.page.locator('.title-screen').waitFor();
  await pastStartup(opened.page);
  return opened;
}

async function lab(open, expect, viewport, reduced = false) {
  const opened = await open({}, `?lab=window&delay=100000&mute${LIGHT}${reduced ? '&reduced' : ''}`, viewport);
  await opened.page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  const same = await opened.page.evaluate(async () => {
    const mod = await import('/src/ui/lantern-window.ts');
    window.__t = { mod, answer: null };
    const same = mod.LanternWindow === window.__win.constructor;
    window.__win.destroy();
    return same;
  });
  if (!same) await opened.ctx.close();
  expect(same, 'the window lab loaded a second copy of the window module, not the one the app runs on');
  await pastStartup(opened.page);
  return opened;
}

async function each(cases) {
  const bad = [];
  for (const run of cases) {
    try {
      await run();
    } catch (e) {
      bad.push(e?.message ?? String(e));
    }
  }
  if (bad.length) throw new Error(bad.join('\n'));
}

const openWindow = ({ how, spec }) => {
  const t = window.__t;
  t.answer = null;
  if (how === 'message') t.mod.lanternMessage(spec).then((v) => (t.answer = v));
  else {
    const w = new t.mod.LanternWindow(t.mod.lanternLayer(), spec);
    if (how === 'late')
      (async () => {
        await w.open();
        t.answer = await w.waitForInput();
        await w.close();
      })();
    else {
      const opening = w.open();
      w.waitForInput().then(async (v) => {
        t.answer = v;
        await opening;
        await w.close();
      });
    }
  }
  const center = (sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  return { button: center('.sw-btn'), plate: center('.sw-plate') };
};

const state = (page) =>
  page.evaluate(() => {
    const acts = document.querySelector('.sw-actions');
    return {
      answer: window.__t.answer,
      hidden: [...document.querySelectorAll('.sw-body .sw-u')].filter((u) => Number(getComputedStyle(u).opacity) < 1).length,
      actions: acts ? Number(getComputedStyle(acts).opacity) : null,
    };
  });

async function closes(page) {
  const t0 = Date.now();
  return page.locator('.sw').waitFor({ state: 'detached', timeout: CLOSE_MS }).then(() => Date.now() - t0, () => null);
}

const spot = (page, sel) =>
  page.evaluate((sel) => {
    const e = document.querySelector(sel);
    const r = e.getBoundingClientRect();
    let opacity = 1;
    for (let n = e; n instanceof Element; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, opacity };
  }, sel);

const isSettled = (sel) =>
  document
    .querySelector(sel)
    .getAnimations({ subtree: true })
    .every((a) => a instanceof CSSTransition || a instanceof CSSAnimation || a.playState === 'finished' || a.effect.getComputedTiming().endTime === Infinity);
const settled = (page, sel) => page.evaluate(isSettled, sel);

const typing = (page) => page.evaluate(() => window.__typing);
const shown = (page) => page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.sw-actions')).opacity) === 1, null, { polling: 'raf' });
const shownText = (page) => page.waitForFunction(() => document.querySelector('.sw .sw-next')?.getAnimations().length > 0, null, { polling: 'raf', timeout: 15000 });

/**
 * Times one window's open and close on its own clock. On a software renderer the browser can draw no frame, and run no
 * timer, for a few hundred ms while it rasterises; a check that waits for the first drawn frame showing a state would
 * time that stall, not the window. So the timing comes from the window's animations (a paused copy, seeked), every
 * frame the browser did draw must show what that clock says at the frame's time, and the window must be off the page
 * before a page timer due `bound` ms after its close fires, however late a stalled main thread runs both.
 */
const timeWindow = async ([spec, late, bound]) => {
  const t = window.__t;
  const w = new t.mod.LanternWindow(t.mod.lanternLayer(), spec);
  const plate = w.root.querySelector('.sw-plate');
  const motion = () => plate.getAnimations().at(-1) ?? w.root.getAnimations().at(-1);
  const inset = (e) => Number(/inset\(\s*([-\d.]+)%/.exec(getComputedStyle(e).clipPath)?.[1] ?? 0);
  const opacity = (e) => Number(getComputedStyle(e).opacity);
  // drawn frames over `ms` of frame time: a frame whose callbacks run late still shows the moment it was drawn for
  const watch = (ms, after = 0) =>
    new Promise((resolve) => {
      const log = [];
      const tick = (ts) => {
        log.push({ ts, perf: Math.round(performance.now() * 10) / 10, inset: inset(plate), opacity: opacity(w.root), live: w.root.isConnected });
        if (ts - log[0].ts < ms) requestAnimationFrame(tick);
        else resolve(log);
      };
      if (after) setTimeout(() => requestAnimationFrame(tick), after);
      else requestAnimationFrame(tick);
    });
  const rel = (log, start) => (start === null ? null : log.map(({ ts, ...f }) => ({ ms: Math.round((ts - start) * 10) / 10, ...f })).filter((f) => f.ms >= 0));
  /** Replays animation `a` on a hidden probe: its value every 0.25 ms, and each drawn frame in `log` that showed `key`
   * other than the animation does within 1 ms of the frame's time is marked `off`. */
  const clock = (a, read, log, key) => {
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.visibility = 'hidden';
    const fx = new KeyframeEffect(a.effect);
    fx.target = probe;
    const copy = new Animation(fx, document.timeline);
    copy.pause();
    const end = fx.getComputedTiming().endTime;
    const at = (ms) => {
      copy.currentTime = Math.min(Math.max(ms, 0), end);
      return read(probe);
    };
    const values = [];
    for (let ms = 0; ms <= end; ms += 0.25) values.push({ ms, v: at(ms) });
    for (const f of log) {
      if (!f.live || f.ts < a.startTime) continue;
      const near = [-1, 0, 1].map((d) => at(f.ts - a.startTime + d));
      f.want = Math.round(near[1] * 1e4) / 1e4;
      f.off = f[key] < Math.min(...near) - 1e-4 || f[key] > Math.max(...near) + 1e-4;
    }
    copy.cancel();
    probe.remove();
    return values;
  };
  const opening = w.open();
  const openA = motion();
  const openLog = await watch(450);
  await opening;
  const openStart = openA.startTime;
  const stepped = openA.effect.getKeyframes().some((k) => k.clipPath);
  const opened = clock(openA, stepped ? inset : opacity, openLog, stepped ? 'inset' : 'opacity');
  const schedule = stepped ? opened.filter((s, i) => s.v !== opened[i - 1]?.v).map(({ ms, v }) => ({ ms, inset: v })) : [];
  const fadeInMs = stepped ? null : (opened.find((s) => s.v >= 0.999)?.ms ?? null);
  const clocks = () => ({ perf: Math.round(performance.now() * 10) / 10, page: Math.round(performance.now() * 10) / 10, doc: Math.round(document.timeline.currentTime * 10) / 10 });
  const life = {};
  const destroy = w.destroy.bind(w);
  w.destroy = () => {
    life.destroyed = clocks();
    destroy();
    life.removed = { ...clocks(), live: w.root.isConnected };
  };
  life.closeCalled = clocks();
  const closing = w.close();
  const closeA = motion();
  const deadline = new Promise((resolve) => setTimeout(() => resolve({ ...clocks(), live: w.root.isConnected }), bound - (performance.now() - life.closeCalled.perf)));
  const fade = w.root.getAnimations().at(-1);
  life.fadeEnd = fade?.effect.getComputedTiming().endTime;
  closeA.ready.then(() => (life.collapseReady = { start: closeA.startTime, ...clocks() }), () => undefined);
  fade?.ready.then(() => (life.fadeReady = { start: fade.startTime, ...clocks() }), () => undefined);
  fade?.finished.then(() => (life.fadeFinished = clocks()), () => undefined);
  const closeLog = await watch(650, late);
  await closing;
  life.deadline = await deadline;
  life.collapseStart = closeA.startTime;
  life.fadeStart = fade?.startTime ?? null;
  life.ms = life.removed ? Math.round((life.removed.page - life.closeCalled.page) * 10) / 10 : null;
  const closed = clock(closeA, stepped ? inset : opacity, closeLog, stepped ? 'inset' : 'opacity');
  const collapseMs = stepped ? (closed.find((s) => s.v >= 48.5)?.ms ?? null) : null;
  const first = closeLog[0] && { frame: Math.round((closeLog[0].ts - life.closeCalled.doc) * 10) / 10, perf: Math.round((closeLog[0].perf - life.closeCalled.perf) * 10) / 10, live: closeLog[0].live };
  const gaps = closeLog.slice(1).map((f, i) => Math.round((f.ts - closeLog[i].ts) * 10) / 10);
  return { open: rel(openLog, openStart), close: rel(closeLog, closeA.startTime), schedule, fadeInMs, collapseMs, life, first, gaps };
};

const firstAt = (log, fn) => log?.find(fn)?.ms ?? null;

const afterSkip = () => {
  window.__afterSkip = [];
  new MutationObserver((recs) => {
    for (const r of recs)
      for (const n of r.addedNodes)
        if (n instanceof Element && n.matches('.sw, .chest-hold, .awaken-word')) window.__afterSkip.push(n.className);
  }).observe(document.getElementById('ui'), { childList: true, subtree: true });
};

const skipTimes = () => {
  const rec = (window.__skip = { at: null, gone: null, rewards: null });
  const watched = [...document.querySelectorAll('.sw, .chest-hold')];
  rec.watched = watched.map(window.__name);
  const seen = () => {
    if (rec.at === null) return;
    if (rec.gone === null && watched.every((w) => !w.isConnected)) rec.gone = Math.round(performance.now() - rec.at);
    if (rec.rewards === null && document.querySelector('.rw')) rec.rewards = Math.round(performance.now() - rec.at);
  };
  document.addEventListener(
    'click',
    (e) => {
      if (rec.at !== null || !e.target.closest?.('.ui-skip')) return;
      rec.at = performance.now();
      queueMicrotask(seen);
    },
    true,
  );
  new MutationObserver(seen).observe(document.getElementById('ui'), { childList: true, subtree: true });
};

const entrances = async (fade) => {
  const out = (window.__entrances = {});
  const screens = ['.rw', '.letter-wrap', '.endcard'];
  const key = (n) => screens.find((s) => n.matches(s));
  const opacity = (n) => {
    let o = 1;
    for (let e = n; e instanceof Element; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };
  const timing = (a) => {
    const t = a.effect.getComputedTiming();
    return { target: window.__name(a.effect.target), delay: t.delay, duration: t.duration, end: t.endTime };
  };
  const record = (n) => {
    const anims = n.getAnimations({ subtree: true });
    const own = n.getAnimations()[0];
    const r = (out[key(n)] = { schedule: anims.map(timing) });
    const animate = n.animate.bind(n);
    n.animate = (...args) => {
      const a = animate(...args);
      r.exit = { ...timing(a), perf: performance.now() };
      return a;
    };
    const tick = () => {
      if (!n.isConnected) return;
      const t = !own ? Infinity : own.startTime === null ? 0 : document.timeline.currentTime - own.startTime;
      if (t < fade + 2 * (1000 / 60)) return requestAnimationFrame(tick);
      r.at = Math.round(t);
      r.running = anims.filter((a) => a.playState !== 'finished').map((a) => window.__name(a.effect.target));
      r.faint = [...n.querySelectorAll('.rw-head, .rw-card, .sw-btn, .letter h2, .letter p, .letter .sign, .ec-title, .ec-line, .ec-curls')].filter((e) => opacity(e) < 0.999).map(window.__name);
      const ring = n.querySelector('.r1');
      r.ring = ring ? Number.parseFloat(getComputedStyle(ring).strokeDashoffset) : null;
    };
    requestAnimationFrame(tick);
  };
  new MutationObserver((recs) => {
    for (const m of recs) {
      for (const n of m.addedNodes) if (n instanceof Element && key(n)) record(n);
      for (const n of m.removedNodes) {
        const r = n instanceof Element && key(n) && out[key(n)];
        if (r?.exit) r.exitMs = Math.round(performance.now() - r.exit.perf);
      }
    }
  }).observe(document.getElementById('ui'), { childList: true });
};

const trace = async () => {
  if (window.__trace) return;
  const t0 = performance.now();
  const log = (window.__trace = []);
  const ids = new WeakMap();
  let next = 1;
  const id = (window.__id = (n) => (n ? (ids.has(n) || ids.set(n, next++), ids.get(n)) : null));
  const name = (window.__name = (n) => (n instanceof Element ? `${n.tagName.toLowerCase()}.${[...n.classList].join('.')}#${id(n)}` : String(n?.nodeName)));
  const at = (window.__at = () => Math.round((performance.now() - t0) * 10) / 10);
  const push = (e) => {
    log.push({ at: at(), ...e });
    if (log.length > 500) log.splice(0, 100);
  };
  const sel = '.sw, .rw, .letter-wrap, .endcard, .chest-hold, .title-screen, .ui-skip';
  const uncaught = (window.__uncaught = []);
  const failed = (message, stack, source) => {
    uncaught.push({ at: at(), message, stack, source, screens: [...document.querySelectorAll(sel)].map(name), ...window.__clocks?.() });
    push({ ev: 'pageerror', message, source });
  };
  window.addEventListener('error', (e) => failed(e.message, e.error?.stack, `${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => failed(`Unhandled rejection: ${e.reason?.message ?? e.reason}`, e.reason?.stack));
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'keydown', 'keyup'])
    window.addEventListener(
      type,
      (e) => {
        const root = e.target instanceof Element ? e.target.closest(sel) : null;
        push({ ev: type, pointer: e.pointerId, button: e.button, key: e.key, repeat: e.repeat, target: name(e.target), root: root && name(root) });
      },
      true,
    );
  document.addEventListener('visibilitychange', () => push({ ev: 'visibility', state: document.visibilityState }));
  new MutationObserver((recs) => {
    for (const r of recs) {
      for (const n of r.addedNodes) if (n instanceof Element && n.matches(sel)) push({ ev: 'added', node: name(n), ...window.__clocks?.() });
      for (const n of r.removedNodes) if (n instanceof Element && n.matches(sel)) push({ ev: 'removed', node: name(n), ...window.__clocks?.() });
    }
  }).observe(document, { childList: true, subtree: true });
  const gaps = (window.__gaps = []);
  let last = 0;
  const frame = (ts) => {
    if (last) gaps.push(Math.round((ts - last) * 10) / 10);
    if (gaps.length > 1000) gaps.splice(0, 500);
    last = ts;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const anim = await import('/src/ui/anim.ts');
  const clocks = (window.__clocks = () => ({
    perf: Math.round(performance.now() * 10) / 10,
    page: Math.round(performance.now() * 10) / 10,
    ui: Math.round(anim.uiNow() * 10000) / 10,
    stage: window.__stage ? Math.round(window.__stage.time * 10000) / 10 : null,
    doc: Math.round((document.timeline.currentTime ?? -1) * 10) / 10,
    vis: document.visibilityState,
  }));
  const local = (window.__local = (a) => (a.playState === 'paused' || a.startTime === null ? Number(a.currentTime) : (performance.now() - a.startTime) * a.playbackRate));
  const P = (await import('/src/ui/lantern-window.ts')).LanternWindow.prototype;
  for (const k of ['input', 'reply', 'close', 'destroy']) {
    const f = P[k];
    P[k] = function (...args) {
      const state = () => ({ typing: this.typing, answered: this.answered, gone: this.gone, live: this.root.isConnected });
      push({ ev: k, win: name(this.root), kind: this.root.dataset.kind, arg: args.length ? String(args[0]) : undefined, ...state(), ...clocks() });
      const r = f.apply(this, args);
      if (k === 'close') {
        for (const a of this.root.getAnimations()) {
          const fx = a.effect.getComputedTiming();
          push({ ev: 'close animation', win: name(this.root), start: a.startTime, end: fx.endTime, ...clocks() });
          a.finished.then(() => push({ ev: 'close animation finished', win: name(this.root), end: fx.endTime, ...state(), ...clocks() }), () => undefined);
        }
        r?.then(() => push({ ev: 'close done', win: name(this.root), ...state(), ...clocks() }));
      }
      return r;
    };
  }
};

const snapshot = (sel) => {
  const g = window.__gaps ?? [];
  const sorted = [...g].sort((a, b) => a - b);
  const w = window.__watched;
  const s = window.__stage;
  return {
    browser: Math.round(performance.timeOrigin + performance.now()),
    clocks: window.__clocks?.(),
    watched: w ? { node: window.__name(w), live: w.isConnected } : null,
    matching: sel ? [...document.querySelectorAll(sel)].map((n) => `${window.__name(n)} live=${n.isConnected}`) : [],
    screens: [...document.querySelectorAll('#ui > *, .sw')].map((n) => window.__name(n)).slice(0, 24),
    frames: { n: g.length, median: sorted[g.length >> 1] ?? null, max: sorted.at(-1) ?? null, last: g.slice(-16) },
    stage: s ? { dpr: s.dpr, frames: s.frameLog.length, slow: s.frameLog.filter((dt) => dt >= 0.1).length, programs: s.renderer.info.programs?.length ?? null } : null,
    chest: {
      hold: !!document.querySelector('.chest-hold'),
      target: !!document.querySelector('.chest-hold .ch-target'),
      skip: !!document.querySelector('.ui-skip'),
      files: performance.getEntriesByType('resource').filter((r) => /chest|world|director|awaken/.test(r.name)).map((r) => `${r.name.replace(location.origin, '')} ${Math.round(r.responseEnd)}`),
    },
    uncaught: window.__uncaught ?? [],
    leave: window.__leave?.rec ?? null,
    trace: (window.__trace ?? []).slice(-80),
  };
};

async function watch(page) {
  if (!page.__console) {
    page.__console = [];
    page.__pageErrors = [];
    page.on('console', (m) => page.__console.push(`${m.type()}: ${m.text().slice(0, 200)}`));
    page.on('pageerror', (e) => page.__pageErrors.push({ node: new Date().toISOString(), message: e.message, stack: e.stack }));
  }
  await page.evaluate(trace);
}

async function traced(page, out, tag, sel, step) {
  try {
    return await step();
  } catch (e) {
    if (e?.traced) throw e;
    const snap = await page.evaluate(snapshot, sel).catch((x) => ({ snapshotError: String(x) }));
    const pageErrors = page.__pageErrors ?? [];
    const report = { error: String(e?.message ?? e), stack: e?.stack, node: new Date().toISOString(), ...(e?.wait && { wait: e.wait }), pageErrors, console: (page.__console ?? []).slice(-40), ...snap };
    fs.writeFileSync(path.join(out, `trace-${tag.replace(/[^\w-]+/g, '-')}.json`), JSON.stringify(report, null, 1));
    const last = (snap.trace ?? []).slice(-8).map((t) => `${t.at} ${t.ev} ${t.win ?? t.node ?? t.target ?? t.key ?? t.message ?? ''}`.trim());
    const errs = pageErrors.length ? `, page errors [${pageErrors.map((p) => p.message).join('; ')}]` : '';
    throw Object.assign(new Error(`${e?.message ?? e}\n    trace-${tag}: watched ${JSON.stringify(snap.watched)}, matching ${JSON.stringify(snap.matching)}, frames ${JSON.stringify(snap.frames)}, clocks ${JSON.stringify(snap.clocks)}, last [${last.join('; ')}]${errs}`), { traced: true, cause: e });
  }
}

const armLeave = ([sel, bound]) => {
  const root = document.querySelector(sel);
  const clock = window.__clocks;
  const rec = { node: window.__name(root), bound, armed: clock(), events: [], exit: [] };
  const types = ['pointerdown', 'pointerup', 'click', 'keydown'];
  let settle;
  let timer = 0;
  const done = new Promise((r) => (settle = r));
  const finish = (how) => {
    if (rec.how) return;
    rec.how = how;
    rec.settled = clock();
    obs.disconnect();
    clearTimeout(timer);
    for (const t of types) removeEventListener(t, onInput, true);
    settle();
  };
  const deadline = () => {
    const left = rec.input.page + bound - clock().page;
    if (left > 0) timer = setTimeout(deadline, left);
    else {
      rec.deadline = clock();
      finish('late');
    }
  };
  const onInput = (e) => {
    const inside = e.target instanceof Node && root.contains(e.target);
    rec.events.push({ type: e.type, stamp: Math.round(e.timeStamp * 10) / 10, target: window.__name(e.target), inside, ...clock() });
    if (!inside || rec.input || e.type === 'pointerdown') return;
    rec.input = rec.events.at(-1);
    deadline();
  };
  for (const t of types) addEventListener(t, onInput, true);
  const obs = new MutationObserver(() => {
    if (root.isConnected) return;
    rec.removed = clock();
    finish('removed');
  });
  obs.observe(document, { childList: true, subtree: true });
  const animate = root.animate.bind(root);
  root.animate = (...args) => {
    const a = animate(...args);
    const t = a.effect.getComputedTiming();
    const x = { delay: t.delay, duration: t.duration, made: clock() };
    rec.exit.push(x);
    a.ready.then(() => (x.ready = { start: a.startTime, ...clock() }), () => undefined);
    a.finished.then(() => (x.finished = clock()), () => (x.canceled = clock()));
    return a;
  };
  window.__watched = root;
  window.__leave = { rec, done, finish };
};

const answerLeave = async () => {
  const l = window.__leave;
  l.rec.query = window.__clocks();
  if (!l.rec.input) l.finish('no input');
  await l.done;
  l.rec.returned = window.__clocks();
  return l.rec;
};

async function leaves(page, out, tag, sel, bound, input) {
  return traced(page, out, tag, sel, async () => {
    const at = () => Math.round(performance.now() * 10) / 10;
    const wait = { armed: at() };
    let rec;
    let timer;
    try {
      await page.evaluate(armLeave, [sel, bound]);
      await input();
      wait.sent = at();
      const answer = page.evaluate(answerLeave);
      wait.start = at();
      rec = await Promise.race([
        answer,
        new Promise((_, no) => {
          timer = setTimeout(() => {
            wait.deadline = at();
            no(new Error(`the page never reported whether ${sel} left: no answer ${LIVENESS_MS} ms after the input`));
          }, LIVENESS_MS);
        }),
      ]);
      wait.answered = at();
    } catch (e) {
      wait.error = { at: at(), message: String(e?.message ?? e) };
      throw Object.assign(e, { wait });
    } finally {
      clearTimeout(timer);
    }
    const life = rec.input && rec.removed ? Math.round((rec.removed.page - rec.input.page) * 10) / 10 : null;
    const fail = (msg) => Object.assign(new Error(msg), { wait });
    if (!rec.input) throw fail(`the input never reached ${rec.node}: ${JSON.stringify(rec.events.map((e) => `${e.type} ${e.target} inside=${e.inside}`))}`);
    if (life === null || life > bound) throw fail(`${rec.node} was still on the page ${life ?? `${bound}+`} ms after the ${rec.input.type} it took (bound ${bound} ms; exit ${JSON.stringify(rec.exit)})`);
    return { node: rec.node, input: rec.input.type, life, queued: Math.round((rec.input.perf - rec.input.stamp) * 10) / 10, exit: rec.exit, wait, browser: { query: rec.query, returned: rec.returned } };
  });
}

export const scenarios = {
  async 'title-input-types'({ open, sleep, youOf, expect }) {
    for (const viewport of VIEWPORTS)
      for (const how of ['tap', 'enter', 'held-enter']) {
        const { ctx, page, errors } = await firstRun(open, viewport);
        const at = `${viewport.width}x${viewport.height}, ${how}`;
        const title = page.locator('.title-screen');
        if (how === 'tap') await title.click();
        else {
          await title.focus();
          if (how === 'enter') await page.keyboard.press('Enter');
          else {
            await page.keyboard.down('Enter');
            const cdp = await ctx.newCDPSession(page);
            const focused = new Set();
            for (const end = Date.now() + 2250; Date.now() < end; ) {
              await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r', autoRepeat: true });
              focused.add(await page.evaluate(() => document.activeElement?.id || document.activeElement?.className || ''));
              await sleep(33);
            }
            await page.keyboard.up('Enter');
            expect((await youOf(page)) === null, `${at}: holding Enter saved names: ${JSON.stringify(await youOf(page))}`);
            expect(focused.has('np-name') || focused.has('np-comp'), `${at}: the name prompt never took focus while Enter was held (focus went to ${[...focused].join(', ')})`);
          }
        }
        await page.locator('#np-name').waitFor();
        await shown(page);
        const log = await typing(page);
        const first = log.find((s) => s.actions !== null);
        expect(first && first.hidden > 0 && first.actions < 1, `${at}: the name prompt was fully typed the moment it opened: ${JSON.stringify(log.slice(0, 3))}`);
        const typed = log.find((s) => s.actions === 1 && s.hidden === 0);
        expect(typed?.ms >= 400, `${at}: the name prompt typed out in ${typed?.ms} ms`);
        expect(await page.locator('#np-name').count(), `${at}: the title's input answered the name prompt`);
        expect(!errors.length, errors.join('\n'));
        await ctx.close();
      }
  },

  async 'hidden-button-press'({ open, sleep, expect }) {
    const cases = [];
    for (const viewport of VIEWPORTS)
      for (const how of ['late', 'early'])
        for (const input of viewport === PHONE ? ['tap', 'key'] : ['tap'])
          cases.push(async () => {
            const at = `${viewport.width}x${viewport.height}, waits ${how}, ${input}`;
            const { ctx, page, errors } = await lab(open, expect, viewport);
            try {
              const tap = await page.evaluate(openWindow, { how, spec: GOT_IT });
              await page.waitForFunction(() => {
                const acts = document.querySelector('.sw-actions');
                if (![...document.querySelectorAll('.sw-body .sw-u')].some((u) => Number(getComputedStyle(u).opacity) === 1) || Number(getComputedStyle(acts).opacity) !== 0) return false;
                // hold the buttons' fade where it is, so the press below lands before they show however late it arrives
                acts.getAnimations().forEach((a) => a.pause());
                return true;
              }, null, { polling: 'raf' });
              if (input === 'tap') await page.mouse.click(tap.button.x, tap.button.y);
              else {
                // a keyboard player reaching for the button before it shows: it takes no focus, so Enter completes the typing
                const focused = await page.evaluate(() => {
                  const b = document.querySelector('.sw-btn');
                  b.focus();
                  return document.activeElement === b;
                });
                expect(!focused, `${at}: Got it took focus before it had shown`);
                await page.keyboard.press('Enter');
              }
              await sleep(150);
              const s = await state(page);
              expect(s.answer === null, `${at}: a ${input} where Got it had not shown yet answered the window (${s.answer})`);
              expect(s.hidden === 0 && s.actions === 1, `${at}: the ${input} where Got it had not shown yet did nothing: ${s.hidden} words still hidden, buttons at opacity ${s.actions}`);
              await page.getByRole('button', { name: 'Got it' }).click();
              const ms = await closes(page);
              const after = await state(page);
              expect(ms !== null && after.answer === 'ok', `${at}: the tap on the shown Got it did not answer and close the window within ${CLOSE_MS} ms (answer ${after.answer})`);
              expect(!errors.length, errors.join('\n'));
            } finally {
              await ctx.close();
            }
          });
    await each(cases);
  },

  /** With reduced motion the window's one fade is its opening: a tap during it completes it and never answers */
  async 'reduced-opening-tap'({ open, sleep, expect }) {
    const { ctx, page, errors } = await lab(open, expect, PHONE, true);
    try {
      const plate = await page.evaluate((spec) => {
        const t = window.__t;
        t.answer = null;
        const w = new t.mod.LanternWindow(t.mod.lanternLayer(), spec);
        (async () => {
          await w.open();
          t.answer = await w.waitForInput();
          await w.close();
        })();
        // hold the fade where it starts, so the tap below lands during it however late it arrives
        w.root.getAnimations().forEach((a) => a.pause());
        const r = w.root.querySelector('.sw-plate').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, TAP_ON);
      await page.mouse.click(plate.x, plate.y);
      await sleep(150);
      const s = await page.evaluate(() => ({ answer: window.__t.answer, open: !!document.querySelector('.sw'), opacity: Number(getComputedStyle(document.querySelector('.sw')).opacity) }));
      expect(s.open && s.answer === null, `a tap during the reduced-motion opening answered the window (${s.answer})`);
      expect(s.opacity === 1, `the tap during the reduced-motion opening did not complete it (opacity ${s.opacity})`);
      await page.mouse.click(plate.x, plate.y);
      const ms = await closes(page);
      const answer = await page.evaluate(() => window.__t.answer);
      expect(ms !== null && answer === 'tap', `the tap on the opened window did not answer and close it within ${CLOSE_MS} ms (answer ${answer})`);
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'quest-tap-completes'({ open, sleep, expect, out }) {
    const { ctx, page, errors } = await open({}, `?shot=windows&mute${LIGHT}`, PHONE);
    await pastStartup(page);
    await watch(page);
    await traced(page, out, 'quest-tap-completes', '.sw', async () => {
      await page.locator('.title-screen').click();
      for (const kind of ['notification', 'level']) {
        const win = `.sw[data-kind="${kind}"]`;
        await page.locator(win).waitFor();
        await page.waitForFunction(isSettled, win, { polling: 'raf', timeout: 10000 });
        await sleep(100);
        const p = await spot(page, `${win} .sw-plate`);
        await leaves(page, out, `quest-tap-completes-${kind}`, win, CLOSE_MS, () => page.mouse.click(p.x, p.y));
      }
      const quest = '.sw[data-kind="quest"]';
      await page.locator(quest).waitFor();
      await page.waitForFunction((q) => Number(getComputedStyle(document.querySelector(`${q} .sw-title`)).opacity) === 1, quest, { polling: 'raf' });
      const before = await spot(page, `${quest} .dq-punch`);
      expect(before.opacity < 1, `the punchline showed before the tap (opacity ${before.opacity})`);
      const plate = await spot(page, `${quest} .sw-plate`);
      await page.mouse.click(plate.x, plate.y);
      await sleep(150);
      const after = await page.evaluate((q) => {
        const w = document.querySelector(q);
        const op = (sel) => [...w.querySelectorAll(sel)].map((e) => Number(getComputedStyle(e).opacity));
        return {
          open: !!w.isConnected,
          shown: [...op('.sw-body .sw-u'), ...op('.dq-dots'), ...op('.dq-punch'), ...op('.dq-side span')],
          ticks: [...w.querySelectorAll('.dq-box path.c')].map((t) => Number.parseFloat(getComputedStyle(t).strokeDashoffset)),
        };
      }, quest);
      expect(after.open, 'the tap while the quest window typed answered it');
      expect(after.shown.every((o) => o === 1), `the tap while the quest window typed left parts hidden: opacities ${JSON.stringify(after.shown)}`);
      expect(after.ticks.length && after.ticks.every((d) => d === 0), `the tap left the quest's ticks undrawn: ${JSON.stringify(after.ticks)}`);
      expect(await settled(page, quest), 'the quest window still animated after the tap that completed it');
      await leaves(page, out, 'quest-tap-completes-quest', quest, CLOSE_MS, () => page.mouse.click(plate.x, plate.y));
      expect(!errors.length, errors.join('\n'));
    });
    await ctx.close();
  },

  async 'screens-tap-completes'({ open, sleep, expect, out }) {
    const cases = [];
    for (const viewport of VIEWPORTS)
      cases.push(async () => {
        const size = `${viewport.width}x${viewport.height}`;
        const { ctx, page, errors } = await open({}, `?shot=rewards&mute${LIGHT}`, viewport);
        try {
          await pastStartup(page);
          await watch(page);
          await traced(page, out, `screens-tap-completes-${size}`, '.rw, .letter-wrap, .endcard', async () => {
            await page.locator('.title-screen').click();
            for (const [screen, button] of [['.rw', '.rw .sw-btn'], ['.letter-wrap', '.letter .sw-btn'], ['.endcard', '.ec-actions .sw-btn.gold']]) {
              const at = `${size}, ${screen}`;
              await page.locator(screen).waitFor();
              const hidden = await spot(page, button);
              expect(hidden.opacity < 0.5, `${at}: the button had already shown (opacity ${hidden.opacity}) before the test could tap where it would be`);
              const onScreen = hidden.y < viewport.height;
              await page.mouse.click(hidden.x, onScreen ? hidden.y : viewport.height / 2);
              await sleep(150);
              expect(await page.locator(screen).count(), `${at}: a tap ${onScreen ? 'where the button had not shown yet pressed it' : 'while the screen came in left it'}`);
              const done = await spot(page, button);
              expect(done.opacity === 1 && (await settled(page, screen)), `${at}: a tap while the screen came in did not complete it (button opacity ${done.opacity})`);
              await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), button);
              const shown = await spot(page, button);
              const aimed = await page.evaluate(([x, y]) => window.__name(document.elementFromPoint(x, y)), [shown.x, shown.y]);
              const gone = await leaves(page, out, `screens-tap-completes-${size}-${screen.slice(1)}`, screen, 3000, () => page.mouse.click(shown.x, shown.y)).then(() => true, (e) => e);
              expect(gone === true, `${at}: the tap on the shown button did not go on (at ${Math.round(shown.x)},${Math.round(shown.y)}: ${aimed}) ${gone?.message ?? ''}`);
            }
            expect(!errors.length, errors.join('\n'));
          });
        } finally {
          await ctx.close();
        }
      });
    await each(cases);
  },

  /** A closing screen's button that hasn't shown yet takes no focus or key: Enter while the screen comes in completes it */
  async 'screens-hidden-button-key'({ open, sleep, expect, out }) {
    const { ctx, page, errors } = await open({}, `?shot=rewards&mute${LIGHT}`, PHONE);
    try {
      await pastStartup(page);
      await watch(page);
      await traced(page, out, 'screens-hidden-button-key', '.rw, .letter-wrap, .endcard', async () => {
        await page.locator('.title-screen').click();
        for (const [screen, button] of [['.rw', '.rw .sw-btn'], ['.letter-wrap', '.letter .sw-btn'], ['.endcard', '.ec-actions .sw-btn.gold']]) {
          await page.locator(screen).waitFor();
          // hold the button's fade before it shows, so the keys below come before it however late they arrive
          await page.waitForFunction((sel) => {
            const gated = document.querySelector(sel)?.closest('[inert]');
            gated?.getAnimations().forEach((a) => a.pause());
            return !!gated;
          }, button, { polling: 'raf', timeout: 5000 });
          const focused = await page.evaluate((sel) => {
            document.activeElement?.blur?.();
            const b = document.querySelector(sel);
            b.focus();
            return document.activeElement === b;
          }, button);
          expect(!focused, `${screen}: its button took focus before it had shown`);
          await page.keyboard.press('Enter');
          await sleep(150);
          expect(await page.locator(screen).count(), `${screen}: Enter while it came in pressed its hidden button`);
          const done = await spot(page, button);
          expect(done.opacity === 1 && (await settled(page, screen)), `${screen}: Enter while it came in did not complete it (button opacity ${done.opacity})`);
          await page.locator(button).focus();
          await leaves(page, out, `screens-hidden-button-key-${screen.slice(1)}`, screen, 3000, () => page.keyboard.press('Enter'));
        }
        expect(!errors.length, errors.join('\n'));
      });
    } finally {
      await ctx.close();
    }
  },

  async 'reward-cards-every-card'({ open, expect }) {
    const { ctx, page, errors } = await lab(open, expect, PHONE);
    try {
      await page.evaluate(async () => {
        const ui = await import('/src/ui/cutscene-ui.ts');
        const { REWARDS } = await import('/src/content/intro.ts');
        const rec = (window.__cards = { every: REWARDS.map((_, i) => i), calls: [], left: null });
        ui.rewardCards(REWARDS, { onCard: (i) => rec.calls.push(i) }).then(() => (rec.left = [...rec.calls]));
      });
      await page.locator('.rw').waitFor();
      const grid = await spot(page, '.rw-grid');
      await page.mouse.click(grid.x, grid.y);
      const tapped = await page.evaluate(() => window.__cards);
      const every = JSON.stringify(tapped.every);
      expect(JSON.stringify(tapped.calls) === every, `a tap while the rewards came in gave onCard ${JSON.stringify(tapped.calls)}, not each card once in order ${every}`);
      // a page timer due after the last card's own cue runs after that cue's timer, however late both run
      const cued = await page.evaluate(() => new Promise((r) => setTimeout(() => r([...window.__cards.calls]), 450 + 500 * window.__cards.every.length)));
      expect(JSON.stringify(cued) === every, `the cards' own cue times gave onCard again after the tap: ${JSON.stringify(cued)}`);
      const btn = await spot(page, '.rw .sw-btn');
      await page.mouse.click(btn.x, btn.y);
      const left = await page.waitForFunction(() => window.__cards.left, null, { timeout: 3000 }).then((h) => h.jsonValue());
      expect(JSON.stringify(left) === every, `the rewards left with onCard ${JSON.stringify(left)}, not each card once ${every}`);
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'window-timing'({ open, expect, out }) {
    const timing = {};
    const cases = [];
    for (const [reduced, late] of [[false, 0], [true, 0], [false, GONE_MS + 120], [true, CLOSE_FADE_MS + 120]])
      cases.push(async () => {
        const mode = `${reduced ? 'reduced motion' : 'full motion'}${late ? `, first look ${late} ms after the close` : ''}`;
        const bound = reduced ? 240 : 390;
        const { ctx, page, errors } = await lab(open, expect, PHONE, reduced);
        try {
          const log = await page.evaluate(timeWindow, [TAP_ON, late, bound]);
          const life = `close ${JSON.stringify(log.life)}, first look ${JSON.stringify(log.first)}, frame gaps ${JSON.stringify(log.gaps.slice(0, 40))}`;
          const off = (frames) => JSON.stringify(frames.filter((f) => f.off).slice(0, 4).map(({ ms, inset, opacity, want }) => ({ ms, inset, opacity, want })));
          fs.writeFileSync(path.join(out, `window-timing-${reduced ? 'reduced' : 'full'}${late ? '-late' : ''}.json`), JSON.stringify(log, null, 1));
          expect(log.life.removed && !log.life.removed.live, `${mode}: the window was never taken off the page; ${life}`);
          expect(log.life.deadline && !log.life.deadline.live, `${mode}: the window was still on the page when a page timer due ${bound} ms after its close began ran (it left ${log.life.ms} ms in); ${life}`);
          expect(!log.open.some((f) => f.off), `${mode}: drawn frames showed the open off its own clock: ${off(log.open)}`);
          expect(!log.close.some((f) => f.off), `${mode}: drawn frames showed the close off its own clock: ${off(log.close)}; ${life}`);
          if (late) {
            timing[mode] = { goneMs: log.life.ms, first: log.first, life: log.life };
            expect(log.first && !log.first.live && log.first.perf >= log.life.ms, `${mode}: the first look came before the window left, so the late look was not tested; ${life}`);
          } else if (!reduced) {
            const full = firstAt(log.open, (f) => f.inset <= 0.5);
            const sched = log.schedule;
            const due = sched.find((s) => s.inset <= 0.5)?.ms ?? null;
            const offBeat = sched.slice(1).filter((s) => Math.abs(s.ms + LEAD_MS - Math.round((s.ms + LEAD_MS) / STEP_MS) * STEP_MS) > 0.5);
            const held = sched.filter((s) => s.inset > 0.5).map((s, i, a) => ({ inset: s.inset, from: s.ms, held: (a[i + 1]?.ms ?? due) - s.ms }));
            timing[mode] = { fullDueMs: due, firstFullFrameMs: full, schedule: sched, steps: held, collapseMs: log.collapseMs, goneMs: log.life.ms, first: log.first, life: log.life };
            expect(due !== null && due >= 100 && due <= 133.4, `${mode}: the window's open reaches full height ${due} ms after it begins, not in 100 to 133 ms: ${JSON.stringify(sched)}`);
            expect(sched.length >= 3 && !offBeat.length, `${mode}: the open's steps do not change on 2 frames: ${JSON.stringify(sched)}`);
            expect(full !== null, `${mode}: no drawn frame showed the window open`);
            expect(held.length >= 2 && held.length <= 4, `${mode}: the window opens through ${held.length} heights, not in steps: ${JSON.stringify(held)}`);
            expect(held.every((s) => s.held >= 25), `${mode}: a step of the open lasts under 2 frames: ${JSON.stringify(held)}`);
            expect(log.collapseMs !== null && log.collapseMs >= 150 && log.collapseMs <= 200, `${mode}: the close collapses to a bar in ${log.collapseMs} ms, not 167 ms; ${life}`);
          } else {
            const shown = firstAt(log.open, (f) => f.opacity >= 0.999);
            timing[mode] = { openMs: log.fadeInMs, firstFullFrameMs: shown, goneMs: log.life.ms, first: log.first, clipped: log.open.some((f) => f.inset > 0.5), life: log.life };
            expect(!timing[mode].clipped, `${mode}: the window still opened in steps`);
            expect(log.fadeInMs !== null && log.fadeInMs <= 200, `${mode}: the window takes ${log.fadeInMs} ms to fade in`);
            expect(shown !== null, `${mode}: no drawn frame showed the window faded in`);
          }
          expect(!errors.length, errors.join('\n'));
        } finally {
          await ctx.close();
        }
      });
    await each(cases);
    return timing;
  },

  /** Enter or Space on a focused Skip during the chest hold skips, like a tap: the hold leaves its keys to buttons */
  async 'chest-skip-keys'({ open, sleep, expect, SEEN, out }) {
    const skipMs = {};
    const cases = [];
    for (const how of ['Enter', 'Space'])
      cases.push(async () => {
        const at = `chest, ${how}`;
        const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN }, `?shot=chest&mute${LIGHT}`, PHONE);
        try {
          await pastStartup(page);
          await watch(page);
          await traced(page, out, `chest-skip-keys-${how}`, '.sw, .chest-hold, .rw', async () => {
            await page.locator('.title-screen').click();
            // the hold takes its keys from the moment it is on the page, so the press goes in then, faded in or not
            await page.locator('.chest-hold .ch-target').waitFor({ timeout: 60000 });
            await page.evaluate(afterSkip);
            await page.evaluate(skipTimes);
            await page.locator('.ui-skip').focus();
            await page.keyboard.press(how);
            const skip = await page.waitForFunction(() => { const r = window.__skip; return r.at !== null && r.gone !== null && r.rewards !== null && r; }, null, { polling: 100, timeout: 8000 }).then((h) => h.jsonValue(), () => page.evaluate(() => window.__skip));
            skipMs[at] = skip;
            expect(skip.at !== null, `${at}: Skip never took the input`);
            expect(skip.gone !== null && skip.gone <= 1000, `${at}: the hold prompt was still up 1 s after Skip (gone at ${skip.gone} ms, nodes ${skip.watched.join(', ')})`);
            expect(skip.rewards !== null && skip.rewards <= 2500, `${at}: the rewards were not up 2.5 s after Skip (at ${skip.rewards} ms)`);
            await sleep(2500);
            const late = await page.evaluate(() => window.__afterSkip);
            expect(!late.length, `${at}: the skipped beat still showed ${late.join(', ')} after Skip`);
            const bars = await page.evaluate(() => [...document.querySelectorAll('.lb')].map((b) => b.getBoundingClientRect().height));
            expect(bars.every((px) => px < 1), `${at}: the letterbox stayed over the rewards after Skip (${bars.map(Math.round).join(', ')} px)`);
            expect(await page.locator('.rw').count(), `${at}: the rewards did not stay up after Skip`);
            expect(!errors.length, errors.join('\n'));
          });
        } finally {
          await ctx.close();
        }
      });
    await each(cases);
    return { skipMs };
  },

  async 'sound-panel-taps'({ open, expect, out }) {
    const { ctx, page, errors } = await firstRun(open, PHONE);
    try {
      await watch(page);
      await traced(page, out, 'sound-panel-taps', '.sw, .vol', async () => {
        await page.locator('.title-screen').click();
        await page.locator('#np-name').waitFor();
        await shown(page);
        await page.locator('.sw-btn:not(.gold)').click();
        const win = page.locator('.sw[data-kind="notification"]');
        await win.waitFor({ timeout: 30000 });
        await shownText(page);
        await page.locator('.vol-btn').click();
        for (const part of ['.vol-range', '.vol-mute', '.vol-head']) {
          const p = await spot(page, part);
          await page.mouse.click(p.x, p.y);
          const left = await win.waitFor({ state: 'detached', timeout: 800 }).then(() => true, () => false);
          expect(!left, `a tap on the sound panel (${part}) answered the Lantern window`);
        }
        const plate = await spot(page, '.sw[data-kind="notification"] .sw-plate');
        await page.mouse.click(plate.x, plate.y);
        expect(!(await page.locator('.vol.is-open').count()), 'the tap outside the sound panel did not close it');
        const stayed = await win.waitFor({ state: 'detached', timeout: 800 }).then(() => false, () => true);
        expect(stayed, 'the tap that closed the sound panel also answered the Lantern window');
        // the next window opens a moment after this one leaves, so this times the one tapped, not any window
        await leaves(page, out, 'sound-panel-taps-close', '.sw[data-kind="notification"]', CLOSE_MS, () => page.mouse.click(plate.x, plate.y));
        expect(!errors.length, errors.join('\n'));
      });
    } finally {
      await ctx.close();
    }
  },

  async 'press-origin'({ open, sleep, expect, SEEN, out }) {
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN }, `?shot=windows&mute${LIGHT}`, PHONE);
    try {
      await pastStartup(page);
      await watch(page);
      await traced(page, out, 'press-origin', '.sw', async () => {
        await page.locator('.title-screen').click();
        const win = '.sw[data-kind="notification"]';
        await page.locator(win).waitFor({ timeout: 30000 });
        await shownText(page);
        const skip = await spot(page, '.ui-skip');
        const plate = await spot(page, `${win} .sw-plate`);
        const stays = async (what) => {
          await sleep(500);
          const s = await page.evaluate((w) => ({ window: !!document.querySelector(w), level: !!document.querySelector('.sw[data-kind="level"]'), rewards: !!document.querySelector('.rw') }), win);
          expect(s.window && !s.level && !s.rewards, `${what} answered the window: ${JSON.stringify(s)}`);
        };
        await page.mouse.move(skip.x, skip.y);
        await page.mouse.down();
        await page.mouse.move(plate.x, plate.y, { steps: 6 });
        await page.mouse.up();
        await stays('a press that started on Skip and ended on the window');
        await page.mouse.click(plate.x, plate.y, { button: 'right' });
        await stays('a right click on the window');
        await leaves(page, out, 'press-origin-tap', win, CLOSE_MS, () => page.mouse.click(plate.x, plate.y));
        await page.locator('.sw[data-kind="level"]').waitFor({ timeout: 5000 });
        expect(!errors.length, errors.join('\n'));
      });
    } finally {
      await ctx.close();
    }
  },

  async 'reduced-screens'({ open, expect, openSettings, SEEN, out }) {
    const still = async (page, sel, at) => {
      await page.locator(sel).waitFor({ timeout: 40000 });
      const moving = await page.evaluate((sel) => {
        const keys = ['transform', 'filter', 'letterSpacing', 'translate', 'scale', 'rotate'];
        return document
          .querySelector(sel)
          .getAnimations({ subtree: true })
          .flatMap((a) => {
            const frames = a.effect.getKeyframes();
            const bad = keys.filter((k) => new Set(frames.map((f) => f[k] ?? '')).size > 1);
            if (a.effect.getComputedTiming().iterations === Infinity) bad.push('endless');
            return bad.length ? [`${window.__name(a.effect.target)} ${bad.join('+')}`] : [];
          });
      }, sel);
      expect(!moving.length, `${at}: with reduced motion ${sel} still moves: ${moving.join(', ')}`);
    };
    const tapShown = async (page, sel) => {
      await page.waitForFunction((sel) => {
        const b = document.querySelector(sel);
        const r = b?.getBoundingClientRect();
        return r && b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }, sel, { timeout: 10000 });
      const p = await spot(page, sel);
      return () => page.mouse.click(p.x, p.y);
    };
    const timed = async (page, screen, at) => {
      const r = await page.waitForFunction((s) => window.__entrances?.[s]?.at !== undefined && window.__entrances[s], screen, { polling: 'raf', timeout: 5000 }).then((h) => h.jsonValue());
      const slow = r.schedule.filter((s) => s.end !== Infinity && (s.delay > 0 || s.end > FADE_MS));
      expect(!slow.length, `${at}: with reduced motion ${screen} still comes in over ${Math.max(0, ...slow.map((s) => s.end))} ms, not one ${FADE_MS} ms fade: ${slow.map((s) => `${s.target} ${s.delay}+${s.duration}`).join(', ')}`);
      expect(!r.running.length && !r.faint.length && (r.ring === null || r.ring === 0), `${at}: ${screen} was not finished ${r.at} ms in: running ${r.running.join(', ') || 'none'}, faint ${r.faint.join(', ') || 'none'}, ring offset ${r.ring}`);
      return r;
    };
    const screens = async (page, at) => {
      const seen = {};
      for (const [screen, button] of [['.rw', '.rw .sw-btn'], ['.letter-wrap', '.letter .sw-btn'], ['.endcard', '.ec-actions .sw-btn.gold']]) {
        await traced(page, out, `reduced-screens-${at}-${screen.slice(1)}`, screen, async () => {
          await still(page, screen, at);
          const r = await timed(page, screen, at);
          const left = await leaves(page, out, `reduced-screens-${at}-${screen.slice(1)}-leave`, screen, 3000, await tapShown(page, button));
          const exit = await page.evaluate((s) => ({ ...window.__entrances[s].exit, ms: window.__entrances[s].exitMs }), screen);
          expect(exit.delay === 0 && exit.duration <= CLOSE_FADE_MS, `${at}: with reduced motion ${screen} leaves over ${exit.delay}+${exit.duration} ms, not one ${CLOSE_FADE_MS} ms fade`);
          seen[screen.slice(1)] = { inMs: Math.max(...r.schedule.map((s) => s.end)), finishedAt: r.at, outMs: exit.duration, goneMs: exit.ms, life: left.life };
        });
      }
      return seen;
    };
    const reducedNow = (page) => page.evaluate(async () => (await import('/src/core/params.ts')).params.reduced);
    const result = {};

    {
      const { ctx, page, errors } = await open({}, `?shot=rewards&mute${LIGHT}`, PHONE);
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await pastStartup(page);
        await watch(page);
        await page.evaluate(entrances, FADE_MS);
        expect(await reducedNow(page), 'system: the intro did not take reduced motion from the system');
        await page.locator('.title-screen').click();
        result.system = await screens(page, 'system');
        expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
    {
      const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN }, `?mute${LIGHT}`, PHONE);
      try {
        await pastStartup(page);
        await openSettings(page);
        await page.evaluate(() => {
          const s = window.__daily.store;
          s.state.settings.motion = 'reduce';
          s.save();
          window.__daily.applyMotion();
        });
        await page.getByRole('button', { name: 'Replay cutscene' }).click();
        await page.locator('.title-screen').waitFor({ timeout: 30000 });
        await watch(page);
        await page.evaluate(entrances, FADE_MS);
        expect(await reducedNow(page), 'replay: the intro ignored the saved Motion: Reduced');
        await page.locator('.title-screen').click();
        if (await page.locator('#np-name').waitFor({ timeout: 4000 }).then(() => true, () => false)) await page.getByRole('button', { name: 'Skip' }).click();
        await traced(page, out, 'reduced-screens-replay-skip', '.ui-skip', () => page.locator('.ui-skip').click({ timeout: 30000 }));
        result.replay = await screens(page, 'replay');
        expect(!errors.length, errors.join('\n'));
      } finally {
        await ctx.close();
      }
    }
    return result;
  },

  /** The intro and the companion agree on reduced motion for every Motion setting, `?reduced` standing in for the system */
  async 'motion-setting-agrees'({ open, expect, SEEN }) {
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN }, `?mute&reduced${LIGHT}`, PHONE);
    try {
      await page.waitForFunction(() => !!window.__daily?.store, null, { timeout: 30000 });
      const seen = await page.evaluate(async () => {
        const { params } = await import('/src/core/params.ts');
        const out = {};
        for (const m of ['full', 'reduce', 'system']) {
          const s = window.__daily.store;
          s.state.settings.motion = m;
          s.touch('motion');
          s.save();
          window.__daily.applyMotion();
          out[m] = { intro: params.reduced, companion: window.__daily.reduced() };
        }
        return out;
      });
      const want = { full: false, reduce: true, system: true };
      const off = Object.entries(seen).filter(([m, v]) => v.intro !== want[m] || v.companion !== want[m]);
      expect(!off.length, `the intro and the companion disagree on reduced motion: ${JSON.stringify(seen)}`);
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  /** Motion: Reduced chosen in another open copy holds in this one too, so a replay of its intro follows it */
  async 'motion-from-another-tab'({ open, expect, SEEN }) {
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN }, `?mute${LIGHT}`, PHONE);
    try {
      const other = await ctx.newPage();
      other.on('pageerror', (e) => errors.push('pageerror in the other tab: ' + e.message));
      await other.goto(page.url());
      for (const p of [page, other]) await p.waitForFunction(() => !!window.__daily?.store, null, { timeout: 30000 });
      await page.evaluate(async () => (window.__params = (await import('/src/core/params.ts')).params));
      const before = await page.evaluate(() => window.__params.reduced);
      await other.evaluate(() => {
        const s = window.__daily.store;
        s.state.settings.motion = 'reduce';
        s.touch('motion');
        s.save();
        window.__daily.applyMotion();
      });
      const followed = await page.waitForFunction(() => window.__params.reduced && window.__daily.store.state.settings.motion === 'reduce', null, { timeout: 10000 }).then(() => true, () => false);
      const now = await page.evaluate(() => ({ stored: window.__daily.store.state.settings.motion, reduced: window.__params.reduced }));
      expect(!before, 'the intro took reduced motion before any tab chose it');
      expect(followed, `Motion: Reduced chosen in another tab did not reach this one's intro: ${JSON.stringify(now)}`);
      expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },
};
