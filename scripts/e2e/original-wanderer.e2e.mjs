// The Wanderer in the intro is the game's own figure (scripts/build-hero.py), not a model from a pack. These scenarios
// step the real intro frame by frame, from the silhouette through the reach, the raised hand and the chest beat, and
// check that the figure on screen is the original one, that it stands whole (no piece of cloth, glove or boot torn or
// stretched by its skin weights, the hood over the head, the eyes inside it) and that his eyes light in the hood.

import fs from 'node:fs';
import path from 'node:path';

// an edge of a triangle torn by its skin weights: grown this many times its length as he first stands, and by more
// than a gap you could see (an edge a few millimetres long moves that much with a 1% difference in weights)
const STRETCH = 1.8;
const GAP = 0.01;

async function probe(page) {
  await page.evaluate(() => {
    const hero = () => {
      let g;
      window.__stage.scene.traverse((o) => { if (o.name === 'hero') g = o; });
      return g;
    };
    const meshes = () => { const a = []; hero().traverse((o) => o.isSkinnedMesh && a.push(o)); return a; };
    const pause = () => new Promise((r) => setTimeout(r));
    window.__wanderer = {
      visible: () => !!hero()?.visible,
      async step(until, max = 4000) {
        for (let i = 0; i < max && !until(); i++) { window.__stage.step(1 / 15); await pause(); }
        return until();
      },
      materials: () => [...new Set(meshes().map((m) => m.material.name))].sort(),
      // every edge's length as he first stands, in the idle he is modelled in; later frames are measured against it (the
      // file's own positions are packed into a box per axis, so their lengths are not metres)
      ref: null,
      read(GAP) {
        const g = hero();
        g.updateMatrixWorld(true);
        const V = g.getWorldPosition(g.position.clone()).constructor;
        const bone = (n) => { const b = g.getObjectByName(n); return b.getWorldPosition(new V()); };
        let worst = { k: 0, where: '' }, top = -Infinity, bottom = Infinity;
        const eyes = [];
        const p = new V(), q = new V(), r = new V(), c = new V();
        const first = !this.ref;
        if (first) this.ref = new Map();
        for (const m of meshes()) {
          const pos = m.geometry.getAttribute('position');
          const idx = m.geometry.getIndex();
          const world = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) {
            m.getVertexPosition(i, p).applyMatrix4(m.matrixWorld);
            p.toArray(world, i * 3);
            top = Math.max(top, p.y);
            bottom = Math.min(bottom, p.y);
            if (m.material.name === 'wanderer-eye') eyes.push(p.clone());
          }
          // every edge of every triangle, as he first stood and as he stands now
          if (first) this.ref.set(m, new Float32Array(idx.count));
          const ref = this.ref.get(m);
          for (let t = 0; t < idx.count; t += 3) {
            for (let e = 0; e < 3; e++) {
              const i = idx.getX(t + e), j = idx.getX(t + (e + 1) % 3);
              q.fromArray(world, i * 3);
              r.fromArray(world, j * 3);
              const now = q.distanceTo(r);
              if (first) ref[t + e] = now;
              if (ref[t + e] < 1e-5 || now - ref[t + e] < GAP) continue;
              const k = now / ref[t + e];
              if (k > worst.k) worst = { k, where: `${m.material.name} near ${c.copy(q).add(r).multiplyScalar(0.5).toArray().map((x) => x.toFixed(2)).join(', ')}` };
            }
          }
        }
        const head = bone('Head');
        const eyeMid = eyes.reduce((s, e) => s.add(e), new V()).multiplyScalar(1 / Math.max(1, eyes.length));
        return { stretch: worst.k, where: worst.where, height: top - bottom, eyesFromHead: eyeMid.distanceTo(head), eyes: eyes.length, headTop: top - head.y };
      },
      // how bright his eyes draw: the brightest pixel near each eye on the canvas, 0-255
      glow() {
        const s = window.__stage;
        const g = hero();
        const eyes = [];
        g.traverse((o) => { if (o.isSprite && o.parent?.parent?.name === 'Head') eyes.push(o.getWorldPosition(o.position.clone())); });
        const cv = document.createElement('canvas');
        cv.width = s.canvas.width;
        cv.height = s.canvas.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(s.canvas, 0, 0);
        return eyes.map((e) => {
          const p = e.clone().project(s.camera);
          const x = Math.round(((p.x + 1) / 2) * cv.width), y = Math.round(((1 - p.y) / 2) * cv.height);
          const d = ctx.getImageData(Math.max(0, x - 4), Math.max(0, y - 4), 9, 9).data;
          let best = 0;
          for (let i = 0; i < d.length; i += 4) best = Math.max(best, (d[i] + d[i + 1] + d[i + 2]) / 3);
          return best;
        });
      },
    };
  });
}

const near = (x) => +x.toFixed(3);

async function wholeThroughTheIntro(h, viewport) {
  const name = viewport.width > viewport.height ? 'landscape' : 'portrait';
  const { page, errors } = await h.open({}, '?shot=silhouette&capture&mute&dpr=1&nopost', viewport);
  await page.waitForFunction(() => !!window.__stage, null, { timeout: 60000 });
  await probe(page);
  const snap = async (label) => {
    const png = await page.evaluate(() => window.__stage.canvas.toDataURL('image/png'));
    fs.writeFileSync(path.join(h.out, `wanderer-${name}-${label}.png`), Buffer.from(png.split(',')[1], 'base64'));
  };
  const frames = (n) => page.evaluate((n) => { let i = 0; return window.__wanderer.step(() => ++i > n); }, n);
  const stepTo = (lt) => page.evaluate((lt) => window.__wanderer.step(() => (window.__awakenLT ?? -1) >= lt), lt);
  h.expect(await page.evaluate(() => window.__wanderer.step(() => window.__wanderer.visible())), 'the Wanderer never appeared');

  const mats = await page.evaluate(() => window.__wanderer.materials());
  h.expect(JSON.stringify(mats) === JSON.stringify(['wanderer', 'wanderer-cloth', 'wanderer-eye']), `the intro shows a figure dressed in ${mats.join(', ')}, not the Wanderer's own cloth, gloves and eyes`);

  const log = [];
  const check = async (label) => {
    const m = await page.evaluate((gap) => window.__wanderer.read(gap), GAP);
    log.push(`${label} ${JSON.stringify(m)}`);
    h.expect(m.stretch < STRETCH, `${label}: his ${m.where} stretches to ${near(m.stretch)} times its length`);
    h.expect(m.height > 1.45 && m.height < 2.0, `${label}: he stands ${near(m.height)} m tall`);
    h.expect(m.eyes > 0 && m.eyesFromHead < 0.14, `${label}: his eyes are ${near(m.eyesFromHead)} m from his head`);
    h.expect(m.headTop > 0.12 && m.headTop < 0.4, `${label}: his hood's crown is ${near(m.headTop)} m above his head joint`);
    await snap(label);
    return m;
  };
  // he breathes with his hands at his sides, then wakes
  await frames(30);
  await check('silhouette');
  h.expect(await stepTo(1.2), 'the AWAKEN beat never started');
  await check('rest');
  h.expect(await stepTo(2.9), 'the AWAKEN beat never reached the reach');
  await check('reach');
  h.expect(await stepTo(4.2), 'the AWAKEN beat never reached the command');
  await check('command');
  const glow = await page.evaluate(() => window.__wanderer.glow());
  h.expect(glow.length === 2 && glow.every((g) => g > 150), `his eyes don't light in the hood (brightest ${glow.map(near).join(', ')} of 255)`);
  h.expect(await stepTo(10.4), 'the AWAKEN beat never reached its last mid shot');
  await check('raised');
  log.push(`eyes ${glow.map(near).join(', ')}`);
  h.expect(!errors.length, errors.join('\n'));
  return log;
}

export const scenarios = {
  'original Wanderer in portrait: his own figure stands whole from the silhouette to the raised hand': (h) => wholeThroughTheIntro(h, { width: 390, height: 844 }),
  'original Wanderer in landscape: his own figure stands whole from the silhouette to the raised hand': (h) => wholeThroughTheIntro(h, { width: 844, height: 390 }),
};
