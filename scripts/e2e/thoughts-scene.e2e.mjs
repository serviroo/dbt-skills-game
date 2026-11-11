import { deviceMotion } from './device-motion.e2e.mjs';
import * as pageClock from './clock.mjs';
import {
  DESK,
  drawn,
  flat,
  inStep,
  keepsTime,
  live,
  looks,
  losesContext,
  moreTime,
  openStopped,
  pair,
  PHONE,
  scenes,
  seed,
  SIDE,
  slowGpu,
  steps,
  toSkill,
  until,
} from './skill-scenes.e2e.mjs';

const SMALL = { width: 320, height: 568 };
const SIZES = [['phone', PHONE], ['small', SMALL], ['side', SIDE]];
const PICS = {
  clouds: { label: 'Clouds crossing the sky', words: /Each thought is a cloud/, most: 3 },
  cars: { label: 'Cars on a quiet road', words: /car going past/, most: 2 },
  leaves: { label: 'Leaves on a stream', words: /sits on a leaf/, most: 3 },
};
const NAMES = Object.keys(PICS);

const tap = (page, name) => page.locator('.dq-skill').getByRole('button', { name, exact: true }).first().click();
async function toThoughts(h, page, pic) {
  await toSkill(h, page, 'mindful-thoughts');
  await tap(page, PICS[pic].label);
  await tap(page, 'Ready');
  await page.locator('.dq-timer-svg--thoughts').waitFor({ timeout: 10000 });
  await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
}

const thoughts = (last) => last.probe.things.split(' ').filter(Boolean).map((t) => t.split(':').map(Number));
const out = ([, x, y]) => Math.hypot(x, y);

async function countdownClear(h, page, where) {
  const [num, win] = await Promise.all([
    page.locator('.dq-timer-num').boundingBox(),
    page.locator('.dq-scene').boundingBox(),
  ]);
  h.expect(
    num && win && num.y >= win.y + win.height - 1,
    `${where}: the countdown is over the scene (${JSON.stringify({ num, win })})`,
  );
}

async function otherCopy(h, ctx, page, errors) {
  const [other] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(() => void window.open('/?mute'))]);
  other.on('pageerror', (e) => errors.push('pageerror, other copy: ' + e.message));
  await h.openSettings(other);
  await page.bringToFront();
  return (m) => other.getByRole('radio', { name: `Motion: ${m}`, exact: true }).click();
}

async function holdsStill(h, page, pic, where) {
  await page.waitForFunction(() => window.__scenes?.last.still, null, { timeout: 15000 });
  const a = await scenes(page);
  await h.frames(page, 60);
  const b = await scenes(page);
  h.expect(
    a.last.kind === 'thoughts' && a.last.probe.pic === pic && b.frames === a.frames,
    `${where}: not one still frame of the ${pic} (${a.frames} -> ${b.frames}, ${JSON.stringify(a.last)})`,
  );
  h.expect(
    thoughts(a.last).some((t) => out(t) < 0.8),
    `${where}: no thought stands in the window (${a.last.probe.things})`,
  );
}

async function moving(h, page, where) {
  const from = await scenes(page);
  await until(page, (n) => window.__scenes.frames > n + 10 && !window.__scenes.last.still, from.frames);
  const c = await pair(page);
  h.expect(
    c.s.frames > from.frames + 10 && !c.s.last.still,
    `${where}: the scene is not moving (${from.frames} -> ${c.s.frames})`,
  );
  inStep(h, c, where);
}

const countBuffers = () => {
  window.__buffers = 0;
  const p = WebGL2RenderingContext.prototype;
  const [make, drop] = [p.createBuffer, p.deleteBuffer];
  p.createBuffer = function () {
    const b = make.call(this);
    if (b) window.__buffers++;
    return b;
  };
  p.deleteBuffer = function (b) {
    if (b && this.isBuffer(b)) window.__buffers--;
    return drop.call(this, b);
  };
};

async function picture(h, pic) {
  for (const [tag, vp] of [...SIZES, ['desk', DESK]]) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
    await ctx.addInitScript(countBuffers);
    await openStopped(h, page, (h, page) => toThoughts(h, page, pic), `${pic} ${tag}`);
    h.expect(
      PICS[pic].words.test(await page.locator('.dq-skill').innerText()),
      `${pic} ${tag}: the watch step does not say ${PICS[pic].words}`,
    );
    await looks(h, page, `${pic}-${tag}`, 'thoughts', vp, undefined, { stopped: true });
    h.expect(
      (await scenes(page)).last.probe.pic === pic,
      `${pic} ${tag}: the scene shows ${(await scenes(page)).last.probe.pic}`,
    );
    await countdownClear(h, page, `${pic} ${tag}`);
    if (tag === 'phone') {
      const path = new Map();
      let most = 0;
      for await (const at of steps(h, page, pic, 2000, { run: true })) {
        const up = thoughts(at);
        for (const t of up) path.set(t[0], [...(path.get(t[0]) ?? []), { e: at.e, x: t[1], y: t[2], r: out(t) }]);
        const seen = up.filter((t) => out(t) < 1);
        most = Math.max(most, seen.length);
        h.expect(
          seen.length <= PICS[pic].most,
          `${pic}: ${seen.length} thoughts in the window at once at ${at.e.toFixed(1)} s (${at.probe.things})`,
        );
        for (const a of seen)
          for (const b of seen)
            if (a !== b)
              h.expect(
                Math.hypot(a[1] - b[1], a[2] - b[2]) >= 0.3,
                `${pic}: two thoughts on top of each other at ${at.e.toFixed(1)} s (${at.probe.things})`,
              );
        if (at.e >= at.dur - 4) break;
      }
      const said = [...path]
        .map(([n, ps]) => `${n}: ${ps.map((p) => `${p.e.toFixed(0)}s ${p.x.toFixed(2)}/${p.r.toFixed(2)}`).join(' ')}`)
        .join('; ');
      const crossed = [...path].filter(([, ps]) => {
        const inside = ps.filter((p) => p.r < 0.75);
        const steady = ps.every(
          (p, i) => !i || (Math.hypot(p.x - ps[i - 1].x, p.y - ps[i - 1].y) > 0.05 && p.x > ps[i - 1].x - 0.02),
        );
        return ps[0].r > 1 && inside.length && ps[ps.length - 1].r > 1 && steady
          && inside[inside.length - 1].e - inside[0].e >= 4;
      });
      h.expect(
        crossed.length >= 1,
        `${pic}: no thought came in, crossed the window steadily and went out within the minute (${said})`,
      );
      console.log(`  ${pic}: ${crossed.length} crossed in the minute, at most ${most} in view; ${said}`);
      await page.locator('.dq-timer').getByRole('button', { name: '+30 s', exact: true }).click();
      await keepsTime(h, page, 'thoughts');
      const held = await page.evaluate(() => window.__buffers);
      h.expect(held === 0, `${pic} left: ${held} GPU buffers still held`);
    }
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  }
}

async function lampGlow(page, sizes) {
  return page.evaluate(async (sizes) => {
    const { paintCars } = await import('/src/scene/vignettes/scenes/thoughts/cars.ts');
    const { FOV } = await import('/src/scene/vignettes/scenes/thoughts/picture.ts');
    const lib = performance.getEntriesByType('resource').find((e) => e.name.includes('/deps/three.js'));
    const THREE = await import(lib.name);
    const renderer = new THREE.WebGLRenderer();
    const gl = renderer.getContext();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1200);
    const picture = paintCars(scene, camera, { value: 0 });
    const glows = scene.children.find((o) => o.material.uniforms?.uLamp);
    const { uLamp, uSize } = glows.material.uniforms;
    const objects = scene.children.filter((o) => o !== glows);
    const [, valley, road, trees, ...cars] = objects;
    let w, h, target;
    const alone = (o) => scene.children.filter((c) => c.geometry === o.geometry).length === 1;
    const solid = scene.children.filter(
      (o) => o !== glows && o.material.depthTest && o.material.depthWrite && alone(o),
    );
    const surfaces = objects.filter((o) => o.material.depthTest && o.material.depthWrite);
    const ray = new THREE.Raycaster();
    const blocked = (to) => {
      const toward = to.clone().sub(camera.position);
      ray.set(camera.position, toward.clone().normalize());
      ray.far = toward.length() - 0.05;
      return ray.intersectObjects(solid, false).length > 0;
    };
    const AROUND = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].map(([x, y]) => new THREE.Vector3(x, y, 0));
    const coverage = new Map();
    const cover = (lamp, state) => {
      const key = `${state}|${camera.position.toArray()}|${lamp.toArray()}`;
      if (!coverage.has(key)) coverage.set(key, AROUND.filter((d) => blocked(d.clone().add(lamp))).length);
      return coverage.get(key);
    };
    const nearest = (x, y) => {
      ray.setFromCamera(new THREE.Vector2(((x + 0.5) / w) * 2 - 1, ((y + 0.5) / h) * 2 - 1), camera);
      ray.far = Infinity;
      return ray.intersectObjects(surfaces.filter((o) => o.visible), false)[0];
    };
    const halo = (lamp, depth) => {
      const { x: size, y: least, z: most } = uSize.value;
      const px = (size * camera.projectionMatrix.elements[5] * h * 0.5) / depth;
      return Math.round(0.4 * Math.min(Math.max(px, least), most) * (0.6 + 0.4 * lamp.w));
    };
    let offset = 0;
    const frame = (lit, points) => {
      glows.visible = lit;
      const ys = points.map(([, y]) => y);
      const low = Math.min(...ys), height = Math.max(...ys) - low + 1;
      target.scissor.set(points[0][0], low, 1, height);
      target.scissorTest = true;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const start = offset;
      gl.readPixels(points[0][0], low, 1, height, gl.RGBA, gl.UNSIGNED_BYTE, start);
      offset += height * 4;
      return points.map(([, y]) => start + (y - low) * 4);
    };
    const results = [];
    for ([w, h] of sizes) {
      target = new THREE.WebGLRenderTarget(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      picture.resize(w, h);
      const seen = { hidden: [], clear: [] };
      const reads = [];
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 101 * 2 * 4 * h * 4, gl.STREAM_READ);
      offset = 0;
      for (let k = 0; k <= 100; k++) {
        picture.pose(0, [{ n: 0, u: k / 100 }]);
        scene.updateMatrixWorld();
        const state = solid.map((o) => [o.id, o.geometry.id, o.geometry.attributes.position.version,
          o.geometry.index?.version, o.geometry.drawRange.start, o.geometry.drawRange.count, o.material.side,
          o.count, o.instanceMatrix?.version, ...o.matrixWorld.elements].join(',')).join('|');
        const lamps = uLamp.value.slice(0, 2);
        for (let i = 0; i < lamps.length; i++) {
          const spot = new THREE.Vector3(lamps[i].x, lamps[i].y, lamps[i].z);
          const covered = cover(spot, state);
          if (covered !== 0 && covered !== AROUND.length) continue;
          const depth = -spot.clone().applyMatrix4(camera.matrixWorldInverse).z;
          const at = spot.clone().project(camera);
          if (Math.abs(at.x) > 0.95 || Math.abs(at.y) > 0.95) continue;
          const [x, y] = [Math.round(((at.x + 1) * w) / 2), Math.round(((at.y + 1) * h) / 2)];
          const r = halo(lamps[i], depth);
          const hit = nearest(x, y - r);
          const under = (hit?.distance ?? Infinity) / spot.distanceTo(camera.position);
          const surface = hit?.object === road || hit?.object === valley ? 'ground'
            : hit?.object === trees ? 'tree' : cars.includes(hit?.object) ? 'car' : 'other';
          const points = [[x, y], [x, y + r], [x, y - r]];
          const strength = uLamp.value.map((lamp) => lamp.w);
          uLamp.value.forEach((lamp, j) => { if (j !== i) lamp.w = 0; });
          const on = frame(true, points);
          const off = frame(false, points);
          const visibility = objects.map((o) => o.visible);
          objects.forEach((o) => { o.visible = false; });
          const clearOn = frame(true, points);
          const clearOff = frame(false, points);
          objects.forEach((o, j) => { o.visible = visibility[j]; });
          uLamp.value.forEach((lamp, j) => { lamp.w = strength[j]; });
          reads.push({ covered, u: k / 100, under, surface, on, off, clearOn, clearOff });
        }
      }
      const pixels = new Uint8Array(offset);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(buffer);
      const value = (i) => pixels[i] + pixels[i + 1] + pixels[i + 2];
      for (const { covered, u, under, surface, on, off, clearOn, clearOff } of reads) {
        const [centre, above, below] = on.map((v, j) => value(v) - value(off[j]));
        const reference = clearOn.map((v, j) => value(v) - value(clearOff[j]));
        seen[covered ? 'hidden' : 'clear'].push({ u, centre, above, below, under, surface, reference });
      }
      target.dispose();
      results.push({ size: [w, h], ...seen });
    }
    renderer.dispose();
    return results;
  }, sizes);
}

export const scenarios = {
  async 'thoughts-clouds'(h) {
    await picture(h, 'clouds');
  },
  async 'thoughts-cars'(h) {
    await picture(h, 'cars');
  },
  async 'thoughts-cars-lamps-behind'(h) {
    const said = (spots) => spots.map((s) =>
      `${s.u}: ${s.below}/${s.centre}/${s.above} (clear ${s.reference[2]}/${s.reference[0]}/${s.reference[1]})`,
    ).join(', ');
    const measured = new Set();
    for (const [tag, vp] of [...SIZES, ['desk', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      const { min, max } = await page.evaluate(async () => {
        const { SCENE } = await import('/src/motion/tokens.ts');
        const { lendRenderer } = await import('/src/scene/lease.ts');
        const lease = lendRenderer(document.createElement('div'), { evict() {}, lost() {}, restored() {} });
        const max = lease.maxDpr;
        lease.release();
        return { min: Math.min(max, SCENE.minDpr), max };
      });
      await toThoughts(h, page, 'cars');
      const { css, live } = await page.locator('.dq-scene canvas').evaluate((c) => ({
        css: [c.parentElement.clientWidth, c.parentElement.clientHeight], live: [c.width, c.height],
      }));
      const ratios = new Set([min, max]);
      for (const dimension of css)
        for (let n = Math.ceil(dimension * min); n <= Math.floor(dimension * max); n++)
          ratios.add(Math.min(max, n / dimension + 1e-9));
      const sweep = [live, ...[...ratios].map((r) => css.map((n) => Math.floor(n * r))),
        ...[155, 165, 191].map((n) => [n, n])];
      const sizes = sweep.filter((s) => {
        const key = s.join('x');
        if (measured.has(key)) return false;
        measured.add(key);
        return true;
      });
      console.log(`  cars ${tag}: CSS ${css.join('x')}, ratio ${min}-${max}, ${sizes.length} new sizes`);
      for (const { size: [width, height], hidden, clear } of await lampGlow(page, sizes)) {
        const where = `${tag} ${width}x${height}`;
        const shows = hidden.filter((s) => s.centre > 6);
        const dim = clear.filter((s) => s.centre < 40);
        const bad = [...hidden, ...clear].filter((s) => s.reference.some((v) => v <= 0));
        const ground = clear.filter((s) => s.surface === 'ground' && s.under > 0.5);
        const covered = clear.filter((s) => s.surface === 'tree' || s.surface === 'car');
        const cut = ground.filter((s) => s.below * s.reference[1] < s.above * s.reference[2] / 2);
        h.expect(!bad.length, `cars ${where}: clear glow measurement is not positive (${said(bad)})`);
        h.expect(!shows.length, `cars ${where}: headlights behind the hill or trees still glow (${said(shows)})`);
        h.expect(ground.length, `cars ${where}: no clear lamp has its lower sample on the road or valley`);
        h.expect(!cut.length, `cars ${where}: the road cuts the bottom off a headlight's glow (${said(cut)})`);
        h.expect(clear.length && !dim.length, `cars ${where}: headlights in plain view do not glow (${said(dim)})`);
        h.expect(hidden.length, `cars ${where}: no car passed behind the hill or trees`);
        console.log(`  cars ${where}: ${hidden.length} hidden, ${clear.length} clear, ${ground.length} ground, ` +
          `${covered.length} tree or car nearest`);
      }
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },
  async 'thoughts-leaves'(h) {
    await picture(h, 'leaves');
  },

  async 'thoughts-clouds-moon'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await openStopped(h, page, (h, page) => toThoughts(h, page, 'clouds'), 'clouds moon');
    const moon = [];
    let shot = false;
    for await (const at of steps(h, page, 'clouds moon', 2000, { run: true })) {
      if (at.e >= at.dur - 2) break;
      moon.push(at.probe.moon);
      if (!shot && at.probe.moon < 0.5) {
        shot = true;
        await h.shot(page, 'thoughts-clouds-moon');
      }
    }
    const low = moon.indexOf(Math.min(...moon));
    h.expect(
      moon[low] < 0.5 && moon.slice(low).some((m) => m > 0.95),
      `clouds: the moon did not dim behind a cloud and come back (${moon.map((m) => m.toFixed(2)).join(' ')})`,
    );
    console.log(`  clouds moon: ${moon.map((m) => m.toFixed(2)).join(' ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'thoughts-still'(h) {
    for (const [k, [tag, vp]] of SIZES.entries()) {
      for (const pic of NAMES) {
        const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await toThoughts(h, page, pic);
        await live(h, page, `still ${pic} ${tag}`);
        await holdsStill(h, page, pic, `reduced motion, ${pic} ${tag}`);
        await drawn(h, page, `still ${pic} ${tag}`);
        await h.shot(page, `thoughts-still-${pic}-${tag}`);
        h.expect(!errors.length, errors.join('\n'));
        await ctx.close();
      }
      const pic = NAMES[k];
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      const device = await deviceMotion(ctx, page);
      await toThoughts(h, page, pic);
      await live(h, page, `motion ${pic} ${tag}`);
      await moreTime(page);
      await moving(h, page, `${pic} ${tag}, Full`);
      await device('reduce');
      await holdsStill(h, page, pic, `${pic} ${tag}, device set to reduce motion`);
      await device('no-preference');
      await moving(h, page, `${pic} ${tag}, device back to motion`);
      const set = await otherCopy(h, ctx, page, errors);
      await set('Reduced');
      await holdsStill(h, page, pic, `${pic} ${tag}, Reduced in another copy`);
      await set('Full');
      await moving(h, page, `${pic} ${tag}, Full again`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'thoughts-context-loss'(h) {
    for (const [k, [tag, vp]] of SIZES.entries()) {
      const pic = NAMES[k];
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await openStopped(h, page, (h, page) => toThoughts(h, page, pic), `lost ${pic} ${tag}`);
      const { now } = await losesContext(h, page, `${pic} ${tag}`, `thoughts-lost-${pic}-${tag}`, async () => {
        h.expect(
          await page.locator(`.dq-thoughts--${pic}`).isVisible(),
          `lost ${pic} ${tag}: the flat ${pic} did not come back`,
        );
      });
      h.expect(now.s.last.probe.pic === pic, `restored ${pic} ${tag}: the scene shows ${now.s.last.probe.pic}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'thoughts-slow-gpu'(h) {
    const COST = { clouds: [40000, 600], cars: [40000, 3500], leaves: [40000, 2000] };
    for (const [k, [tag, vp]] of SIZES.entries()) {
      const pic = NAMES[k];
      await slowGpu(h, {
        vp,
        reach: (h, page) => toThoughts(h, page, pic),
        more: 0,
        cost: COST[pic],
        tag: `thoughts-slow-gpu-${pic}-${tag}`,
      });
    }
  },

  async 'thoughts-no-webgl'(h) {
    for (const pic of NAMES) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
      await ctx.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest);
        };
      });
      await pageClock.reloadOnFakeClock(page);
      await h.reachHub(page);
      const save = async () => JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}');
      const keys = async () => page.evaluate(() => Object.keys(localStorage).sort());
      const [before, storedBefore] = [await save(), await keys()];
      await toThoughts(h, page, pic);
      await pageClock.runFor(page, 1500);
      await h.sleep(800);
      const s = await scenes(page);
      h.expect(
        s && s.contexts === 0 && s.live === 0 && !(await page.locator('.dq-scene').count()),
        `no WebGL ${pic}: a scene was left on the page: ${JSON.stringify(s)}`,
      );
      const shown = await flat(page);
      const others = NAMES.filter((p) => p !== pic);
      h.expect(
        shown.length > 1 && shown.every(Boolean) && (await page.locator(`.dq-thoughts--${pic}`).isVisible()),
        `no WebGL ${pic}: the flat ${pic} is hidden (${JSON.stringify(shown)})`,
      );
      h.expect(
        (await page.locator(others.map((p) => `.dq-thoughts--${p}`).join(',')).count()) === 0,
        `no WebGL ${pic}: another choice's picture is there too`,
      );
      const look = () =>
        page.$$eval('.dq-thoughts > [visibility]', (els) =>
          els.map((e) => `${e.getAttribute('visibility')} ${e.getAttribute('transform')}`).join(' | '),
        );
      const drawn = await page.$$eval('.dq-thoughts > [visibility=visible]', (els) =>
        els.map((e) => (e.matches('path') ? e : e.querySelector('path'))?.getBBox().width ?? 0),
      );
      h.expect(
        drawn.length > 0 && drawn.every((w) => w > 0),
        `no WebGL ${pic}: a thought has no shape of its own (${JSON.stringify(drawn)})`,
      );
      const a = await look();
      await pageClock.runFor(page, 2000);
      const b = await look();
      h.expect(a !== b, `no WebGL ${pic}: the flat picture's thoughts do not move (${a})`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await h.sleep(500);
      await pageClock.runFor(page, 100);
      const c = await look();
      await pageClock.runFor(page, 2000);
      h.expect(c === (await look()), `no WebGL ${pic}, reduced motion: the flat picture's thoughts still move (${c})`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await h.shot(page, `thoughts-no-webgl-${pic}`);
      await pageClock.fastForward(page, 61000);
      await page.locator('.dq-timer-num', { hasText: 'Done' }).waitFor({ timeout: 5000 });
      await tap(page, 'Next');
      await tap(page, 'Next');
      await tap(page, 'Quieter');
      await tap(page, 'Done');
      await page.locator('.dq-feedback').waitFor({ timeout: 5000 });
      await tap(page, 'Yes');
      await page.locator('.dq-after:not(.is-hidden)').waitFor({ timeout: 5000 });
      const after = await save();
      const runs = (sv) => sv.events.filter((e) => e.k === 'skill' && e.skill === 'mindful-thoughts');
      h.expect(
        runs(after).length === runs(before).length + 1,
        `no WebGL ${pic}: Spectator Mode was not counted once (${runs(before).length} -> ${runs(after).length})`,
      );
      const run = runs(after).at(-1);
      h.expect(
        JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(before).sort())
          && JSON.stringify(await keys()) === JSON.stringify(storedBefore),
        `no WebGL ${pic}: something new was stored (${Object.keys(after)}; ${await keys()})`,
      );
      h.expect(
        !JSON.stringify(run).includes(pic),
        `no WebGL ${pic}: the picture went into the save: ${JSON.stringify(run)}`,
      );
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  async 'thoughts-emotion-keeps-tide'(h) {
    const { ctx, page, errors } = await h.open(seed(h), '?mute', PHONE);
    await toSkill(h, page, 'current-emotion', 'watch');
    await page.locator('.dq-timer-stage').scrollIntoViewIfNeeded();
    await live(h, page, 'emotion watch');
    const s = await scenes(page);
    h.expect(
      s.last.kind === 'tide' && !(await page.locator('.dq-timer-svg--thoughts').count()),
      `the emotion skill's watch step shows ${s.last.kind}`,
    );
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
