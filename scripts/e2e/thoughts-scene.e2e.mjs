import { deviceMotion } from './device-motion.e2e.mjs';
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
const SCENED = ['clouds', 'cars'];

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

async function lampGlow(page) {
  const size = await page.locator('.dq-scene canvas').evaluate((c) => [c.width, c.height]);
  return page.evaluate(async ([w, h]) => {
    const { paintCars } = await import('/src/scene/vignettes/scenes/thoughts/cars.ts');
    const { FOV } = await import('/src/scene/vignettes/scenes/thoughts/picture.ts');
    const lib = performance.getEntriesByType('resource').find((e) => e.name.includes('/deps/three.js'));
    const THREE = await import(lib.name);
    const renderer = new THREE.WebGLRenderer();
    const target = new THREE.WebGLRenderTarget(w, h);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, w / h, 0.1, 1200);
    const picture = paintCars(scene, camera, { value: 0 });
    picture.resize(w, h);
    const glows = scene.children.find((o) => o.material.uniforms?.uLamp);
    const { uLamp, uSize } = glows.material.uniforms;
    const alone = (o) => scene.children.filter((c) => c.geometry === o.geometry).length === 1;
    const solid = scene.children.filter(
      (o) => o !== glows && o.material.depthTest && o.material.depthWrite && alone(o),
    );
    const ray = new THREE.Raycaster();
    const blocked = (to) => {
      const toward = to.clone().sub(camera.position);
      ray.set(camera.position, toward.clone().normalize());
      ray.far = toward.length() - 0.05;
      return ray.intersectObjects(solid, false).length > 0;
    };
    const AROUND = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].map(([x, y]) => new THREE.Vector3(x, y, 0));
    const cover = (lamp) => AROUND.filter((d) => blocked(d.clone().add(lamp))).length;
    const nearest = (x, y) => {
      ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, (y / h) * 2 - 1), camera);
      ray.far = Infinity;
      return ray.intersectObjects(solid, false)[0]?.distance ?? Infinity;
    };
    const halo = (lamp, depth) => {
      const { x: size, y: least, z: most } = uSize.value;
      const px = (size * camera.projectionMatrix.elements[5] * h * 0.5) / depth;
      return Math.round(0.4 * Math.min(Math.max(px, least), most) * (0.6 + 0.4 * lamp.w));
    };
    const pixel = new Uint8Array(4);
    const frame = (lit, points) => {
      glows.visible = lit;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      return points.map(([x, y]) => {
        renderer.readRenderTargetPixels(target, x, y, 1, 1, pixel);
        return pixel[0] + pixel[1] + pixel[2];
      });
    };
    const seen = { hidden: [], clear: [] };
    for (let k = 0; k <= 100; k++) {
      picture.pose(0, [{ n: 0, u: k / 100 }]);
      scene.updateMatrixWorld();
      const lamps = uLamp.value.slice(0, 2);
      const spots = lamps.map((l) => new THREE.Vector3(l.x, l.y, l.z));
      const covered = spots.reduce((sum, spot) => sum + cover(spot), 0);
      if (covered % (AROUND.length * 2)) continue;
      const marks = spots.flatMap((spot, i) => {
        const depth = -spot.clone().applyMatrix4(camera.matrixWorldInverse).z;
        const at = spot.clone().project(camera);
        if (Math.abs(at.x) > 0.95 || Math.abs(at.y) > 0.95) return [];
        const [x, y] = [Math.round(((at.x + 1) * w) / 2), Math.round(((at.y + 1) * h) / 2)];
        const r = halo(lamps[i], depth);
        const under = nearest(x, y - r) / spot.distanceTo(camera.position);
        return [{ points: [[x, y], [x, y + r], [x, y - r]], under }];
      });
      if (!marks.length) continue;
      const points = marks.flatMap((m) => m.points);
      const on = frame(true, points);
      const off = frame(false, points);
      const glow = on.map((v, i) => v - off[i]);
      marks.forEach(({ under }, i) => {
        const [centre, above, below] = glow.slice(i * 3, i * 3 + 3);
        seen[covered ? 'hidden' : 'clear'].push({ u: k / 100, centre, above, below, under });
      });
    }
    renderer.dispose();
    target.dispose();
    return seen;
  }, size);
}

export const scenarios = {
  async 'thoughts-clouds'(h) {
    await picture(h, 'clouds');
  },
  async 'thoughts-cars'(h) {
    await picture(h, 'cars');
  },
  async 'thoughts-cars-lamps-behind'(h) {
    const said = (spots) => spots.map((s) => `${s.u}: ${s.below}/${s.centre}/${s.above}`).join(', ');
    for (const [tag, vp] of [...SIZES, ['desk', DESK]]) {
      const { ctx, page, errors } = await h.open(seed(h), '?mute', vp);
      await toThoughts(h, page, 'cars');
      const { hidden, clear } = await lampGlow(page);
      const shows = hidden.filter((s) => s.centre > 6);
      const dim = clear.filter((s) => s.centre < 40);
      const cut = clear.filter((s) => s.under > 0.5 && s.below < s.above / 2);
      h.expect(!shows.length, `cars ${tag}: headlights behind the hill or trees still glow (${said(shows)})`);
      h.expect(clear.length && !dim.length, `cars ${tag}: headlights in plain view do not glow (${said(dim)})`);
      h.expect(!cut.length, `cars ${tag}: the road cuts the bottom off a headlight's glow (${said(cut)})`);
      h.expect(hidden.length, `cars ${tag}: no car passed behind the hill or trees`);
      console.log(`  cars ${tag}: ${hidden.length} lamps hidden, ${clear.length} in view`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
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
      for (const pic of SCENED) {
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
      const pic = SCENED[k % SCENED.length];
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
      const pic = SCENED[k % SCENED.length];
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
    const COST = { clouds: [40000, 600], cars: [40000, 3500] };
    for (const [k, [tag, vp]] of SIZES.entries()) {
      const pic = SCENED[k % SCENED.length];
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
      await page.clock.install();
      await page.reload();
      await h.reachHub(page);
      const save = async () => JSON.parse((await h.ls(page, h.SAVE)) ?? '{"events":[]}');
      const keys = async () => page.evaluate(() => Object.keys(localStorage).sort());
      const [before, storedBefore] = [await save(), await keys()];
      await toThoughts(h, page, pic);
      await page.clock.runFor(1500);
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
      await page.clock.runFor(2000);
      const b = await look();
      h.expect(a !== b, `no WebGL ${pic}: the flat picture's thoughts do not move (${a})`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await h.sleep(500);
      await page.clock.runFor(100);
      const c = await look();
      await page.clock.runFor(2000);
      h.expect(c === (await look()), `no WebGL ${pic}, reduced motion: the flat picture's thoughts still move (${c})`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await h.shot(page, `thoughts-no-webgl-${pic}`);
      await page.clock.fastForward(61000);
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
