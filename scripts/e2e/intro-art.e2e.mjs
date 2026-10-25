// The intro's 3D world, beat by beat. Each scenario steps the real intro on the stage clock (?capture) from one beat
// on, at one screen size, and saves the full page at the moments each beat is about: the gate in the dark, the
// silhouette, AWAKEN, the chest. Every saved frame must show the scene (not a blank or flat frame), and each beat's
// background must read as the same night: a sky with a lit horizon and depth behind the action, never a flat fill.
// The flash scenario counts flashes through the gate, AWAKEN and the chest frame by frame and fails above three a
// second (DESIGN.md: never more than 3 flashes per second). Frames, numbers and renderer go to report.json.

import fs from 'node:fs';
import path from 'node:path';

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const DESKTOP = { width: 1440, height: 900 };

/** Moments to save, in seconds from the start of each beat. */
const MOMENTS = {
  gate: [['dark', 1.2], ['race', 2.04], ['open', 2.6], ['hold', 5.6]],
  silhouette: [['low', 2.4], ['mid', 4.8], ['eyes', 12.4]],
  awaken: [['reach', 2.6], ['command', 4.2], ['hit', 5.1], ['vortex', 6.4], ['smoke', 7.9], ['rise', 9.4], ['army', 12.2], ['kneel', 14.6]],
  chest: [['reveal', 1.4], ['charge', 3.6], ['burst', 4.62], ['open', 5.6], ['reward', 6.6]],
};

/** Installs the in-page helpers: a stepper, beat clocks and a frame reader. */
async function probe(page) {
  await page.evaluate(() => {
    const s = window.__stage;
    const pause = () => new Promise((r) => setTimeout(r));
    const find = (name) => s.scene.getObjectByName(name);
    const tiny = document.createElement('canvas');
    window.__art = {
      async step(until, dt = 1 / 30, max = 6000) {
        for (let i = 0; i < max && !until(); i++) {
          s.step(dt);
          if (i % 4 === 0) await pause();
        }
        return until();
      },
      /** Seconds since the current beat started, or null before it. */
      clock(beat) {
        if (beat === 'gate') {
          // the gate beat's camera dollies linearly from z 11.5 to 10.0 over 13 s (GATE in src/motion/tokens.ts)
          const z = s.camera.position.z;
          return find('gate') && s.camera.fov === 30 && z <= 11.5 && z >= 10 ? ((11.5 - z) / 1.5) * 13 : null;
        }
        if (beat === 'awaken') return window.__awakenLT ?? null;
        const mark = window.__beatMark;
        return mark && mark.beat === beat ? s.time - mark.t : null;
      },
      /** Records when a beat's first frame drew (the hero shows for the silhouette, the chest for the chest). */
      watch(beat) {
        const hero = () => find('hero');
        const shown = beat === 'silhouette' ? () => hero()?.visible : () => s.scene.children.some((o) => o.name === 'chest' && o.visible);
        const id = s.onUpdate(() => {
          if (!window.__beatMark && shown()) window.__beatMark = { beat, t: s.time };
        });
        return !!id;
      },
      /** Mean colour and spread of the canvas in a grid, from a small copy (0..255 per channel). */
      read(cols = 8, rows = 16) {
        tiny.width = cols;
        tiny.height = rows;
        const g = tiny.getContext('2d', { willReadFrequently: true });
        g.drawImage(s.canvas, 0, 0, cols, rows);
        const d = g.getImageData(0, 0, cols, rows).data;
        const cells = [];
        for (let i = 0; i < d.length; i += 4) cells.push([d[i], d[i + 1], d[i + 2]]);
        return cells;
      },
      info() {
        const r = s.renderer.info;
        return { calls: r.render.calls, triangles: r.render.triangles, programs: r.programs?.length ?? 0, geometries: r.memory.geometries, textures: r.memory.textures };
      },
    };
  });
}

/** Luma of an sRGB triple, 0..1. */
const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** How much of a frame shows the scene: the share of cells brighter than the void, and the spread of the cells. */
function content(cells) {
  const L = cells.map(luma);
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  const sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length);
  const lit = L.filter((v) => v > 0.06).length / L.length;
  return { mean: +mean.toFixed(4), sd: +sd.toFixed(4), lit: +lit.toFixed(3) };
}

/**
 * The background behind the action, from the top fifth of a frame (the sky in every shot that looks up or level):
 * its mean colour, and how much it changes across the band. A flat fill has no change; a night sky has a gradient,
 * stars or cloud.
 */
function sky(cells, cols, rows) {
  const band = cells.slice(0, cols * Math.max(1, Math.round(rows / 5)));
  const L = band.map(luma);
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  const sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length);
  const rgb = [0, 1, 2].map((k) => band.reduce((a, c) => a + c[k], 0) / band.length);
  return { mean: +mean.toFixed(4), sd: +sd.toFixed(4), blue: +(rgb[2] - rgb[0]).toFixed(2) };
}

/** Opens the intro at `beat` on the stage clock and walks to each moment, saving the page and reading the frame. */
async function walkBeat(h, viewport, beat) {
  const tag = viewport === PORTRAIT ? 'portrait' : viewport === LANDSCAPE ? 'landscape' : 'desktop';
  const { page, errors } = await h.open({}, `?shot=${beat}&capture&mute`, viewport);
  await page.waitForFunction(() => !!window.__stage, null, { timeout: 60000 });
  await probe(page);
  await page.evaluate((b) => window.__art.watch(b), beat);
  const started = await page.evaluate(async (b) => window.__art.step(() => window.__art.clock(b) !== null, 1 / 30, 4000), beat);
  h.expect(started, `${tag} ${beat}: the beat never started`);
  const frames = [];
  for (const [name, at] of MOMENTS[beat]) {
    const ok = await page.evaluate(async ([b, at]) => window.__art.step(() => (window.__art.clock(b) ?? -1) >= at, 1 / 60, 4000), [beat, at]);
    h.expect(ok, `${tag} ${beat}: never reached ${name} (${at} s)`);
    const file = `art-${beat}-${name}-${tag}`;
    await page.screenshot({ path: path.join(h.out, file + '.png') });
    const cells = await page.evaluate(() => window.__art.read());
    const info = await page.evaluate(() => window.__art.info());
    frames.push({ beat, name, at, file, content: content(cells), sky: sky(cells, 8, 16), info });
  }
  h.expect(!errors.length, `${tag} ${beat}: ${errors.join('; ')}`);
  await page.context().close();
  return frames;
}

async function allBeats(h, viewport) {
  const frames = [];
  for (const beat of Object.keys(MOMENTS)) frames.push(...(await walkBeat(h, viewport, beat)));
  const blank = frames.filter((f) => f.name !== 'dark' && (f.content.lit < 0.02 || f.content.sd < 0.01));
  h.expect(!blank.length, `blank frames: ${blank.map((f) => `${f.file} ${JSON.stringify(f.content)}`).join(', ')}`);
  return frames;
}

/**
 * Flashes, counted the way WCAG 2.3.1 defines them, on the real frames the GPU draws while the intro plays in real time
 * (no ?capture). Every frame is read back right after it renders, at dpr 1, into cells of 15 px holding relative
 * luminance and red.
 * - General flash: a pair of opposing changes in relative luminance of at least 0.1 (0..1) where the darker state is
 *   under 0.8.
 * - Red flash: a pair of opposing transitions to or from a saturated red (R / (R + G + B) >= 0.8, linear) where
 *   max(0, R - G - B) * 320 changes by more than 20.
 * - Area: a count holds when cells covering at least 25 % of a 10 degree visual field flash that often in the same
 *   second. The field is about 312 px square on a phone at reading distance, and a third of the screen each way on a
 *   desktop (WCAG's 341 x 256 at 1024 x 768).
 * Fails above three flashes in any one second (DESIGN.md).
 */
const CELL = 15;

/** Installed in the page: reads each frame the app draws into the cell grid, right after it renders. */
function recordFrames(cell) {
  const s = window.__stage;
  const gl = s.renderer.getContext();
  const lin = Float32Array.from({ length: 256 }, (_, i) => (i / 255 <= 0.04045 ? i / 255 / 12.92 : ((i / 255 + 0.055) / 1.055) ** 2.4));
  const rec = { t: [], L: [], m: [], q: [], cols: 0, rows: 0, skipped: 0, cell };
  let buf;
  const step = s.step.bind(s);
  s.step = (dt) => {
    step(dt);
    if (rec.stop) return;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const cols = Math.max(1, Math.round(w / cell)), rows = Math.max(1, Math.round(h / cell));
    if (!rec.cols) Object.assign(rec, { cols, rows, w, h });
    if (cols !== rec.cols || rows !== rec.rows) return void rec.skipped++;
    if (!buf || buf.length !== w * h * 4) buf = new Uint8Array(w * h * 4);
    s.renderer.setRenderTarget(null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const n = cols * rows, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), C = new Uint32Array(n);
    for (let y = 0; y < h; y += 2) {
      const row = (rows - 1 - Math.min(rows - 1, Math.floor((y * rows) / h))) * cols;
      for (let x = 0; x < w; x += 2) {
        const c = row + Math.min(cols - 1, Math.floor((x * cols) / w)), o = (y * w + x) * 4;
        R[c] += lin[buf[o]];
        G[c] += lin[buf[o + 1]];
        B[c] += lin[buf[o + 2]];
        C[c]++;
      }
    }
    const L = new Float32Array(n), m = new Float32Array(n), q = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const r = R[c] / C[c], g = G[c] / C[c], b = B[c] / C[c];
      L[c] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      m[c] = Math.max(0, r - g - b) * 320;
      q[c] = r + g + b > 0 ? r / (r + g + b) : 0;
    }
    rec.t.push(performance.now());
    rec.L.push(L);
    rec.m.push(m);
    rec.q.push(q);
  };
  window.__flash = rec;
}

/** In the page: the most flashes in any one second over an area that matters, general and red, and where. */
function countFlashes([fieldW, fieldH]) {
  const rec = window.__flash;
  rec.stop = true;
  const { t, L, m, q, cols, rows } = rec;
  const F = t.length, n = cols * rows;
  // frame indices where a cell's value completes a qualifying swing away from its last extreme
  const turns = (c, v, thr, ok) => {
    const out = [];
    let dir = 0, ext = v[0][c], extI = 0, lo = ext, loI = 0, hi = ext, hiI = 0;
    for (let i = 1; i < F; i++) {
      const x = v[i][c];
      if (!dir) {
        if (x < lo) [lo, loI] = [x, i];
        if (x > hi) [hi, hiI] = [x, i];
        if (x - lo >= thr && ok(c, loI, i)) [dir, ext, extI] = [1, x, i];
        else if (hi - x >= thr && ok(c, hiI, i)) [dir, ext, extI] = [-1, x, i];
        else continue;
        out.push(i);
      } else if (dir * (x - ext) > 0) [ext, extI] = [x, i];
      else if (dir * (ext - x) >= thr && ok(c, extI, i)) {
        out.push(i);
        [dir, ext, extI] = [-dir, x, i];
      }
    }
    return out;
  };
  const fw = Math.min(cols, Math.round(fieldW / rec.cell)), fh = Math.min(rows, Math.round(fieldH / rec.cell));
  const need = Math.ceil(0.25 * fw * fh);
  const worst = (cellTurns) => {
    let best = { flashes: 0, at: 0, x: 0, y: 0, cells: 0 };
    const starts = [...new Set(cellTurns.flat())].sort((a, b) => a - b);
    const lower = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
    const ends = (i) => { let j = i; while (j < F && t[j] - t[i] < 1000) j++; return j; };
    for (const s of starts) {
      const e = ends(s);
      const per = cellTurns.map((a) => Math.floor((lower(a, e) - lower(a, s)) / 2));
      const top = Math.max(...per);
      for (let k = Math.max(1, best.flashes + 1); k <= top; k++) {
        // summed-area table of cells flashing at least k times this second; any field holding enough of them counts
        const S = new Int32Array((cols + 1) * (rows + 1));
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
          S[(y + 1) * (cols + 1) + x + 1] = (per[y * cols + x] >= k) + S[y * (cols + 1) + x + 1] + S[(y + 1) * (cols + 1) + x] - S[y * (cols + 1) + x];
        let hit = null;
        for (let y = 0; y + fh <= rows && !hit; y++) for (let x = 0; x + fw <= cols && !hit; x++) {
          const a = S[(y + fh) * (cols + 1) + x + fw] - S[y * (cols + 1) + x + fw] - S[(y + fh) * (cols + 1) + x] + S[y * (cols + 1) + x];
          if (a >= need) hit = { x: (x + fw / 2) * rec.cell, y: (y + fh / 2) * rec.cell, cells: a };
        }
        if (!hit) break;
        best = { flashes: k, at: +((t[s] - t[0]) / 1000).toFixed(2), ...hit };
      }
    }
    return best;
  };
  const general = [], red = [];
  for (let c = 0; c < n; c++) {
    general.push(turns(c, L, 0.1, (c, a, b) => Math.min(L[a][c], L[b][c]) < 0.8));
    red.push(turns(c, m, 20 + 1e-6, (c, a, b) => q[a][c] >= 0.8 || q[b][c] >= 0.8));
  }
  const dts = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
  const fps = F > 1 ? +((1000 * (F - 1)) / (t[F - 1] - t[0])).toFixed(1) : 0;
  const perCell = Math.max(0, ...general.map((a) => Math.floor(a.length / 2)));
  return { general: worst(general), red: worst(red), frames: F, seconds: +((t[F - 1] - t[0]) / 1000).toFixed(1), fps, p95ms: +(dts[Math.floor(dts.length * 0.95)] ?? 0).toFixed(1), field: [fw, fh, need], grid: [cols, rows], perCellTotal: perCell, skipped: rec.skipped };
}

/** Plays one beat in real time on the GPU from `?shot=<beat>` and counts its flashes. */
async function flashBeat(h, viewport, beat, secs) {
  const phone = Math.min(viewport.width, viewport.height) <= 500;
  const field = phone ? [312, 312] : [viewport.width / 3, viewport.height / 3];
  const { page, errors } = await h.open({}, `?shot=${beat}&mute&dpr=1`, viewport);
  await page.waitForFunction(() => !!window.__stage, null, { timeout: 60000 });
  // outside ?capture the intro waits on its title screen for a tap, like a player's first visit
  await page.click('.title-screen', { timeout: 30000 });
  await page.evaluate(recordFrames, CELL);
  if (beat === 'chest') {
    // the chest waits for the player: hold Space to charge it, as a player would
    await page.waitForSelector('.ch-target', { timeout: 30000 });
    await h.sleep(300);
    await page.keyboard.down('Space');
    await h.sleep(1900);
    await page.keyboard.up('Space');
  }
  await h.sleep(secs * 1000);
  const r = await page.evaluate(countFlashes, field);
  await page.screenshot({ path: path.join(h.out, `flash-${beat}-end.png`) });
  h.expect(!errors.length, `${beat}: ${errors.join('; ')}`);
  await page.context().close();
  return r;
}

async function flashes(h, viewport) {
  const out = {};
  for (const [beat, secs] of [['gate', 9], ['awaken', 18], ['chest', 6]]) out[beat] = await flashBeat(h, viewport, beat, secs);
  for (const [beat, r] of Object.entries(out)) {
    // a frame rate this low would hide flashes between frames; the measure needs the real 60 fps
    h.expect(r.fps >= 45, `${beat}: only ${r.fps} fps while measuring flashes (${r.frames} frames)`);
  }
  const over = Object.entries(out).flatMap(([b, r]) => ['general', 'red'].filter((k) => r[k].flashes > 3).map((k) => `${b} ${k} ${r[k].flashes} at ${r[k].at} s near (${r[k].x}, ${r[k].y})`));
  h.expect(!over.length, `more than 3 flashes in one second: ${over.join(', ')}`);
  return out;
}

export const scenarios = {
  'intro-art-portrait': (h) => allBeats(h, PORTRAIT),
  'intro-art-landscape': (h) => allBeats(h, LANDSCAPE),
  'intro-art-desktop': (h) => allBeats(h, DESKTOP),
  'intro-art-flashes': (h) => flashes(h, PORTRAIT),
};

export const _test = { content, sky, fs };
